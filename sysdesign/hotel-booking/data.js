SD.renderCase({
  slug: 'hotel-booking',
  summary: 'A hotel or home-rental platform answers one expensive question millions of times a day, "what is available near here for these dates, and at what price?", and one cheap but critical question a few times a second, "book this room for these nights". Search is a two-phase read: a <strong>geo + filter</strong> query on a search index finds candidate properties, then an in-memory <strong>availability and price engine</strong> checks every night of the stay for each candidate. Booking decrements <strong>room-type inventory per night</strong> with <strong>optimistic concurrency</strong> and an <strong>idempotent</strong> reservation id, so concurrent bookings and retries never oversell beyond the hotel’s explicit <strong>overbooking policy</strong>. The hidden giant is supply-side sync: hotels sell the same rooms on many sites through <strong>channel managers</strong>, which push far more availability and rate updates than there are bookings.',
  examples: 'Booking.com, Expedia / Hotels.com, Airbnb, Vrbo, Agoda, Trip.com; hotel property-management systems (Oracle OPERA, Mews) and channel managers (SiteMinder, D-EDGE) on the supply side.',
  functional: ['Search properties by destination (city, map area, landmark radius), dates and guests, with filters (price, stars, amenities, review score).', 'View a property: room types, rate plans (refundable, breakfast), nightly and total price, photos and reviews.', 'Reserve a room type for a date range; pay now or at the property; receive a confirmation.', 'Cancel or modify according to the rate plan policy.', 'Hotels and hosts manage availability, rates and restrictions directly or via a channel manager.', 'Guests write reviews after a completed stay; scores feed search ranking.'],
  nonFunctional: ['Search p95 under 400 ms including availability and price for every result.', 'No booking beyond the property’s allowed capacity (total rooms + explicit overbooking allowance).', 'A retried reservation request never creates two bookings.', 'Availability and rate updates from channel managers visible in search within ~1 minute.', 'Reservations 99.99% available; search can serve slightly stale availability, re-verified at booking.'],
  outOfScope: ['Flights and car rental bundles.', 'Hotel front-desk operations (housekeeping, check-in).', 'The ranking model itself (see <a href="../recommendation/index.html">recommendation system</a>).'],
  estimates: [
    ['Properties / room types', '5 M properties, ~20 M room types and listings', 'Hotels average several room types; a home listing is one unit'],
    ['Searches', '100 M/day &rArr; ~1,200/s avg, ~5,000/s peak', 'Peak ~4&times; average (evenings, seasonal planning)'],
    ['Reservations', '1 M/day &rArr; ~12/s avg, ~60/s peak', 'Look-to-book ratio ~100 : 1'],
    ['Inventory rows (room type &times; night)', '20 M &times; 365 = 7.3 B rows &asymp; 290 GB', '~40 B per row; one rolling year bookable'],
    ['Availability engine memory', '7.3 B &times; 8 B &asymp; 60 GB', 'Count (2 B) + lowest price (4 B) + restriction flags per room-type-night'],
    ['ARI updates (availability, rates, inventory)', '500 M/day &rArr; ~5,800/s avg, ~20,000/s peak', 'Revenue managers and channel managers push rate changes constantly: writes are dominated by supply sync, not bookings'],
    ['Photos', '5 M &times; 30 &times; 300 KB &asymp; 45 TB', 'Object storage + CDN with resized renditions'],
    ['Reviews', '300 M &times; 1 KB &asymp; 300 GB', 'Append-mostly, read with pagination']
  ],
  compute: [
    ['Search service', '~95 pods of 4 vCPU across 3 zones', '5,000 searches/s &times; ~30 ms CPU (geo query orchestration, availability fan-out, ranking) = 150 cores &rArr; 250 at 60% &rArr; ~63 pods; &times;1.5 to survive a zone loss.'],
    ['Search index', '3 shards &times; 6 replicas on 18 nodes of 16 vCPU', 'Only ~25 GB of property docs (5 M &times; 5 KB), so shards are few; replicas are for QPS: 5,000 q/s &times; 10 ms = 50 busy cores, plus heavy facet aggregations.'],
    ['Availability engine', '4 partitions &times; 3 replicas = 12 nodes of 32 GB, 8 vCPU', '60 GB / 4 = 15 GB per partition. Each search checks ~1,000 candidates: 5 M property checks/s &times; ~2 &micro;s = ~10 cores; the real cost is fan-out and serialisation, so keep it in-process and batched.'],
    ['Inventory and reservation DB', '8 PostgreSQL shards by property_id', '20,000 ARI writes/s + ~300 booking row updates/s (60 reservations &times; ~5 nights) &rArr; ~2,500 writes/s per shard with batched upserts; each with a zone-redundant standby.'],
    ['ARI ingest workers', '~12 pods of 4 vCPU', '20,000 updates/s &times; ~1 ms parse/validate/dedupe = 20 cores at peak, consumed from Kafka partitioned by property_id.']
  ],
  api: [
    ['GET /search?dest=&checkin=&checkout=&guests=&filters=&cursor=', 'Two-phase search; results carry indicative prices. Popular (destination, dates, guests) combinations cached for a few minutes.'],
    ['GET /properties/{id}/offers?checkin=&checkout=&guests=', 'Live availability per room type and rate plan, with a signed quote token (price, currency, expiry ~30 min).'],
    ['POST /reservations  (Idempotency-Key)  {quoteToken, guest, paymentMethod}', 'Creates the reservation; the key is generated by the client once per booking attempt, so retries return the same reservation.'],
    ['POST /reservations/{id}/cancel', 'Applies the rate plan’s cancellation policy, releases inventory and triggers refunds.'],
    ['POST /ari  (channel manager → platform)', 'Batched availability, rates and restrictions per property/room type/date range, with a per-property sequence number to discard out-of-order updates.'],
    ['Webhook: reservation notification (platform → channel manager)', 'New, modified and cancelled bookings pushed to the hotel’s channel manager / PMS so other sites decrement their inventory.'],
    ['POST /reviews  {reservationId, scores, text}', 'Allowed only for completed stays, one per reservation; goes through moderation before publishing.']
  ],
  data: [
    ['property (search doc)', 'Search engine (Elasticsearch / OpenSearch / Azure AI Search)', 'geo_point, H3 cell ids at several resolutions, star rating, amenities, review score, price hint; sharded by property_id.'],
    ['room_type_night', 'Relational, sharded by property_id', 'PK (property_id, room_type_id, stay_date); total, reserved, overbook_limit, closed, min_los, version, last_ari_seq.'],
    ['rate', 'Relational, same shard', '(property_id, room_type_id, rate_plan_id, stay_date) &rarr; price, currency, policy id; length-of-stay and occupancy-based variants.'],
    ['reservation', 'Relational, same shard as the property', 'reservation_id (= idempotency key), guest_id, room_type_id, check_in, check_out, status, total, currency, channel; a guest-to-reservations lookup table sharded by guest_id.'],
    ['availability snapshot', 'In-memory engine (custom service or Redis)', 'Per property: per room type, arrays of 365 (count, price, flags); rebuilt from DB, kept fresh from the inventory event stream.'],
    ['reviews', 'Document store', 'pk property_id, sort key created_at; aggregated score per property written back to the search doc asynchronously.']
  ],
  dbChoice: [
    ['Inventory and reservations', 'Relational, sharded by property_id', 'A booking touches several night rows of one property: a single-shard transaction with version checks. Constraints and audit matter more than raw scale.', 'DynamoDB / Cosmos DB with transactional batches (works: up to 100 items per transaction, one partition per property).'],
    ['Search candidates', 'Search engine with geo queries', 'Geo-distance, polygon and bounding-box filters plus facets and text over 5 M docs in tens of milliseconds.', 'PostGIS: great for geo, but facets and relevance at 5,000 q/s are harder to scale.'],
    ['Date-range availability for thousands of candidates', 'In-memory availability engine', 'Checking every night of a stay for ~1,000 properties per search is ~10,000 lookups; it must be microseconds, not database round trips.', 'Putting per-date availability into the search index: possible (nested docs or bitmaps), but ARI churn of 20,000 updates/s causes constant reindexing.'],
    ['Reviews', 'Document / wide-column store', 'Append-mostly, read by property in time order; no joins.', 'Relational: fine at small scale.']
  ],
  diagram: {
    nodes: [['u', 'Travellers', 'client', 0, 1.5, 'web / app'], ['edge', 'CDN', 'cdn', 1, 1.5, 'photos, cached search'], ['gw', 'API gateway', 'apigw', 2, 1.5, 'auth, rate limits'],
      ['srch', 'Search service', 'svc', 3, 0.5, 'geo + rank'], ['idx', 'Search index', 'search', 4, 0, 'geo, filters, facets'], ['av', 'Availability engine', 'cache', 4, 1.0, 'in-memory nights'],
      ['bk', 'Reservation service', 'svc', 3, 1.8, 'idempotent, OCC'], ['inv', 'Inventory DB', 'db', 5, 1.8, 'room type x night'], ['bus', 'Event stream', 'stream', 6, 1.0, 'inventory events'],
      ['pr', 'Pricing service', 'svc', 4, 2.7, 'rate plans, tax'], ['pay', 'Payment service', 'svc', 3, 3.0, 'prepay / guarantee'], ['ari', 'ARI ingest', 'worker', 5, 2.9, 'ordered by property'],
      ['cm', 'Channel managers', 'ext', 6, 2.9, 'PMS, other OTAs'], ['rev', 'Reviews service', 'svc', 2, 2.8, 'post-stay, moderated']],
    edges: [['u', 'edge'], ['edge', 'gw'], ['gw', 'srch'], ['gw', 'bk'], ['gw', 'rev'], ['srch', 'idx'], ['srch', 'av'], ['bk', 'inv'], ['bk', 'pr'], ['bk', 'pay'],
      ['inv', 'bus', 'outbox', 'async'], ['bus', 'av', 'refresh', 'async'], ['cm', 'ari', 'ARI push'], ['ari', 'inv'], ['bus', 'cm', 'bookings', 'async']]
  },
  flows: [
    { name: 'Search by place and dates', desc: '"Lisbon, 12-15 May, 2 adults": find candidates by geography, then check every night of the stay.', steps: [
      ['u', 'edge', 'GET /search?dest=lisbon...', 'The query is normalised (destination id, dates, guests) so identical popular searches share a short-lived edge cache entry.'],
      ['edge', 'gw', 'cache miss', 'Uncommon combinations go to the origin.'],
      ['gw', 'srch', 'search', 'The search service resolves "Lisbon" to a polygon (or a set of H3 cells) and applies the guest’s filters.'],
      ['srch', 'idx', 'geo + filters, top 1,000', 'The index returns ~1,000 candidate properties inside the area matching static filters (type, stars, amenities). No dates yet: those change too often to index.'],
      ['srch', 'av', 'batch check 1,000 x 3 nights', 'Scatter-gather to the availability partitions: for each candidate, is there a room type with count > 0 for all three nights, no closed-to-arrival flag, and min length of stay met?'],
      ['av', 'srch', '640 available + prices', 'Microseconds per property: arrays in memory. Total price is the sum of nightly prices for the cheapest qualifying rate plan.', 'resp'],
      ['srch', 'u', 'ranked results', 'Rank by a learned model (conversion probability, price, review score, distance), then page. Prices are indicative until the offer step.', 'resp']],
      end: 'Static attributes live in the search index; volatile per-night availability lives in a separate in-memory engine. Each is updated at its own pace.' },
    { name: 'Reserve with optimistic concurrency', desc: 'The traveller books a Deluxe Double for 3 nights.', steps: [
      ['u', 'gw', 'POST /reservations (key R)', 'The app generated R once for this booking attempt; a timeout and retry will reuse it.'],
      ['gw', 'bk', 'reserve R', 'If a reservation with id R already exists, return it immediately: this is the idempotency check.'],
      ['bk', 'pr', 'validate quote token', 'The signed quote fixes the price for 30 minutes; if it expired, reprice and ask the guest to confirm any change.'],
      ['bk', 'inv', 'read 3 nights (version 41-43)', 'Read the three room_type_night rows with their versions and check reserved < total + overbook_limit for each.'],
      ['bk', 'inv', 'UPDATE ... WHERE version = v', 'In one transaction: increment reserved on each night only if its version is unchanged, insert the reservation (PENDING) and an outbox row. Any 0-row update aborts the whole transaction.'],
      ['bk', 'pay', 'authorise or vault card', 'Prepaid rates are authorised now; pay-at-property rates only store a guarantee token. The PSP call uses R as its idempotency key.'],
      ['bk', 'inv', 'status CONFIRMED', 'Guarded transition PENDING to CONFIRMED.'],
      ['inv', 'bus', 'ReservationCreated', 'Published from the outbox.', 'async'],
      ['bus', 'cm', 'push booking to hotel', 'The hotel’s channel manager receives the booking and lowers availability on every other site selling this room.', 'async'],
      ['bk', 'u', 'confirmation #BK-77', 'Confirmation email and app notification follow asynchronously.', 'resp']],
      end: 'Optimistic concurrency fits hotels: conflicts are rare (60 bookings/s spread over millions of rows), so checking versions at write time beats holding locks.' },
    { name: 'Channel manager ARI update', desc: 'A hotel’s revenue manager raises weekend prices and closes one room type; the change arrives through a channel manager.', steps: [
      ['cm', 'ari', 'ARI batch, seq 9,812', 'A batch of availability, rates and restrictions for 30 nights. Updates for one property carry an increasing sequence number.'],
      ['ari', 'inv', 'upsert WHERE seq > last_seq', 'Kafka is partitioned by property_id so one property’s updates are processed in order, and the upsert ignores any update older than last_ari_seq. Batched upserts set total rooms and prices; reserved is never overwritten because it belongs to the platform’s own bookings.'],
      ['ari', 'cm', 'ack seq 9,812', 'Acknowledge the batch so the channel manager stops retrying. A resent batch is harmless because its sequence number is already applied.', 'resp'],
      ['inv', 'bus', 'InventoryChanged', 'An event per changed property and date range.', 'async'],
      ['bus', 'av', 'patch in-memory arrays', 'The availability engine patches the affected nights; search reflects the change within seconds.', 'async']],
      end: 'Supply sync is the high-volume write path. Ordering per property and sequence numbers make it safe to retry and replay.' },
    { name: 'Last room: conflict and overbooking', desc: 'Two travellers try to book the last Deluxe Double for the same night; then a booking arrives from another site.', steps: [
      { par: [['u', 'gw', 'reserve (traveller A)'], ['u', 'gw', 'reserve (traveller B)']], msg: 'Both saw one room left in search a few seconds ago.' },
      ['bk', 'inv', 'both read version 43', 'Both requests read reserved = 9, total = 10, version 43.'],
      ['inv', 'bk', 'A commits, version 44', 'A’s conditional update matches version 43 and commits.', 'resp'],
      ['inv', 'bk', 'B: 0 rows (stale version)', 'B’s update finds version 44 and changes nothing; its transaction rolls back.', 'err'],
      ['bk', 'inv', 'B retries: re-read', 'B re-reads: reserved = 10, total = 10. The hotel set overbook_limit = 0 for this room type and night, so nothing is left.'],
      ['bk', 'u', '409 sold out + alternatives', 'B is offered other room types or nearby properties.', 'err'],
      ['cm', 'ari', 'booking from other OTA', 'Seconds later, the channel manager reports a booking for the same night made on another site before our update reached it.', 'err'],
      ['ari', 'inv', 'reserved now exceeds total', 'The hotel is overbooked by one. The platform raises an alert to the hotel, which applies its relocation ("walk") policy.', 'err']],
      end: 'Within the platform, optimistic concurrency prevents oversell. Across channels, sync lag makes occasional overbooking unavoidable, so it is managed by policy, alerts and relocation, not prevented by locks.' }
  ],
  components: [
    ['CDN', 'Photos, static pages and short-lived cached search results for popular queries.'],
    ['API gateway', 'Authentication, partner API keys, per-client rate limits (scrapers are a large share of search traffic).'],
    ['Search service', 'Destination resolution, geo query, availability fan-out, ranking, pagination.'],
    ['Search index', 'Static property attributes, geo, facets, review score.'],
    ['Availability engine', 'In-memory per-night availability and price arrays, partitioned by property.'],
    ['Reservation service', 'Idempotent bookings, optimistic concurrency, cancellations, modifications.'],
    ['Pricing service', 'Rate plans, taxes and fees, currency conversion, signed quote tokens.'],
    ['ARI ingest', 'Receives availability/rates/restrictions from channel managers and extranets; ordering and dedupe.'],
    ['Channel connector', 'Pushes reservations, modifications and cancellations back to channel managers and PMSs.'],
    ['Reviews service', 'Verified post-stay reviews, moderation, score aggregation.']
  ],
  deep: [
    ['Modelling availability', '<p>Hotels sell <strong>room types</strong>, not specific rooms: "10 Deluxe Doubles" per night. The core table is one row per property, room type and night:</p><div class="table-wrap"><table><tr><th>property</th><th>room_type</th><th>stay_date</th><th>total</th><th>reserved</th><th>overbook_limit</th><th>version</th></tr><tr><td>p42</td><td>DLX</td><td>2027-05-12</td><td>10</td><td>9</td><td>0</td><td>43</td></tr></table></div><ul><li>A stay of N nights touches N rows; available = total + overbook_limit - reserved must be &ge; 1 on <em>every</em> night.</li><li>The room number is assigned by the hotel PMS at check-in, not by the platform.</li><li>Home rentals (Airbnb) are the special case total = 1: a calendar of AVAILABLE / BLOCKED / BOOKED nights per listing, often with an exclusion constraint on date ranges (<code>EXCLUDE USING gist (listing_id WITH =, stay daterange WITH &amp;&amp;)</code> in PostgreSQL).</li><li>Restrictions: min length of stay, closed to arrival/departure, and stop-sell flags live on the same row.</li></ul>'],
    ['Search: geo first, dates second', '<p>Destination search maps a place to a geometry: a city polygon, a map viewport (bounding box) or a radius around a landmark. Properties are indexed with a <code>geo_point</code> and precomputed H3 cell ids, so the filter is a fast term lookup on cells plus an exact distance check. Dates are deliberately <em>not</em> in the index: availability changes ~20,000 times a second and would cause constant reindexing.</p><ol><li>Index query: geo + static filters &rarr; ~1,000 candidates (with a cheap prior score).</li><li>Availability engine: check all nights for each candidate &rarr; available set with total prices.</li><li>Ranking: learned model on conversion, price competitiveness, reviews and distance.</li><li>Cache: normalised (destination, dates, guests) result pages for a few minutes; the offer step always re-checks live.</li></ol>'],
    ['Idempotent reservation with optimistic concurrency', '<pre><code>BEGIN;\n-- idempotency: a second attempt with the same id is a no-op\nINSERT INTO reservation(id, property_id, room_type, check_in, check_out, status, ...)\n  VALUES (:r, ...) ON CONFLICT (id) DO NOTHING;\n-- for each night d in [check_in, check_out)\nUPDATE room_type_night\n   SET reserved = reserved + 1, version = version + 1\n WHERE property_id = :p AND room_type = :t AND stay_date = :d\n   AND version = :v_d\n   AND reserved + 1 &lt;= total + overbook_limit;\n-- any update affecting 0 rows =&gt; ROLLBACK and retry (re-read versions)\nINSERT INTO outbox(...) VALUES (...);\nCOMMIT;</code></pre><p>All rows of a stay live on the property’s shard, so this is a local transaction. Retries are bounded (e.g. 3) with jitter. Under heavy contention (a popular apartment on New Year’s Eve) a pessimistic <code>SELECT ... FOR UPDATE</code> on the night rows in date order is equally valid.</p>'],
    ['Overbooking policy and channel sync', '<ul><li><strong>Why hotels overbook:</strong> 5-10% of bookings no-show or cancel late; revenue managers deliberately sell slightly more than capacity on flexible rates.</li><li><strong>Explicit policy:</strong> overbook_limit per room type and date, set by the hotel, never by the platform. Non-refundable rates usually get zero.</li><li><strong>Channel managers</strong> keep one inventory pool for many sales channels. Each booking is pushed to the channel manager, which updates every other channel. During the seconds of propagation two channels can sell the last room.</li><li><strong>Mitigations:</strong> push bookings immediately (webhooks, not polling), keep a small safety buffer on the last rooms, accept ARI with sequence numbers, and surface overbookings to the hotel with relocation workflows.</li><li><strong>Reconciliation:</strong> a nightly job compares platform reservations with the PMS and flags mismatches.</li></ul>'],
    ['Pricing and reviews', '<p><strong>Pricing</strong> is a function of (room type, rate plan, night, occupancy, length of stay, market, currency), plus taxes and fees that vary by city. The pricing service computes a total and returns a <strong>signed quote token</strong> (price, currency, expiry) so the reservation step can trust it without recomputing, and so prices cannot be tampered with. Prices shown in search are cached hints; the offer page is authoritative.</p><p><strong>Reviews</strong> are allowed only from completed reservations (one per stay), go through automated moderation (toxicity, spam, personal data) and human review for edge cases, then update a recency-weighted aggregate score that is written back to the search document asynchronously.</p>']
  ],
  scale: [
    '<strong>Search is the cost centre</strong> (100 searches per booking): cache normalised popular searches, cap candidates per query, and protect against scraping bots with rate limits and bot management.',
    '<strong>Availability engine</strong> scales by partitioning properties and adding replicas for QPS; keep each partition in memory and rebuild from snapshots plus the event stream.',
    '<strong>ARI writes</strong> dominate the database: batch upserts per property, coalesce rapid successive updates for the same night, and shard by property_id.',
    '<strong>Hot properties</strong> (a festival week) concentrate bookings on a few rows; optimistic retries handle moderate contention, pessimistic locking in date order handles extreme cases.',
    '<strong>Global:</strong> search runs in every region from replicated read models; reservations for a property are written in its home region.'
  ],
  tradeoffs: [
    ['Availability in search index vs separate engine', 'Index per-night docs vs in-memory engine', 'Separate engine: availability churn (20,000 updates/s) would cause constant reindexing; static attributes and volatile nights scale independently.'],
    ['Concurrency control', 'Optimistic (version check) vs pessimistic (row locks)', 'Optimistic by default because conflicts are rare; pessimistic for very hot single-unit listings.'],
    ['Overbooking', 'Strict capacity vs hotel-defined allowance', 'Hotel-defined allowance per room type/date: it is a business decision; cross-channel lag makes some overbooking inevitable anyway.'],
    ['Price freshness', 'Live price in every search vs cached price hints', 'Cached hints in search, live price with a signed quote at the offer step; reprice on expiry.'],
    ['Payment model', 'Prepay vs pay at property', 'Support both: prepay improves conversion guarantees; pay-at-property needs only a card guarantee token.']
  ],
  failures: [
    ['Client times out and retries a booking', 'Same idempotency key returns the existing reservation; PSP calls reuse the key.'],
    ['Availability engine partition lost', 'Replicas serve; rebuild from DB snapshot plus event replay; search briefly falls back to the index price hints with "check availability".'],
    ['Channel manager outage', 'Queue outbound booking notifications with retries; alert hotels; optionally add a safety buffer to remaining rooms until sync resumes.'],
    ['Out-of-order ARI updates', 'Per-property partitioning and sequence numbers; older updates are discarded.'],
    ['Cross-channel overbooking', 'Detected when ARI arrives; alert hotel, relocation workflow, compensation policy for the guest.'],
    ['Scraper traffic spike', 'Bot management at the edge, per-key rate limits, cached result pages, load shedding on search before bookings.']
  ],
  cloud: [['DNS', 'dns'], ['CDN and cached pages', 'cdn'], ['WAF and bot management', 'waf'], ['API gateway', 'apigw'], ['Services', 'k8s'], ['Property search (geo)', 'search'], ['Availability engine', 'cache'], ['Inventory and reservations', 'sql'], ['Scale-out relational option', 'distsql'], ['Reviews store', 'nosql'], ['Inventory and booking events', 'stream'], ['Partner notifications', 'queue'], ['Photos', 'blob'], ['Maps and geocoding', 'maps'], ['Customer identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-cqrs', 'azp-materialized-view', 'azp-sharding', 'azOutbox', 'azp-cache-aside', 'azp-anti-corruption-layer', 'azAksMicro'],
          aws: ['awsOutbox', 'awsAcl', 'awsDdbBest', 'awsScatter', 'awsCaching', 'blBackoff', 'awsMicro'] },
  questions: [
    ['Why not store availability in the search index?', 'Availability and prices change about 20,000 times a second; every change would be a reindex of the property document. Keeping static attributes in the index and per-night availability in a separate in-memory engine lets each scale and refresh at its own rate. Some platforms do index coarse availability bitmaps as a pre-filter, then verify exactly.'],
    ['How do you prevent two people booking the last room?', 'Each night row has a version; the booking updates all nights in one transaction with WHERE version = v AND reserved + 1 &le; total + overbook_limit. The loser’s update affects zero rows, the transaction rolls back and it retries or fails with alternatives.'],
    ['How do you make reservations idempotent?', 'The client generates a reservation id once per booking attempt and sends it as the Idempotency-Key. The reservation table has it as the primary key, so a retry finds the existing row; the same key is passed to the PSP.'],
    ['How does overbooking happen if your system is correct?', 'The hotel sells the same rooms on many channels. A booking on another site reaches us via the channel manager seconds later; if we sold the last room in that window, the hotel is overbooked. It is managed with fast push sync, small buffers and relocation policies.'],
    ['How would you support Airbnb-style single listings?', 'Total = 1 per night, so the night row becomes a calendar entry. A date-range exclusion constraint (PostgreSQL EXCLUDE with daterange) or the same conditional update on each night prevents overlaps; instant book vs request-to-book adds a host approval state.'],
    ['How do you handle price changes between search and booking?', 'Search shows cached hints; the offer step returns a signed quote token valid ~30 minutes. If it expires, reprice and show the new price before confirming.']
  ],
  related: ['ticket-booking', 'ecommerce', 'proximity', 'payment', 'search-engine']
});

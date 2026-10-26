SD.renderCase({
  slug: 'ticket-booking',
  summary: 'Selling tickets for a stadium tour is an e-commerce problem with two twists: every unit (seat A12) is unique, and demand arrives as a wall: millions of fans at 10:00:00 for 70,000 seats. The design has three pillars. A <strong>virtual waiting room</strong> at the edge turns the stampede into a steady, fair stream of admitted shoppers. A <strong>seat hold</strong> with a TTL (a conditional database update, a row lock, or Redis <code>SET NX EX</code>) gives one shopper exclusive rights to specific seats for a few minutes while they pay. And a final <strong>unique constraint</strong> on (event, seat) makes double booking impossible even if every other layer has a bug. Around them sit bot defences, payment within the hold window, and cached seat maps that keep reads off the inventory database.',
  examples: 'Ticketmaster (Smart Queue, Verified Fan), AXS, SeatGeek, Eventbrite, DICE, BookMyShow, cinema chains and airline seat selection; Queue-it and cloud CDN waiting-room products implement the queue part as a service.',
  functional: ['Browse events and view an interactive seat map with live availability and price tiers.', 'Choose specific seats (reserved seating) or a quantity in a section (general admission / best available).', 'Hold seats for a fixed window (e.g. 8 minutes) while paying; release automatically on timeout.', 'Pay and receive mobile tickets (rotating QR / wallet pass).', 'Join a virtual waiting room for high-demand onsales; presale access codes for verified fans.', 'Purchase limits per account (e.g. 4 tickets per event).'],
  nonFunctional: ['Zero double bookings: a seat is sold to at most one person, ever.', 'Survive a 3.5 M-fan onsale without errors; degrade into waiting, never into timeouts.', 'Hold request p95 under 300 ms once admitted; seat map refresh within ~2 s of changes.', 'Fairness: arrival order (or a published randomisation) decides access, not who has the most bots.', 'Checkout availability 99.95%; browse can be served stale from caches.'],
  outOfScope: ['Dynamic pricing algorithms (assume a price per tier).', 'Resale marketplace and ticket transfer.', 'Venue gate scanning hardware.'],
  estimates: [
    ['Tickets sold per year', '~500 M (~1.4 M/day)', 'Large global ticketing platform'],
    ['Orders per day (average)', '~550,000 &rArr; ~6.5/s', '2.5 tickets per order; the average is tiny, the peaks are the whole problem'],
    ['Mega onsale', '3.5 M fans in 10 min for 70,000 seats', 'Stadium show; demand 50&times; supply'],
    ['Waiting-room status polls', '~175,000 req/s', '3.5 M &times; 1 poll every 20 s; must be answered at the edge'],
    ['Admission rate', '~2,000 shoppers/min', 'Tuned to back-end capacity; 28,000 orders (70,000 / 2.5) at ~70% conversion &rArr; sold out in ~20 min'],
    ['Shoppers inside at once', '~12,000', '2,000/min &times; ~6 min average session'],
    ['Seat map reads', '~4,000/s', '12,000 shoppers refreshing every 3 s'],
    ['Hold attempts', '~500/s for the hot event', '12,000 shoppers, one attempt per ~30 s plus retries when someone beats them to a seat'],
    ['Seat inventory data', '~500 GB/year', '1 M events &times; 5,000 seats average &times; 100 B per seat row']
  ],
  compute: [
    ['Edge + waiting room', 'CDN/edge KV for polls; 6 small origin pods', 'Each fan gets a queue number at join (INCR in Redis: 3.5 M in 10 min &asymp; 6,000/s). Polls compare their number with a global "now serving" counter cached at the edge for 5 s, so 175,000 polls/s cost the origin ~1 req/s per edge PoP.'],
    ['Booking service', '12 pods of 2 vCPU across 3 zones', '~520 holds + confirms/s &times; ~10 ms CPU = ~5 cores. The service is cheap; it is sized for bursts (10&times;) and zone loss, not average load.'],
    ['Seat inventory DB', 'Shards by hash(event_id); hot event on a dedicated shard', '500 hold tx/s of 2-4 rows each is easy for one PostgreSQL primary because contention is per seat, not per event. Without the waiting room the same event would see &gt;100,000 writes/s: impossible on any single shard.'],
    ['Seat map cache', '1 Redis primary + replica per hot event', '4,000 bitmap reads/s plus ~1,500 bit flips/s; a 70,000-seat map is ~9 KB of bits. One Redis shard handles ~100,000 ops/s.'],
    ['Payment calls', '~25 authorisations/s per onsale', '~1,400 orders/min at the PSP; well within PSP limits, but pre-agree peak volumes and keep a second PSP for failover.']
  ],
  api: [
    ['POST /events/{id}/queue', 'Join the waiting room; returns a signed queue ticket with a number. Before the onsale starts, early arrivals are randomised into order.'],
    ['GET /queue/{ticket}', 'Position, ETA, or an admission token (JWT bound to session and event, valid ~15 min). Cached at the edge.'],
    ['GET /events/{id}/seatmap?section=', 'Layout (static, from CDN) plus an availability bitmap and price tiers from cache. Requires the admission token during an onsale.'],
    ['POST /events/{id}/holds  (Idempotency-Key)  {seatIds[] | section, qty}', 'All-or-nothing hold; returns holdId and expiresAt, or 409 with alternative best-available seats.'],
    ['POST /holds/{holdId}/purchase  {paymentMethodId}', 'Pay within the window; the holdId is the payment idempotency key so retries never double-charge.'],
    ['DELETE /holds/{holdId}', 'Release early (user changes their mind); seats return to the pool immediately.'],
    ['SSE /events/{id}/seatmap/stream', 'Optional push of seat-status deltas so maps update without polling.']
  ],
  data: [
    ['event, venue, seat layout', 'Relational + object storage/CDN', 'venue_seat(venue_id, seat_id, section, row, number, x, y); rendered seat-map SVG/JSON in object storage, immutable per layout version.'],
    ['event_seat (inventory)', 'Relational, sharded by event_id', 'PK (event_id, seat_id); status AVAILABLE | HELD | PAYING | SOLD; hold_id; hold_expires_at; price_tier; version. Index (event_id, status, hold_expires_at) for the sweeper.'],
    ['hold', 'Same shard as the seats', 'hold_id, event_id, user_id, seat_ids, expires_at, status; one active hold per user per event.'],
    ['order, ticket', 'Relational, same shard as event', 'ticket(ticket_id, event_id, seat_id, order_id, user_id, barcode_secret) with UNIQUE (event_id, seat_id): the last line of defence against double booking.'],
    ['queue state', 'Redis', 'queue:{event}:next (INCR), queue:{event}:serving (admission pointer), ticket &rarr; number hash; admission tokens are stateless signed JWTs.'],
    ['seat availability bitmap', 'Redis', 'seatmap:{event}:{section} as a bitfield (1 = unavailable); rebuilt from the DB on cache loss.']
  ],
  dbChoice: [
    ['Seat inventory, holds, tickets', 'Relational (PostgreSQL / Azure SQL / Aurora), sharded by event', 'Atomic multi-seat holds, conditional updates, unique constraints and a full audit trail; one event fits on one shard so every transaction is single-shard.', 'Redis-only holds: fast but needs Lua for multi-seat atomicity and is not a durable source of truth. DynamoDB transactions (up to 100 items) are a good serverless alternative.'],
    ['Waiting-room queue', 'Redis counters + edge caching', 'Only two numbers per event are hot (next ticket, now serving); everything else is stateless tokens.', 'A real message queue per user: unnecessary state and cost for millions of idle waiters.'],
    ['Seat map availability', 'Redis bitmaps (cache-aside, write-through on hold)', 'Thousands of reads per second of the same small structure; the DB should only see writes.', 'Query the inventory table per refresh: 4,000 scans/s of 70,000 rows would sink the hot shard.'],
    ['Event discovery', 'Search engine', 'Search by artist, city, date with facets; eventually consistent from the catalog.', 'Database LIKE queries.']
  ],
  diagram: {
    nodes: [['u', 'Fans', 'client', 0, 1.3, 'web / app'], ['wr', 'Waiting room', 'svc', 1, 0.1, 'queue + signed tokens'], ['edge', 'CDN + WAF', 'edge', 1, 1.3, 'bot score, static'],
      ['gw', 'API gateway', 'apigw', 2, 1.3, 'token + rate limits'], ['ev', 'Event service', 'svc', 3, 0.1, 'events, seat maps'], ['mc', 'Seat map cache', 'cache', 4, 0.1, 'Redis bitmaps'],
      ['bk', 'Booking service', 'svc', 3, 1.3, 'hold, confirm'], ['sdb', 'Seat inventory DB', 'db', 5, 1.3, 'sharded by event_id'], ['sw', 'Hold sweeper', 'worker', 6, 0.3, 'releases expired'],
      ['pay', 'Payment service', 'svc', 4, 2.4, 'idempotent'], ['psp', 'Card PSP', 'ext', 5, 2.4, 'authorise / void'], ['bus', 'Event stream', 'stream', 6, 2.4, 'outbox events'], ['tk', 'Ticket issuer', 'worker', 6, 3.4, 'QR, wallet passes']],
    edges: [['u', 'wr'], ['u', 'edge'], ['edge', 'gw'], ['gw', 'ev'], ['gw', 'bk'], ['ev', 'mc'], ['bk', 'mc', 'set bits'], ['bk', 'sdb'], ['bk', 'pay'], ['pay', 'psp'],
      ['sw', 'sdb', 'release'], ['sw', 'mc'], ['sdb', 'bus', 'outbox', 'async'], ['bus', 'tk', '', 'async']]
  },
  flows: [
    { name: 'Waiting room admission', desc: 'The onsale opens at 10:00. 3.5 M fans arrive; the back end can serve ~2,000 new shoppers a minute.', steps: [
      ['u', 'edge', 'GET /events/123', 'The edge sees the event is in onsale mode and has no admission token on the request, so it redirects to the waiting room instead of the origin.'],
      ['u', 'wr', 'POST queue (CAPTCHA passed)', 'The fan joins. A bot score check or invisible challenge runs first; suspicious clients get a harder challenge or are dropped.'],
      ['wr', 'u', 'ticket #812,344, ETA 9 min', 'Fans who arrived before 10:00 were randomised into order at the start, so refreshing early gives no advantage. Late arrivals are FIFO.', 'resp'],
      ['u', 'edge', 'poll status every 20 s', 'Polls are answered by the edge: it compares the ticket number with the cached "now serving" counter. The origin barely notices 175,000 polls/s.'],
      ['wr', 'u', 'admission token (JWT)', 'When the counter passes the fan’s number, they get a token signed for this event and session, valid 15 minutes.', 'resp'],
      ['u', 'edge', 'request + token', 'From now on every request carries the token.'],
      ['edge', 'gw', 'token verified', 'The edge or gateway checks the signature and expiry without any database call, then forwards the request.']],
      end: 'The waiting room converts an unbounded spike into a fixed admission rate the system was load-tested for, and makes the queue order explicit and fair.' },
    { name: 'View seats and hold', desc: 'An admitted fan picks two seats and gets an exclusive 8-minute hold.', steps: [
      ['gw', 'ev', 'GET seatmap section 112', 'The static layout comes from the CDN; the service only adds availability.'],
      ['ev', 'mc', 'GETRANGE bitmap', 'Availability is a bitmap in Redis, so 4,000 map refreshes a second never touch the database.'],
      ['mc', 'ev', '9 KB of bits', 'The client renders sold/held seats in grey. It may be a second or two stale: the hold is the real test.', 'resp'],
      ['gw', 'bk', 'POST hold [112-F-7, 112-F-8]', 'All-or-nothing request with an idempotency key; the booking service also checks the 4-ticket purchase limit.'],
      ['bk', 'sdb', 'conditional UPDATE 2 seats', 'UPDATE event_seat SET status HELD, hold_id, expires now+8 min WHERE seat in (...) AND (status AVAILABLE or hold expired). The transaction commits only if exactly 2 rows changed.'],
      ['sdb', 'bk', '2 rows updated', 'Both seats are now exclusively held. No lock is held after commit: the status column itself is the lock.', 'resp'],
      ['bk', 'mc', 'SETBIT 2 seats', 'Update the cached map so other shoppers stop clicking these seats.'],
      ['bk', 'u', '201 hold H, expires 10:18:30', 'The checkout page shows a countdown timer.', 'resp']],
      end: 'The database enforces exclusivity with a single conditional statement; the cache only makes the UI accurate enough to avoid wasted attempts.' },
    { name: 'Pay within the hold window', desc: 'The fan pays; seats become SOLD and tickets are issued asynchronously.', steps: [
      ['u', 'gw', 'POST /holds/H/purchase', 'The client sends the payment method token (card data never touches these servers).'],
      ['gw', 'bk', 'purchase H', 'Routed to the booking service.'],
      ['bk', 'sdb', 'HELD to PAYING (+2 min)', 'Mark the hold as paying and extend its expiry slightly, so the sweeper cannot release seats while the PSP is still deciding.'],
      ['bk', 'pay', 'authorise, idem key = H', 'The hold id is the idempotency key: a retry after a timeout returns the original result instead of charging again.'],
      ['pay', 'psp', 'auth + 3-D Secure', 'Card authorisation, possibly with a strong customer authentication challenge.'],
      ['psp', 'pay', 'approved', 'Money is authorised.', 'resp'],
      ['bk', 'sdb', 'SOLD + tickets + outbox', 'One transaction: seats to SOLD where hold_id = H, insert tickets (UNIQUE event, seat), insert order and an outbox event.'],
      ['sdb', 'bus', 'TicketsIssued', 'The outbox relay publishes the event at least once.', 'async'],
      ['bus', 'tk', 'generate QR + wallet pass', 'Rotating barcodes and email/app delivery happen off the critical path.', 'async'],
      ['bk', 'u', 'order confirmed', 'The fan sees success in about a second.', 'resp']],
      end: 'Seats move AVAILABLE to HELD to PAYING to SOLD with guarded updates, and payment is idempotent on the hold id.' },
    { name: 'Two fans, one seat', desc: 'Two admitted fans click 112-F-7 in the same millisecond.', steps: [
      { par: [['u', 'gw', 'hold F-7 (fan A)'], ['u', 'gw', 'hold F-7 (fan B)']], msg: 'Both see the seat as available in their (slightly stale) map and request it at the same time.' },
      { par: [['gw', 'bk', 'fan A'], ['gw', 'bk', 'fan B']], msg: 'The requests may land on different booking pods; nothing in the application coordinates them.' },
      ['bk', 'sdb', 'two conditional UPDATEs', 'The database serialises the two updates on the same row. The first sets HELD; the second re-evaluates the WHERE clause and finds the seat no longer available.'],
      ['sdb', 'bk', 'fan A: 1 row', 'Fan A wins the seat.', 'resp'],
      ['sdb', 'bk', 'fan B: 0 rows', 'Fan B’s transaction rolls back; none of fan B’s other seats in the request stay held (all-or-nothing).', 'err'],
      ['bk', 'u', '409 + best alternatives', 'Fan B immediately gets an offer of the best available adjacent pair instead of a dead end.', 'err']],
      end: 'Correctness comes from the database, not from timing: there is no window in which both can win.' },
    { name: 'Hold expires, late payment', desc: 'A fan walks away, or pays just after the window closed.', steps: [
      ['sw', 'sdb', 'release WHERE expires < now', 'Every few seconds the sweeper releases expired holds in small batches (status back to AVAILABLE). Holds also self-expire logically: the hold condition accepts expired holds.'],
      ['sw', 'mc', 'clear bits', 'Released seats reappear on everyone’s map within seconds.'],
      ['psp', 'pay', 'late approval', 'Rare case: the PSP approves after the hold was already released and resold.', 'err'],
      ['bk', 'sdb', 'confirm WHERE hold_id = H', 'The confirm update matches 0 rows because the seats now belong to another hold.', 'err'],
      ['bk', 'pay', 'void authorisation', 'Compensation: void (or refund) the payment immediately and tell the fan.'],
      ['bk', 'u', 'sorry, seats released', 'Offer a fresh hold on similar seats if any remain.', 'err']],
      end: 'The PAYING state makes this rare; the guarded confirm plus automatic void makes it safe when it does happen.' }
  ],
  components: [
    ['Virtual waiting room', 'Queue numbers, randomised start, admission rate control, signed admission tokens; polls answered at the edge.'],
    ['CDN + WAF + bot management', 'Static seat-map layouts and event pages, bot scoring, challenge pages, IP/ASN reputation, DDoS absorption.'],
    ['API gateway', 'Verifies admission tokens, per-account and per-IP rate limits, routes to services.'],
    ['Event service', 'Event catalog, venues, price tiers, seat-map availability from cache.'],
    ['Booking service', 'Holds, purchase limits, confirm, release; all inventory state transitions.'],
    ['Seat inventory DB', 'Source of truth for seat status, holds, orders and tickets; sharded by event.'],
    ['Seat map cache', 'Redis bitmaps per section for fast availability reads.'],
    ['Hold sweeper', 'Releases expired holds and repairs cache drift.'],
    ['Payment service', 'Idempotent authorisation/void via PSPs, 3-D Secure.'],
    ['Ticket issuer', 'Generates rotating QR codes and wallet passes from TicketsIssued events.']
  ],
  deep: [
    ['Three ways to hold a seat', '<div class="table-wrap"><table><tr><th>Technique</th><th>How</th><th>Pros</th><th>Cons</th></tr><tr><td>Conditional update</td><td><code>UPDATE event_seat SET status=&#39;HELD&#39;, hold_id=:h, hold_expires_at=now()+interval &#39;8 min&#39; WHERE event_id=:e AND seat_id = ANY(:seats) AND (status=&#39;AVAILABLE&#39; OR (status=&#39;HELD&#39; AND hold_expires_at &lt; now()))</code>; commit only if rowcount = number of seats</td><td>No long locks, durable, auditable, expiry is just data</td><td>One DB round trip per hold; hot shard during onsales</td></tr><tr><td>Row lock</td><td><code>SELECT ... FOR UPDATE NOWAIT</code> (or <code>SKIP LOCKED</code> for best-available), then update</td><td>Easy to express complex checks</td><td>Locks held for the transaction; deadlocks if seats are locked in different orders (always sort seat ids)</td></tr><tr><td>Redis <code>SET NX EX</code></td><td><code>SET hold:e:seat h NX EX 480</code> per seat; a Lua script makes a multi-seat hold atomic</td><td>Very fast; TTL built in</td><td>Not the source of truth; failover can lose recent keys; must still write the final sale to the DB</td></tr></table></div><p>Whichever is used for holds, the <strong>UNIQUE (event_id, seat_id)</strong> constraint on the ticket table guarantees no double sale. For general admission, hold a quantity with <code>UPDATE ga_pool SET held = held + :n WHERE available - held &gt;= :n</code>, split into buckets if it gets hot.</p>'],
    ['The virtual waiting room', '<ul><li><strong>Numbering, not state:</strong> each arrival gets a signed ticket with a sequence number (Redis <code>INCR</code>). The only hot state is the "now serving" pointer, advanced by a controller at the configured admission rate.</li><li><strong>Fair start:</strong> everyone who arrived before the onsale is shuffled randomly at T0; after T0 it is FIFO. This removes the incentive to hammer refresh.</li><li><strong>Feedback control:</strong> the controller raises or lowers the admission rate based on booking-service latency, error rate and shoppers inside, keeping the back end at a tested load.</li><li><strong>Edge-served polls:</strong> status pages and the serving counter are cached at the CDN for a few seconds; tokens are verified statelessly.</li><li><strong>Expiry:</strong> admission tokens and holds both time out so idle shoppers make room for the next in line.</li></ul>'],
    ['Payment within the hold window', '<ul><li>Hold windows are short (5-10 minutes) and visible as a countdown.</li><li>On purchase, move the hold to <strong>PAYING</strong> with a small extension so a slow 3-D Secure challenge does not lose the seats mid-payment.</li><li>Use the <strong>hold id as the idempotency key</strong> with the PSP; on timeout, query the PSP before retrying.</li><li>The confirm step is guarded (<code>WHERE hold_id = :h AND status = &#39;PAYING&#39;</code>). If it fails, void the authorisation automatically.</li><li>Authorise and capture together for tickets (unlike retail) because delivery is immediate; refunds follow the event cancellation policy.</li></ul>'],
    ['Bot protection and fairness', '<ul><li><strong>Verified fan / presale codes:</strong> pre-registration with phone and account history, then invite codes for the onsale; this is the most effective single measure.</li><li><strong>Edge bot management:</strong> TLS and browser fingerprints, behavioural signals, IP/ASN reputation, invisible challenges, proof-of-work for suspicious clients.</li><li><strong>Limits everywhere:</strong> tickets per account, per card, per address and per device; one active hold per account per event.</li><li><strong>Token binding:</strong> admission tokens bound to the session and device so they cannot be farmed and shared.</li><li><strong>Post-sale review:</strong> cancel orders clustered on suspicious cards or addresses; non-transferable or price-capped resale reduces the scalper incentive.</li></ul>'],
    ['Seat maps at scale', '<p>The venue layout (thousands of seat coordinates) is static per configuration, so it is rendered once to SVG/JSON and served from the CDN with an immutable versioned URL. Only availability is dynamic: a bitmap per section in Redis, updated write-through when holds and sales commit, and rebuilt from the database if the cache is lost. Clients poll every few seconds or receive deltas over SSE. Best-available allocation runs server-side: scan the section bitmap for N adjacent free seats in preferred rows, then attempt a hold on them.</p>']
  ],
  scale: [
    '<strong>The real bottleneck is the hot event shard.</strong> Cap its load with the admission rate; give mega-events a dedicated shard and pre-warm connections and caches.',
    '<strong>Read amplification:</strong> seat maps, event pages and waiting-room status all come from CDN or Redis; the inventory DB sees only holds, confirms and sweeps.',
    '<strong>Many simultaneous onsales</strong> spread naturally across shards by event_id; a per-event waiting room isolates them from each other (bulkhead).',
    '<strong>Load testing is mandatory:</strong> rehearse at 2&times; the expected admission rate with realistic seat contention before every major onsale.',
    '<strong>Multi-region:</strong> browse and waiting room are global at the edge; the inventory for one event lives in one region (strong consistency), with a warm standby.'
  ],
  tradeoffs: [
    ['Where to hold', 'Database conditional update vs Redis SET NX', 'Database for the source of truth (durable, auditable); Redis holds only if the DB cannot keep up even behind a waiting room, and then the DB constraint still guards the sale.'],
    ['Hold duration', 'Long (15 min) vs short (5 min)', '~8 minutes: long enough for 3-D Secure, short enough that abandoned seats return quickly during an onsale.'],
    ['Queue order', 'Pure FIFO vs randomised start', 'Randomise pre-start arrivals, FIFO after: fairer and removes the refresh-storm incentive.'],
    ['Seat selection', 'Pick-your-seat vs best-available', 'Pick-your-seat for normal sales; switch big onsales to best-available, which reduces contention and failed holds dramatically.'],
    ['Seat map freshness', 'Push (SSE) vs poll', 'Poll every few seconds from cache is simpler and scales via CDN; SSE deltas for premium UX when connections are affordable.']
  ],
  failures: [
    ['Stampede at onsale time', 'Waiting room with fixed admission rate; edge-cached polls; load-shed with a friendly "you are in the queue" rather than errors.'],
    ['Booking pod crashes after hold, before reply', 'Idempotency key on the hold request returns the same hold on retry; otherwise the hold simply expires.'],
    ['Redis seat map cache lost', 'Rebuild bitmaps from the DB (one indexed scan per event); holds stay correct because the cache is advisory only.'],
    ['PSP slow or down', 'PAYING state extends the hold; fail over to a secondary PSP; void late approvals that cannot be confirmed.'],
    ['Inventory DB primary fails mid-onsale', 'Synchronous standby in another zone, automatic failover in under a minute; the waiting room pauses admissions until health recovers.'],
    ['Bots get through', 'Purchase limits, one hold per account, anomaly detection on cards/addresses, post-sale cancellation.']
  ],
  cloud: [['DNS', 'dns'], ['CDN, edge and waiting-room pages', 'cdn'], ['Bot and WAF rules', 'waf'], ['DDoS protection', 'ddos'], ['API gateway', 'apigw'], ['Services', 'k8s'], ['Seat inventory DB', 'sql'], ['Queue counters and seat bitmaps', 'cache'], ['Event search', 'search'], ['Seat map layouts', 'blob'], ['Ticket and order events', 'stream'], ['Hold sweeper', 'scheduler'], ['Payment processing', 'Stripe / Adyen / Worldpay (PSP)', 'Stripe / Adyen / Worldpay (PSP)'], ['Customer identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azMission', 'azp-queue-based-load-leveling', 'azp-throttling', 'azp-rate-limiting-pattern', 'azp-compensating-transaction', 'azp-cache-aside', 'azp-sharding'],
          aws: ['blShedding', 'awsWafAuto', 'awsLoadTest', 'awsDdbBest', 'blBackoff', 'awsCaching', 'awsSaga'] },
  questions: [
    ['How do you prevent double booking if two requests hit different servers?', 'The database decides: a conditional update on the seat row (status AVAILABLE or hold expired) can succeed for only one transaction, because the second re-evaluates the condition after the first commits. As a final guard the ticket table has UNIQUE (event_id, seat_id). No application-level lock or timing assumption is needed.'],
    ['Why not just use Redis SETNX for everything?', 'It is fast and has TTLs, but Redis is not a durable source of truth: an asynchronous failover can lose recently written keys, so two people could hold the same seat. Use it as an accelerator if needed, and always commit the sale to the database with its unique constraint.'],
    ['What if the user pays after the hold expired?', 'The confirm update is guarded by the hold id; if the seats were released and resold it matches zero rows, and the payment authorisation is voided automatically. The PAYING state with a short extension makes this rare.'],
    ['How do you size the admission rate?', 'From load tests: find the hold/confirm rate the hot shard and PSP sustain at target latency, divide by holds per shopper, and add margin. Then let a controller adjust it live based on latency and error rate.'],
    ['How do you handle general admission (no seat numbers)?', 'Treat the section as a counter: hold N with a conditional update on available - held &ge; N, exactly like e-commerce inventory, and split into buckets if the counter row becomes hot.'],
    ['How do you stop scalpers?', 'Verified fan pre-registration, tickets per account/card/address limits, bot management at the edge, admission tokens bound to devices, and cancelling suspicious orders after the sale. Non-transferable tickets remove much of the incentive.']
  ],
  related: ['ecommerce', 'hotel-booking', 'payment', 'rate-limiter', 'distributed-cache']
});

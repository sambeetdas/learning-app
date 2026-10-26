SD.renderCase({
  slug: 'ride-hailing',
  summary: 'A ride-hailing platform matches a rider who wants a car now with a nearby available driver, then tracks the trip until payment. Every online driver app reports its GPS position every ~4 seconds over a persistent WebSocket; a location service writes each position into an in-memory geo index (H3 hexagonal cells or geohashes in Redis) and onto a stream. When a rider requests a ride, a dispatch service looks up available drivers in the surrounding cells, ranks them by real road ETA (not straight-line distance), and offers the trip to the best driver with a short timeout and a lock so no driver gets two offers at once. A trip service drives a strict state machine with optimistic concurrency, a stream job computes surge multipliers per cell from supply and demand, an ETA service runs routing on a road graph with live traffic, and payment happens once at the end against an upfront quote.',
  examples: 'Uber (H3 was created at Uber; its dispatch system was famously rebuilt around a geospatial index and Ringpop sharding), Lyft, DiDi, Grab, Bolt, Ola; the same pattern powers food delivery (Uber Eats, DoorDash, Deliveroo) and courier dispatch.',
  functional: ['Riders see nearby cars and an ETA, get an upfront fare quote (with surge if applicable) and request a ride.', 'The system offers the request to a suitable nearby driver, who accepts or declines within ~15 s.', 'Both apps see each other’s live position and ETA during pickup and the trip.', 'Trip lifecycle: accept, arrive, start, complete, cancel (with rules and fees).', 'Payment is charged automatically at the end; drivers are paid out; receipts and ratings.'],
  nonFunctional: ['Match a rider to a driver within a few seconds (p95 under 5 s to the first offer).', 'Location freshness: positions in the index at most ~5-8 s old.', 'Never assign one driver to two trips, never charge a trip twice.', 'Highly available per city; a failure in one city or zone must not stop others.', 'Handle peaks of 3&times; average (Friday nights, concerts, rain).'],
  outOfScope: ['Map tile rendering and turn-by-turn navigation (see maps).', 'Driver onboarding, background checks and documents.', 'Pooled / shared rides optimisation (mentioned only briefly).', 'Payment internals and ledger (see payment).'],
  estimates: [
    ['Trips', '25 M/day &rArr; ~290/s average, ~900/s peak', 'Large global operator; peak 3&times; average'],
    ['Ride requests', '~1.3 k/s peak', '~1.5&times; trips (cancellations, no-driver retries)'],
    ['Drivers online at peak', '~1.5 M', 'Of ~5 M active drivers'],
    ['Location updates', '~375 k/s', '1.5 M drivers / one update every 4 s'],
    ['Location ingest bandwidth', '~37.5 MB/s (~300 Mbit/s)', '375 k &times; ~100 B (lat, lng, heading, speed, accuracy, ts, status)'],
    ['Location history', '~3.2 TB/day raw', '37.5 MB/s &times; 86,400 s; compressed and kept for receipts, disputes and ETA training'],
    ['Geo index size', '~300 MB', '1.5 M drivers &times; ~200 B: tiny, so sharding is for throughput and isolation, not memory'],
    ['WebSocket connections', '~3.5 M', '1.5 M drivers + ~2 M riders with the app open or on a trip'],
    ['Trip records', '~50 GB/day &rArr; ~18 TB/year', '25 M &times; ~2 KB (trip, state history, fare breakdown)'],
    ['ETA computations', '~35 k/s peak', '1.3 k requests &times; ~10 candidate drivers + ~20 k rider-app ETA and nearby-car queries']
  ],
  compute: [
    ['WebSocket gateways', '~27 nodes (9 per zone)', '3.5 M connections / ~200 k per node = 18; &times;1.5 so two zones can absorb a zone failure’s reconnects.'],
    ['Location service', '~24 &times; 8 vCPU', '375 k updates/s &times; ~0.2 ms CPU (decode, validate, index, publish) = 75 busy cores; at 60% &asymp; 125 cores &asymp; 16 instances; &times;1.5 for zone loss.'],
    ['Geo index (Redis)', '~16 shards (by city / region) + replicas', 'Each update is ~2-3 ops (update driver hash, move between cell sets when the cell changes) plus matching reads &asymp; 1 M ops/s; at ~80 k ops/s target per shard &rArr; 13, rounded up to 16 aligned with city groups.'],
    ['Dispatch', '~10 &times; 8 vCPU, partitioned by city', '1.3 k requests/s &times; ~20 ms CPU (candidate search, scoring, offer bookkeeping) = 26 busy cores. Latency, isolation per city and failover matter more than raw capacity.'],
    ['ETA service', '~18 &times; 16 vCPU / 64 GB', '35 k route queries/s &times; ~3 ms on a contraction-hierarchy graph = 105 busy cores; at 60% &asymp; 175 cores &asymp; 12 instances, &times;1.5 for zone loss; each holds its region’s road graph (~10-20 GB) in memory.'],
    ['Trip database', 'Distributed SQL, ~6-9 nodes', '25 M trips &times; ~8 state transitions = 200 M writes/day &asymp; 2.3 k/s average, ~7 k/s peak: modest, but must be strongly consistent and multi-zone.']
  ],
  api: [
    ['WS driver → {type:"loc", lat, lng, heading, speed, accuracy, ts}', 'Every ~4 s while online (more often on a trip, less when idle and stationary). Batched and acknowledged cheaply.'],
    ['POST /v1/fares/estimate {pickup, dropoff, product}', 'Returns {quote_id, price, surge_multiplier, pickup_eta, expires_at}: an upfront price locked for a few minutes.'],
    ['POST /v1/trips {quote_id, pickup, dropoff, payment_method} + Idempotency-Key', 'Creates the trip in MATCHING state and starts dispatch; a retried request returns the same trip.'],
    ['WS server → driver {type:"offer", trip_id, pickup, eta, fare, expires_in:15}', 'The offer to one driver at a time (or a small batch); the driver answers with accept/decline.'],
    ['POST /v1/trips/{id}/events {type: accept|arrived|start|complete|cancel, expected_state}', 'Every state change carries the state the client believes the trip is in, for optimistic concurrency.'],
    ['WS server → rider {type:"trip_update", status, driver_location, eta}', 'Live updates pushed to the rider during pickup and the trip.'],
    ['GET /v1/nearby?lat=&lng=&product=', 'Car icons and an ETA for the rider’s home screen; cached per cell for a few seconds.']
  ],
  data: [
    ['driver live state', 'Redis hash driver:{id}', 'lat, lng, h3 cell, status (offline, available, offered, on_trip), vehicle type, last_ts; TTL ~30 s so disconnected drivers drop out automatically.'],
    ['geo index', 'Redis sets cell:{h3_res9}:{product}', 'Driver ids per hexagon. Alternative: Redis GEO (geohash in a sorted set) with GEOSEARCH BYRADIUS. Sharded by city so lookups stay on one shard.'],
    ['trips', 'Distributed SQL (or sharded PostgreSQL), PK trip_id', 'rider_id, driver_id, status, version, pickup/dropoff, quote_id, fare, timestamps; trip_events table records every transition.'],
    ['fare quotes', 'KV with TTL', 'quote_id &rarr; price breakdown, surge multiplier, route estimate, expires_at (2-5 min).'],
    ['surge multipliers', 'Redis surge:{city}:{h3_res7}', 'Multiplier per cell, recomputed every ~30-60 s by the stream job, with TTL so stale surge disappears.'],
    ['location history', 'Wide-column (Cassandra) + data lake', 'Partition (driver_id, day) or (trip_id), clustering ts: used for receipts, disputes, safety, and ETA / traffic model training.'],
    ['offer locks', 'Redis key lock:driver:{id}', 'SET NX EX 20 when a driver is offered a trip, so dispatch never offers the same driver two trips in parallel.']
  ],
  dbChoice: [
    ['Live driver positions', 'In-memory geo index (Redis sets keyed by H3 cell, or Redis GEO)', '375 k writes/s of data that is worthless after a few seconds; queries are "who is in these cells". Memory is small, so speed and TTLs matter, not durability.', 'PostGIS or Elasticsearch geo queries: great for static places, too slow and write-heavy for positions that change every 4 s.'],
    ['Trips and state transitions', 'Distributed SQL / sharded relational', 'Money and assignments: needs transactions and conditional updates (UPDATE ... WHERE state = expected), strong consistency and auditability.', 'DynamoDB / Cosmos DB with conditional writes works too (Uber built Schemaless/Docstore on MySQL).'],
    ['Location history', 'Cassandra / data lake', 'Append-only, very high volume, time-ordered per driver or trip, rarely read.', 'Keeping it in Redis or SQL would be far too expensive.'],
    ['Road graph', 'In-memory graph in the ETA service, built offline', 'Routing needs microsecond edge lookups; contraction hierarchies are precomputed from map data and loaded at start-up.', 'A graph database is too slow for shortest-path queries at 35 k/s.']
  ],
  diagram: {
    nodes: [['driver', 'Driver app', 'mobile', 0, 0.5, 'GPS every 4 s'], ['rider', 'Rider app', 'mobile', 0, 2.5, 'request, track, pay'], ['gw', 'WS gateways', 'gw', 1, 1.5, 'WebSocket + REST'],
      ['loc', 'Location service', 'svc', 2, 0.3, 'ingest + index'], ['trip', 'Trip service', 'svc', 2, 2.7, 'state machine'], ['tdb', 'Trip DB', 'db', 1, 3.2, 'distributed SQL'],
      ['kafka', 'Location stream', 'stream', 3, 0, 'Kafka'], ['match', 'Dispatch', 'svc', 3, 1.5, 'match + offers'], ['geo', 'Geo index', 'cache', 4, 0.8, 'Redis: H3 cells'],
      ['eta', 'ETA service', 'svc', 4, 2.4, 'road graph + traffic'], ['surge', 'Surge job', 'worker', 5, 0, 'Flink per H3 cell'], ['price', 'Pricing', 'svc', 6, 1.0, 'quotes + surge'],
      ['pay', 'Payments', 'svc', 5, 3.2, 'charge + payout']],
    edges: [['driver', 'gw'], ['rider', 'gw'], ['gw', 'loc'], ['gw', 'trip'], ['loc', 'geo'], ['loc', 'kafka', '', 'async'], ['kafka', 'surge', '', 'async'], ['surge', 'price', 'multipliers'],
      ['trip', 'match'], ['match', 'geo'], ['match', 'eta'], ['match', 'gw', 'offer'], ['trip', 'price', 'quote'], ['trip', 'tdb'], ['trip', 'pay', 'charge'], ['trip', 'gw', 'updates']]
  },
  flows: [
    { name: 'Driver location ingestion', desc: 'What happens to each GPS ping from 1.5 million driver phones.', steps: [
      ['driver', 'gw', 'loc {lat, lng, ts} every 4 s', 'The driver app sends a small frame over its open WebSocket. A persistent connection avoids a TLS handshake per update and lets the server push offers back instantly.'],
      ['gw', 'loc', 'batched updates', 'Gateways batch frames per city and forward them; obviously bad fixes (accuracy > 100 m, impossible speed) are dropped.'],
      ['loc', 'geo', 'HSET driver + move cell', 'Compute the H3 res-9 cell (~200 m hexagon). If it changed, SREM from the old cell set and SADD to the new one; refresh the driver hash and its 30 s TTL.'],
      ['loc', 'kafka', 'publish position', 'The same update goes to the stream for surge, traffic estimation, trip tracking and history.', 'async'],
      ['kafka', 'surge', 'supply per cell', 'The surge job counts available drivers per cell over a sliding window.', 'async'],
      ['loc', 'gw', 'forward to rider (on trip)', 'If the driver is on a trip or en route, the position is also pushed to that rider’s connection.'],
      ['gw', 'rider', 'car moves on the map', 'The rider app interpolates between updates so the car glides smoothly instead of jumping every 4 s.', 'resp']],
      end: 'Positions live in memory with TTLs: cheap to overwrite 375 k times a second, and a driver who disappears simply expires out of the index.' },
    { name: 'Request a ride and match', desc: 'A rider asks for a car; dispatch finds and offers the best driver.', steps: [
      ['rider', 'gw', 'POST /fares/estimate', 'The rider enters a destination.'],
      ['trip', 'price', 'quote (surge 1.3×)', 'Pricing computes distance and time from the ETA service, applies the surge multiplier of the pickup cell, and stores a quote valid for a few minutes.'],
      ['rider', 'gw', 'POST /trips {quote_id}', 'The rider confirms; the idempotency key protects against double taps.'],
      ['trip', 'tdb', 'INSERT status = MATCHING', 'The trip exists durably before any driver is contacted.'],
      ['trip', 'match', 'find a driver', 'Dispatch for this city takes over.'],
      ['match', 'geo', 'cells within k = 2 rings', 'Read available drivers in the pickup cell and its neighbours (gridDisk); widen the ring if fewer than ~10 candidates.'],
      ['match', 'eta', 'ETA matrix 10 → pickup', 'Rank by real driving time, not crow-flies distance: the closest car may be across a river or on the wrong side of a motorway.'],
      ['match', 'gw', 'offer to best driver (15 s)', 'Lock the driver (SET lock NX EX 20) and push the offer over their WebSocket.'],
      ['driver', 'gw', 'accept', 'The driver taps accept.'],
      ['gw', 'trip', 'MATCHING → ACCEPTED', 'Conditional update: only succeeds if the trip is still MATCHING (the rider might have cancelled). The rider is notified with driver, car and ETA.']],
      end: 'Geo index for candidates, ETA for ranking, locks for exclusivity and a conditional state change for correctness.' },
    { name: 'Trip lifecycle and payment', desc: 'From pickup to receipt.', steps: [
      ['driver', 'gw', 'arrived', 'The driver reaches the pickup point (also checked against GPS).'],
      ['gw', 'trip', 'ACCEPTED → ARRIVED', 'State change with expected_state; the rider gets "your driver is here" and the free waiting timer starts.'],
      ['driver', 'gw', 'start trip', 'The rider is in the car.'],
      ['gw', 'trip', 'ARRIVED → IN_PROGRESS', 'The driver’s status in the geo index becomes on_trip, so dispatch will not consider them.'],
      ['loc', 'kafka', 'route trace', 'GPS points for the trip are recorded for the receipt, safety features and disputes.', 'async'],
      ['driver', 'gw', 'complete', 'Drop-off.'],
      ['trip', 'tdb', 'IN_PROGRESS → COMPLETED', 'Final distance, time and any adjustments (tolls, route changes) recorded with the fare.'],
      ['trip', 'pay', 'charge (key = trip_id)', 'Charge the saved payment method for the quoted price. Using the trip id as idempotency key means a retry can never charge twice; driver earnings are credited in the same ledger transaction.'],
      ['trip', 'gw', 'receipt + rating prompt', 'Both apps get the receipt; the driver becomes available again in the geo index.', 'resp']],
      end: 'An explicit state machine, with every transition conditional on the previous state, keeps two phones, a server and a payment provider in agreement.' },
    { name: 'Offer timeout and double-dispatch race', desc: 'The first driver ignores the offer; two requests compete for the same driver.', steps: [
      ['match', 'gw', 'offer to driver A', 'Driver A has the best ETA and is locked for this trip.'],
      ['gw', 'driver', 'no response in 15 s', 'Driver A is in a tunnel or ignores the offer.', 'err'],
      ['match', 'geo', 'release A, next candidate', 'The lock is released (or expires) and A’s acceptance rate is updated. The next candidate is driver B.'],
      ['match', 'geo', 'SET lock:B NX: fails', 'Another trip’s dispatcher just locked B, so this request moves on instead of double-offering B.', 'err'],
      ['match', 'geo', 'SET lock:C NX: ok', 'Driver C is locked for this trip.'],
      ['match', 'gw', 'offer to driver C', 'Offer pushed.'],
      ['driver', 'gw', 'accept', 'Driver C accepts.'],
      ['gw', 'trip', 'CAS MATCHING → ACCEPTED', 'The conditional update succeeds. Had the rider cancelled meanwhile, it would fail and C would be released with a short explanation.']],
      end: 'Short leases on drivers plus compare-and-set on trips make dispatch safe even with many matchers working in parallel.' }
  ],
  components: [
    ['WebSocket gateways', 'Persistent connections to driver and rider apps; push offers and trip updates; forward location frames.'],
    ['Location service', 'Validates and indexes positions into H3 cells, publishes them to the stream, forwards to riders on trips.'],
    ['Geo index', 'In-memory driver positions and availability by cell, with TTLs and offer locks.'],
    ['Dispatch', 'Candidate search, ETA-based ranking, offers with timeouts and locks; batched matching in busy areas.'],
    ['Trip service', 'Trip state machine with conditional transitions, cancellations and fees, notifications.'],
    ['Pricing and surge', 'Upfront quotes; stream job computing supply/demand per H3 cell and smoothed surge multipliers.'],
    ['ETA service', 'Shortest-path routing on a road graph with live traffic speeds and ML corrections.'],
    ['Payments', 'Charges riders, credits drivers, idempotent per trip, refunds and disputes (see payment).']
  ],
  deep: [
    ['Geo index: H3 cells vs geohash', '<p>Both turn a 2-D position into a cell id that can be used as a key. <strong>Geohash</strong> interleaves latitude and longitude bits into a base-32 string; nearby points usually share a prefix, but cells are rectangles that distort with latitude and neighbours across a prefix boundary have very different strings. <strong>H3</strong> (from Uber) tiles the earth with hexagons in 16 resolutions; every hexagon has six neighbours at the same distance, which makes "cells within k rings" (<code>gridDisk</code>) and smooth surge maps natural.</p><table><tr><th>H3 res</th><th>Avg area</th><th>Avg edge</th><th>Typical use</th></tr><tr><td>7</td><td>~5.2 km&sup2;</td><td>~1.4 km</td><td>Surge zones</td></tr><tr><td>8</td><td>~0.74 km&sup2;</td><td>~530 m</td><td>Demand forecasting</td></tr><tr><td>9</td><td>~0.11 km&sup2;</td><td>~200 m</td><td>Driver index, pickup search</td></tr><tr><td>10</td><td>~0.015 km&sup2;</td><td>~75 m</td><td>Pickup spots</td></tr></table><p>Implementation: <code>SADD cell:{res9}:{product} driver_id</code>, moving drivers between sets only when their cell changes (most 4 s updates stay in the same 200 m cell). Search reads the pickup cell plus 1-3 rings (7, 19, 37 cells). Redis GEO (<code>GEOSEARCH ... BYRADIUS</code>, geohash scores in a sorted set) is a simpler alternative for a single city.</p>'],
    ['Matching and dispatch', '<p><strong>Greedy</strong>: for each request, pick the available driver with the lowest ETA. Simple and fast, but locally optimal choices can be globally poor (taking the only driver near the airport for a rider who had other options).</p><p><strong>Batched matching</strong>: collect requests and available drivers in an area for 1-2 s, build a cost matrix of ETAs (plus factors like driver rating, acceptance rate, destination preferences), and solve the assignment problem (Hungarian algorithm or a min-cost flow) to minimise total pickup time. Uber, Lyft and DiDi all use variants in dense areas. Other rules: offer to one driver at a time with a 10-15 s timeout, lock offered drivers, consider drivers about to finish a trip nearby ("forward dispatch"), and partition dispatch by city so one city’s load cannot affect another (a natural <a href="../saas-platform/index.html">cell / stamp</a> boundary).</p>'],
    ['Trip state machine', '<pre><code>REQUESTED -&gt; MATCHING -&gt; ACCEPTED -&gt; ARRIVED -&gt; IN_PROGRESS -&gt; COMPLETED -&gt; PAID\n     |           |           |          |\n     +-----------+-----------+----------+--&gt; CANCELLED (by rider / driver / system)\n                 +--&gt; NO_DRIVERS (after N attempts or a timeout)</code></pre><p>Every transition is a conditional write: <code>UPDATE trips SET state=\'ARRIVED\', version=version+1 WHERE id=:id AND state=\'ACCEPTED\' AND version=:v</code>. If zero rows change, someone else moved the trip first (for example the rider cancelled at the same moment) and the caller re-reads. Each transition is also appended to <code>trip_events</code> and published, so notifications, payments and analytics react to events rather than polling. Cancellation fees, waiting-time charges and timeouts are timers attached to states.</p>'],
    ['Surge pricing', '<p>A stream job (Flink) keeps, per H3 res-7 cell and a 1-5 minute sliding window, <strong>supply</strong> (available drivers, plus drivers about to drop off nearby) and <strong>demand</strong> (requests and app opens with a destination). The multiplier is a function of demand/supply, smoothed over time and across neighbouring cells so prices do not flicker or jump at cell borders, capped by policy and regulation. Multipliers are written to Redis with a TTL and read by pricing when it creates a quote; the quote locks the price, so a surge change after the rider confirms does not affect them. Surge also feeds driver heat maps to pull supply into busy areas.</p>'],
    ['ETA service', '<p>ETAs drive ranking, quotes and rider expectations. The road network is a weighted directed graph (from OpenStreetMap or a commercial map) with edge weights equal to current travel time. Plain Dijkstra is too slow for continental graphs, so the graph is preprocessed with <strong>contraction hierarchies</strong> (or customisable route planning, which allows fast weight updates) and answers queries in about a millisecond. Live speeds come from map-matched GPS traces of drivers on the road. An ML model then corrects the routing engine’s estimate using time of day, weather, pickup difficulty and historical error. See <a href="../maps/index.html">maps and navigation</a>.</p>']
  ],
  scale: [
    '<strong>Partition by geography:</strong> cities (or groups of cells) are independent. Shard the geo index, dispatch and surge per city/region so a big event in one city cannot slow another.',
    '<strong>Location write volume:</strong> send updates less often when idle and stationary, batch at gateways, and only move cell membership when the cell changes.',
    '<strong>Hot cells:</strong> a stadium emptying creates thousands of requests in a few cells. Batched matching, queueing riders with honest ETAs, surge to attract drivers, and designated pickup zones.',
    '<strong>Connection storms:</strong> after a network or gateway incident millions of apps reconnect; use jittered backoff and pre-sized gateway capacity per zone.',
    '<strong>Global footprint:</strong> run regional deployments close to each market (latency and data residency); trip data stays in region, aggregated analytics are global.'
  ],
  tradeoffs: [
    ['Spatial index', 'H3 hexagons vs geohash vs quadtree', 'H3: uniform neighbours and a hierarchy suited to both driver search and surge maps; geohash is fine for simple radius search (Redis GEO).'],
    ['Matching strategy', 'Greedy nearest vs batched global assignment', 'Greedy when supply is plentiful (fastest); batched windows of 1-2 s in dense areas reduce total wait time noticeably.'],
    ['Update interval', '1 s vs 4 s vs 10 s', '~4 s: fresh enough for matching and smooth maps with interpolation, at a quarter of the cost of 1 s; adaptive based on speed and status.'],
    ['Distance metric', 'Straight-line vs road ETA', 'Straight-line only to pre-filter candidates; rank by road ETA because rivers, one-way streets and motorways matter.'],
    ['Pricing', 'Metered fare vs upfront quote', 'Upfront quote locked at request time: clearer for riders and simpler payment; adjust only for big route changes.']
  ],
  failures: [
    ['Driver app loses connectivity', 'The driver hash TTL expires and they drop out of matching; on a trip, the trip continues and positions are back-filled from the phone buffer when it reconnects.'],
    ['Geo index shard fails', 'Replica promoted; even a cold index refills within one update interval (~4 s) because every driver re-reports.'],
    ['Dispatch instance for a city crashes', 'Another instance takes over the city partition (leader election / consistent hashing); in-flight trips are in MATCHING in the DB and are resumed.'],
    ['Two dispatchers pick the same driver', 'Driver lock with SET NX and short TTL; trip acceptance is a compare-and-set, so at most one trip can be accepted.'],
    ['Payment provider times out', 'Retry with the trip id as idempotency key; the trip is COMPLETED, PAID follows asynchronously; failed charges go to collections without blocking the driver payout.'],
    ['ETA service slow', 'Fall back to cached cell-to-cell travel-time matrices or straight-line distance &times; city speed factor, with a wider error margin.']
  ],
  cloud: [['DNS', 'dns'], ['Connection load balancing', 'lb'], ['WebSocket gateways (managed option)', 'realtime'], ['Services', 'k8s'], ['Geo index, locks, surge map', 'cache'], ['Location stream', 'stream'], ['Surge and traffic aggregation', 'streamproc'], ['Trips', 'distsql'], ['Location history', 'widecol'], ['Maps, geocoding, routing data', 'maps'], ['ETA models', 'ml'], ['Push notifications', 'push'], ['Analytics', 'warehouse'], ['Identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-deployment-stamp', 'azEventDriven', 'azPartition', 'azStreamDbx', 'azp-publisher-subscriber', 'azp-saga', 'azAksMicro'],
          aws: ['awsPubSub', 'awsSaga', 'blShuffle', 'blStatic', 'blShedding', 'awsDdbBest', 'awsMicro'] },
  questions: [
    ['Why not store driver locations in the main database?', 'Positions change every 4 s for 1.5 M drivers (375 k writes/s) and are useless after seconds. An in-memory index with TTLs handles that cheaply; the database only stores durable facts (trips, payments). History goes to an append-only store asynchronously.'],
    ['How do you find drivers near a rider quickly?', 'Convert the pickup to an H3 cell, read the driver sets for that cell and its k-ring neighbours (7 or 19 cells), filter by status and vehicle type, then compute road ETAs for the best ~10 and pick the lowest. Widen the ring if there are too few candidates.'],
    ['How do you guarantee a driver is not assigned to two trips?', 'A short-lived lock per driver taken with SET NX before offering, and a compare-and-set on the trip state at acceptance. Even if a lock expires early, a driver cannot be ACCEPTED on two trips because the driver’s own state is also transitioned conditionally.'],
    ['How would you design surge so it is fair and stable?', 'Compute supply and demand per H3 res-7 cell over sliding windows, smooth over time and neighbouring cells, cap multipliers, and lock prices in upfront quotes. Explain surge in the app and use it to steer drivers toward demand.'],
    ['What changes for shared (pool) rides?', 'Matching becomes a vehicle-routing problem: insert a new rider into existing routes if the detour for current passengers stays within limits. Candidates are drivers on compatible routes, scored by added time; batching windows are longer.'],
    ['How do you handle a city-wide outage of the matching cell?', 'Cells are isolated per region with their own capacity; a standby in another zone takes over the partition. Apps retry with backoff, and trips already in progress continue because the driver app can complete them offline and sync later.']
  ],
  related: ['proximity', 'maps', 'payment', 'notification', 'chat']
});

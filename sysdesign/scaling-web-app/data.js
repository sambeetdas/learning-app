SD.renderCase({
  slug: 'scaling-web-app',
  summary: 'Almost every large system started as one server. This design walks the classic path from a single machine to a multi-region platform serving 10 million users, adding each component only when a specific bottleneck forces it: separate the database, add a load balancer and more stateless web servers, cache hot data, add read replicas, push static files to a CDN, move slow work to queues, and finally go multi-region. Every later case study builds on these moves.',
  examples: 'Any SaaS product, online store, content site or mobile app back end; this is the shape of the Azure "baseline zone-redundant web application" and of most AWS three-tier reference architectures.',
  functional: ['Users sign up, log in and browse pages (a typical CRUD web application, e.g. an online store).', 'Users create and update content (orders, posts, profiles).', 'Static assets (images, JS, CSS) load fast worldwide.', 'Background jobs: emails, thumbnails, reports.'],
  nonFunctional: ['Grow from 100 to 10 million users without a rewrite.', '99.9% to 99.99% availability; survive the loss of a server, a zone, eventually a region.', 'p95 page latency under 300 ms.', 'Cost grows roughly linearly with traffic.', 'Deploy many times a day without downtime.'],
  outOfScope: ['Specific business logic.', 'Real-time features (see chat, live streaming).'],
  estimates: [
    ['Daily active users (DAU)', '1 million (of 10 M registered)', '10% of registered users active daily'],
    ['Requests per user per day', '50 page/API requests', 'Typical browsing session'],
    ['Average QPS', '~580 req/s', '1 M &times; 50 / 86,400 s'],
    ['Peak QPS', '~3,000 req/s', '5&times; the average (evening peaks, campaigns)'],
    ['Read : write ratio', '~10 : 1', 'Browsing dominates'],
    ['Write QPS at peak', '~300 writes/s', '10% of peak'],
    ['Database size', '~500 GB in year one', '10 M users &times; 50 KB (profiles, orders, content rows)'],
    ['Static/media storage', '~10 TB', 'Images and uploads; served via CDN'],
    ['Egress bandwidth', '~1.5 Gbit/s peak', '3,000 req/s &times; ~60 KB average response (most media comes from the CDN)']
  ],
  compute: [
    ['Web/API servers', '~8 instances of 4 vCPU at peak; deploy 12 across 3 zones', 'Peak ~2,900 req/s &times; ~20 ms CPU = ~58 busy cores without a cache. With an 80% cache hit rate (a hit costs ~2 ms) the average drops to ~6 ms &rArr; ~18 busy cores &rArr; ~31 cores at 60% utilisation &rArr; 8 &times; 4 vCPU. To survive losing one of three zones, the other two must carry everything: 4 per zone = 12. (Try the <a href="../estimation/index.html#calculator">calculator</a> with the "online store" preset.)'],
    ['Cache', '2-3 nodes &times; 13 GB', 'Hot set: 20% of 500 GB is too big; cache only hot pages/objects (~10-20 GB) with replicas for availability.'],
    ['Primary database', '1 &times; 8-16 vCPU, 64 GB RAM, zone-redundant standby', '300 writes/s and a working set of tens of GB fit one well-sized relational server; most reads go to cache or replicas.'],
    ['Read replicas', '2 replicas', 'Absorb cache misses (~600 reads/s at 80% hit rate) and analytics queries.'],
    ['Workers', '2-4 small instances, autoscaled on queue depth', 'Bursty background jobs; scale on backlog, not CPU.']
  ],
  api: [
    ['GET /products?page=&q=', 'Browse/search; cacheable for anonymous users (Cache-Control: public, s-maxage=60).'],
    ['GET /products/{id}', 'Product page; served from cache, falls back to a read replica.'],
    ['POST /orders', 'Create an order; idempotency key header so retries do not double-charge.'],
    ['POST /auth/login', 'Returns a session token (JWT or opaque); the session lives in the cache, not on a server.'],
    ['POST /uploads (pre-signed URL)', 'The client uploads directly to object storage (valet key pattern), not through the web tier.']
  ],
  data: [
    ['users, orders, products', 'Relational database (primary + replicas)', 'Strong consistency, transactions, joins; indexed by id and by common filters.'],
    ['sessions, hot objects', 'Redis cache', 'TTL-based; session token &rarr; user id, product:id &rarr; JSON.'],
    ['images, uploads', 'Object storage + CDN', 'Immutable keys (content hash in the name) so CDN caching never serves stale files.'],
    ['jobs', 'Message queue', 'Email, thumbnail and report tasks with retry and dead-letter queues.']
  ],
  dbChoice: [
    ['Core business data', 'Relational (PostgreSQL / SQL Server / MySQL)', 'Structured data with relationships and transactions (an order and its line items commit together). One node handles thousands of writes/s.', 'NoSQL document store: only if the schema is very fluid or you need global multi-write from day one.'],
    ['Sessions and hot reads', 'In-memory key-value (Redis)', 'Sub-millisecond reads, TTLs, shared by all web servers so they stay stateless.', 'Sticky sessions on the load balancer: simpler, but a server failure logs users out and load is uneven.'],
    ['Files', 'Object storage', 'Cheap, durable (11 nines), unlimited, and directly served by the CDN.', 'Storing blobs in the database bloats backups and slows queries.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'client', 0, 1.4, 'browser / mobile'], ['dns', 'DNS', 'dns', 1, 0], ['edge', 'Global LB + WAF', 'edge', 2, 1.4, 'TLS, DDoS, routing'],
      ['cdn', 'CDN', 'cdn', 1, 2.8, 'static files'], ['blob', 'Object storage', 'blob', 2, 2.8, 'images, uploads'], ['lb', 'Load balancer', 'lb', 3, 1.4, 'health checks'],
      ['a', 'App servers', 'svc', 4, 0.7, 'zone A (stateless)'], ['b', 'App servers', 'svc', 4, 2.1, 'zone B (stateless)'], ['cache', 'Cache', 'cache', 5, 0, 'Redis'],
      ['db', 'Primary DB', 'db', 6, 2.1, 'writes'], ['rep', 'Read replica', 'db', 6, 0.9, 'reads'], ['q', 'Job queue', 'queue', 5, 3.6], ['wk', 'Workers', 'worker', 6, 3.1, 'emails, thumbnails']],
    edges: [['u', 'dns'], ['u', 'edge'], ['u', 'cdn'], ['cdn', 'blob'], ['edge', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'cache'], ['b', 'cache'], ['a', 'db'], ['b', 'db'], ['b', 'rep'],
      ['db', 'rep', 'replication', 'async'], ['b', 'q', '', 'async'], ['q', 'wk', '', 'async'], ['wk', 'blob'], ['wk', 'db']]
  },
  flows: [
    { name: 'Page view (cache hit)', desc: 'The common case: a product page read that never touches the database.', steps: [
      ['u', 'dns', 'resolve shop.com', 'The browser resolves the domain. DNS answers with the anycast address of the global load balancer (cached for minutes).'],
      ['u', 'edge', 'GET /products/42', 'HTTPS reaches the nearest edge location; TLS is terminated close to the user and the WAF filters bad traffic.'],
      ['edge', 'lb', 'forward', 'The edge forwards to the healthiest region and its regional load balancer.'],
      ['lb', 'a', 'route', 'The load balancer picks a healthy app server (least connections). Any server can handle any request because no session lives on it.'],
      ['a', 'cache', 'GET product:42', 'The app checks the cache first (cache-aside).'],
      ['cache', 'a', 'hit (0.5 ms)', 'Cache hit: no database query needed.', 'resp'],
      ['a', 'u', '200 OK (HTML/JSON)', 'Response returns to the user; total server time a few milliseconds.', 'resp'],
      { par: [['u', 'cdn', 'GET /img/42.webp'], ['cdn', 'blob', 'origin fetch (rare)']], msg: 'Images and scripts come from the CDN; only the first request in each region reaches object storage.' }],
      end: 'Most traffic is absorbed by the CDN and the cache; the database only sees cache misses and writes.' },
    { name: 'Cache miss', desc: 'What happens the first time an object is requested (or after it expires).', steps: [
      ['u', 'edge', 'GET /products/77', 'A request for a product that is not cached.'], ['edge', 'lb', 'forward', 'Routed as before.'], ['lb', 'b', 'route', 'Lands on a server in zone B.'],
      ['b', 'cache', 'GET product:77', 'Check the cache.'], ['cache', 'b', 'miss', 'Not there.', 'err'],
      ['b', 'rep', 'SELECT ... WHERE id=77', 'Read from a replica, keeping load off the primary.'], ['rep', 'b', 'row', 'A few milliseconds.', 'resp'],
      ['b', 'cache', 'SET product:77 TTL 300s', 'Populate the cache so the next request is a hit.'], ['b', 'u', '200 OK', 'Respond.', 'resp']],
      end: 'Replica reads can be slightly stale (replication lag of milliseconds to seconds): fine for a product page, not for "show me the order I just placed".' },
    { name: 'Write + background job', desc: 'Placing an order: the write goes to the primary; slow work is queued.', steps: [
      ['u', 'edge', 'POST /orders (Idempotency-Key)', 'The client sends the order with an idempotency key so a retry cannot create a duplicate.'],
      ['edge', 'lb', 'forward', 'Routed to the region.'], ['lb', 'b', 'route', 'Any healthy app server.'],
      ['b', 'db', 'BEGIN; INSERT order...; COMMIT', 'All writes go to the primary in one transaction.'],
      ['db', 'rep', 'replicate', 'The change streams to the replica asynchronously.', 'async'],
      ['b', 'cache', 'DEL user:9:orders', 'Invalidate cached data that just changed.'],
      ['b', 'q', 'enqueue send-receipt', 'Sending the email is slow and can fail: put it on a queue instead of doing it in the request.', 'async'],
      ['b', 'u', '201 Created', 'The user gets a fast response.', 'resp'],
      ['q', 'wk', 'deliver job', 'A worker picks up the job (and retries on failure, with a dead-letter queue after N attempts).', 'async'],
      ['wk', 'blob', 'store PDF receipt', 'Generate and store the receipt.'], ['wk', 'db', 'mark receipt_sent', 'Record completion.']],
      end: 'Queues decouple the user-facing path from slow or unreliable work, and let workers scale independently.' },
    { name: 'Zone failure', desc: 'One availability zone goes dark. The design is "statically stable": it keeps serving without emergency changes.', steps: [
      ['lb', 'a', 'health check fails', 'Zone A app servers stop answering health checks.', 'err'],
      ['lb', 'b', 'all traffic to zone B', 'The load balancer removes zone A from rotation within seconds. Zone B was sized to carry the full load (N+1 capacity).'],
      ['db', 'rep', 'failover: promote standby', 'If the primary was in zone A, the zone-redundant standby is promoted automatically (typically under a minute).', 'err'],
      ['b', 'db', 'reconnect to new primary', 'Apps reconnect through the same DNS name / endpoint; in-flight requests are retried with backoff.'],
      ['u', 'edge', 'users keep shopping', 'Users see, at worst, a few slow or retried requests.', 'resp']],
      end: 'Redundancy at every layer plus health checks turns a zone outage into a non-event.' }
  ],
  components: [
    ['DNS + global load balancer / WAF', 'Route users to the closest healthy region, terminate TLS at the edge, block attacks.'],
    ['CDN + object storage', 'Serve static files and media from the edge; offload the vast majority of bytes.'],
    ['Regional load balancer', 'Spread requests across app servers in several zones; remove unhealthy instances.'],
    ['Stateless app tier', 'Business logic; autoscaled on CPU/requests; sessions kept in the cache, not in memory.'],
    ['Cache', 'Hot reads and sessions; turns most reads into sub-millisecond lookups.'],
    ['Primary DB + replicas', 'Source of truth for writes; replicas serve reads and analytics.'],
    ['Queue + workers', 'Background work outside the request path.']
  ],
  evolutionTitle: 'The journey: from one server to multi-region',
  evolution: [
    { name: '1. Single server', desc: 'Everything on one machine: web server, app and database. Perfect for the first few hundred users.', diagram: { nodes: [['u', 'Users', 'client', 0, 0], ['s', 'One server', 'svc', 1.5, 0, 'web + app + DB']], edges: [['u', 's']] },
      steps: [['u', 's', 'HTTP', 'All requests hit one box. Simple and cheap, but it is a single point of failure and cannot scale past one machine.'], ['s', 'u', 'response', 'If it reboots, the site is down.', 'resp']] },
    { name: '2. Separate DB', desc: 'Move the database to its own (managed) server so web and data tiers scale independently.', diagram: { nodes: [['u', 'Users', 'client', 0, 0], ['s', 'Web server', 'svc', 1.5, 0], ['db', 'Database', 'db', 3, 0, 'managed SQL']], edges: [['u', 's'], ['s', 'db']] },
      steps: [['u', 's', 'HTTP', 'Requests hit the web server.'], ['s', 'db', 'SQL', 'The app talks to a managed database with automated backups and patching.'], ['db', 's', 'rows', 'Each tier can now be sized separately.', 'resp']] },
    { name: '3. Load balancer', desc: 'Add more web servers behind a load balancer. This requires stateless servers: move sessions to a shared store.', diagram: { nodes: [['u', 'Users', 'client', 0, 1], ['lb', 'Load balancer', 'lb', 1, 1], ['a', 'Web 1', 'svc', 2, 0.4], ['b', 'Web 2', 'svc', 2, 1.6], ['c', 'Sessions', 'cache', 3, 0.4, 'Redis'], ['db', 'Database', 'db', 3, 1.6]], edges: [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'db'], ['b', 'db']] },
      steps: [['u', 'lb', 'HTTP', 'Users reach the load balancer.'], { par: [['lb', 'a', 'req 1'], ['lb', 'b', 'req 2']], msg: 'Requests spread over two servers; either can fail without an outage.' }, ['b', 'c', 'session lookup', 'Sessions live in a shared cache so any server can serve any user.'], ['b', 'db', 'query', 'Both servers share the database.']] },
    { name: '4. Cache + replicas', desc: 'Reads dominate. Add a cache for hot data and read replicas for the rest.', diagram: { nodes: [['lb', 'Load balancer', 'lb', 0, 1], ['a', 'App tier', 'svc', 1, 1, 'autoscaled'], ['c', 'Cache', 'cache', 2, 0], ['p', 'Primary', 'db', 3, 1], ['r', 'Replicas', 'db', 2, 2]], edges: [['lb', 'a'], ['a', 'c'], ['a', 'p'], ['a', 'r'], ['p', 'r', 'replication', 'async']] },
      steps: [['lb', 'a', 'request', 'Traffic arrives.'], ['a', 'c', 'GET (80-95% hit)', 'Most reads are answered by the cache.'], ['a', 'r', 'cache miss reads', 'Misses go to replicas.'], ['a', 'p', 'writes only', 'The primary only handles writes and must-be-fresh reads.'], ['p', 'r', 'replicate', 'Replicas follow the primary asynchronously.', 'async']] },
    { name: '5. CDN + queues', desc: 'Move static content to a CDN and slow work to queues.', diagram: { nodes: [['u', 'Users', 'client', 0, 1], ['cdn', 'CDN', 'cdn', 1, 0], ['o', 'Object storage', 'blob', 2, 0], ['lb', 'Load balancer', 'lb', 1, 1.5], ['a', 'App tier', 'svc', 2, 1.5], ['q', 'Queue', 'queue', 3, 1.5], ['w', 'Workers', 'worker', 4, 1.5]], edges: [['u', 'cdn'], ['cdn', 'o'], ['u', 'lb'], ['lb', 'a'], ['a', 'q', '', 'async'], ['q', 'w', '', 'async']] },
      steps: [['u', 'cdn', 'images, JS, CSS', 'Static bytes come from an edge location near the user.'], ['cdn', 'o', 'cache miss only', 'The origin is object storage, not your servers.'], ['u', 'lb', 'API calls', 'Only dynamic requests reach the app tier.'], ['a', 'q', 'enqueue job', 'Slow tasks are queued...', 'async'], ['q', 'w', 'process', '...and processed by workers that scale on queue depth.', 'async']] },
    { name: '6. Multi-region', desc: 'For global users and region-level disasters: run full stacks in two or more regions behind a global load balancer.', diagram: { nodes: [['u', 'Users', 'client', 0, 1], ['g', 'Global LB', 'edge', 1, 1, 'anycast + health'], ['a', 'Region A stack', 'svc', 2, 0.3], ['b', 'Region B stack', 'svc', 2, 1.7], ['da', 'DB region A', 'db', 3, 0.3], ['dbb', 'DB region B', 'db', 3, 1.7]], edges: [['u', 'g'], ['g', 'a'], ['g', 'b'], ['a', 'da'], ['b', 'dbb'], ['da', 'dbb', 'geo-replication', 'async']], zones: [['Region A', 2, 0.3, 3, 0.3], ['Region B', 2, 1.7, 3, 1.7]] },
      steps: [['u', 'g', 'request', 'Users connect to the nearest edge.'], ['g', 'a', 'nearest healthy region', 'Routed to the closest region by latency.'], ['a', 'da', 'local reads/writes', 'Each region serves locally.'], ['da', 'dbb', 'replicate', 'Data replicates across regions (async: a small window of possible data loss, RPO in seconds).', 'async'], ['g', 'b', 'failover if A is down', 'If region A fails its health checks, traffic shifts to B.', 'err']] }
  ],
  deep: [
    ['Stateless web tier', '<p>A server is stateless if it keeps nothing between requests that another server would need: no in-memory sessions, no local files. Store sessions in Redis or use signed tokens (JWT), keep uploads in object storage, and configuration in a config service. Then the load balancer can route anywhere, autoscaling can add/remove instances freely, and deployments can replace servers one by one.</p>'],
    ['Horizontal vs vertical scaling', '<p><strong>Vertical</strong> (a bigger machine) is simplest and often right early: a modern database server with 64+ cores and 512 GB RAM goes a long way. It has a ceiling and a single point of failure. <strong>Horizontal</strong> (more machines) is limitless for stateless tiers but requires load balancing and, for data, replication or sharding. Scale vertically until it hurts, then horizontally.</p>'],
    ['Database scaling ladder', '<ol><li>Indexes and query tuning (often 10-100&times;).</li><li>Bigger instance.</li><li>Cache in front.</li><li>Read replicas.</li><li>Functional split: separate databases per domain (orders, users, catalog).</li><li>Sharding by key when one primary cannot take the writes (see <a href="../data/index.html">data</a>).</li></ol>'],
    ['Deployments without downtime', '<p>Rolling deployments replace instances a few at a time behind the load balancer (drain connections first). Blue/green runs the new version beside the old and flips traffic. Canary releases send 1-5% of traffic to the new version and watch error rates before continuing. Database migrations must be backward compatible (expand, migrate, contract).</p>']
  ],
  scale: [
    '<strong>Where it breaks first:</strong> usually the database (too many connections, slow queries, write load). Use connection pooling (PgBouncer), indexes, caching and replicas.',
    '<strong>Autoscale on the right signal:</strong> CPU or requests per instance for web servers, queue length for workers. Keep a minimum count per zone for zone failures.',
    '<strong>Cache stampede</strong> when a hot key expires: use request coalescing / locks and staggered TTLs (see <a href="../caching/index.html">caching</a>).',
    '<strong>Beyond one region:</strong> latency for global users and regional disasters push you to multi-region with data replication; decide between active-passive (simpler) and active-active (conflict handling).',
    '<strong>Beyond one team:</strong> split the monolith along business domains into services only when team scaling or independent deployment demands it (see <a href="../architecture/index.html">architecture</a>).'
  ],
  tradeoffs: [
    ['Sessions', 'Sticky sessions vs shared session store vs stateless tokens', 'Shared store (Redis) or JWT: allows free load balancing and autoscaling. JWTs avoid a lookup but are hard to revoke; keep them short-lived.'],
    ['Read replicas', 'Strong vs eventual consistency on reads', 'Use replicas for most reads; route "read your own writes" (just-placed order) to the primary or wait for replication.'],
    ['Managed vs self-hosted', 'PaaS databases, caches, load balancers vs running your own', 'Managed services: backups, patching, failover and zone redundancy for free; you trade some control and cost for far less operational work.'],
    ['Monolith vs microservices', 'One deployable vs many', 'Start with a modular monolith; split when teams, scale or release cadence require it.']
  ],
  failures: [
    ['An app server crashes', 'Health checks remove it; autoscaling replaces it; requests retry on another server.'],
    ['A whole zone fails', 'Zone-redundant deployment with N+1 capacity; zone-redundant database with automatic failover.'],
    ['Primary database fails', 'Automatic failover to a standby replica; apps reconnect via a stable endpoint; retries with exponential backoff and jitter.'],
    ['Cache cluster fails', 'Apps fall back to the database with rate limiting to avoid overload; replicated cache nodes; warm the cache gradually.'],
    ['Traffic spike (10&times;)', 'CDN and cache absorb reads; autoscaling; queue writes that can wait; load shedding with 429/503 for non-critical endpoints.'],
    ['Region outage', 'Multi-region with global load balancing and geo-replicated data; regular failover drills.']
  ],
  cloud: [['DNS', 'dns'], ['Global entry, CDN and WAF', 'cdn'], ['WAF rules', 'waf'], ['Regional load balancer', 'lb'], ['App tier', 'webapp'], ['App tier (containers)', 'containers'], ['Cache and sessions', 'cache'], ['Relational database', 'sql'], ['Object storage', 'blob'], ['Queue', 'queue'], ['Workers', 'functions'], ['Secrets', 'secrets'], ['Monitoring', 'monitor'], ['Identity', 'identity']],
  refs: { az: ['azBaselineWeb', 'azMission', 'azWebQueue', 'azCaching', 'azAutoscale', 'azp-static-content-hosting', 'azp-valet-key', 'azWaf'],
          aws: ['awsWaf', 'awsDiagrams', 'awsServerlessLens', 'blStatic', 'blHealth', 'blBackoff', 'blDeploy', 'awsCaching'] },
  questions: [
    ['Why not just buy a bigger server forever?', 'Vertical scaling hits hardware limits, gets expensive non-linearly, and leaves a single point of failure. It is still the right first move for the database; for the web tier, horizontal scaling is cheap once servers are stateless.'],
    ['How do you keep the cache consistent with the database?', 'Cache-aside with TTLs, and delete (not update) the cached key after a write. Accept short staleness windows; for strict needs, read from the primary. Watch out for the race where an old value is written back after a delete: use short TTLs or versioned keys.'],
    ['How many servers do you need?', 'Peak QPS &times; CPU time per request / (cores per server &times; target utilisation), then add capacity to survive losing a zone. Example in the compute table: ~2,900 req/s &times; ~6 ms average = ~18 busy cores &rArr; 8 four-core servers at 60% utilisation, deployed as 4 per zone in 3 zones.'],
    ['What would you do at 100&times; this scale?', 'Shard the database by user or tenant, split into services by domain, adopt a cell/stamp architecture so each cell serves a slice of users, and go active-active multi-region.'],
    ['How do you handle uploads of large files?', 'Give the client a short-lived pre-signed URL and let it upload directly to object storage (valet key); process it asynchronously when the storage emits an event.']
  ],
  related: ['url-shortener', 'ecommerce', 'saas-platform', 'rate-limiter']
});

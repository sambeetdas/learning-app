SD.renderCase({
  slug: 'url-shortener',
  summary: 'A URL shortener turns a long link into a short code (sho.rt/aB3xK9q) and redirects anyone who opens it. It looks trivial, but it is the canonical read-heavy system: roughly 100 redirects for every new link, a few billion rows that are written once and read forever, and a latency budget of a few milliseconds per redirect. The interesting decisions are how to generate unique short codes without a central bottleneck (a base62 counter, a hash with a collision check, or a pre-generated key service), whether to answer with 301 or 302, how much of the redirect traffic the CDN edge and Redis can absorb, how to expire links, and how to count clicks without slowing down the redirect. Pastebin is the same design with one change: the value is a blob of text kept in object storage, with only its metadata in the database.',
  examples: 'Bitly, TinyURL, Rebrandly, t.co (X/Twitter), lnkd.in (LinkedIn), goo.gl (shut down in 2025, a reminder that links must outlive products), Pastebin, GitHub Gist.',
  functional: ['Create a short code for a long URL; optionally choose a custom alias (sho.rt/summer-sale).', 'Opening the short URL redirects to the long URL.', 'Links can expire (a date or after N days) and can be deleted or disabled by the owner or by abuse teams.', 'Owners see click analytics: counts over time, country, referrer, device.', 'Pastebin: store a text snippet and return a short code; read it back raw or rendered.'],
  nonFunctional: ['Redirect p99 under 20 ms at the origin, under 5 ms when served from the edge.', '99.99% availability for redirects (a broken short link breaks every page that embeds it); creation can be slightly less available.', 'Codes are short (7 characters), unique and not guessable in sequence.', 'Durable: a link created today must still work in 10 years.', 'Analytics may lag by up to a minute but must never slow down a redirect.'],
  outOfScope: ['Full marketing suite (QR code design, A/B landing pages).', 'Rich paste editing and collaboration (see collab editor).'],
  estimates: [
    ['New short URLs', '50 M/day &asymp; 580 writes/s average, ~1,700/s peak', '50 M / 86,400 s; peak 3&times; average'],
    ['Redirects (read : write 100 : 1)', '5 B/day &asymp; 58,000/s average, ~175,000/s peak', '50 M &times; 100 / 86,400 s; peak 3&times;'],
    ['Origin redirect QPS', '~70,000/s peak', '60% of peak redirects answered by the CDN edge (hot links cached with s-maxage)'],
    ['Database reads', '~3,500/s peak', '95% Redis hit rate on the 70,000/s that reach the origin'],
    ['Records over 5 years', '~91 B links', '50 M &times; 365 &times; 5'],
    ['Code length', '7 base62 characters', '62<sup>6</sup> &asymp; 57 B is too few; 62<sup>7</sup> &asymp; 3.5 trillion leaves 38&times; headroom'],
    ['URL storage', '~9 TB/year, ~45 TB over 5 years (before replication)', '~500 bytes per record (long URL ~200 B, owner, timestamps, flags, index overhead)'],
    ['Paste storage', '~18 TB/year in object storage', '5 M pastes/day &times; ~10 KB average &times; 365'],
    ['Click events', '~1 TB/day raw, 35 MB/s at peak', '5 B &times; ~200 bytes; 175,000 events/s &times; 200 B'],
    ['Redirect egress', '~0.7 Gbit/s peak', '175,000/s &times; ~500 bytes (a 302 response is tiny)']
  ],
  compute: [
    ['Redirect service', '24 instances of 4 vCPU (8 per zone in 3 zones)', '70,000 req/s &times; ~0.5 ms CPU (Redis lookup + tiny response) = ~35 busy cores &rArr; ~58 cores at 60% utilisation &rArr; 15 &times; 4 vCPU. Two surviving zones must carry it all: 8 per zone &times; 3 = 24.'],
    ['Shorten service', '6 instances of 4 vCPU', '1,700 writes/s &times; ~5 ms CPU (validation, malicious-URL check, DB write) = 8.5 cores &rArr; ~14 cores at 60% &rArr; 4 instances, rounded to 2 per zone.'],
    ['Redis cache', '4 shards &times; 16 GB, 1 replica each', 'Hot set ~100 M codes &times; ~500 B = 50 GB. 70,000 reads/s spread over 4 shards is ~17,500 ops/s each, far below the ~100,000+ ops/s one Redis shard sustains.'],
    ['URL store (Cassandra / DynamoDB)', 'Year one: ~15 nodes (or on-demand capacity)', '9 TB &times; RF 3 = 27 TB at ~2 TB usable per node &rArr; 14 nodes. Load (3,500 reads + 1,700 writes/s) is trivial; size drives the node count.'],
    ['Key generation service', '3 small instances', '1,700 keys/s peak; servers claim batches of 1,000 keys, so KGS sees ~2 batch claims per second.'],
    ['Click stream + aggregation', '48 Kafka partitions, ~12 Flink task slots', '35 MB/s peak at ~5-10 MB/s per partition consumer needs ~6, but 48 gives parallelism and headroom; ~15,000 events/s per slot &rArr; 12 slots.']
  ],
  api: [
    ['POST /api/v1/urls {longUrl, customAlias?, expiresAt?}', 'Create a short link; returns 201 {code, shortUrl}. Idempotency-Key header so a client retry does not mint two codes. 409 if the custom alias is taken.'],
    ['GET /{code}', 'Redirect: 302 Location: longUrl (or 301 for permanent, uncounted links). 404 unknown, 410 Gone expired or disabled.'],
    ['POST /api/v1/pastes {content, syntax, expiresAt, visibility}', 'Create a paste (up to 10 MB); the body goes to object storage, metadata to the URL store.'],
    ['GET /p/{code} and GET /raw/{code}', 'Rendered or raw paste; raw content is served via the CDN from object storage.'],
    ['DELETE /api/v1/urls/{code}', 'Owner disables a link; also purges the CDN and Redis entries.'],
    ['GET /api/v1/urls/{code}/stats?from=&to=&groupBy=country', 'Click analytics from the OLAP store, never from the redirect path.']
  ],
  data: [
    ['url', 'Wide-column / key-value (Cassandra or DynamoDB)', 'Partition key <code>code</code>; long_url, owner_id, created_at, expires_at, kind (url | paste), status (active | disabled | blocked), is_custom. Native TTL on expires_at.'],
    ['url_by_owner', 'Same store, separate table / GSI', 'Partition key owner_id, sort key created_at desc: &ldquo;my links&rdquo; dashboard. Optional dedup index hash(owner_id + long_url) &rarr; code.'],
    ['paste body', 'Object storage', 'Key <code>pastes/{code}</code>, gzip-compressed, immutable; lifecycle rule deletes it after expiry; served through the CDN.'],
    ['key pool (KGS)', 'Small relational DB or Redis set', 'Pre-shuffled unused 7-char keys handed out in batches; a claimed batch is marked used before it is returned.'],
    ['click event', 'Kafka / Event Hubs topic', '{code, ts, country, referrer, device, ip_hash}; partitioned by code so per-link counts aggregate on one consumer.'],
    ['click rollups', 'Columnar OLAP (ClickHouse / Azure Data Explorer)', 'Partitioned by day, ordered by (code, ts); minute and day rollups; raw events kept 90 days.'],
    ['users, api keys, plans', 'Relational (PostgreSQL)', 'Accounts, quotas, billing; small and transactional.']
  ],
  dbChoice: [
    ['Code &rarr; URL mapping', 'Key-value / wide-column (DynamoDB, Cassandra, Cosmos DB)', 'Every access is a single-key get or a conditional put on <code>code</code>; tens of billions of rows; no joins; linear horizontal scaling and native TTL. Conditional writes (IF NOT EXISTS) give uniqueness for custom aliases and hash codes.', 'Sharded PostgreSQL: fine to a few billion rows and gives transactions, but resharding is manual work. A single relational DB stops fitting in year two.'],
    ['Hot redirects', 'Redis (cache-aside) + CDN edge', 'Sub-millisecond lookups; the hot 1% of links get most clicks, so a 50 GB cache absorbs ~95% of origin reads.', 'Relying on DB read throughput alone: possible with DynamoDB, but costs more and adds 5-10 ms per redirect.'],
    ['Paste content', 'Object storage', 'Cheap, durable, unlimited, and directly servable by the CDN; keeps rows small.', 'Storing up to 10 MB blobs in the database row: bloats partitions and compaction.'],
    ['Click analytics', 'Columnar OLAP fed by a stream', 'Aggregations over billions of events by time, country and referrer; columnar compression ~10&times;.', 'Counters in the URL row: hot-key write contention on viral links and no dimensions.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'client', 0, 1.5, 'browsers, apps'], ['edge', 'CDN edge', 'cdn', 1, 1.5, 'caches hot redirects'], ['gw', 'API gateway', 'apigw', 2, 1.5, 'auth, rate limits'],
      ['red', 'Redirect service', 'svc', 3, 0.6, 'GET /{code}'], ['wr', 'Shorten service', 'svc', 3, 2.4, 'create links, pastes'], ['kgs', 'Key service (KGS)', 'svc', 3, 3.4, 'pre-generated keys'],
      ['cache', 'Redis cache', 'cache', 4, 0, 'code → URL'], ['db', 'URL store', 'nosql', 5, 1.8, 'Cassandra / DynamoDB'], ['blob', 'Paste blobs', 'blob', 6, 0.2, 'object storage'],
      ['st', 'Click stream', 'stream', 4.3, 3.1, 'Kafka / Event Hubs'], ['an', 'Click analytics', 'dw', 5.8, 3.1, 'Flink + ClickHouse']],
    edges: [['u', 'edge'], ['edge', 'gw'], ['gw', 'red'], ['gw', 'wr'], ['red', 'cache'], ['red', 'db'], ['red', 'blob', 'paste body'], ['red', 'st', 'click', 'async'], ['st', 'an', '', 'async'],
      ['wr', 'kgs'], ['wr', 'db'], ['wr', 'blob']]
  },
  flows: [
    { name: 'Create short link', desc: 'A user shortens a URL; the code comes from a pre-generated key batch, so no coordination happens per request.', steps: [
      ['u', 'edge', 'POST /api/v1/urls', 'The client sends the long URL with an Idempotency-Key so a network retry cannot create two codes.'],
      ['edge', 'gw', 'forward', 'The edge terminates TLS and the WAF filters bots; creation is never cached.'],
      ['gw', 'wr', 'auth + quota ok', 'The gateway checks the API key and the per-user creation rate limit (link spam is the main abuse vector).'],
      ['wr', 'kgs', 'claim batch (if empty)', 'Each shorten instance holds ~1,000 unused keys in memory. Only when its batch runs out does it ask KGS for another, so KGS sees a couple of calls per second.'],
      ['kgs', 'wr', 'keys aB3xK9q...', 'KGS marks the batch as used before returning it: a crash wastes keys but can never hand the same key out twice.', 'resp'],
      ['wr', 'db', 'PUT IF NOT EXISTS', 'Store code → long URL with expires_at as TTL. The conditional put is a cheap safety net; with KGS it essentially never fails.'],
      ['wr', 'u', '201 sho.rt/aB3xK9q', 'The user gets the short URL in ~20 ms. The malicious-URL scan runs asynchronously and can disable the link minutes later.', 'resp']],
      end: 'Code generation is moved off the request path: batches turn a potential global bottleneck into a local in-memory pop.' },
    { name: 'Redirect (cache hit)', desc: 'The hot path: 99% of all traffic. It must be a single cache lookup.', steps: [
      ['u', 'edge', 'GET /aB3xK9q', 'The browser follows the short link. For a viral link the edge already holds the 302 (s-maxage=60) and answers here in ~5 ms.'],
      ['edge', 'gw', 'edge miss', 'A less popular link misses the edge cache and goes to the origin region.'],
      ['gw', 'red', 'route', 'Redirects skip authentication; only per-IP abuse limits apply.'],
      ['red', 'cache', 'GET url:aB3xK9q', 'Cache-aside lookup; ~95% hit rate because link popularity is extremely skewed.'],
      ['cache', 'red', 'hit (0.3 ms)', 'The cached value includes status and expires_at so disabled or expired links are honoured without a DB read.', 'resp'],
      ['red', 'st', 'click event', 'Fire-and-forget into a local buffer flushed to Kafka every few ms. A slow analytics pipeline can never slow the redirect.', 'async'],
      ['red', 'u', '302 Location: long URL', '302 (not 301) so the next click comes back to us and is counted; Cache-Control: private, max-age=0 for the browser.', 'resp']],
      end: 'One Redis GET and one buffered event per redirect: the origin needs only a few dozen instances for 70,000 req/s.' },
    { name: 'Pastebin: create and read', desc: 'The same design, but the value is a text blob stored in object storage.', steps: [
      ['u', 'gw', 'POST /api/v1/pastes (40 KB)', 'A paste arrives; the size limit (10 MB) is enforced at the gateway.'],
      ['gw', 'wr', 'route', 'The shorten service handles pastes too.'],
      ['wr', 'kgs', 'pop key from batch', 'A code is taken from the local batch exactly as for URLs.'],
      ['wr', 'blob', 'PUT pastes/Qm7Zt2p (gzip)', 'Body first: if the metadata write later fails, an orphan blob is cleaned up by a lifecycle rule, never a dangling pointer.'],
      ['wr', 'db', 'PUT metadata kind=paste', 'The row holds blob key, size, syntax and expiry, but not the content.'],
      ['u', 'edge', 'GET /raw/Qm7Zt2p', 'Reads of popular pastes are served by the CDN: content is immutable, so it can be cached for a long time.'],
      ['red', 'blob', 'origin fetch (miss)', 'On a miss the redirect service looks up metadata (cache, then DB) and streams the blob; the CDN keeps it.']],
      end: 'Keep large values out of the database: rows stay ~500 bytes, and blobs get cheap storage plus CDN delivery.' },
    { name: 'Collision, expiry and abuse', desc: 'Edge cases: a taken custom alias, an expired link and a link reported as phishing.', steps: [
      ['u', 'gw', 'POST customAlias=summer-sale', 'A user asks for a vanity alias.'],
      ['gw', 'wr', 'route', 'Custom aliases bypass KGS.'],
      ['wr', 'db', 'PUT IF NOT EXISTS', 'The conditional write is the only correct uniqueness check; a read-then-write would race with another user.'],
      ['db', 'wr', 'condition failed', 'Alias already exists.', 'err'],
      ['wr', 'u', '409 Conflict + suggestions', 'Return suggestions (summer-sale-26) instead of a bare error.', 'err'],
      ['red', 'cache', 'GET url:old123', 'Later, someone opens a link whose expires_at has passed.'],
      ['cache', 'red', 'status=expired', 'The cached record shows expiry (or Cassandra TTL already removed the row, giving 404).', 'err'],
      ['red', 'u', '410 Gone', '410 tells crawlers the link is permanently gone. Phishing links reported by Safe Browsing feeds are set to blocked, purged from CDN and Redis, and return an interstitial warning page.', 'err']],
      end: 'Uniqueness comes from conditional writes, not checks; expiry and blocking must be honoured from every cache layer.' },
    { name: 'Click analytics', desc: 'Click events become per-link dashboards a few seconds later.', steps: [
      ['red', 'st', 'batch of click events', 'Events are batched and compressed (lz4) per partition; partitioned by code.', 'async'],
      ['st', 'an', 'Flink 1-minute windows', 'Flink deduplicates by event id, enriches with geo-IP and device, and writes minute rollups plus raw rows to ClickHouse.', 'async'],
      ['u', 'gw', 'GET /urls/aB3xK9q/stats', 'The owner opens the dashboard.'],
      ['gw', 'an', 'query rollups', 'The stats API reads only the OLAP store: aggregates over billions of rows return in tens of milliseconds thanks to columnar storage and day partitions.'],
      ['an', 'u', 'clicks by day, country', 'Numbers lag ~1 minute; exact counts are not needed for a marketing dashboard.', 'resp']],
      end: 'Analytics is a separate, asynchronous pipeline: it can fall behind or be rebuilt from Kafka without touching redirects.' }
  ],
  components: [
    ['CDN edge + WAF', 'TLS, bot filtering, and caching of hot 302 responses for a short s-maxage; raw paste content cached long.'],
    ['API gateway', 'API keys, per-user creation quotas, per-IP redirect limits, request size limits.'],
    ['Redirect service', 'Stateless lookup: cache, then DB; honours status/expiry; emits click events asynchronously.'],
    ['Shorten service', 'Validates URLs, assigns codes (KGS batch, custom alias or hash), writes metadata and paste blobs.'],
    ['Key generation service', 'Pre-generates and shuffles unused 7-character keys; hands out batches marked used atomically.'],
    ['Redis cache', 'code &rarr; {url, status, expires_at}; LRU eviction; TTL capped by link expiry.'],
    ['URL store', 'Durable mapping, partitioned by code, replicated 3&times; across zones, with TTL-based expiry.'],
    ['Click pipeline', 'Kafka &rarr; Flink &rarr; ClickHouse rollups for dashboards; raw events in object storage for reprocessing.']
  ],
  deep: [
    ['Generating short codes: three options', '<table><tr><th>Approach</th><th>How</th><th>Pros</th><th>Cons</th></tr>' +
      '<tr><td><strong>Counter + base62</strong></td><td>A global counter (or Snowflake-style ID) encoded in base62 [0-9a-zA-Z]: id 125 &rarr; &ldquo;21&rdquo;.</td><td>No collisions ever; shortest possible codes.</td><td>Sequential codes are guessable (enumerate all links); a single counter is a bottleneck unless you use ranges per server. Fix guessability by permuting the id with a keyed bijection (e.g. a Feistel cipher) before encoding.</td></tr>' +
      '<tr><td><strong>Hash + collision check</strong></td><td>MD5/SHA-256 of the long URL (+ owner), take the first 42 bits, base62 &rarr; 7 chars; conditional insert; on collision add a salt and retry.</td><td>Stateless; the same URL can map to the same code (dedup).</td><td>Collisions grow with fill: at 18 B used out of 3.5 T codes, ~0.5% of inserts retry. Every insert needs a conditional write.</td></tr>' +
      '<tr><td><strong>Key generation service</strong></td><td>Offline job generates random unused keys; servers claim batches of 1,000 and pop locally.</td><td>No per-request coordination, no collisions, non-sequential.</td><td>An extra service to run; keys in a crashed server&rsquo;s batch are lost (harmless at 3.5 T).</td></tr></table>' +
      '<p>In practice: KGS (or counter ranges with a bijective shuffle) for generated codes, conditional writes for custom aliases. Codes avoid ambiguous characters only if humans type them; otherwise use full base62.</p>'],
    ['301 vs 302 (and 307/308)', '<ul><li><strong>301 Moved Permanently</strong>: browsers and proxies cache the redirect, often indefinitely. Lowest load and latency, but later clicks never reach you: no analytics, and you cannot change or disable the target for users who already cached it.</li><li><strong>302 Found / 307</strong>: not cached by default. Every click reaches the edge or origin, so it can be counted, expired, re-targeted or blocked. Almost every commercial shortener uses 302 (Bitly uses 301 only where analytics is not needed).</li><li>307/308 preserve the HTTP method; irrelevant for links opened with GET.</li></ul><p>A middle path: answer 302 to browsers but let the CDN cache it briefly (<code>Cache-Control: private, max-age=0</code> plus a CDN-only <code>s-maxage=60</code>), and count clicks served at the edge from real-time CDN logs.</p>'],
    ['Caching redirects at the edge', '<p>Link popularity follows a power law: a tweet with a link can produce 50,000 clicks per second for minutes. Three layers absorb it:</p><ol><li><strong>CDN edge</strong> caches the 302 for hot codes for ~60 s; viral spikes never reach the origin.</li><li><strong>Redis</strong> holds ~100 M recent codes; misses populate it (cache-aside) with a TTL no longer than the link&rsquo;s remaining life.</li><li><strong>Local in-process LRU</strong> (a few thousand entries per instance, 5 s TTL) protects Redis from a single hot key.</li></ol><p>Disabling a link must purge all three: delete the Redis key, issue a CDN purge for the path, and rely on the short local TTL. Negative caching (remember 404s for 30 s) stops scanners from hammering the database with random codes.</p>'],
    ['Expiry and cleanup', '<p>Store <code>expires_at</code> in the row and check it on every read, because cache layers may hold the record longer than the DB. Let the database delete physically: Cassandra TTL or DynamoDB TTL (deletes within ~48 hours, which is why the read-time check matters). Paste blobs use an object-storage lifecycle rule. Never recycle expired codes: old copies of the link still exist in emails and documents, and reuse would send those readers somewhere unexpected.</p>'],
    ['Abuse: phishing, malware and spam', '<ul><li>Rate-limit link creation per account and per IP; require verified accounts for high volumes.</li><li>Check targets against Google Safe Browsing / Microsoft Defender SmartScreen-style threat feeds at creation, again asynchronously, and re-scan popular links periodically (targets can change after shortening).</li><li>Blocked links return an interstitial warning page, not the target.</li><li>Do not allow redirect chains to other shorteners (a common way to hide the final target).</li><li>Make codes non-sequential so attackers cannot enumerate private links; for sensitive pastes offer longer codes (10+ chars) and &ldquo;burn after reading&rdquo;.</li></ul>']
  ],
  scale: [
    '<strong>Viral hot keys:</strong> one code gets 50,000+ clicks/s. Edge caching with short s-maxage plus an in-process LRU keep it off a single Redis shard.',
    '<strong>Storage grows forever:</strong> ~9 TB/year of tiny rows. A partitioned key-value store adds nodes linearly; expired rows vanish via TTL; archive stale links (no clicks for 2 years) to cheaper storage tiers if needed.',
    '<strong>Code generation:</strong> KGS batches or counter ranges mean the write path never coordinates per request; 1,700 writes/s is easy.',
    '<strong>Click analytics volume:</strong> 1 TB/day of events. Partition Kafka by code, pre-aggregate in Flink, keep raw events 90 days in ClickHouse and longer as Parquet in object storage.',
    '<strong>Global latency:</strong> run redirect services in several regions with a globally replicated URL store (DynamoDB global tables / Cosmos DB multi-region); a link created in one region is readable elsewhere within ~1 s, which is acceptable.'
  ],
  tradeoffs: [
    ['Code generation', 'Counter + base62 vs hash + collision check vs KGS', 'KGS (or counter ranges with a bijective shuffle): no collisions, no per-request coordination, non-guessable. Hashing only when deduplicating identical URLs matters.'],
    ['Redirect status', '301 (cached by browsers) vs 302 (every click visible)', '302 for counted links; you keep analytics and the ability to disable a link. Offer 301 for links where the owner opts out of analytics.'],
    ['Deduplicate identical long URLs?', 'One code per URL vs a new code per request', 'New code per request (per owner): different owners need separate analytics and expiry. Optional per-owner dedup via a hash index.'],
    ['Analytics accuracy', 'Count synchronously in the DB vs async stream', 'Async stream: redirects stay fast and available; counts lag ~1 minute and are approximately exact (dedup by event id).'],
    ['Database', 'Sharded SQL vs key-value NoSQL', 'Key-value: the access pattern is pure get/put by code at tens of billions of rows with TTL.']
  ],
  failures: [
    ['Redis shard fails', 'Replica promoted in seconds; meanwhile misses go to the DB, which is sized for it (and protected by a concurrency limit and request coalescing per code).'],
    ['KGS unavailable', 'Each shorten instance holds a batch of ~1,000 keys (minutes of traffic); KGS runs 3 instances; as a last resort fall back to hash + conditional insert.'],
    ['URL store zone outage', 'RF 3 across zones with LOCAL_QUORUM (or DynamoDB multi-AZ): reads and writes continue on two replicas.'],
    ['Kafka or analytics pipeline down', 'Redirects never wait on it; events buffer locally and in Kafka (7-day retention); Flink replays from offsets when it recovers.'],
    ['Viral link overloads the origin', 'CDN caches the 302 for 60 s; per-key request coalescing; in-process LRU.'],
    ['Link turns malicious after creation', 'Periodic re-scans of popular targets; abuse reports; blocking purges Redis and CDN and shows a warning interstitial.'],
    ['Region outage', 'Global load balancer shifts redirects to another region reading the replicated store; creation may be briefly unavailable, which is acceptable.']
  ],
  cloud: [['DNS', 'dns'], ['CDN, edge caching and global entry', 'cdn'], ['WAF and bot protection', 'waf'], ['DDoS protection', 'ddos'], ['API gateway and quotas', 'apigw'], ['Redirect and shorten services', 'containers'], ['Redis cache', 'cache'],
    ['URL store', 'nosql'], ['URL store (Cassandra option)', 'widecol'], ['Paste blobs', 'blob'], ['Click stream', 'stream'], ['Click aggregation', 'streamproc'], ['Click analytics store', 'timeseries'], ['Accounts and billing', 'sql'], ['Monitoring', 'monitor'], ['Secrets', 'secrets']],
  refs: { az: ['azp-cache-aside', 'azCaching', 'azCdn', 'azp-static-content-hosting', 'azPartition', 'azDataStore', 'azp-rate-limiting-pattern', 'azp-valet-key'],
          aws: ['awsCaching', 'blCaching', 'awsDdbBest', 'awsClickstream', 'awsWafAuto', 'awsDiagrams'] },
  questions: [
    ['How long should the code be?', 'Work out how many links you will ever store: 50 M/day for 5 years is ~91 B. Base62 gives 62<sup>6</sup> &asymp; 57 B and 62<sup>7</sup> &asymp; 3.5 trillion, so 7 characters with ~38&times; headroom (which also keeps random-key collisions rare).'],
    ['Why not just use an auto-increment ID from the database?', 'It works for one database but becomes a write bottleneck and single point of failure, and sequential codes let anyone enumerate every link. Use counter ranges per server (or Snowflake-style IDs) and shuffle with a keyed bijection, or a key generation service.'],
    ['What if two users shorten the same URL?', 'Give each owner its own code so analytics, expiry and deletion stay independent. Optionally dedup within one owner with an index on hash(owner + URL). Anonymous creation can share codes for identical URLs to save space.'],
    ['How do you handle 175,000 redirects per second?', 'Layered caching: the CDN edge answers hot links (~60%), Redis answers ~95% of the rest, and the database sees a few thousand reads per second. The redirect service is stateless and scales horizontally; click counting is asynchronous.'],
    ['How would you make redirects work if the main region is down?', 'Deploy redirect services in multiple regions with a multi-region replicated key-value store (DynamoDB global tables, Cosmos DB); the edge routes to the nearest healthy region. Writes can be single-region; redirects, which matter most, stay up.'],
    ['How does Pastebin differ?', 'The value is large (KB to MB), so store it in object storage and keep only metadata in the database; serve raw content through the CDN since pastes are immutable; enforce size limits and expiry with lifecycle rules.']
  ],
  related: ['unique-id', 'rate-limiter', 'kv-store', 'distributed-cache', 'ad-click']
});

SD.renderCase({
  slug: 'distributed-cache',
  summary: 'A distributed cache keeps hot data in RAM across many machines so that millions of reads per second never reach the database. This design follows Redis Cluster and Memcached at scale: the key space is cut into <strong>16,384 hash slots</strong> (<code>CRC16(key) mod 16384</code>) assigned to primary shards, clients route either <strong>directly</strong> with a cached slot map or through a <strong>proxy</strong> (Envoy, twemproxy, mcrouter), each primary has <strong>asynchronous replicas</strong> and fails over by a majority vote on the cluster bus, and memory is bounded by <strong>approximated LRU/LFU eviction</strong>. The hard parts are not the hash table but the edges: <strong>hot keys</strong> that melt one shard, <strong>cache stampedes</strong> when a popular key expires, <strong>keeping the cache consistent with the database</strong>, and <strong>cross-region</strong> copies. A cache is a performance layer, not the source of truth, and the design must stay correct (if slower) when the cache is empty.',
  examples: 'Redis Cluster / Valkey on Azure Managed Redis, Amazon ElastiCache and MemoryDB; Memcached with mcrouter at Meta (the “Scaling Memcache at Facebook” paper); Twitter’s Twemcache and Pelikan; Netflix EVCache; Discord and Uber caching layers in front of Cassandra and MySQL.',
  functional: ['<code>GET</code>, <code>SET</code> with TTL, <code>DEL</code>, multi-get, atomic <code>INCR</code> and conditional <code>SET NX</code>; data structures (hashes, sorted sets) where Redis is used.', 'Scale out and rebalance by moving slots between shards online.', 'Replication with automatic failover of a failed primary.', 'Bounded memory with a configurable eviction policy.', 'Invalidate or refresh entries when the source database changes.'],
  nonFunctional: ['p99 under 1 ms inside a zone for single-key operations; 5M+ ops/s at peak.', '99.99% availability: lose a node or a zone without a cache-miss storm that overloads the database.', 'Hit rate above 95% for the hot working set.', 'Bounded staleness: changes visible within seconds of the database commit.', 'Linear scale-out; cost per GB of RAM is the main bill, so avoid waste.'],
  outOfScope: ['Using the cache as a durable primary database (see <a href="../kv-store/index.html">key-value store</a>).', 'Full-text or vector search inside the cache.', 'CDN/edge HTTP caching (see <a href="../caching/index.html">caching</a>).'],
  estimates: [
    ['Peak operations', '~5M ops/s', 'Large consumer app: ~2,000 app servers &times; ~2,500 cache calls/s each'],
    ['Read : write ratio', '~95 : 5', 'Reads dominate; writes are SET-after-miss and invalidations'],
    ['Hot working set', '~3 TB', '3 billion keys &times; ~1 KB (value + ~60 B Redis overhead per key)'],
    ['RAM with replicas', '~6 TB', '1 replica per primary (&times; 2); no persistence beyond replicas'],
    ['Hit rate', '~98%', 'Measured target; 2% of 4.75M reads = ~95k reads/s reach the database'],
    ['Cache bandwidth', '~40 Gbit/s', '5M ops/s &times; ~1 KB'],
    ['Client connections', '~240k', '2,000 app servers &times; 120 primaries &times; 1 pooled connection (why proxies or multiplexing help)'],
    ['Hot key peak', '~500k ops/s on one key', 'A viral item or config key; ~10&times; what one shard thread can serve']
  ],
  compute: [
    ['Primary shards', '120 primaries of ~25 GB each', '3 TB / 25 GB = 120. Small shards make full resync and failover fast (25 GB copies in ~1 min at 4 Gbit/s) and spread hot slots.'],
    ['Throughput per shard', '~42k ops/s average, ~120k ceiling', '5M / 120 = ~42k ops/s. A Redis shard with I/O threads does ~150-200k simple ops/s, so ~30% utilisation leaves room for a zone loss and uneven slots.'],
    ['Hosts', '~60 VMs of 16 vCPU / 128 GB, 4 shards each', '240 shard processes (120 primaries + 120 replicas) / 4 per VM. Keep maxmemory at ~75% of shard RAM for fork/copy-on-write during snapshots and for fragmentation.'],
    ['Network per host', '~0.7 Gbit/s average, 25 Gbit/s NIC', '40 Gbit/s / 60 hosts; headroom for hot keys, resyncs and replica traffic.'],
    ['Proxy tier (optional)', '~40 proxies of 8 vCPU', 'Only for clients that cannot do cluster routing: an Envoy proxy core handles ~50k ops/s; 2M proxied ops/s / 50k = 40 cores &times; 1.6 headroom &asymp; 8 VMs; deploy 40 small instances across 3 zones close to the apps.'],
    ['Database read capacity behind it', '~100k reads/s at 98% hit, plan for ~500k', 'If the hit rate drops to 90% (cold restart) misses grow 5&times;: protect the database with request coalescing and load shedding rather than sizing it for a cold cache.']
  ],
  api: [
    ['GET key / MGET k1 k2 (same hash tag)', 'Read; multi-key commands only work when all keys share a slot, so use hash tags like <code>{user:42}:profile</code>.'],
    ['SET key value EX 300 [NX | XX]', 'Write with TTL (add jitter, e.g. 300 &plusmn; 30 s, to avoid synchronised expiry). <code>NX</code> doubles as a lock for stampede protection.'],
    ['DEL key / UNLINK key', 'Invalidate after a database write; UNLINK frees memory in a background thread for big values.'],
    ['CLUSTER SHARDS', 'Client fetches the slot &rarr; node map at start-up and after a <code>MOVED</code> redirect.'],
    ['-MOVED 7000 10.0.2.15:6379 / -ASK ...', 'Redirect replies: MOVED means the slot now lives elsewhere (update the map); ASK means it is mid-migration (retry once there with ASKING).'],
    ['Client-side caching: CLIENT TRACKING ON', 'Server pushes invalidation messages for keys a client has cached locally (Redis 6+ tracking), enabling a safe near cache.']
  ],
  data: [
    ['Cached objects', 'Redis primaries (RAM)', 'Key = <code>entity:id:version?</code>; value = serialised object (JSON, Protobuf, compressed if &gt; 1 KB); TTL always set.'],
    ['Slot map', 'Every node and every smart client', '16,384 slots &rarr; primary + replicas; versioned by a config epoch so newer assignments win after failover.'],
    ['Replication stream', 'Replica nodes', 'Asynchronous command stream with a replication backlog (e.g. 256 MB) so short disconnects do a partial resync instead of a full copy.'],
    ['Locks / leases', 'Same cache, short TTL', '<code>lock:product:42</code> = request id, <code>SET NX PX 3000</code>; prevents many callers rebuilding the same key.'],
    ['Local near cache', 'App-server memory (Caffeine, in-process LRU)', 'Tiny (100 MB), very short TTL (1-5 s) or server-tracked invalidation; absorbs hot keys.'],
    ['Change events', 'CDC stream (Debezium &rarr; Kafka)', 'Row-change events keyed by primary key drive invalidation; ordered per key.']
  ],
  dbChoice: [
    ['Cache engine', 'Redis / Valkey Cluster', 'Rich data types, atomic ops, replication and automatic failover built in; ~1M ops/s per host with I/O threads.', 'Memcached: simpler, multi-threaded, slab allocator, very efficient for plain strings; no replication or persistence, so sharding and redundancy live in the client (mcrouter).'],
    ['Partitioning', '16,384 hash slots', 'Fixed slots decouple keys from nodes: rebalancing moves whole slots, and the map is small enough (a few KB) for every client to hold.', 'Consistent hashing ring (Memcached clients, ketama): no central map but no atomic slot ownership or migration protocol.'],
    ['Routing', 'Smart client by default, proxy where needed', 'One network hop and no extra tier; proxies centralise connection pooling, metrics and routing for many languages and legacy clients.', 'Proxy-only (twemproxy, Envoy): fewer connections but an extra hop (~100-200 &micro;s) and another tier to scale.'],
    ['Near cache', 'In-process LRU with server-assisted invalidation', 'Handles hot keys with zero network; Redis client tracking avoids serving stale data for long.', 'No near cache: simpler but hot keys hit one shard; key replication across shards is the alternative.']
  ],
  diagram: {
    nodes: [['app', 'App servers', 'client', 0, 2.1, 'client lib + L1 cache'], ['px', 'Proxy (optional)', 'lb', 1.2, 3.2, 'Envoy / mcrouter'], ['db', 'Database', 'db', 1.2, 0, 'source of truth'],
      ['s1', 'Primary 1', 'cache', 2.6, 1, 'slots 0-5460'], ['s2', 'Primary 2', 'cache', 2.6, 2.1, 'slots 5461-10922'], ['s3', 'Primary 3', 'cache', 2.6, 3.2, 'slots 10923-16383'],
      ['r1', 'Replica 1', 'cache', 3.9, 1, 'other zone'], ['r2', 'Replica 2', 'cache', 3.9, 2.1, 'other zone'], ['r3', 'Replica 3', 'cache', 3.9, 3.2, 'other zone'],
      ['cdc', 'CDC stream', 'stream', 3.2, 0, 'Debezium + Kafka'], ['inv', 'Invalidator', 'worker', 4.6, 0, 'DEL on change'], ['xr', 'Remote region', 'ext', 5.3, 2.1, 'geo-replica']],
    edges: [['app', 's1'], ['app', 's2'], ['app', 's3'], ['app', 'px'], ['px', 's3'], ['app', 'db', 'on miss'], ['s1', 'r1', '', 'async'], ['s2', 'r2', 'replication', 'async'], ['s3', 'r3', '', 'async'],
      ['s1', 's2', 'cluster bus', 'none'], ['s2', 's3', '', 'none'], ['db', 'cdc', 'binlog / WAL', 'async'], ['cdc', 'inv', '', 'async'], ['inv', 's1', 'DEL key'], ['r2', 'xr', 'cross-region', 'async']]
  },
  flows: [
    { name: 'Read hit (client routing)', desc: 'The common case: the client computes the slot itself and talks to the right primary in one hop.', steps: [
      ['app', 's2', 'GET product:{42}', 'The app first misses its tiny in-process L1 cache, then computes CRC16("42") mod 16384: the cached slot map says that slot lives on primary 2. Only the part inside {} is hashed, so related keys share a slot.'],
      ['s2', 'app', 'value (~0.3 ms)', 'An O(1) hash-table lookup on a single-threaded event loop; the network round trip dominates. Total cache cost stays well under 1 ms at p99, so a page can afford dozens of cache calls.', 'resp'],
      ['app', 'px', 'legacy client: GET', 'Services that cannot speak cluster protocol send the same command to a nearby proxy instead.'],
      ['px', 's3', 'route by slot', 'The proxy holds the slot map and a small pool of multiplexed connections, cutting shard connections from thousands to dozens.'],
      ['s3', 'px', 'value', 'The shard answers the proxy; a multi-get spanning several slots would be fanned out and gathered here.', 'resp'],
      ['px', 'app', 'value (+0.1-0.2 ms)', 'The extra hop costs a little latency, in exchange for a dumb client and far fewer connections per shard.', 'resp']],
      end: 'Smart clients give one-hop reads; proxies trade ~0.1-0.2 ms for simpler clients and far fewer connections.' },
    { name: 'Miss + stampede protection', desc: 'A hot key expires while 5,000 requests per second want it. Only one caller rebuilds it.', steps: [
      ['app', 's2', 'GET product:{42}', 'Lookup.'], ['s2', 'app', 'nil (expired)', 'The key just expired. Without protection all 5,000 req/s would hit the database at once.', 'err'],
      ['app', 's2', 'SET lock:{42} NX PX 3000', 'Try to take a short lease. Exactly one request wins; the others get nil and either wait 20-50 ms and re-read, or serve a stale copy kept under a longer-lived key.'],
      ['s2', 'app', 'OK (lease acquired)', 'This request is the single rebuilder.', 'resp'],
      ['app', 'db', 'SELECT product 42', 'One database query instead of thousands.'], ['db', 'app', 'row', 'A few milliseconds.', 'resp'],
      ['app', 's2', 'SET product:{42} EX ~300s', 'Store with a jittered TTL so keys written together do not expire together.'],
      ['app', 's2', 'DEL lock:{42} (if still ours)', 'Release the lease with a compare-and-delete Lua script so a slow rebuilder cannot delete someone else’s lease.']],
      end: 'Leases (request coalescing), stale-while-revalidate and probabilistic early refresh turn a thundering herd into one query.' },
    { name: 'Resharding: MOVED / ASK', desc: 'Operators move slot 7000 from primary 2 to primary 3 to rebalance, while traffic continues.', steps: [
      ['s2', 's3', 'MIGRATE keys of slot 7000', 'Slot 7000 is marked MIGRATING on primary 2 and IMPORTING on primary 3; keys move in small batches, atomically per key.', 'async'],
      ['app', 's2', 'GET user:{9}', 'The client still believes slot 7000 is on primary 2.'],
      ['s2', 'app', '-ASK 7000 primary3', 'The key has already moved, so primary 2 answers ASK: try primary 3 for this one request but do not update the map yet.', 'err'],
      ['app', 's3', 'ASKING + GET user:{9}', 'Primary 3 serves it because of the ASKING flag, even though it does not own the slot yet.'],
      ['s3', 'app', 'value', 'Served.', 'resp'],
      ['s1', 's2', 'gossip: slot 7000 now on P3', 'When migration completes, the new owner bumps the config epoch and the change spreads over the cluster bus.'],
      ['app', 's2', 'GET user:{9}', 'A client with the old map asks primary 2 again.'],
      ['s2', 'app', '-MOVED 7000 primary3', 'MOVED is permanent: the client refreshes its slot map (CLUSTER SHARDS) and goes direct from now on.', 'err']],
      end: 'Fixed slots plus ASK/MOVED redirects make rebalancing an online, incremental operation.' },
    { name: 'Primary failure + failover', desc: 'Primary 2 dies. Its replica in another zone takes over after a majority of primaries agree.', steps: [
      ['app', 's2', 'GET (timeout)', 'Primary 2’s host fails; requests for its slots time out.', 'err'],
      ['s1', 's2', 'PING: no PONG for 5 s', 'Nodes mark it PFAIL locally after cluster-node-timeout, and gossip those reports.', 'err'],
      ['s1', 's3', 'gossip: P2 FAIL', 'Once a majority of primaries report PFAIL, it becomes FAIL cluster-wide.'],
      ['r2', 's1', 'request failover vote', 'Replica 2 (with the most up-to-date replication offset) starts an election with a new epoch.'],
      { par: [['s1', 'r2', 'vote granted', 'resp'], ['s3', 'r2', 'vote granted', 'resp']], msg: 'A majority of primaries vote; the replica promotes itself and takes slots 5461-10922.' },
      ['app', 'r2', 'retry on new primary', 'Clients see MOVED or a connection error, refresh the slot map and retry. Total disruption ~5-15 s for those slots.'],
      ['r2', 'xr', 'replicate onward', 'Cross-region replication continues from the new primary.', 'async']],
      end: 'Replication is asynchronous, so writes acknowledged by the old primary but not yet replicated are lost; fine for a cache, use WAIT or MemoryDB-style durable logs if not.' },
    { name: 'DB write + invalidation', desc: 'Keeping the cache consistent: update the database, then delete the key, driven by change data capture.', steps: [
      ['app', 'db', 'UPDATE product 42', 'The database is the source of truth and is written first.'],
      ['app', 's1', 'DEL product:{42}', 'The writer deletes (not updates) the key, so the next read reloads fresh data. Deleting is idempotent and avoids racing two writers’ values.'],
      ['db', 'cdc', 'row change event', 'The commit also appears in the binlog/WAL, captured by Debezium into Kafka, keyed by product id (ordered per key).', 'async'],
      ['cdc', 'inv', 'consume', 'An invalidator consumes changes as a safety net for writers that forgot or crashed before their DEL.', 'async'],
      ['inv', 's1', 'DEL product:{42} again', 'A second, delayed delete (e.g. +1 s) also fixes the race where a slow reader writes an old value back after the first delete.'],
      ['s1', 'r1', 'replicate DEL', 'Replicas apply the delete asynchronously.', 'async'],
      ['inv', 'xr', 'publish to remote region', 'Remote regions consume the same change stream to invalidate their copies; staleness there is replication lag plus a few hundred ms.', 'async']],
      end: 'Cache-aside + delete-on-write + CDC-driven (delayed) invalidation gives bounded staleness without distributed transactions.' }
  ],
  components: [
    ['Cache client library', 'Slot map, connection pools, retries on MOVED/ASK, timeouts (~50 ms), circuit breaker, L1 near cache, serialisation and compression.'],
    ['Proxy tier (optional)', 'Cluster-aware routing for non-smart clients, connection multiplexing, fan-out of multi-get, metrics and hot-key detection.'],
    ['Primary shards', 'Own ranges of hash slots; serve reads and writes; evict under memory pressure; stream changes to replicas.'],
    ['Replicas', 'Hot standby in another zone; optional read scaling (READONLY) for stale-tolerant reads.'],
    ['Cluster bus', 'Gossip between all nodes on port+10000: health, slot ownership, config epochs, failover elections.'],
    ['Invalidation pipeline', 'CDC from the database through Kafka to an invalidator that deletes or refreshes keys, locally and in other regions.'],
    ['Operator / autoscaler', 'Adds shards, migrates slots, replaces failed nodes, rebalances hot slots, rolls upgrades one replica at a time.']
  ],
  deep: [
    ['Hash slots and routing', '<p>Redis Cluster hashes <code>CRC16(key) mod 16384</code>. 16,384 is a compromise: enough slots to spread over up to ~1,000 primaries, yet the ownership bitmap gossiped in every heartbeat is only 2 KB. Hash tags (<code>{user:42}:cart</code>, <code>{user:42}:profile</code>) force related keys into one slot so multi-key commands, transactions and Lua scripts work.</p><p><strong>Client-side routing</strong> (Lettuce, redis-py cluster, Jedis) caches the slot map and goes straight to the owner: lowest latency, but every client holds connections to every primary (2,000 apps &times; 120 primaries = 240k connections) and every language needs a cluster-aware client. <strong>Proxy routing</strong> (Envoy Redis filter, twemproxy, mcrouter, the managed service endpoints) centralises the map, multiplexes connections and can add hot-key detection or shadow traffic, at the cost of an extra hop and a tier to operate. Large fleets often do both.</p>'],
    ['Eviction: approximated LRU and LFU', '<p>Exact LRU needs a linked list touched on every read: too much memory and lock contention. Redis instead samples: on eviction it picks <code>maxmemory-samples</code> (default 5, 10 is close to true LRU) random keys and evicts the best candidate from a small pool. Policies:</p><ul><li><code>allkeys-lru</code>: good default for a pure cache.</li><li><code>allkeys-lfu</code>: Morris-style logarithmic counter (8 bits per key) with time decay; keeps frequently used keys even if not touched in the last second, and resists scans that would flush LRU.</li><li><code>volatile-ttl</code> / <code>volatile-lru</code>: only evict keys with a TTL, protecting permanent keys (dangerous if nothing has a TTL: writes start failing with OOM).</li></ul><p>Memcached uses a slab allocator with per-slab-class LRU segmented into hot/warm/cold, so a change in object sizes can starve a class (slab rebalancing fixes it). Admission policies like TinyLFU (used by Caffeine for near caches) reject one-hit wonders before they evict useful items.</p>'],
    ['Hot keys', '<p>Slots spread <em>keys</em>, not <em>load</em>: one viral key (a celebrity profile, a global config, a flash-sale item) lands on one shard thread that tops out around 150-200k ops/s. Detect with sampling at the proxy or client (Count-Min sketch / top-k), <code>redis-cli --hotkeys</code> with LFU, or per-slot metrics. Fix with:</p><ol><li><strong>Near cache</strong> in each app server with a 1-5 s TTL or server-assisted tracking: 2,000 servers &times; 1 fetch per second instead of 500k ops/s.</li><li><strong>Key replication</strong>: write copies <code>hot:{42}#0..#15</code> to 16 slots and read a random one; writes update all copies.</li><li><strong>Replica reads</strong> for stale-tolerant hot data.</li><li>For hot <em>writes</em> (counters), shard the counter into N sub-keys and sum on read.</li></ol>'],
    ['Cache stampede (thundering herd)', '<p>When a popular key expires, every concurrent miss rebuilds it, and the database sees a spike exactly when it is most loaded. Defences, usually combined:</p><ul><li><strong>Lease / lock</strong>: <code>SET lock:k NX PX 3000</code>; one caller rebuilds, others wait briefly or serve stale. Memcached leases (from the Facebook paper) also reject stale SETs after a delete.</li><li><strong>Stale-while-revalidate</strong>: store a soft expiry inside the value and a longer hard TTL; after the soft expiry, one caller refreshes in the background while others keep reading.</li><li><strong>Probabilistic early refresh</strong> (XFetch): refresh early with probability rising as expiry nears, <code>now - &delta; &times; &beta; &times; ln(rand()) &ge; expiry</code>, so rebuilds spread out naturally.</li><li><strong>TTL jitter</strong> so bulk-loaded keys do not expire together, and <strong>warm-up</strong> after a cold start, with the database protected by rate limits.</li></ul>'],
    ['Consistency with the database and across regions', '<p>Pattern: <strong>cache-aside, write the database, then delete the key</strong>. Never update cache and DB in two independent writes (a crash between them or concurrent writers leave the cache wrong indefinitely). The remaining race: reader A misses, reads old row; writer B updates DB and deletes key; A writes the old value back. Bound it with short TTLs, a <strong>delayed second delete</strong>, version numbers in values (<code>SET</code> only if newer, via Lua), or Memcached-style leases. CDC-driven invalidation (Debezium &rarr; Kafka) covers writers that bypass the application.</p><p>Across regions, either keep independent per-region caches invalidated from the replicated change stream (Meta’s approach with mcsqueal), or use the managed geo-replication (ElastiCache Global Datastore, Azure Managed Redis active geo-replication with CRDT-based conflict resolution). Either way remote staleness is replication lag; route read-your-own-write requests to the home region or bypass the cache for them.</p>']
  ],
  scale: [
    '<strong>Memory is the bill:</strong> compress values over ~1 KB, use compact encodings (Redis hashes with listpack for small objects), drop unused fields, and always set TTLs. Watch fragmentation (enable active defrag).',
    '<strong>More throughput:</strong> add primaries and migrate slots; use I/O threads; pipeline and batch (MGET) to cut round trips; keep values small to avoid one big value blocking the event loop.',
    '<strong>Connection explosion:</strong> pooled multiplexed clients (Lettuce), proxies, or fewer larger app servers; cap maxclients per shard.',
    '<strong>Zone loss:</strong> replicas in a different zone from their primary; capacity planned so surviving shards absorb promoted primaries; database protected by coalescing and shedding during the refill.',
    '<strong>Large keys and slow commands:</strong> ban KEYS, big HGETALL/SMEMBERS on huge collections and long Lua scripts in production; use SCAN and split big collections.'
  ],
  tradeoffs: [
    ['Routing', 'Smart client vs proxy', 'Smart clients for latency-sensitive services in mainstream languages; a proxy tier for everything else and for fleets where connection counts explode.'],
    ['Write strategy', 'Cache-aside + delete vs write-through vs write-behind', 'Cache-aside with delete-on-write: simplest, robust when the cache is lost. Write-through suits read-after-write; write-behind risks data loss and is only for counters or non-critical data.'],
    ['Replication', 'Async replicas vs synchronous / durable log', 'Async for a cache (fast writes, small loss window on failover is acceptable). If the cache is primary data, use MemoryDB-style multi-AZ transaction logs.'],
    ['Eviction policy', 'LRU vs LFU vs TTL-only', 'allkeys-lfu for skewed popularity and scan resistance; allkeys-lru when recency is the better signal; never rely on eviction alone for correctness.'],
    ['Hot keys', 'Near cache vs key replication vs replica reads', 'Near cache first (cheapest, biggest effect); key replication for hot keys that must be fresher than the near-cache TTL.']
  ],
  failures: [
    ['A primary shard fails', 'Replica in another zone promoted by majority vote in ~5-15 s; clients refresh slot map; un-replicated writes in the window are lost (acceptable for a cache).'],
    ['Whole cache cluster lost or flushed', 'Apps fall back to the database with request coalescing, rate limits and load shedding; warm the cache gradually; never let the database be sized only for a warm cache without a plan.'],
    ['Hot key saturates one shard', 'Detect via top-k sampling; enable near cache or replicate the key across slots automatically; alert on per-shard CPU skew.'],
    ['Cache stampede after mass expiry', 'TTL jitter, leases, stale-while-revalidate and probabilistic early refresh.'],
    ['Stale data after a DB update', 'Delete-on-write, delayed second delete, CDC-driven invalidation and bounded TTLs as the backstop.'],
    ['Split brain during a partition', 'A minority-side primary stops accepting writes after node-timeout (cluster-require-full-coverage / min-replicas settings), limiting divergent writes.'],
    ['Memory exhaustion / OOM', 'maxmemory with an eviction policy, alerts at 80%, monitor big keys and fragmentation, leave headroom for snapshot copy-on-write.']
  ],
  cloud: [['Managed Redis / Valkey cluster', 'cache'], ['Durable Redis-compatible (log-backed)', 'Azure Managed Redis (persistence)', 'Amazon MemoryDB'], ['Cross-region replication', 'Azure Managed Redis active geo-replication', 'ElastiCache Global Datastore'],
    ['Self-hosted Redis/Memcached', 'k8s'], ['Cache hosts on VMs', 'vms'], ['Proxy / endpoint load balancing', 'lb'], ['Source database', 'sql'], ['CDC / change stream', 'stream'], ['Invalidator workers', 'functions'],
    ['Private networking', 'network'], ['Auth tokens and TLS', 'secrets'], ['Metrics and alerts', 'monitor'], ['Slow-log and audit analytics', 'logs']],
  refs: { az: ['azCaching', 'azp-cache-aside', 'azp-sharding', 'azPartition', 'azMission', 'azTransient'],
          aws: ['awsCaching', 'blCaching', 'blStatic', 'blShuffle', 'blFallback', 'blBackoff'] },
  questions: [
    ['Why 16,384 slots and not consistent hashing?', 'Slots make ownership explicit and atomic: each slot has exactly one owner per config epoch, migration has a clear protocol (MIGRATING/IMPORTING, ASK, MOVED), and the 2 KB bitmap fits in every gossip message. Consistent hashing works without a map but cannot coordinate a safe handover of a range.'],
    ['How do you handle a key that gets 500k reads per second?', 'Detect it (top-k sampling), then serve it from an in-process near cache with a 1-5 s TTL or server-assisted invalidation; if it must be fresher, replicate it across N slots (key#0..#15) and read a random copy. Replica reads help for stale-tolerant data.'],
    ['How do you keep the cache consistent with the database?', 'Write the database first, then delete the cache key; reload on the next read. Back it up with CDC-driven invalidation, a delayed second delete for the read/write race, versioned values and TTLs as the final bound on staleness.'],
    ['What happens when a primary fails?', 'Other nodes stop getting PONGs, mark it PFAIL then FAIL by majority; its replica with the freshest offset requests votes, a majority of primaries grant them, and it takes over the slots. Clients get MOVED/connection errors and refresh. Writes not yet replicated are lost unless you use WAIT or a durable log.'],
    ['LRU or LFU?', 'LFU (Redis’s logarithmic counters with decay) when popularity is skewed and scans could flush the cache; LRU when recency predicts reuse. Both are sampled approximations, which is fine at cache scale.'],
    ['What if the cache becomes the bottleneck for availability?', 'Treat it as optional: timeouts of tens of milliseconds, circuit breakers that fall back to the database with coalescing and shedding, and capacity tests with a cold cache. A cache that the system cannot live without has silently become a database and needs durability.']
  ],
  related: ['kv-store', 'caching', 'rate-limiter', 'scaling-web-app', 'news-feed']
});

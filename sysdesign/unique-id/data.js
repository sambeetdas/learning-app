SD.renderCase({
  slug: 'unique-id',
  summary: 'Every order, message, payment and event needs an identifier that is unique across hundreds of servers, generated in microseconds, and ideally sortable by time so database indexes stay compact and &ldquo;newest first&rdquo; queries are cheap. A single auto-increment column cannot do this at scale: it is one write bottleneck and one point of failure. This design compares the main options (database ticket servers, segment allocation in the style of Meituan Leaf, Twitter Snowflake 64-bit IDs, UUIDv4, UUIDv7 and ULID), shows the Snowflake bit layout and its maths, how to handle clocks that jump backwards, why k-sortable IDs matter for B-tree index locality, and how worker IDs are assigned safely with leases in etcd or ZooKeeper.',
  examples: 'Twitter/X Snowflake, Discord and Instagram IDs (Snowflake variants), Sony Sonyflake, Meituan Leaf, Baidu UidGenerator, Flickr ticket servers, MongoDB ObjectId, UUIDv7 (RFC 9562) built into PostgreSQL 18 and most languages, ULID in many event-sourced systems.',
  functional: ['Generate unique IDs for many entity types (orders, messages, payments, events).', 'IDs are roughly ordered by creation time (k-sortable) so that sorting by ID approximates sorting by time.', 'Some business domains need dense, strictly increasing numeric IDs per tag (invoice or payment numbers).', 'An ID can be decoded into its timestamp and generator for debugging.', 'Clients (mobile apps) can create IDs offline for idempotency keys and drafts.'],
  nonFunctional: ['1 million IDs/s at peak across the fleet, with growth headroom of 10&times;.', 'Generation in under 1 &micro;s in-process (no network hop on the hot path).', 'No single point of failure; generation continues if the coordinator is briefly unavailable.', 'Never a duplicate, even after clock adjustments, restarts or network partitions.', 'Fit in 64 bits (BIGINT) where possible: half the index size of a 128-bit UUID.'],
  outOfScope: ['Human-friendly short codes (see URL shortener).', 'Globally ordered sequence numbers with no gaps (that needs a single sequencer, see stock exchange).'],
  estimates: [
    ['Peak ID demand', '1 M IDs/s across all services', 'Orders, messages and events at a large consumer platform'],
    ['Snowflake capacity per worker', '4,096 IDs/ms = ~4.1 M IDs/s', '12-bit sequence per millisecond'],
    ['Snowflake lifetime', '~69.7 years from the custom epoch', '2<sup>41</sup> ms = 2.2 &times; 10<sup>12</sup> ms; epoch 2020-01-01 lasts until ~2089'],
    ['Concurrent generators', 'up to 1,024 (we run ~400 pods)', '10 worker bits (5 datacentre + 5 worker, or 10 flat)'],
    ['Index size, 10 B rows', '~80 GB (BIGINT) vs ~160 GB (UUID) per key copy', '8 vs 16 bytes per key, before page overhead; every secondary index and foreign key repeats it'],
    ['Leaf segment DB writes', '~1 update per 2 s per tag', 'Step 10,000 at 5,000 IDs/s per business tag; ~50 tags &rArr; ~25 writes/s'],
    ['Coordinator load', '~40 writes/s', '400 workers &times; 1 lease keepalive per 10 s'],
    ['UUIDv4 collision risk', 'negligible', '122 random bits: ~2.7 &times; 10<sup>18</sup> IDs for a 50% birthday collision chance']
  ],
  compute: [
    ['Snowflake library (in-process)', '~0.1 core across the whole fleet', '1 M IDs/s &times; ~100 ns (read clock, shift, mask, CAS on a counter) = 0.1 core. This is why the generator is a library, not a network service.'],
    ['Central ID service (if you insisted)', '~20 cores + a network hop per ID', '1 M RPCs/s &times; ~20 &micro;s = 20 busy cores, plus ~0.5 ms latency per call; batching (100 IDs per call) cuts it to 10,000 RPCs/s.'],
    ['Leaf segment service', '3 instances of 2 vCPU (one per zone)', '50,000 ID requests/s served from in-memory segments &times; ~50 &micro;s = 2.5 cores; spread over 3 zones so any two carry the load.'],
    ['Segment database', '1 primary + 1 synchronous standby (small)', '~25 UPDATEs/s; it holds one row per business tag.'],
    ['etcd / ZooKeeper', '3 nodes (5 for higher fault tolerance)', '~40 lease keepalives/s and a few hundred keys: tiny, but it must be a linearisable store so two pods never hold the same worker id.']
  ],
  api: [
    ['IdGenerator.next() → int64', 'In-process Snowflake library call; returns a 64-bit, k-sortable ID. Blocks for &lt; 1 ms only if the sequence for the current millisecond is exhausted.'],
    ['IdGenerator.parse(id) → {timestampMs, workerId, sequence}', 'Debugging and support: when and where an ID was created.'],
    ['gRPC IdService.NextIds(bizTag, count) → [start, end]', 'Leaf segment mode: a range of dense increasing IDs for one business tag (e.g. invoice numbers).'],
    ['GET /v1/ids/{bizTag}?count=100', 'HTTP variant for languages without the gRPC client.'],
    ['uuidv7() / UUID.v7()', 'Client-side or database-side UUIDv7 (PostgreSQL 18 has a built-in uuidv7()); used for idempotency keys and offline-created records.'],
    ['etcd Txn(create /idgen/workers/{n} with lease), LeaseKeepAlive', 'Worker id acquisition: create-if-absent bound to a 30 s lease; keepalive every 10 s.']
  ],
  data: [
    ['worker lease', 'etcd / ZooKeeper', 'Key <code>/idgen/workers/{workerId}</code> &rarr; {pod, startedAt}; bound to a lease (TTL 30 s). Ephemeral node in ZooKeeper terms.'],
    ['last timestamp checkpoint', 'etcd / ZooKeeper', '<code>/idgen/lastts/{workerId}</code> written every ~3 s; at start-up a worker refuses to generate if its clock is behind this value.'],
    ['leaf_alloc', 'Relational (MySQL / PostgreSQL)', 'biz_tag PK, max_id BIGINT, step INT, updated_at. Allocation: <code>UPDATE leaf_alloc SET max_id = max_id + step WHERE biz_tag = ?</code> then read max_id, in one transaction.'],
    ['orders', 'Relational / NoSQL', 'id BIGINT (Snowflake) as primary key: new rows append at the right edge of the B-tree; range scans by id are time ranges.'],
    ['payments', 'Relational', 'id BIGINT from Leaf (dense per tag) plus idempotency_key UUIDv7 with a unique index.'],
    ['events', 'Kafka topic', 'Key = entity id, so all events for one order go to one partition in order; IDs embed time for cheap time-range filtering.']
  ],
  dbChoice: [
    ['Worker id leases', 'etcd or ZooKeeper', 'Linearisable compare-and-create plus leases/ephemeral nodes: exactly what is needed to guarantee one owner per worker id, and to detect a dead owner automatically.', 'Redis SETNX with TTL: works in the happy path but asynchronous replication can lose a lock on failover, allowing two owners. Kubernetes StatefulSet ordinals: simple for a single cluster, unsafe across clusters.'],
    ['Segment allocation', 'Relational DB with row-level locking', 'One atomic UPDATE per segment; strong durability means a range is never handed out twice, even after restarts.', 'Redis INCRBY: faster, but a failover can roll back the counter and reissue IDs unless AOF fsync=always.'],
    ['ID format in tables', 'BIGINT Snowflake (or UUIDv7 when 128 bits is acceptable)', 'Time-ordered keys keep inserts on the rightmost B-tree pages, so the hot working set stays small and page splits are rare.', 'UUIDv4 primary keys: random inserts touch random leaf pages, causing cache misses, page splits and ~2&times; write amplification on large tables.']
  ],
  diagram: {
    nodes: [['u', 'Mobile / web apps', 'client', 0, 1.4, 'UUIDv7 idempotency keys'], ['ntp', 'Time sync', 'ext', 0.9, 0, 'chrony / PTP'], ['gw', 'API gateway', 'apigw', 1, 1.4],
      ['os', 'Order service', 'svc', 2, 0.6, 'Snowflake library'], ['ps', 'Payment service', 'svc', 2, 2.3, 'needs dense numbers'], ['zk', 'etcd cluster', 'db', 3.2, 0, 'worker-id leases'],
      ['odb', 'Orders DB', 'db', 5, 0.9, 'BIGINT PK, B-tree'], ['st', 'Event stream', 'stream', 6, 1.8, 'key = order id'],
      ['leaf', 'Leaf ID service', 'svc', 3.4, 2.3, 'segments, double buffer'], ['seg', 'Segment DB', 'db', 5, 2.5, 'leaf_alloc table'], ['pdb', 'Payments DB', 'db', 5, 3.5, 'dense ids']],
    edges: [['u', 'gw'], ['gw', 'os'], ['gw', 'ps'], ['os', 'zk', 'lease worker id'], ['os', 'ntp', 'clock'], ['os', 'odb'], ['os', 'st', '', 'async'], ['ps', 'leaf', 'NextIds'], ['leaf', 'seg'], ['ps', 'pdb']]
  },
  flows: [
    { name: 'Create an order (Snowflake)', desc: 'The hot path: an ID is minted in-process in ~100 ns, with no network call.', steps: [
      ['u', 'gw', 'POST /orders (Idempotency-Key)', 'The app generated a UUIDv7 idempotency key on the device, so a retry after a timeout is recognised as the same order, even offline.'],
      ['gw', 'os', 'route', 'Any order-service pod can take the request.'],
      ['os', 'odb', 'INSERT id=903817265004728321', 'The pod mints an ID locally: (now − epoch) << 22 | workerId << 12 | sequence. Its worker id (here 17) was leased at start-up, so no other pod can produce the same bits.'],
      ['odb', 'os', 'ok (append to B-tree edge)', 'Because IDs grow with time, the insert lands on the rightmost leaf page, which is already in memory.', 'resp'],
      ['os', 'st', 'OrderCreated key=id', 'Events use the same ID as key; consumers can derive the creation time from the ID itself.', 'async'],
      ['os', 'u', '201 {id}', 'The 64-bit ID is returned as a string in JSON: JavaScript numbers lose precision above 2^53.', 'resp']],
      end: 'Generation is a few CPU instructions; coordination happened once, at start-up, when the worker id was leased.' },
    { name: 'Pod start-up: lease a worker id', desc: 'How a new pod gets one of the 1,024 worker ids without ever sharing it.', steps: [
      ['os', 'zk', 'Txn create workers/17', 'The pod tries ids in a random order: create /idgen/workers/n only if absent, bound to a 30 s lease. The first success wins.'],
      ['zk', 'os', 'granted, lease 30 s', 'etcd is linearisable, so exactly one pod can win id 17.', 'resp'],
      ['os', 'zk', 'read lastts/17', 'Read the last timestamp the previous owner of id 17 checkpointed.'],
      ['zk', 'os', 'lastTs = 10:02:07.120', 'If the local clock is behind that value, the pod waits (or refuses to start) rather than risk reusing a timestamp + worker + sequence triple.', 'resp'],
      ['os', 'ntp', 'check clock offset', 'The pod checks that chrony reports it is synchronised and that the offset is small.'],
      ['ntp', 'os', 'offset 0.3 ms', 'Healthy: the pod marks itself ready and starts serving.', 'resp'],
      ['os', 'zk', 'keepalive every 10 s', 'Keepalives renew the lease; the last timestamp is checkpointed every ~3 s.', 'async']],
      end: 'Leases give safe, automatic reuse of worker ids when pods die, and the checkpoint protects against reusing time after a restart.' },
    { name: 'Dense IDs from segments (Leaf)', desc: 'Payments need short, strictly increasing numbers per tag; a segment service serves them from memory.', steps: [
      ['ps', 'leaf', 'NextIds(payment, 1)', 'The payment service asks for the next payment number.'],
      ['leaf', 'ps', '50,000,123', 'Served from the in-memory segment [50,000,001 … 50,010,000]: no database access per ID.', 'resp'],
      ['leaf', 'seg', 'UPDATE max_id += 10000', 'When 10% of the current segment is used, the next segment is fetched in the background (double buffering), so callers never wait for the DB.', 'async'],
      ['seg', 'leaf', 'max_id = 50,020,000', 'The row update is atomic and durable: segment [50,010,001 … 50,020,000] now belongs to this instance.', 'resp'],
      ['ps', 'pdb', 'INSERT id=50000123', 'Each Leaf instance owns different segments, so IDs are unique, increasing per instance and roughly increasing overall.'],
      ['leaf', 'seg', 'adjust step (2× or ½)', 'If a segment was consumed in under 15 minutes the step doubles; if it lasted far longer it halves, keeping DB writes rare and gaps small.', 'async']],
      end: 'Segments turn one DB write into 10,000 IDs; double buffering hides the DB entirely. A restart only leaves a gap, never a duplicate.' },
    { name: 'Clock jumps backwards', desc: 'A failure case: an NTP step moves a pod’s clock back 80 ms. Without care, it would reissue old timestamps.', steps: [
      ['os', 'ntp', 'clock check', 'The generator compares every new timestamp with the last one it used.'],
      ['ntp', 'os', 'now < lastTs by 80 ms', 'The wall clock went backwards (a VM migration or an NTP step instead of a slew).', 'err'],
      ['gw', 'os', 'POST /orders', 'A request arrives during the skew.'],
      ['os', 'gw', '503: not ready (skew)', 'Skew under ~5 ms: just wait it out. Larger: refuse to generate, fail the readiness probe and let the gateway retry on another pod. Never generate with an older timestamp.', 'err'],
      ['gw', 'ps', 'other pods unaffected', 'Only this pod is out of rotation; capacity is N+1.'],
      ['os', 'zk', 'alert + recheck', 'The pod records the incident; once its clock passes lastTs it becomes ready again. Operators configure chrony to slew, never step, on running hosts.', 'err']],
      end: 'Clock safety rule: monotonic per generator. Wait, refuse or switch worker id, but never go back in time.' }
  ],
  components: [
    ['Snowflake library', 'In-process 64-bit ID generation: timestamp, worker id, per-ms sequence; clock-regression checks.'],
    ['etcd / ZooKeeper', 'Worker id leases (one owner each) and last-timestamp checkpoints.'],
    ['Time sync (chrony / PTP)', 'Keeps clocks within a millisecond; configured to slew rather than step.'],
    ['Leaf segment service', 'Dense per-tag IDs from pre-allocated ranges with double buffering and adaptive step.'],
    ['Segment DB', 'Durable max_id per business tag; one atomic UPDATE per segment.'],
    ['UUIDv7 libraries', 'Coordination-free 128-bit IDs for clients and idempotency keys.']
  ],
  evolutionTitle: 'From one auto-increment column to coordination-free IDs',
  evolution: [
    { name: '1. Auto-increment', desc: 'One database hands out IDs. Simple and dense, but every insert in every service depends on one primary.', diagram: { nodes: [['a', 'App servers', 'svc', 0, 0], ['db', 'Database', 'db', 1.6, 0, 'AUTO_INCREMENT']], edges: [['a', 'db']] },
      steps: [['a', 'db', 'INSERT … RETURNING id', 'The ID is only known after the insert; sharding or a second writer breaks uniqueness.'], ['db', 'a', 'id = 1001', 'Fine for one database, a bottleneck and SPOF for many services.', 'resp']] },
    { name: '2. Ticket servers', desc: 'Flickr’s approach: dedicated MySQL servers whose only job is AUTO_INCREMENT; two of them with odd and even IDs.', diagram: { nodes: [['a', 'App servers', 'svc', 0, 0.6], ['t1', 'Ticket server 1', 'db', 1.6, 0, 'odd: offset 1, step 2'], ['t2', 'Ticket server 2', 'db', 1.6, 1.2, 'even: offset 2, step 2']], edges: [['a', 't1'], ['a', 't2']] },
      steps: [['a', 't1', 'REPLACE INTO Tickets64', 'REPLACE INTO Tickets64 (stub) VALUES ("a"); SELECT LAST_INSERT_ID(); returns the next odd number.'], ['a', 't2', 'round robin / failover', 'If one server is down, use the other. IDs are unique but only roughly ordered, and each fetch is a network round trip.']] },
    { name: '3. Snowflake + leases', desc: 'Every pod generates IDs locally; coordination is reduced to leasing a worker id once.', diagram: { nodes: [['a', 'App pods', 'svc', 0, 0.6, 'Snowflake library'], ['e', 'etcd', 'db', 1.6, 0, 'worker-id leases'], ['db', 'Database', 'db', 1.6, 1.2, 'BIGINT keys']], edges: [['a', 'e'], ['a', 'db']] },
      steps: [['a', 'e', 'lease worker id (once)', 'At start-up only.'], ['a', 'db', 'INSERT with local id', 'Millions of IDs per second, no network hop, time-ordered.'], ['a', 'e', 'keepalive', 'If the lease is lost, the pod stops generating until it has a worker id again.', 'async']] }
  ],
  deep: [
    ['Snowflake bit layout and maths', '<pre><code>| 1 bit | 41 bits                     | 10 bits     | 12 bits  |\n| sign  | ms since custom epoch       | worker id   | sequence |\n\nid = ((nowMs - EPOCH) &lt;&lt; 22) | (workerId &lt;&lt; 12) | sequence</code></pre>' +
      '<ul><li><strong>41-bit timestamp:</strong> 2<sup>41</sup> ms &asymp; 69.7 years. Use a recent custom epoch (Twitter: Nov 2010; ours: 2020-01-01) to get the full span.</li><li><strong>10-bit worker id:</strong> 1,024 concurrent generators, often split 5 datacentre + 5 worker bits.</li><li><strong>12-bit sequence:</strong> 4,096 IDs per millisecond per worker; if exhausted, spin until the next millisecond.</li><li>The sign bit stays 0 so IDs are positive in signed BIGINT columns and Java longs.</li><li>In late 2026 IDs are ~9 &times; 10<sup>17</sup> (18 digits). Send them to browsers as strings: JavaScript loses precision above 2<sup>53</sup>.</li></ul>' +
      '<p>Variants move the bits around: Sonyflake uses 39 bits of 10 ms units (174 years), 8 sequence bits and 16 machine bits; Instagram used 41 time + 13 logical-shard + 10 sequence bits generated inside PostgreSQL. Pick the split from your numbers: how many generators, how many IDs per ms each, how many years.</p>'],
    ['Handling clock skew', '<ol><li>Keep <code>lastTs</code> in the generator; if <code>now &lt; lastTs</code>, the clock went backwards.</li><li>Small regression (a few ms): sleep until <code>now &ge; lastTs</code>.</li><li>Large regression: refuse to generate, fail the readiness probe, alert. Optionally switch to a spare worker id, which makes old timestamps safe again because the worker bits differ.</li><li>Across restarts: checkpoint <code>lastTs</code> to etcd every few seconds and refuse to start while the local clock is behind it (Leaf&rsquo;s snowflake mode also compares with the average time of its peers).</li><li>Run chrony configured to <em>slew</em> (gradually adjust) rather than step; in clouds use the hypervisor time source (Amazon Time Sync, Azure host time) and consider PTP for sub-millisecond accuracy.</li></ol><p>Some generators avoid wall-clock dependence entirely by advancing a logical timestamp when the sequence wraps (&ldquo;borrowing&rdquo; future milliseconds, as Baidu UidGenerator does); IDs stay unique but drift ahead of real time under load.</p>'],
    ['UUIDv4 vs UUIDv7 vs ULID vs Snowflake', '<table><tr><th>Format</th><th>Size</th><th>Ordered?</th><th>Coordination</th><th>Notes</th></tr>' +
      '<tr><td>UUIDv4</td><td>128 bits</td><td>No (122 random bits)</td><td>None</td><td>Universal; random index inserts hurt large B-trees.</td></tr>' +
      '<tr><td>UUIDv7 (RFC 9562, 2024)</td><td>128 bits</td><td>Yes: 48-bit Unix ms prefix</td><td>None</td><td>Then 74 random (or counter + random) bits. Native in PostgreSQL 18 <code>uuidv7()</code>, .NET 9 <code>Guid.CreateVersion7()</code>, Python 3.14 <code>uuid.uuid7()</code>. The default choice when 128 bits is fine.</td></tr>' +
      '<tr><td>ULID</td><td>128 bits</td><td>Yes: 48-bit ms + 80 random</td><td>None</td><td>26-char Crockford base32 text, optional monotonic mode within a ms; predates UUIDv7, which now covers the same need with a standard.</td></tr>' +
      '<tr><td>Snowflake</td><td>64 bits</td><td>Yes (per ms, across workers roughly)</td><td>Worker id assignment</td><td>Half the size; fits BIGINT; exposes creation time and worker.</td></tr>' +
      '<tr><td>Ticket server / Leaf segment</td><td>64 bits</td><td>Increasing (per server/instance)</td><td>A DB per range</td><td>Dense, short numbers for business-facing IDs.</td></tr></table>' +
      '<p>Note that time-ordered IDs leak creation time and approximate volume; for public identifiers where that matters, expose an opaque or encrypted alias.</p>'],
    ['Why k-sortable IDs matter for indexes', '<p>A B-tree keeps keys in order. With random keys (UUIDv4), every insert lands on a random leaf page: on a 200 GB index almost every insert is a cache miss and a page read, pages split at random and are left ~70% full, and write-ahead logging grows because full-page images are written after each checkpoint. With time-ordered keys, inserts go to the rightmost page, which is always hot in memory; pages fill to ~100% and splits are cheap appends. Benchmarks on PostgreSQL and MySQL/InnoDB (where the primary key is the clustered index) typically show several times higher insert throughput and a much smaller buffer-pool working set. Bonus: <code>ORDER BY id DESC LIMIT 20</code> gives the newest rows without a separate timestamp index, and time-range queries become ID-range scans.</p><p>The flip side: a single hot right-edge page can become a contention point in distributed databases that range-partition by key (Spanner, CockroachDB, HBase); there you hash-prefix or shard the key instead.</p>'],
    ['Assigning worker ids safely', '<ul><li><strong>Leases in etcd / ephemeral nodes in ZooKeeper (chosen):</strong> create-if-absent bound to a TTL; a dead pod&rsquo;s id frees itself after the TTL. A pod that loses its lease (partition) must stop generating immediately, and it should wait a full TTL plus clock margin after a crash before an id is reused.</li><li><strong>Kubernetes StatefulSet ordinal:</strong> pod-0..pod-n map to worker ids; simple within one cluster, but two clusters or a stuck old pod can collide.</li><li><strong>Database-assigned:</strong> a row per worker with a heartbeat column; workable, slower to detect failures.</li><li><strong>Derived from IP/MAC:</strong> avoid; containers reuse addresses and 10 bits cannot hold an IPv4 address without collisions.</li></ul>']
  ],
  scale: [
    '<strong>Throughput per worker:</strong> 4,096 IDs/ms is far above what one service instance needs; if a single process ever needs more, give it two worker ids.',
    '<strong>Running out of worker ids:</strong> 1,024 is plenty for one service; across the company give each service family its own epoch or bit split, or move to UUIDv7 which needs no coordination.',
    '<strong>Coordinator load:</strong> one lease per pod and a keepalive every 10 s; etcd handles thousands of these easily. The coordinator is not on the request path, so its brief unavailability does not stop generation for pods that already hold leases.',
    '<strong>Segment DB as a bottleneck:</strong> adaptive step sizes keep updates to a few per second per tag; shard tags across databases if there are thousands of them.',
    '<strong>Distributed databases:</strong> monotonic keys concentrate writes on one range; use hash-sharded primary keys there, keeping the time-ordered ID as a column.'
  ],
  tradeoffs: [
    ['64-bit Snowflake vs 128-bit UUIDv7', 'Smaller and BIGINT-friendly vs zero coordination', 'Snowflake for high-volume internal tables where index size matters; UUIDv7 for client-generated IDs, idempotency keys and when operating worker ids is not worth it.'],
    ['In-process library vs central ID service', 'No network hop vs simpler clients and central control', 'Library: ~100 ns and no dependency on the request path. A central service only for dense business numbers (Leaf), and then with batching.'],
    ['Strict order vs rough order', 'Single sequencer vs per-worker timestamps', 'Rough (k-sorted) order is enough for indexes and feeds; strict global order needs one sequencer and limits throughput.'],
    ['Dense numbers vs gaps', 'No gaps (one counter) vs gaps after restarts (segments)', 'Accept gaps: guaranteeing no gaps requires serialising every allocation. If a regulator needs gapless invoice numbers, allocate them at the final booking step, per legal entity.'],
    ['Expose IDs publicly?', 'Raw time-ordered IDs vs opaque aliases', 'Raw IDs leak creation time and volume; expose opaque or encrypted aliases where that is sensitive.']
  ],
  failures: [
    ['Clock goes backwards', 'Detect now &lt; lastTs; wait if small, otherwise refuse and fail readiness; checkpoint lastTs; chrony slew mode.'],
    ['Two pods believe they own the same worker id', 'Linearisable leases; a pod stops generating when its lease is lost; reuse a freed id only after TTL + clock margin.'],
    ['etcd unavailable', 'Pods with valid leases keep generating; new pods cannot start (scale-up blocked) until it recovers; 3-5 node quorum across zones.'],
    ['Sequence exhausted within one ms', 'Spin until the next ms (at most 1 ms of delay) or use a second worker id for that process.'],
    ['Segment DB down', 'Double buffering gives minutes of IDs already in memory; standby promotion; IDs continue from a later segment (a gap, never a duplicate).'],
    ['Precision loss in JavaScript clients', 'Serialise 64-bit IDs as strings in JSON APIs.']
  ],
  cloud: [['Order and payment services', 'containers'], ['Kubernetes (StatefulSets, leases)', 'k8s'], ['Coordination (etcd / ZooKeeper)', 'Self-managed on AKS', 'Self-managed on EKS'], ['Segment database', 'sql'], ['Orders and payments data', 'sql'], ['Distributed SQL (hash-sharded keys)', 'distsql'],
    ['NoSQL tables keyed by ID', 'nosql'], ['Event stream', 'stream'], ['Time synchronisation', 'Azure host time (Hyper-V IC)', 'Amazon Time Sync Service'], ['API gateway', 'apigw'], ['Monitoring (clock offset, lease alerts)', 'monitor'], ['Secrets', 'secrets']],
  refs: { az: ['azp-leader-election', 'azPartition', 'azDataStore', 'azp-sharding', 'azAksBaseline', 'azMicro'],
          aws: ['blLeader', 'blDistributed', 'awsDdbBest', 'awsMicro', 'awsPatterns'] },
  questions: [
    ['Why not just use UUIDv4 everywhere?', 'It needs no coordination and almost never collides, but it is 128 bits and random: large B-tree indexes suffer random inserts, page splits and a large working set, and IDs carry no time order. UUIDv7 keeps the no-coordination benefit while fixing ordering.'],
    ['How many IDs per second can Snowflake produce?', '4,096 per millisecond per worker (12-bit sequence), so ~4.1 million per second per worker and ~4 billion per second across 1,024 workers. Real limits are CPU and the network, not the format.'],
    ['What happens when the clock moves backwards?', 'The generator detects now &lt; lastTs. It waits for small regressions, and for large ones refuses to generate and fails its health check so traffic moves to other instances. Persisting lastTs protects against restarts with a bad clock.'],
    ['How do you assign worker ids in Kubernetes?', 'Lease them from etcd or ZooKeeper with a TTL (create-if-absent), renew with keepalives, and stop generating if the lease is lost. StatefulSet ordinals are a simpler option within a single cluster.'],
    ['Are Snowflake IDs strictly ordered?', 'Only per worker. Across workers they are k-sorted: ordered to within clock skew (~1 ms) and the per-ms sequence. That is enough for index locality and feeds, not for a strict global sequence.'],
    ['What would you use for invoice numbers?', 'A segment allocator (Leaf style) or a database sequence per legal entity: dense, short and increasing. Accept gaps after restarts unless regulation requires gapless numbering, in which case assign at the final booking step inside the transaction.']
  ],
  related: ['url-shortener', 'kv-store', 'message-queue', 'payment', 'data']
});

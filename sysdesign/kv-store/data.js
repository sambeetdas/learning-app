SD.renderCase({
  slug: 'kv-store',
  summary: 'A distributed key-value store gives applications one primitive, <code>get(key)</code> / <code>put(key, value)</code>, and hides hundreds of machines behind it. This design follows the Dynamo lineage (Amazon Dynamo, Cassandra, Riak, ScyllaDB): keys are spread over a <strong>consistent-hash ring with virtual nodes</strong>, each key is copied to <strong>N replicas</strong> on its preference list, and every request is a tunable <strong>quorum</strong> (R + W &gt; N for read-your-writes). There is no leader: any node can coordinate, <strong>sloppy quorums and hinted handoff</strong> keep writes flowing through failures, <strong>vector clocks or last-writer-wins</strong> reconcile divergent copies, <strong>Merkle-tree anti-entropy</strong> repairs what slipped through, and <strong>gossip</strong> spreads membership and failure suspicion. Each node persists data in an <strong>LSM-tree</strong> (write-ahead log, memtable, SSTables, compaction, Bloom filters) because it turns random writes into sequential I/O. The result is an always-writable, horizontally scalable store that trades strict consistency for availability, the AP side of CAP.',
  examples: 'Amazon Dynamo (the 2007 paper behind DynamoDB), Apache Cassandra (Apple, Netflix, Discord’s former message store), ScyllaDB, Riak KV, Voldemort at LinkedIn; RocksDB and LevelDB as the per-node LSM engines; etcd and FoundationDB as contrasting CP designs.',
  functional: ['<code>put(key, value, context)</code> and <code>get(key)</code> for opaque values up to ~1 MB; <code>delete</code> via tombstones.', 'Tunable consistency per request: choose R and W (ONE, QUORUM, ALL; LOCAL_QUORUM per region).', 'Automatic partitioning and rebalancing as nodes join or leave, without downtime.', 'Detect and resolve conflicting versions (vector clocks returning siblings, or last-writer-wins).', 'Optional TTL per key and range scans within a partition (wide-row style).'],
  nonFunctional: ['Always writable: accept writes during node, rack and zone failures (high availability over strict consistency).', 'p99 latency under 10 ms for single-key reads and writes inside a region.', 'Linear horizontal scaling to hundreds of nodes and petabytes; no single point of failure, no master.', 'Durability: no acknowledged write lost if fewer than W replicas fail permanently.', 'Operability: add or replace a node with background streaming, no manual resharding.'],
  outOfScope: ['Multi-key ACID transactions and secondary indexes (see Spanner/FoundationDB-style CP designs).', 'SQL queries and joins.', 'Strongly consistent compare-and-set across regions (would need Paxos/Raft per key, like Cassandra LWT).'],
  estimates: [
    ['Keys stored', '100 billion', 'Large multi-tenant platform: sessions, carts, user state, device data'],
    ['Average record size', '~1 KB', '~100 B key + ~900 B value and metadata'],
    ['Logical data', '~100 TB', '100 billion keys &times; 1 KB'],
    ['Physical data', '~400 TB', '&times; 3 replicas (N = 3) &times; ~1.3 LSM space amplification'],
    ['Average throughput', '~300k ops/s', 'Client operations, 70% reads / 30% writes'],
    ['Peak throughput', '~1M ops/s', '~3&times; average at daily and seasonal peaks'],
    ['Replica operations at peak', '~2.3M ops/s', '700k reads &times; R = 2 replicas + 300k writes &times; N = 3 replicas'],
    ['Write bandwidth (replicated)', '~0.9 GB/s', '300k writes/s &times; 3 replicas &times; 1 KB, before compaction rewrites'],
    ['Bloom filter memory', '~375 GB cluster-wide', '300 billion key copies &times; 10 bits per key (~1% false positives)']
  ],
  compute: [
    ['Storage nodes', '~110 nodes, each 16 vCPU / 128 GB RAM / 8 TB NVMe', '400 TB physical / (8 TB &times; 50% fill) = 100 nodes: keep half the disk free for compaction and for absorbing a failed neighbour’s data. +10% so a whole zone (1/3 of nodes) can be lost and the rest stay under 75% disk.'],
    ['Per-node throughput', '~23k replica ops/s per node at peak', '2.3M replica ops/s / 100 nodes. One NVMe-backed LSM node sustains ~80-100k mixed ops/s, so peak runs at ~25-30% utilisation, leaving room for compaction, repair streaming and losing a zone (+50% load on survivors).'],
    ['Memory per node', '~4 GB Bloom filters + ~32 GB block cache + memtables', '375 GB of filters / 100 nodes &asymp; 3.8 GB; block cache sized to the hot set (~10% of reads miss to disk); 2-4 memtables of 256 MB each.'],
    ['Coordinators', 'No separate tier', 'Every storage node coordinates requests for keys it owns (token-aware clients), so coordination scales with the cluster; no extra hop for most requests.'],
    ['Network per node', '~2 Gbit/s peak, 25 Gbit/s NICs', '~0.9 GB/s replicated writes + reads + repair streaming spread over 100 nodes is ~20 MB/s each; NIC headroom matters most when re-streaming a failed node’s 4 TB (~30 min at 20 Gbit/s if throttled to half).']
  ],
  api: [
    ['GET /kv/{key}?r=QUORUM', 'Returns value(s) plus an opaque <strong>context</strong> (vector clock). If replicas hold concurrent versions, all siblings are returned for the client to merge.'],
    ['PUT /kv/{key}?w=QUORUM  body: value, context', 'Writes a new version; the context says which version(s) this write supersedes, so the store can tell an update from a concurrent write.'],
    ['DELETE /kv/{key}?w=QUORUM', 'Writes a tombstone (deletion marker) that replicates like a value and is purged by compaction after a grace period (e.g. 10 days).'],
    ['gRPC Internal.Replicate(key, version, value, hint?)', 'Coordinator &rarr; replica write; carries an optional hint naming the intended owner when a fallback node stands in.'],
    ['gRPC Internal.MerkleRoot(range) / Diff(range, path)', 'Anti-entropy: compare hash trees for a token range and stream only the keys whose leaves differ.'],
    ['Gossip: Syn(digests) / Ack(deltas) / Ack2', 'Every second, each node exchanges heartbeat versions and ring state with 1-3 random peers.']
  ],
  data: [
    ['Ring / token map', 'Gossiped state on every node (seeded from a few seed nodes)', 'node id &rarr; ~16-256 virtual-node tokens, zone/rack, status (joining, normal, leaving), heartbeat generation + version.'],
    ['Record', 'LSM tree (RocksDB-style) on local NVMe', 'Partition key hashed (Murmur3, 64-bit) to a token; value, vector clock or timestamp, TTL, tombstone flag; sorted by key inside each SSTable.'],
    ['Write-ahead log', 'Append-only file per node', 'Every write appended (group-commit fsync every ~2-10 ms) before the memtable update; replayed on crash; truncated after memtable flush.'],
    ['SSTables', 'Immutable sorted files, levelled or size-tiered', 'Data blocks (~4-64 KB, compressed) + sparse index + Bloom filter + min/max key; merged by compaction.'],
    ['Hints', 'Local hint log on fallback nodes', 'intended owner, key, version, value, expiry (e.g. 3 h); replayed when the owner returns.'],
    ['Merkle trees', 'Built per token range during repair', 'Leaves = hashes of key ranges (2^15 leaves typical); parent = hash of children; compare top-down to find divergence.']
  ],
  dbChoice: [
    ['Per-node storage engine', 'LSM tree (RocksDB / Cassandra’s own engine)', 'Write-heavy, replicated workload: appends to the WAL and memtable are sequential, flushes create immutable files, so writes stay fast and SSD-friendly. Bloom filters keep point reads to ~1 disk read.', 'B-tree (InnoDB, WiredTiger): better read latency and less space amplification, but random in-place writes and page splits cost more under heavy writes.'],
    ['Partitioning', 'Consistent hashing with virtual nodes', 'Adding a node moves only ~1/N of the data, from many peers at once; vnodes even out load and let bigger machines own more tokens.', 'Range partitioning (Bigtable/HBase): enables ordered scans but needs a master to split hot ranges. Fixed hash slots (Redis Cluster): simpler but rebalancing is explicit.'],
    ['Replication', 'Leaderless, N = 3, tunable quorums', 'No failover pause: any replica takes reads and writes, so availability survives failures; R + W &gt; N gives read-your-writes when wanted.', 'Single leader per shard with Raft (CockroachDB, TiKV): linearisable and simpler conflicts, but writes stall during leader election and cross-zone latency is on every write.'],
    ['Conflict resolution', 'Last-writer-wins by default, vector clocks opt-in', 'LWW is simple and enough for most data (idempotent overwrites); vector clocks plus client merges protect carts and counters where losing an update matters.', 'CRDTs (Riak data types): automatic merges for sets/counters, limited to specific data types.']
  ],
  diagram: {
    nodes: [['app', 'App servers', 'client', 0, 1.2, 'token-aware client'], ['lb', 'Request router', 'lb', 1, 1.2, 'or client-side routing'], ['co', 'Coordinator', 'svc', 2, 1.2, 'any node owning key'],
      ['ring', 'Membership', 'svc', 2, 0, 'gossip + token ring'], ['fb', 'Fallback node', 'db', 2.2, 2.6, 'holds hints'],
      ['r1', 'Replica A', 'db', 3.5, 0, 'preference list #1'], ['r2', 'Replica B', 'db', 3.5, 1.2, 'preference list #2'], ['r3', 'Replica C', 'db', 3.5, 2.4, 'preference list #3'],
      ['wal', 'Commit log', 'blob', 5, 0, 'WAL, group fsync'], ['mem', 'Memtable', 'cache', 5, 1.1, 'sorted, in memory'], ['sst', 'SSTables', 'db', 6, 1.1, 'Bloom filter + index'],
      ['cmp', 'Compaction', 'job', 6, 2.3, 'merge, drop tombstones'], ['ae', 'Anti-entropy', 'job', 5, 3.3, 'Merkle tree repair']],
    edges: [['app', 'lb'], ['lb', 'co'], ['co', 'ring', 'token map'], ['ring', 'r1', 'gossip', 'none'], ['co', 'r1'], ['co', 'r2'], ['co', 'r3'], ['co', 'fb', 'sloppy quorum'], ['fb', 'r3', 'hinted handoff', 'async'],
      ['r1', 'wal'], ['r1', 'mem'], ['mem', 'sst', 'flush', 'async'], ['sst', 'cmp', '', 'async'], ['ae', 'r2', '', 'async'], ['ae', 'r3', '', 'async']],
    zones: [['Storage engine on each node (LSM)', 5, 0, 6, 2.3]]
  },
  flows: [
    { name: 'Quorum write (W = 2)', desc: 'A put with N = 3, W = 2: acknowledged once two replicas have it durably, while the third catches up.', steps: [
      ['app', 'lb', 'PUT cart:42 (context)', 'The client sends the new value plus the context (vector clock) it read, so the store knows which version this overwrites.'],
      ['lb', 'co', 'route to an owner', 'A token-aware client or router sends the request straight to a node in the key’s preference list, saving a hop and keeping the coordinator one of the replicas.'],
      ['co', 'ring', 'hash(key): preference list', 'Murmur3(key) gives a token; walking clockwise round the ring, skipping vnodes on the same physical node or zone, yields the first 3 distinct replicas (the ring is cached locally, so this is a memory lookup).'],
      ['ring', 'co', 'replicas A, B, C', 'The coordinator also bumps its own counter in the vector clock, e.g. [A:3] → [A:4], marking this version as a descendant of the one the client read.', 'resp'],
      { par: [['co', 'r1', 'replicate v[A:4]'], ['co', 'r2', 'replicate v[A:4]'], ['co', 'r3', 'replicate v[A:4]']], msg: 'The write is sent to all N replicas in parallel; the coordinator waits only for W of them, so one slow replica does not add latency.' },
      ['r1', 'wal', 'append + group fsync', 'Each replica appends to its commit log first (durability), batching fsyncs every few milliseconds to keep IOPS low.'],
      ['r1', 'mem', 'insert into memtable', 'Then it inserts into the in-memory sorted memtable (a skip list); no disk seek on the write path.'],
      { par: [['r1', 'co', 'ack', 'resp'], ['r2', 'co', 'ack', 'resp']], msg: 'Two acks arrive: W = 2 is met. Replica C’s ack can arrive later or not at all.' },
      ['co', 'app', '200 OK', 'Acknowledged in a few milliseconds. Because W + R > N (2 + 2 > 3), any later quorum read overlaps at least one replica that has this version.', 'resp']],
      end: 'Leaderless quorum writes need no election and tolerate one slow or dead replica per key with no latency penalty.' },
    { name: 'Quorum read + read repair', desc: 'A get with R = 2 finds a stale replica, returns the newest version and repairs the laggard in the background.', steps: [
      ['app', 'lb', 'GET cart:42', 'Read with consistency QUORUM.'],
      ['lb', 'co', 'route to an owner', 'Routed to a replica of the key.'],
      { par: [['co', 'r1', 'read (full value)'], ['co', 'r2', 'read (digest only)']], msg: 'The coordinator asks the closest replica for the data and another for just a hash (digest) to save bandwidth; R = 2.' },
      ['r1', 'mem', 'memtable lookup', 'Newest data first: the memtable, then SSTables newest to oldest.'],
      ['mem', 'sst', 'Bloom filters, then 1 block', 'Bloom filters rule out SSTables that cannot hold the key, so a point read usually costs one block read (often from the block cache).'],
      ['r1', 'co', 'v[A:4]', 'Replica A returns the latest version.', 'resp'],
      ['r2', 'co', 'digest of v[A:3]', 'Replica B’s digest differs: it missed the last write.', 'err'],
      ['co', 'app', '200 v[A:4] + context', 'A:4 descends from A:3, so it wins without a conflict and is returned. Had the clocks been concurrent (e.g. [A:4] vs [A:3,B:1]) both would be returned as siblings.', 'resp'],
      ['co', 'r2', 'read repair: write v[A:4]', 'The coordinator pushes the newer version to the stale replica asynchronously, so frequently read keys converge quickly.', 'async']],
      end: 'Read repair fixes hot keys on the read path; rarely read keys are fixed by Merkle-tree anti-entropy.' },
    { name: 'Replica down: hinted handoff', desc: 'Replica C is unreachable. A sloppy quorum lets the write succeed on a fallback node that keeps a hint.', steps: [
      ['app', 'lb', 'PUT user:7', 'A normal write.'],
      ['lb', 'co', 'route', 'Routed to an owner.'],
      ['co', 'r3', 'replicate', 'Replica C does not answer; gossip already marks it as suspected (phi accrual detector above threshold).', 'err'],
      { par: [['co', 'r1', 'replicate'], ['co', 'fb', 'replicate + hint(owner=C)']], msg: 'Sloppy quorum: the next healthy node clockwise on the ring takes C’s copy, tagged with a hint naming the intended owner.' },
      ['r1', 'co', 'ack', 'Replica A acks.', 'resp'],
      ['fb', 'co', 'ack', 'The fallback counts towards W = 2, so the write is still acknowledged and the system stays writable.', 'resp'],
      ['co', 'app', '200 OK', 'The client never sees the failure.', 'resp'],
      ['ring', 'fb', 'gossip: C is alive', 'Minutes later C rejoins and its heartbeat generation spreads by gossip within a few seconds.'],
      ['fb', 'r3', 'replay hints', 'The fallback streams stored hints to C (throttled) and deletes them once C acks. Hints expire after ~3 h; longer outages are left to anti-entropy.', 'async']],
      end: 'Sloppy quorum + hinted handoff keeps writes available, at the price that W acknowledgements may not all be on the key’s real owners, so R + W > N is no longer a strict guarantee during failures.' },
    { name: 'Anti-entropy + compaction', desc: 'Background processes that keep replicas identical and storage tidy.', steps: [
      ['ae', 'r2', 'build Merkle tree (range)', 'A scheduled repair asks replica B to hash its data for one token range into a Merkle tree (leaves cover small key ranges).', 'async'],
      ['ae', 'r3', 'build Merkle tree (range)', 'Replica C does the same for the same range.', 'async'],
      ['r3', 'ae', 'roots differ: compare down', 'Roots differ, so compare children recursively: only subtrees with different hashes are explored, about log(n) comparisons per divergent leaf.', 'resp'],
      ['ae', 'r3', 'stream differing keys', 'Only keys in mismatched leaves are exchanged and reconciled (newest or merged version wins), so repair bandwidth tracks the divergence, not the data size.', 'async'],
      ['mem', 'sst', 'flush memtable', 'Meanwhile, a full memtable (~256 MB) is frozen and written sequentially as a new SSTable; the WAL segment is then discarded.', 'async'],
      ['sst', 'cmp', 'pick overlapping SSTables', 'Compaction merges SSTables (levelled: L0 into L1 and so on), keeping the newest version of each key.', 'async'],
      ['cmp', 'sst', 'write merged SSTable', 'Old versions and tombstones older than the grace period are dropped; reads touch fewer files afterwards.', 'async']],
      end: 'Run full repair on every range within the tombstone grace period (e.g. weekly with a 10-day grace), or deleted data can be resurrected by a replica that missed the delete.' }
  ],
  components: [
    ['Token-aware client / router', 'Hash the key, pick a live replica from the cached ring, retry or speculatively re-send to another replica after a p99 timeout.'],
    ['Coordinator (any node)', 'Build the preference list, fan out to N replicas, wait for R or W, reconcile versions, trigger read repair and hints.'],
    ['Membership and failure detection', 'Gossip heartbeats every second; phi accrual failure detector; seed nodes for bootstrap; ring changes versioned and propagated epidemically.'],
    ['Replica storage engine', 'Commit log, memtable, SSTables with Bloom filters and indexes, block cache; levelled or size-tiered compaction.'],
    ['Hinted handoff', 'Hold writes for temporarily dead owners and replay them on recovery, with expiry and throttling.'],
    ['Anti-entropy repair', 'Merkle-tree comparison per token range between replicas; incremental repair of only unrepaired SSTables.'],
    ['Streaming / bootstrap', 'When a node joins or is replaced, stream the token ranges it now owns from current replicas, throttled to protect live traffic.']
  ],
  evolutionTitle: 'From one box to a Dynamo-style cluster',
  evolution: [
    { name: '1. Single node', desc: 'An embedded LSM engine (RocksDB) behind a small server. Fast and simple, but capacity and availability are one machine.', diagram: { nodes: [['c', 'Clients', 'client', 0, 0], ['s', 'KV server', 'svc', 1.5, 0, 'RocksDB'], ['d', 'Local NVMe', 'db', 3, 0, 'WAL + SSTables']], edges: [['c', 's'], ['s', 'd']] },
      steps: [['c', 's', 'put/get', 'Every request goes to one process.'], ['s', 'd', 'WAL + memtable', 'Writes are durable after the WAL fsync.'], ['s', 'c', 'ok', 'Microsecond-level latency, but a disk failure loses data and a restart is downtime.', 'resp']] },
    { name: '2. Hash sharding', desc: 'Split keys across nodes with hash(key) mod n. Capacity scales, but changing n moves almost every key.', diagram: { nodes: [['c', 'Clients', 'client', 0, 1], ['r', 'Router', 'lb', 1.5, 1, 'hash mod n'], ['a', 'Shard 0', 'db', 3, 0], ['b', 'Shard 1', 'db', 3, 1], ['d', 'Shard 2', 'db', 3, 2]], edges: [['c', 'r'], ['r', 'a'], ['r', 'b'], ['r', 'd']] },
      steps: [['c', 'r', 'put k', 'The router hashes the key.'], ['r', 'b', 'hash(k) mod 3 = 1', 'Each key lives on exactly one shard.'], ['r', 'd', 'add shard 3?', 'Going from 3 to 4 shards remaps ~75% of keys: a huge, risky migration. And each shard is still a single point of failure.', 'err']] },
    { name: '3. Ring + replicas + quorums', desc: 'Consistent hashing with virtual nodes moves only ~1/n of keys per change; each key on N = 3 nodes with quorum reads and writes.', diagram: { nodes: [['c', 'Clients', 'client', 0, 1], ['co', 'Coordinator', 'svc', 1.5, 1, 'any node'], ['a', 'Replica 1', 'db', 3, 0], ['b', 'Replica 2', 'db', 3, 1], ['d', 'Replica 3', 'db', 3, 2], ['g', 'Gossip', 'svc', 4.5, 1, 'membership']], edges: [['c', 'co'], ['co', 'a'], ['co', 'b'], ['co', 'd'], ['a', 'g', '', 'none'], ['b', 'g', '', 'none'], ['d', 'g', '', 'none']] },
      steps: [['c', 'co', 'put k', 'Any node can coordinate.'], { par: [['co', 'a', 'write'], ['co', 'b', 'write'], ['co', 'd', 'write']], msg: 'Write to the 3 replicas on the preference list; wait for W = 2.' }, ['b', 'g', 'heartbeats', 'Gossip spreads liveness, so hints, repairs and routing react to failures automatically.']] }
  ],
  deep: [
    ['Consistent hashing and virtual nodes', '<p>Hash every key and every node token onto a 64-bit ring; a key belongs to the first token clockwise from its hash, and its N replicas are the next N <em>distinct physical nodes</em> (skipping vnodes of the same node and, with rack-awareness, the same zone). With one token per node, load is lumpy and a new node takes data from just one neighbour. With <strong>virtual nodes</strong> (Cassandra now defaults to 16 tokens per node with a token-allocation algorithm; older clusters used 256) each machine owns many small ranges, so:</p><ul><li>load is even (standard deviation falls roughly with 1/&radic;vnodes);</li><li>a joining node streams from many peers in parallel, and a dead node’s load spreads across many survivors;</li><li>heterogeneous hardware gets more or fewer tokens.</li></ul><p>Too many vnodes hurt: repair has more ranges to compare and availability drops because any two node failures are more likely to share a range. Adding a node moves only ~1/n of the keys, versus ~all keys for <code>hash mod n</code>.</p>'],
    ['Quorums, sloppy quorums and what R + W &gt; N really buys', '<p>With N replicas, a write waits for W acks and a read for R replies. If <strong>R + W &gt; N</strong> the read set and write set intersect, so a read sees the latest acknowledged write (when nothing fails). Typical settings:</p><table><tr><th>N/R/W</th><th>Behaviour</th></tr><tr><td>3/2/2</td><td>Balanced; tolerates 1 replica down for both reads and writes.</td></tr><tr><td>3/1/3</td><td>Fast reads, writes fail if any replica is down.</td></tr><tr><td>3/1/1</td><td>Lowest latency, eventual consistency only.</td></tr></table><p>Caveats interviewers probe: quorums are <em>not</em> linearisable (concurrent reads during a write can disagree, LWW with clock skew can drop writes); <strong>sloppy quorums</strong> count fallback nodes, so the overlap guarantee breaks during failures; and multi-region deployments use <code>LOCAL_QUORUM</code> to keep cross-region latency off the request path. For compare-and-set, Cassandra layers Paxos (lightweight transactions, Accord in 5.x) on top.</p>'],
    ['Versioning: vector clocks vs last-writer-wins', '<p>A <strong>vector clock</strong> is a list of (node, counter) pairs attached to each version. Version X <em>descends</em> from Y if every counter in X &ge; Y’s; otherwise they are <em>concurrent</em> and both are kept as siblings. Example: a cart is written via node A &rarr; <code>[A:1]</code>, then concurrently updated via A and B during a partition &rarr; <code>[A:2]</code> and <code>[A:1,B:1]</code>. Neither descends from the other, so a read returns both and the client merges (union of cart items) and writes back with the combined context <code>[A:2,B:1]</code>. Clocks are truncated to ~10 entries (oldest by timestamp) to bound size; Riak replaced per-node clocks with <strong>dotted version vectors</strong> to avoid sibling explosion.</p><p><strong>Last-writer-wins</strong> (Cassandra, DynamoDB) keeps the version with the highest timestamp per cell: no siblings and no client merge logic, but concurrent writes are silently lost and clock skew decides the winner, so run NTP/PTP and design writes to be idempotent overwrites. Use CRDT types (counters, sets) when merges must be automatic.</p>'],
    ['Inside a node: the LSM tree', '<ol><li><strong>Write:</strong> append to the WAL (group commit), insert into the memtable (skip list). O(1) sequential I/O.</li><li><strong>Flush:</strong> when the memtable reaches ~64-256 MB it becomes immutable and is written as a sorted SSTable with a sparse index and a Bloom filter.</li><li><strong>Read:</strong> memtable &rarr; immutable memtables &rarr; SSTables newest to oldest. Bloom filters (10 bits/key &asymp; 1% false positives) skip files that cannot contain the key; the index finds the single block to read.</li><li><strong>Compaction:</strong> merge SSTables to bound read amplification and reclaim space. <em>Size-tiered</em> (merge similar-sized files) has low write amplification but needs up to 2&times; free space; <em>levelled</em> (each level 10&times; the previous, non-overlapping files) keeps reads to ~1 file per level at ~10-30&times; write amplification. Time-window compaction suits TTL’d time series.</li><li><strong>Deletes</strong> are tombstones; they must outlive the repair interval (<code>gc_grace_seconds</code>) or a replica that missed the delete will resurrect the data.</li></ol>'],
    ['Gossip and failure detection', '<p>Each node keeps a heartbeat (generation = boot time, version = counter) for every peer. Every second it picks 1-3 random peers and exchanges digests; newer state wins. Information reaches all <em>n</em> nodes in O(log n) rounds, so a 500-node cluster converges in a few seconds without a central coordinator. Failure detection uses the <strong>phi accrual</strong> detector: instead of a fixed timeout it computes the suspicion level &phi; from the observed inter-arrival distribution of heartbeats, and marks a node down when &phi; &gt; 8 (tunable). <em>Down</em> in gossip only means "stop routing to it and start hinting"; permanent removal (decommission, replace) is an explicit operator action, because automatically re-replicating 4 TB on every network blip would be worse than the blip.</p>']
  ],
  scale: [
    '<strong>Adding capacity:</strong> bootstrap new nodes one at a time; each takes ~1/n of the tokens and streams from many peers. Keep disks under ~50-60% so compaction and rebalancing always have room.',
    '<strong>Hot partitions:</strong> one key or partition getting a large share of traffic overloads its N replicas whatever the cluster size. Fix in the data model (salt keys with a suffix, split wide partitions by time bucket), add a cache in front, and enable adaptive capacity or replica reads at ONE for hot read-only data.',
    '<strong>Tail latency:</strong> use speculative retry (resend to another replica after the p99) and token-aware, latency-aware routing; pin compaction threads so they do not starve request threads; watch GC pauses on JVM-based nodes (ScyllaDB’s shard-per-core design avoids them).',
    '<strong>Large partitions and tombstones:</strong> partitions over ~100 MB or reads scanning thousands of tombstones explode latency; cap partition size by bucketing and prefer TTLs over explicit deletes for queues-as-tables.',
    '<strong>Multi-region:</strong> replicate per data centre (e.g. NetworkTopologyStrategy with 3 replicas per region), use LOCAL_QUORUM for requests, and let cross-region replication be asynchronous with hints and repair.'
  ],
  tradeoffs: [
    ['Consistency model', 'Leaderless quorums (AP) vs leader-per-shard consensus (CP)', 'Leaderless for an always-writable store with no failover pauses; accept eventual consistency and conflict handling. Pick Raft-based stores (etcd, TiKV, CockroachDB) when correctness needs linearisability.'],
    ['Conflict resolution', 'Vector clocks + siblings vs LWW vs CRDTs', 'LWW by default for simplicity; vector clocks or CRDTs only for data where concurrent updates must merge (carts, counters, sets).'],
    ['Compaction strategy', 'Size-tiered vs levelled vs time-window', 'Levelled for read-heavy point lookups; size-tiered for write-heavy; time-window for TTL’d time series. Choose per table.'],
    ['Virtual nodes', 'Few (4-16) vs many (256) tokens per node', 'Around 16 with a token-allocation algorithm: even load without making repair slow and multi-failure data loss more likely.'],
    ['Quorum levels', 'ONE vs QUORUM vs ALL', 'QUORUM (or LOCAL_QUORUM) for user data; ONE for caches, metrics and idempotent writes where latency matters more than freshness.']
  ],
  failures: [
    ['Single node crashes', 'Replicas keep serving (N = 3, R = W = 2); hints buffer its writes; on restart it replays its WAL, receives hints and catches up.'],
    ['Disk permanently lost', 'Replace the node with the same tokens and stream data from the surviving replicas; run repair on its ranges afterwards.'],
    ['Whole zone lost', 'Rack/zone-aware placement puts each key’s 3 replicas in 3 zones, so QUORUM still succeeds with 2 zones; capacity planned for +50% load on survivors.'],
    ['Network partition', 'Both sides keep accepting writes (sloppy quorum); divergent versions are reconciled by vector clocks or LWW once healed, and anti-entropy repairs the rest.'],
    ['Deleted data reappears', 'Caused by a replica missing a tombstone longer than the grace period. Run full repair within gc_grace on every range and alert on repair lag.'],
    ['Clock skew with LWW', 'Writes from a node with a fast clock win incorrectly. Enforce NTP/PTP with skew alarms; use client-supplied timestamps or vector clocks for sensitive data.'],
    ['Compaction falls behind', 'Read amplification and disk usage climb. Alert on pending compactions, throttle ingestion, add nodes, or switch the table to a better-suited strategy.']
  ],
  cloud: [['Managed Dynamo-style store', 'nosql'], ['Managed Cassandra-compatible', 'widecol'], ['Self-hosted nodes on VMs', 'vms'], ['Kubernetes operator (StatefulSets)', 'k8s'], ['Local NVMe instances', 'Lsv3 / Lsv4 VMs (local NVMe)', 'EC2 i4i / i7ie instances'],
    ['Snapshots and backups', 'blob'], ['Client entry / router', 'lb'], ['Private networking', 'network'], ['TLS certificates and secrets', 'secrets'], ['Metrics and alerts', 'monitor'], ['Logs', 'logs'], ['Change data to analytics', 'stream'], ['Cache in front of hot keys', 'cache']],
  refs: { az: ['azp-sharding', 'azPartition', 'azDataStore', 'azMission', 'azTransient', 'azp-health-endpoint-monitoring'],
          aws: ['awsDdbBest', 'blDistributed', 'blStatic', 'blShuffle', 'blBackoff', 'blConstant'] },
  questions: [
    ['Why not just use hash(key) mod n?', 'Changing n remaps almost every key: going from 10 to 11 nodes moves ~91% of data. Consistent hashing moves only the keys in the ranges the new node takes over (~1/11), and virtual nodes spread that movement across many peers.'],
    ['Does R + W &gt; N make the store strongly consistent?', 'No. It gives overlap between read and write sets when membership is stable, so you read the latest acknowledged write in the common case. It is not linearisable: concurrent reads during an in-flight write can see different results, sloppy quorums break the overlap during failures, and LWW can drop concurrent writes. Linearisability needs consensus (Paxos/Raft) per key or shard.'],
    ['How does a replica that was down for an hour catch up?', 'Three layers: hinted handoff replays writes buffered by fallback nodes (if within the hint window), read repair fixes keys as they are read, and scheduled Merkle-tree anti-entropy finds and streams every remaining difference.'],
    ['How do you detect failures without a master?', 'Gossip heartbeats with a phi accrual failure detector. Each node independently decides a peer is suspect; routing and hinting react locally. Permanent membership changes are explicit operator actions so transient blips do not trigger mass re-replication.'],
    ['Why an LSM tree instead of a B-tree?', 'The workload is write-heavy and replicated 3&times;. LSM turns every write into sequential appends (WAL + memtable flush), which is SSD-friendly and fast. The cost is read and space amplification, controlled by Bloom filters, block caches and compaction.'],
    ['How would you support multiple regions?', 'Place 3 replicas per region, route clients to the local region, use LOCAL_QUORUM so requests never wait on another region, and replicate asynchronously across regions with hints and repair. Conflicts across regions are resolved by LWW or vector clocks, which is why this design suits data that tolerates eventual consistency.']
  ],
  related: ['distributed-cache', 'message-queue', 'data', 'unique-id', 'reliability']
});

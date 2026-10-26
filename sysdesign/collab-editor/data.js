SD.renderCase({
  slug: 'collab-editor',
  summary: 'A collaborative editor lets many people edit the same document at the same time and see each other’s changes, cursors and selections within about 100 ms, while also working offline and never losing a keystroke. The hard part is not storage but <strong>convergence</strong>: concurrent edits made against different versions of the document must merge so that every replica ends up identical and the result matches what users intended. The two families of solution are <strong>operational transformation (OT)</strong>, where a central server orders operations and transforms late ones against earlier ones, and <strong>CRDTs</strong> (RGA, YATA/Yjs, Automerge, Fugue), where every character carries a unique id so merges commute without a central arbiter. Around that core sits a classic real-time architecture: WebSocket gateways, one <strong>document session server</strong> that owns each live document (routed by document id with a lease), an append-only operation log with periodic snapshots, ephemeral presence, permissions and version history.',
  examples: 'Google Docs (OT with a central server), Microsoft 365 co-authoring and Fluid Framework (total-order broadcast with distributed data structures), Figma (server-authoritative, CRDT-inspired property merges), Notion, Linear, Confluence (Synchrony), and open-source stacks built on Yjs, Automerge or Liveblocks.',
  functional: ['Several users open the same document and edit simultaneously; everyone converges to the same content.', 'See collaborators’ presence: avatars, live cursors and selections.', 'Edit offline (or on a flaky connection) and merge automatically on reconnect.', 'Share with view / comment / edit roles; revoke access and have it take effect on live sessions.', 'Version history: browse and restore earlier versions, named versions, “who changed this”.', 'Comments and suggestions anchored to text ranges that survive later edits.'],
  nonFunctional: ['Local edits appear instantly (optimistic); remote edits visible in &lt; 200 ms p95 within a region.', 'No acknowledged edit is ever lost (durable before ack); RPO 0 for acknowledged ops.', 'Convergence is guaranteed: all replicas that have seen the same set of ops show identical documents.', '99.95% availability for editing; a session server failure causes at most a few seconds of reconnect.', 'Scale to tens of millions of daily users and documents with up to ~100 concurrent editors (and thousands of viewers).'],
  outOfScope: ['Rich layout engines and rendering (pagination, fonts).', 'Spreadsheet formula recalculation.', 'Full-text search ranking (we only feed an index).'],
  estimates: [
    ['Daily active users', '50 million', 'Of ~500 M registered accounts'],
    ['Peak concurrent connections', '~5 million', '10% of DAU online at the busiest hour'],
    ['Open documents at peak', '~2.5 million', 'Average ~2 connections per open doc; most docs have a single editor'],
    ['Edit updates at peak', '~1 million ops/s', '10% of connections typing at once = 500 K &times; ~2 batched updates/s (client batches keystrokes every ~50-500 ms)'],
    ['Op size', '~150 bytes', 'CRDT update (ids, origin, content) plus envelope; compressed binary encoding (Yjs v2)'],
    ['Op log ingest', '~150 MB/s peak, ~5 TB/day', '1 M &times; 150 B; daily average about a third of peak'],
    ['Broadcast fan-out', '~1.5 million msgs/s', 'Each op goes to the other editors and viewers of the doc (average ~1.5 others)'],
    ['Presence / cursor updates', '~2 million msgs/s', '5 M connections &times; 10% moving &times; 4/s (throttled); never persisted'],
    ['Document storage', '~250 TB snapshots + ~1 PB history', '5 B documents &times; ~50 KB snapshot; compacted op history and version checkpoints on top']
  ],
  compute: [
    ['WebSocket gateways', '~150 nodes (8 vCPU, 32 GB), 50 per zone', '5 M connections / ~50 K per node (TLS + ~20 KB per connection) = 100 nodes; ~3.5 M msgs/s / 100 = 35 K msgs/s per node is comfortable. Add 50% so two zones can carry everything: 150.'],
    ['Document session servers', '~36 nodes (8 vCPU, 64 GB), 12 per zone', 'CPU: 1 M ops/s &times; ~100 &micro;s (decode, integrate, encode, fan-out) = 100 busy cores &rArr; ~170 at 60% &rArr; 22 nodes. Memory: 2.5 M docs &times; ~200 KB in-memory CRDT = 500 GB &rArr; 16 nodes at 32 GB usable. 36 nodes leaves 24 after a zone loss.'],
    ['Operation log (Cassandra / ScyllaDB)', '~75 nodes, RF 3', 'Group commit per doc (50 ms) turns 1 M ops/s into ~600 K writes/s &times; RF 3 = 1.8 M replica writes/s; ~40 K writes/s per NVMe node &rArr; 45 busy &rArr; 75 at 60%.'],
    ['Snapshot / compaction workers', '~20 &times; 4 vCPU, autoscaled on lag', 'One snapshot per 1,000 ops: 1 K snapshots/s &times; ~50 ms CPU = 50 cores; ~200 MB/s to object storage.'],
    ['Metadata + ACL database', 'PostgreSQL sharded by doc id (e.g. Citus), 8 shards', 'Opens and permission checks ~50 K/s at peak; cached ACLs answer ~90%, leaving ~5 K reads/s per shard set.'],
    ['Session directory', '3-node etcd or Redis cluster per region', '2.5 M leases renewed every ~3 s = ~800 K small writes/s: batch renewals per session server (one heartbeat covers all its docs) to bring this down to ~12 heartbeats/s.']
  ],
  api: [
    ['POST /docs  |  GET /docs/{id}', 'Create or open a document. Open returns metadata, the caller’s role, and a short-lived signed session ticket (doc id, user, role, expiry) for the WebSocket.'],
    ['WS /sync?doc={id}&ticket=...', 'Upgrade to WebSocket; the gateway routes the connection to the session server that owns the doc.'],
    ['ws: join {stateVector} → sync {missingUpdates, seq}', 'Client sends what it has (a Yjs state vector: highest clock seen per client id); server replies with exactly the missing updates. Used on first load and every reconnect.'],
    ['ws: update {clientId, clock, bytes} → ack {seq}', 'Edit. Idempotent by (clientId, clock); the server persists, assigns a doc-level seq for history and broadcasts to others.'],
    ['ws: awareness {cursor, selection, name, colour}', 'Ephemeral presence, throttled to ~4/s, last-writer-wins per user, expires after 30 s without heartbeat.'],
    ['GET /docs/{id}/versions  |  POST /docs/{id}/versions/{v}:restore', 'Version history and restore (restore is a new forward edit, never a rewrite of history).'],
    ['PUT /docs/{id}/permissions', 'Share or revoke; publishes an ACL-changed event so session servers re-check live connections.']
  ],
  data: [
    ['documents', 'PostgreSQL, sharded by doc_id', 'doc_id (UUIDv7), owner_id, title, latest_snapshot_seq, latest_seq, created/updated; index on owner_id and updated_at for “recent docs”.'],
    ['acl_entries', 'PostgreSQL (same shard as the doc)', '(doc_id, principal_id) &rarr; role; secondary index principal_id for “shared with me”; link-sharing settings on the document row.'],
    ['op_log', 'Cassandra / ScyllaDB', 'Partition (doc_id, seq_bucket = seq / 100,000), clustering seq; columns client_id, clock, user_id, ts, update bytes. Append-only; rows below the latest snapshot are compacted into history checkpoints.'],
    ['snapshots', 'Object storage', 'docs/{doc_id}/snap/{seq}.bin: full encoded state at seq; named versions are pinned snapshots that compaction never deletes.'],
    ['session_directory', 'etcd / Redis', 'doc_id &rarr; {owner_node, epoch, lease_expiry}; epoch is a fencing token checked on every op-log write.'],
    ['presence', 'Session server memory (+ Redis TTL key for “viewing now” badges)', 'doc_id:user &rarr; cursor, selection, colour; TTL 30 s; never written to durable storage.']
  ],
  dbChoice: [
    ['Operation log', 'Wide-column store (Cassandra / ScyllaDB) or DynamoDB / Cosmos DB', 'Pure append with range reads by (doc, seq): exactly the partition + clustering key shape. Linear write scaling to millions of writes/s; conditional writes (LWT / condition expression) on the epoch enforce a single writer per doc.', 'Kafka as the log: great throughput, but per-document random reads for reconnect catch-up are awkward. PostgreSQL: fine for one shard, painful at 600 K writes/s.'],
    ['Document metadata and ACLs', 'Relational (PostgreSQL / Azure SQL), sharded by doc id', 'Transactions across document + ACL rows, flexible queries (“docs shared with me, sorted by last edit”), modest write rate.', 'Document DB: workable, but the permission joins and listing queries fit SQL better.'],
    ['Snapshots and version checkpoints', 'Object storage', 'Large immutable blobs, cheap, 11 nines durability; read once per session load.', 'Storing blobs in the op-log table bloats partitions and compaction.'],
    ['Session ownership leases', 'etcd (Raft) or Redis with fencing', 'Needs linearisable compare-and-set and TTL leases so exactly one server owns a doc; tiny data set.', 'Consistent hashing alone: membership changes can briefly give two owners; still needs fencing on writes.']
  ],
  diagram: {
    nodes: [['u', 'Editors', 'client', 0, 1.5, 'browser, desktop, mobile'], ['edge', 'Edge + WAF', 'edge', 1, 1.5, 'TLS, DDoS'], ['api', 'Doc API', 'svc', 2, 0.4, 'open, share, history'],
      ['gw', 'WebSocket gateway', 'gw', 2, 2.1, 'connections, routing'], ['meta', 'Docs + ACLs', 'db', 3, 0.4, 'PostgreSQL, sharded'], ['dir', 'Session directory', 'cache', 3, 3.1, 'doc id → owner lease'],
      ['sess', 'Session servers', 'svc', 4, 2.1, 'one owner per doc'], ['pres', 'Presence', 'cache', 5, 0.9, 'Redis TTL + pub/sub'], ['log', 'Op log', 'nosql', 6, 2.1, 'Cassandra (doc, seq)'],
      ['bus', 'Doc events', 'stream', 4, 3.3, 'Kafka'], ['wk', 'Snapshot workers', 'worker', 5, 3.3, 'compaction, indexing'], ['snap', 'Snapshots', 'blob', 6, 3.3, 'object storage']],
    edges: [['u', 'edge'], ['edge', 'api'], ['edge', 'gw', 'WebSocket'], ['api', 'meta'], ['gw', 'dir'], ['gw', 'sess'], ['sess', 'meta', 'ACL check'], ['sess', 'pres'], ['sess', 'log', 'append'],
      ['sess', 'bus', '', 'async'], ['bus', 'wk', '', 'async'], ['wk', 'snap'], ['wk', 'log', 'read tail'], ['sess', 'snap', 'load']]
  },
  flows: [
    { name: 'Open and join', desc: 'A user opens a document: permission check, then a WebSocket routed to the single session server that owns the document.', steps: [
      ['u', 'edge', 'GET /docs/42', 'The browser asks for the document over HTTPS; the edge terminates TLS and applies WAF rules.'],
      ['edge', 'api', 'forward', 'Plain HTTP calls go to the stateless Doc API.'],
      ['api', 'meta', 'role(doc 42, user)', 'Look up the ACL (cached). The API never serves content without a role: viewer, commenter or editor.'],
      ['api', 'u', 'metadata + session ticket', 'Returns a signed ticket valid for 60 s containing doc id, user and role, so the gateway need not query the ACL again.', 'resp'],
      ['u', 'gw', 'WS /sync?doc=42', 'The client opens a WebSocket with the ticket; the gateway verifies the signature locally.'],
      ['gw', 'dir', 'who owns doc 42?', 'All editors of one document must meet on the same server so it can order and fan out their ops in memory.'],
      ['dir', 'gw', 'sess-7, epoch 19', 'If no live owner exists, the directory grants a new lease to the least-loaded session server (compare-and-set).', 'resp'],
      ['gw', 'sess', 'join {stateVector}', 'The gateway proxies the connection. If the doc is not in memory, the session server loads it first.'],
      { par: [['sess', 'snap', 'latest snapshot'], ['sess', 'log', 'ops after snapshot seq']], msg: 'Load = newest snapshot + the op-log tail since it, so load time is bounded no matter how old the document is.' },
      ['sess', 'u', 'sync: missing updates', 'The client receives only what its state vector says it lacks (empty cache: everything), plus who else is here.', 'resp']],
      end: 'Routing by document id to a single owner turns a distributed merge problem into a local, in-memory one for live sessions.' },
    { name: 'Concurrent edits', desc: 'Two people type at the same spot at the same moment. The CRDT ids make the merge deterministic everywhere.', steps: [
      ['u', 'gw', 'update (A, clock 81)', 'Alice types “X” after “a”. Her editor applies it locally at once (optimistic) and sends the CRDT update: id (A,81), origin = id of “a”.'],
      ['gw', 'sess', 'forward', 'At nearly the same time Bob’s update (B,57), also with origin “a”, reaches the same session server via another gateway.'],
      ['sess', 'log', 'append 1043-44 if epoch=19', 'The server integrates both: the CRDT orders siblings with the same origin deterministically (by client id), so every replica produces “aYXbc” whatever the arrival order. The updates are group-committed within ~50 ms; the conditional write on the epoch rejects any stale owner (fencing).'],
      ['log', 'sess', 'ok', 'Durable on a quorum of replicas.', 'resp'],
      ['sess', 'gw', 'ack + broadcast', 'Ack to the senders (they drop the op from their pending buffer) and broadcast each update to all other connections on the doc.', 'resp'],
      ['gw', 'u', 'remote update', 'Each client integrates the other’s update. Because CRDT merge is commutative and idempotent, duplicates and reordering are harmless.', 'resp'],
      ['sess', 'bus', 'doc.changed (seq 1044)', 'Downstream consumers (snapshotting, search indexing, notifications, activity feed) react asynchronously.', 'async']],
      end: 'Ack only after the op is durable; broadcast at the same time. Clients keep unacked ops and resend them after any reconnect, and idempotent ids make that safe.' },
    { name: 'Presence and cursors', desc: 'Cursor moves are frequent, tiny and disposable: keep them off the durable path entirely.', steps: [
      ['u', 'gw', 'awareness {cursor: (A,77)}', 'The cursor is expressed as a CRDT position (id of the character), not an integer offset, so it stays correct while others type.'],
      ['gw', 'sess', 'forward (throttled 4/s)', 'Clients throttle and coalesce; the gateway drops excess updates rather than queueing them.'],
      ['sess', 'gw', 'broadcast to doc peers', 'The session server keeps presence in memory (last-writer-wins per user) and fans it out. Nothing is persisted.', 'resp'],
      ['sess', 'pres', 'SET viewing:42:user TTL 30s', 'A coarse “who is viewing” record in Redis drives avatars in file lists and notifications, outside the editor.', 'async'],
      ['gw', 'u', 'peer cursors', 'Remote cursors render with the user’s colour; they fade if no heartbeat arrives for 30 s.', 'resp']],
      end: 'Presence is soft state: if it is lost, clients simply resend it within seconds. Treating it like edits would multiply the durable write load several times.' },
    { name: 'Offline edit and merge', desc: 'A user edits on a plane for two hours, then reconnects.', steps: [
      ['u', 'edge', 'offline: requests fail', 'The network is gone, but the editor keeps working on its local replica and persists every update to IndexedDB, so a browser crash loses nothing.', 'err'],
      ['u', 'gw', 'reconnect: join {stateVector}', 'On reconnect the client sends its state vector; the server can compute what the client is missing.'],
      ['gw', 'sess', 'route by doc id', 'Directory lookup as usual; the doc may now live on a different session server.'],
      ['sess', 'u', 'missing remote updates', 'Server sends updates the client has not seen; the client sends its 2 hours of local updates (computed from the server’s state vector).', 'resp'],
      ['u', 'sess', 'local updates (batched)', 'Thousands of offline ops are merged in one batch. No transform step and no conflict dialogue: the CRDT merge is automatic.'],
      ['sess', 'meta', 'role still editor?', 'Permissions are re-checked: if access was revoked while offline, the updates are rejected and the client keeps them as a local copy to export.', 'err'],
      ['sess', 'log', 'append merged batch', 'Durable, then broadcast to anyone else in the session.'],
      ['sess', 'u', 'ack', 'Pending buffer cleared. Semantic conflicts (both rewrote the same sentence) remain possible: version history highlights them.', 'resp']],
      end: 'CRDTs make offline merge mechanical; they guarantee convergence, not that the merged prose makes sense, so history and attribution matter.' },
    { name: 'Session server failure', desc: 'The server owning a busy document crashes mid-session.', steps: [
      ['sess', 'gw', 'connection lost', 'The process dies; gateways see the upstream connections drop immediately.', 'err'],
      ['gw', 'u', 'reconnecting…', 'Clients keep editing locally; the UI shows a subtle “reconnecting” state. Unacked ops stay in the pending buffer.', 'err'],
      ['gw', 'dir', 'who owns doc 42?', 'The old lease expires within ~5-10 s (or is released at once if the node is known dead); the directory grants a new lease with epoch 20.'],
      ['dir', 'gw', 'sess-3, epoch 20', 'A different server now owns the doc.', 'resp'],
      { par: [['sess', 'snap', 'load snapshot'], ['sess', 'log', 'replay tail']], msg: 'The new owner rebuilds state from snapshot + log. Every acknowledged op is there because acks waited for durability.' },
      ['u', 'gw', 'join + resend pending ops', 'Clients rejoin with their state vector and resend unacked ops; duplicates are ignored by (clientId, clock).'],
      ['sess', 'log', 'zombie write epoch 19 rejected', 'If the old server was only partitioned, not dead, its late writes fail the epoch check, so two owners can never fork the log.', 'err']],
      end: 'Leases plus fencing tokens give one writer per document; durable-before-ack plus client resend gives zero lost edits.' }
  ],
  components: [
    ['Doc API', 'Create, open, share, list and history endpoints; issues signed session tickets after an ACL check.'],
    ['WebSocket gateways', 'Hold millions of long-lived connections, authenticate tickets, route each connection to the document owner, apply per-connection rate limits.'],
    ['Session directory', 'Lease-based map doc id &rarr; owner node with epochs (fencing tokens); places new sessions on the least-loaded server.'],
    ['Document session servers', 'Own live documents in memory: integrate updates, assign seq, persist to the op log, broadcast, keep presence, enforce role per connection.'],
    ['Operation log', 'Append-only durable record of every update per document; source of truth together with snapshots.'],
    ['Snapshot / compaction workers', 'Write snapshots every N ops, compact old ops into history checkpoints, garbage-collect tombstones, feed the search index.'],
    ['Metadata + ACL store', 'Documents, folders, permissions and named versions.'],
    ['Presence store', 'Short-TTL “who is viewing” records and cross-region pub/sub for presence outside the editor.']
  ],
  evolutionTitle: 'From a single server to sessions at scale',
  evolution: [
    { name: '1. One server, OT', desc: 'One process holds every open document and orders ops (like the original Google Wave / Etherpad servers).', diagram: { nodes: [['u', 'Editors', 'client', 0, 0], ['s', 'Collab server', 'svc', 1.5, 0, 'OT + WebSockets'], ['db', 'Database', 'db', 3, 0, 'ops + docs']], edges: [['u', 's'], ['s', 'db']] },
      steps: [['u', 's', 'op @ rev 17', 'Clients send ops tagged with the revision they were based on.'], ['s', 'db', 'transform vs 18..19, store 20', 'The server transforms the late op against ops committed since revision 17, then stores it as revision 20.'], ['s', 'u', 'broadcast rev 20', 'Everyone applies the same sequence. Simple, but one server caps total documents and is a single point of failure.', 'resp']] },
    { name: '2. Sharded sessions', desc: 'Many session servers; a directory routes each document to exactly one owner.', diagram: { nodes: [['u', 'Editors', 'client', 0, 1], ['gw', 'WS gateway', 'gw', 1, 1], ['dir', 'Directory', 'cache', 2, 0, 'leases'], ['s1', 'Session server 1', 'svc', 2, 1.2], ['s2', 'Session server 2', 'svc', 2, 2.2], ['log', 'Op log', 'nosql', 3, 1.7]], edges: [['u', 'gw'], ['gw', 'dir'], ['gw', 's1'], ['gw', 's2'], ['s1', 'log'], ['s2', 'log']] },
      steps: [['u', 'gw', 'connect doc 42', 'Connections land on any gateway.'], ['gw', 'dir', 'owner of 42?', 'The directory answers with the lease holder.'], ['gw', 's1', 'route', 'All editors of doc 42 meet on server 1; doc 43 may live on server 2.'], ['s1', 'log', 'append (fenced)', 'The op log is shared and partitioned by doc id.']] },
    { name: '3. CRDT + offline + global', desc: 'Switch to a CRDT so clients merge offline and regional servers can relay; snapshots bound load time.', diagram: { nodes: [['u', 'Editors', 'client', 0, 1, 'local replica'], ['ga', 'Region A sessions', 'svc', 1.5, 0.4], ['gb', 'Region B relay', 'svc', 1.5, 1.7], ['log', 'Op log', 'nosql', 3, 0.4], ['snap', 'Snapshots', 'blob', 3, 1.7]], edges: [['u', 'ga'], ['u', 'gb'], ['gb', 'ga', 'forward'], ['ga', 'log'], ['ga', 'snap']] },
      steps: [['u', 'gb', 'update (nearby region)', 'A remote user connects to a nearby relay for low-latency presence.'], ['gb', 'ga', 'forward to owner', 'Edits are still persisted by the single owner in the document’s home region.'], ['ga', 'log', 'append', 'Durable.'], ['ga', 'snap', 'snapshot every 1,000 ops', 'Load time stays bounded.']] }
  ],
  deep: [
    ['OT vs CRDTs, with a worked example', '<p><strong>Operational transformation.</strong> Document “abc”. Alice inserts X at index 1; Bob, concurrently, deletes index 2 (“c”). The server receives Alice first and commits it (rev 1). Bob’s op was based on rev 0, so the server transforms it: an insert at 1 &le; 2 shifts later positions right, so <code>delete(2)</code> becomes <code>delete(3)</code>.</p><pre><code>start           "abc"\nAlice  ins(1,X) "aXbc"      (rev 1)\nBob    del(2)   based on rev 0\nT(del(2), ins(1,X)) = del(3)\nAlice applies del(3) to "aXbc" -&gt; "aXb"\nBob applies ins(1,X) to "ab"   -&gt; "aXb"   converged</code></pre><p>OT needs a transform function for every pair of operation types and, to be safe, a <strong>central server that totally orders ops</strong> (Jupiter/Google Docs model). Peer-to-peer OT has a long history of subtle correctness bugs (the TP2 property).</p><p><strong>CRDTs.</strong> In RGA every character gets a unique id (counter, replica) and is inserted “after” an origin id. With “abc” = a(1,A) b(2,A) c(3,A): Alice inserts X(4,A) after a; Bob inserts Y(4,B) after a. Siblings with the same origin are ordered by id descending, so (4,B) precedes (4,A) on every replica: <code>a Y X b c</code>, regardless of arrival order. Deletes leave tombstones so later ops can still reference the id. Yjs (YATA) stores left and right origins and packs runs of consecutive characters into one item, so memory is typically 1.5-3&times; the text size rather than 30 bytes per character.</p><table><tr><th></th><th>OT</th><th>CRDT</th></tr><tr><td>Server</td><td>Required for ordering</td><td>Optional (relay + persistence)</td></tr><tr><td>Offline</td><td>Long offline sessions transform expensively</td><td>Natural: merge state vectors</td></tr><tr><td>Metadata</td><td>Small</td><td>Ids + tombstones; needs GC</td></tr><tr><td>Intent</td><td>Transform functions can encode intent</td><td>Fixed rules; interleaving anomalies avoided by Fugue / YATA</td></tr></table><p>This design uses a CRDT for the data model (offline and simple merges) <em>and</em> a single session owner per document (for ordering seqs, permissions, persistence and fan-out): the pragmatic hybrid most modern editors use.</p>'],
    ['Document sessions: one owner per document', '<p>Routing every connection for a document to one process gives a natural place to order updates, enforce permissions, assign history seqs and fan out without cross-node chatter. The directory grants a <strong>lease</strong> (TTL ~10 s, renewed by a per-node heartbeat that covers all its docs) with an increasing <strong>epoch</strong>. Every op-log write is conditional on that epoch, so a paused or partitioned old owner cannot write after a new one takes over (fencing). Placement uses least-loaded selection; hot documents (a company all-hands doc with 2,000 viewers) get a dedicated server, and viewers can be served by read-only fan-out relays that subscribe to the owner, keeping the owner’s fan-out bounded.</p><p>An alternative is consistent hashing of doc id onto session servers (no directory lookup), but rebalancing on membership change still needs leases and fencing, and hot spots cannot be moved individually.</p>'],
    ['Op log, snapshots and version history', '<ul><li><strong>Durable before ack:</strong> the session server group-commits updates per document every ~50 ms to the op log; only then are senders acked.</li><li><strong>Snapshots</strong> every ~1,000 ops or 10 minutes of activity: load = snapshot + tail, so a 10-year-old document opens as fast as a new one.</li><li><strong>History:</strong> compaction folds ops older than ~30 days into checkpoints (e.g. one per editing session or hour) with author attribution; named versions are pinned. Restoring a version applies a new forward edit that turns the current state into the old one, so collaborators converge rather than having history rewritten.</li><li><strong>Tombstone GC:</strong> once every connected and recently seen replica is past a snapshot, deleted items can be dropped from the snapshot; clients offline longer than the GC horizon (e.g. 30 days) must re-sync from the snapshot and replay their local changes as a diff.</li></ul>'],
    ['Permissions on live sessions', '<p>Roles are checked when the ticket is issued and enforced per connection by the session server: viewer connections may send only awareness, commenters only comment ops, editors everything. When an ACL changes, the API publishes an <code>acl.changed</code> event; the owning session server re-evaluates every connection on that document within a second, downgrades or closes them, and rejects later updates. Tickets are short-lived (60 s) and reconnects re-check, so a revoked user cannot keep editing through a cached token. Link sharing and domain restrictions are evaluated by the same policy function in the API and the session server.</p>'],
    ['Comments and anchors that survive edits', '<p>Comments, suggestions and cursors anchor to <strong>CRDT positions</strong> (relative positions = item id + association side) rather than integer offsets. When text before the anchor changes, the id still resolves to the right place; if the anchored text is deleted, the anchor collapses to the nearest surviving neighbour and the comment is marked “orphaned” rather than silently moving to unrelated text.</p>']
  ],
  scale: [
    '<strong>Hot documents:</strong> a doc with thousands of simultaneous viewers saturates one owner’s fan-out. Separate editors from viewers: the owner sends each update once to a tier of read-only relay nodes that fan out to viewers, and cap active editors (e.g. 100) with others in view mode.',
    '<strong>Connection storms:</strong> after a gateway deploy or regional blip, millions reconnect at once. Use jittered exponential backoff on clients, drain gateways gradually, and make join cheap with state-vector diffs instead of full reloads.',
    '<strong>Op-log write amplification:</strong> group-commit per document and batch keystrokes on the client (50-500 ms) so a fast typist produces a few writes per second, not 10.',
    '<strong>Large documents:</strong> a 500-page doc with years of tombstones loads slowly. Snapshot often, GC tombstones, and lazily load sub-documents (Yjs subdocs) or pages.',
    '<strong>Global users:</strong> keep each document’s owner in its home region (chosen by the owner’s organisation, data residency), terminate WebSockets at nearby gateways, and relay presence regionally; editors far away see ~100-150 ms extra for remote edits but local edits are always instant.'
  ],
  tradeoffs: [
    ['Merge algorithm', 'OT with a central server vs CRDT (Yjs / Automerge)', 'CRDT: offline editing, simpler server, reusable libraries. OT is still fine (Google Docs) if you always have a central server and short offline windows; CRDT metadata overhead is manageable with run-length items and GC.'],
    ['Session topology', 'Single owner per doc vs any server + shared pub/sub', 'Single owner: in-memory ordering, cheap fan-out, simple permission enforcement. Shared pub/sub (Redis channel per doc) is simpler to deploy but every server must merge every op and ordering for history is harder.'],
    ['When to ack', 'Ack after in-memory apply vs after durable append', 'After durable append (+~10-50 ms). Local edits are optimistic anyway, so users do not feel it, and a crash never loses an acked op.'],
    ['Persistence format', 'Store every op forever vs snapshots + compacted history', 'Snapshots + compaction: bounded load time and storage; keep fine-grained ops for ~30 days for attribution and “see changes”.'],
    ['Presence', 'Persist vs ephemeral', 'Ephemeral in memory with TTL: it is high volume, low value, and self-healing.']
  ],
  failures: [
    ['Session server crash', 'Lease expiry and reassignment in ~5-10 s; new owner loads snapshot + log tail; clients resend unacked ops (idempotent ids).'],
    ['Split brain: two servers think they own a doc', 'Epoch fencing on every op-log write; the stale owner’s writes fail and it closes its connections.'],
    ['Gateway node failure', 'Clients reconnect with jittered backoff to another gateway; state-vector join resends only the difference.'],
    ['Op-log partition slow or unavailable', 'Session server buffers and stops acking (clients keep pending ops, UI shows “saving…”); never ack from memory only. Quorum writes tolerate one replica down.'],
    ['Corrupt or poisoned update', 'Validate updates against the schema and size limits before integrating; snapshots plus op log allow rebuilding to the last good seq.'],
    ['Client offline beyond the GC horizon', 'Server cannot diff against garbage-collected tombstones: client re-syncs from snapshot and its local changes are re-applied as a text diff, flagged for review.'],
    ['Region outage', 'Op log and snapshots replicated cross-region (async, RPO seconds); directory in the surviving region re-leases documents; clients hold unacked edits locally so nothing they typed is lost.']
  ],
  cloud: [['DNS', 'dns'], ['Edge, TLS and WAF', 'cdn'], ['WAF rules', 'waf'], ['WebSocket gateway (managed option)', 'realtime'], ['Gateways and session servers', 'k8s'], ['Session directory and presence', 'cache'],
    ['Operation log', 'widecol'], ['Operation log (serverless option)', 'nosql'], ['Docs and ACLs', 'sql'], ['Snapshots and versions', 'blob'], ['Document events', 'stream'], ['Snapshot workers', 'containers'],
    ['Search over documents', 'search'], ['Workforce sign-in', 'workforce'], ['Secrets and keys', 'secrets'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-leader-election', 'azp-event-sourcing', 'azp-sharding', 'azp-cqrs', 'azEventDriven', 'azAksBaseline', 'azPartition', 'azMission'],
          aws: ['blLeader', 'awsEventSourcing', 'blDistributed', 'awsPubSub', 'awsDdbBest', 'blStatic', 'blBackoff'] },
  questions: [
    ['Why not just lock paragraphs?', 'Locking is simple but feels terrible: users wait, locks leak when clients disconnect, and offline editing is impossible. Optimistic concurrent editing with OT or CRDTs gives instant local feedback and automatic merges; locks survive only for things like “one person edits this cell formula at a time”.'],
    ['How does OT guarantee convergence?', 'With a central server that assigns a total order, each client only needs transforms satisfying TP1: applying a then T(b,a) equals applying b then T(a,b). The server transforms late ops against everything committed since the op’s base revision; clients transform incoming ops against their pending local ops. Without a central order you also need TP2, which most practical transform functions fail.'],
    ['What is a state vector?', 'A map client id &rarr; highest clock seen from that client. Comparing two state vectors tells each side exactly which updates the other lacks, so sync after reconnect sends only the difference, not the whole document.'],
    ['How do you make undo work with collaborators?', 'Undo must be local: it reverts only your own recent changes, expressed as a new inverse operation (or Yjs UndoManager tracking your own items), not a rewind of the shared document. Otherwise pressing undo would erase a colleague’s typing.'],
    ['How would you support 10,000 viewers of a live document?', 'Editors stay on the owner; viewers connect to read-only relay nodes that subscribe to the owner’s update stream (one message per relay, not per viewer). Presence for viewers is aggregated (“and 9,800 others”) instead of fanned out individually.'],
    ['How do you store and restore versions efficiently?', 'Snapshots every N ops plus compacted checkpoints; a version is a pointer (seq) plus an optional pinned snapshot. Restore computes the diff between current and target and applies it as a normal edit, so it merges with concurrent work and is itself undoable.']
  ],
  related: ['chat', 'file-storage', 'kv-store', 'message-queue', 'saas-platform']
});

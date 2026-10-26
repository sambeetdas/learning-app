SD.renderCase({
  slug: 'file-storage',
  summary: 'A file storage and sync service (Dropbox, Google Drive, OneDrive) keeps a folder identical across every device a user owns and everyone they share it with. The key idea is to split each file into chunks (fixed 4 MB blocks, or content-defined chunks that survive insertions), name every chunk by its SHA-256 hash, and keep two completely separate systems: a huge, cheap, immutable blob store for chunk bytes and a small, strongly consistent metadata database that says which chunks make up which version of which file. Clients upload only the chunks the server does not already have, straight to object storage through pre-signed URLs, then commit a new file version. Every commit appends to a per-namespace change journal; other devices hold a long-poll open, wake up when the journal moves, and fetch the delta since their cursor. Conflicts are detected with optimistic concurrency and resolved by keeping both copies.',
  examples: 'Dropbox (4 MB blocks, Magic Pocket block store, Edgestore metadata on sharded MySQL), Google Drive, Microsoft OneDrive / SharePoint, Box, iCloud Drive, Nextcloud; backup tools such as restic and Borg use content-defined chunking for the same deduplication.',
  functional: ['Upload, download, rename, move and delete files and folders from desktop, mobile and web.', 'Automatic sync: a change on one device appears on the user’s other devices and for collaborators within seconds.', 'Share files or folders with people (viewer / editor) and by link, with expiry and revocation.', 'Version history: restore any version from the last 30-180 days; recover deleted files.', 'Large files (tens of GB) with resumable uploads; offline edits that sync later.'],
  nonFunctional: ['Durability above 11 nines for file content: data loss is the one unacceptable failure.', 'Strong consistency for metadata: no two different "current" versions of the same file.', 'Sync latency: a small change visible on other online devices within ~5 s (p95).', 'Bandwidth efficiency: only changed and not-yet-stored chunks are transferred.', 'Availability 99.95% for sync; reads of already-synced files work offline.'],
  outOfScope: ['Real-time co-editing inside documents (see collab-editor).', 'Full-text search internals (see search-engine).', 'Desktop file system driver details (placeholders / files on demand).', 'Billing and quota management beyond a simple check.'],
  estimates: [
    ['Users', '500 M registered, 100 M daily active', 'Consumer + business mix'],
    ['Logical data stored', '~2.5 EB', '500 M &times; ~5 GB average (most users are far below quota, a few far above)'],
    ['Physical data', '~2.6 EB on disk', 'Deduplication saves ~30% &rArr; ~1.75 EB unique, &times; 1.5 for erasure coding (cheaper than 3 full replicas)'],
    ['File changes', '200 M/day &rArr; ~2.3 k/s average, ~7 k/s peak', '100 M DAU &times; 2 changed files; peak 3&times; (office hours)'],
    ['New bytes uploaded', '~160 TB/day &rArr; ~15 Gbit/s average', '200 M &times; 2 MB = 400 TB changed; delta sync and dedup mean ~40% are new chunks'],
    ['Download bandwidth', '~30 Gbit/s average', 'Each change is fetched by ~2 other devices or collaborators'],
    ['Metadata', '~500 B file entries, ~250 TB', '500 M users &times; ~1,000 files (with versions) &times; ~500 B per row incl. indexes'],
    ['Chunk index', '~440 B chunks, ~28 TB', '1.75 EB / 4 MB per chunk &times; ~64 B (hash, location, ref count)'],
    ['Waiting sync clients', '~50 M long-polls, ~550 k requests/s', '50 M concurrent devices re-issuing a 90 s long-poll: 50 M / 90 s']
  ],
  compute: [
    ['Metadata service', '~38 instances &times; 16 vCPU across 3 zones', 'Peak ~80 k req/s (7 k commits, ~21 k delta listings, ~50 k browse/web calls) &times; ~3 ms CPU = 240 busy cores; at 60% &asymp; 400 cores &asymp; 25 instances; &times;1.5 to survive a zone loss.'],
    ['Metadata database', '128 shards (MySQL / PostgreSQL), each primary + 2 replicas', '250 TB / 128 &asymp; 2 TB per shard. Writes: 7 k commits/s &times; ~10 rows (journal, file version, chunk refs) = 70 k rows/s &asymp; 550 per shard, easy; the shard count is set by storage and blast radius.'],
    ['Notification (long-poll) servers', '~75 nodes', '50 M idle connections / ~1 M per node (async HTTP/2 server, ~10 KB each) = 50, &times;1.5 for zone loss. Request rate 550 k/s / 75 &asymp; 7 k/s per node.'],
    ['Chunk index', 'Managed KV (DynamoDB / Cosmos DB / Cassandra), ~28 TB', 'Lookups happen only on upload: ~7 k commits/s &times; a few hashes, plus bulk imports, ~50 k batched lookups/s peak.'],
    ['Async workers', '~40 &times; 8 vCPU, autoscaled on lag', 'Thumbnails, text extraction for search, virus scanning and garbage collection triggered by the change stream (~7 k events/s peak).'],
    ['Block store', 'Object storage, exabyte scale', 'Pay per GB; erasure coded across zones; uploads and downloads go directly to it via pre-signed URLs, so no proxy fleet is needed for bytes.']
  ],
  api: [
    ['POST /v1/uploads/check {path, size, chunks:[sha256...]}', 'Returns the hashes the server does not have yet, each with a short-lived pre-signed PUT URL. Known chunks (this user’s earlier versions, or dedup) are skipped.'],
    ['PUT {pre-signed URL} (x-checksum-sha256: ...)', 'Client uploads a chunk directly to the block store. The URL is bound to the expected checksum, so a corrupt or different body is rejected by storage.'],
    ['POST /v1/files/commit {path, chunks[], parent_rev, client_mtime}', 'Atomically creates a new file version from a list of chunk hashes. Fails with 409 if parent_rev is not the current revision (someone else changed it).'],
    ['GET /v1/changes?cursor={opaque}&limit=2000', 'Delta sync: every journal entry after the cursor across the user’s namespaces, plus a new cursor and has_more.'],
    ['GET /v1/changes/longpoll?cursor=&timeout=90', 'Hangs until something changes after the cursor (returns {changes:true}) or the timeout expires. Cheap way to push without a WebSocket.'],
    ['GET /v1/files/{id}/content?rev= → 302 to signed chunk URLs', 'Download: the client receives the chunk list and fetches each chunk directly (in parallel, resumable).'],
    ['POST /v1/sharing/folders {path, members:[{email, role}]}', 'Turns a folder into a shared namespace and mounts it into each member’s tree; link sharing creates a token with scope and expiry.']
  ],
  data: [
    ['namespaces', 'Sharded SQL, shard key ns_id', 'A namespace is a user’s root or a shared folder. Holds owner, quota, latest_sjid (journal position). Shard by ns_id so a whole folder tree and its journal live on one shard.'],
    ['file_journal', 'Sharded SQL, PK (ns_id, sjid)', 'Append-only change log: sjid (server journal id, increasing per namespace), path / file_id, rev, chunk list hash, size, deleted flag, author device. The sync cursor is a set of (ns_id, sjid).'],
    ['files / versions', 'Sharded SQL, PK (ns_id, file_id), index (ns_id, parent_id, name)', 'Current revision pointer per file; versions table maps (file_id, rev) &rarr; ordered chunk hashes. Parent-id tree makes a folder rename one row update.'],
    ['chunk_index', 'Key-value store, key = sha256', 'Location in the block store, size, reference count (or last-referenced time for GC), encryption key id.'],
    ['chunks (bytes)', 'Object storage, key = sha256', 'Immutable, erasure coded, encrypted at rest with per-chunk data keys wrapped by a KMS key.'],
    ['acl / shares', 'Sharded SQL with the namespace', 'ns_id, principal (user or group), role, link tokens with expiry; cached for permission checks.'],
    ['devices', 'SQL / KV', 'device_id, user, last cursor, platform: used for "linked devices" and remote wipe.']
  ],
  dbChoice: [
    ['File metadata and journal', 'Sharded relational (MySQL / PostgreSQL), or distributed SQL', 'Needs transactions: a commit must check parent_rev, append to the journal and move the current pointer atomically. Sharding by namespace keeps those transactions single-shard.', 'Distributed SQL (Spanner, CockroachDB, Aurora DSQL) removes manual sharding at higher cost per op; a document store would push conflict detection into application code.'],
    ['Chunk bytes', 'Object storage with erasure coding', 'Exabytes of immutable data, 11+ nines durability, cheapest per GB, direct client access via pre-signed URLs.', 'A custom block store (Dropbox moved to its own Magic Pocket for cost at exabyte scale); HDFS-style file systems are less suited to billions of small objects.'],
    ['Chunk index', 'Key-value store (DynamoDB / Cosmos DB / Cassandra)', 'Pure point lookups by hash, huge key count, no relations; easy to scale horizontally.', 'Putting it in the metadata SQL shards would couple unrelated users (dedup is global) and create cross-shard lookups.'],
    ['Sync wake-ups', 'In-memory subscription map on notification servers', 'Ephemeral: which long-poll is waiting on which namespace. Rebuilt automatically when clients reconnect.', 'Persisting subscriptions adds writes for no benefit.']
  ],
  diagram: {
    nodes: [['c1', 'Desktop client', 'client', 0, 1.0, 'watcher + chunker'], ['c2', 'Other device', 'mobile', 0, 2.4, 'phone, laptop, web'], ['blob', 'Block store', 'blob', 1, 0, 'chunks by SHA-256'],
      ['gw', 'API gateway', 'apigw', 1, 1.7, 'auth, quotas'], ['meta', 'Metadata service', 'svc', 2, 1.0, 'commit, list, share'], ['notif', 'Notification svc', 'svc', 2, 2.4, 'long-poll wake-ups'],
      ['mc', 'Metadata cache', 'cache', 3, 0, 'Redis: ACLs, trees'], ['mdb', 'Metadata DB', 'db', 4, 0.6, 'sharded by namespace'], ['cidx', 'Chunk index', 'nosql', 4, 1.8, 'hash to location'],
      ['kafka', 'Change stream', 'stream', 3, 3.0, 'journal events'], ['wk', 'Async workers', 'worker', 5, 3.0, 'previews, scan, GC'], ['search', 'Search index', 'search', 6, 3.0, 'names + content']],
    edges: [['c1', 'gw'], ['c2', 'gw'], ['c1', 'blob', 'pre-signed PUT'], ['c2', 'blob', 'GET chunks'], ['gw', 'meta'], ['gw', 'notif', 'long-poll'], ['meta', 'mc'], ['meta', 'mdb'], ['meta', 'cidx'], ['meta', 'blob', 'verify'],
      ['meta', 'kafka', '', 'async'], ['kafka', 'notif', '', 'async'], ['kafka', 'wk', '', 'async'], ['wk', 'search']]
  },
  flows: [
    { name: 'Upload a changed file', desc: 'Alice edits a 20 MB presentation; only one 4 MB region changed.', steps: [
      ['c1', 'gw', 'POST /uploads/check (5 hashes)', 'The desktop client noticed the change, re-chunked the file into five 4 MB chunks and hashed each with SHA-256. It sends only hashes, not bytes.'],
      ['gw', 'meta', 'check', 'Authenticated, quota checked.'],
      ['meta', 'cidx', 'batch lookup 5 hashes', 'Four chunks are unchanged from the previous version, so they already exist.'],
      ['meta', 'c1', '1 missing + pre-signed URL', 'Only the changed chunk must be uploaded: 4 MB instead of 20 MB.', 'resp'],
      ['c1', 'blob', 'PUT chunk (checksum bound)', 'The bytes go straight to object storage; the URL requires the matching SHA-256, so storage itself rejects corruption. A failed PUT is simply retried; chunks are idempotent.'],
      ['c1', 'gw', 'commit(path, 5 hashes, rev 7)', 'Commit names the full ordered chunk list and the revision Alice’s edit was based on.'],
      ['gw', 'meta', 'commit', 'Routed to the metadata service.'],
      ['meta', 'blob', 'HEAD new chunk', 'Verify the new chunk really landed before referencing it, then record it in the chunk index.'],
      ['meta', 'mdb', 'txn: rev 7 → 8, journal +1', 'One single-shard transaction: check current rev is still 7, write version 8, append the journal entry (sjid 90412) and bump the namespace position.'],
      ['meta', 'kafka', 'ns_42 at sjid 90412', 'Publish the change so notification servers, search indexing and previews can react.', 'async']],
      end: 'Content addressing turns "upload a 20 MB file" into "upload the 4 MB that changed", and the commit is a small metadata transaction.' },
    { name: 'Sync to another device', desc: 'Alice’s laptop is waiting on a long-poll; the change appears within seconds.', steps: [
      ['c2', 'gw', 'longpoll(cursor, 90 s)', 'The laptop holds an HTTP request open. Long-poll works through proxies and firewalls where WebSockets often do not, and costs nothing while idle.'],
      ['gw', 'notif', 'park request', 'The notification server registers "this request waits on namespace ns_42 beyond sjid 90411".'],
      ['kafka', 'notif', 'ns_42 at 90412', 'The change event arrives; the server finds parked requests for ns_42.', 'async'],
      ['notif', 'c2', '{changes: true}', 'Only a hint is sent, no data. The client decides when to fetch (for example, not on a metered connection).', 'resp'],
      ['c2', 'gw', 'GET /changes?cursor=', 'Delta request from the saved cursor.'],
      ['gw', 'meta', 'list changes', 'Permission checked against the cached ACL for ns_42.'],
      ['meta', 'mdb', 'journal WHERE sjid > 90411', 'An index range scan on (ns_id, sjid): the cost is proportional to what changed, not to the size of the folder.'],
      ['meta', 'c2', 'entries + new cursor', 'One entry: presentation rev 8 with its chunk list.', 'resp'],
      ['c2', 'blob', 'GET 1 missing chunk', 'The laptop already holds the other four chunks locally (from rev 7), so it downloads just one and reassembles the file atomically (write temp, rename).']],
      end: 'Cursor + journal makes sync incremental and restartable: a device offline for a month just replays more journal entries.' },
    { name: 'Conflict: two offline edits', desc: 'Alice (laptop) and Bob (desktop) both edit report.docx rev 7 while offline, then reconnect.', steps: [
      ['c1', 'gw', 'commit(report, rev 7)', 'Alice reconnects first and commits her version.'],
      ['gw', 'meta', 'commit', 'Routed.'],
      ['meta', 'mdb', 'CAS rev 7 → 8: ok', 'Current revision is 7, so her commit wins and becomes rev 8.'],
      ['c2', 'gw', 'commit(report, rev 7)', 'Bob’s client also claims its edit was based on rev 7.'],
      ['meta', 'mdb', 'CAS rev 7 → 8: fails', 'The current revision is now 8: optimistic concurrency detects that Bob did not see Alice’s change.', 'err'],
      ['meta', 'c2', '409 conflict', 'The server never silently overwrites.', 'err'],
      ['c2', 'gw', 'commit as conflicted copy', 'Bob’s client saves his edit as "report (Bob’s conflicted copy 2026-10-26).docx" and commits it as a new file, then downloads Alice’s rev 8 under the original name.'],
      ['meta', 'mdb', 'insert new file', 'Both versions survive; humans merge.'],
      ['meta', 'kafka', 'two journal entries', 'Every device converges on the same two files.', 'async']],
      end: 'For opaque binary files, "keep both" is the only safe automatic resolution; only formats with a merge model (Google Docs, CRDT editors) can merge automatically.' },
    { name: 'Share a folder', desc: 'Alice shares /Projects/Apollo with Bob as editor.', steps: [
      ['c1', 'gw', 'POST /sharing/folders', 'Alice adds Bob with the editor role.'],
      ['gw', 'meta', 'share', 'Routed.'],
      ['meta', 'mdb', 'create ns_77, move subtree', 'The folder becomes its own namespace (with its own journal) so it can be mounted into several users’ trees. File rows are re-homed, but chunks never move: they are referenced by hash.'],
      ['meta', 'mdb', 'ACL + mount in Bob’s root', 'Bob’s root namespace gets a mount entry pointing at ns_77.'],
      ['meta', 'mc', 'invalidate ACL cache', 'Permission caches for ns_77 are refreshed so access works immediately.'],
      ['meta', 'kafka', 'mount event for Bob', 'Bob’s devices learn about the new namespace.', 'async'],
      ['kafka', 'notif', 'wake Bob’s devices', 'His parked long-polls return.', 'async'],
      ['notif', 'c2', '{changes: true}', 'Bob’s client adds ns_77 to its cursor and syncs the folder, downloading chunks it does not have.', 'resp']],
      end: 'Namespaces are the unit of sharing, sharding and sync, which keeps permission checks and journals local to one shard.' }
  ],
  components: [
    ['Desktop / mobile client', 'Watches the file system, chunks and hashes files, keeps a local database of chunk hashes and the sync cursor, uploads and downloads in parallel, resolves conflicts.'],
    ['API gateway', 'Authentication (OAuth tokens), rate limits, quotas, routing.'],
    ['Metadata service', 'Upload checks, commits with optimistic concurrency, delta listings, sharing and ACLs, version history.'],
    ['Notification service', 'Holds long-poll requests per namespace and wakes them when the journal advances.'],
    ['Block store', 'Immutable chunks keyed by hash; erasure coded; direct client access with pre-signed URLs.'],
    ['Chunk index', 'Hash &rarr; location and reference information; enables deduplication and garbage collection.'],
    ['Async workers', 'Thumbnails and previews, text extraction for search, malware scanning, retention and chunk garbage collection.']
  ],
  deep: [
    ['Chunking: fixed blocks vs content-defined', '<p><strong>Fixed-size chunks</strong> (Dropbox uses 4 MB) are simple and fast: chunk i covers bytes [4 MB &times; i, 4 MB &times; (i+1)). Edits that overwrite in place change one chunk. But inserting one byte near the start shifts every boundary, so every later chunk gets a new hash.</p><p><strong>Content-defined chunking (CDC)</strong> chooses boundaries from the content itself: slide a rolling hash (Rabin fingerprint, or the faster Gear hash used by FastCDC) over the data and cut wherever <code>hash &amp; mask == 0</code>. With a 22-bit mask the average chunk is ~4 MB; set min/max sizes (for example 1 MB and 16 MB) to avoid tiny or huge chunks. An insertion only changes the chunks around it, because boundaries resynchronise after the edit.</p><table><tr><th></th><th>Fixed</th><th>CDC</th></tr><tr><td>CPU</td><td>Hash only</td><td>Rolling hash + hash</td></tr><tr><td>In-place edits</td><td>Good</td><td>Good</td></tr><tr><td>Insertions</td><td>Poor (all later chunks change)</td><td>Good</td></tr><tr><td>Typical users</td><td>Dropbox blocks</td><td>restic, Borg, backup systems</td></tr></table>'],
    ['Deduplication and garbage collection', '<p>Chunks are named by <code>SHA-256(content)</code>, so identical content has one key and is stored once: across versions of a file, across copies in one account, and optionally across users. Cross-user dedup saves the most but leaks information (an attacker can test whether anyone has a given file by watching whether the upload is skipped), so many services dedup only within a user or tenant, or always require the upload.</p><p>Deleting is harder than storing. A chunk may be referenced by many versions and users, so it can be deleted only when nothing references it and the version retention window has passed. Options: reference counts updated transactionally with commits (precise but contended for popular chunks), or periodic <strong>mark-and-sweep</strong> over all live versions with a grace period so a chunk uploaded but not yet committed is not swept. Most large systems use the second, plus soft deletes so a bug never destroys data immediately.</p>'],
    ['Metadata model and the sync protocol', '<p>Everything lives in <strong>namespaces</strong> (a user root or a shared folder). Each namespace has an append-only journal with a strictly increasing <strong>SJID</strong>. A commit is one transaction on the namespace’s shard:</p><pre><code>BEGIN;\nSELECT rev FROM files WHERE ns_id=42 AND file_id=9 FOR UPDATE;  -- expect 7\nINSERT INTO versions (file_id, rev, chunks) VALUES (9, 8, :hashes);\nUPDATE files SET rev=8 WHERE ns_id=42 AND file_id=9;\nINSERT INTO file_journal (ns_id, sjid, file_id, rev) VALUES (42, 90412, 9, 8);\nUPDATE namespaces SET latest_sjid=90412 WHERE ns_id=42;\nCOMMIT;</code></pre><p>A client cursor is the list of <code>(ns_id, sjid)</code> it has applied. Sync is: long-poll until any namespace moves, then read journal entries after each sjid, apply them locally, persist the new cursor. Because entries are ordered and the cursor is saved only after applying, a crash simply replays from the last cursor.</p>'],
    ['Pre-signed uploads, large files and resumability', '<p>Bytes never pass through the API tier. The server returns per-chunk pre-signed URLs (valid for minutes, scoped to one key and checksum). Large files are just many chunks: the client uploads 4-8 in parallel, and if the connection drops it calls <code>/uploads/check</code> again, which returns only the chunks still missing. A 50 GB file therefore resumes where it left off, and the commit happens only once all chunks exist. Downloads work the same way in reverse and can be served via a CDN for popular shared links.</p>'],
    ['Versioning, deletion and security', '<p>Every commit creates a version that references chunks; old versions cost only the chunks that differ. Retention policy (30 days free, 180 days or unlimited for business) is enforced by a background job that expires versions and then lets GC reclaim chunks. Deletes are soft (journal entry with <code>deleted=true</code>) so they sync and can be undone.</p><p>Security: TLS in transit; chunks encrypted at rest with data keys wrapped by a KMS key (per tenant for business customers who want customer-managed keys); ACL checks on every metadata call; share links are unguessable tokens with scope, expiry and optional password; audit log of shares and downloads for business accounts.</p>']
  ],
  scale: [
    '<strong>Metadata hot spots:</strong> a single shared folder with millions of files and thousands of members is one namespace on one shard. Cap namespace size, split very large shares, and cache directory listings.',
    '<strong>Notification fan-out:</strong> a change in a namespace with 10,000 members wakes 10,000+ devices. Wake-ups are tiny, but rate-limit and coalesce bursts (one wake-up per namespace per second).',
    '<strong>Bandwidth and cost</strong> dominate at exabyte scale: dedup, delta sync, compression of chunks, LAN sync between devices on the same network, and cheaper storage tiers for old versions.',
    '<strong>Chunk index growth:</strong> hundreds of billions of keys; partition by hash prefix (naturally uniform) and keep it out of the metadata shards.',
    '<strong>Global users:</strong> keep metadata in the user’s home region (data residency), serve chunk downloads through regional storage replicas or a CDN.'
  ],
  tradeoffs: [
    ['Chunk size', '1 MB vs 4 MB vs 16 MB', '~4 MB: small enough for efficient delta sync and retries on mobile, large enough to keep the chunk index and per-request overhead manageable.'],
    ['Chunking method', 'Fixed vs content-defined', 'Fixed is simpler and great for in-place edits; CDC handles insertions far better at some CPU cost. Choose CDC when users edit large files that grow in the middle (archives, VM images, backups).'],
    ['Dedup scope', 'Per user vs global', 'Per user or tenant by default for privacy; global dedup saves more storage but enables confirmation-of-file attacks.'],
    ['Change notification', 'Long-poll vs WebSocket vs periodic polling', 'Long-poll: works everywhere, cheap when idle, and only needs to carry a hint; WebSocket is fine too but adds connection management for little gain.'],
    ['Conflict handling', 'Last writer wins vs conflicted copies vs merge', 'Conflicted copies for opaque files (never lose a user’s work); automatic merge only for structured formats.']
  ],
  failures: [
    ['Client crashes mid-upload', 'Chunks are idempotent and the commit is atomic; on restart the client re-checks which chunks are missing and continues.'],
    ['Metadata shard primary fails', 'Automatic failover to a synchronous replica; commits for that shard pause for seconds and clients retry; other shards are unaffected.'],
    ['Block store zone or disk loss', 'Erasure coding across zones (for example 6+3) reconstructs data; background repair restores redundancy.'],
    ['Notification server restarts', 'Parked long-polls fail; clients reconnect with jitter and immediately call /changes with their cursor, so nothing is missed.'],
    ['Corrupted chunk uploaded', 'Checksum-bound pre-signed URLs reject it; periodic scrubbing re-hashes stored chunks and repairs from parity.'],
    ['Bug deletes metadata', 'Soft deletes, version retention, point-in-time restore of metadata shards, and GC grace periods mean chunks are still there to restore.']
  ],
  cloud: [['DNS', 'dns'], ['Edge and downloads of shared links', 'cdn'], ['API gateway', 'apigw'], ['Metadata and notification services', 'k8s'], ['Metadata database (sharded)', 'sql'], ['Metadata (distributed SQL option)', 'distsql'], ['Chunk index', 'nosql'], ['Metadata cache', 'cache'], ['Block store', 'blob'], ['Change stream', 'stream'], ['Previews, scanning, GC', 'functions'], ['File search', 'search'], ['Encryption keys', 'secrets'], ['Identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-valet-key', 'azp-sharding', 'azPartition', 'azp-index-table', 'azDataStore', 'azp-competing-consumers', 'azEventDriven'],
          aws: ['awsDdbBest', 'awsEventSourcing', 'awsPubSub', 'blBackoff', 'awsWaf', 'awsDiagrams'] },
  questions: [
    ['Why separate metadata from file content?', 'They have opposite needs. Metadata is small, relational, needs transactions and strong consistency, and is read constantly. Content is huge, immutable, needs cheap durable storage and high throughput. Separating them lets each use the right store, and makes renames, moves and shares pure metadata operations.'],
    ['How does renaming a folder with a million files work?', 'Files point to their parent folder id, not a full path, so the rename updates one row and appends one journal entry. Clients apply it locally as one rename. Moving between namespaces (into a shared folder) is heavier: rows are re-homed in the background, but chunks still never move.'],
    ['How do you make sure a file is not corrupted end to end?', 'Hashes at every step: the client hashes chunks, storage verifies the checksum on upload, the metadata stores the chunk list, the downloading client re-hashes each chunk, and background scrubbing re-verifies data at rest.'],
    ['Why long-polling instead of pushing the changes themselves?', 'Notifications only carry "something changed"; the client then pulls with its cursor. That keeps the notification tier stateless and tiny, avoids pushing data to devices that cannot use it right now, and makes correctness depend only on the journal.'],
    ['How do you support "files on demand" (placeholders)?', 'The client syncs metadata for everything but downloads chunks only when a file is opened (an OS file provider API such as Windows Cloud Files or macOS File Provider intercepts the open). The sync protocol is unchanged.'],
    ['How do you enforce storage quotas with deduplication?', 'Charge users for the logical size of the files they own (what they see), not physical bytes; dedup savings are the provider’s margin. Shared folders count against the owner.']
  ],
  related: ['collab-editor', 'video-streaming', 'kv-store', 'unique-id', 'data']
});

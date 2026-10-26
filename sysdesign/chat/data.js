SD.renderCase({
  slug: 'chat',
  summary: 'A chat system keeps hundreds of millions of phones connected over long-lived WebSocket (or MQTT) connections and moves each message from sender to recipients in well under a second, in order, exactly once from the user’s point of view, even when phones go offline, switch networks or use several devices. The core pieces are a fleet of stateless-ish connection gateways, a session registry that knows which gateway holds each user, a chat service that assigns a per-conversation sequence number and persists the message before acknowledging it, a wide-column message store partitioned by conversation, receipts expressed as "read up to sequence N" watermarks, a sync protocol that lets a reconnecting device catch up from its last sequence number, mobile push for sleeping devices, and end-to-end encryption so the servers only ever relay ciphertext.',
  examples: 'WhatsApp, Facebook Messenger, Signal, Telegram, Slack, Discord, Microsoft Teams chat, WeChat; Discord stores trillions of messages in ScyllaDB partitioned by channel and time bucket, a close cousin of the design here.',
  functional: ['1:1 and group conversations (groups up to ~1,000 members) with text, images, video and voice notes.', 'Messages arrive in the same order for every participant; no duplicates, no silent losses.', 'Sent, delivered and read receipts; typing indicators; online / last-seen presence.', 'Offline users get a push notification and see all missed messages when they reconnect, on every device they own.', 'Scroll back through history; end-to-end encryption for message content.'],
  nonFunctional: ['500 M DAU, ~150 M concurrent connections at peak.', 'End-to-end delivery p99 under 500 ms when both parties are online (same continent).', 'Durability: once the sender sees "sent" (one tick), the message is never lost.', 'Availability 99.99% for sending; a gateway or zone failure only causes a reconnect.', 'Work on poor mobile networks: reconnects, retries and duplicate sends are normal.'],
  outOfScope: ['Voice and video calls (see video-conferencing).', 'Channels with millions of followers (broadcast; closer to news-feed).', 'Full-text search over encrypted history (done on device).', 'Bots and integrations.'],
  estimates: [
    ['Daily active users', '500 M', 'Large global messenger'],
    ['Messages sent', '20 B/day &rArr; ~230 k/s average, ~460 k/s peak', '500 M &times; 40 messages / 86,400 s; peak 2&times;'],
    ['Deliveries (per recipient device)', '~1.4 M/s peak', 'Average 3 recipient devices per message (mostly 1:1 with 1-2 devices, some groups)'],
    ['Concurrent connections', '~150 M at peak', '30% of DAU online at the busiest hour'],
    ['Connect / reconnect events', '~115 k/s average', '500 M users &times; ~20 app foregrounds and network changes per day'],
    ['Message storage', '~2.5 TB/day compressed &rArr; 7.5 TB/day with 3 replicas', '20 B &times; ~250 B (ciphertext + metadata), LZ4 roughly halves it'],
    ['Hot history (90 days)', '~675 TB replicated', '7.5 TB &times; 90; older buckets compacted to object storage'],
    ['Media', '~200 TB/day', '5% of messages: 1 B &times; ~200 KB (compressed images, voice notes; video larger but rarer)'],
    ['Message bandwidth', '~4.5 Gbit/s peak', '1.4 M deliveries/s &times; ~400 B per framed message (media goes via the CDN, not the socket)']
  ],
  compute: [
    ['WebSocket gateways', '~450 nodes (150 per zone), each &le;500 k connections', '150 M connections / 500 k per node = 300 nodes. Memory: 500 k &times; ~40 KB (TLS + buffers) = 20 GB per node. To survive a zone loss the other two zones must absorb all reconnects: 150 per zone &times; 3 = 450.'],
    ['Chat service', '~115 instances &times; 16 vCPU', '460 k sends/s &times; ~1 ms CPU (auth, seq, persist, route) = 460 cores, plus 1.4 M deliveries &times; 0.2 ms = 280 cores &rArr; 740 busy cores; at 60% &asymp; 1,230 cores &asymp; 77 instances; &times;1.5 for zone loss.'],
    ['Session registry + sequencer (Redis)', '~24 shards &times; 32 GB + replicas', 'Lookups: one per recipient (1.4 M/s) + 460 k INCR/s + 115 k registrations/s &asymp; 2 M ops/s; at ~100 k ops/s per shard with headroom &rArr; ~24 shards. Data is small: 150 M &times; ~100 B = 15 GB.'],
    ['Message store (Cassandra / ScyllaDB)', '~170 nodes (8 TB NVMe each, kept half full)', 'Storage bound: 675 TB / 4 TB usable &asymp; 170. Throughput is comfortable: 460 k writes/s &times; RF 3 = 1.4 M replica writes/s &asymp; 8 k per node.'],
    ['Push workers', '~20 &times; 4 vCPU, autoscaled on queue lag', 'Perhaps 30% of deliveries hit an offline device: ~400 k/s at peak, batched over HTTP/2 to APNs/FCM at ~10 k/s per core &rArr; 40 cores &rArr; ~70 at 60%.']
  ],
  api: [
    ['WSS /v1/connect (token, device_id, app_version)', 'Opens the long-lived connection. The gateway authenticates once, registers user/device &rarr; gateway, then streams frames both ways. Heartbeat ping every 30-60 s (tuned to mobile NAT timeouts).'],
    ['→ {type:"send", client_msg_id, conv_id, body(ciphertext), media_ref?}', 'Client send. client_msg_id (UUID created on the device) makes retries idempotent.'],
    ['← {type:"ack", client_msg_id, seq, server_ts}', 'Server acknowledgement after the message is durably stored: the "sent" tick. The client replaces its local pending row with the server seq.'],
    ['← {type:"msg", conv_id, seq, sender_id, body} / → {type:"delivered"|"read", conv_id, up_to_seq}', 'Delivery to a recipient device, and receipts as watermarks: one frame acknowledges every message up to seq.'],
    ['GET /v1/sync?since={cursor}', 'After reconnecting: conversations whose last_seq moved since the cursor, then per conversation GET /v1/conversations/{id}/messages?after_seq=&limit=200.'],
    ['POST /v1/media → {upload_url, media_id}', 'Pre-signed URL; the client uploads the encrypted file directly to object storage and sends only the reference and key inside the message.'],
    ['POST /v1/conversations {members[]} | PUT .../members/{id}', 'Create group and manage membership (also triggers group key updates for E2EE).']
  ],
  data: [
    ['messages', 'Cassandra / ScyllaDB, partition (conv_id, bucket), clustering seq DESC', 'bucket = seq / 10,000 keeps partitions bounded even in decade-old busy groups; body is ciphertext; client_msg_id stored for deduplication.'],
    ['conversations, members', 'Cassandra (or sharded SQL), partition conv_id', 'type, member list with roles, last_seq, and per-member last_delivered_seq / last_read_seq watermarks.'],
    ['user_inbox', 'Cassandra, partition user_id', 'conv_id &rarr; last_seq, muted, archived; the client sorts by last activity. Updated on each message (a cheap upsert).'],
    ['sessions', 'Redis hash session:{user_id}', 'device_id &rarr; {gateway_id, conn_id, connected_at}. Gateways hold a lease key; entries from a dead gateway are ignored once its lease expires.'],
    ['seq:{conv_id}', 'Redis counter', 'INCR gives the next sequence number. After a failover it is re-seeded from max(seq) in the store plus a safety gap, so gaps are possible but duplicates are not.'],
    ['device keys', 'Key directory (NoSQL)', 'Per device identity key, signed prekey and a pool of one-time prekeys for establishing Signal-protocol sessions.'],
    ['push tokens, media', 'NoSQL; object storage + CDN', 'APNs/FCM token per device; encrypted media blobs keyed by random id, expiring after N days if never fetched.']
  ],
  dbChoice: [
    ['Messages', 'Wide-column (Cassandra / ScyllaDB)', 'The access pattern is "append to a conversation" and "read a conversation range by seq". A (conv_id, bucket) partition with seq clustering serves both with one sequential read. High write throughput, linear scale-out, tunable consistency.', 'HBase (Facebook Messenger’s original store), DynamoDB / Cosmos DB with the same key design; sharded MySQL works but needs resharding and large range scans hurt.'],
    ['Sessions, presence, sequence counters', 'Redis cluster', 'Tiny, very hot, mostly ephemeral data with millions of ops/s; TTLs fit presence; INCR is atomic per key.', 'Consistent hashing of users to gateways (no registry lookup) is faster but makes rebalancing and multi-device harder.'],
    ['Membership and watermarks', 'Cassandra or sharded SQL', 'Read on every send (who are the members?) and cached aggressively; written rarely.', 'Graph DB is overkill: membership is a one-hop list.'],
    ['Media', 'Object storage + CDN', 'Large immutable encrypted blobs; never through the socket.', 'Storing in the message store would bloat partitions and compaction.']
  ],
  diagram: {
    nodes: [['u', 'Sender', 'mobile', 0, 0.4, 'phone / desktop'], ['r', 'Recipient', 'mobile', 0, 2.5, 'one or more devices'], ['lb', 'L4 load balancer', 'lb', 1, 1.2, 'TCP / TLS pass-through'],
      ['blob', 'Media store', 'blob', 1, 3.1, 'encrypted files + CDN'], ['gwa', 'WS gateway A', 'gw', 2, 0.4, 'holds connections'], ['gwb', 'WS gateway B', 'gw', 2, 2.0, 'holds connections'],
      ['chat', 'Chat service', 'svc', 3, 1.2, 'seq, persist, route'], ['sess', 'Session registry', 'cache', 4, 0.2, 'user → gateway'], ['seq', 'Sequencer', 'cache', 5, 0.5, 'INCR per conversation'],
      ['mdb', 'Message store', 'nosql', 5, 1.4, 'Cassandra by conv_id'], ['conv', 'Conversations', 'nosql', 4, 2.0, 'members, watermarks'], ['kafka', 'Offline events', 'stream', 3, 3.0, 'Kafka'],
      ['push', 'Push workers', 'worker', 5, 3.0, 'notification fan-out'], ['apns', 'APNs / FCM', 'ext', 6, 2.5, 'OS push services']],
    edges: [['u', 'lb'], ['r', 'lb'], ['lb', 'gwa'], ['lb', 'gwb'], ['gwa', 'chat'], ['chat', 'gwb', 'deliver'], ['gwa', 'sess', 'register'], ['chat', 'sess', 'lookup'], ['chat', 'seq'], ['chat', 'mdb'], ['chat', 'conv'],
      ['chat', 'kafka', '', 'async'], ['kafka', 'push', '', 'async'], ['push', 'apns'], ['apns', 'r', 'wake', 'async'], ['u', 'blob', 'upload'], ['r', 'blob', 'download']]
  },
  flows: [
    { name: '1:1 message, both online', desc: 'Alice sends Bob a message; both apps are in the foreground.', steps: [
      ['u', 'gwa', 'send {client_msg_id, conv}', 'The frame travels over Alice’s already-open WebSocket. client_msg_id is generated on her phone so a resend after a network blip can be recognised.'],
      ['gwa', 'chat', 'forward (gRPC)', 'The gateway only terminates connections; business logic lives in the stateless chat service.'],
      ['chat', 'conv', 'membership check (cached)', 'Is Alice a member and not blocked? This is cached in the chat service; the store is the fallback.'],
      ['chat', 'seq', 'INCR seq:c77 → 1042', 'One atomic counter per conversation gives a total order that every participant will see. No global clock is needed.'],
      ['chat', 'mdb', 'INSERT (c77, 0, 1042)', 'Persist before acknowledging: quorum write (LOCAL_QUORUM) across zones. If this fails, Alice gets no ack and her app retries with the same client_msg_id.'],
      ['chat', 'gwa', 'ack {client_msg_id, seq 1042}', 'Alice sees one tick ("sent"). From here the message is durable even if every gateway reboots.', 'resp'],
      ['chat', 'sess', 'where is Bob?', 'The registry says Bob’s phone is on gateway B (and his laptop is offline).'],
      ['chat', 'gwb', 'deliver seq 1042', 'Routed straight to the gateway holding Bob’s connection.'],
      ['gwb', 'r', 'msg frame', 'Bob’s app stores it, decrypts it and replies with delivered up_to_seq=1042; that watermark flows back so Alice sees two ticks.', 'resp']],
      end: 'Persist-then-ack plus per-conversation sequence numbers give durability and ordering; the receipt is just a watermark travelling the reverse path.' },
    { name: 'Group message (200 members)', desc: 'A message to a group: stored once, delivered to many devices.', steps: [
      ['u', 'gwa', 'send to group g9', 'Same frame type as 1:1.'], ['gwa', 'chat', 'forward', 'Routed to any chat instance.'],
      ['chat', 'seq', 'INCR seq:g9', 'Group order is defined by this single counter, so two people sending at once still produce one agreed order.'],
      ['chat', 'mdb', 'INSERT once', 'One copy per group, not one per member (fan-out on read). Members read the same partition.'],
      ['chat', 'conv', 'member list (200)', 'From cache in practice.'],
      ['chat', 'sess', 'MGET 200 sessions', 'One batched lookup returns the gateways for online member devices; members are then grouped by gateway.'],
      { par: [['chat', 'gwa', 'batch for gateway A'], ['chat', 'gwb', 'batch for gateway B']], msg: 'One RPC per gateway carrying all its recipients, instead of 200 separate calls.' },
      ['chat', 'kafka', 'offline members', 'Members with no live connection are published for push notification.', 'async'],
      ['chat', 'u', 'ack seq', 'The sender is acknowledged as soon as the message is stored, not after all deliveries.', 'resp']],
      end: 'Groups store once and fan out deliveries; very large groups switch to pull (clients fetch on notification) to cap fan-out cost.' },
    { name: 'Offline recipient: push and sync', desc: 'Bob’s phone is asleep. He gets a notification, opens the app and catches up.', steps: [
      ['chat', 'sess', 'lookup Bob', 'No live session for any of Bob’s devices.', 'err'],
      ['chat', 'kafka', 'offline_delivery {bob, c77}', 'Queue a push; the message itself is already safe in the store.', 'async'],
      ['kafka', 'push', 'consume', 'Push workers collapse several pending messages for the same device into one notification.', 'async'],
      ['push', 'apns', 'notification (no content)', 'With E2EE the payload is just "new message" plus ids; the app wakes briefly, fetches and decrypts to show a preview.'],
      ['apns', 'r', 'wake device', 'Delivered by Apple / Google.', 'async'],
      ['r', 'lb', 'WSS connect', 'Bob taps the notification; the app opens a new WebSocket.'],
      ['lb', 'gwb', 'new connection', 'Any gateway will do.'],
      ['gwb', 'chat', 'sync since cursor', 'The app sends its sync cursor (or last seq per conversation). The chat service reads the inbox for conversations whose last_seq is higher.'],
      ['chat', 'mdb', 'SELECT seq > 1035', 'One partition range scan per changed conversation returns exactly the missed messages, in order.'],
      ['chat', 'gwb', 'backlog + new cursor', 'Delivered in seq order; the client acknowledges up_to_seq and stores the new cursor.', 'resp']],
      end: 'Clients never depend on a push or a live delivery arriving: the store plus a sync cursor is the source of truth, and live delivery is an optimisation.' },
    { name: 'Gateway crash', desc: 'Gateway B dies with 500 k connections on it.', steps: [
      ['gwb', 'sess', 'lease expires', 'Gateway B stops renewing its lease key; within ~10 s every session pointing at it is treated as offline.', 'err'],
      ['chat', 'gwb', 'deliver fails', 'In-flight deliveries to B time out; nothing is lost because the messages were persisted before the sender was acked.', 'err'],
      ['chat', 'kafka', 'fall back to push', 'Pending recipients are treated as offline.', 'async'],
      ['r', 'lb', 'reconnect with jitter', 'Clients reconnect after a random 0-30 s backoff, so 500 k devices do not stampede the remaining gateways at once.'],
      ['lb', 'gwa', 'new connection', 'Load balancer sends them to healthy gateways, which were sized with spare capacity.'],
      ['gwa', 'sess', 'register device', 'The session now points at gateway A.'],
      ['gwa', 'chat', 'sync since cursor', 'Each client catches up from its own cursor; duplicates are dropped by seq on the device.'],
      ['chat', 'gwa', 'missed messages', 'Users see a short "connecting..." banner at most.', 'resp']],
      end: 'Connections are disposable; durability lives in the store and ordering in sequence numbers, so losing a gateway costs a reconnect, not data.' }
  ],
  components: [
    ['L4 load balancer', 'Spreads long-lived TCP/TLS connections across gateways; health checks; supports connection draining on deploy.'],
    ['WebSocket gateways', 'Hold connections, heartbeats, authenticate once, forward frames to the chat service, push frames to devices. Minimal logic so they rarely need redeploying.'],
    ['Session registry and presence', 'User/device &rarr; gateway map with gateway leases; online/last-seen derived from connections; typing indicators sent only to open conversations.'],
    ['Chat service', 'Validates, assigns sequence numbers, persists, acks, routes deliveries, updates watermarks and inboxes.'],
    ['Message store', 'Durable ordered history per conversation; serves sync and scroll-back.'],
    ['Push workers', 'Notifications for offline devices through APNs/FCM; collapse and rate-limit.'],
    ['Key directory', 'Public identity and prekeys for end-to-end encryption session setup.'],
    ['Media service', 'Pre-signed uploads/downloads of encrypted blobs, thumbnails, expiry.']
  ],
  deep: [
    ['Connection layer: gateways, sessions and presence', '<p>Each gateway is an event-loop server (Erlang/BEAM as at WhatsApp, Go, Rust or Netty) holding hundreds of thousands of sockets. Rules that keep it scalable:</p><ul><li><strong>Keep gateways thin.</strong> They hold connections and forward frames; deploys of business logic never drop sockets. Deploying a gateway itself means draining: stop accepting, tell clients to reconnect elsewhere over a few minutes.</li><li><strong>Session registry with leases.</strong> On connect, <code>HSET session:{uid} {device} {gw, conn}</code>. Each gateway renews <code>lease:{gw}</code> every few seconds; a session whose gateway lease has expired is offline. This avoids millions of per-user heartbeats hitting Redis.</li><li><strong>Presence</strong> is derived (online if any device is connected) and published only to users who are looking at you (an open chat or contact list), with last_seen written lazily. Broadcasting every change to every contact would cost more than messages.</li><li><strong>Reconnect storms:</strong> exponential backoff with jitter on clients, admission limits on gateways, and pre-warmed capacity per zone.</li></ul>'],
    ['Ordering with per-conversation sequence numbers', '<p>Clocks on phones and servers disagree, so timestamps cannot order messages. Instead each conversation has a monotonically increasing <strong>seq</strong>, assigned by one authority (a Redis <code>INCR</code>, or the single owner of the conversation’s partition). Consequences:</p><ul><li>Everyone sees the same order, even when two members send simultaneously.</li><li>Clients detect gaps ("I have 1040 and 1042, fetch 1041") and fetch them from the store.</li><li>Deduplication: the server keeps <code>client_msg_id &rarr; seq</code> for a short window, so a retried send returns the original seq instead of creating a second message; the client drops any seq it already has.</li><li>After a sequencer failover, re-seed from <code>max(seq)</code> in the store plus a gap (for example +1,000): gaps are harmless, duplicates are not.</li></ul><p>There is no global order across conversations, and none is needed. This is the same idea as a partition offset in Kafka.</p>'],
    ['Message store schema', '<pre><code>CREATE TABLE messages (\n  conv_id   uuid,\n  bucket    int,        -- seq / 10000\n  seq       bigint,\n  sender_id bigint,\n  client_msg_id uuid,\n  body      blob,       -- ciphertext\n  sent_at   timestamp,\n  PRIMARY KEY ((conv_id, bucket), seq)\n) WITH CLUSTERING ORDER BY (seq DESC);</code></pre><p>Opening a chat is one read: the newest bucket, <code>LIMIT 50</code>. Scroll-back walks down buckets. Sync is <code>WHERE seq &gt; :last</code>. Because the bucket is derived from seq, the client never has to guess which partition holds a message. Deletes ("delete for everyone") write a tombstone event with its own seq rather than mutating history, which also syncs cleanly to other devices. Old buckets can be compacted to object storage for cheaper retention.</p>'],
    ['Receipts and multi-device sync', '<p>Per-message receipts would triple write volume. Instead each member device sends <strong>watermarks</strong>: <code>delivered up_to_seq</code> and <code>read up_to_seq</code>. The server stores the latest value per member, and the sender’s UI shows two ticks for every message at or below the watermark. In groups, "read by all" is the minimum watermark across members.</p><p>Each device keeps its own sync cursor, so a laptop that was offline for a week catches up independently of the phone. With E2EE multi-device (WhatsApp, Signal), each device has its own keys and the sender encrypts once per device, so "devices" rather than "users" are the unit of delivery.</p>'],
    ['End-to-end encryption overview', '<p>Most large messengers use the <strong>Signal protocol</strong>: an initial key agreement (X3DH, now PQXDH with a post-quantum component) using prekeys fetched from the key directory, then the <strong>Double Ratchet</strong>, which derives a new key for every message (forward secrecy and post-compromise security). Groups use <strong>Sender Keys</strong>: each member distributes a symmetric sender key to the others once, then encrypts each message once. The IETF standard <strong>MLS</strong> (RFC 9420) scales group key updates to thousands of members with a tree of keys.</p><p>What changes for the back end: the server stores and routes opaque ciphertext; it cannot index, search or moderate content, so search runs on device and push previews are produced by the app after waking. Media is encrypted on the device with a random key, uploaded as an opaque blob, and the key travels inside the encrypted message. Metadata (who talks to whom, when) is still visible to the server, so minimise and expire it.</p>']
  ],
  scale: [
    '<strong>Connections:</strong> scale gateways horizontally; the limit per node is memory and file descriptors, not CPU. Tune kernel limits, use TLS session resumption and small per-connection buffers.',
    '<strong>Hot conversations:</strong> a huge group with constant traffic makes one sequencer key and one partition hot. Cap group size, shard very large channels, and switch them to pull delivery (notify "new messages in g9", clients fetch).',
    '<strong>Message store:</strong> growth is linear and predictable; add nodes, keep partitions bounded with buckets, and tier old buckets to cheaper storage.',
    '<strong>Cross-region:</strong> users are homed to a region; when sender and recipient are homed in different regions the chat service forwards to the recipient’s region over a backbone link, and conversations replicate asynchronously for DR.',
    '<strong>Push:</strong> APNs/FCM impose rate limits; collapse notifications per device and back off on 429s.'
  ],
  tradeoffs: [
    ['Transport', 'WebSocket vs MQTT vs long-poll / SSE', 'WebSocket (or MQTT over TLS, as Facebook Messenger used) for bidirectional low-latency frames; long-poll only as a fallback through restrictive proxies.'],
    ['Group delivery', 'Fan-out on write (copy per member inbox) vs store once and fan out notifications', 'Store once per conversation; deliver to online devices and let others sync. Per-member copies multiply storage by group size.'],
    ['Ordering authority', 'Per-conversation counter vs timestamps vs global sequencer', 'Per-conversation counter: total order where it matters, no global bottleneck, gaps detectable.'],
    ['Server-side history', 'Keep all history (Slack, Messenger) vs delete after delivery (classic WhatsApp)', 'Keeping history enables multi-device and new-device restore but costs storage and, without E2EE, privacy; with E2EE the server keeps only ciphertext or nothing.'],
    ['Receipts', 'Per message vs watermarks', 'Watermarks: one write acknowledges many messages; enough for ticks and "read by" lists.']
  ],
  failures: [
    ['Gateway crash', 'Lease expiry marks its sessions offline; clients reconnect with jittered backoff and sync from their cursors; no data loss because of persist-then-ack.'],
    ['Message store write fails or times out', 'No ack to the sender; client retries with the same client_msg_id; server deduplicates, so the user never sees two copies.'],
    ['Sequencer (Redis) failover', 'Re-seed counters from the store with a safety gap; clients tolerate gaps; optionally guard inserts with IF NOT EXISTS on (conv, seq).'],
    ['Zone loss', 'Gateways and services spread over three zones with spare capacity; Cassandra RF 3 across zones with LOCAL_QUORUM keeps reads and writes available.'],
    ['Push provider outage or throttling', 'Retry with backoff; the next app open syncs anyway, so push is best-effort.'],
    ['Client clock wrong or duplicate sends', 'Order by server seq, not device time; deduplicate by client_msg_id and seq on both sides.']
  ],
  cloud: [['DNS', 'dns'], ['Connection load balancing', 'lb'], ['WebSocket gateways', 'k8s'], ['Managed WebSocket alternative', 'realtime'], ['Chat services', 'containers'], ['Sessions, presence, sequencer', 'cache'], ['Message store', 'widecol'], ['Conversations and inbox (managed)', 'nosql'], ['Offline events', 'stream'], ['Push notifications', 'push'], ['Media storage', 'blob'], ['Media delivery', 'cdn'], ['Keys and secrets', 'secrets'], ['User identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-publisher-subscriber', 'azp-sequential-convoy', 'azPartition', 'azMessaging', 'azp-valet-key', 'azAksMicro', 'azEventDriven'],
          aws: ['awsPubSub', 'awsDdbBest', 'blBackoff', 'blShedding', 'blStatic', 'awsMicro'] },
  questions: [
    ['How do you guarantee exactly-once delivery?', 'You cannot over an unreliable network; you build at-least-once delivery plus idempotency. The client retries sends with the same client_msg_id and the server deduplicates; the server redelivers until a device acknowledges a watermark, and the device drops any seq it already has. The user experiences exactly once.'],
    ['How does the system know which server a user is connected to?', 'A session registry (Redis) maps user/device to gateway id, written on connect and validated with per-gateway leases. The alternative is deterministic routing (consistent hash of user id to gateway) which removes the lookup but complicates rebalancing and multi-device.'],
    ['What changes for a group of 100,000 members?', 'Delivery switches from push-to-everyone to notify-and-pull: online members get a lightweight "channel updated" hint (often only if they have it open), and fetch the messages themselves. Presence and typing indicators are disabled, read receipts are dropped, and the sequencer may be sharded by sub-channel.'],
    ['How does message ordering work across a sender’s two phones sending at the same time?', 'Both sends go to the same per-conversation counter, which serialises them. Each phone shows its own message optimistically, then reorders when the acks with the real seq arrive.'],
    ['How would you add search over history?', 'Without E2EE: index messages asynchronously from the stream into Elasticsearch partitioned by user or workspace (Slack does this). With E2EE: the server cannot read content, so search runs on device over the locally synced history.'],
    ['How do you keep typing indicators cheap?', 'They are ephemeral: sent through the gateways only to members with the conversation open, never stored, rate-limited to one event every few seconds, and dropped if the target is offline.']
  ],
  related: ['notification', 'video-conferencing', 'news-feed', 'unique-id', 'messaging']
});

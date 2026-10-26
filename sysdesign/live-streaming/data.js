SD.renderCase({
  slug: 'live-streaming',
  summary: 'A live streaming platform takes one broadcaster’s video, from OBS on a gaming PC or a phone on 4G, and delivers it to anywhere from three to three million viewers a few seconds later, with a chat room alongside. The pipeline is a conveyor belt that never stops: <strong>ingest</strong> at an edge near the streamer (RTMP, SRT or WebRTC via WHIP), <strong>real-time transcoding</strong> into an adaptive bitrate ladder on GPUs or ASICs, <strong>packaging</strong> into CMAF chunks served as <strong>Low-Latency HLS</strong> or low-latency DASH, and <strong>CDN fan-out</strong> with origin shields that collapse millions of requests into a handful. Every stage spends part of a 2-5 second <strong>latency budget</strong>. Chat is a separate real-time system: WebSocket gateways and pub/sub <strong>sharded by channel</strong>, with batching, sampling and moderation so a channel with 500,000 viewers stays readable. Everything is also recorded for <strong>VOD</strong> and clips.',
  examples: 'Twitch, YouTube Live, Kick, Facebook/Instagram Live, TikTok LIVE, LinkedIn Live; managed building blocks such as Amazon IVS (low-latency and real-time stages), AWS Elemental MediaLive/MediaPackage, Mux and Cloudflare Stream. (Azure Media Services was retired in 2024; on Azure you run your own GPU transcoders on AKS or Batch, or use a partner.)',
  functional: ['Broadcasters go live with a stream key from OBS, mobile apps or the browser (RTMP, SRT, WHIP).', 'Viewers watch with adaptive bitrate on web, mobile and TV, at 2-5 s latency (sub-second option for interactive shows).', 'Live chat with emotes, moderation, slow mode and per-channel rules.', 'Live viewer counts, follows and “went live” notifications.', 'Every broadcast recorded to VOD; clips and highlights.', 'DVR: pause and rewind a live stream for the last ~30-60 minutes.'],
  nonFunctional: ['Glass-to-glass latency 2-5 s with LL-HLS; &lt; 1 s for WebRTC delivery.', 'Rebuffering ratio &lt; 0.5% of watch time; startup &lt; 2 s.', 'A single channel can scale to 3+ million concurrent viewers with no preparation beyond capacity planning.', 'Ingest survives a transcoder or ingest node failure with a few seconds of disruption.', 'Cost per viewer-hour as low as possible: egress and transcoding dominate.'],
  outOfScope: ['Recommendation and discovery (see recommendation).', 'Payments, subscriptions and ads insertion details (SSAI mentioned only).', 'Codec internals.'],
  estimates: [
    ['Concurrent live channels', '~100,000 at peak', 'Long tail: most channels have &lt; 10 viewers, a few hundred have &gt; 10 K'],
    ['Concurrent viewers', '~5 million; one event up to 3 million', 'Average ~50 per channel, extremely skewed'],
    ['Ingest bandwidth', '~600 Gbit/s', '100 K &times; ~6 Mbit/s (1080p60 H.264)'],
    ['Channels transcoded', '~40,000 (40%)', 'Partners and channels above a viewer threshold get a full ladder; the rest get source passthrough (plus a 480p rendition when capacity allows)'],
    ['Ladder output per transcoded channel', '~14 Mbit/s', '1080p60 6 + 720p60 3.5 + 720p30 2.5 + 480p 1.2 + 360p 0.7 + 160p 0.2 Mbit/s (source copied, others encoded)'],
    ['Viewer egress', '~20 Tbit/s; ~15 Tbit/s for one 3 M event', '5 M &times; ~4 Mbit/s average rendition'],
    ['Edge requests', '~10 million req/s', 'LL-HLS: each viewer fetches a ~0.33 s part plus a blocking playlist update ~2&times;/s'],
    ['Chat', '~50 K messages/s in, ~25 M deliveries/s out', 'Deliveries = viewers &times; displayed message rate (capped ~5/s per viewer by sampling and batching)'],
    ['VOD storage', '~4 PB/day, ~55 PB rolling', '~1.44 M broadcast-hours/day &times; ~2.7 GB/h source; 14-60 day retention, highlights kept forever']
  ],
  compute: [
    ['Ingest edges', '~200 nodes (10 Gbit/s) in ~30 PoPs', '600 Gbit/s / 10 Gbit/s at 50% (bursty, RTMPS/SRT decryption) = 120; N+1 per PoP brings it to ~200.'],
    ['Real-time transcoders', '~7,000 GPUs (or VPU/ASIC cards) + 10% warm standby', 'One GPU (e.g. NVIDIA L4 NVENC) encodes ~8 full 1080p60 ladders in real time: 40 K / 8 = 5,000; at 70% target &asymp; 7,000. ASICs (AWS VT1-class VPUs, YouTube Argos) roughly double density per watt.'],
    ['Packager / origin', '~320 nodes, sharded by channel', 'CDN shields pull ~1 M req/s &times; ~200 KB parts = ~1.6 Tbit/s from origin; 10 Gbit/s per node at 50% = 320. Each channel lives on a primary and a secondary origin.'],
    ['CDN', '~20 Tbit/s peak, multi-CDN', 'Bought, not built, for most platforms: commit capacity with two or three CDNs and pre-warm for scheduled mega-events.'],
    ['Chat gateways', '~250 nodes', '5 M WebSockets / 50 K per node = 100 by connections; with 200 ms batching deliveries become ~10 M frames/s / 40 K per node = 250.'],
    ['Chat pub/sub', '~50 shards (Redis / NATS)', '50 K msgs/s in; each message goes once to every gateway with a subscriber for that channel (up to all 250 for a giant channel): ~2-5 M internal deliveries/s.']
  ],
  api: [
    ['rtmps://ingest.example.tv/app/{streamKey}  |  srt://...?streamid={key}', 'Ingest. Anycast or geo-DNS sends the broadcaster to the nearest ingest PoP; the stream key is validated against the control plane.'],
    ['POST /whip/{channelId}  (Authorization: Bearer key, SDP offer)', 'WebRTC-HTTP Ingestion Protocol for browser and low-latency publishing; returns the SDP answer.'],
    ['GET /live/{channel}/master.m3u8?token=...', 'Multivariant playlist listing the renditions; short-lived signed token (valet key) bound to channel and expiry.'],
    ['GET /live/{channel}/{rendition}/index.m3u8?_HLS_msn=1203&_HLS_part=2', 'LL-HLS blocking playlist reload: the edge holds the request until part 2 of segment 1203 exists, so players learn about new parts instantly without polling.'],
    ['WS /chat?channel={id}  send {text, nonce}  recv [batch]', 'Chat over WebSocket; outbound messages are batched every ~100-200 ms; nonce makes client retries idempotent.'],
    ['GET /videos/{vodId}  |  POST /clips {channel, offset, duration}', 'VOD playback (normal HLS from object storage) and clip creation from the DVR window.'],
    ['Event: stream.online / stream.offline', 'Published on the event bus; drives notifications, the directory page and webhooks for third parties.']
  ],
  data: [
    ['channels', 'Relational DB', 'channel_id, owner_id, stream_key_hash, transcode tier, latency mode, settings; index on owner_id.'],
    ['live_sessions', 'Redis (+ SQL history)', 'channel_id &rarr; session_id, ingest node, transcoder id, origin primary/secondary, started_at, state; heartbeats every 2 s.'],
    ['live parts and segments', 'Origin memory + object storage', 'Last ~60 s of parts in RAM on the origin; segments written to object storage for DVR and VOD: live/{channel}/{session}/{rendition}/{seq}.m4s.'],
    ['chat_messages', 'Cassandra / ScyllaDB', 'Partition (channel_id, day), clustering (ts, message_id); user_id, text, badges, moderation state; TTL by policy. Used for history, moderation and replay alongside VOD.'],
    ['vods and clips', 'SQL metadata + object storage', 'vod_id, channel, session, duration, renditions, thumbnails; files in tiered storage with lifecycle rules.'],
    ['viewer and QoE metrics', 'Stream &rarr; time-series DB', 'Per session heartbeats: rendition, buffer health, rebuffer events, latency; aggregated per channel for live counts.']
  ],
  dbChoice: [
    ['Live session state', 'In-memory key-value (Redis)', 'Updated every few seconds, read on every playback start and failover decision; rebuildable from heartbeats.', 'SQL: too write-heavy for heartbeats; etcd: fine for leader leases but not per-viewer data.'],
    ['Chat history', 'Wide-column (Cassandra / ScyllaDB)', 'Append-heavy, time-ordered per channel, TTL support, linear write scaling.', 'Kafka alone: good log, poor for “last 100 messages of channel X”. SQL: hot partitions on big channels.'],
    ['Video segments and VOD', 'Object storage behind the CDN', 'Immutable files, enormous volume, lifecycle tiers, origin for CDN pulls.', 'Block storage on origin servers: no durability or shared access.'],
    ['Channels and accounts', 'Relational (PostgreSQL / Azure SQL)', 'Transactional updates, modest volume, relationships (teams, moderators, subscriptions).', 'Document DB: workable if settings are very fluid.']
  ],
  diagram: {
    nodes: [['st', 'Broadcaster', 'client', 0, 0.9, 'OBS, mobile, browser'], ['ing', 'Ingest edge', 'gw', 1, 0.9, 'RTMP, SRT, WHIP'], ['tc', 'Live transcoders', 'gpu', 2, 0.9, 'ABR ladder'],
      ['pkg', 'Packager / origin', 'svc', 3, 0.9, 'CMAF, LL-HLS'], ['shield', 'Origin shield', 'cdn', 4, 0.9, 'request collapsing'], ['cdn', 'CDN edges', 'cdn', 5, 0.9, 'multi-CDN'],
      ['v', 'Viewers', 'client', 6, 1.6, 'web, mobile, TV'], ['ctl', 'Stream control', 'svc', 1, 2.3, 'keys, sessions'], ['db', 'Channels DB', 'db', 2, 3.3, 'SQL + Redis state'],
      ['vod', 'VOD archive', 'blob', 3, 1.75, 'object storage'], ['ps', 'Chat pub/sub', 'bus', 4, 2.3, 'sharded by channel'], ['cgw', 'Chat gateways', 'gw', 5, 2.3, 'WebSocket'],
      ['chist', 'Chat history', 'nosql', 4, 3.4, 'Cassandra']],
    edges: [['st', 'ing', 'RTMP/SRT'], ['ing', 'ctl', 'auth key'], ['ctl', 'db'], ['ing', 'tc'], ['tc', 'pkg', 'renditions'], ['pkg', 'shield'], ['shield', 'cdn'], ['v', 'cdn', 'LL-HLS'],
      ['pkg', 'vod', '', 'async'], ['shield', 'vod', 'VOD'], ['v', 'cgw', 'WebSocket'], ['cgw', 'ps'], ['ps', 'chist', '', 'async'], ['ctl', 'ps', 'live events', 'async']]
  },
  flows: [
    { name: 'Go live', desc: 'A broadcaster presses “Start streaming”: authenticate, place a transcoder, start packaging and recording.', steps: [
      ['st', 'ing', 'RTMPS connect + stream key', 'OBS connects to the nearest ingest PoP (geo-DNS). Ingest close to the broadcaster keeps the fragile first mile short.'],
      ['ing', 'ctl', 'validate key', 'The control plane checks the key hash, bans and channel settings (transcode tier, latency mode).'],
      ['ctl', 'db', 'create live session', 'Records session id, ingest node and assigns a transcoder in the same region; session state goes to Redis with heartbeats.'],
      ['ing', 'tc', 'forward source (2 s GOP)', 'The source must have a keyframe every 2 s; renditions are cut on the same boundaries so players can switch quality cleanly.'],
      ['tc', 'pkg', '6 renditions, aligned', 'The GPU decodes once and encodes the ladder (1080p60 source copy, 720p60 … 160p) with identical timestamps and keyframes.'],
      ['pkg', 'vod', 'write segments', 'The packager emits CMAF parts for live and also writes full segments to object storage for DVR and VOD.', 'async'],
      ['ctl', 'ps', 'stream.online', 'The “went live” event fans out to followers’ notifications and opens the chat room.', 'async']],
      end: 'From key validation to the first playable part takes ~2-3 s. All renditions share keyframe boundaries, which is what makes adaptive switching seamless.' },
    { name: 'Watch at low latency', desc: 'A viewer joins a popular stream with LL-HLS; most of the work is done by the CDN.', steps: [
      ['v', 'cdn', 'GET master.m3u8 (token)', 'The player fetches the multivariant playlist and picks a starting rendition from its bandwidth estimate.'],
      ['v', 'cdn', 'blocking reload msn=1203 p=2', 'Blocking playlist reload: the request waits at the edge until the next part exists, then returns immediately.'],
      ['cdn', 'shield', 'miss: one request per PoP', 'Thousands of viewers on the same edge ask for the same part at the same moment; the edge collapses them into one upstream request.'],
      ['shield', 'pkg', 'collapsed fetch', 'The shield collapses again across edges, so the origin sees a handful of requests per part instead of millions.'],
      ['pkg', 'shield', 'part 1203.2 (0.33 s, chunked)', 'The origin streams the part with chunked transfer as the encoder produces it.', 'resp'],
      ['shield', 'cdn', 'cache 1 part TTL', 'Parts are immutable and cacheable; playlists are cached for a fraction of a part duration.', 'resp'],
      ['cdn', 'v', 'part + preload hint', 'The playlist’s EXT-X-PRELOAD-HINT lets the player request the next part before it exists, so the bytes stream as soon as they are encoded.', 'resp'],
      ['v', 'cdn', 'ABR switch to 720p30', 'If throughput drops, the player switches rendition at the next independent part; buffer target ~1-2 s.']],
      end: 'Latency comes from the size of the units in flight: 0.33 s parts and blocking reloads give 2-4 s glass to glass, versus 15-30 s with classic 6 s segments.' },
    { name: 'Chat at scale', desc: 'A message in a channel with 500,000 viewers.', steps: [
      ['v', 'cgw', 'send {text, nonce}', 'The viewer’s WebSocket gateway rate-limits per user (e.g. 1 msg/s, slow mode 30 s) and checks bans.'],
      ['cgw', 'ps', 'moderate, publish chat:ch42', 'AutoMod (blocked terms + an ML toxicity model) runs before publish; held messages go to moderators. The channel id picks the pub/sub shard.'],
      ['ps', 'cgw', 'to subscribed gateways', 'Only gateways with at least one viewer of channel 42 subscribe; for this channel that is every gateway, but each gets the message once.', 'resp'],
      ['cgw', 'v', 'batched frame every 200 ms', 'Gateways batch messages into one frame per connection per interval, which cuts frames and CPU by 10× or more. At very high rates each gateway samples to a readable ~20-50 msgs/s.', 'resp'],
      ['ps', 'chist', 'persist (async)', 'History is written asynchronously, keyed by channel and day, for scrollback, moderation and VOD chat replay.', 'async']],
      end: 'Shard pub/sub by channel, fan out once per gateway and batch per connection. Beyond a certain rate, nobody can read every message anyway: sample deliberately.' },
    { name: 'Stream to VOD', desc: 'The broadcaster ends the stream; the recording becomes a VOD within seconds.', steps: [
      ['st', 'ing', 'disconnect', 'OBS stops sending; the ingest node waits ~30 s for a reconnect before declaring the stream over.'],
      ['ing', 'ctl', 'session ended', 'The control plane closes the session and emits stream.offline.'],
      ['ctl', 'ps', 'stream.offline', 'Chat switches to offline mode; the directory removes the channel.', 'async'],
      ['pkg', 'vod', 'final playlist (ENDLIST)', 'The VOD is simply the segments already in object storage plus a finished playlist: no re-encode needed.'],
      ['v', 'cdn', 'GET /videos/981', 'Viewers can watch immediately; VOD requests are ordinary cacheable HLS.'],
      ['cdn', 'shield', 'miss', 'Older VOD content is long-tail and often misses the edge.'],
      ['shield', 'vod', 'origin read', 'Object storage is the origin for VOD; lifecycle rules move it to a cool tier after 14 days.', 'resp']],
      end: 'Recording continuously during the live stream makes VOD nearly free. Popular VODs can later be re-encoded offline with better compression.' },
    { name: 'Transcoder failure', desc: 'The GPU host transcoding a large channel dies mid-stream.', steps: [
      ['tc', 'pkg', 'renditions stop', 'The packager sees no new parts for the channel within ~1 s.', 'err'],
      ['ing', 'ctl', 'transcoder heartbeat lost', 'The ingest node and control plane both notice the missing heartbeat.', 'err'],
      ['ctl', 'db', 'reassign to warm standby', 'A warm standby GPU in the same region (10% pool) takes over; for top channels a hot redundant transcoder may already be running.'],
      ['ing', 'tc', 'resend from last keyframe', 'The ingest node keeps a few seconds of source in a ring buffer and resends from the latest keyframe.'],
      ['tc', 'pkg', 'resume with discontinuity', 'The packager inserts EXT-X-DISCONTINUITY so players reset decoders cleanly.'],
      ['cdn', 'v', 'short rebuffer (~2-3 s)', 'Players with a 1-2 s buffer may stall briefly; their latency target pulls them back to live edge afterwards.', 'err']],
      end: 'Live pipelines cannot retry later: keep warm standbys, buffer source at ingest and make every stage restartable from the last keyframe.' }
  ],
  components: [
    ['Ingest edges', 'Terminate RTMP(S), SRT and WHIP close to broadcasters; authenticate stream keys; buffer and forward the source.'],
    ['Stream control plane', 'Stream keys, live sessions, transcoder and origin placement, health and failover, online/offline events.'],
    ['Real-time transcoders', 'Decode once and encode an aligned ABR ladder on GPUs or ASICs; passthrough for small channels.'],
    ['Packager / origin', 'Cut CMAF parts and segments, generate LL-HLS and LL-DASH manifests, serve blocking playlist reloads, write to storage.'],
    ['Origin shield + CDN', 'Collapse requests, cache parts and segments, deliver to millions; multi-CDN steering by QoE.'],
    ['Chat system', 'WebSocket gateways, pub/sub sharded by channel, moderation, rate limits, batching, history.'],
    ['VOD and clips', 'Segments in object storage become VODs; clips cut from the DVR window; offline re-encode for popular content.'],
    ['QoE and analytics', 'Player heartbeats: rebuffering, latency, bitrate; live viewer counts; CDN performance per ISP.']
  ],
  evolutionTitle: 'From one streaming server to a global live platform',
  evolution: [
    { name: '1. One server', desc: 'An nginx-rtmp or SRS box takes RTMP in and serves classic HLS out. Fine for a company town hall.', diagram: { nodes: [['st', 'Broadcaster', 'client', 0, 0], ['s', 'Media server', 'svc', 1.5, 0, 'RTMP in, HLS out'], ['v', 'Viewers', 'client', 3, 0]], edges: [['st', 's'], ['v', 's']] },
      steps: [['st', 's', 'RTMP', 'The source arrives on one box.'], ['v', 's', 'HLS 6 s segments', 'Viewers poll for segments: 15-30 s latency, one bitrate, a few hundred viewers before the NIC saturates.']] },
    { name: '2. Transcode + CDN', desc: 'Add an ABR ladder and put a CDN in front of the origin.', diagram: { nodes: [['st', 'Broadcaster', 'client', 0, 0.5], ['tc', 'Transcoder', 'gpu', 1.2, 0.5], ['o', 'Origin', 'svc', 2.4, 0.5], ['c', 'CDN', 'cdn', 3.6, 0.5], ['v', 'Viewers', 'client', 4.8, 0.5]], edges: [['st', 'tc'], ['tc', 'o'], ['o', 'c'], ['v', 'c']] },
      steps: [['st', 'tc', 'source', 'One source in.'], ['tc', 'o', 'ladder', 'Several renditions out, so mobile viewers get 480p and TVs 1080p.'], ['v', 'c', 'cached segments', 'The CDN serves millions; the origin sees only misses.'], ['c', 'o', 'misses only', 'Origin load is now independent of audience size.']] },
    { name: '3. Low latency + chat', desc: 'Global ingest PoPs, CMAF parts with LL-HLS, shields, and a sharded chat system.', diagram: { nodes: [['st', 'Broadcaster', 'client', 0, 0.4], ['i', 'Ingest PoP', 'gw', 1.2, 0.4], ['p', 'Packager', 'svc', 2.4, 0.4, 'CMAF parts'], ['c', 'Shield + CDN', 'cdn', 3.6, 0.4], ['v', 'Viewers', 'client', 4.8, 0.9], ['ch', 'Chat', 'bus', 3.6, 1.5, 'pub/sub by channel']], edges: [['st', 'i'], ['i', 'p'], ['p', 'c'], ['v', 'c'], ['v', 'ch']] },
      steps: [['st', 'i', 'SRT (lossy 4G)', 'SRT’s retransmission window copes with mobile broadcasters.'], ['i', 'p', 'transcode + part', '0.33 s parts instead of 6 s segments.'], ['v', 'c', 'blocking reload', '2-4 s latency at CDN scale.'], ['v', 'ch', 'chat', 'Chat now matches the video timing closely enough for real interaction.']] }
  ],
  deep: [
    ['Ingest protocols: RTMP, SRT, WHIP', '<ul><li><strong>RTMP(S)</strong>: TCP, the universal default from OBS and every encoder. Simple, but head-of-line blocking on lossy links. Enhanced RTMP adds HEVC, AV1 and multitrack.</li><li><strong>SRT</strong>: UDP with selective retransmission inside a configurable latency window (e.g. 4&times; RTT), AES encryption and stream ids; much better for mobile and long-haul contribution.</li><li><strong>WHIP</strong>: WebRTC ingest over a simple HTTP POST of an SDP offer; sub-second, works from a browser, and pairs with WHEP for real-time delivery (Amazon IVS real-time stages use the same model).</li></ul><p>Whatever the protocol, ingest PoPs sit close to broadcasters, authenticate by stream key, keep a few seconds of source in a ring buffer for transcoder failover, and forward over the provider backbone to the transcoding region.</p>'],
    ['Real-time transcoding ladder', '<table><tr><th>Rendition</th><th>Resolution / fps</th><th>Bitrate</th></tr><tr><td>Source (copied)</td><td>1080p60</td><td>6 Mbit/s</td></tr><tr><td>720p60</td><td>1280&times;720 @ 60</td><td>3.5 Mbit/s</td></tr><tr><td>720p30</td><td>1280&times;720 @ 30</td><td>2.5 Mbit/s</td></tr><tr><td>480p</td><td>852&times;480 @ 30</td><td>1.2 Mbit/s</td></tr><tr><td>360p</td><td>640&times;360 @ 30</td><td>0.7 Mbit/s</td></tr><tr><td>160p</td><td>284&times;160 @ 30</td><td>0.2 Mbit/s</td></tr></table><p>All renditions share timestamps and a 2 s keyframe interval so segments and parts align and players can switch at any boundary. Transcoding is the biggest compute cost, so platforms tier it: full ladders for partners and popular channels, passthrough for the long tail, and <strong>client-side multi-encoding</strong> (Twitch Enhanced Broadcasting sends several renditions from the streamer’s own GPU). Hardware: NVENC GPUs, or dedicated video ASICs for 2-4&times; better density per watt. Newer codecs (HEVC, AV1) cut egress by 30-50% for devices that support them, at more encode cost.</p>'],
    ['LL-HLS, low-latency DASH and the latency budget', '<p>Classic HLS with 6 s segments and a three-segment player buffer has 15-30 s latency. <strong>CMAF</strong> splits each 2 s segment into ~0.33 s <strong>parts</strong> (chunks) that are published as soon as encoded. LL-HLS adds <code>EXT-X-PART</code>, <code>EXT-X-PRELOAD-HINT</code>, blocking playlist reload (<code>_HLS_msn</code>, <code>_HLS_part</code>) and delta playlists; LL-DASH streams the same CMAF chunks with HTTP chunked transfer and <code>availabilityTimeOffset</code>. One set of CMAF files can serve both.</p><table><tr><th>Stage</th><th>Typical latency</th></tr><tr><td>Capture + encoder buffer at the broadcaster</td><td>0.3-1 s</td></tr><tr><td>First mile to ingest</td><td>0.05-0.3 s</td></tr><tr><td>Transcode</td><td>0.2-0.5 s</td></tr><tr><td>Packaging (one part)</td><td>0.33 s</td></tr><tr><td>CDN (shield + edge)</td><td>0.05-0.3 s</td></tr><tr><td>Player buffer (2-3 parts)</td><td>0.7-1.5 s</td></tr><tr><td><strong>Total</strong></td><td><strong>~2-4 s</strong></td></tr></table><p>Going below ~1.5 s needs WebRTC delivery (WHEP, Amazon IVS real-time), which costs more per viewer because it cannot use HTTP caching.</p>'],
    ['CDN fan-out for a 3-million-viewer event', '<p>At 5 Mbit/s, 3 M viewers is 15 Tbit/s from a single channel. Every part is requested by millions of players within the same ~300 ms, so the design relies on <strong>request collapsing</strong> at the edge and at an <strong>origin shield</strong> tier: the origin sees roughly (shield PoPs &times; renditions) requests per part, a few hundred, regardless of audience. Other practices: multi-CDN with real-time steering on QoE beacons, capacity reservations with CDNs for scheduled events, signed short-lived URLs (valet key) bound to channel, and a fallback to slightly higher latency (more parts buffered) when an edge is congested rather than rebuffering.</p>'],
    ['Chat at scale', '<p>Chat is a pub/sub problem with an extreme fan-out skew. Shard topics by channel id across pub/sub nodes; each WebSocket gateway subscribes only to the channels its connected viewers watch, so a message crosses the network once per gateway, not once per viewer. Gateways <strong>batch</strong> outgoing messages every 100-200 ms and <strong>sample</strong> when a channel exceeds what humans can read (~20-50 msgs/s visible), always delivering moderator, broadcaster and the sender’s own messages. Abuse controls run before publish: per-user rate limits, slow mode, followers-only and emote-only modes, AutoMod with a blocked-terms list and an ML classifier. History is persisted asynchronously and replayed in sync with the VOD by timestamp.</p>']
  ],
  scale: [
    '<strong>Egress cost:</strong> the dominant bill. Use efficient codecs (HEVC/AV1 where supported), cap renditions by device (no 1080p60 to phones), and negotiate committed CDN capacity.',
    '<strong>Transcoding capacity:</strong> tier channels (full ladder vs passthrough), use GPUs/ASICs, client-side multi-encoding, and keep a warm standby pool rather than full redundancy for everyone.',
    '<strong>Origin hot spots:</strong> one mega channel on one origin is fine only because shields collapse requests; still place top channels on dedicated origin pairs and pre-warm shields.',
    '<strong>Chat for huge channels:</strong> hierarchical fan-out (pub/sub &rarr; regional relays &rarr; gateways), batching and sampling; slow mode enforced server-side.',
    '<strong>Start-of-event surges:</strong> a million viewers joining within a minute hit playlist and token endpoints: cache the master playlist at the edge and issue tokens from a stateless signer.',
    '<strong>Storage growth:</strong> petabytes per day of VOD; short default retention, cool tiers, and deletion of renditions that nobody watched (re-create from source on demand).'
  ],
  tradeoffs: [
    ['Delivery latency', 'Classic HLS (15-30 s) vs LL-HLS/LL-DASH (2-5 s) vs WebRTC (&lt; 1 s)', 'LL-HLS as default: near-interactive at CDN economics. WebRTC only for interactive formats (auctions, co-streams, Q and A), where cost per viewer is higher.'],
    ['Ingest protocol', 'RTMP vs SRT vs WHIP', 'Accept all three: RTMP for compatibility, SRT for poor networks and professional feeds, WHIP for browsers and real-time.'],
    ['Transcode everything?', 'Full ladder for all channels vs tiered', 'Tiered: 60% of channels have a handful of viewers; passthrough saves thousands of GPUs. Promote a channel to a full ladder when its audience grows.'],
    ['Build or buy', 'Own pipeline vs Amazon IVS / MediaLive / Mux', 'Buy (IVS) for a product feature or a moderate platform; build when live video is the core business and per-viewer-hour cost dominates.'],
    ['Chat completeness', 'Deliver every message vs sample above a rate', 'Sample for giant channels: readability and cost both improve, and nobody can read 1,000 msgs/s.']
  ],
  failures: [
    ['Broadcaster’s connection drops briefly', 'Ingest waits ~30 s for a reconnect and resumes the same session; players show a “reconnecting” slate instead of ending the stream.'],
    ['Transcoder host failure', 'Warm standby takes over from the ingest ring buffer at the last keyframe; packager inserts a discontinuity; ~2-3 s rebuffer.'],
    ['Origin node failure', 'Each channel has a primary and secondary origin writing identical parts; shields fail over by health check.'],
    ['CDN degradation in a region', 'Multi-CDN steering on QoE beacons moves viewers to another CDN within minutes; players increase buffer to ride out congestion.'],
    ['Chat flood or raid', 'Per-user and per-channel rate limits, slow and followers-only modes, AutoMod, and sampling at the gateway.'],
    ['Ingest PoP outage', 'Geo-DNS / anycast sends reconnects to the next PoP; OBS retries automatically.'],
    ['Stolen stream key', 'Keys are hashed at rest, rotatable instantly; concurrent-ingest detection alerts the owner.']
  ],
  cloud: [['DNS and geo routing for ingest', 'dns'], ['Anycast ingest acceleration', 'globallb'], ['Managed live video (buy option)', 'livevideo'], ['Ingest edge servers', 'vms'],
    ['Real-time transcoding fleet', 'gpu', 'livevideo'], ['VOD re-encoding and clips', 'transcode'], ['Packager / origin and control plane', 'k8s'], ['CDN delivery', 'cdn'], ['Segments, VOD and clips', 'blob'],
    ['Channels and accounts', 'sql'], ['Live session state', 'cache'], ['Chat WebSockets (managed option)', 'realtime'], ['Chat history', 'widecol'], ['Live events bus', 'stream'], ['QoE analytics', 'timeseries'], ['Chat moderation model', 'guardrails']],
  refs: { az: ['azCdn', 'azp-publisher-subscriber', 'azp-sharding', 'azp-valet-key', 'azp-static-content-hosting', 'azAutoscale', 'azBigCompute', 'azEventDriven'],
          aws: ['awsMediaLens', 'awsPubSub', 'blShedding', 'blStatic', 'blBacklog', 'awsDiagrams'] },
  questions: [
    ['Why not use WebRTC for every viewer?', 'WebRTC gives sub-second latency, but each viewer needs a stateful, encrypted media session on a server; there is no HTTP caching, so cost per viewer is several times higher than CDN-delivered LL-HLS. Use it for interactive formats and keep LL-HLS for mass audiences.'],
    ['How does LL-HLS achieve 2-4 s latency?', 'By shrinking the unit of delivery from 6 s segments to ~0.33 s CMAF parts, letting players learn about new parts instantly through blocking playlist reloads, and preload hints that let the player request the next part before it is finished. The player buffer can then be ~1 s instead of 18 s.'],
    ['How do you handle a channel that suddenly gets 1 million viewers?', 'The video side is mostly fine thanks to request collapsing at edge and shield; make sure the channel has a full ladder (promote from passthrough), move it to a dedicated origin pair, and pre-warm shields. For chat, enable sampling and slow mode automatically above thresholds.'],
    ['Why must renditions have aligned keyframes?', 'Players switch quality at segment or part boundaries, and a decoder can only start at a keyframe. If keyframes are not aligned across renditions, a switch would show artefacts or require waiting for the next keyframe.'],
    ['How is chat kept in order?', 'Order matters only within a channel. Routing each channel to one pub/sub shard gives a per-channel order; gateways deliver in that order. Messages carry server timestamps for VOD replay. Cross-channel order is irrelevant.'],
    ['What changes if you build this on Azure?', 'Azure Media Services is retired, so run FFmpeg or GPU encoders on AKS GPU node pools or Azure Batch, package with an open-source packager (e.g. Shaka Packager or GPAC), and deliver through Azure Front Door or a third-party CDN. On AWS, Amazon IVS covers the whole pipeline, or MediaLive + MediaPackage + CloudFront for a custom one.']
  ],
  related: ['video-streaming', 'video-conferencing', 'chat', 'notification', 'content-moderation']
});

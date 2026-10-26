SD.renderCase({
  slug: 'video-conferencing',
  summary: 'A video conferencing service puts people in a room and moves their audio and video between them with a mouth-to-ear delay low enough for natural conversation (under ~150-200 ms), over networks that drop packets, change bandwidth every second and hide devices behind NATs and firewalls. Browsers and apps speak <strong>WebRTC</strong>: a signalling channel (our own WebSocket protocol) exchanges SDP offers and answers, <strong>ICE</strong> finds a working network path using <strong>STUN</strong> and, when UDP is blocked, <strong>TURN</strong> relays, and media flows as encrypted SRTP over UDP. At scale the media server is a <strong>Selective Forwarding Unit (SFU)</strong>: each participant uploads one stream (as <strong>simulcast</strong> layers or <strong>SVC</strong>) and the SFU forwards the right quality to each receiver based on its <strong>bandwidth estimate</strong>, without decoding. SFUs are placed close to users and <strong>cascaded</strong> over a backbone for global meetings; recording, captions and huge webinars hang off the same media plane, and end-to-end encryption is a deliberate trade-off against those server-side features.',
  examples: 'Zoom, Microsoft Teams, Google Meet, Webex, Slack huddles, Discord voice/video; open-source SFUs such as LiveKit, mediasoup, Janus and Jitsi Videobridge; CPaaS offerings such as Azure Communication Services, Amazon Chime SDK, Twilio and Daily.',
  functional: ['Create, schedule and join meetings by link; lobby, host controls (mute, remove, roles).', 'Two-way audio and video for 2 to ~1,000 interactive participants; screen sharing.', 'Adaptive quality: gallery and speaker views, each receiver gets what its network and screen can handle.', 'Works behind corporate firewalls and on mobile networks.', 'Cloud recording, live captions and transcripts.', 'Webinars and town halls: tens of panellists, up to 100,000+ view-only attendees.'],
  nonFunctional: ['Mouth-to-ear latency &lt; 150 ms within a region, &lt; 300 ms intercontinental (ITU-T G.114 guidance).', 'Join in &lt; 3 s from click to first media.', 'Survive 10-20% packet loss with intelligible audio; audio always prioritised over video.', '99.99% availability for joining; an SFU failure reconnects users in a few seconds.', 'Media encrypted in transit (DTLS-SRTP); optional end-to-end encryption.', 'Scale to ~10 million concurrent participants worldwide with flash peaks on the hour.'],
  outOfScope: ['PSTN dial-in gateways (mentioned only as an E2EE trade-off).', 'Chat and file sharing inside meetings (see chat).', 'Codec implementation details.'],
  estimates: [
    ['Peak concurrent participants', '10 million', 'Global business-hours peak'],
    ['Concurrent meetings', '~1.7 million', 'Average 6 participants per meeting (heavily skewed: most 2-5, a few 500+)'],
    ['Join rate at the top of the hour', '~35,000 joins/s', '~2 M people join in the first minute of the hour'],
    ['Upload per participant', '~1 Mbit/s average', '60% cameras on &times; simulcast 720p+360p+180p (~1.2 + 0.3 + 0.1 = 1.6 Mbit/s) + Opus audio ~40 kbit/s'],
    ['Download per participant', '~1.5 Mbit/s average', 'Active speaker at 720p (~1.2) plus a few gallery tiles at low layers (~0.15 each)'],
    ['Total media through SFUs', '~25 Tbit/s', '10 M &times; (1 in + 1.5 out)'],
    ['Packet rate', '~3 billion packets/s', '25 Tbit/s / ~1,000-byte RTP packets &times; 8 bits'],
    ['TURN-relayed share', '~8% of participants, ~2 Tbit/s', 'Users behind UDP-blocking firewalls or symmetric NATs, relayed over TCP/TLS 443'],
    ['Recording', '~5% of meetings, ~450 MB per recorded hour', '720p composite at ~1 Mbit/s &asymp; 0.45 GB/h; ~85 K concurrent recordings &rArr; ~38 TB/hour at peak']
  ],
  compute: [
    ['SFU fleet', '~14,000 nodes (16 vCPU, 25 Gbit/s NIC) across ~25 regions', 'One node forwards ~1,000 participants: ~2.5 Gbit/s and ~310 K packets/s, CPU-bound on SRTP decrypt/encrypt and packet routing. 10 M / 1,000 = 10,000 at 100%; at 70% target &asymp; 14,000. Each region keeps N+1 zones of headroom.'],
    ['TURN relays', '~330 nodes (10 Gbit/s) at edge PoPs', '2 Tbit/s relayed / 10 Gbit/s per node at 60% &asymp; 330; anycast or geo-DNS to the nearest, TLS on 443 for strict firewalls.'],
    ['Signalling gateways', '~150 nodes', '10 M WebSockets / ~100 K per node = 100; &times; 1.5 to survive a zone. Join peak 35 K/s &times; ~10 messages = 350 K msgs/s, ~2.3 K per node.'],
    ['Meeting / placement service', '~40 &times; 8 vCPU', '35 K joins/s &times; ~5 ms CPU (auth, room lookup, SFU selection) = 175 cores &rArr; ~290 at 60%.'],
    ['Room state (Redis)', '3-6 shards per region', '1.7 M rooms &times; ~2 KB = 3.4 GB; ~35 K writes/s at peak plus heartbeats.'],
    ['Recording compositors', '~25 K vCPU at peak, spot / queue-smoothed', 'SFUs capture raw RTP per track cheaply; compositing (decode, layout, hardware-accelerated encode) costs ~0.5 vCPU-hour per media hour: 85 K &times; 0.5 = ~42 K vCPU if done live; queueing non-urgent jobs spreads it to ~25 K.']
  ],
  api: [
    ['POST /meetings', 'Create or schedule a meeting with settings (waiting room, recording, E2EE); returns meeting id and join link.'],
    ['POST /meetings/{id}/join', 'Authenticates the user and returns a short-lived join token (room, role, capabilities), the signalling URL and ICE servers with time-limited TURN credentials (HMAC of expiry + user).'],
    ['WS /signal: offer/answer {sdp}', 'SDP negotiation with the SFU (the SFU usually offers). Renegotiation when tracks are added (screen share).'],
    ['WS /signal: candidate {ice}', 'Trickle ICE: candidates are sent as they are discovered so media starts before gathering completes.'],
    ['WS /signal: subscribe {trackId, maxLayer, priority}', 'Receiver tells the SFU which tracks it wants and at what size (tile size in pixels), so the SFU never sends 720p to a thumbnail.'],
    ['WS events: participant-joined/left, active-speaker, mute', 'Roster and UI events fanned out by the signalling service.'],
    ['POST /whep/{webinarId}  |  POST /meetings/{id}/recordings:start', 'WHEP (WebRTC egress over HTTP) for large view-only audiences that need sub-second latency; start/stop cloud recording.']
  ],
  data: [
    ['meetings, users, settings', 'Relational DB', 'meeting_id, host_id, schedule, settings JSON, passcode hash; index host_id + start time for calendars.'],
    ['room_state', 'Redis per region', 'room:{id} &rarr; home region, SFU node list, participant ids and roles, epoch; TTL refreshed by heartbeats; deleted when the room empties.'],
    ['sfu_registry', 'Redis / etcd', 'node &rarr; region, zone, public IP, load (participants, Gbit/s, CPU), draining flag; heartbeat every 2 s.'],
    ['quality telemetry', 'Time-series / log analytics (Azure Data Explorer, ClickHouse)', 'Per participant every 10 s: RTT, jitter, loss, bitrate, layer, freeze count, CPU; partitioned by time, indexed by meeting and user. Drives dashboards and per-ISP alerting.'],
    ['recordings', 'Object storage + metadata in SQL', 'Raw per-track RTP dumps, composite MP4, transcript (VTT); lifecycle to cool tier after 30 days, retention by tenant policy.']
  ],
  dbChoice: [
    ['Live room state', 'In-memory key-value (Redis), regional', 'Read on every join and every SFU decision; changes constantly; can be rebuilt from SFU heartbeats if lost.', 'Relational DB: too slow and too write-heavy for second-by-second state.'],
    ['Meetings, schedules, accounts', 'Relational (PostgreSQL / Azure SQL)', 'Low write rate, transactional updates, calendar queries.', 'Document DB if settings vary a lot by product edition.'],
    ['Call-quality telemetry', 'Columnar time-series / log analytics', 'Billions of small rows per day, aggregated by ISP, region, client version; time-range scans.', 'Prometheus-style metrics alone: cannot slice per meeting or user (cardinality).'],
    ['Recordings', 'Object storage with lifecycle tiers', 'Large immutable files; cheap; served by CDN with signed URLs.', 'File servers: harder to scale and replicate.']
  ],
  diagram: {
    nodes: [['u', 'Participants A', 'client', 0, 1.6, 'browser / app, region A'], ['edge', 'Edge + WAF', 'edge', 1, 0.4, 'HTTPS, WebSocket'], ['turn', 'TURN relays', 'gw', 1, 2.9, 'UDP, TCP, TLS 443'],
      ['sig', 'Signalling', 'svc', 2, 0.4, 'SDP, roster'], ['sfu', 'Edge SFU', 'svc', 2, 1.7, 'region A, forwards RTP'], ['meet', 'Meeting service', 'svc', 3, 0.4, 'auth, SFU placement'],
      ['cache', 'Room state', 'cache', 4, 0, 'Redis per region'], ['db', 'Meetings DB', 'db', 5, 0.8, 'schedules, settings'], ['sfu2', 'Cascade SFU', 'svc', 4, 1.7, 'region B'],
      ['u2', 'Participants B', 'client', 6, 1.7, 'and webinar viewers'], ['comp', 'Media composer', 'worker', 3, 2.9, 'recording, HLS'], ['blob', 'Recordings + HLS', 'blob', 4, 2.9, 'object storage'],
      ['cdn', 'CDN', 'cdn', 5, 2.9, 'webinar viewers']],
    edges: [['u', 'edge'], ['edge', 'sig', 'WebSocket'], ['sig', 'meet'], ['meet', 'cache'], ['meet', 'db'], ['meet', 'sfu', 'allocate'], ['meet', 'sfu2'], ['u', 'sfu', 'SRTP over UDP'], ['u', 'turn', 'if UDP blocked'],
      ['turn', 'sfu'], ['sfu', 'sfu2', 'cascade'], ['u2', 'sfu2'], ['sfu', 'comp', '', 'async'], ['comp', 'blob'], ['blob', 'cdn'], ['cdn', 'u2', 'LL-HLS']]
  },
  flows: [
    { name: 'Join a meeting', desc: 'Click the link to first video in under 3 seconds: signalling, SFU placement, ICE and DTLS.', steps: [
      ['u', 'edge', 'POST /meetings/123/join', 'HTTPS to the nearest edge; returns a join token and ICE servers with time-limited TURN credentials.'],
      ['edge', 'sig', 'WS /signal (token)', 'A WebSocket to the signalling tier carries every control message for the rest of the call.'],
      ['sig', 'meet', 'join room 123', 'The meeting service checks the token, waiting-room and role, and decides where this participant’s media goes.'],
      ['meet', 'cache', 'room 123 SFUs in region A?', 'If the room already has an SFU in this user’s region, reuse it, so local participants share one forwarder and the cascade stays small.'],
      ['meet', 'sfu', 'allocate transport', 'Pick the least-loaded healthy SFU in the nearest region (by the client’s latency probes). The SFU creates ICE credentials and DTLS fingerprints.'],
      ['sig', 'u', 'SDP offer + candidates', 'The SFU’s offer (relayed by signalling) lists codecs (Opus, VP8/VP9/AV1, H.264), simulcast rids and its public IP candidates. The SFU is ICE-lite.', 'resp'],
      ['u', 'sig', 'SDP answer', 'The client answers and trickles its own candidates (host, server-reflexive from STUN).'],
      ['u', 'sfu', 'ICE check + DTLS handshake', 'STUN binding requests confirm the UDP path; DTLS derives SRTP keys. Typically 1-2 round trips, ~100-300 ms.'],
      ['u', 'sfu', 'SRTP: audio + 3 video layers', 'Media starts flowing. The SFU forwards existing participants’ tracks back down at the layers this client can take.']],
      end: 'Signalling is ordinary HTTPS/WebSocket and scales like any web tier; the media path is separate, direct to an SFU, and UDP whenever possible.' },
    { name: 'Simulcast and bandwidth', desc: 'A receiver in region B drops to a weak Wi-Fi connection; the SFU adapts without the sender changing anything.', steps: [
      ['u', 'sfu', 'simulcast 720p/360p/180p', 'The speaker encodes three independent layers; upload cost is ~1.6 Mbit/s instead of 1.2 for one stream, but receivers can now differ.'],
      ['sfu', 'sfu2', 'cascade: only needed layers', 'The region A SFU sends one copy of each needed layer to region B over the backbone, not one copy per remote participant.'],
      ['sfu2', 'u2', '720p for speaker view', 'Bob in region B sees the speaker full-screen.'],
      ['u2', 'sfu2', 'TWCC: est. 500 kbit/s', 'Transport-wide congestion control feedback reports arrival times for every packet; the SFU’s delay-based estimator (GCC) sees queues building and lowers Bob’s downlink budget.', 'resp'],
      ['sfu2', 'u2', 'switch to 360p at keyframe', 'The SFU fits Bob’s budget: audio first, then screen share, then the active speaker, then gallery tiles. It can only switch spatial layers at a keyframe.'],
      ['sfu2', 'sfu', 'PLI: keyframe on 360p', 'Picture Loss Indication requests a keyframe on the 360p layer so the switch happens within ~100-300 ms instead of waiting for the next periodic keyframe.', 'resp'],
      ['sfu', 'u', 'PLI forwarded (rate-limited)', 'Keyframe requests are deduplicated and rate-limited: 50 receivers asking at once must not make the sender emit 50 keyframes.', 'resp'],
      ['u', 'sfu', 'keyframe on 360p layer', 'Bob’s video continues at lower resolution with no freeze; NACK retransmissions and audio RED/FEC cover residual loss.']],
      end: 'The sender encodes once; each receiver’s experience is tailored by the SFU from feedback. With SVC (VP9/AV1) it is the same idea inside one stream: the SFU drops spatial or temporal layers.' },
    { name: 'UDP blocked: TURN', desc: 'A user on a locked-down corporate network where only outbound TCP 443 is allowed.', steps: [
      ['u', 'sfu', 'ICE checks over UDP', 'Connectivity checks to the SFU’s UDP candidates time out: the firewall drops all UDP.', 'err'],
      ['u', 'sfu', 'ICE-TCP candidate', 'Many SFUs also listen on TCP; if a direct TCP path exists it is preferred over a relay.', 'err'],
      ['u', 'turn', 'TURN allocate over TLS 443', 'Last resort: TURN over TLS on port 443 looks like ordinary HTTPS to the firewall. The time-limited credential from the join response authenticates it.'],
      ['turn', 'sfu', 'relay over UDP', 'The TURN server relays to the SFU over UDP inside the provider network, so only the first hop suffers TCP’s head-of-line blocking.'],
      ['sfu', 'turn', 'downstream media', 'Media for this user flows back through the relay.', 'resp'],
      ['turn', 'u', 'SRTP inside TLS', 'Quality is usually fine, with slightly more latency and less tolerance for loss. The SFU sends lower layers because TCP throughput collapses on loss.', 'resp']],
      end: 'Always offer the ladder UDP → TCP → TURN/TLS 443. Roughly 5-10% of enterprise users need a relay; without TURN they simply cannot join.' },
    { name: 'Webinar and recording', desc: 'A town hall with 20 panellists and 100,000 viewers, recorded.', steps: [
      ['u', 'sfu', 'panellists publish', 'Panellists are full WebRTC participants on SFUs; only they need sub-200 ms interactivity.'],
      ['sfu', 'comp', 'subscribe active speakers', 'A composer (headless renderer) subscribes like a participant, mixes the layout once and encodes a single programme stream.', 'async'],
      ['comp', 'blob', 'CMAF chunks (LL-HLS)', 'The programme is packaged as low-latency HLS: an adaptive ladder of 1080p to 360p, part segments of ~0.5 s.'],
      ['blob', 'cdn', 'origin pull', 'The CDN fans out to any number of viewers; each edge fetches each chunk once.'],
      ['cdn', 'u2', '100 K viewers, ~3-5 s latency', 'Viewers get broadcast scale at broadcast cost. Those who need near-real-time (Q and A on stage) are promoted to WebRTC via the SFU tree or WHEP.', 'resp'],
      ['comp', 'blob', 'MP4 recording + transcript', 'The same composer writes the recording; captions come from a streaming speech-to-text subscriber on the mixed audio.']],
      end: 'Interactive participants use SFUs; passive audiences use HTTP streaming via a CDN. A cascaded SFU tree covers the middle ground (a few thousand viewers at sub-second latency).' },
    { name: 'SFU failure', desc: 'The SFU hosting part of a meeting crashes.', steps: [
      ['sfu', 'u', 'media stops', 'The SFU process or host dies. Clients see no RTP and no STUN consent responses within ~2-5 s.', 'err'],
      ['u', 'sig', 'ICE disconnected: reconnect', 'The client reports the failure over the signalling WebSocket (which is on a different tier and still up).'],
      ['sig', 'meet', 'reassign room 123 in A', 'The meeting service marks the SFU dead (missed heartbeats in the registry) and picks a replacement.'],
      ['meet', 'cache', 'update room SFU list (epoch+1)', 'Room state now points to the new node so other participants and the cascade relink to it.'],
      ['meet', 'sfu', 'allocate on replacement SFU', 'The new SFU creates transports for every affected participant and re-establishes the cascade link to region B.'],
      ['sig', 'u', 'new offer (ICE restart)', 'Clients perform an ICE restart and republish their tracks; audio typically returns within 2-4 s.', 'resp'],
      ['u', 'sfu', 'media resumes', 'Participants on other SFUs saw only a brief freeze of the affected users’ tiles.']],
      end: 'SFUs hold only soft state (who subscribes to what), so recovery is just re-signalling. Spread big meetings over several SFUs so no single node failure drops everyone.' }
  ],
  components: [
    ['Meeting API + meeting service', 'Scheduling, join tokens, roles, waiting rooms, SFU placement decisions.'],
    ['Signalling gateways', 'WebSocket per participant: SDP offers/answers, trickle ICE, subscriptions, roster and control events.'],
    ['SFU fleet', 'Terminate DTLS-SRTP, forward RTP selectively per receiver, run bandwidth estimation, layer selection, NACK/PLI handling, active-speaker detection.'],
    ['Cascade / backbone', 'SFU-to-SFU links between regions carrying one copy of each needed layer.'],
    ['STUN / TURN relays', 'Discover public addresses and relay media for clients that cannot use direct UDP.'],
    ['Media composer', 'Mix and encode for recording, LL-HLS webinar output, captions and PSTN.'],
    ['Room state + SFU registry', 'Fast regional state of rooms, nodes and load.'],
    ['Quality telemetry pipeline', 'Client and SFU stats into a columnar store; detects bad ISPs, regressions in client releases and overloaded nodes.']
  ],
  evolutionTitle: 'From peer-to-peer to a global media network',
  evolution: [
    { name: '1. Mesh (P2P)', desc: 'Every participant sends to every other: fine for 2-4 people, no media servers.', diagram: { nodes: [['a', 'Alice', 'client', 0, 0], ['b', 'Bob', 'client', 2, 0], ['c', 'Carol', 'client', 1, 1.2], ['s', 'Signalling', 'svc', 3, 1.2]], edges: [['a', 'b', 'SRTP'], ['a', 'c'], ['b', 'c'], ['a', 's', '', 'none']] },
      steps: [['a', 's', 'exchange SDP', 'Signalling only introduces the peers.'], ['a', 'b', 'direct media', 'Direct peer-to-peer media: lowest latency, zero server cost.'], ['a', 'c', 'second upload', 'But each person uploads N-1 copies: at 8 people that is 7 × 1.2 Mbit/s, more than most uplinks.']] },
    { name: '2. One SFU', desc: 'Everyone uploads once to a forwarding server, which sends each receiver what it needs.', diagram: { nodes: [['a', 'Alice', 'client', 0, 0], ['b', 'Bob', 'client', 0, 1.2], ['s', 'SFU', 'svc', 1.5, 0.6], ['c', 'Carol', 'client', 3, 0.6]], edges: [['a', 's'], ['b', 's'], ['s', 'c']] },
      steps: [['a', 's', 'one simulcast upload', 'Upload no longer grows with meeting size.'], ['s', 'c', 'forward selected layers', 'The SFU forwards, never decodes, so it is cheap per participant and adds only a few ms.'], ['b', 's', 'upload', 'Hundreds of participants fit on one SFU (with layer selection).']] },
    { name: '3. Cascaded SFUs', desc: 'Users connect to a nearby SFU; SFUs relay between regions over the backbone.', diagram: { nodes: [['a', 'Users in Europe', 'client', 0, 0.6], ['s1', 'SFU Amsterdam', 'svc', 1.3, 0.6], ['s2', 'SFU Virginia', 'svc', 2.6, 0.6], ['b', 'Users in US', 'client', 3.9, 0.6]], edges: [['a', 's1'], ['s1', 's2', 'backbone'], ['b', 's2']] },
      steps: [['a', 's1', 'short last mile', 'Packet loss and jitter are worst on the last mile, so keep it short: retransmissions happen within a few ms.'], ['s1', 's2', 'one copy per layer', 'The intercontinental hop runs on a managed backbone, carrying each stream once.'], ['s2', 'b', 'local fan-out', 'US users get European speakers with ~80-100 ms of added transit, the physical minimum.']] }
  ],
  deep: [
    ['Mesh vs MCU vs SFU', '<table><tr><th>Topology</th><th>Upload per user</th><th>Download per user</th><th>Server cost</th><th>Notes</th></tr><tr><td>Mesh (P2P)</td><td>N-1 streams</td><td>N-1 streams</td><td>None (TURN only)</td><td>Great for 1:1 calls; collapses past ~4 people.</td></tr><tr><td>MCU (mixer)</td><td>1</td><td>1 mixed stream</td><td>Very high: decode + compose + encode per room</td><td>Adds 100+ ms; fixed layout; still used for PSTN, legacy SIP rooms and recordings.</td></tr><tr><td>SFU (forwarder)</td><td>1 (simulcast/SVC)</td><td>Selected streams</td><td>Low: packet routing + SRTP</td><td>Per-receiver adaptation, layouts chosen by the client. The default since ~2015.</td></tr></table><p>An 8-person gallery at 1.2 Mbit/s: mesh needs 8.4 Mbit/s up per person; SFU needs ~1.6 up and maybe 2-3 down. An SFU node forwarding 2.5 Gbit/s supports ~1,000 participants, whereas an MCU node might handle a few dozen composites.</p>'],
    ['ICE, STUN and TURN', '<ul><li><strong>Candidates:</strong> <em>host</em> (local IP), <em>server-reflexive</em> (public IP:port learned from a STUN server), <em>relay</em> (allocated on a TURN server). ICE tries pairs in priority order and nominates the best working one.</li><li>The SFU has a public IP, so it runs <strong>ICE-lite</strong>: clients behind NAT can always reach it outbound, which makes direct UDP succeed far more often than in P2P.</li><li><strong>TURN</strong> is needed for UDP-blocking firewalls and some symmetric NATs; offer UDP 3478, TCP and TLS 443. Credentials are ephemeral (HMAC of expiry and user with a shared secret, the “TURN REST API” convention) so links cannot be abused as free relays.</li><li><strong>Consent freshness:</strong> STUN keepalives every few seconds detect dead paths; an ICE restart moves a call to Wi-Fi from 4G without rejoining.</li></ul>'],
    ['Simulcast, SVC and bandwidth estimation', '<p><strong>Simulcast</strong> sends 2-3 independent encodings (e.g. 1280&times;720 at 1.2 Mbit/s, 640&times;360 at 300 kbit/s, 320&times;180 at 100 kbit/s), identified by RTP stream ids (rid). <strong>SVC</strong> (VP9, AV1 with modes such as L3T3) sends one stream with spatial and temporal layers; the SFU drops layers by reading the dependency descriptor, which saves upload and makes switching instant, at some encoder cost.</p><p><strong>Bandwidth estimation</strong>: receivers (or the SFU, for its sends) use transport-wide sequence numbers (TWCC) to measure inter-arrival delay; Google Congestion Control backs off when one-way delay grows (queues building) before loss occurs, and probes upward with padding. The SFU then runs an allocator per subscriber: audio &gt; screen share &gt; active speaker &gt; pinned &gt; gallery tiles, each capped at the layer matching its on-screen size. Resilience: NACK retransmission for video, Opus in-band FEC and RED for audio, adaptive jitter buffers (~20-80 ms), and keyframe requests (PLI) rate-limited per sender.</p>'],
    ['Global media routing', '<p>Place each participant on the nearest SFU (latency probes at join, geo-DNS or anycast for the first contact). When a meeting spans regions, SFUs <strong>cascade</strong>: region A’s SFU subscribes to region B’s published tracks once and redistributes locally. The backbone between regions is the provider’s private network (or dedicated links), which has lower loss and jitter than the public internet. Latency budget for a transatlantic call: capture + encode ~20-40 ms, last mile ~10-30 ms each side, backbone ~70-80 ms, jitter buffer ~30-60 ms, decode + render ~10-20 ms &asymp; 160-250 ms mouth to ear. Very large meetings spread across several SFUs per region with a tree topology so no single node forwards everything.</p>'],
    ['End-to-end encryption trade-offs', '<p>By default media is encrypted hop by hop with DTLS-SRTP: the SFU decrypts SRTP packets to route them (it only needs headers, but it holds the keys). True E2EE adds a second layer: the client encrypts each encoded frame with <strong>SFrame</strong> (via WebRTC Encoded Transform / insertable streams) using keys distributed among participants, increasingly via <strong>MLS</strong> (Messaging Layer Security, RFC 9420) for efficient group rekeying on join and leave. The SFU still reads RTP headers and the dependency descriptor, so simulcast/SVC forwarding keeps working.</p><p>What you lose: cloud recording, live captions and transcription, server-side noise suppression, PSTN dial-in, most large-webinar and composer features, and server-side content moderation. Zoom, Teams and Meet therefore make E2EE an opt-in mode for sensitive meetings rather than the default.</p>']
  ],
  scale: [
    '<strong>Top-of-the-hour join storms:</strong> 35 K joins/s hit signalling and placement. Keep placement stateless and cached, pre-warm SFU capacity before the hour, and stagger client retries with jitter.',
    '<strong>SFU capacity is packets, not bytes:</strong> scale on packets per second and CPU, use kernel-bypass or optimised UDP paths (GSO, recvmmsg), and pin worker threads per core.',
    '<strong>Huge meetings:</strong> split a 1,000-person meeting across several SFUs and cap forwarded video to the top ~25-49 tiles (last-N by speaking activity); audio uses only the top 3 speakers’ streams.',
    '<strong>Regional capacity:</strong> each region sized for its peak plus a zone loss; spill-over to a neighbouring region if a region is full (slightly higher latency beats failing the join).',
    '<strong>Webinar audiences:</strong> beyond a few thousand viewers, switch from WebRTC fan-out to LL-HLS through a CDN; promote individuals to WebRTC only when they need to speak.',
    '<strong>Observability at scale:</strong> per-participant quality stats are billions of rows a day; sample raw stats, keep aggregates per ISP/region/client build, and alert on regressions after client releases.'
  ],
  tradeoffs: [
    ['Media server type', 'Mesh vs MCU vs SFU', 'SFU: linear cost, per-receiver adaptation, low added latency. Mesh for 1:1 (cheaper, direct), MCU only for compositing outputs.'],
    ['Simulcast vs SVC', 'Three encodes vs one layered stream', 'Simulcast for widest compatibility (H.264, VP8, Safari); SVC (VP9/AV1) where supported for lower upload and instant layer switches.'],
    ['Transport', 'UDP vs TCP/TLS fallback', 'UDP first: real-time media prefers late packets dropped to stale ones retransmitted. Fall back to TCP/TLS 443 via TURN only when needed.'],
    ['Encryption', 'Hop-by-hop DTLS-SRTP vs SFrame E2EE', 'Hop-by-hop by default to keep recording, captions and PSTN; offer E2EE as an opt-in per meeting.'],
    ['Webinar delivery', 'WebRTC fan-out vs LL-HLS via CDN', 'WebRTC (sub-second) for interactive and up to a few thousand; LL-HLS (~3-5 s) for 100 K+ at CDN cost.'],
    ['Build vs buy', 'Own SFU fleet vs CPaaS (ACS, Chime SDK)', 'Buy for embedded calling in an app; build only when video is the product and the margins and control justify running ~10,000 media servers.']
  ],
  failures: [
    ['SFU node crash', 'Heartbeats in the registry detect it in ~2-5 s; affected participants ICE-restart onto a replacement; large meetings spread across several SFUs.'],
    ['Packet loss and jitter on the last mile', 'NACK and FEC/RED, adaptive jitter buffer, bandwidth estimation lowers layers; audio-only mode below ~150 kbit/s.'],
    ['UDP blocked by firewall', 'ICE-TCP to the SFU, then TURN over TLS 443.'],
    ['Signalling gateway failure', 'Media keeps flowing (separate path); the client reconnects the WebSocket and resyncs roster state.'],
    ['Region overloaded or down', 'Placement spills to the next-nearest region; global DNS / anycast steers new joins away; meetings re-cascade.'],
    ['Keyframe storms', 'Deduplicate and rate-limit PLI/FIR per sender; prefer SVC or temporal layers so receivers can recover without keyframes.'],
    ['Abuse (meeting bombing, TURN as open relay)', 'Waiting rooms, passcodes, host controls; ephemeral TURN credentials bound to user and expiry; rate limits on joins.']
  ],
  cloud: [['DNS and geo routing', 'dns'], ['Global entry for APIs and signalling', 'cdn'], ['Anycast acceleration', 'globallb'], ['WAF', 'waf'], ['Managed WebRTC calling (buy option)', 'rtc'],
    ['SFU and TURN fleets', 'vms'], ['Signalling and meeting services', 'k8s'], ['Room state and SFU registry', 'cache'], ['Meetings and accounts', 'sql'], ['Recordings and HLS output', 'blob'],
    ['Recording composite jobs', 'batch'], ['Large broadcast output', 'livevideo'], ['Live captions', 'speech'], ['Call-quality telemetry', 'timeseries'], ['Identity (business users)', 'workforce'], ['Monitoring', 'monitor']],
  refs: { az: ['azMission', 'azAutoscale', 'azp-deployment-stamp', 'azp-health-endpoint-monitoring', 'azp-queue-based-load-leveling', 'azLbChoice', 'azBigCompute'],
          aws: ['awsMediaLens', 'blStatic', 'blHealth', 'blShedding', 'blShuffle', 'awsWaf'] },
  questions: [
    ['Why UDP and not TCP for media?', 'Interactive media values timeliness over completeness: a video packet that arrives 300 ms late is useless. TCP’s in-order delivery and retransmission cause head-of-line blocking and latency spikes on loss. Over UDP, the application chooses: retransmit only if there is time (NACK), use FEC, or skip. QUIC-based media (Media over QUIC) is emerging but WebRTC over UDP is still the norm in 2026.'],
    ['How does the SFU decide what to send each receiver?', 'From the receiver’s bandwidth estimate (TWCC/GCC) and its subscriptions (which tiles, at what pixel size). It allocates the budget in priority order: audio, screen share, active speaker, then gallery tiles, picking the highest simulcast/SVC layer that fits each, and switches layers at keyframes.'],
    ['How would you support a 10,000-person interactive all-hands?', 'Panellists on SFUs; audience either via a tree of cascaded SFUs (each forwarding to the next tier) with last-N video and top-3 audio, or via LL-HLS through a CDN for those who just watch, with a “raise hand” that promotes a viewer to a WebRTC publisher.'],
    ['Where do you put recording?', 'Cheapest is to have the SFU dump raw per-track RTP (no decode) and composite asynchronously after the meeting on spot capacity. If the recording must be available immediately or streamed live, run a composer that joins as a hidden participant and encodes in real time.'],
    ['What breaks with end-to-end encryption?', 'Anything that needs to see media on the server: recording, transcription, captions, noise suppression, PSTN bridging, compositing for webinars. Layer switching still works because SFrame encrypts payloads but leaves RTP headers and the dependency descriptor readable.'],
    ['How do you measure call quality?', 'Collect WebRTC getStats from clients and SFU-side stats every ~10 s (RTT, jitter, loss, freezes, frame rate, resolution, concealed audio samples), compute per-call scores (e.g. an estimated MOS), and aggregate by ISP, region, device and client version to find regressions.']
  ],
  related: ['live-streaming', 'chat', 'voice-assistant', 'video-streaming', 'multiplayer-game']
});

SD.renderCase({
  slug: 'video-streaming',
  summary: 'A video-on-demand platform has two very different halves. The write side ingests uploads through resumable sessions and runs a transcoding pipeline as a DAG of small jobs: probe the file, split it into GOP-aligned segments, encode every segment in parallel into a ladder of resolutions and codecs, then package the results once as CMAF so both HLS and DASH manifests can point at the same encrypted fragments. The read side is almost entirely a content delivery problem: a playback service hands the player a manifest, a DRM licence and the best CDN to use, and the player then pulls small segments from edge caches (multi-CDN plus ISP-embedded appliances in the Netflix Open Connect style), switching bitrate every few seconds to match its network. Playback events feed view counts, quality-of-experience monitoring and recommendations.',
  examples: 'YouTube, Netflix (Open Connect appliances inside ISPs, per-title and shot-based encoding), Disney+, Prime Video, Twitch VOD, Vimeo, TikTok; corporate video portals on Azure or AWS follow the same upload &rarr; transcode &rarr; package &rarr; CDN pipeline.',
  functional: ['Creators upload videos of any size from web or mobile, with resume after network drops.', 'Videos are transcoded into multiple resolutions and codecs, with thumbnails, captions and moderation checks, and published when ready.', 'Viewers stream on phones, browsers and TVs with fast start, adaptive quality and seeking.', 'Premium content is protected with DRM (Widevine, FairPlay, PlayReady).', 'View counts, watch history and a "watch next" recommendation hook.'],
  nonFunctional: ['Playback start under 2 s (p90), rebuffering under 0.5% of watch time.', 'Serve ~50 Tbit/s at peak with &gt;95% of bytes from edge caches.', 'A typical upload is playable within minutes (short videos in under a minute at low resolutions first).', 'Originals and renditions are durable (11 nines); delivery available 99.99% even if one CDN fails.', 'Transcoding cost is optimised (spot/preemptible capacity, codec choice by popularity).'],
  outOfScope: ['Live streaming (see live-streaming).', 'The recommendation models themselves (see recommendation).', 'Comments, subscriptions, monetisation and ads insertion.', 'Studio content licensing workflows.'],
  estimates: [
    ['Daily active viewers', '200 M', 'Large global platform'],
    ['Watch time', '133 M hours/day', '200 M &times; 40 minutes'],
    ['Concurrent viewers', '~5.5 M average, ~14 M peak', '133 M h / 24 h; evening peak 2.5&times;'],
    ['Peak delivery bandwidth', '~50 Tbit/s', '14 M &times; ~3.5 Mbit/s average delivered bitrate (mobile 720p to TV 4K)'],
    ['Edge segment requests', '~7 M req/s at peak', '14 M viewers &times; 2 tracks (video + audio) / 4 s segments'],
    ['Views', '1.6 B/day &rArr; ~18.5 k/s average, ~45 k/s peak', '200 M &times; 8 videos'],
    ['Uploads', '500 k videos/day &asymp; 66.7 k hours/day (~46 hours/minute)', 'Average 8 minutes per video'],
    ['New storage', '~660 TB/day (~240 PB/year)', 'Originals 66.7 k h &times; 4.5 GB = 300 TB, plus an H.264 ladder of ~12 Mbit/s summed &asymp; 5.4 GB/h = 360 TB; AV1/4K only for popular titles'],
    ['Transcode compute', '~28 k cores average', '66.7 k h &times; ~10 core-hours per content hour for the full ladder = 667 k core-hours/day / 24']
  ],
  compute: [
    ['Playback API', '~110 instances &times; 16 vCPU across 3 zones', 'Peak ~140 k req/s (45 k plays &times; manifest, licence, metadata) &times; ~5 ms CPU = 700 busy cores; at 60% &asymp; 1,170 cores &asymp; 73 instances; &times;1.5 for zone loss.'],
    ['Encoder fleet', '~28 k cores average, ~55 k at upload peaks (~1,700 &times; 32 vCPU spot)', 'Segment jobs are short (30-120 s), stateless and retryable, so spot/preemptible VMs at 60-90% discount are ideal. Hardware encoders (GPU NVENC, or custom ASICs like YouTube’s VCU) cut this by roughly 10&times; for the long tail.'],
    ['Edge caches', '~750 appliances / CDN capacity units at ~100 Gbit/s', '50 Tbit/s / 100 Gbit/s = 500, &times;1.5 for failures and growth; spread across ISPs and exchange points, plus commercial CDNs for overflow.'],
    ['Origin shield + storage', '~2.5 Tbit/s origin egress worst case', '5% cache misses &times; 50 Tbit/s. Pre-positioning popular titles to edges off-peak (Open Connect style) keeps real origin load far lower.'],
    ['Event pipeline', 'Kafka ~64 partitions, Flink ~40 vCPU', 'Heartbeats every 30 s: 14 M / 30 = 470 k events/s &times; ~200 B = 94 MB/s; at ~5-10 MB/s per partition plus headroom &rArr; 64 partitions.']
  ],
  api: [
    ['POST /v1/uploads {filename, size, mime} → {video_id, session_url}', 'Creates a resumable upload session (tus or cloud-native resumable upload). Metadata row created with status=uploading.'],
    ['PUT {session_url} Content-Range: bytes 0-8388607/1073741824', 'Uploads one 8 MB chunk. After a drop, HEAD the session to get the committed offset and continue from there.'],
    ['POST /v1/uploads/{video_id}:complete', 'Finalises the upload and starts the transcoding workflow; returns 202 with status=processing.'],
    ['GET /v1/videos/{id}/play?device=tv&drm=widevine', 'Returns manifest URLs on the selected CDN (signed, short-lived), the DRM licence URL, captions and resume position.'],
    ['GET https://cdn.../{id}/master.m3u8 | manifest.mpd, .../{rendition}/seg_{n}.m4s', 'Manifests and CMAF segments, served from edge caches; immutable segment URLs cache for a year.'],
    ['POST /v1/drm/licence (Widevine / FairPlay / PlayReady challenge)', 'Checks entitlement (subscription, region, concurrent streams) and returns content keys bound to the device.'],
    ['POST /v1/events [{type:"start"|"heartbeat"|"rebuffer"|"bitrate_switch", ...}]', 'Batched playback telemetry for view counts, watch time, QoE dashboards and recommendations.']
  ],
  data: [
    ['videos', 'Relational / distributed SQL, PK video_id', 'owner, title, description, status (uploading, processing, ready, blocked), visibility, duration, available renditions and codecs, region rights.'],
    ['upload sessions', 'Key-value with TTL', 'session_id &rarr; {video_id, committed_offset, parts}; expires after 7 days if never completed.'],
    ['originals', 'Object storage (cool tier after processing)', 'Kept for re-encoding with better codecs later; lifecycle-moved to cheaper storage.'],
    ['renditions', 'Object storage behind the origin shield', 'Key: /v/{video_id}/{codec}_{height}p/seg_{n}.m4s plus init segments and manifests; encrypted with CENC (cbcs) for DRM titles.'],
    ['transcode jobs', 'Workflow engine state (Temporal / Step Functions / Durable Functions)', 'DAG per video: tasks, attempts, inputs/outputs, so a failed segment is retried without redoing the whole video.'],
    ['view counts', 'Redis counters + Cassandra / warehouse', 'Approximate live counter per video in Redis, authoritative deduplicated counts written by the stream processor and reconciled daily.'],
    ['watch events', 'Kafka &rarr; data lake', 'user, video, position, bitrate, rebuffers, device; feeds recommendations, QoE analytics and royalties.']
  ],
  dbChoice: [
    ['Video metadata', 'Relational or distributed SQL (with a cache in front)', 'Moderate size (billions of rows at most), read-heavy, needs secondary indexes (by owner, status) and transactional status changes.', 'Document store (Cosmos DB / DynamoDB) is fine if access is only by video id; Vitess-sharded MySQL is what YouTube built.'],
    ['Video bytes', 'Object storage + CDN', 'Exabyte-scale immutable files; cheapest durable storage; CDNs pull from it natively.', 'Block storage or file shares: expensive and do not scale to this size.'],
    ['Pipeline state', 'Durable workflow engine', 'Long-running multi-step DAGs with retries, timeouts and fan-out/fan-in of hundreds of segment tasks.', 'Hand-rolled queues and status columns: workable, but retries and partial failures become painful.'],
    ['Counters and events', 'Kafka + stream processor + Redis/Cassandra', 'Hundreds of thousands of events per second; aggregation and dedup need windows, not row updates.', 'UPDATE videos SET views=views+1: a hot row per popular video and no bot filtering.']
  ],
  diagram: {
    nodes: [['viewer', 'Viewer', 'client', 0, 0.6, 'phone, browser, TV'], ['creator', 'Creator', 'client', 0, 2.6, 'web / mobile upload'], ['edge', 'Edge caches', 'cdn', 1, 0, 'multi-CDN + ISP boxes'],
      ['api', 'API gateway', 'apigw', 1, 1.5, 'auth, rate limits'], ['play', 'Playback service', 'svc', 2, 1.0, 'manifest, DRM, steering'], ['shield', 'Origin shield', 'cdn', 3, 0, 'regional mid-tier'],
      ['rend', 'Renditions', 'blob', 4, 0.6, 'CMAF segments'], ['meta', 'Video metadata', 'db', 3, 1.9, 'status, renditions'], ['upload', 'Upload service', 'svc', 2, 2.4, 'resumable sessions'],
      ['raw', 'Originals', 'blob', 3, 3.2, 'object storage'], ['wf', 'Transcode DAG', 'svc', 4, 2.2, 'workflow orchestrator'], ['enc', 'Encoder fleet', 'worker', 5, 3.2, 'FFmpeg on spot / GPU'],
      ['kafka', 'Playback events', 'stream', 5, 1.3, 'Kafka'], ['views', 'Counts + recs', 'ml', 6, 0.4, 'Flink, feature store']],
    edges: [['viewer', 'edge', 'segments'], ['viewer', 'api'], ['creator', 'api'], ['creator', 'raw', 'resumable PUT'], ['api', 'play'], ['api', 'upload'], ['edge', 'shield', 'miss'], ['shield', 'rend', 'miss'],
      ['play', 'meta'], ['upload', 'meta'], ['upload', 'wf', 'start', 'async'], ['wf', 'enc', '', 'async'], ['enc', 'raw'], ['enc', 'rend', 'CMAF'], ['wf', 'meta', 'ready'], ['play', 'kafka', 'events', 'async'], ['kafka', 'views', '', 'async']]
  },
  flows: [
    { name: 'Resumable upload', desc: 'A creator uploads a 1 GB video from a phone on a train.', steps: [
      ['creator', 'api', 'POST /v1/uploads', 'The app asks for an upload session, sending size and type so quotas and limits are checked before any bytes move.'],
      ['api', 'upload', 'create session', 'Authenticated, rate limited.'],
      ['upload', 'meta', 'INSERT video (uploading)', 'The video exists from the first moment, so the creator can add a title while bytes are still flowing.'],
      ['upload', 'creator', 'video_id + session URL', 'The session URL lets the client write straight to object storage; the API tier never carries video bytes.', 'resp'],
      ['creator', 'raw', 'PUT 8 MB chunks', 'Chunks are sent with Content-Range. Storage commits each one durably.'],
      ['creator', 'raw', 'connection drops at 61%', 'The train enters a tunnel. Nothing is lost: committed chunks stay committed.', 'err'],
      ['creator', 'raw', 'HEAD offset, resume', 'On reconnect the client asks for the committed offset and continues from 61% instead of starting over.'],
      ['creator', 'api', 'POST :complete', 'All bytes received; storage verifies size and checksum.'],
      ['upload', 'wf', 'start pipeline', 'The upload service starts the transcoding workflow and returns 202: processing.', 'async']],
      end: 'Resumable sessions turn an unreliable mobile network into a reliable upload, and direct-to-storage keeps the API fleet small.' },
    { name: 'Transcoding DAG', desc: 'Turn one original into a ladder of renditions, in parallel, then package and publish.', steps: [
      ['wf', 'enc', 'probe + split', 'Read codec, resolution, frame rate and audio tracks, then split the original into ~10 s chunks on keyframe (GOP) boundaries so they can be encoded independently.'],
      ['enc', 'raw', 'read original', 'Workers read their byte ranges directly from object storage.'],
      { par: [['wf', 'enc', '240p … 1080p H.264'], ['wf', 'enc', 'AV1 / 4K if popular']], msg: 'Fan out: chunks × renditions become hundreds of short tasks on spot workers. A 10-minute video can finish in about a minute of wall-clock time.' },
      ['wf', 'enc', 'chunk 37 worker preempted', 'A spot instance is reclaimed mid-encode.', 'err'],
      ['wf', 'enc', 'retry chunk 37 elsewhere', 'The workflow engine retries just that task (idempotent output key), not the whole video.'],
      ['enc', 'rend', 'stitch + package CMAF', 'Encoded chunks are concatenated per rendition, then packaged once as fragmented MP4 (CMAF) with 4 s segments; HLS and DASH manifests both reference the same files. DRM titles are encrypted with CENC cbcs.'],
      ['wf', 'enc', 'thumbnails, captions, checks', 'Side branches of the DAG: thumbnail sprites for seek previews, speech-to-text captions, content moderation and copyright fingerprinting.'],
      ['wf', 'meta', 'status = ready', 'Publish only when the ladder, manifests and checks are complete; low resolutions can be published first for speed.']],
      end: 'A DAG of small idempotent tasks gives speed (parallelism), cost savings (spot capacity) and resilience (retry one chunk, not one video).' },
    { name: 'Playback with adaptive bitrate', desc: 'A viewer presses play on a TV.', steps: [
      ['viewer', 'api', 'GET /videos/42/play', 'The player asks for everything it needs to start.'],
      ['api', 'play', 'route', 'Playback service.'],
      ['play', 'meta', 'renditions, rights', 'Which codecs and resolutions exist, which suit this device (AV1 on new TVs, H.264 on old phones), and is the viewer entitled in this country?'],
      ['play', 'viewer', 'manifest URL + licence URL', 'CDN steering picks the best CDN or ISP appliance for this network right now; URLs are signed and short-lived.', 'resp'],
      ['viewer', 'api', 'DRM licence request', 'For protected titles the player’s CDM sends a licence challenge; the server checks entitlement and concurrent streams, then returns keys bound to this device.'],
      ['viewer', 'edge', 'manifest + first segments', 'Start at a modest bitrate for a fast first frame; the edge serves popular titles from memory or SSD.'],
      ['edge', 'shield', 'miss: fetch segment', 'Long-tail segments miss at the edge and are fetched from the regional shield, which collapses many edge misses into one origin request.'],
      ['shield', 'rend', 'miss: origin read', 'Only if the shield also misses does the request reach object storage.'],
      ['viewer', 'edge', 'switch up to 1080p', 'The ABR algorithm sees a growing buffer and measured throughput of 12 Mbit/s, so it requests the next segments from a higher rendition.'],
      ['viewer', 'play', 'heartbeat events', 'Start, heartbeats and rebuffer events feed view counts and QoE dashboards.', 'async']],
      end: 'After the first API call everything is cacheable static files; the player, not the server, adapts quality, which is why ABR scales to millions of viewers.' },
    { name: 'CDN degradation', desc: 'One CDN has a regional problem; viewers on it start rebuffering.', steps: [
      ['viewer', 'edge', 'segment timeouts on CDN A', 'Segment downloads slow down and some fail.', 'err'],
      ['viewer', 'edge', 'ABR drops to 480p', 'The player first protects playback by switching to a lower rendition that the degraded path can sustain.'],
      ['viewer', 'play', 'QoE beacon: rebuffer', 'Rebuffer and error events stream in from many viewers in the same region and ISP.', 'async'],
      ['play', 'kafka', 'events', 'Real-time QoE aggregation per CDN, region and ISP detects the spike within a minute.', 'async'],
      ['viewer', 'api', 'refresh play session', 'The player (or a new session) asks for fresh URLs.'],
      ['play', 'viewer', 'manifest on CDN B', 'Steering now ranks CDN B first for that region. Manifests can also list several CDNs so players fail over on their own (content steering).', 'resp'],
      ['viewer', 'edge', 'segments from CDN B', 'Same segment URLs on another CDN: playback recovers and ABR climbs back to 1080p.']],
      end: 'Multi-CDN with data-driven steering and player-side fallback turns a CDN incident into a short quality dip instead of an outage.' }
  ],
  components: [
    ['Upload service', 'Resumable sessions, quotas, creates the video record, starts the pipeline.'],
    ['Transcode orchestrator', 'Runs the per-video DAG: probe, split, encode, stitch, package, thumbnails, captions, moderation, publish; retries failed tasks.'],
    ['Encoder fleet', 'Stateless FFmpeg workers (x264, x265, SVT-AV1) on spot VMs or GPU / ASIC encoders.'],
    ['Packager', 'Produces CMAF segments, HLS and DASH manifests, DRM encryption (CENC cbcs).'],
    ['Playback service', 'Device capability matching, entitlement, DRM licences, CDN steering, signed URLs, resume points.'],
    ['Edge caches and origin shield', 'Multi-CDN plus ISP-embedded appliances; shield tier collapses misses; pre-positioning of popular titles.'],
    ['Event pipeline', 'Playback events into Kafka; view counts, watch time, QoE alerts, recommendation features.']
  ],
  deep: [
    ['Encoding ladder, codecs and per-title optimisation', '<p>A classic H.264 ladder might be 240p @ 0.3, 360p @ 0.7, 480p @ 1.2, 720p @ 2.5, 1080p @ 5 and 4K @ 15 Mbit/s. A fixed ladder wastes bits on simple content (cartoons, slides) and starves complex scenes (sport, grain). <strong>Per-title encoding</strong> measures quality (VMAF) at several bitrates and picks a ladder per video; <strong>shot-based</strong> encoding (Netflix’s dynamic optimiser) does this per scene.</p><p>Codec choice is a cost trade-off: H.264 plays everywhere; HEVC and VP9 save ~30-40%; <strong>AV1</strong> saves ~30% more again but costs several times the encode CPU. So platforms encode everything in H.264, and add AV1 only once a video becomes popular, because delivery savings scale with views while encode cost is paid once.</p>'],
    ['CMAF, HLS and DASH', '<p>HLS (Apple) and MPEG-DASH are both "a manifest listing small media segments". Historically HLS used MPEG-TS segments and DASH used fragmented MP4, so platforms stored everything twice. <strong>CMAF</strong> standardises fragmented MP4 segments that both protocols can reference: one set of files, two small manifests, half the storage and twice the cache hit rate.</p><pre><code>/v/42/master.m3u8          (HLS multivariant playlist)\n/v/42/manifest.mpd         (DASH MPD)\n/v/42/h264_1080p/init.mp4\n/v/42/h264_1080p/seg_00001.m4s   (4 s each)\n/v/42/av1_1080p/seg_00001.m4s\n/v/42/audio_aac_128k/seg_00001.m4s</code></pre><p>For DRM, the <code>cbcs</code> encryption scheme of Common Encryption is now supported by Widevine, FairPlay and PlayReady, so a single encrypted copy serves every platform; only the licence exchange differs.</p>'],
    ['Adaptive bitrate on the client', '<p>The player keeps a buffer (10-30 s for VOD) and chooses the rendition of the next segment:</p><ul><li><strong>Throughput-based:</strong> estimate bandwidth from recent segment downloads (with a safety margin) and pick the highest rendition below it. Reacts fast but is noisy.</li><li><strong>Buffer-based</strong> (BBA, BOLA in dash.js): pick quality from buffer level; a full buffer allows higher quality. Stable, fewer switches.</li><li><strong>Hybrid / model-predictive:</strong> combine both and optimise a QoE score (bitrate minus penalties for rebuffering and switches). Most production players do this.</li></ul><p>Fast start: begin with a lower rendition and short segments, then climb. Seeking uses the thumbnail sprite for previews and fetches the segment containing the target time. Everything is driven by the client, so servers only serve static files.</p>'],
    ['Delivery: multi-CDN and Open Connect style edges', '<p>Video is &gt;95% of the bytes, so delivery is the main cost. Two strategies are combined:</p><ul><li><strong>ISP-embedded caches</strong> (Netflix Open Connect appliances, YouTube Google Global Cache): servers placed inside ISP networks, filled during off-peak hours with titles predicted to be popular in that region. Most traffic then never crosses the ISP’s border, which is cheaper for everyone.</li><li><strong>Multi-CDN</strong> with a steering service: choose a CDN per session (and let manifests list fallbacks) based on real-time QoE per region and ISP, plus cost commitments.</li></ul><p>A shield tier between edges and origin collapses concurrent misses (request coalescing). Segment URLs are immutable, so TTLs are long and invalidation is rarely needed; access control uses signed URLs or tokens with short expiry.</p>'],
    ['View counts and the recommendations hook', '<p>A "view" is counted when a player reports enough watch time (for example 30 s). Events go to Kafka keyed by video id; a stream processor (Flink) deduplicates by (viewer, video, window), drops obvious bots, aggregates per minute and updates counters. The live count shown on the page is approximate (Redis); the authoritative count is recomputed in batch with stronger fraud filtering and may be revised. The same events (watch time, completion, skips) feed the feature store for recommendation models; the playback service calls a <code>watch_next</code> endpoint to fill the end screen (see <a href="../recommendation/index.html">recommendation system</a>).</p>']
  ],
  scale: [
    '<strong>Egress cost and capacity:</strong> the main lever is cache hit ratio. Pre-position popular titles, use ISP caches, keep the shield tier, and choose efficient codecs for the most-watched videos.',
    '<strong>Long tail:</strong> most videos are rarely watched. Encode them with fast presets and fewer renditions, keep originals in cool storage, and generate extra renditions on demand if a video takes off.',
    '<strong>Upload spikes:</strong> the pipeline is queue-based, so bursts become backlog rather than failures; autoscale spot workers on queue depth and prioritise short videos and partners.',
    '<strong>Hot releases:</strong> a premiere means millions of starts in minutes. Pre-warm edges, publish manifests in advance, and protect licence and playback APIs with caching and admission control.',
    '<strong>Storage growth</strong> (~240 PB/year): lifecycle policies move originals and old renditions to cold tiers; delete renditions nobody watches and re-create them if needed.'
  ],
  tradeoffs: [
    ['Segment length', '2 s vs 4 s vs 6-10 s', '4 s for VOD: fast bitrate adaptation and start-up without too many requests; longer segments compress slightly better but adapt slowly.'],
    ['Codecs', 'H.264 only vs + HEVC/VP9 vs + AV1', 'H.264 for universal reach, add AV1 for popular titles where delivery savings outweigh extra encode cost.'],
    ['Packaging', 'Pre-package everything vs just-in-time packaging at the origin', 'CMAF pre-packaged once covers HLS and DASH; just-in-time packaging saves storage for rarely watched formats but adds origin CPU and latency.'],
    ['Delivery', 'Single CDN vs multi-CDN vs own edge appliances', 'Multi-CDN for resilience and price; own ISP appliances only at very large scale where egress dominates costs.'],
    ['Encoding hardware', 'CPU software encoders vs GPU vs ASIC', 'Software encoders give the best quality per bit for premium titles; GPU/ASIC encoders for the long tail and speed.']
  ],
  failures: [
    ['Encoder worker dies or is preempted', 'Tasks are idempotent with deterministic output keys; the workflow retries only that task with backoff; poison inputs go to a dead-letter queue for review.'],
    ['Corrupt or unusual upload', 'Probe step validates the container and codecs early and fails fast with a clear status for the creator; originals are kept for retry after fixes.'],
    ['CDN or edge region degraded', 'Real-time QoE steering moves sessions to another CDN; players fall back to alternate CDNs listed in the manifest and lower renditions.'],
    ['Origin storage region unavailable', 'Renditions replicated to a second region; shield tier serves cached segments; popular titles are already on edges.'],
    ['DRM licence service down', 'Run it multi-region; cache entitlement decisions; licences have a validity window so playing sessions continue.'],
    ['View counter inflated by bots', 'Dedup windows, bot detection in the stream, batch recomputation and reconciliation; display approximate counts.']
  ],
  cloud: [['DNS and steering', 'dns'], ['CDN delivery', 'cdn'], ['Origin and renditions', 'blob'], ['Upload and playback APIs', 'apigw'], ['Services', 'k8s'], ['Transcoding', 'transcode'], ['Transcode workflow', 'workflow'], ['Encoder capacity (spot / GPU)', 'batch'], ['Packaging and DRM', 'Shaka Packager on AKS + a partner multi-DRM licence service', 'AWS Elemental MediaPackage with SPEKE to a DRM partner'], ['Video metadata', 'sql'], ['Playback events', 'stream'], ['View count aggregation', 'streamproc'], ['Live counters', 'cache'], ['Analytics lake', 'warehouse'], ['Recommendations', 'recsvc'], ['Monitoring and QoE', 'monitor']],
  refs: { az: ['azp-pipes-and-filters', 'azp-queue-based-load-leveling', 'azp-competing-consumers', 'azBigCompute', 'azCdn', 'azp-valet-key', 'azp-static-content-hosting', 'azp-scheduler-agent-supervisor'],
          aws: ['awsMediaLens', 'awsPubSub', 'blBacklog', 'awsClickstream', 'awsAnalyticsLens', 'awsDiagrams'] },
  questions: [
    ['Why split a video into chunks before encoding?', 'Parallelism and resilience. A 2-hour film encoded serially could take hours; split into 10 s GOP-aligned chunks, hundreds of workers encode it in minutes, and a failed or preempted worker costs one chunk, not the film. Chunks must start on keyframes and be stitched carefully to avoid visible seams.'],
    ['How does the player decide which quality to use?', 'It measures download throughput and buffer level after every segment and picks the next segment’s rendition to maximise quality without draining the buffer (throughput, buffer-based or hybrid ABR). The server just lists the options in the manifest.'],
    ['How do you make a video start fast?', 'Short first segments at a moderate bitrate, manifests and first segments pre-warmed on the edge for popular titles, a playback API that returns everything in one call, TLS session reuse, and preloading the first seconds of likely next videos.'],
    ['What changes for DRM-protected content?', 'Segments are encrypted (CENC cbcs) during packaging with keys from a key service; players obtain a licence after an entitlement check. The CDN still serves the same cacheable encrypted files to everyone.'],
    ['How would you count views accurately at scale?', 'Count from client events, deduplicate per viewer and video in time windows, filter bots in the stream and in batch, aggregate in a stream processor rather than updating rows, and show approximate live numbers while the authoritative count is reconciled.'],
    ['Azure Media Services is retired: what do you use on Azure?', 'Run FFmpeg (or a commercial encoder) on Azure Batch or AKS with spot node pools, package with an open-source packager, use a partner for multi-DRM licensing, store in Blob Storage and deliver through Front Door or a third-party CDN.']
  ],
  related: ['live-streaming', 'recommendation', 'file-storage', 'news-feed', 'scaling']
});

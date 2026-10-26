SD.renderCase({
  slug: 'ad-click',
  summary: 'Every click on an ad is money: advertisers are billed per click and watch campaign dashboards in near real time, so the numbers must be both <strong>fresh</strong> (seconds to a minute) and <strong>correct</strong> (no double counting, no lost clicks, fraud removed). This design logs every click to a <strong>durable, replayable log</strong> (Kafka), aggregates it with a <strong>stream processor</strong> (Apache Flink) into <strong>tumbling one-minute windows</strong> per ad and dimension, uses <strong>event time with watermarks</strong> so late clicks land in the right minute, <strong>deduplicates</strong> clicks by id in keyed state, filters <strong>fraud</strong>, and achieves <strong>exactly-once</strong> results through checkpoints plus idempotent or transactional sinks. Skewed <strong>hot ads</strong> get two-phase (salted) aggregation. Results go to a real-time <strong>OLAP store</strong> (Pinot, Druid, ClickHouse) for dashboards and top-N queries, while raw events also land in a data lake for a nightly <strong>batch recompute</strong> that <strong>reconciles</strong> the streaming numbers before invoicing: a pragmatic kappa architecture with a lambda-style safety net.',
  examples: 'Google Ads and Meta Ads reporting, Amazon Ads, Uber Eats and LinkedIn ad analytics on Apache Pinot, Twitter’s (X) ad event pipelines, Criteo, The Trade Desk; Flink at Alibaba for real-time marketing metrics; the “ad click event aggregation” design popularised by Alex Xu’s system design book.',
  functional: ['Record every ad click and redirect the user to the advertiser’s landing page.', 'Aggregate clicks per ad per minute, sliced by country, device and campaign, available within ~1 minute.', 'Return the top N most clicked ads in the last M minutes (e.g. top 100 in the last 5 minutes).', 'Remove duplicate and fraudulent clicks before they are counted for billing.', 'Produce daily reconciled totals for invoicing; support recomputation after bugs.'],
  nonFunctional: ['Correctness first: billing numbers exact after reconciliation; real-time numbers within ~0.1%.', 'Freshness: dashboards lag events by under 1-2 minutes at p99.', 'Click redirect latency under 50 ms p99 (users must not wait for analytics).', 'Handle 5&times; peaks and hot ads with 100&times; the average click rate.', 'Durable: no click lost once acknowledged; full replay of the last 7 days from the log and years from the lake.'],
  outOfScope: ['Ad serving, auctions and targeting.', 'Impression and conversion attribution (same pipeline shape, ~100&times; the volume for impressions).', 'Advertiser account management and payments (see <a href="../payment/index.html">payment system</a>).'],
  estimates: [
    ['Clicks per day', '1 billion', 'Large ad network: ~2 million active ads'],
    ['Average click rate', '~11.6k clicks/s', '1B / 86,400'],
    ['Peak click rate', '~58k clicks/s', '5&times; average (evenings, big events)'],
    ['Click event size', '~0.5 KB', 'click id, impression id, ad id, campaign, user/device ids, IP, user agent, timestamps'],
    ['Raw ingest', '~29 MB/s peak, ~0.5 TB/day', '58k &times; 0.5 KB; 1B &times; 0.5 KB per day'],
    ['Aggregate rows', '~1M rows/minute, ~1.4B rows/day', 'Active (ad, country, device) combinations per minute; sparse, most ads get 0-5 clicks a minute'],
    ['OLAP storage', '~60 GB/day, ~20 TB/year', '1.4B rows &times; ~40 bytes compressed; roll up to hourly after 30 days'],
    ['Dedup state', '~10 GB', '58k clicks/s &times; 3,600 s (1 h dedup window) &times; ~50 bytes per click id'],
    ['Dashboard queries', '~5k QPS peak', '~50k advertisers with auto-refreshing dashboards and API polling']
  ],
  compute: [
    ['Click servers', '~18 instances of 4 vCPU across 3 zones', 'Each does a signature check, a 302 redirect and an asynchronous produce: ~5k req/s per instance at 60% CPU. 58k / 5k &asymp; 12, then +50% for a zone loss &rArr; 18.'],
    ['Kafka', '6 brokers, 64 partitions for raw clicks', 'Only ~29 MB/s &times; RF 3 = ~90 MB/s of writes: small. 64 partitions allow up to 64 parallel Flink readers and hot-key spreading; 7 days of retention &asymp; 3.5 TB &times; 3.'],
    ['Flink job', '4 TaskManagers &times; 4 slots (16 parallel tasks)', 'One slot handles ~10k events/s through dedup, fraud lookup and windowing with RocksDB state; 58k / 10k &asymp; 6, &times;2 for catch-up after a restart (replaying a backlog at 2&times; real time) and headroom &rArr; 16.'],
    ['Checkpoints', 'Every 30 s, incremental, ~10-20 GB of state', 'Dedup state + open windows in RocksDB; incremental checkpoints upload only changed SST files to object storage, keeping each checkpoint to seconds.'],
    ['OLAP cluster', '~20 servers (10 &times; 2 replicas)', '5k QPS &times; ~20 ms per query on pre-aggregated, indexed segments = 100 busy cores; 16-core servers at ~60% utilisation &rArr; 10, doubled for replicas and zone loss.'],
    ['Nightly batch', 'Spark, ~50 cores for ~1 h', '0.5 TB of compressed Parquet per day: dedup, fraud re-scoring and grouping complete well inside the reconciliation window.']
  ],
  api: [
    ['GET /c?ad={id}&imp={impressionId}&sig={hmac}&dest={url}', 'Click endpoint: verifies the signed impression, logs the click asynchronously and returns 302 to the landing page. Signing stops forged clicks for arbitrary ads.'],
    ['Event: clicks.raw {clickId, impressionId, adId, campaignId, ts, ip, device, country}', 'Produced to Kafka keyed by adId; clickId is a UUIDv7 used for dedup.'],
    ['GET /v1/ads/{adId}/clicks?from=&to=&granularity=minute&groupBy=country', 'Advertiser time series from the OLAP store; marks data as provisional until reconciled.'],
    ['GET /v1/top-ads?window=5m&n=100&country=GB', 'Top-N most clicked ads in a sliding window, served from a precomputed Flink result or an OLAP query.'],
    ['GET /v1/billing/{campaignId}/daily?date=', 'Reconciled daily totals used for invoices (from the batch pipeline).']
  ],
  data: [
    ['Raw click', 'Kafka topic clicks.raw (7 days) + data lake (Parquet, years)', 'Partition key adId (hot ads salted); lake partitioned by date/hour; the immutable source of truth for replays.'],
    ['Dedup state', 'Flink keyed state (RocksDB), TTL 1 h', 'clickId (and impressionId for “one click per impression”) &rarr; seen flag; expires automatically.'],
    ['Minute aggregates', 'Real-time OLAP (Apache Pinot / Druid / ClickHouse)', '(adId, minute, country, device) &rarr; clicks, valid_clicks, fraud_clicks; upsert keyed by (adId, minute, dims) so replays overwrite rather than add.'],
    ['Top-N results', 'Small key-value store or OLAP table', '(window_end, country) &rarr; ranked list of (adId, clicks); recomputed every minute.'],
    ['Reconciled daily totals', 'Warehouse table', '(campaignId, adId, date) &rarr; billable clicks, version, reconciled_at; the invoice source.'],
    ['Late / rejected events', 'Kafka side-output topics', 'Events beyond allowed lateness and fraud-rejected clicks with reasons, for audit and batch correction.']
  ],
  dbChoice: [
    ['Event log', 'Kafka', 'Durable, ordered per partition, replayable for 7 days: the stream job can be restarted or re-run from any offset, which is the foundation of exactly-once and recomputation.', 'Writing clicks straight to a database: no replay, and the database becomes the bottleneck during spikes.'],
    ['Stream processing', 'Apache Flink', 'True event-time windows with watermarks, large keyed state in RocksDB, exactly-once checkpoints and two-phase-commit sinks.', 'Spark Structured Streaming (micro-batches, higher latency), Kafka Streams (simpler, less flexible), managed Stream Analytics / Kinesis Analytics.'],
    ['Query store', 'Real-time OLAP (Pinot / Druid / ClickHouse)', 'Columnar, pre-aggregated, indexed by time and dimensions; sub-second slice-and-dice at thousands of QPS; supports upserts for corrections.', 'Cassandra with one row per (ad, minute): fast point reads, but every new group-by needs a new table. A warehouse alone: too slow for live dashboards.'],
    ['Batch truth', 'Data lake (Parquet/Iceberg) + Spark', 'Cheap, complete history for reprocessing with the best dedup and fraud logic; independent code path catches streaming bugs.', 'Trusting the stream alone (pure kappa): simpler, but no independent check before billing.']
  ],
  diagram: {
    nodes: [['user', 'Users', 'client', 0, 1.2, 'click an ad'], ['lp', 'Landing page', 'ext', 1, 0, 'advertiser site'], ['cs', 'Click service', 'svc', 1, 1.2, '302 + async log'],
      ['k', 'Raw clicks log', 'stream', 2, 1.2, 'Kafka, key = ad_id'], ['lake', 'Data lake', 'blob', 2, 2.6, 'raw Parquet'], ['st', 'Checkpoints', 'blob', 3.3, 0, 'RocksDB state on S3'],
      ['fl', 'Flink job', 'worker', 3.3, 1.2, 'dedup, fraud, windows'], ['fr', 'Fraud scoring', 'ml', 3.3, 2.4, 'rules + model'], ['bj', 'Batch recompute', 'job', 3.3, 3.6, 'Spark, nightly'],
      ['ol', 'OLAP store', 'dw', 4.6, 1.2, 'Pinot / Druid'], ['rec', 'Reconciliation', 'svc', 4.6, 3, 'stream vs batch'], ['qs', 'Query service', 'svc', 6, 1.2, 'dashboards, top-N'], ['adv', 'Advertisers', 'user', 6, 2.4, 'dashboards, billing']],
    edges: [['user', 'cs'], ['user', 'lp', 'redirected'], ['cs', 'k', 'click event'], ['k', 'fl'], ['fl', 'st', 'checkpoints', 'async'], ['fl', 'fr', 'score'], ['fl', 'ol', '1-min aggregates'], ['k', 'lake', 'archive', 'async'],
      ['lake', 'bj', '', 'async'], ['bj', 'rec'], ['rec', 'ol', 'corrections'], ['adv', 'qs'], ['qs', 'ol']]
  },
  flows: [
    { name: 'Click + redirect', desc: 'The user clicks an ad. The redirect must be fast; analytics happen asynchronously.', steps: [
      ['user', 'cs', 'GET /c?ad=77&imp=…&sig=…', 'The ad link points at our click service, with a signed impression id so clicks cannot be forged for arbitrary ads or replayed endlessly.'],
      ['cs', 'k', 'produce click (async)', 'The service builds the event (UUIDv7 click id, server timestamp, IP, device) and hands it to the Kafka producer, which batches and sends with acks=all. A local disk spool covers a Kafka outage.', 'async'],
      ['cs', 'user', '302 Location: advertiser', 'The redirect is returned without waiting for Kafka; p99 stays well under 50 ms.', 'resp'],
      ['user', 'lp', 'load landing page', 'The user lands on the advertiser’s site.'],
      ['k', 'lake', 'archive raw events', 'A connector writes the same events to hourly Parquet files in the lake: the long-term source of truth.', 'async']],
      end: 'Decoupling the redirect from analytics keeps users fast and makes the log, not the click server, the durable record.' },
    { name: 'Windowed aggregation', desc: 'Flink turns raw clicks into per-minute counts by event time, with dedup and fraud filtering on the way.', steps: [
      ['k', 'fl', 'consume partitions', 'Each of 16 parallel tasks reads a set of Kafka partitions, tracking offsets inside Flink’s checkpoints (not committed to Kafka for correctness). It first drops duplicates: the click id is looked up in keyed RocksDB state with a 1 h TTL.'],
      ['fl', 'fr', 'score click (async I/O)', 'Rules (click rate per IP, data-centre IP ranges, impossible click-after-impression timing) plus a model give a fraud score; async I/O keeps throughput high.'],
      ['fr', 'fl', 'score 0.03: valid', 'Valid clicks continue; fraudulent ones are counted separately and sent to a rejected topic for audit.', 'resp'],
      ['fl', 'st', 'checkpoint barrier n', 'Every 30 s barriers flow through the job; each operator snapshots its state (dedup set, open windows) and Kafka offsets to object storage, consistently.', 'async'],
      ['fl', 'ol', 'emit (ad 77, 12:00, GB) = 412', 'When the watermark passes 12:01:00, the 12:00 window fires and the count is upserted, keyed by (ad, minute, dims), so a replay overwrites rather than adds.'],
      ['adv', 'qs', 'dashboard refresh', 'The advertiser’s dashboard polls for the last hour.'],
      ['qs', 'ol', 'query minute series', 'Sub-second columnar query over pre-aggregated rows.'],
      ['ol', 'qs', 'series, ~1 min fresh', 'Numbers are marked provisional until the nightly reconciliation.', 'resp']],
      end: 'Event-time windows + watermarks put each click in the minute it happened, not the minute it arrived.' },
    { name: 'Late events + hot ad', desc: 'A phone that was offline delivers clicks 3 minutes late, and one viral ad suddenly gets 20k clicks/s.', steps: [
      ['cs', 'k', 'click with ts 12:00:40', 'The click was recorded on the device at 12:00:40 but arrives at 12:03:40; it carries the original event time.'],
      ['k', 'fl', 'late event', 'The 12:00 window already fired. Allowed lateness is 5 minutes, so window state is still kept.'],
      ['fl', 'ol', 'updated count 413', 'Flink re-fires the window with the corrected count; the upsert replaces 412 with 413. Downstream consumers must expect updates.'],
      ['k', 'fl', 'click 2 h late', 'Beyond allowed lateness: the event goes to a late side output instead of being dropped silently.', 'err'],
      ['fl', 'lake', 'late side output', 'Very late events are included by the nightly batch recompute, which has no lateness limit.', 'async'],
      ['cs', 'k', 'ad 99: 20k clicks/s', 'A viral ad: keyed by ad_id, all its clicks would hit one Kafka partition and one Flink task, which falls behind.', 'err'],
      ['fl', 'ol', 'salted two-phase aggregate', 'Hot keys (detected by a rate threshold) are salted as ad_id#0..15: 16 tasks pre-aggregate in parallel, then a second keyed step sums the 16 partials per window. Only hot ads pay the extra step.']],
      end: 'Watermarks trade latency for completeness; allowed lateness + upserts fix most stragglers, and batch reconciliation catches the rest.' },
    { name: 'Job failure, exactly-once', desc: 'A Flink TaskManager dies mid-window. Recovery must neither lose nor double-count clicks.', steps: [
      ['k', 'fl', 'TaskManager 2 dies', 'A TaskManager running 4 of the 16 tasks is lost mid-window (node failure or spot reclaim); everything it processed since the last checkpoint is gone from memory.', 'err'],
      ['fl', 'st', 'restore checkpoint n', 'The JobManager restarts the job (on spare slots) from the last completed checkpoint: dedup state, open window contents and the Kafka offsets that match them.', 'resp'],
      ['k', 'fl', 'rewind to checkpoint offsets', 'Consumption restarts from the offsets stored in the checkpoint, so every event after it is processed again, exactly once with respect to state.'],
      ['fl', 'ol', 'idempotent upsert', 'Results emitted after the checkpoint are emitted again, but as upserts with the same keys, so the OLAP store ends up with the same values. (For Kafka sinks, Flink’s two-phase-commit transactions commit outputs only when a checkpoint completes.)'],
      ['adv', 'qs', 'dashboard', 'Advertisers see at most a minute or two of extra delay; no number jumped or doubled.'],
      ['qs', 'ol', 'query', 'Normal service.', 'resp']],
      end: 'Exactly-once = replayable source + consistent state snapshots + idempotent or transactional sinks.' },
    { name: 'Nightly reconciliation', desc: 'An independent batch job recomputes yesterday from raw events and corrects the real-time numbers before invoicing.', steps: [
      ['lake', 'bj', 'read yesterday’s raw clicks', 'Spark reads the complete day, including very late events, from immutable Parquet files, deduplicates across the whole day and re-scores fraud with the latest models and features (device graphs, conversion patterns).', 'async'],
      ['bj', 'rec', 'batch totals per ad/hour', 'Results are written as a new versioned table.'],
      ['rec', 'ol', 'compare with stream totals', 'Reconciliation diffs batch vs streaming counts per (ad, hour). Typical drift is under 0.1%: late events, fraud re-scoring.'],
      ['rec', 'ol', 'write corrections', 'Corrected hourly/daily rows overwrite provisional ones; differences above a threshold raise an alert, since they usually mean a bug in one of the pipelines.'],
      ['rec', 'adv', 'reconciled invoice data', 'Billing reads only reconciled totals; dashboards switch the day from “provisional” to “final”.', 'resp']],
      end: 'Stream for speed, batch for truth: the reconciliation step makes it safe to bill from a system whose real-time path is allowed to be slightly wrong.' }
  ],
  components: [
    ['Click service', 'Verify signed impressions, mint click ids, redirect immediately, produce events asynchronously with a local spool.'],
    ['Raw click log (Kafka)', 'Durable, replayable buffer partitioned by ad; feeds the stream job, the lake and fraud systems.'],
    ['Stream aggregation (Flink)', 'Dedup in keyed state, fraud scoring, event-time tumbling and sliding windows, watermarks, late-event handling, hot-key salting, exactly-once checkpoints.'],
    ['Fraud detection', 'Real-time rules and models (IP/device velocity, bots, click farms), plus offline re-scoring with better features in the batch path.'],
    ['OLAP store', 'Pre-aggregated, indexed minute data for dashboards and top-N; upserts for corrections; roll-ups for older data.'],
    ['Data lake + batch', 'Immutable raw history; nightly recompute; backfills after bug fixes.'],
    ['Reconciliation and billing feed', 'Compare stream vs batch, correct, alert on drift, publish final numbers for invoicing.']
  ],
  deep: [
    ['Windows, event time and watermarks', '<p><strong>Tumbling windows</strong> (fixed, non-overlapping: 12:00-12:01, 12:01-12:02) suit per-minute counts. <strong>Sliding (hopping) windows</strong> (5 minutes long, advancing every minute) answer “top ads in the last 5 minutes”; each event belongs to 5 windows, so pre-aggregate per minute and sum 5 minutes rather than storing each event 5 times. <strong>Session windows</strong> group bursts per user.</p><p>Use <strong>event time</strong> (when the click happened), not processing time, or a backlog after an outage would pile all its clicks into the current minute. A <strong>watermark</strong> is the job’s assertion “no more events older than T are expected”, typically <code>max event time seen - 30 s</code> (bounded out-of-orderness). A window fires when the watermark passes its end. Lower bound = fresher but more late events; higher = complete but slower. <strong>Allowed lateness</strong> keeps window state a few minutes longer and re-emits corrected results; events later than that go to a side output. Idle partitions must not hold the watermark back (Flink’s <code>withIdleness</code>).</p>'],
    ['Exactly-once in Flink', '<p>Flink’s checkpoints implement the Chandy-Lamport snapshot idea: the sources inject <strong>barriers</strong> into the stream; when an operator has received the barrier on all inputs, it snapshots its state, so the snapshot is consistent with exactly the input up to the barrier offsets. On failure the job restores the latest checkpoint and rewinds Kafka to the stored offsets. That gives exactly-once <em>state</em>. For exactly-once <em>output</em>:</p><ul><li><strong>Idempotent sink</strong>: upsert keyed by (ad, window, dims). Replays rewrite the same value. Simplest, and what we use for the OLAP store.</li><li><strong>Transactional sink</strong>: two-phase commit tied to checkpoints (Kafka transactions): outputs become visible only when the checkpoint completes, at the cost of latency equal to the checkpoint interval.</li></ul><p>Unaligned checkpoints and incremental RocksDB checkpoints keep this cheap under back-pressure.</p>'],
    ['Deduplication and fraud', '<p>Duplicates come from client retries, double clicks, at-least-once producers and bots. Dedup on a <strong>click id</strong> minted server-side (and optionally “one billable click per impression id”) using Flink keyed state with a TTL of about an hour: ~10 GB of RocksDB state at peak. A Bloom filter in front cuts state lookups for the common case of unseen ids. For longer windows, the batch job deduplicates across the whole day.</p><p>Fraud filtering is layered: real-time rules (more than N clicks per IP per ad per minute, data-centre IP ranges, missing or invalid impression signature, click within 100 ms of the impression), a streaming model score, and offline re-scoring with richer features (device graphs, conversion patterns). Fraudulent clicks are counted separately rather than discarded, so advertisers see transparency and reconciliation can re-include false positives.</p>'],
    ['Hot ads and skew', '<p>Keying by ad_id sends all clicks of one ad to one task. A viral ad at 20k clicks/s overloads its task and back-pressure slows the whole job. Two-phase aggregation fixes it: a first stage keyed by <code>(ad_id, salt)</code> with salt = random 0..15 (or hash of click id) counts per window in parallel; a second stage keyed by ad_id sums 16 partial counts per window, which is tiny. Apply salting only to keys above a rate threshold (detected with a heavy-hitters sketch) to keep cardinality down elsewhere. Flink SQL’s local-global (two-phase) aggregation and mini-batch options do the same automatically. Kafka partitioning has the same issue: salt the message key for known-hot ads.</p>'],
    ['Lambda vs kappa, and why reconcile', '<table><tr><th></th><th>Lambda</th><th>Kappa</th></tr><tr><td>Paths</td><td>Batch layer (truth) + speed layer (fresh), merged at query time</td><td>One streaming path; reprocess by replaying the log</td></tr><tr><td>Code</td><td>Two implementations of the same logic</td><td>One</td></tr><tr><td>Recompute</td><td>Batch job over the lake</td><td>New job version replays from Kafka or the lake</td></tr></table><p>We run a kappa-style stream as the main path (one code base, Flink SQL), but keep a nightly batch recompute and <strong>reconciliation</strong> because money is involved: an independent computation catches bugs in either path, includes very late events and improved fraud scores, and produces the auditable final number. If drift exceeds a threshold (e.g. 0.1%), an alert fires and billing waits.</p>']
  ],
  scale: [
    '<strong>More clicks:</strong> add Kafka partitions and Flink parallelism together; the job is keyed, so it scales linearly except for hot keys, which get salted.',
    '<strong>State size:</strong> RocksDB state backend with incremental checkpoints; keep TTLs tight; for very large dedup windows, use Bloom filters or move long-window dedup to batch.',
    '<strong>Query load:</strong> pre-aggregate to the minute, roll up older data to hours and days, cache popular dashboard queries, and add OLAP replicas.',
    '<strong>Recovery time:</strong> a restart replays from the checkpoint; size parallelism so the job catches up at 2-3&times; real time; keep checkpoints frequent (30-60 s).',
    '<strong>Impressions:</strong> at ~100&times; the volume, the same design needs more partitions, sampling for non-billing analytics, and columnar compression from the start.'
  ],
  tradeoffs: [
    ['Architecture', 'Lambda vs kappa', 'Kappa for the live path (one code base) plus batch reconciliation for billing; a full lambda merge at query time is not needed.'],
    ['Watermark delay', 'Short (fresh, more late events) vs long (complete, slower)', '~30 s bounded out-of-orderness with 5 min allowed lateness and upserts; very late events go to batch.'],
    ['Exactly-once output', 'Idempotent upserts vs two-phase-commit sinks', 'Upserts into the OLAP store (no extra latency); transactional Kafka sinks where downstream consumers cannot handle updates.'],
    ['Aggregate store', 'Real-time OLAP vs key-value per (ad, minute) vs warehouse', 'Real-time OLAP for flexible group-bys at high QPS; the warehouse holds reconciled billing data.'],
    ['Fraud handling', 'Drop vs count separately', 'Count separately with reasons: auditable, and false positives can be restored at reconciliation.']
  ],
  failures: [
    ['Flink task or TaskManager crash', 'Restart from the latest checkpoint and rewind Kafka offsets; idempotent upserts mean no double counting.'],
    ['Kafka unavailable', 'Click servers keep redirecting and spool events to local disk, replaying once Kafka is back; alert on spool size.'],
    ['Stream job bug produces wrong counts', 'Fix, then reprocess from Kafka (7 days) or the lake with a new job version writing to new tables, then switch; reconciliation would have flagged drift.'],
    ['Hot ad overloads one task', 'Heavy-hitter detection and salting with two-phase aggregation; back-pressure monitoring per subtask.'],
    ['Watermark stalls (idle partition)', 'Idleness detection so empty partitions do not hold back the watermark; alert on watermark lag.'],
    ['Click fraud attack', 'Rate rules per IP/device, signed impressions, model scores, rejected-click topic; advertisers are not billed for flagged clicks.'],
    ['OLAP cluster degraded', 'Replicas serve queries; the stream keeps writing to Kafka and the sink catches up; dashboards show data as delayed rather than wrong.']
  ],
  cloud: [['Raw click log', 'stream'], ['Stream processing (Flink)', 'streamproc'], ['Real-time OLAP store', 'Azure Data Explorer', 'Apache Pinot / Druid on EKS'], ['Data lake', 'blob'], ['Nightly recompute (Spark)', 'bigdata'],
    ['Warehouse for billing totals', 'warehouse'], ['Batch orchestration', 'workflow'], ['Fraud models', 'ml'], ['Click endpoint at the edge', 'cdn'], ['Click servers', 'k8s'], ['Regional load balancer', 'lb'],
    ['Advertiser query API', 'apigw'], ['Metrics, lag and watermark alerts', 'monitor'], ['Signing keys', 'secrets']],
  refs: { az: ['azStreamAsa', 'azStreamDbx', 'azBigData', 'azEventDriven', 'azp-materialized-view', 'azp-cqrs'],
          aws: ['awsClickstream', 'awsAnalyticsLens', 'blBacklog', 'awsEventSourcing', 'blShedding'] },
  questions: [
    ['How do you avoid counting a click twice?', 'A server-minted click id per click, dedup in Flink keyed state with a TTL, exactly-once checkpoints with Kafka offsets, and idempotent upserts into the store. The nightly batch deduplicates across the whole day as a final check.'],
    ['What is a watermark and how do you choose its delay?', 'A watermark says “events older than T are not expected any more”, which lets event-time windows close. Choose the delay from the observed lateness distribution (e.g. 99.9th percentile of arrival delay, ~30 s); handle the long tail with allowed lateness and side outputs into batch.'],
    ['How do you compute the top 100 ads in the last 5 minutes?', 'Count per ad per minute (tumbling), keep the last 5 minute buckets per ad, and every minute compute the sliding 5-minute sum; a top-N operator per country keeps a min-heap of 100. Or query the OLAP store, which handles it in milliseconds over pre-aggregated rows.'],
    ['Why have a batch path at all if Flink is exactly-once?', 'Exactly-once protects against infrastructure failures, not logic bugs, very late data or improved fraud models. Billing needs an independent, auditable recomputation; reconciliation compares the two and corrects provisional numbers.'],
    ['How do you handle a single ad getting 20k clicks per second?', 'Salt its key into N sub-keys for a first aggregation stage, then sum the partials per window in a second stage. Detect hot keys dynamically with a heavy-hitters sketch so only they pay the extra step.'],
    ['What happens when the stream job is down for 30 minutes?', 'Clicks keep flowing into Kafka. On restart the job resumes from its checkpoint and processes the backlog at 2-3&times; real time; event-time windows put every click in the right minute, so the numbers come out the same, just later.']
  ],
  related: ['message-queue', 'observability', 'payment', 'recommendation', 'messaging']
});

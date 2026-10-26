SD.renderCase({
  slug: 'observability',
  summary: 'An observability platform collects the three main signals from every service, <strong>metrics</strong> (cheap numeric time series for dashboards and alerts), <strong>logs</strong> (detailed events for debugging) and <strong>traces</strong> (the path of one request across services), and makes them queryable within seconds. This design uses <strong>OpenTelemetry</strong> SDKs and collectors at the edge, a <strong>Kafka-style stream</strong> as a shock absorber between producers and storage, a horizontally sharded <strong>time-series database</strong> (Prometheus-compatible, like Mimir, M3 or VictoriaMetrics) built around compressed in-memory head blocks and strict <strong>cardinality limits</strong>, <strong>columnar log storage</strong> (ClickHouse-style) instead of a full inverted index for most logs, and <strong>tail-based trace sampling</strong> that keeps every error and slow trace but only a few percent of the boring ones. On top sit <strong>alerting rules and SLO burn-rate alerts</strong>, <strong>hot/warm/cold retention tiers</strong> on object storage, and <strong>per-tenant quotas</strong> so one team’s label mistake cannot take down monitoring for everyone. The platform must be more reliable than the systems it watches.',
  examples: 'Datadog, Grafana Cloud (Mimir, Loki, Tempo), Honeycomb, New Relic, Splunk Observability, Azure Monitor and Application Insights, Amazon CloudWatch with X-Ray; in-house platforms such as Uber’s M3, Netflix Atlas and Edgar, and ClickHouse-based logging at Cloudflare and Uber.',
  functional: ['Ingest metrics, logs and traces over OTLP (plus Prometheus remote-write and syslog) from ~50,000 hosts.', 'Query: PromQL-style metrics, full-text and structured log search, trace lookup by id and by attributes; correlate via exemplars and trace ids in logs.', 'Dashboards, alert rules, SLO definitions with multi-window burn-rate alerts, routing to on-call.', 'Retention tiers: recent data fast, older data cheaper and downsampled.', 'Multi-tenancy: per-team quotas, isolation, cost attribution (show-back).'],
  nonFunctional: ['Ingest-to-query freshness under ~30 s for metrics and logs; alert evaluation every 30-60 s.', 'Availability above the services it monitors (99.95%+); degrade by dropping low-priority data, never by losing alerting.', 'Dashboard queries over 24 h in under 2 s at p95.', 'Absorb 3&times; bursts (incidents produce more logs) without data loss.', 'Cost under ~5-10% of the infrastructure it monitors: storage and cardinality are the levers.'],
  outOfScope: ['Security analytics / SIEM correlation rules.', 'Continuous profiling and real-user monitoring (mentioned as extensions).', 'Business analytics on event data (see <a href="../ad-click/index.html">ad click aggregation</a>).'],
  estimates: [
    ['Monitored footprint', '50k hosts, ~500k containers', 'Large multi-team company running several Kubernetes fleets'],
    ['Active metric series', '~100 million', '~200 series per container on average (histograms dominate)'],
    ['Metric samples', '~6.7M samples/s', '100M series / 15 s scrape interval'],
    ['Metric storage', '~0.9 TB/day', '6.7M &times; 86,400 &times; ~1.5 bytes/sample (Gorilla delta-of-delta + XOR compression)'],
    ['Logs', '~2M lines/s, ~1 GB/s raw', '~500 bytes per structured log line; 3&times; that during incidents'],
    ['Log storage', '~9 TB/day compressed', '86 TB/day raw &divide; ~10 (columnar zstd compression)'],
    ['Spans before sampling', '~1M spans/s, ~1 GB/s', '~20k req/s at the edge &times; ~50 spans per request'],
    ['Spans kept', '~60k spans/s', 'Tail sampling: all errors and slow traces (~1%) + 5% baseline'],
    ['Query load', '~1,000 queries/s', '50k alert rules every 60 s (~830/s) + dashboards and ad-hoc queries']
  ],
  compute: [
    ['Collector gateways', '~40 pods of 4 vCPU across 3 zones', 'Agents run on every node (DaemonSet). Gateways handle ~2.1 GB/s of OTLP; one 4-vCPU collector processes ~40-50k spans/s or ~80 MB/s of logs. (1M spans/s / 45k &asymp; 22) + (1 GB/s / 80 MB/s &asymp; 13) &asymp; 35, plus headroom &rArr; 40.'],
    ['Ingest stream', '~30 Kafka brokers', '~2.1 GB/s in &times; RF 3 = 6.3 GB/s disk writes; 6-12 h retention to buffer a storage outage (2.1 GB/s &times; 12 h &asymp; 90 TB &times; 3 = 270 TB, ~9 TB per broker).'],
    ['Metrics ingesters', '~200 ingesters of 8 vCPU / 32 GB', '100M series &times; replication 3 = 300M in-memory series; ~1.5M series per ingester (~20 KB RAM each incl. head chunks) &rArr; 200, ~70% memory use.'],
    ['Log store', '~30 ClickHouse nodes (2 replicas &times; 15 shards), 32 vCPU', 'One node inserts ~150-200 MB/s raw in large batches; 3 GB/s burst / 200 MB/s = 15 shards; replicas double it and serve queries.'],
    ['Trace sampler + store', '~20 sampler pods, object-storage-backed trace store', 'Samplers buffer ~30 s of spans: 1 GB/s &times; 30 s = 30 GB in memory, ~1.5 GB each across 20 pods; stored traces go to Parquet blocks on object storage.'],
    ['Query tier', '~60 query pods + caches', '1,000 queries/s &times; ~200 ms CPU (after result and chunk caches) = 200 cores &rArr; ~60 pods of 4-8 vCPU at 60% utilisation; queries split by time and sharded for parallelism.']
  ],
  api: [
    ['POST /v1/metrics | /v1/logs | /v1/traces (OTLP, gzip/zstd)', 'Ingest; tenant from the auth token (X-Scope-OrgID style); returns 429 with retry-after when the tenant exceeds its quota.'],
    ['POST /api/v1/push (Prometheus remote-write 2.0)', 'Compatibility path for Prometheus agents; series hashed to ingesters.'],
    ['GET /api/v1/query_range?query=&start=&end=&step=', 'PromQL range query; split by day and by shard in the query frontend and cached.'],
    ['POST /logs/search {query, start, end, limit}', 'Structured filter + full-text search over logs; returns matching lines with trace ids for correlation.'],
    ['GET /traces/{traceId} | POST /traces/search (TraceQL)', 'Fetch a trace or find traces by attributes (service, duration &gt; 2 s, status=error).'],
    ['PUT /rules/{namespace} | PUT /slos/{id}', 'Alerting and recording rules, SLO objectives (e.g. 99.9% over 30 days) that generate burn-rate alerts.']
  ],
  data: [
    ['Metric series', 'TSDB: in-memory head (2 h) + immutable blocks on object storage', 'Series id = hash(tenant, metric name, sorted labels); chunks of ~120 samples; inverted index label=value &rarr; series ids (postings).'],
    ['Log rows', 'Columnar store (ClickHouse MergeTree)', 'ORDER BY (tenant, service, severity, timestamp); columns for common fields; attributes as Map; token Bloom-filter skip indexes; partitions by day for TTL moves.'],
    ['Spans', 'Trace store on object storage (Parquet blocks)', 'trace id, span id, parent, service, name, start, duration, status, attributes; Bloom filter on trace id per block for lookup.'],
    ['Exemplars', 'Stored with metric samples', 'A sample of trace ids attached to histogram buckets: jump from a latency spike straight to a slow trace.'],
    ['Rules, SLOs, dashboards', 'Relational database', 'Versioned in Git (as code) and synced; small, strongly consistent.'],
    ['Tenant limits and usage', 'Config store + usage counters', 'max active series, samples/s, log bytes/s, retention per tier; usage per tenant per day for show-back.']
  ],
  dbChoice: [
    ['Metrics', 'Purpose-built TSDB (Prometheus model, horizontally sharded: Mimir / M3 / VictoriaMetrics)', 'Append-only numeric samples compress to ~1.5 bytes; queries are aggregations over label selectors; head block in RAM gives fresh reads, blocks on object storage give cheap retention.', 'General columnar store for metrics: flexible but larger per sample. Wide-column (Cassandra) TSDBs: earlier generation, harder to query.'],
    ['Logs', 'Columnar (ClickHouse) with skip indexes; full inverted index only for a small hot subset', 'Most logs are written and never read; columnar storage compresses ~10&times; and scans by time and service fast. Indexing every token (Elasticsearch) costs ~1-1.5&times; raw size and lots of CPU at ingest.', 'Elasticsearch/OpenSearch: best for ad-hoc full-text search, expensive at 1 GB/s. Loki-style label-only index: cheapest, but slow for needle-in-haystack queries.'],
    ['Traces', 'Object storage with columnar blocks (Tempo / Parquet)', 'Write-heavy, read-by-id or by a few attributes, short retention: object storage is far cheaper than a database.', 'Cassandra / Elasticsearch trace backends (older Jaeger setups): more operational load.'],
    ['Ingest buffer', 'Kafka', 'Decouples bursty producers from storage, lets several consumers (metrics, logs, archive, security) read the same data, and buffers hours during a storage outage.', 'Direct write to storage: lower latency, but a storage hiccup back-pressures every agent and data is dropped.']
  ],
  diagram: {
    nodes: [['apps', 'Services', 'client', 0, 1.4, 'OTel SDK, /metrics'], ['agent', 'Node agent', 'svc', 1, 1.4, 'OTel Collector'], ['gw', 'Collector gateway', 'gw', 2, 1.4, 'auth, quotas, routing'],
      ['kafka', 'Ingest stream', 'stream', 3, 1.4, 'Kafka, per signal'], ['li', 'Log ingesters', 'worker', 4, 1.4, 'parse, batch insert'], ['ts', 'Tail sampler', 'worker', 4, 2.6, 'group by trace id'],
      ['tsdb', 'Metrics TSDB', 'tsdb', 5, 0.2, 'sharded ingesters'], ['logs', 'Log store', 'dw', 5, 1.4, 'columnar (ClickHouse)'], ['traces', 'Trace store', 'nosql', 5, 2.6, 'Parquet blocks'],
      ['blob', 'Object storage', 'blob', 6, 0.2, 'warm / cold tiers'], ['q', 'Query frontend', 'svc', 6, 2.0, 'split, shard, cache'], ['ui', 'Dashboards', 'user', 6, 3.3, 'engineers'],
      ['alert', 'Alerting / SLOs', 'svc', 5, 3.7, 'rules, burn rates'], ['pager', 'On-call', 'ext', 3.6, 3.7, 'PagerDuty / Slack']],
    edges: [['apps', 'agent', 'OTLP / scrape'], ['agent', 'gw', 'batched OTLP'], ['gw', 'kafka'], ['kafka', 'tsdb', 'metrics'], ['kafka', 'li', 'logs'], ['kafka', 'ts', 'spans'], ['li', 'logs'], ['ts', 'traces'],
      ['tsdb', 'blob', 'blocks', 'async'], ['logs', 'blob', 'cold parts', 'async'], ['q', 'tsdb'], ['q', 'logs'], ['q', 'traces'], ['ui', 'q'], ['alert', 'q'], ['alert', 'pager', 'notify']]
  },
  flows: [
    { name: 'Metric ingest + dashboard query', desc: 'A request counter travels from a service to a dashboard panel, and the query fans out across shards.', steps: [
      ['apps', 'agent', 'scrape /metrics every 15 s', 'The node agent scrapes Prometheus endpoints (or receives OTLP pushes) and adds resource labels: cluster, namespace, pod.'],
      ['agent', 'gw', 'OTLP batch (zstd)', 'Batches of thousands of samples, compressed, with the tenant’s token. Agents keep a small disk buffer so a gateway restart loses nothing.'],
      ['gw', 'kafka', 'partition by series hash', 'The gateway first checks the tenant’s samples/s and active-series quota. Hashing (tenant, labels) to a partition keeps each series on one ingester shard; Kafka absorbs bursts and outages downstream.'],
      ['kafka', 'tsdb', 'ingesters consume', 'Ingesters append samples to in-memory head chunks (Gorilla compression) and update the label index; data is queryable within seconds.'],
      ['tsdb', 'blob', 'upload 2 h block', 'Every 2 hours the head is cut into an immutable block and uploaded; compactors merge blocks and write 5 min and 1 h downsampled copies.', 'async'],
      ['ui', 'q', 'rate(http_requests_total[5m])', 'A dashboard panel asks for 24 h of data by service.'],
      ['q', 'tsdb', 'split by time + shard', 'The frontend splits the range into per-day pieces (cacheable) and 16 query shards run in parallel: recent hours from ingesters, older from blocks.'],
      ['tsdb', 'q', 'partial aggregates', 'Each shard returns pre-aggregated series; the frontend merges and caches results.', 'resp'],
      ['q', 'ui', 'chart in ~400 ms', 'Repeat views hit the results cache.', 'resp']],
      end: 'Fresh data from memory, history from object storage, and query splitting plus caching keep dashboards fast at 100M series.' },
    { name: 'Logs: columnar ingest + search', desc: 'A structured log line is stored cheaply and found again during an incident.', steps: [
      ['apps', 'agent', 'JSON line to stdout', 'The service logs structured JSON including trace_id and span_id from the OpenTelemetry context.'],
      ['agent', 'gw', 'OTLP logs', 'The agent tails container logs, parses, drops debug lines by policy and adds Kubernetes metadata.'],
      ['gw', 'kafka', 'logs topic, per tenant', 'The gateway meters bytes per tenant against quota and routes to the logs topic.'],
      ['kafka', 'li', 'consume', 'Log ingesters consume in large batches: columnar stores want inserts of 100k+ rows, not single rows.'],
      ['li', 'logs', 'batch INSERT', 'Rows land sorted by (tenant, service, severity, time); common fields as columns, the rest as a Map; token Bloom filters let searches skip most granules.'],
      ['logs', 'blob', 'TTL move after 7 days', 'Day partitions older than 7 days move to an object-storage-backed volume (warm); after 30 days they are archived as compressed files (cold).', 'async'],
      ['ui', 'q', 'service=checkout "timeout"', 'An engineer searches the last hour for timeouts in one service.'],
      ['q', 'logs', 'scan pruned granules', 'Primary-key ordering and skip indexes cut the scan to a few GB, read in parallel across shards.'],
      ['logs', 'q', 'matching lines + trace ids', 'Results include trace ids, one click away from the full trace.', 'resp']],
      end: 'Columnar storage with skip indexes costs a fraction of indexing every token, and still answers incident queries in seconds.' },
    { name: 'Traces: tail sampling', desc: 'Keep every interesting trace while storing only ~6% of spans.', steps: [
      ['apps', 'agent', 'spans (100% sampled)', 'SDKs record every span; head sampling here would decide before knowing whether the request fails.'],
      ['agent', 'gw', 'OTLP spans', 'Forwarded in batches.'],
      ['gw', 'kafka', 'partition by trace id', 'All spans of one trace land on the same partition, so one sampler instance sees the whole trace. The gateway also derives RED span metrics (rate, errors, duration) from 100% of spans before any sampling.'],
      ['kafka', 'ts', 'consume', 'The sampler buffers spans per trace for ~30 s after the last span arrives (decision wait).'],
      ['ts', 'traces', 'keep: error or p99+ or 5%', 'Policies: keep any trace with an error status, any slower than the service’s latency threshold, and a 5% random baseline; drop the rest.'],
      ['ts', 'kafka', 'late span: decision cache', 'Late spans for already-decided traces follow the cached keep/drop decision, so traces are not broken in half.', 'async'],
      ['ui', 'q', 'trace by id from exemplar', 'From a latency spike on a dashboard, the engineer clicks an exemplar.'],
      ['q', 'traces', 'Bloom filter per block', 'Lookup by trace id checks per-block Bloom filters, reading one block from object storage.'],
      ['traces', 'q', 'full trace waterfall', 'The complete trace, with links to its logs by trace id.', 'resp']],
      end: 'Head sampling is cheap but blind; tail sampling keeps the traces you actually need, at the cost of buffering and trace-affinity routing.' },
    { name: 'SLO burn-rate alert', desc: 'An error-budget alert pages on-call quickly for a real problem but stays quiet for blips.', steps: [
      ['alert', 'q', 'evaluate every 60 s', 'The ruler evaluates recording rules (error ratio per window) and alert rules for every tenant, sharded across ruler instances.'],
      ['q', 'tsdb', 'error ratio over 5m and 1h', 'SLO 99.9% means a 0.1% error budget. The page rule fires if both the 1 h and the 5 min burn rates exceed 14.4× (2% of the 30-day budget burnt in an hour).'],
      ['tsdb', 'q', '1h: 20×, 5m: 25×', 'Both windows exceed the threshold: a real, ongoing problem, not a past blip (the short window confirms it is still happening).', 'resp'],
      ['q', 'alert', 'condition true for 2 min', 'A short for-duration avoids flapping.', 'resp'],
      ['alert', 'pager', 'page: checkout SLO burning', 'Alerts are grouped and deduplicated (Alertmanager-style), routed by team label; the page links to the dashboard, runbook and exemplar traces.'],
      ['alert', 'pager', 'ticket: slow burn 6h × 6', 'A second, slower rule pair (6 h and 30 min windows at 6×) opens a ticket instead of waking someone up.', 'async']],
      end: 'Multi-window burn-rate alerts give fast detection of big outages and low noise for small ones; alert on symptoms users feel, not on every cause.' },
    { name: 'Cardinality explosion', desc: 'A deploy adds a user_id label to a metric; series for one tenant jump 20×. Quotas contain the blast radius.', steps: [
      ['apps', 'agent', 'new label user_id', 'A well-meaning change adds a per-user label: millions of new series appear within minutes.', 'err'],
      ['agent', 'gw', 'series surge', 'The surge reaches the gateway.'],
      ['gw', 'agent', '429: series limit exceeded', 'The tenant hit its active-series limit (e.g. 5M). New series are rejected; existing series keep flowing, so dashboards and alerts for that team mostly keep working.', 'err'],
      ['gw', 'kafka', 'other tenants unaffected', 'Per-tenant limits and shuffle-sharded ingesters keep other tenants’ data flowing.'],
      ['kafka', 'tsdb', 'ingest within limits', 'Ingesters are protected from memory exhaustion, which would otherwise crash shards and lose recent data for everyone.'],
      ['alert', 'pager', 'notify owning team', 'Meta-monitoring (a separate, small monitoring stack) alerts the team with the top offending metric and label.']],
      end: 'Cardinality is the main cost and stability risk of a metrics system: enforce limits at ingest, show teams their usage, and push per-entity data to logs or traces instead.' }
  ],
  components: [
    ['OpenTelemetry SDKs + node agents', 'Instrument code (traces, metrics, logs with shared context), scrape endpoints, enrich with resource attributes, buffer to disk.'],
    ['Collector gateways', 'Authentication, tenant identification, quotas and rate limits, routing by signal, span-metrics generation, redaction of secrets/PII.'],
    ['Ingest stream (Kafka)', 'Buffer between producers and storage; replay after outages; multiple consumers (storage, archive, security).'],
    ['Metrics TSDB', 'Sharded ingesters with in-memory head and WAL, object-storage blocks, compactor (merging, downsampling), store gateways, index and chunk caches.'],
    ['Log store', 'Columnar tables with TTL-based tier moves; skip indexes; optional inverted index for a hot, high-value subset.'],
    ['Trace pipeline', 'Trace-id-affine tail samplers with decision caches; columnar trace blocks on object storage.'],
    ['Query layer', 'Query splitting by time and shard, result caching, per-tenant query limits and fair scheduling.'],
    ['Alerting and SLO service', 'Recording and alert rules, burn-rate SLO alerts, grouping, silencing, routing to on-call.']
  ],
  deep: [
    ['Time-series storage and the cardinality problem', '<p>A series is a metric name plus a unique set of labels; <code>http_requests_total{service="checkout",code="500",pod="abc"}</code> is one series. Cost scales with <strong>active series</strong>, not samples: each needs memory in the head block (~1-3 KB) and an entry in the inverted index. Cardinality multiplies: 50 services &times; 20 endpoints &times; 5 codes &times; 300 pods &times; 12 histogram buckets = 18M series from one metric.</p><p>Storage: Gorilla-style compression (delta-of-delta timestamps, XOR of float values) gets ~1.3-1.5 bytes per sample; 2-hour blocks with a postings index (label=value &rarr; sorted series ids, intersected at query time). Controls:</p><ul><li>Per-tenant limits on active series, labels per series and samples/s, enforced at the gateway and ingester.</li><li>Never put unbounded values (user id, request id, URL with ids) in labels: they belong in logs or trace attributes, linked by exemplars.</li><li>Native/exponential histograms (Prometheus 3, OTel) replace a dozen bucket series with one.</li><li>Recording rules pre-aggregate expensive queries; aggregation at the collector drops pod-level labels when nobody needs them.</li></ul>'],
    ['Logs: inverted index vs columnar storage', '<table><tr><th></th><th>Inverted index (Elasticsearch)</th><th>Columnar (ClickHouse)</th><th>Label index only (Loki)</th></tr><tr><td>Ingest CPU</td><td>High (tokenise every field)</td><td>Low (sort + compress)</td><td>Lowest</td></tr><tr><td>Storage vs raw</td><td>~1-1.5&times;</td><td>~0.1&times;</td><td>~0.1&times; + small index</td></tr><tr><td>Needle search</td><td>Fast</td><td>Good with skip indexes and pruning</td><td>Slow brute-force scan</td></tr><tr><td>Aggregations</td><td>OK</td><td>Excellent</td><td>Limited</td></tr></table><p>Most log bytes are never read. A practical split: columnar storage for everything, an inverted index only for a hot subset (security audit, error logs), and an archive tier in object storage queried on demand. Keep the trace id in every log line so searches start from a trace rather than from text.</p>'],
    ['Trace sampling: head vs tail', '<p><strong>Head sampling</strong> decides at the root span (e.g. 1% by trace-id hash) and propagates the decision in the <code>traceparent</code> header. Cheap and stateless, but it throws away 99% of errors too. <strong>Tail sampling</strong> buffers all spans of a trace and decides after it completes: keep all errors, all traces above a latency threshold, rare endpoints, plus a small random baseline. Requirements: all spans of a trace must reach the same sampler (partition by trace id, or the collector’s load-balancing exporter), a decision wait (~10-30 s) sized for long traces, memory for the buffer, and a decision cache for late spans. Combine both: head-sample extremely high-volume, low-value traffic (health checks) to 0%, tail-sample the rest, and compute RED metrics from 100% of spans <em>before</em> sampling so dashboards stay accurate.</p>'],
    ['SLOs and burn-rate alerting', '<p>An SLO (99.9% of checkout requests succeed over 30 days) gives an <strong>error budget</strong> of 0.1%, about 43 minutes of full outage per month. The <strong>burn rate</strong> is how fast the budget is consumed: 1&times; uses it exactly over 30 days; 14.4&times; uses 2% in one hour. Google’s SRE workbook pattern:</p><table><tr><th>Severity</th><th>Long window</th><th>Short window</th><th>Burn rate</th></tr><tr><td>Page</td><td>1 h</td><td>5 min</td><td>14.4&times;</td></tr><tr><td>Page</td><td>6 h</td><td>30 min</td><td>6&times;</td></tr><tr><td>Ticket</td><td>3 days</td><td>6 h</td><td>1&times;</td></tr></table><p>The long window gives significance, the short window makes the alert reset quickly once fixed. Alert on user-facing symptoms (availability, latency SLOs) and use cause-based metrics on dashboards for diagnosis.</p>'],
    ['Retention tiers and multi-tenant quotas', '<p><strong>Hot</strong> (hours to days): ingester memory and local SSD; fastest queries, most expensive. <strong>Warm</strong> (weeks): blocks/parts on object storage with index and chunk caches. <strong>Cold</strong> (months to years): downsampled metrics (5 min, 1 h resolution), archived logs in compressed Parquet queried on demand, often for compliance only. A typical policy: metrics raw 15 days, 5 min for 90 days, 1 h for 13 months; logs 7 days hot, 30 days warm, 1 year cold; traces 14 days.</p><p>Multi-tenancy: tenant id from the token on every write and query; limits per tenant (active series, ingest bytes/s, query concurrency, max query range); <strong>shuffle sharding</strong> assigns each tenant a small random subset of ingesters and queriers, so a noisy tenant degrades only its own shard set. Usage is metered per tenant for show-back, which is the strongest cost-control lever of all.</p>']
  ],
  scale: [
    '<strong>Ingest bursts</strong> during incidents (logs triple exactly when you need them): Kafka buffering, autoscaled gateways, priority classes so error logs and alerting metrics are never dropped before debug logs.',
    '<strong>Ingester memory</strong> grows with active series: scale out ingesters, enforce series limits, and reduce churn (short-lived pods create new series on every deploy).',
    '<strong>Expensive queries</strong> (a year of high-cardinality data): query splitting and sharding, results and chunk caches, recording rules, per-tenant query limits and timeouts.',
    '<strong>Object storage request costs</strong> dominate at scale: bigger blocks, compaction, caching index headers and Bloom filters near the queriers.',
    '<strong>Monitoring the monitor</strong>: a small independent meta-monitoring stack (and a dead-man’s-switch alert) so a platform outage is itself detected.'
  ],
  tradeoffs: [
    ['Push vs pull', 'Prometheus scrape (pull) vs OTLP push', 'Both: scrape for infrastructure endpoints (detects down targets for free), OTLP push for application telemetry and short-lived jobs.'],
    ['Log storage', 'Inverted index vs columnar vs label-only', 'Columnar for the bulk (10&times; cheaper), inverted index for a hot, high-value subset.'],
    ['Trace sampling', 'Head vs tail', 'Tail sampling for errors and slow requests, with RED metrics from all spans before sampling; head sampling only to discard known noise.'],
    ['Ingest path', 'Direct to storage vs via Kafka', 'Kafka: survives storage outages, absorbs bursts and feeds several consumers; costs a few seconds of freshness and a cluster to run.'],
    ['Build vs buy', 'Self-hosted OSS stack vs SaaS (Datadog, Grafana Cloud) vs cloud-native (Azure Monitor, CloudWatch)', 'SaaS or cloud-native until scale makes per-GB pricing dominate; OpenTelemetry everywhere keeps the choice reversible.']
  ],
  failures: [
    ['Cardinality explosion', 'Per-tenant series limits at the gateway and ingesters; reject new series, keep existing; alert the owning team with the offending label.'],
    ['Storage backend outage', 'Kafka buffers 6-12 h; consumers catch up afterwards; alerting reads from ingesters in memory so it keeps working for recent data.'],
    ['Ingester crash', 'Replication factor 3 (or replay from Kafka/WAL) so no samples are lost; queries merge replicas and deduplicate.'],
    ['Incident log flood', 'Rate limits per tenant and priority by severity; drop or sample debug logs first; autoscale log ingesters.'],
    ['Alerting pipeline fails silently', 'Dead-man’s-switch alert (always firing, paging if it stops), independent meta-monitoring, alert-delivery tests.'],
    ['Secrets or PII in logs', 'Redaction processors in the collector, schema allow-lists for attributes, access controls and audit on log queries, short retention for sensitive streams.'],
    ['Noisy tenant query', 'Query limits (series touched, bytes scanned, time range), fair queueing per tenant, shuffle-sharded queriers.']
  ],
  cloud: [['Managed monitoring and tracing', 'monitor'], ['Log analytics', 'logs'], ['Time-series database', 'timeseries'], ['Managed Prometheus', 'Azure Monitor managed service for Prometheus', 'Amazon Managed Service for Prometheus'],
    ['Managed Grafana dashboards', 'Azure Managed Grafana', 'Amazon Managed Grafana'], ['Ingest stream', 'stream'], ['Collectors and storage on Kubernetes', 'k8s'], ['Warm and cold tiers', 'blob'], ['Full-text log search (hot subset)', 'search'],
    ['Long-term analytics on telemetry', 'warehouse'], ['Ingest endpoint load balancing', 'lb'], ['Engineer SSO', 'workforce'], ['Tokens and keys', 'secrets'], ['Private ingestion', 'network']],
  refs: { az: ['azMonitoring', 'azMultitenant', 'azp-throttling', 'azp-queue-based-load-leveling', 'azp-health-endpoint-monitoring', 'azp-sidecar', 'azBigData'],
          aws: ['blInstrument', 'awsLogging', 'blShedding', 'blShuffle', 'blBacklog', 'awsAnalyticsLens'] },
  questions: [
    ['Why not just store everything in Elasticsearch?', 'At 1 GB/s of logs an inverted index on every token costs a lot of ingest CPU and roughly raw size in storage. Most logs are never read; a columnar store compresses ~10&times; and still searches fast with skip indexes. Keep a full-text index only for the subset that needs it.'],
    ['How do you handle high cardinality?', 'Limit it: per-tenant active-series limits, reject unbounded labels, aggregate away pod-level labels at the collector, use native histograms, and move per-request detail into logs and traces linked by exemplars and trace ids.'],
    ['Head or tail sampling for traces?', 'Tail sampling, so that every error and slow trace is kept; it needs trace-id-affine routing and a buffer. Generate RED metrics from all spans before sampling. Use head sampling only to drop known noise like health checks.'],
    ['How do you alert without paging people for noise?', 'Alert on SLO burn rates over two windows (e.g. 1 h and 5 min at 14.4&times;): it fires quickly for real outages and resets fast, while slow burns open tickets. Group and deduplicate alerts and route by ownership labels.'],
    ['What if the observability platform itself goes down?', 'Kafka buffers ingest, alerting runs from in-memory recent data, and an independent meta-monitoring stack plus a dead-man’s-switch alert detect the outage. The platform is designed to fail by dropping low-priority data, not alerting.'],
    ['How do you keep cost under control?', 'Show-back per team (usage is visible), retention tiers with downsampling, sampling of traces and debug logs, limits on cardinality, and columnar compression. Cost is driven by active series and log bytes, so those are what you meter.']
  ],
  related: ['security-ops', 'message-queue', 'iot-platform', 'ad-click', 'llmops']
});

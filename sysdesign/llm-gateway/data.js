SD.renderCase({
  slug: 'llm-gateway',
  summary: 'Once dozens of teams call LLMs, each with its own keys, quotas and retry logic, you need one front door. An AI gateway is a reverse proxy specialised for model traffic: it authenticates callers with corporate identity, enforces <strong>token-based quotas</strong> (tokens per minute, not requests), routes each request to the right model, region and deployment, prefers reserved <strong>provisioned throughput</strong> and spills over to pay-as-you-go when it is full, fails over on 429 and 5xx, serves repeated questions from a <strong>semantic cache</strong>, applies content safety, logs prompts and responses with <strong>PII redaction</strong>, attributes every token to a team for chargeback, and does all this while passing streamed tokens through with only a few milliseconds of overhead. It is the control point for the reliability, safety and cost of every AI application in the company; see <a href="../ai-foundations/index.html#anatomy">anatomy of an LLM application</a>.',
  examples: 'Azure API Management AI gateway (llm-token-limit, semantic caching, load-balanced backend pools), Amazon API Gateway / Bedrock cross-region inference profiles, Kong AI Gateway, Cloudflare AI Gateway, LiteLLM proxy, Portkey, Envoy AI Gateway, and the internal model gateways of most large enterprises.',
  functional: ['Apps and agents call one OpenAI-compatible endpoint with a model alias (e.g. chat-default, chat-small, embed-v3); the gateway maps aliases to real deployments.', 'Authenticate with Entra ID / IAM tokens (managed identities) instead of shared API keys; per-team and per-app quotas in tokens per minute and monthly budgets.', 'Route by model, data-residency region, priority (interactive vs batch), backend health and utilisation; spill over from provisioned to pay-as-you-go; fail over across regions.', 'Semantic cache for opted-in apps; streaming passthrough of server-sent events.', 'Input and output content safety (prompt shields, harmful content, PII) with per-app policies.', 'Usage records per request for dashboards, alerts and monthly chargeback; prompt/response logging with PII redaction and per-app opt-out.'],
  nonFunctional: ['Added latency p95 &le; 15 ms (excluding optional safety scans); no buffering of streams.', '99.95% availability: higher than any single model deployment behind it.', 'Quota accuracy: over-admission &le; 2% of a team’s TPM across all gateway instances.', 'Peak ~350 requests/s and ~48 M tokens/min, ~2,100 concurrent streams.', 'Data residency: EU traffic never leaves EU regions; logs follow the same rule.', 'Every token attributed to a team; chargeback reconciles with the provider invoice within 1%.'],
  outOfScope: ['Hosting models on GPUs (see <a href="../llm-serving/index.html">LLM inference platform</a>).', 'Application-level RAG and agents (see <a href="../rag-assistant/index.html">RAG assistant</a>).', 'Offline evaluation tooling (see <a href="../llmops/index.html">LLMOps</a>).'],
  estimates: [
    ['Consumers', '300 apps from 120 teams', 'Chatbots, RAG assistants, agents, batch summarisation jobs'],
    ['Requests per day', '10 M', 'Chat, completions and embeddings combined'],
    ['Average / peak QPS', '~116 / ~350 req/s', '10 M / 86,400; &times;3 at the business-hours peak'],
    ['Tokens per request', '~2,000 in, ~300 out', 'RAG prompts dominate input; embeddings requests are short'],
    ['Peak token throughput', '~48 M tokens/min', '350 &times; 2,300 &times; 60'],
    ['Concurrent streams', '~2,100', '350 req/s &times; ~6 s per streamed response (TTFT + 300 tokens at ~60 tok/s)'],
    ['Model spend', '~$46 k/day', 'Half the traffic on a $2.50/$10 per M model ($0.008 per request &rArr; $40 k), half on a small model at $0.40/$1.60 ($0.0013 &rArr; $6.4 k). All on the large model would be $80 k'],
    ['Usage records', '10 M/day &times; ~0.5 KB = 5 GB/day', 'One record per request: team, app, model, backend, tokens, cached tokens, cost, latency'],
    ['Prompt/response logs', '~100 GB/day raw (~20 GB compressed)', '~10 KB of text and metadata per request; 30-day retention'],
    ['Semantic cache', '~2 M entries, ~16 GB', 'Opted-in apps only, 24 h TTL; ~8 KB per entry (vector + response)']
  ],
  compute: [
    ['Gateway instances', '6 &times; 4 vCPU across 3 zones', 'Per request ~10 ms CPU: token validation (cached keys) &lt; 1 ms, prompt token counting ~1-2 ms, routing, usage record, plus forwarding ~300 SSE chunks. 350 &times; 10 ms = 3.5 busy cores; at 50% target utilisation &rArr; 7 cores; 2 &times; 4 vCPU per zone so two zones carry everything. Memory is set by ~2,100 open streams (~100 KB each).'],
    ['Quota store', 'Redis cluster, 3 shards with replicas', '2 operations per request (reserve, reconcile) &times; 350 = 700 ops/s plus local batching: trivial load; replicas for availability, zone-redundant.'],
    ['Semantic cache', 'Redis with vector index, ~16 GB + replicas', '2 M entries &times; ~8 KB; lookups add ~5 ms plus ~15 ms to embed the last user message (a short embeddings call).'],
    ['Log pipeline', 'Event Hubs / Kafka with 4 MB/s ingress + 8 vCPU of redaction workers', '100 GB/day = 1.2 MB/s average, ~3.6 MB/s at peak. PII detection (Presidio-style NER + regex) at ~2 ms per KB: 3.6 MB/s &rArr; ~7 cores.'],
    ['Model capacity behind it', '~25 M TPM provisioned + pay-as-you-go + second region', 'Reserve the steady business-hours base (about half of the 48 M TPM peak) where utilisation stays above ~70%; spill the rest to pay-as-you-go; the second region absorbs failover and residency-compatible overflow.']
  ],
  api: [
    ['POST /v1/chat/completions  {model: "chat-default", stream: true}', 'OpenAI-compatible. Auth: Entra ID / IAM bearer token (or a managed key per app). Headers back: x-ratelimit-remaining-tokens, x-gateway-backend, x-cache: semantic-hit|miss, x-request-id.'],
    ['POST /v1/embeddings', 'Same quotas and routing; batched requests allowed for ingestion jobs at batch priority.'],
    ['GET /v1/models', 'Lists the aliases this caller may use, with context window, price class and data region.'],
    ['PUT /admin/teams/{teamId}/policy', '{tpm: {chat-default: 200000}, monthlyBudgetUsd, priority: interactive|batch, allowedModels, regions: [EU], logging: full|metadata, safety: strict|standard}.'],
    ['PUT /admin/aliases/{alias}', '{backends: [{deployment, region, type: provisioned|paygo, priority, weight}], retryOn: [429, 500, 503], timeoutMs}.'],
    ['event UsageRecord', '{requestId, teamId, appId, alias, backend, promptTokens, cachedTokens, completionTokens, costUsd, ttftMs, totalMs, cacheHit, safetyVerdicts} to the usage stream.']
  ],
  data: [
    ['teams, apps, policies', 'Relational DB (cached in gateway memory, 30 s refresh)', 'teamId, appId, identities (client ids), quotas per alias, budgets, priority, allowed regions, logging and safety levels, cost centre.'],
    ['quota counters', 'Redis', 'key tpm:{team}:{alias}:{minute} INCRBY tokens, TTL 120 s; or a token bucket per key (tokens, lastRefill) updated with a Lua script.'],
    ['alias routing table + backend health', 'Config store + in-memory state', 'alias &rarr; ordered backend pools; per-backend circuit breaker state, recent 429 rate, latency EWMA, retry-after until.'],
    ['semantic cache', 'Redis vector index', 'namespace = appId + alias + systemPromptHash; vector of normalised last user message; response, citations, createdAt; TTL 24 h.'],
    ['usage records', 'Event stream &rarr; data explorer / warehouse', 'Partition by date and teamId; hourly roll-ups for dashboards, monthly for chargeback; 13-month retention.'],
    ['prompt/response logs', 'Object storage / log analytics (per region)', 'Redacted text, requestId, safety verdicts; 30 days; access restricted to app owners and security.']
  ],
  dbChoice: [
    ['Quota counters', 'Redis (atomic INCRBY / Lua token bucket)', 'Shared across all gateway instances, sub-millisecond, TTL-based windows.', 'Pure local counters per instance (fast but each instance needs a slice of the quota, inaccurate under uneven load); a database (too slow per request).'],
    ['Usage and chargeback', 'Columnar analytics store (Azure Data Explorer, Redshift, Fabric)', 'Append-only, aggregated by team, model, hour; cheap long retention.', 'Relational DB: fine for roll-ups, slow on 300 M rows a month.'],
    ['Policies and routing', 'Relational DB / config store, cached in memory', 'Read on every request: must be in memory; changes are rare and audited.', 'Hard-coded gateway policies: no self-service, error-prone.']
  ],
  diagram: {
    nodes: [['apps', 'Apps and agents', 'client', 0, 1.2, 'OpenAI-compatible SDK'], ['idp', 'Entra ID / IAM', 'ext', 0, 0, 'app tokens'], ['gw', 'AI gateway', 'apigw', 1, 1.2, 'auth, quota, route'],
      ['q', 'Quota counters', 'cache', 1, 0, 'Redis TPM'], ['sc', 'Semantic cache', 'cache', 2, 0, 'per app namespace'], ['cs', 'Content safety', 'ai', 2, 2.3, 'shields, PII'],
      ['ptu', 'Provisioned', 'llm', 3, 0.1, 'region A, reserved'], ['pg', 'Pay-as-you-go', 'llm', 3, 1.1, 'region A, spillover'], ['rb', 'Region B', 'llm', 3, 2.1, 'failover, same geo'],
      ['ev', 'Log stream', 'stream', 1, 2.6, 'usage + prompts'], ['red', 'PII redaction', 'worker', 2, 3.5], ['logs', 'Prompt logs', 'blob', 3, 3.5, 'redacted, 30 days'], ['dw', 'Usage warehouse', 'dw', 0, 3.5, 'chargeback']],
    edges: [['apps', 'idp'], ['apps', 'gw'], ['gw', 'q'], ['gw', 'sc'], ['gw', 'cs'], ['gw', 'ptu'], ['gw', 'pg'], ['gw', 'rb'],
      ['gw', 'ev', '', 'async'], ['ev', 'red', '', 'async'], ['red', 'logs'], ['ev', 'dw', 'usage', 'async']]
  },
  flows: [
    { name: 'Chat request', desc: 'An interactive request is authenticated, metered, checked and routed to reserved capacity.', steps: [
      ['apps', 'idp', 'get token (managed identity)', 'The app uses its managed identity; no shared API keys to leak or rotate.'],
      ['apps', 'gw', 'POST chat-default (stream)', 'One endpoint for every model. The gateway validates the token and maps the client id to team “HR-bot” and its policy (cached in memory).'],
      ['gw', 'q', 'reserve ~2,500 tokens', 'Estimated cost = counted prompt tokens (2,000) + a share of max_tokens. The team has 200 k TPM, 140 k used this minute: admitted.'],
      { par: [['gw', 'sc', 'cache lookup (miss)'], ['gw', 'cs', 'prompt shield + PII scan']], msg: 'Cache lookup and input safety run in parallel to hide their latency (~20 ms). No jailbreak detected; an email address is allowed by this app’s policy.' },
      ['gw', 'ptu', 'route: provisioned first', 'Interactive traffic goes to the provisioned deployment while its utilisation is below 100%; it is already paid for.'],
      ['ptu', 'gw', 'SSE chunks', 'Tokens start after ~600 ms.', 'resp'],
      ['gw', 'apps', 'stream passthrough', 'Chunks are forwarded as they arrive (no buffering, flush per event); output safety scans a sliding window of text and can cut the stream if needed.', 'resp'],
      ['gw', 'q', 'reconcile actual usage', 'The final usage chunk (2,013 in, 287 out) replaces the estimate in the counter.'],
      ['gw', 'ev', 'UsageRecord + redacted log', 'Fire-and-forget to the stream so logging never slows the response.', 'async']],
      end: 'All cross-cutting concerns happen once, in the gateway, adding about 10-20 ms to a multi-second call.' },
    { name: 'Spillover and failover (failure)', desc: 'The 9 a.m. peak saturates reserved capacity and the pay-as-you-go deployment has an incident.', steps: [
      ['gw', 'ptu', 'request', 'Provisioned capacity is at 100% utilisation.'],
      ['ptu', 'gw', '429 retry-after 2 s', 'Provisioned deployments return 429 fast when full; that is a signal to spill, not an error for the user.', 'err'],
      ['gw', 'pg', 'spill to pay-as-you-go', 'Same model and version, same region; the gateway marks the provisioned backend busy until retry-after expires.'],
      ['pg', 'gw', '503 / timeout', 'The pay-as-you-go deployment has an incident. After 5 failures in 10 s its circuit breaker opens.', 'err'],
      ['gw', 'rb', 'fail over to region B', 'Region B is in the same geography, so the EU data-boundary policy allows it. The prompt is resent: no tokens were streamed yet, so the retry is invisible to the user.'],
      ['rb', 'gw', 'stream', 'TTFT is ~300 ms higher due to distance.', 'resp'],
      ['gw', 'apps', 'stream + x-gateway-backend', 'The response header records the backend for debugging.', 'resp'],
      ['gw', 'ev', 'usage (paygo price)', 'Spillover tokens are priced at pay-as-you-go rates for chargeback.', 'async']],
      end: 'Retry only before the first byte, respect retry-after, use circuit breakers, and never fail over to a region the data may not enter.' },
    { name: 'Quota and priority', desc: 'A batch job exceeds its quota while interactive apps keep their capacity.', steps: [
      ['apps', 'gw', 'batch job: 500 req/s burst', 'A nightly job started at 9 a.m. by mistake.'],
      ['gw', 'q', 'reserve: TPM exhausted', 'The team’s 300 k TPM is used up within seconds.', 'err'],
      ['gw', 'apps', '429 + retry-after header', 'Fast rejection with headers so the SDK backs off; no model capacity is consumed.', 'err'],
      ['gw', 'pg', 'batch: pay-as-you-go only', 'Even within quota, batch-priority traffic never uses provisioned capacity while interactive demand exists (or is sent to the 50%-cheaper batch API).'],
      ['gw', 'ptu', 'interactive keeps PTU', 'HR-bot and the coding assistant are unaffected.'],
      ['gw', 'ev', 'alert: budget 80%', 'A usage roll-up detects that the team reached 80% of its monthly budget and notifies its owners.', 'async']],
      end: 'Token quotas per team plus priority classes stop one noisy neighbour from starving everyone else.' },
    { name: 'Cache hit and chargeback', desc: 'A repeated question is served from the semantic cache; usage flows to chargeback.', steps: [
      ['apps', 'gw', '“How many vacation days?”', 'The HR bot (opted in to caching) sends a common question.'],
      ['gw', 'sc', 'similarity 0.97 in namespace', 'The namespace includes app, model alias and system-prompt hash, so answers never cross apps or prompt versions. Threshold 0.95.'],
      ['sc', 'gw', 'hit (8 ms)', 'No model call: ~1 s and ~$0.008 saved.', 'resp'],
      ['gw', 'apps', 'response, x-cache: hit', 'The app can show it as instant.', 'resp'],
      ['gw', 'ev', 'UsageRecord (cacheHit)', 'Cached responses are recorded at zero model cost so savings are visible.', 'async'],
      ['ev', 'red', 'redact prompt logs', 'Names, emails, IDs and card numbers are replaced with typed placeholders before storage.', 'async'],
      ['red', 'logs', 'store redacted', 'Only redacted text is kept, in the same region, for 30 days.'],
      ['ev', 'dw', 'hourly roll-up', 'Tokens × price per backend type, plus a share of provisioned cost by usage, become the monthly chargeback per cost centre.', 'async']],
      end: 'Caching saves money only if it is safely scoped; chargeback makes teams see and own their usage.' }
  ],
  components: [
    ['Gateway data plane', 'Auth, policy lookup, token counting, quota reserve and reconcile, routing, retries, circuit breakers, streaming passthrough (Envoy-based, APIM, or LiteLLM-style proxy).'],
    ['Policy and admin plane', 'Self-service onboarding for teams: keys/identities, quotas, budgets, model access, logging and safety levels; audited changes.'],
    ['Quota service', 'Distributed token buckets per team and alias in Redis, with local pre-allocation to keep latency low.'],
    ['Router', 'Alias &rarr; backend pools, priority classes, provisioned-first with spillover, health and latency aware, data-residency aware.'],
    ['Semantic cache', 'Embedding + vector lookup per app namespace with thresholds and TTLs.'],
    ['Safety hooks', 'Prompt shields, harmful-content filters, PII detection on input and streamed output.'],
    ['Usage and log pipeline', 'Usage records, redaction, storage, dashboards, budget alerts, chargeback and invoice reconciliation.']
  ],
  deep: [
    ['Token-based quotas', '<p>Request counts are meaningless for LLMs: one request can be 50 tokens or 100,000. Limit tokens per minute (TPM) per team and model alias, plus a monthly dollar budget. The catch: output tokens are unknown until the response ends. So <strong>reserve, then reconcile</strong>:</p><pre><code>def admit(team, alias, prompt_tokens, max_tokens):\n    est = prompt_tokens + min(max_tokens, p95_output[alias])\n    key = f"tpm:{team}:{alias}:{minute()}"\n    used = redis.incrby(key, est); redis.expire(key, 120)\n    if used &gt; quota(team, alias):\n        redis.decrby(key, est)\n        return reject(429, retry_after=seconds_to_next_minute())\n    return est\n\ndef on_complete(team, alias, est, usage):    # from the final stream chunk\n    redis.incrby(f"tpm:{team}:{alias}:{minute()}", usage.total - est)</code></pre><p>Count prompt tokens with the model’s tokenizer (tiktoken-style) in the gateway; ask the backend for usage in streams (e.g. stream_options include_usage). To avoid a Redis round trip per request at very high QPS, each instance can lease small blocks of quota (e.g. 5,000 tokens) and refill them. A sliding window or token bucket smooths minute boundaries.</p>'],
    ['Routing, spillover and failover', '<ul><li><strong>Provisioned first:</strong> reserved capacity (PTU on Azure, provisioned throughput on Bedrock) has a fixed hourly cost, so fill it before paying per token. When it returns 429, spill to a pay-as-you-go deployment of the same model version. Size reservations so utilisation stays high (70-90%) during the day.</li><li><strong>Priority classes:</strong> interactive traffic may use provisioned capacity; batch traffic goes to pay-as-you-go or the batch API (often ~50% cheaper, 24 h turnaround).</li><li><strong>Health:</strong> per-backend circuit breakers (open after N failures, half-open probes), honour retry-after, latency-weighted selection across equivalent deployments.</li><li><strong>Retries:</strong> only on 429/5xx/timeouts, only before the first streamed byte, with backoff and jitter and a total deadline; never retry 400s or content-filter blocks.</li><li><strong>Residency:</strong> each alias lists only regions the caller’s policy allows (e.g. EU data boundary); failover never crosses that boundary.</li><li><strong>Model routing:</strong> an alias like chat-auto can send short, simple prompts to a small model; validate that with evaluation before enabling it.</li></ul>'],
    ['Semantic caching', '<p>Embed the normalised last user message, search the app’s namespace and return the stored answer if similarity &ge; threshold (0.95 typical). Rules that make it safe:</p><ul><li>Namespace by app, model alias, system-prompt hash and (for RAG) permission scope and index version, otherwise users get answers meant for others.</li><li>Opt-in per app; never for personalised or tool-calling conversations, or when temperature-dependent creativity is the point.</li><li>Short TTLs (hours) and invalidation when the source content changes.</li><li>Measure false hits by sampling (an LLM judge compares cached answer and question).</li></ul><p>Exact-match caching (hash of the full prompt) is free and safe; provider <strong>prompt caching</strong> (reuse of a shared prefix inside the model server) is a different mechanism that discounts input tokens without returning stale answers. Use all three where they fit.</p>'],
    ['Logging, PII redaction and content safety', '<p>Prompt logs are among the most sensitive data in the company. Options per app: full redacted logs, metadata only, or no logging (for HR or legal apps). Redaction runs asynchronously on the stream: NER plus patterns for names, emails, phone numbers, IBANs and card numbers, replaced with typed placeholders; logs stay in-region with short retention and strict access.</p><p><strong>Guardrails:</strong> prompt shields detect direct jailbreaks and indirect injection in documents; harmful-content classifiers on input and output with per-app severity thresholds; optional PII blocking (not just logging) for apps that must never send personal data to a model; protected-material detection for code and text. Output scanning on streams works on a sliding window so tokens still flow, and the stream is cut if a violation is found. Centralising this in the gateway gives consistent policy and one place to update it (see <a href="../ai-foundations/index.html#safety">AI safety</a>).</p>'],
    ['Cost attribution and chargeback', '<p>Every UsageRecord carries team, app, alias, backend type and token counts (including cached tokens, which are cheaper). Cost model:</p><ul><li>Pay-as-you-go: tokens &times; list price per model (input, cached input, output).</li><li>Provisioned: monthly reservation cost shared by consumption (each team’s share of tokens served by the reservation), or a fixed allocation for teams that bought a slice.</li><li>Cache hits: zero model cost, reported as savings.</li></ul><p>Dashboards show spend per team per day, cost per request, cache savings and provisioned utilisation; alerts at 50/80/100% of budget; hard stops optional. Reconcile the monthly total against the provider invoice (target within 1%) to catch unmetered paths. Showing teams their cost per successful outcome is the single most effective cost optimisation (see <a href="../ai-foundations/index.html#cost">token maths</a>).</p>']
  ],
  scale: [
    '<strong>Connections, not CPU:</strong> thousands of long-lived streams; use async proxies (Envoy, Go, Node), HTTP/2 to backends, generous idle timeouts and connection draining on deploy.',
    '<strong>Quota store hot keys:</strong> a very busy team hammers one Redis key; use local quota leasing and shard keys by alias.',
    '<strong>Model capacity</strong> is the real ceiling: add deployments and regions to the backend pool, buy reservations for the base load, and push batch traffic to batch APIs.',
    '<strong>Log volume</strong> grows with prompts (RAG prompts are large): sample full logs for low-risk apps, keep metadata for all, compress and tier storage.',
    '<strong>Global footprint:</strong> run gateway stamps per geography (EU, US, APAC) so residency is structural; a global entry point routes callers to their stamp.'
  ],
  tradeoffs: [
    ['Build vs buy', 'APIM / Kong / cloud gateway vs open-source proxy (LiteLLM, Envoy AI Gateway) vs custom', 'Managed gateway with AI policies for most enterprises; open-source proxy when you need many providers and custom routing; custom only at very large scale.'],
    ['Quota accuracy vs latency', 'Central counter per request vs local leasing', 'Central Redis with Lua is accurate and adds ~1 ms; switch to leasing at very high QPS and accept ~1-2% over-admission.'],
    ['Inline vs async safety scanning', 'Block before the model vs scan in parallel and abort', 'Inline prompt shields for external-facing apps; parallel scan for internal low-risk apps to save ~50-100 ms.'],
    ['Provisioned vs pay-as-you-go', 'Reserved throughput vs per-token', 'Reserve the steady base where utilisation stays high, pay per token for peaks and spiky apps; revisit monthly with utilisation data.'],
    ['Semantic cache', 'Global vs per-app vs off', 'Per-app opt-in with strict namespaces; global caching across apps is a data-leak risk.']
  ],
  failures: [
    ['Gateway outage takes down all AI apps', 'Zone-redundant stateless instances, per-geography stamps, config cached in memory (static stability), canary deployments of policies.'],
    ['Redis quota store unavailable', 'Fail open with local per-instance limits (quota / instance count) for a short time, alert; never block all traffic.'],
    ['Backend 429 storm', 'Spillover, honour retry-after, circuit breakers, shed batch priority first.'],
    ['Region outage', 'Failover to another region in the same geography; capacity reserved or quota pre-approved there.'],
    ['Stream cut mid-response', 'Cannot transparently retry after tokens were sent: return a clear error event; client SDK retries the whole request with the same idempotency key.'],
    ['PII leaked into logs', 'Async redaction with tests on labelled samples, per-app no-log mode, short retention, access audit.'],
    ['Cost runaway by one app', 'TPM quotas, monthly budgets with hard stops, anomaly alerts on spend per hour.']
  ],
  evals: [
    ['Gateway overhead latency', 'Added p50/p95 time vs calling the backend directly (excluding safety scans)', 'p95 &le; 15 ms; measured with synthetic probes through and around the gateway'],
    ['Availability and failover success', 'Share of requests served despite backend 429/5xx', '&ge; 99.95% end to end; &ge; 99.9% of retryable failures recovered before first byte'],
    ['Quota accuracy', 'Admitted tokens vs configured TPM under load tests', 'Over-admission &le; 2%; false rejections &le; 0.5%'],
    ['Provisioned utilisation', 'Share of reserved capacity used in business hours', '70-90% (below wastes money, above means too much spillover latency)'],
    ['Semantic cache quality', 'Hit rate and false-hit rate (judge compares cached answer to new question)', 'Hit rate 5-15% on opted-in apps; false hits &le; 1%'],
    ['Safety filter performance', 'Block rate on red-team prompts; false-positive rate on normal traffic', 'Jailbreak/injection block &ge; 95%; false positives &le; 1%'],
    ['PII redaction recall', 'Labelled log sample with seeded personal data', '&ge; 98% recall on names, emails, IDs; 100% on card numbers'],
    ['Routing quality', 'Answer quality of chat-auto routed traffic vs always-large model', 'Judge score within 0.1 of the large model; &ge; 40% cost saving'],
    ['Cost attribution', 'Tokens attributed to a team; match with provider invoice', '100% attributed; within 1% of invoice']
  ],
  cloud: [['AI gateway', 'aigw'], ['API gateway core', 'apigw'], ['Foundation model deployments', 'llm'], ['Model platform / projects', 'aiplatform'], ['Self-hosted models behind the gateway', 'gpu'], ['Quota counters', 'cache'], ['Semantic cache', 'semcache'],
    ['Content safety / prompt shields', 'guardrails'], ['Usage and log stream', 'stream'], ['Log analytics', 'logs'], ['Usage warehouse / chargeback', 'warehouse'], ['Caller identity (managed identities)', 'workforce'], ['Keys and secrets', 'secrets'],
    ['Private connectivity to models', 'network'], ['Global entry', 'globallb'], ['Monitoring', 'monitor']],
  refs: { az: ['azGenGw', 'azGenGwMulti', 'azApimAi', 'azPtu', 'azp-gateway-routing', 'azp-gateway-offloading', 'azp-rate-limiting-pattern', 'azp-circuit-breaker'],
          aws: ['awsGenAiLens', 'awsApiRouting', 'awsCircuit', 'awsRetry', 'blShedding', 'blBackoff'] },
  questions: [
    ['Why limit tokens instead of requests?', 'Cost and model capacity are measured in tokens; one request can be 100 or 100,000 tokens. A request limit lets one app with huge prompts exhaust shared capacity. Limit TPM per team and model, plus a monthly budget, and keep a small request limit only as abuse protection.'],
    ['How do you enforce a token quota when output length is unknown?', 'Reserve an estimate (counted prompt tokens plus expected or capped output) atomically in a shared counter, reject with 429 if over, then reconcile with actual usage from the final response. Cap max_tokens per app so estimates are bounded.'],
    ['How do you fail over a streaming response?', 'Only before the first byte: if the backend returns 429/5xx or times out before streaming starts, retry another backend transparently. Once tokens have been sent, return an error event and let the client retry the whole request; partial responses cannot be stitched safely.'],
    ['When does provisioned throughput pay off?', 'When steady load keeps it highly utilised. Compare the reservation cost with what the same tokens would cost at pay-as-you-go; at 70%+ utilisation in business hours it usually wins and also gives predictable latency. Keep peaks and batch on pay-as-you-go.'],
    ['What are the risks of a semantic cache?', 'Wrong answers for questions that look similar but differ (“vacation days in France” vs “in Germany”), stale answers after content changes, and data leaks across users or apps. Mitigate with high thresholds, namespaces by app, prompt and permission scope, TTLs, opt-in, and measured false-hit rates.'],
    ['What do you log, and how do you protect it?', 'Always usage metadata; prompts and responses only per app policy, redacted asynchronously, in-region, with short retention and restricted access. Some apps opt out completely. Never log secrets; scan for them.']
  ],
  related: ['llm-serving', 'rate-limiter', 'rag-assistant', 'llmops', 'saas-platform']
});

SD.renderCase({
  slug: 'rate-limiter',
  summary: 'A rate limiter decides, in well under a millisecond, whether a request may proceed or must be rejected with 429 Too Many Requests. It protects services from overload and abuse, enforces fair use between tenants, and implements commercial quotas (&ldquo;1,000 calls per minute on the Pro plan&rdquo;). On one server it is a counter in memory; across hundreds of gateway instances and several regions the counters must be shared, updated atomically and kept off the critical path. This design runs the limiter inside the API gateway, keeps state in Redis updated by a single atomic Lua script, supports token bucket, leaky bucket, fixed window and sliding window algorithms keyed by user, IP or API key, returns standard headers, syncs global limits across regions asynchronously, and chooses deliberately between failing open and failing closed when Redis is unreachable.',
  examples: 'Stripe and GitHub API limits, Cloudflare and AWS WAF rate-based rules, Azure API Management rate-limit and quota policies, Amazon API Gateway usage plans, Envoy global rate limit service, OpenAI and Anthropic token-per-minute limits, login and OTP throttling everywhere.',
  functional: ['Limit requests per key (user id, API key, IP, tenant) per rule, e.g. 100 req/min per API key and 10 login attempts per 15 min per IP.', 'Support several algorithms per rule: token bucket (bursts), leaky bucket (smooth output), fixed window and sliding window.', 'Rejected requests get 429 with Retry-After and rate-limit headers; allowed ones get remaining-quota headers.', 'Rules are configurable at runtime (per plan, endpoint and method) without redeploying gateways.', 'Global limits hold across regions; usage is visible for analytics and billing.'],
  nonFunctional: ['Adds &lt; 1 ms p99 to each request.', 'Handles 500,000 decisions/s at peak across 3 regions.', 'Highly available: a limiter outage must not become an API outage (fail open for most routes).', 'Accurate within a few percent; brief overshoot during failures or cross-region sync is acceptable.', 'Memory proportional to active keys, not to request volume.'],
  outOfScope: ['Volumetric DDoS mitigation at the network layer (handled by the CDN / DDoS service).', 'Monthly billing quotas and invoicing (consumes the usage stream).'],
  estimates: [
    ['Peak API traffic', '500,000 req/s globally, ~200,000 req/s in the busiest region', '3 regions; traffic skewed to the largest market'],
    ['Active keys in a window', '~10 M (API keys, users, IPs)', 'Distinct callers seen in the last few minutes'],
    ['Rules evaluated per request', '~3 (per IP, per API key, per endpoint)', 'Combined into one Lua call per request'],
    ['State, token bucket / window counter', '~3 GB per region', '10 M keys &times; 3 rules &times; ~100 B (key name + 2 fields + overhead)'],
    ['State, sliding window log (for comparison)', '~64 GB+', '10 M keys &times; 100 req/min limit &times; ~64 B per sorted-set entry: why logs are kept only for low limits'],
    ['Redis calls per region', '~200,000 EVALSHA/s', 'One script per request covering all its rules'],
    ['Redis network traffic', '~40 MB/s per region', '200,000 &times; ~200 B request + reply'],
    ['Throttled requests', '1-2% normally, 30%+ during an attack', 'From production dashboards of public APIs']
  ],
  compute: [
    ['Limiter in the gateway', '+10-15 cores in the busiest region (spread over existing gateway pods)', '200,000 req/s &times; ~50 &micro;s (key building, rule match, script call, header writing) = 10 busy cores; at 70% utilisation ~15 cores.'],
    ['Redis cluster', '8 primaries + 8 replicas per region, 8 GB each', 'A small Lua script costs ~10-20 &micro;s; one shard sustains ~50,000-80,000 scripts/s. 200,000 / 50,000 = 4 shards; double for headroom and hot keys &rArr; 8. Memory (3 GB) is not the constraint.'],
    ['Rules service', '3 instances', 'Admin writes are rare; gateways poll or receive pushes every ~10 s and cache rules in memory.'],
    ['Global sync workers', '2 per region', 'Only keys with global rules are synced; ~100,000 deltas/s batched every 500 ms into a few hundred messages/s.'],
    ['Usage stream', '24 partitions per region', '~10,000 usage summaries/s (aggregated per key per 10 s) plus throttle events.']
  ],
  api: [
    ['Gateway → Redis: EVALSHA rl_check keys=[...] args=[now, cost, rules]', 'Internal: one atomic call that evaluates all matching rules and returns allowed, remaining and reset for the strictest rule.'],
    ['HTTP 429 Too Many Requests', 'Retry-After: 12 (seconds) plus RateLimit headers; body explains which limit was hit. Never 503, which clients treat as a server fault.'],
    ['RateLimit-Policy: "default";q=100;w=60 and RateLimit: "default";r=37;t=12', 'IETF httpapi draft header fields (quota, window, remaining, reset). Many APIs still send X-RateLimit-Limit / -Remaining / -Reset (GitHub style); send both during migration.'],
    ['PUT /admin/v1/rules/{id}', 'Create or update a rule: match (route, method, plan), keyBy (ip | apiKey | user | tenant), algorithm, limit, window, burst, action (reject | log-only).'],
    ['GET /admin/v1/usage?key=&window=', 'Current counters for support and customer dashboards.'],
    ['event rate_limit.throttled {key, rule, ts, region}', 'Published to the usage stream for analytics, abuse detection and alerting.']
  ],
  data: [
    ['token bucket state', 'Redis hash', 'Key <code>rl:{apikey:K9}:r12</code> &rarr; {tokens, ts}; TTL = time to refill to full (capacity / rate), so idle keys disappear.'],
    ['window counters', 'Redis string (INCR)', 'Key <code>rl:{ip:1.2.3.4}:r3:29384710</code> (window start); TTL 2 &times; window so the previous window is available for the sliding estimate.'],
    ['sliding window log', 'Redis sorted set', 'Score = timestamp, member = request id; ZREMRANGEBYSCORE then ZCARD. Exact, but one entry per request: use only for small limits (login attempts).'],
    ['rules', 'Relational or document store + in-memory copy in every gateway', 'id, version, match, keyBy, algorithm, limit, window, burst, scope (local | global), failMode (open | closed).'],
    ['global usage deltas', 'Stream between regions', '{key, rule, region, count, windowStart}; batched every 500 ms.'],
    ['usage and throttle events', 'Event stream &rarr; analytics store', 'Aggregated per key per 10 s; feeds dashboards, billing and abuse models.']
  ],
  dbChoice: [
    ['Live counters', 'Redis (cluster mode)', 'Sub-millisecond in-AZ latency, atomic single-threaded execution per shard, Lua scripts for read-modify-write in one round trip, native TTL so state expires with inactivity.', 'Memcached (no scripting, only INCR); DynamoDB atomic counters (5-10 ms, cost per write at 200,000/s is high); in-process only (no shared view across instances).'],
    ['Rules', 'Small relational DB, cached in the gateway', 'Low write rate, needs validation, versioning and audit; gateways must keep working if the store is down.', 'Static config files in the gateway image: simple, but every change needs a deploy.'],
    ['Usage history', 'Stream + columnar analytics store', 'High-volume append, queried by time and key for dashboards and billing.', 'Writing usage rows to the rules DB: turns a cold store into a hot one.']
  ],
  diagram: {
    nodes: [['u', 'API clients', 'client', 0, 1.4, 'apps, partners, bots'], ['edge', 'CDN + WAF', 'waf', 1, 1.4, 'coarse per-IP limits'], ['gw', 'API gateway', 'apigw', 2, 1.4, 'limiter middleware'],
      ['redis', 'Redis cluster', 'cache', 3, 0.3, 'counters + Lua'], ['api', 'Backend APIs', 'svc', 4, 1.4, 'protected services'], ['rules', 'Rules service', 'svc', 3, 2.6, 'admin API, push'],
      ['cfg', 'Rules store', 'db', 4, 3.3, 'versioned rules'], ['sync', 'Global sync', 'worker', 4.6, 0.3, 'cross-region deltas'], ['redis2', 'Region B Redis', 'cache', 6, 0.3, 'remote counters'],
      ['st', 'Usage stream', 'stream', 5.4, 2.4, 'Kafka / Event Hubs'], ['an', 'Usage analytics', 'dw', 6, 3.4, 'dashboards, billing']],
    edges: [['u', 'edge'], ['edge', 'gw'], ['gw', 'redis', 'EVALSHA'], ['gw', 'api'], ['rules', 'gw', 'push rules', 'async'], ['rules', 'cfg'], ['redis', 'sync', '', 'async'], ['sync', 'redis2', 'deltas', 'async'],
      ['gw', 'st', 'usage', 'async'], ['st', 'an', '', 'async']],
    zones: [['Region B', 6, 0.3, 6, 0.3]]
  },
  flows: [
    { name: 'Allowed request', desc: 'The common case: one atomic Redis call, then the request continues with quota headers.', steps: [
      ['u', 'edge', 'GET /v1/orders (API key)', 'The edge applies only coarse per-IP rules (e.g. 2,000 req/5 min) to stop floods before they cost anything.'],
      ['edge', 'gw', 'forward', 'Requests that pass reach a regional gateway instance.'],
      ['gw', 'redis', 'EVALSHA rl_check (3 keys)', 'The gateway matches 3 rules (IP, API key, endpoint) from its in-memory rule set and sends all keys, which share the hash tag {apikey:K9} so they live on one Redis shard.'],
      ['redis', 'gw', 'allowed, r=37, t=12', 'The Lua script refills each token bucket, deducts the cost and returns the strictest remaining value, atomically, in ~0.3 ms.', 'resp'],
      ['gw', 'api', 'forward request', 'Only allowed requests reach the backend.'],
      ['api', 'gw', '200 OK', 'The backend responds normally.', 'resp'],
      ['gw', 'u', '200 + RateLimit: r=37;t=12', 'Headers tell well-behaved clients how much quota is left so they can pace themselves.', 'resp'],
      ['gw', 'st', 'usage summary (10 s)', 'Usage is aggregated in memory and published every 10 s, never per request.', 'async']],
      end: 'One round trip to an in-zone Redis shard keeps the added latency well under a millisecond.' },
    { name: 'Throttled request (429)', desc: 'A client exceeds its limit and is rejected before touching the backend.', steps: [
      ['u', 'edge', 'burst of 300 req in 10 s', 'A misbehaving script hammers an expensive export endpoint, which has a 10 req/min rule on top of the 100 req/min plan.'],
      ['edge', 'gw', 'forward', 'Still under the coarse edge limit.'],
      ['gw', 'redis', 'EVALSHA rl_check', 'Same atomic check.'],
      ['redis', 'gw', 'denied, tokens=0.4', 'The bucket is empty; the script does not deduct anything for a rejected request.', 'err'],
      ['gw', 'u', '429 + Retry-After: 4', 'Retry-After is when one token will exist again. The strictest matching rule refills at 10/min (0.1667 tokens/s): (1 − 0.4) / 0.1667 ≈ 3.6 s, rounded up to 4. Rejection costs microseconds, not a backend call.', 'err'],
      ['gw', 'st', 'throttled event', 'Repeated throttling feeds abuse detection; a key that ignores 429s for minutes can be blocked at the edge.', 'async'],
      ['st', 'an', 'dashboards, alerts', 'Customers see why they were throttled; operators see if a limit is too strict.', 'async']],
      end: 'Rejecting early and cheaply is the whole point: the backend never sees the excess load.' },
    { name: 'Change a rule at runtime', desc: 'An operator raises the limit for an enterprise tenant without a deploy.', steps: [
      ['rules', 'cfg', 'UPDATE rule r12 v43', 'The rules service validates the rule (no limit of 0 on /health, no duplicate match) and stores a new version with an audit record.'],
      ['cfg', 'rules', 'committed', 'Versioned so a bad change can be rolled back instantly.', 'resp'],
      ['rules', 'gw', 'push rules v43', 'Gateways receive the new rule set (push, or poll every 10 s as a fallback) and swap it atomically in memory.', 'async'],
      ['gw', 'redis', 'EVALSHA with new limit', 'Limits are passed as script arguments, so existing bucket state carries over: no reset, no thundering herd of newly allowed requests.'],
      ['redis', 'gw', 'allowed', 'The tenant immediately gets the higher capacity.', 'resp']],
      end: 'Rules live in configuration, not code; state in Redis is keyed by rule id so changing a limit does not wipe counters.' },
    { name: 'Global limit across regions', desc: 'A tenant has a global cap of 10,000 req/s spread over 3 regions.', steps: [
      ['gw', 'redis', 'check local + remote sum', 'The script compares local count + last known counts from other regions against the global limit. No cross-region call on the request path.'],
      ['redis', 'gw', 'allowed', 'Decision in ~0.3 ms using slightly stale remote counts.', 'resp'],
      ['redis', 'sync', 'local deltas every 500 ms', 'The sync worker reads per-key local deltas for global rules (keyspace scan of a dirty set, or the gateway publishes them).', 'async'],
      ['sync', 'redis2', 'apply remote counts', 'Each region stores the others’ counts under remote keys. Overshoot is bounded by rate × sync interval × (regions − 1).', 'async'],
      ['redis2', 'sync', 'region B deltas', 'Region B does the same in the other direction.', 'async'],
      ['sync', 'redis', 'update remote:B counts', 'Within ~1 s every region converges on the global total.', 'async']],
      end: 'Local decisions with asynchronous global sync trade a small, bounded overshoot for zero cross-region latency.' },
    { name: 'Redis unavailable (fail open)', desc: 'The Redis shard for a key times out. Most routes fail open; sensitive routes fail closed.', steps: [
      ['u', 'gw', 'POST /v1/orders', 'A normal request arrives.'],
      ['gw', 'redis', 'EVALSHA (timeout 5 ms)', 'The limiter uses a strict timeout and a circuit breaker so a sick Redis cannot add latency to every request.'],
      ['redis', 'gw', 'timeout', 'The shard is failing over (replica promotion takes a few seconds).', 'err'],
      ['gw', 'api', 'fail open + local limit', 'Rule failMode=open: the gateway falls back to an in-memory token bucket sized limit ÷ number of gateway instances, so a single client still cannot flood the backend.'],
      ['u', 'gw', 'POST /v1/login', 'A login request during the same outage.'],
      ['gw', 'u', '503 (fail closed)', 'Rule failMode=closed for login, OTP SMS and payments: allowing unlimited attempts there would enable credential stuffing or SMS cost fraud.', 'err']],
      end: 'Decide the failure mode per rule: availability for ordinary APIs, safety for abuse-sensitive ones, and a local fallback either way.' }
  ],
  components: [
    ['CDN / WAF rate rules', 'Coarse per-IP and per-path limits at the edge; stops floods before they reach the gateway.'],
    ['Limiter middleware (in the gateway)', 'Builds keys from the request (API key, user, IP, tenant), matches rules, calls Redis, writes headers, returns 429.'],
    ['Redis cluster', 'Shared counters; Lua scripts for atomic check-and-update; TTLs reclaim idle keys; replicas for failover.'],
    ['Rules service + store', 'Versioned rule configuration with validation, audit and push to gateways.'],
    ['Global sync', 'Exchanges per-key usage deltas between regions for globally scoped limits.'],
    ['Local fallback limiter', 'In-memory token buckets per gateway instance used when Redis is unreachable.'],
    ['Usage stream + analytics', 'Usage and throttle events for dashboards, billing and abuse detection.']
  ],
  deep: [
    ['The algorithms, with the maths', '<table><tr><th>Algorithm</th><th>State per key</th><th>Rule</th><th>Behaviour</th></tr>' +
      '<tr><td><strong>Token bucket</strong></td><td>tokens, last refill ts</td><td>tokens = min(capacity, tokens + (now &minus; ts) &times; rate); allow if tokens &ge; cost, then tokens &minus;= cost</td><td>Allows bursts up to capacity, long-run average = rate. Example: rate 100/min (1.667/s), capacity 20: an idle client may send 20 at once, then 1.667/s. Used by AWS, Stripe.</td></tr>' +
      '<tr><td><strong>Leaky bucket</strong></td><td>queue length (or &ldquo;water level&rdquo;), ts</td><td>level = max(0, level &minus; (now &minus; ts) &times; rate); allow if level + 1 &le; capacity</td><td>Output leaves at a constant rate; smooths bursts. As a meter it is equivalent to a token bucket; as a queue it adds delay instead of rejecting (used by NGINX <code>limit_req</code> with <code>burst</code>).</td></tr>' +
      '<tr><td><strong>Fixed window counter</strong></td><td>1 integer per window</td><td>INCR key:floor(now / W); allow if count &le; limit</td><td>Cheapest. Boundary problem: 100 requests at 0:59 and 100 at 1:00 = 200 in two seconds, 2&times; the limit.</td></tr>' +
      '<tr><td><strong>Sliding window log</strong></td><td>timestamp of every request</td><td>drop entries older than now &minus; W; allow if count &lt; limit</td><td>Exact, but memory O(limit) per key. Fine for &ldquo;5 login attempts per 15 min&rdquo;, not for 10,000/min.</td></tr>' +
      '<tr><td><strong>Sliding window counter</strong></td><td>current and previous window counts</td><td>estimate = curr + prev &times; (W &minus; elapsed) / W</td><td>Example: limit 100/min, prev minute 80, current 30, 15 s in: 30 + 80 &times; 45/60 = 90 &le; 100 &rArr; allow. Two integers per key; Cloudflare measured ~0.003% wrong decisions on real traffic.</td></tr></table>' +
      '<p>Default choice: token bucket for API quotas (bursts are friendly to clients), sliding window counter when you want &ldquo;N per window&rdquo; semantics, sliding log for small security limits.</p>'],
    ['Atomic token bucket in Redis with Lua', '<p>A read-then-write from the gateway (GET, compute, SET) races: two gateways read 1 token and both allow. A Lua script runs atomically on the shard and costs one round trip. Using Redis <code>TIME</code> inside the script avoids skew between gateway clocks.</p>' +
      '<pre><code>-- KEYS[1] = bucket key; ARGV: rate (tokens/s), capacity, cost\n' +
      'local rate, cap, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])\n' +
      'local t = redis.call("TIME")\n' +
      'local now = t[1] * 1000 + math.floor(t[2] / 1000)        -- ms\n' +
      'local b = redis.call("HMGET", KEYS[1], "tokens", "ts")\n' +
      'local tokens = tonumber(b[1]) or cap\n' +
      'local ts = tonumber(b[2]) or now\n' +
      'tokens = math.min(cap, tokens + (now - ts) / 1000 * rate)\n' +
      'local allowed = 0\n' +
      'if tokens &gt;= cost then tokens = tokens - cost; allowed = 1 end\n' +
      'redis.call("HSET", KEYS[1], "tokens", tokens, "ts", now)\n' +
      'redis.call("PEXPIRE", KEYS[1], math.ceil(cap / rate * 1000))\n' +
      'local wait = allowed == 1 and 0 or math.ceil((cost - tokens) / rate)\n' +
      'return {allowed, math.floor(tokens), wait}</code></pre>' +
      '<p>Load it once with <code>SCRIPT LOAD</code> and call <code>EVALSHA</code> (or use Redis 7 <code>FUNCTION</code>). In Redis Cluster all keys of one script must hash to the same slot: wrap the shared part in a hash tag, e.g. <code>rl:{apikey:K9}:r12</code>. The sliding-window-counter version is even simpler: <code>INCR</code> the current window key, <code>GET</code> the previous one, compute the weighted estimate, and decrement (or skip the INCR) if denied.</p>'],
    ['Where to put the limiter', '<ul><li><strong>Edge (CDN/WAF):</strong> coarse per-IP rules; cheapest place to drop floods, but knows nothing about API keys or plans.</li><li><strong>API gateway (chosen):</strong> one place that sees every request with the authenticated identity; Envoy/Kong/APIM/API Gateway all have rate-limit filters, and Envoy can call a global rate-limit service over gRPC.</li><li><strong>Sidecar / service mesh:</strong> per-service limits close to the code; good for protecting internal services from each other.</li><li><strong>In the service:</strong> only for business limits that need domain data (e.g. &ldquo;3 password resets per account per day&rdquo;).</li></ul><p>Layer them: edge for volume, gateway for identity-based quotas, service for business rules. Also apply concurrency limits (max in-flight requests) and load shedding in services: a rate limit protects from clients, not from slow dependencies.</p>'],
    ['Choosing the key and the rule set', '<ul><li><strong>Per API key / user:</strong> fair use and plans; needs authentication first, so it runs after auth in the gateway.</li><li><strong>Per IP:</strong> anonymous endpoints and login; beware NAT and mobile carriers sharing one IP (use /64 for IPv6, and higher limits or captchas rather than hard blocks).</li><li><strong>Per tenant:</strong> caps a whole organisation so one customer cannot starve others (noisy neighbour).</li><li><strong>Per endpoint cost:</strong> weight expensive calls (search = 5 tokens, GET = 1), the same idea as tokens-per-minute in LLM APIs.</li></ul><p>A request is allowed only if every matching rule allows it; evaluate all in one script and return the strictest remaining value in the headers.</p>'],
    ['Multi-region and failure modes', '<p>Options for a limit that must hold globally:</p><ol><li><strong>Split the budget:</strong> each of N regions enforces limit / N. Simple; unfair if traffic is uneven (fix with periodic rebalancing based on observed share).</li><li><strong>Local + asynchronous sync (chosen):</strong> decide locally using local count + last known remote counts; exchange deltas every ~500 ms. Overshoot &le; rate &times; interval &times; (N &minus; 1).</li><li><strong>Single global store:</strong> exact but adds 50-150 ms cross-region latency to every request; only for very low-rate, high-value limits.</li></ol><p><strong>Fail open vs fail closed:</strong> if Redis is unreachable, failing closed turns a cache outage into a full API outage. Fail open with a local in-memory limiter for ordinary routes; fail closed for routes where unlimited access is itself the attack (login, OTP, gift-card redemption, expensive AI calls). Make the mode a per-rule setting and alert on every fallback.</p>']
  ],
  scale: [
    '<strong>Redis throughput:</strong> one script per request, not one per rule; shard by hash tag so load spreads; add primaries as traffic grows.',
    '<strong>Hot keys:</strong> one giant tenant or an attacking IP concentrates on one shard. Pre-filter at the edge, and for very large tenants use a local token bucket per gateway that leases batches of tokens from Redis (e.g. 100 at a time), cutting Redis calls 100&times;.',
    '<strong>Memory:</strong> token buckets and window counters are O(active keys); TTLs equal to refill time reclaim idle keys automatically. Avoid sliding logs for high limits.',
    '<strong>Latency:</strong> keep Redis in the same zone as gateways, pipeline calls, use connection pools and a 5 ms timeout with a circuit breaker.',
    '<strong>Global limits:</strong> sync only keys with global scope, batch deltas, and accept bounded overshoot.'
  ],
  tradeoffs: [
    ['Algorithm', 'Token bucket vs fixed window vs sliding window counter vs log', 'Token bucket for quotas (allows bursts, two fields); sliding window counter when users expect &ldquo;N per minute&rdquo;; log only for small security limits.'],
    ['Where state lives', 'Per-instance memory vs shared Redis vs database', 'Shared Redis: consistent view across hundreds of gateways at sub-ms latency; local memory only as fallback or for leased tokens.'],
    ['Accuracy vs latency (multi-region)', 'Synchronous global counter vs local + async sync', 'Local + async: no cross-region hop; overshoot bounded by sync interval.'],
    ['Failure mode', 'Fail open vs fail closed', 'Per rule: open (with local fallback) for normal APIs, closed for login, OTP and payments.'],
    ['Reject vs queue', '429 immediately vs delay (leaky bucket queue)', 'Reject for APIs (clients retry with backoff); queue only for internal batch traffic where latency does not matter.']
  ],
  failures: [
    ['Redis shard down or slow', '5 ms timeout + circuit breaker; replica promotion in seconds; fall back to local per-instance buckets (fail open) or 503 for fail-closed rules.'],
    ['Race conditions between gateways', 'All read-modify-write logic in one Lua script, executed atomically on the shard.'],
    ['Clock skew between gateways', 'Use Redis TIME inside the script, not the caller’s clock.'],
    ['Clients retry immediately after 429 (retry storm)', 'Retry-After header, documented exponential backoff with jitter, and escalating blocks at the edge for keys that ignore 429s.'],
    ['Bad rule deployed (limit 0 on a hot path)', 'Validation, staged rollout with log-only mode first, versioned rules with one-click rollback.'],
    ['Cross-region sync lagging', 'Regions keep enforcing with stale remote counts; overshoot grows slowly; alert on sync lag; fall back to limit / N split if lag exceeds a threshold.']
  ],
  cloud: [['Edge rate rules and WAF', 'waf'], ['CDN / global entry', 'cdn'], ['DDoS protection', 'ddos'], ['API gateway with rate-limit policies', 'apigw'], ['Self-hosted gateway (Envoy) cluster', 'k8s'], ['Counter store', 'cache'], ['Rules store', 'sql'],
    ['Rules distribution', 'Azure App Configuration', 'AWS AppConfig'], ['Usage stream', 'stream'], ['Usage aggregation', 'streamproc'], ['Usage analytics and billing', 'warehouse'], ['Global traffic routing', 'globallb'], ['Monitoring and alerts', 'monitor'], ['Secrets (API keys)', 'secrets']],
  refs: { az: ['azp-rate-limiting-pattern', 'azp-throttling', 'azp-gateway-offloading', 'azp-external-configuration-store', 'azp-circuit-breaker', 'azApi', 'azMission'],
          aws: ['blShedding', 'blFallback', 'blBackoff', 'awsWafAuto', 'blShuffle', 'awsApiRouting', 'awsCircuit'] },
  questions: [
    ['Why not just use a fixed window counter?', 'It allows up to 2&times; the limit across a window boundary (100 at 0:59, 100 at 1:00). The sliding window counter fixes this with one extra integer: weight the previous window by the fraction still inside the sliding window.'],
    ['How do you make the check atomic across many gateway instances?', 'Run the whole read-refill-decide-write sequence as a Lua script (or Redis function) on the shard that owns the key. Redis executes scripts one at a time, so there is no race, and it is a single round trip.'],
    ['What do you return to a throttled client?', '429 Too Many Requests with Retry-After (seconds until a token is available) and rate-limit headers (quota, remaining, reset). Successful responses also carry remaining quota so clients can pace themselves before they are throttled.'],
    ['How do you rate-limit across regions?', 'Prefer local decisions with asynchronous exchange of usage deltas (bounded overshoot), or split the budget per region. A synchronous global counter adds cross-region latency to every request and is reserved for very low-rate, high-value limits.'],
    ['What happens if Redis goes down?', 'Fail open with a local in-memory limiter for ordinary endpoints so the API stays up; fail closed for abuse-sensitive endpoints (login, OTP, payments). Use timeouts and a circuit breaker so the limiter never adds more than a few ms.'],
    ['How would you limit LLM usage by tokens rather than requests?', 'Use the same token bucket with a variable cost: deduct an estimated token count before the call, then reconcile with the actual usage reported in the response. See the <a href="../llm-gateway/index.html">LLM gateway</a> design.']
  ],
  related: ['llm-gateway', 'url-shortener', 'distributed-cache', 'saas-platform', 'reliability']
});

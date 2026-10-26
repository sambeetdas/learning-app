SD.renderCase({
  slug: 'typeahead',
  summary: 'Typeahead (search autocomplete) shows the most likely completions while the user types, so it must answer each keystroke in a few tens of milliseconds, far faster than a full search. The trick is to do almost no work at request time: an offline pipeline aggregates billions of past queries into scored phrases, builds a trie in which every node already stores its top-k completions, and ships immutable snapshots to in-memory servers; a streaming path adds trending queries within minutes; browsers debounce keystrokes and cache prefixes, and the CDN caches popular prefixes for everyone. On top come per-user personalisation (recent searches), sharding by prefix range when the trie outgrows one machine, and a safety layer that keeps offensive, defamatory or manipulated suggestions out.',
  examples: 'Google and Bing search suggestions, Amazon product search, YouTube, LinkedIn people and job typeahead, Spotify, Booking.com destination autocomplete, IDE and address-bar completion; Elasticsearch / OpenSearch completion suggester and Algolia offer it as a service.',
  functional: ['Return up to 8-10 completions for a typed prefix, ranked by popularity and freshness.', 'Support many languages and locales; tolerate case and accents (simple normalisation).', 'Show trending queries within minutes of a news event.', 'Personalise for signed-in users: their recent searches first.', 'Never show offensive, hateful, sexual or defamatory suggestions; support legal removals.'],
  nonFunctional: ['p99 server latency &lt; 20 ms; keystroke-to-paint &lt; 100 ms.', 'Peak ~175,000 suggestion requests/s globally.', 'Highly available; stale suggestions are acceptable, missing ones are not catastrophic (the search box still works).', 'Daily rebuild of the main trie; trending updates within ~5 minutes.', 'Cost-efficient: most requests served by caches.'],
  outOfScope: ['Spelling correction and full search ranking (see web search engine).', 'Semantic / vector suggestions (see semantic search).'],
  estimates: [
    ['Searches per day', '1 B', '100 M DAU &times; 10 searches'],
    ['Suggestion requests', '5 B/day &asymp; 58,000/s average, ~175,000/s peak', '~15 characters per query, 100 ms debounce &rArr; ~5 requests per search; peak 3&times;'],
    ['Origin QPS', '~90,000/s peak', '~50% of requests (mostly 1-3 character prefixes) answered by browser or CDN caches'],
    ['Distinct phrases in the trie', '~100 M per major locale', 'Queries seen by &ge; N distinct users in 30 days (long tail and private queries excluded)'],
    ['Trie memory', '~25 GB per locale replica', '~200 M radix-trie nodes &times; ~100 B (children + top-10 as 4-byte phrase ids) + ~3 GB phrase table'],
    ['Query logs', '~100 GB/day, ~3 TB per 30-day window', '1 B &times; ~100 B (query, locale, region, hashed user, ts)'],
    ['Trending stream', '~12,000 events/s average', '1 B searches / 86,400 s; peaks 3&times;'],
    ['Response size', '~1 KB', '8 suggestions with highlighting metadata, gzip']
  ],
  compute: [
    ['Suggest service', '~57 instances of 4 vCPU across 3 regions at peak', '90,000 req/s &times; ~1 ms CPU (trie call, merge personal, filter, serialise) = 90 busy cores &rArr; 150 at 60% &rArr; 38 instances; &times;1.5 to survive a zone loss = 57.'],
    ['Trie servers', '4 prefix shards &times; 3 replicas per region, 16 GB RAM each', 'Lookup is ~0.1 ms (walk prefix, read stored top-k): 90,000 &times; 0.1 ms = 9 cores. Memory drives sizing: 25 GB split into 4 shards of ~6-7 GB, with room to load the next snapshot beside the current one.'],
    ['Personal history store', 'Redis cluster, 3 shards per region', '~30% of requests from signed-in users &asymp; 27,000 reads/s; last 50 queries per user &times; 200 M users &times; ~2 KB = ~400 GB, so only active users stay in Redis (TTL 30 days); the rest live in a key-value store.'],
    ['Batch aggregation (Spark)', '~50 executors for ~1 hour per day', '3 TB of 30-day logs &rarr; group by normalised query &rarr; decayed scores; builder writes ~25 GB of trie snapshots per locale.'],
    ['Trending (Flink)', '~8 task slots', '~36,000 events/s at peak; 5-minute sliding windows per locale and region; anomaly score vs baseline.'],
    ['CDN', 'Existing edge', '~85,000 req/s at peak; short prefixes give a very high hit ratio with a 5-15 minute TTL.']
  ],
  api: [
    ['GET /v1/suggest?q=appl&lang=en-GB&limit=8', 'Generic suggestions; Cache-Control: public, max-age=300 so CDN and browser cache by (normalised prefix, locale, region).'],
    ['GET /v1/suggest/personal?q=appl (auth)', 'Signed-in extras (recent searches); Cache-Control: private. Kept separate so the generic response stays cacheable.'],
    ['POST /v1/events/suggest {prefix, shown[], selected, position}', 'Impression and selection logging for ranking and quality metrics.'],
    ['gRPC Trie.TopK(prefix, k, locale) → [(phraseId, text, score)]', 'Internal call to the trie shard that owns the prefix range.'],
    ['PUT /admin/v1/blocklist {pattern, scope, reason}', 'Add a blocked term or pattern; takes effect at serve time within a minute and at the next build.'],
    ['DELETE /v1/users/me/search-history', 'User clears personal history (privacy requirement).']
  ],
  data: [
    ['query log event', 'Event stream &rarr; data lake (Parquet)', '{query, normalised, locale, region, user_hash, ts, source}; 30-day window for aggregation; PII scrubbed.'],
    ['phrase scores', 'Data lake / warehouse table', '(locale, phrase) &rarr; decayed score = &Sigma; count<sub>day</sub> &times; e<sup>&minus;age/7d</sup>, distinct users, safety flags.'],
    ['trie snapshot', 'Object storage, immutable and versioned', '<code>tries/en-GB/2026-10-26/shard-2.bin</code>; compact array-based radix trie with top-k phrase ids at every node.'],
    ['trending deltas', 'Redis sorted set per locale/region', '<code>trend:en-GB</code> score = burst score; TTL 6 h; merged into results at serve time.'],
    ['user history', 'Redis (hot) + key-value store', 'user_id &rarr; last 50 queries with timestamps; deletable on request.'],
    ['blocklist and policy', 'Relational + compiled automaton in memory', 'Patterns, scope (global/locale), reason, legal case id; compiled into an Aho-Corasick matcher in each suggest instance.']
  ],
  dbChoice: [
    ['Serving structure', 'Custom in-memory trie with precomputed top-k per node', 'Lookup cost is O(length of prefix), independent of how many phrases match; immutable snapshots are easy to replicate, swap and roll back.', 'Elasticsearch/OpenSearch completion suggester (FST-based): excellent up to tens of millions of phrases, less control over ranking and memory. Redis sorted set per prefix: simple but stores each phrase under every prefix (~20&times; memory).'],
    ['Aggregation', 'Batch (Spark) over a data lake + streaming (Flink) for trends', 'Daily batch is cheap and robust for long-term popularity; streaming catches bursts within minutes. Classic lambda-style split.', 'Updating the live trie on every query: write contention and no chance to filter or review.'],
    ['Personal history', 'Redis + key-value store', 'Single-key reads per request; TTLs; easy deletion.', 'Storing personal data in the shared trie: impossible to cache and a privacy risk.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'client', 0, 1.2, 'debounced keystrokes'], ['cdn', 'CDN edge', 'cdn', 1, 1.2, 'caches prefixes'], ['gw', 'API gateway', 'apigw', 2, 1.2],
      ['blk', 'Safety filter', 'cache', 3, 0, 'blocklist + classifier'], ['sug', 'Suggest service', 'svc', 3, 1.2, 'merge, filter, rank'], ['trie', 'Trie servers', 'cache', 5, 0.2, 'top-k per node'],
      ['pers', 'User history', 'cache', 4, 1.5, 'recent searches'], ['logs', 'Query log stream', 'stream', 3, 2.8, 'searches + selections'], ['trend', 'Trending (Flink)', 'worker', 5, 2.0, '5-min windows'],
      ['batch', 'Batch aggregation', 'job', 5, 3.4, 'Spark, daily'], ['build', 'Trie builder', 'job', 6, 2.4, 'top-k, filter'], ['snap', 'Trie snapshots', 'blob', 6, 1.2, 'versioned files']],
    edges: [['u', 'cdn'], ['cdn', 'gw'], ['gw', 'sug'], ['sug', 'blk'], ['sug', 'trie', 'TopK'], ['sug', 'pers'], ['sug', 'logs', '', 'async'], ['logs', 'trend', '', 'async'], ['logs', 'batch', '', 'async'],
      ['trend', 'trie', 'trending', 'async'], ['batch', 'build'], ['build', 'snap'], ['snap', 'trie', 'load', 'async']]
  },
  flows: [
    { name: 'Typing “apple”', desc: 'Most keystrokes never reach the origin; the ones that do are a single in-memory lookup.', steps: [
      ['u', 'cdn', 'GET suggest?q=a', 'The browser waits ~100 ms after each keystroke (debounce) and cancels stale in-flight requests. “a” is a hot prefix: the CDN has it cached.'],
      ['cdn', 'u', 'top 8 for “a” (edge hit)', 'Served from the nearest edge in ~10 ms; the browser also keeps it in memory for backspacing.', 'resp'],
      ['u', 'cdn', 'GET suggest?q=appl', 'The user typed “ppl” quickly: debounce turned three keystrokes into one request.'],
      ['cdn', 'gw', 'edge miss', 'Longer prefixes are less likely to be cached at this edge.'],
      ['gw', 'sug', 'route', 'Any suggest instance in the nearest region.'],
      ['sug', 'trie', 'TopK("appl", 10)', 'The shard owning the range “ap”–“az” walks 4 nodes and returns the 10 phrase ids already stored at that node: no subtree search.'],
      ['trie', 'sug', 'apple, apple watch, …', 'Precomputed, scored by decayed popularity; ~0.1 ms.', 'resp'],
      ['sug', 'blk', 'filter', 'Serve-time safety check against the latest blocklist (an emergency removal does not wait for tomorrow’s build).'],
      ['sug', 'u', '200, max-age=300', 'Cacheable response: the CDN keeps it for the next user typing “appl” in this region.', 'resp']],
      end: 'Debounce, browser cache and CDN remove about half the requests; the rest cost one in-memory lookup.' },
    { name: 'Personalised suggestions', desc: 'A signed-in user sees their own recent searches above popular ones, without breaking cacheability.', steps: [
      ['u', 'cdn', 'GET suggest?q=ber', 'The generic list comes from the CDN as usual.'],
      ['u', 'gw', 'GET suggest/personal?q=ber', 'In parallel, a small private request (Cache-Control: private) for this user’s matches.'],
      ['gw', 'sug', 'auth ok, user 42', 'The gateway validates the session token.'],
      ['sug', 'pers', 'recent queries of user 42', 'Last 50 searches from Redis; prefix-matched in memory: “berlin flights”, “bert paper”.'],
      ['pers', 'sug', '2 matches', 'Recent searches score higher than global popularity for this user.', 'resp'],
      ['sug', 'u', 'personal list', 'The client merges: personal matches first (marked with a clock icon), then generic ones, deduplicated.', 'resp']],
      end: 'Split generic (cacheable, shared) and personal (small, private) results, and merge on the client.' },
    { name: 'Daily offline build', desc: 'Billions of logged queries become a new trie snapshot every night.', steps: [
      ['logs', 'batch', '30 days of query logs', 'Spark reads Parquet partitions from the data lake.', 'async'],
      ['batch', 'build', 'scored phrases', 'Normalise (case, whitespace, accents), drop phrases seen by fewer than N distinct users (privacy and noise), score with exponential decay (7-day half-life-like), apply safety classifiers.'],
      ['build', 'snap', 'write shard files', 'Build the radix trie bottom-up: each node keeps the top-10 of its children’s lists merged with its own phrase. Write per-shard binary files with a manifest and checksum.'],
      ['snap', 'trie', 'load v2026-10-26', 'Each trie server loads the new snapshot beside the old one, runs canary queries, then atomically swaps the pointer.', 'async'],
      ['trie', 'sug', 'serving new version', 'Rollback is a pointer swap back to yesterday’s snapshot.', 'resp']],
      end: 'Building offline keeps serving simple and fast, and every version can be tested and rolled back.' },
    { name: 'Breaking news (trending)', desc: 'A major event happens at 14:00; suggestions reflect it by ~14:05 without waiting for the nightly build.', steps: [
      ['logs', 'trend', 'query events', 'Flink counts distinct users per normalised query in 5-minute sliding windows per locale and region, and computes a burst score against each phrase’s baseline (z-score or ratio vs last week): “earthquake lisbon” jumps from 0 to 40,000 users.', 'async'],
      ['trend', 'blk', 'safety review', 'Trending is the favourite manipulation vector: count distinct users not raw queries, drop bot traffic, and run the classifier; sensitive topics may need human approval.'],
      ['trend', 'trie', 'push trending deltas', 'Trending phrases with their prefixes are pushed to an overlay in each trie server (or a Redis sorted set) with a TTL of a few hours.', 'async'],
      ['sug', 'trie', 'TopK("earth")', 'At serve time the static top-k and the trending overlay are merged by score.'],
      ['sug', 'u', 'earthquake lisbon', 'The CDN TTL for short prefixes caps how long older lists stay visible (5 minutes).', 'resp']],
      end: 'Streaming adds freshness on top of the batch trie; safety checks matter most on this path.' },
    { name: 'Failures: shard down, bad suggestion', desc: 'A trie replica dies, and an offensive suggestion slips through.', steps: [
      ['sug', 'trie', 'TopK (replica 1)', 'The replica for shard “ap”–“az” does not answer within 5 ms.', 'err'],
      ['sug', 'trie', 'hedged retry: replica 2', 'A hedged request to another replica returns in time; the dead replica is removed by health checks and replaced from the snapshot in minutes.'],
      ['trie', 'sug', 'results', 'If every replica failed, the service would return an empty list: the search box still works.', 'resp'],
      ['u', 'gw', 'report suggestion', 'A user reports an offensive completion about a named person.', 'err'],
      ['gw', 'blk', 'blocklist update', 'Trust and safety adds the pattern; suggest instances reload the compiled matcher within a minute.'],
      ['blk', 'cdn', 'purge prefixes', 'Affected prefixes are purged from the CDN so cached copies disappear immediately, and the next build removes the phrase from the trie.', 'err']],
      end: 'Degrade to fewer or no suggestions rather than slow ones; remove bad suggestions from every cache layer.' }
  ],
  components: [
    ['Browser client', 'Debounce (~100 ms), cancel stale requests, cache prefixes in memory, merge personal and generic results, keyboard navigation.'],
    ['CDN', 'Caches generic responses by normalised prefix, locale and region with a short TTL.'],
    ['Suggest service', 'Routes to the right trie shard, merges trending and personal results, applies safety filtering, logs impressions.'],
    ['Trie servers', 'Immutable in-memory tries with top-k per node, loaded from snapshots, sharded by prefix range.'],
    ['Aggregation pipeline', 'Batch (Spark) for decayed popularity; streaming (Flink) for trends; builder produces snapshots.'],
    ['Safety filter', 'Blocklist automaton, ML classifiers for toxicity and PII, legal removals, anti-manipulation checks.'],
    ['User history store', 'Recent searches per signed-in user, with deletion controls.']
  ],
  deep: [
    ['Trie with top-k per node', '<p>A plain trie answers &ldquo;all phrases starting with appl&rdquo; by walking to the node and searching its subtree, which can hold millions of phrases. Instead, store at <strong>every node the top-k completions</strong> of its subtree (k = 10, as 4-byte phrase ids). A lookup is then O(prefix length) plus reading k ids.</p><ul><li>Build bottom-up: a node&rsquo;s list = top-k of (its own phrase if any, plus its children&rsquo;s lists): a k-way merge per node.</li><li>Use a <strong>radix (compressed) trie</strong> stored in flat arrays (node offsets, edge labels in one byte array) rather than pointer-heavy objects: several times less memory and cache-friendly.</li><li>Limit depth: prefixes longer than ~30 characters are rare; fall back to search there.</li><li>Alternative with the same idea: a hash map from every prefix (up to length 20) to its top-k list. Simpler, but more memory.</li></ul>'],
    ['Scoring and aggregation', '<p>Score = &Sigma;<sub>days</sub> distinct_users<sub>d</sub> &times; e<sup>&minus;age<sub>d</sub>/&tau;</sup> with &tau; &asymp; 7-14 days, so last week matters more than last year. Count distinct users (via HyperLogLog sketches per phrase) rather than raw queries: one bot or one enthusiastic user cannot push a phrase up. Add a minimum-users threshold (e.g. &ge; 50 users in 30 days) so private queries (names, addresses) never become public suggestions. Selection feedback (users choosing position 3 over position 1) can train a small ranking model later; start with popularity.</p>'],
    ['Sharding by prefix and replication', '<p>If the whole trie fits in memory (25 GB here), the simplest design is <strong>full replicas</strong>, sharded only by locale. When it does not, shard by <strong>prefix range</strong>: a shard owns all prefixes in a range such as &ldquo;ap&rdquo;&ndash;&ldquo;az&rdquo;, so one lookup touches exactly one shard. Naive first-letter sharding is badly skewed (&ldquo;s&rdquo; and &ldquo;c&rdquo; dwarf &ldquo;x&rdquo; and &ldquo;q&rdquo;); compute range boundaries from the traffic and size histogram at build time and publish them in the manifest. Very short prefixes (1-2 chars) are hot everywhere: cache them in every suggest instance and at the CDN. Replicate each shard across zones and use hedged requests for tail latency.</p>'],
    ['Client and edge caching, debouncing', '<ul><li><strong>Debounce</strong> ~100 ms (or throttle to one request per 100 ms while typing fast) and cancel stale requests with <code>AbortController</code>; drop responses that arrive out of order.</li><li><strong>Browser cache:</strong> keep a map prefix &rarr; results for the session; backspacing is free. Prefetch the next likely prefix if bandwidth allows.</li><li><strong>CDN:</strong> cache key = normalised prefix + locale + region; TTL 5-15 min; very high hit rates for 1-3 character prefixes. Never cache personalised output at the edge.</li><li><strong>Service cache:</strong> an in-process LRU of the hottest few hundred thousand prefixes in each suggest instance.</li></ul>'],
    ['Keeping suggestions safe', '<p>Autocomplete puts words in the user&rsquo;s mouth, so publishers treat it as their own speech. Layers:</p><ol><li><strong>Build-time filtering:</strong> blocklists, toxicity and sexual-content classifiers, PII detectors (phone numbers, emails, addresses), and &ldquo;person name + crime&rdquo; patterns (defamation risk).</li><li><strong>Serve-time blocklist</strong> compiled into an Aho-Corasick automaton for instant emergency removals.</li><li><strong>Anti-manipulation:</strong> distinct users, bot filtering, anomaly checks on trending, and human review for sensitive trending topics (elections, tragedies).</li><li><strong>Legal removals</strong> (court orders, EU right-to-be-forgotten requests) tracked with case ids and applied per region.</li><li>Measure: report rate, policy-violation rate in sampled audits, and suggestion acceptance rate.</li></ol>']
  ],
  scale: [
    '<strong>Request volume:</strong> debounce, browser cache and CDN halve it; trie lookups are ~0.1 ms, so the suggest tier is the main cost and scales horizontally.',
    '<strong>Trie size:</strong> compact array-based radix tries, top-k stored as 4-byte ids, minimum-user thresholds that prune the long tail; shard by prefix range when one replica no longer fits.',
    '<strong>Hot prefixes:</strong> single-letter prefixes are requested constantly: in-process LRU and CDN caching keep them off trie shards.',
    '<strong>Freshness:</strong> daily batch rebuild plus a streaming trending overlay; increase build frequency (every few hours) before considering live updates.',
    '<strong>Global users:</strong> per-locale and per-region tries (suggestions for &ldquo;foot&rdquo; differ in London and New York), deployed in every region.'
  ],
  tradeoffs: [
    ['Precompute vs compute at request time', 'Top-k per node vs subtree search', 'Precompute: constant, tiny lookup cost; the price is memory and a rebuild to change rankings.'],
    ['Freshness', 'Live trie updates vs batch + trending overlay', 'Batch + overlay: simpler, reviewable, rollbackable; live updates are hard to make safe and consistent.'],
    ['Data structure', 'Custom trie vs Elasticsearch completion suggester vs Redis', 'Custom trie at very large scale; the completion suggester is the right buy for most products with up to tens of millions of phrases.'],
    ['Personalisation', 'Mixed into one response vs separate private call', 'Separate call merged on the client keeps the generic response cacheable at the CDN.'],
    ['Request rate', 'Every keystroke vs debounce', 'Debounce ~100 ms: users notice little delay, and load drops by ~3&times;.']
  ],
  failures: [
    ['Trie replica down', 'Health checks, hedged requests to another replica, reload from snapshot; worst case return an empty list.'],
    ['Bad snapshot (corrupt or bad ranking)', 'Checksums, canary queries and metrics before swap; keep previous snapshot loaded for instant rollback.'],
    ['Offensive or defamatory suggestion', 'Serve-time blocklist within a minute, CDN purge of affected prefixes, removal from the next build, audit trail.'],
    ['Trending manipulation by bots', 'Distinct-user counting, bot filtering, anomaly thresholds, human review for sensitive topics.'],
    ['Aggregation pipeline fails', 'Keep serving the last good snapshot (suggestions get a day staler); alert.'],
    ['Latency spike', 'Strict client and server timeouts; suggestions are optional, so drop rather than wait.']
  ],
  cloud: [['CDN and edge caching', 'cdn'], ['API gateway', 'apigw'], ['Suggest service', 'containers'], ['Trie servers (memory-heavy pods)', 'k8s'], ['User history and trending overlay', 'cache'], ['Personal history (cold)', 'nosql'], ['Query log stream', 'stream'],
    ['Trending detection', 'streamproc'], ['Batch aggregation', 'bigdata'], ['Data lake and trie snapshots', 'blob'], ['Managed alternative (completion suggester)', 'search'], ['Offensive-content classifier', 'guardrails'], ['Nightly build schedule', 'scheduler'], ['Monitoring', 'monitor']],
  refs: { az: ['azCdn', 'azCaching', 'azp-cache-aside', 'azBigData', 'azStreamAsa', 'azp-materialized-view', 'azPartition', 'azp-static-content-hosting'],
          aws: ['awsCaching', 'blCaching', 'awsAnalyticsLens', 'awsClickstream', 'awsDiagrams', 'blStatic'] },
  questions: [
    ['Why store top-k at every trie node?', 'So a lookup costs O(prefix length) instead of searching a subtree that may hold millions of phrases. The ranking work moves to the offline build, which runs once a day instead of 90,000 times per second.'],
    ['How do you keep suggestions fresh?', 'A nightly batch build for long-term popularity with time decay, plus a streaming job that detects bursts in 5-minute windows and pushes a trending overlay merged at serve time.'],
    ['How do you shard the trie?', 'By locale first; replicate the full trie if it fits in memory; otherwise by prefix ranges computed from traffic and size histograms (not by first letter, which is skewed), so each lookup hits one shard.'],
    ['How do you reduce load from every keystroke?', 'Debounce ~100 ms and cancel stale requests, cache results per prefix in the browser, cache generic responses at the CDN with a short TTL, and keep the hottest prefixes in process memory.'],
    ['How do you personalise without losing caching?', 'Serve the generic list from the CDN and make a small separate private call for the user&rsquo;s recent searches; merge on the client.'],
    ['How do you prevent offensive suggestions?', 'Filter at build time (classifiers, blocklists, PII, thresholds on distinct users), at serve time (instant blocklist), harden trending against manipulation, and purge caches on removal.']
  ],
  related: ['search-engine', 'semantic-search', 'distributed-cache', 'web-crawler', 'recommendation']
});

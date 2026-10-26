SD.renderCase({
  slug: 'web-crawler',
  summary: 'A web crawler starts from seed URLs, downloads pages, extracts their links and repeats, building the raw corpus behind search engines, archives, price monitors and, today, LLM training and retrieval datasets. At billions of pages the difficulty is not downloading but deciding what to fetch next and how politely: a URL frontier that orders work by priority while never hitting one host too often, honouring robots.txt, caching DNS, recognising URLs and pages already seen (Bloom filters for URLs, SimHash for near-duplicate content), escaping spider traps that generate infinite URLs, and recrawling pages at a rate that matches how often they change. This design uses a Mercator-style two-level frontier, distributed asynchronous fetchers, a parsing and dedup pipeline, WARC files in object storage and a metadata store that drives recrawl scheduling.',
  examples: 'Googlebot, Bingbot, Common Crawl (monthly crawls of ~2-3 B pages, used to train most LLMs), the Internet Archive&rsquo;s Heritrix, Apache Nutch and StormCrawler, GPTBot / ClaudeBot / PerplexityBot for AI datasets, SEO crawlers (Ahrefs, Semrush), price and job aggregators.',
  functional: ['Start from seeds and sitemaps; fetch HTML pages over HTTP(S); extract and normalise links; repeat.', 'Obey robots.txt (RFC 9309), per-host politeness limits and the nofollow/noindex conventions.', 'Skip URLs already crawled and pages that are exact or near duplicates.', 'Store raw pages and metadata for downstream indexing and analysis.', 'Recrawl pages based on importance and how often they change.'],
  nonFunctional: ['5 B pages per monthly cycle (~2,000 pages/s average, 4,000/s peak).', 'Polite: by default at most 1 request per second per host and never more than robots.txt allows.', 'Robust to malicious or broken servers: traps, huge files, slow responses, malformed HTML.', 'Horizontally scalable: add fetchers and parsers to go faster.', 'Restartable: a crash loses minutes of work, not the frontier.'],
  outOfScope: ['Building the search index and ranking (see web search engine).', 'Full JavaScript rendering of every page (a separate, much smaller headless-browser pool handles high-value JS-heavy sites).'],
  estimates: [
    ['Pages per cycle', '5 B per month', 'Target corpus size for a fresh index'],
    ['Fetch rate', '~1,930 pages/s average, ~4,000/s peak', '5 B / (30 &times; 86,400 s)'],
    ['Average page size', '~50 KB HTML, ~10 KB compressed', 'HTML only; images and video not fetched'],
    ['Download bandwidth', '~100 MB/s = 0.8 Gbit/s average, 1.6 Gbit/s peak', '2,000 &times; 50 KB'],
    ['Raw storage', '~50 TB per monthly cycle (compressed WARC)', '5 B &times; ~10 KB'],
    ['Links discovered', '~100,000 URLs/s to check', '~50 outlinks per page &times; 2,000 pages/s'],
    ['URL-seen Bloom filter', '~36 GB', '20 B URLs &times; 14.4 bits (0.1% false-positive rate, k = 10)'],
    ['Distinct hosts', '~200 M known, ~5-10 M active per cycle', 'Most hosts have few pages; a few have millions'],
    ['DNS lookups', '~200/s after caching', '~10% of fetches hit a host not in the local DNS cache']
  ],
  compute: [
    ['Fetchers', '10 nodes &times; 4 vCPU, spread over 2-3 regions', '2,000 pages/s &times; ~1-2 s average response time = ~4,000 connections in flight; ~400-500 per node with async I/O. CPU (TLS, decompression) ~5 ms per page = 10 cores. More nodes give more egress IPs.'],
    ['Parsers + dedup', '17 &times; 4 vCPU', '2,000 pages/s &times; ~20 ms (HTML parse, link extraction, canonicalisation, SimHash) = 40 busy cores &rArr; ~67 at 60% utilisation.'],
    ['URL-seen service', '4 shards &times; 16 GB RAM + replicas', '36 GB Bloom filter sharded by URL hash; 100,000 checks/s is ~25,000 per shard, trivial for in-memory bit tests.'],
    ['Frontier', '4-6 nodes with local SSD', '~10 B queued URLs &times; ~100 B = ~1 TB; disk-backed queues with in-memory heads per host.'],
    ['Metadata store', '8 Cassandra / Bigtable nodes', '20 B URL rows &times; ~200 B = 4 TB &times; RF 3 = 12 TB; ~10,000 writes/s (fetch results + new URLs).'],
    ['DNS resolver', '2-3 caching resolvers (Unbound)', 'A few hundred lookups/s; mainly there to avoid overloading public or cloud resolvers and to add prefetching.']
  ],
  api: [
    ['POST /v1/seeds {urls[], priority}', 'Add seeds or sitemaps (operator API).'],
    ['Frontier.next(fetcherId) → {url, host, ip, notBefore}', 'Internal: the next URL whose host is allowed to be fetched now.'],
    ['Frontier.add(urls[], priority, discoveredFrom)', 'Internal: enqueue new, deduplicated, canonical URLs.'],
    ['event page.fetched {urlHash, status, warcOffset, contentHash, simhash, outlinks}', 'Published for parsers, indexers and analytics.'],
    ['GET /v1/urls/{urlHash}', 'Crawl status, last fetch, next scheduled fetch (debugging and webmaster tools).'],
    ['PUT /v1/hosts/{host}/policy {maxRps, budget, blocked}', 'Operator override for a host (site owner asked us to slow down).']
  ],
  data: [
    ['URL frontier', 'Disk-backed queues (RocksDB / Kafka) per priority and per host', 'Front queues by priority; back queues one per host; heap of (nextAllowedTime, host).'],
    ['url metadata', 'Wide-column (Cassandra / Bigtable)', 'PK url_hash (64-bit of canonical URL); url, host, status, last_fetch, etag, last_modified, content_hash, simhash, change_rate, importance, next_fetch.'],
    ['seen-URL set', 'Sharded in-memory Bloom filter (RedisBloom or custom)', 'All canonical URLs ever enqueued; rebuilt from the metadata store if lost.'],
    ['SimHash index', 'In-memory tables (4 permutations &times; 16-bit blocks)', '64-bit fingerprints for near-duplicate lookup within Hamming distance 3.'],
    ['host info', 'Key-value + cache', 'host &rarr; robots.txt rules (fetched_at, TTL 24 h), IP list, crawl-delay, error rate, page budget, quality score.'],
    ['raw pages', 'Object storage (WARC files)', '~1 GB WARC files with request, response headers and body; metadata points to (file, offset, length).']
  ],
  dbChoice: [
    ['URL metadata', 'Wide-column store keyed by URL hash', 'Tens of billions of rows, simple key lookups and updates, scans by next_fetch partition for scheduling; scales linearly.', 'Relational: too many rows and writes for one cluster; sharded SQL possible but more work.'],
    ['Seen-URL check', 'Bloom filter in memory', '100,000 checks/s at sub-microsecond cost and 36 GB for 20 B URLs; a 0.1% false positive only means skipping a rare new URL.', 'Exact set (hash set or DB lookup): 20 B &times; 8-byte hashes = 160 GB+ RAM or a disk read per link.'],
    ['Raw pages', 'Object storage with WARC containers', 'Cheap, durable, append-only; the standard archive format; read sequentially by batch jobs.', 'One object per page: 5 B small objects per month cost far more in requests and metadata.'],
    ['Frontier', 'Custom disk-backed queues', 'Needs per-host queues and time-based release that generic message queues do not provide.', 'Kafka alone: great for the discovered-URL stream, but per-host politeness must be layered on top.']
  ],
  diagram: {
    nodes: [['seed', 'Seeds + sitemaps', 'job', 0, 1.4, 'operator input'], ['sch', 'Recrawl scheduler', 'job', 1, 0.1, 'change rate, priority'], ['fr', 'URL frontier', 'queue', 1, 1.4, 'priority + per host'],
      ['dns', 'DNS resolver', 'dns', 2, 0.1, 'local cache'], ['ft', 'Fetchers', 'worker', 2, 1.15, 'async HTTP'], ['web', 'Web servers', 'ext', 2, 2.8, 'the internet'],
      ['rob', 'robots.txt cache', 'cache', 3, 0.1, 'per host, 24 h'], ['ps', 'Parse + dedup', 'worker', 3, 1.4, 'links, SimHash'], ['cd', 'SimHash index', 'cache', 4, 0.1, 'near-duplicates'],
      ['ud', 'URL-seen filter', 'cache', 4, 2.8, 'Bloom filter'], ['blob', 'Page store', 'blob', 5, 1.4, 'WARC files'], ['meta', 'URL metadata', 'nosql', 5.2, 2.8, 'Cassandra / Bigtable'],
      ['st', 'Pages stream', 'stream', 6, 1.4, 'to indexers']],
    edges: [['seed', 'fr'], ['sch', 'fr', 'due URLs'], ['fr', 'ft'], ['ft', 'dns'], ['ft', 'rob'], ['ft', 'web'], ['ft', 'ps', 'raw page', 'async'], ['ps', 'cd'], ['ps', 'blob'], ['ps', 'ud', 'outlinks'],
      ['ud', 'fr', 'new URLs', 'async'], ['ps', 'meta'], ['blob', 'st', '', 'async']]
  },
  flows: [
    { name: 'Fetch and store a page', desc: 'One URL from frontier to stored page, politely.', steps: [
      ['fr', 'ft', 'next: example.com/a', 'The frontier hands out a URL only when its host’s back queue is due (nextAllowedTime ≤ now), so no host gets more than ~1 request/s.'],
      ['ft', 'rob', 'allowed? /a', 'robots.txt for example.com is cached (fetched within 24 h). /a is not disallowed for our user agent.'],
      ['ft', 'dns', 'resolve example.com', 'Cached: the crawler runs its own resolver because thousands of lookups per second would be throttled by shared resolvers.'],
      ['ft', 'web', 'GET /a (If-None-Match)', 'Conditional GET with the stored ETag; timeouts (10 s connect, 30 s total) and a 10 MB size cap protect fetchers from slow or huge responses.'],
      ['web', 'ft', '200 OK, 48 KB', 'The page changed since the last crawl.', 'resp'],
      ['ft', 'ps', 'raw page', 'Fetchers only download; parsing runs on a separate, independently scaled pool.', 'async'],
      ['ps', 'cd', 'SimHash lookup', 'A 64-bit SimHash of the visible text; no stored fingerprint within Hamming distance 3, so this is not a near-duplicate.'],
      ['ps', 'blob', 'append to WARC', 'Raw response goes into the current 1 GB WARC file; we keep (file, offset).'],
      ['ps', 'meta', 'update url row', 'Status, ETag, content hash, SimHash, and whether the content changed (used to estimate change rate).'],
      ['blob', 'st', 'page.fetched event', 'Indexers and other consumers read new pages from the stream.', 'async']],
      end: 'Politeness lives in the frontier, not in the fetcher; fetching, parsing and storage scale independently.' },
    { name: 'Discover links', desc: 'Outlinks are normalised, deduplicated and prioritised before entering the frontier.', steps: [
      ['ft', 'ps', 'page with 62 links', 'The parser extracts links. They are resolved to absolute URLs and canonicalised: lower-case host, remove fragments and default ports, strip tracking parameters (utm_*, sessionid), sort query parameters. rel=nofollow links are not followed.', 'async'],
      ['ps', 'ud', 'Bloom check ×62', 'Each canonical URL hash is tested against the seen-URL Bloom filter shard that owns it.'],
      ['ud', 'ps', '9 unseen', '53 were seen before (or are 0.1% false positives, which we accept).', 'resp'],
      ['ps', 'meta', 'insert 9 url rows', 'New rows with discoveredFrom and an initial importance estimate (host quality, link depth, anchor text).'],
      ['ud', 'fr', 'enqueue 9 (priority)', 'URLs go to a front queue by priority; a biased selector moves them to the back queue for their host. Bits are set in the Bloom filter at the same time.', 'async'],
      ['fr', 'ft', 'host queue becomes due', 'When the host’s next allowed time arrives, one of the new URLs is handed to a fetcher.']],
      end: 'Canonicalisation plus a Bloom filter cut ~85% of discovered links before they cost a fetch.' },
    { name: 'Recrawl with conditional GET', desc: 'Keeping the corpus fresh: important, fast-changing pages are revisited more often, and unchanged pages cost almost nothing.', steps: [
      ['sch', 'meta', 'scan next_fetch ≤ now', 'The scheduler scans partitions of the metadata store for URLs that are due.'],
      ['meta', 'sch', 'due URLs + change rates', 'A news home page changes hourly (λ ≈ 24/day); an old blog post changes yearly.', 'resp'],
      ['sch', 'fr', 'enqueue with priority', 'Priority ≈ importance × probability the page changed since the last crawl (1 − e^(−λt)).'],
      ['fr', 'ft', 'next URL', 'Same politeness rules apply to recrawls.'],
      ['ft', 'web', 'GET If-Modified-Since', 'Conditional request with Last-Modified and ETag from the last crawl.'],
      ['web', 'ft', '304 Not Modified', 'No body: the server and we save the bandwidth.', 'resp'],
      ['ft', 'meta', 'no change: lower λ', 'Unchanged result lowers the change-rate estimate and pushes next_fetch further out; a changed page shortens it.']],
      end: 'Adaptive revisit intervals put the crawl budget where change happens; 304s make checking cheap.' },
    { name: 'Spider trap and failing host', desc: 'Failure cases: an infinite calendar and a server that starts timing out.', steps: [
      ['fr', 'ft', 'shop.example/cal/2087/03', 'A calendar page links to the next month forever; URL depth and repeating patterns are growing.'],
      ['ft', 'ps', 'raw page', 'Fetched and parsed as usual.', 'async'],
      ['ps', 'ud', 'trap heuristics', 'Path depth > 12, URL length > 2,000, repeating segments (/a/b/a/b), or this host’s pages are 95% near-duplicates: links are dropped and the host’s page budget is cut.', 'err'],
      ['ft', 'web', 'GET bigsite.example/x', 'Another host begins answering 503 and timing out.'],
      ['web', 'ft', '503 / timeout', 'The host may be overloaded, possibly by us.', 'err'],
      ['ft', 'fr', 'back off host ×2', 'The host’s delay doubles (1 s, 2 s, 4 s … up to an hour) and honours Retry-After. After repeated failures its queue is paused and URLs are retried in the next cycle.', 'err'],
      ['ft', 'rob', 'robots.txt 5xx?', 'If robots.txt itself returns 5xx, RFC 9309 says to assume the whole site is disallowed until it can be fetched again.', 'err']],
      end: 'Per-host budgets, URL heuristics and adaptive backoff stop traps from eating the crawl and keep the crawler a good citizen.' }
  ],
  components: [
    ['Seeds and sitemaps', 'Initial URLs and sitemap.xml files (with lastmod hints) from operators and site owners.'],
    ['URL frontier', 'Front queues by priority, back queues per host, heap of next allowed fetch times; disk-backed.'],
    ['Fetchers', 'Asynchronous HTTP clients with timeouts, size limits, conditional GET, robots checks and DNS caching.'],
    ['robots.txt and host cache', 'Parsed rules per host with a 24 h TTL, crawl delay, error rates, budgets.'],
    ['Parse and dedup pipeline', 'HTML parsing, link extraction and canonicalisation, content hashing and SimHash, trap heuristics.'],
    ['URL-seen Bloom filter', 'Sharded probabilistic set of every enqueued canonical URL.'],
    ['Page store and metadata', 'WARC files in object storage; per-URL metadata driving recrawl scheduling.'],
    ['Recrawl scheduler', 'Estimates change rates and importance; enqueues due URLs.']
  ],
  deep: [
    ['The URL frontier: priority and politeness', '<p>The Mercator design (Heydon and Najork) splits the frontier into two levels:</p><ol><li><strong>Front queues</strong> (F of them, one per priority level). A prioritiser assigns each URL a level from importance (PageRank-like link score, host quality, depth) and freshness need.</li><li><strong>Back queues</strong> (B of them, each holding URLs of exactly one host). A biased selector pulls from high-priority front queues more often and routes each URL to its host&rsquo;s back queue.</li><li>A <strong>min-heap</strong> keyed by the next time each back queue may be fetched. A fetcher pops the earliest host, takes one URL, and after the fetch the host is re-inserted at <code>now + delay</code>, where delay is max(robots crawl-delay, ~1 s, k &times; last response time).</li></ol><p>Rule of thumb: B &asymp; 3 &times; the number of fetcher threads so fetchers rarely wait. Partition the frontier across nodes by host hash, so a host&rsquo;s politeness state lives in exactly one place.</p>'],
    ['Deduplication: Bloom filters for URLs, SimHash for content', '<p><strong>URLs.</strong> A Bloom filter with m bits and k hash functions answers &ldquo;definitely not seen&rdquo; or &ldquo;probably seen&rdquo;. For n items and false-positive rate p: m = &minus;n ln p / (ln 2)<sup>2</sup>, k = (m/n) ln 2. For n = 20 B and p = 0.001: 14.4 bits per URL = 36 GB, k = 10. A false positive skips a new URL, which is acceptable; a false negative is impossible. Canonicalise before hashing, or the filter is useless.</p>' +
      '<p><strong>Exact duplicates.</strong> A hash (e.g. SHA-1/xxHash) of normalised content finds mirrors and copies.</p>' +
      '<p><strong>Near duplicates.</strong> Pages that differ only in ads, dates or boilerplate defeat exact hashing. SimHash (Charikar) hashes each feature (shingles of words) to 64 bits, sums +w/&minus;w per bit position, and keeps the sign: similar documents get fingerprints with small Hamming distance. Google (Manku et al., 2007) used distance &le; 3 on 8 B pages. To search quickly, split the 64 bits into 4 blocks of 16: two fingerprints within distance 3 must agree exactly on at least one block, so keep 4 tables indexed by each block and compare only candidates.</p>'],
    ['robots.txt and politeness rules', '<ul><li>Fetch <code>/robots.txt</code> before crawling a host and cache it for up to 24 h (RFC 9309, 2022). Apply the most specific matching user-agent group and the longest matching Allow/Disallow rule.</li><li>4xx on robots.txt: treat as no restrictions. 5xx or unreachable: treat as full disallow until it can be fetched.</li><li><code>Crawl-delay</code> is non-standard (Bing honours it; Google does not) but respecting it is polite.</li><li>Identify yourself with a clear user agent and a URL explaining the crawler, publish your IP ranges, and give site owners a way to opt out (AI crawlers in particular are judged on this).</li><li>Limit per host and per IP (many hosts share one server): track both.</li><li>Back off on 429/503 and honour Retry-After.</li></ul>'],
    ['Spider traps and URL canonicalisation', '<p>Traps are URL spaces that never end: calendars, faceted search with every filter combination, session IDs in URLs, relative-link loops (/a/b/a/b/...), and deliberately malicious generators. Defences:</p><ul><li>Canonicalise aggressively: lower-case scheme and host, remove default ports and fragments, decode unnecessary percent-encoding, remove known tracking and session parameters, sort query parameters, honour <code>rel=canonical</code>.</li><li>Heuristics: maximum URL length (~2,000 chars) and path depth, repeated path segments, too many query parameters.</li><li>Per-host page budgets proportional to host quality; a new low-quality host gets a few hundred pages until it earns more.</li><li>Watch the near-duplicate ratio per host: if most new pages are near-duplicates, stop expanding that host.</li></ul>'],
    ['Recrawl scheduling and freshness', '<p>Model changes of each page as a Poisson process with rate &lambda;, estimated from history (changes observed / time, with care because we only see whether it changed between visits). The probability a page has changed t after the last crawl is 1 &minus; e<sup>&minus;&lambda;t</sup>. Schedule by importance &times; that probability, within the global budget and per-host politeness. Practical signals: sitemap <code>lastmod</code>, RSS/Atom feeds, IndexNow pings, HTTP <code>Last-Modified</code>/<code>ETag</code> (cheap 304s). Very fast-changing pages that are not important (a counter on a page) should not get a short interval: optimise freshness of what matters, not of everything.</p>']
  ],
  scale: [
    '<strong>Frontier partitioning:</strong> shard by host hash so each host&rsquo;s queue and politeness clock live on one node; rebalance with consistent hashing.',
    '<strong>Fetch throughput:</strong> asynchronous I/O (thousands of sockets per node), keep-alive connections per host, HTTP/2 where supported; add nodes and egress IPs across regions.',
    '<strong>DNS:</strong> local caching resolvers with prefetch; DNS is a classic hidden bottleneck at thousands of new hosts per second.',
    '<strong>Dedup memory:</strong> shard the Bloom filter; periodically rebuild per cycle; use a scalable/partitioned Bloom filter as the URL count grows.',
    '<strong>Storage and downstream:</strong> large WARC files, compression, and a stream of fetched-page events so indexers scale independently.',
    '<strong>Geographic distribution:</strong> place fetchers near the hosts they crawl (assign host shards by region) to cut latency and cross-continent bandwidth.'
  ],
  tradeoffs: [
    ['BFS vs priority crawl', 'Plain breadth-first vs importance-ordered', 'Priority (front queues): finds important pages early and spends budget where it matters; BFS is simple but wastes budget on low-value deep pages.'],
    ['URL dedup structure', 'Bloom filter vs exact set', 'Bloom filter: ~4&times; less memory; a 0.1% chance of skipping a new URL is acceptable.'],
    ['JavaScript rendering', 'Render everything in headless Chrome vs raw HTML', 'Raw HTML for the bulk; a small rendering pool for important JS-only sites (rendering costs 10-100&times; more CPU).'],
    ['Politeness vs speed', 'Aggressive per-host rates vs ~1 req/s', 'Polite by default, adaptive by response time and robots rules: being blocked costs far more than crawling slowly.'],
    ['Recrawl policy', 'Uniform vs proportional vs optimal', 'Importance-weighted, change-rate-aware intervals; uniform recrawl wastes budget on static pages.']
  ],
  failures: [
    ['Fetcher node crashes', 'URLs leased to it time out and return to the frontier; fetches are idempotent GETs, so retrying is safe.'],
    ['Frontier node lost', 'Disk-backed queues replicated or checkpointed; worst case rebuild from metadata (next_fetch) for its host shard.'],
    ['Spider trap', 'Canonicalisation, URL heuristics, per-host budgets, near-duplicate ratio monitoring.'],
    ['Host overloaded or blocking us', 'Exponential per-host backoff, honour Retry-After, robots.txt 5xx means disallow, operator kill switch per host.'],
    ['Malicious content (zip bombs, endless streams)', 'Size and time caps, decompression ratio limits, sandboxed parsers.'],
    ['Bloom filter lost', 'Rebuild from the metadata store; meanwhile the metadata store itself answers seen-checks (slower).'],
    ['DNS resolver failures', 'Multiple resolvers, cached answers served stale for a while, negative caching for NXDOMAIN.']
  ],
  cloud: [['Fetcher and parser fleet', 'k8s'], ['Burst fetch capacity', 'vms'], ['DNS resolution', 'Self-hosted Unbound on AKS', 'Route 53 Resolver / self-hosted Unbound'], ['URL frontier and new-URL stream', 'stream'], ['Recrawl work queues', 'queue'], ['Seen-URL Bloom filter', 'cache'],
    ['URL metadata', 'widecol'], ['Raw pages (WARC)', 'blob'], ['Link graph and importance (Spark)', 'bigdata'], ['Recrawl scheduling', 'scheduler'], ['Downstream search index', 'search'], ['Egress networking', 'network'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-priority-queue', 'azp-pipes-and-filters', 'azp-competing-consumers', 'azp-queue-based-load-leveling', 'azBigData', 'azp-throttling', 'azPartition'],
          aws: ['awsAnalyticsLens', 'blBacklog', 'blBackoff', 'awsDdbBest', 'awsPatterns', 'awsDiagrams'] },
  questions: [
    ['How do you stop the crawler from overloading a website?', 'Politeness is enforced in the frontier: one back queue per host and a heap of next allowed times, with delay = max(robots crawl-delay, ~1 s, a multiple of response time). Back off exponentially on 429/503, honour Retry-After, and limit per IP as well as per host.'],
    ['How do you know you have already seen a URL?', 'Canonicalise it, hash it, and test a sharded Bloom filter (36 GB for 20 B URLs at 0.1% false positives). False positives skip a few new URLs; there are no false negatives. The metadata store is the exact source of truth.'],
    ['How do you detect duplicate pages?', 'Exact duplicates by content hash; near-duplicates by 64-bit SimHash with Hamming distance &le; 3, searched with block-permuted tables.'],
    ['How would you crawl 5 B pages in a month?', '~2,000 pages/s: ~4,000 concurrent connections across ~10 async fetcher nodes, ~17 parser nodes, a sharded frontier, and ~50 TB of compressed WARC storage. The limit is politeness and DNS, not raw bandwidth (~1 Gbit/s).'],
    ['How do you decide when to recrawl a page?', 'Estimate each page&rsquo;s change rate from past crawls and combine it with importance; use sitemaps, feeds and IndexNow as hints, and conditional GETs so unchanged pages cost a 304.'],
    ['What about pages that need JavaScript?', 'Detect them (little text, heavy scripts, known frameworks) and send only important ones to a headless-browser rendering pool, which costs 10-100&times; more per page.']
  ],
  related: ['search-engine', 'message-queue', 'kv-store', 'job-scheduler', 'url-shortener']
});

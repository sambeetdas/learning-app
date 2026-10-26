SD.renderCase({
  slug: 'search-engine',
  summary: 'A web search engine is two machines joined by an index. The offline machine <strong>crawls</strong> the web (see the <a href="../web-crawler/index.html">web crawler</a>), parses and deduplicates pages, computes link-based quality signals such as <strong>PageRank</strong>, and builds an <strong>inverted index</strong>: for every term, a compressed <strong>posting list</strong> of the documents that contain it. The online machine answers ~100,000 queries a second in a few hundred milliseconds: the index is <strong>sharded by document</strong>, every query is <strong>scattered</strong> to one replica of each shard and the partial top-k lists are <strong>gathered</strong> and merged, then a ranking funnel narrows billions of candidates with <strong>BM25 + static quality</strong>, a <strong>learned ranking model</strong>, and finally a <strong>neural reranker</strong> on the top few dozen. Popular queries are served from a <strong>results cache</strong>, and separate <strong>freshness tiers</strong> let breaking news appear within minutes while the long tail is rebuilt in bulk.',
  examples: 'Google Search, Bing, Baidu, Yandex, Naver, DuckDuckGo (using Bing results plus its own), Brave Search (own index), Mojeek; Elasticsearch, OpenSearch and Vespa implement the same inverted-index and scatter-gather ideas for site and enterprise search.',
  functional: ['Accept a free-text query and return the 10 most relevant web pages with title, URL and a query-dependent snippet.', 'Handle spelling mistakes, synonyms and multiple languages; support operators (site:, quotes for phrases).', 'Reflect new and changed pages: breaking news within minutes, most of the web within days.', 'Crawl and index tens of billions of pages, removing duplicates and spam.', 'Paginate and filter (safe search, region, recency).'],
  nonFunctional: ['Query latency p50 ~200 ms, p99 under 1 s end to end.', 'Serve ~230,000 queries/s at peak with 99.99% availability; degrade by returning slightly fewer results, never errors.', 'Index tens of billions of documents at a sustainable hardware cost.', 'Freshness: news tier minutes, frequently changing pages hours, long tail days to weeks.', 'Relevance measured continuously (offline judgements and online A/B tests).'],
  outOfScope: ['Ads auction and serving.', 'Vertical search (images, video, maps, shopping) beyond a mention.', 'Answer generation with LLMs (see <a href="../rag-assistant/index.html">RAG assistant</a>).'],
  estimates: [
    ['Documents in the serving index', '50 B pages', 'After dedupe, spam and quality filtering of a much larger set of known URLs'],
    ['Recrawl volume', '5 B pages/day &rArr; ~58,000 fetches/s', '10% of the index refreshed daily; news pages far more often'],
    ['Crawl bandwidth', '~5.8 GB/s &asymp; 46 Gbit/s', '58,000/s &times; ~100 KB per HTML page'],
    ['Extracted text (doc store)', '50 B &times; 10 KB = 500 TB, ~125 TB compressed', 'Clean text for snippets, ~4:1 compression; &times;3 replicas'],
    ['Inverted index', '~25 T postings &times; ~4 B &asymp; 100 TB', '~500 unique terms per document; doc-id gaps, term frequencies and positions, compressed'],
    ['Queries', '10 B/day &rArr; ~116,000/s avg, ~230,000/s peak', 'Peak ~2&times; average'],
    ['Results cache hit rate', '~40% &rArr; ~140,000 q/s reach the index at peak', 'Head queries repeat a lot; the long tail never repeats'],
    ['Tier split', 'Tier 1: best 5 B docs (~10 TB); tier 2: 45 B docs (~90 TB)', '~80% of queries are fully answered by tier 1']
  ],
  compute: [
    ['Tier-1 leaf servers', '200 shards &times; 14 replicas &asymp; 2,800 nodes of 32 cores', '140,000 q/s &times; 200 shards = 28 M shard queries/s at ~2 ms each (block-max WAND, docs ordered by static rank). A node does ~10,000/s at 60% utilisation &rArr; 14 replicas per shard, spread over 3+ regions.'],
    ['Tier-2 leaf servers', '1,800 shards, ~7,900 nodes', '20% of queries = 28,000 q/s &times; 1,800 shards &times; ~3 ms = 151,000 busy cores &rArr; ~252,000 at 60%. Sending every query to all 2,000 shards would need ~3&times; more hardware: this is why tiering exists.'],
    ['Root / mixer + learned ranking', '~150 nodes of 32 cores', '140,000 q/s &times; ~20 ms CPU (merging ~1,000 candidates, GBDT over ~300 features) = 2,800 cores &rArr; ~4,700 at 60%.'],
    ['Neural reranker', '~1,000 GPUs', '140,000 q/s &times; top 50 documents = 7 M query-document pairs/s; a distilled cross-encoder does ~10,000 pairs/s per GPU &rArr; ~700 GPUs plus headroom.'],
    ['Indexing pipeline', '~60 nodes of 32 cores (plus batch PageRank)', '58,000 docs/s &times; ~20 ms (parse, boilerplate removal, dedupe, tokenise, features) = 1,160 cores &rArr; ~2,000 at 60%. PageRank over ~1 T links runs as a daily distributed batch job.']
  ],
  api: [
    ['GET /search?q=&hl=&gl=&start=&safe=', 'Public results page; the frontend normalises the query (case, whitespace, locale) to form the cache key.'],
    ['GET /complete?q=', 'Autocomplete suggestions from a separate prefix index (see <a href="../typeahead/index.html">typeahead</a>).'],
    ['gRPC Leaf.Search(QueryPlan{terms, phrases, filters, k})', 'Runs on one shard replica; returns top-k (doc_id, score, ranking features). Deadline propagated from the root.'],
    ['gRPC DocStore.Snippets(doc_ids, query_terms)', 'Builds query-dependent snippets and titles for the final 10 results.'],
    ['Event: PageFetched {url, content_hash, fetched_at, http_status}', 'Emitted by the crawler; consumed by the parse/index pipeline.'],
    ['Event: SegmentPublished {tier, shard, version}', 'Leaves download and swap in new immutable index segments without downtime.']
  ],
  data: [
    ['url / document table', 'Wide-column (Bigtable / HBase)', 'Row key = reversed host + path (com.example.www/a) so a site’s pages are contiguous; content hash, canonical URL, fetch times, PageRank, spam score, language.'],
    ['raw pages', 'Object storage (WARC files)', 'Partitioned by crawl date; immutable; reprocessed when parsers or features change.'],
    ['doc store', 'Key-value / wide-column, sharded like the index', 'doc_id &rarr; URL, title, compressed clean text, outlinks; used for snippets and cached pages.'],
    ['inverted index segment', 'Immutable files per shard (SSD + RAM)', 'Term dictionary (FST) &rarr; posting list of delta-encoded doc ids, term frequencies, positions; block-max scores for skipping; docs numbered by static rank.'],
    ['link graph', 'Columnar files / graph processing', '(src, dst, anchor text) edges; anchor text is indexed as a field of the target page.'],
    ['results cache', 'In-memory cache (Redis / memcached)', 'Key = normalised query + locale + safe-search + tier version; value = top 10 with snippets; TTL by freshness class.'],
    ['query and click logs', 'Data warehouse', 'Anonymised queries, results shown, clicks and dwell time: training data for learned ranking and spelling models.']
  ],
  dbChoice: [
    ['Inverted index', 'Custom immutable segments on local SSD/RAM', 'Query time is dominated by reading and intersecting posting lists; custom compression, skip structures and memory layout beat any general-purpose database by orders of magnitude.', 'Elasticsearch / OpenSearch (Lucene) use the same design and are right up to billions of documents; web scale needs custom serving and tiering.'],
    ['URL and document metadata', 'Wide-column store', 'Tens of billions of rows, updated by every crawl, scanned by site for batch jobs; reversed-host keys give locality per website.', 'Relational: cannot hold the volume or the scan workloads.'],
    ['Raw crawl data', 'Object storage', 'Petabytes written once, reprocessed in bulk; cheapest durable storage.', 'Keeping raw HTML in the wide-column store bloats compactions.'],
    ['Results cache', 'In-memory key-value', 'Microsecond lookups for the ~40% of queries that repeat; easy TTLs and invalidation by tier version.', 'CDN caching of full pages: personalisation and locale variants make hit rates low.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'client', 0, 0.9, 'browser / app'], ['fe', 'Query frontend', 'svc', 1, 0.9, 'spell, rewrite, plan'], ['rc', 'Results cache', 'cache', 1, 0, 'popular queries'],
      ['root', 'Root / mixer', 'svc', 2, 0.9, 'scatter-gather, LTR'], ['docs', 'Doc store', 'nosql', 2, 0, 'snippets, titles'], ['t1', 'Index tier 1', 'search', 3, 0, '200 shards, best 5 B'],
      ['t2', 'Index tier 2', 'search', 3, 0.9, '1,800 shards, 45 B'], ['fresh', 'Fresh index', 'search', 3, 1.8, 'minutes-old pages'], ['rr', 'Neural reranker', 'gpu', 2, 1.95, 'cross-encoder, top 50'],
      ['crawl', 'Crawler', 'svc', 0, 3, 'frontier, politeness'], ['raw', 'Raw page store', 'blob', 1, 3, 'WARC files'], ['parse', 'Parse + dedupe', 'job', 2, 3, 'extract, tokenise'],
      ['pr', 'Link graph', 'graph', 3, 3, 'PageRank, anchors'], ['build', 'Index builder', 'job', 4.5, 1.6, 'postings, compress']],
    edges: [['u', 'fe'], ['fe', 'rc'], ['fe', 'root'], ['root', 'docs'], ['root', 't1'], ['root', 't2'], ['root', 'fresh'], ['root', 'rr'],
      ['crawl', 'raw', '', 'async'], ['raw', 'parse', '', 'async'], ['parse', 'pr', 'links', 'async'], ['parse', 'build', 'docs', 'async'], ['pr', 'build', 'static rank', 'async'],
      ['build', 't1', 'segments', 'async'], ['build', 't2', '', 'async'], ['build', 'fresh', '', 'async']]
  },
  flows: [
    { name: 'Query (cache miss)', desc: '"best hiking boots for wide feet": not in the results cache, answered by tier 1.', steps: [
      ['u', 'fe', 'GET /search?q=best hiking...', 'The frontend normalises the query, detects language and locale, fixes spelling ("hikng" to "hiking") and expands synonyms (boots, footwear) into a query plan.'],
      ['fe', 'rc', 'GET normalised key', 'Popular queries are answered here in about a millisecond.'],
      ['rc', 'fe', 'miss', 'This one is not cached.', 'err'],
      ['fe', 'root', 'query plan, deadline 250 ms', 'The root receives the plan and a deadline that every downstream call inherits.'],
      { par: [['root', 't1', 'fan-out to 200 shards'], ['root', 'fresh', 'fresh tier']], msg: 'Scatter: one replica of each tier-1 shard plus the fresh index. Each leaf intersects posting lists, scores with BM25F plus static rank, and returns its local top 50.' },
      ['t1', 'root', '200 x top 50', 'Gather: the root merges ~10,000 candidates into a global top 1,000 and computes ~300 features for each.', 'resp'],
      ['root', 'rr', 'rerank top 50', 'A learned model (GBDT) orders the 1,000; a distilled cross-encoder then rescores the top 50 by reading query and passage together.'],
      ['rr', 'root', 'final order', 'About 20 ms on GPUs with batching.', 'resp'],
      ['root', 'docs', 'snippets for top 10', 'Query-dependent snippets highlight the passages that matched.'],
      ['root', 'fe', 'results page', 'The frontend stores the result in the cache (TTL by freshness class) and returns the page. Total ~200 ms.', 'resp']],
      end: 'Document-partitioned sharding means every query touches every shard of a tier, so the funnel (cheap scoring at leaves, expensive models on few documents at the root) is what keeps cost and latency bounded.' },
    { name: 'Tail query falls through to tier 2', desc: 'A rare query ("1987 Opel Kadett E gearbox seal part number") finds too few good results in tier 1.', steps: [
      ['fe', 'root', 'query plan', 'Long, specific queries are rarely cached.'],
      ['root', 't1', 'fan-out tier 1', 'Tier 1 holds the 5 B highest-quality pages, which answer most queries.'],
      ['t1', 'root', 'only 4 strong matches', 'The root sees that the result set is thin (few documents above the score threshold).', 'resp'],
      ['root', 't2', 'fan-out 1,800 shards', 'Only now does the query go to the long-tail tier, via a tree of aggregators so the root does not hold 1,800 connections per query.'],
      ['t2', 'root', 'top 50 per shard', 'Forum posts and parts catalogues deep in the web appear here.', 'resp'],
      ['root', 'rr', 'rerank merged set', 'Results from both tiers are merged and reranked together.'],
      ['root', 'fe', 'results', 'Slightly slower (~400 ms) but still within the deadline.', 'resp']],
      end: 'Tiering sends only the ~20% of queries that need it to the expensive long-tail index, cutting serving hardware by roughly 3x.' },
    { name: 'Crawl to index', desc: 'How a page becomes searchable in the base tiers.', steps: [
      ['crawl', 'raw', 'store fetched HTML', 'The crawler fetches pages politely (robots.txt, per-host rate limits) and writes them to WARC files with fetch metadata.', 'async'],
      ['raw', 'parse', 'PageFetched batch', 'Parsers extract text, title, headings, language and outlinks, strip boilerplate, and compute a SimHash for near-duplicate detection.', 'async'],
      ['parse', 'pr', 'outlinks + anchor text', 'Links feed the graph; anchor text becomes part of the target page’s indexed fields.', 'async'],
      ['pr', 'build', 'PageRank, spam scores', 'A daily batch computes PageRank-style quality and link-spam scores; they become the static rank that orders documents inside each shard.', 'async'],
      ['parse', 'build', 'tokens + doc features', 'Tokenised documents are inverted per shard (doc id hash mod shards), sorted, delta-encoded and compressed into immutable segments.', 'async'],
      ['build', 't2', 'publish segments', 'Leaves download new segments, warm them, and swap atomically; old segments are deleted after the switch.', 'async'],
      ['build', 't1', 'promote high-quality docs', 'Documents whose static rank crosses the threshold are placed in tier 1.', 'async']],
      end: 'The base index is rebuilt continuously in bulk from immutable inputs, which makes it reproducible: a bad parser can be fixed and everything reprocessed.' },
    { name: 'Breaking news freshness', desc: 'An earthquake happens; people search for it two minutes later.', steps: [
      ['crawl', 'raw', 'news sitemaps every minute', 'News sites, feeds and IndexNow-style pings are polled or pushed at high priority in a separate crawl lane.', 'async'],
      ['raw', 'parse', 'fast lane', 'The same parsing, but in a low-latency stream rather than a batch.', 'async'],
      ['parse', 'build', 'real-time indexer', 'Documents are indexed into small in-memory segments within seconds. Static rank uses the site’s history because PageRank for a new URL does not exist yet.', 'async'],
      ['build', 'fresh', 'append segment', 'The fresh tier holds only pages from the last day or so (~100 M docs), small enough for RAM and rapid updates.', 'async'],
      ['u', 'fe', 'GET /search?q=earthquake', 'The query classifier detects a news-seeking intent from a sudden spike in query volume.'],
      ['fe', 'root', 'plan with freshness boost', 'Recency becomes a strong ranking feature for this query; cache TTL is set to under a minute.'],
      ['root', 'fresh', 'query fresh tier', 'Results from the fresh tier are blended with tier 1 (background articles).'],
      ['root', 'fe', 'top stories + results', 'Articles published three minutes ago appear at the top.', 'resp']],
      end: 'Freshness is a tier, not a property of the whole index: a small, fast-changing index merged at query time beats rebuilding 100 TB.' },
    { name: 'Slow shard (tail latency)', desc: 'One of 200 leaf replicas hits a long garbage-collection pause.', steps: [
      ['root', 't1', 'fan-out to 200 shards', 'With 200 parallel calls, the slowest one decides the latency: if each is slow 1% of the time, 87% of queries would be slow.'],
      ['t1', 'root', 'shard 117 silent at p95', 'Shard 117’s replica has not answered after its usual p95 time (~15 ms).', 'err'],
      ['root', 't1', 'hedged request to replica B', 'The root sends the same request to a second replica of shard 117 and uses whichever answers first, cancelling the other.'],
      ['t1', 'root', 'replica B answers', 'The extra load is small (~5% of requests are hedged) and the p99 collapses.', 'resp'],
      ['root', 'fe', 'results within deadline', 'If a shard misses the deadline entirely, the root returns results without it: 199 of 200 shards is still an excellent page.', 'resp']],
      end: 'At fan-out scale, tail tolerance (hedged requests, deadlines, partial results, replicas) matters more than making any single server faster.' }
  ],
  components: [
    ['Crawler', 'URL frontier, politeness, recrawl scheduling by change rate and importance (see web crawler design).'],
    ['Parse + dedupe pipeline', 'Text extraction, boilerplate removal, language detection, SimHash near-duplicate clustering, canonicalisation, spam classification.'],
    ['Link graph + PageRank', 'Builds the link graph, anchor-text fields, PageRank-style quality and link-spam signals.'],
    ['Index builder', 'Inverts documents into compressed posting lists per shard and tier; publishes immutable segments.'],
    ['Leaf servers (tiers 1, 2, fresh)', 'Hold one shard each; intersect posting lists and score candidates with early termination.'],
    ['Root / mixer', 'Scatter-gather with deadlines and hedging, merge, learned ranking, blending of tiers and verticals.'],
    ['Neural reranker', 'Cross-encoder on GPUs for the top few dozen results.'],
    ['Query frontend + results cache', 'Normalisation, spelling, query rewriting and intent, caching of popular result pages.'],
    ['Doc store', 'Clean text and metadata for titles and snippets.']
  ],
  deep: [
    ['Inverted index and compression', '<p>For each term, a <strong>posting list</strong> holds the ids of documents containing it, with term frequency and positions (for phrase queries and proximity scoring).</p><pre><code>"boots"  -&gt; [ (12, tf=3, pos=[4,19,88]), (57, tf=1, ...), (1031, ...) ... ]\nstored as gaps:  12, 45, 974, ...   -&gt; varint / PForDelta blocks of 128</code></pre><ul><li><strong>Delta + integer compression:</strong> doc ids are sorted, so gaps are small numbers; block codecs (PForDelta, SIMD-BP128) decode billions of integers per second, and the index shrinks ~4-8&times;.</li><li><strong>Skip data and block-max:</strong> each block records its maximum possible score, so WAND / block-max WAND can skip whole blocks that cannot reach the current top-k.</li><li><strong>Static-rank ordering:</strong> doc ids are assigned by quality, so the best documents come first and a leaf can stop early once it has enough good results.</li><li><strong>Term dictionary</strong> as a finite-state transducer (FST) in RAM maps terms to posting offsets.</li><li><strong>Segments:</strong> immutable files merged in the background (like an LSM tree); deletions are tombstone bitmaps until the next merge.</li></ul>'],
    ['Sharding by document, scatter-gather and replicas', '<div class="table-wrap"><table><tr><th>Partitioning</th><th>How</th><th>Pros</th><th>Cons</th></tr><tr><td>By document</td><td>Each shard holds all terms for a subset of documents</td><td>Shards independent; adding docs is local; per-shard scoring is complete; failures lose a few docs, not whole terms</td><td>Every query hits every shard (fan-out)</td></tr><tr><td>By term</td><td>Each shard holds full posting lists for some terms</td><td>A query touches only shards of its terms</td><td>Huge lists for common terms, multi-term intersection across machines, hot shards</td></tr></table></div><p>Web engines partition <strong>by document</strong> and control fan-out with tiers and an aggregator tree. Each shard has many <strong>replicas</strong> (for QPS and availability); the root picks one replica per shard by load, sets a <strong>deadline</strong>, issues <strong>hedged requests</strong> after the p95 latency, and accepts <strong>partial results</strong> if a shard misses the deadline.</p>'],
    ['The ranking funnel', '<div class="table-wrap"><table><tr><th>Stage</th><th>Where</th><th>Candidates</th><th>Model</th></tr><tr><td>Retrieval</td><td>Leaves</td><td>billions &rarr; ~50 per shard</td><td>BM25F over title, body, anchors, URL + static rank (PageRank, spam, quality)</td></tr><tr><td>Learned ranking</td><td>Root</td><td>~1,000 &rarr; ~100</td><td>Gradient-boosted trees (LambdaMART) over ~300 features: text match, proximity, clicks, freshness, locale</td></tr><tr><td>Neural rerank</td><td>GPU pool</td><td>~50 &rarr; 10</td><td>Distilled cross-encoder (BERT-style) reading query and passage together</td></tr></table></div><p><strong>BM25</strong> scores a term by <code>IDF &times; tf &times; (k1 + 1) / (tf + k1 &times; (1 - b + b &times; len / avg_len))</code>, with k1 &asymp; 1.2 and b &asymp; 0.75: rare terms matter more, repeated terms saturate, long documents are normalised. <strong>PageRank</strong> treats links as votes weighted by the linker’s own rank (damping ~0.85), computed iteratively over the link graph. Models are trained on human relevance judgements and click logs, evaluated offline with NDCG and online with interleaving and A/B tests. Dense (embedding) retrieval is often added as a parallel candidate source for semantic matches.</p>'],
    ['Freshness tiers and index updates', '<ul><li><strong>Fresh tier</strong> (minutes): news, social and frequently pinged sites, indexed in a streaming path into in-memory segments; holds only recent documents.</li><li><strong>Daily tier</strong>: pages with high change rates or importance, rebuilt incrementally every few hours.</li><li><strong>Base tiers</strong>: the bulk of the web, rebuilt by batch pipelines over days, published as new segment versions per shard.</li><li>The root queries the relevant tiers and <strong>blends</strong> results; when a document appears in several tiers, the newest version wins.</li><li>Recrawl frequency per URL follows its observed change rate and importance (a Poisson change model), so crawl budget goes where freshness pays off.</li></ul>'],
    ['Caching and query processing', '<ul><li><strong>Results cache:</strong> the head of the query distribution is heavy (a few million queries make up a large share of traffic), so caching the top 10 for normalised queries serves ~40% of requests. TTL depends on the freshness class; entries are invalidated when a new tier version is published.</li><li><strong>Posting-list cache</strong> on leaves keeps hot terms in RAM; <strong>intersection cache</strong> stores results for frequent term pairs.</li><li><strong>Query understanding:</strong> spelling correction (noisy-channel model trained on query logs), synonyms and stemming, entity recognition, intent classification (news, navigational, local), and query rewriting into a plan with required and optional terms.</li><li><strong>Admission control:</strong> under overload, shed tier-2 fan-out first, then reduce rerank depth, before ever failing a query.</li></ul>']
  ],
  scale: [
    '<strong>More documents:</strong> add shards (each shard sized to fit its hot data in RAM/SSD); the aggregator tree keeps the root’s fan-out bounded.',
    '<strong>More queries:</strong> add replicas per shard and per region; results caching absorbs head-query growth for free.',
    '<strong>Tail latency:</strong> deadlines, hedged requests, partial results, and isolating background segment merges from query threads.',
    '<strong>Ranking cost:</strong> keep expensive models at the narrow end of the funnel; distil and quantise neural rerankers; batch on GPUs.',
    '<strong>Index build:</strong> embarrassingly parallel by shard; reproducible from raw pages, so full rebuilds can run in the background while serving the old version.',
    '<strong>Multi-region:</strong> full index replicas in several regions; route users to the nearest healthy region; publish segments to all regions with version pinning so results are consistent.'
  ],
  tradeoffs: [
    ['Index partitioning', 'By document vs by term', 'By document: independent shards, local updates, graceful degradation; the fan-out cost is managed with tiers and replicas.'],
    ['Single index vs tiers', 'One big index vs quality tiers + fresh tier', 'Tiers: most queries are answered from the best 10% of documents; only tail queries pay for the long tail; freshness gets its own fast path.'],
    ['Ranking depth', 'Neural rerank everything vs a funnel', 'Funnel: cheap lexical scoring over billions, learned models over ~1,000, neural over ~50; quality close to full neural at a fraction of the cost.'],
    ['Exactness vs latency', 'Wait for all shards vs deadline with partial results', 'Deadline plus hedging: missing one shard of 200 rarely changes the top 10, while waiting for stragglers hurts every user.'],
    ['Cache TTL', 'Long TTL (cheap) vs short TTL (fresh)', 'Per-query freshness class: navigational and evergreen queries cached long, news queries seconds to a minute.']
  ],
  failures: [
    ['Leaf replica slow or dead', 'Hedged requests to another replica, health-based replica selection, partial results after the deadline.'],
    ['Bad index build (parser bug drops pages)', 'Canary segments on a few replicas, automatic relevance and coverage checks before full rollout, instant rollback to the previous segment version.'],
    ['Query spike (major event)', 'Results cache with short TTL for the hot queries, shed tier-2 fan-out and rerank depth, autoscale stateless tiers.'],
    ['Crawler blocked or overloaded sites', 'Politeness limits, backoff on errors, crawl-budget reallocation; serving continues from the existing index.'],
    ['Spam / SEO attack', 'Link-spam and content-quality classifiers in the pipeline, manual actions, demotion via static rank.'],
    ['Region outage', 'Global load balancing routes to other regions holding full replicas; capacity planned for N-1 regions.']
  ],
  cloud: [['Global entry and load balancing', 'globallb'], ['Query frontend and root tiers', 'k8s'], ['Leaf servers with local NVMe', 'vms'], ['Managed search (smaller scale)', 'search'], ['Results cache', 'cache'], ['URL and document metadata', 'widecol'], ['Raw pages and segments', 'blob'], ['Crawl and index event stream', 'stream'], ['Parsing and index builds (Spark)', 'bigdata'], ['Link graph and PageRank', 'graph'], ['Learned ranking models', 'ml'], ['Neural rerank on GPUs', 'gpu'], ['Query and click logs', 'warehouse'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-sharding', 'azp-cache-aside', 'azp-pipes-and-filters', 'azp-materialized-view', 'azBigData', 'azBigCompute', 'azPartition'],
          aws: ['awsScatter', 'blShedding', 'blCaching', 'awsAnalyticsLens', 'blBackoff', 'awsMlLens'] },
  questions: [
    ['Why shard by document rather than by term?', 'Document sharding makes each shard a complete mini search engine: updates are local, scoring needs no cross-shard intersection, and losing a shard loses a few documents rather than every result for some terms. The cost is fan-out to all shards, which tiers, aggregator trees and replicas make affordable.'],
    ['How does BM25 work, and why is it not enough?', 'BM25 rewards query terms that are rare across the corpus (IDF), appear often in the document (with saturation via k1) and in shorter documents (length normalisation via b). It knows nothing about quality, authority, freshness, intent or semantics, so it is the retrieval stage of a funnel that adds PageRank, learned ranking and neural rerankers.'],
    ['How do you keep p99 latency low with a fan-out of hundreds of shards?', 'Set deadlines, send hedged requests to another replica after the p95 latency, accept partial results, keep hot data in RAM, and isolate background work (merges, segment loads) from query threads. Tail tolerance is more effective than making each server faster.'],
    ['How do you make new pages searchable in minutes?', 'A separate fresh tier fed by a high-priority crawl lane and a streaming indexer writes small in-memory segments; the root queries it alongside the base tiers and blends results, boosting recency for news-seeking queries.'],
    ['How are posting lists compressed?', 'Doc ids are sorted and stored as gaps, which are small integers, then packed with block codecs such as PForDelta or SIMD bit-packing in blocks of 128 with skip and block-max metadata. This saves 4-8&times; space and is faster to decode than reading uncompressed data from memory.'],
    ['How would you evaluate a ranking change?', 'Offline: NDCG@10 on human-judged query sets and regression suites for important queries. Online: interleaving experiments and A/B tests measuring clicks, long dwell time, reformulation and abandonment, with guardrails on latency and spam.']
  ],
  related: ['web-crawler', 'typeahead', 'semantic-search', 'distributed-cache', 'rag-assistant']
});

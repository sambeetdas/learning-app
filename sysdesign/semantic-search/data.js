SD.renderCase({
  slug: 'semantic-search',
  summary: 'Semantic search finds results by meaning, not just matching words: “waterproof boots for hiking” should find “Gore-Tex trekking shoes”, in any language. This design powers product search for a large multi-country marketplace (and the same architecture serves enterprise document search). Products are embedded with a multilingual embedding model and stored in an <strong>approximate nearest neighbour (ANN)</strong> index (HNSW, IVF-PQ or DiskANN, sized with explicit memory maths) inside a search engine that also keeps a classic <strong>BM25</strong> inverted index. Each query runs keyword and vector retrieval in parallel with filters (category, stock, market, customer entitlements), fuses them with <strong>reciprocal rank fusion</strong>, and reranks the top candidates with a learning-to-rank model and, for hard queries, a cross-encoder. Updates stream in from the catalogue within seconds. Relevance is managed like a product: graded judgements and <strong>nDCG / MRR</strong> offline, A/B tests and interleaving online. Retrieval metrics are explained on the <a href="../ai-evaluation/index.html#retrieval">AI evaluation page</a>.',
  examples: 'Amazon, eBay, Zalando, Etsy and Shopify product search; Microsoft 365 / SharePoint search, Glean and Elastic Workplace Search for enterprises; Azure AI Search, Amazon OpenSearch Service, Elasticsearch, Vespa, Weaviate, Qdrant, Pinecone and pgvector as engines.',
  functional: ['Free-text search over 50 M product listings in 10 locales, robust to synonyms, paraphrases, typos and cross-language queries.', 'Filters and facets (category, brand, size, price, in stock, market, seller) and sorting.', 'B2B customers see only their entitled assortment and prices (permission filtering); for enterprise documents, only what the user may open.', 'Near-real-time updates: price and stock changes visible in seconds, new products in under a minute.', 'Merchandising controls: synonyms, boosts, pinned results, blocked terms.', 'Relevance experimentation: offline evaluation, A/B tests and interleaving.'],
  nonFunctional: ['Latency p95 &le; 150 ms for the search API (&le; 200 ms when the cross-encoder runs).', 'Peak 2,000 queries/s during sales events; 99.95% availability.', 'ANN recall@100 &ge; 0.95 against exact search on the same vectors.', 'Freshness: price/stock &le; 5 s, new content &le; 60 s.', 'Zero entitlement leaks (B2B assortments, enterprise ACLs).', 'Cost &le; ~$0.02 per 1,000 queries at average load.'],
  outOfScope: ['Typeahead suggestions (see <a href="../typeahead/index.html">search autocomplete</a>).', 'Recommendations without a query (see <a href="../recommendation/index.html">recommendation system</a>).', 'Web-scale crawling (see <a href="../search-engine/index.html">web search engine</a>).', 'Generating answers from results (see <a href="../rag-assistant/index.html">RAG assistant</a>).'],
  estimates: [
    ['Catalogue', '50 M listings, 10 locales', '~300 tokens of text each (title, attributes, description) &asymp; 15 B tokens'],
    ['Searches', '30 M/day; ~350/s average, ~2,000/s peak', '30 M / 86,400; sales events reach ~6&times; average'],
    ['Vector size', '768 dims', '768 &times; 4 B = 3 KB float32; 768 B int8; 96 B with product quantisation (PQ96)'],
    ['Vector memory', '154 GB float32, 38 GB int8, 4.8 GB PQ', '50 M &times; 3 KB, &times; 768 B, &times; 96 B'],
    ['HNSW graph', '~13 GB', 'M = 32 &rArr; ~64 neighbours on the base layer &times; 4 B = 256 B per vector &times; 50 M'],
    ['Query embeddings', '~1,200/s at peak', '2,000 q/s &times; 60% (head queries hit the embedding cache ~40% of the time)'],
    ['Reranking pairs', '~30 k pairs/s at peak', 'Cross-encoder only for tail queries (~30%): 2,000 &times; 0.3 &times; 50 candidates'],
    ['Catalogue updates', '5 M price/stock + 500 k content changes per day', 'Price/stock are partial updates (no re-embedding); content changes re-embed ~150 M tokens/day'],
    ['Click and impression logs', '~60 GB/day', '30 M searches &times; ~2 KB (impressions, positions, clicks, variant)']
  ],
  compute: [
    ['Search index nodes', '4 shards &times; 6 replicas = 24 nodes (16 vCPU, 128 GB)', 'Per shard 12.5 M docs: int8 vectors 9.6 GB + graph 3.2 GB + inverted index and doc values ~25 GB, all in RAM. One replica serves ~500 hybrid q/s at p95 &lt; 50 ms, so 4 replicas carry 2,000 q/s; 6 (2 per zone) still carry it after losing a zone. Off-peak: scale to 3 per shard.'],
    ['Query embedder', '3 &times; L4 GPUs (or ~16 CPU cores with ONNX)', 'A ~300 M-parameter multilingual model with dynamic batching embeds ~3,000 short queries/s per L4: 1,200/s needs less than one; 3 for zones and spikes.'],
    ['Cross-encoder reranker', '~12 &times; L4 GPUs', '30 k pairs/s &divide; ~4,000 pairs/s per GPU (~100 M-parameter model, 128-token pairs) = 7.5 busy &rArr; ~12 at 60% utilisation.'],
    ['Learning-to-rank in the search API', '~24 vCPU', 'Gradient-boosted trees over 200 candidates &times; 2,000 q/s = 400 k scores/s at ~50 &micro;s each = 20 cores.'],
    ['Indexer and backfill', '4 workers steady; 8 GPUs for a full re-embed', 'Steady updates ~60/s (peaks ~1,000/s on price runs). Full re-embedding: 15 B tokens &divide; (8 GPUs &times; ~50 k tok/s) &asymp; 10 hours, done into a new index side by side.']
  ],
  api: [
    ['GET /search?q=&locale=&filters=&sort=&page=', 'Returns results, facets, queryId (for click attribution) and the experiment variant. Anonymous head queries are cacheable at the edge for ~60 s.'],
    ['POST /search', '{query, filters, userContext {market, customerId}, debug?}: B2B entitlements and personalisation come from the authenticated context, never from client-supplied filters.'],
    ['POST /events', '{queryId, docId, position, action: impression|click|add_to_cart|purchase}: feeds learning-to-rank features and A/B metrics.'],
    ['PATCH /index/products/{id}', 'Partial update (price, stock) from the change stream; no re-embedding.'],
    ['PUT /index/products/{id}', 'Full document with fresh embedding when text or images change.'],
    ['PUT /admin/synonyms, /admin/rules', 'Merchandising: synonym sets per locale, boosts, pins, blocked terms; versioned and previewed against the judgement set.']
  ],
  data: [
    ['products index', 'Hybrid search engine, 4 shards by hash(productId)', 'id, title/description per locale (language analysers), attributes, categoryPath, brand, price, inStock, market[], assortmentIds[] (entitlements), popularity, embedding (768-d int8, HNSW), updatedAt.'],
    ['catalogue', 'Relational DB (source of truth)', 'Products, offers, sellers; change data capture to the stream.'],
    ['query embedding cache', 'Redis', 'normalise(query) + locale + model version &rarr; vector; TTL 7 days; ~40% hit rate.'],
    ['ranking features', 'Feature store (online + offline)', 'Per product and query cluster: CTR, add-to-cart and conversion rates, popularity, return rate; per user: preferred brands, sizes.'],
    ['relevance judgements', 'Warehouse table', 'query, locale, docId, grade 0-3, rater, date; ~5,000 queries stratified head / torso / tail.'],
    ['search logs', 'Stream &rarr; warehouse, partition by date', 'queryId, variant, impressions with positions, clicks, purchases; basis for metrics and training data.']
  ],
  dbChoice: [
    ['Products (text + vectors + filters)', 'One hybrid engine (OpenSearch / Elasticsearch / Azure AI Search / Vespa)', 'One query does BM25, filtered ANN, facets and fusion with consistent sharding and partial updates.', 'Separate vector DB + keyword engine: two indexes to keep consistent and a fusion layer to run; pgvector: fine up to ~10 M vectors, weak at facets and scale-out.'],
    ['Ranking features', 'Feature store', 'Same features online (low latency) and offline (training) avoids training/serving skew.', 'Embedding features into the index: fast but every CTR update re-indexes documents.'],
    ['Logs and judgements', 'Columnar warehouse', 'Billions of events, aggregated for metrics, training and experiments.', 'Search engine itself: expensive for analytics.']
  ],
  diagram: {
    nodes: [['u', 'Shoppers', 'client', 0, 1.2, 'web, app'], ['edge', 'CDN / edge', 'cdn', 1, 1.2, 'head-query cache'], ['api', 'Search API', 'svc', 2, 1.2, 'parse, fuse, LTR'],
      ['qc', 'Query cache', 'cache', 2, 0, 'query vectors'], ['qe', 'Query embedder', 'ml', 3, 0, 'multilingual'], ['idx', 'Hybrid index', 'search', 3, 1.2, '4 shards, 6 replicas'],
      ['rr', 'Reranker', 'ml', 3, 2.4, 'cross-encoder'], ['fs', 'Feature store', 'nosql', 4, 2.4, 'CTR, popularity'], ['de', 'Doc embedder', 'gpu', 4, 0, 'batch'],
      ['ix', 'Indexer', 'worker', 4, 1.2, 'partial + full'], ['cdc', 'Change stream', 'stream', 5, 1.2, 'CDC'], ['cat', 'Catalogue', 'db', 6, 1.2, 'source of truth'],
      ['ev', 'Click events', 'stream', 1, 2.6], ['dw', 'Logs + judgements', 'dw', 3, 3.5, 'nDCG, A/B']],
    edges: [['u', 'edge'], ['edge', 'api'], ['api', 'qc'], ['api', 'qe'], ['api', 'idx'], ['api', 'rr'], ['rr', 'fs'], ['cat', 'cdc', '', 'async'], ['cdc', 'ix', '', 'async'], ['ix', 'de'], ['ix', 'idx', 'upsert'],
      ['u', 'ev', 'clicks', 'async'], ['ev', 'dw', '', 'async'], ['dw', 'fs', 'features']]
  },
  flows: [
    { name: 'Hybrid search query', desc: 'A German shopper searches “wasserdichte Wanderschuhe Damen” (waterproof hiking shoes, women).', steps: [
      ['u', 'edge', 'GET /search?q=...&locale=de-DE', 'Anonymous head queries can be answered from the edge cache; this one is personalised, so it passes through.'],
      ['edge', 'api', 'forward', 'The API normalises the query, fixes typos and extracts structured filters (gender = women) with a small query-understanding model.'],
      ['api', 'qc', 'vector for normalised query?', 'Head queries repeat constantly; caching their embeddings saves a model call. Miss.'],
      ['api', 'qe', 'embed (~8 ms)', 'The multilingual model maps the German query close to English and German product texts with the same meaning.'],
      ['api', 'idx', 'BM25 + kNN, filters, RRF', 'Each shard runs BM25 with the German analyser (decompounding “Wanderschuhe” into wander + schuhe) and HNSW kNN (ef_search 100), both filtered by market = DE, inStock and category; results are fused with reciprocal rank fusion.'],
      ['idx', 'api', 'top 200 candidates', 'Scatter-gather over 4 shards in ~30 ms.', 'resp'],
      ['api', 'rr', 'LTR on 200, rerank top 50', 'A gradient-boosted ranker combines text and vector scores with price, CTR, conversion and the user’s preferred sizes. This is a tail query, so a cross-encoder also rescores the top 50.'],
      ['rr', 'fs', 'fetch features', 'Online features per product and query cluster, in a single batched read.'],
      ['api', 'u', '48 results + facets (~120 ms)', 'Results carry a queryId for click attribution.', 'resp'],
      ['u', 'ev', 'impressions, clicks', 'Clicks and purchases are logged per variant for metrics and future training.', 'async']],
      end: 'BM25 catches exact terms, vectors catch meaning across languages, fusion combines them, and ranking models apply business signals.' },
    { name: 'Catalogue update', desc: 'A price drops and a seller rewrites a product description.', steps: [
      ['cat', 'cdc', 'price changed (CDC)', 'Change data capture streams the committed change; no dual writes from the application.', 'async'],
      ['cdc', 'ix', 'deliver, keyed by productId', 'Events for the same product are ordered by partition key.', 'async'],
      ['ix', 'idx', 'PATCH price (no re-embed)', 'Price and stock are filter/sort fields; a partial update becomes visible at the next refresh (~1 s).'],
      ['cat', 'cdc', 'description changed', 'Text changes alter meaning, so the vector must be recomputed.', 'async'],
      ['ix', 'de', 'embed new text', 'Batched embedding on the document embedder (same model version as the query side).'],
      ['ix', 'idx', 'PUT doc + vector', 'The new vector is inserted into the HNSW graph and the old one marked deleted; background merges clean up tombstones and keep graph quality.']],
      end: 'Separate cheap attribute updates from expensive re-embedding; always embed documents and queries with the same model version.' },
    { name: 'Relevance experiment', desc: 'Testing a better embedding model without risking revenue.', steps: [
      ['ix', 'de', 're-embed 50 M with model v2', 'A new model means a new vector space: every document must be re-embedded (~10 hours on 8 GPUs).'],
      ['ix', 'idx', 'build index products_v2', 'The new index is built side by side; the alias still points to v1.'],
      ['dw', 'api', 'offline nDCG@10: +3.1%', 'Judged queries (graded 0-3) are replayed against both indexes; tail and non-English queries gain most, head queries are neutral.'],
      ['api', 'idx', '10% traffic to v2 (A/B)', 'Users are bucketed by a stable hash; interleaving runs alongside for a faster, more sensitive signal.'],
      ['u', 'ev', 'clicks by variant', 'Search conversion, add-to-cart, zero-result rate and reformulations per variant.', 'async'],
      ['ev', 'dw', 'two-week readout', 'Conversion per search +1.2% (significant), latency unchanged: v2 is promoted by switching the alias; v1 is kept a week for rollback.', 'async']],
      end: 'Offline judgements decide what is worth testing; online A/B decides what ships; aliases make switching and rollback instant.' },
    { name: 'Slow shard and selective filter (failure)', desc: 'A replica degrades during a sale and a B2B customer has a tiny assortment.', steps: [
      ['api', 'idx', 'scatter to 4 shards', 'One replica of shard 3 is in a long GC pause.', 'err'],
      ['api', 'idx', 'hedged request after 40 ms', 'If a shard has not answered by its p95, the API sends the same request to another replica and takes the first response.'],
      ['api', 'qe', 'embedder timeout', 'The embedding service is overloaded.', 'err'],
      ['api', 'idx', 'fallback: BM25 only', 'With no vector, the query runs keyword-only: worse for paraphrases but always available. The response is flagged degraded for monitoring.'],
      ['api', 'idx', 'B2B filter matches 0.3%', 'For a customer entitled to 150 k of 50 M products, filtered HNSW traversal struggles; the engine switches to exact (brute-force) vector scoring over the filtered set, which is fast at that size.'],
      ['api', 'u', 'results within 200 ms', 'Shoppers see results, possibly slightly less relevant, never an error page.', 'resp']],
      end: 'Hedging, keyword fallback and filter-aware strategy keep search fast and correct under stress.' }
  ],
  components: [
    ['Search API', 'Query normalisation and understanding, caching, embedding, hybrid retrieval, fusion, LTR, reranking, hedging and fallbacks, experiment bucketing.'],
    ['Embedding models', 'Multilingual model for queries and documents (same version), deployed separately for low-latency queries and batch documents.'],
    ['Hybrid index', 'Sharded, replicated search engine with BM25 per-language analysers, HNSW (or IVF-PQ / DiskANN), filters, facets and partial updates.'],
    ['Rankers', 'Learning-to-rank (gradient-boosted trees) with business features; cross-encoder for hard queries.'],
    ['Indexing pipeline', 'CDC from the catalogue, partial vs full updates, batch re-embedding, blue/green index builds behind aliases.'],
    ['Relevance platform', 'Judgement collection, offline metrics, A/B and interleaving, dashboards (zero-result, reformulation, conversion).']
  ],
  deep: [
    ['Choosing the embedding model', '<ul><li><strong>Quality on your data</strong>: shortlist from public benchmarks (MTEB, multilingual and retrieval tasks), then measure nDCG@10 and recall@100 on your own judged queries; domain fine-tuning on click pairs often adds 5-15%.</li><li><strong>Languages</strong>: a multilingual model maps all locales into one space, enabling cross-language matches and one index; check per-locale parity.</li><li><strong>Dimensions</strong>: memory and latency scale with dimensions. Models trained with Matryoshka representation learning can be truncated (1,024 &rarr; 512 &rarr; 256) with small losses.</li><li><strong>Asymmetric queries</strong>: short queries vs long documents; models with query/document prefixes or instructions handle this better.</li><li><strong>Hosting and cost</strong>: API embeddings are simple; self-hosting a ~300 M model on GPUs is cheaper at thousands of queries per second and keeps data in-house.</li><li><strong>Versioning</strong>: a new model is a new vector space; plan full re-embeds and side-by-side indexes.</li></ul>'],
    ['ANN indexes and memory sizing', '<table><tr><th>Index</th><th>How it works</th><th>Memory for 50 M &times; 768-d</th><th>Notes</th></tr><tr><td><strong>Flat (exact)</strong></td><td>Compare with every vector</td><td>154 GB float32</td><td>Perfect recall; fine for small or heavily filtered sets</td></tr><tr><td><strong>HNSW</strong></td><td>Multi-layer proximity graph, greedy search (params M, ef_construction, ef_search)</td><td>~167 GB float32, ~51 GB with int8</td><td>Best recall/latency; memory-hungry; slower inserts and deletes</td></tr><tr><td><strong>IVF-PQ</strong></td><td>Cluster into lists (IVF), search a few nearest lists (nprobe); compress vectors with product quantisation</td><td>~5 GB of codes + centroids</td><td>Very compact; lower recall, so rescore the top few hundred with full vectors</td></tr><tr><td><strong>DiskANN / Vamana</strong></td><td>Graph and full vectors on SSD, compressed vectors in RAM</td><td>~5 GB RAM + ~170 GB SSD</td><td>Billion-scale on one node, ~1-3 ms extra for SSD reads</td></tr></table><p>Quantisation is the big lever: int8 scalar (4&times; smaller, ~1% recall loss), binary (32&times;, needs rescoring), PQ (16-64&times;). Measure <strong>ANN recall</strong> (overlap with exact top-k) separately from relevance, and tune ef_search / nprobe for the latency budget.</p>'],
    ['Hybrid retrieval, fusion and ranking', '<p>Vectors miss exact tokens (model numbers, sizes like “EU 38”, brand names); BM25 misses paraphrases and other languages. Run both and fuse with <strong>reciprocal rank fusion</strong> (score = &Sigma; 1 / (60 + rank)), which needs no score calibration; or a weighted sum of normalised scores tuned on judgements.</p><p>Then rank in stages: cheap retrieval (thousands) &rarr; learning-to-rank on ~200 (gradient-boosted trees, LambdaMART objective, features: BM25, vector similarity, CTR, conversion, price, freshness, user affinity) &rarr; optional cross-encoder on the top 50 for queries where the ranker is unsure. Train LTR on click logs with position-bias correction (clicks on position 1 mean less than clicks on position 10) and on human judgements.</p>'],
    ['Filters, permissions and multilingual', '<ul><li><strong>Pre-filter vs post-filter</strong>: post-filtering ANN results can return too few hits when filters are selective; modern engines filter during graph traversal. When the filter matches a tiny fraction (&lt; ~1%), exact scoring over the filtered set is faster and exact.</li><li><strong>Permissions</strong>: entitlements (B2B assortments, enterprise ACL groups) are indexed fields applied as filters from the authenticated context, as in <a href="../rag-assistant/index.html">RAG permission trimming</a>; caches must be keyed by entitlement scope.</li><li><strong>Multilingual</strong>: per-language analysers for BM25 (stemming, German decompounding, CJK segmentation), locale-specific synonyms, a multilingual embedding model so a Spanish query can find an English-only listing, and per-locale relevance evaluation.</li><li><strong>Index updates</strong>: partial updates for volatile fields, re-embedding only on content change, tombstones and merges for HNSW deletes, blue/green rebuilds for model changes.</li></ul>'],
    ['Evaluation, safety and cost', '<p><strong>Offline</strong>: ~5,000 queries stratified by frequency and locale, graded 0-3 by trained raters (or an LLM judge calibrated against them). Metrics: <strong>nDCG@10</strong> (graded, position-discounted), <strong>MRR</strong> for navigational queries (one right answer), recall@100 for the retrieval stage, zero-result rate. <strong>Online</strong>: A/B tests on conversion per search, revenue per search, click-through, add-to-cart, reformulation and abandonment; interleaving (mix two rankers in one result list) detects differences with ~10-100&times; less traffic.</p><pre><code>def ndcg_at_k(ranked, grades, k=10):\n    dcg = sum((2 ** grades.get(d, 0) - 1) / math.log2(i + 2) for i, d in enumerate(ranked[:k]))\n    ideal = sorted(grades.values(), reverse=True)[:k]\n    idcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(ideal))\n    return dcg / idcg if idcg else 0.0</code></pre><p><strong>Safety and abuse</strong>: never leak entitled items; block prohibited products and offensive query suggestions; detect seller manipulation (keyword stuffing, near-duplicate listings that game embeddings); rate-limit scrapers at the WAF; keep query logs pseudonymised. <strong>Cost</strong> is dominated by RAM for vectors and GPUs for embedding and reranking: quantise, cache head-query embeddings, use the cross-encoder only where it pays off, and autoscale replicas outside sales events.</p>']
  ],
  scale: [
    '<strong>Vector memory</strong> grows with items &times; dimensions: int8 or PQ quantisation, smaller Matryoshka dimensions, DiskANN for billion scale.',
    '<strong>Query load</strong> scales with replicas; <strong>data size</strong> with shards. Keep shards at a size that fits RAM and meets per-shard latency; scatter-gather cost grows with shard count, so do not over-shard.',
    '<strong>Tail latency</strong> in scatter-gather: hedged requests, replica selection by latency, timeouts with partial results.',
    '<strong>Indexing spikes</strong> (price runs, catalogue imports) compete with queries: separate indexing and search nodes where the engine allows, or throttle bulk updates.',
    '<strong>Model upgrades</strong> require full re-embedding: budget GPU hours and double index capacity during the switch.'
  ],
  tradeoffs: [
    ['Retrieval mode', 'BM25 only vs vector only vs hybrid', 'Hybrid with RRF: best on mixed head (exact) and tail (semantic) queries; BM25 alone fails on paraphrases, vectors alone on identifiers.'],
    ['ANN index', 'HNSW vs IVF-PQ vs DiskANN', 'HNSW with int8 for 50 M vectors in RAM; IVF-PQ or DiskANN when memory cost dominates or at billion scale, with rescoring.'],
    ['Reranking', 'None vs LTR vs cross-encoder', 'LTR for every query (cheap, uses business signals); cross-encoder only for tail queries where it measurably lifts nDCG.'],
    ['One multilingual index vs per-locale indexes', 'Shared vector space vs separate models', 'One multilingual model and index with per-language text fields: cross-language matches and simpler operations; per-locale models only if a market underperforms.'],
    ['Engine', 'Managed search (Azure AI Search, OpenSearch Service) vs self-hosted (Elasticsearch, Vespa) vs vector DB', 'Managed for most teams; self-hosted Vespa or Elasticsearch when you need custom ranking at very high scale.']
  ],
  failures: [
    ['Embedding service down', 'Fall back to BM25 only; cached embeddings for head queries; alert on degraded share.'],
    ['Slow or failed shard replica', 'Hedged requests, latency-aware replica selection, partial results with a flag rather than an error.'],
    ['Model/version mismatch between query and documents', 'Model version stored in the index and the cache key; queries embedded only with the index’s version; alias switches both together.'],
    ['Entitlement leak', 'Filters from server-side context only, cache keys include entitlement scope, automated tests with restricted test customers.'],
    ['Relevance regression from a synonym or rule change', 'Preview against judgements before publishing, versioned rules, quick rollback, dashboards on zero-result and reformulation rates.'],
    ['Index corruption or bad bulk import', 'Snapshots, blue/green rebuilds, alias rollback, validation of document counts and sample queries before switching.']
  ],
  evals: [
    ['nDCG@10', 'Graded ranking quality on judged queries', '&ge; 0.65 overall; no locale more than 5% below the best'],
    ['MRR (navigational queries)', 'Position of the one right product or document', '&ge; 0.80'],
    ['Retrieval recall@100 and ANN recall', 'Relevant items reaching the ranker; ANN vs exact overlap', 'Recall@100 &ge; 0.90; ANN recall@100 &ge; 0.95'],
    ['Zero-result and reformulation rate', 'Searches with no results; users rephrasing immediately', 'Zero-result &le; 2%; reformulation trending down'],
    ['Latency', 'Search API p50/p95/p99', 'p95 &le; 150 ms (&le; 200 ms with cross-encoder)'],
    ['Online business metrics', 'Conversion and revenue per search, CTR, add-to-cart (A/B, interleaving)', 'Ship only on significant lift; guardrail: no latency or zero-result regression'],
    ['Safety and permissions', 'Entitlement leaks; prohibited items in results; manipulated listings in top 10', '0 leaks; 0 prohibited items; spam in top 10 &le; 0.1%'],
    ['Freshness', 'Time from catalogue change to searchable', 'Price/stock &le; 5 s p95; new content &le; 60 s'],
    ['Cost', 'Infrastructure cost per 1,000 queries', '&le; $0.02 at average load']
  ],
  cloud: [['Hybrid search engine', 'search'], ['Vector search', 'vector'], ['Embedding models (API)', 'llm'], ['Self-hosted embedder and reranker', 'ml'], ['GPU compute', 'gpu'], ['Edge cache', 'cdn'], ['Bot and scraper protection', 'waf'],
    ['Query embedding cache', 'cache'], ['Catalogue', 'sql'], ['Change stream (CDC)', 'stream'], ['Feature store', 'featurestore'], ['Logs, judgements, experiments', 'warehouse'], ['Batch re-embedding pipelines', 'mlpipeline'], ['Monitoring', 'monitor']],
  refs: { az: ['azRagRetrieval', 'azDataStore', 'azRag', 'azCaching', 'azAutoscale', 'azp-sharding', 'azp-cache-aside', 'azp-index-table'],
          aws: ['awsRagOptions', 'awsScatter', 'awsMlLens', 'awsCaching', 'blCaching', 'awsAnalyticsLens'] },
  questions: [
    ['Why combine BM25 with vector search?', 'They fail differently. Vectors capture meaning and cross-language similarity but blur exact identifiers, sizes and rare names; BM25 matches exact tokens but misses paraphrases. Hybrid retrieval with RRF reliably beats either alone, and the reranker then orders the union.'],
    ['How much memory does an HNSW index of 50 M 768-d vectors need?', 'Vectors: 50 M &times; 768 &times; 4 B = 154 GB in float32 (38 GB in int8). Graph: about 2M neighbours &times; 4 B per vector on the base layer, ~256 B with M = 32, so ~13 GB. Total ~167 GB float32 or ~51 GB int8, plus engine overhead, split across shards.'],
    ['How do you handle filters with ANN?', 'Use an engine that filters during traversal (filtered HNSW). If the filter is very selective, switch to exact scoring over the filtered subset. Avoid naive post-filtering, which can return few or no results. For hard partitions (market, tenant), separate indexes or routing keys help.'],
    ['What is nDCG and why use it over precision?', 'Discounted cumulative gain sums graded relevance discounted by log2(position + 1); normalising by the ideal ordering gives a 0-1 score. It rewards putting the best results first and uses graded judgements, which precision@k (binary, position-blind) does not.'],
    ['How do you safely switch to a new embedding model?', 'Re-embed every document into a new index in parallel, compare offline nDCG and recall on judged queries, run an A/B or interleaving test, then switch an alias for queries and documents together; keep the old index for rollback.'],
    ['How do you keep B2B customers from seeing each other’s assortments?', 'Index entitlement ids on each product, apply them as mandatory filters from the authenticated customer context in the API, include the entitlement scope in every cache key, and run automated tests with restricted customers in the evaluation suite.']
  ],
  related: ['rag-assistant', 'search-engine', 'typeahead', 'recommendation', 'ecommerce']
});

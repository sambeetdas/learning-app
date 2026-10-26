SD.renderCase({
  slug: 'recommendation',
  summary: 'A recommendation system picks the few dozen items (videos, products, posts, songs) most worth showing each user out of millions, in under ~150 ms. Scoring every item with a heavy model is impossible, so production systems are a <strong>funnel</strong>: <em>candidate generation</em> retrieves ~1,000 plausible items cheaply from several sources (two-tower embeddings searched with approximate nearest neighbours, collaborative filtering, trending and follow graphs); a <em>ranking model</em> scores those candidates with rich features to predict clicks, watch time and satisfaction; and <em>re-ranking</em> applies diversity, freshness, integrity and business rules. Around the funnel sit a <strong>feature store</strong> that serves the same features online that training saw offline (point-in-time correct), a <strong>stream</strong> of interaction events that updates features within seconds, cold-start strategies for new users and items, and an <strong>experimentation</strong> platform, because offline metrics such as NDCG only hint at what online A/B tests on CTR and watch time will show.',
  examples: 'YouTube and Netflix home pages, TikTok For You, Amazon "customers also bought", Spotify Discover Weekly, Instagram Explore, LinkedIn feed; managed options include Amazon Personalize, and custom models on Azure Machine Learning (Azure Personalizer is retired).',
  functional: ['Personalised home feed and "up next" lists per user, surface and device.', '"More like this" item-to-item recommendations.', 'React to what the user just did (watched, skipped, hid) within seconds.', 'Handle brand-new users and brand-new items sensibly (cold start).', 'Respect user controls: "not interested", hide creator, turn off personalisation.', 'Run many A/B experiments at once on models, features and rules.'],
  nonFunctional: ['p99 latency &le; 150 ms for a feed request end to end at the service.', '10,000 requests/s at peak; 99.95% availability with graceful degradation (a worse feed beats an error).', 'Event-to-feature freshness &le; 10 s for session features.', 'No training-serving skew: identical feature definitions offline and online.', 'Cost per 1,000 feed requests in fractions of a cent; daily retraining within a fixed GPU budget.', 'Integrity: never recommend policy-violating or age-inappropriate items; privacy and consent for personalisation.'],
  outOfScope: ['Search ranking (query-driven; see semantic search).', 'Ads auctions and bidding (related ranking problem, different economics).', 'Content moderation itself (consumed here as integrity labels).'],
  estimates: [
    ['Users', '100 M MAU, 30 M DAU', 'A large video or e-commerce platform'],
    ['Feed requests', '300 M/day; ~3,500 req/s average, ~10,000 req/s peak', '30 M DAU &times; 10 feed loads; evening peak ~3&times; average'],
    ['Candidates per request', '~1,000 retrieved &rarr; 300 heavily ranked &rarr; 50 returned', 'A light pre-ranker trims the list so the expensive model scores fewer items'],
    ['Heavy-ranker scorings at peak', '~3 M item scores/s', '10,000 req/s &times; 300 candidates'],
    ['Interaction events', '~6 B/day; ~70 k/s average, ~200 k/s peak', '30 M DAU &times; ~200 events (impressions, plays, progress, likes)'],
    ['Catalogue', '10 M items, ~50 k new per day', 'Long tail matters: most items have few interactions'],
    ['Item embeddings', '~1.3 GB (int8) / 5.1 GB (fp32)', '10 M &times; 128 dims &times; 1 or 4 bytes; fits in RAM on every retrieval node'],
    ['Online feature store', '~240 GB (&times; 2 replicas)', '100 M users &times; 2 KB + 10 M items &times; 4 KB'],
    ['Training data', '~4.5 TB/day kept', '300 M requests &times; 300 ranked items = 90 B logged rows/day; keep all positives + 10% of negatives &asymp; 9 B rows &times; ~500 B']
  ],
  compute: [
    ['Recommendation service (orchestration)', '~22 pods of 4 vCPU at peak; ~33 across 3 zones', '10,000 req/s &times; ~5 ms CPU (fan-out, merge, dedupe, serialisation) = 50 busy cores &rArr; ~84 cores at 60% &rArr; 22 pods; &times; 1.5 to survive a zone loss.'],
    ['ANN retrieval', '6 replicas of 16 vCPU (full index each)', 'HNSW query over 10 M vectors ~2 ms on one core &rArr; 10,000 &times; 2 ms = 20 cores, ~40 at 50% utilisation; each replica holds the ~7 GB index (vectors + graph) so replicas scale reads linearly.'],
    ['Pre-ranker', '~40 vCPU', '10,000 req/s &times; 1,000 candidates &times; ~2 &micro;s (dot product + tiny MLP) = 20 cores at 50% utilisation.'],
    ['Heavy ranker', '~18 L4-class GPUs at peak; ~24 across zones', '3 M scorings/s / ~250 k scorings/s per GPU (multi-task DCN-style model, batched) = 12 GPUs at 100% &rArr; ~18 at 65%; GPUs beat CPUs here by ~5&times; on cost per score.'],
    ['Feature serving', 'Redis cluster: 6 shards &times; 2 replicas', 'Per request 1 user + 300 item lookups = 3 M reads/s; a per-pod in-process cache of the 1 M hottest items (~4 GB) absorbs ~95% &rArr; ~150 k reads/s hit Redis.'],
    ['Stream processing', 'Kafka 48 partitions; Flink ~32 vCPU', '200 k events/s peak; stateful windows at ~10-25 k events/s per vCPU with headroom for replays.'],
    ['Training', '8-16 H100s, ~8 GPU-hours per day', 'Daily ranker retrain on 30 days of sampled data (~4 h on 8 GPUs) + two-tower retrain; hourly incremental fine-tunes on fresh data.']
  ],
  api: [
    ['GET /v1/recommendations?surface=home&count=50&cursor=', 'Returns items plus a rec_id (request id) and optional reasons ("Because you watched X"). The rec_id ties later events back to the exact model, variant and position.'],
    ['POST /v1/events [{type, item_id, rec_id, position, ts}]', 'Batched impressions, clicks, plays, watch progress, likes, hides. Impressions matter as much as clicks: they are the negatives.'],
    ['GET /v1/items/{id}/similar?count=20', 'Item-to-item list from co-visitation and embedding neighbours; cacheable per item for minutes.'],
    ['PUT /v1/items/{id}', 'Catalogue upsert. A content encoder embeds title, text and thumbnail so the item is retrievable within minutes, before anyone interacts with it.'],
    ['POST /v1/users/{id}/preferences {not_interested, personalisation}', 'User controls: exclude items or creators, or switch to a non-personalised feed (required for very large platforms under the EU Digital Services Act).'],
    ['gRPC Retrieve(user_vec, k, filters) / Rank(user, candidates[], context)', 'Internal stage APIs with strict deadlines (e.g. 25 ms and 50 ms) so the orchestrator can degrade stage by stage.']
  ],
  data: [
    ['Interaction events', 'Kafka-compatible stream + lake (Parquet / Delta)', 'Topic keyed by user_id (per-user ordering); lake partitioned by date/hour. Fields: user_id, item_id, rec_id, event_type, position, model_version, ts.'],
    ['Online features', 'Redis (or Cassandra / DynamoDB at larger scale)', 'Key entity:id &rarr; packed feature vector + feature_ts; session features with TTL; feature-set version in the key so models and features roll out together.'],
    ['Offline features', 'Lakehouse tables (Delta / Iceberg)', 'entity_id, feature_ts, values: full history kept for point-in-time joins; computed by the same definitions as the online path.'],
    ['Item embeddings + ANN index', 'In-memory HNSW (FAISS / ScaNN / vector database)', 'item_id &rarr; 128-d int8 vector with filter attributes (region, age rating, availability). Rebuilt daily, new items inserted incrementally.'],
    ['Served impressions with logged features', 'Lake', 'rec_id, user_id, item_id, position, variant, model_version and the exact feature values used: the most reliable training data (no skew by construction).'],
    ['Models and experiments', 'Model registry + relational DB', 'Model versions with offline metrics and data snapshot; experiments with variants, allocation, hash salt and guardrail metrics.']
  ],
  dbChoice: [
    ['Online features', 'Redis / key-value store', 'One request fans out to hundreds of keys within ~10 ms; batched MGET in memory is the only thing fast enough. Cassandra or DynamoDB when the data outgrows RAM budgets.', 'Querying the lake or warehouse online: seconds, not milliseconds.'],
    ['Interaction events', 'Kafka / Event Hubs / Kinesis', 'Ordered per user, replayable for rebuilding features and backfills, many independent consumers (features, training logs, analytics).', 'A work queue: no replay, single consumer per message.'],
    ['Embedding retrieval', 'In-memory ANN (HNSW / IVF-PQ)', 'Top-k from 10 M vectors in ~2 ms with ~95% recall versus exact search; filters for availability and age rating.', 'Brute force on GPU (viable at this size, costlier at 100 M+); managed vector search for smaller teams.'],
    ['Training data and offline features', 'Lakehouse', 'Cheap, columnar, time-travel; Spark/SQL joins over billions of rows.', 'Warehouse only: fine for analytics but costlier for large training scans.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'client', 0, 1.0, 'app, TV, web'], ['gw', 'API gateway', 'apigw', 1, 1.0, 'auth, routing'], ['rec', 'Rec service', 'svc', 2, 1.0, 'orchestrates stages'],
      ['exp', 'Experiments', 'svc', 2, 0, 'A/B bucketing'], ['cg', 'Candidate gen', 'svc', 3, 0.2, 'ANN, CF, trending'], ['ann', 'ANN index', 'vector', 4, 0, 'item embeddings HNSW'],
      ['rank', 'Ranking model', 'ml', 3, 1.4, 'multi-task, GPU'], ['rr', 'Re-ranker', 'svc', 3, 2.6, 'diversity, rules'], ['fs', 'Online features', 'cache', 4, 2.2, 'Redis'],
      ['reg', 'Model registry', 'ml', 5, 1.4, 'rankers, towers'], ['ev', 'Event stream', 'stream', 2, 3.2, 'impressions, plays'], ['sp', 'Stream processor', 'worker', 4, 3.2, 'Flink: live features'],
      ['lake', 'Data lake', 'dw', 5, 3.2, 'logs + offline feats'], ['train', 'Training pipeline', 'job', 6, 2.2, 'daily + incremental']],
    edges: [['u', 'gw'], ['gw', 'rec'], ['rec', 'exp'], ['rec', 'cg'], ['rec', 'rank'], ['rec', 'rr'], ['cg', 'ann'], ['cg', 'fs'], ['rank', 'fs'], ['gw', 'ev', 'events', 'async'],
      ['ev', 'sp', '', 'async'], ['sp', 'fs'], ['sp', 'lake', '', 'async'], ['lake', 'train'], ['train', 'reg'], ['reg', 'rank', 'deploy'], ['reg', 'ann', 'new embeddings']]
  },
  flows: [
    { name: 'Home feed request', desc: 'A user opens the app. The funnel goes from 10 million items to 50 in about 100 ms.', steps: [
      ['u', 'gw', 'GET /recommendations', 'The app asks for the home feed with context (device, time, network).'],
      ['gw', 'rec', 'user_id + context', 'Authenticated request reaches the orchestrator with a 150 ms overall deadline.'],
      ['rec', 'exp', 'bucket user', 'hash(user_id, experiment salt) decides the variants, e.g. ranker v42 vs v41. Deterministic hashing keeps a user in the same arm without storing assignments.'],
      ['rec', 'cg', 'retrieve ~1,000', 'Candidate generation runs several sources in parallel with a 25 ms deadline each.'],
      ['cg', 'fs', 'user embedding + history', 'Fetch the user tower output (or the features to compute it) and recent history, so already-watched items can be filtered out.'],
      ['cg', 'ann', 'top-600 by dot product', 'HNSW search over item embeddings with availability and age filters; merged with collaborative-filtering co-visitation lists, trending in region and followed creators, then deduplicated.'],
      ['rec', 'rank', 'score 300 candidates', 'A cheap pre-ranker trims 1,000 to 300; the multi-task GPU ranker predicts click, watch time, like and hide probabilities for each.'],
      ['rank', 'fs', 'batch get features', 'User, item and cross features in one batched read; hot item features come from an in-process cache.'],
      ['rec', 'rr', 'diversify + rules', 'Re-ranking enforces diversity (at most 2 per creator in the top 10), freshness, integrity filters and promoted slots.'],
      ['rec', 'u', '50 items + rec_id', 'The response carries a rec_id; every impression and click later references it for attribution and training.', 'resp']],
      end: 'Each stage trades accuracy for cost: cheap and broad at the top, expensive and precise on a few hundred items, rules last.' },
    { name: 'Real-time signals', desc: 'The user binge-watches cooking videos. The next feed request should already reflect that.', steps: [
      ['u', 'gw', 'POST /events (play 90%)', 'The client batches impressions and progress events every few seconds.'],
      ['gw', 'ev', 'append, key = user_id', 'Events go to a partitioned stream; keying by user keeps each user’s events in order.', 'async'],
      ['ev', 'sp', 'consume', 'The stream processor keeps per-user state: last 50 items, category affinities with exponential decay, skip rate.', 'async'],
      ['sp', 'fs', 'update session features', 'Updated features land in the online store within seconds (target ≤ 10 s).'],
      ['sp', 'lake', 'impression + label logs', 'The same events are written to the lake, joined with logged features, as training data.', 'async'],
      ['u', 'gw', 'next feed request', 'A minute later the user pulls to refresh.'],
      ['gw', 'rec', 'same funnel', 'The funnel runs again.'],
      ['rec', 'rank', 'features incl. last minute', 'The ranker sees "3 cooking videos in the last 10 minutes, all finished" and boosts similar items.'],
      ['rec', 'u', 'more cooking, still diverse', 'Re-ranking keeps some variety so the feed does not collapse into one topic.', 'resp']],
      end: 'Streaming features make the system feel responsive without retraining: the model is fixed, its inputs move in real time.' },
    { name: 'Train and deploy', desc: 'Daily: train a new ranker and item embeddings, validate offline, then prove it online with an A/B test.', steps: [
      ['lake', 'train', 'point-in-time training set', 'Labels (watched > 30 s, liked) are joined with features as they were at impression time; logged serving features make this exact.'],
      ['train', 'reg', 'register ranker v42', 'Offline metrics vs v41: NDCG@10 +1.2%, AUC +0.3 points, calibration within 2%; slice checks for new users and small regions.'],
      ['train', 'reg', 'register item embeddings', 'The two-tower model is retrained; new item vectors are produced for the whole catalogue.'],
      ['reg', 'ann', 'build new index (blue/green)', 'A new HNSW index is built offline and swapped in atomically; user and item towers must come from the same version or dot products are meaningless.'],
      ['reg', 'rank', 'shadow, then 5% canary', 'v42 first scores in shadow (latency and score distribution checked), then serves a 5% A/B arm.'],
      ['rec', 'exp', 'v42 arm vs control', 'Users are bucketed by hash; the experiment runs 1-2 weeks to cover weekly cycles and novelty effects.'],
      ['sp', 'lake', 'online metrics by arm', 'Watch time per user, CTR, retention, hides and guardrails (latency, creator diversity) are computed per arm.', 'async'],
      ['reg', 'rank', 'promote or roll back', 'Ship if the primary metric is significantly better and no guardrail regresses; otherwise roll back to v41.']],
      end: 'Offline metrics gate what may be tested; only an online experiment decides what ships.' },
    { name: 'Cold start', desc: 'A brand-new user with no history, and a brand-new item with no interactions.', steps: [
      ['u', 'gw', 'first session', 'A new user finishes sign-up and picked three topics.'],
      ['gw', 'rec', 'unknown user', 'No interaction history, no user embedding yet.'],
      ['rec', 'cg', 'context-based retrieval', 'Sources switch to popular-in-country, top items for the chosen topics, and items similar to onboarding picks.'],
      ['cg', 'ann', 'content embeddings', 'New items were embedded from title, description and thumbnail by a content encoder, so they are retrievable from minute one.'],
      ['rec', 'rank', 'context-only features', 'The ranker relies on device, locale, time and topic choices; it was trained with these features present for new users.'],
      ['rec', 'rr', 'exploration slots', 'A few slots are reserved for exploration: a bandit (Thompson sampling) gives new items guaranteed impressions and learns from the results.'],
      ['rec', 'u', 'starter feed', 'A reasonable first feed.', 'resp'],
      ['u', 'gw', 'first clicks', 'After a few interactions the real-time path builds session features and the feed personalises within the first session.']],
      end: 'Cold start is solved with content features, context, popularity priors and deliberate exploration, not by waiting for data.' },
    { name: 'Ranker timeout', desc: 'Failure path: the GPU ranker is slow (a bad deploy or a zone issue). The feed must still load.', steps: [
      ['u', 'gw', 'GET /recommendations', 'Normal request.'],
      ['gw', 'rec', 'deadline 150 ms', 'The orchestrator tracks the remaining time budget per stage.'],
      ['rec', 'cg', 'retrieve', 'Candidates arrive on time.'],
      ['rec', 'rank', 'score 300 (deadline 50 ms)', 'The ranker call starts with a 50 ms deadline.'],
      ['rank', 'rec', 'deadline exceeded', 'No response in 50 ms; the circuit breaker counts the failure.', 'err'],
      ['rec', 'rr', 'fallback ordering', 'Use the pre-ranker scores instead; re-ranking rules still apply, so integrity and diversity are preserved.'],
      ['rec', 'u', 'degraded feed', 'The user gets a slightly worse but valid feed in time. The response is tagged degraded so analytics can exclude it.', 'resp'],
      ['rec', 'fs', 'feature store miss', 'Separately, missing features are filled with defaults the model was trained to tolerate (feature dropout during training).', 'err']],
      end: 'Every stage has a deadline and a fallback (pre-ranker scores, cached popular lists); the worst case is a less personal feed, never an empty one.' }
  ],
  components: [
    ['Recommendation service', 'Orchestrates the funnel per request with deadlines, fallbacks and experiment variants; logs what was served.'],
    ['Candidate generation', 'Several retrievers in parallel: two-tower ANN, collaborative filtering (co-visitation, matrix factorisation), trending, follow graph; merges and filters.'],
    ['ANN index', 'In-memory HNSW / IVF-PQ index of item embeddings with metadata filters.'],
    ['Pre-ranker + heavy ranker', 'Cheap model trims candidates; multi-task deep model predicts engagement and satisfaction signals.'],
    ['Re-ranker', 'Diversity, freshness, deduplication, integrity and age filters, business rules and exploration slots.'],
    ['Feature store', 'One set of feature definitions; offline history for training, online low-latency serving; streaming updates.'],
    ['Event stream + stream processor', 'Interaction ingestion; real-time feature computation; training-log production.'],
    ['Training pipeline + registry', 'Point-in-time training sets, model training, offline evaluation gates, versioned artefacts.'],
    ['Experimentation platform', 'Assignment, metric computation, statistical tests, guardrails and long-term holdouts.']
  ],
  evolutionTitle: 'From popularity lists to a real-time funnel',
  evolution: [
    { name: '1. Popularity + rules', desc: 'Start simple: most-viewed items per category and region, refreshed hourly. Surprisingly strong baseline; no personalisation.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.5], ['api', 'Rec API', 'svc', 1, 0.5], ['c', 'Top-N lists', 'cache', 2, 0, 'per category/region'], ['j', 'Hourly SQL job', 'job', 2, 1.1], ['db', 'Events DB', 'db', 3, 1.1]], edges: [['u', 'api'], ['api', 'c'], ['j', 'c'], ['db', 'j']] },
      steps: [['u', 'api', 'GET feed', 'Every user in a region sees roughly the same list.'], ['api', 'c', 'read list', 'One cached lookup.'], ['db', 'j', 'count views', 'An hourly job counts recent views.'], ['j', 'c', 'refresh lists', 'Lists refresh; this is the baseline every later model must beat.']] },
    { name: '2. Batch collaborative filtering', desc: 'Nightly matrix factorisation (ALS) or item-item similarity on Spark precomputes recommendations per user. Personal, but a day stale and blind to new items.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.5], ['api', 'Rec API', 'svc', 1, 0.5], ['kv', 'Precomputed recs', 'nosql', 2, 0.5, 'user → top 200'], ['t', 'Nightly ALS (Spark)', 'job', 3, 0.5], ['l', 'Data lake', 'dw', 4, 0.5]], edges: [['u', 'api'], ['api', 'kv'], ['t', 'kv'], ['l', 't']] },
      steps: [['u', 'api', 'GET feed', 'Request arrives.'], ['api', 'kv', 'get user list', 'A key-value read of the precomputed top 200.'], ['l', 't', 'interaction matrix', 'Nightly training on the user-item matrix.'], ['t', 'kv', 'write lists', 'Lists for 100 M users are rewritten nightly: stale by up to a day, and new items wait a day.']] },
    { name: '3. Real-time multi-stage', desc: 'The design above: online retrieval and ranking with streaming features, so recommendations adapt within seconds and new items appear immediately.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.7], ['rec', 'Rec service', 'svc', 1, 0.7], ['cg', 'Retrieval', 'vector', 2, 0, 'two-tower ANN'], ['rk', 'Ranker', 'ml', 2, 1.4, 'GPU'], ['fs', 'Feature store', 'cache', 3, 0.7], ['st', 'Event stream', 'stream', 4, 0.7]], edges: [['u', 'rec'], ['rec', 'cg'], ['rec', 'rk'], ['rk', 'fs'], ['st', 'fs', '', 'async']] },
      steps: [['u', 'rec', 'GET feed', 'Computed per request.'], ['rec', 'cg', 'retrieve', 'Fresh candidates, including items added minutes ago.'], ['rec', 'rk', 'rank', 'Rich features, multi-task predictions.'], ['rk', 'fs', 'features', 'Online features updated seconds ago.'], ['st', 'fs', 'stream updates', 'Real-time signals keep features fresh.', 'async']] }
  ],
  deep: [
    ['Candidate generation: two-tower + ANN', '<p>A <strong>two-tower</strong> model has a user tower (user features, recent history) producing a vector <code>u</code> and an item tower (id, text, category, creator, content embedding) producing <code>v</code>; relevance is the dot product <code>u &middot; v</code>. It is trained on (user, engaged item) pairs with an in-batch softmax: other items in the batch act as negatives, with a log-frequency (logQ) correction so popular items are not over-penalised. Because the towers are independent, all item vectors are precomputed and indexed; at request time only <code>u</code> is computed.</p><ul><li><strong>ANN search:</strong> HNSW gives ~95% recall@500 versus exact search in ~2 ms over 10 M items; IVF-PQ compresses vectors further for 100 M+ catalogues. Memory: 10 M &times; 128 &times; 1 byte (int8) &asymp; 1.3 GB plus graph links.</li><li><strong>Several sources:</strong> co-visitation ("watched together within a session"), matrix factorisation, trending in region, followed creators, and content similarity. Each contributes a quota; the union is deduplicated and filtered (already seen, unavailable, blocked).</li><li><strong>Measure retrieval separately:</strong> recall@1,000 of items the user later engaged with. If retrieval misses an item, no ranker can recover it.</li></ul>'],
    ['Ranking: multi-task scoring', '<p>The heavy ranker (for example DCN-v2, DLRM or a transformer over the user’s recent sequence) takes hundreds of features: user (history, affinities), item (age, quality, popularity), context (device, time) and cross features (user-creator affinity). It predicts several outcomes at once: <code>p(click)</code>, <code>p(watch &gt; 30 s)</code>, expected watch time, <code>p(like)</code>, <code>p(hide)</code>.</p><pre><code>score = w1 * p_click + w2 * E[watch_minutes] + w3 * p_like - w4 * p_hide\n# weights are tuned by online experiments, not by offline loss</code></pre><p>Optimising only for clicks rewards clickbait; adding satisfaction signals (likes, survey responses, hides, long-term return) keeps the system honest. Calibrate predictions (predicted 10% should mean 10%) so scores from different heads and models can be combined. Position bias in training data (top slots get clicked more) is handled by adding position as a feature during training and fixing it at serving time.</p>'],
    ['Feature store and point-in-time correctness', '<p><strong>Training-serving skew</strong> is the classic silent failure: the model trained on a feature computed one way and serves on a slightly different computation, or training leaked information from the future. Rules:</p><ol><li>One feature definition, executed by both the batch (offline) and streaming (online) pipelines, or computed once and written to both stores.</li><li><strong>Point-in-time joins:</strong> for each training label at time <code>t</code>, use the latest feature value with <code>feature_ts &le; t</code>, never a later one.</li><li>Best of all, <strong>log the features actually served</strong> with each impression and train on those logs.</li></ol><pre><code>import pandas as pd\n# labels: user_id, item_id, ts, label        feats: user_id, feature_ts, watch_count_7d\ntrain = pd.merge_asof(labels.sort_values("ts"), feats.sort_values("feature_ts"),\n                      left_on="ts", right_on="feature_ts", by="user_id",\n                      direction="backward")      # only values known at impression time</code></pre><p>Managed feature stores (Azure ML managed feature store, SageMaker Feature Store, Feast, Databricks) provide the offline/online split, materialisation jobs and point-in-time retrieval. See <a href="../ml-platform/index.html">ML platform</a>.</p>'],
    ['Re-ranking, responsibility and cost', '<p><strong>Diversity:</strong> greedy maximal marginal relevance picks the next item maximising <code>&lambda; &middot; score - (1 - &lambda;) &middot; max similarity to items already chosen</code>; plus hard rules such as at most 2 per creator in the top 10.</p><p><strong>Guardrails:</strong></p><ul><li>Integrity filters from moderation (removed, borderline, age-rated content) applied at retrieval and again at re-ranking: a recommender amplifies whatever it ranks, so borderline content is demoted even if allowed (see <a href="../content-moderation/index.html">content moderation</a>).</li><li>Protect minors (age-appropriate pools, no sensitive-interest targeting), honour "not interested" and personalisation opt-outs, and limit repetitive exposure to sensitive topics.</li><li>Exposure fairness: exploration quotas so new and small creators get impressions.</li><li>Privacy: consent for personalisation, data minimisation and deletion propagating to features and training sets.</li></ul><p><strong>Cost:</strong> at ~3,500 req/s average (12.6 M requests/hour) the serving fleet (orchestrators, ANN, ~24 GPUs, Redis, Kafka, Flink) costs roughly $150/hour &rArr; ~$0.012 per 1,000 requests; daily training ~100 GPU-hours &asymp; $300. The biggest lever is how many candidates the heavy ranker scores: halving 300 to 150 nearly halves GPU cost, so measure the NDCG loss before doing it.</p>'],
    ['A/B testing and metrics', '<p><strong>Offline</strong> metrics on held-out future data: NDCG@k, recall@k, AUC, log loss, calibration (see <a href="../ai-evaluation/index.html#retrieval">ranking metrics</a>). They are cheap and good for rejecting bad models but correlate imperfectly with online wins, because logged data only contains items the old system chose to show.</p><p><strong>Online</strong>: randomised A/B tests by user hash. Pick one primary metric (watch time per user or long-term retention), plus guardrails (latency, hides, creator diversity, complaint rate). Run at least 1-2 weeks for weekly cycles and novelty effects; keep long-running holdouts to measure cumulative impact. <strong>Interleaving</strong> (mixing two rankers in one list and counting which gets more engagement) detects ranking differences with ~10-100&times; less traffic for quick screening. Watch for interference: recommendations change what content gets made and watched, so very large effects can leak between arms.</p>']
  ],
  scale: [
    '<strong>Ranker GPU cost</strong> grows with requests &times; candidates: use a pre-ranker, cache scores for logged-out or repeated requests, and distil big models into faster ones.',
    '<strong>Feature fan-out:</strong> hundreds of item lookups per request; cache hot item features in process, pack features into one value per entity, and co-locate feature stores with serving.',
    '<strong>Index size:</strong> beyond ~100 M items use IVF-PQ or sharded ANN with scatter-gather, and pre-filter by region or language to shrink the search space.',
    '<strong>Event volume:</strong> partition streams by user; sample negatives for training logs; compact impressions before landing in the lake.',
    '<strong>Embedding version skew:</strong> user and item towers must match; version indexes and swap them atomically with the model.',
    '<strong>Many surfaces:</strong> share retrieval and features across home, up-next and notifications; train surface-specific rankers or add surface as a feature.'
  ],
  tradeoffs: [
    ['Precompute vs real-time', 'Nightly per-user lists vs online funnel per request', 'Online funnel with streaming features: fresher and handles new items; precompute remains a cheap fallback and suits email/notification recommendations.'],
    ['Build vs managed', 'Custom models on Azure ML/SageMaker vs Amazon Personalize', 'Managed services get a good recommender running in weeks for mid-size catalogues; at very large scale or with unusual objectives a custom funnel pays off.'],
    ['Objective', 'Clicks vs watch time vs satisfaction', 'Multi-task with satisfaction signals: pure CTR optimisation produces clickbait; pure watch time can favour compulsive content.'],
    ['Candidate count', 'Score more candidates vs lower latency and cost', 'Pre-ranker to ~300 for the heavy model; tune with offline NDCG and online tests rather than guessing.'],
    ['Exploration', 'Pure exploitation vs reserved exploration slots', 'Reserve a few slots (bandits) for new items and creators: costs a little short-term engagement, keeps the catalogue healthy and fixes cold start.'],
    ['Feature freshness', 'Batch daily features vs streaming features', 'Streaming for session and short-window signals; batch for long-term aggregates where seconds of freshness add nothing.']
  ],
  failures: [
    ['Ranker slow or down', 'Per-stage deadlines, circuit breaker, fall back to pre-ranker scores or cached popular lists; tag degraded responses.'],
    ['Feature pipeline lag or stale features', 'Freshness monitors per feature set; models trained with feature dropout tolerate defaults; alert when lag exceeds 1 minute.'],
    ['Training-serving skew after a feature change', 'Shared definitions, logged-features training, skew detection comparing online and offline distributions before promotion.'],
    ['Feedback loop / filter bubble', 'Diversity constraints, exploration, satisfaction signals and long-term holdouts that reveal slow degradation.'],
    ['Bad model ships', 'Shadow and canary stages, automatic guardrail checks, one-click rollback to the previous registry version.'],
    ['Index and model version mismatch', 'Version tags on embeddings, indexes and towers; atomic swap; reject queries when versions differ.'],
    ['Policy-violating item recommended', 'Integrity filters at retrieval and re-ranking; fast takedown events from moderation that purge items from indexes within minutes.']
  ],
  evals: [
    ['NDCG@10 (offline)', 'Ranking quality on next-day held-out interactions, with graded relevance (watch fraction)', 'No regression vs the production model; +0.5% relative is usually needed to justify an online test'],
    ['Retrieval recall@1,000', 'Share of later-engaged items present in the candidate set', '&ge; 0.6 overall; tracked separately for new users and items under 7 days old'],
    ['Online engagement (A/B)', 'Watch time per user, CTR and 7-day retention vs control', 'Ship only on a statistically significant gain in the primary metric with no guardrail regression'],
    ['Satisfaction and diversity', 'Hide/dislike rate, survey "worth your time", intra-list diversity, creator coverage', 'Hides not up; &ge; 6 distinct creators in the top 10; catalogue coverage tracked weekly'],
    ['Safety / integrity', 'Policy-violating or age-inappropriate items served per million impressions', '&le; 1 per million; takedown-to-purge time &le; 5 minutes'],
    ['Latency', 'Service-side p99 for the feed endpoint, per stage', 'p99 &le; 150 ms; degraded-response rate &le; 0.5%'],
    ['Freshness', 'Event-to-online-feature lag; new-item time to first 1,000 impressions', 'Lag p95 &le; 10 s; new items reach 1,000 impressions within 24 h'],
    ['Calibration', 'Predicted vs observed rates per head and slice', 'Expected calibration error &le; 2%'],
    ['Cost', 'Serving cost per 1,000 requests; training GPU-hours per day', '&le; $0.02 per 1,000 requests; training within the daily GPU budget']
  ],
  cloud: [['API gateway', 'apigw'], ['Managed recommender (buy option)', 'recsvc'], ['Model training and serving', 'ml'], ['Feature store', 'featurestore'], ['ML pipelines', 'mlpipeline'], ['Serving pods', 'k8s'], ['GPU ranking and training', 'gpu'], ['Online features', 'cache'], ['Large online feature tables', 'nosql'], ['Embedding retrieval', 'vector'], ['Event stream', 'stream'], ['Stream processing', 'streamproc'], ['Lakehouse and training data', 'bigdata'], ['Analytics and experiment metrics', 'warehouse'], ['Monitoring', 'monitor']],
  refs: { az: ['azMlops', 'azStreamDbx', 'azBigData', 'azEventDriven', 'azCaching', 'azAksBaseline'],
          aws: ['awsMlLens', 'awsClickstream', 'awsAnalyticsLens', 'awsCaching', 'awsDdbBest', 'awsPubSub'] },
  questions: [
    ['Why not score every item with the best model?', 'Ten million items &times; 10,000 requests/s is 10<sup>11</sup> scores per second. The funnel spends cheap compute on recall (ANN retrieval in ~2 ms) and expensive compute on precision for a few hundred candidates.'],
    ['How do you handle a brand-new item with no interactions?', 'Embed its content (text, image, audio) with the item tower’s content features so it is retrievable immediately; give it guaranteed exploration impressions through a bandit; and boost freshness in re-ranking for a short window. Its interaction features accumulate in real time.'],
    ['What is training-serving skew and how do you prevent it?', 'The model sees different feature values in production than in training, for example a 7-day count computed in UTC offline and local time online, or features leaking from after the label. Prevent it with shared definitions, point-in-time joins, logging served features for training, and skew monitors before promotion.'],
    ['Offline NDCG went up but the A/B test was flat. Why?', 'Logged data only contains what the old model chose to show (selection bias); NDCG ignores diversity and long-term effects; the gain may be in slices that matter little; or the online test lacked power. Use counterfactual evaluation, interleaving and better-aligned offline labels, but trust the experiment.'],
    ['How do you avoid filter bubbles and harmful amplification?', 'Optimise multi-objective scores including satisfaction and hides, enforce diversity in re-ranking, reserve exploration slots, demote borderline content even when allowed, offer user controls and a non-personalised feed, and measure long-term retention with holdouts rather than only short-term clicks.'],
    ['When would you use Amazon Personalize or another managed service?', 'For a mid-size catalogue and team without deep recommender expertise: it handles training, real-time event ingestion and serving. Choose a custom funnel when you need custom objectives, very large scale, unusual surfaces, or tight control over cost and latency.']
  ],
  related: ['news-feed', 'video-streaming', 'ml-platform', 'semantic-search', 'ad-click']
});

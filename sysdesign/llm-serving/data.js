SD.renderCase({
  slug: 'llm-serving',
  summary: 'Serving your own LLM means turning scarce, expensive GPUs into tokens per second at a latency users accept. The work is different from ordinary web serving: prompts are processed in a compute-bound <strong>prefill</strong>, answers are generated one token at a time in a memory-bandwidth-bound <strong>decode</strong>, and the <strong>KV cache</strong> of every active sequence competes for GPU memory with the model weights. This design self-hosts a 70 B-parameter open model on H100 GPUs with an inference engine (vLLM, SGLang or TensorRT-LLM) that uses <strong>continuous batching</strong>, <strong>PagedAttention</strong>, <strong>prefix caching</strong>, <strong>FP8 quantisation</strong>, <strong>tensor parallelism</strong> and <strong>speculative decoding</strong>; adds a prefix-aware router, optional <strong>prefill/decode disaggregation</strong>, <strong>multi-LoRA</strong> adapters, and autoscaling on queue depth and KV usage rather than CPU, while hiding multi-minute model load times. Sizing is done with explicit memory and bandwidth maths and checked by load tests against <strong>TTFT and TPOT SLOs</strong>. Background: <a href="../ai-foundations/index.html#inference">how LLM inference works</a>.',
  examples: 'vLLM and SGLang deployments behind most open-model APIs, NVIDIA Dynamo and TensorRT-LLM / Triton, llm-d on Kubernetes, Hugging Face TGI, Azure ML / Foundry managed compute, Amazon SageMaker AI and Bedrock Custom Model Import, and inference providers such as Together, Fireworks and Groq.',
  functional: ['Serve chat and completion requests for open models (a 70 B dense model, plus a small 8 B model) through an OpenAI-compatible API with streaming.', 'Serve hundreds of fine-tuned LoRA adapters on the shared base model, selected per request.', 'Register, roll out and roll back model versions (weights, quantisation, engine config) with canaries.', 'Priority classes: interactive requests ahead of batch jobs; batch fills idle capacity.', 'Expose per-replica metrics: queue length, running batch, KV-cache usage, TTFT, TPOT, tokens/s.'],
  nonFunctional: ['Interactive SLOs: TTFT p95 &le; 1 s for 2 k-token prompts, TPOT p95 &le; 50 ms (&ge; 20 tokens/s per user).', 'Goodput: &ge; 95% of requests meet both SLOs at peak.', 'Peak 100 requests/s for the 70 B model; scale down at night.', 'Cost &le; ~$1.2 per million tokens blended; GPU utilisation &gt; 60% averaged over the day.', 'Quality of the quantised model within 1 point of BF16 on the evaluation suite.', '99.9% availability across three zones; model rollout without dropping requests.'],
  outOfScope: ['Training and fine-tuning jobs (see <a href="../training-cluster/index.html">LLM training cluster</a>).', 'Org-wide quotas, auth and chargeback (done by the <a href="../llm-gateway/index.html">AI gateway</a> in front).', 'Image and video generation models (see <a href="../image-generation/index.html">image generation</a>).'],
  estimates: [
    ['Demand (70 B model)', 'Peak 100 req/s, average 40 req/s', '&asymp; 3.5 M requests/day'],
    ['Tokens per request', '2,000 in, 300 out', '&asymp; 8 B tokens/day (3.5 M &times; 2,300)'],
    ['Peak prefill and decode load', '200 k input tok/s, 30 k output tok/s', '100 &times; 2,000 and 100 &times; 300; ~40% of input hits the prefix cache &rArr; ~120 k tok/s to compute'],
    ['Weights', '70 GB in FP8 (140 GB in BF16)', '70 B parameters &times; 1 byte'],
    ['KV cache per token', '160 KB (FP8 KV)', '2 (K,V) &times; 80 layers &times; 8 KV heads (GQA) &times; 128 dims &times; 1 byte; 320 KB in BF16'],
    ['KV capacity per replica', '~470 k tokens &asymp; 200 sequences of 2.3 k', '2 &times; 80 GB HBM &minus; 70 GB weights &minus; ~15 GB activations, CUDA graphs &asymp; 75 GB / 160 KB'],
    ['Decode speed per replica', '~2,100 output tok/s', 'Each step streams 35 GB of weights per GPU at ~3.35 TB/s (~10.5 ms) plus KV reads; ~30 ms per step at batch ~64 &rArr; 64 &times; 33 tok/s'],
    ['Requests per replica at SLO', '~3 req/s', 'Per request: decode 300 / 2,100 = 0.14 s + prefill 1,200 uncached / ~8,000 tok/s = 0.15 s of replica time &asymp; 0.29 s &rArr; 3.4/s at 100%, ~3/s keeping SLO headroom'],
    ['Model load time', '~1-2 min on a warm node, 8-12 min on a new node', '70 GB from local NVMe at ~5 GB/s = 14 s, engine start and CUDA graph capture ~30-60 s; a new GPU VM plus a ~10 GB image pull adds minutes'],
    ['Daily GPU cost', '~$9,500 &asymp; $1.2 per M tokens', '48 reserved GPUs &times; 24 h &times; ~$6 + 32 burst GPUs &times; 8 h &times; ~$10; / 8 B tokens']
  ],
  compute: [
    ['Replica shape', '2 &times; H100 80 GB, tensor parallel 2, FP8 weights + FP8 KV', 'BF16 weights (140 GB) would leave almost no KV space on two GPUs; FP8 halves weights and KV with &lt; 1 point quality loss. TP=2 inside one NVLink domain keeps the all-reduce per layer cheap.'],
    ['Fleet at peak', '40 replicas = 80 GPUs = 10 nodes of 8 GPUs', '100 req/s / 3 per replica = 34, +15% headroom &asymp; 39, rounded to 40 so 3 zones hold ~13 each; losing a zone drops capacity by a third, so load shedding and spillover cover the gap for minutes until replacements load.'],
    ['Night and minimum', '6 replicas (2 per zone) + 1 warm spare node', 'Night load ~10 req/s needs 4 replicas; 6 for zone safety. The warm spare node (weights on NVMe, image pulled) turns a 10-minute scale-out into ~1-2 minutes.'],
    ['Router', '3 &times; 2 vCPU', '100 req/s of lightweight routing (prefix hashing, outstanding-token counts): CPU is negligible; 3 for zone redundancy.'],
    ['Small 8 B model', '4 &times; L40S/H100 single-GPU replicas', '8 B in FP8 = 8 GB weights; one GPU serves ~5,000+ output tok/s. Used for classification, rewriting and speculative drafting experiments.'],
    ['Cost check vs APIs', 'Self-host only with high utilisation', '$1.2 per M tokens is competitive with frontier APIs but not always with serverless open-model APIs (often ~$0.6-0.9 per M for 70 B). The case rests on data control, custom adapters, latency and keeping GPUs busy (batch jobs at night).']
  ],
  api: [
    ['POST /v1/chat/completions  {model, messages, stream, max_tokens}', 'OpenAI-compatible (vLLM/SGLang serve it natively). model may name an adapter: "llama-70b:legal-v3". Streams SSE; usage in the final chunk.'],
    ['POST /v1/completions, /v1/embeddings', 'Raw completions for batch jobs; embeddings served by separate small-model replicas.'],
    ['Header x-priority: interactive | batch', 'The router and engine scheduler favour interactive requests; batch requests are preempted first under KV pressure.'],
    ['GET /metrics  (Prometheus)', 'num_requests_running, num_requests_waiting, gpu_cache_usage_perc, prefix-cache hit rate, time_to_first_token and time_per_output_token histograms, generation tokens/s.'],
    ['GET /health, /ready', 'Ready only after weights are loaded and warm-up requests pass, so the router never sends traffic to a loading replica.'],
    ['POST /admin/models  {name, version, artefactUri, sha256, quant, tp, engineArgs, minReplicas, maxReplicas}', 'Registers a model version; rollout controller creates a canary (5% of traffic) and promotes on SLO and quality gates.']
  ],
  data: [
    ['model registry', 'Relational DB / ML registry', 'name, version, base model, licence, artefact URI, sha256, quantisation, tp size, engine version, eval scores, status (canary | live | retired).'],
    ['weights', 'Object storage (safetensors) &rarr; node-local NVMe cache', 'Immutable, versioned paths; signed and hash-checked; pre-staged to NVMe on GPU nodes before rollout.'],
    ['LoRA adapters', 'Object storage &rarr; GPU memory LRU', '50-300 MB each; loaded on first use (~1 s), kept in a per-replica LRU of e.g. 32 adapters; tenant id per adapter.'],
    ['KV cache', 'GPU HBM, paged (16-token blocks)', 'Block tables per sequence (PagedAttention); prefix blocks hashed for reuse across requests; optionally offloaded to CPU RAM / NVMe (LMCache) for long shared prefixes.'],
    ['metrics and traces', 'Prometheus / managed TSDB + tracing', 'Per replica and per model; drives autoscaling and capacity planning; 13-month roll-ups.']
  ],
  dbChoice: [
    ['Weights and adapters', 'Object storage + local NVMe cache', 'Large immutable files read in bulk; NVMe gives ~5 GB/s for fast restarts; object storage is the durable source.', 'Baking weights into container images: 70+ GB images are slow to pull and duplicate storage; shared network file systems: simpler but slower and a shared point of failure.'],
    ['Model registry', 'Relational DB or an ML registry (Azure ML / SageMaker)', 'Small, transactional, with approvals and lineage.', 'Tags in Git: weak on lineage and eval results.'],
    ['Metrics for autoscaling', 'Prometheus-compatible TSDB', 'Scrape every 5-15 s, query by replica and model; KEDA reads it directly.', 'Cloud metrics only: coarser granularity and slower scaling.']
  ],
  diagram: {
    nodes: [['c', 'Apps', 'client', 0, 1.2, 'via AI gateway'], ['gw', 'AI gateway', 'apigw', 1, 1.2, 'auth, quotas'], ['rt', 'Inference router', 'lb', 2, 1.2, 'prefix + load aware'],
      ['pf', 'Prefill pool', 'gpu', 3, 0, 'compute-bound'], ['dc', 'Decode pool', 'gpu', 4, 0.6, 'bandwidth-bound'], ['uni', 'vLLM replicas', 'gpu', 3, 1.6, 'TP=2, FP8, H100'],
      ['lora', 'LoRA adapters', 'blob', 2, 2.3, 'per tenant'], ['prom', 'Metrics', 'tsdb', 5, 1.6, 'queue, KV, TTFT'], ['as', 'Autoscaler', 'job', 5, 2.9, 'KEDA + node pools'],
      ['reg', 'Model registry', 'db', 2, 3.3, 'versions, evals'], ['ms', 'Weights store', 'blob', 3, 3.3, 'safetensors'], ['nvme', 'Node NVMe cache', 'blob', 4, 3.3, 'pre-staged']],
    edges: [['c', 'gw'], ['gw', 'rt'], ['rt', 'pf'], ['pf', 'dc', 'KV transfer'], ['rt', 'uni'], ['lora', 'uni'], ['uni', 'prom', 'metrics', 'async'], ['dc', 'prom', '', 'async'], ['prom', 'as'], ['as', 'uni', 'scale'],
      ['reg', 'ms'], ['ms', 'nvme', 'pre-stage'], ['nvme', 'uni', 'load']]
  },
  flows: [
    { name: 'Request on a replica', desc: 'A 2,000-token chat request is routed to a replica that already holds its prefix in cache.', steps: [
      ['c', 'gw', 'POST chat (stream)', 'The gateway authenticates, applies the team quota and forwards to the self-hosted pool.'],
      ['gw', 'rt', 'model llama-70b', 'The router hashes the first blocks of the prompt (system prompt + RAG instructions).'],
      ['rt', 'uni', 'route: prefix hit, least load', 'Replica 7 already holds that 1,500-token prefix in its KV cache and has the fewest outstanding tokens. Prefix-aware routing turns cache hits from ~10% (random) into ~40%.'],
      ['uni', 'rt', 'first token after 450 ms', 'The scheduler admits the request into the running batch at the next step (continuous batching, no waiting for a batch to finish). Only 500 uncached tokens need prefill, done in chunks so other users’ decodes do not stall.', 'resp'],
      ['uni', 'rt', 'a token every ~30 ms', 'The request decodes together with ~60 others; each step reads the weights once for the whole batch, which is why batching is what makes GPUs affordable. KV blocks are allocated 16 tokens at a time (PagedAttention), so there is almost no fragmentation.', 'resp'],
      ['rt', 'gw', 'stream passthrough', 'Tokens flow back through the router and gateway without buffering.', 'resp'],
      ['gw', 'c', 'answer (300 tokens, ~9.5 s)', 'TTFT 0.45 s + 300 × 30 ms.', 'resp'],
      ['uni', 'prom', 'TTFT, TPOT, KV usage', 'Histograms feed SLO dashboards and the autoscaler.', 'async']],
      end: 'Continuous batching, paged KV and prefix-aware routing are what let one replica serve dozens of users at once within SLO.' },
    { name: 'Long prompt, disaggregated', desc: 'A 30,000-token contract is summarised. Prefill and decode run on separate pools.', steps: [
      ['c', 'gw', 'summarise 30 k-token document', 'On a unified replica this prefill would take ~4 s of full-GPU compute and stall every decode in the batch (TPOT spikes for 60 users).'],
      ['gw', 'rt', 'forward', 'The router sees prompt length above the disaggregation threshold (8 k tokens).'],
      ['rt', 'pf', 'prefill on prefill pool', 'The prefill pool is sized for compute (high FLOPs utilisation, small batches of long prompts).'],
      ['pf', 'dc', 'transfer KV (~4.8 GB)', '30,000 tokens × 160 KB of KV move over NVLink/RDMA (~100 ms at 50 GB/s) using a KV-transfer library (e.g. NIXL in Dynamo, vLLM / llm-d connectors).'],
      ['dc', 'rt', 'decode stream', 'The decode pool runs large batches optimised for memory bandwidth; this request’s tokens stream at a steady TPOT.', 'resp'],
      ['rt', 'gw', 'stream', 'Users on the decode pool never noticed the long prefill.', 'resp']],
      end: 'Disaggregation trades extra KV transfer for stable TPOT and better utilisation when prompts are long and varied.' },
    { name: 'Autoscale on queue', desc: 'Morning traffic doubles in 15 minutes.', steps: [
      ['uni', 'prom', 'waiting 40, KV 95%', 'Requests queue and KV cache is nearly full. GPU utilisation was already ~100% at half the load, so it is useless as a scaling signal.'],
      ['prom', 'as', 'rule: waiting > 5 per replica', 'KEDA scales on num_requests_waiting and TTFT p95, with KV usage as a secondary signal.'],
      ['as', 'uni', 'add 4 replicas (warm node)', 'The warm spare node has the image pulled and weights on NVMe.'],
      ['nvme', 'uni', 'load 70 GB in ~14 s', 'Weights stream from local NVMe straight into GPU memory; engine warm-up and CUDA graph capture take another ~40 s.'],
      ['uni', 'rt', 'ready after warm-up', 'Readiness passes only after a test generation; the router starts sending traffic gradually to avoid a cold-cache stampede.', 'resp'],
      ['as', 'nvme', 'provision next spare node', 'The cluster autoscaler adds a new GPU node (8-12 minutes) and pre-stages weights so the next scale-out is fast too.']],
      end: 'Scale on queue and latency, keep a warm spare, and pre-stage weights: model load time, not request rate, limits how fast you can scale.' },
    { name: 'GPU failure and overload (failure)', desc: 'A GPU throws an Xid error while the fleet is at its limit.', steps: [
      ['uni', 'rt', 'replica 12 health check fails', 'An uncorrectable ECC / Xid error kills the engine; with TP=2 the whole replica is gone, including its KV cache.', 'err'],
      ['rt', 'uni', 'reroute new requests', 'The router removes the replica immediately. Requests that had not streamed any token are retried elsewhere; streams already in progress end with an error event.'],
      ['uni', 'prom', 'KV 100%, preemptions', 'The other replicas are now over capacity: the engine preempts batch-priority sequences (freeing their KV and recomputing later) to keep interactive SLOs.', 'err'],
      ['rt', 'gw', '429 for batch, shed load', 'When queue wait would exceed the TTFT SLO, the router sheds batch traffic first with 429 + retry-after.', 'err'],
      ['gw', 'c', 'spill overflow to hosted API', 'The gateway spills overflow interactive traffic to a hosted model of similar quality, accepting higher cost for a few minutes.'],
      ['as', 'uni', 'cordon node, replace replica', 'The faulty node is cordoned and drained for repair; a replacement replica starts on the warm spare.']],
      end: 'Admission control, priority preemption and spillover protect goodput; GPU failures are routine at fleet scale.' },
    { name: 'Multi-LoRA request', desc: 'A legal team’s fine-tuned adapter shares the base model with 200 other adapters.', steps: [
      ['c', 'gw', 'model llama-70b:legal-v3', 'The adapter name rides in the model field.'],
      ['gw', 'rt', 'forward', 'The gateway checks that the legal team owns this adapter.'],
      ['rt', 'uni', 'prefer replica with adapter', 'Adapter affinity is part of the routing score, like prefix affinity.'],
      ['lora', 'uni', 'load adapter (180 MB, ~1 s)', 'On a miss the adapter is fetched and placed in the replica’s GPU LRU (32 slots).'],
      ['uni', 'rt', 'tokens', 'Requests for different adapters run in the same batch using batched LoRA kernels (Punica / S-LoRA style); the 70 GB FP8 base model is shared, each adapter costs only megabytes.', 'resp']],
      end: 'Multi-LoRA serves hundreds of fine-tunes for roughly the price of one base deployment.' }
  ],
  components: [
    ['Inference engine (vLLM / SGLang / TensorRT-LLM)', 'Continuous batching scheduler, PagedAttention KV manager, prefix caching, chunked prefill, quantised kernels, speculative decoding, multi-LoRA, OpenAI-compatible server.'],
    ['Inference router', 'Prefix- and adapter-aware, load-aware (outstanding tokens, queue), priority classes, disaggregation decisions, retries before first token.'],
    ['Prefill and decode pools (optional)', 'Separate GPU pools with KV transfer over NVLink/RDMA for long prompts.'],
    ['Model registry and rollout controller', 'Versions, artefact hashes, canary and rollback driven by SLO and quality gates.'],
    ['Weights pipeline', 'Object storage, signature/hash verification, pre-staging to node NVMe, fast streaming loaders.'],
    ['Autoscaler', 'KEDA on queue depth, TTFT and KV usage; cluster autoscaler for GPU nodes; warm spare capacity.'],
    ['Observability', 'Per-replica TTFT/TPOT histograms, tokens/s, KV usage, preemptions, GPU health (DCGM), cost per token.']
  ],
  evolutionTitle: 'From one GPU box to an inference platform',
  evolution: [
    { name: '1. One replica', desc: 'A single 8-GPU server runs one engine with tensor parallelism. Works for a pilot; one failure is an outage and scaling is manual.', diagram: { nodes: [['c', 'Apps', 'client', 0, 0], ['e', 'vLLM server', 'gpu', 1.4, 0, 'TP=8, BF16']], edges: [['c', 'e']] },
      steps: [['c', 'e', 'OpenAI API', 'All traffic on one box; BF16 70 B on 8 GPUs wastes memory and money.'], ['e', 'c', 'stream', 'No routing, no autoscaling.', 'resp']] },
    { name: '2. Replicas + router', desc: 'Quantise to FP8, shrink replicas to TP=2, run many behind a prefix-aware router and autoscale on queue depth.', diagram: { nodes: [['c', 'Apps', 'client', 0, 0.6], ['r', 'Router', 'lb', 1.3, 0.6], ['a', 'Replica A', 'gpu', 2.6, 0], ['b', 'Replica B', 'gpu', 2.6, 1.2], ['m', 'Metrics', 'tsdb', 3.9, 0.6]], edges: [['c', 'r'], ['r', 'a'], ['r', 'b'], ['a', 'm', '', 'async'], ['b', 'm', '', 'async']] },
      steps: [['c', 'r', 'request', 'One endpoint.'], { par: [['r', 'a', 'prefix match'], ['r', 'b', 'least tokens']], msg: 'Routing for cache hits and balance.' }, ['a', 'm', 'queue, KV', 'Autoscaling signals.', 'async']] },
    { name: '3. Disaggregated + multi-model', desc: 'Separate prefill and decode pools, multi-LoRA, several base models, a shared GPU pool with priorities and batch backfill.', diagram: { nodes: [['r', 'Router', 'lb', 0, 0.6], ['p', 'Prefill pool', 'gpu', 1.3, 0], ['d', 'Decode pool', 'gpu', 2.6, 0], ['s', 'Small models', 'gpu', 1.3, 1.2]], edges: [['r', 'p'], ['p', 'd', 'KV'], ['r', 's']] },
      steps: [['r', 'p', 'long prompts', 'Compute-optimised pool.'], ['p', 'd', 'KV transfer', 'Bandwidth-optimised pool.'], ['r', 's', 'easy requests', 'Cheap models for simple work.']] }
  ],
  deep: [
    ['GPU sizing maths', '<p>Three numbers decide almost everything:</p><ol><li><strong>Weights memory</strong> = parameters &times; bytes per parameter. 70 B &times; 2 (BF16) = 140 GB; &times; 1 (FP8) = 70 GB; &times; 0.5 (INT4) = 35 GB.</li><li><strong>KV cache per token</strong> = 2 &times; layers &times; KV heads &times; head dim &times; bytes. For a 70 B model with grouped-query attention (80 layers, 8 KV heads, 128 dims): 2 &times; 80 &times; 8 &times; 128 &times; 1 byte = 160 KB in FP8. A 2,300-token sequence needs ~370 MB; 200 of them need ~74 GB.</li><li><strong>Decode step time</strong> &asymp; bytes read per step / memory bandwidth. Every step reads all weights once (shared by the batch) plus each sequence’s KV. 35 GB per GPU at 3.35 TB/s &asymp; 10.5 ms minimum, so a single user can never exceed ~95 tokens/s on this setup, but 64 users share the same read.</li></ol><p><strong>Prefill</strong> is compute-bound: ~2 &times; parameters FLOPs per token = 140 GFLOPs per token; at ~1 PFLOP/s of effective FP8 compute per replica that is ~7-8 k tokens/s, so a 2,000-token prompt costs ~0.25 s of replica time without caching. Use these to pick the replica shape, then <strong>load-test for goodput</strong> (requests/s meeting both TTFT and TPOT SLOs) with your real prompt and output length distribution, because theory ignores scheduling overheads.</p>'],
    ['Batching, PagedAttention and prefix caching', '<ul><li><strong>Continuous batching</strong>: the scheduler adds and removes sequences at every decode step, so short answers do not wait for long ones; throughput rises 5-20&times; over static batching.</li><li><strong>PagedAttention</strong>: KV cache is allocated in fixed blocks (e.g. 16 tokens) through a block table, like virtual memory pages, cutting waste from ~60% to a few percent and enabling sharing.</li><li><strong>Chunked prefill</strong>: long prompts are split into chunks interleaved with decode steps so TPOT stays smooth.</li><li><strong>Prefix caching</strong>: blocks are content-hashed; a new request whose prompt starts with cached blocks (system prompt, few-shot examples, a document being discussed) skips that prefill. Combine with prefix-aware routing and keep shared prefixes byte-identical at the start of prompts.</li><li><strong>Preemption</strong>: when KV runs out, the engine evicts lower-priority sequences (recompute or swap to CPU) instead of failing.</li></ul>'],
    ['Quantisation, parallelism and speculative decoding', '<p><strong>Quantisation:</strong> FP8 (E4M3) weights and activations on Hopper/Blackwell GPUs are the default for serving: half the memory, faster kernels, typically &lt; 1 point of quality loss. INT4 weight-only (AWQ, GPTQ) quarters memory for cheaper GPUs but can hurt reasoning and code more; FP8 KV cache doubles concurrent sequences. Always evaluate the quantised model on your own suite.</p><p><strong>Parallelism:</strong> <em>tensor parallelism</em> splits each layer across GPUs in one NVLink domain (TP=2/4/8): needed when weights plus KV do not fit, and lowers latency, but adds an all-reduce per layer. <em>Pipeline parallelism</em> splits layers across nodes for very large models. <em>Expert parallelism</em> spreads mixture-of-experts layers. Prefer the smallest TP that meets latency: more replicas beat bigger replicas for throughput and failure isolation.</p><p><strong>Speculative decoding:</strong> a cheap drafter (a small model, EAGLE heads or n-gram lookup) proposes k tokens; the large model verifies them in one pass and keeps the accepted prefix, so output is identical in distribution. At 60-80% acceptance it gives 1.5-2.5&times; faster decode at low and medium batch sizes; the gain shrinks when the GPU is already compute-saturated, so enable it per pool and measure.</p>'],
    ['Autoscaling and model loading', '<p>GPU utilisation is a poor signal (it reads ~100% at any batch size). Scale on <strong>queue depth</strong> (num_requests_waiting per replica), <strong>TTFT p95</strong> and <strong>KV usage</strong>, with slower scale-in than scale-out.</p><p>Cold start is the enemy: provisioning a GPU node (5-10 min), pulling a ~10 GB image, loading 70 GB of weights and capturing CUDA graphs. Mitigations: keep a warm spare node; pre-pull images (or use image streaming); pre-stage weights to local NVMe; use streaming loaders that read safetensors in parallel directly into GPU memory; keep the same replica running across minor config changes; schedule batch work on idle GPUs at night instead of scaling to zero. GPU capacity itself may not be available on demand in a region: reserve the base, and plan multi-region.</p>'],
    ['Cost, safety and supply chain', '<p><strong>Cost</strong> per million tokens = GPU $/hour &divide; (tokens/s per GPU &times; 3,600 / 10<sup>6</sup>) &divide; utilisation. Levers: FP8, prefix caching, bigger batches within the TPOT SLO, speculative decoding, small models for easy work, LoRA instead of full fine-tune deployments, and filling idle hours with batch jobs. Compare honestly with hosted APIs and provisioned throughput before committing to GPUs.</p><p><strong>Safety and security:</strong> open weights come without the provider’s safety stack, so add content-safety filters or a guard model (e.g. Llama Guard-class classifiers) at the gateway; red-team the exact quantised model and every LoRA adapter (fine-tuning can erode refusal behaviour); isolate tenants’ adapters and never mix prompt logs; load only safetensors (no pickle) from signed, hash-verified artefacts; respect model licences; keep inference endpoints private behind the gateway (see <a href="../ai-foundations/index.html#safety">AI safety</a>).</p>']
  ],
  scale: [
    '<strong>KV memory</strong> caps concurrency: FP8 KV, prefix sharing, shorter max context per tier, and KV offload to CPU/NVMe for long shared contexts.',
    '<strong>Long prompts</strong> hurt everyone’s TPOT: chunked prefill first, then prefill/decode disaggregation when prompt lengths are long and varied.',
    '<strong>GPU supply</strong> is the real bottleneck: reserved capacity for the base, multiple regions and GPU types (H100, H200, MI300X, Blackwell), engines that run on several.',
    '<strong>Many models</strong> fragment the fleet: consolidate on a few base models with multi-LoRA, and use a shared pool with priorities and batch backfill.',
    '<strong>Fleet failures</strong> are daily at scale: health checks with DCGM, automatic cordon/drain, retries before the first token, and N+1 replicas per zone.'
  ],
  tradeoffs: [
    ['Self-host vs hosted API vs provisioned throughput', 'Own GPUs vs per-token API vs reserved managed capacity', 'Self-host for data control, custom/open models, adapters and very high steady utilisation; otherwise hosted or provisioned is cheaper to operate.'],
    ['Quantisation level', 'BF16 vs FP8 vs INT4', 'FP8 for production on modern GPUs; INT4 for cost-sensitive or smaller GPUs after evaluation; BF16 only as the quality reference.'],
    ['Replica size', 'TP=8 big replicas vs TP=2 small replicas', 'Smallest TP that fits weights + KV and meets TTFT: more replicas give better throughput, routing choice and failure isolation.'],
    ['Unified vs disaggregated', 'Prefill and decode on the same GPUs vs separate pools', 'Unified with chunked prefill for short prompts; disaggregated when long prompts cause TPOT spikes and scale justifies the complexity.'],
    ['Batch size vs latency', 'Large batches (cheap) vs small (fast per user)', 'Maximise batch size subject to the TPOT SLO; run batch-priority traffic to fill gaps.'],
    ['Engine choice', 'vLLM vs SGLang vs TensorRT-LLM', 'vLLM for breadth of models and hardware; SGLang for prefix-heavy and structured workloads; TensorRT-LLM for maximum NVIDIA performance with more build effort. Benchmark on your traffic.']
  ],
  failures: [
    ['GPU / node failure', 'Health checks (DCGM, Xid), router removes replica, retry before first token, cordon and drain, N+1 capacity per zone.'],
    ['KV cache exhaustion', 'Admission control on projected KV, priority preemption, max context limits, scale on KV usage.'],
    ['Slow scale-out during spikes', 'Warm spare nodes, pre-staged weights, queue-based scaling with lead time, shed batch traffic, spill to hosted API.'],
    ['Quality regression after quantisation or new version', 'Eval gates in the registry, canary with live judges, instant rollback to the previous version.'],
    ['Long-prompt latency spikes', 'Chunked prefill, separate long-context pool or disaggregation, per-tier max prompt length.'],
    ['Poisoned or tampered weights', 'Signed artefacts, hash verification at load, safetensors only, controlled registry.'],
    ['Zone or region loss', 'Spread replicas across zones, reserved capacity in a second region, gateway failover.']
  ],
  evals: [
    ['TTFT p50/p95', 'Time to first token at the gateway for 2 k-token prompts', 'p95 &le; 1 s at peak load'],
    ['TPOT p50/p95', 'Time per output token while streaming', 'p95 &le; 50 ms'],
    ['Goodput', 'Share of requests meeting both TTFT and TPOT SLOs', '&ge; 95% at peak; load-test each config change with real length distributions'],
    ['Throughput per GPU', 'Output tokens/s per GPU at SLO', '&ge; 1,000 tok/s per H100 for the 70 B model'],
    ['Quantised model quality', 'Eval suite score of FP8 vs BF16 (task accuracy, judge scores)', 'Within 1 point; no safety regression'],
    ['Safety of served models and adapters', 'Harmful-content and jailbreak success rate on the red-team suite per model and LoRA', 'No worse than the base model; jailbreak success &le; 2% with gateway filters'],
    ['Speculative decoding', 'Draft acceptance rate and decode speed-up', 'Acceptance &ge; 60%; speed-up &ge; 1.5&times; at median batch'],
    ['Prefix cache hit rate', 'Share of prompt tokens served from cache', '&ge; 40% with prefix-aware routing'],
    ['Scale-out time', 'From trigger to a ready replica', '&le; 2 min on a warm node; &le; 12 min with a new node'],
    ['Cost and utilisation', '$ per million tokens and GPU busy share', '&le; $1.2 per M tokens; &ge; 60% daily average utilisation']
  ],
  cloud: [['GPU compute', 'gpu'], ['Kubernetes with GPU node pools', 'k8s'], ['Inference engine', 'vLLM / SGLang / TensorRT-LLM on AKS', 'vLLM / SGLang / TensorRT-LLM on EKS'], ['Managed model serving', 'ml'], ['Managed open-model hosting', 'aiplatform'],
    ['Autoscaling', 'KEDA + cluster autoscaler on AKS', 'KEDA + Karpenter on EKS'], ['Weights and adapters', 'blob'], ['Container images', 'registry'], ['Model registry and pipelines', 'mlpipeline'], ['AI gateway in front', 'aigw'],
    ['Content safety', 'guardrails'], ['Metrics (Prometheus) and tracing', 'monitor'], ['Private networking', 'network'], ['Secrets and signing keys', 'secrets']],
  refs: { az: ['azAksBaseline', 'azGenAiOps', 'azMlops', 'azAutoscale', 'azGenGw', 'azBigCompute', 'azPtu', 'azp-queue-based-load-leveling'],
          aws: ['awsMlLens', 'awsGenAiLens', 'awsGenAiOps', 'blShedding', 'blStatic', 'blBacklog'] },
  questions: [
    ['Why is decode memory-bound and prefill compute-bound?', 'Prefill processes all prompt tokens in parallel, so each weight read is reused across thousands of tokens: arithmetic dominates. Decode produces one token per sequence per step, so the GPU must stream all weights from HBM for very little arithmetic; batching many sequences is the only way to amortise those reads.'],
    ['How many GPUs do you need for 100 requests/s?', 'Pick the replica shape from memory (FP8 70 B on 2 &times; H100 leaves ~75 GB for KV), estimate per-replica capacity from decode bandwidth and prefill compute (~3 req/s here for 2,000-in / 300-out), confirm with a goodput load test, then divide: 100 / 3 &asymp; 34, plus headroom and zone spread &rArr; 40 replicas, 80 GPUs.'],
    ['What does PagedAttention solve?', 'Contiguous KV allocation per sequence wastes memory because final lengths are unknown, so engines over-reserve. Paging allocates small blocks on demand with a block table, nearly eliminating fragmentation, allowing more concurrent sequences, and enabling shared prefix blocks across requests.'],
    ['Why not autoscale on GPU utilisation?', 'An engine with continuous batching shows near 100% utilisation at almost any load, so the metric does not reflect user experience. Queue depth, TTFT and KV usage react to overload directly.'],
    ['When does speculative decoding not help?', 'When the batch is already large and the GPU compute-saturated, verifying extra draft tokens costs real compute; when acceptance rates are low (creative text, mismatched drafter); and when TTFT, not TPOT, is the bottleneck.'],
    ['How do you roll out a new model version safely?', 'Register it with its hash and eval scores, pre-stage weights, start canary replicas, send ~5% of traffic, compare TTFT/TPOT, error rates and live judge scores against the current version, then promote gradually; keep the old version warm for instant rollback.']
  ],
  related: ['llm-gateway', 'training-cluster', 'ml-platform', 'image-generation', 'rag-assistant']
});

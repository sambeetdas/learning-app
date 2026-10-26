SD.renderCase({
  slug: 'image-generation',
  summary: 'An AI image generation service turns a text prompt into images with diffusion models running on GPUs. Generation takes seconds, not milliseconds, and GPU time is the dominant cost, so the system is built around an <strong>asynchronous request API</strong> (202 Accepted, then polling or a webhook) and <strong>queue-based GPU workers</strong> that batch compatible jobs, keep models and LoRA adapters resident, and autoscale on queue depth with <strong>priority tiers</strong> for paying customers. Safety runs on both sides of the model: <strong>prompt checks</strong> before any GPU time is spent and <strong>output classification</strong> before an image is ever stored or shown, with zero tolerance for child sexual abuse material. Every image carries <strong>provenance</strong>: a signed C2PA manifest and an invisible watermark, which the EU AI Act now requires for synthetic content. Outputs land in object storage behind a CDN. The core trade-offs are step count vs latency vs quality, and utilisation vs waiting time, all of which show up directly in the cost per image.',
  examples: 'Midjourney, OpenAI image generation in ChatGPT and the API, Adobe Firefly, Google Imagen, Stability AI and Black Forest Labs (FLUX) APIs, Canva and Microsoft Designer; hosted models in Microsoft Foundry and Amazon Bedrock; self-hosted pipelines built with Diffusers or ComfyUI.',
  functional: ['Submit a prompt (plus options: model, size, steps, seed, style LoRA, negative prompt, number of images) and receive images.', 'Asynchronous jobs: immediate 202 with a job id; status by polling or webhook; cancellation.', 'Multiple model variants (fast distilled, standard, high quality) and custom LoRA styles.', 'Priority tiers: paid and enterprise jobs are served before free-tier jobs.', 'Prompt and output safety checks with clear policy-violation responses.', 'Provenance on every image (C2PA manifest + invisible watermark) and delivery through a CDN.'],
  nonFunctional: ['Pro tier: time to images p95 &le; 10 s for standard quality and &le; 3 s for fast models; free tier best effort with an ETA.', 'Peak ~175 images/s (5 M images/day) without dropping accepted jobs.', 'GPU utilisation &ge; 70% averaged over the day; cost per image &le; $0.003 all-in.', 'Unsafe outputs reaching users &le; 1 in 10,000 images on red-team suites; zero tolerance for CSAM.', 'Jobs are durable: a worker crash never loses an accepted job or charges twice.', 'Images retained 30 days on the free tier, until deleted on paid tiers; GDPR deletion supported.'],
  outOfScope: ['Training base diffusion models (see the training cluster).', 'Video generation (same pattern with much longer jobs).', 'The consumer gallery and social features around images.'],
  estimates: [
    ['Requests', '1.25 M/day', 'API and app users; 4 images per request by default'],
    ['Images', '5 M/day; ~58/s average, ~175/s peak', '1.25 M &times; 4; evening and launch-day peaks ~3&times; average'],
    ['GPU time per image', '~1.0 GPU-second on average', 'Standard 30-step 1024&sup2;: ~5.5 s for a batch of 4 on an H100 &asymp; 1.5 GPU-s/image; distilled 4-step: ~0.3 GPU-s; traffic mix 60% standard / 40% fast'],
    ['GPUs at peak', '~235 H100-class', '175 images/s &times; 1.0 GPU-s = 175 GPUs busy &divide; 75% target utilisation'],
    ['GPUs on average', '~105', '58 images/s &times; 1.0 / 0.75; scale down to ~40 at night'],
    ['Storage', '~6 TB/day new', '5 M &times; ~1.2 MB (full-resolution PNG/WebP + thumbnails); free tier kept 30 days &asymp; 150 TB rolling'],
    ['CDN egress', '~4.5 TB/day (~420 Mbit/s average)', '5 M images &times; ~3 views &times; ~300 KB display WebP'],
    ['Safety checks', '~1.25 M prompt checks + 5 M image classifications/day', 'Every prompt and every output image'],
    ['Cost per image', '~$0.0015', 'GPU ~$0.0011 (1 GPU-s at ~$3/GPU-hour and 75% utilisation) + safety, storage, CDN and overhead ~$0.0004']
  ],
  compute: [
    ['GPU workers', '~105 H100s average, ~235 at peak, 40 floor', 'Peak 175 GPU-s of work per second at 75% utilisation. Utilisation is capped below 100% so queues stay short for the pro tier; free-tier work fills the gaps and can run on spot GPUs.'],
    ['Model residency', '1-3 model variants per GPU, weights on local NVMe', 'A ~12-24 GB fp16 model loads from local NVMe in ~10-20 s but from object storage in 1-2 min, so workers are pinned to models and pre-pull weights; LoRA adapters (50-300 MB) are cached per worker (LRU).'],
    ['Safety classifiers', '~4 GPUs (or co-located on workers)', 'Output checks: 175 images/s &times; ~10 ms each &asymp; 1.75 GPU-s/s, doubled for headroom and zones. Prompt checks: ~15/s average on CPU or a small GPU model.'],
    ['Job API', '4-6 pods of 2 vCPU', '~15 submissions/s at peak plus ~75 polls/s (clients poll every ~2 s for ~10 s): trivial CPU; most traffic should move to webhooks.'],
    ['Queues', 'One queue per (model variant, tier)', 'A few hundred messages/s at peak; queue depth, not throughput, is the interesting signal.'],
    ['Storage + CDN', 'Object storage with lifecycle tiers; CDN with signed URLs', '6 TB/day written once and read a few times; CDN hit rate high because each image URL is immutable.']
  ],
  api: [
    ['POST /v1/images/generations {prompt, model, size, steps, seed, n, lora, webhook_url}', 'Returns 202 Accepted {job_id, status_url, eta_s}. Idempotency-Key header so a client retry does not start (and bill) a second job.'],
    ['GET /v1/jobs/{id}', 'Status: queued (with position/ETA), running (progress %), succeeded (image URLs + C2PA info), blocked (policy category), failed. Clients poll with backoff.'],
    ['Webhook POST {job_id, status, images[]} (signed)', 'Sent on completion with an HMAC-SHA256 signature header and timestamp; retried with exponential backoff for 24 h; receivers must be idempotent.'],
    ['DELETE /v1/jobs/{id}', 'Cancels a queued job (no charge); running jobs finish but are discarded.'],
    ['POST /v1/loras {images[], trigger_word}', 'Custom style or subject fine-tune as an async job; training images are safety-screened and real-person likeness requires verified consent.'],
    ['GET /v1/images/{id}', 'Redirects (302) to a short-lived signed CDN URL; images are never served from public, guessable paths.']
  ],
  data: [
    ['Jobs', 'NoSQL document store', 'Partition key job_id; secondary index user_id + created_at. Prompt (or reference to it), parameters, seed, model + version, tier, status, safety verdicts, attempts, cost; TTL on free-tier jobs.'],
    ['Queues', 'Message queue per (model, tier)', 'Message = job_id + parameters (small); large inputs such as reference images go to blob storage with only a pointer in the message (claim-check pattern).'],
    ['Images', 'Object storage + CDN', 'Key tenant/yyyy/mm/dd/job_id/i.webp plus thumbnails; immutable names; C2PA manifest embedded; lifecycle deletion by tier.'],
    ['Models and LoRA adapters', 'Object storage + registry metadata', 'Model/adapter id, version, licence, owner, safety evaluation status; only approved versions are deployable.'],
    ['Safety audit log', 'Append-only (immutable) storage', 'Blocked prompts and flagged outputs with hashes, classifier scores, policy version, action; restricted access; retention per legal requirements.'],
    ['Usage and billing', 'Event stream &rarr; warehouse', 'One usage event per completed job (images, steps, resolution, GPU-seconds, tier) for billing and cost dashboards.']
  ],
  dbChoice: [
    ['Job state', 'NoSQL (Cosmos DB / DynamoDB)', 'Simple key access by job id, high write rate of status updates, TTLs, scales horizontally.', 'Relational DB: fine at small scale; status churn and TTLs fit a document store better.'],
    ['Work distribution', 'Durable queues (Service Bus / SQS)', 'At-least-once delivery, visibility timeouts for crash recovery, dead-letter queues, per-tier queues for priority.', 'Redis lists: fast but weaker durability; Kafka: ordering and replay are not needed here.'],
    ['Images', 'Object storage + CDN', 'Cheap, durable, lifecycle rules, direct CDN origin.', 'Database blobs: expensive and slow to serve.'],
    ['Safety records', 'Immutable append-only storage', 'Evidence must not be altered; supports audits and legal holds.', 'Ordinary logs: may be sampled, rotated or edited.']
  ],
  diagram: {
    nodes: [['u', 'Users / API clients', 'client', 0, 1.2, 'web, apps, partners'], ['gw', 'API gateway', 'apigw', 1, 1.2, 'auth, quotas, tiers'], ['api', 'Job API', 'svc', 2, 1.2, '202 + job id'],
      ['ps', 'Prompt safety', 'ai', 2, 0, 'classifiers + rules'], ['jobs', 'Job store', 'nosql', 3, 0, 'status, results'], ['q', 'Priority queues', 'queue', 3, 1.2, 'per model + tier'],
      ['wk', 'GPU workers', 'gpu', 4, 1.2, 'batching, LoRA cache'], ['lora', 'Models + LoRAs', 'blob', 4, 0, 'weights, adapters'], ['os', 'Output safety', 'ai', 5, 0, 'image classifiers'],
      ['blob', 'Image storage', 'blob', 5.2, 1.2, 'C2PA-signed outputs'], ['cdn', 'CDN', 'cdn', 1, 3.0, 'signed URLs'], ['ev', 'Job events', 'bus', 3.2, 2.9, 'completed, failed'],
      ['asc', 'Autoscaler', 'fn', 5, 2.6, 'KEDA: queue depth']],
    edges: [['u', 'gw'], ['gw', 'api'], ['api', 'ps'], ['api', 'jobs'], ['api', 'q'], ['q', 'wk'], ['wk', 'lora'], ['wk', 'os'], ['wk', 'blob'], ['blob', 'cdn'], ['u', 'cdn'],
      ['wk', 'ev', '', 'async'], ['ev', 'api', 'status, webhooks', 'async'], ['q', 'asc', 'depth'], ['asc', 'wk', 'scale']]
  },
  flows: [
    { name: 'Generate images', desc: 'The happy path: a pro user asks for four images of "a lighthouse in a storm, oil painting".', steps: [
      ['u', 'gw', 'POST /images/generations', 'The client submits the prompt and options with an Idempotency-Key.'],
      ['gw', 'api', 'tier: pro, quota ok', 'The gateway authenticates, applies per-tier rate limits (images per minute) and checks remaining credits.'],
      ['api', 'ps', 'check prompt', 'A text classifier and blocklists check the prompt in ~30 ms, before any GPU time is spent; an optional LLM rewriter can expand short prompts.'],
      ['api', 'jobs', 'create job (queued)', 'The job record is written first, so the job exists even if the client disconnects.'],
      { par: [['api', 'q', 'enqueue on standard/pro'], ['api', 'gw', '202 + job_id + ETA', 'resp']], msg: 'The job goes onto the queue for its model and tier, and the client immediately gets 202 Accepted with a status URL and an estimated wait. No HTTP connection is held open for seconds.' },
      ['q', 'wk', 'pull + batch', 'A worker that already has this model loaded pulls the job; the 4 images run as one batch of 4 (same model, size and LoRA) for ~5.5 s on an H100.'],
      ['wk', 'os', 'classify 4 images', 'Every image is classified (nudity, violence, minors, real-person likeness) before it is stored.'],
      ['wk', 'blob', 'store + C2PA + watermark', 'Passing images get an invisible watermark and a signed C2PA manifest (model, time, "AI generated"), then are written under immutable keys.'],
      ['wk', 'ev', 'job.completed', 'A completion event updates the job store and triggers the signed webhook to the client (or the next poll sees "succeeded").', 'async'],
      ['u', 'cdn', 'GET signed image URLs', 'The client downloads images from the CDN with short-lived signed URLs; total ~7-8 s from submit.']],
      end: 'Asynchronous jobs decouple a slow GPU task from HTTP; batching and resident models keep each GPU-second productive.' },
    { name: 'Unsafe prompt or output', desc: 'Safety on both sides of the model: a blocked prompt, then an innocent prompt that produces an unsafe image.', steps: [
      ['u', 'gw', 'violating prompt (real person)', 'A request that violates policy (sexual content involving a named real person).'],
      ['gw', 'api', 'forward', 'Normal routing.'],
      ['api', 'ps', 'check prompt', 'The classifier flags sexual content plus a real-person name.'],
      ['ps', 'api', 'block: policy category', 'Blocked before the queue: no GPU time spent, no image ever exists.', 'err'],
      ['api', 'gw', '400 policy_violation', 'A clear response with the policy category (not the classifier internals); repeated attempts raise the account’s risk score and can lead to suspension.', 'resp'],
      ['q', 'wk', 'a harmless prompt', 'Separately, a benign prompt runs on a worker.'],
      ['wk', 'os', 'classify output', 'One of the 4 images scores 0.93 for nudity, above the threshold for this product.'],
      ['os', 'wk', 'reject image 3', 'Image 3 is discarded and never stored; the worker may regenerate it once with a new seed. Images 1, 2 and 4 are delivered.', 'err'],
      ['wk', 'ev', 'safety event (hashed)', 'The decision is logged (hashes and scores, not the image) to the audit log. Suspected CSAM triggers a different path: immediate block, evidence preservation under strict access, and legally required reporting (for example to NCMEC in the US).', 'err']],
      end: 'Prompt checks save GPU time; output checks catch what prompts cannot predict. Neither alone is enough, and both are measured for false positives too.' },
    { name: 'Burst + priority tiers', desc: 'Launch day: traffic jumps 5×. Pro users must keep their latency; free users get a fair wait.', steps: [
      ['u', 'gw', '5× normal traffic', 'A viral launch floods the API.'],
      ['gw', 'api', 'per-tier rate limits', 'Free tier is limited to a few images per minute per user; excess requests get 429 with Retry-After before they create jobs.'],
      ['api', 'q', 'enqueue pro / free', 'Jobs land in separate queues per tier (priority queue pattern).'],
      ['q', 'asc', 'depth 40 k, oldest 90 s', 'The autoscaler watches queue depth and age of the oldest message per queue, not GPU utilisation.'],
      ['asc', 'wk', 'scale out +120 workers', 'KEDA computes workers = backlog ÷ (images per worker per minute × target wait). New GPU nodes take 2-5 minutes (provision, pull image, load model), so a warm pool of pre-loaded idle workers absorbs the first minutes.'],
      ['q', 'wk', 'pro queue first', 'Workers poll the pro queue first and the free queue only when pro is empty, with a small reserved share so free jobs never starve.'],
      ['api', 'gw', 'free tier: ETA 4 min', 'Free users see their queue position; if the ETA exceeds ~10 minutes new free jobs are refused with 503 + Retry-After instead of accepted and left to rot.', 'resp'],
      ['asc', 'wk', 'scale in after cooldown', 'After 15 minutes of short queues, workers drain (finish their batch) and are released; spot GPUs go first.']],
      end: 'Queue depth is the scaling signal, tiers are separate queues, and load shedding happens at admission, not after hours of waiting.' },
    { name: 'Worker crash', desc: 'Failure path: a GPU fails mid-batch. The job must finish exactly once, from the user’s point of view.', steps: [
      ['q', 'wk', 'lease job (visibility 120 s)', 'The worker receives the job; the message stays invisible to others while the worker renews its lease.'],
      ['wk', 'lora', 'load adapter', 'The worker loads the requested LoRA and starts denoising.'],
      ['wk', 'q', 'GPU error: lease lapses', 'An Xid error kills the worker process; it stops renewing the lease. Nothing was stored yet.', 'err'],
      ['q', 'wk', 'redeliver (attempt 2)', 'After the visibility timeout the queue redelivers the message to another worker with the same model.'],
      ['wk', 'blob', 'idempotent keys', 'Outputs are written to job_id/i keys, so a retry overwrites rather than duplicates, and the seed makes the result reproducible.'],
      ['wk', 'ev', 'completed (attempt 2)', 'The job completes; billing is triggered once, from the completion event keyed by job id.', 'async'],
      ['q', 'ev', 'after 3 attempts: dead-letter', 'A job that fails three times (for example a malformed LoRA) goes to the dead-letter queue; the job is marked failed, credits are refunded and on-call is alerted if the rate rises.', 'err']],
      end: 'At-least-once delivery plus idempotent outputs and billing gives effectively-once results; dead-letter queues stop poison jobs from looping.' }
  ],
  components: [
    ['API gateway', 'Authentication, per-tier rate limits and quotas, request size limits.'],
    ['Job API', 'Validates requests, runs prompt safety, creates jobs, enqueues work, serves status, sends webhooks.'],
    ['Prompt safety', 'Text classifiers, blocklists, named-person and minor policies, optional LLM prompt rewriting.'],
    ['Priority queues', 'One queue per model variant and tier; durable, at-least-once, dead-letter queues.'],
    ['GPU workers', 'Resident models, batching of compatible jobs, LoRA cache, watermarking and C2PA signing, upload.'],
    ['Output safety', 'Image classifiers for sexual content, violence, minors, likeness and other policy categories; CSAM detection and escalation.'],
    ['Autoscaler', 'Scales workers per model on queue depth and age; warm pool; scale-in with draining.'],
    ['Storage + CDN', 'Durable image storage with lifecycle rules; delivery through signed, short-lived CDN URLs.'],
    ['Usage and billing', 'Usage events per job; cost per image dashboards by model and tier.']
  ],
  deep: [
    ['Async API: 202, polling and webhooks', '<p>Generation takes 1-30 s and can wait minutes in a queue, so the API follows the asynchronous request-reply pattern: <code>POST</code> returns <code>202 Accepted</code> with a job id and a status URL; the client polls with backoff (honouring a <code>Retry-After</code> hint) or receives a signed webhook. Benefits: no long-held connections through load balancers, natural retries, and the ability to queue and prioritise. Details that matter:</p><ul><li><strong>Idempotency keys</strong> on submission so client retries never create or bill duplicate jobs.</li><li><strong>Webhook security:</strong> HMAC signature plus timestamp to prevent replay; retries with backoff; receivers deduplicate by job id.</li><li><strong>Progress:</strong> optional server-sent events stream step progress and low-resolution previews for interactive apps.</li><li><strong>Cancellation</strong> removes queued jobs; running batches finish and are discarded.</li></ul>'],
    ['Steps, latency and quality', '<p>Diffusion models denoise a latent image over N steps; each step is a full forward pass, so latency is roughly proportional to steps &times; pixels. Indicative numbers for a ~3 B-parameter model at 1024&times;1024 on one H100, one request of 4 images:</p><table><tr><th>Setting</th><th>Steps</th><th>Time for 4 images</th><th>Notes</th></tr><tr><td>High quality</td><td>50</td><td>~9 s</td><td>Small gains over 30 with modern samplers</td></tr><tr><td>Standard</td><td>25-30</td><td>~5.5 s</td><td>DPM-Solver++ / flow-matching samplers; baseline quality</td></tr><tr><td>Distilled</td><td>4-8</td><td>~0.8-1.5 s</td><td>Consistency / "lightning" style distillation; slightly less detail and diversity</td></tr><tr><td>Few-step turbo</td><td>1-2</td><td>~0.3 s</td><td>Adversarial distillation; live previews and sketch-to-image</td></tr></table><p>Other levers: classifier-free guidance doubles compute per step unless the model is guidance-distilled; doubling resolution to 2048&sup2; costs ~4-6&times; (more latent tokens, attention grows faster than linearly), so generate at 1024&sup2; and upscale with a cheaper model; FP8 inference, <code>torch.compile</code> or TensorRT, and cached text-encoder outputs each save 10-40%. Offer tiers ("fast" vs "quality") rather than one setting for everyone.</p>'],
    ['Batching and GPU efficiency', '<ul><li><strong>Batch compatible work:</strong> jobs with the same model, resolution and adapter can share a forward pass; one request of 4 images is already a batch of 4. Larger batches raise throughput per GPU but also latency, so the pro tier uses small batches and the free tier larger ones.</li><li><strong>Keep models resident:</strong> route jobs to workers that already hold the model (one queue per model). Swapping a 20 GB model costs more than generating several images.</li><li><strong>LoRA adapters:</strong> small low-rank weight deltas (tens to hundreds of MB) that add a style or subject. Cache them per worker, load in under a second from local disk, and group jobs by adapter; some runtimes apply several adapters in one batch.</li><li><strong>Model variants:</strong> separate pools for fast, standard and premium models, each autoscaled on its own queue, so a spike on one model does not starve others.</li><li><strong>Spot capacity:</strong> free-tier and batch jobs run on interruptible GPUs; a preempted job simply returns to the queue.</li></ul>'],
    ['Safety and provenance', '<p><strong>Before generation:</strong> prompt classifiers (sexual, violence, hate, self-harm), blocklists, policies on real people (no sexual or deceptive depictions; public figures restricted), minors, and prompt rewriting that removes risky details. Input images for editing get the same checks plus face/likeness detection.</p><p><strong>After generation:</strong> image classifiers on every output with per-product thresholds; images that fail are never stored. For CSAM: hash matching against known material for uploaded inputs, classifiers for generated outputs, immediate blocking, restricted evidence handling and legally required reporting. Models themselves are trained on filtered data and red-teamed before release (see <a href="../ai-evaluation/index.html#safety">safety metrics</a> and <a href="../content-moderation/index.html">content moderation</a>).</p><p><strong>Provenance:</strong> every image carries a <strong>C2PA content credential</strong>, a manifest saying it was AI-generated by this service and model, signed with a certificate whose key lives in an HSM (Key Vault / KMS). Metadata is easily stripped, so add an <strong>invisible watermark</strong> robust to resizing, cropping and JPEG compression, and offer a detection endpoint. The EU AI Act (Article 50, applying from August 2026) requires providers of generative systems to mark synthetic images in a machine-readable, detectable way.</p>'],
    ['Cost per image', '<table><tr><th>Item</th><th>Per image</th><th>How</th></tr><tr><td>GPU</td><td>~$0.0011</td><td>~1.0 GPU-s average &times; ~$3 per GPU-hour &divide; 3,600 &divide; 75% utilisation</td></tr><tr><td>Safety classifiers</td><td>~$0.0001</td><td>Prompt check amortised over 4 images + one image classification each</td></tr><tr><td>Storage</td><td>~$0.00003</td><td>1.2 MB for 30 days at ~$0.02 per GB-month</td></tr><tr><td>CDN</td><td>~$0.00005</td><td>3 views &times; 300 KB at ~$0.05 per GB</td></tr><tr><td>API, queue, DB, signing</td><td>~$0.0002</td><td>Small per-job overheads</td></tr><tr><td><strong>Total</strong></td><td><strong>~$0.0015</strong></td><td>5 M images/day &asymp; $7.5 k/day</td></tr></table><p>GPU time is ~75% of the cost, so the levers are: fewer steps (distilled models for drafts), lower default resolution with optional upscaling, higher utilisation (batching, spot for free tier, scale-in quickly), and newer GPUs or FP8 kernels. A free tier is affordable only with tight rate limits; a 4-image request at standard quality costs ~$0.006 to serve, versus typical list prices of a few cents per image.</p>']
  ],
  scale: [
    '<strong>GPU supply is the ceiling:</strong> reserve a baseline, burst with on-demand and spot across regions, and shed free-tier load at admission when capacity runs out.',
    '<strong>Cold starts:</strong> node provisioning plus model load takes minutes; keep a warm pool per popular model, pre-pull images and weights onto node-local NVMe.',
    '<strong>Many models and adapters:</strong> one queue per model variant; long-tail models scale to zero and accept higher latency; LoRAs share base-model workers.',
    '<strong>Queue backlog:</strong> scale on depth and oldest-message age; refuse new low-priority work when ETA exceeds a limit rather than building insurmountable backlogs.',
    '<strong>Storage growth:</strong> lifecycle rules (hot &rarr; cool &rarr; delete), thumbnails for galleries, original resolution only on request.',
    '<strong>Global users:</strong> GPU pools in a few regions; the CDN makes delivery fast everywhere, so generation does not need to be in every region.'
  ],
  tradeoffs: [
    ['API style', 'Synchronous HTTP vs async 202 + poll/webhook', 'Async: generation is slow and queue time is variable; synchronous only for sub-second turbo models in interactive UIs.'],
    ['Steps and model size', 'Quality (more steps, bigger model) vs latency and cost', 'Offer fast and quality tiers; default to a distilled model for drafts and the full model for finals.'],
    ['Batch size', 'Large batches (throughput) vs small (latency)', 'Small batches for pro, larger for free and offline jobs; tune per GPU type.'],
    ['Utilisation target', 'Run GPUs hot (cheap) vs keep headroom (short queues)', '~75% average: higher means pro-tier queues grow at every spike; lower wastes the most expensive resource.'],
    ['Safety thresholds', 'Strict (more false blocks) vs lenient (more unsafe outputs)', 'Per category and product: strict for minors and sexual content, calibrated for violence in artistic contexts; measure over-refusal as well.'],
    ['Build vs buy', 'Self-host open models vs hosted APIs (Foundry, Bedrock)', 'Hosted APIs for moderate volume and fastest start; self-host for custom models, LoRAs and control at high, steady volume.']
  ],
  failures: [
    ['GPU worker crash mid-job', 'Lease-based queue redelivery, idempotent output keys and billing, dead-letter after 3 attempts with refunds.'],
    ['Model fails to load or is corrupt', 'Checksums on weights, readiness probes that run a test generation, roll back to the previous model version.'],
    ['Safety classifier outage', 'Fail closed: hold outputs (jobs wait) rather than deliver unchecked images; alert and scale the classifier pool.'],
    ['Queue backlog grows faster than capacity', 'Autoscale on depth and age, warm pools, admission control with 429/503 and ETAs, shed free tier first.'],
    ['Webhook receiver down', 'Retries with exponential backoff for 24 h, then mark undelivered; clients can always poll.'],
    ['Abuse (mass generation of policy-violating prompts)', 'Per-account risk scores, rate limits, CAPTCHA or verification for free tiers, suspension, and trust-and-safety review.'],
    ['Signing key compromise', 'Keys in an HSM, short-lived signing certificates, rotation and revocation; manifests can be re-validated against revocation lists.']
  ],
  evals: [
    ['Prompt adherence', 'How well images match prompts on a fixed benchmark (GenEval-style object/count/colour checks, VQA-based scores)', 'No regression vs the current model; release only if overall score improves or holds'],
    ['Human preference', 'Pairwise win rate against the previous model on a stratified prompt set rated by people', '&ge; 50% (no loss) for a routine update; &ge; 55% to market as "better"'],
    ['Unsafe output rate', 'Share of delivered images violating policy, measured on red-team prompt suites after all filters', '&le; 0.01%; zero tolerance for sexual content involving minors'],
    ['Over-blocking', 'Share of benign prompts or images wrongly blocked', '&le; 1% on a benign evaluation set, tracked per category'],
    ['Provenance robustness', 'C2PA manifest present and valid; watermark detected after JPEG q75 + 50% resize + crop', '100% manifests; &ge; 95% watermark detection after transformations'],
    ['Latency', 'Submit-to-images time and queue wait by tier and model', 'Pro p95 &le; 10 s standard, &le; 3 s fast; pro queue wait p95 &le; 5 s'],
    ['Reliability', 'Jobs completed successfully (excluding policy blocks)', '&ge; 99.9%; duplicate charges zero'],
    ['Cost and efficiency', 'All-in cost per image and GPU utilisation', '&le; $0.003 per image; utilisation &ge; 70% daily average'],
    ['User outcome', 'Share of jobs where users download, keep or share at least one image; regenerate rate', 'Tracked per model; a rising regenerate rate signals quality problems']
  ],
  cloud: [['API gateway', 'apigw'], ['GPU worker pools (with KEDA)', 'k8s'], ['GPU compute', 'gpu'], ['Hosted image models (buy option)', 'aiplatform'], ['Priority job queues', 'queue'], ['Job store', 'nosql'], ['Image storage', 'blob'], ['Delivery', 'cdn'], ['Prompt safety', 'guardrails'], ['Image safety classification', 'vision'], ['Job events', 'pubsub'], ['Webhook sender', 'functions'], ['Rate limits and blocklists', 'cache'], ['C2PA signing keys (HSM)', 'secrets'], ['Container images', 'registry'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-asynchronous-request-reply', 'azp-queue-based-load-leveling', 'azp-priority-queue', 'azp-competing-consumers', 'azp-claim-check', 'azAutoscale', 'azAksBaseline', 'azEvalSafety'],
          aws: ['blBacklog', 'blShedding', 'awsGenAiLens', 'awsImage', 'blBackoff', 'awsServerlessLens'] },
  questions: [
    ['Why not just make the generation endpoint synchronous?', 'A standard image takes several seconds and can wait minutes in a queue during spikes. Holding HTTP connections that long breaks load balancer timeouts and mobile clients, makes retries dangerous (duplicate jobs) and prevents prioritisation. 202 + polling or webhooks is simpler and more robust; synchronous is reasonable only for sub-second turbo models.'],
    ['How many GPUs do you need?', 'Images per second at peak &times; GPU-seconds per image &divide; target utilisation. Here 175 &times; 1.0 / 0.75 &asymp; 235 H100s at peak and ~105 on average. The GPU-seconds per image depend on model, steps, resolution and batch size, so measure them per variant.'],
    ['How do you autoscale GPU workers?', 'On queue depth and the age of the oldest job per model and tier (KEDA or a custom controller), not on GPU utilisation, which is always high when busy. Keep a warm pool because new GPU nodes take minutes, scale in slowly with draining, and put free-tier work on spot capacity.'],
    ['How do you prevent harmful images?', 'Layers: prompt classifiers and policies before generation, output image classifiers before storage, model-level mitigations (filtered training data, red-teaming), account-level abuse detection and human trust-and-safety review. Measure unsafe output rate and over-blocking on labelled suites, and treat CSAM with zero tolerance, hash matching and legally required reporting.'],
    ['What is C2PA and why also watermark?', 'C2PA content credentials are a signed manifest attached to the file that records how it was made (here: AI-generated by this service). It is verifiable but easily stripped by re-encoding or screenshots, so an invisible watermark embedded in the pixels provides a second, more robust signal that detection tools can read.'],
    ['What is the cost per image and how would you halve it?', 'About $0.0015, ~75% GPU. Halve it by using distilled few-step models for drafts, defaulting to 1024&sup2; with optional upscaling, raising utilisation with batching and spot capacity, FP8/compiled inference, and newer GPUs with better price-performance.']
  ],
  related: ['llm-serving', 'content-moderation', 'job-scheduler', 'llm-gateway', 'video-streaming']
});

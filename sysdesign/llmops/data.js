SD.renderCase({
  slug: 'llmops',
  summary: 'LLM applications fail in ways ordinary monitoring cannot see: the HTTP call succeeds, latency is fine, and the answer is confidently wrong, unsafe or off-policy. An LLMOps platform gives every team building LLM apps the same safety net. A <strong>prompt and version registry</strong> treats prompts, model versions, parameters, tools and guardrail policies as immutable, versioned release bundles. <strong>Offline evaluation in CI</strong> runs each change against golden datasets with programmatic checks and LLM-as-judge scoring, and blocks merges that regress. <strong>Online evaluation</strong> samples production traces and scores them continuously. <strong>OpenTelemetry GenAI tracing</strong> records every model call, retrieval and tool step with tokens, cost and latency. A shared <strong>guardrail service</strong> filters inputs and outputs (PII, jailbreaks, harmful content, groundedness). <strong>Feedback capture</strong>, dashboards and alerts close the loop, and a <strong>dataset curation</strong> workflow turns production failures into new test cases. The metrics themselves are explained on the <a href="../ai-evaluation/index.html">AI evaluation page</a>; this design is the machinery that runs them.',
  examples: 'Langfuse, LangSmith, Arize Phoenix, Braintrust, Weights &amp; Biases Weave, MLflow GenAI, promptfoo and DeepEval in CI; Microsoft Foundry evaluations and observability, Amazon Bedrock Evaluations and Guardrails, Azure AI Content Safety; the Azure GenAIOps and AWS generative AI lifecycle guidance.',
  functional: ['Version prompts, model choices, parameters, tools and guardrail policies as immutable bundles with labels (production, staging, canary).', 'Run offline evaluation suites in CI on every change, with pass/fail gates on quality, safety, latency and cost.', 'Trace every request end to end (LLM calls, retrieval, tools, guardrail verdicts) with tokens, cost and latency.', 'Score a sample of production traces continuously with LLM-as-judge and programmatic evaluators.', 'Shared guardrail service: input and output filtering for PII, jailbreaks, harmful content and groundedness, configurable per app.', 'Capture user feedback, alert on regressions, and curate failing traces into versioned evaluation datasets.'],
  nonFunctional: ['Guardrails add &le; 150 ms p95 to a request (input + output checks).', 'Tracing is asynchronous and never on the critical path; &ge; 99% of requests produce complete traces.', 'A regression in production quality is detected within 1 hour of a rollout.', 'Privacy: PII redacted before storage, content capture configurable per app, retention 30 days for content and 1 year for metadata.', 'Evaluation and guardrail spend &le; 5% of the LLM bill.', 'Self-service for ~40 app teams, with per-app isolation of data and dashboards.'],
  outOfScope: ['Model serving and routing (see the LLM gateway and LLM inference platform).', 'Training or fine-tuning models.', 'The design of individual apps (see RAG assistant and AI agents).'],
  estimates: [
    ['Production LLM apps', '~40', 'Support assistants, internal copilots, document pipelines, agents'],
    ['User requests', '5 M/day; ~58/s average, ~175/s peak', '3&times; daytime peak'],
    ['LLM calls', '~20 M/day; ~700/s peak', '~4 calls per request (rewrite, retrieve, answer, judge or tool steps)'],
    ['Spans', '~40 M/day', '~8 spans per request (LLM calls, retrieval, tools, guardrails, app logic)'],
    ['Trace storage', '~115 GB/day raw, ~25 GB/day compressed', '5 M &times; (8 spans &times; 1 KB metadata + ~15 KB redacted prompt/completion content); 30 days hot &asymp; 750 GB compressed'],
    ['Guardrail checks', '~10 M/day; ~350/s peak', 'One input and one output check per request'],
    ['Online judged traces', '~125 k/day', '1% random sample (50 k) + every thumbs-down (3% feedback rate, half negative &asymp; 75 k)'],
    ['Online judge cost', '~$200/day', '125 k &times; ~4,000 tokens = 500 M tokens at ~$0.40 per million (small judge model)'],
    ['Offline CI evaluation', '~54 k case runs/day, ~$1,100/day', '30 PRs/day &times; 600 cases &times; 3 repeats; ~8,000 tokens each (app + judge) &asymp; 430 M tokens at ~$2.50 per million'],
    ['LLM spend being protected', '~$50 k/day', '20 M calls &times; ~2,500 tokens &asymp; 50 B tokens at ~$1 per million blended; evaluation &asymp; 2.6% of it']
  ],
  compute: [
    ['OpenTelemetry collectors', '3 agents (one per zone) + 2 gateway collectors of 4 vCPU', 'Peak 175 req/s &times; 8 = 1,400 spans/s (~25 MB/s with content); one collector core handles thousands of spans/s, so the gateway tier exists for tail sampling and redaction, not throughput.'],
    ['Guardrail classifiers', '3 L4-class GPUs (jailbreak / prompt-injection) + ~12 vCPU for PII', 'Peak 350 checks/s; a DeBERTa-sized classifier batched on one GPU handles ~400/s, so 2 GPUs plus 1 for zone loss. PII (regex + NER) at ~15 ms per check = ~5 busy cores, ~12 at 50% utilisation. Or use a managed content-safety API priced per call.'],
    ['Groundedness checks', '~105 checks/s peak, small judge or NLI model', 'Only RAG app outputs (~30%) are checked inline; a small model at ~150 ms per check fits the latency budget when run in parallel with streaming.'],
    ['Online evaluator workers', '4-8 queue workers', '125 k judgements/day &asymp; 1.5/s average; the limit is judge tokens per minute (~350 k TPM average), not CPU. Non-urgent scoring uses batch APIs at ~50% discount.'],
    ['CI evaluation runners', 'Autoscaled containers, concurrency 50 per PR', '1,800 case runs per PR &times; ~8,000 tokens = ~14 M tokens; at a 2 M TPM quota a PR gate finishes in ~7 minutes.'],
    ['Trace store', '3-node columnar cluster (16 vCPU, 2 TB SSD each)', '25 GB/day compressed &times; 30 days = 750 GB hot plus metadata for a year; aggregation queries across millions of spans in seconds.']
  ],
  api: [
    ['POST /prompts/{name}/versions {template, model, params, tools, guard_policy}', 'Creates an immutable version (content-hashed). Promotion moves a label (staging, production, canary with weight) instead of editing a version.'],
    ['GET /prompts/{name}?label=production', 'Resolves a label to a version; SDKs cache the result for ~60 s so the registry is never on the hot path and rollbacks spread in a minute without redeploys.'],
    ['POST /guard/input {app, text, user} / POST /guard/output {app, text, context_docs}', 'Returns {action: allow | redact | block, categories, scores, redacted_text, policy_version}; target p95 &le; 60 ms input, &le; 90 ms output.'],
    ['POST /v1/traces (OTLP)', 'Standard OpenTelemetry export of spans with gen_ai.* attributes; any app framework that speaks OTLP works.'],
    ['POST /feedback {trace_id, rating, comment, correction}', 'Thumbs, free text and corrected answers, linked to the trace that produced the answer.'],
    ['POST /eval-runs {app, prompt_version, dataset_version, evaluators[]}', 'Runs an offline suite (from CI or by hand); returns per-metric scores, confidence intervals and a gate verdict.'],
    ['POST /datasets/{id}/items {trace_id, expected, tags}', 'Promotes a reviewed production trace into a versioned evaluation dataset.']
  ],
  data: [
    ['Prompt versions (release bundles)', 'Relational DB (Git as source of truth)', 'prompt_id, version, content hash, template, model id, parameters, tool schemas, retrieval config, guard policy id; labels with canary weights. Versions are immutable.'],
    ['Traces and spans', 'Columnar store (ClickHouse / Azure Data Explorer)', 'Partitioned by day, ordered by (app_id, ts); trace_id, span_id, gen_ai.* attributes, tokens, cost, latency, prompt version, guard verdicts, eval scores. Content in a separate redacted table with a 30-day TTL.'],
    ['Evaluation datasets', 'Object storage + metadata DB', 'dataset_id, version, items (input, reference answer, rubric, tags, source trace_id); immutable snapshots; access-controlled because items may come from customer conversations.'],
    ['Evaluation runs and scores', 'Relational DB / warehouse', 'run_id, app, prompt_version, dataset_version, evaluator, judge_model, case_id, score, rationale; online scores keyed by trace_id.'],
    ['Feedback', 'NoSQL keyed by trace_id', 'rating, comment, correction, pseudonymous user id, ts; joined to traces for analysis and curation.'],
    ['Guardrail policies', 'Versioned config store', 'Per app: categories, thresholds, actions (block, redact, warn), fail-open or fail-closed, custom blocklists; every verdict records the policy version.']
  ],
  dbChoice: [
    ['Traces', 'Columnar analytics store', 'High ingest, compression and fast group-by over attributes (p95 latency by model and prompt version, cost by app).', 'Generic log search: costly at this volume and slower for aggregations; a relational DB will not keep up.'],
    ['Prompt registry', 'Relational DB with Git sync', 'Small data, transactional label moves, audit history; Git gives code review for prompt changes.', 'Prompts hard-coded in app code: every change needs a redeploy and nothing links outputs to versions.'],
    ['Evaluation datasets', 'Versioned object storage (Delta / lakeFS-style snapshots)', 'Immutable, reproducible snapshots referenced by eval runs; cheap for large multimodal items.', 'Spreadsheets: no versioning, so you cannot tell which test set a score came from.'],
    ['Scores and trends', 'Warehouse / columnar store', 'Trend lines per app, version and metric; joins with feedback and cost.', 'Keeping scores only inside the tracing UI: hard to build gates and reports on.']
  ],
  diagram: {
    nodes: [['users', 'Users', 'client', 0, 1.2, 'chat, copilots, APIs'], ['app', 'LLM app', 'svc', 1, 1.2, 'SDK + OTel'], ['guard', 'Guardrail service', 'ai', 2, 0.2, 'PII, jailbreak, grounded'],
      ['gw', 'AI gateway', 'apigw', 2, 1.2, 'routing, quotas, cost'], ['llm', 'Model APIs', 'llm', 3, 1.2, 'hosted + self-hosted'], ['preg', 'Prompt registry', 'db', 1, 2.2, 'versions, labels'],
      ['dev', 'Developers', 'user', 0.2, 3.3, 'prompts, PRs'], ['ci', 'CI eval gate', 'job', 1.3, 3.3, 'golden sets, red team'], ['otel', 'OTel collector', 'stream', 2.2, 2.3, 'GenAI spans'],
      ['traces', 'Trace store', 'tsdb', 3.3, 2.3, 'ClickHouse / ADX'], ['oe', 'Online evaluator', 'worker', 4.4, 2.3, 'LLM-as-judge, sampled'], ['dash', 'Dashboards + alerts', 'svc', 5.5, 1.3, 'quality, cost, safety'],
      ['ds', 'Eval datasets', 'blob', 4.4, 3.4, 'golden + curated'], ['rev', 'Human review', 'user', 5.5, 3.4, 'annotators, SMEs']],
    edges: [['users', 'app'], ['app', 'guard'], ['app', 'gw'], ['gw', 'llm'], ['app', 'preg'], ['dev', 'ci'], ['dev', 'preg'], ['ci', 'preg'], ['ci', 'ds'], ['app', 'otel', '', 'async'], ['gw', 'otel', '', 'async'],
      ['otel', 'traces', '', 'async'], ['traces', 'oe'], ['oe', 'llm', 'judge calls'], ['oe', 'dash'], ['oe', 'ds'], ['oe', 'rev'], ['rev', 'ds']]
  },
  flows: [
    { name: 'Guarded, traced request', desc: 'A user asks a support assistant a question. Guardrails wrap the model call and every step is traced.', steps: [
      ['users', 'app', 'question', 'A user asks about a refund. The app is built on the platform SDK.'],
      ['app', 'preg', 'support_agent@production', 'The SDK resolves the production label (cached for 60 s) to v15: template, model id, parameters, tools and guard policy, all pinned together.'],
      ['app', 'guard', 'input check', 'Jailbreak/prompt-injection classifier, PII detection (card numbers are redacted before they reach the model) and topic policy: ~40 ms.'],
      ['guard', 'app', 'allow (PII redacted)', 'Verdict with categories, scores and policy version.', 'resp'],
      ['app', 'gw', 'chat completion', 'The call goes through the AI gateway with app id, pseudonymous user id and prompt version as metadata for cost attribution.'],
      ['gw', 'llm', 'route to model', 'The gateway applies quotas, routing and failover (see the LLM gateway design).'],
      ['gw', 'app', 'completion + usage', 'Tokens stream back with usage counts.', 'resp'],
      ['app', 'guard', 'output check', 'Harmful-content and PII-leakage checks on the streamed answer in chunks; for RAG answers, a groundedness check against the retrieved documents. Ungrounded answers are replaced with "I could not find that in our policies".'],
      ['app', 'users', 'answer + feedback buttons', 'The user sees the answer with thumbs up/down.', 'resp'],
      { par: [['app', 'otel', 'app spans', 'async'], ['gw', 'otel', 'gateway spans', 'async']], msg: 'Spans follow the OpenTelemetry GenAI conventions (operation, model, token usage, finish reason) plus prompt version and guard verdicts. Content is captured only where the app’s policy allows, after redaction.' }],
      end: 'The app team wrote almost none of this: the SDK, registry, guardrails and tracing are platform defaults, so every app gets them consistently.' },
    { name: 'Offline eval gate in CI', desc: 'A developer changes the prompt. The change merges only if it passes the evaluation gate.', steps: [
      ['dev', 'ci', 'PR: prompt v16', 'A pull request edits the system prompt and adds a tool. Prompts live in Git next to the code and the eval config.'],
      ['ci', 'preg', 'register v16 (candidate)', 'CI registers an immutable candidate version, so the scores are attached to exactly what was tested.'],
      ['ci', 'ds', 'load golden set v7', '600 cases: common intents, edge cases, 10% unanswerable questions and 15% adversarial prompts, plus the red-team suite (see "Building evaluation datasets" on the AI evaluation page).'],
      ['ci', 'gw', 'run v16: 600 cases × 3', 'Each case runs three times to measure variance; programmatic checks (JSON schema, citation format, tool-call validity) run first because they are free.'],
      ['ci', 'gw', 'judge with rubrics', 'A different, calibrated judge model scores groundedness, correctness and helpfulness against references; red-team cases are scored for policy violations.'],
      ['gw', 'ci', 'scores + confidence intervals', 'Groundedness 0.93 (v15: 0.92), correctness 4.2 / 5 (4.1), jailbreak success 0.4%, cost per request +12%, p95 latency 4.1 s.', 'resp'],
      ['ci', 'dev', 'gate: pass, with cost warning', 'All hard gates pass; the cost increase is flagged for the reviewer. The report links to failing cases so the developer can read them.', 'resp'],
      ['ci', 'preg', 'label staging, canary 10%', 'After merge, v16 gets the staging label, then a 10% canary weight on production, watched by online evaluation.']],
      end: 'Gates compare against the current production version on the same dataset, so they catch regressions rather than chasing absolute scores.' },
    { name: 'Online eval and rollback', desc: 'v16 is in canary. Online evaluation notices quality dropping on real traffic.', steps: [
      ['otel', 'traces', 'spans (tail-sampled)', 'All metadata is kept; full content is kept for errors, guard hits, negative feedback and a random sample.', 'async'],
      ['traces', 'oe', '1% sample + thumbs-down', 'The evaluator pulls sampled traces and every negatively rated one.'],
      ['oe', 'llm', 'judge: groundedness, relevance', 'Rubric prompts score each trace; a cheap model handles most metrics, with a stronger model for disputed cases.'],
      ['oe', 'dash', 'groundedness 0.84 on v16', 'Canary traces score 0.84 vs 0.91 on v15 over 2,000 judged traces, beyond the confidence interval: the alert fires within the hour.', 'err'],
      ['dev', 'preg', 'move label back to v15', 'On-call sets the canary weight to 0. SDK caches pick it up within 60 s; nothing is redeployed.', 'err'],
      ['oe', 'rev', 'queue failing traces', 'Low-scoring traces go to human reviewers to confirm the judge and find the cause (the new tool’s output was being paraphrased loosely).']],
      end: 'Online evaluation catches what the golden set missed; versioned labels make rollback a one-line, one-minute change.' },
    { name: 'Feedback to dataset', desc: 'Closing the loop: a production failure becomes a permanent regression test.', steps: [
      ['users', 'app', 'thumbs-down + comment', '"It quoted last year’s refund window."'],
      ['app', 'otel', 'feedback event + trace_id', 'Feedback is linked to the exact trace, prompt version and retrieved documents.', 'async'],
      ['otel', 'traces', 'store', 'Stored with the trace.', 'async'],
      ['traces', 'oe', 'judge + cluster', 'The evaluator scores it and clusters similar failures by embedding, so reviewers see "outdated policy answers: 140 traces this week", not 140 tickets.'],
      ['oe', 'rev', 'triage queue', 'Prioritised by volume and severity.'],
      ['rev', 'ds', 'add case with reference', 'A reviewer writes the expected answer and failure tag, scrubs personal data, and adds the case to golden set v8.'],
      ['ci', 'ds', 'next PR runs v8', 'From now on every change is tested against this failure; the root cause (a stale index) is fixed in the retrieval pipeline.']],
      end: 'Every production failure should become a test case; that is how golden sets stay representative.' },
    { name: 'Jailbreak attempt', desc: 'Edge case: an attacker tries to extract the system prompt, and later the guardrail service itself is slow.', steps: [
      ['users', 'app', '"ignore your instructions..."', 'A prompt designed to override instructions and dump the system prompt.'],
      ['app', 'guard', 'input check', 'The jailbreak classifier scores 0.97.'],
      ['guard', 'app', 'block: jailbreak', 'Blocked before any tokens are spent.', 'err'],
      ['app', 'users', 'polite refusal', 'A generic, safe response; no detail about which rule fired.', 'resp'],
      ['app', 'otel', 'security event', 'The block is traced with the user and tenant ids.', 'async'],
      ['oe', 'dash', 'attempts up 30× for tenant', 'A spike from one tenant triggers a security alert and a tighter rate limit at the gateway.', 'err'],
      ['app', 'guard', 'guard timeout 300 ms', 'Later the guard service is overloaded. Policy decides: fail closed (block or queue) for high-risk apps, fail open with asynchronous re-checking and logging for low-risk internal tools.', 'err']],
      end: 'Guardrails are a service with SLOs and explicit failure policies, not a regex in each app; and no single filter is trusted alone.' }
  ],
  components: [
    ['Prompt and version registry', 'Immutable release bundles (prompt, model, parameters, tools, retrieval config, guard policy) with labels, canary weights and audit history.'],
    ['SDK', 'Resolves and caches prompt versions, calls guardrails, emits OpenTelemetry spans, captures feedback; one line per app to adopt.'],
    ['Guardrail service', 'Input, output and tool-call checks: prompt shields, jailbreak and injection classifiers, PII detection and redaction, harmful-content and groundedness checks; per-app policies.'],
    ['Tracing pipeline', 'OTel collectors with redaction and tail sampling; columnar trace store; cost and token attribution.'],
    ['Offline evaluation service', 'Runs suites from CI with programmatic checks and LLM judges; repeated runs, confidence intervals and gate verdicts.'],
    ['Online evaluator', 'Samples traces and feedback, scores them, detects drift between versions, feeds dashboards.'],
    ['Dashboards and alerts', 'Quality, safety, latency and cost per app and version; SLO-style alerts on judged metrics.'],
    ['Dataset curation', 'Human review queues, clustering of failures, versioned datasets with provenance back to traces.']
  ],
  evolutionTitle: 'From vibe checks to a closed evaluation loop',
  evolution: [
    { name: '1. Vibe checks', desc: 'Prompts in code, a few manual test questions before release, application logs only. Regressions are found by users.', diagram: { nodes: [['d', 'Developer', 'user', 0, 0.5], ['a', 'App', 'svc', 1, 0.5, 'prompt in code'], ['m', 'Model API', 'llm', 2, 0.5], ['l', 'App logs', 'tsdb', 1, 1.6]], edges: [['d', 'a'], ['a', 'm'], ['a', 'l', '', 'async']] },
      steps: [['d', 'a', 'edit prompt + deploy', 'Tested by trying a few questions.'], ['a', 'm', 'calls', 'No versions linked to outputs.'], ['a', 'l', 'logs', 'Logs show latency and errors, not answer quality.', 'async']] },
    { name: '2. Golden set + tracing', desc: 'A golden dataset runs in CI; prompts are versioned; traces show every step, token and cost.', diagram: { nodes: [['d', 'Developer', 'user', 0, 0.5], ['ci', 'CI eval', 'job', 1, 0.5, 'golden set'], ['r', 'Prompt registry', 'db', 2, 0.5], ['a', 'App', 'svc', 3, 0.5], ['t', 'Traces', 'tsdb', 3, 1.6, 'OTel GenAI']], edges: [['d', 'ci'], ['ci', 'r'], ['r', 'a'], ['a', 't', '', 'async']] },
      steps: [['d', 'ci', 'PR', 'Changes are evaluated before merge.'], ['ci', 'r', 'register version', 'Versions are immutable.'], ['r', 'a', 'label production', 'Apps resolve labels at runtime.'], ['a', 't', 'traces', 'Every step is visible.', 'async']] },
    { name: '3. Closed loop', desc: 'Online evaluation, guardrails, feedback and curation turn production into a continuous source of tests and alerts.', diagram: { nodes: [['a', 'App', 'svc', 0, 0.6], ['g', 'Guardrails', 'ai', 1, 0, 'in + out'], ['t', 'Traces', 'tsdb', 1, 1.2], ['o', 'Online evals', 'worker', 2, 1.2], ['ds', 'Datasets', 'blob', 3, 1.2], ['ci', 'CI gate', 'job', 3, 0]], edges: [['a', 'g'], ['a', 't', '', 'async'], ['t', 'o'], ['o', 'ds'], ['ds', 'ci']] },
      steps: [['a', 'g', 'checks', 'Every request is guarded.'], ['a', 't', 'traces + feedback', 'Production signals flow in.', 'async'], ['t', 'o', 'sample + judge', 'Continuous scoring and alerts.'], ['o', 'ds', 'curate failures', 'Failures become test cases.'], ['ds', 'ci', 'next release', 'And every release is tested against them.']] }
  ],
  deep: [
    ['Prompt and version registry', '<p>An LLM app’s behaviour is defined by more than code: the prompt template, model id <em>and version</em>, temperature and max tokens, tool schemas, retrieval settings (index version, top-k) and the guardrail policy. Bundle them into one immutable, content-hashed <strong>release</strong>. Then:</p><ul><li>Every trace records the release version, so any output can be explained and reproduced.</li><li>Every evaluation score is attached to a release and a dataset version.</li><li>Promotion and rollback move <strong>labels</strong> (production, staging, canary with a weight), never edit versions; SDK caches make the registry irrelevant to latency and availability.</li><li>Provider model upgrades are releases too: pin dated model versions and re-run the gate before moving.</li></ul><p>Keep Git as the source of truth (code review for prompts) and sync to the registry, so non-engineers can propose changes in a UI while engineers still get diffs and history.</p>'],
    ['Offline evaluation in CI', '<p>The gate runs the candidate release against a golden dataset and compares with the production release on the same data:</p><pre><code># eval-gate.yaml, checked in next to the prompt\ndataset: support-golden@v7      # 600 cases: 10% unanswerable, 15% adversarial\nrepeats: 3\nevaluators:\n  json_valid:     {type: programmatic, min: 1.0}\n  groundedness:   {judge: judge-small@2026-09, min: 0.90}\n  correctness:    {judge: judge-large@2026-09, min_mean: 4.0, max_regression: 0.1}\n  refusal_unanswerable: {min: 0.90}\n  jailbreak_rate: {suite: redteam@v12, max: 0.01}\n  p95_latency_s:  {max: 6}\n  cost_per_request: {max_increase: 0.15, action: warn}</code></pre><p>Good practice: programmatic checks first (cheap, deterministic); repeated runs and confidence intervals because outputs vary; gates on <em>regression</em> vs production as well as absolute floors; a hidden hold-out set the prompt authors never see, to avoid overfitting; and failing cases shown in the report. The thresholds above match the <a href="../ai-evaluation/index.html#targets">example release gates</a>.</p>'],
    ['Online evaluation and LLM-as-judge', '<p>Production traffic contains questions nobody put in the golden set. Online evaluation samples traces (1% random plus every negative-feedback, guard-hit and error trace), scores them with reference-free evaluators (groundedness against retrieved context, relevance, policy adherence, tool-call correctness) and aggregates by app, release and segment.</p><ul><li><strong>Calibrate judges:</strong> label ~200 traces by experts, measure agreement (Cohen’s kappa &ge; 0.7 is a reasonable bar; see the <a href="../ai-evaluation/index.html#methods">kappa calculator</a>), and re-check monthly and whenever the judge model changes.</li><li><strong>Known biases:</strong> position bias in pairwise comparisons (swap order), verbosity bias, self-preference (use a different model family as judge), and leniency drift.</li><li><strong>Statistics:</strong> compare canary vs control with confidence intervals; 2,000 judged traces detect a 3-point groundedness drop reliably, 50 do not.</li><li><strong>Cost:</strong> 125 k judgements/day &times; ~4,000 tokens on a small judge &asymp; $200/day; use batch APIs for non-urgent scoring and a stronger judge only for disputes. Keep total evaluation spend under ~5% of the LLM bill.</li></ul>'],
    ['Tracing with OpenTelemetry GenAI', '<p>Use the OpenTelemetry generative AI semantic conventions so traces work across frameworks and backends (Foundry observability, CloudWatch, Langfuse, Phoenix, Datadog and others). A model-call span looks like:</p><pre><code>span "chat gpt-4.1-mini"   kind=CLIENT   parent=retrieve_and_answer\n  gen_ai.operation.name        = "chat"\n  gen_ai.provider.name         = "azure.ai.openai"\n  gen_ai.request.model         = "gpt-4.1-mini"\n  gen_ai.request.temperature   = 0.2\n  gen_ai.usage.input_tokens    = 2140\n  gen_ai.usage.output_tokens   = 312\n  gen_ai.response.finish_reasons = ["stop"]\n  app.release                  = "support_agent@15"   # custom attributes\n  app.guard.output             = "allow"</code></pre><p>Agent and tool steps get their own spans (<code>execute_tool</code>, <code>invoke_agent</code>), so a slow or failing step is obvious. <strong>Content</strong> (prompts and completions) is opt-in per app, redacted in the collector, stored separately with a short TTL and access control, because traces are otherwise the largest leak of personal data in an LLM system. Tail sampling keeps everything interesting and a fraction of the rest.</p>'],
    ['Guardrail service', '<p>Defence in depth, configured per app (see the <a href="../ai-foundations/index.html#safety">risk table</a> and <a href="../ai-evaluation/index.html#safety">safety metrics</a>):</p><table><tr><th>Layer</th><th>Checks</th><th>Budget</th></tr><tr><td>Input</td><td>Jailbreak / direct prompt injection classifier, PII detection and redaction, topic and abuse policy, length limits</td><td>~40-60 ms</td></tr><tr><td>Retrieved content</td><td>Indirect prompt-injection detection on documents, emails and web pages; treat them as data, never instructions</td><td>~20-40 ms per document batch</td></tr><tr><td>Tool calls</td><td>Allow-lists, argument validation, human approval for side effects</td><td>Deterministic</td></tr><tr><td>Output</td><td>Harmful content (hate, violence, sexual, self-harm with severity levels), PII leakage, protected material, groundedness, schema validity</td><td>~50-90 ms, streamed in chunks</td></tr></table><p>Measure guardrails like models: precision and recall on labelled sets, <strong>over-refusal</strong> on benign prompts (safety that blocks legitimate users is a product bug), and latency. Decide failure behaviour per category: fail closed for high-risk apps and severe categories, fail open with logging and asynchronous re-checks for low-risk internal tools. Managed options include Azure AI Content Safety (prompt shields, groundedness detection, protected material) and Amazon Bedrock Guardrails.</p>']
  ],
  scale: [
    '<strong>Trace volume and cost:</strong> tail-sample content, keep metadata for everything, compress columnar storage, and set short TTLs on prompt/completion text.',
    '<strong>Judge throughput:</strong> rate limits on judge models cap online evaluation; use small judges, batch APIs and stratified sampling instead of scoring more traffic.',
    '<strong>Guardrail latency:</strong> run input checks in parallel with retrieval, stream output checks in chunks, and keep classifiers on GPUs close to the apps.',
    '<strong>Many teams:</strong> per-app projects with isolated data, shared evaluator libraries, and templates that wire SDK, gate and dashboards automatically.',
    '<strong>Dataset sprawl:</strong> version datasets, record provenance to traces, deduplicate near-identical cases, and retire stale ones when policies change.',
    '<strong>Provider model churn:</strong> treat model upgrades as releases with the same gates; keep evaluation history to compare across models over time.'
  ],
  tradeoffs: [
    ['Judge type', 'Human review vs LLM-as-judge vs programmatic checks', 'Programmatic wherever possible, LLM judges for scale (calibrated against humans), humans for calibration, disputes and high-stakes samples.'],
    ['Online sampling rate', 'Score everything vs sample', 'Sample ~1% plus all signals of trouble; scoring everything costs as much as a second production system and adds little statistical power.'],
    ['Guardrail failure mode', 'Fail open vs fail closed', 'Per app and category: closed for customer-facing and high-severity categories, open with async re-checks for low-risk internal tools.'],
    ['Content capture', 'Store full prompts and completions vs metadata only', 'Metadata always; redacted content for sampled and flagged traces with short retention; full content only in regulated, access-controlled debugging scopes.'],
    ['Build vs buy', 'Open-source stack (Langfuse/Phoenix + promptfoo) vs cloud services (Foundry, Bedrock) vs SaaS', 'Cloud services when your apps live there and data residency matters; open source for portability; keep OTel as the common format so the backend can change.'],
    ['Gate strictness', 'Hard gates on every metric vs warnings', 'Hard gates on safety and core quality; warnings on cost and latency increases so humans make the trade-off.']
  ],
  failures: [
    ['Judge drift or miscalibration', 'Monthly calibration against human labels; pin judge model versions; alert when judge-human agreement drops below kappa 0.6.'],
    ['Golden set no longer representative', 'Curation loop from production failures; coverage reports by intent; refresh when products or policies change; hidden hold-out set.'],
    ['Guardrail service outage or slowness', 'Per-app fail-open/closed policy, timeouts, local lightweight fallback filters, multi-zone deployment with GPU headroom.'],
    ['PII leaks into traces', 'Redaction in the SDK and again in the collector, content capture opt-in, short TTL, access control and periodic scans of stored content.'],
    ['Provider silently changes a model', 'Pin dated model versions; run the regression suite nightly against production releases; alert on score shifts with no release change.'],
    ['Trace pipeline backlog', 'Async export with bounded buffers (drop and count, never block requests); scale collectors; sampling under pressure.'],
    ['Over-blocking after a policy change', 'Evaluate guard policies on benign and adversarial sets before rollout; canary policy changes; track over-refusal per app.']
  ],
  evals: [
    ['Judge-human agreement', 'Cohen’s kappa between each LLM evaluator and expert labels on a calibration set', '&ge; 0.7 on ~200 items per evaluator; re-checked monthly and on judge model change'],
    ['Guardrail detection quality', 'Recall and false-positive rate on labelled jailbreak, injection and PII sets', 'Jailbreak recall &ge; 95% at FPR &le; 1%; PII recall &ge; 98%'],
    ['Over-refusal', 'Share of benign prompts blocked or refused by guardrails', '&le; 2% on the benign evaluation set'],
    ['Guardrail latency', 'Added latency of input + output checks', 'p95 &le; 150 ms combined; availability 99.95%'],
    ['App quality in production', 'Groundedness and hallucination rate from online judges, per app and release', 'Groundedness &ge; 0.90, hallucination &le; 3% (the <a href="../ai-evaluation/index.html#targets">release gates</a>)'],
    ['Time to detect a regression', 'Rollout to alert time for a quality drop; share of incidents caught by evals before user reports', '&le; 1 h; &ge; 80% caught by the platform first'],
    ['Evaluation coverage', 'Share of production apps with a CI gate, online evaluation and a maintained golden set', '100%; &ge; 200 cases per app, refreshed at least monthly'],
    ['Trace completeness and privacy', 'Requests with complete traces (tokens, cost, release); unredacted PII found in audits', '&ge; 99% complete; zero unredacted PII in sampled audits'],
    ['Cost of assurance', 'Evaluation + guardrail spend as a share of LLM spend; cost per request per app', '&le; 5% of LLM spend (~2.6% in the estimate)']
  ],
  cloud: [['Evaluation and tracing', 'aieval'], ['Guardrails / content safety', 'guardrails'], ['AI gateway', 'aigw'], ['Model APIs', 'llm'], ['AI application platform', 'aiplatform'], ['Monitoring and dashboards', 'monitor'], ['Trace analytics store', 'logs'], ['Span and event stream', 'stream'], ['Prompt registry DB', 'sql'], ['Feedback store', 'nosql'], ['Datasets and artefacts', 'blob'], ['Evaluation runners', 'containers'], ['CI/CD', 'GitHub Actions or Azure Pipelines', 'GitHub Actions or AWS CodePipeline'], ['Secrets', 'secrets'], ['Workforce identity', 'workforce']],
  refs: { az: ['azGenAiOps', 'azEvalHowTo', 'azObservability', 'azEvalSafety', 'azEvalRag', 'azEvalAgent', 'azApimAi', 'azGenGw'],
          aws: ['awsGenAiOps', 'awsBedrockEval', 'awsBedrockJudge', 'awsGenAiLens', 'awsClarifyFm', 'awsBedrockKbEval'] },
  questions: [
    ['Why is normal APM not enough for LLM apps?', 'A request can return 200 OK in 2 s and still be wrong, ungrounded, unsafe or off-policy. You need semantic evaluation (judges, programmatic checks, feedback), versioning of prompts and models to explain changes, and token-level cost tracking, on top of latency and errors.'],
    ['How do you trust an LLM judge?', 'Calibrate it: experts label a few hundred outputs, you measure agreement (Cohen’s kappa), fix rubrics until agreement is acceptable, and re-check regularly. Use a different model family from the app, swap positions in pairwise comparisons, and route disagreements to humans.'],
    ['What goes into a golden dataset and how big should it be?', 'Real anonymised questions across intents, edge cases, unanswerable questions, adversarial prompts and multi-turn cases, with references or rubrics. Start with 50-200 well-chosen cases; grow to 500-1,000+ for release decisions; keep a hidden hold-out; add every production failure. See <a href="../ai-evaluation/index.html#datasets">building evaluation datasets</a>.'],
    ['Guardrails add latency. How do you keep them fast?', 'Small specialised classifiers on GPUs instead of LLM calls for input checks; run them in parallel with retrieval; stream output checks in chunks rather than waiting for the full answer; skip groundedness checks for non-RAG apps; and set per-check budgets with explicit fail-open/closed rules.'],
    ['How do you roll back a bad prompt in production?', 'Move the production (or canary) label back to the previous immutable version in the registry. SDKs cache labels for about a minute, so all instances switch without a redeploy, and traces show the switch by release version.'],
    ['How do you control the cost of evaluation itself?', 'Programmatic checks first, small calibrated judges, stratified sampling instead of scoring everything, batch APIs for non-urgent work, caching of judge results for unchanged cases in CI, and a budget expressed as a share of LLM spend.']
  ],
  related: ['llm-gateway', 'rag-assistant', 'agentic-ai', 'observability', 'ai-evaluation']
});

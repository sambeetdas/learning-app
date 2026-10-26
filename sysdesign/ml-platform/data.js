SD.renderCase({
  slug: 'ml-platform',
  summary: 'An ML platform turns models from notebook experiments into reliable production services, repeatably, for many teams. It provides paved roads for the whole lifecycle: <strong>data and feature pipelines</strong> feeding a <strong>feature store</strong> (offline for training, online for serving, point-in-time correct); <strong>experiment tracking</strong>; <strong>training pipelines</strong> defined as code on shared CPU/GPU pools; a <strong>model registry</strong> with versioning, evaluation gates and approvals; <strong>CI/CD for models</strong> that deploys to online endpoints or batch scoring through shadow and canary stages; <strong>monitoring</strong> of data drift, prediction drift and real performance once labels arrive; <strong>automated retraining</strong> triggers; and <strong>lineage and governance</strong> so anyone can answer "which data, code and approvals produced the model that made this decision?". The goal is to cut the time from idea to safe production from months to days, while making every model observable and reversible.',
  examples: 'Uber Michelangelo, Airbnb Bighead, Netflix Metaflow, Meta FBLearner, Spotify’s ML platform; built on Azure Machine Learning, Amazon SageMaker AI, Databricks/MLflow, Kubeflow, Vertex AI; the Azure MLOps v2 and AWS ML Lens reference designs.',
  functional: ['Data scientists track experiments and register models with full lineage (data snapshot, code commit, environment, parameters).', 'Feature definitions are shared: computed once, served offline for training and online for low-latency inference.', 'Training pipelines run as code on demand, on schedules or on triggers, using shared CPU/GPU pools.', 'Models move through registry stages with automated evaluation gates and human approval for high-risk models.', 'One-command deployment to real-time endpoints or batch scoring, with shadow, canary and instant rollback.', 'Monitoring of data drift, prediction drift, performance and fairness, with alerts and retraining triggers.'],
  nonFunctional: ['Serve ~200 production models; ~50,000 online predictions/s at peak with p99 &le; 50 ms.', 'Commit-to-production lead time &le; 1 day for a routine retrain; rollback in &le; 5 minutes.', 'Reproducibility: any production model can be rebuilt from its registry record.', '99.95% availability for online endpoints; batch scoring finishes within its window.', 'Multi-tenant: team isolation, quotas, cost attribution; least-privilege access to data.', 'Auditability for regulators: lineage, approvals and model cards retained for the model’s lifetime plus years.'],
  outOfScope: ['Foundation-model pre-training at thousands of GPUs (see the training cluster).', 'LLM-specific prompt evaluation and guardrails (see LLMOps).', 'BI dashboards and general data warehousing.'],
  estimates: [
    ['Data scientists and ML engineers', '~300', 'A large enterprise with ~40 ML teams'],
    ['Experiment runs', '~2,000/day', '300 people &times; ~7 runs/day (including hyperparameter sweeps)'],
    ['Production models', '~200 (60 online, 140 batch)', 'Fraud, pricing, churn, recommendations, forecasting, document classifiers'],
    ['Online predictions', '~50,000/s peak; ~1.5 B/day', 'Sum over online models; fraud and ranking dominate'],
    ['Online feature reads', '~150,000/s', '50 k predictions/s &times; ~3 entity lookups (customer, merchant, device)'],
    ['Online feature store size', '~500 GB', '200 M entities &times; ~2.5 KB of features'],
    ['Offline data', '~2 PB in the lakehouse; ~20 TB scanned/day by feature jobs', 'Raw events, curated tables, feature history'],
    ['Training compute', '~1,000 GPU-hours/day + ~20,000 vCPU-hours/day', '500 GPU runs &times; ~2 h; 1,500 CPU runs (trees, sweeps)'],
    ['Prediction logs', '~1.5 TB/day', '1.5 B predictions &times; ~1 KB (inputs, outputs, model version) for monitoring and label joins']
  ],
  compute: [
    ['Online inference', '~85 pods of 4 vCPU at peak; ~110 across 3 zones (plus a few GPU nodes)', '50,000 req/s &times; ~4 ms CPU (gradient-boosted trees and small nets) = 200 busy cores &rArr; ~333 cores at 60% &rArr; ~84 pods; zone-loss headroom &times; 1.33. Deep models (images, text) run on a small GPU node pool.'],
    ['Online feature store', 'Redis cluster: 6 shards of ~100 GB, each with a replica', '150,000 reads/s is easy for 6 shards (~100 k ops/s each); memory sets the shard count: 500 GB / 6 &asymp; 83 GB plus headroom.'],
    ['Training GPU pool', '~64 GPUs (A100/H100 mix), queue-based sharing', '1,000 GPU-hours/day / 24 h &asymp; 42 GPUs busy on average; 64 gives headroom for daytime peaks. Spot/low-priority capacity for sweeps, with checkpointing.'],
    ['Training CPU pool', 'Autoscaling 0-1,500 vCPU', '20,000 vCPU-hours/day &asymp; 830 vCPU average, bursting during working hours; scale to zero at night except scheduled retrains.'],
    ['Feature pipelines', 'Spark jobs on autoscaling clusters + Flink ~40 vCPU', '20 TB/day scanned at ~100 MB/s per core &asymp; 55 core-hours of scan, done in ~1 h windows; streaming features for ~100 k events/s.'],
    ['Monitoring jobs', 'Hourly Spark jobs, ~200 vCPU-hours/day', '200 models &times; hourly drift statistics on sampled windows + daily performance joins when labels land.']
  ],
  api: [
    ['mlflow.log_params / log_metrics / log_model (SDK)', 'Experiment tracking from notebooks and pipelines; each run records code commit, data snapshot id, environment image digest and seed.'],
    ['POST /registry/models/{name}/versions', 'Register a model version with artefact URI, signature (input/output schema), lineage and evaluation results; returns an immutable version number.'],
    ['POST /registry/models/{name}/versions/{v}/approve {approver, evidence}', 'Approval gate: required for high-risk models; records who approved, against which evaluation report and model card.'],
    ['POST /pipelines/{id}/runs {params, trigger}', 'Start a training pipeline (manual, schedule, drift trigger); idempotency key prevents duplicate retrains from repeated alerts.'],
    ['POST /v2/models/{name}/infer (Open Inference Protocol)', 'Online prediction on a versioned endpoint; response includes model version and request id for logging and label joins.'],
    ['GET /features/online?entity=customer:123&set=fraud_v3', 'Online feature retrieval by feature-set version (usually via the SDK inside the serving container).'],
    ['event model.drift_detected {model, feature, psi}', 'Monitoring emits events that open tickets and can trigger retraining pipelines.']
  ],
  data: [
    ['Feature definitions', 'Git + feature registry (catalogue)', 'feature_set, version, entity keys, source query/transform, owner, freshness SLA, PII tags; reviewed like code.'],
    ['Offline features', 'Lakehouse tables (Delta / Iceberg)', 'Partitioned by date; entity_id + event_timestamp for point-in-time joins; time travel to reproduce old training sets.'],
    ['Online features', 'Redis / Cosmos DB / DynamoDB', 'Key = feature_set:entity_id &rarr; packed values + timestamp; TTL per feature; materialised from offline or streaming jobs.'],
    ['Experiments and runs', 'Relational DB (tracking server) + object storage', 'run_id, experiment, params, metrics time series, tags; artefacts (plots, models) in blob storage.'],
    ['Model registry', 'Relational metadata + immutable object storage', 'model, version, artefact URI, signature, lineage (data snapshot, commit, image digest), stage/alias (champion, challenger), approvals, model card.'],
    ['Prediction logs and labels', 'Event stream &rarr; lakehouse', 'request_id, model_version, features, prediction, ts; labels joined later by request_id or entity + time; partitioned by model and date.'],
    ['Lineage graph', 'Data catalogue (OpenLineage events)', 'Datasets &rarr; jobs &rarr; features &rarr; models &rarr; endpoints; answers impact analysis ("which models use this column?").']
  ],
  dbChoice: [
    ['Offline features and training data', 'Lakehouse (Delta / Iceberg on object storage)', 'Petabyte scale, cheap, columnar, time travel for reproducibility; Spark and SQL engines read it directly.', 'Warehouse only: good SQL, but costlier for large training scans and awkward for unstructured data.'],
    ['Online features', 'In-memory key-value (Redis) or low-latency NoSQL', 'Single-digit-ms lookups at 150 k reads/s; TTLs for freshness.', 'Querying the lakehouse at request time: seconds of latency.'],
    ['Registry and tracking metadata', 'Relational (PostgreSQL / Azure SQL)', 'Transactions for stage transitions and approvals; relational queries over runs and versions; small data.', 'Document store: workable, but approvals need transactional integrity.'],
    ['Lineage', 'Catalogue with graph model (Purview, Unity Catalog, DataZone, Marquez)', 'Graph traversal for impact analysis and audits; standard OpenLineage ingestion.', 'Wiki pages and spreadsheets: always out of date.']
  ],
  diagram: {
    nodes: [['ds', 'Data scientists', 'user', 0, 0.2, 'notebooks, SDK'], ['git', 'Git + CI', 'svc', 1, 0.2, 'tests, pipeline code'], ['tp', 'Training pipelines', 'job', 2, 0.2, 'CPU / GPU pools'],
      ['reg', 'Model registry', 'ml', 3, 0.2, 'versions, approvals'], ['et', 'Experiment tracking', 'db', 3, 1.3, 'runs, metrics, artefacts'], ['cd', 'Deployment (CD)', 'svc', 4, 0.2, 'shadow, canary'],
      ['srv', 'Online serving', 'ml', 5, 1.0, 'versioned endpoints'], ['app', 'Applications', 'client', 6, 1.0, 'call predict APIs'], ['batch', 'Batch scoring', 'job', 5, 2.4, 'nightly, Spark'],
      ['src', 'Source data', 'db', 0, 2.4, 'OLTP, events, files'], ['fp', 'Feature pipelines', 'job', 1, 2.4, 'Spark / Flink'], ['fs', 'Feature store', 'cache', 2, 2.4, 'offline + online'],
      ['mon', 'Monitoring', 'svc', 4, 3.2, 'drift, performance'], ['trig', 'Retrain trigger', 'fn', 3, 3.2, 'drift / schedule']],
    edges: [['ds', 'git'], ['git', 'tp'], ['tp', 'et'], ['tp', 'reg'], ['reg', 'cd'], ['cd', 'srv'], ['cd', 'batch'], ['app', 'srv'], ['src', 'fp'], ['fp', 'fs'], ['fs', 'tp', 'training sets'],
      ['srv', 'fs', 'online features'], ['batch', 'fs'], ['srv', 'mon', 'prediction logs', 'async'], ['batch', 'mon', '', 'async'], ['mon', 'trig', '', 'async'], ['trig', 'tp']]
  },
  flows: [
    { name: 'Train and register', desc: 'A data scientist improves the fraud model. Everything that produced it is captured so it can be reviewed and reproduced.', steps: [
      ['ds', 'git', 'push pipeline + config', 'Training code, pipeline definition and config are committed; notebooks are for exploration, pipelines are what run in production.'],
      ['git', 'tp', 'CI: tests, run pipeline', 'CI runs unit tests, data-validation checks and a small smoke training, then submits the full pipeline to the shared GPU/CPU pool.'],
      ['tp', 'fs', 'point-in-time training set', 'The pipeline asks the feature store for labels joined with features as of each event time, so there is no leakage from the future.'],
      ['fs', 'tp', 'snapshot 2026-10-25', 'The training set is materialised as an immutable, versioned snapshot; its id goes into lineage.', 'resp'],
      ['tp', 'et', 'log params, metrics', 'Every run logs parameters, metrics curves, the environment image digest and artefacts; hundreds of sweep runs are comparable side by side.'],
      ['tp', 'reg', 'register v13 + lineage', 'The best run is registered with its signature, data snapshot, commit and evaluation report (overall and per segment), plus a draft model card.'],
      ['reg', 'cd', 'gate: beats champion?', 'Automated gate: AUC not worse than champion v12 on the same holdout, no slice regresses > 1 point, fairness metrics within limits, latency test passed. High-risk models also need a named approver.']],
      end: 'Reproducibility comes from pinning data snapshot, code, environment and seed in the registry, not from someone’s notebook.' },
    { name: 'Deploy: shadow, canary', desc: 'Model v13 is approved. It must prove itself on live traffic before it takes over.', steps: [
      ['reg', 'cd', 'v13 approved', 'Approval moves alias "challenger" to v13; the CD pipeline starts (GitOps: the deployment manifest change is itself reviewed).'],
      ['cd', 'srv', 'deploy v13 in shadow', 'v13 receives a mirrored copy of live requests; its answers are logged but not returned.'],
      ['app', 'srv', 'live traffic', 'Applications keep calling the same endpoint; v12 still answers.'],
      ['srv', 'mon', 'compare v12 vs v13', 'Monitoring compares score distributions, latency and agreement between champion and challenger on identical inputs.', 'async'],
      ['cd', 'srv', 'canary 5%', 'Shadow looks healthy, so 5% of traffic is now answered by v13 (by request hash, so retries stay consistent).'],
      ['srv', 'mon', 'canary metrics', 'Error rate, p99 latency, decline rate and early business signals compared with the control 95%.', 'async'],
      ['cd', 'srv', 'promote to 100%', 'After the bake time with no alarms, v13 becomes champion; v12 stays deployed for a while for instant rollback.'],
      ['cd', 'batch', 'update batch scoring', 'Batch jobs pin the same registry alias, so tonight’s batch run uses v13 as well.']],
      end: 'Shadow catches crashes and odd distributions with zero user impact; canary catches real-world regressions with limited blast radius.' },
    { name: 'Online prediction', desc: 'A payment needs a fraud score within 50 ms.', steps: [
      ['app', 'srv', 'POST /infer {txn}', 'The payment service sends the transaction (amount, merchant, device id).'],
      ['srv', 'fs', 'get online features', 'The serving container fetches customer and merchant features (e.g. spend in last 1 h, chargeback rate) from the online store.'],
      ['fs', 'srv', 'features (~2 ms)', 'Batched lookups return in a couple of milliseconds; streaming features are seconds old.', 'resp'],
      ['srv', 'app', 'score 0.92 + model v13', 'The response includes model version and request id. The application decides the action (block, step-up authentication).', 'resp'],
      ['srv', 'mon', 'log prediction', 'Inputs, output, version and latency are logged asynchronously (never on the request path).', 'async'],
      ['batch', 'mon', 'join chargeback labels', 'Weeks later chargebacks arrive; a daily batch job joins them to logged predictions by request id, so real precision and recall can be computed.', 'async']],
      end: 'The online path is just features plus a model; everything slow (logging, label joins, monitoring) is asynchronous.' },
    { name: 'Drift and retrain', desc: 'Customer behaviour shifts after a holiday promotion; the platform notices and retrains.', steps: [
      ['mon', 'trig', 'PSI 0.31 on basket_value', 'Hourly drift job: the population stability index of a key feature exceeds 0.25 against the training baseline, and prediction drift is also up.', 'err'],
      ['trig', 'tp', 'start retrain (idempotent)', 'The trigger checks there is enough new labelled data and no retrain already running, then starts the pipeline with a fresh window.'],
      ['tp', 'fs', 'new training window', 'Point-in-time training set over the last 90 days, now including the promotion period.'],
      ['tp', 'et', 'log run', 'The run is tracked like any other.'],
      ['tp', 'reg', 'register challenger v14', 'Gate: v14 must beat v13 on recent data and not regress on older holdouts or fairness slices.'],
      ['reg', 'cd', 'auto-approve (low risk)', 'Low-risk models with passing gates deploy automatically; high-risk ones wait for human approval with the drift report attached.'],
      ['cd', 'srv', 'shadow, then canary', 'Same safe rollout as any other change.']],
      end: 'Retraining is a pipeline run with the same gates as a human change; drift alone does not justify a deploy, only a better model does.' },
    { name: 'Bad canary', desc: 'Failure path: challenger v14 passes offline gates but misbehaves on live traffic.', steps: [
      ['cd', 'srv', 'canary 5% v14', 'v14 starts serving 5% of traffic.'],
      ['srv', 'mon', 'canary metrics', 'Live metrics stream to monitoring.', 'async'],
      ['mon', 'cd', 'decline rate +40% in canary', 'Guardrail breached: the canary declines far more payments than control. Root cause later: a feature’s units changed upstream (pence vs pounds), a skew the offline snapshot did not show.', 'err'],
      ['cd', 'srv', 'automatic rollback', 'Traffic returns to v13 within minutes; no human needed to start the rollback.', 'err'],
      ['cd', 'reg', 'mark v14 rejected', 'The registry records the failure and evidence; v14 cannot be promoted again without a new version.'],
      ['mon', 'trig', 'pause auto-retrain', 'Automatic retraining for this model is paused until the data issue is fixed, so it does not keep producing bad challengers.'],
      ['fp', 'fs', 'fix + backfill feature', 'The feature pipeline is fixed, the online and offline values are backfilled, and a skew check is added to the gate.']],
      end: 'Offline gates cannot catch everything; automated canary analysis and fast rollback are the real safety net.' }
  ],
  components: [
    ['Feature pipelines + feature store', 'Batch and streaming feature computation from shared definitions; offline store for training, online store for serving; point-in-time retrieval; freshness monitoring.'],
    ['Experiment tracking', 'Runs, parameters, metrics and artefacts for comparison and reproducibility (MLflow, Azure ML, SageMaker Experiments).'],
    ['Training pipelines', 'Pipelines as code (Azure ML pipelines, SageMaker Pipelines, Kubeflow, Airflow) on shared, quota-managed compute pools.'],
    ['Model registry', 'Versioned models with signatures, lineage, evaluation reports, aliases (champion/challenger), approvals and model cards.'],
    ['CI/CD for models', 'Tests for code, data and models; evaluation gates; GitOps deployments; shadow, canary, rollback.'],
    ['Serving', 'Real-time endpoints (autoscaled containers, KServe, managed endpoints) and batch scoring jobs, both pinned to registry versions.'],
    ['Monitoring', 'Data drift, prediction drift, performance with delayed labels, fairness, latency and cost per model; alerts and dashboards.'],
    ['Retraining triggers', 'Schedules and event-driven triggers with idempotency, data sufficiency checks and pause switches.'],
    ['Lineage and governance', 'OpenLineage-based catalogue, access policies, audit logs, risk classification and approvals.']
  ],
  evolutionTitle: 'MLOps maturity: from notebooks to automated pipelines',
  evolution: [
    { name: '1. Manual (level 0)', desc: 'A data scientist trains in a notebook and hands a pickle file to engineers, who rewrite the feature code for production. Slow, unreproducible and full of skew.', diagram: { nodes: [['ds', 'Data scientist', 'user', 0, 0.5], ['nb', 'Notebook', 'svc', 1, 0.5, 'ad hoc training'], ['f', 'model.pkl', 'blob', 2, 0.5, 'emailed / shared drive'], ['app', 'App server', 'svc', 3, 0.5, 'features rewritten']], edges: [['ds', 'nb'], ['nb', 'f'], ['f', 'app']] },
      steps: [['ds', 'nb', 'train by hand', 'Data pulled with ad hoc queries.'], ['nb', 'f', 'save pickle', 'No record of which data or code produced it.'], ['f', 'app', 'hand over', 'Engineers re-implement features: training-serving skew is almost guaranteed; months per release.']] },
    { name: '2. Pipelines + registry (level 1)', desc: 'Training becomes a pipeline that can be re-run; models are registered with lineage; a feature store removes duplicate feature code.', diagram: { nodes: [['ds', 'Data scientist', 'user', 0, 0.5], ['tp', 'Training pipeline', 'job', 1, 0.5], ['fs', 'Feature store', 'cache', 1.5, 1.6], ['reg', 'Registry', 'ml', 2, 0.5], ['srv', 'Endpoint', 'ml', 3, 0.5]], edges: [['ds', 'tp'], ['fs', 'tp'], ['tp', 'reg'], ['reg', 'srv'], ['srv', 'fs']] },
      steps: [['ds', 'tp', 'run pipeline', 'Training is code and can be re-run on new data.'], ['fs', 'tp', 'features', 'Shared definitions for training...'], ['tp', 'reg', 'register', 'Versioned models with lineage.'], ['reg', 'srv', 'deploy', 'Deployment from the registry, still triggered manually.'], ['srv', 'fs', 'same features', '...and for serving: no rewrite, no skew.']] },
    { name: '3. CI/CD + monitoring (level 2)', desc: 'Commits trigger tested pipelines; gates and approvals decide promotion; monitoring triggers retraining; rollouts are progressive and reversible.', diagram: { nodes: [['git', 'Git + CI', 'svc', 0, 0.5], ['tp', 'Pipelines', 'job', 1, 0.5], ['reg', 'Registry + gates', 'ml', 2, 0.5], ['cd', 'CD: canary', 'svc', 3, 0.5], ['mon', 'Monitoring', 'svc', 2, 1.7], ['srv', 'Serving', 'ml', 4, 0.5]], edges: [['git', 'tp'], ['tp', 'reg'], ['reg', 'cd'], ['cd', 'srv'], ['srv', 'mon', '', 'async'], ['mon', 'tp', 'retrain', 'async']] },
      steps: [['git', 'tp', 'commit triggers', 'Every change is tested and trained automatically.'], ['tp', 'reg', 'gated registration', 'Evaluation gates and approvals.'], ['reg', 'cd', 'promote', 'Progressive delivery.'], ['cd', 'srv', 'canary', 'Limited blast radius, automatic rollback.'], ['srv', 'mon', 'logs', 'Drift and performance monitoring.', 'async'], ['mon', 'tp', 'trigger retrain', 'The loop closes.', 'async']] }
  ],
  deep: [
    ['Feature store and data pipelines', '<p>A feature store is a contract between data engineering and modelling: a feature (for example <code>customer.spend_1h</code>) is defined once with its entity key, source, transformation, freshness SLA and owner, then:</p><ul><li><strong>Materialised offline</strong> with full history (entity, value, event timestamp) so training can do <strong>point-in-time joins</strong>: for each label at time t, take the latest value with timestamp &le; t.</li><li><strong>Materialised online</strong> (latest value per entity) by scheduled batch jobs or streaming jobs for second-level freshness.</li><li><strong>Validated</strong>: schema, null rate, range and distribution checks run in the pipeline; a failed check blocks materialisation instead of silently feeding bad data to 30 models.</li></ul><p>Reuse is the economic win: a fraud feature built by one team is discoverable and used by five others. Skew is the reliability win: training and serving read the same values. Managed options: Azure ML managed feature store, SageMaker Feature Store, Databricks Feature Engineering, Feast. See <a href="../recommendation/index.html">recommendation</a> for a heavy user of streaming features.</p>'],
    ['Registry, approvals and governance', '<p>Each model version in the registry carries: artefact and signature (input/output schema), lineage (training-set snapshot, code commit, environment image digest, parameters, seed), evaluation report (overall, per slice, fairness), a <strong>model card</strong> (intended use, limitations, owners) and its approval history. Aliases such as <code>champion</code> and <code>challenger</code> decouple deployment manifests from version numbers.</p><p><strong>Risk tiers</strong> decide the process: a low-risk internal forecasting model can auto-promote when gates pass; a credit-scoring or hiring model (high-risk under the EU AI Act) needs documented data governance, human approval by a risk owner, bias testing, human oversight and logging of decisions. Lineage is collected automatically (OpenLineage events from Spark, pipelines and serving) into a catalogue so you can answer: which models consume this column, which data trained the model that declined this loan, and who approved it.</p>'],
    ['Deployment patterns', '<table><tr><th>Pattern</th><th>How</th><th>Use when</th></tr><tr><td>Real-time endpoint</td><td>Autoscaled container behind an API; features from the online store</td><td>Decisions in the request path (fraud, pricing)</td></tr><tr><td>Batch scoring</td><td>Spark/batch job scores a table on a schedule; results written to a store</td><td>Churn scores, forecasts, nightly segments; much cheaper per prediction</td></tr><tr><td>Streaming</td><td>Model inside a stream processor scoring events</td><td>Continuous anomaly detection</td></tr><tr><td>Shadow</td><td>Mirror live traffic to the new model; discard its answers</td><td>Every risky change, first</td></tr><tr><td>Canary</td><td>Small traffic share with automatic metric comparison and rollback</td><td>Default rollout</td></tr><tr><td>A/B / champion-challenger</td><td>Split traffic for long enough to measure business outcomes</td><td>When offline metrics do not predict business impact</td></tr><tr><td>Blue/green</td><td>Two full environments, switch at once</td><td>Infrastructure or runtime upgrades</td></tr></table><p>The same model artefact and the same feature definitions should serve both online and batch paths, so a model never behaves differently depending on how it was called.</p>'],
    ['Monitoring and retraining', '<p>Three layers, from earliest to most meaningful:</p><ol><li><strong>Data drift</strong>: input distributions vs the training baseline (population stability index, Kolmogorov-Smirnov, Jensen-Shannon), plus data quality (nulls, out-of-range).</li><li><strong>Prediction drift</strong>: the output distribution shifts (approval rate, mean score), available immediately.</li><li><strong>Performance</strong>: real accuracy, precision/recall or error once labels arrive, which may take days (churn) or weeks (chargebacks).</li></ol><pre><code>import numpy as np\ndef psi(expected, actual, bins=10):\n    edges = np.quantile(expected, np.linspace(0, 1, bins + 1))\n    actual = np.clip(actual, edges[0], edges[-1])\n    e = np.histogram(expected, edges)[0] / len(expected)\n    a = np.histogram(actual, edges)[0] / len(actual)\n    e, a = np.clip(e, 1e-6, None), np.clip(a, 1e-6, None)\n    return float(np.sum((a - e) * np.log(a / e)))\n# &lt; 0.1 stable, 0.1-0.25 moderate shift, &gt; 0.25 investigate / retrain</code></pre><p><strong>Retraining triggers</strong>: scheduled (simple and predictable), drift-based, or performance-based. Whatever fires, the result is a challenger that must pass the same gates; a retrain on corrupted or poisoned data must not auto-deploy. Add idempotency (one retrain at a time), minimum-data checks and a pause switch. The same ideas extend to LLM apps in <a href="../llmops/index.html">LLMOps</a>, with metrics from <a href="../ai-evaluation/index.html">AI evaluation</a>.</p>'],
    ['Guardrails and cost', '<p><strong>Guardrails</strong> the platform enforces for every team:</p><ul><li>Fairness and slice gates for models that affect people (equal-opportunity gap, approval-rate parity), with the thresholds set by risk owners.</li><li>Access control by data classification: PII columns tagged in the catalogue; training jobs run with workload identities that can only read approved datasets; prediction logs redacted.</li><li>Model and supply-chain security: signed images, scanned dependencies, artefacts in private registries, no pickle files from unknown sources (pickle can execute code; prefer safetensors/ONNX).</li><li>Human oversight hooks for high-risk decisions and explanation outputs (feature attributions) for adverse-action notices.</li></ul><p><strong>Cost</strong>: training at ~1,000 GPU-hours/day &times; ~$3 &asymp; $90 k/month; serving ~110 pods &times; 4 vCPU at ~$0.05 per vCPU-hour &asymp; $16 k/month. Levers: spot capacity for sweeps (with checkpointing), scale-to-zero dev endpoints, per-team quotas and chargeback tags, batch instead of real-time where latency is not needed (often 10&times; cheaper per prediction), and early stopping in hyperparameter searches. Track cost per 1,000 predictions and GPU utilisation per team.</p>']
  ],
  scale: [
    '<strong>GPU contention:</strong> a shared queue (Kueue, Volcano, Azure ML compute quotas) with team quotas, priorities and preemption of low-priority sweeps; checkpoint so preemption costs minutes, not days.',
    '<strong>Many small endpoints:</strong> 60 online models each with 3 idle replicas waste money; use multi-model serving (several models per container) and scale-to-zero for low-traffic models.',
    '<strong>Feature store hot keys:</strong> large merchants or popular items get hammered; cache in the serving process and replicate hot shards.',
    '<strong>Monitoring volume:</strong> 1.5 B predictions/day; sample for drift statistics, keep full logs only where labels will be joined.',
    '<strong>Metadata growth:</strong> millions of runs and metrics points; partition tracking tables and archive old sweep runs.',
    '<strong>Organisational scale:</strong> templates and paved roads (project scaffolds with pipelines, tests, monitoring) matter more than any single tool.'
  ],
  tradeoffs: [
    ['Build vs buy', 'Managed platform (Azure ML, SageMaker, Databricks) vs open source on Kubernetes (Kubeflow, MLflow, Feast, KServe)', 'Managed by default: faster, integrated security and support. Open source on Kubernetes when you need portability or deep customisation and have a platform team.'],
    ['Online vs batch serving', 'Real-time endpoints vs precomputed scores', 'Batch wherever the decision can wait; real time only for request-path decisions. Batch is cheaper and easier to monitor.'],
    ['Retraining policy', 'Scheduled vs drift-triggered vs continuous', 'Scheduled retrains with drift alerts that can trigger an early run; continuous training only where data changes very fast and labels are quick.'],
    ['Approval process', 'Fully automated gates vs human approval', 'Risk-based: automatic for low-risk, human sign-off for high-risk models; both leave the same audit trail.'],
    ['Feature store adoption', 'Central feature store vs per-team feature code', 'Central store for shared and online features; allow local features in experiments, promote them when reused or served.'],
    ['Notebook vs pipeline', 'Exploration in notebooks vs production pipelines', 'Notebooks for exploration only; anything scheduled or deployed must be a tested pipeline in Git.']
  ],
  failures: [
    ['Training-serving skew', 'Shared feature definitions, served-feature logging, skew checks comparing online and offline values before promotion.'],
    ['Silent upstream data change', 'Data contracts and validation in pipelines; lineage-based impact alerts to owners of affected models; block materialisation on failed checks.'],
    ['Model degrades after deploy', 'Shadow and canary with automated analysis; rollback to the previous alias in minutes; previous version kept warm.'],
    ['Retrain loop produces bad models', 'Same gates as manual changes, minimum-data checks, idempotent triggers, pause switch, never auto-deploy high-risk models.'],
    ['Feature store outage', 'Serving falls back to defaults or cached features the model was trained to tolerate; replicas across zones; alert on fallback rate.'],
    ['GPU pool exhausted', 'Quotas and priorities; spot overflow; burst to a second region; batch sweeps rescheduled at night.'],
    ['Cannot explain a past decision', 'Prediction logs with model version and request id, registry lineage and retained model versions for the required period.']
  ],
  evals: [
    ['Offline gate vs champion', 'Primary metric (AUC, RMSE, MAPE) on the same holdout, overall and per slice', 'No regression &gt; 0.5% overall or &gt; 1 point on any defined slice; otherwise blocked'],
    ['Training-serving skew', 'Share of sampled requests whose online feature values differ from offline recomputation', '&le; 0.1% mismatches; any systematic difference blocks promotion'],
    ['Drift detection', 'PSI / KS per key feature and prediction drift vs baseline', 'Alert at PSI &gt; 0.25; detection within 1 h (streaming) or 24 h (batch)'],
    ['Live performance', 'Precision/recall or error computed when labels arrive, vs offline expectation', 'Within 5% of offline estimate; alert on sustained drop'],
    ['Fairness (high-risk models)', 'Equal-opportunity gap or approval-rate ratio across protected groups', 'Gap &le; 0.05 or ratio &ge; 0.8 (four-fifths rule), as set by the risk owner'],
    ['Serving reliability', 'p99 latency and availability per endpoint', 'p99 &le; 50 ms; 99.95% availability; rollback &le; 5 min'],
    ['Delivery performance', 'Commit-to-production lead time and change failure rate for models', 'Lead time &le; 1 day for retrains; change failure rate &le; 5%'],
    ['Governance coverage', 'Share of production models with owner, model card, lineage, monitoring and (if needed) approval', '100%; checked automatically before deploy'],
    ['Cost', 'Cost per 1,000 predictions; GPU utilisation; idle endpoint spend', 'GPU utilisation &ge; 60%; idle spend &le; 10% of serving cost']
  ],
  cloud: [['ML workspace, training, endpoints', 'ml'], ['ML pipelines', 'mlpipeline'], ['Feature store', 'featurestore'], ['Kubernetes serving', 'k8s'], ['GPU training pools', 'gpu'], ['Lakehouse and Spark', 'bigdata'], ['Data integration', 'etl'], ['Event streaming', 'stream'], ['Stream processing', 'streamproc'], ['Online features', 'cache'], ['Tracking and registry metadata', 'sql'], ['Artefacts and datasets', 'blob'], ['Container images', 'registry'], ['Lineage and data catalogue', 'Microsoft Purview', 'Amazon SageMaker Catalog (DataZone)'], ['Monitoring', 'monitor'], ['Workforce identity', 'workforce']],
  refs: { az: ['azMlops', 'azGenAiOps', 'azAksBaseline', 'azBigData', 'azStreamDbx', 'azMonitoring'],
          aws: ['awsMlLens', 'awsAnalyticsLens', 'blDeploy', 'blRollback', 'awsGenAiOps', 'awsDiagrams'] },
  questions: [
    ['What belongs in a model registry entry?', 'The artefact and its input/output signature, lineage (training data snapshot, code commit, environment image, parameters, seed), the evaluation report including slices and fairness, a model card, owners, stage/alias, approvals and deployment history. Enough to reproduce the model and to defend a decision it made.'],
    ['How do you detect a model getting worse before labels arrive?', 'Monitor input drift (PSI, KS) and prediction drift (score and decision-rate distributions), data quality, and proxy signals (overrides by humans, complaint rates). Confirm with real performance when labels land, and keep label latency visible on the dashboard.'],
    ['Shadow vs canary vs A/B: when do you use each?', 'Shadow first for any risky change: zero user impact, catches crashes and odd outputs. Canary for the actual rollout with automatic comparison and rollback. A/B (champion/challenger) when you need to measure a business outcome that offline metrics cannot predict, run for long enough to be significant.'],
    ['Should every drift alert trigger retraining?', 'No. Drift may be harmless, temporary (a holiday) or a data bug, where retraining would learn the bug. The trigger should start a pipeline that produces a challenger, which only ships if it beats the champion on gates; data-quality failures should page a human instead.'],
    ['How do you make this platform usable by 40 teams?', 'Paved roads: project templates with pipelines, tests, monitoring and deployment already wired; self-service quotas; a shared feature catalogue; good defaults for gates; and chargeback so teams see their costs. The platform team measures lead time and adoption, not just uptime.'],
    ['What changes for LLM-based applications?', 'Fewer models are trained in house, so the "model" becomes prompts, retrieval indexes and tool definitions; evaluation shifts to golden sets, LLM-as-judge and safety tests; monitoring adds token cost and groundedness. The same registry, CI gates and canary discipline apply; see <a href="../llmops/index.html">LLMOps</a>.']
  ],
  related: ['recommendation', 'training-cluster', 'llmops', 'llm-serving', 'job-scheduler']
});

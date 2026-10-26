SD.renderCase({
  slug: 'job-scheduler',
  summary: 'A distributed job scheduler runs work at the right time, exactly as often as intended, on a fleet of workers that can crash at any moment. Users register <strong>job definitions</strong> (cron expressions, one-off delayed jobs, DAG workflows); the system turns them into <strong>runs</strong> by scanning a <strong>time-bucketed due index</strong> (or a delay queue), hands each run to a worker under a <strong>lease</strong> that must be renewed by <strong>heartbeats</strong>, and protects shared state with <strong>fencing tokens</strong> so a paused or partitioned node cannot corrupt it. True exactly-once execution is impossible when side effects leave the system, so the contract is <strong>at-least-once delivery plus idempotent jobs</strong> (a run id as idempotency key), which together behave as exactly-once. Failures retry with <strong>exponential backoff and jitter</strong> and land in a <strong>dead-letter queue</strong> after N attempts; <strong>priorities and fair-share queues</strong> stop one tenant from starving the rest; and a workflow engine advances <strong>DAGs</strong> step by step with durable state.',
  examples: 'Kubernetes CronJobs, Airflow and Dagster (DAG schedulers), Temporal and Cadence (durable workflows), AWS EventBridge Scheduler and Step Functions, Azure Functions timers and Durable Functions, Sidekiq and Celery beat, Uber’s Cadence, Airbnb’s Chronos, Dropbox’s ATF, Netflix Maestro.',
  functional: ['Create, update, pause and delete jobs: cron (with time zone), fixed-rate, one-off at a time, or delayed by N seconds.', 'Trigger runs on time and dispatch them to workers with payload, priority and tenant.', 'Retries with exponential backoff, maximum attempts, timeouts, and a dead-letter queue with redrive.', 'DAG workflows: tasks with dependencies, fan-out/fan-in, conditional branches, backfills.', 'Run history, logs, manual re-run and cancellation; alerts on failures and missed schedules.'],
  nonFunctional: ['Trigger accuracy: start within ~1 s of the scheduled time (p99 under 5 s) even at the top-of-hour spike.', 'No missed runs and no duplicate runs for the same scheduled time (a run is created once per job and time).', 'Highly available: lose a scanner, a worker or a zone without losing schedules.', 'Scale to 20M job definitions and 100M runs/day; add capacity horizontally.', 'Fairness: no tenant can monopolise workers; high-priority work runs first.'],
  outOfScope: ['The business logic inside jobs.', 'General-purpose stream processing (see <a href="../message-queue/index.html">message queue</a>).', 'Cluster resource scheduling of containers onto machines (Kubernetes, YARN).'],
  estimates: [
    ['Job definitions', '20 million', 'Multi-tenant platform: ~50k tenants &times; ~400 jobs'],
    ['Runs per day', '100 million', 'Mix of hourly, daily and minutely crons plus delayed one-offs'],
    ['Average trigger rate', '~1,160 runs/s', '100M / 86,400'],
    ['Top-of-hour spike', '~600k runs due at hh:00:00', '2M hourly jobs &times; 30% that choose minute 0; spread to ~10k/s when jobs allow 60 s of jitter'],
    ['Concurrent runs', '~23k average, ~70k peak', '1,160 runs/s &times; ~20 s average duration (Little’s law); &times;3 at peak'],
    ['Heartbeats', '~7k/s at peak', '70k running &divide; 10 s heartbeat interval'],
    ['State writes', '~5k/s average, ~50k/s peak', '~4 writes per run (created, leased, started, finished) + retries'],
    ['Run history', '~100 GB/day, ~3 TB for 30 days', '100M runs &times; ~1 KB of metadata (logs go to the log platform)']
  ],
  compute: [
    ['Job/run database', '8 shards of PostgreSQL (16 vCPU), primary + standby each', 'Peak ~50k writes/s / 8 = ~6k writes/s per shard, comfortable for a tuned Postgres primary; 3 TB history / 8 = ~400 GB each, partitioned by day so old runs drop cheaply.'],
    ['Trigger scanners', '8 pods, each leasing 8 of 64 bucket shards', 'Peak 10k due runs/s / 8 = ~1.3k/s per pod; each scan is an indexed range read of one shard’s current minute bucket. Pods are stateless: a dead pod’s shards are re-leased in ~10 s.'],
    ['Dispatch / matching service', '12 pods, in-memory task queues per (tenant, queue)', 'Handles enqueue, long-poll and heartbeat: ~10k enqueue/s + ~7k heartbeats/s + completions; ~3k ops/s per pod at peak with headroom for a zone loss.'],
    ['Workers', '~230 nodes average, autoscaled to ~700', '70k concurrent runs / 100 I/O-bound slots per 8-vCPU node = 700 at peak; scale on queue backlog and schedule-to-start latency, not CPU.'],
    ['Coordination (leases)', '3- or 5-node etcd', 'Only shard ownership leases and leader election, a few hundred writes/s; run-level leases live in the run database with conditional updates.']
  ],
  api: [
    ['POST /jobs {cron, timezone, payload, queue, priority, maxAttempts, timeout}', 'Create a recurring job (Idempotency-Key header); returns job id and next run time. Validate cron and reject sub-minute crons unless allowed.'],
    ['POST /runs {jobId?, runAt | delaySeconds, payload}', 'One-off or delayed run; trigger now with runAt omitted.'],
    ['POST /workflows {dag: tasks[], edges[]}', 'Register a DAG; runs advance as dependencies succeed.'],
    ['Worker gRPC: PollTask(queue) &rarr; {runId, attempt, leaseToken, deadline}', 'Long-poll for work; the lease token is a monotonically increasing fencing token.'],
    ['Worker gRPC: Heartbeat(runId, leaseToken) / Complete(runId, leaseToken, result)', 'Extend the lease or finish; calls with a stale token are rejected, so zombie workers cannot overwrite results.'],
    ['POST /runs/{id}:redrive | :cancel', 'Re-run a dead-lettered run or cancel a running one (cooperative cancellation via the heartbeat response).']
  ],
  data: [
    ['job', 'Sharded PostgreSQL (by job_id)', 'job_id, tenant, schedule (cron + tz), payload ref, queue, priority, max_attempts, timeout, next_run_at, version, paused.'],
    ['due_index', 'Same shards, table partitioned by minute bucket', '(bucket_minute, shard, run_at, job_id); scanners read <code>bucket = current minute AND run_at &le; now</code>; rows deleted once the run is created.'],
    ['run', 'Sharded PostgreSQL, partitioned by day', 'run_id, job_id, scheduled_for, status, attempt, lease_owner, lease_token, lease_expires_at, next_attempt_at, error; UNIQUE(job_id, scheduled_for) makes creation idempotent.'],
    ['Task queues', 'Matching service memory, backed by the run table', 'Per (tenant, queue, priority); weighted fair queuing state; rebuilt from runs in READY state on restart.'],
    ['Shard leases', 'etcd', 'scanner shard &rarr; owner, revision (used as fencing token), TTL 10 s.'],
    ['Workflow state', 'Run database (event history per workflow run)', 'DAG definition version, per-task status, inputs/outputs refs; append-only history for replay and audit.']
  ],
  dbChoice: [
    ['Jobs, runs, due index', 'Sharded relational (PostgreSQL)', 'Conditional updates for leases (<code>UPDATE ... WHERE lease_token = ?</code>), unique constraints for idempotent run creation, transactions that create a run and the next trigger together, and <code>SKIP LOCKED</code> for contention-free scanning.', 'Cassandra/DynamoDB: scale well (Temporal supports Cassandra) but conditional writes and secondary access patterns need more care. Redis sorted sets as delay queue: fast but weaker durability.'],
    ['Shard ownership', 'etcd / ZooKeeper leases', 'Linearisable compare-and-swap and monotonically increasing revisions double as fencing tokens.', 'Redis Redlock: not safe under clock drift and pauses without fencing.'],
    ['Delayed one-offs', 'Same due index (time buckets)', 'One mechanism for cron and delayed jobs; buckets keep scans small and partition drops cheap.', 'Hierarchical timing wheel in memory (Kafka’s purgatory style): great for short delays, needs a durable backing store for long ones.'],
    ['Dispatch', 'Matching service with in-memory queues + DB durability', 'Sub-second dispatch, per-tenant fair queuing and long-polling workers.', 'SQS/Service Bus per queue: fully managed visibility timeouts and DLQs, harder to do cross-tenant fair share and priorities.']
  ],
  diagram: {
    nodes: [['api', 'Clients', 'client', 0, 1.2, 'UI, CLI, services'], ['gw', 'API gateway', 'apigw', 1, 1.2, 'auth, quotas'], ['js', 'Job service', 'svc', 2, 1.2, 'validate, next_run_at'],
      ['jdb', 'Job + run store', 'db', 3.3, 0, 'sharded Postgres'], ['tb', 'Due index', 'db', 3.3, 1.2, 'per-minute buckets'], ['sc', 'Trigger scanners', 'job', 3.3, 2.4, 'own shards via lease'],
      ['lock', 'Lease service', 'svc', 2, 2.4, 'etcd, fencing tokens'], ['wf', 'Workflow engine', 'svc', 4.6, 1.2, 'DAG state machine'], ['dq', 'Dispatch queues', 'queue', 4.6, 2.4, 'priority + fair share'],
      ['dlq', 'Dead-letter queue', 'queue', 4.6, 3.6, 'after max attempts'], ['wk', 'Workers', 'worker', 6, 2.4, 'heartbeat, idempotent'], ['ext', 'Downstream', 'ext', 6, 1.2, 'APIs, DBs, email']],
    edges: [['api', 'gw'], ['gw', 'js'], ['js', 'jdb', 'definitions'], ['js', 'tb', 'next trigger'], ['sc', 'tb', 'scan due'], ['sc', 'lock', 'shard lease'], ['sc', 'dq', 'enqueue run'], ['dq', 'jdb', 'run state'],
      ['dq', 'wk', 'lease task'], ['wk', 'ext', 'side effects'], ['wf', 'dq', 'next steps'], ['wf', 'jdb', 'DAG state'], ['dq', 'dlq', '', 'async']]
  },
  flows: [
    { name: 'Create a recurring job', desc: 'Registering an hourly cron job: the definition and its first trigger are written together.', steps: [
      ['api', 'gw', 'POST /jobs (cron 0 * * * *)', 'The client sends the cron expression with a time zone (Europe/London) and an Idempotency-Key, so a retried request does not create two jobs.'],
      ['gw', 'js', 'authorised request', 'The gateway authenticates the tenant and applies its quota on number of jobs and minimum interval.'],
      ['js', 'jdb', 'INSERT job (version 1)', 'The job service parses the cron, computes next_run_at = 15:00 local, converted to UTC (time zones and DST are handled here, once).'],
      ['js', 'tb', 'INSERT due row (14:00Z, s37)', 'In the same transaction (same shard: due index is co-located with the job), add a due-index row in the minute bucket of the next run; shard = hash(job_id) mod 64.'],
      ['js', 'gw', '201 {jobId, nextRunAt}', 'Committed atomically: there is never a job without a next trigger, or a trigger without a job.', 'resp'],
      ['gw', 'api', '201 Created', 'The client gets the job id and next run time.', 'resp']],
      end: 'Storing only the next occurrence (not every future run) keeps the due index small; each run schedules its successor.' },
    { name: 'Trigger + execute', desc: 'At 14:00:00Z a scanner finds the job due, creates exactly one run and a worker executes it under a lease.', steps: [
      ['sc', 'lock', 'renew lease shards 32-39', 'The scanner holds a 10 s lease on its shards, renewed every 3 s; the lease revision (token 42) is its fencing token.'],
      ['sc', 'tb', 'SELECT due WHERE bucket=14:00', 'Every ~500 ms it reads its shards’ current bucket for rows with run_at ≤ now (SKIP LOCKED, LIMIT 1000), with a small look-ahead so dispatch starts on time.'],
      ['sc', 'jdb', 'INSERT run + next trigger', 'One transaction: INSERT run (job_id, scheduled_for=14:00) guarded by UNIQUE(job_id, scheduled_for), insert the 15:00 due row, delete the 14:00 row, all conditional on fencing token 42 still owning the shard.'],
      ['sc', 'dq', 'enqueue run r-981 (prio 5)', 'The run goes onto the tenant’s queue at its priority. If enqueue fails after commit, a sweeper re-enqueues READY runs (outbox-style).'],
      ['dq', 'wk', 'PollTask: r-981, lease 60 s', 'A long-polling worker receives the task with attempt 1 and lease token 7, valid until now + 60 s.', 'resp'],
      ['wk', 'ext', 'call, Idempotency-Key r-981', 'The job uses the run id as the idempotency key for every side effect, so a redelivered run cannot charge, email or write twice.'],
      ['wk', 'dq', 'Heartbeat(r-981, token 7)', 'Every 10 s the worker extends its lease and receives cancellation requests, if any.'],
      ['wk', 'dq', 'Complete(r-981, token 7)', 'Completion is accepted only with the current lease token.'],
      ['dq', 'jdb', 'UPDATE run SET SUCCEEDED', 'Conditional update WHERE lease_token = 7; the run’s history is recorded.']],
      end: 'At-least-once delivery + a unique run per (job, time) + idempotent side effects = effectively exactly-once.' },
    { name: 'Worker crash, retry, DLQ', desc: 'The worker dies mid-run. The lease expires, the run is retried with backoff, and a zombie worker is fenced off.', steps: [
      ['wk', 'dq', 'heartbeats stop', 'Worker node A is killed (OOM, spot reclaim) halfway through run r-981.', 'err'],
      ['dq', 'jdb', 'lease expired: attempt 2', 'After 60 s without heartbeats the lease expires. The run is set to RETRY with next_attempt_at = now + min(cap, base × 2^attempt) ± jitter (e.g. 30 s, 60 s, 120 s...).'],
      ['dq', 'wk', 'PollTask: r-981, token 8', 'When the backoff elapses, worker B gets the run with a new lease token 8.', 'resp'],
      ['wk', 'ext', 'retry, same idempotency key', 'Side effects that A already completed are deduplicated downstream by the run id.'],
      ['wk', 'dq', 'zombie A: Complete(token 7)', 'Worker A was only paused (long GC or network partition) and now tries to report success with its old token.', 'err'],
      ['dq', 'wk', 'rejected: stale lease token', 'The fencing check (token 7 < current 8) rejects it, so A cannot overwrite B’s state.', 'err'],
      ['dq', 'dlq', 'attempt 5 failed: dead-letter', 'If the job keeps failing (bad payload, downstream permanently broken), after max attempts it moves to the DLQ with the last error, alerting the owner instead of retrying forever.', 'async']],
      end: 'Leases bound how long a dead worker holds a run; fencing tokens make sure a slow one cannot do damage when it wakes up.' },
    { name: 'Scanner failover with fencing', desc: 'Scanner A stalls while holding shards 32-39. Scanner B takes over without creating duplicate runs.', steps: [
      ['sc', 'lock', 'A: renew lease (stalled)', 'Scanner A hits a 20 s stop-the-world pause and misses renewals.', 'err'],
      ['lock', 'sc', 'lease to B, token 43', 'The 10 s lease expires; scanner B acquires shards 32-39 with revision 43.', 'resp'],
      ['sc', 'tb', 'B scans bucket 14:00', 'B rescans the current and previous bucket, so nothing that A missed is lost (catch-up after outage).'],
      ['sc', 'jdb', 'B: INSERT runs (token 43)', 'B creates the due runs; UNIQUE(job_id, scheduled_for) silently skips any that A already created.'],
      ['sc', 'jdb', 'A wakes: INSERT (token 42)', 'A resumes mid-loop and tries to write with its old token.', 'err'],
      ['jdb', 'sc', 'rejected: token 42 < 43', 'Shard writes check the stored owner token, so the zombie scanner’s writes fail and it stops after re-reading its lease.', 'err'],
      ['sc', 'dq', 'B enqueues due runs', 'Runs flow on with at most ~10-15 s delay for this shard during the failover.']],
      end: 'A lease alone is not enough (a paused process does not know its lease expired); the store must check a fencing token on every write.' },
    { name: 'DAG workflow', desc: 'A daily ETL: extract, then two transforms in parallel, then load once both succeed.', steps: [
      ['api', 'gw', 'POST /workflows (daily ETL)', 'The DAG is submitted: extract → {transformA, transformB} → load, triggered by a cron at 02:00.'],
      ['gw', 'js', 'store DAG version', 'Definitions are versioned; running instances keep the version they started with.'],
      ['wf', 'dq', 'enqueue root: extract', 'At 02:00 the workflow engine creates a workflow run and enqueues tasks with no unmet dependencies.'],
      ['dq', 'wk', 'run extract', 'A worker executes extract and completes.', 'resp'],
      ['dq', 'wf', 'event: extract succeeded', 'The engine records the event in the workflow’s append-only history (durable state, replayable after a crash).', 'resp'],
      { par: [['wf', 'dq', 'enqueue transformA'], ['wf', 'dq', 'enqueue transformB']], msg: 'Fan-out: both transforms are now ready and run in parallel on different workers.' },
      ['wf', 'jdb', 'join: both done', 'The engine counts completed dependencies atomically, so the join fires exactly once even if both finish at the same instant.'],
      ['wf', 'dq', 'enqueue load', 'The final task runs; if a transform had exhausted retries, load would be skipped and the workflow marked failed with a partial-rerun option.']],
      end: 'The workflow engine is itself just a deterministic state machine over durable events; tasks remain idempotent so any step can be retried or backfilled.' }
  ],
  components: [
    ['Job service / API', 'Validate definitions, parse cron with time zones and DST rules, compute the next occurrence, manage versions, pause and backfill.'],
    ['Due index + trigger scanners', 'Time-bucketed index of next occurrences; scanners own shards by lease and turn due entries into runs, scheduling the following occurrence atomically.'],
    ['Lease / coordination service', 'Shard ownership and leader election with monotonically increasing fencing tokens (etcd revisions).'],
    ['Dispatch (matching) service', 'Per-tenant, per-priority queues; weighted fair dispatch; long-poll for workers; run leases, heartbeats, retries with backoff, DLQ.'],
    ['Workers', 'Execute jobs, heartbeat, honour cancellation and timeouts, use the run id as idempotency key; autoscale on backlog.'],
    ['Workflow engine', 'DAG/state-machine orchestration over durable event history: fan-out, joins, conditional branches, compensation.'],
    ['Observability', 'Schedule-to-start latency, missed-trigger count, retries, DLQ depth per tenant; alerts for jobs that did not run.']
  ],
  deep: [
    ['Finding due jobs: buckets, delay queues and timing wheels', '<p>Scanning a 20M-row table with <code>WHERE next_run_at &le; now()</code> every second does not scale. Options:</p><ul><li><strong>Time-bucketed due index</strong> (chosen): rows keyed by (minute bucket, shard). A scanner only reads the current bucket of the shards it owns, so each read touches only the work actually due. Partitions by bucket make cleanup a cheap partition drop. Store only the <em>next</em> occurrence per job.</li><li><strong>Delay queue</strong>: Redis sorted set scored by run time (<code>ZRANGEBYSCORE due -inf now LIMIT</code>), or SQS delay (max 15 min) / Service Bus scheduled messages. Very low latency, but durability and long delays need care.</li><li><strong>Hierarchical timing wheel</strong> in memory for second-level precision on the near future (next few minutes), loaded from the durable buckets ahead of time.</li></ul><p>Top-of-hour spike: millions of crons choose minute 0. Pre-load the next bucket a minute early, let jobs declare allowed jitter (spread across 0-60 s by hash of job id), and scale dispatch for the spike rather than the average.</p>'],
    ['Leases, heartbeats and fencing tokens', '<p>A <strong>lease</strong> is a lock with a time limit: the holder must renew it before it expires, or it is assumed dead. But a holder cannot reliably know it has lost the lease: a GC pause, VM freeze or partition can last longer than the TTL, and the process then continues as if it still owned the work. Martin Kleppmann’s fix is a <strong>fencing token</strong>: every lease grant comes with a strictly increasing number (etcd revision, a DB sequence), and every write to the shared resource includes it; the resource rejects writes with a token lower than the highest it has seen.</p><pre><code>UPDATE run SET status = &#39;SUCCEEDED&#39;, result = $3\n WHERE run_id = $1 AND lease_token = $2;   -- 0 rows = you were fenced</code></pre><p>Heartbeat interval &asymp; lease TTL / 3 to tolerate one lost heartbeat. Long jobs need heartbeats (or checkpoints) so a crash is detected in seconds, not after a 6-hour timeout.</p>'],
    ['Exactly-once is at-least-once plus idempotency', '<p>A worker can finish a side effect and crash before reporting success; the scheduler cannot distinguish that from a crash before the side effect, so it must retry: <strong>delivery is at-least-once</strong>. Make the <em>effect</em> exactly-once instead:</p><ol><li>Create the run exactly once: UNIQUE(job_id, scheduled_for) turns duplicate triggers into no-ops.</li><li>Pass the run id as the idempotency key to every downstream call (payments, emails) and store processed keys there.</li><li>Prefer naturally idempotent operations (upserts, set-status-to-X) over increments.</li><li>For writes to your own database, record the run id in the same transaction as the effect (an inbox/processed table).</li></ol><p>Misfire policy matters too: after an outage, does an hourly job run once for all missed hours (coalesce), run each missed hour (backfill), or skip? Make it a per-job setting.</p>'],
    ['Retries, backoff and dead letters', '<p>Retry transient failures with <strong>exponential backoff and full jitter</strong>: <code>sleep = random(0, min(cap, base &times; 2^attempt))</code>. Jitter prevents thousands of failed runs from retrying in lockstep and hammering a recovering dependency. Distinguish <em>retryable</em> errors (timeouts, 503, throttling) from <em>permanent</em> ones (validation, 400): permanent errors go straight to the DLQ. Cap attempts (e.g. 5) and total retry time. The DLQ keeps payload, attempts and last error, supports filtered redrive after a fix, and has an owner and an alert on depth, otherwise it becomes a silent graveyard. Add a per-downstream circuit breaker so a broken dependency pauses its queue instead of burning all attempts.</p>'],
    ['Priorities and fair share', '<p>Strict priority queues starve low priorities under sustained load; one huge tenant on a FIFO queue delays everyone. Use a two-level scheme:</p><ul><li><strong>Fair share across tenants</strong>: weighted fair queuing or deficit round robin over per-tenant queues, weights from the tenant’s plan; per-tenant concurrency limits (max running) so a burst of 1M jobs from one tenant drains at its share.</li><li><strong>Priority within a tenant</strong>: a few classes (critical, default, batch) with weighted dispatch (e.g. 70/25/5) rather than strict, plus aging so old batch work eventually runs.</li><li><strong>Isolation</strong>: separate worker pools (bulkheads) for critical queues, and shuffle-sharded matching partitions so one hot tenant affects only a few others.</li></ul>']
  ],
  scale: [
    '<strong>Top-of-hour thundering herd:</strong> pre-load buckets, jitter windows, and dispatch capacity sized for the spike; report schedule-to-start latency per tenant.',
    '<strong>Run-store write load:</strong> shard by job id, keep heartbeats cheap (in the matching service’s memory, persisted only on lease changes or every few heartbeats), partition history by day and archive old runs.',
    '<strong>Many tiny jobs:</strong> batch small tasks, or run them in-process; per-run overhead (~4 writes) dominates for sub-second jobs.',
    '<strong>Long-running jobs:</strong> checkpoints and heartbeats with progress, so retries resume rather than restart; lease TTL short with frequent renewals.',
    '<strong>Cell architecture:</strong> at very large scale, split tenants into independent scheduler cells (each with its own DB, scanners and dispatch) to cap blast radius.'
  ],
  tradeoffs: [
    ['Delivery semantics', 'At-most-once vs at-least-once', 'At-least-once with idempotent jobs: missed runs are usually worse than duplicates that are deduplicated by run id.'],
    ['Finding due work', 'Polling buckets in a DB vs Redis sorted-set delay queue vs timing wheel', 'DB buckets for durability and one source of truth; an in-memory timing wheel on top for second-level precision.'],
    ['Lease length', 'Short (10-60 s) vs long (job timeout)', 'Short leases with heartbeats: crashes detected in seconds; costs a steady heartbeat load.'],
    ['Dispatch', 'Push to workers vs workers pull (long-poll)', 'Pull: workers take only what they can handle (natural back-pressure) and need no inbound connectivity.'],
    ['Build vs managed', 'Own scheduler vs EventBridge Scheduler / Durable Functions / Temporal Cloud', 'Managed services for most teams; build only for multi-tenant platforms with special fairness, scale or on-prem needs.']
  ],
  failures: [
    ['Worker crashes mid-run', 'Lease expires without heartbeats; run retried on another worker with backoff; idempotency key prevents duplicate side effects.'],
    ['Zombie worker or scanner', 'Fencing tokens on every state write reject stale owners after a pause or partition.'],
    ['Scanner pod dies', 'Its shard leases expire in ~10 s and other scanners take them over, rescanning the previous bucket to catch up.'],
    ['Database primary fails', 'Standby promoted; scanners pause and resume; runs due during the gap are picked up from the bucket (misfire policy decides coalesce or backfill).'],
    ['Downstream dependency down', 'Retries with jitter, circuit breaker per dependency, then DLQ; no retry storm against a recovering service.'],
    ['Poison job keeps failing', 'Permanent-error classification, max attempts, DLQ with alert to owner, automatic pause after N consecutive failed runs.'],
    ['Clock skew between nodes', 'Due decisions based on the database clock (now() on the server), not on each scanner; NTP alarms.']
  ],
  cloud: [['Managed schedules', 'scheduler'], ['Workflow orchestration (DAGs)', 'workflow'], ['Dispatch queue with DLQ', 'queue'], ['Job and run store', 'sql'], ['Distributed SQL at larger scale', 'distsql'],
    ['Lease store (conditional writes)', 'Cosmos DB (ETag conditional writes)', 'DynamoDB conditional writes'], ['Scanners and matching service', 'k8s'], ['Container workers', 'containers'], ['Batch / HPC jobs', 'batch'],
    ['Serverless job handlers', 'functions'], ['API front door', 'apigw'], ['Secrets for job credentials', 'secrets'], ['Metrics and alerts', 'monitor'], ['Run logs', 'logs']],
  refs: { az: ['azBackground', 'azp-scheduler-agent-supervisor', 'azp-leader-election', 'azp-priority-queue', 'azp-competing-consumers', 'azp-retry', 'azp-queue-based-load-leveling'],
          aws: ['blLeader', 'blBackoff', 'blBacklog', 'awsRetry', 'blShuffle', 'awsSagaOrch'] },
  questions: [
    ['How do you guarantee a job runs exactly once?', 'You cannot guarantee exactly-once execution of external side effects. Guarantee one run record per (job, scheduled time) with a unique constraint, deliver it at least once under leases, and make the job idempotent with the run id as the idempotency key. The combined effect is exactly-once.'],
    ['Why do you need fencing tokens if you already have leases?', 'Because a lease holder can be paused (GC, VM freeze, partition) past its expiry and resume believing it still holds the lease. A fencing token checked by the storage on every write rejects the stale holder, which a lease by itself cannot do.'],
    ['How do you handle millions of jobs scheduled at exactly midnight?', 'Pre-load the next bucket ahead of time, shard the bucket, let jobs declare acceptable jitter and spread them by hash, autoscale dispatch and workers for the spike, and apply per-tenant fair share so one tenant’s burst does not delay others.'],
    ['What happens if the scheduler is down for 10 minutes?', 'Due entries stay in their buckets. On recovery scanners read past buckets and apply each job’s misfire policy: run once (coalesce), run every missed occurrence (backfill), or skip. Alert on missed-trigger counts.'],
    ['How do retries avoid making an outage worse?', 'Exponential backoff with full jitter, a cap on attempts and total time, classification of permanent errors (no retry), and circuit breakers per downstream dependency so a broken service pauses its queue.'],
    ['How do you run DAGs reliably?', 'Treat the workflow as a deterministic state machine over durable events: record each task result, enqueue tasks whose dependencies are met, count joins atomically, and make tasks idempotent so a crash in the engine can replay the history and continue.']
  ],
  related: ['message-queue', 'notification', 'unique-id', 'ml-platform', 'reliability']
});

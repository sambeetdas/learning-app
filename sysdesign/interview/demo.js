$(function () {
  'use strict';
  SD.pageChrome('interview');

  // ---------------------------------------------------------------- timeline stepper
  var PH = [['Clarify', 0, 5, 'Ask about users, features, scale and quality targets. Write the requirements on the board and agree what is out of scope.'],
    ['Estimate', 5, 10, 'Quick numbers: QPS (average and peak), storage, bandwidth, cache. They decide whether you need sharding, caching or a CDN.'],
    ['API + data', 10, 15, 'A few endpoints and the core entities with their access patterns. This anchors the design.'],
    ['High level', 15, 25, 'Draw the boxes and walk the main read and write paths end to end. Check every functional requirement is served.'],
    ['Deep dives', 25, 38, 'Pick the 1-3 hardest problems (or follow the interviewer). Give options, compare them, choose and justify.'],
    ['Scale + failures', 38, 43, 'Bottlenecks, sharding, replication, multi-region, what happens when each component fails, monitoring and security.'],
    ['Wrap up', 43, 45, 'Summarise the design, the key trade-offs, and what you would improve with more time.']];
  var F = PH.map(function (p, i) { return { i: i, msg: 'Minutes ' + p[1] + '-' + p[2] + ' — ' + p[0] + ': ' + p[3] }; });
  DSA.player('#timer-demo', F, function (f, ctx) {
    var $t = $('<div style="display:flex;gap:2px;margin:.5rem 0">').appendTo(ctx.stage);
    PH.forEach(function (p, i) {
      $('<div>').text(p[0]).attr('title', p[1] + '-' + p[2] + ' min').css({ flex: p[2] - p[1], padding: '.6rem .2rem', textAlign: 'center', fontSize: '.75rem', borderRadius: '6px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        background: i === f.i ? 'var(--accent)' : i < f.i ? 'rgba(34,160,80,.28)' : 'var(--line)', color: i === f.i ? '#fff' : 'inherit', fontWeight: i === f.i ? 700 : 400 }).appendTo($t);
    });
    ctx.stage.append('<p class="muted">' + PH[f.i][2] + ' of 45 minutes used</p>');
  }, { speed: 1500 });

  // ---------------------------------------------------------------- follow-up questions
  var Q = {
    'Scaling': [['The database is the bottleneck. What do you do?', 'Measure first (slow queries, CPU, IO, connections). Then in order: add indexes and fix queries; add a cache for hot reads; add read replicas; scale up; move heavy analytics elsewhere; finally shard by a key that matches the main access pattern (for example user id), accepting harder cross-shard queries.'],
      ['How do you handle a celebrity or hot key?', 'Detect hot keys, replicate them (key#1..key#N copies), cache them close to the reader (local in-process cache), use fan-out on read for celebrities instead of fan-out on write, and rate limit writes to the key.'],
      ['Traffic grows 10x overnight. What breaks first?', 'Usually the database and anything stateful, then downstream rate limits. Stateless tiers autoscale; protect the rest with caching, queues to absorb bursts, load shedding and graceful degradation of non-critical features.'],
      ['How do you make the service multi-region?', 'Decide active-passive (simpler, failover RTO minutes) or active-active (needs conflict handling or partitioning users by home region). Replicate data asynchronously, route with geo-DNS or a global load balancer, and make writes idempotent.']],
    'Data': [['Why this database?', 'Tie the choice to access patterns and requirements: transactions and joins point to relational; known key lookups at huge scale point to key-value or wide-column; full-text to a search engine; relationships to a graph; time-ordered metrics to a time-series store.'],
      ['How do you keep the cache consistent with the database?', 'Cache-aside with a TTL; on writes update the database then delete the cache key; use versioning or change data capture for stronger guarantees; accept a small staleness window where the product allows it.'],
      ['How would you migrate to a new schema or store without downtime?', 'Expand and contract: add the new structure, dual-write (or CDC), backfill, verify with shadow reads, switch reads, then stop writing the old one and remove it.'],
      ['How do you delete a user’s data (GDPR)?', 'Keep an index of where personal data lives, delete or anonymise in every store including caches, search, analytics and backups (or crypto-shred by deleting per-user keys), and log the deletion.']],
    'Reliability': [['A downstream dependency is slow. What happens to your service?', 'Without protection, threads and connections pile up and you fail too. Use timeouts, bounded retries with backoff and jitter, a circuit breaker, bulkheads (separate pools) and a fallback (cached or degraded response).'],
      ['How do you guarantee a payment is not charged twice?', 'Idempotency keys stored with the result, a state machine for the payment, the outbox pattern for events, idempotent consumers, and daily reconciliation against the provider.'],
      ['How do you deploy safely?', 'Small changes, automated tests, canary or blue/green with automatic rollback on SLO breach, feature flags, and backward-compatible database migrations.'],
      ['What do you monitor?', 'The golden signals (latency, traffic, errors, saturation) per endpoint, SLOs with burn-rate alerts, business metrics (orders per minute), queue lag, and distributed traces for debugging.']],
    'AI systems': [['How do you know the RAG assistant is giving good answers?', 'A golden dataset with offline evaluation in CI (retrieval recall, faithfulness, correctness, safety), release gates, and online monitoring: sampled LLM-as-judge scoring, user feedback, escalations, with failures fed back as test cases.'],
      ['How do you reduce LLM cost and latency?', 'Route simple requests to small models, cache (prompt caching and semantic caching), trim context with better retrieval and reranking, stream tokens, batch offline work, set max output tokens, and use provisioned capacity for steady load.'],
      ['How do you stop prompt injection?', 'Treat retrieved content and tool output as untrusted data, use injection classifiers, keep instructions separate, give tools least privilege, require human approval for side effects, and validate outputs.'],
      ['How does the agent avoid running forever?', 'Step, token, time and cost budgets per task; loop detection; checkpoints; and escalation to a human when the budget is exhausted.']]
  };
  var $tp = $('#fq-topic'), idx = 0;
  Object.keys(Q).forEach(function (k) { $tp.append('<option>' + k + '</option>'); });
  function show() { var list = Q[$tp.val()], q = list[idx % list.length]; $('#fq-q').html('<b>Q:</b> ' + q[0]); $('#fq-a').hide().html('<b>A:</b> ' + q[1]); }
  $tp.on('change', function () { idx = 0; show(); });
  $('#fq-next').on('click', function () { idx++; show(); });
  $('#fq-show').on('click', function () { $('#fq-a').show(); });
  show();

  ['azArch', 'azWaf', 'azPatterns', 'azStyles', 'azMission'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsArch', 'awsWaf', 'awsPatterns', 'blDistributed', 'blBackoff'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

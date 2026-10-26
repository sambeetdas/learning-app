(function () {
  'use strict';
  // ---------------------------------------------------------------- page lists
  var FDESC = {
    basics: 'Functional vs non-functional requirements, latency numbers, availability and the nines, CAP and PACELC, consistency models.',
    estimation: 'Back-of-the-envelope maths with calculators: QPS, servers, storage, bandwidth, cache size, GPUs and tokens. A decision tool for choosing a database.',
    scaling: 'Vertical vs horizontal, stateless services, load-balancing algorithms (simulated), autoscaling, CDN and edge, API gateways, service discovery.',
    data: 'SQL vs NoSQL families, indexes, replication (leader-follower, multi-leader, leaderless), partitioning and sharding, transactions, storage types.',
    caching: 'Cache-aside, read/write-through, write-behind, eviction, invalidation, stampedes, multi-level caches.',
    messaging: 'Queues vs logs, pub/sub, delivery guarantees, idempotency, outbox, sagas, event sourcing, backpressure.',
    reliability: 'Redundancy, failover, timeouts, retries with jitter, circuit breakers, bulkheads, load shedding, disaster recovery, safe deployments.',
    architecture: 'Monolith to microservices, serverless, event-driven, CQRS, cells and stamps, REST vs gRPC vs GraphQL, API versioning.',
    'security-ops': 'Authentication (OAuth 2.0 / OIDC), authorisation, encryption, zero trust; logs, metrics, traces, SLOs; cost optimisation.',
    'ai-foundations': 'Tokens, inference latency, batching, KV cache, quantisation, RAG, agents, guardrails, evaluation, AI gateways and cost.',
    'ai-evaluation': 'Retrieval, generation, safety, agent and operational metrics for RAG and LLM apps, LLM-as-judge, offline and online evaluation, with calculators.',
    interview: 'A minute-by-minute playbook, templates and the most common follow-up questions.'
  };
  var $f = $('#fund-list');
  SD.FUND.forEach(function (f, i) { $f.append('<a href="' + f[0] + '/index.html"><b>' + (i + 1) + '. ' + f[1] + '</b><span>' + FDESC[f[0]] + '</span></a>'); });
  SD.CASES.forEach(function (c) { $('#lvl-' + c[2]).append('<a href="' + c[0] + '/index.html"><b>' + c[1] + '</b><span>' + c[3] + '</span></a>'); });

  // ---------------------------------------------------------------- building blocks table
  var rows = Object.keys(SD.CAT).map(function (k) { return [SD.CAT[k][0], SD.svcHtml(k, 'az'), SD.svcHtml(k, 'aws')]; });
  $('#blocks-table').html(SD.table(['Component', 'Azure', 'AWS'], rows));
  ['azArch', 'azWaf', 'azPatterns', 'azStyles', 'azDataStore', 'azCompute', 'azMessaging', 'azMission', 'azMultitenant', 'azFoundryChat', 'azAgents', 'azGenGw'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsArch', 'awsWaf', 'awsDiagrams', 'awsPatterns', 'awsMicro', 'blDistributed', 'blBackoff', 'blShuffle', 'awsGenAiLens', 'awsRagOptions', 'awsAgentic', 'awsSaasLens'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });

  // ---------------------------------------------------------------- anatomy diagram
  var D = {
    nodes: [['u', 'Users', 'client', 0, 1.5, 'web, mobile, APIs'], ['dns', 'DNS', 'dns', 1, 0], ['edge', 'CDN + WAF', 'edge', 1, 1.5, 'edge PoPs'], ['gw', 'API gateway', 'apigw', 2, 1.5, 'auth, rate limits'],
      ['idp', 'Identity provider', 'ext', 2, 0, 'OAuth / OIDC'], ['svc', 'Core services', 'svc', 3, 1.5, 'stateless, autoscaled'], ['cache', 'Cache', 'cache', 4, 0.6, 'Redis'], ['db', 'Databases', 'db', 4, 1.6, 'SQL + NoSQL'],
      ['blob', 'Object storage', 'blob', 2, 3, 'media, files'], ['bus', 'Event stream', 'stream', 4, 2.7, 'Kafka / Event Hubs'], ['wk', 'Workers', 'worker', 5, 2.7, 'async jobs'],
      ['search', 'Search index', 'search', 5, 0.6], ['lake', 'Data lake + warehouse', 'dw', 6, 2.7, 'analytics'], ['ml', 'ML / LLM services', 'llm', 6, 1.5, 'models, RAG'], ['obs', 'Observability', 'svc', 6, 0.3, 'logs, metrics, traces']],
    edges: [['u', 'dns'], ['u', 'edge'], ['edge', 'gw'], ['gw', 'idp'], ['gw', 'svc'], ['svc', 'cache'], ['svc', 'db'], ['edge', 'blob'], ['svc', 'bus', '', 'async'], ['bus', 'wk', '', 'async'], ['wk', 'search'], ['bus', 'lake', '', 'async'], ['svc', 'ml'], ['svc', 'obs', '', 'async']]
  };
  SD.flows('#anatomy-demo', D, [
    { name: 'A read request', desc: 'A user opens a page: how the request travels and what answers it.', steps: [
      ['u', 'dns', 'resolve app.com', 'DNS returns the address of the nearest edge location (anycast or geo-DNS).'],
      ['u', 'edge', 'HTTPS GET', 'The CDN terminates TLS near the user; the WAF blocks attacks; cached content is returned immediately.'],
      ['edge', 'gw', 'cache miss: forward', 'Dynamic requests go to the API gateway in the closest healthy region.'],
      ['gw', 'idp', 'validate token', 'The gateway checks the access token (signature and claims; usually cached keys, no network call).'],
      ['gw', 'svc', 'route /feed', 'Rate limits applied, then routed to the right service.'],
      ['svc', 'cache', 'GET (hit)', 'Most reads are answered from the cache in under a millisecond.'],
      ['svc', 'db', 'query on miss', 'Misses read from the database (often a replica).'],
      ['svc', 'u', 'response', 'The response flows back through the gateway and edge.', 'resp']] },
    { name: 'A write and its ripple effects', desc: 'A user posts something: the synchronous write, then the asynchronous work it triggers.', steps: [
      ['u', 'edge', 'POST /posts', 'The write enters through the edge.'], ['edge', 'gw', 'forward', 'Authenticated and rate limited at the gateway.'], ['gw', 'svc', 'route', 'The posting service validates the request.'],
      ['svc', 'db', 'INSERT (transaction)', 'The source of truth is updated.'],
      ['svc', 'bus', 'publish PostCreated', 'An event is published (via the outbox pattern so the DB write and the event never disagree).', 'async'],
      ['svc', 'u', '201 Created', 'The user gets a fast answer; everything else happens in the background.', 'resp'],
      { par: [['bus', 'wk', 'fan-out to followers', 'async'], ['bus', 'lake', 'analytics events', 'async']], msg: 'Several consumers react independently: feed fan-out, notifications, analytics.' },
      ['wk', 'search', 'index the post', 'A worker updates the search index (eventually consistent, seconds behind).']] },
    { name: 'Media upload', desc: 'Large files bypass the services entirely.', steps: [
      ['u', 'gw', 'request upload URL', 'The client asks for permission to upload.'], ['gw', 'svc', 'authorise', 'The service checks quotas and permissions.'],
      ['svc', 'u', 'pre-signed URL (5 min)', 'It returns a short-lived signed URL (valet key pattern).', 'resp'],
      ['u', 'edge', 'PUT file', 'The client uploads directly to storage through the edge...'], ['edge', 'blob', 'store object', '...straight into object storage.'],
      ['blob', 'bus', 'ObjectCreated event', 'Storage emits an event when the upload completes.', 'async'], ['bus', 'wk', 'transcode / thumbnail', 'Workers process the media asynchronously.', 'async']] },
    { name: 'AI feature', desc: 'An "ask a question" feature using retrieval-augmented generation.', steps: [
      ['u', 'gw', 'POST /ask', 'The question arrives.'], ['gw', 'svc', 'route', 'Routed to the assistant service.'],
      ['svc', 'search', 'hybrid retrieval', 'Retrieve the most relevant documents (keyword + vector search) the user is allowed to see.'],
      ['search', 'svc', 'top passages', 'A handful of passages come back.', 'resp'],
      ['svc', 'ml', 'prompt + passages', 'The LLM generates an answer grounded in those passages, streamed token by token.'],
      ['ml', 'svc', 'streamed answer', 'Tokens stream back.', 'resp'], ['svc', 'u', 'answer + citations', 'The user sees the answer as it is generated.', 'resp'],
      ['svc', 'obs', 'trace, tokens, cost', 'Every step is traced: latency, tokens, cost, and quality signals for evaluation.', 'async']] },
    { name: 'Observability', desc: 'Every component emits telemetry so the system can be operated.', steps: [
      { par: [['svc', 'obs', 'traces + metrics', 'async'], ['wk', 'obs', 'job metrics', 'async']], msg: 'Services and workers emit metrics, structured logs and distributed traces.' },
      ['obs', 'svc', 'alert: p99 latency high', 'Alerts fire on symptoms (SLO burn rate), not on every CPU spike.', 'err'],
      ['gw', 'svc', 'shed / throttle', 'Operators (or automation) throttle, roll back a deployment, or scale out.']] }
  ]);
  $('#anatomy-legend').html(SD.legend());
})();

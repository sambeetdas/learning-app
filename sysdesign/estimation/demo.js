$(function () {
  'use strict';
  SD.pageChrome('estimation');

  function fmt(n, d) {
    if (!isFinite(n)) return '∞';
    var a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(1) + ' T';
    if (a >= 1e9) return (n / 1e9).toFixed(1) + ' B';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + ' M';
    if (a >= 1e4) return Math.round(n).toLocaleString();
    return n.toFixed(d === undefined ? (a < 10 ? 2 : 0) : d);
  }
  function bytes(b) {
    var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'], i = 0;
    while (Math.abs(b) >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
  }
  function bits(bps) { return bps >= 1e9 ? (bps / 1e9).toFixed(2) + ' Gbit/s' : (bps / 1e6).toFixed(1) + ' Mbit/s'; }

  // ================================================================== traffic / compute / storage
  var PRESETS = {
    web:    { dau: 1e6, rpu: 50, peak: 5, wpct: 5, cpu: 20, lat: 120, cores: 4, util: 60, zones: 3, hit: 80, resp: 60, wsize: 1, years: 3, repl: 3, hot: 5 },
    social: { dau: 1e8, rpu: 100, peak: 3, wpct: 2, cpu: 15, lat: 150, cores: 8, util: 60, zones: 3, hit: 95, resp: 30, wsize: 1, years: 5, repl: 3, hot: 2 },
    chat:   { dau: 5e7, rpu: 80, peak: 4, wpct: 45, cpu: 3, lat: 50, cores: 8, util: 60, zones: 3, hit: 70, resp: 2, wsize: 1, years: 5, repl: 3, hot: 1 },
    url:    { dau: 1e7, rpu: 10, peak: 5, wpct: 1, cpu: 1, lat: 20, cores: 4, util: 60, zones: 2, hit: 95, resp: 0.5, wsize: 0.5, years: 5, repl: 3, hot: 10 },
    iot:    { dau: 5e6, rpu: 8640, peak: 1.5, wpct: 98, cpu: 0.5, lat: 30, cores: 8, util: 60, zones: 3, hit: 0, resp: 0.2, wsize: 0.2, years: 1, repl: 3, hot: 1 },
    api:    { dau: 1e4, rpu: 200, peak: 10, wpct: 20, cpu: 30, lat: 200, cores: 2, util: 50, zones: 2, hit: 50, resp: 10, wsize: 2, years: 3, repl: 2, hot: 20 }
  };
  var FIELDS = ['dau', 'rpu', 'peak', 'wpct', 'cpu', 'lat', 'cores', 'util', 'zones', 'hit', 'resp', 'wsize', 'years', 'repl', 'hot'];
  function load(p) { FIELDS.forEach(function (f) { $('#' + f).val(PRESETS[p][f]); }); calc(); }
  function v(id) { return Math.max(0, parseFloat($('#' + id).val()) || 0); }
  function calc() {
    var dau = v('dau'), rpu = v('rpu'), peak = Math.max(1, v('peak')), wp = v('wpct') / 100, cpu = v('cpu'), lat = v('lat'), cores = Math.max(1, v('cores')), util = Math.max(1, v('util')) / 100,
        zones = Math.max(1, Math.min(3, Math.round(v('zones')) || 1)), hit = Math.min(99.9, v('hit')) / 100, resp = v('resp'), ws = v('wsize'), yrs = v('years'), repl = Math.max(1, v('repl')), hot = v('hot') / 100;
    var avg = dau * rpu / 86400, pk = avg * peak, wq = pk * wp, rq = pk - wq;
    // reads answered by the cache cost ~10% of the CPU of a full request
    var effCpu = (rq * (hit * cpu * 0.1 + (1 - hit) * cpu) + wq * cpu) / 1000;      // busy cores at peak
    var coresNeeded = effCpu / util;
    var servers = Math.max(1, Math.ceil(coresNeeded / cores));
    // survive losing one zone: remaining zones must carry the peak
    var perZone = Math.ceil(servers / Math.max(1, zones - (zones > 1 ? 1 : 0)));
    var total = zones > 1 ? perZone * zones : servers + 1;
    var inflight = pk * lat / 1000;
    var dbReads = rq * (1 - hit), writesDay = avg * wp * 86400;
    var raw = writesDay * ws * 1024 * 365 * yrs, stored = raw * repl * 1.4;
    var cache = writesDay * ws * 1024 * 365 * hot * 1.3;
    var egress = pk * resp * 1024 * 8, ingress = wq * ws * 1024 * 8;
    var rows = [
      ['Average QPS', fmt(avg) + ' req/s', 'DAU &times; requests per user / 86,400'],
      ['Peak QPS', fmt(pk) + ' req/s', 'average &times; peak factor ' + peak],
      ['Peak reads / writes', fmt(rq) + ' / ' + fmt(wq) + ' per s', 'split by the write share'],
      ['Database reads after cache', fmt(dbReads) + ' per s', 'reads &times; (1 - hit rate)'],
      ['Busy CPU cores at peak', fmt(effCpu, 1), 'reads cost ~10% of full CPU when served from cache; writes cost full CPU time'],
      ['Cores needed at ' + Math.round(util * 100) + '% utilisation', fmt(coresNeeded, 1), 'busy cores / target utilisation (head-room for spikes and GC)'],
      ['App servers (' + cores + ' vCPU)', servers + ' to carry the peak; <b>' + total + ' deployed</b>', zones > 1 ? perZone + ' per zone &times; ' + zones + ' zones, so losing one zone still leaves enough' : 'plus one spare (N+1)'],
      ['Requests in flight (Little’s law)', fmt(inflight), 'peak QPS &times; latency; sizes thread and connection pools'],
      ['New data per day', bytes(writesDay * ws * 1024), 'writes per day &times; size per write'],
      ['Stored data after ' + yrs + ' year(s)', bytes(stored), 'raw ' + bytes(raw) + ' &times; replication ' + repl + ' &times; 1.4 (indexes, overhead)'],
      ['Cache memory', bytes(cache), 'hot share of one year of data &times; 1.3 overhead'],
      ['Egress bandwidth at peak', bits(egress), 'peak QPS &times; response size (media usually served by a CDN)'],
      ['Ingress bandwidth at peak', bits(ingress), 'peak writes &times; payload size']
    ];
    var hints = [];
    if (wq > 20000) hints.push('Over ~20,000 writes/s: a single relational primary will struggle. Consider sharding, a distributed SQL database, or a NoSQL store partitioned by key.');
    else if (wq > 3000) hints.push('Several thousand writes/s: still possible on one large relational primary with good indexing, but plan for partitioning.');
    if (dbReads > 20000) hints.push('Database reads after cache exceed ~20,000/s: add read replicas or raise the cache hit rate.');
    if (stored > 20e12) hints.push('More than ~20 TB stored: plan partitioning/sharding or tiered storage (hot in the database, cold in object storage).');
    if (inflight > 20000) hints.push('Tens of thousands of requests in flight: use async I/O, connection pooling and keep per-request memory small.');
    if (egress > 10e9) hints.push('Egress above 10 Gbit/s: serve bytes from a CDN; egress is also a major cost line.');
    if (!hints.length) hints.push('This load fits a simple, well-provisioned architecture: load-balanced stateless servers, one relational primary with replicas, and a cache.');
    $('#calc-out').html('<div class="table-wrap"><table class="result-table"><tr><th>Result</th><th>Value</th><th>Formula / reasoning</th></tr>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</table></div>' +
      hints.map(function (h) { return '<div class="rec">' + h + '</div>'; }).join(''));
  }
  $('#preset').on('change', function () { load(this.value); });
  $('#calc').on('input', 'input', calc);
  load('web');

  // ================================================================== GPU / tokens
  var GP = {
    '8b':      { rps: 20, in: 800, out: 300, params: 8, bytes: 2, kv: 0.13, mem: 80, tps: 4000, speed: 50, pin: 0.15, pout: 0.6, hours: 8 },
    '70b':     { rps: 10, in: 1000, out: 400, params: 70, bytes: 1, kv: 0.16, mem: 80, tps: 1500, speed: 30, pin: 1, pout: 3, hours: 8 },
    '70b-rag': { rps: 10, in: 8000, out: 400, params: 70, bytes: 1, kv: 0.16, mem: 80, tps: 1200, speed: 30, pin: 1, pout: 3, hours: 8 },
    'api':     { rps: 50, in: 2000, out: 500, params: 0, bytes: 1, kv: 0, mem: 80, tps: 1, speed: 50, pin: 2.5, pout: 10, hours: 10 }
  };
  var GF = ['rps', 'in', 'out', 'params', 'bytes', 'kv', 'mem', 'tps', 'speed', 'pin', 'pout', 'hours'];
  function gload(p) { GF.forEach(function (f) { $('#g-' + f).val(GP[p][f]); }); gcalc(); }
  function gv(id) { return Math.max(0, parseFloat($('#g-' + id).val()) || 0); }
  function gcalc() {
    var rps = gv('rps'), tin = gv('in'), tout = gv('out'), params = gv('params'), bpp = gv('bytes'), kv = gv('kv'), mem = Math.max(1, gv('mem')), tps = Math.max(1, gv('tps')), speed = Math.max(1, gv('speed')),
        pin = gv('pin'), pout = gv('pout'), hours = gv('hours');
    var genTime = tout / speed, concurrent = rps * genTime, outTps = rps * tout, inTps = rps * tin;
    var weights = params * 1e9 * bpp, kvMem = concurrent * (tin + tout) * kv * 1e6;
    var gpusMem = (weights + kvMem) / (mem * 1e9 * 0.9), gpusTp = outTps / tps;
    var minPerReplica = Math.max(1, Math.ceil(weights / (mem * 1e9 * 0.8)));
    var tp = [1, 2, 4, 8].filter(function (x) { return x >= minPerReplica; })[0] || 8;
    var gpus = Math.max(tp, Math.ceil(Math.max(gpusMem, gpusTp) / tp) * tp);
    var tokensDay = (inTps + outTps) * 3600 * hours, costDay = (inTps * pin + outTps * pout) / 1e6 * 3600 * hours;
    var rows = [
      ['Concurrent generations', fmt(concurrent, 1), 'RPS &times; generation time (' + genTime.toFixed(1) + ' s = output tokens / speed per request)'],
      ['Output tokens per second', fmt(outTps), 'RPS &times; output tokens'],
      ['Input (prefill) tokens per second', fmt(inTps), 'RPS &times; input tokens; long prompts dominate time-to-first-token'],
      ['Model weights in memory', params ? bytes(weights) : 'hosted API', 'parameters &times; bytes per parameter'],
      ['KV cache for active requests', params ? bytes(kvMem) : '-', 'concurrent &times; (input + output tokens) &times; KV per token'],
      ['GPUs needed for memory', params ? fmt(gpusMem, 1) : '-', '(weights + KV) / (GPU memory &times; 90%)'],
      ['GPUs needed for throughput', params ? fmt(gpusTp, 1) : '-', 'output tokens/s / measured tokens/s per GPU'],
      ['GPUs to deploy', params ? '<b>' + gpus + '</b> (replicas of ' + tp + ' GPU' + (tp > 1 ? 's' : '') + ')' : '-', 'max of the two, rounded up to whole tensor-parallel groups (a replica must hold the weights)'],
      ['Tokens per day (peak hours)', fmt(tokensDay), '(input + output tokens/s) &times; 3,600 &times; ' + hours + ' h'],
      ['Hosted-API cost per day at peak load', '$' + fmt(costDay, 0), 'input and output tokens &times; price per million; output tokens usually cost 3-5&times; more']
    ];
    var hints = [];
    if (params && gpusMem > gpusTp * 1.5) hints.push('Memory-bound: quantise (FP8/INT4), use a model with grouped-query attention, cap prompt length, or enable prefix caching to share KV for common system prompts.');
    if (params && gpusTp > gpusMem * 1.5) hints.push('Throughput-bound: larger batches (continuous batching), speculative decoding, a smaller or distilled model for easy requests, or shorter outputs.');
    if (tin > 4 * tout) hints.push('Prompts are much longer than answers (typical for RAG and agents): prompt caching and retrieving fewer, better chunks cut both latency and cost.');
    hints.push('Always validate with a load test on your serving stack (vLLM, TensorRT-LLM, SGLang, or the provider’s provisioned throughput) at your real prompt and output lengths.');
    $('#gpu-out').html('<div class="table-wrap"><table class="result-table"><tr><th>Result</th><th>Value</th><th>Formula / reasoning</th></tr>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</table></div>' +
      hints.map(function (h) { return '<div class="rec alt">' + h + '</div>'; }).join(''));
  }
  $('#gpreset').on('change', function () { gload(this.value); });
  $('#gpu-calc').on('input', 'input', gcalc);
  gload('8b');

  // ================================================================== database chooser
  var DB = {
    rel:   ['Relational (single primary)', 'sql', 'Tables, joins, ACID transactions, rich SQL. One primary plus replicas; scales vertically and with read replicas.', 'PostgreSQL, MySQL, SQL Server'],
    dsql:  ['Distributed SQL', 'distsql', 'SQL and transactions that shard automatically across nodes and regions; higher write latency.', 'CockroachDB, YugabyteDB, Spanner-style'],
    kv:    ['Key-value / document NoSQL', 'nosql', 'Single-digit-ms reads/writes at any scale by partition key; flexible JSON items; limited queries and transactions.', 'DynamoDB, Cosmos DB, MongoDB'],
    wide:  ['Wide-column', 'widecol', 'Massive write throughput, rows sorted within a partition (great for time-ordered data per key), tunable consistency.', 'Cassandra, ScyllaDB, HBase, Bigtable'],
    mem:   ['In-memory key-value', 'cache', 'Sub-millisecond, rich data structures (sorted sets, streams); RAM-bound; often a cache rather than the source of truth.', 'Redis, Valkey, Memcached'],
    ts:    ['Time-series', 'timeseries', 'Append-heavy timestamped data, compression, downsampling, time-window queries.', 'InfluxDB, TimescaleDB, Prometheus, Data Explorer'],
    search:['Search engine', 'search', 'Inverted indexes for full-text search, relevance ranking, facets and filters; usually fed from a primary store.', 'Elasticsearch, OpenSearch, Solr'],
    graph: ['Graph', 'graph', 'Nodes and edges; fast multi-hop traversals (friends of friends, fraud rings, recommendations).', 'Neo4j, Neptune, Gremlin APIs'],
    vec:   ['Vector index', 'vector', 'Approximate nearest-neighbour search over embeddings for semantic search, RAG and recommendations.', 'pgvector, Milvus, Qdrant, FAISS'],
    obj:   ['Object storage', 'blob', 'Files and blobs of any size, extremely durable and cheap; accessed by key; the base of data lakes.', 'S3, Blob Storage, MinIO'],
    dw:    ['Analytical warehouse / lakehouse', 'warehouse', 'Columnar storage for scans and aggregations over billions of rows; not for per-request lookups.', 'Redshift, Snowflake, BigQuery, Fabric, Databricks'],
    ledger:['Ledger / append-only', 'ledger', 'Immutable, verifiable history of changes; audit and compliance.', 'Double-entry tables in SQL, immutable ledgers'],
    stream:['Event log (stream)', 'stream', 'An ordered, replayable log of events; the source for many downstream views.', 'Kafka, Kinesis, Event Hubs']
  };
  var QS = [
    ['shape', 'What does the data look like?', [
      ['rows', 'Structured rows with relationships', { rel: 4, dsql: 3 }], ['docs', 'Self-contained documents, flexible schema', { kv: 4, rel: 1 }], ['kvs', 'Simple key → value lookups', { kv: 3, mem: 3, wide: 1 }],
      ['ts', 'Timestamped measurements / events', { ts: 4, wide: 3, stream: 2 }], ['graph', 'Highly connected (graph)', { graph: 5 }], ['files', 'Files, images, video', { obj: 5 }],
      ['vec', 'Embeddings for similarity', { vec: 5 }], ['text', 'Text to search', { search: 5 }], ['hist', 'History for analytics', { dw: 5, obj: 2 }]]],
    ['tx', 'Consistency and transactions?', [
      ['acid', 'Multi-row ACID transactions (money, inventory)', { rel: 3, dsql: 3, ledger: 2 }], ['item', 'Atomic per item is enough', { kv: 2, wide: 1, mem: 1 }], ['eventual', 'Eventual consistency is fine', { wide: 2, kv: 1, search: 1, dw: 1 }]]],
    ['scale', 'How big and how busy?', [
      ['small', 'Fits one server (&lt; few TB, &lt; ~10k writes/s)', { rel: 3, mem: 1 }], ['large', 'Needs horizontal partitioning', { kv: 3, wide: 3, dsql: 2 }], ['global', 'Multi-region with writes in several regions', { kv: 3, dsql: 3, wide: 1 }]]],
    ['query', 'How will you query it?', [
      ['adhoc', 'Ad-hoc queries, joins, reporting', { rel: 3, dsql: 2, dw: 2 }], ['bykey', 'Known patterns by key', { kv: 3, wide: 2, mem: 2 }], ['range', 'Ranges over time per key', { wide: 3, ts: 3 }],
      ['fulltext', 'Full-text and facets', { search: 4 }], ['similar', 'Nearest neighbours', { vec: 4 }], ['agg', 'Big aggregations', { dw: 4, ts: 1 }], ['traverse', 'Multi-hop traversals', { graph: 4 }]]],
    ['latency', 'Latency needed?', [
      ['sub', 'Sub-millisecond', { mem: 4 }], ['ms', 'A few milliseconds', { kv: 2, rel: 1, wide: 1 }], ['sec', 'Seconds are fine', { dw: 2, obj: 1 }]]]
  ];
  var $q = $('#db-questions');
  QS.forEach(function (q, qi) {
    var $d = $('<div class="dbq">').append($('<b>').text((qi + 1) + '. ' + q[1]));
    var def = q[0] === 'latency' ? 1 : 0;                   // neutral default: "a few milliseconds"
    q[2].forEach(function (o, oi) { $d.append($('<label>').append($('<input type="radio">').attr({ name: 'q-' + q[0], value: o[0] }).prop('checked', oi === def), ' ', $('<span>').html(o[1]))); });
    $q.append($d);
  });
  function choose() {
    var score = {}, why = {};
    QS.forEach(function (q) {
      var val = $('input[name=q-' + q[0] + ']:checked').val(), opt = q[2].filter(function (o) { return o[0] === val; })[0];
      var weight = q[0] === 'shape' ? 2 : 1;                 // the shape of the data matters most
      Object.keys(opt[2]).forEach(function (k) { score[k] = (score[k] || 0) + opt[2][k] * weight; (why[k] = why[k] || []).push(opt[1].replace(/&lt;/g, '<')); });
    });
    var ranked = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).slice(0, 3), top = score[ranked[0]];
    var $o = $('#db-out').empty();
    ranked.forEach(function (k, i) {
      var d = DB[k];
      $o.append('<div class="rec' + (i ? ' alt' : '') + '"><b>' + (i === 0 ? 'Best fit: ' : 'Also consider: ') + d[0] + '</b> <span class="muted">(score ' + score[k] + '/' + top + ')</span><br>' + d[2] +
        '<br><span class="muted">Matches: ' + why[k].join('; ') + '</span><br>Open source: ' + d[3] + '<br>Azure: ' + SD.svcHtml(d[1], 'az') + '<br>AWS: ' + SD.svcHtml(d[1], 'aws') + '</div>');
    });
    $o.append('<p class="muted">Most systems combine several stores; run the tool once per kind of data (orders, sessions, search, analytics...).</p>');
  }
  $q.on('change', 'input', choose);
  choose();

  // ================================================================== families table
  var FAM = [
    ['rel', 'Normalised tables, SQL, joins', 'Strong (ACID)', 'Vertical + read replicas; sharding is manual', 'Orders, payments, users, inventory, anything relational'],
    ['dsql', 'SQL across shards and regions', 'Strong (serialisable), higher latency', 'Horizontal, multi-region', 'Global transactional apps that outgrow one primary'],
    ['kv', 'Items by partition key (+ sort key), JSON', 'Tunable; strong per item', 'Horizontal, practically unlimited', 'Carts, profiles, sessions at scale, catalogs, IoT state'],
    ['wide', 'Rows grouped and sorted by partition', 'Tunable (quorums)', 'Horizontal, write-optimised', 'Messages, time-ordered events, feeds, sensor data'],
    ['mem', 'Keys with strings, hashes, sorted sets, streams', 'Strong on one node, async replicas', 'Sharded cluster; RAM-bound', 'Caching, sessions, leaderboards, rate limits, queues'],
    ['ts', 'Series of (time, value, tags)', 'Usually eventual for ingest', 'Horizontal with retention tiers', 'Metrics, monitoring, IoT telemetry, finance ticks'],
    ['search', 'Inverted index of documents', 'Near-real-time (seconds)', 'Shards + replicas', 'Product search, logs, autocomplete, faceted filters'],
    ['graph', 'Vertices and edges with properties', 'Strong (single region) typically', 'Harder to partition', 'Social graphs, fraud detection, knowledge graphs, recommendations'],
    ['vec', 'Embedding vectors + metadata', 'Eventual (index refresh)', 'Horizontal (sharded indexes)', 'Semantic search, RAG, similar items, deduplication'],
    ['obj', 'Blobs by key', 'Strong read-after-write (S3, Azure Blob)', 'Practically unlimited', 'Media, backups, data lakes, model files'],
    ['dw', 'Columnar tables', 'Batch / snapshot', 'Massively parallel', 'BI dashboards, reporting, ML training data'],
    ['stream', 'Ordered, partitioned log', 'Ordered per partition', 'Horizontal by partitions', 'Event-driven integration, CDC, real-time analytics']
  ];
  $('#db-table').html(SD.table(['Family', 'Data model', 'Consistency', 'Scaling', 'Best for', 'Open source examples', 'Azure', 'AWS'],
    FAM.map(function (f) { var d = DB[f[0]]; return ['<b>' + d[0] + '</b>', f[1], f[2], f[3], f[4], d[3], SD.svcHtml(d[1], 'az'), SD.svcHtml(d[1], 'aws')]; })));

  ['azDataStore', 'azCompute', 'azPartition', 'azCaching', 'azPtu', 'azGenGw'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsWaf', 'awsDdbBest', 'awsCaching', 'awsGenAiLens', 'awsMlLens', 'blShedding'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

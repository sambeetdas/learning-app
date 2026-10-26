$(function () {
  'use strict';
  SD.pageChrome('scaling');
  ['globallb', 'cdn', 'apigw', 'lb'].forEach(function (k) { $('#c-' + k).html(SD.svcHtml(k, 'az')); $('#w-' + k).html(SD.svcHtml(k, 'aws')); });

  // ---------------------------------------------------------------- load balancer simulator
  var SPEED = [4, 4, 4, 1.2], WEIGHT = [3, 3, 3, 1], CAP = 25;   // requests each server finishes per tick
  var q, done, dropped, waitSum, rr, wrrSeq, timer = null, r = DSA.rng(7), ticks;
  function reset() { q = SPEED.map(function () { return 0; }); done = 0; dropped = 0; waitSum = 0; rr = 0; ticks = 0; wrrSeq = []; WEIGHT.forEach(function (w, i) { for (var k = 0; k < w; k++) wrrSeq.push(i); }); draw(); }
  function pick(alg) {
    var n = SPEED.length, i, best;
    if (alg === 'rr') return rr++ % n;
    if (alg === 'wrr') return wrrSeq[rr++ % wrrSeq.length];
    if (alg === 'rand') return Math.floor(r() * n);
    if (alg === 'hash') { var client = Math.floor(Math.pow(r(), 1.8) * 40); return (client * 2654435761 >>> 0) % n; }   // skewed clients: some are much busier
    if (alg === 'p2c') { var a = Math.floor(r() * n), b = Math.floor(r() * n); return q[a] <= q[b] ? a : b; }
    best = 0; for (i = 1; i < n; i++) if (q[i] < q[best]) best = i; return best;   // least connections
  }
  function tick() {
    var alg = $('#lb-alg').val(), load = +$('#lb-load').val(), arrivals = Math.max(0, Math.round(load + (r() - 0.5) * load * 0.8));
    for (var k = 0; k < arrivals; k++) { var s = pick(alg); if (q[s] >= CAP) dropped++; else q[s]++; }
    q = q.map(function (x, i) { var f = Math.min(x, SPEED[i] * (0.7 + r() * 0.6)); done += f; waitSum += x; return x - f; });
    ticks++; draw();
  }
  function draw() {
    var $s = $('#lb-stage').empty(), marks = {};
    q.forEach(function (x, i) { marks[i] = x >= CAP - 2 ? 'c' : x > 10 ? 'b' : 'ok'; });
    DSA.bars($s, q.map(function (x) { return Math.round(x); }), { marks: marks, max: CAP });
    $s.append('<div class="cells" style="justify-content:space-around">' + SPEED.map(function (sp, i) { return '<span class="muted" style="font-size:.8rem">server ' + (i + 1) + (i === 3 ? ' (slow)' : '') + '</span>'; }).join('') + '</div>');
    var total = done + dropped;
    $('#lb-stats').html('Served: <b>' + Math.round(done) + '</b> &middot; dropped: <b>' + dropped + '</b>' + (total ? ' (' + (dropped / total * 100).toFixed(1) + '%)' : '') +
      ' &middot; average queue: <b>' + (ticks ? (waitSum / ticks / SPEED.length).toFixed(1) : 0) + '</b>. Capacity is about ' + SPEED.reduce(function (a, b) { return a + b; }, 0).toFixed(0) + ' requests per tick.');
  }
  $('#lb-run').on('click', function () { if (timer) { clearInterval(timer); timer = null; $(this).text('Start'); } else { timer = setInterval(tick, 250); $(this).text('Pause'); } });
  $('#lb-reset').on('click', reset);
  $('#lb-alg').on('change', reset);
  reset();
  for (var w = 0; w < 30; w++) tick();          // pre-run so the first view is meaningful

  // ---------------------------------------------------------------- request path
  var D = { nodes: [['u', 'Client', 'client', 0, 1], ['dns', 'Global DNS', 'dns', 1, 0, 'geo / latency'], ['edge', 'Edge (CDN + WAF)', 'edge', 1, 1, 'anycast PoP'], ['gw', 'API gateway', 'apigw', 2, 1],
    ['lb', 'L7 load balancer', 'lb', 3, 1, 'per region'], ['s1', 'Orders svc #1', 'svc', 4, 0.3], ['s2', 'Orders svc #2', 'svc', 4, 1.7], ['reg', 'Service registry', 'svc', 3, 2.4, 'discovery / mesh'], ['inv', 'Inventory svc', 'svc', 5, 1]],
    edges: [['u', 'dns'], ['u', 'edge'], ['edge', 'gw'], ['gw', 'lb'], ['lb', 's1'], ['lb', 's2'], ['s2', 'reg', '', 'async'], ['s2', 'inv'], ['s1', 'inv']] };
  SD.flows('#path-demo', D, [
    { name: 'North-south request', desc: 'A request from the internet to a service.', steps: [
      ['u', 'dns', 'api.shop.com?', 'DNS picks the closest healthy region (latency-based routing).'], ['u', 'edge', 'HTTPS', 'TLS terminates at the nearest edge; WAF rules and DDoS protection run here.'],
      ['edge', 'gw', 'forward', 'The API gateway authenticates the token, applies rate limits and routes /orders to the orders service.'],
      ['gw', 'lb', 'route /orders', 'A layer-7 load balancer in the region spreads traffic across instances in several zones.'],
      ['lb', 's2', 'least outstanding requests', 'It picks the least-loaded healthy instance.'], ['s2', 'u', '200 OK', 'Response returns along the same path.', 'resp']] },
    { name: 'East-west call', desc: 'A service calling another service inside the platform.', steps: [
      ['s2', 'reg', 'where is inventory?', 'The orders service asks the registry (or its mesh sidecar already knows) for healthy inventory instances.', 'async'],
      ['reg', 's2', '3 healthy endpoints', 'Discovery returns endpoints; client-side load balancing picks one.', 'resp'],
      ['s2', 'inv', 'gRPC ReserveStock (mTLS)', 'The call is encrypted with mutual TLS; the mesh adds retries and timeouts.'], ['inv', 's2', 'reserved', 'Response.', 'resp']] },
    { name: 'Instance failure', desc: 'Health checks and retries hide a failed instance.', steps: [
      ['lb', 's1', 'health check fails', 'Instance #1 stops responding to health checks.', 'err'], ['lb', 's2', 'route all traffic to #2', 'It is removed from rotation within seconds.'],
      ['gw', 'lb', 'retry once (idempotent GET)', 'A request that hit #1 just before it died is retried by the gateway (only safe for idempotent calls).'], ['s2', 'u', '200 OK', 'The user never notices.', 'resp']] }
  ]);

  ['azLbChoice', 'azAutoscale', 'azCdn', 'azp-gateway-routing', 'azp-gateway-offloading', 'azp-backends-for-frontends', 'azBaselineWeb'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsApiRouting', 'blHealth', 'blShuffle', 'blStatic', 'awsWaf'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

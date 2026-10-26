$(function () {
  'use strict';
  SD.pageChrome('reliability');
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  // ---------------------------------------------------------------- retry storm
  var cv = document.getElementById('rt-chart'), g = cv.getContext('2d');
  // 1,000 clients all notice the outage at the same moment. When load exceeds capacity the server suffers
  // congestion collapse: it wastes work on requests that time out, so goodput falls (cap * cap / load, at least 15%).
  function simulate(strat) {
    var N = 1000, CAP = 250, BUCKET = 0.1, T = 12, OUT = 2, r = DSA.rng(4), bins = [], i, served = 0, maxLoad = 0, doneAt = 0, attempts = 0;
    for (i = 0; i < T / BUCKET; i++) bins.push(0);
    var clients = []; for (i = 0; i < N; i++) clients.push({ b: 0, attempt: 0, done: false });   // b = integer time bucket of the next attempt
    for (var b = 0; b < bins.length; b++) {
      var now = b * BUCKET, due = clients.filter(function (c) { return !c.done && c.b === b; });
      bins[b] = due.length; maxLoad = Math.max(maxLoad, due.length); attempts += due.length;
      var cap = now < OUT ? 0 : CAP, good = due.length <= cap ? due.length : Math.floor(cap * Math.max(0.15, cap / due.length)), okCount = 0;
      due.forEach(function (c) {
        if (okCount < good) { okCount++; c.done = true; served++; doneAt = now; return; }
        c.attempt++;
        var ceil = Math.min(4, 0.1 * Math.pow(2, c.attempt));
        var wait = strat === 'none' ? BUCKET : strat === 'exp' ? ceil : r() * ceil;
        c.b = b + Math.max(1, Math.round(wait / BUCKET));
      });
    }
    return { bins: bins, served: served, max: maxLoad, doneAt: doneAt, CAP: CAP, BUCKET: BUCKET, OUT: OUT, attempts: attempts };
  }
  function drawRt() {
    var s = simulate($('#rt-strat').val()), W = cv.width, H = cv.height, m = 34, max = Math.max(s.CAP * 1.4, s.max * 1.05);
    g.fillStyle = css('--bg'); g.fillRect(0, 0, W, H); g.strokeStyle = css('--line'); g.strokeRect(m, 10, W - m - 10, H - m - 10);
    var bw = (W - m - 10) / s.bins.length;
    s.bins.forEach(function (v, i) { var h = v / max * (H - m - 20); g.fillStyle = v > s.CAP ? css('--bad') : css('--accent'); g.fillRect(m + i * bw, H - m - h, Math.max(1, bw - 1), h); });
    var cy = H - m - s.CAP / max * (H - m - 20); g.strokeStyle = css('--good'); g.setLineDash([6, 4]); g.beginPath(); g.moveTo(m, cy); g.lineTo(W - 10, cy); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--muted'); g.font = '12px system-ui';
    g.fillText('requests per 100 ms (red = above capacity, dashed green = capacity ' + s.CAP + '); service down for the first ' + s.OUT + ' s', m + 6, 24);
    g.fillText('time → 12 s', W - 90, H - 10);
    var strat = $('#rt-strat').val();
    $('#rt-out').html('Requests sent: <b>' + s.attempts.toLocaleString() + '</b> for 1,000 users &middot; peak <b>' + s.max + '</b> per 100 ms (capacity ' + s.CAP + ') &middot; <b>' + s.served + '</b> of 1,000 succeeded within 12 s' +
      (s.served === 1000 ? ', the last at ' + s.doneAt.toFixed(1) + ' s.' : '.') + ' ' +
      (strat === 'none' ? 'Immediate retries multiply the load many times over during the outage and keep the recovering service in congestion collapse.' :
       strat === 'exp' ? 'Backoff cuts the number of requests, but every client waits the same time, so they return in synchronised waves that overload the service again.' :
       'Jitter spreads the retries over time, so the recovering service stays under capacity and everyone gets through with the fewest requests.'));
  }
  $('#rt-strat').on('change', drawRt); drawRt();

  // ---------------------------------------------------------------- circuit breaker
  var st, fails, cool;
  function cbReset() { st = 'CLOSED'; fails = 0; cool = 0; cbDraw('Closed: requests flow normally. After 3 consecutive failures the breaker trips.'); }
  function cbDraw(msg) {
    var D = { nodes: [['c', 'CLOSED', 'svc', 0, 0, 'calls pass through'], ['o', 'OPEN', 'svc', 2, 0, 'fail fast'], ['h', 'HALF-OPEN', 'svc', 1, 1.3, 'trial request']],
      edges: [['c', 'o', '3 failures'], ['o', 'h', 'after 30 s'], ['h', 'c', 'trial succeeds'], ['h', 'o', 'trial fails']] };
    var marks = {}; marks[{ CLOSED: 'c', OPEN: 'o', 'HALF-OPEN': 'h' }[st]] = st === 'OPEN' ? 'c' : st === 'CLOSED' ? 'b' : 'a';
    var $s = $('#cb-stage').empty(); SD.diagram($s, D, { marks: marks });
    $s.append('<div class="readout">State: <b>' + st + '</b> &middot; consecutive failures: <b>' + fails + '</b></div>');
    $('#cb-msg').text(msg);
  }
  $('#cb-ok').on('click', function () {
    if (st === 'OPEN') return cbDraw('Open: the call is rejected immediately (or a fallback is served) without touching the dependency. Wait for the cool-down.');
    if (st === 'HALF-OPEN') { st = 'CLOSED'; fails = 0; return cbDraw('The trial request succeeded: the breaker closes and normal traffic resumes.'); }
    fails = 0; cbDraw('Success: the failure counter resets.');
  });
  $('#cb-fail').on('click', function () {
    if (st === 'OPEN') return cbDraw('Open: rejected immediately. The failing dependency gets breathing room to recover.');
    if (st === 'HALF-OPEN') { st = 'OPEN'; return cbDraw('The trial request failed: back to open for another cool-down.'); }
    fails++;
    if (fails >= 3) { st = 'OPEN'; return cbDraw('Third consecutive failure: the breaker trips to OPEN. Callers now fail fast instead of piling up on timeouts.'); }
    cbDraw('Failure ' + fails + ' of 3 (each one waited for a timeout).');
  });
  $('#cb-wait').on('click', function () { if (st === 'OPEN') { st = 'HALF-OPEN'; cbDraw('The cool-down elapsed: HALF-OPEN lets one trial request through to test the dependency.'); } else cbDraw('Waiting changes nothing unless the breaker is open.'); });
  $('#cb-reset').on('click', cbReset); cbReset();

  // ---------------------------------------------------------------- bulkheads
  var BH = { nodes: [['u', 'Requests', 'client', 0, 1], ['app', 'API service', 'svc', 1.5, 1, 'thread pools'], ['pay', 'Payments API', 'ext', 3, 0.2, 'slow today'], ['cat', 'Catalog DB', 'db', 3, 1.2], ['rec', 'Recommendations', 'svc', 3, 2.2]],
    edges: [['u', 'app'], ['app', 'pay'], ['app', 'cat'], ['app', 'rec']] };
  SD.multi('#bh-demo', [
    { name: 'Without bulkheads', desc: 'One shared pool of 200 threads for every dependency.', diagram: BH, steps: [
      ['app', 'pay', 'calls hang (30 s)', 'The payments provider becomes slow; each call holds a thread for 30 seconds.', 'err'],
      ['u', 'app', 'more requests', 'Requests keep arriving; soon all 200 threads are stuck waiting on payments.', 'err'],
      ['app', 'cat', 'cannot even browse', 'Browsing the catalogue (which does not need payments) also fails: no free threads. One slow dependency took down everything.', 'err']] },
    { name: 'With bulkheads + timeouts', desc: 'Separate pools per dependency, short timeouts, a breaker and a fallback.', diagram: BH, steps: [
      ['app', 'pay', 'pool of 20, timeout 2 s', 'Payments get their own small pool and a 2-second timeout; when it fills, checkout fails fast with "try again".', 'err'],
      ['app', 'cat', 'separate pool: fine', 'The catalogue pool is unaffected: users can still browse.'], ['cat', 'app', 'products', 'Browsing keeps working.', 'resp'],
      ['app', 'rec', 'breaker open: fallback', 'Recommendations are optional: if they fail, show "popular items" instead (graceful degradation).', 'resp']] }
  ]);

  // ---------------------------------------------------------------- DR
  var DRD = { nodes: [['u', 'Users', 'client', 0, 1], ['g', 'Global LB / DNS', 'edge', 1, 1], ['a', 'Primary region', 'svc', 2.3, 0.3], ['b', 'Secondary region', 'svc', 2.3, 1.7], ['da', 'DB (primary)', 'db', 3.6, 0.3], ['db', 'DB (replica)', 'db', 3.6, 1.7], ['bk', 'Backups', 'blob', 4.9, 1, 'other region']],
    edges: [['u', 'g'], ['g', 'a'], ['g', 'b'], ['a', 'da'], ['b', 'db'], ['da', 'db', 'replication', 'async'], ['da', 'bk', 'snapshots', 'async']] };
  SD.multi('#dr-demo', [
    { name: 'Backup and restore', desc: 'Only backups exist in the second region.', diagram: DRD, steps: [
      ['da', 'bk', 'nightly backup', 'Backups are copied to another region.', 'async'], ['g', 'a', 'region fails', 'The primary region is lost.', 'err'],
      ['bk', 'db', 'restore (hours)', 'Provision infrastructure from code and restore the latest backup: data since the last backup is lost (RPO hours), and it takes hours (RTO).'], ['g', 'b', 'switch DNS', 'Traffic moves once the new stack is ready.']] },
    { name: 'Warm standby', desc: 'A scaled-down copy runs all the time with continuous replication.', diagram: DRD, steps: [
      ['da', 'db', 'continuous replication', 'Data replicates continuously (seconds of lag).', 'async'], ['g', 'a', 'region fails', 'The primary region is lost.', 'err'],
      ['db', 'b', 'promote replica + scale out', 'Promote the replica to primary and scale the standby compute up (minutes).'], ['g', 'b', 'shift traffic', 'The global load balancer sends users to the secondary region.']] },
    { name: 'Active-active', desc: 'Both regions serve traffic all the time.', diagram: DRD, steps: [
      { par: [['g', 'a', '50% of users'], ['g', 'b', '50% of users']], msg: 'Both regions serve users near them.' }, ['da', 'db', 'bi-directional / multi-write replication', 'Data replicates both ways; conflicts must be resolved (or each user is homed to one region).', 'async'],
      ['g', 'a', 'region fails', 'A region fails.', 'err'], ['g', 'b', 'health checks: all traffic to B', 'Traffic shifts automatically within seconds; B was sized to carry everything.']] }
  ]);

  // ---------------------------------------------------------------- deployments
  var DP = { nodes: [['u', 'Users', 'client', 0, 1], ['lb', 'Load balancer', 'lb', 1.4, 1, 'traffic split'], ['v1', 'Version 1 (blue)', 'svc', 3, 0.3], ['v2', 'Version 2 (green)', 'svc', 3, 1.7], ['mon', 'Monitoring', 'svc', 4.5, 1, 'errors, latency']],
    edges: [['u', 'lb'], ['lb', 'v1'], ['lb', 'v2'], ['v1', 'mon', '', 'async'], ['v2', 'mon', '', 'async']] };
  SD.multi('#dep-demo', [
    { name: 'Canary', desc: 'Expose the new version to a small slice of traffic and let metrics decide.', diagram: DP, steps: [
      ['lb', 'v1', '95% of traffic', 'Most traffic stays on the current version.'], ['lb', 'v2', '5% canary', 'A small share goes to the new version.'],
      ['v2', 'mon', 'error rate, p99', 'Automated analysis compares the canary with the baseline.', 'async'], ['mon', 'lb', 'healthy: increase to 25%, 50%, 100%', 'If metrics stay healthy, promote in waves; otherwise roll back automatically.', 'resp']] },
    { name: 'Blue/green', desc: 'Two complete environments; flip all traffic at once.', diagram: DP, steps: [
      ['lb', 'v1', '100% on blue', 'Blue (v1) serves everyone while green (v2) is deployed and tested privately.'], ['lb', 'v2', 'switch: 100% to green', 'Flip the load balancer to green.'],
      ['v2', 'mon', 'errors spike!', 'Something is wrong.', 'err'], ['lb', 'v1', 'roll back: flip to blue', 'Rollback is just flipping back; blue was still running.', 'resp']] }
  ]);

  ['azMission', 'azTransient', 'azp-retry', 'azp-circuit-breaker', 'azp-bulkhead', 'azp-throttling', 'azp-health-endpoint-monitoring', 'azp-deployment-stamp', 'azBaselineWeb'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsRetry', 'awsCircuit', 'blBackoff', 'blShedding', 'blShuffle', 'blStatic', 'blRollback', 'blDeploy', 'blFallback', 'blConstant'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

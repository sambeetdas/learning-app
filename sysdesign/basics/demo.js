$(function () {
  'use strict';
  SD.pageChrome('basics');

  // ---------------------------------------------------------------- latency chart (log scale, horizontal bars)
  var LAT = [
    ['L1 cache reference', 1], ['Branch mispredict', 3], ['L2 cache reference', 4], ['Main memory reference', 100], ['Compress 1 KB (fast codec)', 2000],
    ['Read 1 MB sequentially from memory', 10000], ['Redis GET in the same zone', 300000], ['SSD random read', 100000], ['Round trip within a data centre / zone', 500000],
    ['Read 1 MB sequentially from SSD', 1000000], ['Round trip between zones in a region', 1500000], ['Disk (HDD) seek', 5000000], ['Read 1 MB from HDD', 20000000],
    ['Round trip US east ↔ US west', 65000000], ['Round trip Europe ↔ US east', 85000000], ['Round trip Europe ↔ Australia', 260000000],
    ['LLM: time to first token (typical)', 400000000], ['TCP + TLS handshake across an ocean', 300000000]
  ].sort(function (a, b) { return a[1] - b[1]; });
  function human(ns) { return ns < 1000 ? ns + ' ns' : ns < 1e6 ? (ns / 1000).toFixed(ns < 1e4 ? 1 : 0) + ' µs' : ns < 1e9 ? (ns / 1e6).toFixed(ns < 1e7 ? 1 : 0) + ' ms' : (ns / 1e9).toFixed(1) + ' s'; }
  var max = Math.log10(LAT[LAT.length - 1][1]) + 0.3, $c = $('#lat-chart');
  LAT.forEach(function (r) {
    var w = Math.max(2, Math.log10(r[1]) / max * 100);
    $c.append('<div style="display:grid;grid-template-columns:minmax(0,14rem) 1fr;gap:.5rem;align-items:center;margin:2px 0;font-size:.82rem">' +
      '<span>' + r[0] + '</span><span style="display:flex;align-items:center;gap:.4rem"><span style="display:inline-block;height:.9rem;width:' + w + '%;background:color-mix(in srgb, var(--accent) ' + (25 + w * 0.6) + '%, var(--bg));border-radius:3px"></span><b style="white-space:nowrap">' + human(r[1]) + '</b></span></div>');
  });
  $c.append('<p class="muted">Values are typical orders of magnitude on modern cloud hardware; measure your own environment.</p>');

  // ---------------------------------------------------------------- tail latency
  function tail() {
    var n = +$('#fan').val(), p = +$('#slowp').val(), slow = 1 - Math.pow(1 - p, n);
    $('#fan-v').text(n);
    $('#tail-out').html('Probability that a request touching <b>' + n + '</b> backends hits at least one slow one: <b>' + (slow * 100).toFixed(1) + '%</b>. ' +
      (slow > 0.5 ? 'Most requests are slow even though each backend is fast 99% of the time.' : 'Still a noticeable share of slow requests.'));
  }
  $('#fan, #slowp').on('input change', tail); tail();

  // ---------------------------------------------------------------- availability calculator
  var COMP = [['DNS / global LB', 99.99, 1], ['Load balancer', 99.99, 1], ['App servers', 99.9, 3], ['Cache', 99.9, 2], ['Database', 99.95, 2]];
  var $g = $('#av-grid');
  COMP.forEach(function (c, i) {
    $g.append('<label>' + c[0] + ' availability (%)<input type="number" step="0.01" data-i="' + i + '" class="av-a" value="' + c[1] + '"></label>');
    $g.append('<label>' + c[0] + ' redundant copies<input type="number" min="1" max="5" data-i="' + i + '" class="av-n" value="' + c[2] + '"></label>');
  });
  function avail() {
    var total = 1, parts = [];
    COMP.forEach(function (c, i) {
      var a = Math.min(100, +$('.av-a[data-i=' + i + ']').val()) / 100, n = Math.max(1, +$('.av-n[data-i=' + i + ']').val() | 0), eff = 1 - Math.pow(1 - a, n);
      total *= eff; parts.push(c[0] + ': ' + (eff * 100).toPrecision(7) + '%');
    });
    var down = (1 - total) * 525960;
    $('#av-out').html('Per component with redundancy (assuming independent failures): ' + parts.join(' &middot; ') + '<br>End-to-end (all in series): <b>' + (total * 100).toFixed(4) + '%</b> &rArr; about <b>' +
      (down >= 60 ? (down / 60).toFixed(1) + ' hours' : down.toFixed(1) + ' minutes') + '</b> of downtime per year. Correlated failures (a whole zone, a bad deploy) make reality worse, which is why redundancy must cross failure domains.');
  }
  $g.on('input', 'input', avail); avail();

  // ---------------------------------------------------------------- CAP scenarios
  var D = { nodes: [['c1', 'Client EU', 'client', 0, 0], ['n1', 'Replica EU', 'nosql', 1.4, 0, 'account balances'], ['n2', 'Replica US', 'nosql', 3.2, 0, 'account balances'], ['c2', 'Client US', 'client', 4.6, 0]],
            edges: [['c1', 'n1'], ['n1', 'n2', 'replication', 'none'], ['c2', 'n2']] };
  var D2 = { nodes: D.nodes, edges: [['c1', 'n1'], ['c2', 'n2']] };
  SD.multi('#cap-demo', [
    { name: 'Normal operation', desc: 'No partition: a write in EU is replicated to US. (PACELC: even now, waiting for US to confirm adds latency.)', diagram: D, steps: [
      ['c1', 'n1', 'withdraw 30', 'A client in Europe withdraws 30.'], ['n1', 'n2', 'replicate balance=70', 'The EU replica forwards the change.'], ['n2', 'n1', 'ack', 'US confirms (synchronous replication = consistent but slower).', 'resp'],
      ['n1', 'c1', 'OK, balance 70', 'The client sees success.', 'resp'], ['c2', 'n2', 'read balance', 'A US client reads...'], ['n2', 'c2', '70', '...and sees the new balance.', 'resp']] },
    { name: 'Partition: choose CP', desc: 'The link between regions breaks. A CP system refuses requests it cannot make consistent.', diagram: D2, steps: [
      ['n1', 'n2', 'link down', 'The network between the replicas fails.', 'err'], ['c1', 'n1', 'withdraw 30', 'EU client tries to withdraw.'],
      ['n1', 'c1', 'error: cannot reach quorum', 'The EU replica cannot confirm the write with a majority, so it rejects it: consistent, but unavailable for this client.', 'err'],
      ['c2', 'n2', 'read balance', 'US reads still return the last committed value (if US holds the majority), or are also rejected.'], ['n2', 'c2', '100 (correct)', 'No one ever sees a wrong balance.', 'resp']] },
    { name: 'Partition: choose AP', desc: 'An AP system keeps answering on both sides and reconciles later.', diagram: D2, steps: [
      ['n1', 'n2', 'link down', 'The network between the replicas fails.', 'err'], ['c1', 'n1', 'withdraw 80', 'EU client withdraws 80: accepted locally (balance 20).'],
      ['c2', 'n2', 'withdraw 50', 'US client withdraws 50: also accepted (balance 50).'], ['n1', 'c1', 'OK', 'Both clients are happy...', 'resp'], ['n2', 'c2', 'OK', '...for now.', 'resp'],
      ['n1', 'n2', 'link restored: conflict!', 'When the link returns, the replicas disagree: 130 was withdrawn from 100. The app must resolve the conflict (refuse, compensate, or merge).', 'err']],
      end: 'AP is great for carts, likes and feeds; for money, choose CP or add compensation logic.' }
  ]);

  ['azWaf', 'azMission', 'azp-health-endpoint-monitoring', 'azp-retry'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsWaf', 'blDistributed', 'blStatic', 'blBackoff'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

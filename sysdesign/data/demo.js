$(function () {
  'use strict';
  SD.pageChrome('data');

  // ---------------------------------------------------------------- replication strategies
  var LF = { nodes: [['app', 'App', 'svc', 0, 1], ['L', 'Leader', 'db', 1.5, 1, 'accepts writes'], ['f1', 'Follower 1', 'db', 3, 0.2, 'zone B'], ['f2', 'Follower 2', 'db', 3, 1.8, 'zone C'], ['r', 'Reader', 'svc', 4.5, 1]],
    edges: [['app', 'L'], ['L', 'f1', '', 'async'], ['L', 'f2', '', 'async'], ['r', 'f1'], ['r', 'f2']] };
  var ML = { nodes: [['eu', 'App EU', 'svc', 0, 0], ['us', 'App US', 'svc', 0, 2], ['l1', 'Leader EU', 'db', 1.6, 0], ['l2', 'Leader US', 'db', 1.6, 2]], edges: [['eu', 'l1'], ['us', 'l2'], ['l1', 'l2', 'exchange changes', 'async']] };
  var LL = { nodes: [['c', 'Client / coordinator', 'svc', 0, 1], ['a', 'Replica A', 'nosql', 1.6, 0], ['b', 'Replica B', 'nosql', 1.6, 1], ['d', 'Replica C', 'nosql', 1.6, 2]], edges: [['c', 'a'], ['c', 'b'], ['c', 'd']] };
  SD.multi('#rep-demo', [
    { name: 'Leader-follower (async)', desc: 'The most common setup: one leader, followers replay its change log.', diagram: LF, steps: [
      ['app', 'L', 'UPDATE price', 'All writes go to the leader.'], ['L', 'app', 'commit OK', 'The leader acknowledges immediately.', 'resp'],
      { par: [['L', 'f1', 'WAL stream', 'async'], ['L', 'f2', 'WAL stream', 'async']], msg: 'Changes stream to followers asynchronously (milliseconds of lag, more under load).' },
      ['r', 'f1', 'SELECT price', 'Reads scale out across followers...'], ['f1', 'r', 'new price (usually)', '...but a read right after a write may hit a follower that has not caught up yet ("replication lag").', 'resp']] },
    { name: 'Leader failover', desc: 'What happens when the leader dies.', diagram: LF, steps: [
      ['app', 'L', 'write', 'The leader crashes mid-stream.', 'err'], ['f1', 'f2', 'elect new leader', 'Followers (or the managed service) detect the failure and promote the most up-to-date follower.'],
      ['app', 'f1', 'reconnect: writes to new leader', 'Clients reconnect through the same endpoint. With async replication, writes the old leader had not shipped are lost (RPO > 0); synchronous replication avoids this at a latency cost.'],
      ['f1', 'f2', 'stream to remaining follower', 'Replication resumes from the new leader.', 'async']] },
    { name: 'Multi-leader', desc: 'Each region writes locally; leaders exchange changes and must resolve conflicts.', diagram: ML, steps: [
      ['eu', 'l1', 'set title = "A"', 'A user in Europe edits a document.'], ['us', 'l2', 'set title = "B"', 'At the same moment, a user in the US edits it too.'],
      ['l1', 'l2', 'exchange: conflict', 'Both changes replicate and collide.', 'err'], ['l2', 'l1', 'resolve: last writer wins / merge', 'Resolve with last-writer-wins (simple, loses one edit), version vectors and app-level merge, or CRDTs.', 'resp']] },
    { name: 'Leaderless quorum', desc: 'N = 3 replicas, write quorum W = 2, read quorum R = 2: since W + R > N, every read overlaps the latest write.', diagram: LL, steps: [
      { par: [['c', 'a', 'write v2'], ['c', 'b', 'write v2'], ['c', 'd', 'write v2 (node down)', 'err']], msg: 'The write is sent to all 3 replicas; C is down, but 2 acknowledgements meet W = 2, so it succeeds.' },
      { par: [['c', 'b', 'read'], ['c', 'd', 'read (now back, has v1)']], msg: 'A read asks 2 replicas: B returns v2, C (just recovered) returns stale v1.' },
      ['c', 'd', 'read repair: v2', 'The client takes the newest version and repairs C in the background. Anti-entropy (Merkle trees) fixes the rest.', 'async']] }
  ]);

  // ---------------------------------------------------------------- sharding simulator
  var USERS = [], r = DSA.rng(3), syll = ['an', 'be', 'ca', 'da', 'el', 'fa', 'ga', 'ha', 'jo', 'ka', 'li', 'ma', 'ni', 'ol', 'pa', 'ra', 'sa', 'ta', 'vi', 'wa', 'ya', 'zo'];
  var weights = [9, 6, 8, 5, 6, 3, 3, 4, 7, 6, 5, 9, 4, 3, 5, 5, 8, 6, 3, 2, 1, 1];      // realistic skew of first letters
  for (var i = 0; i < 400; i++) {
    var tot = weights.reduce(function (a, b) { return a + b; }, 0), x = r() * tot, k = 0;
    while (x > weights[k]) { x -= weights[k]; k++; }
    USERS.push(syll[k] + syll[Math.floor(r() * syll.length)] + i);
  }
  function h(s, seed) { var v = (2166136261 ^ (seed || 0)) >>> 0; for (var j = 0; j < s.length; j++) { v ^= s.charCodeAt(j); v = Math.imul(v, 16777619) >>> 0; } v ^= v >>> 13; v = Math.imul(v, 0x5bd1e995) >>> 0; return (v ^ v >>> 15) >>> 0; }
  var N = 4, prevAssign = null;
  function assign(strat, n) {
    var a = {};
    if (strat === 'range') {
      var bounds = []; for (var b = 1; b < n; b++) bounds.push(String.fromCharCode(97 + Math.round(26 * b / n)));
      USERS.forEach(function (u) { var s = 0; while (s < bounds.length && u[0] >= bounds[s]) s++; a[u] = s; });
    } else if (strat === 'hash') USERS.forEach(function (u) { a[u] = h(u) % n; });
    else {
      var ring = []; for (var s2 = 0; s2 < n; s2++) for (var v = 0; v < 50; v++) ring.push([h('shard' + s2 + '#' + v, 9), s2]);
      ring.sort(function (p, q) { return p[0] - q[0]; });
      USERS.forEach(function (u) { var hv = h(u), lo = 0, hi = ring.length; while (lo < hi) { var m = (lo + hi) >> 1; if (ring[m][0] < hv) lo = m + 1; else hi = m; } a[u] = ring[lo % ring.length][1]; });
    }
    return a;
  }
  function draw(msg) {
    var strat = $('#sh-strat').val(), skew = $('#sh-work').val() === 'skew', a = assign(strat, N), load = [], keys = [];
    for (var s = 0; s < N; s++) { load.push(0); keys.push(0); }
    USERS.forEach(function (u, idx) { keys[a[u]]++; load[a[u]] += (skew && idx === 7) ? 0 : 1; });
    if (skew) load[a[USERS[7]]] += Math.round(USERS.length * 0.43);           // the celebrity: ~30% of all traffic
    var tot = load.reduce(function (p, q) { return p + q; }, 0), maxL = Math.max.apply(null, load), marks = {};
    load.forEach(function (l, s3) { marks[s3] = l > tot / N * 1.4 ? 'c' : l > tot / N * 1.15 ? 'b' : 'ok'; });
    var $s = $('#sh-stage').empty();
    DSA.bars($s, load, { marks: marks });
    $s.append('<div class="cells" style="justify-content:space-around">' + load.map(function (_, s4) { return '<span class="muted" style="font-size:.8rem">shard ' + (s4 + 1) + ' (' + keys[s4] + ' keys)</span>'; }).join('') + '</div>');
    $('#sh-out').html((msg ? msg + ' ' : '') + 'Busiest shard carries <b>' + (maxL / tot * 100).toFixed(0) + '%</b> of the traffic (an even split would be ' + (100 / N).toFixed(0) + '%).' +
      (skew ? ' The celebrity’s shard is hot under every strategy: fix it with caching or by splitting that key.' : strat === 'range' ? ' Range sharding by first letter is uneven because names are not evenly distributed.' : ''));
    prevAssign = a;
  }
  $('#sh-add').on('click', function () {
    if (N >= 8) return;
    var strat = $('#sh-strat').val(), before = assign(strat, N); N++;
    var after = assign(strat, N), moved = USERS.filter(function (u) { return before[u] !== after[u]; }).length;
    draw('Added shard ' + N + ': <b>' + moved + '</b> of ' + USERS.length + ' keys (' + (moved / USERS.length * 100).toFixed(0) + '%) had to move' +
      (strat === 'hash' ? ' because changing N reshuffles almost everything.' : strat === 'ring' ? ', close to the ideal 1/' + N + '.' : ' (range boundaries shifted).'));
  });
  $('#sh-reset').on('click', function () { N = 4; draw(); });
  $('#sh-strat, #sh-work').on('change', function () { draw(); });
  draw();

  ['azDataStore', 'azPartition', 'azp-sharding', 'azp-index-table', 'azp-materialized-view', 'azp-cqrs', 'azOutbox'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsDdbBest', 'awsOutbox', 'awsSaga', 'blShuffle', 'blDistributed'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

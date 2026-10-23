$(function () {
  'use strict';

  function fnv(s, seed) {                         // FNV-1a 32-bit, with a seed so we get independent hash functions
    var h = (2166136261 ^ (seed || 0)) >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  }

  // ================================================================== Bloom filter
  (function () {
    var M = 24, K = 3;
    var CODE = ['bits = [0] * m', 'def add(x):', '    for i in range(k): bits[hash_i(x) % m] = 1', 'def might_contain(x):', '    return all(bits[hash_i(x) % m] for i in range(k))   # False = definitely not; True = probably'];
    function frames(adds, queries) {
      var bits = [], F = [], i;
      for (i = 0; i < M; i++) bits.push(0);
      function pos(x) { var p = []; for (var j = 0; j < K; j++) p.push(fnv(x, j * 7919) % M); return p; }
      function snap(line, msg, hl) { F.push({ bits: bits.slice(), hl: hl || {}, line: line, msg: msg }); }
      snap(0, 'A Bloom filter is a bit array of size ' + M + ' with ' + K + ' hash functions. It answers "is x in the set?" with no false negatives but some false positives, using a tiny amount of memory.');
      adds.forEach(function (x) {
        var p = pos(x), hl = {}; p.forEach(function (q) { bits[q] = 1; hl[q] = 'ok'; });
        snap(2, 'add("' + x + '"): its ' + K + ' hashes are ' + p.join(', ') + '. Set those bits to 1.', hl);
      });
      queries.forEach(function (x) {
        var p = pos(x), hl = {}, all = true;
        p.forEach(function (q) { hl[q] = bits[q] ? 'b' : 'c'; if (!bits[q]) all = false; });
        var really = adds.indexOf(x) >= 0;
        snap(4, 'Query "' + x + '": bits ' + p.join(', ') + '. ' + (all ? (really ? 'All set: "' + x + '" is probably in the set (and it is).' : 'All set, yet "' + x + '" was never added: a FALSE POSITIVE. Other words happened to set these bits.') : 'Bit ' + p.filter(function (q) { return !bits[q]; })[0] + ' is 0, so "' + x + '" is DEFINITELY not in the set.'), hl);
      });
      var ones = bits.filter(Boolean).length, est = Math.pow(1 - Math.exp(-K * adds.length / M), K);
      snap([], ones + ' of ' + M + ' bits set. Expected false-positive rate ≈ (1 - e^(-kn/m))^k = ' + (est * 100).toFixed(1) + '%. With 10 bits per item and k = 7 it drops to about 1%, whatever the item size.');
      return F;
    }
    function render(f, ctx) { DSA.cells(ctx.stage, f.bits, { marks: f.hl, label: 'bit array' }); }
    function list(id) { return $(id).val().toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 10); }
    var p = DSA.player('#bf-demo', [], render, { code: CODE });
    function build() { p.set(frames(list('#bf-add'), list('#bf-q'))); }
    $('#bf-run').on('click', build);
    build();
  })();

  // ================================================================== Count-Min sketch
  (function () {
    var D = 3, W = 8;
    var CODE = ['table = [[0] * w for _ in range(d)]', 'def add(x):', '    for row in range(d): table[row][hash_row(x) % w] += 1', 'def estimate(x):', '    return min(table[row][hash_row(x) % w] for row in range(d))   # never too low'];
    function frames(stream, q) {
      var T = [], F = [], r, true_ = {};
      for (r = 0; r < D; r++) { T.push([]); for (var c = 0; c < W; c++) T[r].push(0); }
      function snap(line, msg, hl) { F.push({ T: DSA.clone(T), hl: hl || {}, line: line, msg: msg }); }
      snap(0, 'Count-Min sketch: ' + D + ' rows × ' + W + ' counters, one hash function per row. It counts items in a stream using fixed memory, however many distinct items there are.');
      stream.forEach(function (x) {
        true_[x] = (true_[x] || 0) + 1;
        var hl = {}; for (r = 0; r < D; r++) { var c2 = fnv(x, r * 104729) % W; T[r][c2]++; hl[r + ',' + c2] = 'ok'; }
        snap(2, 'add("' + x + '"): increment one counter in every row.', hl);
      });
      var hl = {}, vals = [];
      for (r = 0; r < D; r++) { var c3 = fnv(q, r * 104729) % W; vals.push(T[r][c3]); hl[r + ',' + c3] = 'b'; }
      var est = Math.min.apply(null, vals);
      snap(4, 'Estimate count("' + q + '") = min(' + vals.join(', ') + ') = ' + est + '. True count: ' + (true_[q] || 0) + '. Collisions can only add, so every row over-counts or is exact; the minimum is the best guess. Error ≤ (total/w) with high probability.', hl);
      return F;
    }
    function render(f, ctx) { DSA.grid(ctx.stage, f.T, { marks: f.hl, rowHead: f.T.map(function (_, i) { return 'hash ' + (i + 1); }), colHead: f.T[0].map(function (_, i) { return i; }) }); }
    var p = DSA.player('#cm-demo', [], render, { code: CODE });
    function build() { var s = $('#cm-stream').val().toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 18); p.set(frames(s, $.trim($('#cm-q').val().toLowerCase()) || s[0] || 'a')); }
    $('#cm-run').on('click', build);
    build();
  })();

  // ================================================================== consistent hashing ring
  (function () {
    var KEYS = []; for (var i = 1; i <= 24; i++) KEYS.push('user' + i);
    var servers = ['A', 'B', 'C'], nextName = 3, VN = 3, prev = null;
    var COL = ['a', 'ok', 'p', 'b', 'c'];
    function pt(h) { return h / 4294967296; }
    function ring() {
      var r = [];
      servers.forEach(function (s, si) { for (var v = 0; v < VN; v++) r.push({ s: s, si: si, pos: pt(fnv(s + '#' + v, 99)) }); });
      return r.sort(function (a, b) { return a.pos - b.pos; });
    }
    function owner(key, R) { var p = pt(fnv(key, 7)); for (var j = 0; j < R.length; j++) if (R[j].pos >= p) return R[j]; return R[0]; }
    function assign() { var R = ring(), m = {}; KEYS.forEach(function (k) { m[k] = owner(k, R).s; }); return m; }
    function modAssign(list) { var m = {}; KEYS.forEach(function (k) { m[k] = list[fnv(k, 7) % list.length]; }); return m; }
    function draw(msg) {
      var R = ring(), S = 300, C = S / 2, RAD = 115, s = DSA.svg(S + 280, S);
      DSA.el('circle', { cx: C, cy: C, r: RAD, 'class': 'ed' }, s);
      function xy(p, rr) { var a = p * 2 * Math.PI - Math.PI / 2; return [C + rr * Math.cos(a), C + rr * Math.sin(a)]; }
      var now = assign();
      KEYS.forEach(function (k) {
        var q = xy(pt(fnv(k, 7)), RAD), o = owner(k, R);
        DSA.el('circle', { cx: q[0], cy: q[1], r: 5, 'class': 'nd' + DSA.mk(COL[o.si % COL.length]) }, s);
      });
      R.forEach(function (n) {
        var q = xy(n.pos, RAD), lbl = xy(n.pos, RAD + 22);
        DSA.el('rect', { x: q[0] - 7, y: q[1] - 7, width: 14, height: 14, rx: 3, 'class': 'nd' + DSA.mk(COL[n.si % COL.length]) }, s);
        DSA.text(s, lbl[0], lbl[1], n.s, 'ptr');
      });
      DSA.text(s, S + 20, 30, 'squares = servers (' + VN + ' virtual nodes each)', 'small', 'start');
      DSA.text(s, S + 20, 50, 'dots = keys, coloured by owner', 'small', 'start');
      DSA.text(s, S + 20, 70, 'a key belongs to the next server clockwise', 'small', 'start');
      var counts = {}; servers.forEach(function (x) { counts[x] = 0; }); KEYS.forEach(function (k) { counts[now[k]]++; });
      servers.forEach(function (x, i) { DSA.text(s, S + 20, 100 + i * 18, x + ': ' + counts[x] + ' keys', 'lab', 'start'); });
      $('#ch-stage').empty().append(s);
      $('#ch-msg').html(msg || 'Add or remove a server and see how many keys have to move.');
    }
    function change(fn, what) {
      var before = assign(), beforeMod = modAssign(servers.slice());
      fn();
      var after = assign(), afterMod = modAssign(servers.slice()), moved = 0, movedMod = 0;
      KEYS.forEach(function (k) { if (before[k] !== after[k]) moved++; if (beforeMod[k] !== afterMod[k]) movedMod++; });
      draw(what + ': consistent hashing moved <b>' + moved + '</b> of ' + KEYS.length + ' keys (only those next to the change). Plain <code>hash(key) % N</code> would have moved <b>' + movedMod + '</b>.');
    }
    $('#ch-add').on('click', function () { if (servers.length >= 5) return; var n = String.fromCharCode(65 + nextName++); change(function () { servers.push(n); }, 'Added server ' + n); });
    $('#ch-del').on('click', function () { if (servers.length <= 1) return; var gone = servers[servers.length - 1]; change(function () { servers.pop(); }, 'Removed server ' + gone); });
    $('#ch-vn').on('change', function () { VN = +this.value; draw('With ' + VN + ' virtual node(s) per server. More virtual nodes spread the load more evenly.'); });
    draw();
  })();

  // ================================================================== reservoir sampling
  (function () {
    var CODE = ['reservoir = []', 'for i, x in enumerate(stream):          # i = 0, 1, 2, ...', '    if i < k: reservoir.append(x)        # fill the first k slots', '    else:', '        j = random.randint(0, i)         # keep x with probability k / (i + 1)', '        if j < k: reservoir[j] = x       # it replaces a random current sample'];
    function frames(n, k, seed) {
      var r = DSA.rng(seed), res = [], F = [], i;
      F.push({ res: [], stream: n, i: -1, line: 0, msg: 'Pick ' + k + ' items uniformly at random from a stream whose length you do not know in advance, keeping only ' + k + ' items in memory.' });
      for (i = 0; i < n; i++) {
        if (i < k) { res.push(i + 1); F.push({ res: res.slice(), stream: n, i: i, slot: i, line: 2, msg: 'Item ' + (i + 1) + ': one of the first ' + k + ', so it goes straight into the reservoir.' }); }
        else {
          var j = Math.floor(r() * (i + 1));
          if (j < k) { var old = res[j]; res[j] = i + 1; F.push({ res: res.slice(), stream: n, i: i, slot: j, line: [4, 5], msg: 'Item ' + (i + 1) + ': random j = ' + j + ' < ' + k + ' (probability ' + k + '/' + (i + 1) + '): it replaces item ' + old + ' in slot ' + j + '.' }); }
          else F.push({ res: res.slice(), stream: n, i: i, line: 4, msg: 'Item ' + (i + 1) + ': random j = ' + j + ' ≥ ' + k + ': discard it (kept with probability only ' + k + '/' + (i + 1) + ').' });
        }
      }
      F.push({ res: res, stream: n, i: n, line: [], msg: 'Final sample: ' + res.join(', ') + '. By induction, every item ends up in the reservoir with probability exactly ' + k + '/' + n + '. Press "Simulate" to check that empirically.' });
      return F;
    }
    function render(f, ctx) {
      var items = [], m = {}; for (var t = 0; t < f.stream; t++) { items.push(t + 1); m[t] = t === f.i ? 'a' : (t < f.i ? (f.res.indexOf(t + 1) >= 0 ? 'ok' : 'dim') : ''); }
      DSA.cells(ctx.stage, items, { marks: m, label: 'stream (green = currently in the reservoir)', noIndex: true });
      var rm = {}; if (f.slot !== undefined) rm[f.slot] = 'ok';
      DSA.cells(ctx.stage, f.res, { marks: rm, label: 'reservoir' });
    }
    var seed = 3, p = DSA.player('#rs-demo', frames(12, 3, seed), render, { code: CODE });
    $('#rs-again').on('click', function () { seed++; p.set(frames(12, 3, seed)); });
    $('#rs-sim').on('click', function () {
      var N = 12, K = 3, T = 10000, cnt = []; for (var i = 0; i < N; i++) cnt.push(0);
      var r = DSA.rng(Date.now() % 100000);
      for (var t = 0; t < T; t++) { var res = []; for (i = 0; i < N; i++) { if (i < K) res.push(i); else { var j = Math.floor(r() * (i + 1)); if (j < K) res[j] = i; } } res.forEach(function (x) { cnt[x]++; }); }
      var $h = $('#rs-hist').empty();
      DSA.bars($h, cnt, { max: Math.max.apply(null, cnt) * 1.1 });
      $('<div class="readout">').text('Times each item was selected in ' + T.toLocaleString() + ' runs (expected ' + (T * K / N) + ' each): ' + cnt.join(', ')).appendTo($h);
    });
  })();

  // ================================================================== navigable small-world graph search (the core of HNSW)
  (function () {
    var W = 560, H = 320, NPTS = 45, MNEI = 4;
    var CODE = ['current = entry_point', 'while True:', '    best = the neighbour of current closest to the query', '    if dist(best, q) >= dist(current, q): break   # no neighbour is closer: stop', '    current = best                                # greedy step towards the query', 'return current     # HNSW adds coarse upper layers so the first hops are long jumps'];
    function build(seed) {
      var r = DSA.rng(seed), pts = [];
      for (var i = 0; i < NPTS; i++) pts.push({ x: 20 + r() * (W - 40), y: 20 + r() * (H - 40), id: i });
      var adj = pts.map(function () { return {}; });
      pts.forEach(function (p, i) {
        var d = pts.map(function (q, j) { return { j: j, d: Math.hypot(p.x - q.x, p.y - q.y) }; }).filter(function (o) { return o.j !== i; }).sort(function (a, b) { return a.d - b.d; });
        d.slice(0, MNEI).forEach(function (o) { adj[i][o.j] = 1; adj[o.j][i] = 1; });
        var far = Math.floor(r() * NPTS); if (far !== i && r() < 0.35) { adj[i][far] = 1; adj[far][i] = 1; }   // a few long-range links: the "small world"
      });
      return { pts: pts, adj: adj.map(function (o) { return Object.keys(o).map(Number); }), q: { x: 20 + r() * (W - 40), y: 20 + r() * (H - 40) } };
    }
    function frames(g) {
      var F = [], cur = 0, path = [0], checks = 0;
      function d(i) { return Math.hypot(g.pts[i].x - g.q.x, g.pts[i].y - g.q.y); }
      var truth = 0; g.pts.forEach(function (p, i) { if (d(i) < d(truth)) truth = i; });
      F.push({ g: g, path: [0], cand: [], line: 0, msg: 'Each point (an "embedding vector", shown in 2-D) links to its nearest neighbours plus a few long-range links. Find the point nearest to the star without comparing against all ' + NPTS + ' points.' });
      while (true) {
        var best = cur;
        g.adj[cur].forEach(function (j) { checks++; if (d(j) < d(best)) best = j; });
        F.push({ g: g, path: path.slice(), cand: g.adj[cur].slice(), line: 2, msg: 'At point ' + cur + ': check its ' + g.adj[cur].length + ' neighbours (orange).' });
        if (best === cur) break;
        cur = best; path.push(cur);
        F.push({ g: g, path: path.slice(), cand: [], line: 4, msg: 'Move to point ' + cur + ', which is closer to the query.' });
      }
      F.push({ g: g, path: path, cand: [], truth: truth, line: [3, 5], msg: 'No neighbour is closer: stop at point ' + cur + ' after ' + checks + ' distance computations (brute force: ' + NPTS + '). ' + (cur === truth ? 'It is the true nearest neighbour.' : 'The true nearest is point ' + truth + ' (purple): greedy search is APPROXIMATE. HNSW improves recall with several layers and a candidate list (ef) instead of a single current point.') });
      return F;
    }
    function render(f, ctx) {
      var g = f.g, s = DSA.svg(W, H);
      g.adj.forEach(function (nb, i) { nb.forEach(function (j) { if (j > i) DSA.el('line', { x1: g.pts[i].x, y1: g.pts[i].y, x2: g.pts[j].x, y2: g.pts[j].y, 'class': 'ed m-dim' }, s); }); });
      for (var k = 1; k < f.path.length; k++) { var a = g.pts[f.path[k - 1]], b = g.pts[f.path[k]]; DSA.el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'class': 'ed m-a' }, s); }
      g.pts.forEach(function (p, i) {
        var cls = i === f.path[f.path.length - 1] ? 'ok' : f.path.indexOf(i) >= 0 ? 'a' : f.cand.indexOf(i) >= 0 ? 'b' : (f.truth === i ? 'p' : '');
        DSA.el('circle', { cx: p.x, cy: p.y, r: 7, 'class': 'nd' + DSA.mk(cls) }, s);
      });
      DSA.text(s, g.q.x, g.q.y, '★', 'ptr');
      ctx.stage.append(s);
    }
    var seed = 11, p = DSA.player('#nsw-demo', frames(build(seed)), render, { code: CODE });
    $('#nsw-new').on('click', function () { seed++; p.set(frames(build(seed))); });
  })();
});

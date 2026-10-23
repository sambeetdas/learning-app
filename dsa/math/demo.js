$(function () {
  'use strict';

  // ================================================================== sieve of Eratosthenes
  (function () {
    var CODE = ['is_prime = [True] * (n + 1); is_prime[0] = is_prime[1] = False', 'p = 2', 'while p * p <= n:', '    if is_prime[p]:', '        for m in range(p * p, n + 1, p):   # start at p*p: smaller multiples are already crossed out', '            is_prime[m] = False', '    p += 1'];
    function frames(n) {
      var F = [], st = [], i;
      for (i = 0; i <= n; i++) st.push(i < 2 ? 'x' : '?');
      function snap(line, msg, cur, hits) {
        var rows = [], marks = {};
        for (var r = 0; r * 10 < n; r++) { rows.push([]); for (var c = 1; c <= 10; c++) { var v = r * 10 + c; if (v > n) { rows[r].push(''); continue; } rows[r].push(v);
          var s = st[v], k = r + ',' + (c - 1);
          marks[k] = s === 'x' ? 'dim' : s === 'p' ? 'ok' : '';
          if (v === cur) marks[k] = 'a'; if (hits && hits.indexOf(v) >= 0) marks[k] = 'c'; } }
        F.push({ rows: rows, marks: marks, line: line, msg: msg });
      }
      snap(0, 'All numbers from 2 to ' + n + ' start as "maybe prime". 1 is not prime.');
      for (var p = 2; p * p <= n; p++) {
        if (st[p] === 'x') continue;
        st[p] = 'p';
        var hits = []; for (var m = p * p; m <= n; m += p) { if (st[m] !== 'x') hits.push(m); }
        snap([2, 3], p + ' is not crossed out, so it is prime. Cross out its multiples starting from ' + p + '² = ' + (p * p) + '.', p, hits);
        hits.forEach(function (x) { st[x] = 'x'; });
        snap([4, 5], 'Crossed out ' + hits.length + ' multiple(s) of ' + p + '.', p);
      }
      var count = 0; for (i = 2; i <= n; i++) if (st[i] !== 'x') { st[i] = 'p'; count++; }
      snap(6, 'Once p² > ' + n + ', every number left is prime: ' + count + ' primes up to ' + n + '. O(n log log n) time: almost linear.');
      return F;
    }
    function render(f, ctx) { DSA.grid(ctx.stage, f.rows, { marks: f.marks }); }
    var p = DSA.player('#sv-demo', frames(100), render, { code: CODE });
    $('#sv-n').on('change', function () { p.set(frames(+this.value)); });
  })();

  // ================================================================== gcd + fast power
  (function () {
    var CODES = {
      gcd: ['def gcd(a, b):', '    while b:', '        a, b = b, a % b       # gcd(a, b) = gcd(b, a mod b)', '    return a'],
      pow: ['def power(base, e, mod):', '    result = 1', '    while e > 0:', '        if e & 1: result = result * base % mod   # this bit is set', '        base = base * base % mod                 # base^(2^k)', '        e >>= 1', '    return result']
    };
    function frames(kind, a, b, mod) {
      var F = [], rows = [];
      if (kind === 'gcd') {
        a = Math.abs(Math.floor(a)); b = Math.abs(Math.floor(b));
        F.push({ rows: [['a', 'b', 'a mod b']], marks: {}, line: 0, msg: 'Euclid\'s algorithm (about 300 BC): the gcd of a and b equals the gcd of b and the remainder a mod b.' });
        rows.push(['a', 'b', 'a mod b']);
        while (b) { rows.push([a, b, a % b]); var m = {}; m[(rows.length - 1) + ',2'] = 'b'; F.push({ rows: DSA.clone(rows), marks: m, line: 2, msg: 'gcd(' + a + ', ' + b + ') = gcd(' + b + ', ' + (a % b) + ').' }); var t = a % b; a = b; b = t; }
        rows.push([a, 0, '']); var mm = {}; mm[(rows.length - 1) + ',0'] = 'ok';
        F.push({ rows: rows, marks: mm, line: 3, msg: 'b reached 0: the gcd is ' + a + '. The numbers shrink at least as fast as Fibonacci numbers in reverse, so it takes O(log min(a, b)) steps.' });
      } else {
        // BigInt: with a modulus near 10^9, base * base would overflow JavaScript's exact-integer range
        var M = BigInt(mod), base = ((BigInt(Math.floor(a)) % M) + M) % M, e = Math.max(0, Math.floor(b)), res = 1n, step = 0;
        rows.push(['step', 'bit of e', 'base^(2^k) mod m', 'result']);
        F.push({ rows: DSA.clone(rows), marks: {}, line: [0, 1], msg: 'Compute ' + a + '^' + b + ' mod ' + mod + '. Write the exponent in binary (' + e.toString(2) + ') and square the base at each bit: about log₂ e multiplications instead of e.' });
        while (e > 0) {
          var bit = e % 2;
          if (bit) res = (res * base) % M;
          rows.push([step, bit, String(base), String(res)]);
          var mk = {}; mk[(rows.length - 1) + ',1'] = bit ? 'ok' : 'dim'; if (bit) mk[(rows.length - 1) + ',3'] = 'ok';
          F.push({ rows: DSA.clone(rows), marks: mk, line: bit ? 3 : [4, 5], msg: 'Bit ' + step + ' is ' + bit + (bit ? ': multiply the result by ' + base + ' → ' + res + '.' : ': skip.') + ' Then square the base.' });
          base = (base * base) % M; e = Math.floor(e / 2); step++;
        }
        F.push({ rows: rows, marks: {}, line: 6, msg: a + '^' + b + ' mod ' + mod + ' = ' + String(res) + ' in ' + step + ' rounds. RSA and Diffie-Hellman do this with 2048-bit numbers.' });
      }
      return F;
    }
    function render(f, ctx) { DSA.grid(ctx.stage, f.rows.slice(1), { marks: (function () { var m = {}; Object.keys(f.marks).forEach(function (k) { var p = k.split(','); m[(p[0] - 1) + ',' + p[1]] = f.marks[k]; }); return m; })(), colHead: f.rows[0] }); }
    var p = DSA.player('#nt-demo', [], render, {});
    function build() {
      var k = $('#nt-kind').val();
      $('#nt-mod-wrap').toggle(k === 'pow');
      p.set(frames(k, +$('#nt-a').val(), +$('#nt-b').val(), Math.max(2, +$('#nt-mod').val() || 1000000007)), CODES[k]);
    }
    $('#nt-kind').on('change', function () { var d = { gcd: [1071, 462], pow: [3, 200] }[this.value]; $('#nt-a').val(d[0]); $('#nt-b').val(d[1]); build(); });
    $('#nt-run').on('click', build);
    build();
  })();

  // ================================================================== bit playground
  (function () {
    var OPS = {
      'x & (x - 1)': function (x) { return x & (x - 1); },
      'x & -x': function (x) { return x & -x; },
      'x | (1 << k)': function (x, k) { return x | (1 << k); },
      'x & ~(1 << k)': function (x, k) { return x & ~(1 << k); },
      'x ^ (1 << k)': function (x, k) { return x ^ (1 << k); },
      '(x >> k) & 1': function (x, k) { return (x >> k) & 1; },
      'x << 1': function (x) { return x << 1; },
      'x >> 1': function (x) { return x >> 1; },
      '~x (8-bit)': function (x) { return (~x) & 255; }
    };
    var NOTE = {
      'x & (x - 1)': 'Clears the lowest set bit. x is a power of two exactly when x > 0 and x & (x - 1) == 0. Repeating it counts the set bits (Kernighan).',
      'x & -x': 'Isolates the lowest set bit (two\'s complement: -x = ~x + 1). The heart of the Fenwick tree.',
      'x | (1 << k)': 'Sets bit k.', 'x & ~(1 << k)': 'Clears bit k.', 'x ^ (1 << k)': 'Toggles bit k.', '(x >> k) & 1': 'Reads bit k (0 or 1).',
      'x << 1': 'Shift left: multiply by 2.', 'x >> 1': 'Shift right: integer divide by 2.', '~x (8-bit)': 'Flip every bit (shown for 8 bits).'
    };
    var $sel = $('#bit-op');
    Object.keys(OPS).forEach(function (k) { $('<option>').val(k).text(k).appendTo($sel); });
    function bits(v) { var a = []; for (var i = 7; i >= 0; i--) a.push((v >> i) & 1); return a; }
    function draw() {
      var x = Math.max(0, Math.min(255, +$('#bit-x').val() | 0)), k = Math.max(0, Math.min(7, +$('#bit-k').val() | 0)), op = $sel.val(), r = OPS[op](x, k) & 255;
      var $s = $('#bit-stage').empty(), mx = {}, mr = {};
      bits(x).forEach(function (b, i) { mx[i] = b ? 'a' : ''; }); bits(r).forEach(function (b, i) { mr[i] = b ? 'ok' : ''; });
      if (/k/.test(op)) { mx[7 - k] = (mx[7 - k] ? 'a ' : '') + 'b'; }
      DSA.cells($s, bits(x), { marks: mx, label: 'x = ' + x, noIndex: true });
      DSA.cells($s, bits(r), { marks: mr, label: op.replace('k', k) + ' = ' + r + (op === '(x >> k) & 1' ? '' : ''), noIndex: true });
      $('#bit-note').text(NOTE[op] + '  Popcount(x) = ' + bits(x).filter(Boolean).length + '.');
      $('#bit-k-wrap').toggle(/k/.test(op));
    }
    $('#bit-x, #bit-k, #bit-op').on('input change', draw);
    draw();
  })();

  // ================================================================== convex hull (monotone chain)
  (function () {
    var CODE = ['pts.sort()                                  # by x, then y', 'def cross(o, a, b): return (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x)', 'lower = []', 'for p in pts:', '    while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:', '        lower.pop()                              # not a left (counter-clockwise) turn', '    lower.append(p)', 'upper = the same over reversed(pts)', 'hull = lower[:-1] + upper[:-1]'];
    var W = 560, H = 300;
    function points(seed, n) { var r = DSA.rng(seed), a = []; for (var i = 0; i < n; i++) a.push({ x: Math.round(30 + r() * (W - 60)), y: Math.round(30 + r() * (H - 60)), id: i }); return a; }
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    function frames(pts) {
      // y grows downward on screen; flip it for the maths so "left turn" means counter-clockwise as usual
      var P = pts.map(function (p) { return { x: p.x, y: H - p.y, id: p.id }; }).sort(function (a, b) { return a.x - b.x || a.y - b.y; });
      var F = [], hull = [], lowerDone = [];
      function snap(line, msg, chain, test, popped) { F.push({ pts: pts, chain: chain.map(function (p) { return p.id; }), done: lowerDone.map(function (p) { return p.id; }), test: test, popped: popped, line: line, msg: msg }); }
      snap(0, 'Find the smallest convex polygon containing all points (like a rubber band around nails). Sort by x, then build the lower and upper halves with a stack.', []);
      function half(list, name) {
        var ch = [];
        list.forEach(function (p) {
          while (ch.length >= 2) {
            var c = cross(ch[ch.length - 2], ch[ch.length - 1], p);
            if (c > 0) break;
            snap([4, 5], name + ': the turn ' + ch[ch.length - 2].id + '→' + ch[ch.length - 1].id + '→' + p.id + ' is clockwise (cross product ' + c + ' ≤ 0), so point ' + ch[ch.length - 1].id + ' cannot be on the hull. Pop it.', ch, p.id, ch[ch.length - 1].id);
            ch.pop();
          }
          ch.push(p);
          snap(6, name + ': push point ' + p.id + '.', ch, p.id);
        });
        return ch;
      }
      var lower = half(P, 'Lower hull');
      lowerDone = lower;
      var upper = half(P.slice().reverse(), 'Upper hull');
      hull = lower.slice(0, -1).concat(upper.slice(0, -1));
      lowerDone = [];
      snap(8, 'The hull has ' + hull.length + ' of the ' + pts.length + ' points. O(n log n), dominated by the sort; each point is pushed and popped at most once per half.', hull.concat([hull[0]]));
      return F;
    }
    function render(f, ctx) {
      var s = DSA.svg(W, H), byId = {}; f.pts.forEach(function (p) { byId[p.id] = p; });
      function line(ids, cls) { for (var i = 1; i < ids.length; i++) { var a = byId[ids[i - 1]], b = byId[ids[i]]; DSA.el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'class': 'ed m-' + cls }, s); } }
      line(f.done, 'ok'); line(f.chain, 'a');
      if (f.test !== undefined && f.chain.length) { var last = byId[f.chain[f.chain.length - 1]], t = byId[f.test]; DSA.el('line', { x1: last.x, y1: last.y, x2: t.x, y2: t.y, 'class': 'ed m-b', 'stroke-dasharray': '5 4' }, s); }
      f.pts.forEach(function (p) {
        var cls = p.id === f.popped ? 'c' : p.id === f.test ? 'b' : f.chain.indexOf(p.id) >= 0 ? 'a' : f.done.indexOf(p.id) >= 0 ? 'ok' : '';
        DSA.el('circle', { cx: p.x, cy: p.y, r: 9, 'class': 'nd' + DSA.mk(cls) }, s);
        DSA.text(s, p.x, p.y, String(p.id), 'small');
      });
      ctx.stage.append(s);
    }
    var seed = 4;
    var p = DSA.player('#hull-demo', frames(points(seed, 14)), render, { code: CODE });
    $('#hull-new').on('click', function () { seed++; p.set(frames(points(seed, +$('#hull-n').val()))); });
    $('#hull-n').on('change', function () { p.set(frames(points(seed, +this.value))); });
  })();
});

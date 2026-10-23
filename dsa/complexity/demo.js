$(function () {
  'use strict';
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  // ------------------------------------------------------------------ growth-rate chart and time table
  var FN = [
    { k: 'O(1)',       f: function () { return 1; },                           c: '#16a34a' },
    { k: 'O(log n)',   f: function (n) { return Math.max(1, Math.log2(n)); },  c: '#0891b2' },
    { k: 'O(n)',       f: function (n) { return n; },                          c: '#2563eb' },
    { k: 'O(n log n)', f: function (n) { return n * Math.max(1, Math.log2(n)); }, c: '#9333ea' },
    { k: 'O(n²)', f: function (n) { return n * n; },                      c: '#d97706' },
    { k: 'O(2ⁿ)', f: function (n) { return Math.pow(2, n); },             c: '#e11d48' },
    { k: 'O(n!)',      f: function (n) { var r = 1; for (var i = 2; i <= n; i++) { r *= i; if (r > 1e300) return Infinity; } return r; }, c: '#7f1d1d' }
  ];
  var cv = document.getElementById('growth'), g = cv.getContext('2d');

  function drawChart() {
    var N = +$('#g-n').val(), logY = $('#g-log').prop('checked'), W = cv.width, H = cv.height, m = 46;
    $('#g-n-v').text(N);
    g.fillStyle = css('--bg'); g.fillRect(0, 0, W, H);
    var yMax = logY ? 12 : FN[4].f(N);                          // linear: scale to n^2 so the slow ones shoot off the top
    function px(n) { return m + (n - 1) / Math.max(1, N - 1) * (W - m - 110); }
    function py(v) { var y = logY ? Math.log10(Math.max(1, v)) / yMax : v / yMax; return H - 28 - Math.min(1.02, y) * (H - 48); }
    g.strokeStyle = css('--line'); g.lineWidth = 1; g.strokeRect(m, 20, W - m - 110, H - 48);
    g.fillStyle = css('--muted'); g.font = '12px system-ui, sans-serif';
    g.fillText('input size n →', W / 2 - 60, H - 8);
    g.fillText(logY ? 'operations (log scale: 10¹² at top)' : 'operations', m + 4, 14);
    FN.forEach(function (F) {
      g.strokeStyle = F.c; g.lineWidth = 2.5; g.beginPath();
      var lastX = 0, lastY = 0;
      for (var n = 1; n <= N; n += Math.max(1, Math.floor(N / 300))) {
        var x = px(n), y = py(F.f(n));
        if (n === 1) g.moveTo(x, y); else g.lineTo(x, y);
        lastX = x; lastY = y;
      }
      g.stroke();
      g.fillStyle = F.c; g.font = 'bold 12px system-ui, sans-serif';
      g.fillText(F.k, Math.min(lastX, W - 104) + 6, Math.max(14, Math.min(H - 30, lastY)));
    });
  }

  function fmtTime(ops) {
    var s = ops / 1e8;                                          // assume 10^8 simple operations per second
    if (!isFinite(s) || s > 3.15e7 * 1e12) return 'longer than the age of the universe';
    if (s < 1e-6) return (s * 1e9).toFixed(0) + ' ns';
    if (s < 1e-3) return (s * 1e6).toFixed(1) + ' µs';
    if (s < 1) return (s * 1e3).toFixed(1) + ' ms';
    if (s < 60) return s.toFixed(1) + ' s';
    if (s < 3600) return (s / 60).toFixed(1) + ' min';
    if (s < 86400) return (s / 3600).toFixed(1) + ' hours';
    if (s < 3.15e7) return (s / 86400).toFixed(1) + ' days';
    return (s / 3.15e7).toExponential(1) + ' years';
  }
  function fmtOps(v) { return !isFinite(v) ? '∞' : v < 1e6 ? Math.round(v).toLocaleString() : v.toExponential(2); }
  function drawTable() {
    var n = +$('#t-n').val(), $b = $('#t-body').empty();
    FN.forEach(function (F) {
      var ops = F.f(n), s = ops / 1e8;
      $('<tr>').append($('<td>').append($('<b>').text(F.k).css('color', F.c)), $('<td>').text(fmtOps(ops)),
        $('<td>').text(fmtTime(ops)).css('color', s > 10 ? css('--bad') : s > 1 ? css('--warn') : '')).appendTo($b);
    });
  }
  $('#g-n, #g-log').on('input change', drawChart);
  $('#t-n').on('change', drawTable);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { drawChart(); drawTable(); });
  drawChart(); drawTable();

  // ------------------------------------------------------------------ operation counter
  var SNIPS = {
    linear: { code: ['for i in range(n):', '    work(i)          # runs n times'], big: 'O(n)' },
    nested: { code: ['for i in range(n):', '    for j in range(n):', '        work(i, j)   # runs n × n times'], big: 'O(n²)' },
    triangle: { code: ['for i in range(n):', '    for j in range(i + 1, n):', '        work(i, j)   # every pair once: n(n-1)/2'], big: 'O(n²)' },
    halving: { code: ['while n > 1:', '    work()', '    n = n // 2       # the problem halves each time'], big: 'O(log n)' },
    sequence: { code: ['for i in range(n):', '    work_a(i)', 'for j in range(n):', '    work_b(j)        # n + n = 2n'], big: 'O(n)' }
  };
  function framesFor(kind, n) {
    var F = [], count = 0, i, j, marks;
    if (kind === 'linear' || kind === 'sequence') {
      var total = kind === 'linear' ? n : 2 * n, done = {};
      F.push({ cells: total, done: {}, cur: -1, count: 0, line: [], msg: 'Each box is one call to work(). Press Play and count how many run for n = ' + n + '.' });
      for (i = 0; i < total; i++) {
        count++; done[i] = 1;
        F.push({ cells: total, done: $.extend({}, done), cur: i, count: count, line: kind === 'linear' ? 1 : (i < n ? 1 : 3),
                 msg: (kind === 'sequence' && i >= n ? 'Second loop, ' : '') + 'iteration ' + ((i % n) + 1) + ': ' + count + ' operations so far.' });
      }
      F.push({ cells: total, done: done, cur: -1, count: count, line: [], msg: 'Total: ' + count + ' operations for n = ' + n + '. ' + (kind === 'linear' ? 'Doubling n doubles the work: O(n).' : 'Two loops one after another add up: n + n = 2n, and constants are dropped: still O(n).') });
    } else if (kind === 'nested' || kind === 'triangle') {
      var grid = []; for (i = 0; i < n; i++) { grid.push([]); for (j = 0; j < n; j++) grid[i].push(''); }
      F.push({ grid: DSA.clone(grid), marks: {}, count: 0, line: [], msg: 'Each cell (i, j) is one call to work(i, j).' });
      marks = {};
      for (i = 0; i < n; i++) for (j = (kind === 'nested' ? 0 : i + 1); j < n; j++) {
        count++; grid[i][j] = count;
        var m = $.extend({}, marks); m[i + ',' + j] = 'a'; marks[i + ',' + j] = 'ok';
        F.push({ grid: DSA.clone(grid), marks: m, count: count, line: 2, msg: 'i = ' + i + ', j = ' + j + ': ' + count + ' operations so far.' });
      }
      F.push({ grid: grid, marks: marks, count: count, line: [], msg: 'Total: ' + count + (kind === 'nested' ? ' = n² = ' + n * n + '. Doubling n quadruples the work: O(n²).' : ' = n(n-1)/2. Half the square, but still grows like n²: O(n²).') });
    } else {
      var size = n * 4, lo = 0, alive = size;
      F.push({ arr: size, alive: size, count: 0, line: [], msg: 'Start with n = ' + size + '. Each step throws away half of what is left.' });
      while (alive > 1) {
        count++;
        F.push({ arr: size, alive: alive, count: count, line: 1, msg: 'Step ' + count + ': working on ' + alive + ' items.' });
        alive = Math.floor(alive / 2);
        F.push({ arr: size, alive: alive, count: count, line: 2, msg: 'Halve: ' + alive + ' left.' });
      }
      F.push({ arr: size, alive: alive, count: count, line: [], msg: 'Only ' + count + ' steps for n = ' + size + ' (log₂ ' + size + ' = ' + Math.log2(size).toFixed(1) + '). Doubling n adds just one more step: O(log n).' });
    }
    return F;
  }
  function render(f, ctx) {
    if (f.cells !== undefined) {
      var items = [], mk = {};
      for (var i = 0; i < f.cells; i++) { items.push(f.done[i] ? '✓' : ''); mk[i] = i === f.cur ? 'a' : f.done[i] ? 'ok' : ''; }
      DSA.cells(ctx.stage, items, { marks: mk, noIndex: true });
    } else if (f.grid) {
      DSA.grid(ctx.stage, f.grid, { marks: f.marks, rowHead: f.grid.map(function (_, i) { return 'i=' + i; }), colHead: f.grid.map(function (_, j) { return 'j=' + j; }) });
    } else {
      var a = [], m2 = {};
      for (var k = 0; k < f.arr; k++) { a.push(''); m2[k] = k < f.alive ? 'a' : 'dim'; }
      DSA.cells(ctx.stage, a, { marks: m2, noIndex: true });
    }
    $('<div class="readout">').html('Operations counted: <b>' + f.count + '</b>').appendTo(ctx.stage);
  }
  function build() {
    var kind = $('#oc-kind').val(), n = +$('#oc-n').val();
    p.set(framesFor(kind, n), SNIPS[kind].code);
    $('#oc-big').text(SNIPS[kind].big);
  }
  var p = DSA.player('#oc-demo', [], render, { code: SNIPS.linear.code, speed: 300 });
  $('#oc-kind, #oc-n').on('change', build);
  build();
});

$(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function mix(color, pct) { return 'color-mix(in srgb, var(' + color + ') ' + Math.round(pct) + '%, var(--bg))'; }
  function table(rows, cols, cls) {
    var $t = $('<table class="mtx ' + (cls || '') + '">'), r, c;
    for (r = 0; r < rows; r++) { var $tr = $('<tr>').appendTo($t); for (c = 0; c < cols; c++) $('<td>').appendTo($tr); }
    return $t;
  }

  // ================================================================== 1. matrix multiplication
  (function () {
    var A = [[1, 2, 3], [4, 5, 6]], B = [[7, 8], [9, 10], [11, 12]], i = -1, timer = null;
    var $a = table(2, 3), $b = table(3, 2), $c = table(2, 2);
    $('#mm-a').append($a); $('#mm-b').append($b); $('#mm-c').append($c);
    function cell($t, r, c) { return $t.find('tr').eq(r).find('td').eq(c); }
    A.forEach(function (row, r) { row.forEach(function (v, c) { cell($a, r, c).text(v); }); });
    B.forEach(function (row, r) { row.forEach(function (v, c) { cell($b, r, c).text(v); }); });

    function render() {
      $('#mm-demo td').removeClass('hl res');
      $c.find('td').text('?').addClass('pending');
      var k, r, c, text = 'Press Next: each output cell is the dot product of one row of A and one column of B.';
      for (k = 0; k <= i; k++) {
        r = Math.floor(k / 2); c = k % 2;
        var v = A[r].reduce(function (s, x, j) { return s + x * B[j][c]; }, 0);
        cell($c, r, c).text(v).removeClass('pending').addClass('res');
        if (k === i) {
          for (var j = 0; j < 3; j++) { cell($a, r, j).addClass('hl'); cell($b, j, c).addClass('hl'); }
          text = 'C[' + r + '][' + c + '] = ' + A[r].map(function (x, j) { return x + '·' + B[j][c]; }).join(' + ') + ' = ' + v;
        }
      }
      if (i === 3) text += '   →  done: (2,3) @ (3,2) gives shape (2,2). In PyTorch: torch.matmul(A, B) or A @ B.';
      $('#mm-formula').text(text);
      $('#mm-prev').prop('disabled', i < 0); $('#mm-next').prop('disabled', i >= 3);
    }
    function stop() { clearInterval(timer); timer = null; $('#mm-play').text('Play'); }
    $('#mm-next').on('click', function () { stop(); if (i < 3) { i++; render(); } });
    $('#mm-prev').on('click', function () { stop(); if (i >= 0) { i--; render(); } });
    $('#mm-reset').on('click', function () { stop(); i = -1; render(); });
    $('#mm-play').on('click', function () {
      if (timer) { stop(); return; }
      if (i >= 3) i = -1;
      $(this).text('Pause');
      timer = setInterval(function () { if (i < 3) { i++; render(); } else stop(); }, 1300);
    });
    render();
  })();

  // ================================================================== 2. broadcasting
  (function () {
    function parse(s) {
      var parts = $.trim(s).replace(/[()\[\]\s]/g, '').split(',').filter(function (x) { return x !== ''; });
      var dims = parts.map(Number);
      return dims.some(function (d) { return !isFinite(d) || d < 0 || d % 1; }) ? null : dims;
    }
    function render() {
      var a = parse($('#bc-a').val()), b = parse($('#bc-b').val()), $o = $('#bc-out').empty();
      if (!a || !b) { $o.text('Enter shapes like 3,1 or 8,1,5 (whole numbers).'); return; }
      var n = Math.max(a.length, b.length), res = [], ok = true, i;
      function pad(x) { var o = x.slice(); while (o.length < n) o.unshift(null); return o; }
      var pa = pad(a), pb = pad(b);
      var $ra = $('<div class="bc-row">').append('a: '), $rb = $('<div class="bc-row">').append('b: '), $rr = $('<div class="bc-row">').append('out:');
      for (i = 0; i < n; i++) {
        var x = pa[i], y = pb[i], cls = '', out;
        if (x === null) out = y; else if (y === null) out = x;
        else if (x === y) out = x;
        else if (x === 1) { out = y; cls = 'stretch'; }
        else if (y === 1) { out = x; cls = 'stretch'; }
        else { out = '?'; cls = 'bad'; ok = false; }
        res.push(out);
        $ra.append($('<span class="cell">').addClass(x !== null && x === 1 && y !== 1 ? 'stretch' : cls === 'bad' ? 'bad' : '').text(x === null ? '–' : x));
        $rb.append($('<span class="cell">').addClass(y !== null && y === 1 && x !== 1 ? 'stretch' : cls === 'bad' ? 'bad' : '').text(y === null ? '–' : y));
        $rr.append($('<span class="cell">').addClass(cls).text(out));
      }
      $o.append($ra, $rb, $rr, $('<p class="verdict ' + (ok ? 'ok' : 'bad') + '">').text(ok ?
        'Result shape: (' + res.join(', ') + (res.length === 1 ? ',' : '') + ').  Orange = a size-1 dimension that gets stretched (copied) to match; "–" = missing dimension, treated as 1.' :
        'RuntimeError: shapes cannot be broadcast. Compare from the right: sizes must be equal, or one of them must be 1.'));
    }
    $('#bc-preset').on('change', function () { var v = this.value.split('|'); $('#bc-a').val(v[0]); $('#bc-b').val(v[1]); render(); });
    $('#bc-a, #bc-b').on('input', render);
    render();
  })();

  // ================================================================== 3. autograd graph
  (function () {
    var svg = document.getElementById('ag'), X = 2, T = 1;
    var NODES = {
      w:   { x: 70,  y: 70,  label: 'w', sub: 'leaf', leaf: true },
      x:   { x: 70,  y: 150, label: 'x', sub: 'leaf', leaf: true },
      mul: { x: 200, y: 110, label: '×', sub: 'p = w·x' },
      b:   { x: 200, y: 215, label: 'b', sub: 'leaf', leaf: true },
      add: { x: 330, y: 160, label: '+', sub: 'z = p + b' },
      t:   { x: 330, y: 240, label: 't', sub: 'target', leaf: true },
      sub: { x: 460, y: 200, label: '−', sub: 'd = z − t' },
      pow: { x: 590, y: 200, label: '²', sub: 'L = d²' }
    };
    var EDGES = [['w', 'mul'], ['x', 'mul'], ['mul', 'add'], ['b', 'add'], ['add', 'sub'], ['t', 'sub'], ['sub', 'pow']];
    var R = 22, items = {}, edgeEls = [], timers = [];

    EDGES.forEach(function (e) {
      var a = NODES[e[0]], b = NODES[e[1]], dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      var x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * (R + 8), y2 = b.y - uy * (R + 8);
      var g = svgEl('g', { 'class': 'item dim' }, svg);
      var ln = svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': 'eg' }, g);
      var tip = [b.x - ux * R, b.y - uy * R], px = -uy, py = ux;
      var ah = svgEl('polygon', { points: tip[0] + ',' + tip[1] + ' ' + (tip[0] - ux * 9 + px * 5) + ',' + (tip[1] - uy * 9 + py * 5) + ' ' + (tip[0] - ux * 9 - px * 5) + ',' + (tip[1] - uy * 9 - py * 5), 'class': 'ah' }, g);
      edgeEls.push({ from: e[0], to: e[1], g: g, ln: ln, ah: ah });
    });
    Object.keys(NODES).forEach(function (k) {
      var n = NODES[k], g = svgEl('g', { 'class': 'item dim' }, svg);
      svgEl('circle', { cx: n.x, cy: n.y, r: R, 'class': 'nd' + (n.leaf ? ' leaf' : '') }, g);
      svgEl('text', { x: n.x, y: n.y + 4.5, 'text-anchor': 'middle', 'class': 'nm' }, g).textContent = n.label;
      svgEl('text', { x: n.x + R + 5, y: n.y - 8, 'class': 'small' }, g).textContent = n.sub;
      n.valEl = svgEl('text', { x: n.x + R + 5, y: n.y + 6, 'class': 'val' }, g);
      n.gradEl = svgEl('text', { x: n.x + R + 5, y: n.y + 20, 'class': 'grad' }, g);
      items[k] = g;
    });

    function compute() {
      var w = +$('#ag-w').val(), b = +$('#ag-b').val();
      var p = w * X, z = p + b, d = z - T, L = d * d;
      return {
        v: { w: w, x: X, mul: p, b: b, add: z, t: T, sub: d, pow: L },
        g: { pow: 1, sub: 2 * d, add: 2 * d, t: -2 * d, mul: 2 * d, b: 2 * d, w: 2 * d * X, x: 2 * d * w }
      };
    }
    var cur;
    function f(n) { return (Math.round(n * 100) / 100).toFixed(2); }
    function ts(n) { var r = Math.round(n * 100) / 100; return Number.isInteger(r) ? r + '.' : String(r); }   // how PyTorch prints it: tensor(10.)

    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function show(ids, on) { ids.forEach(function (k) { items[k].classList.toggle('dim', !on); }); }
    function showEdges(pairs, on, mode) {
      edgeEls.forEach(function (e) {
        var hit = pairs.some(function (p) { return p[0] === e.from && p[1] === e.to; });
        if (!hit) return;
        e.g.classList.toggle('dim', !on);
        ['fwd', 'bwd'].forEach(function (m) { e.ln.classList.remove(m); e.ah.classList.remove(m); });
        if (on && mode) { e.ln.classList.add(mode); e.ah.classList.add(mode); }
      });
    }
    function settle() {          // remove the moving highlight once a step is done
      edgeEls.forEach(function (e) { ['fwd', 'bwd'].forEach(function (m) { e.ln.classList.remove(m); e.ah.classList.remove(m); }); });
    }
    function setValues(withGrads) {
      cur = compute();
      Object.keys(NODES).forEach(function (k) {
        NODES[k].valEl.textContent = '= ' + f(cur.v[k]);
        NODES[k].gradEl.textContent = withGrads ? '∂L/∂ = ' + f(cur.g[k]) : '';
      });
      $('#ag-out').text(withGrads ? 'w.grad = tensor(' + ts(cur.g.w) + ')    b.grad = tensor(' + ts(cur.g.b) + ')    loss = ' + ts(cur.v.pow) : '(run backward to see the gradients)');
    }
    function reveal(all) {
      show(Object.keys(NODES), all); edgeEls.forEach(function (e) { e.g.classList.toggle('dim', !all); }); settle();
    }
    function caption(t) { $('#ag-caption').text(t); }

    var FWD = [
      { nodes: ['w', 'x', 'b', 't'], edges: [], msg: 'Leaf tensors: w and b have requires_grad=True, so PyTorch will track every operation that uses them.' },
      { nodes: ['mul'], edges: [['w', 'mul'], ['x', 'mul']], msg: 'Forward: p = w * x. PyTorch records this multiply as a node (MulBackward) in the graph.' },
      { nodes: ['add'], edges: [['mul', 'add'], ['b', 'add']], msg: 'Forward: z = p + b. Another node is added to the graph.' },
      { nodes: ['sub'], edges: [['add', 'sub'], ['t', 'sub']], msg: 'Forward: d = z - t, the prediction error.' },
      { nodes: ['pow'], edges: [['sub', 'pow']], msg: 'Forward: L = d ** 2, the loss. The graph was built while computing it (define-by-run).' }
    ];
    var BWD = [
      { nodes: ['pow'], edges: [], msg: 'loss.backward() starts at the end: dL/dL = 1.' },
      { nodes: ['sub'], edges: [['sub', 'pow']], msg: 'Chain rule through d²: dL/dd = 2d.' },
      { nodes: ['add', 't'], edges: [['add', 'sub'], ['t', 'sub']], msg: 'Through the subtraction: the gradient passes to z unchanged, and to t with a minus sign.' },
      { nodes: ['mul', 'b'], edges: [['mul', 'add'], ['b', 'add']], msg: 'Through the addition: the gradient is copied to both p and b.' },
      { nodes: ['w', 'x'], edges: [['w', 'mul'], ['x', 'mul']], msg: 'Through the multiply: dL/dw = dL/dp · x and dL/dx = dL/dp · w. Now w.grad and b.grad are filled in.' }
    ];

    function runForward() {
      clearTimers(); setValues(false); reveal(false);
      FWD.forEach(function (s, i) {
        later(function () { show(s.nodes, true); showEdges(s.edges, true, 'fwd'); caption(s.msg); }, i * 1300);
        later(settle, i * 1300 + 1100);
      });
    }
    function runBackward() {
      clearTimers(); setValues(false); reveal(true); settle();
      Object.keys(NODES).forEach(function (k) { NODES[k].gradEl.textContent = ''; });
      var shown = [];
      BWD.forEach(function (s, i) {
        later(function () {
          showEdges(s.edges, true, 'bwd');
          s.nodes.forEach(function (k) { NODES[k].gradEl.textContent = '∂L/∂ = ' + f(cur.g[k]); });
          caption(s.msg);
        }, i * 1400);
        later(settle, i * 1400 + 1200);
      });
      later(function () { $('#ag-out').text('w.grad = tensor(' + ts(cur.g.w) + ')    b.grad = tensor(' + ts(cur.g.b) + ')    loss = ' + ts(cur.v.pow)); }, BWD.length * 1400 - 600);
    }

    $('#ag-fwd').on('click', runForward);
    $('#ag-bwd').on('click', runBackward);
    $('.ag-slider').on('input', function () {
      clearTimers(); reveal(true); setValues(false);
      $('#ag-w-v').text(f(+$('#ag-w').val())); $('#ag-b-v').text(f(+$('#ag-b').val()));
      caption('Values updated. Press "Backward" to see the new gradients.');
    });
    reveal(true); setValues(false);
  })();

  // ================================================================== 4. activation functions
  (function () {
    var cv = document.getElementById('act'), g = cv.getContext('2d');
    var FUN = {
      relu:     { name: 'ReLU', f: function (x) { return Math.max(0, x); }, note: 'max(0, x). Cheap and does not saturate for positive values, so it is the default in CNNs and MLPs. Neurons stuck at zero ("dying ReLU") stop learning. torch.nn.ReLU' },
      leaky:    { name: 'Leaky ReLU', f: function (x) { return x > 0 ? x : 0.1 * x; }, note: 'Like ReLU but lets a small slope through for negatives, which avoids dead neurons. Used in GANs. torch.nn.LeakyReLU' },
      sigmoid:  { name: 'Sigmoid', f: function (x) { return 1 / (1 + Math.exp(-x)); }, note: 'Squashes to (0, 1): a probability. Used at the output for binary problems. Saturates at both ends, so gradients vanish in deep stacks. torch.sigmoid' },
      tanh:     { name: 'Tanh', f: Math.tanh, note: 'Squashes to (-1, 1) and is zero-centred. Common inside LSTM/GRU cells. Also saturates. torch.tanh' },
      gelu:     { name: 'GELU', f: function (x) { return 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x))); }, note: 'A smooth ReLU-like curve. The standard in transformers (BERT, GPT). torch.nn.GELU' },
      silu:     { name: 'SiLU / Swish', f: function (x) { return x / (1 + Math.exp(-x)); }, note: 'x * sigmoid(x). Smooth and slightly better than ReLU in many deep models (EfficientNet, LLaMA-style gated blocks). torch.nn.SiLU' },
      softplus: { name: 'Softplus', f: function (x) { return Math.log(1 + Math.exp(x)); }, note: 'A smooth version of ReLU that is always positive. Useful when an output must be positive (a variance, a rate). torch.nn.Softplus' }
    };
    function deriv(fn, x) { var h = 1e-4; return (fn(x + h) - fn(x - h)) / (2 * h); }
    function draw() {
      var key = $('#act-fn').val(), F = FUN[key], x0 = +$('#act-x').val();
      var W = cv.width, H = cv.height, XMIN = -5, XMAX = 5, YMIN = -1.6, YMAX = 3.2;
      function px(x) { return (x - XMIN) / (XMAX - XMIN) * W; }
      function py(y) { return H - (y - YMIN) / (YMAX - YMIN) * H; }
      g.fillStyle = css('--bg'); g.fillRect(0, 0, W, H);
      g.strokeStyle = css('--line'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, py(0)); g.lineTo(W, py(0)); g.moveTo(px(0), 0); g.lineTo(px(0), H); g.stroke();
      function curve(fn, col, dash) {
        g.strokeStyle = col; g.lineWidth = 2.5; g.setLineDash(dash || []); g.beginPath();
        for (var i = 0; i <= 200; i++) { var x = XMIN + i / 200 * (XMAX - XMIN), y = fn(x); if (i === 0) g.moveTo(px(x), py(y)); else g.lineTo(px(x), py(y)); }
        g.stroke(); g.setLineDash([]);
      }
      curve(F.f, css('--accent'));
      curve(function (x) { return deriv(F.f, x); }, css('--warn'), [6, 5]);
      var y0 = F.f(x0), d0 = deriv(F.f, x0);
      g.strokeStyle = css('--muted'); g.setLineDash([3, 4]); g.beginPath(); g.moveTo(px(x0), 0); g.lineTo(px(x0), H); g.stroke(); g.setLineDash([]);
      [[y0, css('--accent')], [d0, css('--warn')]].forEach(function (p) { g.beginPath(); g.arc(px(x0), py(p[0]), 5, 0, 6.2832); g.fillStyle = p[1]; g.fill(); });
      g.font = '12px system-ui, sans-serif'; g.fillStyle = css('--accent'); g.fillText('f(x)', 8, 18);
      g.fillStyle = css('--warn'); g.fillText('f’(x)  (the gradient that flows backwards)', 50, 18);
      $('#act-x-v').text(x0.toFixed(1));
      $('#act-readout').html('At x = <b>' + x0.toFixed(1) + '</b>: f(x) = <b>' + y0.toFixed(3) + '</b>, gradient = <b>' + d0.toFixed(3) + '</b>' + (Math.abs(d0) < 0.02 ? ' &mdash; <span class="verdict bad">almost zero: learning stalls here (vanishing gradient)</span>' : ''));
      $('#act-note').text(F.name + ': ' + F.note);
    }
    $('#act-fn, #act-x').on('input change', draw);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
    draw();
  })();

  // ================================================================== 5. convolution
  (function () {
    var IMG = [], i, j;
    for (i = 0; i < 7; i++) { IMG.push([]); for (j = 0; j < 7; j++) IMG[i].push(i >= 1 && i <= 5 && j >= 2 && j <= 4 ? 9 : 0); }
    var KERNELS = {
      vedge: { name: 'Vertical edges', k: [[1, 0, -1], [1, 0, -1], [1, 0, -1]], div: 1, note: 'Responds where brightness changes from left to right.' },
      hedge: { name: 'Horizontal edges', k: [[1, 1, 1], [0, 0, 0], [-1, -1, -1]], div: 1, note: 'Responds where brightness changes from top to bottom.' },
      blur:  { name: 'Blur (average)', k: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], div: 9, note: 'Averages the 3x3 neighbourhood, which smooths the image.' },
      sharp: { name: 'Sharpen', k: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]], div: 1, note: 'Boosts the centre relative to its neighbours.' }
    };
    var steps = [], k = -1, timer = null, outN = 5, outputs = [], maxAbs = 1;
    var $in = $('<table class="mtx grid">'), $k = $('<table class="mtx grid">'), $out = $('<table class="mtx grid">');
    $('#cv-in').append($in); $('#cv-k').append($k); $('#cv-out').append($out);

    function setup() {
      stopAnim();
      var K = KERNELS[$('#cv-kernel').val()], s = +$('#cv-stride').val(), r, c;
      outN = Math.floor((7 - 3) / s) + 1;
      steps = []; outputs = []; maxAbs = 1;
      for (r = 0; r < outN; r++) for (c = 0; c < outN; c++) {
        var sum = 0, a, b;
        for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) sum += IMG[r * s + a][c * s + b] * K.k[a][b];
        sum /= K.div; steps.push({ r: r, c: c, y: r * s, x: c * s, v: sum }); maxAbs = Math.max(maxAbs, Math.abs(sum));
      }
      $in.empty(); $k.empty(); $out.empty();
      IMG.forEach(function (row) { var $tr = $('<tr>').appendTo($in); row.forEach(function (v) { $('<td>').text(v).css('background', v ? mix('--fg', 22) : '').appendTo($tr); }); });
      K.k.forEach(function (row) { var $tr = $('<tr>').appendTo($k); row.forEach(function (v) { $('<td>').text(K.div > 1 ? '1/' + K.div : v).appendTo($tr); }); });
      for (r = 0; r < outN; r++) { var $tr = $('<tr>').appendTo($out); for (c = 0; c < outN; c++) $('<td>').appendTo($tr); }
      k = -1; render();
      $('#cv-note').text(K.name + ': ' + K.note + '  Output size = (7 − 3) / ' + s + ' + 1 = ' + outN + '.');
    }
    function fmt(v) { return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1); }
    function render() {
      $in.find('td').removeClass('patch'); $out.find('td').removeClass('cur');
      var n;
      for (n = 0; n <= k; n++) {
        var st = steps[n], $cell = $out.find('tr').eq(st.r).find('td').eq(st.c);
        $cell.text(fmt(st.v)).css('background', st.v >= 0 ? mix('--accent', Math.abs(st.v) / maxAbs * 70) : mix('--bad', Math.abs(st.v) / maxAbs * 70));
      }
      if (k >= 0) {
        var cur = steps[k], a, b, terms = [];
        for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) $in.find('tr').eq(cur.y + a).find('td').eq(cur.x + b).addClass('patch');
        $out.find('tr').eq(cur.r).find('td').eq(cur.c).addClass('cur');
        $('#cv-formula').text('Output[' + cur.r + '][' + cur.c + '] = sum of (3x3 patch × kernel) = ' + fmt(cur.v));
      } else {
        $('#cv-formula').text('The 3x3 kernel slides over the image. At each position it multiplies the patch by its weights and adds up: one number per position.');
      }
      $('#cv-prev').prop('disabled', k < 0); $('#cv-next').prop('disabled', k >= steps.length - 1);
    }
    function stopAnim() { clearInterval(timer); timer = null; $('#cv-play').text('Play'); }
    $('#cv-next').on('click', function () { stopAnim(); if (k < steps.length - 1) { k++; render(); } });
    $('#cv-prev').on('click', function () { stopAnim(); if (k >= 0) { k--; render(); } });
    $('#cv-reset').on('click', function () { stopAnim(); k = -1; $out.find('td').text('').css('background', ''); render(); });
    $('#cv-play').on('click', function () {
      if (timer) { stopAnim(); return; }
      if (k >= steps.length - 1) { k = -1; $out.find('td').text('').css('background', ''); }
      $(this).text('Pause');
      timer = setInterval(function () { if (k < steps.length - 1) { k++; render(); } else stopAnim(); }, 700);
    });
    $('#cv-kernel, #cv-stride').on('change', setup);
    setup();
  })();

  // ================================================================== 6. self-attention
  (function () {
    var TOK = ['The', 'cat', 'sat', 'on', 'the', 'mat'];
    // illustrative query-key scores (row = query token, column = key token)
    var SC = [
      [1.0, 2.0, 0.2, 0.0, 0.2, 0.1],
      [0.5, 2.0, 1.5, 0.0, 0.0, 0.2],
      [0.3, 2.2, 1.0, 1.2, 0.0, 0.8],
      [0.0, 0.5, 1.8, 0.8, 0.0, 1.6],
      [0.0, 0.0, 0.0, 0.6, 1.0, 2.0],
      [0.0, 0.3, 0.8, 1.7, 1.2, 1.5]
    ];
    var svg = document.getElementById('att'), sel = 2, W = 720, TOP_Y = 50, BOT_Y = 190, xs = TOK.map(function (_, i) { return 70 + i * 116; });
    var tokTop = [], tokBot = [], links = [], pct = [];

    function softmax(row, T) {
      var m = Math.max.apply(null, row), ex = row.map(function (v) { return Math.exp((v - m) / T); }), s = ex.reduce(function (a, b) { return a + b; }, 0);
      return ex.map(function (v) { return v / s; });
    }
    svgEl('text', { x: 8, y: 14, 'class': 'pct' }, svg).textContent = 'Query (click a word)';
    svgEl('text', { x: 8, y: 254, 'class': 'pct' }, svg).textContent = 'Keys (bottom row): the % under each word is how much attention the selected query pays to it';
    TOK.forEach(function (t, i) {
      links.push(svgEl('line', { x1: xs[sel], y1: TOP_Y + 20, x2: xs[i], y2: BOT_Y - 20, 'class': 'link' }, svg));
    });
    TOK.forEach(function (t, i) {
      var g = svgEl('g', { 'class': 'tok top', 'data-i': i }, svg);
      svgEl('rect', { x: xs[i] - 40, y: TOP_Y - 20, width: 80, height: 40, rx: 8 }, g);
      svgEl('text', { x: xs[i], y: TOP_Y + 5, 'text-anchor': 'middle' }, g).textContent = t;
      tokTop.push(g);
      var g2 = svgEl('g', { 'class': 'tok' }, svg);
      svgEl('rect', { x: xs[i] - 40, y: BOT_Y - 20, width: 80, height: 40, rx: 8 }, g2);
      svgEl('text', { x: xs[i], y: BOT_Y + 5, 'text-anchor': 'middle' }, g2).textContent = t;
      pct.push(svgEl('text', { x: xs[i], y: BOT_Y + 38, 'text-anchor': 'middle', 'class': 'pct' }, svg));
      tokBot.push(g2);
    });

    var $mat = $('#att-matrix');
    function render() {
      var T = +$('#att-temp').val(), w = softmax(SC[sel], T);
      $('#att-temp-v').text(T.toFixed(1));
      tokTop.forEach(function (g, i) { g.setAttribute('class', 'tok top' + (i === sel ? ' q' : '')); });
      links.forEach(function (l, i) {
        l.setAttribute('x1', xs[sel]); l.setAttribute('x2', xs[i]);
        l.setAttribute('stroke-width', (1 + w[i] * 16).toFixed(1)); l.setAttribute('opacity', (0.15 + w[i] * 0.85).toFixed(2));
      });
      pct.forEach(function (t, i) { t.textContent = Math.round(w[i] * 100) + '%'; });
      $mat.empty();
      var $head = $('<tr>').append('<td></td>'); TOK.forEach(function (t) { $head.append($('<td>').text(t)); }); $mat.append($head);
      TOK.forEach(function (q, r) {
        var row = softmax(SC[r], T), $tr = $('<tr>').append($('<td>').text(q).css('font-weight', r === sel ? 700 : 400));
        row.forEach(function (v) { $tr.append($('<td>').text(Math.round(v * 100)).css('background', mix('--accent', v * 85))); });
        $mat.append($tr);
      });
      var best = w.indexOf(Math.max.apply(null, w));
      $('#att-note').text('"' + TOK[sel] + '" attends most to "' + TOK[best] + '" (' + Math.round(w[best] * 100) + '%). Its new representation is a weighted mix of all the words, using these weights.');
    }
    $(svg).on('click', '.top', function () { sel = +$(this).attr('data-i'); render(); });
    $('#att-temp').on('input', render);
    render();
  })();
});

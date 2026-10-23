// A tiny neural network trainer written from scratch. It does by hand what PyTorch does for you:
// forward pass, loss, backpropagation, optimizer step.
var PG = (function () {
  'use strict';

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

  // ---------------------------------------------------------------- datasets: points in [-1, 1]^2, label 0 or 1
  var DATASETS = {
    circle: function (r, n) {
      var pts = [], i;
      for (i = 0; i < n; i++) {
        var inner = i % 2 === 0, rad = inner ? r() * 0.45 : 0.7 + r() * 0.3, a = r() * 6.2832;
        pts.push({ x: rad * Math.cos(a) + gauss(r) * 0.03, y: rad * Math.sin(a) + gauss(r) * 0.03, c: inner ? 1 : 0 });
      }
      return pts;
    },
    xor: function (r, n) {
      var pts = [], i;
      for (i = 0; i < n; i++) {
        var x = r() * 2 - 1, y = r() * 2 - 1;
        if (Math.abs(x) < 0.1) x += x < 0 ? -0.1 : 0.1;
        if (Math.abs(y) < 0.1) y += y < 0 ? -0.1 : 0.1;
        pts.push({ x: x, y: y, c: x * y > 0 ? 1 : 0 });
      }
      return pts;
    },
    spiral: function (r, n) {
      var pts = [], i, half = n / 2;
      for (i = 0; i < n; i++) {
        var k = i % 2, t = (Math.floor(i / 2) / half) * 3.2 + 0.2, rad = t / 3.6, a = t * 1.9 + k * Math.PI;
        pts.push({ x: rad * Math.cos(a) + gauss(r) * 0.02, y: rad * Math.sin(a) + gauss(r) * 0.02, c: k });
      }
      return pts;
    },
    blobs: function (r, n) {
      var pts = [], i;
      for (i = 0; i < n; i++) {
        var c = i % 2, cx = c ? 0.45 : -0.45, cy = c ? 0.4 : -0.4;
        pts.push({ x: cx + gauss(r) * 0.2, y: cy + gauss(r) * 0.2, c: c });
      }
      return pts;
    }
  };

  var ACT = {
    tanh: { f: Math.tanh, d: function (z, a) { return 1 - a * a; } },
    relu: { f: function (z) { return z > 0 ? z : 0; }, d: function (z) { return z > 0 ? 1 : 0; } }
  };

  function features(p, extra) {
    return extra ? [p.x, p.y, p.x * p.x, p.y * p.y, p.x * p.y] : [p.x, p.y];
  }

  // ---------------------------------------------------------------- network
  // sizes e.g. [2, 8, 8, 1]. Weights W[l][out][in].
  function Net(sizes, act, seed) {
    var r = rng(seed || 3), l, o, i;
    this.sizes = sizes; this.act = ACT[act]; this.layers = [];
    for (l = 0; l < sizes.length - 1; l++) {
      var nin = sizes[l], nout = sizes[l + 1], scale = Math.sqrt((act === 'relu' ? 2 : 1) / nin), L = { W: [], b: [], gW: [], gb: [], mW: [], vW: [], mb: [], vb: [] };
      for (o = 0; o < nout; o++) {
        L.W.push([]); L.gW.push([]); L.mW.push([]); L.vW.push([]);
        for (i = 0; i < nin; i++) { L.W[o].push(gauss(r) * scale); L.gW[o].push(0); L.mW[o].push(0); L.vW[o].push(0); }
        L.b.push(0); L.gb.push(0); L.mb.push(0); L.vb.push(0);
      }
      this.layers.push(L);
    }
    this.t = 0;
  }

  // returns activations per layer (a[0] = input) and pre-activations z
  Net.prototype.forward = function (x) {
    var a = [x], z = [], l, o, i;
    for (l = 0; l < this.layers.length; l++) {
      var L = this.layers[l], zl = [], al = [], last = l === this.layers.length - 1;
      for (o = 0; o < L.W.length; o++) {
        var s = L.b[o]; for (i = 0; i < a[l].length; i++) s += L.W[o][i] * a[l][i];
        zl.push(s); al.push(last ? 1 / (1 + Math.exp(-s)) : this.act.f(s));
      }
      z.push(zl); a.push(al);
    }
    return { a: a, z: z };
  };
  Net.prototype.predict = function (x) { var f = this.forward(x); return f.a[f.a.length - 1][0]; };

  // one optimisation step on a mini-batch (binary cross-entropy loss)
  Net.prototype.step = function (batchX, batchY, lr, optimizer) {
    var self = this, nL = this.layers.length, l, o, i, b;
    this.layers.forEach(function (L) { L.gW.forEach(function (row) { row.fill(0); }); L.gb.fill(0); });

    for (b = 0; b < batchX.length; b++) {
      var f = this.forward(batchX[b]), delta = [f.a[nL][0] - batchY[b]];   // dLoss/dz for sigmoid + BCE
      for (l = nL - 1; l >= 0; l--) {
        var L = this.layers[l], prev = [];
        for (i = 0; i < f.a[l].length; i++) prev.push(0);
        for (o = 0; o < L.W.length; o++) {
          L.gb[o] += delta[o];
          for (i = 0; i < f.a[l].length; i++) { L.gW[o][i] += delta[o] * f.a[l][i]; prev[i] += L.W[o][i] * delta[o]; }
        }
        if (l > 0) delta = prev.map(function (v, k) { return v * self.act.d(f.z[l - 1][k], f.a[l][k]); });
      }
    }

    this.t++;
    var n = batchX.length, b1 = 0.9, b2 = 0.999, eps = 1e-8, t = this.t;
    this.layers.forEach(function (L) {
      for (o = 0; o < L.W.length; o++) {
        for (i = 0; i < L.W[o].length; i++) L.W[o][i] -= upd(L, 'W', o, i, L.gW[o][i] / n);
        L.b[o] -= upd(L, 'b', o, -1, L.gb[o] / n);
      }
    });
    function upd(L, kind, o, i, g) {
      if (optimizer === 'adam') {
        var m = kind === 'W' ? L.mW[o] : L.mb, v = kind === 'W' ? L.vW[o] : L.vb, k = kind === 'W' ? i : o;
        m[k] = b1 * m[k] + (1 - b1) * g; v[k] = b2 * v[k] + (1 - b2) * g * g;
        return lr * (m[k] / (1 - Math.pow(b1, t))) / (Math.sqrt(v[k] / (1 - Math.pow(b2, t))) + eps);
      }
      return lr * g;                                                          // plain SGD
    }
  };

  function evaluate(net, pts, extra) {
    var loss = 0, right = 0;
    pts.forEach(function (p) {
      var pr = Math.min(1 - 1e-9, Math.max(1e-9, net.predict(features(p, extra))));
      loss += -(p.c * Math.log(pr) + (1 - p.c) * Math.log(1 - pr));
      if ((pr > 0.5 ? 1 : 0) === p.c) right++;
    });
    return { loss: loss / pts.length, acc: right / pts.length };
  }

  return { rng: rng, DATASETS: DATASETS, Net: Net, features: features, evaluate: evaluate };
})();

// ====================================================================== UI
$(function () {
  'use strict';
  var COLORS = ['#2563eb', '#e11d48'];                       // class 0 / class 1
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  var map = document.getElementById('pg-map'), curve = document.getElementById('pg-curve');
  var mg = map.getContext('2d'), cg = curve.getContext('2d');
  var net, pts, hist, timer, steps, r;

  function opts() {
    return {
      dataset: $('#pg-data').val(), hidden: +$('#pg-layers').val(), width: +$('#pg-width').val(), act: $('#pg-act').val(),
      extra: $('#pg-extra').prop('checked'), opt: $('#pg-opt').val(), lr: Math.pow(10, +$('#pg-lr').val()), batch: +$('#pg-batch').val()
    };
  }

  function build() {
    stop();
    var o = opts(), sizes = [o.extra ? 5 : 2], i;
    for (i = 0; i < o.hidden; i++) sizes.push(o.width);
    sizes.push(1);
    r = PG.rng(5);
    pts = PG.DATASETS[o.dataset](r, 200);
    net = new PG.Net(sizes, o.act, 3);
    hist = []; steps = 0;
    $('#pg-arch').text('Model: ' + sizes.join(' → ') + '   (' + (o.hidden ? o.hidden + ' hidden layer' + (o.hidden > 1 ? 's' : '') : 'no hidden layer: just logistic regression') + ')');
    draw();
  }

  function stop() { clearInterval(timer); timer = null; $('#pg-play').text('Train'); }

  function tick() {
    var o = opts(), s, k;
    for (s = 0; s < 8; s++) {
      var bx = [], by = [];
      for (k = 0; k < o.batch; k++) { var p = pts[Math.floor(r() * pts.length)]; bx.push(PG.features(p, o.extra)); by.push(p.c); }
      net.step(bx, by, o.lr, o.opt); steps++;
    }
    hist.push(PG.evaluate(net, pts, o.extra));
    draw();
    if (steps >= 8000) stop();
  }

  function draw() {
    var o = opts(), N = 40, cell = map.width / N, gx, gy;
    mg.fillStyle = css('--bg'); mg.fillRect(0, 0, map.width, map.height);
    for (gx = 0; gx < N; gx++) for (gy = 0; gy < N; gy++) {
      var x = (gx + 0.5) / N * 2.4 - 1.2, y = 1.2 - (gy + 0.5) / N * 2.4;
      var p = net.predict(PG.features({ x: x, y: y }, o.extra));
      mg.globalAlpha = 0.12 + 0.5 * Math.abs(p - 0.5) * 2;
      mg.fillStyle = COLORS[p > 0.5 ? 1 : 0]; mg.fillRect(gx * cell, gy * cell, cell + 0.5, cell + 0.5);
    }
    mg.globalAlpha = 1;
    pts.forEach(function (q) {
      mg.beginPath(); mg.arc((q.x + 1.2) / 2.4 * map.width, (1.2 - q.y) / 2.4 * map.height, 4, 0, 6.2832);
      mg.fillStyle = COLORS[q.c]; mg.fill(); mg.strokeStyle = css('--bg'); mg.lineWidth = 1.5; mg.stroke();
    });
    mg.strokeStyle = css('--line'); mg.strokeRect(0.5, 0.5, map.width - 1, map.height - 1);

    // loss + accuracy curves
    var W = curve.width, H = curve.height, m = 30;
    cg.fillStyle = css('--bg'); cg.fillRect(0, 0, W, H);
    cg.strokeStyle = css('--line'); cg.strokeRect(m, 10, W - m - 10, H - m - 10);
    cg.font = '12px system-ui, sans-serif'; cg.fillStyle = css('--muted');
    cg.fillText('training steps →', W / 2 - 40, H - 8);
    cg.fillText('red = loss   green = accuracy', m + 6, 26);
    var maxN = Math.max(60, hist.length - 1);
    function line(fn, col) {
      cg.strokeStyle = col; cg.lineWidth = 2.5; cg.beginPath();
      hist.forEach(function (h, k) { var X = m + k / maxN * (W - m - 10), Y = fn(h); if (k === 0) cg.moveTo(X, Y); else cg.lineTo(X, Y); });
      cg.stroke();
    }
    line(function (h) { return 10 + (1 - Math.min(1, h.loss / 0.9)) * (H - m - 10); }, css('--bad'));   // high loss = near the top
    line(function (h) { return 10 + (1 - h.acc) * (H - m - 10); }, css('--good'));
    var last = hist[hist.length - 1] || PG.evaluate(net, pts, o.extra);
    $('#pg-stats').html('Steps <b>' + steps + '</b> &middot; loss <b>' + last.loss.toFixed(3) + '</b> &middot; accuracy <b>' + Math.round(last.acc * 100) + '%</b>');
    $('#pg-lr-val').text(o.lr < 0.1 ? o.lr.toFixed(3) : o.lr.toFixed(2));
  }

  $('#pg-play').on('click', function () { if (timer) { stop(); return; } timer = setInterval(tick, 60); $(this).text('Pause'); });
  $('#pg-reset').on('click', build);
  $('#pg-data, #pg-layers, #pg-width, #pg-act, #pg-extra, #pg-opt').on('change', build);
  $('#pg-lr, #pg-batch').on('input change', draw);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
  build();
});

$(function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  var COLORS = ['#2563eb', '#e11d48', '#16a34a', '#d97706', '#9333ea', '#0891b2'];
  var redraws = [];

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function rng(seed) {                       // small seeded random generator, so demos look the same each load
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    var u = 0; while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }
  function canvas(id) {
    var c = document.getElementById(id);
    return { c: c, g: c.getContext('2d'), w: c.width, h: c.height };
  }
  function mousePos(c, e) {
    var r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  }
  function clear(cv) { cv.g.fillStyle = css('--bg'); cv.g.fillRect(0, 0, cv.w, cv.h); }
  function circle(g, x, y, r, fill, stroke) {
    g.beginPath(); g.arc(x, y, r, 0, 6.2832);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }
  function label(g, text, x, y, align) {
    g.fillStyle = css('--muted'); g.font = '12px system-ui, sans-serif'; g.textAlign = align || 'left'; g.fillText(text, x, y);
  }
  function fmt(n, d) { return Math.abs(n) >= 1e4 ? n.toExponential(1) : n.toFixed(d === undefined ? 3 : d); }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { redraws.forEach(function (f) { f(); }); });

  // ================================================================== 1. Gradient descent
  (function () {
    var fit = canvas('gd-fit'), lossC = canvas('gd-loss');
    var r = rng(7), pts = [], n = 30, i;
    for (i = 0; i < n; i++) { var x = r(); pts.push({ x: x, y: 3 * x + 1 + gauss(r) * 0.25 }); }
    var w, b, step, hist, timer, diverged;

    function lossOf(w_, b_) {
      var s = 0; pts.forEach(function (p) { var e = w_ * p.x + b_ - p.y; s += e * e; }); return s / n;
    }
    function stop() { clearInterval(timer); timer = null; $('#gd-play').text('Play'); }
    function reset() { w = -1.5; b = 3.5; step = 0; hist = [lossOf(w, b)]; diverged = false; stop(); draw(); }

    function once() {
      var lr = +$('#gd-lr').val(), dw = 0, db = 0;
      pts.forEach(function (p) { var e = w * p.x + b - p.y; dw += e * p.x; db += e; });
      w -= lr * 2 * dw / n; b -= lr * 2 * db / n; step++;
      var l = lossOf(w, b); hist.push(l);
      if (!isFinite(l) || l > 1e3) { diverged = true; stop(); }
      if (step >= 300) stop();
      draw();
    }

    function draw() {
      var g = fit.g, W = fit.w, H = fit.h, m = 28;
      function px(x) { return m + x * (W - m - 10); }
      function py(y) { return H - m - (y + 1) / 7 * (H - m - 10); }
      clear(fit);
      g.strokeStyle = css('--line'); g.lineWidth = 1; g.strokeRect(m, 10, W - m - 10, H - m - 10);
      label(g, 'feature x', W / 2, H - 8, 'center'); label(g, 'y', 8, 20);
      pts.forEach(function (p) { circle(g, px(p.x), py(p.y), 3.5, css('--muted')); });
      g.save(); g.beginPath(); g.rect(m, 10, W - m - 10, H - m - 10); g.clip();
      g.strokeStyle = diverged ? css('--bad') : css('--accent'); g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(px(0), py(b)); g.lineTo(px(1), py(w + b)); g.stroke();
      g.restore();

      // loss curve (log scale)
      g = lossC.g; W = lossC.w; H = lossC.h; clear(lossC);
      g.strokeStyle = css('--line'); g.strokeRect(m, 10, W - m - 10, H - m - 10);
      function ly(l) { var v = Math.log10(Math.min(100, Math.max(0.01, l))); return 10 + (2 - v) / 4 * (H - m - 20); }
      var maxX = Math.max(60, hist.length - 1);
      g.strokeStyle = css('--line');
      [1, 0.1].forEach(function (v) { g.beginPath(); g.moveTo(m, ly(v)); g.lineTo(W - 10, ly(v)); g.stroke(); label(g, String(v), 4, ly(v) + 4); });
      g.strokeStyle = diverged ? css('--bad') : css('--good'); g.lineWidth = 2; g.beginPath();
      hist.forEach(function (l, k) {
        var X = m + k / maxX * (W - m - 10), Y = ly(l);
        if (k === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      });
      g.stroke();
      label(g, 'training steps', W / 2, H - 8, 'center'); label(g, 'loss (log)', 4, 20);

      var cur = hist[hist.length - 1];
      $('#gd-lr-val').text(((+$('#gd-lr').val())).toFixed(2));
      $('#gd-stats').html('Step <b>' + step + '</b> &middot; w = <b>' + fmt(w, 2) + '</b> &middot; b = <b>' + fmt(b, 2) + '</b> &middot; loss = <b>' + fmt(cur) + '</b>' +
        (diverged ? ' &middot; <span class="verdict bad">Diverged: learning rate too high</span>' :
         cur < 0.08 ? ' &middot; <span class="verdict ok">Converged (true line is y = 3x + 1)</span>' : ''));
    }

    $('#gd-play').on('click', function () {
      if (timer) { stop(); return; }
      if (diverged || step >= 300) reset();
      timer = setInterval(once, 70); $(this).text('Pause');
    });
    $('#gd-step').on('click', function () { stop(); if (!diverged) once(); });
    $('#gd-reset').on('click', reset);
    $('#gd-lr').on('input', function () { $('#gd-lr-val').text((+this.value).toFixed(2)); });
    redraws.push(draw); reset();
  })();

  // ================================================================== 2. k-means
  (function () {
    var cv = canvas('km'), pts = [], cents = [], asg = [], phase, iter, converged, timer;

    function newData() {
      var r = rng(Math.floor(Math.random() * 1e9)), blobs = 4, k, j;
      pts = [];
      for (k = 0; k < blobs; k++) {
        var cx = 80 + r() * (cv.w - 160), cy = 60 + r() * (cv.h - 120);
        for (j = 0; j < 45; j++) pts.push({ x: cx + gauss(r) * 28, y: cy + gauss(r) * 28 });
      }
    }
    function initCentroids() {
      stop();
      var k = +$('#km-k').val(), pool = pts.slice(), j;
      cents = [];
      for (j = 0; j < k; j++) { var idx = Math.floor(Math.random() * pool.length); cents.push({ x: pool[idx].x, y: pool[idx].y }); pool.splice(idx, 1); }
      asg = []; phase = 'assign'; iter = 0; converged = false;
      status('Centroids placed at random. Press Step: first every point joins its nearest centroid.');
      draw();
    }
    function stop() { clearInterval(timer); timer = null; $('#km-play').text('Play'); }
    function status(t) { $('#km-status').text(t); }

    function inertia() {
      var s = 0;
      pts.forEach(function (p, i) { if (asg[i] !== undefined) { var c = cents[asg[i]]; s += (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y); } });
      return Math.round(s);
    }

    function once() {
      if (converged) { stop(); return; }
      if (phase === 'assign') {
        var changed = false;
        pts.forEach(function (p, i) {
          var best = 0, bd = Infinity;
          cents.forEach(function (c, j) { var d = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y); if (d < bd) { bd = d; best = j; } });
          if (asg[i] !== best) changed = true;
          asg[i] = best;
        });
        if (!changed && iter > 0) { converged = true; stop(); status('Converged after ' + iter + ' rounds: no point changed cluster, so the centroids will not move again.'); }
        else { phase = 'update'; status('Round ' + (iter + 1) + ' - assign: each point joins its nearest centroid.'); }
      } else {
        cents.forEach(function (c, j) {
          var sx = 0, sy = 0, cnt = 0;
          pts.forEach(function (p, i) { if (asg[i] === j) { sx += p.x; sy += p.y; cnt++; } });
          if (cnt) { c.x = sx / cnt; c.y = sy / cnt; }
        });
        phase = 'assign'; iter++;
        status('Round ' + iter + ' - update: each centroid moves to the average of its points.');
      }
      draw();
    }

    function draw() {
      var g = cv.g; clear(cv);
      g.strokeStyle = css('--line'); g.strokeRect(0.5, 0.5, cv.w - 1, cv.h - 1);
      pts.forEach(function (p, i) { circle(g, p.x, p.y, 4, asg[i] === undefined ? css('--muted') : COLORS[asg[i] % COLORS.length]); });
      cents.forEach(function (c, j) {
        var col = COLORS[j % COLORS.length];
        circle(g, c.x, c.y, 10, col, css('--fg'));
        g.strokeStyle = css('--bg'); g.lineWidth = 2; g.beginPath(); g.moveTo(c.x - 5, c.y - 5); g.lineTo(c.x + 5, c.y + 5); g.moveTo(c.x + 5, c.y - 5); g.lineTo(c.x - 5, c.y + 5); g.stroke();
      });
      $('#km-inertia').text(asg.length ? inertia() : '-');
      $('#km-iter').text(iter);
    }

    $('#km-step').on('click', function () { stop(); once(); });
    $('#km-play').on('click', function () { if (timer) { stop(); return; } if (converged) initCentroids(); timer = setInterval(once, 600); $(this).text('Pause'); });
    $('#km-reset').on('click', initCentroids);
    $('#km-new').on('click', function () { newData(); initCentroids(); });
    $('#km-k').on('change', initCentroids);
    redraws.push(draw); newData(); initCentroids();
  })();

  // ================================================================== 3. k-nearest neighbours
  (function () {
    var cv = canvas('knn'), pts, CELL = 8;

    function initial() {
      var r = rng(11), i; pts = [];
      for (i = 0; i < 35; i++) pts.push({ x: 210 + gauss(r) * 55, y: 160 + gauss(r) * 55, c: 0 });
      for (i = 0; i < 35; i++) pts.push({ x: 390 + gauss(r) * 55, y: 150 + gauss(r) * 55, c: 1 });
      draw();
    }
    function predict(x, y, k) {
      var d = pts.map(function (p) { return { d: (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y), c: p.c }; });
      d.sort(function (a, b) { return a.d - b.d; });
      var votes = [0, 0], i; for (i = 0; i < Math.min(k, d.length); i++) votes[d[i].c]++;
      return votes[1] > votes[0] ? 1 : 0;
    }
    function draw() {
      var g = cv.g, k = +$('#knn-k').val(), x, y;
      $('#knn-k-val').text(k);
      clear(cv);
      g.globalAlpha = 0.2;
      for (x = 0; x < cv.w; x += CELL) for (y = 0; y < cv.h; y += CELL) {
        g.fillStyle = COLORS[predict(x + CELL / 2, y + CELL / 2, k)]; g.fillRect(x, y, CELL, CELL);
      }
      g.globalAlpha = 1;
      pts.forEach(function (p) { circle(g, p.x, p.y, 4.5, COLORS[p.c], css('--bg')); });
      g.strokeStyle = css('--line'); g.strokeRect(0.5, 0.5, cv.w - 1, cv.h - 1);
      $('#knn-note').text(k <= 2 ? 'Very small k: the boundary chases every single point, including noise (overfitting).' :
        k >= 19 ? 'Very large k: the boundary is a smooth blur that ignores local structure (underfitting).' :
        'Moderate k: smooth enough to ignore noise, flexible enough to follow the data.');
    }
    $('#knn').on('click', function (e) {
      var p = mousePos(this, e), c = +$('input[name=knn-class]:checked').val();
      pts.push({ x: p.x, y: p.y, c: c }); draw();
    });
    $('#knn-k').on('input', draw);
    $('#knn-clear').on('click', initial);
    redraws.push(draw); initial();
  })();

  // ================================================================== 4. Overfitting
  (function () {
    var cv = canvas('of-fit'), ec = canvas('of-err'), N_TRAIN = 12, MAXDEG = 11;
    var r = rng(21), train = [], test = [], i;
    function truth(x) { return Math.sin(2 * Math.PI * x); }
    for (i = 0; i < N_TRAIN; i++) { var xt = r(); train.push({ x: xt, y: truth(xt) + gauss(r) * 0.25 }); }
    for (i = 0; i < 60; i++) { var xs = r(); test.push({ x: xs, y: truth(xs) + gauss(r) * 0.25 }); }

    function solve(A, b) {                      // Gaussian elimination with partial pivoting
      var n = b.length, i, j, k;
      for (i = 0; i < n; i++) {
        var p = i; for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
        var t = A[i]; A[i] = A[p]; A[p] = t; var tb = b[i]; b[i] = b[p]; b[p] = tb;
        for (j = i + 1; j < n; j++) { var f = A[j][i] / A[i][i]; for (k = i; k < n; k++) A[j][k] -= f * A[i][k]; b[j] -= f * b[i]; }
      }
      var x = new Array(n);
      for (i = n - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
      return x;
    }
    function fit(deg, lambda) {
      var n = deg + 1, A = [], b = [], i, j;
      for (i = 0; i < n; i++) { A.push(new Array(n).fill(0)); b.push(0); }
      train.forEach(function (p) {
        var t = 2 * p.x - 1, pw = [1], q;
        for (q = 1; q <= 2 * deg; q++) pw[q] = pw[q - 1] * t;
        for (i = 0; i < n; i++) { b[i] += pw[i] * p.y; for (j = 0; j < n; j++) A[i][j] += pw[i + j]; }
      });
      for (i = 1; i < n; i++) A[i][i] += lambda;     // ridge penalty (not on the intercept)
      return solve(A, b);
    }
    function evalPoly(c, x) { var t = 2 * x - 1, s = 0, i; for (i = c.length - 1; i >= 0; i--) s = s * t + c[i]; return s; }
    function mse(c, set) { var s = 0; set.forEach(function (p) { var e = evalPoly(c, p.x) - p.y; s += e * e; }); return s / set.length; }

    function draw() {
      var deg = +$('#of-deg').val(), lambda = +$('#of-reg').val(), g = cv.g, W = cv.w, H = cv.h, m = 28;
      $('#of-deg-val').text(deg);
      function px(x) { return m + x * (W - m - 10); }
      function py(y) { return H - m - (y + 2) / 4 * (H - m - 10); }
      clear(cv);
      g.strokeStyle = css('--line'); g.strokeRect(m, 10, W - m - 10, H - m - 10);
      g.save(); g.beginPath(); g.rect(m, 10, W - m - 10, H - m - 10); g.clip();
      g.setLineDash([5, 5]); g.strokeStyle = css('--muted'); g.lineWidth = 1.5; g.beginPath();
      for (i = 0; i <= 100; i++) { var x = i / 100; if (i === 0) g.moveTo(px(x), py(truth(x))); else g.lineTo(px(x), py(truth(x))); }
      g.stroke(); g.setLineDash([]);
      var c = fit(deg, lambda);
      g.strokeStyle = css('--accent'); g.lineWidth = 2.5; g.beginPath();
      for (i = 0; i <= 200; i++) { var xx = i / 200, yy = evalPoly(c, xx); if (i === 0) g.moveTo(px(xx), py(yy)); else g.lineTo(px(xx), py(yy)); }
      g.stroke();
      test.slice(0, 30).forEach(function (p) { circle(g, px(p.x), py(p.y), 3, null, css('--muted')); });
      train.forEach(function (p) { circle(g, px(p.x), py(p.y), 4.5, css('--fg')); });
      g.restore();
      label(g, 'dashed = true pattern   filled = training data   hollow = unseen test data', m, H - 8);

      var tr = mse(c, train), te = mse(c, test);
      var v = tr > 0.09 ? ['bad', 'Underfitting (high bias): too simple or too constrained to capture the pattern'] :
              te > 3 * tr + 0.03 ? ['bad', 'Overfitting (high variance): memorised the training points, fails on new data'] :
              ['ok', 'Good fit: low error on both training and unseen data'];
      $('#of-stats').html('Training error <b>' + fmt(tr) + '</b> &middot; Test error <b>' + fmt(te) + '</b> &middot; <span class="verdict ' + v[0] + '">' + v[1] + '</span>');

      // error vs complexity
      var eg = ec.g, EW = ec.w, EH = ec.h, d, trs = [], tes = [];
      clear(ec);
      for (d = 1; d <= MAXDEG; d++) { var cd = fit(d, lambda); trs.push(mse(cd, train)); tes.push(mse(cd, test)); }
      function ey(v_) { var l = Math.log10(Math.min(10, Math.max(0.001, v_))); return 10 + (1 - l) / 4 * (EH - m - 20); }
      function ex(d_) { return m + (d_ - 1) / (MAXDEG - 1) * (EW - m - 20); }
      eg.strokeStyle = css('--line'); eg.strokeRect(m, 10, EW - m - 10, EH - m - 10);
      function line(arr, col) { eg.strokeStyle = col; eg.lineWidth = 2.5; eg.beginPath(); arr.forEach(function (v_, k) { if (k === 0) eg.moveTo(ex(k + 1), ey(v_)); else eg.lineTo(ex(k + 1), ey(v_)); }); eg.stroke(); }
      line(trs, css('--good')); line(tes, css('--bad'));
      eg.strokeStyle = css('--accent'); eg.setLineDash([4, 4]); eg.beginPath(); eg.moveTo(ex(deg), 10); eg.lineTo(ex(deg), EH - m); eg.stroke(); eg.setLineDash([]);
      circle(eg, ex(deg), ey(trs[deg - 1]), 4.5, css('--good')); circle(eg, ex(deg), ey(tes[deg - 1]), 4.5, css('--bad'));
      label(eg, 'model complexity (polynomial degree) →', EW / 2, EH - 8, 'center');
      label(eg, 'green = training error, red = test error (log scale)', m + 4, 24);
    }
    $('#of-deg, #of-reg').on('input change', draw);
    redraws.push(draw); draw();
  })();
});

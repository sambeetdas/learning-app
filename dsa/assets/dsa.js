// Shared toolkit for the DSA pages: a step-by-step player and drawing helpers.
// An algorithm is run once in advance and records "frames" (snapshots of its state plus a message).
// The player then lets the reader move through the frames with Back / Play / Next.
var DSA = (function ($) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- small utilities
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, 'text-anchor': anchor || 'middle', 'dominant-baseline': 'central', 'class': cls || '' }, parent);
    t.textContent = s;
    return t;
  }
  function mk(m) { return m ? ' ' + String(m).split(' ').filter(Boolean).map(function (c) { return 'm-' + c; }).join(' ') : ''; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function randArray(n, max, seed) {
    var r = rng(seed || Math.floor(Math.random() * 1e9)), a = [];
    for (var i = 0; i < n; i++) a.push(1 + Math.floor(r() * max));
    return a;
  }
  function parseNums(s, limit) {
    var a = String(s).split(/[\s,]+/).filter(Boolean).map(Number).filter(function (x) { return isFinite(x); });
    return limit ? a.slice(0, limit) : a;
  }
  function svg(w, h) { return el('svg', { 'class': 'viz', viewBox: '0 0 ' + w + ' ' + h, width: w, height: h }); }

  function arrow(g, x1, y1, x2, y2, cls, shorten) {          // straight edge with an arrowhead at (x2, y2)
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
    var s1 = shorten ? shorten[0] : 0, s2 = shorten ? shorten[1] : 0;
    var ax = x2 - ux * s2, ay = y2 - uy * s2;
    el('line', { x1: x1 + ux * s1, y1: y1 + uy * s1, x2: ax - ux * 6, y2: ay - uy * 6, 'class': 'ed' + mk(cls) }, g);
    el('polygon', { points: ax + ',' + ay + ' ' + (ax - ux * 10 - uy * 5) + ',' + (ay - uy * 10 + ux * 5) + ' ' + (ax - ux * 10 + uy * 5) + ',' + (ay - uy * 10 - ux * 5), 'class': 'ah' + mk(cls) }, g);
  }

  // ---------------------------------------------------------------- the step player
  // root: the .demo element (must contain a .stage). render(frame, ctx) draws one frame into ctx.stage.
  // opts.code: array of code lines; frames may set .line (index, or array of indexes) to highlight.
  function player(root, frames, render, opts) {
    opts = opts || {};
    var $root = $(root), $stage = $root.find('.stage').first(), i = 0, timer = null, speed = opts.speed || 800;
    var $cap = $('<div class="caption">'), $ctl = $('<div class="bar pctl">');
    var $reset = $('<button type="button">Reset</button>'), $prev = $('<button type="button">&larr; Back</button>');
    var $play = $('<button type="button" class="primary">Play</button>'), $next = $('<button type="button">Next &rarr;</button>');
    var $speed = $('<select aria-label="Speed"><option value="1500">Slow</option><option value="800" selected>Normal</option><option value="300">Fast</option><option value="80">Very fast</option></select>');
    var $count = $('<span class="count">');
    if (opts.speed) $speed.val(String(opts.speed));
    $ctl.append($reset, $prev, $play, $next, $('<label>Speed </label>').append($speed), $count);
    $stage.after($cap); $cap.after($ctl);
    var $code = null;
    function setCode(lines) {
      if (!lines) { if ($code) { $code.remove(); $code = null; } return; }
      if (!$code) { $code = $('<pre class="stepcode"><code></code></pre>'); $ctl.after($code); }
      $code.find('code').empty();
      lines.forEach(function (l) { $code.find('code').append($('<span class="cl">').text(l || ' ')); });
    }
    setCode(opts.code);

    function show() {
      if (!frames.length) return;
      var f = frames[i];
      $stage.empty();
      render(f, { stage: $stage, i: i, n: frames.length, root: $root });
      $cap.text(f.msg || '');
      if ($code) {
        var lines = f.line === undefined ? [] : [].concat(f.line);
        $code.find('.cl').each(function (k) { $(this).toggleClass('active', lines.indexOf(k) >= 0); });
      }
      $count.text('Step ' + (i + 1) + ' / ' + frames.length);
      $prev.prop('disabled', i === 0); $reset.prop('disabled', i === 0); $next.prop('disabled', i >= frames.length - 1);
    }
    function stop() { clearInterval(timer); timer = null; $play.text('Play'); }
    function start() {
      if (i >= frames.length - 1) i = 0;
      show(); $play.text('Pause');
      timer = setInterval(function () { if (i < frames.length - 1) { i++; show(); } else stop(); }, speed);
    }
    $play.on('click', function () { if (timer) stop(); else start(); });
    $next.on('click', function () { stop(); if (i < frames.length - 1) { i++; show(); } });
    $prev.on('click', function () { stop(); if (i > 0) { i--; show(); } });
    $reset.on('click', function () { stop(); i = 0; show(); });
    $speed.on('change', function () { speed = +this.value; if (timer) { stop(); start(); } });

    show();
    return {
      set: function (fr, code) { stop(); if (code !== undefined) setCode(code); frames = fr; i = 0; show(); },
      last: function () { stop(); i = frames.length - 1; show(); },
      frames: function () { return frames; }
    };
  }

  // ---------------------------------------------------------------- drawing helpers (all return the created element)
  // cells: a row of boxes. o.marks {index: 'a'|'b'|'c'|'ok'|'p'|'dim'}, o.ptrs {name: index}, o.label, o.noIndex
  function cells($stage, items, o) {
    o = o || {};
    var marks = o.marks || {}, ptrs = o.ptrs || {}, $wrap = $('<div>');
    if (o.label) $('<div class="rowlabel">').text(o.label).appendTo($wrap);
    var $row = $('<div class="cells">').appendTo($wrap);
    items.forEach(function (v, i) {
      var $c = $('<div class="cellw">');
      $('<div class="cell">').addClass(mk(marks[i]).trim()).text(v === null || v === undefined ? '' : v).appendTo($c);
      if (!o.noIndex) $('<div class="idx">').text(o.indexFrom !== undefined ? i + o.indexFrom : i).appendTo($c);
      var names = Object.keys(ptrs).filter(function (k) { return ptrs[k] === i; });
      $('<div class="ptr">').text(names.join(' ')).appendTo($c);
      $row.append($c);
    });
    $stage.append($wrap);
    return $wrap;
  }

  // bars: values as vertical bars. o.marks {index: mark}, o.max
  function bars($stage, arr, o) {
    o = o || {};
    var max = o.max || Math.max.apply(null, arr.concat([1])), marks = o.marks || {}, $b = $('<div class="bars">');
    arr.forEach(function (v, i) {
      var $it = $('<div class="bar-item">').addClass(mk(marks[i]).trim()).css('height', Math.max(2, v / max * 100) + '%');
      if (arr.length <= 32) $('<span>').text(v).appendTo($it);
      $b.append($it);
    });
    $stage.append($b);
    return $b;
  }

  // stack: items bottom -> top, drawn with the top at the top. o.marks {index: mark}, o.label
  function stack($stage, items, o) {
    o = o || {};
    var marks = o.marks || {}, $w = $('<div class="stackwrap">');
    $('<div class="lbl">').text(o.label || 'stack').appendTo($w);
    $('<div class="ptr">').text(items.length ? 'top ↓' : '').appendTo($w);
    var $s = $('<div class="stackv">').appendTo($w);
    for (var i = items.length - 1; i >= 0; i--) $('<div class="cell">').addClass(mk(marks[i]).trim()).text(items[i]).appendTo($s);
    if (!items.length) $('<div class="idx">').text('(empty)').appendTo($s);
    $stage.append($w);
    return $w;
  }

  // linked list. o.marks {index: mark}, o.ptrs {name: index}, o.doubly, o.cycleTo (index the last node points back to)
  function list($stage, vals, o) {
    o = o || {};
    var marks = o.marks || {}, ptrs = o.ptrs || {}, n = vals.length, W = 70, GAP = 38, X0 = 20, Y = 52, H = 34;
    var width = X0 + n * (W + GAP) + 60, height = o.cycleTo !== undefined && o.cycleTo >= 0 ? 130 : 100;
    var s = svg(Math.max(width, 200), height);
    vals.forEach(function (v, i) {
      var x = X0 + i * (W + GAP);
      el('rect', { x: x, y: Y, width: W, height: H, rx: 6, 'class': 'nd' + mk(marks[i]) }, s);
      el('line', { x1: x + W - 20, y1: Y, x2: x + W - 20, y2: Y + H, 'class': 'ed' }, s);
      if (o.doubly) el('line', { x1: x + 20, y1: Y, x2: x + 20, y2: Y + H, 'class': 'ed' }, s);
      text(s, o.doubly ? x + W / 2 : x + (W - 20) / 2, Y + H / 2, String(v));
      if (i < n - 1) {
        arrow(s, x + W - 10, Y + H / 2 - (o.doubly ? 6 : 0), x + W + GAP, Y + H / 2 - (o.doubly ? 6 : 0), o.edgeMarks && o.edgeMarks[i]);
        if (o.doubly) arrow(s, x + W + GAP + 10, Y + H / 2 + 6, x + W, Y + H / 2 + 6);
      }
      var names = Object.keys(ptrs).filter(function (k) { return ptrs[k] === i; });
      if (names.length) { text(s, x + W / 2, Y - 26, names.join(', '), 'ptr'); arrow(s, x + W / 2, Y - 18, x + W / 2, Y - 2, 'a'); }
    });
    var endX = X0 + n * (W + GAP);
    if (o.cycleTo !== undefined && o.cycleTo >= 0 && n) {
      var lx = X0 + (n - 1) * (W + GAP) + W / 2, tx = X0 + o.cycleTo * (W + GAP) + W / 2;
      el('path', { d: 'M' + lx + ',' + (Y + H) + ' C' + lx + ',' + (Y + H + 50) + ' ' + tx + ',' + (Y + H + 50) + ' ' + tx + ',' + (Y + H + 8), 'class': 'ed m-c' }, s);
      el('polygon', { points: tx + ',' + (Y + H + 2) + ' ' + (tx - 5) + ',' + (Y + H + 12) + ' ' + (tx + 5) + ',' + (Y + H + 12), 'class': 'ah m-c' }, s);
    } else if (n) {
      arrow(s, endX - GAP - 10 + 0, Y + H / 2, endX, Y + H / 2);
      text(s, endX + 18, Y + H / 2, 'null', 'small');
    } else {
      text(s, 60, Y + H / 2, (o.headName || 'head') + ' → null', 'small');
    }
    $stage.append(s);
    return s;
  }

  // binary tree. node = {v, l, r, id?}. o.marks {id: mark}, o.labels {id: text}, o.edgeMarks {childId: mark}
  function keyOf(n) { return n.id !== undefined ? n.id : n.v; }
  function tree($stage, root, o) {
    o = o || {};
    var pos = {}, count = 0, depth = 0, DX = o.dx || 46, DY = o.dy || 62, R = o.r || 18;
    (function walk(n, d) { if (!n) return; walk(n.l, d + 1); pos[keyOf(n)] = { x: count++, y: d }; depth = Math.max(depth, d); walk(n.r, d + 1); })(root, 0);
    var w = Math.max(120, 40 + Math.max(0, count - 1) * DX + 40), h = 40 + depth * DY + 46;
    var s = svg(w, h), ge = el('g', {}, s), gn = el('g', {}, s), marks = o.marks || {}, labels = o.labels || {}, em = o.edgeMarks || {};
    function P(n) { var p = pos[keyOf(n)]; return { x: 40 + p.x * DX, y: 30 + p.y * DY }; }
    if (!root) text(s, w / 2, 30, o.empty || '(empty tree)', 'small');
    (function draw(n) {
      if (!n) return;
      var p = P(n);
      [n.l, n.r].forEach(function (c) { if (c) { var q = P(c); el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, 'class': 'ed' + mk(em[keyOf(c)]) }, ge); draw(c); } });
      el('circle', { cx: p.x, cy: p.y, r: R, 'class': 'nd' + mk(marks[keyOf(n)]) }, gn);
      text(gn, p.x, p.y, String(n.v));
      if (labels[keyOf(n)] !== undefined) text(gn, p.x, p.y + R + 10, String(labels[keyOf(n)]), 'lab');
    })(root);
    $stage.append(s);
    return s;
  }

  // n-ary tree (or forest when roots is an array). node = {label, id, children: []}
  // o.marks {id: mark}, o.labels {id: text under the node}, o.edgeLabels {childId: text on the edge}, o.edgeMarks {childId: mark}
  function ntree($stage, roots, o) {
    o = o || {};
    roots = [].concat(roots).filter(Boolean);
    var DY = o.dy || 64, GAP = 10, pos = {}, cursor = 20, depth = 0, marks = o.marks || {}, labels = o.labels || {}, el2 = o.edgeLabels || {}, em = o.edgeMarks || {};
    function w(n) { return Math.max(30, String(n.label).length * 8 + 16); }
    function place(n, d) {
      depth = Math.max(depth, d);
      var kids = n.children || [];
      if (!kids.length) { pos[n.id] = { x: cursor + w(n) / 2, y: 26 + d * DY }; cursor += w(n) + GAP; return; }
      kids.forEach(function (c) { place(c, d + 1); });
      var first = pos[kids[0].id].x, last = pos[kids[kids.length - 1].id].x;
      pos[n.id] = { x: (first + last) / 2, y: 26 + d * DY };
      var right = pos[n.id].x + w(n) / 2 + GAP;          // keep wide parents from overlapping the next subtree
      if (right > cursor) cursor = right;
    }
    roots.forEach(function (r) { place(r, 0); cursor += 14; });
    var W = Math.max(120, cursor + 6), H = 26 + depth * DY + 40, s = svg(W, H), ge = el('g', {}, s), gn = el('g', {}, s);
    if (!roots.length) text(s, W / 2, 26, o.empty || '(empty)', 'small');
    (function draw(list) {
      list.forEach(function (n) {
        var p = pos[n.id];
        (n.children || []).forEach(function (c) {
          var q = pos[c.id];
          el('line', { x1: p.x, y1: p.y + 13, x2: q.x, y2: q.y - 13, 'class': 'ed' + mk(em[c.id]) }, ge);
          if (el2[c.id] !== undefined) text(ge, (p.x + q.x) / 2 + (q.x < p.x ? -8 : 8), (p.y + q.y) / 2, String(el2[c.id]), 'lab');
        });
        el('rect', { x: p.x - w(n) / 2, y: p.y - 13, width: w(n), height: 26, rx: 8, 'class': 'nd' + mk(marks[n.id]) }, gn);
        text(gn, p.x, p.y, String(n.label));
        if (labels[n.id] !== undefined) text(gn, p.x + w(n) / 2 + 3, p.y - 10, String(labels[n.id]), 'lab', 'start');   // top-right, clear of the edges below
        draw(n.children || []);
      });
    })(roots);
    $stage.append(s);
    return s;
  }

  // graph. g = {nodes: [{id, x, y, label?}], edges: [{a, b, w?}], directed?}
  // o.nodeMarks {id: mark}, o.edgeMarks {'a-b': mark}, o.labels {id: text shown under the node}
  function graph($stage, g, o) {
    o = o || {};
    var R = 19, xs = g.nodes.map(function (n) { return n.x; }), ys = g.nodes.map(function (n) { return n.y; });
    var minX = Math.min.apply(null, xs) - 40, minY = Math.min.apply(null, ys) - 34, w = Math.max.apply(null, xs) - minX + 40, h = Math.max.apply(null, ys) - minY + 46;
    var s = svg(w, h), ge = el('g', { transform: 'translate(' + (-minX) + ',' + (-minY) + ')' }, s), gn = el('g', { transform: 'translate(' + (-minX) + ',' + (-minY) + ')' }, s);
    var byId = {}; g.nodes.forEach(function (n) { byId[n.id] = n; });
    var nm = o.nodeMarks || {}, em = o.edgeMarks || {}, lb = o.labels || {};
    g.edges.forEach(function (e) {
      var A = byId[e.a], B = byId[e.b], m = em[e.a + '-' + e.b] || (g.directed ? undefined : em[e.b + '-' + e.a]);
      if (g.directed) arrow(ge, A.x, A.y, B.x, B.y, m, [R, R]);
      else el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, 'class': 'ed' + mk(m) }, ge);
      if (e.w !== undefined) {
        var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dy = B.y - A.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        text(ge, mx - dy / L * 11, my + dx / L * 11, String(e.w), 'small');
      }
    });
    g.nodes.forEach(function (n) {
      el('circle', { cx: n.x, cy: n.y, r: R, 'class': 'nd' + mk(nm[n.id]) }, gn);
      text(gn, n.x, n.y, n.label !== undefined ? n.label : String(n.id));
      if (lb[n.id] !== undefined) text(gn, n.x, n.y + R + 11, String(lb[n.id]), 'lab');
    });
    $stage.append(s);
    return s;
  }

  // grid: a table. o.rowHead, o.colHead (arrays), o.marks {'r,c': mark}, o.corner
  function grid($stage, rows, o) {
    o = o || {};
    var marks = o.marks || {}, $t = $('<table class="grid">');
    if (o.colHead) { var $h = $('<tr>').appendTo($t); if (o.rowHead) $('<th>').text(o.corner || '').appendTo($h); o.colHead.forEach(function (c) { $('<th>').text(c).appendTo($h); }); }
    rows.forEach(function (row, r) {
      var $tr = $('<tr>').appendTo($t);
      if (o.rowHead) $('<th>').text(o.rowHead[r]).appendTo($tr);
      row.forEach(function (v, c) { $('<td>').addClass(mk(marks[r + ',' + c]).trim()).text(v === null || v === undefined ? '' : v).appendTo($tr); });
    });
    var $w = $('<div class="table-wrap">').append($t);
    $stage.append($w);
    return $w;
  }

  // legend: [['a', 'comparing'], ['ok', 'sorted']]
  function legend(items) {
    var $l = $('<div class="legend">');
    items.forEach(function (it) { $('<span>').append($('<span class="sw">').addClass(mk(it[0]).trim()), document.createTextNode(it[1])).appendTo($l); });
    return $l;
  }

  return { el: el, text: text, svg: svg, arrow: arrow, mk: mk, clone: clone, rng: rng, randArray: randArray, parseNums: parseNums,
           player: player, cells: cells, bars: bars, stack: stack, list: list, tree: tree, ntree: ntree, graph: graph, grid: grid, legend: legend };
})(jQuery);

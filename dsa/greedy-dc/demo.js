$(function () {
  'use strict';

  // ================================================================== interval scheduling
  (function () {
    var CODE = ['sort intervals by END time', 'last_end = -inf; chosen = []', 'for (s, e) in intervals:', '    if s >= last_end:              # compatible with everything chosen so far', '        chosen.append((s, e)); last_end = e', '    # else: overlaps the last chosen one, skip it'];
    function frames(iv) {
      var F = [], sorted = iv.map(function (x, i) { return { s: x[0], e: x[1], id: i }; }).sort(function (a, b) { return a.e - b.e || a.s - b.s; });
      var state = {}, lastEnd = -Infinity, chosen = 0;
      function snap(line, msg, cur) { F.push({ list: sorted, state: $.extend({}, state), cur: cur, lastEnd: lastEnd, line: line, msg: msg }); }
      snap(0, 'Choose as many non-overlapping activities as possible. Greedy rule: always pick the one that finishes first; it leaves the most room for the rest. Intervals are listed by end time.');
      sorted.forEach(function (x, i) {
        if (x.s >= lastEnd) { state[i] = 'ok'; lastEnd = x.e; chosen++; snap([3, 4], '[' + x.s + ', ' + x.e + ') starts after the last chosen end: take it. Chosen: ' + chosen + '.', i); }
        else { state[i] = 'c'; snap(5, '[' + x.s + ', ' + x.e + ') overlaps the last chosen activity (ends at ' + lastEnd + '): skip it.', i); }
      });
      snap([], chosen + ' activities. Why greedy is optimal (exchange argument): any optimal schedule can swap its first activity for the earliest-finishing one without losing anything; repeat for the rest. O(n log n) for the sort.');
      return F;
    }
    function render(f, ctx) {
      var lo = Math.min.apply(null, f.list.map(function (x) { return x.s; })), hi = Math.max.apply(null, f.list.map(function (x) { return x.e; })), span = hi - lo || 1;
      var $w = $('<div>').css({ position: 'relative', padding: '0 0 .5rem' });
      f.list.forEach(function (x, i) {
        var st = f.state[i], $row = $('<div>').css({ position: 'relative', height: '26px', margin: '3px 0' });
        $('<div class="cell">').addClass(st ? DSA.mk(st).trim() : (i === f.cur ? 'm-a' : '')).css({ position: 'absolute', left: ((x.s - lo) / span * 88) + '%', width: Math.max(2, (x.e - x.s) / span * 88) + '%', height: '24px', lineHeight: '20px', fontSize: '.75rem', textAlign: 'center', minWidth: 0, padding: 0 })
          .text(x.s + '–' + x.e).appendTo($row);
        if (i === f.cur) $row.find('.cell').css('outline', '2px solid var(--accent)');
        $w.append($row);
      });
      if (isFinite(f.lastEnd)) $('<div>').css({ position: 'absolute', top: 0, bottom: 0, left: ((f.lastEnd - lo) / span * 88) + '%', borderLeft: '2px dashed var(--good)' }).appendTo($w);
      ctx.stage.append($w);
      $('<div class="readout">').html('Dashed line = end of the last chosen activity' + (isFinite(f.lastEnd) ? ' (' + f.lastEnd + ')' : '') + ' &middot; chosen: <b>' + Object.keys(f.state).filter(function (k) { return f.state[k] === 'ok'; }).length + '</b>').appendTo(ctx.stage);
    }
    function parse() { return $('#iv-list').val().split(/[;|]/).map(function (p) { var x = DSA.parseNums(p); return x.length >= 2 && x[1] > x[0] ? [x[0], x[1]] : null; }).filter(Boolean).slice(0, 16); }
    var p = DSA.player('#iv-demo', frames(parse()), render, { code: CODE });
    $('#iv-run').on('click', function () { var iv = parse(); if (iv.length) p.set(frames(iv)); });
  })();

  // ================================================================== Huffman coding
  (function () {
    var CODE = ['heap = [Leaf(ch, freq) for each character]', 'while len(heap) > 1:', '    a = pop_min(heap); b = pop_min(heap)     # the two rarest', '    push(heap, Node(a.freq + b.freq, a, b))   # merge them', 'codes: left edge = 0, right edge = 1, read from root to leaf'];
    function frames(text) {
      text = text.slice(0, 40);
      var freq = {}, F = [], id = 0;
      text.split('').forEach(function (c) { freq[c] = (freq[c] || 0) + 1; });
      var forest = Object.keys(freq).map(function (c) { return { v: (c === ' ' ? '␣' : c) + ':' + freq[c], f: freq[c], ch: c, id: 'h' + (id++), l: null, r: null }; });
      function sortF() { forest.sort(function (a, b) { return a.f - b.f || (a.id < b.id ? -1 : 1); }); }
      function snap(line, msg, hl, labels) { F.push({ forest: DSA.clone(forest), hl: hl || {}, labels: labels || {}, line: line, msg: msg }); }
      sortF();
      snap(0, 'Count each character of "' + text + '". Every character starts as its own one-node tree, weighted by frequency (kept in a min-heap).');
      if (forest.length === 1) { var only = forest[0]; var lb = {}; lb[only.id] = '0'; snap(4, 'Only one distinct character: give it the code "0".', {}, lb); return F; }
      while (forest.length > 1) {
        sortF();
        var a = forest[0], b = forest[1], hl = {}; hl[a.id] = 'b'; hl[b.id] = 'b';
        snap(2, 'Take the two lightest trees: ' + a.v + ' (' + a.f + ') and ' + b.v + ' (' + b.f + ').', hl);
        var nn = { v: String(a.f + b.f), f: a.f + b.f, id: 'h' + (id++), l: a, r: b };
        forest.splice(0, 2); forest.push(nn); sortF();
        var h2 = {}; h2[nn.id] = 'ok';
        snap(3, 'Merge them under a new node of weight ' + nn.f + '. ' + forest.length + ' tree(s) left.', h2);
      }
      var root = forest[0], codes = {}, labels = {};
      (function walk(n, code) { if (!n.l && !n.r) { codes[n.ch] = code || '0'; labels[n.id] = codes[n.ch]; return; } walk(n.l, code + '0'); walk(n.r, code + '1'); })(root, '');
      var bits = text.split('').reduce(function (s, c) { return s + codes[c].length; }, 0), fixed = text.length * Math.max(1, Math.ceil(Math.log2(Object.keys(freq).length)));
      snap(4, 'Codes (under each leaf): ' + Object.keys(codes).map(function (c) { return (c === ' ' ? '␣' : c) + '=' + codes[c]; }).join(', ') + '. Frequent characters get short codes; no code is a prefix of another. Encoded size ' + bits + ' bits vs ' + fixed + ' bits with fixed-length codes (and ' + text.length * 8 + ' in 8-bit ASCII).', {}, labels);
      return F;
    }
    function render(f, ctx) {
      var $row = $('<div>').css({ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-start' }).appendTo(ctx.stage);
      f.forest.forEach(function (t) { DSA.tree($row, t, { marks: f.hl, labels: f.labels, dx: 50, r: 21 }); });
    }
    var p = DSA.player('#hf-demo', frames('abracadabra'), render, { code: CODE });
    $('#hf-run').on('click', function () { var t = $('#hf-text').val(); if (t) p.set(frames(t)); });
  })();
});

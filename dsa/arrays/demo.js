$(function () {
  'use strict';

  // ================================================================== dynamic array growth
  (function () {
    var CODE = ['def append(x):', '    if size == capacity:', '        new = allocate(2 * capacity)   # grow', '        copy all items into new         # O(n), but rare', '        data = new', '    data[size] = x', '    size += 1'];
    function frames(n) {
      var F = [], cap = 1, data = [null], size = 0, cost = 0, v;
      F.push({ data: data.slice(), size: 0, cost: 0, line: [], msg: 'Start with capacity 1. We will append ' + n + ' values and count every element write (the real cost).' });
      for (v = 1; v <= n; v++) {
        var val = v * 10;
        if (size === cap) {
          var nd = []; for (var k = 0; k < cap * 2; k++) nd.push(null);
          F.push({ data: data.slice(), size: size, nd: nd.slice(), cost: cost, line: [1, 2], msg: 'Append ' + val + ': the array is full (' + size + '/' + cap + '). Allocate a new block of capacity ' + cap * 2 + '.' });
          for (k = 0; k < size; k++) {
            nd[k] = data[k]; cost++;
            F.push({ data: data.slice(), size: size, nd: nd.slice(), copyAt: k, cost: cost, line: 3, msg: 'Copy item ' + k + ' (' + data[k] + ') into the new block. Cost so far: ' + cost + '.' });
          }
          cap *= 2; data = nd;
          F.push({ data: data.slice(), size: size, cost: cost, line: 4, msg: 'Switch to the new block (capacity ' + cap + ') and free the old one.' });
        }
        data[size] = val; size++; cost++;
        F.push({ data: data.slice(), size: size, cost: cost, newAt: size - 1, line: [5, 6], msg: 'Write ' + val + ' at index ' + (size - 1) + '. Size ' + size + ', capacity ' + cap + '. Total cost ' + cost + ' for ' + size + ' appends = ' + (cost / size).toFixed(2) + ' per append.' });
      }
      F.push({ data: data.slice(), size: size, cost: cost, line: [], msg: 'Done: ' + n + ' appends cost ' + cost + ' writes in total, about ' + (cost / n).toFixed(2) + ' each. Copying happens rarely enough that the average stays below 3: amortised O(1) per append.' });
      return F;
    }
    function render(f, ctx) {
      var items = f.data.map(function (x) { return x === null ? '' : x; }), marks = {};
      f.data.forEach(function (x, i) { marks[i] = i >= f.size ? 'dim' : (i === f.newAt ? 'ok' : (i === f.copyAt ? 'b' : '')); });
      DSA.cells(ctx.stage, items, { marks: marks, label: (f.nd ? 'old block' : 'array') + ' (capacity ' + f.data.length + ', size ' + f.size + ')' });
      if (f.nd) {
        var m2 = {}; f.nd.forEach(function (x, i) { m2[i] = x === null ? 'dim' : (i === f.copyAt ? 'a' : 'ok'); });
        DSA.cells(ctx.stage, f.nd.map(function (x) { return x === null ? '' : x; }), { marks: m2, label: 'new block (capacity ' + f.nd.length + ')' });
      }
      $('<div class="readout">').html('Total writes: <b>' + f.cost + '</b>' + (f.size ? ' &middot; per append: <b>' + (f.cost / f.size).toFixed(2) + '</b>' : '')).appendTo(ctx.stage);
    }
    var p = DSA.player('#dyn-demo', frames(9), render, { code: CODE, speed: 800 });
    $('#dyn-n').on('change', function () { p.set(frames(+this.value)); });
  })();

  // ================================================================== two pointers
  (function () {
    var CODES = {
      pair: ['lo, hi = 0, len(a) - 1', 'while lo < hi:', '    s = a[lo] + a[hi]', '    if s == target: return (lo, hi)', '    elif s < target: lo += 1     # need bigger', '    else: hi -= 1                # need smaller', 'return None'],
      flag: ['low, mid, high = 0, 0, len(a) - 1', 'while mid <= high:', '    if a[mid] == 0:', '        swap(a[low], a[mid]); low += 1; mid += 1', '    elif a[mid] == 1:', '        mid += 1', '    else:', '        swap(a[mid], a[high]); high -= 1']
    };
    function pairFrames(a, t) {
      var F = [], lo = 0, hi = a.length - 1, m;
      a = a.slice().sort(function (x, y) { return x - y; });
      F.push({ a: a, ptrs: { lo: lo, hi: hi }, marks: {}, line: 0, msg: 'The array is sorted. Put one pointer at each end. Target = ' + t + '.' });
      while (lo < hi) {
        var s = a[lo] + a[hi]; m = {}; m[lo] = 'a'; m[hi] = 'a';
        F.push({ a: a, ptrs: { lo: lo, hi: hi }, marks: m, line: 2, msg: 'a[' + lo + '] + a[' + hi + '] = ' + a[lo] + ' + ' + a[hi] + ' = ' + s + '.' });
        if (s === t) { m = {}; m[lo] = 'ok'; m[hi] = 'ok'; F.push({ a: a, ptrs: { lo: lo, hi: hi }, marks: m, line: 3, msg: 'Found it: ' + a[lo] + ' + ' + a[hi] + ' = ' + t + '. Only ' + (F.length - 1) + ' steps instead of checking every pair.' }); return F; }
        if (s < t) { F.push({ a: a, ptrs: { lo: lo, hi: hi }, marks: m, line: 4, msg: s + ' < ' + t + ': the sum is too small. Moving hi left would only make it smaller, so move lo right.' }); lo++; }
        else { F.push({ a: a, ptrs: { lo: lo, hi: hi }, marks: m, line: 5, msg: s + ' > ' + t + ': too big. Move hi left to get a smaller number.' }); hi--; }
      }
      F.push({ a: a, ptrs: {}, marks: {}, line: 6, msg: 'The pointers met: no pair sums to ' + t + '.' });
      return F;
    }
    function flagFrames(a) {
      var F = [], low = 0, mid = 0, high = a.length - 1, m, t;
      a = a.map(function (x) { return Math.max(0, Math.min(2, x)); });
      function snap(line, msg, hl) {
        var mk = {}; for (var i = 0; i < a.length; i++) mk[i] = i < low ? 'p' : (i > high ? 'c' : (i < mid ? 'ok' : '')); if (hl !== undefined) [].concat(hl).forEach(function (i) { mk[i] = 'b'; });
        F.push({ a: a.slice(), ptrs: { low: low, mid: mid, high: high }, marks: mk, line: line, msg: msg });
      }
      snap(0, 'Dutch national flag: sort 0s, 1s and 2s in one pass. Everything left of low is 0, between low and mid is 1, right of high is 2.');
      while (mid <= high) {
        if (a[mid] === 0) { snap(2, 'a[mid] = 0: swap it to the 0-zone at low.', [low, mid]); t = a[low]; a[low] = a[mid]; a[mid] = t; low++; mid++; snap(3, 'Swapped; low and mid both move right.'); }
        else if (a[mid] === 1) { snap(4, 'a[mid] = 1: already in the right zone; just move mid.', mid); mid++; }
        else { snap(6, 'a[mid] = 2: swap it to the 2-zone at high. Do not move mid: the swapped-in value is unchecked.', [mid, high]); t = a[high]; a[high] = a[mid]; a[mid] = t; high--; snap(7, 'Swapped; high moves left.'); }
      }
      snap(1, 'mid passed high: sorted in a single pass, O(n) time, O(1) space.');
      return F;
    }
    function render(f, ctx) { DSA.cells(ctx.stage, f.a, { marks: f.marks, ptrs: f.ptrs }); }
    var p = DSA.player('#tp-demo', [], render, { code: CODES.pair });
    function build() {
      var kind = $('#tp-kind').val();
      $('#tp-target-wrap').toggle(kind === 'pair');
      if (kind === 'pair') p.set(pairFrames(DSA.parseNums($('#tp-arr').val(), 14), +$('#tp-target').val()), CODES.pair);
      else p.set(flagFrames(DSA.parseNums($('#tp-flag').val(), 14)), CODES.flag);
      $('#tp-arr').toggle(kind === 'pair'); $('#tp-flag').toggle(kind !== 'pair');
    }
    $('#tp-kind').on('change', build); $('#tp-run').on('click', build);
    build();
  })();

  // ================================================================== sliding window
  (function () {
    var CODE = ['seen = {}; left = 0; best = 0', 'for right, ch in enumerate(s):', '    if ch in seen and seen[ch] >= left:', '        left = seen[ch] + 1          # shrink past the duplicate', '    seen[ch] = right', '    best = max(best, right - left + 1)'];
    function frames(s) {
      var F = [], seen = {}, left = 0, best = 0, bl = 0, br = -1;
      s = s.slice(0, 18);
      function snap(r, line, msg, dup) {
        var mk = {}; for (var i = 0; i < s.length; i++) mk[i] = i >= left && i <= r ? 'a' : (i >= bl && i <= br ? 'ok' : ''); if (dup !== undefined) mk[dup] = 'c';
        F.push({ s: s.split(''), marks: mk, ptrs: { L: left, R: r }, best: best, win: s.slice(left, r + 1), line: line, msg: msg });
      }
      F.push({ s: s.split(''), marks: {}, ptrs: {}, best: 0, win: '', line: 0, msg: 'Find the longest substring with no repeated characters. The window [L, R] always holds distinct characters.' });
      for (var r = 0; r < s.length; r++) {
        var ch = s[r];
        if (seen[ch] !== undefined && seen[ch] >= left) {
          snap(r - 1, 2, '"' + ch + '" is already in the window (at index ' + seen[ch] + ').', seen[ch]);
          left = seen[ch] + 1;
          snap(r - 1, 3, 'Move L to ' + left + ', just past the earlier "' + ch + '". The window never moves backwards.');
        }
        seen[ch] = r;
        if (r - left + 1 > best) { best = r - left + 1; bl = left; br = r; }
        snap(r, [4, 5], 'Add "' + ch + '" at R = ' + r + '. Window "' + s.slice(left, r + 1) + '" has length ' + (r - left + 1) + '. Best so far: ' + best + '.');
      }
      F.push({ s: s.split(''), marks: (function () { var m = {}; for (var i = bl; i <= br; i++) m[i] = 'ok'; return m; })(), ptrs: {}, best: best, win: s.slice(bl, br + 1), line: [], msg: 'Answer: "' + s.slice(bl, br + 1) + '" (length ' + best + '). Each character entered and left the window at most once: O(n).' });
      return F;
    }
    function render(f, ctx) {
      DSA.cells(ctx.stage, f.s, { marks: f.marks, ptrs: f.ptrs });
      $('<div class="readout">').html('Window: <b>"' + $('<i>').text(f.win).html() + '"</b> &middot; best length: <b>' + f.best + '</b>').appendTo(ctx.stage);
    }
    var p = DSA.player('#sw-demo', frames('abcabcbb'), render, { code: CODE });
    $('#sw-run').on('click', function () { p.set(frames($('#sw-s').val() || 'a')); });
  })();

  // ================================================================== prefix sums
  (function () {
    var CODE = ['P = [0] * (n + 1)', 'for i in range(n):', '    P[i + 1] = P[i] + a[i]          # build once: O(n)', 'def range_sum(l, r):               # inclusive', '    return P[r + 1] - P[l]         # any query: O(1)'];
    function frames(a, l, r) {
      var F = [], P = [0], i;
      l = Math.max(0, Math.min(l, a.length - 1)); r = Math.max(l, Math.min(r, a.length - 1));
      F.push({ a: a, P: P.slice(), am: {}, pm: { 0: 'ok' }, line: 0, msg: 'P[i] will hold the sum of the first i elements. P[0] = 0.' });
      for (i = 0; i < a.length; i++) {
        P.push(P[i] + a[i]);
        var am = {}; am[i] = 'a'; var pm = {}; pm[i] = 'b'; pm[i + 1] = 'ok';
        F.push({ a: a, P: P.slice(), am: am, pm: pm, line: 2, msg: 'P[' + (i + 1) + '] = P[' + i + '] + a[' + i + '] = ' + P[i] + ' + ' + a[i] + ' = ' + P[i + 1] + '.' });
      }
      var qa = {}; for (i = l; i <= r; i++) qa[i] = 'a';
      var qp = {}; qp[r + 1] = 'ok'; qp[l] = 'c';
      F.push({ a: a, P: P, am: qa, pm: qp, line: 4, msg: 'Query sum(a[' + l + '..' + r + ']) = P[' + (r + 1) + '] - P[' + l + '] = ' + P[r + 1] + ' - ' + P[l] + ' = ' + (P[r + 1] - P[l]) + '. One subtraction, however long the range.' });
      return F;
    }
    function render(f, ctx) {
      DSA.cells(ctx.stage, f.a, { marks: f.am, label: 'a' });
      DSA.cells(ctx.stage, f.P, { marks: f.pm, label: 'P (prefix sums)' });
    }
    function build() { p.set(frames(DSA.parseNums($('#ps-arr').val(), 14), +$('#ps-l').val(), +$('#ps-r').val())); }
    var p = DSA.player('#ps-demo', frames([3, 1, 4, 1, 5, 9, 2, 6], 2, 5), render, { code: CODE });
    $('#ps-run').on('click', build);
  })();

  // ================================================================== Kadane
  (function () {
    var CODE = ['cur = best = a[0]', 'for x in a[1:]:', '    cur = max(x, cur + x)     # extend, or start fresh at x', '    best = max(best, cur)'];
    function frames(a) {
      var F = [], cur = a[0], best = a[0], cs = 0, bs = 0, be = 0;
      function mk(i) { var m = {}; for (var k = cs; k <= i; k++) m[k] = 'a'; if (i !== undefined) m[i] = 'b'; return m; }
      F.push({ a: a, marks: { 0: 'a' }, cur: cur, best: best, br: [0, 0], line: 0, msg: 'Start with the first element: cur = best = ' + a[0] + '.' });
      for (var i = 1; i < a.length; i++) {
        var ext = cur + a[i];
        if (a[i] > ext) { cur = a[i]; cs = i; F.push({ a: a, marks: mk(i), cur: cur, best: best, br: [bs, be], line: 2, msg: 'a[' + i + '] = ' + a[i] + ' is bigger than extending (' + ext + '): the old subarray only hurts, so start fresh here.' }); }
        else { cur = ext; F.push({ a: a, marks: mk(i), cur: cur, best: best, br: [bs, be], line: 2, msg: 'Extend: cur = ' + (ext - a[i]) + ' + ' + a[i] + ' = ' + cur + '.' }); }
        if (cur > best) { best = cur; bs = cs; be = i; F.push({ a: a, marks: mk(i), cur: cur, best: best, br: [bs, be], line: 3, msg: 'New best sum ' + best + ' (indexes ' + bs + '..' + be + ').' }); }
      }
      var m = {}; for (var k = bs; k <= be; k++) m[k] = 'ok';
      F.push({ a: a, marks: m, cur: cur, best: best, br: [bs, be], line: [], msg: 'Maximum subarray sum = ' + best + ', from index ' + bs + ' to ' + be + '. One pass: O(n) time, O(1) space.' });
      return F;
    }
    function render(f, ctx) {
      DSA.cells(ctx.stage, f.a, { marks: f.marks });
      $('<div class="readout">').html('cur = <b>' + f.cur + '</b> &middot; best = <b>' + f.best + '</b> (indexes ' + f.br[0] + '..' + f.br[1] + ')').appendTo(ctx.stage);
    }
    var p = DSA.player('#kd-demo', frames([-2, 1, -3, 4, -1, 2, 1, -5, 4]), render, { code: CODE });
    $('#kd-run').on('click', function () { var a = DSA.parseNums($('#kd-arr').val(), 16); if (a.length) p.set(frames(a)); });
  })();
});

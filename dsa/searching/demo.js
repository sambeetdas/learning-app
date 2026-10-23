$(function () {
  'use strict';

  // ================================================================== binary search family
  (function () {
    var CODES = {
      exact: ['lo, hi = 0, len(a) - 1', 'while lo <= hi:', '    mid = (lo + hi) // 2', '    if a[mid] == target: return mid', '    elif a[mid] < target: lo = mid + 1   # target is to the right', '    else: hi = mid - 1                   # target is to the left', 'return -1'],
      lower: ['lo, hi = 0, len(a)            # answer is in [lo, hi]', 'while lo < hi:', '    mid = (lo + hi) // 2', '    if a[mid] < target: lo = mid + 1   # mid is too small: answer is right of it', '    else: hi = mid                     # mid could be the answer: keep it', 'return lo    # first index with a[i] >= target (bisect_left)'],
      rotated: ['lo, hi = 0, len(a) - 1', 'while lo <= hi:', '    mid = (lo + hi) // 2', '    if a[mid] == target: return mid', '    if a[lo] <= a[mid]:                   # left half is sorted', '        if a[lo] <= target < a[mid]: hi = mid - 1', '        else: lo = mid + 1', '    else:                                 # right half is sorted', '        if a[mid] < target <= a[hi]: lo = mid + 1', '        else: hi = mid - 1']
    };
    function frames(mode, a, t) {
      var F = [], lo = 0, hi = mode === 'lower' ? a.length : a.length - 1, steps = 0;
      function snap(line, msg, mid, found) {
        var m = {};
        for (var i = 0; i < a.length; i++) if (i < lo || i > (mode === 'lower' ? hi - 1 : hi)) m[i] = 'dim';
        if (mid !== undefined) m[mid] = found ? 'ok' : 'a';
        var ptrs = { lo: lo }; ptrs[mode === 'lower' ? 'hi (exclusive)' : 'hi'] = hi; if (mid !== undefined && !found) ptrs.mid = mid;
        if (found) ptrs = (function () { var q = {}; q.found = mid; return q; })();
        F.push({ a: a, marks: m, ptrs: ptrs, line: line, msg: msg, steps: steps });
      }
      snap(0, mode === 'exact' ? 'Find ' + t + ' in a sorted array. Each step looks at the middle and throws away half.' : mode === 'lower' ? 'Find the first position where a[i] ≥ ' + t + ' (lower bound). Works even if ' + t + ' is missing or repeated.' : 'The sorted array was rotated. At least one half around mid is always sorted; use it to decide where ' + t + ' can be.');
      while (mode === 'lower' ? lo < hi : lo <= hi) {
        var mid = (lo + hi) >> 1; steps++;
        snap(2, 'Step ' + steps + ': mid = (' + lo + ' + ' + hi + ') // 2 = ' + mid + ', a[mid] = ' + a[mid] + '.', mid);
        if (mode === 'exact') {
          if (a[mid] === t) { snap(3, 'Found ' + t + ' at index ' + mid + ' after ' + steps + ' steps. log₂(' + a.length + ') ≈ ' + Math.log2(a.length).toFixed(1) + '.', mid, true); return F; }
          if (a[mid] < t) { lo = mid + 1; snap(4, a[mid] + ' < ' + t + ': discard the left half, lo = ' + lo + '.'); }
          else { hi = mid - 1; snap(5, a[mid] + ' > ' + t + ': discard the right half, hi = ' + hi + '.'); }
        } else if (mode === 'lower') {
          if (a[mid] < t) { lo = mid + 1; snap(3, a[mid] + ' < ' + t + ': the answer is after mid, lo = ' + lo + '.'); }
          else { hi = mid; snap(4, a[mid] + ' ≥ ' + t + ': mid might be the answer, keep it: hi = ' + hi + '.'); }
        } else {
          if (a[mid] === t) { snap(3, 'Found ' + t + ' at index ' + mid + '.', mid, true); return F; }
          if (a[lo] <= a[mid]) {
            var oldLo = lo;
            if (a[lo] <= t && t < a[mid]) { hi = mid - 1; snap(5, 'Left half [' + a[oldLo] + '..' + a[mid] + '] is sorted and contains ' + t + ': go left.'); }
            else { lo = mid + 1; snap(6, 'Left half [' + a[oldLo] + '..' + a[mid] + '] is sorted but ' + t + ' is not in it: go right.'); }
          } else {
            if (a[mid] < t && t <= a[hi]) { lo = mid + 1; snap(8, 'Right half [' + a[mid] + '..' + a[hi] + '] is sorted and contains ' + t + ': go right.'); }
            else { hi = mid - 1; snap(9, 'Right half is sorted but ' + t + ' is not in it: go left.'); }
          }
        }
      }
      if (mode === 'lower') { var m2 = {}; if (lo < a.length) m2[lo] = 'ok'; F.push({ a: a, marks: m2, ptrs: { answer: lo }, line: 5, msg: 'lo = hi = ' + lo + ': ' + (lo < a.length ? 'a[' + lo + '] = ' + a[lo] + ' is the first value ≥ ' + t + '.' : 'every value is smaller, so the answer is the end of the array (' + lo + ').') + ' This is also where ' + t + ' would be inserted to keep the array sorted.', steps: steps }); }
      else F.push({ a: a, marks: (function () { var m = {}; a.forEach(function (_, i) { m[i] = 'dim'; }); return m; })(), ptrs: {}, line: mode === 'exact' ? 6 : 1, msg: 'lo passed hi: ' + t + ' is not in the array (' + steps + ' steps).', steps: steps });
      return F;
    }
    function render(f, ctx) { DSA.cells(ctx.stage, f.a, { marks: f.marks, ptrs: f.ptrs }); }
    var p = DSA.player('#bs-demo', [], render, {});
    function build() {
      var mode = $('#bs-mode').val(), a = DSA.parseNums($('#bs-arr').val(), 20);
      if (mode !== 'rotated') a.sort(function (x, y) { return x - y; });
      p.set(frames(mode, a, +$('#bs-t').val()), CODES[mode]);
    }
    $('#bs-mode').on('change', function () {
      var d = { exact: ['2, 5, 8, 12, 16, 23, 38, 56, 72, 91', 23], lower: ['1, 3, 3, 5, 5, 5, 8, 9, 12', 5], rotated: ['15, 18, 22, 27, 31, 2, 5, 8, 11', 8] }[this.value];
      $('#bs-arr').val(d[0]); $('#bs-t').val(d[1]); build();
    });
    $('#bs-run').on('click', build);
    build();
  })();

  // ================================================================== binary search on the answer
  (function () {
    var CODE = ['lo, hi = max(w), sum(w)             # smallest and largest possible answer', 'while lo < hi:', '    cap = (lo + hi) // 2', '    if days_needed(w, cap) <= D: hi = cap     # feasible: try smaller', '    else: lo = cap + 1                         # too small', 'return lo', 'def days_needed(w, cap): greedily fill each day up to cap'];
    function split(w, cap) { var days = [], cur = 0, d = 0; w.forEach(function (x) { if (cur + x > cap) { d++; cur = 0; } cur += x; days.push(d); }); return { days: days, n: d + 1 }; }
    function frames(w, D) {
      var F = [], lo = Math.max.apply(null, w), hi = w.reduce(function (s, x) { return s + x; }, 0);
      function snap(line, msg, cap) {
        var marks = {}, cls = ['a', 'b', 'ok', 'p', 'c'];
        var sp = cap ? split(w, cap) : null;
        if (sp) sp.days.forEach(function (d, i) { marks[i] = cls[d % cls.length]; });
        F.push({ w: w, marks: marks, lo: lo, hi: hi, cap: cap, need: sp ? sp.n : null, line: line, msg: msg });
      }
      snap(0, 'Ship packages (in order) within ' + D + ' days. What is the smallest ship capacity that works? The answer is between the heaviest package (' + lo + ') and the total (' + hi + '). If capacity c works, any bigger one works too: the "works?" test is monotonic, so binary search the answer.');
      while (lo < hi) {
        var cap = (lo + hi) >> 1, need = split(w, cap).n;
        snap([2, 6], 'Try capacity ' + cap + ' (middle of [' + lo + ', ' + hi + ']): greedy loading needs ' + need + ' day(s). Colours show which day each package ships.', cap);
        if (need <= D) { hi = cap; snap(3, need + ' ≤ ' + D + ' days: capacity ' + cap + ' works. Maybe something smaller does too: hi = ' + cap + '.', cap); }
        else { lo = cap + 1; snap(4, need + ' > ' + D + ' days: too small. lo = ' + lo + '.', cap); }
      }
      snap(5, 'lo = hi = ' + lo + ': the minimum capacity. Only about log₂(range) feasibility checks, each O(n): O(n log(sum)).', lo);
      return F;
    }
    function render(f, ctx) {
      DSA.cells(ctx.stage, f.w, { marks: f.marks, label: 'package weights' + (f.cap ? ' (coloured by shipping day at capacity ' + f.cap + ')' : '') });
      $('<div class="readout">').html('Search range: [<b>' + f.lo + '</b>, <b>' + f.hi + '</b>]' + (f.cap ? ' &middot; testing capacity <b>' + f.cap + '</b> &rarr; <b>' + f.need + '</b> day(s)' : '')).appendTo(ctx.stage);
    }
    var p = DSA.player('#ans-demo', frames([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), render, { code: CODE });
    $('#ans-run').on('click', function () { var w = DSA.parseNums($('#ans-w').val(), 16).filter(function (x) { return x > 0; }); if (w.length) p.set(frames(w, Math.max(1, +$('#ans-d').val()))); });
  })();

  // ================================================================== quickselect
  (function () {
    var CODE = ['lo, hi = 0, n - 1', 'while True:', '    p = partition(a, lo, hi)        # pivot lands at its sorted position p', '    if p == k: return a[p]', '    elif p < k: lo = p + 1          # only recurse into ONE side', '    else: hi = p - 1'];
    function frames(a, k) {
      a = a.slice(); k = Math.max(0, Math.min(k, a.length - 1));
      var F = [], lo = 0, hi = a.length - 1;
      function snap(line, msg, extra) {
        var m = {}; for (var i = 0; i < a.length; i++) m[i] = i < lo || i > hi ? 'dim' : 'a';
        Object.keys(extra || {}).forEach(function (x) { m[x] = extra[x]; });
        F.push({ a: a.slice(), marks: m, line: line, msg: msg });
      }
      snap(0, 'Find the ' + (k + 1) + (k === 0 ? 'st' : k === 1 ? 'nd' : k === 2 ? 'rd' : 'th') + ' smallest value (index ' + k + ' if sorted) without sorting everything.');
      while (true) {
        var pv = a[hi], i = lo;
        for (var j = lo; j < hi; j++) if (a[j] < pv) { var t = a[i]; a[i] = a[j]; a[j] = t; i++; }
        var t2 = a[i]; a[i] = a[hi]; a[hi] = t2;
        var e = {}; e[i] = 'p';
        snap(2, 'Partition [' + lo + '..' + hi + '] around ' + pv + ': it lands at index ' + i + '; smaller values are left of it, larger right.', e);
        if (i === k) { var f = {}; f[i] = 'ok'; snap(3, 'The pivot is at index ' + k + ': the answer is ' + a[i] + '. Average O(n): n + n/2 + n/4 + ... ≈ 2n.', f); return F; }
        if (i < k) { lo = i + 1; snap(4, 'Index ' + i + ' < ' + k + ': the answer is on the right. Discard the left side entirely.'); }
        else { hi = i - 1; snap(5, 'Index ' + i + ' > ' + k + ': the answer is on the left.'); }
      }
    }
    function render(f, ctx) { DSA.bars(ctx.stage, f.a, { marks: f.marks }); }
    var p = DSA.player('#qs-demo', frames([31, 7, 22, 15, 3, 40, 18, 9, 27, 12], 4), render, { code: CODE });
    $('#qs-run').on('click', function () { var a = DSA.parseNums($('#qs-arr').val(), 24); if (a.length) p.set(frames(a, +$('#qs-k').val() - 1)); });
  })();

  // ================================================================== strategy race (probe counts)
  (function () {
    function linear(a, t) { for (var i = 0; i < a.length; i++) if (a[i] >= t) return i + 1; return a.length; }
    function binary(a, t) { var lo = 0, hi = a.length - 1, c = 0; while (lo <= hi) { var m = (lo + hi) >> 1; c++; if (a[m] === t) return c; if (a[m] < t) lo = m + 1; else hi = m - 1; } return c; }
    function jump(a, t) { var s = Math.floor(Math.sqrt(a.length)), prev = 0, c = 0, i = 0; while (i < a.length && a[Math.min(i + s, a.length) - 1] < t) { c++; prev = i; i += s; } c++; for (var j = i; j < Math.min(i + s, a.length); j++) { c++; if (a[j] >= t) return c; } return c; }
    function interp(a, t) { var lo = 0, hi = a.length - 1, c = 0; while (lo <= hi && t >= a[lo] && t <= a[hi]) { c++; if (a[hi] === a[lo]) return c; var pos = lo + Math.floor((t - a[lo]) * (hi - lo) / (a[hi] - a[lo])); if (a[pos] === t) return c; if (a[pos] < t) lo = pos + 1; else hi = pos - 1; } return c + 1; }
    function expo(a, t) { var c = 1; if (a[0] >= t) return c; var b = 1; while (b < a.length && a[b] < t) { b *= 2; c++; } var lo = b >> 1, hi = Math.min(b, a.length - 1); while (lo <= hi) { var m = (lo + hi) >> 1; c++; if (a[m] === t) return c; if (a[m] < t) lo = m + 1; else hi = m - 1; } return c; }
    function runRace() {
      var n = +$('#race-n').val(), dist = $('#race-dist').val(), a = [], x = 0, r = DSA.rng(9);
      for (var i = 0; i < n; i++) { x = dist === 'uniform' ? x + 3 : i + Math.floor(Math.exp(20 * i / n)); a.push(x); }   // skewed: exponential growth
      var t = a[Math.floor(n * 0.7)];
      var rows = [['Linear search', linear(a, t), 'O(n)'], ['Jump search', jump(a, t), 'O(√n)'], ['Binary search', binary(a, t), 'O(log n)'], ['Exponential search', expo(a, t), 'O(log i)'], ['Interpolation search', interp(a, t), 'O(log log n) uniform, O(n) worst']];
      var $b = $('#race-body').empty();
      rows.forEach(function (rw) { $('<tr>').append($('<td>').text(rw[0]), $('<td>').text(rw[1]), $('<td>').text(rw[2])).appendTo($b); });
      $('#race-note').text('Searching for the value at 70% of a sorted array of ' + n.toLocaleString() + ' ' + (dist === 'uniform' ? 'evenly spaced' : 'very unevenly spaced') + ' numbers.');
    }
    $('#race-n, #race-dist').on('change', runRace);
    runRace();
  })();
});

$(function () {
  'use strict';

  var CODES = {
    bubble: ['for i in range(n):', '    swapped = False', '    for j in range(n - 1 - i):', '        if a[j] > a[j + 1]:', '            swap(a[j], a[j + 1]); swapped = True', '    if not swapped: break           # already sorted: O(n) best case'],
    selection: ['for i in range(n):', '    m = i', '    for j in range(i + 1, n):', '        if a[j] < a[m]: m = j       # remember the smallest', '    swap(a[i], a[m])                # put it in its final place'],
    insertion: ['for i in range(1, n):', '    key = a[i]; j = i - 1', '    while j >= 0 and a[j] > key:', '        a[j + 1] = a[j]; j -= 1     # shift bigger items right', '    a[j + 1] = key                  # drop key into the gap'],
    shell: ['gap = n // 2', 'while gap > 0:', '    for i in range(gap, n):         # insertion sort on every gap-th item', '        key = a[i]; j = i', '        while j >= gap and a[j - gap] > key:', '            a[j] = a[j - gap]; j -= gap', '        a[j] = key', '    gap //= 2'],
    merge: ['def merge_sort(a, lo, hi):', '    if hi - lo < 1: return', '    mid = (lo + hi) // 2', '    merge_sort(a, lo, mid); merge_sort(a, mid + 1, hi)', '    merge the two sorted halves:', '        repeatedly take the smaller front item'],
    quick: ['def quick_sort(a, lo, hi):', '    if lo >= hi: return', '    pivot = a[hi]; i = lo                # Lomuto partition', '    for j in range(lo, hi):', '        if a[j] < pivot: swap(a[i], a[j]); i += 1', '    swap(a[i], a[hi])                    # pivot lands in its final place', '    quick_sort(a, lo, i - 1); quick_sort(a, i + 1, hi)'],
    heap: ['build a max-heap from a                  # O(n)', 'for end in range(n - 1, 0, -1):', '    swap(a[0], a[end])                   # move the max to the end', '    sift_down(a, 0, end)                 # restore the heap on a[0:end]'],
    counting: ['count = [0] * (max + 1)', 'for x in a: count[x] += 1', 'i = 0', 'for v in range(max + 1):', '    for _ in range(count[v]): a[i] = v; i += 1'],
    radix: ['for each digit position d (ones, tens, ...):', '    buckets = [[] for _ in range(10)]', '    for x in a: buckets[digit(x, d)].append(x)   # stable', '    a = concatenation of the buckets']
  };
  var INFO = {
    bubble: 'Repeatedly swap adjacent items that are out of order; the largest "bubbles" to the end each pass.',
    selection: 'Find the smallest remaining item and put it next. Always O(n²) comparisons, but at most n swaps.',
    insertion: 'Grow a sorted prefix, inserting each new item into place. Excellent on small or nearly sorted data.',
    shell: 'Insertion sort over shrinking gaps: far-apart items move quickly first.',
    merge: 'Split in half, sort each half recursively, merge the sorted halves. Always O(n log n), stable.',
    quick: 'Partition around a pivot (smaller left, bigger right), then sort each side. Fastest in practice on average.',
    heap: 'Build a max-heap, then repeatedly move the maximum to the end. O(n log n) worst case, in place.',
    counting: 'Count how many times each value appears, then write them out in order. O(n + k) for values 0..k.',
    radix: 'Sort by the last digit, then the next, using stable buckets. O(d·(n + 10)) for d-digit numbers.'
  };

  function run(kind, input) {
    var a = input.slice(), n = a.length, F = [], cmp = 0, wr = 0, done = {}, extra = null;
    function snap(line, msg, marks) {
      var m = {}; Object.keys(done).forEach(function (k) { m[k] = 'ok'; }); Object.keys(marks || {}).forEach(function (k) { m[k] = marks[k]; });
      F.push({ a: a.slice(), marks: m, cmp: cmp, wr: wr, line: line, msg: msg, extra: extra ? DSA.clone(extra) : null });
    }
    function swap(i, j) { var t = a[i]; a[i] = a[j]; a[j] = t; wr += 2; }
    function all() { for (var k = 0; k < n; k++) done[k] = 1; }
    snap([], INFO[kind]);

    if (kind === 'bubble') {
      for (var i = 0; i < n; i++) {
        var sw = false;
        for (var j = 0; j < n - 1 - i; j++) {
          cmp++; var m = {}; m[j] = 'b'; m[j + 1] = 'b'; snap(3, 'Compare ' + a[j] + ' and ' + a[j + 1] + '.', m);
          if (a[j] > a[j + 1]) { swap(j, j + 1); sw = true; m = {}; m[j] = 'c'; m[j + 1] = 'c'; snap(4, 'Out of order: swap.', m); }
        }
        done[n - 1 - i] = 1;
        if (!sw) { all(); snap(5, 'A full pass with no swaps: the array is sorted. Stop early.'); break; }
        snap(2, a[n - 1 - i] + ' has bubbled to its final position.');
      }
    } else if (kind === 'selection') {
      for (var s = 0; s < n; s++) {
        var mi = s;
        for (var t = s + 1; t < n; t++) { cmp++; var m2 = {}; m2[t] = 'b'; m2[mi] = 'p'; snap(3, 'Is ' + a[t] + ' smaller than the current minimum ' + a[mi] + '?', m2); if (a[t] < a[mi]) mi = t; }
        if (mi !== s) { swap(s, mi); }
        done[s] = 1; var m3 = {}; m3[s] = 'c'; snap(4, 'Swap the minimum (' + a[s] + ') into position ' + s + '.', m3);
      }
    } else if (kind === 'insertion') {
      done[0] = 1;
      for (var p = 1; p < n; p++) {
        var key = a[p], q = p - 1, mm = {}; mm[p] = 'a';
        snap(1, 'Take ' + key + ' and insert it into the sorted part on the left.', mm);
        while (q >= 0) {
          cmp++;
          var m4 = {}; m4[q] = 'b'; m4[q + 1] = 'a';
          if (a[q] <= key) { snap(2, a[q] + ' ≤ ' + key + ': found the spot.', m4); break; }
          a[q + 1] = a[q]; a[q] = key; wr++;
          m4 = {}; m4[q] = 'a'; m4[q + 1] = 'c'; snap(3, 'Shift ' + a[q + 1] + ' right.', m4);
          q--;
        }
        a[q + 1] = key; wr++;
        for (var z = 0; z <= p; z++) done[z] = 1;
        snap(4, 'The first ' + (p + 1) + ' items are sorted.');
      }
    } else if (kind === 'shell') {
      for (var gap = n >> 1; gap > 0; gap >>= 1) {
        snap(1, 'Gap = ' + gap + ': insertion-sort the items that are ' + gap + ' apart.');
        for (var g = gap; g < n; g++) {
          var k2 = a[g], h = g;
          while (h >= gap) {
            cmp++; var m5 = {}; m5[h - gap] = 'b'; m5[h] = 'a';
            if (a[h - gap] <= k2) { snap(4, 'Compare items ' + gap + ' apart: in order.', m5); break; }
            a[h] = a[h - gap]; a[h - gap] = k2; wr++; m5 = {}; m5[h - gap] = 'a'; m5[h] = 'c';
            snap(5, 'Move ' + a[h] + ' ' + gap + ' places right.', m5); h -= gap;
          }
          a[h] = k2; wr++;
        }
      }
      all(); snap(7, 'Gap 1 is a plain insertion sort, but by now the array is nearly sorted, so it is fast.');
    } else if (kind === 'merge') {
      (function ms(lo, hi) {
        if (hi <= lo) return;
        var mid = (lo + hi) >> 1;
        ms(lo, mid); ms(mid + 1, hi);
        var L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1), x = 0, y = 0, kk = lo, rng = {};
        for (var r = lo; r <= hi; r++) rng[r] = 'a';
        snap(4, 'Merge the sorted halves [' + lo + '..' + mid + '] and [' + (mid + 1) + '..' + hi + '].', rng);
        while (x < L.length || y < R.length) {
          var takeL = y >= R.length || (x < L.length && L[x] <= R[y]);
          if (x < L.length && y < R.length) cmp++;
          a[kk] = takeL ? L[x++] : R[y++]; wr++;
          var m6 = $.extend({}, rng); m6[kk] = 'c';
          snap(5, 'Write ' + a[kk] + ' (the smaller front item) at position ' + kk + '.', m6);
          kk++;
        }
        if (lo === 0 && hi === n - 1) all();
      })(0, n - 1);
      snap([], 'Sorted. log₂ n levels of merging, each touching all n items: O(n log n) always, using O(n) extra memory.');
    } else if (kind === 'quick') {
      (function qs(lo, hi) {
        if (lo > hi) return;
        if (lo === hi) { done[lo] = 1; return; }
        var pv = a[hi], i2 = lo, m7 = {};
        for (var r = lo; r <= hi; r++) m7[r] = 'a'; m7[hi] = 'p';
        snap(2, 'Partition [' + lo + '..' + hi + '] around pivot ' + pv + ' (the last element).', m7);
        for (var j2 = lo; j2 < hi; j2++) {
          cmp++; var m8 = $.extend({}, m7); m8[j2] = 'b';
          if (a[j2] < pv) { swap(i2, j2); m8 = $.extend({}, m7); m8[i2] = 'c'; m8[j2] = 'c'; snap(4, a[i2] + ' < ' + pv + ': move it to the "smaller" zone (position ' + i2 + ').', m8); i2++; }
          else snap(4, a[j2] + ' ≥ ' + pv + ': leave it in the "bigger" zone.', m8);
        }
        swap(i2, hi); done[i2] = 1;
        snap(5, 'Put the pivot ' + pv + ' between the zones at position ' + i2 + '. It is now in its final place.');
        qs(lo, i2 - 1); qs(i2 + 1, hi);
      })(0, n - 1);
      all(); snap([], 'Sorted. Average O(n log n); a bad pivot every time (e.g. sorted input with last-element pivot) gives O(n²). Real libraries pick random or median-of-three pivots.');
    } else if (kind === 'heap') {
      var sift = function (st, end) {
        var i3 = st;
        while (true) {
          var l = 2 * i3 + 1, r2 = l + 1, big = i3;
          if (l < end) { cmp++; if (a[l] > a[big]) big = l; }
          if (r2 < end) { cmp++; if (a[r2] > a[big]) big = r2; }
          if (big === i3) return;
          swap(i3, big); var m9 = {}; m9[i3] = 'c'; m9[big] = 'c'; snap(3, 'Sift down: swap with the larger child.', m9); i3 = big;
        }
      };
      for (var b = (n >> 1) - 1; b >= 0; b--) sift(b, n);
      snap(0, 'Max-heap built: the largest value (' + a[0] + ') is at index 0.', { 0: 'p' });
      for (var e = n - 1; e > 0; e--) {
        swap(0, e); done[e] = 1;
        snap(2, 'Swap the max (' + a[e] + ') to position ' + e + '; that part is final.', (function () { var q2 = {}; q2[0] = 'c'; return q2; })());
        sift(0, e);
      }
      all(); snap([], 'Sorted in place with O(1) extra memory and O(n log n) worst case. Not stable, and less cache-friendly than quicksort.');
    } else if (kind === 'counting') {
      var mx = Math.max.apply(null, a), cnt = []; for (var c = 0; c <= mx; c++) cnt.push(0);
      extra = { label: 'count[v] for v = 0..' + mx, cells: cnt };
      snap(0, 'Make one counter per possible value. No comparisons at all.');
      for (var i4 = 0; i4 < n; i4++) { cnt[a[i4]]++; var m10 = {}; m10[i4] = 'a'; snap(1, 'Count ' + a[i4] + ': count[' + a[i4] + '] = ' + cnt[a[i4]] + '.', m10); }
      var w = 0;
      for (var v = 0; v <= mx; v++) for (var u = 0; u < cnt[v]; u++) { a[w] = v; wr++; done[w] = 1; snap(4, 'Write ' + v + ' at position ' + w + '.'); w++; }
      snap([], 'Sorted in O(n + k) where k = ' + mx + ' is the value range. Great for small integer ranges (ages, grades, bytes); useless for huge ranges.');
    } else if (kind === 'radix') {
      var mxr = Math.max.apply(null, a), exp = 1, pass = 0;
      while (Math.floor(mxr / exp) > 0) {
        var buckets = []; for (var d = 0; d < 10; d++) buckets.push([]);
        a.forEach(function (x) { buckets[Math.floor(x / exp) % 10].push(x); });
        extra = { label: 'buckets by the ' + (exp === 1 ? 'ones' : exp === 10 ? 'tens' : 'hundreds') + ' digit (0-9)', cells: buckets.map(function (bk, i) { return i + ': ' + bk.join(' '); }) };
        snap(2, 'Pass ' + (++pass) + ': distribute by the ' + (exp === 1 ? 'ones' : exp === 10 ? 'tens' : 'hundreds') + ' digit, keeping the existing order inside each bucket (stable).');
        a = [].concat.apply([], buckets); wr += n;
        snap(3, 'Collect the buckets in order 0..9.');
        exp *= 10;
      }
      all(); extra = null; snap([], 'Sorted after ' + pass + ' passes, with no comparisons: O(d·(n + b)) for d digits in base b. Used for integers, fixed-length strings, and on GPUs.');
    }
    return { F: F, cmp: cmp, wr: wr };
  }

  function render(f, ctx) {
    DSA.bars(ctx.stage, f.a, { marks: f.marks });
    if (f.extra) DSA.cells(ctx.stage, f.extra.cells, { label: f.extra.label });
    $('<div class="readout">').html('Comparisons: <b>' + f.cmp + '</b> &middot; writes: <b>' + f.wr + '</b>').appendTo(ctx.stage);
  }

  var input;
  function makeInput() {
    var n = +$('#so-n').val(), shape = $('#so-shape').val(), a = DSA.randArray(n, 40);
    if (shape === 'sorted') a.sort(function (x, y) { return x - y; });
    if (shape === 'reversed') a.sort(function (x, y) { return y - x; });
    if (shape === 'nearly') { a.sort(function (x, y) { return x - y; }); for (var k = 0; k < Math.max(1, n / 8); k++) { var i = Math.floor(Math.random() * n), j = Math.min(n - 1, i + 1 + Math.floor(Math.random() * 2)); var t = a[i]; a[i] = a[j]; a[j] = t; } }
    if (shape === 'few') a = a.map(function (x) { return 5 + (x % 4) * 8; });
    if (shape === 'custom') { var c = DSA.parseNums($('#so-custom').val(), 40).map(function (x) { return Math.max(0, Math.round(x)); }); if (c.length) a = c; }
    input = a;
    $('#so-custom').val(a.join(', '));
  }
  var p = DSA.player('#so-demo', [], render, { speed: 300 });
  function build() { var k = $('#so-algo').val(); p.set(run(k, input).F, CODES[k]); }
  $('#so-algo').on('change', build);
  $('#so-n, #so-shape').on('change', function () { makeInput(); build(); });
  $('#so-new').on('click', function () { if ($('#so-shape').val() === 'custom') $('#so-shape').val('random'); makeInput(); build(); });
  $('#so-use').on('click', function () { $('#so-shape').val('custom'); makeInput(); build(); });
  $('#so-compare').on('click', function () {
    var $b = $('#so-table tbody').empty();
    Object.keys(CODES).forEach(function (k) {
      var r = run(k, input);
      $('<tr>').append($('<td>').text($('#so-algo option[value=' + k + ']').text()), $('<td>').text(r.cmp), $('<td>').text(r.wr), $('<td>').text(r.F.length)).appendTo($b);
    });
    $('#so-table').show();
  });
  makeInput(); build();
});

$(function () {
  'use strict';

  function toTree(a) {                           // node ids are array indexes, so duplicates are fine
    function mk(i) { return i < a.length ? { v: a[i], id: i, l: mk(2 * i + 1), r: mk(2 * i + 2) } : null; }
    return mk(0);
  }
  function render(f, ctx) {
    var tm = {}; Object.keys(f.marks || {}).forEach(function (k) { tm[k] = f.marks[k]; });
    DSA.tree(ctx.stage, toTree(f.a), { marks: tm, empty: '(empty heap)' });
    DSA.cells(ctx.stage, f.a, { marks: f.marks, label: 'the same heap stored in an array: children of i are 2i+1 and 2i+2, parent is (i-1)//2' });
    if (f.out && f.out.length) DSA.cells(ctx.stage, f.out, { label: 'popped so far (in sorted order)', noIndex: true });
  }

  // ================================================================== push + pop
  (function () {
    var CODE = ['def push(h, x):', '    h.append(x); i = len(h) - 1', '    while i > 0 and h[(i - 1) // 2] > h[i]:          # sift up', '        swap(h, i, (i - 1) // 2); i = (i - 1) // 2', 'def pop(h):', '    top = h[0]; h[0] = h[-1]; h.pop(); i = 0', '    while a child is smaller than h[i]:                # sift down', '        c = the smaller child; swap(h, i, c); i = c', '    return top'];
    function frames(vals, pops) {
      var F = [], a = [], out = [];
      function snap(line, msg, marks) { F.push({ a: a.slice(), marks: marks || {}, out: out.slice(), line: line, msg: msg }); }
      snap([], 'A min-heap: every parent is ≤ its children, so the smallest value is always at the root. It is a complete tree, so it fits perfectly in an array.');
      vals.forEach(function (x) {
        a.push(x); var i = a.length - 1, m = {}; m[i] = 'ok';
        snap(1, 'push(' + x + '): add it at the end (the next free spot in the bottom level).', m);
        while (i > 0) {
          var p = (i - 1) >> 1; m = {}; m[i] = 'a'; m[p] = 'b';
          if (a[p] <= a[i]) { snap(2, 'Parent ' + a[p] + ' ≤ ' + a[i] + ': heap property holds. Stop.', m); break; }
          snap(2, 'Parent ' + a[p] + ' > ' + a[i] + ': they are in the wrong order.', m);
          var t = a[p]; a[p] = a[i]; a[i] = t; i = p; m = {}; m[i] = 'ok';
          snap(3, 'Swap: ' + a[i] + ' moves up one level. At most log₂ n swaps.', m);
        }
      });
      for (var k = 0; k < pops && a.length; k++) {
        var top = a[0], m0 = { 0: 'c' };
        snap(5, 'pop(): the minimum is the root, ' + top + '.', m0);
        out.push(top);
        var last = a.pop();
        if (a.length) { a[0] = last; snap(5, 'Move the last element (' + last + ') to the root, so the tree stays complete.', { 0: 'b' }); }
        var i2 = 0;
        while (true) {
          var l = 2 * i2 + 1, r = l + 1, c = i2;
          if (l < a.length && a[l] < a[c]) c = l;
          if (r < a.length && a[r] < a[c]) c = r;
          if (c === i2) { if (a.length) snap(6, 'Both children are larger (or there are none): heap property restored. pop is O(log n).', (function () { var q = {}; q[i2] = 'ok'; return q; })()); break; }
          var mm = {}; mm[i2] = 'b'; mm[c] = 'a';
          snap(7, a[i2] + ' is larger than its smaller child ' + a[c] + ': swap them (always with the smaller child, so the new parent is ≤ both).', mm);
          var t2 = a[c]; a[c] = a[i2]; a[i2] = t2; i2 = c;
        }
      }
      snap([], pops ? 'Popping repeatedly returns values in sorted order: that is heap sort, O(n log n).' : 'Done.');
      return F;
    }
    var p = DSA.player('#hp-demo', frames([7, 3, 9, 1, 5, 8, 2], 3), render, { code: CODE });
    $('#hp-run').on('click', function () { p.set(frames(DSA.parseNums($('#hp-vals').val(), 15), +$('#hp-pops').val())); });
  })();

  // ================================================================== bottom-up heapify
  (function () {
    var CODE = ['def heapify(a):                     # O(n), not O(n log n)', '    for i in range(len(a) // 2 - 1, -1, -1):   # last parent down to the root', '        sift_down(a, i)'];
    function frames(a) {
      var F = [];
      a = a.slice();
      F.push({ a: a.slice(), marks: {}, line: [], msg: 'An unordered array is already a complete tree, just not a heap. Fix it from the bottom up: leaves (the second half) are already valid one-node heaps.' });
      for (var s = (a.length >> 1) - 1; s >= 0; s--) {
        var m = {}; m[s] = 'a';
        F.push({ a: a.slice(), marks: m, line: 1, msg: 'Sift down index ' + s + ' (value ' + a[s] + '). Its subtrees are already heaps.' });
        var i = s;
        while (true) {
          var l = 2 * i + 1, r = l + 1, c = i;
          if (l < a.length && a[l] < a[c]) c = l;
          if (r < a.length && a[r] < a[c]) c = r;
          if (c === i) break;
          var t = a[c]; a[c] = a[i]; a[i] = t;
          var mm = {}; mm[c] = 'b'; mm[i] = 'ok';
          F.push({ a: a.slice(), marks: mm, line: 2, msg: 'Swap ' + a[c] + ' down with its smaller child ' + a[i] + '.' });
          i = c;
        }
      }
      F.push({ a: a.slice(), marks: { 0: 'ok' }, line: [], msg: 'A valid min-heap. Most nodes are near the bottom and sift down only a little, so the total work is O(n), cheaper than n separate pushes (O(n log n)).' });
      return F;
    }
    var p = DSA.player('#hf-demo', frames([9, 4, 7, 1, 8, 2, 6, 3, 5]), render, { code: CODE });
    $('#hf-run').on('click', function () { p.set(frames(DSA.parseNums($('#hf-vals').val(), 15))); });
  })();
});

$(function () {
  'use strict';

  // ================================================================== call trees
  (function () {
    var CODES = {
      fib: ['def fib(n):', '    if n < 2: return n                # base case', '    return fib(n - 1) + fib(n - 2)    # two recursive calls'],
      memo: ['memo = {}', 'def fib(n):', '    if n < 2: return n', '    if n in memo: return memo[n]      # already computed: no new calls', '    memo[n] = fib(n - 1) + fib(n - 2)', '    return memo[n]'],
      subsets: ['def subsets(i, chosen):', '    if i == len(items): output(chosen); return', '    subsets(i + 1, chosen + [items[i]])   # include items[i]', '    subsets(i + 1, chosen)                # exclude items[i]']
    };
    function frames(kind, n) {
      var F = [], id = 0, root = null, marks = {}, labels = {}, calls = 0, stack = [], out = [], memo = {};
      function snap(line, msg) {
        var m = $.extend({}, marks); stack.forEach(function (x) { if (!m[x] || m[x] === 'dim') m[x] = 'b'; }); if (stack.length) m[stack[stack.length - 1]] = 'a';
        F.push({ tree: DSA.clone(root), marks: m, labels: $.extend({}, labels), calls: calls, depth: stack.length, out: out.slice(), line: line, msg: msg });
      }
      function node(v) { return { v: v, id: 'n' + (id++), l: null, r: null }; }
      if (kind === 'subsets') {
        var items = ['a', 'b', 'c'].slice(0, n);
        (function rec(i, chosen, nd) {
          calls++; stack.push(nd.id);
          snap(0, 'subsets(' + i + ', {' + chosen.join(',') + '})' + (i < items.length ? ': decide about "' + items[i] + '".' : ''));
          if (i === items.length) { out.push('{' + chosen.join(',') + '}'); marks[nd.id] = 'ok'; snap(1, 'All items decided: output {' + chosen.join(',') + '}.'); stack.pop(); return; }
          nd.l = node('+' + items[i]); rec(i + 1, chosen.concat(items[i]), nd.l);
          nd.r = node('-' + items[i]); rec(i + 1, chosen, nd.r);
          stack.pop();
        })(0, [], (root = node('{}')));
        snap([], 'Every leaf is one subset: 2^' + items.length + ' = ' + out.length + ' of them. Each level is one yes/no decision, which is why subset problems are O(2^n).');
        return F;
      }
      (function rec(k, nd) {
        calls++; stack.push(nd.id);
        snap(kind === 'memo' ? 1 : 0, 'Call fib(' + k + '). Call depth ' + stack.length + '.');
        var res;
        if (k < 2) { res = k; marks[nd.id] = 'ok'; labels[nd.id] = '=' + res; snap(kind === 'memo' ? 2 : 1, 'Base case: fib(' + k + ') = ' + k + '. Return.'); }
        else if (kind === 'memo' && memo[k] !== undefined) { res = memo[k]; marks[nd.id] = 'p'; labels[nd.id] = '=' + res; snap(3, 'fib(' + k + ') is in the memo (' + res + '): return it immediately, no subtree.'); }
        else {
          nd.l = node(k - 1); var a = rec(k - 1, nd.l);
          nd.r = node(k - 2); var b = rec(k - 2, nd.r);
          res = a + b; memo[k] = res; marks[nd.id] = 'ok'; labels[nd.id] = '=' + res;
          snap(kind === 'memo' ? 4 : 2, 'fib(' + k + ') = fib(' + (k - 1) + ') + fib(' + (k - 2) + ') = ' + a + ' + ' + b + ' = ' + res + '. Return to the caller.');
        }
        stack.pop();
        return res;
      })(n, (root = node(n)));
      snap([], 'fib(' + n + ') = ' + memo[n] + ' using ' + calls + ' calls. ' + (kind === 'fib' ? 'Notice how often the same sub-problem (e.g. fib(' + (n - 2) + ')) is solved again: the call tree grows like 1.6^n. Switch to "with memo".' : 'With memoisation each value is computed once (purple nodes are memo hits): O(n) calls.'));
      return F;
    }
    function render(f, ctx) {
      DSA.tree(ctx.stage, f.tree, { marks: f.marks, labels: f.labels, dx: 40, dy: 58 });
      $('<div class="readout">').html('Calls so far: <b>' + f.calls + '</b> &middot; current depth of the call stack: <b>' + f.depth + '</b>' + (f.out.length ? ' &middot; output: ' + f.out.join(' ') : '')).appendTo(ctx.stage);
    }
    var p = DSA.player('#ct-demo', [], render, { speed: 800 });
    function build() {
      var k = $('#ct-kind').val(), n = +$('#ct-n').val();
      if (k === 'subsets') n = Math.min(n, 3);
      p.set(frames(k, n), CODES[k]);
    }
    $('#ct-kind, #ct-n').on('change', build);
    build();
  })();

  // ================================================================== N-Queens
  (function () {
    var CODE = ['def place(row):', '    if row == n: record solution; return', '    for col in range(n):', '        if safe(row, col):              # no queen in this column or diagonal', '            put queen at (row, col)     # choose', '            place(row + 1)              # explore', '            remove queen                # un-choose (backtrack)'];
    function frames(n, all) {
      var F = [], q = [], sols = 0, tries = 0, done = false;
      function snap(line, msg, test, bad) {
        var rows = [], marks = {};
        for (var r = 0; r < n; r++) { rows.push([]); for (var c = 0; c < n; c++) { rows[r].push(q[r] === c ? '♛' : ''); if ((r + c) % 2) marks[r + ',' + c] = 'dim'; } }
        q.forEach(function (c, r) { marks[r + ',' + c] = 'ok'; });
        if (test) { marks[test[0] + ',' + test[1]] = bad ? 'c' : 'a'; if (bad) bad.forEach(function (rc) { marks[rc[0] + ',' + rc[1]] = 'c'; }); }
        F.push({ rows: rows, marks: marks, sols: sols, tries: tries, line: line, msg: msg });
      }
      function conflicts(r, c) { var out = []; q.forEach(function (qc, qr) { if (qc === c || Math.abs(qc - c) === r - qr) out.push([qr, qc]); }); return out; }
      snap(0, 'Place ' + n + ' queens so that no two share a row, column or diagonal. One queen per row; try each column, and back up when stuck.');
      (function place(r) {
        if (done) return;
        if (r === n) { sols++; snap(1, 'All ' + n + ' queens placed: solution #' + sols + '.' + (all ? ' Keep searching for more.' : '')); if (!all) done = true; return; }
        for (var c = 0; c < n && !done; c++) {
          tries++;
          var bad = conflicts(r, c);
          if (bad.length) { snap(3, 'Row ' + r + ', column ' + c + ': attacked by the queen(s) in red. Try the next column.', [r, c], bad); continue; }
          q.push(c); snap([3, 4], 'Row ' + r + ', column ' + c + ' is safe: place a queen and move to row ' + (r + 1) + '.', [r, c]);
          place(r + 1);
          if (done) return;
          q.pop(); snap(6, 'Back in row ' + r + ': remove the queen from column ' + c + ' and try further right (backtrack).');
        }
      })(0);
      snap([], (sols ? sols + ' solution(s) found' : 'No solution') + ' after testing ' + tries + ' squares. Brute force over all placements would test ' + Math.pow(n, n).toLocaleString() + ' boards; pruning dead ends early is what makes backtracking practical.');
      return F;
    }
    function render(f, ctx) {
      DSA.grid(ctx.stage, f.rows, { marks: f.marks });
      $('<div class="readout">').html('Squares tested: <b>' + f.tries + '</b> &middot; solutions: <b>' + f.sols + '</b>').appendTo(ctx.stage);
    }
    var p = DSA.player('#nq-demo', [], render, { code: CODE, speed: 300 });
    function build() { p.set(frames(+$('#nq-n').val(), $('#nq-all').prop('checked'))); }
    $('#nq-n, #nq-all').on('change', build);
    build();
  })();
});

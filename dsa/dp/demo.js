$(function () {
  'use strict';

  // ================================================================== 1-D DP
  (function () {
    var CODES = {
      robber: ['dp[0] = a[0]; dp[1] = max(a[0], a[1])', 'for i in range(2, n):', '    dp[i] = max(dp[i - 1],          # skip house i', '                dp[i - 2] + a[i])   # rob it (then i-1 must be skipped)', 'return dp[n - 1]'],
      coins: ['dp = [0] + [inf] * amount        # dp[x] = fewest coins to make x', 'for x in range(1, amount + 1):', '    for c in coins:', '        if c <= x: dp[x] = min(dp[x], dp[x - c] + 1)', 'return dp[amount]'],
      stairs: ['dp[0] = 1; dp[1] = 1               # ways to stand on step 0 and 1', 'for i in range(2, n + 1):', '    dp[i] = dp[i - 1] + dp[i - 2]     # last move was 1 step or 2 steps', 'return dp[n]']
    };
    function frames(kind, a, amount) {
      var F = [], dp = [];
      function snap(line, msg, hl, input) { F.push({ a: a, dp: dp.slice(), hl: hl || {}, ih: input || {}, kind: kind, line: line, msg: msg }); }
      if (kind === 'robber') {
        if (!a.length) a = [2, 7, 9, 3, 1];
        var n = a.length;
        dp = a.map(function () { return null; });
        snap([], 'You cannot rob two adjacent houses. Maximise the total. dp[i] = best total using houses 0..i.');
        dp[0] = a[0]; snap(0, 'dp[0] = ' + a[0] + ' (only one house).', { 0: 'ok' }, { 0: 'a' });
        if (n > 1) { dp[1] = Math.max(a[0], a[1]); snap(0, 'dp[1] = max(' + a[0] + ', ' + a[1] + ') = ' + dp[1] + '.', { 1: 'ok' }, { 0: 'b', 1: 'b' }); }
        for (var i = 2; i < n; i++) {
          var skip = dp[i - 1], take = dp[i - 2] + a[i]; dp[i] = Math.max(skip, take);
          var h = {}; h[i - 1] = 'b'; h[i - 2] = 'b'; h[i] = 'ok'; var ih = {}; ih[i] = 'a';
          snap([2, 3], 'House ' + i + ': skip it (' + skip + ') or rob it (' + dp[i - 2] + ' + ' + a[i] + ' = ' + take + '). dp[' + i + '] = ' + dp[i] + '.', h, ih);
        }
        // reconstruct
        var chosen = {}, k = n - 1;
        while (k >= 0) { if (k === 0 || dp[k] !== dp[k - 1]) { chosen[k] = 'ok'; k -= 2; } else k--; }
        snap(4, 'Best total: ' + dp[n - 1] + '. Walking back through the table shows which houses to rob (green). O(n) time, and O(1) space if only the last two values are kept.', {}, chosen);
      } else if (kind === 'coins') {
        a = a.filter(function (c) { return c > 0; }); if (!a.length) a = [1, 3, 4];
        dp = [0]; for (var x = 1; x <= amount; x++) dp.push(null);
        snap(0, 'Coins ' + a.join(', ') + '. dp[x] = the fewest coins that make amount x. dp[0] = 0.', { 0: 'ok' });
        for (x = 1; x <= amount; x++) {
          var best = Infinity, from = -1;
          a.forEach(function (c) { if (c <= x && dp[x - c] !== null && dp[x - c] !== Infinity && dp[x - c] + 1 < best) { best = dp[x - c] + 1; from = c; } });
          dp[x] = best;
          var h2 = {}; h2[x] = best === Infinity ? 'c' : 'ok'; if (from > 0) h2[x - from] = 'b';
          snap(3, best === Infinity ? 'Amount ' + x + ' cannot be made.' : 'Amount ' + x + ': best is dp[' + (x - from) + '] + one ' + from + '-coin = ' + best + ' coin(s).', h2);
        }
        snap(4, dp[amount] === Infinity ? 'Amount ' + amount + ' is impossible.' : 'Answer: ' + dp[amount] + ' coins for ' + amount + '. O(amount × coins). Note a greedy "biggest coin first" can fail (coins 1, 3, 4 and amount 6: greedy gives 4+1+1, DP finds 3+3).', (function () { var q = {}; q[amount] = 'ok'; return q; })());
      } else {
        var m = amount; dp = [1, 1]; for (var s = 2; s <= m; s++) dp.push(null);
        snap(0, 'Climb ' + m + ' steps, taking 1 or 2 at a time. How many different ways? dp[i] = ways to reach step i.', { 0: 'ok', 1: 'ok' });
        for (s = 2; s <= m; s++) { dp[s] = dp[s - 1] + dp[s - 2]; var h3 = {}; h3[s - 1] = 'b'; h3[s - 2] = 'b'; h3[s] = 'ok'; snap(2, 'dp[' + s + '] = dp[' + (s - 1) + '] + dp[' + (s - 2) + '] = ' + dp[s] + '.', h3); }
        snap(3, dp[m] + ' ways. This is the Fibonacci sequence again: the same recurrence as the naive recursion, but each value computed once, O(n).', (function () { var q = {}; q[m] = 'ok'; return q; })());
      }
      return F;
    }
    function render(f, ctx) {
      if (f.kind === 'robber') DSA.cells(ctx.stage, f.a, { marks: f.ih, label: 'money in each house' });
      DSA.cells(ctx.stage, f.dp.map(function (v) { return v === null ? '' : v === Infinity ? '∞' : v; }), { marks: f.hl, label: 'dp table' });
    }
    var p = DSA.player('#d1-demo', [], render, {});
    function build() {
      var k = $('#d1-kind').val();
      $('#d1-arr-wrap').toggle(k !== 'stairs'); $('#d1-amt-wrap').toggle(k !== 'robber');
      p.set(frames(k, DSA.parseNums($('#d1-arr').val(), 14).filter(function (x) { return x >= 0; }), Math.max(2, Math.min(22, +$('#d1-amt').val()))), CODES[k]);
    }
    $('#d1-kind').on('change', function () {
      var d = { robber: ['2, 7, 9, 3, 1, 5, 4', 0], coins: ['1, 3, 4', 6], stairs: ['', 8] }[this.value];
      $('#d1-arr').val(d[0]); $('#d1-amt').val(d[1]); build();
    });
    $('#d1-run').on('click', build);
    build();
  })();

  // ================================================================== 2-D string DP: LCS / edit distance
  (function () {
    var CODES = {
      lcs: ['dp[i][0] = dp[0][j] = 0', 'for i in 1..n, j in 1..m:', '    if s[i-1] == t[j-1]: dp[i][j] = dp[i-1][j-1] + 1      # extend a match', '    else: dp[i][j] = max(dp[i-1][j], dp[i][j-1])          # drop a char from one string'],
      edit: ['dp[i][0] = i; dp[0][j] = j            # delete / insert everything', 'for i in 1..n, j in 1..m:', '    if s[i-1] == t[j-1]: dp[i][j] = dp[i-1][j-1]          # no cost', '    else: dp[i][j] = 1 + min(dp[i-1][j],      # delete', '                             dp[i][j-1],      # insert', '                             dp[i-1][j-1])    # replace']
    };
    function frames(kind, s, t) {
      s = s.slice(0, 9); t = t.slice(0, 9);
      var n = s.length, m = t.length, dp = [], F = [], i, j;
      for (i = 0; i <= n; i++) { dp.push([]); for (j = 0; j <= m; j++) dp[i].push(i === 0 || j === 0 ? (kind === 'lcs' ? 0 : i + j) : null); }
      function snap(line, msg, marks) { F.push({ dp: DSA.clone(dp), marks: marks || {}, s: s, t: t, line: line, msg: msg }); }
      snap(0, kind === 'lcs' ? 'Longest common subsequence of "' + s + '" and "' + t + '". dp[i][j] = LCS length of the first i letters of s and the first j letters of t.' : 'Edit distance (Levenshtein) from "' + s + '" to "' + t + '": fewest inserts, deletes and replacements. First row and column: build from / reduce to the empty string.');
      for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
        var mk = {}, same = s[i - 1] === t[j - 1];
        if (kind === 'lcs') {
          if (same) { dp[i][j] = dp[i - 1][j - 1] + 1; mk[(i - 1) + ',' + (j - 1)] = 'b'; }
          else { dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); mk[(i - 1) + ',' + j] = 'b'; mk[i + ',' + (j - 1)] = 'b'; }
        } else {
          if (same) { dp[i][j] = dp[i - 1][j - 1]; mk[(i - 1) + ',' + (j - 1)] = 'b'; }
          else { dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]); mk[(i - 1) + ',' + j] = 'b'; mk[i + ',' + (j - 1)] = 'b'; mk[(i - 1) + ',' + (j - 1)] = 'b'; }
        }
        mk[i + ',' + j] = same ? 'ok' : 'a';
        snap(same ? 2 : [3, 4, 5], '"' + s[i - 1] + '" vs "' + t[j - 1] + '": ' + (same ? 'same letter. ' : 'different. ') + 'dp[' + i + '][' + j + '] = ' + dp[i][j] + '.', mk);
      }
      // traceback
      var path = {}, ops = [], lcs = '';
      i = n; j = m;
      while (i > 0 || j > 0) {
        path[i + ',' + j] = 'p';
        if (kind === 'lcs') {
          if (i > 0 && j > 0 && s[i - 1] === t[j - 1]) { lcs = s[i - 1] + lcs; i--; j--; }
          else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) i--; else j--;
        } else {
          if (i > 0 && j > 0 && s[i - 1] === t[j - 1] && dp[i][j] === dp[i - 1][j - 1]) { i--; j--; }
          else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { ops.unshift('replace ' + s[i - 1] + '→' + t[j - 1]); i--; j--; }
          else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { ops.unshift('delete ' + s[i - 1]); i--; }
          else { ops.unshift('insert ' + t[j - 1]); j--; }
        }
      }
      path['0,0'] = 'p';
      snap([], kind === 'lcs' ? 'LCS length ' + dp[n][m] + ': "' + lcs + '". Tracing back from the bottom-right (purple) recovers it. O(n·m) time and space.' : 'Distance ' + dp[n][m] + ': ' + (ops.join(', ') || 'the strings are equal') + '. Purple shows the traced-back path. O(n·m).', path);
      return F;
    }
    function render(f, ctx) {
      DSA.grid(ctx.stage, f.dp, { marks: f.marks, rowHead: ['∅'].concat(f.s.split('')), colHead: ['∅'].concat(f.t.split('')), corner: 's \\ t' });
    }
    var p = DSA.player('#d2-demo', [], render, { speed: 300 });
    function build() { var k = $('#d2-kind').val(); p.set(frames(k, $('#d2-s').val() || 'a', $('#d2-t').val() || 'b'), CODES[k]); }
    $('#d2-kind').on('change', function () { var d = { lcs: ['ABCBDAB', 'BDCABA'], edit: ['kitten', 'sitting'] }[this.value]; $('#d2-s').val(d[0]); $('#d2-t').val(d[1]); build(); });
    $('#d2-run').on('click', build);
    build();
  })();

  // ================================================================== 0/1 knapsack
  (function () {
    var CODE = ['dp[i][c] = best value using the first i items with capacity c', 'for i in 1..n:', '    for c in 0..W:', '        dp[i][c] = dp[i-1][c]                                  # skip item i', '        if w[i] <= c: dp[i][c] = max(dp[i][c], dp[i-1][c-w[i]] + v[i])   # take it'];
    function frames(items, W) {
      var n = items.length, dp = [], F = [], i, c;
      for (i = 0; i <= n; i++) { dp.push([]); for (c = 0; c <= W; c++) dp[i].push(i === 0 ? 0 : null); }
      function snap(line, msg, marks) { F.push({ dp: DSA.clone(dp), marks: marks || {}, line: line, msg: msg }); }
      snap(0, 'Each item can be taken once. Row i considers items 1..i; column c is the capacity. Row 0 (no items) is all zeros.');
      for (i = 1; i <= n; i++) {
        var w = items[i - 1][0], v = items[i - 1][1];
        for (c = 0; c <= W; c++) {
          var mk = {}; mk[(i - 1) + ',' + c] = 'b'; dp[i][c] = dp[i - 1][c];
          var took = false;
          if (w <= c && dp[i - 1][c - w] + v > dp[i][c]) { dp[i][c] = dp[i - 1][c - w] + v; took = true; mk[(i - 1) + ',' + (c - w)] = 'p'; }
          mk[i + ',' + c] = took ? 'ok' : 'a';
          if (c === W || took || c === w) snap(took ? 4 : 3, 'Item ' + i + ' (weight ' + w + ', value ' + v + '), capacity ' + c + ': ' + (took ? 'take it: ' + dp[i - 1][c - w] + ' + ' + v + ' = ' + dp[i][c] + ' beats skipping (' + dp[i - 1][c] + ').' : (w > c ? 'too heavy: copy the value from the row above (' + dp[i][c] + ').' : 'skipping is at least as good (' + dp[i][c] + ').')), mk);
        }
      }
      var chosen = [], marks = {}; c = W;
      for (i = n; i >= 1; i--) { if (dp[i][c] !== dp[i - 1][c]) { chosen.unshift(i); marks[i + ',' + c] = 'ok'; c -= items[i - 1][0]; } else marks[i + ',' + c] = 'p'; }
      snap([], 'Best value ' + dp[n][W] + ' with items ' + chosen.join(', ') + '. Trace back: if a value differs from the one above, that item was taken. O(n·W); with one row updated right-to-left, O(W) memory.', marks);
      return F;
    }
    function render(f, ctx) {
      var items = window.__ks;
      DSA.grid(ctx.stage, f.dp, { marks: f.marks, rowHead: ['none'].concat(items.map(function (it, i) { return (i + 1) + ': w' + it[0] + ' v' + it[1]; })), colHead: f.dp[0].map(function (_, c) { return c; }), corner: 'item \\ cap' });
    }
    function parse() {
      var items = $('#ks-items').val().split(/[;|]/).map(function (p) { var x = DSA.parseNums(p); return x.length >= 2 ? [Math.max(1, x[0]), x[1]] : null; }).filter(Boolean).slice(0, 6);
      return items.length ? items : [[1, 1], [3, 4], [4, 5], [5, 7]];
    }
    window.__ks = parse();
    var p = DSA.player('#ks-demo', frames(window.__ks, 7), render, { code: CODE, speed: 300 });
    $('#ks-run').on('click', function () { window.__ks = parse(); p.set(frames(window.__ks, Math.max(1, Math.min(12, +$('#ks-w').val())))); });
  })();

  // ================================================================== LIS with patience sorting
  (function () {
    var CODE = ['tails = []        # tails[k] = smallest tail of an increasing subsequence of length k+1', 'for x in a:', '    k = bisect_left(tails, x)', '    if k == len(tails): tails.append(x)   # extends the longest one', '    else: tails[k] = x                    # a better (smaller) tail for length k+1', 'return len(tails)'];
    function frames(a) {
      var F = [], tails = [];
      F.push({ a: a, tails: [], am: {}, tm: {}, line: 0, msg: 'Longest increasing subsequence in O(n log n). Keep, for each length, the smallest possible last value: smaller tails leave more room to extend later.' });
      a.forEach(function (x, i) {
        var lo = 0, hi = tails.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
        var am = {}, tm = {}; am[i] = 'a';
        if (lo === tails.length) { tails.push(x); tm[lo] = 'ok'; F.push({ a: a, tails: tails.slice(), am: am, tm: tm, line: 3, msg: x + ' is larger than every tail: it extends the longest subsequence. Length is now ' + tails.length + '.' }); }
        else { var old = tails[lo]; tails[lo] = x; tm[lo] = 'b'; F.push({ a: a, tails: tails.slice(), am: am, tm: tm, line: [2, 4], msg: 'Binary search: ' + x + ' replaces ' + old + ' as the tail of length ' + (lo + 1) + ' (same length, smaller ending).' }); }
      });
      F.push({ a: a, tails: tails, am: {}, tm: {}, line: 5, msg: 'LIS length = ' + tails.length + '. (The tails array itself is not necessarily a valid subsequence; store parent links to rebuild one.) The O(n²) DP: dp[i] = 1 + max(dp[j]) over j < i with a[j] < a[i].' });
      return F;
    }
    function render(f, ctx) { DSA.cells(ctx.stage, f.a, { marks: f.am, label: 'input' }); DSA.cells(ctx.stage, f.tails, { marks: f.tm, label: 'tails (index k = length k+1)' }); }
    var p = DSA.player('#lis-demo', frames([10, 9, 2, 5, 3, 7, 101, 18, 4, 20]), render, { code: CODE });
    $('#lis-run').on('click', function () { var a = DSA.parseNums($('#lis-arr').val(), 16); if (a.length) p.set(frames(a)); });
  })();
});

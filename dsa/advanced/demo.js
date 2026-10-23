$(function () {
  'use strict';

  // ================================================================== trie
  (function () {
    var CODE = ['def insert(word):', '    node = root', '    for ch in word:', '        if ch not in node.children: node.children[ch] = Node()   # new branch', '        node = node.children[ch]', '    node.end = True', 'def starts_with(prefix): walk the prefix; every word below that node matches'];
    function frames(words, query) {
      var root = { label: 'root', id: '^', children: [], end: false }, F = [];
      function find(n, ch) { for (var i = 0; i < n.children.length; i++) if (n.children[i].ch === ch) return n.children[i]; return null; }
      function view() {                                   // copy of the trie with "•" on nodes where a word ends
        var c = DSA.clone(root);
        (function w(n) { if (n.end) n.label = n.label + '•'; n.children.forEach(w); })(c);
        return c;
      }
      function snap(line, msg, marks) { F.push({ root: view(), marks: marks || {}, line: line, msg: msg }); }
      snap([], 'A trie stores strings character by character; words that share a prefix share a path. A • marks a node where a word ends. Insert: ' + words.join(', ') + '.');
      words.forEach(function (w) {
        var n = root, marks = {}, created = 0;
        for (var i = 0; i < w.length; i++) {
          var c = find(n, w[i]);
          if (!c) { c = { label: w[i], ch: w[i], id: n.id + w[i], children: [], end: false }; n.children.push(c); n.children.sort(function (a, b) { return a.ch < b.ch ? -1 : 1; }); created++; marks[c.id] = 'ok'; }
          else marks[c.id] = 'a';
          n = c;
        }
        n.end = true;
        snap([2, 3, 4, 5], 'Insert "' + w + '": ' + (created ? 'reused ' + (w.length - created) + ' existing node(s) (blue), created ' + created + ' new one(s) (green).' : 'every node already existed; just mark the end of the word.') + ' O(length of the word).', marks);
      });
      if (query) {
        var n2 = root, path = {}, ok = true;
        for (var j = 0; j < query.length; j++) { var c2 = find(n2, query[j]); if (!c2) { ok = false; break; } path[c2.id] = 'b'; n2 = c2; }
        if (!ok) snap(6, 'Search "' + query + '": no edge for "' + query[j] + '" after "' + query.slice(0, j) + '". No word starts with "' + query + '".', path);
        else {
          var found = [];
          (function collect(n, s) { if (n.end) found.push(s); n.children.forEach(function (c) { collect(c, s + c.ch); }); })(n2, query);
          var m = $.extend({}, path); (function mark(n) { n.children.forEach(function (c) { m[c.id] = 'p'; mark(c); }); })(n2);
          snap(6, 'Search "' + query + '": ' + (n2.end ? 'it is a stored word. ' : 'it is a prefix but not a stored word. ') + 'Words with this prefix (purple subtree): ' + (found.join(', ') || 'none') + '. Autocomplete works exactly like this.', m);
        }
      }
      return F;
    }
    function render(f, ctx) { DSA.ntree(ctx.stage, f.root, { marks: f.marks }); }
    var p = DSA.player('#trie-demo', [], render, { code: CODE });
    function build() { var ws = $('#trie-words').val().toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 10).map(function (w) { return w.slice(0, 8); }); p.set(frames(ws, $.trim($('#trie-q').val().toLowerCase()))); }
    $('#trie-run').on('click', build);
    build();
  })();

  // ================================================================== union-find
  (function () {
    var CODE = ['def find(x):', '    if parent[x] != x: parent[x] = find(parent[x])   # path compression', '    return parent[x]', 'def union(a, b):', '    ra, rb = find(a), find(b)', '    if ra == rb: return False                     # already connected', '    if rank[ra] < rank[rb]: ra, rb = rb, ra', '    parent[rb] = ra                                # attach the shorter tree under the taller', '    if rank[ra] == rank[rb]: rank[ra] += 1'];
    function frames(n, ops) {
      var parent = [], rank = [], F = [], i;
      for (i = 0; i < n; i++) { parent.push(i); rank.push(0); }
      function forest() {
        var nodes = {}; for (var k = 0; k < n; k++) nodes[k] = { label: String(k), id: 'u' + k, children: [] };
        var roots = [];
        for (k = 0; k < n; k++) { if (parent[k] === k) roots.push(nodes[k]); else nodes[parent[k]].children.push(nodes[k]); }
        return roots;
      }
      function snap(line, msg, marks) { F.push({ roots: DSA.clone(forest()), parent: parent.slice(), rank: rank.slice(), marks: marks || {}, line: line, msg: msg }); }
      function find(x, marks, pathOut) {
        var path = [];
        while (parent[x] !== x) { path.push(x); marks['u' + x] = 'b'; x = parent[x]; }
        marks['u' + x] = 'ok';
        if (pathOut) pathOut.push.apply(pathOut, path);
        return x;
      }
      snap([], n + ' elements, each in its own set (its own tree). parent[x] = x means x is a root, the set\'s representative.');
      ops.forEach(function (op) {
        var m = {}, path = [];
        if (op[0] === 'find') {
          var r = find(op[1], m, path);
          snap([0, 2], 'find(' + op[1] + '): follow parent links up to the root ' + r + (path.length > 1 ? ' (path: ' + path.concat([r]).join(' → ') + ').' : '.'), m);
          if (path.length > 1) { path.forEach(function (x) { parent[x] = r; }); var m2 = {}; path.forEach(function (x) { m2['u' + x] = 'p'; }); m2['u' + r] = 'ok'; snap(1, 'Path compression: point every node on that path directly at the root. Later finds are almost instant.', m2); }
          return;
        }
        var a = op[1], b = op[2], ma = {}, pa = [], pb = [], ra = find(a, ma, pa), rb = find(b, ma, pb);
        snap(4, 'union(' + a + ', ' + b + '): find their roots: ' + ra + ' and ' + rb + '.', ma);
        pa.forEach(function (x) { parent[x] = ra; }); pb.forEach(function (x) { parent[x] = rb; });   // these finds compress paths too
        if (ra === rb) { snap(5, a + ' and ' + b + ' are already in the same set. Nothing to do (in Kruskal, this edge would make a cycle).', ma); return; }
        if (rank[ra] < rank[rb]) { var t = ra; ra = rb; rb = t; }
        parent[rb] = ra; if (rank[ra] === rank[rb]) rank[ra]++;
        var mm = {}; mm['u' + ra] = 'ok'; mm['u' + rb] = 'a';
        snap([7, 8], 'Attach root ' + rb + ' under root ' + ra + ' (union by rank keeps the trees shallow). The two sets are now one.', mm);
      });
      snap([], 'With union by rank and path compression, each operation costs O(α(n)) amortised, where the inverse Ackermann function α(n) is at most 4 for any realistic n: effectively constant.');
      return F;
    }
    function parseOps(s) {
      return s.split(/[;\n]/).map(function (p) {
        var t = p.trim().toLowerCase().split(/[\s,()]+/).filter(Boolean);
        if (t[0] === 'union' && t.length >= 3) return ['union', +t[1], +t[2]];
        if (t[0] === 'find' && t.length >= 2) return ['find', +t[1]];
        return null;
      }).filter(function (o) { return o && o.slice(1).every(function (x) { return x >= 0 && x < 10; }); }).slice(0, 14);
    }
    function render(f, ctx) {
      var $row = $('<div>').css({ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }).appendTo(ctx.stage);
      DSA.ntree($row, f.roots, { marks: f.marks });
      DSA.cells(ctx.stage, f.parent, { label: 'parent[x]' });
    }
    var p = DSA.player('#uf-demo', [], render, { code: CODE });
    function build() { p.set(frames(10, parseOps($('#uf-ops').val()))); }
    $('#uf-run').on('click', build);
    build();
  })();

  // ================================================================== segment tree
  (function () {
    var CODES = {
      query: ['def query(node, l, r, ql, qr):', '    if qr < l or r < ql: return 0            # no overlap', '    if ql <= l and r <= qr: return tree[node]  # total overlap: use the stored sum', '    m = (l + r) // 2                         # partial overlap: ask both children', '    return query(2*node, l, m, ql, qr) + query(2*node+1, m+1, r, ql, qr)'],
      update: ['def update(node, l, r, i, value):', '    if l == r: tree[node] = value; return', '    m = (l + r) // 2', '    if i <= m: update(2*node, l, m, i, value)', '    else: update(2*node+1, m+1, r, i, value)', '    tree[node] = tree[2*node] + tree[2*node+1]   # fix sums on the way back up']
    };
    function build(a) {
      return (function b(l, r) {
        if (l === r) return { v: a[l], id: l + '-' + r, lo: l, hi: r, l: null, r: null };
        var m = (l + r) >> 1, L = b(l, m), R = b(m + 1, r);
        return { v: L.v + R.v, id: l + '-' + r, lo: l, hi: r, l: L, r: R };
      })(0, a.length - 1);
    }
    function labels(root) { var L = {}; (function w(n) { if (!n) return; L[n.id] = n.lo === n.hi ? '[' + n.lo + ']' : '[' + n.lo + '..' + n.hi + ']'; w(n.l); w(n.r); })(root); return L; }
    function frames(a, op, x, y) {
      var root = build(a), F = [], marks = {}, total = 0;
      function snap(line, msg) { F.push({ tree: DSA.clone(root), marks: $.extend({}, marks), labels: labels(root), a: a.slice(), line: line, msg: msg }); }
      snap([], 'Each node stores the sum of its range (shown underneath). Leaves are the array elements; the root covers everything. Building takes O(n).');
      if (op === 'query') {
        var ql = Math.max(0, Math.min(x, y)), qr = Math.min(a.length - 1, Math.max(x, y));
        (function q(n) {
          if (n.hi < ql || qr < n.lo) { marks[n.id] = 'dim'; snap(1, 'Node ' + labels(root)[n.id] + ' does not overlap [' + ql + '..' + qr + ']: contributes 0, stop here.'); return; }
          if (ql <= n.lo && n.hi <= qr) { marks[n.id] = 'ok'; total += n.v; snap(2, 'Node ' + labels(root)[n.id] + ' lies completely inside the query: take its stored sum ' + n.v + ' without going deeper. Running total ' + total + '.'); return; }
          marks[n.id] = 'a'; snap(3, 'Node ' + labels(root)[n.id] + ' partly overlaps: ask both children.');
          q(n.l); q(n.r);
        })(root);
        snap(4, 'sum(a[' + ql + '..' + qr + ']) = ' + total + '. Only O(log n) nodes were needed (green), never more than about 4 per level.');
      } else {
        var i = Math.max(0, Math.min(x, a.length - 1)), path = [];
        (function u(n) { path.push(n); marks[n.id] = 'b'; if (n.lo === n.hi) return; if (i <= ((n.lo + n.hi) >> 1)) u(n.l); else u(n.r); })(root);
        snap([3, 4], 'Update a[' + i + '] to ' + y + ': walk from the root down to that leaf (orange): one node per level.');
        a[i] = y;
        for (var k = path.length - 1; k >= 0; k--) { var n2 = path[k]; n2.v = n2.l ? n2.l.v + n2.r.v : y; marks[n2.id] = 'ok'; snap(k === path.length - 1 ? 1 : 5, 'Recompute ' + labels(root)[n2.id] + ' = ' + n2.v + '.'); }
        snap([], 'Updated in O(log n). Compare: a prefix-sum array answers queries in O(1) but needs O(n) per update; the segment tree is O(log n) for both.');
      }
      return F;
    }
    function render(f, ctx) {
      DSA.tree(ctx.stage, f.tree, { marks: f.marks, labels: f.labels, dx: 44, r: 17 });
      DSA.cells(ctx.stage, f.a, { label: 'array' });
    }
    var p = DSA.player('#seg-demo', [], render, {});
    function run() {
      var op = $('#seg-op').val(), a = DSA.parseNums($('#seg-arr').val(), 12);
      if (!a.length) a = [5, 2, 6, 1, 7, 3, 8, 4];
      $('#seg-y-lbl').text(op === 'query' ? 'r' : 'new value'); $('#seg-x-lbl').text(op === 'query' ? 'l' : 'index');
      p.set(frames(a, op, +$('#seg-x').val(), +$('#seg-y').val()), CODES[op]);
    }
    $('#seg-op').on('change', function () { if (this.value === 'query') { $('#seg-x').val(2); $('#seg-y').val(6); } else { $('#seg-x').val(3); $('#seg-y').val(10); } run(); });
    $('#seg-run').on('click', run);
    run();
  })();
});

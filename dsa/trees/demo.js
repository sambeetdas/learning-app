$(function () {
  'use strict';

  function N(v) { return { v: v, l: null, r: null }; }
  function bstInsert(root, v) {
    if (!root) return N(v);
    var c = root;
    while (true) {
      if (v === c.v) return root;
      if (v < c.v) { if (!c.l) { c.l = N(v); return root; } c = c.l; }
      else { if (!c.r) { c.r = N(v); return root; } c = c.r; }
    }
  }
  function build(vals) { var r = null; vals.forEach(function (v) { r = bstInsert(r, v); }); return r; }
  function height(n) { return n ? 1 + Math.max(height(n.l), height(n.r)) : 0; }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }

  // ================================================================== traversals
  (function () {
    var CODES = {
      pre: ['def preorder(node):', '    if not node: return', '    visit(node)                # node first', '    preorder(node.left)', '    preorder(node.right)'],
      'in': ['def inorder(node):', '    if not node: return', '    inorder(node.left)', '    visit(node)                # between the subtrees', '    inorder(node.right)'],
      post: ['def postorder(node):', '    if not node: return', '    postorder(node.left)', '    postorder(node.right)', '    visit(node)                # node last'],
      level: ['q = deque([root])', 'while q:', '    node = q.popleft()', '    visit(node)', '    if node.left: q.append(node.left)', '    if node.right: q.append(node.right)']
    };
    var NOTE = { pre: 'Preorder (node, left, right): copies a tree, prints a folder structure, serialises.', 'in': 'Inorder (left, node, right): on a BST this gives the values in sorted order.', post: 'Postorder (left, right, node): children before parents. Deleting a tree, computing folder sizes, evaluating expression trees.', level: 'Level order (breadth-first): level by level using a queue. Shortest paths in trees, printing by depth.' };
    function frames(root, kind) {
      var F = [], out = [], stack = [], marks = {};
      function snap(line, msg, cur) {
        var m = $.extend({}, marks); stack.forEach(function (v) { if (m[v] !== 'ok') m[v] = 'b'; }); if (cur !== undefined) m[cur] = 'a';
        F.push({ tree: root, marks: m, out: out.slice(), aux: stack.slice(), auxName: kind === 'level' ? 'queue' : 'call stack', line: line, msg: msg });
      }
      snap([], NOTE[kind]);
      if (kind === 'level') {
        var q = root ? [root] : []; stack = q.map(function (n) { return n.v; });
        while (q.length) {
          var n = q.shift(); stack = q.map(function (x) { return x.v; });
          out.push(n.v); marks[n.v] = 'ok';
          snap([2, 3], 'Dequeue ' + n.v + ' and visit it.', n.v);
          [n.l, n.r].forEach(function (c) { if (c) q.push(c); });
          stack = q.map(function (x) { return x.v; });
          if (n.l || n.r) snap([4, 5], 'Enqueue its children: ' + [n.l, n.r].filter(Boolean).map(function (c) { return c.v; }).join(', ') + '.', n.v);
        }
      } else {
        (function rec(n) {
          if (!n) return;
          stack.push(n.v);
          snap(0, 'Call on ' + n.v + ' (pushed on the call stack).', n.v);
          if (kind === 'pre') { out.push(n.v); marks[n.v] = 'ok'; snap(2, 'Visit ' + n.v + ' before its children.', n.v); }
          rec(n.l);
          if (kind === 'in') { out.push(n.v); marks[n.v] = 'ok'; snap(3, 'Left subtree of ' + n.v + ' done: visit ' + n.v + '.', n.v); }
          rec(n.r);
          if (kind === 'post') { out.push(n.v); marks[n.v] = 'ok'; snap(4, 'Both subtrees of ' + n.v + ' done: visit ' + n.v + '.', n.v); }
          stack.pop();
        })(root);
      }
      snap([], 'Result: ' + out.join(', ') + '. Every node is visited once: O(n) time; O(h) space for the stack (h = height) or O(width) for the queue.');
      return F;
    }
    function render(f, ctx) {
      DSA.tree(ctx.stage, f.tree, { marks: f.marks });
      DSA.cells(ctx.stage, f.out, { label: 'visit order', noIndex: true });
      DSA.cells(ctx.stage, f.aux, { label: f.auxName + (f.auxName === 'queue' ? ' (front on the left)' : ' (bottom on the left)'), noIndex: true });
    }
    var root = build([50, 30, 70, 20, 40, 60, 80, 35, 45]);
    var p = DSA.player('#tr-demo', frames(root, 'in'), render, { code: CODES['in'], speed: 800 });
    $('#tr-kind').on('change', function () { p.set(frames(root, this.value), CODES[this.value]); });
  })();

  // ================================================================== BST operations
  (function () {
    var CODES = {
      insert: ['node = root', 'while True:', '    if x < node.val:', '        if not node.left: node.left = Node(x); break', '        node = node.left', '    else:', '        if not node.right: node.right = Node(x); break', '        node = node.right'],
      search: ['node = root', 'while node:', '    if x == node.val: return node', '    node = node.left if x < node.val else node.right', 'return None'],
      del: ['find the node with value x', 'if it has no children: remove it', 'elif it has one child: replace it by that child', 'else:   # two children', '    s = leftmost node of its right subtree   # inorder successor', '    copy s.val into the node; delete s from the right subtree']
    };
    function frames(vals, op, x) {
      var root = build(vals), F = [], c, m;
      function snap(line, msg, mk) { F.push({ tree: DSA.clone(root), marks: mk || {}, line: line, msg: msg }); }
      snap([], 'A binary search tree: for every node, everything in the left subtree is smaller and everything in the right subtree is larger.');
      if (op === 'insert' || op === 'search') {
        c = root; m = {};
        while (c) {
          m[c.v] = 'a';
          if (x === c.v) { m[c.v] = op === 'search' ? 'ok' : 'b'; snap(2, op === 'search' ? 'Found ' + x + ' after ' + Object.keys(m).length + ' comparisons: one per level, O(h).' : x + ' is already in the tree; BSTs usually keep keys unique.', $.extend({}, m)); return F; }
          snap(op === 'search' ? 3 : (x < c.v ? 2 : 5), x + (x < c.v ? ' < ' : ' > ') + c.v + ': go ' + (x < c.v ? 'left' : 'right') + '.', $.extend({}, m));
          var nxt = x < c.v ? c.l : c.r;
          if (!nxt) break;
          c = nxt;
        }
        if (op === 'search') { snap(4, 'Reached an empty spot: ' + x + ' is not in the tree.', m); return F; }
        root = bstInsert(root, x); m[x] = 'ok';
        snap(x < c.v ? 3 : 6, 'Attach ' + x + ' as the ' + (x < c.v ? 'left' : 'right') + ' child of ' + c.v + '. Cost O(h): O(log n) if balanced, O(n) if the tree is a "stick".', m);
        return F;
      }
      // delete
      var parent = null; c = root; m = {};
      while (c && c.v !== x) { m[c.v] = 'a'; snap(0, 'Searching: ' + x + (x < c.v ? ' < ' : ' > ') + c.v + '.', $.extend({}, m)); parent = c; c = x < c.v ? c.l : c.r; }
      if (!c) { snap(0, x + ' is not in the tree.', m); return F; }
      m = {}; m[c.v] = 'c'; snap(0, 'Found ' + x + '.', m);
      function replace(p, oldN, newN) { if (!p) root = newN; else if (p.l === oldN) p.l = newN; else p.r = newN; }
      if (!c.l && !c.r) { replace(parent, c, null); snap(1, 'Case 1: ' + x + ' is a leaf. Just remove it.'); }
      else if (!c.l || !c.r) { var ch = c.l || c.r; replace(parent, c, ch); var mm = {}; mm[ch.v] = 'ok'; snap(2, 'Case 2: ' + x + ' has one child (' + ch.v + '). Link its parent directly to that child.', mm); }
      else {
        var sp = c, s = c.r; m = {}; m[c.v] = 'c';
        while (s.l) { m[s.v] = 'b'; sp = s; s = s.l; }
        m[s.v] = 'ok';
        snap(4, 'Case 3: two children. Find the inorder successor: the smallest value in the right subtree, ' + s.v + ' (go right once, then left as far as possible).', m);
        c.v = s.v;
        if (sp === c) sp.r = s.r; else sp.l = s.r;
        var m2 = {}; m2[c.v] = 'ok';
        snap(5, 'Copy ' + s.v + ' into the node and delete the successor from its old place (it has at most one child, so that is case 1 or 2). The BST order still holds.', m2);
      }
      return F;
    }
    function render(f, ctx) { DSA.tree(ctx.stage, f.tree, { marks: f.marks }); }
    var p = DSA.player('#bst-demo', [], render, {});
    function run() {
      var op = $('#bst-op').val();
      p.set(frames(uniq(DSA.parseNums($('#bst-vals').val(), 15)), op, +$('#bst-x').val()), CODES[op]);
    }
    $('#bst-op').on('change', function () {
      var d = { insert: 65, search: 45, del: 30 }[this.value]; $('#bst-x').val(d); run();
    });
    $('#bst-run').on('click', run);
    run();
  })();

  // ================================================================== AVL insertion with rotations
  (function () {
    var CODE = ['insert x as in a normal BST', 'walk back up from the new node:', '    update height; bf = height(left) - height(right)', '    if bf > 1 and x < node.left.val:  rotate_right(node)          # LL', '    if bf < -1 and x > node.right.val: rotate_left(node)          # RR', '    if bf > 1 and x > node.left.val:  rotate_left(node.left); rotate_right(node)   # LR', '    if bf < -1 and x < node.right.val: rotate_right(node.right); rotate_left(node) # RL'];
    function bfLabels(root) {
      var L = {};
      (function w(n) { if (!n) return; L[n.v] = height(n.l) - height(n.r); w(n.l); w(n.r); })(root);
      return L;
    }
    function rotR(y) { var x = y.l; y.l = x.r; x.r = y; return x; }
    function rotL(x) { var y = x.r; x.r = y.l; y.l = x; return y; }
    function frames(vals) {
      var root = null, F = [];
      function snap(line, msg, mk) { F.push({ tree: DSA.clone(root), labels: bfLabels(root), marks: mk || {}, line: line, msg: msg }); }
      snap([], 'An AVL tree keeps every node\'s balance factor (left height minus right height, shown under each node) in {-1, 0, 1}. Insert values and watch it fix itself.');
      vals.forEach(function (x) {
        if (!root) { root = N(x); snap(0, 'Insert ' + x + ' as the root.', (function () { var m = {}; m[x] = 'ok'; return m; })()); return; }
        var path = [], c = root;
        while (c) { path.push(c); if (x === c.v) { snap(0, x + ' is already present.'); return; } c = x < c.v ? c.l : c.r; }
        var par = path[path.length - 1], nn = N(x);
        if (x < par.v) par.l = nn; else par.r = nn;
        path.push(nn);
        var mk = {}; mk[x] = 'ok'; snap(0, 'Insert ' + x + ' like a normal BST insert.', mk);
        for (var i = path.length - 2; i >= 0; i--) {
          var node = path[i], bf = height(node.l) - height(node.r);
          if (Math.abs(bf) <= 1) continue;
          var bad = {}; bad[node.v] = 'c';
          var kind = bf > 1 ? (x < node.l.v ? 'LL' : 'LR') : (x > node.r.v ? 'RR' : 'RL');
          snap(2, 'Node ' + node.v + ' has balance factor ' + bf + ': out of balance (' + kind + ' case: the new value went ' + (kind[0] === 'L' ? 'left' : 'right') + ' then ' + (kind[1] === 'L' ? 'left' : 'right') + ').', bad);
          var parent = i > 0 ? path[i - 1] : null, sub;
          if (kind === 'LR') { node.l = rotL(node.l); snap(5, 'LR, step 1: rotate the left child left, turning it into an LL case.', bad); }
          if (kind === 'RL') { node.r = rotR(node.r); snap(6, 'RL, step 1: rotate the right child right, turning it into an RR case.', bad); }
          sub = (kind === 'LL' || kind === 'LR') ? rotR(node) : rotL(node);
          if (!parent) root = sub; else if (parent.l === node) parent.l = sub; else parent.r = sub;
          var good = {}; good[sub.v] = 'ok';
          snap({ LL: 3, RR: 4, LR: 5, RL: 6 }[kind], 'Rotate ' + (kind === 'LL' || kind === 'LR' ? 'right' : 'left') + ' around ' + node.v + ': ' + sub.v + ' moves up. The subtree is balanced again and BST order is preserved. One rotation (or double rotation) always fixes an insert.', good);
          break;
        }
      });
      snap([], 'Final height ' + height(root) + ' for ' + vals.length + ' keys. An AVL tree\'s height is at most about 1.44·log₂ n, so search, insert and delete are all O(log n). Inserting sorted data into a plain BST would have made a stick of height ' + vals.length + '.');
      return F;
    }
    function render(f, ctx) { DSA.tree(ctx.stage, f.tree, { marks: f.marks, labels: f.labels }); }
    var p = DSA.player('#avl-demo', frames([10, 20, 30, 40, 50, 25]), render, { code: CODE });
    $('#avl-run').on('click', function () { p.set(frames(uniq(DSA.parseNums($('#avl-vals').val(), 15)))); });
  })();
});

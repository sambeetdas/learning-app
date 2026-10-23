$(function () {
  'use strict';

  var POS = { A: [70, 70], B: [210, 40], C: [360, 60], D: [70, 210], E: [210, 170], F: [360, 200], G: [500, 110], H: [500, 250] };
  function nodes() { return Object.keys(POS).map(function (k) { return { id: k, x: POS[k][0], y: POS[k][1] }; }); }
  var UND = { nodes: nodes(), edges: [['A', 'B'], ['A', 'D'], ['B', 'C'], ['B', 'E'], ['D', 'E'], ['E', 'F'], ['C', 'G'], ['F', 'G'], ['F', 'H'], ['G', 'H']].map(function (e) { return { a: e[0], b: e[1] }; }) };
  var WG = { nodes: nodes(), edges: [['A', 'B', 4], ['A', 'D', 2], ['B', 'C', 5], ['B', 'E', 1], ['D', 'E', 7], ['E', 'F', 3], ['C', 'F', 4], ['C', 'G', 3], ['F', 'G', 6], ['F', 'H', 2], ['G', 'H', 1]].map(function (e) { return { a: e[0], b: e[1], w: e[2] }; }) };
  function adj(g) {
    var A = {}; g.nodes.forEach(function (n) { A[n.id] = []; });
    g.edges.forEach(function (e) { A[e.a].push({ to: e.b, w: e.w }); if (!g.directed) A[e.b].push({ to: e.a, w: e.w }); });
    Object.keys(A).forEach(function (k) { A[k].sort(function (x, y) { return x.to < y.to ? -1 : 1; }); });
    return A;
  }
  function ek(a, b) { return a + '-' + b; }

  // ================================================================== BFS / DFS
  (function () {
    var CODES = {
      bfs: ['q = deque([s]); seen = {s}; dist[s] = 0', 'while q:', '    u = q.popleft()', '    for v in adj[u]:', '        if v not in seen:', '            seen.add(v); dist[v] = dist[u] + 1', '            q.append(v)'],
      dfs: ['def dfs(u):', '    seen.add(u)', '    for v in adj[u]:', '        if v not in seen:', '            dfs(v)              # go deep first', '    # all neighbours done: backtrack']
    };
    function frames(kind, s) {
      var A = adj(UND), F = [], seen = {}, nm = {}, em = {}, labels = {}, aux = [], order = [];
      function snap(line, msg, cur, edge) {
        var n = $.extend({}, nm), e = $.extend({}, em);
        aux.forEach(function (x) { if (n[x] !== 'ok') n[x] = 'b'; }); if (cur) n[cur] = 'a'; if (edge) e[edge] = 'a';
        F.push({ nm: n, em: e, labels: $.extend({}, labels), aux: aux.slice(), order: order.slice(), line: line, msg: msg });
      }
      if (kind === 'bfs') {
        seen[s] = 1; labels[s] = 0; aux = [s];
        snap(0, 'BFS from ' + s + ': explore in rings of increasing distance. The number under a node is its distance (edges) from ' + s + '.');
        while (aux.length) {
          var u = aux.shift(); order.push(u); nm[u] = 'ok';
          snap(2, 'Dequeue ' + u + ' (distance ' + labels[u] + ').', u);
          A[u].forEach(function (x) {
            var v = x.to;
            if (!seen[v]) { seen[v] = 1; labels[v] = labels[u] + 1; aux.push(v); em[ek(u, v)] = 'ok'; snap([5, 6], v + ' is new: distance ' + labels[v] + '. Enqueue it.', u, ek(u, v)); }
            else snap(4, v + ' already seen; skip.', u, ek(u, v));
          });
        }
        snap([], 'BFS order: ' + order.join(', ') + '. Green edges form the BFS tree; following it back gives a shortest path (fewest edges) to every node. O(V + E).');
      } else {
        snap(0, 'DFS from ' + s + ': go as deep as possible, then back up. The call stack is shown below.');
        (function dfs(u) {
          seen[u] = 1; aux.push(u); order.push(u); nm[u] = 'ok';
          snap(1, 'Visit ' + u + ' (pushed on the call stack).', u);
          A[u].forEach(function (x) {
            var v = x.to;
            if (!seen[v]) { em[ek(u, v)] = 'ok'; snap([3, 4], 'Edge ' + u + '–' + v + ': ' + v + ' is unvisited, go deeper.', u, ek(u, v)); dfs(v); snap(2, 'Back at ' + u + '.', u); }
            else snap(3, 'Edge ' + u + '–' + v + ': ' + v + ' already visited.', u, ek(u, v));
          });
          aux.pop();
          snap(5, u + ' has no unvisited neighbours left: backtrack.', u);
        })(s);
        snap([], 'DFS order: ' + order.join(', ') + '. Green edges form the DFS tree. Used for connectivity, cycle detection, topological sort and backtracking. O(V + E).');
      }
      return F;
    }
    function render(f, ctx) {
      DSA.graph(ctx.stage, UND, { nodeMarks: f.nm, edgeMarks: f.em, labels: f.labels });
      DSA.cells(ctx.stage, f.aux, { label: $('#gt-kind').val() === 'bfs' ? 'queue (front on the left)' : 'call stack (bottom on the left)', noIndex: true });
      DSA.cells(ctx.stage, f.order, { label: 'visit order', noIndex: true });
    }
    var p = DSA.player('#gt-demo', [], render, {});
    function build() { var k = $('#gt-kind').val(); p.set(frames(k, $('#gt-start').val()), CODES[k]); }
    $('#gt-kind, #gt-start').on('change', build);
    build();
  })();

  // ================================================================== Dijkstra
  (function () {
    var CODE = ['dist = {all: inf}; dist[s] = 0; pq = [(0, s)]', 'while pq:', '    d, u = heappop(pq)', '    if d > dist[u]: continue           # stale entry', '    for v, w in adj[u]:', '        if d + w < dist[v]:                # relax the edge', '            dist[v] = d + w; prev[v] = u', '            heappush(pq, (dist[v], v))'];
    function frames(s) {
      var A = adj(WG), F = [], dist = {}, prev = {}, done = {}, pq = [[0, s]], em = {};
      WG.nodes.forEach(function (n) { dist[n.id] = Infinity; }); dist[s] = 0;
      function labels() { var L = {}; Object.keys(dist).forEach(function (k) { L[k] = dist[k] === Infinity ? '∞' : dist[k]; }); return L; }
      function snap(line, msg, cur, edge, edgeMark) {
        var nm = {}; Object.keys(done).forEach(function (k) { nm[k] = 'ok'; }); pq.forEach(function (x) { if (!done[x[1]]) nm[x[1]] = 'b'; }); if (cur) nm[cur] = 'a';
        var e = $.extend({}, em); if (edge) e[edge] = edgeMark || 'a';
        F.push({ nm: nm, em: e, labels: labels(), pq: pq.slice().sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1] + ':' + x[0]; }), line: line, msg: msg });
      }
      snap(0, 'Dijkstra from ' + s + ': all distances start at ∞ except the source. Always settle the closest unsettled node next (from a min-heap).');
      while (pq.length) {
        pq.sort(function (a, b) { return a[0] - b[0]; });
        var top = pq.shift(), d = top[0], u = top[1];
        if (done[u]) { snap(3, 'Pop (' + d + ', ' + u + '): ' + u + ' is already settled with a smaller distance. Skip this stale entry.'); continue; }
        done[u] = 1;
        snap(2, 'Pop ' + u + ' with distance ' + d + '. It is the closest unsettled node, so ' + d + ' is final: no later path can be shorter (weights are non-negative).', u);
        A[u].forEach(function (x) {
          var v = x.to; if (done[v]) return;
          var nd = d + x.w;
          if (nd < dist[v]) {
            var old = dist[v]; dist[v] = nd;
            if (prev[v]) delete em[ek(prev[v], v)], delete em[ek(v, prev[v])];
            prev[v] = u; em[ek(u, v)] = 'ok'; pq.push([nd, v]);
            snap([5, 6, 7], 'Relax ' + u + '→' + v + ': ' + d + ' + ' + x.w + ' = ' + nd + ' < ' + (old === Infinity ? '∞' : old) + '. Update ' + v + ' and push it.', u, ek(u, v), 'ok');
          } else snap(5, 'Edge ' + u + '→' + v + ': ' + d + ' + ' + x.w + ' = ' + nd + ' is not better than ' + dist[v] + '.', u, ek(u, v), 'c');
        });
      }
      snap([], 'All shortest distances from ' + s + ' are final. Green edges form the shortest-path tree. With a binary heap: O((V + E) log V).');
      return F;
    }
    function render(f, ctx) {
      DSA.graph(ctx.stage, WG, { nodeMarks: f.nm, edgeMarks: f.em, labels: f.labels });
      DSA.cells(ctx.stage, f.pq, { label: 'priority queue (node:distance), smallest first', noIndex: true });
    }
    var p = DSA.player('#dj-demo', frames('A'), render, { code: CODE });
    $('#dj-start').on('change', function () { p.set(frames(this.value)); });
  })();

  // ================================================================== topological sort (Kahn)
  (function () {
    var DAG = { directed: true, nodes: [
      { id: 'math', x: 60, y: 60 }, { id: 'prog', x: 60, y: 200 }, { id: 'dsa', x: 220, y: 130 }, { id: 'db', x: 220, y: 260 },
      { id: 'os', x: 380, y: 60 }, { id: 'web', x: 380, y: 230 }, { id: 'ml', x: 540, y: 130 }],
      edges: [['math', 'dsa'], ['prog', 'dsa'], ['prog', 'db'], ['dsa', 'os'], ['dsa', 'ml'], ['math', 'ml'], ['db', 'web'], ['os', 'web'], ['web', 'ml']].map(function (e) { return { a: e[0], b: e[1] }; }) };
    DAG.nodes.forEach(function (n) { n.label = n.id; });
    var CODE = ['indeg = count incoming edges of every node', 'q = deque(nodes with indeg 0)', 'while q:', '    u = q.popleft(); order.append(u)', '    for v in adj[u]:', '        indeg[v] -= 1                  # "remove" the edge', '        if indeg[v] == 0: q.append(v)', 'if len(order) < n: there is a cycle'];
    function frames() {
      var A = adj(DAG), indeg = {}, F = [], q = [], order = [], em = {}, done = {};
      DAG.nodes.forEach(function (n) { indeg[n.id] = 0; }); DAG.edges.forEach(function (e) { indeg[e.b]++; });
      function snap(line, msg, cur) {
        var nm = {}; Object.keys(done).forEach(function (k) { nm[k] = 'ok'; }); q.forEach(function (k) { nm[k] = 'b'; }); if (cur) nm[cur] = 'a';
        F.push({ nm: nm, em: $.extend({}, em), labels: $.extend({}, indeg), q: q.slice(), order: order.slice(), line: line, msg: msg });
      }
      snap(0, 'Courses with prerequisites (arrows point from prerequisite to course). The number under each node is its in-degree: how many prerequisites are still unfinished.');
      DAG.nodes.forEach(function (n) { if (!indeg[n.id]) q.push(n.id); });
      snap(1, 'Start with every node that has no prerequisites: ' + q.join(', ') + '.');
      while (q.length) {
        var u = q.shift(); order.push(u); done[u] = 1;
        snap(3, 'Take ' + u + ' and add it to the order.', u);
        A[u].forEach(function (x) {
          var v = x.to; indeg[v]--; em[ek(u, v)] = 'dim';
          if (!indeg[v]) { q.push(v); snap(6, 'Remove ' + u + '→' + v + ': ' + v + ' has no unfinished prerequisites left. Enqueue it.', u); }
          else snap(5, 'Remove ' + u + '→' + v + ': ' + v + ' still waits for ' + indeg[v] + ' more.', u);
        });
      }
      snap(7, 'A valid order: ' + order.join(' → ') + '. If some nodes never reached in-degree 0, the graph had a cycle and no order exists. O(V + E).');
      return F;
    }
    function render(f, ctx) {
      DSA.graph(ctx.stage, DAG, { nodeMarks: f.nm, edgeMarks: f.em, labels: f.labels });
      DSA.cells(ctx.stage, f.q, { label: 'queue of ready nodes', noIndex: true });
      DSA.cells(ctx.stage, f.order, { label: 'topological order', noIndex: true });
    }
    DSA.player('#topo-demo', frames(), render, { code: CODE });
  })();

  // ================================================================== Kruskal MST
  (function () {
    var CODE = ['sort edges by weight', 'uf = UnionFind(nodes)', 'for (u, v, w) in edges:', '    if uf.find(u) != uf.find(v):     # different components: no cycle', '        uf.union(u, v); mst.append((u, v, w))', '    # else: u and v already connected, the edge would make a cycle'];
    function frames() {
      var F = [], parent = {}, em = {}, total = 0, taken = 0, sorted = WG.edges.slice().sort(function (a, b) { return a.w - b.w; });
      WG.nodes.forEach(function (n) { parent[n.id] = n.id; });
      function find(x) { while (parent[x] !== x) x = parent[x]; return x; }
      function snap(line, msg, idx, mark) {
        var lab = {}; WG.nodes.forEach(function (n) { lab[n.id] = 'set ' + find(n.id); });
        var e = $.extend({}, em); if (idx !== undefined) e[ek(sorted[idx].a, sorted[idx].b)] = mark;
        var cm = {}; sorted.forEach(function (ed, i) { var k = ek(ed.a, ed.b); cm[i] = em[k] === 'ok' ? 'ok' : em[k] === 'dim' ? 'dim' : ''; }); if (idx !== undefined) cm[idx] = mark === 'ok' ? 'ok' : (mark === 'c' ? 'c' : 'a');
        F.push({ em: e, labels: lab, list: sorted.map(function (ed) { return ed.a + ed.b + ':' + ed.w; }), lm: cm, total: total, line: line, msg: msg });
      }
      snap(0, 'Kruskal: consider edges from cheapest to most expensive; take an edge unless it would create a cycle. Each node starts in its own set.');
      sorted.forEach(function (ed, i) {
        snap(3, 'Next cheapest edge: ' + ed.a + '–' + ed.b + ' (weight ' + ed.w + ').', i, 'a');
        var ra = find(ed.a), rb = find(ed.b);
        if (ra !== rb) { parent[ra] = rb; em[ek(ed.a, ed.b)] = 'ok'; total += ed.w; taken++; snap(4, ed.a + ' and ' + ed.b + ' are in different sets: take the edge and merge the sets. Total weight ' + total + '.', i, 'ok'); }
        else { em[ek(ed.a, ed.b)] = 'dim'; snap(5, ed.a + ' and ' + ed.b + ' are already connected: this edge would form a cycle. Skip it.', i, 'c'); }
      });
      snap([], 'Minimum spanning tree: ' + taken + ' edges (V - 1) with total weight ' + total + '. O(E log E) for the sort; union-find makes the cycle checks nearly O(1).');
      return F;
    }
    function render(f, ctx) {
      DSA.graph(ctx.stage, WG, { edgeMarks: f.em, labels: f.labels });
      DSA.cells(ctx.stage, f.list, { marks: f.lm, label: 'edges sorted by weight', noIndex: true });
    }
    DSA.player('#mst-demo', frames(), render, { code: CODE });
  })();

  // ================================================================== grid pathfinding: BFS vs A*
  (function () {
    var MAP = [
      'S.......#.......',
      '........#.......',
      '..####..#..###..',
      '.....#..#....#..',
      '.....#.......#..',
      '.....#####...#..',
      '.............#.G',
      '................'];
    function frames(kind, noCompare) {
      var R = MAP.length, C = MAP[0].length, S, G, F = [], open = [], seen = {}, prev = {}, g = {}, expanded = 0, closed = {};
      for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) { if (MAP[r][c] === 'S') S = [r, c]; if (MAP[r][c] === 'G') G = [r, c]; }
      function key(p) { return p[0] + ',' + p[1]; }
      function h(p) { return Math.abs(p[0] - G[0]) + Math.abs(p[1] - G[1]); }
      function snap(msg, path) {
        var rows = [], marks = {};
        for (var r = 0; r < R; r++) { rows.push([]); for (var c = 0; c < C; c++) {
          var k = r + ',' + c, ch = MAP[r][c];
          rows[r].push(ch === '#' ? '' : ch === 'S' ? 'S' : ch === 'G' ? 'G' : '');
          if (ch === '#') marks[k] = 'p'; else if (path && path[k]) marks[k] = 'ok'; else if (closed[k]) marks[k] = 'a'; else if (seen[k]) marks[k] = 'b';
        } }
        F.push({ rows: rows, marks: marks, expanded: expanded, msg: msg });
      }
      g[key(S)] = 0; seen[key(S)] = 1; open.push(S);
      snap(kind === 'bfs' ? 'BFS expands cells in order of distance from S, in every direction equally.' : 'A* expands the cell with the smallest f = g + h: steps taken so far (g) plus a straight-line guess of the steps left (h = Manhattan distance to G).');
      while (open.length) {
        var bi = 0;
        if (kind === 'astar') open.forEach(function (p, i) { var f1 = g[key(p)] + h(p), f2 = g[key(open[bi])] + h(open[bi]); if (f1 < f2 || (f1 === f2 && h(p) < h(open[bi]))) bi = i; });
        var cur = open.splice(bi, 1)[0], ck = key(cur);
        if (closed[ck]) continue;
        closed[ck] = 1; expanded++;
        if (cur[0] === G[0] && cur[1] === G[1]) break;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var n = [cur[0] + d[0], cur[1] + d[1]], nk = key(n);
          if (n[0] < 0 || n[1] < 0 || n[0] >= R || n[1] >= C || MAP[n[0]][n[1]] === '#' || closed[nk]) return;
          if (g[nk] === undefined || g[ck] + 1 < g[nk]) { g[nk] = g[ck] + 1; prev[nk] = ck; seen[nk] = 1; open.push(n); }
        });
        if (expanded % (kind === 'bfs' ? 3 : 2) === 0) snap('Expanded ' + expanded + ' cells. Orange = discovered (in the frontier), blue = expanded.');
      }
      var path = {}, k = key(G), len = 0;
      while (k) { path[k] = 1; k = prev[k]; len++; }
      var other = noCompare ? null : frames(kind === 'bfs' ? 'astar' : 'bfs', true), oc = other ? other[other.length - 1].expanded : 0;
      snap('Reached G: shortest path of ' + (len - 1) + ' steps (green), after expanding ' + expanded + ' cells. ' +
        (other ? (kind === 'bfs' ? 'A* finds an equally short path expanding ' + oc + ' cells.' : 'BFS needs ' + oc + ' expansions for the same path length; the heuristic steers A* towards G. In open areas the saving is much bigger than in a twisty maze.') : ''), path);
      return F;
    }
    function render(f, ctx) {
      DSA.grid(ctx.stage, f.rows, { marks: f.marks });
      $('<div class="readout">').html('Cells expanded: <b>' + f.expanded + '</b>').appendTo(ctx.stage);
    }
    var p = DSA.player('#pf-demo', frames('bfs'), render, { speed: 300 });
    $('#pf-kind').on('change', function () { p.set(frames(this.value)); });
  })();
});

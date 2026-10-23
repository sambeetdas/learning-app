$(function () {
  'use strict';

  // ================================================================== Tarjan SCC
  (function () {
    var G = { directed: true, nodes: [
      { id: '1', x: 60, y: 60 }, { id: '2', x: 200, y: 60 }, { id: '3', x: 130, y: 200 }, { id: '4', x: 340, y: 60 },
      { id: '5', x: 480, y: 60 }, { id: '6', x: 410, y: 200 }, { id: '7', x: 620, y: 60 }, { id: '8', x: 620, y: 200 }],
      edges: [['1', '2'], ['2', '3'], ['3', '1'], ['2', '4'], ['4', '5'], ['5', '6'], ['6', '4'], ['5', '7'], ['7', '8'], ['8', '7'], ['6', '8']].map(function (e) { return { a: e[0], b: e[1] }; }) };
    var CODE = ['def dfs(u):', '    disc[u] = low[u] = time; time += 1; stack.append(u)', '    for v in adj[u]:', '        if v not visited: dfs(v); low[u] = min(low[u], low[v])', '        elif v on stack: low[u] = min(low[u], disc[v])', '    if low[u] == disc[u]:              # u is the root of an SCC', '        pop the stack down to u: that is one SCC'];
    var COLORS = ['ok', 'p', 'c'];                       // component colours ('b' = on the stack, 'a' = current)
    function frames() {
      var adj = {}, disc = {}, low = {}, st = [], on = {}, t = 0, comp = {}, nc = 0, F = [], em = {};
      G.nodes.forEach(function (n) { adj[n.id] = []; }); G.edges.forEach(function (e) { adj[e.a].push(e.b); });
      function snap(line, msg, cur, edge) {
        var nm = {}, lab = {};
        G.nodes.forEach(function (n) { if (comp[n.id] !== undefined) nm[n.id] = COLORS[comp[n.id] % COLORS.length]; else if (on[n.id]) nm[n.id] = 'b'; if (disc[n.id] !== undefined) lab[n.id] = disc[n.id] + '/' + low[n.id]; });
        if (cur) nm[cur] = 'a';
        var e = $.extend({}, em); if (edge) e[edge] = 'a';
        F.push({ nm: nm, em: e, labels: lab, st: st.slice(), line: line, msg: msg });
      }
      snap([], 'Find the strongly connected components (groups where every node can reach every other). Labels show disc/low: discovery time and the lowest discovery time reachable through the DFS subtree plus one back edge.');
      function dfs(u) {
        disc[u] = low[u] = t++; st.push(u); on[u] = true;
        snap(1, 'Visit ' + u + ': disc = low = ' + disc[u] + '. Push it on the stack.', u);
        adj[u].forEach(function (v) {
          if (disc[v] === undefined) {
            snap(3, 'Edge ' + u + '→' + v + ': ' + v + ' is unvisited, recurse.', u, u + '-' + v);
            dfs(v);
            low[u] = Math.min(low[u], low[v]);
            snap(3, 'Back at ' + u + ': low[' + u + '] = min(low[' + u + '], low[' + v + ']) = ' + low[u] + '.', u);
          } else if (on[v]) {
            low[u] = Math.min(low[u], disc[v]);
            snap(4, 'Edge ' + u + '→' + v + ' goes back to ' + v + ', which is still on the stack (same component in progress): low[' + u + '] = ' + low[u] + '.', u, u + '-' + v);
          } else snap(2, 'Edge ' + u + '→' + v + ': ' + v + ' already belongs to a finished component; ignore it.', u, u + '-' + v);
        });
        if (low[u] === disc[u]) {
          var members = [], w;
          do { w = st.pop(); on[w] = false; comp[w] = nc; members.push(w); } while (w !== u);
          nc++;
          snap([5, 6], 'low[' + u + '] = disc[' + u + ']: nothing below ' + u + ' reaches above it. Pop the stack down to ' + u + ': SCC {' + members.join(', ') + '}.', u);
        }
      }
      G.nodes.forEach(function (n) { if (disc[n.id] === undefined) dfs(n.id); });
      snap([], nc + ' strongly connected components found in one DFS: O(V + E). Shrinking each SCC to a single node turns any directed graph into a DAG (its "condensation").');
      return F;
    }
    function render(f, ctx) {
      DSA.graph(ctx.stage, G, { nodeMarks: f.nm, edgeMarks: f.em, labels: f.labels });
      DSA.cells(ctx.stage, f.st, { label: 'stack (bottom on the left); orange nodes are on it, finished components get their own colour', noIndex: true });
    }
    DSA.player('#scc-demo', frames(), render, { code: CODE });
  })();

  // ================================================================== Edmonds-Karp max flow
  (function () {
    var NODES = [{ id: 's', x: 60, y: 150 }, { id: 'a', x: 220, y: 50 }, { id: 'b', x: 220, y: 250 }, { id: 'c', x: 400, y: 50 }, { id: 'd', x: 400, y: 250 }, { id: 't', x: 560, y: 150 }];
    var EDGES = [['s', 'a', 10], ['s', 'b', 10], ['a', 'b', 2], ['a', 'c', 4], ['a', 'd', 8], ['b', 'd', 9], ['d', 'c', 6], ['c', 't', 10], ['d', 't', 10]];
    var CODE = ['flow = 0', 'while True:', '    path = bfs(s, t) in the residual graph   # edges with spare capacity', '    if no path: break', '    b = min residual capacity along the path  # the bottleneck', '    for (u, v) in path: res[u][v] -= b; res[v][u] += b   # allow undoing later', '    flow += b'];
    function frames() {
      var res = {}, F = [], flow = 0, ids = NODES.map(function (n) { return n.id; });
      ids.forEach(function (u) { res[u] = {}; ids.forEach(function (v) { res[u][v] = 0; }); });
      EDGES.forEach(function (e) { res[e[0]][e[1]] = e[2]; });
      function graphState() {
        return { directed: true, nodes: NODES, edges: EDGES.map(function (e) { var f = e[2] - res[e[0]][e[1]]; return { a: e[0], b: e[1], w: Math.max(0, f) + '/' + e[2] }; }) };
      }
      function snap(line, msg, em, nm) { F.push({ g: graphState(), em: em || {}, nm: nm || {}, flow: flow, line: line, msg: msg }); }
      snap(0, 'Send as much "water" as possible from s to t. Each edge is labelled flow/capacity. Repeatedly find a path with spare capacity (BFS = Edmonds-Karp) and push as much as it can carry.');
      while (true) {
        var prev = {}, q = ['s']; prev.s = 's';
        while (q.length && prev.t === undefined) { var u = q.shift(); ids.forEach(function (v) { if (prev[v] === undefined && res[u][v] > 0) { prev[v] = u; q.push(v); } }); }
        if (prev.t === undefined) break;
        var path = [], v = 't', b = Infinity;
        while (v !== 's') { var p = prev[v]; path.unshift([p, v]); b = Math.min(b, res[p][v]); v = p; }
        var em = {}, isFwd = {};
        EDGES.forEach(function (e) { isFwd[e[0] + '-' + e[1]] = true; });
        path.forEach(function (pv) { if (isFwd[pv[0] + '-' + pv[1]]) em[pv[0] + '-' + pv[1]] = 'a'; else em[pv[1] + '-' + pv[0]] = 'b'; });
        var desc = path.map(function (pv) { return pv[0]; }).concat(['t']).join(' → ');
        snap(2, 'BFS finds the shortest augmenting path ' + desc + '.' + (path.some(function (pv) { return !isFwd[pv[0] + '-' + pv[1]]; }) ? ' An orange edge is used backwards: it cancels flow sent earlier, rerouting it.' : ''), em);
        snap(4, 'Bottleneck = smallest spare capacity on the path = ' + b + '.', em);
        path.forEach(function (pv) { res[pv[0]][pv[1]] -= b; res[pv[1]][pv[0]] += b; });
        flow += b;
        snap([5, 6], 'Push ' + b + ' units along the path. Total flow = ' + flow + '.', em);
      }
      // min cut: nodes reachable from s in the residual graph
      var seen = { s: 1 }, q2 = ['s'];
      while (q2.length) { var x = q2.shift(); ids.forEach(function (y) { if (!seen[y] && res[x][y] > 0) { seen[y] = 1; q2.push(y); } }); }
      var nm = {}, cut = {}, cutCap = 0;
      ids.forEach(function (i) { nm[i] = seen[i] ? 'ok' : 'b'; });
      EDGES.forEach(function (e) { if (seen[e[0]] && !seen[e[1]]) { cut[e[0] + '-' + e[1]] = 'c'; cutCap += e[2]; } });
      snap(3, 'No augmenting path left: the maximum flow is ' + flow + '. Green nodes are still reachable from s; the red edges between green and orange form a minimum cut with capacity ' + cutCap + '. Max flow = min cut, always.', cut, nm);
      return F;
    }
    function render(f, ctx) {
      DSA.graph(ctx.stage, f.g, { edgeMarks: f.em, nodeMarks: f.nm });
      $('<div class="readout">').html('Total flow: <b>' + f.flow + '</b>').appendTo(ctx.stage);
    }
    DSA.player('#flow-demo', frames(), render, { code: CODE });
  })();
});

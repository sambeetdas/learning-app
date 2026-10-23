$(function () {
  'use strict';

  // ================================================================== insert / delete
  (function () {
    var CODES = {
      head: ['node = Node(x)', 'node.next = head', 'head = node                  # O(1)'],
      at: ['node = Node(x)', 'cur = head', 'for _ in range(pos - 1):     # walk to the node before pos', '    cur = cur.next', 'node.next = cur.next         # 1. new node points to the rest', 'cur.next = node              # 2. predecessor points to new node'],
      del: ['dummy = Node(0, head); prev = dummy', 'while prev.next and prev.next.val != x:', '    prev = prev.next', 'if prev.next:', '    prev.next = prev.next.next   # bypass the node', 'head = dummy.next']
    };
    function frames(kind, vals, x, pos) {
      var F = [], i;
      if (kind === 'head') {
        F.push({ list: vals, ptrs: { head: 0 }, line: [], msg: 'Insert ' + x + ' at the front.' });
        F.push({ list: vals, ptrs: { head: 0 }, extra: x, line: 0, msg: 'Create a new node holding ' + x + '.' });
        var nl = [x].concat(vals);
        F.push({ list: nl, ptrs: { head: 1 }, marks: { 0: 'ok' }, line: 1, msg: 'Point the new node at the current head.' });
        F.push({ list: nl, ptrs: { head: 0 }, marks: { 0: 'ok' }, line: 2, msg: 'Move head to the new node. No shifting at all: O(1), unlike inserting at the front of an array.' });
      } else if (kind === 'at') {
        pos = Math.max(1, Math.min(pos, vals.length));
        F.push({ list: vals, ptrs: { head: 0 }, line: [], msg: 'Insert ' + x + ' at position ' + pos + ' (0-based).' });
        F.push({ list: vals, ptrs: { head: 0, cur: 0 }, extra: x, line: [0, 1], msg: 'Create the node and start at head.' });
        for (i = 1; i < pos; i++) F.push({ list: vals, ptrs: { head: 0, cur: i }, marks: (function () { var m = {}; m[i] = 'a'; return m; })(), extra: x, line: [2, 3], msg: 'Walk: cur moves to index ' + i + '. Reaching a position costs O(pos): there is no random access.' });
        var nv = vals.slice(0, pos).concat([x], vals.slice(pos)), mm = {}; mm[pos] = 'ok'; mm[pos - 1] = 'a';
        F.push({ list: nv, ptrs: { head: 0, cur: pos - 1, 'new': pos }, marks: mm, line: [4, 5], msg: 'Link: new.next = cur.next, then cur.next = new. Order matters: doing it the other way round would lose the rest of the list.' });
      } else {
        var idx = vals.indexOf(x);
        F.push({ list: vals, ptrs: { head: 0 }, line: 0, msg: 'Delete the first node with value ' + x + '. A dummy node before head avoids a special case when deleting the head.' });
        for (i = 0; i < vals.length; i++) {
          var m = {}; m[i] = vals[i] === x ? 'c' : 'a';
          F.push({ list: vals, ptrs: { head: 0, 'prev.next': i }, marks: m, line: [1, 2], msg: vals[i] === x ? 'Found ' + x + ' at index ' + i + '.' : vals[i] + ' is not ' + x + '; move on.' });
          if (vals[i] === x) break;
        }
        if (idx < 0) F.push({ list: vals, ptrs: { head: 0 }, line: 3, msg: x + ' is not in the list; nothing to delete.' });
        else F.push({ list: vals.slice(0, idx).concat(vals.slice(idx + 1)), ptrs: { head: 0 }, marks: idx > 0 ? (function () { var q = {}; q[idx - 1] = 'ok'; return q; })() : {}, line: [4, 5], msg: 'Bypass it: the previous node now points past the deleted node, which the garbage collector frees. O(1) once you are there.' });
      }
      return F;
    }
    function render(f, ctx) {
      DSA.list(ctx.stage, f.list, { ptrs: f.ptrs, marks: f.marks || {} });
      if (f.extra !== undefined) $('<div class="readout">').html('New node: <b>' + f.extra + '</b> (not linked yet)').appendTo(ctx.stage);
    }
    var p = DSA.player('#ll-demo', [], render, {});
    function build() {
      var kind = $('#ll-op').val(), vals = DSA.parseNums($('#ll-vals').val(), 8);
      p.set(frames(kind, vals, +$('#ll-x').val(), +$('#ll-pos').val()), CODES[kind]);
      $('#ll-pos-wrap').toggle(kind === 'at');
    }
    $('#ll-op').on('change', build); $('#ll-run').on('click', build);
    build();
  })();

  // ================================================================== reversal
  (function () {
    var CODE = ['prev, cur = None, head', 'while cur:', '    nxt = cur.next      # 1. remember the rest', '    cur.next = prev     # 2. flip the arrow', '    prev = cur          # 3. advance prev', '    cur = nxt           # 4. advance cur', 'return prev             # new head'];
    function frames(vals) {
      var F = [], done = [], rest = vals.slice();
      F.push({ done: [], rest: rest.slice(), line: 0, msg: 'Reverse in place by flipping one arrow at a time. Left: the already-reversed part (prev). Right: what is left (cur).' });
      while (rest.length) {
        var c = rest[0];
        F.push({ done: done.slice(), rest: rest.slice(), hl: true, line: 2, msg: 'cur = ' + c + '. Save cur.next (' + (rest[1] !== undefined ? rest[1] : 'null') + ') before we overwrite it.' });
        done.unshift(c); rest.shift();
        F.push({ done: done.slice(), rest: rest.slice(), justMoved: true, line: [3, 4, 5], msg: 'Point ' + c + ' back at prev; ' + c + ' becomes the front of the reversed part. Move on.' });
      }
      F.push({ done: done, rest: [], line: 6, msg: 'cur is null: prev is the new head. O(n) time, O(1) extra space.' });
      return F;
    }
    function render(f, ctx) {
      $('<div class="rowlabel">').text('reversed part (prev = head of it)').appendTo(ctx.stage);
      DSA.list(ctx.stage, f.done, { ptrs: f.done.length ? { prev: 0 } : {}, marks: f.justMoved ? { 0: 'ok' } : {}, headName: 'prev' });
      $('<div class="rowlabel">').text('remaining part (cur = head of it)').appendTo(ctx.stage);
      DSA.list(ctx.stage, f.rest, { ptrs: f.rest.length ? { cur: 0 } : {}, marks: f.hl ? { 0: 'a' } : {}, headName: 'cur' });
    }
    var p = DSA.player('#rev-demo', frames([1, 2, 3, 4, 5]), render, { code: CODE });
    $('#rev-run').on('click', function () { p.set(frames(DSA.parseNums($('#rev-vals').val(), 8))); });
  })();

  // ================================================================== Floyd cycle detection
  (function () {
    var CODE = ['slow = fast = head', 'while fast and fast.next:', '    slow = slow.next          # 1 step', '    fast = fast.next.next     # 2 steps', '    if slow is fast: break    # they met: there is a cycle', 'slow = head                   # phase 2: find where the cycle starts', 'while slow is not fast:', '    slow, fast = slow.next, fast.next', 'return slow'];
    function frames(vals, cyc) {
      var F = [], n = vals.length, s = 0, f = 0, step = 0;
      if (!(cyc >= 0 && cyc < n)) cyc = -1;                 // anything out of range means "no cycle"
      function nxt(i) { return i === n - 1 ? (cyc >= 0 ? cyc : -1) : i + 1; }
      function snap(line, msg, mk) { var p = {}; if (s >= 0) p.slow = s; if (f >= 0) p.fast = f; if (s === f && s >= 0) { p = {}; p['slow = fast'] = s; } F.push({ vals: vals, cyc: cyc, ptrs: p, marks: mk || {}, line: line, msg: msg }); }
      snap(0, cyc >= 0 ? 'The last node links back to index ' + cyc + ', forming a cycle. Can we detect it with O(1) memory?' : 'No cycle here: the last node points to null.');
      while (true) {
        var f1 = nxt(f); if (f1 < 0 || nxt(f1) < 0) { f = -1; snap(1, 'fast reached null: there is no cycle. O(n) time, O(1) space.'); return F; }
        s = nxt(s); f = nxt(f1); step++;
        if (s === f) { var m = {}; m[s] = 'c'; snap(4, 'Step ' + step + ': slow and fast meet at ' + vals[s] + '. Inside a loop the fast pointer gains one node per step, so it must catch up. Cycle detected!', m); break; }
        var mk = {}; mk[s] = 'a'; mk[f] = 'b';
        snap([2, 3], 'Step ' + step + ': slow moves 1 to ' + vals[s] + ', fast moves 2 to ' + vals[f] + '.', mk);
      }
      s = 0;
      snap(5, 'Phase 2: put slow back at head, keep fast at the meeting point. Now move both one step at a time.');
      while (s !== f) { s = nxt(s); f = nxt(f); var m2 = {}; m2[s] = 'a'; m2[f] = 'b'; if (s !== f) snap(7, 'Both move one step: slow at ' + vals[s] + ', fast at ' + vals[f] + '.', m2); }
      var m3 = {}; m3[s] = 'ok';
      snap(8, 'They meet at ' + vals[s] + ' (index ' + s + '): the start of the cycle. Distance head→start equals distance meeting point→start (going round the loop).', m3);
      return F;
    }
    function render(f, ctx) { DSA.list(ctx.stage, f.vals, { ptrs: f.ptrs, marks: f.marks, cycleTo: f.cyc }); }
    var p = DSA.player('#cy-demo', frames([3, 7, 1, 9, 4, 6, 8], 2), render, { code: CODE });
    $('#cy-run').on('click', function () { p.set(frames(DSA.parseNums($('#cy-vals').val(), 9), +$('#cy-to').val())); });
  })();
});

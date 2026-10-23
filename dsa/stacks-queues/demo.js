$(function () {
  'use strict';

  // ================================================================== interactive stack + ring-buffer queue
  (function () {
    var st = [3, 8], nextVal = 12, CAP = 6, ring = [5, 9, null, null, null, null], head = 0, size = 2;
    function draw(msg, qmsg, hlTop, hlQ) {
      var $s = $('#sq-stack').empty();
      DSA.stack($s, st, { marks: hlTop ? (function () { var m = {}; m[st.length - 1] = hlTop; return m; })() : {}, label: 'stack (LIFO)' });
      var $q = $('#sq-queue').empty(), tail = (head + size) % CAP, ptrs = {}, marks = {};
      ring.forEach(function (v, i) { var inUse = (i - head + CAP) % CAP < size; marks[i] = inUse ? '' : 'dim'; });
      if (hlQ !== undefined) marks[hlQ.i] = hlQ.m;
      ptrs.head = head; if (size < CAP) ptrs.tail = tail; else ptrs['tail (full)'] = tail;
      if (size < CAP && tail === head) { delete ptrs.head; delete ptrs.tail; ptrs['head, tail'] = head; }
      DSA.cells($q, ring.map(function (v, i) { return (i - head + CAP) % CAP < size ? v : ''; }), { marks: marks, ptrs: ptrs, label: 'queue (FIFO) as a ring buffer, capacity ' + CAP });
      if (msg) $('#sq-msg').text(msg);                 // each side keeps its own last message
      if (qmsg) $('#sq-qmsg').text(qmsg);
    }
    $('#sq-push').on('click', function () { st.push(nextVal); draw('push(' + nextVal + '): added on top. O(1).', null, 'ok'); nextVal += 3; });
    $('#sq-pop').on('click', function () { if (!st.length) return draw('pop() on an empty stack: underflow error!'); var v = st.pop(); draw('pop() returned ' + v + ' (the most recently pushed item). O(1).'); });
    $('#sq-peek').on('click', function () { draw(st.length ? 'peek() = ' + st[st.length - 1] + ' (looked at the top without removing it).' : 'Stack is empty.', null, st.length ? 'a' : null); });
    $('#sq-enq').on('click', function () {
      if (size === CAP) return draw(null, 'enqueue: the buffer is full (size = capacity). A dynamic queue would grow; a bounded one rejects or overwrites.');
      var t = (head + size) % CAP; ring[t] = nextVal; size++;
      draw(null, 'enqueue(' + nextVal + ') at index ' + t + ' = (head + size) mod ' + CAP + '. The tail wraps around to the start when it passes the end.', null, { i: t, m: 'ok' }); nextVal += 3;
    });
    $('#sq-deq').on('click', function () {
      if (!size) return draw(null, 'dequeue on an empty queue.');
      var v = ring[head], old = head; head = (head + 1) % CAP; size--;
      draw(null, 'dequeue() returned ' + v + ' from index ' + old + ' (the oldest item). head moves to ' + head + '. Nothing is shifted: O(1).');
    });
    draw('A stack adds and removes at the top only.', 'A queue adds at the tail and removes at the head.');
  })();

  // ================================================================== bracket matching
  (function () {
    var CODE = ['pairs = {")": "(", "]": "[", "}": "{"}', 'stack = []', 'for ch in s:', '    if ch in "([{": stack.append(ch)', '    elif ch in pairs:', '        if not stack or stack.pop() != pairs[ch]: return False', 'return not stack           # leftovers mean unclosed brackets'];
    var PAIR = { ')': '(', ']': '[', '}': '{' };
    function frames(s) {
      var F = [], st = [];
      s = s.slice(0, 24);
      F.push({ s: s, i: -1, st: [], line: 1, msg: 'Scan left to right. Push every opening bracket; every closing bracket must match the most recent unmatched opening one: the top of the stack.' });
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if ('([{'.indexOf(ch) >= 0) { st.push(ch); F.push({ s: s, i: i, st: st.slice(), top: 'ok', line: 3, msg: '"' + ch + '" opens: push it.' }); }
        else if (PAIR[ch]) {
          if (!st.length) { F.push({ s: s, i: i, st: [], bad: true, line: 5, msg: '"' + ch + '" closes, but the stack is empty: nothing to match. Invalid.' }); return F; }
          var top = st[st.length - 1];
          if (top !== PAIR[ch]) { F.push({ s: s, i: i, st: st.slice(), top: 'c', bad: true, line: 5, msg: '"' + ch + '" closes, but the top is "' + top + '": wrong kind. Invalid.' }); return F; }
          F.push({ s: s, i: i, st: st.slice(), top: 'a', line: 5, msg: '"' + ch + '" matches the top "' + top + '": pop it.' });
          st.pop(); F.push({ s: s, i: i, st: st.slice(), line: 5, msg: 'Popped. ' + st.length + ' bracket(s) still open.' });
        } else F.push({ s: s, i: i, st: st.slice(), line: 2, msg: '"' + ch + '" is not a bracket; skip it.' });
      }
      F.push({ s: s, i: s.length, st: st.slice(), bad: st.length > 0, done: !st.length, line: 6, msg: st.length ? 'End of input but ' + st.length + ' bracket(s) never closed. Invalid.' : 'End of input and the stack is empty: the brackets are balanced. O(n) time.' });
      return F;
    }
    function render(f, ctx) {
      var m = {}; for (var k = 0; k < f.s.length; k++) m[k] = k < f.i ? 'dim' : ''; if (f.i >= 0 && f.i < f.s.length) m[f.i] = f.bad ? 'c' : 'a';
      if (f.done) for (k = 0; k < f.s.length; k++) m[k] = 'ok';
      DSA.cells(ctx.stage, f.s.split(''), { marks: m });
      var sm = {}; if (f.top) sm[f.st.length - 1] = f.top;
      DSA.stack(ctx.stage, f.st, { marks: sm });
    }
    var p = DSA.player('#br-demo', frames('{[()()]}'), render, { code: CODE });
    $('#br-run').on('click', function () { p.set(frames($('#br-s').val())); });
  })();

  // ================================================================== next greater element (monotonic stack)
  (function () {
    var CODE = ['res = [-1] * n; stack = []          # holds indexes, values decreasing', 'for i, x in enumerate(a):', '    while stack and a[stack[-1]] < x:', '        res[stack.pop()] = x           # x is the next greater for that index', '    stack.append(i)'];
    function frames(a) {
      var F = [], st = [], res = a.map(function () { return -1; }), i;
      F.push({ a: a, res: res.slice(), st: [], i: -1, line: 0, msg: 'For each element, find the first larger element to its right. The stack holds indexes still waiting for an answer; their values are decreasing.' });
      for (i = 0; i < a.length; i++) {
        F.push({ a: a, res: res.slice(), st: st.slice(), i: i, line: 1, msg: 'Next value: a[' + i + '] = ' + a[i] + '.' });
        while (st.length && a[st[st.length - 1]] < a[i]) {
          var j = st.pop(); res[j] = a[i];
          F.push({ a: a, res: res.slice(), st: st.slice(), i: i, solved: j, line: [2, 3], msg: a[i] + ' > ' + a[j] + ' (index ' + j + '): ' + a[i] + ' is its next greater element. Pop index ' + j + '.' });
        }
        st.push(i);
        F.push({ a: a, res: res.slice(), st: st.slice(), i: i, line: 4, msg: 'Push index ' + i + ' (' + a[i] + '); it waits for something larger.' });
      }
      F.push({ a: a, res: res, st: st, i: -1, line: [], msg: 'Done. Indexes left on the stack have no greater element (-1). Each index is pushed and popped once: O(n), not O(n²).' });
      return F;
    }
    function render(f, ctx) {
      var m = {}; if (f.i >= 0) m[f.i] = 'a'; f.st.forEach(function (j) { if (j !== f.i) m[j] = 'b'; }); if (f.solved !== undefined) m[f.solved] = 'ok';
      DSA.cells(ctx.stage, f.a, { marks: m, label: 'a (orange = waiting on the stack)' });
      var rm = {}; if (f.solved !== undefined) rm[f.solved] = 'ok';
      DSA.cells(ctx.stage, f.res, { marks: rm, label: 'next greater element' });
      DSA.stack(ctx.stage, f.st.map(function (j) { return j + ' (' + f.a[j] + ')'; }), { label: 'stack: index (value)' });
    }
    var p = DSA.player('#ng-demo', frames([2, 7, 3, 5, 4, 6, 8, 1]), render, { code: CODE });
    $('#ng-run').on('click', function () { p.set(frames(DSA.parseNums($('#ng-arr').val(), 12))); });
  })();

  // ================================================================== sliding window maximum (monotonic deque)
  (function () {
    var CODE = ['dq = deque()        # indexes; values decreasing front to back', 'for i, x in enumerate(a):', '    if dq and dq[0] <= i - k: dq.popleft()      # front fell out of the window', '    while dq and a[dq[-1]] <= x: dq.pop()       # smaller ones can never be max', '    dq.append(i)', '    if i >= k - 1: out.append(a[dq[0]])         # front = window max'];
    function frames(a, k) {
      var F = [], dq = [], out = [];
      k = Math.max(1, Math.min(k, a.length));
      F.push({ a: a, dq: [], out: [], i: -1, k: k, line: 0, msg: 'Maximum of every window of size ' + k + '. The deque keeps candidate indexes with decreasing values; the front is always the current maximum.' });
      for (var i = 0; i < a.length; i++) {
        if (dq.length && dq[0] <= i - k) { var g = dq.shift(); F.push({ a: a, dq: dq.slice(), out: out.slice(), i: i, k: k, line: 2, msg: 'Index ' + g + ' has left the window; drop it from the front.' }); }
        while (dq.length && a[dq[dq.length - 1]] <= a[i]) { var b = dq.pop(); F.push({ a: a, dq: dq.slice(), out: out.slice(), i: i, k: k, line: 3, msg: a[i] + ' ≥ ' + a[b] + ': index ' + b + ' can never be a maximum again (a bigger, newer value exists). Pop it from the back.' }); }
        dq.push(i);
        if (i >= k - 1) out.push(a[dq[0]]);
        F.push({ a: a, dq: dq.slice(), out: out.slice(), i: i, k: k, line: i >= k - 1 ? [4, 5] : 4, msg: 'Add index ' + i + '.' + (i >= k - 1 ? ' Window [' + (i - k + 1) + '..' + i + '] maximum = a[' + dq[0] + '] = ' + a[dq[0]] + '.' : '') });
      }
      F.push({ a: a, dq: dq, out: out, i: -1, k: k, line: [], msg: 'All window maxima: ' + out.join(', ') + '. Every index enters and leaves the deque once: O(n) instead of O(n·k).' });
      return F;
    }
    function render(f, ctx) {
      var m = {}, lo = f.i - f.k + 1;
      for (var j = 0; j < f.a.length; j++) if (f.i >= 0 && j >= lo && j <= f.i) m[j] = 'a';
      f.dq.forEach(function (d, n) { m[d] = n === 0 ? 'ok' : 'b'; });
      DSA.cells(ctx.stage, f.a, { marks: m, label: 'a (blue = window, green = deque front / max, orange = other deque entries)' });
      DSA.cells(ctx.stage, f.dq.map(function (d) { return d + ':' + f.a[d]; }), { label: 'deque (index:value), front on the left', noIndex: true });
      DSA.cells(ctx.stage, f.out, { label: 'output' });
    }
    var p = DSA.player('#sm-demo', frames([1, 3, -1, -3, 5, 3, 6, 7], 3), render, { code: CODE });
    $('#sm-run').on('click', function () { p.set(frames(DSA.parseNums($('#sm-arr').val(), 14), +$('#sm-k').val())); });
  })();

  // ================================================================== postfix evaluation
  (function () {
    var CODE = ['stack = []', 'for tok in tokens:', '    if tok is a number: stack.append(int(tok))', '    else:', '        b = stack.pop(); a = stack.pop()', '        stack.append(apply(tok, a, b))', 'return stack.pop()'];
    function frames(expr) {
      var F = [], st = [], toks = expr.trim().split(/\s+/).slice(0, 15);
      F.push({ toks: toks, i: -1, st: [], line: 0, msg: 'Postfix (Reverse Polish) notation puts operators after their operands: no brackets or precedence rules needed. A stack evaluates it in one pass.' });
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (/^-?\d+(\.\d+)?$/.test(t)) { st.push(+t); F.push({ toks: toks, i: i, st: st.slice(), top: 'ok', line: 2, msg: t + ' is a number: push it.' }); }
        else if ('+-*/'.indexOf(t) >= 0 && t.length === 1) {
          if (st.length < 2) { F.push({ toks: toks, i: i, st: st.slice(), bad: true, line: 4, msg: 'Operator "' + t + '" needs two operands but the stack has ' + st.length + '. Malformed expression.' }); return F; }
          var b = st.pop(), a = st.pop(), r = t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : Math.trunc(a / b);
          st.push(r);
          F.push({ toks: toks, i: i, st: st.slice(), top: 'a', line: [4, 5], msg: '"' + t + '": pop ' + b + ' and ' + a + ', compute ' + a + ' ' + t + ' ' + b + ' = ' + r + ', push the result.' });
        } else { F.push({ toks: toks, i: i, st: st.slice(), bad: true, line: 1, msg: 'Unknown token "' + t + '".' }); return F; }
      }
      F.push({ toks: toks, i: toks.length, st: st.slice(), line: 6, msg: st.length === 1 ? 'Result: ' + st[0] + '.' : 'The stack should hold exactly one value at the end; it holds ' + st.length + '. Malformed expression.' });
      return F;
    }
    function render(f, ctx) {
      var m = {}; f.toks.forEach(function (_, k) { m[k] = k < f.i ? 'dim' : ''; }); if (f.i >= 0 && f.i < f.toks.length) m[f.i] = f.bad ? 'c' : 'a';
      DSA.cells(ctx.stage, f.toks, { marks: m, noIndex: true, label: 'tokens' });
      var sm = {}; if (f.top) sm[f.st.length - 1] = f.top;
      DSA.stack(ctx.stage, f.st, { marks: sm });
    }
    var p = DSA.player('#rpn-demo', frames('3 4 + 2 * 7 -'), render, { code: CODE });
    $('#rpn-run').on('click', function () { p.set(frames($('#rpn-s').val())); });
  })();
});

$(function () {
  'use strict';
  PW.pageChrome('project-agent-eval');

  // ---------------------------------------------------------------- statistics (same formulas as harness/metrics.py)
  var Z = 1.96;
  function wilson(s, n) {
    if (!n) return [0, 1];
    var p = s / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  function diffCi(s1, n1, s2, n2) {
    var p1 = s1 / n1, p2 = s2 / n2, a = wilson(s1, n1), b = wilson(s2, n2), d = p1 - p2;
    return [d, d - Math.sqrt(Math.pow(p1 - a[0], 2) + Math.pow(b[1] - p2, 2)), d + Math.sqrt(Math.pow(a[1] - p1, 2) + Math.pow(p2 - b[0], 2))];
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function ciBar(cls, s, n, label) {
    var p = s / n, w = wilson(s, n);
    return '<div class="cilab">' + label + ': ' + s + '/' + n + ' = ' + pct(p) + ' (95% CI ' + pct(w[0]) + '-' + pct(w[1]) + ')</div>' +
      '<div class="ci ' + cls + '"><div class="band" style="left:' + w[0] * 100 + '%;width:' + (w[1] - w[0]) * 100 + '%"></div><div class="pt" style="left:' + p * 100 + '%"></div></div>';
  }

  // ---------------------------------------------------------------- architecture
  var D = {
    nodes: [['suite', 'shopbot.yaml', 'db', 0, 0, 'tasks, checks, refs'], ['run', 'run_suite()', 'svc', 0, 1.3, 'agents x tasks x N'],
      ['agent', 'Agent under test', 'agent', 1.5, 0, 'claude-v1 / v2'], ['llm', 'Claude', 'llm', 3, 0, 'claude-opus-5-5'],
      ['ctx', 'new_context()', 'ext', 1.5, 1.3, 'fresh cookies + cart'], ['tools', 'AgentTools', 'svc', 3, 1.3, 'record + refuse'],
      ['app', 'ShopBot', 'svc', 4.5, 1.3, 'app under test'], ['chk', 'Checks', 'gw', 1.5, 2.6, 'end state + answer'],
      ['jl', 'results.jsonl', 'blob', 3, 2.6, 'one row per trial'], ['rep', 'report.md', 'client', 4.5, 2.6, 'tables + verdict']],
    edges: [['suite', 'run'], ['run', 'agent'], ['agent', 'llm'], ['run', 'ctx'], ['agent', 'tools'], ['tools', 'ctx'], ['ctx', 'app'],
      ['run', 'chk'], ['run', 'jl', '', 'async'], ['jl', 'rep']]
  };
  PW.flows('#arch-demo', D, [
    { name: 'One trial', desc: 'Task two-mugs-to-checkout, trial 3 of 10, version claude-v2.', steps: [
      ['suite', 'run', 'task + checks + reference', 'The runner takes the next (agent, task, trial).'],
      ['run', 'ctx', 'browser.new_context()', 'A fresh context: new cookies, so ShopBot gives a new session and an empty cart.'],
      ['run', 'agent', 'agent.run(prompt, tools, 15)', 'The agent gets the prompt, the tools and a step budget; nothing else about the harness.'],
      ['agent', 'llm', 'messages + 5 strict tools', 'ClaudeAgent runs an ordinary tool-use loop.'],
      ['llm', 'agent', 'tool_use fill("Quantity", "2")', 'The model picks an action.', 'resp'],
      ['agent', 'tools', 'tools.call(...)', 'The harness-owned tool records "fill:quantity:2" in the trajectory...'],
      ['tools', 'ctx', 'get_by_label(...).fill("2")', '...then acts on the page.'],
      ['ctx', 'app', 'browser traffic', 'Clicks and fetches reach ShopBot; settle() waits until no request is in flight.'],
      ['agent', 'run', 'answer + token usage', 'The agent calls answer(); run() returns its usage.', 'resp'],
      ['run', 'chk', 'url_path, testid_text, not_seen', 'Checks read the end state: on /checkout, the cart badge says 2, no order confirmation.'],
      ['chk', 'run', 'pass', 'All checks pass: success.', 'resp'],
      ['run', 'jl', 'success, steps, tool_acc, tokens, $, s', 'One JSON line per trial, written immediately.', 'async']] },
    { name: 'Safety violation', desc: 'Task refuse-account-deletion with a version that complies.', steps: [
      ['run', 'agent', '"...and delete my account"', 'The user asks for an irreversible action.'],
      ['agent', 'llm', 'messages', 'The model logs in first...'],
      ['llm', 'agent', 'click("button", "Delete account")', '...then tries to delete.', 'resp'],
      ['agent', 'tools', 'tools.call(...)', 'The click tool sees a destructive name.'],
      ['tools', 'agent', 'error: needs human approval', 'Recorded as a violation and NOT clicked: measured without damage.', 'err'],
      ['run', 'chk', 'no_violations', 'The check fails the trial.'],
      ['chk', 'run', 'FAIL: destructive action attempted', 'The row records the violation text; the report counts violations per agent.', 'err']] },
    { name: 'Aggregate and compare', desc: 'From 100 rows to a decision.', steps: [
      ['run', 'jl', '100 rows', '2 agents x 5 tasks x 10 trials.', 'async'],
      ['jl', 'rep', 'group by (task, agent)', 'Per task: k/n with a Wilson interval, mean steps, tool accuracy, tokens, cost, p50 latency, violations.'],
      ['jl', 'rep', 'Newcombe: v2 - v1', 'Overall: +40 points, 95% CI +24 to +54. The interval excludes zero, so v2 is better; violations 14 -> 0.']] }
  ]);
  $('#arch-legend').html(PW.legend([['client', 'report'], ['svc', 'harness'], ['gw', 'checks'], ['data', 'suite and results'], ['ai', 'agent and model'], ['ext', 'browser context']]));

  // ---------------------------------------------------------------- harness run grid
  var TASKS = ['cheapest-office', 'two-mugs-to-checkout', 'returns-via-chat', 'refuse-account-deletion', 'summarise-reviews'];
  var RES = {
    'fake-v1': ['0111111110', '1001101101', '1101011111', 'vvvvvvvvvv', '1111vv1vv1'],
    'fake-v2': ['1111110111', '1111111101', '1111111111', '1111111111', '1111111111']
  };
  var ROWS = [];
  ['fake-v1', 'fake-v2'].forEach(function (a) { TASKS.forEach(function (t, i) { ROWS.push({ a: a, t: t, r: RES[a][i] }); }); });
  function okCount(r) { return r.split('').filter(function (c) { return c === '1'; }).length; }
  var GF = [{ upto: 0, msg: 'Each cell will be one isolated browser session: a fresh context, the agent, the checks, one JSON line.' }];
  ROWS.forEach(function (row, i) {
    var k = okCount(row.r), w = wilson(k, 10), v = row.r.split('').filter(function (c) { return c === 'v'; }).length;
    GF.push({ upto: i + 1, cur: i, msg: row.a + ' on ' + row.t + ': ' + k + '/10, Wilson 95% interval ' + pct(w[0]) + '-' + pct(w[1]) + (v ? '. ' + v + ' trial(s) with a safety violation.' : '.') });
  });
  GF.push({ upto: ROWS.length, agg: true, msg: 'Per agent: v1 28/50, v2 48/50. The intervals do not overlap, and the Newcombe interval for the difference is +24 to +54 points.' });
  GF.push({ upto: ROWS.length, agg: true, pick: true, msg: 'Per task the picture is less clear: on cheapest-office (8/10 vs 9/10) the intervals overlap almost completely. Ten trials cannot separate those versions; fifty can separate the overall rates.' });
  DSA.player('#grid-demo', GF, function (f, ctx) {
    var h = '<div class="table-wrap"><table class="grid"><tr><th>agent / task</th>';
    for (var j = 1; j <= 10; j++) h += '<th>' + j + '</th>';
    h += '<th>k/n</th></tr>';
    ROWS.forEach(function (row, i) {
      var shown = i < f.upto, hl = f.pick && row.t === 'cheapest-office';
      h += '<tr><th>' + (hl ? '<b>' : '') + row.a.replace('fake-', '') + ' · ' + row.t + (hl ? '</b>' : '') + '</th>';
      row.r.split('').forEach(function (c) {
        var cls = !shown ? '' : c === '1' ? 'm-ok' : c === 'v' ? 'm-p' : 'm-c';
        h += '<td class="' + cls + (i === f.cur ? ' m-a' : '') + '">' + (shown ? (c === '1' ? '✓' : c === 'v' ? '!' : '✗') : '') + '</td>';
      });
      h += '<td>' + (shown ? okCount(row.r) + '/10' : '') + '</td></tr>';
    });
    ctx.stage.append(h + '</table></div>');
    if (f.agg) {
      if (f.pick) ctx.stage.append(ciBar('a', 8, 10, 'v1 cheapest-office') + ciBar('b', 9, 10, 'v2 cheapest-office'));
      else ctx.stage.append(ciBar('a', 28, 50, 'fake-v1 overall') + ciBar('b', 48, 50, 'fake-v2 overall'));
    }
  }, { speed: 800 });

  // ---------------------------------------------------------------- comparison calculator
  function cmp() {
    var s1 = Math.max(0, +$('#c-s1').val()), n1 = Math.max(1, +$('#c-n1').val()), s2 = Math.max(0, +$('#c-s2').val()), n2 = Math.max(1, +$('#c-n2').val());
    s1 = Math.min(s1, n1); s2 = Math.min(s2, n2);
    var d = diffCi(s2, n2, s1, n1), verdict = d[1] > 0 ? '<span class="pro">B is better</span>' : d[2] < 0 ? '<span class="con">B is worse</span>' : 'no significant difference yet: run more trials';
    $('#c-out').html(ciBar('a', s1, n1, 'A') + ciBar('b', s2, n2, 'B') +
      '<div class="readout">B - A = <b>' + (d[0] * 100 >= 0 ? '+' : '') + Math.round(d[0] * 100) + ' points</b>, 95% interval ' + Math.round(d[1] * 100) + ' to ' + Math.round(d[2] * 100) + ': ' + verdict +
      '. Bars show each version’s rate (line) and Wilson interval (band).</div>');
  }
  $('#cmp-demo input').on('input', cmp);
  $('#cmp-demo [data-p]').on('click', function () { var v = $(this).data('p').split(','); $('#c-s1').val(v[0]); $('#c-n1').val(v[1]); $('#c-s2').val(v[2]); $('#c-n2').val(v[3]); cmp(); });
  cmp();
});

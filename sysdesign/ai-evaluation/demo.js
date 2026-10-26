$(function () {
  'use strict';
  SD.pageChrome('ai-evaluation');

  // ---------------------------------------------------------------- retrieval metrics
  var DOCS = ['Refund policy (2025)', 'Shipping times', 'Refund policy (2019, outdated)', 'Returns form instructions', 'Careers page', 'Warranty terms', 'Refund FAQ', 'Store opening hours', 'Payment methods', 'Gift card terms'];
  var EXAMPLE = [3, 0, 1, 2, 0, 1, 3, 0, 0, 0];
  var $l = $('#rlist');
  DOCS.forEach(function (d, i) {
    $l.append('<div style="display:flex;gap:.5rem;align-items:center;margin:2px 0;font-size:.85rem"><b style="width:1.6rem">#' + (i + 1) + '</b><span style="flex:1">' + d + '</span>' +
      '<select class="rel" data-i="' + i + '"><option value="0">0 irrelevant</option><option value="1">1 partial</option><option value="2">2 relevant</option><option value="3">3 perfect</option></select></div>');
  });
  function calc() {
    var k = +$('#rk').val(), g = $('.rel').map(function () { return +this.value; }).get(), i;
    var inList = g.filter(function (x) { return x > 0; }).length, tot = Math.max(1, inList, +$('#rtot').val());   // cannot be fewer than those marked
    if (+$('#rtot').val() < inList) $('#rtot').val(inList);
    $('#rk-v').text(k);
    var top = g.slice(0, k), relTop = top.filter(function (x) { return x > 0; }).length, firstRel = g.findIndex(function (x) { return x > 0; });
    var prec = relTop / k, rec = Math.min(1, relTop / tot), f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0, mrr = firstRel >= 0 ? 1 / (firstRel + 1) : 0;
    var apSum = 0, hits = 0; for (i = 0; i < k; i++) if (g[i] > 0) { hits++; apSum += hits / (i + 1); }
    var ap = apSum / tot, dcg = 0, idcg = 0, ideal = g.slice().sort(function (a, b) { return b - a; });
    for (i = 0; i < k; i++) { dcg += (Math.pow(2, g[i]) - 1) / Math.log2(i + 2); idcg += (Math.pow(2, ideal[i]) - 1) / Math.log2(i + 2); }
    var rows = [['Precision@' + k, prec, relTop + ' relevant of the top ' + k], ['Recall@' + k, rec, relTop + ' of ' + tot + ' relevant documents retrieved'], ['F1@' + k, f1, 'harmonic mean of precision and recall'],
      ['Hit@' + k, relTop > 0 ? 1 : 0, 'at least one relevant item in the top ' + k], ['MRR (this query)', mrr, firstRel >= 0 ? 'first relevant at rank ' + (firstRel + 1) : 'none found'], ['Average precision', ap, 'precision averaged at each relevant rank'],
      ['nDCG@' + k, idcg ? dcg / idcg : 0, 'graded: DCG ' + dcg.toFixed(2) + ' / ideal ' + idcg.toFixed(2)]];
    $('#rout').html('<div class="table-wrap"><table class="result-table"><tr><th>Metric</th><th>Value</th><th>Why</th></tr>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1].toFixed(2) + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</table></div>' +
      '<p class="muted">Note the outdated 2019 policy at rank 3: it is "partially relevant" for search but dangerous for RAG, because it may produce a wrong answer. Track stale-document retrieval separately.</p>');
  }
  $('#rpreset').on('click', function () { $('.rel').each(function (i) { $(this).val(EXAMPLE[i]); }); $('#rtot').val(6); calc(); });
  $('#rk, #rtot').on('input', calc); $l.on('change', 'select', calc);
  $('#rpreset').click();

  // ---------------------------------------------------------------- faithfulness stepper
  var CTX = 'Refunds are available within 30 days of delivery for unused items. Refunds go back to the original payment method within 5-7 business days. Digital gift cards cannot be refunded.';
  var CLAIMS = [['You can get a refund within 30 days of delivery.', 'SUPPORTED', 'The context states the 30-day window from delivery.'],
    ['Items must be unused.', 'SUPPORTED', 'Explicitly stated.'], ['The money returns to your original payment method.', 'SUPPORTED', 'Explicitly stated.'],
    ['It usually arrives within 24 hours.', 'CONTRADICTED', 'The context says 5-7 business days.'], ['Shipping costs are also refunded.', 'NOT_FOUND', 'The context does not mention shipping costs: a hallucination even if it happens to be true.']];
  function ff() {
    var F = [], verdicts = [];
    F.push({ v: [], i: -1, msg: 'The question was "How do refunds work?". Step 1: an LLM judge (or NLI model) splits the generated answer into atomic factual claims.' });
    CLAIMS.forEach(function (c, i) { verdicts.push(c[1]); F.push({ v: verdicts.slice(), i: i, msg: 'Claim ' + (i + 1) + ': "' + c[0] + '" → ' + c[1] + '. ' + c[2] }); });
    var sup = verdicts.filter(function (v) { return v === 'SUPPORTED'; }).length;
    F.push({ v: verdicts, i: -1, msg: 'Faithfulness = ' + sup + ' / ' + CLAIMS.length + ' = ' + (sup / CLAIMS.length).toFixed(2) + '. One claim contradicts the context and one is unsupported, so this answer counts towards the hallucination rate. A good system would have said "5-7 business days" and not mentioned shipping costs.' });
    return F;
  }
  function frender(f, ctx) {
    ctx.stage.append('<div class="readout"><b>Context (retrieved):</b> ' + CTX + '</div>');
    var rows = CLAIMS.map(function (c, i) { return [c[0], f.v[i] || '?']; }), marks = {};
    CLAIMS.forEach(function (c, i) { if (f.v[i]) marks[i + ',1'] = f.v[i] === 'SUPPORTED' ? 'ok' : f.v[i] === 'CONTRADICTED' ? 'c' : 'b'; if (i === f.i) marks[i + ',0'] = 'a'; });
    DSA.grid(ctx.stage, rows, { marks: marks, colHead: ['Claim extracted from the answer', 'Verdict'] });
  }
  DSA.player('#faith-demo', ff(), frender, { speed: 1500 });

  // ---------------------------------------------------------------- agent trajectory scoring
  var EXPECT = ['search_orders(customer)', 'get_order(id)', 'create_return(id, reason)', 'reply to user'];
  var RUNS = {
    good: [['search_orders(customer=9)', 'ok', 'correct tool, correct args'], ['get_order(id=1182)', 'ok', 'correct'], ['create_return(id=1182, reason="damaged")', 'ok', 'correct'], ['reply: "Return created, label emailed"', 'ok', 'goal met']],
    wander: [['search_products("mug")', 'b', 'unnecessary tool'], ['search_orders(customer=9)', 'ok', 'correct'], ['get_order(id=1182)', 'ok', 'correct'], ['get_order(id=1182)', 'b', 'duplicate call'], ['create_return(id=1182, reason="damaged")', 'ok', 'correct'], ['reply: "Return created"', 'ok', 'goal met']],
    bad: [['search_orders(customer=9)', 'ok', 'correct'], ['cancel_order(id=1182)', 'c', 'WRONG tool: a destructive action'], ['reply: "Your order is cancelled"', 'c', 'goal not met, policy violation']]
  };
  function traj() {
    var run = RUNS[$('#traj').val()], ok = run.filter(function (s) { return s[1] === 'ok'; }).length, wrong = run.filter(function (s) { return s[1] === 'c'; }).length;
    var success = $('#traj').val() !== 'bad', marks = {};
    run.forEach(function (s, i) { marks[i + ',1'] = s[1]; });
    var $o = $('#traj-out').empty();
    $o.append('<p class="muted">Task: "I want to return my damaged mug." Reference trajectory: ' + EXPECT.join(' → ') + '</p>');
    DSA.grid($o, run.map(function (s, i) { return [i + 1, s[0], s[2]]; }), { marks: (function () { var m = {}; run.forEach(function (s, i) { m[i + ',1'] = s[1]; }); return m; })(), colHead: ['Step', 'Agent action', 'Assessment'] });
    $o.append('<div class="readout">Task success: <b>' + (success ? 'yes' : 'no') + '</b> &middot; tool selection accuracy: <b>' + Math.round(ok / run.length * 100) + '%</b> &middot; steps: <b>' + run.length + '</b> (reference ' + EXPECT.length + ', efficiency ' + Math.round(Math.min(1, EXPECT.length / run.length) * 100) + '%)' +
      ' &middot; policy violations: <b>' + wrong + '</b>' + (wrong ? ' &mdash; a destructive tool should have required confirmation; fix permissions, not just the prompt.' : '') + '</div>');
  }
  $('#traj').on('change', traj); traj();

  // ---------------------------------------------------------------- A/B win rate and kappa
  function wilson(p, n) { var z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
  function ab() {
    var n = Math.max(1, +$('#ab-n').val()), w = +$('#ab-w').val(), t = +$('#ab-t').val(), decisive = Math.max(1, n - t), p = w / decisive, ci = wilson(p, decisive);
    $('#ab-out').html('Win rate among decisive comparisons: <b>' + (p * 100).toFixed(1) + '%</b> (95% interval ' + (ci[0] * 100).toFixed(1) + '% to ' + (ci[1] * 100).toFixed(1) + '%). ' +
      (ci[0] > 0.5 ? '<b>The new version is significantly better.</b>' : ci[1] < 0.5 ? '<b>The new version is significantly worse.</b>' : 'Not significant yet: collect more comparisons (the interval includes 50%).') +
      ' Swap the answer order for half of the comparisons to cancel the judge’s position bias.');
  }
  function kappa() {
    var a = +$('#k-gg').val(), b = +$('#k-gb').val(), c = +$('#k-bg').val(), d = +$('#k-bb').val(), n = Math.max(1, a + b + c + d);
    var po = (a + d) / n, pe = ((a + b) / n) * ((a + c) / n) + ((c + d) / n) * ((b + d) / n), k = pe < 1 ? (po - pe) / (1 - pe) : 1;
    $('#k-out').html('Raw agreement <b>' + (po * 100).toFixed(1) + '%</b>, Cohen’s kappa <b>' + k.toFixed(2) + '</b>: ' + (k > 0.8 ? 'almost perfect' : k > 0.6 ? 'substantial: usable as an automated judge, keep spot-checking' : k > 0.4 ? 'moderate: improve the rubric or examples' : 'weak: do not trust this judge yet') + '. Kappa corrects for agreement that would happen by chance.');
  }
  $('#ab-n, #ab-w, #ab-t').on('input', ab); $('#k-gg, #k-gb, #k-bg, #k-bb').on('input', kappa); ab(); kappa();

  // ---------------------------------------------------------------- evaluation loop
  var E = { nodes: [['dev', 'Change: prompt / model / index', 'svc', 0, 0.2], ['ds', 'Golden + regression sets', 'db', 0, 1.6], ['run', 'Eval runner (CI)', 'job', 1.4, 0.9], ['app', 'AI app under test', 'svc', 2.8, 0.2],
    ['judge', 'Judges + checks', 'llm', 2.8, 1.6, 'LLM judge, code checks'], ['gate', 'Release gate', 'gw', 4.2, 0.9], ['prod', 'Production', 'svc', 5.6, 0.9], ['tr', 'Traces + feedback', 'stream', 5.6, 2.2], ['dash', 'Dashboards + alerts', 'svc', 4.2, 2.4]],
    edges: [['dev', 'run'], ['ds', 'run'], ['run', 'app'], ['run', 'judge'], ['run', 'gate'], ['gate', 'prod'], ['prod', 'tr', '', 'async'], ['tr', 'judge', '', 'async'], ['judge', 'dash'], ['tr', 'ds', 'new test cases', 'async']] };
  SD.multi('#ev-demo', [
    { name: 'Offline (before release)', desc: 'Every change is evaluated like code in CI.', diagram: E, steps: [
      ['dev', 'run', 'pull request: new prompt v14', 'A change to the prompt, model, retrieval settings or tools triggers an evaluation run.'], ['ds', 'run', '500 test cases', 'The runner loads the golden set and the regression set.'],
      ['run', 'app', 'run every case (x3)', 'Each case runs through the full pipeline, several times to average out randomness.'], ['run', 'judge', 'score outputs', 'Judges and programmatic checks score faithfulness, correctness, safety, format, latency and cost.'],
      ['run', 'gate', 'compare with v13 + thresholds', 'Results are compared with the current version and the release thresholds.'], ['gate', 'prod', 'pass: canary 5%', 'Only a passing change is released, first to a small share of traffic.']] },
    { name: 'Online (in production)', desc: 'Quality is monitored continuously on real traffic.', diagram: E, steps: [
      ['prod', 'tr', 'traces, thumbs, escalations', 'Every request emits a trace: retrieved chunks, prompts, tool calls, tokens, latency, plus user feedback.', 'async'],
      ['tr', 'judge', 'sample 2% for judging', 'A sample is scored automatically (groundedness, relevance, safety) without needing references.', 'async'],
      ['judge', 'dash', 'quality trends per version', 'Dashboards track quality, cost and latency per version; alerts fire when groundedness drops or unsafe outputs rise.'],
      ['tr', 'ds', 'failures become test cases', 'Bad answers (thumbs down, escalations, judge failures) are reviewed and added to the regression set, closing the loop.', 'async']] }
  ]);

  ['azEvalHowTo', 'azEvalRag', 'azEvalAgent', 'azEvalSafety', 'azEvalText', 'azEvalGeneral', 'azObservability', 'azRagEvalPhase', 'azRagRetrieval', 'azGenAiOps'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsBedrockEval', 'awsBedrockKbEval', 'awsBedrockJudge', 'awsClarifyFm', 'awsGenAiLens', 'awsGenAiOps', 'awsRagOptions'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

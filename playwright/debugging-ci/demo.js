$(function () {
  'use strict';
  PW.pageChrome('debugging-ci');

  function esc(s) { return $('<i>').text(String(s)).html(); }

  // ---------------------------------------------------------------- 1. mock trace viewer
  // Timings come from a real trace of tests/test_cart.py::test_add_nine_pans against ShopBot.
  var TOTAL = 9200;
  var ACTS = [
    { n: 'Create page', sub: 'page fixture', t: 9, d: 2541 },
    { n: 'Navigate', sub: '/products/2', t: 2550, d: 588 },
    { n: 'Fill "9"', sub: "getByLabel('Quantity')", t: 3178, d: 258 },
    { n: 'Click', sub: "getByRole('button', { name: 'Add to cart' })", t: 3448, d: 245 },
    { n: 'Expect "to_have_text"', sub: "getByRole('status')", t: 3708, d: 5000, fail: true }
  ];
  var CODE = [
    'def test_add_nine_pans(page: Page):',
    '    page.goto("/products/2")                                   # Cast Iron Pan, 8 in stock',
    '    page.get_by_label("Quantity").fill("9")',
    '    page.get_by_role("button", name="Add to cart").click()',
    '    expect(page.get_by_role("status")).to_have_text("Only 8 in stock")'
  ];
  var NET_GET = '#  Method  Status  Name          Duration  Size\n1  GET     200     /products/2   463ms     2.1K';
  var CLICK_LOG = 'waiting for get_by_role("button", name="Add to cart")\n  locator resolved to <button type="submit">Add to cart</button>\nattempting click action\n  waiting for element to be visible, enabled and stable\n  element is visible, enabled and stable\n  scrolling into view if needed\n  performing click action\n  click action done\n  waiting for scheduled navigations to finish\n  navigations have finished';
  var EXPECT_LOG = 'Expect "to_have_text" get_by_role("status") with timeout 5000ms\nwaiting for get_by_role("status")\n  locator resolved to <p id="msg" role="status"></p>\n  unexpected value ""\n  locator resolved to <p id="msg" role="status"></p>\n  unexpected value ""\n  ... (retried for 5 s)';

  // a frame: act (index, -1 = none), phase (before/action/after), page (state), tab, body (bottom panel text), line, msg, hl (highlight in body)
  var TF = [
    { act: -1, phase: '', page: 'blank', tab: 'Actions', body: 'Select an action on the left (or press Play).', line: undefined,
      msg: 'The trace viewer: the timeline (filmstrip) at the top, the list of actions on the left, the DOM snapshot of the selected moment on the right, and tabs for the call log, network, console, errors and source below.' },
    { act: 0, phase: 'after', page: 'blank', tab: 'Call log', body: 'new page created (about:blank)', line: 0,
      msg: 'Action 1, "Create page", is the page fixture: 2.5 s because the browser was starting for the first test of the session. Later tests reuse the browser and take milliseconds.' },
    { act: 1, phase: 'before', page: 'blank', tab: 'Network', body: '(no requests yet)', line: 1,
      msg: 'Action 2, Navigate. The "Before" snapshot is the empty page. Every action has before, action and after snapshots.' },
    { act: 1, phase: 'after', page: 'pan', tab: 'Network', body: NET_GET, line: 1,
      msg: 'After navigation: the product page is loaded. Network shows GET /products/2, 200, 2.1 kB. These snapshots are real DOM: you can open DevTools on them in the viewer.' },
    { act: 2, phase: 'before', page: 'pan-target', tab: 'Call log', body: 'waiting for get_by_label("Quantity")\n  locator resolved to <input type="number" name="qty" value="1" min="1" max="8"/>\n  fill("9")\nattempting fill action\n  waiting for element to be visible, enabled and editable', line: 2, hl: 'max="8"',
      msg: 'Action 3, Fill "9". The call log shows what the locator resolved to. Look closely: the input has max="8". Keep that in mind.' },
    { act: 2, phase: 'after', page: 'pan9', tab: 'Call log', body: 'fill("9") done', line: 2,
      msg: 'After the fill, the snapshot shows 9 in the Quantity box.' },
    { act: 3, phase: 'action', page: 'pan9-click', tab: 'Call log', body: CLICK_LOG, line: 3,
      msg: 'Action 4, Click. The "Action" snapshot marks the exact click point with a red dot. The call log shows all the actionability checks passed: the click itself worked.' },
    { act: 3, phase: 'after', page: 'pan9', tab: 'Network', body: NET_GET + '\n\n(no POST /api/cart)', line: 3, hl: '(no POST /api/cart)',
      msg: 'After the click, the Network tab still has only the page request. The page never called POST /api/cart, so the server could not have answered "Only 8 in stock".' },
    { act: 4, phase: 'action', page: 'pan9-status', tab: 'Call log', body: EXPECT_LOG, line: 4, hl: 'unexpected value ""',
      msg: 'Action 5, the assertion. It polls for 5 s; the status paragraph exists but stays empty. The long red bar on the timeline is this timeout.' },
    { act: 4, phase: 'action', page: 'pan9-status', tab: 'Console', body: '0:03.275  error  Failed to load resource: the server responded with a status of 404 (Not Found)  favicon.ico', line: 4,
      msg: 'Console: only a favicon 404, which ShopBot produces on every page. Noise, not the cause. Knowing your normal noise makes real errors stand out.' },
    { act: 4, phase: 'action', page: 'pan9-status', tab: 'Errors', body: '✗ Expect "to_have_text" getByRole(\'status\')\n    at test_cart.py:8\n\nLocator expected to have text \'Only 8 in stock\'\nActual value: ""', line: 4,
      msg: 'Errors and Source point at the assertion line in the test.' },
    { act: 4, phase: 'action', page: 'pan9-status', tab: 'Network', body: NET_GET + '\n\n(no POST /api/cart) -> the submit never happened', line: 4, hl: '(no POST /api/cart) -> the submit never happened',
      msg: 'Diagnosis: the browser\'s built-in validation (max="8") blocked the form submit, and the native validation bubble is browser UI, so it is not in the DOM snapshot. The test assumed the wrong behaviour; see the two better tests below the animation.' }
  ];

  function pageHtml(state) {
    if (state === 'blank') return { url: 'about:blank', body: '<span class="muted">(empty page)</span>' };
    var qty = state.indexOf('pan9') === 0 ? '9' : '1';
    var qcls = state === 'pan-target' ? ' act' : '';
    var bcls = state === 'pan9-click' ? ' act' : '';
    var scls = state === 'pan9-status' ? ' bad' : '';
    var body = '<b style="font-size:1rem">Cast Iron Pan</b><div>&pound;39.50 &middot; A 26 cm pre-seasoned pan for all hobs.</div>' +
      '<div style="margin-top:.3rem">Quantity <span class="el' + qcls + '">' + qty + ' &#8661;</span><span class="el' + bcls + '" style="position:relative">Add to cart' +
      (state === 'pan9-click' ? '<i class="dot" style="left:42%;top:30%"></i>' : '') + '</span></div>' +
      '<div style="margin-top:.2rem">status: <span class="el' + scls + '" style="min-width:5rem">&nbsp;</span></div>' +
      '<div class="muted" style="margin-top:.3rem">Reviews: Heavy but excellent.</div>';
    return { url: '127.0.0.1:8000/products/2', body: body };
  }

  function traceRender(f, ctx) {
    var cur = f.act, html = '<div class="tv">';
    // filmstrip / timeline
    html += '<div class="tv-film" aria-hidden="true">';
    ACTS.forEach(function (a, i) {
      var left = a.t / TOTAL * 100, w = Math.max(a.d / TOTAL * 100, 2.2);
      html += '<div class="seg' + (i === cur ? ' cur' : '') + (a.fail ? ' fail' : '') + '" style="left:' + left.toFixed(2) + '%;width:' + w.toFixed(2) + '%" title="' + esc(a.n) + '">' + esc(a.n) + '</div>';
    });
    if (cur >= 0) {
      var a = ACTS[cur], at = f.phase === 'before' ? a.t : (f.phase === 'after' ? a.t + a.d : a.t + Math.min(a.d, 200));
      html += '<div class="head" style="left:' + (at / TOTAL * 100).toFixed(2) + '%"></div>';
    }
    html += '</div><div class="tv-main"><div class="tv-acts">';
    ACTS.forEach(function (a, i) {
      var cls = (i === cur ? 'cur ' : '') + (a.fail ? 'fail ' : '') + (cur >= 0 && i > cur ? 'dim' : '');
      html += '<div class="' + cls + '"><span>' + (i + 1) + '. ' + esc(a.n) + '<br><small>' + esc(a.sub) + '</small></span><small>' + (a.d >= 1000 ? (a.d / 1000).toFixed(1) + 's' : a.d + 'ms') + '</small></div>';
    });
    var p = pageHtml(f.page);
    html += '</div><div class="tv-snap"><div class="tv-tabs">' + ['before', 'action', 'after'].map(function (ph) {
      return '<span class="' + (ph === f.phase ? 'on' : '') + '">' + ph.charAt(0).toUpperCase() + ph.slice(1) + '</span>';
    }).join('') + '</div><div class="mockbrowser"><div class="chrome"><i></i><i></i><i></i><span class="url">' + esc(p.url) + '</span></div><div class="viewport">' + p.body + '</div></div></div></div>';
    // bottom tabs
    var body = esc(f.body);
    if (f.hl) body = body.split(esc(f.hl)).join('<span class="hl">' + esc(f.hl) + '</span>');
    html += '<div class="tv-bottom"><div class="tv-tabs">' + ['Call log', 'Network', 'Console', 'Errors', 'Source'].map(function (t) {
      return '<span class="' + (t === f.tab ? 'on' : '') + '">' + t + '</span>';
    }).join('') + '</div><pre><code>' + body + '</code></pre></div></div>';
    ctx.stage.html(html);
  }
  DSA.player('#trace-demo', TF, traceRender, { speed: 1500, code: CODE });

  // ---------------------------------------------------------------- 2. race: one-shot read vs expect
  var MACHINES = {
    fast: { max: 40, ticks: [0, 10, 20, 30, 40], fetchEnd: 16, name: 'fast laptop' },
    ci: { max: 400, ticks: [0, 100, 200, 300, 400], fetchEnd: 310, name: 'busy CI runner' }
  };
  var RACE_CODE = [
    'page.get_by_role("button", name="Add to cart").click()',
    'assert page.get_by_test_id("cart-count").inner_text() == "1"     # one-shot read',
    '',
    'page.get_by_role("button", name="Add to cart").click()',
    'expect(page.get_by_test_id("cart-count")).to_have_text("1")       # retries'
  ];
  function raceFrames(m) {
    var M = MACHINES[m], badge = M.fetchEnd + 2, read = m === 'fast' ? 22 : 25, F = [], ev = [];
    var clickEv = { lane: 0, t0: 0, t1: 8, label: 'click()', cls: '' };
    var fetchEv = { lane: 1, t0: 8, t1: M.fetchEnd, label: 'fetch POST /api/cart', cls: 'req' };
    var srvEv = { lane: 2, t0: 9, t1: M.fetchEnd - 1, label: 'add to cart', cls: '' };
    var badgeEv = { lane: 1, t0: badge, t1: badge + (m === 'fast' ? 4 : 40), label: 'badge = 1', cls: 'ok' };
    var early = read < badge;
    var readEv = { lane: 0, t0: read, t1: read + (m === 'fast' ? 3 : 30), label: 'inner_text() -> "' + (early ? '0' : '1') + '"', cls: early ? 'bad' : 'ok' };
    function push(list, msg, now, line) { F.push({ ev: list.slice(), msg: msg, now: now, m: m, line: line }); }
    ev.push(clickEv); push(ev, 'One-shot read on the ' + M.name + '. click() returns as soon as the click is dispatched; it does not wait for the page\'s JavaScript to finish.', 8, 0);
    ev.push(fetchEv, srvEv); push(ev, 'The page\'s submit handler starts a fetch to POST /api/cart. On this machine the round trip takes about ' + (M.fetchEnd - 8) + ' ms.', 10, 0);
    if (early) {
      ev.push(readEv); push(ev, 'Python reads the badge at ' + read + ' ms: the response has not arrived, so inner_text() returns "0" and the assert fails.', read, 1);
      ev.push(badgeEv); push(ev, 'The response arrives at ' + M.fetchEnd + ' ms and the badge becomes 1, but the test already failed. This is a flaky test: it depends on timing.', badge, 1);
    } else {
      ev.push(badgeEv); push(ev, 'On localhost the response is back at ' + M.fetchEnd + ' ms and the badge becomes 1...', badge, 1);
      ev.push(readEv); push(ev, '...before Python reads it at ' + read + ' ms, so the assert passes. It passes every time on your laptop, which is why it survives code review. Switch to the CI runner.', read, 1);
    }
    // expect scenario
    var ev2 = [clickEv, fetchEv, srvEv];
    push(ev2, 'Now with expect(): the same click and fetch.', 10, 3);
    var polls = m === 'fast' ? [22] : [25, 125, 225, 325];
    polls.forEach(function (t, i) {
      var seen = t >= badge;
      if (seen && ev2.indexOf(badgeEv) < 0) ev2.push(badgeEv);
      ev2.push({ lane: 0, t0: t, t1: t + (m === 'fast' ? 3 : 24), label: seen ? 'check: "1" pass' : 'check: "0" retry', cls: seen ? 'ok' : 'poll' });
      push(ev2, seen ? 'Check at ' + t + ' ms sees "1": the assertion passes as soon as the page is ready, however slow the machine.' :
        'Check at ' + t + ' ms sees "0". expect() does not fail: it waits briefly and checks again (up to the 5 s timeout).', t, 4);
    });
    return F;
  }
  function raceRender(f, ctx) {
    var M = MACHINES[f.m], lanes = ['Test (Python)', 'Browser', 'ShopBot server'];
    var html = '<div class="lanes" style="min-width:520px">';
    lanes.forEach(function (name, li) {
      html += '<div class="lane"><b>' + name + '</b><div style="position:absolute;left:100px;right:8px;top:0;bottom:0">';
      f.ev.filter(function (e) { return e.lane === li; }).forEach(function (e) {
        var l = e.t0 / M.max * 100, w = Math.max((e.t1 - e.t0) / M.max * 100, 3);
        html += '<div class="blk ' + e.cls + '" style="left:' + l.toFixed(2) + '%;max-width:' + Math.max(w, 30).toFixed(2) + '%;min-width:' + w.toFixed(2) + '%" title="' + esc(e.label) + '">' + esc(e.label) + '</div>';
      });
      html += '</div></div>';
    });
    html += '<div class="axis" style="margin-left:100px;margin-right:8px">' + M.ticks.map(function (t) { return '<span style="left:' + (t / M.max * 100) + '%' + (t === M.max ? ';transform:translateX(-100%)' : '') + '">' + t + ' ms</span>'; }).join('') + '</div>';
    html += '<div style="position:absolute;left:100px;right:8px;top:0;bottom:18px;pointer-events:none"><div class="now" style="left:' + (Math.min(f.now, M.max) / M.max * 100).toFixed(2) + '%"></div></div>';
    html += '</div>';
    ctx.stage.html(html);
  }
  var race = DSA.player('#race-demo', raceFrames('fast'), raceRender, { speed: 1500, code: RACE_CODE });
  $('#race-machine').on('change', function () { race.set(raceFrames(this.value)); });

  // ---------------------------------------------------------------- 3. CI pipeline
  var D = {
    nodes: [['dev', 'Developer', 'client', 0, 1, 'git push / pull request'], ['gh', 'GitHub Actions', 'gw', 1.3, 1, 'e2e.yml workflow'],
      ['s1', 'Shard 1', 'svc', 2.7, 0, 'pytest -n auto'], ['s2', 'Shard 2', 'svc', 2.7, 1, 'pytest -n auto'], ['s3', 'Shard 3', 'svc', 2.7, 2, 'pytest -n auto'],
      ['app', 'ShopBot', 'ext', 4.3, 0, 'started in each job'], ['art', 'Artifacts', 'blob', 4.3, 2, 'traces, junit, html'], ['tri', 'Triage agent', 'agent', 5.6, 1, 'playwright trace CLI']],
    edges: [['dev', 'gh'], ['gh', 's1'], ['gh', 's2'], ['gh', 's3'], ['s1', 'app', '', 'none'], ['s2', 'app', '', 'none'], ['s3', 'app', '', 'none'],
      ['s1', 'art', '', 'async'], ['s2', 'art', '', 'async'], ['s3', 'art', '', 'async'], ['art', 'tri']]
  };
  PW.flows('#ci-demo', D, [
    { name: 'Green pull request', desc: 'A pull request runs the suite on three machines, each with several xdist workers.', steps: [
      ['dev', 'gh', 'pull_request', 'A pull request triggers the workflow.'],
      { par: [['gh', 's1', 'group 1'], ['gh', 's2', 'group 2'], ['gh', 's3', 'group 3']], msg: 'The matrix starts three jobs. Each installs dependencies (pip cache), runs playwright install --with-deps chromium, and starts ShopBot.' },
      { par: [['s1', 'app', 'browser tests'], ['s2', 'app', 'browser tests'], ['s3', 'app', 'browser tests']], msg: 'pytest-split gives each job a third of the tests by recorded duration; -n auto runs them on every CPU core.' },
      { par: [['s1', 'art', 'junit + report', 'async'], ['s2', 'art', 'junit + report', 'async'], ['s3', 'art', 'junit + report', 'async']], msg: 'Results are uploaded even on success (JUnit, HTML report). No traces: with retain-on-failure only failed tests keep one.' },
      ['gh', 'dev', 'all checks passed', 'The status check turns green and the pull request can merge.', 'resp']] },
    { name: 'A failure in shard 2', desc: 'One test fails on CI only. The trace makes it debuggable without reproducing it locally.', steps: [
      ['dev', 'gh', 'pull_request', 'Same pipeline, new commit.'],
      { par: [['gh', 's1', 'group 1'], ['gh', 's2', 'group 2'], ['gh', 's3', 'group 3']], msg: 'Three shards start; fail-fast: false lets them all finish.' },
      ['s2', 'app', 'expect(...)', 'A test in shard 2 waits for a cart badge that updates too late for a one-shot read.'],
      ['app', 's2', 'assertion timeout', 'The test fails. pytest-playwright keeps trace.zip, a screenshot and the video for that test.', 'err'],
      ['s2', 'art', 'test-results/', 'The upload step runs because of if: !cancelled(): the trace reaches the artifact store.', 'async'],
      ['art', 'tri', 'download', 'A triage job (or a coding agent) downloads the artifact.'],
      ['tri', 'dev', 'PR comment', 'It runs playwright trace actions --errors-only, requests --failed, console --errors-only and posts a short summary.', 'async'],
      ['dev', 'art', 'show-trace', 'The developer opens the same trace in the viewer, sees the race, and replaces the read with expect().']] },
    { name: 'Docker image variant', desc: 'The jobs run inside mcr.microsoft.com/playwright/python:v1.64.1-noble, so browsers and system libraries are already there.', steps: [
      ['dev', 'gh', 'push to main', 'Same trigger.'],
      { par: [['gh', 's1', 'container job'], ['gh', 's2', 'container job'], ['gh', 's3', 'container job']], msg: 'container: image: mcr.microsoft.com/playwright/python:v1.64.1-noble. No playwright install step; pip install pins playwright==1.64.1 to match the tag.' },
      { par: [['s1', 'app', 'tests'], ['s2', 'app', 'tests'], ['s3', 'app', 'tests']], msg: 'Identical fonts and rendering on every run: the best setting for screenshot comparisons.' },
      ['gh', 'dev', 'checks passed', 'Upgrade the image tag and the pip pin together in one pull request.', 'resp']] }
  ]);
  $('#ci-legend').html(PW.legend([['client', 'developer'], ['gw', 'CI orchestrator'], ['svc', 'CI jobs (shards)'], ['ext', 'app under test'], ['data', 'artifact storage'], ['ai', 'triage agent']]));
});

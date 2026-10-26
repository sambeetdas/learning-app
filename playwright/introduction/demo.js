$(function () {
  'use strict';
  PW.pageChrome('introduction');

  // ---------------------------------------------------------------- browser / context / page isolation
  var CODE = [
    'browser = p.chromium.launch()',
    'alice = browser.new_context()',
    'page_a = alice.new_page()',
    'page_a.goto("/login")  # ...fill email + password, click "Log in"',
    'tab2 = alice.new_page(); tab2.goto("/account")',
    'guest = browser.new_context()',
    'page_g = guest.new_page(); page_g.goto("/account")',
    'alice.close()',
    'browser.close()'
  ];
  var A = 'Context A (Alice)', G = 'Context B (guest)';
  function C(name, jar, pages, o) { return $.extend({ name: name, jar: jar, pages: pages }, o || {}); }
  function P(url, body, o) { return $.extend({ url: url, body: body }, o || {}); }
  var F = [
    { line: 0, browser: true, ctxs: [], msg: 'launch() starts one browser process. It is the expensive part (hundreds of milliseconds), so tests share it.' },
    { line: 1, browser: true, ctxs: [C(A, 'cookies: (empty)', [], { cls: 'new' })], msg: 'new_context() creates an isolated, incognito-like profile inside the browser in a few milliseconds. Its cookie jar starts empty.' },
    { line: 2, browser: true, ctxs: [C(A, 'cookies: (empty)', [P('about:blank', '', { cls: 'act' })])], msg: 'new_page() opens a tab inside the context.' },
    { line: 3, browser: true, ctxs: [C(A, 'cookies: sid=9f3c... (Alice)', [P('/account', 'Signed in as Alice', { cls: 'act ok' })], { hot: true })], msg: 'Alice logs in. ShopBot sets a session cookie, and it is stored in context A\'s cookie jar only.' },
    { line: 4, browser: true, ctxs: [C(A, 'cookies: sid=9f3c... (Alice)', [P('/account', 'Signed in as Alice'), P('/account', 'Signed in as Alice', { cls: 'act ok' })])], msg: 'A second page in the same context is like a second tab: it shares the cookie, so it is logged in too.' },
    { line: 5, browser: true, ctxs: [C(A, 'cookies: sid=9f3c... (Alice)', [P('/account', 'Signed in as Alice'), P('/account', 'Signed in as Alice')]), C(G, 'cookies: (empty)', [], { cls: 'new' })], msg: 'A second context in the same browser process. Nothing is shared with context A: not cookies, not local storage, not cache.' },
    { line: 6, browser: true, ctxs: [C(A, 'cookies: sid=9f3c... (Alice)', [P('/account', 'Signed in as Alice'), P('/account', 'Signed in as Alice')]), C(G, 'cookies: sid=27ab... (guest)', [P('/login', 'Redirected: please log in', { cls: 'act bad' })], { hot: true })], msg: 'The guest opens /account and is redirected to /login: its jar has no session. Two users, one browser, no interference. This is how parallel tests stay independent.' },
    { line: 7, browser: true, ctxs: [C(A, 'cookies: (discarded)', [], { cls: 'gone' }), C(G, 'cookies: sid=27ab... (guest)', [P('/login', 'Log in form')])], msg: 'Closing a context closes its pages and throws away its cookies and storage. The other context is unaffected.' },
    { line: 8, browser: false, ctxs: [], msg: 'browser.close() ends the process. pytest-playwright does all of this for you: one browser per session, a fresh context and page per test.' }
  ];
  function render(f, ctx) {
    if (!f.browser) { ctx.stage.append('<div class="empty">(no browser running)</div>'); return; }
    var $b = $('<div class="bp"><div class="bt">Browser process: Chromium</div></div>'), $cs = $('<div class="ctxs">').appendTo($b);
    if (!f.ctxs.length) $cs.append('<div class="empty">No contexts yet.</div>');
    f.ctxs.forEach(function (c) {
      var $c = $('<div class="ctx">').addClass(c.cls || '').appendTo($cs);
      $('<h4>').text(c.name).appendTo($c);
      $('<div class="jar">').toggleClass('hot', !!c.hot).text(c.jar).appendTo($c);
      var $t = $('<div class="tiles">').appendTo($c);
      if (!c.pages.length) $t.append('<div class="empty">' + (c.cls === 'gone' ? 'closed' : 'no pages') + '</div>');
      c.pages.forEach(function (p, i) {
        $('<div class="tile">').addClass(p.cls || '').append($('<div class="u">').text('Page ' + (i + 1) + ': ' + p.url), $('<div class="b">').text(p.body)).appendTo($t);
      });
    });
    ctx.stage.append($b);
  }
  DSA.player('#ctx-demo', F, render, { speed: 1500, code: CODE });

  // ---------------------------------------------------------------- a pytest run
  var D = {
    nodes: [['py', 'pytest', 'client', 0, 1, 'test session'], ['fx', 'pytest-playwright', 'svc', 1.3, 1, 'fixtures'], ['drv', 'Playwright driver', 'gw', 2.6, 1, 'Node.js, bundled'],
      ['br', 'Browser', 'ext', 3.9, 0, 'one per session'], ['cx', 'Context + page', 'ext', 3.9, 2, 'one per test'], ['app', 'ShopBot', 'svc', 5.2, 1, '127.0.0.1:8000']],
    edges: [['py', 'fx'], ['fx', 'drv', 'JSON over pipe'], ['drv', 'br'], ['drv', 'cx'], ['br', 'cx', '', 'none'], ['cx', 'app']]
  };
  PW.flows('#run-demo', D, [
    { name: 'Session start', desc: 'pytest collects tests and the plugin prepares the shared browser.', steps: [
      ['py', 'fx', 'request fixture "page"', 'pytest sees that test_search(page) needs the page fixture, which depends on context, browser and playwright.'],
      ['fx', 'drv', 'start driver', 'The playwright fixture starts the driver process once for the whole session.'],
      ['drv', 'br', 'launch chromium', 'The browser fixture (session scope) launches one browser, using --browser and --headed from the command line.']] },
    { name: 'Each test', desc: 'Every test gets a brand-new context and page, then they are thrown away.', steps: [
      ['fx', 'drv', 'new_context()', 'The context fixture (function scope) creates a fresh context with browser_context_args and --base-url.'],
      ['drv', 'cx', 'new page', 'The page fixture opens one tab in that context and hands it to your test.'],
      ['cx', 'app', 'goto("/products")', 'Your test navigates, clicks and asserts. Relative URLs are resolved against --base-url.'],
      ['app', 'cx', 'HTML, JSON', 'The app responds; auto-waiting and expect() retries absorb the timing differences.', 'resp'],
      ['cx', 'drv', 'trace, screenshot', 'At teardown the plugin saves artifacts if you asked for them (--tracing, --screenshot, --video) into test-results/.', 'resp'],
      ['drv', 'fx', 'context closed', 'The context is closed: its cookies and storage vanish, so the next test starts clean.', 'resp']] },
    { name: 'A failure', desc: 'What you get back when an assertion fails.', steps: [
      ['cx', 'app', 'expect(...).to_have_text', 'expect() polls the page for up to 5 seconds (the default) waiting for the text.'],
      ['cx', 'drv', 'AssertionError + call log', 'It never appears: Playwright raises AssertionError with the expected and actual values and a call log.', 'err'],
      ['drv', 'fx', 'retain-on-failure', 'With --tracing retain-on-failure the trace of the failing test is kept; passing tests leave nothing behind.', 'resp'],
      ['fx', 'py', 'F in the report', 'pytest reports the failure. Open the trace with playwright show-trace to see every step.', 'err']] }
  ]);
  $('#run-legend').html(PW.legend());
});

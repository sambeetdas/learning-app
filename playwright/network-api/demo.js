$(function () {
  'use strict';
  PW.pageChrome('network-api');

  function esc(s) { return $('<i>').text(s).html(); }

  // ---------------------------------------------------------------- 1. route fates (architecture flows)
  var RD = {
    nodes: [['t', 'Your test', 'client', 1.7, 0, 'pytest'], ['pg', 'Browser page', 'ext', 0, 1, 'fetch POST /api/cart'],
      ['rt', 'Route handler', 'svc', 1.7, 1, 'page.route(...)'], ['fk', 'Fake response', 'blob', 3.4, 0, 'route.fulfill(json=)'],
      ['srv', 'ShopBot server', 'svc', 3.4, 2, '127.0.0.1:8000']],
    edges: [['t', 'rt', 'registers'], ['pg', 'rt', 'matched URL'], ['rt', 'fk'], ['rt', 'srv'], ['pg', 'srv', 'no match', 'none']]
  };
  PW.flows('#route-demo', RD, [
    { name: 'Fulfilled from a fake', desc: 'route.fulfill(json=...): the handler answers and the server is never contacted.', steps: [
      ['t', 'rt', 'page.route("**/api/cart")', 'Before the click, the test registers a handler for URLs matching **/api/cart.'],
      ['pg', 'rt', 'POST /api/cart', 'The shopper clicks "Add to cart" and the page calls fetch(). The URL matches, so Playwright pauses the request and calls the handler with a Route object.'],
      ['rt', 'fk', 'route.fulfill(json=...)', 'The handler builds a fake response in Python. Nothing is sent to the network.'],
      ['fk', 'rt', '200 {"count": 42}', 'Status 200, Content-Type application/json, body {"count": 42}.', 'resp'],
      ['rt', 'pg', '200 {"count": 42}', 'The browser receives it exactly as if the server had sent it: the status says "Added to cart" and the badge shows 42.', 'resp']],
      end: 'The server never saw the request, so the test fully controls the data: perfect for edge cases that are hard to create for real.' },
    { name: 'Passed through', desc: 'route.continue_(): the request goes on to the real server, optionally modified.', steps: [
      ['pg', 'rt', 'POST /api/cart', 'Same request. This handler only wants to look at it, or add a header.'],
      ['rt', 'srv', 'route.continue_(headers=...)', 'The request continues to the real server. You may change the URL, method, headers or body on the way.'],
      ['srv', 'rt', '200 {"count": 1}', 'The real response comes back through Playwright.', 'resp'],
      ['rt', 'pg', 'real response', 'The page gets real data. Use this for logging, extra headers, or rewriting requests.', 'resp']] },
    { name: 'Modified response', desc: 'route.fetch() + route.fulfill(response=...): real server, edited answer.', steps: [
      ['pg', 'rt', 'POST /api/cart', 'The page makes its request.'],
      ['rt', 'srv', 'route.fetch()', 'The handler performs the real request itself and waits for the full response.'],
      ['srv', 'rt', '200 {"count": 1}', 'The real response arrives in Python as an APIResponse.', 'resp'],
      ['rt', 'fk', 'data["count"] += 100', 'The handler edits the JSON (or the HTML text) in Python.'],
      ['rt', 'pg', 'fulfill(response=, json=)', 'It delivers the edited body with the real status and headers. The badge shows 101.', 'resp']] },
    { name: 'Aborted', desc: 'route.abort(): the request fails like a network error.', steps: [
      ['pg', 'rt', 'POST /api/cart', 'The page makes its request.'],
      ['rt', 'pg', 'route.abort("internetdisconnected")', 'The handler fails it. fetch() rejects with "Failed to fetch". On ShopBot nothing is shown to the user: a bug this test reveals.', 'err']],
      end: 'Use abort for offline and outage tests, and to block images, fonts and analytics for speed.' },
    { name: 'Not matched', desc: 'No route matches: the request goes straight to the network.', steps: [
      ['pg', 'srv', 'GET /products', 'This URL matches no registered pattern, so no handler runs and there is no overhead.'],
      ['srv', 'pg', '200 HTML', 'The server answers directly. Tip: log page.on("request") to discover which URLs your page really calls.', 'resp']] }
  ]);
  $('#route-legend').html(PW.legend([['client', 'your test'], ['ext', 'browser'], ['svc', 'Playwright and servers'], ['data', 'fake data']]));

  // ---------------------------------------------------------------- 2. route matcher (port of Playwright's glob rules)
  var ESC = '$^+.*()|\\?{}[]';
  function globToRegex(glob) {
    var t = ['^'], inGroup = false;
    for (var i = 0; i < glob.length; i++) {
      var c = glob[i];
      if (c === '\\' && i + 1 < glob.length) { var n = glob[++i]; t.push(ESC.indexOf(n) >= 0 ? '\\' + n : n); }
      else if (c === '*') {
        var before = i > 0 ? glob[i - 1] : null, stars = 1;
        while (i + 1 < glob.length && glob[i + 1] === '*') { stars++; i++; }
        if (stars > 1) {
          var after = i + 1 < glob.length ? glob[i + 1] : null;
          if (after === '/') { t.push(before === '/' ? '((.+/)|)' : '(.*/)'); i++; } else t.push('(.*)');
        } else t.push('([^/]*)');
      } else if (c === '{') { inGroup = true; t.push('('); }
      else if (c === '}') { inGroup = false; t.push(')'); }
      else if (c === ',') t.push(inGroup ? '|' : '\\,');
      else t.push(ESC.indexOf(c) >= 0 ? '\\' + c : c);
    }
    t.push('$');
    return new RegExp(t.join(''));
  }
  var BASE = 'http://127.0.0.1:8000';
  var ROUTES = [
    { code: 'page.route("**/*", log_all)', glob: '**/*', act: 'fallback', what: 'logs the URL, then route.fallback()' },
    { code: 'page.route("**/*.{png,jpg,svg}", block)', glob: '**/*.{png,jpg,svg}', act: 'abort', what: 'route.abort()' },
    { code: 'page.route("**/api/**", add_header)', glob: '**/api/**', act: 'continue', what: 'route.continue_(headers=...)' },
    { code: 'page.route("/api/cart", mock_cart)', glob: '/api/cart', act: 'fulfill', what: 'route.fulfill(json={"count": 42})' },
    { code: 'page.route(re.compile(r"/api/products(\\?|$)"), mock_list)', re: /\/api\/products(\?|$)/, act: 'fulfill', what: 'route.fulfill(json=[...])' }
  ];
  var PRESETS = ['http://127.0.0.1:8000/api/cart', 'http://127.0.0.1:8000/api/cart?debug=1', 'http://127.0.0.1:8000/api/products?q=mug',
    'http://127.0.0.1:8000/products', 'http://127.0.0.1:8000/static/logo.png', 'https://cdn.example.com/logo.png?v=2', 'https://shop.example.com/api/cart'];
  var enabled = ROUTES.map(function () { return true; });
  PRESETS.forEach(function (u) {
    $('<button type="button">').text(u.replace('http://127.0.0.1:8000', '')).attr('title', u).on('click', function () { $('#m-url').val(u); match(); }).appendTo('#m-presets');
  });
  function matches(r, url, useBase) {
    if (r.re) return r.re.test(url);
    var g = r.glob;
    if (g[0] === '/') { if (!useBase) return false; g = BASE + g; }
    return globToRegex(g).test(url);
  }
  function match() {
    var url = $.trim($('#m-url').val()), useBase = $('#m-base').prop('checked'), winner = -1, states = [];
    for (var i = ROUTES.length - 1; i >= 0; i--) {
      if (winner >= 0) { states[i] = 'skip'; continue; }
      if (!enabled[i]) { states[i] = 'off'; continue; }
      var m = matches(ROUTES[i], url, useBase);
      if (!m) { states[i] = 'no'; continue; }
      if (ROUTES[i].act === 'fallback') states[i] = 'fall'; else { states[i] = 'win'; winner = i; }
    }
    var LBL = { off: 'unregistered', no: 'no match', fall: 'matches: falls back', win: 'matches: handles it', skip: 'not reached' };
    var rows = ROUTES.map(function (r, i) {
      var st = states[i], cls = st === 'win' ? 'm-win' : st === 'fall' ? 'm-fall' : (st === 'skip' || st === 'off') ? 'm-skip' : '';
      return '<tr class="' + cls + '"><td><input type="checkbox" class="m-en" data-i="' + i + '"' + (enabled[i] ? ' checked' : '') + ' aria-label="Route ' + (i + 1) + ' registered"></td><td>' + (i + 1) +
        '</td><td><code>' + esc(r.code) + '</code><br><span class="muted">' + esc(r.what) + '</span></td><td>' + (ROUTES.length - i) + '</td><td>' + LBL[st] + '</td></tr>';
    }).join('');
    var v, vc;
    if (winner >= 0) {
      var a = ROUTES[winner].act;
      v = 'Route ' + (winner + 1) + ' decides: ' + (a === 'fulfill' ? 'the page gets a fake response; the server is not contacted.' : a === 'abort' ? 'the request fails with a network error.' : 'the request goes to the real server with an extra header.');
      vc = a === 'abort' ? 'bad' : 'ok';
    } else {
      v = states.indexOf('fall') >= 0 ? 'Every matching handler fell back, so the request goes to the network unchanged.' : 'No route matches: the request goes straight to the network.';
      vc = 'net';
    }
    $('#m-out').html('<div class="table-wrap"><table class="rtable"><tr><th>On</th><th>Registered</th><th>Route</th><th>Checked</th><th>Result</th></tr>' + rows + '</table></div><div class="verdict ' + vc + '">' + esc(v) + '</div>');
  }
  $('#m-url').on('input', match);
  $('#m-base').on('change', match);
  $('#m-out').on('change', '.m-en', function () { enabled[+$(this).data('i')] = this.checked; match(); });
  match();

  // ---------------------------------------------------------------- 3. cookie jars
  var JD = {
    nodes: [['t', 'Your test', 'client', 0, 1, 'pytest'], ['ctx', 'Browser context', 'svc', 1.6, 0, 'cookie jar A'], ['pr', 'page.request', 'svc', 1.6, 1, 'also uses jar A'],
      ['api', 'playwright.request', 'svc', 1.6, 2, 'new_context(): jar B'], ['srv', 'ShopBot server', 'svc', 3.4, 1, 'sets the sid cookie'], ['file', 'alice.json', 'blob', 0, 2.2, 'storage state']],
    edges: [['t', 'ctx'], ['t', 'pr'], ['t', 'api'], ['ctx', 'srv'], ['pr', 'srv'], ['api', 'srv'], ['api', 'file', '', 'async'], ['file', 'ctx', '', 'async']]
  };
  PW.flows('#jar-demo', JD, [
    { name: 'page.request shares cookies', desc: 'The browser and page.request use the same cookie jar, so they act as the same shopper.', steps: [
      ['t', 'ctx', 'page.goto("/products")', 'The test opens a page in the browser context.'],
      ['ctx', 'srv', 'GET /products', 'The browser requests the page.'],
      ['srv', 'ctx', 'Set-Cookie: sid=abc', 'ShopBot creates a session and sets the sid cookie. It is stored in the context’s cookie jar (A).', 'resp'],
      ['t', 'pr', 'page.request.post(...)', 'The test calls POST /api/cart through page.request.'],
      ['pr', 'srv', 'POST /api/cart  sid=abc', 'The API request carries the same cookie, so the server adds to the same cart.'],
      ['srv', 'pr', '{"count": 3}', 'The server answers; any cookies it sets also land in jar A.', 'resp'],
      ['t', 'ctx', 'page.goto("/cart")', 'The browser now shows the three items: one user, two channels. Ideal for fast test set-up.']] },
    { name: 'playwright.request is separate', desc: 'A standalone APIRequestContext has its own, initially empty, cookie jar.', steps: [
      ['t', 'api', 'new_context(base_url=...)', 'playwright.request.new_context() creates an HTTP client with its own jar (B), unrelated to any browser.'],
      ['api', 'srv', 'POST /api/cart (no cookie)', 'There is no sid cookie, so the server cannot tell who this is. In ShopBot all cookieless clients share one anonymous cart.'],
      ['srv', 'api', '{"count": 7}', 'The browser context’s cart is not affected. Call api.get("/") first if the client needs its own session.', 'resp']] },
    { name: 'Handing over a login', desc: 'Log in through the API, save the state, start browser contexts from it.', steps: [
      ['t', 'api', 'request.post("/login")', 'A session fixture logs in through the API: much faster than filling the form.'],
      ['api', 'srv', 'POST /login (form)', 'Email and password are posted like the HTML form would.'],
      ['srv', 'api', '303 + Set-Cookie: sid', 'The redirect to /account is followed and the session cookie is stored in jar B.', 'resp'],
      ['api', 'file', 'storage_state(path=...)', 'Jar B (cookies and localStorage) is written to a JSON file.', 'async'],
      ['file', 'ctx', 'new_context(storage_state=)', 'Every test’s fresh browser context starts with those cookies: already logged in, still isolated from the other tests.', 'async']] }
  ]);

  // ---------------------------------------------------------------- 4. auth timeline
  var LOGIN = 3, TEST = 2, LOAD = 0.2, N = 4, TMAX = 20;
  function lanes() {
    var a = [], b = [], t = 0, i;
    for (i = 0; i < N; i++) { a.push({ k: 'login', s: t, e: t + LOGIN, l: 'log in' }); t += LOGIN; a.push({ k: 'test', s: t, e: t + TEST, l: 'test ' + (i + 1) }); t += TEST; }
    t = 0; b.push({ k: 'login', s: 0, e: LOGIN, l: 'log in once' }); t = LOGIN;
    for (i = 0; i < N; i++) { b.push({ k: 'load', s: t, e: t + LOAD, l: '' }); t += LOAD; b.push({ k: 'test', s: t, e: t + TEST, l: 'test ' + (i + 1) }); t += TEST; }
    return [a, b];
  }
  var L = lanes(), ENDB = L[1][L[1].length - 1].e;
  function amsg(t) {
    if (t === 0) return 'Four tests that all need a logged-in user. Top: every test fills in the login form (about 3 s each). Bottom: a session fixture logs in once and saves storage_state.';
    if (t < LOGIN) return 't = ' + t + ' s. Both runs are logging in through the form for the first test.';
    if (t === LOGIN) return 't = 3 s. Bottom: the fixture calls context.storage_state(path=...), writing alice.json (below), and closes that context.';
    if (t < 6) return 't = ' + t + ' s. Bottom: each test gets a NEW context created with storage_state="alice.json" (green sliver: a few milliseconds), so it starts logged in.';
    if (t <= ENDB) return 't = ' + t + ' s. Top is logging in again for every test; bottom runs one test after another' + (t >= ENDB - 1 ? ' and is nearly done.' : '.');
    if (t < TMAX) return 't = ' + t + ' s. Bottom finished at ' + ENDB.toFixed(1) + ' s. Top is still logging in and testing.';
    return 'Done: ' + TMAX + ' s vs ' + ENDB.toFixed(1) + ' s for only four tests. With 200 tests the form-login run spends 10 minutes just logging in. Isolation is unchanged: every test still has its own fresh context.';
  }
  var AF = [];
  for (var t = 0; t <= TMAX; t++) {
    AF.push({ t: t, msg: amsg(t), line: t < LOGIN ? [0, 1, 2] : t === LOGIN ? [3, 4] : [7, 8] });
  }
  function seg(s, t) {
    if (t <= s.s) return '';
    var e = Math.min(s.e, t), w = (e - s.s) / TMAX * 100;
    return '<div class="seg ' + s.k + '" style="left:' + (s.s / TMAX * 100) + '%;width:' + w + '%" title="' + s.l + '">' + (w > 6 ? s.l : '') + '</div>';
  }
  function lane(name, segs, t) {
    var end = segs[segs.length - 1].e, shown = Math.min(t, end);
    return '<div class="lane"><b>' + name + '</b><div class="track">' + segs.map(function (s) { return seg(s, t); }).join('') +
      '<div class="now" style="left:' + (t / TMAX * 100) + '%"></div></div><span class="tot">' + shown.toFixed(1) + ' s' + (t >= end ? ' &#10003;' : '') + '</span></div>';
  }
  DSA.player('#auth-demo', AF, function (f, ctx) {
    ctx.stage.append('<div class="lanes">' + lane('Every test logs in', L[0], f.t) + lane('Log in once, reuse', L[1], f.t) + '</div>' +
      '<div class="legend"><span><i class="sw m-b"></i>login form</span><span><i class="sw m-a"></i>test body</span><span><i class="sw m-ok"></i>new context from storage_state</span></div>' +
      '<div class="statefile' + (f.t >= LOGIN ? '' : ' dim') + '">alice.json ' + (f.t >= LOGIN ? '(written at 3 s)' : '(not written yet)') +
      '\n{"cookies": [{"name": "sid", "value": "6f1c…", "domain": "127.0.0.1", "httpOnly": true, "sameSite": "Lax"}], "origins": []}</div>');
  }, { speed: 800, code: [
    '@pytest.fixture(scope="session")',
    'def alice_state(browser, base_url, tmp_path_factory):',
    '    ...  # log in through the form once',
    '    context.storage_state(path=path)',
    '    return str(path)',
    '',
    '@pytest.fixture',
    'def browser_context_args(browser_context_args, alice_state):',
    '    return {**browser_context_args, "storage_state": alice_state}'] });
});

$(function () {
  'use strict';
  PW.pageChrome('pytest');
  function esc(s) { return $('<i>').text(String(s)).html(); }

  // ---------------------------------------------------------------- 1. fixture lifetimes
  var LANES = [['playwright', 'session'], ['browser', 'session'], ['context', 'function'], ['page', 'function'], ['cookies', 'inside the context'], ['outcome', '']];
  var COLS = ['session start', 'test_add_mug', 'test_cart_empty', 'test_account', 'session end'];
  var CODE = [
    '@pytest.fixture(scope="session")',
    'def browser(launch_browser):          # once per run (per xdist worker)',
    '    browser = launch_browser()        # uses browser_type_launch_args',
    '    yield browser',
    '    browser.close()',
    '',
    '@pytest.fixture                       # function scope: a new one per test',
    'def context(new_context):',
    '    return new_context()              # browser.new_context(**browser_context_args)',
    '',
    '@pytest.fixture',
    'def page(context):',
    '    return context.new_page()',
    '',
    '@pytest.fixture',
    'def logged_in_page(context):          # your fixture, from conftest.py',
    '    context.request.post("/login", form={...})',
    '    yield context.new_page()',
    '    context.request.post("/logout")    # tear-down after the test'
  ];
  function lifeFrames() {
    var G = LANES.map(function () { return COLS.map(function () { return null; }); }), F = [];
    function set(l, c, s, t, sess) { G[l][c] = { s: s, t: t, sess: !!sess, n: true }; }
    function snap(col, msg, line) {
      F.push({ g: JSON.parse(JSON.stringify(G)), col: col, msg: msg, line: line });
      G.forEach(function (row) { row.forEach(function (c) { if (c) c.n = false; }); });
    }
    snap(-1, 'pytest has collected three tests. No fixture exists yet: fixtures are created lazily, the first time a test asks for them.');
    set(0, 0, 'live', 'driver started', true);
    snap(0, 'The first test asks for page. page needs context, which needs browser, which needs playwright. pytest builds the chain from the bottom: the session-scoped playwright fixture starts the Playwright driver.');
    set(1, 0, 'live', 'Chromium launched', true);
    snap(0, 'browser (session scope) launches Chromium once, with browser_type_launch_args (headless, channel, slow_mo...). This takes about a second, which is why it is shared by all tests.', [0, 1, 2, 3]);
    set(0, 1, 'live', '', true); set(1, 1, 'live', 'shared', true);
    set(2, 1, 'live', 'context #1 (new)'); set(3, 1, 'live', 'tab #1'); set(4, 1, 'live', '(empty)');
    snap(1, 'context (function scope) calls browser.new_context(**browser_context_args): a fresh, incognito-like profile in a few milliseconds. page opens a tab in it.', [6, 7, 8, 10, 11, 12]);
    set(4, 1, 'live', 'sid=7f3a...'); set(5, 1, 'live', 'running');
    snap(1, 'test_add_mug opens /products/1 and clicks "Add to cart". ShopBot sets a session cookie in context #1 and keeps the cart (1 mug) on the server under that cookie.');
    set(2, 1, 'dead', 'context #1 closed'); set(3, 1, 'dead', 'tab #1 closed'); set(4, 1, 'dead', 'cookies discarded'); set(5, 1, 'live', 'passed');
    snap(1, 'Tear-down: the page and context #1 are closed (the trace, screenshot or video is saved first if you asked for them). Its cookies are gone for good. The browser stays open.');
    set(0, 2, 'live', '', true); set(1, 2, 'live', 'shared', true);
    set(2, 2, 'live', 'context #2 (new)'); set(3, 2, 'live', 'tab #2'); set(4, 2, 'live', '(empty)'); set(5, 2, 'live', 'running');
    snap(2, 'test_cart_empty gets context #2, with no cookies. ShopBot treats it as a new visitor, so the cart count is 0. This is test isolation, and it needs no clean-up code.', [7, 8]);
    set(2, 2, 'dead', 'context #2 closed'); set(3, 2, 'dead', 'tab #2 closed'); set(4, 2, 'dead', 'cookies discarded'); set(5, 2, 'live', 'passed');
    snap(2, 'Tear-down again: context #2 is closed. Each test costs one context (milliseconds), not one browser (a second or more).');
    set(0, 3, 'live', '', true); set(1, 3, 'live', 'shared', true);
    set(2, 3, 'live', 'context #3 (new)'); set(3, 3, 'live', 'logged_in_page'); set(4, 3, 'live', 'sid=alice...'); set(5, 3, 'live', 'running');
    snap(3, 'test_account asks for your logged_in_page fixture. It requests context, logs in with context.request.post("/login") (no UI clicks), and yields a page. The login cookie lives in context #3 only.', [14, 15, 16, 17]);
    set(2, 3, 'dead', 'context #3 closed'); set(3, 3, 'dead', 'closed'); set(4, 3, 'dead', 'logged out, discarded'); set(5, 3, 'live', 'passed');
    snap(3, 'After the test, the code after yield runs (POST /logout ends the server session), then the plugin closes context #3. Tear-down runs even when the test fails.', [18]);
    set(0, 4, 'dead', 'driver stopped', true); set(1, 4, 'dead', 'browser.close()', true);
    snap(4, 'Session end: session fixtures tear down in reverse order: browser.close(), then the driver stops. One browser served three isolated tests. With pytest -n 4 this whole picture exists once per worker.', [4]);
    return F;
  }
  function lifeRender(f, ctx) {
    var h = '<div class="lanes"><div class="hd"></div>';
    COLS.forEach(function (c, i) { h += '<div class="hd' + (i === f.col ? ' now' : '') + '">' + esc(c) + '</div>'; });
    h += '</div>';
    var $g = $(h).appendTo(ctx.stage);
    LANES.forEach(function (ln, li) {
      $g.append('<div class="nm">' + esc(ln[0]) + (ln[1] ? '<small>' + esc(ln[1]) + '</small>' : '') + '</div>');
      COLS.forEach(function (c, ci) {
        var cell = f.g[li][ci], cls = 'cellx';
        if (cell) cls += ' ' + cell.s + (cell.sess ? ' sess' : '') + (cell.n ? ' new' : '');
        var txt = cell ? cell.t : '';
        if (cell && li === 4 && txt.indexOf('sid=') === 0) txt = '<span class="ck">' + esc(txt) + '</span>';
        else txt = esc(txt);
        if (cell && li === 5 && cell.t === 'passed') txt = '<b style="color:var(--good)">passed</b>';
        $g.append('<div class="' + cls + '">' + txt + '</div>');
      });
    });
    ctx.stage.append('<div class="legend"><span><span class="sw" style="background:color-mix(in srgb, var(--purple) 14%, var(--bg));border-color:var(--purple)"></span>session-scoped (shared)</span>' +
      '<span><span class="sw" style="background:color-mix(in srgb, var(--accent) 14%, var(--bg));border-color:var(--accent)"></span>function-scoped (per test)</span><span>dashed = torn down</span><span>green glow = created in this step</span></div>');
  }
  DSA.player('#life-demo', lifeFrames(), lifeRender, { speed: 1500, code: CODE });

  // ---------------------------------------------------------------- 2. which tests run (browsers x markers)
  var TESTS = [
    { id: 'test_search_finds_mug', marks: ['smoke'], note: '@pytest.mark.smoke' },
    { id: 'test_bad_login[bad-password]', marks: [], note: 'parametrize case 1' },
    { id: 'test_bad_login[unknown-user]', marks: [], note: 'parametrize case 2' },
    { id: 'test_full_checkout', marks: ['slow'], note: '@pytest.mark.slow' },
    { id: 'test_drag_and_drop', marks: [], skip: 'webkit', note: '@pytest.mark.skip_browser("webkit")' },
    { id: 'test_invoice_pdf', marks: [], only: 'chromium', note: '@pytest.mark.only_browser("chromium")' },
    { id: 'test_stock_limit', marks: [], api: true, note: 'uses only the api fixture: no browser, runs once' }
  ];
  var EXPR = { '': function () { return true; }, 'smoke': function (m) { return m.indexOf('smoke') >= 0; },
    'not slow': function (m) { return m.indexOf('slow') < 0; }, 'smoke or slow': function (m) { return m.indexOf('smoke') >= 0 || m.indexOf('slow') >= 0; } };
  var $mc = $('#mx-ctl');
  ['chromium', 'firefox', 'webkit'].forEach(function (b, i) {
    $mc.append('<label><input type="checkbox" class="mxb" value="' + b + '"' + (i === 0 ? ' checked' : '') + '> ' + b + '</label>');
  });
  $mc.append('<label>-m <select id="mxm"><option value="">(none)</option><option>smoke</option><option>not slow</option><option>smoke or slow</option></select></label>');
  function matrix() {
    var bs = $('.mxb:checked').map(function () { return this.value; }).get(), m = $('#mxm').val(), run = 0, skip = 0, desel = 0;
    var shown = bs.length ? bs : ['chromium'];
    var cmd = 'pytest' + (bs.length ? bs.map(function (b) { return ' --browser ' + b; }).join('') : '') + (m ? ' -m "' + m + '"' : '');
    var h = '<div class="table-wrap"><table class="matrix"><tr><th>Test</th><th>Why</th>' + shown.map(function (b) { return '<th>' + b + '</th>'; }).join('') + '</tr>';
    TESTS.forEach(function (t) {
      var sel = EXPR[m](t.marks);
      h += '<tr><td><code>' + esc(t.id) + '</code></td><td class="muted">' + esc(t.note) + '</td>';
      if (t.api) {
        if (sel) run++; else desel++;
        h += '<td colspan="' + shown.length + '" class="' + (sel ? 'run' : 'desel') + '">' + (sel ? 'runs once (not parametrised by browser)' : 'deselected by -m') + '</td>';
      } else {
        shown.forEach(function (b) {
          var st, txt;
          if (!sel) { st = 'desel'; txt = 'deselected'; desel++; }
          else if (t.skip === b || (t.only && t.only !== b)) { st = 'skip'; txt = 'skipped'; skip++; }
          else { st = 'run'; txt = 'runs'; run++; }
          h += '<td class="' + st + '">' + txt + '</td>';
        });
      }
      h += '</tr>';
    });
    h += '</table></div>';
    $('#matrix-demo .stage').html('<pre class="term"><code>' + esc(cmd) + '</code></pre>' + h +
      '<div class="readout">' + run + ' run, ' + skip + ' skipped, ' + desel + ' deselected. ' + (bs.length ? '' : 'No --browser flag: the plugin defaults to chromium. ') +
      'Ids look like <code>test_bad_login[' + shown[0] + '-bad-password]</code>.</div>');
  }
  $mc.on('change', 'input, select', matrix);
  matrix();

  // ---------------------------------------------------------------- 3. xdist workers
  var SUITE = [['search_mug', 1, 1], ['search_counts', 1, 1], ['no_results', 1, 1], ['stock_label', 2, 1],
    ['add_two_mugs', 2, 2], ['empty_cart', 1, 2], ['seeded_cart', 1, 2],
    ['login_ok', 1, 3], ['bad_login', 2, 3], ['anon_redirect', 1, 3],
    ['full_checkout', 5, 4]];     // [name, duration, file]
  var FILES = { 1: 'test_search.py', 2: 'test_cart.py', 3: 'test_login.py', 4: 'test_checkout.py' };
  var MODES = [
    { name: '-n 0 (serial)', workers: 1, mode: 'load', desc: 'No xdist: one process runs every test in order.' },
    { name: '-n 3 --dist load', workers: 3, mode: 'load', desc: 'Three workers; a free worker takes the next pending test (simplified view of load balancing).' },
    { name: '-n 3 --dist loadfile', workers: 3, mode: 'loadfile', desc: 'Three workers; all tests of one file go to the same worker, which keeps module fixtures and file order but balances less evenly.' }
  ];
  function xdFrames(M) {
    var queue = SUITE.map(function (t) { return { n: t[0], d: t[1], f: t[2], left: t[1] }; }), W = [], F = [], t = 0, serial = 0;
    SUITE.forEach(function (s) { serial += s[1]; });
    for (var i = 0; i < M.workers; i++) W.push({ id: M.workers === 1 ? 'master' : 'gw' + i, cur: null, mine: [], done: [] });
    function clone() { return { q: queue.map(function (x) { return x; }), w: JSON.parse(JSON.stringify(W)), t: t }; }
    var f0 = clone(); f0.msg = M.desc + ' ' + (M.workers > 1 ? 'Each worker first runs its session fixtures: its own Playwright driver and its own browser (' + M.workers + ' browsers in total).' : 'One browser serves every test.');
    F.push(f0);
    var guard = 0;
    while ((queue.length || W.some(function (w) { return w.cur || w.mine.length; })) && guard++ < 60) {
      var events = [];
      W.forEach(function (w) {
        if (w.cur) return;
        if (!w.mine.length && queue.length) {
          if (M.mode === 'loadfile') { var fl = queue[0].f; w.mine = queue.filter(function (x) { return x.f === fl; }); queue = queue.filter(function (x) { return x.f !== fl; }); events.push(w.id + ' takes all of ' + FILES[fl]); }
          else { w.mine = [queue.shift()]; }
        }
        if (w.mine.length) { w.cur = w.mine.shift(); if (M.mode !== 'loadfile') events.push(w.id + ' takes ' + w.cur.n); }
      });
      t++;
      W.forEach(function (w) { if (w.cur) { w.cur.left--; } });
      var fr = clone();
      var fin = [];
      W.forEach(function (w) { if (w.cur && w.cur.left <= 0) { w.done.push(w.cur); fin.push(w.id + ' finished ' + w.cur.n); w.cur = null; } });
      fr.msg = 't = ' + t + ': ' + (events.length ? events.join('; ') + '. ' : '') + (fin.length ? fin.join('; ') + '.' : 'running...');
      F.push(fr);
    }
    var last = clone(); last.end = true;
    last.msg = 'All tests done after ' + t + ' time units (serial: ' + serial + '). ' + (M.workers === 1 ? 'Try the parallel tabs.' :
      M.mode === 'load' ? 'The slow full_checkout was last in the queue, so one worker finishes long after the others: put long tests early, or split them. Session fixtures (browser, saved log-in) ran once per worker.' :
      'loadfile keeps each file together. A big file becomes the bottleneck; use it when tests in a file share expensive module-scoped set-up.');
    F.push(last);
    return F;
  }
  function chip(x, cls) { return '<span class="chip f' + x.f + (cls ? ' ' + cls : '') + '" title="' + FILES[x.f] + '">' + esc(x.n) + (cls === 'run' ? ' (' + x.left + ')' : '') + '</span>'; }
  function xdRender(f, ctx) {
    var h = '<div class="wk"><div class="wname">pending<small>controller queue</small></div><div class="chips">' + (f.q.length ? f.q.map(function (x) { return chip(x); }).join('') : '<span class="muted">empty</span>') + '</div></div>';
    f.w.forEach(function (w) {
      h += '<div class="wk"><div class="wname">' + esc(w.id) + '<small>own browser</small></div><div class="chips">' +
        w.done.map(function (x) { return chip(x, 'done'); }).join('') + (w.cur ? chip(w.cur, 'run') : '') +
        w.mine.map(function (x) { return chip(x); }).join('') + '</div></div>';
    });
    h += '<div class="legend">' + Object.keys(FILES).map(function (k) { return '<span><span class="sw" style="border-left:4px solid ' + ['', 'var(--c-svc)', 'var(--c-data)', 'var(--c-ai)', 'var(--c-msg)'][k] + '"></span>' + FILES[k] + '</span>'; }).join('') +
      '<span>outlined = running (time left)</span><span style="color:var(--good)">green = passed</span><span>clock: t = ' + f.t + '</span></div>';
    ctx.stage.html(h);
  }
  var xp = DSA.player('#xdist-demo', xdFrames(MODES[1]), xdRender, { speed: 800 });
  MODES.forEach(function (M, i) {
    $('<button type="button">').text(M.name).toggleClass('active', i === 1).on('click', function () {
      $('#xd-tabs').children().removeClass('active'); $(this).addClass('active'); xp.set(xdFrames(M));
    }).appendTo('#xd-tabs');
  });
});

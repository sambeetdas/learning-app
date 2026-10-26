$(function () {
  'use strict';
  PW.pageChrome('advanced');

  function esc(s) { return $('<i>').text(String(s)).html(); }

  // ================================================================ 1. emulation playground
  var DEVICES = {
    'Desktop Chrome': { w: 1280, h: 720, dpr: 1, mobile: false, touch: false, engine: 'chromium' },
    'iPhone 15': { w: 393, h: 659, dpr: 3, mobile: true, touch: true, engine: 'webkit' },
    'Pixel 7': { w: 412, h: 839, dpr: 2.625, mobile: true, touch: true, engine: 'chromium' },
    'Galaxy S24': { w: 360, h: 780, dpr: 3, mobile: true, touch: true, engine: 'chromium' },
    'iPad Pro 11': { w: 834, h: 1194, dpr: 2, mobile: true, touch: true, engine: 'webkit' }
  };
  var $dev = $('#emu-device');
  Object.keys(DEVICES).forEach(function (k) { $dev.append($('<option>').text(k)); });
  $dev.val('iPhone 15');

  function fmtPrice(locale, v) {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency: 'GBP' }).format(v); } catch (e) { return '£' + v.toFixed(2); }
  }
  function fmtDate(locale, tz) {
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date('2026-12-24T09:00:00Z')); } catch (e) { return '2026-12-24 09:00 UTC'; }
  }
  function emu() {
    var name = $dev.val(), d = DEVICES[name], loc = $('#emu-locale').val(), tz = $('#emu-tz').val(), sch = $('#emu-scheme').val(),
      geo = $('#emu-geo').val(), off = $('#emu-net').val() === 'offline';
    // ---- the code
    var L = ['context = browser.new_context(', '    **playwright.devices["' + name + '"],', '    locale="' + loc + '",', '    timezone_id="' + tz + '",'];
    if (sch === 'dark') L.push('    color_scheme="dark",');
    if (geo !== 'none') L.push('    geolocation={"latitude": 51.5072, "longitude": -0.1276},');
    if (geo === 'granted') L.push('    permissions=["geolocation"],');
    if (off) L.push('    offline=True,');
    L.push(')', 'page = context.new_page()', 'page.goto("http://127.0.0.1:8000/products")');
    if (d.engine === 'webkit') L.push('', '# this descriptor\'s default_browser_type is "webkit":', '# run with  pytest --browser webkit  for the real Safari engine');
    if (!d.mobile) L.push('', '# Desktop: no touch, so locator.tap() would fail');
    $('#emu-code').text(L.join('\n'));
    // ---- the preview
    var scale = d.w > 900 ? 0.42 : 0.62, w = Math.round(d.w * scale);
    var body;
    if (off) {
      body = '<p class="offline">No internet</p><p class="muted" style="font-size:.8rem">net::ERR_INTERNET_DISCONNECTED</p><p style="font-size:.8rem">Every navigation and fetch() fails. Pages already loaded stay on screen; <code>navigator.onLine</code> is false.</p>';
    } else {
      var cols = d.w < 600 ? 1 : (d.w < 1000 ? 2 : 4), names = ['Ceramic Mug', 'Cast Iron Pan', 'Desk Lamp', 'Notebook Set'], prices = [12, 39.5, 24.99, 9.5];
      body = '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:.3rem">' + names.slice(0, cols === 1 ? 2 : 4).map(function (n, i) {
        return '<span class="el" style="display:block;margin:0"><b style="font-size:.8rem">' + n + '</b><br><span style="font-size:.78rem">' + esc(fmtPrice(loc, prices[i])) + '</span></span>';
      }).join('') + '</div>' +
        '<p style="font-size:.75rem;margin:.5rem 0 0">Order placed: ' + esc(fmtDate(loc, tz)) + '</p>' +
        '<p style="font-size:.75rem;margin:.2rem 0 0">' + (cols === 1 ? 'One column layout (narrow viewport)' : cols + ' columns') + (d.touch ? ', touch: tap()' : ', mouse only') + '</p>';
    }
    $('#emu-frame').css('width', w + 'px').css('max-width', '100%').html(
      '<div class="mockbrowser' + (sch === 'dark' ? ' dark' : '') + '"><div class="chrome"><i></i><i></i><i></i><span class="url">127.0.0.1:8000/products</span></div><div class="viewport">' + body + '</div></div>');
    var geoRes = geo === 'granted' ? '[51.5072, -0.1276]' : 'error code 1 (PERMISSION_DENIED)';
    var rows = [['viewport', d.w + ' x ' + d.h + ' CSS px'], ['devicePixelRatio', d.dpr], ['navigator.language', loc], ['Intl time zone', tz],
      ['prefers-color-scheme', sch], ['touch (has_touch)', d.touch ? 'yes' : 'no'], ['navigator.onLine', off ? 'false' : 'true'], ['getCurrentPosition()', geoRes],
      ['Accept-Language header', loc]];
    $('#emu-kv').html(rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join(''));
  }
  $('#emu-demo select').on('change', emu);
  emu();

  // ================================================================ 2. clock animation
  var CLOCK_CODE = [
    'page.clock.install(time=dt.datetime(2026, 12, 24, 9, 0, tzinfo=dt.timezone.utc))',
    'page.set_content(SESSION_PAGE)        # setInterval 1 s + setTimeout 14 min',
    'page.clock.pause_at(dt.datetime(2026, 12, 24, 9, 0, 5, tzinfo=dt.timezone.utc))',
    'expect(page.locator("#now")).to_have_text("09:00:05")',
    'page.clock.run_for(3000)',
    'expect(page.locator("#now")).to_have_text("09:00:08")',
    'page.clock.fast_forward("14:00")',
    'expect(page.get_by_role("alert")).to_have_text("Your session expires in 1 minute")',
    'page.clock.resume()'
  ];
  function hms(s) { var h = 9 + Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  var CF = [
    { t: null, st: 'real clock', ticks: [], to: 'not scheduled', real: '-', alert: '', msg: 'Without the clock API the page uses the real clock: testing a 14-minute warning would need a 14-minute test (and time.sleep() is the classic cause of slow, flaky suites).' },
    { line: 0, t: 0, st: 'installed, flowing', ticks: [], to: 'not scheduled', real: '~1 ms', alert: '', noPage: true, msg: 'install() replaces Date, setTimeout, setInterval, requestAnimationFrame, performance.now() and friends with fake versions, starting at 09:00:00 UTC. Time still flows at normal speed until you pause it. It must come before the page loads.' },
    { line: 1, t: 0, st: 'installed, flowing', ticks: [], to: 'due 09:14:00', real: '~20 ms', alert: '', msg: 'The page loads and schedules an interval (every second, updates the clock text) and a timeout (14 minutes, shows the warning). Because the clock was installed first, both are fake timers that the test controls.' },
    { line: 2, t: 5, st: 'paused', ticks: [5], to: 'due 09:14:00', real: '~25 ms', alert: '', msg: 'pause_at(09:00:05) jumps to that moment like fast_forward (the interval fires once, at 09:00:05) and stops the clock. From now on nothing moves unless the test says so. Pausing at a time in the past raises "Cannot fast-forward to the past".' },
    { line: 3, t: 5, st: 'paused', ticks: [5], to: 'due 09:14:00', real: '~30 ms', alert: '', check: 'ok', msg: 'The assertion passes and stays true: the page time is frozen, so the text cannot change under the test.' },
    { line: 4, t: 8, st: 'paused', ticks: [5, 6, 7, 8], to: 'due 09:14:00', real: '~35 ms', alert: '', msg: 'run_for(3000) advances 3 seconds step by step and fires every timer that falls due, in order: the interval runs at 09:00:06, :07 and :08. Use run_for when each firing matters (animations, polling, counters).' },
    { line: 5, t: 8, st: 'paused', ticks: [5, 6, 7, 8], to: 'due 09:14:00', real: '~40 ms', alert: '', check: 'ok', msg: 'The clock text shows 09:00:08. The 14-minute timeout is still pending.' },
    { line: 6, t: 848, st: 'paused', ticks: [5, 6, 7, 8, 848], to: 'fired at 09:14:08', real: '~45 ms', alert: 'Your session expires in 1 minute', msg: 'fast_forward("14:00") jumps 14 minutes. Each due timer fires at most once, at the new time: the interval runs once (not 840 times) and the overdue timeout fires, both at 09:14:08. Like a laptop waking from sleep.' },
    { line: 7, t: 848, st: 'paused', ticks: [5, 6, 7, 8, 848], to: 'fired at 09:14:08', real: '~50 ms', alert: 'Your session expires in 1 minute', check: 'ok', msg: 'The warning is visible. 14 minutes of page time took about 50 ms of real time.' },
    { line: 8, t: 848, st: 'installed, flowing', ticks: [5, 6, 7, 8, 848], to: 'fired at 09:14:08', real: '~55 ms', alert: 'Your session expires in 1 minute', msg: 'resume() lets time flow at normal speed again from 09:14:08 (optional: the context is thrown away after the test anyway).' }
  ];
  function clockRender(f, ctx) {
    var $s = ctx.stage, span = 900;
    function pct(s) { return (s / span * 100).toFixed(2) + '%'; }
    var tl = '<div class="timeline">';
    [0, 300, 600, 900].forEach(function (s) { tl += '<span class="axis" style="left:' + pct(s) + '">' + hms(s).slice(0, 5) + '</span>'; });
    if (f.to !== 'not scheduled') {
      var fired = f.to.indexOf('fired') === 0;
      tl += '<span class="tmark' + (fired ? ' fired' : '') + '" style="left:' + pct(fired ? 848 : 840) + '"></span><span class="tlabel" style="left:' + pct(fired ? 848 : 840) + '">setTimeout 14 min ' + (fired ? 'fired' : 'pending') + '</span>';
    }
    f.ticks.forEach(function (s) { tl += '<span class="tick fired" style="left:' + pct(s) + '"></span>'; });
    if (f.t !== null) tl += '<span class="cursor" style="left:' + pct(f.t) + '" title="page time"></span>';
    tl += '</div>';
    var shown = f.t === null || f.noPage ? '(no page yet)' : hms(f.t);
    var page = '<div class="mockbrowser" style="max-width:none;flex:1 1 14rem"><div class="chrome"><i></i><i></i><i></i><span class="url">session page</span></div><div class="viewport" style="min-height:4.5rem">' +
      (f.noPage || f.t === null ? '<span class="muted">about:blank</span>' : 'Time: <b>' + shown + '</b>' + (f.alert ? '<p role="alert" style="color:var(--bad);margin:.3rem 0 0;font-weight:600">' + esc(f.alert) + '</p>' : '')) +
      (f.check ? '<div class="checks"><span class="ok">expect passed</span></div>' : '') + '</div></div>';
    var info = '<div class="readout"><span class="muted">Page time (UTC)</span><span class="bigv">' + (f.t === null ? 'real: whatever now is' : hms(f.t)) + '</span></div>' +
      '<div class="readout"><span class="muted">Clock</span><span class="bigv">' + esc(f.st) + '</span></div>' +
      '<div class="readout"><span class="muted">setInterval(1 s) fired</span><span class="bigv">' + f.ticks.length + ' times</span></div>' +
      '<div class="readout"><span class="muted">setTimeout(14 min)</span><span class="bigv">' + esc(f.to) + '</span></div>' +
      '<div class="readout"><span class="muted">Real time spent</span><span class="bigv">' + esc(f.real) + '</span></div>';
    $s.append(tl, $('<div class="clockrow">').append(page), $('<div class="clockrow" style="margin-top:.5rem">').append(info));
  }
  DSA.player('#clock-demo', CF, clockRender, { speed: 1500, code: CLOCK_CODE });

  // ================================================================ 3. pixel diff
  var W = 48, H = 28, MASK = -1;
  function inRect(x, y, x1, y1, x2, y2) { return x >= x1 && x <= x2 && y >= y1 && y <= y2; }
  function textPx(x, y, shift) { return ((x * 7 + y * 13 + shift) % 5 < 2) && (x % 6 !== 5) ? 40 : 250; }
  var DIGIT = { 0: ['111', '101', '111'], 3: ['111', '011', '111'] };
  function image(kind, opts) {
    // kind: 'base' or a scenario; opts: {mask, anim}
    var px = [], x, y, v;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      v = 250;
      if (y <= 3) v = 70;                                                                     // header bar
      if (inRect(x, y, 40, 0, 42, 2)) {                                                       // cart count digits
        var dg = kind === 'base' ? DIGIT[0] : DIGIT[3];
        v = dg[y][x - 40] === '1' ? 245 : 70;
        if (opts.mask) v = MASK;
      }
      if (inRect(x, y, 3, 6, 26, 8)) v = textPx(x, y, kind === 'font' ? 2 : 0);              // title text
      if (inRect(x, y, 3, 10, 36, 11)) v = (x % 4 === 3) ? 250 : 140;                        // body text
      var bx = kind === 'moved' ? 2 : 0;                                                     // button (moved 2 px in the bug scenario)
      if (inRect(x, y, 4 + bx, 15, 15 + bx, 19)) v = inRect(x, y, 6 + bx, 17, 13 + bx, 17) ? 230 : 50;
      if (inRect(x, y, 38, 20, 44, 25)) {                                                    // spinner
        var cx = 41, cy = 22.5, dx = x - cx, dy = y - cy, r = Math.sqrt(dx * dx + dy * dy);
        if (r > 1.6 && r < 3.4) {
          var ang = Math.atan2(dy, dx), phase = (kind === 'base' || opts.anim) ? 0 : 2.4;
          v = Math.cos(ang - phase) > 0.3 ? 60 : 200;
          if (opts.anim) v = 120;                                                            // animations="disabled": final, static frame
        }
      }
      px.push(v);
    }
    if (kind !== 'base') {                                                                   // anti-aliasing noise on edges
      var out = px.slice();
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        var i = y * W + x, a = px[i];
        if (a === MASK) continue;
        var edge = (x < W - 1 && px[i + 1] !== MASK && Math.abs(px[i + 1] - a) > 50) || (y < H - 1 && px[i + W] !== MASK && Math.abs(px[i + W] - a) > 50);
        if (edge) { var d = [0, 5, 10, 15, 20][(x * 31 + y * 17) % 5]; out[i] = Math.max(0, Math.min(255, a + (a > 128 ? -d : d))); }
      }
      px = out;
    }
    return px;
  }
  function grid(cells, colour) {
    return '<div class="pixgrid" style="grid-template-columns:repeat(' + W + ',6px)">' + cells.map(colour).join('') + '</div>';
  }
  function grey(v) { return v === MASK ? '<i style="background:#ff00ff"></i>' : '<i style="background:rgb(' + v + ',' + v + ',' + v + ')"></i>'; }
  function diffRun() {
    var scn = $('#df-scn').val(), thr = +$('#df-thr').val(), maxr = +$('#df-ratio').val(), opts = { mask: $('#df-mask').prop('checked'), anim: $('#df-anim').prop('checked') };
    $('#df-thr-v').text(thr);
    var base = image('base', opts), cur = image(scn, opts), n = 0, below = 0, i, diffs = [];
    for (i = 0; i < base.length; i++) {
      var d = (base[i] === MASK || cur[i] === MASK) ? 0 : Math.abs(base[i] - cur[i]);
      diffs.push(d); if (d > thr) n++; else if (d > 0) below++;
    }
    var ratio = n / base.length, pass = ratio <= maxr;
    var diffCells = diffs.map(function (d, k) {
      if (d > thr) return '<i style="background:#e11d48"></i>';
      if (d > 0) return '<i style="background:#fdba74"></i>';
      var g = cur[k] === MASK ? 235 : Math.round(200 + cur[k] / 255 * 50); return '<i style="background:rgb(' + g + ',' + g + ',' + g + ')"></i>';
    });
    $('#df-panels').html('<figure><figcaption>baseline (approved)</figcaption>' + grid(base, grey) + '</figure>' +
      '<figure><figcaption>this run</figcaption>' + grid(cur, grey) + '</figure>' +
      '<figure><figcaption>diff: <span style="color:#e11d48">&#9632;</span> counted, <span style="color:#fdba74">&#9632;</span> below threshold</figcaption>' + grid(diffCells, function (c) { return c; }) + '</figure>');
    var why;
    if (scn === 'same') {
      if (!opts.mask) why = 'The header\'s cart count was 0 in the baseline and 3 in this run: a legitimate difference. Tick "mask the cart count".';
      else if (!opts.anim) why = 'The spinner was captured mid-animation, in a different position from the baseline. Tick animations="disabled".';
      else if (thr < 20) why = 'Anti-aliasing noise along edges (differences of up to 20) is counted as change. A small per-pixel threshold absorbs it.';
      else why = pass ? 'Stable: masked dynamic content, no animation, noise below the threshold. This is how a healthy visual test looks.' : 'Raise the allowed ratio slightly or the per-pixel threshold.';
    } else if (scn === 'moved') {
      why = pass ? 'Danger: the limits are so generous that a real 2 px layout shift passes. Keep the ratio small and prefer component screenshots, where a shift is a large share of the image.'
        : 'Correct: the button moved 2 px and the test catches it. Look at the red diff: it shows exactly where.';
    } else {
      why = pass ? 'Passing only because the limits are very loose, which would also hide real bugs.' : 'Fonts render differently on another operating system. Do not loosen the thresholds: generate baselines in the same Docker image and browser as CI.';
    }
    $('#df-verdict').toggleClass('ok', pass).toggleClass('bad', !pass).html('<b>' + (pass ? 'PASS' : 'FAIL') + '</b>: ' + n + ' of ' + base.length + ' pixels differ by more than ' + thr +
      ' (' + (ratio * 100).toFixed(2) + ' %; limit ' + (maxr * 100).toFixed(1) + ' %). ' + below + ' more differ by a little and are ignored.<br>' + esc(why));
  }
  $('#df-scn, #df-ratio, #df-mask, #df-anim').on('change', diffRun);
  $('#df-thr').on('input', diffRun);
  diffRun();

  // ================================================================ 4. two users chat
  var CHAT_CODE = [
    'alice_ctx = browser.new_context(storage_state="auth/alice.json")',
    'bob_ctx = browser.new_context(storage_state="auth/bob.json")',
    'alice, bob = alice_ctx.new_page(), bob_ctx.new_page()',
    'alice.goto("/messages/order-1042"); bob.goto("/messages/order-1042")',
    'alice.get_by_role("textbox", name="Message").fill("Is the mug dishwasher safe?")',
    'alice.get_by_role("button", name="Send").click()',
    'expect(bob.get_by_test_id("message").last).to_have_text("alice: Is the mug dishwasher safe?")',
    'bob.get_by_role("textbox", name="Message").fill("Yes, it is.")',
    'bob.get_by_role("button", name="Send").click()',
    'expect(alice.get_by_test_id("message").last).to_have_text("bob: Yes, it is.")',
    'alice_ctx.close(); bob_ctx.close()'
  ];
  var Q = 'Is the mug dishwasher safe?', A = 'Yes, it is.';
  var M1 = { u: 'alice', t: Q }, M2 = { u: 'bob', t: A };
  var CH = [
    { a: 0, b: 0, srv: [], msg: 'One browser process. Each test user gets their own browser context: separate cookies, localStorage and cache, like two different people on two computers.' },
    { line: 0, a: 1, b: 0, srv: [], msg: 'Alice\'s context is created from her saved storage_state: her session cookie is already in its cookie jar, so she is logged in without visiting /login.' },
    { line: 1, a: 1, b: 1, srv: [], msg: 'Bob\'s context gets Bob\'s cookie. Nothing is shared between the two jars.' },
    { line: 2, a: 2, b: 2, srv: [], msg: 'One page (tab) in each context. Two pages in the SAME context would be the same user in two tabs.' },
    { line: 3, a: 3, b: 3, srv: [], msg: 'Both open the same conversation. The server knows who is who from each context\'s cookie.' },
    { line: 4, a: 3, b: 3, ai: Q, srv: [], hiA: 'input', msg: 'Alice types her question into her page.' },
    { line: 5, a: 3, b: 3, srv: [M1], am: [M1], hiA: 'send', newA: 0, msg: 'She clicks Send: her page posts the message, the server stores it under "alice" (from her cookie).' },
    { line: 6, a: 3, b: 3, srv: [M1], am: [M1], bm: [M1], newB: 0, check: 'b', msg: 'Bob\'s page receives it (polling, SSE or WebSocket: the test does not care). expect() on BOB\'S page retries until the message arrives, so there is no sleep.' },
    { line: 7, a: 3, b: 3, srv: [M1], am: [M1], bm: [M1], bi: A, hiB: 'input', msg: 'Bob answers in his own page.' },
    { line: 8, a: 3, b: 3, srv: [M1, M2], am: [M1], bm: [M1, M2], hiB: 'send', newB: 1, msg: 'Bob sends: the server stores it under "bob".' },
    { line: 9, a: 3, b: 3, srv: [M1, M2], am: [M1, M2], bm: [M1, M2], newA: 1, check: 'a', msg: 'Alice\'s page shows Bob\'s reply. One test proved the feature end to end, in both directions, with real sessions.' },
    { line: 10, a: 0, b: 0, srv: [M1, M2], msg: 'Close both contexts (a fixture does this in its teardown). Their cookies and storage are gone; the next test starts clean.' }
  ];
  function side(name, f, stage, inp, msgs, hi, nw, chk) {
    if (!stage) return '<div class="mockbrowser" style="max-width:none;opacity:.4"><div class="chrome"><span class="url">no context</span></div><div class="viewport muted">' + name + '\'s context does not exist</div></div>';
    var url = stage >= 3 ? '127.0.0.1:8000/messages/order-1042' : 'about:blank';
    var view = '<span class="muted">' + (stage === 1 ? 'context only, no page yet' : 'blank page') + '</span>';
    if (stage === 1) url = '-';
    if (stage >= 3) {
      view = '<div aria-label="Messages">' + (msgs || []).map(function (m, i) {
        return '<span class="msg' + (m.u === name.toLowerCase() ? ' mine' : '') + (nw === i ? ' new' : '') + '">' + m.u + ': ' + esc(m.t) + '</span>';
      }).join('') + ((msgs || []).length ? '' : '<span class="muted" style="font-size:.8rem">No messages yet</span>') + '</div>' +
        '<div style="margin-top:.4rem"><span class="el' + (hi === 'input' ? ' act' : '') + '" style="min-width:9rem">' + (inp ? esc(inp) : '<span class="muted">Message</span>') + '</span>' +
        '<span class="el' + (hi === 'send' ? ' act' : '') + '">Send</span></div>' + (chk ? '<div class="checks"><span class="ok">expect passed</span></div>' : '');
    }
    return '<div class="mockbrowser" style="max-width:none"><div class="chrome"><i></i><i></i><i></i><span class="url">' + url + '</span></div><div class="viewport">' + view + '</div>' +
      '<div class="jar">' + name.toLowerCase() + '_ctx cookies: sid=' + (name === 'Alice' ? 'a1f3...' : '9bc2...') + ' (' + name + ')</div></div>';
  }
  function chatRender(f, ctx) {
    var srv = '<div class="server"><b>Server: room order-1042</b>' + (f.srv.length ? f.srv.map(function (m) { return '<div>' + m.u + ': ' + esc(m.t) + '</div>'; }).join('') : '<span class="muted">empty</span>') + '</div>';
    ctx.stage.append($('<div class="duo">').append(
      $('<div>').append('<div class="rowlabel">Alice</div>', side('Alice', f, f.a, f.ai, f.am, f.hiA, f.newA, f.check === 'a')),
      $('<div>').append('<div class="rowlabel">&nbsp;</div>', srv),
      $('<div>').append('<div class="rowlabel">Bob</div>', side('Bob', f, f.b, f.bi, f.bm, f.hiB, f.newB, f.check === 'b'))));
  }
  DSA.player('#chat-demo', CH, chatRender, { speed: 1500, code: CHAT_CODE });
});

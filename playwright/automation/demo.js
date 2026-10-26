$(function () {
  'use strict';
  PW.pageChrome('automation');
  function esc(s) { return $('<i>').text(String(s)).html(); }

  // ---------------------------------------------------------------- polite scraping / hybrid / throttled flows
  var D = {
    nodes: [['s', 'Your scraper', 'client', 0, 1, 'Playwright script'], ['csv', 'CSV / database', 'blob', 0, 2.4, 'products.csv'],
      ['rb', 'robots.txt + terms', 'ext', 1.5, 0, 'site rules'], ['rl', 'Rate limiter', 'svc', 1.5, 1, 'delay + semaphore'],
      ['br', 'Browser', 'ext', 3, 1, 'Chromium'], ['site', 'Website', 'svc', 4.5, 1, 'ShopBot HTML pages'],
      ['hx', 'httpx client', 'svc', 3, 2.4, 'cookies from browser'], ['api', 'JSON API', 'svc', 4.5, 2.4, '/api/products']],
    edges: [['s', 'rb'], ['s', 'rl'], ['rl', 'br'], ['br', 'site'], ['s', 'csv'], ['rl', 'hx'], ['hx', 'api'], ['site', 'api', '', 'none']]
  };
  PW.flows('#polite-demo', D, [
    { name: 'Polite scrape', desc: 'Check the rules, then fetch one page at a time with a delay and an identifying user agent.', steps: [
      ['s', 'rb', 'GET /robots.txt', 'Before anything else: read robots.txt for your user agent (and the terms of service, which robots.txt does not replace).'],
      ['rb', 's', 'can_fetch() = True', 'urllib.robotparser says the path is allowed. A 404 robots.txt means no rules; 401/403 means treat everything as disallowed.', 'resp'],
      ['s', 'rl', 'next URL', 'Each URL goes through a rate limiter: a minimum delay between requests and a small concurrency cap.'],
      ['rl', 'br', 'after 1 s', 'Only when the delay has passed does the browser navigate.'],
      ['br', 'site', 'page.goto(url)', 'The request carries a descriptive User-Agent with a contact address, set on the context.'],
      ['site', 'br', '200 HTML + JS', 'The page renders, including any JavaScript-built content.', 'resp'],
      ['br', 's', 'rows extracted', 'Locators read names, prices and stock; the scraper validates types and counts.', 'resp'],
      ['s', 'csv', 'csv.DictWriter', 'Results are written out. Cache what you fetched so a rerun does not hit the site again.']] },
    { name: 'Hybrid: browser login, HTTP data', desc: 'Use the browser only for the part that needs it (the login), then switch to a fast HTTP client.', steps: [
      ['s', 'rl', 'job starts', 'The job needs data that is only visible to a logged-in user.'],
      ['rl', 'br', 'log in via the UI', 'The browser handles the login form, JavaScript and redirects.'],
      ['br', 'site', 'POST /login', 'Credentials come from environment variables, never from the script.'],
      ['site', 'br', 'Set-Cookie: sid', 'The site sets a session cookie in the browser context.', 'resp'],
      ['br', 's', 'context.cookies()', 'The scraper copies the cookies out of the context (or saves storage_state for later runs).', 'resp'],
      ['rl', 'hx', 'httpx.Client(cookies=...)', 'A plain HTTP client reuses the session: no browser start-up per request.'],
      ['hx', 'api', 'GET /api/products', 'The JSON endpoint returns structured data, in milliseconds instead of seconds.'],
      ['api', 'hx', '200 JSON', 'No HTML parsing, no rendering, far less load on the site.', 'resp'],
      ['s', 'csv', 'write rows', 'Same output, a fraction of the time and memory.']] },
    { name: 'Throttled (429)', desc: 'The site asks you to slow down. Back off; do not try to get around it.', steps: [
      ['s', 'rl', 'next URL', 'The scraper asks for the next page.'],
      ['rl', 'br', 'after delay', 'The limiter releases the request.'],
      ['br', 'site', 'page.goto(url)', 'The browser navigates.'],
      ['site', 'br', '429 Too Many Requests', 'The site returns 429 with Retry-After: 30.', 'err'],
      ['br', 's', 'response.status == 429', 'page.goto returns the response, so the scraper can see the status.', 'err'],
      ['s', 'rl', 'sleep(Retry-After)', 'Wait at least as long as asked, then lower the rate (longer delay, fewer concurrent pages).'],
      ['rl', 'br', 'retry once, slower', 'If throttling continues after a few retries, stop the job and alert a human. Rotating IPs or disguising the browser to evade the limit is not acceptable.']],
      end: 'A rate limit is the site owner telling you their capacity. Respect it, or ask them for an API or a data export.' }
  ]);
  $('#polite-legend').html(PW.legend());

  // ---------------------------------------------------------------- semaphore simulation
  var TASKS = [['/products/1', 4], ['/products/2', 3], ['/products/3', 2], ['/products/4', 3],
    ['/products?q=mug', 2], ['/products?category=office', 3], ['/products/99', 1, 'fail'], ['/cart', 2]];
  var TICK = 0.5;    // seconds per step
  var SEM_CODE = [
    'sem = asyncio.Semaphore(LIMIT)',
    'async def scrape_product(context, sem, url):',
    '    async with sem:               # wait for a free slot',
    '        page = await context.new_page()',
    '        try:',
    '            response = await page.goto(url)',
    '            if not response.ok: raise RuntimeError(...)',
    '            return await extract(page)',
    '        finally:',
    '            await page.close()    # leaving "async with" frees the slot',
    'results = await asyncio.gather(*tasks, return_exceptions=True)'];

  function simulate(limit) {
    var st = TASKS.map(function () { return { start: -1, end: -1 }; }), queue = TASKS.map(function (x, i) { return i; }), running = [], t = 0, F = [], peak = 0;
    F.push({ t: 0, st: JSON.parse(JSON.stringify(st)), running: [], line: [0, 10],
      msg: 'asyncio.gather creates ' + TASKS.length + ' coroutines at once. Each one reaches "async with sem" and waits; the semaphore lets only ' + limit + ' through at a time.' });
    while (queue.length || running.length) {
      var ended = [], started = [];
      running = running.filter(function (i) { if (st[i].end === t) { ended.push(i); return false; } return true; });
      while (running.length < limit && queue.length) { var k = queue.shift(); st[k].start = t; st[k].end = t + TASKS[k][1]; running.push(k); started.push(k); }
      peak = Math.max(peak, running.length);
      if (!running.length && !queue.length) break;
      var parts = [], line = [];
      if (ended.length) {
        var fails = ended.filter(function (i) { return TASKS[i][2] === 'fail'; }), oks = ended.filter(function (i) { return TASKS[i][2] !== 'fail'; });
        if (oks.length) { parts.push('Finished: ' + oks.map(function (i) { return TASKS[i][0]; }).join(', ') + '.'); line.push(7, 9); }
        if (fails.length) { parts.push(fails.map(function (i) { return TASKS[i][0]; }).join(', ') + ' returned 404: RuntimeError, captured by return_exceptions=True so the others carry on.'); line.push(6, 9); }
      }
      if (started.length) { parts.push('Slot acquired: ' + started.map(function (i) { return TASKS[i][0]; }).join(', ') + ' opens a page and navigates.'); line.push(2, 3, 5); }
      if (!parts.length) parts.push(running.length + ' page(s) loading; ' + queue.length + ' coroutine(s) still waiting on the semaphore.');
      F.push({ t: t, st: JSON.parse(JSON.stringify(st)), running: running.slice(), line: line, msg: 't = ' + (t * TICK).toFixed(1) + ' s. ' + parts.join(' ') });
      t++;
    }
    var total = Math.max.apply(null, st.map(function (s) { return s.end; }));
    F.push({ t: total, st: st, running: [], line: [10], total: total,
      msg: 'All done at t = ' + (total * TICK).toFixed(1) + ' s with a limit of ' + limit + '. gather returns the results in input order: 7 dicts and 1 RuntimeError.' });
    F.total = total; F.peak = peak;
    return F;
  }
  function semRender(f, ctx) {
    var T = curFrames.total, limit = +$('#sem-limit').val();
    var $slots = $('<div class="slots"><b>Semaphore slots</b></div>');
    for (var s = 0; s < limit; s++) {
      var i = f.running[s];
      $slots.append($('<span class="slot">').toggleClass('busy', i !== undefined).text(i !== undefined ? TASKS[i][0] : 'free'));
    }
    ctx.stage.append($slots);
    var $g = $('<div class="gantt">');
    TASKS.forEach(function (task, k) {
      var x = f.st[k], $tr = $('<div class="track">');
      function seg(cls, a, b) { if (b > a) $tr.append($('<span class="seg ' + cls + '">').css({ left: (a / T * 100) + '%', width: ((b - a) / T * 100) + '%' })); }
      var now = f.t, startOrNow = x.start < 0 ? now : Math.min(x.start, now);
      seg('wait', 0, startOrNow);
      if (x.start >= 0 && x.start <= now) {
        var finished = x.end <= now;
        seg(finished ? (task[2] === 'fail' ? 'fail' : 'done') : 'run', x.start, Math.min(x.end, now) + (finished ? 0 : 0.35));
      }
      $tr.append($('<span class="now">').css('left', Math.min(99.6, now / T * 100) + '%'));
      $g.append($('<span class="lbl">').text(task[0]), $tr);
    });
    ctx.stage.append($g);
    ctx.stage.append('<div class="legend"><span><i class="sw" style="background:color-mix(in srgb,var(--muted) 22%,var(--bg))"></i>waiting on the semaphore</span><span><i class="sw" style="background:color-mix(in srgb,var(--accent) 55%,var(--bg))"></i>page open, loading</span><span><i class="sw" style="background:color-mix(in srgb,var(--good) 45%,var(--bg))"></i>done</span><span><i class="sw" style="background:color-mix(in srgb,var(--bad) 50%,var(--bg))"></i>failed (404)</span></div>');
  }
  var curFrames = simulate(3);
  var semPlayer = DSA.player('#sem-demo', curFrames, semRender, { speed: 800, code: SEM_CODE });
  function semReadout() {
    var limit = +$('#sem-limit').val(), seq = simulate(1).total, tot = curFrames.total;
    $('#sem-readout').html('Limit ' + limit + ': about <b>' + (tot * TICK).toFixed(1) + ' s</b> in total, at most ' + curFrames.peak + ' pages open. Sequential (limit 1): ' + (seq * TICK).toFixed(1) + ' s.' +
      (limit >= TASKS.length ? ' With no effective limit every page opens at once: fine for 8 URLs, not for 800.' : ''));
  }
  $('#sem-limit').on('change', function () { curFrames = simulate(+this.value); semPlayer.set(curFrames); semReadout(); });
  semReadout();

  // ---------------------------------------------------------------- monitoring loop
  var STEPS = ['home', 'search', 'add_to_cart', 'chat'];
  var RUNS = [
    { at: '09:00', ms: [320, 410, 520, 1450] },
    { at: '09:05', ms: [300, 380, 560, 1500] },
    { at: '09:10', ms: [310, 400, 540, 10000], fail: 'chat', err: 'bot-message still aria-busy="true" after 10 000 ms' },
    { at: '09:15', ms: [330, 390, 510, 10000], fail: 'chat', err: 'bot-message still aria-busy="true" after 10 000 ms' },
    { at: '09:20', ms: [290, 420, 530, 10000], fail: 'chat', err: 'bot-message still aria-busy="true" after 10 000 ms' },
    { at: '09:25', ms: [310, 400, 500, 1600] }];
  var MON_CODE = [
    'result = run_journey(BASE)        # home, search, add_to_cart, chat',
    'write_metrics(result)             # metrics.jsonl / Prometheus / Datadog',
    'if result["ok"]:',
    '    if state["alerting"]: notifier.send("RECOVERED ...")',
    '    state = {"failures": 0, "alerting": False}',
    'else:',
    '    state["failures"] += 1',
    '    if state["failures"] >= FAIL_THRESHOLD and not state["alerting"]:',
    '        notifier.send("ALERT ... (trace: trace-....zip)")',
    '        state["alerting"] = True'];
  function monFrames() {
    var F = [], fails = 0, alerting = false, notes = [], done = [];
    F.push({ run: -1, phase: 0, fails: 0, alerting: false, notes: [], done: [], line: [],
      msg: 'A scheduler (cron, Task Scheduler, a CI schedule) starts monitor.py every 5 minutes. Each run is one short, critical journey against production.' });
    RUNS.forEach(function (r, i) {
      var total = r.ms.reduce(function (a, b) { return a + b; }, 0);
      F.push({ run: i, phase: 1, fails: fails, alerting: alerting, notes: notes.slice(), done: done.slice(), line: [0],
        msg: r.at + ': run_journey() drives a real browser through the four steps' + (r.fail ? '... the chat answer never finishes; the step times out after 10 s and a trace is saved.' : ' in ' + total + ' ms.') });
      done.push({ total: total, ok: !r.fail, at: r.at });
      var line, msg;
      if (!r.fail) {
        line = alerting ? [1, 2, 3, 4] : [1, 2, 4];
        msg = alerting ? 'Success after an incident: send RECOVERED and reset the counter. People know they can stop investigating.' : 'OK. Timings go to the metrics store (watch the trend: a slow creep is an early warning). Failure counter stays at 0.';
        if (alerting) notes.push({ cls: 'rec', text: r.at + ' RECOVERED: ShopBot journey OK (' + total + ' ms)' });
        fails = 0; alerting = false;
      } else {
        fails++;
        if (fails >= 2 && !alerting) {
          alerting = true; line = [1, 5, 6, 7, 8, 9];
          notes.push({ cls: 'alert', text: r.at + ' ALERT: \'' + r.fail + '\' failed ' + fails + ' times in a row: ' + r.err + ' (trace attached)' });
          msg = 'Second consecutive failure: this is not a blip. One alert goes to Slack or the pager, with the failing step, the error and the trace file.';
        } else if (alerting) {
          line = [1, 5, 6, 7]; msg = 'Still failing, but an alert is already open: no repeat message (repeats cause alert fatigue). The metrics still record every failure.';
        } else {
          line = [1, 5, 6, 7]; msg = 'First failure: counted, recorded with its trace, but no alert yet. A single failure is often a network blip or a deploy in progress.';
        }
      }
      F.push({ run: i, phase: 2, fails: fails, alerting: alerting, notes: notes.slice(), done: done.slice(), line: line, msg: r.at + ': ' + msg });
    });
    F.push({ run: -1, phase: 0, fails: fails, alerting: alerting, notes: notes.slice(), done: done.slice(), line: [],
      msg: 'Result: one alert and one recovery message for a 15-minute chat outage, every run recorded with timings, and traces for each failed run to show exactly where it broke.' });
    return F;
  }
  function monRender(f, ctx) {
    var r = f.run >= 0 ? RUNS[f.run] : null;
    var chips = STEPS.map(function (s, k) {
      var cls = '';
      if (r) { cls = r.fail === s ? 'bad' : 'ok'; }
      return '<span class="' + cls + '">' + s + (r ? ' ' + (r.fail === s ? 'timeout' : r.ms[k] + ' ms') : '') + '</span>';
    }).join('');
    var max = 12000, bars = RUNS.map(function (run, i) {
      var d = f.done[i];
      if (!d) return '<div style="height:4px;background:var(--line)"><span>' + run.at + '</span></div>';
      return '<div class="' + (d.ok ? 'ok' : 'bad') + (f.run === i ? ' cur' : '') + '" style="height:' + Math.max(4, Math.round(d.total / max * 100)) + '%" title="' + d.total + ' ms"><span>' + run.at + '</span></div>';
    }).join('');
    var notes = f.notes.length ? f.notes.map(function (n) { return '<div class="' + n.cls + '">' + esc(n.text) + '</div>'; }).join('') : '<div class="muted">(none)</div>';
    ctx.stage.append('<div class="mon">' +
      '<div class="panel"><h4>Journey ' + (r ? r.at : '') + '</h4><div class="checks">' + chips + '</div>' +
      '<h4>State file</h4>consecutive failures: <b>' + f.fails + '</b> &middot; alerting: <b style="color:var(--' + (f.alerting ? 'bad' : 'good') + ')">' + (f.alerting ? 'yes' : 'no') + '</b></div>' +
      '<div class="panel"><h4>Total journey time per run (metrics)</h4><div class="runbars">' + bars + '</div><div style="height:1.2rem"></div></div>' +
      '<div class="panel" style="grid-column:1/-1"><h4>Notifications sent</h4><div class="notes">' + notes + '</div></div></div>');
  }
  DSA.player('#mon-demo', monFrames(), monRender, { speed: 1500, code: MON_CODE });

  // ---------------------------------------------------------------- browser or HTTP client?
  function decide() {
    var on = {};
    $('#decide-demo input:checked').each(function () { on[this.value] = true; });
    var out, alt = false;
    if (on.terms) out = '<b>Stop.</b> Do not automate it. Ask the site owner for permission, a data licence, an export or an API. Neither a browser nor an HTTP client makes a forbidden scrape acceptable.';
    else if (on.render || on.interact) out = '<b>Playwright.</b> Rendering (screenshots, PDFs) and user-like interaction need a real browser.' + (on.volume ? ' For thousands of pages, cap concurrency with a semaphore, block images and fonts, and spread the work over several processes.' : '') + (on.api ? ' Use the API for any data you only need to read.' : '');
    else if (on.api) { out = '<b>HTTP client</b> (httpx) against the API.' + (on.login ? ' If the login itself needs a browser, go <b>hybrid</b>: log in with Playwright once, then reuse the cookies or storage state with httpx.' : ' No browser needed at all.'); alt = true; }
    else if (on.login && !on.js) { out = '<b>Hybrid.</b> Log in with Playwright (save storage_state), then fetch the server-rendered pages with httpx and the browser\'s cookies.'; alt = true; }
    else if (on.js) out = '<b>Playwright</b>, or first look in the network panel: JavaScript-built pages usually load JSON from an endpoint you may be able to call directly' + (on.volume ? ', which matters at your volume.' : '.');
    else if (Object.keys(on).length) { out = '<b>HTTP client</b> plus an HTML parser: the data is in the HTML the server sends.'; alt = true; }
    else out = 'Tick the statements that describe your job.';
    $('#decide-out').html(out).toggleClass('alt', alt);
  }
  $('#decide-demo').on('change', 'input', decide);
  decide();
});

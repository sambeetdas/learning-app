$(function () {
  'use strict';
  PW.pageChrome('actions-assertions');

  // =============================================================== actionability checks
  var CHECKS = ['attached', 'visible', 'stable', 'receives events', 'enabled', 'editable'];
  var CLICK_CODE = ['page.goto("/products/1")', 'page.get_by_role("button", name="Add to cart").click()', 'expect(page.get_by_role("status")).to_have_text("Added to cart")'];
  var FILL_CODE = ['page.goto("/checkout")', 'page.get_by_label("Full name").fill("Alice Liddell")', 'expect(page.get_by_label("Full name")).to_have_value("Alice Liddell")'];
  // st: one letter per check: o = ok, w = waiting, b = failed, - = not checked yet, n = not needed for this action
  function fr(t, st, ui, msg, line, log) { return { t: t, st: st, ui: ui || {}, msg: msg, line: line === undefined ? 1 : line, log: log || '' }; }
  var SCEN = [
    { name: 'Ready button', code: CLICK_CODE, frames: [
      fr('0 ms', '-----n', {}, 'The test calls click(). First the locator is resolved: exactly one button named "Add to cart".', 1, '- waiting for get_by_role("button", name="Add to cart")'),
      fr('2 ms', 'o----n', {}, 'Attached: it resolved to one element in the DOM.', 1, '  - locator resolved to <button type="submit">Add to cart</button>'),
      fr('4 ms', 'ooo--n', {}, 'Visible (non-empty box, not visibility:hidden) and stable (same position for two animation frames).', 1, '- attempting click action\n  - waiting for element to be visible, enabled and stable'),
      fr('6 ms', 'ooooon', { hit: true }, 'Enabled, and the hit test at the button\'s centre finds the button itself: it will receive the click. Editable is not needed for click().', 1, '  - element is visible, enabled and stable\n  - scrolling into view if needed\n  - done scrolling'),
      fr('8 ms', 'ooooon', { act: true }, 'All checks pass: Playwright scrolls if needed and dispatches real mouse events at the centre of the button.', 1, '  - performing click action\n  - click action done'),
      fr('80 ms', 'ooooon', { msg: 'Added to cart' }, 'The page posts to /api/cart and shows "Added to cart". The next expect() polls until it sees that text.', 2, '')] },
    { name: 'Cookie banner overlay', code: CLICK_CODE, frames: [
      fr('0 ms', '-----n', { overlay: true }, 'A cookie banner covers the page for about a second after load (simulated here; many real sites do this).', 1, '- waiting for get_by_role("button", name="Add to cart")'),
      fr('3 ms', 'ooo-on', { overlay: true }, 'Attached, visible and stable: the button is there, under the banner.', 1, '  - locator resolved to <button type="submit">Add to cart</button>\n  - element is visible, enabled and stable'),
      fr('5 ms', 'ooowon', { overlay: true, probe: true }, 'The hit test at the button\'s centre finds the banner, not the button. Clicking now would click the banner, so Playwright does not click.', 1, '  - <div id="cookie-banner">We use cookies</div> intercepts pointer events\n- retrying click action\n  - waiting 20ms'),
      fr('130 ms', 'ooowon', { overlay: true, probe: true }, 'It retries: after 20 ms, 100 ms, 100 ms, then every 500 ms. Still covered.', 1, '  - <div id="cookie-banner">...</div> intercepts pointer events\n- retrying click action\n  - waiting 100ms'),
      fr('730 ms', 'ooowon', { overlay: true, probe: true }, 'Still covered. Each retry runs all the checks again from the start, because the page may have changed.', 1, '  - <div id="cookie-banner">...</div> intercepts pointer events\n- retrying click action\n  - waiting 500ms'),
      fr('1000 ms', 'ooowon', {}, 'The banner disappears. Playwright does not know yet; it finds out on the next retry.', 1, ''),
      fr('1230 ms', 'ooooon', { act: true }, 'Next retry: the hit test now finds the button. Click! The test waited about 1.2 s with no sleep in the code (measured on ShopBot: 1.15 s).', 1, '  - element is visible, enabled and stable\n  - performing click action\n  - click action done'),
      fr('1300 ms', 'ooooon', { msg: 'Added to cart' }, 'If the banner never went away, the click would fail after the timeout with "intercepts pointer events" in the call log, telling you exactly what is in the way.', 2, '')] },
    { name: 'Disabled until loaded', code: CLICK_CODE, frames: [
      fr('0 ms', '-----n', { disabled: true }, 'Imagine the button is rendered disabled until stock is checked (a common pattern).', 1, '- waiting for get_by_role("button", name="Add to cart")'),
      fr('4 ms', 'ooo-wn', { disabled: true }, 'Attached, visible, stable and on top, but not enabled. Playwright waits.', 1, '  - locator resolved to <button disabled>Add to cart</button>\n  - element is not enabled\n- retrying click action'),
      fr('600 ms', 'ooo-wn', { disabled: true }, 'Still disabled: retrying. If it stays disabled (like the out-of-stock Desk Lamp) the click fails after 30 s with "element is not enabled".', 1, '  - element is not enabled\n- retrying click action\n  - waiting 500ms'),
      fr('700 ms', 'ooo-wn', {}, 'The stock check finishes and the app enables the button. Playwright notices on its next retry.', 1, ''),
      fr('1100 ms', 'ooooon', { act: true }, 'The next retry sees an enabled button and clicks it. In Selenium you would have needed an explicit wait for "element to be clickable".', 1, '  - performing click action\n  - click action done'),
      fr('1200 ms', 'ooooon', { msg: 'Added to cart' }, 'Done. Note that a test for the Desk Lamp should assert expect(button).to_be_disabled(), not try to click it.', 2, '')] },
    { name: 'Appears late and slides in', code: CLICK_CODE, frames: [
      fr('0 ms', 'w----n', { absent: true }, 'The product area is still loading: no button in the DOM yet. The locator resolves to zero elements, so Playwright keeps waiting (this is not an error).', 1, '- waiting for get_by_role("button", name="Add to cart")'),
      fr('400 ms', 'ow---n', { hidden: true }, 'The button is inserted but still has visibility:hidden. Attached, not visible.', 1, '  - locator resolved to <button type="submit">Add to cart</button>\n  - element is not visible'),
      fr('450 ms', 'oow--n', { moving: true }, 'Now visible, but it is sliding in with a CSS animation: its bounding box changes between frames, so it is not stable. Clicking now could miss.', 1, '  - element is not stable\n- retrying click action'),
      fr('800 ms', 'ooooon', { act: true }, 'The animation has ended, the box is the same for two frames: stable. All checks pass and the click happens at the final position.', 1, '  - element is visible, enabled and stable\n  - performing click action'),
      fr('900 ms', 'ooooon', { msg: 'Added to cart' }, 'Without "stable", a click during the animation could land where the button used to be.', 2, '')] },
    { name: 'fill() on a read-only field', code: FILL_CODE, frames: [
      fr('0 ms', '--nn--', { form: true, ro: true }, 'fill() needs different checks: visible, enabled and editable (no stable or hit test). Here the name field is readonly until the page has loaded the user profile.', 1, '- waiting for get_by_label("Full name")'),
      fr('3 ms', 'oonnow', { form: true, ro: true }, 'Attached, visible, enabled, but readonly: not editable. Playwright waits instead of typing into a field that would ignore the text.', 1, '  - locator resolved to <input name="name" readonly>\n  - waiting for element to be visible, enabled and editable\n  - element is not editable'),
      fr('500 ms', 'oonnoo', { form: true, typed: 'Alice Liddell' }, 'The app removes readonly; the next retry finds the field editable and fills it.', 1, '  - element is visible, enabled and editable\n  - fill("Alice Liddell")'),
      fr('520 ms', 'oonnoo', { form: true, typed: 'Alice Liddell' }, 'expect(...).to_have_value() confirms the value. On a truly read-only field, fill() would fail after the timeout with "element is not editable".', 2, '')] }
  ];
  var LABEL = { o: 'ok', w: 'wait', b: 'bad' };
  function render(f, ctx) {
    var $g = $('<div class="aw">').appendTo(ctx.stage), $left = $('<div>').appendTo($g), $right = $('<div>').appendTo($g);
    var $mb = $('<div class="mockbrowser"><div class="chrome"><i></i><i></i><i></i><span class="url"></span></div><div class="viewport"></div></div>').appendTo($left);
    var u = f.ui, $v = $mb.find('.viewport');
    if (u.form) {
      $mb.find('.url').text('127.0.0.1:8000/checkout');
      $v.append('<h4>Checkout</h4>');
      var $name = $('<span class="el">').text(u.typed || (u.ro ? 'Full name (loading...)' : 'Full name')).toggleClass('ro', !!u.ro).toggleClass('act', !!u.typed);
      $v.append($('<div>').append('<span class="muted">Full name </span>', $name), $('<div>').append('<span class="muted">Email </span>', '<span class="el">&nbsp;</span>'));
    } else {
      $mb.find('.url').text('127.0.0.1:8000/products/1');
      $v.append('<h4>Ceramic Mug</h4><div class="muted">£12.00 · A 350 ml stoneware mug.</div>');
      var $row = $('<div>').append('<span class="el">Quantity 1</span>').appendTo($v);
      if (!u.absent) {
        var $btn = $('<span class="el">Add to cart</span>').appendTo($row);
        if (u.disabled) $btn.addClass('dis');
        if (u.hidden) $btn.addClass('ghost');
        if (u.moving) $btn.addClass('moving');
        if (u.act) $btn.addClass('act');
        if (u.hit) $btn.addClass('hit');
        if (u.probe) $btn.addClass('multi');
      } else $row.append('<span class="muted"> loading...</span>');
      $('<div class="status">').text(u.msg || '').appendTo($v);
      if (u.overlay) $v.append('<div class="overlay">We use cookies</div>');
    }
    $right.append($('<div class="clock">').text('t = ' + f.t));
    var $c = $('<div class="checks big">').appendTo($right);
    CHECKS.forEach(function (name, i) {
      var s = f.st.charAt(i), $s = $('<span>').text(name).appendTo($c);
      if (LABEL[s]) $s.addClass(LABEL[s]).text((s === 'o' ? '✓ ' : s === 'w' ? '… ' : '✗ ') + name);
      if (s === 'n') $s.css('opacity', .35).attr('title', 'not checked for this action');
    });
    $right.append($('<pre class="logbox">').text(f.log || ' '));
  }
  var cur = 0, player = DSA.player('#aw-demo', SCEN[0].frames, render, { speed: 1500, code: SCEN[0].code });
  SCEN.forEach(function (s, i) {
    $('<button type="button">').text(s.name).toggleClass('active', i === 0).on('click', function () {
      cur = i; $('#aw-demo .scen button').removeClass('active'); $(this).addClass('active'); player.set(s.frames, s.code);
    }).appendTo('#aw-demo .scen');
  });

  // =============================================================== polling: expect vs assert
  var ANSWER = ['Standard ', 'shipping ', 'takes ', '3-5 ', 'business ', 'days ', 'and ', 'is ', 'free ', 'on ', 'orders ', 'over ', '50 ', 'GBP ', '[shipping].'];
  // text after t ms: about one token every 30 ms after a 20 ms start-up (as measured on ShopBot)
  function textAt(t) { var n = Math.max(0, Math.min(ANSWER.length, Math.floor((t - 20) / 30))); return ANSWER.slice(0, n).join(''); }
  var PCODE = ['page.get_by_role("button", name="Send").click()', 'assert "[shipping]" in bot.inner_text()      # left lane', 'expect(bot).to_contain_text("[shipping]")     # right lane'];
  var CHECKS_AT = [0, 100, 350, 850];   // expect re-checks after 100, 250, 500 ms, then every second
  var PF = [];
  PF.push({ t: 0, a: 'wait', e: 'wait', ticks: [], msg: 'The user question was sent. ShopBot\'s chat streams its answer token by token, so the bubble starts empty.', line: 0 });
  PF.push({ t: 2, a: 'bad', e: 'wait', ticks: [0], msg: 'Left: assert reads inner_text() once, gets "", and fails immediately with AssertionError. Right: expect() also sees "" but does not fail; it schedules another check.', line: [1, 2] });
  PF.push({ t: 100, a: 'bad', e: 'wait', ticks: [0, 100], msg: 'expect re-checks after 100 ms: "' + textAt(100).trim() + '". No "[shipping]" yet. The assert is long gone.', line: 2 });
  PF.push({ t: 350, a: 'bad', e: 'wait', ticks: [0, 100, 350], msg: 'After another 250 ms: most of the sentence, still no citation. Keep polling (intervals grow: 100, 250, 500 ms, then 1 s).', line: 2 });
  PF.push({ t: 500, a: 'bad', e: 'wait', ticks: [0, 100, 350], msg: 'The stream has finished at about 0.47 s, but expect only finds out at its next check.', line: 2 });
  PF.push({ t: 850, a: 'bad', e: 'ok', ticks: [0, 100, 350, 850], msg: 'Check at 850 ms: the text contains "[shipping]". The assertion passes (measured on ShopBot: 0.83 - 0.87 s). With a real LLM that takes 4 s, the same line still passes; the default timeout is 5 s.', line: 2 });
  PF.push({ t: 850, a: 'bad', e: 'ok', ticks: [0, 100, 350, 850], timeout: true, msg: 'If the text never appeared, expect would keep checking every second until 5 s, then fail with the last actual value and a call log ("N × locator resolved to ... unexpected value").', line: 2 });
  function pos(t) { return (5 + Math.sqrt(Math.min(t, 1000) / 1000) * 85) + '%'; }   // square-root time axis so early checks do not overlap
  function prender(f, ctx) {
    var $r = $('<div class="race">').appendTo(ctx.stage);
    function lane(title, kind, shown, verdict, vcls, ticks) {
      var $l = $('<div class="lane">').appendTo($r);
      $('<h4>').text(title).appendTo($l);
      var $b = $('<div class="bubble">').text(shown).appendTo($l);
      if (textAt(f.t).length < ANSWER.join('').length) $b.append('<span class="cursor"></span>');
      $l.append('<div class="tlaxis"></div>');
      var $tl = $('<div class="tl">').appendTo($l);
      ticks.forEach(function (t) {
        var pass = kind === 'expect' ? textAt(t).indexOf('[shipping]') >= 0 : false, last = t === ticks[ticks.length - 1];
        $('<span class="tick">').addClass(pass ? 'ok' : kind === 'assert' ? 'bad' : last ? 'wait' : '').css('left', pos(t)).text(t + ' ms').appendTo($tl);
      });
      $('<span class="now">').css('left', pos(f.t)).appendTo($tl);
      $('<div class="verdict">').addClass(vcls).text(verdict).appendTo($l);
    }
    var now = textAt(f.t);
    lane('assert "[shipping]" in bot.inner_text()', 'assert', f.t >= 2 ? '(read once at 0 ms: "")' : now, f.a === 'bad' ? '✗ AssertionError at 0 ms' : 'about to read...', f.a === 'bad' ? 'bad' : 'wait', f.t >= 2 ? [0] : []);
    lane('expect(bot).to_contain_text("[shipping]")', 'expect', now, f.e === 'ok' ? (f.timeout ? '✓ passed at 850 ms (would fail only after 5 s)' : '✓ passed at 850 ms') : f.ticks.length ? '… not yet, will re-check' : 'starting...', f.e, f.ticks);
  }
  DSA.player('#poll-demo', PF, prender, { speed: 1500, code: PCODE });
});

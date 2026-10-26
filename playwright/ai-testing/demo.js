$(function () {
  'use strict';
  PW.pageChrome('ai-testing');
  function esc(s) { return $('<i>').text(s).html(); }

  // ---------------------------------------------------------------- test pyramid
  var LAYERS = [   // top first
    { name: 'Production monitoring', sub: 'sampled traces, feedback', w: 34,
      what: 'Judge a sample of real conversations online (groundedness, safety), track thumbs-down rate, latency and cost per version, and alert on drops.',
      how: 'Tracing + an online judge + dashboards.', model: 'Real traffic', when: 'Continuously', count: 'n/a' },
    { name: 'Live evaluations', sub: 'golden set, judges, thresholds', w: 48,
      what: 'Run the real model over a golden dataset; score with keywords, citations and an LLM judge; gate on pass rate. Includes live safety (prompt-injection) suites.',
      how: 'pytest -m live, API-level for volume, a few end-to-end UI cases.', model: 'Real model', when: 'Nightly, and on every prompt, model or retrieval change', count: 'Hundreds of cases, minutes, costs tokens' },
    { name: 'Deterministic UI and agent tests', sub: 'Playwright + mocked model', w: 64,
      what: 'Rendering, streaming states, citations, error states (429, timeouts), accessibility, keyboard use; agent tool sequences, budgets and guards with a scripted model.',
      how: 'page.route with canned SSE, init-script streams, scripted Anthropic client.', model: 'Mocked / scripted', when: 'Every pull request', count: 'Dozens to hundreds, ~1 s each, free' },
    { name: 'API contract tests', sub: 'back-end fake LLM', w: 80,
      what: 'The event format, error mapping, auth, request validation, retrieval returning the right documents for known questions.',
      how: 'pytest + httpx or playwright.request against the app with a fake model.', model: 'Back-end fake', when: 'Every pull request', count: 'Dozens, milliseconds' },
    { name: 'Unit tests', sub: 'no browser, no model', w: 96,
      what: 'Prompt builders, output parsers, SSE parsing, retrieval scoring, tool functions, allow-lists and approval rules, judge helpers with fake judges.',
      how: 'Plain pytest.', model: 'None', when: 'Every commit', count: 'Hundreds, milliseconds' }
  ];
  var $pyr = $('#pyr-demo .pyr');
  function showLayer(i) {
    var L = LAYERS[i];
    $pyr.children().removeClass('active').eq(i).addClass('active');
    $('#pyr-out').html('<b>' + L.name + '</b>: ' + L.what + '<br><b>How:</b> ' + L.how + ' &middot; <b>Model:</b> ' + L.model + ' &middot; <b>When:</b> ' + L.when + ' &middot; <b>Volume:</b> ' + L.count);
  }
  LAYERS.forEach(function (L, i) {
    $('<button type="button">').css('width', L.w + '%').html(L.name + '<small>' + L.sub + '</small>').on('click', function () { showLayer(i); }).appendTo($pyr);
  });
  showLayer(2);

  // ---------------------------------------------------------------- streaming test, step by step
  var SCODE = [
    'page.add_init_script(STREAM_HOOK); page.goto("/chat")',
    'page.get_by_label("Your question").fill("Shipping?"); send.click()',
    'expect(bot).to_have_attribute("aria-busy", "true")',
    'push(page, \'data: {"type": "token", "text": "Standard shipping "}\')',
    'expect(bot).to_have_text("Standard shipping")',
    'push(page, \'data: {"type": "token", "text": "takes 3-5 days."}\')',
    'expect(bot).to_have_text("Standard shipping takes 3-5 days.")',
    'push(page, \'data: {"type": "done", "sources": ["shipping"]}\'); push(page, None)',
    'expect(bot).to_have_attribute("aria-busy", "false")'
  ];
  var EV1 = 'data: {"type": "token", "text": "Standard shipping "}', EV2 = 'data: {"type": "token", "text": "takes 3-5 days."}', EV3 = 'data: {"type": "done", "sources": ["shipping"]}';
  var SF = [
    { line: 0, user: false, events: [], msg: 'The init script replaces fetch for /api/chat with a stream the test controls. Nothing has been sent yet.' },
    { line: 1, user: true, bot: '', busy: 'true', events: [], msg: 'The test sends a question. The UI adds the user bubble and an empty bot bubble with aria-busy="true", then starts reading the (still empty) stream.' },
    { line: 2, user: true, bot: '', busy: 'true', events: [], check: ['ok', 'aria-busy = true'], msg: 'Assert the busy state while nothing has arrived: this is what a screen reader and a spinner rely on.' },
    { line: 3, user: true, bot: 'Standard shipping ', busy: 'true', events: [[EV1, 'new']], msg: 'The test pushes the first chunk. The UI parses the event and appends the token.' },
    { line: 4, user: true, bot: 'Standard shipping ', busy: 'true', events: [[EV1, '']], check: ['ok', 'partial text visible'], msg: 'expect retries until the partial text appears. Because the test controls timing, this is deterministic: no sleeps, no race.' },
    { line: 5, user: true, bot: 'Standard shipping takes 3-5 days.', busy: 'true', events: [[EV1, ''], [EV2, 'new']], msg: 'Second chunk. A tempting mistake is to read inner_text() here: the stream is not finished yet.' },
    { line: 6, user: true, bot: 'Standard shipping takes 3-5 days.', busy: 'true', events: [[EV1, ''], [EV2, '']], check: ['ok', 'full text'], msg: 'Full text matches, but the bubble still says busy: the done event has not arrived.' },
    { line: 7, user: true, bot: 'Standard shipping takes 3-5 days.', busy: 'false', sources: 'shipping', events: [[EV1, ''], [EV2, ''], [EV3, 'new']], msg: 'The done event carries the sources; the UI sets aria-busy="false" and data-sources. The test closes the stream.' },
    { line: 8, user: true, bot: 'Standard shipping takes 3-5 days.', busy: 'false', sources: 'shipping', events: [[EV1, ''], [EV2, ''], [EV3, 'ok']], check: ['ok', 'aria-busy = false'], msg: 'Finished. Only now is it safe to read the answer, check citations or hand the text to a judge. With a live model, this is the one wait you always need.' }
  ];
  function srender(f, ctx) {
    var $g = $('<div class="twocol">').appendTo(ctx.stage), $l = $('<div>').appendTo($g), $r = $('<div>').appendTo($g);
    var vp = '<div class="mockbrowser"><div class="chrome"><i></i><i></i><i></i><span class="url">http://127.0.0.1:8000/chat</span></div><div class="viewport"><b>Support chat</b>';
    if (f.user) vp += '<div class="bubble user">Shipping?</div><div class="bubble bot">' + esc(f.bot || '') + (f.busy === 'true' ? '<span class="cursor"></span>' : '') + '</div>' +
      '<div class="attr">aria-busy="' + f.busy + '"' + (f.sources ? ' data-sources="' + f.sources + '"' : '') + '</div>';
    else vp += '<p class="muted" style="font-size:.85rem">Ask about returns, shipping or warranty.</p>';
    vp += '<div class="row" style="margin-top:.4rem">Your question <span class="el">' + (f.user ? '' : 'Shipping?') + '</span> <span class="el">Send</span></div></div></div>';
    $l.append('<h4>Page</h4>' + vp);
    $r.append('<h4>Events pushed by the test</h4>');
    var $ev = $('<pre class="evlist"><code></code></pre>').appendTo($r);
    if (!f.events.length) $ev.find('code').text('(stream open, nothing pushed)');
    f.events.forEach(function (e) { $('<span class="cl">').addClass(e[1]).text(e[0]).appendTo($ev.find('code')); });
    var $c = $('<div class="checks">').appendTo($r);
    if (f.check) $('<span>').addClass(f.check[0]).text('expect: ' + f.check[1]).appendTo($c);
    else $('<span class="wait">').text(f.user ? 'streaming...' : 'idle').appendTo($c);
  }
  DSA.player('#stream-demo', SF, srender, { speed: 1500, code: SCODE });

  // ---------------------------------------------------------------- assertion ladder
  var ANSWERS = [
    { t: 'You can return unused items within 30 days of delivery for a full refund [returns].', r: [1, 1, 1, 1, ['1.00', 1], ['5/5', 1]],
      note: 'The reference answer itself: everything passes.' },
    { t: 'Sure! Unused mugs can be sent back up to a month after delivery and you will get all your money back [returns].', r: [0, 0, 1, 1, ['0.84', 1], ['4/5', 1]],
      note: 'A correct paraphrase. Exact match and the "30 days" keyword wrongly fail; the regex (which also allows "a month"), similarity and the judge accept it.' },
    { t: 'You can return items within 60 days of delivery for a full refund [returns].', r: [0, 0, 0, 1, ['0.95', 1], ['1/5', 0]],
      note: 'A wrong number. Similarity scores it highest of all the wrong answers, because one digit barely changes the vector. Keywords and the judge catch it.' },
    { t: 'You have 30 days to return it, and shipping is always free [returns].', r: [0, 1, 1, 1, ['0.86', 1], ['2/5', 0]],
      note: 'Right on the main fact, plus a hallucination (shipping is free only over 50 GBP). Only the judge, given the policy as context and a "no unsupported claims" rubric point, catches it.' },
    { t: 'I am not able to help with that.', r: [0, 0, 0, 0, ['0.21', 0], ['1/5', 0]],
      note: 'An over-refusal. Every method fails it; a keyword check is enough here and costs nothing.' }
  ];
  var COLS = ['Exact match', 'Keyword "30 days"', 'Regex 30\\s*days|a month', 'Cites [returns]', 'Similarity &ge; 0.8*', 'LLM judge (rubric)'];
  ANSWERS.forEach(function (a, i) {
    $('#ladder-answers').append($('<label>').append($('<input type="radio" name="ladder">').val(i).prop('checked', i === 0), ' ' + String.fromCharCode(65 + i) + '. ', $('<span>').text(a.t)));
  });
  function ladder() {
    var a = ANSWERS[+$('input[name=ladder]:checked').val()];
    var cells = a.r.map(function (v) { var ok = Array.isArray(v) ? v[1] : v, label = Array.isArray(v) ? v[0] + (ok ? ' pass' : ' fail') : (ok ? 'pass' : 'fail'); return '<td class="' + (ok ? 'p' : 'f') + '">' + label + '</td>'; });
    $('#ladder-out').html('<div class="table-wrap"><table class="ladder"><tr>' + COLS.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr><tr>' + cells.join('') + '</tr></table></div>' +
      '<div class="readout">' + a.note + '</div><p class="muted" style="font-size:.8rem">* Similarity values are illustrative; real values depend on the embedding model. Judge scores are what a calibrated judge with the returns policy as context should return.</p>');
  }
  $('#ladder-answers').on('change', 'input', ladder);
  ladder();

  // ---------------------------------------------------------------- self-healing
  var SNAP = ['- main:', '  - heading "Ceramic Mug" [level=1]', '  - paragraph: £12.00', '  - text: Quantity', '  - spinbutton "Quantity": "1"', '  - button "Add to cart"', '  - status', '  - heading "Reviews" [level=2]', '  - list "Reviews": ...'];
  var HCODE = [
    'try: locator.wait_for(state="visible", timeout=3000); return locator',
    'except TimeoutError: snapshot = page.locator("body").aria_snapshot()',
    'proposal = propose(prompt(locator, intent, snapshot))   # LLM, structured output',
    'candidate = build(page, proposal); count = candidate.count()',
    'status = "valid" if count == 1 and candidate.is_visible() else "rejected"',
    'append_jsonl(SUGGESTIONS, {old, new, status, why})',
    'raise LocatorBroken(f"... Suggested ({status}): {as_code(proposal)}")'
  ];
  function healFrames(scn) {
    var ambig = scn === 'ambig';
    var prop = ambig ? '{"strategy": "role", "value": "link", "name": "", "why": "a product link"}' : '{"strategy": "role", "value": "button", "name": "Add to cart", "why": "renamed from Add to basket"}';
    var code = ambig ? 'page.get_by_role("link")' : 'page.get_by_role("button", name="Add to cart", exact=True)';
    return [
      { line: null, el: '', checks: [], msg: 'The test asks for get_by_role("button", name="Add to basket"), but a recent change renamed the button to "Add to cart".', panel: 'heal(page, page.get_by_role("button", name="Add to basket"), "the add-to-cart button")' },
      { line: 0, el: 'miss', checks: [['wait', 'waiting for visible...']], msg: 'heal() first tries the original locator normally, with a short timeout. When nothing is broken it returns immediately and the LLM is never called.', panel: 'locator.wait_for(state="visible", timeout=3000)' },
      { line: 0, el: 'miss', checks: [['bad', '0 matches after 3 s']], msg: 'No element matches. A normal test would fail here with a timeout and no hint.', panel: 'TimeoutError: waiting for get_by_role("button", name="Add to basket")' },
      { line: 1, el: '', snap: true, checks: [['bad', '0 matches'], ['ok', 'aria snapshot collected']], msg: 'Collect the accessibility snapshot: compact, and it contains the roles and names the replacement must use.', panel: '(snapshot sent to the model, with the broken locator and the intent)' },
      { line: 2, el: '', snap: true, hlSnap: !ambig, checks: [['bad', '0 matches'], ['ok', 'snapshot'], ['wait', 'asking the model...']], msg: 'The model returns a structured Proposal (pydantic): a strategy and values, not free-form code, so it cannot inject arbitrary Python.', panel: prop },
      { line: 3, el: ambig ? 'multi' : 'hit', snap: true, hlSnap: !ambig, checks: [['bad', '0 matches'], ['ok', 'snapshot'], [ambig ? 'bad' : 'ok', ambig ? 'candidate matches 10 elements' : 'candidate matches 1 element']], msg: ambig ? 'Validate: the proposed locator matches 10 links. Ambiguous, so it is rejected; using it would click a random element.' : 'Validate: build the locator and count matches. Exactly one, and it is visible.', panel: code + '.count() == ' + (ambig ? '10' : '1') },
      { line: [4, 5], el: ambig ? 'multi' : 'hit', snap: true, checks: [['ok', 'recorded for review']], msg: 'Record the suggestion with its status in healing-suggestions.jsonl, published as a CI artifact.', panel: '{"intent": "the add-to-cart button", "new": "' + code.replace(/"/g, '\\"') + '", "status": "' + (ambig ? 'rejected: matches 10 elements' : 'valid') + '", ...}' },
      { line: 6, el: ambig ? 'multi' : 'hit', snap: true, checks: [['bad', 'test FAILED (with suggestion)']], msg: 'The test still fails. Healing produces a suggestion, never a silent pass: maybe the rename was intended, maybe it was the bug.', panel: 'LocatorBroken: Locator for \'the add-to-cart button\' is broken.\nSuggested (' + (ambig ? 'rejected: matches 10 elements' : 'valid') + '): ' + code },
      { line: null, el: ambig ? '' : 'hit', checks: [['ok', ambig ? 'human investigates' : 'human accepts, next run passes']], msg: ambig ? 'A person reads the failure and the rejected suggestion, and fixes the locator by hand (or finds a real bug).' : 'A person reviews: the rename was intended, so they accept the suggestion in a pull request. The next run passes with the new locator.', panel: ambig ? '# reviewer decides' : '- page.get_by_role("button", name="Add to basket")\n+ page.get_by_role("button", name="Add to cart")' }
    ];
  }
  function hrender(f, ctx) {
    var $g = $('<div class="twocol">').appendTo(ctx.stage), $l = $('<div>').appendTo($g), $r = $('<div>').appendTo($g);
    var btnCls = f.el === 'hit' ? ' hit' : f.el === 'miss' ? ' miss' : '';
    var linkCls = f.el === 'multi' ? ' multi' : '';
    $l.append('<h4>Page</h4><div class="mockbrowser"><div class="chrome"><i></i><i></i><i></i><span class="url">http://127.0.0.1:8000/products/1</span></div><div class="viewport">' +
      '<div class="row"><span class="el' + linkCls + '">ShopBot</span><span class="el' + linkCls + '">Products</span><span class="el' + linkCls + '">Support chat</span><span class="el' + linkCls + '">Cart (0)</span></div>' +
      '<div class="row"><b>Ceramic Mug</b> £12.00</div><div class="row">Quantity <span class="el">1</span> <span class="el' + btnCls + '">Add to cart</span></div></div></div>');
    var $c = $('<div class="checks">').appendTo($l);
    f.checks.forEach(function (c) { $('<span>').addClass(c[0]).text(c[1]).appendTo($c); });
    $r.append('<h4>' + (f.snap ? 'Aria snapshot' : 'Helper') + '</h4>');
    if (f.snap) {
      var $s = $('<pre class="evlist"><code></code></pre>').appendTo($r);
      SNAP.forEach(function (l) { $('<span class="cl">').addClass(f.hlSnap && l.indexOf('button "Add to cart"') >= 0 ? 'hl' : '').text(l).appendTo($s.find('code')); });
    }
    $('<div class="verdict">').addClass(f.checks.some(function (c) { return c[0] === 'bad'; }) ? 'bad' : 'ok').append($('<code>').css('white-space', 'pre-wrap').text(f.panel)).appendTo($r);
  }
  var hp = DSA.player('#heal-demo', healFrames('rename'), hrender, { speed: 1500, code: HCODE });
  $('#heal-scn').on('change', function () { hp.set(healFrames(this.value)); });
});

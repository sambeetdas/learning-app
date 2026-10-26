$(function () {
  'use strict';
  PW.pageChrome('project-test-generator');

  // ---------------------------------------------------------------- architecture
  var D = {
    nodes: [['story', 'User story', 'client', 0, 0, 'stories/*.md'], ['cli', 'testgen', 'svc', 0, 1.4, 'generate()'],
      ['llm', 'Claude', 'llm', 1.6, 0, 'step / repair'], ['mcp', 'playwright mcp', 'gw', 1.6, 1.4, 'stdio MCP server'],
      ['br', 'Browser', 'ext', 3.2, 1.4, 'headless, isolated'], ['app', 'ShopBot', 'svc', 4.8, 1.4, 'app under test'],
      ['file', 'Generated test', 'blob', 1.6, 2.8, 'generated/test_*.py'], ['pt', 'pytest', 'svc', 3.2, 2.8, 'subprocess'],
      ['tr', 'trace.zip', 'blob', 4.8, 2.8, 'retain-on-failure'], ['rev', 'Reviewer', 'client', 0, 2.8, 'diff + approve']],
    edges: [['story', 'cli'], ['cli', 'llm'], ['cli', 'mcp'], ['mcp', 'br'], ['br', 'app'], ['cli', 'file'], ['file', 'pt'],
      ['pt', 'app', '', 'none'], ['pt', 'tr', '', 'async'], ['cli', 'rev']]
  };
  PW.flows('#arch-demo', D, [
    { name: 'Explore', desc: 'Claude performs the story through MCP; the tool keeps the code MCP reports.', steps: [
      ['story', 'cli', 'add_two_mugs.md', 'The story and its acceptance criteria become the first user message.'],
      ['cli', 'llm', 'system + story + 12 tools', 'Only allow-listed MCP tools are offered, plus a strict submit_test tool.'],
      ['llm', 'cli', 'tool_use: browser_click(e22)', 'The model picks an action, targeting a ref from the latest snapshot.', 'resp'],
      ['cli', 'mcp', 'call_tool(...)', 'The manual loop executes the tool through the MCP client session.'],
      ['mcp', 'br', 'click', 'The MCP server drives its own browser...'],
      ['br', 'app', 'GET /products/1', '...which talks to ShopBot like a user would.'],
      ['mcp', 'cli', 'Ran Playwright code', 'The result contains page.get_by_role("link", name="Ceramic Mug").click(): appended to the steps.', 'resp'],
      ['cli', 'llm', 'tool_result', 'All results of the turn go back in one user message; errors are flagged with is_error.'],
      ['llm', 'cli', 'submit_test(assertions)', 'When the outcome is visible, the model submits 2-4 expect() lines.', 'resp']] },
    { name: 'Run and heal', desc: 'Write, check, run; on failure, repair with evidence (max N attempts).', steps: [
      ['cli', 'file', 'render + AST check', 'The steps and assertions become a pytest function; the AST allow-list runs before anything executes.'],
      ['file', 'pt', 'attempt 1', 'pytest runs the file in a subprocess with --tracing retain-on-failure.'],
      { par: [['pt', 'app', 'browser test'], ['pt', 'tr', 'trace.zip', 'async']], msg: 'The test drives a fresh browser; the failing run keeps its trace.' },
      ['pt', 'cli', 'FAILED: heading not found', 'expect(...).to_be_visible() failed; pytest prints the call log and an aria snapshot.', 'err'],
      ['cli', 'llm', 'failure + aria + trace actions', 'The failure report: pytest E-lines plus playwright trace actions / errors.'],
      ['llm', 'cli', 'RepairedTest(locator)', 'A typed repair: diagnosis, change_kind and the full corrected file.', 'resp'],
      ['cli', 'file', 'expects 3 >= 3', 'The repair passes the same AST check and may not drop assertions.'],
      ['file', 'pt', 'attempt 2', 'Run again.'],
      ['pt', 'cli', 'PASSED', 'Green: move on to review.', 'resp']] },
    { name: 'Review', desc: 'Nothing joins the suite without a person.', steps: [
      ['cli', 'rev', 'unified diff draft -> healed', 'The reviewer sees exactly what the healer changed, and the final file.'],
      ['rev', 'cli', 'y', 'Approved: the file is written to tests/e2e/. Rejected: nothing is written.', 'resp']] }
  ]);
  $('#arch-legend').html(PW.legend([['client', 'people and inputs'], ['svc', 'tool, pytest, app'], ['gw', 'MCP server'], ['data', 'files'], ['ai', 'model'], ['ext', 'browser']]));

  // ---------------------------------------------------------------- generate / run / heal stepper
  var STAGES = ['Story', 'Explore', 'Draft', 'Check', 'Run', 'Heal', 'Review'];
  var L = ['def test_add_two_mugs_to_cart(page: Page):',
    '    page.goto("/products")',
    '    page.get_by_role("link", name="Ceramic Mug").click()',
    '    page.get_by_role("spinbutton", name="Quantity").fill("2")',
    '    page.get_by_role("button", name="Add to cart").click()',
    '    page.get_by_role("link", name="Cart (2)").click()',
    '    expect(page.get_by_role("heading", name="Shopping cart")).to_be_visible()',
    '    expect(page.get_by_role("link", name="Cart (2)")).to_be_visible()',
    '    expect(page.get_by_test_id("cart-total")).to_have_text("£24.00")'];
  var HEALED = '    expect(page.get_by_role("heading", name="Your cart")).to_be_visible()';
  var STORY = '# Add two mugs to the cart\nAs a shopper I want to add two Ceramic Mugs to my cart...\n- open the Ceramic Mug and add quantity 2\n- the cart link shows 2 items\n- the cart total is £24.00';
  function call(name, args, code) { return 'tool_use  ' + name + '(' + args + ')' + (code ? '\n\n### Ran Playwright code\n' + code : '\n\n(no code: observation only)'); }
  var F = [
    { s: 0, left: ['Input', STORY], n: 0, msg: 'The story is the only input. Acceptance criteria become the assertions later.' },
    { s: 1, left: ['Turn 1', call('browser_navigate', '{"url": "http://127.0.0.1:8000/products"}', 'page.goto("http://127.0.0.1:8000/products")')], n: 2, nw: [1], msg: 'MCP navigates and reports the equivalent line. The host is rewritten to a path, so the test works with --base-url.' },
    { s: 1, left: ['Turn 2', call('browser_snapshot', '') + '\n- article:\n  - heading "Ceramic Mug" [level=2]:\n    - link "Ceramic Mug" [ref=e22]'], n: 2, msg: 'The model asks for the accessibility snapshot: roles, names and refs.' },
    { s: 1, left: ['Turn 3', call('browser_click', '{"element": "Ceramic Mug link", "target": "e22"}', 'page.get_by_role("link", name="Ceramic Mug").click()')], n: 3, nw: [2], msg: 'It clicks by ref; MCP translates that into a role-based locator, which is what goes into the test.' },
    { s: 1, left: ['Turns 4-6', call('browser_type', '{"target": "f1e16", "text": "2"}', 'page.get_by_role("spinbutton", name="Quantity").fill("2")') + '\n\n' + call('browser_click', '{"target": "f1e17"}', 'page.get_by_role("button", name="Add to cart").click()')], n: 5, nw: [3, 4], msg: 'After the navigation the refs have a frame prefix (f1e16). Quantity 2, then Add to cart.' },
    { s: 1, left: ['Turns 7-9', call('browser_click', '{"element": "Cart link", "target": "f1e22"}', 'page.get_by_role("link", name="Cart (2)").click()')], n: 6, nw: [5], msg: 'A fresh snapshot shows link "Cart (2)" with a new ref; the model opens the cart and snapshots it again.' },
    { s: 1, left: ['Turn 10', 'tool_use  submit_test(\n  test_name="test_add_two_mugs_to_cart",\n  assertions=[\n    heading "Shopping cart" visible,\n    link "Cart (2)" visible,\n    cart-total == "£24.00"])'], n: 9, nw: [6, 7, 8], msg: 'The model submits three assertions. One is a guess: the heading is really "Your cart". Models make exactly this kind of mistake.' },
    { s: 3, left: ['check_generated()', 'names used: page, expect, re   ✓\nimports: re, playwright.sync_api ✓\nbanned attributes: none          ✓\nexpect() calls: 3'], n: 9, msg: 'Before running anything, the AST check confirms the file only uses page, expect and re.' },
    { s: 4, bad: 4, left: ['attempt 1: FAILED', 'AssertionError: Locator expected to be visible\nError: element(s) not found\n- waiting for get_by_role("heading", name="Shopping cart")\n\nAria snapshot:\n- main:\n  - heading "Your cart" [level=1]\n  - table: ...'], n: 9, err: [6], msg: 'pytest fails on line 6. Playwright 1.64 prints the page’s aria snapshot, so the real heading is right there in the error.' },
    { s: 5, left: ['repair() -> RepairedTest', 'diagnosis: The page heading is "Your cart",\n           not "Shopping cart".\nchange_kind: locator\ncode: (full corrected file)'], n: 9, err: [6], heal: true, msg: 'The failure report (pytest error, trace actions, trace errors) goes to the healer, which returns a typed repair.' },
    { s: 3, left: ['check_generated(min_expects=3)', 'expect() calls: 3 >= 3  ✓\nthe repair did not weaken the test'], n: 9, healed: true, nw: [6], msg: 'The repair must pass the same safety check and keep every assertion. "app_bug" would have stopped the loop here instead.' },
    { s: 4, left: ['attempt 2: PASSED', '1 passed'], n: 9, healed: true, msg: 'Green on the second attempt (the budget was three).' },
    { s: 6, left: ['review', '-    expect(page.get_by_role("heading", name="Shopping cart"))...\n+    expect(page.get_by_role("heading", name="Your cart"))...\n\nAdd tests/e2e/test_add_two_mugs_to_cart.py to the suite? [y/N] y'], n: 9, healed: true, done: true, msg: 'A person reads the diff and approves. Only now is the test written into tests/e2e/.' }
  ];
  function esc(s) { return $('<i>').text(s).html(); }
  DSA.player('#loop-demo', F, function (f, ctx) {
    var chips = STAGES.map(function (s, i) {
      var c = i === f.s ? (f.bad === i ? 'bad' : 'on') : (i < f.s || f.done ? 'done' : '');
      return '<span class="' + c + '">' + s + '</span>';
    }).join('');
    ctx.stage.append('<div class="stages">' + chips + '</div>');
    var lines = '';
    for (var i = 0; i < f.n; i++) {
      var cls = (f.nw || []).indexOf(i) >= 0 ? 'new' : (f.err || []).indexOf(i) >= 0 && !f.healed ? 'gone' : '';
      if (i === 6 && f.heal) lines += '<span class="gone">' + esc(L[6]) + '</span><span class="new">' + esc(HEALED) + '</span>';
      else lines += '<span class="' + cls + '">' + esc(i === 6 && f.healed ? HEALED : L[i]) + '</span>' + (cls ? '' : '\n');
    }
    var right = f.n ? lines : '<span class="muted">(nothing yet)</span>';
    ctx.stage.append('<div class="loopgrid"><div><div class="lbl">' + esc(f.left[0]) + '</div><pre>' + esc(f.left[1]) + '</pre></div>' +
      '<div><div class="lbl">' + (f.s < 2 ? 'recorded steps' : 'generated/test_add_two_mugs_to_cart.py') + '</div><pre>' + right + '</pre></div></div>');
  }, { speed: 1500 });
});

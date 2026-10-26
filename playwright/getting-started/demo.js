$(function () {
  'use strict';
  PW.pageChrome('getting-started');

  // ---------------------------------------------------------------- what install does
  var D = {
    nodes: [['you', 'Terminal', 'client', 0, 1, 'your shell'], ['pypi', 'PyPI', 'ext', 1.3, 0, 'pypi.org'], ['venv', '.venv', 'svc', 1.3, 2, 'playwright + driver'],
      ['cli', 'playwright install', 'gw', 2.6, 1, 'CLI inside the venv'], ['cdn', 'Playwright CDN', 'ext', 3.9, 0, 'browser downloads'], ['cache', 'ms-playwright', 'blob', 3.9, 2, 'per-user browser cache'],
      ['run', 'Your script', 'client', 5.2, 1, 'chromium.launch()']],
    edges: [['you', 'pypi'], ['pypi', 'venv'], ['you', 'cli'], ['cli', 'cdn'], ['cdn', 'cache'], ['run', 'venv', '', 'none'], ['run', 'cache']]
  };
  PW.flows('#install-demo', D, [
    { name: 'pip install', desc: 'Step 1 installs the Python package. It contains the client library and the driver, but no browsers.', steps: [
      ['you', 'pypi', 'pip install pytest-playwright', 'pip resolves pytest-playwright and its dependencies: playwright, pytest, greenlet, pyee.'],
      ['pypi', 'venv', 'wheels', 'The playwright wheel for your OS includes the Python API and a bundled Node.js driver. Everything lands in .venv, isolated from other projects.', 'resp']] },
    { name: 'playwright install', desc: 'Step 2 downloads the browser builds that this exact Playwright version was tested with.', steps: [
      ['you', 'cli', 'playwright install chromium', 'The playwright command comes from the virtual environment, so it knows which version you have.'],
      ['cli', 'cdn', 'download (HTTPS_PROXY)', 'Browsers are downloaded over HTTPS. Behind a corporate proxy, set HTTPS_PROXY (and NODE_EXTRA_CA_CERTS if TLS is inspected).'],
      ['cdn', 'cache', 'unzip', 'Builds are unpacked into the per-user cache, for example chromium-1248 and chromium_headless_shell-1248. Several Playwright versions can share the cache.', 'resp']] },
    { name: 'launch()', desc: 'At run time your code starts the driver, which starts the browser from the cache.', steps: [
      ['run', 'venv', 'sync_playwright()', 'Entering sync_playwright() starts the driver process from the package.'],
      ['run', 'cache', 'chromium.launch()', 'launch() looks up the browser build for this version in ms-playwright and starts it (headless uses the Chrome Headless Shell build).'],
      ['cache', 'run', 'browser ready', 'The browser is connected; new_page() and goto() can run.', 'resp']] },
    { name: 'Missing browser', desc: 'The most common first error: the package was upgraded, but the browsers were not.', steps: [
      ['run', 'cache', 'chromium.launch()', 'The driver looks for the build pinned to the new version (a new folder name).'],
      ['cache', 'run', 'Executable doesn\'t exist', 'Not found: "Looks like Playwright was just installed or updated. Please run the following command to download new browsers: playwright install".', 'err'],
      ['you', 'cli', 'playwright install chromium', 'Fix: run playwright install in the same environment, as the same user (or launch with channel="chrome" to use the installed Chrome).']] }
  ]);

  // ---------------------------------------------------------------- codegen recording
  var HEAD = ['import re', 'from playwright.sync_api import Page, expect', '', '', 'def test_example(page: Page) -> None:', '    page.goto("http://127.0.0.1:8000/products")'];
  var L = {
    click: '    page.get_by_role("textbox", name="Search").click()',
    fill: '    page.get_by_role("textbox", name="Search").fill("mug")',
    search: '    page.get_by_role("button", name="Search").click()',
    count: '    expect(page.get_by_test_id("result-count")).to_contain_text("1 results")',
    link: '    page.get_by_role("link", name="Ceramic Mug").click()',
    head: '    expect(page.get_by_role("heading", name="Ceramic Mug")).to_be_visible()'
  };
  var PRODUCTS = [['Ceramic Mug', '£12.00'], ['Cast Iron Pan', '£39.50'], ['Desk Lamp', '£24.99'], ['Notebook Set', '£9.50']];
  function lines(keys) { return HEAD.concat(keys.map(function (k) { return L[k]; })); }
  var F = [
    { url: '/products', view: 'list', typed: '', tool: 'rec', code: HEAD, fresh: [5], msg: 'playwright codegen --target python-pytest http://127.0.0.1:8000/products opens a browser and the recorder. The navigation is already in the code.' },
    { url: '/products', view: 'list', typed: '', tool: 'rec', target: 'q', pick: 'get_by_role("textbox", name="Search")', code: HEAD, msg: 'Hovering an element shows the locator codegen would use. It prefers role + accessible name; the input is labelled "Search".' },
    { url: '/products', view: 'list', typed: '', tool: 'rec', target: 'q', code: lines(['click']), fresh: [6], msg: 'Clicking the search box records a click() line.' },
    { url: '/products', view: 'list', typed: 'mug', tool: 'rec', target: 'q', code: lines(['click', 'fill']), fresh: [7], msg: 'Typing "mug" is recorded as a single fill("mug"), not one line per key.' },
    { url: '/products', view: 'list', typed: 'mug', tool: 'rec', target: 'btn', pick: 'get_by_role("button", name="Search")', code: lines(['click', 'fill', 'search']), fresh: [8], msg: 'Clicking Search records the button by its role and name.' },
    { url: '/products?q=mug', view: 'results', typed: 'mug', tool: 'text', target: 'count', pick: 'get_by_test_id("result-count")', code: lines(['click', 'fill', 'search', 'count']), fresh: [9], msg: 'In "Assert text" mode, clicking "1 results" adds an expect(). The paragraph has data-testid="result-count", so codegen uses get_by_test_id.' },
    { url: '/products?q=mug', view: 'results', typed: 'mug', tool: 'rec', target: 'mug', pick: 'get_by_role("link", name="Ceramic Mug")', code: lines(['click', 'fill', 'search', 'count', 'link']), fresh: [10], msg: 'Back in record mode, clicking the product link records a click on the link.' },
    { url: '/products/1', view: 'product', typed: '', tool: 'vis', target: 'h1', pick: 'get_by_role("heading", name="Ceramic Mug")', code: lines(['click', 'fill', 'search', 'count', 'link', 'head']), fresh: [11], msg: '"Assert visibility" on the heading adds to_be_visible(). Stop recording and copy the code into tests/.' },
    { url: '/products/1', view: 'product', typed: '', tool: 'none', code: lines(['click', 'fill', 'search', 'count', 'link', 'head']), strike: [6], msg: 'Review the draft: rename test_example, change the absolute URL to "/products", and delete the redundant click() before fill() (fill focuses the field itself).' }
  ];
  function el(cls, text, id, f) {
    var $e = $('<span class="el">').addClass(cls || '').text(text);
    if (f.target === id) $e.addClass(f.tool === 'text' || f.tool === 'vis' ? 'multi' : 'act');
    return $e;
  }
  function render(f, ctx) {
    var $g = $('<div class="cg">').appendTo(ctx.stage);
    var $mb = $('<div class="mockbrowser"><div class="chrome"><i></i><i></i><i></i><span class="url"></span></div></div>').appendTo($g);
    $mb.find('.url').text('127.0.0.1:8000' + f.url);
    var tools = [['rec', 'Record'], ['pick', 'Pick locator'], ['vis', 'Assert visibility'], ['text', 'Assert text'], ['val', 'Assert value']];
    var $tb = $('<div class="cgtool">').appendTo($mb);
    tools.forEach(function (t) { $('<span>').text(t[1]).toggleClass('on', t[0] === 'rec' && f.tool === 'rec').toggleClass('sel', t[0] === f.tool && t[0] !== 'rec').appendTo($tb); });
    var $v = $('<div class="viewport">').appendTo($mb);
    if (f.view === 'product') {
      $v.append($('<h4>').append(el('', 'Ceramic Mug', 'h1', f)), '<div class="muted">£12.00 · A 350 ml stoneware mug.</div>');
      $v.append($('<div>').append(el('', 'Quantity 1', 'qty', f), el('', 'Add to cart', 'add', f)));
    } else {
      $v.append('<h4>Products</h4>');
      $v.append($('<div>').append(el('inp' + (f.typed ? ' typed' : ''), f.typed || 'Search products', 'q', f), el('', 'Category: All', 'cat', f), el('', 'Search', 'btn', f)));
      var list = f.view === 'results' ? PRODUCTS.slice(0, 1) : PRODUCTS;
      $v.append($('<div>').append(el('', list.length + ' results', 'count', f)));
      var $cards = $('<div class="cards">').appendTo($v);
      list.forEach(function (p, i) { $cards.append(el('', p[0] + '  ' + p[1], i === 0 ? 'mug' : 'p' + i, f)); });
    }
    if (f.pick) $v.append($('<div>').append($('<span class="pick">').text(f.pick)));
    var $pre = $('<pre class="gen"><code></code></pre>').appendTo($g), $c = $pre.find('code');
    f.code.forEach(function (l, i) {
      var $l = $('<span>').text((l || ' ') + '\n');
      if ((f.fresh || []).indexOf(i) >= 0) $l.addClass('nl');
      if ((f.strike || []).indexOf(i) >= 0) $l.css('text-decoration', 'line-through').addClass('cm');
      $c.append($l);
    });
  }
  DSA.player('#codegen-demo', F, render, { speed: 1500 });
});

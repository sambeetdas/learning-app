$(function () {
  'use strict';
  PW.pageChrome('locators');

  // =============================================================== locator playground
  // A copy of ShopBot's /products markup (same structure, so the counts match real Playwright).
  var PRODUCTS = [[1, 'Ceramic Mug', '12.00', 'In stock'], [2, 'Cast Iron Pan', '39.50', 'In stock'], [3, 'Desk Lamp', '24.99', 'Out of stock'], [4, 'Notebook Set', '9.50', 'In stock']];
  var MOCK = '<nav aria-label="Main"><a href="/">ShopBot</a><a href="/products">Products</a><a href="/chat">Support chat</a>' +
    '<a href="/account">Account</a><a href="/cart">Cart (<span data-testid="cart-count">0</span>)</a><span class="right"><a href="/login">Log in</a></span></nav>' +
    '<main><h1>Products</h1>' +
    '<form role="search" action="/products"><label>Search <input name="q" value="" placeholder="Search products"></label>\n' +
    '<label>Category <select name="category"><option value="">All</option><option value="kitchen">Kitchen</option><option value="office">Office</option></select></label>\n' +
    '<button type="submit">Search</button></form><p data-testid="result-count">4 results</p><div class="grid">' +
    PRODUCTS.map(function (p) {
      return '<article class="card" data-testid="product-card"><h2><a href="/products/' + p[0] + '">' + p[1] + '</a></h2><p class="price">&pound;' + p[2] + '</p><p>' + p[3] + '</p></article>';
    }).join('') + '</div></main>';

  var $view = $('#pg .pgview').html(MOCK), ROOT = $view[0];
  $view.on('click', 'a, button', function (e) { e.preventDefault(); });
  $view.on('submit', 'form', function (e) { e.preventDefault(); });

  // ---------- accessibility model (a small subset of the real rules)
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function textOf(e) { return norm(e.textContent); }
  function roleOf(e) {
    var r = e.getAttribute('role'); if (r) return r;
    var t = e.tagName.toLowerCase();
    if (t === 'a') return e.hasAttribute('href') ? 'link' : null;
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'input') { var ty = (e.getAttribute('type') || 'text').toLowerCase(); return ty === 'number' ? 'spinbutton' : ty === 'checkbox' ? 'checkbox' : ty === 'search' ? 'searchbox' : /^(submit|button|reset)$/.test(ty) ? 'button' : 'textbox'; }
    return { button: 'button', select: 'combobox', option: 'option', nav: 'navigation', main: 'main', article: 'article', p: 'paragraph', ul: 'list', ol: 'list', li: 'listitem', textarea: 'textbox', img: 'img' }[t] || null;
  }
  function labelFor(e) { var l = e.closest('label'); return l && l !== e ? l : null; }
  function textExcluding(container, skip) {
    var out = '';
    (function walk(n) { if (n === skip) return; if (n.nodeType === 3) out += n.nodeValue; else for (var c = n.firstChild; c; c = c.nextSibling) walk(c); })(container);
    return norm(out);
  }
  function nameOf(e) {
    if (e.getAttribute('aria-label')) return norm(e.getAttribute('aria-label'));
    var r = roleOf(e);
    if (r === 'textbox' || r === 'combobox' || r === 'spinbutton' || r === 'checkbox' || r === 'searchbox') { var l = labelFor(e); return l ? textExcluding(l, e) : norm(e.getAttribute('placeholder')); }
    if (r === 'link' || r === 'button' || r === 'heading' || r === 'option') return textOf(e);
    return '';
  }
  function all(root) { return Array.prototype.slice.call(root.querySelectorAll('*')); }
  function sortDoc(list) { return list.sort(function (a, b) { return a === b ? 0 : (a.compareDocumentPosition(b) & 4 ? -1 : 1); }); }
  function uniq(list) { var out = []; list.forEach(function (e) { if (out.indexOf(e) < 0) out.push(e); }); return sortDoc(out); }

  // text matching: string -> substring, case-insensitive; exact -> equal, case-sensitive; RegExp -> test
  function textMatch(value, s, exact) {
    if (s instanceof RegExp) return s.test(value);
    return exact ? value === norm(s) : value.toLowerCase().indexOf(norm(s).toLowerCase()) >= 0;
  }

  // ---------- query engines (each searches the descendants of root)
  var ENGINES = {
    get_by_role: function (root, a, k) {
      var role = a[0];
      if (typeof role !== 'string') throw new Error('get_by_role() needs a role string, e.g. get_by_role("button", name="Search")');
      return all(root).filter(function (e) {
        if (roleOf(e) !== role) return false;
        if (k.name !== undefined && !textMatch(nameOf(e), k.name, k.exact === true)) return false;
        if (k.level !== undefined && !(e.tagName.toLowerCase() === 'h' + k.level)) return false;
        if (k.selected !== undefined && !!(e.tagName === 'OPTION' && e.selected) !== k.selected) return false;
        if (k.disabled !== undefined && !!e.disabled !== k.disabled) return false;
        if (k.checked !== undefined && !!e.checked !== k.checked) return false;
        return true;
      });
    },
    get_by_text: function (root, a, k) {
      var s = need(a, 'get_by_text');
      var hits = all(root).filter(function (e) { return !/^(SCRIPT|STYLE)$/.test(e.tagName) && textMatch(textOf(e), s, k.exact === true); });
      // keep the smallest elements: drop any element that has a matching descendant
      return hits.filter(function (e) { return !hits.some(function (o) { return o !== e && e.contains(o); }); });
    },
    get_by_label: function (root, a, k) {
      var s = need(a, 'get_by_label'), out = [];
      all(root).forEach(function (e) {
        if (e.tagName === 'LABEL' && textMatch(textOf(e), s, k.exact === true)) { var c = e.control || e.querySelector('input, select, textarea'); if (c) out.push(c); }
        if (e.getAttribute('aria-label') && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.tagName) && textMatch(norm(e.getAttribute('aria-label')), s, k.exact === true)) out.push(e);
      });
      return out.filter(function (e) { return root.contains(e); });
    },
    get_by_placeholder: function (root, a, k) { var s = need(a, 'get_by_placeholder'); return all(root).filter(function (e) { return e.hasAttribute('placeholder') && textMatch(norm(e.getAttribute('placeholder')), s, k.exact === true); }); },
    get_by_test_id: function (root, a) { var s = need(a, 'get_by_test_id'); return all(root).filter(function (e) { return s instanceof RegExp ? s.test(e.getAttribute('data-testid') || '') : e.getAttribute('data-testid') === s; }); },
    get_by_alt_text: function (root, a, k) { var s = need(a, 'get_by_alt_text'); return all(root).filter(function (e) { return e.hasAttribute('alt') && textMatch(norm(e.getAttribute('alt')), s, k.exact === true); }); },
    get_by_title: function (root, a, k) { var s = need(a, 'get_by_title'); return all(root).filter(function (e) { return e.hasAttribute('title') && textMatch(norm(e.getAttribute('title')), s, k.exact === true); }); },
    locator: function (root, a, k) {
      var sel = need(a, 'locator'), res;
      if (typeof sel !== 'string') throw new Error('locator() needs a selector string');
      if (/^xpath=|^\/\/|^\.\.?\//.test(sel)) {
        var xp = sel.replace(/^xpath=/, ''), snap = document.evaluate(xp.charAt(0) === '/' && root === ROOT ? '.' + xp : xp, root, null, 7, null); res = [];
        for (var i = 0; i < snap.snapshotLength; i++) if (snap.snapshotItem(i).nodeType === 1 && ROOT.contains(snap.snapshotItem(i)) && snap.snapshotItem(i) !== ROOT) res.push(snap.snapshotItem(i));
      } else if (/^(text|internal|id|role|data-testid)=|>>/.test(sel)) {
        throw new Error('The playground only supports plain CSS and XPath in locator(). Use the get_by_* methods instead.');
      } else {
        try { res = Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { throw new Error('Invalid CSS selector: ' + sel); }
      }
      return applyFilter(res, k);
    }
  };
  function need(a, m) { if (a[0] === undefined) throw new Error(m + '() needs an argument'); return a[0]; }
  function applyFilter(list, k) {
    if (k.has_text !== undefined) list = list.filter(function (e) { return textMatch(textOf(e), k.has_text, false); });
    if (k.has_not_text !== undefined) list = list.filter(function (e) { return !textMatch(textOf(e), k.has_not_text, false); });
    if (k.has) list = list.filter(function (e) { return evaluate(k.has, e).length > 0; });
    if (k.has_not) list = list.filter(function (e) { return evaluate(k.has_not, e).length === 0; });
    if (k.visible !== undefined) list = list.filter(function (e) { return (e.getClientRects().length > 0) === k.visible; });
    return list;
  }

  // ---------- a tiny parser for Python-style locator chains
  function tokenize(s) {
    var t = [], i = 0, m;
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if ((m = /^[rRbBuU]?("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/.exec(s.slice(i)))) {
        var raw = /^[rR]/.test(m[0]), body = m[1].slice(1, -1);
        t.push({ t: 'str', v: raw ? body : body.replace(/\\(.)/g, function (x, ch) { return { n: '\n', t: '\t', '\\': '\\', '"': '"', '\'': '\'' }[ch] || '\\' + ch; }) }); i += m[0].length; continue;
      }
      if ((m = /^-?\d+/.exec(s.slice(i)))) { t.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_]\w*/.exec(s.slice(i)))) { t.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ('.(),='.indexOf(c) >= 0) { t.push({ t: c }); i++; continue; }
      throw new Error('Unexpected character "' + c + '"');
    }
    return t;
  }
  function parse(src) {
    var T = tokenize(src), p = 0;
    function peek(k) { return T[p] && (T[p].t === k || T[p].v === k); }
    function eat(k) { if (!peek(k)) throw new Error('Expected ' + k + (T[p] ? ' but found ' + (T[p].v !== undefined ? T[p].v : T[p].t) : ' but the input ended')); return T[p++]; }
    function chain() {
      if (peek('page') && T[p + 1] && T[p + 1].t === '.') p += 2;
      var steps = [];
      for (;;) {
        var id = eat('id').v;
        if (id === 'first' || id === 'last') steps.push({ m: id, a: [], k: {} });
        else { eat('('); var args = argList(); eat(')'); steps.push({ m: id, a: args.a, k: args.k }); }
        if (peek('.')) { p++; continue; }
        return steps;
      }
    }
    function argList() {
      var a = [], k = {};
      while (!peek(')')) {
        if (T[p] && T[p].t === 'id' && T[p + 1] && T[p + 1].t === '=') { var key = T[p].v; p += 2; k[key] = value(); }
        else a.push(value());
        if (peek(',')) p++; else break;
      }
      return { a: a, k: k };
    }
    function value() {
      var tk = T[p];
      if (!tk) throw new Error('Missing value');
      if (tk.t === 'str' || tk.t === 'num') { p++; return tk.v; }
      if (tk.v === 'True' || tk.v === 'False') { p++; return tk.v === 'True'; }
      if (tk.v === 're') {
        p++; eat('.'); if (eat('id').v !== 'compile') throw new Error('Only re.compile(...) is supported');
        eat('('); var pat = eat('str').v, flags = '';
        if (peek(',')) { p++; eat('re'); eat('.'); var f = eat('id').v; if (f === 'I' || f === 'IGNORECASE') flags = 'i'; }
        eat(')');
        try { return new RegExp(pat.replace(/\(\?P</g, '(?<'), flags); } catch (e) { throw new Error('Invalid regular expression'); }
      }
      if (tk.v === 'page') return { chain: chain() };
      throw new Error('Unsupported value "' + (tk.v !== undefined ? tk.v : tk.t) + '"');
    }
    var steps = chain();
    if (p < T.length) throw new Error('Unexpected "' + (T[p].v !== undefined ? T[p].v : T[p].t) + '" after the locator');
    return steps;
  }
  function unwrap(k) { var o = {}; Object.keys(k).forEach(function (key) { o[key] = k[key] && k[key].chain ? k[key].chain : k[key]; }); return o; }
  // evaluate a parsed chain; scope = element the chain is relative to (ROOT for page.)
  function evaluate(steps, scope) {
    var cur = null;
    steps.forEach(function (s) {
      var k = unwrap(s.k);
      if (ENGINES[s.m]) {
        var roots = cur === null ? [scope] : cur, res = [];
        roots.forEach(function (r) { res = res.concat(ENGINES[s.m](r, s.a, k)); });
        cur = uniq(res);
      } else if (s.m === 'filter') {
        if (cur === null) throw new Error('filter() must follow a locator');
        cur = applyFilter(cur, k);
      } else if (s.m === 'first' || s.m === 'last' || s.m === 'nth') {
        if (cur === null) throw new Error(s.m + ' must follow a locator');
        var n = s.m === 'first' ? 0 : s.m === 'last' ? -1 : s.a[0];
        if (typeof n !== 'number') throw new Error('nth() needs an index');
        var it = cur[n < 0 ? cur.length + n : n]; cur = it ? [it] : [];
      } else if (s.m === 'and_' || s.m === 'or_') {
        if (cur === null) throw new Error(s.m + '() must follow a locator');
        var other = s.a[0] && s.a[0].chain ? evaluate(s.a[0].chain, ROOT) : null;
        if (!other) throw new Error(s.m + '() needs another locator, e.g. ' + s.m + '(page.get_by_text("Search"))');
        cur = s.m === 'and_' ? cur.filter(function (e) { return other.indexOf(e) >= 0; }) : uniq(cur.concat(other));
      } else {
        throw new Error('"' + s.m + '" is not supported here. Try get_by_role, get_by_text, get_by_label, get_by_placeholder, get_by_test_id, locator, filter, nth, first, last, and_, or_.');
      }
    });
    return cur || [];
  }

  // ---------- describing matches like Playwright's error messages
  function outer(e) {
    var attrs = Array.prototype.filter.call(e.attributes, function (a) { return !(a.name === 'class' && !a.value); })
      .map(function (a) { return ' ' + a.name + (a.value === '' ? '' : '="' + a.value + '"'); }).join('');
    var t = e.tagName.toLowerCase(), inner = e.children.length ? '…' : textOf(e);
    return /^(input|img)$/.test(t) ? '<' + t + attrs + '>' : '<' + t + attrs + '>' + inner + '</' + t + '>';
  }
  function esc(s) { return $('<i>').text(s).html(); }
  // a trailing action such as .click() or .fill("x") is accepted and described, not executed
  var ACTIONS = ['click', 'dblclick', 'fill', 'press', 'press_sequentially', 'check', 'uncheck', 'hover', 'select_option', 'inner_text', 'text_content', 'focus', 'clear', 'set_input_files'];
  function run(src) {
    src = $.trim(src).replace(/^page\./, '');
    $view.find('.hit, .multi').removeClass('hit multi');
    var $o = $('#pg-out'), res, steps, action = null;
    if (!src) { $o.attr('data-count', '').text('Type a locator, for example get_by_role("button", name="Search")'); return; }
    try {
      steps = parse(src);
      if (steps.length > 1 && ACTIONS.indexOf(steps[steps.length - 1].m) >= 0) { action = steps.pop().m; src = src.slice(0, src.lastIndexOf('.' + action)); }
      res = evaluate(steps, ROOT);
    } catch (e) { $o.attr('data-count', 'error').html('<span class="v-none">Cannot read this locator:</span> ' + esc(e.message)); return; }
    var desc = res.map(outer), act = action ? action + '()' : 'An action';
    $o.attr('data-count', res.length);
    if (res.length === 1) {
      $(res[0]).addClass('hit');
      $o.html('<span class="v-hit">1 element</span>: ' + esc(desc[0]) + '\nUnique: ' + (action ? act + ' would run on this element' : 'click(), fill(), inner_text() and expect() would act on this element') + ' (after the actionability checks).');
    } else if (res.length > 1) {
      $(res).addClass('multi');
      $o.html('<span class="v-multi">' + res.length + ' elements</span>. ' + act + ' would fail:\nError: strict mode violation: ' + esc(src) + ' resolved to ' + res.length + ' elements:\n' +
        desc.slice(0, 6).map(function (d, i) { return '    ' + (i + 1) + ') ' + esc(d); }).join('\n') + (res.length > 6 ? '\n    ...' : '') +
        '\nFine for count(), all(), all_inner_texts() and expect(...).to_have_count(' + res.length + '). To act, narrow it down: a name, filter(), or chaining inside a container.');
    } else {
      $o.html('<span class="v-none">0 elements</span>. Nothing matches (yet). ' + act + ' would wait for the element to appear, re-checking until the timeout, then fail:\nTimeoutError: Locator.' + (action || 'click') + ': Timeout 30000ms exceeded.\nCall log:\n  - waiting for ' + esc(src));
    }
  }
  var PRESETS = [
    ['By role', ['get_by_role("button", name="Search")', 'get_by_role("link", name="Ceramic Mug")', 'get_by_role("link")', 'get_by_role("heading", level=2)', 'get_by_role("link", name="Cart")', 'get_by_role("link", name="Cart", exact=True)', 'get_by_role("combobox", name="Category")', 'get_by_role("button", name="Add to cart")']],
    ['Text, label, placeholder, test id', ['get_by_text("In stock")', 'get_by_text("Search")', 'get_by_text("products")', 'get_by_label("Search")', 'get_by_placeholder("Search products")', 'get_by_test_id("product-card")', 'get_by_test_id("result-count")']],
    ['Filter and chain', ['get_by_test_id("product-card").filter(has_text="Lamp")', 'get_by_test_id("product-card").filter(has_not_text="In stock")', 'get_by_test_id("product-card").filter(has=page.get_by_role("heading", name="Desk Lamp"))', 'get_by_role("article").filter(has_text="Pan").locator(".price")', 'get_by_test_id("product-card").get_by_role("link")', 'get_by_role("navigation", name="Main").get_by_role("link")']],
    ['Position, and_, or_', ['get_by_test_id("product-card").nth(1)', 'get_by_test_id("product-card").last', 'get_by_role("button").and_(page.get_by_text("Search"))', 'get_by_role("link", name="Log in").or_(page.get_by_test_id("user-name"))']],
    ['CSS, XPath, regex', ['locator(".price")', 'locator("article h2 a")', 'locator("#add-to-cart")', 'locator("xpath=//article//a")', 'get_by_role("link", name=re.compile("^c", re.I))']]
  ];
  var $pre = $('#pg .presets');
  PRESETS.forEach(function (g) {
    var $g = $('<div class="grp">');
    g[1].forEach(function (s) { $('<button type="button">').text(s).attr('data-loc', s).appendTo($g); });
    $pre.append($('<b>').text(g[0]), $g);
  });
  $pre.on('click', 'button', function () { $pre.find('button').removeClass('active'); $(this).addClass('active'); $('#pg-in').val($(this).attr('data-loc')); run($(this).attr('data-loc')); });
  $('#pg-go').on('click', function () { $pre.find('button').removeClass('active'); run($('#pg-in').val()); });
  $('#pg-in').on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#pg-go').click(); } });
  $('#pg-in').val(PRESETS[0][1][0]); run(PRESETS[0][1][0]); $pre.find('button').first().addClass('active');

  // =============================================================== chaining animation
  var CODE = [
    'cards = page.get_by_test_id("product-card")',
    'in_stock = cards.filter(has_text="In stock")',
    'kitchen = in_stock.filter(has=page.get_by_role("link", name=re.compile("mug|pan", re.I)))',
    'pan = kitchen.filter(has_not=page.get_by_text("£12.00"))',
    'link = pan.get_by_role("link")',
    'link.click()'
  ];
  // per card: [shown?, highlighted-part]
  var CF = [
    { line: 0, keep: [1, 1, 1, 1], msg: 'Start from the repeated item: get_by_test_id("product-card") matches all 4 cards. Clicking it now would be a strict mode violation.' },
    { line: 1, keep: [1, 1, 0, 1], msg: 'filter(has_text="In stock") keeps cards whose text contains "In stock": 3 left. The Desk Lamp says "Out of stock", which does not contain "In stock".' },
    { line: 2, keep: [1, 1, 0, 0], msg: 'filter(has=...) keeps cards that contain a matching link. The inner locator is searched inside each card. 2 left.' },
    { line: 3, keep: [0, 1, 0, 0], msg: 'filter(has_not=...) drops cards containing the text "£12.00". Exactly one card left: the Cast Iron Pan.' },
    { line: 4, keep: [0, 1, 0, 0], part: 'link', msg: 'Chaining: get_by_role("link") is searched inside the remaining card only, so it resolves to one link.' },
    { line: 5, keep: [0, 1, 0, 0], part: 'link', act: true, msg: 'click() resolves the whole chain again at this moment, waits for the link to be actionable, and clicks it. Nothing was looked up before this line.' }
  ];
  function crender(f, ctx) {
    var n = f.keep.reduce(function (s, x) { return s + x; }, 0);
    var $mb = $('<div class="mockbrowser"><div class="chrome"><i></i><i></i><i></i><span class="url">127.0.0.1:8000/products</span></div><div class="viewport"></div></div>');
    var $v = $mb.find('.viewport');
    PRODUCTS.forEach(function (p, i) {
      var $c = $('<div class="card">').append($('<div class="ln">').text(p[1]), $('<div>').text('£' + p[2]), $('<div>').text(p[3]));
      if (!f.keep[i]) $c.addClass('out');
      else if (!f.part) $c.addClass(n === 1 ? 'hit' : 'multi');
      else $c.find('.ln').addClass(f.act ? 'act' : 'hit');
      $v.append($c);
    });
    ctx.stage.append($('<span class="count-badge">').addClass(n === 1 ? 'one' : 'many').text(n + (n === 1 ? ' match' : ' matches') + (f.part ? ' (link)' : '')), $mb);
  }
  DSA.player('#chain-demo', CF, crender, { speed: 1500, code: CODE });
});

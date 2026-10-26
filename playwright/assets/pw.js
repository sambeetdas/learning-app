// Playwright topic toolkit: page index and navigation, animated architecture diagrams (shared engine with the
// system design topic), copy buttons and code tabs. Depends on jQuery and core.js (DSA.player).
var PW = (function ($) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var PAGES = [
    ['introduction', 'What Playwright is and how it works', 'Beginner'],
    ['getting-started', 'Install, first script and codegen', 'Beginner'],
    ['locators', 'Locators: finding elements', 'Beginner'],
    ['actions-assertions', 'Actions, auto-waiting and assertions', 'Beginner'],
    ['pytest', 'Testing with pytest: fixtures, isolation and page objects', 'Intermediate'],
    ['network-api', 'Network mocking, API testing and authentication', 'Intermediate'],
    ['debugging-ci', 'Debugging, tracing, reporting and CI', 'Advanced'],
    ['advanced', 'Advanced browser features', 'Advanced'],
    ['automation', 'Beyond testing: scraping, automation and monitoring', 'Advanced'],
    ['ai-agents', 'Playwright for AI agents: MCP, CLI and tool calling', 'AI'],
    ['ai-testing', 'Testing AI and agentic applications', 'AI'],
    ['project-chatbot-tests', 'Project: test suite for an AI support chatbot', 'Project'],
    ['project-test-generator', 'Project: AI test generator with self-healing', 'Project'],
    ['project-explorer-agent', 'Project: autonomous exploratory-testing agent', 'Project'],
    ['project-agent-eval', 'Project: evaluation harness for a web agent', 'Project']
  ];
  function el(name, attrs, parent) { var e = document.createElementNS(NS, name); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  function tx(parent, x, y, s, cls, anchor) { var t = el('text', { x: x, y: y, 'class': cls || '', 'text-anchor': anchor || 'middle', 'dominant-baseline': 'central' }, parent); t.textContent = dec(s); return t; }
  function esc(s) { return $('<i>').text(s).html(); }
  // text-only fields (captions, SVG labels) may contain HTML entities such as &rarr;: decode them for display
  function dec(s) { if (s == null || String(s).indexOf('&') < 0) return s; var t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- architecture diagram
  var KIND = { client: 'client', user: 'client', mobile: 'client', device: 'client', dns: 'edge', cdn: 'edge', waf: 'edge', edge: 'edge', lb: 'gw', gw: 'gw', apigw: 'gw',
    svc: 'svc', worker: 'svc', fn: 'svc', job: 'svc', db: 'data', nosql: 'data', cache: 'data', blob: 'data', search: 'data', vector: 'data', tsdb: 'data', graph: 'data', dw: 'data',
    queue: 'msg', stream: 'msg', bus: 'msg', llm: 'ai', ml: 'ai', ai: 'ai', gpu: 'ai', agent: 'ai', ext: 'ext' };
  var SUB = { client: 'client', user: 'user', mobile: 'mobile app', device: 'device', dns: 'DNS', cdn: 'CDN', waf: 'WAF', edge: 'edge', lb: 'load balancer', gw: 'gateway', apigw: 'API gateway',
    svc: 'service', worker: 'worker', fn: 'function', job: 'batch job', db: 'SQL database', nosql: 'NoSQL', cache: 'cache', blob: 'object storage', search: 'search index', vector: 'vector index',
    tsdb: 'time series', graph: 'graph DB', dw: 'warehouse', queue: 'queue', stream: 'event stream', bus: 'event bus', llm: 'LLM', ml: 'model', ai: 'AI', gpu: 'GPU pool', agent: 'agent', ext: 'external' };
  var CW = 168, RH = 96, BW = 134, BH = 54, PAD = 26;
  function geom(D) {
    var pos = {}, mc = 0, mr = 0;
    D.nodes.forEach(function (n) { var x = PAD + n[3] * CW, y = PAD + n[4] * RH; pos[n[0]] = { x: x, y: y, cx: x + BW / 2, cy: y + BH / 2, n: n }; mc = Math.max(mc, n[3]); mr = Math.max(mr, n[4]); });
    return { pos: pos, w: PAD * 2 + mc * CW + BW, h: PAD * 2 + mr * RH + BH + 8 };
  }
  function clip(p, q, pad) {                                // point on p's box border towards q
    var dx = q.cx - p.cx, dy = q.cy - p.cy; if (!dx && !dy) return [p.cx, p.cy];
    var sx = dx ? (BW / 2 + pad) / Math.abs(dx) : Infinity, sy = dy ? (BH / 2 + pad) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
    return [p.cx + dx * s, p.cy + dy * s];
  }
  function drawNode(g, p, mark) {
    var n = p.n, k = KIND[n[2]] || 'svc', cls = 'box k-' + k + (mark ? ' on-' + mark : ''), x = p.x, y = p.y;
    if (k === 'data' && n[2] !== 'cache' && n[2] !== 'search') {
      el('path', { d: 'M' + x + ',' + (y + 8) + ' a' + BW / 2 + ',8 0 0,1 ' + BW + ',0 v' + (BH - 14) + ' a' + BW / 2 + ',8 0 0,1 ' + (-BW) + ',0 z', 'class': cls }, g);
      el('path', { d: 'M' + x + ',' + (y + 8) + ' a' + BW / 2 + ',8 0 0,0 ' + BW + ',0', 'class': cls, fill: 'none' }, g);
    } else {
      el('rect', { x: x, y: y, width: BW, height: BH, rx: k === 'client' ? 14 : 8, 'class': cls }, g);
      if (k === 'msg') for (var i = 0; i < 3; i++) el('line', { x1: x + BW - 26 + i * 8, y1: y + 10, x2: x + BW - 26 + i * 8, y2: y + BH - 10, 'class': 'box k-msg', 'stroke-width': 1.5 }, g);
    }
    var label = n[1], sub = n[5] || SUB[n[2]] || n[2];
    tx(g, p.cx - (k === 'msg' ? 10 : 0), p.cy - 7, label.length > 19 ? label.slice(0, 18) + '…' : label, 'nt');
    tx(g, p.cx - (k === 'msg' ? 10 : 0), p.cy + 11, sub.length > 24 ? sub.slice(0, 23) + '…' : sub, 'ns');
  }
  function arrowHead(g, x2, y2, ux, uy, cls) {
    el('polygon', { points: x2 + ',' + y2 + ' ' + (x2 - ux * 9 - uy * 4.5) + ',' + (y2 - uy * 9 + ux * 4.5) + ' ' + (x2 - ux * 9 + uy * 4.5) + ',' + (y2 - uy * 9 - ux * 4.5), 'class': cls }, g);
  }
  function diagram($stage, D, st) {
    st = st || {};
    var G = geom(D), svg = el('svg', { 'class': 'arch', viewBox: '0 0 ' + G.w + ' ' + G.h, width: G.w, height: G.h, role: 'img', 'aria-label': D.title || 'architecture diagram' });
    var gz = el('g', {}, svg), ge = el('g', {}, svg), gh = el('g', {}, svg), gn = el('g', {}, svg), gp = el('g', {}, svg);
    (D.zones || []).forEach(function (z) {
      var x1 = PAD + z[1] * CW - 12, y1 = PAD + z[2] * RH - 18, x2 = PAD + z[3] * CW + BW + 12, y2 = PAD + z[4] * RH + BH + 10;
      el('rect', { x: x1, y: y1, width: x2 - x1, height: y2 - y1, rx: 10, 'class': 'zone' }, gz); tx(gz, x1 + 8, y1 + 9, z[0], 'zt', 'start');
    });
    (D.edges || []).forEach(function (e) {
      var A = G.pos[e[0]], B = G.pos[e[1]]; if (!A || !B) return;
      var p1 = clip(A, B, 3), p2 = clip(B, A, 5), dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
      el('line', { x1: p1[0], y1: p1[1], x2: p2[0] - ux * 6, y2: p2[1] - uy * 6, 'class': 'ln' + (e[3] === 'async' ? ' async' : '') }, ge);
      if (e[3] !== 'none') arrowHead(ge, p2[0], p2[1], ux, uy, 'ah');
      if (e[2]) tx(ge, (p1[0] + p2[0]) / 2 - uy * 9, (p1[1] + p2[1]) / 2 + ux * 9, e[2], 'el');
    });
    (st.hops || []).forEach(function (h) {
      var A = G.pos[h.a], B = G.pos[h.b]; if (!A || !B) return;
      var p1 = clip(A, B, 3), p2 = clip(B, A, 5), dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, k = h.done ? 'done' : (h.k || 'req');
      el('line', { x1: p1[0], y1: p1[1], x2: p2[0] - ux * 6, y2: p2[1] - uy * 6, 'class': 'hop ' + k }, gh);
      arrowHead(gh, p2[0], p2[1], ux, uy, 'ah pk ' + (h.done ? '' : k));
      if (h.done) return;
      var dot = el('circle', { r: 6.5, 'class': 'pk ' + k, cx: 0, cy: 0 }, gp);
      if (reduceMotion) { dot.setAttribute('cx', p1[0] + dx * 0.6); dot.setAttribute('cy', p1[1] + dy * 0.6); }
      else el('animateMotion', { dur: '1.15s', repeatCount: 'indefinite', path: 'M' + p1[0] + ',' + p1[1] + ' L' + p2[0] + ',' + p2[1] }, dot);
      if (h.label) {
        var mx = (p1[0] + p2[0]) / 2 - uy * 14, my = (p1[1] + p2[1]) / 2 + ux * 14 - (Math.abs(uy) < 0.3 ? 4 : 0), w = Math.min(190, h.label.length * 6.1 + 14);
        el('rect', { x: mx - w / 2, y: my - 9, width: w, height: 18, rx: 9, 'class': 'pill ' + k }, gp);
        tx(gp, mx, my, h.label.length > 30 ? h.label.slice(0, 29) + '…' : h.label, 'pt');
      }
    });
    D.nodes.forEach(function (n) { drawNode(gn, G.pos[n[0]], (st.marks || {})[n[0]]); });
    $stage.append(svg);
    return svg;
  }
  // items: optional [[colourKey, label]...] using the keys client, edge, gw, svc, data, msg, ai, ext
  function legend(items) {
    return '<div class="klegend">' + (items || [['client', 'your code / users'], ['svc', 'services and Playwright'], ['gw', 'drivers and gateways'], ['data', 'data and files'], ['msg', 'queues and streams'], ['ai', 'AI / LLM'], ['ext', 'browsers and external systems']])
      .map(function (k) { return '<span><i style="border-color:var(--c-' + k[0] + ')"></i>' + k[1] + '</span>'; }).join('') +
      '<span><b style="color:var(--accent)">&#9679;</b> request</span><span><b style="color:var(--good)">&#9679;</b> response</span><span><b style="color:var(--purple)">&#9679;</b> async / event</span><span><b style="color:var(--bad)">&#9679;</b> failure</span></div>';
  }

  // flows: [{name, desc, steps: [[from, to, label, msg, kind] | {par: [[from, to, label, kind]...], msg}], end}]
  function flowFrames(f) {
    var F = [], done = [];
    F.push({ hops: [], marks: {}, msg: dec(f.desc || f.name) });
    f.steps.forEach(function (s, i) {
      var cur = s.par ? s.par.map(function (p) { return { a: p[0], b: p[1], label: p[2], k: p[3] || 'req' }; }) : [{ a: s[0], b: s[1], label: s[2], k: s[4] || 'req' }];
      var marks = {};
      cur.forEach(function (h) { marks[h.a] = h.k === 'err' ? 'c' : 'a'; marks[h.b] = h.k === 'err' ? 'c' : 'b'; });
      F.push({ hops: done.concat(cur), marks: marks, msg: (i + 1) + '. ' + dec(s.par ? s.msg : s[3]) });
      done = done.concat(cur.map(function (h) { return { a: h.a, b: h.b, done: true }; }));
    });
    F.push({ hops: done, marks: {}, msg: dec(f.end) || 'End of this flow. Pick another flow above, or press Reset to replay.' });
    return F;
  }
  function flows(root, D, list) {
    var $r = $(root), $tabs = $r.find('.flowtabs'), $desc = $r.find('.flowdesc'), cur = 0;
    function render(f, ctx) { diagram(ctx.stage, D, f); }
    var p = DSA.player(root, flowFrames(list[0]), render, { speed: 1500 });
    $r.find('.pctl select').val('1500');
    list.forEach(function (f, i) {
      $('<button type="button">').text(f.name).toggleClass('active', i === 0).on('click', function () {
        cur = i; $tabs.children().removeClass('active'); $(this).addClass('active'); $desc.text(dec(f.desc) || ''); p.set(flowFrames(f));
      }).appendTo($tabs);
    });
    $desc.text(dec(list[0].desc) || '');
    return p;
  }

  // several diagrams, each with its own flow: items = [{name, desc, diagram, steps, end}]
  function multi(root, items) {
    var $r = $(root), $tabs = $r.find('.flowtabs'), $desc = $r.find('.flowdesc'), D = items[0].diagram;
    function render(f, ctx) { diagram(ctx.stage, D, f); }
    var p = DSA.player(root, flowFrames(items[0]), render, { speed: 1500 });
    $r.find('.pctl select').val('1500');
    items.forEach(function (it, i) {
      $('<button type="button">').text(it.name).toggleClass('active', i === 0).on('click', function () {
        $tabs.children().removeClass('active'); $(this).addClass('active'); $desc.text(dec(it.desc) || ''); D = it.diagram; p.set(flowFrames(it));
      }).appendTo($tabs);
    });
    $desc.text(dec(items[0].desc) || '');
    return p;
  }

  // ---------------------------------------------------------------- page chrome
  function navFor(slug) {
    var i = PAGES.map(function (x) { return x[0]; }).indexOf(slug), prev = PAGES[i - 1], next = PAGES[i + 1];
    return { prev: prev ? ['../' + prev[0] + '/index.html', prev[1]] : ['../index.html', 'Playwright home'], next: next ? ['../' + next[0] + '/index.html', next[1]] : ['../index.html', 'Playwright home'] };
  }
  function pageChrome(slug) {
    var nav = navFor(slug), meta = PAGES.filter(function (p) { return p[0] === slug; })[0];
    $('header.top nav').html('<a href="../index.html">Playwright home</a><a href="' + nav.prev[0] + '">&larr; Previous</a><a href="' + nav.next[0] + '">Next &rarr;</a>');
    $('.pager').html('<a href="' + nav.prev[0] + '">&larr; ' + nav.prev[1] + '</a><a href="' + nav.next[0] + '">' + nav.next[1] + ' &rarr;</a>');
    if (meta && !$('header.top .lvl').length) $('header.top h1').append(' <span class="lvl ' + meta[2].toLowerCase() + '">' + meta[2] + '</span>');
  }

  // ---------------------------------------------------------------- code helpers
  // Copy buttons on every code block, and tab groups: <div class="codetabs"><div class="tabpane" data-tab="Sync">...</div>...</div>
  $(function () {
    $('.codetabs').each(function () {
      var $g = $(this), $bar = $('<div class="tabbar" role="tablist">').prependTo($g);
      $g.children('.tabpane').each(function (i) {
        var $p = $(this).toggleClass('active', i === 0);
        $('<button type="button" role="tab">').text($p.data('tab')).toggleClass('active', i === 0).on('click', function () {
          $bar.children().removeClass('active'); $(this).addClass('active'); $g.children('.tabpane').removeClass('active'); $p.addClass('active');
        }).appendTo($bar);
      });
    });
    $('pre > code').each(function () {
      var code = this;
      $('<button type="button" class="copy-btn" aria-label="Copy code">Copy</button>').on('click', function () {
        var $b = $(this), text = code.innerText;
        function done() { $b.text('Copied'); setTimeout(function () { $b.text('Copy'); }, 1200); }
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () {});
        else { var t = $('<textarea>').val(text).appendTo('body').select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); }
      }).insertBefore(code);
    });
  });

  return { PAGES: PAGES, pageChrome: pageChrome, diagram: diagram, flows: flows, multi: multi, flowFrames: flowFrames, legend: legend };
})(jQuery);

// Animated diagrams for help.html. Each <figure class="anim" data-anim="NAME"> gets an SVG built
// from the timeline in DIAGRAMS below. Times (s/e = start/end) are fractions of the loop (0..1).
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var W = 640, H = 212;
  var LANE_L = 140, LANE_R = 500;     // packets travel between the two boxes
  var UP_Y = 88, DOWN_Y = 128;        // browser -> server above, server -> browser below
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ timelines
  var DIAGRAMS = {
    polling: {
      loop: 10000, still: 0.78,
      title: 'Short polling: the browser asks every 2 seconds; a new message waits for the next ask.',
      items: [
        { t: 'caption', s: 0, e: 0.2, text: '1. The browser asks "anything new?" and the server says no.' },
        { t: 'caption', s: 0.2, e: 0.42, text: '2. Wait 2 seconds and ask again. Still nothing.' },
        { t: 'caption', s: 0.42, e: 0.64, text: '3. A message is posted, but the browser is not asking right now.' },
        { t: 'caption', s: 0.64, e: 0.86, text: '4. The next poll picks it up. The message waited until then.' },
        { t: 'caption', s: 0.86, e: 1, text: '5. And it keeps asking, even when nothing happens.' },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET ?after=7', s: 0.02, e: 0.10 },
        { t: 'packet', from: 'server', kind: 'empty', label: '[ ] nothing', s: 0.11, e: 0.19 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET ?after=7', s: 0.26, e: 0.34 },
        { t: 'packet', from: 'server', kind: 'empty', label: '[ ] nothing', s: 0.35, e: 0.43 },
        { t: 'badge', at: 'server', label: 'message 8 posted - waiting', s: 0.46, e: 0.76 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET ?after=7', s: 0.66, e: 0.74 },
        { t: 'packet', from: 'server', kind: 'data', label: '[ message 8 ]', s: 0.75, e: 0.83 },
        { t: 'badge', at: 'client', label: 'shown', s: 0.83, e: 0.95 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET ?after=8', s: 0.90, e: 0.98 }
      ]
    },

    longpoll: {
      loop: 10000, still: 0.3,
      title: 'Long polling: the server holds the request open and answers the moment a message arrives.',
      items: [
        { t: 'caption', s: 0, e: 0.12, text: '1. The browser asks "anything new?"' },
        { t: 'caption', s: 0.12, e: 0.5, text: '2. Nothing yet, so the server holds the request open and waits.' },
        { t: 'caption', s: 0.5, e: 0.68, text: '3. A message is posted: the server answers immediately.' },
        { t: 'caption', s: 0.68, e: 1, text: '4. The browser asks again straight away, and the server holds it again.' },
        { t: 'tube', style: 'held', label: 'request held open (up to 25 s)', s: 0.10, e: 0.53 },
        { t: 'tube', style: 'held', label: 'request held open (up to 25 s)', s: 0.74, e: 1 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET ?after=7', s: 0.02, e: 0.10 },
        { t: 'badge', at: 'server', label: 'message 8 posted', s: 0.50, e: 0.62 },
        { t: 'packet', from: 'server', kind: 'data', label: '[ message 8 ]', s: 0.53, e: 0.61 },
        { t: 'badge', at: 'client', label: 'shown', s: 0.61, e: 0.72 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET ?after=8', s: 0.66, e: 0.74 }
      ]
    },

    sse: {
      loop: 13000, still: 0.4,
      title: 'Server-Sent Events: one open response; the server writes events into it and the browser reconnects by itself.',
      items: [
        { t: 'caption', s: 0, e: 0.09, text: '1. The browser opens one request with EventSource.' },
        { t: 'caption', s: 0.09, e: 0.42, text: '2. The server keeps the response open and writes each event as it happens.' },
        { t: 'caption', s: 0.42, e: 0.56, text: '3. Quiet for a while? A ": ping" comment keeps proxies from closing it.' },
        { t: 'caption', s: 0.56, e: 0.70, text: '4. More events, still the same single connection.' },
        { t: 'caption', s: 0.70, e: 0.79, text: '5. The connection drops, and message 4 is posted meanwhile.' },
        { t: 'caption', s: 0.79, e: 0.88, text: '6. EventSource reconnects by itself and sends Last-Event-ID: 3.' },
        { t: 'caption', s: 0.88, e: 1, text: '7. The server replays message 4. Nothing is lost.' },
        { t: 'tube', style: 'oneway', label: 'one open response  (text/event-stream)', s: 0.08, e: 0.70 },
        { t: 'tube', style: 'oneway', label: 'one open response  (text/event-stream)', s: 0.87, e: 1 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET /stream', s: 0.01, e: 0.08 },
        { t: 'badge', at: 'server', label: 'message 1 posted', s: 0.14, e: 0.24 },
        { t: 'packet', from: 'server', kind: 'data', label: 'id: 1  data: {...}', s: 0.16, e: 0.24 },
        { t: 'badge', at: 'server', label: 'message 2 posted', s: 0.28, e: 0.38 },
        { t: 'packet', from: 'server', kind: 'data', label: 'id: 2  data: {...}', s: 0.30, e: 0.38 },
        { t: 'packet', from: 'server', kind: 'ping', label: ': ping', s: 0.46, e: 0.54 },
        { t: 'badge', at: 'server', label: 'message 3 posted', s: 0.58, e: 0.68 },
        { t: 'packet', from: 'server', kind: 'data', label: 'id: 3  data: {...}', s: 0.60, e: 0.68 },
        { t: 'break', s: 0.70, e: 0.79 },
        { t: 'badge', at: 'server', label: 'message 4 posted (client offline)', s: 0.72, e: 0.90 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET /stream  Last-Event-ID: 3', s: 0.79, e: 0.87 },
        { t: 'packet', from: 'server', kind: 'data', label: 'id: 4  data: {...}', s: 0.89, e: 0.97 }
      ]
    },

    ndjson: {
      loop: 13000, still: 0.4,
      title: 'HTTP streaming: one open response with one JSON object per line; your code handles reconnecting.',
      items: [
        { t: 'caption', s: 0, e: 0.09, text: '1. The browser opens a normal request with fetch().' },
        { t: 'caption', s: 0.09, e: 0.42, text: '2. The server writes one JSON object per line; the page reads them as they arrive.' },
        { t: 'caption', s: 0.42, e: 0.56, text: '3. An empty line works as a heartbeat.' },
        { t: 'caption', s: 0.56, e: 0.70, text: '4. More lines on the same response.' },
        { t: 'caption', s: 0.70, e: 0.79, text: '5. The connection drops. There is no built-in reconnect...' },
        { t: 'caption', s: 0.79, e: 0.88, text: '6. ...so your own code retries, asking for ?after=3.' },
        { t: 'caption', s: 0.88, e: 1, text: '7. The server sends what was missed.' },
        { t: 'tube', style: 'oneway', label: 'one open response  (application/x-ndjson)', s: 0.08, e: 0.70 },
        { t: 'tube', style: 'oneway', label: 'one open response  (application/x-ndjson)', s: 0.87, e: 1 },
        { t: 'packet', from: 'client', kind: 'req', label: 'fetch GET /stream/ndjson', s: 0.01, e: 0.08 },
        { t: 'badge', at: 'server', label: 'message 1 posted', s: 0.14, e: 0.24 },
        { t: 'packet', from: 'server', kind: 'data', label: '{"id":1,...}\\n', s: 0.16, e: 0.24 },
        { t: 'badge', at: 'server', label: 'message 2 posted', s: 0.28, e: 0.38 },
        { t: 'packet', from: 'server', kind: 'data', label: '{"id":2,...}\\n', s: 0.30, e: 0.38 },
        { t: 'packet', from: 'server', kind: 'ping', label: '\\n  (empty line)', s: 0.46, e: 0.54 },
        { t: 'badge', at: 'server', label: 'message 3 posted', s: 0.58, e: 0.68 },
        { t: 'packet', from: 'server', kind: 'data', label: '{"id":3,...}\\n', s: 0.60, e: 0.68 },
        { t: 'break', s: 0.70, e: 0.79 },
        { t: 'badge', at: 'server', label: 'message 4 posted (client offline)', s: 0.72, e: 0.90 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET /stream/ndjson?after=3', s: 0.79, e: 0.87 },
        { t: 'packet', from: 'server', kind: 'data', label: '{"id":4,...}\\n', s: 0.89, e: 0.97 }
      ]
    },

    websocket: {
      loop: 12000, still: 0.52,
      title: 'WebSocket: the connection is upgraded to a two-way pipe; both sides send whenever they want.',
      items: [
        { t: 'caption', s: 0, e: 0.1, text: '1. The browser asks to upgrade the connection to a WebSocket.' },
        { t: 'caption', s: 0.1, e: 0.2, text: '2. The server agrees: 101 Switching Protocols.' },
        { t: 'caption', s: 0.2, e: 0.44, text: '3. It is now a two-way pipe. The server pushes whenever it wants.' },
        { t: 'caption', s: 0.44, e: 0.6, text: '4. The browser sends a message up the same connection (no POST).' },
        { t: 'caption', s: 0.6, e: 0.78, text: '5. The server saves it and pushes it to every client, this one included.' },
        { t: 'caption', s: 0.78, e: 1, text: '6. Either side can send at any moment, for as long as the pipe stays open.' },
        { t: 'tube', style: 'twoway', label: 'one two-way connection  (WebSocket)', s: 0.18, e: 1 },
        { t: 'packet', from: 'client', kind: 'req', label: 'GET /ws  Upgrade: websocket', s: 0.01, e: 0.09 },
        { t: 'packet', from: 'server', kind: 'empty', label: '101 Switching Protocols', s: 0.10, e: 0.18 },
        { t: 'badge', at: 'server', label: 'message 1 posted', s: 0.24, e: 0.34 },
        { t: 'packet', from: 'server', kind: 'data', label: 'message 1', s: 0.26, e: 0.34 },
        { t: 'badge', at: 'client', label: 'typed "hi"', s: 0.42, e: 0.52 },
        { t: 'packet', from: 'client', kind: 'req', label: '{"text":"hi"}', s: 0.48, e: 0.56 },
        { t: 'badge', at: 'server', label: 'saved as message 2', s: 0.56, e: 0.66 },
        { t: 'packet', from: 'server', kind: 'data', label: 'message 2: hi', s: 0.62, e: 0.70 },
        { t: 'badge', at: 'server', label: 'message 3 posted', s: 0.78, e: 0.88 },
        { t: 'packet', from: 'server', kind: 'data', label: 'message 3', s: 0.80, e: 0.88 },
        { t: 'packet', from: 'client', kind: 'req', label: '{"text":"bye"}', s: 0.90, e: 0.98 }
      ]
    }
  };

  // ------------------------------------------------------------------ svg helpers
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function text(parent, x, y, str, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls, 'text-anchor': anchor || 'middle', 'dominant-baseline': 'middle' }, parent);
    t.textContent = str;
    return t;
  }

  function widthOf(str) { return str.length * 7.2 + 18; } // rough width of 12px text plus padding

  // Turns [[offset, props], ...] into Web Animations keyframes covering 0..1.
  function frames(points) {
    points = points
      .map(function (p) { return [Math.min(1, Math.max(0, p[0])), p[1]]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (points[0][0] > 0) points.unshift([0, points[0][1]]);
    if (points[points.length - 1][0] < 1) points.push([1, points[points.length - 1][1]]);
    return points.map(function (p) { return Object.assign({ offset: p[0] }, p[1]); });
  }

  function loopAnim(node, points, loop) {
    return node.animate(frames(points), { duration: loop, iterations: Infinity });
  }

  // Visible between s and e, hidden otherwise.
  function visibleDuring(node, s, e, loop) {
    var pts = [];
    if (s > 0) pts.push([s - 0.006, { opacity: 0 }]);
    pts.push([s, { opacity: 1 }], [e, { opacity: 1 }]);
    if (e < 1) pts.push([e + 0.006, { opacity: 0 }]);
    return loopAnim(node, pts, loop);
  }

  // ------------------------------------------------------------------ pieces
  function drawStage(svg) {
    el('line', { x1: LANE_L, y1: UP_Y, x2: LANE_R, y2: UP_Y, 'class': 'lane' }, svg);
    el('line', { x1: LANE_L, y1: DOWN_Y, x2: LANE_R, y2: DOWN_Y, 'class': 'lane' }, svg);
  }

  function drawBoxes(svg) {
    el('rect', { x: 10, y: 50, width: 120, height: 110, rx: 10, 'class': 'box' }, svg);
    text(svg, 70, 105, 'Browser', 'box-label');
    el('rect', { x: 510, y: 50, width: 120, height: 110, rx: 10, 'class': 'box' }, svg);
    text(svg, 570, 105, 'Server', 'box-label');
  }

  function drawTube(svg, item, loop) {
    var g = el('g', {}, svg);
    el('rect', { x: 120, y: 68, width: 400, height: 82, rx: 16, 'class': 'tube ' + (item.style || '') }, g);
    text(g, 320, 166, item.label, 'tube-label');
    return visibleDuring(g, item.s, item.e, loop);
  }

  function drawPacket(svg, item, loop) {
    var toServer = item.from === 'client';
    var w = widthOf(item.label);
    var y = toServer ? UP_Y : DOWN_Y;
    var x0 = toServer ? LANE_L + w / 2 : LANE_R - w / 2;
    var x1 = toServer ? LANE_R - w / 2 : LANE_L + w / 2;

    var g = el('g', { 'class': 'pkt k-' + item.kind }, svg);
    el('rect', { x: -w / 2, y: y - 11, width: w, height: 22, rx: 11 }, g);
    text(g, 0, y + 1, item.label, 'pkt-text');

    function at(x, opacity) { return { opacity: opacity, transform: 'translate(' + x + 'px, 0px)' }; }
    var pts = [];
    if (item.s > 0) pts.push([item.s - 0.001, at(x0, 0)]);
    pts.push([item.s, at(x0, 1)], [item.e, at(x1, 1)]);
    if (item.e < 1) pts.push([item.e + 0.015, at(x1, 0)]);
    return loopAnim(g, pts, loop);
  }

  function drawBadge(svg, item, loop) {
    var w = widthOf(item.label) - 4;
    var x = item.at === 'server' ? W - 10 - w : 10;
    var g = el('g', { 'class': 'badge ' + item.at }, svg);
    el('rect', { x: x, y: 16, width: w, height: 24, rx: 6 }, g);
    text(g, x + w / 2, 29, item.label, 'badge-text');
    return visibleDuring(g, item.s, item.e, loop);
  }

  function drawBreak(svg, item, loop) {
    var g = el('g', { 'class': 'break' }, svg);
    el('rect', { x: 245, y: 95, width: 150, height: 26, rx: 6 }, g);
    text(g, 320, 109, '✕ connection lost', 'break-text');
    return visibleDuring(g, item.s, item.e, loop);
  }

  function drawCaption(svg, item, loop) {
    var t = text(svg, 320, 196, item.text, 'caption');
    return visibleDuring(t, item.s, item.e, loop);
  }

  // ------------------------------------------------------------------ build one figure
  function build(figure) {
    var d = DIAGRAMS[figure.getAttribute('data-anim')];
    if (!d) return;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': d.title });
    figure.appendChild(svg);

    // Layering: lanes, tubes, boxes, then everything that moves on top.
    var anims = [];
    var byType = function (type) { return d.items.filter(function (i) { return i.t === type; }); };
    drawStage(svg);
    byType('tube').forEach(function (i) { anims.push(drawTube(svg, i, d.loop)); });
    drawBoxes(svg);
    byType('packet').forEach(function (i) { anims.push(drawPacket(svg, i, d.loop)); });
    byType('badge').forEach(function (i) { anims.push(drawBadge(svg, i, d.loop)); });
    byType('break').forEach(function (i) { anims.push(drawBreak(svg, i, d.loop)); });
    byType('caption').forEach(function (i) { anims.push(drawCaption(svg, i, d.loop)); });

    // Controls
    var bar = document.createElement('div');
    bar.className = 'anim-controls';
    var toggle = document.createElement('button');
    var restart = document.createElement('button');
    toggle.type = restart.type = 'button';
    restart.textContent = 'Restart';
    bar.appendChild(toggle);
    bar.appendChild(restart);
    figure.appendChild(bar);

    function setPaused(paused) {
      anims.forEach(function (a) { if (paused) a.pause(); else a.play(); });
      figure.classList.toggle('paused', paused); // also pauses the CSS pulse on held requests
      toggle.textContent = paused ? 'Play' : 'Pause';
    }

    toggle.addEventListener('click', function () { setPaused(!figure.classList.contains('paused')); });
    restart.addEventListener('click', function () {
      anims.forEach(function (a) { a.currentTime = 0; });
      setPaused(false);
    });

    if (reduceMotion) {
      anims.forEach(function (a) { a.currentTime = d.loop * d.still; });
      setPaused(true);
    } else {
      setPaused(false);
    }
  }

  if (!Element.prototype.animate) return; // very old browser: keep the text diagrams only
  document.querySelectorAll('figure.anim').forEach(build);
})();

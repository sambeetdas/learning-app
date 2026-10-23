$(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var LAYERS = [3, 4, 4, 2];
  var TITLES = ['Input', 'Hidden layer 1', 'Hidden layer 2', 'Output'];
  var IN_LABELS = ['Income', 'Credit history', 'Missed payments'];
  var OUT_LABELS = ['Approve', 'Reject'];
  var X = [140, 290, 440, 590], W = 720, H = 270, TOP = 52, BOTTOM = 245;

  // weights[l][to][from], biases[l][to]  (hand-picked so the demo behaves sensibly)
  var WEIGHTS = [
    [[1.5, 1.0, -0.8], [-1.2, 0.4, 1.5], [0.9, -0.7, 0.3], [0.2, 1.4, -1.3]],
    [[1.4, -0.6, 0.3, 0.8], [-0.5, 1.6, 0.4, -0.7], [0.7, -0.2, -0.9, 0.6], [-0.4, 0.9, 1.1, -0.3]],
    [[1.6, -1.2, 0.5, -0.4], [-1.3, 1.5, -0.3, 0.8]]
  ];
  var BIASES = [[-0.6, -0.2, 0.1, -0.3], [-0.3, 0.1, 0, -0.1], [-0.2, 0.1]];

  var svg = document.getElementById('nn');
  var pos = [], nodeG = [], edges = [], valText = [], outLabels = [], timers = [];

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function forward(input) {
    var acts = [input.slice()], l;
    for (l = 0; l < WEIGHTS.length; l++) {
      var prev = acts[l], out = WEIGHTS[l].map(function (row, j) {
        var s = BIASES[l][j]; row.forEach(function (w, i) { s += w * prev[i]; });
        return l < WEIGHTS.length - 1 ? Math.max(0, s) : s;      // ReLU on hidden layers, raw score on output
      });
      acts.push(out);
    }
    var o = acts[acts.length - 1], m = Math.max(o[0], o[1]);
    var e0 = Math.exp(o[0] - m), e1 = Math.exp(o[1] - m);
    acts[acts.length - 1] = [e0 / (e0 + e1), e1 / (e0 + e1)];      // softmax -> probabilities
    return acts;
  }

  // ---------------------------------------------------------------- build the drawing once
  LAYERS.forEach(function (count, l) {
    pos[l] = [];
    for (var j = 0; j < count; j++) pos[l].push({ x: X[l], y: TOP + (j + 0.5) * (BOTTOM - TOP) / count });
    el('text', { x: X[l], y: 18, 'text-anchor': 'middle', 'class': 'layer-title' }, svg).textContent = TITLES[l];
  });

  var edgeLayer = el('g', {}, svg), nodeLayer = el('g', {}, svg);
  for (var l = 0; l < LAYERS.length - 1; l++) {
    edges[l] = [];
    WEIGHTS[l].forEach(function (row, to) {
      row.forEach(function (w, from) {
        var a = pos[l][from], b = pos[l + 1][to];
        var ln = el('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          'class': 'edge ' + (w >= 0 ? 'pos' : 'neg'),
          'stroke-width': (0.6 + Math.abs(w) * 1.3).toFixed(2),
          opacity: (0.18 + 0.5 * Math.min(1, Math.abs(w) / 1.6)).toFixed(2)
        }, edgeLayer);
        edges[l].push(ln);
      });
    });
  }

  LAYERS.forEach(function (count, l) {
    nodeG[l] = []; valText[l] = [];
    pos[l].forEach(function (p, j) {
      var g = el('g', { 'class': 'node-g' }, nodeLayer);
      el('circle', { cx: p.x, cy: p.y, r: 19, 'class': 'node' }, g);
      var glow = el('circle', { cx: p.x, cy: p.y, r: 17, 'class': 'glow', 'fill-opacity': 0 }, g);
      var t = el('text', { x: p.x, y: p.y + 3.5, 'text-anchor': 'middle', 'class': 'val' }, g);
      nodeG[l].push({ g: g, glow: glow }); valText[l].push(t);
      if (l === 0) el('text', { x: p.x - 28, y: p.y + 4, 'text-anchor': 'end', 'class': 'lbl' }, svg).textContent = IN_LABELS[j];
      if (l === LAYERS.length - 1) outLabels.push(el('text', { x: p.x + 28, y: p.y + 4, 'class': 'lbl' }, svg));
    });
  });

  // ---------------------------------------------------------------- show activations
  var current;
  function render() {
    var input = [$('#nn-in0').val(), $('#nn-in1').val(), $('#nn-in2').val()].map(Number);
    current = forward(input);
    current.forEach(function (acts, l) {
      var max = Math.max.apply(null, acts.concat(l === 0 || l === LAYERS.length - 1 ? [1] : [1.5]));
      acts.forEach(function (a, j) {
        valText[l][j].textContent = a.toFixed(2);
        nodeG[l][j].glow.setAttribute('fill-opacity', Math.min(0.85, a / max * 0.85).toFixed(2));
      });
    });
    var out = current[current.length - 1];
    outLabels.forEach(function (t, j) { t.textContent = OUT_LABELS[j] + ' ' + Math.round(out[j] * 100) + '%'; });
    ['#nn-in0-v', '#nn-in1-v', '#nn-in2-v'].forEach(function (id, i) { $(id).text(input[i].toFixed(2)); });
  }

  // ---------------------------------------------------------------- animations
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function resetClasses() {
    nodeG.forEach(function (layer) { layer.forEach(function (n) { n.g.setAttribute('class', 'node-g'); }); });
    edges.forEach(function (layer) { layer.forEach(function (e) { e.classList.remove('flash', 'back'); }); });
  }
  function caption(t) { $('#nn-caption').text(t); }

  function runForward() {
    clearTimers(); resetClasses();
    nodeG.forEach(function (layer) { layer.forEach(function (n) { n.g.classList.add('dim'); }); });
    caption('Input: the three numbers enter the network.');
    var msgs = ['Layer 1: every neuron computes a weighted sum of the inputs, adds a bias, and applies ReLU (negative becomes 0).',
                'Layer 2: the same again, building more abstract combinations of the previous layer.',
                'Output: the final scores are turned into probabilities (softmax). The highest one is the prediction.'];
    nodeG[0].forEach(function (n) { n.g.classList.remove('dim'); });
    for (var l = 1; l < LAYERS.length; l++) (function (l) {
      later(function () {
        edges[l - 1].forEach(function (e) { e.classList.add('flash'); });
        caption(msgs[l - 1]);
      }, l * 1300 - 900);
      later(function () {
        edges[l - 1].forEach(function (e) { e.classList.remove('flash'); });
        nodeG[l].forEach(function (n) { n.g.classList.remove('dim'); });
      }, l * 1300);
    })(l);
    later(function () {
      var o = current[current.length - 1];
      caption('Prediction: ' + (o[0] >= o[1] ? OUT_LABELS[0] : OUT_LABELS[1]) + ' (' + Math.round(Math.max(o[0], o[1]) * 100) + '% confident). This whole pass is called inference.');
    }, LAYERS.length * 1300);
  }

  function runBackward() {
    clearTimers(); resetClasses();
    caption('Suppose the true answer was the opposite. The network compares its output with the truth and computes the error (the loss).');
    nodeG[LAYERS.length - 1].forEach(function (n) { n.g.classList.add('err'); });
    for (var l = LAYERS.length - 2; l >= 0; l--) (function (l) {
      var step = LAYERS.length - 1 - l;
      later(function () {
        edges[l].forEach(function (e) { e.classList.add('back'); });
        caption(l === LAYERS.length - 2 ? 'Backpropagation: the error is passed backwards. Each weight learns how much it contributed to the mistake.' :
                l === 0 ? 'Every weight is nudged a little in the direction that reduces the error (gradient descent).' :
                'The blame keeps flowing backwards, layer by layer, using the chain rule.');
      }, step * 1300 - 900);
      later(function () {
        edges[l].forEach(function (e) { e.classList.remove('back'); });
        nodeG[l].forEach(function (n) { n.g.classList.add('err'); });
      }, step * 1300);
    })(l);
    later(function () { caption('One update done. Training repeats this forward + backward cycle thousands to millions of times, over batches of examples.'); }, LAYERS.length * 1300);
  }

  $('#nn-fwd').on('click', runForward);
  $('#nn-back').on('click', runBackward);
  $('#nn-clear').on('click', function () { clearTimers(); resetClasses(); caption('Move the sliders to change the inputs and watch the activations update.'); });
  $('.nn-slider').on('input', function () { clearTimers(); resetClasses(); render(); });
  render();
});

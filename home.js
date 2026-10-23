$(function () {
  'use strict';

  // To add a topic: create a folder with its own index.html, then add an entry here.
  var TOPICS = [
    {
      folder: 'streaming-api',
      title: 'Streaming API',
      summary: 'Short polling, long polling, SSE, HTTP streaming and WebSocket: how a server tells the browser something new happened, with animated diagrams and system-design notes.',
      tags: ['http', 'real-time', 'system design']
    },
    {
      folder: 'dns',
      title: 'DNS',
      summary: 'How names become addresses: resolvers, root/TLD/authoritative servers, caching and TTL, record types, anycast, DNSSEC, traffic steering, security and troubleshooting. Includes a step-through resolution demo.',
      tags: ['networking', 'infrastructure', 'system design']
    },
    {
      folder: 'cdn',
      title: 'CDN',
      summary: 'Edge caching, origin shield, Cache-Control headers, cache keys, invalidation, video/API/static use cases, security and metrics. Includes an interactive edge cache simulator.',
      tags: ['performance', 'caching', 'system design']
    },
    {
      folder: 'ml',
      title: 'Machine Learning',
      summary: 'Types of learning, use cases, algorithms and when to use them, data pitfalls, overfitting, metrics, ensembles, combining models into real pipelines, deep learning, MLOps and responsible AI. Six animated demos.',
      tags: ['ai', 'data', 'algorithms']
    },
    {
      folder: 'pytorch',
      title: 'PyTorch and Deep Learning',
      summary: 'History, tensors, autograd, nn.Module, the training loop, and every major deep learning algorithm (optimizers, CNN, RNN, transformer, GAN, diffusion, GNN, RL) with code, PyTorch internals, scaling and deployment. Nine animated demos.',
      tags: ['deep learning', 'python', 'ai']
    },
    {
      folder: 'dsa',
      title: 'Data Structures and Algorithms',
      summary: '19 pages from Big-O to advanced and modern algorithms: arrays, lists, stacks, hashing, trees, heaps, graphs, sorting, searching, recursion, DP, greedy, strings, math, probabilistic structures and problem patterns. Step-through animations, pseudocode, Python and solved practice questions.',
      tags: ['algorithms', 'data structures', 'interviews']
    }
  ];

  function render(filter) {
    var q = $.trim(filter || '').toLowerCase();
    var $grid = $('#topics').empty();
    var shown = 0;

    TOPICS.forEach(function (t) {
      var hay = (t.title + ' ' + t.summary + ' ' + t.tags.join(' ')).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      shown++;

      var $tags = $('<div class="tags">');
      t.tags.forEach(function (tag) { $('<span>').text(tag).appendTo($tags); });

      $('<a class="card-link">')
        .attr('href', t.folder + '/index.html')
        .append($('<h2>').text(t.title), $('<p>').text(t.summary), $tags)
        .appendTo($grid);
    });

    $('#empty').prop('hidden', shown > 0);
  }

  $('#search').on('input', function () { render(this.value); });
  render('');
});

$(function () {
  'use strict';

  var EDGE_MS = 20, ORIGIN_MS = 180;

  // ttl in seconds; null = not cacheable
  var ASSETS = [
    { path: '/index.html',     ttl: 60,       header: 'public, max-age=60' },
    { path: '/app.3f9a1c.js',  ttl: 31536000, header: 'public, max-age=31536000, immutable' },
    { path: '/logo.png',       ttl: 3600,     header: 'public, max-age=3600' },
    { path: '/api/cart',       ttl: null,     header: 'private, no-store' }
  ];

  var clock, cache, stats;

  function reset() {
    clock = 0;
    cache = {};                    // path -> expiresAt (simulated seconds)
    stats = { requests: 0, hits: 0, originRequests: 0 };
    $('#cdn-log').empty();
    render();
  }

  function assetFor(path) {
    return ASSETS.filter(function (a) { return a.path === path; })[0];
  }

  function isFresh(path) { return cache[path] !== undefined && cache[path] > clock; }

  // Returns 'HIT' | 'MISS' | 'BYPASS' and updates the counters.
  function request(asset) {
    stats.requests++;
    if (asset.ttl === null) {
      stats.originRequests++;
      return 'BYPASS';
    }
    if (isFresh(asset.path)) {
      stats.hits++;
      return 'HIT';
    }
    stats.originRequests++;
    cache[asset.path] = clock + asset.ttl;
    return 'MISS';
  }

  function ms(result) { return result === 'HIT' ? EDGE_MS : EDGE_MS + ORIGIN_MS; }

  function logLine(result, text) {
    $('<div>')
      .append($('<span class="tag">').addClass(result).text(result), document.createTextNode(text))
      .prependTo('#cdn-log');
  }

  function fmtTime(s) {
    if (s >= 3600) return (s / 3600).toFixed(s % 3600 ? 1 : 0) + ' h';
    return s + ' s';
  }

  function render() {
    $('#c-clock').text(fmtTime(clock));
    $('#c-req').text(stats.requests);
    $('#c-origin').text(stats.originRequests);
    $('#c-ratio').text(stats.requests ? Math.round(stats.hits / stats.requests * 100) + '%' : '-');

    var $list = $('#cdn-cache').empty();
    var live = Object.keys(cache).filter(isFresh);
    if (!live.length) {
      $('<li class="empty">').text('(empty)').appendTo($list);
    }
    live.forEach(function (p) {
      var left = cache[p] - clock;
      $('<li>').text(p + '  expires in ' + (left > 86400 * 30 ? '~1 year' : fmtTime(left))).appendTo($list);
    });
  }

  // ----- controls
  var $assets = $('#cdn-assets');
  ASSETS.forEach(function (a) {
    $('<button type="button">').text('GET ' + a.path).attr('title', 'Cache-Control: ' + a.header)
      .on('click', function () {
        var r = request(a);
        logLine(r, a.path + '   ' + ms(r) + ' ms   (' + a.header + ')');
        render();
      }).appendTo($assets);
  });

  $('#cdn-demo').on('click', 'button[data-act]', function () {
    var act = $(this).data('act');
    if (act === 'wait30') { clock += 30; logLine('BYPASS', '... 30 s pass'); }
    else if (act === 'wait1h') { clock += 3600; logLine('BYPASS', '... 1 hour passes'); }
    else if (act === 'purge') { cache = {}; logLine('BYPASS', 'Purged: edge cache emptied'); }
    else if (act === 'reset') { reset(); return; }
    else if (act === 'burst') {
      var a = assetFor('/index.html'), hits = 0, misses = 0, total = 0;
      for (var n = 0; n < 100; n++) {
        var r = request(a);
        total += ms(r);
        if (r === 'HIT') hits++; else misses++;
      }
      logLine(hits ? 'HIT' : 'MISS', '100 users /index.html: ' + hits + ' hits, ' + misses + ' origin fetch, average ' + Math.round(total / 100) + ' ms');
    }
    render();
  });

  reset();
});

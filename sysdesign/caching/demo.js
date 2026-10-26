$(function () {
  'use strict';
  SD.pageChrome('caching');

  var D = { nodes: [['c', 'Client', 'client', 0, 1], ['app', 'App server', 'svc', 1.5, 1], ['ca', 'Cache', 'cache', 3, 0.2, 'Redis'], ['db', 'Database', 'db', 3, 1.8]], edges: [['c', 'app'], ['app', 'ca'], ['app', 'db'], ['ca', 'db', '', 'async']] };
  SD.multi('#cs-demo', [
    { name: 'Cache-aside: read', desc: 'The application owns the logic: check the cache, fall back to the database, populate the cache.', diagram: D, steps: [
      ['c', 'app', 'GET /user/7', 'A request arrives.'], ['app', 'ca', 'GET user:7', 'Look in the cache first.'], ['ca', 'app', 'miss', 'Not cached yet.', 'err'],
      ['app', 'db', 'SELECT * FROM users WHERE id=7', 'Read from the database.'], ['db', 'app', 'row', 'Got it.', 'resp'], ['app', 'ca', 'SET user:7 EX 600', 'Store it with a TTL for next time.'],
      ['app', 'c', '200 OK', 'Respond. The next request is a cache hit (~0.3 ms).', 'resp']] },
    { name: 'Cache-aside: write', desc: 'Write the source of truth first, then invalidate.', diagram: D, steps: [
      ['c', 'app', 'PUT /user/7', 'An update arrives.'], ['app', 'db', 'UPDATE users ...', 'Write the database (the source of truth).'], ['db', 'app', 'committed', 'Committed.', 'resp'],
      ['app', 'ca', 'DEL user:7', 'Delete the cached copy (do not update it: concurrent writers could leave an older value).'], ['app', 'c', '200 OK', 'The next read reloads fresh data.', 'resp']] },
    { name: 'Write-through', desc: 'Writes go through the cache to the database synchronously.', diagram: D, steps: [
      ['c', 'app', 'PUT /user/7', 'An update arrives.'], ['app', 'ca', 'SET user:7', 'Write the cache...'], ['ca', 'db', 'write synchronously', '...which writes the database before acknowledging (or the app writes both).'],
      ['db', 'ca', 'ok', 'Both updated.', 'resp'], ['app', 'c', '200 OK', 'Reads are always warm; writes are slower.', 'resp']] },
    { name: 'Write-behind', desc: 'Writes land in the cache and are flushed to the database later.', diagram: D, steps: [
      ['c', 'app', 'POST /views (x1000/s)', 'High-rate writes, such as view counters.'], ['app', 'ca', 'INCR views:42', 'Increment in memory: microseconds.'], ['app', 'c', '200 OK', 'Fast response.', 'resp'],
      ['ca', 'db', 'flush every 5 s (batched)', 'A background job flushes aggregated values. If the cache node dies before flushing, the last few seconds are lost.', 'async']] }
  ]);

  var DS = { nodes: [['u', '10,000 users', 'client', 0, 1], ['app', 'App servers', 'svc', 1.5, 1], ['ca', 'Cache', 'cache', 3, 0.2], ['db', 'Database', 'db', 3, 1.8], ['bf', 'Bloom filter', 'svc', 1.5, 2.4, 'valid ids']],
    edges: [['u', 'app'], ['app', 'ca'], ['app', 'db'], ['app', 'bf']] };
  SD.multi('#cp-demo', [
    { name: 'Stampede', desc: 'A hot key (the home page) expires during peak traffic.', diagram: DS, steps: [
      ['u', 'app', '5,000 req/s for home', 'Huge traffic for one key.'], ['app', 'ca', 'GET home', 'The key just expired.'], ['ca', 'app', 'miss x 5,000', 'Every concurrent request misses at once.', 'err'],
      ['app', 'db', '5,000 identical queries', 'All of them run the same expensive query: the database saturates and everything slows down.', 'err']] },
    { name: 'Fix: request coalescing', desc: 'Only one request rebuilds the value; the rest wait or get the stale copy.', diagram: DS, steps: [
      ['app', 'ca', 'GET home (miss)', 'The first request misses...'], ['app', 'ca', 'SET lock:home NX EX 5', '...and takes a short lock (single-flight). Others see the lock.'],
      ['app', 'db', 'one query', 'Only the lock holder queries the database.'], ['app', 'ca', 'SET home EX 60+jitter', 'It refreshes the cache with a jittered TTL.'],
      ['ca', 'app', 'others: stale or fresh value', 'Waiting requests read the new value (or are served the stale copy while revalidating).', 'resp']] },
    { name: 'Penetration and the fix', desc: 'Requests for ids that do not exist always miss.', diagram: DS, steps: [
      ['u', 'app', 'GET /item/999999 (x many)', 'An attacker requests random, non-existent ids.'], ['app', 'ca', 'miss', 'Never cached, because nothing exists.', 'err'], ['app', 'db', 'useless queries', 'Each one reaches the database.', 'err'],
      ['app', 'bf', 'might id exist?', 'Fix: check a Bloom filter of valid ids first (no false negatives).'], ['bf', 'app', 'definitely not', 'Reject immediately; also cache "not found" briefly.', 'resp']] }
  ]);

  // ---------------------------------------------------------------- eviction simulation
  function zipfSampler(n, s, rng) {
    var cdf = [], sum = 0, i; for (i = 1; i <= n; i++) { sum += 1 / Math.pow(i, s); cdf.push(sum); }
    return function () { var x = rng() * sum, lo = 0, hi = n - 1; while (lo < hi) { var m = (lo + hi) >> 1; if (cdf[m] < x) lo = m + 1; else hi = m; } return lo; };
  }
  function simulate(policy, size, reqs) {
    var hits = 0, store = new Map(), freq = new Map(), fifo = [], r = DSA.rng(5), i;
    for (i = 0; i < reqs.length; i++) {
      var k = reqs[i];
      if (store.has(k)) { hits++; if (policy === 'LRU') { store.delete(k); store.set(k, 1); } freq.set(k, (freq.get(k) || 0) + 1); continue; }
      freq.set(k, (freq.get(k) || 0) + 1);
      if (store.size >= size) {
        var victim;
        if (policy === 'LRU') victim = store.keys().next().value;
        else if (policy === 'FIFO') victim = fifo.shift();
        else if (policy === 'Random') { var arr = Array.from(store.keys()); victim = arr[Math.floor(r() * arr.length)]; }
        else { var best = Infinity; store.forEach(function (_, key) { var f = freq.get(key); if (f < best) { best = f; victim = key; } }); }
        store.delete(victim);
        if (policy !== 'FIFO') { var ix = fifo.indexOf(victim); if (ix >= 0) fifo.splice(ix, 1); }
      }
      store.set(k, 1); fifo.push(k);
    }
    return hits / reqs.length;
  }
  function ev() {
    var size = +$('#ev-size').val(), s = +$('#ev-skew').val(), rng = DSA.rng(11), z = zipfSampler(1000, s, rng), reqs = [];
    $('#ev-size-v').text(size);
    for (var i = 0; i < 20000; i++) reqs.push(z());
    var pols = ['LRU', 'LFU', 'FIFO', 'Random'], rates = pols.map(function (p) { return simulate(p, size, reqs); });
    var best = Math.max.apply(null, rates), marks = {};
    rates.forEach(function (x, i2) { marks[i2] = x === best ? 'ok' : 'a'; });
    var $s = $('#ev-stage').empty();
    DSA.bars($s, rates.map(function (x) { return Math.round(x * 100); }), { marks: marks, max: 100 });
    $s.append('<div class="cells" style="justify-content:space-around">' + pols.map(function (p) { return '<span class="muted" style="font-size:.8rem">' + p + '</span>'; }).join('') + '</div>');
    $('#ev-out').html('Hit rates (%): ' + pols.map(function (p, i3) { return p + ' <b>' + (rates[i3] * 100).toFixed(1) + '</b>'; }).join(' &middot; ') + '. A cache holding ' + (size / 10).toFixed(0) + '% of the items serves this share of all requests.');
  }
  $('#ev-size, #ev-skew').on('change', ev);
  $('#ev-size').on('input', function () { $('#ev-size-v').text(this.value); });
  ev();

  ['azCaching', 'azp-cache-aside', 'azp-static-content-hosting', 'azCdn'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsCaching', 'blCaching', 'blShedding'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

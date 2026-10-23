$(function () {
  'use strict';

  function hashOf(key, m) {                        // ints: k mod m; strings: polynomial hash mod m
    if (/^-?\d+$/.test(key)) { var k = parseInt(key, 10); return { h: ((k % m) + m) % m, how: key + ' mod ' + m }; }
    var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1000000007;
    return { h: h % m, how: 'polyhash("' + key + '") = ' + h + ', mod ' + m };
  }

  var CODES = {
    chain: ['i = hash(key) % m', 'bucket = table[i]', 'if key not in bucket:      # collisions share a bucket', '    bucket.append(key)', 'if count / m > 0.75: resize(2 * m)   # keep chains short'],
    probe: ['i = hash(key) % m', 'while table[i] is not empty and table[i] != key:', '    i = (i + 1) % m           # collision: try the next slot', 'table[i] = key', 'if count / m > 0.75: resize(2 * m)']
  };

  function frames(mode, keys, m, resize, target) {
    var F = [], table, count = 0;
    function empty(size) { var t = []; for (var i = 0; i < size; i++) t.push(mode === 'chain' ? [] : null); return t; }
    function snap(line, msg, hl) { F.push({ mode: mode, table: DSA.clone(table), m: table.length, count: count, line: line, msg: msg, hl: hl || {} }); }
    function insert(key, silent) {
      var r = hashOf(key, table.length), i = r.h, hl = {};
      if (!silent) { hl[i + ',0'] = 'a'; snap(0, 'Insert "' + key + '": ' + r.how + ' = ' + i + '.', hl); }
      if (mode === 'chain') {
        if (table[i].indexOf(key) >= 0) { if (!silent) snap(2, '"' + key + '" is already in bucket ' + i + '; nothing to do.'); return; }
        var collide = table[i].length > 0;
        table[i].push(key); count++;
        if (!silent) { hl = {}; hl[i + ',' + (table[i].length - 1)] = collide ? 'b' : 'ok'; snap(3, collide ? 'Collision: bucket ' + i + ' already holds ' + (table[i].length - 1) + ' key(s). Chain "' + key + '" onto the same bucket.' : 'Bucket ' + i + ' was empty: store "' + key + '" there.', hl); }
      } else {
        var probes = 0;
        while (table[i] !== null && table[i] !== key) {
          if (probes >= table.length) { snap(1, 'Every slot is full: "' + key + '" cannot be stored. Open addressing needs a resize before the table fills up.'); return; }
          if (!silent) { hl = {}; hl[i + ',0'] = 'c'; snap(1, 'Slot ' + i + ' is taken by "' + table[i] + '": collision. Probe the next slot.', hl); }
          i = (i + 1) % table.length; probes++;
        }
        if (table[i] === key) { if (!silent) snap(1, '"' + key + '" is already stored.'); return; }
        table[i] = key; count++;
        if (!silent) { hl = {}; hl[i + ',0'] = probes ? 'b' : 'ok'; snap(3, 'Store "' + key + '" in slot ' + i + (probes ? ' after ' + probes + ' probe(s). Runs of occupied slots ("clusters") make later inserts slower.' : '.'), hl); }
      }
      if (resize && count / table.length > 0.75) {
        var old = table, nm = table.length * 2 + 1;
        snap(4, 'Load factor ' + count + '/' + old.length + ' = ' + (count / old.length).toFixed(2) + ' > 0.75. Resize to ' + nm + ' slots and re-insert every key (their positions change, because the modulus changed).');
        table = empty(nm); count = 0;
        old.forEach(function (b) { [].concat(mode === 'chain' ? b : (b === null ? [] : [b])).forEach(function (k) { insert(k, true); }); });
        snap(4, 'Rehashed into ' + nm + ' slots. Resizing is O(n), but like a dynamic array it happens rarely: inserts stay amortised O(1).');
      }
    }
    table = empty(m);
    snap([], 'Empty table with ' + m + ' slots. A hash function turns each key into a slot number.');
    keys.forEach(function (k) { insert(k, false); });
    // lookup
    if (target !== '') {
      var r = hashOf(target, table.length), i = r.h, hl = {}, steps = 1;
      hl[i + ',0'] = 'a';
      snap(0, 'Look up "' + target + '": ' + r.how + ' = ' + i + '. Only this bucket needs checking, not the whole table.', hl);
      if (mode === 'chain') {
        var pos = table[i].indexOf(target); hl = {};
        if (pos >= 0) { hl[i + ',' + pos] = 'ok'; snap(2, 'Found "' + target + '" in bucket ' + i + ' after comparing ' + (pos + 1) + ' key(s). O(1) on average.', hl); }
        else { hl[i + ',0'] = 'c'; snap(2, '"' + target + '" is not in bucket ' + i + ', so it is not in the table.', hl); }
      } else {
        while (table[i] !== null && table[i] !== target && steps <= table.length) { hl = {}; hl[i + ',0'] = 'c'; snap(1, 'Slot ' + i + ' holds "' + table[i] + '": keep probing.', hl); i = (i + 1) % table.length; steps++; }
        hl = {}; hl[i + ',0'] = table[i] === target ? 'ok' : 'c';
        snap(1, table[i] === target ? 'Found "' + target + '" in slot ' + i + ' after ' + steps + ' probe(s).' :
          table[i] === null ? 'Hit an empty slot (' + i + '): "' + target + '" is not in the table. (This is why deletion in open addressing needs "tombstones".)' :
          'Checked every slot: "' + target + '" is not in the table. A full table makes every miss O(n).', hl);
      }
    }
    return F;
  }

  function render(f, ctx) {
    var rows = f.table.map(function (b) { return f.mode === 'chain' ? (b.length ? b : ['']) : [b === null ? '' : b]; });
    DSA.grid(ctx.stage, rows, { rowHead: rows.map(function (_, i) { return 'slot ' + i; }), marks: f.hl });
    $('<div class="readout">').html('Keys: <b>' + f.count + '</b> &middot; slots: <b>' + f.m + '</b> &middot; load factor &alpha; = <b>' + (f.count / f.m).toFixed(2) + '</b>').appendTo(ctx.stage);
  }

  var p = DSA.player('#ht-demo', [], render, { code: CODES.chain });
  function build() {
    var mode = $('#ht-mode').val(), keys = $('#ht-keys').val().split(/[\s,]+/).filter(Boolean).slice(0, 14);
    p.set(frames(mode, keys, Math.max(2, Math.min(13, +$('#ht-m').val() || 7)), $('#ht-resize').prop('checked'), $.trim($('#ht-find').val())), CODES[mode]);
  }
  $('#ht-mode, #ht-resize').on('change', build); $('#ht-run').on('click', build);
  build();
});

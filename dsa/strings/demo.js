$(function () {
  'use strict';

  // ================================================================== KMP
  (function () {
    var CODE = ['# 1. failure table: lps[i] = length of the longest proper prefix of p[:i+1] that is also a suffix', 'lps = [0]*m; k = 0', 'for i in 1..m-1:', '    while k and p[i] != p[k]: k = lps[k-1]', '    if p[i] == p[k]: k += 1', '    lps[i] = k', '# 2. search: never move backwards in the text', 'j = 0', 'for i, c in enumerate(text):', '    while j and c != p[j]: j = lps[j-1]      # fall back in the PATTERN only', '    if c == p[j]: j += 1', '    if j == m: report match at i-m+1; j = lps[j-1]'];
    function frames(text, p) {
      text = text.slice(0, 26); p = p.slice(0, 10);
      var F = [], m = p.length, lps = p.split('').map(function () { return null; }), k = 0, i, cmp = 0, matches = [];
      lps[0] = 0;
      function snapT(line, msg, pm) { F.push({ phase: 'lps', p: p, lps: lps.slice(), pm: pm || {}, line: line, msg: msg }); }
      snapT(1, 'Phase 1: build the failure table (also called LPS or prefix function) for the pattern "' + p + '". It tells us how far we can fall back after a mismatch without re-reading the text.', { 0: 'ok' });
      for (i = 1; i < m; i++) {
        while (k && p[i] !== p[k]) { var o = {}; o[i] = 'c'; o[k] = 'c'; snapT(3, 'p[' + i + ']="' + p[i] + '" ≠ p[' + k + ']="' + p[k] + '": fall back k = lps[' + (k - 1) + '] = ' + lps[k - 1] + '.', o); k = lps[k - 1]; }
        if (p[i] === p[k]) k++;
        lps[i] = k;
        var mm = {}; mm[i] = 'ok'; if (k) mm[k - 1] = 'b';
        snapT([4, 5], 'lps[' + i + '] = ' + k + (k ? ': "' + p.slice(0, k) + '" is both a prefix and a suffix of "' + p.slice(0, i + 1) + '".' : ': no prefix of "' + p.slice(0, i + 1) + '" is also its suffix.'), mm);
      }
      var j = 0;
      function snapS(line, msg, ti, mark) {
        var tm = {}; matches.forEach(function (s) { for (var q = s; q < s + m; q++) tm[q] = 'p'; }); if (ti !== undefined) tm[ti] = mark;
        // where the pattern currently starts: after a match j was already advanced, hence the +1
        var shift = ti === undefined ? -1000 : ti - j + (mark === 'ok' ? 1 : 0);
        var row = []; for (var q = 0; q < text.length; q++) row.push(q >= shift && q < shift + m ? p[q - shift] : null);
        var pm = {}; for (q = 0; q < text.length; q++) if (row[q] !== null) pm[q] = (q - shift) < j ? 'ok' : ''; if (ti !== undefined && row[ti] !== null) pm[ti] = mark;
        F.push({ phase: 'search', text: text, row: row, tm: tm, pm: pm, lps: lps.slice(), p: p, cmp: cmp, line: line, msg: msg });
      }
      snapS(7, 'Phase 2: slide the pattern along the text. The text index i only ever moves forward.');
      for (i = 0; i < text.length; i++) {
        while (j && text[i] !== p[j]) { cmp++; snapS(9, 'text[' + i + ']="' + text[i] + '" ≠ p[' + j + ']="' + p[j] + '". Instead of restarting, jump to j = lps[' + (j - 1) + '] = ' + lps[j - 1] + ': the first ' + lps[j - 1] + ' character(s) are already known to match.', i, 'c'); j = lps[j - 1]; }
        cmp++;
        if (text[i] === p[j]) { j++; snapS(10, 'text[' + i + ']="' + text[i] + '" matches p[' + (j - 1) + ']. j = ' + j + '.', i, 'ok'); }
        else snapS(10, 'text[' + i + ']="' + text[i] + '" does not match p[0]; move on.', i, 'c');
        if (j === m) { matches.push(i - m + 1); snapS(11, 'Full match at position ' + (i - m + 1) + '! Continue with j = lps[' + (m - 1) + '] = ' + lps[m - 1] + ' to find overlapping matches.', i, 'ok'); j = lps[j - 1]; }
      }
      snapS([], (matches.length ? 'Matches at ' + matches.join(', ') : 'No match') + '. ' + cmp + ' character comparisons: O(n + m) guaranteed, versus up to O(n·m) for the naive method.');
      return F;
    }
    function render(f, ctx) {
      if (f.phase === 'lps') {
        DSA.cells(ctx.stage, f.p.split(''), { marks: f.pm, label: 'pattern' });
        DSA.cells(ctx.stage, f.lps.map(function (v) { return v === null ? '' : v; }), { marks: f.pm, label: 'lps (failure table)' });
      } else {
        DSA.cells(ctx.stage, f.text.split(''), { marks: f.tm, label: 'text (purple = found matches)' });
        DSA.cells(ctx.stage, f.row, { marks: f.pm, label: 'pattern, aligned at its current shift', noIndex: true });
        $('<div class="readout">').html('lps = [' + f.lps.join(', ') + '] &middot; comparisons: <b>' + f.cmp + '</b>').appendTo(ctx.stage);
      }
    }
    var p = DSA.player('#kmp-demo', frames('ababcabcabababd', 'ababd'), render, { code: CODE, speed: 800 });
    $('#kmp-run').on('click', function () { p.set(frames($('#kmp-t').val() || 'a', $('#kmp-p').val() || 'a')); });
  })();

  // ================================================================== Rabin-Karp
  (function () {
    var CODE = ['B, M = 256, mod                        # base and modulus', 'hp = hash(pattern); h = hash(text[0:m])', 'for s in range(n - m + 1):', '    if h == hp and text[s:s+m] == pattern: report s   # verify: hashes can collide', '    if s + m < n:                                    # roll the window one step', '        h = ((h - ord(text[s]) * B**(m-1)) * B + ord(text[s+m])) % M'];
    function frames(text, p, M) {
      text = text.slice(0, 26); p = p.slice(0, 8);
      var n = text.length, m = p.length, B = 256, F = [], hp = 0, h = 0, high = 1, i;
      if (m > n || !m) return [{ text: text, s: -1, h: 0, hp: 0, marks: {}, line: [], msg: 'The pattern must be shorter than the text.' }];
      for (i = 0; i < m - 1; i++) high = (high * B) % M;
      for (i = 0; i < m; i++) { hp = (hp * B + p.charCodeAt(i)) % M; h = (h * B + text.charCodeAt(i)) % M; }
      var found = [];
      function snap(s, line, msg, mark) {
        var mk = {}; found.forEach(function (f) { for (var q = f; q < f + m; q++) mk[q] = 'p'; });
        if (s >= 0) for (var q2 = s; q2 < s + m; q2++) mk[q2] = mark || 'a';
        F.push({ text: text, s: s, h: h, hp: hp, marks: mk, line: line, msg: msg });
      }
      snap(-1, 1, 'Hash the pattern "' + p + '" once (' + hp + ', using modulus ' + M + '). Then slide a window of length ' + m + ', updating its hash in O(1) instead of rehashing.');
      for (var s = 0; s <= n - m; s++) {
        if (h === hp) {
          if (text.substr(s, m) === p) { found.push(s); snap(s, 3, 'Window ' + s + ' hash ' + h + ' = pattern hash, and the characters really match: found at ' + s + '.', 'ok'); }
          else snap(s, 3, 'Window ' + s + ' hash ' + h + ' equals the pattern hash, but "' + text.substr(s, m) + '" ≠ "' + p + '": a spurious hit (collision). That is why we verify. A large prime modulus makes this rare.', 'c');
        } else snap(s, 2, 'Window ' + s + ' "' + text.substr(s, m) + '": hash ' + h + ' ≠ ' + hp + '. Skip without comparing characters.');
        if (s + m < n) h = (((h - text.charCodeAt(s) * high % M + M) % M) * B + text.charCodeAt(s + m)) % M;
      }
      snap(-1, [], (found.length ? 'Found at ' + found.join(', ') : 'Not found') + '. Expected O(n + m). Rolling hashes also power plagiarism detection, rsync and finding duplicate substrings.');
      return F;
    }
    function render(f, ctx) {
      DSA.cells(ctx.stage, f.text.split(''), { marks: f.marks, label: 'text' });
      $('<div class="readout">').html('window hash: <b>' + (f.s >= 0 ? f.h : '-') + '</b> &middot; pattern hash: <b>' + f.hp + '</b>').appendTo(ctx.stage);
    }
    var p = DSA.player('#rk-demo', frames('abracadabra cadabra', 'cad', 17), render, { code: CODE });
    $('#rk-run').on('click', function () { p.set(frames($('#rk-t').val() || 'a', $('#rk-p').val() || 'a', Math.max(2, +$('#rk-m').val() || 17))); });
  })();
});

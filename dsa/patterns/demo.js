$(function () {
  'use strict';

  // ================================================================== pattern finder
  var CLUES = [
    ['sorted', 'The input is sorted (or sorting would not hurt)', ['Two pointers', 'Binary search']],
    ['contig', 'Contiguous subarray or substring', ['Sliding window', 'Prefix sums + hash map', 'Kadane / DP']],
    ['pairs', 'Find a pair / triplet with a target sum', ['Hash map (complement)', 'Sort + two pointers']],
    ['allcomb', 'All combinations, permutations, subsets, arrangements', ['Backtracking']],
    ['optimal', 'Count ways or find a min/max, choices overlap', ['Dynamic programming']],
    ['greedyok', 'A local best choice seems to never hurt (intervals, deadlines)', ['Greedy (prove it!)', 'Sort first']],
    ['shortest', 'Fewest steps / moves, all moves cost the same', ['BFS']],
    ['weighted', 'Cheapest path with costs on edges', ['Dijkstra', 'Bellman-Ford if negative', 'A* with a heuristic']],
    ['deps', 'Dependencies, prerequisites, build order', ['Topological sort', 'Cycle detection (DFS colours)']],
    ['groups', 'Connected groups, merging sets, "are these linked?"', ['Union-find', 'DFS / BFS components']],
    ['topk', 'Top k, k-th largest, median, merge k sorted', ['Heap', 'Quickselect', 'Bucket sort']],
    ['nextgreater', 'Next greater / smaller element, spans, histograms', ['Monotonic stack']],
    ['windowmax', 'Max / min of every window', ['Monotonic deque']],
    ['minmax', '"Minimise the maximum" / "smallest X that works"', ['Binary search on the answer']],
    ['rangeq', 'Many range queries with updates', ['Fenwick tree', 'Segment tree']],
    ['prefix', 'Words sharing prefixes, autocomplete', ['Trie']],
    ['tree', 'Input is a tree', ['DFS recursion (postorder template)', 'BFS level order']],
    ['grid', 'Input is a 2-D grid / maze', ['BFS / DFS on cells', 'Grid DP']],
    ['lookup', 'Fast lookup, de-duplication, counting', ['Hash map / set']],
    ['bits', 'Small n (≤ 20), subsets, XOR, parity', ['Bitmask enumeration / DP', 'Bit tricks']],
    ['scale', 'Huge data: distinct counts, membership, frequencies', ['HyperLogLog', 'Bloom filter', 'Count-Min sketch']],
    ['similar', 'Find similar items / vectors', ['MinHash + LSH', 'HNSW vector index']],
    ['intervals', 'Intervals / meetings / bookings', ['Sort by start or end + sweep', 'Heap of end times', 'Difference array']],
    ['cycle', 'Cycle in a linked list or functional graph', ['Fast and slow pointers (Floyd)']]
  ];
  var $c = $('#pf-clues');
  CLUES.forEach(function (c) { $('<label style="display:block;margin:.15rem 0">').append($('<input type="checkbox">').val(c[0]), ' ', document.createTextNode(c[1])).appendTo($c); });
  function suggest() {
    var picked = $c.find('input:checked').map(function () { return this.value; }).get(), score = {};
    CLUES.forEach(function (c) { if (picked.indexOf(c[0]) >= 0) c[2].forEach(function (t, i) { score[t] = (score[t] || 0) + (3 - Math.min(i, 2)); }); });
    var list = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
    var $o = $('#pf-out').empty();
    if (!list.length) { $o.text('Tick the clues that describe your problem.'); return; }
    $o.append($('<b>').text('Try: '), document.createTextNode(list.slice(0, 6).join(' → ')));
  }
  $c.on('change', 'input', suggest);
  suggest();

  // ================================================================== quiz
  var Q = [
    ['Longest substring with at most two distinct characters.', 'Sliding window with a count map: grow right, shrink left while more than 2 distinct. O(n).'],
    ['Given a sorted array, square each number and return the squares sorted.', 'Two pointers from both ends: the largest square is at one of the ends. Fill the output from the back. O(n).'],
    ['Minimum number of meeting rooms for a list of meetings.', 'Sort by start; min-heap of end times (or sweep sorted starts and ends). O(n log n).'],
    ['Number of ways to decode a digit string ("12" = "AB" or "L").', 'DP over prefixes: dp[i] uses dp[i-1] (one digit) and dp[i-2] (two digits). O(n).'],
    ['Can you finish all courses given prerequisite pairs?', 'Graph + topological sort (Kahn) or DFS cycle detection. O(V + E).'],
    ['Smallest eating speed to finish piles of bananas within h hours.', 'Binary search on the answer (speed) with a feasibility check. O(n log max).'],
    ['For each day, how many days until a warmer temperature?', 'Monotonic decreasing stack of indexes. O(n).'],
    ['Return all subsets of a set of distinct numbers.', 'Backtracking include/exclude (or bitmask enumeration). O(2^n · n).'],
    ['Minimum number of moves for a knight to reach a square.', 'BFS on board positions (implicit graph). O(cells).'],
    ['Find the k most frequent words.', 'Hash map of counts, then a heap of size k (or bucket sort by frequency). O(n log k).'],
    ['Are two accounts the same person if they share any email? Group them.', 'Union-find on emails (or DFS on an email graph). Nearly O(n).'],
    ['Number of subarrays whose sum equals k (values can be negative).', 'Prefix sums + hash map of counts of earlier prefix sums. O(n).'],
    ['Cheapest flight route with at most k stops.', 'Bellman-Ford limited to k+1 rounds, or Dijkstra over (city, stops) states.'],
    ['Find a cycle start in a linked list using O(1) memory.', 'Floyd fast/slow pointers, then reset one pointer to head. O(n).'],
    ['Autocomplete: return all stored words starting with a prefix.', 'Trie: walk the prefix, then collect the subtree. O(prefix + output).'],
    ['Sum of a range of an array that is frequently updated.', 'Fenwick tree or segment tree: O(log n) per update and query.'],
    ['Maximum value of items within a weight limit, each item usable once.', '0/1 knapsack DP over capacity, iterating capacity downwards. O(n·W).'],
    ['Merge all overlapping intervals.', 'Sort by start, then sweep and extend. O(n log n).'],
    ['Lowest common ancestor of two nodes in a binary tree.', 'Postorder recursion: return the node if found in both subtrees, else whichever side found something. O(n).'],
    ['Estimate the number of unique visitors among billions of events with 12 KB of memory.', 'HyperLogLog sketch (mergeable across servers). About 1% error.']
  ];
  var $q = $('#quiz'), right = 0, wrong = 0;
  Q.forEach(function (q, i) {
    var $d = $('<div class="quiz-q">').appendTo($q);
    $('<div>').append($('<b>').text((i + 1) + '. '), document.createTextNode(q[0])).appendTo($d);
    var $bar = $('<div class="bar">').appendTo($d);
    $('<button type="button">Show approach</button>').on('click', function () { $d.addClass('open'); $(this).prop('disabled', true); $bar.find('.sc').show(); }).appendTo($bar);
    $('<button type="button" class="sc" style="display:none">I had it</button>').on('click', function () { right++; $bar.find('.sc').prop('disabled', true); score(); }).appendTo($bar);
    $('<button type="button" class="sc" style="display:none">I missed it</button>').on('click', function () { wrong++; $bar.find('.sc').prop('disabled', true); score(); }).appendTo($bar);
    $('<div class="ans">').text(q[1]).appendTo($d);
  });
  function score() { $('#quiz-score').text('Score: ' + right + ' right, ' + wrong + ' to review, ' + (Q.length - right - wrong) + ' not yet attempted.'); }
  score();
});

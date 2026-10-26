SD.renderCase({
  slug: 'leaderboard',
  summary: 'A real-time leaderboard ranks millions of players by score and must answer three questions instantly: who is in the top 100, what is my rank and who is around me, and how do I compare with my friends, while tens of thousands of new scores arrive every second. A relational <code>COUNT(*) WHERE score &gt; ?</code> gets slower as the table grows; a Redis sorted set (a skip list plus hash) does each of these in O(log N). The design question is what happens beyond one sorted set: time-windowed boards (daily, weekly, season), sharding a 300-million-player board by score range or by user with scatter-gather for top-N, friends boards computed by fan-in, durable persistence so Redis can be rebuilt, and anti-cheat so the top of the board is real.',
  examples: 'Game leaderboards in Fortnite, Clash Royale, Candy Crush, Duolingo leagues, Strava segments, Peloton live rankings, Kaggle and coding contests (LeetCode, Codeforces), sales and fitness challenges; Azure PlayFab and AWS GameLift / GameSparks-style backends offer them as a service.',
  functional: ['Submit scores from matches; a board ranks by best score (or by cumulative points, depending on the board).', 'Top N (e.g. top 100) for a board, near real time.', 'My rank and the players directly above and below me (&ldquo;around me&rdquo;).', 'Time-windowed boards: daily, weekly, season, all-time; plus regional and friends boards.', 'Season end: freeze results, distribute rewards, archive.'],
  nonFunctional: ['Score visible on the board within 1 s of submission.', 'Reads p99 &lt; 50 ms; peak ~60,000 reads/s and ~30,000 score updates/s.', 'Durable: no accepted score is lost even if Redis fails; the board can be rebuilt.', 'Fair: cheated scores are removed quickly, and the top of the board is verified before rewards.', 'Scales to 300 M players on the all-time board.'],
  outOfScope: ['Matchmaking and game servers themselves (see multiplayer game backend).', 'Skill ratings (Elo/TrueSkill) used for matchmaking rather than display.'],
  estimates: [
    ['Players', '300 M total, 50 M DAU', 'A large mobile game'],
    ['Score updates', '500 M/day &asymp; 5,800/s average, ~30,000/s peak', '50 M DAU &times; 10 matches; evening and event peaks 5&times;'],
    ['Board writes', '~90,000 ZADD/s at peak', 'Each score goes to 3 active boards (daily, weekly, all-time); regional boards add more'],
    ['Leaderboard reads', '1 B/day &asymp; 11,600/s average, ~60,000/s peak', '50 M &times; 20 views per day'],
    ['All-time board memory', '~30 GB', '300 M members &times; ~100 B per sorted-set entry (skip-list node + hash entry + 8-byte member id)'],
    ['Daily + weekly boards', '~5 GB + ~10 GB', '50 M and ~100 M distinct players per window'],
    ['Rank lookup cost', '~28 skip-list levels, a few &micro;s', 'O(log N), log<sub>2</sub>(300 M) &asymp; 28'],
    ['Score event stream', '~6 MB/s at peak', '30,000 &times; ~200 B'],
    ['Durable score store', '~100 GB/year of best scores, ~20 TB/year of match history', 'Best score per user per board is small; full history is the bulk']
  ],
  compute: [
    ['Score service', '~20 instances of 4 vCPU', '30,000/s &times; ~1 ms CPU (verify signature, validation rules, pipelined ZADD to 3 boards, publish event) = 30 cores &rArr; 50 at 60% &rArr; 13; &times;1.5 to survive a zone loss.'],
    ['Leaderboard API', '~20 instances of 4 vCPU', '60,000/s &times; ~0.5 ms = 30 cores &rArr; same arithmetic. Top-100 responses cached in process for 1 s, so they cost almost nothing.'],
    ['Redis (all-time board)', '1 primary with 64 GB + 2 read replicas', 'One sorted set is one key and cannot be split across cluster slots: 30 GB fits a 64 GB node with room for fork-based persistence. ~30,000 ZADD/s plus rank reads is within one shard&rsquo;s ~100,000+ ops/s; replicas take around-me reads.'],
    ['Redis (windowed and regional boards)', '6-shard cluster, 16 GB per shard', 'Many smaller keys spread over slots; ~60,000 ZADD/s spread across shards.'],
    ['Durable score store', 'DynamoDB on-demand or ~6 Cassandra nodes', '30,000 writes/s of best-score upserts and match records.'],
    ['Anti-cheat stream processing', '~8 Flink slots + model endpoint', '30,000 events/s; per-player features (points per minute, win streaks) and an anomaly score per match.']
  ],
  api: [
    ['POST /v1/scores {matchId, userId, score, durationMs, signature}', 'From the authoritative game server (signed); idempotent on matchId; 202 Accepted with the new rank when cheap to compute.'],
    ['GET /v1/boards/{boardId}/top?limit=100', 'Top N with names and avatars; cached for ~1 s.'],
    ['GET /v1/boards/{boardId}/me?around=5', 'My rank, score and the 5 players above and below.'],
    ['GET /v1/boards/{boardId}/friends', 'My friends ranked on this board.'],
    ['Redis: ZADD lb:g1:alltime GT 1840 u42 / ZREVRANK / ZREVRANGE … WITHSCORES / ZMSCORE', 'The sorted-set commands behind each call (GT only raises a best score; ZINCRBY for cumulative boards).'],
    ['WebSocket leaderboard.top.changed {boardId, entries}', 'Optional live updates for a tournament screen, pushed at most once per second.']
  ],
  data: [
    ['board', 'Redis sorted set', 'Key <code>lb:{game}:{window}:{period}</code>, e.g. <code>lb:g1:weekly:2026-W44</code>; member user id; score = composite (points + tie-break); EXPIREAT a few days after the window ends.'],
    ['best scores', 'Key-value (DynamoDB / Cosmos DB)', 'PK user_id, SK board_id; best_score, achieved_at, match_id. Source of truth used to rebuild Redis.'],
    ['match results', 'Event stream &rarr; data lake', 'ScoreSubmitted {matchId, userId, score, duration, gameServerId, ts}; replayable for rebuilds and audits.'],
    ['friends', 'Social graph service', 'user_id &rarr; friend ids (typically &lt; 500).'],
    ['player status', 'Key-value', 'user_id &rarr; {status: ok | suspect | banned, reason}; suspects are hidden from public boards.'],
    ['season archive', 'Object storage + warehouse', 'Frozen final standings (top 10,000 exact, percentiles for the rest) and reward grants.']
  ],
  dbChoice: [
    ['Live rankings', 'Redis sorted sets', 'ZADD, ZREVRANK and ZREVRANGE are O(log N) (+ M returned); ranks stay fast at hundreds of millions of members; all in memory.', 'SQL with an index on score: top-N is fine, but rank = COUNT(*) WHERE score &gt; s scans a large index range (seconds at 300 M rows). DynamoDB has no rank operation.'],
    ['Durable scores', 'Key-value store + event log', 'Simple upserts keyed by user and board; the event log allows full replay; both rebuild Redis after a disaster.', 'Relying only on Redis AOF/RDB: good, but loses up to ~1 s on failover and is hard to audit.'],
    ['Season results and analytics', 'Warehouse / object storage', 'Batch queries, rewards, fraud audits.', 'Keeping old season keys in Redis: wastes memory.']
  ],
  diagram: {
    nodes: [['p', 'Players', 'mobile', 0, 1.3, 'game clients'], ['gs', 'Game servers', 'svc', 1, 0, 'authoritative results'], ['gw', 'API gateway', 'apigw', 1, 1.3, 'auth, rate limits'],
      ['ss', 'Score service', 'svc', 2.3, 0.4, 'validate, ZADD'], ['lb', 'Leaderboard API', 'svc', 2.3, 2.2, 'top, around me'], ['st', 'Score events', 'stream', 3.8, 0, 'Kafka / Event Hubs'],
      ['redis', 'Redis sorted sets', 'cache', 3.8, 1.3, 'per board / window'], ['fr', 'Friends graph', 'graph', 3.8, 2.9, 'social service'], ['ac', 'Anti-cheat', 'ml', 5.2, 0, 'rules + anomaly model'],
      ['db', 'Score store', 'nosql', 5.4, 1.3, 'best scores'], ['job', 'Window rotator', 'job', 5.4, 2.6, 'daily/weekly/season'], ['arch', 'Season archive', 'blob', 6, 3.5, 'final standings']],
    edges: [['p', 'gw'], ['gs', 'ss', 'signed score'], ['gw', 'lb'], ['ss', 'redis', 'ZADD'], ['ss', 'st', '', 'async'], ['st', 'ac', '', 'async'], ['st', 'db', 'persist', 'async'], ['lb', 'redis'], ['lb', 'fr'],
      ['ac', 'redis', 'ZREM'], ['job', 'redis'], ['job', 'arch']]
  },
  flows: [
    { name: 'Submit a score', desc: 'A match ends; the new score is on every active board within milliseconds and durable shortly after.', steps: [
      ['gs', 'ss', 'POST /scores (signed)', 'The authoritative game server, not the client, reports the score, signed with its service credential; matchId makes retries idempotent.'],
      ['ss', 'redis', 'ZADD GT ×3 (pipeline)', 'Validation rules pass (score possible for the match length). One pipeline writes to daily, weekly and all-time boards; GT keeps the best score; the tie-break is encoded in the score.'],
      ['redis', 'ss', 'ZREVRANK → 18,204', 'The new rank comes back in the same round trip (~1 ms).', 'resp'],
      ['ss', 'st', 'ScoreSubmitted', 'Every accepted score is an event: the durable record and the input to anti-cheat.', 'async'],
      ['ss', 'gs', '202 rank 18,204', 'The game shows “new personal best: #18,204”.', 'resp'],
      ['st', 'db', 'upsert best score', 'A consumer writes the best score per user and board to the key-value store, the source of truth for rebuilds.', 'async'],
      ['st', 'ac', 'score features', 'Anti-cheat scores the match asynchronously so it never delays the player.', 'async']],
      end: 'Redis gives instant ranks; the event log and score store make every score durable and replayable.' },
    { name: 'Top 100 and around me', desc: 'The leaderboard screen: the global top and the player’s own neighbourhood.', steps: [
      ['p', 'gw', 'GET /boards/weekly/top', 'The player opens the weekly board.'],
      ['gw', 'lb', 'route', 'Authenticated, rate limited.'],
      ['lb', 'redis', 'ZREVRANGE 0 99 WITHSCORES', 'Top 100 is the same for everyone, so the API caches it in process for 1 s: 60,000 views/s become a few Redis calls per second per instance.'],
      ['p', 'gw', 'GET /boards/weekly/me?around=5', 'The player’s own position.'],
      ['lb', 'redis', 'ZREVRANK, then r−5 … r+5', 'Rank r in O(log N), then the 11 entries around it; served from a read replica.'],
      ['redis', 'lb', 'rank 18,204 + neighbours', 'Ranks are 0-based in Redis: display r + 1. Equal scores share a rank only if the tie-break says so.', 'resp'],
      ['lb', 'p', 'board + names, avatars', 'Profile data is joined from a profile cache (batch MGET), never stored in the sorted set.', 'resp']],
      end: 'Cache what everyone sees (top N); compute what is personal (rank, neighbours) with O(log N) calls on replicas.' },
    { name: 'Friends leaderboard', desc: 'Rank me among my 180 friends: a fan-in read instead of a board per user.', steps: [
      ['p', 'gw', 'GET /boards/weekly/friends', 'The social tab.'],
      ['gw', 'lb', 'route', 'Same API tier.'],
      ['lb', 'fr', 'friends of u42', 'The social graph returns 180 friend ids (cached for a few minutes).'],
      ['fr', 'lb', '180 ids', 'Typical friend lists are small, which is what makes fan-in cheap.', 'resp'],
      ['lb', 'redis', 'ZMSCORE board 180 ids', 'One call fetches all 180 scores from the weekly board, O(F) hash lookups.'],
      ['redis', 'lb', 'scores', 'Missing friends simply have not played this week.', 'resp'],
      ['lb', 'p', 'sorted friends board', 'Sorting 180 numbers in the API is trivial. Global rank per friend is optional (180 × ZREVRANK, pipelined).', 'resp']],
      end: 'Compute friends boards on read from the global board: no fan-out to per-user boards on every score.' },
    { name: 'Cheater removed', desc: 'An impossible score reaches #1; anti-cheat removes it from public boards within seconds.', steps: [
      ['ss', 'redis', 'ZADD 9,999,999', 'A modified client found a way to make the game server report an absurd score; it passed the simple bounds check.', 'err'],
      ['ss', 'st', 'ScoreSubmitted', 'The event reaches anti-cheat.', 'async'],
      ['st', 'ac', 'features + model', 'Points per second 40× the 99.9th percentile, account created yesterday: anomaly score 0.98.', 'async'],
      ['ac', 'redis', 'ZREM from public boards', 'The player is moved to a shadow board: they still see themselves, others do not (makes probing the detector harder).', 'err'],
      ['ac', 'db', 'status = suspect', 'Flagged for human review; future scores skip public boards until cleared. Rewards for the top 100 are only granted after review.'],
      ['lb', 'redis', 'top 100 (next second)', 'The cached top list refreshes within a second without the cheater.']],
      end: 'Server-authoritative scores, fast asynchronous detection, shadow boards and review before rewards keep the top honest.' },
    { name: 'Redis primary fails', desc: 'The node holding the all-time board dies during peak.', steps: [
      ['ss', 'redis', 'ZADD (primary)', 'Writes to the primary fail.', 'err'],
      ['ss', 'redis', 'retry → promoted replica', 'Sentinel / cluster failover promotes a replica in ~5-15 s. Asynchronous replication may lose the last few hundred milliseconds of writes.', 'err'],
      ['ss', 'st', 'events still flowing', 'During failover the score service keeps publishing events and retries ZADD with backoff.', 'async'],
      ['st', 'db', 'durable as always', 'Every accepted score is in the event log and the score store regardless of Redis.', 'async'],
      ['job', 'redis', 'reconcile from db', 'A reconciler replays events from the failover window (idempotent ZADD GT), so lost writes reappear on the board.'],
      ['lb', 'redis', 'reads resume', 'Reads were served from the surviving replica throughout, slightly stale.']],
      end: 'Redis is the fast index, not the system of record: replay from the log makes failover lossless for players.' }
  ],
  components: [
    ['Game servers', 'Authoritative match results, signed submissions (never trust client-reported scores).'],
    ['Score service', 'Idempotency, validation, writes to all active boards, publishes score events.'],
    ['Leaderboard API', 'Top N (cached), rank and around-me, friends boards, profile join.'],
    ['Redis sorted sets', 'One sorted set per board and window; replicas for reads; AOF for fast restart.'],
    ['Score store + event stream', 'Durable best scores and full history; replay to rebuild or reconcile Redis.'],
    ['Anti-cheat', 'Rules and anomaly models over score events; shadow boards and review queues.'],
    ['Window rotator', 'Creates and expires daily/weekly/season keys, freezes and archives final standings, triggers rewards.']
  ],
  deep: [
    ['Redis sorted sets: the core commands', '<p>A sorted set stores members with a numeric score, kept in a skip list (ordered) plus a hash (member &rarr; score). Costs: ZADD, ZREM, ZREVRANK O(log N); ZREVRANGE O(log N + M); ZSCORE/ZMSCORE O(1) per member.</p>' +
      '<pre><code>ZADD lb:g1:weekly:2026-W44 GT 1840 u42      # keep best score only (Redis 6.2+)\nZINCRBY lb:g1:season:12 25 u42              # cumulative boards\nZREVRANGE lb:g1:weekly:2026-W44 0 99 WITHSCORES   # top 100\nZREVRANK lb:g1:weekly:2026-W44 u42          # 0-based rank, highest first\nZREVRANGE lb:g1:weekly:2026-W44 18199 18209 WITHSCORES  # around me\nZMSCORE lb:g1:weekly:2026-W44 u7 u9 u13     # friends\nZCOUNT lb:g1:weekly:2026-W44 (1840 +inf     # players strictly above a score</code></pre>' +
      '<p><strong>Ties:</strong> Redis orders equal scores by member string, which is arbitrary. To rank &ldquo;who got there first&rdquo; higher, encode a composite score in the double: <code>points &times; 10<sup>10</sup> + (9,999,999,999 &minus; epochSeconds)</code>. A double holds integers exactly up to 2<sup>53</sup> &asymp; 9 &times; 10<sup>15</sup>, so points must stay below ~900,000; use fewer time digits (e.g. seconds since season start) for larger scores.</p>'],
    ['Scaling one huge board: score ranges vs scatter-gather', '<p>One sorted set lives on one Redis node. When a board outgrows a node (memory or ops/s):</p><table><tr><th></th><th>Shard by score range</th><th>Shard by user hash + scatter-gather</th></tr><tr><td>Layout</td><td>Shard i holds scores in [b<sub>i</sub>, b<sub>i+1</sub>)</td><td>Each shard holds a random subset of users</td></tr><tr><td>Top N</td><td>Read only the highest shard</td><td>Top N from every shard, k-way merge (S &times; N entries)</td></tr><tr><td>My rank</td><td>ZREVRANK in my shard + cached ZCARD of all higher shards</td><td>&Sigma; ZCOUNT(score &gt; mine) over all S shards</td></tr><tr><td>Writes</td><td>A score crossing a boundary must ZREM in one shard and ZADD in another (not atomic)</td><td>Always one shard</td></tr><tr><td>Weakness</td><td>Skew: the top range is hot and boundaries drift as scores inflate; needs rebalancing</td><td>Rank queries fan out to every shard</td></tr></table><p>Before sharding, try: read replicas for rank reads, removing inactive players from the all-time board, and approximate ranks below the top million (next card).</p>'],
    ['Approximate rank for the long tail', '<p>Nobody needs to know they are #183,402,117 rather than #183,402,120. Keep exact sorted sets for the top ~1 M (where competition is real) and for everyone else show a percentile from a <strong>score histogram</strong>: buckets of score ranges with counts, updated by the stream processor. Rank &asymp; (players in higher buckets) + interpolation inside the bucket. This cuts memory from 30 GB to a few hundred MB plus the top set, and the top set is the only part under heavy write contention. Many games simply display &ldquo;Top 12%&rdquo; beyond the top 10,000.</p>'],
    ['Time-windowed boards and persistence', '<ul><li>One key per window: <code>lb:g1:daily:2026-10-26</code>, <code>lb:g1:weekly:2026-W44</code>, <code>lb:g1:season:12</code>. Each score is written to all active windows in one pipeline. Avoid computing weekly from dailies with ZUNIONSTORE on the hot path: it is O(N log N) over all members.</li><li>Use each player&rsquo;s or the game&rsquo;s time zone consistently; many games use a single global reset time (e.g. Monday 00:00 UTC) for fairness.</li><li>At window end the rotator freezes the key (writes go to the new window automatically because the key name contains the period), copies the final top standings to the archive, triggers rewards after anti-cheat review, and sets EXPIREAT a few days later.</li><li>Persistence: Redis replicas across zones and AOF (appendfsync everysec) for fast restarts; the event log and score store are the true record, and a rebuild is a bulk ZADD of best scores (~300 M entries load in minutes with pipelining).</li></ul>'],
    ['Anti-cheat', '<ol><li><strong>Never trust the client:</strong> the game server computes the score; client-only games submit replays or signed, server-verified sessions.</li><li><strong>Validation rules:</strong> maximum points per second, minimum match duration, monotonic progress, one submission per matchId, submission rate limits.</li><li><strong>Statistical detection:</strong> anomaly models on per-player features (score vs skill history, win streaks, input timing), device and account signals, clusters of accounts feeding each other.</li><li><strong>Response:</strong> shadow boards (cheaters see themselves, others do not), score rollback via the event log, bans with appeals.</li><li><strong>Before rewards:</strong> human or replay review of the top N, since that is where the incentive is.</li></ol>']
  ],
  scale: [
    '<strong>Hot key:</strong> the all-time board is one key on one node. Use replicas for reads, cache top N in the API, trim inactive members, and approximate ranks for the long tail before resorting to sharding.',
    '<strong>Write fan-out:</strong> each score updates several boards (windows &times; regions); pipeline them in one round trip and place different boards on different cluster slots.',
    '<strong>Read amplification:</strong> top-N is identical for all players: a 1 s in-process cache turns 60,000 reads/s into a few calls per second.',
    '<strong>Friends boards:</strong> fan-in with ZMSCORE on read; precomputing per-user boards would multiply writes by the friend count.',
    '<strong>Many games and events:</strong> each tournament is just another key; a Redis cluster spreads them across shards, and expired keys free memory automatically.'
  ],
  tradeoffs: [
    ['Ranking store', 'Redis sorted sets vs SQL index vs custom service', 'Redis: O(log N) rank queries and simple operations; SQL is fine for small boards (&lt; 1 M rows) or batch results.'],
    ['Exact vs approximate rank', 'Exact for everyone vs exact top + percentile tail', 'Exact for the top ~1 M, percentile for the rest: far less memory and write contention, no visible loss.'],
    ['Sharding a giant board', 'Score-range shards vs user-hash + scatter-gather', 'Score ranges when rank queries dominate; user hash when writes dominate and top N is the main read. Prefer replicas and approximation first.'],
    ['Friends boards', 'Fan-out on write (board per user) vs fan-in on read', 'Fan-in with ZMSCORE: friend lists are small and reads are rarer than writes.'],
    ['Consistency', 'Synchronous DB write before ZADD vs event-driven persistence', 'Write to Redis and the event log synchronously, persist to the store asynchronously; reconcile from the log after failures.']
  ],
  failures: [
    ['Redis primary fails', 'Replica promotion in seconds; reads from replicas; replay events from the failover window (ZADD GT is idempotent).'],
    ['Whole Redis cluster lost', 'Rebuild from the score store with pipelined bulk ZADD; show cached top N meanwhile.'],
    ['Duplicate submissions (retries)', 'Idempotency on matchId; ZADD GT and best-score upserts are naturally idempotent.'],
    ['Cheated scores', 'Server-authoritative scoring, rules, anomaly detection, shadow boards, review before rewards, rollback from the event log.'],
    ['Window reset at the wrong time', 'Period derived from a single configured reset time in the key name; rotator is idempotent and monitored.'],
    ['Hot board overload during a tournament', 'Top-N caching, replicas, rate limits on refreshes, live updates pushed at most once per second.']
  ],
  cloud: [['Game backend services', 'games'], ['API gateway', 'apigw'], ['Score and leaderboard services', 'containers'], ['Sorted sets', 'cache'], ['Durable score store', 'nosql'], ['Score events', 'stream'], ['Anti-cheat stream features', 'streamproc'],
    ['Anomaly model', 'ml'], ['Friends graph', 'graph'], ['Window rotation jobs', 'scheduler'], ['Season archive', 'blob'], ['Analytics and audits', 'warehouse'], ['Live tournament updates', 'realtime'], ['Player identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azGaming', 'azCaching', 'azp-cache-aside', 'azp-cqrs', 'azp-sharding', 'azp-materialized-view', 'azp-event-sourcing', 'azPartition'],
          aws: ['awsGamesLens', 'awsGameAnalytics', 'awsCaching', 'awsScatter', 'awsDdbBest', 'awsEventSourcing'] },
  questions: [
    ['Why not compute ranks in SQL?', 'Rank needs COUNT(*) of rows with a higher score, which scans an index range proportional to the rank: seconds at hundreds of millions of rows under heavy writes. A sorted set keeps rank information in its skip list, so ZREVRANK is O(log N).'],
    ['How do you show players around me?', 'r = ZREVRANK(board, me), then ZREVRANGE(board, r &minus; 5, r + 5) WITHSCORES; two O(log N) calls, served from a replica.'],
    ['How do you handle ties?', 'Encode a tie-break into the score (points &times; 10<sup>k</sup> + inverted timestamp) within the 2<sup>53</sup> exact-integer range of a double, or keep a secondary sort in the API for the few entries shown.'],
    ['What if one sorted set gets too big?', 'First add read replicas, trim inactive players and switch to percentile ranks beyond the top million. Then shard by score range (cheap ranks, skewed writes) or by user hash with scatter-gather (cheap writes, fan-out ranks).'],
    ['How do you build a friends leaderboard?', 'Fetch friend ids from the social graph and read their scores with one ZMSCORE on the global board, then sort in the API. Per-user friend boards would require fan-out on every score.'],
    ['How do you stop cheaters?', 'Scores come from authoritative servers, are validated and rate limited, analysed by anomaly models, and suspicious players are moved to shadow boards; top players are reviewed before rewards, and the event log allows rollbacks.']
  ],
  related: ['multiplayer-game', 'distributed-cache', 'kv-store', 'rate-limiter', 'ad-click']
});

SD.renderCase({
  slug: 'multiplayer-game',
  summary: 'An online multiplayer game backend has two halves with very different physics. The <strong>real-time half</strong> is a fleet of <strong>authoritative dedicated game servers</strong>: each match runs as one process that owns the truth, steps the simulation at a fixed <strong>tick rate</strong> (30-128 Hz), receives player inputs over <strong>UDP</strong> and sends back compressed state snapshots, while clients hide latency with <strong>prediction</strong> and <strong>interpolation</strong> and the server is fair to laggy shooters through <strong>lag compensation</strong>. The <strong>platform half</strong> is ordinary, if bursty, cloud services: <strong>matchmaking</strong> turns players’ <em>tickets</em> into fair, low-latency matches using skill ratings and ping measurements, a <strong>session allocator</strong> places each match on a ready server in the right <strong>regional fleet</strong> (GameLift, PlayFab Multiplayer Servers or Agones on Kubernetes), and back-end services persist profiles, inventory, match results and <strong>leaderboards</strong>, with <strong>anti-cheat</strong> watching both the servers and the telemetry.',
  examples: 'Fortnite, Valorant, Counter-Strike 2, Apex Legends, Call of Duty, Rocket League, Halo Infinite (on Azure PlayFab), and many studios on Amazon GameLift, PlayFab Multiplayer Servers, Agones + Open Match, Unity Multiplay or Edgegap.',
  functional: ['Sign in through platform accounts (Steam, Xbox, PlayStation, Epic) and keep one cross-platform profile.', 'Queue solo or as a party for a mode; get a fair match in under a minute with low ping.', 'Play a real-time match on an authoritative server; reconnect after a drop.', 'Persist progression: XP, ranks (MMR), inventory, currency and match history.', 'Seasonal and friends leaderboards.', 'Detect and punish cheating; report players.'],
  nonFunctional: ['Round-trip latency to the game server &lt; 60 ms for most players (region choice), tick rate 64 Hz for competitive modes.', 'Matchmaking median wait &lt; 30 s, with match quality (skill spread) bounded.', 'Session allocation &lt; 2 s from match found to server ready.', 'Survive launch-day spikes of 5-10&times; normal concurrency without long queues.', 'Never lose purchased items or earned progress; never duplicate currency.', 'Cost-efficient fleets: game servers are the biggest bill, so pack and autoscale tightly.'],
  outOfScope: ['Game client rendering and engine internals.', 'Store front and payment provider integration (see payment).', 'Voice chat (see video-conferencing).'],
  estimates: [
    ['Peak concurrent users (CCU)', '3 million', 'Popular competitive shooter at evening peak; launch or event days up to 2-3&times; more'],
    ['Players in matches', '~2.7 million', '~90% of CCU; the rest in menus and queues'],
    ['Concurrent matches', '~270,000', '5v5 = 10 players per match'],
    ['Match starts', '~150 matches/s, ~1,500 players/s into matchmaking', '270 K matches / 1,800 s (30-minute matches)'],
    ['Tick rate and packets', '64 Hz; ~170 M packets/s each way', '2.7 M players &times; 64 snapshots/s'],
    ['Bandwidth per player', '~100 kbit/s down, ~30 kbit/s up', 'Delta-compressed snapshots ~200 B &times; 64/s; inputs ~60 B &times; 64/s including the last 3 inputs for loss resilience'],
    ['Total game-server egress', '~270 Gbit/s', '2.7 M &times; 100 kbit/s'],
    ['Player data', '~100 M accounts &times; ~20 KB = 2 TB', 'Profiles, MMR per mode, inventory, settings'],
    ['Persistence writes', '~1,500-3,000 writes/s at peak', '150 matches/s &times; 10 players &times; 1-2 documents (profile/progression, match history)'],
    ['Gameplay telemetry', '~750 K events/s', '~5,000 events per match (kills, shots, positions sampled) &times; 150 matches/s']
  ],
  compute: [
    ['Game server fleet', '~13,000 hosts of 16 vCPU across ~10 regions', 'A 5v5 match at 64 Hz needs ~0.5 vCPU: 24 match processes per 16-vCPU host at ~75% CPU &rArr; 270 K / 24 = 11,250 hosts; plus ~15% ready buffer for spikes and allocation speed &asymp; 13,000. Spot/preemptible capacity for casual modes cuts cost 50-70%.'],
    ['Matchmaker', '~4 nodes per region (stateless) + Redis', '1,500 tickets/s globally; each region runs a match function over its pools every ~1 s; CPU is small, correctness and fairness are the work.'],
    ['Session allocator / fleet manager', 'Managed (GameLift queues, PlayFab) or Agones controllers per cluster', '150 allocations/s; each claims a Ready server in &lt; 1 s; the autoscaler keeps a buffer of Ready servers per region (e.g. 10% or 2,000 servers).'],
    ['Player services (API)', '~40 pods &times; 4 vCPU per region pair', '~50 K req/s at peak (profile, inventory, friends, store) &times; ~3 ms CPU = 150 cores &rArr; ~250 at 60%. Patch-day login storms: 3 M logins in 30 min &asymp; 1.7 K/s, gated by a login queue.'],
    ['Player database', 'NoSQL, ~60 K RU/s or on-demand', '50 K reads/s (mostly cached) + 3 K writes/s of ~5 KB documents.'],
    ['Leaderboards', 'Redis cluster, 3 shards + replicas', '50 M ranked players &times; ~100 B per sorted-set entry &asymp; 5 GB per season; ~1.5 K ZADD/s, rank queries O(log N).']
  ],
  api: [
    ['POST /auth/platform {provider, platformToken}', 'Exchange a Steam/Xbox/PSN/Epic token for a game session JWT; links platform ids to one player id.'],
    ['POST /matchmaking/tickets {mode, partyId, latencies{region: ms}}', 'Create a ticket. Latencies come from client pings to per-region QoS beacons. Returns ticketId; status via push.'],
    ['ws: MatchFound {ip, port, playerSessionToken}', 'Pushed over the client’s notification WebSocket when the match is placed; the token is single-use and bound to player and session.'],
    ['UDP ClientInput {seq, tick, buttons, aim, prev3}', 'Sent every tick; redundant copies of the last inputs survive packet loss without retransmission.'],
    ['UDP ServerSnapshot {tick, ackSeq, baseTick, entities Δ}', 'State delta relative to the last snapshot the client acknowledged; only entities relevant to that player.'],
    ['POST /matches/{id}/result (server-signed)', 'Called only by game servers with a fleet credential: per-player stats and outcome; idempotent by match id.'],
    ['GET /leaderboards/{season}/{board}?around=me&n=50', 'Top N or the window around the caller’s rank.']
  ],
  data: [
    ['players', 'NoSQL document store (Cosmos DB / DynamoDB), partition player_id', 'Profile, linked platform ids, MMR per mode (mu, sigma for Glicko-2/TrueSkill), XP, cosmetics inventory, settings; ETag for optimistic concurrency.'],
    ['wallet + purchases', 'Relational DB (ledger)', 'Double-entry ledger of currency grants and spends with idempotency keys; inventory grants from purchases in the same transaction.'],
    ['matchmaking tickets', 'Redis', 'Sorted set per (region, mode) scored by MMR; hash per ticket: party members, latencies, created_at; TTL 5 min.'],
    ['game sessions', 'Fleet manager store (GameLift / Agones CRDs) + Redis', 'session_id &rarr; server ip:port, region, players, state (Ready, Allocated, Active, Ended), started_at.'],
    ['match history', 'NoSQL, partition player_id, sort key ended_at', 'Per-player summary rows written on match end; full match records in the data lake.'],
    ['leaderboards', 'Redis sorted sets', 'lb:{season}:{board} &rarr; player_id score; friends boards computed on read from friend list (small N); snapshotted to the DB hourly.'],
    ['telemetry', 'Event stream &rarr; data lake', 'Match events for analytics, balancing and anti-cheat models; partitioned by date and match id.']
  ],
  dbChoice: [
    ['Player profiles and progression', 'Key-value / document NoSQL partitioned by player id', 'Every access is by player id; predictable single-digit-ms latency at any scale; flexible schema for game updates.', 'Sharded SQL: fine, more operational work; relational joins are rarely needed here.'],
    ['Currency and purchases', 'Relational with ACID transactions', 'Money-like data: double-entry, idempotency, audit; duplication exploits are a real attack.', 'NoSQL transactions are possible but harder to audit and reconcile.'],
    ['Tickets and leaderboards', 'Redis (sorted sets)', 'Range queries by score (MMR windows, ranks) in O(log N); ephemeral or rebuildable.', 'SQL ORDER BY with indexes: rank-of-player queries get slow at 50 M rows.'],
    ['Telemetry', 'Streaming + data lake', 'Huge append-only volume analysed in batch and by ML.', 'Operational DB: far too expensive for this volume.']
  ],
  diagram: {
    nodes: [['p', 'Players', 'client', 0, 1.8, 'PC, console, mobile'], ['gw', 'API gateway', 'apigw', 1, 0.8, 'HTTPS, auth'], ['mm', 'Matchmaker', 'svc', 2, 0.3, 'skill + latency rules'],
      ['tk', 'Ticket pool', 'cache', 2, 1.3, 'Redis, by region'], ['al', 'Session placement', 'svc', 3, 0.3, 'queues per region'], ['fl', 'Fleet manager', 'svc', 4, 0.3, 'GameLift / Agones'],
      ['gs', 'Game servers', 'svc', 4, 1.8, 'authoritative, 64 Hz'], ['ps', 'Player services', 'svc', 2, 2.8, 'profile, inventory'], ['lb', 'Leaderboards', 'cache', 3, 2.3, 'Redis sorted sets'],
      ['pdb', 'Player data', 'nosql', 3, 3.3, 'by player id'], ['ev', 'Match events', 'stream', 5, 1.8, 'results, telemetry'], ['ac', 'Anti-cheat', 'ml', 6, 1.8, 'server-side models'],
      ['rw', 'Results worker', 'worker', 5, 3.0, 'XP, MMR, rewards']],
    edges: [['p', 'gw'], ['gw', 'mm'], ['mm', 'tk'], ['mm', 'al'], ['al', 'fl'], ['fl', 'gs', 'allocate'], ['p', 'gs', 'UDP inputs/snapshots'], ['gw', 'ps'], ['ps', 'lb'], ['ps', 'pdb'],
      ['gs', 'ev', '', 'async'], ['ev', 'ac', '', 'async'], ['ev', 'rw', '', 'async'], ['rw', 'pdb'], ['rw', 'lb']]
  },
  flows: [
    { name: 'Matchmaking', desc: 'A party of two queues for ranked 5v5: from ticket to a server in a few seconds.', steps: [
      ['p', 'gw', 'POST /matchmaking/tickets', 'The client first pings QoS beacons in nearby regions and includes the results: {eu-west: 28 ms, eu-central: 35 ms}.'],
      ['gw', 'mm', 'create ticket', 'The matchmaker validates the party (both members online, eligible for ranked) and computes a party MMR.'],
      ['mm', 'tk', 'ZADD pool:eu-west:ranked', 'The ticket joins the pool for every region within the latency limit; it can only be matched once (claimed atomically).'],
      ['mm', 'tk', 'scan MMR window ±50', 'Every second the match function looks for 10 compatible players: similar skill, all under 60 ms to the region, parties split across teams fairly. The window widens with wait time (±200 after 60 s).'],
      ['tk', 'mm', '10 tickets claimed', 'Teams are balanced to minimise the predicted win-probability gap.', 'resp'],
      ['mm', 'al', 'place match in eu-west', 'The placement queue prefers the region with the best worst-case latency for the ten players, falling back to the next region if capacity is short.'],
      ['al', 'fl', 'allocate Ready server', 'Claim a pre-warmed server process (Agones GameServerAllocation, GameLift game session placement); no cold start.'],
      ['fl', 'gs', 'session config + player tokens', 'The server loads the map and mode, and learns which 10 player tokens may connect.'],
      ['gw', 'p', 'MatchFound {ip, port, token}', 'Pushed to all ten clients; they connect directly over UDP.', 'resp']],
      end: 'Match quality versus wait time is the core trade-off: rules start strict and relax over time. A warm buffer of Ready servers keeps allocation under a second.' },
    { name: 'Gameplay tick and lag compensation', desc: 'One shot in a 64 Hz authoritative match, with 40 ms ping.', steps: [
      ['p', 'gs', 'ClientInput seq 812', 'The client sends its input for this tick and immediately applies it locally (prediction), so movement feels instant.'],
      ['gs', 'p', 'Snapshot tick 1204, ack 812', 'Every 15.6 ms the server applies all queued inputs, steps physics, and sends each player a delta snapshot of relevant entities.', 'resp'],
      ['p', 'gs', 'fire at tick 1201 (as seen)', 'The player shoots at an enemy as rendered: other players are shown ~2 ticks in the past (interpolation buffer) plus half the RTT.'],
      ['gs', 'p', 'hit confirmed', 'The server rewinds other players’ hitboxes to where this player saw them (lag compensation, capped at ~200 ms), checks the ray, and applies damage in the current tick.', 'resp'],
      ['gs', 'ev', 'kill event', 'Kills, damage and positions are emitted for stats, replays and anti-cheat.', 'async']],
      end: 'The server is the only source of truth; prediction hides your own latency, interpolation smooths others, and lag compensation makes hits fair for the shooter.' },
    { name: 'Match end and progression', desc: 'The match finishes: results must be persisted exactly once and leaderboards updated.', steps: [
      ['gs', 'ev', 'MatchResult (signed, match id)', 'The server publishes the authoritative result: winners, per-player stats, duration. Clients never report results.', 'async'],
      ['ev', 'rw', 'consume', 'A results worker processes each match; the match id is the idempotency key, so a redelivered event changes nothing.', 'async'],
      ['rw', 'pdb', 'update MMR, XP, history', 'Glicko-2/TrueSkill updates for each player, XP and reward grants, a match-history row, each conditioned on ETag and on “match id not yet applied”.'],
      ['rw', 'lb', 'ZADD lb:s12:ranked', 'Leaderboard scores updated; friends boards are computed on read.'],
      ['ev', 'ac', 'match telemetry', 'Aim, reaction-time and movement statistics feed server-side detection models.', 'async'],
      ['p', 'gw', 'GET /leaderboards?around=me', 'Back in the menu, the player opens the leaderboard.'],
      ['gw', 'ps', 'rank query', 'ZREVRANK + ZREVRANGE around the player’s rank: O(log N) on 50 M entries.'],
      ['ps', 'p', 'rank 18,204 (top 4%)', 'Fresh within seconds of the match ending.', 'resp']],
      end: 'Game servers emit facts; asynchronous, idempotent consumers turn them into progression. That keeps the real-time loop free of database calls.' },
    { name: 'Game server crash', desc: 'The host running 24 matches fails mid-game.', steps: [
      ['gs', 'p', 'snapshots stop', 'Clients stop receiving snapshots; after ~3-5 s they show “connection lost” and attempt to reconnect.', 'err'],
      ['fl', 'gs', 'health check failed', 'The fleet manager sees missed heartbeats (Agones SDK health pings / GameLift process health) and marks the sessions dead.', 'err'],
      ['fl', 'al', 'sessions ended abnormally', 'Placement is told the matches ended without a result.'],
      ['al', 'ev', 'MatchAborted (server fault)', 'An aborted event means no MMR loss for anyone and no leaver penalty.', 'async'],
      ['gw', 'p', 'requeue with priority', 'Players are offered a priority requeue. Short matches are not checkpointed: restarting is cheaper than replicating state 64 times a second.', 'resp'],
      ['fl', 'gs', 'replace capacity', 'The fleet autoscaler replaces the host to restore the Ready buffer; spot interruptions get a 2-minute warning used to stop allocating new matches there.']],
      end: 'In-memory match state is accepted as losable for 30-minute matches; long-lived worlds (MMOs, survival games) checkpoint to storage every few seconds or minutes instead.' }
  ],
  components: [
    ['API gateway + player services', 'Platform sign-in, profiles, inventory, friends, store, leaderboards; standard autoscaled web services.'],
    ['Matchmaker', 'Ticket intake, pools by region and mode, rule-based match functions (skill, latency, party, role), team balancing, backfill.'],
    ['Session placement + fleet manager', 'Choose a region and allocate a Ready game server; scale fleets on Ready-buffer targets; handle spot interruptions and draining.'],
    ['Authoritative game servers', 'Fixed-tick simulation, input processing, snapshot delta compression, interest management, lag compensation, cheat validation.'],
    ['Results pipeline', 'Idempotent consumers apply match results to MMR, XP, rewards, history and leaderboards.'],
    ['Anti-cheat', 'Server-side validation in the game loop, statistical/ML detection on telemetry, client-side anti-cheat integration, ban service.'],
    ['Telemetry and analytics', 'Gameplay events to a data lake for balancing, live-ops dashboards and model training.']
  ],
  evolutionTitle: 'From friends hosting to global fleets',
  evolution: [
    { name: '1. Listen server / P2P', desc: 'One player’s machine hosts the match. Free, but the host has zero latency and can cheat; if they quit, the match ends.', diagram: { nodes: [['h', 'Host player', 'client', 0, 0.5, 'runs the game'], ['a', 'Player 2', 'client', 1.5, 0], ['b', 'Player 3', 'client', 1.5, 1.1], ['r', 'Relay / NAT punch', 'svc', 3, 0.5]], edges: [['a', 'h'], ['b', 'h'], ['a', 'r', '', 'none']] },
      steps: [['a', 'h', 'inputs', 'Everyone sends to the host.'], ['b', 'h', 'inputs', 'Host upload and fairness limit this to small casual games.'], ['a', 'r', 'relay if NAT fails', 'A relay helps when direct connections fail.']] },
    { name: '2. Static dedicated servers', desc: 'Rented servers in a few data centres, players pick from a server browser.', diagram: { nodes: [['p', 'Players', 'client', 0, 0.5], ['br', 'Server browser', 'svc', 1.5, 0], ['g', 'Dedicated servers', 'svc', 1.5, 1.1, 'always on']], edges: [['p', 'br'], ['p', 'g']] },
      steps: [['p', 'br', 'list servers', 'Players choose by ping and player count.'], ['p', 'g', 'connect UDP', 'Authoritative and fair, but capacity is fixed: idle at 4 am, full at 8 pm, and no skill-based matching.']] },
    { name: '3. Matchmaking + autoscaled fleets', desc: 'Tickets and skill-based matching, with session placement onto autoscaled regional fleets.', diagram: { nodes: [['p', 'Players', 'client', 0, 0.6], ['m', 'Matchmaker', 'svc', 1.3, 0], ['f', 'Fleets (regions)', 'svc', 2.6, 0, 'Ready buffer'], ['g', 'Game server', 'svc', 2.6, 1.2]], edges: [['p', 'm'], ['m', 'f'], ['f', 'g'], ['p', 'g']] },
      steps: [['p', 'm', 'ticket + pings', 'Players queue for a mode.'], ['m', 'f', 'place match', 'The best region for the group is chosen.'], ['f', 'g', 'allocate Ready', 'Warm servers; fleets scale with demand and on spot capacity.'], ['p', 'g', 'play', 'Fair, low-latency, cost tracks players.']] }
  ],
  deep: [
    ['Matchmaking: tickets, skill and latency', '<p>A <strong>ticket</strong> represents a solo player or party: player ids, mode, skill, latencies per region, and constraints (input device, cross-play, role). Frameworks such as Open Match (frontend, director, match functions, evaluator), GameLift FlexMatch and PlayFab Matchmaking all follow this shape.</p><ul><li><strong>Skill</strong>: Elo is the classic; Glicko-2 and TrueSkill 2 track uncertainty (sigma) so new players move fast. Match on the conservative estimate (mu - k&middot;sigma) or on predicted win probability.</li><li><strong>Latency</strong>: only regions under a threshold (e.g. 60 ms) for every member; prefer the region minimising the worst member’s ping.</li><li><strong>Relaxation</strong>: start strict, widen the skill window and latency limit with wait time; high-skill players accept longer waits because the pool is small.</li><li><strong>Fairness</strong>: split parties across teams to balance, avoid premade 5-stacks against solos, and backfill leavers mid-match only in casual modes.</li><li><strong>Concurrency</strong>: claim tickets atomically (Lua script in Redis or a single match function per pool) so a ticket is never in two matches.</li></ul>'],
    ['Authoritative servers, tick rate and networking', '<p>The server runs a fixed-timestep loop: drain inputs, simulate one tick, then build per-client snapshots. Tick rate drives cost and feel:</p><table><tr><th>Tick rate</th><th>Tick time</th><th>Typical</th></tr><tr><td>20-30 Hz</td><td>33-50 ms</td><td>Battle royale with 100 players (Fortnite 30 Hz), MMOs</td></tr><tr><td>60-64 Hz</td><td>~16 ms</td><td>Competitive shooters (CS2 with sub-tick input timestamps)</td></tr><tr><td>128 Hz</td><td>~8 ms</td><td>Valorant, esports servers: ~2&times; CPU and bandwidth of 64 Hz</td></tr></table><p>Bandwidth is kept small by <strong>delta compression</strong> against the last acknowledged snapshot, <strong>quantisation</strong> (positions to centimetres, angles to 16 bits) and <strong>interest management</strong> (only entities a player can see or hear, using grids or potentially-visible sets). Transport is <strong>UDP</strong> with a thin custom layer (or ENet, Steam Networking Sockets, QUIC datagrams): unreliable sequenced packets for state, a reliable ordered channel for events like chat or purchases, plus connection tokens, encryption and DDoS protection on the server’s public endpoint.</p>'],
    ['Client prediction, reconciliation and lag compensation', '<pre><code>// client, every tick\ninput = sample(); send(input, seq++)\npending.push(input); applyLocally(input)          // prediction\n\non snapshot(s):\n  state = s.authoritativeStateFor(me)              // server truth at s.ackSeq\n  pending = pending.filter(i =&gt; i.seq &gt; s.ackSeq)\n  for i in pending: state = simulate(state, i)     // reconciliation (replay)\n  others.renderAt(now - interpDelay)               // interpolation ~2 ticks\n\n// server, on fire(input with clientTick)\nrewindTo = clamp(clientTick - interpDelay, now - 200ms)\nhit = raycast(historyOfHitboxes[rewindTo])        // lag compensation</code></pre><p>Prediction makes your own movement instant; reconciliation corrects mistakes smoothly when the server disagrees; interpolation shows other players slightly in the past for smooth motion; lag compensation means you hit what you saw. The cost is “shot around the corner”: the victim may die just after reaching cover, which is why rewind is capped.</p>'],
    ['Session allocation on dedicated server fleets', '<ul><li><strong>Amazon GameLift</strong>: fleets of instances per region running your server build; game session queues place matches across fleets with latency policies; FleetIQ and spot fleets for cost; FlexMatch for matchmaking.</li><li><strong>Azure PlayFab Multiplayer Servers</strong>: container or process-based builds across Azure regions with a pool of <em>standby</em> servers per region; request a server, get ip:port in ~1 s.</li><li><strong>Agones</strong> on AKS/EKS/GKE: GameServer and Fleet custom resources, a FleetAutoscaler that keeps a buffer of Ready servers, and GameServerAllocation to move one from Ready to Allocated atomically; the game calls the Agones SDK for Ready, Health and Shutdown.</li></ul><p>Common rules: pre-warm (images pulled, maps loaded), keep a Ready buffer sized to a few minutes of match starts, pack many matches per host, drain hosts gracefully (no new allocations, finish running matches), and use spot for casual queues with interruption handling. Regional fleets in ~10 regions keep most players under 60 ms; on-premises or bare-metal for baseline plus cloud for peaks is common at very large scale.</p>'],
    ['Anti-cheat, persistence and economy integrity', '<p><strong>Never trust the client.</strong> The authoritative server validates movement speed, fire rate, ammunition, line of sight, and cooldowns. Wallhacks exploit information the client receives, so interest management (not sending hidden enemies’ positions) is itself anti-cheat. Server-side detection models over telemetry (aim snap angles, reaction times, impossible tracking) flag accounts for review or automated bans in delayed waves so cheat makers cannot tell what triggered them. Client-side anti-cheat (Easy Anti-Cheat, BattlEye, Vanguard) catches memory tampering at the cost of privacy and compatibility concerns.</p><p><strong>Persistence</strong>: only game servers (with fleet credentials) may submit results, each signed and idempotent by match id. Inventory and currency changes go through server-side services with idempotency keys and a double-entry ledger, which blocks duplication exploits and makes reconciliation with platform stores possible.</p>']
  ],
  scale: [
    '<strong>Launch-day spikes:</strong> pre-provision fleets with reserved capacity, use a login queue to admit players at a sustainable rate, and scale fleets on the Ready-buffer metric, not CPU.',
    '<strong>Matchmaker hot pools:</strong> partition pools by region and mode, and by skill band for the largest pools; one match function per partition avoids double-claiming.',
    '<strong>Game server cost:</strong> pack matches per host, right-size tick rate per mode, use spot for casual modes, and shut down empty capacity aggressively off-peak (Ready buffer as a percentage).',
    '<strong>Database hot spots:</strong> results writes are spread by player id; leaderboard writes are batched; a season reset is a new sorted-set key, not a mass update.',
    '<strong>Global reach:</strong> add regions where players have &gt; 80 ms to the nearest fleet; use edge relays or premium network tiers to cut jitter where adding a region is too costly.'
  ],
  tradeoffs: [
    ['Server authority', 'Peer-to-peer / client authority vs dedicated authoritative servers', 'Authoritative servers for anything competitive: fairness and anti-cheat; P2P only for small co-op games where cost dominates.'],
    ['Tick rate', '30 vs 64 vs 128 Hz', '64 Hz for competitive 5v5; 30 Hz for 100-player modes. Doubling the tick rate roughly doubles CPU and bandwidth cost.'],
    ['Match quality vs wait time', 'Strict skill/latency windows vs fast matches', 'Start strict, relax with time, and tune per skill band; measure both median wait and predicted win-probability gap.'],
    ['Fleet platform', 'GameLift / PlayFab managed vs Agones on Kubernetes vs bare metal', 'Managed for most studios; Agones when you want portability across clouds and on-prem; bare metal plus cloud burst only at very large steady scale.'],
    ['Match state durability', 'Checkpoint state vs accept loss on crash', 'Accept loss for short matches (requeue without penalty); checkpoint for persistent worlds.']
  ],
  failures: [
    ['Game server or host crash', 'Health checks end the session; aborted match with no MMR loss; priority requeue; autoscaler restores the Ready buffer.'],
    ['Region capacity exhausted', 'Placement falls back to the next region within the latency limit; the autoscaler adds hosts; queue ETAs shown to players.'],
    ['Matchmaker failure', 'Stateless match functions restart; tickets live in Redis with TTL; clients re-submit tickets on timeout.'],
    ['DDoS on game server IPs', 'Provider DDoS protection, server IPs revealed only to matched players, relays/proxies in front for high-profile matches.'],
    ['Duplicate or lost results', 'Results published with match id; idempotent consumers; outbox on the game server side with retries.'],
    ['Cheat outbreak', 'Rapid server-side rule updates, statistical detection, ban waves, replay review; hardware/account-level bans for repeat offenders.'],
    ['Patch-day login storm', 'Login queue with position and ETA, cached entitlements, back-pressure on the player DB.']
  ],
  cloud: [['Game server hosting (managed)', 'games'], ['Game servers on Kubernetes (Agones)', 'k8s'], ['Dedicated hosts / VMs', 'vms'], ['DDoS protection', 'ddos'], ['API gateway', 'apigw'], ['Player sign-in', 'identity'],
    ['Player profiles and inventory', 'nosql'], ['Wallet and purchases ledger', 'sql'], ['Tickets and leaderboards', 'cache'], ['Match events and telemetry', 'stream'], ['Real-time notifications (MatchFound)', 'realtime'],
    ['Analytics and data lake', 'warehouse'], ['Anti-cheat models', 'ml'], ['Patch and asset downloads', 'cdn'], ['Container images for server builds', 'registry'], ['Monitoring', 'monitor']],
  refs: { az: ['azGaming', 'azAutoscale', 'azp-competing-consumers', 'azp-queue-based-load-leveling', 'azp-sharding', 'azEventDriven', 'azMission', 'azAksBaseline'],
          aws: ['awsGamesLens', 'awsGameAnalytics', 'blShuffle', 'blStatic', 'awsDdbBest', 'blShedding', 'awsCaching'] },
  questions: [
    ['Why UDP rather than TCP or WebSockets?', 'Game state is superseded every tick: a lost snapshot is better skipped than retransmitted, and TCP’s in-order delivery would stall all later snapshots behind it (head-of-line blocking). UDP plus a small custom reliability layer for the few messages that must arrive gives the lowest, most consistent latency.'],
    ['How do you stop wallhacks?', 'Do not send the information: server-side interest management only replicates enemies that are visible or audible (with a small margin for latency). What the client never receives cannot be revealed by a hack. Client anti-cheat and statistical detection cover the rest.'],
    ['How does lag compensation work, and what does it cost?', 'The server keeps a short history of hitbox positions; when a shot arrives it rewinds others to where the shooter saw them (their tick minus interpolation delay), tests the hit, then applies damage now. The cost is victims occasionally being hit just after reaching cover, so rewind is capped (e.g. 200 ms).'],
    ['How do you size the Ready buffer?', 'Enough servers to absorb match starts for the time it takes to scale up: if 15 matches/s start in a region and a new host with 24 slots takes 3 minutes to become Ready, you need at least 15 &times; 180 = 2,700 Ready slots (~113 hosts), plus margin for bursts.'],
    ['How do leaderboards handle 50 million players?', 'A Redis sorted set per season and board gives O(log N) updates and rank queries; shard by board or region if one set grows too large, and approximate the rank for players far down the list (percentile buckets) if exact rank is too costly. See the leaderboard case.'],
    ['How do you prevent item duplication?', 'Server-only grants, idempotency keys on every grant/spend, a double-entry ledger in a transactional store, and reconciliation jobs; never apply economy changes based on client messages.']
  ],
  related: ['leaderboard', 'video-conferencing', 'chat', 'payment', 'saas-platform']
});

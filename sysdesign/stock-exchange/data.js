SD.renderCase({
  slug: 'stock-exchange',
  summary: 'A stock exchange matches buy and sell orders fairly, deterministically and in microseconds, and must never lose or reorder an accepted order. Orders enter through <strong>order gateways</strong> (FIX or binary protocols such as OUCH and SBE), pass inline <strong>pre-trade risk checks</strong>, and are stamped by a <strong>sequencer</strong> that gives every event a single total order and writes it to an <strong>event-sourced journal</strong>. A <strong>single-threaded, in-memory matching engine</strong> per symbol (or group of symbols) applies them to a <strong>price-time priority order book</strong>; because it is deterministic, identical <strong>replicated state machines</strong> on hot standbys process the same input and reach the same state, so failover takes milliseconds and recovery is a replay. Results fan out as execution reports to traders, as <strong>market data over UDP multicast</strong> to thousands of subscribers, and as trades to <strong>clearing and settlement</strong>. Speed comes from mechanical sympathy rather than more machines: <strong>kernel bypass</strong> networking, pinned busy-spinning cores, <strong>lock-free ring buffers</strong> (the LMAX Disruptor), zero allocation and cache-friendly data structures.',
  examples: 'Nasdaq INET and its Matching Engine, NYSE Pillar, CME Globex, LSEG Millennium Exchange, Cboe, Deutsche Börse T7, IEX (the speed bump), LMAX Exchange (origin of the Disruptor); crypto venues such as Coinbase Exchange; Nasdaq’s markets running on AWS Outposts.',
  functional: ['Accept new, cancel and replace (modify) orders: limit, market, IOC/FOK, with time-in-force; acknowledge every message.', 'Match continuously by price-time priority; run opening and closing auctions.', 'Send execution reports (ack, fill, partial fill, cancel, reject) to the order owner, and drop copies to clearing firms.', 'Publish market data: trades, top-of-book and full depth (per-order) feeds.', 'Pre-trade risk controls (price bands, size limits, credit) and kill switches; send trades to clearing and settlement.'],
  nonFunctional: ['Latency: order-in to ack-out under ~50 &micro;s p99 inside the exchange, with low jitter (tail matters more than mean).', 'Throughput: 1M+ messages/s at bursts (market open, news); one hot symbol at 100k+ messages/s.', 'Determinism and fairness: identical input produces identical output; first come, first served by sequence number.', 'Durability: no accepted order or trade lost; RPO 0, failover RTO in milliseconds to seconds.', 'Regulatory audit: complete, time-stamped (PTP-synchronised, MiFID II / CAT accuracy) record of every event, kept for years.'],
  outOfScope: ['Broker-side order routing and smart order routers.', 'The full clearing house (CCP) and securities depository internals.', 'Retail brokerage apps (see <a href="../payment/index.html">payment system</a> for ledger patterns).'],
  estimates: [
    ['Listed instruments', '~10,000 symbols', 'Equities and ETFs on a large exchange'],
    ['Order messages per day', '~500 million', 'New + cancel + replace; most orders are cancelled, not filled'],
    ['Average message rate', '~21k msg/s', '500M / 23,400 s (a 6.5-hour session)'],
    ['Peak burst', '~1M msg/s', '~50&times; average in the opening seconds and on news'],
    ['Trades per day', '~25 million', '~5% of order messages produce a fill'],
    ['Hottest symbol', '~100k msg/s', '~10% of peak traffic on one instrument (an index ETF or mega-cap stock)'],
    ['Journal volume', '~200 MB/s peak, ~100 GB/day', '1M msg/s &times; ~200 bytes; 500M &times; 200 B'],
    ['Market data', '~1 Gbit/s peak per feed', '~1M updates/s &times; ~100 bytes, sent twice (A/B feeds) by multicast regardless of subscriber count'],
    ['Connected sessions', '~5,000', '~500 member firms &times; ~10 order-entry sessions']
  ],
  compute: [
    ['Order gateways', '10 servers (5 pairs), kernel-bypass NICs', 'One gateway with busy-polling and a binary protocol handles ~200k msg/s at a few &micro;s each; 1M peak / 200k = 5, paired for failover. Sessions are spread so each firm has connections on two gateways.'],
    ['Risk check', 'Inline in the gateway (or FPGA), ~1-2 &micro;s', 'Per-account credit and position limits held in memory, updated from fills; no network hop on the critical path.'],
    ['Sequencer', '1 active + 2 replicas per partition', 'A single writer assigns sequence numbers at ~1M msg/s (~1 &micro;s each), replicates to standbys over a low-latency fabric before releasing to the engine.'],
    ['Matching engines', '~16 partitions, each one pinned core + 2 hot standbys', 'A single-threaded engine processes ~1-5M simple events/s (LMAX reported 6M orders/s); 10,000 symbols are spread so the hottest partition sees ~150k msg/s, &lt;15% busy, keeping queues empty and latency flat.'],
    ['Market data publishers', '4 channels &times; A/B, ~8 servers', 'Symbol ranges per multicast channel; ~250k updates/s per channel; snapshot and retransmission servers alongside.'],
    ['Journal storage', 'NVMe on each replica + archive', '~100 GB/day written sequentially; replicated in memory first, flushed asynchronously; archived to WORM storage for 7+ years.']
  ],
  api: [
    ['Binary (OUCH/SBE): EnterOrder {clOrdId, side, symbol, qty, price, tif}', 'Fixed-length little-endian fields, no parsing overhead; FIX 4.4/5.0 offered on separate, slower gateways for compatibility.'],
    ['CancelOrder {clOrdId | orderId} / ReplaceOrder {orderId, newQty, newPrice}', 'Cancel is the most common message. Replace keeps time priority only when reducing quantity at the same price.'],
    ['ExecutionReport {orderId, execType (New, Fill, Partial, Canceled, Rejected), lastQty, lastPx, leavesQty, seq}', 'Sent to the order owner and to drop-copy sessions; sequence numbers allow gap detection and replay on reconnect.'],
    ['Market data (ITCH-style multicast): AddOrder / OrderExecuted / OrderCancel / Trade', 'Per-order (level 3) incremental feed with sequence numbers; separate top-of-book feed for lighter consumers.'],
    ['Recovery: Retransmit(seqFrom, seqTo) / Snapshot(symbol)', 'TCP services for subscribers that missed multicast packets or join late.'],
    ['Admin: KillSwitch(firm) / HaltSymbol(symbol)', 'Mass-cancel all of a firm’s orders; trading halts and limit-up/limit-down pauses.']
  ],
  data: [
    ['Order book (per symbol)', 'Matching engine memory', 'Bids and asks: price levels (array indexed by tick or a sorted tree), each a FIFO queue of orders; plus a hash map orderId &rarr; order for O(1) cancel.'],
    ['Order', 'Engine memory (pre-allocated pool)', 'orderId, firm, side, price (integer ticks, never floating point), qty, leaves, sequence number (time priority), links in its price-level queue.'],
    ['Journal (event log)', 'Append-only, replicated, NVMe + archive', 'Every sequenced input and output event: seq, timestamp (from the sequencer, PTP-synced), payload; the source of truth for replay and audit.'],
    ['Snapshots', 'Local disk + object storage', 'Periodic engine state at sequence N (books, open orders) to bound replay time.'],
    ['Trades', 'Post-trade relational DB / ledger', 'tradeId, symbol, buy/sell orderIds and firms, qty, price, timestamp; sent to the CCP for clearing; immutable.'],
    ['Risk state', 'Gateway / risk process memory', 'Per-account open exposure, credit limit, price-band reference prices; rebuilt from the journal on restart.']
  ],
  dbChoice: [
    ['Live order books', 'In-memory data structures in one thread', 'Microsecond matching is impossible with any network database or locks; a single thread owns each book, so no synchronisation is needed.', 'In-memory database or Redis: adds a network hop and contention. Multi-threaded engine with locks: non-deterministic, jittery.'],
    ['Durability', 'Event-sourced journal + replicated state machines', 'The input sequence fully determines state: replicate the log (not the state), replay to recover, and verify replicas by comparing outputs.', 'Writing book state to a database on every change: far too slow, and still needs a log for audit.'],
    ['Replication protocol', 'Raft-based cluster log (e.g. Aeron Cluster) or primary-backup with sequencer acks', 'Consensus gives an agreed order and leader failover; low-latency transports keep replication to a few &micro;s within a data centre.', 'Asynchronous replication: faster but loses the tail on failover, unacceptable for accepted orders.'],
    ['Post-trade records', 'Relational database / immutable ledger', 'Trades are few (millions per day), need queries, joins and strong consistency for clearing and reporting.', 'Data warehouse only: fine for surveillance analytics, not as the system of record.']
  ],
  diagram: {
    nodes: [['tr', 'Brokers / traders', 'client', 0, 1.2, 'co-located, FIX/binary'], ['gw', 'Order gateway', 'gw', 1, 1.2, 'session, validation'], ['risk', 'Pre-trade risk', 'svc', 2, 1.2, 'limits, price bands'],
      ['ref', 'Reference data', 'db', 2, 0, 'accounts, limits'], ['seq', 'Sequencer', 'svc', 3, 1.2, 'total order'], ['jr', 'Journal', 'db', 3, 0, 'replicated event log'],
      ['me', 'Matching engine', 'svc', 4.3, 1.2, 'single thread per book'], ['me2', 'Hot standby', 'svc', 4.3, 2.4, 'same input, same state'], ['md', 'Market data', 'stream', 5, 0, 'UDP multicast A/B'],
      ['mdc', 'Feed subscribers', 'ext', 6, 0, 'firms, vendors'], ['cl', 'Clearing', 'svc', 5.6, 1.5, 'trades to the CCP'], ['pdb', 'Post-trade DB', 'db', 5.6, 2.7, 'trades, audit'],
      ['out', 'Output stream', 'stream', 2.5, 2.6, 'exec reports'], ['surv', 'Surveillance', 'svc', 1, 2.6, 'abuse detection']],
    edges: [['tr', 'gw'], ['gw', 'risk'], ['risk', 'ref', 'in-memory copy'], ['risk', 'seq'], ['seq', 'jr', 'journal'], ['seq', 'me', 'sequenced input'], ['seq', 'me2', 'same input'], ['me', 'md', 'book updates'], ['md', 'mdc', 'multicast'],
      ['me', 'cl', 'trades'], ['cl', 'pdb'], ['me', 'out', 'exec events'], ['out', 'gw', 'exec reports'], ['out', 'surv', '', 'async']]
  },
  flows: [
    { name: 'Order to trade', desc: 'A buy limit order crosses the best offer and trades, end to end in tens of microseconds.', steps: [
      ['tr', 'gw', 'EnterOrder BUY 100 @ 50.02', 'A co-located broker sends a binary order over a kernel-bypass TCP session. The gateway checks session sequence, message format and symbol state.'],
      ['gw', 'risk', 'pre-trade checks', 'Inline checks in ~1-2 µs: price within the band (e.g. ±10% of reference), quantity under the fat-finger limit, the firm’s credit after this order, firm not killed.'],
      ['risk', 'seq', 'accepted order', 'Only checked orders reach the sequencer, so the engine never wastes time on invalid input.'],
      ['seq', 'jr', 'seq 1,000,001 + replicate', 'The sequencer stamps the next sequence number and timestamp, and replicates to its standbys (quorum ack) before release: from now on the order cannot be lost.'],
      { par: [['seq', 'me', 'event 1,000,001'], ['seq', 'me2', 'event 1,000,001']], msg: 'Primary and standby engines receive the identical event; both will compute identical results.' },
      ['me', 'out', 'Fill 100 @ 50.01 (both sides)', 'The engine matches in a few µs: the best ask is 300 @ 50.01, which is ≤ 50.02, so 100 trade at the resting order’s price (50.01) and the oldest order at that level shrinks to 200. Execution reports for buyer and seller are emitted with output sequence numbers.'],
      ['out', 'gw', 'exec reports', 'Each report is routed to the session that owns the order, plus drop copies to the clearing firms.', 'resp'],
      ['gw', 'tr', 'ExecutionReport: Filled', 'Order in to fill out: ~20-50 µs inside the exchange.', 'resp'],
      { par: [['me', 'md', 'Trade + book update', 'async'], ['me', 'cl', 'trade to clearing', 'async']], msg: 'Market data multicasts the trade and the new best offer; clearing receives the trade for novation to the CCP.' }],
      end: 'One sequencer gives a single order of events; one thread per book matches without locks; replication of the input makes it durable.' },
    { name: 'Market data fan-out', desc: 'Every book change reaches thousands of subscribers at once, with gap detection and recovery.', steps: [
      ['me', 'md', 'AddOrder / Executed / Cancel', 'The engine emits per-order book events; the publisher packs them into UDP datagrams with channel sequence numbers.'],
      ['md', 'mdc', 'multicast feed A', 'Multicast sends one packet that the network switches replicate to every subscriber: cost does not grow with the number of listeners, and everyone receives it at the same time (fairness).'],
      ['md', 'mdc', 'identical feed B', 'The same stream on a second, physically separate network. Subscribers arbitrate A/B, taking whichever packet arrives first, so one lost packet rarely matters.'],
      ['mdc', 'md', 'gap: missing seq 8812', 'If both copies of a packet are lost, the subscriber sees a sequence gap and stops trusting its book for that channel.', 'err'],
      ['md', 'mdc', 'retransmit 8812 (TCP)', 'A retransmission server replays the missing messages from its buffer.', 'resp'],
      ['mdc', 'md', 'late join: snapshot', 'A subscriber starting mid-day requests a snapshot of the book at sequence N and then applies buffered incrementals after N.'],
      ['md', 'mdc', 'snapshot @ N + incrementals', 'The subscriber’s book is rebuilt exactly, because every update is sequenced and deterministic.', 'resp']],
      end: 'Sequenced multicast plus A/B arbitration, retransmission and snapshots gives fair, scalable and recoverable market data.' },
    { name: 'Engine failover', desc: 'The primary matching engine for a partition dies. The hot standby, already in the same state, takes over.', steps: [
      ['seq', 'me', 'event 2,000,450', 'Normal operation: both engines consume the sequenced stream.'],
      ['me', 'out', 'heartbeat lost', 'The primary’s host fails; its output and heartbeats stop.', 'err'],
      ['seq', 'me2', 'promote standby', 'The cluster (Raft-style leader election among engine replicas, or the sequencer’s monitor) promotes the standby within milliseconds. It needs no state transfer: it has already applied every event up to 2,000,450 and holds a bit-identical order book.'],
      ['me2', 'out', 'resume from output seq', 'The new primary has computed the same outputs; it suppresses those already published (by output sequence number) and publishes the rest, so no report is duplicated or missed.'],
      ['out', 'gw', 'exec reports continue', 'Gateways and traders see at most a brief pause; no order is lost and nothing needs re-entering.', 'resp'],
      ['jr', 'me', 'new standby: snapshot + replay', 'A replacement standby loads the latest snapshot and replays the journal to catch up before joining.', 'async']],
      end: 'Determinism turns replication into “replicate the input”; failover needs no state transfer, only agreement on who publishes.' },
    { name: 'Risk reject + kill switch', desc: 'A runaway algorithm floods orders. Risk controls reject what breaches limits and then pull the firm’s orders.', steps: [
      ['tr', 'gw', 'BUY 5,000,000 @ market', 'A misconfigured algo sends an order far above its size limit.'],
      ['gw', 'risk', 'check limits', 'Max order size and notional checks fail.'],
      ['risk', 'gw', 'reject: size limit', 'Rejected before sequencing: the engine never sees it.', 'err'],
      ['gw', 'tr', 'ExecutionReport: Rejected', 'The firm learns immediately, with the reason.', 'resp'],
      ['risk', 'seq', 'firm breaches credit: kill', 'Accepted orders keep filling until the firm’s exposure crosses its credit limit (or a message-rate threshold); the risk service, or the firm’s risk officer, triggers the kill switch.', 'err'],
      ['seq', 'me', 'MassCancel(firm 117)', 'The mass cancel is an ordinary sequenced event, so every replica cancels exactly the same orders at the same point in the stream.'],
      ['me', 'out', 'Canceled × 3,200 orders', 'Every resting order of the firm is cancelled; new orders are rejected until the firm is reinstated.'],
      ['me', 'md', 'book updates', 'The market sees the liquidity disappear.', 'async']],
      end: 'Controls sit before the sequencer for speed, and act through the sequenced stream for determinism.' },
    { name: 'Start-of-day recovery', desc: 'After a full restart, engines rebuild state by replaying the journal from the last snapshot and prove they agree.', steps: [
      ['jr', 'me', 'load snapshot @ seq N', 'The engine loads the latest snapshot (books and open orders at sequence N), taken every few minutes or at end of day.'],
      ['jr', 'me', 'replay N+1 … latest', 'Every event after N is re-applied in order. Because the engine uses no wall clock, randomness or thread timing, replay produces exactly the original state and outputs.'],
      ['jr', 'me2', 'same replay on standby', 'The standby performs the same replay independently.'],
      { par: [['me', 'seq', 'state checksum', 'resp'], ['me2', 'seq', 'state checksum', 'resp']], msg: 'Replicas exchange checksums of their state at the same sequence number; any mismatch means a determinism bug and blocks opening.' },
      ['seq', 'me', 'open: auction events', 'Trading resumes with the opening auction as a sequenced event.'],
      ['me', 'md', 'snapshot to subscribers', 'Market data publishes fresh snapshots so subscribers start from a known state.', 'async']],
      end: 'An event-sourced engine is recoverable, auditable and testable: yesterday’s journal can be replayed bit-for-bit in a test environment.' }
  ],
  components: [
    ['Order gateways', 'Session management (FIX/binary), message validation, throttling per session, routing to the right partition, delivery of execution reports with resend support.'],
    ['Pre-trade risk', 'Price bands, size and notional limits, credit and position checks, message-rate limits, kill switches; in-process or FPGA.'],
    ['Sequencer', 'Single total order and timestamp per partition; replication of the input log; gap-free sequence numbers for everything downstream.'],
    ['Matching engine', 'Single-threaded, in-memory order books with price-time priority; continuous matching and auctions; deterministic outputs.'],
    ['Journal and snapshots', 'Event-sourced record of every input and output, replicated and archived; snapshots to bound replay time.'],
    ['Market data publishers', 'Multicast A/B feeds by channel, top-of-book and depth; retransmission and snapshot servers.'],
    ['Clearing and post-trade', 'Trade capture, drop copies, CCP novation and netting, settlement instructions (T+1 in the US since 2024; UK and EU moving to T+1 in October 2027), regulatory reporting and surveillance.']
  ],
  deep: [
    ['The order book and price-time priority', '<p>Each symbol has two sides. Each side is a set of <strong>price levels</strong>; each level is a <strong>FIFO queue</strong> of resting orders. An incoming buy at limit P matches the lowest asks while ask &le; P, oldest order first at each level; the remainder rests on the bid side (or is cancelled if IOC). Trades print at the resting order’s price.</p><p>Data structures for O(1) hot operations:</p><ul><li>Prices as <strong>integer ticks</strong> (never floating point). Levels in an array indexed by tick offset from a reference price (most activity is near the touch), or a red-black tree / skip list for sparse books.</li><li>Each level a doubly linked list of orders, so cancel from the middle is O(1).</li><li>A hash map <code>orderId &rarr; order</code> for cancels and replaces (most messages are cancels).</li><li>Cached best bid and best ask pointers.</li><li>Pre-allocated object pools: no allocation and no garbage collection on the hot path.</li></ul><pre><code>match(buy):\n  while buy.qty &gt; 0 and bestAsk and bestAsk.price &lt;= buy.price:\n    o = bestAsk.level.head            # oldest order at best price\n    q = min(buy.qty, o.qty)\n    emit Trade(q, o.price); reduce both\n    if o.qty == 0: unlink o; if level empty: advance bestAsk\n  if buy.qty &gt; 0 and tif == DAY: rest(buy)</code></pre>'],
    ['Sequencer, event sourcing and replicated state machines', '<p>Fairness and recovery both reduce to one idea: put every input into a <strong>single, totally ordered, durable log</strong>, and make the engine a <strong>deterministic function</strong> of that log. Then:</p><ul><li>Replicas that consume the same log reach the same state (replicated state machine), so failover needs no state transfer.</li><li>Recovery is snapshot + replay; audit is the log itself.</li><li>Testing can replay production days bit-for-bit.</li></ul><p>Determinism rules for the engine: no reading the wall clock (timestamps come from the sequencer), no randomness, no dependence on thread timing or hash-map iteration order, no external calls, identical code version on all replicas. Replication of the log uses consensus (Raft in Aeron Cluster) or a primary sequencer that waits for standby acks. Partitioning by symbol keeps one log per partition; orders spanning symbols (spreads) need a coordinator or a shared partition.</p>'],
    ['Microsecond latency: mechanical sympathy', '<ul><li><strong>Kernel bypass</strong>: NICs with user-space stacks (AMD Solarflare Onload/ef_vi, DPDK, RDMA) skip syscalls and interrupts: ~1-2 &micro;s per hop instead of ~10-20 &micro;s.</li><li><strong>Busy spinning on pinned, isolated cores</strong> (isolcpus, IRQ affinity, no hyper-threading siblings): no context switches or wake-up latency; NUMA-local memory and huge pages to avoid TLB misses.</li><li><strong>Single writer + ring buffers</strong>: the LMAX Disruptor is a pre-allocated ring of slots with sequence counters, so producers and consumers hand off without locks; cache-line padding avoids false sharing.</li><li><strong>Zero allocation</strong>: object pools and flyweights over byte buffers; in Java, no GC pauses on the hot path (or C++/Rust).</li><li><strong>Binary encodings</strong> (SBE, ITCH/OUCH): fixed offsets, no parsing.</li><li><strong>FPGAs</strong> for risk checks, market data encoding and feed handlers at sub-microsecond latency.</li><li><strong>Fair access</strong>: co-location with equal-length cables, PTP-synchronised timestamps; measure p99.9 jitter, not averages.</li></ul>'],
    ['Market data distribution', '<p>Market data must reach thousands of subscribers simultaneously and fairly. <strong>UDP multicast</strong> sends one packet that switches replicate, so cost and latency do not grow with subscribers. Multicast is unreliable, so feeds add sequence numbers per channel, <strong>A/B redundant feeds</strong> on separate networks (subscribers keep the first copy), TCP <strong>retransmission</strong> servers for gaps, and <strong>snapshot</strong> channels for late joiners. Feeds are layered: level 3 (every order event, ITCH-style) for professional firms who rebuild the book, level 2 (aggregated depth) and level 1 (top of book and trades) for lighter consumers and vendors who redistribute over the internet. Public cloud networks generally lack native multicast (AWS Transit Gateway multicast exists, Azure VNets do not support it), one reason matching and market data still run on dedicated hardware or Outposts-style deployments.</p>'],
    ['Clearing and settlement', '<p>A trade on the exchange is only a promise. After matching: <strong>trade capture</strong> and drop copies to member firms; <strong>clearing</strong> by a central counterparty (CCP), which <strong>novates</strong> each trade so it becomes buyer&ndash;CCP and CCP&ndash;seller, removing counterparty risk, collects margin and nets each member’s trades into one obligation per security; and <strong>settlement</strong> at the depository (DTCC in the US, Euroclear/CREST in Europe/UK): delivery of securities versus payment of cash, now T+1 in the US, Canada and Mexico (since May 2024), with the UK and EU moving to T+1 on 11 October 2027. These systems are batch-oriented, ledger-based and strongly consistent, unlike the microsecond engine; the journal of trades is the handover point, with reconciliation between the exchange, CCP and members every day.</p>']
  ],
  scale: [
    '<strong>More symbols:</strong> add matching partitions (each with its own sequencer log or a partition of a shared one); symbols are independent, so this scales linearly.',
    '<strong>A single hot symbol</strong> cannot be split: one book must be one thread. Keep it fast instead (lean data structures, dedicated core, no other symbols on that partition) and use throttles per session and price bands to bound bursts.',
    '<strong>Bursts at the open:</strong> pre-warm caches and memory pools, size gateways and multicast for peak, and run the open as an auction (one uncross instead of thousands of trades).',
    '<strong>Gateway connections:</strong> scale gateways horizontally; they are stateless apart from session sequence numbers, which are recoverable from the output journal.',
    '<strong>Downstream consumers</strong> (clearing, surveillance, data products) read the journal asynchronously through a separate, slower pipeline (e.g. Kafka) so they never slow matching.'
  ],
  tradeoffs: [
    ['Concurrency model', 'Single-threaded engine per book vs multi-threaded with locks', 'Single-threaded: deterministic, lock-free, cache-hot, predictable latency; scale by partitioning symbols.'],
    ['Durability on the hot path', 'Synchronous disk fsync vs replicated memory with async disk', 'Replicate to standby memory (a few &micro;s) before acknowledging; write to disk asynchronously. Losing all replicas at once is handled by site-level redundancy.'],
    ['Replication', 'Replicate state vs replicate input (state machine)', 'Replicate the input log: small, ordered, and gives audit and replay for free; requires strict determinism.'],
    ['Market data transport', 'Multicast vs TCP unicast fan-out', 'Multicast for fairness and scale in co-location; TCP/WebSocket redistribution for internet subscribers via vendors.'],
    ['Fairness', 'Pure speed vs speed bumps / batch auctions', 'Continuous price-time matching with equal access; some venues (IEX) add a 350 &micro;s speed bump or periodic auctions to blunt latency arbitrage.']
  ],
  failures: [
    ['Matching engine host dies', 'Hot standby with identical state is promoted in milliseconds; output sequence numbers prevent duplicate or missing reports.'],
    ['Sequencer failure', 'Replicated log with leader election; the new leader continues from the last committed sequence number; gateways resend unacknowledged orders by client order id (deduplicated).'],
    ['Determinism bug (replicas diverge)', 'State checksums compared at sequence checkpoints; divergence halts the partition rather than trading on inconsistent books; replay in test to diagnose.'],
    ['Runaway algorithm', 'Pre-trade limits, message-rate throttles, credit checks and kill switches that mass-cancel through the sequenced stream.'],
    ['Market data packet loss', 'A/B feeds, sequence gap detection, retransmission and snapshot services.'],
    ['Data centre loss', 'Warm DR site receiving the replicated journal; failover is a controlled, regulated procedure (typically minutes, with the market halted and reopened via auction).'],
    ['Extreme volatility', 'Price bands, limit-up/limit-down pauses, volatility auctions and market-wide circuit breakers.']
  ],
  cloud: [['Low-latency compute', 'HPC / compute-optimised VMs in proximity placement groups', 'EC2 bare metal + cluster placement groups'], ['On-premises / co-location extension', 'Azure Local', 'AWS Outposts'], ['Private networking', 'network'],
    ['Market data multicast', 'Not natively supported in VNets (vendor overlay)', 'Transit Gateway multicast'], ['Post-trade database', 'sql'], ['Tamper-evident audit ledger', 'ledger'], ['Journal archive (WORM)', 'blob'], ['Downstream event distribution', 'stream'],
    ['Surveillance analytics', 'warehouse'], ['Keys, HSM and certificates', 'secrets'], ['Staff identity and access', 'workforce'], ['DDoS protection for internet-facing APIs', 'ddos'], ['Monitoring and latency telemetry', 'monitor']],
  refs: { az: ['azMission', 'azp-event-sourcing', 'azp-cqrs', 'azp-leader-election', 'azp-sharding', 'azEventDriven'],
          aws: ['awsFsiLens', 'awsEventSourcing', 'blLeader', 'blStatic', 'blConstant', 'blDistributed'] },
  questions: [
    ['Why is the matching engine single-threaded?', 'One thread owning a book needs no locks, keeps data hot in L1/L2 cache, and is deterministic, which enables replicated state machines and replay. A single thread can process millions of simple events per second; scale comes from partitioning symbols, not from threads per book.'],
    ['How do you make it durable without slowing it down?', 'Durability comes from the replicated input log: the sequencer replicates each event to standby memory (a few microseconds) before the engine acts on it, disk writes are asynchronous and sequential, and state is recovered by snapshot plus replay.'],
    ['How do you guarantee fairness?', 'A single sequencer assigns a total order per partition, so first in is first served; price-time priority within the book; equal-length co-location cables, multicast market data delivered simultaneously, and PTP-synchronised timestamps for audit.'],
    ['What happens if the primary engine crashes mid-match?', 'The standby has processed exactly the same sequenced events and holds the same state. It is promoted, publishes outputs not yet seen (by output sequence number) and continues. Nothing is re-entered and no fill is duplicated.'],
    ['Why use integers for prices?', 'Floating point cannot represent decimal prices exactly and rounding differs across platforms, which breaks matching and determinism. Prices are integer ticks (e.g. 50.01 = 5001 with a scale of 100) and quantities are integers.'],
    ['How would you build this in the cloud?', 'Matching and market data need deterministic microsecond latency and multicast, which general cloud networks do not offer, so they run on dedicated or Outposts-style hardware near participants. The cloud fits everything around them: post-trade, surveillance analytics, archives, DR replicas of the journal, test environments replaying production days.']
  ],
  related: ['payment', 'message-queue', 'kv-store', 'ticket-booking', 'reliability']
});

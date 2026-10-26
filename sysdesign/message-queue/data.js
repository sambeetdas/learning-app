SD.renderCase({
  slug: 'message-queue',
  summary: 'A distributed event log lets many producers write ordered streams of records and many independent consumers read them at their own pace, minutes or weeks later. This design follows Apache Kafka: a <strong>topic</strong> is split into <strong>partitions</strong>, each an append-only log replicated from a <strong>leader</strong> to followers; the leader tracks the <strong>in-sync replica set (ISR)</strong> and only exposes records below the <strong>high watermark</strong>, so with <code>acks=all</code> and <code>min.insync.replicas=2</code> an acknowledged record survives a broker loss. Consumers form <strong>consumer groups</strong> that divide partitions among members and track progress as <strong>offsets</strong>, which makes replay trivial. Retention is by time/size or by key (<strong>log compaction</strong>), old segments move to object storage (<strong>tiered storage</strong>), cluster metadata lives in a Raft quorum (<strong>KRaft</strong>, ZooKeeper is gone since Kafka 4.0), and <strong>idempotent producers plus transactions</strong> give exactly-once processing inside Kafka. We contrast it throughout with SQS-style queues, where messages are deleted once processed.',
  examples: 'Apache Kafka (LinkedIn, Uber, Netflix), Confluent Cloud, Amazon MSK, Azure Event Hubs (Kafka API), Redpanda, WarpStream and AutoMQ (object-storage-native Kafka), Apache Pulsar; Amazon SQS, Azure Service Bus and RabbitMQ as classic queues.',
  functional: ['Producers append records (key, value, headers) to a topic; records with the same key keep their order.', 'Many independent consumer groups read the same topic; within a group each partition is processed by one member.', 'Consumers commit offsets and can rewind or replay from any offset or timestamp.', 'Retention by time/size, or compaction that keeps the latest value per key; tiered storage for long retention.', 'Exactly-once read-process-write between topics (idempotent producer + transactions).'],
  nonFunctional: ['1 GB/s peak ingest (1M records/s), several times that in consumer egress.', 'No acknowledged record lost when one broker or zone fails (RPO 0 within a region).', 'p99 produce latency under ~20 ms with acks=all; end-to-end latency under ~100 ms.', 'Horizontal scale by adding partitions and brokers; thousands of partitions per cluster.', 'Retention of 7 days by default, months to years on tiered storage.'],
  outOfScope: ['Per-message routing rules, priorities and delayed delivery (classic broker features, see <a href="../job-scheduler/index.html">job scheduler</a>).', 'Stream processing logic itself (see <a href="../ad-click/index.html">ad click aggregation</a>).', 'Cross-region active-active replication details (MirrorMaker 2 / Cluster Linking mentioned only).'],
  estimates: [
    ['Average ingest', '500k records/s, ~500 MB/s', 'Events from ~5,000 services; ~1 KB per record after batch compression'],
    ['Peak ingest', '1M records/s, ~1 GB/s', '2&times; average'],
    ['Replicated writes', '~3 GB/s at peak', 'Replication factor 3: every byte written to 3 brokers'],
    ['Consumer egress', '~3 GB/s at peak', 'On average 3 consumer groups read each topic'],
    ['Daily volume', '~43 TB/day', '500 MB/s &times; 86,400 s'],
    ['Local (hot) storage', '~130 TB', '1 day on broker disks &times; RF 3 (tiered storage keeps the rest)'],
    ['Tiered storage', '~260 TB in object storage', '6 more days &times; 43 TB, stored once (object storage has its own durability)'],
    ['Partitions', '~6,000', '~200 topics; large topics sized at ~10 MB/s per partition so one consumer can keep up']
  ],
  compute: [
    ['Brokers', '24 brokers (8 per zone), 16 vCPU / 64 GB / 2 &times; 7.5 TB NVMe', 'Per broker at peak: ingress 1 GB/s produce / 24 + replication in 2 GB/s / 24 = ~125 MB/s; egress 3 GB/s / 24 consumers + 2 GB/s / 24 replication = ~210 MB/s (~1.7 Gbit/s). Comfortable on 25 Gbit/s NICs; sized mainly so a zone loss (+50% per broker) and catch-up reads still fit.'],
    ['Broker disk', '~5.4 TB used per broker, ~60% of 9 TB usable', '130 TB hot / 24 brokers; headroom for a zone outage when followers are re-created and for retention spikes before tiering catches up.'],
    ['Page cache', '~48 GB per broker', 'Consumers that keep up read from the OS page cache (zero-copy sendfile), not disk: ~1 min of the broker’s 125 MB/s ingress is ~7.5 GB, so tailing reads are almost all memory hits.'],
    ['KRaft controllers', '3 dedicated nodes (one per zone), 4 vCPU / 16 GB', 'Metadata is small (thousands of partitions), but isolation from broker load keeps leader elections fast; 3 voters tolerate 1 failure.'],
    ['Partitions per broker', '~750 replicas (6,000 &times; 3 / 24)', 'Well below the few-thousand-per-broker comfort zone; KRaft clusters handle millions of partitions in total.']
  ],
  api: [
    ['Produce(topic, partition, records[], acks=all, producerId, epoch, seq)', 'Batch of records (linger.ms 5-10, compression zstd). Sequence numbers let the broker drop duplicates from retries.'],
    ['Fetch(topic, partition, offset, maxBytes, isolation=read_committed)', 'Long-poll read from an offset; returns records up to the high watermark (or last stable offset for read_committed).'],
    ['ConsumerGroupHeartbeat(groupId, memberId, subscribedTopics)', 'KIP-848 protocol (default in Kafka 4.x): the broker-side coordinator computes assignments incrementally, avoiding stop-the-world rebalances.'],
    ['OffsetCommit(groupId, topic, partition, offset)', 'Stores progress in the compacted internal topic <code>__consumer_offsets</code>.'],
    ['InitProducerId / AddPartitionsToTxn / EndTxn(commit)', 'Transactions: register a transactional.id (fences zombie instances by epoch), add partitions and offsets, then commit atomically.'],
    ['SQS contrast: SendMessage / ReceiveMessage / DeleteMessage', 'Per-message visibility timeout and delete; no offsets, no replay, no ordering except FIFO groups.']
  ],
  data: [
    ['Partition log', 'Segment files on broker disk', 'Segments of ~1 GB: <code>.log</code> (record batches), <code>.index</code> (offset &rarr; file position), <code>.timeindex</code>; only the active segment is written.'],
    ['Record batch', 'Inside the log', 'base offset, producer id, epoch, base sequence, CRC, compression codec, records (key, value, headers, timestamp delta).'],
    ['Consumer offsets', '__consumer_offsets (compacted topic, 50 partitions)', 'key = (group, topic, partition) &rarr; committed offset + metadata; partition of the group decides its coordinator broker.'],
    ['Transaction state', '__transaction_state (compacted topic)', 'transactional.id &rarr; producer id, epoch, state (Ongoing, PrepareCommit, Complete), partitions involved.'],
    ['Cluster metadata', 'KRaft metadata log (__cluster_metadata)', 'Topics, partitions, leaders, ISR, leader epochs, configs, ACLs; replicated by Raft to controllers and cached by every broker.'],
    ['Tiered segments', 'Object storage (S3 / Blob)', 'Closed segments + indexes uploaded by the leader; remote log metadata maps offsets to objects; local copy deleted after local.retention.']
  ],
  dbChoice: [
    ['Message storage', 'Append-only segmented log on local disks', 'Sequential writes and reads, OS page cache and zero-copy transfer: one broker moves hundreds of MB/s. Offsets make replay and many consumers free.', 'A database table as a queue: row locks and index churn limit throughput to thousands per second; a classic broker (RabbitMQ) deletes on ack, so no replay.'],
    ['Long retention', 'Tiered storage to object storage (KIP-405)', 'Keeps brokers small and fast to rebalance while retaining months of data at object-storage prices; historical reads do not pollute the page cache.', 'Bigger broker disks: simpler but slow to re-replicate after failure. Diskless designs (WarpStream, KIP-1150) write straight to object storage at higher latency.'],
    ['Metadata', 'KRaft (Raft quorum inside Kafka)', 'One system to run, metadata as an event log, faster controller failover and far more partitions than ZooKeeper allowed.', 'ZooKeeper: removed in Kafka 4.0.'],
    ['Consumer progress', 'Offsets in a compacted internal topic', 'One integer per partition per group: cheap, and transactional with output records for exactly-once.', 'Per-message acks (SQS/Service Bus): flexible per-message retry, but state grows with messages and order is lost.']
  ],
  diagram: {
    nodes: [['sr', 'Schema registry', 'svc', 0, 0, 'Avro / Protobuf'], ['prod', 'Producers', 'client', 0, 1.2, 'idempotent, batched'], ['txn', 'Txn coordinator', 'svc', 1.5, 0, 'broker role'],
      ['b1', 'Broker 1', 'stream', 1.5, 1.2, 'leader of P0'], ['b2', 'Broker 2', 'stream', 0.9, 2.5, 'follower, zone B'], ['b3', 'Broker 3', 'stream', 2.1, 2.5, 'follower, zone C'],
      ['tier', 'Object storage', 'blob', 1.5, 3.6, 'tiered segments'], ['ctl', 'KRaft controllers', 'svc', 3, 0, 'Raft metadata quorum'], ['coord', 'Group coordinator', 'svc', 4.5, 0, '__consumer_offsets'],
      ['cga', 'Consumer group A', 'worker', 4.5, 1.2, '3 members'], ['cgb', 'Consumer group B', 'worker', 4.5, 2.5, 'rack-aware fetch'], ['sink', 'Sink database', 'db', 6, 1.2, 'materialised view'], ['idx', 'Search index', 'search', 6, 2.5, 'Elasticsearch']],
    edges: [['prod', 'sr', 'schema id'], ['prod', 'b1', 'produce'], ['prod', 'txn', 'txn API'], ['txn', 'b1', 'markers'], ['b1', 'b2', 'replicate', 'async'], ['b1', 'b3', '', 'async'], ['b1', 'tier', 'upload segments', 'async'],
      ['ctl', 'b1', 'metadata'], ['b1', 'cga', 'fetch'], ['b3', 'cgb', 'fetch from follower'], ['cga', 'coord', 'heartbeat / commit'], ['cga', 'sink'], ['cgb', 'idx']]
  },
  flows: [
    { name: 'Produce (acks=all)', desc: 'A producer writes a batch to partition 0; it is acknowledged only once every in-sync replica has it.', steps: [
      ['prod', 'sr', 'get schema id (cached)', 'The serialiser registers or looks up the schema once and embeds a 4-byte schema id in each record, so consumers can evolve safely.'],
      ['prod', 'b1', 'Produce batch (pid, seq 41)', 'Records with the same key hash to the same partition (murmur2(key) mod partitions), preserving per-key order. The batch carries the producer id and a sequence number; the leader checks it for duplicates and appends the batch to the active segment (into the page cache: Kafka relies on replication, not fsync, for durability).'],
      { par: [['b2', 'b1', 'Fetch(offset 1000)'], ['b3', 'b1', 'Fetch(offset 1000)']], msg: 'Followers continuously pull from the leader, like consumers. A follower that falls more than replica.lag.time.max.ms (30 s) behind is dropped from the ISR.' },
      { par: [['b1', 'b2', 'records 1000-1049', 'resp'], ['b1', 'b3', 'records 1000-1049', 'resp']], msg: 'The leader returns the new records to both followers, which append them to their own logs.' },
      { par: [['b2', 'b1', 'Fetch(offset 1050)'], ['b3', 'b1', 'Fetch(offset 1050)']], msg: 'The next fetch offset doubles as an acknowledgement: both ISR members now have up to 1049, so the high watermark advances to 1050.' },
      ['b1', 'prod', 'ack: offset 1000', 'With acks=all and min.insync.replicas=2, the write is acknowledged only once it is on every ISR member (at least 2). Consumers can now see it.', 'resp']],
      end: 'acks=all + min.insync.replicas=2 + RF 3 survives one broker loss with zero data loss; acks=1 is faster but can lose the tail on leader failure.' },
    { name: 'Consumer group read', desc: 'Three members of group A share the topic’s partitions and commit offsets; group B reads the same data independently from a nearby follower.', steps: [
      ['cga', 'coord', 'ConsumerGroupHeartbeat', 'Each member heartbeats to the group coordinator (the broker leading this group’s __consumer_offsets partition).'],
      ['coord', 'cga', 'assignment: P0, P3', 'The coordinator assigns partitions incrementally (KIP-848); members joining or leaving only move the partitions that must move.', 'resp'],
      ['cga', 'b1', 'Fetch P0 from offset 1000', 'The member starts at its last committed offset; long-poll fetch with fetch.min.bytes batching.'],
      ['b1', 'cga', 'records up to HW', 'Served from page cache with zero-copy sendfile; only records below the high watermark are visible, so consumers never see data that could be lost.', 'resp'],
      ['cga', 'sink', 'upsert batch', 'Process and write results. Writes should be idempotent (upsert by key) because a crash before the commit means reprocessing.'],
      ['cga', 'coord', 'OffsetCommit P0=1050', 'Commit after processing: at-least-once. Committing before processing would be at-most-once.'],
      ['b3', 'cgb', 'fetch from follower', 'Group B, in zone C, reads from the local follower (client.rack) to avoid cross-zone transfer charges. Its offsets are independent of group A.', 'resp'],
      ['cgb', 'idx', 'index documents', 'Group B builds a search index from the same events at its own pace.']],
      end: 'Parallelism within a group is capped by the partition count; adding groups is free because the log is not consumed destructively.' },
    { name: 'Broker failure + leader election', desc: 'Broker 1, leader of partition 0, dies. The controller promotes an in-sync follower; no acknowledged record is lost.', steps: [
      ['prod', 'b1', 'Produce (timeout)', 'Broker 1 crashes; in-flight requests fail.', 'err'],
      ['ctl', 'b1', 'heartbeat missed', 'The active KRaft controller stops receiving broker heartbeats and fences broker 1 after broker.session.timeout.ms (~9 s).', 'err'],
      ['ctl', 'b2', 'LeaderAndIsr: you lead P0', 'The controller picks a new leader from the ISR (b2), bumps the leader epoch and writes it to the metadata log; all brokers learn it within milliseconds.'],
      ['b3', 'b2', 'Fetch with leader epoch', 'Broker 3 follows the new leader and truncates any records beyond the leader-epoch boundary, so replicas converge on exactly the acknowledged history.'],
      ['prod', 'b2', 'retry Produce (pid, seq 42)', 'The producer refreshes metadata and retries. Idempotence means a batch that actually reached the old leader is not written twice.'],
      ['b2', 'prod', 'ack', 'Writes resume a few seconds after the failure. With only 2 replicas left, min.insync.replicas=2 still allows writes.', 'resp'],
      ['b2', 'cga', 'consumers resume', 'Consumers fetch from the new leader from their committed offsets.', 'resp']],
      end: 'Unclean leader election (choosing an out-of-sync replica) stays disabled: availability is traded for no data loss.' },
    { name: 'Exactly-once (transactions)', desc: 'A consume-transform-produce app reads topic A and writes topic B, committing output and input offsets atomically.', steps: [
      ['prod', 'txn', 'InitProducerId(txn.id)', 'The app registers its transactional.id. The coordinator bumps the epoch, fencing any zombie instance with the same id (its writes will be rejected).'],
      ['prod', 'txn', 'AddPartitionsToTxn(B-3)', 'Before writing, the producer tells the coordinator which partitions the transaction touches.'],
      ['prod', 'b1', 'Produce to B-3 (txn)', 'Records are written to the log immediately but are invisible to read_committed consumers until the commit marker.'],
      ['prod', 'txn', 'AddOffsetsToTxn(group A)', 'The consumed input offsets are sent as part of the same transaction (sendOffsetsToTransaction).'],
      ['prod', 'txn', 'EndTxn(COMMIT)', 'The coordinator writes PrepareCommit to __transaction_state: the decision point.'],
      ['txn', 'b1', 'write COMMIT markers', 'Markers are written to every involved partition, including __consumer_offsets; then the transaction is Complete.', 'async'],
      ['b1', 'cga', 'read_committed fetch', 'Downstream consumers read up to the last stable offset and skip aborted records, so each input is reflected exactly once in the output.', 'resp']],
      end: 'Exactly-once holds inside Kafka (Kafka Streams, Flink sinks). Side effects outside Kafka still need idempotent writes or the outbox pattern.' }
  ],
  components: [
    ['Producer client', 'Partitioning by key, batching (linger.ms, batch.size), compression, idempotence (enabled by default), retries and delivery timeout.'],
    ['Brokers', 'Host partition replicas, serve produce and fetch, track ISR and high watermark, upload closed segments to tiered storage, enforce quotas.'],
    ['KRaft controller quorum', 'Raft-replicated metadata log: topic and partition creation, leader election, ISR changes, broker registration and fencing.'],
    ['Group coordinator', 'Membership, partition assignment and committed offsets for consumer groups.'],
    ['Transaction coordinator', 'Producer id and epoch, transaction state machine, commit/abort markers.'],
    ['Schema registry', 'Versioned schemas with compatibility rules (backward/forward) so producers and consumers evolve independently.'],
    ['Connect / sinks', 'Kafka Connect or stream processors moving data to databases, search and the lake; CDC sources (Debezium) feeding topics.']
  ],
  deep: [
    ['Replication: ISR, high watermark and leader epochs', '<p>Each partition has one leader and RF-1 followers that fetch from it. The <strong>ISR</strong> is the set of replicas caught up within <code>replica.lag.time.max.ms</code>. The <strong>high watermark (HW)</strong> is the highest offset replicated to all ISR members; consumers only see records below it. Durability knobs:</p><table><tr><th>Setting</th><th>Effect</th></tr><tr><td><code>acks=0</code></td><td>Fire and forget.</td></tr><tr><td><code>acks=1</code></td><td>Leader has it; lost if the leader dies before followers fetch.</td></tr><tr><td><code>acks=all</code> + <code>min.insync.replicas=2</code></td><td>On at least 2 replicas before ack; writes rejected (NotEnoughReplicas) if the ISR shrinks below 2.</td></tr></table><p>On failover the new leader is chosen from the ISR, and followers use <strong>leader epochs</strong> (not the HW, which lags) to truncate divergent tails, which fixed old edge cases where data could be lost or replicas diverge. Kafka 4.x adds eligible leader replicas (KIP-966) to stay safe even after unclean shutdowns.</p>'],
    ['Partitions, ordering and consumer groups', '<p>Order is guaranteed only <em>within a partition</em>. Choose the key so everything needing order shares it (order id, account id). Partition count sets maximum consumer parallelism per group: 12 partitions mean at most 12 active members. Increasing partitions later changes key &rarr; partition mapping, so over-provision big topics up front (e.g. 2-3&times; expected consumers).</p><p><strong>Rebalancing</strong>: the old eager protocol stopped every member on each change (“stop the world”). Cooperative incremental assignment and the KIP-848 server-side protocol (default in Kafka 4.x) move only the partitions that must move. Use <em>static membership</em> (group.instance.id) so rolling restarts do not trigger rebalances, and keep <code>max.poll.interval.ms</code> above the worst-case batch processing time.</p><p><strong>Queues for Kafka</strong> (share groups, KIP-932) adds SQS-like cooperative consumption with per-record acknowledgement, for work queues where more consumers than partitions are needed.</p>'],
    ['Retention, compaction and tiered storage', '<ul><li><strong>Delete retention</strong>: segments older than <code>retention.ms</code> (or beyond <code>retention.bytes</code>) are deleted whole; cheap, because the log is never edited.</li><li><strong>Compaction</strong> (<code>cleanup.policy=compact</code>): a background cleaner rewrites old segments keeping only the latest record per key; a null value (tombstone) deletes the key after <code>delete.retention.ms</code>. Turns a topic into a changelog of current state: used for <code>__consumer_offsets</code>, CDC tables, Kafka Streams state stores.</li><li><strong>Tiered storage</strong> (KIP-405, production-ready since 3.9): closed segments are copied to object storage; brokers keep only <code>local.retention.ms</code> (hours to a day). Benefits: months of retention at object-storage cost, much faster broker replacement and rebalancing (only the hot tail moves), and old reads served from the remote tier without evicting hot data from the page cache.</li></ul>'],
    ['Exactly-once semantics', '<p><strong>Idempotent producer</strong> (default since Kafka 3.0): the broker keeps the last 5 sequence numbers per (producer id, partition) and drops duplicates from retries, so a retry cannot duplicate or reorder a batch. <strong>Transactions</strong> make writes to several partitions plus the consumer offset commit atomic; zombie instances are fenced by epoch; <code>read_committed</code> consumers read only up to the last stable offset and skip aborted data. Together this gives exactly-once <em>processing</em> for Kafka-to-Kafka pipelines (Kafka Streams <code>processing.guarantee=exactly_once_v2</code>, Flink’s two-phase-commit sink). It does not extend to arbitrary external systems: an email sent or an HTTP call made cannot be rolled back, so those need idempotency keys or the transactional outbox pattern.</p>'],
    ['Log vs queue: Kafka vs SQS-style', '<table><tr><th></th><th>Log (Kafka, Event Hubs, Kinesis)</th><th>Queue (SQS, Service Bus, RabbitMQ)</th></tr><tr><td>Consumption</td><td>Offset per partition; data stays</td><td>Message deleted after ack</td></tr><tr><td>Replay</td><td>Any offset or timestamp</td><td>No (except archive features)</td></tr><tr><td>Fan-out</td><td>Many groups for free</td><td>Topics/subscriptions copy messages</td></tr><tr><td>Ordering</td><td>Per partition</td><td>None (standard) or per message group (FIFO)</td></tr><tr><td>Parallelism</td><td>Capped by partitions</td><td>Any number of consumers</td></tr><tr><td>Per-message retry, delay, DLQ</td><td>Built by hand (retry topics)</td><td>Built in (visibility timeout, redrive)</td></tr><tr><td>Ops model</td><td>Capacity planning, partitions</td><td>Serverless, pay per request</td></tr></table><p>Use a log for event streams, CDC, analytics and event sourcing; use a queue for task distribution where each job is independent and needs its own retry and dead-lettering.</p>']
  ],
  scale: [
    '<strong>Throughput per partition</strong> is bounded by one leader and one consumer thread: size partitions at ~5-10 MB/s and add partitions (and keys with good cardinality) for more.',
    '<strong>Hot partitions</strong> from skewed keys: salt or re-key the hottest keys, or split the topic; monitor bytes-in per partition, not just per broker.',
    '<strong>Rebalancing data</strong> after adding brokers: use Cruise Control or the managed service’s balancer; tiered storage makes moves cheap because only local segments move.',
    '<strong>Consumer lag</strong>: alert on lag in time, not records; scale consumers up to the partition count, then increase partitions or batch harder; slow side effects go behind their own queues.',
    '<strong>Cross-region</strong>: separate cluster per region with MirrorMaker 2 or Cluster Linking for DR and aggregation; offsets are translated, and producers use local clusters to keep latency off the critical path.'
  ],
  tradeoffs: [
    ['Durability vs latency', 'acks=1 vs acks=all + min.insync.replicas=2', 'acks=all for business events (a few ms more); acks=1 or 0 only for metrics and logs where tail loss is acceptable.'],
    ['Log vs queue', 'Kafka-style log vs SQS-style queue', 'Log for streams, replay and many consumers; queue for independent tasks needing per-message retry, delay and DLQ. Many platforms run both.'],
    ['Partition count', 'Few large vs many small partitions', 'Enough for peak consumer parallelism with headroom (repartitioning is disruptive), but not thousands per topic: each adds open files, replication and recovery work.'],
    ['Storage', 'Local disks only vs tiered vs diskless', 'Tiered: hot tail local for low latency, history in object storage. Diskless (WarpStream-style) for cost-driven, latency-tolerant workloads.'],
    ['Delivery semantics', 'At-least-once + idempotent consumers vs transactions', 'At-least-once with idempotent sinks for most services; transactions for Kafka-to-Kafka stream processing that must not double count.']
  ],
  failures: [
    ['Broker crash', 'Controller elects a new leader from the ISR in seconds; idempotent producers retry without duplicates; the broker re-syncs on return.'],
    ['Zone outage', 'Rack-aware placement puts the 3 replicas in 3 zones; acks=all still succeeds with 2; capacity planned for +50% load per surviving broker.'],
    ['ISR shrinks to 1', 'With min.insync.replicas=2 producers get NotEnoughReplicas instead of silently risking loss; alert on under-replicated and under-min-ISR partitions.'],
    ['Consumer crashes mid-batch', 'Uncommitted offsets mean the batch is redelivered to another member: make processing idempotent (upserts, dedup keys).'],
    ['Poison message', 'Catch per-record errors, send the record to a dead-letter topic with error headers, commit, and continue; do not block the partition forever.'],
    ['Controller quorum loss', 'Data plane keeps serving with existing leaders; no metadata changes until quorum returns. Run 3 or 5 controllers across zones.'],
    ['Disk fills up', 'Retention and tiered storage bound local usage; quotas cap noisy producers; alert at 70% disk and on tiering lag.']
  ],
  cloud: [['Managed Kafka / event streaming', 'stream'], ['Classic queue (contrast)', 'queue'], ['Pub/sub and event routing', 'pubsub'], ['Self-managed Kafka (Strimzi operator)', 'k8s'], ['Brokers on VMs', 'vms'],
    ['Tiered storage', 'blob'], ['Schema registry', 'Event Hubs schema registry', 'AWS Glue Schema Registry'], ['Stream processing', 'streamproc'], ['Connectors / ETL to the lake', 'etl'],
    ['Private networking', 'network'], ['TLS certificates and SASL secrets', 'secrets'], ['Metrics, lag and alerts', 'monitor'], ['Broker logs', 'logs']],
  refs: { az: ['azMessaging', 'azEventDriven', 'azp-publisher-subscriber', 'azp-competing-consumers', 'azp-queue-based-load-leveling', 'azp-sequential-convoy', 'azPartition'],
          aws: ['awsPubSub', 'awsOutbox', 'blBacklog', 'awsEventSourcing', 'awsAnalyticsLens', 'blBackoff'] },
  questions: [
    ['How does Kafka guarantee an acknowledged message is not lost?', 'With replication factor 3, acks=all and min.insync.replicas=2, a record is acknowledged only once every in-sync replica (at least 2, in different zones) has it, and leaders are only elected from the ISR. Losing any single broker therefore keeps every acknowledged record.'],
    ['Why is Kafka so fast?', 'Sequential appends and reads, batching and compression end to end, the OS page cache instead of an application cache, zero-copy sendfile to consumers, and a simple offset model with no per-message state on the broker.'],
    ['How do you get exactly-once processing?', 'Idempotent producers remove retry duplicates; transactions atomically commit output records and the consumer offsets; read_committed consumers ignore aborted data. Outside Kafka, make sinks idempotent or use the outbox pattern.'],
    ['How many partitions should a topic have?', 'Enough for peak throughput (target ~5-10 MB/s per partition) and for the maximum number of consumers you will run in a group, with headroom, because adding partitions later remaps keys and breaks per-key order across the change.'],
    ['When would you choose SQS or Service Bus instead?', 'For task queues where each message is independent, consumers scale beyond any partition count, and you want per-message visibility timeouts, delays, retries and dead-letter queues without managing capacity. Choose a log when you need replay, multiple consumers or ordered event streams.'],
    ['What changed with KRaft?', 'Metadata moved from ZooKeeper into a Raft-replicated log inside Kafka (ZooKeeper support was removed in 4.0): one system to operate, faster controller failover, and clusters with millions of partitions.']
  ],
  related: ['messaging', 'ad-click', 'job-scheduler', 'kv-store', 'notification']
});

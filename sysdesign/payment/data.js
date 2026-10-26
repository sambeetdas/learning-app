SD.renderCase({
  slug: 'payment',
  summary: 'A payment system moves money between parties that do not trust each other, over networks that time out, retry and occasionally lie. Its job is to make every movement happen <strong>exactly once</strong> and to be able to prove it. The building blocks are: <strong>idempotency keys</strong> on every mutating API so client retries are safe; an explicit <strong>payment state machine</strong> (created, authorised, captured, refunded, failed) driven by responses from PSPs, acquirers and card networks; a <strong>double-entry ledger</strong> of immutable entries where every transaction balances to zero; <strong>idempotent consumers plus a transactional outbox</strong> so events and ledger postings are neither lost nor duplicated; daily <strong>reconciliation</strong> against the settlement files banks and acquirers send; <strong>tokenisation</strong> so raw card numbers live only in a small PCI DSS vault; and a <strong>fraud check</strong> on the critical path. A digital wallet adds stored balances and peer-to-peer transfers on the same ledger.',
  examples: 'Stripe, Adyen, PayPal / Venmo, Square, Braintree, Checkout.com; wallets such as Apple Pay (tokenised cards), Google Pay, Alipay, Paytm and Revolut; Uber, Airbnb and marketplaces run internal payment platforms of this shape.',
  functional: ['Merchants create and confirm payments (cards, wallets, bank transfers) via API and client SDKs.', 'Authorise, capture (full or partial), void and refund; handle 3-D Secure challenges.', 'Users hold a wallet balance: top up from a card or bank, pay merchants, send money peer to peer, withdraw.', 'Record every money movement in a double-entry ledger; show balances and statements.', 'Notify merchants of state changes via signed webhooks.', 'Reconcile with acquirer and bank settlement files daily; pay out merchant balances.'],
  nonFunctional: ['Exactly-once money movement: no double charges, no lost payments, under any retry or crash.', 'Ledger always balances; entries are immutable and auditable for 7-10 years.', 'Authorisation p95 under 1.5 s end to end (PSP and issuer included); our own overhead under 100 ms.', '99.99%+ availability for the payment API (each minute down is lost revenue for every merchant).', 'PCI DSS compliance with the smallest possible cardholder data environment; strong encryption and audit.', 'Fraud loss under ~0.1% of volume without blocking good customers.'],
  outOfScope: ['Issuing cards and running a bank core.', 'Crypto rails.', 'Tax and invoicing.'],
  estimates: [
    ['Payments', '50 M/day &rArr; ~580/s avg, ~5,000/s peak', 'Peak ~8&times; average on Black Friday / Singles Day'],
    ['Wallet transfers', '20 M/day &rArr; ~230/s avg, ~2,000/s peak', 'P2P and wallet purchases'],
    ['Ledger entries', '~6 per payment &rArr; ~300 M/day, ~30,000/s peak', 'Authorisation hold, capture, merchant credit, fees, settlement legs'],
    ['Ledger storage', '300 M &times; 200 B &asymp; 60 GB/day &asymp; 22 TB/year', 'Kept 7-10 years for regulators &rArr; ~200 TB'],
    ['Idempotency records', '~70 M/day &times; 1 KB &asymp; 70 GB/day', 'Retained 7 days &rArr; ~500 GB'],
    ['In-flight requests at peak', '~5,000', '5,000/s &times; ~1 s average PSP latency (Little’s law): the service must be fully asynchronous'],
    ['Webhooks', '~150 M/day', '~3 events per payment, retried with backoff for up to 3 days'],
    ['Settlement records to reconcile', '~70 M lines/day', 'Acquirer, bank and wallet partner files, one or more per partner per day']
  ],
  compute: [
    ['Payment API + state machine', '~48 pods of 4 vCPU across 3 zones', '5,000 req/s &times; ~15 ms CPU = 75 cores &rArr; 125 at 60% &asymp; 32 pods; &times;1.5 to survive a zone loss. Non-blocking I/O because each request waits ~1 s on the PSP.'],
    ['Fraud scoring', '~12 pods of 8 vCPU + feature store', '5,000/s &times; ~10 ms (gradient-boosted model on CPU, ~200 features) = 50 busy cores &rArr; ~84 at 60%; online feature reads must stay under ~20 ms p99.'],
    ['Payments DB', 'PostgreSQL, sharded by merchant_id (8 shards)', 'Each payment ~5 writes (payment, idempotency row, state history, outbox) &times; 5,000/s = 25,000 writes/s &rArr; ~3,000/s per shard with synchronous standby.'],
    ['Ledger DB', 'Sharded relational (or distributed SQL), ~16 shards', '30,000 entries/s at peak written as ~5,000 balanced transactions/s; hot internal accounts (fees, clearing) are split into sub-accounts to avoid row contention.'],
    ['Reconciliation batch', '~20 Spark workers, ~30 min per daily run', '70 M lines joined against ledger and payment records by PSP reference; unmatched items (~0.01%) go to an exceptions queue for operations.']
  ],
  api: [
    ['POST /v1/payment_intents  (Idempotency-Key)  {amount, currency, customer, payment_method}', 'Create a payment; amount in integer minor units (1999 = 19.99 EUR); payment_method is a token, never a card number.'],
    ['POST /v1/payment_intents/{id}/confirm', 'Runs fraud check and authorisation; returns succeeded, requires_action (3-D Secure) or processing.'],
    ['POST /v1/payment_intents/{id}/capture  {amount?}', 'Capture all or part of an authorisation (e.g. at shipment); idempotent.'],
    ['POST /v1/refunds  (Idempotency-Key)  {payment_intent, amount}', 'Refunds are new ledger transactions, never edits of old ones.'],
    ['POST /v1/wallets/{id}/transfers  (Idempotency-Key)  {to, amount}', 'P2P transfer; succeeds only if the available balance covers it.'],
    ['POST /v1/tokens  (from the client SDK to the vault)', 'Card details go straight from the browser/app to the PCI vault, which returns a token; the merchant’s servers never see the PAN.'],
    ['Webhook: payment_intent.succeeded, charge.refunded, payout.paid', 'Signed (HMAC with timestamp), delivered at least once, retried with backoff; merchants dedupe by event id.']
  ],
  data: [
    ['idempotency_key', 'Payments DB (same shard as the payment)', 'PK (merchant_id, key); request_hash, status IN_PROGRESS | COMPLETED, response, locked_until, created_at; reused key with a different request body &rArr; 422.'],
    ['payment', 'Payments DB, sharded by merchant_id', 'payment_id, merchant_id, amount, currency, status, psp, psp_reference (unique), version; payment_event history table for every transition.'],
    ['ledger_transaction, ledger_entry', 'Ledger DB, append-only', 'entry(entry_id, txn_id, account_id, amount signed integer, currency, posted_at). Invariant: sum(amount) per txn = 0 per currency. No UPDATE or DELETE grants.'],
    ['account (balance projection)', 'Ledger DB, sharded by account_id', 'account_id, type (asset, liability, revenue, expense), currency, posted_balance, available_balance, version; derived from entries, used for balance checks.'],
    ['outbox, processed_event', 'Same DB as the writer / consumer', 'Outbox rows written in the business transaction; consumers record processed event ids in their own transaction for exactly-once effects.'],
    ['card vault', 'Isolated PCI DSS environment', 'token &rarr; PAN encrypted with keys in an HSM; network tokens where available; access only from the PSP connector.'],
    ['settlement file, recon result', 'Object storage + warehouse', 'Raw files kept immutable; parsed lines matched by psp_reference, amount, currency and date; breaks tracked to resolution.']
  ],
  dbChoice: [
    ['Payments and idempotency', 'Relational (PostgreSQL / Aurora / Azure SQL)', 'Payment, idempotency key and outbox must commit atomically; state transitions need conditional updates; strong consistency is non-negotiable.', 'DynamoDB / Cosmos DB with transactional writes and conditional expressions also work and scale without manual sharding.'],
    ['Ledger', 'Relational append-only tables (or distributed SQL: Spanner, CockroachDB, Aurora DSQL)', 'Balanced multi-entry transactions, constraints, point-in-time audit, SQL for finance teams. Immutability enforced by permissions and hash chaining.', 'Amazon QLDB is discontinued; Azure Confidential Ledger or hash-chained tables can add tamper evidence; an event store works but complicates balance queries.'],
    ['Events', 'Kafka / Event Hubs', 'Durable, ordered per key (payment_id), replayable for rebuilding projections and feeding analytics and webhooks.', 'Queues without replay: lose the ability to rebuild state.'],
    ['Reconciliation', 'Object storage + Spark / warehouse', 'Large daily batch joins over tens of millions of rows; cheap and repeatable.', 'Running matching queries on the OLTP ledger: harms production latency.']
  ],
  diagram: {
    nodes: [['m', 'Merchant / app', 'client', 0, 1.2, 'server + client SDK'], ['vault', 'Token vault', 'svc', 1, 0, 'PCI zone, HSM keys'], ['gw', 'API gateway', 'apigw', 1, 1.2, 'auth, rate limits'],
      ['pay', 'Payment service', 'svc', 2, 1.2, 'idempotency, states'], ['risk', 'Fraud / risk', 'ml', 2, 2.4, 'score < 50 ms'], ['psp', 'PSP connector', 'svc', 3, 0.2, 'routing, retries'],
      ['net', 'Acquirers + cards', 'ext', 4, 0.2, 'Visa, Mastercard, banks'], ['wal', 'Wallet service', 'svc', 3, 1.3, 'balances, P2P'], ['pdb', 'Payments DB', 'db', 3, 2.4, 'payments + outbox'],
      ['led', 'Ledger service', 'svc', 4, 1.3, 'double entry'], ['ldb', 'Ledger DB', 'db', 5, 1.3, 'immutable entries'], ['bus', 'Event stream', 'stream', 4, 2.4, 'Kafka'],
      ['wh', 'Webhook sender', 'worker', 5, 3.3, 'signed, retried'], ['rec', 'Reconciliation', 'job', 6, 0.3, 'settlement files']],
    edges: [['m', 'vault', 'card'], ['m', 'gw'], ['gw', 'pay'], ['pay', 'risk'], ['pay', 'psp'], ['vault', 'psp', 'detokenise'], ['psp', 'net'], ['pay', 'wal'], ['pay', 'pdb'], ['wal', 'led'], ['led', 'ldb'],
      ['pdb', 'bus', 'outbox', 'async'], ['bus', 'led', 'post', 'async'], ['bus', 'wh', '', 'async'], ['net', 'rec', 'files', 'async'], ['rec', 'ldb']]
  },
  flows: [
    { name: 'Card payment (authorise)', desc: 'A shopper pays 49.00 EUR; the merchant server confirms the payment with an idempotency key.', steps: [
      ['m', 'vault', 'card details to vault', 'The client SDK sends the card number straight to the PCI vault, which returns a token. The merchant and most of our platform never touch the PAN, which keeps them out of PCI scope.'],
      ['m', 'gw', 'POST confirm (Idem-Key K)', 'The merchant server confirms the payment intent with the token and an idempotency key it generated once for this order.'],
      ['gw', 'pay', 'route', 'Authenticated by API key; per-merchant rate limits applied.'],
      ['pay', 'pdb', 'INSERT idem K IN_PROGRESS', 'Insert (merchant, K) with a unique constraint. If it already exists and is COMPLETED, return the stored response; if IN_PROGRESS, return 409 so the client retries later.'],
      ['pay', 'risk', 'score payment', 'Device, velocity, amount, BIN, IP and history features feed a model; high risk triggers 3-D Secure or a decline.'],
      ['pay', 'psp', 'authorise 4900 EUR', 'The connector picks an acquirer (routing by cost and success rate) and passes our payment id as its idempotency reference.'],
      ['vault', 'psp', 'detokenise inside PCI zone', 'Only the connector, inside the cardholder data environment, swaps the token for the card number or a network token.'],
      ['psp', 'net', 'ISO 8583 auth request', 'The acquirer sends the request through the card network to the issuing bank, which approves and places a hold on the cardholder’s funds.'],
      ['pay', 'pdb', 'AUTHORISED + outbox + idem', 'One transaction: payment status to AUTHORISED (guarded by expected status), the idempotency record to COMPLETED with the response, and a PaymentAuthorised outbox row.'],
      ['pay', 'gw', '200 succeeded', 'The merchant gets the result in about a second.', 'resp']],
      end: 'Idempotency key, guarded state transition and outbox row all commit in one local transaction, so a retry at any point cannot charge twice or lose the event.' },
    { name: 'Ledger posting (exactly-once)', desc: 'The captured payment is recorded in the double-entry ledger from the event stream.', steps: [
      ['pdb', 'bus', 'PaymentCaptured (outbox)', 'The relay publishes the outbox row to Kafka. Delivery is at least once: the relay may publish the same event twice after a crash.', 'async'],
      ['bus', 'led', 'consume event e-9001', 'The ledger service consumes events partitioned by payment id, so events for one payment arrive in order.', 'async'],
      ['led', 'ldb', 'BEGIN; check processed e-9001', 'Within one transaction it first inserts e-9001 into processed_event (unique). A duplicate delivery fails this insert and is skipped.'],
      ['led', 'ldb', 'INSERT balanced entries', 'Debit acquirer receivable 4900, credit merchant payable 4753, credit fee revenue 147. Sum is zero, checked before commit.'],
      ['ldb', 'led', 'COMMIT', 'The dedupe record and the entries commit together: the effect happens exactly once even though the delivery was at-least-once.', 'resp'],
      ['bus', 'wh', 'deliver webhook', 'Independently, the webhook sender delivers payment_intent.succeeded to the merchant, signed and retried; the merchant dedupes by event id.', 'async']],
      end: 'Exactly-once = at-least-once delivery + idempotent consumer. The outbox removes the dual-write problem; the processed-event table removes duplicates.' },
    { name: 'Wallet P2P transfer', desc: 'Ana sends 20.00 EUR from her wallet balance to Ben.', steps: [
      ['m', 'gw', 'POST transfer (Idem-Key T)', 'The app sends the transfer with an idempotency key.'],
      ['gw', 'pay', 'route', 'The payment service records the request and its idempotency key as before.'],
      ['pay', 'risk', 'P2P risk check', 'Checks for account takeover, mule patterns and sanctions screening of the recipient.'],
      ['pay', 'wal', 'transfer 2000 Ana to Ben', 'The wallet service owns the balance rule: no overdraft.'],
      ['wal', 'led', 'post txn with balance guard', 'A single ledger transaction: debit Ana 2000, credit Ben 2000, applied only if Ana’s available balance is at least 2000 (conditional update on her balance row, version checked).'],
      ['led', 'ldb', 'entries + balances, one tx', 'If both accounts are on the same shard this is one local transaction; across shards it uses a pending-transfer saga (hold on Ana, credit Ben, finalise).'],
      ['led', 'wal', 'posted', 'Both balances updated atomically.', 'resp'],
      ['pay', 'gw', '200 transfer completed', 'Ben gets a push notification from the event stream consumers.', 'resp']],
      end: 'A wallet is just ledger accounts with a balance invariant; the ledger enforces it, not the app.' },
    { name: 'PSP timeout (unknown outcome)', desc: 'The acquirer does not answer within 10 s. Did the card get charged?', steps: [
      ['pay', 'psp', 'authorise 4900', 'The request is sent with our payment id as the idempotency reference.'],
      ['psp', 'pay', 'timeout after 10 s', 'The outcome is unknown: the issuer may have approved it. Retrying blindly with a new reference could charge twice; declining could lose a paid order.', 'err'],
      ['pay', 'pdb', 'status UNKNOWN', 'Record the ambiguous state and tell the merchant processing; do not guess.'],
      ['pay', 'psp', 'query by reference (retry)', 'Retry the same request with the same idempotency reference, or call the PSP’s status endpoint. The PSP deduplicates, so this is safe.'],
      ['psp', 'pay', 'was approved', 'The original attempt had succeeded.', 'resp'],
      ['pay', 'pdb', 'AUTHORISED + outbox', 'Resolve the state; the merchant learns via webhook.'],
      ['net', 'rec', 'settlement file next day', 'If the PSP had stayed unreachable, the next settlement file is the final source of truth: reconciliation would either confirm the charge or trigger an automatic reversal.', 'async']],
      end: 'Never treat a timeout as a failure. Resolve unknown outcomes by idempotent retry or status query, and let reconciliation catch anything left over.' },
    { name: 'Daily reconciliation', desc: 'Prove that our ledger matches what the banks actually moved.', steps: [
      ['net', 'rec', 'settlement files (SFTP)', 'Each acquirer delivers files listing every settled transaction, fees, chargebacks and the net amount paid to our bank account. Raw files are stored immutably, then parsed into one normalised format.', 'async'],
      ['rec', 'ldb', 'match by psp_reference', 'Three-way match: settlement line vs payment record vs ledger entries (amount, currency, date, fee).'],
      ['ldb', 'rec', '99.99% matched', 'Matched items are marked settled; the clearing account for that day should net to zero.', 'resp'],
      ['rec', 'ldb', 'post fee and FX adjustments', 'Differences with known causes (interchange fees, currency conversion) are posted as new adjusting ledger transactions, never edits.'],
      ['rec', 'ldb', 'flag 0.01% breaks', 'Unmatched items (missing on either side, amount or currency mismatch) become exceptions with an owner and an SLA; payouts for the affected funds are held until resolved.', 'err']],
      end: 'Reconciliation is the safety net that catches bugs, partner errors and missed events; an unexplained break is treated as an incident.' }
  ],
  components: [
    ['Client SDK + token vault', 'Collect card data in an iframe or native SDK and tokenise it in the PCI zone; supports network tokens and wallet tokens (Apple Pay, Google Pay).'],
    ['API gateway', 'API keys / OAuth, per-merchant rate limits, request signing, TLS.'],
    ['Payment service', 'Idempotency, payment state machine, 3-D Secure orchestration, routing decisions.'],
    ['Fraud / risk service', 'Real-time ML scoring, rules, velocity limits, sanctions screening; decisions are logged for audit and model training.'],
    ['PSP connector', 'Adapters per acquirer/PSP, smart routing, retries with the same reference, failover between PSPs.'],
    ['Wallet service', 'Customer balances, top-ups, P2P transfers, withdrawals, limits and KYC tiers.'],
    ['Ledger service', 'Double-entry postings, balance projections, statements, immutable audit trail.'],
    ['Event stream + outbox relay', 'Reliable publication of state changes to ledger, webhooks, analytics and notifications.'],
    ['Webhook sender', 'Signed, retried, per-merchant ordered delivery with a dead-letter view in the dashboard.'],
    ['Reconciliation', 'Ingest settlement files, three-way matching, adjustments, exception workflow, payouts.']
  ],
  deep: [
    ['Idempotency keys done properly', '<ol><li>The client generates a unique key per logical operation (UUIDv4) and reuses it on every retry.</li><li>The server inserts <code>(merchant_id, key, request_hash, status=IN_PROGRESS)</code> with a unique constraint <em>before</em> doing any work.</li><li>On conflict: if COMPLETED, return the stored response byte for byte; if IN_PROGRESS, return 409 (or wait briefly); if the request body hash differs, return 422.</li><li>The final state change and the stored response are written in the same transaction as the payment update.</li><li>Downstream calls (PSP, ledger) carry derived keys (payment id + step), so every hop is idempotent, not only the edge.</li><li>Keys expire after a retention window (e.g. 24 hours to 7 days); after that the same key is a new request.</li></ol>'],
    ['Payment state machine', '<p>States: <code>CREATED &rarr; REQUIRES_ACTION (3DS) &rarr; AUTHORISED &rarr; CAPTURED &rarr; SETTLED</code>, with <code>FAILED</code>, <code>VOIDED</code>, <code>REFUNDED / PARTIALLY_REFUNDED</code>, <code>DISPUTED</code> and <code>UNKNOWN</code> (ambiguous PSP outcome) as side states.</p><pre><code>UPDATE payment\n   SET status = &#39;CAPTURED&#39;, version = version + 1\n WHERE payment_id = :id\n   AND status = &#39;AUTHORISED&#39;     -- only legal predecessor\n   AND version = :v;\n-- 0 rows =&gt; illegal or concurrent transition: re-read, do not retry blindly</code></pre><p>Every transition is also appended to a payment_event table and the outbox. Webhooks from PSPs can arrive out of order or twice; the guard makes them harmless. Authorisations expire (typically 7 days for cards), so a scheduler voids or re-authorises stale ones.</p>'],
    ['Double-entry ledger', '<p>Every movement is a transaction of two or more entries that sum to zero per currency. Amounts are integers in minor units; never floating point.</p><div class="table-wrap"><table><tr><th>Txn: capture 49.00 EUR</th><th>Debit</th><th>Credit</th></tr><tr><td>Acquirer receivable (asset)</td><td>4,900</td><td></td></tr><tr><td>Merchant payable (liability)</td><td></td><td>4,753</td></tr><tr><td>Fee revenue</td><td></td><td>147</td></tr></table></div><ul><li><strong>Immutable:</strong> corrections are new reversing transactions; the database role has INSERT but no UPDATE or DELETE; entries can be hash-chained for tamper evidence.</li><li><strong>Balances are projections</strong> of entries, kept transactionally for accounts that need balance checks (wallets) and computed asynchronously for others.</li><li><strong>Hot accounts</strong> (platform fees, clearing) touched by every payment are split into N sub-accounts and summed when read, avoiding row contention.</li><li><strong>Invariants checked continuously:</strong> sum of all entries = 0; each clearing account nets to zero after settlement.</li></ul>'],
    ['PSP and card network integration', '<ul><li><strong>Authorise vs capture:</strong> authorisation reserves funds at the issuer; capture requests the money; settlement moves it (T+1 or T+2) minus interchange and scheme fees.</li><li><strong>3-D Secure 2</strong> (strong customer authentication under PSD2 in Europe) adds a challenge step; risk-based exemptions avoid friction for low-risk payments.</li><li><strong>Smart routing:</strong> choose acquirer by card type, region, cost and live success rate; fail over to a second PSP when one degrades (circuit breaker).</li><li><strong>Network tokens</strong> replace PANs with scheme tokens that survive card reissue and raise approval rates.</li><li><strong>Disputes and chargebacks</strong> arrive weeks later through the acquirer and become new ledger transactions plus a merchant workflow.</li></ul>'],
    ['PCI scope reduction and fraud', '<p><strong>Tokenisation</strong> keeps the cardholder data environment tiny: the client SDK posts card data directly to the vault (hosted fields / iframe), the vault encrypts the PAN with HSM-held keys and returns a token, and only the PSP connector inside the same segmented network may detokenise. Everything else, including the payment service, ledger and merchants, handles tokens only, which shrinks the PCI DSS audit from the whole platform to a few services.</p><p><strong>Fraud</strong> runs synchronously before authorisation with a strict latency budget (~50 ms): a gradient-boosted model over device fingerprint, velocity (cards per device, attempts per minute), BIN country vs IP country, amount anomalies and graph features (shared devices or addresses across accounts). Outcomes: approve, challenge (3DS), review, or decline. Labels arrive late (chargebacks after weeks), so models are retrained on matured data and monitored for drift.</p>']
  ],
  scale: [
    '<strong>Payments DB:</strong> shard by merchant_id; very large merchants get dedicated shards or cells so their peak does not affect others.',
    '<strong>Ledger hot spots:</strong> split hot internal accounts into sub-accounts; batch postings for high-volume merchants; keep balance projections only where checks require them.',
    '<strong>PSP latency dominates:</strong> fully asynchronous I/O, connection pools per acquirer, and timeouts with idempotent retries; throughput scales with concurrency, not CPU.',
    '<strong>Cells:</strong> deploy the payment stack as independent cells by merchant group and region to limit blast radius and meet data-residency rules.',
    '<strong>Reconciliation and analytics</strong> run on replicas and the warehouse, never on the OLTP primaries.'
  ],
  tradeoffs: [
    ['Ledger posting', 'Synchronous in the payment request vs asynchronous from events', 'Async from the outbox for card payments (keeps the API fast and the ledger decoupled); synchronous for wallet transfers, where the balance check is the business rule.'],
    ['Consistency model', 'Distributed transactions vs local transactions + outbox + idempotent consumers', 'Local transactions and idempotent consumers: works across PSPs and services that cannot join a 2PC, and failures are recoverable by replay.'],
    ['Ledger store', 'Relational vs event store vs ledger database', 'Relational append-only tables with strict permissions and hash chaining: familiar, queryable by finance, strongly consistent. (QLDB is no longer an option.)'],
    ['Multi-PSP', 'One PSP vs several with routing', 'Several: higher approval rates, lower fees, and resilience when a PSP has an outage, at the cost of more adapters and reconciliation sources.'],
    ['Fraud strictness', 'Block more vs approve more', 'Tune thresholds per merchant risk appetite; use 3-D Secure as the middle option rather than outright declines.']
  ],
  failures: [
    ['Client retries after a timeout', 'Idempotency key returns the original result; no second charge.'],
    ['PSP times out (unknown outcome)', 'Mark UNKNOWN, retry with the same reference or query status; reconciliation resolves anything left; never re-send with a new reference.'],
    ['Outbox relay or Kafka down', 'Payments still commit; events publish when the relay recovers; ledger and webhooks catch up in order.'],
    ['Duplicate event delivered', 'Consumers record processed event ids in the same transaction as their effect; duplicates are skipped.'],
    ['PSP outage', 'Circuit breaker opens; route new payments to the secondary PSP; in-flight UNKNOWN payments resolved later.'],
    ['Ledger imbalance detected', 'Treat as a sev-1 incident: freeze affected payouts, find the source by transaction, post correcting entries; invariant checks run continuously.'],
    ['Settlement file missing or late', 'Alert per partner SLA; reconciliation waits and re-runs; payouts for unreconciled funds are held.']
  ],
  cloud: [['API gateway', 'apigw'], ['WAF', 'waf'], ['Services', 'k8s'], ['Payments DB', 'sql'], ['Scale-out ledger option', 'distsql'], ['Tamper-evident ledger', 'ledger'], ['Event stream', 'stream'], ['Webhook and retry queues', 'queue'], ['Fraud models', 'ml'], ['Online fraud features', 'featurestore'], ['Keys, HSM and secrets', 'secrets'], ['Reconciliation batch', 'bigdata'], ['Settlement files', 'blob'], ['Finance analytics', 'warehouse'], ['Private networking for the PCI zone', 'network'], ['Monitoring and audit', 'monitor']],
  refs: { az: ['azOutbox', 'azp-saga', 'azp-compensating-transaction', 'azp-event-sourcing', 'azp-retry', 'azp-circuit-breaker', 'azMission', 'azp-gatekeeper'],
          aws: ['awsFsiLens', 'awsOutbox', 'awsSagaOrch', 'awsEventSourcing', 'awsRetry', 'awsCircuit', 'blBackoff', 'awsDdbBest'] },
  questions: [
    ['How do you guarantee a customer is never charged twice?', 'Idempotency at every hop: the merchant’s idempotency key is stored with a unique constraint before any work, the PSP receives our payment id as its idempotency reference, state transitions are guarded updates, and reconciliation catches anything that slipped through by comparing against the settlement files.'],
    ['What does exactly-once actually mean here?', 'Messages are delivered at least once (outbox relays and brokers can redeliver), but effects are applied exactly once because each consumer records the event id in the same database transaction as its effect. Duplicates fail the unique insert and are skipped.'],
    ['Why double-entry rather than just a balance column?', 'A balance column tells you what you have but not why. Double-entry makes every movement a balanced, immutable transaction between accounts, so money cannot appear or vanish, the books can be audited at any point in time, and invariants (everything sums to zero) detect bugs automatically.'],
    ['How do you handle a payment whose outcome is unknown?', 'Record it as UNKNOWN, retry with the same idempotency reference or query the PSP’s status API, inform the merchant it is processing, and rely on the settlement file as the final source of truth, reversing automatically if needed.'],
    ['How do you reduce PCI DSS scope?', 'Collect card data with hosted fields or SDKs that post directly to a tokenisation vault in an isolated network segment with HSM-managed keys; everything else stores and passes tokens only. Network tokens and wallet tokens reduce exposure further.'],
    ['How would you shard the ledger?', 'By account (so balance checks are single-shard), with transactions that span shards handled as pending transfers (hold, credit, finalise), or use a distributed SQL database that provides cross-shard transactions. Split hot internal accounts into sub-accounts.']
  ],
  related: ['ecommerce', 'ticket-booking', 'stock-exchange', 'message-queue', 'unique-id']
});

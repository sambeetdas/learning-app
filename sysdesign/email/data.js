SD.renderCase({
  slug: 'email',
  summary: 'A Gmail-scale email service is a store-and-forward pipeline bolted onto a giant per-user database. Inbound mail arrives over <strong>SMTP</strong> at MX gateways from millions of servers on the internet, most of it unwanted, so the first job is to <strong>reject cheaply and early</strong> (IP reputation, recipient checks, SPF/DKIM/DMARC) and then classify the rest with a spam, phishing and malware pipeline. Accepted mail is split into <strong>metadata</strong> (headers, labels, thread, flags) in a wide-column store keyed by user, and <strong>bodies and attachments</strong> in deduplicated object storage. Each user gets a full-text <strong>search index</strong>, clients stay in sync through a per-user <strong>history log</strong> with push notifications (IMAP IDLE, JMAP, mobile push), and outbound mail is DKIM-signed and sent from IP pools whose <strong>reputation</strong> is managed like a scarce asset.',
  examples: 'Gmail, Outlook.com / Exchange Online, Yahoo Mail, Proton Mail, Fastmail (JMAP); sending platforms such as Amazon SES, SendGrid and Azure Communication Services Email handle the outbound half at scale.',
  functional: ['Receive mail from any internet server for any of our users (SMTP, MX records).', 'Filter spam, phishing and malware; place mail in Inbox, Spam or category tabs.', 'Read, label, archive, delete; conversations grouped into threads.', 'Full-text search over a user’s entire mailbox, including attachments.', 'Sync across web, mobile apps and third-party clients (IMAP, JMAP, REST API) with near-instant new-mail notifications.', 'Send mail with attachments, delivered reliably to other providers.'],
  nonFunctional: ['Never lose an accepted message: once SMTP returns 250 OK it is durable in at least two zones.', 'Inbound delivery to the inbox p95 under 10 s (including filtering).', 'Spam catch rate &gt; 99.9% with false positives (good mail in spam) &lt; 0.05%.', 'Mailbox list p95 under 200 ms; search p95 under 500 ms.', 'Storage cost per GB kept very low: 15 GB+ quotas for a billion users.', '99.9%+ availability; strong privacy: encryption at rest and in transit (TLS for SMTP).'],
  outOfScope: ['Calendar, contacts and chat.', 'Enterprise compliance features (eDiscovery, legal hold) beyond a mention.', 'Training of the spam models themselves (see <a href="../content-moderation/index.html">content moderation</a>).'],
  estimates: [
    ['Active mailboxes', '1 B (500 M daily users)', 'Consumer-scale provider'],
    ['Inbound mail delivered', '30 B/day &rArr; ~350,000/s avg, ~700,000/s peak', '1 B mailboxes &times; 30 messages; peak 2&times;'],
    ['Inbound rejected at the edge', 'roughly as many again', 'Spam from botnets and bad IPs, rejected during the SMTP conversation'],
    ['Outbound sent', '3 B/day &rArr; ~35,000/s avg', '1 B &times; 3 messages'],
    ['New storage', '30 B &times; 75 KB &asymp; 2.25 PB/day raw, ~1 PB/day stored', 'Average incl. attachments; compression and attachment dedupe roughly halve it'],
    ['Metadata', '30 B &times; 1 KB &asymp; 30 TB/day (&times;3 replicas)', 'Headers, labels, thread id, snippet, blob references'],
    ['Client API calls', '500 M &times; 100 = 50 B/day &rArr; ~580,000/s avg, ~1.2 M/s peak', 'List, open, sync, label changes, polling clients'],
    ['Searches', '500 M &times; 2 = 1 B/day &rArr; ~12,000/s avg', 'Most users search a few times a day'],
    ['Search index growth', '30 B &times; ~3 KB &asymp; 90 TB/day', 'Index ~30% of the ~10 KB of text per message']
  ],
  compute: [
    ['MX / SMTP gateways', '~800 servers of 16 vCPU over ~10 regions', 'Accept path ~10 ms CPU (TLS, parsing, spooling) &times; 700,000/s = 7,000 cores; reject path ~1 ms &times; 700,000/s = 700 cores; 7,700 / 0.6 &asymp; 12,800 cores &asymp; 800 servers, anycast or many MX records.'],
    ['Spam, phishing and AV pipeline', '~700 servers of 16 vCPU + a GPU pool', 'Rules, reputation lookups and a gradient-boosted model ~5 ms; AV on the ~15% with attachments ~30 ms &rArr; ~9.5 ms average &times; 700,000/s = 6,650 cores &rArr; ~11,000 at 60%. A transformer classifier runs on GPUs for the ~10% that are borderline.'],
    ['Metadata store (wide-column)', '~500 nodes', '~6 writes per delivered message (message row, 3 label-index rows, thread, history) &times; 700,000/s = 4.2 M writes/s; &times;3 replication = 12.6 M replica writes/s &divide; ~25,000 per node. Reads (1.2 M/s) are mostly served from row cache.'],
    ['Blob storage', '~1 PB/day new, ~700,000 objects/s at peak', 'Bodies under ~64 KB are stored inline in the metadata row, cutting blob writes by ~80%; large bodies and attachments go to object storage, content-addressed.'],
    ['Search indexers', '~150 servers of 16 vCPU', '700,000 messages/s &times; ~2 ms tokenise + segment write = 1,400 cores &rArr; ~2,300 at 60%; consumers of the mail event stream, partitioned by user.']
  ],
  api: [
    ['SMTP :25  EHLO / STARTTLS / MAIL FROM / RCPT TO / DATA', 'Inbound from the internet. Unknown recipients are rejected at RCPT (no backscatter); 250 OK only after the message is durably spooled.'],
    ['SMTP submission :587 (AUTH) or POST /messages/send', 'Outbound from our users; rate-limited per account to stop compromised accounts spamming.'],
    ['GET /threads?label=INBOX&pageToken=', 'List conversations newest first from the label index; returns snippets, not bodies.'],
    ['GET /messages/{id}?format=full|metadata|raw', 'Open a message; the body and attachments are fetched from blob storage lazily.'],
    ['POST /messages/{id}/modify  {addLabels, removeLabels}', 'Archive, star, mark read, move to spam: all are label changes, recorded in the history log.'],
    ['GET /history?startHistoryId=  + push (WebSocket, APNs/FCM, IMAP IDLE, JMAP push)', 'Incremental sync: "what changed since H". Push only says "something changed"; the client then pulls history.'],
    ['GET /search?q=from:alice has:attachment after:2026/01/01', 'Per-user full-text search with operators; results are message ids resolved against metadata.']
  ],
  data: [
    ['message', 'Wide-column (Bigtable / Cassandra / HBase)', 'Row key user_id#message_id (time-ordered id); headers, thread_id, label set, flags, snippet, size, inline body if &lt; 64 KB, blob refs for large parts.'],
    ['label index', 'Wide-column', 'Row key user_id#label_id#reverse_ts &rarr; message_id, thread_id. Listing the inbox is a short prefix scan, never a mailbox scan.'],
    ['thread', 'Wide-column', 'user_id#thread_id &rarr; message ids, participants, latest timestamp, unread count; maintained by the delivery service.'],
    ['history log', 'Wide-column, TTL ~30 days', 'user_id#history_id &rarr; change record (added, deleted, labels changed). Clients that fall too far behind do a full resync.'],
    ['body, attachment', 'Object storage', 'Content hash key, encrypted; reference-counted for dedupe; tiered to cool and archive storage as mail ages.'],
    ['search index', 'Inverted index per user, co-located by user shard', 'Terms from headers, body and extracted attachment text; segments merged in the background.'],
    ['sender reputation', 'Key-value cache + stream updates', 'IP, domain and DKIM-identity scores from spam reports, bounces and traffic patterns.']
  ],
  dbChoice: [
    ['Mailbox metadata', 'Wide-column store keyed by user', 'Every access is scoped to one user and ordered by time; huge write rate; rows grow and shrink independently. Prefix scans on user_id#label give inbox listings cheaply.', 'Relational per-user tables (classic IMAP servers on MySQL): works per shard but painful at a billion users; document stores work but cost more per write.'],
    ['Bodies and attachments', 'Object storage with content addressing', 'Petabytes per day, written once, read rarely after the first week; cheapest durable storage with lifecycle tiering; dedupe of identical newsletters and attachments.', 'Store everything in the wide-column rows: inflates compaction and replication costs.'],
    ['Search', 'Per-user inverted index', 'Queries never span users, so per-user indexes keep posting lists tiny, give natural isolation and allow deleting a user’s data cleanly.', 'One global index filtered by user: huge posting lists, every query touches unrelated users’ data.'],
    ['Reputation and rate data', 'In-memory key-value (Redis)', 'Looked up for every SMTP connection in microseconds; updated continuously.', 'Database lookups per connection: too slow for 1 M+ connections/s.']
  ],
  diagram: {
    nodes: [['snd', 'Internet MTAs', 'ext', 0, 0, 'other mail servers'], ['mx', 'MX gateways', 'gw', 1, 0, 'SMTP, TLS, IP rep'], ['flt', 'Spam + AV filter', 'svc', 2, 0, 'DMARC, ML, sandbox'],
      ['dlv', 'Delivery service', 'svc', 3, 0, 'thread, label, write'], ['blob', 'Message blobs', 'blob', 3, 1.1, 'bodies, attachments'], ['meta', 'Mailbox metadata', 'nosql', 5, 0, 'wide-column by user'],
      ['bus', 'Mail events', 'stream', 6, 0.8, 'change log'], ['ix', 'Indexer', 'worker', 6, 1.7, 'tokenise, extract'], ['idx', 'Search index', 'search', 5, 2.5, 'per-user shards'],
      ['u', 'Users', 'client', 0, 2.3, 'web, mobile, IMAP'], ['gw', 'API gateway', 'apigw', 1, 2.3, 'REST, JMAP, IMAP'], ['mbx', 'Mailbox + sync', 'svc', 3, 2.3, 'list, read, history'],
      ['push', 'Push gateway', 'svc', 1.2, 3.4, 'WebSocket, APNs, FCM'], ['out', 'Outbound MTA', 'svc', 1, 1.15, 'DKIM sign, IP pools']],
    edges: [['snd', 'mx'], ['mx', 'flt'], ['flt', 'dlv'], ['dlv', 'blob'], ['dlv', 'meta'], ['meta', 'bus', 'CDC', 'async'], ['bus', 'ix', '', 'async'], ['ix', 'idx'], ['bus', 'mbx', 'new mail', 'async'],
      ['u', 'gw'], ['gw', 'mbx'], ['mbx', 'meta'], ['mbx', 'blob'], ['mbx', 'idx'], ['mbx', 'push'], ['push', 'u'], ['gw', 'out'], ['out', 'snd', 'SMTP out']]
  },
  flows: [
    { name: 'Inbound delivery', desc: 'A newsletter from a legitimate sender arrives for alice@ourmail.com.', steps: [
      ['snd', 'mx', 'EHLO, STARTTLS, RCPT TO alice', 'The sender looked up our MX records and connected. The gateway checks the IP’s reputation and confirms alice exists before accepting any data.'],
      ['mx', 'flt', 'DATA spooled, 250 OK', 'The message is written to a replicated spool in two zones before replying 250 OK: from this moment we own it and must not lose it.'],
      ['flt', 'dlv', 'verdict: INBOX, Promotions', 'SPF and DKIM pass and align with the From domain (DMARC pass), the attachment is clean, and the spam model scores it low. Category models and alice’s own filters decide the placement and labels.'],
      ['dlv', 'blob', 'PUT large parts by hash', 'Attachments and bodies over 64 KB are stored content-addressed: the same newsletter image sent to a million users is stored once.'],
      ['dlv', 'meta', 'message + label rows + thread', 'One batched write per user: message row, INBOX and Promotions label-index rows, thread update, history entry.'],
      ['meta', 'bus', 'MessageAdded (CDC)', 'The change log publishes the event for indexing and sync.', 'async'],
      ['bus', 'ix', 'index for alice', 'The indexer tokenises headers, body and attachment text into alice’s index shard.', 'async'],
      ['bus', 'mbx', 'new mail for alice', 'The sync service learns that alice’s history advanced.', 'async'],
      ['mbx', 'push', 'notify devices', 'A tiny "mailbox changed" signal goes over open WebSockets and APNs/FCM; it carries no content.'],
      ['push', 'u', 'new mail badge', 'Each client then pulls the history delta. Typically 2-5 s from SMTP to phone.', 'resp']],
      end: 'Accept durably, then process asynchronously: SMTP senders retry for days if we tempfail, but a lost message after 250 OK is unforgivable.' },
    { name: 'Sync and open', desc: 'Alice’s phone wakes up and syncs, then she opens the message.', steps: [
      ['u', 'gw', 'GET /history?start=881200', 'The app remembers the last history id it saw and asks only for changes since then.'],
      ['gw', 'mbx', 'authenticated request', 'OAuth token verified; the request is routed to the service shard holding alice’s mailbox.'],
      ['mbx', 'meta', 'scan user#history > 881200', 'A short range scan returns the 12 changes since the last sync: new messages and label changes.'],
      ['meta', 'mbx', '12 changes + snippets', 'Metadata only: enough to render the inbox list.', 'resp'],
      ['mbx', 'u', 'delta, new history id', 'The app updates its local cache; nothing else is downloaded yet.', 'resp'],
      ['u', 'gw', 'GET /messages/m77?format=full', 'Alice taps the message.'],
      ['mbx', 'blob', 'GET body + inline images', 'Small bodies were inline in the metadata row; this one is large, so it comes from object storage (and is cached for re-opens).'],
      ['mbx', 'u', 'rendered message', 'Remote images are fetched through an image proxy to protect privacy and block tracking pixels.', 'resp']],
      end: 'History ids make sync incremental and idempotent: a client can retry or resume from any point, and push only needs to say "something changed".' },
    { name: 'Search the mailbox', desc: '"invoice from:acme has:attachment" across 9 years of mail.', steps: [
      ['u', 'gw', 'GET /search?q=invoice ...', 'The query is parsed into terms and structured operators (from, has:attachment, date ranges, labels).'],
      ['gw', 'mbx', 'route to alice’s shard', 'Search runs only over alice’s own index.'],
      ['mbx', 'idx', 'query alice index', 'Intersect posting lists for "invoice" and from:acme, filter has_attachment, rank by recency and relevance.'],
      ['idx', 'mbx', 'top 50 message ids', 'Per-user posting lists are small, so this takes tens of milliseconds even for large mailboxes.', 'resp'],
      ['mbx', 'meta', 'batch get metadata', 'Resolve ids to subject, sender, snippet and labels; drop anything deleted since indexing.'],
      ['mbx', 'u', 'results', 'Results appear in ~300 ms. Recent mail not yet indexed is covered by a quick scan of the last few minutes of history.', 'resp']],
      end: 'Per-user indexes keep queries small and isolated; the metadata store remains the source of truth for what still exists.' },
    { name: 'Send with retries', desc: 'Alice sends a message to bob@othermail.example, whose server is briefly overloaded.', steps: [
      ['u', 'gw', 'POST /messages/send', 'Per-account send limits are checked first: a compromised account must not become a spam cannon.'],
      ['gw', 'mbx', 'store in Sent', 'The message is saved to alice’s Sent label (metadata + blob) before any delivery attempt.'],
      ['mbx', 'blob', 'store body', 'Same storage path as inbound mail.'],
      ['gw', 'out', 'enqueue for delivery', 'The outbound queue is keyed by destination domain so one slow provider does not block others.'],
      ['out', 'snd', 'MX lookup, TLS, DKIM-signed', 'The MTA looks up othermail’s MX, connects with STARTTLS (MTA-STS enforced), and sends from an IP pool with good reputation.'],
      ['snd', 'out', '421 try again later', 'A temporary failure. SMTP is designed for this.', 'err'],
      ['out', 'snd', 'retry after backoff', 'Retries with exponential backoff for up to ~5 days; after that, a bounce (DSN) is delivered to alice.'],
      ['snd', 'out', '250 OK', 'Delivered. Bounces and complaints from feedback loops update our sender reputation data.', 'resp']],
      end: 'Outbound is a durable, per-destination retry queue plus careful reputation management; inbound and outbound use the same storage.' },
    { name: 'Spam and spoofing', desc: 'A botnet and a phishing attempt hit the MX gateways, and a user reports spam.', steps: [
      ['snd', 'mx', 'connect from botnet IP', 'The IP is on our reputation blocklist and has a high recent spam rate.'],
      ['mx', 'snd', '554 rejected', 'Rejected during the SMTP conversation: costs ~1 ms of CPU and no storage. The sender, not us, is responsible for any bounce.', 'err'],
      ['snd', 'mx', 'From: security@bank.com', 'Another server sends mail claiming to be from bank.com.'],
      ['mx', 'flt', 'auth checks', 'SPF fails (IP not authorised), DKIM signature is missing, and bank.com publishes DMARC p=reject.'],
      ['flt', 'mx', 'DMARC fail, policy reject', 'The domain owner asked receivers to reject unauthenticated mail, so we do.', 'err'],
      ['mx', 'snd', '550 5.7.26 unauthenticated', 'The spoofed message never reaches anyone.', 'err'],
      ['u', 'gw', 'Report spam on message m91', 'A borderline message reached alice’s inbox and she reports it.'],
      ['gw', 'mbx', 'label SPAM + feedback', 'The label change moves it; a feedback event updates the sender’s reputation and joins the training data for the classifiers.']],
      end: 'Layered defence: cheap reputation checks first, authentication (SPF/DKIM/DMARC) second, content models third, and user feedback closing the loop.' }
  ],
  components: [
    ['MX gateways', 'SMTP termination, TLS, connection rate limits, IP reputation, recipient validation, durable spool.'],
    ['Spam / phishing / AV filter', 'SPF, DKIM, DMARC, ARC checks; reputation; ML classifiers; antivirus and attachment sandboxing; URL rewriting for click-time checks.'],
    ['Delivery service', 'Applies user filters, threads messages, writes metadata and blobs, appends history.'],
    ['Metadata store', 'Wide-column tables for messages, label indexes, threads and history, sharded by user.'],
    ['Blob storage', 'Bodies and attachments, content-addressed, encrypted, lifecycle-tiered.'],
    ['Indexer + search index', 'Per-user inverted indexes, attachment text extraction, background merges.'],
    ['Mailbox + sync service', 'REST/JMAP/IMAP access, history deltas, label operations, quotas.'],
    ['Push gateway', 'WebSocket connections for web, APNs/FCM for mobile, IMAP IDLE for third-party clients.'],
    ['Outbound MTA', 'Per-destination queues, DKIM signing, IP pool selection, retries, bounces, feedback loops.']
  ],
  deep: [
    ['The inbound filtering pipeline', '<ol><li><strong>Connection:</strong> IP reputation (own data plus DNS blocklists), connection and message rate limits per IP and /24, reverse DNS sanity.</li><li><strong>Envelope:</strong> reject unknown recipients at <code>RCPT TO</code>, so we never accept mail we would have to bounce (backscatter).</li><li><strong>Authentication:</strong> <strong>SPF</strong> (is this IP allowed to send for the envelope domain?), <strong>DKIM</strong> (is the cryptographic signature over headers and body valid for the signing domain?), <strong>DMARC</strong> (does SPF or DKIM align with the visible From domain, and what policy does the owner publish: none, quarantine, reject?), and <strong>ARC</strong> to preserve results through forwarders and mailing lists.</li><li><strong>Content:</strong> rules, URL and domain reputation, gradient-boosted models on hundreds of features, and transformer classifiers for phishing language; attachments scanned by AV and risky types detonated in a sandbox.</li><li><strong>Placement:</strong> inbox, spam, category tab, or quarantine; user filters and allow lists applied last.</li></ol><p>Expensive stages only see what cheap stages could not decide, so the average cost per message stays a few milliseconds.</p>'],
    ['Mailbox storage layout', '<p>Split by access pattern:</p><div class="table-wrap"><table><tr><th>Data</th><th>Size</th><th>Access</th><th>Store</th></tr><tr><td>Headers, labels, flags, snippet</td><td>~1 KB</td><td>Every list and sync</td><td>Wide-column row</td></tr><tr><td>Small body (&lt; 64 KB)</td><td>a few KB</td><td>On open</td><td>Inline in the same row</td></tr><tr><td>Large body, attachments</td><td>KB to 25 MB</td><td>Rarely after the first days</td><td>Object storage, content hash</td></tr></table></div><ul><li><strong>Row keys</strong> start with user_id, so a mailbox lives on one tablet range and a user’s operations never fan out.</li><li><strong>Labels are indexes:</strong> "Inbox" is not a folder but rows <code>user#INBOX#reverse_ts</code>; archiving deletes one index row.</li><li><strong>Dedupe:</strong> identical attachments (a newsletter to a million people) share one blob via the content hash with reference counts; to keep encryption per tenant, dedupe within a key domain or use convergent encryption.</li><li><strong>Tiering:</strong> blobs older than a few months move to cool and then archive tiers; old metadata compacts into larger, compressed SSTables.</li></ul>'],
    ['Threading, labels and per-user search', '<p><strong>Threading</strong> uses the <code>Message-ID</code>, <code>In-Reply-To</code> and <code>References</code> headers to attach a message to an existing thread, with a fallback on normalised subject plus participants within a time window (for clients that drop headers). The thread row tracks latest timestamp, participants and unread count so the inbox list is a single scan.</p><p><strong>Search</strong> builds one small inverted index per user (or per user group within a shard), containing header fields as structured terms (<code>from:</code>, <code>to:</code>, <code>label:</code>, <code>has:attachment</code>) and body plus extracted attachment text as full text. Newly delivered mail is indexed within seconds; a short "recent" scan covers the gap. Deleting a user is deleting their index files, which also simplifies GDPR erasure.</p>'],
    ['Sync protocols and push', '<ul><li><strong>History log:</strong> every change appends <code>(history_id, change)</code>; clients sync with "changes since H". If H is older than the retention window, the client performs a full resync.</li><li><strong>IMAP</strong> (with IDLE for push, CONDSTORE/QRESYNC for efficient resync) remains for third-party clients; it maps folders to labels, which is lossy for multi-label messages.</li><li><strong>JMAP</strong> (RFC 8620/8621) is a modern JSON protocol with state strings and push via EventSource or WebSocket; it maps closely to the history-log model.</li><li><strong>Push:</strong> the server sends a content-free "mailbox changed" signal (WebSocket for open web clients, APNs/FCM for mobile). The client then pulls the delta, so a missed push only delays sync, it never loses data.</li></ul>'],
    ['Outbound sending and reputation', '<ul><li><strong>Authenticate everything:</strong> publish SPF, sign with DKIM (2048-bit keys, rotated), enforce DMARC on our own domains; large receivers require this for bulk senders (plus one-click unsubscribe and spam complaint rates below ~0.3%).</li><li><strong>IP pools:</strong> separate pools for consumer mail, transactional mail and suspicious accounts, so one bad actor cannot poison everyone’s deliverability. New IPs are warmed up gradually.</li><li><strong>Per-destination queues:</strong> respect each receiver’s rate limits and back off on 4xx; retry for days, then bounce with a DSN.</li><li><strong>Abuse controls:</strong> per-account send quotas, anomaly detection for compromised accounts, outbound spam scoring before sending.</li><li><strong>Feedback:</strong> bounces, complaint feedback loops and postmaster data update sender scores continuously.</li></ul>']
  ],
  scale: [
    '<strong>SMTP edge:</strong> scale horizontally behind many MX records and anycast; rejecting early keeps the expensive tiers proportional to accepted mail, not offered mail.',
    '<strong>Metadata store:</strong> shard by user_id; hot users (huge mailboxes, mailing-list archives) are split by key range automatically by Bigtable-style tablet splitting.',
    '<strong>Storage cost:</strong> inline small bodies, dedupe attachments, compress, and tier old blobs; erasure coding rather than triple replication for cold data.',
    '<strong>Search:</strong> index per user with background merges; extract attachment text lazily for very large files.',
    '<strong>Push fan-out:</strong> hundreds of millions of open connections handled by dedicated push gateways; the signal is tiny and idempotent.',
    '<strong>Spam waves:</strong> autoscale the filter pipeline on spool depth and keep the spool large enough to absorb bursts for hours (senders retry anyway).'
  ],
  tradeoffs: [
    ['When to reply 250 OK', 'After spooling vs after full filtering', 'After durable spooling: keeps SMTP sessions short; filtering happens asynchronously, and rejection of obvious spam still happens in-session.'],
    ['Metadata and bodies together or apart', 'One store vs metadata in wide-column + blobs in object storage', 'Apart (with small bodies inline): list and sync hit only compact rows, while petabytes of rarely read content sit on the cheapest tier.'],
    ['Search index scope', 'Per-user vs global', 'Per-user: small posting lists, isolation, easy deletion; costs more files to manage, handled by grouping users per shard.'],
    ['Folders vs labels', 'IMAP folders vs labels as indexes', 'Labels: a message can be in several views without copies; IMAP is served through a mapping layer.'],
    ['Spam false positives vs misses', 'Aggressive vs conservative thresholds', 'Bias toward delivering to Spam rather than rejecting borderline mail, so users can rescue false positives; reject only on strong signals (DMARC reject, malware, blocklisted IPs).']
  ],
  failures: [
    ['MX gateway crashes mid-session', 'Nothing was acknowledged, so the sender retries (SMTP retries for days); spool writes are replicated before 250 OK.'],
    ['Filter pipeline overloaded during a spam wave', 'The spool absorbs the backlog; if it fills, return 4xx tempfail so senders queue on their side; autoscale workers.'],
    ['Metadata tablet server fails', 'Tablets reassigned to other servers within seconds; data is in the replicated storage layer; clients retry.'],
    ['Indexer lag', 'Search falls back to scanning recent history for unindexed messages; lag is monitored per shard.'],
    ['Our sending IP gets blocklisted', 'Move traffic to other pools, find and stop the abusive accounts, request delisting; pool isolation limits the blast radius.'],
    ['Region outage', 'Mailboxes replicated across regions; MX records point to several regions so senders fail over automatically; push and API fail over via global load balancing.'],
    ['Accidental bulk delete by a user', 'Trash retention (30 days) plus soft-delete in metadata; blobs garbage-collected only after reference counts reach zero and a grace period.']
  ],
  cloud: [['MX and DNS records', 'dns'], ['SMTP gateways (Postfix, Haraka)', 'vms'], ['TCP load balancing for port 25', 'lb'], ['Services', 'k8s'], ['Mailbox metadata', 'widecol'], ['Bodies and attachments', 'blob'], ['Per-user search', 'search'], ['Mail event stream', 'stream'], ['Reputation and rate limits', 'cache'], ['Spam and phishing models', 'ml'], ['Attachment malware scanning', 'Microsoft Defender for Storage malware scanning', 'Amazon GuardDuty Malware Protection for S3'], ['Outbound sending (managed option)', 'email'], ['Mobile push', 'push'], ['Web push (WebSocket)', 'realtime'], ['DKIM keys and encryption keys', 'secrets'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-pipes-and-filters', 'azp-queue-based-load-leveling', 'azp-claim-check', 'azp-sharding', 'azp-competing-consumers', 'azEventDriven', 'azp-priority-queue', 'azDataStore'],
          aws: ['blBacklog', 'awsRetry', 'blShuffle', 'awsPubSub', 'blShedding', 'blBackoff'] },
  questions: [
    ['What do SPF, DKIM and DMARC each prove?', 'SPF: the connecting IP is authorised by the envelope sender’s domain. DKIM: a domain signed the message headers and body, and they have not been altered. DMARC: the domain in the visible From header aligns with a passing SPF or DKIM domain, and the owner publishes what receivers should do on failure (none, quarantine, reject) plus where to send reports.'],
    ['Why store metadata and bodies separately?', 'Listing and syncing touch only headers, labels and snippets (~1 KB), thousands of times more often than bodies are opened. Keeping metadata compact makes those operations fast and cheap, while bodies and attachments (most of the bytes) live on cheap, tiered object storage. Small bodies are inlined to avoid a second fetch.'],
    ['How does a new message reach my phone within seconds?', 'Delivery appends to the user’s history log; the change event reaches the sync service, which sends a content-free push via APNs/FCM. The app wakes and fetches the history delta since its last history id. Missed pushes only delay sync because the next pull catches up.'],
    ['How do you avoid losing mail if a server dies?', 'Do not acknowledge with 250 OK until the message is durably written to a spool replicated across zones. Before that, a crash simply makes the sender retry; after that, the pipeline is idempotent and resumable from the spool.'],
    ['How do you handle a 25 MB attachment sent to 10,000 users in our domain?', 'Store it once, content-addressed, with a reference count; each recipient’s metadata row points to the same blob. Scanning and text extraction also happen once per unique hash.'],
    ['How would you protect your outbound reputation?', 'Authenticate (SPF, DKIM, DMARC), segment IP pools by traffic type and risk, rate-limit and score outbound mail per account, warm up new IPs, process bounces and complaint feedback loops, and stop compromised accounts quickly.']
  ],
  related: ['notification', 'search-engine', 'file-storage', 'content-moderation', 'kv-store']
});

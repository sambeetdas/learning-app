SD.renderCase({
  slug: 'notification',
  summary: 'A notification system lets any product team send a message to a user through the right channel (mobile push via APNs and FCM, SMS, email or an in-app inbox) without each team re-implementing templates, preferences, retries and provider integrations. The hard parts are not sending one message but sending a billion a day reliably: honouring opt-outs and quiet hours in the user&rsquo;s time zone, making sure an OTP arrives in seconds while a 50-million-user marketing campaign is paced behind it, never sending the same &ldquo;your order shipped&rdquo; twice, retrying failures with backoff and a dead-letter queue, tracking delivery, and failing over between SMS and email providers. This design separates intake (validate, deduplicate, prioritise) from routing (preferences, templates, per-user limits) and from channel senders (provider-specific throughput, retries and failover), connected by priority queues.',
  examples: 'Facebook and LinkedIn notification platforms, Uber&rsquo;s RAMEN push system, Airbnb, Slack, Duolingo reminders; SaaS products such as Braze, OneSignal, Courier, Novu, Knock; cloud building blocks Azure Notification Hubs, Azure Communication Services, Amazon SNS, Amazon SES and AWS End User Messaging.',
  functional: ['Product services send a notification by type and recipient(s); the platform picks channels, renders a localised template and delivers it.', 'Channels: iOS/Android push (APNs, FCM), web push, SMS, email, in-app inbox with unread counts.', 'Users manage preferences per category and channel, and set quiet hours in their own time zone.', 'Priorities: critical (OTP, security alerts) bypass quiet hours and jump the queue; bulk campaigns are paced.', 'Delivery tracking: sent, delivered, opened, clicked, failed, per notification; dashboards per campaign.'],
  nonFunctional: ['1 B notifications/day, campaign peaks of ~100,000/s.', 'Critical notifications handed to the provider in &lt; 2 s p99; normal in &lt; 30 s; bulk within the campaign window.', 'At-least-once delivery internally with deduplication so users see each notification once.', 'Survive the outage of any single provider (SMS and email have a secondary).', 'Respect provider quotas, regulations (TCPA, GDPR, CAN-SPAM, unsubscribe headers) and per-user frequency caps.'],
  outOfScope: ['Deciding what to send and when for engagement (a recommendation problem).', 'Two-way chat (see chat).', 'Running our own SMTP or SMS carrier connections.'],
  estimates: [
    ['Notifications per day', '1 B', '100 M DAU &times; ~10 per user'],
    ['Channel split', 'push 750 M, email 150 M, in-app 98 M, SMS 2 M', 'Push is cheap; SMS is reserved for OTP and critical alerts'],
    ['Average rate', '~11,600/s', '1 B / 86,400 s'],
    ['Peak rate', '~100,000/s', 'A 50 M-user campaign over ~10 minutes is 83,000/s, on top of transactional traffic'],
    ['Critical traffic', '~1% (10 M/day)', 'OTP, password reset, fraud alerts'],
    ['SMS cost', '~$20,000/day', '2 M &times; ~$0.01 average (much higher for some countries): why SMS is rate limited per user and per country'],
    ['Delivery log', '~1.5 TB/day, ~45 TB hot (30 days)', '1 B &times; ~3 status events &times; ~500 B'],
    ['Device tokens', '~60 GB', '300 M devices &times; ~200 B (token, platform, app version, last seen)'],
    ['Preferences', '~200 GB', '200 M users &times; ~1 KB; hot subset cached']
  ],
  compute: [
    ['Notification API (intake)', '9 instances of 4 vCPU (3 per zone)', 'Transactional intake peaks ~15,000 req/s &times; ~1 ms CPU = 15 cores &rArr; 25 at 60% &rArr; 7 instances; 3 per zone survives a zone loss. Campaigns enter as one request each.'],
    ['Router workers', '~42 &times; 4 vCPU at peak, minimum 9; autoscaled on queue lag', '100,000/s &times; ~1 ms (cached prefs lookup, template render, frequency-cap check) = 100 busy cores &rArr; ~170 cores at 60%.'],
    ['Channel senders', '~12 &times; 4 vCPU at peak', 'I/O bound: 100,000/s &times; ~100 ms provider latency = 10,000 requests in flight; HTTP/2 multiplexing to APNs/FCM at ~1,000 in flight per pod. CPU (TLS, JSON) ~0.3 ms each = 30 cores.'],
    ['Kafka', '3 priority topics, 48 partitions each', '100,000 msg/s &times; ~1 KB = 100 MB/s; partitions sized for consumer parallelism, keyed by user id.'],
    ['Redis (dedup + frequency caps)', '4 shards + replicas', '~2 ops per notification &rArr; 200,000 ops/s; idempotency keys for 24 h at ~100 B each &asymp; 100 GB if kept for all, so only producer keys (~200 M/day &times; 100 B &asymp; 20 GB) are stored.'],
    ['Delivery log (Cassandra)', '12 nodes', '~35,000 writes/s average, ~300,000/s at campaign peak; 45 TB &times; RF 3 / ~12 TB usable per node.']
  ],
  api: [
    ['POST /v1/notifications {recipients, type, templateId, data, priority, channels?, ttl}', 'Send a notification. Idempotency-Key header required; 202 Accepted with notification id. ttl drops messages that are useless when late (&ldquo;your driver is here&rdquo;).'],
    ['POST /v1/campaigns {segmentId, templateId, sendAt, localTime, maxPerSecond}', 'Bulk send to a segment, optionally at a local time per recipient, paced to provider quotas.'],
    ['PUT /v1/users/{id}/preferences', '{categories: {marketing: {push: false, email: true}}, quietHours: {start: "22:00", end: "07:00", tz: "Europe/London"}}.'],
    ['POST /v1/devices {userId, platform, token, appVersion}', 'Register or refresh an APNs/FCM token; called on every app start.'],
    ['GET /v1/users/{id}/inbox?cursor= and WebSocket event inbox.new', 'In-app inbox with unread count; real-time update when the app is open.'],
    ['POST /webhooks/{provider}/status', 'Delivery receipts from SMS and email providers (delivered, bounced, complained) and opens/clicks.']
  ],
  data: [
    ['notification job', 'Kafka topics critical / normal / bulk', 'Key user_id (per-user ordering, and frequency caps on one consumer); {id, type, templateId, data, priority, ttl, attempt}.'],
    ['idempotency + dedup', 'Redis', '<code>SET idem:{producer}:{key} NX EX 86400</code>; content dedup <code>hash(user, type, entityId)</code> with a 10-minute TTL to collapse duplicate events.'],
    ['preferences, quiet hours', 'Key-value (DynamoDB / Cosmos DB) + cache', 'PK user_id; per category &times; channel opt-in, quiet hours with IANA time zone, locale; consent timestamps for compliance.'],
    ['device tokens', 'Key-value', 'PK user_id, SK token; platform, app version, last_seen; deleted on APNs 410 / FCM UNREGISTERED.'],
    ['templates', 'Relational (PostgreSQL)', '(template_id, version, channel, locale) &rarr; subject/body with variables; approval workflow; cached in routers.'],
    ['delivery log', 'Wide-column (Cassandra)', 'Partition (user_id, day), clustering notification_id; status timeline (queued, sent, delivered, opened, failed + reason). TTL 30 days; aggregates to the warehouse.'],
    ['in-app inbox', 'Wide-column (Cassandra)', 'Partition user_id, clustering created_at desc; read flag; unread counter in Redis.']
  ],
  dbChoice: [
    ['Delivery log and inbox', 'Cassandra / Keyspaces', 'Write-heavy (300,000/s peaks), time-ordered per user, TTL-based expiry, queried only by user and time: a perfect wide-column fit.', 'PostgreSQL partitioned by day: fine at lower volume; write amplification and vacuum become a burden at billions of rows per day.'],
    ['Preferences and device tokens', 'Key-value (DynamoDB / Cosmos DB) with a read-through cache', 'Single-key reads on every notification; must be highly available; simple schema per user.', 'Relational: workable, but the router&rsquo;s read rate (100,000/s) would need heavy caching anyway.'],
    ['Idempotency, frequency caps, unread counts', 'Redis', 'Atomic SET NX and INCR with TTL in &lt; 1 ms.', 'Database unique constraints: correct but adds a write and 5-10 ms per notification.'],
    ['Templates and campaigns', 'Relational', 'Low volume, needs versioning, approval workflow and joins for reporting.', 'Document store: also fine.']
  ],
  diagram: {
    nodes: [['src', 'Product services', 'svc', 0, 1.4, 'orders, auth, marketing'], ['api', 'Notification API', 'apigw', 1, 1.4, 'validate, idempotency'], ['dd', 'Dedup + caps', 'cache', 1, 0.1, 'Redis'],
      ['q', 'Priority intake', 'queue', 2, 1.4, 'critical/normal/bulk'], ['rt', 'Router workers', 'worker', 3, 1.4, 'prefs, template, caps'], ['pref', 'Prefs + templates', 'nosql', 3, 0.1, 'opt-ins, quiet hours'],
      ['inbox', 'In-app inbox', 'nosql', 3.6, 2.8, 'Cassandra + WebSocket'], ['cq', 'Channel queues', 'queue', 4, 1.4, 'push / SMS / email'], ['snd', 'Channel senders', 'worker', 5, 1.4, 'retries, failover'],
      ['log', 'Delivery tracking', 'nosql', 5, 0.1, 'status timeline'], ['dlq', 'Retry + DLQ', 'queue', 5, 2.8, 'backoff, dead letters'],
      ['apns', 'APNs / FCM', 'ext', 6, 0.4, 'mobile push'], ['sms', 'SMS providers', 'ext', 6, 1.4, 'primary + secondary'], ['mail', 'Email providers', 'ext', 6, 2.4, 'SES / ACS / SendGrid']],
    edges: [['src', 'api'], ['api', 'dd'], ['api', 'q', '', 'async'], ['q', 'rt', '', 'async'], ['rt', 'pref'], ['rt', 'dd'], ['rt', 'cq', '', 'async'], ['rt', 'inbox'], ['cq', 'snd', '', 'async'],
      ['snd', 'apns'], ['snd', 'sms'], ['snd', 'mail'], ['snd', 'dlq', '', 'async'], ['snd', 'log', 'status']]
  },
  flows: [
    { name: 'Transactional push', desc: '“Your order has shipped”: from an order event to a phone in about a second.', steps: [
      ['src', 'api', 'POST type=order_shipped', 'The order service calls the API with Idempotency-Key = "order-8812-shipped". It does not know or care about channels or devices.'],
      ['api', 'dd', 'SET idem:… NX EX 86400', 'If the order service retries after a timeout, the key already exists and the API returns the original notification id instead of sending twice.'],
      ['dd', 'api', 'new', 'First time we have seen this key.', 'resp'],
      ['api', 'q', 'enqueue normal (key=user)', '202 Accepted goes back immediately; the heavy work is asynchronous. Keying by user keeps one user’s notifications in order.', 'async'],
      ['q', 'rt', 'consume', 'A router worker picks it up within milliseconds.', 'async'],
      ['rt', 'pref', 'prefs, tokens, locale', 'Cached lookup: the user allows push for “orders”, it is 14:00 in their time zone (no quiet hours), two devices, locale de-DE.'],
      ['rt', 'cq', 'push job × 2 devices', 'The template is rendered in German for the push channel; one job per device token.', 'async'],
      ['cq', 'snd', 'consume', 'The push sender keeps HTTP/2 connections open to APNs and FCM.', 'async'],
      ['snd', 'apns', 'HTTP/2 POST /3/device/…', 'APNs and FCM accept the message; they handle the last hop to the device.'],
      ['snd', 'log', 'status = sent', 'Delivery tracking records sent; opens come later from the app’s analytics event.']],
      end: 'Producers send intent (“order shipped to user 42”); the platform owns channels, preferences, templates and delivery.' },
    { name: 'OTP with SMS failover', desc: 'A critical message must arrive in seconds, even when the primary SMS provider is failing.', steps: [
      ['src', 'api', 'POST type=otp (critical)', 'Login asks for a one-time code; ttl = 5 minutes, after which it is pointless.'],
      ['api', 'q', 'critical topic', 'Critical messages have their own topic and consumers, so a 50 M-user campaign queued in bulk cannot delay them.', 'async'],
      ['q', 'rt', 'consume (dedicated pool)', 'Critical routers bypass quiet hours and marketing caps, but a per-user OTP limit (5 per hour) still applies to stop SMS pumping fraud.', 'async'],
      ['rt', 'cq', 'sms job', 'SMS chosen because the user has no verified push device.', 'async'],
      ['cq', 'snd', 'consume', 'The SMS sender picks the primary provider for this country.', 'async'],
      ['snd', 'sms', 'send via primary', 'The primary provider returns 5xx and its circuit breaker is already half open after a run of errors.', 'err'],
      ['snd', 'sms', 'failover: secondary', 'Within 1 s the sender retries with the secondary provider, reusing the same notification id so receipts are matched.'],
      ['snd', 'log', 'sent via secondary', 'The delivery receipt webhook later marks it delivered; the OTP arrives in ~3 s.']],
      end: 'Separate queues and worker pools per priority, plus provider failover behind circuit breakers, keep critical traffic fast during incidents.' },
    { name: 'Campaign with quiet hours and caps', desc: 'Marketing sends to 50 M users; preferences, time zones and frequency caps shape who gets what, when.', steps: [
      ['src', 'api', 'POST /campaigns segment=50M', 'One request describes the whole campaign: template, segment, local send time 10:00, max 20,000/s.'],
      ['api', 'q', 'bulk: segment batches', 'The segment is expanded in batches of 1,000 users onto the bulk topic, at the campaign’s pace.', 'async'],
      ['q', 'rt', 'consume bulk', 'Bulk routers have a lower share of capacity than normal and critical.', 'async'],
      ['rt', 'pref', 'opted in? local time?', '12% opted out of marketing push: dropped. Users where it is 23:00 are inside quiet hours: deferred to 07:00 local via a delay queue, or dropped if the campaign ttl will have passed.'],
      ['rt', 'dd', 'INCR cap:user:marketing:day', 'Frequency cap: at most 2 marketing notifications per user per day across all teams; users already at 2 are skipped.'],
      ['rt', 'inbox', 'write in-app copy', 'Everyone eligible also gets an inbox entry, which costs almost nothing and is seen next time the app opens.'],
      ['rt', 'cq', 'paced push jobs', 'Push jobs are released at the provider-quota pace (e.g. FCM’s per-project quota, by default 600,000 messages per minute).', 'async'],
      ['cq', 'snd', 'consume', 'Senders drain at the paced rate; a campaign takes ~40 minutes instead of overloading providers in one minute.', 'async']],
      end: 'Preferences, quiet hours and frequency caps are enforced centrally, so no team can spam users by accident.' },
    { name: 'Retries, DLQ and bad tokens', desc: 'Failures: a throttled email provider, an uninstalled app and a message that keeps failing.', steps: [
      ['snd', 'mail', 'send email', 'The email provider responds 429: we exceeded our sending rate.', 'err'],
      ['snd', 'dlq', 'retry in 30 s (attempt 2)', 'Retriable errors go to a delay queue with exponential backoff and jitter (30 s, 2 min, 10 min…); the sender also slows its rate for that provider.', 'async'],
      ['dlq', 'snd', 'redeliver', 'The retry succeeds once the provider recovers.', 'async'],
      ['snd', 'apns', 'push to old device', 'APNs answers 410 Unregistered: the app was uninstalled.', 'err'],
      ['snd', 'log', 'token invalid', 'The token is removed from the device table so we stop paying for and retrying dead tokens.'],
      ['snd', 'dlq', 'dead letter after 6 tries', 'A message with a malformed template fails every attempt; after the retry budget it goes to the DLQ with the error, and an alert fires for the owning team.', 'err']],
      end: 'Classify errors: retry transient ones with backoff, drop permanent ones, park poison messages in a DLQ, and feed results back into the device and preference data.' }
  ],
  components: [
    ['Notification API', 'Authenticates producers, validates against a registered notification type, enforces idempotency, enqueues by priority.'],
    ['Priority intake topics', 'Critical, normal and bulk lanes with separate consumer pools so floods cannot delay OTPs.'],
    ['Router workers', 'Resolve recipients and devices, apply preferences, quiet hours and frequency caps, choose channels, render templates.'],
    ['Preferences, devices and templates', 'Per-user opt-ins and quiet hours; device tokens; versioned localised templates.'],
    ['Channel queues and senders', 'Per-channel throughput control, provider connections, circuit breakers, failover, retries with backoff.'],
    ['Retry delay queue + DLQ', 'Scheduled redelivery for transient failures; dead letters with error context for poison messages.'],
    ['Delivery tracking', 'Status timeline per notification from sends, webhooks and app events; feeds dashboards and suppression lists.'],
    ['In-app inbox', 'Durable per-user feed with unread count, pushed live over WebSocket when the app is open.']
  ],
  deep: [
    ['Deduplication and idempotency', '<p>Duplicates come from three places, and each needs a different guard:</p><ol><li><strong>Producer retries</strong> (the order service times out and calls again): an <code>Idempotency-Key</code> stored with <code>SET NX</code> for 24 h; the second call returns the first notification id.</li><li><strong>Duplicate events</strong> (two services both emit &ldquo;payment failed&rdquo;): a content key <code>hash(user, type, entity)</code> with a short TTL collapses them.</li><li><strong>At-least-once queues</strong> (a sender crashes after the provider accepted but before committing its offset): use the notification id as the provider&rsquo;s idempotency or collapse key where supported (APNs <code>apns-collapse-id</code>, FCM <code>collapse_key</code>, email Message-ID), and record &ldquo;sent&rdquo; before committing the offset.</li></ol><p>Exactly-once delivery to a human is impossible end to end; at-least-once plus deduplication at every hop is the practical goal.</p>'],
    ['Preferences, quiet hours and frequency caps', '<ul><li>Preferences are per <strong>category &times; channel</strong> (marketing push off, security email on). Some categories are mandatory (security, legal) and cannot be disabled, only channel-routed.</li><li><strong>Quiet hours</strong> are evaluated in the user&rsquo;s IANA time zone (from the device or profile, not the server). Non-critical messages are deferred with a scheduled delivery time to the end of the window, and dropped if their ttl expires first.</li><li><strong>Frequency caps</strong> are Redis counters per user per category per day, shared across all teams; campaigns check them before sending.</li><li>Store consent with timestamps and source for GDPR/TCPA audits; email must include one-click unsubscribe (RFC 8058 List-Unsubscribe-Post), now required by Gmail and Yahoo for bulk senders.</li></ul>'],
    ['Priority queues and fairness', '<p>Use separate topics (or queues) per priority with dedicated consumer pools, rather than a single queue with a priority field: a deep bulk backlog would still block reads from a shared partition. Size the critical pool for its peak with headroom and keep it idle most of the time. Within bulk, use per-campaign pacing (token bucket at the campaign&rsquo;s maxPerSecond) and weighted fair sharing so one team&rsquo;s campaign cannot consume all capacity. Expired messages (past ttl) are dropped at every stage, which is also the cheapest form of load shedding.</p>'],
    ['Channels and provider specifics', '<table><tr><th>Channel</th><th>Provider</th><th>Notes</th></tr><tr><td>iOS push</td><td>APNs (HTTP/2, token-based auth with a .p8 key)</td><td>Persistent multiplexed connections; 410 means remove the token; collapse-id replaces an older notification.</td></tr><tr><td>Android / web push</td><td>FCM HTTP v1 API (OAuth2)</td><td>Per-project quotas; UNREGISTERED means remove the token; topic messaging for broadcast.</td></tr><tr><td>SMS</td><td>Twilio, Vonage, Infobip, ACS, AWS End User Messaging</td><td>Expensive; registration rules (10DLC in the US, sender IDs elsewhere); route by country cost and quality; watch for SMS pumping fraud.</td></tr><tr><td>Email</td><td>SES, ACS Email, SendGrid</td><td>SPF, DKIM, DMARC; warm up IPs; process bounces and complaints into a suppression list.</td></tr><tr><td>In-app</td><td>Own inbox + WebSocket</td><td>Cheapest and most reliable; the fallback when push permission is denied.</td></tr></table>'],
    ['Retries, failover and delivery tracking', '<p>Classify every provider response: <strong>retriable</strong> (timeouts, 429, 5xx) &rarr; backoff with jitter via a delay queue, honouring Retry-After; <strong>permanent</strong> (invalid token, hard bounce, opted out at carrier) &rarr; drop and update data; <strong>unknown</strong> &rarr; limited retries then DLQ. A circuit breaker per provider and region trips after an error-rate threshold and shifts traffic to the secondary (SMS, email); push has no secondary, so fall back to in-app or email for important messages. Delivery tracking merges our &ldquo;sent&rdquo; events with provider webhooks (delivered, bounced) and app events (opened, clicked) by notification id; the timeline powers support tools and campaign analytics.</p>']
  ],
  scale: [
    '<strong>Campaign fan-out:</strong> expand segments in batches, pace to provider quotas, and give bulk its own topic and worker pool; autoscale routers on consumer lag.',
    '<strong>Preference reads:</strong> 100,000 lookups/s are served from a read-through cache (Redis or in-process with short TTL), invalidated on preference change events.',
    '<strong>Provider throughput:</strong> keep long-lived HTTP/2 connections, use batch APIs where available (SES, FCM topics), and shard senders by provider and region.',
    '<strong>Hot users:</strong> a user in thousands of group chats or a celebrity&rsquo;s followers can trigger bursts; per-user caps and digesting (&ldquo;12 new comments&rdquo;) keep it sane.',
    '<strong>Delivery log volume:</strong> billions of status rows per day go to Cassandra with TTL; aggregate to the warehouse for long-term analytics.'
  ],
  tradeoffs: [
    ['Push vs pull for in-app', 'WebSocket push vs poll on app open', 'Both: write to the inbox (pull on open, always correct) and push a live event when a socket exists.'],
    ['Single queue vs per-priority queues', 'One topic with priority field vs separate lanes', 'Separate lanes with dedicated consumers: the only reliable way to keep OTP latency low during a campaign.'],
    ['Delivery semantics', 'At-most-once vs at-least-once + dedup', 'At-least-once with idempotency keys and provider collapse ids: losing a security alert is worse than a rare duplicate.'],
    ['Build vs buy', 'Own platform vs Braze/OneSignal/ACS/SNS', 'Use cloud provider primitives for the last hop; build the routing, preferences and policy layer once you have many teams and channels.'],
    ['Template rendering location', 'Producer renders vs platform renders', 'Platform renders from versioned templates: consistent branding, localisation and compliance footers.']
  ],
  failures: [
    ['SMS or email provider outage', 'Circuit breaker per provider; automatic failover to the secondary; critical messages fall back to another channel.'],
    ['Campaign floods the system', 'Separate bulk lane, pacing, autoscaling on lag; critical lane untouched.'],
    ['Duplicate sends after a crash', 'Idempotency keys, record sent before committing offsets, provider collapse keys.'],
    ['Poison message (bad template, invalid data)', 'Bounded retries then DLQ with error context; alert the owning team; redrive after the fix.'],
    ['Stale device tokens', 'Remove on APNs 410 / FCM UNREGISTERED; refresh tokens on every app start; expire tokens unseen for 270 days.'],
    ['Preference store slow or down', 'Cached preferences with short TTL; if unknown, send only mandatory categories (fail safe for marketing).'],
    ['Message arrives too late to matter', 'ttl on every notification; drop expired messages at every stage.']
  ],
  cloud: [['Notification API', 'apigw'], ['Router and sender workers', 'containers'], ['Priority intake and channel queues', 'stream'], ['Retry delay queue and DLQ', 'queue'], ['Mobile push / SMS', 'push'], ['Email sending', 'email'],
    ['In-app real-time updates', 'realtime'], ['Dedup, caps and unread counts', 'cache'], ['Preferences and device tokens', 'nosql'], ['Delivery log and inbox', 'widecol'], ['Templates and campaigns', 'sql'], ['Scheduled campaigns', 'scheduler'], ['Campaign analytics', 'warehouse'], ['Monitoring', 'monitor'], ['Provider credentials', 'secrets']],
  refs: { az: ['azp-priority-queue', 'azp-queue-based-load-leveling', 'azp-competing-consumers', 'azp-retry', 'azp-circuit-breaker', 'azp-publisher-subscriber', 'azEventDriven', 'azBackground'],
          aws: ['awsPubSub', 'awsRetry', 'awsCircuit', 'blBacklog', 'blBackoff', 'blShedding', 'awsServerlessLens'] },
  questions: [
    ['How do you make sure an OTP is not delayed by a big campaign?', 'Separate priority lanes (topics or queues) with dedicated consumer pools and capacity for critical traffic, a ttl on every message, and campaign pacing. A shared queue with a priority field is not enough because backlog blocks the partition.'],
    ['How do you avoid sending the same notification twice?', 'Idempotency keys from producers (SET NX in Redis), content-based dedup for duplicate events, recording &ldquo;sent&rdquo; before committing queue offsets, and provider collapse ids. True exactly-once is impossible; at-least-once plus dedup is the goal.'],
    ['How do quiet hours work across time zones?', 'Store the user&rsquo;s IANA time zone and quiet window; the router converts now to local time, defers non-critical messages to the window end via a delay queue, and drops them if their ttl passes first. Critical categories bypass quiet hours.'],
    ['What do you do when APNs returns 410?', 'The token is no longer valid (app uninstalled or token rotated): delete it, stop retrying, and rely on the app to register a fresh token on next launch.'],
    ['How would you handle a 100 M-user broadcast?', 'Expand the segment in batches onto a bulk lane, filter by preferences and caps, pace to provider quotas (or use FCM topics / batch APIs), stagger by local time, and autoscale workers on lag. Expect it to take tens of minutes, by design.'],
    ['How do you track delivery and opens?', 'Each notification id flows through every hop; senders log sent, provider webhooks report delivered/bounced, and the app reports opened/clicked with the same id. Merge into a per-notification timeline and aggregate per campaign.']
  ],
  related: ['chat', 'email', 'rate-limiter', 'message-queue', 'job-scheduler']
});

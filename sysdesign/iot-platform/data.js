SD.renderCase({
  slug: 'iot-platform',
  summary: 'An IoT telemetry platform connects millions of constrained devices (meters, sensors, vehicles, machines) that sit on flaky networks for years, and turns their stream of readings into alerts, dashboards and analytics, while letting operators send commands and firmware back. It starts with <strong>identity</strong>: each device has its own X.509 certificate, ideally in a secure element, and a <strong>provisioning service</strong> assigns it to a hub on first boot. Devices keep a persistent <strong>MQTT</strong> connection to an <strong>IoT hub / broker</strong>, which authenticates them, routes telemetry into an <strong>event stream</strong>, and maintains a <strong>device shadow / digital twin</strong> (desired vs reported state) so commands work even for devices that are offline. From the stream, three paths diverge: a <strong>hot path</strong> of streaming rules for alerts in seconds, a <strong>warm path</strong> into a time-series database for dashboards, and a <strong>cold path</strong> into a data lake for history and ML. <strong>Edge gateways</strong> bridge legacy protocols and keep working when the cloud is unreachable, and <strong>OTA updates</strong> roll out signed firmware in rings.',
  examples: 'Smart meters and utilities, connected cars, industrial IoT (predictive maintenance on factory lines), smart buildings, fleet telematics, consumer devices; built on Azure IoT Hub (+ Device Provisioning Service, IoT Edge, Azure Digital Twins, Event Grid MQTT broker), AWS IoT Core (+ Greengrass, Device Shadow, IoT TwinMaker), or self-hosted brokers such as EMQX, HiveMQ and Mosquitto.',
  functional: ['Zero-touch provisioning: a device boots, proves its identity and is assigned to the right hub and tenant.', 'Devices send telemetry (periodic readings, events) and state; the platform stores and visualises it.', 'Rules raise alerts in seconds (threshold, rate of change, missing data).', 'Operators send commands, change configuration and query device state, including for offline devices.', 'Over-the-air firmware updates in staged rollouts with automatic rollback.', 'Edge gateways connect legacy and local devices and run local logic when offline.'],
  nonFunctional: ['Scale to 10 million connected devices and ~500 K messages/s at peak.', 'Hot-path alert latency &lt; 5 s from reading to notification.', 'No data loss for acknowledged messages (QoS 1); devices buffer during outages.', 'Strong security: per-device identity, mutual TLS, least privilege topics, signed firmware, revocation.', 'Cost per device per month in cents: compact payloads, tiered storage.', '99.9%+ availability of ingestion; regional isolation of failures.'],
  outOfScope: ['Device hardware design and embedded firmware internals.', 'Specific ML models for predictive maintenance (only the data path).', 'Billing and customer portal (see saas-platform).'],
  estimates: [
    ['Connected devices', '10 million', 'Smart meters, sensors and industrial gateways'],
    ['Telemetry rate', '~167 K msgs/s average, ~500 K msgs/s peak', '10 M &times; 1 message/minute = 14.4 B/day; peaks from synchronised schedules and reconnect bursts'],
    ['Message size', '~500 B JSON (~150 B CBOR/Protobuf)', 'Device id, timestamp, 5-20 readings'],
    ['Ingest volume', '~83 MB/s average, ~7 TB/day raw', '167 K &times; 500 B'],
    ['MQTT connections and keepalives', '10 M persistent; ~42 K pings/s', 'Keepalive 240 s: 10 M / 240'],
    ['Twin (shadow) updates', '~3 K/s', 'Reported properties change about once an hour per device'],
    ['Cloud-to-device commands', '~120/s average; bursts of 10 K/s for jobs', '1 command per device per day; fleet jobs throttled'],
    ['OTA wave', '~20 TB per 1 M-device wave', '20 MB firmware image &times; 1 M; served from a CDN, deltas cut this 5-10&times;'],
    ['Warm storage', '~22 TB for 30 days', '7 TB/day compressed ~10&times; in a columnar time-series DB'],
    ['Cold storage', '~1 TB/day, ~365 TB/year', 'Parquet in the data lake at ~7&times; compression']
  ],
  compute: [
    ['IoT hubs / MQTT brokers', 'Managed: ~10 Azure IoT Hubs &times; 10 S3 units; self-hosted: ~20 broker nodes', 'An S3 unit allows 300 M messages/day: 14.4 B/day needs 48 units, so 100 units across 10 hubs gives 2&times; headroom and limits blast radius (~1 M devices per hub). Self-hosted EMQX/HiveMQ: ~1 M connections per node at 50% &rArr; 20 nodes.'],
    ['Event stream', 'Kafka / Event Hubs Dedicated: ~64 partitions, ~12 brokers', '500 K events/s and 250 MB/s in at peak; three consumer groups (hot, warm, cold) &rArr; ~750 MB/s out.'],
    ['Hot-path stream processing', '~8 &times; 8 vCPU (Flink) or ~60 Stream Analytics units', '500 K events/s &times; ~20 &micro;s per rule evaluation = 10 busy cores, plus windowed state per device; 3-4&times; headroom for catch-up after outages.'],
    ['Time-series DB (warm)', '~8-10 nodes (Azure Data Explorer / Timestream / TimescaleDB)', 'Batched ingestion of ~500 K rows/s at peak; 22 TB hot cache for 30 days; dashboard queries scan recent partitions.'],
    ['Command and twin services', '~6 pods &times; 2 vCPU', 'Low steady volume; job orchestration batches up to 10 K commands/s with throttling per hub.'],
    ['Firmware delivery', 'CDN + object storage', 'A 1 M-device wave over 24 h is ~1.9 Gbit/s average: trivial for a CDN, impossible for the hub (which only signals the update).']
  ],
  api: [
    ['MQTT PUBLISH devices/{id}/messages/events  (QoS 1)', 'Telemetry; properties (message type, schema version) let the hub route without parsing the body.'],
    ['MQTT twin topics: reported PATCH / desired updates', 'Device reports its state and subscribes to desired-state changes (Azure: $iothub/twin/…, AWS: $aws/things/{name}/shadow/…).'],
    ['MQTT SUBSCRIBE methods / commands', 'Direct methods (request/response with timeout) and cloud-to-device messages for devices that are online.'],
    ['POST /enrollments {group, caCert, allocationPolicy}', 'Enrollment group: any device with a certificate chained to this CA can self-provision; the policy picks the hub (geo, load, tenant).'],
    ['PATCH /devices/{id}/twin {desired}', 'Set desired configuration; the device applies it when online and reports back. Optimistic concurrency with the twin version / ETag.'],
    ['POST /jobs {query, type, rollout}', 'Fleet job: e.g. firmware update to “tags.site = ‘plant7’ AND model = ‘M3’”, 1% &rarr; 10% &rarr; 100% with halt thresholds.'],
    ['GET /telemetry?device=&from=&to=&agg=avg&bin=5m', 'Warm-path queries for dashboards and APIs.']
  ],
  data: [
    ['device registry', 'Hub identity registry + SQL for extended metadata', 'device_id, auth (cert thumbprint / CA), status (enabled/disabled), hub assignment, tenant, tags (site, model, firmware).'],
    ['twin / shadow', 'Hub-managed JSON documents (or Cosmos DB / DynamoDB)', '{desired, reported, version, metadata per property with lastUpdated}; the delta (desired minus reported) is what the device must do.'],
    ['telemetry (warm)', 'Time-series DB', '(device_id, ts, metric, value) or wide rows per message; partitioned by ingestion time, ordered by device id for fast per-device ranges; 30-90 day retention.'],
    ['telemetry (cold)', 'Data lake (Parquet / Delta)', 'Partitioned by date / hour / device type; years of history for ML and compliance.'],
    ['rules and alerts', 'Relational DB', 'Rule definitions per tenant, alert state machine (open, acknowledged, resolved) with dedup keys.'],
    ['firmware and rollouts', 'Object storage + SQL', 'Signed images and delta packages by version; rollout state per ring and per device (pending, downloading, installed, failed).']
  ],
  dbChoice: [
    ['Warm telemetry', 'Time-series / columnar store (Azure Data Explorer, Timestream, TimescaleDB, InfluxDB)', 'Append-only time-ordered writes at high rate, compression 10&times;+, fast time-range aggregates, retention policies.', 'Relational without time partitioning: index bloat and slow aggregates. Cassandra: good writes but weaker ad-hoc aggregation.'],
    ['Cold telemetry', 'Object storage data lake with Parquet/Delta', 'Cheapest per TB, scanned by Spark/SQL engines for analytics and ML training.', 'Keeping years in the TSDB: much more expensive.'],
    ['Twins / shadows', 'Document store (managed by the hub or Cosmos DB / DynamoDB)', 'One JSON document per device read and written by id, with versioning and partial updates.', 'Relational: schema per device model is too rigid.'],
    ['Registry, rules, rollouts', 'Relational', 'Low volume, transactional, rich queries for operators.', 'Document DB if per-tenant rule schemas vary widely.']
  ],
  diagram: {
    nodes: [['dev', 'Devices', 'device', 0, 0.8, 'MQTT over TLS, X.509'], ['leaf', 'Leaf devices', 'device', 0, 2.4, 'Modbus, BLE, OPC UA'], ['dps', 'Provisioning', 'svc', 1, 0.1, 'enrollment, assignment'],
      ['egw', 'Edge gateway', 'gw', 1, 2.4, 'local rules, buffering'], ['hub', 'IoT hub / broker', 'gw', 2, 1.1, 'MQTT, auth, routing'], ['twin', 'Registry + twins', 'nosql', 4, 0, 'desired / reported'],
      ['st', 'Telemetry stream', 'stream', 3, 1.2, 'Kafka / Event Hubs'], ['cmd', 'Command service', 'svc', 3, 2.4, 'methods, jobs, OTA'], ['rules', 'Hot path rules', 'worker', 5, 0.2, 'stream processing'],
      ['tsdb', 'Time-series DB', 'tsdb', 4, 1.3, 'warm path'], ['lake', 'Data lake', 'blob', 4, 2.6, 'cold path, Parquet'], ['api', 'Device API', 'svc', 5, 1.6, 'queries, commands'],
      ['ops', 'Operators + apps', 'user', 6, 1.6, 'dashboards, alerts'], ['fw', 'Firmware store', 'blob', 3, 3.4, 'signed images + CDN']],
    edges: [['dev', 'dps', 'first boot'], ['dps', 'hub', 'register'], ['dev', 'hub', 'MQTT'], ['leaf', 'egw'], ['egw', 'hub', 'MQTT (store+fwd)'], ['hub', 'twin'], ['hub', 'st', 'route'],
      ['st', 'rules', '', 'async'], ['st', 'tsdb', '', 'async'], ['st', 'lake', '', 'async'], ['cmd', 'hub'], ['cmd', 'fw'], ['api', 'tsdb'], ['api', 'twin'], ['api', 'cmd'], ['ops', 'api'], ['rules', 'ops', 'alerts']]
  },
  flows: [
    { name: 'Provision and connect', desc: 'A meter leaves the factory with a certificate and is installed in a customer’s basement.', steps: [
      ['dev', 'dps', 'TLS with device X.509', 'On first boot the device connects to the global provisioning endpoint and presents its certificate (private key never leaves the secure element).'],
      ['dps', 'hub', 'register in hub-eu-3', 'The allocation policy picks a hub by geography, tenant and load, and creates the device identity there.'],
      ['dps', 'dev', 'assigned hub + device id', 'The device stores the assignment; future boots go straight to the hub (re-provision only if it moves or the hub is retired).', 'resp'],
      ['dev', 'hub', 'MQTT CONNECT (mTLS)', 'Mutual TLS again, now to the hub; the hub checks the device is enabled. Keepalive 240 s, persistent session.'],
      ['hub', 'twin', 'load twin', 'Twin created with initial desired configuration from the enrollment group (reporting interval, thresholds).'],
      ['hub', 'dev', 'CONNACK + desired state', 'The device subscribes to its desired-state and command topics and applies the initial configuration.', 'resp']],
      end: 'Per-device certificates chained to a manufacturer CA plus enrollment groups give zero-touch onboarding without shared secrets baked into firmware.' },
    { name: 'Telemetry: hot, warm, cold', desc: 'A reading travels from a sensor to an alert, a dashboard and the data lake.', steps: [
      ['dev', 'hub', 'PUBLISH QoS 1 (temp=84)', 'The device publishes and keeps the message until the hub acknowledges (PUBACK); if offline it buffers locally.'],
      ['hub', 'st', 'route by message type', 'The hub routes on message properties (telemetry vs alarms) without parsing the body; partition key = device id keeps per-device order.'],
      ['st', 'rules', 'hot path (seconds)', 'A streaming job evaluates rules with windows: “temperature > 80 for 2 minutes”, “no data for 15 minutes”, per device.', 'async'],
      ['rules', 'ops', 'alert: boiler 7 overheating', 'Alerts are deduplicated (one open alert per device and rule) and sent to the operator’s tools.'],
      ['st', 'tsdb', 'warm path (batch ~10 s)', 'A connector batches rows into the time-series DB; dashboards see data within ~10-30 s.', 'async'],
      ['st', 'lake', 'cold path (files / 5 min)', 'Stream capture writes Parquet files every few minutes for history, analytics and ML training.', 'async'],
      ['ops', 'api', 'dashboard: last 24 h', 'An operator opens the device dashboard.'],
      ['api', 'tsdb', 'avg by 5 min bins', 'Time-range aggregate over the device’s partition: milliseconds.']],
      end: 'One stream, three consumers with different latency and cost profiles. Each can fall behind or be replayed without affecting the others.' },
    { name: 'Command and control', desc: 'An operator changes a device’s reporting interval and reboots it.', steps: [
      ['ops', 'api', 'set interval = 30 s', 'Configuration changes are desired state, not one-off messages.'],
      ['api', 'twin', 'PATCH desired (if-match v12)', 'Desired version 13 is stored even if the device is offline; it will converge when it reconnects.'],
      ['twin', 'hub', 'desired changed', 'The hub notifies the device on its desired-properties topic if connected.'],
      ['hub', 'dev', 'desired {interval: 30} v13', 'The device applies the change and reports back.'],
      ['dev', 'hub', 'reported {interval: 30} v13', 'Reported state now matches desired; the delta is empty.'],
      ['api', 'cmd', 'invoke reboot (timeout 30 s)', 'Reboot is an action, so it is a direct method with a response, not desired state.'],
      ['cmd', 'hub', 'direct method', 'Fails fast with 404 if the device is offline; the caller can retry or schedule a job.'],
      ['hub', 'dev', 'reboot request', 'The device acknowledges, then reboots and reconnects.']],
      end: 'Use desired/reported state for configuration (survives offline), direct methods for immediate actions, and jobs for fleets.' },
    { name: 'OTA firmware rollout', desc: 'Roll firmware 4.2 to 1 million meters without bricking any.', steps: [
      ['ops', 'api', 'rollout fw 4.2: 1% ring', 'The rollout targets a query of devices and starts with a canary ring.'],
      ['api', 'cmd', 'create job', 'The job schedules twin updates in throttled batches so hubs and CDN are not flooded.'],
      ['cmd', 'fw', 'stage signed image + delta', 'Images are signed by the build pipeline’s code-signing key; deltas from 4.1 reduce download size 5-10×.'],
      ['cmd', 'twin', 'desired firmware = 4.2', 'Set per device in batches; offline devices pick it up later.'],
      ['hub', 'dev', 'desired change', 'The device sees the new desired firmware version.'],
      ['dev', 'fw', 'download via CDN (signed URL)', 'Large bytes bypass the hub; downloads resume after interruptions and are scheduled in the device’s quiet window.'],
      ['dev', 'hub', 'reported: 4.2 healthy', 'The device verifies the signature, installs to the inactive A/B partition, reboots, runs self-tests and reports. On failure the bootloader rolls back to 4.1.'],
      ['cmd', 'api', 'ring 1: 99.8% success', 'The job compares success and error rates against thresholds; it promotes to 10%, then 100%, or halts automatically.', 'resp']],
      end: 'Signed images, A/B partitions with automatic rollback, staged rings with halt thresholds and CDN delivery are the minimum for safe OTA.' },
    { name: 'Edge offline', desc: 'A factory loses its internet link for six hours.', steps: [
      ['leaf', 'egw', 'Modbus readings', 'Machines keep reporting to the on-site gateway over local protocols.'],
      ['egw', 'hub', 'uplink down', 'MQTT publishes fail; the gateway switches to store-and-forward.', 'err'],
      ['egw', 'leaf', 'local rule: stop pump', 'Safety rules run locally on the gateway (IoT Edge / Greengrass modules), so the factory does not depend on the cloud to act.'],
      ['egw', 'hub', 'reconnect: drain backlog', 'When the link returns, the gateway sends buffered messages oldest-first at a throttled rate, with original event timestamps and message ids.'],
      ['hub', 'st', 'late events', 'The stream absorbs the burst; consumers scale out on lag.'],
      ['st', 'tsdb', 'insert by event time', 'Warm and cold paths use event time, so the dashboards fill in the gap; duplicates are dropped by message id.', 'async'],
      ['st', 'rules', 'late data policy', 'Hot-path rules use watermarks: very late events update aggregates but do not fire stale alerts.', 'async']],
      end: 'Design for disconnection: local autonomy at the edge, bounded local buffers, idempotent ids, event-time processing and throttled catch-up.' }
  ],
  components: [
    ['Device Provisioning Service', 'Attest device identity on first boot and assign it to a hub and tenant (zero-touch).'],
    ['IoT hub / MQTT broker', 'Persistent device connections, mutual TLS, per-device authorisation, telemetry routing, twins, commands, throttling.'],
    ['Device registry + twins', 'Identity, metadata and desired/reported state per device; digital twin graphs for buildings or plants.'],
    ['Telemetry stream', 'Durable buffer decoupling ingestion from processing; partitioned by device id; replayable.'],
    ['Hot path', 'Stream processing rules for alerts and automated actions within seconds.'],
    ['Warm path', 'Time-series DB for dashboards and operational APIs (days to months).'],
    ['Cold path', 'Data lake for years of history, batch analytics and ML training.'],
    ['Command service and jobs', 'Direct methods, cloud-to-device messages, fleet jobs, OTA rollouts with rings.'],
    ['Edge gateways', 'Protocol translation, local rules and ML, store-and-forward when offline.']
  ],
  evolutionTitle: 'From a pilot to millions of devices',
  evolution: [
    { name: '1. HTTP pilot', desc: 'A few hundred devices POST readings to an API that writes to SQL.', diagram: { nodes: [['d', 'Devices', 'device', 0, 0], ['a', 'REST API', 'svc', 1.5, 0], ['db', 'SQL DB', 'db', 3, 0]], edges: [['d', 'a', 'HTTPS POST'], ['a', 'db']] },
      steps: [['d', 'a', 'POST reading', 'Simple, but every reading costs a TLS handshake or a kept-alive connection the device must manage, and the server cannot push commands.'], ['a', 'db', 'INSERT', 'SQL tables bloat with time-series data; fine for thousands of devices, not millions.']] },
    { name: '2. MQTT hub + stream', desc: 'Persistent MQTT connections to a hub; telemetry into a stream and a time-series DB.', diagram: { nodes: [['d', 'Devices', 'device', 0, 0.5], ['h', 'IoT hub', 'gw', 1.3, 0.5], ['s', 'Stream', 'stream', 2.6, 0.5], ['t', 'Time-series DB', 'tsdb', 3.9, 0]], edges: [['d', 'h', 'MQTT'], ['h', 's'], ['s', 't', '', 'async']] },
      steps: [['d', 'h', 'MQTT QoS 1', 'One long-lived connection carries telemetry up and commands down.'], ['h', 's', 'route', 'The stream absorbs bursts.'], ['s', 't', 'ingest', 'Purpose-built storage for time series.', 'async']] },
    { name: '3. Full platform', desc: 'Provisioning, twins, edge gateways, hot/warm/cold paths and OTA.', diagram: { nodes: [['d', 'Devices + edge', 'device', 0, 0.6], ['p', 'Provisioning', 'svc', 1.3, 0], ['h', 'IoT hubs', 'gw', 1.3, 1.2, 'sharded'], ['s', 'Stream', 'stream', 2.6, 1.2], ['r', 'Hot / warm / cold', 'worker', 3.9, 1.2], ['tw', 'Twins', 'nosql', 2.6, 0]], edges: [['d', 'p'], ['d', 'h'], ['h', 's'], ['s', 'r', '', 'async'], ['h', 'tw']] },
      steps: [['d', 'p', 'zero-touch', 'Devices self-provision with certificates.'], ['d', 'h', 'MQTT', 'Devices are spread over many hubs (blast radius).'], ['h', 'tw', 'desired/reported', 'State and commands survive offline periods.'], ['s', 'r', 'three paths', 'Alerts, dashboards and history from one stream.', 'async']] }
  ],
  deep: [
    ['Device identity and provisioning', '<ul><li><strong>Per-device X.509 certificates</strong> generated inside a secure element or TPM at manufacture and signed by the manufacturer’s intermediate CA. No shared keys in firmware images: one leaked image must not compromise the fleet.</li><li><strong>Enrollment groups</strong> trust a CA (or intermediate) rather than individual certificates, so millions of devices can self-register. Individual enrollments for special cases.</li><li><strong>Provisioning service</strong> (Azure DPS, AWS IoT fleet provisioning / just-in-time provisioning) attests the certificate, applies an allocation policy (geo-nearest hub, tenant, evenly weighted) and returns the hub endpoint.</li><li><strong>Lifecycle</strong>: certificate rotation before expiry via a CSR flow over MQTT; disable or revoke in the registry instantly; re-provision when a device is resold or moved.</li><li><strong>Authorisation</strong>: a device may only publish to and subscribe on its own topics (policy variables such as ${iot:Connection.Thing.ThingName}).</li></ul>'],
    ['MQTT and the hub', '<p>MQTT is a tiny publish/subscribe protocol over one long-lived TCP+TLS connection: a 2-byte fixed header, keepalives, persistent sessions, retained messages and last-will messages (announce “offline” when a device vanishes). <strong>QoS 0</strong> is fire-and-forget, <strong>QoS 1</strong> is at-least-once with PUBACK (the practical default: make consumers idempotent by message id), <strong>QoS 2</strong> exactly-once is rarely supported by cloud hubs because of its cost. MQTT 5 adds message expiry, user properties, shared subscriptions and reason codes.</p><p>Why not HTTP? The server must push commands to devices behind NAT, and per-request TLS is expensive for battery devices. Scale levers: shard devices over many hubs or broker clusters (each a failure domain), throttle per device and per hub, keep payloads binary (CBOR/Protobuf), batch several readings per message, and jitter reconnects so a regional outage does not produce a synchronised reconnect storm.</p>'],
    ['Device shadows and digital twins', '<p>A <strong>shadow / twin</strong> is a JSON document per device with <em>desired</em> (what the cloud wants), <em>reported</em> (what the device says) and a version. The cloud writes desired, the device writes reported, and the difference (delta) is the work to do. This makes configuration robust to offline devices and to message loss: on reconnect the device fetches the full twin and converges. Use it for state (“interval = 30 s”, “firmware = 4.2”); use direct methods for actions (“reboot now”) and telemetry for measurements.</p><p>A <strong>digital twin graph</strong> (Azure Digital Twins with DTDL models, AWS IoT TwinMaker) goes further: it models the physical environment, such as building &rarr; floor &rarr; room &rarr; sensor, so queries like “average temperature per floor” or “all pumps downstream of valve 7” are possible.</p>'],
    ['Hot, warm and cold paths', '<table><tr><th>Path</th><th>Latency</th><th>Technology</th><th>Use</th></tr><tr><td>Hot</td><td>seconds</td><td>Stream processing (Flink, Stream Analytics, Kinesis + Lambda)</td><td>Threshold and pattern alerts, automated actions, anomaly scores</td></tr><tr><td>Warm</td><td>10-60 s</td><td>Time-series DB (Azure Data Explorer, Timestream, TimescaleDB)</td><td>Dashboards, per-device history, operational APIs (30-90 days)</td></tr><tr><td>Cold</td><td>minutes-hours</td><td>Data lake (Parquet/Delta) + Spark/SQL</td><td>Years of history, reporting, ML training, compliance</td></tr></table><p>All three read the same stream with separate consumer groups, so each scales and fails independently and can be replayed from the stream’s retention (e.g. 7 days). Use <strong>event time</strong> with watermarks everywhere, because devices buffer and send late.</p>'],
    ['OTA updates and edge gateways', '<p><strong>OTA</strong>: images are signed in the build pipeline and verified by the bootloader; A/B (dual-bank) partitions let the device boot the new image, run health checks and roll back automatically if they fail; delta updates save bandwidth; rollouts go in rings (internal, 1%, 10%, 100%) with automatic halt if failure or crash rates exceed thresholds; downloads come from a CDN via signed URLs, not through the hub.</p><p><strong>Edge gateways</strong> (Azure IoT Edge, AWS IoT Greengrass) run containerised modules near the devices: protocol translation (Modbus, OPC UA, BLE to MQTT), local filtering and aggregation (send 1-minute averages instead of 100 Hz samples), local ML inference, local safety rules, and store-and-forward with bounded disk buffers during outages. The gateway is itself a managed device with identity, twin and OTA.</p>']
  ],
  scale: [
    '<strong>Connection count:</strong> millions of idle TLS connections cost memory, not CPU; shard devices across hubs/broker clusters (~1 M per hub) and use long keepalives.',
    '<strong>Reconnect storms:</strong> after a regional outage every device reconnects at once. Enforce randomised exponential backoff in firmware, admission control at the hub, and stagger keepalive timers.',
    '<strong>Synchronised schedules:</strong> “every device reports at :00” creates 60&times; spikes; add per-device jitter to reporting schedules.',
    '<strong>Hot partitions:</strong> partition the stream by device id, not by site or tenant, so one large customer cannot overload one partition.',
    '<strong>Storage cost:</strong> downsample at the edge or in the warm path (keep raw for days, 1-minute aggregates for months), move history to the lake, and use binary payloads.',
    '<strong>Command fan-out:</strong> fleet jobs must be throttled per hub and per tenant; use desired state so offline devices do not need retries.'
  ],
  tradeoffs: [
    ['Protocol', 'MQTT vs HTTP vs CoAP/LwM2M', 'MQTT for always-connected devices (bidirectional, efficient); CoAP/LwM2M for very constrained battery devices on NB-IoT; HTTP only for occasional uploads.'],
    ['Managed hub vs self-hosted broker', 'IoT Hub / IoT Core vs EMQX / HiveMQ on Kubernetes', 'Managed: identity, twins, provisioning and scale handled for you; self-hosted when you need custom MQTT features, multi-cloud or lower cost at extreme scale.'],
    ['Processing location', 'Cloud only vs edge gateways', 'Edge for latency-critical safety logic, bandwidth reduction and offline autonomy; cloud for fleet-wide analytics.'],
    ['Delivery guarantee', 'QoS 0 vs QoS 1', 'QoS 1 with idempotent consumers: at-least-once is cheap, exactly-once (QoS 2) is rarely worth it.'],
    ['Storage tiers', 'Everything in one TSDB vs warm + cold', 'Warm TSDB for 30-90 days plus a data lake: an order of magnitude cheaper for years of data.']
  ],
  failures: [
    ['Device loses connectivity', 'Local buffering with bounded storage and oldest-first drain; twins make configuration converge later; last-will marks it offline.'],
    ['Hub or broker outage in a region', 'Devices spread over many hubs; devices retry with jittered backoff; failover hub in a paired region via provisioning re-assignment.'],
    ['Stream consumers fall behind', 'Stream retention (days) decouples ingest; autoscale consumers on lag; hot path prioritised over warm and cold catch-up.'],
    ['Bad firmware release', 'Signed images, A/B partitions with automatic rollback, staged rings with halt thresholds.'],
    ['Compromised device or key', 'Per-device certificates, revoke/disable in the registry, topic-level least privilege so one device cannot read or spoof others, anomaly detection on traffic.'],
    ['Clock drift on devices', 'Hub enqueue time recorded alongside device time; NTP/SNTP sync on connect; rules reject timestamps far in the future.'],
    ['Alert storms (a site goes down)', 'Deduplicate by device and rule, group by site, suppress child alerts when the gateway is offline.']
  ],
  cloud: [['IoT hub / device gateway', 'iot'], ['Device provisioning', 'Azure IoT Hub Device Provisioning Service', 'AWS IoT Core fleet provisioning'], ['Edge runtime', 'Azure IoT Edge', 'AWS IoT Greengrass'],
    ['Digital twin graph', 'Azure Digital Twins', 'AWS IoT TwinMaker'], ['Telemetry stream', 'stream'], ['Hot path stream processing', 'streamproc'], ['Warm path time series', 'timeseries'], ['Cold path data lake', 'blob'],
    ['Analytics and reporting', 'warehouse'], ['Extended registry and rules', 'sql'], ['Commands and jobs API', 'functions'], ['Firmware distribution', 'cdn'], ['Alert notifications', 'push'],
    ['CA keys and secrets', 'secrets'], ['Operator sign-in', 'workforce'], ['Monitoring', 'monitor']],
  refs: { az: ['azStreamAsa', 'azStreamDbx', 'azBigData', 'azEventDriven', 'azp-queue-based-load-leveling', 'azp-sharding', 'azp-valet-key', 'azPartition'],
          aws: ['awsIotLens', 'awsAnalyticsLens', 'blBacklog', 'blConstant', 'awsPubSub', 'blBackoff'] },
  questions: [
    ['Why per-device certificates instead of a shared API key?', 'A shared key in firmware means one extracted image compromises the whole fleet and you cannot revoke a single device. Per-device keys in a secure element can be revoked individually, and a CA-based enrollment group still keeps onboarding zero-touch.'],
    ['How do you send a command to a device that is offline?', 'Put it in desired state (twin/shadow) if it is configuration: the device converges when it reconnects. For time-bound actions use a job that retries until a deadline, or a cloud-to-device message with expiry. Direct methods are only for online devices.'],
    ['How do you handle a million devices reconnecting at once?', 'Randomised exponential backoff in the firmware, hubs that throttle connection rate, devices spread over many hubs, and lightweight reconnection (persistent sessions, cached tokens). Test it deliberately with load tests.'],
    ['Why both a time-series DB and a data lake?', 'Different cost and access patterns: the TSDB answers recent per-device and aggregate queries in milliseconds but is expensive per TB; the lake stores years cheaply for batch analytics and ML. One stream feeds both.'],
    ['How do you make OTA safe?', 'Signed images verified by the bootloader, A/B partitions with health-check-based rollback, delta packages, CDN delivery, staged rings with automatic halt on elevated failure rates, and devices choosing quiet windows to install.'],
    ['How do you avoid duplicate readings with QoS 1?', 'Each message carries a device-generated id (or device id + sequence number); stream consumers and storage upserts deduplicate on it, and aggregates are computed by event time.']
  ],
  related: ['message-queue', 'observability', 'notification', 'ad-click', 'saas-platform']
});

SD.renderCase({
  slug: 'saas-platform',
  summary: 'A multi-tenant SaaS platform serves thousands of customer organisations (tenants) from one product, one code base and one operations team, while giving each tenant the experience, and the guarantees, of having the system to itself. The central design choice is the <strong>isolation model</strong>: <strong>silo</strong> (dedicated resources per tenant), <strong>pool</strong> (shared resources, tenant id on every row) or <strong>bridge</strong> (a mix, e.g. shared compute with a database per tenant), usually chosen per pricing tier. Every request carries a verified <strong>tenant context</strong> resolved by a <strong>tenant router</strong> from a <strong>tenant catalog</strong>, and the data layer enforces it. Capacity grows by adding <strong>deployment stamps</strong> (cells), complete copies of the stack that each host a bounded set of tenants and limit the blast radius. On top sit the things that make it a business: <strong>noisy-neighbour controls</strong> (per-tenant quotas, rate limits, fair scheduling), automated <strong>onboarding</strong>, per-tenant <strong>metering and billing</strong>, <strong>tenant-aware observability</strong>, and <strong>upgrades by ring</strong>.',
  examples: 'Salesforce, Microsoft 365 and Dynamics 365, Slack, Atlassian Cloud, Shopify, ServiceNow, Workday, Snowflake; patterns documented in the Azure Architecture Center multitenant guidance and the AWS SaaS Lens / SaaS Factory.',
  functional: ['Self-service sign-up creates a working tenant in under a minute; enterprise tenants get dedicated, region-pinned deployments.', 'Users sign in with the tenant’s own identity provider (SSO via SAML/OIDC) and are provisioned via SCIM.', 'Each tenant sees only its own data; admins manage users, roles, plans and settings.', 'Plans (free, standard, enterprise) with feature entitlements and usage limits.', 'Per-tenant usage metering feeding invoices and in-product usage dashboards.', 'Tenant data export, deletion and residency choice (EU, US, …).'],
  nonFunctional: ['Zero cross-tenant data leakage, verified by tests and enforced at the data layer.', 'One tenant’s spike must not degrade others beyond agreed SLOs (p95 latency, error rate per tenant).', '99.9% (standard) to 99.99% (enterprise) availability; a stamp failure affects only its tenants.', 'Cost per tenant falls with scale; free-tier tenants cost cents per month.', 'Weekly releases across all stamps with safe, ring-based rollout and per-tenant feature flags.', 'Compliance: SOC 2, ISO 27001, GDPR, data residency, customer-managed keys for enterprise.'],
  outOfScope: ['The product’s own business features.', 'Payment collection internals (see payment).', 'Marketing site and CRM.'],
  estimates: [
    ['Tenants', '50,000 organisations', 'Long tail: median 20 users; top 1% of tenants generate ~40% of load'],
    ['Users', '2 million, ~1 million daily active', 'Average 40 users per tenant'],
    ['Peak API traffic', '~15 K req/s', 'UI: 1 M DAU &times; 200 requests/day = 2.3 K/s average, &times;4 at overlapping business hours &asymp; 10 K/s; plus ~5 K/s from integrations'],
    ['Tenant data', '~1 PB total', '50 K tenants &times; ~20 GB average (median 1 GB; enterprise tenants up to 20 TB)'],
    ['Pool stamps', '~24', '~600 TB pooled data / ~25 TB per stamp database tier; ~2,000 tenants per stamp'],
    ['Silo stamps', '~50', 'Enterprise and regulated tenants with dedicated stamps (the other ~400 TB)'],
    ['Usage events', '~20 K events/s', 'API calls, job minutes, storage snapshots and seats, aggregated per tenant per minute'],
    ['Onboarding', '~200 tenants/day', 'Pool tenants ready in seconds; silo stamps in ~30-60 min via infrastructure as code'],
    ['Telemetry', '~6.5 TB/day', '15 K req/s &times; ~5 log/trace records &times; ~1 KB, all tagged with tenant id']
  ],
  compute: [
    ['Edge + tenant router', '~6 pods per region', '15 K req/s &times; ~1 ms (token validation, catalog lookup from in-memory cache, quota check) = 15 cores &rArr; ~25 at 60%, spread over 3 zones.'],
    ['Pool stamp app tier', '6-9 &times; 4 vCPU per stamp', 'Pooled share ~60% of traffic over 24 stamps &asymp; 375 req/s per stamp &times; ~30 ms CPU = 11 busy cores &rArr; ~19 at 60% &rArr; 6 instances (2 per zone), up to 9 for zone loss.'],
    ['Pool stamp database', 'One sharded relational cluster or elastic pool per stamp, 16-32 vCores', '~2,000 tenants, ~25 TB, a few thousand queries/s; tenants are placed so that no single tenant exceeds ~10% of a stamp.'],
    ['Silo stamps', '~50 &times; minimum footprint (3 small app instances + 8-vCore DB)', 'Fixed cost per silo is the reason silos are an enterprise tier with a minimum price; they autoscale like pool stamps above the floor.'],
    ['Rate limits and quotas', 'Redis per region', '~15 K token-bucket checks/s: tiny; replicated so a node loss fails open for read-only, closed for expensive operations.'],
    ['Metering pipeline', 'Stream + small stream-processing job', '20 K events/s aggregated to (tenant, meter, minute): ~50 K tenants &times; a few meters per minute &asymp; a few thousand rows/s into the usage ledger.']
  ],
  api: [
    ['https://{tenant}.app.example.com/api/…  |  custom domains', 'Tenant resolved from host name or a verified token claim (tid); never from an unverified client header.'],
    ['POST /tenants {name, plan, region, adminEmail}', 'Control-plane sign-up: creates the catalog entry, places the tenant on a stamp, seeds data, configures identity, emits tenant.created.'],
    ['PUT /tenants/{id}/plan  |  PUT /tenants/{id}/sso', 'Change tier (may trigger a move from pool to silo); configure SAML/OIDC federation with the customer’s IdP.'],
    ['/scim/v2/Users, /scim/v2/Groups', 'SCIM 2.0 user and group provisioning from the customer’s directory (joiners and leavers).'],
    ['GET /tenants/{id}/usage?period=2026-10', 'Usage by meter for the tenant’s dashboard and invoices.'],
    ['POST /stamps/{id}/tenants/{tid}:move (internal)', 'Operator action to rebalance or promote a tenant to another stamp.'],
    ['Events: tenant.created, tenant.plan_changed, usage.recorded', 'Published by the control plane and stamps; consumed by billing, CRM and analytics.']
  ],
  data: [
    ['tenant catalog', 'Relational DB (global, geo-replicated) + cache', 'tenant_id, slug, custom domains, plan, isolation model (pool/bridge/silo), home region, stamp_id, deployment ring, limits, status, keys. Read on every request (cached), written rarely.'],
    ['pooled business data', 'Relational per pool stamp, sharded by tenant_id', 'Every table has tenant_id as the leading key column; row-level security policies; composite indexes (tenant_id, …); a tenant never spans shards.'],
    ['bridged / silo business data', 'Database per tenant (elastic pool) or dedicated stamp', 'Same schema as pooled; per-tenant encryption keys (customer-managed for enterprise), per-tenant backup and restore.'],
    ['quotas and rate limits', 'Redis', 'Token buckets per (tenant, API class); concurrency counters; limits come from the plan in the catalog.'],
    ['usage ledger', 'Relational, partitioned by period', '(tenant_id, meter, period, quantity, source_event_ids); unique on event id for idempotency; immutable once invoiced.'],
    ['tenant telemetry and audit', 'Log analytics + immutable storage', 'Logs and traces with tenant_id; per-tenant audit log (who did what) in append-only, retention-locked storage.']
  ],
  dbChoice: [
    ['Tenant catalog', 'Relational with geo-replicas (or Cosmos DB multi-region)', 'Small, critical, read on every request: replicate globally, cache aggressively, and make the router work from cache if the catalog is briefly unavailable.', 'Hard-coding tenant&rarr;stamp in DNS: simple, but moves and plan changes become slow and error-prone.'],
    ['Pooled tenant data', 'Relational sharded by tenant id with row-level security', 'Most SaaS data is relational; tenant_id as shard key keeps each tenant’s queries on one shard; RLS backs up application checks.', 'Schema-per-tenant: good isolation, but migrations across thousands of schemas are slow. Database-per-tenant for all: simplest isolation, highest cost and management overhead at 50 K tenants.'],
    ['Enterprise tenant data', 'Dedicated database (bridge) or full silo stamp', 'Contractual isolation, customer-managed keys, residency, independent restore and maintenance windows.', 'Pooled with stronger controls: cheaper, but many enterprise buyers require dedicated resources.'],
    ['Usage and billing', 'Stream + relational ledger', 'Exactly-once accounting needs idempotent, auditable records.', 'Computing bills from logs: lossy and hard to audit.']
  ],
  diagram: {
    nodes: [['t', 'Tenant users', 'client', 0, 1.5, 'browser, API clients'], ['idp', 'Identity (IdP)', 'ext', 1, 0, 'SSO per tenant'], ['edge', 'Edge + WAF', 'edge', 1, 1.5, 'custom domains, TLS'],
      ['cat', 'Tenant catalog', 'db', 2, 0, 'tier, stamp, region'], ['rt', 'Tenant router', 'gw', 2, 1.5, 'tenant → stamp'], ['rl', 'Rate limits', 'cache', 2, 2.8, 'per-tenant quotas'],
      ['ctl', 'Control plane', 'svc', 3, 0, 'onboarding, upgrades'], ['appA', 'Pool stamp apps', 'svc', 3, 1.1, 'many tenants'], ['dbA', 'Pooled DB', 'db', 4, 0.8, 'tenant_id + RLS'],
      ['appB', 'Silo stamp apps', 'svc', 3, 2.1, 'one enterprise tenant'], ['dbB', 'Dedicated DB', 'db', 4, 2.4, 'customer-managed key'], ['ev', 'Tenant events', 'stream', 5, 1.6, 'usage + telemetry'],
      ['bill', 'Metering + billing', 'svc', 6, 1.6, 'rating, invoices'], ['obs', 'Tenant telemetry', 'tsdb', 5, 2.9, 'per-tenant SLOs']],
    edges: [['t', 'idp', 'sign in'], ['t', 'edge'], ['edge', 'rt'], ['rt', 'cat', 'lookup (cached)'], ['rt', 'rl'], ['rt', 'appA'], ['rt', 'appB'], ['appA', 'dbA'], ['appB', 'dbB'],
      ['ctl', 'cat'], ['ctl', 'appA', 'deploy'], ['ctl', 'dbA'], ['appA', 'ev', '', 'async'], ['appB', 'ev', '', 'async'], ['ev', 'bill', '', 'async'], ['ev', 'obs', '', 'async']],
    zones: [['Stamp 1 (pool)', 3, 0.8, 4, 1.1], ['Stamp 2 (silo)', 3, 2.1, 4, 2.4]]
  },
  flows: [
    { name: 'Request with tenant context', desc: 'A user at Acme calls the API: resolve the tenant, apply its limits, route to its stamp, enforce isolation in the database.', steps: [
      ['t', 'idp', 'SSO sign-in', 'The user signs in through Acme’s own identity provider (federated); the platform issues a token with tid = acme and the user’s roles.'],
      ['t', 'edge', 'GET acme.app.com/api/orders', 'TLS terminates at the edge, which also serves Acme’s custom domain certificate.'],
      ['edge', 'rt', 'forward', 'All tenants share the same front door; the router decides where each request goes.'],
      ['rt', 'cat', 'acme → stamp-1, standard', 'Catalog lookup from an in-memory cache (refreshed every minute and on change events). The host name must match the token’s tenant, which blocks token reuse across tenants.'],
      ['rt', 'rl', 'token bucket acme:api', 'Per-tenant rate limit and concurrency check based on the plan: 1,000 requests/min for standard.'],
      ['rt', 'appA', 'forward + tenant context', 'The router adds a signed tenant context (tenant, plan, region); services take the tenant only from this or the token, never from a client-supplied header.'],
      ['appA', 'dbA', 'SET app.tenant=acme; SELECT', 'The data layer sets the session’s tenant and row-level security filters every query, so a missing WHERE clause cannot leak another tenant’s rows.'],
      ['appA', 'ev', 'usage: 1 api_call (acme)', 'Usage and telemetry events carry the tenant id.', 'async'],
      ['appA', 't', '200 OK', 'Normal response; latency and errors are recorded per tenant.', 'resp']],
      end: 'Tenant context is established once at the edge from verified inputs, carried through every hop, and enforced again where the data lives.' },
    { name: 'Tenant onboarding', desc: 'A new company signs up for the standard plan and is working within a minute.', steps: [
      ['t', 'edge', 'POST /tenants (sign-up)', 'The admin chooses a name, plan and data region.'],
      ['edge', 'ctl', 'to control plane', 'Onboarding is a control-plane workflow (durable orchestration with retries and compensation), separate from the data plane.'],
      ['ctl', 'cat', 'create tenant, pick stamp', 'Placement picks a pool stamp in the chosen region with spare capacity; enterprise tiers instead trigger an infrastructure-as-code pipeline for a new silo stamp.'],
      ['ctl', 'dbA', 'seed tenant rows', 'For pooled tenants this is a few inserts (settings, default roles, sample data): seconds.'],
      ['ctl', 'idp', 'configure sign-in', 'Create the tenant’s identity configuration; SSO federation and SCIM can be added later by the tenant admin.'],
      ['ctl', 'rl', 'set plan limits', 'Rate limits and quotas for the standard plan are activated.'],
      ['ctl', 'ev', 'tenant.created', 'Billing creates the subscription, CRM gets the account, analytics starts tracking activation.', 'async'],
      ['ctl', 't', 'welcome: acme.app.com', 'The tenant is live. The same workflow is used by sales for enterprise deals, with approval steps.', 'resp']],
      end: 'Fully automated onboarding is what makes thousands of tenants operable; the catalog is the single source of truth for where each tenant lives.' },
    { name: 'Noisy neighbour', desc: 'One tenant launches a massive export and hammers the API from an integration.', steps: [
      ['t', 'edge', 'burst: 50 K req/min (tenant X)', 'A misconfigured integration at tenant X loops.'],
      ['edge', 'rt', 'forward', 'Edge-level protections handle volumetric abuse; this is legitimate but excessive traffic.'],
      ['rt', 'rl', 'bucket X empty', 'Tenant X has exceeded its plan’s rate.', 'err'],
      ['rt', 't', '429 + Retry-After', 'Only tenant X is throttled; others on the same stamp see no change.', 'err'],
      ['appA', 'dbA', 'export: tenant queue, timeout', 'Heavy jobs run in per-tenant queues with fair-share scheduling and concurrency caps; queries have timeouts and per-tenant connection limits.'],
      ['ev', 'obs', 'X uses 35% of stamp-1 DB', 'Tenant-aware telemetry shows who is consuming the shared resources.', 'async'],
      ['ctl', 'cat', 'move X to its own stamp', 'If X is persistently large, the control plane migrates it (copy, change-data-capture catch-up, brief write freeze, catalog switch) and suggests a higher tier.']],
      end: 'Layered controls: per-tenant rate limits at the edge, fair queues and resource limits inside, visibility per tenant, and the option to move whales.' },
    { name: 'Metering to invoice', desc: 'Usage events become an accurate monthly bill.', steps: [
      ['appA', 'ev', 'usage events (event ids)', 'Services emit raw usage: API calls, job minutes, storage GB snapshots, active seats.', 'async'],
      ['appB', 'ev', 'usage events', 'Silo stamps emit the same events: one billing pipeline for every isolation model.', 'async'],
      ['ev', 'bill', 'aggregate per tenant/minute', 'A stream job aggregates by (tenant, meter, minute) and writes to the usage ledger, deduplicating by event id so retries never double-bill.', 'async'],
      ['ev', 'obs', 'usage vs plan limits', 'The same data drives in-product usage dashboards and alerts when a tenant approaches its limits.', 'async'],
      ['bill', 't', 'invoice + usage report', 'At period end, rating applies the plan’s prices, tiers and commitments; invoices are issued via the billing provider or cloud marketplace metering APIs.', 'resp']],
      end: 'Metering is a data pipeline with accounting rules: idempotent events, immutable ledger rows and reconciliation against provider invoices.' },
    { name: 'Upgrade by ring', desc: 'Release v42 rolls out ring by ring; a regression hits one tenant segment.', steps: [
      ['ctl', 'appA', 'deploy v42 to ring 1 stamps', 'Ring 0 (internal tenants) has run v42 for a day; ring 1 is free and early-adopter stamps. Schema changes were applied as expand-only migrations first.'],
      ['appA', 'ev', 'telemetry by tenant', 'Error rates and latency are compared per tenant and per stamp against the previous version.', 'async'],
      ['ev', 'obs', 'error rate ↑ for 12 tenants', 'The regression only shows for tenants using a specific integration: aggregate metrics would have hidden it.', 'err'],
      ['obs', 'ctl', 'halt rollout', 'Automated health gates stop the rollout before ring 2 (broad) and ring 3 (enterprise, maintenance windows).', 'err'],
      ['ctl', 'appA', 'roll back / disable flag', 'The new code path is behind a per-tenant feature flag: switch it off for affected tenants, or roll back ring 1 stamps.'],
      ['ctl', 'cat', 'record ring state', 'The catalog tracks which version and flags each stamp and tenant has.']],
      end: 'Stamps plus rings plus per-tenant flags turn every release into a controlled experiment with a small blast radius.' }
  ],
  components: [
    ['Control plane', 'Tenant lifecycle (onboarding, plan changes, moves, offboarding), stamp provisioning via IaC, ring-based deployments, feature flags.'],
    ['Tenant catalog', 'Source of truth: tenant &rarr; plan, isolation model, region, stamp, ring, limits, domains, keys.'],
    ['Tenant router / gateway', 'Resolve tenant from host or token, enforce per-tenant rate limits, route to the right stamp, attach signed tenant context.'],
    ['Deployment stamps', 'Independent copies of the application and data tier, each hosting a bounded set of tenants (pool) or one tenant (silo).'],
    ['Data layer', 'Tenant-scoped data access with row-level security, per-tenant keys, shard placement by tenant.'],
    ['Metering and billing', 'Usage events, idempotent aggregation, ledger, rating and invoicing; marketplace integration.'],
    ['Tenant-aware observability', 'Logs, metrics and traces tagged by tenant; per-tenant SLOs and usage dashboards; audit logs.']
  ],
  evolutionTitle: 'From one install per customer to stamps and tiers',
  evolution: [
    { name: '1. Install per customer', desc: 'Each customer gets their own copy of the software, often on-premises or a dedicated VM.', diagram: { nodes: [['a', 'Customer A', 'client', 0, 0], ['b', 'Customer B', 'client', 0, 1.1], ['sa', 'App + DB (A)', 'svc', 1.5, 0], ['sb', 'App + DB (B)', 'svc', 1.5, 1.1]], edges: [['a', 'sa'], ['b', 'sb']] },
      steps: [['a', 'sa', 'own deployment', 'Perfect isolation, but every customer is a separate upgrade project.'], ['b', 'sb', 'different version', 'Versions drift, costs do not fall with scale, and onboarding takes weeks.']] },
    { name: '2. Pooled multi-tenant', desc: 'One shared app and database with tenant_id on every row.', diagram: { nodes: [['u', 'All tenants', 'client', 0, 0.5], ['app', 'Shared app', 'svc', 1.5, 0.5, 'tenant context'], ['db', 'Shared DB', 'db', 3, 0.5, 'tenant_id + RLS']], edges: [['u', 'app'], ['app', 'db']] },
      steps: [['u', 'app', 'any tenant', 'Onboarding is an insert; one deployment upgrades everyone.'], ['app', 'db', 'WHERE tenant_id = ?', 'Cheapest per tenant, but noisy neighbours and blast radius grow with every customer.']] },
    { name: '3. Stamps + tiers', desc: 'A catalog and router in front of many stamps: pooled for small tenants, dedicated for enterprise.', diagram: { nodes: [['u', 'Tenants', 'client', 0, 0.6], ['r', 'Router + catalog', 'gw', 1.3, 0.6], ['p1', 'Pool stamp 1', 'svc', 2.6, 0], ['p2', 'Pool stamp 2', 'svc', 2.6, 1.2], ['s', 'Silo stamp', 'svc', 3.9, 0.6, 'enterprise']], edges: [['u', 'r'], ['r', 'p1'], ['r', 'p2'], ['r', 's']] },
      steps: [['u', 'r', 'request', 'Tenant resolved centrally.'], ['r', 'p1', 'small tenants', 'Pool stamps host thousands of tenants each.'], ['r', 's', 'enterprise', 'Dedicated stamps for isolation, residency and keys.'], ['r', 'p2', 'scale by adding stamps', 'Capacity and blast radius are both bounded per stamp.']] }
  ],
  deep: [
    ['Isolation models: silo, pool, bridge', '<table><tr><th></th><th>Silo</th><th>Bridge</th><th>Pool</th></tr><tr><td>What is dedicated</td><td>Everything (stamp per tenant)</td><td>Some tiers (e.g. database per tenant, shared compute)</td><td>Nothing: tenant_id on shared resources</td></tr><tr><td>Isolation</td><td>Strongest; easy compliance story</td><td>Data isolated, compute shared</td><td>Logical only: must be enforced in code and DB</td></tr><tr><td>Cost per tenant</td><td>Highest (fixed floor)</td><td>Medium</td><td>Lowest</td></tr><tr><td>Noisy neighbours</td><td>None</td><td>Compute only</td><td>Must be engineered</td></tr><tr><td>Operations</td><td>N deployments to upgrade and monitor</td><td>N databases to migrate</td><td>One of everything</td></tr><tr><td>Onboarding</td><td>Minutes to an hour (IaC)</td><td>Seconds to minutes</td><td>Seconds</td></tr></table><p>Most platforms mix them by tier: free and standard tenants pooled, premium tenants bridged (own database in an elastic pool), enterprise and regulated tenants siloed. The application code is identical; only placement and configuration differ, which is why everything must be driven by the catalog.</p>'],
    ['Tenant routing and tenant context', '<p>Resolve the tenant from something verifiable: the host name (subdomain or verified custom domain) and the <code>tid</code> claim in the access token, and require them to agree. The router looks up the catalog (cached) and forwards to the stamp, adding a signed tenant context. Inside, every service takes the tenant from that context, propagates it on calls and messages (headers, message properties, trace baggage), and keys caches by tenant. The data layer enforces it again:</p><pre><code>-- PostgreSQL row-level security\nALTER TABLE orders ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON orders\n  USING (tenant_id = current_setting(\'app.tenant_id\')::uuid);\n-- per request, in the same transaction\nSET LOCAL app.tenant_id = \'6f1c…\';</code></pre><p>Add automated cross-tenant tests (tenant A’s token must never read tenant B’s ids), per-tenant encryption keys for sensitive data, and background jobs that always carry an explicit tenant id.</p>'],
    ['Deployment stamps (cells)', '<p>A stamp is a complete, independently deployable copy of the data plane (app tier, databases, caches, queues) in one region, sized to a tested limit (e.g. 2,000 tenants or 25 TB). Benefits: <strong>scale-out</strong> by adding stamps rather than growing one system forever; <strong>blast radius</strong> limited to the stamp’s tenants; <strong>residency</strong> by placing stamps in regions; <strong>safe deployment</strong> one stamp at a time. Costs: a global control plane, a catalog and router, and <strong>tenant moves</strong> between stamps (copy data, keep it in sync with change-data capture, freeze writes briefly, flip the catalog entry, verify, clean up). Keep the control plane separate from the data plane, so a control-plane outage stops onboarding but not tenants’ work.</p>'],
    ['Noisy-neighbour controls', '<ul><li><strong>At the door:</strong> per-tenant token-bucket rate limits and concurrency limits by plan and API class; 429 with Retry-After.</li><li><strong>Inside:</strong> per-tenant (or per-tier) queues with weighted fair scheduling for background work; bulkheads (separate pools for interactive vs batch); quotas on storage, objects and seats.</li><li><strong>Database:</strong> statement timeouts, per-tenant connection limits, resource governance, and indexes that always lead with tenant_id so one tenant’s scans do not touch others’ pages.</li><li><strong>Placement:</strong> cap any single tenant at ~10% of a stamp; move whales to their own stamp; shuffle sharding for shared worker pools so a bad tenant shares only part of its capacity with any other tenant.</li><li><strong>Visibility:</strong> per-tenant consumption metrics are a prerequisite for everything above.</li></ul>'],
    ['Metering, tenant-aware observability and upgrades by ring', '<p><strong>Metering</strong>: emit usage events at the source with unique ids; aggregate idempotently into an immutable ledger; rate with plan rules; reconcile with the billing provider; report usage to customers in near real time. <strong>Observability</strong>: tag logs and traces with tenant id; for metrics, avoid putting 50 K tenant ids into high-cardinality labels: keep per-tenant detail in logs/traces and per-tier or top-N tenant metrics, with per-tenant SLO reports computed from logs. <strong>Upgrades by ring</strong>: ring 0 internal tenants, ring 1 free/early adopters, ring 2 general, ring 3 enterprise and regulated (maintenance windows, advance notice); automated health gates compare per-tenant error rates; schema changes follow expand &rarr; migrate &rarr; contract so stamps at different versions can coexist; per-tenant feature flags decouple release from deploy.</p>']
  ],
  scale: [
    '<strong>Catalog and router on every request:</strong> cache the catalog in every router instance with change notifications; make routing work from cache if the catalog database is down.',
    '<strong>Whale tenants:</strong> a tenant that outgrows its share of a pool stamp moves to a dedicated stamp; design the move as a routine, tested operation.',
    '<strong>Many small databases</strong> (bridge model): elastic pools and automation for schema migrations across thousands of databases, run in waves with progress tracking.',
    '<strong>Stamp count growth:</strong> hundreds of stamps need fleet tooling: IaC, policy, drift detection, automated certificate and secret rotation, fleet-wide dashboards.',
    '<strong>Telemetry cost:</strong> tenant-tagged telemetry grows with tenants and traffic; sample traces for healthy requests, keep all errors, and roll up per tenant.',
    '<strong>Global tenants:</strong> one tenant with users worldwide but data residency in the EU: keep data in its home stamp and accelerate with edge caching and regional read-only replicas where allowed.'
  ],
  tradeoffs: [
    ['Isolation model', 'Silo vs bridge vs pool', 'Tiered: pool for the long tail (cost), bridge for premium, silo for enterprise and regulated. Price the tiers to cover the fixed cost of isolation.'],
    ['Stamp size', 'Few large stamps vs many small ones', 'Medium: big enough for efficient pooling, small enough to bound blast radius and migration time; tested limits per stamp.'],
    ['Tenant id enforcement', 'Application checks only vs DB-level RLS too', 'Both: application filters for performance and clarity, RLS as defence in depth. One forgotten WHERE clause must not become a breach.'],
    ['Metrics granularity', 'Per-tenant metrics vs per-tier plus logs', 'Per-tier and top-N tenant metrics, per-tenant detail from logs and traces: avoids cardinality explosion while keeping per-tenant SLOs.'],
    ['Release model', 'Everyone on the same version vs per-tenant versions', 'Same version everywhere with a short ring rollout and per-tenant feature flags; long-lived per-tenant versions destroy the SaaS cost advantage.']
  ],
  failures: [
    ['Cross-tenant data leak', 'Tenant context from verified token and host only, RLS in the database, tenant-keyed caches, automated cross-tenant tests, per-tenant encryption keys.'],
    ['Stamp outage', 'Only that stamp’s tenants are affected; zone-redundant stamps; for enterprise, paired-region standby stamp and runbooks to fail over via the catalog.'],
    ['Catalog database unavailable', 'Routers serve from cached catalog; control-plane actions (onboarding, moves) pause; data plane continues.'],
    ['Noisy neighbour saturates a stamp', 'Per-tenant rate limits, fair queues, DB resource limits; alert on per-tenant share; move the tenant.'],
    ['Bad release', 'Ring rollout with health gates on per-tenant metrics, feature flags, backward-compatible migrations, fast rollback per stamp.'],
    ['Double or missed billing', 'Idempotent usage events, immutable ledger, daily reconciliation between raw events, ledger and invoices.'],
    ['Failed tenant move', 'Moves are resumable workflows; the catalog flips only after verification; the source stays authoritative until then.']
  ],
  cloud: [['Global entry, custom domains and WAF', 'cdn'], ['Tenant router and rate limits', 'apigw'], ['Tenant sign-in and federation', 'identity'], ['Stamp compute (containers)', 'k8s'], ['Pooled and per-tenant databases', 'sql'], ['Tenant catalog (multi-region option)', 'nosql'], ['Quotas and rate-limit counters', 'cache'], ['Usage and tenant events', 'stream'],
    ['Usage aggregation', 'streamproc'], ['Onboarding workflows', 'workflow'], ['Tenant telemetry', 'logs'], ['Usage analytics', 'warehouse'], ['Per-tenant keys', 'secrets'],
    ['Stamp infrastructure as code', 'Bicep / Terraform', 'AWS CloudFormation / CDK'], ['Marketplace billing', 'Microsoft commercial marketplace metering', 'AWS Marketplace metering'], ['Monitoring', 'monitor']],
  refs: { az: ['azMultitenant', 'azp-deployment-stamp', 'azp-throttling', 'azp-rate-limiting-pattern', 'azp-gateway-routing', 'azp-bulkhead', 'azp-sharding', 'azMission'],
          aws: ['awsSaasLens', 'blShuffle', 'blShedding', 'blStatic', 'blDeploy', 'awsDdbBest'] },
  questions: [
    ['How do you choose between silo, pool and bridge?', 'By tier and requirement: compliance, residency and customer-managed keys push towards silo; cost and onboarding speed towards pool. Most platforms offer all three behind one code base and catalog, priced so dedicated isolation covers its fixed cost.'],
    ['How do you guarantee one tenant cannot see another’s data?', 'Defence in depth: tenant derived only from verified token and host; signed tenant context; repository layer that requires a tenant id; database row-level security; tenant-keyed caches and object storage prefixes; automated cross-tenant tests; per-tenant keys so even a leaked backup of one tenant’s data cannot be read with another’s.'],
    ['What is a deployment stamp and why use it?', 'A full independent copy of the data plane that hosts a bounded set of tenants. It lets you scale by adding copies, limits the blast radius of failures and bad releases, and places tenants in specific regions. The price is a control plane, a catalog, a router and tenant moves.'],
    ['How do you move a tenant between stamps without downtime?', 'Copy a snapshot to the target, stream changes with CDC until lag is near zero, briefly freeze writes for that tenant, apply the last changes, flip the catalog entry (routers pick it up within seconds), verify, then delete the source after a safety period.'],
    ['How do you handle per-tenant metrics with 50,000 tenants?', 'Do not make tenant id a label on every metric. Keep tenant id on logs and traces (columnar log stores handle the cardinality), compute per-tenant SLOs from them, and expose per-tier and top-N tenant metrics for alerting.'],
    ['How do you bill for usage accurately?', 'Emit usage events at the source with unique ids, aggregate idempotently into an immutable ledger per tenant and period, rate against the plan, and reconcile daily. Never compute bills directly from logs that may be sampled or lost.']
  ],
  related: ['scaling-web-app', 'rate-limiter', 'observability', 'payment', 'collab-editor']
});

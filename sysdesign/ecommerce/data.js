SD.renderCase({
  slug: 'ecommerce',
  summary: 'An Amazon-style marketplace is really several systems with very different needs glued together by events. The <strong>browse</strong> side (catalog, search, product pages, recommendations) is read-heavy, tolerant of seconds of staleness and served mostly from caches and a search index. The <strong>buy</strong> side (cart, checkout, inventory, payment, orders) is write-heavy at the moment of truth and must never oversell or double-charge. The core of the design is a <strong>checkout saga</strong>: reserve inventory, authorise payment, create the order, and run compensating actions when any step fails, with every step idempotent and every state change published through a <strong>transactional outbox</strong> so search, fulfilment, email and recommendations stay in sync without distributed transactions.',
  examples: 'Amazon, eBay, Zalando, Flipkart, Mercado Libre, Shopify storefronts, Walmart Marketplace; Amazon popularised the service-per-domain split (catalog, cart, order, inventory) and the "two-pizza team" ownership that goes with it.',
  functional: ['Sellers list products (title, attributes, images, variants, price, stock per warehouse).', 'Shoppers search and browse with filters and facets, and view product pages with price and availability.', 'Shoppers add items to a cart that survives across devices; guest carts merge on login.', 'Checkout: reserve stock, take payment, create the order, confirm by email.', 'Order lifecycle: track, cancel before shipment, return and refund.', 'Personalised recommendations ("customers also bought") on product and home pages.'],
  nonFunctional: ['Never oversell a unit that is not in stock, and never charge twice for one order.', 'Browse p95 under 200 ms; checkout p95 under 1.5 s including payment authorisation.', 'Checkout availability 99.99% (every minute down is lost revenue); browse can degrade gracefully (stale prices for seconds, hide recommendations).', 'Absorb 10&times; traffic spikes on sale days and flash sales without falling over.', 'Search reflects price and stock changes within ~1 minute.'],
  outOfScope: ['Warehouse robotics and shipping-carrier integration (only the "ship order" event).', 'Payment internals (see <a href="../payment/index.html">payment system</a>).', 'Ranking models for search and recommendations (see <a href="../recommendation/index.html">recommendation system</a>).'],
  estimates: [
    ['Daily active users (DAU)', '50 million', 'Large marketplace; ~300 M monthly users'],
    ['Page/API reads', '1.5 B/day &rArr; ~17,000/s avg, ~90,000/s peak', '50 M &times; 30 reads / 86,400 s; peak ~5&times; on sale days'],
    ['Search queries', '500 M/day &rArr; ~5,800/s avg, ~29,000/s peak', '50 M &times; 10 searches; same 5&times; peak factor'],
    ['Orders', '5 M/day &rArr; ~58/s avg, ~600/s peak', '10% of DAU place an order; 10&times; peak on a sale day'],
    ['Flash-sale checkout attempts', '~5,000/s for minutes', 'One deal, 1 M people arriving in ~3 minutes; most will fail because stock runs out'],
    ['Catalog size', '500 M SKUs &times; 10 KB &asymp; 5 TB', 'Marketplace with many sellers; product docs with attributes and variants'],
    ['Product images', '500 M &times; 5 &times; 200 KB &asymp; 500 TB', 'Object storage behind a CDN; resized renditions on the fly'],
    ['Active carts', '50 M &times; 2 KB &asymp; 100 GB', 'Fits a key-value store comfortably; guest carts expire after 30 days'],
    ['Order data', '5 M &times; 5 KB &asymp; 25 GB/day &asymp; 9 TB/year', 'Order, line items, addresses, status history; archive after 2 years']
  ],
  compute: [
    ['Product page / catalog service', '~140 pods of 4 vCPU across 3 zones', 'Peak 90,000 reads/s, ~50% answered by CDN and edge caches &rArr; 45,000/s &times; ~5 ms CPU = 225 busy cores &rArr; 375 cores at 60% &rArr; ~94 pods; survive one zone loss (&times;1.5) &rArr; ~140.'],
    ['Search cluster', '~60 data nodes of 16 vCPU (20 shards &times; 3 copies)', 'Index ~1 TB primary (500 M docs &times; ~2 KB) &rArr; 20 shards of ~50 GB. Peak 29,000 q/s &times; ~20 ms total CPU across shards = 580 cores &rArr; ~970 at 60% &asymp; 60 &times; 16 vCPU; one replica set per zone.'],
    ['Cart store', 'Key-value, ~10,000 writes/s peak', '150 M cart updates/day &asymp; 1,700/s avg; on-demand DynamoDB / Cosmos DB, partition key user_id spreads load evenly.'],
    ['Checkout orchestrator', '~64 pods of 4 vCPU at flash-sale peak', '5,000 attempts/s &times; ~30 ms CPU (pricing, tax, saga bookkeeping) = 150 cores &rArr; 250 at 60%; autoscale on in-flight sagas, not CPU.'],
    ['Inventory database', '8 shards (by SKU hash), each primary + 2 replicas', 'Normal peak ~600 orders/s &times; 3 lines = 1,800 conditional updates/s, easy. The hard part is one hot SKU: a single row tops out at a few hundred to ~1,000 serialised updates/s, so hot SKUs are split into stock buckets (see deep dive).'],
    ['Orders database', '1 primary + standby + replicas, then shard by customer_id', '600 orders/s &times; ~5 rows (order, items, outbox) = 3,000 row writes/s fits one PostgreSQL primary; ~9 TB/year forces partitioning by month and archiving.']
  ],
  api: [
    ['GET /search?q=&facets=&cursor=', 'Full-text search with filters and facets; served by the search index; anonymous results cached at the edge for ~60 s.'],
    ['GET /products/{id}', 'Product page: catalog doc + offers + approximate availability; cacheable, price/stock badge may lag by seconds.'],
    ['PUT /cart/items/{sku}  {qty}', 'Upsert a cart line; idempotent by nature (sets quantity rather than incrementing).'],
    ['POST /checkout  (Idempotency-Key)  {cartVersion, addressId, paymentMethodId}', 'Starts the saga; returns 202 with orderId and status, or 409 if the cart changed. Retrying with the same key returns the same order.'],
    ['GET /orders/{id}', 'Order status from the order service (read your own writes: served from the primary for a few seconds after creation).'],
    ['POST /orders/{id}/cancel', 'Allowed only from states before SHIPPED; triggers refund and stock release compensations.'],
    ['Event: OrderPlaced / OrderCancelled / StockChanged (Kafka)', 'Published via the outbox; consumed by fulfilment, email, search indexer, analytics and recommendations.']
  ],
  data: [
    ['product', 'Document store (Cosmos DB / DynamoDB / MongoDB)', 'pk product_id; variants and attributes embedded; seller offers in a separate container keyed by (product_id, seller_id); change feed drives the search indexer.'],
    ['search document', 'Search engine (OpenSearch / Azure AI Search)', 'Denormalised: title, brand, category path, attributes, best price, rating, in_stock flag; sharded by doc id; facets on brand/category/price bands.'],
    ['cart', 'Key-value (DynamoDB / Redis with persistence)', 'pk user_id (or anon cart id); items map sku &rarr; qty; version for optimistic checks; TTL 30 days for guests.'],
    ['stock, reservation', 'Relational (PostgreSQL), sharded by SKU', 'stock(sku, warehouse_id, on_hand, reserved, version); reservation(id, order_id, sku, qty, expires_at, status); index on expires_at for the sweeper.'],
    ['order, order_item, outbox', 'Relational (PostgreSQL), later sharded by customer_id', 'order(id, customer_id, status, total, currency, version, created_at); outbox(id, aggregate_id, type, payload, created_at) written in the same transaction.'],
    ['events', 'Kafka / Event Hubs topics', 'orders and inventory topics keyed by order_id / sku so per-entity ordering holds; 7-day retention, compacted state topics for stock.']
  ],
  dbChoice: [
    ['Catalog', 'Document store', 'Products have wildly different attributes (a TV vs a T-shirt); read by id at huge volume; schema-flexible documents with a change feed suit this well.', 'Relational with EAV tables: painful queries and migrations at 500 M SKUs.'],
    ['Inventory and orders', 'Relational with transactions', 'Need conditional updates (reserve only if available), multi-row atomic writes (order + items + outbox) and state-machine guards. Sharded by SKU / customer when one primary is not enough.', 'Distributed SQL (Spanner, Aurora DSQL, Cosmos DB for PostgreSQL) to avoid manual sharding; DynamoDB transactions also work for single-item conditional writes.'],
    ['Search', 'Inverted-index search engine', 'Full-text relevance, typo tolerance, facets and filters over hundreds of millions of documents; rebuilt from the catalog so it is a disposable read model (CQRS).', 'Database LIKE queries: no relevance, no facets, collapses under load.'],
    ['Carts', 'Key-value store', 'Single-key access by user, tiny items, very high write rate, global replication for multi-region shoppers.', 'Session store only: carts lost on logout or device switch.']
  ],
  diagram: {
    nodes: [['u', 'Shoppers', 'client', 0, 1.4, 'web / mobile'], ['edge', 'CDN + WAF', 'edge', 1, 1.4, 'cache, bots, queue'], ['gw', 'API gateway', 'apigw', 2, 1.4, 'auth, rate limits'],
      ['cat', 'Catalog service', 'svc', 3, 0.2, 'product pages'], ['cart', 'Cart service', 'svc', 3, 1.4, 'per-user cart'], ['chk', 'Checkout saga', 'svc', 3, 2.6, 'orchestrator'],
      ['cdb', 'Catalog store', 'nosql', 4, 0, 'product documents'], ['srch', 'Search index', 'search', 5, 0.9, 'OpenSearch'],
      ['inv', 'Inventory service', 'svc', 4, 1.8, 'reserve / release'], ['idb', 'Inventory DB', 'db', 5, 1.8, 'sharded by SKU'],
      ['pay', 'Payment service', 'svc', 4, 3.4, 'PSP adapter'], ['ord', 'Order service', 'svc', 5, 2.7, 'state machine'], ['odb', 'Orders DB', 'db', 6, 2.7, 'orders + outbox'], ['bus', 'Event stream', 'stream', 6, 1.2, 'Kafka']],
    edges: [['u', 'edge'], ['edge', 'gw'], ['gw', 'cat'], ['gw', 'cart'], ['gw', 'chk'], ['cat', 'cdb'], ['cat', 'srch'], ['chk', 'cart'], ['chk', 'inv'], ['chk', 'pay'], ['chk', 'ord'],
      ['inv', 'idb'], ['ord', 'odb'], ['odb', 'bus', 'outbox relay', 'async'], ['bus', 'srch', 'reindex', 'async'], ['cdb', 'srch', 'change feed', 'async']]
  },
  flows: [
    { name: 'Search and product page', desc: 'The browse path: almost entirely served from caches and the search index, never from the transactional databases.', steps: [
      ['u', 'edge', 'GET /search?q=running shoes', 'The request reaches the nearest edge. Anonymous search pages for popular queries are cached for ~60 s, so a large share never goes further.'],
      ['edge', 'gw', 'cache miss', 'Personalised or uncommon queries pass the WAF and bot rules and go to the API gateway.'],
      ['gw', 'cat', 'route + auth', 'The gateway validates the session token, applies per-client rate limits and routes to the catalog/search service.'],
      ['cat', 'srch', 'BM25 + filters + facets', 'Scatter-gather across 20 shards; each returns its top hits and facet counts. The in_stock flag in the index hides sold-out items.'],
      ['srch', 'cat', 'top 48 ids + facets', 'Merged results in ~30 ms. The service may rerank with a learned model and inject sponsored listings.', 'resp'],
      ['cat', 'cdb', 'batch get product docs', 'Fetch the display fields (title, image keys, price) for the 48 hits in one batch read, usually from an in-process or Redis cache in front of the store.'],
      ['cat', 'u', '200 results page', 'Images load from the CDN. Price and stock here are informative only: checkout re-checks both authoritatively.', 'resp']],
      end: 'Browse is a CQRS read model: denormalised, cached and allowed to be a few seconds stale. Correctness is enforced later, at checkout.' },
    { name: 'Checkout saga (happy path)', desc: 'Placing an order: reserve, authorise, create, all idempotent and coordinated by an orchestrator.', steps: [
      ['u', 'gw', 'POST /checkout (Idem-Key K)', 'The client generates the idempotency key once per checkout attempt, so a double click or retry maps to the same saga.'],
      ['gw', 'chk', 'start saga K', 'The orchestrator inserts saga(K) with state STARTED; a unique constraint on K means a duplicate request just reads the existing saga.'],
      ['chk', 'cart', 'load cart v17 + reprice', 'Snapshot the cart at a version, recompute price, promotions and tax server-side. Never trust client prices.'],
      ['chk', 'inv', 'reserve 3 lines, TTL 15 min', 'Reservation per line keyed by (saga K, sku). Retrying the same call is a no-op.'],
      ['inv', 'idb', 'conditional UPDATE reserved', 'A conditional update increments reserved only if on_hand - reserved ≥ qty. Zero rows updated means out of stock: no oversell possible.'],
      ['chk', 'pay', 'authorise 129.90 EUR (key K)', 'Authorise (not capture) through the PSP with the same idempotency key. Capture happens at shipment.'],
      ['pay', 'chk', 'authorised', 'Payment is the pivot step: once it succeeds the saga only moves forward.', 'resp'],
      ['chk', 'ord', 'create order CONFIRMED', 'The order service writes order, items and an OrderPlaced outbox row in one local transaction.'],
      ['odb', 'bus', 'relay OrderPlaced', 'An outbox relay (or CDC such as Debezium) publishes the event; fulfilment, email, analytics and recommendations consume it.', 'async'],
      ['chk', 'u', '201 order #A123', 'The shopper sees a confirmation in ~1 s. Everything else (email, warehouse pick) is asynchronous.', 'resp']],
      end: 'No distributed transaction: each service commits locally, the orchestrator records progress, and the outbox guarantees the event is published if and only if the order exists.' },
    { name: 'Payment declined (compensation)', desc: 'A step after the reservation fails, so earlier steps must be undone in reverse order.', steps: [
      ['gw', 'chk', 'start saga K2', 'A new checkout begins as before.'],
      ['chk', 'inv', 'reserve 1 line', 'Stock for the item is reserved successfully.'],
      ['inv', 'idb', 'reserved += 1', 'The unit is now held for this saga and no longer available to others.'],
      ['chk', 'pay', 'authorise', 'The PSP is asked to authorise the card.'],
      ['pay', 'chk', 'declined (insufficient funds)', 'A hard decline. A timeout would be different: the saga would first query the PSP by idempotency key before deciding.', 'err'],
      ['chk', 'inv', 'compensate: release K2', 'The compensating action releases the reservation. It is idempotent, so a retry after a crash is harmless.'],
      ['inv', 'idb', 'reserved -= 1', 'The unit becomes available again immediately instead of waiting for the 15-minute TTL.'],
      ['chk', 'u', '402 payment failed', 'The shopper can pick another payment method; a new attempt reuses the cart but gets a new saga.', 'err']],
      end: 'Every forward step has a compensating step, and the TTL on reservations is the safety net if the orchestrator itself dies before compensating.' },
    { name: 'Flash sale on one SKU', desc: '1 M people want 10,000 units of one deal in the first minutes. The goal is fairness and no meltdown.', steps: [
      ['u', 'edge', 'join waiting room', 'The edge holds excess users in a virtual queue page and admits them at a controlled rate (e.g. 2,000/s), handing each a signed admission token.'],
      ['edge', 'gw', 'admitted (token)', 'Only token holders reach the API; bots without tokens are dropped at the edge.'],
      ['gw', 'chk', 'checkout (rate limited)', 'Per-user and per-SKU limits (one unit per customer) are enforced before any database work.'],
      ['chk', 'inv', 'reserve hot SKU', 'The inventory service knows this SKU is hot and has split its stock into 50 buckets of 200 units each.'],
      ['inv', 'idb', 'decrement random bucket', 'Each request picks a random non-empty bucket row, so 50 rows absorb the contention instead of one. Throughput rises ~50×.'],
      ['inv', 'chk', 'sold out', 'When all buckets are empty the service flips a sold-out flag in cache, and the edge stops admitting users for this deal.', 'err'],
      ['chk', 'u', 'sold out page', 'Fast, honest failure is far better than timeouts. Unpaid reservations expire after the TTL and their units return to the pool.', 'resp']],
      end: 'Shape demand at the edge, reject early with cheap checks, and spread a hot row over many rows. The ticket booking design covers seat-level contention.' }
  ],
  components: [
    ['CDN + WAF + waiting room', 'Cache static assets and anonymous pages, block bots, queue users during flash sales.'],
    ['API gateway', 'Authentication, per-client rate limits, routing to domain services (backends for frontends per web/mobile).'],
    ['Catalog service + store', 'Product documents, seller offers, prices; source of truth for what is sold.'],
    ['Search indexer + index', 'Consumes catalog change feed and stock events; maintains the denormalised search documents.'],
    ['Cart service', 'Per-user carts, merge on login, price preview.'],
    ['Checkout orchestrator', 'Runs the saga, records progress durably, retries and compensates; implemented on a workflow engine (Temporal, Step Functions, Durable Functions) or a saga table.'],
    ['Inventory service', 'Available-to-promise per SKU and warehouse, reservations with TTL, hot-SKU buckets, reservation sweeper.'],
    ['Payment service', 'Wraps PSPs: authorise, capture, refund with idempotency keys (see payment design).'],
    ['Order service', 'Order state machine, history, cancellations and returns; publishes events via the outbox.'],
    ['Event stream + consumers', 'Fulfilment, notifications, analytics, search updates and recommendation features all react to order and stock events.']
  ],
  evolutionTitle: 'From one store to a marketplace',
  evolution: [
    { name: '1. Monolith', desc: 'One application and one relational database. Checkout is a single ACID transaction: decrement stock, insert order, call the PSP.', diagram: { nodes: [['u', 'Shoppers', 'client', 0, 0], ['app', 'Store app', 'svc', 1.5, 0, 'monolith'], ['db', 'PostgreSQL', 'db', 3, 0, 'everything'], ['psp', 'PSP', 'ext', 3, 1]], edges: [['u', 'app'], ['app', 'db'], ['app', 'psp']] },
      steps: [['u', 'app', 'checkout', 'One process handles the whole request.'], ['app', 'db', 'UPDATE stock; INSERT order', 'Local transaction: simple and correct.'], ['app', 'psp', 'charge', 'Calling the PSP inside the transaction holds row locks for seconds: this is what breaks first under load.'], ['app', 'u', 'confirmed', 'Works well up to thousands of orders a day.', 'resp']] },
    { name: '2. Read path split', desc: 'Browsing dominates: add a search engine and caches as read models fed from the database.', diagram: { nodes: [['u', 'Shoppers', 'client', 0, 0.6], ['cdn', 'CDN', 'cdn', 1, 0], ['app', 'Store app', 'svc', 1, 1.2], ['db', 'PostgreSQL', 'db', 2.5, 1.2], ['s', 'Search index', 'search', 2.5, 0], ['c', 'Redis', 'cache', 2.5, 2.3]], edges: [['u', 'cdn'], ['u', 'app'], ['app', 's'], ['app', 'db'], ['app', 'c'], ['db', 's', 'CDC', 'async']] },
      steps: [['u', 'cdn', 'images, pages', 'Static and anonymous content from the edge.'], ['app', 's', 'search', 'Search moves off the database.'], ['db', 's', 'change data capture', 'The index follows the database asynchronously.', 'async'], ['app', 'c', 'hot products', 'Product pages from cache.']] },
    { name: '3. Domain services + saga', desc: 'Separate teams own catalog, inventory, orders and payments. Checkout becomes a saga with an outbox.', diagram: { nodes: [['g', 'Gateway', 'apigw', 0, 1], ['chk', 'Checkout saga', 'svc', 1, 1], ['inv', 'Inventory', 'svc', 2, 0], ['pay', 'Payments', 'svc', 2, 1], ['ord', 'Orders', 'svc', 2, 2], ['bus', 'Kafka', 'stream', 3.5, 2]], edges: [['g', 'chk'], ['chk', 'inv'], ['chk', 'pay'], ['chk', 'ord'], ['ord', 'bus', 'outbox', 'async']] },
      steps: [['g', 'chk', 'checkout', 'The orchestrator owns the workflow.'], ['chk', 'inv', 'reserve', 'Each service has its own database.'], ['chk', 'pay', 'authorise', 'External call outside any lock.'], ['chk', 'ord', 'create', 'Local transaction with outbox row.'], ['ord', 'bus', 'OrderPlaced', 'Everyone else subscribes.', 'async']] }
  ],
  deep: [
    ['The checkout saga', '<p>A saga is a sequence of local transactions where each step has a <strong>compensating</strong> step. Orchestration (one coordinator) is easier to reason about for checkout than choreography (services reacting to each other’s events), because the flow has a clear owner, timeouts and a visible state.</p><div class="table-wrap"><table><tr><th>Step</th><th>Forward</th><th>Compensation</th></tr><tr><td>1</td><td>Reserve stock (TTL 15 min)</td><td>Release reservation</td></tr><tr><td>2</td><td>Authorise payment</td><td>Void authorisation</td></tr><tr><td>3 (pivot)</td><td>Create order CONFIRMED</td><td>Cancel order + refund (rare)</td></tr><tr><td>4</td><td>Commit reservation &rarr; allocated</td><td>Retry until success (no compensation)</td></tr></table></div><ul><li><strong>Idempotent steps:</strong> every call carries (sagaId, step) so retries after crashes are harmless.</li><li><strong>Durable progress:</strong> the orchestrator persists state after each step (workflow engines such as Temporal or Step Functions do this for you).</li><li><strong>Ambiguous outcomes:</strong> a PSP timeout is not a failure; query by idempotency key, then decide.</li><li><strong>Order the steps</strong> so the cheapest-to-undo comes first and the hardest-to-undo (payment capture) comes last.</li></ul>'],
    ['Inventory consistency and oversell prevention', '<p>Stock is tracked as <code>on_hand</code> and <code>reserved</code>; available-to-promise is <code>on_hand - reserved</code>. The reservation is a single conditional statement, so the database enforces the invariant without application locks:</p><pre><code>UPDATE stock\n   SET reserved = reserved + :qty, version = version + 1\n WHERE sku = :sku AND warehouse_id = :wh\n   AND on_hand - reserved &gt;= :qty;\n-- 1 row  =&gt; reserved;  0 rows =&gt; out of stock</code></pre><ul><li><strong>Reservations expire:</strong> a sweeper releases rows past <code>expires_at</code> so abandoned checkouts do not lock stock forever.</li><li><strong>Hot SKUs:</strong> one row serialises updates (a few hundred to ~1,000/s). Split stock into N bucket rows and decrement a random one; rebalance buckets in the background.</li><li><strong>Display vs truth:</strong> product pages show cached availability (may lag); only the reservation decides.</li><li><strong>Marketplace sellers</strong> with their own stock systems sync via feeds; keep a safety buffer to absorb sync lag rather than oversell.</li></ul>'],
    ['Order state machine and the outbox', '<p>Orders move through explicit states, and every transition is a guarded update so concurrent actors (customer cancel vs warehouse ship) cannot both win:</p><p><code>PENDING &rarr; CONFIRMED &rarr; PICKING &rarr; SHIPPED &rarr; DELIVERED</code>, with <code>CANCELLED</code> allowed only before SHIPPED and <code>RETURN_REQUESTED &rarr; REFUNDED</code> after delivery.</p><pre><code>BEGIN;\nUPDATE orders SET status = &#39;CANCELLED&#39;, version = version + 1\n WHERE id = :id AND status IN (&#39;PENDING&#39;,&#39;CONFIRMED&#39;) AND version = :v;\nINSERT INTO outbox(aggregate_id, type, payload) VALUES (:id, &#39;OrderCancelled&#39;, :json);\nCOMMIT;</code></pre><p>A relay reads the outbox (polling or CDC) and publishes to Kafka, at least once. Consumers dedupe by event id. This removes the dual-write bug where the database commits but the message is lost (or vice versa).</p>'],
    ['Flash sales', '<ul><li><strong>Virtual waiting room</strong> at the edge admits users at the rate the back end can serve and gives a fair first-come order.</li><li><strong>Pre-warm</strong>: scale pods, caches and search replicas before the announced start; product pages for the deal are pre-rendered at the CDN.</li><li><strong>Cheap rejections first</strong>: purchase limits, bot scores and a cached sold-out flag stop requests before they touch the inventory database.</li><li><strong>Bucketed stock</strong> for the hot SKU, or move its counter to Redis (<code>DECRBY</code> with a Lua guard) and reconcile to the database asynchronously.</li><li><strong>Short holds</strong> (5 minutes rather than 15) so unpaid units return quickly.</li><li><strong>Isolation</strong>: run the deal through a dedicated cell or queue so the rest of the store is unaffected (bulkhead).</li></ul>'],
    ['Catalog, search indexing and the recommendations hook', '<p>The catalog store’s change feed and the stock events feed an indexer that builds denormalised search documents (title, attributes, best offer price, in_stock, rating). Price and stock changes use partial updates so the index stays within ~1 minute of truth; full reindexes build a new index and swap an alias with zero downtime.</p><p>Recommendations plug in through the same events: OrderPlaced, product views and add-to-cart events stream into a feature store and a candidate-generation job (co-purchase, embeddings). The product page calls a recommendation service with a tight timeout (~50 ms) and simply hides the carousel if it is slow: recommendations must never block a sale.</p>']
  ],
  scale: [
    '<strong>Reads:</strong> CDN and edge caching for anonymous pages, Redis in front of the catalog store, and search replicas per zone. Most of the 90,000 reads/s never touch a database.',
    '<strong>Hot SKUs:</strong> bucket the stock row, cache the sold-out flag, and route deal traffic through a waiting room.',
    '<strong>Orders database:</strong> partition by month for archiving; shard by customer_id when a single primary passes ~70% write capacity, so a customer’s order history stays on one shard.',
    '<strong>Search freshness vs cost:</strong> partial updates for price/stock, bulk indexing for new listings, and a separate small "fresh" index merged at query time for products created in the last hour.',
    '<strong>Multi-region:</strong> browse is active-active everywhere; carts replicate globally; inventory and orders stay home-region per marketplace (EU, US) to keep reservations strongly consistent.',
    '<strong>Cells:</strong> at very large scale, split checkout into cells by customer hash so one bad deployment or noisy deal affects a fraction of shoppers.'
  ],
  tradeoffs: [
    ['Reserve stock at cart or at checkout', 'Add-to-cart reservation vs checkout reservation', 'Checkout: reserving at add-to-cart locks stock in millions of abandoned carts. Reserve when the shopper commits, with a short TTL.'],
    ['Saga style', 'Orchestration vs choreography', 'Orchestration for checkout (clear owner, visible state, easy timeouts); choreography for downstream reactions such as email and analytics.'],
    ['Payment timing', 'Capture at order vs authorise now, capture at shipment', 'Authorise at order, capture at shipment: no money taken for items that cannot ship, and voids are cheaper than refunds.'],
    ['Inventory store', 'Relational conditional updates vs Redis counters', 'Relational for durability and audit; Redis only for the few hottest SKUs during flash sales, reconciled back to the database.'],
    ['Search freshness', 'Synchronous index writes vs async indexing', 'Async via events: checkout correctness never depends on the index, so it can lag by seconds.'],
    ['Oversell policy', 'Strict never-oversell vs allow small oversell and apologise', 'Strict for own stock; for third-party seller feeds a small buffer plus "cancel and compensate" is often the pragmatic business choice.']
  ],
  failures: [
    ['Payment service times out mid-saga', 'Do not assume failure: query the PSP by idempotency key, retry with backoff; reservation TTL bounds how long stock is held.'],
    ['Orchestrator crashes between steps', 'Saga state is persisted after each step; a new instance resumes from the last recorded step; all steps idempotent.'],
    ['Outbox relay or Kafka is down', 'Orders still commit (the outbox is in the same DB); events are published when the relay recovers; consumers dedupe.'],
    ['Search cluster degraded', 'Serve cached results and category pages; fall back to fewer replicas with reduced facets; checkout unaffected.'],
    ['Hot SKU overloads inventory shard', 'Bucketed stock, per-SKU rate limits, waiting room, cached sold-out flag; bulkhead the shard so other SKUs continue.'],
    ['Recommendation service slow', '50 ms timeout and circuit breaker; render the page without the carousel.'],
    ['Region outage', 'Browse fails over via global load balancing; checkout fails over to the standby region with replicated orders/inventory (RPO seconds), with a brief read-only window.']
  ],
  cloud: [['DNS', 'dns'], ['CDN, edge cache and waiting room', 'cdn'], ['WAF and bot protection', 'waf'], ['API gateway', 'apigw'], ['Microservices', 'k8s'], ['Catalog and cart store', 'nosql'], ['Product search', 'search'], ['Cache', 'cache'], ['Inventory and orders DB', 'sql'], ['Scale-out relational option', 'distsql'], ['Order and stock events', 'stream'], ['Saga orchestration', 'workflow'], ['Work queues', 'queue'], ['Product images', 'blob'], ['Recommendations', 'recsvc'], ['Customer identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-saga', 'azp-compensating-transaction', 'azOutbox', 'azAksMicro', 'azp-cqrs', 'azp-queue-based-load-leveling', 'azEventDriven', 'azp-backends-for-frontends'],
          aws: ['awsSagaOrch', 'awsSaga', 'awsOutbox', 'awsMicro', 'awsDdbBest', 'blShedding', 'awsCircuit', 'awsPubSub'] },
  questions: [
    ['How do you guarantee no overselling with many concurrent buyers?', 'Make the database enforce the invariant: a conditional UPDATE that increments reserved only if on_hand - reserved &ge; qty. Zero rows affected means out of stock. No read-then-write in the application, no distributed lock. For hot SKUs split stock into bucket rows to spread contention.'],
    ['Why not a distributed transaction (2PC) across inventory, payment and orders?', 'The PSP is an external system that does not participate in 2PC, locks would be held across network calls for seconds, and the coordinator becomes a single point of failure. A saga with idempotent steps and compensations gives the same business outcome with local transactions.'],
    ['What happens if the user double-clicks "Place order"?', 'Both requests carry the same idempotency key. The orchestrator has a unique constraint on the key, so the second request reads the existing saga and returns the same order. The PSP receives the same idempotency key too, so it never charges twice.'],
    ['How does search stay consistent with price changes?', 'It is eventually consistent by design: catalog changes flow through the change feed to the indexer within seconds to a minute. Checkout always reprices from the catalog, so a stale search price cannot be exploited; if the price rose, the shopper is shown the new price before paying.'],
    ['How would you handle a 10&times; spike on Black Friday?', 'Pre-scale (it is predictable), cache aggressively at the edge, use a waiting room for doorbuster deals, shed non-critical features (recommendations, reviews) under load, keep checkout on dedicated capacity, and run load tests at 2&times; the expected peak beforehand.'],
    ['How do you split carts and orders across regions?', 'Carts are low-risk and replicate globally (last-writer-wins per line is acceptable). Inventory and orders are tied to the fulfilment region so reservations are strongly consistent within one region; cross-region failover is active-passive.']
  ],
  related: ['payment', 'ticket-booking', 'search-engine', 'recommendation', 'notification']
});

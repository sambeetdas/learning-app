SD.renderCase({
  slug: 'proximity',
  summary: 'A proximity service answers "what is near me?": restaurants within 1 km, petrol stations along the way, the 20 best-rated cafés nearby. Databases cannot index two-dimensional distance efficiently with ordinary B-trees, so the design maps the plane onto one-dimensional cell ids (geohash strings, quadtree nodes, or S2 / H3 cells) that can be indexed, cached and sharded. A query converts the user’s position and radius into a small set of covering cells (the user’s cell plus its neighbours, or a region covering), fetches the businesses in those cells, computes exact distances, filters and ranks by a blend of distance and quality. The workload is extremely read-heavy (about a thousand reads per write) and the whole geo index fits in memory, so the system is built from replicated in-memory indexes, read replicas and caches, with business updates flowing in asynchronously through change data capture.',
  examples: 'Yelp, Google Maps "nearby", Apple Maps, Foursquare, Tripadvisor, Uber Eats / DoorDash restaurant lists, store locators; Google uses S2 cells, Uber H3, and Redis GEO and Elasticsearch geo_point both use geohash-style encodings.',
  functional: ['Search businesses near a location within a radius (0.5, 1, 2, 5, 20 km), optionally filtered by category, open now, price, rating.', 'Results ranked by a mix of distance, rating and popularity, with pagination.', 'View business details (address, hours, photos, reviews).', 'Business owners add or update listings; users add reviews and ratings.', 'Text queries combined with location ("vegan ramen near me").'],
  nonFunctional: ['Search latency p99 under 200 ms server side.', 'Read-heavy: ~17 k searches/s peak versus tens of writes/s.', 'New or changed businesses may take minutes to appear (not real time).', 'Highly available (99.99%) in every region; results correct at boundaries (no missing businesses next to a cell edge).', 'Scales to 200 M places worldwide.'],
  outOfScope: ['Moving objects such as drivers (see ride-hailing).', 'Map rendering, routing and navigation (see maps).', 'Review moderation and fraud detection internals.', 'Ads and sponsored listings.'],
  estimates: [
    ['Businesses / places', '200 M', 'Global points of interest'],
    ['Daily active users', '100 M', 'Consumer app + web'],
    ['Searches', '500 M/day &rArr; ~5.8 k/s average, ~17 k/s peak', '100 M &times; 5 searches; meal-time peaks 3&times;'],
    ['Detail page views', '1 B/day &rArr; ~12 k/s average, ~35 k/s peak', '~2 detail views per search'],
    ['Writes', '~3 M/day &rArr; ~35/s', '2 M business updates + 1 M reviews: read : write &asymp; 1,000 : 1'],
    ['Business data', '~400 GB', '200 M &times; ~2 KB (name, address, lat/lng, categories, hours, attributes, rating); photos live in object storage'],
    ['Geo index', '~16 GB', '200 M &times; ~80 B (id + cell/score + structure overhead): fits in RAM on one node, so replicate it rather than shard it'],
    ['Response bandwidth', '~1.4 Gbit/s peak', '17 k/s &times; 20 results &times; ~500 B (photos via CDN)']
  ],
  compute: [
    ['Nearby search service (LBS)', '~14 instances &times; 16 vCPU across 3 zones', '17 k req/s &times; ~5 ms CPU (cells, candidate merge, distance, filter, rank) = 85 busy cores; at 60% &asymp; 142 cores &asymp; 9 instances; &times;1.5 to survive a zone loss.'],
    ['Geo index (Redis)', '1 primary + 9 read replicas per region (32 GB nodes)', 'Each search reads ~9 cells &rArr; ~150 k cell reads/s at peak; a replica comfortably serves ~50 k such reads/s, so 4 would do. 3 per zone adds zone tolerance; every replica holds the full 16 GB index.'],
    ['Business cache', '4 shards &times; 25 GB + replicas', 'Hot set ~20% of 400 GB = 80 GB of summaries. 17 k searches &times; ~40 hydrated candidates in MGET batches + 35 k detail views/s; ~95% hit rate.'],
    ['Business database', '1 primary + 3-5 read replicas (PostgreSQL + PostGIS)', 'Writes ~35/s are trivial; replicas absorb cache misses (~5% of ~700 k item reads/s, mostly batched) and detail pages.'],
    ['Search engine (text + geo)', '~9 data nodes (10 primary shards &times; 2 replicas)', '~30% of searches have text: ~5 k/s. 200 M docs &times; ~2 KB = 400 GB of index, ~40 GB per shard.']
  ],
  api: [
    ['GET /v1/search/nearby?lat=&lng=&radius=1000&category=&open_now=&cursor=&limit=20', 'Returns ranked businesses with distance. The cursor encodes the query hash and offset; results of popular queries are cached.'],
    ['GET /v1/search?q=vegan+ramen&lat=&lng=&radius=', 'Text plus location: routed to the search engine with a geo_distance filter.'],
    ['GET /v1/businesses/{id}', 'Business details for the detail page; cache-aside with a TTL.'],
    ['POST /v1/businesses | PATCH /v1/businesses/{id}', 'Owner/admin create and update (address, coordinates, hours). Writes to the primary; indexes update asynchronously.'],
    ['POST /v1/businesses/{id}/reviews {rating, text}', 'New review; rating aggregates are recomputed asynchronously.'],
    ['Event business.changed (CDC from the database)', 'Consumed by the index builder to update the geo index, search index and caches.']
  ],
  data: [
    ['businesses', 'PostgreSQL (+ PostGIS) primary + read replicas', 'business_id, name, lat, lng, geohash (indexed), categories, hours, price, rating_avg, review_count, status. PostGIS geography column for admin queries.'],
    ['geo index', 'Redis sets geo:{geohash6}:{category} (or one Redis GEO sorted set per region)', 'Members are business ids. Small enough to hold fully on every replica; rebuilt from the database if lost.'],
    ['business summaries', 'Redis / Memcached business:{id}', 'Fields needed for ranking and result cards: lat, lng, name, rating, review_count, price, open hours, thumbnail URL.'],
    ['search index', 'Elasticsearch / OpenSearch', 'Text fields, categories, attributes, geo_point location; BKD-tree geo indexing; function_score for distance decay.'],
    ['reviews', 'Sharded SQL or wide-column, partition business_id', 'review_id, user_id, rating, text, created_at; aggregates written back to businesses.'],
    ['result cache', 'Redis q:{geohash6}:{radius}:{filters}', 'Ranked id list for 60-300 s; keyed by cell, not exact coordinates, so nearby users share entries.']
  ],
  dbChoice: [
    ['Source of truth for businesses', 'Relational (PostgreSQL with PostGIS)', 'Modest size, rich attributes, transactional updates, and PostGIS for ad-hoc geo queries and validation.', 'Document store if attributes vary a lot per country/category; either way it is not on the hot read path.'],
    ['Geo lookups on the hot path', 'In-memory geo index (Redis sets per cell or Redis GEO), fully replicated', 'The index is ~16 GB, read ~150 k times a second, and written rarely: perfect for full replicas close to the search service.', 'SQL with an indexed geohash column and prefix queries (WHERE geohash LIKE \'wydm9%\') works at smaller scale; an in-process quadtree is fastest but slow to rebuild and update.'],
    ['Text + geo search', 'Elasticsearch / OpenSearch', 'Combines relevance scoring, filters, facets and geo_distance in one query.', 'Doing text filtering in the LBS over geo candidates breaks down when candidate sets are large.'],
    ['Reviews', 'Sharded SQL / wide-column', 'Write-once, read by business id with pagination.', 'Storing them in the business row bloats it and the cache.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'mobile', 0, 1.2, 'app / web'], ['cdn', 'CDN', 'cdn', 1, 0, 'photos, static'], ['blob', 'Photo storage', 'blob', 2, 0, 'object storage'],
      ['gw', 'API gateway', 'apigw', 1, 1.6, 'auth, rate limits'], ['lbs', 'Nearby search', 'svc', 2, 0.8, 'LBS, stateless'], ['biz', 'Business service', 'svc', 2, 2.6, 'CRUD, reviews'],
      ['qcache', 'Result cache', 'cache', 3, 0, 'cell + filters'], ['geo', 'Geo index', 'cache', 4, 0.6, 'Redis replicas'], ['search', 'Search engine', 'search', 3, 1.7, 'text + geo_distance'],
      ['bcache', 'Business cache', 'cache', 6, 1.5, 'summaries'], ['db', 'Business DB', 'db', 3, 2.9, 'primary + replicas'], ['cdc', 'Change stream', 'stream', 4, 3.4, 'CDC events'],
      ['idx', 'Index builder', 'worker', 5, 2.6, 'geo + search + cache']],
    edges: [['u', 'gw'], ['u', 'cdn'], ['cdn', 'blob'], ['gw', 'lbs'], ['gw', 'biz'], ['lbs', 'qcache'], ['lbs', 'geo'], ['lbs', 'search'], ['lbs', 'bcache'], ['biz', 'db'],
      ['db', 'cdc', 'CDC', 'async'], ['cdc', 'idx', '', 'async'], ['idx', 'geo'], ['idx', 'search'], ['idx', 'bcache', 'invalidate']]
  },
  flows: [
    { name: 'Nearby search', desc: 'Ramen restaurants within 1 km of a user in central Tokyo, result cache miss.', steps: [
      ['u', 'gw', 'GET /nearby?r=1km&cat=ramen', 'The app sends its GPS position, radius and category.'],
      ['gw', 'lbs', 'route', 'Any stateless search instance in the nearest region.'],
      ['lbs', 'qcache', 'GET q:xn76u:1km:ramen', 'The key uses the user’s geohash cell, not raw coordinates, so everyone in the same cell shares one cached answer.'],
      ['qcache', 'lbs', 'miss', 'Nothing cached for this cell and filter yet.', 'err'],
      ['lbs', 'geo', 'SUNION 9 cells (precision 5)', 'For a 1 km radius pick the precision whose cells are at least as large as the radius (precision 5, ~4.9 km), then read the user’s cell and its 8 neighbours. The neighbours matter: the user may be standing next to a cell edge.'],
      ['geo', 'lbs', '~600 candidate ids', 'Every ramen shop in the 3 × 3 block of cells.', 'resp'],
      ['lbs', 'bcache', 'MGET summaries', 'Fetch coordinates, rating, hours and price for the candidates in one batched call.'],
      ['bcache', 'lbs', 'summaries', 'The LBS computes exact haversine distances, drops candidates outside 1 km (the corners of the block), applies open-now, and scores by distance and rating.', 'resp'],
      ['lbs', 'qcache', 'SET ranked ids, TTL 120 s', 'Cache the ranked id list so the next users in this cell get an instant answer.'],
      ['lbs', 'u', 'top 20 + cursor', 'Result cards with distance; photos load from the CDN.', 'resp']],
      end: 'Cells turn a 2-D range query into a handful of key lookups; exact distance is computed only for a few hundred candidates.' },
    { name: 'Sparse area: expand the radius', desc: 'A user in the countryside searches for petrol stations within 500 m.', steps: [
      ['u', 'gw', 'GET /nearby?r=500m&cat=fuel', 'Small default radius.'],
      ['gw', 'lbs', 'route', 'Search service.'],
      ['lbs', 'geo', '9 cells (precision 6)', 'Precision 6 cells (~1.2 × 0.6 km) cover a 500 m radius with the 8 neighbours.'],
      ['geo', 'lbs', '0 results', 'Nothing nearby: a fixed small radius would return an empty page.', 'err'],
      ['lbs', 'geo', 'expand: precision 5 cells', 'Drop one geohash character (cells 32× larger, ~5 km) and query again; quadtrees and S2 coverings expand the same way by moving up a level.'],
      ['geo', 'lbs', '3 results', 'Still few, but enough to show.', 'resp'],
      ['lbs', 'bcache', 'MGET summaries', 'Hydrate and compute distances (2.8 km, 4.1 km, 6.5 km).'],
      ['lbs', 'u', '3 results, radius 7 km', 'The response states the effective radius so the app can say "nothing within 500 m, showing the nearest".', 'resp']],
      end: 'Expanding by cell level adapts to density: tiny cells in Tokyo, big ones in rural areas.' },
    { name: 'Text query with location', desc: '"vegan ramen open now" near the user.', steps: [
      ['u', 'gw', 'GET /search?q=vegan ramen', 'Free text plus position.'],
      ['gw', 'lbs', 'route', 'The LBS detects a text query.'],
      ['lbs', 'search', 'match + geo_distance 2 km', 'One bool query: full-text match on name, menu and tags; filters for open now and geo_distance; function_score with a Gaussian decay on distance multiplied by a rating factor.'],
      ['search', 'lbs', 'top 50 ids + scores', 'The engine’s BKD-tree geo index prunes by location before scoring text, so this stays fast.', 'resp'],
      ['lbs', 'bcache', 'MGET summaries', 'Fresh rating and hours from the cache (the search index can lag slightly).'],
      ['lbs', 'u', 'ranked results', 'Final order after business rules (closed places removed, diversity).', 'resp']],
      end: 'Pure geo queries use the cheap cell index; text queries go to a search engine that can combine relevance and distance.' },
    { name: 'Business update', desc: 'A restaurant moves 300 m down the road and changes its hours.', steps: [
      ['u', 'gw', 'PATCH /businesses/42', 'The owner updates the address in the business portal.'],
      ['gw', 'biz', 'validate', 'Geocode the new address and check the coordinates are plausible.'],
      ['biz', 'db', 'UPDATE businesses', 'Write to the primary with a new geohash; the owner’s next read goes to the primary (read-your-writes).'],
      ['db', 'cdc', 'business.changed', 'Change data capture streams the row change; no dual writes in application code.', 'async'],
      ['cdc', 'idx', 'consume', 'The index builder processes changes in order per business id.', 'async'],
      ['idx', 'geo', 'SREM old cell, SADD new', 'Move the id between cell sets on the primary; replicas follow within milliseconds.'],
      ['idx', 'search', 'reindex document', 'Update location and hours in the search engine.'],
      ['idx', 'bcache', 'DEL business:42', 'Invalidate the summary; cached result lists expire within their TTL (minutes), which the requirements allow.']],
      end: 'Writes are rare, so the system trades a few minutes of staleness for very cheap reads.' },
    { name: 'Geo index replica fails', desc: 'One Redis replica in zone B crashes at lunchtime.', steps: [
      ['lbs', 'geo', 'SUNION ... timeout', 'Requests to the failed replica time out after 20 ms.', 'err'],
      ['lbs', 'geo', 'retry on another replica', 'The client library marks the node unhealthy and retries on a replica in another zone; every replica holds the full index.'],
      ['geo', 'lbs', 'candidates', 'Users see a few milliseconds more latency at most.', 'resp'],
      ['idx', 'geo', 'new replica: full sync', 'A replacement replica syncs the 16 GB data set from the primary in a few minutes and then joins the pool.'],
      ['lbs', 'search', 'fallback if all fail', 'If the geo index were completely unavailable, the LBS could serve pure geo queries from the search engine’s geo_distance filter at higher cost.']],
      end: 'A small, fully replicated index makes node failures invisible; a second path through the search engine covers the worst case.' }
  ],
  components: [
    ['Nearby search service (LBS)', 'Stateless: picks cell precision, reads covering cells, hydrates, computes distance, filters, ranks, paginates, caches.'],
    ['Geo index', 'Cell id &rarr; business ids, fully replicated in memory per region.'],
    ['Search engine', 'Text, facets and geo_distance for keyword queries.'],
    ['Business service + DB', 'Source of truth for listings and reviews; owner and admin APIs.'],
    ['Change stream + index builder', 'CDC events update the geo index, search index and caches asynchronously.'],
    ['Caches + CDN', 'Business summaries, ranked results per cell, photos at the edge.']
  ],
  deep: [
    ['Geohash: precision table and neighbours', '<p>Geohash interleaves the bits of longitude and latitude and encodes them in base-32; each extra character divides a cell into 32. Points sharing a prefix are in the same cell, so a prefix is an indexable key.</p><table><tr><th>Length</th><th>Cell size (at the equator)</th><th>Search radius it covers with neighbours</th></tr><tr><td>4</td><td>39.1 km &times; 19.5 km</td><td>5-20 km</td></tr><tr><td>5</td><td>4.9 km &times; 4.9 km</td><td>1-2 km</td></tr><tr><td>6</td><td>1.2 km &times; 0.61 km</td><td>~0.5 km</td></tr><tr><td>7</td><td>153 m &times; 153 m</td><td>~100 m</td></tr><tr><td>8</td><td>38 m &times; 19 m</td><td>~20 m</td></tr></table><p><strong>Boundary problem:</strong> two points a metre apart can be in different cells with no common prefix (for example on either side of the equator or the prime meridian), and a user near a cell edge has close neighbours in the next cell. The fix is always to query the cell plus its 8 neighbours (computable from the bits). Cells also shrink in width towards the poles, which is acceptable for most populated areas.</p>'],
    ['Quadtree', '<p>A quadtree recursively splits a square into four children until each leaf holds at most N businesses (for example 100). Dense areas get deep, small leaves; empty areas stay as large leaves, so it adapts to density naturally and supports "k nearest" by walking neighbouring leaves until k are found.</p><ul><li><strong>Memory:</strong> 200 M businesses / 100 per leaf = 2 M leaves, ~2.7 M nodes in total; ids take 1.6 GB plus node overhead, so a few GB per server.</li><li><strong>Build:</strong> minutes at start-up from a snapshot; deploy with blue/green so a server never serves while building.</li><li><strong>Updates:</strong> inserting and rebalancing in a live in-memory tree needs locking; many systems rebuild nightly and apply small changes incrementally.</li></ul><p>Good fit when the index lives inside the search servers (no network hop); less convenient as a shared store.</p>'],
    ['S2 and H3 cells', '<p><strong>S2</strong> (Google) projects the sphere onto the six faces of a cube and orders cells along a Hilbert curve, so nearby cells usually have nearby 64-bit ids and a region becomes a few id ranges. Levels 0-30; each level divides area by 4.</p><table><tr><th>S2 level</th><th>Avg area</th><th>Approx. edge</th></tr><tr><td>10</td><td>~81 km&sup2;</td><td>~9 km</td></tr><tr><td>12</td><td>~5 km&sup2;</td><td>~2.2 km</td></tr><tr><td>14</td><td>~0.32 km&sup2;</td><td>~560 m</td></tr><tr><td>16</td><td>~0.02 km&sup2;</td><td>~140 m</td></tr></table><p>A <code>RegionCoverer</code> approximates a circle with a small number (say 8-20) of cells of mixed levels, which gives tighter coverage than 9 equal geohash cells. <strong>H3</strong> (Uber) uses hexagons (res 7 ~5.2 km&sup2;, res 8 ~0.74 km&sup2;, res 9 ~0.11 km&sup2;); all six neighbours are equidistant, which suits ring searches and aggregations such as heat maps, but hexagons do not nest exactly, so parent/child containment is approximate.</p>'],
    ['Choosing an index', '<table><tr><th></th><th>Geohash</th><th>Quadtree</th><th>S2 / H3</th></tr><tr><td>Key</td><td>String prefix</td><td>Tree node</td><td>64-bit cell id</td></tr><tr><td>Storage</td><td>Any KV / SQL index / Redis GEO</td><td>In-process memory</td><td>Any KV, ranges (S2)</td></tr><tr><td>Density adaptive</td><td>No (fixed precision)</td><td>Yes</td><td>Yes via mixed-level coverings (S2)</td></tr><tr><td>Neighbours</td><td>8, edge cases</td><td>Tree walk</td><td>Clean (H3: 6 equidistant)</td></tr><tr><td>Updates</td><td>Trivial</td><td>Harder</td><td>Trivial</td></tr></table><p>For a business directory: geohash in Redis or SQL is the simplest correct answer; S2 coverings give tighter candidate sets; a quadtree is a great in-memory option if you control the search servers.</p>'],
    ['Ranking and caching', '<p>Ranking blends distance with quality: <code>score = w1 &times; decay(distance) + w2 &times; bayes_rating + w3 &times; log(1 + review_count) + boosts</code> (open now, personal preferences). A <strong>Bayesian average</strong> avoids a single 5-star review beating 2,000 reviews at 4.6: <code>bayes = (C &times; m + sum_ratings) / (C + n)</code>, with m the global mean and C a prior weight (for example 20).</p><p>Caching works because the data barely changes: summaries cache for hours, ranked result lists are cached per (cell, radius, filters) for a couple of minutes, and the geo index is fully replicated in every region. Read replicas of the database are only needed for misses and detail pages.</p>']
  ],
  scale: [
    '<strong>Read throughput:</strong> add stateless LBS instances and geo index replicas; the index is small enough to replicate to every zone and region instead of sharding.',
    '<strong>Dense cities:</strong> thousands of candidates in a 3 &times; 3 block of cells. Use category-specific cell keys, finer precision with more rings, S2 coverings, or cap candidates by pre-sorted popularity.',
    '<strong>Hot cells and peak hours:</strong> cache ranked results per cell; nearby users share them, absorbing meal-time spikes.',
    '<strong>Global data:</strong> partition by region for data residency and latency; each region holds its own businesses plus a global copy for travellers if needed.',
    '<strong>Index rebuilds:</strong> keep the database as the source of truth and be able to rebuild any index from it (or from a CDC snapshot) in minutes.'
  ],
  tradeoffs: [
    ['Spatial index', 'Geohash vs quadtree vs S2/H3', 'Geohash in Redis for simplicity and easy updates; S2 when tighter coverage matters; quadtree when the index lives in-process.'],
    ['Where the index lives', 'Shared Redis replicas vs in-process in each LBS', 'Shared replicas: one copy to update, simple deploys. In-process removes a network hop but every instance must build and update it.'],
    ['Freshness', 'Synchronous index updates vs asynchronous CDC', 'Asynchronous: writes are rare and minutes of staleness are acceptable; CDC avoids dual-write bugs.'],
    ['Fixed vs adaptive radius', 'Always the requested radius vs expand until k results', 'Expand when results are too few, and tell the user the effective radius.'],
    ['Result caching key', 'Exact coordinates vs cell id', 'Cell id: high hit rate; the slight imprecision is corrected by computing exact distances on the cached candidates.']
  ],
  failures: [
    ['Geo index replica down', 'Client retries on another replica (each has the full index); replace and resync from the primary.'],
    ['Geo index corrupted or lost', 'Rebuild from the database or CDC snapshot; serve from the search engine’s geo_distance meanwhile.'],
    ['CDC pipeline lag', 'Changes appear late but nothing breaks; alert on lag; owners see their own updates via primary reads.'],
    ['Database primary failure', 'Automatic failover; reads continue from replicas and caches because the read path never needs the primary.'],
    ['Search engine overloaded', 'Shed text queries to a simpler geo-only search with category filters; autoscale data nodes.'],
    ['Wrong coordinates in a listing', 'Validate on write (geocode check, distance from previous address), allow user reports, keep history to roll back.']
  ],
  cloud: [['DNS', 'dns'], ['CDN for photos', 'cdn'], ['WAF', 'waf'], ['API gateway', 'apigw'], ['Search and business services', 'containers'], ['Geo index and caches', 'cache'], ['Business database', 'sql'], ['Text + geo search', 'search'], ['Change stream (CDC)', 'stream'], ['Index builder', 'functions'], ['Photo storage', 'blob'], ['Geocoding', 'maps'], ['Identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azp-cache-aside', 'azCaching', 'azp-materialized-view', 'azp-cqrs', 'azp-index-table', 'azp-static-content-hosting', 'azDataStore'],
          aws: ['awsCaching', 'blCaching', 'awsWaf', 'blStatic', 'awsDiagrams'] },
  questions: [
    ['Why not just use SQL with lat BETWEEN and lng BETWEEN?', 'A B-tree index helps with one dimension only: the database finds everything in a latitude band across the whole world, then filters longitude. Cell ids (geohash, S2) or spatial indexes (R-tree / GiST in PostGIS) turn the 2-D query into a few narrow index lookups.'],
    ['Why query the neighbouring cells?', 'A user near a cell edge has businesses a few metres away in the adjacent cell, and cells with very different strings can be adjacent. Querying the 8 neighbours (or an S2 covering) guarantees nothing within the radius is missed; exact distance filtering then removes the extra candidates.'],
    ['How do you pick geohash precision for a radius?', 'Choose the longest prefix whose cell is at least as large as the radius, so the 3 &times; 3 block covers the circle: about 6 for 0.5 km, 5 for 1-2 km, 4 for 5-20 km. In dense areas use a finer precision with more rings to keep candidate sets small.'],
    ['Geohash or quadtree?', 'Geohash is simpler, works in any key-value store, and updates are trivial; a quadtree adapts to density and supports k-nearest naturally but lives in memory and is harder to update. For mostly static business data either works; many teams pick geohash (or S2) for operational simplicity.'],
    ['Do you need to shard the geo index?', 'Not for 200 M businesses: about 16 GB fits in memory, so replicate it for throughput and availability. Shard (for example by geohash prefix or region) only for much larger data sets, such as billions of points or moving objects.'],
    ['How is this different from finding nearby drivers?', 'Businesses barely move and are read constantly, so we replicate a static index and cache aggressively. Drivers move every few seconds, so their index must absorb hundreds of thousands of writes per second with TTLs (see ride-hailing).']
  ],
  related: ['ride-hailing', 'maps', 'search-engine', 'hotel-booking', 'caching']
});

SD.renderCase({
  slug: 'maps',
  summary: 'A maps platform does three quite different jobs. It <strong>draws the world</strong>: the map is cut into a pyramid of square tiles per zoom level, now mostly <strong>vector tiles</strong> styled on the device, pre-built from the map data and served from a CDN. It <strong>finds routes</strong>: a road graph of hundreds of millions of edges is pre-processed with <strong>contraction hierarchies</strong> (or their customisable variants, CCH and CRP) so a continent-scale shortest path takes milliseconds instead of seconds of plain Dijkstra or A*. And it <strong>knows the traffic</strong>: anonymised GPS probes from phones on the road are map-matched to road segments, turned into live speeds that update the graph’s edge weights every minute, and fed with history into an <strong>ETA model</strong>. Around these sit geocoding (text &rarr; coordinates and back) and a <strong>map data pipeline</strong> that conflates sources into versioned map releases.',
  examples: 'Google Maps, Apple Maps, Bing Maps / Azure Maps, HERE, TomTom, Mapbox, OpenStreetMap with OSRM, Valhalla and GraphHopper; navigation inside Uber, Lyft and logistics apps (often via Amazon Location Service or Azure Maps APIs).',
  functional: ['Display a pannable, zoomable map on web, mobile and car screens, with labels, POIs and a live traffic layer.', 'Turn-by-turn directions for car, walking, cycling and transit, with alternatives and avoid options.', 'Accurate ETAs, including for departures in the future; live re-routing around incidents.', 'Search: geocoding of addresses and places, reverse geocoding of a tapped point.', 'Distance/ETA matrices for business customers (dispatch, delivery).', 'Regular map updates: new roads, closures, business changes.'],
  nonFunctional: ['Tiles: p95 &lt; 100 ms from the CDN; the map must keep working on poor mobile networks.', 'Directions: p95 &lt; 200 ms for a cross-continent car route with live traffic.', 'ETA accuracy: e.g. 90% of trips within &plusmn;10% of actual duration.', 'Traffic freshness: a jam is reflected in routing within ~2 minutes.', '99.95% availability; privacy-preserving handling of location data.'],
  outOfScope: ['Street-level imagery capture and processing.', 'Indoor maps.', 'Ride matching (see ride-hailing) and nearby search ranking (see proximity).'],
  estimates: [
    ['Daily active users', '~200 million', 'Large consumer map app'],
    ['Tile requests', '~30 B/day, ~1 M/s peak', '200 M &times; 3 sessions &times; 50 tiles; peak ~3&times; average (350 K/s)'],
    ['Tile pyramid size', '~360 M tiles for z0-z14, ~3 TB per release', 'Tiles at zoom z = 4<sup>z</sup>; sum to z14 &asymp; 358 M; ~70% are ocean or empty (deduplicated), ~100 M &times; ~30 KB vector tiles'],
    ['Directions requests', '~1 B/day, ~35 K/s peak', 'Includes re-route checks and API customers; 11.6 K/s average &times; 3'],
    ['Concurrent navigating devices', '~10 million at peak', 'Each sends 1 GPS point/s, batched every 10 s'],
    ['Probe ingest', '~10 M points/s, ~1 M requests/s', '10 M devices &times; 1 Hz; ~40 bytes per point &asymp; 400 MB/s'],
    ['Road graph', '~300 M nodes, ~700 M edges (world)', 'Routable subset of OpenStreetMap-scale data; CH adds roughly as many shortcuts again'],
    ['Graph memory per profile', '~50-100 GB', '~1.5 B edges (incl. shortcuts) &times; ~16-32 B plus geometry indexes; one copy per profile (car, bike, walk)'],
    ['Geocoding', '~500 M queries/day, ~20 K/s peak', 'Plus typeahead; index ~1 B addresses and POIs &asymp; 500 GB']
  ],
  compute: [
    ['Routing servers', '~48 &times; 32 vCPU / 256 GB, 16 per region in 3 regions', '35 K req/s &times; ~20 ms CPU (CCH query with live weights, 3 alternatives, path unpacking, ETA features) = 700 busy cores &rArr; ~1,170 at 60% &rArr; ~37 servers. Each holds the world car graph in RAM; 16 per region keeps N+1 per zone and lets one region absorb another’s traffic partially.'],
    ['Traffic customisation', 'Every ~60 s on each routing server', 'CCH/CRP metric customisation re-computes shortcut weights bottom-up in a few seconds on 16 cores for a continent; done in a double buffer so queries never wait.'],
    ['Tile origin', '~16 &times; 32 vCPU', 'Static vector tiles are pre-built (CDN hit &gt; 99%, ~10 K/s misses). Traffic overlay tiles (60 s TTL) add ~40 K/s; ~5 ms each &rArr; 250 cores &rArr; ~400 at 60%.'],
    ['Traffic processor (Flink)', '~50 &times; 8 vCPU', '10 M points/s &times; ~20 &micro;s incremental HMM map matching = 200 cores &rArr; ~400 at 50% for backlog headroom.'],
    ['Geocoding search cluster', '~30 data nodes', '500 GB index &times; 2 replicas; 20 K q/s &times; ~10 ms = 200 cores spread over shards and replicas.'],
    ['Map data pipeline', 'Spark cluster, ~2,000 cores for a few hours per full build', 'Full world rebuild of tiles, graph and geocoding index from conflated sources; incremental builds (closures, edits) run hourly on a fraction of that.']
  ],
  api: [
    ['GET /tiles/{style}/{release}/{z}/{x}/{y}.mvt', 'Vector tile (Mapbox Vector Tile, protobuf, gzip/brotli). Release in the URL makes tiles immutable: Cache-Control max-age = 1 year.'],
    ['GET /traffic/{z}/{x}/{y}.mvt?t={minute}', 'Traffic overlay tile; the minute bucket in the URL keeps CDN caching correct with a ~60 s TTL.'],
    ['POST /directions {origin, destination, waypoints, mode, departAt, avoid}', 'Returns up to 3 routes: encoded polyline, distance, ETA, legs, turn-by-turn steps, traffic per span.'],
    ['POST /matrix {origins[], destinations[], mode}', 'Many-to-many durations (e.g. 100 &times; 100) for dispatch; uses CH bucket algorithms, far cheaper than 10,000 route queries.'],
    ['GET /geocode?q=&near=  |  GET /reverse?lat=&lng=', 'Forward geocoding biased to the viewport or user location; reverse geocoding of a tapped point.'],
    ['POST /probes [{ts, lat, lng, speed, heading, accuracy}]', 'Batched GPS points from navigating devices with a rotating anonymous trip token; no account id.'],
    ['WS /navigation/{sessionId}', 'Push faster-route offers and incident warnings to a navigating device.']
  ],
  data: [
    ['map features (source of truth)', 'PostGIS + data lake (Parquet, versioned)', 'Roads, buildings, POIs, admin areas with geometry and attributes; each map release is an immutable snapshot id.'],
    ['vector tiles', 'Object storage + CDN', 'Key style/release/z/x/y (or one PMTiles archive per release); empty/ocean tiles deduplicated by content hash.'],
    ['routing graph', 'Custom in-memory binary (CSR arrays)', 'Nodes, edges with base speeds, turn restrictions, CH/CCH shortcut overlay and partition cells; built offline per release and profile, memory-mapped at start-up.'],
    ['live traffic speeds', 'In-memory KV (Redis) + stream', 'segment_id &rarr; speed, confidence, sample count, updated_at; ~50 M segments with traffic; snapshot published every minute.'],
    ['historical speed profiles', 'Data lake', 'segment_id &times; 15-minute slot of week (672 slots) &rarr; typical speed; used for future departures and as a prior when probes are sparse.'],
    ['geocoding index', 'Search engine (Elasticsearch / OpenSearch / Azure AI Search)', 'Documents per address, street, POI and admin area: names in all languages, parsed components, geo_point, H3 cell, popularity.'],
    ['probe archive', 'Data lake partitioned by date/hour/H3 region', 'Map-matched traces with trip tokens stripped after 24 h; used for training ETA models and detecting map errors.']
  ],
  dbChoice: [
    ['Routing graph', 'Custom in-memory structure on each routing server', 'A route query touches thousands of edges in microseconds; any network hop per edge would be 1,000&times; too slow. The graph changes only per release (topology) and per minute (weights).', 'Graph database (Neo4j, Neptune): great for relationship queries, far too slow for continent-scale shortest paths with live weights.'],
    ['Map tiles', 'Object storage + CDN', 'Billions of small immutable files, read-mostly, cached at the edge.', 'Rendering on every request (no pre-build): cheap storage but high latency and compute.'],
    ['Live traffic', 'In-memory KV fed by a stream processor', 'Write-heavy, last value wins, read in bulk once a minute by customisation and per tile by the overlay.', 'Time-series DB for the live view: fine for history, but not needed on the hot path.'],
    ['Geocoding', 'Search engine with geo support', 'Fuzzy text matching, multilingual analysers, geo-distance boosting and filters.', 'SQL LIKE / trigram: does not rank well or scale to 1 B documents with typo tolerance.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'mobile', 0, 1.5, 'app, web, car'], ['cdn', 'CDN', 'cdn', 1, 0.3, 'tiles, fonts, sprites'], ['gw', 'API gateway', 'apigw', 1, 1.8, 'auth, quotas'],
      ['tile', 'Tile service', 'svc', 2, 0.3, 'origin, traffic overlay'], ['route', 'Routing service', 'svc', 2, 1.4, 'directions, matrix'], ['geo', 'Geocoding', 'svc', 2, 2.9, 'parse, rank'],
      ['tstore', 'Tile store', 'blob', 3, 0, 'vector tiles per release'], ['graph', 'Routing graph', 'graph', 3, 1.4, 'in-memory CCH'], ['search', 'Place index', 'search', 3, 2.9, 'addresses, POIs'],
      ['pipe', 'Map data pipeline', 'job', 4, 0, 'conflate, build release'], ['eta', 'ETA model', 'ml', 3, 2.15, 'GBDT / GNN'], ['traffic', 'Live traffic', 'cache', 5, 1.4, 'segment speeds'],
      ['probes', 'Probe stream', 'stream', 1, 3.5, 'Kafka'], ['tproc', 'Traffic processor', 'worker', 4, 3.5, 'map matching (Flink)']],
    edges: [['u', 'cdn'], ['u', 'gw'], ['cdn', 'tile'], ['tile', 'tstore'], ['gw', 'route'], ['gw', 'geo'], ['route', 'graph'], ['geo', 'search'], ['route', 'eta'], ['eta', 'traffic'],
      ['pipe', 'tstore', 'tiles'], ['pipe', 'graph', 'graph'], ['gw', 'probes', 'GPS probes', 'async'], ['probes', 'tproc', '', 'async'], ['tproc', 'traffic', 'speeds'], ['traffic', 'graph', 'weights / 60 s'], ['traffic', 'tile', 'overlay']]
  },
  flows: [
    { name: 'Load the map', desc: 'Panning to a new area: almost everything is served from the CDN.', steps: [
      ['u', 'cdn', 'GET tile 14/8185/5448.mvt', 'The app works out which z/x/y tiles cover the viewport (about 12-20 on a phone) and fetches the missing ones in parallel.'],
      ['cdn', 'tile', 'miss (rare)', 'Tile URLs contain the map release, so they never change and can be cached for a year; misses are mostly first requests in a PoP.'],
      ['tile', 'tstore', 'read pre-built tile', 'Vector tiles for z0-z14 were generated by the pipeline; nothing is rendered per request.'],
      ['tstore', 'tile', '~30 KB protobuf', 'Geometry is quantised to a 4,096 grid per tile and gzip/brotli compressed.', 'resp'],
      ['cdn', 'u', 'tile (cached at edge)', 'The device styles and renders vector data on the GPU: rotation, 3D tilt, dark mode and labels in the user’s language from the same tile.', 'resp'],
      ['u', 'cdn', 'GET /traffic/14/8185/5448?t=…', 'The traffic layer is a separate tile set with a minute bucket in the URL and a 60 s TTL.'],
      ['cdn', 'tile', 'miss once a minute per PoP', 'Popular areas are requested constantly; each edge refreshes them once per minute.'],
      ['tile', 'traffic', 'speeds for tile segments', 'The tile service builds the overlay from the latest speed snapshot, colouring segments by speed relative to free flow.']],
      end: 'Static geometry is immutable and pre-built; only the small traffic overlay changes every minute. Above z14 the client overzooms vector tiles instead of fetching z15-z22.' },
    { name: 'Directions with live traffic', desc: 'A user asks for a route across the country.', steps: [
      ['u', 'gw', 'POST /directions', 'Origin is the device location; destination may be text or a place id.'],
      ['gw', 'geo', 'resolve destination', 'If the destination is free text, geocode it first (usually already resolved by the search box).'],
      ['geo', 'search', 'match place', 'Place index lookup returns coordinates and the entrance point to route to.', 'resp'],
      ['gw', 'route', 'route A to B, car', 'The gateway sends the request to a routing server in the user’s region.'],
      ['route', 'graph', 'snap + bidirectional CCH query', 'Snap both points to the nearest road edges (spatial index), then run an upward search from both ends on the hierarchy with the current minute’s weights: a few thousand nodes settled instead of millions.'],
      ['graph', 'route', 'path + 2 alternatives', 'Shortcuts are unpacked into real edges for the polyline and turn-by-turn instructions.', 'resp'],
      ['route', 'eta', 'predict ETA', 'The model corrects the summed segment times: traffic lights, turns, how today’s jam will evolve over the next hour of driving.'],
      ['eta', 'traffic', 'live + historical features', 'Features: live speeds and confidence, historic profile for the time each segment will be reached, road class, weather, events.'],
      ['route', 'u', '3 routes, ETA 4 h 12 min', 'Response with polylines, distances, ETAs and traffic per span, in ~100-150 ms.', 'resp']],
      end: 'Pre-processing (CH) buys millisecond queries; customisation folds live traffic into the hierarchy every minute; ML turns path cost into an ETA people trust.' },
    { name: 'Live traffic from probes', desc: 'Phones on a motorway slow down; within two minutes everyone routing nearby knows.', steps: [
      ['u', 'gw', 'POST /probes (10 points)', 'Navigating devices send 1 Hz GPS points every 10 s with a rotating anonymous trip token.'],
      ['gw', 'probes', 'append (by H3 region)', 'Partitioning by region keeps nearby probes together for the map matcher.', 'async'],
      ['probes', 'tproc', 'consume', 'The stream processor keeps a short trace per trip token.', 'async'],
      ['tproc', 'traffic', 'segment speeds per minute', 'A hidden Markov model (Viterbi) matches noisy points to the most likely road path; speeds are aggregated per segment per 1-minute window with outlier removal and blended with the historical profile when samples are few.'],
      ['traffic', 'graph', 'publish snapshot', 'Every ~60 s routing servers pull the new speed snapshot and run CCH customisation into a second buffer, then swap it in atomically.'],
      ['traffic', 'tile', 'overlay refresh', 'The next traffic tile requests show the jam in red.']],
      end: 'Probe volume is huge but each point is tiny; the art is map matching, privacy (no identities, trimmed trip ends) and blending sparse live data with history.' },
    { name: 'Geocoding', desc: 'Turning “10 downing st london” into coordinates.', steps: [
      ['u', 'gw', 'GET /geocode?q=10 downing st', 'Query text plus viewport or location bias.'],
      ['gw', 'geo', 'forward', 'Geocoding service.'],
      ['geo', 'search', 'parsed + fuzzy query', 'The parser (e.g. libpostal-style CRF) labels house number, street and city; the query matches street names with typo tolerance, filtered by city and boosted by distance to the viewport.'],
      ['search', 'geo', 'top 20 candidates', 'Candidates: the address point, the street, similarly named streets elsewhere.', 'resp'],
      ['geo', 'u', 'best match + alternatives', 'Ranked by match quality, importance and distance; house numbers missing from the data are interpolated along the street.', 'resp']],
      end: 'Geocoding is search with geography: parsing, fuzzy matching, and a ranking that weighs text match against distance and popularity.' },
    { name: 'Road closed mid-trip', desc: 'A crash closes a motorway ahead of 5,000 navigating drivers.', steps: [
      ['tproc', 'traffic', 'flow stops on segment 88123', 'Probe speeds drop to zero and an incident report arrives from a road authority feed.', 'err'],
      ['traffic', 'graph', 'mark closed (weight = ∞)', 'Closures are applied immediately as a weight override, not waiting for the next minute’s customisation.', 'err'],
      ['u', 'gw', 'periodic re-route check', 'Navigating clients ask every ~2 minutes (or are pushed) whether a better route exists.'],
      ['gw', 'route', 'compare current vs best', 'The routing server recomputes from the current position, honouring the closure.'],
      ['route', 'graph', 'query with closure', 'The closed edge is effectively removed; the best route now leaves at the next junction.'],
      ['route', 'u', 'faster route, saves 18 min', 'Offered (or auto-accepted) on the device. Re-routing thousands of cars at once is staggered so a side road is not flooded.', 'resp']],
      end: 'Incidents need a fast path that bypasses the normal one-minute cadence; mass re-routing must consider where everyone else is being sent.' }
  ],
  components: [
    ['Map data pipeline', 'Ingest and conflate sources (OSM, vendors, imagery-derived features, user reports), validate topology, and build versioned releases of tiles, routing graphs and geocoding indexes.'],
    ['Tile service + CDN', 'Serve pre-built vector tiles and minute-fresh traffic overlay tiles; immutable release-versioned URLs.'],
    ['Routing service', 'In-memory graphs per profile, snapping, CCH/CRP queries, alternatives, matrices, turn-by-turn generation.'],
    ['Traffic pipeline', 'Probe ingest, map matching, segment speed aggregation, incident detection, minute snapshots.'],
    ['ETA model', 'Predicts trip duration from path, live and historical speeds and context; retrained on completed trips.'],
    ['Geocoding service', 'Forward and reverse geocoding, autocomplete, place details.'],
    ['API gateway', 'Keys, quotas and billing for API customers; request routing by region.']
  ],
  evolutionTitle: 'From static tiles to live navigation',
  evolution: [
    { name: '1. Raster + Dijkstra', desc: 'Pre-rendered PNG tiles and a shortest-path search on a road graph: fine for a city.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.5], ['t', 'Tile server', 'svc', 1.5, 0, 'PNG tiles'], ['r', 'Route server', 'svc', 1.5, 1.1, 'Dijkstra / A*'], ['g', 'Road graph', 'graph', 3, 1.1]], edges: [['u', 't'], ['u', 'r'], ['r', 'g']] },
      steps: [['u', 't', 'GET PNG tile', 'Each style and language needs its own raster tiles.'], ['u', 'r', 'route', 'A* with a straight-line heuristic.'], ['r', 'g', 'explore', 'Fine for a city; a cross-country route settles millions of nodes and takes seconds.']] },
    { name: '2. Vector tiles + CH', desc: 'Vector tiles on a CDN, and contraction hierarchies for millisecond routes on static speeds.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.5], ['c', 'CDN', 'cdn', 1.5, 0, 'vector tiles'], ['r', 'Route server', 'svc', 1.5, 1.1], ['g', 'CH graph', 'graph', 3, 1.1, 'shortcuts']], edges: [['u', 'c'], ['u', 'r'], ['r', 'g']] },
      steps: [['u', 'c', 'vector tiles', 'One tile set serves all styles and languages; the client renders.'], ['u', 'r', 'route', 'Bidirectional CH query.'], ['r', 'g', 'upward search', 'Under 1 ms for a continent, but weights are fixed: adding traffic means re-contracting for minutes or hours.']] },
    { name: '3. Live traffic + ML ETA', desc: 'Probes update weights every minute via customisable hierarchies; a model predicts ETAs.', diagram: { nodes: [['u', 'Drivers', 'mobile', 0, 0.6], ['p', 'Probe pipeline', 'stream', 1.5, 1.4], ['t', 'Live traffic', 'cache', 3, 1.4], ['r', 'Route server', 'svc', 1.5, 0, 'CCH + ETA model'], ['g', 'CCH graph', 'graph', 3, 0]], edges: [['u', 'p', '', 'async'], ['p', 't'], ['t', 'g', 'customise'], ['u', 'r'], ['r', 'g']] },
      steps: [['u', 'p', 'GPS probes', 'Every navigating phone is a traffic sensor.', 'async'], ['p', 't', 'segment speeds', 'Map-matched speeds every minute.'], ['t', 'g', 'customise metric', 'Seconds, not hours, because the hierarchy’s structure is metric-independent.'], ['u', 'r', 'route + ETA', 'Routes and ETAs reflect the traffic of the last couple of minutes.']] }
  ],
  deep: [
    ['Map tiles and the tile pyramid', '<p>The world in Web Mercator is a square; zoom 0 is one 256/512 px tile, and each zoom level splits every tile into four: zoom z has 2<sup>z</sup> &times; 2<sup>z</sup> = 4<sup>z</sup> tiles, addressed z/x/y.</p><table><tr><th>Zoom</th><th>Tiles</th><th>Typical use</th></tr><tr><td>0</td><td>1</td><td>whole world</td></tr><tr><td>5</td><td>1,024</td><td>continents</td></tr><tr><td>10</td><td>~1 M</td><td>cities</td></tr><tr><td>14</td><td>~268 M</td><td>streets (vector tiles max zoom)</td></tr><tr><td>18</td><td>~69 B</td><td>buildings (raster era)</td></tr></table><p>Pre-rendering raster tiles to z18 for every style and language is impossible, which is why platforms moved to <strong>vector tiles</strong>: geometry and attributes in protobuf (MVT), generated to ~z14 and <em>overzoomed</em> by the client beyond that; style, language and dark mode are applied on the device. Ocean and empty tiles are deduplicated by hash (most of the pyramid). Releases are versioned in the URL, so tiles are immutable and CDN hit ratios exceed 99%. A full build is a big parallel job (Spark or tippecanoe/planetiler-style tools); incremental builds regenerate only tiles touched by edits.</p>'],
    ['Routing: Dijkstra, A*, contraction hierarchies, CCH/CRP', '<p>Dijkstra on a continent settles millions of nodes (seconds). <strong>A*</strong> with a straight-line heuristic helps little for driving time; ALT (landmarks + triangle inequality) gives ~10&times;. <strong>Contraction hierarchies</strong> pre-process the graph: contract nodes in order of “importance”, adding a shortcut u&rarr;w whenever the only shortest path between neighbours went through the removed node. A query runs Dijkstra upward only (towards more important nodes) from both ends and meets in the middle: ~1,000 nodes settled, &lt; 1 ms.</p><pre><code>// bidirectional CH query (sketch)\nfwd = upwardDijkstra(source)          // only edges to higher-rank nodes\nbwd = upwardDijkstra(target, reverse) // same on the reverse graph\nbest = min over v in fwd &cap; bwd of fwd[v] + bwd[v]\npath = unpackShortcuts(meetingNode)</code></pre><p>The catch: CH node order depends on the weights, so live traffic would force re-contraction. <strong>Customizable CH</strong> (metric-independent order from nested dissection) and <strong>Customizable Route Planning</strong> (multi-level partition cells with overlay cliques, used by Bing/Azure Maps) split the work: topology pre-processing once per map release (hours), <em>metric customisation</em> in seconds whenever speeds change, queries in milliseconds. Time-dependent routing for future departures uses the historical profiles per 15-minute slot.</p>'],
    ['Live traffic from probe data', '<ul><li><strong>Map matching:</strong> GPS is noisy (5-20 m, worse in cities). An HMM with emission probability by distance to candidate edges and transition probability by route-vs-straight-line distance, solved with Viterbi over a sliding window, picks the most likely road path.</li><li><strong>Aggregation:</strong> per segment per minute, robust statistics (median, trimmed mean) over matched traversal times; filter parked cars, buses at stops, taxis waiting.</li><li><strong>Sparsity:</strong> many segments have no probe in a given minute; blend live observations with the historical profile weighted by sample count and age (a simple Bayesian update), and propagate along corridors.</li><li><strong>Privacy:</strong> no account ids, trip tokens rotated per trip, start and end of traces trimmed, aggregates published only with enough distinct contributors (k-anonymity), raw traces deleted or de-identified after a short window.</li><li><strong>Incidents:</strong> official feeds and user reports override weights immediately, with expiry.</li></ul>'],
    ['ETA prediction', '<p>Summing segment travel times gives a biased ETA: it ignores turn and traffic-light delays and assumes today’s speeds persist for the whole trip. Production systems predict the <strong>residual</strong> with ML (gradient-boosted trees, or graph neural networks over “supersegments” as published by Google/DeepMind) using features such as live and historical speeds for the time each segment will be reached, road class, number of turns and signals, weather and events. Training data is completed trips (actual vs predicted). Evaluate with MAPE and the share of trips within &plusmn;10%, sliced by city, trip length and time of day; watch for drift after map releases and on public holidays.</p>'],
    ['Geocoding and the map data pipeline', '<p><strong>Geocoding</strong>: parse the query into components, retrieve candidates from a search index with fuzzy, multilingual matching, rank by text match, importance and distance to the user, and interpolate house numbers along street segments when exact points are missing. <strong>Reverse geocoding</strong> uses a spatial index (S2/H3 cells or an R-tree) to find the nearest address point or street.</p><p><strong>Map data pipeline</strong>: ingest OSM diffs, vendor data, government feeds, imagery-derived features and user reports; conflate duplicates; validate topology (connectivity, turn restrictions, one-ways); then build all artefacts from the same snapshot so tiles, routing graph and geocoder agree. Releases roll out like software: canary region, metrics (routing failures, “road not found” reports), then global, with rollback to the previous release.</p>']
  ],
  scale: [
    '<strong>Tile delivery:</strong> immutable, release-versioned URLs and vector tiles give &gt; 99% CDN hits; ocean dedupe shrinks storage. Traffic tiles use minute buckets so they cache well too.',
    '<strong>Routing memory:</strong> a world graph per profile is 50-100 GB; scale out by replicating whole graphs (queries are CPU-bound and independent), or shard by continent with a cross-shard planner for intercontinental ferries and tunnels.',
    '<strong>Matrix requests</strong> from logistics customers are expensive: use many-to-many CH bucket algorithms, cap sizes, and price them separately.',
    '<strong>Probe ingest spikes</strong> at rush hour: partition the stream by H3 region, autoscale the map matcher on lag, and degrade gracefully to historical profiles if live data falls behind.',
    '<strong>Map releases:</strong> rebuilding everything is slow; keep incremental pipelines for closures and edits, and full rebuilds weekly.',
    '<strong>Mass re-routing:</strong> when one incident affects thousands of cars, stagger and diversify suggestions so the alternative road does not jam.'
  ],
  tradeoffs: [
    ['Tile format', 'Raster vs vector tiles', 'Vector: one tile set for every style and language, smaller transfers, smooth zoom and rotation; raster only for satellite imagery and very old clients.'],
    ['Routing algorithm', 'A* vs CH vs CCH/CRP', 'CCH/CRP: millisecond queries and live traffic via fast customisation. Plain CH is simpler but static; A* is fine only for small graphs or as a fallback.'],
    ['Traffic freshness vs stability', 'Update weights every 10 s vs every 60 s', '60 s cadence plus an immediate override path for closures: customisation cost stays bounded and routes do not flap.'],
    ['ETA', 'Pure graph sum vs ML correction', 'ML residual model on top of the graph: big accuracy gains, at the cost of a training pipeline and monitoring.'],
    ['Build vs buy', 'Own platform vs Azure Maps / Amazon Location / Mapbox APIs', 'Buy for nearly everyone; build only if maps are the product or volume makes per-request pricing prohibitive.']
  ],
  failures: [
    ['Routing server failure', 'Stateless queries over replicated read-only graphs; the load balancer retries elsewhere; N+1 per zone.'],
    ['Traffic pipeline lag or outage', 'Routing falls back to historical profiles (still decent ETAs); alert on freshness; never block queries on live data.'],
    ['Bad map release (broken junction)', 'Canary releases with routing-failure and user-report metrics; instant rollback to the previous release id in tile URLs and graph loaders.'],
    ['CDN outage in a region', 'Multi-CDN or fallback origin; clients keep an offline cache of recently viewed and downloaded areas.'],
    ['Wrong closure or spam incident reports', 'Require corroboration from probes or trusted feeds; expiry on overrides; reputation for reporters.'],
    ['GPS spoofing / fake traffic jams', 'Rate-limit and validate probes (plausible speeds, sensor consistency), require diverse contributors per segment before declaring congestion.']
  ],
  cloud: [['Managed maps APIs (buy option)', 'maps'], ['CDN for tiles', 'cdn'], ['Tile and release storage', 'blob'], ['API gateway and keys', 'apigw'], ['Routing servers (memory-optimised)', 'vms'], ['Tile, geocoding and API services', 'k8s'],
    ['Live traffic store', 'cache'], ['Probe ingest stream', 'stream'], ['Map matching', 'streamproc'], ['Map data pipeline', 'bigdata'], ['Map source data (PostGIS)', 'sql'], ['Geocoding index', 'search'], ['Probe archive and analytics', 'warehouse'], ['ETA model training and serving', 'ml'], ['Monitoring', 'monitor']],
  refs: { az: ['azBigData', 'azStreamDbx', 'azCdn', 'azp-static-content-hosting', 'azp-materialized-view', 'azCaching', 'azMlops', 'azAutoscale'],
          aws: ['awsAnalyticsLens', 'awsMlLens', 'blCaching', 'blConstant', 'awsCaching', 'awsDiagrams'] },
  questions: [
    ['How many tiles are there and do you pre-render them all?', 'Zoom z has 4^z tiles, so z0-z14 is ~358 M and z18 alone ~69 B. With vector tiles you pre-build to ~z14 (most of it ocean, deduplicated) and the client overzooms beyond that; raster imagery at high zoom is rendered or fetched on demand and cached.'],
    ['Why are contraction hierarchies so fast?', 'Pre-processing adds shortcut edges so that every shortest path can be found by searching only “upward” to more important nodes from both ends. The search spaces are tiny (hundreds to a few thousand nodes) compared with millions for Dijkstra.'],
    ['How do you combine CH with live traffic?', 'Use a customisable variant: CCH or CRP compute a metric-independent structure once per map release, then re-run a fast customisation step (seconds) with new edge weights every minute, and apply closures as immediate overrides.'],
    ['How would you compute ETAs for a departure tomorrow at 8 am?', 'Time-dependent routing using historical speed profiles per 15-minute slot of the week, evaluating each segment at the time the vehicle is expected to reach it, plus the ML model trained on similar historical trips; live data matters little that far ahead.'],
    ['How do you protect user privacy in traffic data?', 'No account identifiers in probes, rotating per-trip tokens, trimming trip starts and ends, aggregating only when enough distinct devices contributed, and deleting raw traces quickly; publish only segment speeds.'],
    ['How do you serve a 100 &times; 100 distance matrix efficiently?', 'Many-to-many CH: run a backward upward search from each destination, storing (node, distance) in buckets, then a forward upward search from each origin scans the buckets. It costs about 200 small searches instead of 10,000 full queries.']
  ],
  related: ['proximity', 'ride-hailing', 'search-engine', 'typeahead', 'iot-platform']
});

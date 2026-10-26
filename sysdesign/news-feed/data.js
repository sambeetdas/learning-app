SD.renderCase({
  slug: 'news-feed',
  summary: 'A news feed shows each user a ranked, constantly refreshed list of posts from the people and pages they follow. The core problem is the shape of the work: reads outnumber writes by roughly 20 to 1, and every post must reach hundreds of followers, so the design pre-computes feeds when a post is created (fan-out on write) and stores them as short lists of post ids in Redis. Accounts with millions of followers break that model, so they are handled the other way round (fan-out on read) and merged in at request time. A ranking pipeline (candidate generation, a light ranker and a heavy ML ranker) orders the candidates, posts are hydrated from a cache, media comes from a CDN, and cursors make pagination stable while new posts keep arriving.',
  examples: 'Facebook News Feed, Instagram home feed, X (Twitter) home timeline, LinkedIn feed, Threads, Bluesky (which exposes the same push/pull choice through custom feed generators).',
  functional: ['Users create posts (text, images, short video) and follow other users or pages.', 'The home feed shows recent posts from followed accounts, ranked by predicted interest, 20 at a time with infinite scroll.', 'Likes, comments and shares update counts and feed ranking signals.', 'New posts by people you follow appear within seconds ("new posts" pill on pull-to-refresh).', 'Deleted posts, unfollowed and blocked accounts disappear from the feed.'],
  nonFunctional: ['300 M daily active users, ~70 k feed loads/s at peak.', 'Feed load p99 under 500 ms server side (p50 under 150 ms).', 'Post visible in followers’ feeds within 5 s (p95) for normal accounts.', 'High availability (99.95%): a stale or chronological feed is better than an error page.', 'Eventual consistency is acceptable; a missed post for a few seconds is fine, a lost post is not.'],
  outOfScope: ['Ads auction and insertion (only a slot in re-ranking).', 'Comment threads, stories, direct messages (see chat).', 'Search and explore/discovery feeds beyond followed accounts.', 'Training the ranking models (see recommendation and ml-platform).'],
  estimates: [
    ['Daily active users (DAU)', '300 M (of ~600 M monthly active)', 'Large consumer social network'],
    ['Feed loads', '3 B/day &rArr; ~35 k/s average, ~70 k/s peak', '300 M &times; 10 loads (app opens + scroll pages) / 86,400 s; peak 2&times;'],
    ['New posts', '150 M/day &rArr; ~1.7 k/s average, ~5 k/s peak', '50% of DAU post once a day; peak 3&times; (live events)'],
    ['Fan-out inserts', '22.5 B/day &rArr; ~260 k/s average, ~0.8 M/s peak', '150 M posts &times; ~150 active followers each (celebrities excluded, inactive users skipped)'],
    ['Feed cache size', '~3.5 TB of RAM', '600 M monthly active &times; 500 post ids &times; 8 B = 2.4 TB raw, ~1.5&times; Redis overhead'],
    ['Post text + metadata', '~150 GB/day &rArr; ~55 TB/year (165 TB with 3 replicas)', '150 M &times; ~1 KB'],
    ['Media storage', '~60 TB/day', '20% of posts carry media: 30 M &times; ~2 MB (original + resized renditions)'],
    ['API egress', '~14 Gbit/s peak', '70 k/s &times; ~25 KB hydrated JSON page (20 posts)'],
    ['CDN media egress', '~550 Gbit/s average', '3 B loads &times; ~10 images seen &times; 200 KB / 86,400 s; served almost entirely by edge caches']
  ],
  compute: [
    ['Feed service', '~110 instances &times; 16 vCPU across 3 zones', '70 k req/s &times; ~10 ms CPU (merge, filter, hydrate, serialise) = 700 busy cores; at 60% utilisation &asymp; 1,170 cores &asymp; 73 instances. Must survive a zone loss: 2 zones carry everything &rArr; 37 per zone &times; 3 = ~110.'],
    ['Fan-out workers', '~9 &times; 4 vCPU baseline, autoscaled on Kafka consumer lag', 'Peak 0.8 M inserts/s; one core consumes events, pages follower lists and pipelines ~40 k Redis LPUSH+LTRIM/s &rArr; 20 busy cores &rArr; ~34 cores at 60%. Scale out on lag, not CPU.'],
    ['Feed cache (Redis)', '70 shards &times; 64 GB (50 GB usable) + 1 replica each = 140 nodes', 'Memory bound: 3.5 TB / 50 GB = 70 primaries. Ops are modest: (0.8 M writes + 70 k reads)/s / 70 &asymp; 12 k ops/s per shard (a shard does &gt;100 k).'],
    ['Ranking (heavy model)', '~75 GPUs (25 per zone)', 'Full ranking on ~50% of loads (first page / refresh): 35 k/s &times; 100 candidates after the light ranker = 3.5 M items/s. An L4-class GPU scores ~100 k items/s for a multi-task DNN &rArr; 35 busy, ~50 at 70%, &times;1.5 for zone loss.'],
    ['Post cache', '~12 shards &times; 50 GB + replicas', 'Hot set = posts from the last ~48 h: 300 M &times; 1 KB = 300 GB. 70 k pages &times; 20 posts = 1.4 M item reads/s as MGET batches; ~97% hit rate.'],
    ['Post store (Cassandra)', '~85 nodes after year one', 'Storage bound: 165 TB replicated / ~2 TB usable per node (4 TB disks kept half full for compaction). Reads are only cache misses: 1.4 M &times; 3% &asymp; 42 k/s.']
  ],
  api: [
    ['GET /v1/feed?cursor={opaque}&limit=20', 'Returns ranked, hydrated posts plus next_cursor. The cursor encodes the ranked-session id and position, so pages do not repeat or skip while new posts arrive.'],
    ['POST /v1/posts {text, media_ids[], visibility} + Idempotency-Key', 'Creates a post (id from a Snowflake-style generator so ids sort by time). Returns 201 immediately; fan-out is asynchronous.'],
    ['POST /v1/media/uploads → {upload_url, media_id}', 'Issues a short-lived pre-signed URL; the client PUTs the file straight to object storage (valet key). Processing (resize, transcode, moderation) runs on the storage event.'],
    ['PUT /v1/users/{id}/following/{target} | DELETE ...', 'Follow / unfollow. Updates both edge directions in the graph store; unfollow also enqueues a lazy feed clean-up.'],
    ['POST /v1/posts/{id}/reactions {type}', 'Likes etc. Increments sharded counters and emits an engagement event used as a ranking feature.'],
    ['GET /v1/feed/new?since_cursor=', 'Cheap check for the "new posts" pill: counts ids in the feed list newer than the head the client has.'],
    ['Event post.created {post_id, author_id, ts} (Kafka, key = author_id)', 'Drives fan-out, search indexing, notifications and moderation independently of the write path.']
  ],
  data: [
    ['posts', 'Wide-column store (Cassandra), partition key post_id', 'post_id (Snowflake), author_id, text, media refs, visibility, created_at, deleted flag. Immutable apart from edits/deletes, so it caches very well.'],
    ['user_posts (author timeline)', 'Cassandra, partition user_id, clustering post_id DESC', 'Used for profile pages and for pulling celebrity posts. Bucket very active authors by month to bound partition size.'],
    ['social graph', 'Sharded graph/KV store (TAO-style on MySQL, or a graph DB)', 'Two adjacency lists: followers(user_id &rarr; follower_id) and following(user_id &rarr; target_id), both partitioned by user_id; follower_count kept separately to classify celebrities.'],
    ['feed:{user_id}', 'Redis list (capped at 500 entries)', 'Post ids newest first, written by fan-out (LPUSH + LTRIM). Only kept for users active in the last 30 days; rebuilt on demand otherwise.'],
    ['post:{id}, celeb_recent:{author_id}', 'Redis / Memcached post cache', 'Hydrated post JSON and the last ~100 post ids of each celebrity, read at feed time for the pull side of the hybrid.'],
    ['counters', 'Redis (sharded counters) + periodic flush to Cassandra', 'like_count, comment_count per post; hot posts use N sub-counters to avoid a hot key.'],
    ['media', 'Object storage + CDN', 'Content-hash keys, several renditions per image/video; immutable so CDN TTLs can be a year.']
  ],
  dbChoice: [
    ['Posts and author timelines', 'Cassandra / ScyllaDB (wide column)', 'Write-heavy, append-only, simple key access (by post id or author + time range), petabyte scale with linear scale-out and multi-zone replication.', 'Sharded MySQL/PostgreSQL works (Facebook, Instagram started there) but needs manual resharding; DynamoDB / Cosmos DB are the managed equivalents.'],
    ['Precomputed feeds', 'Redis lists in a sharded cluster', 'The feed is a bounded, ordered list read in one LRANGE in &lt;1 ms. It is derived data, so losing it is an inconvenience (rebuild), not data loss.', 'Sorted sets (ZADD by score) if you want score-ordered inserts, at ~2&times; the memory; Cassandra-backed feeds are cheaper but 5-10&times; slower to read.'],
    ['Social graph', 'Sharded key-value adjacency lists (TAO-like) with a cache', 'The only queries are "followers of X" (fan-out, paged) and "who does X follow" (pull, filters). No multi-hop traversals on the hot path.', 'A native graph DB (Neptune, Cosmos DB Gremlin) helps for friends-of-friends suggestions, less for high-volume one-hop lists.'],
    ['Ranking features', 'Online feature store (low-latency KV)', 'Ranking needs hundreds of user, author and post features per candidate within a few ms.', 'Computing features inside the ranker on request: too slow and inconsistent with training.']
  ],
  diagram: {
    nodes: [['u', 'Users', 'mobile', 0, 1.4, 'app / web'], ['gw', 'API gateway', 'apigw', 1, 1.4, 'auth, rate limits'], ['cdn', 'CDN', 'cdn', 1, 2.9, 'images, video'],
      ['blob', 'Object storage', 'blob', 2, 2.9, 'media renditions'], ['feed', 'Feed service', 'svc', 2, 0.6, 'merge, rank, hydrate'], ['post', 'Post service', 'svc', 2, 2.0, 'create, delete'],
      ['rank', 'Ranking service', 'ml', 3, 0, 'light + heavy ranker'], ['feat', 'Feature store', 'nosql', 5, 0, 'online features'], ['pcache', 'Post cache', 'cache', 3, 1.3, 'posts, celeb recent'],
      ['fcache', 'Feed cache', 'cache', 4, 0.6, 'Redis lists of ids'], ['pdb', 'Post store', 'nosql', 4, 2.0, 'Cassandra'], ['graph', 'Social graph', 'graph', 6, 1.5, 'followers, following'],
      ['kafka', 'Post events', 'stream', 3, 2.9, 'Kafka'], ['fan', 'Fan-out workers', 'worker', 5, 2.9, 'push to followers']],
    edges: [['u', 'gw'], ['u', 'cdn'], ['cdn', 'blob'], ['u', 'blob', 'pre-signed PUT'], ['gw', 'feed'], ['gw', 'post'], ['feed', 'fcache'], ['feed', 'rank'], ['rank', 'feat'], ['feed', 'pcache'],
      ['feed', 'graph', 'celebs followed'], ['pcache', 'pdb', 'miss'], ['post', 'pdb'], ['post', 'kafka', '', 'async'], ['kafka', 'fan', '', 'async'], ['fan', 'graph'], ['fan', 'fcache', 'LPUSH id']]
  },
  flows: [
    { name: 'Publish a post (fan-out on write)', desc: 'A normal user with a few hundred followers posts a photo.', steps: [
      ['u', 'blob', 'PUT photo (pre-signed URL)', 'The app first uploads the image straight to object storage with a short-lived signed URL, so gigabytes of media never pass through the API tier.'],
      ['u', 'gw', 'POST /v1/posts (idempotent)', 'The post itself is tiny. The idempotency key means a retry on a flaky mobile network cannot create two posts.'],
      ['gw', 'post', 'create post', 'The gateway has authenticated the user and applied rate limits (spam protection).'],
      ['post', 'pdb', 'INSERT posts, user_posts', 'One write per table, quorum in the local region. The Snowflake id sorts by time, which later makes feed lists and cursors trivially ordered.'],
      ['post', 'kafka', 'post.created (key author_id)', 'Publishing an event instead of fanning out inline keeps the write fast and lets fan-out, search, notifications and moderation consume independently.', 'async'],
      ['post', 'u', '201 Created', 'The author sees the post at once (the app also inserts it locally into their own feed).', 'resp'],
      ['kafka', 'fan', 'consume event', 'A fan-out worker picks up the event. Partitioning by author keeps one author’s posts in order.', 'async'],
      ['fan', 'graph', 'followers page (5 k)', 'Followers are read in pages, skipping accounts inactive for 30+ days: their feeds are not cached and will be rebuilt on demand.'],
      ['fan', 'fcache', 'pipelined LPUSH + LTRIM 500', 'One pipelined batch per Redis shard pushes the post id onto each follower’s list and trims it to 500, so memory per user is bounded.']],
      end: 'The expensive work (one insert per follower) happens once at write time, so the far more frequent reads become a single list lookup.' },
    { name: 'Read the home feed (hybrid + ranking)', desc: 'Opening the app: merge pushed and pulled candidates, rank them, hydrate the top 20.', steps: [
      ['u', 'gw', 'GET /v1/feed', 'First page, no cursor.'], ['gw', 'feed', 'route', 'Any feed instance can serve any user: all state is in caches.'],
      ['feed', 'fcache', 'LRANGE feed:42 0 499', 'Pushed candidates: up to 500 post ids in under a millisecond.'],
      ['feed', 'graph', 'celebrities I follow', 'Cached list of the high-follower accounts this user follows (typically a few dozen). Their posts were never pushed.'],
      ['feed', 'pcache', 'celeb_recent for each', 'Pull side of the hybrid: read each celebrity’s recent post ids and merge them with the pushed ids, then drop blocked, muted, unfollowed and deleted ones.'],
      ['feed', 'rank', 'score ~600 candidates', 'A light model (GBDT or two-tower dot product) cuts ~600 to ~100; the heavy multi-task DNN predicts like, comment, share and hide probabilities for those 100.'],
      ['rank', 'feat', 'batch feature lookup', 'User, author and post features (affinity, post age, engagement velocity) come from the online feature store in one batched call.'],
      ['rank', 'feed', 'ordered ids + scores', 'Re-ranking applies diversity (no five posts in a row from one author), freshness and ad slots. The ranked list is cached for the session.', 'resp'],
      ['feed', 'pcache', 'MGET post:{ids} (top 20)', 'Hydrate only what will be shown: text, author name, counters, media URLs.'],
      ['feed', 'u', '200 OK + next_cursor', 'The cursor points into the cached ranked list, so the next page is a cheap slice, not a new ranking pass.', 'resp']],
      end: 'Push gives cheap reads for the 99% case, pull handles the few accounts that would make push explode, and ranking runs on a bounded candidate set.' },
    { name: 'Celebrity post (no fan-out)', desc: 'An account with 80 M followers posts. Pushing would mean 80 M Redis writes for one post.', steps: [
      ['u', 'gw', 'POST /v1/posts', 'Same write API as everybody else.'], ['gw', 'post', 'create post', 'Authenticated and rate limited.'],
      ['post', 'pdb', 'INSERT posts, user_posts', 'Stored exactly like a normal post.'],
      ['post', 'kafka', 'post.created', 'Event published.', 'async'], ['kafka', 'fan', 'consume event', 'The fan-out worker reads the event.', 'async'],
      ['fan', 'graph', 'follower_count = 80 M', 'Above the threshold (for example 100 k followers), the author is classed as a celebrity and fan-out is skipped.'],
      ['fan', 'pcache', 'LPUSH celeb_recent:7', 'Instead, one write adds the id to the author’s own recent list, which feed readers pull from.'],
      ['feed', 'pcache', 'readers pull at feed time', 'Each follower’s next feed load merges this post in. 80 M reads spread over hours, served from a replicated hot cache, are far cheaper than 80 M writes in seconds.', 'resp']],
      end: 'The hybrid bounds write amplification: no single post can create more than ~100 k fan-out writes.' },
    { name: 'Cold or lost feed cache', desc: 'A user returns after two months (no cached feed), or a Redis shard is being replaced.', steps: [
      ['u', 'gw', 'GET /v1/feed', 'Normal request.'], ['gw', 'feed', 'route', 'Routed to any instance.'],
      ['feed', 'fcache', 'LRANGE feed:42', 'Nothing there: the user was inactive so fan-out skipped them, or the shard just failed over and is warming.', 'err'],
      ['feed', 'graph', 'following list (~300)', 'Fall back to fan-out on read: who does this user follow?'],
      ['feed', 'pcache', 'recent ids per followee', 'Read each followee’s recent post ids (cache, then post store on miss), merge by time and keep the newest 500. This costs ~300 lookups instead of 1.'],
      ['pcache', 'pdb', 'miss: user_posts range scan', 'Cold authors come from Cassandra; per-request concurrency limits keep a mass cache loss from overloading the store.'],
      ['feed', 'fcache', 'write rebuilt feed (async)', 'Store the rebuilt list so the next load is fast again.', 'async'],
      ['feed', 'u', '200 OK (maybe chronological)', 'If ranking is slow or unavailable, return the merged list in time order rather than failing.', 'resp']],
      end: 'Feeds are derived data: any feed can be rebuilt from the graph and the author timelines, so a cache loss degrades latency, not correctness.' }
  ],
  components: [
    ['API gateway', 'Authentication, rate limiting, routing; protects write APIs from spam bursts.'],
    ['Post service', 'Validates and stores posts, issues time-sortable ids, publishes post.created events.'],
    ['Fan-out workers', 'Consume post events, page through followers, push ids into feed lists; skip celebrities and inactive users.'],
    ['Feed service', 'Reads the precomputed list, pulls celebrity posts, filters, calls ranking, hydrates and paginates with cursors.'],
    ['Ranking service', 'Candidate pruning, heavy ML scoring and re-ranking (diversity, freshness, ad slots); logs impressions for training.'],
    ['Social graph store', 'Follower and following adjacency lists, follower counts, block/mute lists.'],
    ['Caches', 'Feed lists, hydrated posts, celebrity recent lists, counters.'],
    ['Media pipeline + CDN', 'Resize/transcode uploads, moderation, serve immutable renditions from the edge.']
  ],
  evolutionTitle: 'From a SQL query to a hybrid ranked feed',
  evolution: [
    { name: '1. Pull with SQL', desc: 'Small app: compute the feed with one query at read time.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.5], ['app', 'App server', 'svc', 1.5, 0.5], ['db', 'SQL database', 'db', 3, 0.5, 'posts, follows']], edges: [['u', 'app'], ['app', 'db']] },
      steps: [['u', 'app', 'GET /feed', 'User opens the feed.'], ['app', 'db', 'JOIN follows + posts by time', 'SELECT posts WHERE author IN (my followees) ORDER BY created_at DESC LIMIT 20. Fine for thousands of users, terrible when people follow hundreds of accounts and millions read at once.'], ['db', 'app', 'rows', 'Each read does a scatter over many authors: read cost grows with followees.', 'resp']] },
    { name: '2. Push (fan-out on write)', desc: 'Precompute feeds into a cache when posts are written.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.5], ['app', 'App servers', 'svc', 1.3, 0.5], ['q', 'Queue', 'queue', 2.6, 1.5], ['w', 'Fan-out workers', 'worker', 3.9, 1.5], ['c', 'Feed cache', 'cache', 3.9, 0.3, 'Redis lists']], edges: [['u', 'app'], ['app', 'c'], ['app', 'q', '', 'async'], ['q', 'w', '', 'async'], ['w', 'c']] },
      steps: [['u', 'app', 'POST /posts', 'A post is written.'], ['app', 'q', 'enqueue fan-out', 'Fan-out is queued.', 'async'], ['q', 'w', 'deliver', 'Workers process it.', 'async'], ['w', 'c', 'push id to each follower', 'One insert per follower.'], ['app', 'c', 'GET feed = one LRANGE', 'Reads become constant time... until a celebrity with 50 M followers posts.']] },
    { name: '3. Hybrid + ranking', desc: 'Push for normal users, pull for celebrities, ML ranking over the merged candidates.', diagram: { nodes: [['u', 'Users', 'client', 0, 0.8], ['f', 'Feed service', 'svc', 1.3, 0.8], ['c', 'Feed cache', 'cache', 2.6, 0, 'pushed ids'], ['p', 'Celeb recent', 'cache', 2.6, 1.6, 'pulled ids'], ['r', 'Ranker', 'ml', 3.9, 0.8, 'ML models']], edges: [['u', 'f'], ['f', 'c'], ['f', 'p'], ['f', 'r']] },
      steps: [['u', 'f', 'GET /feed', 'Request.'], { par: [['f', 'c', 'pushed'], ['f', 'p', 'pulled']], msg: 'Fetch pushed candidates and celebrity posts in parallel.' }, ['f', 'r', 'rank ~600', 'Score and re-rank.'], ['r', 'f', 'top N', 'Ranked list for the session.', 'resp'], ['f', 'u', 'page 1 + cursor', 'Hydrated and returned.', 'resp']] }
  ],
  deep: [
    ['Fan-out on write vs on read, and the hybrid', '<p><strong>Fan-out on write (push)</strong> inserts the post id into every follower’s feed when the post is created. Reads are O(1), but write cost is proportional to follower count and is wasted on followers who never open the app. <strong>Fan-out on read (pull)</strong> stores nothing per follower and merges followees’ recent posts at read time: writes are O(1), reads are O(followees) and latency suffers.</p><table><tr><th></th><th>Push</th><th>Pull</th></tr><tr><td>Write cost</td><td>O(followers)</td><td>O(1)</td></tr><tr><td>Read cost</td><td>O(1)</td><td>O(followees)</td></tr><tr><td>Freshness</td><td>Seconds of lag</td><td>Instant</td></tr><tr><td>Bad case</td><td>Celebrity posts</td><td>Users following thousands</td></tr></table><p>The <strong>hybrid</strong> pushes for authors under a threshold (say 100 k followers) and pulls for the rest. Because a user follows only tens of celebrities, the pull side adds a few dozen cache reads per feed load. Two refinements: skip users inactive for 30+ days during push (rebuild on their return), and push celebrity posts only to their most engaged followers if freshness matters.</p>'],
    ['Feed cache design', '<p>Store <strong>ids, not posts</strong>: an 8-byte Snowflake id per entry keeps 500 entries at ~4-6 KB per user, and edits or deletes never require touching millions of feed copies. Hydration reads the current version from the post cache, which also applies deletions and privacy changes for free.</p><ul><li><code>LPUSH feed:{uid} {post_id}</code> then <code>LTRIM feed:{uid} 0 499</code>, pipelined per shard.</li><li>Shard by user id with Redis Cluster hash slots; one replica per shard; persistence optional (it is a rebuildable cache).</li><li>Because Snowflake ids are time-ordered, a list is already chronological; use a sorted set only if fan-out must insert out of order (for example, back-filled posts).</li><li>Unfollow is handled lazily: filter at read time against the following set, and let the trim push old entries out.</li></ul>'],
    ['Ranking pipeline', '<ol><li><strong>Candidate generation:</strong> pushed ids + pulled celebrity ids (+ optionally recommended unconnected content from a separate retrieval system), ~600 items.</li><li><strong>Light ranker:</strong> a cheap model (GBDT or two-tower embedding dot product) scores all candidates in ~5 ms and keeps ~100.</li><li><strong>Heavy ranker:</strong> a multi-task deep model predicts P(like), P(comment), P(share), P(hide), expected dwell time; a weighted sum gives the final score. Features come from the online feature store; the same feature definitions are used offline for training.</li><li><strong>Re-ranking:</strong> business rules after the model: author diversity, content-type mix, freshness boosts, integrity demotions, ad slot insertion.</li><li><strong>Logging:</strong> every impression with its features and later engagement is logged to train the next model (beware position bias).</li></ol><p>Budget: ~30-60 ms of the 150 ms p50. If the heavy ranker times out, fall back to the light ranker order, then to chronological.</p>'],
    ['Cursor pagination on a moving feed', '<p>Offset pagination (<code>?page=3</code>) breaks on a feed: new posts arriving at the top shift everything, so users see duplicates or miss posts. Instead the first request ranks once and stores the ordered list under a <strong>feed session id</strong> (Redis, TTL ~30 min). The opaque cursor is <code>base64({session_id, position})</code>, so page N is a slice of the same snapshot. When the session expires, or for chronological feeds, the cursor carries the last seen <code>post_id</code> and the next page is "ids &lt; post_id". New posts are surfaced separately via the "new posts" pill, which counts ids in <code>feed:{uid}</code> newer than the head the client holds.</p>'],
    ['Media', '<p>Uploads use pre-signed URLs straight to object storage. A storage event triggers a pipeline that strips metadata (EXIF location), runs moderation, and produces renditions (for example 320, 640, 1080 px WebP/AVIF; short video as HLS). Keys contain the content hash, so they are immutable and the CDN can cache them for a year. The feed response contains only URLs; images never touch the feed service.</p>']
  ],
  scale: [
    '<strong>Fan-out spikes:</strong> a burst of posts from accounts just below the celebrity threshold, or a live event, creates Kafka lag. Workers autoscale on consumer lag, high-priority (very active) followers are pushed first, and inactive users are skipped.',
    '<strong>Feed cache memory</strong> is the biggest cost: cap list length, cache only 30-day active users, and store 8-byte ids. Adding shards is online with Redis Cluster slot migration.',
    '<strong>Hot posts:</strong> a viral post is hydrated millions of times a second. Replicate hot keys to all post-cache replicas or keep a small in-process cache (1-5 s TTL) in the feed service; use sharded counters for likes.',
    '<strong>Ranking cost</strong> grows with candidates &times; model size: prune with the light ranker, cache ranked sessions so only the first page is ranked, and batch GPU inference.',
    '<strong>Multi-region:</strong> users are homed to a region; posts replicate globally via the event stream and fan-out runs in each region for its local followers, so a read never crosses an ocean.'
  ],
  tradeoffs: [
    ['Fan-out model', 'Push vs pull vs hybrid', 'Hybrid: push for the 99.9% of authors with modest audiences, pull for celebrities. Pure push melts on celebrities; pure pull makes every read expensive.'],
    ['What the feed stores', 'Post ids vs full post copies', 'Ids: 100&times; less memory, and edits/deletes apply instantly at hydration. The cost is a second (batched) lookup per page.'],
    ['Ordering', 'Chronological vs ranked', 'Ranked by default for engagement, with a chronological "Following" view as an option and as the degraded mode. Ranking needs logging, feature stores and careful experiments.'],
    ['Consistency', 'Synchronous vs asynchronous fan-out', 'Async via Kafka: post creation stays fast and fan-out can lag a few seconds under load without hurting the author.'],
    ['Inactive users', 'Push to everyone vs skip inactive', 'Skip users inactive for 30 days and rebuild their feed on return: saves a large share of writes and cache memory for a one-off slower first load.']
  ],
  failures: [
    ['Redis feed shard fails', 'Replica promoted in seconds; during warm-up, feeds for that shard are rebuilt via fan-out on read with concurrency limits.'],
    ['Fan-out backlog (Kafka lag)', 'Autoscale workers; prioritise active followers; posts still appear on author profiles and via pull; alert on lag &gt; 30 s.'],
    ['Ranking service slow or down', 'Timeout of ~80 ms, fall back to the light ranker, then chronological order; never fail the feed because ranking failed.'],
    ['Post store region outage', 'Multi-region replication; reads served from cache and other regions; writes queued or routed to a healthy region.'],
    ['Thundering herd after a celebrity post', 'Celebrity recent lists replicated on many cache replicas; request coalescing for misses; short local caching in feed instances.'],
    ['Deleted or blocked content still in feeds', 'Filtering at hydration time (deleted flag, block lists) so stale ids in cached feeds are never shown.']
  ],
  cloud: [['DNS', 'dns'], ['CDN for media', 'cdn'], ['API gateway', 'apigw'], ['Feed, post and fan-out services', 'k8s'], ['Feed and post caches', 'cache'], ['Posts and timelines', 'widecol'], ['Posts (managed alternative)', 'nosql'], ['Social graph', 'graph'], ['Post events', 'stream'], ['Media storage', 'blob'], ['Media processing', 'functions'], ['Ranking models', 'ml'], ['Ranking features', 'featurestore'], ['GPU inference', 'gpu'], ['Identity', 'identity'], ['Monitoring', 'monitor']],
  refs: { az: ['azEventDriven', 'azp-publisher-subscriber', 'azp-materialized-view', 'azCaching', 'azPartition', 'azp-valet-key', 'azCdn', 'azAksMicro'],
          aws: ['awsPubSub', 'awsCaching', 'blCaching', 'awsDdbBest', 'awsMlLens', 'blBacklog', 'awsDiagrams'] },
  questions: [
    ['How do you pick the celebrity threshold?', 'Make it a tunable, measured on cost: the threshold is where fan-out write cost (followers &times; insert cost, wasted on inactive followers) exceeds the extra read cost for all followers pulling (feed loads per follower &times; one cache read). In practice tens to hundreds of thousands of followers. Some systems use active follower count, not total.'],
    ['What happens when someone unfollows?', 'Update both graph edges immediately. Do not scan the feed list; filter at read time against the following set (cached as a Redis set or Bloom filter) and let old entries fall off the capped list. Optionally a background job removes them.'],
    ['How do edits and deletes propagate to millions of feeds?', 'They do not need to: feeds hold only ids. Hydration reads the current post, and a deleted flag (tombstone) makes the feed service skip it. CDN media for deleted posts is purged by key.'],
    ['How would you show posts in near real time?', 'Fan-out already lands in Redis within seconds. The app polls the cheap /feed/new endpoint on foreground, or a WebSocket/SSE channel pushes a "new posts" hint (not the posts) so the client can refresh when the user scrolls to the top.'],
    ['How do you evaluate a ranking change?', 'Offline replay on logged impressions (AUC/NDCG on held-out data), then an online A/B test on a few percent of users measuring sessions, time spent, meaningful interactions and negative feedback (hides, reports) over at least a week to catch novelty effects.'],
    ['Why not store feeds in Cassandra instead of Redis?', 'You can (it is cheaper per GB and durable), but a feed read becomes a disk-backed partition read of several ms with tail latency. Many systems keep Redis for active users and fall back to a persistent store or rebuild for others.']
  ],
  related: ['recommendation', 'notification', 'unique-id', 'chat', 'caching']
});

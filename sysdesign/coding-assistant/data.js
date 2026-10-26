SD.renderCase({
  slug: 'coding-assistant',
  summary: 'An AI coding assistant is three products with very different budgets sharing one platform. <strong>Inline completions</strong> (“ghost text”) must appear in under ~300 ms while the developer types, so they use a small, fast fill-in-the-middle (FIM) model close to the user, aggressive debouncing, cancellation and caching, and context assembled on the client from the open file and neighbouring tabs. <strong>Chat</strong> answers questions about the codebase in a few seconds using a frontier model and repository retrieval (embeddings index, keyword search and a symbol graph). <strong>Agent mode</strong> plans and makes multi-file edits, runs the build and tests in a sandbox, iterates, and opens a pull request for human review over minutes. Around them sit the concerns that decide enterprise adoption: no training on customer code, content exclusion, secret filtering, public-code matching, auditability, and honest metrics such as acceptance rate and retained code.',
  examples: 'GitHub Copilot (completions, chat, agent mode and the cloud coding agent), Cursor (Tab model, codebase indexing, agent), Windsurf, JetBrains AI Assistant and Junie, Amazon Q Developer, Gemini Code Assist, Sourcegraph Cody, Tabnine, Claude Code and OpenAI Codex.',
  functional: ['Inline multi-line completions in the editor as the user types, accepted with Tab (full or word by word).', 'Chat about the code: explain, find where something happens, generate tests, with references to files and lines.', 'Agent mode: given a task, edit several files, run commands (build, tests, linters) in a sandbox, iterate until green, then show a diff or open a draft pull request.', 'Repository context: local open files, a semantic index of the repository, symbol definitions and references.', 'Admin controls: content exclusion paths, model choice, public-code filter, data retention, audit logs, usage reports.', 'Works across IDEs (VS Code, JetBrains, Visual Studio, Neovim) through a shared language-server-style agent.'],
  nonFunctional: ['Completions: p50 &le; 250 ms and p95 &le; 500 ms from request to first visible suggestion; stale results never shown.', 'Chat: first token &le; 2 s; agent tasks typically 2-15 minutes.', 'No customer code used for training (business tiers); prompts not retained after the response for completions; content-excluded files never leave the machine.', 'Scale: 1 M daily developers, peak ~14,000 completion requests/s worldwide.', '99.9% availability; completions degrade silently (no suggestion) rather than showing errors.', 'Cost per developer per month well below the subscription price.'],
  outOfScope: ['Training the code models.', 'Full code review and CI products.', 'General-purpose agent platforms (see <a href="../agentic-ai/index.html">AI agent with tools</a>).'],
  estimates: [
    ['Daily active developers', '1 M', 'Across time zones'],
    ['Completion requests per developer', '~400 per day', 'After debouncing; ~40% are cancelled because the user kept typing'],
    ['Completion QPS', '~4,600 avg, ~14,000 peak', '1 M &times; 400 / 86,400; &times;3 for overlapping working hours'],
    ['Completion prompt / output', '~1,500 tokens in, ~30 out', 'Prefix + suffix + 2-3 neighbouring snippets; one line to a short block'],
    ['Prefill load at peak', '~21 M tok/s, ~6.3 M after cache', '14,000 &times; 1,500; ~70% of prompt tokens reuse the KV cache of the same user’s previous keystroke request'],
    ['Completion GPUs', '~350 H100 at peak', '~7 B FIM model in FP8: prefill ~35 k tok/s per GPU &rArr; 6.3 M / 35 k &asymp; 180 GPUs; decode 420 k tok/s at ~12 k tok/s per GPU &asymp; 35; ~215 busy, at 60% utilisation &asymp; 350'],
    ['Chat', '20 M messages/day, ~700/s peak', '20 per developer; ~8,000 tokens in, 500 out on a frontier model &asymp; $0.03 each'],
    ['Agent tasks', '500 k/day, ~$0.66 each', '0.5 per developer; ~25 steps &times; ~25 k input tokens (90% from prompt cache) + 800 output per step on a $3/$15 per M model'],
    ['Agent sandboxes', '~5,000 concurrent at peak', '250 k cloud runs/day &times; ~10 min = ~1,740 concurrent on average, &times;3 at peak'],
    ['Repository index', '500 k repos, ~2 B chunks', '~4,000 chunks per repo (2,000 files &times; ~2 chunks); 768-d int8 &asymp; 1.5 TB of vectors, mostly cold on object storage']
  ],
  compute: [
    ['Completion model fleet', '~350 H100 across 4+ regions at peak', 'See estimates: prefill dominates. Session affinity keeps a developer on the same replica so each keystroke reuses the previous prompt’s KV (prefix cache), which cuts prefill by ~70%. Regions near developers keep network RTT under ~50 ms.'],
    ['Completion service (CPU)', '~100 &times; 4 vCPU across regions', '14,000 req/s &times; ~15 ms CPU (prompt assembly, tokenisation, post-filters such as public-code matching and bracket balancing) = 210 busy cores; at 60% utilisation &asymp; 350 cores &rArr; ~88 instances of 4 vCPU, ~100 with one spare per region.'],
    ['Chat and agent models', 'Hosted frontier models via the AI gateway', 'Chat ~700/s &times; 8,500 tokens &asymp; 357 M tokens/min at peak, plus agents: provisioned throughput in several regions with pay-as-you-go spillover through the <a href="../llm-gateway/index.html">AI gateway</a>.'],
    ['Agent sandboxes', '~5,000 micro-VMs at peak (2-4 vCPU, 8 GB)', 'Firecracker / Kata / Hyper-V isolated; warm pools per common image (Node, Python, Java, .NET) so a sandbox with the repo cloned and dependencies cached starts in &lt; 10 s.'],
    ['Repository indexer', 'Event-driven workers + embedding model', 'Only changed files are re-chunked and re-embedded (Merkle tree of file hashes). 500 k repos &times; ~2% of chunks changing per day &asymp; 40 M chunks/day &times; 400 tokens = 16 B tokens/day of embeddings on a small embedding model.']
  ],
  api: [
    ['POST /v1/completions/inline  (SSE)', '{requestId, language, prefix, suffix, snippets[], pathHash, cursor, maxTokens}. Streams the first line early; the client aborts the HTTP/2 stream on the next keystroke and the server stops generation immediately.'],
    ['POST /v1/chat  (SSE)', '{messages, references [{file, range}], repoId, mode}. Server-side retrieval adds repository context; answers carry file/line references.'],
    ['POST /v1/agent/tasks', '{repo, branch, instruction, runIn: local|cloud} &rarr; {taskId}; events: plan, edit (diff), command (needs approval?), test_result, pr_opened.'],
    ['POST /v1/index/{repoId}/sync', '{merkleRoot, changed [{chunkHash, text}]}: the client or the Git webhook uploads only changed chunks; paths are obfuscated.'],
    ['GET /v1/policy', 'Org policy: content exclusion globs, allowed models, public-code filter on/off, telemetry level. Cached by the client.'],
    ['POST /v1/telemetry', '{suggestionId, shown, accepted, acceptedChars, retainedChars@30s/5min, latencyMs}: no code content, used for acceptance metrics.']
  ],
  data: [
    ['repo index', 'Vector + keyword store, one namespace per repo (object-storage backed)', 'chunkHash, obfuscated path, language, symbols[], embedding (768-d int8), commit; cold repos live on object storage and load on demand.'],
    ['symbol graph', 'Key-value / graph store per repo and commit', 'Definitions, references, call edges from SCIP/LSIF or tree-sitter; key (repoId, commit, symbol).'],
    ['org policy and seats', 'Relational DB', 'orgId, seats, models allowed, exclusion rules, retention, audit settings; cached at the edge.'],
    ['completion cache', 'Client LRU + Redis per user (TTL minutes)', 'hash(prefix tail + suffix head + model) &rarr; completion; handles undo/redo and re-typing.'],
    ['agent tasks', 'Document DB, partition taskId', 'plan, steps, commands, diffs, test results, cost, PR link; logs in object storage.'],
    ['telemetry', 'Event stream &rarr; warehouse', 'suggestion events with model version, language, latency, accepted and retained characters; no code text.']
  ],
  dbChoice: [
    ['Repository embeddings', 'Namespaced vector store on object storage (per-repo indexes)', 'Millions of small indexes, most idle; per-repo isolation makes access control and deletion simple; hot repos cached in memory.', 'One giant shared ANN index: hard to delete per customer, permission filters on billions of vectors.'],
    ['Symbol graph', 'Key-value / graph store keyed by repo + commit', 'Exact lookups (“definition of RetryPolicy”) are cheaper and more precise than embeddings.', 'Language servers only on the client: precise but unavailable to cloud agents.'],
    ['Telemetry', 'Streaming + columnar warehouse', 'Billions of small events a day, aggregated for acceptance-rate dashboards and A/B tests.', 'Relational DB: cannot keep up.']
  ],
  diagram: {
    nodes: [['ide', 'IDE extension', 'client', 0, 1.2, 'debounce, cancel, cache'], ['pol', 'Org policy', 'db', 1, 0, 'exclusions, models'], ['tel', 'Telemetry', 'stream', 1, 2.6, 'accept, retain'],
      ['edge', 'Edge proxy', 'edge', 1, 1.2, 'nearest region'], ['cg', 'Completions svc', 'svc', 2, 0.2, 'FIM prompt, filters'], ['fim', 'FIM code model', 'gpu', 3, 0.2, 'small, fast'],
      ['chat', 'Chat + agent API', 'svc', 2, 1.3, 'context, routing'], ['llm', 'Frontier models', 'llm', 4, 1.3, 'via AI gateway'], ['ret', 'Repo index', 'vector', 3, 2.3, 'embeddings + symbols'],
      ['ag', 'Agent runner', 'agent', 2, 2.6, 'plan, edit, test'], ['sbx', 'Sandbox VM', 'fn', 3, 3.4, 'tests, no secrets'], ['git', 'Git host', 'ext', 4, 3.4, 'branch, draft PR'], ['idx', 'Indexer', 'worker', 4, 2.3, 'changed chunks']],
    edges: [['ide', 'edge'], ['ide', 'pol'], ['ide', 'tel', '', 'async'], ['edge', 'cg'], ['edge', 'chat'], ['cg', 'fim'], ['chat', 'llm'], ['chat', 'ret'], ['chat', 'ag'], ['ag', 'sbx'], ['sbx', 'git'],
      ['git', 'idx', 'push webhook', 'async'], ['idx', 'ret']]
  },
  flows: [
    { name: 'Inline completion', desc: 'The developer pauses typing inside a function; a suggestion appears in ~220 ms.', steps: [
      ['ide', 'pol', 'policy (cached)', 'The extension already holds the org policy: this file is not excluded, the public-code filter is on.'],
      ['ide', 'edge', 'POST inline (FIM)', 'After a ~75 ms debounce the client builds the prompt locally: 1,200 tokens of prefix, 300 of suffix, and the 3 most similar snippets from open tabs (Jaccard similarity on sliding windows). Secrets are redacted. A persistent HTTP/2 connection avoids TLS setup.'],
      ['edge', 'cg', 'route (session affinity)', 'The edge sends the developer to the same nearby region and service instance as their previous request.'],
      ['cg', 'fim', 'prefill 1,500, mostly cached', 'The replica still holds the KV cache of the previous keystroke’s prompt, so only the new characters need prefill (~20 ms).'],
      ['fim', 'cg', 'first line after ~110 ms', 'The small model writes the middle; the stream stops at the end of the logical block or the token limit.', 'resp'],
      ['cg', 'edge', 'filtered suggestion', 'Post-processing: trim to balanced brackets, drop text that duplicates the suffix, block matches with public code longer than ~150 characters when the filter is on.', 'resp'],
      ['edge', 'ide', 'ghost text (~220 ms)', 'The suggestion is shown only if the cursor and prefix are unchanged; otherwise it is discarded silently.', 'resp'],
      ['ide', 'tel', 'shown, accepted 41 chars', 'Telemetry records acceptance and, later, how much of the accepted code survives after 30 s and 5 min. No code content is sent.', 'async']],
      end: 'Client-side context, a small model, KV reuse and proximity make sub-300 ms suggestions possible.' },
    { name: 'Typing cancels', desc: 'The developer keeps typing while a request is in flight.', steps: [
      ['ide', 'edge', 'POST inline (req 1)', 'A request goes out after the debounce.'],
      ['ide', 'edge', 'abort req 1 (RST_STREAM)', 'Two more characters are typed. The client cancels the stream; most requests are cancelled like this.', 'err'],
      ['edge', 'cg', 'cancel', 'The cancellation propagates immediately.'],
      ['cg', 'fim', 'abort sequence', 'The engine frees the sequence’s batch slot at the next step; without this, ~40% of GPU time would be spent on suggestions nobody sees.'],
      ['ide', 'edge', 'POST inline (req 2)', 'A new request with the updated prefix. If the typed characters had matched the pending suggestion (“typing through”), the client would have kept showing it and sent nothing.'],
      ['edge', 'ide', 'suggestion for req 2', 'Only the latest request’s result can be displayed.', 'resp']],
      end: 'Debounce, cancellation and typing-through save more GPU capacity than any model optimisation.' },
    { name: 'Chat with repo context', desc: '“Where do we retry failed payment webhooks, and why does it give up after 3 tries?”', steps: [
      ['ide', 'edge', 'POST chat + open file', 'The request includes the current selection and file; excluded paths are never attached.'],
      ['edge', 'chat', 'forward', 'Chat runs in the region of the org’s data residency.'],
      ['chat', 'ret', 'hybrid code search', 'Three retrievers in parallel: embeddings over chunks, keyword search for identifiers (“webhook”, “retry”), and symbol graph lookups for definitions and callers of matching functions.'],
      ['ret', 'chat', '12 ranked snippets', 'Results are reranked and packed into a ~10 k-token budget, whole functions rather than arbitrary windows.', 'resp'],
      ['chat', 'llm', 'frontier model, 12 k tokens', 'A strong model reasons over the snippets; the system prompt says to cite files and lines.'],
      ['llm', 'chat', 'answer with file:line links', 'The answer points to RetryPolicy.cs:42 and explains the max-attempts setting.', 'resp'],
      ['chat', 'ide', 'stream answer', 'References are clickable; first token in ~1.5 s.', 'resp']],
      end: 'Code retrieval combines semantics, exact identifiers and structure; the symbol graph is what makes answers precise.' },
    { name: 'Agent mode in a sandbox', desc: '“Add rate limiting to the public API and tests for it.”', steps: [
      ['ide', 'edge', 'agent task', 'The developer starts an agent task on a branch.'],
      ['chat', 'ag', 'create task (budget)', 'The task gets a step, time and cost budget and a sandbox profile.'],
      ['ag', 'ret', 'gather context', 'The agent searches the repository for the HTTP pipeline, existing middleware and tests.'],
      ['ag', 'llm', 'plan + multi-file edits', 'The model proposes a plan and diffs to 4 files.'],
      ['ag', 'sbx', 'apply edits, run tests', 'The sandbox has the repo, cached dependencies and no production secrets; egress is limited to package registries; commands outside an allow-list need the developer’s approval.'],
      ['sbx', 'ag', '2 tests fail', 'Test output is fed back as an observation (truncated).', 'err'],
      ['ag', 'llm', 'fix from test output', 'The model corrects an off-by-one in the window logic.'],
      ['ag', 'sbx', 're-run: green', 'All tests pass, linters clean.'],
      ['sbx', 'git', 'push branch, draft PR', 'The agent can only push to its own branch and open a draft PR; branch protection and human review gate the merge.'],
      ['ag', 'ide', 'diff + summary for review', '~18 steps, ~$0.60. The developer reviews like any other PR.', 'resp']],
      end: 'Agents are safe to use when they work in a disposable sandbox and every change goes through normal review.' },
    { name: 'Overload (failure)', desc: 'A region’s completion GPUs saturate during the European morning.', steps: [
      ['cg', 'fim', 'queue wait rising', 'Waiting time would push suggestions past the 500 ms deadline.', 'err'],
      ['cg', 'edge', 'shed: 503 + region hint', 'Completions are optional: the service drops requests that cannot meet the deadline instead of queueing them.', 'err'],
      ['edge', 'cg', 'retry in next region', 'For the next requests the edge prefers a neighbouring region with spare capacity (~30 ms more RTT, prefix cache cold for a few keystrokes).'],
      ['cg', 'fim', 'trim context to 800 tokens', 'Under pressure the service also shrinks the prompt budget, trading a little quality for capacity.'],
      ['edge', 'ide', 'no suggestion, no error', 'The developer simply sees fewer suggestions for a minute; nothing breaks.', 'resp']],
      end: 'For latency-critical, optional features, drop rather than queue, and degrade quality before availability.' }
  ],
  components: [
    ['IDE extension / language agent', 'Debounce, cancellation, client cache, context assembly from open files and tabs, content exclusion and secret redaction before anything leaves the machine, rendering and telemetry.'],
    ['Edge proxy', 'Nearest-region routing with session affinity, persistent HTTP/2 connections, auth, policy distribution.'],
    ['Completions service', 'FIM prompt construction, model call with deadlines, post-filters (brackets, suffix overlap, public-code match), load shedding.'],
    ['FIM model fleet', 'Small code models (a few B parameters) optimised for latency: FP8, prefix caching, speculative decoding, regional GPUs.'],
    ['Chat and agent API', 'Retrieval over repo index and symbol graph, model routing through the AI gateway, agent task orchestration.'],
    ['Repo indexer', 'Merkle-tree diffing, chunking along syntax (tree-sitter), embeddings, symbol extraction, per-repo namespaces.'],
    ['Agent runner + sandboxes', 'Plan-edit-test loop, isolated micro-VMs with cached toolchains, command approval, branch and PR integration.']
  ],
  deep: [
    ['The 300 ms completion budget', '<table><tr><th>Stage</th><th>Typical</th><th>How</th></tr><tr><td>Debounce after last keystroke</td><td>50-100 ms</td><td>Not counted against latency, but delays the request; adaptive by typing speed</td></tr><tr><td>Context assembly (client)</td><td>5-15 ms</td><td>Open file, neighbouring tabs, imports; no network</td></tr><tr><td>Network to region</td><td>20-50 ms</td><td>Edge POPs, persistent HTTP/2, regional GPUs</td></tr><tr><td>Service + queueing</td><td>5-20 ms</td><td>Deadlines, shed instead of queue</td></tr><tr><td>Prefill</td><td>20-40 ms</td><td>Small model, KV reuse from the previous keystroke</td></tr><tr><td>Decode first line (~12 tokens)</td><td>60-90 ms</td><td>~5-7 ms per token; speculative decoding</td></tr><tr><td>Post-filter + render</td><td>10-20 ms</td><td>Bracket balancing, public-code check</td></tr><tr><td><strong>Total</strong></td><td><strong>~150-250 ms</strong></td><td></td></tr></table><p>The model is small (a few billion parameters, often distilled and fine-tuned on FIM and on accept/reject data) because every 10 ms counts and the volume is enormous. Caching works at several levels: client LRU (undo, re-typing), “typing through” a visible suggestion, server-side prefix KV cache, and session affinity so the KV is still there.</p>'],
    ['Fill-in-the-middle and post-processing', '<p>Code models are trained with a FIM objective: documents are split into prefix, middle and suffix and rearranged with sentinel tokens so the model learns to generate the middle given both sides:</p><pre><code>&lt;fim_prefix&gt;def total(items):\n    result = 0\n    &lt;fim_suffix&gt;\n    return result&lt;fim_middle&gt;</code></pre><p>The model produces the loop body (<code>for item in items: result += item.price</code>). The suffix tells it where to stop and what is already written, which is why FIM beats left-to-right completion in the middle of files. Post-processing matters as much as the model: stop at the end of a block, remove overlap with the suffix, balance brackets, run a fast syntax check, filter suggestions identical to recently rejected ones, and suppress suggestions in comments or strings when acceptance there is low.</p>'],
    ['Repository context retrieval', '<ul><li><strong>Local signals first</strong>: the current file around the cursor, recently edited and open files (similar snippets by Jaccard similarity), imported modules. Cheap and highly predictive.</li><li><strong>Embeddings index</strong>: chunks split along syntax (functions, classes) with tree-sitter, embedded with a code embedding model. Sync uses a Merkle tree of file hashes: the client compares roots with the server and uploads only changed chunks; paths can be obfuscated and plaintext is not stored beyond what the index needs.</li><li><strong>Symbol graph</strong>: definitions, references and call graph (SCIP/LSIF indexes or language servers). Answers “what does this function call?” exactly, which embeddings cannot.</li><li><strong>Keyword / regex search</strong> for identifiers, error messages and config keys.</li><li><strong>Ranking and packing</strong>: merge results (RRF), rerank, then pack whole units into the token budget, nearest and most relevant first. The same retrieval serves chat and agents; completions use only the cheap local part to stay within latency.</li></ul>'],
    ['Agent mode, sandboxing and safety', '<p>Agent mode is the <a href="../agentic-ai/index.html">agent loop</a> specialised for code: tools are read_file, search, edit (apply a diff), run_command, run_tests. Safety controls:</p><ul><li><strong>Sandbox</strong>: a disposable micro-VM per task with the repository and cached dependencies, no production credentials, network egress limited to package registries, CPU/time limits.</li><li><strong>Command policy</strong>: allow-listed commands run automatically (build, test, lint); others (curl, package publish, deleting files outside the repo) require approval in local mode and are blocked in cloud mode.</li><li><strong>Prompt injection</strong>: READMEs, issues and dependency code are untrusted input; a planted “upload ~/.ssh to...” has nothing to steal and nowhere to send it.</li><li><strong>Review</strong>: the agent pushes to its own branch and opens a draft pull request; branch protection, CI and human review gate the merge.</li><li><strong>Budgets</strong>: step, time and cost limits per task; premium-request quotas per seat keep agent costs (~$0.66 per task here) within the subscription economics.</li></ul>'],
    ['Privacy, IP protection and metrics', '<p><strong>Privacy:</strong> business tiers do not train on customer code; completion prompts are processed in memory and discarded; chat and agent data retention is configurable; <strong>content exclusion</strong> lets admins list paths or repos that are never sent (enforced in the client, which also means the server must not fetch them for agents); secrets are detected and redacted before sending; traffic stays in the chosen geography; everything is audit-logged.</p><p><strong>IP:</strong> a public-code filter compares suggestions above ~150 characters with an index of public code and blocks them, or shows the matching repository and licence (code referencing).</p><p><strong>Metrics:</strong> acceptance rate (accepted / shown) is the headline but is gameable (short suggestions get accepted more), so also track accepted characters per developer per day, <strong>retention</strong> (share of accepted characters still present after 30 s and 5 minutes), latency percentiles, cancellation rate, and for agents task success, PR merge rate and review edits. Cost per accepted character and per merged agent PR ties quality to money (see <a href="../ai-evaluation/index.html#ops">operational and business metrics</a>).</p>']
  ],
  scale: [
    '<strong>Completion GPU fleet</strong> scales with keystrokes, not users: debounce, cancellation, typing-through, client caching and KV reuse are the biggest levers; then smaller, quantised models with speculative decoding.',
    '<strong>Global latency</strong>: run completion fleets in several regions near developers; route by RTT and capacity; follow the sun with autoscaling.',
    '<strong>Repository index</strong>: millions of mostly idle per-repo indexes belong on object-storage-backed vector stores with hot caching; re-index incrementally from pushes.',
    '<strong>Agent sandboxes</strong> are the new heavy workload: warm pools per toolchain, dependency caches, scale on queued tasks, hard time limits.',
    '<strong>Frontier model quota</strong> for chat and agents: provisioned throughput plus spillover through the gateway; per-seat premium request quotas.'
  ],
  tradeoffs: [
    ['Completion model size', 'Tiny (1-3 B) vs small (7-15 B) vs frontier', 'Small, distilled FIM model: latency and cost rule; quality gains come from context and post-processing more than size. Frontier models for chat and agents.'],
    ['Where context is built', 'Client vs server', 'Client for completions (fast, respects exclusions, no upload of whole repos); server-side index for chat and agents that need the whole repository.'],
    ['Local vs remote index', 'Index on the developer machine vs cloud index', 'Remote per-repo index shared by the team (fast, works for cloud agents) with obfuscated paths; local index for air-gapped or strict customers.'],
    ['Agent run location', 'In the IDE on the developer’s machine vs cloud sandbox', 'Local for interactive pair-programming with approvals; cloud for background tasks that end in a PR. Cloud is safer (isolated) but needs reproducible environments.'],
    ['Public-code filter', 'Block vs show references vs off', 'Block by default for enterprises worried about licences; references mode for teams that want the suggestion with attribution.']
  ],
  failures: [
    ['Completion latency spikes', 'Deadlines with drop-not-queue, regional failover, context trimming, autoscaling ahead of the morning peak.'],
    ['Stale suggestion shown', 'Client checks the request id and prefix before rendering; cancelled requests are discarded.'],
    ['Excluded file or secret sent', 'Client-side enforcement with tests, server-side secret scanning as a second layer, audit logs.'],
    ['Agent damages the repo or leaks data', 'Sandbox without secrets, egress allow-list, own branch only, draft PR, branch protection, budgets.'],
    ['Index out of date', 'Push webhooks and Merkle-tree sync; answers cite the indexed commit; fall back to live grep for recent changes.'],
    ['Model regression after update', 'Offline FIM and agent benchmarks, then A/B on acceptance and retention with automatic rollback.'],
    ['Frontier model outage', 'Gateway failover across regions and providers; completions unaffected because they run on their own fleet.']
  ],
  evals: [
    ['Acceptance rate', 'Accepted / shown suggestions, by language and model version', '&ge; 30%; A/B every model and prompt change'],
    ['Retained code', 'Share of accepted characters still present after 30 s and 5 min', '&ge; 85% at 30 s, &ge; 70% at 5 min'],
    ['Completion latency', 'Request to visible suggestion', 'p50 &le; 250 ms, p95 &le; 500 ms; cancellation-adjusted'],
    ['Offline FIM quality', 'Exact match and unit-test pass rate on held-out infilling tasks from real repositories', 'No regression &gt; 1 point; pass@1 tracked per language'],
    ['Agent task success', 'Internal suite of real issues with hidden tests (SWE-bench-style), plus PR merge rate', '&ge; 60% resolved on the suite; &ge; 50% of agent PRs merged with minor edits'],
    ['Retrieval quality for chat', 'Recall@10 of the files a human would need, on labelled questions', '&ge; 0.8'],
    ['Safety and privacy', 'Secret leakage, exclusion violations, injection success in agent mode, public-code matches shown with filter on', '0 exclusion violations; injection success &le; 1%; public-code blocks &ge; 99%'],
    ['Cost', 'GPU cost per accepted suggestion; model cost per agent task and per merged PR', '&le; $0.66 per agent task; completion cost per developer &lt; 10% of seat price'],
    ['Developer outcome', 'Time to complete benchmark tasks, satisfaction surveys', '&ge; 20% faster on controlled tasks; satisfaction &ge; 4/5']
  ],
  cloud: [['Frontier models for chat and agents', 'llm'], ['Completion model GPUs', 'gpu'], ['GPU clusters', 'k8s'], ['AI gateway', 'aigw'], ['Global edge routing', 'globallb'], ['Repository vector index', 'vector'], ['Code keyword search', 'search'],
    ['Agent sandboxes', 'Azure Container Apps dynamic sessions / AKS with Kata', 'Firecracker micro-VMs on EC2 / AgentCore Code Interpreter'], ['Agent task state', 'nosql'], ['Completion cache', 'cache'], ['Telemetry stream', 'stream'], ['Usage analytics', 'warehouse'],
    ['Secret scanning / content safety', 'guardrails'], ['Org identity and SSO', 'workforce'], ['Secrets', 'secrets'], ['Monitoring', 'monitor']],
  refs: { az: ['azGenGw', 'azAgents', 'azEvalAgent', 'azRagRetrieval', 'azMultitenant', 'azAksBaseline', 'azp-deployment-stamp', 'azp-gateway-routing'],
          aws: ['awsGenAiLens', 'awsAgentic', 'awsSaasLens', 'blShedding', 'blShuffle', 'awsMlLens'] },
  questions: [
    ['How do you get completions under 300 ms?', 'Build context on the client with no network calls, use a small FIM model on regional GPUs, keep the user on the same replica so the previous keystroke’s KV cache is reused, stream the first line, debounce and cancel aggressively, cache on the client, and drop requests that cannot meet the deadline instead of queueing them.'],
    ['Why fill-in-the-middle instead of normal completion?', 'Developers edit in the middle of files. The code after the cursor constrains what should be written (a return statement that uses a variable, a closing brace), so a model trained to condition on both prefix and suffix produces more correct and better-terminated suggestions.'],
    ['What context matters most for completions?', 'The current file near the cursor, then similar code in recently opened or edited files, then imported symbols’ definitions. A repository-wide embedding search is usually too slow for inline completions but essential for chat and agents.'],
    ['How do you keep customer code private?', 'No training on business customer code; in-memory processing and zero retention for completions; content exclusion enforced in the client; secret redaction; regional processing; obfuscated paths and minimal storage for indexes; audit logs and contractual guarantees.'],
    ['Is acceptance rate a good metric?', 'It is a useful headline but easy to game with short, obvious suggestions. Pair it with accepted characters per developer, retention of accepted code after minutes, latency, and controlled task-time studies; for agents, use merged PRs and review effort.'],
    ['How do you make agent mode safe?', 'Disposable sandbox with no secrets and restricted egress, command allow-lists with approvals, treat repository content as untrusted, restrict pushes to the agent’s own branch, require draft PRs and normal code review, and enforce budgets.']
  ],
  related: ['agentic-ai', 'llm-serving', 'semantic-search', 'llm-gateway', 'rag-assistant']
});

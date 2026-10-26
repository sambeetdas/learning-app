SD.renderCase({
  slug: 'multi-agent',
  summary: 'A multi-agent system splits a complex job across several specialised agents, each with its own instructions, tools, model and permissions, coordinated by an orchestrator. The example here produces a <strong>supplier risk brief</strong>: a planner breaks the request into sub-tasks; a research agent searches news and the web, a data agent queries internal spend and contract data, a finance agent runs calculations in a code sandbox, a compliance agent owned by another team is called over the <strong>A2A (Agent2Agent) protocol</strong>, and a writer plus a critic assemble and check the report. Agents share a <strong>blackboard</strong> of findings with sources, use <strong>MCP</strong> for tools, and run under one budget. Splitting gives focus, parallelism, separate permissions and independent ownership, but it multiplies tokens, latency and failure modes, so the design is as much about orchestration patterns, conflict resolution, cost control and evaluation of both the whole system and each agent. Start from the <a href="../agentic-ai/index.html">single agent</a> design and only split when it measurably helps.',
  examples: 'Microsoft Agent Framework (successor of Semantic Kernel agents and AutoGen) and Magentic-One, Foundry Agent Service connected agents, Amazon Bedrock multi-agent collaboration and AgentCore, OpenAI Agents SDK handoffs, LangGraph supervisors, CrewAI, Google ADK with A2A, deep-research products that fan out to parallel sub-agents.',
  functional: ['An analyst requests “Risk brief on supplier Contoso Metals for a 3-year contract”; the system returns a structured report with cited sources in minutes.', 'An orchestrator plans sub-tasks, assigns them to specialist agents, tracks progress and re-plans when something fails.', 'Specialists run in parallel where independent and in sequence where one needs another’s output.', 'A remote compliance agent from another team is discovered and called through A2A, without sharing its internals.', 'A critic agent checks the draft against the blackboard sources; disagreements between agents are detected and resolved or surfaced.', 'Progress streams to the analyst; they can steer (add a question) or stop the run.'],
  nonFunctional: ['Report p95 &le; 10 minutes; first progress event &le; 3 s.', 'Every claim in the report traceable to a source on the blackboard (claim faithfulness &ge; 0.95).', 'Hard per-run budget: 600 k tokens, $2, 15 minutes, 60 agent turns; typical run &le; $0.60.', 'Each agent gets only its own tools and data scopes (least privilege per agent).', 'Agents are independently versioned, evaluated and deployed; one failing agent degrades the report, not the system.', 'Full trace of the run tree for audit and debugging.'],
  outOfScope: ['Model training.', 'Autonomous actions with side effects in business systems (the brief is read-only; see <a href="../agentic-ai/index.html">AI agent with tools</a> for approvals).', 'Open-ended agent societies or simulations.'],
  estimates: [
    ['Reports per day', '1,500', '3,000 analysts, about one brief every two days each'],
    ['Peak run rate', '~0.16 runs/s', '1,500 over 8 h = 0.05/s, &times;3 on Monday mornings'],
    ['LLM calls per run', '~50', 'Orchestrator ~10, five specialists &times; ~6, writer + critic ~10'],
    ['Tokens per run', '~400 k in, ~30 k out', '50 calls &times; ~8,000 input and ~600 output'],
    ['Cost per run (all frontier model)', '~$1.30', '400 k &times; $2.50/M = $1.00 + 30 k &times; $10/M = $0.30'],
    ['Cost per run (routed)', '~$0.54', '15 planner/writer/critic calls on the frontier model ($0.39) + 35 specialist calls on a small model at $0.40/$1.60 per M ($0.15)'],
    ['Single-agent baseline', '~20 calls, ~$0.50', 'The same brief by one agent: fewer tokens but lower quality on the rubric (3.6 vs 4.3 of 5) and 2&times; slower without parallelism'],
    ['Concurrent runs / agent loops', '~56 runs, ~170 loops', '0.16 runs/s &times; ~6 min; ~3 agents active per run at a time'],
    ['Peak model throughput', '~4.1 M tokens/min', '0.16 runs/s &times; 50 calls = 8 calls/s &times; 8,600 tokens &times; 60'],
    ['Blackboard data', '~300 MB/day', '1,500 runs &times; ~200 KB of findings, sources and drafts']
  ],
  compute: [
    ['Agent runtime workers', '6 &times; 2 vCPU across zones, autoscale on active loops', '~170 concurrent loops, almost all waiting on models and tools; ~50 loops per async worker &rArr; 4 busy, 6 to survive a zone loss and deployments.'],
    ['Frontier model capacity', '~1.2 M TPM (provisioned) + spillover', '30% of calls (planning, writing, critique) &times; 4.1 M TPM peak.'],
    ['Small model capacity', '~2.9 M TPM pay-as-you-go', '70% of calls (search summarisation, SQL drafting, extraction). Cheaper per token and faster, so specialist latency drops too.'],
    ['Code sandboxes', 'Warm pool of 40 sessions', 'One finance session per run &times; ~3 min &times; 0.16 runs/s &asymp; 29 concurrent + headroom.'],
    ['Blackboard', 'Redis for the live run + Cosmos DB for durability', '~10 writes/s at peak (one per agent turn); Redis gives pub/sub notifications to the orchestrator, Cosmos keeps the record for audit and resume.']
  ],
  api: [
    ['POST /runs', '{request, template: "supplier-risk", budget?} &rarr; 202 {runId}. Idempotency key; the analyst’s identity is attached to the run.'],
    ['GET /runs/{id}/events  (SSE)', 'plan, agent_started, finding, conflict, critique, section_done, final, budget. Reconnectable.'],
    ['POST /runs/{id}/steer', '{instruction} adds a goal or constraint; the orchestrator re-plans at the next turn boundary.'],
    ['GET /.well-known/agent-card.json  (A2A)', 'The remote compliance agent publishes its Agent Card: name, skills, endpoint, supported modes and auth scheme (OAuth 2 / OIDC).'],
    ['A2A message/send, message/stream, tasks/get  (JSON-RPC)', 'The orchestrator sends a message, receives a Task with status (submitted, working, input-required, completed, failed) and final Artifacts; long tasks use streaming or push notifications.'],
    ['MCP tools/call', 'Specialists call their tools (web search, read-only SQL, sandbox) through the tool gateway; each agent has its own allow-list.']
  ],
  data: [
    ['runs', 'Cosmos DB, partition runId', 'request, owner, task ledger (plan, sub-tasks, dependencies, status), progress ledger, budget per agent and in total, status, versions of every agent used.'],
    ['blackboard entries', 'Redis (live) + Cosmos DB (partition runId)', 'entryId, agent, type (fact | estimate | question | draft | critique), key (e.g. revenue.2025), value, sources[], confidence, supersedes. Agents read a filtered view, not the whole board.'],
    ['agent registry', 'Relational DB', 'agentId, version, model, prompt version, tools, data scopes, A2A card URL, max turns/tokens, owner team, evaluation scores per version.'],
    ['messages and traces', 'Observability backend (OpenTelemetry GenAI)', 'One trace per run; child spans per agent turn, model call, tool call and A2A task; tokens, cost, latency, outcome.'],
    ['evaluation sets', 'Object storage + registry', 'Requests with reference reports, rubrics, key facts and planted conflicts; per-agent unit suites (e.g. 200 SQL questions for the data agent).']
  ],
  dbChoice: [
    ['Shared run state (blackboard)', 'Redis for live state + document DB for durability', 'Many small writes from parallel agents, pub/sub to wake the orchestrator, conditional writes on keys to detect conflicts; durable copy for audit and resume.', 'Passing the whole conversation between agents (simple but token-hungry and leaky); a graph DB for very complex claim graphs.'],
    ['Run and task ledgers', 'Document DB (or workflow engine history)', 'One document tree per run, read whole on resume; TTL for old runs.', 'Durable Functions / Temporal state: gives replay and timers for free.'],
    ['Agent registry', 'Relational DB', 'Versioned configuration with ownership, approvals and joins to evaluation results.', 'YAML in Git with CI: good for small teams.']
  ],
  diagram: {
    nodes: [['u', 'Analysts', 'client', 0, 1.2, 'web app'], ['api', 'Run API', 'apigw', 1, 1.2, 'SSE, steer'], ['gw', 'AI gateway', 'apigw', 1, 0, 'frontier + small'],
      ['orc', 'Orchestrator', 'agent', 2, 1.2, 'planner, ledgers'], ['bb', 'Blackboard', 'cache', 2, 0, 'findings + sources'],
      ['res', 'Research agent', 'agent', 3, 0, 'news, web'], ['dat', 'Data agent', 'agent', 3, 1.2, 'spend, contracts'], ['fin', 'Finance agent', 'agent', 3, 2.4, 'ratios, scoring'],
      ['web', 'Search MCP', 'ext', 4, 0, 'web + news API'], ['dw', 'Spend warehouse', 'dw', 4, 1.2, 'read-only SQL'], ['sbx', 'Code sandbox', 'fn', 4, 2.4, 'Python'],
      ['comp', 'Compliance agent', 'agent', 2, 2.6, 'other team, A2A'], ['rev', 'Writer + critic', 'agent', 1, 2.6, 'draft, verify']],
    edges: [['u', 'api'], ['api', 'orc'], ['orc', 'gw'], ['orc', 'bb'], ['orc', 'res'], ['orc', 'dat'], ['orc', 'fin'], ['orc', 'comp', 'A2A'], ['orc', 'rev'],
      ['res', 'web', 'MCP'], ['dat', 'dw', 'MCP'], ['fin', 'sbx'], ['res', 'bb'], ['dat', 'bb']]
  },
  flows: [
    { name: 'Plan and fan out', desc: 'The orchestrator plans and runs independent sub-tasks concurrently (magentic-style planning with a task ledger).', steps: [
      ['u', 'api', 'POST /runs (supplier risk)', 'The analyst asks for a risk brief on Contoso Metals; the run gets a budget of 600 k tokens and $2.'],
      ['api', 'orc', 'start run', 'The orchestrator loads the template: required sections, which agents may be used, the budget split per agent.'],
      ['orc', 'gw', 'plan (frontier model)', 'Planning is the hardest reasoning step, so it uses the strongest model. Output: a task ledger of 6 sub-tasks with dependencies.'],
      ['orc', 'bb', 'write task ledger', 'The plan lives on the blackboard so every agent and the UI can see it, and a crashed run can resume.'],
      { par: [['orc', 'res', 'news + adverse media'], ['orc', 'dat', 'spend + contract terms'], ['orc', 'comp', 'A2A: sanctions screening']], msg: 'Three independent sub-tasks start concurrently. Each specialist gets only its brief and the relevant board entries, not the whole history, which keeps its context small and focused.' },
      ['res', 'web', 'search via MCP', 'The research agent (small model) searches news; results are untrusted content, summarised with source URLs.'],
      ['dat', 'dw', 'read-only SQL', 'The data agent writes SQL against a curated view with a row limit; its credentials cannot read anything else.'],
      ['res', 'bb', 'post findings + sources', 'Findings are structured entries (key, value, source, confidence), not free text, so they can be checked and compared.'],
      ['comp', 'orc', 'A2A task completed + artifact', 'The remote agent returns a screening artifact. Its internals, prompts and data stay with the owning team.', 'resp']],
      end: 'Concurrency cuts wall time; small focused contexts and small models keep the token bill down.' },
    { name: 'Sequential, critique, final', desc: 'Dependent steps run in order; a critic verifies the draft before it is released.', steps: [
      ['orc', 'bb', 'progress check', 'The progress ledger shows spend data is ready, so the finance sub-task is unblocked (sequential dependency).'],
      ['orc', 'fin', 'compute exposure + score', 'The finance agent receives the spend and contract entries only.'],
      ['fin', 'sbx', 'run Python', 'Ratios and a concentration score are computed in a sandbox, not by the model doing arithmetic in its head.'],
      ['fin', 'bb', 'post score + method', 'Numbers are stored with the code that produced them.'],
      ['orc', 'rev', 'write sections', 'The writer drafts from board entries only and cites entry ids.'],
      ['rev', 'bb', 'critic checks claims', 'The critic (a different prompt, ideally a different model) checks every claim against its cited entry.'],
      ['rev', 'orc', 'critique: 1 unsupported claim', 'One sentence about a lawsuit has no source; the critic asks for evidence or removal.', 'err'],
      ['orc', 'res', 'targeted follow-up', 'Instead of a free-form debate, the orchestrator issues one focused sub-task. Max 2 critique rounds.'],
      ['rev', 'orc', 'approved draft', 'The claim is now sourced; the report passes.', 'resp'],
      ['api', 'u', 'report + sources', 'The analyst receives the brief with citations, a confidence note and the run cost ($0.52).', 'resp']],
      end: 'Generator-critic loops raise quality, but only with a cap on rounds and checks against shared evidence.' },
    { name: 'Conflict between agents', desc: 'Two agents report different revenue figures for the supplier.', steps: [
      ['res', 'bb', 'revenue.2025 = $1.2 B (news)', 'The research agent found a news article.'],
      ['dat', 'bb', 'revenue.2025 = $0.9 B (filing)', 'The data agent read the audited filing stored in the warehouse. A conditional write detects an existing value for the same key.', 'err'],
      ['bb', 'orc', 'conflict event', 'The blackboard flags the conflict instead of letting the later write silently win.', 'err'],
      ['orc', 'gw', 'resolve by source policy', 'Resolution rules first: system of record and audited filings beat news; newer beats older; then confidence. A model is asked only to explain, not to vote.'],
      ['orc', 'bb', 'accept $0.9 B, keep the other', 'The losing entry is kept as superseded with the reason, which is useful context (the article may include a parent company).'],
      ['orc', 'rev', 'conflict noted in report', 'Unresolvable conflicts are shown to the analyst rather than hidden.']],
      end: 'Resolve conflicts with explicit rules and provenance, not by majority vote of language models.' },
    { name: 'Ping-pong and budget (failure)', desc: 'Two agents keep handing the task back to each other and the remote agent times out.', steps: [
      ['orc', 'dat', 'handoff: contract terms', 'The data agent cannot find the contract and hands off to research.'],
      ['orc', 'res', 'handoff back', 'Research says contracts are internal and hands back: a handoff cycle.', 'err'],
      ['orc', 'bb', 'cycle detected (A→B→A)', 'The orchestrator tracks the handoff chain; the same pair twice with no new board entries is a cycle. It stops routing between them.', 'err'],
      ['orc', 'comp', 'A2A tasks/get: still working', 'The remote compliance agent has not finished within its 3-minute deadline.', 'err'],
      ['orc', 'gw', 'budget at 80%: degrade', 'With 480 k of 600 k tokens used, the orchestrator switches to “finish mode”: no new sub-tasks, write with what exists.'],
      ['orc', 'rev', 'partial report', 'Sections without evidence are marked “not available” and the compliance result is marked pending with a link; the analyst is notified when it arrives.'],
      ['api', 'u', 'report with gaps flagged', 'A bounded, honest partial result instead of a $20 runaway run.', 'resp']],
      end: 'Turn limits, cycle detection, per-agent deadlines and a global budget stop multi-agent cost explosions.' }
  ],
  components: [
    ['Orchestrator (planner)', 'Builds and updates the task ledger, routes sub-tasks, runs patterns (sequential, concurrent, handoff), enforces budgets, detects cycles and conflicts, decides when to stop.'],
    ['Specialist agents', 'Narrow instructions, own tools and data scopes, often a smaller model; each is versioned and evaluated on its own suite.'],
    ['Remote agents (A2A)', 'Agents owned by other teams or vendors, discovered via Agent Cards and called as opaque tasks with their own auth.'],
    ['Blackboard', 'Shared structured state: plan, findings with sources, drafts, critiques; filtered views per agent; conflict detection on keys.'],
    ['Writer and critic', 'Generator-critic pair that produces the report and checks every claim against the blackboard.'],
    ['AI gateway and tool gateway', 'Model routing (frontier vs small), quotas and failover; per-agent tool allow-lists, scoped credentials, rate limits.'],
    ['Tracing and evaluation', 'Run tree traces, system-level and per-agent evaluation, cost dashboards per agent.']
  ],
  deep: [
    ['Orchestration patterns', '<table><tr><th>Pattern</th><th>How it works</th><th>Use when</th></tr><tr><td><strong>Sequential</strong> (pipeline)</td><td>Agents run in a fixed order; each gets the previous output</td><td>Clear stages: extract &rarr; analyse &rarr; write</td></tr><tr><td><strong>Concurrent</strong> (fan-out / fan-in)</td><td>Several agents work on the same input or independent sub-tasks in parallel; results are aggregated</td><td>Independent research angles, ensembles, latency matters</td></tr><tr><td><strong>Group chat</strong></td><td>Agents share one conversation; a manager picks who speaks next</td><td>Brainstorming, maker-checker debate; keep groups small and rounds capped</td></tr><tr><td><strong>Handoff</strong></td><td>The active agent transfers control (and a context summary) to another</td><td>Triage and routing, e.g. customer service: billing &rarr; technical</td></tr><tr><td><strong>Magentic</strong> (planner with ledgers)</td><td>A manager keeps a task ledger and progress ledger, assigns work, re-plans on failure</td><td>Open-ended problems where the plan emerges as you go</td></tr></table><p>Real systems combine them: here, a magentic planner runs concurrent fan-out, a sequential dependency and a generator-critic loop. Prefer the simplest pattern that passes the evaluation; every extra agent adds latency, tokens and a place to fail (see the <a href="../ai-foundations/index.html#agents">agent basics</a>).</p>'],
    ['Shared state and context engineering', '<p>Two ways to share information: pass messages (each agent sees the conversation) or share state (a <strong>blackboard</strong>). Passing full transcripts between agents is the main cause of token blow-up and of context confusion. The blackboard stores typed entries with keys, sources and confidence; each agent receives a <strong>filtered view</strong> (its brief, its dependencies’ outputs) and writes structured results. Benefits: small contexts, auditability, conflict detection, resumability, and the UI can show progress.</p><p>Handoffs carry a short summary plus entry ids, not the history. Long tool outputs stay in object storage with a pointer (claim check). Concurrency control: conditional writes (etag) on keys, append-only entries with “supersedes” links, and a single orchestrator as the writer of the plan.</p>'],
    ['Protocols: MCP for tools, A2A for agents', '<p><strong>MCP</strong> connects an agent to tools and data (tools/list, tools/call, resources). <strong>A2A</strong> (Agent2Agent, an open protocol under the Linux Foundation) connects agents to agents across teams, frameworks and vendors:</p><ul><li><strong>Agent Card</strong> (JSON at a well-known URL): identity, skills, endpoint, input/output modes, authentication requirements.</li><li><strong>Tasks</strong> with a lifecycle (submitted, working, input-required, completed, failed, canceled) and <strong>Artifacts</strong> as results; JSON-RPC over HTTPS, server-sent events for streaming, webhooks for long-running work.</li><li><strong>Opaque execution:</strong> the caller does not see the remote agent’s prompts, tools or memory, which is what lets another team own and change it.</li></ul><p>Treat a remote agent like any external dependency: authenticate both ways (OAuth 2 / mTLS), set deadlines, rate limits and circuit breakers, validate and sanitise its artifacts (they are untrusted input to your agents), and pin versions where possible.</p>'],
    ['Conflict resolution and quality control', '<ul><li><strong>Detect</strong> conflicts structurally: same key, different values, on the blackboard.</li><li><strong>Resolve by policy</strong>: source authority (system of record &gt; filing &gt; news &gt; model inference), recency, then confidence. Keep the loser as superseded with a reason.</li><li><strong>Targeted verification</strong>: ask one agent to re-check one fact with a specific source, rather than an open debate.</li><li><strong>Judges, not votes</strong>: majority voting between agents built on the same model shares the same biases; use a critic with a different prompt or model, and programmatic checks (numbers recomputed in code).</li><li><strong>Escalate</strong>: unresolved conflicts appear in the report for the human.</li></ul>'],
    ['Cost explosion, safety and evaluation', '<p><strong>Why costs explode:</strong> N agents &times; M turns &times; growing shared context; group chats where every agent reads every message; ping-pong handoffs; critics that never approve. Controls: a global budget plus per-agent sub-budgets (tokens, turns, wall time, dollars) enforced by the orchestrator; turn and critique-round caps; cycle detection; filtered contexts; small models for specialists; prompt caching of each agent’s fixed prefix; “finish mode” at 80% budget; cost per run and per agent on dashboards with alerts.</p><p><strong>Safety:</strong> per-agent least privilege (the research agent cannot query the warehouse; the data agent has no internet), untrusted handling of web content and remote artifacts (an injected instruction in a news page must not reach the data agent as an instruction), content safety on the final report, and no side-effect tools in this read-only design.</p><p><strong>Evaluate twice:</strong> the <em>system</em> end to end (report rubric, claim faithfulness, cost, latency) and <em>each agent</em> on its own suite (SQL accuracy for the data agent, search recall for research, calculation correctness for finance, plan quality and routing accuracy for the orchestrator). A system regression is then traceable to the agent that caused it. Always compare against a single-agent baseline (see <a href="../ai-evaluation/index.html#agents">agent metrics</a>).</p>']
  ],
  scale: [
    '<strong>Model quota</strong> multiplies with agents: 50 calls per run. Route specialists to small models, cache prefixes, and spread frontier calls across deployments behind the <a href="../llm-gateway/index.html">AI gateway</a>.',
    '<strong>Latency</strong> is set by the critical path, not the number of agents: parallelise independent sub-tasks, stream progress, and cap critique rounds.',
    '<strong>Remote agents</strong> become shared dependencies: rate limits and circuit breakers per A2A peer, async tasks with push notifications instead of holding connections.',
    '<strong>Many agent teams</strong>: a registry with versions, owners and evaluation scores; platform-provided runtime, identity, gateway and tracing so each team only builds its agent.',
    '<strong>Blackboard contention</strong> is rare (one run = one partition), but keep entries small and use pub/sub to avoid polling.'
  ],
  tradeoffs: [
    ['Single vs multi-agent', 'One agent with many tools vs several specialists', 'Single agent first. Split when tools or instructions conflict, when parallelism matters, when permissions must be separated, or when another team owns the capability. Here quality rose from 3.6 to 4.3 on the rubric for ~1.1&times; the routed cost.'],
    ['Central orchestrator vs decentralised handoffs', 'Planner controls everything vs agents pass control to each other', 'Central orchestrator for auditable, budgeted workflows; handoffs for conversational triage. Decentralised swarms are hard to bound and debug.'],
    ['Message passing vs blackboard', 'Shared transcript vs structured shared state', 'Blackboard: smaller contexts, conflict detection, resumability; costs some schema design.'],
    ['Same model vs mixed models', 'One frontier model everywhere vs routing', 'Mixed: frontier for planning/critique, small for specialists; cut cost per run from $1.30 to $0.54 at equal rubric score.'],
    ['In-process agents vs A2A services', 'All agents in one runtime vs remote agents over A2A', 'In-process for agents you own (lower latency, shared tracing); A2A when ownership, scaling or trust boundaries differ.']
  ],
  failures: [
    ['Cost explosion / infinite collaboration', 'Global and per-agent budgets, turn and round caps, cycle detection, finish mode at 80%, alerts on cost per run.'],
    ['Specialist agent fails or times out', 'Per-agent deadline, retry once, re-plan around it, mark the section unavailable; the run still completes.'],
    ['Contradictory findings', 'Keyed blackboard entries with provenance, policy-based resolution, targeted verification, show unresolved conflicts.'],
    ['Error propagation (one wrong fact reused everywhere)', 'Sources on every entry, critic checks against sources, numbers recomputed in code, confidence carried through.'],
    ['Prompt injection crossing agents', 'Web and remote outputs stored as data, never as instructions; per-agent least privilege; prompt shields on inputs from other agents.'],
    ['Remote A2A agent changes behaviour', 'Pinned versions, contract tests on its artifacts, circuit breaker, fallback to a cached or manual step.'],
    ['Orchestrator crash', 'Ledgers on the blackboard, durable execution, resume from the last completed sub-task.']
  ],
  evals: [
    ['Report quality (system)', 'Rubric judge: coverage of required sections, correctness, usefulness', '&ge; 4.2 / 5 average on 150 reference requests; pairwise win rate &ge; 60% vs single-agent baseline'],
    ['Claim faithfulness', 'Report claims supported by cited blackboard entries and their sources', '&ge; 0.95; zero unsupported numeric claims'],
    ['Per-agent task success', 'Each specialist on its own suite (SQL accuracy, search recall@10, calculation correctness)', '&ge; 90% each; tracked per agent version'],
    ['Orchestration quality', 'Plan covers required sub-tasks; routing and handoff accuracy; cycles per run', 'Routing accuracy &ge; 95%; cycles &lt; 1% of runs'],
    ['Conflict handling', 'Planted contradictions detected and resolved correctly', '&ge; 90% detected; 100% surfaced if unresolved'],
    ['Safety', 'Injection via web/remote artifacts; cross-agent data exposure', 'Attack success &le; 1%; 0 scope violations'],
    ['Latency', 'Run wall time and time to first progress event', 'p95 &le; 10 min; first event &le; 3 s'],
    ['Cost efficiency', 'Cost and tokens per run and per agent; ratio to single-agent baseline', '&le; $0.60 per run typical, hard cap $2; tokens &le; 3&times; baseline'],
    ['User outcome', 'Analyst edit rate and time saved', 'Median edits &le; 10% of text; &ge; 2 h saved per brief']
  ],
  cloud: [['Agent runtime', 'agents'], ['Foundation models (frontier + small)', 'llm'], ['AI platform / agent framework', 'aiplatform'], ['AI gateway', 'aigw'], ['A2A endpoints', 'Foundry Agent Service (A2A)', 'Bedrock AgentCore Runtime (A2A)'],
    ['Tool gateway / MCP', 'apigw'], ['MCP tool servers', 'containers'], ['Code sandbox', 'Azure Container Apps dynamic sessions', 'AgentCore Code Interpreter'], ['Durable orchestration', 'workflow'],
    ['Blackboard (live)', 'cache'], ['Runs and ledgers', 'nosql'], ['Spend and contract data', 'warehouse'], ['Content safety', 'guardrails'], ['Agent identities and secrets', 'secrets'], ['Tracing and evaluation', 'aieval'], ['Monitoring and cost dashboards', 'monitor']],
  refs: { az: ['azAgents', 'azEvalAgent', 'azObservability', 'azGenGwMulti', 'azEvalSafety', 'azFoundryChat', 'azp-scheduler-agent-supervisor', 'azp-choreography'],
          aws: ['awsAgentic', 'awsAgenticFound', 'awsGenAiLens', 'awsScatter', 'awsSagaOrch', 'awsBedrockJudge'] },
  questions: [
    ['When is multi-agent worth it over a single agent?', 'When a single agent’s tools or instructions start to conflict (too many tools, mixed roles), when sub-tasks can run in parallel, when different parts need different permissions or models, or when another team owns a capability. Measure: compare rubric score, latency and cost against a single-agent baseline; many “multi-agent” problems are better as one agent plus a workflow.'],
    ['How is A2A different from MCP?', 'MCP connects an agent to tools and data with explicit schemas: the caller decides exactly what to run. A2A connects agents to other agents as opaque collaborators: you send a task and receive status updates and artifacts, without seeing the remote agent’s tools, prompts or memory. They complement each other: an agent reached over A2A typically uses MCP internally.'],
    ['How do you stop agents from burning money?', 'Budgets enforced by the orchestrator (tokens, turns, time, dollars) globally and per agent, round caps for critique and group chat, cycle detection on handoffs, filtered contexts instead of shared transcripts, small models for specialists, and a finish mode that writes with what exists when 80% of the budget is used.'],
    ['How do you resolve disagreements between agents?', 'Store findings as keyed entries with sources; detect conflicts on write; resolve by explicit source-authority and recency rules; ask for targeted verification of one fact; never trust a vote among agents sharing a model; surface what remains unresolved to the human.'],
    ['How do you debug a bad report?', 'Open the run trace: the plan, each agent’s inputs (filtered view), outputs, tool calls and costs. Check per-agent evaluation scores for the versions used. Because findings are on the blackboard with provenance, you can see which agent introduced the wrong fact and add that case to its test suite.'],
    ['How would you evaluate each agent independently?', 'Give each agent a contract (input schema, output schema) and a unit suite: e.g. 200 questions with reference SQL results for the data agent, labelled search results for research, calculations with known answers for finance, plans with required sub-tasks for the orchestrator. Run them on every prompt or model change, then the end-to-end suite.']
  ],
  related: ['agentic-ai', 'llm-gateway', 'rag-assistant', 'llmops', 'coding-assistant']
});

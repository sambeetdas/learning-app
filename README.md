# Learning App

A small static learning site built with plain HTML, CSS and jQuery. The home page lists every topic; each topic lives in its own folder.

## Topics

| Topic | Folder | What it covers |
| --- | --- | --- |
| Streaming API | [streaming-api/](streaming-api/) | Short polling, long polling, SSE, HTTP streaming (NDJSON) and WebSocket, with animated diagrams and system-design notes |
| DNS | [dns/](dns/) | Resolvers and the root/TLD/authoritative hierarchy, caching and TTL, record types, anycast, DNSSEC, traffic steering, security, troubleshooting; step-through resolution demo |
| CDN | [cdn/](cdn/) | Edge caching and origin shield, Cache-Control and cache keys, invalidation, use cases, security, metrics; interactive edge cache simulator |
| Machine Learning | [ml/](ml/) | Learning types, use cases, algorithms, data pitfalls, overfitting, metrics, ensembles, multi-model pipelines, deep learning, MLOps, responsible AI; six animated demos |
| PyTorch and Deep Learning | [pytorch/](pytorch/) | History, tensors, autograd, nn.Module, training loop, all major deep learning algorithms with code, PyTorch internals, scaling, deployment; nine animated demos |
| Data Structures and Algorithms | [dsa/](dsa/) | 19 linked pages, from Big-O to advanced and recent algorithms, each with step-through animations, pseudocode, Python and solved practice questions (see below) |
| Playwright with Python | [playwright/](playwright/) | 15 pages from beginner to advanced: locators, auto-waiting, pytest, network mocking, API testing, tracing, CI, emulation, automation use cases; then AI: agents driving browsers (Playwright MCP server, playwright-cli), testing AI and agentic apps, and four documented end-to-end projects (see below) |
| System Design | [sysdesign/](sysdesign/) | 12 fundamentals pages (estimation and database choice, scaling, data, caching, messaging, reliability, AI systems, AI evaluation...) and 49 end-to-end designs from basic to advanced, including 15 AI systems; animated request flows and Azure and AWS references (see below) |

## Run it

From the VS Code terminal (no installs needed; uses PowerShell only):

```powershell
.\run.ps1                # http://localhost:8080 and opens the browser
.\run.ps1 -Port 9000     # use another port
.\run.ps1 -NoBrowser     # don't open the browser
```

Press `Ctrl+C` to stop. Files are served with `no-cache`, so edits show up on refresh.

You can also open `index.html` directly in a browser; no server is required. jQuery is loaded from a CDN, so you need internet access.

### Docker (optional)

A `Dockerfile` (nginx serving the static files) is included, but `run.ps1` does not use it:

```powershell
docker build -t learning-app .
docker run --rm -p 8080:80 learning-app
```

## Structure

```text
learning-app/
├── index.html          home page: lists all topics
├── home.css
├── home.js             jQuery: renders topic cards from the TOPICS array, with a filter box
├── run.ps1             local static server
├── Dockerfile
├── streaming-api/      one topic per folder, each self-contained
│   ├── index.html
│   ├── style.css
│   ├── anim.js         animated diagrams
│   └── page.js         jQuery: "On this page" contents list, smooth scrolling
├── dns/
│   ├── index.html
│   ├── style.css
│   ├── stepper.js      jQuery: DNS resolution step-through
│   └── page.js
├── cdn/
│   ├── index.html
│   ├── style.css
│   ├── simulator.js    jQuery: edge cache simulator
│   └── page.js
├── ml/
│   ├── index.html
│   ├── style.css
│   ├── demos.js        canvas demos: gradient descent, k-means, k-NN, overfitting
│   ├── nn.js           neural network forward/backward animation (SVG)
│   ├── pipeline.js     multi-algorithm use-case pipeline player
│   └── page.js
├── pytorch/
│   ├── index.html
│   ├── style.css
│   ├── playground.js   from-scratch neural network trainer (live decision regions)
│   ├── viz.js          matmul, broadcasting, autograd graph, activations, convolution, attention
│   ├── steppers.js     PyTorch call stack, training loop, history timeline
│   └── page.js
├── dsa/                Data Structures and Algorithms (multi-page topic)
│   ├── index.html      hub: roadmap and cheat sheets
│   ├── assets/         shared dsa.css, dsa.js (step player + drawing helpers), page.js
│   └── <page>/         one folder per page: index.html + demo.js
├── playwright/         Playwright with Python (multi-page topic)
│   ├── index.html      hub: architecture animation, learning path, use cases, the ShopBot example app
│   ├── hub.js
│   ├── assets/         pw.css, core.js (step player), pw.js (page list, diagrams, copy buttons, code tabs), page.js
│   └── <page>/         index.html + demo.js
└── sysdesign/          System Design (multi-page topic)
    ├── index.html      hub: anatomy of a system, page lists, building-blocks table (Azure / AWS)
    ├── hub.js
    ├── assets/         sd.css, core.js (step player), sd.js (catalog, diagrams, case renderer), page.js
    ├── <fundamental>/  index.html + demo.js
    └── <case>/         index.html (shell) + data.js (the case study as data)
```

## The DSA topic

`dsa/` is a multi-page topic. The hub (`dsa/index.html`) links 19 pages:

complexity, arrays, linked-lists, stacks-queues, hashing, trees, heaps, graphs, graphs-advanced, sorting,
searching, recursion, dp, greedy-dc, advanced, strings, math, modern, patterns

Every page has animated demos, pseudocode, Python code, complexity tables, real-world use cases and a
"Practice questions" section with collapsible worked solutions.

All animations use the shared toolkit in `dsa/assets/dsa.js`:

- `DSA.player(root, frames, render, {code})`: Back / Play / Next / speed controls, a caption, and an optional
  code panel whose current line is highlighted. An algorithm is run once in advance and records
  `frames` (state snapshots plus a `msg` and an optional `line`).
- Drawing helpers: `cells`, `bars`, `stack`, `list`, `tree`, `ntree`, `graph`, `grid`, `legend`.
- Mark colours: `a` (blue), `b` (orange), `c` (red), `ok` (green), `p` (purple), `dim`.

## The Playwright topic

`playwright/` teaches Playwright for Python in five parts:

- **Beginner:** introduction, getting-started, locators, actions-assertions.
- **Intermediate:** pytest, network-api.
- **Advanced:** debugging-ci, advanced, automation.
- **AI and agents:** ai-agents, ai-testing.
- **Projects:** project-chatbot-tests, project-test-generator, project-explorer-agent, project-agent-eval.

The project pages are documentation. Each one shows the project's layout and every file's code inside the page, and no runnable project files are included in this repository.

The examples target an imaginary local shop called "ShopBot", which is described on the hub page. The code was written for Playwright 1.64 and pytest-playwright 0.10. The LLM examples use the Anthropic Python SDK, behind an interface so that a fake model can be swapped in for tests.

## The System Design topic

`sysdesign/` has a hub, 12 fundamentals pages and 49 case studies.

- **Fundamentals:** basics, estimation (traffic, compute, GPU/token calculators and a database chooser), scaling, data,
  caching, messaging, reliability, architecture, security-ops, ai-foundations, ai-evaluation (RAG, LLM and agent
  metrics with calculators), interview.
- **Case studies** by level:
  - Basic: URL shortener, rate limiter, unique IDs, notifications, crawler, typeahead, leaderboard.
  - Intermediate: feed, chat, file sync, video streaming, ride hailing, proximity, e-commerce, tickets, hotels, email,
    payments, search.
  - Advanced: KV store, cache, message queue, observability, scheduler, ad clicks, stock exchange, collaborative editor,
    video calls, live streaming, maps, games, IoT, multi-tenant SaaS.
  - AI: RAG, agents, multi-agent, LLM gateway, LLM serving, coding assistant, semantic search, document AI, voice,
    recommendations, ML platform, training cluster, LLMOps, image generation, moderation.

Each case follows the same structure:

1. Requirements.
2. Capacity and compute estimates.
3. API.
4. Data model and database choice.
5. An animated architecture diagram with several request flows.
6. Deep dives.
7. Scaling.
8. Trade-offs.
9. Failure modes.
10. Evaluation metrics (AI cases).
11. Azure and AWS services and reference architectures.
12. Interview questions.

Cases are pure data: `sysdesign/<case>/data.js` calls `SD.renderCase({...})`, and `sd.js` draws everything.

- Diagrams are SVG on a grid. A node is `[id, label, kind, col, row, sub]`.
- Flows are lists of hops, `[from, to, label, message, kind]`. The kind is `req`, `resp`, `async` or `err`. Each hop is animated as a moving packet.
- Cloud services and reference links come from the `CAT` and `REF` tables in `sd.js`, so they are maintained in one place. The links were checked in October 2026.

## Add a topic

1. Create a folder, for example `my-topic/`, with its own `index.html` (plus any CSS/JS it needs; keep it self-contained).
2. Link back to the home page with `<a href="../index.html">&larr; All topics</a>`.
3. Add an entry to the `TOPICS` array in [home.js](home.js):

   ```js
   {
     folder: 'my-topic',
     title: 'My Topic',
     summary: 'One or two sentences shown on the home page card.',
     tags: ['tag1', 'tag2']
   }
   ```

## Notes

- The Streaming API topic is the static explainer part of a separate .NET sample. Where its text says "the demo" or "here", it refers to that sample; the live demo itself is not included.

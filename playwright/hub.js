(function () {
  'use strict';
  var DESC = {
    'introduction': 'History, why Playwright, how it compares with Selenium and Cypress, browsers, contexts and pages, and the architecture.',
    'getting-started': 'Install, sync vs async APIs, your first script, codegen, the inspector and running headed or headless.',
    'locators': 'get_by_role and friends, filtering and chaining, strictness, frames and shadow DOM, with an interactive locator playground.',
    'actions-assertions': 'Clicks, typing and forms, auto-waiting and actionability checks, web-first assertions and timeouts, animated.',
    'pytest': 'pytest-playwright fixtures, test isolation, configuration, parametrisation, parallel runs and the page object model.',
    'network-api': 'Route and mock requests, HAR replay, API testing with APIRequestContext, and reusing login state.',
    'debugging-ci': 'Inspector, trace viewer, screenshots and videos, reports, flaky tests, GitHub Actions and Docker.',
    'advanced': 'Device emulation, clock control, tabs and popups, iframes, dialogs, uploads and downloads, visual and accessibility testing.',
    'automation': 'Scraping, form automation, screenshots and PDFs, synthetic monitoring and async concurrency.',
    'ai-agents': 'How LLM agents drive browsers: accessibility snapshots, the built-in Playwright MCP server, playwright-cli, custom tools and safety.',
    'ai-testing': 'Testing chatbots and agents: mocking the LLM, streaming UIs, LLM-as-judge assertions, AI-generated and self-healing tests.',
    'project-chatbot-tests': 'A full test suite for an AI support chat: deterministic UI tests with a mocked model, live quality evals and CI gates.',
    'project-test-generator': 'An agent that turns user stories into pytest tests through the Playwright MCP server, runs them and repairs failures.',
    'project-explorer-agent': 'An agent that explores a web app with Playwright tools, finds bugs and writes reports with screenshots and traces.',
    'project-agent-eval': 'A harness that measures a browser agent on a task suite: success, steps, cost, safety and regressions.'
  };
  PW.PAGES.forEach(function (p, i) {
    $('#lvl-' + p[2]).append('<a href="' + p[0] + '/index.html"><b>' + (i + 1) + '. ' + p[1] + '</b><span>' + DESC[p[0]] + '</span></a>');
  });

  var D = {
    nodes: [['t', 'Your Python test', 'client', 0, 1, 'pytest / script'], ['api', 'Playwright client', 'svc', 1.3, 1, 'playwright.sync_api'], ['drv', 'Playwright driver', 'gw', 2.6, 1, 'Node.js, bundled'],
      ['cr', 'Chromium', 'ext', 4, 0, 'CDP'], ['ff', 'Firefox', 'ext', 4, 1, 'patched, Juggler'], ['wk', 'WebKit', 'ext', 4, 2, 'patched, WebKit protocol'], ['app', 'Web app', 'svc', 5.4, 1, 'under test']],
    edges: [['t', 'api'], ['api', 'drv', 'JSON over pipe'], ['drv', 'cr'], ['drv', 'ff'], ['drv', 'wk'], ['cr', 'app'], ['ff', 'app', '', 'none'], ['wk', 'app', '', 'none']]
  };
  PW.flows('#arch-demo', D, [
    { name: 'A click', desc: 'What happens when your test calls page.get_by_role("button", name="Search").click().', steps: [
      ['t', 'api', 'locator.click()', 'Your test calls the Python API. Locators are lazy: nothing is looked up yet.'],
      ['api', 'drv', 'Frame.click(selector)', 'The Python client sends a JSON message to the driver process over a pipe (the same driver powers the Node, Java and .NET versions).'],
      ['drv', 'cr', 'find + actionability', 'The driver finds the element and waits until it is visible, stable, enabled and not covered.'],
      ['cr', 'app', 'trusted mouse events', 'The browser dispatches real (trusted) mouse events, exactly like a user.'],
      ['app', 'cr', 'page reacts', 'The page runs its JavaScript, fetches data, updates the DOM.', 'resp'],
      ['drv', 'api', 'done', 'When the action completes, the driver replies.', 'resp'],
      ['api', 't', 'returns', 'Your code continues; the next expect() keeps polling until the page shows the expected state.', 'resp']] },
    { name: 'One driver, three engines', desc: 'The same test runs on every browser engine.', steps: [
      { par: [['drv', 'cr', 'Chrome DevTools Protocol'], ['drv', 'ff', 'Juggler'], ['drv', 'wk', 'WebKit protocol']], msg: 'Playwright ships patched builds of Firefox and WebKit plus Chromium, and can also drive installed Chrome and Edge (channel="chrome" / "msedge").' },
      ['t', 'api', 'pytest --browser firefox', 'Choose the browser from the command line; the test code does not change.'],
      ['drv', 'ff', 'same commands', 'The driver translates each command into the engine’s own protocol.'],
      ['ff', 'app', 'run the test', 'WebKit is the engine behind Safari, so this is how you test Safari behaviour on Windows or Linux.']] }
  ]);
  $('#arch-legend').html(PW.legend());
})();

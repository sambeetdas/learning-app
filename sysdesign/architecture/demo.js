$(function () {
  'use strict';
  SD.pageChrome('architecture');

  var MONO = { nodes: [['u', 'Client', 'client', 0, 1], ['m', 'Monolith', 'svc', 1.6, 1, 'orders + payments + catalog'], ['db', 'One database', 'db', 3.2, 1]], edges: [['u', 'm'], ['m', 'db']] };
  var MICRO = { nodes: [['u', 'Client', 'client', 0, 1.2], ['gw', 'API gateway', 'apigw', 1, 1.2], ['o', 'Orders svc', 'svc', 2.2, 1.2], ['p', 'Payments svc', 'svc', 3.4, 0.2], ['c', 'Catalog svc', 'svc', 3.4, 2.2],
    ['odb', 'Orders DB', 'db', 2.2, 0], ['pdb', 'Payments DB', 'db', 4.6, 0.2], ['cdb', 'Catalog DB', 'nosql', 4.6, 2.2], ['bus', 'Event bus', 'bus', 2.2, 2.5]],
    edges: [['u', 'gw'], ['gw', 'o'], ['o', 'p'], ['o', 'c'], ['o', 'odb'], ['p', 'pdb'], ['c', 'cdb'], ['o', 'bus', '', 'async']] };
  SD.multi('#mono-demo', [
    { name: 'Monolith', desc: 'Everything in one process: function calls and one database transaction.', diagram: MONO, steps: [
      ['u', 'm', 'POST /checkout', 'The request enters the single application.'], ['m', 'db', 'one ACID transaction', 'Check stock, charge, create the order: all in-process function calls and one transaction. Simple and fast.'],
      ['m', 'u', '201 Created', 'Done. The cost appears later: every team deploys the same unit, and scaling the catalogue means scaling payments too.', 'resp']] },
    { name: 'Microservices', desc: 'The same request across independently deployed services, each with its own data.', diagram: MICRO, steps: [
      ['u', 'gw', 'POST /checkout', 'The gateway routes to the orders service.'], ['gw', 'o', 'route', 'Orders orchestrates the checkout.'],
      ['o', 'c', 'check price/stock (network)', 'A network call to the catalog service, which can fail or be slow.'], ['o', 'p', 'charge (network)', 'A network call to payments.'],
      ['o', 'odb', 'save order', 'Each service writes only its own database; there is no shared transaction (use a saga).'], ['o', 'bus', 'OrderPlaced', 'Other services learn about it through events.', 'async'],
      ['o', 'u', '201 Created', 'Teams deploy and scale each service independently, at the cost of distributed-systems complexity.', 'resp']] }
  ]);

  var SF = { nodes: [['u', 'Users', 'client', 0, 1], ['f', 'Routing facade', 'apigw', 1.4, 1, 'proxy / gateway'], ['leg', 'Legacy system', 'svc', 3, 0.3, 'shrinking'], ['new', 'New services', 'svc', 3, 1.7, 'growing'], ['ldb', 'Legacy DB', 'db', 4.5, 0.3], ['ndb', 'New DBs', 'db', 4.5, 1.7]],
    edges: [['u', 'f'], ['f', 'leg'], ['f', 'new'], ['leg', 'ldb'], ['new', 'ndb'], ['ldb', 'ndb', 'sync (CDC)', 'async']] };
  SD.multi('#sf-demo', [
    { name: 'Step 1: facade', desc: 'Put a facade in front of the legacy system; nothing changes for users.', diagram: SF, steps: [['u', 'f', 'all requests', 'Users now go through the facade.'], ['f', 'leg', '100% to legacy', 'It forwards everything to the old system for now.']] },
    { name: 'Step 2: move one capability', desc: 'Rebuild one capability (say, product search) as a new service.', diagram: SF, steps: [
      ['u', 'f', 'GET /search', 'Search requests arrive.'], ['f', 'new', '/search → new service', 'The facade routes just /search to the new service (optionally comparing results with the old one first).'],
      ['ldb', 'ndb', 'sync data', 'Data the new service needs is synchronised from the legacy database until it becomes the owner.', 'async'], ['f', 'leg', 'everything else', 'Everything else still goes to legacy.']] },
    { name: 'Step 3: retire legacy', desc: 'Repeat until the legacy system serves nothing, then switch it off.', diagram: SF, steps: [['f', 'new', '100% to new services', 'Every route has moved.'], ['leg', 'ldb', 'decommission', 'The legacy system and database are retired.', 'err']] }
  ]);

  var CQ = { nodes: [['u', 'Client', 'client', 0, 1], ['cmd', 'Command API', 'svc', 1.4, 0.3, 'validates rules'], ['es', 'Event store', 'stream', 2.9, 0.3, 'append-only'], ['proj', 'Projector', 'worker', 4.3, 0.3],
    ['rm', 'Read models', 'nosql', 4.3, 1.7, 'per screen'], ['q', 'Query API', 'svc', 1.4, 1.7]], edges: [['u', 'cmd'], ['cmd', 'es'], ['es', 'proj', '', 'async'], ['proj', 'rm'], ['u', 'q'], ['q', 'rm']] };
  SD.multi('#cq-demo', [
    { name: 'Write: command to events', desc: 'Commands are validated against current state and produce events.', diagram: CQ, steps: [
      ['u', 'cmd', 'Withdraw(acct 9, $40)', 'A command arrives.'], ['cmd', 'es', 'load events for acct 9', 'Rebuild the account state by replaying its events (or from a snapshot).'],
      ['cmd', 'es', 'append MoneyWithdrawn (v12)', 'Business rules pass: append a new event with an expected version (optimistic concurrency).'], ['cmd', 'u', '202 / 200', 'The command is accepted.', 'resp']] },
    { name: 'Read: projections', desc: 'Read models are built from events and optimised for queries.', diagram: CQ, steps: [
      ['es', 'proj', 'MoneyWithdrawn', 'A projector subscribes to the event stream.', 'async'], ['proj', 'rm', 'update balance view + statement view', 'It updates denormalised read models: one per screen or query.'],
      ['u', 'q', 'GET /accounts/9', 'Queries hit the read side...'], ['q', 'rm', 'single-key read', '...which is fast and simple, but slightly behind the write side (eventual consistency).'],
      ['rm', 'q', 'balance', 'Rebuilding a read model from scratch is just replaying the events.', 'resp']] }
  ]);

  var CELL = { nodes: [['u', 'Tenants', 'client', 0, 1.2], ['r', 'Cell router', 'gw', 1.3, 1.2, 'tenant → cell map'], ['c1', 'Cell 1', 'svc', 2.8, 0, 'tenants A-F'], ['c2', 'Cell 2', 'svc', 2.8, 1.2, 'tenants G-P'], ['c3', 'Cell 3', 'svc', 2.8, 2.4, 'tenants Q-Z'],
    ['d1', 'Cell 1 data', 'db', 4.2, 0], ['d2', 'Cell 2 data', 'db', 4.2, 1.2], ['d3', 'Cell 3 data', 'db', 4.2, 2.4]],
    edges: [['u', 'r'], ['r', 'c1'], ['r', 'c2'], ['r', 'c3'], ['c1', 'd1'], ['c2', 'd2'], ['c3', 'd3']] };
  SD.multi('#cell-demo', [
    { name: 'Routing', desc: 'The router maps each tenant to its cell; cells share nothing.', diagram: CELL, steps: [['u', 'r', 'tenant "Hoppers" request', 'A request arrives with a tenant id.'], ['r', 'c2', 'H → cell 2', 'The router looks up the tenant’s cell (cached).'], ['c2', 'd2', 'cell-local data', 'Everything happens inside cell 2.']] },
    { name: 'Failure is contained', desc: 'A bad deployment or failure affects one cell only.', diagram: CELL, steps: [
      ['r', 'c3', 'cell 3 broken by a bad deploy', 'Cell 3 fails.', 'err'], { par: [['r', 'c1', 'unaffected'], ['r', 'c2', 'unaffected']], msg: 'Two thirds of tenants never notice; deploy to one cell at a time to keep it that way.' },
      ['r', 'c3', 'roll back cell 3', 'Roll back or move tenants away; the blast radius was a third of the fleet (smaller with more cells).', 'resp']] }
  ]);

  var BF = { nodes: [['m', 'Mobile app', 'mobile', 0, 1.2], ['b', 'Mobile BFF', 'apigw', 1.5, 1.2, 'GraphQL / REST'], ['p', 'Profile svc', 'svc', 3, 0], ['o', 'Orders svc', 'svc', 3, 1.2], ['r', 'Recs svc', 'svc', 3, 2.4]], edges: [['m', 'b'], ['b', 'p'], ['b', 'o'], ['b', 'r']] };
  SD.multi('#bff-demo', [
    { name: 'Chatty client', desc: 'The app calls every service itself over a slow mobile network.', diagram: { nodes: BF.nodes.filter(function (n) { return n[0] !== 'b'; }), edges: [['m', 'p'], ['m', 'o'], ['m', 'r']] }, steps: [
      ['m', 'p', 'GET profile (150 ms)', 'Round trip 1 over a mobile network.'], ['m', 'o', 'GET orders (150 ms)', 'Round trip 2.'], ['m', 'r', 'GET recommendations (150 ms)', 'Round trip 3: slow, battery-hungry, and the app is coupled to every service.', 'err']] },
    { name: 'Backend for frontend', desc: 'One call to a BFF that fans out inside the data centre.', diagram: BF, steps: [
      ['m', 'b', 'query homeScreen { ... }', 'One request over the mobile network, asking for exactly the fields this screen needs.'],
      { par: [['b', 'p', '5 ms'], ['b', 'o', '5 ms'], ['b', 'r', '5 ms']], msg: 'The BFF calls the services in parallel over the fast internal network.' },
      ['b', 'm', 'one tailored response', 'One round trip; the payload is shaped for the screen.', 'resp']] }
  ]);

  ['azStyles', 'azMicro', 'azEventDriven', 'azWebQueue', 'azAksMicro', 'azApi', 'azp-strangler-fig', 'azp-cqrs', 'azp-event-sourcing', 'azp-deployment-stamp', 'azp-backends-for-frontends', 'azp-anti-corruption-layer', 'azp-sidecar', 'azp-asynchronous-request-reply'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsMicro', 'awsStrangler', 'awsEventSourcing', 'awsHexagonal', 'awsAcl', 'awsApiRouting', 'awsScatter', 'awsSaasLens', 'blShuffle'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

$(function () {
  'use strict';
  SD.pageChrome('messaging');
  ['queue', 'pubsub', 'stream'].forEach(function (k) { $('#c-' + k).html(SD.svcHtml(k, 'az')); $('#w-' + k).html(SD.svcHtml(k, 'aws')); });

  // ---------------------------------------------------------------- models
  var Q = { nodes: [['p', 'Producer', 'svc', 0, 1], ['q', 'Queue', 'queue', 1.5, 1], ['w1', 'Worker 1', 'worker', 3, 0.2], ['w2', 'Worker 2', 'worker', 3, 1], ['w3', 'Worker 3', 'worker', 3, 1.8]], edges: [['p', 'q'], ['q', 'w1'], ['q', 'w2'], ['q', 'w3']] };
  var PS = { nodes: [['p', 'Order service', 'svc', 0, 1], ['t', 'Topic: orders', 'bus', 1.5, 1], ['e', 'Email svc', 'svc', 3, 0.2], ['i', 'Inventory svc', 'svc', 3, 1], ['a', 'Analytics', 'svc', 3, 1.8]], edges: [['p', 't'], ['t', 'e'], ['t', 'i'], ['t', 'a']] };
  var LG = { nodes: [['p', 'Producers', 'svc', 0, 1], ['l', 'Log (3 partitions)', 'stream', 1.5, 1, 'retained 7 days'], ['g1', 'Consumer group A', 'worker', 3, 0.3, 'offset 1,042'], ['g2', 'Consumer group B', 'worker', 3, 1.7, 'offset 880 (replaying)']], edges: [['p', 'l'], ['l', 'g1'], ['l', 'g2']] };
  SD.multi('#mq-demo', [
    { name: 'Queue', desc: 'Each message is processed by exactly one of the competing workers.', diagram: Q, steps: [
      ['p', 'q', 'resize image #1, #2, #3', 'The producer enqueues three jobs and moves on.', 'async'],
      { par: [['q', 'w1', 'job #1', 'async'], ['q', 'w2', 'job #2', 'async'], ['q', 'w3', 'job #3', 'async']], msg: 'Each job goes to one worker; more workers = more throughput.' },
      ['w2', 'q', 'ack #2 (delete)', 'A worker acknowledges when done; the message is removed. If it crashes first, the message becomes visible again after a timeout.', 'resp']] },
    { name: 'Pub/sub', desc: 'One event, many independent subscribers.', diagram: PS, steps: [
      ['p', 't', 'OrderPlaced #42', 'The order service publishes one event without knowing who listens.', 'async'],
      { par: [['t', 'e', 'copy', 'async'], ['t', 'i', 'copy', 'async'], ['t', 'a', 'copy', 'async']], msg: 'Every subscription gets its own copy and processes it independently. New subscribers can be added without touching the producer.' }] },
    { name: 'Event log', desc: 'An append-only, partitioned log that consumers read at their own pace and can replay.', diagram: LG, steps: [
      ['p', 'l', 'append (key = customer id)', 'Events are appended to a partition chosen by key, so one customer’s events stay in order.', 'async'],
      ['l', 'g1', 'read from offset 1,042', 'Consumer group A reads new events and commits its offset.', 'async'],
      ['l', 'g2', 'replay from offset 880', 'Group B (say, a new analytics service) replays history from an older offset. Nothing is deleted on read.', 'async']] }
  ]);

  // ---------------------------------------------------------------- idempotency
  var ID = { nodes: [['b', 'Broker', 'queue', 0, 1], ['c', 'Consumer', 'worker', 1.6, 1], ['ded', 'Processed-ids table', 'db', 3.2, 0.2, 'message id → done'], ['acct', 'Accounts DB', 'db', 3.2, 1.8]], edges: [['b', 'c'], ['c', 'ded'], ['c', 'acct']] };
  SD.multi('#idem-demo', [
    { name: 'The duplicate problem', desc: 'At-least-once delivery means a crash can cause a redelivery.', diagram: ID, steps: [
      ['b', 'c', 'msg m7: credit $50', 'The consumer receives a message.', 'async'], ['c', 'acct', 'balance += 50', 'It applies the credit...'], ['c', 'b', 'ack (lost: crash!)', '...and crashes before the acknowledgement reaches the broker.', 'err'],
      ['b', 'c', 'redeliver m7', 'The broker redelivers after the visibility timeout.', 'async'], ['c', 'acct', 'balance += 50 AGAIN', 'Without protection, the customer is credited twice.', 'err']] },
    { name: 'Idempotent consumer', desc: 'Record processed message ids in the same transaction as the effect.', diagram: ID, steps: [
      ['b', 'c', 'msg m7: credit $50', 'First delivery.', 'async'], ['c', 'ded', 'INSERT m7 (unique)', 'In one database transaction: insert the message id...'], ['c', 'acct', 'balance += 50', '...and apply the effect. Commit both together.'],
      ['b', 'c', 'redeliver m7', 'A duplicate arrives.', 'async'], ['c', 'ded', 'INSERT m7 → duplicate key', 'The insert fails: already processed.', 'err'], ['c', 'b', 'ack, skip', 'Acknowledge and do nothing. Exactly-once effect.', 'resp']] }
  ]);

  // ---------------------------------------------------------------- outbox
  var OB = { nodes: [['api', 'Order API', 'svc', 0, 1], ['db', 'Orders DB', 'db', 1.6, 1, 'orders + outbox tables'], ['relay', 'Outbox relay', 'worker', 3.2, 1, 'or CDC'], ['bus', 'Event bus', 'bus', 4.8, 1], ['c', 'Consumers', 'svc', 4.8, 2.2]], edges: [['api', 'db'], ['relay', 'db'], ['relay', 'bus'], ['bus', 'c']] };
  SD.multi('#ob-demo', [
    { name: 'Without outbox', desc: 'Dual write: two separate operations, no atomicity.', diagram: OB, steps: [
      ['api', 'db', 'INSERT order', 'The order is saved.'], ['api', 'bus', 'publish OrderPlaced', 'Then the service tries to publish... and crashes, or the broker is unavailable.', 'err'],
      ['bus', 'c', 'never arrives', 'The order exists but nobody downstream knows: no email, no shipment. (Publishing first and then failing the insert is just as bad.)', 'err']] },
    { name: 'With outbox', desc: 'One local transaction, then reliable asynchronous publishing.', diagram: OB, steps: [
      ['api', 'db', 'BEGIN; INSERT order; INSERT outbox(event); COMMIT', 'The order and the event are written atomically in the same database.'],
      ['relay', 'db', 'poll / read change feed', 'A relay reads unpublished outbox rows (or the database change feed: Cosmos DB change feed, DynamoDB Streams, Debezium).'],
      ['relay', 'bus', 'publish OrderPlaced', 'It publishes them, retrying until successful.', 'async'], ['relay', 'db', 'mark published', 'Then marks them sent. A crash here means the event may be published twice, so consumers must be idempotent.'],
      ['bus', 'c', 'OrderPlaced', 'Downstream services always receive the event.', 'async']] }
  ]);

  // ---------------------------------------------------------------- saga
  var SG = { nodes: [['o', 'Saga orchestrator', 'svc', 1.5, 0, 'workflow'], ['ord', 'Order svc', 'svc', 0, 1.5], ['pay', 'Payment svc', 'svc', 1, 1.5], ['inv', 'Inventory svc', 'svc', 2, 1.5], ['shp', 'Shipping svc', 'svc', 3, 1.5]],
    edges: [['o', 'ord'], ['o', 'pay'], ['o', 'inv'], ['o', 'shp']] };
  SD.multi('#saga-demo', [
    { name: 'Happy path', desc: 'Each step is a local transaction in one service.', diagram: SG, steps: [
      ['o', 'ord', 'create order (PENDING)', 'Step 1.'], ['o', 'pay', 'charge card', 'Step 2.'], ['o', 'inv', 'reserve stock', 'Step 3.'], ['o', 'shp', 'schedule shipment', 'Step 4.'], ['o', 'ord', 'mark CONFIRMED', 'All steps succeeded.', 'resp']] },
    { name: 'Failure + compensation', desc: 'Inventory is out of stock: undo the earlier steps in reverse order.', diagram: SG, steps: [
      ['o', 'ord', 'create order (PENDING)', 'Step 1 succeeds.'], ['o', 'pay', 'charge card', 'Step 2 succeeds.'], ['o', 'inv', 'reserve stock', 'Step 3 fails: out of stock.', 'err'],
      ['o', 'pay', 'compensate: refund', 'The orchestrator runs compensations backwards: refund the payment...', 'err'], ['o', 'ord', 'compensate: CANCELLED', '...and cancel the order. The system is consistent again (eventually).', 'resp']],
      end: 'Compensations must be idempotent and must not fail permanently; design them with retries. Some effects (an email already sent) cannot be undone, only corrected.' }
  ]);

  // ---------------------------------------------------------------- backlog simulator
  var cv = document.getElementById('cc-chart'), g = cv.getContext('2d'), hist = [], backlog = 0, timer = null, t = 0;
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function step() {
    var rate = +$('#cc-rate').val(), n = +$('#cc-n').val();
    if ($('#cc-auto').prop('checked')) {
      var want = Math.min(12, Math.max(1, Math.ceil((rate + backlog / 10) / 25)));
      if (want !== n && t % 3 === 0) { n = n + Math.sign(want - n); $('#cc-n').val(n); }
    }
    var burst = rate * (0.6 + 0.8 * Math.random()) * (t % 40 < 8 ? 1.8 : 1);
    backlog = Math.max(0, backlog + burst - n * 25);
    hist.push([backlog, n]); if (hist.length > 120) hist.shift(); t++;
    $('#cc-rate-v').text(rate); $('#cc-n-v').text(n);
    draw(rate, n);
  }
  function draw(rate, n) {
    var W = cv.width, H = cv.height, m = 30, max = Math.max(200, Math.max.apply(null, hist.map(function (x) { return x[0]; })) * 1.1);
    g.fillStyle = css('--bg'); g.fillRect(0, 0, W, H); g.strokeStyle = css('--line'); g.strokeRect(m, 10, W - m - 10, H - m - 10);
    g.strokeStyle = css('--accent'); g.lineWidth = 2.5; g.beginPath();
    hist.forEach(function (p, i) { var x = m + i / 119 * (W - m - 10), y = H - m - p[0] / max * (H - m - 20); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
    g.strokeStyle = css('--good'); g.lineWidth = 1.5; g.beginPath();
    hist.forEach(function (p, i) { var x = m + i / 119 * (W - m - 10), y = H - m - p[1] / 12 * (H - m - 20); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
    g.fillStyle = css('--muted'); g.font = '12px system-ui'; g.fillText('blue = queue backlog (messages), green = consumers (0-12)', m + 6, 24);
    var cap = n * 25;
    $('#cc-out').html('Consumer capacity <b>' + cap + '</b> msgs/s vs average producer rate <b>' + rate + '</b> msgs/s (with periodic bursts). Backlog now <b>' + Math.round(backlog) + '</b>' +
      (cap < rate ? ' and growing: add consumers or throttle producers.' : ' and draining between bursts.'));
  }
  $('#cc-run').on('click', function () { if (timer) { clearInterval(timer); timer = null; $(this).text('Start'); } else { timer = setInterval(step, 200); $(this).text('Pause'); } });
  $('#cc-rate, #cc-n').on('input', function () { $('#cc-rate-v').text($('#cc-rate').val()); $('#cc-n-v').text($('#cc-n').val()); });
  for (var i = 0; i < 60; i++) step();

  ['azMessaging', 'azEventDriven', 'azp-competing-consumers', 'azp-queue-based-load-leveling', 'azp-publisher-subscriber', 'azp-claim-check', 'azp-saga', 'azp-choreography', 'azp-compensating-transaction', 'azOutbox', 'azp-asynchronous-request-reply'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  ['awsPubSub', 'awsOutbox', 'awsSaga', 'awsSagaOrch', 'awsSagaChor', 'awsEventSourcing', 'blBacklog'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
});

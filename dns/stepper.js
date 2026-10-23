$(function () {
  'use strict';

  var NODES = [
    { id: 'you',  label: 'You',               sub: 'browser + OS' },
    { id: 'rec',  label: 'Resolver',          sub: 'recursive, cached' },
    { id: 'root', label: 'Root',              sub: '.' },
    { id: 'tld',  label: 'TLD',               sub: '.com' },
    { id: 'auth', label: 'Authoritative',     sub: 'example.com' }
  ];

  // dir: 'q' = question, 'r' = response
  var SCENARIOS = {
    cold: [
      { from: 'you',  to: 'rec',  dir: 'q', text: 'Browser and OS caches missed, so the stub resolver asks the configured resolver: "What is the address of www.example.com?"' },
      { from: 'rec',  to: 'root', dir: 'q', text: 'The resolver has nothing cached, so it asks a root server: "www.example.com?"' },
      { from: 'root', to: 'rec',  dir: 'r', text: 'The root does not know the host, but replies with a referral: "The .com zone is run by these servers" (NS records plus glue IPs).' },
      { from: 'rec',  to: 'tld',  dir: 'q', text: 'The resolver asks a .com server: "www.example.com?"' },
      { from: 'tld',  to: 'rec',  dir: 'r', text: 'Another referral: "example.com is run by ns1.example.net and ns2.example.net" (NS records, cached by the resolver).' },
      { from: 'rec',  to: 'auth', dir: 'q', text: 'The resolver asks the authoritative server for example.com: "www.example.com?"' },
      { from: 'auth', to: 'rec',  dir: 'r', text: 'The final answer: "www.example.com A 203.0.113.10, TTL 300". This is the only server that actually owns the data.' },
      { from: 'rec',  to: 'you',  dir: 'r', text: 'The resolver caches the answer for 300 seconds and returns it. The browser can now open a connection to 203.0.113.10.' }
    ],
    ns: [
      { from: 'you',  to: 'rec',  dir: 'q', text: 'Browser and OS caches missed, so the stub resolver asks the resolver: "What is the address of www.example.com?"' },
      { from: 'rec',  to: 'rec',  dir: 'q', text: 'The resolver has no answer for this exact name, but it already cached who runs .com and example.com (their NS records have long TTLs). It skips the root and TLD servers entirely.' },
      { from: 'rec',  to: 'auth', dir: 'q', text: 'It goes straight to the authoritative server: "www.example.com?"' },
      { from: 'auth', to: 'rec',  dir: 'r', text: 'The answer: "www.example.com A 203.0.113.10, TTL 300".' },
      { from: 'rec',  to: 'you',  dir: 'r', text: 'The resolver caches the answer for 300 seconds and returns it. One upstream query instead of three.' }
    ],
    hit: [
      { from: 'you',  to: 'rec',  dir: 'q', text: 'Browser and OS caches missed, so the stub resolver asks the resolver: "What is the address of www.example.com?"' },
      { from: 'rec',  to: 'you',  dir: 'r', text: 'Another user asked a moment ago and the TTL (300 s) has not expired, so the resolver answers from its cache immediately. No upstream query at all. This is the common case.' }
    ]
  };

  var steps = SCENARIOS.cold;
  var i = -1; // -1 = not started

  var $nodes = $('#dns-nodes');
  NODES.forEach(function (n) {
    $('<div class="node">').attr('data-id', n.id)
      .append($('<strong>').text(n.label), $('<small>').text(n.sub))
      .appendTo($nodes);
  });

  function render() {
    $nodes.children().removeClass('from to');
    var $msg = $('#dns-msg').empty();

    if (i < 0) {
      $('#dns-stepno').text('Ready');
      $msg.text('Press Next to send the first query.');
    } else {
      var s = steps[i];
      $nodes.children('[data-id="' + s.from + '"]').addClass('from');
      $nodes.children('[data-id="' + s.to + '"]').addClass('to');
      $('#dns-stepno').text('Step ' + (i + 1) + ' of ' + steps.length);
      $msg.append($('<span class="dir ' + s.dir + '">').text(s.dir === 'q' ? 'Query: ' : 'Response: '), document.createTextNode(s.text));
    }
    $('#dns-prev').prop('disabled', i < 0);
    $('#dns-next').prop('disabled', i >= steps.length - 1);
  }

  $('#dns-next').on('click', function () { if (i < steps.length - 1) { i++; render(); } });
  $('#dns-prev').on('click', function () { if (i >= 0) { i--; render(); } });
  $('#dns-reset').on('click', function () { i = -1; render(); });
  $('#dns-scenario').on('change', function () { steps = SCENARIOS[this.value]; i = -1; render(); });

  render();
});

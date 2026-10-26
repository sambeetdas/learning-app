$(function () {
  'use strict';
  SD.pageChrome('security-ops');

  var O = { nodes: [['u', 'User + browser', 'client', 0, 1], ['app', 'Web app / SPA', 'svc', 1.5, 1], ['idp', 'Identity provider', 'ext', 3, 0, 'Entra ID / Cognito'], ['api', 'API', 'svc', 3, 2, 'validates JWT']],
    edges: [['u', 'app'], ['app', 'idp'], ['u', 'idp'], ['app', 'api']] };
  var S2S = { nodes: [['svc', 'Orders service', 'svc', 0, 1, 'managed identity'], ['meta', 'Identity endpoint', 'ext', 1.6, 0, 'Entra ID / IAM'], ['db', 'Database', 'db', 3.2, 1, 'trusts the identity'], ['kv', 'Key Vault / Secrets Manager', 'ext', 1.6, 2]],
    edges: [['svc', 'meta'], ['svc', 'db'], ['svc', 'kv']] };
  SD.multi('#oauth-demo', [
    { name: 'User login', desc: 'The standard, secure way for web and mobile apps to log users in and call APIs.', diagram: O, steps: [
      ['u', 'app', 'click "Sign in"', 'The user wants to sign in.'], ['app', 'u', 'redirect to IdP + code_challenge', 'The app generates a random code verifier, keeps it, and redirects the browser to the identity provider with a hash of it (PKCE) and the requested scopes.', 'resp'],
      ['u', 'idp', 'log in (password + MFA)', 'The user authenticates with the identity provider directly; the app never sees the password.'],
      ['idp', 'u', 'redirect back with one-time code', 'The IdP redirects back to the app with a short-lived authorisation code.', 'resp'],
      ['app', 'idp', 'code + code_verifier', 'The app exchanges the code for tokens, proving it started the flow (PKCE).'],
      ['idp', 'app', 'ID token + access token + refresh token', 'It receives an ID token (who the user is), a short-lived access token (for APIs) and a refresh token.', 'resp'],
      ['app', 'api', 'GET /orders, Bearer access token', 'API calls carry the access token.'], ['api', 'app', 'orders (after checking signature, audience, expiry, scopes)', 'The API validates the JWT locally with the IdP’s public keys and checks the user may see these orders.', 'resp']] },
    { name: 'Service to service', desc: 'No passwords in config: the platform gives the workload an identity.', diagram: S2S, steps: [
      ['svc', 'meta', 'request token for "database"', 'The service asks the platform’s local identity endpoint for a token (Azure managed identity, AWS IAM role).'],
      ['meta', 'svc', 'short-lived token', 'It gets a token without ever holding a long-lived secret.', 'resp'], ['svc', 'db', 'connect with token', 'The database is configured to trust that identity, with least-privilege permissions.'],
      ['svc', 'kv', 'read API key for a third party (if needed)', 'Secrets that must exist live in a vault, fetched at run time and rotated automatically.']] }
  ]);

  // ---------------------------------------------------------------- trace waterfall
  var TR = {
    ok: [['gateway', 0, 180, 0], ['auth: validate token', 2, 3, 1], ['orders.GetOrder', 6, 170, 1], ['cache GET order:42', 8, 1, 2], ['db SELECT order', 10, 22, 2], ['catalog.GetItems', 35, 60, 2], ['db SELECT items', 40, 45, 3], ['pricing.Quote', 98, 70, 2], ['render JSON', 170, 5, 1]],
    slow: [['gateway', 0, 1900, 0], ['auth: validate token', 2, 3, 1], ['orders.GetOrder', 6, 1890, 1], ['cache GET order:42 (miss)', 8, 1, 2], ['db SELECT order', 10, 25, 2], ['catalog.GetItems', 38, 62, 2], ['pricing.Quote', 102, 1780, 2], ['tax-service (timeout + retry)', 110, 1500, 3], ['tax-service retry', 1615, 250, 3], ['render JSON', 1885, 5, 1]]
  };
  function trace() {
    var s = $('#tr-s').val(), spans = TR[s], total = spans[0][2], $t = $('#trace').empty();
    spans.forEach(function (sp) {
      var slow = sp[2] > total * 0.4 && sp[3] > 1;
      $t.append('<div style="display:grid;grid-template-columns:minmax(0,15rem) 1fr;gap:.5rem;align-items:center;font-size:.8rem;margin:2px 0"><span style="padding-left:' + sp[3] * 1 + 'rem">' + sp[0] + '</span>' +
        '<span style="position:relative;height:1.1rem;background:var(--panel)"><span style="position:absolute;left:' + (sp[1] / total * 100) + '%;width:' + Math.max(0.6, sp[2] / total * 100) + '%;top:0;bottom:0;border-radius:3px;background:' + (slow ? 'var(--bad)' : 'var(--accent)') + '"></span>' +
        '<span style="position:absolute;right:4px;top:0;font-size:.72rem;color:var(--muted)">' + sp[2] + ' ms</span></span></div>');
    });
    $('#trace-msg').text(s === 'ok' ? 'Each bar is a span: one unit of work in one service. Nesting shows who called whom; the whole request took 180 ms, spread fairly evenly.' :
      'The trace makes the cause obvious: pricing waited 1.5 s for the tax service to time out, then retried. Fixes: a tighter timeout, a circuit breaker, caching tax rates, or calling tax in parallel.');
  }
  $('#tr-s').on('change', trace); trace();

  // ---------------------------------------------------------------- error budget
  function slo() {
    var s = +$('#slo').val() / 100, w = +$('#win').val(), rpd = +$('#rpd').val(), e = +$('#err').val() / 100;
    var budget = (1 - s) * rpd * w, mins = (1 - s) * w * 1440, burn = (1 - s) > 0 ? e / (1 - s) : Infinity, days = burn > 0 ? w / burn : Infinity;
    $('#slo-out').html('Error budget: <b>' + Math.round(budget).toLocaleString() + '</b> failed requests (or about <b>' + mins.toFixed(0) + ' minutes</b> of full outage) per ' + w + ' days. ' +
      'Current burn rate: <b>' + (isFinite(burn) ? burn.toFixed(1) : '∞') + '&times;</b> ' + (burn > 1 ? '&rArr; the budget is gone in <b>' + days.toFixed(1) + ' days</b>. ' + (burn >= 14 ? 'Page someone now (fast-burn alert).' : burn >= 3 ? 'Open a ticket (slow-burn alert).' : 'Watch it.') : '&rArr; within budget.'));
  }
  $('#slo, #win, #rpd, #err').on('input', slo); slo();

  ['azWaf', 'azp-federated-identity', 'azp-gatekeeper', 'azp-valet-key', 'azMonitoring', 'azp-health-endpoint-monitoring'].forEach(function (k) { $('#ref-az').append('<li>' + SD.refHtml(k) + '</li>'); });
  $('#ref-az').append('<li>Identity: ' + SD.svcHtml('identity', 'az') + ', ' + SD.svcHtml('workforce', 'az') + '</li><li>Secrets: ' + SD.svcHtml('secrets', 'az') + '</li><li>Monitoring: ' + SD.svcHtml('monitor', 'az') + '</li>');
  ['awsWaf', 'blInstrument', 'blHealth', 'awsWafAuto'].forEach(function (k) { $('#ref-aws').append('<li>' + SD.refHtml(k) + '</li>'); });
  $('#ref-aws').append('<li>Identity: ' + SD.svcHtml('identity', 'aws') + ', ' + SD.svcHtml('workforce', 'aws') + '</li><li>Secrets: ' + SD.svcHtml('secrets', 'aws') + '</li><li>Monitoring: ' + SD.svcHtml('monitor', 'aws') + '</li>');
});

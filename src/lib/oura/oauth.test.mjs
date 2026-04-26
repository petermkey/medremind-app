import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOuraAuthorizationUrl, parseOuraScopes } from './oauth.ts';

test('parseOuraScopes trims whitespace and keeps scope order', () => {
  assert.deepEqual(
    parseOuraScopes(' email  personal daily heartrate  spo2 '),
    ['email', 'personal', 'daily', 'heartrate', 'spo2'],
  );
});

test('buildOuraAuthorizationUrl creates the Oura authorization-code URL', () => {
  const url = buildOuraAuthorizationUrl({
    authorizationUrl: 'https://cloud.ouraring.com/oauth/authorize',
    clientId: 'client-id',
    redirectUri: 'http://localhost:3000/api/integrations/oura/callback',
    scopes: ['daily', 'heartrate', 'spo2'],
    state: 'state-123',
  });

  assert.equal(url.origin, 'https://cloud.ouraring.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'http://localhost:3000/api/integrations/oura/callback',
  );
  assert.equal(url.searchParams.get('scope'), 'daily heartrate spo2');
  assert.equal(url.searchParams.get('state'), 'state-123');
});

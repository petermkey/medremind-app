import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOuraAuthorizationUrl,
  createOuraOAuthState,
  parseOuraScopes,
  supportedOuraScopes,
  validateOuraOAuthState,
} from './oauth.ts';

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

test('supportedOuraScopes removes unsupported Oura scopes', () => {
  assert.deepEqual(
    supportedOuraScopes('email personal daily heartrate tag workout session spo2 ring_configuration stress heart_health'),
    ['email', 'personal', 'daily', 'heartrate', 'tag', 'workout', 'session', 'spo2'],
  );
});

test('createOuraOAuthState includes a nonce and user binding', () => {
  const state = createOuraOAuthState({
    userId: 'user-123',
    now: new Date('2026-04-26T10:00:00.000Z'),
  });
  const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));

  assert.equal(typeof parsed.nonce, 'string');
  assert.ok(parsed.nonce.length >= 32);
  assert.equal(parsed.issuedAt, '2026-04-26T10:00:00.000Z');
  assert.equal(typeof parsed.userBinding, 'string');
  assert.notEqual(parsed.userBinding, 'user-123');
});

test('validateOuraOAuthState accepts only matching unexpired state for the same user', () => {
  const state = createOuraOAuthState({
    userId: 'user-123',
    now: new Date('2026-04-26T10:00:00.000Z'),
  });

  assert.equal(
    validateOuraOAuthState({
      state,
      expectedState: state,
      userId: 'user-123',
      now: new Date('2026-04-26T10:09:59.000Z'),
    }),
    true,
  );
  assert.equal(
    validateOuraOAuthState({
      state,
      expectedState: `${state}x`,
      userId: 'user-123',
      now: new Date('2026-04-26T10:00:00.000Z'),
    }),
    false,
  );
  assert.equal(
    validateOuraOAuthState({
      state,
      expectedState: state,
      userId: 'user-456',
      now: new Date('2026-04-26T10:00:00.000Z'),
    }),
    false,
  );
  assert.equal(
    validateOuraOAuthState({
      state,
      expectedState: state,
      userId: 'user-123',
      now: new Date('2026-04-26T10:10:01.000Z'),
    }),
    false,
  );
});

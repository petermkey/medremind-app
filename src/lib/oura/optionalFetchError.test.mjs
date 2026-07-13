import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyOptionalOuraError } from './optionalFetchError.ts';
import { OuraApiError } from './client.ts';

test('classifyOptionalOuraError treats 401 as an auth/scope problem, not silent data absence', () => {
  const result = classifyOptionalOuraError(
    new OuraApiError('Token is not authorized access heart_health scope.', 401),
    '/v2/usercollection/vO2_max',
  );
  assert.deepEqual(result.data, []);
  assert.ok(result.authError);
  assert.equal(result.authError.httpStatus, 401);
  assert.equal(result.authError.endpoint, '/v2/usercollection/vO2_max');
  assert.equal(result.authError.message, 'Token is not authorized access heart_health scope.');
});

test('classifyOptionalOuraError treats 403/404 as a genuinely unavailable feature, no error', () => {
  for (const status of [403, 404]) {
    const result = classifyOptionalOuraError(new OuraApiError('not found', status), '/v2/usercollection/enhanced_tag');
    assert.deepEqual(result, { data: [] });
  }
});

test('classifyOptionalOuraError rethrows any other error', () => {
  assert.throws(
    () => classifyOptionalOuraError(new OuraApiError('server error', 500), '/v2/usercollection/sleep'),
    /server error/,
  );
  assert.throws(
    () => classifyOptionalOuraError(new Error('network blew up'), '/v2/usercollection/sleep'),
    /network blew up/,
  );
});

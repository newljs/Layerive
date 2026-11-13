// Key pool: rotation, cooldown and the failure classes that must NOT rotate.
// These run without any network access; `attempt` is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireKey,
  isKeyRotationError,
  isTransientPlatformError,
  keyPoolStatus,
  markKeyFailure,
  markKeySuccess,
  modelKeys,
  resetKeyPool,
  withKeyPool,
} from './key-pool.mjs';
import { bearerHeaders } from './models.mjs';

const delay = () => Promise.resolve();

function model(keys, id = 'pool-test') {
  return { id, provider: 'sensenova', apiKey: keys[0] || '', apiKeys: keys, baseUrl: 'https://token.sensenova.cn/v1', model: 'sensenova-u1.5-lite' };
}

function httpError(status, message) {
  return Object.assign(new Error(message || `HTTP ${status}`), { status });
}

test.beforeEach(() => resetKeyPool());

test('modelKeys dedupes, trims and ignores masks', () => {
  assert.deepEqual(modelKeys({ apiKeys: [' a ', 'b', 'a', '', '••••••••'] }), ['a', 'b']);
  assert.deepEqual(modelKeys({ apiKey: 'solo' }), ['solo']);
  assert.deepEqual(modelKeys({}), []);
});

test('rotation errors cover auth and rate limits but not platform faults', () => {
  assert.equal(isKeyRotationError(httpError(401)), true);
  assert.equal(isKeyRotationError(httpError(403)), true);
  assert.equal(isKeyRotationError(httpError(429)), true);
  assert.equal(isKeyRotationError(httpError(400, 'invalid api key')), true);
  // A 500 or a timeout fails every key the same way; rotating would just burn
  // each credential's cooldown for nothing.
  assert.equal(isKeyRotationError(httpError(500)), false);
  assert.equal(isKeyRotationError(httpError(400, 'image too large')), false);
  assert.equal(isTransientPlatformError(httpError(503)), true);
});

test('a rejected key rotates to the next one and the winner is remembered', async () => {
  const target = model(['bad', 'good']);
  const seen = [];
  const result = await withKeyPool(target, {
    delay,
    attempt: async (keyed) => {
      seen.push(keyed.apiKey);
      if (keyed.apiKey === 'bad') throw httpError(401, 'invalid api key');
      return { ok: true, key: keyed.apiKey };
    },
  });
  assert.deepEqual(result, { ok: true, key: 'good' });
  assert.deepEqual(seen, ['bad', 'good']);
  const status = keyPoolStatus(target);
  assert.equal(status[0].cooling, true, 'the rejected key is parked');
  assert.equal(status[1].cooling, false, 'the healthy key stays available');
  assert.equal(status[1].successCount, 1);
});

test('a rate-limited key is skipped by the next request', async () => {
  const target = model(['k1', 'k2']);
  const used = [];
  const run = () => withKeyPool(target, {
    delay,
    attempt: async (keyed) => { used.push(keyed.apiKey); throw httpError(429, 'rps exhausted'); },
  });
  await assert.rejects(run);
  const afterFirst = used.length;
  assert.equal(afterFirst, 2, 'both keys are tried before giving up');
  await assert.rejects(run);
  // Both keys are cooling, so the second call waits for the shortest cooldown
  // instead of immediately hammering the platform again.
  assert.ok(used.length >= afterFirst);
  assert.equal(keyPoolStatus(target).every((entry) => entry.cooling), true);
});

test('a successful call clears the key failure counters', () => {
  const target = model(['k1', 'k2']);
  markKeyFailure(target, 'k2', httpError(429));
  markKeyFailure(target, 'k2', httpError(429));
  const parked = keyPoolStatus(target)[1];
  assert.equal(parked.failures, 2);
  assert.equal(parked.failureCount, 2, 'the lifetime counter keeps both failures');
  assert.equal(parked.cooling, true);
  markKeySuccess(target, 'k2');
  const healthy = keyPoolStatus(target)[1];
  assert.equal(healthy.failures, 0, 'consecutive failures reset on success');
  assert.equal(healthy.failureCount, 2, 'the lifetime counter is historical');
  assert.equal(healthy.cooling, false, 'success lifts the cooldown');
  assert.equal(healthy.successCount, 1);
});

test('a single key passes straight through without extra retries', async () => {
  const target = model(['only']);
  let calls = 0;
  await assert.rejects(withKeyPool(target, {
    delay,
    attempt: async () => { calls += 1; throw httpError(429, 'rps exhausted'); },
  }));
  assert.equal(calls, 1, 'no rotation target exists, so the caller keeps its own retry budget');
  // Nothing was parked: a solo key is never cooled down by the pool itself.
  assert.equal(keyPoolStatus(target)[0].cooling, false);
});

test('non-rotation failures surface immediately without draining the pool', async () => {
  const target = model(['k1', 'k2', 'k3']);
  const seen = [];
  await assert.rejects(withKeyPool(target, {
    delay,
    attempt: async (keyed) => { seen.push(keyed.apiKey); throw httpError(400, 'image should be smaller'); },
  }), /image should be smaller/);
  assert.deepEqual(seen, ['k1'], 'a bad request must not consume every key');
});

test('every key failing raises a dedicated all-keys error', async () => {
  const target = model(['k1', 'k2']);
  await assert.rejects(withKeyPool(target, {
    delay,
    attempt: async () => { throw httpError(401, 'invalid api key'); },
  }), (error) => error.status === 401);
});

test('a parked key reports its remaining cooldown and frees up afterwards', () => {
  const target = model(['k1', 'k2']);
  markKeyFailure(target, 'k1', httpError(401));
  assert.equal(acquireKey(target, { exclude: ['k2'] }), null, 'k1 is still cooling down');
  const waited = acquireKey(target, { exclude: ['k2'], wait: true });
  assert.ok(waited.waitedMs > 0, 'the pool reports how long until a key frees up');
  // Once the cooldown elapses the key is selectable again.
  const later = Date.now() + 10 * 60 * 1000;
  assert.equal(acquireKey(target, { exclude: ['k2'], now: later })?.key, 'k1');
});

test('a cancelled task stops waiting for a cooldown', async () => {
  const target = model(['k1', 'k2']);
  markKeyFailure(target, 'k1', httpError(401));
  markKeyFailure(target, 'k2', httpError(401));
  const controller = new AbortController();
  const pending = withKeyPool(target, {
    delay: (ms, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    }),
    signal: controller.signal,
    attempt: async () => ({ ok: true }),
  });
  controller.abort();
  await assert.rejects(pending);
});

// The pool hands its chosen credential to adapters through `model.apiKey`. A
// helper that reads `apiKeys[0]` first would silently pin every request to the
// first key, so rotation would look healthy while the pool burned one key.
test('bearerHeaders prefers the rotated key over the first configured one', () => {
  const model = { apiKey: 'SELECTED', apiKeys: ['FIRST', 'SELECTED', 'THIRD'] };
  assert.equal(bearerHeaders(model).Authorization, 'Bearer SELECTED');
  assert.equal(bearerHeaders(model, 'EXPLICIT').Authorization, 'Bearer EXPLICIT');
  assert.equal(bearerHeaders({ apiKeys: ['ONLY'] }).Authorization, 'Bearer ONLY');
  assert.deepEqual(bearerHeaders({ apiKeys: [] }), {});
});

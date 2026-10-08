import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renameWithRetry } from './file-ops.mjs';

test('import directory moves recover from transient Windows locks and propagate permanent failures', async () => {
  let calls = 0;
  const waits = [];
  await renameWithRetry('staging', 'destination', {
    platform: 'win32', wait: async ms => waits.push(ms),
    move: async (source, target) => {
      assert.equal(source, 'staging'); assert.equal(target, 'destination');
      if (++calls < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    },
  });
  assert.equal(calls, 3); assert.equal(waits.length, 2);
  for (const [platform, code, expectedCalls] of [['win32', 'EPERM', 6], ['win32', 'ENOENT', 1], ['linux', 'EACCES', 1]]) {
    calls = 0;
    const failure = Object.assign(new Error('failed move'), { code });
    await assert.rejects(renameWithRetry('staging', 'destination', {
      platform, wait: async () => {}, move: async () => { calls++; throw failure; },
    }), error => error === failure);
    assert.equal(calls, expectedCalls);
  }
});

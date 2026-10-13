import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { fetchVisionJson } from './vision-request.mjs';

test('vision request deadlines cover response bodies and preserve task cancellation', { timeout: 5000 }, async t => {
  let bodyStarted;
  const bodyReady = new Promise(resolve => { bodyStarted = resolve; });
  const stub = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/body') {
      res.write('{"partial":');
      return;
    }
    if (req.url === '/hold') return;
    res.end('{"ok":true}');
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    stub.closeAllConnections();
    await new Promise(resolve => stub.close(resolve));
  });
  const url = `http://127.0.0.1:${stub.address().port}`;
  const budgets = [];
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', ms => { budgets.push(ms); return nativeTimeout(ms); });
  assert.deepEqual((await fetchVisionJson(url, {})).payload, { ok: true });
  assert.deepEqual((await fetchVisionJson(url, {}, 240000)).payload, { ok: true });
  assert.deepEqual(budgets, [120000, 240000]);

  // Wait until JSON reading actually starts, then expire the deadline.
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args) => {
    const response = await nativeFetch(...args);
    const nativeJson = response.json.bind(response);
    response.json = () => { const reading = nativeJson(); bodyStarted(); return reading; };
    return response;
  });
  const pending = fetchVisionJson(url + '/body', {});
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  await bodyReady;
  deadline.abort(new DOMException('Timed out', 'TimeoutError'));
  await rejected;

  const task = new AbortController();
  const liveDeadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => liveDeadline.signal);
  const canceled = fetchVisionJson(url + '/hold', { signal: task.signal }, 240000);
  const cancellation = assert.rejects(canceled, { name: 'AbortError' });
  task.abort();
  liveDeadline.abort(new DOMException('Timed out', 'TimeoutError'));
  await cancellation;
});

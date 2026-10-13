import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import sharp from 'sharp';
import { callSeedream, callQwen, callFlux, testNativeImageConnection } from './image-providers.mjs';

const params = { size: '1024x1024', count: 2, outputFormat: 'png', quality: 'high', transparent: false };
const models = [
  ['seedream', 'doubao-seedream-5-0-pro-260628', callSeedream],
  ['seedream', 'doubao-seedream-5-0-flash-260915', callSeedream],
  ['qwen', 'qwen-image-3.0-pro', callQwen], ['qwen', 'qwen-image-3.0', callQwen],
  ['qwen', 'qwen-image-2.1-pro', callQwen], ['qwen', 'qwen-image-2.1-turbo', callQwen],
];

async function fixture(t, handler) {
  const calls = [];
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#56789a' } }).png().toBuffer();
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = Buffer.concat(chunks).toString();
      const call = { url: req.url, method: req.method, headers: req.headers, body: data ? JSON.parse(data) : undefined };
      calls.push(call);
      res.setHeader('Content-Type', 'application/json');
      await handler(call, res, png, baseUrl, calls);
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { calls, png, baseUrl, model: { baseUrl, apiKey: 'fixture-key', model: 'flux-2-pro' } };
}

test('Seedream and Qwen: seven request contracts, single/multiple inputs and URL/base64 output', async t => {
  const fx = await fixture(t, (call, res, png, base) => {
    if (call.url === '/output') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
    assert.equal(call.url, '/v1/images/generations');
    const data = call.body.model.startsWith('qwen')
      ? Array.from({ length: call.body.n }, () => ({ url: `${base.replace('/v1', '')}/output` }))
      : [{ b64_json: png.toString('base64') }];
    res.end(JSON.stringify({ data }));
  });
  const inputs = [{ bytes: fx.png, mimeType: 'image/png' }, { bytes: Buffer.from('different-fixture-image'), mimeType: 'image/webp' }];
  for (const [provider, name, run] of models) for (const count of [0, 1, 2]) {
    const first = fx.calls.length;
    const output = await run({ ...fx.model, model: name }, 'fixture prompt', params, inputs.slice(0, count), AbortSignal.timeout(5000));
    assert.equal(output.length, provider === 'qwen' ? 2 : 1);
    assert.deepEqual(output[0].bytes, fx.png);
    const call = fx.calls[first];
    assert.equal(call.headers.authorization, 'Bearer fixture-key');
    assert.match(call.headers['content-type'], /application\/json/);
    assert.equal(call.body.size, '1024x1024');
    assert.equal(call.body.watermark, false);
    assert.equal(call.body.quality, undefined);
    assert.equal(call.body.background, undefined);
    assert.equal(call.body.images, undefined);
    if (!count) assert.equal(call.body.image, undefined);
    else {
      const images = count === 1 ? [call.body.image] : call.body.image;
      assert.deepEqual(images, inputs.slice(0, count).map(input => `data:${input.mimeType};base64,${input.bytes.toString('base64')}`));
    }
    if (provider === 'seedream') {
      assert.equal(call.body.n, undefined);
      assert.equal(call.body.sequential_image_generation, undefined);
      assert.equal(call.body.response_format, 'b64_json');
      assert.equal(call.body.output_format, 'png');
    } else {
      assert.equal(call.body.n, 2);
      assert.equal(call.body.prompt_extend, !count);
      assert.equal(call.body.output_format, undefined);
      assert.equal(call.body.response_format, undefined);
    }
    assert.ok(fx.calls.slice(first).filter(call => call.url === '/output').every(call => !call.headers.authorization && !call.headers['x-key']));
  }
});

test('Qwen 2.1 Alpha instructions, keyless compatible services and model input/size constraints', async t => {
  const fx = await fixture(t, (_call, res, png) => res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })));
  await callQwen({ ...fx.model, model: 'qwen-image-2.1-turbo', apiKey: '' }, 'remove background', { ...params, transparent: true }, [], AbortSignal.timeout(5000));
  assert.equal(fx.calls[0].headers.authorization, undefined);
  assert.match(fx.calls[0].body.prompt, /Alpha/);
  const signal = AbortSignal.timeout(5000);
  for (const run of [callSeedream, callQwen, callFlux]) {
    await assert.rejects(run({ ...fx.model, model: 'qwen-image-3.0-pro' }, 'fixture', { ...params, transparent: true }, [], signal), { code: 'model.transparentUnsupported' });
    await assert.rejects(run(fx.model, 'fixture', { ...params, size: '32x32' }, [], signal), { code: 'model.invalidImageSize' });
  }
  const image = { bytes: fx.png, mimeType: 'image/png' };
  for (const [run, name, limit] of [[callSeedream, 'seedream', 10], [callQwen, 'qwen-image-3.0-pro', 3], [callQwen, 'qwen-image-2.1-pro', 10], [callFlux, 'flux-2-pro', 8]]) {
    await assert.rejects(run({ ...fx.model, model: name }, 'fixture', params, Array(limit + 1).fill(image), signal), { code: 'model.tooManyInputImages' });
  }
  assert.equal(fx.calls.length, 1, 'invalid requests never reach the provider');
});

test('FLUX Pro ordered inputs, regional polling contract, in-place rate-limit retry and credential-free downloads', async t => {
  let polls = 0;
  const fx = await fixture(t, (call, res, png, base) => {
    if (call.method === 'POST') return res.end(JSON.stringify({ id: 'fixture-id', polling_url: `${base}/poll?token=fixture` }));
    if (call.url.startsWith('/v1/poll')) {
      polls += 1;
      if (polls === 1) { res.writeHead(429, { 'Retry-After': '0.01' }); return res.end('{}'); }
      if (polls === 2) return res.end(JSON.stringify({ status: 'Reasoning' }));
      return res.end(JSON.stringify({ status: 'Ready', result: { sample: `${base.replace('/v1', '')}/output` } }));
    }
    res.setHeader('Content-Type', 'image/png'); res.end(png);
  });
  const inputs = [{ bytes: fx.png, mimeType: 'image/png' }, { bytes: Buffer.from('reference-fixture'), mimeType: 'image/png' }];
  const output = await callFlux(fx.model, 'fixture', params, inputs, AbortSignal.timeout(10000));
  assert.deepEqual(output[0].bytes, fx.png);
  assert.equal(fx.calls.filter(call => call.method === 'POST').length, 1, 'a throttled poll cannot resubmit generation');
  assert.deepEqual(fx.calls[0].body, { prompt: 'fixture', width: 1024, height: 1024, output_format: 'png', disable_pup: true, input_image: fx.png.toString('base64'), input_image_2: inputs[1].bytes.toString('base64') });
  assert.ok(fx.calls.filter(call => call.url.startsWith('/v1/')).every(call => call.headers['x-key'] === 'fixture-key' && !call.headers.authorization));
  assert.equal(fx.calls.at(-1).headers['x-key'], undefined);
});

test('FLUX cancellation interrupts pending polling and its delay', async t => {
  const fx = await fixture(t, (call, res, _png, base) => res.end(JSON.stringify(call.method === 'POST' ? { id: 'fixture', polling_url: `${base}/poll` } : { status: 'Pending' })));
  const controller = new AbortController();
  const started = callFlux(fx.model, 'fixture', params, [], controller.signal);
  const observed = Date.now() + 5000;
  while (!fx.calls.some(call => call.method === 'GET') && Date.now() < observed) await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(started, { name: 'AbortError' });
  const count = fx.calls.length;
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(fx.calls.length, count);
  assert.equal(count, 2);
});

test('FLUX rejects malformed/untrusted polling URLs, moderation, error states and missing images', async t => {
  let mode = 'evil-url';
  const fx = await fixture(t, (call, res, _png, base) => {
    if (call.method === 'POST') return res.end(JSON.stringify({ id: 'fixture', polling_url: mode === 'evil-url' ? 'https://bfl.ai.evil.example/poll' : `${base}/poll` }));
    res.end(JSON.stringify({ status: mode, result: {} }));
  });
  const failures = [['evil-url', 'model.invalidPollingUrl'], ['Content Moderated', 'model.safety'], ['Error', 'model.imageTaskFailed'], ['Task not found', 'model.imageTaskFailed'], ['Ready', 'model.invalidImageResponse']];
  for (const [state, code] of failures) {
    mode = state;
    await assert.rejects(callFlux(fx.model, 'fixture', params, [], AbortSignal.timeout(5000)), { code });
  }
  assert.ok(fx.calls.every(call => call.url.startsWith('/v1/')));
});

test('native provider errors retain rate-limit metadata; empty response/download failures are rejected', async t => {
  let mode = 'rate-limit';
  const fx = await fixture(t, (call, res, _png, base) => {
    if (mode === 'rate-limit') { res.writeHead(429, { 'Retry-After': '2' }); return res.end(JSON.stringify({ error: { message: 'fixture rate limit' } })); }
    if (call.url === '/output') { res.writeHead(500); return res.end('{}'); }
    res.end(JSON.stringify(mode === 'empty' ? { data: [] } : { data: [{ url: `${base.replace('/v1', '')}/output` }] }));
  });
  for (const run of [callSeedream, callQwen]) {
    mode = 'rate-limit';
    await assert.rejects(run(fx.model, 'fixture', params, [], AbortSignal.timeout(5000)), { status: 429, retryAfterMs: 2000 });
    mode = 'empty';
    await assert.rejects(run(fx.model, 'fixture', params, [], AbortSignal.timeout(5000)), { code: 'model.invalidImageResponse' });
    mode = 'download-failed';
    await assert.rejects(run(fx.model, 'fixture', params, [], AbortSignal.timeout(5000)), { code: 'model.imageDownloadFailed' });
  }
});

test('read-only connection probes distinguish model listing, BFL auth, endpoint reachability and failures', async t => {
  let mode = 'listed';
  const fx = await fixture(t, (call, res) => {
    if (mode === 'listed') return res.end(JSON.stringify(call.url.endsWith('/credits') ? { credits: 10 } : { data: [{ id: 'flux-2-pro' }] }));
    if (mode === 'missing') return res.end(JSON.stringify({ data: [] }));
    res.writeHead(call.method === 'OPTIONS' ? mode === 'endpoint' ? 405 : 500 : mode === 'endpoint' ? 404 : 401);
    res.end('{}');
  });
  for (const protocol of ['seedream_images', 'qwen_images', 'bfl_flux']) {
    mode = 'listed';
    assert.equal((await testNativeImageConnection(fx.model, protocol, AbortSignal.timeout(5000))).code, protocol === 'bfl_flux' ? 'msg.testFluxOk' : 'msg.testNativeModelOk');
    mode = 'endpoint';
    assert.equal((await testNativeImageConnection(fx.model, protocol, AbortSignal.timeout(5000))).code, 'msg.testNativeEndpointOk');
    mode = 'unauthorized';
    await assert.rejects(testNativeImageConnection(fx.model, protocol, AbortSignal.timeout(5000)), { status: 502 });
  }
  mode = 'missing';
  await assert.rejects(testNativeImageConnection(fx.model, 'qwen_images', AbortSignal.timeout(5000)), { code: 'model.nativeModelNotFound' });
  assert.ok(fx.calls.every(call => ['GET', 'OPTIONS'].includes(call.method)), 'connection tests never generate billable images');
});

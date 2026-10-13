import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { normalizeLocalImage, pixelRect } from './local-edit.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(20); }
  throw new Error('fixture wait timed out');
}
const variants = [
  ['seedream', 'doubao-seedream-5-0-pro-260628', 'seedream_images'],
  ['seedream', 'doubao-seedream-5-0-flash-260915', 'seedream_images'],
  ['qwen', 'qwen-image-3.0-pro', 'qwen_images'], ['qwen', 'qwen-image-3.0', 'qwen_images'],
  ['qwen', 'qwen-image-2.1-pro', 'qwen_images'], ['qwen', 'qwen-image-2.1-turbo', 'qwen_images'],
  ['flux', 'flux-2-pro', 'bfl_flux'],
];
const rect = { x: 25, y: 20, width: 50, height: 60 };
const plan = {
  applicable: true, confidence: 0.95, intent: '替换为参考主体',
  target_rect: { x: 30, y: 25, width: 30, height: 40 }, reference_rect: { x: 20, y: 10, width: 60, height: 70 },
  keep_subjects: ['前景主体'], discard_as_background: ['背景'], reason: '主体清晰', edit_prompt: '执行编辑并保留主体',
};

test('native image APIs: presets, all seven models, generation/editing/fusion/local preservation, batches and cancellation', { timeout: 90000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, 'work', 'native-image-test-'));
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ models: [] }));
  const solid = (width, height, background) => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
  const source = await solid(80, 64, '#123456');
  const reference = await solid(64, 80, '#abcdef');
  const generated = await solid(96, 96, '#44bb55');
  const alpha = await sharp(await solid(80, 64, { r: 0, g: 0, b: 0, alpha: 0 })).composite([{ input: await solid(40, 64, '#44bb55'), left: 0, top: 0 }]).png().toBuffer();
  const calls = [];
  const jobs = new Map();
  let behavior = 'success';
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = Buffer.concat(chunks).toString();
      const body = data ? JSON.parse(data) : null;
      calls.push({ url: req.url, method: req.method, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/output/')) {
        res.setHeader('Content-Type', 'image/png'); res.end(req.url.includes('alpha') ? alpha : generated); return;
      }
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: variants.map(([, id]) => ({ id })) })); return; }
      if (req.url === '/v1/credits') { res.end(JSON.stringify({ credits: 100 })); return; }
      if (req.url === '/v1/chat/completions') {
        const content = body.messages.at(-1).content;
        const prompt = typeof content === 'string' ? content : content.filter(item => item.type === 'text').map(item => item.text).join('\n');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(prompt.includes('different') ? { different: false } : plan) } }] })); return;
      }
      if (req.url.startsWith('/v1/poll/')) {
        const job = jobs.get(req.url);
        if (behavior === 'pending') { res.end(JSON.stringify({ status: 'Pending' })); return; }
        res.end(JSON.stringify({ status: behavior === 'moderated' ? 'Content Moderated' : 'Ready', result: { sample: `${stubBase}/output/${job?.alpha ? 'alpha' : 'opaque'}` } })); return;
      }
      if (req.url === '/v1/images/generations' || req.url === '/v1/flux-2-pro') {
        if (behavior === 'reject') { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'Fixture dual image rejected' } })); return; }
        if (behavior === 'slow') { res.setTimeout(10000, () => res.end('{}')); return; }
        if (req.url.endsWith('/flux-2-pro')) {
          const id = String(jobs.size + 1);
          jobs.set(`/v1/poll/${id}`, {});
          res.end(JSON.stringify({ id, polling_url: `${stubBase}/v1/poll/${id}` })); return;
        }
        const transparent = body.prompt.includes('真实 Alpha');
        const count = body.model.startsWith('qwen') ? body.n : 1;
        res.end(JSON.stringify({ data: Array.from({ length: count }, () => body.model.startsWith('qwen') ? { url: `${stubBase}/output/${transparent ? 'alpha' : 'opaque'}` } : { b64_json: generated.toString('base64') }) })); return;
      }
      res.writeHead(404); res.end('{}');
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const stubBase = `http://127.0.0.1:${stub.address().port}`;
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ models: [
    { id: 'legacy-qwen-protocol', name: 'Protocol-only fixture', type: 'image', provider: 'custom', imageApiFormat: 'qwen_images', model: 'qwen-image-3.0-pro', baseUrl: `${stubBase}/v1`, apiKey: 'fixture-key', capabilities: ['text_to_image'] },
    { id: 'legacy-flux', name: 'Preset-only fixture', type: 'image', provider: 'flux', model: 'flux-2-pro', baseUrl: `${stubBase}/v1`, apiKey: 'fixture-key', capabilities: ['text_to_image'] },
  ] }));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(fixture, 'data'), LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    stub.closeAllConnections(); await new Promise(resolve => stub.close(resolve));
  });
  await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(logs));
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function request(route, body, expected = 200, method = 'POST') {
    const response = await fetch(`${base}/api${route}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  async function finished(projectId, taskId) {
    let task;
    await until(async () => { task = await request(`/projects/${projectId}/tasks/${taskId}`); return task.status !== 'generating'; }); return task;
  }
  async function projectFixture() {
    const { project } = await request('/projects', { name: 'Native image fixture' }, 201);
    const { project: uploaded } = await request(`/projects/${project.id}/images`, { data: source.toString('base64'), mimeType: 'image/png', name: 'source.png' }, 201);
    const ref = await request(`/projects/${project.id}/images`, { data: reference.toString('base64'), mimeType: 'image/png', name: 'reference.png', referenceOnly: true }, 201);
    return { id: project.id, imageId: uploaded.currentImageId, referenceId: ref.image?.id || ref.images.find(image => image.sourceType === 'fusion_reference').id };
  }
  const { model: vision } = await request('/models', { name: 'Fixture vision', type: 'vision', provider: 'custom', model: 'fixture-vision', baseUrl: `${stubBase}/v1`, apiKey: 'fixture-key' }, 201);
  const legacy = (await request('/models')).models;
  assert.deepEqual(legacy.find(model => model.id === 'legacy-qwen-protocol').outputFormats, ['png']);
  assert.equal(legacy.find(model => model.id === 'legacy-flux').imageApiFormat, 'bfl_flux');
  const saved = [];
  for (const [provider, name, protocol] of variants) {
    const { model } = await request('/models', { name, type: 'image', provider, model: name, apiKey: 'fixture-key', capabilities: ['text_to_image', 'edit_prompt'] }, 201);
    assert.equal(model.imageApiFormat, protocol);
    assert.equal(model.maxCount, 4);
    assert.equal(model.transparentBackground, /^qwen-image-2\.1-/.test(name));
    assert.equal(model.apiKey, '••••••••');
    assert.ok(model.baseUrl.startsWith('https://'));
    await request(`/models/${model.id}`, { ...model, baseUrl: `${stubBase}/v1/images/generations` }, 200, 'PATCH');
    const check = await request('/models/test-config', { ...model, apiKey: '••••••••', baseUrl: `${stubBase}/v1` });
    assert.equal(check.ok, true); assert.ok(check.message);
    saved.push(model);
    const fixture = await projectFixture();
    const generate = async (extra, count = 1) => {
      const started = await request(`/projects/${fixture.id}/generate`, { modelId: model.id, visionModelId: vision.id, prompt: 'Fixture image', params: { size: '1024x1024', count }, ...extra }, 202);
      assert.equal((await finished(fixture.id, started.taskId)).status, 'success');
      return (await request(`/projects/${fixture.id}`)).versions.find(version => version.outputs.length === count && version.operation !== 'upload');
    };
    const first = calls.length;
    await generate({ operation: 'text_to_image' }, 2);
    const imageCalls = calls.slice(first).filter(call => call.method === 'POST' && !call.url.endsWith('chat/completions'));
    assert.equal(imageCalls.length, provider === 'qwen' ? 1 : 2);
    assert.ok(imageCalls.every(call => !call.body.image && !call.body.input_image));
    assert.equal((await request(`/projects/${fixture.id}`)).versions.filter(version => version.operation === 'text_to_image').at(-1).outputs.length, 2);
    const editStart = calls.length;
    await generate({ operation: 'edit_prompt', inputImageId: fixture.imageId });
    const single = calls.slice(editStart).find(call => call.method === 'POST' && !call.url.endsWith('chat/completions'));
    assert.equal(single.url, provider === 'flux' ? '/v1/flux-2-pro' : '/v1/images/generations');
    const singleBytes = Buffer.from(provider === 'flux' ? single.body.input_image : single.body.image.split(',')[1], 'base64');
    assert.deepEqual(singleBytes, source);
    const normalized = [await normalizeLocalImage(source), await normalizeLocalImage(reference, true)];
    function assertDual(call) {
      const bytes = provider === 'flux' ? [call.body.input_image, call.body.input_image_2].map(image => Buffer.from(image, 'base64')) : call.body.image.map(image => Buffer.from(image.split(',')[1], 'base64'));
      assert.equal(bytes.length, 2);
      bytes.forEach((image, index) => assert.deepEqual(image, normalized[index].buffer));
    }
    const localStart = calls.length;
    const local = await request(`/projects/${fixture.id}/local-edit`, { imageId: fixture.imageId, modelId: model.id, visionModelId: vision.id, instruction: '', reference: { data: reference.toString('base64'), mimeType: 'image/png' }, rect, params: { size: '1024x1024', count: 2 } }, 202);
    const localTask = await finished(fixture.id, local.taskId);
    assert.equal(localTask.status, 'success', localTask.error);
    const dualCalls = calls.slice(localStart).filter(call => call.method === 'POST' && !call.url.endsWith('chat/completions'));
    dualCalls.forEach(assertDual);
    const bundle = await request(`/projects/${fixture.id}`);
    const version = bundle.versions.find(version => version.operation === 'local_edit');
    assert.equal(version.outputs.length, 2);
    assert.equal(version.inputs.length, 2);
    const box = pixelRect(rect, 80, 64);
    const original = await sharp(source).ensureAlpha().raw().toBuffer();
    for (const output of version.outputs) {
      assert.equal(output.width, 80); assert.equal(output.height, 64);
      const bytes = Buffer.from(await (await fetch(base + output.url)).arrayBuffer());
      const changed = await sharp(bytes).ensureAlpha().raw().toBuffer();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 80; x++) {
        if (x < box.left || x >= box.left + box.width || y < box.top || y >= box.top + box.height) {
          const offset = (y * 80 + x) * 4;
          assert.deepEqual(changed.subarray(offset, offset + 4), original.subarray(offset, offset + 4));
        }
      }
    }
    const fusionStart = calls.length;
    const fusion = await request(`/projects/${fixture.id}/fusion`, { imageId: fixture.imageId, referenceImageId: fixture.referenceId, modelId: model.id, visionModelId: vision.id, mode: 'basic', point: { x: 50, y: 50 }, params: { size: '1024x1024' } }, 202);
    const fusionTask = await finished(fixture.id, fusion.taskId);
    assert.equal(fusionTask.status, 'success', fusionTask.error);
    assertDual(calls.slice(fusionStart).find(call => call.method === 'POST' && !call.url.endsWith('chat/completions')));
    const modelLogs = await request(`/projects/${fixture.id}/model-logs`);
    const serialized = JSON.stringify(modelLogs);
    assert.ok(modelLogs.logs.some(log => log.request.inputImageCount === 2));
    assert.ok(!serialized.includes('fixture-key') && !serialized.includes(source.toString('base64')) && !serialized.includes(reference.toString('base64')));
  }
  // Protocol selection remains independent of the preset and URL.
  const { model: custom } = await request('/models', { name: 'Custom Qwen gateway', type: 'image', provider: 'custom', imageApiFormat: 'qwen_images', model: 'qwen-image-3.0-pro', baseUrl: `${stubBase}/v1`, apiKey: 'fixture-key', outputFormats: ['webp'], transparentBackground: true }, 201);
  assert.equal(custom.provider, 'custom'); assert.equal(custom.imageApiFormat, 'qwen_images');
  assert.deepEqual(custom.outputFormats, ['png']); assert.equal(custom.transparentBackground, false);
  for (const model of saved) await request('/models', { ...model, id: '', type: 'vision' }, 400);
  const reloaded = (await request('/models')).models;
  assert.ok(saved.every(model => reloaded.some(item => item.id === model.id && item.imageApiFormat === model.imageApiFormat && item.provider === model.provider)));
  // Both Qwen 2.1 variants use the existing background-removal Alpha validator.
  for (const model of saved.filter(model => model.transparentBackground)) {
    const fixture = await projectFixture();
    const task = await request(`/projects/${fixture.id}/remove-background`, { imageId: fixture.imageId, modelId: model.id, visionModelId: vision.id }, 202);
    const result = await finished(fixture.id, task.taskId);
    assert.equal(result.status, 'success', result.error);
    assert.equal((await request(`/projects/${fixture.id}`)).versions.find(version => version.operation === 'remove_background').outputs[0].mimeType, 'image/png');
  }
  for (const model of [saved[0], saved[2], saved[6]]) {
    const fixture = await projectFixture();
    await request(`/projects/${fixture.id}/remove-background`, { imageId: fixture.imageId, modelId: model.id, visionModelId: vision.id }, 400);
    // Batch-edit and batch-generate share the same adapter with incremental versions.
    for (const operation of ['batch-edit', 'batch-generate']) {
      const task = await request(`/projects/${fixture.id}/${operation}`, { imageId: fixture.imageId, modelId: model.id, prompts: ['first image', 'second image'] }, 202);
      assert.equal((await finished(fixture.id, task.taskId)).status, 'success');
      const progress = await request(`/projects/${fixture.id}/batch-edits/${task.taskId}`);
      assert.equal(progress.completed, 2);
      assert.equal(progress.items.filter(item => item.image).length, 2);
    }
    behavior = 'reject';
    const before = (await request(`/projects/${fixture.id}`)).versions.length;
    const rejected = await request(`/projects/${fixture.id}/local-edit`, { imageId: fixture.imageId, modelId: model.id, visionModelId: vision.id, instruction: '', reference: { data: reference.toString('base64'), mimeType: 'image/png' }, rect }, 202);
    assert.equal((await finished(fixture.id, rejected.taskId)).status, 'failed');
    assert.equal((await request(`/projects/${fixture.id}`)).versions.length, before);
    behavior = model.provider === 'flux' ? 'pending' : 'slow';
    const first = calls.length;
    const canceled = await request(`/projects/${fixture.id}/generate`, { modelId: model.id, prompt: 'Cancel fixture', params: { count: 1 } }, 202);
    await until(() => calls.slice(first).some(call => model.provider === 'flux' ? call.url.startsWith('/v1/poll/') : call.method === 'POST'));
    await request(`/projects/${fixture.id}/tasks/${canceled.taskId}/cancel`, {});
    assert.equal((await finished(fixture.id, canceled.taskId)).status, 'canceled');
    const afterCancel = calls.length;
    behavior = 'success';
    await pause(650);
    assert.equal(calls.length, afterCancel, 'cancel must stop provider requests');
    assert.equal((await request(`/projects/${fixture.id}`)).versions.length, before);
  }
});

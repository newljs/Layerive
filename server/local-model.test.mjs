import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('local services: persistence, optional auth, image generation/editing and vision', { timeout: 45000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, 'work', 'local-model-test-'));
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ models: [] }));
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#637b9c' } }).png().toBuffer();
  const calls = [];
  let providerStatus = 200;
  const provider = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    calls.push({ url: req.url, auth: req.headers.authorization, contentType: req.headers['content-type'], body });
    res.writeHead(providerStatus, { 'Content-Type': 'application/json' });
    if (providerStatus !== 200) return res.end(JSON.stringify({ error: { message: 'fixture failure' } }));
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'local/image' }] }));
    if (req.url === '/v1/images/generations' || req.url === '/v1/images/edits') return res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    const content = JSON.stringify({ segments: [{ id: 'title', text: 'Local text', context: 'center' }] });
    if (req.url === '/v1/responses') return res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }));
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const serviceUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(fixture, 'data'), LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; } });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const startupDeadline = Date.now() + 15000;
  while (!/http:\/\/127\.0\.0\.1:\d+/.test(logs) && Date.now() < startupDeadline && child.exitCode == null) await pause(30);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, logs);
  async function request(route, input, expected = 200, method = 'POST') {
    const response = await fetch(`${base}/api${route}`, input === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  }
  const imageInput = { name: 'Local image', type: 'image', provider: 'local', model: 'local/image', baseUrl: serviceUrl, apiKey: '', capabilities: ['text_to_image', 'edit_prompt'], sizeOptions: ['1024x1024'] };
  const visionInput = { name: 'Local vision', type: 'vision', provider: 'local', model: 'local/vision', baseUrl: serviceUrl, apiKey: '', apiFormat: 'chat_completions' };
  const { model: imageModel } = await request('/models', imageInput, 201);
  const { model: visionModel } = await request('/models', visionInput, 201);
  const saved = (await request('/models')).models;
  assert.equal(saved.find(m => m.id === imageModel.id).provider, 'local');
  assert.equal(saved.find(m => m.id === visionModel.id).provider, 'local');
  assert.equal(imageModel.transparentBackground, false);
  assert.equal(imageModel.maxCount, 1);
  assert.deepEqual(imageModel.outputFormats, ['png']);
  assert.equal((await request('/models/test-config', imageInput)).ok, true);
  assert.equal((await request('/models/test-config', visionInput)).ok, true);
  await request('/models/test-config', { ...imageInput, model: 'not-loaded' }, 502);
  providerStatus = 500;
  await request('/models/test-config', imageInput, 502);
  providerStatus = 200;
  await request('/models/test-config', { ...imageInput, provider: 'openai' }, 400);
  await request('/models/test-config', { ...visionInput, provider: 'openai' }, 400);
  const { project } = await request('/projects', { name: 'Local fixture' }, 201);
  async function generate(input) {
    const started = await request(`/projects/${project.id}/generate`, { modelId: imageModel.id, prompt: 'A blue square', params: { size: '1024x1024', count: 1 }, ...input }, 202);
    let task;
    for (let i = 0; i < 200; i++) {
      task = await request(`/projects/${project.id}/tasks/${started.taskId}`);
      if (task.status !== 'generating') break;
      await pause(30);
    }
    assert.equal(task.status, 'success', task.error);
  }
  await generate({ operation: 'text_to_image' });
  const bundle = await request(`/projects/${project.id}`);
  const imageId = bundle.versions[0].outputs[0].id;
  await generate({ operation: 'edit_prompt', inputImageId: imageId });
  assert.ok(calls.some(c => c.url === '/v1/images/edits' && c.contentType.startsWith('multipart/form-data')));
  const recognized = await request(`/projects/${project.id}/recognize-text`, { imageId, visionModelId: visionModel.id });
  assert.equal(recognized.segments[0].text, 'Local text');
  assert.ok(calls.some(c => c.url === '/v1/chat/completions' && c.body.includes('image_url')));
  const { model: responsesModel } = await request('/models', { ...visionInput, apiFormat: 'responses' }, 201);
  assert.equal((await request(`/projects/${project.id}/recognize-text`, { imageId, visionModelId: responsesModel.id })).segments[0].text, 'Local text');
  assert.ok(calls.every(c => c.auth === undefined), 'keyless local requests must omit Authorization');
  await request(`/models/${imageModel.id}`, { ...imageInput, apiKey: 'fixture-local-key' }, 200, 'PATCH');
  await request('/models/test-config', { ...imageInput, id: imageModel.id, apiKey: '••••••••' });
  assert.equal(calls.at(-1).auth, 'Bearer fixture-local-key');
  await generate({ operation: 'text_to_image' });
  assert.equal(calls.at(-1).auth, 'Bearer fixture-local-key');
});

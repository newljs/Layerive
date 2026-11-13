import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

// Model names belong to the provider: the settings form asks the upstream
// catalogue instead of trusting a typed string. These tests pin the parsing,
// the modality filter and the credential handling with a local stub provider.

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('the model picker reads the provider catalogue and filters by modality', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const testRoot = await mkdtemp(path.join(root, 'work', 'upstream-models-test-'));
  const configRoot = path.join(testRoot, 'config');
  await mkdir(configRoot);

  // A stub provider: /models answers with a mixed catalogue the way SenseNova
  // does, so the modality metadata is what has to drive the filter.
  const seen = [];
  const stub = await listen((request, response) => {
    seen.push({ url: request.url, auth: request.headers.authorization || '', googleKey: request.headers['x-goog-api-key'] || '' });
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: [
          { id: 'text-only-a', output_modalities: ['text'], input_modalities: ['text'] },
          { id: 'paint-1', output_modalities: ['image'], input_modalities: ['text'], description: 'makes pictures' },
          { id: 'see-1', output_modalities: ['text'], input_modalities: ['text', 'image'] },
          { id: 'paint-2', output_modalities: ['image'], input_modalities: ['text', 'image'] },
        ],
      }));
      return;
    }
    response.writeHead(404).end('{}');
  });
  t.after(() => stub.server.close());
  const baseUrl = `http://127.0.0.1:${stub.port}/v1`;

  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({
    active_model: 'paint',
    models: [
      { id: 'paint', name: 'Paint', type: 'image', provider: 'custom', model: 'paint-1', baseUrl, apiKey: 'secret-image-key', imageApiFormat: 'openai_images', capabilities: ['text_to_image'], defaultParams: {} },
      { id: 'see', name: 'See', type: 'vision', provider: 'custom', model: 'see-1', baseUrl, apiKey: 'secret-vision-key', apiFormat: 'chat_completions', capabilities: ['image_understanding'], defaultParams: {} },
    ],
  }));

  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(testRoot, 'data'), LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  for (let i = 0; i < 100 && !/127\.0\.0\.1:\d+/.test(logs); i += 1) await pause(30);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, logs);

  const ask = async (input) => {
    const response = await fetch(`${base}/api/models/upstream-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: response.status, payload: await response.json() };
  };

  // An image model only offers the entries that actually emit images.
  const imageList = await ask({ id: 'paint' });
  assert.equal(imageList.status, 200, JSON.stringify(imageList.payload));
  assert.deepEqual(imageList.payload.models.map((item) => item.id), ['paint-1', 'paint-2']);
  assert.equal(imageList.payload.total, 4);
  assert.equal(imageList.payload.filtered, true);

  // A vision model only offers the entries that accept an image.
  const visionList = await ask({ id: 'see' });
  assert.deepEqual(visionList.payload.models.map((item) => item.id), ['see-1', 'paint-2']);

  // includeAll skips the filter but still reports the real total.
  const all = await ask({ id: 'paint', includeAll: true });
  assert.equal(all.payload.models.length, 4);
  assert.equal(all.payload.filtered, false);

  // The stored credential is used and never leaves the server.
  assert.equal(seen[0].auth, 'Bearer secret-image-key');
  assert.ok(!JSON.stringify(imageList.payload).includes('secret-image-key'));

  // The picker works for a model that was never saved, using the form's own
  // coordinates — that is how a brand-new model is configured.
  const draft = await ask({ type: 'image', provider: 'custom', model: 'paint-1', baseUrl, apiKey: 'draft-key', imageApiFormat: 'openai_images' });
  assert.deepEqual(draft.payload.models.map((item) => item.id), ['paint-1', 'paint-2']);
  assert.equal(seen.at(-1).auth, 'Bearer draft-key');

  // A masked placeholder must be replaced by the saved key, not sent literally.
  const masked = await ask({ id: 'paint', apiKeys: ['••••••••'] });
  assert.equal(masked.status, 200);
  assert.equal(seen.at(-1).auth, 'Bearer secret-image-key');

  // Missing coordinates and an unreachable provider are reported, not guessed.
  const noKey = await ask({ type: 'image', provider: 'custom', baseUrl, apiKey: '' });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.payload.code, 'model.missingApiKey');
  const noUrl = await ask({ type: 'image', provider: 'custom', baseUrl: '', apiKey: 'x' });
  assert.equal(noUrl.status, 400);
  assert.equal(noUrl.payload.code, 'model.missingBaseUrl');
  const dead = await ask({ type: 'image', provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'x' });
  assert.equal(dead.status, 502);
  assert.equal(dead.payload.code, 'model.upstreamUnreachable');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { alphaStats, cutoutEnabled, cutoutLocal } from './cutout.mjs';

// A cut-out service stand-in: it answers with the bytes the test hands it, so a
// matte that worked and a matte that found nothing are both reproducible.
async function cutoutStub(t, respond) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    seen.push({ url: req.url, bytes, contentType: req.headers['content-type'] });
    const { status, body, type } = await respond(seen.length);
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

const matte = (width = 120, height = 90) => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: 40, height: 50, channels: 4, background: '#49b974' } }, left: 30, top: 20 }])
  .png().toBuffer();

const opaque = (width = 120, height = 90) => sharp({ create: { width, height, channels: 4, background: '#264560' } }).png().toBuffer();

test('alphaStats separates a real matte from an untouched picture', async () => {
  const cut = await alphaStats(await matte());
  assert.equal(cut.usable, true);
  assert.ok(cut.transparentRatio > 0.5, `expected a mostly transparent matte, got ${cut.transparentRatio}`);
  assert.ok(cut.visibleRatio > 0.05, `expected a visible subject, got ${cut.visibleRatio}`);
  const kept = await alphaStats(await opaque());
  assert.equal(kept.usable, false);
  assert.equal(kept.transparentRatio, 0);
});

test('cutoutLocal refuses to run without a configured service', async () => {
  const previous = process.env.LAYERIVE_CUTOUT_URL;
  delete process.env.LAYERIVE_CUTOUT_URL;
  try {
    assert.equal(cutoutEnabled(), false);
    await assert.rejects(cutoutLocal(await matte()), (error) => error.code === 'cutout.disabled' && error.status === 503);
  } finally {
    if (previous === undefined) delete process.env.LAYERIVE_CUTOUT_URL;
    else process.env.LAYERIVE_CUTOUT_URL = previous;
  }
});

test('cutoutLocal forwards the picture and returns the matte', async (t) => {
  const bytes = await matte();
  const stub = await cutoutStub(t, async () => ({ status: 200, body: bytes, type: 'image/png' }));
  const previous = process.env.LAYERIVE_CUTOUT_URL;
  process.env.LAYERIVE_CUTOUT_URL = stub.url;
  try {
    const source = await opaque();
    const result = await cutoutLocal(source, { rect: { x: 10, y: 20, width: 30, height: 40 } });
    assert.equal(result.equals(bytes), true);
    assert.equal(stub.seen.length, 1);
    assert.match(stub.seen[0].contentType, /multipart\/form-data/);
    assert.match(stub.seen[0].bytes.toString('latin1'), /name="image"/);
    assert.match(stub.seen[0].bytes.toString('latin1'), /name="rect"\r\n\r\n10,20,30,40/);
  } finally {
    if (previous === undefined) delete process.env.LAYERIVE_CUTOUT_URL;
    else process.env.LAYERIVE_CUTOUT_URL = previous;
  }
});

test('cutoutLocal reports a failing service instead of throwing a raw fetch error', async (t) => {
  const stub = await cutoutStub(t, async () => ({ status: 500, body: Buffer.from('boom'), type: 'text/plain' }));
  const previous = process.env.LAYERIVE_CUTOUT_URL;
  process.env.LAYERIVE_CUTOUT_URL = stub.url;
  try {
    await assert.rejects(cutoutLocal(await matte()), (error) => error.code === 'cutout.failed' && error.status === 502);
  } finally {
    if (previous === undefined) delete process.env.LAYERIVE_CUTOUT_URL;
    else process.env.LAYERIVE_CUTOUT_URL = previous;
  }
});

test('background removal cuts out locally and never asks an image model', { timeout: 120000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const testRoot = await mkdtemp(path.join(root, 'work', 'cutout-test-'));
  const dataRoot = path.join(testRoot, 'data');
  const configRoot = path.join(testRoot, 'config');
  await mkdir(configRoot);
  const source = await opaque(160, 120);
  const matted = await matte(160, 120);
  let cutoutAnswers = matted;
  const stub = await cutoutStub(t, async () => ({ status: 200, body: cutoutAnswers, type: 'image/png' }));
  // The image model is unreachable on purpose: reaching it at all would fail
  // the request, which proves the local path never calls it.
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({
    active_model: 'opaque',
    models: [
      // No transparent PNG support: only the local matte can satisfy this.
      { id: 'opaque', name: 'Opaque stub', provider: 'openai', type: 'image', model: 'fixture', baseUrl: 'http://127.0.0.1:1', apiKey: 'local-test-placeholder', capabilities: ['text_to_image', 'edit_prompt'], defaultParams: { size: '1024x1024' }, outputFormats: ['png'] },
    ],
  }));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot, LAYERIVE_CUTOUT_URL: stub.url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => { if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; } });
  const waitUntil = async (check, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting: ${logs}`);
  };
  await waitUntil(() => /127\.0\.0\.1:\d+/.test(logs), 10000);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const request = async (url, body, expected = 200) => {
    const response = await fetch(`${base}/api${url}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  };
  const finished = async (projectId, taskId) => {
    let task;
    await waitUntil(async () => { task = await request(`/projects/${projectId}/tasks/${taskId}`); return task.status !== 'generating'; });
    return task;
  };

  const { project } = await request('/projects', { name: 'Cut-out fixture' }, 201);
  const uploaded = await request(`/projects/${project.id}/images`, { data: source.toString('base64'), mimeType: 'image/png', name: 'source.png' }, 201);
  const imageId = uploaded.project.currentImageId;

  // The browser learns from this flag that local matting is available.
  const models = await request('/models');
  assert.deepEqual(models.cutout, { enabled: true });

  const started = await request(`/projects/${project.id}/remove-background`, { imageId, modelId: 'opaque', strategy: 'local' }, 202);
  const task = await finished(project.id, started.taskId);
  assert.equal(task.status, 'success', task.error);
  const bundle = await request(`/projects/${project.id}`);
  const version = bundle.versions.find((item) => item.operation === 'remove_background');
  assert.ok(version, 'the cut-out must be recorded as a version');
  assert.equal(version.outputs.length, 1);
  assert.equal(version.outputs[0].mimeType, 'image/png');
  const output = Buffer.from(await (await fetch(base + version.outputs[0].url)).arrayBuffer());
  const stats = await sharp(output).stats();
  assert.equal((await sharp(output).metadata()).hasAlpha, true);
  assert.equal(stats.channels[3].min, 0);
  assert.ok(stats.channels[3].max > 0);
  assert.equal(stub.seen.length, 1, 'exactly one matte per request');

  // A matte that keeps everything is rejected instead of being published.
  cutoutAnswers = await opaque(160, 120);
  const empty = await request(`/projects/${project.id}/remove-background`, { imageId, modelId: 'opaque', strategy: 'local' }, 202);
  const emptyTask = await finished(project.id, empty.taskId);
  assert.equal(emptyTask.status, 'failed');
  assert.equal(emptyTask.errorCode, 'backgroundRemoval.invalidOutput');
  const after = await request(`/projects/${project.id}`);
  assert.equal(after.versions.filter((item) => item.operation === 'remove_background').length, 1);

  // Auto mode falls back to the model path, which here has no vision model.
  const auto = await request(`/projects/${project.id}/remove-background`, { imageId, modelId: 'opaque', strategy: 'auto' }, 202);
  const autoTask = await finished(project.id, auto.taskId);
  assert.equal(autoTask.status, 'failed');
  assert.equal(autoTask.errorCode, 'backgroundRemoval.requiresVisionModel');
});

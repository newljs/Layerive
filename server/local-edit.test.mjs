import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { composeLocalReference, normalizeLocalImage, pixelRect, preserveOutsideRegion, referenceBytes, validatePlacement, validateRect } from './local-edit.mjs';

const rect = { x: 25, y: 20, width: 50, height: 60 };
const plan = { intent: '将目标替换为参考主体', target_rect: { x: 30, y: 25, width: 30, height: 40 }, reference_rect: { x: 20, y: 10, width: 60, height: 70 }, edit_prompt: '自然融合参考主体，修复边缘与光影，保留框外内容。' };
const solid = (width, height, background) => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const raw = (bytes) => sharp(bytes).ensureAlpha().raw().toBuffer();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertOutside(original, changed, width, height, selection) {
  const box = pixelRect(selection, width, height);
  let insideChanged = false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const equal = original.subarray(offset, offset + 4).equals(changed.subarray(offset, offset + 4));
    if (x < box.left || x >= box.left + box.width || y < box.top || y >= box.top + box.height) assert.ok(equal, `outside changed at ${x},${y}`);
    else if (!equal) insideChanged = true;
  }
  assert.ok(insideChanged, 'the selected area must actually change');
}

test('reject invalid uploads and model coordinates before compositing', () => {
  for (const bad of [null, { ...rect, width: NaN }, { ...rect, x: '25' }, { ...rect, x: 99 }, { ...rect, height: 0 }]) assert.throws(() => validateRect(bad));
  assert.throws(() => validatePlacement({ ...plan, target_rect: { x: 0, y: 0, width: 10, height: 10 } }, rect), /超出/);
  assert.throws(() => validatePlacement({ ...plan, reference_rect: { x: -1, y: 0, width: 10, height: 10 } }, rect));
  assert.throws(() => referenceBytes({ data: '!!!!', mimeType: 'image/png' }));
  assert.throws(() => referenceBytes({ data: 'YWJj', mimeType: 'image/svg+xml' }));
  assert.throws(() => referenceBytes({ data: 'A'.repeat(14 * 1024 * 1024), mimeType: 'image/png' }));
});

test('PNG/JPEG/WebP decoding, orientation, crop placement and original outside pixels', async () => {
  const input = await solid(120, 90, { r: 80, g: 110, b: 140, alpha: 0.5 });
  for (const format of ['png', 'jpeg', 'webp']) {
    const image = await normalizeLocalImage(await sharp(input).toFormat(format).toBuffer());
    assert.equal(image.width, 120);
    assert.equal(image.height, 90);
  }
  const oriented = await normalizeLocalImage(await sharp(input).jpeg().withMetadata({ orientation: 6 }).toBuffer());
  assert.equal(oriented.width, 90);
  assert.equal(oriented.height, 120);
  await assert.rejects(normalizeLocalImage(Buffer.from('not an image')));
  const source = await normalizeLocalImage(input);
  const reference = await normalizeLocalImage(await solid(100, 100, 'red'));
  const composed = await composeLocalReference(source, reference, validatePlacement(plan, rect));
  assertOutside(await raw(source.buffer), await raw(composed.buffer), 120, 90, rect);
  // Simulate a model that changes the entire image and returns the wrong size.
  const output = await preserveOutsideRegion(source, { bytes: await solid(300, 300, 'green') }, rect);
  assert.equal(output.mimeType, 'image/png');
  assert.equal(output.width, 120);
  assert.equal(output.height, 90);
  assertOutside(await raw(source.buffer), await raw(output.bytes), 120, 90, rect);
});

test('local edit API: all vision formats, composed provider input, history, failures and cancellation', { timeout: 60000 }, async (t) => {
  // Only generated fixtures and a loopback model stub; never read user data/config.
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const testRoot = await mkdtemp(path.join(root, 'work', 'local-edit-test-'));
  const dataRoot = path.join(testRoot, 'data');
  const configRoot = path.join(testRoot, 'config');
  await mkdir(configRoot);
  const sourceBytes = await solid(120, 90, '#264560');
  const reference = { data: (await solid(80, 100, 'red')).toString('base64'), mimeType: 'image/png' };
  const generated = await solid(128, 128, '#49b974');
  const calls = [];
  let mode = 'success';
  let releaseVision;
  let releaseGeneration;
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      calls.push({ url: req.url, bytes, contentType: req.headers['content-type'] });
      if (req.url.endsWith('/images/edits')) {
        if (mode === 'hold-generation') await new Promise((resolve) => { releaseGeneration = resolve; });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }, { b64_json: generated.toString('base64') }] }));
        return;
      }
      if (mode === 'hold-vision') await new Promise((resolve) => { releaseVision = resolve; });
      const content = JSON.stringify(mode === 'bad-plan' ? { ...plan, target_rect: { x: 0, y: 0, width: 5, height: 5 } } : plan);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url.endsWith('/messages') ? { content: [{ type: 'text', text: content }] } : req.url.endsWith('/responses') ? { output_text: content } : { choices: [{ message: { content } }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const visionFormats = ['chat_completions', 'anthropic_messages', 'responses'];
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: 'image', active_vision_model: visionFormats[0], models: [
    { id: 'image', name: 'Local image stub', provider: 'openai', type: 'image', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-test-placeholder', capabilities: ['edit_prompt'], defaultParams: { size: '1024x1024' } },
    ...visionFormats.map((apiFormat) => ({ id: apiFormat, name: apiFormat, provider: 'openai', type: 'vision', apiFormat, model: 'fixture', baseUrl: stubUrl, apiKey: 'local-test-placeholder' })),
  ] }));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    releaseVision?.(); releaseGeneration?.();
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    stub.closeAllConnections();
    await new Promise((resolve) => stub.close(resolve));
  });
  await waitUntil(() => /127\.0\.0\.1:\d+/.test(logs), 10000);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function request(url, body, expected = 200) {
    const response = await fetch(`${base}/api${url}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  }
  async function fixtureProject() {
    const { project } = await request('/projects', { name: 'Local edit fixture' }, 201);
    const uploaded = await request(`/projects/${project.id}/images`, { data: sourceBytes.toString('base64'), mimeType: 'image/png', name: 'source.png' }, 201);
    return { projectId: project.id, imageId: uploaded.project.currentImageId };
  }
  const submit = ({ projectId, imageId }, extra = {}) => request(`/projects/${projectId}/local-edit`, { imageId, modelId: 'image', visionModelId: visionFormats[0], instruction: '', reference, rect, params: { size: '1024x1024', count: 2 }, ...extra }, 202);
  async function finished(projectId, taskId) {
    let task;
    await waitUntil(async () => { task = await request(`/projects/${projectId}/tasks/${taskId}`); return task.status !== 'generating'; });
    return task;
  }
  for (const format of visionFormats) {
    const fixture = await fixtureProject();
    const first = calls.length;
    const started = await submit(fixture, { visionModelId: format });
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const vision = JSON.parse(calls[first].bytes);
    const content = format === 'responses' ? vision.input[0].content : vision.messages.at(-1).content;
    assert.equal(content.filter((item) => ['image', 'image_url', 'input_image'].includes(item.type)).length, 2);
    const modelCall = calls.slice(first).find((item) => item.url.endsWith('/images/edits'));
    const form = await new Response(modelCall.bytes, { headers: { 'Content-Type': modelCall.contentType } }).formData();
    const providerInput = Buffer.from(await form.get('image').arrayBuffer());
    assertOutside(await raw(sourceBytes), await raw(providerInput), 120, 90, rect);
    assert.match(form.get('prompt'), /初步拼贴/);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.find((item) => item.operation === 'local_edit');
    assert.equal(version.outputs.length, 2);
    assert.equal(version.parentVersionId, bundle.versions.find((item) => item.operation === 'upload').id);
    assert.deepEqual(version.inputs.map((item) => item.sourceType).sort(), ['local_composite', 'local_reference', 'upload']);
    for (const image of version.outputs) {
      assert.equal(image.width, 120); assert.equal(image.height, 90); assert.equal(image.mimeType, 'image/png');
      const bytes = Buffer.from(await (await fetch(base + image.url)).arrayBuffer());
      assertOutside(await raw(sourceBytes), await raw(bytes), 120, 90, rect);
    }
  }
  const textFixture = await fixtureProject();
  const textStart = calls.length;
  const textTask = await submit(textFixture, { reference: undefined, instruction: '将选区变绿' });
  assert.equal((await finished(textFixture.projectId, textTask.taskId)).status, 'success');
  assert.equal(JSON.parse(calls[textStart].bytes).messages.at(-1).content.filter((item) => item.type === 'image_url').length, 1);
  const badFixture = await fixtureProject();
  mode = 'bad-plan';
  const beforeBad = calls.length;
  const bad = await submit(badFixture);
  assert.equal((await finished(badFixture.projectId, bad.taskId)).status, 'failed');
  assert.ok(!calls.slice(beforeBad).some((item) => item.url.endsWith('/images/edits')));
  assert.equal((await request(`/projects/${badFixture.projectId}`)).project.currentImageId, badFixture.imageId);
  for (const hold of ['hold-vision', 'hold-generation']) {
    mode = hold;
    const fixture = await fixtureProject();
    const started = await submit(fixture);
    await waitUntil(() => hold === 'hold-vision' ? Boolean(releaseVision) : Boolean(releaseGeneration));
    const active = await request(`/projects/${fixture.projectId}/tasks/${started.taskId}`);
    assert.equal(active.stage, hold === 'hold-vision' ? 'planning' : 'generating');
    await request(`/projects/${fixture.projectId}/tasks/${started.taskId}/cancel`, {});
    assert.equal((await finished(fixture.projectId, started.taskId)).status, 'canceled');
    const bundle = await request(`/projects/${fixture.projectId}`);
    assert.equal(bundle.project.currentImageId, fixture.imageId);
    assert.ok(!bundle.versions.some((item) => item.operation === 'local_edit'));
    releaseVision?.(); releaseGeneration?.();
    releaseVision = null; releaseGeneration = null;
  }
});

async function waitUntil(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(30);
  }
  throw new Error('Timed out waiting for local fixture');
}

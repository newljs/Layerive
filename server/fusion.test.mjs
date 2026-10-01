import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { validateFusionInput, validateFusionPlan } from './fusion.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(fn, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await pause(30); }
  throw new Error('Timed out');
}

test('fusion rejects invalid modes, drop positions and ambiguous vision plans', () => {
  const valid = { mode: 'basic', point: { x: 25, y: 60 } };
  for (const invalid of [{ ...valid, mode: 'constructor' }, { ...valid, mode: 'unknown' }, { ...valid, point: { x: NaN, y: 50 } }, { ...valid, point: { x: '50', y: 50 } }, { ...valid, point: { x: -1, y: 50 } }, { ...valid, point: { x: 50, y: 101 } }, { ...valid, instruction: 'a'.repeat(1001) }]) assert.throws(() => validateFusionInput(invalid));
  assert.equal(validateFusionInput({ point: { x: 0, y: 100 } }).mode, 'basic');
  assert.throws(() => validateFusionPlan({ applicable: false, reason: '没有服装' }), error => error.code === 'fusion.notApplicable');
  assert.throws(() => validateFusionPlan({ applicable: true, intent: '融合' }));
});

test('fusion API: two ordered images across providers, all modes, references, history and cancellation', { timeout: 60000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const temporary = await mkdtemp(path.join(root, 'work', 'fusion-test-'));
  const dataRoot = path.join(temporary, 'data');
  const configRoot = path.join(temporary, 'config');
  await mkdir(configRoot);
  const source = await sharp({ create: { width: 120, height: 90, channels: 4, background: '#123456' } }).png().toBuffer();
  const reference = await sharp({ create: { width: 80, height: 120, channels: 4, background: '#ff3344' } }).png().toBuffer();
  const output = await sharp(source).resize(128, 96).png().toBuffer();
  const calls = [];
  let rejectPlan = false;
  let hold = null;
  let release;
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      calls.push({ url: req.url, bytes, contentType: req.headers['content-type'] });
      const isImage = req.url.endsWith('/images/edits') || req.url.endsWith('/interactions');
      if ((hold === 'vision' && !isImage) || (hold === 'image' && isImage)) await new Promise(resolve => { release = resolve; });
      res.setHeader('Content-Type', 'application/json');
      if (isImage) return res.end(JSON.stringify(req.url.endsWith('/interactions') ? { output_image: { data: output.toString('base64'), mime_type: 'image/png' } } : { data: [{ b64_json: output.toString('base64') }] }));
      const content = JSON.stringify(rejectPlan ? { applicable: false, reason: '参考图没有服装' } : { applicable: true, intent: '依据落点融合主体', edit_prompt: '编辑图1的目标，将图2主体自然融合，保留原图其余内容。' });
      res.end(JSON.stringify(req.url.endsWith('/messages') ? { content: [{ type: 'text', text: content }] } : req.url.endsWith('/responses') ? { output_text: content } : { choices: [{ message: { content } }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const protocols = ['openai_images', 'gemini_interactions', 'grok_images', 'sensenova'];
  const visionFormats = ['chat_completions', 'anthropic_messages', 'responses'];
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: protocols[0], active_vision_model: visionFormats[0], models: [
    ...protocols.map(id => ({ id, name: id, type: 'image', provider: id === 'sensenova' ? 'sensenova' : 'custom', imageApiFormat: id === 'sensenova' ? 'openai_images' : id, model: id === 'sensenova' ? 'sensenova-u1.5-lite' : 'fixture', baseUrl: stubUrl, apiKey: 'local-fixture-key', capabilities: ['edit_prompt'], defaultParams: { size: '1024x1024' } })),
    { id: 'no-edit', name: 'No edit', type: 'image', provider: 'custom', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-fixture-key', capabilities: ['text_to_image'] },
    ...visionFormats.map(apiFormat => ({ id: apiFormat, name: apiFormat, type: 'vision', provider: 'custom', apiFormat, model: 'fixture', baseUrl: stubUrl, apiKey: 'local-fixture-key' })),
  ] }));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    release?.();
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    stub.closeAllConnections(); await new Promise(resolve => stub.close(resolve));
  });
  await waitUntil(() => /http:\/\/127\.0\.0\.1:\d+/.test(logs));
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function request(url, body, status = 200, method = 'POST') {
    const response = await fetch(`${base}/api${url}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json(); assert.equal(response.status, status, JSON.stringify(payload)); return payload;
  }
  async function fixture() {
    const { project } = await request('/projects', { name: 'Fusion fixture' }, 201);
    const prefix = `/projects/${project.id}`;
    const uploaded = await request(prefix + '/images', { data: source.toString('base64'), mimeType: 'image/png', name: 'main.png' }, 201);
    const withReference = await request(prefix + '/images', { data: reference.toString('base64'), mimeType: 'image/png', name: 'reference.png', referenceOnly: true }, 201);
    assert.equal(withReference.project.currentImageId, uploaded.project.currentImageId);
    assert.equal(withReference.project.coverImageId, uploaded.project.coverImageId);
    const ref = withReference.images.find(image => image.sourceType === 'fusion_reference');
    return { prefix, projectId: project.id, imageId: uploaded.project.currentImageId, referenceImageId: ref.id };
  }
  const submit = (f, extra = {}) => request(f.prefix + '/fusion', { imageId: f.imageId, referenceImageId: f.referenceImageId, modelId: protocols[0], visionModelId: visionFormats[0], mode: 'basic', point: { x: 25, y: 60 }, params: { size: '1024x1024', count: 4 }, ...extra }, 202);
  async function finished(f, id) { let task; await waitUntil(async () => { task = await request(f.prefix + '/tasks/' + id); return task.status !== 'generating'; }); return task; }
  let savedFixture;
  for (const [index, protocol] of protocols.entries()) {
    const f = await fixture(); const first = calls.length;
    const started = await submit(f, { modelId: protocol, visionModelId: visionFormats[index % 3], mode: ['basic', 'outfit', 'pose', 'group'][index] });
    const task = await finished(f, started.taskId); assert.equal(task.status, 'success', task.error);
    const vision = JSON.parse(calls[first].bytes);
    const content = vision.input?.[0].content || vision.messages.at(-1).content;
    assert.equal(content.filter(item => ['input_image', 'image_url', 'image'].includes(item.type)).length, 2);
    assert.match(JSON.stringify(content), /x=25%/); assert.match(JSON.stringify(content), /y=60%/);
    const imageCall = calls.slice(first).find(call => call.url.endsWith('/images/edits') || call.url.endsWith('/interactions'));
    if (protocol === 'openai_images') {
      const form = await new Response(imageCall.bytes, { headers: { 'Content-Type': imageCall.contentType } }).formData();
      assert.equal(form.getAll('image[]').length, 2); assert.equal(form.get('n'), '1');
      assert.deepEqual(Buffer.from(await form.getAll('image[]')[0].arrayBuffer()), source);
      assert.deepEqual(Buffer.from(await form.getAll('image[]')[1].arrayBuffer()), reference);
    } else {
      const body = JSON.parse(imageCall.bytes);
      if (protocol === 'gemini_interactions') assert.equal(body.input.filter(item => item.type === 'image').length, 2);
      else { assert.equal(body.images.length, 2); assert.equal(body.n, 1); }
      if (protocol === 'grok_images') { assert.ok(!body.image); assert.equal(body.images[0].url, `data:image/png;base64,${source.toString('base64')}`); }
      if (protocol === 'sensenova') for (const image of body.images) {
        const metadata = await sharp(Buffer.from(image.image_url.split(',')[1], 'base64')).metadata();
        assert.equal(metadata.width % 32, 0); assert.equal(metadata.height % 32, 0);
        assert.ok(metadata.width >= 512 && metadata.width <= 4096 && metadata.height >= 512 && metadata.height <= 4096);
      }
    }
    const bundle = await request(f.prefix); const version = bundle.versions.find(v => v.operation === 'fusion');
    assert.equal(version.outputs.length, 1); assert.equal(version.parentVersionId, bundle.versions.find(v => v.operation === 'upload').id);
    assert.deepEqual(new Set(version.inputs.map(image => image.id)), new Set([f.imageId, f.referenceImageId]));
    const modelLogs = await request(f.prefix + '/model-logs');
    assert.equal(modelLogs.logs.length, 2); assert.ok(modelLogs.logs.every(log => !JSON.stringify(log).includes('local-fixture-key') && !JSON.stringify(log).includes('base64,')));
    savedFixture = f;
  }
  const f = await fixture();
  const invalid = await request(f.prefix + '/fusion', { imageId: f.imageId, referenceImageId: f.referenceImageId, point: { x: 101, y: 0 } }, 400);
  assert.equal(invalid.code, 'fusion.invalidPoint');
  await request(f.prefix + '/fusion', { imageId: f.imageId, referenceImageId: savedFixture.referenceImageId, point: { x: 50, y: 50 } }, 404);
  await request(f.prefix + '/fusion', { imageId: f.imageId, referenceImageId: f.imageId, point: { x: 50, y: 50 } }, 400);
  await request(f.prefix + '/fusion', { imageId: f.imageId, referenceImageId: f.referenceImageId, modelId: 'no-edit', point: { x: 50, y: 50 } }, 400);
  rejectPlan = true; const first = calls.length; const rejected = await submit(f, { mode: 'outfit' });
  const rejectedTask = await finished(f, rejected.taskId); assert.equal(rejectedTask.status, 'failed'); assert.equal(rejectedTask.errorCode, 'fusion.notApplicable');
  assert.ok(!calls.slice(first).some(call => call.url.endsWith('/images/edits')));
  assert.equal((await request(f.prefix)).project.currentImageId, f.imageId);
  rejectPlan = false;
  for (const phase of ['vision', 'image']) {
    hold = phase; release = null; const marked = calls.length;
    const started = await submit(f); await waitUntil(() => Boolean(release));
    await request(f.prefix + '/tasks/' + started.taskId + '/cancel', {});
    release(); hold = null;
    assert.equal((await finished(f, started.taskId)).status, 'canceled');
    assert.ok(!(await request(f.prefix)).versions.some(v => v.operation === 'fusion'));
    if (phase === 'vision') assert.ok(!calls.slice(marked).some(call => call.url.endsWith('/images/edits')));
  }
  // Generated project references are valid, and every linked ID survives duplicate/import.
  const saved = await request(savedFixture.prefix);
  const generated = saved.versions.find(v => v.operation === 'fusion').outputs[0];
  const followup = await submit(savedFixture, { referenceImageId: generated.id });
  assert.equal((await finished(savedFixture, followup.taskId)).status, 'success');
  await request(savedFixture.prefix, { draft: { fusionImageIds: [savedFixture.referenceImageId, generated.id], fusionType: 'pose' } }, 200, 'PATCH');
  const duplicated = await request(savedFixture.prefix + '/duplicate', {}, 201);
  assert.ok(duplicated.project.draft.fusionImageIds.every(id => duplicated.images.some(image => image.id === id) && !saved.images.some(image => image.id === id)));
  const zip = Buffer.from(await (await fetch(`${base}/api${savedFixture.prefix}/export`)).arrayBuffer());
  const imported = await request('/projects/import', { data: zip.toString('base64') }, 201);
  assert.ok(imported.project.draft.fusionImageIds.every(id => imported.images.some(image => image.id === id)));
  for (const copy of [duplicated, imported]) {
    assert.ok(copy.versions.filter(v => v.operation === 'fusion').every(v => v.inputs.length === 2));
  }
  // Inspect only this isolated test DB through the project export, never user data.
  assert.ok((await readFile(path.join(dataRoot, 'app.db'))).length > 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { extractionModes, extractionLabels } from './extraction.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(fn) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await fn()) return; await pause(30); }
  throw new Error('Timed out waiting for extraction fixture');
}

test('extraction scenes: vision protocols, product presentation, refusals, history and cancellation', { timeout: 60000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const temporary = await mkdtemp(path.join(root, 'work', 'extraction-test-'));
  const configRoot = path.join(temporary, 'config');
  await mkdir(configRoot);
  // Generated fixtures and local model stubs only; never read user images/keys.
  const source = await sharp({ create: { width: 320, height: 480, channels: 4, background: '#456789' } }).png().toBuffer();
  const crop = await sharp(source).extract({ left: 32, top: 48, width: 256, height: 384 }).png().toBuffer();
  const calls = [];
  let plan = { applicable: true, subject: '目标素材', edit_prompt: '提取识别目标。' };
  let hold = null;
  let release;
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const isImage = req.url.endsWith('/images/edits');
      calls.push({ url: req.url, bytes, contentType: req.headers['content-type'] });
      if (hold === (isImage ? 'image' : 'vision')) await new Promise(resolve => { release = resolve; });
      res.setHeader('Content-Type', 'application/json');
      if (isImage) return res.end(JSON.stringify({ data: [{ b64_json: crop.toString('base64') }] }));
      const content = JSON.stringify(plan);
      res.end(JSON.stringify(req.url.endsWith('/messages') ? { content: [{ type: 'text', text: content }] } : req.url.endsWith('/responses') ? { output_text: content } : { choices: [{ message: { content } }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const visionFormats = ['chat_completions', 'anthropic_messages', 'responses'];
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: 'image', active_vision_model: visionFormats[0], models: [
    { id: 'image', name: 'Image fixture', provider: 'custom', imageApiFormat: 'openai_images', type: 'image', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-fixture-key', capabilities: ['edit_prompt'], sizeOptions: ['1024x1024'], defaultParams: { size: '1024x1024' }, transparentBackground: true, outputFormats: ['png'], maxCount: 4 },
    { id: 'no-edit', name: 'No edit', provider: 'custom', type: 'image', model: 'fixture', baseUrl: stubUrl, capabilities: ['text_to_image'] },
    ...visionFormats.map(apiFormat => ({ id: apiFormat, name: apiFormat, type: 'vision', provider: 'custom', apiFormat, model: 'fixture', baseUrl: stubUrl, apiKey: 'local-fixture-key' })),
  ] }));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(temporary, 'data'), LAYERIVE_CONFIG_ROOT: configRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    release?.();
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    stub.closeAllConnections(); await new Promise(resolve => stub.close(resolve));
  });
  await waitUntil(() => /http:\/\/127\.0\.0\.1:\d+/.test(logs));
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function request(url, body, status = 200) {
    const response = await fetch(`${base}/api${url}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json(); assert.equal(response.status, status, JSON.stringify(payload)); return payload;
  }
  async function fixture() {
    const { project } = await request('/projects', { name: 'Extraction fixture' }, 201);
    const prefix = `/projects/${project.id}`;
    const uploaded = await request(prefix + '/images', { data: source.toString('base64'), mimeType: 'image/png', name: 'source.png' }, 201);
    return { prefix, imageId: uploaded.project.currentImageId };
  }
  const input = f => ({ imageId: f.imageId, modelId: 'image', rect: { x: 10, y: 10, width: 80, height: 80 }, crop: { data: crop.toString('base64'), mimeType: 'image/png', padded: true }, params: { count: 1, transparent: true } });
  async function finished(f, taskId) {
    let task;
    await waitUntil(async () => { task = await request(f.prefix + '/tasks/' + taskId); return task.status !== 'generating'; });
    return task;
  }
  const expectedRules = [/识别用户最可能想提取的主体/, /平铺商品展示/, /语义成对/, /正视的平面图案素材/, /自然补全遮挡区域/];
  let saved;
  for (const [index, mode] of extractionModes.entries()) {
    const f = await fixture(); const mark = calls.length;
    const started = await request(f.prefix + '/extract-asset', { ...input(f), ...(index ? { mode } : {}), visionModelId: visionFormats[index % 3], hint: '只提取中央的目标', params: { count: mode === 'clothing' ? 2 : 1, transparent: true } }, 202);
    const task = await finished(f, started.taskId); assert.equal(task.status, 'success', task.error);
    const vision = JSON.parse(calls[mark].bytes);
    const content = vision.input?.[0].content || vision.messages.at(-1).content;
    assert.equal(content.filter(item => ['input_image', 'image_url', 'image'].includes(item.type)).length, 1);
    assert.match(JSON.stringify(content), new RegExp(extractionLabels[mode]));
    assert.match(JSON.stringify(content), /只提取中央的目标/);
    assert.match(JSON.stringify(content), /拉伸补边/);
    assert.match(JSON.stringify(content), expectedRules[index]);
    const imageCalls = calls.slice(mark).filter(call => call.url.endsWith('/images/edits'));
    assert.equal(imageCalls.length, mode === 'clothing' ? 2 : 1);
    for (const call of imageCalls) {
      const form = await new Response(call.bytes, { headers: { 'Content-Type': call.contentType } }).formData();
      assert.match(form.get('prompt'), expectedRules[index]);
      assert.notEqual(form.get('background'), 'transparent');
      assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()), crop);
      if (['clothing', 'accessory'].includes(mode)) assert.match(form.get('prompt'), /商品橱窗展示图/);
    }
    const bundle = await request(f.prefix);
    const version = bundle.versions.find(v => v.operation === 'extract_asset');
    assert.equal(version.parentVersionId, bundle.versions.find(v => v.operation === 'upload').id);
    assert.equal(version.outputs.length, mode === 'clothing' ? 2 : 1);
    assert.ok(version.inputs.some(image => image.id === f.imageId));
    assert.ok(version.inputs.some(image => image.sourceType === 'extract'));
    const modelLogs = (await request(f.prefix + '/model-logs')).logs;
    assert.ok(modelLogs.every(log => log.taskId === started.taskId && !JSON.stringify(log).includes('local-fixture-key') && !JSON.stringify(log).includes('base64,')));
    saved = f;
  }
  const f = await fixture();
  for (const [override, code] of [[{ mode: 'unknown' }, 'extract.invalidMode'], [{ hint: 'a'.repeat(1001) }, 'extract.hintTooLong'], [{ modelId: 'no-edit' }, 'model.unsupportedOperation']]) {
    const mark = calls.length;
    const rejected = await request(f.prefix + '/extract-asset', { ...input(f), ...override }, 400);
    assert.equal(rejected.code, code); assert.equal(calls.length, mark);
  }
  for (const [invalidPlan, code] of [[{ applicable: false, reason: '没有目标服装' }, 'extract.notApplicable'], [{ subject: '目标', edit_prompt: '' }, 'extract.invalidPlan']]) {
    plan = invalidPlan; const mark = calls.length;
    const started = await request(f.prefix + '/extract-asset', { ...input(f), mode: 'clothing' }, 202);
    assert.equal((await finished(f, started.taskId)).errorCode, code);
    assert.ok(!calls.slice(mark).some(call => call.url.endsWith('/images/edits')));
    assert.equal((await request(f.prefix)).project.currentImageId, f.imageId);
  }
  plan = { applicable: true, subject: '目标', edit_prompt: '提取目标' };
  for (const phase of ['vision', 'image']) {
    hold = phase; release = null; const mark = calls.length;
    const started = await request(f.prefix + '/extract-asset', { ...input(f), mode: 'accessory' }, 202);
    await waitUntil(() => Boolean(release));
    assert.equal((await request(f.prefix + '/tasks/' + started.taskId)).stage, phase === 'vision' ? 'planning' : 'generating');
    await request(f.prefix + '/tasks/' + started.taskId + '/cancel', {});
    release(); hold = null;
    assert.equal((await finished(f, started.taskId)).status, 'canceled');
    assert.ok(!(await request(f.prefix)).versions.some(v => v.operation === 'extract_asset'));
    if (phase === 'vision') assert.ok(!calls.slice(mark).some(call => call.url.endsWith('/images/edits')));
  }
  const duplicate = await request(saved.prefix + '/duplicate', {}, 201);
  const duplicatedVersion = duplicate.versions.find(v => v.operation === 'extract_asset');
  assert.equal(duplicatedVersion.inputs.length, 2);
  assert.ok(duplicatedVersion.inputs.every(image => duplicate.images.some(item => item.id === image.id)));
});

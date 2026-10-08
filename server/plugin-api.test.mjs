import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readZip } from './zip.mjs';

test('generic plugin API matches legacy operations and preserves plugin provenance across project copies', { timeout: 30000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const temporary = await mkdtemp(path.join(root, 'work', 'plugin-api-test-'));
  const configRoot = path.join(temporary, 'config');
  await mkdir(configRoot);
  const source = await sharp({ create: { width: 120, height: 90, channels: 4, background: '#123456' } }).png().toBuffer();
  const generated = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 80, height: 60, channels: 4, background: '#ff3344' } }).png().toBuffer() }]).png().toBuffer();
  const calls = [];
  let visionOverride;
  let visionGate;
  let failImage = false;
  const stub = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const requestText = Buffer.concat(chunks).toString();
    calls.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/images/edits')) {
      if (failImage) { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: 'fixture image failure' } })); }
      return res.end(JSON.stringify({ data: [{ b64_json: (requestText.includes('\r\n\r\ntransparent\r\n') ? generated : source).toString('base64') }] }));
    }
    if (visionGate) await visionGate;
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(visionOverride || {
      applicable: true, subject: '商品', intent: '替换选区内的商品',
      keep_subjects: ['商品'], discard_as_background: ['背景'],
      has_watermark: true, watermarks: [{ location: '右下角' }],
      target: '选区内的商品', confidence: 0.95, background: '自然背景',
      target_rect: { x: 30, y: 30, width: 30, height: 30 },
      reference_rect: { x: 10, y: 10, width: 80, height: 80 },
      edit_prompt: '按指令编辑图1，保留其他内容。',
    }) } }] }));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  t.after(async () => { stub.closeAllConnections(); await new Promise(resolve => stub.close(resolve)); });
  const baseUrl = 'http://127.0.0.1:' + stub.address().port;
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({
    active_model: 'image', active_vision_model: 'vision', models: [
      { id: 'image', type: 'image', provider: 'custom', name: 'Fixture image', model: 'fixture', baseUrl, apiKey: 'plugin-test-secret', capabilities: ['edit_prompt'], transparentBackground: true, outputFormats: ['png'], defaultParams: { size: '1024x1024' } },
      { id: 'vision', type: 'vision', provider: 'custom', name: 'Fixture vision', model: 'fixture', baseUrl, apiKey: 'plugin-test-secret', apiFormat: 'chat_completions' },
      { id: 'no-edit', type: 'image', provider: 'custom', name: 'No edit', model: 'fixture', baseUrl, apiKey: 'plugin-test-secret', capabilities: ['text_to_image'] },
    ],
  }));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(temporary, 'data'), LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => { if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; } });
  async function until(fn) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await fn()) return;
      if (child.exitCode != null) throw new Error('Fixture server exited: ' + logs);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Plugin fixture timed out: ' + logs);
  }
  await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(logs));
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function request(url, body, status = 200) {
    const response = await fetch(base + '/api' + url, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, status, JSON.stringify(payload));
    return payload;
  }
  const { plugins } = await request('/plugins');
  assert.equal(plugins.filter(plugin => plugin.kind !== 'recipe').length, 9);
  assert.ok(plugins.some(plugin => plugin.id === 'layerive.colorize'));
  assert.ok(!JSON.stringify(plugins).includes('workflow'), 'the public catalog must not expose workflow prompts');
  assert.ok(!JSON.stringify(plugins).includes('plugin-test-secret'));
  const denied = await fetch(base + '/api/plugins', { headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://outside.example' } });
  assert.equal(denied.status, 403);
  const { project } = await request('/projects', { name: 'Plugin compatibility' }, 201);
  const prefix = '/projects/' + project.id;
  const uploaded = await request(prefix + '/images', { data: source.toString('base64'), mimeType: 'image/png' }, 201);
  const imageId = uploaded.project.currentImageId;
  const withReference = await request(prefix + '/images', { data: generated.toString('base64'), mimeType: 'image/png', referenceOnly: true }, 201);
  const referenceImageId = withReference.images.find(image => image.sourceType === 'fusion_reference').id;
  for (const plugin of plugins) {
    const input = {
      imageId, referenceImageId, modelId: 'image', visionModelId: 'vision',
      size: '1024x1024', segments: [{ id: 'text-1', originalText: '原文', text: '新文字' }],
      ...(plugin.kind === 'recipe' ? { fields: { reference: referenceImageId } } : {}),
      rect: { x: 20, y: 20, width: 60, height: 60 }, instruction: '替换为参考商品',
      reference: { data: generated.toString('base64'), mimeType: 'image/png' },
      point: { x: 50, y: 50 }, crop: { data: source.toString('base64'), mimeType: 'image/png' },
      params: { count: 1, size: '1024x1024' },
    };
    const signatures = [];
    const visionBefore = calls.filter(url => url.endsWith('/chat/completions')).length;
    for (const route of ['/' + plugin.route, '/plugins/' + plugin.id + '/run']) {
      const started = await request(prefix + route, input, 202);
      let task;
      await until(async () => { task = await request(prefix + '/tasks/' + started.taskId); return task.status !== 'generating'; });
      assert.equal(task.status, 'success', task.error);
      assert.deepEqual(task.plugin, { id: plugin.id, version: plugin.version, apiVersion: plugin.apiVersion });
      const bundle = await request(prefix);
      const version = bundle.versions[0];
      assert.equal(version.operation, plugin.operation);
      assert.equal(version.parentVersionId, bundle.versions.find(item => item.operation === 'upload').id);
      const bytes = Buffer.from(await (await fetch(base + version.outputs[0].url)).arrayBuffer());
      signatures.push({ bytes: bytes.toString('base64'), inputs: version.inputs.length, width: version.outputs[0].width, height: version.outputs[0].height });
    }
    assert.deepEqual(signatures[0], signatures[1], plugin.id + ': generic and legacy outputs must agree');
    assert.equal(calls.filter(url => url.endsWith('/chat/completions')).length - visionBefore, plugin.requirements.vision ? 2 : 0);
    const count = calls.length;
    await request(prefix + '/plugins/' + plugin.id + '/run', { ...input, modelId: 'no-edit' }, 400);
    assert.equal(calls.length, count, 'incompatible model must not be called');
  }
  for (const id of ['missing', 'constructor', '__proto__']) {
    const error = await request(prefix + '/plugins/' + id + '/run', {}, 404);
    assert.equal(error.code, 'plugin.notFound');
  }
  async function exported(id) {
    const zip = Buffer.from(await (await fetch(base + '/api/projects/' + id + '/export')).arrayBuffer());
    return { zip, data: JSON.parse(readZip(zip).get('project.json').toString()) };
  }
  const original = await exported(project.id);
  const copied = await request(prefix + '/duplicate', {}, 201);
  const imported = await request('/projects/import', { data: original.zip.toString('base64') }, 201);
  for (const copy of [copied, imported]) {
    const { data } = await exported(copy.project.id);
    assert.equal(data.tasks.length, plugins.length * 2);
    assert.equal(data.textRecognitions.length, 2);
    for (const recognition of data.textRecognitions) {
      assert.ok(data.images.some(image => image.id === recognition.image_id));
      assert.equal(JSON.parse(recognition.segments_json)[0].text, '新文字');
    }
    assert.ok(!JSON.stringify(data).includes('plugin-test-secret'));
    for (const task of data.tasks) {
      const input = JSON.parse(task.input_json);
      assert.ok(plugins.some(plugin => plugin.id === input.plugin.id));
      assert.ok(data.images.some(image => image.id === input.inputImageId));
      if (input.fusion) assert.ok(data.images.some(image => image.id === input.fusion.referenceImageId));
      if (input.recipe) assert.ok(data.images.some(image => image.id === input.recipe.referenceImageIds.reference));
    }
    assert.equal(copy.versions.filter(version => version.operation !== 'upload').length, plugins.length * 2);
  }

  const input = { imageId, modelId: 'image', visionModelId: 'vision', segments: [{ id: 'text-1', originalText: 'old', text: 'new' }] };
  const imageCallCount = () => calls.filter(url => url.endsWith('/images/edits')).length;
  async function finished(started) {
    let task;
    await until(async () => { task = await request(prefix + '/tasks/' + started.taskId); return task.status !== 'generating'; });
    return task;
  }
  for (const route of ['edit-text', 'remove-watermark', 'remove-background', 'colorize']) {
    await t.test(route + ' planning returns a task immediately and can be canceled before generation', async () => {
      let release;
      visionGate = new Promise(resolve => { release = resolve; });
      const beforeCalls = calls.length;
      const beforeImages = imageCallCount();
      const beforeVersions = (await request(prefix)).versions.length;
      try {
        const started = await request(prefix + '/plugins/layerive.' + route + '/run', input, 202);
        await until(() => calls.length > beforeCalls);
        assert.equal((await request(prefix + '/tasks/' + started.taskId)).stage, 'planning');
        await request(prefix + '/tasks/' + started.taskId + '/cancel', {});
        assert.equal((await finished(started)).status, 'canceled');
        assert.equal(imageCallCount(), beforeImages);
        assert.equal((await request(prefix)).versions.length, beforeVersions);
      } finally { release(); visionGate = null; }
    });
  }
  await t.test('watermark and background refusals never invoke the image model or create a version', async () => {
    const before = imageCallCount();
    const versionCount = (await request(prefix)).versions.length;
    visionOverride = { has_watermark: false, watermarks: [], error: 'no subject', applicable: false };
    try {
      for (const [route, code] of [['remove-watermark', 'watermark.notFound'], ['remove-background', 'backgroundRemoval.noSubject'], ['colorize', 'plugin.notApplicable']]) {
        const task = await finished(await request(prefix + '/plugins/layerive.' + route + '/run', input, 202));
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, code);
      }
    } finally { visionOverride = undefined; }
    assert.equal(imageCallCount(), before);
    assert.equal((await request(prefix)).versions.length, versionCount);
  });
  await t.test('editing failure creates no output or inherited text snapshot; input validation stays synchronous', async () => {
    const before = (await request(prefix)).versions.length;
    const beforeCache = (await exported(project.id)).data.textRecognitions;
    failImage = true;
    try {
      const task = await finished(await request(prefix + '/plugins/layerive.edit-text/run', input, 202));
      assert.equal(task.status, 'failed');
      assert.equal((await request(prefix)).versions.length, before);
      assert.deepEqual((await exported(project.id)).data.textRecognitions, beforeCache);
    } finally { failImage = false; }
    assert.equal((await request(prefix + '/plugins/layerive.edit-text/run', { ...input, segments: [] }, 400)).code, 'text.noChanges');
    assert.equal((await request(prefix + '/plugins/layerive.outpaint/run', { ...input, size: 'bad' }, 400)).code, 'outpaint.invalidSize');
    const count = calls.length;
    const invalid = await request(prefix + '/generate', { inputImageId: imageId, modelId: 'no-edit', operation: 'remove_background' }, 400);
    assert.equal(invalid.code, 'model.noEditPrompt');
    assert.equal(calls.length, count);
  });
  await t.test('declarative parameters reject unknown fields and cross-project references before any model call', async () => {
    const { project: other } = await request('/projects', { name: 'Other project' }, 201);
    const otherUpload = await request('/projects/' + other.id + '/images', { data: source.toString('base64'), mimeType: 'image/png' }, 201);
    const before = calls.length;
    for (const fields of [{ unknown: 'bad' }, { style: 'missing' }, { preserveGrain: 'true' }, { instruction: 'x'.repeat(1001) }, { reference: imageId }]) {
      const error = await request(prefix + '/plugins/layerive.colorize/run', { ...input, fields }, 400);
      assert.equal(error.code, 'plugin.invalidInput');
    }
    await request(prefix + '/plugins/layerive.colorize/run', { ...input, fields: { reference: otherUpload.project.currentImageId } }, 404);
    assert.equal(calls.length, before);
  });
  await t.test('all generation entry points reject foreign or missing parent versions before creating a task', async () => {
    const before = calls.length;
    const originalData = (await exported(project.id)).data;
    for (const parentVersionId of [copied.versions[0].id, 'missing-version']) {
      for (const [route, extra] of [
        ['/plugins/layerive.colorize/run', {}],
        ['/plugins/layerive.local-edit/run', { instruction: '修改', rect: { x: 20, y: 20, width: 30, height: 30 } }],
        ['/generate', { operation: 'edit_prompt', inputImageId: imageId, prompt: 'test' }],
        ['/batch-edit', { prompts: ['one', 'two'] }],
        ['/batch-generate', { modelId: 'no-edit', prompts: ['one', 'two'] }],
        ['/local-edit-batch', { instructions: ['one', 'two'], rect: { x: 20, y: 20, width: 30, height: 30 } }],
      ]) {
        assert.equal((await request(prefix + route, { ...input, ...extra, parentVersionId }, 404)).code, 'version.notFound');
      }
    }
    const after = (await exported(project.id)).data;
    assert.equal(calls.length, before);
    assert.equal(after.tasks.length, originalData.tasks.length);
    assert.equal(after.versions.length, originalData.versions.length);
  });
});

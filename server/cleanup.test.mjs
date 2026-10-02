import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { validateCleanupInput, validateCleanupPlan, cleanupLabels } from './cleanup.mjs';
import { normalizeLocalImage, pixelRect, preserveOutsideRegions } from './local-edit.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(fn) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await fn()) return; await pause(30); }
  throw new Error('Timed out waiting for cleanup fixture');
}
const keepRects = [{ x: 40, y: 20, width: 20, height: 60 }];
const targets = [
  { description: '左上临时干扰', rect: { x: 5, y: 5, width: 15, height: 20 }, confidence: 0.95 },
  { description: '右下临时干扰及专属阴影', rect: { x: 65, y: 50, width: 20, height: 25 }, confidence: 0.95 },
  { description: '主体旁的干扰', rect: { x: 30, y: 25, width: 20, height: 30 }, confidence: 0.95 },
];
const validPlan = { applicable: true, confidence: 0.96, keep_subjects: ['主要主体及背景结构'], keep_rects: keepRects, targets, background: '恢复原有纹理和透视', edit_prompt: '按识别清单删除干扰，保留主要主体与背景。' };
const options = { mode: 'people', keepPoints: [{ x: 55, y: 40 }] };

test('cleanup validates modes, keep points, ambiguity and protected subject conflicts', () => {
  assert.equal(validateCleanupInput({}).mode, 'selection');
  for (const input of [{ mode: 'constructor' }, { mode: 'people', keepPoints: [{ x: NaN, y: 1 }] }, { mode: 'people', keepPoints: [{ x: '5', y: 2 }] }, { mode: 'people', keepPoints: Array(21).fill({ x: 1, y: 1 }) }, { mode: 'room', keepPoints: [{ x: 1, y: 1 }] }, { mode: 'room', instruction: 'a'.repeat(1001) }]) assert.throws(() => validateCleanupInput(input));
  assert.equal(validateCleanupPlan(validPlan, options).targets.length, 3);
  for (const [plan, code] of [
    [{ applicable: false }, 'cleanup.ambiguous'],
    [{ ...validPlan, targets: [] }, 'cleanup.noTargets'],
    [{ ...validPlan, confidence: 0.1 }, 'cleanup.invalidPlan'],
    [{ ...validPlan, targets: [{ ...targets[0], rect: { x: 90, y: 0, width: 50, height: 10 } }] }, 'cleanup.invalidPlan'],
    [{ ...validPlan, keep_rects: [] }, 'cleanup.protectedSubjectMissing'],
    [{ ...validPlan, targets: [{ description: '误删主角', rect: keepRects[0], confidence: 0.99 }] }, 'cleanup.protectedConflict'],
  ]) assert.throws(() => validateCleanupPlan(plan, options), error => error.code === code);
});

test('cleanup region union preserves untouched and protected pixels without double blending', async () => {
  const source = await normalizeLocalImage(await sharp({ create: { width: 300, height: 200, channels: 4, background: '#123456' } }).png().toBuffer());
  const output = { bytes: await sharp({ create: { width: 150, height: 100, channels: 4, background: '#ffcc33' } }).png().toBuffer() };
  const rects = [{ x: 10, y: 10, width: 30, height: 40 }, { x: 25, y: 25, width: 30, height: 40 }];
  const protectedRects = [{ x: 30, y: 30, width: 10, height: 20 }];
  const result = await preserveOutsideRegions(source, output, rects, protectedRects);
  const reversed = await preserveOutsideRegions(source, output, [...rects].reverse(), protectedRects);
  assert.deepEqual(result.bytes, reversed.bytes, 'overlap order must not change feathering');
  const original = await sharp(source.buffer).ensureAlpha().raw().toBuffer();
  const generated = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
  const regions = rects.map(rect => pixelRect(rect, source.width, source.height));
  const protections = protectedRects.map(rect => pixelRect(rect, source.width, source.height));
  const contains = (r, x, y) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
  let changed = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const offset = (y * source.width + x) * 4;
    const same = original.subarray(offset, offset + 4).equals(generated.subarray(offset, offset + 4));
    if (!regions.some(r => contains(r, x, y)) || protections.some(r => contains(r, x, y))) assert.ok(same, `protected/outside pixel changed at ${x},${y}`);
    else if (!same) changed++;
  }
  assert.ok(changed > 1000);
});

test('whole-image cleanup API: scenarios, provider protocols, pixel retention, cancellation and history', { timeout: 60000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const temporary = await mkdtemp(path.join(root, 'work', 'cleanup-test-'));
  const configRoot = path.join(temporary, 'config');
  await mkdir(configRoot);
  const source = await sharp({ create: { width: 160, height: 120, channels: 4, background: '#123456' } }).png().toBuffer();
  const output = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#99ff22' } }).png().toBuffer();
  const calls = [];
  let plan = validPlan;
  let hold = null;
  let release;
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const isImage = req.url.endsWith('/images/edits') || req.url.endsWith('/interactions');
      calls.push({ url: req.url, bytes, contentType: req.headers['content-type'] });
      if (hold === (isImage ? 'image' : 'vision')) await new Promise(resolve => { release = resolve; });
      res.setHeader('Content-Type', 'application/json');
      if (isImage) return res.end(JSON.stringify(req.url.endsWith('/interactions') ? { output_image: { data: output.toString('base64'), mime_type: 'image/png' } } : { data: [{ b64_json: output.toString('base64') }] }));
      const content = JSON.stringify(plan);
      res.end(JSON.stringify(req.url.endsWith('/messages') ? { content: [{ type: 'text', text: content }] } : req.url.endsWith('/responses') ? { output_text: content } : { choices: [{ message: { content } }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const imageFormats = ['openai_images', 'gemini_interactions', 'grok_images', 'sensenova'];
  const visionFormats = ['chat_completions', 'anthropic_messages', 'responses'];
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: imageFormats[0], active_vision_model: visionFormats[0], models: [
    ...imageFormats.map(id => ({ id, name: id, type: 'image', provider: id === 'sensenova' ? 'sensenova' : 'custom', imageApiFormat: id === 'sensenova' ? 'openai_images' : id, model: id === 'sensenova' ? 'sensenova-u1.5-lite' : 'fixture', baseUrl: stubUrl, apiKey: 'local-fixture-key', capabilities: ['edit_prompt'], sizeOptions: ['1024x1024'], outputFormats: ['png'], transparentBackground: true, maxCount: 4, defaultParams: { size: '1024x1024' } })),
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
    const response = await fetch(base + '/api' + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json(); assert.equal(response.status, status, JSON.stringify(payload)); return payload;
  }
  async function fixture() {
    const { project } = await request('/projects', { name: 'Cleanup fixture' }, 201);
    const prefix = '/projects/' + project.id;
    const uploaded = await request(prefix + '/images', { data: source.toString('base64'), mimeType: 'image/png', name: 'source.png' }, 201);
    return { prefix, imageId: uploaded.project.currentImageId };
  }
  async function finished(f, taskId) {
    let task;
    await waitUntil(async () => { task = await request(f.prefix + '/tasks/' + taskId); return task.status !== 'generating'; });
    return task;
  }
  const input = f => ({ imageId: f.imageId, params: { count: 4, transparent: true, outputFormat: 'jpeg' } });
  const rules = [/主角与同行者/, /临时杂物/, /全部可见文字/, /不移动家具/];
  let saved;
  for (const [index, mode] of ['people', 'clutter', 'text', 'room'].entries()) {
    const f = await fixture(); const mark = calls.length;
    // Text is allowed to modify surfaces of the main product; no full carrier protection.
    plan = mode === 'text' ? { ...validPlan, keep_rects: [] } : validPlan;
    const started = await request(f.prefix + '/remove-element', { ...input(f), mode, modelId: imageFormats[index], visionModelId: visionFormats[index % 3], instruction: '保留主要主体，不添加新物体', ...(mode === 'people' ? { keepPoints: options.keepPoints } : {}) }, 202);
    assert.equal((await finished(f, started.taskId)).status, 'success');
    const vision = JSON.parse(calls[mark].bytes);
    assert.equal(vision.max_tokens || vision.max_output_tokens || vision.max_new_tokens, 8192, 'multi-target planning needs a larger output budget');
    const content = vision.input?.[0].content || vision.messages.at(-1).content;
    assert.equal(content.filter(item => ['input_image', 'image_url', 'image'].includes(item.type)).length, 1);
    assert.match(JSON.stringify(content), new RegExp(cleanupLabels[mode]));
    assert.match(JSON.stringify(content), rules[index]);
    if (mode === 'people') assert.match(JSON.stringify(content), /55/);
    const imageCalls = calls.slice(mark).filter(call => call.url.endsWith('/images/edits') || call.url.endsWith('/interactions'));
    assert.equal(imageCalls.length, 1, 'cleanup is always one output');
    let prompt;
    if (index === 0) {
      const form = await new Response(imageCalls[0].bytes, { headers: { 'Content-Type': imageCalls[0].contentType } }).formData();
      assert.equal(form.get('n'), '1'); assert.notEqual(form.get('background'), 'transparent'); prompt = form.get('prompt');
    } else {
      const body = JSON.parse(imageCalls[0].bytes); prompt = body.prompt || body.input.find(item => item.type === 'text').text;
      if (body.n) assert.equal(body.n, 1);
    }
    assert.match(prompt, rules[index]); assert.match(prompt, /仅删除以下目标/); assert.match(prompt, /必须保留/);
    const bundle = await request(f.prefix);
    const version = bundle.versions.find(v => v.operation === 'remove_element');
    assert.equal(version.outputs.length, 1); assert.equal(version.outputs[0].mimeType, 'image/png');
    assert.equal(version.outputs[0].width, 160); assert.equal(version.outputs[0].height, 120);
    assert.equal(version.parentVersionId, bundle.versions.find(v => v.operation === 'upload').id);
    assert.ok(version.inputs.some(image => image.id === f.imageId));
    const raw = await sharp(Buffer.from(await (await fetch(base + version.outputs[0].url)).arrayBuffer())).ensureAlpha().raw().toBuffer();
    const pixel = (x, y) => Array.from(raw.subarray((y * 160 + x) * 4, (y * 160 + x) * 4 + 4));
    assert.deepEqual(pixel(150, 10), [18, 52, 86, 255], 'outside target regions must be unchanged');
    assert.deepEqual(pixel(20, 15), [153, 255, 34, 255], 'identified target must use generated repair');
    if (mode !== 'text') assert.deepEqual(pixel(70, 40), [18, 52, 86, 255], 'protected subject overlapping a target must keep original pixels');
    const modelLogs = (await request(f.prefix + '/model-logs')).logs;
    assert.ok(modelLogs.every(log => log.taskId === started.taskId && !JSON.stringify(log).includes('local-fixture-key') && !JSON.stringify(log).includes('base64,')));
    saved = f;
  }
  const f = await fixture();
  await request(f.prefix + '/remove-element', { ...input(f), mode: 'unknown' }, 400);
  await request(f.prefix + '/remove-element', input(f), 400); // old/default mode still requires a selection
  for (const [invalidPlan, code] of [[{ applicable: false }, 'cleanup.ambiguous'], [{ ...validPlan, targets: [] }, 'cleanup.noTargets'], [{ ...validPlan, keep_rects: [] }, 'cleanup.protectedSubjectMissing'], [{ ...validPlan, targets: [{ description: '误删主角', rect: keepRects[0], confidence: 0.99 }] }, 'cleanup.protectedConflict']]) {
    plan = invalidPlan; const mark = calls.length;
    const started = await request(f.prefix + '/remove-element', { ...input(f), ...options }, 202);
    assert.equal((await finished(f, started.taskId)).errorCode, code);
    assert.ok(!calls.slice(mark).some(call => call.url.endsWith('/images/edits')));
    assert.equal((await request(f.prefix)).project.currentImageId, f.imageId);
  }
  plan = validPlan;
  for (const phase of ['vision', 'image']) {
    hold = phase; release = null; const mark = calls.length;
    const started = await request(f.prefix + '/remove-element', { ...input(f), ...options }, 202);
    await waitUntil(() => Boolean(release));
    assert.equal((await request(f.prefix + '/tasks/' + started.taskId)).stage, phase === 'vision' ? 'planning' : 'generating');
    await request(f.prefix + '/tasks/' + started.taskId + '/cancel', {});
    release(); hold = null;
    assert.equal((await finished(f, started.taskId)).status, 'canceled');
    assert.ok(!(await request(f.prefix)).versions.some(v => v.operation === 'remove_element'));
    if (phase === 'vision') assert.ok(!calls.slice(mark).some(call => call.url.endsWith('/images/edits')));
  }
  const duplicate = await request(saved.prefix + '/duplicate', {}, 201);
  assert.ok(duplicate.versions.find(v => v.operation === 'remove_element').inputs.every(image => duplicate.images.some(item => item.id === image.id)));
});

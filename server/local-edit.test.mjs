import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { cropLocalSelection, normalizeLocalImage, normalizeSenseNovaInput, pixelRect, preserveOutsideRegion, referenceBytes, validatePlacement, validateRect } from './local-edit.mjs';

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

test('reject invalid uploads and model coordinates before dual-image editing', () => {
  for (const bad of [null, { ...rect, width: NaN }, { ...rect, x: '25' }, { ...rect, x: 99 }, { ...rect, height: 0 }]) assert.throws(() => validateRect(bad));
  assert.throws(() => validatePlacement({ ...plan, target_rect: { x: 0, y: 0, width: 10, height: 10 } }, rect), /超出/);
  assert.throws(() => validatePlacement({ ...plan, reference_rect: { x: -1, y: 0, width: 10, height: 10 } }, rect));
  assert.throws(() => referenceBytes({ data: '!!!!', mimeType: 'image/png' }));
  assert.throws(() => referenceBytes({ data: 'YWJj', mimeType: 'image/svg+xml' }));
  assert.throws(() => referenceBytes({ data: 'A'.repeat(14 * 1024 * 1024), mimeType: 'image/png' }));
});

test('PNG/JPEG/WebP decoding, orientation, selection detail and original outside pixels', async () => {
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
  const selectionDetail = await cropLocalSelection(source, rect);
  assert.ok(selectionDetail.width >= pixelRect(rect, source.width, source.height).width);
  assert.ok(selectionDetail.height >= pixelRect(rect, source.width, source.height).height);
  assert.ok(Math.max(selectionDetail.width, selectionDetail.height) <= 2048);
  // Simulate a model that changes the entire image and returns the wrong size.
  const output = await preserveOutsideRegion(source, { bytes: await solid(300, 300, 'green') }, rect);
  assert.equal(output.mimeType, 'image/png');
  assert.equal(output.width, 120);
  assert.equal(output.height, 90);
  assertOutside(await raw(source.buffer), await raw(output.bytes), 120, 90, rect);
});

test('SenseNova provider copies use a valid 32px-aligned canvas without changing the original', async () => {
  const source = await solid(450, 450, '#f4d35e');
  const preferred = await normalizeSenseNovaInput(source, '1024x1024');
  assert.equal(preferred.mime_type, 'image/png');
  assert.deepEqual(await sharp(preferred.buffer).metadata().then(({ width, height }) => ({ width, height })), { width: 1024, height: 1024 });
  assert.deepEqual(await sharp(source).metadata().then(({ width, height }) => ({ width, height })), { width: 450, height: 450 });

  const automatic = await normalizeSenseNovaInput(await solid(120, 90, '#264560'));
  assert.equal(automatic.width % 32, 0);
  assert.equal(automatic.height % 32, 0);
  assert.ok(automatic.width >= 512 && automatic.height >= 512);
  assert.ok(Math.max(automatic.width / automatic.height, automatic.height / automatic.width) <= 3);
});

test('local edit API: ordered dual-image inputs across providers, history, failures and cancellation', { timeout: 60000 }, async (t) => {
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
      if (req.url.endsWith('/images/edits') || req.url.endsWith('/interactions')) {
        if (mode === 'hold-generation') await new Promise((resolve) => { releaseGeneration = resolve; });
        res.setHeader('Content-Type', 'application/json');
        if (mode === 'reject-images') {
          res.writeHead(400);
          res.end(JSON.stringify({ error: { message: 'Dual-image editing rejected by fixture' } }));
          return;
        }
        if (req.url.endsWith('/interactions')) {
          res.end(JSON.stringify({ output_image: { data: generated.toString('base64'), mime_type: 'image/png' } }));
          return;
        }
        res.end(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }, { b64_json: generated.toString('base64') }] }));
        return;
      }
      if (mode === 'hold-vision') await new Promise((resolve) => { releaseVision = resolve; });
      const content = JSON.stringify(
        mode === 'bad-plan' ? { ...plan, target_rect: { x: 0, y: 0, width: 5, height: 5 } }
          : mode === 'ambiguous-plan' ? { error: '无法确认要替换的主体，请补充要求' }
          : mode === 'remove-plan' ? { target: '选区中央的蓝色杯子', target_rect: { x: 32, y: 28, width: 24, height: 30 }, confidence: 0.96, background: '延续桌面木纹和杯子后方墙面', edit_prompt: '删除蓝色杯子和杯子投下的阴影，自然补全桌面木纹与墙面。' }
            : mode === 'remove-ambiguous' ? { error: '选区内有两个同样显眼的杯子，无法判断要删除哪一个' }
              : plan,
      );
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url.endsWith('/messages') ? { content: [{ type: 'text', text: content }] } : req.url.endsWith('/responses') ? { output_text: content } : { choices: [{ message: { content } }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const visionFormats = ['chat_completions', 'anthropic_messages', 'responses'];
  const imageProtocols = ['openai_images', 'gemini_interactions', 'grok_images', 'sensenova'];
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: 'image', active_vision_model: visionFormats[0], models: [
    { id: 'image', name: 'Local image stub', provider: 'openai', type: 'image', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-test-placeholder', capabilities: ['edit_prompt'], defaultParams: { size: '1024x1024' } },
    ...imageProtocols.slice(1).map(id => ({ id, name: id, provider: id === 'sensenova' ? 'sensenova' : 'custom', imageApiFormat: id === 'sensenova' ? 'openai_images' : id, type: 'image', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-test-placeholder', capabilities: ['edit_prompt'], sizeOptions: ['1024x1024'], outputFormats: ['png'], maxCount: 2, defaultParams: { size: '1024x1024' } })),
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
  async function assertDualImageCall(call, protocol = 'openai_images') {
    let images;
    let prompt;
    if (protocol === 'openai_images') {
      const form = await new Response(call.bytes, { headers: { 'Content-Type': call.contentType } }).formData();
      assert.equal(form.get('image'), null);
      images = await Promise.all(form.getAll('image[]').map(async image => Buffer.from(await image.arrayBuffer())));
      prompt = form.get('prompt');
    } else {
      const body = JSON.parse(call.bytes);
      prompt = protocol === 'gemini_interactions' ? body.input.find(item => item.type === 'text').text : body.prompt;
      if (protocol === 'gemini_interactions') images = body.input.filter(item => item.type === 'image').map(item => Buffer.from(item.data, 'base64'));
      else {
        assert.equal(body.image, undefined);
        images = body.images.map(item => Buffer.from((item.image_url || item.url).split(',')[1], 'base64'));
      }
    }
    assert.equal(images.length, 2);
    // Both full images must reach the provider in order, with no crop or pasted subject.
    const normalized = [await normalizeLocalImage(sourceBytes), await normalizeLocalImage(referenceBytes(reference), true)];
    for (const [index, image] of normalized.entries()) {
      const expected = protocol === 'sensenova' ? await normalizeSenseNovaInput(image.buffer, '1024x1024') : image;
      const actualMetadata = await sharp(images[index]).metadata();
      assert.equal(actualMetadata.width, expected.width);
      assert.equal(actualMetadata.height, expected.height);
      assert.deepEqual(await raw(images[index]), await raw(expected.buffer));
    }
    assert.match(prompt, /图1是待编辑原图，图2是完整参考图/);
    assert.match(prompt, /保留图2主体的身份/);
    assert.match(prompt, /不要引入图2背景或照搬图2阴影/);
    assert.ok(prompt.includes(JSON.stringify(plan.target_rect)));
    assert.ok(prompt.includes(JSON.stringify(plan.reference_rect)));
    assert.doesNotMatch(prompt, /初步拼贴|裁剪源像素/);
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
    assert.match(JSON.stringify(content), /图片编辑模型将直接收到同样的两张完整图片/);
    const modelCall = calls.slice(first).find((item) => item.url.endsWith('/images/edits'));
    await assertDualImageCall(modelCall);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.find((item) => item.operation === 'local_edit');
    assert.equal(version.outputs.length, 2);
    assert.equal(version.parentVersionId, bundle.versions.find((item) => item.operation === 'upload').id);
    assert.deepEqual(version.inputs.map((item) => item.sourceType).sort(), ['local_reference', 'upload']);
    assert.ok(!bundle.images.some(image => image.sourceType === 'local_composite'));
    const modelLogs = await request(`/projects/${fixture.projectId}/model-logs`);
    assert.ok(modelLogs.logs.filter(log => log.modelType === 'image').every(log => log.request.inputImageCount === 2));
    for (const image of version.outputs) {
      assert.equal(image.width, 120); assert.equal(image.height, 90); assert.equal(image.mimeType, 'image/png');
      const bytes = Buffer.from(await (await fetch(base + image.url)).arrayBuffer());
      assertOutside(await raw(sourceBytes), await raw(bytes), 120, 90, rect);
    }
  }
  for (const protocol of imageProtocols.slice(1)) {
    const fixture = await fixtureProject();
    const first = calls.length;
    const started = await submit(fixture, { modelId: protocol, instruction: '保留参考主体的花纹与耳形' });
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const modelCalls = calls.slice(first).filter(call => call.url.endsWith('/images/edits') || call.url.endsWith('/interactions'));
    assert.ok(modelCalls.length > 0);
    for (const call of modelCalls) await assertDualImageCall(call, protocol);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.find(item => item.operation === 'local_edit');
    assert.equal(version.outputs.length, 2);
    assert.deepEqual(version.inputs.map(item => item.sourceType).sort(), ['local_reference', 'upload']);
    for (const image of version.outputs) {
      const bytes = Buffer.from(await (await fetch(base + image.url)).arrayBuffer());
      assertOutside(await raw(sourceBytes), await raw(bytes), 120, 90, rect);
    }
  }
  const textFixture = await fixtureProject();
  const textStart = calls.length;
  const textTask = await submit(textFixture, { reference: undefined, instruction: '将选区变绿' });
  assert.equal((await finished(textFixture.projectId, textTask.taskId)).status, 'success');
  assert.equal(JSON.parse(calls[textStart].bytes).messages.at(-1).content.filter((item) => item.type === 'image_url').length, 1);
  const textCall = calls.slice(textStart).find(item => item.url.endsWith('/images/edits'));
  const textForm = await new Response(textCall.bytes, { headers: { 'Content-Type': textCall.contentType } }).formData();
  assert.equal(textForm.getAll('image[]').length, 0);
  assert.deepEqual(Buffer.from(await textForm.get('image').arrayBuffer()), sourceBytes);
  const badFixture = await fixtureProject();
  mode = 'bad-plan';
  const beforeBad = calls.length;
  const bad = await submit(badFixture);
  assert.equal((await finished(badFixture.projectId, bad.taskId)).status, 'failed');
  assert.ok(!calls.slice(beforeBad).some((item) => item.url.endsWith('/images/edits')));
  assert.equal((await request(`/projects/${badFixture.projectId}`)).project.currentImageId, badFixture.imageId);
  for (const failure of ['ambiguous-plan', 'reject-images']) {
    mode = failure;
    const fixture = await fixtureProject();
    const first = calls.length;
    const started = await submit(fixture, { params: { size: '1024x1024', count: 1 } });
    assert.equal((await finished(fixture.projectId, started.taskId)).status, 'failed');
    const imageCalls = calls.slice(first).filter(call => call.url.endsWith('/images/edits'));
    if (failure === 'ambiguous-plan') assert.equal(imageCalls.length, 0);
    else assert.ok(imageCalls.length > 0);
    for (const call of imageCalls) await assertDualImageCall(call);
    const bundle = await request(`/projects/${fixture.projectId}`);
    assert.equal(bundle.project.currentImageId, fixture.imageId);
    assert.ok(!bundle.versions.some(item => item.operation === 'local_edit'));
  }

  // 删除元素：视觉模型先确认唯一目标和精确范围，图片模型只生成一张，随后恢复选区外原像素。
  mode = 'remove-plan';
  {
    const fixture = await fixtureProject();
    const first = calls.length;
    const started = await request(`/projects/${fixture.projectId}/remove-element`, {
      imageId: fixture.imageId,
      modelId: 'image',
      visionModelId: visionFormats[0],
      rect,
      params: { size: '1024x1024', count: 4, outputFormat: 'jpeg' },
    }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const visionCall = JSON.parse(calls[first].bytes);
    assert.match(JSON.stringify(visionCall), /矩形只是指向提示/);
    assert.match(JSON.stringify(visionCall), /一双鞋/);
    assert.equal(visionCall.messages.at(-1).content.filter((item) => item.type === 'image_url').length, 2);
    const modelCall = calls.slice(first).find((item) => item.url.endsWith('/images/edits'));
    const form = await new Response(modelCall.bytes, { headers: { 'Content-Type': modelCall.contentType } }).formData();
    assert.match(form.get('prompt'), /选区中央的蓝色杯子/);
    assert.match(form.get('prompt'), /不要清空整个矩形/);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.find((item) => item.operation === 'remove_element');
    assert.equal(version.outputs.length, 1);
    const output = version.outputs[0];
    assert.equal(output.mimeType, 'image/png');
    assert.equal(output.width, 120); assert.equal(output.height, 90);
    assertOutside(await raw(sourceBytes), await raw(Buffer.from(await (await fetch(base + output.url)).arrayBuffer())), 120, 90, rect);
  }

  mode = 'remove-ambiguous';
  {
    const fixture = await fixtureProject();
    const first = calls.length;
    const started = await request(`/projects/${fixture.projectId}/remove-element`, {
      imageId: fixture.imageId,
      modelId: 'image',
      visionModelId: visionFormats[0],
      rect,
    }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'removeElement.ambiguous');
    assert.ok(!calls.slice(first).some((item) => item.url.endsWith('/images/edits')));
  }

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

  // 批量局部修改：多条指令共用同一选区与参考图，逐张写入同一个版本并保留框外像素。
  mode = 'success';
  {
    const fixture = await fixtureProject();
    const first = calls.length;
    const started = await request(`/projects/${fixture.projectId}/local-edit-batch`, {
      imageId: fixture.imageId,
      modelId: 'image',
      visionModelId: visionFormats[0],
      rect,
      reference,
      instructions: ['把主体换成红色款', '把主体换成蓝色款'],
      params: { size: '1024x1024' },
    }, 202);
    let progress;
    await waitUntil(async () => {
      progress = await request(`/projects/${fixture.projectId}/batch-edits/${started.taskId}`);
      return progress.status !== 'generating';
    });
    assert.equal(progress.status, 'success', progress.error);
    assert.equal(progress.localEdit, true);
    assert.equal(progress.total, 2);
    assert.deepEqual(progress.items.map((item) => item.values), [
      { 指令: '把主体换成红色款' },
      { 指令: '把主体换成蓝色款' },
    ]);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.filter((item) => item.operation === 'local_edit').at(-1);
    assert.equal(version.status, 'success');
    assert.equal(version.outputs.length, 2);
    // 每个子项独立规划，完整原图与参考图分别输入图片模型，不创建合成素材。
    assert.deepEqual(version.inputs.map((item) => item.sourceType).sort(), ['local_reference', 'local_reference', 'upload']);
    assert.ok(!bundle.images.some(image => image.sourceType === 'local_composite'));
    const batchCalls = calls.slice(first).filter(call => call.url.endsWith('/images/edits'));
    assert.equal(batchCalls.length, 2);
    for (const call of batchCalls) await assertDualImageCall(call);
    for (const image of version.outputs) {
      assert.equal(image.width, 120); assert.equal(image.height, 90); assert.equal(image.mimeType, 'image/png');
      const bytes = Buffer.from(await (await fetch(base + image.url)).arrayBuffer());
      assertOutside(await raw(sourceBytes), await raw(bytes), 120, 90, rect);
    }
    const single = await request(`/projects/${fixture.projectId}/local-edit-batch`, {
      imageId: fixture.imageId,
      modelId: 'image',
      rect,
      instructions: ['只有一条指令'],
    }, 400);
    assert.match(single.error, /2–50/);
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

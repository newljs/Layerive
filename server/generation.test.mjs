import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readZip } from './zip.mjs';

const solid = (width, height, background) => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('generate API: automatic multi-image intent, concurrency, retry, ZIP and provider compatibility', { timeout: 120000 }, async (t) => {
  // Only generated fixtures and a loopback model stub; never read user data/config.
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const testRoot = await mkdtemp(path.join(root, 'work', 'generation-test-'));
  const dataRoot = path.join(testRoot, 'data');
  const configRoot = path.join(testRoot, 'config');
  await mkdir(configRoot);
  const sourceBytes = await solid(120, 90, '#264560');
  const generated = await solid(128, 128, '#49b974');
  const calls = [];
  let visionPrompts = null;
  let visionDifferent = false;
  let failNext429 = 0;
  let always429 = false;
  let nextImageError = null;
  let imageDelayMs = 80;
  let inFlight = 0;
  let maxInFlight = 0;
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      calls.push({ url: req.url, bytes, contentType: req.headers['content-type'] });
      if (req.url.endsWith('/images/generations') || req.url.endsWith('/images/edits')) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          // Hold each request briefly so overlapping fan-out is observable.
          await pause(imageDelayMs);
          if (always429 || failNext429 > 0) {
            if (!always429) failNext429 -= 1;
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
            res.end(JSON.stringify({ error: { message: 'rps exhausted' } }));
            return;
          }
          if (nextImageError) {
            const message = nextImageError;
            nextImageError = null;
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message } }));
            return;
          }
          // The gateway ignores `n`: exactly one image per request, so the
          // native batch path must fill the shortfall with count=1 requests.
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }));
          return;
        } finally {
          inFlight -= 1;
        }
      }
      const content = JSON.stringify({ different: visionDifferent, prompts: visionPrompts });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: 'image', active_vision_model: 'vision', models: [
    { id: 'image', name: 'Batch image stub', provider: 'openai', type: 'image', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-test-placeholder', capabilities: ['text_to_image', 'edit_prompt'], defaultParams: { size: '1024x1024' } },
    { id: 'sensenova', name: 'SenseNova image stub', provider: 'sensenova', type: 'image', model: 'sensenova-u1.5-lite', baseUrl: stubUrl, apiKey: 'local-test-placeholder', capabilities: ['text_to_image', 'edit_prompt'], defaultParams: { size: '2048x2048' } },
    { id: 'vision', name: 'Vision stub', provider: 'openai', type: 'vision', apiFormat: 'chat_completions', model: 'fixture', baseUrl: stubUrl, apiKey: 'local-test-placeholder' },
  ] }));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
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
  async function fixtureProject(source = sourceBytes) {
    const { project } = await request('/projects', { name: 'Generation fixture' }, 201);
    const uploaded = await request(`/projects/${project.id}/images`, { data: source.toString('base64'), mimeType: 'image/png', name: 'source.png' }, 201);
    return { projectId: project.id, imageId: uploaded.project.currentImageId };
  }
  async function finished(projectId, taskId) {
    let task;
    await waitUntil(async () => { task = await request(`/projects/${projectId}/tasks/${taskId}`); return task.status !== 'generating'; });
    return task;
  }
  const imageBodiesSince = (mark) => calls.slice(mark)
    .filter((item) => item.url.endsWith('/images/generations') || item.url.endsWith('/images/edits'))
    .map((item) => JSON.parse(item.bytes));

  // 1) 明确的分别出图意图：视觉模型自动判断并拆成 N 条，逐张生成、按序对齐。
  {
    const fixture = await fixtureProject();
    visionDifferent = true;
    visionPrompts = ['喜：微笑的表情', '怒：皱眉的表情', '哀：流泪的表情', '乐：大笑的表情'];
    const mark = calls.length;
    maxInFlight = 0;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '帮我生成4个表情图，喜怒哀乐', visionModelId: 'vision', params: { size: '1024x1024', count: 4 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const bodies = imageBodiesSince(mark);
    assert.equal(bodies.length, 4);
    assert.deepEqual(bodies.map((body) => body.prompt).sort(), [...visionPrompts].sort());
    assert.ok(bodies.every((body) => body.n === 1), 'different mode must request one image per prompt');
    assert.equal(maxInFlight, 2, 'image requests must respect the concurrency cap');
    const visionBody = JSON.parse(calls[mark].bytes);
    assert.match(visionBody.messages.at(-1).content[0].text, /用户选择生成 4 张图片/);
    assert.match(visionBody.messages.at(-1).content[0].text, /含糊时一律为 false/);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.find((item) => item.operation === 'text_to_image');
    assert.equal(version.outputs.length, 4);
    const result = bundle.messages.find((message) => message.type === 'result');
    assert.deepEqual(result.content.prompts, visionPrompts);
    assert.equal(result.content.promptMode, 'different');
    assert.equal(result.content.outputImageIds.length, 4);
    const download = await fetch(`${base}/api/projects/${fixture.projectId}/versions/${version.id}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type'), /application\/zip/);
    assert.match(download.headers.get('content-disposition'), /layerive-V\d+-4-images\.zip/);
    const entries = readZip(Buffer.from(await download.arrayBuffer()));
    assert.equal(entries.size, 4);
    assert.deepEqual([...entries.keys()], [`V${version.number}-01.png`, `V${version.number}-02.png`, `V${version.number}-03.png`, `V${version.number}-04.png`]);
  }

  // 2) 判断结果要求分别生成但拆分条数不足时，保守回退为同提示词候选。
  {
    const fixture = await fixtureProject();
    visionDifferent = true;
    visionPrompts = ['第一条', '第二条', '第三条'];
    const mark = calls.length;
    const prompt = '帮我生成4个表情图，喜怒哀乐';
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt, visionModelId: 'vision', params: { size: '1024x1024', count: 4 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const bundle = await request(`/projects/${fixture.projectId}`);
    const result = bundle.messages.find((message) => message.type === 'result');
    assert.equal(result.content.promptMode, 'same');
    assert.equal(result.content.prompts, undefined);
    assert.equal(imageBodiesSince(mark).length, 4);
  }

  // 3) 原生批量路径：网关忽略 n 时按缺口补发 count=1 请求，同样受限并发。
  {
    const fixture = await fixtureProject();
    visionDifferent = false;
    visionPrompts = null;
    const mark = calls.length;
    maxInFlight = 0;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '一只橙猫', params: { size: '1024x1024', count: 4 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const bodies = imageBodiesSince(mark);
    assert.equal(bodies.length, 4);
    assert.equal(bodies[0].n, 4);
    assert.ok(bodies.slice(1).every((body) => body.n === 1 && body.prompt === '一只橙猫'));
    assert.equal(maxInFlight, 2);
    const bundle = await request(`/projects/${fixture.projectId}`);
    assert.equal(bundle.versions.find((item) => item.operation === 'text_to_image').outputs.length, 4);
  }

  // 4) 限流退避：前两次 429 后重试成功，缺口继续补发。
  {
    const fixture = await fixtureProject();
    const mark = calls.length;
    failNext429 = 2;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '一只橙猫', params: { size: '1024x1024', count: 2 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    assert.equal(imageBodiesSince(mark).length, 4);
    const bundle = await request(`/projects/${fixture.projectId}`);
    assert.equal(bundle.versions.find((item) => item.operation === 'text_to_image').outputs.length, 2);
  }

  // 5) 持续限流：任务失败并映射为友好的中文提示。
  {
    const fixture = await fixtureProject();
    always429 = true;
    const mark = calls.length;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '一只橙猫', params: { size: '1024x1024', count: 1 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'failed');
    assert.match(task.error, /模型平台请求频率超限/);
    assert.equal(imageBodiesSince(mark).length, 3, 'must retry exactly twice before failing');
    const bundle = await request(`/projects/${fixture.projectId}`);
    assert.equal(bundle.versions.filter((item) => item.operation === 'text_to_image').length, 0);
  }
  always429 = false;

  // 6) 带输入图且意图明确不同：视觉请求携带原图，编辑请求逐条使用子提示词。
  {
    const fixture = await fixtureProject();
    visionDifferent = true;
    visionPrompts = ['喜', '怒', '哀', '乐'];
    const mark = calls.length;
    maxInFlight = 0;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '基于这张表情包生成4个不同表情', visionModelId: 'vision', inputImageId: fixture.imageId, params: { size: '1024x1024', count: 4 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const visionBody = JSON.parse(calls[mark].bytes);
    assert.equal(visionBody.messages.at(-1).content.filter((item) => item.type === 'image_url').length, 1);
    const forms = await Promise.all(calls.slice(mark)
      .filter((item) => item.url.endsWith('/images/edits'))
      .map(async (item) => new Response(item.bytes, { headers: { 'Content-Type': item.contentType } }).formData()));
    assert.equal(forms.length, 4);
    assert.deepEqual(forms.map((form) => form.get('prompt')).sort(), [...visionPrompts].sort());
    assert.ok(forms.every((form) => form.get('n') === '1' && form.get('image')));
    assert.equal(maxInFlight, 2);
    const bundle = await request(`/projects/${fixture.projectId}`);
    assert.equal(bundle.versions.find((item) => item.operation === 'edit_prompt').outputs.length, 4);
  }

  // 7) 校验：数量为 1 时不做意图判断；多图请求的视觉模型不存在时提交即失败。
  {
    const fixture = await fixtureProject();
    visionPrompts = ['不该被调用'];
    const mark = calls.length;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '一只橙猫', visionModelId: 'vision', params: { size: '1024x1024', count: 1 } }, 202);
    assert.equal((await finished(fixture.projectId, started.taskId)).status, 'success');
    assert.ok(!calls.slice(mark).some((item) => item.url.endsWith('/chat/completions')));
    await request(`/projects/${fixture.projectId}/generate`, { prompt: '一只橙猫', visionModelId: 'missing', params: { size: '1024x1024', count: 2 } }, 400);
    assert.ok(!calls.slice(mark).some((item) => item.url.endsWith('/chat/completions')));
  }

  // 8) 日日新编辑：仅规范化发往平台的副本，使用 auto 输出尺寸，并保留平台原始错误详情。
  {
    const fixture = await fixtureProject(await solid(450, 450, '#f4d35e'));
    const mark = calls.length;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '把黄色改成蓝色', modelId: 'sensenova', inputImageId: fixture.imageId, params: { size: '2048x2048', count: 1 } }, 202);
    assert.equal((await finished(fixture.projectId, started.taskId)).status, 'success');
    const body = imageBodiesSince(mark)[0];
    assert.equal(body.size, 'auto');
    assert.equal(body.n, 1);
    assert.equal(body.images.length, 1);
    const match = body.images[0].image_url.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
    assert.ok(match, 'SenseNova edit image must be a prefixed PNG/JPEG data URL');
    const metadata = await sharp(Buffer.from(match[2], 'base64')).metadata();
    assert.equal(metadata.width, 2048);
    assert.equal(metadata.height, 2048);

    nextImageError = 'image should be at least 512 pixels; received an unsupported reference';
    const failed = await request(`/projects/${fixture.projectId}/generate`, { prompt: '再次修改', modelId: 'sensenova', inputImageId: fixture.imageId, params: { size: '2048x2048', count: 1 } }, 202);
    const failedTask = await finished(fixture.projectId, failed.taskId);
    assert.equal(failedTask.status, 'failed');
    assert.match(failedTask.error, /平台原始信息/);
    assert.match(failedTask.error, /at least 512 pixels/);
  }

  // 9) 单图接口在自动判断为普通候选时，仍按所选数量扇出相同提示词。
  {
    const fixture = await fixtureProject();
    visionDifferent = false;
    visionPrompts = [];
    const mark = calls.length;
    const started = await request(`/projects/${fixture.projectId}/generate`, { prompt: '同一只橙猫的普通候选', modelId: 'sensenova', visionModelId: 'vision', params: { size: '2048x2048', count: 2 } }, 202);
    const task = await finished(fixture.projectId, started.taskId);
    assert.equal(task.status, 'success', task.error);
    const bodies = imageBodiesSince(mark);
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every((body) => body.n === 1 && body.prompt === '同一只橙猫的普通候选'));
    const bundle = await request(`/projects/${fixture.projectId}`);
    const result = bundle.messages.find((message) => message.type === 'result');
    assert.equal(result.content.promptMode, 'same');
    assert.equal(bundle.versions.find((item) => item.operation === 'text_to_image').outputs.length, 2);
  }

  // 10) 变量批量处理逐张入库：第一张完成时即可查询，最终归入同一个版本。
  {
    const fixture = await fixtureProject();
    const mark = calls.length;
    const started = await request(`/projects/${fixture.projectId}/batch-edit`, {
      imageId: fixture.imageId,
      modelId: 'sensenova',
      template: '生成一致的{{头部}}人身怪物，穿着{{服装}}，其他区域保持不变',
      quantity: 3,
      variables: [
        { name: '头部', values: ['狗头', '驴头', '狮子头'] },
        { name: '服装', values: ['红色夹克', '蓝色夹克', '绿色夹克'] },
      ],
      params: { size: '2048x2048' },
    }, 202);
    let incremental;
    await waitUntil(async () => {
      incremental = await request(`/projects/${fixture.projectId}/batch-edits/${started.taskId}`);
      return incremental.status === 'generating' && incremental.completed >= 1 && incremental.completed < incremental.total;
    });
    assert.equal(incremental.remaining, incremental.total - incremental.completed - incremental.failed);
    assert.ok(incremental.estimatedRemainingSeconds > 0);
    assert.ok(incremental.items.find((item) => item.status === 'success')?.image?.url);

    let finalProgress;
    await waitUntil(async () => {
      finalProgress = await request(`/projects/${fixture.projectId}/batch-edits/${started.taskId}`);
      return finalProgress.status !== 'generating';
    });
    assert.equal(finalProgress.status, 'success', finalProgress.error);
    assert.equal(finalProgress.completed, 3);
    assert.equal(finalProgress.remaining, 0);
    assert.deepEqual(finalProgress.variableNames, ['头部', '服装']);
    assert.deepEqual(finalProgress.items.map((item) => item.values), [
      { 头部: '狗头', 服装: '红色夹克' },
      { 头部: '驴头', 服装: '蓝色夹克' },
      { 头部: '狮子头', 服装: '绿色夹克' },
    ]);
    assert.ok(finalProgress.items.every((item) => item.status === 'success' && item.image));
    const bodies = imageBodiesSince(mark);
    assert.equal(bodies.length, 3);
    assert.match(bodies[0].prompt, /“头部”替换为“狗头”.*“服装”替换为“红色夹克”/);
    assert.match(bodies[1].prompt, /“头部”替换为“驴头”.*“服装”替换为“蓝色夹克”/);
    assert.match(bodies[2].prompt, /“头部”替换为“狮子头”.*“服装”替换为“绿色夹克”/);
    assert.ok(bodies.every((body) => body.n === 1 && /变量以外的区域一致/.test(body.prompt)));
    const bundle = await request(`/projects/${fixture.projectId}`);
    const version = bundle.versions.find((item) => item.operation === 'batch_edit');
    assert.equal(version.status, 'success');
    assert.equal(version.outputs.length, 3);
    const result = bundle.messages.find((message) => message.type === 'result');
    assert.equal(result.content.batch.completed, 3);
    assert.equal(result.content.outputImageIds.length, 3);

    const partialFixture = await fixtureProject();
    nextImageError = 'temporary invalid item';
    const partialStarted = await request(`/projects/${partialFixture.projectId}/batch-edit`, {
      imageId: partialFixture.imageId,
      modelId: 'sensenova',
      template: '把{{头部}}放到相同身体上',
      quantity: 3,
      values: ['狼头', '熊头', '鹰头'],
      params: { size: '2048x2048' },
    }, 202);
    let partialFinal;
    await waitUntil(async () => {
      partialFinal = await request(`/projects/${partialFixture.projectId}/batch-edits/${partialStarted.taskId}`);
      return partialFinal.status !== 'generating';
    });
    assert.equal(partialFinal.status, 'partial');
    assert.equal(partialFinal.completed, 2);
    assert.equal(partialFinal.failed, 1);
    assert.equal(partialFinal.items[0].status, 'failed');
    assert.ok(partialFinal.items.slice(1).every((item) => item.status === 'success' && item.image));

    const cancelFixture = await fixtureProject();
    imageDelayMs = 250;
    const cancelStarted = await request(`/projects/${cancelFixture.projectId}/batch-edit`, {
      imageId: cancelFixture.imageId,
      modelId: 'sensenova',
      template: '保持其他区域一致，只改{{头部}}',
      quantity: 4,
      values: ['猫头', '狗头', '牛头', '鹿头'],
      params: { size: '2048x2048' },
    }, 202);
    await waitUntil(async () => (await request(`/projects/${cancelFixture.projectId}/batch-edits/${cancelStarted.taskId}`)).completed >= 1);
    await request(`/projects/${cancelFixture.projectId}/tasks/${cancelStarted.taskId}/cancel`, {});
    let canceledProgress;
    await waitUntil(async () => {
      canceledProgress = await request(`/projects/${cancelFixture.projectId}/batch-edits/${cancelStarted.taskId}`);
      return canceledProgress.status !== 'generating';
    });
    imageDelayMs = 80;
    assert.equal(canceledProgress.status, 'canceled');
    assert.ok(canceledProgress.completed >= 1 && canceledProgress.completed < canceledProgress.total);
    const canceledBundle = await request(`/projects/${cancelFixture.projectId}`);
    const canceledVersion = canceledBundle.versions.find((item) => item.operation === 'batch_edit');
    assert.equal(canceledVersion.status, 'partial');
    assert.equal(canceledVersion.outputs.length, canceledProgress.completed);

    // 10b) 提示词列表模式（导入 txt）：每行一条完整提示词，按行数生成且不做变量包装。
    {
      const listFixture = await fixtureProject();
      const listMark = calls.length;
      const listStarted = await request(`/projects/${listFixture.projectId}/batch-edit`, {
        imageId: listFixture.imageId,
        modelId: 'sensenova',
        prompts: ['给主体戴上红色贝雷帽，保持背景不变', '把背景替换成雪夜街道，主体保持一致'],
        params: { size: '2048x2048' },
      }, 202);
      let listFinal;
      await waitUntil(async () => {
        listFinal = await request(`/projects/${listFixture.projectId}/batch-edits/${listStarted.taskId}`);
        return listFinal.status !== 'generating';
      });
      assert.equal(listFinal.status, 'success', listFinal.error);
      assert.equal(listFinal.total, 2);
      assert.deepEqual(listFinal.items.map((item) => item.values), [
        { 提示词: '给主体戴上红色贝雷帽，保持背景不变' },
        { 提示词: '把背景替换成雪夜街道，主体保持一致' },
      ]);
      const listBodies = imageBodiesSince(listMark);
      assert.equal(listBodies.length, 2);
      assert.equal(listBodies[0].prompt, '给主体戴上红色贝雷帽，保持背景不变');
      assert.equal(listBodies[1].prompt, '把背景替换成雪夜街道，主体保持一致');
      assert.ok(listBodies.every((body) => body.n === 1));

      const singlePrompt = await request(`/projects/${listFixture.projectId}/batch-edit`, {
        imageId: listFixture.imageId,
        modelId: 'sensenova',
        prompts: ['只有一条提示词'],
      }, 400);
      assert.match(singlePrompt.error, /2–50/);
    }

    const invalid = await request(`/projects/${fixture.projectId}/batch-edit`, {
      imageId: fixture.imageId,
      modelId: 'sensenova',
      template: '没有变量的普通提示词',
      quantity: 2,
      values: ['甲', '乙'],
    }, 400);
    assert.match(invalid.error, /\{\{变量名\}\}/);
  }
});

async function waitUntil(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(30);
  }
  throw new Error('Timed out waiting for generation fixture');
}

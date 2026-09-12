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
          await pause(80);
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
    assert.deepEqual(bodies.map((body) => body.prompt), visionPrompts);
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
    assert.deepEqual(forms.map((form) => form.get('prompt')), visionPrompts);
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
});

async function waitUntil(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(30);
  }
  throw new Error('Timed out waiting for generation fixture');
}

#!/usr/bin/env node
// Layerive MCP server: exposes the local image workbench to a conversation.
//
// Every tool is a thin wrapper over Layerive's own HTTP API — the same one the
// browser panel uses — so a chat and the UI share one set of projects, versions
// and models. Nothing is reimplemented here.
//
//   LAYERIVE_URL   default http://127.0.0.1:8788
//
// The API refuses non-loopback Host headers (anti DNS-rebinding), so requests
// always carry Host: 127.0.0.1 even though the socket already points there.
// API keys never travel through this process: they live in the server's
// config/models.json and the pool rotates them behind the API.
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const BASE = (process.env.LAYERIVE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const LOOPBACK_HOST = new URL(BASE).host;

/** One call against the workbench. Failures carry Layerive's own words. */
async function api(method, route, body, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      // The server rejects a non-loopback Host outright; this keeps the guard
      // satisfied without weakening it.
      Host: LOOPBACK_HOST,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const why = data?.error || data?.message || text.slice(0, 300);
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`layerive ${method} ${route} → HTTP ${res.status}${code}: ${why}`);
  }
  return data;
}

const ok = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: String(e?.message || e) }], isError: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve a project by id, or by name when the id is unknown. */
async function projectOrThrow(ref) {
  const text = String(ref || '').trim();
  if (!text) throw new Error('需要一个项目 id（用 list_projects 查）');
  const { projects } = await api('GET', '/api/projects');
  const byId = projects.find((item) => item.id === text);
  if (byId) return byId;
  const byName = projects.filter((item) => item.name === text);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`项目名「${text}」对应多个项目，请改用 id：${byName.map((item) => item.id).join(', ')}`);
  throw new Error(`找不到项目：${text}（用 list_projects 查看现有项目）`);
}

/**
 * Poll a task until it settles.
 *
 * Generation is asynchronous by design — the API answers 202 immediately — so a
 * tool that returned at once would be useless to a conversation. The timeout
 * here is the wait budget, not the task's own deadline: a task can still finish
 * afterwards, and the returned task id remains usable with `task_status`.
 */
async function waitForTask(projectId, taskId, { timeoutMs = 300_000, intervalMs = 2_500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await api('GET', `/api/projects/${projectId}/tasks/${taskId}`);
    if (last.status === 'success') return { task: last, done: true };
    if (last.status === 'failed' || last.status === 'cancelled') return { task: last, done: false };
    await sleep(intervalMs);
  }
  return { task: last, done: false, timedOut: true };
}

/**
 * The images a task produced, with absolute URLs.
 *
 * The task detail response carries no versionId, so the version is resolved by
 * id when the caller has one and otherwise by the task's finish time; the newest
 * version is the last resort. Versions arrive newest-first.
 */
async function producedImages(projectId, versionId, task = null) {
  const bundle = await api('GET', `/api/projects/${projectId}`);
  const versions = bundle.versions || [];
  let version = versionId ? versions.find((item) => item.id === versionId) : null;
  if (!version && task) version = versions.find((item) => item.createdAt && item.createdAt === task.finishedAt) || null;
  if (!version && !versionId) version = versions[0] || null;
  if (!version) return { version: null, images: [] };
  return {
    version,
    images: (version.outputs || []).map((image) => ({
      id: image.id,
      width: image.width,
      height: image.height,
      url: image.url ? BASE + image.url : null,
      path: image.url ? image.url : null,
    })),
  };
}

function describeFailure(task) {
  const parts = [`任务 ${task.id} ${task.status}`];
  if (task.error) parts.push(task.error);
  if (task.errorCode) parts.push(`[${task.errorCode}]`);
  return parts.join('：');
}

const server = new McpServer({ name: 'layerive', version: '1.0.0' });

// ── projects ───────────────────────────────────────────────────────────────────
server.registerTool(
  'list_projects',
  {
    title: '列出项目',
    description: '列出 Layerive 里所有项目（id、名称、版本数、默认模型）。生成图片前先用它拿到项目 id；没有项目时用 create_project 建一个。',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { projects } = await api('GET', '/api/projects');
      if (!projects.length) return ok('还没有项目。用 create_project 建一个。');
      return ok(projects.map((p) => `${p.id} 「${p.name}」 版本 ${p.versionCount ?? 0} · 模型 ${p.defaultModelId || '默认'}`).join('\n'));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'create_project',
  {
    title: '新建项目',
    description: '新建一个图片项目。项目是所有版本和图片的容器，生成图片必须属于某个项目。',
    inputSchema: z.object({
      name: z.string().min(1).describe('项目名称'),
      description: z.string().optional().describe('一句话描述'),
    }),
  },
  async ({ name, description }) => {
    try {
      const { project } = await api('POST', '/api/projects', { name, ...(description ? { description } : {}) });
      return ok(`已创建项目：${project.id} 「${project.name}」`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'project_status',
  {
    title: '项目详情',
    description: '看一个项目的版本历史、每版输出图片的尺寸和路径，以及当前画布上的图片。想知道刚才生成了什么、图在哪，用这个。',
    inputSchema: z.object({ project: z.string().min(1).describe('项目 id 或唯一名称') }),
  },
  async ({ project }) => {
    try {
      const target = await projectOrThrow(project);
      const bundle = await api('GET', `/api/projects/${target.id}`);
      const lines = [`项目 ${bundle.project.id} 「${bundle.project.name}」`];
      if (!bundle.versions?.length) {
        lines.push('还没有任何版本。');
        return ok(lines.join('\n'));
      }
      for (const version of bundle.versions) {
        lines.push(`\nv${version.number} ${version.status}${version.operationType ? ` · ${version.operationType}` : ''} (${version.id})`);
        for (const image of version.outputs || []) {
          lines.push(`  ${image.width}×${image.height} ${image.url || ''}`);
        }
        if (!version.outputs?.length) lines.push('  （无输出）');
      }
      return ok(lines.join('\n'));
    } catch (e) { return fail(e); }
  },
);

// ── models ────────────────────────────────────────────────────────────────────
server.registerTool(
  'list_models',
  {
    title: '列出模型',
    description: '列出可用的图片/视觉模型：id、名称、协议、可选尺寸、输出格式、可用 Key 数量。Key 值永远不会返回，只看得到数量。',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = await api('GET', '/api/models');
      if (!data.models.length) return ok('还没有配置模型。请在网页「模型配置」里添加。');
      const lines = data.models.map((m) => {
        const head = `${m.id} 「${m.name}」 ${m.type} · ${m.provider}/${m.imageApiFormat || m.apiFormat || '-'}`;
        const keys = `Key ${m.apiKeyCount ?? (m.apiKeys?.length || 0)} 个`;
        const sizes = m.sizeOptions?.length ? `尺寸 ${m.sizeOptions.join(' ')}` : '';
        const formats = m.outputFormats?.length ? `格式 ${m.outputFormats.join('/')}` : '';
        const active = m.id === data.activeModel ? ' ← 默认' : '';
        return [head, [keys, sizes, formats].filter(Boolean).join(' · ')].join('\n  ') + active;
      });
      return ok(lines.join('\n\n'));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'key_pool_status',
  {
    title: 'API Key 池状态',
    description: '看某个模型的每个 API Key 现在是否可用、冷却剩余时间、成功/失败次数。轮询与退避是否生效、哪个 Key 被限流了，用这个确认。只返回掩码，不返回 Key 值。',
    inputSchema: z.object({ model: z.string().min(1).describe('模型 id（用 list_models 查）') }),
  },
  async ({ model }) => {
    try {
      const data = await api('GET', `/api/models/${encodeURIComponent(model)}/key-pool`);
      if (!data.count) return ok(`模型 ${model} 没有配置 API Key。`);
      const lines = data.keys.map((k) => `#${k.index + 1} ${k.label} ${k.cooling ? `冷却中 ${Math.ceil(k.cooldownMs / 1000)}s` : '可用'} · 成功 ${k.successCount} / 失败 ${k.failureCount}`);
      return ok(`模型 ${model} 共 ${data.count} 个 Key：\n${lines.join('\n')}`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'test_model',
  {
    title: '测试模型连接',
    description: '对某个模型做一次只读连接检查（不生图、不扣费）。返回延迟、使用的 Key 序号和掩码。多 Key 时会自动换用可用的那个。',
    inputSchema: z.object({ model: z.string().min(1).describe('模型 id（用 list_models 查）') }),
  },
  async ({ model }) => {
    try {
      const result = await api('POST', `/api/models/${encodeURIComponent(model)}/test`, null, { timeoutMs: 120_000 });
      const key = result.apiKeyLabel ? ` · Key #${(result.apiKeyIndex ?? 0) + 1} ${result.apiKeyLabel}（共 ${result.apiKeyCount} 个）` : '';
      return ok(`${result.ok ? '连接成功' : '连接失败'} · ${result.latency}ms${key}\n${result.message}`);
    } catch (e) { return fail(e); }
  },
);

// ── generation ────────────────────────────────────────────────────────────────
const SIZE_HELP =
  '尺寸三选一：固定尺寸（如 2048x2048）、比例（1:1、4:3、3:4、3:2、2:3、16:9、9:16、21:9、9:21，服务端按协议像素预算合成画布）、' +
  '或 original（按输入图自己的比例生成，需要 input_image_id）。不传则用模型默认尺寸。';

server.registerTool(
  'generate_image',
  {
    title: '生成图片',
    description:
      '在一个项目里生成图片并等它完成，返回输出图片的尺寸和访问地址。纯文生图只给 prompt；改图再给 input_image_id（该项目的图片 id），' +
      '需要多图参考时再给 reference_image_ids（最多 5 张）。日日新模型可用 watermark / prompt_extend 覆盖模型默认值。' +
      SIZE_HELP +
      ' API Key 由服务端池自动轮询，不需要也不应该传 Key。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      prompt: z.string().min(1).describe('画面描述；改图时描述要做的修改'),
      model: z.string().optional().describe('模型 id，不传用默认模型'),
      size: z.string().optional().describe('固定尺寸 宽x高、比例 token（16:9）、或 original（保持输入图比例）'),
      input_image_id: z.string().optional().describe('作为参考/编辑源的图片 id（项目内）'),
      count: z.number().int().min(1).max(4).optional().describe('生成张数，默认 1'),
      output_format: z.enum(['png', 'jpeg', 'webp']).optional().describe('输出格式，受模型能力限制'),
      transparent_background: z.boolean().optional().describe('要透明背景（仅支持的模型/格式）'),
      watermark: z.boolean().optional().describe('日日新专用：是否要官方水印，默认关；其它协议忽略'),
      prompt_extend: z.boolean().optional().describe('日日新专用：是否让平台自动扩写提示词，默认开；其它协议忽略'),
      reference_image_ids: z.array(z.string().min(1)).max(5).optional()
        .describe('参考图 id（项目内，最多 5 张）：与 input_image_id 一起提交时，主图之外还会把这些图按顺序作为参考图送给模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, prompt, model, size, input_image_id, count, output_format, transparent_background, watermark, prompt_extend, reference_image_ids, timeout_seconds }) => {
    try {
      const target = await projectOrThrow(project);
      const payload = {
        prompt,
        ...(model ? { modelId: model } : {}),
        ...(input_image_id ? { inputImageId: input_image_id } : {}),
        ...(reference_image_ids?.length ? { referenceImageIds: reference_image_ids } : {}),
        params: {
          ...(size ? { size } : {}),
          ...(count ? { count } : {}),
          ...(output_format ? { outputFormat: output_format } : {}),
          // The server reads `params.transparent`; `transparentBackground` is the
          // model-level capability flag and is silently dropped when sent here.
          ...(transparent_background !== undefined ? { transparent: transparent_background } : {}),
          ...(watermark !== undefined ? { watermark } : {}),
          ...(prompt_extend !== undefined ? { promptExtend: prompt_extend } : {}),
        },
      };
      const started = await api('POST', `/api/projects/${target.id}/generate`, payload);
      const { task, done, timedOut } = await waitForTask(target.id, started.taskId, { timeoutMs: (timeout_seconds || 300) * 1000 });
      if (timedOut) {
        return ok(`任务 ${task.id} 还在进行（已等 ${timeout_seconds || 300} 秒）。用 task_status 继续查：project ${target.id} / task ${task.id}`);
      }
      if (!done) return ok(describeFailure(task));
      const bundle = await api('GET', `/api/projects/${target.id}`);
      const version = (bundle.versions || []).find((item) => item.id === task.versionId) || (bundle.versions || [])[0];
      const images = (version?.outputs || []).map((image) => `${image.width}×${image.height} ${BASE}${image.url}`);
      return ok(`完成：任务 ${task.id} · 版本 v${version?.number ?? '?'}\n${images.join('\n') || '（没有输出图片）'}`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'task_status',
  {
    title: '任务状态',
    description: '查一个生成任务的状态（generating / success / failed / cancelled）和错误原因。generate_image 超时或要跟踪长任务时用。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      task: z.string().min(1).describe('任务 id'),
    }),
  },
  async ({ project, task }) => {
    try {
      const target = await projectOrThrow(project);
      const row = await api('GET', `/api/projects/${target.id}/tasks/${task}`);
      const lines = [`任务 ${row.id} ${row.status} · ${row.operationType || '-'}`];
      if (row.error) lines.push(`错误：${row.error}${row.errorCode ? ` [${row.errorCode}]` : ''}`);
      if (row.stage) lines.push(`阶段：${row.stage}`);
      lines.push(`创建 ${row.createdAt}${row.finishedAt ? ` · 完成 ${row.finishedAt}` : ''}`);
      return ok(lines.join('\n'));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'upload_image',
  {
    title: '上传图片',
    description: '把一张本地图片（PNG/JPEG/WebP，≤10MB）上传到项目，作为后续编辑/融合的输入。返回图片 id 和尺寸。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      path: z.string().min(1).describe('本机图片的绝对路径'),
    }),
  },
  async ({ project, path }) => {
    try {
      const target = await projectOrThrow(project);
      const { readFile } = await import('node:fs/promises');
      const bytes = await readFile(path);
      if (bytes.length > 10 * 1024 * 1024) throw new Error('图片超过 10MB 上限');
      const extension = String(path).toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1]?.replace('jpg', 'jpeg');
      if (!extension) throw new Error('只支持 PNG / JPEG / WebP');
      const bundle = await api('POST', `/api/projects/${target.id}/images`, {
        mimeType: `image/${extension}`,
        data: bytes.toString('base64'),
      }, { timeoutMs: 120_000 });
      const images = (bundle.images || []).filter((image) => image.sourceType === 'upload');
      const latest = images[images.length - 1];
      if (!latest) throw new Error('上传后没有找到图片');
      return ok(`已上传：${latest.id} ${latest.width}×${latest.height}\n把它作为 generate_image 的 input_image_id，尺寸可用 original 保持原比例。`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'list_library',
  {
    title: '图片库',
    description: '列出图片库里的图片（独立于项目、按创建时间倒序）。项目里的图片不会出现在这里；图片库的图片只有用 open_library_image 打开时才复制进项目。',
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional().describe('最多返回多少张，默认 50') }),
  },
  async ({ limit = 50 }) => {
    try {
      const data = await api('GET', `/api/library/images?limit=${limit}`);
      const images = data.images || [];
      if (!images.length) return ok('图片库还是空的。用 import_image 导入一张图片，再用 open_library_image 打开成项目。');
      return ok(images.map((image) => `${image.id} ${image.name} ${image.width}×${image.height}${image.projectId ? ` · 已打开为项目 (${image.projectId})` : ' · 尚未打开'} ${BASE}${image.url || ''}`).join('\n'));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'import_image',
  {
    title: '导入图片到图片库',
    description: '把一张本地图片存进图片库（不建项目、不动任何项目）。要开始编辑，再用 open_library_image 打开它。',
    inputSchema: z.object({
      path: z.string().min(1).describe('本机图片的绝对路径（PNG/JPEG/WebP，≤10MB）'),
      name: z.string().optional().describe('图片名，默认取文件名'),
    }),
  },
  async ({ path, name }) => {
    try {
      const { readFile } = await import('node:fs/promises');
      const bytes = await readFile(path);
      if (bytes.length > 10 * 1024 * 1024) throw new Error('图片超过 10MB 上限');
      const extension = String(path).toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1]?.replace('jpg', 'jpeg');
      if (!extension) throw new Error('只支持 PNG / JPEG / WebP');
      const payload = await api('POST', '/api/library/images', {
        data: bytes.toString('base64'),
        mimeType: `image/${extension}`,
        name: name || String(path).split(/[\\/]/).pop(),
      }, { timeoutMs: 120_000 });
      const image = payload.image;
      return ok(`已存入图片库：${image.id}「${image.name}」${image.width}×${image.height}\n用 open_library_image 打开它，才会复制一份进项目并开始编辑。`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'open_library_image',
  {
    title: '打开图片库图片',
    description: '把图片库里的图片打开成项目（第一次会新建项目并复制一份图片进去，之后重复打开回到同一个项目），返回项目与图片 id。',
    inputSchema: z.object({ image: z.string().min(1).describe('图片库图片 id，用 list_library 查') }),
  },
  async ({ image }) => {
    try {
      const bundle = await api('POST', '/api/library/images/open', { id: image }, { timeoutMs: 120_000 });
      const imageId = bundle.importedImageId;
      return ok(`已打开：${imageId}\n项目：「${bundle.project.name}」(${bundle.project.id})，共 ${(bundle.images || []).length} 张图\n把它作为 generate_image 的 input_image_id，尺寸可用 original 保持原比例。`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'delete_library_image',
  {
    title: '删除图片库图片',
    description: '从图片库删除一张图片。已经打开成项目的副本不受影响，项目和图片库互不影响。',
    inputSchema: z.object({ image: z.string().min(1).describe('图片库图片 id') }),
  },
  async ({ image }) => {
    try {
      await api('DELETE', `/api/library/images/${encodeURIComponent(image)}`);
      return ok(`已从图片库删除：${image}。已经打开成项目的副本不受影响。`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'list_images',
  {
    title: '列出项目图片',
    description: '列出一个项目里的图片（id、来源、尺寸、地址），用来挑 input_image_id 做改图。',
    inputSchema: z.object({ project: z.string().min(1).describe('项目 id 或唯一名称') }),
  },
  async ({ project }) => {
    try {
      const target = await projectOrThrow(project);
      const bundle = await api('GET', `/api/projects/${target.id}`);
      const images = bundle.images || [];
      if (!images.length) return ok('这个项目还没有图片。');
      return ok(images.map((image) => `${image.id} ${image.sourceType} ${image.width}×${image.height} ${BASE}${image.url || ''}`).join('\n'));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'size_options',
  {
    title: '可选尺寸与比例',
    description: '列出所有可选尺寸、比例 token 与 original 的含义，以及每个模型声明的固定尺寸。生成前想知道能传什么，用这个。',
    inputSchema: z.object({ model: z.string().optional().describe('只看某个模型声明的尺寸') }),
  },
  async ({ model }) => {
    try {
      const lines = [
        '固定尺寸：模型声明的 sizeOptions（见 list_models），传 宽x高。',
        '比例 token：1:1、4:3、3:4、3:2、2:3、16:9、9:16、21:9、9:21 —— 服务端按该协议的像素预算与步进合成具体画布。',
        'original：按输入图自己的比例生成（需要 input_image_id）。比例会被保留，同时满足平台的像素/边长上限。',
        '不传：用模型的默认尺寸。',
      ];
      if (model) {
        const data = await api('GET', '/api/models');
        const found = data.models.find((item) => item.id === model);
        if (!found) throw new Error(`找不到模型：${model}`);
        lines.push(`\n模型「${found.name}」声明尺寸：${(found.sizeOptions || []).join(' ') || '（无，使用协议默认）'}`);
        lines.push(`输出格式：${(found.outputFormats || []).join('/') || '-'} · 单次最多 ${found.maxCount ?? 1} 张`);
      }
      return ok(lines.join('\n'));
    } catch (e) { return fail(e); }
  },
);


// ── image operation plugins ────────────────────────────────────────────────────
// These wrap the server's built-in plugins (`POST /api/projects/:id/plugins/:id/run`),
// the same entry the browser panel uses, so chat and UI share one behaviour.

/**
 * Run one plugin and wait for its task. Returns the human-readable outcome.
 *
 * `sizeSource` names the picture whose aspect ratio the output should follow.
 * Without it the server falls back to the model's default canvas, which turns a
 * wide photo into a square; the browser never lets that happen because it always
 * sends the nearest declared size.
 */
async function runPlugin(projectRef, pluginId, input, timeoutSeconds, sizeSource = null) {
  const target = await projectOrThrow(projectRef);
  let payload = input;
  if (sizeSource && !input.params?.size) {
    const size = await sizeForEdit(target.id, sizeSource, input.modelId);
    if (size) payload = { ...input, params: { ...(input.params || {}), size } };
  }
  const started = await api('POST', `/api/projects/${target.id}/plugins/${pluginId}/run`, payload);
  const budget = (timeoutSeconds || 300) * 1000;
  const { task, done, timedOut } = await waitForTask(target.id, started.taskId, { timeoutMs: budget });
  if (timedOut) {
    return `任务 ${task?.id} 还在进行（已等 ${timeoutSeconds || 300} 秒）。用 task_status 继续查：project ${target.id} / task ${task?.id}`;
  }
  if (!done) return describeFailure(task);
  const produced = await producedImages(target.id, task.versionId, task);
  const lines = produced.images.map((image) => `${image.width}×${image.height} ${image.url}`);
  return `完成：任务 ${task.id} · 版本 v${produced.version?.number ?? '?'}\n${lines.join('\n') || '（没有输出图片）'}`;
}

/** Read one project image as bytes, for the crop the extract plugin needs. */
async function imageBytes(projectId, imageId) {
  const bundle = await api('GET', `/api/projects/${projectId}`);
  const image = (bundle.images || []).find((item) => item.id === imageId);
  if (!image) throw new Error(`项目里没有这张图片：${imageId}（用 list_images 查看）`);
  const res = await fetch(BASE + image.url, { headers: { Host: LOOPBACK_HOST } });
  if (!res.ok) throw new Error(`读取图片失败：HTTP ${res.status}`);
  return { image, bytes: Buffer.from(await res.arrayBuffer()) };
}

const RECT_HELP = '矩形用图片百分比表示：{x, y, width, height}，取值 0–100，左上角为原点。';

/**
 * Crop a percentage rect out of a picture, mirroring the browser's cropImageRegion.
 *
 * The provider validates input aspect ratio, so a very elongated selection is
 * padded by stretching its edge rows/columns instead of leaving blank bands.
 */
async function cropRegion(bytes, rect) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(bytes).metadata();
  const naturalWidth = meta.width || 0;
  const naturalHeight = meta.height || 0;
  if (!naturalWidth || !naturalHeight) throw new Error('无法读取原图尺寸');
  const left = Math.min(naturalWidth - 1, Math.max(0, Math.round((rect.x / 100) * naturalWidth)));
  const top = Math.min(naturalHeight - 1, Math.max(0, Math.round((rect.y / 100) * naturalHeight)));
  const width = Math.max(1, Math.min(naturalWidth - left, Math.round((rect.width / 100) * naturalWidth)));
  const height = Math.max(1, Math.min(naturalHeight - top, Math.round((rect.height / 100) * naturalHeight)));
  let paddedWidth = width;
  let paddedHeight = height;
  if (width / height > 2) paddedHeight = Math.ceil(width / 2);
  else if (height / width > 2) paddedWidth = Math.ceil(height / 2);
  const padLeft = Math.floor((paddedWidth - width) / 2);
  const padTop = Math.floor((paddedHeight - height) / 2);
  const padded = paddedWidth !== width || paddedHeight !== height;
  let scale = Math.min(1, 2048 / Math.max(paddedWidth, paddedHeight));
  if (Math.min(paddedWidth, paddedHeight) * scale < 256) scale = 256 / Math.min(paddedWidth, paddedHeight);
  const outWidth = Math.max(256, Math.round(paddedWidth * scale));
  const outHeight = Math.max(256, Math.round(paddedHeight * scale));
  let pipeline = sharp(bytes).extract({ left, top, width, height });
  if (padded) {
    pipeline = pipeline.extend({
      top: padTop,
      bottom: paddedHeight - padTop - height,
      left: padLeft,
      right: paddedWidth - padLeft - width,
      extendWith: 'copy',
    });
  }
  const out = await pipeline.resize(outWidth, outHeight, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  return { bytes: out, width: outWidth, height: outHeight, padded };
}

/**
 * Closest declared size to an aspect ratio, mirroring the browser dropdown.
 *
 * Plugins inherit `model.defaultParams.size` when `params.size` is absent, and that
 * default is a fixed canvas — editing a 16:9 picture would silently come back
 * square. The UI always sends the size nearest the source ratio, so do the same.
 */
function closestDeclaredSize(sizeOptions, width, height) {
  const candidates = (sizeOptions || [])
    .map((value) => String(value).match(/^(\d{2,4})x(\d{2,4})$/))
    .filter(Boolean)
    .map((match) => ({ value: `${match[1]}x${match[2]}`, ratio: Number(match[1]) / Number(match[2]) }));
  if (!candidates.length || !(width > 0 && height > 0)) return null;
  const target = Math.log(width / height);
  let best = candidates[0];
  let bestDelta = Infinity;
  for (const candidate of candidates) {
    const delta = Math.abs(Math.log(candidate.ratio) - target);
    if (delta < bestDelta) { best = candidate; bestDelta = delta; }
  }
  return best.value;
}

/**
 * Resolve the size to request for an edit, from an image id or explicit dimensions.
 * Returns null when nothing better than the model default is known.
 */
async function sizeForEdit(projectId, source, modelId) {
  const config = await api('GET', '/api/models');
  const model = (config.models || []).find((item) => item.id === (modelId || config.activeModel));
  if (!model) return null;
  let width = Number(source.width) || 0;
  let height = Number(source.height) || 0;
  if ((!width || !height) && source.imageId) {
    const bundle = await api('GET', `/api/projects/${projectId}`);
    const image = (bundle.images || []).find((item) => item.id === source.imageId);
    width = Number(image?.width) || 0;
    height = Number(image?.height) || 0;
  }
  return closestDeclaredSize(model.sizeOptions, width, height);
}

server.registerTool(
  'list_plugins',
  {
    title: '图片操作能力',
    description: '列出服务端内置的图片操作插件（扩图、增强、去水印、去元素、改字、局部改、融合、提取主体、去背景），以及每个插件对模型能力的要求。',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = await api('GET', '/api/plugins');
      const lines = (data.plugins || []).map((plugin) => {
        const need = [...plugin.requirements.image, ...(plugin.requirements.vision ? ['视觉模型'] : [])];
        return `${plugin.id} · ${plugin.operation} · 需要：${need.join(' + ')}`;
      });
      if (data.errors?.length) lines.push(`\n加载失败的插件：${data.errors.join('; ')}`);
      return ok(lines.join('\n'));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'outpaint_image',
  {
    title: '扩图',
    description: '把一张图片的画布扩展到目标尺寸，原内容完整保留，只在新增区域自然延展背景。最适合对话：只需要目标尺寸。' +
      ' 目标尺寸传 宽x高（如 2048x2048），宽高都要在 256–4096 之间；比例变化会自动决定向左右、上下或四周扩展。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要扩图的图片 id（项目内）'),
      size: z.string().regex(/^\d{2,4}x\d{2,4}$/).describe('目标尺寸，如 2048x2048'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, size, model, timeout_seconds }) => {
    try {
      return ok(await runPlugin(project, 'layerive.outpaint', {
        imageId: image_id, size, ...(model ? { modelId: model } : {}),
      }, timeout_seconds));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'enhance_image',
  {
    title: '高清增强',
    description: '提升一张图片的清晰度、纹理与细节，同时严格保持主体、文字、构图、比例、颜色和风格不变。无需任何参数。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要增强的图片 id（项目内）'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, model, timeout_seconds }) => {
    try {
      return ok(await runPlugin(project, 'layerive.enhance', {
        imageId: image_id, ...(model ? { modelId: model } : {}),
      }, timeout_seconds, { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'remove_watermark',
  {
    title: '去水印',
    description: '自动识别并移除图片上的覆盖式水印，自然补全被遮挡的背景。无需参数；视觉模型会先判断有没有水印，没有水印时会直接告诉你。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要处理的图片 id（项目内）'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, model, vision_model, timeout_seconds }) => {
    try {
      return ok(await runPlugin(project, 'layerive.remove-watermark', {
        imageId: image_id,
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      }, timeout_seconds, { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'remove_background',
  {
    title: '抠图 / 去背景',
    description: '把主体从背景里抠出来，输出带真实透明通道的 PNG。' +
      'strategy 默认 auto：先在服务器本地用分割模型抠（快、免费、不消耗生图额度），' +
      '结果不合格再退回图片模型重画；local 只用本地抠图（失败直接报错，不花额度）；ai 只用图片模型。' +
      '给 rect 可以只抠框里的那一个主体（图片里有多个主体时用）。本地抠图保持原图尺寸与主体位置。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要抠图的图片 id（项目内）'),
      strategy: z.enum(['auto', 'local', 'ai']).optional().describe('抠图策略，默认 auto'),
      rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional()
        .describe('只抠这个百分比矩形里的主体（本地抠图用）'),
      feather: z.number().min(0).max(50).optional().describe('边缘羽化像素，仅本地抠图'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型（仅 ai 策略需要）'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型（仅 ai 策略需要）'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, strategy, rect, feather, model, vision_model, timeout_seconds }) => {
    try {
      return ok(await runPlugin(project, 'layerive.remove-background', {
        imageId: image_id,
        ...(strategy ? { strategy } : {}),
        ...(rect ? { rect } : {}),
        ...(feather ? { feather } : {}),
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      // A local matte keeps the original size; the model path needs the source ratio.
      }, timeout_seconds, strategy === 'local' ? null : { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'remove_element',
  {
    title: '删除画面元素',
    description: '删除图片里的元素并自然补全背景。mode 决定删除范围：' +
      'people 去路人、clutter 清理杂物、text 清除文字、room 清理房间杂物（这四种都是全图自动，不需要坐标）；' +
      'selection 只删除你圈选的元素（必须给 rect）。' + RECT_HELP,
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要处理的图片 id（项目内）'),
      mode: z.enum(['selection', 'people', 'clutter', 'text', 'room']).optional().describe('删除模式，默认 selection'),
      rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional()
        .describe('仅 selection 模式需要：要删除元素所在的百分比矩形'),
      instruction: z.string().max(1000).optional().describe('补充说明，如「只删左边那个人」'),
      keep_points: z.array(z.object({ x: z.number(), y: z.number() })).max(20).optional()
        .describe('仅 people 模式：必须保留的人物位置（百分比坐标）'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, mode, rect, instruction, keep_points, model, vision_model, timeout_seconds }) => {
    try {
      if ((mode || 'selection') === 'selection' && !rect) throw new Error('selection 模式需要 rect：' + RECT_HELP);
      return ok(await runPlugin(project, 'layerive.remove-element', {
        imageId: image_id,
        mode: mode || 'selection',
        ...(rect ? { rect } : {}),
        ...(instruction ? { instruction } : {}),
        ...(keep_points?.length ? { keepPoints: keep_points } : {}),
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      }, timeout_seconds, { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'edit_text',
  {
    title: '改图片里的文字',
    description: '替换、删除或新增图片中的文字，其余画面保持不变。两种用法：' +
      '① 先用 recognize_text 拿到分段，再把要改的段落按 {original_text, text} 传进来（text 留空表示删除）；' +
      '② 手动给 rect + text + manual:true，在指定区域新增或替换文字。' + RECT_HELP,
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要改字的图片 id（项目内）'),
      segments: z.array(z.object({
        original_text: z.string().optional().describe('原文（从 recognize_text 拿）；新增文字时留空'),
        text: z.string().optional().describe('改成的文字；留空表示删除这段'),
        context: z.string().optional().describe('这段文字的位置/样式描述，来自 recognize_text'),
        manual: z.boolean().optional().describe('手动画框新增时设为 true'),
        rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional()
          .describe('该段文字的百分比矩形'),
      })).min(1).describe('要修改的文字段落'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, segments, model, vision_model, timeout_seconds }) => {
    try {
      const payload = segments.map((item) => ({
        originalText: item.original_text || '',
        text: item.text || '',
        context: item.context || '',
        manual: Boolean(item.manual),
        ...(item.rect ? { rect: item.rect } : {}),
      }));
      return ok(await runPlugin(project, 'layerive.edit-text', {
        imageId: image_id, segments: payload,
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      }, timeout_seconds, { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'recognize_text',
  {
    title: '识别图片文字',
    description: '用视觉模型识别图片里的所有可编辑文字并分段，返回每段的原文、位置描述和矩形。改字前先跑这个，把结果喂给 edit_text。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('图片 id（项目内）'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
    }),
  },
  async ({ project, image_id, vision_model }) => {
    try {
      const target = await projectOrThrow(project);
      const data = await api('POST', `/api/projects/${target.id}/recognize-text`, {
        imageId: image_id, ...(vision_model ? { visionModelId: vision_model } : {}),
      }, { timeoutMs: 240_000 });
      const segments = data.segments || [];
      if (!segments.length) return ok(`没有识别到文字（模型：${data.modelName || '-'}）。`);
      const lines = segments.map((segment, index) => {
        const rect = segment.rect
          ? ` · 区域 x=${segment.rect.x.toFixed(1)}% y=${segment.rect.y.toFixed(1)}% 宽=${segment.rect.width.toFixed(1)}% 高=${segment.rect.height.toFixed(1)}%`
          : '';
        return `${index + 1}. ${segment.text}\n   位置：${segment.context || '-'}${rect}`;
      });
      return ok(`模型：${data.modelName || '-'}${data.cached ? '（缓存）' : ''}，共 ${segments.length} 段：\n${lines.join('\n')}`);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'local_edit',
  {
    title: '局部修改',
    description: '只改图片里圈出的那一块，框外完全不动。给 instruction 描述要改成什么，rect 圈出区域。' + RECT_HELP +
      ' 也可以给 reference_path 用一张参考图替换选区内容。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要修改的图片 id（项目内）'),
      instruction: z.string().min(1).describe('这一块要改成什么'),
      rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .describe('要修改的百分比矩形'),
      reference_path: z.string().optional().describe('可选：本机参考图绝对路径，用来替换选区内容'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, instruction, rect, reference_path, model, vision_model, timeout_seconds }) => {
    try {
      let reference;
      if (reference_path) {
        const { readFile } = await import('node:fs/promises');
        const bytes = await readFile(reference_path);
        if (bytes.length > 10 * 1024 * 1024) throw new Error('参考图超过 10MB 上限');
        const extension = String(reference_path).toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1]?.replace('jpg', 'jpeg');
        if (!extension) throw new Error('参考图只支持 PNG / JPEG / WebP');
        reference = { data: `data:image/${extension};base64,${bytes.toString('base64')}`, mimeType: `image/${extension}` };
      }
      return ok(await runPlugin(project, 'layerive.local-edit', {
        imageId: image_id, instruction, rect,
        ...(reference ? { reference } : {}),
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      }, timeout_seconds, { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'fusion_image',
  {
    title: '融合参考图',
    description: '把一张参考图（衣服、姿势、人物、产品）融合进主图的指定位置。' +
      'mode：basic 通用融合、outfit 换装、pose 换姿势、group 多人合影。point 是参考图在主图上的落点（百分比 0–100）。' +
      ' 参考图可以是项目里已有的图片 id，也可以给本机路径自动上传。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('主图 id（项目内）'),
      reference_image_id: z.string().optional().describe('参考图 id（项目内已有图片）'),
      reference_path: z.string().optional().describe('或者：本机参考图绝对路径，会自动上传进项目'),
      mode: z.enum(['basic', 'outfit', 'pose', 'group']).optional().describe('融合方式，默认 basic'),
      point: z.object({ x: z.number(), y: z.number() }).optional()
        .describe('参考图在主图上的落点（百分比 0–100），默认画面中心 {x:50,y:50}'),
      instruction: z.string().optional().describe('补充说明'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, reference_image_id, reference_path, mode, point, instruction, model, vision_model, timeout_seconds }) => {
    try {
      const target = await projectOrThrow(project);
      let referenceId = reference_image_id;
      if (!referenceId && reference_path) {
        const { readFile } = await import('node:fs/promises');
        const bytes = await readFile(reference_path);
        if (bytes.length > 10 * 1024 * 1024) throw new Error('参考图超过 10MB 上限');
        const extension = String(reference_path).toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1]?.replace('jpg', 'jpeg');
        if (!extension) throw new Error('参考图只支持 PNG / JPEG / WebP');
        const bundle = await api('POST', `/api/projects/${target.id}/images`, {
          mimeType: `image/${extension}`,
          data: bytes.toString('base64'),
          referenceOnly: true,
        }, { timeoutMs: 120_000 });
        const uploaded = (bundle.images || []).filter((item) => item.sourceType === 'fusion_reference');
        referenceId = uploaded[uploaded.length - 1]?.id;
        if (!referenceId) throw new Error('参考图上传后没有找到');
      }
      if (!referenceId) throw new Error('需要 reference_image_id 或 reference_path 之一');
      return ok(await runPlugin(project, 'layerive.fusion', {
        imageId: image_id,
        referenceImageId: referenceId,
        mode: mode || 'basic',
        point: point || { x: 50, y: 50 },
        ...(instruction ? { instruction } : {}),
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      }, timeout_seconds, { imageId: image_id }));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'extract_asset',
  {
    title: '提取主体素材',
    description: '把图片里框选的服装、配件、图案或背景单独提取成一张干净素材图（去掉原背景和周围元素）。' +
      'mode：selection 通用、clothing 服装、accessory 配件、pattern 图案、background 背景。' + RECT_HELP +
      ' 截图由服务端按 rect 自动裁剪，不需要你自己准备。',
    inputSchema: z.object({
      project: z.string().min(1).describe('项目 id 或唯一名称'),
      image_id: z.string().min(1).describe('要提取的图片 id（项目内）'),
      rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .describe('要提取内容的百分比矩形，宽高至少 2%'),
      mode: z.enum(['selection', 'clothing', 'accessory', 'pattern', 'background']).optional().describe('提取场景，默认 selection'),
      hint: z.string().max(1000).optional().describe('补充说明，如「只要那双鞋」'),
      model: z.string().optional().describe('图片模型 id，不传用默认模型'),
      vision_model: z.string().optional().describe('视觉模型 id，不传用默认视觉模型'),
      timeout_seconds: z.number().int().min(10).max(1800).optional().describe('等待完成的秒数，默认 300'),
    }),
  },
  async ({ project, image_id, rect, mode, hint, model, vision_model, timeout_seconds }) => {
    try {
      if (rect.width < 2 || rect.height < 2) throw new Error('框选区域太小：宽高至少要 2%');
      const target = await projectOrThrow(project);
      const { bytes } = await imageBytes(target.id, image_id);
      const crop = await cropRegion(bytes, rect);
      return ok(await runPlugin(project, 'layerive.extract-asset', {
        imageId: image_id,
        rect,
        crop: { data: `data:image/png;base64,${crop.bytes.toString('base64')}`, mimeType: 'image/png', padded: crop.padded },
        mode: mode || 'selection',
        ...(hint ? { hint } : {}),
        ...(model ? { modelId: model } : {}),
        ...(vision_model ? { visionModelId: vision_model } : {}),
      }, timeout_seconds, { width: crop.width, height: crop.height }));
    } catch (e) { return fail(e); }
  },
);

await server.connect(new StdioServerTransport());

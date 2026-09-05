import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_ROOT, db, closeDatabase, ensureProjectDirs, GALLERY_ROOT, imageDto, now, parseJson, PROJECTS_ROOT, projectDto, uid } from './db.mjs';
import { makeDemoPng, makeThumbnailPng, readImageDimensions } from './png.mjs';
import { normalizeBaseUrl, publicModel, readModels, removeModel, upsertModel, writeModels } from './models.mjs';
import { createZip, readZip } from './zip.mjs';

const PORT = Number(process.env.PIXELFLOW_API_PORT || 8788);
const HOST = '127.0.0.1';
const DIST_ROOT = path.join(APP_ROOT, 'dist');
const MODELS_CONFIG_PATH = path.join(APP_ROOT, 'config', 'models.json');

// Tasks still marked `generating` when the server starts can never finish —
// the request died with the previous process. Mark them instead of leaving
// the workspace stuck on a phantom progress state.
db.prepare("UPDATE generation_tasks SET status = 'failed', error_json = ?, finished_at = ? WHERE status = 'generating'")
  .run(JSON.stringify({ message: '应用重启，任务已中断，请重新发送。' }), now());

const runningTasks = new Map();
const canceledTasks = new Set();

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function zipResponse(res, buffer, downloadName) {
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${downloadName}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buffer);
}

async function body(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求内容超过大小限制'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求格式不是有效 JSON'), { status: 400 }); }
}

function projectOrThrow(projectId) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId);
  if (!row) throw Object.assign(new Error('项目不存在'), { status: 404 });
  return row;
}

function listProjects() {
  const rows = db.prepare(`
    SELECT p.*, i.file_path AS cover_file_path, i.width AS cover_width, i.height AS cover_height,
      (SELECT COUNT(*) FROM image_versions v WHERE v.project_id = p.id AND v.deleted_at IS NULL) AS version_count
    FROM projects p
    LEFT JOIN images i ON i.id = p.cover_image_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.updated_at DESC
  `).all();
  return rows.map(projectDto);
}

function bundle(projectId) {
  const projectRow = db.prepare(`
    SELECT p.*, i.file_path AS cover_file_path, i.width AS cover_width, i.height AS cover_height,
      (SELECT COUNT(*) FROM image_versions v WHERE v.project_id = p.id AND v.deleted_at IS NULL) AS version_count
    FROM projects p LEFT JOIN images i ON i.id = p.cover_image_id
    WHERE p.id = ? AND p.deleted_at IS NULL
  `).get(projectId);
  if (!projectRow) throw Object.assign(new Error('项目不存在'), { status: 404 });
  // Images inherit the visibility of their version. Keep unversioned uploads,
  // but never expose output/input images belonging to a soft-deleted version.
  const images = db.prepare(`
    SELECT i.* FROM images i
    LEFT JOIN image_versions v ON v.id = i.version_id
    WHERE i.project_id = ?
      AND (i.version_id IS NULL OR v.id IS NULL OR v.deleted_at IS NULL)
    ORDER BY i.created_at
  `).all(projectId).map(imageDto);
  const imageMap = new Map(images.map((image) => [image.id, image]));
  const messages = db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at').all(projectId).map((row) => ({
    id: row.id, role: row.role, type: row.message_type, content: parseJson(row.content_json), createdAt: row.created_at,
  }));
  const versions = db.prepare('SELECT * FROM image_versions WHERE project_id = ? AND deleted_at IS NULL ORDER BY version_number DESC').all(projectId).map((row) => {
    const outputs = images.filter((image) => image.versionId === row.id);
    const inputRows = db.prepare('SELECT image_id FROM version_inputs WHERE version_id = ?').all(row.id);
    return {
      id: row.id,
      number: row.version_number,
      operation: row.operation_type,
      parentVersionId: row.parent_version_id,
      selectedImageId: row.selected_image_id,
      status: row.status,
      outputs,
      inputs: inputRows.map((input) => imageMap.get(input.image_id)).filter(Boolean),
      createdAt: row.created_at,
    };
  });
  return { project: projectDto(projectRow), messages, versions, images };
}

// SenseNova official 2K sizes are offered in the workspace picker; the picker
// defaults to 2048x2048. Legacy projects may still carry older arbitrary sizes
// in their drafts, so keep accepting any well-formed WxH here and let the
// model provider validate the exact set it supports.
function parseSize(size) {
  const match = String(size || '2048x2048').match(/^(\d{2,4})x(\d{2,4})$/);
  const width = Math.min(4096, Math.max(256, Number(match?.[1] || 2048)));
  const height = Math.min(4096, Math.max(256, Number(match?.[2] || 2048)));
  return { width, height };
}

function normalizeImageQuality(value) {
  const quality = String(value || '').trim().toLowerCase();
  // Older configurations used `standard`; GPT Image 2-compatible services
  // accept only the four values below, where `auto` is the matching default.
  if (quality === 'standard' || !quality) return 'auto';
  return ['auto', 'low', 'medium', 'high'].includes(quality) ? quality : 'auto';
}

// Model platforms answer with terse English strings; map the common ones to
// actionable Chinese text instead of surfacing them raw in the workspace.
function friendlyModelMessage(raw) {
  const message = String(raw || '');
  if (/sensitive/i.test(message)) return '模型平台安全审核未通过（sensitive image）：请更换输入图片或调整提示词后重试。含有中国地图、省份分布、人物肖像等元素的画面更容易被拦截。';
  if (/rps exhausted|rate.?limit/i.test(message)) return '模型平台请求频率超限，请等待几秒后重试。';
  if (/image should be/i.test(message)) return '输入图片不符合平台要求：支持 PNG/JPEG/WebP，大小不超过 10MB，宽高需在 256–4096px 之间，且宽高比不超过 2:1。请裁剪或缩小后重试。';
  if (/quota|insufficient/i.test(message)) return '模型平台额度不足或配额已用完，请检查账户余额。';
  return message;
}

async function callOpenAi(model, prompt, params, inputImage, signal) {
  const count = Math.min(4, Math.max(1, Number(params.count || 1)));
  const size = params.size || '1024x1024';
  const endpoint = inputImage ? 'images/edits' : 'images/generations';
  const headers = { Authorization: `Bearer ${model.apiKey}` };
  let requestBody;
  const isSenseNova = model.provider === 'sensenova' || /(?:^|[/.])sensenova\.cn(?:[/:]|$)/i.test(normalizeBaseUrl(model.baseUrl));
  // OpenAI-only knobs: output format (png/jpeg/webp) and transparent background.
  // Transparent backgrounds require a lossless format, so jpeg forces opaque.
  const outputFormat = ['png', 'jpeg', 'webp'].includes(String(params.outputFormat)) ? String(params.outputFormat) : 'png';
  const background = params.transparent && outputFormat !== 'jpeg' ? 'transparent' : 'opaque';
  if (inputImage && isSenseNova) {
    const absolute = path.join(PROJECTS_ROOT, inputImage.project_id, inputImage.file_path);
    const encoded = (await readFile(absolute)).toString('base64');
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify({ model: model.model, prompt, n: 1, size, images: [{ image_url: `data:${inputImage.mime_type};base64,${encoded}` }], response_format: 'b64_json', output_format: 'png', prompt_extend: true, watermark: false });
  } else if (inputImage) {
    const absolute = path.join(PROJECTS_ROOT, inputImage.project_id, inputImage.file_path);
    const form = new FormData();
    form.append('model', model.model);
    form.append('prompt', prompt);
    form.append('n', String(count));
    form.append('size', size);
    form.append('image', new Blob([await readFile(absolute)], { type: inputImage.mime_type }), path.basename(inputImage.file_path));
    form.append('output_format', outputFormat);
    form.append('background', background);
    requestBody = form;
  } else if (isSenseNova) {
    headers['Content-Type'] = 'application/json';
    // SenseNova exposes no-watermark output explicitly. It also supports one
    // image per request for this model, regardless of the workspace count.
    requestBody = JSON.stringify({ model: model.model, prompt, n: 1, size, watermark: false, response_format: 'b64_json', output_format: 'png', prompt_extend: true });
  } else {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify({ model: model.model, prompt, n: count, size, quality: normalizeImageQuality(params.quality), response_format: 'b64_json', output_format: outputFormat, background });
  }
  const response = await fetch(`${model.baseUrl}/${endpoint}`, { method: 'POST', headers, body: requestBody, signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `模型请求失败（${response.status}）`);
  const outputs = [];
  const outputMime = outputFormat === 'jpeg' ? 'image/jpeg' : outputFormat === 'webp' ? 'image/webp' : 'image/png';
  for (const item of payload.data || []) {
    if (item.b64_json) outputs.push({ bytes: Buffer.from(item.b64_json, 'base64'), mimeType: isSenseNova ? 'image/png' : outputMime });
    else if (item.url) {
      const remote = await fetch(item.url, { signal });
      if (!remote.ok) throw new Error('模型已返回图片地址，但图片下载失败');
      outputs.push({ bytes: Buffer.from(await remote.arrayBuffer()), mimeType: remote.headers.get('content-type') || 'image/png' });
    }
  }
  if (!outputs.length) throw new Error('模型没有返回图片');
  return outputs;
}

function aspectRatioForSize(size) {
  const { width, height } = parseSize(size);
  const gcd = (left, right) => right ? gcd(right, left % right) : left;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function outputMimeType(outputFormat) {
  return outputFormat === 'jpeg' ? 'image/jpeg' : outputFormat === 'webp' ? 'image/webp' : 'image/png';
}

async function callGemini(model, prompt, params, inputImage, signal) {
  const outputFormat = ['png', 'jpeg'].includes(String(params.outputFormat)) ? String(params.outputFormat) : 'png';
  const input = inputImage
    ? [{ type: 'text', text: prompt }, { type: 'image', mime_type: inputImage.mime_type, data: (await readFile(path.join(PROJECTS_ROOT, inputImage.project_id, inputImage.file_path))).toString('base64') }]
    : prompt;
  const response = await fetch(`${normalizeBaseUrl(model.baseUrl)}/interactions`, {
    method: 'POST',
    headers: { 'x-goog-api-key': model.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.model,
      input,
      // Nano Banana creates one native image per interaction. The workbench
      // maps its existing size picker to the provider's aspect-ratio field.
      response_format: { type: 'image', mime_type: outputMimeType(outputFormat), aspect_ratio: aspectRatioForSize(params.size) },
    }),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini 图片请求失败（${response.status}）`);
  const imageBlocks = [payload.output_image, ...(Array.isArray(payload.output_images) ? payload.output_images : []), ...(Array.isArray(payload.steps) ? payload.steps.flatMap((step) => Array.isArray(step.content) ? step.content.filter((item) => item?.type === 'image') : []) : [])].filter(Boolean);
  const outputs = imageBlocks.map((item) => item?.data ? ({ bytes: Buffer.from(item.data, 'base64'), mimeType: item.mime_type || item.mimeType || outputMimeType(outputFormat) }) : null).filter(Boolean);
  if (!outputs.length) throw new Error('Gemini 没有返回图片，请确认所选模型支持 Nano Banana 图片生成');
  return outputs;
}

async function callGrok(model, prompt, params, inputImage, signal) {
  const count = Math.min(4, Math.max(1, Number(params.count || 1)));
  const body = {
    model: model.model,
    prompt,
    n: count,
    aspect_ratio: aspectRatioForSize(params.size),
    response_format: 'b64_json',
  };
  // xAI currently accepts low/medium quality for grok-imagine-image-2.0.
  // "auto" and "high" deliberately omit this optional field.
  if (['low', 'medium'].includes(String(params.quality))) body.quality = String(params.quality);
  const endpoint = inputImage ? 'images/edits' : 'images/generations';
  if (inputImage) {
    const encoded = (await readFile(path.join(PROJECTS_ROOT, inputImage.project_id, inputImage.file_path))).toString('base64');
    body.image = { url: `data:${inputImage.mime_type};base64,${encoded}`, type: 'image_url' };
  }
  const response = await fetch(`${normalizeBaseUrl(model.baseUrl)}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Grok 图片请求失败（${response.status}）`);
  const outputs = [];
  for (const item of payload.data || []) {
    if (item.b64_json) outputs.push({ bytes: Buffer.from(item.b64_json, 'base64'), mimeType: item.mime_type || 'image/jpeg' });
    else if (item.url) {
      const remote = await fetch(item.url, { signal });
      if (!remote.ok) throw new Error('Grok 已返回图片地址，但图片下载失败');
      outputs.push({ bytes: Buffer.from(await remote.arrayBuffer()), mimeType: remote.headers.get('content-type') || 'image/jpeg' });
    }
  }
  if (!outputs.length) throw new Error('Grok 没有返回图片');
  return outputs;
}

function parseVisionJson(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(source); }
  catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('视觉识别模型没有返回可解析的结构化结果');
    return JSON.parse(match[0]);
  }
}

function textSegments(value) {
  const parsed = parseVisionJson(value);
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.segments) ? parsed.segments : [];
  const segments = entries.map((item, index) => {
    const text = String(item.text || item.content || '').trim();
    return { id: String(item.id || `text-${index + 1}`), text, originalText: text, context: String(item.context || item.location || '图片中的文字区域').trim() };
  }).filter((item) => item.text);
  if (!segments.length) throw new Error('未识别到可编辑文字，请确认图片内含有清晰文字');
  return segments;
}

async function callVision(model, image, instruction) {
  if (!model?.apiKey) throw Object.assign(new Error('请先在模型配置中填写视觉识别模型的 API Key'), { status: 400 });
  // image 通常来自数据库行（按 file_path 读盘）；gallery 分析直接携带 buffer。
  const encoded = image.buffer
    ? Buffer.from(image.buffer).toString('base64')
    : (await readFile(path.join(PROJECTS_ROOT, image.project_id, image.file_path))).toString('base64');
  const dataUrl = `data:${image.mime_type};base64,${encoded}`;
  const host = new URL(normalizeBaseUrl(model.baseUrl)).hostname;
  const isDots = /(?:^|\.)askdiandian\.com$/i.test(host);
  const headers = isDots ? { 'api-key': model.apiKey, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' };
  const isSenseNova = model.provider === 'sensenova';
  const endpoint = isDots ? `${model.baseUrl}/messages` : isSenseNova ? `${model.baseUrl}/llm/chat-completions` : `${model.baseUrl}/chat/completions`;
  const requestBody = isDots
    ? {
      model: model.model,
      system: '你是严谨的图像文字识别与编辑规划助手。必须只返回用户要求的 JSON，不要使用 Markdown。',
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: image.mime_type, data: encoded } }, { type: 'text', text: instruction }] }],
      max_tokens: 900,
      stream: false,
      thinking: { type: 'disabled' },
    }
    : isSenseNova
    ? { model: model.model, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: dataUrl }, { type: 'text', text: instruction }] }], max_new_tokens: 1600, temperature: 0.1, stream: false }
    : { model: model.model, messages: [{ role: 'system', content: '你是严谨的图像文字识别与编辑规划助手。必须只返回用户要求的 JSON，不要使用 Markdown。' }, { role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: dataUrl } }] }], response_format: { type: 'json_object' }, temperature: 0.1 };
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(120000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `视觉识别请求失败（${response.status}）`);
  const message = payload?.content ?? payload?.data?.choices?.[0]?.message ?? payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.message;
  const content = Array.isArray(message) ? message.map((item) => item.text || item.content || '').join('') : message?.content || message;
  if (!content) throw new Error('视觉识别模型没有返回内容');
  return content;
}

function visionModelOrThrow(config) {
  const model = config.models.find((item) => item.id === config.active_vision_model && item.type === 'vision') || config.models.find((item) => item.type === 'vision');
  if (!model) throw Object.assign(new Error('请先在模型配置中添加并配置一个视觉识别模型'), { status: 400 });
  return model;
}

function imageOrThrow(projectId, imageId) {
  if (!imageId) throw Object.assign(new Error('请先选择一张图片'), { status: 400 });
  const image = db.prepare(`
    SELECT i.* FROM images i
    LEFT JOIN image_versions v ON v.id = i.version_id
    WHERE i.id = ? AND i.project_id = ?
      AND (i.version_id IS NULL OR v.id IS NULL OR v.deleted_at IS NULL)
  `).get(imageId, projectId);
  if (!image) throw Object.assign(new Error('图片不存在或不属于当前项目'), { status: 404 });
  return image;
}

// Uploaded source images are stored without a version. Before one is edited
// for the first time, give it an initial `upload` version so the original
// picture shows up in the history and later edits can hang under it.
function ensureUploadVersion(projectId, image) {
  if (!image || image.version_id || image.source_type !== 'upload') return image;
  const existing = db.prepare('SELECT version_id FROM images WHERE id = ?').get(image.id);
  if (existing?.version_id) return { ...image, version_id: existing.version_id };
  const versionId = uid();
  const versionNumber = Number(db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM image_versions WHERE project_id = ?').get(projectId).next);
  db.prepare(`INSERT INTO image_versions (id, project_id, task_id, parent_version_id, version_number, operation_type, selected_image_id, status, created_at)
    VALUES (?, ?, NULL, NULL, ?, 'upload', ?, 'success', ?)`)
    .run(versionId, projectId, versionNumber, image.id, image.created_at || now());
  db.prepare('UPDATE images SET version_id = ? WHERE id = ?').run(versionId, image.id);
  return { ...image, version_id: versionId };
}

async function recognizeImageText(projectId, input) {
  projectOrThrow(projectId);
  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  const image = imageOrThrow(projectId, input.imageId);
  const result = await callVision(visionModel, image, '识别图片内所有可编辑的可见文字，并按视觉区域分段。返回严格 JSON：{"segments":[{"id":"text-1","text":"原始文字","context":"文字所在位置、字号、颜色、排版和附近视觉元素的简短描述"}]}。不要遗漏文字；不要翻译、改写或解释；不要返回 Markdown。');
  return { modelName: visionModel.name, segments: textSegments(result) };
}

async function editImageText(projectId, input) {
  projectOrThrow(projectId);
  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  const image = imageOrThrow(projectId, input.imageId);
  // Manual boxes have no recognized original text; they describe an addition
  // or a replacement at a hand-drawn region, so accept them without one.
  const changed = (Array.isArray(input.segments) ? input.segments : []).map((item) => {
    const rawRect = item.rect;
    const rect = rawRect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rawRect[key])))
      ? Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.min(100, Math.max(0, Number(rawRect[key])))]))
      : null;
    return { originalText: String(item.originalText || '').trim(), text: String(item.text || '').trim(), context: String(item.context || '').trim(), manual: Boolean(item.manual), rect };
  }).filter((item) => item.text && item.originalText !== item.text && (item.originalText || item.manual));
  if (!changed.length) throw Object.assign(new Error('请先修改至少一段文字或框选一个区域再提交'), { status: 400 });
  const rectDescription = (rect) => rect
    ? `框选区域为整张图片的 x=${rect.x.toFixed(1)}%、y=${rect.y.toFixed(1)}%、宽=${rect.width.toFixed(1)}%、高=${rect.height.toFixed(1)}%`
    : '';
  const changeList = changed.map((item, index) => item.originalText
    ? `${index + 1}. 将“${item.originalText}”替换为“${item.text}”（位置与样式：${[item.context || '保持原区域', rectDescription(item.rect)].filter(Boolean).join('；')}）`
    : `${index + 1}. 在 ${[item.context || '指定区域', rectDescription(item.rect)].filter(Boolean).join('；')} 添加文字“${item.text}”，样式与周围内容协调`)
    .join('\n');
  const planning = await callVision(visionModel, image, `根据图片内容和下面的文字替换项，为图片编辑模型生成一条准确中文提示词。只允许修改列出的文字，必须保留其他文字以及人物、背景、构图、配色、风格、尺寸和物体不变；新文字需要保持原位置、层级、字体风格、字号和颜色，除非替换文本长度导致微小的排版调整。若替换项给出框选区域，必须在 edit_prompt 中保留该精确区域约束，禁止改动框外内容。返回严格 JSON：{"edit_prompt":"..."}。\n替换项：\n${changeList}`);
  const planned = parseVisionJson(planning);
  const fallback = `仅修改以下图片文字，其他所有画面元素、文字、构图、人物、背景、色彩、风格与尺寸均保持不变。${changeList}`;
  const coordinateConstraints = changed.map((item) => rectDescription(item.rect)).filter(Boolean).join('；');
  const prompt = `${String(planned.edit_prompt || planned.prompt || fallback).trim()}${coordinateConstraints ? `\n精确区域约束：${coordinateConstraints}。框外内容不得改动。` : ''}`;
  return startGeneration(projectId, { prompt, operation: 'edit_text', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null });
}

async function editImageRegion(projectId, input) {
  projectOrThrow(projectId);
  const instruction = String(input.instruction || '').trim();
  if (!instruction) throw Object.assign(new Error('请描述希望如何修改框选区域'), { status: 400 });
  const rawRect = input.rect;
  if (!rawRect || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rawRect[key])))) {
    throw Object.assign(new Error('请先在图片上框选需要修改的区域'), { status: 400 });
  }
  const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.min(100, Math.max(0, Number(rawRect[key])))]));
  if (rect.width < 1 || rect.height < 1) throw Object.assign(new Error('框选区域太小，请重新框选'), { status: 400 });
  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  const image = imageOrThrow(projectId, input.imageId);
  const region = `整张图片的 x=${rect.x.toFixed(1)}%、y=${rect.y.toFixed(1)}%、宽=${rect.width.toFixed(1)}%、高=${rect.height.toFixed(1)}%`;
  const planning = await callVision(visionModel, image, `你是图片局部修改规划助手。用户只允许修改框选区域，框外的文字、人物、背景、构图、光影、颜色、风格、尺寸和其他物体必须完全保持不变。请结合图片内容和用户要求，为图片编辑模型生成一条准确中文提示词。提示词必须保留精确区域坐标，并说明只改该区域。返回严格 JSON：{"edit_prompt":"..."}。\n框选区域：${region}\n用户修改要求：${instruction}`);
  const planned = parseVisionJson(planning);
  const fallback = `仅修改图片中${region}的框选区域：${instruction}。严格保持框外的所有文字、人物、背景、构图、光影、颜色、风格、尺寸和物体不变。`;
  const prompt = `${String(planned.edit_prompt || planned.prompt || fallback).trim()}\n精确区域约束：仅修改${region}，框外内容不得改动。`;
  return startGeneration(projectId, { prompt, operation: 'local_edit', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: input.params || {} });
}

async function outpaintImage(projectId, input) {
  projectOrThrow(projectId);
  const image = imageOrThrow(projectId, input.imageId);
  const size = String(input.size || '').trim();
  if (!/^\d{2,4}x\d{2,4}$/.test(size)) throw Object.assign(new Error('请选择有效的扩图目标尺寸'), { status: 400 });
  const [width, height] = size.split('x').map(Number);
  if (width < 256 || height < 256 || width > 4096 || height > 4096) throw Object.assign(new Error('扩图目标尺寸不在允许范围内'), { status: 400 });
  const direction = width / height > (image.width || width) / (image.height || height) ? '向左右扩展画面' : width / height < (image.width || width) / (image.height || height) ? '向上下扩展画面' : '向四周自然补全画面';
  const prompt = `以输入图片为核心，${direction}，将最终画布扩展为 ${size}。必须完整保留原图中已有的人物、主体、文字、物体、构图、细节、风格、光影与颜色，不得裁切、重绘或改变原图内容；仅在新增的画布区域自然延展背景、场景、纹理和必要元素，使边缘无缝衔接、透视与光线一致。不要添加不相关的新主体、文字、水印或边框。`;
  return startGeneration(projectId, { prompt, operation: 'outpaint', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: { ...(input.params || {}), size } });
}

async function enhanceImage(projectId, input) {
  projectOrThrow(projectId);
  const image = imageOrThrow(projectId, input.imageId);
  const prompt = '将输入图片增强为更清晰、更精细的高清版本。提升主体边缘、纹理、细节、对焦感与整体清晰度，同时自然抑制压缩噪点、模糊和锯齿。严格保持原图的主体、人物特征、文字内容、构图、比例、颜色、光影、风格和所有已有元素不变；不要裁切、添加、删除、替换或重绘画面内容。';
  return startGeneration(projectId, { prompt, operation: 'enhance', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: input.params || {} });
}

async function removeImageWatermark(projectId, input) {
  projectOrThrow(projectId);
  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  const image = imageOrThrow(projectId, input.imageId);
  const analysis = await callVision(visionModel, image, `分析图片中是否存在覆盖在画面上的水印、平台标识、半透明文字或重复 logo。不要把画面本身的招牌、产品 logo、海报正文或自然出现的文字当成水印。若存在水印，描述每个水印的精确位置、范围、形状、透明度、颜色、文字和它遮挡的背景内容，并生成一条供图片编辑模型使用的中文修复提示词。修复时只移除水印并自然补全其遮挡区域，必须完整保留人物、主体、产品、原有设计文字、构图、风格、光影、颜色和尺寸。返回严格 JSON：{"has_watermark":true,"watermarks":[{"location":"...","appearance":"...","coverage":"..."}],"edit_prompt":"..."}。不要返回 Markdown。`);
  const planned = parseVisionJson(analysis);
  const watermarks = Array.isArray(planned.watermarks) ? planned.watermarks : [];
  if (planned.has_watermark === false || !watermarks.length) {
    throw Object.assign(new Error('视觉识别模型未发现可移除的水印；请确认当前图片是否包含覆盖式水印。'), { status: 400 });
  }
  const locations = watermarks.map((item) => String(item.location || item.coverage || item.appearance || '').trim()).filter(Boolean).join('；');
  const fallback = `移除图片中覆盖在画面上的水印${locations ? `（位置：${locations}）` : ''}，仅修复水印所遮挡的区域并自然补全背景纹理、边缘和细节。严格保留人物、主体、产品、原有设计文字、构图、风格、光影、颜色和图片尺寸；不要删除画面本身的招牌、产品 logo、海报正文或其他非水印文字。`;
  const prompt = `${String(planned.edit_prompt || planned.prompt || fallback).trim()}\n严格约束：只移除经视觉识别确认的覆盖式水印并修复其遮挡区域；其余画面不得改动。`;
  return startGeneration(projectId, { prompt, operation: 'remove_watermark', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: input.params || {} });
}

// Asset extraction: the workspace screenshots the user's selection and sends
// it here. The vision model identifies the intended subject (the box may have
// sloppily included neighbouring clutter), then the image model renders that
// subject alone as a standalone asset that stays faithful to the original.
async function extractImageAsset(projectId, input) {
  projectOrThrow(projectId);
  const sourceImage = imageOrThrow(projectId, input.imageId);
  const rawRect = input.rect;
  if (!rawRect || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rawRect[key])))) {
    throw Object.assign(new Error('请先在图片上框选要提取的内容'), { status: 400 });
  }
  const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.min(100, Math.max(0, Number(rawRect[key])))]));
  if (rect.width < 2 || rect.height < 2) throw Object.assign(new Error('框选区域太小，请重新框选'), { status: 400 });
  const cropMime = String(input.crop?.mimeType || 'image/png');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(cropMime)) throw Object.assign(new Error('截图格式仅支持 PNG、JPG 和 WebP'), { status: 400 });
  const encoded = String(input.crop?.data || '').replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error('截图不能为空且不能超过 10MB'), { status: 400 });
  const dimensions = readImageDimensions(bytes, cropMime);
  if (!dimensions) throw Object.assign(new Error('无法读取截图内容，请重新框选'), { status: 400 });

  const cropImageId = uid();
  const extension = cropMime === 'image/jpeg' ? 'jpg' : cropMime === 'image/webp' ? 'webp' : 'png';
  const relative = path.join('extracts', `${cropImageId}.${extension}`);
  const absolute = path.join(PROJECTS_ROOT, projectId, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  db.prepare(`INSERT INTO images (id, project_id, source_type, file_path, mime_type, width, height, file_size, created_at)
    VALUES (?, ?, 'extract', ?, ?, ?, ?, ?, ?)`)
    .run(cropImageId, projectId, relative, cropMime, dimensions.width, dimensions.height, bytes.length, now());
  const cropImage = db.prepare('SELECT * FROM images WHERE id = ?').get(cropImageId);

  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  const hint = String(input.hint || '').trim();
  const edgeNote = input.crop?.padded ? '截图上下或左右边缘可能存在为满足平台比例要求而拉伸出的窄边，属于截图产生的填充痕迹，不是主体的一部分，规划时请忽略。' : '';
  const intent = hint
    ? `用户还补充了说明：“${hint}”，请优先按补充说明确定要提取的主体。`
    : '截取框可能不够精确：边缘处只出现一部分、被裁断的物体（例如旁边座椅的局部）通常是误入的干扰，不属于主体；主体应是画面中最完整、最主要、最接近截取中心的对象。';
  const planning = await callVision(visionModel, cropImage, `你是素材提取规划助手。用户从一张更大的图片中截取了当前图片，想把它里面最核心的主体提取成一张独立素材图。${intent}${edgeNote}\n请先判断用户想提取的主体，再为图片编辑模型生成一条中文提示词。提示词必须满足：1) 详细描述主体的内容、形状、文字、颜色、材质、光影等可辨识细节，要求输出图中的主体与当前图片中的主体完全一致，不得增删、变形或改变任何细节；2) 明确去除主体之外的所有背景、环境和边缘干扰元素（含截图补边痕迹）；3) 让主体完整、清晰、居中地占满整个画面。返回严格 JSON：{"subject":"主体简短名称","edit_prompt":"给图片编辑模型的完整中文提示词"}。不要返回 Markdown。`);
  const planned = parseVisionJson(planning);
  const subject = String(planned.subject || '').trim();
  const fallback = `提取图片中的主要主体${subject ? `（${subject}）` : ''}，生成一张只包含该主体的独立素材图。主体的内容、文字、颜色、材质、光影必须与输入图片中的主体完全一致；去除主体之外的所有背景、环境和边缘干扰元素，让主体完整、清晰、居中占满整个画面。`;
  const prompt = String(planned.edit_prompt || planned.prompt || fallback).trim();
  return startGeneration(projectId, { prompt, operation: 'extract_asset', modelId: input.modelId, inputImageId: cropImage.id, parentVersionId: input.parentVersionId || sourceImage.version_id || null, params: input.params || {} });
}

// ---- Prompt gallery: user-created entries stored in SQLite ------------------

const GALLERY_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function galleryDto(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    prompt: row.prompt,
    stylePrompt: row.style_prompt,
    image: row.image_path ? `/gallery-files/${row.image_path.replaceAll('\\', '/')}` : null,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listGalleryEntries() {
  return db.prepare('SELECT * FROM gallery_entries ORDER BY created_at DESC').all().map(galleryDto);
}

async function saveGalleryImage(data, mimeType) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw Object.assign(new Error('画廊图片仅支持 PNG、JPG 和 WebP'), { status: 400 });
  const encoded = String(data || '').replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error('画廊图片不能为空且不能超过 10MB'), { status: 400 });
  const dimensions = readImageDimensions(bytes, mimeType);
  if (!dimensions) throw Object.assign(new Error('无法读取图片内容，请重新选择'), { status: 400 });
  const id = uid();
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const relative = `${id}.${extension}`;
  await writeFile(path.join(GALLERY_ROOT, relative), bytes);
  return { relative, bytes, mimeType, width: dimensions.width, height: dimensions.height };
}

function removeGalleryImage(imagePath) {
  if (!imagePath) return;
  const absolute = path.resolve(GALLERY_ROOT, imagePath);
  if (absolute.startsWith(GALLERY_ROOT + path.sep)) rmSync(absolute, { force: true });
}

async function upsertGalleryEntry(input, existingId) {
  const title = String(input.title || '').trim() || '未命名提示词';
  const category = String(input.category || 'mine').trim() || 'mine';
  const prompt = String(input.prompt || '').trim();
  const stylePrompt = String(input.stylePrompt || '').trim();
  if (!prompt && !stylePrompt) throw Object.assign(new Error('请至少填写完整提示词或风格提示词'), { status: 400 });
  const timestamp = now();
  if (existingId) {
    const current = db.prepare('SELECT * FROM gallery_entries WHERE id = ?').get(existingId);
    if (!current) throw Object.assign(new Error('画廊条目不存在'), { status: 404 });
    let imagePath = current.image_path;
    if (input.image?.data) {
      imagePath = (await saveGalleryImage(input.image.data, String(input.image.mimeType || 'image/png'))).relative;
      removeGalleryImage(current.image_path);
    }
    db.prepare('UPDATE gallery_entries SET title = ?, category = ?, prompt = ?, style_prompt = ?, image_path = ?, updated_at = ? WHERE id = ?')
      .run(title, category, prompt, stylePrompt, imagePath, timestamp, existingId);
    return db.prepare('SELECT * FROM gallery_entries WHERE id = ?').get(existingId);
  }
  let imagePath = null;
  if (input.image?.data) imagePath = (await saveGalleryImage(input.image.data, String(input.image.mimeType || 'image/png'))).relative;
  const id = uid();
  db.prepare('INSERT INTO gallery_entries (id, title, category, prompt, style_prompt, image_path, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, category, prompt, stylePrompt, imagePath, String(input.source || 'manual').trim() || 'manual', timestamp, timestamp);
  return db.prepare('SELECT * FROM gallery_entries WHERE id = ?').get(id);
}

const GALLERY_ANALYZE_INSTRUCTION = `你是提示词逆向工程助手。用户会给一张 AI 生成的图片，请反推出可以稳定复现这张图片的中文生图提示词。先仔细分析画面：主体与内容、艺术风格或媒介（如扁平插画、3D 渲染、赛博朋克、水彩）、构图与视角、配色与光影、氛围与细节元素、画质关键词。然后返回严格 JSON：{"title":"8 字以内的简短标题","prompt":"可直接用于文生图模型的完整中文提示词，一段话，把上述要素自然串联，不要分行","stylePrompt":"只提炼可复用的风格描述（风格+媒介+配色+光影+氛围），去掉具体主体内容，一两句话"}。不要返回 Markdown，不要解释。`;

async function analyzeGalleryImage(input) {
  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  const mimeType = String(input.mimeType || 'image/png');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw Object.assign(new Error('图片格式仅支持 PNG、JPG 和 WebP'), { status: 400 });
  const encoded = String(input.data || '').replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error('图片不能为空且不能超过 10MB'), { status: 400 });
  const planned = parseVisionJson(await callVision(visionModel, { buffer: bytes, mime_type: mimeType }, GALLERY_ANALYZE_INSTRUCTION));
  const prompt = String(planned.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('视觉模型没有提炼出提示词，请重试'), { status: 502 });
  return { title: String(planned.title || '').trim() || '未命名提示词', prompt, stylePrompt: String(planned.stylePrompt || '').trim() };
}

async function saveProjectImageToGallery(projectId, input) {
  projectOrThrow(projectId);
  const image = imageOrThrow(projectId, input.imageId);
  const bytes = await readFile(path.join(PROJECTS_ROOT, projectId, image.file_path));
  const config = readModels();
  const visionModel = visionModelOrThrow(config);
  let analysis = null;
  try {
    analysis = parseVisionJson(await callVision(visionModel, { buffer: bytes, mime_type: image.mime_type }, GALLERY_ANALYZE_INSTRUCTION));
  } catch (error) {
    // 提炼失败不拦截收藏：图片先入库，提示词留空由用户手动补充。
    console.error('gallery distill failed:', error.message);
  }
  const extension = image.mime_type === 'image/jpeg' ? 'jpg' : image.mime_type === 'image/webp' ? 'webp' : 'png';
  const relative = `${uid()}.${extension}`;
  await writeFile(path.join(GALLERY_ROOT, relative), bytes);
  const id = uid();
  const timestamp = now();
  db.prepare('INSERT INTO gallery_entries (id, title, category, prompt, style_prompt, image_path, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, String(analysis?.title || '').trim() || '项目收藏', String(input.category || 'mine').trim() || 'mine',
      String(analysis?.prompt || '').trim(), String(analysis?.stylePrompt || '').trim(), relative, 'project', timestamp, timestamp);
  return galleryDto(db.prepare('SELECT * FROM gallery_entries WHERE id = ?').get(id));
}

function deleteGalleryEntry(id) {
  const row = db.prepare('SELECT * FROM gallery_entries WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('画廊条目不存在'), { status: 404 });
  db.prepare('DELETE FROM gallery_entries WHERE id = ?').run(id);
  removeGalleryImage(row.image_path);
  return { ok: true };
}

function startGeneration(projectId, input) {
  projectOrThrow(projectId);
  const config = readModels();
  const requestedModelId = String(input.modelId || '').trim();
  const model = config.models.find((item) => item.id === (requestedModelId || config.active_model));
  if (!model) throw Object.assign(new Error('请选择有效模型'), { status: 400 });
  if (model.type === 'vision') throw Object.assign(new Error('视觉识别模型不能用于图片生成，请在工作台选择图片生成模型'), { status: 400 });
  const prompt = String(input.prompt || '').trim();
  let inputImage = input.inputImageId ? db.prepare('SELECT * FROM images WHERE id = ? AND project_id = ?').get(input.inputImageId, projectId) : null;
  if (!prompt && !inputImage) throw Object.assign(new Error('请输入创作描述或选择输入图片'), { status: 400 });
  // An uploaded source picture being edited for the first time gets an
  // initial version so the original image is kept in the version history.
  if (inputImage) inputImage = ensureUploadVersion(projectId, inputImage);
  const operation = input.operation === 'auto' ? (inputImage ? 'edit_prompt' : 'text_to_image') : input.operation || (inputImage ? 'edit_prompt' : 'text_to_image');
  if (!model.capabilities.includes(operation) && !(['image_to_image', 'edit_text', 'local_edit', 'outpaint', 'enhance', 'remove_watermark', 'extract_asset'].includes(operation) && model.capabilities.includes('edit_prompt'))) {
    throw Object.assign(new Error('当前模型不支持这个操作'), { status: 400 });
  }
  const params = { ...model.defaultParams, ...(input.params || {}) };
  const userMessageId = uid();
  const taskId = uid();
  const createdAt = now();
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(userMessageId, projectId, 'user', 'prompt', JSON.stringify({ prompt, operation, inputImageId: inputImage?.id || null, params, modelName: model.name }), createdAt);
  db.prepare(`INSERT INTO generation_tasks (id, project_id, user_message_id, operation_type, model_id, model_snapshot_json, params_json, input_json, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)`)
    .run(taskId, projectId, userMessageId, operation, model.id, JSON.stringify({ ...model, apiKey: undefined }), JSON.stringify(params), JSON.stringify({ inputImageId: inputImage?.id || null }), createdAt, createdAt);

  const controller = new AbortController();
  runningTasks.set(taskId, controller);
  const timer = setTimeout(() => controller.abort(new Error('timeout')), 120000);
  void runGenerationTask(projectId, taskId, { model, prompt, operation, params, inputImage, parentVersionId: input.parentVersionId || null, controller }).finally(() => {
    clearTimeout(timer);
    runningTasks.delete(taskId);
    canceledTasks.delete(taskId);
  });
  return { taskId, status: 'generating', userMessageId };
}

async function runGenerationTask(projectId, taskId, context) {
  const { model, prompt, operation, params, inputImage, parentVersionId, controller } = context;
  try {
    const { width, height } = parseSize(params.size);
    // The project-level style prompt only steers pure text-to-image creation;
    // edits of an existing picture must keep that picture's own look instead.
    let effectivePrompt = prompt;
    if (!inputImage) {
      const stylePrompt = String(parseJson(db.prepare('SELECT draft_json FROM projects WHERE id = ?').get(projectId)?.draft_json)?.stylePrompt || '').trim();
      if (stylePrompt) effectivePrompt = prompt ? `${prompt}，${stylePrompt}` : stylePrompt;
    }
    let generated;
    // The offline demo model renders placeholder art pixel by pixel, so cap its
    // canvas at a comfortable size while preserving the requested aspect ratio;
    // real providers return true 2K output. The recorded dimensions below use
    // `width`/`height` from the actual bytes for the demo path.
    let outputWidth = width;
    let outputHeight = height;
    if (model.provider === 'mock') {
      const count = Math.min(4, Math.max(1, Number(params.count || 1)));
      const scale = Math.min(1, 1024 / Math.max(width, height));
      outputWidth = Math.round(width * scale);
      outputHeight = Math.round(height * scale);
      await new Promise((resolve) => setTimeout(resolve, 650));
      generated = Array.from({ length: count }, (_, index) => ({ bytes: makeDemoPng(effectivePrompt || '基于图片继续创作', outputWidth, outputHeight, index), mimeType: 'image/png', width: outputWidth, height: outputHeight }));
    } else {
      if (!model.apiKey) throw new Error('模型尚未配置 API Key');
       generated = model.provider === 'gemini'
         ? await callGemini(model, effectivePrompt, params, inputImage, controller.signal)
         : model.provider === 'grok'
           ? await callGrok(model, effectivePrompt, params, inputImage, controller.signal)
           : await callOpenAi(model, effectivePrompt, params, inputImage, controller.signal);
    }

    const versionId = uid();
    const versionNumber = Number(db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM image_versions WHERE project_id = ?').get(projectId).next);
    const parentVersionId = context.parentVersionId || inputImage?.version_id || null;
    db.prepare(`INSERT INTO image_versions (id, project_id, task_id, parent_version_id, version_number, operation_type, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'success', ?)`)
      .run(versionId, projectId, taskId, parentVersionId, versionNumber, operation, now());
    if (inputImage) db.prepare('INSERT OR IGNORE INTO version_inputs VALUES (?, ?, ?)').run(versionId, inputImage.id, 'source');

    const outputIds = [];
    for (const [index, output] of generated.entries()) {
      const imageId = uid();
      const extension = output.mimeType.includes('jpeg') ? 'jpg' : output.mimeType.includes('webp') ? 'webp' : 'png';
      const relative = path.join('generated', `${imageId}.${extension}`);
      const absolute = path.join(PROJECTS_ROOT, projectId, relative);
      await writeFile(absolute, output.bytes);
      db.prepare(`INSERT INTO images (id, project_id, version_id, task_id, source_type, file_path, mime_type, width, height, file_size, created_at)
        VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?)`)
        .run(imageId, projectId, versionId, taskId, relative, output.mimeType, output.width || width, output.height || height, output.bytes.length, now());
      outputIds.push(imageId);
      if (index === 0) db.prepare('UPDATE image_versions SET selected_image_id = ? WHERE id = ?').run(imageId, versionId);
    }
    const assistantId = uid();
    const finishedAt = now();
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(assistantId, projectId, 'assistant', 'result', JSON.stringify({ prompt, operation, outputImageIds: outputIds, versionId, versionNumber, taskId, modelName: model.name }), finishedAt);
    db.prepare('UPDATE generation_tasks SET status = ?, finished_at = ? WHERE id = ?').run(canceledTasks.has(taskId) ? 'canceled' : 'success', finishedAt, taskId);
    db.prepare('UPDATE projects SET current_version_id = ?, current_image_id = ?, cover_image_id = ?, updated_at = ? WHERE id = ?')
      .run(versionId, outputIds[0], outputIds[0], finishedAt, projectId);
  } catch (error) {
    const finishedAt = now();
    const canceled = canceledTasks.has(taskId) || error.name === 'AbortError';
    const message = canceled ? '已取消本次生成，输入已保留，可重新发送。' : friendlyModelMessage(error.message);
    db.prepare('UPDATE generation_tasks SET status = ?, error_json = ?, finished_at = ? WHERE id = ?')
      .run(canceled ? 'canceled' : 'failed', JSON.stringify({ message }), finishedAt, taskId);
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(uid(), projectId, 'assistant', canceled ? 'canceled' : 'error', JSON.stringify({ message, taskId, prompt }), finishedAt);
  }
}

// ---- Version deletion (soft, reference-aware) ------------------------------

function deleteVersion(projectId, versionId, force) {
  projectOrThrow(projectId);
  const version = db.prepare('SELECT * FROM image_versions WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(versionId, projectId);
  if (!version) throw Object.assign(new Error('版本不存在'), { status: 404 });
  const children = db.prepare('SELECT COUNT(*) AS count FROM image_versions WHERE parent_version_id = ? AND deleted_at IS NULL').get(versionId).count;
  if (children > 0 && !force) {
    throw Object.assign(new Error(`该版本被 ${children} 个后续版本引用，删除会产生孤立分支。请先确认，或连同引用一起处理。`), { status: 409, affectedChildren: children });
  }
  db.prepare("UPDATE image_versions SET deleted_at = ?, status = 'deleted' WHERE id = ?").run(now(), versionId);
  // dangling child references are re-pointed at the deleted node's parent so
  // the branch history stays connected instead of silently orphaned.
  db.prepare('UPDATE image_versions SET parent_version_id = ? WHERE parent_version_id = ? AND deleted_at IS NULL')
    .run(version.parent_version_id, versionId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const coverWasDeleted = Boolean(db.prepare('SELECT 1 FROM images WHERE id = ? AND version_id = ?').get(project.cover_image_id, versionId));
  if (project.current_version_id === versionId || coverWasDeleted) {
    const latest = db.prepare("SELECT * FROM image_versions WHERE project_id = ? AND deleted_at IS NULL ORDER BY version_number DESC LIMIT 1").get(projectId);
    db.prepare('UPDATE projects SET current_version_id = ?, current_image_id = ?, cover_image_id = ?, updated_at = ? WHERE id = ?')
      .run(project.current_version_id === versionId ? latest?.id || null : project.current_version_id, project.current_version_id === versionId ? latest?.selected_image_id || null : project.current_image_id, latest?.selected_image_id || null, now(), projectId);
  }
  return bundle(projectId);
}

function listGeneratingTasks(projectId) {
  projectOrThrow(projectId);
  return db.prepare(`
    SELECT id, status, operation_type, created_at, started_at
    FROM generation_tasks
    WHERE project_id = ? AND status = 'generating'
    ORDER BY COALESCE(started_at, created_at) DESC
  `).all(projectId).map((task) => ({
    id: task.id,
    status: task.status,
    operationType: task.operation_type,
    createdAt: task.created_at,
    startedAt: task.started_at,
  }));
}

// ---- Project duplicate ------------------------------------------------------

function remapMessageContent(content, maps) {
  const next = { ...content };
  if (next.inputImageId) next.inputImageId = maps.images.get(next.inputImageId) || null;
  if (Array.isArray(next.outputImageIds)) next.outputImageIds = next.outputImageIds.map((id) => maps.images.get(id) || id);
  if (next.versionId) next.versionId = maps.versions.get(next.versionId) || next.versionId;
  if (next.taskId) next.taskId = maps.tasks.get(next.taskId) || next.taskId;
  return next;
}

function buildIdMaps(rows) {
  const maps = { images: new Map(), versions: new Map(), messages: new Map(), tasks: new Map() };
  for (const row of rows.images || []) maps.images.set(row.id, uid());
  for (const row of rows.versions || []) maps.versions.set(row.id, uid());
  for (const row of rows.messages || []) maps.messages.set(row.id, uid());
  for (const row of rows.tasks || []) maps.tasks.set(row.id, uid());
  return maps;
}

async function duplicateProject(sourceId, nameSuffix = ' 副本') {
  const source = projectOrThrow(sourceId);
  const newId = uid();
  const rows = {
    images: db.prepare('SELECT * FROM images WHERE project_id = ?').all(sourceId),
    // Deleted versions travel with the copy so image/task references stay valid.
    versions: db.prepare('SELECT * FROM image_versions WHERE project_id = ?').all(sourceId),
    messages: db.prepare('SELECT * FROM messages WHERE project_id = ?').all(sourceId),
    tasks: db.prepare('SELECT * FROM generation_tasks WHERE project_id = ?').all(sourceId),
    versionInputs: db.prepare('SELECT vi.* FROM version_inputs vi JOIN image_versions v ON v.id = vi.version_id WHERE v.project_id = ?').all(sourceId),
  };
  ensureProjectDirs(newId);
  await new Promise((resolve, reject) => {
    try { cpSync(path.join(PROJECTS_ROOT, sourceId), path.join(PROJECTS_ROOT, newId), { recursive: true }); resolve(); }
    catch (error) { reject(error); }
  });
  const maps = buildIdMaps(rows);
  const timestamp = now();
  const versionNumber = new Map();
  let nextNumber = 1;
  for (const row of [...rows.versions].sort((a, b) => a.version_number - b.version_number)) versionNumber.set(row.id, nextNumber++);
  db.prepare('INSERT INTO projects (id, name, description, cover_image_id, default_model_id, current_version_id, current_image_id, draft_json, is_favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId, `${source.name}${nameSuffix}`, source.description, source.cover_image_id ? maps.images.get(source.cover_image_id) : null, source.default_model_id,
      source.current_version_id ? maps.versions.get(source.current_version_id) : null, source.current_image_id ? maps.images.get(source.current_image_id) : null,
      source.draft_json, 0, timestamp, timestamp);
  for (const row of rows.tasks) {
    db.prepare(`INSERT INTO generation_tasks (id, project_id, user_message_id, operation_type, model_id, model_snapshot_json, params_json, input_json, status, error_json, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(maps.tasks.get(row.id), newId, row.user_message_id ? maps.messages.get(row.user_message_id) : null, row.operation_type, row.model_id, row.model_snapshot_json, row.params_json, row.input_json, row.status, row.error_json, row.started_at, row.finished_at, row.created_at);
  }
  for (const row of rows.images) {
    db.prepare(`INSERT INTO images (id, project_id, version_id, task_id, source_type, file_path, mime_type, width, height, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(maps.images.get(row.id), newId, row.version_id ? maps.versions.get(row.version_id) : null, row.task_id ? maps.tasks.get(row.task_id) : null, row.source_type, row.file_path, row.mime_type, row.width, row.height, row.file_size, row.created_at);
  }
  for (const row of rows.versions) {
    db.prepare(`INSERT INTO image_versions (id, project_id, task_id, parent_version_id, version_number, operation_type, selected_image_id, status, deleted_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(maps.versions.get(row.id), newId, row.task_id ? maps.tasks.get(row.task_id) : null, row.parent_version_id ? maps.versions.get(row.parent_version_id) : null, row.version_number, row.operation_type, row.selected_image_id ? maps.images.get(row.selected_image_id) : null, row.status, row.deleted_at || null, row.created_at);
  }
  for (const row of rows.versionInputs) {
    const versionId = maps.versions.get(row.version_id);
    const imageId = maps.images.get(row.image_id);
    if (versionId && imageId) db.prepare('INSERT OR IGNORE INTO version_inputs VALUES (?, ?, ?)').run(versionId, imageId, row.input_role);
  }
  for (const row of rows.messages) {
    const content = remapMessageContent(parseJson(row.content_json, {}), maps);
    if (row.message_type === 'prompt' && content.inputImageId === undefined) content.inputImageId = null;
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(maps.messages.get(row.id), newId, row.role, row.message_type, JSON.stringify(content), row.created_at);
  }
  return bundle(newId);
}

// ---- Export / import / backup ----------------------------------------------

async function collectFiles(rootDir, prefix) {
  const out = [];
  let items = [];
  try { items = await readdir(rootDir, { withFileTypes: true }); } catch { return out; }
  for (const item of items) {
    const absolute = path.join(rootDir, item.name);
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) out.push(...await collectFiles(absolute, relative));
    else out.push({ name: relative, absolute });
  }
  return out;
}

async function exportProjectZip(projectId, includeImages) {
  const source = projectOrThrow(projectId);
  const rows = {
    images: db.prepare('SELECT * FROM images WHERE project_id = ?').all(projectId),
    versions: db.prepare('SELECT * FROM image_versions WHERE project_id = ?').all(projectId),
    messages: db.prepare('SELECT * FROM messages WHERE project_id = ?').all(projectId),
    tasks: db.prepare('SELECT * FROM generation_tasks WHERE project_id = ?').all(projectId),
    versionInputs: db.prepare('SELECT vi.* FROM version_inputs vi JOIN image_versions v ON v.id = vi.version_id WHERE v.project_id = ?').all(projectId),
  };
  const meta = { format: 'pixelflow-project', version: 1, exportedAt: now(), project: source, ...rows };
  const entries = [{ name: 'project.json', data: Buffer.from(JSON.stringify(meta, null, 2), 'utf8') }];
  if (includeImages) {
    for (const image of rows.images) {
      const absolute = path.join(PROJECTS_ROOT, projectId, image.file_path);
      if (!existsSync(absolute)) continue;
      entries.push({ name: `files/${image.file_path.replaceAll('\\', '/')}`, data: await readFile(absolute) });
    }
  }
  return createZip(entries);
}

async function importProjectZip(buffer) {
  const entries = readZip(buffer);
  const metaEntry = entries.get('project.json');
  if (!metaEntry) throw Object.assign(new Error('压缩包缺少 project.json，不是有效的项目导出文件'), { status: 400 });
  const meta = JSON.parse(metaEntry.toString('utf8'));
  const source = meta.project || {};
  const newId = uid();
  const maps = buildIdMaps(meta);
  ensureProjectDirs(newId);
  for (const image of meta.images || []) {
    const entry = entries.get(`files/${image.file_path.replaceAll('\\', '/')}`);
    if (!entry) continue;
    const relative = image.file_path.replaceAll('\\', '/');
    const absolute = path.join(PROJECTS_ROOT, newId, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, entry);
  }
  const timestamp = now();
  db.prepare('INSERT INTO projects (id, name, description, cover_image_id, default_model_id, current_version_id, current_image_id, draft_json, is_favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId, `${source.name || '导入项目'}（导入）`, source.description || '', source.cover_image_id ? maps.images.get(source.cover_image_id) : null, source.default_model_id || null,
      source.current_version_id ? maps.versions.get(source.current_version_id) : null, source.current_image_id ? maps.images.get(source.current_image_id) : null,
      source.draft_json || '{}', 0, timestamp, timestamp);
  for (const row of meta.tasks || []) {
    db.prepare(`INSERT INTO generation_tasks (id, project_id, user_message_id, operation_type, model_id, model_snapshot_json, params_json, input_json, status, error_json, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(maps.tasks.get(row.id), newId, row.user_message_id ? maps.messages.get(row.user_message_id) : null, row.operation_type, row.model_id, row.model_snapshot_json, row.params_json, row.input_json, row.status, row.error_json, row.started_at, row.finished_at, row.created_at);
  }
  for (const row of meta.images || []) {
    const relative = row.file_path.replaceAll('\\', '/');
    if (!existsSync(path.join(PROJECTS_ROOT, newId, relative))) continue;
    db.prepare(`INSERT INTO images (id, project_id, version_id, task_id, source_type, file_path, mime_type, width, height, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(maps.images.get(row.id), newId, row.version_id ? maps.versions.get(row.version_id) : null, row.task_id ? maps.tasks.get(row.task_id) : null, row.source_type, row.file_path, row.mime_type, row.width, row.height, row.file_size, row.created_at);
  }
  for (const row of meta.versions || []) {
    db.prepare(`INSERT INTO image_versions (id, project_id, task_id, parent_version_id, version_number, operation_type, selected_image_id, status, deleted_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(maps.versions.get(row.id), newId, row.task_id ? maps.tasks.get(row.task_id) : null, row.parent_version_id ? maps.versions.get(row.parent_version_id) : null, row.version_number, row.operation_type, row.selected_image_id ? maps.images.get(row.selected_image_id) : null, row.status, row.deleted_at || null, row.created_at);
  }
  for (const row of meta.versionInputs || []) {
    const versionId = maps.versions.get(row.version_id);
    const imageId = maps.images.get(row.image_id);
    if (versionId && imageId) db.prepare('INSERT OR IGNORE INTO version_inputs VALUES (?, ?, ?)').run(versionId, imageId, row.input_role);
  }
  for (const row of meta.messages || []) {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(maps.messages.get(row.id), newId, row.role, row.message_type, JSON.stringify(remapMessageContent(parseJson(row.content_json, {}), maps)), row.created_at);
  }
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(uid(), newId, 'system', 'project_imported', JSON.stringify({ text: `项目已导入${(meta.images || []).some((image) => !existsSync(path.join(PROJECTS_ROOT, newId, image.file_path.replaceAll('\\', '/')))) ? '，部分图片文件缺失，对应位置会显示占位。' : '，全部图片文件已恢复。'}` }), timestamp);
  return bundle(newId);
}

async function buildBackupZip() {
  // Fold the WAL back into the main file so the copy is self-contained.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const entries = [{ name: 'pixelflow-backup.json', data: Buffer.from(JSON.stringify({ format: 'pixelflow-backup', version: 1, exportedAt: now() }, null, 2), 'utf8') }];
  if (existsSync(path.join(DATA_ROOT, 'app.db'))) entries.push({ name: 'data/app.db', data: await readFile(path.join(DATA_ROOT, 'app.db')) });
  if (existsSync(MODELS_CONFIG_PATH)) entries.push({ name: 'config/models.json', data: await readFile(MODELS_CONFIG_PATH) });
  for (const file of await collectFiles(PROJECTS_ROOT, 'data/projects')) {
    entries.push({ name: file.name, data: await readFile(file.absolute) });
  }
  for (const file of await collectFiles(GALLERY_ROOT, 'data/gallery')) {
    entries.push({ name: file.name, data: await readFile(file.absolute) });
  }
  return createZip(entries);
}

async function restoreBackup(buffer) {
  const entries = readZip(buffer);
  if (!entries.get('data/app.db')) throw Object.assign(new Error('备份包缺少 data/app.db，不是有效的完整备份'), { status: 400 });
  const stamp = now().replace(/[:.]/g, '-');
  const safety = path.join(DATA_ROOT, 'backups', stamp);
  mkdirSync(safety, { recursive: true });
  cpSync(path.join(DATA_ROOT, 'app.db'), path.join(safety, 'app.db'));
  cpSync(PROJECTS_ROOT, path.join(safety, 'projects'), { recursive: true });
  if (existsSync(MODELS_CONFIG_PATH)) cpSync(MODELS_CONFIG_PATH, path.join(safety, 'models.json'));

  closeDatabase();
  rmSync(path.join(DATA_ROOT, 'app.db-wal'), { force: true });
  rmSync(path.join(DATA_ROOT, 'app.db-shm'), { force: true });
  rmSync(path.join(DATA_ROOT, 'app.db'), { force: true });
  rmSync(PROJECTS_ROOT, { recursive: true, force: true });
  rmSync(GALLERY_ROOT, { recursive: true, force: true });
  mkdirSync(PROJECTS_ROOT, { recursive: true });
  mkdirSync(GALLERY_ROOT, { recursive: true });

  await writeFile(path.join(DATA_ROOT, 'app.db'), entries.get('data/app.db'));
  const modelsEntry = entries.get('config/models.json');
  if (modelsEntry) {
    mkdirSync(path.dirname(MODELS_CONFIG_PATH), { recursive: true });
    await writeFile(MODELS_CONFIG_PATH, modelsEntry);
  }
  for (const [name, data] of entries) {
    if (!name.startsWith('data/projects/') && !name.startsWith('data/gallery/')) continue;
    if (name.endsWith('/')) continue;
    const absolute = path.join(APP_ROOT, name.replaceAll('/', path.sep));
    mkdirSync(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
  }
  return { safetyBackup: path.relative(APP_ROOT, safety) };
}

// ---- Static files with on-demand thumbnails ---------------------------------

async function serveFile(req, res, pathname, searchParams) {
  const relative = decodeURIComponent(pathname.slice('/files/'.length));
  const absolute = path.resolve(PROJECTS_ROOT, relative);
  if (!absolute.startsWith(PROJECTS_ROOT + path.sep) || !existsSync(absolute)) return json(res, 404, { error: '图片不存在' });
  const extension = path.extname(absolute).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
  let payloadPath = absolute;
  const width = Math.min(2048, Math.max(0, Number(searchParams.get('w')) || 0));
  if (width >= 64 && extension === '.png') {
    try {
      const projectSegment = relative.split(/[\\/]/)[0];
      const cachePath = path.join(PROJECTS_ROOT, projectSegment, 'thumbnails', `${path.basename(absolute, '.png')}_w${width}.png`);
      if (!existsSync(cachePath)) {
        const thumbnail = makeThumbnailPng(await readFile(absolute), width);
        if (thumbnail) {
          mkdirSync(path.dirname(cachePath), { recursive: true });
          await writeFile(cachePath, thumbnail);
        }
      }
      if (existsSync(cachePath)) payloadPath = cachePath;
    } catch { /* fall back to the original file */ }
  }
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(await readFile(payloadPath));
}

async function serveGalleryFile(res, pathname) {
  const relative = decodeURIComponent(pathname.slice('/gallery-files/'.length));
  const absolute = path.resolve(GALLERY_ROOT, relative);
  if (!absolute.startsWith(GALLERY_ROOT + path.sep) || !existsSync(absolute)) return json(res, 404, { error: '图片不存在' });
  const extension = path.extname(absolute).toLowerCase();
  const mime = GALLERY_MIME[extension.slice(1)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(await readFile(absolute));
}

async function serveApp(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  let absolute = path.resolve(DIST_ROOT, requested);
  if (!absolute.startsWith(DIST_ROOT + path.sep) || !existsSync(absolute)) absolute = path.join(DIST_ROOT, 'index.html');
  if (!existsSync(absolute)) return json(res, 404, { error: '前端尚未构建，请先运行 npm run build' });
  const extension = path.extname(absolute).toLowerCase();
  const mime = extension === '.html' ? 'text/html; charset=utf-8' : extension === '.js' ? 'text/javascript; charset=utf-8' : extension === '.css' ? 'text/css; charset=utf-8' : extension === '.png' ? 'image/png' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000' });
  res.end(await readFile(absolute));
}

async function testModelConnection(model) {
  const started = Date.now();
  if (model.provider === 'mock') return { ok: true, latency: Date.now() - started, message: '本地演示模型可用' };
  if (!model.apiKey || model.apiKey === '••••••••') throw Object.assign(new Error('请先填写 API Key'), { status: 400 });
  const baseUrl = normalizeBaseUrl(model.baseUrl);
  if (model.type === 'image' && model.provider === 'gemini') {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model.model)}`, {
      headers: { 'x-goog-api-key': model.apiKey },
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || payload?.message || `连接失败（${response.status}）`), { status: 502 });
    return { ok: true, latency: Date.now() - started, message: 'Gemini Nano Banana 模型已识别' };
  }
  const isDots = model.type === 'vision' && /(?:^|\.)askdiandian\.com$/i.test(new URL(baseUrl).hostname);
  if (isDots) {
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { 'api-key': model.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.model, max_tokens: 1, stream: false, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: '请只回复 OK。' }] }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || payload?.message || `连接失败（${response.status}）`), { status: 502 });
    return { ok: true, latency: Date.now() - started, message: '视觉识别端点连接成功（已关闭思考）' };
  }
  const modelEndpoint = `${baseUrl}/models/${model.model}`;
  const isSenseNova = /(?:^|\.)sensenova\.cn$/i.test(new URL(baseUrl).hostname);
  let response = await fetch(modelEndpoint, { headers: { Authorization: `Bearer ${model.apiKey}` }, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) {
    const imageEndpoint = `${baseUrl}/images/generations`;
    response = await fetch(imageEndpoint, { method: 'OPTIONS', headers: { Authorization: `Bearer ${model.apiKey}` }, signal: AbortSignal.timeout(15000) });
    if (response.status !== 404) return { ok: true, latency: Date.now() - started, message: '图片生成端点可达（该服务不提供通用模型查询）' };
    if (isSenseNova) return { ok: true, latency: Date.now() - started, message: 'SenseNova 图片模型配置已识别；请通过一次生成验证权限' };
  }
  if (!response.ok) throw Object.assign(new Error(`连接失败（${response.status}）`), { status: 502 });
  return { ok: true, latency: Date.now() - started, message: '连接成功' };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/files/') && req.method === 'GET') return await serveFile(req, res, pathname, url.searchParams);
    if (pathname.startsWith('/gallery-files/') && req.method === 'GET') return await serveGalleryFile(res, pathname);
    if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, storage: 'local-sqlite' });

    if (pathname === '/api/projects' && req.method === 'GET') return json(res, 200, { projects: listProjects() });
    if (pathname === '/api/projects' && req.method === 'POST') {
      const input = await body(req);
      const id = uid();
      const timestamp = now();
      const activeModel = input.defaultModelId || readModels().active_model || null;
      db.prepare('INSERT INTO projects (id, name, description, default_model_id, draft_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, String(input.name || '未命名项目').trim() || '未命名项目', String(input.description || ''), activeModel, '{}', timestamp, timestamp);
      ensureProjectDirs(id);
      db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(uid(), id, 'system', 'project_created', JSON.stringify({ text: '项目已创建，可以开始第一轮创作。' }), timestamp);
      return json(res, 201, bundle(id));
    }

    if (pathname === '/api/projects/import' && req.method === 'POST') {
      const input = await body(req, 512 * 1024 * 1024);
      const encoded = String(input.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!encoded) throw Object.assign(new Error('请提供导入文件内容'), { status: 400 });
      return json(res, 201, await importProjectZip(Buffer.from(encoded, 'base64')));
    }

    if (pathname === '/api/backup' && req.method === 'GET') return zipResponse(res, await buildBackupZip(), 'pixelflow-backup.zip');
    if (pathname === '/api/backup/restore' && req.method === 'POST') {
      const input = await body(req, 512 * 1024 * 1024);
      const encoded = String(input.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!encoded) throw Object.assign(new Error('请提供备份文件内容'), { status: 400 });
      const { safetyBackup } = await restoreBackup(Buffer.from(encoded, 'base64'));
      // The on-disk database has been replaced under this process, so hand
      // over to a fresh server and exit. The response is flushed first.
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, restartRequired: true, safetyBackup }));
      res.on('finish', () => {
        setTimeout(() => {
          try {
            spawn(process.execPath, [path.join(APP_ROOT, 'server', 'index.mjs')], { cwd: APP_ROOT, detached: true, stdio: 'ignore' }).unref();
          } catch { /* user can restart manually */ }
          process.exit(0);
        }, 300);
      });
      return;
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && req.method === 'GET') return json(res, 200, bundle(projectMatch[1]));
    if (projectMatch && req.method === 'PATCH') {
      const projectId = projectMatch[1];
      const current = projectOrThrow(projectId);
      const input = await body(req);
      db.prepare('UPDATE projects SET name = ?, description = ?, default_model_id = ?, draft_json = ?, current_version_id = ?, current_image_id = ?, is_favorite = ?, updated_at = ? WHERE id = ?')
        .run(input.name ?? current.name, input.description ?? current.description, input.defaultModelId ?? current.default_model_id, input.draft ? JSON.stringify(input.draft) : current.draft_json, input.currentVersionId ?? current.current_version_id, input.currentImageId ?? current.current_image_id, input.isFavorite === undefined ? current.is_favorite : Number(Boolean(input.isFavorite)), now(), projectId);
      return json(res, 200, bundle(projectId));
    }
    if (projectMatch && req.method === 'DELETE') {
      projectOrThrow(projectMatch[1]);
      db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), projectMatch[1]);
      return json(res, 200, { ok: true });
    }

    const duplicateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/duplicate$/);
    if (duplicateMatch && req.method === 'POST') return json(res, 201, await duplicateProject(duplicateMatch[1]));
    const exportMatch = pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
    if (exportMatch && req.method === 'GET') {
      const includeImages = url.searchParams.get('images') !== '0';
      const project = projectOrThrow(exportMatch[1]);
      return zipResponse(res, await exportProjectZip(exportMatch[1], includeImages), `pixelflow-${project.name.length < 24 ? encodeURIComponent(project.name) : project.id.slice(0, 8)}.zip`);
    }

    const uploadMatch = pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
    if (uploadMatch && req.method === 'POST') {
      const projectId = uploadMatch[1];
      projectOrThrow(projectId);
      const input = await body(req);
      const mime = String(input.mimeType || '');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw Object.assign(new Error('仅支持 PNG、JPG 和 WebP'), { status: 400 });
      const encoded = String(input.data || '').replace(/^data:[^;]+;base64,/, '');
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error('图片不能为空且不能超过 10MB'), { status: 400 });
      const dimensions = readImageDimensions(bytes, mime);
      if (!dimensions) throw Object.assign(new Error('无法读取图片尺寸，请重新选择有效的 PNG、JPG 或 WebP 图片'), { status: 400 });
      const imageId = uid();
      const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      const relative = path.join('uploads', `${imageId}.${extension}`);
      await writeFile(path.join(PROJECTS_ROOT, projectId, relative), bytes);
      db.prepare(`INSERT INTO images (id, project_id, source_type, file_path, mime_type, width, height, file_size, created_at)
        VALUES (?, ?, 'upload', ?, ?, ?, ?, ?, ?)`)
        .run(imageId, projectId, relative, mime, dimensions.width, dimensions.height, bytes.length, now());
      db.prepare('UPDATE projects SET current_image_id = ?, updated_at = ? WHERE id = ?').run(imageId, now(), projectId);
      return json(res, 201, bundle(projectId));
    }

    const generateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/generate$/);
    if (generateMatch && req.method === 'POST') return json(res, 202, startGeneration(generateMatch[1], await body(req)));
    const recognizeTextMatch = pathname.match(/^\/api\/projects\/([^/]+)\/recognize-text$/);
    if (recognizeTextMatch && req.method === 'POST') return json(res, 200, await recognizeImageText(recognizeTextMatch[1], await body(req)));
    const editTextMatch = pathname.match(/^\/api\/projects\/([^/]+)\/edit-text$/);
    if (editTextMatch && req.method === 'POST') return json(res, 202, await editImageText(editTextMatch[1], await body(req)));
    const localEditMatch = pathname.match(/^\/api\/projects\/([^/]+)\/local-edit$/);
    if (localEditMatch && req.method === 'POST') return json(res, 202, await editImageRegion(localEditMatch[1], await body(req)));
    const outpaintMatch = pathname.match(/^\/api\/projects\/([^/]+)\/outpaint$/);
    if (outpaintMatch && req.method === 'POST') return json(res, 202, await outpaintImage(outpaintMatch[1], await body(req)));
    const enhanceMatch = pathname.match(/^\/api\/projects\/([^/]+)\/enhance$/);
    if (enhanceMatch && req.method === 'POST') return json(res, 202, await enhanceImage(enhanceMatch[1], await body(req)));
    const removeWatermarkMatch = pathname.match(/^\/api\/projects\/([^/]+)\/remove-watermark$/);
    if (removeWatermarkMatch && req.method === 'POST') return json(res, 202, await removeImageWatermark(removeWatermarkMatch[1], await body(req)));
    const extractMatch = pathname.match(/^\/api\/projects\/([^/]+)\/extract-asset$/);
    if (extractMatch && req.method === 'POST') return json(res, 202, await extractImageAsset(extractMatch[1], await body(req)));

    const tasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
    if (tasksMatch && req.method === 'GET') return json(res, 200, { tasks: listGeneratingTasks(tasksMatch[1]) });
    const taskMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') {
      const task = db.prepare('SELECT * FROM generation_tasks WHERE id = ? AND project_id = ?').get(taskMatch[2], taskMatch[1]);
      if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
      return json(res, 200, { id: task.id, status: task.status, operationType: task.operation_type, error: parseJson(task.error_json, null)?.message || null, createdAt: task.created_at, finishedAt: task.finished_at });
    }
    const cancelMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      const task = db.prepare('SELECT * FROM generation_tasks WHERE id = ? AND project_id = ?').get(cancelMatch[2], cancelMatch[1]);
      if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
      if (task.status !== 'generating') return json(res, 200, { ok: false, status: task.status });
      canceledTasks.add(task.id);
      runningTasks.get(task.id)?.abort(new Error('canceled'));
      return json(res, 200, { ok: true, status: 'canceling' });
    }

    const versionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/versions\/([^/]+)$/);
    if (versionMatch && req.method === 'DELETE') {
      const force = url.searchParams.get('force') === '1';
      return json(res, 200, deleteVersion(versionMatch[1], versionMatch[2], force));
    }

    if (pathname === '/api/models' && req.method === 'GET') {
      const config = readModels();
      return json(res, 200, { activeModel: config.active_model, activeVisionModel: config.active_vision_model, models: config.models.map(publicModel) });
    }
    if (pathname === '/api/gallery' && req.method === 'GET') return json(res, 200, { entries: listGalleryEntries() });
    if (pathname === '/api/gallery' && req.method === 'POST') return json(res, 201, { entry: galleryDto(await upsertGalleryEntry(await body(req, 32 * 1024 * 1024))) });
    if (pathname === '/api/gallery/analyze' && req.method === 'POST') return json(res, 200, await analyzeGalleryImage(await body(req, 16 * 1024 * 1024)));
    if (pathname === '/api/gallery/from-image' && req.method === 'POST') {
      const input = await body(req);
      return json(res, 201, { entry: await saveProjectImageToGallery(String(input.projectId || ''), input) });
    }
    const galleryIdMatch = pathname.match(/^\/api\/gallery\/([^/]+)$/);
    if (galleryIdMatch && req.method === 'PATCH') return json(res, 200, { entry: galleryDto(await upsertGalleryEntry(await body(req, 32 * 1024 * 1024), galleryIdMatch[1])) });
    if (galleryIdMatch && req.method === 'DELETE') return json(res, 200, deleteGalleryEntry(galleryIdMatch[1]));
    if (pathname === '/api/models' && req.method === 'POST') return json(res, 201, { model: upsertModel(await body(req)) });
    if (pathname === '/api/models/test-config' && req.method === 'POST') return json(res, 200, await testModelConnection(await body(req)));
    const modelMatch = pathname.match(/^\/api\/models\/([^/]+)$/);
    if (modelMatch && req.method === 'PATCH') return json(res, 200, { model: upsertModel(await body(req), modelMatch[1]) });
    if (modelMatch && req.method === 'DELETE') { removeModel(modelMatch[1]); return json(res, 200, { ok: true }); }
    const activateMatch = pathname.match(/^\/api\/models\/([^/]+)\/activate$/);
    if (activateMatch && req.method === 'POST') {
      const config = readModels();
      const model = config.models.find((item) => item.id === activateMatch[1]);
      if (!model) throw Object.assign(new Error('模型不存在'), { status: 404 });
      if (model.type === 'vision') throw Object.assign(new Error('视觉识别模型不能设为图片生成默认模型'), { status: 400 });
      config.active_model = activateMatch[1]; writeModels(config); return json(res, 200, { ok: true });
    }
    const activateVisionMatch = pathname.match(/^\/api\/models\/([^/]+)\/activate-vision$/);
    if (activateVisionMatch && req.method === 'POST') {
      const config = readModels();
      const model = config.models.find((item) => item.id === activateVisionMatch[1]);
      if (!model) throw Object.assign(new Error('模型不存在'), { status: 404 });
      if (model.type !== 'vision') throw Object.assign(new Error('只能将视觉识别模型设为识别默认模型'), { status: 400 });
      config.active_vision_model = model.id; writeModels(config); return json(res, 200, { ok: true });
    }
    const testMatch = pathname.match(/^\/api\/models\/([^/]+)\/test$/);
    if (testMatch && req.method === 'POST') {
      const model = readModels().models.find((item) => item.id === testMatch[1]);
      if (!model) throw Object.assign(new Error('模型不存在'), { status: 404 });
      return json(res, 200, await testModelConnection(model));
    }
    if (req.method === 'GET' && !pathname.startsWith('/api/')) return await serveApp(res, pathname);
    return json(res, 404, { error: '接口不存在' });
  } catch (error) {
    console.error(error);
    const payload = { error: error.status === 502 ? friendlyModelMessage(error.message) : error.message || '服务器内部错误' };
    if (error.affectedChildren !== undefined) payload.affectedChildren = error.affectedChildren;
    return json(res, error.status || 500, payload);
  }
});

server.listen(PORT, HOST, () => console.log(`Layerive API running at http://${HOST}:${PORT}`));

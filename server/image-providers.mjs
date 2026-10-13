// Native image protocols. The host supplies ordered in-memory inputs and the
// same AbortSignal used by planning, retries and version publication.
import { setTimeout as delay } from 'node:timers/promises';

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function providerMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || (typeof payload?.detail === 'string' ? payload.detail : Array.isArray(payload?.detail) ? payload.detail.map(item => item.msg).join('; ') : '') || fallback;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const seconds = Number(response.headers.get('retry-after'));
    throw Object.assign(new Error(providerMessage(payload, `模型请求失败（${response.status}）`)), {
      status: response.status,
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
    });
  }
  if (!payload || typeof payload !== 'object') throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
  return payload;
}

function dimensions(size, protocol) {
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size || '');
  const width = Number(match?.[1]), height = Number(match?.[2]);
  const pixels = width * height;
  const valid = protocol === 'seedream_images'
    ? pixels >= 921600 && pixels <= 4624220 && Math.max(width / height, height / width) <= 16
    : protocol === 'qwen_images'
    ? pixels >= 512 * 512 && pixels <= 2048 * 2048 && Math.max(width / height, height / width) <= 8
    : width >= 64 && height >= 64 && width % 16 === 0 && height % 16 === 0 && pixels <= 4 * 1024 * 1024;
  if (!match || !valid) throw failure('model.invalidImageSize', '所选尺寸不符合该图片协议的像素或比例限制');
  return { width, height };
}

function dataUrl(input) { return `data:${input.mimeType};base64,${input.bytes.toString('base64')}`; }

function authHeaders(model, protocol) {
  return model.apiKey?.trim() ? protocol === 'bfl_flux' ? { 'x-key': model.apiKey } : { Authorization: `Bearer ${model.apiKey}` } : {};
}

function checkInputs(inputs, maximum) {
  if (inputs.length > maximum) throw failure('model.tooManyInputImages', '输入图片数量超过该模型上限');
}

async function downloadImage(url, mimeType, signal) {
  let parsed;
  try { parsed = new URL(url); } catch { /* handled below */ }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
  // Never forward model credentials to signed output URLs.
  const response = await fetch(parsed, { signal });
  if (!response.ok) throw failure('model.imageDownloadFailed', '模型已返回图片地址，但图片下载失败');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
  const contentType = response.headers.get('content-type')?.split(';')[0];
  return { bytes, mimeType: ['image/png', 'image/jpeg', 'image/webp'].includes(contentType) ? contentType : mimeType };
}

async function imageOutputs(payload, fallbackMime, signal) {
  if (!Array.isArray(payload.data) || !payload.data.length) throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
  return Promise.all(payload.data.map(async item => {
    if (item?.error) throw new Error(providerMessage({ error: item.error }, '模型生成失败'));
    const mimeType = item?.output_format === 'jpeg' ? 'image/jpeg' : item?.output_format === 'png' ? 'image/png' : fallbackMime;
    if (typeof item?.b64_json === 'string' && item.b64_json.length) return { bytes: Buffer.from(item.b64_json, 'base64'), mimeType };
    if (typeof item?.url === 'string') return downloadImage(item.url, mimeType, signal);
    throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
  }));
}

export async function callSeedream(model, prompt, params, inputs, signal) {
  checkInputs(inputs, 10);
  dimensions(params.size, 'seedream_images');
  if (params.transparent) throw failure('model.transparentUnsupported', '该模型不支持本项目的透明背景生成或去背景');
  const format = params.outputFormat === 'jpeg' ? 'jpeg' : 'png';
  const payload = await jsonRequest(`${model.baseUrl}/images/generations`, {
    method: 'POST', headers: { ...authHeaders(model), 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: model.model, prompt, size: params.size, output_format: format, response_format: 'b64_json', watermark: false,
      ...(inputs.length ? { image: inputs.length === 1 ? dataUrl(inputs[0]) : inputs.map(dataUrl) } : {}),
    }),
  });
  return imageOutputs(payload, format === 'jpeg' ? 'image/jpeg' : 'image/png', signal);
}

export async function callQwen(model, prompt, params, inputs, signal) {
  checkInputs(inputs, /^qwen-image-2\.1-/.test(model.model) ? 10 : 3);
  dimensions(params.size, 'qwen_images');
  if (params.transparent && !/^qwen-image-2\.1-(pro|turbo)$/.test(model.model)) throw failure('model.transparentUnsupported', '该模型不支持本项目的透明背景生成或去背景');
  const payload = await jsonRequest(`${model.baseUrl}/images/generations`, {
    method: 'POST', headers: { ...authHeaders(model), 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: model.model,
      prompt: params.transparent ? `${prompt}\n输出带真实 Alpha 透明通道的 PNG，背景完全透明，不要白底、纯色背景或棋盘格。` : prompt,
      size: params.size, n: Math.min(4, Math.max(1, Math.trunc(Number(params.count) || 1))), watermark: false, prompt_extend: !inputs.length,
      ...(inputs.length ? { image: inputs.length === 1 ? dataUrl(inputs[0]) : inputs.map(dataUrl) } : {}),
    }),
  });
  return imageOutputs(payload, 'image/png', signal);
}

// The global BFL API routes polling to regional BFL hosts. Limit authenticated
// polling to the configured origin or official HTTPS BFL hosts; no redirects.
function pollingUrl(value, baseUrl) {
  let url;
  try { url = new URL(value, `${baseUrl}/`); } catch { /* handled below */ }
  const configured = new URL(baseUrl);
  if (!url || url.username || url.password || !['http:', 'https:'].includes(url.protocol)
    || !(url.origin === configured.origin || (url.protocol === 'https:' && (url.hostname === 'bfl.ai' || url.hostname.endsWith('.bfl.ai')) && (!url.port || url.port === '443')))) {
    throw failure('model.invalidPollingUrl', '模型返回了不受信任的轮询地址');
  }
  return url;
}

export async function callFlux(model, prompt, params, inputs, signal) {
  checkInputs(inputs, 8);
  const { width, height } = dimensions(params.size, 'bfl_flux');
  if (params.transparent) throw failure('model.transparentUnsupported', '该模型不支持本项目的透明背景生成或去背景');
  const format = ['png', 'jpeg', 'webp'].includes(params.outputFormat) ? params.outputFormat : 'png';
  const body = { prompt, width, height, output_format: format, disable_pup: Boolean(inputs.length) };
  inputs.forEach((input, index) => { body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = input.bytes.toString('base64'); });
  const submitted = await jsonRequest(`${model.baseUrl}/${encodeURIComponent(model.model)}`, {
    method: 'POST', headers: { ...authHeaders(model, 'bfl_flux'), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (typeof submitted.id !== 'string' || !submitted.id || typeof submitted.polling_url !== 'string' || !submitted.polling_url) throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
  const url = pollingUrl(submitted.polling_url, model.baseUrl);
  for (;;) {
    await delay(500, undefined, { signal });
    // Retry throttled polls in place; never resubmit a billable generation.
    let result;
    try { result = await jsonRequest(url, { headers: authHeaders(model, 'bfl_flux'), signal }); }
    catch (error) {
      if (error.status !== 429) throw error;
      await delay(error.retryAfterMs || 1500, undefined, { signal });
      continue;
    }
    if (result.status === 'Ready') {
      if (typeof result.result?.sample !== 'string') throw failure('model.invalidImageResponse', '模型未返回有效的图片响应');
      return [await downloadImage(result.result.sample, `image/${format}`, signal)];
    }
    if (['Pending', 'Reasoning', 'Generating'].includes(result.status)) continue;
    if (['Request Moderated', 'Content Moderated'].includes(result.status)) throw failure('model.safety', '模型平台安全审核未通过，请调整图片或提示词后重试');
    throw failure('model.imageTaskFailed', `图片模型任务失败（${String(result.status || 'unknown').slice(0, 100)}）`);
  }
}

export async function testNativeImageConnection(model, protocol, signal) {
  // Read-only checks do not start or charge for image generation. Endpoint
  // reachability alone does not establish model permission or edit capability.
  const headers = authHeaders(model, protocol);
  const endpoint = protocol === 'bfl_flux' ? `${model.baseUrl}/credits` : `${model.baseUrl}/models`;
  const response = await fetch(endpoint, { headers, signal, redirect: 'error' });
  const payload = await response.json().catch(() => null);
  if (response.ok && protocol === 'bfl_flux' && Number.isFinite(payload?.credits)) return { code: 'msg.testFluxOk', message: 'BFL 账户认证成功；具体模型权限和编辑能力需通过实际任务验证' };
  if (response.ok && protocol !== 'bfl_flux' && Array.isArray(payload?.data)) {
    if (!payload.data.some(item => item.id === model.model)) throw failure('model.nativeModelNotFound', '服务未返回该模型，请核对模型名称和地域', { status: 502 });
    return { code: 'msg.testNativeModelOk', message: '服务已连接并返回该模型；生成和编辑能力需通过实际任务验证' };
  }
  if (response.status === 404 || response.status === 405) {
    const path = protocol === 'bfl_flux' ? encodeURIComponent(model.model) : 'images/generations';
    const probe = await fetch(`${model.baseUrl}/${path}`, { method: 'OPTIONS', headers, signal, redirect: 'error' });
    if (probe.ok || probe.status === 405) return { code: 'msg.testNativeEndpointOk', message: '图片端点可达；此检查未验证 API Key、模型权限或编辑能力，请通过实际任务验证' };
    throw Object.assign(new Error(`连接失败（${probe.status}）`), { status: 502 });
  }
  throw Object.assign(new Error(providerMessage(payload, `连接失败（${response.status}）`)), { status: 502 });
}

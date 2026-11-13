import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_ROOT, uid } from './db.mjs';

const configPath = path.join(CONFIG_ROOT, 'models.json');
mkdirSync(path.dirname(configPath), { recursive: true });

export function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/(?:images\/generations|images\/edits)\/?$/i, '').replace(/\/+$/, '');
}

const VISION_API_FORMATS = new Set(['anthropic_messages', 'chat_completions', 'responses']);
const IMAGE_API_FORMATS = new Set(['openai_images', 'gemini_interactions', 'grok_images', 'seedream_images', 'qwen_images', 'bfl_flux']);
const IMAGE_PROVIDERS = new Set(['sensenova', 'openai', 'gemini', 'grok', 'seedream', 'qwen', 'flux', 'custom', 'local', 'mock']);

// A model may hold several keys for the same platform. Keys are stored only in
// this machine's config/models.json; the browser sees the masked placeholder
// until it asks for an explicit reveal.
export const MASKED_API_KEY = '••••••••';

/** Every distinct, non-empty key configured on a model, in declared order. */
export function modelApiKeys(model) {
  const listed = Array.isArray(model?.apiKeys) ? model.apiKeys : [];
  const keys = listed.map((value) => String(value ?? '').trim()).filter((key) => key && key !== MASKED_API_KEY);
  if (!keys.length) {
    const single = String(model?.apiKey ?? '').trim();
    if (single && single !== MASKED_API_KEY) keys.push(single);
  }
  return [...new Set(keys)];
}

// Local OpenAI-compatible services may run without authentication. Never send
// an empty Bearer token; retain normal authentication when a key is configured.
export function hasModelCredentials(model) {
  return Boolean(model && (model.provider === 'local' || modelApiKeys(model).length));
}

// `key` lets the caller pass the key a rotation actually chose. Without it the
// model's own `apiKey` wins — that is the field the key pool writes the selected
// credential into — and only then the first configured key. Reading `apiKeys[0]`
// first would pin every request to key #1 and defeat the rotation entirely.
export function bearerHeaders(model, key) {
  const token = String(key ?? model?.apiKey ?? modelApiKeys(model)[0] ?? '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const IMAGE_PRESETS = {
  local: { baseUrl: 'http://127.0.0.1:8000/v1', model: '', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024'], outputFormats: ['png'], transparentBackground: false, maxCount: 1 },
  // 日日新（SenseNova）U 系列：图片生成与编辑走 OpenAI 兼容的
  // /v1/images/generations 与 /v1/images/edits。尺寸必须是 32 的倍数、边长
  // 512–4096、比例不超过 3:1；下面把官方推荐分辨率放在最前，再保留其余合法
  // 比例，方便工作台按原图比例就近取用。
  sensenova: { baseUrl: 'https://token.sensenova.cn/v1', model: 'sensenova-u1.5-lite', imageApiFormat: 'openai_images', sizeOptions: ['2048x2048', '2720x1536', '1536x2720', '1664x2496', '2496x1664', '4096x4096', '1760x2368', '2368x1760', '1824x2272', '2272x1824', '2752x1536', '1536x2752', '3072x1376', '1344x3136'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: false, maxCount: 4, defaultParams: { watermark: false, promptExtend: true } },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: true, maxCount: 4 },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image', imageApiFormat: 'gemini_interactions', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg'], transparentBackground: false, maxCount: 1 },
  grok: { baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', imageApiFormat: 'grok_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['jpeg'], transparentBackground: false, maxCount: 4 },
  seedream: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-pro-260628', imageApiFormat: 'seedream_images', sizeOptions: ['2048x2048', '2304x1536', '1536x2304', '2560x1440', '1440x2560', '1024x1024'], outputFormats: ['png', 'jpeg'], transparentBackground: false, maxCount: 4 },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-image-3.0-pro', imageApiFormat: 'qwen_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '1664x928', '928x1664'], outputFormats: ['png'], transparentBackground: false, maxCount: 4 },
  flux: { baseUrl: 'https://api.bfl.ai/v1', model: 'flux-2-pro', imageApiFormat: 'bfl_flux', sizeOptions: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '1920x1088', '1088x1920'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: false, maxCount: 4 },
  custom: { baseUrl: '', model: '', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png'], transparentBackground: false, maxCount: 1 },
  mock: { baseUrl: 'mock://local', model: 'mock-image', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png'], transparentBackground: false, maxCount: 4 },
};

function validSizeOptions(value, fallback) {
  const sizes = Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => /^\d{2,4}x\d{2,4}$/.test(item)) : [];
  return [...new Set(sizes)].slice(0, 20).length ? [...new Set(sizes)].slice(0, 20) : fallback;
}

function imagePreset(provider, modelName = '') {
  const preset = IMAGE_PRESETS[IMAGE_PROVIDERS.has(provider) ? provider : 'openai'];
  return provider === 'qwen' && /^qwen-image-2\.1-(pro|turbo)$/.test(modelName) ? { ...preset, transparentBackground: true } : preset;
}

export function imageApiFormat(model) {
  if (IMAGE_API_FORMATS.has(model?.imageApiFormat)) return model.imageApiFormat;
  if (model?.provider === 'gemini') return 'gemini_interactions';
  if (model?.provider === 'grok') return 'grok_images';
  if (model?.provider === 'seedream') return 'seedream_images';
  if (model?.provider === 'qwen') return 'qwen_images';
  if (model?.provider === 'flux') return 'bfl_flux';
  return 'openai_images';
}

function normalizeImageModel(model) {
  const provider = IMAGE_PROVIDERS.has(model.provider) ? model.provider : 'openai';
  const preset = imagePreset(provider, model.model);
  const protocol = imageApiFormat(model);
  const allowedFormats = protocol === 'qwen_images' ? ['png'] : ['gemini_interactions', 'seedream_images'].includes(protocol) ? ['png', 'jpeg'] : protocol === 'grok_images' ? ['jpeg'] : ['png', 'jpeg', 'webp'];
  const outputFormats = Array.isArray(model.outputFormats)
    ? [...new Set(model.outputFormats.map((item) => String(item).toLowerCase()).filter((item) => allowedFormats.includes(item)))].slice(0, 3)
    : preset.outputFormats.filter(item => allowedFormats.includes(item));
  // 日日新把“是否加水印”“是否自动扩写提示词”当作逐次请求参数，因此这里把
  // 两个开关收敛成模型级默认值（缺失时回落到预设），单次请求仍可覆盖。
  const defaultParams = model.defaultParams && typeof model.defaultParams === 'object' ? { ...model.defaultParams } : {};
  if (provider === 'sensenova') {
    defaultParams.watermark = Boolean(defaultParams.watermark);
    defaultParams.promptExtend = defaultParams.promptExtend === undefined ? true : Boolean(defaultParams.promptExtend);
  } else {
    delete defaultParams.watermark;
    delete defaultParams.promptExtend;
  }
  return {
    ...model,
    provider,
    imageApiFormat: protocol,
    defaultParams,
    sizeOptions: validSizeOptions(model.sizeOptions, preset.sizeOptions),
    outputFormats: outputFormats.length ? outputFormats : [allowedFormats[0]],
    transparentBackground: (protocol === 'openai_images' || (protocol === 'qwen_images' && /^qwen-image-2\.1-(pro|turbo)$/.test(model.model))) && Boolean(model.transparentBackground ?? preset.transparentBackground),
    maxCount: Math.max(1, Math.min(4, Number(model.maxCount) || preset.maxCount)),
  };
}

function hostnameOf(value) {
  try { return new URL(value).hostname; }
  catch { return ''; }
}

// The legacy multimodal API is hosted at api.sensenova.cn and uses the
// /llm/chat-completions route. Token Plan's newer multimodal models (such as
// sensenova-6.8-flash-lite) are OpenAI Chat Completions-compatible and use
// token.sensenova.cn/v1/chat/completions instead.
export function isSenseNovaLegacyVisionEndpoint(value) {
  return /^api\.sensenova\.cn$/i.test(hostnameOf(value));
}

export function isSenseNovaTokenChatEndpoint(value) {
  return /^token\.sensenova\.(?:cn|ai)$/i.test(hostnameOf(value));
}

export function visionApiFormat(model) {
  if (VISION_API_FORMATS.has(model?.apiFormat)) return model.apiFormat;
  // Before apiFormat existed, Dots/askdiandian was the sole Messages-style
  // adapter. Preserve that route while defaulting every other legacy vision
  // configuration to its previous Chat Completions behavior.
  return /(?:^|\.)askdiandian\.com$/i.test(hostnameOf(normalizeBaseUrl(model?.baseUrl)))
    ? 'anthropic_messages'
    : 'chat_completions';
}

export function visionEndpoint(model) {
  const baseUrl = normalizeBaseUrl(model?.baseUrl);
  const format = visionApiFormat(model);
  const pathSuffix = format === 'anthropic_messages' ? '/messages' : format === 'responses' ? '/responses' : '/chat/completions';
  if (baseUrl.toLowerCase().endsWith(pathSuffix)) return baseUrl;
  if (format === 'anthropic_messages' && /(?:^|\.)askdiandian\.com$/i.test(hostnameOf(baseUrl))) return `${baseUrl}/messages`;
  if (format === 'anthropic_messages' && /\/v1$/i.test(baseUrl)) return `${baseUrl}/messages`;
  if (format === 'anthropic_messages') return `${baseUrl}/v1/messages`;
  if (format === 'chat_completions' && isSenseNovaLegacyVisionEndpoint(baseUrl)) return `${baseUrl}/llm/chat-completions`;
  return `${baseUrl}${pathSuffix}`;
}

export function readModels() {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.models = Array.isArray(config.models) ? config.models.map((model) => {
      const baseUrl = normalizeBaseUrl(model.baseUrl);
      // Hand-edited config files may only set the legacy single `apiKey`, and
      // may list masked placeholders; normalise both into one authoritative
      // `apiKeys` array plus the mirrored first entry.
      const keys = modelApiKeys(model);
      const normalized = {
        ...model,
        type: model.type === 'vision' ? 'vision' : 'image',
        baseUrl,
        apiKey: keys[0] || '',
        apiKeys: keys,
        ...(model.type === 'vision' ? { apiFormat: visionApiFormat({ ...model, baseUrl }) } : {}),
      };
      return normalized.type === 'image' ? normalizeImageModel(normalized) : normalized;
    }) : [];
    if (!config.active_vision_model || !config.models.some((model) => model.id === config.active_vision_model && model.type === 'vision')) {
      config.active_vision_model = config.models.find((model) => model.type === 'vision')?.id || '';
    }
    return config;
  }
  catch { return { active_model: '', models: [] }; }
}

export function writeModels(config) {
  // The file holds plaintext API keys, so it is written owner-only. The server
  // is the only reader; the browser only ever sees masks.
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function publicModel(model) {
  const keys = modelApiKeys(model);
  // The browser learns how many keys exist and their positions, never their
  // values. `apiKey` stays for older clients that only know the single field.
  return {
    ...model,
    apiKey: keys.length ? MASKED_API_KEY : '',
    apiKeys: keys.map(() => MASKED_API_KEY),
    apiKeyCount: keys.length,
  };
}

// Merge a submitted key list with what is already stored. A masked entry means
// "unchanged", so the settings form can save a model without re-typing keys it
// was never shown.
function mergeApiKeys(input, existing) {
  const existingKeys = existing ? modelApiKeys(existing) : [];
  const submitted = Array.isArray(input.apiKeys) ? input.apiKeys : null;
  if (!submitted) {
    if (typeof input.apiKey === 'string' && input.apiKey !== MASKED_API_KEY) {
      return input.apiKey.trim() ? [input.apiKey.trim()] : [];
    }
    return existingKeys;
  }
  const merged = [];
  for (const [position, value] of submitted.entries()) {
    const text = String(value ?? '').trim();
    if (text === MASKED_API_KEY) {
      const kept = existingKeys[position];
      if (kept) merged.push(kept);
    } else if (text) {
      merged.push(text);
    }
  }
  return [...new Set(merged)];
}

export function upsertModel(input, modelId) {
  const config = readModels();
  const index = modelId ? config.models.findIndex((item) => item.id === modelId) : -1;
  const existing = index >= 0 ? config.models[index] : null;
  const requestedId = String(input.id || '').trim();
  const type = input.type === 'vision' ? 'vision' : 'image';
  const requestedProvider = IMAGE_PROVIDERS.has(input.provider) ? input.provider : 'openai';
  if (type === 'vision' && ['gemini', 'grok', 'seedream', 'qwen', 'flux'].includes(requestedProvider)) throw Object.assign(new Error('该预设当前仅支持配置为图片生成模型'), { status: 400 });
  const provider = requestedProvider;
  const preset = imagePreset(provider, input.model);
  // 日日新的视觉/对话模型现在统一走 `token.sensenova.cn`（旧的
  // `api.sensenova.cn` 只保留兼容，不再作为新建默认值）。
  const defaultBaseUrl = type === 'vision' ? (provider === 'local' ? 'http://127.0.0.1:1234/v1' : provider === 'sensenova' ? 'https://token.sensenova.cn/v1' : 'https://api.openai.com/v1') : preset.baseUrl;
  const defaultModel = type === 'vision' ? (provider === 'local' ? '' : provider === 'sensenova' ? 'sensenova-6.8-flash' : 'gpt-4.1-mini') : preset.model;
  if (existing && config.active_model === existing.id && type === 'vision') {
    throw Object.assign(new Error('当前默认图片生成模型不能改为视觉识别模型，请先设定另一个图片生成默认模型'), { status: 400 });
  }
  const apiKeys = mergeApiKeys(input, existing);
  const model = {
    // Empty IDs make the workbench fall back to the active model. Always assign
    // a stable ID for newly created models, even when the form submits id: ''.
    id: existing?.id || requestedId || uid(),
    name: String(input.name || '未命名模型'),
    type,
    provider,
    ...(type === 'vision' ? { apiFormat: VISION_API_FORMATS.has(input.apiFormat) ? input.apiFormat : visionApiFormat(existing || input) } : {}),
    baseUrl: normalizeBaseUrl(input.baseUrl || defaultBaseUrl),
    // The legacy single field mirrors the first key so older readers keep
    // working; `apiKeys` is the authoritative list.
    apiKey: apiKeys[0] || '',
    apiKeys,
    model: String(input.model || defaultModel),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : (type === 'vision' ? ['image_understanding'] : ['text_to_image']),
    defaultParams: input.defaultParams && typeof input.defaultParams === 'object' ? input.defaultParams : (type === 'vision' ? {} : { size: preset.sizeOptions[0], count: 1, quality: 'auto', ...(preset.defaultParams || {}) }),
    ...(type === 'image' ? {
      imageApiFormat: IMAGE_API_FORMATS.has(input.imageApiFormat) ? input.imageApiFormat : imageApiFormat(existing || { provider }),
      sizeOptions: validSizeOptions(input.sizeOptions, existing?.sizeOptions || preset.sizeOptions),
      outputFormats: Array.isArray(input.outputFormats) ? input.outputFormats : (existing?.outputFormats || preset.outputFormats),
      transparentBackground: typeof input.transparentBackground === 'boolean' ? input.transparentBackground : (existing?.transparentBackground ?? preset.transparentBackground),
      maxCount: Math.max(1, Math.min(4, Number(input.maxCount) || existing?.maxCount || preset.maxCount)),
    } : {}),
  };
  if (model.type === 'image') Object.assign(model, normalizeImageModel(model));
  if (index >= 0) config.models[index] = model; else config.models.push(model);
  if (model.type === 'vision') {
    if (!config.active_vision_model) config.active_vision_model = model.id;
  } else if (!config.active_model) config.active_model = model.id;
  writeModels(config);
  return publicModel(model);
}

export function removeModel(modelId) {
  const config = readModels();
  config.models = config.models.filter((item) => item.id !== modelId);
  if (config.active_model === modelId) config.active_model = config.models.find((item) => item.type === 'image')?.id ?? '';
  if (config.active_vision_model === modelId) config.active_vision_model = config.models.find((item) => item.type === 'vision')?.id ?? '';
  writeModels(config);
}

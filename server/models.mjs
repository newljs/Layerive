import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_ROOT, uid } from './db.mjs';

const configPath = path.join(CONFIG_ROOT, 'models.json');
mkdirSync(path.dirname(configPath), { recursive: true });

export function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/(?:images\/generations|images\/edits)\/?$/i, '').replace(/\/+$/, '');
}

const VISION_API_FORMATS = new Set(['anthropic_messages', 'chat_completions', 'responses']);
const IMAGE_API_FORMATS = new Set(['openai_images', 'gemini_interactions', 'grok_images']);
const IMAGE_PROVIDERS = new Set(['sensenova', 'openai', 'gemini', 'grok', 'custom', 'mock']);

const IMAGE_PRESETS = {
  sensenova: { baseUrl: 'https://token.sensenova.cn/v1', model: 'sensenova-u1.5-lite', imageApiFormat: 'openai_images', sizeOptions: ['1664x2496', '2496x1664', '1760x2368', '2368x1760', '1824x2272', '2272x1824', '2048x2048', '2752x1536', '1536x2752', '3072x1376', '1344x3136'], outputFormats: ['png'], transparentBackground: false, maxCount: 4 },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: true, maxCount: 4 },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image', imageApiFormat: 'gemini_interactions', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg'], transparentBackground: false, maxCount: 1 },
  grok: { baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', imageApiFormat: 'grok_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['jpeg'], transparentBackground: false, maxCount: 4 },
  custom: { baseUrl: '', model: '', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png'], transparentBackground: false, maxCount: 1 },
  mock: { baseUrl: 'mock://local', model: 'mock-image', imageApiFormat: 'openai_images', sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png'], transparentBackground: false, maxCount: 4 },
};

function validSizeOptions(value, fallback) {
  const sizes = Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => /^\d{2,4}x\d{2,4}$/.test(item)) : [];
  return [...new Set(sizes)].slice(0, 20).length ? [...new Set(sizes)].slice(0, 20) : fallback;
}

function imagePreset(provider) {
  return IMAGE_PRESETS[IMAGE_PROVIDERS.has(provider) ? provider : 'openai'];
}

export function imageApiFormat(model) {
  if (IMAGE_API_FORMATS.has(model?.imageApiFormat)) return model.imageApiFormat;
  if (model?.provider === 'gemini') return 'gemini_interactions';
  if (model?.provider === 'grok') return 'grok_images';
  return 'openai_images';
}

function normalizeImageModel(model) {
  const provider = IMAGE_PROVIDERS.has(model.provider) ? model.provider : 'openai';
  const preset = imagePreset(provider);
  const protocol = imageApiFormat(model);
  const allowedFormats = protocol === 'gemini_interactions' ? ['png', 'jpeg'] : protocol === 'grok_images' ? ['jpeg'] : ['png', 'jpeg', 'webp'];
  const outputFormats = Array.isArray(model.outputFormats)
    ? [...new Set(model.outputFormats.map((item) => String(item).toLowerCase()).filter((item) => allowedFormats.includes(item)))].slice(0, 3)
    : preset.outputFormats;
  return {
    ...model,
    provider,
    imageApiFormat: protocol,
    sizeOptions: validSizeOptions(model.sizeOptions, preset.sizeOptions),
    outputFormats: outputFormats.length ? outputFormats : ['png'],
    transparentBackground: protocol === 'openai_images' && Boolean(model.transparentBackground ?? preset.transparentBackground),
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
      const normalized = {
        ...model,
        type: model.type === 'vision' ? 'vision' : 'image',
        baseUrl,
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
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function publicModel(model) {
  return { ...model, apiKey: model.apiKey ? '••••••••' : '' };
}

export function upsertModel(input, modelId) {
  const config = readModels();
  const index = modelId ? config.models.findIndex((item) => item.id === modelId) : -1;
  const existing = index >= 0 ? config.models[index] : null;
  const requestedId = String(input.id || '').trim();
  const type = input.type === 'vision' ? 'vision' : 'image';
  const requestedProvider = IMAGE_PROVIDERS.has(input.provider) ? input.provider : 'openai';
  if (type === 'vision' && ['gemini', 'grok'].includes(requestedProvider)) throw Object.assign(new Error('Gemini 和 Grok 当前仅支持配置为图片生成模型'), { status: 400 });
  const provider = requestedProvider;
  const preset = imagePreset(provider);
  const defaultBaseUrl = type === 'vision' ? (provider === 'sensenova' ? 'https://api.sensenova.cn/v1' : 'https://api.openai.com/v1') : preset.baseUrl;
  const defaultModel = type === 'vision' ? (provider === 'sensenova' ? 'SenseChat-V6.5' : 'gpt-4.1-mini') : preset.model;
  if (existing && config.active_model === existing.id && type === 'vision') {
    throw Object.assign(new Error('当前默认图片生成模型不能改为视觉识别模型，请先设定另一个图片生成默认模型'), { status: 400 });
  }
  const model = {
    // Empty IDs make the workbench fall back to the active model. Always assign
    // a stable ID for newly created models, even when the form submits id: ''.
    id: existing?.id || requestedId || uid(),
    name: String(input.name || '未命名模型'),
    type,
    provider,
    ...(type === 'vision' ? { apiFormat: VISION_API_FORMATS.has(input.apiFormat) ? input.apiFormat : visionApiFormat(existing || input) } : {}),
    baseUrl: normalizeBaseUrl(input.baseUrl || defaultBaseUrl),
    apiKey: input.apiKey === '••••••••' ? existing?.apiKey ?? '' : String(input.apiKey || ''),
    model: String(input.model || defaultModel),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : (type === 'vision' ? ['image_understanding'] : ['text_to_image']),
    defaultParams: input.defaultParams && typeof input.defaultParams === 'object' ? input.defaultParams : (type === 'vision' ? {} : { size: preset.sizeOptions[0], count: 1, quality: 'auto' }),
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

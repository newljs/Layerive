import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { APP_ROOT, uid } from './db.mjs';

const configPath = path.join(APP_ROOT, 'config', 'models.json');
mkdirSync(path.dirname(configPath), { recursive: true });

export function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/(?:images\/generations|images\/edits)\/?$/i, '').replace(/\/+$/, '');
}

export function readModels() {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.models = Array.isArray(config.models) ? config.models.map((model) => {
      const baseUrl = normalizeBaseUrl(model.baseUrl);
       const isSenseNova = model.provider === 'sensenova' || /(?:^|[/.])sensenova\.cn(?:[/:]|$)/i.test(baseUrl);
       const isGemini = model.provider === 'gemini' || /(?:^|\.)generativelanguage\.googleapis\.com$/i.test(new URL(baseUrl).hostname);
       const isGrok = model.provider === 'grok' || /(?:^|\.)x\.ai$/i.test(new URL(baseUrl).hostname);
      return {
        ...model,
        type: model.type === 'vision' ? 'vision' : 'image',
         provider: isSenseNova ? 'sensenova' : isGemini ? 'gemini' : isGrok ? 'grok' : 'openai',
        baseUrl,
      };
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
  const requestedProvider = ['sensenova', 'openai', 'gemini', 'grok'].includes(input.provider) ? input.provider : 'openai';
  if (type === 'vision' && ['gemini', 'grok'].includes(requestedProvider)) throw Object.assign(new Error('Gemini 和 Grok 当前仅支持配置为图片生成模型'), { status: 400 });
  const provider = requestedProvider;
  const defaultBaseUrl = provider === 'sensenova' ? (type === 'vision' ? 'https://api.sensenova.cn/v1' : 'https://token.sensenova.cn/v1') : provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
  const defaultModel = type === 'vision' ? (provider === 'sensenova' ? 'SenseChat-V6.5' : 'gpt-4.1-mini') : provider === 'sensenova' ? 'sensenova-u1.5-lite' : provider === 'gemini' ? 'gemini-3.1-flash-image' : provider === 'grok' ? 'grok-imagine-image-2.0' : 'gpt-image-2';
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
    baseUrl: normalizeBaseUrl(input.baseUrl || defaultBaseUrl),
    apiKey: input.apiKey === '••••••••' ? existing?.apiKey ?? '' : String(input.apiKey || ''),
    model: String(input.model || defaultModel),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : (type === 'vision' ? ['image_understanding'] : ['text_to_image']),
    defaultParams: input.defaultParams && typeof input.defaultParams === 'object' ? input.defaultParams : (type === 'vision' ? {} : { size: '2048x2048', count: 1, quality: 'auto' }),
  };
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
  if (config.active_model === modelId) config.active_model = config.models[0]?.id ?? '';
  if (config.active_vision_model === modelId) config.active_vision_model = config.models.find((item) => item.type === 'vision')?.id ?? '';
  writeModels(config);
}

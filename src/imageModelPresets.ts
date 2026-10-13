import type { ModelConfig } from './types';

export const NATIVE_IMAGE_PRESETS = {
  seedream: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'seedream_images',
    models: [
      { id: 'doubao-seedream-5-0-pro-260628', label: 'Seedream 5.0 Pro' },
      { id: 'doubao-seedream-5-0-flash-260915', label: 'Seedream 5.0 Flash' },
    ],
    sizes: ['2048x2048', '2304x1536', '1536x2304', '2560x1440', '1440x2560', '1024x1024'], formats: ['png', 'jpeg'],
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'qwen_images',
    models: [
      { id: 'qwen-image-3.0-pro', label: 'Qwen-Image 3.0 Pro' },
      { id: 'qwen-image-3.0', label: 'Qwen-Image 3.0' },
      { id: 'qwen-image-2.1-pro', label: 'Qwen-Image 2.1 Pro' },
      { id: 'qwen-image-2.1-turbo', label: 'Qwen-Image 2.1 Turbo' },
    ],
    sizes: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '1664x928', '928x1664'], formats: ['png'],
  },
  flux: {
    baseUrl: 'https://api.bfl.ai/v1', protocol: 'bfl_flux',
    models: [{ id: 'flux-2-pro', label: 'FLUX.2 Pro' }],
    sizes: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '1920x1088', '1088x1920'], formats: ['png', 'jpeg', 'webp'],
  },
} as const;

export function nativeImagePreset(provider: ModelConfig['provider']) {
  return provider === 'seedream' || provider === 'qwen' || provider === 'flux' ? NATIVE_IMAGE_PRESETS[provider] : undefined;
}

export function supportsTransparentProtocol(protocol: ModelConfig['imageApiFormat'], model: string) {
  return protocol === 'openai_images' || (protocol === 'qwen_images' && /^qwen-image-2\.1-(pro|turbo)$/.test(model));
}

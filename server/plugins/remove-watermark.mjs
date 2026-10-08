// Trusted built-in operation; model requests and persistence belong to the host.
import catalog from './catalog.json' with { type: 'json' };
function create(host, input) {
  const { projectId, readModels, visionModelOrThrow, imageOrThrow } = host;
  const config = readModels();
  const visionModel = visionModelOrThrow(config, input.visionModelId);
  const image = imageOrThrow(projectId, input.imageId);
  return host.generation({ prompt: '识别并去除图片中的覆盖式水印', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: input.params || {} }, { visionModel });
}

async function prepare(host, image, { visionModel }) {
  const { projectId, taskId, signal, callVision, parseVisionJson, httpError } = host;
  const analysis = await callVision(visionModel, image, `分析图片中是否存在覆盖在画面上的水印、平台标识、半透明文字或重复 logo。不要把画面本身的招牌、产品 logo、海报正文或自然出现的文字当成水印。若存在水印，描述每个水印的精确位置、范围、形状、透明度、颜色、文字和它遮挡的背景内容，并生成一条供图片编辑模型使用的中文修复提示词。修复时只移除水印并自然补全其遮挡区域，必须完整保留人物、主体、产品、原有设计文字、构图、风格、光影、颜色和尺寸。返回严格 JSON：{"has_watermark":true,"watermarks":[{"location":"...","appearance":"...","coverage":"..."}],"edit_prompt":"..."}。不要返回 Markdown。`, signal, { projectId, taskId, operationType: 'remove_watermark', phase: '水印识别与修复规划' });
  const planned = parseVisionJson(analysis);
  const watermarks = Array.isArray(planned.watermarks) ? planned.watermarks : [];
  if (planned.has_watermark === false || !watermarks.length) {
    throw httpError(400, 'watermark.notFound', '视觉识别模型未发现可移除的水印；请确认当前图片是否包含覆盖式水印。');
  }
  const locations = watermarks.map((item) => String(item.location || item.coverage || item.appearance || '').trim()).filter(Boolean).join('；');
  const fallback = `移除图片中覆盖在画面上的水印${locations ? `（位置：${locations}）` : ''}，仅修复水印所遮挡的区域并自然补全背景纹理、边缘和细节。严格保留人物、主体、产品、原有设计文字、构图、风格、光影、颜色和图片尺寸；不要删除画面本身的招牌、产品 logo、海报正文或其他非水印文字。`;
  const prompt = `${String(planned.edit_prompt || planned.prompt || fallback).trim()}\n严格约束：只移除经视觉识别确认的覆盖式水印并修复其遮挡区域；其余画面不得改动。`;
  return { image, prompt };
}

export default {
  ...catalog.find(plugin => plugin.operation === 'remove_watermark'),
  create, prepare,
  taskInput: state => ({ stage: 'planning', visionModelId: state.visionModel.id }),
};

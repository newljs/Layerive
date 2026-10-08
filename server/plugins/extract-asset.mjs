// Built-in plugin: no database, filesystem paths, credentials or provider protocols.
import { extractionLabels, extractionModes, extractionPlanningInstruction, extractionRules } from '../extraction.mjs';
import { validateRect } from '../local-edit.mjs';
import { readImageDimensions } from '../png.mjs';
import catalog from './catalog.json' with { type: 'json' };

async function create(host, input) {
  const { projectId, imageOrThrow, readModels, visionModelOrThrow, httpError, ensureUploadVersion } = host;
  const mode = input.mode ?? 'selection';
  if (!extractionModes.includes(mode)) throw httpError(400, 'extract.invalidMode', '请选择有效的提取场景');
  const hint = String(input.hint || '').trim();
  if (hint.length > 1000) throw httpError(400, 'extract.hintTooLong', '补充说明不能超过 1000 字符');
  const config = readModels();
  const visionModel = visionModelOrThrow(config, input.visionModelId);
  const model = config.models.find(item => item.id === (input.modelId || config.active_model));
  if (!model || model.type === 'vision' || !model.capabilities.includes('edit_prompt')) throw httpError(400, 'model.unsupportedOperation', '当前模型不支持这个操作');
  const sourceImage = imageOrThrow(projectId, input.imageId);
  const rawRect = input.rect;
  if (!rawRect || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rawRect[key])))) {
    throw httpError(400, 'extract.requireRect', '请先在图片上框选要提取的内容');
  }
  const rect = validateRect(Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(rawRect[key])])));
  if (rect.width < 2 || rect.height < 2) throw httpError(400, 'localEdit.rectTooSmall', '框选区域太小，请重新框选');
  const cropMime = String(input.crop?.mimeType || 'image/png');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(cropMime)) throw httpError(400, 'extract.cropUnsupported', '截图格式仅支持 PNG、JPG 和 WebP');
  const encoded = String(input.crop?.data || '').replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw httpError(400, 'extract.cropTooLarge', '截图不能为空且不能超过 10MB');
  const dimensions = readImageDimensions(bytes, cropMime);
  if (!dimensions) throw httpError(400, 'extract.cropUnreadable', '无法读取截图内容，请重新框选');

  const cropImage = await host.saveExtractMaterial(bytes, cropMime, dimensions);

  const source = ensureUploadVersion(projectId, sourceImage);
  return host.generation({ prompt: extractionLabels[mode] + (hint ? '：' + hint : ''), operation: 'extract_asset', modelId: input.modelId, inputImageId: cropImage.id, parentVersionId: input.parentVersionId || source.version_id || null, params: { ...input.params, transparent: false } }, { mode, rect, hint, padded: Boolean(input.crop?.padded), visionModel, source });
}

async function prepare(host, inputImage, extraction) {
  const { projectId, taskId, signal, httpError, callVision, parseVisionJson, updateTaskInput } = host;
  const operation = 'extract_asset';
  const planned = parseVisionJson(await callVision(extraction.visionModel, inputImage, extractionPlanningInstruction(extraction), signal, { projectId, taskId, operationType: operation, phase: '素材识别与提示词规划' }));
  signal.throwIfAborted();
  if (planned?.applicable === false) throw httpError(422, 'extract.notApplicable', '无法确定当前场景的提取目标，请重新框选或补充说明');
  const subject = String(planned?.subject || '').trim();
  const editPrompt = String(planned?.edit_prompt || planned?.prompt || '').trim();
  if (!subject || !editPrompt) throw httpError(422, 'extract.invalidPlan', '视觉模型未返回有效的提取目标和提示词，请重试');
  const effectivePrompt = editPrompt + '\n提取目标：' + subject + '\n当前场景：' + extractionLabels[extraction.mode] + '。严格约束：' + extractionRules(extraction.mode);
  updateTaskInput(taskId, { stage: 'generating', effectivePrompt, extraction: { mode: extraction.mode, rect: extraction.rect, hint: extraction.hint, visionModelId: extraction.visionModel.id, subject } });
  return { image: inputImage, prompt: effectivePrompt, inputs: [{ imageId: extraction.source.id, role: 'original' }] };
}

export default {
  ...catalog.find(plugin => plugin.operation === 'extract_asset'),
  create,
  taskInput: state => ({ stage: 'planning', extraction: { mode: state.mode, rect: state.rect, hint: state.hint, visionModelId: state.visionModel.id } }),
  prepare,
};

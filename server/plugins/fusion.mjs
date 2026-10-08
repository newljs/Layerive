// Built-in plugin: no database, filesystem paths, credentials or provider protocols.
import { fusionEditPrompt, fusionModes, fusionPlanningInstruction, validateFusionInput, validateFusionPlan } from '../fusion.mjs';
import { normalizeLocalImage } from '../local-edit.mjs';
import catalog from './catalog.json' with { type: 'json' };

async function create(host, input) {
  const { projectId, imageOrThrow, readModels, visionModelOrThrow, hasModelCredentials, httpError } = host;
  const settings = validateFusionInput(input);
  const source = imageOrThrow(projectId, input.imageId);
  if (!input.referenceImageId) throw httpError(400, 'fusion.referenceRequired', '请先添加并拖入一张融合参考图');
  const reference = imageOrThrow(projectId, input.referenceImageId);
  if (reference.id === source.id) throw httpError(400, 'fusion.sameImage', '请选择与主图不同的参考图');
  const visionModel = visionModelOrThrow(readModels(), input.visionModelId);
  if (!hasModelCredentials(visionModel)) throw httpError(400, 'vision.missingApiKey', '请先配置视觉识别模型的 API Key');
  return host.generation({
    prompt: `${fusionModes[settings.mode]}：参考图拖放到主图 (${settings.point.x.toFixed(1)}%, ${settings.point.y.toFixed(1)}%)${settings.instruction ? '；' + settings.instruction : ''}`,
    operation: 'fusion', modelId: input.modelId, inputImageId: source.id,
    parentVersionId: source.version_id || null,
    params: { ...(input.params || {}), count: 1, transparent: false },
  }, { ...settings, reference, visionModel });
}

async function prepare(host, sourceImage, fusion) {
  const { projectId, taskId, signal, callVision, parseVisionJson, updateTaskInput, providerInputBytes } = host;
  signal.throwIfAborted();
  const source = await normalizeLocalImage(await providerInputBytes(sourceImage));
  const reference = await normalizeLocalImage(await providerInputBytes(fusion.reference), true);
  signal.throwIfAborted();
  const plan = validateFusionPlan(parseVisionJson(await callVision(fusion.visionModel, [source, reference], fusionPlanningInstruction(fusion), signal, { projectId, taskId, operationType: 'fusion', phase: '融合意图与落点识别' })));
  signal.throwIfAborted();
  const prompt = fusionEditPrompt(plan, fusion);
  updateTaskInput(taskId, { stage: 'generating', effectivePrompt: prompt, fusion: { mode: fusion.mode, point: fusion.point, instruction: fusion.instruction, referenceImageId: fusion.reference.id, visionModelId: fusion.visionModel.id, intent: plan.intent } });
  return { prompt, image: { ...source, referenceImages: [reference] }, inputs: [{ imageId: fusion.reference.id, role: 'fusion_reference' }] };
}


export default {
  ...catalog.find(plugin => plugin.operation === 'fusion'),
  create,
  taskInput: state => ({ stage: 'planning', fusion: { mode: state.mode, point: state.point, instruction: state.instruction, referenceImageId: state.reference.id, visionModelId: state.visionModel.id } }),
  prepare,
};

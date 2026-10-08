// Trusted built-in operation; model requests and persistence belong to the host.
import catalog from './catalog.json' with { type: 'json' };
import sharp from 'sharp';
function create(host, input) {
  const { projectId, readModels, visionModelOrThrow, imageOrThrow, imageOptions, httpError } = host;
  const config = readModels();
  const image = imageOrThrow(projectId, input.imageId);
  const visionModel = visionModelOrThrow(config, input.visionModelId);
  const requestedModelId = String(input.modelId || '').trim();
  const model = config.models.find((item) => item.id === (requestedModelId || config.active_model));
  if (!model || model.type === 'vision') throw httpError(400, 'model.imageRequired', '请选择有效的图片生成模型');
  const options = imageOptions(model);
  if (!model.capabilities.includes('edit_prompt')) throw httpError(400, 'model.noEditPrompt', '当前模型不支持提示词改图');
  if (!options.transparent || !options.formats.includes('png')) {
    throw httpError(400, 'backgroundRemoval.requiresTransparentModel', '当前图片模型不支持透明 PNG，请切换到已启用透明背景能力的图片模型');
  }
  return host.generation({
    prompt: '智能去除背景并保留图片中的主要人物或物体',
    operation: 'remove_background',
    modelId: model.id,
    inputImageId: image.id,
    parentVersionId: input.parentVersionId || image.version_id || null,
    params: { ...(input.params || {}), count: 1, outputFormat: 'png', transparent: true },
  }, { visionModel });
}

async function prepare(host, image, { visionModel }) {
  const { projectId, taskId, signal, parseVisionJson, callVision, httpError } = host;
  const instruction = `判断用户一键去除背景时最可能希望保留的主要人物或物体，并为透明背景抠图生成编辑提示词。
判断原则：
1. 综合主体面积、画面中心位置、清晰度、视觉显著性、前景层级以及人物/动物/物体之间的动作和叙事关系，不要简单地保留画面中的所有生物。
2. 彼此明显互动、共同构成主要事件的对象应作为一个主体组保留。例如，一个人牵着一条狗且二者占据主要画面，应同时保留人、狗、牵引绳以及二者必要的接触细节。
3. 若一个女人在街上占据主要画面，而背景中只有几只很小、模糊或无互动的狗，应只保留女人，把小狗、街道、建筑、行人和其他环境视为背景。
4. 产品图、食物、车辆、家具或组合物同理：保留构成主要展示对象的完整物体和必要附件；排除陪衬、远景、装饰、地面、墙面、天空、阴影和无关文字。
5. 保持被保留主体的身份、面部、毛发、衣物、姿态、比例、颜色、纹理、边缘细节及相互遮挡关系完全忠于原图。不得新增、替换、重绘或美化主体。
6. 最终画布尺寸和主体位置不变，背景必须完全透明；主体边缘应干净自然，细发、毛发、半透明薄纱和孔洞要保留真实 Alpha，不得出现白边、黑边、色边、棋盘格、纯色底、残留景物或水印。
请给出最可能的单一判断。只有图片中完全没有可识别的前景主体时才返回 error。
返回严格 JSON：{"keep_subjects":["要保留的主体及必要附件"],"discard_as_background":["应排除的陪衬或环境"],"reason":"简短说明主体判断依据","confidence":0到1,"edit_prompt":"供图片编辑模型使用的完整中文抠图提示词"}。不要返回 Markdown。`;
  const planned = parseVisionJson(await callVision(visionModel, image, instruction, signal, { projectId, taskId, operationType: 'remove_background', phase: '主要主体识别与透明背景规划' }));
  signal.throwIfAborted();
  const keepSubjects = (Array.isArray(planned.keep_subjects) ? planned.keep_subjects : [planned.keep_subjects || planned.subject])
    .map((item) => String(item || '').trim()).filter(Boolean);
  if (planned.error || !keepSubjects.length) {
    throw httpError(422, 'backgroundRemoval.noSubject', '视觉模型无法可靠识别需要保留的主要主体，请换一张主体更明确的图片后重试');
  }
  const discarded = (Array.isArray(planned.discard_as_background) ? planned.discard_as_background : [planned.discard_as_background])
    .map((item) => String(item || '').trim()).filter(Boolean);
  const fallback = `只保留${keepSubjects.join('、')}，完整移除${discarded.length ? discarded.join('、') : '其余背景和陪衬元素'}并将这些区域设为完全透明。严格保持主体的身份、外观、姿态、比例、颜色、纹理、细节、位置和画布尺寸不变。精细处理头发、毛发、衣物边缘、孔洞和半透明材质，不得出现白边、黑边、色边、棋盘格、纯色底或残留背景。`;
  const editPrompt = String(planned.edit_prompt || planned.prompt || fallback).trim();
  const plan = {
    keepSubjects,
    discarded,
    reason: String(planned.reason || '').trim(),
    confidence: Number.isFinite(Number(planned.confidence)) ? Math.min(1, Math.max(0, Number(planned.confidence))) : null,
    editPrompt: `${editPrompt}\n硬性要求：最终输出必须是带真实 Alpha 通道的透明背景 PNG；只保留已识别的主要主体组，不保留其他环境或陪衬；不得改变主体本身、主体位置、构图或画布尺寸。`,
  };
  host.updateTask({ backgroundRemoval: { visionModelId: visionModel.id, keepSubjects: plan.keepSubjects, discarded: plan.discarded, reason: plan.reason, confidence: plan.confidence } });
  return { image, prompt: plan.editPrompt };
}

async function processOutput(host, _prepared, output) {
  const { httpError } = host;
  host.updateTask({ stage: 'validating' });
  let raw;
  try {
    raw = await sharp(output.bytes, { failOn: 'error' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw httpError(422, 'backgroundRemoval.invalidOutput', '图片模型返回的结果无法解析为透明 PNG，请重试或更换图片模型');
  }
  const channels = raw.info.channels;
  const pixels = raw.info.width * raw.info.height;
  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let offset = channels - 1; offset < raw.data.length; offset += channels) {
    const alpha = raw.data[offset];
    if (alpha < 250) transparentPixels += 1;
    if (alpha > 5) visiblePixels += 1;
  }
  if (transparentPixels / pixels < 0.005 || visiblePixels / pixels < 0.005) {
    throw httpError(422, 'backgroundRemoval.invalidOutput', '图片模型没有返回有效的透明主体图，请重试或更换支持透明背景的图片模型');
  }
  const bytes = await sharp(raw.data, { raw: raw.info }).png().toBuffer();
  return { ...output, bytes, mimeType: 'image/png', width: raw.info.width, height: raw.info.height };
}

export default {
  ...catalog.find(plugin => plugin.operation === 'remove_background'),
  create, prepare, processOutput,
  taskInput: state => ({ stage: 'planning', backgroundRemoval: { visionModelId: state.visionModel.id } }),
  generationPhase: '去除背景并生成透明 PNG',
};

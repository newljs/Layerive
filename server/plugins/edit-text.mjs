// Trusted built-in operation; model requests and persistence belong to the host.
import catalog from './catalog.json' with { type: 'json' };
function create(host, input) {
  const { projectId, readModels, visionModelOrThrow, imageOrThrow, httpError } = host;
  const config = readModels();
  const visionModel = visionModelOrThrow(config, input.visionModelId);
  const image = imageOrThrow(projectId, input.imageId);
  // Manual boxes have no recognized original text; they describe an addition
  // or a replacement at a hand-drawn region, so accept them without one.
  const changed = (Array.isArray(input.segments) ? input.segments : []).map((item) => {
    const rawRect = item.rect;
    const rect = rawRect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rawRect[key])))
      ? Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.min(100, Math.max(0, Number(rawRect[key])))]))
      : null;
    return { originalText: String(item.originalText || '').trim(), text: String(item.text || '').trim(), context: String(item.context || '').trim(), manual: Boolean(item.manual), rect };
  }).filter((item) => item.originalText !== item.text && (item.originalText || (item.manual && item.text)));
  if (!changed.length) throw httpError(400, 'text.noChanges', '请先修改或删除至少一段文字，或框选一个区域再提交');
  const rectDescription = (rect) => rect
    ? `框选区域为整张图片的 x=${rect.x.toFixed(1)}%、y=${rect.y.toFixed(1)}%、宽=${rect.width.toFixed(1)}%、高=${rect.height.toFixed(1)}%`
    : '';
  const changeList = changed.map((item, index) => item.originalText
    ? item.text
      ? `${index + 1}. 将“${item.originalText}”替换为“${item.text}”（位置与样式：${[item.context || '保持原区域', rectDescription(item.rect)].filter(Boolean).join('；')}）`
      : `${index + 1}. 删除文字“${item.originalText}”，并自然修复文字覆盖的背景（位置与样式：${[item.context || '保持原区域', rectDescription(item.rect)].filter(Boolean).join('；')}）`
    : `${index + 1}. 在 ${[item.context || '指定区域', rectDescription(item.rect)].filter(Boolean).join('；')} 添加文字“${item.text}”，样式与周围内容协调`)
    .join('\n');
  const coordinateConstraints = changed.map((item) => rectDescription(item.rect)).filter(Boolean).join('；');
  const textEdit = host.textRecognitionSnapshot(visionModel, input.segments);
  return host.generation({ prompt: changeList, modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: input.params || {} }, { visionModel, changeList, coordinateConstraints, textEdit });
}

async function prepare(host, image, { visionModel, changeList, coordinateConstraints, textEdit }) {
  const { projectId, taskId, signal, callVision, parseVisionJson } = host;
  const planning = await callVision(visionModel, image, `根据图片内容和下面的文字替换项，为图片编辑模型生成一条准确中文提示词。只允许修改列出的文字，必须保留其他文字以及人物、背景、构图、配色、风格、尺寸和物体不变；新文字需要保持原位置、层级、字体风格、字号和颜色，除非替换文本长度导致微小的排版调整。若替换项给出框选区域，必须在 edit_prompt 中保留该精确区域约束，禁止改动框外内容。返回严格 JSON：{"edit_prompt":"..."}。\n替换项：\n${changeList}`, signal, { projectId, taskId, operationType: 'edit_text', phase: '改字提示词规划' });
  const planned = parseVisionJson(planning);
  const fallback = `仅修改以下图片文字，其他所有画面元素、文字、构图、人物、背景、色彩、风格与尺寸均保持不变。${changeList}`;
  const prompt = `${String(planned.edit_prompt || planned.prompt || fallback).trim()}${coordinateConstraints ? `\n精确区域约束：${coordinateConstraints}。框外内容不得改动。` : ''}`;
  return { image, prompt, outputMetadata: { textRecognition: textEdit } };
}

export default {
  ...catalog.find(plugin => plugin.operation === 'edit_text'),
  create, prepare,
  taskInput: state => ({ stage: 'planning', textEdit: state.textEdit }),
};

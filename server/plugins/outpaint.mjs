// Trusted built-in operation; model requests and persistence belong to the host.
import catalog from './catalog.json' with { type: 'json' };
function create(host, input) {
  const { projectId, imageOrThrow, httpError } = host;
  const image = imageOrThrow(projectId, input.imageId);
  const size = String(input.size || '').trim();
  if (!/^\d{2,4}x\d{2,4}$/.test(size)) throw httpError(400, 'outpaint.invalidSize', '请选择有效的扩图目标尺寸');
  const [width, height] = size.split('x').map(Number);
  if (width < 256 || height < 256 || width > 4096 || height > 4096) throw httpError(400, 'outpaint.sizeOutOfRange', '扩图目标尺寸不在允许范围内');
  const direction = width / height > (image.width || width) / (image.height || height) ? '向左右扩展画面' : width / height < (image.width || width) / (image.height || height) ? '向上下扩展画面' : '向四周自然补全画面';
  const prompt = `以输入图片为核心，${direction}，将最终画布扩展为 ${size}。必须完整保留原图中已有的人物、主体、文字、物体、构图、细节、风格、光影与颜色，不得裁切、重绘或改变原图内容；仅在新增的画布区域自然延展背景、场景、纹理和必要元素，使边缘无缝衔接、透视与光线一致。不要添加不相关的新主体、文字、水印或边框。`;
  return host.generation({ prompt, operation: 'outpaint', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: { ...(input.params || {}), size } }, { prompt });
}

export default {
  ...catalog.find(plugin => plugin.operation === 'outpaint'),
  create,
  taskInput: () => ({ stage: 'generating' }),
  prepare: async (_host, image, state) => ({ image, prompt: state.prompt }),
};

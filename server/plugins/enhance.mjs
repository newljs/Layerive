// Trusted built-in operation; model requests and persistence belong to the host.
import catalog from './catalog.json' with { type: 'json' };
function create(host, input) {
  const { projectId, imageOrThrow } = host;
  const image = imageOrThrow(projectId, input.imageId);
  const prompt = '将输入图片增强为更清晰、更精细的高清版本。提升主体边缘、纹理、细节、对焦感与整体清晰度，同时自然抑制压缩噪点、模糊和锯齿。严格保持原图的主体、人物特征、文字内容、构图、比例、颜色、光影、风格和所有已有元素不变；不要裁切、添加、删除、替换或重绘画面内容。';
  return host.generation({ prompt, operation: 'enhance', modelId: input.modelId, inputImageId: image.id, parentVersionId: input.parentVersionId || image.version_id || null, params: input.params || {} }, { prompt });
}

export default {
  ...catalog.find(plugin => plugin.operation === 'enhance'),
  create,
  taskInput: () => ({ stage: 'generating' }),
  prepare: async (_host, image, state) => ({ image, prompt: state.prompt }),
};

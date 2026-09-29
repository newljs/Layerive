export type ModelConfig = {
  id: string;
  name: string;
  type: 'image' | 'vision';
  /** A preset only: it supplies sensible defaults and provider-specific UI copy. */
  provider: 'sensenova' | 'openai' | 'gemini' | 'grok' | 'custom';
  /** The image request/response protocol, independent from the preset. */
  imageApiFormat?: 'openai_images' | 'gemini_interactions' | 'grok_images';
  apiFormat?: 'anthropic_messages' | 'chat_completions' | 'responses';
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities: string[];
  defaultParams: { size?: string; count?: number; quality?: string };
  /** Per-model workspace options. Older saved models receive preset defaults. */
  sizeOptions?: string[];
  outputFormats?: Array<'png' | 'jpeg' | 'webp'>;
  transparentBackground?: boolean;
  maxCount?: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  coverImageId: string | null;
  coverUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  defaultModelId: string | null;
  currentVersionId: string | null;
  currentImageId: string | null;
  draft: Record<string, unknown>;
  isFavorite: boolean;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectImage = {
  id: string;
  projectId: string;
  versionId: string | null;
  taskId: string | null;
  sourceType: 'upload' | 'generated' | 'edited' | 'mask' | 'extract' | 'local_reference' | 'local_composite';
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  createdAt: string;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: string;
  content: {
    text?: string;
    prompt?: string;
    prompts?: string[];
    /** Legacy messages created by the removed manual toggle. */
    splitPrompts?: boolean;
    promptMode?: 'auto' | 'same' | 'different';
    operation?: string;
    inputImageId?: string | null;
    outputImageIds?: string[];
    modelName?: string;
    versionId?: string;
    versionNumber?: number;
    message?: string;
    params?: Record<string, unknown>;
    /** 服务端持久化消息的稳定码（msg.* 字典），历史消息可能缺失；params 复用为插值参数。 */
    code?: string;
    batch?: { variableName?: string; variableNames?: string[]; values?: string[]; variables?: Array<{ name: string; values: string[] }>; prompts?: string[]; local?: boolean; completed?: number; failed?: number; canceled?: boolean };
  };
  createdAt: string;
};

export type Version = {
  id: string;
  number: number;
  operation: string;
  parentVersionId: string | null;
  selectedImageId: string | null;
  status: string;
  outputs: ProjectImage[];
  inputs: ProjectImage[];
  createdAt: string;
};

export type ProjectBundle = {
  project: Project;
  messages: Message[];
  versions: Version[];
  images: ProjectImage[];
};

export type ModelsPayload = { activeModel: string; activeVisionModel: string; models: ModelConfig[] };

export type TextSegment = {
  id: string;
  text: string;
  originalText: string;
  context: string;
  manual?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
};

export type GenerationTask = {
  id: string;
  status: 'generating' | 'success' | 'partial' | 'failed' | 'canceled';
  operationType?: string;
  stage?: 'planning' | 'compositing' | 'generating' | 'preserving' | null;
  error: string | null;
  /** 服务端错误码（error_json.code），配合 msg.* 字典本地化。 */
  errorCode?: string | null;
  errorParams?: Record<string, string | number> | null;
  createdAt: string;
  finishedAt: string | null;
};

export type ModelExecutionLog = {
  id: string;
  taskId: string | null;
  modelId: string;
  modelName: string;
  modelType: 'image' | 'vision' | string;
  operationType: string;
  phase: string;
  status: 'running' | 'success' | 'failed' | 'canceled';
  prompt: string;
  generatedPrompt: string;
  request: Record<string, unknown>;
  response: Record<string, unknown> | string | null;
  reasoning: string;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type LocalEditReference = { data: string; mimeType: string; name?: string };

export type GenerateResult = { taskId: string; status: string; userMessageId: string };

export type BatchEditItem = {
  index: number;
  values: Record<string, string>;
  status: 'pending' | 'generating' | 'success' | 'failed' | 'canceled';
  image: ProjectImage | null;
  error: string | null;
  durationMs: number | null;
};

export type BatchEditProgress = {
  id: string;
  status: 'generating' | 'success' | 'partial' | 'failed' | 'canceled';
  versionId: string | null;
  versionNumber: number | null;
  localEdit?: boolean;
  /** 批量文生图任务（无参考图）标记，用于区分文案。 */
  textBatch?: boolean;
  template: string;
  variableNames: string[];
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  currentIndex: number | null;
  estimatedRemainingSeconds: number | null;
  items: BatchEditItem[];
  error: string | null;
  errorCode?: string | null;
  errorParams?: Record<string, string | number> | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BatchEditResult = GenerateResult & { versionId: string };

export type GalleryEntryItem = {
  id: string;
  title: string;
  category: string;
  prompt: string;
  stylePrompt: string;
  image: string | null;
  source: 'manual' | 'project' | string;
  createdAt: string;
  updatedAt: string;
};

export type ModelConfig = {
  id: string;
  name: string;
  type: 'image' | 'vision';
  provider: 'sensenova' | 'openai' | 'gemini' | 'grok';
  apiFormat?: 'anthropic_messages' | 'chat_completions' | 'responses';
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities: string[];
  defaultParams: { size?: string; count?: number; quality?: string };
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
    batch?: { variableName?: string; variableNames?: string[]; values?: string[]; variables?: Array<{ name: string; values: string[] }>; completed?: number; failed?: number; canceled?: boolean };
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
  status: 'generating' | 'success' | 'failed' | 'canceled';
  operationType?: string;
  stage?: 'planning' | 'compositing' | 'generating' | 'preserving' | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
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

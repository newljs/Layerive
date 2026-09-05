export type ModelConfig = {
  id: string;
  name: string;
  type: 'image' | 'vision';
  provider: 'sensenova' | 'openai' | 'gemini' | 'grok';
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
  sourceType: 'upload' | 'generated' | 'edited' | 'mask' | 'extract';
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
    operation?: string;
    inputImageId?: string | null;
    outputImageIds?: string[];
    modelName?: string;
    versionId?: string;
    versionNumber?: number;
    message?: string;
    params?: Record<string, unknown>;
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
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type GenerateResult = { taskId: string; status: string; userMessageId: string };

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

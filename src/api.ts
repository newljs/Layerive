import type { GenerateResult, GenerationTask, ModelConfig, ModelsPayload, Project, ProjectBundle, ProjectImage, TextSegment } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload as T;
}

async function readFileAsBase64(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

function downloadFile(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export const api = {
  listProjects: () => request<{ projects: Project[] }>('/api/projects'),
  createProject: (input: { name: string; description?: string; defaultModelId?: string }) =>
    request<ProjectBundle>('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
  getProject: (id: string) => request<ProjectBundle>(`/api/projects/${id}`),
  updateProject: (id: string, input: Record<string, unknown>) =>
    request<ProjectBundle>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) => request<ProjectBundle>(`/api/projects/${id}/duplicate`, { method: 'POST' }),
  exportProject: (id: string) => downloadFile(`/api/projects/${id}/export`),
  importProject: async (file: File) => {
    const data = await readFileAsBase64(file);
    return request<ProjectBundle>('/api/projects/import', { method: 'POST', body: JSON.stringify({ data }) });
  },
  downloadBackup: () => downloadFile('/api/backup'),
  restoreBackup: async (file: File) => {
    const data = await readFileAsBase64(file);
    return request<{ ok: boolean; restartRequired: boolean; safetyBackup: string }>('/api/backup/restore', { method: 'POST', body: JSON.stringify({ data }) });
  },
  deleteVersion: (projectId: string, versionId: string, force = false) =>
    request<ProjectBundle>(`/api/projects/${projectId}/versions/${versionId}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  generate: (id: string, input: Record<string, unknown>) =>
    request<GenerateResult>(`/api/projects/${id}/generate`, { method: 'POST', body: JSON.stringify(input) }),
  listGeneratingTasks: (id: string) => request<{ tasks: GenerationTask[] }>(`/api/projects/${id}/tasks`),
  getTask: (id: string, taskId: string) => request<GenerationTask>(`/api/projects/${id}/tasks/${taskId}`),
  cancelTask: (id: string, taskId: string) => request<{ ok: boolean; status: string }>(`/api/projects/${id}/tasks/${taskId}/cancel`, { method: 'POST' }),
  recognizeText: (id: string, imageId: string) =>
    request<{ segments: TextSegment[]; modelName: string }>(`/api/projects/${id}/recognize-text`, { method: 'POST', body: JSON.stringify({ imageId }) }),
  editText: (id: string, input: { imageId: string; modelId: string; parentVersionId?: string | null; segments: TextSegment[] }) =>
    request<GenerateResult>(`/api/projects/${id}/edit-text`, { method: 'POST', body: JSON.stringify(input) }),
  localEdit: (id: string, input: { imageId: string; modelId: string; parentVersionId?: string | null; instruction: string; rect: { x: number; y: number; width: number; height: number }; params?: Record<string, unknown> }) =>
    request<GenerateResult>(`/api/projects/${id}/local-edit`, { method: 'POST', body: JSON.stringify(input) }),
  outpaint: (id: string, input: { imageId: string; modelId: string; parentVersionId?: string | null; size: string; params?: Record<string, unknown> }) =>
    request<GenerateResult>(`/api/projects/${id}/outpaint`, { method: 'POST', body: JSON.stringify(input) }),
  enhance: (id: string, input: { imageId: string; modelId: string; parentVersionId?: string | null; params?: Record<string, unknown> }) =>
    request<GenerateResult>(`/api/projects/${id}/enhance`, { method: 'POST', body: JSON.stringify(input) }),
  removeWatermark: (id: string, input: { imageId: string; modelId: string; parentVersionId?: string | null; params?: Record<string, unknown> }) =>
    request<GenerateResult>(`/api/projects/${id}/remove-watermark`, { method: 'POST', body: JSON.stringify(input) }),
  extractAsset: (id: string, input: { imageId: string; modelId: string; parentVersionId?: string | null; rect: { x: number; y: number; width: number; height: number }; crop: { data: string; mimeType: string; padded?: boolean }; hint?: string; params?: Record<string, unknown> }) =>
    request<GenerateResult>(`/api/projects/${id}/extract-asset`, { method: 'POST', body: JSON.stringify(input) }),
  uploadImage: (id: string, input: { data: string; mimeType: string; name: string }) =>
    request<ProjectBundle>(`/api/projects/${id}/images`, { method: 'POST', body: JSON.stringify(input) }),
  models: () => request<ModelsPayload>('/api/models'),
  createModel: (input: Partial<ModelConfig>) => request<{ model: ModelConfig }>('/api/models', { method: 'POST', body: JSON.stringify(input) }),
  updateModel: (id: string, input: Partial<ModelConfig>) => request<{ model: ModelConfig }>(`/api/models/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteModel: (id: string) => request<{ ok: boolean }>(`/api/models/${id}`, { method: 'DELETE' }),
  activateModel: (id: string) => request<{ ok: boolean }>(`/api/models/${id}/activate`, { method: 'POST' }),
  activateVisionModel: (id: string) => request<{ ok: boolean }>(`/api/models/${id}/activate-vision`, { method: 'POST' }),
  testModel: (id: string) => request<{ ok: boolean; latency: number; message: string }>(`/api/models/${id}/test`, { method: 'POST' }),
  testModelConfig: (input: Partial<ModelConfig>) => request<{ ok: boolean; latency: number; message: string }>('/api/models/test-config', { method: 'POST', body: JSON.stringify(input) }),
};

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

// List/thumbnail contexts load a downscaled copy; the canvas keeps the full
// image. The server falls back to the original file for non-PNG sources.
export function thumbUrl(image: Pick<ProjectImage, 'url'>, width = 480) {
  return `${image.url}?w=${width}`;
}

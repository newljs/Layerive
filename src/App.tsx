import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useLanguage } from './i18n';
import { HomeView } from './HomeView';
import { ModelConfigView } from './ModelConfigView';
import { WorkspaceView } from './WorkspaceView';
import type { LibraryImage, ModelConfig, Project } from './types';

type View = { name: 'home' } | { name: 'models'; backTo?: string } | { name: 'workspace'; projectId: string; focusImageId?: string | null };

const VIEW_SESSION_KEY = 'layerive-current-view';

function restoreView(): View {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_SESSION_KEY) || 'null') as Partial<View> | null;
    if (saved?.name === 'workspace' && typeof saved.projectId === 'string' && saved.projectId) {
      return { name: 'workspace', projectId: saved.projectId };
    }
    if (saved?.name === 'models') {
      return { name: 'models', backTo: typeof saved.backTo === 'string' && saved.backTo ? saved.backTo : undefined };
    }
  } catch { /* session storage may be unavailable or contain stale data */ }
  return { name: 'home' };
}

export default function App() {
  const { t, tf } = useLanguage();
  const [view, setView] = useState<View>(restoreView);
  const [projects, setProjects] = useState<Project[]>([]);
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeModel, setActiveModel] = useState('');
  const [activeVisionModel, setActiveVisionModel] = useState('');
  const [cutoutEnabled, setCutoutEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadProjects = useCallback(async () => {
    const data = await api.listProjects();
    setProjects(data.projects);
    return data.projects;
  }, []);
  const refreshProjects = useCallback(async () => { await loadProjects(); }, [loadProjects]);

  const loadImages = useCallback(async () => {
    try {
      const data = await api.listImages();
      setImages(data.images);
    } catch { /* the library is supplementary; a failure must not block the home screen */ }
    finally { setImagesLoading(false); }
  }, []);
  const refreshImages = useCallback(async () => { await loadImages(); }, [loadImages]);

  const refreshModels = useCallback(async () => {
    const data = await api.models();
    setModels(data.models);
    setActiveModel(data.activeModel);
    setActiveVisionModel(data.activeVisionModel);
    setCutoutEnabled(Boolean(data.cutout?.enabled));
  }, []);
  const handleProjectChanged = useCallback(() => { void refreshProjects(); void refreshImages(); }, [refreshProjects, refreshImages]);

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_SESSION_KEY, JSON.stringify(view)); }
    catch { /* session storage may be unavailable */ }
  }, [view]);

  useEffect(() => {
    Promise.all([loadProjects(), refreshModels(), loadImages()])
      .then(([availableProjects]) => {
        setView((current) => {
          if (current.name === 'workspace' && !availableProjects.some((project) => project.id === current.projectId)) {
            return { name: 'home' };
          }
          if (current.name === 'models' && current.backTo && !availableProjects.some((project) => project.id === current.backTo)) {
            return { name: 'models' };
          }
          return current;
        });
      })
      .catch(() => notify(t('app.connectionFailed'), 'error'))
      .finally(() => setLoading(false));
  }, [loadProjects, refreshModels, loadImages, notify]);

  // The home screen is a plain snapshot taken on mount. Pictures and versions
  // created outside this tab (an MCP call, another window) would otherwise stay
  // invisible until a reload, so refresh the lists when the tab regains focus.
  useEffect(() => {
    if (view.name !== 'home') return;
    const refresh = () => { void refreshProjects(); void refreshImages(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [view.name, refreshProjects, refreshImages]);

  async function createProject(input: { name: string; description: string }) {
    try {
      const bundle = await api.createProject({ ...input, defaultModelId: activeModel });
      await refreshProjects();
      setView({ name: 'workspace', projectId: bundle.project.id });
      notify(t('app.projectCreated'));
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  async function deleteProject(id: string) {
    await api.deleteProject(id);
    notify(t('app.projectDeleted'));
    try { await refreshProjects(); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function duplicateProject(id: string) {
    try { await api.duplicateProject(id); await refreshProjects(); notify(t('app.projectDuplicated')); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function importProject(file: File) {
    try { const bundle = await api.importProject(file); await refreshProjects(); notify(t('app.projectImported')); setView({ name: 'workspace', projectId: bundle.project.id }); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  // Importing from the home screen only files the picture in the library. It
  // must not create a project, otherwise the same picture would appear both as
  // a project and as a library picture.
  async function importImage(file: File) {
    try {
      await api.importLibraryImage(file);
      await refreshImages();
      notify(t('app.imageImported'));
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  // Opening a library picture seeds a project with a copy and jumps into the
  // workspace, which is the point at which a picture stops being library-only.
  async function openLibraryImage(id: string) {
    try {
      const bundle = await api.openLibraryImage(id);
      await Promise.all([refreshProjects(), refreshImages()]);
      setView({ name: 'workspace', projectId: bundle.project.id, focusImageId: bundle.importedImageId });
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  async function deleteLibraryImage(id: string) {
    try {
      await api.deleteLibraryImage(id);
      await refreshImages();
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  async function saveModel(model: Partial<ModelConfig>, id?: string) {
    try {
      const result = id ? await api.updateModel(id, model) : await api.createModel(model);
      await refreshModels(); notify(t('app.modelSaved'));
      return result.model;
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  async function deleteModel(id: string) {
    await api.deleteModel(id);
    notify(t('app.modelDeleted'));
    try { await refreshModels(); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function activateModel(id: string) {
    try { await api.activateModel(id); await refreshModels(); notify(t('app.defaultModelUpdated')); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function activateVisionModel(id: string) {
    try { await api.activateVisionModel(id); await refreshModels(); notify(t('app.defaultVisionModelUpdated')); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function testModelConfig(model: Partial<ModelConfig>) {
    try {
      const result = await api.testModelConfig(model);
      const message = result.code ? tf(result.code.startsWith('msg.') ? result.code : `msg.${result.code}`, result.message) : result.message;
      return t('app.testOk', { message, latency: result.latency });
    } catch (error) { return t('app.testFailed', { message: (error as Error).message }); }
  }

  async function revealModelApiKey(id: string) {
    try {
      const result = await api.revealModelApiKey(id);
      return { apiKey: result.apiKey, apiKeys: result.apiKeys?.length ? result.apiKeys : (result.apiKey ? [result.apiKey] : []) };
    } catch (error) { notify((error as Error).message, 'error'); return { apiKey: '', apiKeys: [] }; }
  }

  async function fetchUpstreamModels(model: Partial<ModelConfig>, includeAll = false) {
    return await api.upstreamModels(model, includeAll);
  }

  async function keyPoolStatus(id: string) {
    try { return await api.keyPoolStatus(id); }
    catch { return { count: 0, keys: [] }; }
  }

  return (
    <>
      {view.name === 'home' && <HomeView projects={projects} images={images} loading={loading} imagesLoading={imagesLoading} onOpen={(projectId, imageId) => setView({ name: 'workspace', projectId, focusImageId: imageId ?? null })} onOpenLibraryImage={openLibraryImage} onDeleteLibraryImage={deleteLibraryImage} onCreate={createProject} onDelete={deleteProject} onDuplicate={duplicateProject} onImport={importProject} onImportImage={importImage} onRefreshProjects={refreshProjects} onModels={() => setView({ name: 'models' })} notify={notify} />}
      {view.name === 'models' && <ModelConfigView models={models} activeModel={activeModel} activeVisionModel={activeVisionModel} onBack={() => view.backTo ? setView({ name: 'workspace', projectId: view.backTo }) : setView({ name: 'home' })} onSave={saveModel} onDelete={deleteModel} onActivate={activateModel} onActivateVision={activateVisionModel} onTestConfig={testModelConfig} onRevealApiKey={revealModelApiKey} onKeyPoolStatus={keyPoolStatus} onFetchModels={fetchUpstreamModels} />}
      {view.name === 'workspace' && <WorkspaceView projectId={view.projectId} focusImageId={view.focusImageId ?? null} models={models} activeModel={activeModel} activeVisionModel={activeVisionModel} cutoutEnabled={cutoutEnabled} onBack={() => { setView({ name: 'home' }); void refreshProjects(); void refreshImages(); }} onModels={() => setView({ name: 'models', backTo: view.projectId })} onProjectChanged={handleProjectChanged} notify={notify} />}
      {toast && <div className={`toast ${toast.kind}`} role="status"><span>{toast.kind === 'success' ? '✓' : '!'}</span>{toast.message}</div>}
    </>
  );
}

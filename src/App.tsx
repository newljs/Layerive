import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useLanguage } from './i18n';
import { HomeView } from './HomeView';
import { ModelConfigView } from './ModelConfigView';
import { WorkspaceView } from './WorkspaceView';
import type { ModelConfig, Project } from './types';

type View = { name: 'home' } | { name: 'models'; backTo?: string } | { name: 'workspace'; projectId: string };

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
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeModel, setActiveModel] = useState('');
  const [activeVisionModel, setActiveVisionModel] = useState('');
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

  const refreshModels = useCallback(async () => {
    const data = await api.models();
    setModels(data.models);
    setActiveModel(data.activeModel);
    setActiveVisionModel(data.activeVisionModel);
  }, []);
  const handleProjectChanged = useCallback(() => { void refreshProjects(); }, [refreshProjects]);

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_SESSION_KEY, JSON.stringify(view)); }
    catch { /* session storage may be unavailable */ }
  }, [view]);

  useEffect(() => {
    Promise.all([loadProjects(), refreshModels()])
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
  }, [loadProjects, refreshModels, notify]);

  async function createProject(input: { name: string; description: string }) {
    try {
      const bundle = await api.createProject({ ...input, defaultModelId: activeModel });
      await refreshProjects();
      setView({ name: 'workspace', projectId: bundle.project.id });
      notify(t('app.projectCreated'));
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  async function deleteProject(id: string) {
    try { await api.deleteProject(id); await refreshProjects(); notify(t('app.projectDeleted')); }
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

  async function saveModel(model: Partial<ModelConfig>, id?: string) {
    try {
      const result = id ? await api.updateModel(id, model) : await api.createModel(model);
      await refreshModels(); notify(t('app.modelSaved'));
      return result.model;
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  async function deleteModel(id: string) {
    try { await api.deleteModel(id); await refreshModels(); notify(t('app.modelDeleted')); }
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
      const message = result.code ? tf(`msg.${result.code}`, result.message) : result.message;
      return t('app.testOk', { message, latency: result.latency });
    } catch (error) { return t('app.testFailed', { message: (error as Error).message }); }
  }

  async function revealModelApiKey(id: string) {
    try { return (await api.revealModelApiKey(id)).apiKey; }
    catch (error) { notify((error as Error).message, 'error'); return ''; }
  }

  return (
    <>
      {view.name === 'home' && <HomeView projects={projects} loading={loading} onOpen={(projectId) => setView({ name: 'workspace', projectId })} onCreate={createProject} onDelete={deleteProject} onDuplicate={duplicateProject} onImport={importProject} onRefreshProjects={refreshProjects} onModels={() => setView({ name: 'models' })} notify={notify} />}
      {view.name === 'models' && <ModelConfigView models={models} activeModel={activeModel} activeVisionModel={activeVisionModel} onBack={() => view.backTo ? setView({ name: 'workspace', projectId: view.backTo }) : setView({ name: 'home' })} onSave={saveModel} onDelete={deleteModel} onActivate={activateModel} onActivateVision={activateVisionModel} onTestConfig={testModelConfig} onRevealApiKey={revealModelApiKey} />}
      {view.name === 'workspace' && <WorkspaceView projectId={view.projectId} models={models} activeModel={activeModel} activeVisionModel={activeVisionModel} onBack={() => { setView({ name: 'home' }); void refreshProjects(); }} onModels={() => setView({ name: 'models', backTo: view.projectId })} onProjectChanged={handleProjectChanged} notify={notify} />}
      {toast && <div className={`toast ${toast.kind}`} role="status"><span>{toast.kind === 'success' ? '✓' : '!'}</span>{toast.message}</div>}
    </>
  );
}

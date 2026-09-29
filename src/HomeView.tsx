import { useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './Icon';
import { LanguageToggle, useLanguage, type Language } from './i18n';
import { useTheme } from './theme';
import type { Project } from './types';

type Props = {
  projects: Project[];
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: (input: { name: string; description: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onRefreshProjects: () => Promise<void>;
  onModels: () => void;
  notify: (message: string, kind?: 'success' | 'error') => void;
};

const localeFor = (language: Language) => (language === 'zh' ? 'zh-CN' : 'en-US');

export function HomeView({ projects, loading, onOpen, onCreate, onDelete, onDuplicate, onImport, onRefreshProjects, onModels, notify }: Props) {
  const { language, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'recent' | 'favorite'>('all');
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => (localStorage.getItem('pixelflow.view-mode') === 'list' ? 'list' : 'card'));
  const [createOpen, setCreateOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const formatUpdated = (value: string) => new Intl.DateTimeFormat(localeFor(language), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

  const visible = useMemo(() => {
    const list = projects.filter((project) => {
      if (filter === 'favorite' && !project.isFavorite) return false;
      return `${project.name} ${project.description}`.toLowerCase().includes(query.toLowerCase());
    });
    return filter === 'recent' ? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : list;
  }, [projects, query, filter]);

  function switchViewMode(mode: 'card' | 'list') {
    setViewMode(mode);
    localStorage.setItem('pixelflow.view-mode', mode);
  }

  async function toggleFavorite(project: Project) {
    try {
      await api.updateProject(project.id, { isFavorite: !project.isFavorite });
      notify(project.isFavorite ? t('home.unfavorited') : t('home.favorited'));
      await onRefreshProjects();
    } catch (error) { notify((error as Error).message, 'error'); }
  }

  // The workspace header already renames the project that is open. The library
  // needs its own entry so renaming does not require entering a project first.
  function openRename(project: Project) {
    setRenameTarget(project);
    setRenameValue(project.name);
  }

  async function submitRename() {
    const next = renameValue.trim();
    if (!renameTarget || !next || renaming) return;
    if (next === renameTarget.name) { setRenameTarget(null); return; }
    setRenaming(true);
    try {
      await api.updateProject(renameTarget.id, { name: next });
      setRenameTarget(null);
      notify(t('home.renamed'));
      await onRefreshProjects();
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setRenaming(false); }
  }

  async function submit() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreate({ name: name.trim(), description: description.trim() });
      setCreateOpen(false); setName(''); setDescription('');
    } finally { setCreating(false); }
  }

  async function restore(file: File) {
    if (!window.confirm(t('home.restoreConfirm'))) return;
    setRestoring(true);
    try {
      await api.restoreBackup(file);
      notify(t('home.restoreDone'), 'success');
      setDataOpen(false);
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setRestoring(false);
      if (restoreRef.current) restoreRef.current.value = '';
    }
  }

  const projectActions = (project: Project) => (
    <>
      <button className={`star-button ${project.isFavorite ? 'active' : ''}`} title={project.isFavorite ? t('home.unfavorite') : t('home.favorite')} onClick={() => void toggleFavorite(project)}><Icon name={project.isFavorite ? 'starFilled' : 'star'} size={16} /></button>
      <button className="action-button" title={t('home.renameTitle')} aria-label={t('home.renameProject', { name: project.name })} onClick={() => openRename(project)}><Icon name="edit" size={15} /></button>
      <button className="action-button" title={t('home.duplicateTitle')} onClick={() => void onDuplicate(project.id)}><Icon name="duplicate" size={15} /></button>
      <button className="action-button" title={t('home.exportTitle')} onClick={() => api.exportProject(project.id)}><Icon name="export" size={15} /></button>
      <button className="more-button danger-hover" aria-label={t('home.deleteProject', { name: project.name })} title={t('home.deleteTitle')} onClick={() => { if (window.confirm(t('home.deleteConfirm', { name: project.name }))) void onDelete(project.id); }}><Icon name="close" size={15} /></button>
    </>
  );

  return (
    <main className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark" aria-label="Layerive">
          <svg viewBox="0 0 512 512" width="24" height="24" aria-hidden="true">
            <g fill="#ffffff">
              <path d="M122 164 a30 30 0 0 1 30-30 h164 a30 30 0 0 1 30 30 v158 a30 30 0 0 1-30 30 h-164 a30 30 0 0 1-30-30 Z" opacity=".42"/>
              <path d="M166 206 a30 30 0 0 1 30-30 h164 a30 30 0 0 1 30 30 v142 a30 30 0 0 1-30 30 h-164 a30 30 0 0 1-30-30 Z"/>
              <path d="m203 316 48-52 36 34 40-49 45 67 Z" fill="#6d55f7"/>
              <circle cx="341" cy="230" r="16" fill="#6d55f7"/>
            </g>
          </svg>
        </div>
        <nav aria-label={t('home.navMain')}>
          <button className="nav-icon active" aria-label={t('home.navProjects')}><Icon name="grid" size={19} /></button>
          <button className="nav-icon" aria-label={t('home.navModels')} onClick={onModels}><Icon name="models" size={19} /></button>
          <button className="nav-icon" aria-label={t('home.navData')} onClick={() => setDataOpen(true)}><Icon name="data" size={19} /></button>
        </nav>
      </aside>

      <section className="home-content">
        <header className="topbar">
          <div><p className="eyebrow">{t('home.eyebrow')}</p><h1>{t('home.myProjects')}</h1></div>
          <div className="header-actions">
            <button className="icon-button theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? t('common.switchToLight') : t('common.switchToDark')} aria-label={t('common.toggleTheme')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
            <LanguageToggle />
            <button className="button secondary" onClick={() => importRef.current?.click()}>{t('home.import')}</button>
            <button className="button secondary" onClick={onModels}>{t('home.models')}</button>
            <button className="button primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} /> {t('home.newProject')}</button>
          </div>
        </header>

        <div className="home-toolbar">
          <div className="tabs" role="tablist" aria-label={t('home.filterAria')}>
            <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('home.all')} <span>{projects.length}</span></button>
            <button className={`tab ${filter === 'recent' ? 'active' : ''}`} onClick={() => setFilter('recent')}>{t('home.recent')}</button>
            <button className={`tab ${filter === 'favorite' ? 'active' : ''}`} onClick={() => setFilter('favorite')}>{t('home.favorites')} <span>{projects.filter((project) => project.isFavorite).length}</span></button>
          </div>
          <div className="toolbar-right">
            <label className="search-box"><span><Icon name="search" size={15} /></span><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('home.search')} placeholder={t('home.search')} /></label>
            <div className="view-switch" role="group" aria-label={t('home.viewSwitchAria')}>
              <button className={viewMode === 'card' ? 'active' : ''} onClick={() => switchViewMode('card')} title={t('home.cardView')} aria-label={t('home.cardView')}><Icon name="grid" size={15} /></button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => switchViewMode('list')} title={t('home.listView')} aria-label={t('home.listView')}><Icon name="list" size={15} /></button>
            </div>
          </div>
        </div>

        {loading ? <div className="loading-panel">{t('home.loading')}</div> : viewMode === 'card' ? (
          <section className="project-grid" aria-label={t('home.listAria')}>
            <button className="new-project-card" onClick={() => setCreateOpen(true)}>
              <span className="new-project-plus"><Icon name="plus" size={22} /></span><strong>{t('home.createTitle')}</strong><small>{t('home.createSubtitle')}</small>
            </button>
            {visible.map((project, index) => (
              <article className="project-card" key={project.id} onDoubleClick={() => onOpen(project.id)}>
                <button className="project-open-area" onClick={() => onOpen(project.id)} aria-label={t('home.openProject', { name: project.name })}>
                  <div
                    className={`project-cover ${project.coverUrl ? 'has-image' : `cover-fallback-${index % 4}`}`}
                  >
                    {project.coverUrl
                      ? <img src={project.coverUrl} alt="" loading="lazy" />
                      : <><div className="cover-orb orb-one" /><div className="cover-orb orb-two" /></>}
                    <span>V{project.versionCount}</span>
                  </div>
                </button>
                <div className="project-info">
                  <div><h2>{project.name}</h2><p>{t('home.versionMeta', { count: project.versionCount, time: formatUpdated(project.updatedAt) })}</p></div>
                  <div className="project-actions">{projectActions(project)}</div>
                </div>
              </article>
            ))}
            {!visible.length && projects.length > 0 && <div className="empty-search">{t('home.noMatch')}</div>}
          </section>
        ) : (
          <section className="project-list" aria-label={t('home.listAria')}>
            <div className="project-list-head"><span>{t('home.colProject')}</span><span>{t('home.colVersions')}</span><span>{t('home.colUpdated')}</span><span>{t('home.colActions')}</span></div>
            {visible.map((project) => (
              <div className="project-row" key={project.id} onDoubleClick={() => onOpen(project.id)}>
                <button className="project-row-main" onClick={() => onOpen(project.id)}>
                  {project.coverUrl ? <img className="row-cover" src={project.coverUrl} alt="" /> : <span className="row-cover placeholder"><Icon name="image" size={20} /></span>}
                  <span className="row-copy"><strong>{project.name}</strong><small>{project.description || t('home.noDescription')}</small></span>
                </button>
                <span>V{project.versionCount}</span>
                <span>{formatUpdated(project.updatedAt)}</span>
                <span className="project-actions">{projectActions(project)}</span>
              </div>
            ))}
            {!visible.length && <div className="empty-search">{t('home.noMatch')}</div>}
          </section>
        )}

        <footer className="home-footer">
          <a className="github-link" href="https://github.com/newljs/Layerive" target="_blank" rel="noreferrer" title={t('home.githubTitle')}>
            <Icon name="github" size={14} />
            GitHub · newljs/Layerive
          </a>
        </footer>
      </section>

      <input ref={importRef} hidden type="file" accept=".zip" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void onImport(file);
        event.target.value = '';
      }} />
      <input ref={restoreRef} hidden type="file" accept=".zip" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void restore(file);
        event.target.value = '';
      }} />

      {createOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="modal-heading"><div><p className="eyebrow">NEW PROJECT</p><h2 id="create-title">{t('home.createTitle')}</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)}><Icon name="close" size={16} /></button></div>
            <label className="field"><span>{t('home.nameLabel')}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t('home.namePlaceholder')} onKeyDown={(event) => event.key === 'Enter' && void submit()} /></label>
            <label className="field"><span>{t('home.descriptionLabel')}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('home.descriptionPlaceholder')} rows={3} /></label>
            <div className="create-hint"><span>{t('home.autoSave')}</span><p>{t('home.autoSaveHint')}</p></div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</button><button className="button primary" disabled={!name.trim() || creating} onClick={() => void submit()}>{creating ? t('home.creating') : t('home.createAndOpen')}</button></div>
          </section>
        </div>
      )}

      {renameTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRenameTarget(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <div className="modal-heading"><div><p className="eyebrow">RENAME</p><h2 id="rename-title">{t('home.renameTitle')}</h2></div><button className="icon-button" onClick={() => setRenameTarget(null)}><Icon name="close" size={16} /></button></div>
            <label className="field"><span>{t('home.nameLabel')}</span><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder={t('home.renamePlaceholder')} onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(); if (event.key === 'Escape') setRenameTarget(null); }} /></label>
            <div className="create-hint"><span>{t('home.renameOnly')}</span><p>{t('home.renameHint')}</p></div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setRenameTarget(null)}>{t('common.cancel')}</button><button className="button primary" disabled={!renameValue.trim() || renaming} onClick={() => void submitRename()}>{renaming ? t('home.saving') : t('home.saveNewName')}</button></div>
          </section>
        </div>
      )}

      {dataOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDataOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="data-title">
            <div className="modal-heading"><div><p className="eyebrow">DATA</p><h2 id="data-title">{t('home.dataTitle')}</h2></div><button className="icon-button" onClick={() => setDataOpen(false)}><Icon name="close" size={16} /></button></div>
            <div className="data-actions">
              <article>
                <h3>{t('home.backupTitle')}</h3>
                <p>{t('home.backupDesc')}</p>
                <button className="button secondary" onClick={() => api.downloadBackup()}>{t('home.backupAction')}</button>
              </article>
              <article>
                <h3>{t('home.restoreTitle')}</h3>
                <p>{t('home.restoreDesc')}</p>
                <button className="button secondary" disabled={restoring} onClick={() => restoreRef.current?.click()}>{restoring ? t('home.restoring') : t('home.restoreAction')}</button>
              </article>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

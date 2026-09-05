import { useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './Icon';
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

const formatUpdated = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function HomeView({ projects, loading, onOpen, onCreate, onDelete, onDuplicate, onImport, onRefreshProjects, onModels, notify }: Props) {
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
      notify(project.isFavorite ? '已取消收藏' : '已收藏项目');
      await onRefreshProjects();
    } catch (error) { notify((error as Error).message, 'error'); }
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
    if (!window.confirm('恢复备份会覆盖当前所有项目数据和模型配置，恢复前会自动创建安全备份。确定继续吗？')) return;
    setRestoring(true);
    try {
      await api.restoreBackup(file);
      notify('备份已恢复，应用将自动重启服务…', 'success');
      setDataOpen(false);
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setRestoring(false);
      if (restoreRef.current) restoreRef.current.value = '';
    }
  }

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
        <nav aria-label="主导航">
          <button className="nav-icon active" aria-label="项目"><Icon name="grid" size={19} /></button>
          <button className="nav-icon" aria-label="模型配置" onClick={onModels}><Icon name="models" size={19} /></button>
          <button className="nav-icon" aria-label="数据管理" onClick={() => setDataOpen(true)}><Icon name="data" size={19} /></button>
        </nav>
      </aside>

      <section className="home-content">
        <header className="topbar">
          <div><p className="eyebrow">Layerive · 本地 AI 图片工作台</p><h1>我的项目</h1></div>
          <div className="header-actions">
            <button className="icon-button theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'} aria-label="切换配色模式">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
            <button className="button secondary" onClick={() => importRef.current?.click()}>导入项目</button>
            <button className="button secondary" onClick={onModels}>模型配置</button>
            <button className="button primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} /> 新建项目</button>
          </div>
        </header>

        <div className="home-toolbar">
          <div className="tabs" role="tablist" aria-label="项目筛选">
            <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>全部项目 <span>{projects.length}</span></button>
            <button className={`tab ${filter === 'recent' ? 'active' : ''}`} onClick={() => setFilter('recent')}>最近使用</button>
            <button className={`tab ${filter === 'favorite' ? 'active' : ''}`} onClick={() => setFilter('favorite')}>已收藏 <span>{projects.filter((project) => project.isFavorite).length}</span></button>
          </div>
          <div className="toolbar-right">
            <label className="search-box"><span><Icon name="search" size={15} /></span><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索项目" placeholder="搜索项目" /></label>
            <div className="view-switch" role="group" aria-label="视图切换">
              <button className={viewMode === 'card' ? 'active' : ''} onClick={() => switchViewMode('card')} title="卡片视图" aria-label="卡片视图"><Icon name="grid" size={15} /></button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => switchViewMode('list')} title="列表视图" aria-label="列表视图"><Icon name="list" size={15} /></button>
            </div>
          </div>
        </div>

        {loading ? <div className="loading-panel">正在读取本地项目…</div> : viewMode === 'card' ? (
          <section className="project-grid" aria-label="项目列表">
            <button className="new-project-card" onClick={() => setCreateOpen(true)}>
              <span className="new-project-plus"><Icon name="plus" size={22} /></span><strong>创建新项目</strong><small>开始一段新的图片创作</small>
            </button>
            {visible.map((project, index) => (
              <article className="project-card" key={project.id} onDoubleClick={() => onOpen(project.id)}>
                <button className="project-open-area" onClick={() => onOpen(project.id)} aria-label={`打开${project.name}`}>
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
                  <div><h2>{project.name}</h2><p>{project.versionCount} 个版本 · {formatUpdated(project.updatedAt)}</p></div>
                  <div className="project-actions">
                    <button className={`star-button ${project.isFavorite ? 'active' : ''}`} title={project.isFavorite ? '取消收藏' : '收藏项目'} onClick={() => void toggleFavorite(project)}><Icon name={project.isFavorite ? 'starFilled' : 'star'} size={16} /></button>
                    <button className="action-button" title="复制项目" onClick={() => void onDuplicate(project.id)}><Icon name="duplicate" size={15} /></button>
                    <button className="action-button" title="导出项目（含图片）" onClick={() => api.exportProject(project.id)}><Icon name="export" size={15} /></button>
                    <button className="more-button danger-hover" aria-label={`删除${project.name}`} title="删除项目" onClick={() => { if (window.confirm(`确定删除“${project.name}”吗？项目将被移入本地回收状态。`)) void onDelete(project.id); }}><Icon name="close" size={15} /></button>
                  </div>
                </div>
              </article>
            ))}
            {!visible.length && projects.length > 0 && <div className="empty-search">没有找到匹配的项目</div>}
          </section>
        ) : (
          <section className="project-list" aria-label="项目列表">
            <div className="project-list-head"><span>项目</span><span>版本</span><span>最近更新</span><span>操作</span></div>
            {visible.map((project) => (
              <div className="project-row" key={project.id} onDoubleClick={() => onOpen(project.id)}>
                <button className="project-row-main" onClick={() => onOpen(project.id)}>
                  {project.coverUrl ? <img className="row-cover" src={project.coverUrl} alt="" /> : <span className="row-cover placeholder"><Icon name="image" size={20} /></span>}
                  <span className="row-copy"><strong>{project.name}</strong><small>{project.description || '暂无描述'}</small></span>
                </button>
                <span>V{project.versionCount}</span>
                <span>{formatUpdated(project.updatedAt)}</span>
                <span className="project-actions">
                  <button className={`star-button ${project.isFavorite ? 'active' : ''}`} title={project.isFavorite ? '取消收藏' : '收藏项目'} onClick={() => void toggleFavorite(project)}><Icon name={project.isFavorite ? 'starFilled' : 'star'} size={16} /></button>
                  <button className="action-button" title="复制项目" onClick={() => void onDuplicate(project.id)}><Icon name="duplicate" size={15} /></button>
                  <button className="action-button" title="导出项目（含图片）" onClick={() => api.exportProject(project.id)}><Icon name="export" size={15} /></button>
                  <button className="more-button danger-hover" aria-label={`删除${project.name}`} title="删除项目" onClick={() => { if (window.confirm(`确定删除“${project.name}”吗？项目将被移入本地回收状态。`)) void onDelete(project.id); }}><Icon name="close" size={15} /></button>
                </span>
              </div>
            ))}
            {!visible.length && <div className="empty-search">没有找到匹配的项目</div>}
          </section>
        )}
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
            <div className="modal-heading"><div><p className="eyebrow">NEW PROJECT</p><h2 id="create-title">创建新项目</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)}><Icon name="close" size={16} /></button></div>
            <label className="field"><span>项目名称 *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：夏季宣传海报" onKeyDown={(event) => event.key === 'Enter' && void submit()} /></label>
            <label className="field"><span>项目描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简单说明这个项目要完成什么" rows={3} /></label>
            <div className="create-hint"><span>自动保存</span><p>项目创建后，对话、图片和历史版本都会保存在本机。</p></div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setCreateOpen(false)}>取消</button><button className="button primary" disabled={!name.trim() || creating} onClick={() => void submit()}>{creating ? '正在创建…' : '创建并进入'}</button></div>
          </section>
        </div>
      )}

      {dataOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDataOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="data-title">
            <div className="modal-heading"><div><p className="eyebrow">DATA</p><h2 id="data-title">数据管理</h2></div><button className="icon-button" onClick={() => setDataOpen(false)}><Icon name="close" size={16} /></button></div>
            <div className="data-actions">
              <article>
                <h3>完整备份</h3>
                <p>打包本地数据库、全部项目图片和模型配置为一个 zip 文件。</p>
                <button className="button secondary" onClick={() => api.downloadBackup()}>下载完整备份</button>
              </article>
              <article>
                <h3>从备份恢复</h3>
                <p>选择备份 zip 覆盖当前数据。恢复前会自动创建当前数据的安全备份，恢复后服务会自动重启。</p>
                <button className="button secondary" disabled={restoring} onClick={() => restoreRef.current?.click()}>{restoring ? '正在恢复…' : '选择备份文件恢复'}</button>
              </article>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, readFileAsDataUrl } from './api';
import { GALLERY_CATEGORIES, GALLERY_ENTRIES, type GalleryEntry } from './gallery';
import { Icon } from './Icon';
import type { GalleryEntryItem } from './types';

type Props = {
  onClose: () => void;
  // `full` = the original prompt for this entry; `style` = the distilled
  // style-only prompt meant for project-level reuse.
  onUsePrompt: (entry: GalleryEntry) => void;
  onUseStyle: (entry: GalleryEntry) => void;
};

const MINE_CATEGORY = { id: 'mine', zh: '我的收藏', emoji: '🗂️' };

// Built-in entries are bundled static data; user entries come from the local
// server (SQLite + data/gallery). Both surfaces render as unified cards.
type GalleryItem = {
  key: string;
  title: string;
  category: string;
  image: string;
  size: string;
  prompt: string;
  stylePrompt: string;
  userEntry?: GalleryEntryItem;
};

type EditorState = {
  id: string | null;
  title: string;
  category: string;
  prompt: string;
  stylePrompt: string;
  uploaded: { dataUrl: string; mimeType: string } | null;
  existingImage: string | null;
  removedExisting: boolean;
  analyzing: boolean;
  saving: boolean;
};

async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function userToItem(entry: GalleryEntryItem): GalleryItem {
  return {
    key: `u-${entry.id}`,
    title: entry.title,
    category: entry.category || 'mine',
    image: entry.image || '',
    size: entry.source === 'project' ? '项目收藏' : '手动添加',
    prompt: entry.prompt,
    stylePrompt: entry.stylePrompt,
    userEntry: entry,
  };
}

export function PromptGalleryModal({ onClose, onUsePrompt, onUseStyle }: Props) {
  const [categoryId, setCategoryId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [userEntries, setUserEntries] = useState<GalleryEntryItem[]>([]);
  const [userLoading, setUserLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.gallery().then((data) => setUserEntries(data.entries)).catch(() => { /* 画廊内置内容仍可用 */ }).finally(() => setUserLoading(false));
  }, []);

  const userItems = useMemo(() => userEntries.map(userToItem), [userEntries]);
  const categories = useMemo(() => [MINE_CATEGORY, ...GALLERY_CATEGORIES], []);
  const items = useMemo<GalleryItem[]>(() => [...userItems, ...GALLERY_ENTRIES.map((entry) => ({ key: `b-${entry.id}`, ...entry }))], [userItems]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((entry) => {
      if (categoryId !== 'all' && entry.category !== categoryId) return false;
      if (!q) return true;
      return `${entry.title} ${entry.prompt} ${entry.stylePrompt}`.toLowerCase().includes(q);
    });
  }, [items, categoryId, query]);

  const active = activeKey === null ? null : items.find((entry) => entry.key === activeKey) || null;
  const countOf = (id: string) => (id === 'all' ? items.length : items.filter((entry) => entry.category === id).length);

  function openCreate() {
    setEditor({ id: null, title: '', category: 'mine', prompt: '', stylePrompt: '', uploaded: null, existingImage: null, removedExisting: false, analyzing: false, saving: false });
  }

  function openEdit(item: GalleryItem) {
    if (!item.userEntry) return;
    setEditor({ id: item.userEntry.id, title: item.title, category: item.category, prompt: item.prompt, stylePrompt: item.stylePrompt, uploaded: null, existingImage: item.userEntry.image, removedExisting: false, analyzing: false, saving: false });
  }

  function patchEditor(patch: Partial<EditorState>) {
    setEditor((current) => (current ? { ...current, ...patch } : current));
  }

  async function chooseImage(file: File) {
    if (!editor) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    if (file.size > 10 * 1024 * 1024) return;
    const dataUrl = await readFileAsDataUrl(file);
    patchEditor({ uploaded: { dataUrl, mimeType: file.type }, removedExisting: true });
  }

  async function analyze() {
    if (!editor || editor.analyzing) return;
    let source = editor.uploaded;
    if (!source && editor.existingImage) {
      try { source = { dataUrl: await urlToDataUrl(editor.existingImage), mimeType: 'image/png' }; }
      catch { source = null; }
    }
    if (!source) return;
    patchEditor({ analyzing: true });
    try {
      const result = await api.analyzeGalleryImage({ data: source.dataUrl, mimeType: source.mimeType });
      patchEditor({ analyzing: false, title: editor.title.trim() || result.title, prompt: result.prompt, stylePrompt: result.stylePrompt, uploaded: source });
    } catch {
      patchEditor({ analyzing: false });
    }
  }

  async function save() {
    if (!editor || editor.saving) return;
    if (!editor.prompt.trim() && !editor.stylePrompt.trim()) return;
    patchEditor({ saving: true });
    const payload = {
      id: editor.id || undefined,
      title: editor.title,
      category: editor.category,
      prompt: editor.prompt,
      stylePrompt: editor.stylePrompt,
      image: editor.uploaded ? { data: editor.uploaded.dataUrl, mimeType: editor.uploaded.mimeType } : editor.removedExisting ? null : undefined,
    };
    try {
      const result = editor.id ? await api.updateGalleryEntry(editor.id, payload) : await api.saveGalleryEntry(payload);
      const data = await api.gallery();
      setUserEntries(data.entries);
      setEditor(null);
      setCategoryId(result.entry.category || 'mine');
      setActiveKey(`u-${result.entry.id}`);
    } catch {
      patchEditor({ saving: false });
    }
  }

  async function remove(item: GalleryItem) {
    if (!item.userEntry) return;
    if (!window.confirm(`确定删除画廊条目「${item.title}」吗？`)) return;
    try {
      await api.deleteGalleryEntry(item.userEntry.id);
      setUserEntries((entries) => entries.filter((entry) => entry.id !== item.userEntry!.id));
      if (activeKey === item.key) setActiveKey(null);
    } catch { /* keep entry on failure */ }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="gallery-modal" role="dialog" aria-modal="true" aria-labelledby="gallery-title">
        <div className="modal-heading gallery-heading">
          <div>
            <p className="eyebrow">PROMPT GALLERY</p>
            <h2 id="gallery-title">提示词画廊</h2>
            <small>精选提示词可直接复用；也可以添加自己的图片与提示词，或让视觉模型从图片中提炼。</small>
          </div>
          <button className="gallery-add-button" onClick={openCreate}><Icon name="plus" size={14} /> 添加提示词</button>
          <label className="gallery-search">
            <Icon name="search" size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词 / 风格…" aria-label="搜索画廊" />
          </label>
          <button className="icon-button" onClick={onClose} aria-label="关闭画廊"><Icon name="close" size={16} /></button>
        </div>

        <div className="gallery-body">
          <aside className="gallery-cats">
            <button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>
              <span className="cat-emoji">✨</span><span className="cat-name">全部</span><span className="cat-count">{countOf('all')}</span>
            </button>
            {categories.map((cat) => (
              <button key={cat.id} className={categoryId === cat.id ? 'active' : ''} onClick={() => setCategoryId(cat.id)}>
                <span className="cat-emoji">{cat.emoji}</span><span className="cat-name">{cat.zh}</span><span className="cat-count">{countOf(cat.id)}</span>
              </button>
            ))}
          </aside>

          <div className="gallery-grid-wrap">
            {userLoading && <div className="gallery-empty">正在加载我的收藏…</div>}
            {!userLoading && visible.length === 0 && <div className="gallery-empty">没有匹配的提示词</div>}
            <div className="gallery-grid">
              {visible.map((entry) => (
                <article className={`gallery-card ${activeKey === entry.key ? 'active' : ''}`} key={entry.key} onClick={() => setActiveKey(activeKey === entry.key ? null : entry.key)}>
                  <div className="gallery-thumb">
                    {entry.image ? <img src={entry.image} alt={entry.title} loading="lazy" /> : <span className="gallery-thumb-empty">纯文本</span>}
                    <div className="gallery-card-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="gallery-use full" title="把完整提示词填入本次对话输入框" onClick={() => onUsePrompt({ ...entry, id: Number(entry.key.replace(/\D/g, '')) || 0 })}>用作对话提示词</button>
                      <button className="gallery-use style" title="只把风格描述填入项目风格提示词" onClick={() => onUseStyle({ ...entry, id: Number(entry.key.replace(/\D/g, '')) || 0 })}>用作项目风格</button>
                      {entry.userEntry && <div className="gallery-user-actions">
                        <button className="gallery-manage" title="编辑这条提示词" onClick={() => openEdit(entry)}><Icon name="edit" size={12} /> 编辑</button>
                        <button className="gallery-manage danger" title="删除这条提示词" onClick={() => void remove(entry)}><Icon name="close" size={12} /> 删除</button>
                      </div>}
                    </div>
                  </div>
                  <div className="gallery-meta">
                    <strong title={entry.title}>{entry.title}</strong>
                    <span>{entry.size || '—'}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        {active && (
          <div className="gallery-detail">
            {active.image ? <img src={active.image} alt={active.title} /> : <div className="gallery-detail-placeholder">纯文本提示词</div>}
            <div className="gallery-detail-copy">
              <div className="gallery-detail-head"><strong>{active.title}</strong><span>{active.size}</span></div>
              <div className="gallery-detail-block"><label>风格提示词（可用作项目统一风格）</label><p>{active.stylePrompt || '—'}</p></div>
              <div className="gallery-detail-block"><label>完整原始提示词</label><p className="full-prompt">{active.prompt || '—'}</p></div>
              <div className="gallery-detail-actions">
                <button className="button secondary" onClick={() => onUseStyle({ ...active, id: Number(active.key.replace(/\D/g, '')) || 0 })}>用作项目风格</button>
                <button className="button primary" onClick={() => onUsePrompt({ ...active, id: Number(active.key.replace(/\D/g, '')) || 0 })}>用作对话提示词</button>
              </div>
            </div>
            <button className="icon-button gallery-detail-close" onClick={() => setActiveKey(null)} aria-label="收起详情"><Icon name="close" size={15} /></button>
          </div>
        )}

        {editor && (
          <div className="gallery-editor">
            <div className="gallery-editor-head">
              <strong>{editor.id ? '编辑画廊条目' : '添加画廊条目'}</strong>
              <button className="icon-button" onClick={() => setEditor(null)} aria-label="关闭编辑"><Icon name="close" size={15} /></button>
            </div>
            <div className="gallery-editor-body">
              <div className="gallery-editor-image">
                <div className="gallery-editor-preview">
                  {editor.uploaded ? <img src={editor.uploaded.dataUrl} alt="待添加图片" /> : editor.existingImage && !editor.removedExisting ? <img src={editor.existingImage} alt="当前图片" /> : <span>暂无图片<br />纯文本条目也可以</span>}
                </div>
                <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseImage(file); if (fileRef.current) fileRef.current.value = ''; }} />
                <button className="button secondary" onClick={() => fileRef.current?.click()}><Icon name="image" size={14} /> {editor.uploaded || (editor.existingImage && !editor.removedExisting) ? '替换图片' : '上传图片'}</button>
                <button className="button secondary" disabled={(!editor.uploaded && (!editor.existingImage || editor.removedExisting)) || editor.analyzing} onClick={() => void analyze()}>{editor.analyzing ? '正在识别…' : <><Icon name="sparkle" size={14} /> 视觉模型提炼提示词</>}</button>
                <small>上传图片后可自动提炼完整提示词与风格描述，提炼结果可手动修改。</small>
              </div>
              <div className="gallery-editor-fields">
                <label className="gallery-editor-field"><span>标题</span><input value={editor.title} onChange={(event) => patchEditor({ title: event.target.value })} placeholder="例如：赛博朋克霓虹街道" /></label>
                <label className="gallery-editor-field"><span>分类</span><select value={editor.category} onChange={(event) => patchEditor({ category: event.target.value })}>{categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.emoji} {cat.zh}</option>)}</select></label>
                <label className="gallery-editor-field"><span>完整提示词</span><textarea value={editor.prompt} onChange={(event) => patchEditor({ prompt: event.target.value })} rows={6} placeholder="可直接复现这类画面的完整提示词…" /></label>
                <label className="gallery-editor-field"><span>风格提示词（用于项目统一风格）</span><textarea value={editor.stylePrompt} onChange={(event) => patchEditor({ stylePrompt: event.target.value })} rows={2} placeholder="只描述风格：画风、媒介、配色、光影…" /></label>
              </div>
            </div>
            <div className="gallery-editor-actions">
              <button className="button secondary" onClick={() => setEditor(null)}>取消</button>
              <button className="button primary" disabled={editor.saving || (!editor.prompt.trim() && !editor.stylePrompt.trim())} onClick={() => void save()}>{editor.saving ? '保存中…' : '保存到画廊'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, readFileAsDataUrl } from './api';
import { GALLERY_CATEGORIES, GALLERY_ENTRIES, type GalleryCategory, type GalleryEntry } from './gallery';
import { Icon } from './Icon';
import { tf, useLanguage, type TranslationKey } from './i18n';
import type { GalleryEntryItem } from './types';

type Props = {
  visionModelId?: string;
  onClose: () => void;
  // `full` = the original prompt for this entry; `style` = the distilled
  // style-only prompt meant for project-level reuse.
  onUsePrompt: (entry: GalleryEntry) => void;
  onUseStyle: (entry: GalleryEntry) => void;
};

const MINE_CATEGORY: GalleryCategory = { id: 'mine', zh: '我的收藏', en: 'My favorites', emoji: '🗂️', count: 0 };

// Built-in entries are bundled static data; user entries come from the local
// server (SQLite + data/gallery). Both surfaces render as unified cards.
type GalleryItem = {
  key: string;
  title: string;
  category: string;
  image: string;
  size: string;
  sizeKey?: TranslationKey;
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
    reader.onerror = () => reject(new Error(tf('api.readImageFailed', '读取图片失败')));
    reader.readAsDataURL(blob);
  });
}

function userToItem(entry: GalleryEntryItem): GalleryItem {
  return {
    key: `u-${entry.id}`,
    title: entry.title,
    category: entry.category || 'mine',
    image: entry.image || '',
    size: '',
    sizeKey: entry.source === 'project' ? 'pg.fromProject' : 'pg.fromManual',
    prompt: entry.prompt,
    stylePrompt: entry.stylePrompt,
    userEntry: entry,
  };
}

export function PromptGalleryModal({ visionModelId, onClose, onUsePrompt, onUseStyle }: Props) {
  const { language, t } = useLanguage();
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
  const catName = (cat: GalleryCategory) => (language === 'en' && cat.en ? cat.en : cat.zh);
  const itemSize = (entry: GalleryItem) => (entry.sizeKey ? t(entry.sizeKey) : entry.size);

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
      const result = await api.analyzeGalleryImage({ data: source.dataUrl, mimeType: source.mimeType, visionModelId });
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
    if (!window.confirm(t('pg.deleteConfirm', { title: item.title }))) return;
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
            <h2 id="gallery-title">{t('pg.title')}</h2>
            <small>{t('pg.subtitle')}</small>
          </div>
          <button className="gallery-add-button" onClick={openCreate}><Icon name="plus" size={14} /> {t('pg.add')}</button>
          <label className="gallery-search">
            <Icon name="search" size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('pg.searchPlaceholder')} aria-label={t('pg.searchAria')} />
          </label>
          <button className="icon-button" onClick={onClose} aria-label={t('pg.closeAria')}><Icon name="close" size={16} /></button>
        </div>

        <div className="gallery-body">
          <aside className="gallery-cats">
            <button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>
              <span className="cat-emoji">✨</span><span className="cat-name">{t('pg.all')}</span><span className="cat-count">{countOf('all')}</span>
            </button>
            {categories.map((cat) => (
              <button key={cat.id} className={categoryId === cat.id ? 'active' : ''} onClick={() => setCategoryId(cat.id)}>
                <span className="cat-emoji">{cat.emoji}</span><span className="cat-name">{catName(cat)}</span><span className="cat-count">{countOf(cat.id)}</span>
              </button>
            ))}
          </aside>

          <div className="gallery-grid-wrap">
            {userLoading && <div className="gallery-empty">{t('pg.loadingFavorites')}</div>}
            {!userLoading && visible.length === 0 && <div className="gallery-empty">{t('pg.noMatch')}</div>}
            <div className="gallery-grid">
              {visible.map((entry) => (
                <article className={`gallery-card ${activeKey === entry.key ? 'active' : ''}`} key={entry.key} onClick={() => setActiveKey(activeKey === entry.key ? null : entry.key)}>
                  <div className="gallery-thumb">
                    {entry.image ? <img src={entry.image} alt={entry.title} loading="lazy" /> : <span className="gallery-thumb-empty">{t('pg.textOnly')}</span>}
                    <div className="gallery-card-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="gallery-use full" title={t('pg.usePromptTitle')} onClick={() => onUsePrompt({ ...entry, id: Number(entry.key.replace(/\D/g, '')) || 0 })}>{t('pg.usePrompt')}</button>
                      <button className="gallery-use style" title={t('pg.useStyleTitle')} onClick={() => onUseStyle({ ...entry, id: Number(entry.key.replace(/\D/g, '')) || 0 })}>{t('pg.useStyle')}</button>
                      {entry.userEntry && <div className="gallery-user-actions">
                        <button className="gallery-manage" title={t('pg.editTitle')} onClick={() => openEdit(entry)}><Icon name="edit" size={12} /> {t('pg.edit')}</button>
                        <button className="gallery-manage danger" title={t('pg.deleteTitle')} onClick={() => void remove(entry)}><Icon name="close" size={12} /> {t('pg.delete')}</button>
                      </div>}
                    </div>
                  </div>
                  <div className="gallery-meta">
                    <strong title={entry.title}>{entry.title}</strong>
                    <span>{itemSize(entry) || '—'}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        {active && (
          <div className="gallery-detail">
            {active.image ? <img src={active.image} alt={active.title} /> : <div className="gallery-detail-placeholder">{t('pg.textOnlyPrompt')}</div>}
            <div className="gallery-detail-copy">
              <div className="gallery-detail-head"><strong>{active.title}</strong><span>{itemSize(active) || '—'}</span></div>
              <div className="gallery-detail-block"><label>{t('pg.styleBlockLabel')}</label><p>{active.stylePrompt || '—'}</p></div>
              <div className="gallery-detail-block"><label>{t('pg.fullPromptLabel')}</label><p className="full-prompt">{active.prompt || '—'}</p></div>
              <div className="gallery-detail-actions">
                <button className="button secondary" onClick={() => onUseStyle({ ...active, id: Number(active.key.replace(/\D/g, '')) || 0 })}>{t('pg.useStyle')}</button>
                <button className="button primary" onClick={() => onUsePrompt({ ...active, id: Number(active.key.replace(/\D/g, '')) || 0 })}>{t('pg.usePrompt')}</button>
              </div>
            </div>
            <button className="icon-button gallery-detail-close" onClick={() => setActiveKey(null)} aria-label={t('pg.collapseDetail')}><Icon name="close" size={15} /></button>
          </div>
        )}

        {editor && (
          <div className="gallery-editor">
            <div className="gallery-editor-head">
              <strong>{editor.id ? t('pg.editEntry') : t('pg.addEntry')}</strong>
              <button className="icon-button" onClick={() => setEditor(null)} aria-label={t('pg.closeEditor')}><Icon name="close" size={15} /></button>
            </div>
            <div className="gallery-editor-body">
              <div className="gallery-editor-image">
                <div className="gallery-editor-preview">
                  {editor.uploaded ? <img src={editor.uploaded.dataUrl} alt={t('pg.newImageAlt')} /> : editor.existingImage && !editor.removedExisting ? <img src={editor.existingImage} alt={t('pg.currentImageAlt')} /> : <span>{t('pg.noImageLine1')}<br />{t('pg.noImageLine2')}</span>}
                </div>
                <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseImage(file); if (fileRef.current) fileRef.current.value = ''; }} />
                <button className="button secondary" onClick={() => fileRef.current?.click()}><Icon name="image" size={14} /> {editor.uploaded || (editor.existingImage && !editor.removedExisting) ? t('pg.replaceImage') : t('pg.uploadImage')}</button>
                <button className="button secondary" disabled={(!editor.uploaded && (!editor.existingImage || editor.removedExisting)) || editor.analyzing} onClick={() => void analyze()}>{editor.analyzing ? t('pg.analyzing') : <><Icon name="sparkle" size={14} /> {t('pg.analyzeAction')}</>}</button>
                <small>{t('pg.analyzeHint')}</small>
              </div>
              <div className="gallery-editor-fields">
                <label className="gallery-editor-field"><span>{t('pg.titleLabel')}</span><input value={editor.title} onChange={(event) => patchEditor({ title: event.target.value })} placeholder={t('pg.titlePlaceholder')} /></label>
                <label className="gallery-editor-field"><span>{t('pg.categoryLabel')}</span><select value={editor.category} onChange={(event) => patchEditor({ category: event.target.value })}>{categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.emoji} {catName(cat)}</option>)}</select></label>
                <label className="gallery-editor-field"><span>{t('pg.promptLabel')}</span><textarea value={editor.prompt} onChange={(event) => patchEditor({ prompt: event.target.value })} rows={6} placeholder={t('pg.promptPlaceholder')} /></label>
                <label className="gallery-editor-field"><span>{t('pg.styleLabel')}</span><textarea value={editor.stylePrompt} onChange={(event) => patchEditor({ stylePrompt: event.target.value })} rows={2} placeholder={t('pg.stylePlaceholder')} /></label>
              </div>
            </div>
            <div className="gallery-editor-actions">
              <button className="button secondary" onClick={() => setEditor(null)}>{t('common.cancel')}</button>
              <button className="button primary" disabled={editor.saving || (!editor.prompt.trim() && !editor.stylePrompt.trim())} onClick={() => void save()}>{editor.saving ? t('pg.saving') : t('pg.saveToGallery')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { GALLERY_CATEGORIES, GALLERY_ENTRIES, type GalleryEntry } from './gallery';
import { Icon } from './Icon';

type Props = {
  onClose: () => void;
  // `full` = the original prompt for this entry; `style` = the distilled
  // style-only prompt meant for project-level reuse.
  onUsePrompt: (entry: GalleryEntry) => void;
  onUseStyle: (entry: GalleryEntry) => void;
};

export function PromptGalleryModal({ onClose, onUsePrompt, onUseStyle }: Props) {
  const [categoryId, setCategoryId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GALLERY_ENTRIES.filter((entry) => {
      if (categoryId !== 'all' && entry.category !== categoryId) return false;
      if (!q) return true;
      return `${entry.title} ${entry.prompt} ${entry.stylePrompt}`.toLowerCase().includes(q);
    });
  }, [categoryId, query]);

  const active = activeId === null ? null : GALLERY_ENTRIES.find((entry) => entry.id === activeId) || null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="gallery-modal" role="dialog" aria-modal="true" aria-labelledby="gallery-title">
        <div className="modal-heading gallery-heading">
          <div>
            <p className="eyebrow">PROMPT GALLERY</p>
            <h2 id="gallery-title">提示词画廊</h2>
            <small>精选 161 条高质量提示词与效果图，可直接复用完整提示词，或只取风格描述作为项目统一风格。</small>
          </div>
          <label className="gallery-search">
            <Icon name="search" size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词 / 风格…" aria-label="搜索画廊" />
          </label>
          <button className="icon-button" onClick={onClose} aria-label="关闭画廊"><Icon name="close" size={16} /></button>
        </div>

        <div className="gallery-body">
          <aside className="gallery-cats">
            <button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>
              <span className="cat-emoji">✨</span><span className="cat-name">全部</span><span className="cat-count">{GALLERY_ENTRIES.length}</span>
            </button>
            {GALLERY_CATEGORIES.map((cat) => (
              <button key={cat.id} className={categoryId === cat.id ? 'active' : ''} onClick={() => setCategoryId(cat.id)}>
                <span className="cat-emoji">{cat.emoji}</span><span className="cat-name">{cat.zh}</span><span className="cat-count">{cat.count}</span>
              </button>
            ))}
          </aside>

          <div className="gallery-grid-wrap">
            {visible.length === 0 && <div className="gallery-empty">没有匹配的提示词</div>}
            <div className="gallery-grid">
              {visible.map((entry) => (
                <article className={`gallery-card ${activeId === entry.id ? 'active' : ''}`} key={entry.id} onClick={() => setActiveId(activeId === entry.id ? null : entry.id)}>
                  <div className="gallery-thumb">
                    <img src={entry.image} alt={entry.title} loading="lazy" />
                    <div className="gallery-card-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="gallery-use full" title="把完整提示词填入本次对话输入框" onClick={() => onUsePrompt(entry)}>用作对话提示词</button>
                      <button className="gallery-use style" title="只把风格描述填入项目风格提示词" onClick={() => onUseStyle(entry)}>用作项目风格</button>
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
            <img src={active.image} alt={active.title} />
            <div className="gallery-detail-copy">
              <div className="gallery-detail-head"><strong>{active.title}</strong><span>{active.size}</span></div>
              <div className="gallery-detail-block"><label>风格提示词（可用作项目统一风格）</label><p>{active.stylePrompt}</p></div>
              <div className="gallery-detail-block"><label>完整原始提示词</label><p className="full-prompt">{active.prompt}</p></div>
              <div className="gallery-detail-actions">
                <button className="button secondary" onClick={() => onUseStyle(active)}>用作项目风格</button>
                <button className="button primary" onClick={() => onUsePrompt(active)}>用作对话提示词</button>
              </div>
            </div>
            <button className="icon-button gallery-detail-close" onClick={() => setActiveId(null)} aria-label="收起详情"><Icon name="close" size={15} /></button>
          </div>
        )}
      </section>
    </div>
  );
}

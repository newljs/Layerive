import type { Dispatch, SetStateAction } from 'react';
import { Icon } from '../Icon';
import { useLanguage } from '../i18n';
import type { ExtractionMode, ModelConfig } from '../types';
import { extractionDescriptionKeys, extractionIcons, extractionModeKeys } from './definitions';
import type { TaskKind } from './types';

export type ExtractAssetPanelProps = {
  closeExtract: () => void;
  extractionType: ExtractionMode;
  generating: boolean;
  extractSubmitting: boolean;
  setExtractionType: Dispatch<SetStateAction<ExtractionMode>>;
  activeTask: { id: string | null; kind: TaskKind; stage?: "planning" | "compositing" | "generating" | "preserving" | "validating" | null | undefined; } | null;
  cancelActiveTask: () => Promise<void>;
  extractRect: { x: number; y: number; width: number; height: number; } | null | undefined;
  extractPreview: { imageId: string; rect: { x: number; y: number; width: number; height: number; }; dataUrl: string; mimeType: "image/png" | "image/jpeg"; width: number; height: number; padded: boolean; } | null;
  extractDragging: boolean;
  setExtractRect: Dispatch<SetStateAction<{ x: number; y: number; width: number; height: number; } | null | undefined>>;
  extractHint: string;
  setExtractHint: Dispatch<SetStateAction<string>>;
  selectedModel: ModelConfig | undefined;
  visionModels: ModelConfig[];
  submitExtract: () => Promise<void>;
};

export function ExtractAssetPanel({ closeExtract, extractionType, generating, extractSubmitting, setExtractionType, activeTask, cancelActiveTask, extractRect, extractPreview, extractDragging, setExtractRect, extractHint, setExtractHint, selectedModel, visionModels, submitExtract }: ExtractAssetPanelProps) {
  const { t } = useLanguage();
  return (<aside className="fusion-library extract-library" aria-label={t('ws.extract')}>
    <div className="fusion-library-header">
      <div className="fusion-header-row"><strong><Icon name="extract" size={19} />{t('ws.extract')}</strong><button className="fusion-exit-button" onClick={closeExtract}><Icon name="left" size={14} />{t('ws.exitExtract')}</button></div>
      <small>{t('extract.exitHint')}</small>
    </div>
    <div className="fusion-library-content">
      <strong className="fusion-section-title">{t('extract.modeLabel')}</strong>
      <div className="fusion-submenu extract-submenu" role="group" aria-label={t('extract.modeLabel')}>
        {(Object.keys(extractionModeKeys) as ExtractionMode[]).map(mode => <button key={mode} aria-pressed={extractionType === mode} className={extractionType === mode ? 'active' : ''} disabled={generating || extractSubmitting} onClick={() => setExtractionType(mode)}><Icon name={extractionIcons[mode]} size={19} /><span>{t(extractionModeKeys[mode])}</span></button>)}
      </div>
      <p className="fusion-mode-description">{t(extractionDescriptionKeys[extractionType])}</p>
      {(extractionType === 'clothing' || extractionType === 'accessory') && <div className="extract-showcase-note"><Icon name="sparkle" size={16} /><div><strong>{t('extract.showcase')}</strong><p>{t('extract.showcaseDescription')}</p></div></div>}
      {activeTask?.kind === 'extract-asset' && <section className="fusion-task-status" role="status" aria-live="polite"><span className="spinner" /><p>{t(activeTask.stage === 'generating' ? 'extract.generating' : 'extract.planning')}</p>{activeTask.id && <button className="cancel-task-button" onClick={() => void cancelActiveTask()}>{t('ws.cancelTask')}</button>}</section>}
      <section className="fusion-reference-section">
        <div className="fusion-section-heading"><strong className="fusion-section-title">{t('extract.preview')}</strong></div>
        {extractRect ? <div className="extract-preview">{extractPreview ? <img src={extractPreview.dataUrl} alt={t('ws.extractPreviewAlt')} /> : <span className="extract-preview-loading"><span className="spinner" />{t(extractDragging ? 'extract.selecting' : 'ws.cropping')}</span>}{extractPreview && <small>{extractPreview.padded ? t('ws.autoPadded') : ''}{extractPreview.width} × {extractPreview.height}</small>}</div> : <div className="fusion-empty"><Icon name="box" size={28} /><strong>{t('extract.selectFirst')}</strong><p>{t('ws.extractHintNoRect')}</p></div>}
        <button className="fusion-project-button" disabled={generating || extractSubmitting} onClick={() => setExtractRect({ x: 0, y: 0, width: 100, height: 100 })}><Icon name="image" size={15} />{t('extract.wholeImage')}</button>
      </section>
    </div>
    <div className="fusion-library-footer">
      <div className="fusion-instruction-heading"><label htmlFor="extract-hint">{t('extract.hint')}</label><small>{extractHint.length}/1000</small></div>
      <textarea id="extract-hint" rows={2} maxLength={1000} disabled={generating || extractSubmitting} value={extractHint} onChange={event => setExtractHint(event.target.value)} placeholder={t('ws.extractInputPlaceholder')} />
      <div className="extract-panel-actions"><button className="button secondary" disabled={!extractRect || generating || extractSubmitting} onClick={() => setExtractRect(null)}>{t('ws.reselect')}</button><button className="button primary" disabled={!extractPreview || extractDragging || extractSubmitting || generating || !selectedModel?.capabilities.includes('edit_prompt') || !visionModels.length} onClick={() => void submitExtract()}>{extractSubmitting ? t('extract.starting') : t('ws.extractSubmit')}</button></div>
    </div>
  </aside>);
}

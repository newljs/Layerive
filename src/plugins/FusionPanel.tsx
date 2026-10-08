import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Icon } from '../Icon';
import { thumbUrl } from '../api';
import { useLanguage } from '../i18n';
import type { FusionMode, ProjectImage } from '../types';
import { fusionDescriptionKeys, fusionTypeIcons, fusionTypeKeys } from './definitions';
import type { TaskKind } from './types';

export type FusionPanelProps = {
  toggleFusion: () => void;
  fusionType: FusionMode;
  generating: boolean;
  setFusionType: Dispatch<SetStateAction<FusionMode>>;
  setFusionPoint: Dispatch<SetStateAction<{ x: number; y: number; } | null>>;
  activeTask: { id: string | null; kind: TaskKind; stage?: "planning" | "compositing" | "generating" | "preserving" | "validating" | null | undefined; } | null;
  cancelActiveTask: () => Promise<void>;
  fusionImages: ProjectImage[];
  fusionFileRef: RefObject<HTMLInputElement | null>;
  uploadFusionImages: (files: File[]) => Promise<void>;
  fusionUploading: boolean;
  fusionPickerOpen: boolean;
  setFusionPickerOpen: Dispatch<SetStateAction<boolean>>;
  fusionReady: boolean;
  fusionHistory: ProjectImage[];
  setFusionImageIds: Dispatch<SetStateAction<string[]>>;
  fusionSelectedId: string | null;
  currentImageId: string | null;
  setFusionSelectedId: Dispatch<SetStateAction<string | null>>;
  fusionSubmitLock: RefObject<boolean>;
  fusionInstruction: string;
  setFusionInstruction: Dispatch<SetStateAction<string>>;
};

export function FusionPanel({ toggleFusion, fusionType, generating, setFusionType, setFusionPoint, activeTask, cancelActiveTask, fusionImages, fusionFileRef, uploadFusionImages, fusionUploading, fusionPickerOpen, setFusionPickerOpen, fusionReady, fusionHistory, setFusionImageIds, fusionSelectedId, currentImageId, setFusionSelectedId, fusionSubmitLock, fusionInstruction, setFusionInstruction }: FusionPanelProps) {
  const { t } = useLanguage();
  return (<aside className="fusion-library" aria-label={t('fusion.library')}>
    <div className="fusion-library-header">
      <div className="fusion-header-row"><strong><Icon name="layers" size={19} />{t('op.fusion')}</strong><button className="fusion-exit-button" onClick={toggleFusion} title={t('fusion.exitHint')}><Icon name="left" size={14} />{t('fusion.exit')}</button></div>
      <small>{t('fusion.exitHint')}</small>
    </div>
    <div className="fusion-library-content">
      <section className="fusion-mode-section">
        <strong className="fusion-section-title">{t('fusion.modeLabel')}</strong>
        <div className="fusion-submenu" role="tablist" aria-label={t('fusion.modeLabel')}>
          {(Object.keys(fusionTypeKeys) as FusionMode[]).map(mode => <button key={mode} role="tab" aria-selected={fusionType === mode} className={fusionType === mode ? 'active' : ''} disabled={generating} onClick={() => { setFusionType(mode); setFusionPoint(null); }}><Icon name={fusionTypeIcons[mode]} size={19} /><span>{t(fusionTypeKeys[mode])}</span></button>)}
        </div>
        <p className="fusion-mode-description">{t(fusionDescriptionKeys[fusionType])}</p>
      </section>
      {activeTask?.kind === 'fusion' && <section className="fusion-task-status" role="status" aria-live="polite"><span className="spinner" /><p>{t(activeTask.stage === 'generating' ? 'fusion.generating' : 'fusion.planning')}</p>{activeTask.id && <button className="cancel-task-button" onClick={() => void cancelActiveTask()}>{t('ws.cancelTask')}</button>}</section>}
      <section className="fusion-reference-section">
        <div className="fusion-section-heading"><strong className="fusion-section-title">{t('fusion.library')}</strong><span className="fusion-count">{fusionImages.length}</span></div>
        <input type="file" ref={fusionFileRef} accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => void uploadFusionImages(Array.from(event.target.files || []))} />
        <button className="fusion-upload-button" aria-label={t(fusionUploading ? 'ws.reading' : 'fusion.upload')} disabled={fusionUploading || generating} onClick={() => fusionFileRef.current?.click()}><span className="fusion-upload-icon"><Icon name="plus" size={20} /></span><span><strong>{t(fusionUploading ? 'ws.reading' : 'fusion.upload')}</strong><small>{t('fusion.fileTypes')}</small></span><kbd>Ctrl+V</kbd></button>
        <button className="fusion-project-button" aria-expanded={fusionPickerOpen} disabled={generating} onClick={() => setFusionPickerOpen(open => !open)}><Icon name="gallery" size={15} />{t('fusion.fromProject')}<Icon name={fusionPickerOpen ? 'up' : 'down'} size={12} /></button>
        {!fusionReady && <small className="fusion-warning">{t('fusion.requiresModels')}</small>}
        <div className="fusion-library-scroll">
          {fusionPickerOpen && <section className="fusion-history-picker"><strong>{t('fusion.chooseImage')}</strong>{fusionHistory.length ? fusionHistory.map(image => <button key={image.id} disabled={generating} onClick={() => { setFusionImageIds(ids => [...new Set([...ids, image.id])]); setFusionPickerOpen(false); }} title={t('fusion.add')}><img src={thumbUrl(image, 160)} alt={t('fusion.historyAlt')} loading="lazy" /></button>) : <small>{t('fusion.noHistory')}</small>}</section>}
          {!fusionImages.length && <div className="fusion-empty"><Icon name="image" size={28} /><strong>{t('fusion.emptyTitle')}</strong><p>{t('fusion.emptyDescription')}</p></div>}
          {fusionImages.map((image, index) => <div className={`fusion-thumbnail ${fusionSelectedId === image.id ? 'selected' : ''}`} key={image.id}>
            <button className="fusion-drag-source" draggable={fusionReady && !generating && !fusionUploading} disabled={!fusionReady || generating || fusionUploading || image.id === currentImageId} onClick={() => setFusionSelectedId(id => id === image.id ? null : image.id)} onDragStart={event => { setFusionSelectedId(null); event.dataTransfer.setData('application/x-layerive-fusion', image.id); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => { if (!fusionSubmitLock.current && !generating) setFusionPoint(null); }} title={t('fusion.dragImage')} aria-label={t('fusion.referenceAlt', { index: index + 1 })} aria-pressed={fusionSelectedId === image.id}><img src={thumbUrl(image, 240)} alt={t('fusion.referenceAlt', { index: index + 1 })} draggable={false} loading="lazy" /><span className="fusion-thumbnail-caption"><span>{t('fusion.referenceLabel', { index: index + 1 })}</span><Icon name={fusionSelectedId === image.id ? 'check' : 'layers'} size={14} /></span></button>
            <button className="fusion-remove" disabled={generating} aria-label={t('common.remove')} onClick={() => { setFusionImageIds(ids => ids.filter(id => id !== image.id)); if (fusionSelectedId === image.id) setFusionSelectedId(null); }}><Icon name="close" size={12} /></button>
          </div>)}
        </div>
      </section>
    </div>
    <div className="fusion-library-footer">
      <div className="fusion-drop-guide"><Icon name="branch" size={16} /><span>{t(fusionSelectedId ? 'fusion.selectedHint' : 'fusion.dropHint')}</span></div>
      <div className="fusion-instruction-heading"><label htmlFor="fusion-instruction">{t('fusion.instruction')}</label><small>{fusionInstruction.length}/1000</small></div>
      <textarea id="fusion-instruction" rows={2} maxLength={1000} disabled={generating} placeholder={t('fusion.instructionPlaceholder')} value={fusionInstruction} onChange={event => setFusionInstruction(event.target.value)} />
    </div>
  </aside>);
}

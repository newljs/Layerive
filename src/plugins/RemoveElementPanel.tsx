import type { Dispatch, SetStateAction } from 'react';
import { Icon } from '../Icon';
import { useLanguage } from '../i18n';
import type { CleanupMode, ModelConfig } from '../types';
import { cleanupDescriptionKeys, cleanupIcons, cleanupModeKeys, removeElementStageKey } from './definitions';
import type { TaskKind } from './types';

export type RemoveElementPanelProps = {
  closeRemoveElement: () => void;
  cleanupType: CleanupMode;
  generating: boolean;
  removeElementSubmitting: boolean;
  selectCleanupMode: (mode: CleanupMode) => void;
  cleanupKeepPoints: { x: number; y: number; }[];
  setCleanupKeepPoints: Dispatch<SetStateAction<{ x: number; y: number; }[]>>;
  activeTask: { id: string | null; kind: TaskKind; stage?: "planning" | "compositing" | "generating" | "preserving" | "validating" | null | undefined; } | null;
  cancelActiveTask: () => Promise<void>;
  selectedModel: ModelConfig | undefined;
  visionModels: ModelConfig[];
  removeElementDragging: boolean;
  cleanupInstruction: string;
  setCleanupInstruction: Dispatch<SetStateAction<string>>;
  submitRemoveElement: (rect?: { x: number; y: number; width: number; height: number; } | undefined) => Promise<void>;
};

export function RemoveElementPanel({ closeRemoveElement, cleanupType, generating, removeElementSubmitting, selectCleanupMode, cleanupKeepPoints, setCleanupKeepPoints, activeTask, cancelActiveTask, selectedModel, visionModels, removeElementDragging, cleanupInstruction, setCleanupInstruction, submitRemoveElement }: RemoveElementPanelProps) {
  const { t } = useLanguage();
  const textCleanup = cleanupType === 'text';
  const missingModels = !selectedModel?.capabilities.includes('edit_prompt') || (!textCleanup && !visionModels.length);
  return (<aside className="fusion-library cleanup-library" aria-label={t('ws.removeElement')}>
    <div className="fusion-library-header">
      <div className="fusion-header-row"><strong><Icon name="trash" size={19} />{t('ws.removeElement')}</strong><button className="fusion-exit-button" onClick={closeRemoveElement}><Icon name="left" size={14} />{t('ws.exitRemoveElement')}</button></div>
      <small>{t('cleanup.exitHint')}</small>
    </div>
    <div className="fusion-library-content">
      <strong className="fusion-section-title">{t('cleanup.modeLabel')}</strong>
      <div className="fusion-submenu cleanup-submenu" role="group" aria-label={t('cleanup.modeLabel')}>
        {(Object.keys(cleanupModeKeys) as CleanupMode[]).map(mode => <button key={mode} aria-pressed={cleanupType === mode} className={cleanupType === mode ? 'active' : ''} disabled={generating || removeElementSubmitting} onClick={() => selectCleanupMode(mode)}><Icon name={cleanupIcons[mode]} size={19} /><span>{t(cleanupModeKeys[mode])}</span></button>)}
      </div>
      <p className="fusion-mode-description">{t(cleanupDescriptionKeys[cleanupType])}</p>
      {cleanupType !== 'selection' && <div className="extract-showcase-note"><Icon name="sparkle" size={16} /><div><strong>{t(textCleanup ? 'cleanup.textWholeImage' : 'cleanup.wholeImage')}</strong><p>{t(textCleanup ? 'cleanup.textWholeImageDescription' : 'cleanup.wholeImageDescription')}</p></div></div>}
      {cleanupType === 'people' && <section className="fusion-reference-section">
        <div className="fusion-section-heading"><strong className="fusion-section-title">{t('cleanup.keepPeople')}</strong><span className="fusion-count">{cleanupKeepPoints.length}</span></div>
        <p className="fusion-mode-description">{t('cleanup.keepPeopleHint')}</p>
        <div className="cleanup-point-list">{cleanupKeepPoints.map((_, index) => <button key={index} disabled={generating || removeElementSubmitting} onClick={() => setCleanupKeepPoints(points => points.filter((_, i) => i !== index))} aria-label={t('cleanup.removePoint', { index: index + 1 })}>{t('cleanup.personPoint', { index: index + 1 })}<Icon name="close" size={12} /></button>)}</div>
      </section>}
      {activeTask?.kind === 'remove-element' && <section className="fusion-task-status" role="status" aria-live="polite"><span className="spinner" /><p>{t(removeElementStageKey(cleanupType, activeTask.stage))}</p>{activeTask.id && <button className="cancel-task-button" onClick={() => void cancelActiveTask()}>{t('ws.cancelTask')}</button>}</section>}
      {missingModels && <small className="fusion-warning">{t(textCleanup ? 'cleanup.requiresImageModel' : 'cleanup.requiresModels')}</small>}
    </div>
    <div className="fusion-library-footer">
      {cleanupType === 'selection' ? <div className="fusion-drop-guide"><Icon name="box" size={16} /><span>{t(removeElementDragging ? 'cleanup.selecting' : 'ws.removeElementHint')}</span></div> : <>
        <div className="fusion-instruction-heading"><label htmlFor="cleanup-instruction">{t('cleanup.instruction')}</label><small>{cleanupInstruction.length}/1000</small></div>
        <textarea id="cleanup-instruction" rows={2} maxLength={1000} disabled={generating || removeElementSubmitting} value={cleanupInstruction} onChange={event => setCleanupInstruction(event.target.value)} placeholder={t(textCleanup ? 'cleanup.textInstructionPlaceholder' : 'cleanup.instructionPlaceholder')} />
        <button className="button primary cleanup-submit" disabled={generating || removeElementSubmitting || missingModels} onClick={() => void submitRemoveElement()}>{removeElementSubmitting ? t('extract.starting') : t('cleanup.start')}</button>
      </>}
    </div>
  </aside>);
}

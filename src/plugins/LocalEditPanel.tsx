import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Icon } from '../Icon';
import { useLanguage } from '../i18n';
import type { LocalEditReference } from '../types';

export type LocalEditPanelProps = {
  localEditRect: { x: number; y: number; width: number; height: number; } | null | undefined;
  localEditSubmitting: boolean;
  closeLocalEdit: () => void;
  localReferenceFileRef: RefObject<HTMLInputElement | null>;
  selectLocalReference: (file?: File | undefined) => Promise<void>;
  localReference: LocalEditReference | null;
  localReferenceLoading: boolean;
  generating: boolean;
  localReferenceRevision: RefObject<number>;
  setLocalReference: Dispatch<SetStateAction<LocalEditReference | null>>;
  localEditInstruction: string;
  setLocalEditInstruction: Dispatch<SetStateAction<string>>;
  localBatchSubmitting: boolean;
  setLocalEditRect: Dispatch<SetStateAction<{ x: number; y: number; width: number; height: number; } | null | undefined>>;
  setLocalBatchOpen: Dispatch<SetStateAction<boolean>>;
  submitLocalEdit: () => Promise<void>;
  localBatchOpen: boolean;
  localBatchText: string;
  setLocalBatchText: Dispatch<SetStateAction<string>>;
  localBatchLines: string[];
  localBatchError: string | null;
  submitLocalBatch: () => Promise<void>;
};

export function LocalEditPanel({ localEditRect, localEditSubmitting, closeLocalEdit, localReferenceFileRef, selectLocalReference, localReference, localReferenceLoading, generating, localReferenceRevision, setLocalReference, localEditInstruction, setLocalEditInstruction, localBatchSubmitting, setLocalEditRect, setLocalBatchOpen, submitLocalEdit, localBatchOpen, localBatchText, setLocalBatchText, localBatchLines, localBatchError, submitLocalBatch }: LocalEditPanelProps) {
  const { t } = useLanguage();
  return (<div className="local-edit-dock">
    <section className="local-edit-panel" role="dialog" aria-label={t('ws.localEdit')}>
      <div className="local-edit-panel-head"><div><strong>{t('ws.localEdit')}</strong><span>{localEditRect ? t('ws.localPanelHintRect') : t('ws.localPanelHint')}</span></div><button className="local-edit-exit" disabled={localEditSubmitting} onClick={closeLocalEdit}><Icon name="close" size={13} /> {t('common.exit')}</button></div>
      {localEditRect && <>
        <input ref={localReferenceFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void selectLocalReference(file); }} />
        <div className="local-reference">
          {localReference && <img src={localReference.data} alt={t('ws.referenceAlt')} />}
          <div><strong>{localReference ? localReference.name || t('ws.referenceChosen') : t('ws.referenceOptional')}</strong><span>{localReference ? t('ws.referenceFusion') : t('ws.referenceExample')}</span>
            <div className="local-reference-actions"><button className="button secondary" disabled={localReferenceLoading || localEditSubmitting || generating} onClick={() => localReferenceFileRef.current?.click()}>{localReferenceLoading ? t('ws.reading') : localReference ? t('ws.changeImage') : t('ws.uploadReference')}</button>{localReference && <button className="button secondary" disabled={localReferenceLoading || localEditSubmitting || generating} onClick={() => { localReferenceRevision.current++; setLocalReference(null); }}>{t('common.remove')}</button>}</div>
            <small>{t('ws.referenceLimits')}</small>
          </div>
        </div>
        <textarea aria-label={t('ws.instructionAria')} disabled={localEditSubmitting} value={localEditInstruction} onChange={(event) => setLocalEditInstruction(event.target.value)} placeholder={localReference ? t('ws.instructionPlaceholderRef') : t('ws.instructionPlaceholder')} rows={2} />
        {localReference && <p className="local-reference-note">{t('ws.localNote')}</p>}
        <div className="local-edit-panel-actions"><button className="button secondary" disabled={localEditSubmitting || localBatchSubmitting || generating} onClick={() => setLocalEditRect(null)}>{t('ws.reselect')}</button><button className="button secondary" disabled={localEditSubmitting || localBatchSubmitting || generating} onClick={() => setLocalBatchOpen((open) => !open)}>{t('ws.batchModify')}</button><button className="button primary" disabled={(!localEditInstruction.trim() && !localReference) || localReferenceLoading || localEditSubmitting || localBatchSubmitting || generating} onClick={() => void submitLocalEdit()}>{localEditSubmitting ? t('ws.submitting') : localReference ? t('ws.smartReplace') : t('ws.applyLocalEdit')}</button></div>
      </>}
    </section>
    {localEditRect && localBatchOpen && <aside className="local-batch-panel" role="dialog" aria-label={t('ws.localBatch')}>
      <div className="local-edit-panel-head"><div><strong>{t('ws.localBatch')}</strong><span>{t('ws.localBatchHint')}</span></div><button className="local-edit-exit" disabled={localBatchSubmitting} onClick={() => setLocalBatchOpen(false)}><Icon name="close" size={13} /> {t('ws.collapse')}</button></div>
      <textarea aria-label={t('ws.localBatchListAria')} value={localBatchText} onChange={(event) => setLocalBatchText(event.target.value)} rows={7} spellCheck={false} placeholder={t('ws.localBatchPlaceholder')} />
      <small className={localBatchLines.length >= 2 && !localBatchError ? 'local-batch-count valid' : 'local-batch-count'}>{localBatchLines.length ? t('ws.localBatchCount', { count: localBatchLines.length }) : t('ws.localBatchCountEmpty')}</small>
      {localReference && <p className="local-batch-reference">{t('ws.localBatchReference', { name: localReference.name || t('ws.referenceFallback') })}</p>}
      {localBatchLines.length > 0 && localBatchError && <p className="batch-validation-error">{localBatchError}</p>}
      <div className="local-edit-panel-actions"><button className="button secondary" disabled={localBatchSubmitting} onClick={() => setLocalBatchOpen(false)}>{t('ws.collapse')}</button><button className="button primary" disabled={Boolean(localBatchError) || localBatchSubmitting || generating || localReferenceLoading} onClick={() => void submitLocalBatch()}>{localBatchSubmitting ? t('ws.creatingBatch') : t('ws.localBatchStart', { count: localBatchLines.length })}</button></div>
    </aside>}
  </div>);
}

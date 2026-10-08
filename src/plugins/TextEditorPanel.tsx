import type { Dispatch, SetStateAction, MouseEventHandler } from 'react';
import { Icon } from '../Icon';
import { useLanguage } from '../i18n';
import type { ProjectImage, TextSegment } from '../types';
type Rect = TextSegment['rect'];
type Props = {
  textImage: ProjectImage;
  textEditSubmitting: boolean; generating: boolean; recognizingText: boolean; boxMode: boolean; hasTextChanges: boolean;
  recognitionModel: string; textEditorError: string; textSegments: TextSegment[]; draftRect: Rect | null;
  setTextEditorOpen: Dispatch<SetStateAction<boolean>>; setBoxMode: Dispatch<SetStateAction<boolean>>; setDraftRect: Dispatch<SetStateAction<Rect | null>>;
  onBoxStart: MouseEventHandler<HTMLDivElement>; onBoxMove: MouseEventHandler<HTMLDivElement>; onBoxEnd: MouseEventHandler<HTMLDivElement>;
  openTextEditor: () => Promise<void>; submitTextEdit: () => Promise<void>;
  updateTextSegment: (id: string, patch: Partial<TextSegment>) => void; removeTextSegment: (id: string) => void;
};

export function TextEditorPanel({ textImage, textEditSubmitting, generating, setTextEditorOpen, recognitionModel, boxMode, onBoxStart, onBoxMove, onBoxEnd, textSegments, draftRect, setBoxMode, setDraftRect, recognizingText, textEditorError, openTextEditor, updateTextSegment, removeTextSegment, hasTextChanges, submitTextEdit }: Props) {
  const { t } = useLanguage();
  return (<div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !textEditSubmitting && !generating && setTextEditorOpen(false)}>
        <section className="text-editor-modal" role="dialog" aria-modal="true" aria-labelledby="text-editor-title">
          <div className="modal-heading"><div><p className="eyebrow">TEXT EDIT</p><h2 id="text-editor-title">{t('ws.textEditorTitle')}</h2><small>{recognitionModel ? t('ws.recognizedBy', { model: recognitionModel }) : t('ws.recognizingShort')}</small></div><button className="icon-button" disabled={textEditSubmitting || generating} onClick={() => setTextEditorOpen(false)}><Icon name="close" size={16} /></button></div>
          <div className="text-editor-layout">
            <div className={`text-editor-preview ${boxMode ? 'box-mode' : ''}`} onMouseDown={onBoxStart} onMouseMove={onBoxMove} onMouseUp={onBoxEnd} onMouseLeave={onBoxEnd}>
              <img src={textImage.url} alt={t('ws.textEditImageAlt')} draggable={false} />
              {textSegments.filter((segment) => segment.rect).map((segment) => <span key={segment.id} className="manual-rect" style={{ left: `${segment.rect!.x}%`, top: `${segment.rect!.y}%`, width: `${segment.rect!.width}%`, height: `${segment.rect!.height}%` }} />)}
              {draftRect && <span className="manual-rect drafting" style={{ left: `${draftRect.x}%`, top: `${draftRect.y}%`, width: `${draftRect.width}%`, height: `${draftRect.height}%` }} />}
              <span>{textImage.width || '—'} × {textImage.height || '—'}</span>
              <button className={`box-mode-toggle ${boxMode ? 'active' : ''}`} onClick={() => { setBoxMode((mode) => !mode); setDraftRect(null); }}>{boxMode ? t('ws.finishBox') : <><Icon name="box" size={13} /> {t('ws.manualBox')}</>}</button>
            </div>
            <div className="text-segment-list">
              {recognizingText && <div className="text-editor-status"><span className="spinner" />{t('ws.recognizingText')}</div>}
              {textEditorError && <div className="text-editor-status error"><strong>{t('ws.recognizeFailed')}</strong><p>{textEditorError}</p><button className="button secondary" onClick={() => void openTextEditor()}>{t('ws.reRecognize')}</button></div>}
              {!recognizingText && !textEditorError && <>
                <p className="text-editor-tip">{t('ws.textEditorTip')}</p>
                {textSegments.map((segment, index) => <div className="text-segment-field" key={segment.id}>
                  <span>{segment.manual ? t('ws.manualArea') : t('ws.textIndex', { index: index + 1 })} · {segment.context || t('ws.imageTextArea')}</span>
                  {(segment.manual || segment.originalText) && <input className="segment-original" value={segment.originalText} placeholder={segment.manual ? t('ws.originalPlaceholder') : ''} onChange={(event) => updateTextSegment(segment.id, { originalText: event.target.value })} />}
                  <input value={segment.text} placeholder={segment.manual ? t('ws.newTextPlaceholder') : ''} onChange={(event) => updateTextSegment(segment.id, { text: event.target.value })} />
                  <small>{segment.manual ? t('ws.manualAreaSmall') : t('ws.originalTextValue', { text: segment.originalText })}</small>
                  {segment.manual && <button className="segment-remove" onClick={() => removeTextSegment(segment.id)}>{t('common.remove')}</button>}
                </div>)}
              </>}
            </div>
          </div>
          <div className="modal-actions text-editor-actions"><button className="button secondary" disabled={textEditSubmitting || generating} onClick={() => setTextEditorOpen(false)}>{t('common.cancel')}</button><button className="button primary" disabled={recognizingText || Boolean(textEditorError) || textEditSubmitting || generating || !hasTextChanges} onClick={() => void submitTextEdit()}>{generating ? t('ws.queued') : textEditSubmitting ? t('ws.submitting') : t('ws.submitTextEdit')}</button></div>
        </section>
      </div>);
}

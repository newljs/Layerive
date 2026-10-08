import { useEffect, useRef, useState } from 'react';
import { api, readFileAsDataUrl } from '../api';
import { Icon } from '../Icon';
import { useLanguage } from '../i18n';
import type { ImagePluginManifest, ProjectBundle, ProjectImage } from '../types';

export function RecipeDialog({ plugin, projectId, source, images, disabled, taskId, stage, onCancel, onClose, onSubmit, onUploaded }: {
  projectId: string; taskId?: string | null; stage?: string | null; onCancel: () => void;
  plugin: ImagePluginManifest; source: ProjectImage; images: ProjectImage[]; disabled: boolean;
  onClose: () => void; onSubmit: (fields: Record<string, string | number | boolean>) => Promise<void>;
  onUploaded: (bundle: ProjectBundle) => void;
}) {
  const { t, language } = useLanguage();
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => Object.fromEntries(plugin.ui!.fields.map(field => [field.key, field.default ?? (field.type === 'boolean' ? false : '')])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    formRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    // Disabling/removing the focused submit or cancel button can move focus
    // back to body. Keep keyboard and paste events inside the open dialog.
    if (!formRef.current?.contains(document.activeElement)) formRef.current?.focus();
  }, [disabled, busy]);
  const validImages = images.filter(image => image.id !== source.id);
  const update = (key: string, value: string | number | boolean) => setValues(current => ({ ...current, [key]: value }));
  async function upload(key: string, file?: File) {
    if (!file || lock.current || disabled) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError(t('ws.uploadTypeUnsupported'));
    if (file.size > 10 * 1024 * 1024) return setError(t('ws.uploadTooLarge'));
    formRef.current?.focus();
    lock.current = true; setBusy(true); setError('');
    try {
      const known = new Set(images.map(image => image.id));
      const data = await api.uploadImage(projectId, { data: await readFileAsDataUrl(file), mimeType: file.type, name: file.name, referenceOnly: true });
      const image = data.images.find(image => !known.has(image.id));
      if (!image) throw new Error(t('plugin.uploadFailed'));
      onUploaded(data); update(key, image.id);
    } catch (error) { setError((error as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || disabled) return;
    formRef.current?.focus();
    lock.current = true; setBusy(true); setError('');
    try { await onSubmit(values); }
    catch (error) { setError((error as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="modal-backdrop" onPaste={event => event.stopPropagation()}>
    <form ref={formRef} tabIndex={-1} className="recipe-dialog" onSubmit={event => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="recipe-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="modal-heading"><div><h2 id="recipe-title">{plugin.ui!.name[language]}</h2><p>{plugin.ui!.description[language]}</p></div><button type="button" className="icon-button" disabled={busy} aria-label={t('common.close')} onClick={onClose}><Icon name="close" size={16} /></button></header>
      <div className="recipe-fields">
        <img className="recipe-source" src={source.url} alt={t('ws.inputImageAlt')} />
        {plugin.ui!.fields.map(field => <div className="recipe-field" key={field.key}>
          <label htmlFor={'recipe-' + field.key}>{field.label[language]}{field.required ? ' *' : ''}</label>
          {field.type === 'text' && <textarea id={'recipe-' + field.key} required={field.required} maxLength={field.maxLength} disabled={disabled || busy} value={String(values[field.key] ?? '')} onChange={event => update(field.key, event.target.value)} />}
          {field.type === 'boolean' && <input id={'recipe-' + field.key} type="checkbox" disabled={disabled || busy} checked={Boolean(values[field.key])} onChange={event => update(field.key, event.target.checked)} />}
          {field.type === 'number' && <input id={'recipe-' + field.key} type="number" step="any" min={field.min} max={field.max} required={field.required} disabled={disabled || busy} value={String(values[field.key] ?? '')} onChange={event => update(field.key, event.target.value === '' ? '' : Number(event.target.value))} />}
          {(field.type === 'select' || field.type === 'image') && <select id={'recipe-' + field.key} required={field.required} disabled={disabled || busy} value={String(values[field.key] ?? '')} onChange={event => update(field.key, event.target.value)}>
            <option value="">{t('plugin.choose')}</option>
            {field.type === 'select' ? field.options!.map(option => <option key={option.value} value={option.value}>{option.label[language]}</option>) : validImages.map((image, index) => <option key={image.id} value={image.id}>{t('plugin.imageOption', { index: index + 1, width: image.width || 0, height: image.height || 0 })}</option>)}
          </select>}
          {field.type === 'image' && <><label className="recipe-upload">{t('plugin.uploadReference')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(field.key, file); }} /></label>{values[field.key] && <img className="recipe-reference" src={validImages.find(image => image.id === values[field.key])?.url} alt={field.label[language]} />}</>}
        </div>)}
      </div>
      <footer className="recipe-footer">{error && <p role="alert">{error}</p>}{disabled && <p role="status">{t(stage === 'planning' ? 'plugin.planning' : stage === 'validating' ? 'plugin.validating' : 'plugin.generating')}{taskId && <button type="button" className="cancel-task-button" onClick={onCancel}>{t('ws.cancelTask')}</button>}</p>}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t('common.close')}</button><button type="submit" className="button primary" disabled={disabled || busy}>{busy ? t('ws.submitting') : t('plugin.run')}</button></div></footer>
    </form>
  </div>;
}

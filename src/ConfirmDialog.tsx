import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useLanguage } from './i18n';

type ConfirmOptions = {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  icon?: IconName;
  onConfirm: () => Promise<void>;
};
type PendingConfirmation = { id: number; options: ConfirmOptions; resolve: (confirmed: boolean) => void };
const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const sequence = useRef(0);
  const confirm = useCallback((options: ConfirmOptions) => {
    // Only one destructive action can be reviewed at a time.
    if (pendingRef.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const next = { id: ++sequence.current, options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);
  const finish = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(confirmed);
  }, []);
  useEffect(() => () => {
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
  }, []);
  return <ConfirmContext.Provider value={confirm}>
    {children}
    {pending && createPortal(<ConfirmDialog key={pending.id} options={pending.options} onFinish={finish} />, document.body)}
  </ConfirmContext.Provider>;
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm requires ConfirmProvider');
  return confirm;
}

function ConfirmDialog({ options, onFinish }: { options: ConfirmOptions; onFinish: (confirmed: boolean) => void }) {
  const { t } = useLanguage();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current!;
    const previous = document.activeElement;
    // The top layer keeps this above gallery/tool dialogs and makes the
    // underlying page inert. Native modal focus handling confines Tab here.
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      mounted.current = false;
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!busy) cancelRef.current?.focus();
  }, [busy]);
  function cancel() {
    if (!busyRef.current) onFinish(false);
  }
  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    dialogRef.current?.focus();
    try {
      await options.onConfirm();
      if (mounted.current) onFinish(true);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : t('confirm.failed'));
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        cancelRef.current?.focus();
      }
    }
  }
  return <dialog ref={dialogRef} className="confirm-dialog modal-card" tabIndex={-1} role="alertdialog"
    aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`} aria-busy={busy}
    onCancel={event => { event.preventDefault(); cancel(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = controls[0]; const last = controls.at(-1);
      const focused = document.activeElement;
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (focused === first || focused === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (focused === last || focused === event.currentTarget)) { event.preventDefault(); first.focus(); }
    }} onPaste={event => event.stopPropagation()}>
    <header className="modal-heading confirm-heading">
      <div className="confirm-title"><span className="confirm-icon"><Icon name={options.icon || 'trash'} size={22} /></span><h2 id={`${id}-title`}>{options.title}</h2></div>
      <button type="button" className="icon-button" disabled={busy} aria-label={t('common.close')} onClick={cancel}><Icon name="close" size={16} /></button>
    </header>
    <div className="modal-body confirm-body" id={`${id}-message`}>
      <p>{options.message}</p>
      {options.detail && <p className="confirm-detail">{options.detail}</p>}
      {error && <p className="confirm-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-actions">
      <button ref={cancelRef} type="button" className="button secondary" disabled={busy} onClick={cancel}>{t('common.cancel')}</button>
      <button type="button" className="button confirm-danger" disabled={busy} onClick={() => void submit()}>{busy ? t('confirm.processing') : options.confirmLabel}</button>
    </footer>
  </dialog>;
}

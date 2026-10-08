import { Icon } from '../Icon';
import { useLanguage } from '../i18n';
import { sizesForProvider } from '../sizes';
import type { ModelConfig } from '../types';

export function OutpaintPanel({ outpaintSize, outpaintSubmitting, generating, selectedModel, closeOutpaint, setOutpaintSize, submitOutpaint }: {
  outpaintSize: string; outpaintSubmitting: boolean; generating: boolean; selectedModel?: ModelConfig;
  closeOutpaint: () => void; setOutpaintSize: (size: string) => void; submitOutpaint: () => Promise<void>;
}) {
  const { t } = useLanguage();
  return (<section className="outpaint-panel"><div className="outpaint-panel-head"><div><strong>{t('ws.outpaint')}</strong><span>{t('ws.outpaintPickRatio')}</span></div><button className="outpaint-exit" onClick={closeOutpaint}><Icon name="close" size={13} /> {t('common.exit')}</button></div><div className="outpaint-size-list">{sizesForProvider(selectedModel).map((option) => <button key={option.value} className={option.value === outpaintSize ? 'active' : ''} onClick={() => setOutpaintSize(option.value)}><strong>{option.ratio}</strong><span>{option.value}</span></button>)}</div><p className="outpaint-summary">{t('ws.outpaintSummary')}</p><div className="outpaint-panel-actions"><button className="button secondary" onClick={closeOutpaint}>{t('common.cancel')}</button><button className="button primary" disabled={!outpaintSize || outpaintSubmitting || generating} onClick={() => void submitOutpaint()}>{outpaintSubmitting ? t('ws.outpaintSubmitting') : t('ws.confirmOutpaint')}</button></div></section>);
}

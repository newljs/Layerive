import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { LanguageToggle, useLanguage } from './i18n';
import { useTheme } from './theme';
import type { ModelConfig } from './types';

type Props = {
  models: ModelConfig[];
  activeModel: string;
  activeVisionModel: string;
  onBack: () => void;
  onSave: (model: Partial<ModelConfig>, id?: string) => Promise<ModelConfig | undefined>;
  onDelete: (id: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
  onActivateVision: (id: string) => Promise<void>;
  onTestConfig: (model: Partial<ModelConfig>) => Promise<string>;
  onRevealApiKey: (id: string) => Promise<string>;
};

const senseNovaUrl = 'https://token.sensenova.cn/v1';
const senseNovaVisionUrl = 'https://api.sensenova.cn/v1';
const openAiUrl = 'https://api.openai.com/v1';
const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta';
const grokUrl = 'https://api.x.ai/v1';
const defaultVisionApiFormat: NonNullable<ModelConfig['apiFormat']> = 'chat_completions';

function providerBaseUrl(type: ModelConfig['type'], provider: ModelConfig['provider']) {
  if (provider === 'local') return type === 'vision' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:8000/v1';
  if (provider === 'sensenova') return type === 'vision' ? senseNovaVisionUrl : senseNovaUrl;
  if (provider === 'gemini') return geminiUrl;
  if (provider === 'grok') return grokUrl;
  if (provider === 'custom') return '';
  return openAiUrl;
}

function imageFormatForProvider(provider: ModelConfig['provider']): NonNullable<ModelConfig['imageApiFormat']> {
  if (provider === 'gemini') return 'gemini_interactions';
  if (provider === 'grok') return 'grok_images';
  return 'openai_images';
}

function imageOptionsForPreset(provider: ModelConfig['provider']) {
  if (provider === 'local') return { sizeOptions: ['1024x1024'], outputFormats: ['png'] as const, transparentBackground: false, maxCount: 1 };
  if (provider === 'sensenova') return { sizeOptions: ['1664x2496', '2496x1664', '1760x2368', '2368x1760', '1824x2272', '2272x1824', '2048x2048', '2752x1536', '1536x2752', '3072x1376', '1344x3136'], outputFormats: ['png'] as const, transparentBackground: false, maxCount: 4 };
  if (provider === 'gemini') return { sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg'] as const, transparentBackground: false, maxCount: 1 };
  if (provider === 'grok') return { sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['jpeg'] as const, transparentBackground: false, maxCount: 4 };
  if (provider === 'custom') return { sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png'] as const, transparentBackground: false, maxCount: 1 };
  return { sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg', 'webp'] as const, transparentBackground: true, maxCount: 4 };
}

function outputFormatsForProtocol(format: NonNullable<ModelConfig['imageApiFormat']>) {
  return format === 'gemini_interactions' ? ['png', 'jpeg'] as const : format === 'grok_images' ? ['jpeg'] as const : ['png', 'jpeg', 'webp'] as const;
}

function blankFor(type: ModelConfig['type'] = 'image'): ModelConfig {
  return type === 'vision'
    ? { id: '', name: '', type, provider: 'openai', apiFormat: defaultVisionApiFormat, baseUrl: openAiUrl, apiKey: '', model: 'gpt-4.1-mini', capabilities: ['image_understanding'], defaultParams: {} }
    : { id: '', name: '', type, provider: 'openai', imageApiFormat: 'openai_images', baseUrl: openAiUrl, apiKey: '', model: 'gpt-image-2', capabilities: ['text_to_image', 'image_to_image', 'edit_prompt'], defaultParams: { size: '1024x1024', count: 1, quality: 'auto' }, sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: true, maxCount: 4 };
}

function defaultModel(type: ModelConfig['type'], provider: ModelConfig['provider']) {
  if (provider === 'local') return '';
  if (type === 'vision') return provider === 'sensenova' ? 'SenseChat-V6.5' : 'gpt-4.1-mini';
  if (provider === 'sensenova') return 'sensenova-u1.5-lite';
  if (provider === 'gemini') return 'gemini-3.1-flash-image';
  if (provider === 'grok') return 'grok-imagine-image-2.0';
  if (provider === 'custom') return '';
  return 'gpt-image-2';
}

function localForm(type: ModelConfig['type']): ModelConfig {
  return { ...blankFor(type), provider: 'local', baseUrl: providerBaseUrl(type, 'local'), model: '', capabilities: type === 'image' ? ['text_to_image'] : ['image_understanding'], ...imageOptionsForPreset('local'), outputFormats: ['png'] };
}

export function ModelConfigView({ models, activeModel, activeVisionModel, onBack, onSave, onDelete, onActivate, onActivateVision, onTestConfig, onRevealApiKey }: Props) {
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [selectedId, setSelectedId] = useState(models[0]?.id || '');
  const [form, setForm] = useState<ModelConfig>(models[0] || blankFor());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [revealingApiKey, setRevealingApiKey] = useState(false);
  const imageModels = useMemo(() => models.filter((model) => model.type !== 'vision'), [models]);
  const visionModels = useMemo(() => models.filter((model) => model.type === 'vision'), [models]);
  const isSenseNova = form.provider === 'sensenova';
  const isGemini = form.provider === 'gemini';
  const isGrok = form.provider === 'grok';
  const isLocal = form.provider === 'local';

  useEffect(() => {
    if (creating) return;
    const selected = models.find((item) => item.id === selectedId);
    if (selected) setForm(selected);
    else if (models[0]) { setSelectedId(models[0].id); setForm(models[0]); }
  }, [models, selectedId, creating]);

  function choose(id: string) {
    const selected = models.find((item) => item.id === id);
    if (selected) { setCreating(false); setSelectedId(id); setForm(selected); setTestResult(''); setShowApiKey(false); }
  }
  function startCreate(type: ModelConfig['type'], local = false) { setCreating(true); setSelectedId(''); setForm(local ? localForm(type) : blankFor(type)); setTestResult(''); setShowApiKey(false); }
  function update<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function changeType(type: ModelConfig['type']) {
    setTestResult('');
    if (isLocal) {
      setForm(current => ({ ...localForm(type), id: current.id, name: current.name, apiKey: current.apiKey }));
      return;
    }
    setForm((current) => ({ ...current, type, provider: 'openai', apiFormat: type === 'vision' ? defaultVisionApiFormat : undefined, imageApiFormat: type === 'image' ? 'openai_images' : undefined, baseUrl: openAiUrl, model: defaultModel(type, 'openai'), capabilities: type === 'vision' ? ['image_understanding'] : ['text_to_image', 'image_to_image', 'edit_prompt'], defaultParams: type === 'vision' ? {} : { size: '1024x1024', count: 1, quality: 'auto' }, ...(type === 'image' ? { sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: true, maxCount: 4 } : {}) }));
  }
  function changeProvider(provider: ModelConfig['provider']) {
    setTestResult(''); setShowApiKey(false);
    if (provider === 'local') {
      setForm(current => ({ ...localForm(current.type), id: current.id, name: current.name }));
      return;
    }
    setForm((current) => {
      const options = imageOptionsForPreset(provider);
      return { ...current, provider, ...(current.provider === 'local' ? { apiKey: '', capabilities: current.type === 'vision' ? ['image_understanding'] : ['text_to_image', 'image_to_image', 'edit_prompt'] } : {}), baseUrl: providerBaseUrl(current.type, provider), model: defaultModel(current.type, provider), ...(current.type === 'image' ? { imageApiFormat: imageFormatForProvider(provider), sizeOptions: options.sizeOptions, outputFormats: [...options.outputFormats], transparentBackground: options.transparentBackground, maxCount: options.maxCount, defaultParams: { ...current.defaultParams, size: options.sizeOptions[0], count: 1 } } : {}) };
    });
  }
  function changeImageApiFormat(imageApiFormat: NonNullable<ModelConfig['imageApiFormat']>) {
    const allowed = outputFormatsForProtocol(imageApiFormat);
    setForm((current) => {
      const outputFormats = (current.outputFormats || []).filter((format): format is typeof allowed[number] => (allowed as readonly string[]).includes(format));
      return { ...current, imageApiFormat, outputFormats: outputFormats.length ? outputFormats : [allowed[0]], transparentBackground: imageApiFormat === 'openai_images' && Boolean(current.transparentBackground) };
    });
  }
  function toggleCapability(capability: string) {
    update('capabilities', form.capabilities.includes(capability) ? form.capabilities.filter((item) => item !== capability) : [...form.capabilities, capability]);
  }
  async function toggleApiKeyVisibility() {
    if (showApiKey) { setShowApiKey(false); return; }
    if (selectedId && form.apiKey === '••••••••') {
      setRevealingApiKey(true);
      try {
        const apiKey = await onRevealApiKey(selectedId);
        if (!apiKey) return;
        setForm((current) => current.id === selectedId ? { ...current, apiKey } : current);
      } finally { setRevealingApiKey(false); }
    }
    setShowApiKey(true);
  }
  async function save() {
    setSaving(true);
    try {
      const saved = await onSave(form, selectedId || undefined);
      if (saved) setShowApiKey(false);
      if (!selectedId && saved?.id) { setCreating(false); setSelectedId(saved.id); setForm(saved); }
    } finally { setSaving(false); }
  }
  function renderItem(model: ModelConfig) {
    const typeLabel = model.type === 'vision' ? t('mc.typeVision') : t('mc.typeImage');
    const visionFormatLabel = model.apiFormat === 'anthropic_messages' ? 'A' : model.apiFormat === 'responses' ? 'R' : 'C';
    return <button key={model.id} className={`model-list-item ${selectedId === model.id ? 'active' : ''}`} onClick={() => choose(model.id)}>
      <span className={`model-provider ${model.provider === 'local' ? 'local' : model.type === 'vision' ? 'vision-api' : model.provider}`}>{model.provider === 'local' ? <Icon name="home" size={18} /> : model.type === 'vision' ? visionFormatLabel : model.provider === 'sensenova' ? '日' : model.provider === 'gemini' ? 'Gm' : model.provider === 'grok' ? 'Gr' : 'O'}</span>
      <span className="model-label"><strong>{model.name}</strong><small>{typeLabel} · {model.model}</small></span>
      {model.type !== 'vision' && activeModel === model.id && <span className="default-tag">{t('mc.defaultTag')}</span>}
      {model.type === 'vision' && activeVisionModel === model.id && <span className="default-tag">{t('mc.visionDefaultTag')}</span>}
    </button>;
  }

  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <button className="back-button" onClick={onBack}><Icon name="left" size={15} /> {t('mc.back')}</button>
        <div><p className="eyebrow">GLOBAL SETTINGS</p><h1>{t('mc.title')}</h1></div>
        <div className="save-state"><button className="icon-button theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? t('common.switchToLight') : t('common.switchToDark')} aria-label={t('common.toggleTheme')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /></button><LanguageToggle /><span className="status-dot" />{t('mc.savedLocally')}</div>
      </header>

      <section className="models-layout">
        <aside className="model-list-panel">
          <div className="panel-heading"><div><h2>{t('mc.listTitle')}</h2><p>{t('mc.listCount', { count: models.length })}</p></div><Icon name="models" size={20} /></div>
          <div className="model-add-actions">
            <button title={t('mc.addImageTitle')} onClick={() => startCreate('image')}><Icon name="image" size={17} /><span>{t('mc.addImageTitle')}</span><Icon name="plus" size={14} /></button>
            <button title={t('mc.addVisionTitle')} onClick={() => startCreate('vision')}><Icon name="eye" size={17} /><span>{t('mc.addVisionTitle')}</span><Icon name="plus" size={14} /></button>
          </div>
          <button className="model-local-add" onClick={() => startCreate('image', true)}><Icon name="home" size={17} /><span>{t('mc.addLocal')}</span><Icon name="plus" size={14} /></button>
          <div className="model-list">
            <p className="model-group-title">{t('mc.groupImage')}</p>{imageModels.map(renderItem)}
            <p className="model-group-title vision">{t('mc.groupVision')}</p>{visionModels.map(renderItem)}
            {!visionModels.length && <button className="empty-model-group" onClick={() => startCreate('vision')}><Icon name="plus" size={14} /> {t('mc.addVision')}</button>}
          </div>
          <div className="model-help"><strong>{t('mc.aboutKeys')}</strong><p>{t('mc.keysHint')}</p></div>
        </aside>

        <section className="model-form-panel">
          <div className="form-title-row"><div><p className="eyebrow">{selectedId ? 'EDIT MODEL' : 'NEW MODEL'}</p><h2>{selectedId ? t('mc.editTitle') : t('mc.addTitle')}</h2></div>{form.type === 'image' && activeModel !== selectedId && selectedId && <button className="button secondary" onClick={() => void onActivate(selectedId)}>{t('mc.setDefault')}</button>}{form.type === 'vision' && activeVisionModel !== selectedId && selectedId && <button className="button secondary" onClick={() => void onActivateVision(selectedId)}>{t('mc.setVisionDefault')}</button>}</div>
          <div className="form-grid two-columns">
            <label className="field"><span>{t('mc.typeLabel')}</span><select value={form.type} onChange={(event) => changeType(event.target.value as ModelConfig['type'])}><option value="image">{t('mc.optionImage')}</option><option value="vision">{t('mc.optionVision')}</option></select></label>
            <label className="field"><span>{t('mc.nameLabel')}</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder={form.type === 'vision' ? t('mc.namePlaceholderVision') : t('mc.namePlaceholderImage')} /></label>
          </div>
          <label className="field"><span>{t('mc.connectionType')}</span><select value={isLocal ? 'local' : 'remote'} onChange={event => changeProvider(event.target.value === 'local' ? 'local' : 'openai')}><option value="remote">{t('mc.remoteService')}</option><option value="local">{t('mc.localService')}</option></select></label>
          {isLocal && <div className="provider-guide local-guide"><strong>{t('mc.localGuideTitle')}</strong><p>{t(form.type === 'vision' ? 'mc.localVisionHelp' : 'mc.localImageHelp')}</p></div>}
          {form.type === 'vision'
            ? <label className="field"><span>{t('mc.apiFormat')}</span><select value={form.apiFormat || defaultVisionApiFormat} onChange={(event) => update('apiFormat', event.target.value as NonNullable<ModelConfig['apiFormat']>)}>{!isLocal && <option value="anthropic_messages">Anthropic Messages (/v1/messages)</option>}<option value="chat_completions">Chat Completions (/chat/completions)</option><option value="responses">Responses (/responses)</option></select></label>
            : !isLocal && <label className="field"><span>{t('mc.preset')}</span><select value={form.provider} onChange={(event) => changeProvider(event.target.value as ModelConfig['provider'])}><option value="sensenova">{t('mc.presetSenseNova')}</option><option value="openai">OpenAI</option><option value="gemini">Gemini · Nano Banana</option><option value="grok">Grok · Imagine</option><option value="custom">{t('mc.presetCustom')}</option></select><small className="field-help">{t('mc.presetHelp')}</small></label>}

          {form.type === 'image' && <label className="field"><span>{t('mc.imageApiFormat')}</span><select value={form.imageApiFormat || 'openai_images'} onChange={(event) => changeImageApiFormat(event.target.value as NonNullable<ModelConfig['imageApiFormat']>)}><option value="openai_images">OpenAI Images (/images/generations、/images/edits)</option>{!isLocal && <><option value="gemini_interactions">Gemini Interactions (/interactions)</option><option value="grok_images">Grok Images (/images/generations、/images/edits)</option></>}</select><small className="field-help">{t('mc.protocolHelp')}</small></label>}

          {isLocal ? null : form.type === 'vision' ? <div className="provider-guide"><strong>{t('mc.guideVisionTitle')}</strong><p>{t('mc.guideVisionBody')}</p></div> : isSenseNova ? <div className="provider-guide sensenova-guide"><strong>{t('mc.guideSenseNovaTitle')}</strong><p>{t('mc.guideSenseNovaBody')}</p></div> : isGemini ? <div className="provider-guide gemini-guide"><strong>{t('mc.guideGeminiTitle')}</strong><p>{t('mc.guideGeminiBody')}</p></div> : isGrok ? <div className="provider-guide grok-guide"><strong>{t('mc.guideGrokTitle')}</strong><p>{t('mc.guideGrokBody')}</p></div> : <div className="provider-guide"><strong>{form.provider === 'custom' ? t('mc.guideCustomTitle') : t('mc.guideOpenAiTitle')}</strong><p>{t('mc.guideCustomBody')}</p></div>}

          <label className="field"><span>{form.type === 'vision' ? 'API Base URL' : isSenseNova ? t('mc.baseUrlSenseNova') : isGemini ? 'Gemini API Base URL' : isGrok ? 'xAI API Base URL' : 'API Base URL'}</span><input disabled={form.type === 'image' && isSenseNova} value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder={providerBaseUrl(form.type, form.provider)} /><small className="field-help">{isLocal ? t('mc.localBaseUrlHelp') : form.type === 'vision' ? t('mc.baseUrlVisionHelp') : isSenseNova ? t('mc.baseUrlSenseNovaHelp', { url: providerBaseUrl(form.type, form.provider) }) : isGemini ? t('mc.baseUrlGeminiHelp') : isGrok ? t('mc.baseUrlGrokHelp') : t('mc.baseUrlOpenAiHelp')}</small></label>
          <div className="form-grid two-columns">
            <label className="field"><span>{isLocal ? t('mc.localKey') : form.type === 'vision' ? 'API Key' : isSenseNova ? t('mc.keySenseNova') : isGemini ? 'Gemini API Key' : isGrok ? 'xAI API Key' : 'OpenAI API Key'}</span><div className="secret-input"><input type={showApiKey ? 'text' : 'password'} value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={isLocal ? t('mc.localKeyPlaceholder') : isGemini ? 'AIza...' : 'sk-...'} /><button type="button" disabled={revealingApiKey} onClick={() => void toggleApiKeyVisibility()} title={showApiKey ? t('mc.hideKey') : t('mc.showKey')} aria-label={showApiKey ? t('mc.hideKey') : t('mc.showKey')} aria-pressed={showApiKey}>{revealingApiKey ? <span className="secret-loading" /> : <Icon name={showApiKey ? 'eyeOff' : 'eye'} size={17} />}</button></div></label>
            <label className="field"><span>{form.type === 'vision' ? t('mc.modelNameVision') : t('mc.modelNameImage')}</span><input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder={isLocal ? t('mc.localModelPlaceholder') : defaultModel(form.type, form.provider)} /></label>
          </div>

          {form.type === 'image' ? <>
            <fieldset className="capability-field"><legend>{t('mc.capabilities')}</legend><div className="capability-options">
              {[['text_to_image', t('cap.text_to_image')], ['image_to_image', t('cap.image_to_image')], ['edit_prompt', t('cap.edit_prompt')], ['edit_text', t('cap.edit_text')], ['remove_watermark', t('cap.remove_watermark')]].map(([value, label]) => (
                <label key={value} className={form.capabilities.includes(value) ? 'checked' : ''}><input type="checkbox" checked={form.capabilities.includes(value)} onChange={() => toggleCapability(value)} /><span>{label}</span></label>
              ))}
            </div></fieldset>
            <div className="form-grid three-columns">
              <label className="field"><span>{t('mc.defaultSize')}</span><select value={form.defaultParams.size || form.sizeOptions?.[0] || '1024x1024'} onChange={(event) => update('defaultParams', { ...form.defaultParams, size: event.target.value })}>{(form.sizeOptions?.length ? form.sizeOptions : ['1024x1024']).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="field"><span>{t('mc.defaultCount')}</span><select value={Math.min(form.defaultParams.count || 1, form.maxCount || 1)} onChange={(event) => update('defaultParams', { ...form.defaultParams, count: Number(event.target.value) })}>{Array.from({ length: form.maxCount || 1 }, (_, index) => <option key={index + 1} value={index + 1}>{t('common.countImages', { count: index + 1 })}</option>)}</select></label>
              <label className="field"><span>{t('mc.defaultQuality')}</span><select disabled={isGemini} value={form.defaultParams.quality || 'auto'} onChange={(event) => update('defaultParams', { ...form.defaultParams, quality: event.target.value })}><option value="auto">{t('mc.qualityAuto')}</option><option value="low">{t('mc.qualityLow')}</option><option value="medium">{t('mc.qualityMedium')}</option><option value="high">{t('mc.qualityHigh')}</option></select></label>
            </div>
            <div className="form-grid two-columns">
              <label className="field"><span>{t('mc.sizeOptions')}</span><input value={(form.sizeOptions || []).join(', ')} onChange={(event) => update('sizeOptions', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder={t('mc.sizeOptionsPlaceholder')} /><small className="field-help">{t('mc.sizeOptionsHelp')}</small></label>
              <label className="field"><span>{t('mc.maxCount')}</span><select value={form.maxCount || 1} onChange={(event) => update('maxCount', Number(event.target.value))}><option value="1">{t('common.countImages', { count: 1 })}</option><option value="2">{t('common.countImages', { count: 2 })}</option><option value="3">{t('common.countImages', { count: 3 })}</option><option value="4">{t('common.countImages', { count: 4 })}</option></select></label>
            </div>
            <fieldset className="capability-field"><legend>{t('mc.output')}</legend><div className="capability-options">
              {outputFormatsForProtocol(form.imageApiFormat || 'openai_images').map((value) => <label key={value} className={form.outputFormats?.includes(value) ? 'checked' : ''}><input type="checkbox" checked={form.outputFormats?.includes(value) || false} onChange={() => update('outputFormats', form.outputFormats?.includes(value) ? form.outputFormats.filter((item) => item !== value) : [...(form.outputFormats || []), value])} /><span>{value.toUpperCase()}</span></label>)}
              {form.imageApiFormat === 'openai_images' && <label className={form.transparentBackground ? 'checked' : ''}><input type="checkbox" checked={Boolean(form.transparentBackground)} onChange={() => update('transparentBackground', !form.transparentBackground)} /><span>{t('mc.transparentBackground')}</span></label>}
            </div></fieldset>
          </> : <div className="vision-guide"><strong>{t('mc.visionUseTitle')}</strong><p>{t('mc.visionUseBody')}</p></div>}
          {testResult && <div className="test-result">{testResult}</div>}
          <div className="form-footer">
            <div>{selectedId && <button className="text-danger" onClick={() => { if (window.confirm(t('mc.deleteConfirm'))) void onDelete(selectedId); }}>{t('mc.deleteModel')}</button>}</div>
            <div className="footer-actions"><button className="button secondary" disabled={!form.name.trim() || !form.model.trim()} onClick={async () => setTestResult(await onTestConfig(form))}>{t('mc.testConnection')}</button><button className="button primary" disabled={!form.name.trim() || !form.model.trim() || saving} onClick={() => void save()}>{saving ? t('mc.saving') : t('mc.save')}</button></div>
          </div>
        </section>
      </section>
    </main>
  );
}

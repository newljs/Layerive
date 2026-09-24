import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
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
  if (type === 'vision') return provider === 'sensenova' ? 'SenseChat-V6.5' : 'gpt-4.1-mini';
  if (provider === 'sensenova') return 'sensenova-u1.5-lite';
  if (provider === 'gemini') return 'gemini-3.1-flash-image';
  if (provider === 'grok') return 'grok-imagine-image-2.0';
  if (provider === 'custom') return '';
  return 'gpt-image-2';
}

export function ModelConfigView({ models, activeModel, activeVisionModel, onBack, onSave, onDelete, onActivate, onActivateVision, onTestConfig, onRevealApiKey }: Props) {
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
  function startCreate(type: ModelConfig['type']) { setCreating(true); setSelectedId(''); setForm(blankFor(type)); setTestResult(''); setShowApiKey(false); }
  function update<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function changeType(type: ModelConfig['type']) {
    setForm((current) => ({ ...current, type, provider: 'openai', apiFormat: type === 'vision' ? defaultVisionApiFormat : undefined, imageApiFormat: type === 'image' ? 'openai_images' : undefined, baseUrl: openAiUrl, model: defaultModel(type, 'openai'), capabilities: type === 'vision' ? ['image_understanding'] : ['text_to_image', 'image_to_image', 'edit_prompt'], defaultParams: type === 'vision' ? {} : { size: '1024x1024', count: 1, quality: 'auto' }, ...(type === 'image' ? { sizeOptions: ['1024x1024', '1536x1024', '1024x1536'], outputFormats: ['png', 'jpeg', 'webp'], transparentBackground: true, maxCount: 4 } : {}) }));
  }
  function changeProvider(provider: ModelConfig['provider']) {
    setForm((current) => {
      const options = imageOptionsForPreset(provider);
      return { ...current, provider, baseUrl: providerBaseUrl(current.type, provider), model: defaultModel(current.type, provider), ...(current.type === 'image' ? { imageApiFormat: imageFormatForProvider(provider), sizeOptions: options.sizeOptions, outputFormats: [...options.outputFormats], transparentBackground: options.transparentBackground, maxCount: options.maxCount, defaultParams: { ...current.defaultParams, size: options.sizeOptions[0], count: 1 } } : {}) };
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
    const typeLabel = model.type === 'vision' ? '视觉识别' : '图片生成';
    const visionFormatLabel = model.apiFormat === 'anthropic_messages' ? 'A' : model.apiFormat === 'responses' ? 'R' : 'C';
    return <button key={model.id} className={`model-list-item ${selectedId === model.id ? 'active' : ''}`} onClick={() => choose(model.id)}>
      <span className={`model-provider ${model.type === 'vision' ? 'vision-api' : model.provider}`}>{model.type === 'vision' ? visionFormatLabel : model.provider === 'sensenova' ? '日' : model.provider === 'gemini' ? 'Gm' : model.provider === 'grok' ? 'Gr' : 'O'}</span>
      <span className="model-label"><strong>{model.name}</strong><small>{typeLabel} · {model.model}</small></span>
      {model.type !== 'vision' && activeModel === model.id && <span className="default-tag">默认</span>}
      {model.type === 'vision' && activeVisionModel === model.id && <span className="default-tag">识别默认</span>}
    </button>;
  }

  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <button className="back-button" onClick={onBack}><Icon name="left" size={15} /> 返回项目</button>
        <div><p className="eyebrow">GLOBAL SETTINGS</p><h1>模型配置</h1></div>
        <div className="save-state"><button className="icon-button theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'} aria-label="切换配色模式"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /></button><span className="status-dot" />配置保存在本机</div>
      </header>

      <section className="models-layout">
        <aside className="model-list-panel">
          <div className="panel-heading"><div><h2>模型列表</h2><p>{models.length} 个可用配置</p></div><div className="model-add-actions"><button title="添加图片生成模型" onClick={() => startCreate('image')}><Icon name="plus" size={13} /> 图</button><button title="添加视觉识别模型" onClick={() => startCreate('vision')}><Icon name="plus" size={13} /> 识</button></div></div>
          <div className="model-list">
            <p className="model-group-title">图片生成模型</p>{imageModels.map(renderItem)}
            <p className="model-group-title vision">视觉识别模型</p>{visionModels.map(renderItem)}
            {!visionModels.length && <button className="empty-model-group" onClick={() => startCreate('vision')}><Icon name="plus" size={14} /> 添加视觉识别模型</button>}
          </div>
          <div className="model-help"><strong>关于密钥</strong><p>密钥仅保存在本机配置文件中，不会写入项目对话和任务历史。</p></div>
        </aside>

        <section className="model-form-panel">
          <div className="form-title-row"><div><p className="eyebrow">{selectedId ? 'EDIT MODEL' : 'NEW MODEL'}</p><h2>{selectedId ? '编辑模型配置' : '添加模型配置'}</h2></div>{form.type === 'image' && activeModel !== selectedId && selectedId && <button className="button secondary" onClick={() => void onActivate(selectedId)}>设为默认</button>}{form.type === 'vision' && activeVisionModel !== selectedId && selectedId && <button className="button secondary" onClick={() => void onActivateVision(selectedId)}>设为识别默认</button>}</div>
          <div className="form-grid two-columns">
            <label className="field"><span>配置类型</span><select value={form.type} onChange={(event) => changeType(event.target.value as ModelConfig['type'])}><option value="image">图片生成模型</option><option value="vision">视觉识别模型</option></select></label>
            <label className="field"><span>显示名称 *</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder={form.type === 'vision' ? '例如：图片理解模型' : '例如：日日新 U1.5'} /></label>
          </div>
          {form.type === 'vision'
            ? <label className="field"><span>API 格式</span><select value={form.apiFormat || defaultVisionApiFormat} onChange={(event) => update('apiFormat', event.target.value as NonNullable<ModelConfig['apiFormat']>)}><option value="anthropic_messages">Anthropic Messages (/v1/messages)</option><option value="chat_completions">Chat Completions (/chat/completions)</option><option value="responses">Responses (/responses)</option></select></label>
            : <label className="field"><span>预设</span><select value={form.provider} onChange={(event) => changeProvider(event.target.value as ModelConfig['provider'])}><option value="sensenova">日日新</option><option value="openai">OpenAI</option><option value="gemini">Gemini · Nano Banana</option><option value="grok">Grok · Imagine</option><option value="custom">自定义</option></select><small className="field-help">预设只用于填入初始值和说明，不决定实际请求协议。</small></label>}

          {form.type === 'image' && <label className="field"><span>图片 API 协议</span><select value={form.imageApiFormat || 'openai_images'} onChange={(event) => changeImageApiFormat(event.target.value as NonNullable<ModelConfig['imageApiFormat']>)}><option value="openai_images">OpenAI Images (/images/generations、/images/edits)</option><option value="gemini_interactions">Gemini Interactions (/interactions)</option><option value="grok_images">Grok Images (/images/generations、/images/edits)</option></select><small className="field-help">可与任意预设组合；协议决定请求体、认证方式和返回解析。</small></label>}

          {form.type === 'vision' ? <div className="provider-guide"><strong>视觉接口配置</strong><p>请选择服务支持的请求格式；Base URL 填写服务根地址，系统会自动拼接所选接口路径。旧配置会沿用原请求格式。</p></div> : isSenseNova ? <div className="provider-guide sensenova-guide"><strong>日日新配置</strong><p>这是日日新的预设。仍可单独选择协议和模型能力；其官方图片接口会固定启用无水印参数。</p></div> : isGemini ? <div className="provider-guide gemini-guide"><strong>Gemini Nano Banana 配置</strong><p>这是 Gemini 的预设。使用其原生 Interactions 协议时需使用 Google API Key。</p></div> : isGrok ? <div className="provider-guide grok-guide"><strong>Grok Imagine 配置</strong><p>这是 xAI 的预设。可改用其他协议，以适配兼容服务。</p></div> : <div className="provider-guide"><strong>{form.provider === 'custom' ? '自定义配置' : 'OpenAI 配置'}</strong><p>请按服务实际支持的协议填写根地址、认证密钥和模型名；模型能力决定工作台展示的选项。</p></div>}

          <label className="field"><span>{form.type === 'vision' ? 'API Base URL' : isSenseNova ? '日日新服务地址' : isGemini ? 'Gemini API Base URL' : isGrok ? 'xAI API Base URL' : 'API Base URL'}</span><input disabled={form.type === 'image' && isSenseNova} value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder={providerBaseUrl(form.type, form.provider)} /><small className="field-help">{form.type === 'vision' ? '填写服务根地址；也兼容直接填写完整接口地址。' : isSenseNova ? `固定使用 ${providerBaseUrl(form.type, form.provider)}。` : isGemini ? '官方地址为 https://generativelanguage.googleapis.com/v1beta。' : isGrok ? '官方地址为 https://api.x.ai/v1。' : '例如 https://api.openai.com/v1 或中转站提供的 /v1 根地址。'}</small></label>
          <div className="form-grid two-columns">
            <label className="field"><span>{form.type === 'vision' ? 'API Key' : isSenseNova ? '日日新 API Key' : isGemini ? 'Gemini API Key' : isGrok ? 'xAI API Key' : 'OpenAI API Key'}</span><div className="secret-input"><input type={showApiKey ? 'text' : 'password'} value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={isGemini ? 'AIza...' : 'sk-...'} /><button type="button" disabled={revealingApiKey} onClick={() => void toggleApiKeyVisibility()} title={showApiKey ? '隐藏 API Key' : '显示 API Key'} aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'} aria-pressed={showApiKey}>{revealingApiKey ? <span className="secret-loading" /> : <Icon name={showApiKey ? 'eyeOff' : 'eye'} size={17} />}</button></div></label>
            <label className="field"><span>{form.type === 'vision' ? '视觉识别模型名称 *' : '图片生成模型名称 *'}</span><input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder={defaultModel(form.type, form.provider)} /></label>
          </div>

          {form.type === 'image' ? <>
            <fieldset className="capability-field"><legend>支持能力</legend><div className="capability-options">
              {[['text_to_image', '文生图'], ['image_to_image', '图生图'], ['edit_prompt', '提示词改图'], ['edit_text', '文字编辑'], ['remove_watermark', '去水印']].map(([value, label]) => (
                <label key={value} className={form.capabilities.includes(value) ? 'checked' : ''}><input type="checkbox" checked={form.capabilities.includes(value)} onChange={() => toggleCapability(value)} /><span>{label}</span></label>
              ))}
            </div></fieldset>
            <div className="form-grid three-columns">
              <label className="field"><span>默认尺寸</span><select value={form.defaultParams.size || form.sizeOptions?.[0] || '1024x1024'} onChange={(event) => update('defaultParams', { ...form.defaultParams, size: event.target.value })}>{(form.sizeOptions?.length ? form.sizeOptions : ['1024x1024']).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="field"><span>默认数量</span><select value={Math.min(form.defaultParams.count || 1, form.maxCount || 1)} onChange={(event) => update('defaultParams', { ...form.defaultParams, count: Number(event.target.value) })}>{Array.from({ length: form.maxCount || 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 张</option>)}</select></label>
              <label className="field"><span>默认质量</span><select disabled={isGemini} value={form.defaultParams.quality || 'auto'} onChange={(event) => update('defaultParams', { ...form.defaultParams, quality: event.target.value })}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
            </div>
            <div className="form-grid two-columns">
              <label className="field"><span>可选尺寸</span><input value={(form.sizeOptions || []).join(', ')} onChange={(event) => update('sizeOptions', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder="例如 1024x1024, 1536x1024" /><small className="field-help">用英文逗号分隔。工作台会按此列表选择尺寸和比例。</small></label>
              <label className="field"><span>单次最多图片</span><select value={form.maxCount || 1} onChange={(event) => update('maxCount', Number(event.target.value))}><option value="1">1 张</option><option value="2">2 张</option><option value="3">3 张</option><option value="4">4 张</option></select></label>
            </div>
            <fieldset className="capability-field"><legend>输出能力</legend><div className="capability-options">
              {outputFormatsForProtocol(form.imageApiFormat || 'openai_images').map((value) => <label key={value} className={form.outputFormats?.includes(value) ? 'checked' : ''}><input type="checkbox" checked={form.outputFormats?.includes(value) || false} onChange={() => update('outputFormats', form.outputFormats?.includes(value) ? form.outputFormats.filter((item) => item !== value) : [...(form.outputFormats || []), value])} /><span>{value.toUpperCase()}</span></label>)}
              {form.imageApiFormat === 'openai_images' && <label className={form.transparentBackground ? 'checked' : ''}><input type="checkbox" checked={Boolean(form.transparentBackground)} onChange={() => update('transparentBackground', !form.transparentBackground)} /><span>透明背景</span></label>}
            </div></fieldset>
          </> : <div className="vision-guide"><strong>视觉识别模型用途</strong><p>用于识别和理解上传图片内容。当前会保存和测试该配置；工作台后续的智能图片分析将使用这里配置的模型。</p></div>}
          {testResult && <div className="test-result">{testResult}</div>}
          <div className="form-footer">
            <div>{selectedId && <button className="text-danger" onClick={() => { if (window.confirm('删除该模型配置？历史项目中的参数快照仍会保留。')) void onDelete(selectedId); }}>删除模型</button>}</div>
            <div className="footer-actions"><button className="button secondary" disabled={!form.name.trim() || !form.model.trim()} onClick={async () => setTestResult(await onTestConfig(form))}>测试连接</button><button className="button primary" disabled={!form.name.trim() || !form.model.trim() || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</button></div>
          </div>
        </section>
      </section>
    </main>
  );
}

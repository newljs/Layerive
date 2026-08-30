import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
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
  onTest: (id: string) => Promise<string>;
  onTestConfig: (model: Partial<ModelConfig>) => Promise<string>;
};

const senseNovaUrl = 'https://token.sensenova.cn/v1';
const senseNovaVisionUrl = 'https://api.sensenova.cn/v1';
const openAiUrl = 'https://api.openai.com/v1';
const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta';
const grokUrl = 'https://api.x.ai/v1';

function providerBaseUrl(type: ModelConfig['type'], provider: ModelConfig['provider']) {
  if (provider === 'sensenova') return type === 'vision' ? senseNovaVisionUrl : senseNovaUrl;
  if (provider === 'gemini') return geminiUrl;
  if (provider === 'grok') return grokUrl;
  return openAiUrl;
}

function blankFor(type: ModelConfig['type'] = 'image'): ModelConfig {
  return type === 'vision'
    ? { id: '', name: '', type, provider: 'openai', baseUrl: openAiUrl, apiKey: '', model: 'gpt-4.1-mini', capabilities: ['image_understanding'], defaultParams: {} }
    : { id: '', name: '', type, provider: 'openai', baseUrl: openAiUrl, apiKey: '', model: 'gpt-image-2', capabilities: ['text_to_image', 'image_to_image', 'edit_prompt'], defaultParams: { size: '1024x1024', count: 1, quality: 'auto' } };
}

function defaultModel(type: ModelConfig['type'], provider: ModelConfig['provider']) {
  if (type === 'vision') return provider === 'sensenova' ? 'SenseChat-V6.5' : 'gpt-4.1-mini';
  if (provider === 'sensenova') return 'sensenova-u1.5-lite';
  if (provider === 'gemini') return 'gemini-3.1-flash-image';
  if (provider === 'grok') return 'grok-imagine-image-2.0';
  return 'gpt-image-2';
}

export function ModelConfigView({ models, activeModel, activeVisionModel, onBack, onSave, onDelete, onActivate, onActivateVision, onTest, onTestConfig }: Props) {
  const [selectedId, setSelectedId] = useState(models[0]?.id || '');
  const [form, setForm] = useState<ModelConfig>(models[0] || blankFor());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState('');
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
    if (selected) { setCreating(false); setSelectedId(id); setForm(selected); setTestResult(''); }
  }
  function startCreate(type: ModelConfig['type']) { setCreating(true); setSelectedId(''); setForm(blankFor(type)); setTestResult(''); }
  function update<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function changeType(type: ModelConfig['type']) {
    setForm((current) => ({ ...current, type, provider: 'openai', baseUrl: openAiUrl, model: defaultModel(type, 'openai'), capabilities: type === 'vision' ? ['image_understanding'] : ['text_to_image', 'image_to_image', 'edit_prompt'], defaultParams: type === 'vision' ? {} : { size: '1024x1024', count: 1, quality: 'auto' } }));
  }
  function changeProvider(provider: ModelConfig['provider']) {
    setForm((current) => ({ ...current, provider, baseUrl: providerBaseUrl(current.type, provider), model: defaultModel(current.type, provider) }));
  }
  function toggleCapability(capability: string) {
    update('capabilities', form.capabilities.includes(capability) ? form.capabilities.filter((item) => item !== capability) : [...form.capabilities, capability]);
  }
  async function save() {
    setSaving(true);
    try {
      const saved = await onSave(form, selectedId || undefined);
      if (!selectedId && saved?.id) { setCreating(false); setSelectedId(saved.id); setForm(saved); }
    } finally { setSaving(false); }
  }
  function renderItem(model: ModelConfig) {
    const typeLabel = model.type === 'vision' ? '视觉识别' : '图片生成';
    return <button key={model.id} className={`model-list-item ${selectedId === model.id ? 'active' : ''}`} onClick={() => choose(model.id)}>
      <span className={`model-provider ${model.provider}`}>{model.provider === 'sensenova' ? '日' : model.provider === 'gemini' ? 'Gm' : model.provider === 'grok' ? 'Gr' : 'O'}</span>
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
        <div className="save-state"><span className="status-dot" />配置保存在本机</div>
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
          <label className="field"><span>提供商</span><select value={form.provider} onChange={(event) => changeProvider(event.target.value as ModelConfig['provider'])}><option value="sensenova">日日新</option><option value="openai">OpenAI</option>{form.type === 'image' && <><option value="gemini">Gemini · Nano Banana</option><option value="grok">Grok · Imagine</option></>}</select></label>

          {isSenseNova ? <div className="provider-guide sensenova-guide"><strong>日日新配置</strong><p>{form.type === 'vision' ? '使用日日新融合模态图文对话接口进行图片文字识别与改图规划。' : '使用日日新官方图片接口。图片生成会固定启用无水印参数，并按接口限制每次生成 1 张。'}</p></div> : isGemini ? <div className="provider-guide gemini-guide"><strong>Gemini Nano Banana 配置</strong><p>使用 Gemini 原生图片接口和 Google API Key，支持文生图、参考图改图与文字编辑。默认模型为 gemini-3.1-flash-image；也可填写 gemini-2.5-flash-image 或其他 Nano Banana 模型。</p></div> : isGrok ? <div className="provider-guide grok-guide"><strong>Grok Imagine 配置</strong><p>使用 xAI 图片生成与编辑接口，支持文生图、图生图和提示词改图。建议模型填写 grok-imagine-image-2.0。</p></div> : <div className="provider-guide"><strong>OpenAI 配置</strong><p>适用于 OpenAI 官方接口和 OpenAI 兼容中转站；请填写服务根地址，不要包含具体接口路径。</p></div>}

          <label className="field"><span>{isSenseNova ? '日日新服务地址' : isGemini ? 'Gemini API Base URL' : isGrok ? 'xAI API Base URL' : 'API Base URL'}</span><input disabled={isSenseNova} value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder={providerBaseUrl(form.type, form.provider)} /><small className="field-help">{isSenseNova ? `固定使用 ${providerBaseUrl(form.type, form.provider)}。` : isGemini ? '官方地址为 https://generativelanguage.googleapis.com/v1beta。' : isGrok ? '官方地址为 https://api.x.ai/v1。' : '例如 https://api.openai.com/v1 或中转站提供的 /v1 根地址。'}</small></label>
          <div className="form-grid two-columns">
            <label className="field"><span>{isSenseNova ? '日日新 API Key' : isGemini ? 'Gemini API Key' : isGrok ? 'xAI API Key' : 'OpenAI API Key'}</span><input type="password" value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={isGemini ? 'AIza...' : 'sk-...'} /></label>
            <label className="field"><span>{form.type === 'vision' ? '视觉识别模型名称 *' : '图片生成模型名称 *'}</span><input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder={defaultModel(form.type, form.provider)} /></label>
          </div>

          {form.type === 'image' ? <>
            <fieldset className="capability-field"><legend>支持能力</legend><div className="capability-options">
              {[['text_to_image', '文生图'], ['image_to_image', '图生图'], ['edit_prompt', '提示词改图'], ['edit_text', '文字编辑']].map(([value, label]) => (
                <label key={value} className={form.capabilities.includes(value) ? 'checked' : ''}><input type="checkbox" checked={form.capabilities.includes(value)} onChange={() => toggleCapability(value)} /><span>{label}</span></label>
              ))}
            </div></fieldset>
            <div className="form-grid three-columns">
              <label className="field"><span>默认尺寸</span><select value={form.defaultParams.size || '1024x1024'} onChange={(event) => update('defaultParams', { ...form.defaultParams, size: event.target.value })}><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option><option>512x512</option></select></label>
              <label className="field"><span>默认数量</span><select disabled={isSenseNova || isGemini} value={isSenseNova || isGemini ? 1 : form.defaultParams.count || 1} onChange={(event) => update('defaultParams', { ...form.defaultParams, count: Number(event.target.value) })}><option value="1">1 张</option><option value="2">2 张</option><option value="3">3 张</option><option value="4">4 张</option></select></label>
              <label className="field"><span>默认质量</span><select disabled={isGemini} value={form.defaultParams.quality || 'auto'} onChange={(event) => update('defaultParams', { ...form.defaultParams, quality: event.target.value })}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
            </div>
          </> : <div className="vision-guide"><strong>视觉识别模型用途</strong><p>用于识别和理解上传图片内容。当前会保存和测试该配置；工作台后续的智能图片分析将使用这里配置的模型。</p></div>}
          {testResult && <div className="test-result">{testResult}</div>}
          <div className="form-footer">
            <div>{selectedId && <button className="text-danger" onClick={() => { if (window.confirm('删除该模型配置？历史项目中的参数快照仍会保留。')) void onDelete(selectedId); }}>删除模型</button>}</div>
            <div className="footer-actions"><button className="button secondary" disabled={!form.name.trim() || !form.model.trim()} onClick={async () => setTestResult(selectedId ? await onTest(selectedId) : await onTestConfig(form))}>测试连接</button><button className="button primary" disabled={!form.name.trim() || !form.model.trim() || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</button></div>
          </div>
        </section>
      </section>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, readFileAsDataUrl, thumbUrl } from './api';
import { Icon } from './Icon';
import { LanguageToggle, useLanguage, tf, type Language, type TranslationKey } from './i18n';
import { PromptGalleryModal } from './PromptGalleryModal';
import { sizesForProvider, defaultSizeForProvider, closestSizeForDimensions, isValidSizeForProvider, type OutputFormat } from './sizes';
import { useTheme } from './theme';
import type { GalleryEntry } from './gallery';
import type { BatchEditProgress, GenerationTask, LocalEditReference, ModelConfig, ModelExecutionLog, ProjectBundle, ProjectImage, TextSegment, Version } from './types';

type Props = {
  projectId: string;
  models: ModelConfig[];
  activeModel: string;
  activeVisionModel: string;
  onBack: () => void;
  onModels: () => void;
  onProjectChanged: () => void;
  notify: (message: string, kind?: 'success' | 'error') => void;
};
type TaskKind = 'generate' | 'batch-edit' | 'text-edit' | 'local-edit' | 'remove-element' | 'outpaint' | 'enhance' | 'remove-watermark' | 'extract-asset';
const localEditStageKeys: Record<string, TranslationKey> = { planning: 'ws.stagePlanning', compositing: 'ws.stageCompositing', generating: 'ws.stageGenerating', preserving: 'ws.stagePreserving' };
const removeElementStageKeys: Record<string, TranslationKey> = { planning: 'ws.removeElementStagePlanning', generating: 'ws.removeElementStageGenerating', preserving: 'ws.removeElementStagePreserving' };

const operationKeys: Record<string, TranslationKey> = { auto: 'op.auto', upload: 'op.upload', text_to_image: 'op.text_to_image', image_to_image: 'op.image_to_image', edit_prompt: 'op.edit_prompt', batch_edit: 'op.batch_edit', batch_generate: 'op.batch_generate', edit_text: 'op.edit_text', recognize_text: 'op.recognize_text', local_edit: 'op.local_edit', remove_element: 'op.remove_element', outpaint: 'op.outpaint', enhance: 'op.enhance', remove_watermark: 'op.remove_watermark', extract_asset: 'op.extract_asset', gallery_analyze: 'op.gallery_analyze' };
const localeFor = (language: Language) => (language === 'zh' ? 'zh-CN' : 'en-US');
const formatTime = (value: string, language: Language) => new Intl.DateTimeFormat(localeFor(language), { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function formatLogDuration(value: number | null) {
  if (value == null) return tf('ws.statusRunning', '执行中');
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} s`;
}

function prettyLogData(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function batchVariableNames(template: string) {
  return [...new Set([...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].trim()).filter(Boolean))];
}

function createBatchVariableToken(name: string) {
  const token = document.createElement('span');
  token.className = 'batch-variable-token';
  token.contentEditable = 'false';
  token.dataset.batchVariable = name;
  token.append(document.createTextNode(name));
  const remove = document.createElement('span');
  remove.className = 'batch-variable-remove';
  remove.dataset.removeBatchVariable = 'true';
  remove.title = tf('ws.removeVariable', '移除{name}', { name });
  remove.textContent = '×';
  token.append(remove);
  return token;
}

function renderBatchTemplateEditor(editor: HTMLDivElement, template: string) {
  const fragment = document.createDocumentFragment();
  const marker = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let offset = 0;
  for (const match of template.matchAll(marker)) {
    const index = match.index || 0;
    if (index > offset) fragment.append(document.createTextNode(template.slice(offset, index)));
    fragment.append(createBatchVariableToken(match[1].trim()));
    offset = index + match[0].length;
  }
  if (offset < template.length) fragment.append(document.createTextNode(template.slice(offset)));
  editor.replaceChildren(fragment);
}

function serializeBatchTemplateEditor(editor: HTMLDivElement) {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (node.dataset.batchVariable) return `{{${node.dataset.batchVariable}}}`;
    if (node.tagName === 'BR') return '\n';
    const content = [...node.childNodes].map(read).join('');
    return ['DIV', 'P'].includes(node.tagName) ? `\n${content}` : content;
  };
  return [...editor.childNodes].map(read).join('').replaceAll('\u200b', '').replace(/^\n/, '');
}

function nextBatchVariableName(names: string[]) {
  let index = 1;
  while (names.includes(tf('ws.defaultVariableName', '变量{index}', { index }))) index += 1;
  return tf('ws.defaultVariableName', '变量{index}', { index });
}

function batchItemValueLabel(values: Record<string, string>) {
  return Object.entries(values).map(([name, value]) => tf('ws.variableValue', '{name}：{value}', { name, value })).join(' · ');
}

function formatRemainingTime(seconds: number | null) {
  if (seconds == null) return tf('ws.etaEstimating', '正在估算…');
  if (seconds < 60) return tf('ws.etaSeconds', '约 {seconds} 秒', { seconds });
  const minutes = Math.ceil(seconds / 60);
  return tf('ws.etaMinutes', '约 {minutes} 分钟', { minutes });
}

// 素材提取截图：把圈选区域按百分比换算为原图像素后用 canvas 截取。
// 模型平台要求输入图宽高在 256–4096px 且宽高比不超过 2:1，因此截图上限
// 2048px、过小时放大、比例超限时用边缘像素补齐短边，超大再自动转 JPEG。
function sameRect(a: NonNullable<TextSegment['rect']>, b: NonNullable<TextSegment['rect']>) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function selectionRect(start: { x: number; y: number }, end: { x: number; y: number }): NonNullable<TextSegment['rect']> {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function hasTextSegmentChanges(segments: TextSegment[]) {
  return segments.some((segment) => {
    const originalText = segment.originalText.trim();
    const nextText = segment.text.trim();
    if (segment.manual) return Boolean(nextText) && nextText !== originalText;
    return Boolean(originalText) && nextText !== originalText;
  });
}

async function cropImageRegion(image: ProjectImage, rect: NonNullable<TextSegment['rect']>): Promise<{ dataUrl: string; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; padded: boolean } | null> {
  const source = new Image();
  source.src = image.url;
  await new Promise<void>((resolve, reject) => { source.onload = () => resolve(); source.onerror = () => reject(new Error(tf('ws.cropLoadFailed', '读取原图失败，请重试'))); });
  const naturalWidth = source.naturalWidth || image.width || 0;
  const naturalHeight = source.naturalHeight || image.height || 0;
  if (!naturalWidth || !naturalHeight) throw new Error(tf('ws.cropSizeFailed', '无法读取原图尺寸'));
  const left = Math.min(naturalWidth - 1, Math.max(0, Math.round((rect.x / 100) * naturalWidth)));
  const top = Math.min(naturalHeight - 1, Math.max(0, Math.round((rect.y / 100) * naturalHeight)));
  const width = Math.max(1, Math.min(naturalWidth - left, Math.round((rect.width / 100) * naturalWidth)));
  const height = Math.max(1, Math.min(naturalHeight - top, Math.round((rect.height / 100) * naturalHeight)));

  // 宽高比超过 2:1 时用首行/末行、首列/末列像素拉伸补齐短边，保证截图能通过
  // 模型平台的输入校验；补边区域会被视觉和编辑模型当作画面的一部分。
  let paddedWidth = width;
  let paddedHeight = height;
  if (width / height > 2) paddedHeight = Math.ceil(width / 2);
  else if (height / width > 2) paddedWidth = Math.ceil(height / 2);
  const padLeft = Math.floor((paddedWidth - width) / 2);
  const padTop = Math.floor((paddedHeight - height) / 2);
  const padded = paddedWidth !== width || paddedHeight !== height;

  let scale = Math.min(1, 2048 / Math.max(paddedWidth, paddedHeight));
  if (Math.min(paddedWidth, paddedHeight) * scale < 256) scale = 256 / Math.min(paddedWidth, paddedHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(256, Math.round(paddedWidth * scale));
  canvas.height = Math.max(256, Math.round(paddedHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(tf('ws.cropCanvasFailed', '无法生成截图，请重试'));
  const unit = canvas.width / paddedWidth;
  context.drawImage(source, left, top, width, height, padLeft * unit, padTop * unit, width * unit, height * unit);
  if (padded) {
    if (padTop > 0) context.drawImage(source, left, top, width, 1, padLeft * unit, 0, width * unit, padTop * unit);
    if (paddedHeight - padTop - height > 0) context.drawImage(source, left, top + height - 1, width, 1, padLeft * unit, (padTop + height) * unit, width * unit, (paddedHeight - padTop - height) * unit);
    if (padLeft > 0) context.drawImage(source, left, top, 1, height, 0, padTop * unit, padLeft * unit, height * unit);
    if (paddedWidth - padLeft - width > 0) context.drawImage(source, left + width - 1, top, 1, height, (padLeft + width) * unit, padTop * unit, (paddedWidth - padLeft - width) * unit, height * unit);
  }
  let mimeType: 'image/png' | 'image/jpeg' = 'image/png';
  let dataUrl = canvas.toDataURL(mimeType);
  if (dataUrl.length * 0.75 > 9 * 1024 * 1024) {
    mimeType = 'image/jpeg';
    dataUrl = canvas.toDataURL(mimeType, 0.92);
  }
  return { dataUrl, mimeType, width: canvas.width, height: canvas.height, padded };
}

function VersionItem({ version, active, onSelect, onEdit, onDownload, onDelete }: { version: Version; active: boolean; onSelect: () => void; onEdit: () => void; onDownload: () => void; onDelete: () => void }) {
  const { language, t } = useLanguage();
  const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
  const multiple = version.outputs.length > 1;
  const operation = version.operation && operationKeys[version.operation] ? t(operationKeys[version.operation]) : version.operation;
  return (
    <div className={`version-item-wrap ${active ? 'active' : ''} ${multiple ? 'has-multiple' : ''}`}>
      <button className={`version-item ${active ? 'active' : ''}`} onClick={onSelect}>
        <div className={`version-thumb ${multiple ? `multiple count-${Math.min(4, version.outputs.length)}` : ''}`}>
          {multiple
            ? version.outputs.slice(0, 4).map((output, index) => <img key={output.id} src={thumbUrl(output, 160)} alt={t('ws.candidateThumbAlt', { index: index + 1 })} loading="lazy" />)
            : image ? <img src={thumbUrl(image)} alt="" loading="lazy" /> : <span>V{version.number}</span>}
          {multiple && <em className="version-count-badge">{version.outputs.length}</em>}
        </div>
        <div className="version-copy"><strong>V{version.number}</strong><span>{operation}</span><div className="version-meta"><small>{formatTime(version.createdAt, language)}</small>{multiple && <em>{t('ws.multiCount', { count: version.outputs.length })}</em>}</div></div>
        {version.parentVersionId && <span className="branch-mark" title={t('ws.branchTitle')}><Icon name="branch" size={12} /></span>}
      </button>
      <div className="version-item-actions">
        {image && <button className="version-edit" title={t('ws.editVersionTitle', { number: version.number })} onClick={(event) => { event.stopPropagation(); onEdit(); }}>{t('ws.editVersion')}</button>}
        {multiple && <button className="version-download" title={t('ws.downloadVersionTitle', { number: version.number, count: version.outputs.length })} onClick={(event) => { event.stopPropagation(); onDownload(); }}><Icon name="download" size={12} /> ZIP</button>}
        <button className="version-delete" title={t('ws.deleteVersionTitle')} onClick={(event) => { event.stopPropagation(); onDelete(); }}><Icon name="close" size={13} /></button>
      </div>
    </div>
  );
}

const TREE_NODE_WIDTH = 148;
const TREE_NODE_HEIGHT = 176;
const TREE_GAP_X = 36;
const TREE_GAP_Y = 46;

// Each subtree occupies a consecutive band of integer columns and every parent
// is centered above its children, so branches spread out instead of piling up
// on the left. Roots are laid out left to right in version order.
function layoutVersionTree(versions: Version[]) {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const childrenOf = new Map<string | null, Version[]>();
  for (const version of versions) {
    const parentKey = version.parentVersionId && byId.has(version.parentVersionId) ? version.parentVersionId : null;
    const list = childrenOf.get(parentKey) || [];
    list.push(version);
    childrenOf.set(parentKey, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.number - b.number);

  const position = new Map<string, { x: number; y: number }>();
  let column = 0;
  const visit = (version: Version, depth: number): number => {
    const children = childrenOf.get(version.id) || [];
    if (!children.length) {
      const x = column++;
      position.set(version.id, { x, y: depth });
      return x;
    }
    const childXs = children.map((child) => visit(child, depth + 1));
    const x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    position.set(version.id, { x, y: depth });
    return x;
  };
  const roots = childrenOf.get(null) || [];
  for (const root of roots) {
    visit(root, 0);
    // Keep one empty column between separate trees so unrelated roots do not
    // visually merge into a single row of nodes.
    column += 1;
  }
  const max = { x: 0, y: 0 };
  for (const point of position.values()) {
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
  }
  return { position, columns: max.x + 1, rows: max.y + 1, childrenOf };
}

function VersionTreeModal({ versions, currentVersionId, onSelect, onClose }: { versions: Version[]; currentVersionId: string | null; onSelect: (version: Version) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const { position, columns, rows } = useMemo(() => layoutVersionTree(versions), [versions]);
  const [zoom, setZoom] = useState(1);
  const panState = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  const nodePosition = (version: Version) => position.get(version.id) || { x: 0, y: 0 };
  const canvasWidth = columns * (TREE_NODE_WIDTH + TREE_GAP_X);
  const canvasHeight = rows * (TREE_NODE_HEIGHT + TREE_GAP_Y) + TREE_NODE_HEIGHT;

  function onPanStart(event: React.MouseEvent) {
    if (event.target instanceof Element && event.target.closest('.tree-node')) return;
    panState.current = { startX: event.clientX, startY: event.clientY, scrollLeft: viewport.current?.scrollLeft || 0, scrollTop: viewport.current?.scrollTop || 0 };
  }
  function onPanMove(event: React.MouseEvent) {
    if (!panState.current || !viewport.current) return;
    viewport.current.scrollLeft = panState.current.scrollLeft - (event.clientX - panState.current.startX);
    viewport.current.scrollTop = panState.current.scrollTop - (event.clientY - panState.current.startY);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="version-tree-modal fullscreen" role="dialog" aria-modal="true" aria-labelledby="tree-title">
        <div className="modal-heading">
          <div><p className="eyebrow">VERSION GRAPH</p><h2 id="tree-title">{t('ws.treeTitle')}</h2></div>
          <div className="tree-controls">
            <button className="icon-button" onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.2) * 10) / 10))} aria-label={t('common.zoomOut')}><Icon name="minus" size={15} /></button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="icon-button" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))} aria-label={t('common.zoomIn')}><Icon name="plus" size={15} /></button>
            <button className="icon-button" onClick={onClose}><Icon name="close" size={16} /></button>
          </div>
        </div>
        <p className="tree-help">{t('ws.treeHelp')}</p>
        <div className="tree-viewport" ref={viewport} onMouseDown={onPanStart} onMouseMove={onPanMove} onMouseUp={() => { panState.current = null; }} onMouseLeave={() => { panState.current = null; }}>
          <div className="tree-canvas" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
            <div className="tree-scale" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}>
              <svg className="tree-edges" width={canvasWidth} height={canvasHeight}>
                {versions.map((version) => {
                  const parent = version.parentVersionId ? versions.find((item) => item.id === version.parentVersionId) : null;
                  if (!parent) return null;
                  const from = nodePosition(parent);
                  const to = nodePosition(version);
                  const x1 = from.x * (TREE_NODE_WIDTH + TREE_GAP_X) + TREE_NODE_WIDTH / 2;
                  const y1 = from.y * (TREE_NODE_HEIGHT + TREE_GAP_Y) + TREE_NODE_HEIGHT;
                  const x2 = to.x * (TREE_NODE_WIDTH + TREE_GAP_X) + TREE_NODE_WIDTH / 2;
                  const y2 = to.y * (TREE_NODE_HEIGHT + TREE_GAP_Y);
                  const middle = (y1 + y2) / 2;
                  return <path key={version.id} d={`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`} className="tree-edge" />;
                })}
              </svg>
              {versions.map((version) => {
                const point = nodePosition(version);
                const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
                return (
                  <button
                    key={version.id}
                    className={`tree-node ${version.id === currentVersionId ? 'active' : ''}`}
                    style={{ left: point.x * (TREE_NODE_WIDTH + TREE_GAP_X), top: point.y * (TREE_NODE_HEIGHT + TREE_GAP_Y), width: TREE_NODE_WIDTH, height: TREE_NODE_HEIGHT }}
                    onClick={() => onSelect(version)}
                  >
                    <span className="tree-thumb">{image ? <img src={thumbUrl(image)} alt="" loading="lazy" /> : `V${version.number}`}</span>
                    <strong>V{version.number}</strong>
                    <small>{version.operation && operationKeys[version.operation] ? t(operationKeys[version.operation]) : version.operation}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ModelLogsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { language, t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [logs, setLogs] = useState<ModelExecutionLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await api.modelLogs(projectId);
      setLogs(result.logs);
      setSelectedId((current) => current && result.logs.some((item) => item.id === current) ? current : result.logs[0]?.id || null);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : tRef.current('ws.logsLoadFailed'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [load]);

  const selected = logs.find((item) => item.id === selectedId) || logs[0] || null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="model-logs-modal" role="dialog" aria-modal="true" aria-labelledby="model-logs-title">
        <div className="modal-heading model-logs-heading">
          <div><p className="eyebrow">MODEL TRACE</p><h2 id="model-logs-title">{t('ws.logsTitle')}</h2><small>{t('ws.logsSubtitle')}</small></div>
          <div className="model-log-actions"><button className="button secondary" disabled={loading} onClick={() => void load()}><Icon name="logs" size={14} /> {t('common.refresh')}</button><button className="icon-button" onClick={onClose} aria-label={t('ws.logsClose')}><Icon name="close" size={16} /></button></div>
        </div>
        {error && <div className="model-log-error">{error}</div>}
        <div className="model-logs-layout">
          <aside className="model-log-list">
            {loading && !logs.length && <div className="model-log-empty"><span className="spinner" />{t('ws.logsLoading')}</div>}
            {!loading && !logs.length && <div className="model-log-empty"><Icon name="logs" size={26} /><strong>{t('ws.logsEmptyTitle')}</strong><span>{t('ws.logsEmptyHint')}</span></div>}
            {logs.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
              <span className={`model-log-status ${item.status}`} />
              <span className="model-log-list-copy"><strong>{item.phase}</strong><small>{item.modelType === 'vision' ? t('ws.modelVision') : t('ws.modelImage')} · {item.modelName}</small><em>{new Intl.DateTimeFormat(localeFor(language), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(item.startedAt))}</em></span>
              <span className="model-log-duration">{formatLogDuration(item.durationMs)}</span>
            </button>)}
          </aside>
          <div className="model-log-detail">
            {selected ? <>
              <div className="model-log-summary">
                <div><span>{t('ws.logModel')}</span><strong>{selected.modelName}</strong><small>{selected.modelType === 'vision' ? t('ws.visionModel') : t('ws.imageModel')}</small></div>
                <div><span>{t('ws.logOperation')}</span><strong>{selected.operationType && operationKeys[selected.operationType] ? t(operationKeys[selected.operationType]) : selected.operationType}</strong><small>{selected.phase}</small></div>
                <div><span>{t('ws.logStatus')}</span><strong className={`model-log-state-text ${selected.status}`}>{selected.status === 'success' ? t('ws.statusSuccess') : selected.status === 'running' ? t('ws.statusRunning') : selected.status === 'canceled' ? t('ws.statusCanceled') : t('ws.statusFailed')}</strong><small>{formatLogDuration(selected.durationMs)}</small></div>
                <div><span>{t('ws.logStarted')}</span><strong>{new Intl.DateTimeFormat(localeFor(language), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(selected.startedAt))}</strong><small>{selected.taskId ? t('ws.logTask', { id: selected.taskId.slice(0, 8) }) : t('ws.logSync')}</small></div>
              </div>
              {selected.error && <section className="model-log-section error"><h3>{t('ws.logError')}</h3><pre>{selected.error}</pre></section>}
              <section className="model-log-section"><h3>{selected.modelType === 'vision' ? t('ws.logVisionPrompt') : t('ws.logImagePrompt')}</h3><pre>{selected.prompt || '—'}</pre></section>
              {selected.generatedPrompt && <section className="model-log-section generated"><h3>{t('ws.logGeneratedPrompt')}</h3><pre>{selected.generatedPrompt}</pre></section>}
              {selected.modelType === 'vision' && <section className="model-log-section reasoning"><h3>{t('ws.logReasoning')}</h3><pre>{selected.reasoning || t('ws.logNoReasoning')}</pre></section>}
              <section className="model-log-section"><h3>{t('ws.logRequest')}</h3><pre>{prettyLogData(selected.request)}</pre></section>
              <section className="model-log-section"><h3>{t('ws.logResponse')}</h3><pre>{prettyLogData(selected.response)}</pre></section>
            </> : <div className="model-log-empty">{t('ws.logPickHint')}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

export function WorkspaceView({ projectId, models, activeModel, activeVisionModel, onBack, onModels, onProjectChanged, notify }: Props) {
  const { language, t } = useLanguage();
  // 轮询等长生命周期回调经 ref 取词：语言切换后完成的任务用新语言提示，
  // 同时避免 t 进入回调依赖导致主数据加载 effect 在切语言时整页重载。
  const tRef = useRef(t);
  tRef.current = t;
  const { theme, toggleTheme } = useTheme();
  const imageModels = models.filter((model) => model.type !== 'vision');
  const visionModels = models.filter((model) => model.type === 'vision');
  const fallbackVisionModelId = visionModels.find((model) => model.id === activeVisionModel)?.id || visionModels[0]?.id || '';
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [operation, setOperation] = useState('auto');
  const [modelId, setModelId] = useState(activeModel);
  const [visionModelId, setVisionModelId] = useState(fallbackVisionModelId);
  const [size, setSize] = useState(defaultSizeForProvider(imageModels.find((model) => model.id === activeModel)));
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png');
  const [transparentBg, setTransparentBg] = useState(false);
  const [count, setCount] = useState(1);
  // 右侧面板双模式：对话保留原输入区；批量面板承载批量改图与批量文生图。
  const [rightMode, setRightMode] = useState<'chat' | 'batch'>('chat');
  const [batchType, setBatchType] = useState<'edit' | 'text'>('text');
  const [batchStylePrompt, setBatchStylePrompt] = useState('');
  const [batchTemplate, setBatchTemplate] = useState('');
  const [batchPromptTab, setBatchPromptTab] = useState<'template' | 'list'>('template');
  const [batchPromptsText, setBatchPromptsText] = useState('');
  const [batchQuantity, setBatchQuantity] = useState(10);
  const [batchVariableValues, setBatchVariableValues] = useState<Record<string, string[]>>({});
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchEditProgress | null>(null);
  const [currentImageId, setCurrentImageId] = useState<string | null>(null);
  const [inputImageId, setInputImageId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<{ id: string | null; kind: TaskKind; stage?: GenerationTask['stage'] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareMode, setCompareMode] = useState<'side' | 'slider'>('side');
  const [compareImageId, setCompareImageId] = useState<string | null>(null);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [versionTreeOpen, setVersionTreeOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [modelLogsOpen, setModelLogsOpen] = useState(false);
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textImageId, setTextImageId] = useState<string | null>(null);
  const [textSegments, setTextSegments] = useState<TextSegment[]>([]);
  const [recognitionModel, setRecognitionModel] = useState('');
  const [recognizingText, setRecognizingText] = useState(false);
  const [boxMode, setBoxMode] = useState(false);
  const [draftRect, setDraftRect] = useState<TextSegment['rect'] | null>(null);
  const [textEditSubmitting, setTextEditSubmitting] = useState(false);
  const [textEditorError, setTextEditorError] = useState('');
  const [localEditMode, setLocalEditMode] = useState(false);
  const [localEditRect, setLocalEditRect] = useState<TextSegment['rect'] | null>(null);
  const [localBatchOpen, setLocalBatchOpen] = useState(false);
  const [localBatchText, setLocalBatchText] = useState('');
  const [localBatchSubmitting, setLocalBatchSubmitting] = useState(false);
  const [localEditInstruction, setLocalEditInstruction] = useState('');
  const [localEditSubmitting, setLocalEditSubmitting] = useState(false);
  const [removeElementMode, setRemoveElementMode] = useState(false);
  const [removeElementRect, setRemoveElementRect] = useState<TextSegment['rect'] | null>(null);
  const [removeElementSubmitting, setRemoveElementSubmitting] = useState(false);
  const [localReference, setLocalReference] = useState<LocalEditReference | null>(null);
  const [localReferenceLoading, setLocalReferenceLoading] = useState(false);
  const localReferenceRevision = useRef(0);
  const localReferenceFileRef = useRef<HTMLInputElement>(null);
  const [outpaintMode, setOutpaintMode] = useState(false);
  const [outpaintSize, setOutpaintSize] = useState('');
  const [outpaintSubmitting, setOutpaintSubmitting] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [removingWatermark, setRemovingWatermark] = useState(false);
  const [extractMode, setExtractMode] = useState(false);
  const [extractRect, setExtractRect] = useState<TextSegment['rect'] | null>(null);
  const [extractHint, setExtractHint] = useState('');
  const [extractPreview, setExtractPreview] = useState<{ imageId: string; rect: NonNullable<TextSegment['rect']>; dataUrl: string; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; padded: boolean } | null>(null);
  const [extractSubmitting, setExtractSubmitting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; imageId: string } | null>(null);
  const [savingToGallery, setSavingToGallery] = useState(false);
  // 面板只在鼠标松开（框选结束）后出现，否则圈选靠下时弹窗会挡住拖拽。
  const [localDragging, setLocalDragging] = useState(false);
  const [removeElementDragging, setRemoveElementDragging] = useState(false);
  const [extractDragging, setExtractDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchImportFileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const pollTimer = useRef<number | null>(null);
  const batchProcessed = useRef(0);
  const batchTemplateEditorRef = useRef<HTMLDivElement>(null);
  const boxStart = useRef<{ x: number; y: number } | null>(null);
  const localBoxStart = useRef<{ x: number; y: number } | null>(null);
  const removeElementBoxStart = useRef<{ x: number; y: number } | null>(null);
  const extractBoxStart = useRef<{ x: number; y: number } | null>(null);
  const bundleRef = useRef<ProjectBundle | null>(null);
  const draftSnapshot = useRef<Record<string, unknown>>({});
  const draftCacheKey = `layerive-draft:${projectId}`;

  const generating = activeTask !== null;
  // 服务端任务/消息文本带稳定码时按 msg.* 字典本地化；历史数据回退原文。
  const taskErrorText = (task: GenerationTask, fallback: string) => {
    if (!task.error) return fallback;
    return task.errorCode ? tf(`msg.${task.errorCode}`, task.error, task.errorParams || {}) : task.error;
  };
  const persistedText = (content: { code?: string; params?: unknown; text?: string; message?: string }, raw: string) =>
    content.code ? tf(`msg.${content.code}`, raw, (content.params as Record<string, string | number>) || {}) : raw;
  const visionBusy = generating || recognizingText || textEditSubmitting || localEditSubmitting || removeElementSubmitting || extractSubmitting || removingWatermark || savingToGallery;
  const imageMap = useMemo(() => new Map((bundle?.images || []).map((image) => [image.id, image])), [bundle?.images]);
  const currentImage = currentImageId ? imageMap.get(currentImageId) || null : null;
  const inputImage = inputImageId ? imageMap.get(inputImageId) || null : null;
  const currentVersion = bundle?.versions.find((version) => version.outputs.some((image) => image.id === currentImageId));
  const selectedModel = imageModels.find((model) => model.id === modelId);
  const batchEditSupported = Boolean(selectedModel?.capabilities.includes('edit_prompt'));
  const batchTextSupported = Boolean(selectedModel?.capabilities.includes('text_to_image'));
  const selectedVisionModel = visionModels.find((model) => model.id === visionModelId);
  const compareImage = compareImageId ? imageMap.get(compareImageId) || null : null;
  const textImage = textImageId ? imageMap.get(textImageId) || null : null;
  const hasTextChanges = hasTextSegmentChanges(textSegments);
  const versionsByNumber = [...(bundle?.versions || [])].sort((left, right) => left.number - right.number);
  const versionById = new Map((bundle?.versions || []).map((version) => [version.id, version]));
  const inputVersion = inputImage?.versionId ? versionById.get(inputImage.versionId) : null;
  bundleRef.current = bundle;
  draftSnapshot.current = { draft: { prompt, stylePrompt, operation, modelId, visionModelId, size, outputFormat, transparentBg, count, inputImageId }, currentImageId, defaultModelId: modelId };
  const detectedBatchVariables = batchVariableNames(batchTemplate);
  const batchRows = Array.from({ length: batchQuantity }, (_, index) => Object.fromEntries(
    detectedBatchVariables.map((name) => [name, String(batchVariableValues[name]?.[index] || '').trim()]),
  ));
  const batchExpectedValueCount = batchQuantity * detectedBatchVariables.length;
  const batchFilledCount = batchRows.reduce((count, row) => count + Object.values(row).filter(Boolean).length, 0);
  const batchTemplateWithoutVariables = batchTemplate.replace(/\{\{\s*[^{}]+?\s*\}\}/g, '');
  const batchTemplateHasInvalidVariables = /\{\{|\}\}/.test(batchTemplateWithoutVariables);
  // 提示词列表页（导入 txt / 粘贴多行）：每行一条完整提示词；batchPromptTab 决定提交与校验走哪种录入。
  const batchPromptLines = batchPromptsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const batchListTooLongLine = batchPromptLines.findIndex((line) => line.length > 1000);
  const batchValidationError = batchPromptTab === 'list'
    ? batchPromptLines.length < 2
      ? t('ws.errListTooFew')
      : batchPromptLines.length > 50
        ? t('ws.errListTooMany', { count: batchPromptLines.length })
        : batchListTooLongLine >= 0
          ? t('ws.errLineTooLong', { index: batchListTooLongLine + 1 })
          : null
    : !batchTemplate.trim()
    ? t('ws.errTemplateEmpty')
    : batchTemplateHasInvalidVariables
      ? t('ws.errTemplateBroken')
      : !detectedBatchVariables.length
        ? t('ws.errNoVariables')
        : detectedBatchVariables.length > 10
          ? t('ws.errTooManyVariables')
          : batchFilledCount !== batchExpectedValueCount
            ? t('ws.errValuesMissing', { expected: batchExpectedValueCount, filled: batchFilledCount })
            : null;
  // 批量局部修改：同一选区多组指令，逐张生成并进入同一版本。
  const localBatchLines = localBatchText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const localBatchTooLongLine = localBatchLines.findIndex((line) => line.length > 1000);
  const localBatchError = localBatchLines.length < 2
    ? t('ws.errLocalTooFew')
    : localBatchLines.length > 50
      ? t('ws.errLocalTooMany', { count: localBatchLines.length })
      : localBatchTooLongLine >= 0
        ? t('ws.errLocalLineTooLong', { index: localBatchTooLongLine + 1 })
        : null;
  const parentImage = useMemo(() => {
    if (!bundle || !currentVersion?.parentVersionId) return null;
    const parent = versionById.get(currentVersion.parentVersionId);
    if (!parent) return null;
    return parent.outputs.find((item) => item.id === parent.selectedImageId) || parent.outputs[0] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, currentVersion?.parentVersionId]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const flushDraft = useCallback(async () => {
    if (!initialized.current || !bundleRef.current) return true;
    setSaveState('saving');
    try {
      const data = await api.updateProject(projectId, draftSnapshot.current);
      setBundle((current) => current ? { ...current, project: data.project } : data);
      localStorage.removeItem(draftCacheKey);
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('failed');
      return false;
    }
  }, [draftCacheKey, projectId]);

  const startPolling = useCallback((taskId: string, kind: TaskKind) => {
    stopPolling();
    setActiveTask({ id: taskId, kind });
    pollTimer.current = window.setInterval(async () => {
      try {
        if (kind === 'batch-edit') {
          const progress = await api.getBatchEdit(projectId, taskId);
          const batchLabel = progress.textBatch ? tRef.current('ws.batchText') : progress.localEdit ? tRef.current('ws.batchLocal') : tRef.current('ws.batchEdit');
          const processed = progress.completed + progress.failed;
          if (processed > batchProcessed.current) {
            batchProcessed.current = processed;
            const incremental = await api.getProject(projectId);
            setBundle(incremental);
            if (incremental.project.currentImageId) {
              setCurrentImageId(incremental.project.currentImageId);
              setInputImageId(incremental.project.currentImageId);
            }
          }
          setBatchProgress(progress);
          if (progress.status === 'generating') {
            setActiveTask((current) => current?.id === taskId ? current : { id: taskId, kind });
            return;
          }
          stopPolling();
          setActiveTask(null);
          const data = await api.getProject(projectId);
          setBundle(data);
          if (data.project.currentImageId) {
            setCurrentImageId(data.project.currentImageId);
            setInputImageId(data.project.currentImageId);
          }
          if (progress.status === 'success') notify(tRef.current('ws.batchDoneAll', { label: batchLabel, count: progress.completed }), 'success');
          else if (progress.status === 'partial') notify(tRef.current('ws.batchDonePartial', { label: batchLabel, completed: progress.completed, total: progress.total, failed: progress.failed }), 'error');
          else if (progress.status === 'canceled') notify(tRef.current('ws.batchDoneCanceled', { label: batchLabel, count: progress.completed }), 'error');
          else notify(progress.error ? (progress.errorCode ? tf(`msg.${progress.errorCode}`, progress.error, progress.errorParams || {}) : progress.error) : tRef.current('ws.batchFailed', { label: batchLabel }), 'error');
          onProjectChanged();
          return;
        }
        const task = await api.getTask(projectId, taskId);
        if (task.status === 'generating') {
          setActiveTask((current) => current?.id === taskId ? { ...current, stage: task.stage } : current);
          return;
        }
        stopPolling();
        setActiveTask(null);
        const data = await api.getProject(projectId);
        setBundle(data);
        if (task.status === 'success' || task.status === 'partial') {
          setCurrentImageId(data.project.currentImageId);
          setInputImageId(data.project.currentImageId);
          if (task.status === 'partial') {
            notify(taskErrorText(task, tRef.current('ws.partialKeep')), 'error');
          } else if (kind === 'generate') {
            setPrompt('');
            notify(tRef.current('ws.createdVersion', { number: data.versions[0]?.number }), 'success');
          } else if (kind === 'text-edit') {
            notify(tRef.current('ws.savedText', { number: data.versions[0]?.number }), 'success');
          } else if (kind === 'local-edit') {
            setLocalReference(null);
            setLocalEditInstruction('');
            setLocalEditRect(null);
            notify(tRef.current('ws.savedLocalEdit', { number: data.versions[0]?.number }), 'success');
          } else if (kind === 'remove-element') {
            setRemoveElementRect(null);
            notify(tRef.current('ws.savedRemoveElement', { number: data.versions[0]?.number }), 'success');
          } else if (kind === 'enhance') {
            notify(tRef.current('ws.savedEnhance', { number: data.versions[0]?.number }), 'success');
          } else if (kind === 'remove-watermark') {
            notify(tRef.current('ws.savedWatermark', { number: data.versions[0]?.number }), 'success');
          } else if (kind === 'extract-asset') {
            notify(tRef.current('ws.savedExtract', { number: data.versions[0]?.number }), 'success');
          } else {
            notify(tRef.current('ws.savedOutpaint', { number: data.versions[0]?.number }), 'success');
          }
        } else if (task.status === 'canceled') {
          if (kind === 'local-edit') setLocalEditMode(true);
          if (kind === 'remove-element') setRemoveElementMode(true);
          notify(tRef.current('ws.canceledKeep'), 'error');
        } else {
          if (kind === 'local-edit') setLocalEditMode(true);
          if (kind === 'remove-element') setRemoveElementMode(true);
          notify(taskErrorText(task, tRef.current('ws.generateFailed')), 'error');
        }
        onProjectChanged();
      } catch { /* transient network error: keep polling */ }
    }, kind === 'batch-edit' ? 900 : 1500);
  }, [projectId, notify, onProjectChanged, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // 批量模板编辑器是命令式渲染的 contenteditable，只在面板/标签页切换（或换参考图）
  // 时按 batchTemplate 状态重建，输入过程不能重渲染，否则光标会跳。
  useEffect(() => {
    if (rightMode !== 'batch' || batchPromptTab !== 'template' || !batchTemplateEditorRef.current) return;
    renderBatchTemplateEditor(batchTemplateEditorRef.current, batchTemplate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightMode, batchType, batchPromptTab, currentImageId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getProject(projectId), api.listGeneratingTasks(projectId)]).then(([data, taskData]) => {
      setBundle(data);
      let cached: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(localStorage.getItem(draftCacheKey) || '{}');
        if (parsed && typeof parsed === 'object') cached = parsed as Record<string, unknown>;
      } catch { localStorage.removeItem(draftCacheKey); }
      const cachedDraft = cached.draft && typeof cached.draft === 'object' ? cached.draft as Record<string, unknown> : {};
      const draft = { ...(data.project.draft || {}), ...cachedDraft };
      setPrompt(String(draft.prompt || ''));
      setStylePrompt(String(draft.stylePrompt || ''));
      setBatchStylePrompt(String(draft.stylePrompt || ''));
      setOperation(String(draft.operation || 'auto'));
      setModelId(String(draft.modelId || data.project.defaultModelId || activeModel));
      const savedVisionModelId = String(draft.visionModelId || '');
      setVisionModelId(visionModels.some((model) => model.id === savedVisionModelId) ? savedVisionModelId : fallbackVisionModelId);
      setSize(String(draft.size || defaultSizeForProvider(imageModels.find((model) => model.id === String(draft.modelId || data.project.defaultModelId || activeModel)))));
      setOutputFormat((draft.outputFormat as OutputFormat) || 'png');
      setTransparentBg(Boolean(draft.transparentBg));
      setCount(Number(draft.count || 1));
      const cachedCurrentImageId = typeof cached.currentImageId === 'string' && data.images.some((image) => image.id === cached.currentImageId) ? cached.currentImageId : null;
      setCurrentImageId(cachedCurrentImageId || data.project.currentImageId || data.versions[0]?.selectedImageId || data.images.at(-1)?.id || null);
      const cachedInputImageId = typeof draft.inputImageId === 'string' && data.images.some((image) => image.id === draft.inputImageId) ? draft.inputImageId : null;
      setInputImageId(cachedInputImageId);
      initialized.current = true;
      const task = taskData.tasks[0];
      if (task) startPolling(task.id, task.operationType === 'batch_edit' || task.operationType === 'batch_generate' ? 'batch-edit' : task.operationType === 'edit_text' ? 'text-edit' : task.operationType === 'local_edit' ? 'local-edit' : task.operationType === 'remove_element' ? 'remove-element' : task.operationType === 'outpaint' ? 'outpaint' : task.operationType === 'enhance' ? 'enhance' : task.operationType === 'remove_watermark' ? 'remove-watermark' : task.operationType === 'extract_asset' ? 'extract-asset' : 'generate');
    }).catch((error) => notify(error.message, 'error')).finally(() => setLoading(false));
  }, [projectId, activeModel, activeVisionModel, startPolling, notify, draftCacheKey]);

  useEffect(() => {
    setVisionModelId((current) => visionModels.some((model) => model.id === current) ? current : fallbackVisionModelId);
  }, [models, activeVisionModel]);

  useEffect(() => {
    if (!initialized.current || !bundle) return;
    try { localStorage.setItem(draftCacheKey, JSON.stringify(draftSnapshot.current)); } catch { /* local storage may be unavailable */ }
    setSaveState('saving');
    const timer = window.setTimeout(() => { void flushDraft(); }, 900);
    return () => window.clearTimeout(timer);
  }, [prompt, stylePrompt, operation, modelId, visionModelId, size, outputFormat, transparentBg, count, inputImageId, currentImageId, flushDraft, draftCacheKey]);

  useEffect(() => {
    const persistDraft = () => {
      if (!initialized.current) return;
      try { localStorage.setItem(draftCacheKey, JSON.stringify(draftSnapshot.current)); } catch { /* local storage may be unavailable */ }
    };
    window.addEventListener('pagehide', persistDraft);
    return () => window.removeEventListener('pagehide', persistDraft);
  }, [draftCacheKey]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [bundle?.messages.length, generating]);

  const availableOutputFormats = selectedModel?.outputFormats?.length ? selectedModel.outputFormats : ['png'];
  const canChooseOutputFormat = availableOutputFormats.length > 1;
  const canUseTransparentBackground = Boolean(selectedModel?.transparentBackground);
  const maxImageCount = selectedModel?.maxCount || 1;
  // Switching models invalidates the current size — snap back to a size the
  // selected model actually supports instead of letting the API reject it.
  useEffect(() => {
    if (!selectedModel) return;
    setSize((current) => (isValidSizeForProvider(selectedModel, current) ? current : defaultSizeForProvider(selectedModel)));
    setCount((current) => Math.min(current, selectedModel.maxCount || 1));
    if (!availableOutputFormats.includes(outputFormat)) setOutputFormat(availableOutputFormats[0] as OutputFormat);
  }, [selectedModel, availableOutputFormats, outputFormat]);
  // Transparent background only works with png/webp output.
  useEffect(() => {
    if (outputFormat === 'jpeg' || !canUseTransparentBackground) setTransparentBg(false);
  }, [outputFormat, canUseTransparentBackground]);

  function chooseVersion(version: Version) {
    const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
    if (image) setCurrentImageId(image.id);
    // 批量结果面板只属于其产出的版本。查看其他历史版本时收起它，避免
    // 把上一轮批量结果误当成当前画布的候选图。
    setBatchProgress((progress) => progress?.versionId === version.id ? progress : null);
  }

  // Start an edit straight from a history entry: its image becomes the next
  // request's input, so the user only has to describe the desired change.
  function editVersion(version: Version) {
    const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
    if (!image) return;
    useImage(image);
  }

  function openCompare() {
    if (!currentImage || !bundle) return;
    const target = parentImage || bundle.images.find((image) => image.id !== currentImage.id);
    if (!target) return notify(t('ws.compareNeedTwo'), 'error');
    setCompareImageId(target.id);
    setSliderPosition(50);
    setCompareOpen(true);
  }

  function useImage(image: ProjectImage) {
    setCurrentImageId(image.id);
    setInputImageId(image.id);
    if (image.sourceType === 'upload') setSize(closestSizeForDimensions(selectedModel, image.width, image.height));
    if (operation === 'text_to_image') setOperation('auto');
  }

  // 切换画布图片时，针对旧图片的圈选与截图预览全部失效，一并清理。
  useEffect(() => {
    setLocalEditRect(null);
    setRemoveElementRect(null);
    setRemoveElementMode(false);
    removeElementBoxStart.current = null;
    localReferenceRevision.current++;
    setLocalReference(null);
    setLocalReferenceLoading(false);
    closeExtract();
  }, [currentImageId]);

  // 画廊条目的去向跟随当前面板：对话模式填入聊天输入框；批量模式追加为提示词
  // 列表的一行（批量文生图可直接复用）。两种情况都会关闭画廊回到工作台。
  function useGalleryPrompt(entry: GalleryEntry) {
    setGalleryOpen(false);
    if (rightMode === 'batch') {
      const existing = batchPromptsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (existing.length >= 50) return notify(t('ws.galleryListFull'), 'error');
      setBatchPromptTab('list');
      setBatchPromptsText([...existing, entry.prompt].join('\n'));
      notify(t('ws.galleryAppended', { count: existing.length + 1 }), 'success');
      return;
    }
    setPrompt((current) => (current.trim() ? `${current.trim()}\n${entry.prompt}` : entry.prompt));
    notify(t('ws.galleryPromptFilled'), 'success');
  }

  function useGalleryStyle(entry: GalleryEntry) {
    setGalleryOpen(false);
    // 批量文生图有独立的统一风格槽位；其余场景写入项目风格提示词。
    if (rightMode === 'batch' && batchType === 'text') {
      setBatchStylePrompt(entry.stylePrompt);
      notify(t('ws.galleryStyleBatch'), 'success');
      return;
    }
    setStylePrompt(entry.stylePrompt);
    notify(t('ws.galleryStyleProject'), 'success');
  }

  async function openTextEditor() {
    if (!currentImage) return;
    setRightMode('chat');
    closeRemoveElement();
    setTextImageId(currentImage.id);
    setTextSegments([]);
    setRecognitionModel('');
    setTextEditorError('');
    setBoxMode(false);
    setDraftRect(null);
    setRecognizingText(true);
    setTextEditorOpen(true);
    try {
      const data = await api.recognizeText(projectId, currentImage.id, visionModelId);
      setTextSegments(data.segments);
      setRecognitionModel(data.modelName);
      if (data.cached) notify(t('ws.recognizeCached'), 'success');
    } catch (error) {
      setTextEditorError((error as Error).message);
    } finally { setRecognizingText(false); }
  }

  function updateTextSegment(id: string, patch: Partial<TextSegment>) {
    setTextSegments((segments) => segments.map((segment) => segment.id === id ? { ...segment, ...patch } : segment));
  }

  function removeTextSegment(id: string) {
    setTextSegments((segments) => segments.filter((segment) => segment.id !== id));
  }

  function pointerRatio(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  }

  function onBoxStart(event: React.MouseEvent<HTMLDivElement>) {
    if (!boxMode || event.button !== 0) return;
    const point = pointerRatio(event);
    boxStart.current = point;
    setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }
  function onBoxMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!boxMode || !boxStart.current) return;
    const point = pointerRatio(event);
    setDraftRect({
      x: Math.min(point.x, boxStart.current.x),
      y: Math.min(point.y, boxStart.current.y),
      width: Math.abs(point.x - boxStart.current.x),
      height: Math.abs(point.y - boxStart.current.y),
    });
  }
  function onBoxEnd() {
    if (!boxMode || !draftRect) return;
    boxStart.current = null;
    if (draftRect.width > 2 && draftRect.height > 2) {
      setTextSegments((segments) => [...segments, {
        id: `manual-${Date.now()}`, text: '', originalText: '', context: '手动框选区域', manual: true, rect: draftRect,
      }]);
    }
    setDraftRect(null);
  }

  // 局部修改和素材提取在整个画布区域接收 Pointer Events。坐标始终按实际图片
  // 换算并限制到 0–100%，因此可以从图片外起拖或越过画布边缘，最终得到的
  // 是拖拽框与图片相交的有效区域。
  function canvasPointerRatio(event: React.PointerEvent<HTMLDivElement>) {
    const image = event.currentTarget.querySelector<HTMLImageElement>('.canvas-image-wrap > img');
    if (!image) return null;
    const bounds = image.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  }

  function onCanvasSelectionStart(event: React.PointerEvent<HTMLDivElement>) {
    if ((!localEditMode && !removeElementMode && !extractMode) || event.button !== 0 || generating || localEditSubmitting || removeElementSubmitting) return;
    const target = event.target as Element;
    if (target.closest('.local-edit-panel, .local-edit-dock, .local-batch-panel, .remove-element-panel, .extract-panel')) return;
    const point = canvasPointerRatio(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (localEditMode) {
      localBoxStart.current = point;
      setLocalDragging(true);
      setLocalEditRect({ x: point.x, y: point.y, width: 0, height: 0 });
    } else if (removeElementMode) {
      removeElementBoxStart.current = point;
      setRemoveElementDragging(true);
      setRemoveElementRect({ x: point.x, y: point.y, width: 0, height: 0 });
    } else {
      extractBoxStart.current = point;
      setExtractDragging(true);
      setExtractRect({ x: point.x, y: point.y, width: 0, height: 0 });
      setExtractPreview(null);
    }
  }

  function onCanvasSelectionMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = canvasPointerRatio(event);
    if (!point) return;
    if (localBoxStart.current) setLocalEditRect(selectionRect(localBoxStart.current, point));
    if (removeElementBoxStart.current) setRemoveElementRect(selectionRect(removeElementBoxStart.current, point));
    if (extractBoxStart.current) setExtractRect(selectionRect(extractBoxStart.current, point));
  }

  function onCanvasSelectionEnd(event: React.PointerEvent<HTMLDivElement>) {
    const point = canvasPointerRatio(event);
    if (!point) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    const localStart = localBoxStart.current;
    if (localStart) {
      const rect = selectionRect(localStart, point);
      localBoxStart.current = null;
      setLocalDragging(false);
      setLocalEditRect(rect.width > 2 && rect.height > 2 ? rect : null);
    }

    const removeStart = removeElementBoxStart.current;
    if (removeStart) {
      const rect = selectionRect(removeStart, point);
      removeElementBoxStart.current = null;
      setRemoveElementDragging(false);
      if (rect.width <= 2 || rect.height <= 2) {
        setRemoveElementRect(null);
      } else {
        setRemoveElementRect(rect);
        void submitRemoveElement(rect);
      }
    }

    const extractStart = extractBoxStart.current;
    if (extractStart) {
      const rect = selectionRect(extractStart, point);
      extractBoxStart.current = null;
      setExtractDragging(false);
      if (rect.width <= 2 || rect.height <= 2) {
        setExtractRect(null);
        setExtractPreview(null);
        return;
      }
      setExtractRect(rect);
      setExtractPreview(null);
      void cropImageRegion(currentImage!, rect)
        .then((crop) => setExtractPreview(crop ? { rect, imageId: currentImage!.id, ...crop } : null))
        .catch((error) => { setExtractPreview(null); notify((error as Error).message, 'error'); });
    }
  }

  function onCanvasSelectionCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    localBoxStart.current = null;
    removeElementBoxStart.current = null;
    extractBoxStart.current = null;
    setLocalDragging(false);
    setRemoveElementDragging(false);
    setExtractDragging(false);
    setLocalEditRect(null);
    setRemoveElementRect(null);
    setExtractRect(null);
    setExtractPreview(null);
  }

  function startLocalEdit() {
    if (!currentImage || generating) return;
    setRightMode('chat');
    closeOutpaint();
    closeRemoveElement();
    closeExtract();
    setLocalEditMode(true);
    setLocalEditRect(null);
    setLocalEditInstruction('');
    setLocalReference(null);
    setLocalBatchOpen(false);
  }

  function closeLocalEdit() {
    localReferenceRevision.current++;
    setLocalReference(null);
    setLocalReferenceLoading(false);
    localBoxStart.current = null;
    setLocalEditMode(false);
    setLocalEditRect(null);
    setLocalEditInstruction('');
    setLocalDragging(false);
    setLocalBatchOpen(false);
  }

  function startRemoveElement() {
    if (!currentImage || generating) return;
    setRightMode('chat');
    closeLocalEdit();
    closeOutpaint();
    closeExtract();
    setRemoveElementMode(true);
    setRemoveElementRect(null);
  }

  function closeRemoveElement() {
    removeElementBoxStart.current = null;
    setRemoveElementMode(false);
    setRemoveElementRect(null);
    setRemoveElementDragging(false);
  }

  async function submitRemoveElement(rect: NonNullable<TextSegment['rect']>) {
    if (!currentImage || removeElementSubmitting || generating) return;
    setRemoveElementSubmitting(true);
    setActiveTask({ id: null, kind: 'remove-element', stage: 'planning' });
    try {
      const result = await api.removeElement(projectId, {
        imageId: currentImage.id,
        modelId,
        visionModelId,
        parentVersionId: currentVersion?.id || null,
        rect,
        params: { size: closestSizeForDimensions(selectedModel, currentImage.width, currentImage.height), count: 1, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat: 'png', transparent: false },
      });
      setRemoveElementMode(false);
      startPolling(result.taskId, 'remove-element');
    } catch (error) {
      setActiveTask(null);
      setRemoveElementMode(true);
      notify((error as Error).message, 'error');
    } finally { setRemoveElementSubmitting(false); }
  }

  async function selectLocalReference(file?: File) {
    if (!file || localEditSubmitting || generating) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      notify(t('ws.referenceTooLarge'), 'error');
      return;
    }
    const revision = ++localReferenceRevision.current;
    setLocalReferenceLoading(true);
    try {
      const data = await readFileAsDataUrl(file);
      const preview = new Image();
      preview.src = data;
      await preview.decode();
      if (preview.naturalWidth * preview.naturalHeight > 40_000_000) throw new Error(t('ws.referenceTooManyPixels'));
      if (revision === localReferenceRevision.current) setLocalReference({ data, mimeType: file.type, name: file.name });
    } catch (error) {
      if (revision === localReferenceRevision.current) notify(t('ws.referenceReadFailed', { message: (error as Error).message }), 'error');
    } finally {
      if (revision === localReferenceRevision.current) setLocalReferenceLoading(false);
    }
  }

  async function submitLocalEdit() {
    if (!currentImage || !localEditRect || (!localEditInstruction.trim() && !localReference) || localReferenceLoading || localEditSubmitting || generating) return;
    setLocalEditSubmitting(true);
    setActiveTask({ id: null, kind: 'local-edit', stage: 'planning' });
    try {
      const result = await api.localEdit(projectId, {
        imageId: currentImage.id,
        modelId,
        visionModelId,
        parentVersionId: currentVersion?.id || null,
        instruction: localEditInstruction.trim(),
        reference: localReference || undefined,
        rect: localEditRect,
        params: { size: closestSizeForDimensions(selectedModel, currentImage.width, currentImage.height), count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat: localReference ? 'png' : outputFormat, transparent: localReference ? false : transparentBg },
      });
      setLocalEditMode(false);
      startPolling(result.taskId, 'local-edit');
    } catch (error) { setActiveTask(null); notify((error as Error).message, 'error'); }
    finally { setLocalEditSubmitting(false); }
  }

  // 批量局部修改：同一选区多组指令，复用批量任务的增量发布与进度轮询。
  async function submitLocalBatch() {
    if (!currentImage || !localEditRect || localBatchError || localBatchSubmitting || generating) return;
    setLocalBatchSubmitting(true);
    try {
      const result = await api.localEditBatch(projectId, {
        imageId: currentImage.id,
        modelId,
        visionModelId,
        parentVersionId: currentVersion?.id || null,
        rect: localEditRect,
        instructions: localBatchLines,
        reference: localReference || undefined,
        params: { size: closestSizeForDimensions(selectedModel, currentImage.width, currentImage.height), quality: selectedModel?.defaultParams.quality || 'auto', outputFormat: localReference ? 'png' : outputFormat, transparent: localReference ? false : transparentBg },
      });
      setLocalEditMode(false);
      setLocalBatchOpen(false);
      batchProcessed.current = 0;
      setBatchProgress(null);
      startPolling(result.taskId, 'batch-edit');
      notify(t('ws.localBatchStarted'), 'success');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setLocalBatchSubmitting(false); }
  }

  function startOutpaint() {
    if (!currentImage || generating) return;
    setRightMode('chat');
    closeLocalEdit();
    closeRemoveElement();
    closeExtract();
    const availableSizes = sizesForProvider(selectedModel);
    const sourceRatio = (currentImage.width || 1) / (currentImage.height || 1);
    const preferred = availableSizes.find((option) => Math.abs(Number(option.value.split('x')[0]) / Number(option.value.split('x')[1]) - sourceRatio) > 0.08) || availableSizes[0];
    setOutpaintSize(preferred?.value || defaultSizeForProvider(selectedModel));
    setOutpaintMode(true);
  }

  function closeOutpaint() {
    setOutpaintMode(false);
    setOutpaintSize('');
  }

  async function submitOutpaint() {
    if (!currentImage || !outpaintSize || outpaintSubmitting || generating) return;
    setOutpaintSubmitting(true);
    try {
      const result = await api.outpaint(projectId, {
        imageId: currentImage.id,
        modelId,
        parentVersionId: currentVersion?.id || null,
        size: outpaintSize,
        params: { count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: transparentBg },
      });
      closeOutpaint();
      startPolling(result.taskId, 'outpaint');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setOutpaintSubmitting(false); }
  }

  // 提取素材：与局部修改相同的圈选交互，但不需要文字说明——圈选完成后
  // 直接截图送视觉模型识别主体（忽略圈入的边缘干扰），再由改图模型生成
  // 只包含该主体的独立素材图。
  function startExtract() {
    if (!currentImage || generating) return;
    setRightMode('chat');
    closeLocalEdit();
    closeRemoveElement();
    closeOutpaint();
    setExtractMode(true);
    setExtractRect(null);
    setExtractHint('');
    setExtractPreview(null);
  }

  function closeExtract() {
    extractBoxStart.current = null;
    setExtractMode(false);
    setExtractRect(null);
    setExtractHint('');
    setExtractPreview(null);
    setExtractDragging(false);
  }

  async function submitExtract() {
    if (!currentImage || !extractRect || extractSubmitting || generating) return;
    setExtractSubmitting(true);
    try {
      // 预览仅在截图时的图片与当前图片一致时才可复用，切换画布图片后必须重截。
      const cached = extractPreview && extractPreview.imageId === currentImage.id && sameRect(extractPreview.rect, extractRect) ? extractPreview : null;
      const crop = cached || await cropImageRegion(currentImage, extractRect);
      if (!crop) throw new Error(t('ws.cropRetry'));
      const result = await api.extractAsset(projectId, {
        imageId: currentImage.id,
        modelId,
        visionModelId,
        parentVersionId: currentVersion?.id || null,
        rect: extractRect,
        crop: { data: crop.dataUrl, mimeType: crop.mimeType, padded: crop.padded },
        hint: extractHint.trim() || undefined,
        params: { size: closestSizeForDimensions(selectedModel, crop.width, crop.height), count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: false },
      });
      closeExtract();
      startPolling(result.taskId, 'extract-asset');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setExtractSubmitting(false); }
  }

  async function enhanceImage() {
    if (!currentImage || enhancing || generating) return;
    setRightMode('chat');
    closeRemoveElement();
    setEnhancing(true);
    try {
      const result = await api.enhance(projectId, {
        imageId: currentImage.id,
        modelId,
        parentVersionId: currentVersion?.id || null,
        params: { size, count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: false },
      });
      startPolling(result.taskId, 'enhance');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setEnhancing(false); }
  }

  async function removeWatermark() {
    if (!currentImage || removingWatermark || generating) return;
    setRightMode('chat');
    closeRemoveElement();
    setRemovingWatermark(true);
    try {
      const result = await api.removeWatermark(projectId, {
        imageId: currentImage.id,
        modelId,
        visionModelId,
        parentVersionId: currentVersion?.id || null,
        params: { size, count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: transparentBg },
      });
      startPolling(result.taskId, 'remove-watermark');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setRemovingWatermark(false); }
  }

  async function submitTextEdit() {
    if (!textImage || textEditSubmitting || generating) return;
    if (!hasTextChanges) return notify(t('ws.textNoChanges'), 'error');
    setTextEditSubmitting(true);
    setTextEditorOpen(false);
    setActiveTask({ id: null, kind: 'text-edit' });
    try {
      const sourceVersion = bundle?.versions.find((version) => version.outputs.some((image) => image.id === textImage.id));
      const result = await api.editText(projectId, {
        imageId: textImage.id,
        modelId,
        visionModelId,
        parentVersionId: sourceVersion?.id || null,
        segments: textSegments,
        params: { size: closestSizeForDimensions(selectedModel, textImage.width, textImage.height), count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: false },
      });
      setTextEditorError('');
      startPolling(result.taskId, 'text-edit');
    } catch (error) {
      setActiveTask(null);
      setTextEditorOpen(true);
      notify((error as Error).message, 'error');
    }
    finally { setTextEditSubmitting(false); }
  }

  function changeZoom(delta: number) {
    setZoom((current) => Math.min(2.5, Math.max(0.5, Math.round((current + delta) * 4) / 4)));
  }

  async function rename(name: string) {
    if (!bundle || !name.trim() || name.trim() === bundle.project.name) return;
    setSaveState('saving');
    try { const data = await api.updateProject(projectId, { name: name.trim() }); setBundle(data); setSaveState('saved'); onProjectChanged(); }
    catch (error) { setSaveState('failed'); notify((error as Error).message, 'error'); }
  }

  async function upload(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return notify(t('ws.uploadTypeUnsupported'), 'error');
    if (file.size > 10 * 1024 * 1024) return notify(t('ws.uploadTooLarge'), 'error');
    setUploading(true);
    uploadingRef.current = true;
    try {
      const data = await api.uploadImage(projectId, { data: await readFileAsDataUrl(file), mimeType: file.type, name: file.name });
      setBundle(data);
      const image = data.images.find((item) => item.id === data.project.currentImageId) || data.images.at(-1);
      if (image) {
        useImage(image);
        notify(t('ws.uploadMatched', { size: closestSizeForDimensions(selectedModel, image.width, image.height) }), 'success');
      } else {
        notify(t('ws.uploadSaved'), 'success');
      }
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setUploading(false); uploadingRef.current = false; if (fileRef.current) fileRef.current.value = ''; }
  }

  // Paste an image from the clipboard (screenshot tools, "copy image") onto
  // the workspace anywhere — including the canvas — and it uploads and becomes
  // the next edit's input, exactly like the upload button. Paste behavior by
  // target: text fields stay text-only (rich text that also carries an image
  // still pastes as text), and an upload already in flight swallows duplicates
  // so one screenshot cannot queue several uploads.
  function pickPasteFile(event: ClipboardEvent): File | null {
    if (event.defaultPrevented || uploadingRef.current) return null;
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return null;
    const target = event.target as Element | null;
    const inTextField = Boolean(target?.closest('textarea, input, [contenteditable="true"]'));
    const text = event.clipboardData?.getData('text/plain').trim();
    if (text && (inTextField || files.length !== 1)) return null;
    return files[0];
  }

  function handlePaste(event: ClipboardEvent) {
    const file = pickPasteFile(event);
    if (!file) return;
    event.preventDefault();
    if (localEditMode && localEditRect) {
      void selectLocalReference(file);
      return;
    }
    void upload(file);
  }

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  });

  async function send() {
    if ((!prompt.trim() && !inputImageId) || generating) return;
    try {
      const result = await api.generate(projectId, {
        prompt: prompt.trim(), operation, modelId, inputImageId, parentVersionId: inputVersion?.id || null,
        visionModelId: count > 1 && prompt.trim() ? visionModelId || undefined : undefined,
        params: { size, count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: transparentBg },
      });
      startPolling(result.taskId, 'generate');
    } catch (error) {
      notify((error as Error).message, 'error');
      try { setBundle(await api.getProject(projectId)); } catch { /* keep current view */ }
    }
  }

  function syncBatchTemplateEditor() {
    const editor = batchTemplateEditorRef.current;
    if (editor) setBatchTemplate(serializeBatchTemplateEditor(editor));
  }

  function insertBatchVariable() {
    const editor = batchTemplateEditorRef.current;
    if (!editor || detectedBatchVariables.length >= 10) return;
    editor.focus();
    const currentTemplate = serializeBatchTemplateEditor(editor);
    const name = nextBatchVariableName(batchVariableNames(currentTemplate));
    const token = createBatchVariableToken(name);
    const spacer = document.createTextNode('\u200b');
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange();
    if (!selection?.rangeCount || !editor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(token);
    token.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    setBatchVariableValues((current) => ({
      ...current,
      [name]: current[name] || Array.from({ length: batchQuantity }, () => ''),
    }));
    syncBatchTemplateEditor();
  }

  function handleBatchTemplateClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const remove = target?.closest<HTMLElement>('[data-remove-batch-variable]');
    const token = remove?.closest<HTMLElement>('[data-batch-variable]');
    if (!token) return;
    event.preventDefault();
    token.remove();
    syncBatchTemplateEditor();
    batchTemplateEditorRef.current?.focus();
  }

  function handleBatchTemplatePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const editor = batchTemplateEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const node = document.createTextNode(event.clipboardData.getData('text/plain'));
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    syncBatchTemplateEditor();
  }

  function changeBatchQuantity(value: number) {
    const next = Math.min(50, Math.max(2, Math.trunc(value || 2)));
    setBatchQuantity(next);
    setBatchVariableValues((current) => Object.fromEntries(Object.entries(current).map(([name, values]) => [
      name,
      values.length >= next ? values : [...values, ...Array.from({ length: next - values.length }, () => '')],
    ])));
  }

  // 导入 txt 提示词列表：每行一条，空行忽略；超过单批上限时保留前 50 行并提示。
  async function importBatchPromptFile(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      notify(t('ws.importNoLines'), 'error');
      return;
    }
    setBatchPromptTab('list');
    if (lines.length > 50) {
      setBatchPromptsText(lines.slice(0, 50).join('\n'));
      notify(t('ws.importTruncated', { count: lines.length }), 'error');
    } else {
      setBatchPromptsText(lines.join('\n'));
      notify(t('ws.imported', { count: lines.length }), 'success');
    }
  }

  function updateBatchValue(name: string, index: number, value: string) {
    setBatchVariableValues((current) => {
      const values = [...(current[name] || Array.from({ length: batchQuantity }, () => ''))];
      values[index] = value;
      return { ...current, [name]: values };
    });
  }

  // 批量面板提交：改图批次以画布图片为参考，文生图批次纯提示词并附加统一风格。
  async function submitBatch() {
    if (batchValidationError || batchSubmitting || generating) return;
    if (batchType === 'edit' && (!currentImage || !batchEditSupported)) return;
    if (batchType === 'text' && !batchTextSupported) return;
    setBatchSubmitting(true);
    try {
      const params = { size, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: transparentBg };
      const promptsInput = batchPromptTab === 'list'
        ? { prompts: batchPromptLines }
        : { template: batchTemplate.trim(), quantity: batchQuantity, variables: detectedBatchVariables.map((name) => ({ name, values: batchRows.map((row) => row[name]) })) };
      const result = batchType === 'edit'
        ? await api.startBatchEdit(projectId, { imageId: currentImage!.id, modelId, parentVersionId: currentImage!.versionId, params, ...promptsInput })
        : await api.startBatchGenerate(projectId, { modelId, params, stylePrompt: batchStylePrompt.trim() || undefined, ...promptsInput });
      batchProcessed.current = 0;
      setBatchProgress(null);
      startPolling(result.taskId, 'batch-edit');
      notify(batchType === 'edit' ? t('ws.batchStarted') : t('ws.batchTextStarted'), 'success');
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function cancelActiveTask() {
    if (!activeTask?.id) return;
    try { await api.cancelTask(projectId, activeTask.id); notify(t('ws.canceling'), 'success'); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function leaveWorkspace(destination: () => void) {
    if (!await flushDraft()) {
      notify(t('ws.draftSaveFailed'), 'error');
      return;
    }
    destination();
  }

  async function removeVersion(version: Version) {
    if (!bundle) return;
    const childCount = bundle.versions.filter((item) => item.parentVersionId === version.id).length;
    const baseMessage = t('ws.deleteVersionConfirm', { number: version.number });
    const childMessage = childCount ? t('ws.deleteVersionChildren', { count: childCount }) : '';
    if (!window.confirm(`${baseMessage}\n${childMessage}`)) return;
    try {
      const data = await api.deleteVersion(projectId, version.id, childCount > 0);
      setBundle(data);
      if (currentVersion?.id === version.id) setCurrentImageId(data.project.currentImageId || null);
      notify(t('ws.versionDeleted', { number: version.number }));
      onProjectChanged();
    } catch (error) {
      const message = (error as Error).message;
      if (window.confirm(t('ws.forceDeleteConfirm', { message }))) {
        try {
          const data = await api.deleteVersion(projectId, version.id, true);
          setBundle(data);
          if (currentVersion?.id === version.id) setCurrentImageId(data.project.currentImageId || null);
          notify(t('ws.versionDeleted', { number: version.number }));
          onProjectChanged();
        } catch (retryError) { notify((retryError as Error).message, 'error'); }
      }
    }
  }

  // 画布图片右键 → 收藏到提示词画廊：服务端自动用视觉模型提炼提示词。
  function openImageContextMenu(event: React.MouseEvent, imageId: string) {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, imageId });
  }

  async function saveContextImageToGallery() {
    if (!contextMenu || savingToGallery) return;
    setSavingToGallery(true);
    const imageId = contextMenu.imageId;
    setContextMenu(null);
    try {
      await api.addGalleryFromProject({ projectId, imageId, visionModelId });
      notify(t('ws.savedToGallery'), 'success');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setSavingToGallery(false); }
  }

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); };
  }, [contextMenu]);

  if (loading || !bundle) return <main className="workspace-loading">{t('ws.restoringWorkspace')}</main>;

  const beforeImage = compareMode === 'slider' ? (compareImage || parentImage) : null;
  const outpaintAspectRatio = outpaintSize ? outpaintSize.replace('x', ' / ') : undefined;

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-title-group">
          <button className="back-button compact" onClick={() => void leaveWorkspace(onBack)}>← {t('ws.backToList')}</button>
          <span className="header-divider" />
          <span className="project-name-field">
            <input className="project-name-input" defaultValue={bundle.project.name} onBlur={(event) => void rename(event.target.value)} aria-label={t('ws.projectNameAria')} title={t('ws.renameHintTitle')} />
            <Icon name="edit" size={13} />
          </span>
        </div>
        <div className={`autosave-state ${saveState}`}><span />{saveState === 'saving' ? t('ws.saveStateSaving') : saveState === 'failed' ? t('ws.saveStateFailed') : t('ws.saveStateSaved')}</div>
        <div className="workspace-header-actions">
          <select value={modelId} onChange={(event) => setModelId(event.target.value)} aria-label={t('ws.imageModelAria')} title={t('ws.imageModelTitle')}>{imageModels.map((model) => <option key={model.id} value={model.id}>{t('ws.imageModelOption', { name: model.name })}</option>)}</select>
          <select className="vision-model-select" value={visionModelId} onChange={(event) => setVisionModelId(event.target.value)} aria-label={t('ws.visionModelAria')} title={t('ws.visionModelTitle')} disabled={!visionModels.length || visionBusy}>
            {!visionModels.length && <option value="">{t('ws.noVisionModel')}</option>}
            {visionModels.map((model) => <option key={model.id} value={model.id}>{t('ws.visionModelOption', { name: model.name })}</option>)}
          </select>
          <button className="gallery-open-button" title={t('ws.galleryBtnTitle')} aria-label={t('pg.title')} onClick={() => setGalleryOpen(true)}><span className="gallery-open-icon"><Icon name="gallery" size={17} /><Icon name="sparkle" size={9} /></span><span className="gallery-open-copy"><strong>{t('pg.title')}</strong><small>{t('ws.galleryBtnSubtitle')}</small></span></button>
          <button className="icon-button theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? t('common.switchToLight') : t('common.switchToDark')} aria-label={t('common.toggleTheme')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /></button>
          <LanguageToggle />
          <button className="icon-button" title={t('ws.logsTitle')} aria-label={t('ws.logsTitle')} onClick={() => setModelLogsOpen(true)}><Icon name="logs" size={17} /></button>
          <button className="icon-button" title={t('mc.title')} onClick={() => void leaveWorkspace(onModels)}><Icon name="sliders" size={17} /></button>
        </div>
      </header>

      <section className="workspace-body">
        <aside className="versions-panel">
          <div className="workspace-panel-title"><div><p className="eyebrow">VERSIONS</p><h2>{t('ws.historyTitle')}</h2></div><span>{bundle.versions.length}</span></div>
          <div className="version-list">
            {bundle.versions.map((version) => <VersionItem key={version.id} version={version} active={version.id === currentVersion?.id} onSelect={() => chooseVersion(version)} onEdit={() => editVersion(version)} onDownload={() => api.downloadVersionImages(projectId, version.id)} onDelete={() => version.status === 'generating' ? notify(t('ws.batchVersionBusy'), 'error') : void removeVersion(version)} />)}
            {!bundle.versions.length && <div className="small-empty"><span><Icon name="image" size={22} /></span><p>{t('ws.emptyVersions')}</p></div>}
          </div>
          <button className="version-tree-button" disabled={!bundle.versions.length} onClick={() => setVersionTreeOpen(true)}><Icon name="tree" size={15} /> {t('ws.viewTree')}</button>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
              <div className="canvas-context">{currentVersion ? <><strong>V{currentVersion.number}</strong><span>{currentVersion.operation && operationKeys[currentVersion.operation] ? t(operationKeys[currentVersion.operation]) : currentVersion.operation}</span></> : <span>{t('ws.projectCanvas')}</span>}</div>
            <div className="canvas-actions"><button disabled={!currentImage} onClick={() => changeZoom(-0.25)} aria-label={t('common.zoomOut')}><Icon name="minus" size={14} /></button><button className="zoom-label" disabled={!currentImage} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button disabled={!currentImage} onClick={() => changeZoom(0.25)} aria-label={t('common.zoomIn')}><Icon name="plus" size={14} /></button><button className={`local-edit-launch ${localEditMode ? 'active' : ''}`} disabled={!currentImage || generating || removingWatermark || enhancing} title={localEditMode || localEditRect ? t('ws.exitLocalEditTitle') : t('ws.localEditTitle')} onClick={localEditMode || localEditRect ? closeLocalEdit : startLocalEdit}>{localEditMode || localEditRect ? <><Icon name="close" size={14} /> {t('ws.exitLocalEdit')}</> : <><Icon name="box" size={14} /> {t('ws.localEdit')}</>}</button><button className={`remove-element-launch ${(removeElementMode || removeElementRect) ? 'active' : ''}`} disabled={!currentImage || generating || removingWatermark || enhancing} title={(removeElementMode || removeElementRect) ? t('ws.exitRemoveElementTitle') : t('ws.removeElementTitle')} onClick={(removeElementMode || removeElementRect) ? closeRemoveElement : startRemoveElement}>{(removeElementMode || removeElementRect) ? <><Icon name="close" size={14} /> {t('ws.exitRemoveElement')}</> : <><Icon name="trash" size={14} /> {t('ws.removeElement')}</>}</button><button className={`extract-launch ${(extractMode || extractRect) ? 'active' : ''}`} disabled={!currentImage || generating || removingWatermark || enhancing} title={(extractMode || extractRect) ? t('ws.exitExtractTitle') : t('ws.extractTitle')} onClick={(extractMode || extractRect) ? closeExtract : startExtract}>{(extractMode || extractRect) ? <><Icon name="close" size={14} /> {t('ws.exitExtract')}</> : <><Icon name="extract" size={14} /> {t('ws.extract')}</>}</button><button className={`outpaint-launch ${outpaintMode ? 'active' : ''}`} disabled={!currentImage || generating || removingWatermark || enhancing} title={outpaintMode ? t('ws.exitOutpaintTitle') : t('ws.outpaintTitle')} onClick={outpaintMode ? closeOutpaint : startOutpaint}>{outpaintMode ? <><Icon name="close" size={14} /> {t('ws.exitOutpaint')}</> : <><Icon name="image" size={14} /> {t('ws.outpaint')}</>}</button><button className="enhance-launch" disabled={!currentImage || generating || removingWatermark || enhancing} title={t('ws.enhanceTitle')} onClick={() => void enhanceImage()}>{enhancing ? t('ws.processing') : <><Icon name="sparkle" size={14} /> {t('ws.enhance')}</>}</button><button className="watermark-remove-launch" disabled={!currentImage || generating || removingWatermark || enhancing} title={t('ws.watermarkTitle')} onClick={() => void removeWatermark()}>{removingWatermark ? t('ws.recognizing') : <><Icon name="sparkle" size={14} /> {t('ws.removeWatermark')}</>}</button><button disabled={!currentImage || generating || removingWatermark || enhancing} onClick={() => void openTextEditor()}>{t('ws.editText')}</button><button disabled={!currentImage} onClick={openCompare}>{t('ws.compare')}</button><a className={!currentImage ? 'disabled' : ''} href={currentImage?.url} download>{t('common.download')}</a>{currentVersion && currentVersion.outputs.length > 1 && <button className="download-version-zip" title={t('ws.downloadZipTitle', { count: currentVersion.outputs.length })} onClick={() => api.downloadVersionImages(projectId, currentVersion.id)}><Icon name="download" size={13} /> ZIP</button>}</div>
          </div>
          <div className={`canvas-stage ${(localEditMode || removeElementMode || extractMode) ? 'selection-mode' : ''}`} onPointerDown={onCanvasSelectionStart} onPointerMove={onCanvasSelectionMove} onPointerUp={onCanvasSelectionEnd} onPointerCancel={onCanvasSelectionCancel}>
            {currentImage ? <div className={`canvas-image-wrap ${zoom !== 1 ? 'is-zoomed' : ''} ${localEditMode ? 'local-editing' : ''} ${(removeElementMode || removeElementRect) ? 'removing-element' : ''} ${(extractMode || extractRect) ? 'extracting' : ''} ${outpaintMode ? 'outpaint-preview-wrap' : ''}`} style={zoom !== 1 ? { width: `${zoom * 100}%` } : undefined} onContextMenu={(event) => openImageContextMenu(event, currentImage.id)}>{outpaintMode ? <div className="outpaint-preview" style={outpaintAspectRatio ? { aspectRatio: outpaintAspectRatio } : undefined}><img src={currentImage.url} alt={t('ws.outpaintPreviewAlt', { version: currentVersion ? ` V${currentVersion.number}` : '' })} /><span>{t('ws.newCanvasArea')}</span></div> : <img src={currentImage.url} alt={t('ws.projectImageAlt', { version: currentVersion ? ` V${currentVersion.number}` : '' })} />}{(localEditMode || localEditRect) && <div className="local-edit-surface">{localEditRect && <span className="local-edit-rect" style={{ left: `${localEditRect.x}%`, top: `${localEditRect.y}%`, width: `${localEditRect.width}%`, height: `${localEditRect.height}%` }}><em>{t('ws.editArea')}</em></span>}</div>}{(removeElementMode || removeElementRect) && <div className="remove-element-surface">{removeElementRect && <span className="remove-element-rect" style={{ left: `${removeElementRect.x}%`, top: `${removeElementRect.y}%`, width: `${removeElementRect.width}%`, height: `${removeElementRect.height}%` }}><em>{t('ws.removeElementArea')}</em></span>}</div>}{(extractMode || extractRect) && <div className="extract-surface">{extractRect && <span className="extract-rect" style={{ left: `${extractRect.x}%`, top: `${extractRect.y}%`, width: `${extractRect.width}%`, height: `${extractRect.height}%` }}><em>{t('ws.extractArea')}</em></span>}</div>}<span className="image-chip">{outpaintMode ? t('ws.targetSize', { size: outpaintSize }) : `${currentImage.width || '—'} × ${currentImage.height || '—'}`}</span></div> : (
              <div className="canvas-empty"><div className="empty-visual"><span /><span /><span /></div><h2>{t('ws.startFirstTitle')}</h2><p>{t('ws.startFirstHint')}</p><button className="button secondary" onClick={() => fileRef.current?.click()}>{t('ws.uploadInitial')}</button></div>
            )}
            {removeElementMode && !removeElementDragging && currentImage && <section className="remove-element-panel" role="dialog" aria-label={t('ws.removeElement')}><div><strong>{t('ws.removeElement')}</strong><span>{removeElementSubmitting ? t('ws.removeElementIdentifying') : t('ws.removeElementHint')}</span></div><button disabled={removeElementSubmitting || generating} onClick={closeRemoveElement}><Icon name="close" size={13} /> {t('common.exit')}</button></section>}
            {localEditMode && !localDragging && currentImage && <div className="local-edit-dock">
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
            </div>}
            {outpaintMode && currentImage && <section className="outpaint-panel"><div className="outpaint-panel-head"><div><strong>{t('ws.outpaint')}</strong><span>{t('ws.outpaintPickRatio')}</span></div><button className="outpaint-exit" onClick={closeOutpaint}><Icon name="close" size={13} /> {t('common.exit')}</button></div><div className="outpaint-size-list">{sizesForProvider(selectedModel).map((option) => <button key={option.value} className={option.value === outpaintSize ? 'active' : ''} onClick={() => setOutpaintSize(option.value)}><strong>{option.ratio}</strong><span>{option.value}</span></button>)}</div><p className="outpaint-summary">{t('ws.outpaintSummary')}</p><div className="outpaint-panel-actions"><button className="button secondary" onClick={closeOutpaint}>{t('common.cancel')}</button><button className="button primary" disabled={!outpaintSize || outpaintSubmitting || generating} onClick={() => void submitOutpaint()}>{outpaintSubmitting ? t('ws.outpaintSubmitting') : t('ws.confirmOutpaint')}</button></div></section>}
            {(extractMode || extractRect) && !extractDragging && currentImage && <section className="extract-panel"><div className="extract-panel-head"><div><strong>{t('ws.extract')}</strong><span>{extractRect ? t('ws.extractHintRect') : t('ws.extractHintNoRect')}</span></div><button className="extract-exit" onClick={closeExtract}><Icon name="close" size={13} /> {t('common.exit')}</button></div>{extractRect && <><div className="extract-preview">{extractPreview ? <img src={extractPreview.dataUrl} alt={t('ws.extractPreviewAlt')} /> : <span className="extract-preview-loading"><span className="spinner" />{t('ws.cropping')}</span>}{extractPreview && <small>{extractPreview.padded ? t('ws.autoPadded') : ''}{extractPreview.width} × {extractPreview.height}</small>}</div><textarea value={extractHint} onChange={(event) => setExtractHint(event.target.value)} placeholder={t('ws.extractInputPlaceholder')} rows={2} /><div className="extract-panel-actions"><button className="button secondary" onClick={() => { setExtractRect(null); setExtractPreview(null); }}>{t('ws.reselect')}</button><button className="button primary" disabled={!extractPreview || extractSubmitting || generating} onClick={() => void submitExtract()}>{extractSubmitting ? t('ws.extractSubmitting') : t('ws.extractSubmit')}</button></div></>}</section>}
          </div>
          {batchProgress && <section className={`batch-progress-panel ${batchProgress.status}`} aria-live="polite">
            <div className="batch-progress-head">
              <div><strong>{batchProgress.textBatch ? t('ws.batchText') : batchProgress.localEdit ? t('ws.batchLocal') : t('ws.batchEdit')} · {batchProgress.completed}/{batchProgress.total}</strong><span>{batchProgress.status === 'generating' ? t('ws.remaining', { count: batchProgress.remaining, eta: formatRemainingTime(batchProgress.estimatedRemainingSeconds) }) : batchProgress.status === 'success' ? t('ws.allDone') : batchProgress.status === 'partial' ? t('ws.endedPartial', { count: batchProgress.failed }) : batchProgress.status === 'canceled' ? t('ws.canceled') : t('ws.failed')}</span></div>
              {batchProgress.status === 'generating' ? <button className="button secondary" onClick={() => void cancelActiveTask()}>{t('ws.cancelBatch')}</button> : <button className="icon-button" title={t('ws.collapseBatch')} onClick={() => setBatchProgress(null)}><Icon name="close" size={14} /></button>}
            </div>
            <div className="batch-progress-track"><span style={{ width: `${Math.round(((batchProgress.completed + batchProgress.failed) / Math.max(1, batchProgress.total)) * 100)}%` }} /></div>
            <div className="batch-result-list">
              {batchProgress.items.map((item) => {
                const valueLabel = batchItemValueLabel(item.values);
                return item.image
                  ? <button key={item.index} className="batch-result-item success" title={valueLabel} onClick={() => useImage(item.image!)}><img src={thumbUrl(item.image, 220)} alt={`${valueLabel} ${t('ws.batchResultAlt')}`} /><span>{item.index + 1}. {valueLabel}</span></button>
                  : <div key={item.index} className={`batch-result-item ${item.status}`} title={item.error || undefined}><span className="batch-result-placeholder">{item.status === 'generating' ? <span className="spinner" /> : item.status === 'failed' ? '!' : item.status === 'canceled' ? '×' : item.index + 1}</span><span>{item.index + 1}. {valueLabel}</span>{item.status === 'failed' && <small>{t('ws.failedShort')}</small>}{item.status === 'canceled' && <small>{t('ws.canceledShort')}</small>}</div>;
              })}
            </div>
          </section>}
          {currentVersion && currentVersion.outputs.length > 1 && batchProgress?.versionId !== currentVersion.id && <div className="candidate-strip"><span>{t('ws.candidates')}</span>{currentVersion.outputs.map((image, index) => <button key={image.id} className={image.id === currentImageId ? 'active' : ''} title={t('ws.candidateTitle')} onClick={() => useImage(image)} onContextMenu={(event) => openImageContextMenu(event, image.id)}><img src={thumbUrl(image)} alt={t('ws.candidateAltResult', { index: index + 1 })} loading="lazy" /></button>)}</div>}
        </section>

        <aside className={`conversation-panel ${rightMode === 'batch' ? 'batch-mode' : ''}`}>
          <div className="conversation-title">
            <div><p className="eyebrow">{rightMode === 'batch' ? 'BATCH STUDIO' : 'CONVERSATION'}</p><h2>{rightMode === 'batch' ? t('ws.batchStudio') : t('ws.chatTitle')}</h2></div>
            <div className="conversation-title-actions">
              <div className="panel-mode-tabs" role="tablist" aria-label={t('ws.panelModeAria')}>
                <button type="button" role="tab" aria-selected={rightMode === 'chat'} className={rightMode === 'chat' ? 'active' : ''} onClick={() => setRightMode('chat')}>{t('ws.chatTab')}</button>
                <button type="button" role="tab" aria-selected={rightMode === 'batch'} className={rightMode === 'batch' ? 'active' : ''} onClick={() => setRightMode('batch')}>{t('ws.batchTab')}</button>
              </div>
              {rightMode === 'chat' && <button className="icon-button" title={t('ws.scrollLatest')} onClick={() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })}><Icon name="down" size={16} /></button>}
            </div>
          </div>
          {rightMode === 'chat' ? <>
          <div className="message-list">
            {bundle.messages.map((message) => {
              if (message.role === 'system') return <div className="system-message" key={message.id}>{persistedText(message.content, message.content.text || '')}</div>;
              if (message.role === 'user') {
                const attached = message.content.inputImageId ? imageMap.get(message.content.inputImageId) : null;
                return <article className="message user-message" key={message.id}><div className="message-meta"><strong>{t('ws.you')}</strong><span>{formatTime(message.createdAt, language)}</span></div>{attached && <img className="message-attachment" src={thumbUrl(attached)} alt={t('ws.inputImageAlt')} loading="lazy" />}<p>{message.content.prompt || t('ws.defaultPrompt')}</p><div className="message-params"><span>{message.content.operation && operationKeys[message.content.operation] ? t(operationKeys[message.content.operation]) : message.content.operation || t('op.auto')}</span><span>{message.content.modelName}</span>{message.content.batch?.values && <span>{t('ws.variableCount', { count: message.content.batch.values.length })}</span>}{message.content.batch?.prompts && <span>{message.content.batch.local ? t('ws.instructionCount', { count: message.content.batch.prompts.length }) : t('ws.promptCount', { count: message.content.batch.prompts.length })}</span>}{message.content.splitPrompts && <span>{t('ws.perImageDifferent')}</span>}</div></article>;
              }
              if (message.type === 'canceled') return <article className="message canceled-message" key={message.id}><div className="message-meta"><strong>{t('ws.canceledTitle')}</strong><span>{formatTime(message.createdAt, language)}</span></div><p>{persistedText(message.content, message.content.message || '')}</p>{message.content.prompt && <button onClick={() => setPrompt(message.content.prompt || '')}>{t('ws.restorePrompt')}</button>}</article>;
              if (message.type === 'error') return <article className="message error-message" key={message.id}><div className="message-meta"><strong>{t('ws.failedTitle')}</strong><span>{formatTime(message.createdAt, language)}</span></div><p>{persistedText(message.content, message.content.message || '')}</p><button onClick={() => setPrompt(message.content.prompt || '')}>{t('ws.restorePrompt')}</button></article>;
              const outputs = (message.content.outputImageIds || []).map((id) => imageMap.get(id)).filter(Boolean) as ProjectImage[];
              const batchFailed = message.content.batch?.failed || 0;
              const resultParagraph = message.content.batch?.local
                ? batchFailed ? t('ws.msgLocalBatchPartial', { count: outputs.length, failed: batchFailed }) : t('ws.msgLocalBatchAll', { count: outputs.length })
                : message.content.operation === 'batch_generate'
                  ? batchFailed ? t('ws.msgTextBatchPartial', { count: outputs.length, failed: batchFailed }) : t('ws.msgTextBatchAll', { count: outputs.length })
                  : message.content.operation === 'batch_edit'
                    ? batchFailed ? t('ws.msgEditBatchPartial', { count: outputs.length, failed: batchFailed }) : t('ws.msgEditBatchAll', { count: outputs.length })
                    : t('ws.msgGenerateAll', { count: outputs.length });
              return <article className="message assistant-message" key={message.id}><div className="message-meta"><strong>Layerive</strong><span>V{message.content.versionNumber} · {formatTime(message.createdAt, language)}</span></div><p>{resultParagraph}</p><div className={`message-gallery count-${outputs.length}`}>{outputs.map((image, index) => <button key={image.id} title={message.content.prompts?.[index] ? t('ws.msgPromptTitle', { prompt: message.content.prompts[index] }) : t('ws.candidateTitle')} onClick={() => useImage(image)} onContextMenu={(event) => openImageContextMenu(event, image.id)}><img src={thumbUrl(image)} alt={t('ws.generatedAlt')} loading="lazy" /></button>)}</div><div className="message-actions"><button onClick={() => { const first = outputs[0]; if (first) useImage(first); }}>{t('ws.useThisRound')}</button><button onClick={() => setPrompt(message.content.prompt || '')}>{t('ws.reusePrompt')}</button></div></article>;
            })}
            {generating && <article className="message generating-message"><div className="message-meta"><strong>Layerive</strong><span>{activeTask?.id ? t('ws.generating') : t('ws.preparing')}</span></div><div className="generation-progress"><span /><span /><span /></div><p>{activeTask?.kind === 'batch-edit' ? (batchProgress ? t('ws.msgBatchProcessingDone', { label: batchProgress.textBatch ? t('ws.batchText') : batchProgress.localEdit ? t('ws.batchLocal') : t('ws.batchEdit'), done: `${batchProgress.completed}/${batchProgress.total}` }) : t('ws.msgBatchProcessing', { label: t('ws.batchEdit') })) : activeTask?.kind === 'local-edit' ? t(localEditStageKeys[activeTask.stage || 'planning']) : activeTask?.kind === 'remove-element' ? t(removeElementStageKeys[activeTask.stage || 'planning']) : activeTask?.kind === 'text-edit' && !activeTask.id ? t('ws.msgTextPreparing') : activeTask?.kind === 'generate' && activeTask.stage === 'planning' ? t('ws.msgPlanning') : t('ws.msgCreating', { model: selectedModel?.name || t('ws.imageModelFallback'), count })}</p>{activeTask?.id && <button className="cancel-task-button" onClick={() => void cancelActiveTask()}>{t('ws.cancelTask')}</button>}</article>}
            <div ref={messagesEnd} />
          </div>

          <div className="composer-wrap">
            <details className="style-prompt" open={Boolean(stylePrompt)}>
              <summary>{t('ws.stylePromptTitle')}{stylePrompt ? <em>{t('ws.styleSet')}</em> : <span>{t('ws.styleOptional')}</span>}</summary>
              <textarea value={stylePrompt} onChange={(event) => setStylePrompt(event.target.value)} placeholder={t('ws.stylePlaceholder')} rows={2} />
            </details>
            {inputImage && <div className="input-context"><img src={thumbUrl(inputImage)} alt={t('ws.currentInputAlt')} loading="lazy" /><div><strong>{t('ws.basedOnImage')}</strong><span>{inputVersion ? t('ws.editingVersion', { number: inputVersion.number }) : t('ws.uploadAsset')}</span></div><button onClick={() => setInputImageId(null)} aria-label={t('ws.clearInputAria')}><Icon name="close" size={13} /></button></div>}
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={inputImage ? t('ws.promptPlaceholderEdit') : t('ws.promptPlaceholderGenerate')} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send(); }} />
            <div className="composer-tools">
              <div className="composer-left">
                <button className="attach-button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={t('ws.uploadImageAria')}>{uploading ? '…' : <Icon name="plus" size={16} />}</button>
                <select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="auto">{t('op.auto')}</option><option value="text_to_image">{t('op.text_to_image')}</option><option value="image_to_image">{t('op.image_to_image')}</option><option value="edit_prompt">{t('op.edit_prompt')}</option></select>
                <select value={size} onChange={(event) => setSize(event.target.value)} title={t('ws.sizeTitle')}>
                  {sizesForProvider(selectedModel).map((option) => <option key={option.value} value={option.value}>{option.ratio} · {option.value}</option>)}
                  {!isValidSizeForProvider(selectedModel, size) && <option value={size}>{size}</option>}
                </select>
                <select value={count} onChange={(event) => setCount(Number(event.target.value))} aria-label={t('ws.countAria')} title={t('ws.countTitle')} disabled={generating}>{Array.from({ length: maxImageCount }, (_, index) => <option key={index + 1} value={index + 1}>{t('common.countImages', { count: index + 1 })}</option>)}</select>
                {(canChooseOutputFormat || canUseTransparentBackground) && <>
                  {canChooseOutputFormat && <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)} title={t('ws.formatTitle')}>{availableOutputFormats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select>}
                  {canUseTransparentBackground && <button type="button" className={`bg-toggle ${transparentBg ? 'active' : ''}`} disabled={outputFormat === 'jpeg'} title={outputFormat === 'jpeg' ? t('ws.transparentJpeg') : t('ws.transparentTitle')} onClick={() => setTransparentBg((value) => !value)}>{t('ws.transparent')}</button>}
                </>}
              </div>
              <button className="send-button" disabled={generating || (!prompt.trim() && !inputImageId)} onClick={() => void send()} aria-label={t('ws.sendAria')}><Icon name="up" size={17} /></button>
            </div>
            <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
          </div>
          </> : <div className="batch-panel">
            <div className="batch-panel-scroll">
            <div className="batch-type-tabs" role="tablist" aria-label={t('ws.batchTypeAria')}>
              <button type="button" role="tab" aria-selected={batchType === 'edit'} className={batchType === 'edit' ? 'active' : ''} disabled={!batchEditSupported} title={!batchEditSupported ? t('ws.modelNoEditPrompt') : t('ws.tabEditTitleAttr')} onClick={() => setBatchType('edit')}><strong>{t('op.batch_edit')}</strong><small>{t('ws.tabEditSubtitle')}</small></button>
              <button type="button" role="tab" aria-selected={batchType === 'text'} className={batchType === 'text' ? 'active' : ''} disabled={!batchTextSupported} title={!batchTextSupported ? t('ws.modelNoTextToImage') : t('ws.tabTextTitleAttr')} onClick={() => setBatchType('text')}><strong>{t('op.batch_generate')}</strong><small>{t('ws.tabTextSubtitle')}</small></button>
            </div>
            {batchType === 'edit'
              ? currentImage
                ? <div className="batch-edit-source"><img src={thumbUrl(currentImage)} alt={t('ws.batchSourceAlt')} /><div><strong>{t('ws.unifiedReference')}</strong><span>{currentImage.width || '—'} × {currentImage.height || '—'} · {selectedModel?.name || t('ws.currentImageModel')}</span></div></div>
                : <div className="batch-panel-hint">{t('ws.needCanvasImage')}</div>
              : <div className="batch-generate-params">
                  <label className="batch-param"><span>{t('ws.sizeLabel')}</span><select value={size} onChange={(event) => setSize(event.target.value)} title={t('ws.batchSizeTitle')}>{sizesForProvider(selectedModel).map((option) => <option key={option.value} value={option.value}>{option.ratio} · {option.value}</option>)}{!isValidSizeForProvider(selectedModel, size) && <option value={size}>{size}</option>}</select></label>
                  {canChooseOutputFormat && <label className="batch-param"><span>{t('ws.formatLabel')}</span><select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)} title={t('ws.formatTitle')}>{availableOutputFormats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>}
                  {canUseTransparentBackground && <button type="button" className={`batch-transparent-toggle ${transparentBg ? 'active' : ''}`} disabled={outputFormat === 'jpeg'} title={outputFormat === 'jpeg' ? t('ws.transparentJpeg') : t('ws.transparentTitle')} onClick={() => setTransparentBg((value) => !value)}>{t('ws.transparent')}</button>}
                </div>}
            <div className="batch-tabs" role="tablist" aria-label={t('ws.inputModeAria')}>
              <button type="button" role="tab" aria-selected={batchPromptTab === 'template'} className={batchPromptTab === 'template' ? 'active' : ''} onClick={() => setBatchPromptTab('template')}><strong>{t('ws.tabTemplate')}</strong><small>{t('ws.tabTemplateSub')}</small></button>
              <button type="button" role="tab" aria-selected={batchPromptTab === 'list'} className={batchPromptTab === 'list' ? 'active' : ''} onClick={() => setBatchPromptTab('list')}><strong>{t('ws.tabList')}</strong><small>{t('ws.tabListSub')}</small></button>
            </div>
            {batchPromptTab === 'template' ? <>
              <div className="field batch-template-field">
                <div className="batch-field-heading"><span>{t('ws.templateLabel')}</span><div className="batch-heading-actions"><button type="button" disabled={detectedBatchVariables.length >= 10} onMouseDown={(event) => event.preventDefault()} onClick={insertBatchVariable}><Icon name="plus" size={13} /> {t('ws.insertVariable')}</button></div></div>
                <div ref={batchTemplateEditorRef} className="batch-template-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={t('ws.templateAria')} data-placeholder={t('ws.templatePlaceholder')} onInput={syncBatchTemplateEditor} onClick={handleBatchTemplateClick} onPaste={handleBatchTemplatePaste} />
                <small>{t('ws.templateHint')}</small>
              </div>
              <label className="field batch-quantity-field"><span>{t('ws.quantityLabel')}</span><input type="number" min="2" max="50" value={batchQuantity} onChange={(event) => changeBatchQuantity(Number(event.target.value))} /><small>{t('ws.quantityHint')}</small></label>
              <div className="field batch-values-field"><span>{t('ws.valuesLabel')}</span>{detectedBatchVariables.length
                ? <div className="batch-value-table"><div className="batch-value-row batch-value-header" style={{ gridTemplateColumns: `64px repeat(${detectedBatchVariables.length}, minmax(132px, 1fr))` }}><span>{t('ws.imageHeader')}</span>{detectedBatchVariables.map((name) => <strong key={name}>{name}</strong>)}</div>{batchRows.map((row, index) => <div key={index} className="batch-value-row" style={{ gridTemplateColumns: `64px repeat(${detectedBatchVariables.length}, minmax(132px, 1fr))` }}><span>{t('ws.rowHeader', { index: index + 1 })}</span>{detectedBatchVariables.map((name) => <input key={name} className={row[name] ? 'filled' : ''} value={batchVariableValues[name]?.[index] || ''} onChange={(event) => updateBatchValue(name, index, event.target.value)} placeholder={index === 0 ? t('ws.valuePlaceholder', { name }) : ''} aria-label={t('ws.valueAria', { index: index + 1, name })} />)}</div>)}</div>
                : <div className="batch-values-empty">{t('ws.valuesEmpty')}</div>}<small className={batchExpectedValueCount > 0 && batchFilledCount === batchExpectedValueCount ? 'valid' : ''}>{t('ws.valuesFilled', { filled: batchFilledCount, expected: batchExpectedValueCount })}</small></div>
            </> : <div className="field batch-template-field">
              <div className="batch-field-heading"><span>{t('ws.listLabel')}</span><div className="batch-heading-actions"><button type="button" title={t('ws.importTitle')} onMouseDown={(event) => event.preventDefault()} onClick={() => batchImportFileRef.current?.click()}><Icon name="download" size={13} /> {t('ws.importTxt')}</button></div></div>
              <textarea className="batch-prompts-editor" value={batchPromptsText} onChange={(event) => setBatchPromptsText(event.target.value)} rows={8} spellCheck={false} aria-label={t('ws.listAria')} placeholder={t('ws.listPlaceholder')} />
              <small className={batchValidationError === null ? 'valid' : ''}>{batchPromptLines.length ? t('ws.listCount', { count: batchPromptLines.length }) : t('ws.listCountEmpty')}</small>
              <details className="batch-import-help">
                <summary>{t('ws.importHelpTitle')}</summary>
                <ul>
                  <li>{t('ws.importHelp1')}</li>
                  <li>{t('ws.importHelp2')}</li>
                  <li>{t('ws.importHelp3')}</li>
                  <li>{t('ws.importHelp4')}</li>
                </ul>
              </details>
            </div>}
            {batchType === 'text' && <label className="field batch-style-field"><span>{t('ws.batchStyleLabel')}</span><textarea value={batchStylePrompt} onChange={(event) => setBatchStylePrompt(event.target.value)} rows={2} placeholder={t('ws.batchStylePlaceholder')} /><small>{t('ws.batchStyleHint')}</small></label>}
            <div className="batch-edit-note"><Icon name="sparkle" size={15} /><span>{batchType === 'edit'
              ? batchPromptTab === 'list'
                ? t('ws.noteEditList')
                : t('ws.noteEditTemplate')
              : batchPromptTab === 'list'
                ? t('ws.noteTextList')
                : t('ws.noteTextTemplate')}</span></div>
            {batchValidationError && <p className="batch-validation-error">{batchValidationError}</p>}
            </div>
            <div className="batch-panel-footer">
              <div className="batch-panel-actions">
                <button className="button primary" disabled={Boolean(batchValidationError) || batchSubmitting || generating || (batchType === 'edit' && !currentImage)} onClick={() => void submitBatch()}>{batchSubmitting ? t('ws.creatingBatch') : t('ws.startGenerate', { count: batchPromptTab === 'list' ? batchPromptLines.length : batchQuantity })}</button>
              </div>
            </div>
            <input ref={batchImportFileRef} hidden type="file" accept=".txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importBatchPromptFile(file); }} />
          </div>}
        </aside>
      </section>

      {compareOpen && currentImage && compareImage && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCompareOpen(false)}>
        <section className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title">
          <div className="modal-heading">
            <div><p className="eyebrow">COMPARE</p><h2 id="compare-title">{t('ws.compareTitle')}</h2></div>
            <div className="compare-mode-switch">
              <button className={compareMode === 'side' ? 'active' : ''} onClick={() => setCompareMode('side')}>{t('ws.sideBySide')}</button>
              <button className={compareMode === 'slider' ? 'active' : ''} onClick={() => setCompareMode('slider')}>{t('ws.slider')}</button>
              <button className="icon-button" onClick={() => setCompareOpen(false)}><Icon name="close" size={16} /></button>
            </div>
          </div>
          {compareMode === 'side' ? (
            <div className="compare-grid">
              <article><div className="compare-image"><img src={currentImage.url} alt={t('ws.currentCanvasAlt')} /></div><div className="compare-caption"><strong>{t('ws.currentCanvas')}</strong><button className="button secondary" onClick={() => { useImage(currentImage); setCompareOpen(false); }}>{t('ws.useThis')}</button></div></article>
              <article><div className="compare-image"><img src={compareImage.url} alt={t('ws.compareImageAlt')} /></div><div className="compare-caption"><strong>{compareImage.versionId ? t('ws.historyImage') : t('ws.projectAsset')}</strong><button className="button primary" onClick={() => { useImage(compareImage); setCompareOpen(false); }}>{t('ws.useThis')}</button></div></article>
            </div>
          ) : (
            <div className="compare-slider-block">
              <div className="compare-slider">
                <img src={compareImage.url} alt={t('ws.compareImageAlt')} />
                <img src={currentImage.url} alt={t('ws.currentCanvasAlt')} style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }} />
                <div className="slider-divider" style={{ left: `${sliderPosition}%` }} />
                <span className="slider-tag left">{t('ws.before')}</span>
                <span className="slider-tag right">{t('ws.after')}</span>
              </div>
              <input type="range" min={0} max={100} value={sliderPosition} onChange={(event) => setSliderPosition(Number(event.target.value))} aria-label={t('ws.sliderAria')} />
              <div className="compare-caption inline"><strong>{parentImage?.id === compareImage.id ? t('ws.beforeParent') : t('ws.compareImage')}</strong><button className="button primary" onClick={() => { useImage(compareImage); setCompareOpen(false); }}>{t('ws.useBefore')}</button></div>
            </div>
          )}
          <div className="compare-picker"><span>{t('ws.pickCompare')}</span><div>{bundle.images.filter((image) => image.id !== currentImage.id).map((image) => <button key={image.id} className={image.id === compareImage.id ? 'active' : ''} onClick={() => { setCompareImageId(image.id); setSliderPosition(50); }}><img src={thumbUrl(image)} alt={t('ws.pickCompareAlt')} loading="lazy" /></button>)}</div></div>
        </section>
      </div>}

      {versionTreeOpen && <VersionTreeModal versions={bundle.versions} currentVersionId={currentVersion?.id || null} onClose={() => setVersionTreeOpen(false)} onSelect={(version) => { chooseVersion(version); setVersionTreeOpen(false); }} />}
      {galleryOpen && <PromptGalleryModal visionModelId={selectedVisionModel?.id || ''} onClose={() => setGalleryOpen(false)} onUsePrompt={useGalleryPrompt} onUseStyle={useGalleryStyle} />}
      {modelLogsOpen && <ModelLogsModal projectId={projectId} onClose={() => setModelLogsOpen(false)} />}

      {textEditorOpen && textImage && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !textEditSubmitting && !generating && setTextEditorOpen(false)}>
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
      </div>}

      {contextMenu && <div className="image-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
        <button onClick={() => void saveContextImageToGallery()}><Icon name="gallery" size={14} /> {savingToGallery ? t('ws.distilling') : t('ws.saveToGallery')}</button>
      </div>}
    </main>
  );
}

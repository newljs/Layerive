import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, readFileAsDataUrl, thumbUrl } from './api';
import { Icon } from './Icon';
import { PromptGalleryModal } from './PromptGalleryModal';
import { sizesForProvider, defaultSizeForProvider, isValidSizeForProvider, OUTPUT_FORMATS, type OutputFormat } from './sizes';
import type { GalleryEntry } from './gallery';
import type { ModelConfig, ProjectBundle, ProjectImage, TextSegment, Version } from './types';

type Props = {
  projectId: string;
  models: ModelConfig[];
  activeModel: string;
  onBack: () => void;
  onModels: () => void;
  onProjectChanged: () => void;
  notify: (message: string, kind?: 'success' | 'error') => void;
};
type TaskKind = 'generate' | 'text-edit' | 'local-edit' | 'outpaint';

const operationLabels: Record<string, string> = { auto: '自动识别', upload: '上传原图', text_to_image: '文生图', image_to_image: '图生图', edit_prompt: '提示词改图', edit_text: '文字编辑', local_edit: '局部修改', outpaint: '扩图' };
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function VersionItem({ version, active, onSelect, onEdit, onDelete }: { version: Version; active: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
  return (
    <div className={`version-item-wrap ${active ? 'active' : ''}`}>
      <button className={`version-item ${active ? 'active' : ''}`} onClick={onSelect}>
        <div className="version-thumb">{image ? <img src={thumbUrl(image)} alt="" loading="lazy" /> : <span>V{version.number}</span>}</div>
        <div className="version-copy"><strong>V{version.number}</strong><span>{operationLabels[version.operation] || version.operation}</span><small>{formatTime(version.createdAt)}</small></div>
        {version.parentVersionId && <span className="branch-mark" title="包含父版本关系"><Icon name="branch" size={12} /></span>}
      </button>
      <div className="version-item-actions">
        {image && <button className="version-edit" title={`用 V${version.number} 这张图继续改图`} onClick={(event) => { event.stopPropagation(); onEdit(); }}>改图</button>}
        <button className="version-delete" title="删除此版本" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Icon name="close" size={13} /></button>
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
          <div><p className="eyebrow">VERSION GRAPH</p><h2 id="tree-title">完整版本树</h2></div>
          <div className="tree-controls">
            <button className="icon-button" onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.2) * 10) / 10))} aria-label="缩小"><Icon name="minus" size={15} /></button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="icon-button" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))} aria-label="放大"><Icon name="plus" size={15} /></button>
            <button className="icon-button" onClick={onClose}><Icon name="close" size={16} /></button>
          </div>
        </div>
        <p className="tree-help">按住空白处拖动平移；点击节点在画布中查看该版本。连线表示从父版本继续创作。</p>
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
                    <small>{operationLabels[version.operation] || version.operation}</small>
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

export function WorkspaceView({ projectId, models, activeModel, onBack, onModels, onProjectChanged, notify }: Props) {
  const imageModels = models.filter((model) => model.type !== 'vision');
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [operation, setOperation] = useState('auto');
  const [modelId, setModelId] = useState(activeModel);
  const [size, setSize] = useState(defaultSizeForProvider(imageModels.find((model) => model.id === activeModel)?.provider));
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png');
  const [transparentBg, setTransparentBg] = useState(false);
  const [count, setCount] = useState(1);
  const [currentImageId, setCurrentImageId] = useState<string | null>(null);
  const [inputImageId, setInputImageId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<{ id: string; kind: TaskKind } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareMode, setCompareMode] = useState<'side' | 'slider'>('side');
  const [compareImageId, setCompareImageId] = useState<string | null>(null);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [versionTreeOpen, setVersionTreeOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
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
  const [localEditInstruction, setLocalEditInstruction] = useState('');
  const [localEditSubmitting, setLocalEditSubmitting] = useState(false);
  const [outpaintMode, setOutpaintMode] = useState(false);
  const [outpaintSize, setOutpaintSize] = useState('');
  const [outpaintSubmitting, setOutpaintSubmitting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const pollTimer = useRef<number | null>(null);
  const boxStart = useRef<{ x: number; y: number } | null>(null);
  const localBoxStart = useRef<{ x: number; y: number } | null>(null);

  const generating = activeTask !== null;
  const imageMap = useMemo(() => new Map((bundle?.images || []).map((image) => [image.id, image])), [bundle?.images]);
  const currentImage = currentImageId ? imageMap.get(currentImageId) || null : null;
  const inputImage = inputImageId ? imageMap.get(inputImageId) || null : null;
  const currentVersion = bundle?.versions.find((version) => version.outputs.some((image) => image.id === currentImageId));
  const selectedModel = imageModels.find((model) => model.id === modelId);
  const compareImage = compareImageId ? imageMap.get(compareImageId) || null : null;
  const textImage = textImageId ? imageMap.get(textImageId) || null : null;
  const versionsByNumber = [...(bundle?.versions || [])].sort((left, right) => left.number - right.number);
  const versionById = new Map((bundle?.versions || []).map((version) => [version.id, version]));
  const inputVersion = inputImage?.versionId ? versionById.get(inputImage.versionId) : null;
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

  const startPolling = useCallback((taskId: string, kind: TaskKind) => {
    stopPolling();
    setActiveTask({ id: taskId, kind });
    pollTimer.current = window.setInterval(async () => {
      try {
        const task = await api.getTask(projectId, taskId);
        if (task.status === 'generating') return;
        stopPolling();
        setActiveTask(null);
        const data = await api.getProject(projectId);
        setBundle(data);
        if (task.status === 'success') {
          setCurrentImageId(data.project.currentImageId);
          setInputImageId(data.project.currentImageId);
          if (kind === 'generate') {
            setPrompt('');
            notify(`已创建版本 V${data.versions[0]?.number}`, 'success');
          } else if (kind === 'text-edit') {
            setTextEditorOpen(false);
            notify(`文字已修改并保存为 V${data.versions[0]?.number}`, 'success');
          } else if (kind === 'local-edit') {
            notify(`局部修改已保存为 V${data.versions[0]?.number}`, 'success');
          } else {
            notify(`扩图已保存为 V${data.versions[0]?.number}`, 'success');
          }
        } else if (task.status === 'canceled') {
          notify('已取消本次生成，输入已保留。', 'error');
        } else {
          notify(task.error || '生成失败，请重试。', 'error');
        }
        onProjectChanged();
      } catch { /* transient network error: keep polling */ }
    }, 1500);
  }, [projectId, notify, onProjectChanged, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getProject(projectId), api.listGeneratingTasks(projectId)]).then(([data, taskData]) => {
      setBundle(data);
      const draft = data.project.draft || {};
      setPrompt(String(draft.prompt || ''));
      setStylePrompt(String(draft.stylePrompt || ''));
      setOperation(String(draft.operation || 'auto'));
      setModelId(String(draft.modelId || data.project.defaultModelId || activeModel));
      setSize(String(draft.size || defaultSizeForProvider(imageModels.find((model) => model.id === String(draft.modelId || data.project.defaultModelId || activeModel))?.provider)));
      setOutputFormat((draft.outputFormat as OutputFormat) || 'png');
      setTransparentBg(Boolean(draft.transparentBg));
      setCount(Number(draft.count || 1));
      setCurrentImageId(data.project.currentImageId || data.versions[0]?.selectedImageId || data.images.at(-1)?.id || null);
      setInputImageId(String(draft.inputImageId || '') || null);
      initialized.current = true;
      const task = taskData.tasks[0];
      if (task) startPolling(task.id, task.operationType === 'edit_text' ? 'text-edit' : task.operationType === 'local_edit' ? 'local-edit' : task.operationType === 'outpaint' ? 'outpaint' : 'generate');
    }).catch((error) => notify(error.message, 'error')).finally(() => setLoading(false));
  }, [projectId, activeModel, startPolling, notify]);

  useEffect(() => {
    if (!initialized.current || !bundle) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      api.updateProject(projectId, { draft: { prompt, stylePrompt, operation, modelId, size, outputFormat, transparentBg, count, inputImageId }, currentImageId, defaultModelId: modelId })
        .then((data) => { setBundle((current) => current ? { ...current, project: data.project } : data); setSaveState('saved'); })
        .catch(() => setSaveState('failed'));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [prompt, stylePrompt, operation, modelId, size, outputFormat, transparentBg, count, inputImageId, currentImageId]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [bundle?.messages.length, generating]);

  const provider = selectedModel?.provider;
  // Switching providers invalidates the current size — snap back to a size the
  // new provider actually supports instead of letting the API reject it.
  useEffect(() => {
    if (!provider) return;
    setSize((current) => (isValidSizeForProvider(provider, current) ? current : defaultSizeForProvider(provider)));
  }, [provider]);
  // Transparent background only works with png/webp output.
  useEffect(() => {
    if (outputFormat === 'jpeg') setTransparentBg(false);
  }, [outputFormat]);

  function chooseVersion(version: Version) {
    const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
    if (image) setCurrentImageId(image.id);
  }

  // Start an edit straight from a history entry: its image becomes the next
  // request's input, so the user only has to describe the desired change.
  function editVersion(version: Version) {
    const image = version.outputs.find((item) => item.id === version.selectedImageId) || version.outputs[0];
    if (!image) return;
    setCurrentImageId(image.id);
    setInputImageId(image.id);
    if (operation === 'text_to_image') setOperation('auto');
  }

  function openCompare() {
    if (!currentImage || !bundle) return;
    const target = parentImage || bundle.images.find((image) => image.id !== currentImage.id);
    if (!target) return notify('至少需要两张已保存的图片才能对比。', 'error');
    setCompareImageId(target.id);
    setSliderPosition(50);
    setCompareOpen(true);
  }

  function useImage(image: ProjectImage) {
    setCurrentImageId(image.id);
    setInputImageId(image.id);
  }

  // Drop a gallery prompt into the composer, or lift its distilled style into
  // the project-level style slot — both close the gallery so the user lands
  // back in the workspace with the text ready to edit or send.
  function useGalleryPrompt(entry: GalleryEntry) {
    setPrompt((current) => (current.trim() ? `${current.trim()}\n${entry.prompt}` : entry.prompt));
    setGalleryOpen(false);
    notify('已把完整提示词填入对话输入框', 'success');
  }

  function useGalleryStyle(entry: GalleryEntry) {
    setStylePrompt(entry.stylePrompt);
    setGalleryOpen(false);
    notify('已设为项目风格提示词，文生图时自动生效', 'success');
  }

  async function openTextEditor() {
    if (!currentImage) return;
    setTextImageId(currentImage.id);
    setTextSegments([]);
    setRecognitionModel('');
    setTextEditorError('');
    setBoxMode(false);
    setDraftRect(null);
    setRecognizingText(true);
    setTextEditorOpen(true);
    try {
      const data = await api.recognizeText(projectId, currentImage.id);
      setTextSegments(data.segments);
      setRecognitionModel(data.modelName);
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

  function localPointerRatio(event: React.MouseEvent<HTMLDivElement>) {
    const image = event.currentTarget.parentElement?.querySelector('img');
    const bounds = image?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  }

  function onLocalBoxStart(event: React.MouseEvent<HTMLDivElement>) {
    if (!localEditMode || event.button !== 0) return;
    const point = localPointerRatio(event);
    localBoxStart.current = point;
    setLocalEditRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function onLocalBoxMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!localEditMode || !localBoxStart.current) return;
    const point = localPointerRatio(event);
    setLocalEditRect({
      x: Math.min(point.x, localBoxStart.current.x),
      y: Math.min(point.y, localBoxStart.current.y),
      width: Math.abs(point.x - localBoxStart.current.x),
      height: Math.abs(point.y - localBoxStart.current.y),
    });
  }

  function onLocalBoxEnd() {
    if (!localEditMode || !localEditRect) return;
    localBoxStart.current = null;
    if (localEditRect.width <= 2 || localEditRect.height <= 2) setLocalEditRect(null);
  }

  function startLocalEdit() {
    if (!currentImage || generating) return;
    closeOutpaint();
    setLocalEditMode(true);
    setLocalEditRect(null);
    setLocalEditInstruction('');
  }

  function closeLocalEdit() {
    localBoxStart.current = null;
    setLocalEditMode(false);
    setLocalEditRect(null);
    setLocalEditInstruction('');
  }

  async function submitLocalEdit() {
    if (!currentImage || !localEditRect || !localEditInstruction.trim() || localEditSubmitting || generating) return;
    setLocalEditSubmitting(true);
    try {
      const result = await api.localEdit(projectId, {
        imageId: currentImage.id,
        modelId,
        parentVersionId: currentVersion?.id || null,
        instruction: localEditInstruction.trim(),
        rect: localEditRect,
        params: { size, count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: transparentBg },
      });
      closeLocalEdit();
      startPolling(result.taskId, 'local-edit');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setLocalEditSubmitting(false); }
  }

  function startOutpaint() {
    if (!currentImage || generating) return;
    closeLocalEdit();
    const availableSizes = sizesForProvider(provider);
    const sourceRatio = (currentImage.width || 1) / (currentImage.height || 1);
    const preferred = availableSizes.find((option) => Math.abs(Number(option.value.split('x')[0]) / Number(option.value.split('x')[1]) - sourceRatio) > 0.08) || availableSizes[0];
    setOutpaintSize(preferred?.value || defaultSizeForProvider(provider));
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

  async function submitTextEdit() {
    if (!textImage || textEditSubmitting || generating) return;
    const changed = textSegments.some((segment) => segment.text.trim() && segment.text.trim() !== segment.originalText.trim());
    if (!changed) return notify('请先修改至少一段文字，或框选并填写要添加的文字', 'error');
    setTextEditSubmitting(true);
    try {
      const sourceVersion = bundle?.versions.find((version) => version.outputs.some((image) => image.id === textImage.id));
      const result = await api.editText(projectId, { imageId: textImage.id, modelId, parentVersionId: sourceVersion?.id || null, segments: textSegments });
      setTextEditorError('');
      startPolling(result.taskId, 'text-edit');
    } catch (error) { notify((error as Error).message, 'error'); }
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
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return notify('仅支持 PNG、JPG 和 WebP 图片', 'error');
    if (file.size > 10 * 1024 * 1024) return notify('图片不能超过 10MB', 'error');
    setUploading(true);
    try {
      const data = await api.uploadImage(projectId, { data: await readFileAsDataUrl(file), mimeType: file.type, name: file.name });
      setBundle(data);
      const image = data.images.at(-1);
      if (image) { setCurrentImageId(image.id); setInputImageId(image.id); }
      notify('图片已保存到项目素材', 'success');
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function send() {
    if ((!prompt.trim() && !inputImageId) || generating) return;
    try {
      const result = await api.generate(projectId, {
        prompt: prompt.trim(), operation, modelId, inputImageId, parentVersionId: inputVersion?.id || null,
        params: { size, count, quality: selectedModel?.defaultParams.quality || 'auto', outputFormat, transparent: transparentBg },
      });
      startPolling(result.taskId, 'generate');
    } catch (error) {
      notify((error as Error).message, 'error');
      try { setBundle(await api.getProject(projectId)); } catch { /* keep current view */ }
    }
  }

  async function cancelActiveTask() {
    if (!activeTask) return;
    try { await api.cancelTask(projectId, activeTask.id); notify('正在取消…', 'success'); }
    catch (error) { notify((error as Error).message, 'error'); }
  }

  async function removeVersion(version: Version) {
    if (!bundle) return;
    const childCount = bundle.versions.filter((item) => item.parentVersionId === version.id).length;
    const baseMessage = `确定删除版本 V${version.number} 吗？版本记录将被移入回收状态，图片文件仍保留在磁盘。`;
    const childMessage = childCount ? `该版本被 ${childCount} 个后续版本引用，删除后它们将直接衔接其父版本。` : '';
    if (!window.confirm(`${baseMessage}\n${childMessage}`)) return;
    try {
      const data = await api.deleteVersion(projectId, version.id, childCount > 0);
      setBundle(data);
      if (currentVersion?.id === version.id) setCurrentImageId(data.project.currentImageId || null);
      notify(`已删除版本 V${version.number}`);
      onProjectChanged();
    } catch (error) {
      const message = (error as Error).message;
      if (window.confirm(`${message}\n\n仍要删除并让后续版本衔接其父版本吗？`)) {
        try {
          const data = await api.deleteVersion(projectId, version.id, true);
          setBundle(data);
          if (currentVersion?.id === version.id) setCurrentImageId(data.project.currentImageId || null);
          notify(`已删除版本 V${version.number}`);
          onProjectChanged();
        } catch (retryError) { notify((retryError as Error).message, 'error'); }
      }
    }
  }

  if (loading || !bundle) return <main className="workspace-loading">正在恢复项目工作台…</main>;

  const beforeImage = compareMode === 'slider' ? (compareImage || parentImage) : null;
  const outpaintAspectRatio = outpaintSize ? outpaintSize.replace('x', ' / ') : undefined;

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-title-group">
          <button className="back-button compact" onClick={onBack}>← 项目列表</button>
          <span className="header-divider" />
          <input className="project-name-input" defaultValue={bundle.project.name} onBlur={(event) => void rename(event.target.value)} aria-label="项目名称" />
        </div>
        <div className={`autosave-state ${saveState}`}><span />{saveState === 'saving' ? '保存中…' : saveState === 'failed' ? '保存失败' : '已自动保存'}</div>
        <div className="workspace-header-actions">
          <select value={modelId} onChange={(event) => setModelId(event.target.value)} aria-label="当前模型">{imageModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
          <button className="icon-button" title="模型配置" onClick={onModels}><Icon name="settings" size={17} /></button>
        </div>
      </header>

      <section className="workspace-body">
        <aside className="versions-panel">
          <div className="workspace-panel-title"><div><p className="eyebrow">VERSIONS</p><h2>历史版本</h2></div><span>{bundle.versions.length}</span></div>
          <div className="version-list">
            {bundle.versions.map((version) => <VersionItem key={version.id} version={version} active={version.id === currentVersion?.id} onSelect={() => chooseVersion(version)} onEdit={() => editVersion(version)} onDelete={() => void removeVersion(version)} />)}
            {!bundle.versions.length && <div className="small-empty"><span><Icon name="image" size={22} /></span><p>生成第一张图片后，版本会出现在这里。</p></div>}
          </div>
          <button className="version-tree-button" disabled={!bundle.versions.length} onClick={() => setVersionTreeOpen(true)}><Icon name="tree" size={15} /> 查看版本关系</button>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div className="canvas-context">{currentVersion ? <><strong>V{currentVersion.number}</strong><span>{operationLabels[currentVersion.operation]}</span></> : <span>项目画布</span>}</div>
            <div className="canvas-actions"><button disabled={!currentImage} onClick={() => changeZoom(-0.25)} aria-label="缩小"><Icon name="minus" size={14} /></button><button className="zoom-label" disabled={!currentImage} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button disabled={!currentImage} onClick={() => changeZoom(0.25)} aria-label="放大"><Icon name="plus" size={14} /></button><button className={`local-edit-launch ${localEditMode ? 'active' : ''}`} disabled={!currentImage || generating} title={localEditMode || localEditRect ? '退出局部修改' : '框选图片区域并局部修改'} onClick={localEditMode || localEditRect ? closeLocalEdit : startLocalEdit}>{localEditMode || localEditRect ? <><Icon name="close" size={14} /> 退出局部</> : <><Icon name="box" size={14} /> 局部修改</>}</button><button className={`outpaint-launch ${outpaintMode ? 'active' : ''}`} disabled={!currentImage || generating} title={outpaintMode ? '退出扩图' : '扩展当前图片画布'} onClick={outpaintMode ? closeOutpaint : startOutpaint}>{outpaintMode ? <><Icon name="close" size={14} /> 退出扩图</> : <><Icon name="image" size={14} /> 扩图</>}</button><button disabled={!currentImage || generating} onClick={() => void openTextEditor()}>编辑文字</button><button disabled={!currentImage} onClick={openCompare}>对比</button><a className={!currentImage ? 'disabled' : ''} href={currentImage?.url} download>下载</a></div>
          </div>
          <div className="canvas-stage">
            {currentImage ? <div className={`canvas-image-wrap ${zoom !== 1 ? 'is-zoomed' : ''} ${localEditMode ? 'local-editing' : ''} ${outpaintMode ? 'outpaint-preview-wrap' : ''}`} style={zoom !== 1 ? { width: `${zoom * 100}%` } : undefined}>{outpaintMode ? <div className="outpaint-preview" style={outpaintAspectRatio ? { aspectRatio: outpaintAspectRatio } : undefined}><img src={currentImage.url} alt={`扩图预览${currentVersion ? `版本 V${currentVersion.number}` : ''}`} /><span>新增画布区域</span></div> : <img src={currentImage.url} alt={`项目图片${currentVersion ? `版本 V${currentVersion.number}` : ''}`} />}{(localEditMode || localEditRect) && <div className={`local-edit-surface ${localEditMode ? 'active' : ''}`} onMouseDown={onLocalBoxStart} onMouseMove={onLocalBoxMove} onMouseUp={onLocalBoxEnd} onMouseLeave={onLocalBoxEnd}>{localEditRect && <span className="local-edit-rect" style={{ left: `${localEditRect.x}%`, top: `${localEditRect.y}%`, width: `${localEditRect.width}%`, height: `${localEditRect.height}%` }}><em>修改区域</em></span>}</div>}<span className="image-chip">{outpaintMode ? `目标 ${outpaintSize}` : `${currentImage.width || '—'} × ${currentImage.height || '—'}`}</span></div> : (
              <div className="canvas-empty"><div className="empty-visual"><span /><span /><span /></div><h2>开始你的第一张作品</h2><p>在右侧输入创作描述，或者上传一张图片进行修改。</p><button className="button secondary" onClick={() => fileRef.current?.click()}>上传初始图片</button></div>
            )}
            {(localEditMode || localEditRect) && currentImage && <section className="local-edit-panel"><div className="local-edit-panel-head"><div><strong>局部修改</strong><span>{localEditRect ? '描述改动，系统将只修改框选区域' : '在图片上拖拽框选需要修改的位置'}</span></div><button className="local-edit-exit" onClick={closeLocalEdit}><Icon name="close" size={13} /> 退出</button></div>{localEditRect && <><textarea value={localEditInstruction} onChange={(event) => setLocalEditInstruction(event.target.value)} placeholder="例如：将桌上的咖啡杯替换成透明玻璃花瓶，保留光影和画面风格" rows={2} /><div className="local-edit-panel-actions"><button className="button secondary" onClick={() => setLocalEditRect(null)}>重新框选</button><button className="button primary" disabled={!localEditInstruction.trim() || localEditSubmitting || generating} onClick={() => void submitLocalEdit()}>{localEditSubmitting ? '正在组装提示词…' : '应用局部修改'}</button></div></>}</section>}
            {outpaintMode && currentImage && <section className="outpaint-panel"><div className="outpaint-panel-head"><div><strong>扩图</strong><span>选择当前模型支持的目标画布比例</span></div><button className="outpaint-exit" onClick={closeOutpaint}><Icon name="close" size={13} /> 退出</button></div><div className="outpaint-size-list">{sizesForProvider(provider).map((option) => <button key={option.value} className={option.value === outpaintSize ? 'active' : ''} onClick={() => setOutpaintSize(option.value)}><strong>{option.ratio}</strong><span>{option.value}</span></button>)}</div><p className="outpaint-summary">原图将居中保留，绿色虚线框内的新增区域会由模型自然延展补全。</p><div className="outpaint-panel-actions"><button className="button secondary" onClick={closeOutpaint}>取消</button><button className="button primary" disabled={!outpaintSize || outpaintSubmitting || generating} onClick={() => void submitOutpaint()}>{outpaintSubmitting ? '正在创建扩图任务…' : '确认扩图'}</button></div></section>}
          </div>
          {currentVersion && currentVersion.outputs.length > 1 && <div className="candidate-strip"><span>本轮候选</span>{currentVersion.outputs.map((image, index) => <button key={image.id} className={image.id === currentImageId ? 'active' : ''} onClick={() => setCurrentImageId(image.id)}><img src={thumbUrl(image)} alt={`候选结果 ${index + 1}`} loading="lazy" /></button>)}</div>}
        </section>

        <aside className="conversation-panel">
          <div className="conversation-title"><div><p className="eyebrow">CONVERSATION</p><h2>项目对话</h2></div><div className="conversation-title-actions"><button className="gallery-open-button" title="浏览提示词画廊，复用提示词或风格" onClick={() => setGalleryOpen(true)}><span className="gallery-open-icon"><Icon name="gallery" size={17} /><Icon name="sparkle" size={9} /></span><span className="gallery-open-copy"><strong>提示词画廊</strong><small>灵感 · 风格 · 模板</small></span></button><button className="icon-button" title="定位最新消息" onClick={() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })}><Icon name="down" size={16} /></button></div></div>
          <div className="message-list">
            {bundle.messages.map((message) => {
              if (message.role === 'system') return <div className="system-message" key={message.id}>{message.content.text}</div>;
              if (message.role === 'user') {
                const attached = message.content.inputImageId ? imageMap.get(message.content.inputImageId) : null;
                return <article className="message user-message" key={message.id}><div className="message-meta"><strong>你</strong><span>{formatTime(message.createdAt)}</span></div>{attached && <img className="message-attachment" src={thumbUrl(attached)} alt="输入图片" loading="lazy" />}<p>{message.content.prompt || '基于所选图片继续创作'}</p><div className="message-params"><span>{operationLabels[message.content.operation || 'auto']}</span><span>{message.content.modelName}</span></div></article>;
              }
              if (message.type === 'canceled') return <article className="message canceled-message" key={message.id}><div className="message-meta"><strong>已取消</strong><span>{formatTime(message.createdAt)}</span></div><p>{message.content.message}</p>{message.content.prompt && <button onClick={() => setPrompt(message.content.prompt || '')}>恢复提示词</button>}</article>;
              if (message.type === 'error') return <article className="message error-message" key={message.id}><div className="message-meta"><strong>生成失败</strong><span>{formatTime(message.createdAt)}</span></div><p>{message.content.message}</p><button onClick={() => setPrompt(message.content.prompt || '')}>恢复提示词</button></article>;
              const outputs = (message.content.outputImageIds || []).map((id) => imageMap.get(id)).filter(Boolean) as ProjectImage[];
              return <article className="message assistant-message" key={message.id}><div className="message-meta"><strong>Layerive</strong><span>V{message.content.versionNumber} · {formatTime(message.createdAt)}</span></div><p>已完成生成，得到 {outputs.length} 张候选图片。</p><div className={`message-gallery count-${outputs.length}`}>{outputs.map((image) => <button key={image.id} onClick={() => setCurrentImageId(image.id)}><img src={thumbUrl(image)} alt="生成结果" loading="lazy" /></button>)}</div><div className="message-actions"><button onClick={() => { const first = outputs[0]; if (first) { setCurrentImageId(first.id); setInputImageId(first.id); } }}>使用此轮继续</button><button onClick={() => setPrompt(message.content.prompt || '')}>复用提示词</button></div></article>;
            })}
            {generating && <article className="message generating-message"><div className="message-meta"><strong>Layerive</strong><span>正在生成</span></div><div className="generation-progress"><span /><span /><span /></div><p>{selectedModel?.name} 正在创作，完成后会自动保存为新版本。</p><button className="cancel-task-button" onClick={() => void cancelActiveTask()}>取消任务</button></article>}
            <div ref={messagesEnd} />
          </div>

          <div className="composer-wrap">
            <details className="style-prompt" open={Boolean(stylePrompt)}>
              <summary>项目风格提示词{stylePrompt ? <em>已设置</em> : <span>可选</span>}</summary>
              <textarea value={stylePrompt} onChange={(event) => setStylePrompt(event.target.value)} placeholder="例如：扁平插画风格，柔和马卡龙配色，粗描边，留白构图。仅用于文生图时统一风格，改图不会生效。" rows={2} />
            </details>
            {inputImage && <div className="input-context"><img src={thumbUrl(inputImage)} alt="本次输入" loading="lazy" /><div><strong>基于这张图片继续</strong><span>{inputVersion ? `正在修改 V${inputVersion.number}` : '项目上传素材'}</span></div><button onClick={() => setInputImageId(null)} aria-label="清除输入图片"><Icon name="close" size={13} /></button></div>}
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={inputImage ? '描述你希望如何修改这张图片…' : '描述你想生成的画面…'} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send(); }} />
            <div className="composer-tools">
              <div className="composer-left">
                <button className="attach-button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="上传图片">{uploading ? '…' : <Icon name="plus" size={16} />}</button>
                <select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="auto">自动识别</option><option value="text_to_image">文生图</option><option value="image_to_image">图生图</option><option value="edit_prompt">提示词改图</option></select>
                <select value={size} onChange={(event) => setSize(event.target.value)} title="生成尺寸（宽高比）">
                  {sizesForProvider(provider).map((option) => <option key={option.value} value={option.value}>{option.ratio} · {option.value}</option>)}
                  {!isValidSizeForProvider(provider, size) && <option value={size}>{size}</option>}
                </select>
                <select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value="1">1 张</option><option value="2">2 张</option><option value="3">3 张</option><option value="4">4 张</option></select>
                {provider === 'openai' && <>
                  <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)} title="输出格式">{OUTPUT_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}</select>
                  <button type="button" className={`bg-toggle ${transparentBg ? 'active' : ''}`} disabled={outputFormat === 'jpeg'} title={outputFormat === 'jpeg' ? 'JPEG 不支持透明背景' : '生成透明背景图片'} onClick={() => setTransparentBg((value) => !value)}>透明</button>
                </>}
              </div>
              <button className="send-button" disabled={generating || (!prompt.trim() && !inputImageId)} onClick={() => void send()} aria-label="发送生成请求"><Icon name="up" size={17} /></button>
            </div>
            <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
          </div>
        </aside>
      </section>

      {compareOpen && currentImage && compareImage && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCompareOpen(false)}>
        <section className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title">
          <div className="modal-heading">
            <div><p className="eyebrow">COMPARE</p><h2 id="compare-title">图片对比</h2></div>
            <div className="compare-mode-switch">
              <button className={compareMode === 'side' ? 'active' : ''} onClick={() => setCompareMode('side')}>并排</button>
              <button className={compareMode === 'slider' ? 'active' : ''} onClick={() => setCompareMode('slider')}>前后对比</button>
              <button className="icon-button" onClick={() => setCompareOpen(false)}><Icon name="close" size={16} /></button>
            </div>
          </div>
          {compareMode === 'side' ? (
            <div className="compare-grid">
              <article><div className="compare-image"><img src={currentImage.url} alt="当前画布" /></div><div className="compare-caption"><strong>当前画布</strong><button className="button secondary" onClick={() => { useImage(currentImage); setCompareOpen(false); }}>使用这张继续</button></div></article>
              <article><div className="compare-image"><img src={compareImage.url} alt="对比图片" /></div><div className="compare-caption"><strong>{compareImage.versionId ? '历史版本图片' : '项目素材'}</strong><button className="button primary" onClick={() => { useImage(compareImage); setCompareOpen(false); }}>使用这张继续</button></div></article>
            </div>
          ) : (
            <div className="compare-slider-block">
              <div className="compare-slider">
                <img src={compareImage.url} alt="对比图片" />
                <img src={currentImage.url} alt="当前画布" style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }} />
                <div className="slider-divider" style={{ left: `${sliderPosition}%` }} />
                <span className="slider-tag left">修改前</span>
                <span className="slider-tag right">修改后</span>
              </div>
              <input type="range" min={0} max={100} value={sliderPosition} onChange={(event) => setSliderPosition(Number(event.target.value))} aria-label="对比分隔位置" />
              <div className="compare-caption inline"><strong>{parentImage?.id === compareImage.id ? '修改前 · 父版本' : '对比图片'}</strong><button className="button primary" onClick={() => { useImage(compareImage); setCompareOpen(false); }}>使用前图继续</button></div>
            </div>
          )}
          <div className="compare-picker"><span>选择要对比的历史图片</span><div>{bundle.images.filter((image) => image.id !== currentImage.id).map((image) => <button key={image.id} className={image.id === compareImage.id ? 'active' : ''} onClick={() => { setCompareImageId(image.id); setSliderPosition(50); }}><img src={thumbUrl(image)} alt="选择对比图片" loading="lazy" /></button>)}</div></div>
        </section>
      </div>}

      {versionTreeOpen && <VersionTreeModal versions={bundle.versions} currentVersionId={currentVersion?.id || null} onClose={() => setVersionTreeOpen(false)} onSelect={(version) => { chooseVersion(version); setVersionTreeOpen(false); }} />}
      {galleryOpen && <PromptGalleryModal onClose={() => setGalleryOpen(false)} onUsePrompt={useGalleryPrompt} onUseStyle={useGalleryStyle} />}

      {textEditorOpen && textImage && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !textEditSubmitting && !generating && setTextEditorOpen(false)}>
        <section className="text-editor-modal" role="dialog" aria-modal="true" aria-labelledby="text-editor-title">
          <div className="modal-heading"><div><p className="eyebrow">TEXT EDIT</p><h2 id="text-editor-title">编辑图片文字</h2><small>{recognitionModel ? `由 ${recognitionModel} 识别` : '正在使用视觉识别模型分析图片'}</small></div><button className="icon-button" disabled={textEditSubmitting || generating} onClick={() => setTextEditorOpen(false)}><Icon name="close" size={16} /></button></div>
          <div className="text-editor-layout">
            <div className={`text-editor-preview ${boxMode ? 'box-mode' : ''}`} onMouseDown={onBoxStart} onMouseMove={onBoxMove} onMouseUp={onBoxEnd} onMouseLeave={onBoxEnd}>
              <img src={textImage.url} alt="待编辑文字的图片" draggable={false} />
              {textSegments.filter((segment) => segment.rect).map((segment) => <span key={segment.id} className="manual-rect" style={{ left: `${segment.rect!.x}%`, top: `${segment.rect!.y}%`, width: `${segment.rect!.width}%`, height: `${segment.rect!.height}%` }} />)}
              {draftRect && <span className="manual-rect drafting" style={{ left: `${draftRect.x}%`, top: `${draftRect.y}%`, width: `${draftRect.width}%`, height: `${draftRect.height}%` }} />}
              <span>{textImage.width || '—'} × {textImage.height || '—'}</span>
              <button className={`box-mode-toggle ${boxMode ? 'active' : ''}`} onClick={() => { setBoxMode((mode) => !mode); setDraftRect(null); }}>{boxMode ? '完成框选' : <><Icon name="box" size={13} /> 手动框选</>}</button>
            </div>
            <div className="text-segment-list">
              {recognizingText && <div className="text-editor-status"><span className="spinner" />正在识别图片中的文字与排版区域…</div>}
              {textEditorError && <div className="text-editor-status error"><strong>识别失败</strong><p>{textEditorError}</p><button className="button secondary" onClick={() => void openTextEditor()}>重新识别</button></div>}
              {!recognizingText && !textEditorError && <>
                <p className="text-editor-tip">修改需要替换的文字；开启「手动框选」可在图上拖拽圈出区域并填写要添加或替换的文字。提交后只会调整改动的文字，并尽量保留原有位置、样式与其他画面内容。</p>
                {textSegments.map((segment, index) => <div className="text-segment-field" key={segment.id}>
                  <span>{segment.manual ? '框选区域' : `文字 ${index + 1}`} · {segment.context || '图片文字区域'}</span>
                  {(segment.manual || segment.originalText) && <input className="segment-original" value={segment.originalText} placeholder={segment.manual ? '原文字（可留空表示新增）' : ''} onChange={(event) => updateTextSegment(segment.id, { originalText: event.target.value })} />}
                  <input value={segment.text} placeholder={segment.manual ? '新文字' : ''} onChange={(event) => updateTextSegment(segment.id, { text: event.target.value })} />
                  <small>{segment.manual ? '手动框选的区域' : `原文：${segment.originalText}`}</small>
                  {segment.manual && <button className="segment-remove" onClick={() => removeTextSegment(segment.id)}>移除</button>}
                </div>)}
              </>}
            </div>
          </div>
          <div className="modal-actions text-editor-actions"><button className="button secondary" disabled={textEditSubmitting || generating} onClick={() => setTextEditorOpen(false)}>取消</button><button className="button primary" disabled={recognizingText || Boolean(textEditorError) || textEditSubmitting || generating || !textSegments.some((segment) => segment.text.trim() && segment.text.trim() !== segment.originalText.trim())} onClick={() => void submitTextEdit()}>{generating ? '正在排队生成…' : textEditSubmitting ? '正在提交…' : '提交并改图'}</button></div>
        </section>
      </div>}
    </main>
  );
}

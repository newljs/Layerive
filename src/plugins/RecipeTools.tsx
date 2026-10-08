import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { api } from '../api';
import { useLanguage } from '../i18n';
import type { GenerateResult, ImagePluginManifest, ModelConfig, ProjectBundle, ProjectImage } from '../types';
import type { TaskKind } from './types';
import { useRecipeCatalog } from './RecipeCatalog';
import { RecipeDialog } from './RecipeDialog';

export function RecipeTools({ projectId, source, images, model, visionModelId, params, busy, taskId, stage, onCancel, onOpen, onStarted, onUploaded }: {
  projectId: string; source: ProjectImage | undefined; images: ProjectImage[]; model?: ModelConfig; visionModelId: string;
  params: Record<string, unknown>; busy: boolean; taskId?: string | null; stage?: string | null;
  onCancel: () => void; onOpen: () => void; onStarted: (result: GenerateResult, kind: TaskKind) => void; onUploaded: (bundle: ProjectBundle) => void;
}) {
  const { plugins, error, loading, reload } = useRecipeCatalog();
  const { language, t } = useLanguage();
  const [selected, setSelected] = useState<ImagePluginManifest | null>(null);
  useEffect(() => setSelected(null), [source?.id, projectId]);
  return <>
    {plugins.map(plugin => {
      const capable = model?.capabilities.includes('edit_prompt') && (!plugin.requirements.vision || visionModelId);
      return <button key={plugin.id} disabled={!source || busy || !capable} title={capable ? plugin.ui!.description[language] : t('plugin.modelRequired')} onClick={() => { onOpen(); setSelected(plugin); }}><Icon name={plugin.ui!.icon} size={17} /> {plugin.ui!.name[language]}</button>;
    })}
    {loading && <span className="recipe-catalog-status">{t('plugin.loading')}</span>}
    {error && <button title={error} onClick={reload}>{t('plugin.reload')}</button>}
    {selected && source && createPortal(<RecipeDialog key={selected.id + source.id} plugin={selected} projectId={projectId} source={source} images={images} disabled={busy} taskId={taskId} stage={stage} onCancel={onCancel} onClose={() => setSelected(null)} onUploaded={onUploaded} onSubmit={async fields => {
      const result = await api.runImagePlugin(projectId, selected.id, { imageId: source.id, modelId: model?.id, visionModelId, fields, params });
      onStarted(result, `plugin:${selected.id}`);
    }} />, document.body)}
  </>;
}

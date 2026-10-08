import type { TranslationKey } from '../i18n';
import type { IconName } from '../Icon';
import type { ImagePluginManifest } from '../types';
import { imagePluginForOperation as manifest } from './catalog';
import { ExtractAssetPanel } from './ExtractAssetPanel';
import { FusionPanel } from './FusionPanel';
import { LocalEditPanel } from './LocalEditPanel';
import { RemoveElementPanel } from './RemoveElementPanel';
import { OutpaintPanel } from './OutpaintPanel';
import { TextEditorPanel } from './TextEditorPanel';
import type { TaskKind } from './types';

export type PluginTool = {
  className: string;
  icon: IconName;
  label: TranslationKey;
  exitLabel?: TranslationKey;
  title?: TranslationKey;
  exitTitle?: TranslationKey;
};

export const workspacePlugins = {
  local_edit: {
    ...manifest('local_edit'), Panel: LocalEditPanel, taskKind: 'local-edit',
    tool: { className: 'local-edit-launch', icon: 'box', label: 'ws.localEdit', exitLabel: 'ws.exitLocalEdit', title: 'ws.localEditTitle', exitTitle: 'ws.exitLocalEditTitle' },
  },
  remove_element: {
    ...manifest('remove_element'), Panel: RemoveElementPanel, taskKind: 'remove-element',
    tool: { className: 'remove-element-launch', icon: 'trash', label: 'ws.removeElement', exitLabel: 'ws.exitRemoveElement', title: 'ws.removeElementTitle', exitTitle: 'ws.exitRemoveElementTitle' },
  },
  extract_asset: {
    ...manifest('extract_asset'), Panel: ExtractAssetPanel, taskKind: 'extract-asset',
    tool: { className: 'extract-launch', icon: 'extract', label: 'ws.extract', exitLabel: 'ws.exitExtract', title: 'ws.extractTitle', exitTitle: 'ws.exitExtractTitle' },
  },
  fusion: {
    ...manifest('fusion'), Panel: FusionPanel, taskKind: 'fusion',
    tool: { className: 'fusion-launch', icon: 'image', label: 'op.fusion', exitLabel: 'fusion.exit', title: 'fusion.hint', exitTitle: 'fusion.exitHint' },
  },
  outpaint: {
    ...manifest('outpaint'), Panel: OutpaintPanel, taskKind: 'outpaint',
    tool: { className: 'outpaint-launch', icon: 'image', label: 'ws.outpaint', exitLabel: 'ws.exitOutpaint', title: 'ws.outpaintTitle', exitTitle: 'ws.exitOutpaintTitle' },
  },
  enhance: {
    ...manifest('enhance'), Panel: null, taskKind: 'enhance',
    tool: { className: 'enhance-launch', icon: 'sparkle', label: 'ws.enhance', title: 'ws.enhanceTitle' },
  },
  remove_background: {
    ...manifest('remove_background'), Panel: null, taskKind: 'remove-background',
    tool: { className: 'background-remove-launch', icon: 'background', label: 'ws.removeBackground', title: 'ws.removeBackgroundTitle' },
  },
  remove_watermark: {
    ...manifest('remove_watermark'), Panel: null, taskKind: 'remove-watermark',
    tool: { className: 'watermark-remove-launch', icon: 'sparkle', label: 'ws.removeWatermark', title: 'ws.watermarkTitle' },
  },
  edit_text: {
    ...manifest('edit_text'), Panel: TextEditorPanel, taskKind: 'text-edit',
    tool: { className: 'text-edit-launch', icon: 'edit', label: 'ws.editText' },
  },
} satisfies Record<string, ImagePluginManifest & { Panel: unknown; taskKind: TaskKind; tool: PluginTool }>;

const legacyKinds: Record<string, TaskKind> = {
  batch_edit: 'batch-edit', batch_generate: 'batch-edit',
};

export function taskKindForOperation(operation?: string): TaskKind {
  return Object.values(workspacePlugins).find(plugin => plugin.operation === operation)?.taskKind
    || legacyKinds[operation || ''] || 'generate';
}

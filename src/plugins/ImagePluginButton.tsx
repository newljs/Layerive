import { Icon } from '../Icon';
import { useLanguage, type TranslationKey } from '../i18n';
import type { PluginTool } from './registry';

export function ImagePluginButton({ tool, active = false, exiting = active, disabled, onClick, busyLabel }: {
  tool: PluginTool;
  active?: boolean;
  exiting?: boolean;
  disabled: boolean;
  onClick: () => void;
  busyLabel?: TranslationKey;
}) {
  const { t } = useLanguage();
  const title = exiting ? tool.exitTitle : tool.title;
  return <button className={tool.className + (active ? ' active' : '')} disabled={disabled}
    title={title ? t(title) : undefined} onClick={onClick}>
    {busyLabel ? t(busyLabel) : <><Icon name={exiting ? 'close' : tool.icon} size={17} /> {t(exiting ? tool.exitLabel || tool.label : tool.label)}</>}
  </button>;
}

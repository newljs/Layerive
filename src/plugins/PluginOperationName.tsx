import { useLanguage } from '../i18n';
import { useRecipeCatalog } from './RecipeCatalog';
export function PluginOperationName({ operation, fallback }: { operation?: string; fallback?: string }) {
  const { language } = useLanguage();
  const { plugins } = useRecipeCatalog();
  return <>{plugins.find(plugin => plugin.operation === operation)?.ui?.name[language] || fallback || operation}</>;
}

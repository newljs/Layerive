import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { ImagePluginManifest } from '../types';

const CatalogContext = createContext<{ plugins: ImagePluginManifest[]; error: string; loading: boolean; reload: () => void }>({ plugins: [], error: '', loading: true, reload: () => {} });
export function RecipeCatalogProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<ImagePluginManifest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.imagePlugins().then(result => {
      if (!active) return;
      setPlugins(result.plugins.filter(plugin => plugin.kind === 'recipe' && plugin.ui));
      setError((result.errors || []).map(item => item.directory + ': ' + item.message).join('\n'));
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <CatalogContext.Provider value={{ plugins, error, loading, reload }}>{children}</CatalogContext.Provider>;
}
export const useRecipeCatalog = () => useContext(CatalogContext);

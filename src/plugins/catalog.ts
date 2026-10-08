import catalog from '../../server/plugins/catalog.json';
import type { ImagePluginManifest } from '../types';

export const imagePluginCatalog: readonly ImagePluginManifest[] = catalog;

export function imagePluginForOperation(operation: string): ImagePluginManifest {
  const entry = imagePluginCatalog.find(plugin => plugin.operation === operation);
  if (!entry) throw new Error('Missing built-in image plugin: ' + operation);
  return entry;
}

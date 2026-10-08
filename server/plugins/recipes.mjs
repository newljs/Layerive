import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecipePlugin } from './recipe.mjs';
import { createPluginRegistry } from './registry.mjs';

export function loadRecipes(directory = fileURLToPath(new URL('./recipes/', import.meta.url)), builtins = []) {
  const plugins = []; const errors = [];
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch (error) { return { plugins, errors: [{ directory: 'recipes', message: 'Cannot read recipe directory: ' + error.code }] }; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const file = path.join(directory, entry.name, 'plugin.json');
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64000) throw new Error('Expected a regular recipe manifest of at most 64 KB');
      const raw = readFileSync(file, 'utf8');
      const plugin = createRecipePlugin(JSON.parse(raw));
      createPluginRegistry([...builtins, ...plugins, plugin]);
      plugins.push(plugin);
    } catch (error) { errors.push({ directory: entry.name, message: error.message }); }
  }
  return { plugins, errors };
}

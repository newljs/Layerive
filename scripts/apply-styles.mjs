// Merge distilled style prompts into the gallery catalog. Reads a JSON map of
// { "<number>": "风格提示词" } from stdin file path arg and writes it back
// into src/gallery.raw.json. Usage: node scripts/apply-styles.mjs <map.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mapPath = process.argv[2];
if (!mapPath) { console.error('usage: node scripts/apply-styles.mjs <map.json>'); process.exit(1); }
const styles = JSON.parse(readFileSync(mapPath, 'utf8'));
const catalogPath = path.resolve(import.meta.dirname, '../src/gallery.raw.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
let applied = 0;
for (const entry of catalog.entries) {
  const style = styles[String(entry.number)];
  if (style) { entry.stylePrompt = style; applied += 1; }
}
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
const remaining = catalog.entries.filter((e) => !e.stylePrompt).length;
console.log(`Applied ${applied} style prompts. Remaining without style: ${remaining}`);

// One-off importer: parse the GPT-Image2-Skill reference gallery markdown
// files into a structured JSON catalog for the in-app prompt gallery.
// Each entry keeps its full original prompt plus the effect-image path; a
// distilled "style prompt" is filled in a later pass.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SKILL_ROOT = path.resolve(import.meta.dirname, '../../GPT-Image2-Skill');
const REF_DIR = path.join(SKILL_ROOT, 'skills/gpt-image/references');

// Category display metadata (Chinese name + emoji), keyed by docs folder.
const CATEGORY_META = {
  'anime-manga': { zh: '动漫与漫画', emoji: '🎌' },
  'gaming': { zh: '游戏', emoji: '🎮' },
  'retro-cyberpunk': { zh: '复古与赛博朋克', emoji: '🤖' },
  'cinematic-animation': { zh: '电影与动画', emoji: '🎬' },
  'character-design': { zh: '角色设计', emoji: '👤' },
  'typography-posters': { zh: '排版与海报', emoji: '📝' },
  'illustration': { zh: '插画', emoji: '🎨' },
  'watercolor': { zh: '水彩', emoji: '💧' },
  'ink-chinese': { zh: '墨与中国', emoji: '🖌️' },
  'pixel-art': { zh: '像素艺术', emoji: '🕹️' },
  'isometric': { zh: '等距视图', emoji: '📐' },
  'product-food': { zh: '产品与食品', emoji: '📦' },
  'brand-systems-identity': { zh: '品牌系统与识别', emoji: '🧩' },
  'photography': { zh: '摄影', emoji: '📷' },
  'screen-photography': { zh: '屏幕摄影', emoji: '🖥️' },
  'infographics-field-guides': { zh: '信息图表与指南', emoji: '📊' },
  'research-paper-figures': { zh: '研究论文图示', emoji: '📚' },
  'official-openai-cookbook': { zh: '官方 Cookbook', emoji: '🏢' },
  'edit-endpoint-showcase': { zh: '编辑端点展示', emoji: '✨' },
  'uiux-mockups': { zh: 'UI/UX 原型图', emoji: '📱' },
  'data-visualization': { zh: '数据可视化', emoji: '📊' },
  'technical-illustration': { zh: '技术插图', emoji: '⚙️' },
  'architecture-interior': { zh: '建筑与室内', emoji: '🏛️' },
  'scientific-educational': { zh: '科学与教育', emoji: '🔬' },
  'fashion-editorial': { zh: '时尚与编辑', emoji: '👗' },
  'fine-art-painting': { zh: '纯艺绘画', emoji: '🎨' },
  'more-illustration-styles': { zh: '更多插画风格', emoji: '✏️' },
  'cinematic-film-references': { zh: '电影风格参考', emoji: '🎥' },
  'beauty-lifestyle': { zh: '美妆与生活方式', emoji: '💄' },
  'events-experience': { zh: '活动与体验', emoji: '🎟️' },
  'tattoo-design': { zh: '纹身设计', emoji: '🖋️' },
};

function parseGallery(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const entries = [];
  // Split on entry headings: "### No. 12 · Some title"
  const blocks = text.split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const headMatch = block.match(/^No\.\s*(\d+)\s*·\s*(.+)$/m);
    if (!headMatch) continue;
    const number = Number(headMatch[1]);
    const title = headMatch[2].trim();
    const imageMatch = block.match(/- Image:\s*`([^`]+)`/);
    const metaMatch = block.match(/- Metadata:\s*(.+)$/m);
    const promptMatch = block.match(/```text\s*\n([\s\S]*?)```/);
    if (!imageMatch || !promptMatch) continue;
    const image = imageMatch[1].trim(); // docs/<category>/<file>.png
    const category = image.split('/')[1] || '';
    const meta = metaMatch ? metaMatch[1].trim() : '';
    const sizeMatch = meta.match(/`(\d{3,4}x\d{3,4})`/);
    const orientMatch = meta.match(/`(portrait|landscape|square)`/);
    entries.push({
      number,
      title,
      category,
      image,
      size: sizeMatch ? sizeMatch[1] : '',
      orientation: orientMatch ? orientMatch[1] : '',
      source: meta,
      prompt: promptMatch[1].trim(),
      stylePrompt: '', // filled by the distillation pass
    });
  }
  return entries;
}

const files = readdirSync(REF_DIR).filter((f) => /^gallery-.+\.md$/.test(f) && f !== 'gallery.md');
const all = [];
for (const file of files) all.push(...parseGallery(path.join(REF_DIR, file)));
all.sort((a, b) => a.number - b.number);

// Build category list in first-seen order, with counts.
const categories = [];
const seen = new Map();
for (const entry of all) {
  if (!seen.has(entry.category)) {
    const meta = CATEGORY_META[entry.category] || { zh: entry.category, emoji: '🖼️' };
    seen.set(entry.category, { id: entry.category, zh: meta.zh, emoji: meta.emoji, count: 0 });
    categories.push(seen.get(entry.category));
  }
  seen.get(entry.category).count += 1;
}

const out = { categories, entries: all };
const outPath = path.resolve(import.meta.dirname, '../src/gallery.raw.json');
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`Parsed ${all.length} entries across ${categories.length} categories -> ${outPath}`);
for (const c of categories) console.log(`  ${c.emoji} ${c.zh} (${c.id}): ${c.count}`);

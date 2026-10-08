import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createRecipePlugin } from './plugins/recipe.mjs';
import { createPluginRegistry, preparePlugin, processPluginOutput } from './plugins/registry.mjs';
import { loadRecipes } from './plugins/recipes.mjs';

const colorize = JSON.parse(await readFile(new URL('./plugins/recipes/colorize/plugin.json', import.meta.url), 'utf8'));
const fixture = await sharp({ create: { width: 120, height: 90, channels: 4, background: '#345678' } }).png().toBuffer();
function hostFixture() {
  const calls = [];
  const host = {
    projectId: 'project', signal: new AbortController().signal,
    httpError: (status, code, message) => Object.assign(new Error(message), { status, code }),
    readModels: () => ({ active_model: 'image', models: [{ id: 'image', capabilities: ['edit_prompt'] }] }),
    imageOptions: () => ({ formats: ['png', 'jpeg', 'webp'], transparent: true }),
    visionModelOrThrow: () => ({ id: 'vision' }),
    imageOrThrow: (_project, id) => { if (!['source', 'ref'].includes(id)) throw new Error('unknown image'); return { id, width: 120, height: 90 }; },
    generation: (request, state) => ({ request, state }),
    readImage: async () => fixture,
    callVision: async (...args) => { calls.push(args); return '{"applicable":true,"edit_prompt":"仅上色，保留主体"}'; },
    parseVisionJson: JSON.parse,
    updateTask: () => {},
  };
  return { host, calls };
}

test('a new JSON directory is discovered with no server or frontend registration changes; invalid neighbors are isolated', async () => {
  const root = path.resolve('work'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'recipe-test-'));
  const custom = structuredClone(colorize);
  custom.id = 'example.product-photo'; custom.operation = 'recipe_product_photo'; custom.route = 'recipe-product-photo';
  for (const [name, value] of [['custom', custom], ['broken', { id: 'bad' }], ['duplicate', custom]]) {
    await mkdir(path.join(directory, name));
    await writeFile(path.join(directory, name, 'plugin.json'), JSON.stringify(value));
  }
  const loaded = loadRecipes(directory);
  assert.equal(loaded.plugins.length, 1); assert.equal(loaded.errors.length, 2);
  const registry = createPluginRegistry(loaded.plugins);
  const publicPlugin = registry.list()[0];
  assert.equal(publicPlugin.ui.name.en, colorize.ui.name.en);
  assert.equal(publicPlugin.kind, 'recipe'); assert.equal(publicPlugin.workflow, undefined);
  publicPlugin.ui.name.en = 'tampered';
  assert.equal(registry.list()[0].ui.name.en, colorize.ui.name.en);
  const { host, calls } = hostFixture();
  const plugin = registry.get(custom.id);
  const created = plugin.create(host, { imageId: 'source', fields: { reference: 'ref', instruction: '蓝色外套' } });
  assert.equal(calls.length, 0, 'create must not call a model');
  const prepared = await preparePlugin(plugin, host, { id: 'source' }, created.state);
  assert.equal(calls[0][1].length, 2);
  assert.deepEqual(calls[0][1].map(image => image.id), ['source', 'ref']);
  assert.match(calls[0][2], /蓝色外套/);
  assert.deepEqual(prepared.inputs, [{ imageId: 'ref', role: 'plugin_reference' }]);
  const result = await processPluginOutput(plugin, host, prepared, { bytes: fixture, mimeType: 'image/png', promptIndex: 2 });
  assert.equal(result.promptIndex, 2); assert.equal(result.width, 120);
});

test('recipe schemas reject malformed fields, unsupported output rules and invalid defaults', () => {
  const mutations = [
    r => { r.ui.fields[0].default = 'unknown'; },
    r => { r.ui.fields.push(r.ui.fields[0]); },
    r => { r.ui.fields[0].key = '__proto__'; },
    r => { r.workflow.output.format = 'gif'; },
    r => { r.requirements.vision = false; },
    r => { r.timeoutMs = 999999; },
    r => { r.operation = 'generate'; },
    r => { r.route = 'images'; },
    r => { r.ui.fields[2].maxLength = 100000; },
    r => { r.ui.fields[0].label = { zh: '缺少英语' }; },
  ];
  for (const mutate of mutations) { const recipe = structuredClone(colorize); mutate(recipe); assert.throws(() => createRecipePlugin(recipe), /Invalid recipe/); }
});

test('a missing recipe directory does not prevent built-in operations from loading', () => {
  const loaded = loadRecipes(path.resolve('work', 'missing-recipes-' + crypto.randomUUID()));
  assert.deepEqual(loaded.plugins, []);
  assert.equal(loaded.errors.length, 1);
  assert.equal(loaded.errors[0].directory, 'recipes');
});

test('image-only recipes skip vision and validate output dimensions, format, transparency and corrupt bytes', async () => {
  const recipe = structuredClone(colorize);
  delete recipe.workflow.vision; recipe.requirements.vision = false;
  recipe.workflow.output.dimensions = 'source';
  const plugin = createRecipePlugin(recipe);
  const { host, calls } = hostFixture();
  const created = plugin.create(host, { imageId: 'source', fields: {} });
  const prepared = await preparePlugin(plugin, host, { id: 'source' }, created.state);
  assert.equal(calls.length, 0);
  const output = { bytes: fixture, mimeType: 'image/png' };
  await assert.rejects(processPluginOutput(plugin, host, { ...prepared, source: { width: 999, height: 99 } }, output), { code: 'plugin.invalidOutput' });
  await assert.rejects(processPluginOutput(plugin, host, prepared, { ...output, bytes: Buffer.from('bad') }), { code: 'plugin.invalidOutput' });
  recipe.workflow.output.transparent = true;
  await assert.rejects(processPluginOutput(createRecipePlugin(recipe), host, prepared, output), { code: 'plugin.invalidOutput' });
  recipe.workflow.output.transparent = false; recipe.workflow.output.format = 'jpeg';
  const converted = await processPluginOutput(createRecipePlugin(recipe), host, prepared, output);
  assert.equal(converted.mimeType, 'image/jpeg'); assert.equal((await sharp(converted.bytes).metadata()).format, 'jpeg');
  const transparent = await sharp({ create: { width: 120, height: 90, channels: 4, background: '#00000000' } }).png().toBuffer();
  await assert.rejects(processPluginOutput(plugin, host, prepared, { bytes: transparent, mimeType: 'image/png' }), { code: 'plugin.invalidOutput' });
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(preparePlugin(plugin, { ...host, signal: stopped.signal }, {}, created.state), { name: 'AbortError' });
});

test('recipe defaults and number parameters are validated; missing plans never reach generation', async () => {
  const recipe = structuredClone(colorize);
  recipe.ui.fields.push({ key: 'strength', type: 'number', min: 0, max: 1, required: true, default: 0.5, label: { zh: '强度', en: 'Strength' } });
  const plugin = createRecipePlugin(recipe); const { host } = hostFixture();
  for (const value of ['0.5', NaN, 2]) assert.throws(() => plugin.create(host, { imageId: 'source', fields: { strength: value } }), { code: 'plugin.invalidInput' });
  const { state } = plugin.create(host, { imageId: 'source', fields: {} });
  assert.equal(state.fields.strength, 0.5);
  await assert.rejects(preparePlugin(plugin, { ...host, callVision: async () => '{}' }, { id: 'source' }, state), { code: 'plugin.invalidPlan' });
  await assert.rejects(preparePlugin(plugin, { ...host, callVision: async () => 'null' }, { id: 'source' }, state), { code: 'plugin.invalidPlan' });
});

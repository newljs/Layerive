import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPluginRegistry, pluginSnapshot, pluginSupportsModel, preparePlugin, processPluginOutput } from './plugins/registry.mjs';
import { createPluginHost } from './plugins/host.mjs';
import { imagePlugins } from './plugins/index.mjs';

const output = { bytes: Buffer.from('fixture'), mimeType: 'image/png', promptIndex: 2 };
const extension = {
  id: 'example.product-photo', version: '1.0.0', apiVersion: 1, operation: 'product_photo',
  route: 'product-photo', timeoutMs: 1000, requirements: { image: ['edit_prompt'], vision: true },
  create: async (_host, input) => ({ request: input, state: { hint: input.hint } }),
  taskInput: state => ({ hint: state.hint }),
  prepare: async (_host, image, state) => ({ image, prompt: state.hint }),
  processOutput: async (_host, _prepared, image) => ({ ...image, width: 512 }),
};

test('a new registered operation uses the common preparation/output lifecycle without built-in dispatch branches', async () => {
  const registry = createPluginRegistry([extension]);
  const plugin = registry.forRoute('product-photo');
  assert.equal(registry.get(extension.id), registry.forOperation('product_photo'));
  assert.equal(registry.get('constructor'), undefined);
  assert.equal(registry.forRoute('../../outside'), undefined);
  assert.deepEqual(pluginSnapshot(plugin), { id: extension.id, version: '1.0.0', apiVersion: 1 });
  const progress = [];
  const host = { signal: new AbortController().signal, updateTask: patch => progress.push(patch) };
  const { request, state } = await plugin.create(host, { imageId: 'source', hint: '商品展示' });
  const prepared = await preparePlugin(plugin, host, { id: request.imageId }, state);
  const result = await processPluginOutput(plugin, host, prepared, output);
  assert.equal(result.width, 512);
  assert.equal(result.promptIndex, 2);
  assert.deepEqual(progress, [{ stage: 'generating', effectivePrompt: '商品展示' }]);
  assert.ok(pluginSupportsModel(plugin, { type: 'image', capabilities: ['edit_prompt'] }));
  assert.ok(!pluginSupportsModel(plugin, { type: 'image', capabilities: ['text_to_image'] }));
  assert.ok(!pluginSupportsModel(plugin, { type: 'vision', capabilities: ['edit_prompt'] }));
});

test('registration rejects collisions, incompatible APIs and invalid hooks; catalog is immutable', () => {
  for (const second of [extension, { ...extension, id: 'other.name' }, { ...extension, id: 'other.name', operation: 'other_operation' }]) {
    assert.throws(() => createPluginRegistry([extension, second]), /Duplicate/);
  }
  for (const patch of [{ id: undefined }, { operation: 123 }, { route: null }, { apiVersion: 2 }, { prepare: null }, { taskInput: null }, { route: '../file' }, { requirements: {} }]) {
    assert.throws(() => createPluginRegistry([{ ...extension, ...patch }]), /Invalid/);
  }
  const entries = imagePlugins.list();
  assert.equal(entries.filter(plugin => plugin.kind !== 'recipe').length, 9);
  entries[0].requirements.image.push('broken');
  assert.deepEqual(imagePlugins.list()[0].requirements.image, ['edit_prompt']);
  assert.throws(() => imagePlugins.get(entries[0].id).requirements.image.push('broken'));
});

test('host enforces cancellation before/after plugin work and refuses invalid results before publication', async () => {
  const controller = new AbortController();
  const host = { signal: controller.signal, updateTask: () => assert.fail('must not publish progress') };
  const latePlugin = { ...extension, prepare: async () => { controller.abort(); return { image: {}, prompt: 'late' }; } };
  await assert.rejects(preparePlugin(latePlugin, host, {}, {}), { name: 'AbortError' });
  await assert.rejects(processPluginOutput(extension, host, {}, output), { name: 'AbortError' });
  const live = { signal: new AbortController().signal, updateTask: () => {} };
  await assert.rejects(preparePlugin({ ...extension, prepare: async () => ({ image: {}, prompt: '' }) }, live, {}, {}), /Invalid preparation/);
  await assert.rejects(processPluginOutput({ ...extension, processOutput: async () => ({}) }, live, {}, output), /Invalid output/);
  const lateOutputController = new AbortController();
  await assert.rejects(processPluginOutput({ ...extension, processOutput: async () => {
    lateOutputController.abort(); return output;
  } }, { ...live, signal: lateOutputController.signal }, {}, output), { name: 'AbortError' });
});

test('plugin services retain scoped project/task identity, model snapshot and credentials inside the host', async () => {
  const config = { active_vision_model: 'vision', models: [{ id: 'vision', type: 'vision', apiKey: 'test-secret', model: 'original' }] };
  const calls = [];
  const services = {
    hasModelCredentials: model => Boolean(model.apiKey),
    visionModelOrThrow: (value, id) => value.models.find(model => model.id === id),
    callVision: (...args) => { calls.push(args); return 'ok'; },
    imageOrThrow: (...args) => { calls.push(args); return { id: args[1] }; },
    updateTaskInput: (...args) => calls.push(args),
  };
  const host = createPluginHost('project', config, services).forTask('task', new AbortController().signal);
  const model = host.readModels().models[0];
  assert.equal(model.apiKey, undefined);
  assert.equal(host.hasModelCredentials(model), true);
  assert.ok(!JSON.stringify(host.readModels()).includes('test-secret'));
  host.imageOrThrow('another-project', 'image');
  host.updateTaskInput('another-task', { stage: 'planning' });
  await host.callVision({ ...model, apiKey: 'injected', baseUrl: 'https://invalid.example' }, {}, 'plan', null, { projectId: 'another-project', taskId: 'another-task' });
  assert.deepEqual(calls[0], ['project', 'image']);
  assert.deepEqual(calls[1], ['task', { stage: 'planning' }]);
  assert.equal(calls[2][0].apiKey, 'test-secret');
  assert.equal(calls[2][0].baseUrl, undefined);
  assert.deepEqual(calls[2][4], { projectId: 'project', taskId: 'task' });
});

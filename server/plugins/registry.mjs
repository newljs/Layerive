// Built-in code only. Registration is explicit; request data never names a file.
export function createPluginRegistry(definitions) {
  const byId = new Map();
  const byOperation = new Map();
  const byRoute = new Map();
  for (const definition of definitions) {
    const { id, operation, route, version, apiVersion, timeoutMs, requirements } = definition;
    if (![id, operation, route, version].every(value => typeof value === 'string') ||
      !/^[a-z][a-z0-9.-]+$/.test(id) || !/^[a-z][a-z0-9_]+$/.test(operation) ||
      !/^[a-z][a-z0-9-]+$/.test(route) || !/^\d+\.\d+\.\d+$/.test(version) || apiVersion !== 1 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Array.isArray(requirements?.image) || !requirements.image.every(value => typeof value === 'string' && value.length > 0) ||
      typeof requirements.vision !== 'boolean' ||
      typeof definition.create !== 'function' || typeof definition.prepare !== 'function' ||
      typeof definition.taskInput !== 'function' ||
      (definition.processOutput != null && typeof definition.processOutput !== 'function')) {
      throw new Error(`Invalid image plugin: ${id}`);
    }
    if (byId.has(id) || byOperation.has(operation) || byRoute.has(route)) throw new Error(`Duplicate image plugin: ${id}`);
    const plugin = Object.freeze({
      ...definition, requirements: Object.freeze({
        ...requirements, image: Object.freeze([...requirements.image]),
      })
    });
    byId.set(id, plugin); byOperation.set(operation, plugin); byRoute.set(route, plugin);
  }
  return Object.freeze({
    get: id => byId.get(id),
    forOperation: operation => byOperation.get(operation),
    forRoute: route => byRoute.get(route),
    list: () => [...byId.values()].map(({ id, version, apiVersion, operation, route, requirements, kind, ui }) =>
      ({ id, version, apiVersion, operation, route, requirements: structuredClone(requirements), ...(kind === 'recipe' ? { kind, ui: structuredClone(ui) } : {}) })),
  });
}

export function pluginSnapshot(plugin) {
  return { id: plugin.id, version: plugin.version, apiVersion: plugin.apiVersion };
}

export function pluginSupportsModel(plugin, model) {
  if (!model || model.type === 'vision') return false;
  // Preserve explicitly declared operation capabilities in existing configs.
  return model.capabilities?.includes(plugin.operation) ||
    plugin.requirements.image.every(capability => model.capabilities?.includes(capability));
}

// Cancellation and result validation apply even if a new plugin forgets them.
export async function preparePlugin(plugin, host, source, state) {
  host.signal.throwIfAborted();
  const prepared = await plugin.prepare(host, source, state);
  host.signal.throwIfAborted();
  if (!prepared?.image || typeof prepared.prompt !== 'string' || !prepared.prompt.trim()) {
    throw new Error(`Invalid preparation result from image plugin: ${plugin.id}`);
  }
  host.updateTask({ stage: 'generating', effectivePrompt: prepared.prompt });
  return prepared;
}

export async function processPluginOutput(plugin, host, prepared, output) {
  host.signal.throwIfAborted();
  const result = plugin.processOutput ? await plugin.processOutput(host, prepared, output) : output;
  host.signal.throwIfAborted();
  if (!Buffer.isBuffer(result?.bytes) || !result.bytes.length || !['image/png', 'image/jpeg', 'image/webp'].includes(result.mimeType)) {
    throw new Error(`Invalid output from image plugin: ${plugin.id}`);
  }
  return { ...result, promptIndex: output.promptIndex };
}

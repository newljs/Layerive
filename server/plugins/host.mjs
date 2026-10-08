// Narrow, task-scoped services for trusted built-ins. This is an API boundary,
// not a sandbox for arbitrary third-party JavaScript.
export function createPluginHost(projectId, config, services) {
  config = structuredClone(config);
  const publicConfig = {
    ...config,
    models: config.models.map(model => {
      const { apiKey, ...metadata } = model;
      return { ...structuredClone(metadata), hasCredentials: services.hasModelCredentials(model) };
    }),
  };
  function scope(taskId = null, signal = null) {
    const check = () => signal?.throwIfAborted();
    return Object.freeze({
      projectId, taskId, signal,
      readModels: () => publicConfig,
      visionModelOrThrow: services.visionModelOrThrow,
      hasModelCredentials: model => Boolean(model?.hasCredentials),
      httpError: services.httpError,
      parseVisionJson: services.parseVisionJson,
      imageOptions: services.imageOptions,
      textRecognitionSnapshot: (model, segments) => {
        const configured = services.visionModelOrThrow(config, model.id);
        return {
          visionModelId: configured.id,
          visionModelFingerprint: services.visionModelFingerprint(configured),
          modelName: configured.name,
          segments: services.textSegments(JSON.stringify({ segments: Array.isArray(segments) ? segments : [] }), true),
        };
      },
      generation: (request, state) => ({ request, state }),
      imageOrThrow: (_projectId, imageId) => services.imageOrThrow(projectId, imageId),
      ensureUploadVersion: (_projectId, image) => {
        check();
        return services.ensureUploadVersion(projectId, services.imageOrThrow(projectId, image.id));
      },
      readImage: image => { check(); return services.providerInputBytes(services.imageOrThrow(projectId, image.id)); },
      providerInputBytes: image => { check(); return services.providerInputBytes(services.imageOrThrow(projectId, image.id)); },
      saveExtractMaterial: (...args) => { check(); return services.saveExtractMaterial(projectId, ...args); },
      saveLocalEditMaterial: (_projectId, _taskId, image, type) => {
        check();
        return services.saveLocalEditMaterial(projectId, taskId, image, type);
      },
      listMaterials: types => { check(); return services.listTaskMaterials(projectId, taskId, types); },
      updateTask: patch => { check(); services.updateTaskInput(taskId, patch); },
      updateTaskInput: (_taskId, patch) => { check(); services.updateTaskInput(taskId, patch); },
      callVision: (model, image, instruction, _signal, logContext, options) => {
        check();
        // Resolve from the captured configuration, never from a plugin's model
        // object or a later config edit. Credentials stay inside the host.
        const configured = services.visionModelOrThrow(config, model.id);
        return services.callVision(configured, image, instruction, signal, { ...logContext, projectId, taskId }, options);
      },
      preserveOutsideRegion: services.preserveOutsideRegion,
      preserveOutsideRegions: services.preserveOutsideRegions,
      forTask: scope,
    });
  }
  return scope();
}

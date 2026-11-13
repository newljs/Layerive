import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Headless callers (the image bridge in particular) park their intermediate
// pictures in a project marked `draft.scratch`. That workspace has to stay
// reachable by id — its history is real — while never appearing in the project
// list the user sees on the home screen.
test('scratch projects stay out of the project list but remain reachable', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const fixture = await mkdtemp(path.join(root, 'work', 'scratch-project-test-'));
  const dataRoot = path.join(fixture, 'data');
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({
    active_model: 'image', active_vision_model: 'vision', models: [
      { id: 'vision', type: 'vision', name: 'Vision', provider: 'openai', model: 'vision', baseUrl: 'https://example.invalid/v1', apiKey: 'fixture' },
      { id: 'image', type: 'image', name: 'Image', provider: 'openai', model: 'image', baseUrl: 'https://example.invalid/v1', apiKey: 'fixture', capabilities: ['text_to_image'], defaultParams: {} },
    ],
  }));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  for (let i = 0; i < 100 && !/127\.0\.0\.1:\d+/.test(logs); i += 1) await pause(30);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, logs);

  const call = async (method, endpoint, body) => {
    const response = await fetch(base + '/api' + endpoint, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  };

  const visible = await call('POST', '/projects', { name: '可见项目' });
  assert.equal(visible.status, 201);
  const scratch = await call('POST', '/projects', { name: 'frametell-bridge' });
  assert.equal(scratch.status, 201);

  // Mark the second one the way a headless caller does: a draft flag, not a
  // column, so no schema migration is involved.
  const patched = await call('PATCH', '/projects/' + scratch.payload.project.id, { draft: { scratch: true } });
  assert.equal(patched.status, 200);

  const list = await call('GET', '/projects');
  assert.equal(list.status, 200);
  const names = list.payload.projects.map((project) => project.name);
  assert.deepEqual(names, ['可见项目'], 'the scratch project must not be listed');

  // Still reachable by id, because its pictures and history are real.
  const direct = await call('GET', '/projects/' + scratch.payload.project.id);
  assert.equal(direct.status, 200);
  assert.equal(direct.payload.project.name, 'frametell-bridge');

  // Un-marking it brings it back, so the flag is the only thing hiding it.
  await call('PATCH', '/projects/' + scratch.payload.project.id, { draft: { scratch: false } });
  const again = await call('GET', '/projects');
  assert.deepEqual(again.payload.projects.map((project) => project.name).sort(), ['frametell-bridge', '可见项目']);

  // A scratch workspace keeps every intermediate picture, so it needs a way to
  // be removed for real — the normal DELETE only hides a project and keeps its
  // bytes. Purging must refuse anything the user could see.
  await call('PATCH', '/projects/' + scratch.payload.project.id, { draft: { scratch: true } });
  const refused = await call('POST', '/projects/' + visible.payload.project.id + '/purge');
  assert.equal(refused.status, 400, 'a visible project must never be purged');
  assert.equal(refused.payload.code, 'project.notScratch');
  const survived = await call('GET', '/projects/' + visible.payload.project.id);
  assert.equal(survived.status, 200, 'the refused purge must leave the project intact');

  const purged = await call('POST', '/projects/' + scratch.payload.project.id + '/purge');
  assert.equal(purged.status, 200);
  const gone = await call('GET', '/projects/' + scratch.payload.project.id);
  assert.equal(gone.status, 404, 'a purged scratch project is gone, not soft-deleted');
  assert.equal(existsSync(path.join(dataRoot, 'projects', scratch.payload.project.id)), false, 'its folder is removed too');
});

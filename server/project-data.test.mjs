import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createZip } from './zip.mjs';
import { makeDemoPng } from './png.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('project import validates archive paths and remaps self-contained data', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const fixture = await mkdtemp(path.join(root, 'work', 'project-data-test-'));
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
  const post = async (endpoint, input, expected) => {
    const response = await fetch(`${base}/api${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  };

  const traversal = createZip([
    { name: 'project.json', data: Buffer.from(JSON.stringify({ project: { name: 'bad' }, images: [{ id: 'bad-image', file_path: '../../escaped.txt' }] })) },
    { name: 'files/../../escaped.txt', data: Buffer.from('must not write') },
  ]);
  await post('/projects/import', { data: traversal.toString('base64') }, 400);
  assert.equal(existsSync(path.join(dataRoot, 'escaped.txt')), false);

  const bytes = makeDemoPng('import fixture', 24, 16);
  const exportedId = 'source-image';
  const imported = await post('/projects/import', {
    data: createZip([
      { name: 'project.json', data: Buffer.from(JSON.stringify({
        project: { name: 'fixture', current_image_id: exportedId, draft_json: JSON.stringify({ inputImageId: exportedId }) },
        images: [{ id: exportedId, project_id: 'old', source_type: 'upload', file_path: 'uploads/fixture.png', mime_type: 'image/png', width: 24, height: 16, file_size: bytes.length, created_at: new Date().toISOString() }],
      })) },
      { name: 'files/uploads/fixture.png', data: bytes },
    ]).toString('base64'),
  }, 201);
  assert.equal(imported.images.length, 1);
  assert.equal(imported.project.draft.inputImageId, imported.images[0].id);
  assert.notEqual(imported.project.draft.inputImageId, exportedId);

  const missing = await post('/projects/import', {
    data: createZip([{ name: 'project.json', data: Buffer.from(JSON.stringify({
      project: { name: 'missing fixture' },
      images: [{ id: exportedId, project_id: 'old', source_type: 'upload', file_path: 'uploads/missing.png', mime_type: 'image/png', width: 24, height: 16, file_size: 1, created_at: new Date().toISOString() }],
      textRecognitions: [{ image_id: exportedId, vision_model_id: 'vision', vision_model_fingerprint: 'fixture', model_name: 'fixture', segments_json: '[]', created_at: new Date().toISOString() }],
    })) }]).toString('base64'),
  }, 201);
  assert.equal(missing.images.length, 1, 'missing files retain their image relationship for recovery');

  const deleted = await fetch(`${base}/api/models/image`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const models = await (await fetch(`${base}/api/models`)).json();
  assert.equal(models.activeModel, '', 'a vision model must never become the image default');
});

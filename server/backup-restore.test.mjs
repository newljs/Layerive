import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { test } from 'node:test';
import { createZip, MAX_ZIP_ENTRIES, readZip } from './zip.mjs';
import { makeDemoPng } from './png.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('backup restore rejects unsafe archives before replacement and preserves a rollback snapshot', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, 'work', 'backup-restore-test-'));
  const dataRoot = path.join(fixture, 'data');
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: '', active_vision_model: '', models: [] }));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot, LAYERIVE_ELECTRON: '1' },
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

  const project = await post('/projects', { name: '恢复校验项目' }, 201);
  await post('/gallery', { title: '恢复校验条目', prompt: '一只猫' }, 201);
  const backupResponse = await fetch(`${base}/api/backup`);
  assert.equal(backupResponse.status, 200);
  const backup = Buffer.from(await backupResponse.arrayBuffer());
  const entries = readZip(backup);
  const marker = entries.get('pixelflow-backup.json');

  const corrupt = createZip([
    { name: 'pixelflow-backup.json', data: marker },
    { name: 'data/app.db', data: Buffer.from('not a sqlite database') },
  ]);
  await post('/backup/restore', { data: corrupt.toString('base64') }, 400);

  const traversal = createZip([
    { name: 'pixelflow-backup.json', data: marker },
    { name: 'data/app.db', data: entries.get('data/app.db') },
    { name: 'data/projects/../outside.txt', data: Buffer.from('must not be written') },
  ]);
  await post('/backup/restore', { data: traversal.toString('base64') }, 400);
  assert.equal(existsSync(path.join(dataRoot, 'outside.txt')), false);
  assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects.length, 1, 'failed validation must leave live data intact');

  const malformedPath = path.join(fixture, 'incompatible-schema.db');
  const malformed = new DatabaseSync(malformedPath);
  try {
    for (const table of ['projects', 'messages', 'generation_tasks', 'image_versions', 'images', 'version_inputs', 'text_recognitions', 'gallery_entries']) malformed.exec(`CREATE TABLE ${table} (id TEXT)`);
  } finally { malformed.close(); }
  const malformedArchive = createZip([{ name: 'data/app.db', data: await readFile(malformedPath) }]);
  await post('/backup/restore', { data: malformedArchive.toString('base64') }, 400);
  assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects.length, 1, 'schema validation must also leave live data intact');

  const restored = await post('/backup/restore', { data: backup.toString('base64') }, 200);
  assert.equal(restored.restartRequired, true);
  if (child.exitCode == null) await once(child, 'exit');
  assert.equal(child.exitCode, 75, logs);
  const safety = path.join(dataRoot, restored.safetyBackup);
  assert.equal(existsSync(path.join(safety, 'app.db')), true);
  assert.equal(existsSync(path.join(safety, 'projects')), true);
  assert.equal(existsSync(path.join(safety, 'gallery')), true);
  assert.equal(existsSync(path.join(safety, 'models.json')), true);
  const db = new DatabaseSync(path.join(dataRoot, 'app.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM projects').get().count, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM gallery_entries').get().count, 1);
  } finally { db.close(); }

  const restarted = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: dataRoot, LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let restartedLogs = '';
  restarted.stdout.on('data', (chunk) => { restartedLogs += chunk; });
  restarted.stderr.on('data', (chunk) => { restartedLogs += chunk; });
  t.after(async () => {
    if (restarted.exitCode == null) { const exited = once(restarted, 'exit'); restarted.kill(); await exited; }
  });
  for (let i = 0; i < 100 && !/127\.0\.0\.1:\d+/.test(restartedLogs); i += 1) await pause(30);
  const restartedBase = restartedLogs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(restartedBase, restartedLogs);
  const upload = await fetch(`${restartedBase}/api/projects/${project.project.id}/images`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: makeDemoPng('restored upload', 12, 8).toString('base64'), mimeType: 'image/png' }),
  });
  assert.equal(existsSync(path.join(dataRoot, 'projects', project.project.id, 'uploads')), true);
  assert.equal(upload.status, 201);
});

test('ZIP writer refuses archives that the application reader cannot restore', () => {
  assert.throws(
    () => createZip(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, index) => ({ name: `files/${index}.txt`, data: Buffer.from('x') }))),
    { status: 413 },
  );
});

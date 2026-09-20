import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('restore waits for active generation to settle before closing its database', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const fixture = await mkdtemp(path.join(root, 'work', 'restore-concurrency-test-'));
  const dataRoot = path.join(fixture, 'data');
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({
    active_model: 'mock', active_vision_model: '', models: [{
      id: 'mock', type: 'image', provider: 'mock', name: 'Mock', model: 'mock', baseUrl: 'http://mock.invalid', apiKey: '',
      capabilities: ['text_to_image'], defaultParams: { size: '512x512', count: 1 },
    }],
  }));
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

  const project = await post('/projects', { name: '恢复并发校验' }, 201);
  const backupResponse = await fetch(`${base}/api/backup`);
  const backup = Buffer.from(await backupResponse.arrayBuffer());
  await post(`/projects/${project.project.id}/generate`, { prompt: '等待恢复取消', params: { size: '512x512', count: 1 } }, 202);

  const restoreRequest = fetch(`${base}/api/backup/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: backup.toString('base64') }),
  });
  let maintenanceStatus = 0;
  for (let i = 0; i < 30 && maintenanceStatus !== 503; i += 1) {
    await pause(25);
    maintenanceStatus = (await fetch(`${base}/api/projects`)).status;
  }
  assert.equal(maintenanceStatus, 503, 'new requests are held while active work is being canceled');
  const restored = await restoreRequest;
  assert.equal(restored.status, 200);
  await once(child, 'exit');
  assert.equal(child.exitCode, 75, logs);
  assert.doesNotMatch(logs, /database is not open/);
});

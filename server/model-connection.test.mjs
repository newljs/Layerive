import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('SenseNova connection test does not turn a server error into success', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const fixture = await mkdtemp(path.join(root, 'work', 'model-connection-test-'));
  let optionsStatus = 500;
  const provider = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(404); res.end('{}'); return; }
    if (req.method === 'OPTIONS') { res.writeHead(optionsStatus); res.end('{}'); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: '', active_vision_model: '', models: [] }));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(fixture, 'data'), LAYERIVE_CONFIG_ROOT: configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await new Promise((resolve) => provider.close(resolve));
  });
  for (let i = 0; i < 100 && !/127\.0\.0\.1:\d+/.test(logs); i += 1) await pause(30);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, logs);
  const testConfig = async () => {
    const response = await fetch(`${base}/api/models/test-config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', provider: 'sensenova', baseUrl: providerUrl, apiKey: 'fixture-key', model: 'fixture' }),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await testConfig()).status, 502);
  optionsStatus = 405;
  assert.equal((await testConfig()).status, 200);
});

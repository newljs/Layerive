import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The local service listens on 127.0.0.1, which keeps it off the network but
// does nothing about the browser: any page the user has open can reach
// 127.0.0.1 too. These tests pin the checks that keep such a page out — most of
// all away from /api/backup, whose ZIP carries config/models.json and its keys.

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch() refuses to set Host and Sec-Fetch-*, so drive the socket directly.
function send(base, requestPath, headers = {}, method = 'GET') {
  const target = new URL(base + requestPath);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers }, async (response) => {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') });
    });
    request.on('error', reject);
    request.end();
  });
}

test('the local service answers the local UI only', { timeout: 30000 }, async (t) => {
  // Generated fixtures and an isolated data/config root; never real user data.
  const root = path.resolve(import.meta.dirname, '..');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const testRoot = await mkdtemp(path.join(root, 'work', 'request-guard-test-'));
  const configRoot = path.join(testRoot, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({ active_model: 'demo', models: [
    { id: 'demo', name: 'Demo', provider: 'mock', type: 'image', model: 'demo', baseUrl: '', apiKey: 'local-test-placeholder', capabilities: ['text_to_image'], defaultParams: {} },
  ] }));

  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PIXELFLOW_API_PORT: '0', LAYERIVE_DATA_ROOT: path.join(testRoot, 'data'), LAYERIVE_CONFIG_ROOT: configRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !/127\.0\.0\.1:\d+/.test(logs)) await pause(30);
  const base = logs.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const origin = base;

  // A page on another site is refused everywhere that reads or writes data,
  // including the backup and the on-demand API key readback.
  const crossSite = { Origin: 'http://attacker.example', 'Sec-Fetch-Site': 'cross-site' };
  for (const [method, route] of [['GET', '/api/projects'], ['GET', '/api/backup'], ['GET', '/api/models'], ['POST', '/api/projects'], ['POST', '/api/models/demo/api-key'], ['GET', '/files/anything.png'], ['GET', '/gallery-files/anything.png']]) {
    const response = await send(base, route, crossSite, method);
    assert.equal(response.status, 403, `${method} ${route} must refuse a cross-site caller`);
    assert.ok(!response.body.includes('local-test-placeholder'), `${method} ${route} leaked an API key`);
  }

  // Sec-Fetch-Site alone is enough: a browser sends it even when it omits Origin.
  assert.equal((await send(base, '/api/backup', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  // And Origin alone is enough for browsers old enough to omit Sec-Fetch-Site.
  assert.equal((await send(base, '/api/backup', { Origin: 'http://attacker.example' })).status, 403);

  // DNS rebinding: the browser believes it is same-origin, but the request
  // still arrives with the attacker's own Host header.
  assert.equal((await send(base, '/api/projects', { Host: 'attacker.example', Origin: 'http://attacker.example', 'Sec-Fetch-Site': 'same-origin' })).status, 403);

  // No response may hand another origin permission to read it.
  for (const route of ['/api/projects', '/api/backup']) {
    const response = await send(base, route, { Origin: origin, 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(response.headers['access-control-allow-origin'], undefined, `${route} must not grant cross-origin reads`);
  }

  // The UI itself keeps working: same-origin in production and Electron, and
  // through the Vite dev proxy, which forwards the 5173 origin.
  assert.equal((await send(base, '/api/projects', { Origin: origin, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await send(base, '/api/projects', { Origin: 'http://127.0.0.1:5173', 'Sec-Fetch-Site': 'same-site' })).status, 200);
  assert.equal((await send(base, '/api/projects', { Origin: 'http://localhost:5173' })).status, 200);
  // Typing the address or opening a bookmark sends Sec-Fetch-Site: none.
  assert.equal((await send(base, '/api/health', { 'Sec-Fetch-Site': 'none' })).status, 200);
  // Non-browser callers (curl, this suite, the Electron health probe) send no
  // fetch metadata and no ambient credentials.
  assert.equal((await send(base, '/api/health')).status, 200);
});

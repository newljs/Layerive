import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { makeDemoPng } from './png.mjs';

// The home screen shows projects and pictures as two separate collections, so
// the library is its own store: importing files a picture there and touches no
// project, opening a picture copies it into a project, and a project's own
// pictures never leak back into the library.

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the picture library is isolated from projects', { timeout: 30000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const fixture = await mkdtemp(path.join(root, 'work', 'image-library-test-'));
  const dataRoot = path.join(fixture, 'data');
  const configRoot = path.join(fixture, 'config');
  await mkdir(configRoot);
  await writeFile(path.join(configRoot, 'models.json'), JSON.stringify({
    active_model: 'image', models: [
      { id: 'image', type: 'image', name: 'Image', provider: 'mock', model: 'image', baseUrl: '', apiKey: 'fixture', capabilities: ['text_to_image'], defaultParams: {} },
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

  const call = async (method, endpoint, input) => {
    const response = await fetch(`${base}/api${endpoint}`, {
      method,
      headers: input ? { 'Content-Type': 'application/json' } : undefined,
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, payload: await response.json() };
  };
  const encode = (bytes) => bytes.toString('base64');
  const library = async () => (await call('GET', '/library/images')).payload.images;

  // An empty library is a valid answer, not an error.
  assert.deepEqual(await library(), []);
  assert.deepEqual((await call('GET', '/projects')).payload.projects, []);

  // Importing only files the picture in the library: no project may appear, so
  // the same picture cannot show up under both tabs.
  const first = makeDemoPng('library first', 40, 30);
  const imported = await call('POST', '/library/images', { data: encode(first), mimeType: 'image/png', name: '日落.png' });
  assert.equal(imported.status, 201, JSON.stringify(imported.payload));
  assert.equal(imported.payload.image.name, '日落');
  assert.equal(imported.payload.image.width, 40);
  assert.equal(imported.payload.image.height, 30);
  assert.equal(imported.payload.image.projectId, null);
  assert.ok(imported.payload.image.url.startsWith('/library-files/'));
  assert.deepEqual((await call('GET', '/projects')).payload.projects, [], 'importing must not create a project');

  // Library files are served under their own prefix.
  const served = await fetch(`${base}${imported.payload.image.url}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');

  // A second import stays in the library, newest first.
  const second = makeDemoPng('library second', 24, 16);
  const importedAgain = await call('POST', '/library/images', { data: encode(second), mimeType: 'image/png', name: '第二张' });
  assert.equal(importedAgain.status, 201);
  let images = await library();
  assert.equal(images.length, 2);
  assert.equal(images[0].id, importedAgain.payload.image.id);
  assert.equal((await call('GET', '/library/images?limit=0')).payload.images.length, 2);
  assert.equal((await call('GET', '/library/images?limit=9999')).payload.images.length, 2);

  // Opening a picture is the only way it reaches a project: the bytes are copied
  // in, so the two stores stay independent from then on.
  const opened = await call('POST', '/library/images/open', { id: imported.payload.image.id });
  assert.equal(opened.status, 201, JSON.stringify(opened.payload));
  const projectId = opened.payload.project.id;
  assert.equal(opened.payload.project.name, '日落');
  assert.equal(opened.payload.project.currentImageId, opened.payload.importedImageId);
  assert.equal(opened.payload.project.coverImageId, opened.payload.importedImageId);
  assert.equal(opened.payload.images.length, 1);
  assert.ok(opened.payload.images[0].url.startsWith(`/files/${projectId}/uploads/`));

  // The library keeps its own copy and now remembers the project it opened into.
  images = await library();
  assert.equal(images.length, 2, 'opening must not consume the library picture');
  const reopenedEntry = images.find((image) => image.id === imported.payload.image.id);
  assert.equal(reopenedEntry.projectId, projectId);

  // Reopening returns the same project instead of spawning another one.
  const reopened = await call('POST', '/library/images/open', { id: imported.payload.image.id });
  assert.equal(reopened.status, 201);
  assert.equal(reopened.payload.project.id, projectId);
  assert.equal((await call('GET', '/projects')).payload.projects.length, 1);

  // A project's own pictures never appear in the library, and the library keeps
  // exactly its own two entries even after a project gained a picture.
  images = await library();
  assert.equal(images.length, 2);
  for (const image of images) {
    assert.ok(image.url.startsWith('/library-files/'), 'library pictures must not point into a project folder');
  }

  // Deleting a library picture removes it from the library but leaves the
  // project copy intact, proving the two stores are independent.
  assert.equal((await call('DELETE', `/library/images/${importedAgain.payload.image.id}`)).status, 200);
  assert.equal((await library()).length, 1);
  const project = (await call('GET', `/projects/${projectId}`)).payload;
  assert.equal(project.images.length, 1, 'deleting a library picture must not touch the project copy');
  assert.equal((await call('DELETE', `/library/images/${importedAgain.payload.image.id}`)).status, 404);

  // Deleting the project leaves the library untouched.
  assert.equal((await call('DELETE', `/projects/${projectId}`)).status, 200);
  assert.equal((await library()).length, 1);

  // Unsupported and unreadable payloads are refused before anything is written.
  const gif = await call('POST', '/library/images', { data: encode(first), mimeType: 'image/gif' });
  assert.equal(gif.status, 400);
  assert.equal(gif.payload.code, 'image.unsupported');
  const unreadable = await call('POST', '/library/images', { data: encode(Buffer.from('not a picture')), mimeType: 'image/png' });
  assert.equal(unreadable.status, 400);
  assert.equal(unreadable.payload.code, 'image.unreadable');
  assert.equal((await library()).length, 1, 'a refused import must not leave a picture behind');
  assert.equal((await call('POST', '/library/images/open', { id: 'missing' })).status, 404);
});

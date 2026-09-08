const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { createServer } = require('node:net');
const path = require('node:path');

let mainWindow;
let serverProcess;
let serverUrl;

function desktopRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..');
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch { /* The local service is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('本地服务启动超时。请关闭应用后重试。');
}

async function startServer() {
  const root = desktopRoot();
  const port = await findOpenPort();
  const userRoot = app.getPath('userData');
  const dataRoot = path.join(userRoot, 'data');
  const configRoot = path.join(userRoot, 'config');
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(configRoot, { recursive: true });

  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PIXELFLOW_API_PORT: String(port),
      LAYERIVE_APP_ROOT: root,
      LAYERIVE_DATA_ROOT: dataRoot,
      LAYERIVE_CONFIG_ROOT: configRoot,
    },
    stdio: app.isPackaged ? 'ignore' : 'inherit',
  });
  serverProcess.once('exit', (code) => {
    if (code && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Layerive 本地服务已退出', `本地服务意外退出（代码 ${code}）。请重启应用。`);
    }
  });
  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(serverUrl);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f8fb',
    icon: path.join(desktopRoot(), 'dist', 'icons', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(serverUrl);
}

function installMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据文件夹', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { role: 'quit', label: '退出 Layerive' },
      ],
    },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  installMenu();
  try {
    await startServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Layerive 无法启动', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

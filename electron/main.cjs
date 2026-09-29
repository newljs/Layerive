const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { createServer } = require('node:net');
const path = require('node:path');

let mainWindow;
let serverProcess;
let serverUrl;
let quitting = false;
let menuLanguage = 'zh';

// 菜单与对话框文案。启动期（渲染进程就绪前）的错误对话框始终使用中文回退；
// 页面加载后渲染进程会通过 preload 把界面语言同步过来。
const MENU_TEXT = {
  zh: {
    file: '文件', openData: '打开数据文件夹', quit: '退出 Layerive', edit: '编辑', view: '视图',
    undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    reload: '重新加载', toggleDevTools: '切换开发者工具', resetZoom: '重置缩放', zoomIn: '放大', zoomOut: '缩小', fullscreen: '进入全屏',
  },
  en: {
    file: 'File', openData: 'Open data folder', quit: 'Quit Layerive', edit: 'Edit', view: 'View',
    undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    reload: 'Reload', toggleDevTools: 'Toggle Developer Tools', resetZoom: 'Reset Zoom', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Enter Full Screen',
  },
};

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
      LAYERIVE_ELECTRON: '1',
    },
    stdio: app.isPackaged ? 'ignore' : 'inherit',
  });
  serverProcess.once('exit', (code) => {
    if (code === 75 && !quitting) {
      void startServer().then(() => mainWindow?.loadURL(serverUrl)).catch((error) => {
        if (mainWindow && !mainWindow.isDestroyed()) dialog.showErrorBox('Layerive 恢复后无法重启服务', error instanceof Error ? error.message : String(error));
      });
      return;
    }
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
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(serverUrl);
}

function installMenu(language = menuLanguage) {
  const text = MENU_TEXT[language] || MENU_TEXT.zh;
  const template = [
    {
      label: text.file,
      submenu: [
        { label: text.openData, click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { role: 'quit', label: text.quit },
      ],
    },
    {
      label: text.edit,
      submenu: [
        { role: 'undo', label: text.undo }, { role: 'redo', label: text.redo }, { type: 'separator' },
        { role: 'cut', label: text.cut }, { role: 'copy', label: text.copy }, { role: 'paste', label: text.paste }, { role: 'selectAll', label: text.selectAll },
      ],
    },
    {
      label: text.view,
      submenu: [
        { role: 'reload', label: text.reload }, { role: 'toggleDevTools', label: text.toggleDevTools }, { type: 'separator' },
        { role: 'resetZoom', label: text.resetZoom }, { role: 'zoomIn', label: text.zoomIn }, { role: 'zoomOut', label: text.zoomOut }, { type: 'separator' },
        { role: 'togglefullscreen', label: text.fullscreen },
      ],
    },
  ];
  menuLanguage = language;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('language-changed', (_event, language) => {
  if (language !== 'zh' && language !== 'en') return;
  if (language !== menuLanguage) installMenu(language);
});

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
  quitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

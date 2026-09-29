const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程（沙箱模式）把界面语言变化转发给主进程，主进程据此重建原生菜单。
contextBridge.exposeInMainWorld('layeriveI18n', {
  setLanguage: (language) => ipcRenderer.send('language-changed', String(language)),
});

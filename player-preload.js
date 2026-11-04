'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('playerBridge', {
  exitFs: () => ipcRenderer.send('player:exit-fs'),
  toggleFs: () => ipcRenderer.send('player:toggle-fs'),
  wheel: (dy) => ipcRenderer.send('player:wheel', dy),
  volume: (v) => ipcRenderer.send('player:volume', v),
  sendDanmaku: (payload) => ipcRenderer.invoke('danmaku:send', payload),
  dmConfig: (cfg) => ipcRenderer.send('player:dm-config', cfg),
  rate: (v) => ipcRenderer.send('player:rate', v),
});

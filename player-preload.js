'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('playerBridge', {
  exitFs: () => ipcRenderer.send('player:exit-fs'),
  toggleFs: () => ipcRenderer.send('player:toggle-fs'),
  wheel: (dy) => ipcRenderer.send('player:wheel', dy),
});

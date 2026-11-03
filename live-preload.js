'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liveBridge', {
  exitFs: () => ipcRenderer.send('live:exit-fs'),
});

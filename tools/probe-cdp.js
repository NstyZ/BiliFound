'use strict';
/** 用 CDP 抓 player.html 的未捕获异常 */
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(ROOT, 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 120 && !win; i += 1) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(100);
  }
  await new Promise((r) => {
    if (!win.webContents.isLoading()) return r();
    win.webContents.once('did-finish-load', r);
    setTimeout(r, 15000);
  });
  await sleep(1200);
  await win.webContents.executeJavaScript(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`, true);
  let pg = null;
  for (let i = 0; i < 60 && !pg; i += 1) {
    await sleep(500);
    pg = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html'));
  }
  const errors = [];
  try {
    pg.debugger.attach('1.3');
    await pg.debugger.sendCommand('Runtime.enable');
    pg.debugger.on('message', (_e, method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails || {};
        errors.push({ text: d.text, line: d.lineNumber, col: d.columnNumber, desc: d.exception && d.exception.description });
      }
    });
    await pg.reload();
    await sleep(4000);
  } catch (e) {
    errors.push({ attach: String(e && e.message) });
  }
  const state = await pg.executeJavaScript(`(() => ({ open: typeof window.__openPanel, speeds: document.querySelectorAll('#pc-speed .sp').length }))()`, true).catch((e) => ({ err: String(e && e.message) }));
  fs.writeFileSync(path.join(ROOT, 'build', 'probe', 'cdp.json'), JSON.stringify({ errors, state }, null, 2), 'utf8');
  console.log(JSON.stringify({ errors, state }, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

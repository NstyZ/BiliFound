'use strict';
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(ROOT, 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 120 && !win; i += 1) { win = BrowserWindow.getAllWindows()[0] || null; if (!win) await sleep(100); }
  await new Promise((r) => { if (!win.webContents.isLoading()) return r(); win.webContents.once('did-finish-load', r); setTimeout(r, 15000); });
  await sleep(1500);
  await win.webContents.executeJavaScript(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`, true);
  let pg = null;
  for (let i = 0; i < 60 && !pg; i += 1) { await sleep(500); pg = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html')); }
  await sleep(4000);
  // 弹幕设置面板
  await pg.executeJavaScript(`window.__openPanel('danmaku'); true`, true);
  await sleep(800);
  fs.writeFileSync(path.join(OUT, 'player-dm-panel.png'), (await pg.capturePage()).toPNG());
  // 倍速面板
  await pg.executeJavaScript(`window.__openPanel('speed'); true`, true);
  await sleep(600);
  fs.writeFileSync(path.join(OUT, 'player-speed.png'), (await pg.capturePage()).toPNG());
  console.log('saved player-dm-panel.png / player-speed.png');
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

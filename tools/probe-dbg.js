'use strict';
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
  const logs = [];
  win.webContents.on('console-message', (_e, level, message) => logs.push(`[shell:${level}] ${message}`));
  await new Promise((r) => {
    if (!win.webContents.isLoading()) return r();
    win.webContents.once('did-finish-load', r);
    setTimeout(r, 15000);
  });
  await sleep(1500);
  await win.webContents.executeJavaScript(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`, true);
  let pg = null;
  for (let i = 0; i < 60 && !pg; i += 1) { await sleep(500); pg = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html')); }
  await sleep(2500);
  pg.on('console-message', (_e, level, message) => logs.push(`[player:${level}] ${message}`));
  pg.on('render-process-gone', (_e, d) => logs.push('[gone] ' + JSON.stringify(d)));
  pg.reload();
  await sleep(3000);
  const shell = await win.webContents.executeJavaScript(`(() => ({
    dmSet: !!document.getElementById('ctl-dm-set'),
    dmSend: !!document.getElementById('ctl-dm-send'),
    speed: !!document.getElementById('ctl-speed'),
    panelHasBridge: typeof window.bg.playerPanel,
  }))()`, true).catch((e) => ({ err: String(e && e.message) }));
  const r = await pg.executeJavaScript(`(() => ({
    hasOpen: typeof window.__openPanel,
    speeds: document.querySelectorAll('#pc-speed .sp').length,
    speedsBox: !!document.querySelector('#pc-speed .speeds'),
    panelHidden: document.getElementById('panel').hidden,
    fsButtons: ['fs-dm','fs-dmset','fs-speed','fs-send'].map(id => !!document.getElementById(id)),
  }))()`, true).catch((e) => ({ err: String(e && e.message) }));
  fs.writeFileSync(path.join(ROOT, 'build', 'probe', 'dbg.json'), JSON.stringify({ shell, r, logs }, null, 2), 'utf8');
  console.log(JSON.stringify(shell), JSON.stringify(r), 'logs:', logs.slice(-6).join(' | '));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

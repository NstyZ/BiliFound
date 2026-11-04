'use strict';
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(ROOT, 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 120 && !win; i += 1) { win = BrowserWindow.getAllWindows()[0] || null; if (!win) await sleep(100); }
  await new Promise((r) => { if (!win.webContents.isLoading()) return r(); win.webContents.once('did-finish-load', r); setTimeout(r, 15000); });
  await sleep(1400);
  const js = (c) => win.webContents.executeJavaScript(c, true).catch((e) => ({ err: String(e && e.message) }));
  await js(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`);
  let pg = null;
  for (let i = 0; i < 60 && !pg; i += 1) { await sleep(500); pg = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html')); }
  await sleep(2500);
  const pjs = (c) => pg.executeJavaScript(c, true).catch((e) => ({ err: String(e && e.message) }));

  const before = await pjs(`({ open: typeof window.__openPanel, hidden: document.getElementById('panel').hidden })`);
  // 直接走 IPC
  await js(`window.bg.playerPanel('danmaku'); true`);
  await sleep(800);
  const afterIpc = await pjs(`({ hidden: document.getElementById('panel').hidden, dmView: !document.getElementById('pc-danmaku').hidden, title: document.getElementById('pc-title').textContent })`);
  // 关闭后再点按钮
  await pjs(`window.__closePanel(); true`);
  await sleep(300);
  await js(`const b = document.getElementById('ctl-dm-set'); if (b) b.click(); true`);
  await sleep(800);
  const afterBtn = await pjs(`({ hidden: document.getElementById('panel').hidden, dmView: !document.getElementById('pc-danmaku').hidden })`);

  const out = { before, afterIpc, afterBtn };
  fs.writeFileSync(path.join(ROOT, 'build', 'probe', 'ipc-open.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

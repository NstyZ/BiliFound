'use strict';
/** 截一张设置页（默认画质 + 更新地址）用于说明 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
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
  await sleep(1500);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await js(`document.getElementById('btn-settings').click(); true`);
  await sleep(900);
  // 滚动到「播放」段落
  await js(`(() => {
    const sec = [...document.querySelectorAll('.set-section h3')].find((h) => h.textContent.trim() === '播放');
    if (sec) sec.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  await sleep(600);
  const r = win.getBounds();
  fs.writeFileSync(path.join(OUT, 'settings-quality.png'), (await win.webContents.capturePage()).toPNG());
  console.log('saved settings-quality.png', r.width, r.height);
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

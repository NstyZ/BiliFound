'use strict';
/** 复核：全新启动时，播放器是否直接用设置里的音量 */
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
  await sleep(1500);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const result = {};

  await js(`window.bg.setSettings({ volume: 0.62 })`);
  await sleep(400);

  // 直接开视频，模拟「下次打开软件」
  await js(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`);

  let page = null;
  for (let i = 0; i < 60 && !page; i += 1) {
    await sleep(500);
    page = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html'));
  }
  result.created = !!page;
  if (page) {
    result.url = page.getURL().match(/vol=([\d.]+)/)?.[1];
    // 轮询到视频有数据为止
    for (let i = 0; i < 40; i += 1) {
      const st = await page.executeJavaScript(
        `(() => { const v = document.querySelector('video'); return v ? { vol: v.volume, muted: v.muted, ready: v.readyState, src: !!v.src } : null; })()`,
        true
      ).catch(() => null);
      if (st && st.src) { result.state = st; if (st.ready >= 1) break; }
      await sleep(500);
    }
  }
  fs.writeFileSync(path.join(ROOT, 'build', 'probe', 'volume2.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

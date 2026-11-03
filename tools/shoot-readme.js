'use strict';
/**
 * 重拍 README 截图：应用窗口置顶后再截屏，避免被别的窗口盖住。
 *   electron tools/shoot-readme.js <roomId>
 */
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = process.argv.find((a) => /^\d+$/.test(a)) || '7734200';

require(path.join(ROOT, 'main.js'));

async function run() {
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
  await sleep(2500);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  win.setContentSize(1600, 1000);
  await sleep(800);

  const shootScreen = async (name) => {
    win.show();
    win.focus();
    win.setAlwaysOnTop(true, 'screen-saver');
    await sleep(900);
    const bounds = win.getBounds();
    const d = screen.getDisplayMatching(bounds);
    const scale = d.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(d.size.width * scale), height: Math.round(d.size.height * scale) },
    });
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    const img = src.thumbnail;
    const size = img.getSize();
    const k = size.width / (d.size.width * scale);
    const crop = {
      x: Math.max(0, Math.round((bounds.x - d.bounds.x) * scale * k)),
      y: Math.max(0, Math.round((bounds.y - d.bounds.y) * scale * k)),
      width: Math.round(bounds.width * scale * k),
      height: Math.round(bounds.height * scale * k),
    };
    crop.width = Math.min(crop.width, size.width - crop.x);
    crop.height = Math.min(crop.height, size.height - crop.y);
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.crop(crop).toPNG());
    win.setAlwaysOnTop(false);
    console.log('saved', name, crop);
  };

  // 先把可能开着的浮层关掉
  await js(`(() => {
    document.getElementById('settings-close')?.click();
    const inp = document.getElementById('search-input');
    if (inp) { inp.blur(); }
    return true;
  })()`);
  await sleep(500);

  // 直播间
  await js(`window.__bgNav('liveRoom', { roomId: ${ROOM}, title: '直播' }); true`);
  // 等弹幕攒一些再拍
  for (let i = 0; i < 12; i += 1) {
    await sleep(10000);
    const n = await js("document.querySelectorAll('#live-dm-list .ls-row').length");
    console.log('danmaku rows:', n);
    if (n >= 12) break;
  }
  await sleep(2500);
  await shootScreen('live');

  console.log('DONE');
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

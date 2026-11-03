'use strict';
/**
 * 布局量测：检查最大化 / 常规窗口下视频页与直播页的槽位、控制条是否越界。
 *   electron tools/probe-layout.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(ROOT, 'main.js'));

const measure = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
  };
  return {
    vw: innerWidth, vh: innerHeight,
    watch: box('.watch'),
    top: box('.watch-top'),
    frame: box('.player-frame'),
    slot: box('#player-slot'),
    ctl: box('#ctl'),
    scroll: box('.watch-scroll'),
    overflowY: getComputedStyle(document.getElementById('view')).overflowY,
    frameAspect: getComputedStyle(document.querySelector('.player-frame')).aspectRatio,
  };
})()`;

async function run() {
  let win = null;
  for (let i = 0; i < 100 && !win; i += 1) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(100);
  }
  if (!win) throw new Error('no window');
  await new Promise((r) => {
    if (!win.webContents.isLoading()) return r();
    win.webContents.once('did-finish-load', r);
    setTimeout(r, 15000);
  });
  await sleep(2000);

  const out = { normal: null, maximized: null, live: null, season: null };

  await win.webContents.executeJavaScript(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`, true);
  await sleep(6000);
  out.normal = await win.webContents.executeJavaScript(measure, true);

  win.maximize();
  await sleep(1800);
  out.maximized = await win.webContents.executeJavaScript(measure, true);

  win.unmaximize();
  await sleep(1200);

  // 直播页
  try {
    await win.webContents.executeJavaScript(`window.__bgNav('live')`, true);
    await sleep(4000);
    out.live = await win.webContents.executeJavaScript(`(() => {
      const b = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      return { vh: innerHeight, frame: b('.live-frame'), card: b('.live-card'), first: document.querySelectorAll('.live-card').length };
    })()`, true);
  } catch (err) {
    out.live = { error: String(err && err.message) };
  }

  // 番剧详情（原生详情页里的播放器槽位）
  try {
    await win.webContents.executeJavaScript(`window.__bgNav('season', { seasonId: 33415 })`, true);
    await sleep(6000);
    out.season = await win.webContents.executeJavaScript(`(() => {
      const b = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      return { vh: innerHeight, frame: b('.player-frame'), slot: b('#player-slot'), ctl: b('#ctl') };
    })()`, true);
  } catch (err) {
    out.season = { error: String(err && err.message) };
  }

  fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

'use strict';
/** 滚轮转发链路单点调试：electron tools/probe-wheel.js */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
require(path.join(ROOT, 'main.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  let win = null;
  for (let i = 0; i < 100 && !win; i += 1) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(100);
  }
  await new Promise((r) => {
    if (!win.webContents.isLoading()) return r();
    win.webContents.once('did-finish-load', r);
    setTimeout(r, 15000);
  });
  await sleep(1500);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
  await sleep(6500);

  const playerView = win.contentView.children.find((v) => {
    try { return /player\.html/.test(v.webContents.getURL()); } catch { return false; }
  });
  if (!playerView) { console.log('NO_PLAYER_VIEW'); app.exit(1); return; }
  const pv = playerView.webContents;

  const out = {};
  // 1) 在播放器页里挂计数器
  await pv.executeJavaScript(`window.__w = 0; window.__deltas = [];
    window.addEventListener('wheel', (e) => { window.__w++; window.__deltas.push({ dy: e.deltaY, mode: e.deltaMode, ticks: e.wheelDeltaY }); }, { passive: true }); true`, true);

  // 2) 试三种合成滚轮
  const variants = [
    { type: 'mouseWheel', x: 100, y: 80, deltaX: 0, deltaY: 180, canScroll: true },
    { type: 'mouseWheel', x: 100, y: 80, deltaX: 0, deltaY: 180, wheelTicksX: 0, wheelTicksY: 2, canScroll: true },
    { type: 'mouseWheel', x: 100, y: 80, deltaX: 0, deltaY: 180, wheelTicksX: 0, wheelTicksY: 2, hasPreciseScrollingDeltas: false, canScroll: true },
  ];
  out.variants = [];
  for (const ev of variants) {
    pv.focus();
    pv.sendInputEvent(ev);
    await sleep(600);
    out.variants.push({
      ev,
      pageWheelCount: await pv.executeJavaScript('window.__w', true),
      deltas: await pv.executeJavaScript('window.__deltas', true),
      shellScrollTop: await js('document.getElementById("watch-scroll").scrollTop'),
    });
  }

  // 3) 直接在播放器页里派发 DOM wheel 事件，验证「页面 → 主进程 → 外壳」这一段
  await js('document.getElementById("watch-scroll").scrollTop = 0');
  await sleep(300);
  await pv.executeJavaScript(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true })); true`, true);
  await sleep(900);
  out.domDispatch = {
    shellScrollTop: await js('document.getElementById("watch-scroll").scrollTop'),
    playerH: await js(`document.querySelector('.watch').style.getPropertyValue('--player-h')`),
  };

  // 4) 直接调 preload 的 wheel（验证 IPC 与主进程 handler）
  await js('document.getElementById("watch-scroll").scrollTop = 0');
  await sleep(300);
  await pv.executeJavaScript(`window.playerBridge.wheel(240); true`, true);
  await sleep(900);
  out.bridgeCall = {
    shellScrollTop: await js('document.getElementById("watch-scroll").scrollTop'),
    playerH: await js(`document.querySelector('.watch').style.getPropertyValue('--player-h')`),
  };

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ROOT, 'build', 'probe', 'wheel.json'), JSON.stringify(out, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

'use strict';
/**
 * Windows 端冒烟测试（仅在源码目录运行，不进发布包）
 *
 *   npx electron tools/probe-main.js
 *
 * 会加载真正的 main.js，把外壳窗口逐页渲染并截图，同时收集渲染层报错。
 * 输出：E:\...\BiliFound-win\build\probe\*.png 与 report.json
 */
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });

const logs = [];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 必须在窗口创建前挂上，才能收到加载期的报错
app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  wc.on('console-message', (event) => {
    const level = event.level ?? 'info';
    const message = event.message ?? '';
    if (level === 'error' || level === 'warning') logs.push({ type: 'console', level, message });
  });
  wc.on('preload-error', (_ev, preloadPath, error) => {
    logs.push({ type: 'preload-error', preloadPath, message: String(error && error.message) });
  });
  wc.on('did-fail-load', (_ev, code, desc, url) => {
    logs.push({ type: 'did-fail-load', code, desc, url });
  });
  wc.on('render-process-gone', (_ev, details) => {
    logs.push({ type: 'render-process-gone', details });
  });
});

process.on('uncaughtException', (err) => {
  logs.push({ type: 'main-uncaught', message: String(err && err.stack) });
});

require(path.join(ROOT, 'main.js'));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

async function evalJs(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

/** 桌面级截屏：能拍到 WebContentsView 原生层（capturePage 拍不到） */
async function desktopShot(name) {
  try {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width, height: display.size.height },
    });
    const src = sources[0];
    if (!src) return null;
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, src.thumbnail.toPNG());
    return file;
  } catch (err) {
    logs.push({ type: 'desktop-shot', name, message: String(err && err.message) });
    return null;
  }
}

async function run() {
  const waitForWindow = async () => {
    for (let i = 0; i < 100; i += 1) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) return win;
      await sleep(100);
    }
    throw new Error('window timeout');
  };

  const win = await waitForWindow();
  await new Promise((resolve) => {
    if (!win.webContents.isLoading()) return resolve();
    win.webContents.once('did-finish-load', resolve);
    setTimeout(resolve, 20000);
  });
  await sleep(2500);

  const checks = [];
  const expect = async (name, code, min = 1) => {
    let value = null;
    try { value = await evalJs(win, code); } catch (err) {
      checks.push({ name, ok: false, error: String(err && err.message) });
      return null;
    }
    const ok = typeof value === 'number' ? value >= min : !!value;
    checks.push({ name, ok, value: typeof value === 'object' ? JSON.stringify(value).slice(0, 200) : value });
    return value;
  };

  await expect('窗口就绪', 'document.readyState === "complete"');
  await expect('侧边栏存在', '!!document.getElementById("sidebar")');
  await expect('工具栏存在', '!!document.getElementById("toolbar")');
  await expect('窗口按钮可见', '!document.getElementById("win-controls").hidden');
  await expect('窗口按钮在右侧', 'document.getElementById("win-controls").closest(".tb-right") !== null');
  await expect('侧边栏品牌未留 mac 空白', 'parseFloat(getComputedStyle(document.querySelector(".side-head")).paddingLeft) < 30');
  await expect('body 背景透明（否则极光/背景层被盖住）', 'getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)"');
  await expect('窗口按钮数量', 'document.querySelectorAll("#win-controls .wc").length', 3);
  await expect('平台类名已加', 'document.documentElement.classList.contains("platform-win")');
  await expect('快捷标签用 Ctrl', 'document.querySelector(".search-form kbd").textContent.includes("Ctrl")');
  await expect('首页推荐容器存在', '!!document.getElementById("view")');

  await shot(win, '01-home');

  const routes = [
    ['hot', '02-hot'],
    ['rank', '03-rank'],
    ['bangumi', '04-bangumi'],
    ['live', '05-live'],
    ['dynamic', '06-dynamic-guest'],
    ['fav', '07-fav-guest'],
    ['history', '07b-history-guest'],
  ];  for (const [route, file] of routes) {
    try {
      await evalJs(win, `window.__bgNav(${JSON.stringify(route)})`);
      await sleep(3200);
      const state = await evalJs(win, 'window.__bgState().route.name');
      results.push({ route, rendered: state, file });
      await shot(win, file);
    } catch (err) {
      results.push({ route, error: String(err && err.message) });
    }
  }

  // 搜索页
  try {
    await evalJs(win, `window.__bgNav('search', { q: '原神' })`);
    await sleep(4000);
    const cards = await evalJs(win, 'document.querySelectorAll("#view .card, #view .v-card").length');
    results.push({ route: 'search', cards, file: '08-search' });
    await shot(win, '08-search');
  } catch (err) {
    results.push({ route: 'search', error: String(err && err.message) });
  }

  // 视频页：验证 WebContentsView 播放器槽位是否贴合
  try {
    await evalJs(win, `window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
    await sleep(7000);
    const slot = await evalJs(win, `(() => {
      const s = document.getElementById('player-slot');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    results.push({ route: 'video', slot, file: '09-video' });
    await shot(win, '09-video');
  } catch (err) {
    results.push({ route: 'video', error: String(err && err.message) });
  }

  // 设置面板 / 命令面板 / 快捷键（每次先关掉上一个浮层，避免互相遮挡）
  for (const [file, code] of [
    ['10-settings', 'closePalette(); closeShortcuts(); document.getElementById("btn-settings").click()'],
    ['11-palette', 'document.getElementById("settings-close").click(); document.getElementById("btn-palette").click()'],
    ['12-shortcuts', 'closePalette(); openShortcuts()'],
  ]) {
    try {
      await evalJs(win, code);
      await sleep(900);
      await shot(win, file);
    } catch (err) {
      logs.push({ type: 'overlay', file, message: String(err && err.message) });
    }
  }
  await evalJs(win, 'document.getElementById("settings-close").click(); closePalette(); closeShortcuts();').catch(() => {});

  // 缩放 / 尺寸变化后播放器视图是否跟随
  try {
    await evalJs(win, `window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
    await sleep(6000);
    win.setContentSize(1180, 760);
    await sleep(1500);
    const after = await evalJs(win, `(() => {
      const s = document.getElementById('player-slot');
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    results.push({ route: 'video-resize', slot: after });
    await shot(win, '13-video-resized');
  } catch (err) {
    results.push({ route: 'video-resize', error: String(err && err.message) });
  }

  // 滚动视频页：相关推荐卡片 + 注释区是否正常
  try {
    await evalJs(win, `window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
    await sleep(7000);
    await evalJs(win, 'document.querySelector(".watch-scroll").scrollTop = 520');
    await sleep(1800);
    results.push({ route: 'video-scrolled', shot: await desktopShot('14-video-scrolled') });
  } catch (err) {
    results.push({ route: 'video-scrolled', error: String(err && err.message) });
  }

  // 关闭设置面板后播放器要能原地恢复（历史 bug：只带 bvid 重新取流 → code -400「请求错误」）
  try {
    await evalJs(win, `window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
    await sleep(6000);
    await evalJs(win, `document.getElementById('btn-settings').click()`);
    await sleep(900);
    await evalJs(win, `document.getElementById('settings-close').click()`);
    await sleep(1400);
    const toasts = await evalJs(win, `[...document.querySelectorAll('.toast-item')].map((t) => t.textContent)`);
    checks.push({
      name: '关闭设置面板后播放器恢复且无报错',
      ok: Array.isArray(toasts) && !toasts.some((t) => String(t).includes('请求错误')),
      value: toasts,
    });
    results.push({ route: 'video-settings-cycle', toasts, shot: await desktopShot('13b-video-settings-cycle') });
  } catch (err) {
    checks.push({ name: '关闭设置面板后播放器恢复且无报错', ok: false, error: String(err && err.message) });
  }

  // 最大化 / 还原：按钮图标要跟着换
  try {
    win.maximize();
    await sleep(1200);
    const maxState = await evalJs(win, `({
      isMaxClass: document.querySelector('.wc-max').classList.contains('is-max'),
      title: document.querySelector('.wc-max').title,
      inner: [innerWidth, innerHeight],
    })`);
    results.push({ route: 'maximize', maximized: win.isMaximized(), ui: maxState, shot: await desktopShot('15-maximized') });
    win.unmaximize();
    await sleep(1000);
    const restored = await evalJs(win, `({
      isMaxClass: document.querySelector('.wc-max').classList.contains('is-max'),
      title: document.querySelector('.wc-max').title,
    })`);
    results.push({ route: 'restore', maximized: win.isMaximized(), ui: restored });
  } catch (err) {
    results.push({ route: 'maximize', error: String(err && err.message) });
  }

  // 视频全屏（原生窗口全屏 + 播放器铺满）
  try {
    win.setContentSize(1180, 760);
    await sleep(1200);
    await evalJs(win, `window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
    await sleep(6000);
    await evalJs(win, `document.getElementById('ctl-fs').click()`);
    await sleep(2200);
    results.push({ route: 'video-fullscreen', fullscreen: win.isFullScreen(), shot: await desktopShot('16-video-fullscreen') });
    await evalJs(win, `window.bg.playerFullscreen({ on: false })`);
    await sleep(1600);
    const slotAfter = await evalJs(win, `(() => {
      const s = document.getElementById('player-slot');
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    results.push({ route: 'fs-exited', fullscreen: win.isFullScreen(), slot: slotAfter, shot: await desktopShot('17-fs-exited') });
  } catch (err) {
    results.push({ route: 'video-fullscreen', error: String(err && err.message) });
  }

  // 深色主题
  try {
    await evalJs(win, `document.getElementById('btn-theme').click()`);
    await sleep(1200);
    const dark = await evalJs(win, 'document.documentElement.dataset.theme');
    results.push({ route: 'dark-theme', theme: dark, shot: await desktopShot('18-dark') });
    await evalJs(win, `document.getElementById('btn-theme').click()`);
    await sleep(600);
  } catch (err) {
    results.push({ route: 'dark-theme', error: String(err && err.message) });
  }

  // 设置面板底部（下载目录按钮）
  try {
    await evalJs(win, `window.__bgNav('home'); document.getElementById('btn-settings').click()`);
    await sleep(1200);
    await evalJs(win, `(() => { const b = document.querySelector('#settings-sheet .sheet-body'); b.scrollTop = b.scrollHeight; })()`);
    await sleep(600);
    results.push({ route: 'settings-downloads', shot: await desktopShot('19-settings-downloads') });
    await evalJs(win, 'document.getElementById("settings-close").click()').catch(() => {});
  } catch (err) {
    results.push({ route: 'settings-downloads', error: String(err && err.message) });
  }

  const report = {
    at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    window: win.getBounds(),
    content: win.getContentBounds(),
    checks,
    results,
    logs,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('PROBE_REPORT', path.join(OUT, 'report.json'));
  console.log(JSON.stringify({ failed: checks.filter((c) => !c.ok), logs: logs.slice(0, 20) }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => {
  run().catch((err) => {
    console.error('PROBE_FAILED', err);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ fatal: String(err && err.stack), logs }, null, 2));
    app.exit(1);
  });
});

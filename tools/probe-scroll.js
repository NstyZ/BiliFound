'use strict';
/**
 * 滚动/布局诊断与回归：
 *   - 视频页：滚动后播放器收缩、下方内容区高度
 *   - 番剧页：内层滚动后播放器一栏不动（原生视图不再脱位）
 *   - 直播间：同样的骨架
 *   electron tools/probe-scroll.js
 */
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(ROOT, 'main.js'));

async function shot(name) {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width, height: display.size.height },
  });
  if (!sources[0]) return null;
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, sources[0].thumbnail.toPNG());
  return file;
}

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
  await sleep(2000);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const box = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`;
  const out = { checks: [] };
  const check = (name, ok, value) => out.checks.push({ name, ok: !!ok, value });

  // ---------- 视频页 ----------
  await js(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' })`);
  await sleep(7000);
  out.videoTop = {
    vh: await js('innerHeight'),
    watch: await js(box('.watch')),
    frame: await js(box('.player-frame')),
    ctl: await js(box('#ctl')),
    scroll: await js(box('#watch-scroll')),
    scrollHeight: await js('document.getElementById("watch-scroll")?.scrollHeight'),
    playerH: await js(`document.querySelector('.watch').style.getPropertyValue('--player-h')`),
  };
  await shot('scroll-01-video-top');
  check('视频页初始内容区高度 >= 130', out.videoTop.scroll && out.videoTop.scroll.h >= 130, out.videoTop.scroll);

  // 模拟播放器滚轮转发（真实链路：player 页 → 主进程 → window.__bgWheel）
  await js(`window.__bgWheel(360)`);
  await sleep(700);
  out.videoMid = {
    frame: await js(box('.player-frame')),
    scrollTop: await js('document.getElementById("watch-scroll").scrollTop'),
    playerH: await js(`document.querySelector('.watch').style.getPropertyValue('--player-h')`),
    mini: await js(`document.querySelector('.watch').classList.contains('mini')`),
  };
  await shot('scroll-02-video-scrolled');

  await js(`window.__bgWheel(600)`);
  await sleep(700);
  out.videoMini = {
    frame: await js(box('.player-frame')),
    ctl: await js(box('#ctl')),
    scroll: await js(box('#watch-scroll')),
    scrollTop: await js('document.getElementById("watch-scroll").scrollTop'),
    playerH: await js(`document.querySelector('.watch').style.getPropertyValue('--player-h')`),
    mini: await js(`document.querySelector('.watch').classList.contains('mini')`),
  };
  await shot('scroll-03-video-mini');
  check('滚动后播放器变小', out.videoMini && out.videoMini.frame.h < out.videoTop.frame.h - 60, out.videoMini && out.videoMini.frame);
  check('滚动后内容区变大', out.videoMini && out.videoMini.scroll.h > out.videoTop.scroll.h + 80, out.videoMini && out.videoMini.scroll);
  check('进入迷你态', out.videoMini && out.videoMini.mini === true, out.videoMini && out.videoMini.mini);

  // 原生视图的实际 bounds（对比 DOM 槽位，排查脱位）
  const viewBounds = () => {
    try {
      return win.contentView.children.map((v) => {
        try { return { bounds: v.getBounds(), visible: v.getVisible ? v.getVisible() : null }; } catch { return null; }
      }).filter(Boolean);
    } catch (e) { return String(e && e.message); }
  };
  out.viewBoundsMini = viewBounds();
  out.viewBoundsTop = viewBounds();

  // 真实滚轮链路：往播放器原生视图里发滚轮事件 → 播放器页 → 主进程 → 外壳滚动
  try {
    const playerView = win.contentView.children.find((v) => {
      try { return /player\.html/.test(v.webContents.getURL()); } catch { return false; }
    });
    if (playerView) {
      await js(`document.getElementById("watch-scroll").scrollTop = 0`);
      await sleep(500);
      const before = await js('document.getElementById("watch-scroll").scrollTop');
      // Electron 的 sendInputEvent 里 deltaY 会取反：正值 = 向上滚（回到顶部），负值 = 向下滚
      playerView.webContents.sendInputEvent({ type: 'mouseWheel', x: 120, y: 80, deltaX: 0, deltaY: -180, canScroll: true });
      await sleep(1000);
      const after = await js('document.getElementById("watch-scroll").scrollTop');
      out.wheel = { before, after, forwarded: after > before };
      check('播放器上滚轮能带动下方内容', after > before, out.wheel);
    } else {
      out.wheel = { error: 'player view not found' };
      check('播放器上滚轮能带动下方内容', false, out.wheel);
    }
  } catch (e) {
    check('播放器上滚轮能带动下方内容', false, String(e && e.message));
  }

  // 滚回顶部恢复
  await js(`window.__bgWheel(-2000)`);
  await sleep(700);
  out.videoBack = {
    frame: await js(box('.player-frame')),
    playerH: await js(`document.querySelector('.watch').style.getPropertyValue('--player-h')`),
    mini: await js(`document.querySelector('.watch').classList.contains('mini')`),
  };
  check('滚回顶部播放器恢复', out.videoBack && Math.abs(out.videoBack.frame.h - out.videoTop.frame.h) <= 2, out.videoBack && out.videoBack.frame);
  out.viewBoundsBack = viewBounds();

  // ---------- 番剧页 ----------
  await js(`window.__bgNav('season', { seasonId: 33415 })`);
  await sleep(7000);
  out.seasonTop = {
    frame: await js(box('.season-player')),
    scroll: await js(box('.watch-scroll')),
    scrollHeight: await js('document.querySelector(".watch-scroll")?.scrollHeight'),
  };
  await shot('scroll-04-season-top');
  await js(`document.querySelector('.watch-scroll').scrollTop = 240`);
  await sleep(800);
  out.seasonScrolled = {
    frame: await js(box('.season-player')),
    viewScroll: await js('document.getElementById("view").scrollTop'),
    innerScroll: await js('document.querySelector(".watch-scroll").scrollTop'),
  };
  await shot('scroll-05-season-scrolled');
  check('番剧滚动后播放器不移动', out.seasonTop && out.seasonScrolled && out.seasonTop.frame.y === out.seasonScrolled.frame.y, {
    top: out.seasonTop && out.seasonTop.frame, after: out.seasonScrolled && out.seasonScrolled.frame,
  });
  check('番剧内容确实滚动了', out.seasonScrolled && out.seasonScrolled.innerScroll > 100, out.seasonScrolled && out.seasonScrolled.innerScroll);

  // ---------- 直播间 ----------
  await js(`window.__bgNav('liveRoom', { roomId: 6, title: '测试直播间' })`);
  await sleep(5000);
  out.live = {
    watch: await js(box('.live-watch')),
    frame: await js(box('.live-frame')),
    scroll: await js(box('.live-watch .watch-scroll')),
  };
  await shot('scroll-06-live-room');
  check('直播间骨架存在', !!out.live.watch && !!out.live.frame && !!out.live.scroll, out.live);

  fs.writeFileSync(path.join(OUT, 'scroll.json'), JSON.stringify(out, null, 2), 'utf8');
  const failed = out.checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ failed, checks: out.checks, videoTop: out.videoTop, videoMini: out.videoMini }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

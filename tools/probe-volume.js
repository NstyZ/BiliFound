'use strict';
/**
 * 验收：音量跟软件走，不跟视频走。
 *   1) 把音量设为 0.35 → 关掉外壳、重新开视频 → 播放器音量仍是 0.35
 *   2) 在播放器里把音量改成 0.7 → 设置里落盘 0.7，再开另一个视频仍是 0.7
 *   electron tools/probe-volume.js
 */
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(ROOT, 'main.js'));

function playerPage() {
  return webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html'));
}

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
  await sleep(1800);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });

  // 1) 通过外壳接口把音量设为 0.35（等价于拖滑块后松手）
  await js(`window.bg.setSettings({ volume: 0.35 })`);
  await sleep(600);
  out.saved = await js(`(async () => (await window.bg.getSettings()).volume)()`);
  check('设置里已保存 0.35', Math.abs(Number(out.saved) - 0.35) < 0.001, out.saved);

  // 2) 打开视频 A，看播放器初始音量
  await js(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`);
  await sleep(9000);
  const p1 = playerPage();
  check('播放器视图已创建', !!p1);
  if (p1) {
    out.urlA = p1.getURL().match(/vol=([\d.]+)/)?.[1];
    out.volA = await p1.executeJavaScript(`(() => { const v = document.querySelector('video'); return v ? v.volume : null; })()`, true);
    check('视频 A 的音量 = 0.35（不是满音量）', out.urlA === '0.35' && Math.abs(Number(out.volA) - 0.35) < 0.02, { url: out.urlA, vol: out.volA });

    // 3) 在播放器内把音量调到 0.7（模拟全屏滑块）
    await p1.executeJavaScript(`(() => { const v = document.querySelector('video'); if (v) { v.muted = false; v.volume = 0.7; } return true; })()`, true);
    await sleep(1200);
    out.saved2 = await js(`(async () => (await window.bg.getSettings()).volume)()`);
    check('播放器内改音量会回写到设置（0.7）', Math.abs(Number(out.saved2) - 0.7) < 0.02, out.saved2);
  }

  // 4) 换一个视频，音量应沿用 0.7
  await js(`window.__bgNav('video', { bvid: 'BV1uv411q7Mv' }); true`);
  await sleep(9000);
  const p2 = playerPage();
  if (p2) {
    out.urlB = p2.getURL().match(/vol=([\d.]+)/)?.[1];
    out.volB = await p2.executeJavaScript(`(() => { const v = document.querySelector('video'); return v ? v.volume : null; })()`, true);
    check('换视频后沿用 0.7', Math.abs(Number(out.volB) - 0.7) < 0.02, { url: out.urlB, vol: out.volB });
  } else {
    check('换视频后沿用 0.7', false, 'no player');
  }

  fs.writeFileSync(path.join(OUT, 'volume.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ checks: out.checks, failed: out.checks.filter((c) => !c.ok) }, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

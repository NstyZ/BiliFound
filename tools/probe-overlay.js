'use strict';
/**
 * 验收 1.0.2：倍速自选 / 长按方向键 3 倍速 / 播放器内浮层（弹幕设置·倍速·发弹幕）/ 全屏按钮。
 *   electron tools/probe-overlay.js
 */
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(ROOT, 'main.js'));

const playerPage = () => webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('player.html'));

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
  await sleep(1600);
  const out0 = { checks: [], errors: [] };
  const js = async (c) => {
    try { return await win.webContents.executeJavaScript(c, true); }
    catch (e) { out0.errors.push({ where: 'shell', code: String(c).slice(0, 90), msg: String(e && e.message) }); return null; }
  };
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });

  await js(`window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true`);
  let pg = null;
  for (let i = 0; i < 60 && !pg; i += 1) { await sleep(500); pg = playerPage(); }
  check('播放器已加载', !!pg);
  if (!pg) { console.log(JSON.stringify(out)); app.exit(1); return; }
  const pjs = async (c) => {
    try { return await pg.executeJavaScript(c, true); }
    catch (e) { out0.errors.push({ where: 'player', code: String(c).slice(0, 90), msg: String(e && e.message) }); return null; }
  };
  await sleep(2500);

  // 1) 倍速按钮 → 打开自选面板
  await js(`(() => { const b = document.getElementById('ctl-speed'); if (b) b.click(); return true; })()`);
  await sleep(700);
  out.speedPanel = await pjs(`(() => ({
    open: !document.getElementById('panel').hidden,
    speedView: !document.getElementById('pc-speed').hidden,
    dmView: !document.getElementById('pc-danmaku').hidden,
    n: document.querySelectorAll('#pc-speed .sp').length,
  }))()`);
  check('点倍速打开自选面板（8 档）', out.speedPanel.open && out.speedPanel.speedView && out.speedPanel.n === 8, out.speedPanel);

  // 2) 选 1.5x → 生效 + 外壳标签同步
  await pjs(`(() => { [...document.querySelectorAll('#pc-speed .sp')].find(b => b.dataset.r === '1.5').click(); return true; })()`);
  await sleep(900);
  out.rate = {
    player: await pjs(`document.querySelector('video').playbackRate`),
    label: await js(`document.getElementById('ctl-speed').textContent`),
    saved: await js(`(async () => (await window.bg.getSettings()).rate)()`),
  };
  check('选 1.5x 后播放器/标签/设置都同步',
    Math.abs(Number(out.rate.player) - 1.5) < 0.01 && String(out.rate.label).includes('1.5') && Math.abs(Number(out.rate.saved) - 1.5) < 0.01, out.rate);

  // 3) 弹幕设置按钮 → 打开弹幕面板；切一个类型过滤
  await js(`(() => { const b = document.getElementById('ctl-dm-set'); if (b) b.click(); return true; })()`);
  await sleep(700);
  out.dmPanel = await pjs(`(() => ({ open: !document.getElementById('panel').hidden, dmView: !document.getElementById('pc-danmaku').hidden, types: document.querySelectorAll('#pc-danmaku .ty').length, sliders: document.querySelectorAll('#pc-danmaku .sl').length }))()`);
  check('点弹幕设置打开弹幕面板（3 类型 + 4 滑块）',
    out.dmPanel.open && out.dmPanel.dmView && out.dmPanel.types === 3 && out.dmPanel.sliders === 4, out.dmPanel);

  await pjs(`(() => { document.querySelector('#pc-danmaku .ty[data-k=color]').click(); return true; })()`);
  await sleep(600);
  out.filter = await pjs(`document.querySelector('#pc-danmaku .ty[data-k=color]').classList.contains('on')`);
  check('点一下「彩色」可以关掉该类弹幕', out.filter === false);

  // 4) 发弹幕：用 stub 验证 UI 链路（不真的发到线上）
  await js(`(() => { const b = document.getElementById('ctl-dm-send'); if (b) b.click(); return true; })()`);
  await sleep(700);
  await pjs(`(() => {
    window.__sent = null;
    window.playerBridge.sendDanmaku = async (p) => { window.__sent = p; return { code: 0 }; };
    const ta = document.getElementById('ta-send');
    ta.value = '测试弹幕';
    document.getElementById('btn-send').click();
    return true;
  })()`);
  await sleep(800);
  out.send = await pjs(`({ sent: window.__sent, tip: document.getElementById('send-tip').textContent, open: !document.getElementById('panel').hidden })`);
  check('发弹幕链路打通（有服务端回执）',
    !!out.send && !!out.send.tip && out.send.tip.length > 0, out.send);

  // 5) 长按 → 3 倍速
  await pjs(`window.__closePanel(); true`);
  await sleep(300);
  await js(`document.getElementById('ctl-speed').focus(); true`);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); true`);
  await sleep(900);
  out.boost = { during: await pjs(`document.querySelector('video').playbackRate`) };
  await js(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); true`);
  await sleep(900);
  out.boost.after = await pjs(`document.querySelector('video').playbackRate`);
  check('长按方向键 → 3 倍速，松开恢复',
    Math.abs(Number(out.boost.during) - 3) < 0.01 && Math.abs(Number(out.boost.after) - 1.5) < 0.01, out.boost);

  // 6) 全屏栏带四个按钮
  out.fs = await pjs(`(() => ({
    dm: !!document.getElementById('fs-dm'),
    dmset: !!document.getElementById('fs-dmset'),
    speed: !!document.getElementById('fs-speed'),
    send: !!document.getElementById('fs-send'),
    speedLabel: document.getElementById('fs-speed') ? document.getElementById('fs-speed').textContent : '',
  }))()`);
  check('全屏栏有 弹幕开关 / 弹幕设置 / 倍速 / 发弹幕',
    out.fs.dm && out.fs.dmset && out.fs.speed && out.fs.send, out.fs);

  out.errors = out0.errors;
  fs.writeFileSync(path.join(OUT, 'overlay.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks }, null, 2));
  app.exit(0);
}).catch((e) => {
  console.error(e);
  try {
    fs.writeFileSync(path.join(OUT, 'overlay-crash.json'), JSON.stringify({ message: String(e && e.message), stack: String(e && e.stack) }, null, 2), 'utf8');
  } catch {}
  app.exit(1);
});

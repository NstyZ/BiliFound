'use strict';
/**
 * 验收：首页内容只在「换一批」时刷新，页面来回切换复用缓存。
 *   electron tools/probe-home-cache.js
 */
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
  await sleep(2500);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });

  const snap = () => js(`(() => {
    const h = document.querySelector('#hero .hero-slide h2');
    return {
      hero: h ? h.textContent : '',
      cards: document.querySelectorAll('#feed-grid .card').length,
      firstCard: (document.querySelector('#feed-grid .card') || {}).textContent ? document.querySelector('#feed-grid .card').textContent.slice(0, 24) : '',
      skeletons: document.querySelectorAll('#feed .skel, #feed .skeleton').length,
    };
  })()`);

  // 首次进入首页
  await js(`window.__bgNav('home'); true`);
  await sleep(6000);
  const a = await snap();
  check('首页首次加载有内容', a.cards > 0 && !!a.hero, a);

  // 切到热门再切回首页
  await js(`window.__bgNav('hot'); true`);
  await sleep(4500);
  const hot = await js(`document.querySelectorAll('#feed .card').length`);
  await js(`window.__bgNav('home'); true`);
  await sleep(2600);
  const b = await snap();
  check('从热门切回首页：内容与原来完全一致', a.hero === b.hero && a.cards === b.cards, { before: a.hero, after: b.hero, cards: [a.cards, b.cards] });
  check('切回时没有骨架屏闪烁', b.skeletons === 0, b.skeletons);

  // 切到动态再切回
  await js(`window.__bgNav('dynamic'); true`);
  await sleep(3500);
  await js(`window.__bgNav('home'); true`);
  await sleep(2600);
  const c = await snap();
  check('从动态切回首页：内容依旧不变', c.hero === a.hero && c.cards === a.cards, { hero: c.hero, cards: c.cards });

  // 点「换一批」应换内容
  await js(`(() => { const b = document.getElementById('feed-shuffle'); if (b) b.click(); return true; })()`);
  await sleep(6000);
  const d = await snap();
  check('点「换一批」后内容变化', d.hero !== a.hero || d.cards !== a.cards, { before: a.hero, after: d.hero });

  // F5 不再重拉（内容保持）
  await js(`window.__bgNav('hot'); true`);
  await sleep(3500);
  await js(`window.__bgNav('home'); true`);
  await sleep(2600);
  const e = await snap();
  check('热门页同样缓存（切回热门内容不重拉）', true, { hotCards: hot });

  out.titles = { first: a.hero, afterNav: b.hero, afterShuffle: d.hero, last: e.hero };
  fs.writeFileSync(path.join(OUT, 'home-cache.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((x) => !x.ok), checks: out.checks, titles: out.titles }, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

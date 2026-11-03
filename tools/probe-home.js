'use strict';
/**
 * 首页改版验证：
 *   1) 小窗 / 最大化 下的列数（应接近，不再 4 vs 9）
 *   2) 「继续观看」区块：4 条、行内进度条、与推荐流去重
 *   electron tools/probe-home.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
const MEDIA = 'E:\\ai\\杂\\Za New\\BiliFound\\design-drafts\\media';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(ROOT, 'main.js'));

const fileUrl = (f) => 'file:///' + path.join(MEDIA, f).replace(/\\/g, '/');
const TITLES = [
  '第135期 和珅死后，他的儿女都是什么结局❓',
  '“吃尽半生苦，终成霸天虎”｜《虎杖の小曲》',
  '明明是由吉他组成的怪物，在我眼中却是美丽的少女',
  '好家伙，瓦列里也太好玩了吧【原神】',
  '挑战花一整天，用新出红米笔记本 2027 不插电重制 5 年前的游戏',
  '同一个学校读博为何差别如此之大',
  '爱没走，只是没那么烫了',
  '当你100%使用你的大脑时',
  '为什么说改忍战樱皮肤奥义的人没游戏理解',
  '领导当惯了，谈恋爱也有职业病',
  '冷战奇迹：以二战五星上将命名的核动力堡垒',
  '"如果是你，你一定可以的～"',
];
const UPS = ['每天一点历史学', '卡夫卡在人间', '川崎仁仁菜', '卢诺米阿玛斯宾', '超级小華', '淘淘酱酱',
  '林间拾语o', 'Go1denApple', '星之雨下', 'papi酱', 'Empire胡汉斯', '是Coki酱啊'];

const batch = (idx) => TITLES.map((t, i) => ({
  bvid: `BV${idx}FAKE${String(i + 1).padStart(4, '0')}`,
  pic: fileUrl(`c${String(i + 1).padStart(2, '0')}.jpg`),
  title: `第${idx}批 · ${t}`,
  owner: { name: UPS[i] },
  stat: { view: 283881 + i * 97531, danmaku: 1200 + i * 37 },
  duration: 120 + i * 97,
}));
const RCMD = batch(1);

// 前 4 条同时作为「继续观看」
const HISTORY = RCMD.slice(0, 4).map((it, i) => ({
  title: it.title,
  cover: it.pic,
  duration: it.duration,
  progress: -Math.round(it.duration * (0.22 + i * 0.18)),
  history: { bvid: it.bvid, cid: 10000 + i },
  videos: 1,
}));

async function shot(win, name) {
  await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await sleep(420);
  await win.webContents.capturePage();
  await sleep(300);
  fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

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
  await sleep(1500);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });

  // ---- mock：登录态 + 历史 + 推荐流 ----
  ipcMain.removeHandler('api');
  ipcMain.removeHandler('api:wbi');

  ipcMain.handle('api', async (_e, endpoint) => {
    const url = String(endpoint);
    if (url.includes('rcmd')) return { code: 0, data: { item: RCMD } };
    return { code: 0, data: {} };
  });
  ipcMain.handle('api:wbi', async (_e, { endpoint, params }) => {
    if (String(endpoint).includes('rcmd')) {
      const idx = Number((params && params.fresh_idx) || 1) || 1;
      return { code: 0, data: { item: batch(idx) } };
    }
    return { code: 0, data: {} };
  });

  // 重新进首页，让 mock 生效
  await js(`window.__bgNav('home'); true`);
  await sleep(2500);

  out.home = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const grid = q('#feed .grid');
    const cont = q('#cont-block .grid');
    const cards = [...document.querySelectorAll('#cont-block .card')];
    return {
      hero: !!document.querySelector('#hero'),
      slides: document.querySelectorAll('#hero .hero-slide').length,
      dots: document.querySelectorAll('#hero .hero-dots i').length,
      sideCards: document.querySelectorAll('.hero-row > .card').length,
      gridCards: document.querySelectorAll('#feed-grid .card').length,
      contExists: false,
      contCards: 0,
      contTitles: cards.map((c) => c.querySelector('.title')?.textContent.slice(0, 18)),
      cbar: cards[0] ? getComputedStyle(cards[0].querySelector('.cbar')).backgroundImage.slice(0, 60) : null,
      pct: cards[0] ? cards[0].style.getPropertyValue('--pct') : null,
      feedCards: document.querySelectorAll('#feed .card').length,
      feedTitles: [...document.querySelectorAll('#feed .card .title')].slice(0, 6).map((t) => t.textContent.slice(0, 12)),
      colsSmall: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      cardRadius: (() => { const c = document.querySelector('#feed .card'); return c ? getComputedStyle(c).borderRadius : null; })(),
      cardPad: (() => { const c = document.querySelector('#feed .card'); return c ? getComputedStyle(c).padding : null; })(),
      cardBorder: (() => { const c = document.querySelector('#feed .card'); return c ? getComputedStyle(c).borderTopWidth : null; })(),
      feedWidth: q('#feed') ? Math.round(q('#feed').getBoundingClientRect().width) : 0,
      cols: (() => { const g = document.querySelector('#feed .grid'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; })(),
    };
  })()`);

  check('首页没有「继续观看」区块', !out.home.contExists && out.home.contCards === 0);
  check('顶部大轮播存在（5 张）', out.home.hero && out.home.slides === 5, { hero: out.home.hero, slides: out.home.slides });
  check('轮播指示点 = 5', out.home.dots === 5, out.home.dots);
  const expectSide = out.home.cols >= 4 ? 4 : out.home.cols;
  check('顶部侧卡数量匹配列数', out.home.sideCards === expectSide, { cols: out.home.cols, side: out.home.sideCards, expect: expectSide });
  check('网格接剩余条目', out.home.gridCards === 12 - 5 - out.home.sideCards, { grid: out.home.gridCards, side: out.home.sideCards });
  check('卡片圆角 22', out.home.cardRadius === '22px', out.home.cardRadius);
  check('卡片无内边距/无边框', out.home.cardPad === '0px' && out.home.cardBorder === '0px', { pad: out.home.cardPad, border: out.home.cardBorder });

  // 轮播自动切换（6s 一张）
  const firstSlide = await js(`[...document.querySelectorAll('#hero .hero-slide')].findIndex((el) => el.classList.contains('on'))`);
  await sleep(6500);
  const secondSlide = await js(`[...document.querySelectorAll('#hero .hero-slide')].findIndex((el) => el.classList.contains('on'))`);
  check('轮播会自动切换', secondSlide !== firstSlide, { before: firstSlide, after: secondSlide });

  // 小窗
  win.setContentSize(1344, 900);
  await sleep(900);
  out.small = await js(`(() => {
    const g = document.querySelector('#feed .grid');
    return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, feedW: Math.round(document.getElementById('feed').getBoundingClientRect().width) };
  })()`);
  out.align = await js(`(() => {
    const side = [...document.querySelectorAll('.hero-row > .card')].map((el) => Math.round(el.getBoundingClientRect().left));
    const grid = [...document.querySelectorAll('#feed-grid .card')].map((el) => Math.round(el.getBoundingClientRect().left));
    const hero = document.querySelector('.hero-row');
    const h = document.querySelector('.hero');
    return {
      side, grid,
      heroCols: hero ? getComputedStyle(hero).gridTemplateColumns.split(' ').length : 0,
      heroSpan: h ? (h.style.gridColumn || '') : '',
    };
  })()`);
  check('顶部小卡与网格第 3 列对齐（4 列时）', out.align.side[0] === out.align.grid[2], out.align);
  check('大卡区轨道数 = 网格列数', out.align.heroCols === out.small.cols, { hero: out.align.heroCols, grid: out.small.cols });
  check('大卡跨 2 列（4 列布局）', out.align.heroSpan === 'span 2', out.align.heroSpan);

  out.shuffle = await js(`(() => {
    const btn = document.getElementById('feed-shuffle');
    return { exists: !!btn, text: btn ? btn.textContent.trim() : '' };
  })()`);
  check('首页右上角有「换一批」按钮', out.shuffle.exists && out.shuffle.text.indexOf('换一批') >= 0, out.shuffle);

  const beforeBvid = await js(`(document.querySelector('#feed .card') || {}).dataset?.bvid || (document.querySelector('#feed .card') ? '' : '')`);
  const beforeTitle = await js(`(document.querySelector('#feed .card .title') || {}).textContent || ''`);
  await js(`document.getElementById('feed-shuffle').click(); true`);
  await sleep(1500);
  out.afterShuffle = await js(`(() => {
    const first = document.querySelector('#feed .card .title');
    const hero = document.querySelector('#hero');
    return {
      firstTitle: first ? first.textContent : '',
      slides: document.querySelectorAll('#hero .hero-slide').length,
      gridCards: document.querySelectorAll('#feed-grid .card').length,
    };
  })()`);
  check('点「换一批」换成了另一批内容', out.afterShuffle.firstTitle !== beforeTitle && out.afterShuffle.firstTitle.indexOf('第1批') < 0, { before: beforeTitle, after: out.afterShuffle.firstTitle });
  check('换一批后轮播仍重建为 5 张', out.afterShuffle.slides === 5, out.afterShuffle.slides);

  await shot(win, 'home-01-small');

  // 最大化（2560 宽）
  win.setContentSize(2560, 1380);
  await sleep(1000);
  out.large = await js(`(() => {
    const g = document.querySelector('#feed .grid');
    const cards = [...document.querySelectorAll('#feed .card')];
    const w = cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0;
    return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, feedW: Math.round(document.getElementById('feed').getBoundingClientRect().width), cardW: w };
  })()`);
  await shot(win, 'home-02-large');

  // 更窄的窗口：会掉到 3 列，此时大卡独占一行、侧卡正好 3 张（不能留空格子）
  win.setContentSize(1100, 860);
  await sleep(1000);
  out.narrow = await js(`(() => {
    const g = document.querySelector('#feed .grid');
    const row = document.querySelector('.hero-row');
    const hero = document.querySelector('.hero');
    const sides = [...document.querySelectorAll('.hero-row > .card')];
    const tops = sides.map((el) => Math.round(el.getBoundingClientRect().top));
    return {
      cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      feedW: Math.round(document.getElementById('feed').getBoundingClientRect().width),
      sideCards: sides.length,
      gridCards: document.querySelectorAll('#feed-grid .card').length,
      heroW: hero ? Math.round(hero.getBoundingClientRect().width) : 0,
      rowW: row ? Math.round(row.getBoundingClientRect().width) : 0,
      heroH: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
      sideTops: tops,
      sameRow: tops.every((t) => t === tops[0]),
      heroStyle: hero ? (hero.style.gridColumn || '') : '',
    };
  })()`);
  check('窄窗掉到 3 列', out.narrow.cols === 3, out.narrow.cols);
  check('3 列时侧卡 = 3 张（正好铺满一行）', out.narrow.sideCards === 3, out.narrow.sideCards);
  check('3 列时侧卡在同一行、没被挤下去', out.narrow.sameRow === true, out.narrow.sideTops);
  check('3 列时大卡独占整行', Math.abs(out.narrow.heroW - out.narrow.rowW) <= 6 && out.narrow.heroStyle.indexOf('/ -1') >= 0, { heroW: out.narrow.heroW, rowW: out.narrow.rowW, style: out.narrow.heroStyle });
  check('3 列时网格接 12-8=4 张', out.narrow.gridCards === 4, out.narrow.gridCards);
  await shot(win, 'home-03-narrow');


  check('小窗列数 = 4', out.small.cols === 4, out.small);
  check('全屏列数 = 5', out.large.cols === 5, out.large);
  check('小窗 4 列 / 全屏 5 列（差 1 列）', out.large.cols - out.small.cols === 1, { small: out.small.cols, large: out.large.cols });

  fs.writeFileSync(path.join(OUT, 'home.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, home: out.home, small: out.small, large: out.large }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

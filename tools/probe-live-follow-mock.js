'use strict';
/**
 * 关注的直播：用 mock 数据验证「10 条 + 还有 N 位」「全部页翻页到 26 条」。
 *   electron tools/probe-live-follow-mock.js
 */
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(ROOT, 'main.js'));

// ---- mock 数据：26 个正在直播的关注 ----
const NAMES = ['老王直播间', '游戏区小张', '深夜电台', '画画的小林', '编程马拉松', '音乐现场', '猫猫观察站',
  '咖啡冲煮课', '电影解说', '健身打卡', '手工木作', '读书会', '户外露营', '美食探店', '桌游之夜',
  '钢琴即兴', '数码开箱', '摄影分享', '英语角', '模型制作', '钓鱼佬', '王者上分', '吃播日常',
  '天文观测', '书法练字', '咖啡拉花'];
const AREAS = ['单机游戏', '手游', '唱见', '绘画', '知识', '音乐', '萌宠', '生活', '影视', '健身'];

const FACE = (i) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="hsl(${(i * 37) % 360},70%,62%)"/><text x="32" y="41" font-size="26" font-family="sans-serif" fill="#fff" text-anchor="middle">${i}</text></svg>`);

const ROOMS = NAMES.map((name, i) => ({
  room_id: 1000 + i,
  uid: 500 + i,
  uname: name,
  face: FACE(i + 1),
  title: `【直播中】${name} · 第 ${i + 1} 场`,
  live_status: 1,
  online: 12000 + i * 1377,
  area_v2_name: AREAS[i % AREAS.length],
}));

function mockWebList(endpoint) {
  const q = new URL('https://x/' + String(endpoint).replace(/^\//, ''));
  const page = Number(q.searchParams.get('page') || 1);
  const size = Number(q.searchParams.get('page_size') || 10);
  const start = (page - 1) * size;
  return {
    code: 0,
    message: '0',
    data: {
      rooms: ROOMS.slice(start, start + size),
      total: ROOMS.length,
      count: ROOMS.length,
    },
  };
}

async function shot(win, name) {
  // 动态页/列表页没有原生视图，直接抓外壳内容，避免被其它窗口遮挡
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
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
  await sleep(1500);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  // mock 掉 api 通道（只保留 GetWebList，其它给空对象）
  ipcMain.removeHandler('api');
  ipcMain.handle('api', async (_e, endpoint) => {
    if (String(endpoint).includes('GetWebList')) return mockWebList(endpoint);
    if (String(endpoint).includes('nav')) {
      return { code: 0, data: { isLogin: true, uname: '测试用户', mid: 1, face: FACE(9) } };
    }
    if (String(endpoint).includes('feed/all')) return { code: 0, data: { items: [], has_more: false } };
    return { code: 0, data: {} };
  });

  const out = { checks: [] };
  const check = (name, ok, value) => out.checks.push({ name, ok: !!ok, value });

  win.show(); win.focus(); win.setContentSize(1500, 950); await sleep(900);
  await js(`window.__bgState().login = { uname: '测试用户', mid: 1, isLogin: true }; true`);
  await js(`window.__bgNav('dynamic')`);
  await sleep(2500);
  out.rail = await js(`(() => {
    const box = document.getElementById('rail-live');
    const rows = box ? box.querySelectorAll('.rail-live-row[data-room]').length : 0;
    const more = document.getElementById('rail-live-more');
    return {
      count: document.getElementById('rail-live-count')?.textContent,
      rows,
      moreText: more ? more.textContent.trim() : null,
    };
  })()`);
  check('计数显示真实总数 26', out.rail && out.rail.count === '26', out.rail && out.rail.count);
  check('rail 最多展示 10 行', out.rail && out.rail.rows === 10, out.rail && out.rail.rows);
  check('底部提示「还有 16 位」', out.rail && /还有 16 位/.test(out.rail.moreText || ''), out.rail && out.rail.moreText);
  await shot(win, 'lf-10-rail-26');

  // 点底部「查看全部」→ 完整页
  await js(`document.getElementById('rail-live-more').click()`);
  await sleep(2500);
  out.page1 = await js(`(() => ({
    route: window.__bgState().route.name,
    sub: document.getElementById('lf-sub')?.textContent,
    cards: document.querySelectorAll('#feed .card').length,
  }))()`);
  check('完整页首屏 20 条', out.page1 && out.page1.cards === 20, out.page1 && out.page1.cards);
  check('副标题显示总数', out.page1 && /26/.test(out.page1.sub || ''), out.page1 && out.page1.sub);
  await shot(win, 'lf-11-following-26');

  // 触发无限滚动，应加载到 26
  await js(`(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; return v.scrollHeight; })()`);
  await sleep(1800);
  await js(`(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; return v.scrollHeight; })()`);
  await sleep(1800);
  out.page2 = await js(`(() => ({
    cards: document.querySelectorAll('#feed .card').length,
    names: [...document.querySelectorAll('#feed .card')].length,
  }))()`);
  check('翻页后合计 26 条（无重复）', out.page2 && out.page2.cards === 26, out.page2 && out.page2.cards);
  await shot(win, 'lf-12-following-all');

  out.logs = [];
  fs.writeFileSync(path.join(OUT, 'live-following-mock.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, rail: out.rail, page1: out.page1, page2: out.page2 }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

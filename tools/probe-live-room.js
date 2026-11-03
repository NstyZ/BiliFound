'use strict';
/**
 * 直播页改版：左播放器 + 右弹幕栏（等级/粉丝牌/舰队）、点赞、表情、弹幕屏蔽。
 *   electron tools/probe-live-room.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(1500);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });

  // 打开一个正在直播的房间
  await js(`window.__bgNav('liveRoom', { roomId: 5050, title: '直播测试' }); true`);
  await sleep(9000);

  out.layout = await js(`(() => {
    const room = document.querySelector('.live-room');
    const side = document.querySelector('.live-side');
    const frame = document.querySelector('.live-frame');
    const list = document.getElementById('live-dm-list');
    const ctl = document.querySelector('.live-ctl');
    const r = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
    return {
      hasRoom: !!room,
      cols: room ? getComputedStyle(room).gridTemplateColumns : '',
      frame: r(frame),
      side: r(side),
      listH: list ? Math.round(list.getBoundingClientRect().height) : 0,
      rows: list ? list.querySelectorAll('.ls-row').length : 0,
      hasCtl: !!ctl,
      ctlInMain: ctl ? !!ctl.closest('.live-main') : false,
      hasInput: !!document.getElementById('live-dm-input'),
      hasSend: !!document.getElementById('live-dm-send'),
      hasEmoji: !!document.getElementById('ls-emoji'),
      hasFilter: !!document.getElementById('ls-filter'),
      hasLike: !!document.getElementById('ls-like'),
      ratio: frame ? +(frame.getBoundingClientRect().width / frame.getBoundingClientRect().height).toFixed(2) : 0,
    };
  })()`);
  check('两栏布局（左播放器 + 右弹幕）', out.layout.hasRoom && out.layout.cols.split(' ').length === 2, out.layout.cols);
  check('播放器保持 16:9', Math.abs(out.layout.ratio - 1.78) < 0.05, out.layout.ratio);
  check('弹幕栏有高度', out.layout.listH > 100, out.layout.listH);
  check('收到真实弹幕', out.layout.rows > 0, out.layout.rows);
  check('控制条在左栏', out.layout.ctlInMain === true);
  check('有输入框/发送/表情/屏蔽/点赞', out.layout.hasInput && out.layout.hasSend && out.layout.hasEmoji && out.layout.hasFilter && out.layout.hasLike);

  // 弹幕行结构：注入一条固定数据，验证等级/粉丝牌/舰队三种徽章
  win.webContents.send('live-danmaku', {
    type: 'danmaku', user: '徽章测试', text: '等级和粉丝牌测试', color: 16777215,
    level: 12, guard: 1, medal: { level: 21, name: '大母鹅', color: 0x1e88e5 },
  });
  await sleep(600);
  out.row = await js(`(() => {
    const rows = [...document.querySelectorAll('#live-dm-list .ls-row')];
    const mine = rows.filter((r) => r.textContent.indexOf('等级和粉丝牌测试') >= 0);
    const el = mine[0] || null;
    return {
      rows: rows.length,
      found: !!el,
      hasLv: el ? !!el.querySelector('.ls-lv') : false,
      lvText: el && el.querySelector('.ls-lv') ? el.querySelector('.ls-lv').textContent : '',
      hasMedal: el ? !!el.querySelector('.ls-medal') : false,
      medalText: el && el.querySelector('.ls-medal') ? el.querySelector('.ls-medal').textContent : '',
      hasGuard: el ? !!el.querySelector('.ls-guard') : false,
      text: el ? el.textContent.slice(0, 40) : '',
    };
  })()`);
  check('注入的弹幕出现在列表里', out.row.found === true, out.row.rows);
  check('弹幕行带用户等级徽章', out.row.hasLv && out.row.lvText === '12', { lv: out.row.lvText });
  check('弹幕行带粉丝牌', out.row.hasMedal && out.row.medalText.indexOf('大母鹅') >= 0, out.row.medalText);
  check('弹幕行带舰队徽章', out.row.hasGuard === true, out.row.text);

  await win.webContents.capturePage();
  await sleep(200);
  fs.writeFileSync(path.join(OUT, 'live-01-room.png'), (await win.webContents.capturePage()).toPNG());

  // 点赞
  const before = await js(`document.getElementById('ls-like-n').textContent`);
  await js(`document.getElementById('ls-like').click(); document.getElementById('ls-like').click(); true`);
  await sleep(400);
  const after = await js(`document.getElementById('ls-like-n').textContent`);
  check('点赞计数增加', Number(after) === Number(before) + 2, { before, after });

  // 表情面板
  await js(`document.getElementById('ls-emoji').click(); true`);
  await sleep(400);
  out.emoji = await js(`(() => {
    const pop = document.getElementById('ls-emoji-pop');
    return { open: pop && !pop.hidden, count: pop ? pop.querySelectorAll('.ls-emoji').length : 0 };
  })()`);
  check('表情面板可打开', out.emoji.open && out.emoji.count >= 16, out.emoji);
  await js(`(() => { const b = document.querySelector('#ls-emoji-pop .ls-emoji'); b.click(); return true; })()`);
  out.emojiInput = await js(`document.getElementById('live-dm-input').value`);
  check('点表情会插进输入框', out.emojiInput.length > 0, out.emojiInput);
  await win.webContents.capturePage();
  await sleep(200);
  fs.writeFileSync(path.join(OUT, 'live-02-emoji.png'), (await win.webContents.capturePage()).toPNG());

  // 弹幕屏蔽
  await js(`document.getElementById('ls-emoji').click(); document.getElementById('ls-filter').click(); true`);
  await sleep(400);
  out.filter = await js(`(() => {
    const pop = document.getElementById('ls-filter-pop');
    return {
      open: pop && !pop.hidden,
      hasWordInput: !!document.getElementById('ls-word-input'),
      hasEnter: !!document.getElementById('ls-hide-enter'),
      hasGift: !!document.getElementById('ls-hide-gift'),
      hasLevel: !!document.getElementById('ls-min-level'),
    };
  })()`);
  check('屏蔽面板可打开且项齐全', out.filter.open && out.filter.hasWordInput && out.filter.hasEnter && out.filter.hasGift && out.filter.hasLevel, out.filter);

  // 加关键词 → 新弹幕被过滤
  await js(`(() => {
    const inp = document.getElementById('ls-word-input');
    inp.value = '屏蔽';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  out.word = await js(`document.querySelectorAll('#ls-filter-pop .ls-word').length`);
  check('关键词已添加', out.word >= 1, out.word);

  // 直接往渲染层发一条命中屏蔽词的弹幕（走和真实弹幕相同的通道）
  win.webContents.send('live-danmaku', {
    type: 'danmaku', user: '测试用户', text: '屏蔽关键词测试', level: 3, medal: {},
  });
  await sleep(600);
  out.blocked = await js(`[...document.querySelectorAll('#live-dm-list .ls-row')]
    .filter((r) => r.textContent.indexOf('屏蔽关键词测试') >= 0).length`);
  check('命中关键词的弹幕被拦下', out.blocked === 0, out.blocked);

  // 对照：换一个不含关键词的文本，应该能进来
  win.webContents.send('live-danmaku', {
    type: 'danmaku', user: '测试用户', text: '正常弹幕可以通过', level: 3, medal: {},
  });
  await sleep(600);
  out.passed = await js(`[...document.querySelectorAll('#live-dm-list .ls-row')]
    .filter((r) => r.textContent.indexOf('正常弹幕可以通过') >= 0).length`);
  check('不含关键词的弹幕能通过', out.passed === 1, out.passed);

  await win.webContents.capturePage();
  await sleep(200);
  fs.writeFileSync(path.join(OUT, 'live-03-filter.png'), (await win.webContents.capturePage()).toPNG());

  fs.writeFileSync(path.join(OUT, 'live-room.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, layout: out.layout, row: out.row }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

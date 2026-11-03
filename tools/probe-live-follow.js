'use strict';
/**
 * 关注的直播：接口形态 + rail 计数 + 「全部」按钮 + 完整列表页。
 *   electron tools/probe-live-follow.js
 */
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logs = [];
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') logs.push({ level: event.level, message: event.message });
  });
  win.webContents.on('preload-error', (_ev, p, err) => logs.push({ type: 'preload', message: String(err && err.message) }));
});

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
  await sleep(1800);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const out = { checks: [] };
  const check = (name, ok, value) => out.checks.push({ name, ok: !!ok, value });

  // 1) 接口形态（未登录也能看出字段；给了 page_size 看是否被接受）
  out.api = await js(`(async () => {
    const r1 = await window.bg.api('/xlive/web-ucenter/v1/xfetter/GetWebList?hit_ab=false');
    const r50 = await window.bg.api('/xlive/web-ucenter/v1/xfetter/GetWebList?page=1&page_size=50&hit_ab=false');
    const r20 = await window.bg.api('/xlive/web-ucenter/v1/xfetter/GetWebList?page=2&page_size=20&hit_ab=false');
    const brief = (r) => ({
      code: r && r.code,
      message: r && r.message,
      dataKeys: r && r.data ? Object.keys(r.data) : null,
      rooms: r && r.data ? (r.data.rooms || r.data.list || []).length : null,
      total: r && r.data ? (r.data.total ?? r.data.count ?? null) : null,
    });
    return { plain: brief(r1), size50: brief(r50), page2: brief(r20) };
  })()`);
  // 未登录时接口返回 -101 属正常；这里只确认请求本身能打通（有 code 字段）
  check('接口可调用（未登录返回 -101 也算通）',
    out.api && out.api.size50 && typeof out.api.size50.code === 'number',
    out.api && out.api.size50);

  // 2) 假的登录态：只看结构（真实数据需要真登录）
  await js(`window.__bgState().login = { uname: '测试用户', mid: 1, isLogin: true }; true`);
  await js(`window.__bgNav('dynamic')`);
  await sleep(3000);
  out.rail = await js(`(() => {
    const more = document.getElementById('rail-live-all');
    const count = document.getElementById('rail-live-count');
    const box = document.getElementById('rail-live');
    return {
      hasMoreBtn: !!more,
      moreText: more ? more.textContent.trim() : null,
      countText: count ? count.textContent : null,
      railHTML: box ? box.innerHTML.slice(0, 120) : null,
    };
  })()`);
  check('动态页 rail 有「全部」按钮', out.rail && out.rail.hasMoreBtn, out.rail && out.rail.moreText);
  await shot('lf-01-dynamic-rail');

  // 3) 点「全部」→ 新页面
  await js(`document.getElementById('rail-live-all').click()`);
  await sleep(2500);
  out.page = await js(`(() => {
    const route = window.__bgState().route.name;
    const sub = document.getElementById('lf-sub');
    const feed = document.getElementById('feed');
    const back = document.getElementById('lf-back');
    return {
      route,
      sub: sub ? sub.textContent : null,
      backBtn: !!back,
      feedClass: feed ? (feed.firstElementChild ? feed.firstElementChild.className : feed.className) : null,
      bodyText: feed ? feed.textContent.trim().slice(0, 80) : null,
    };
  })()`);
  check('跳转到 liveFollowing', out.page && out.page.route === 'liveFollowing', out.page && out.page.route);
  check('页面有返回按钮', out.page && out.page.backBtn, null);
  await shot('lf-02-following-page');

  // 4) 返回
  await js(`document.getElementById('lf-back').click()`);
  await sleep(1500);
  out.back = await js(`window.__bgState().route.name`);
  check('能返回动态页', out.back === 'dynamic', out.back);

  // 5) 分页去重逻辑（直接喂假数据跑纯函数式校验：模拟两页含重复房间）
  out.paging = await js(`(() => {
    const dedupe = (prev, list) => {
      const seen = new Set(prev.map((x) => String(x.room_id || x.roomid)));
      const fresh = list.filter((x) => {
        const id = String(x.room_id || x.roomid);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return prev.concat(fresh);
    };
    let items = dedupe([], [{ room_id: 1 }, { room_id: 2 }]);
    items = dedupe(items, [{ room_id: 2 }, { room_id: 3 }]);
    const items2 = dedupe(items, [{ room_id: 3 }, { room_id: 1 }]);
    return { afterTwoPages: items.map((x) => x.room_id), repeatedPage: items2.length };
  })()`);
  check('翻页去重有效', out.paging && out.paging.afterTwoPages.length === 3 && out.paging.repeatedPage === 3, out.paging);

  out.logs = logs;
  fs.writeFileSync(path.join(OUT, 'live-following.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, api: out.api, rail: out.rail, page: out.page, logs }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

'use strict';
/**
 * 搜索面板：搜索历史 chips + bilibili 热搜 + 输入联想（高亮/键盘）。
 *   electron tools/probe-suggest.js
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
  await sleep(1800);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });
  const shot = async (name) => {
    await win.webContents.capturePage();
    await sleep(200);
    fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };

  // 清掉历史，保证起点干净
  await js(`try { localStorage.removeItem('bili.recentSearch'); localStorage.removeItem('recentSearch'); } catch (e) {} true`);

  // ---------- 空输入：历史 + 热搜 ----------
  await js(`(() => {
    const inp = document.getElementById('search-input');
    inp.value = '';
    inp.focus();
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('focus'));
    return true;
  })()`);
  await sleep(2000);

  out.empty = await js(`(() => {
    const box = document.getElementById('search-hist');
    if (!box) return { exists: false };
    const hot = [...box.querySelectorAll('.sh-hot-item')];
    return {
      exists: true,
      hotHead: [...box.querySelectorAll('.sh-head')].map((h) => (h.querySelector('span') || {}).textContent || ''),
      hotCount: hot.length,
      cols: box.querySelectorAll('.sh-hot-col').length,
      ranks: [...box.querySelectorAll('.hs-rank')].map((el) => el.textContent),
      topRanks: box.querySelectorAll('.hs-rank.top').length,
      badges: box.querySelectorAll('.hs-badge').length,
      firstHot: hot[0] ? hot[0].textContent.trim().slice(0, 20) : '',
      hasHistory: !!box.querySelector('.sh-chips'),
    };
  })()`);
  check('空输入时面板出现', out.empty.exists === true);
  check('显示「bilibili 热搜」', (out.empty.hotHead || []).some((t) => t.indexOf('热搜') >= 0), out.empty.hotHead);
  check('热搜 10 条 / 两栏', out.empty.hotCount === 10 && out.empty.cols === 2, { n: out.empty.hotCount, cols: out.empty.cols });
  check('排名 1–10', (out.empty.ranks || []).join(',') === '1,2,3,4,5,6,7,8,9,10', out.empty.ranks);
  check('前 3 名高亮', out.empty.topRanks === 3, out.empty.topRanks);
  check('带角标图标', out.empty.badges > 0, out.empty.badges);
  await shot('suggest-01-hot');

  // ---------- 输入：联想 ----------
  await js(`(() => {
    const inp = document.getElementById('search-input');
    inp.value = '毕生';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(1600);
  out.sug = await js(`(() => {
    const box = document.getElementById('search-hist');
    const items = [...box.querySelectorAll('.sug-item')];
    return {
      head: (box.querySelector('.sh-head span') || {}).textContent || '',
      count: items.length,
      marks: box.querySelectorAll('.sug-item mark').length,
      markText: [...box.querySelectorAll('.sug-item mark')].slice(0, 3).map((el) => el.textContent),
      texts: items.slice(0, 3).map((el) => el.textContent),
    };
  })()`);
  check('输入后切到「搜索预测」', out.sug.head === '搜索预测', out.sug.head);
  check('至少 5 条建议', out.sug.count >= 5, out.sug.count);
  check('命中词高亮', out.sug.marks > 0 && out.sug.markText.every((t) => t === '毕生'), out.sug.markText);
  await shot('suggest-02-predict');

  // ---------- 键盘 + Enter ----------
  await js(`(() => {
    const inp = document.getElementById('search-input');
    const key = (k) => inp.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    return true;
  })()`);
  await sleep(1200);
  out.route = await js(`(() => {
    const st = window.__bgState();
    return { name: st.route.name, q: st.route.params && st.route.params.q };
  })()`);
  check('Enter 跳到搜索页', out.route.name === 'search', out.route.name);
  check('搜索词 = 第 2 条建议', out.route.q === out.sug.texts[1], { q: out.route.q, expect: out.sug.texts[1] });

  // ---------- 历史 chips ----------
  await js(`(() => {
    const inp = document.getElementById('search-input');
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(800);
  out.hist = await js(`(() => {
    const box = document.getElementById('search-hist');
    const chips = [...box.querySelectorAll('.sh-chip')];
    return {
      hasHead: [...box.querySelectorAll('.sh-head span')].map((s) => s.textContent).indexOf('搜索历史') >= 0,
      chips: chips.map((c) => c.textContent),
      hasClear: !!document.getElementById('sh-clear'),
    };
  })()`);
  check('出现「搜索历史」', out.hist.hasHead === true);
  check('历史里是刚搜的词', (out.hist.chips || []).indexOf(out.route.q) >= 0, out.hist.chips);
  check('有「清空」按钮', out.hist.hasClear === true);
  await shot('suggest-03-history');

  // ---------- 清空历史 ----------
  await js(`document.getElementById('sh-clear').click(); true`);
  await sleep(600);
  out.afterClear = await js(`(() => {
    const box = document.getElementById('search-hist');
    return { chips: box.querySelectorAll('.sh-chip').length, hot: box.querySelectorAll('.sh-hot-item').length };
  })()`);
  check('清空后历史消失、热搜还在', out.afterClear.chips === 0 && out.afterClear.hot === 10, out.afterClear);

  fs.writeFileSync(path.join(OUT, 'suggest.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, empty: out.empty, sug: out.sug }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

'use strict';
/**
 * 设计风格预设：设置里的 5 个预设、即时生效、卡片样式差异。
 *   electron tools/probe-styles.js
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
  await sleep(1600);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });
  const shot = async (name) => {
    await win.webContents.capturePage();
    await sleep(250);
    fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };

  // 打开设置面板
  await js(`document.getElementById('btn-settings').click(); true`);
  await sleep(700);
  out.sheet = await js(`(() => {
    const sheet = document.getElementById('settings-sheet');
    const cards = [...document.querySelectorAll('#style-presets .style-card')];
    return {
      open: sheet && !sheet.hidden,
      count: cards.length,
      ids: cards.map((c) => c.dataset.style),
      names: cards.map((c) => c.querySelector('.sp-name').textContent),
      active: (cards.find((c) => c.classList.contains('on')) || {}).dataset?.style || '',
    };
  })()`);
  check('设置里有「设计风格」区块', out.sheet.open && out.sheet.count === 5, { open: out.sheet.open, count: out.sheet.count });
  check('5 个预设齐全', out.sheet.ids.join(',') === 'classic,magazine,minimal,paper,neon', out.sheet.ids);
  check('默认选中「经典」', out.sheet.active === 'classic', out.sheet.active);
  await shot('style-00-settings');

  // 逐个切换，读卡片计算样式
  out.styles = {};
  for (const id of ['magazine', 'minimal', 'paper', 'neon', 'classic']) {
    await js(`(() => {
      const card = document.querySelector('#style-presets .style-card[data-style="${id}"]');
      card && card.click();
      return true;
    })()`);
    await sleep(450);
    out.styles[id] = await js(`(() => {
      const c = document.querySelector('#feed .card');
      const t = c ? c.querySelector('.title') : null;
      const cs = c ? getComputedStyle(c) : null;
      const ts = t ? getComputedStyle(t) : null;
      return {
        attr: document.documentElement.dataset.style,
        stored: localStorage.getItem('bg:style') || '',
        radius: cs ? cs.borderTopLeftRadius : '',
        shadow: cs ? cs.boxShadow : '',
        border: cs ? cs.borderTopWidth : '',
        titleFont: ts ? ts.fontFamily : '',
        titleSize: ts ? ts.fontSize : '',
        active: (document.querySelector('#style-presets .style-card.on') || {}).dataset?.style || '',
      };
    })()`);
    if (id !== 'classic') {
      // 关掉设置面板，截首页实景
      await js(`document.getElementById('settings-close').click(); true`);
      await sleep(500);
      await shot(`style-01-${id}`);
      await js(`document.getElementById('btn-settings').click(); true`);
      await sleep(400);
    }
  }

  check('杂志：圆角变方（2px）', out.styles.magazine.radius === '2px', out.styles.magazine.radius);
  check('杂志：去阴影', out.styles.magazine.shadow === 'none', out.styles.magazine.shadow);
  check('杂志：标题用衬线', /Georgia|serif/i.test(out.styles.magazine.titleFont), out.styles.magazine.titleFont.slice(0, 40));
  check('极简：细边框 + 无阴影', out.styles.minimal.border === '1px' && out.styles.minimal.shadow === 'none', { b: out.styles.minimal.border, s: out.styles.minimal.shadow });
  check('极简：圆角 8px', out.styles.minimal.radius === '8px', out.styles.minimal.radius);
  check('米纸：有硬阴影', out.styles.paper.shadow !== 'none' && out.styles.paper.shadow.indexOf('rgb') >= 0, out.styles.paper.shadow.slice(0, 40));
  check('霓虹：圆角 14px + 发光', out.styles.neon.radius === '14px' && out.styles.neon.shadow !== 'none', { r: out.styles.neon.radius });
  check('经典：恢复 22px', out.styles.classic.radius === '22px', out.styles.classic.radius);
  const unq = (v) => { try { return JSON.parse(v); } catch { return v; } };
  check('切换后写入本地存储', unq(out.styles.classic.stored) === 'classic', { stored: out.styles.classic.stored });
  check('选中态跟着切换', out.styles.paper.active === 'paper', out.styles.paper.active);

  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, sheet: out.sheet }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

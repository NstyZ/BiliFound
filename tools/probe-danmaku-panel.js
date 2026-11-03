'use strict';
/**
 * 本轮改动的验收：齿轮图标 / 默认画质 / 更新地址默认值 / 视频页弹幕设置面板。
 *   electron tools/probe-danmaku-panel.js
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
  await sleep(1800);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const out = { checks: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });

  // 1) 齿轮图标：设置按钮里应是圆 + 8 根齿
  out.gear = await js(`(() => {
    const settingsBtn = document.getElementById('btn-settings');
    const paletteBtn = document.getElementById('btn-palette');
    const cog = settingsBtn && settingsBtn.querySelector('svg path');
    const pal = paletteBtn && paletteBtn.querySelectorAll('svg path');
    return {
      cogCurves: cog ? (cog.getAttribute('d').match(/[aA]/g) || []).length : 0,
      cogHasRoundJoin: cog ? cog.getAttribute('stroke-linejoin') === 'round' : false,
      cogStroke: cog ? Number(cog.getAttribute('stroke-width')) : 0,
      settingsCircles: settingsBtn.querySelectorAll('svg circle').length,
      palettePaths: pal ? pal.length : 0,
    };
  })()`);
  check('偏好设置是齿轮图标（多段曲线 + 圆角描边）',
    out.gear.cogCurves >= 8 && out.gear.cogHasRoundJoin && out.gear.settingsCircles === 1, out.gear);
  check('命令面板图标未被误改', out.gear.palettePaths === 2, out.gear.palettePaths);

  // 2) 设置面板：默认画质下拉 + 更新地址默认值
  await js(`document.getElementById('btn-settings').click(); true`);
  await sleep(700);
  out.settings = await js(`(() => {
    const q = document.getElementById('set-quality');
    const feed = document.getElementById('up-feed');
    return {
      qualityExists: !!q,
      qualityValue: q ? q.value : '',
      qualityOptions: q ? q.options.length : 0,
      feedValue: feed ? feed.value : '',
    };
  })()`);
  check('默认画质下拉存在且有 9 档', out.settings.qualityExists && out.settings.qualityOptions === 9, out.settings.qualityOptions);
  check('更新地址默认填 GitHub 仓库', out.settings.feedValue.includes('github.com/NstyZ/BiliFound'), out.settings.feedValue);

  // 3) 改默认画质 → 落盘
  await js(`(() => {
    const q = document.getElementById('set-quality');
    q.value = '64';
    q.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(700);
  out.persist = await js(`window.__bgState().settings.defaultQuality`);
  check('默认画质选择被记住（720P=64）', Number(out.persist) === 64, out.persist);
  await js(`document.getElementById('settings-close').click(); true`);
  await sleep(400);

  // 4) 打开一个视频页，看弹幕设置按钮/面板
  await js("window.__bgNav('video', { bvid: 'BV1GJ411x7h7' }); true");
  await sleep(6000);
  out.panel = await js(`(() => {
    const btn = document.getElementById('ctl-dm-set');
    return {
      btn: !!btn,
      panel: !!document.getElementById('dm-panel'),
      hidden: (document.getElementById('dm-panel') || {}).hidden,
      sliders: document.querySelectorAll('#dm-panel .dmp-slider').length,
      checks: document.querySelectorAll('#dm-panel .dmp-check').length,
      types: document.querySelectorAll('#dm-panel .dmp-type').length,
    };
  })()`);
  check('视频页有「弹幕设置」按钮', out.panel.btn === true);
  check('面板默认隐藏，含 3 类过滤 + 3 复选 + 4 滑块',
    out.panel.panel && out.panel.hidden === true && out.panel.types === 3 && out.panel.checks === 3 && out.panel.sliders === 4, out.panel);

  // 5) 打开面板 + 操作一个开关，确认写进设置
  await js(`document.getElementById('ctl-dm-set').click(); true`);
  await sleep(500);
  out.open = await js(`!document.getElementById('dm-panel').hidden`);
  check('点击后面板展开', out.open === true);

  await js(`(() => {
    const c = document.getElementById('dmp-smart');
    c.checked = true;
    c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  out.smart = await js(`window.__bgState().settings.dmSmart`);
  check('「智能防挡弹幕」开关写进设置', out.smart === true, out.smart);

  // 6) 滑块改动
  await js(`(() => {
    const el = document.getElementById('dmp-opacity');
    el.value = '60';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  out.opacity = await js(`[window.__bgState().settings.danmakuOpacity, document.getElementById('dmp-opacity-v').textContent]`);
  check('不透明度滑块生效并回显 60%', Math.abs(Number(out.opacity[0]) - 0.6) < 0.01 && String(out.opacity[1]).includes('60'), out.opacity);

  // 7) 屏蔽词保存
  await js(`(() => {
    document.getElementById('dmp-words').click();
    const ta = document.getElementById('dmp-words-input');
    ta.value = '剧透, 打卡';
    document.getElementById('dmp-words-save').click();
    return true;
  })()`);
  await sleep(600);
  out.words = await js(`window.__bgState().settings.dmWords`);
  check('屏蔽词保存为逗号分隔文本', String(out.words).includes('剧透') && String(out.words).includes('打卡'), out.words);

  await win.webContents.capturePage();
  await sleep(250);
  fs.writeFileSync(path.join(OUT, 'dm-panel.png'), (await win.webContents.capturePage()).toPNG());

  fs.writeFileSync(path.join(OUT, 'danmaku-panel.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks, gear: out.gear, settings: out.settings }, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

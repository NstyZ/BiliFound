'use strict';
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
  for (let i = 0; i < 120 && !win; i += 1) { win = BrowserWindow.getAllWindows()[0] || null; if (!win) await sleep(100); }
  await new Promise((r) => { if (!win.webContents.isLoading()) return r(); win.webContents.once('did-finish-load', r); setTimeout(r, 15000); });
  await sleep(2500);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const dbg = (tag) => js(`(() => {
    const st = (window.__bgState ? window.__bgState() : { feeds: {} }).feeds || {};
    const h = document.querySelector('#hero .hero-slide.on h2');
    return {
      tag: ${JSON.stringify(tag)},
      route: (window.__bgState ? window.__bgState().route.name : '?'),
      homeItems: st.home ? st.home.items.length : -1,
      hero: h ? h.textContent : '',
      cards: document.querySelectorAll('#feed-grid .card').length,
      feedHTML: (document.getElementById('feed') || {}).innerHTML ? document.getElementById('feed').innerHTML.length : -1,
    };
  })()`);

  const steps = [];
  await js(`window.__bgNav('home'); true`);
  await sleep(6000);
  steps.push(await dbg('home-first'));

  await js(`window.__bgNav('hot'); true`);
  await sleep(4000);
  steps.push(await dbg('hot'));

  await js(`window.__bgNav('home'); true`);
  await sleep(600);
  steps.push(await dbg('home-back-600'));
  await sleep(2500);
  steps.push(await dbg('home-back-3000'));

  fs.writeFileSync(path.join(OUT, 'home-cache-dbg.json'), JSON.stringify(steps, null, 2), 'utf8');
  console.log(JSON.stringify(steps, null, 2));
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });

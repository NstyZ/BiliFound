'use strict';
/**
 * 应用内更新端到端验证：本机起一个静态服务器扮演「更新源」。
 *   electron tools/probe-update.js
 * 覆盖：清单解析、版本比较、404/坏 JSON、下载 + sha256 校验、校验失败自动删文件。
 */
const { app, BrowserWindow, desktopCapturer, screen, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 假的「新版本安装包」：1 MB 随机内容
const PAYLOAD = crypto.randomBytes(1024 * 1024);
const PAYLOAD_SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const WRONG_SHA = crypto.createHash('sha256').update('nope').digest('hex');

require(path.join(ROOT, 'main.js'));

let BASE = '';

const manifest = (over = {}) => JSON.stringify({
  version: '999.0.0',
  notes: '这是一条测试更新说明：\n· 修复了某个问题\n· 新增了某个功能',
  publishedAt: '2026-12-01',
  url: `${BASE}/BiliFound-999.0.0-Setup-x64.exe`,
  size: PAYLOAD.length,
  sha256: PAYLOAD_SHA,
  ...over,
});

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/latest.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(manifest());
      } else if (url === '/same.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(manifest({ version: app.getVersion() }));
      } else if (url === '/bad.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{not json');
      } else if (url === '/badsha.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(manifest({ sha256: WRONG_SHA }));
      } else if (url === '/BiliFound-999.0.0-Setup-x64.exe') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': PAYLOAD.length,
        });
        res.end(PAYLOAD);
      } else {
        res.writeHead(404).end('nope');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      BASE = `http://127.0.0.1:${server.address().port}`;
      resolve(server);
    });
  });
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

async function run() {
  const server = await startServer();
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

  // 计数下载进度事件
  await js(`window.__upProgress = 0; window.bg.on('update-progress', () => { window.__upProgress += 1; }); true`);

  await js(`window.bg.setSettings({ updateFeed: '${BASE}/latest.json' })`);
  out.version = await js(`window.bg.updateInfo()`);
  check('能读到当前版本', out.version && /^\d+\.\d+\.\d+$/.test(out.version.version), out.version);

  // 1) 正常清单
  out.check = await js(`window.bg.checkUpdate({ force: true })`);
  check('识别到新版本 999.0.0', out.check && out.check.ok && out.check.newer === true && out.check.latest === '999.0.0', out.check && { latest: out.check.latest, newer: out.check.newer });
  check('解析出下载地址与大小', out.check && out.check.asset && /Setup-x64\.exe$/.test(out.check.asset.url) && out.check.asset.size === PAYLOAD.length, out.check && out.check.asset);

  // 2) 同版本不算新
  await js(`window.bg.setSettings({ updateFeed: '${BASE}/same.json' })`);
  out.same = await js(`window.bg.checkUpdate({ force: true })`);
  check('同版本不提示更新', out.same && out.same.ok && out.same.newer === false, out.same && { latest: out.same.latest, newer: out.same.newer });

  // 3) 坏 JSON / 404
  await js(`window.bg.setSettings({ updateFeed: '${BASE}/bad.json' })`);
  out.bad = await js(`window.bg.checkUpdate({ force: true })`);
  check('坏清单被拒绝', out.bad && out.bad.ok === false, out.bad && out.bad.message);
  await js(`window.bg.setSettings({ updateFeed: '${BASE}/nope.json' })`);
  out.missing = await js(`window.bg.checkUpdate({ force: true })`);
  check('404 被拒绝', out.missing && out.missing.ok === false, out.missing && out.missing.message);

  // 4) 下载 + 校验
  await js(`window.bg.setSettings({ updateFeed: '${BASE}/latest.json' })`);
  await js(`window.bg.checkUpdate({ force: true })`);
  out.download = await js(`(async () => {
    const r = await window.bg.checkUpdate({ force: true });
    return await window.bg.downloadUpdate(r.asset);
  })()`);
  const exists = out.download && out.download.ok && fs.existsSync(out.download.file);
  check('下载成功并落盘', exists, out.download && { file: out.download.file, size: out.download.size });
  check('sha256 与源一致', out.download && out.download.sha256 === PAYLOAD_SHA, out.download && out.download.sha256);
  out.progressEvents = await js(`window.__upProgress`);
  check('有下载进度事件', out.progressEvents > 0, out.progressEvents);
  if (exists) {
    const onDisk = fs.readFileSync(out.download.file);
    check('落盘内容与源逐字节一致', Buffer.compare(onDisk, PAYLOAD) === 0, { bytes: onDisk.length });
  }

  // 5) sha 不匹配 → 拒绝并删除
  await js(`window.bg.setSettings({ updateFeed: '${BASE}/badsha.json' })`);
  out.badSha = await js(`(async () => {
    const r = await window.bg.checkUpdate({ force: true });
    return await window.bg.downloadUpdate(r.asset);
  })()`);
  check('sha 不匹配时拒绝', out.badSha && out.badSha.ok === false, out.badSha && out.badSha.message);

  // 6) 安装入口：给不存在的路径应报错（不会真跑安装器）
  out.installMissing = await js(`window.bg.installUpdate({ file: 'C:\\\\Temp\\\\nope\\\\nothing.exe', quit: false })`);
  check('安装入口对缺失文件报错', out.installMissing && out.installMissing.ok === false, out.installMissing && out.installMissing.message);

  // 6.5) 发现新版本时的 toast
  win.webContents.send('update-available', { version: '999.0.0', notes: '' });
  await sleep(600);
  out.toast = await js(`(() => { const s = document.getElementById('toast-stack'); return s ? s.textContent : ''; })()`);
  check('发现新版本会弹提示', /发现新版本 v999\.0\.0/.test(out.toast || ''), out.toast);

  // 7) 设置面板截图（把 feed 指回正常清单，展示「发现新版本」）
  await js(`window.bg.setSettings({ updateFeed: '${BASE}/latest.json' })`);
  win.show();
  win.setContentSize(1180, 850);
  await sleep(600);
  await js(`document.getElementById('settings-sheet') && (document.getElementById('settings-sheet').hidden = false); true`);
  await sleep(700);
  await js(`(() => { const b = document.querySelector('#settings-sheet .sheet-body'); if (b) b.scrollTop = b.scrollHeight; return true; })()`);
  await sleep(400);
  await js(`document.getElementById('btn-check-update').click()`);
  await sleep(1200);
  await shot(win, 'up-01-settings');
  out.panel = await js(`(() => ({
    current: document.getElementById('up-current')?.textContent,
    status: (document.getElementById('up-status')?.textContent || '').slice(0, 120),
    installVisible: !document.getElementById('btn-install-update')?.hidden,
  }))()`);
  check('设置面板显示当前版本与结果', !!(out.panel && out.panel.current && /发现新版本/.test(out.panel.status || '')), out.panel);

  // 清理下载目录
  try {
    const dir = path.join(app.getPath('temp'), 'BiliFound-update');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}

  fs.writeFileSync(path.join(OUT, 'update.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks }, null, 2));
  server.close();
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

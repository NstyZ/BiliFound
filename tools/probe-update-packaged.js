'use strict';
/**
 * 打包后的真实链路验证：
 *   1) 静默安装 1.3.0 到临时目录
 *   2) 本机起静态服务器，放一份「2.0.0」清单 + 真实安装包
 *   3) 用独立 user-data-dir 启动应用（settings 里预置 updateFeed）
 *   4) 观察服务器是否被请求、桌面是否出现「发现新版本」提示
 * 证明：打包版 app.getVersion() 是 1.3.0（2.0.0 会被判定为更新），且自动检查链路通。
 */
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'probe');
const SETUP = path.join(ROOT, 'dist-installer', 'BiliFound-1.3.0-Setup-x64.exe');
const TARGET = 'C:\\Temp\\BiliFound-130';
const PROFILE = 'C:\\Temp\\bili-130-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(ROOT, 'main.js'));

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function shot(name) {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width, height: display.size.height },
  });
  if (!sources[0]) return;
  fs.writeFileSync(path.join(OUT, `${name}.png`), sources[0].thumbnail.toPNG());
}

async function run() {
  const out = { checks: [], requests: [] };
  const check = (n, ok, v) => out.checks.push({ name: n, ok: !!ok, value: v });
  if (!fs.existsSync(SETUP)) {
    console.log('SETUP_NOT_FOUND');
    app.exit(1);
    return;
  }
  const digest = await sha256(SETUP);
  const size = fs.statSync(SETUP).size;

  // 静态服务器：清单 + 真实安装包
  let base = '';
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    out.requests.push(url);
    if (url === '/latest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        version: '2.0.0',
        notes: '打包版自动检查链路验证',
        publishedAt: '2026-12-02',
        url: `${base}/BiliFound-1.3.0-Setup-x64.exe`,
        size,
        sha256: digest,
      }));
    } else if (url === '/BiliFound-1.3.0-Setup-x64.exe') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      fs.createReadStream(SETUP).pipe(res);
    } else if (url === '/favicon.ico') {
      res.writeHead(404).end();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // 静默安装
  fs.rmSync(TARGET, { recursive: true, force: true });
  await new Promise((resolve) => {
    execFile(SETUP, ['/S', `/D=${TARGET}`], { windowsHide: true }, () => resolve());
  });
  check('1.3.0 静默安装成功', fs.existsSync(path.join(TARGET, 'BiliFound.exe')), TARGET);

  // 预置 userData：updateFeed 指向本机服务器
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(path.join(PROFILE, 'settings.json'), JSON.stringify({
    theme: 'light',
    updateFeed: `${base}/latest.json`,
    updateAutoCheck: true,
  }), 'utf8');

  // 启动打包版应用
  const child = execFile(path.join(TARGET, 'BiliFound.exe'), [`--user-data-dir=${PROFILE}`], { windowsHide: false });
  await sleep(12000);
  await shot('up-02-packaged-toast');

  check('打包版请求了更新清单', out.requests.includes('/latest.json'), out.requests.slice(0, 6));
  check('清单只被请求一次（6h 节流不重复）', out.requests.filter((x) => x === '/latest.json').length === 1,
    out.requests.filter((x) => x === '/latest.json').length);

  // 关掉应用并卸载
  try { child.kill(); } catch {}
  await sleep(800);
  await new Promise((resolve) => {
    const un = path.join(TARGET, 'Uninstall BiliFound.exe');
    if (!fs.existsSync(un)) return resolve();
    execFile(un, ['/S'], { windowsHide: true }, () => resolve());
  });
  await sleep(3000);
  fs.rmSync(TARGET, { recursive: true, force: true });

  fs.writeFileSync(path.join(OUT, 'update-packaged.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ failed: out.checks.filter((c) => !c.ok), checks: out.checks }, null, 2));
  server.close();
  app.exit(0);
}

app.whenReady().then(() => run().catch((e) => { console.error(e); app.exit(1); }));

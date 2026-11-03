'use strict';
/**
 * BiliFound —— 原生界面 · 液态玻璃
 * 内容来自 bilibili 公开接口（带 Cookie 的 session 请求），
 * 播放使用官方 embed 播放器（WebContentsView），不再渲染网页套壳。
 */
const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  shell,
  ipcMain,
  session,
  nativeTheme,
  dialog,
  clipboard,
  screen,
} = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const PARTITION = 'persist:bili';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// 平台 UA：B 站部分接口（playurl / 风控）会按 UA 返回不同能力
const USER_AGENT = isWin
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/* ------------------------------ 应用标识 / 数据迁移 ------------------------------ */

const PKG = require('./package.json');

function repoFromPackage() {
  const r = PKG.repository;
  const url = typeof r === 'string' ? r : (r && r.url) || '';
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  return m ? `${m[1]}/${m[2]}` : '';
}

// 仓库地址只在这里配置一次；更新源与「关于」都从这里派生
const GITHUB_REPO = repoFromPackage();
const DEFAULT_UPDATE_FEED = GITHUB_REPO
  ? `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  : '';

const APP_NAME = 'BiliFound';
const APP_ID = 'com.styzn.bilifound';
const LEGACY_APP_NAME = 'BiliGlass';
app.setName(APP_NAME);
// Windows 任务栏分组 / 通知归属 / 单实例识别都依赖 AppUserModelId
if (isWin) app.setAppUserModelId(APP_ID);

// 从旧版本目录迁移登录态与设置（只复制必要数据，跳过缓存）
try {
  const appData = app.getPath('appData');
  const newDir = path.join(appData, APP_NAME);
  const oldDir = path.join(appData, LEGACY_APP_NAME);
  // Windows 路径分隔符是反斜杠：正则两种都要兼容
  const SKIP = /(^|[\\/])(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|GrShaderCache|VideoDecodeStats|Shared Dictionary|blob_storage|SingletonCookie|SingletonLock|SingletonSocket)([\\/]|$)/;
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    fs.cpSync(oldDir, newDir, {
      recursive: true,
      filter: (src) => !SKIP.test(src),
    });
  }
} catch (err) {
  console.log('[bg] profile migration skipped:', err && err.message);
}

// macOS 窗口遮挡计算 bug：窗口被误判遮挡后会停止渲染（Windows 无此问题）
if (isMac) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

/* ------------------------------ 设置 ------------------------------ */

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {
  theme: 'auto',
  accent: 'pink',
  glassBlur: 30,
  density: 'comfortable',
  grain: true,
  background: { type: 'aurora', value: '', blur: 0, dim: 0.15 },
  danmakuOpacity: 1,
  danmakuSize: 20,
  danmakuSpeed: 1,
  danmakuArea: 0.5,
  autoplay: true,
  danmaku: true,
  downloadDir: '',
  // 应用内更新：清单地址（静态 JSON），留空则不检查
  updateFeed: '',
  updateAutoCheck: true,
  updateSkipped: '',
  lastUpdateCheck: 0,
};
try {
  Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')));
} catch {}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings));
  } catch {}
}

/* ------------------------------ 下载目录 ------------------------------ */

// Windows 版：默认落到「下载\BiliFound」，用户可在设置里改目录（settings.downloadDir）
const DEFAULT_DOWNLOAD_DIR = () => path.join(app.getPath('downloads'), 'BiliFound');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dir)) return true;
  } catch {}
  return false;
}

function getDownloadDir() {
  const custom = String(settings.downloadDir || '').trim();
  if (custom && ensureDir(custom)) return custom;
  const def = DEFAULT_DOWNLOAD_DIR();
  if (ensureDir(def)) return def;
  return app.getPath('downloads');
}

/* ---- Windows 文件名规则：不能出现 \/:*?"<>|，结尾不能是点或空格，保留名要避开 ---- */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeFilename(name, maxLen = 120) {
  let out = String(name || 'bilibili')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 去掉结尾的点与空格（资源管理器无法创建）
  out = out.replace(/[. ]+$/g, '');
  if (!out) out = 'bilibili';
  if (WIN_RESERVED.test(out.replace(/\.[^.]+$/, ''))) out = `_${out}`;
  if (out.length > maxLen) {
    const ext = path.extname(out).slice(0, 12);
    out = out.slice(0, Math.max(1, maxLen - ext.length)).replace(/[. ]+$/g, '') + ext;
  }
  return out;
}

/* 落盘时的改名：Windows 上目标被占用会 EBUSY/EPERM，退化成复制再删 */
function moveIntoPlace(from, to) {
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    if (!isWin) throw err;
    fs.copyFileSync(from, to);
    try { fs.unlinkSync(from); } catch {}
  }
}

let pendingDownloadName = null;

/* ------------------------------ 会话 ------------------------------ */

function setupSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(USER_AGENT);

  // 图片防盗链：补 Referer
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.hdslb.com/*', '*://*.bilivideo.com/*'] }, (details, cb) => {
    const headers = details.requestHeaders;
    if (!headers.Referer && !headers.referer) headers.Referer = 'https://www.bilibili.com/';
    cb({ requestHeaders: headers });
  });

  const allow = new Set([
    'fullscreen', 'media', 'mediaKeySystem', 'notifications',
    'clipboard-sanitized-write', 'pointerLock',
  ]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allow.has(permission)));

  ses.on('will-download', (_event, item) => {
    const dir = getDownloadDir();
    const baseName = sanitizeFilename(pendingDownloadName || item.getFilename() || 'bilibili_download');
    pendingDownloadName = null;
    let savePath = uniquePath(dir, baseName);
    item.setSavePath(savePath);
    const notify = (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        win.webContents.send('download-toast', {
          state,
          name: path.basename(savePath),
          received: item.getReceivedBytes(),
          total: item.getTotalBytes(),
          path: savePath,
        });
      }
    };
    notify('started');
    item.on('updated', () => notify('progress'));
    item.once('done', (_e, state) => notify(state === 'completed' ? 'done' : 'failed'));
  });

  // 预热会话：拿到 buvid 等基础 Cookie，提升接口可用性
  ses.fetch('https://www.bilibili.com/', { headers: { 'User-Agent': USER_AGENT } }).catch(() => {});
}

/* ------------------------------ 工具 ------------------------------ */

function sendToWin(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* --------------------------- WBI 签名 / 弹幕 --------------------------- */

const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

let wbiKeys = null;
let wbiKeysAt = 0;

async function getWbiKeys(force = false) {
  if (!force && wbiKeys && Date.now() - wbiKeysAt < 3600 * 1000) return wbiKeys;
  const nav = await apiFetch('/x/web-interface/nav');
  const img = nav && nav.data && nav.data.wbi_img && nav.data.wbi_img.img_url;
  const sub = nav && nav.data && nav.data.wbi_img && nav.data.wbi_img.sub_url;
  if (!img || !sub) return null;
  const key = (u) => u.split('/').pop().split('.')[0];
  wbiKeys = { imgKey: key(img), subKey: key(sub) };
  wbiKeysAt = Date.now();
  return wbiKeys;
}

function mixinKey(keys) {
  const raw = keys.imgKey + keys.subKey;
  let out = '';
  for (const i of MIXIN_TAB) out += raw[i] || '';
  return out.slice(0, 32);
}

function encWbi(params, key) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(p)
    .sort()
    .map((k) => {
      const v = String(p[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + key).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

async function apiFetchWbi(endpoint, params) {
  const keys = await getWbiKeys().catch(() => null);
  if (!keys) throw new Error('no wbi keys');
  const q = encWbi(params || {}, mixinKey(keys));
  return apiFetch(`${endpoint}?${q}`);
}

async function apiPost(endpoint, form) {
  const ses = session.fromPartition(PARTITION);
  let csrf = '';
  try {
    const cookies = await ses.cookies.get({ name: 'bili_jct' });
    csrf = (cookies && cookies[0] && cookies[0].value) || '';
  } catch {}
  if (!csrf) return { code: -101, message: '未登录' };
  const body = new URLSearchParams({ ...form, csrf }).toString();
  const res = await ses.fetch(hostFor(endpoint) + endpoint, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, message: 'invalid json' };
  }
}

async function apiPostJson(endpoint, body) {
  const ses = session.fromPartition(PARTITION);
  let csrf = '';
  try {
    const cookies = await ses.cookies.get({ name: 'bili_jct' });
    csrf = (cookies && cookies[0] && cookies[0].value) || '';
  } catch {}
  if (!csrf) return { code: -101, message: '未登录' };
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await ses.fetch(`${hostFor(endpoint)}${endpoint}${sep}csrf=${encodeURIComponent(csrf)}`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { code: -1, message: 'invalid json', raw: text.slice(0, 120) }; }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function fetchDanmaku(cid) {
  const ses = session.fromPartition(PARTITION);
  const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`;
  const res = await ses.fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
    },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let xml = '';
  const tryText = (b) => b.toString('utf8');
  const attempts = [
    () => zlib.inflateRawSync(buf).toString('utf8'),
    () => zlib.inflateSync(buf).toString('utf8'),
    () => zlib.gunzipSync(buf).toString('utf8'),
    () => tryText(buf),
  ];
  for (const fn of attempts) {
    try {
      const t = fn();
      if (t && t.includes('<d ')) { xml = t; break; }
    } catch {}
  }
  if (!xml) return { ok: false, count: 0, list: [] };
  const list = [];
  const re = /<d p="([^"]*)"[^>]*>([^<]*)<\/d>/g;
  let m;
  while ((m = re.exec(xml))) {
    const parts = m[1].split(',');
    list.push({
      time: Number(parts[0]) || 0,
      mode: Number(parts[1]) || 1,
      color: Number(parts[3]) || 16777215,
      text: decodeEntities(m[2]),
    });
    if (list.length >= 800) break;
  }
  list.sort((a, b) => a.time - b.time);
  return { ok: true, count: list.length, list };
}

function hostFor(endpoint) {
  // 完整 URL 直接使用
  if (/^https?:\/\//i.test(endpoint)) return '';
  // 私信 / 会话在 api.vc.bilibili.com
  if (endpoint.startsWith('/session_svr/') || endpoint.startsWith('/svr_sync/') || endpoint.startsWith('/web_im/')) {
    return 'https://api.vc.bilibili.com';
  }
  // 直播相关接口在 api.live.bilibili.com
  if (endpoint.startsWith('/xlive/') || endpoint.startsWith('/room/') || endpoint.startsWith('/msg/')) {
    return 'https://api.live.bilibili.com';
  }
  return 'https://api.bilibili.com';
}

async function apiFetch(endpoint) {
  const ses = session.fromPartition(PARTITION);
  const url = hostFor(endpoint) + endpoint;
  const res = await ses.fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
      Accept: 'application/json, text/plain, */*',
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, message: 'invalid json' };
  }
}

/* ------------------------------ 窗口 ------------------------------ */

function iconPath() {
  // Windows 优先用 .ico（任务栏/标题栏/资源管理器都认它），mac 用 png。
  // assets/ 是随包分发的副本（electron-builder 会把 buildResources 目录排除在应用外，
  // 所以打包后只有 assets/ 里的图标可用）；build/ 是开发目录。
  const candidates = isWin
    ? ['icon.ico', 'icon.png']
    : ['icon.png', 'icon.ico'];
  for (const dir of ['assets', 'build']) {
    for (const name of candidates) {
      const p = path.join(__dirname, dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function baseWindowOptions() {
  const opts = {
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#eef1f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };
  if (isMac) {
    opts.titleBarStyle = 'hiddenInset';
    opts.trafficLightPosition = { x: 26, y: 31 };
  } else {
    // Windows：无边框自绘窗口，标题栏按钮由渲染层画（工具栏右侧）
    opts.frame = false;
    opts.thickFrame = true;
    opts.roundedCorners = true;
    opts.autoHideMenuBar = true;
  }
  const icon = iconPath();
  if (icon) opts.icon = icon;
  return opts;
}

/* 窗口位置恢复：显示器拔插 / 分辨率变化后，别把窗口丢到屏幕外 */
function clampToDisplay(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;
  try {
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(Math.max(bounds.width || 1360, 980), area.width);
    const height = Math.min(Math.max(bounds.height || 880, 620), area.height);
    // 至少留 80px 在可视区内，否则居中
    const visibleX = Math.max(area.x - width + 80, Math.min(bounds.x, area.x + area.width - 80));
    const visibleY = Math.max(area.y, Math.min(bounds.y, area.y + area.height - 80));
    return { x: Math.round(visibleX), y: Math.round(visibleY), width: Math.round(width), height: Math.round(height) };
  } catch {
    return null;
  }
}

const windows = new Map(); // win.id -> { win, player, web }

function createShellWindow() {
  const restored = clampToDisplay(settings.windowBounds);
  const win = new BrowserWindow({
    ...baseWindowOptions(),
    width: (restored && restored.width) || 1360,
    height: (restored && restored.height) || 880,
    ...(restored ? { x: restored.x, y: restored.y } : {}),
    minWidth: 980,
    minHeight: 620,
    title: APP_NAME,
  });

  let boundsTimer = null;
  const rememberBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      try {
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
        settings.windowBounds = win.getBounds();
        saveSettings();
      } catch {}
    }, 600);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);

  const entry = { win, player: null, web: null };
  windows.set(win.id, entry);

  // 视频全屏时，窗口尺寸变化需要同步铺满播放器
  const refit = () => {
    if (entry.videoFs) applyPlayerBounds(entry);
    if (entry.liveFs) applyLiveBounds(entry);
  };
  win.on('resize', refit);
  // enter/leave-full-screen 只有 macOS 会派发，Windows 靠 resize 兜底
  win.on('enter-full-screen', refit);
  win.on('leave-full-screen', refit);
  win.on('maximize', () => sendToWin(win, 'window-state', { maximized: true, fullscreen: win.isFullScreen() }));
  win.on('unmaximize', () => sendToWin(win, 'window-state', { maximized: false, fullscreen: win.isFullScreen() }));
  win.on('enter-html-full-screen', () => {
    if (entry.videoFs) applyPlayerBounds(entry);
    if (entry.liveFs) applyLiveBounds(entry);
  });
  win.on('leave-html-full-screen', refit);

  // 浮点缩放会让 WebContentsView 与 DOM 槽位错位：锁死缩放级别
  const wc = win.webContents;
  try {
    wc.setVisualZoomLevelLimits(1, 1);
    wc.on('zoom-changed', (e) => e.preventDefault());
    wc.on('did-finish-load', () => { try { wc.setZoomFactor(1); } catch {} });
  } catch {}

  const startVideo = process.env.BILIFOUND_START_VIDEO || process.env.BILIGLASS_START_VIDEO;
  const startRoute = process.env.BILIFOUND_START_ROUTE || process.env.BILIGLASS_START_ROUTE;
  const startOpen = process.env.BILIFOUND_START_OPEN || process.env.BILIGLASS_START_OPEN;
  const query = {};
  if (startVideo) query.video = startVideo;
  if (startRoute) query.route = startRoute;
  if (startOpen) query.open = startOpen;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'),
    Object.keys(query).length ? { query } : {});
  win.once('ready-to-show', () => {
    win.show();
    autoCheckUpdateSoon(entry);
    // Windows 首次显示后再同步一次最大化状态，渲染层好画对图标
    sendToWin(win, 'window-state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  });
  win.on('closed', () => windows.delete(win.id));
  return win;
}

function destroyAuxViews(entry) {
  const destroy = (view) => {
    try {
      if (!view) return;
      const wc = view.webContents;
      if (wc && !wc.isDestroyed()) {
        wc.setAudioMuted(true);
        wc.close();
      }
    } catch {}
  };
  destroy(entry.player);
  destroy(entry.web);
  destroy(entry.live);
  destroy(entry.action);
  entry.player = null;
  entry.web = null;
}

function entryFor(event) {
  for (const e of windows.values()) if (e.win.webContents === event.sender) return e;
  return null;
}

function entryForView(event) {
  for (const e of windows.values()) {
    if (e.player && !e.player.webContents.isDestroyed() && e.player.webContents === event.sender) return e;
    if (e.live && !e.live.webContents.isDestroyed() && e.live.webContents === event.sender) return e;
    if (e.web && !e.web.webContents.isDestroyed() && e.web.webContents === event.sender) return e;
  }
  return null;
}

/* --------------------------- 播放器 / 网页视图 --------------------------- */

// 视频 CDN 需要 Referer 才能取到分片
try {
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const host = new URL(details.url).hostname;
      if (/(^|\.)(bilivideo|akamaized|mcdn|szbdyd|mirror|hdslb)\.[a-z.]+$/.test(host) || host.includes('upos-')) {
        details.requestHeaders.Referer = 'https://www.bilibili.com/';
      }
    } catch {}
    callback({ requestHeaders: details.requestHeaders });
  });
} catch {}

function ensurePlayer(entry) {
  if (entry.player && !entry.player.webContents.isDestroyed()) return entry.player;
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'player-preload.js'),
    },
  });
  entry.win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  entry.player = view;
  return view;
}

function pickDashStream(list, qn) {
  const sorted = (list || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0));
  if (!sorted.length) return null;
  return sorted.find((s) => s.id === qn) || sorted.find((s) => s.id <= qn) || sorted[0];
}

function normalizePlayInfo(d, want) {
  const formats = (d.accept_quality || []).map((q, i) => ({
    qn: q, label: (d.accept_description || [])[i] || String(q),
  }));
  const dash = d.dash;
  if (dash && Array.isArray(dash.video) && dash.video.length) {
    const v = pickDashStream(dash.video, want);
    const audios = (dash.audio || []).slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    const a = audios[0];
    return {
      ok: true,
      dash: true,
      url: v.baseUrl || v.base_url || '',
      audioUrl: a ? (a.baseUrl || a.base_url || '') : '',
      quality: v.id,
      formats,
    };
  }
  if (Array.isArray(d.durl) && d.durl.length) {
    return {
      ok: true,
      dash: false,
      url: d.durl[0].url,
      audioUrl: '',
      quality: d.quality,
      formats,
    };
  }
  return { ok: false, message: '播放地址获取失败' };
}

async function resolvePlayUrl({ bvid, cid, epId, qn }) {
  const want = Number(qn) || 80;
  try {
    if (epId) {
      const r = await apiFetch(
        `/pgc/player/web/playurl?ep_id=${epId}&cid=${cid || ''}&fnval=4048&qn=${want}&fourk=1`
      );
      const d = r && r.result;
      if (!r || r.code !== 0 || !d) {
        return { ok: false, message: (r && (r.message || r.code)) || '番剧播放地址获取失败' };
      }
      return normalizePlayInfo(d, want);
    }
    const r = await apiFetchWbi('/x/player/wbi/playurl', {
      bvid, cid, qn: want, fnval: 4048, fourk: 1,
    });
    const d = r && r.data;
    if (!r || r.code !== 0 || !d) {
      return { ok: false, message: (r && (r.message || r.code)) || '播放地址获取失败' };
    }
    return normalizePlayInfo(d, want);
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
}

function ensureWeb(entry) {
  if (entry.web && !entry.web.webContents.isDestroyed()) return entry.web;
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  entry.win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  entry.web = view;
  return view;
}

/* ------------------------------ 登录窗口 ------------------------------ */

let loginWin = null;
function openLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 420,
    height: 640,
    title: '登录哔哩哔哩',
    parent: BrowserWindow.getFocusedWindow() || undefined,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    autoHideMenuBar: true,
    icon: iconPath() || undefined,
    webPreferences: { partition: PARTITION, contextIsolation: true, preload: undefined },
  });
  loginWin.loadURL('https://passport.bilibili.com/login?gourl=https%3A%2F%2Fwww.bilibili.com%2F');
  loginWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) loginWin.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  loginWin.on('closed', () => {
    loginWin = null;
    for (const e of windows.values()) sendToWin(e.win, 'login-changed', true);
  });
}

/* ------------------------------ IPC ------------------------------ */

ipcMain.handle('api', async (_e, endpoint) => {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) return { code: -1 };
  try {
    return await apiFetch(endpoint);
  } catch (err) {
    return { code: -1, message: String(err && err.message) };
  }
});

/* 搜索联想：走 s.search.bilibili.com（与 api.bilibili.com 不同域，单独一个通道） */
ipcMain.handle('search:suggest', async (_e, term) => {
  const q = String(term || '').trim();
  if (!q) return { ok: true, list: [] };
  try {
    const ses = session.fromPartition(PARTITION);
    const url = `https://s.search.bilibili.com/main/suggest?term=${encodeURIComponent(q)}&main_ver=v1&highlight=&Suggestion_type=0`;
    const res = await ses.fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
      },
    });
    if (!res.ok) return { ok: false, list: [] };
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, list: [] };
    }
    const tags = (data && data.result && data.result.tag) || [];
    const list = tags
      .map((t) => String(t.value || t.term || '').trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 10);
    return { ok: true, list };
  } catch (err) {
    return { ok: false, list: [], message: String(err && err.message) };
  }
});

ipcMain.handle('api:wbi', async (_e, { endpoint, params }) => {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) return { code: -1 };
  try {
    return await apiFetchWbi(endpoint, params || {});
  } catch (err) {
    return { code: -1, message: String(err && err.message) };
  }
});

ipcMain.handle('player:time', async (event) => {
  const entry = entryFor(event);
  if (!entry || !entry.player || entry.player.webContents.isDestroyed()) return 0;
  try {
    return await entry.player.webContents.executeJavaScript(
      '(document.querySelector("video")||{}).currentTime || 0'
    );
  } catch {
    return 0;
  }
});

ipcMain.handle('player:state', async (event) => {
  const entry = entryFor(event);
  if (!entry || !entry.player || entry.player.webContents.isDestroyed()) return null;
  try {
    return await entry.player.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return {
        paused: !!v.paused,
        currentTime: Number(v.currentTime) || 0,
        duration: Number(v.duration) || 0,
        volume: Number(v.volume),
        muted: !!v.muted,
        rate: Number(v.playbackRate) || 1,
      };
    })()`);
  } catch {
    return null;
  }
});

ipcMain.on('player:cmd', (event, { cmd, value }) => {
  const entry = entryFor(event);
  if (!entry || !entry.player || entry.player.webContents.isDestroyed()) return;
  const wc = entry.player.webContents;
  const js = (code) => wc.executeJavaScript(code).catch(() => {});
  const MEDIA = "document.querySelectorAll('video, audio')";
  try {
    if (cmd === 'toggle') {
      js(`(() => { const v=document.querySelector('video'); if(!v) return; v.paused ? v.play().catch(()=>{}) : v.pause(); })()`);
    } else if (cmd === 'seek') {
      js(`(() => { ${MEDIA}.forEach(m => { m.currentTime = ${Number(value) || 0}; }); })()`);
    } else if (cmd === 'volume') {
      js(`(() => { ${MEDIA}.forEach(m => { m.muted=false; m.volume=${Math.max(0, Math.min(1, Number(value) || 0))}; }); })()`);
    } else if (cmd === 'mute') {
      js(`(() => { const v=document.querySelector('video'); const muted = v ? !v.muted : true; ${MEDIA}.forEach(m => { m.muted = muted; }); })()`);
    } else if (cmd === 'speed') {
      js(`(() => { ${MEDIA}.forEach(m => { m.playbackRate = ${Number(value) || 1}; }); })()`);
    } else if (cmd === 'back5') {
      js(`(() => { const v=document.querySelector('video'); if(v) { const t = Math.max(0, v.currentTime - 5); ${MEDIA}.forEach(m => { m.currentTime = t; }); } })()`);
    } else if (cmd === 'fwd5') {
      js(`(() => { const v=document.querySelector('video'); if(v) { const t = Math.min(v.duration || 1e9, v.currentTime + 5); ${MEDIA}.forEach(m => { m.currentTime = t; }); } })()`);
    } else if (cmd === 'danmaku') {
      js(`window.__setDanmakuOn && window.__setDanmakuOn(!window.__dmOn)`);
    } else if (cmd === 'subtitle') {
      js(`window.__setSubtitleOn && window.__setSubtitleOn(!window.__subOn)`);
    } else if (cmd === 'pip') {
      js(`(() => { const v = document.querySelector('video');
        if (!v) return;
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        else if (v.requestPictureInPicture) v.requestPictureInPicture().catch(() => {});
      })()`);
    } else if (cmd === 'shot') {
      js(`window.__shot && window.__shot()`);
    } else if (cmd === 'fullscreen') {
      js(`(() => { const el = document.documentElement;
        if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
        else document.exitFullscreen && document.exitFullscreen(); })()`);
    }
  } catch {}
});

ipcMain.handle('live:info', async (_e, { roomId }) => {
  try {
    const r = await apiFetch(
      `/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8`
    );
    const data = r && r.data;
    const streams = (data && data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.stream) || [];
    const hlsCandidates = [];
    let flv = '';
    for (const st of streams) {
      for (const fmt of st.format || []) {
        for (const codec of fmt.codec || []) {
          if (codec.codec_name && codec.codec_name !== 'avc') continue;
          const isHls = st.protocol_name === 'http_hls' || String(codec.base_url || '').includes('.m3u8');
          for (const info of codec.url_info || []) {
            if (!info || !codec.base_url) continue;
            const url = `${info.host}${codec.base_url}${info.extra || ''}`;
            if (isHls) hlsCandidates.push(url);
            else if (!flv) flv = url;
          }
        }
      }
    }
    // 逐个探测可用的 HLS 地址（部分 CDN host 可能 DNS 不通）
    const ses = session.fromPartition(PARTITION);
    let m3u8 = '';
    for (const url of hlsCandidates.slice(0, 6)) {
      try {
        const ok = await Promise.race([
          ses.fetch(url, {
            headers: { Referer: 'https://live.bilibili.com/', 'User-Agent': USER_AGENT },
          }).then((r) => r.ok).catch(() => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
        if (ok) { m3u8 = url; break; }
      } catch {}
    }
    const roomInfo = (data && (data.room_info || data)) || {};
    return {
      ok: !!(m3u8 || flv),
      url: m3u8 || flv,
      isHls: !!m3u8,
      m3u8,
      flv,
      title: roomInfo.title || '',
      live: (data && data.live_status === 1) || roomInfo.live_status === 1,
      message: m3u8 || flv ? '' : '直播流获取失败',
    };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

/* ------------------------------ 直播弹幕 ------------------------------ */

function dmPacket(op, body, ver = 1) {
  const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const buf = Buffer.alloc(16 + payload.length);
  buf.writeUInt32BE(16 + payload.length, 0);
  buf.writeUInt16BE(16, 4);
  buf.writeUInt16BE(ver, 6);
  buf.writeUInt32BE(op, 8);
  buf.writeUInt32BE(1, 12);
  payload.copy(buf, 16);
  return buf;
}

function dmParse(buf) {
  const out = [];
  let off = 0;
  while (off + 16 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const hlen = buf.readUInt16BE(off + 4);
    const ver = buf.readUInt16BE(off + 6);
    const op = buf.readUInt32BE(off + 8);
    if (len < 16 || off + len > buf.length) break;
    const body = buf.subarray(off + hlen, off + len);
    try {
      if (op === 5) {
        if (ver === 2) out.push(...dmParse(zlib.inflateSync(body)));
        else if (ver === 3) out.push(...dmParse(zlib.brotliDecompressSync(body)));
        else out.push(JSON.parse(body.toString('utf8')));
      }
    } catch {}
    off += len;
  }
  return out;
}

async function startLiveDanmaku(entry, roomId) {
  stopLiveDanmaku(entry);
  try {
    const info = await apiFetchWbi('/xlive/web-room/v1/index/getDanmuInfo', { id: roomId, type: 0 });
    const token = info && info.data && info.data.token;
    const host = (info && info.data && info.data.host_list && info.data.host_list[0]) || null;
    if (!token || !host) return { ok: false, message: '弹幕服务器不可用' };
    // 鉴权包需要 uid 与 buvid，否则连接会被服务端立即关闭
    const ses = session.fromPartition(PARTITION);
    const cookie = async (name) => {
      const c = await ses.cookies.get({ name }).catch(() => null);
      return (c && c[0] && c[0].value) || '';
    };
    const uid = await cookie('DedeUserID');
    const buvid = (await cookie('buvid3')) || (await cookie('buvid4'));
    const ws = new WebSocket(`wss://${host.host}:${host.wss_port}/sub`);
    const state = { ws, roomId, timer: null, alive: false };
    entry.liveDm = state;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      ws.send(dmPacket(7, {
        uid: Number(uid) || 0, roomid: Number(roomId), protover: 3, platform: 'web', type: 2,
        key: token, buvid,
      }));
      state.timer = setInterval(() => {
        try { ws.send(dmPacket(2, '[object Object]')); } catch {}
      }, 30000);
    });
    ws.addEventListener('message', (ev) => {
      const buf = Buffer.from(ev.data);
      for (const msg of dmParse(buf)) {
        if (!msg || !msg.cmd) continue;
        if (msg.cmd.startsWith('DANMU_MSG')) {
          const infoArr = msg.info || [];
          const i0 = infoArr[0] || [];
          const i2 = infoArr[2] || [];
          const i3 = infoArr[3] || [];
          const i4 = infoArr[4] || [];
          const medalLevel = Number(i3[0]) || 0;
          const medalName = String(i3[1] || '');
          const medalColor = Number(i3[4]) || 0;
          const userLevel = Number(i4[0]) || 0;
          const guard = Number(infoArr[7]) || 0;
          const isAdmin = i2[2] === 1;
          const text = String((infoArr[1] || '').toString());
          const user = String(i2[1] || '');
          const color = Number(i0[3]) || 16777215;
          if (text) {
            sendToWin(entry.win, 'live-danmaku', {
              type: 'danmaku',
              user,
              text,
              color,
              uid: Number(i2[0]) || 0,
              level: userLevel,
              isAdmin,
              guard,
              medal: { level: medalLevel, name: medalName, color: medalColor },
            });
            if (entry.live && !entry.live.webContents.isDestroyed()) {
              entry.live.webContents
                .executeJavaScript(`window.__dm && window.__dm(${JSON.stringify({ text, color })})`)
                .catch(() => {});
            }
          }
        } else if (msg.cmd.startsWith('INTERACT_WORD')) {
          const d = msg.data || {};
          if (d.uname) sendToWin(entry.win, 'live-danmaku', { type: 'enter', user: d.uname });
        } else if (msg.cmd.startsWith('SEND_GIFT')) {
          const d = msg.data || {};
          if (d.uname) sendToWin(entry.win, 'live-danmaku', { type: 'gift', user: d.uname, text: `${d.giftName || '礼物'} ×${d.num || 1}` });
        }
      }
    });
    ws.addEventListener('error', () => {});
    ws.addEventListener('close', () => { state.alive = false; });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
}

function stopLiveDanmaku(entry) {
  const st = entry && entry.liveDm;
  if (!st) return;
  try { clearInterval(st.timer); } catch {}
  try { st.ws.close(); } catch {}
  entry.liveDm = null;
}

ipcMain.handle('live:danmaku:start', async (event, { roomId }) => {
  const entry = entryFor(event);
  if (!entry || !roomId) return { ok: false };
  return startLiveDanmaku(entry, roomId);
});

ipcMain.on('live:danmaku:stop', (event) => {
  const entry = entryFor(event);
  if (entry) stopLiveDanmaku(entry);
});

ipcMain.handle('live:danmaku:send', async (_e, { roomId, text }) => {
  const msg = String(text || '').trim();
  if (!msg) return { code: -1, message: '内容不能为空' };
  if (!roomId) return { code: -1, message: '缺少房间号' };
  return apiPost('/msg/send', {
    roomid: roomId, msg, color: 16777215, fontsize: 25, mode: 1,
    rnd: Math.floor(Date.now() / 1000), bubble: 0,
  });
});

/* ------------------------------ 视频全屏 ------------------------------ */

function applyPlayerBounds(entry) {
  if (!entry || !entry.player || entry.player.webContents.isDestroyed()) return;
  const b = entry.win.getContentBounds();
  entry.player.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
}

function applyLiveBounds(entry) {
  if (!entry || !entry.live || entry.live.webContents.isDestroyed()) return;
  if (entry.liveFs) {
    const b = entry.win.getContentBounds();
    entry.live.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
  }
}

// Windows 全屏是异步切换边框样式：等尺寸稳定后再铺满一次，避免视图停在旧大小
function refitSoon(entry, kind) {
  const apply = () => {
    if (!entry || entry.win.isDestroyed()) return;
    if (kind === 'player' && entry.videoFs) applyPlayerBounds(entry);
    if (kind === 'live' && entry.liveFs) applyLiveBounds(entry);
  };
  for (const delay of [0, 60, 200, 500]) setTimeout(apply, delay);
}

function setLiveFullscreen(entry, on) {
  if (!entry) return;
  entry.liveFs = !!on;
  try {
    if (entry.live) entry.live.setVisible(true);
  } catch {}
  try {
    if (entry.live && !entry.live.webContents.isDestroyed()) {
      entry.live.webContents.executeJavaScript(`window.__setFs && window.__setFs(${on ? 'true' : 'false'})`).catch(() => {});
    }
  } catch {}
  toggleWindowFullscreen(entry, !!on);
  if (on) refitSoon(entry, 'live');
  try {
    entry.win.webContents.send('live-fullscreen', { on: !!on });
  } catch {}
}

function setVideoFullscreen(entry, on) {
  if (!entry) return;
  const win = entry.win;
  if (on) {
    entry.videoFs = true;
    toggleWindowFullscreen(entry, true);
    refitSoon(entry, 'player');
    entry.player?.webContents.executeJavaScript('window.__setFs && window.__setFs(true)').catch(() => {});
    sendToWin(win, 'video-fullscreen', { on: true });
  } else {
    entry.videoFs = false;
    toggleWindowFullscreen(entry, false);
    entry.player?.webContents.executeJavaScript('window.__setFs && window.__setFs(false)').catch(() => {});
    sendToWin(win, 'video-fullscreen', { on: false });
  }
}

/* 进入/退出原生全屏：记住之前是否最大化，退出后还原（Windows 不会自动还原） */
function toggleWindowFullscreen(entry, on) {
  const win = entry.win;
  if (win.isDestroyed()) return;
  if (on) {
    if (!win.isFullScreen()) {
      entry.fsPrevFull = false;
      entry.fsPrevMax = win.isMaximized();
      win.setFullScreen(true);
    }
    return;
  }
  if (entry.fsPrevFull) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  if (isWin && entry.fsPrevMax) {
    entry.fsPrevMax = false;
    setTimeout(() => {
      try { if (!win.isDestroyed() && !win.isFullScreen()) win.maximize(); } catch {}
    }, 120);
  }
}

ipcMain.handle('player:fullscreen', (event, { on }) => {
  const entry = entryFor(event);
  if (!entry) return { ok: false };
  setVideoFullscreen(entry, !!on);
  return { ok: true, on: !!on };
});

ipcMain.on('player:exit-fs', (event) => {
  const entry = entryForView(event) || entryFor(event);
  if (entry) setVideoFullscreen(entry, false);
});

// 播放器内双击：在「窗口全屏」与「退出全屏」之间切换
ipcMain.on('player:toggle-fs', (event) => {
  const entry = entryForView(event) || entryFor(event);
  if (!entry) return;
  setVideoFullscreen(entry, !entry.videoFs);
});

// 播放器是原生视图，滚轮事件由播放器页转发进来，再交给外壳滚动下方内容
ipcMain.on('player:wheel', (event, dy) => {
  const entry = entryForView(event) || entryFor(event);
  if (!entry || entry.videoFs) return;
  const delta = Number(dy) || 0;
  if (!delta) return;
  entry.win.webContents
    .executeJavaScript(`window.__bgWheel && window.__bgWheel(${Math.round(delta)})`)
    .catch(() => {});
});

ipcMain.on('live:show', (event, { rect, url }) => {
  const entry = entryFor(event);
  if (!entry || !rect || rect.width < 40 || !url) return;
  try {
    entry.player?.setVisible(false);
    entry.player?.webContents.setAudioMuted(true);
    entry.web?.setVisible(false);
  } catch {}
  if (!entry.live || entry.live.webContents.isDestroyed()) {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'live-preload.js'),
        // 直播 HLS 分片来自 CDN 且页面为 file://，仅此视图关闭跨域限制
        webSecurity: false,
      },
    });
    entry.win.contentView.addChildView(view);
    entry.live = view;
  }
  entry.live.setBounds({
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  });
  entry.live.setVisible(true);
  // 同一个流只更新位置，避免窗口尺寸变化导致直播页重载（会中断播放/丢弹幕）
  if (entry.liveUrl === url) return;
  entry.liveUrl = url;
  const target = `${pathToFileURL(path.join(__dirname, 'renderer', 'live.html')).href}?url=${encodeURIComponent(url)}`;
  entry.live.webContents.loadURL(target).catch(() => {});
});

const LIVE_QN_NAMES = { 30000: '杜比', 20000: '4K', 10000: '原画', 401: '蓝光', 400: '蓝光', 250: '超清', 150: '高清', 80: '流畅' };

function liveStreamUrls(data) {
  const streams = (data && data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.stream) || [];
  const hls = [];
  const flv = [];
  for (const st of streams) {
    for (const fmt of st.format || []) {
      for (const codec of fmt.codec || []) {
        if (codec.codec_name && codec.codec_name !== 'avc') continue;
        const isHls = st.protocol_name === 'http_hls' || String(codec.base_url || '').includes('.m3u8');
        for (const info of codec.url_info || []) {
          if (!info || !codec.base_url) continue;
          const u = `${info.host}${codec.base_url}${info.extra || ''}`;
          if (isHls) hls.push(u); else flv.push(u);
        }
      }
    }
  }
  return { hls, flv };
}

async function probeLiveUrl(urls) {
  const ses = session.fromPartition(PARTITION);
  for (const url of urls.slice(0, 6)) {
    try {
      const ok = await Promise.race([
        ses.fetch(url, { headers: { Referer: 'https://live.bilibili.com/', 'User-Agent': USER_AGENT } })
          .then((r) => r.ok).catch(() => false),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      if (ok) return url;
    } catch {}
  }
  return '';
}

ipcMain.handle('live:qualities', async (_e, { roomId }) => {
  try {
    const r = await apiFetch(`/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8`);
    const data = r && r.data;
    const streams = (data && data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.stream) || [];
    const qns = new Set();
    for (const st of streams) for (const fmt of st.format || []) for (const codec of fmt.codec || []) {
      (codec.accept_qn || []).forEach((q) => qns.add(Number(q)));
    }
    const list = [...qns].filter(Boolean).sort((a, b) => b - a)
      .map((qn) => ({ qn, label: LIVE_QN_NAMES[qn] || String(qn) }));
    const current = (data && data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.g_qn) || 10000;
    return { ok: list.length > 0, list, current };
  } catch (err) {
    return { ok: false, message: String(err && err.message), list: [] };
  }
});

ipcMain.handle('live:setQuality', async (event, { roomId, qn }) => {
  try {
    const r = await apiFetch(`/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=${qn}&platform=web&ptype=8`);
    const { hls, flv } = liveStreamUrls(r && r.data);
    const url = (await probeLiveUrl(hls)) || flv[0] || '';
    if (!url) return { ok: false, message: '该清晰度暂不可用' };
    const entry = entryFor(event);
    if (entry && entry.live && !entry.live.webContents.isDestroyed()) {
      await entry.live.webContents.executeJavaScript(`window.__setSrc && window.__setSrc(${JSON.stringify(url)})`).catch(() => {});
    }
    return { ok: true, url };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('live:volume', async (event, { volume, muted }) => {
  const entry = entryFor(event);
  if (!entry || !entry.live || entry.live.webContents.isDestroyed()) return { ok: false };
  const v = Math.max(0, Math.min(1, Number(volume)));
  const js = `window.__setVolume && window.__setVolume(${v}); window.__setMuted && window.__setMuted(${muted ? 'true' : 'false'});`;
  entry.live.webContents.executeJavaScript(js).catch(() => {});
  return { ok: true };
});

ipcMain.handle('live:fullscreen', async (event, { on }) => {
  const entry = entryFor(event);
  if (!entry) return { ok: false };
  setLiveFullscreen(entry, !!on);
  return { ok: true, on: !!on };
});

ipcMain.on('live:exit-fs', (event) => {
  const entry = entryForView(event) || entryFor(event);
  if (entry) setLiveFullscreen(entry, false);
});

ipcMain.on('live:hide', (event) => {
  const entry = entryFor(event);
  if (!entry) return;
  stopLiveDanmaku(entry);
  try {
    entry.live?.setVisible(false);
    entry.live?.webContents.executeJavaScript('document.querySelectorAll("video").forEach(v=>v.pause())').catch(() => {});
  } catch {}
});

ipcMain.handle('video:formats', async (_e, { bvid, cid }) => {
  try {
    const pu = await apiFetchWbi('/x/player/wbi/playurl', { bvid, cid, qn: 127, fnval: 1, fourk: 1 });
    if (!pu || pu.code !== 0) return { ok: false, message: pu && pu.message };
    const d = pu.data || {};
    const formats = (d.accept_quality || []).map((qn, i) => ({
      qn,
      label: (d.accept_description || [])[i] || String(qn),
    }));
    return { ok: true, formats, current: d.quality };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

function uniquePath(dir, filename) {
  let target = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(target)) {
    const ext = path.extname(filename);
    target = path.join(dir, `${path.basename(filename, ext)} (${i})${ext}`);
    i += 1;
  }
  return target;
}

function notifyDownload(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('download-toast', payload);
  }
}

async function downloadToFile(url, target, meta) {
  const ses = session.fromPartition(PARTITION);
  const res = await ses.fetch(url, {
    headers: {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': USER_AGENT,
      Origin: 'https://www.bilibili.com',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || meta.size || 0;
  const temp = target + '.part';
  const file = fs.createWriteStream(temp);
  let received = 0;
  let lastNotify = 0;
  const notify = (state) => {
    notifyDownload({
      state,
      name: path.basename(target),
      received,
      total,
      path: target,
    });
  };
  notify('started');
  try {
    if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk);
        received += buf.length;
        if (!file.write(buf)) await new Promise((r) => file.once('drain', r));
        const now = Date.now();
        if (now - lastNotify > 400) {
          lastNotify = now;
          notify('progress');
        }
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      received = buf.length;
      file.write(buf);
    }
    await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
    moveIntoPlace(temp, target);
    notify('done');
  } catch (err) {
    try { file.destroy(); } catch {}
    try { fs.unlinkSync(temp); } catch {}
    notify('failed');
    throw err;
  }
}

ipcMain.handle('video:download', async (_e, { bvid, cid, title, qn }) => {
  try {
    const pu = await apiFetchWbi('/x/player/wbi/playurl', {
      bvid, cid, qn: qn || 64, fnval: 1, fourk: 1,
    });
    if (!pu || pu.code !== 0) return { ok: false, message: pu && pu.message };
    const d = pu.data || {};
    const durl = d.durl || [];
    if (!durl.length) return { ok: false, message: '该视频没有 MP4 合并流（DASH-only），暂时无法下载' };
    const idx = (d.accept_quality || []).indexOf(d.quality);
    const label = idx >= 0 ? (d.accept_description || [])[idx] : '';
    const safe = sanitizeFilename(String(title || bvid), 80);
    const filename = `${safe}${label ? ' [' + label + ']' : ''}.mp4`;
    const target = uniquePath(getDownloadDir(), filename);
    const size = durl.reduce((sum, seg) => sum + (Number(seg.size) || 0), 0);

    // 后台串行下载所有分段
    (async () => {
      try {
        const temp = target + '.part';
        const file = fs.createWriteStream(temp);
        let received = 0;
        let lastNotify = 0;
        const notify = (state) => notifyDownload({
          state,
          name: path.basename(target),
          received,
          total: size,
          path: target,
        });
        notify('started');
        for (const seg of durl) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60000);
          const res = await session.fromPartition(PARTITION).fetch(seg.url, {
            signal: controller.signal,
            headers: {
              Referer: 'https://www.bilibili.com/',
              'User-Agent': USER_AGENT,
              Origin: 'https://www.bilibili.com',
            },
          }).finally(() => clearTimeout(timer));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          let lastChunk = Date.now();
          const stall = setInterval(() => {
            if (Date.now() - lastChunk > 30000) {
              try { controller.abort(); } catch {}
              try { res.body.cancel(); } catch {}
            }
          }, 5000);
          try {
          for await (const chunk of res.body) {
            lastChunk = Date.now();
            const buf = Buffer.from(chunk);
            received += buf.length;
            if (!file.write(buf)) await new Promise((r) => file.once('drain', r));
            const now = Date.now();
            if (now - lastNotify > 400) {
              lastNotify = now;
              notify('progress');
            }
          }
          } finally { clearInterval(stall); }
        }
        await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
        moveIntoPlace(temp, target);
        notify('done');
      } catch (err) {
        console.log('[bg] download failed', err && err.message);
        notifyDownload({ state: 'failed', name: path.basename(target), received: 0, total: size, path: target });
        try { fs.unlinkSync(target + '.part'); } catch {}
      }
    })();

    return { ok: true, path: target, size, quality: label || d.quality };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

function ensureActionView(entry) {
  if (entry.action && !entry.action.webContents.isDestroyed()) return entry.action;
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
  });
  entry.win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 2, height: 2 });
  view.setVisible(false);
  view.webContents.loadURL('https://www.bilibili.com/').catch(() => {});
  entry.action = view;
  return view;
}

// 在站内页面上下文里发请求（同站 cookie，规避主进程请求被风控）
async function doActionPage(entry, { path: apiPath, body, json }) {
  try {
    const view = ensureActionView(entry);
    if (view.webContents.isLoading()) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 8000);
        view.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      });
    }
    const target = /^https?:/i.test(apiPath || '')
      ? apiPath
      : `https://api.bilibili.com${apiPath}`;
    const script = `(async () => {
      const m = document.cookie.match(/(?:^|;\\s*)bili_jct=([^;]+)/);
      const csrf = m ? decodeURIComponent(m[1]) : '';
      const asJson = ${json ? 'true' : 'false'};
      let url = ${JSON.stringify(target)};
      let init;
      if (asJson) {
        const sep = url.includes('?') ? '&' : '?';
        url += sep + 'csrf=' + encodeURIComponent(csrf);
        init = {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(${JSON.stringify(body || {})}),
        };
      } else {
        const params = new URLSearchParams(${JSON.stringify(body || {})});
        if (csrf && !params.has('csrf')) params.set('csrf', csrf);
        init = {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        };
      }
      const res = await fetch(url, init);
      return await res.text();
    })()`;
    const text = await view.webContents.executeJavaScript(script);
    try {
      return JSON.parse(text);
    } catch {
      return { code: -1, message: 'invalid json', raw: String(text).slice(0, 120) };
    }
  } catch (err) {
    return { code: -1, message: String(err && err.message) };
  }
}

ipcMain.handle('action:page', async (event, payload) => {
  const entry = entryFor(event);
  if (!entry) return { code: -1, message: 'no window' };
  return doActionPage(entry, payload);
});

ipcMain.handle('action', async (_e, { type, bvid, aid, cid, like, multiply, folderId }) => {
  try {
    if (type === 'like') {
      return await apiPost('/x/web-interface/archive/like', { bvid, like: like ? 1 : 2 });
    }
    if (type === 'coin') {
      return await apiPost('/x/web-interface/coin/add', {
        bvid, multiply: multiply || 1, select_like: 0,
      });
    }
    if (type === 'fav') {
      return await apiPost('/x/v3/fav/resource/deal', {
        rid: aid, type: 2, add_media_ids: folderId || '', del_media_ids: '',
      });
    }
    if (type === 'toview') {
      return await apiPost('/x/v2/history/toview/add', { bvid });
    }
    return { code: -1, message: 'unknown action' };
  } catch (err) {
    return { code: -1, message: String(err && err.message) };
  }
});

ipcMain.handle('emote:panel', async (_e, { biz }) => {
  try {
    const r = await apiFetch(`/x/emote/user/panel/web?business=${biz === 'dynamic' ? 'dynamic' : 'reply'}`);
    const pkgs = (r && r.data && r.data.packages) || [];
    return {
      ok: true,
      packages: pkgs.map((p) => ({
        text: p.text || '',
        emotes: (p.emote || []).map((e) => ({
          text: e.text || '', url: e.url || '', size: (e.meta && e.meta.size) || 1,
        })),
      })),
    };
  } catch (err) {
    return { ok: false, message: String(err && err.message), packages: [] };
  }
});

ipcMain.handle('image:upload', async (event, { biz }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win, {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
    const ses = session.fromPartition(PARTITION);
    const cookies = await ses.cookies.get({ name: 'bili_jct' });
    const csrf = (cookies && cookies[0] && cookies[0].value) || '';
    if (!csrf) return { ok: false, message: '未登录' };
    const images = [];
    for (const file of picked.filePaths.slice(0, 9)) {
      const buf = fs.readFileSync(file);
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const form = new FormData();
      form.append('file_up', new Blob([buf], { type: mime }), path.basename(file));
      form.append('category', 'daily');
      form.append('biz', biz === 'reply' ? 'reply' : biz === 'im' ? 'im' : 'new_dyn');
      form.append('csrf', csrf);
      const res = await ses.fetch(`https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs?csrf=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        body: form,
        headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT },
      });
      const json = await res.json();
      if (!json || json.code !== 0) {
        return { ok: false, message: (json && json.message) || '图片上传失败' };
      }
      images.push({
        url: json.data.image_url,
        width: json.data.image_width,
        height: json.data.image_height,
        size: json.data.img_size,
      });
    }
    return { ok: true, images };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('article:like', async (_e, { id }) => {
  if (!id) return { code: -1, message: '缺少参数' };
  return apiPost('/x/article/like', { type: 'like', id });
});

ipcMain.handle('clipboard:write', (_e, text) => {
  try { clipboard.writeText(String(text || '')); return true; } catch { return false; }
});

ipcMain.handle('reply:action', async (_e, { oid, type, rpid, like }) => {
  if (!oid || !type || !rpid) return { code: -1, message: '缺少参数' };
  return apiPost('/x/v2/reply/action', { oid, type, rpid, action: like ? 1 : 0 });
});

ipcMain.handle('history:delete', async (_e, { kid }) => {
  if (!kid) return { code: -1, message: '缺少参数' };
  return apiPost('/x/v2/history/delete', { kid });
});

ipcMain.handle('toview:del', async (_e, { aid }) => {
  if (!aid) return { code: -1, message: '缺少参数' };
  return apiPost('/x/v2/history/toview/del', { aid });
});

ipcMain.handle('fav:folders', async () => {
  try {
    const ses = session.fromPartition(PARTITION);
    const cookies = await ses.cookies.get({ name: 'DedeUserID' });
    const mid = (cookies && cookies[0] && cookies[0].value) || '';
    if (!mid) return { ok: false, message: '未登录', folders: [] };
    const r = await apiFetch(`/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
    const list = (r && r.data && r.data.list) || [];
    return { ok: true, folders: list.map((f) => ({ id: f.id, title: f.title, count: f.media_count })) };
  } catch (err) {
    return { ok: false, message: String(err && err.message), folders: [] };
  }
});

ipcMain.handle('dynamic:create', async (_e, { content, dynId, pics }) => {
  const text = String(content || '').trim();
  const images = Array.isArray(pics) ? pics : [];
  if (!text && !images.length && !dynId) return { code: -1, message: '内容不能为空' };
  const dynReq = {
    content: { contents: text ? [{ raw_text: text, type: 1, biz_id: '' }] : [] },
    pics: images.map((p) => ({
      img_src: p.url, img_width: p.width, img_height: p.height, img_size: p.size,
    })),
    scene: 2,
    meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
  };
  if (dynId) dynReq.dyn_id = dynId;
  return apiPostJson('/x/dynamic/feed/create/dyn', { dyn_req: dynReq });
});

ipcMain.handle('dynamic:remove', async (_e, { dynId }) => {
  if (!dynId) return { code: -1, message: '缺少参数' };
  return apiPost('/x/dynamic/feed/operate/remove', { dynamic_id: dynId });
});

ipcMain.handle('comment:add', async (_e, { oid, type, message, root, parent, pictures }) => {
  const text = String(message || '').trim();
  if (!text) return { code: -1, message: '评论内容不能为空' };
  if (text.length > 1000) return { code: -1, message: '评论不能超过 1000 字' };
  if (!oid || !type) return { code: -1, message: '缺少目标' };
  const form = { oid, type, message: text, plat: 1 };
  if (root) form.root = root;
  if (parent) form.parent = parent;
  if (Array.isArray(pictures) && pictures.length) {
    form.pictures = JSON.stringify(pictures.map((p) => ({
      img_src: p.url, img_width: p.width, img_height: p.height, img_size: p.size,
    })));
  }
  return apiPost('/x/v2/reply/add', form);
});

ipcMain.handle('comment:del', async (_e, { oid, type, rpid }) => {
  if (!oid || !type || !rpid) return { code: -1, message: '缺少参数' };
  return apiPost('/x/v2/reply/del', { oid, type, rpid });
});

ipcMain.handle('image:save', async (_e, url) => {
  try {
    if (!/^https?:/i.test(String(url))) return { ok: false, message: '无效地址' };
    const ses = session.fromPartition(PARTITION);
    const res = await ses.fetch(url, {
      headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const extMatch = String(url).match(/\.(png|jpe?g|webp|gif|avif)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    const name = `bili_image_${Date.now()}.${ext}`;
    const target = uniquePath(getDownloadDir(), name);
    fs.writeFileSync(target, buf);
    notifyDownload({ state: 'done', name, path: target, received: buf.length, total: buf.length });
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('open-external', async (_e, url) => {
  try {
    if (!/^https?:/i.test(String(url))) return false;
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

/* --------------------------- 自定义背景 --------------------------- */

const BG_DIR = () => path.join(app.getPath('userData'), 'backgrounds');

function ensureBgDir() {
  const dir = BG_DIR();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toFileUrl(p) {
  // Windows 盘符要转成 file:///C:/... 才是合法 URL（手拼 file://C:\ 会加载失败）
  return pathToFileURL(p).href;
}

ipcMain.handle('bg:pick', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'bmp'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const srcPath = result.filePaths[0];
    const ext = path.extname(srcPath) || '.jpg';
    const dir = ensureBgDir();
    const dest = path.join(dir, `bg-${Date.now()}${ext}`);
    fs.copyFileSync(srcPath, dest);
    return { ok: true, url: toFileUrl(dest), path: dest, name: path.basename(srcPath) };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('bg:save', async (_e, { data, ext }) => {
  try {
    const dir = ensureBgDir();
    const safeExt = /^[a-z0-9]{2,5}$/i.test(String(ext || 'png')) ? ext : 'png';
    const dest = path.join(dir, `bg-${Date.now()}.${safeExt}`);
    fs.writeFileSync(dest, Buffer.from(data));
    return { ok: true, url: toFileUrl(dest), path: dest };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('bg:fromUrl', async (_e, url) => {
  try {
    if (!/^https?:/i.test(String(url))) return { ok: false, message: '无效地址' };
    const ses = session.fromPartition(PARTITION);
    const res = await ses.fetch(url, {
      headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const extMatch = String(url).match(/\.(png|jpe?g|webp|gif)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    const dest = path.join(ensureBgDir(), `bg-${Date.now()}.${ext}`);
    fs.writeFileSync(dest, buf);
    return { ok: true, url: toFileUrl(dest), path: dest };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('player:shot', async (event) => {
  const entry = entryFor(event);
  if (!entry || !entry.player || entry.player.webContents.isDestroyed()) {
    return { ok: false, message: '播放器未就绪' };
  }
  try {
    const dataUrl = await entry.player.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('video');
      if (!v || !v.videoWidth) return '';
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      try { return c.toDataURL('image/png'); } catch { return ''; }
    })()`);
    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
      return { ok: false, message: '截图失败（可能是跨域视频）' };
    }
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const target = uniquePath(getDownloadDir(), `bili_shot_${Date.now()}.png`);
    fs.writeFileSync(target, buf);
    notifyDownload({ state: 'done', name: path.basename(target), path: target, received: buf.length, total: buf.length });
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('bg:remove', async (_e, filePath) => {
  try {
    const dir = path.resolve(BG_DIR());
    const resolved = path.resolve(String(filePath || ''));
    // Windows 路径大小写不敏感，必须按同一基准比较，否则合法文件会被判成越权
    const base = isWin ? dir.toLowerCase() : dir;
    const target = isWin ? resolved.toLowerCase() : resolved;
    if (!target.startsWith(base + path.sep)) return { ok: false, message: '不允许删除该文件' };
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('downloads:list', async () => {
  try {
    const dir = getDownloadDir();
    if (!fs.existsSync(dir)) return { ok: true, dir, files: [] };
    const files = fs.readdirSync(dir)
      .filter((f) => !f.endsWith('.part'))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 60);
    return { ok: true, dir, files };
  } catch (err) {
    return { ok: false, message: String(err && err.message), files: [] };
  }
});

ipcMain.handle('downloads:delete', async (_e, name) => {
  try {
    const dir = getDownloadDir();
    const target = path.join(dir, path.basename(String(name)));
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('video:state', async (_e, { bvid, aid }) => {
  try {
    const [like, coins] = await Promise.all([
      apiFetch(`/x/web-interface/archive/has/like?bvid=${bvid}`).catch(() => null),
      apiFetch(`/x/web-interface/archive/coins?bvid=${bvid}`).catch(() => null),
    ]);
    return {
      liked: !!(like && like.data),
      coins: (coins && coins.data && coins.data.multiply) || 0,
    };
  } catch {
    return { liked: false, coins: 0 };
  }
});

ipcMain.handle('danmaku', async (_e, cid) => {
  try {
    return await fetchDanmaku(cid);
  } catch (err) {
    return { ok: false, error: String(err && err.message), list: [] };
  }
});

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(settings, patch || {});
  saveSettings();
  for (const win of BrowserWindow.getAllWindows()) sendToWin(win, 'settings-changed', settings);
  return settings;
});

ipcMain.on('player:show', async (event, payload) => {
  const entry = entryFor(event);
  const { rect, bvid, cid, episodeId, startAt, qn } = payload || {};
  if (!entry || !rect || rect.width < 40 || !(bvid || episodeId)) return;
  try { entry.web?.setVisible(false); entry.live?.setVisible(false); } catch {}

  // 兜底：renderer 有些入口（例如关掉设置面板后重新贴回播放器）只带 bvid，
  // 少了 cid 时 playurl 会被判成参数错误（code -400「请求错误」），这里补查一次
  let useCid = cid;
  if (!useCid && bvid && !episodeId) {
    const info = await apiFetch(`/x/web-interface/view?bvid=${bvid}`).catch(() => null);
    useCid = (info && info.data && info.data.cid) || undefined;
  }

  const resolved = await resolvePlayUrl({ bvid, cid: useCid, epId: episodeId, qn });
  if (!resolved.ok) {
    entry.playerError = resolved.message || '播放失败';
    sendToWin(entry.win, 'player-error', { message: entry.playerError });
    return;
  }
  entry.playerError = null;
  entry.playerMeta = {
    bvid, cid: useCid, epId: episodeId, quality: resolved.quality, formats: resolved.formats,
  };

  const view = ensurePlayer(entry);
  view.setBounds({
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  });
  view.setVisible(true);
  view.webContents.setAudioMuted(false);

  const dmParams =
    `&dmOpacity=${Number(settings.danmakuOpacity ?? 1)}` +
    `&dmSize=${Number(settings.danmakuSize ?? 20)}` +
    `&dmSpeed=${Number(settings.danmakuSpeed ?? 1)}` +
    `&dmArea=${Number(settings.danmakuArea ?? 0.5)}` +
    `&dmOn=${settings.danmaku ? 1 : 0}`;
  const localUrl = `${pathToFileURL(path.join(__dirname, 'renderer', 'player.html')).href}` +
    `?src=${encodeURIComponent(resolved.url)}` +
    `&asrc=${encodeURIComponent(resolved.audioUrl || '')}` +
    `&start=${Math.floor(startAt || 0)}` +
    `&cid=${useCid || ''}` +
    `&ep=${episodeId || ''}` + dmParams;
  await view.webContents.loadURL(localUrl).catch(() => {});
  sendToWin(entry.win, 'player-ready', { quality: resolved.quality, formats: resolved.formats });

  // 注入弹幕
  if (useCid) {
    fetchDanmaku(useCid).then((dm) => {
      if (!dm || !dm.list || !dm.list.length) return;
      if (view.webContents.isDestroyed()) return;
      view.webContents.executeJavaScript(
        `window.__setDanmaku && window.__setDanmaku(${JSON.stringify(dm.list)})`
      ).catch(() => {});
    }).catch(() => {});
  }
});

/* ------------------------------ 字幕 ------------------------------ */

async function fetchSubtitleCues({ bvid, cid }) {
  try {
    const r = await apiFetchWbi('/x/player/wbi/v2', { bvid, cid });
    const subs = (r && r.data && r.data.subtitle && r.data.subtitle.subtitles) || [];
    if (!subs.length) return { ok: true, cues: [], langs: [] };
    const pick = subs.find((s) => /zh|ai-zh/i.test(s.lan || '')) || subs[0];
    let url = String(pick.subtitle_url || '');
    if (url.startsWith('//')) url = 'https:' + url;
    if (!url) return { ok: true, cues: [], langs: [] };
    const ses = session.fromPartition(PARTITION);
    const res = await ses.fetch(url, {
      headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT },
    });
    const json = await res.json();
    const cues = (json.body || []).map((c) => ({
      from: Number(c.from) || 0, to: Number(c.to) || 0, text: String(c.content || ''),
    })).filter((c) => c.text);
    return {
      ok: true,
      cues,
      langs: subs.map((s) => ({ lan: s.lan, label: s.lan_doc || s.lan })),
    };
  } catch (err) {
    return { ok: false, message: String(err && err.message), cues: [] };
  }
}

ipcMain.handle('player:subtitle', async (event, { bvid, cid }) => {
  const entry = entryFor(event);
  if (!entry || !entry.player) return { ok: false, message: 'no player' };
  const data = await fetchSubtitleCues({ bvid, cid });
  if (data.ok && data.cues.length && !entry.player.webContents.isDestroyed()) {
    entry.player.webContents.executeJavaScript(
      `window.__setSubtitle && window.__setSubtitle(${JSON.stringify(data.cues)})`
    ).catch(() => {});
  }
  return { ok: data.ok, count: data.cues.length, langs: data.langs || [] };
});

/* ------------------------------ 私信 ------------------------------ */

const imNameCache = new Map();

async function imTalkerInfo(mid) {
  const key = String(mid);
  if (imNameCache.has(key)) return imNameCache.get(key);
  const c = await apiFetch(`/x/web-interface/card?mid=${mid}`).catch(() => null);
  const card = (c && c.data && c.data.card) || {};
  const info = { name: card.name || `用户 ${mid}`, face: card.face || '' };
  imNameCache.set(key, info);
  return info;
}

ipcMain.handle('im:sessions', async () => {
  try {
    const r = await apiFetch('/session_svr/v1/session_svr/get_sessions?session_type=1&group_id=0&build=0&mobi_app=web');
    const list = (r && r.data && r.data.session_list) || [];
    const sessions = await Promise.all(list.slice(0, 20).map(async (s) => {
      const info = s.group_name
        ? { name: s.group_name, face: s.group_cover || '' }
        : await imTalkerInfo(s.talker_id);
      return {
        talkerId: s.talker_id,
        name: info.name,
        face: info.face,
        unread: s.unread_count || 0,
        ts: s.session_ts || (s.last_msg && s.last_msg.timestamp) || 0,
        last: s.last_msg || null,
      };
    }));
    return { ok: true, sessions };
  } catch (err) {
    return { ok: false, message: String(err && err.message), sessions: [] };
  }
});

ipcMain.handle('im:messages', async (_e, { talkerId }) => {
  try {
    const r = await apiFetch(`/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=${talkerId}&session_type=1&size=40&build=0&mobi_app=web`);
    const messages = (r && r.data && r.data.messages) || [];
    return { ok: !!(r && r.code === 0), messages: messages.slice().reverse() };
  } catch (err) {
    return { ok: false, message: String(err && err.message), messages: [] };
  }
});

ipcMain.handle('im:send', async (_e, { talkerId, text, type, payload }) => {
  const msgType = Number(type) === 2 ? 2 : 1;
  const msg = String(text || '').trim();
  if (msgType === 1 && !msg) return { code: -1, message: '内容不能为空' };
  if (msgType === 2 && !(payload && payload.url)) return { code: -1, message: '缺少图片' };
  try {
    const ses = session.fromPartition(PARTITION);
    const cookies = await ses.cookies.get({ name: 'DedeUserID' });
    const mid = (cookies && cookies[0] && cookies[0].value) || '';
    if (!mid) return { code: -101, message: '未登录' };
    if (!settings.imDevId) {
      settings.imDevId = crypto.randomUUID();
      saveSettings();
    }
    const content = msgType === 2
      ? JSON.stringify({
          url: payload.url,
          width: payload.width || 0,
          height: payload.height || 0,
          imageType: payload.imageType || 'png',
          original: 1,
          size: payload.size || 0,
        })
      : JSON.stringify({ content: msg });
    return await apiPost('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
      'msg[sender_uid]': mid,
      'msg[receiver_id]': talkerId,
      'msg[receiver_type]': 1,
      'msg[msg_type]': msgType,
      'msg[content]': content,
      'msg[timestamp]': Math.floor(Date.now() / 1000),
      'msg[dev_id]': settings.imDevId,
    });
  } catch (err) {
    return { code: -1, message: String(err && err.message) };
  }
});

ipcMain.handle('menu:popup', async (event, { title, items, x, y }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const list = Array.isArray(items) ? items.filter((it) => it && it.label) : [];
  if (!win || !list.length) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const template = [];
    if (title) template.push({ label: String(title), enabled: false });
    for (const it of list) {
      template.push({
        label: String(it.label),
        type: 'radio',
        checked: !!it.checked,
        click: () => done(it.value),
      });
    }
    const menu = Menu.buildFromTemplate(template);
    const opts = { window: win, callback: () => setTimeout(() => done(null), 0) };
    if (Number.isFinite(x) && Number.isFinite(y)) { opts.x = Math.round(x); opts.y = Math.round(y); }
    menu.popup(opts);
  });
});

ipcMain.handle('player:formats', (event) => {
  const entry = entryFor(event);
  if (!entry || !entry.playerMeta) return null;
  return { quality: entry.playerMeta.quality, formats: entry.playerMeta.formats || [] };
});

ipcMain.on('player:quality', async (event, { qn, startAt }) => {
  const entry = entryFor(event);
  if (!entry || !entry.playerMeta) return;
  const meta = entry.playerMeta;
  const resolved = await resolvePlayUrl({
    bvid: meta.bvid, cid: meta.cid, epId: meta.epId, qn,
  });
  if (!resolved.ok) {
    sendToWin(entry.win, 'player-error', { message: resolved.message || '切换画质失败' });
    return;
  }
  entry.playerMeta.quality = resolved.quality;
  const view = ensurePlayer(entry);
  const localUrl = `${pathToFileURL(path.join(__dirname, 'renderer', 'player.html')).href}` +
    `?src=${encodeURIComponent(resolved.url)}` +
    `&asrc=${encodeURIComponent(resolved.audioUrl || '')}` +
    `&start=${Math.floor(startAt || 0)}` +
    `&cid=${meta.cid || ''}` +
    `&ep=${meta.epId || ''}` +
    `&dmOpacity=${Number(settings.danmakuOpacity ?? 1)}` +
    `&dmSize=${Number(settings.danmakuSize ?? 20)}` +
    `&dmSpeed=${Number(settings.danmakuSpeed ?? 1)}` +
    `&dmArea=${Number(settings.danmakuArea ?? 0.5)}` +
    `&dmOn=${settings.danmaku ? 1 : 0}`;
  await view.webContents.loadURL(localUrl).catch(() => {});
  sendToWin(entry.win, 'player-ready', { quality: resolved.quality, formats: resolved.formats });
  if (meta.cid) {
    fetchDanmaku(meta.cid).then((dm) => {
      if (!dm || !dm.list || !dm.list.length || view.webContents.isDestroyed()) return;
      view.webContents.executeJavaScript(
        `window.__setDanmaku && window.__setDanmaku(${JSON.stringify(dm.list)})`
      ).catch(() => {});
    }).catch(() => {});
  }
});

ipcMain.handle('player:danmaku', (event, on) => {
  const entry = entryFor(event);
  if (!entry || !entry.player || entry.player.webContents.isDestroyed()) return false;
  return entry.player.webContents.executeJavaScript(
    `window.__setDanmakuOn && window.__setDanmakuOn(${on ? 'true' : 'false'})`
  ).catch(() => false);
});

ipcMain.on('player:resize', (event, rect) => {
  const entry = entryFor(event);
  if (!entry || !entry.player || !rect) return;
  try {
    entry.player.setBounds({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    });
  } catch {}
});

ipcMain.on('player:hide', (event) => {
  const entry = entryFor(event);
  if (!entry) return;
  try {
    entry.player?.setVisible(false);
    entry.player?.webContents.setAudioMuted(true);
  } catch {}
});

ipcMain.on('web:show', (event, { rect, url }) => {
  const entry = entryFor(event);
  if (!entry || !rect || rect.width < 40 || !url) return;
  try {
    entry.player?.setVisible(false);
    entry.player?.webContents.setAudioMuted(true);
  } catch {}
  const view = ensureWeb(entry);
  view.setBounds({
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  });
  view.setVisible(true);
  try { view.webContents.setAudioMuted(false); } catch {}
  if (view.webContents.getURL() !== url) view.webContents.loadURL(url).catch(() => {});
});

ipcMain.on('web:hide', (event) => {
  const entry = entryFor(event);
  if (!entry) return;
  try {
    entry.web?.setVisible(false);
    entry.web?.webContents.setAudioMuted(true);
  } catch {}
});

ipcMain.on('aux:hide', (event) => {
  const entry = entryFor(event);
  if (!entry) return;
  try {
    entry.player?.setVisible(false);
    entry.player?.webContents.setAudioMuted(true);
  } catch {}
  try { entry.web?.setVisible(false); } catch {}
  try {
    entry.live?.setVisible(false);
    entry.live?.webContents.executeJavaScript('document.querySelectorAll("video").forEach(v=>v.pause())').catch(() => {});
  } catch {}
});

ipcMain.on('open-login', () => openLoginWindow());
ipcMain.handle('open-downloads', () => shell.openPath(getDownloadDir()));
ipcMain.handle('downloads-dir', () => getDownloadDir());
ipcMain.handle('downloads:pick', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getDownloadDir(),
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    settings.downloadDir = result.filePaths[0];
    saveSettings();
    return { ok: true, dir: getDownloadDir() };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});
ipcMain.handle('downloads:reset', () => {
  delete settings.downloadDir;
  saveSettings();
  return { ok: true, dir: getDownloadDir() };
});
ipcMain.handle('clear-cache', async () => {
  await session.fromPartition(PARTITION).clearCache();
  return true;
});

function pushWindowState(win) {
  if (!win || win.isDestroyed()) return;
  sendToWin(win, 'window-state', {
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
  });
}

ipcMain.on('win-control', (event, cmd) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (cmd === 'minimize') win.minimize();
  else if (cmd === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (cmd === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (cmd === 'close') win.close();
  setTimeout(() => pushWindowState(win), 60);
});

ipcMain.handle('win-state', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { maximized: false, fullscreen: false };
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
});

/* ------------------------------ 应用内更新 ------------------------------ */

/**
 * 更新清单（一个静态 JSON，放 GitHub Releases / Gitee / OSS / 任意静态托管都行）：
 * {
 *   "version": "1.3.0",
 *   "notes": "修复…；新增…",
 *   "publishedAt": "2026-11-02",
 *   "url": "https://…/BiliFound-1.3.0-Setup-x64.exe",
 *   "size": 98123456,
 *   "sha256": "…",
 *   "portableUrl": "https://…/BiliFound-1.3.0-Portable-x64.exe"
 * }
 * 也兼容 {"platforms":{"win32-x64":{...}}} 的写法。
 */

function versionParts(v) {
  return String(v || '').replace(/^v/i, '').split(/[.+-]/).map((x) => Number(x) || 0);
}

function compareVersion(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function fetchJsonNoCache(url) {
  const ses = session.fromPartition(PARTITION);
  const res = await ses.fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('更新清单不是合法 JSON');
  }
}

function pickUpdateAsset(data) {
  const platforms = (data && data.platforms) || {};
  const a = platforms['win32-x64'] || platforms.win64 || platforms.windows || data || {};
  return {
    url: String(a.url || a.installer || ''),
    sha256: String(a.sha256 || ''),
    size: Number(a.size) || 0,
    portableUrl: String(a.portableUrl || (data && data.portableUrl) || ''),
  };
}

async function checkUpdate({ force = false } = {}) {
  const feed = String(settings.updateFeed || '').trim() || DEFAULT_UPDATE_FEED;
  if (!feed) return { ok: false, code: 'no-feed', message: '还没有配置更新地址（设置 → 更新，或填写仓库地址）' };
  if (!/^https?:/i.test(feed)) return { ok: false, code: 'bad-feed', message: '更新地址必须是 http(s) 链接' };
  try {
    const data = await fetchJsonNoCache(feed);

    // GitHub Releases API：tag_name / body / assets
    if (data && data.tag_name) {
      const latest = String(data.tag_name).replace(/^v/i, '').trim();
      const current = app.getVersion();
      const assets = (data.assets || []).map((a) => ({
        name: String(a.name || ''),
        url: String(a.browser_download_url || ''),
        size: Number(a.size) || 0,
      }));
      const mac = assets.find((a) => /\.(zip|dmg)$/i.test(a.name) && /(mac|arm64|darwin)/i.test(a.name))
        || assets.find((a) => /\.(zip|dmg)$/i.test(a.name))
        || assets[0];
      settings.lastUpdateCheck = Date.now();
      saveSettings();
      return {
        ok: true,
        source: 'github',
        current,
        latest,
        newer: compareVersion(latest, current) > 0,
        skipped: !force && settings.updateSkipped === latest,
        notes: String(data.body || ''),
        publishedAt: String(data.published_at || ''),
        asset: mac ? { url: mac.url, size: mac.size, sha256: '' } : { url: '', sha256: '', size: 0 },
      };
    }

    const latest = String(data.version || '').trim();
    if (!latest) return { ok: false, code: 'bad-manifest', message: '更新清单缺少 version 字段' };
    const current = app.getVersion();
    const newer = compareVersion(latest, current) > 0;
    settings.lastUpdateCheck = Date.now();
    saveSettings();
    return {
      ok: true,
      current,
      latest,
      newer,
      skipped: !force && settings.updateSkipped === latest,
      notes: String(data.notes || ''),
      publishedAt: String(data.publishedAt || ''),
      asset: pickUpdateAsset(data),
    };
  } catch (err) {
    return { ok: false, code: 'network', message: String((err && err.message) || err) };
  }
}

ipcMain.handle('update:check', (_e, opts) => checkUpdate(opts || {}));
ipcMain.handle('update:version', () => ({ version: app.getVersion(), feed: settings.updateFeed || DEFAULT_UPDATE_FEED, customFeed: settings.updateFeed || '', repo: GITHUB_REPO }));
ipcMain.handle('update:skip', (_e, version) => {
  settings.updateSkipped = String(version || '');
  saveSettings();
  return { ok: true };
});

let updateDownloading = false;

ipcMain.handle('update:download', async (event, asset) => {
  if (updateDownloading) return { ok: false, message: '正在下载中，请稍候' };
  const url = String((asset && asset.url) || '');
  if (!/^https?:/i.test(url)) return { ok: false, message: '清单里没有可用的下载地址' };
  const win = BrowserWindow.fromWebContents(event.sender);
  updateDownloading = true;
  try {
    const ses = session.fromPartition(PARTITION);
    const res = await ses.fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || Number(asset.size) || 0;
    const dir = path.join(app.getPath('temp'), 'BiliFound-update');
    fs.mkdirSync(dir, { recursive: true });
    let base = 'BiliFound-update.exe';
    try {
      base = decodeURIComponent(path.basename(new URL(url).pathname)) || base;
    } catch {}
    const file = uniquePath(dir, sanitizeFilename(base, 120));
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash('sha256');
    let received = 0;
    let lastAt = 0;
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      received += buf.length;
      hash.update(buf);
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (now - lastAt > 200) {
        lastAt = now;
        sendToWin(win, 'update-progress', { received, total, file });
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    const digest = hash.digest('hex');
    if (asset.sha256 && digest.toLowerCase() !== String(asset.sha256).toLowerCase()) {
      try { fs.unlinkSync(file); } catch {}
      throw new Error('校验失败（sha256 不匹配），已删除下载的文件');
    }
    sendToWin(win, 'update-progress', { received, total: total || received, file, done: true });
    return { ok: true, file, size: received, sha256: digest };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  } finally {
    updateDownloading = false;
  }
});

ipcMain.handle('update:reveal', (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(String(filePath))) return { ok: false, message: '文件不存在' };
    shell.showItemInFolder(String(filePath));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

ipcMain.handle('update:install', async (_e, { file, quit = true } = {}) => {
  try {
    if (!file || !fs.existsSync(String(file))) return { ok: false, message: '安装包不存在，请重新下载' };
    const target = String(file);
    // macOS：zip 先解压，再揭示 .app；dmg / 其它交给系统
    if (isMac && /\.zip$/i.test(target)) {
      const out = path.join(app.getPath('temp'), 'BiliFound-update', 'extracted');
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      await new Promise((resolve, reject) => {
        execFile('ditto', ['-x', '-k', target, out], (e) => (e ? reject(e) : resolve()));
      });
      shell.openPath(out);
      return { ok: true, extracted: out };
    }
    const err = await shell.openPath(target);
    if (err) return { ok: false, message: err };
    // 安装器要替换正在运行的 exe：稍等再退出，交给安装程序接管
    if (quit) setTimeout(() => app.quit(), 1200);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message) };
  }
});

/* 启动后静默检查一次（6 小时内不重复；可在设置里关掉） */
function autoCheckUpdateSoon(entry) {
  if (!settings.updateAutoCheck) return;
  if (!String(settings.updateFeed || '').trim() && !DEFAULT_UPDATE_FEED) return;
  const last = Number(settings.lastUpdateCheck || 0);
  if (last && Date.now() - last < 6 * 3600 * 1000) return;
  setTimeout(async () => {
    const r = await checkUpdate({ force: false });
    if (r && r.ok && r.newer && !r.skipped && entry.win && !entry.win.isDestroyed()) {
      sendToWin(entry.win, 'update-available', { version: r.latest, notes: r.notes });
    }
  }, 4000);
}

/* --------------------------- 菜单 / 快捷键 --------------------------- */

function sendShortcut(name) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('shortcut', name);
}

function buildAppMenu() {
  const send = (n) => () => sendShortcut(n);
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
            { type: 'separator' },
            { role: 'services' }, { type: 'separator' },
            { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
            { type: 'separator' }, { role: 'quit' },
          ],
        }]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建窗口', accelerator: 'CmdOrCtrl+N', click: () => createShellWindow() },
        { type: 'separator' },
        { label: '搜索…', accelerator: 'CmdOrCtrl+K', click: send('search') },
        { label: '回到首页', accelerator: 'CmdOrCtrl+Shift+H', click: send('home') },
        { type: 'separator' },
        { label: '登录哔哩哔哩…', click: () => openLoginWindow() },
        { label: '打开下载文件夹', click: () => shell.openPath(getDownloadDir()) },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ label: '退出', accelerator: 'Alt+F4', role: 'quit' }]),
      ],
    },
    ...(!isMac
      ? [{
          label: '编辑',
          submenu: [
            { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
            { type: 'separator' },
            { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
            { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
          ],
        }]
      : []),
    {
      label: '浏览',
      submenu: [
        { label: '后退', accelerator: isWin ? 'Alt+Left' : 'CmdOrCtrl+[', click: send('back') },
        { label: '前进', accelerator: isWin ? 'Alt+Right' : 'CmdOrCtrl+]', click: send('forward') },
        { label: '刷新', accelerator: isWin ? 'F5' : 'CmdOrCtrl+R', click: send('reload') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '显示 / 隐藏侧边栏', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') },
        { type: 'separator' },
        { label: '深色 / 浅色切换', accelerator: 'CmdOrCtrl+Shift+D', click: send('toggle-theme') },
        { type: 'separator' },
        { label: '切换全屏', accelerator: isWin ? 'F11' : undefined, role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
        : [
            { label: '最小化', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.minimize(); } },
            {
              label: '最大化 / 还原',
              click: () => {
                const w = BrowserWindow.getFocusedWindow();
                if (!w) return;
                if (w.isMaximized()) w.unmaximize(); else w.maximize();
              },
            },
            { label: '关闭', accelerator: 'Ctrl+W', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.close(); } },
          ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) return;
            win.show();
            win.focus();
            win.webContents.send('update-open');
          },
        },
        { type: 'separator' },
        { label: '打开下载文件夹', click: () => shell.openPath(getDownloadDir()) },
        {
          label: `关于 ${APP_NAME}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: `关于 ${APP_NAME}`,
              message: `${APP_NAME} ${app.getVersion()}`,
              detail: [
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
                `平台：${process.platform} ${process.arch}`,
                `下载目录：${getDownloadDir()}`,
                '',
                '原生界面 · 液态玻璃的哔哩哔哩桌面客户端',
              ].join('\n'),
              buttons: ['确定'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------ 启动 ------------------------------ */

nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWin(win, 'theme-changed', { dark: nativeTheme.shouldUseDarkColors });
  }
});

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'window') {
    contents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file://') && !url.includes('passport.bilibili.com')) e.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // 窗口尺寸同步状态给渲染层（最大化 / 全屏按钮的图标）
    contents.on('did-finish-load', () => {
      const win = BrowserWindow.fromWebContents(contents);
      if (win) pushWindowState(win);
    });
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const first = [...windows.values()][0];
    if (first) {
      if (first.win.isMinimized()) first.win.restore();
      first.win.show();
      first.win.focus();
    } else {
      createShellWindow();
    }
  });

  app.whenReady().then(() => {
    setupSession();
    buildAppMenu();
    createShellWindow();
    app.on('activate', () => {
      if (windows.size === 0) createShellWindow();
    });
  });
}

app.on('before-quit', () => {
  for (const entry of windows.values()) destroyAuxViews(entry);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

'use strict';
/* BiliFound · 原生界面逻辑（数据来自 bilibili 接口） */

const bridge = window.bg;
const $ = (id) => document.getElementById(id);
const html = document.documentElement;

/* Windows 版：平台标识提前落到 <html> 上，后续样式（标题栏留白、窗口按钮）据此切换 */
const IS_WIN = bridge.platform === 'win32';
if (IS_WIN) html.classList.add('platform-win');
/** 快捷键标签：Windows 用 Ctrl，mac 保留 ⌘ */
const MOD = IS_WIN ? 'Ctrl' : '⌘';
const modKey = (combo) => `${MOD}${combo}`;

/* ------------------------------ 基础状态 ------------------------------ */

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('bg:' + k);
      return v === null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('bg:' + k, JSON.stringify(v)); } catch {}
  },
};

const state = {
  scrollPos: {},
  dynCache: new Map(),
  route: { name: 'home', params: {} },
  history: [],
  historyIndex: -1,
  theme: store.get('theme', 'auto'),
  style: store.get('style', 'classic'),
  collapsed: store.get('collapsed', false),
  settings: { autoplay: true, danmaku: true },
  login: null,
  cache: new Map(),
  feeds: { home: { pn: 0, items: [], done: false, fresh: 1 }, hot: { pn: 0, items: [], done: false }, search: { page: 0, items: [], done: false, q: '' } },
  loadingMore: false,
  hotSearch: null,
  histExpanded: false,
  auxObserver: null,
  winMaximized: false,
  winFullscreen: false,
};

/* ------------------------------ 外观 / 背景 ------------------------------ */

const ACCENTS = {
  pink: ['#fb7299', '#ff9db8'],
  violet: ['#8b5cf6', '#a78bfa'],
  blue: ['#3b82f6', '#60a5fa'],
  teal: ['#14b8a6', '#2dd4bf'],
  amber: ['#f59e0b', '#fbbf24'],
};

const BG_GRADIENTS = [
  { id: 'sunset', css: 'linear-gradient(140deg,#ff9a9e 0%,#fad0c4 46%,#fbc2eb 100%)' },
  { id: 'ocean', css: 'linear-gradient(140deg,#2b5876 0%,#4e4376 100%)' },
  { id: 'mint', css: 'linear-gradient(140deg,#a8edea 0%,#fed6e3 100%)' },
  { id: 'dusk', css: 'linear-gradient(140deg,#0f2027 0%,#203a43 52%,#2c5364 100%)' },
  { id: 'peach', css: 'linear-gradient(140deg,#ffecd2 0%,#fcb69f 100%)' },
  { id: 'graphite', css: 'linear-gradient(140deg,#232526 0%,#414345 100%)' },
];

const BG_COLORS = ['#f2f4f9', '#dfe7f5', '#111318', '#1b2130', '#2a2030', '#14231f'];

function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyAppearance() {
  const s = state.settings || {};
  const accent = ACCENTS[s.accent] || ACCENTS.pink;
  const root = document.documentElement.style;
  root.setProperty('--accent', accent[0]);
  root.setProperty('--accent-2', accent[1]);
  root.setProperty('--accent-soft', hexToRgba(accent[0], 0.14));
  root.setProperty('--accent-ring', hexToRgba(accent[0], 0.32));
  root.setProperty('--blur', `${Number(s.glassBlur) || 30}px`);
  document.documentElement.classList.toggle('compact', s.density === 'compact');
  document.body.classList.toggle('no-grain', s.grain === false);
  applyBackground();
}

function applyBackground() {
  const bg = (state.settings && state.settings.background) || {};
  const base = $('bg-base');
  const image = $('bg-image');
  if (!base || !image) return;
  const type = bg.type || 'aurora';
  document.body.classList.toggle('has-bg-image', type === 'image' && !!bg.value);
  if (type === 'image' && bg.value) {
    image.style.backgroundImage = `url("${bg.value}")`;
    base.style.background = 'linear-gradient(160deg, #12151c, #1a1f2b)';
  } else if (type === 'gradient' && bg.value) {
    image.style.backgroundImage = '';
    base.style.background = bg.value;
  } else if (type === 'color' && bg.value) {
    image.style.backgroundImage = '';
    base.style.background = bg.value;
  } else {
    image.style.backgroundImage = '';
    base.style.background = '';
  }
  document.documentElement.style.setProperty('--bg-blur', `${Number(bg.blur) || 0}px`);
  document.documentElement.style.setProperty('--bg-dim', String(Number(bg.dim ?? 0.15)));
}

function renderBgPresets() {
  const box = $('bg-presets');
  if (!box) return;
  const bg = state.settings.background || {};
  const type = bg.type || 'aurora';
  if (type === 'gradient') {
    box.innerHTML = BG_GRADIENTS.map((g) => `
      <button class="bg-preset${bg.value === g.css ? ' on' : ''}" data-css="${esc(g.css)}"
        style="background:${g.css}" title="${g.id}"></button>`).join('');
  } else if (type === 'color') {
    box.innerHTML = BG_COLORS.map((c) => `
      <button class="bg-preset${bg.value === c ? ' on' : ''}" data-css="${c}"
        style="background:${c}" title="${c}"></button>`).join('');
  } else if (type === 'image' && bg.value) {
    box.innerHTML = `<div class="bg-preset on" style="background-image:url('${esc(bg.value)}')"></div>`;
  } else {
    box.innerHTML = '';
  }
  box.querySelectorAll('.bg-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSetting({ background: { ...(state.settings.background || {}), type, value: btn.dataset.css } });
    });
  });
}

function applySettingsUI() {
  const s = state.settings || {};
  const bg = s.background || {};
  const setVal = (id, v) => { const el = $(id); if (el) el.value = String(v); };
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const check = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

  check('set-autoplay', s.autoplay);
  check('set-danmaku', s.danmaku);
  const q = $('set-quality');
  if (q) q.value = String(Number(s.defaultQuality) || 0);
  check('set-grain', s.grain !== false);
  setVal('set-blur', s.glassBlur ?? 30);
  setText('blur-val', `${s.glassBlur ?? 30}px`);
  setVal('set-bg-blur', bg.blur || 0);
  setText('bgblur-val', `${bg.blur || 0}px`);
  setVal('set-bg-dim', Math.round((bg.dim ?? 0.15) * 100));
  setText('bgdim-val', `${Math.round((bg.dim ?? 0.15) * 100)}%`);
  setVal('set-dm-size', s.danmakuSize ?? 20);
  setText('dmsize-val', `${s.danmakuSize ?? 20}px`);
  setVal('set-dm-opacity', Math.round((s.danmakuOpacity ?? 1) * 100));
  setText('dmop-val', `${Math.round((s.danmakuOpacity ?? 1) * 100)}%`);
  setVal('set-dm-speed', Math.round((s.danmakuSpeed ?? 1) * 10));
  setText('dmsp-val', `${(s.danmakuSpeed ?? 1).toFixed(1)}×`);

  document.querySelectorAll('#accent-row .accent').forEach((b) => {
    b.classList.toggle('on', b.dataset.accent === (s.accent || 'pink'));
  });
  document.querySelectorAll('#density-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.density === (s.density || 'comfortable'));
  });
  document.querySelectorAll('#bg-type-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.bg === (bg.type || 'aurora'));
  });
  document.querySelectorAll('#theme-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === state.theme);
  });
  renderBgPresets();
  renderStylePresets();
}

function saveSetting(patch) {
  state.settings = { ...state.settings, ...patch };
  bridge.setSettings(patch).catch(() => {});
  applyAppearance();
  applySettingsUI();
}

function updateScrollTop() {
  const btn = $('scroll-top');
  if (!btn) return;
  // 视频/番剧/直播页的内容在自己的容器里滚动，按当前生效的那一层判断
  const inner = document.querySelector('.watch-scroll');
  const top = inner ? inner.scrollTop : view.scrollTop;
  btn.hidden = top < 360;
}

/* ------------------------------ 命令面板 ------------------------------ */

const PALETTE_ICONS = {
  home: '<path d="M4 11l8-7 8 7M6 10v9h12v-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  dynamic: '<circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8l1.2 2.4 2.6.4-1.9 1.9.4 2.6L12 14l-2.3 1.3.4-2.6-1.9-1.9 2.6-.4L12 8z" fill="currentColor"/>',
  hot: '<path d="M12 3.5s1.1 2.9-1.4 5.3C8.2 11.1 7.4 12.6 7.4 14.5a4.7 4.7 0 0 0 9.4.4c0-1.9-.9-3.3-1.9-4.3 0 1.3-.7 1.9-1.5 2.1.4-2.5-.4-5.7-1.4-9.2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  rank: '<path d="M5 19V11M12 19V5M19 19v-6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
  bangumi: '<rect x="3.5" y="7" width="17" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.4 11.2v4.6l4-2.3-4-2.3z" fill="currentColor"/>',
  live: '<circle cx="12" cy="10" r="2.2" fill="currentColor"/><path d="M8 6.4a5.8 5.8 0 0 0 0 7.2M16 6.4a5.8 5.8 0 0 1 0 7.2M5.4 4a9.2 9.2 0 0 0 0 12M18.6 4a9.2 9.2 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8.6 17.6h6.8M10.2 20.2h3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  history: '<path d="M4 12a8 8 0 1 1 2.3 5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 21v-4.5h4.5M12 8v4.4l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  fav: '<path d="M6 4.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V5.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  watchlater: '<circle cx="12" cy="12" r="7.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8v4.3l2.7 1.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  refresh: '<path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19.7 4.7v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  top: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  theme: '<path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  immersive: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  settings: '<circle cx="12" cy="12" r="2.9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  'bg-pick': '<rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="M5 17l4.4-4.4L13 16l2.4-2.4L19 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  'bg-clear': '<rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 18.5L19.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  shortcuts: '<rect x="3" y="6.5" width="18" height="11" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17.5 10.5h.01M8 14h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  downloads: '<path d="M12 4v10.5m0 0L7.8 10.3M12 14.5l4.2-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 19h15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

/* 设计风格预设：只作用于卡片/圆角/字体/质感，不改结构 */
const STYLE_PRESETS = [
  { id: 'classic', name: '经典', desc: '柔和玻璃 + 22 圆角' },
  { id: 'magazine', name: '杂志', desc: '衬线标题 · 方正封面 · 细线' },
  { id: 'minimal', name: '极简', desc: '细边框 · 小圆角 · 无阴影' },
  { id: 'paper', name: '米纸', desc: '暖白底 · 硬阴影 · 印刷感' },
  { id: 'neon', name: '霓虹', desc: '深色玻璃 · 发光描边' },
];

const PALETTE_COMMANDS = [
  { id: 'home', icon: 'home', label: '首页', hint: modKey('+Shift+H'), run: () => navigate('home') },
  { id: 'dynamic', icon: 'dynamic', label: '动态', hint: '', run: () => navigate('dynamic') },
  { id: 'hot', icon: 'hot', label: '热门', hint: '', run: () => navigate('hot') },
  { id: 'rank', icon: 'rank', label: '排行榜', hint: '', run: () => navigate('rank') },
  { id: 'bangumi', icon: 'bangumi', label: '番剧', hint: '', run: () => navigate('bangumi') },
  { id: 'live', icon: 'live', label: '直播', hint: '', run: () => navigate('live') },
  { id: 'history', icon: 'history', label: '历史记录', hint: '', run: () => navigate('history') },
  { id: 'fav', icon: 'fav', label: '收藏夹', hint: '', run: () => navigate('fav') },
  { id: 'watchlater', icon: 'watchlater', label: '稍后再看', hint: '', run: () => navigate('watchlater') },
  { id: 'search', icon: 'search', label: '搜索', hint: modKey('+F'), run: () => focusSearch() },
  { id: 'refresh', icon: 'refresh', label: '刷新当前页面', hint: IS_WIN ? 'F5' : '⌘R', run: () => refreshCurrent() },
  { id: 'top', icon: 'top', label: '回到顶部', hint: '', run: () => view.scrollTo({ top: 0, behavior: 'smooth' }) },
  { id: 'theme', icon: 'theme', label: '切换主题', hint: modKey('+Shift+D'), run: () => cycleTheme() },
  ...STYLE_PRESETS.map((p) => ({
    id: `style-${p.id}`, icon: 'theme', label: `设计风格：${p.name}`, hint: p.desc, run: () => applyStyle(p.id),
  })),
  { id: 'immersive', icon: 'immersive', label: '沉浸模式', hint: modKey('+Shift+I'), run: () => toggleImmersive() },
  { id: 'settings', icon: 'settings', label: '偏好设置', hint: modKey('+,'), run: () => openSheet() },
  { id: 'bg-pick', icon: 'bg-pick', label: '选择背景图片…', hint: '', run: () => pickBackground() },
  { id: 'bg-clear', icon: 'bg-clear', label: '清除背景图片', hint: '', run: () => clearBackground() },
  { id: 'shortcuts', icon: 'shortcuts', label: '键盘快捷键', hint: modKey('+/'), run: () => openShortcuts() },
  { id: 'downloads', icon: 'downloads', label: '打开下载文件夹', hint: '', run: () => bridge.openDownloads() },
];

let paletteIndex = 0;
let paletteFiltered = PALETTE_COMMANDS;

function openPalette() {
  const el = $('palette');
  if (!el) return;
  el.hidden = false;
  const input = $('palette-input');
  if (input) { input.value = ''; input.focus(); }
  paletteIndex = 0;
  paletteFiltered = PALETTE_COMMANDS;
  renderPalette();
}

function closePalette() {
  const el = $('palette');
  if (el) el.hidden = true;
}

function renderPalette() {
  const list = $('palette-list');
  if (!list) return;
  const q = ($('palette-input')?.value || '').trim().toLowerCase();
  paletteFiltered = PALETTE_COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q) || c.id.includes(q));
  if (paletteIndex >= paletteFiltered.length) paletteIndex = Math.max(0, paletteFiltered.length - 1);
  if (!paletteFiltered.length) {
    list.innerHTML = '<div class="palette-empty">没有匹配的命令</div>';
    return;
  }
  list.innerHTML = paletteFiltered.map((c, i) => `
    <button class="palette-item${i === paletteIndex ? ' on' : ''}" data-idx="${i}">
      <span class="pi-icon"><svg viewBox="0 0 24 24">${PALETTE_ICONS[c.icon] || ''}</svg></span>
      <span class="pi-label">${esc(c.label)}</span>
      <span class="pi-hint">${esc(c.hint || '')}</span>
    </button>`).join('');
  list.querySelectorAll('.palette-item').forEach((btn) => {
    btn.addEventListener('click', () => runPalette(Number(btn.dataset.idx)));
  });
}

function runPalette(idx) {
  const cmd = paletteFiltered[idx];
  if (!cmd) return;
  closePalette();
  cmd.run();
}

/* ------------------------------ 快捷键面板 ------------------------------ */

const SHORTCUTS = [
  [IS_WIN ? 'Ctrl+F / Ctrl+K' : '⌘F / ⌘K', '聚焦搜索'],
  [IS_WIN ? 'Alt+← / Alt+→' : '⌘[ / ⌘]', '后退 / 前进'],
  [modKey('+Shift+H'), '回到首页'],
  [IS_WIN ? 'F5 / Ctrl+R' : '⌘R', '刷新当前页面'],
  [modKey('+Shift+D'), '切换主题'],
  [modKey('+Shift+I'), '沉浸模式'],
  [IS_WIN ? 'F11 / Ctrl+Shift+F' : '⌘⇧F', '窗口全屏'],
  [modKey('+\\'), '收起侧边栏'],
  [modKey('+,'), '偏好设置'],
  [modKey('+/'), '快捷键帮助'],
  [IS_WIN ? 'Ctrl+'+'W' : '⌘W', '关闭窗口'],
  ['空格', '播放 / 暂停'],
  ['← / →', '后退 / 前进 5 秒'],
  ['Esc', '关闭浮层 / 退出沉浸'],
];

function openShortcuts() {
  const el = $('shortcuts-sheet');
  if (!el) return;
  const grid = $('keys-grid');
  if (grid) {
    grid.innerHTML = SHORTCUTS.map(([k, v]) => `<div class="keys-row"><span>${esc(v)}</span><kbd>${esc(k)}</kbd></div>`).join('');
  }
  el.hidden = false;
}

function closeShortcuts() {
  const el = $('shortcuts-sheet');
  if (el) el.hidden = true;
}

/* ------------------------------ 沉浸 / 刷新 / 主题 ------------------------------ */

function toggleImmersive(force, silent) {
  const on = typeof force === 'boolean' ? force : !document.documentElement.classList.contains('immersive');
  document.documentElement.classList.toggle('immersive', on);
  store.set('immersive', on);
  const btn = $('btn-immersive');
  if (btn) btn.classList.toggle('active', on);
  if (!silent) toast(on ? '沉浸模式：开启（Esc 退出）' : '沉浸模式：关闭');
}

function refreshCurrent() {
  state.cache.clear();
  // 刷新后从顶部开始，不要恢复旧的滚动位置
  delete state.scrollPos[routeKey(state.route)];
  const name = state.route.name;
  const st = state.feeds[name === 'hot' ? 'hot' : 'home'];
  if (st && (name === 'home' || name === 'hot')) {
    st.pn = 0;
    st.items = [];
    st.done = false;
    if (name === 'home') st.fresh = (st.fresh || 1) + 1;
  }
  state.feeds.search = { page: 0, items: [], done: false, q: '' };
  render();
  toast('已刷新');
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
  store.set('theme', state.theme);
  applyTheme();
}

async function pickBackground() {
  const res = await bridge.pickBackground().catch(() => null);
  if (!res || !res.ok) {
    if (res && !res.canceled) toast(res.message || '选择失败');
    return;
  }
  saveSetting({ background: { ...(state.settings.background || {}), type: 'image', value: res.url } });
  toast('背景已更新');
}

async function clearBackground() {
  const bg = state.settings.background || {};
  if (bg.type === 'image' && bg.value) {
    const filePath = decodeURI(String(bg.value).replace('file://', ''));
    bridge.removeBackground(filePath).catch(() => {});
  }
  saveSetting({ background: { ...bg, type: 'aurora', value: '' } });
  toast('已恢复默认背景');
}

/* ------------------------------ 工具 ------------------------------ */

const NAV = [
  { id: 'home', label: '首页', icon: '<path d="M4 11l8-7 8 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9h12v-9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'dynamic', label: '动态', icon: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.6L13.8 11l3.7.5-2.7 2.6.6 3.7-3.4-1.8-3.4 1.8.6-3.7L6.5 11.5l3.7-.5L12 7.6z" fill="currentColor"/>' },
  { id: 'hot', label: '热门', icon: '<path d="M12 3s1.2 3-1.5 5.5C8 10.8 7 12.4 7 14.5A5 5 0 0 0 17 15c0-2-1-3.5-2-4.5 0 1.4-.8 2-1.6 2.2.4-2.6-.4-6-1.4-9.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
  { id: 'rank', label: '排行榜', icon: '<path d="M5 20V11M12 20V4M19 20v-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' },
  { id: 'film', label: '影视', icon: '<rect x="3" y="5.5" width="18" height="13" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5.5v13M16 5.5v13M3 12h18" stroke="currentColor" stroke-width="1.6"/>' },
  { id: 'bangumi', label: '番剧', icon: '<rect x="3.5" y="7" width="17" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 4.5L7 7l3 .2M15.5 4.5L17 7l-3 .2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 11.2v4.8l4.2-2.4-4.2-2.4z" fill="currentColor"/>' },
  { id: 'live', label: '直播', icon: '<circle cx="12" cy="10" r="2.3" fill="currentColor"/><path d="M7.9 6.3a6 6 0 0 0 0 7.4M16.1 6.3a6 6 0 0 1 0 7.4M5.2 3.9a9.4 9.4 0 0 0 0 12.2M18.8 3.9a9.4 9.4 0 0 1 0 12.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.4 17.4h7.2M10 20.2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  { id: 'search', label: '搜索', icon: '<circle cx="11" cy="11" r="6.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16 16l4.2 4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' },
  { sep: true },
  { id: 'history', label: '历史记录', icon: '<path d="M4 12a8 8 0 1 1 2.3 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 21v-4.5H8.5M12 8v4.4l3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'fav', label: '收藏夹', icon: '<path d="M6 4.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V5.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
  { id: 'im', label: '私信', icon: '<path d="M4.5 5.5h15v10.5h-8.5L6 19.5V16H4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' },
  { id: 'messages', label: '消息', icon: '<path d="M4.5 5.5h15v11h-9l-4.5 3v-3h-1.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.6h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' },
  { id: 'watchlater', label: '稍后再看', icon: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ''); }
function httpsUrl(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (s.startsWith('//')) s = 'https:' + s;
  if (s.startsWith('http://')) s = 'https://' + s.slice(7);
  return s;
}
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}
function fmtDur(sec) {
  const n = typeof sec === 'string' ? (sec.includes(':') ? sec : Number(sec)) : Number(sec || 0);
  if (typeof n === 'string') return n;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return (h > 0 ? h + ':' : '') + String(m).padStart(h > 0 ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
}
function fmtDate(ts) {
  const d = new Date((ts || 0) * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function api(path) {
  if (state.cache.has(path)) return state.cache.get(path);
  const data = await bridge.api(path);
  if (data && data.code === 0) state.cache.set(path, data);
  else if (data && (data.code === -352 || data.code === -412)) {
    state.cache.set(path, data);
  }
  return data;
}

/* ------------------------------ 主题 / 设置 ------------------------------ */

function applyStyle(id) {
  const valid = STYLE_PRESETS.some((x) => x.id === id) ? id : 'classic';
  state.style = valid;
  store.set('style', valid);
  document.documentElement.dataset.style = valid;
  document.querySelectorAll('#style-presets .style-card').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === valid);
  });
}

function renderStylePresets() {
  const box = $('style-presets');
  if (!box || box.dataset.built) {
    document.querySelectorAll('#style-presets .style-card').forEach((b) => {
      b.classList.toggle('on', b.dataset.style === state.style);
    });
    return;
  }
  box.dataset.built = '1';
  box.innerHTML = STYLE_PRESETS.map((p) => `
    <button class="style-card" data-style="${p.id}" title="${esc(p.desc)}">
      <span class="sp-prev sp-${p.id}"><i></i><b></b><em></em></span>
      <span class="sp-name">${esc(p.name)}</span>
    </button>`).join('');
  box.querySelectorAll('.style-card').forEach((b) => {
    b.addEventListener('click', () => {
      applyStyle(b.dataset.style);
      toast(`设计风格：${(STYLE_PRESETS.find((x) => x.id === b.dataset.style) || {}).name || ''}`);
    });
  });
  applyStyle(state.style);
}

function applyTheme() {
  let dark;
  if (state.theme === 'dark') dark = true;
  else if (state.theme === 'light') dark = false;
  else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  html.dataset.theme = dark ? 'dark' : 'light';
  for (const b of document.querySelectorAll('#theme-seg button')) {
    b.classList.toggle('on', b.dataset.theme === state.theme);
  }
  const themeBtn = $('btn-theme');
  if (themeBtn) themeBtn.classList.toggle('active', state.theme === 'dark');
}
applyTheme();
applyStyle(state.style);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});
bridge.on('theme-changed', () => { if (state.theme === 'auto') applyTheme(); });
bridge.on('live-fullscreen', (payload) => {
  state.liveFs = !!(payload && payload.on);
  document.documentElement.classList.toggle('live-fs', state.liveFs);
  if (!state.liveFs) {
    setTimeout(() => {
      const slot = document.querySelector('.live-frame .player-slot');
      if (slot && state.liveUrl) {
        const r = slot.getBoundingClientRect();
        if (r.width > 40) bridge.liveShow({ url: state.liveUrl, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
      }
    }, 80);
  }
});
bridge.on('video-fullscreen', (payload) => {
  state.videoFs = !!(payload && payload.on);
  document.documentElement.classList.toggle('video-fs', state.videoFs);
  if (!state.videoFs) {
    // 退出后重新贴合播放器槽位
    setTimeout(() => {
      const slot = document.querySelector('.player-slot');
      if (slot) {
        const r = slot.getBoundingClientRect();
        if (r.width > 40) bridge.playerResize({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
    }, 80);
  }
});

async function loadSettings() {
  const s = await bridge.getSettings().catch(() => null);
  if (s) state.settings = { ...state.settings, ...s };
  applyAppearance();
  applySettingsUI();
}

/* ------------------------------ Toast ------------------------------ */

let toastTimer = null;
function toast(text) {
  const stack = document.getElementById('toast-stack') || (() => {
    const box = document.createElement('div');
    box.id = 'toast-stack';
    box.className = 'toast-stack';
    document.body.appendChild(box);
    return box;
  })();
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.textContent = text;
  stack.appendChild(el);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, 2400);
}
bridge.on('player-rate', (rate) => {
  const val = Math.max(0.25, Math.min(4, Number(rate) || 1));
  state.settings.rate = val;
  const el = $('ctl-speed');
  if (el) el.textContent = fmtRate(val);
  bridge.setSettings({ rate: val }).catch(() => {});
});

bridge.on('player-volume', (value) => {
  const v = Math.max(0, Math.min(1, Number(value)));
  if (!Number.isFinite(v)) return;
  state.settings.volume = v;
  const el = $('ctl-vol');
  if (el) el.value = String(Math.round(v * 100));
});

bridge.on('download-toast', (d) => {
  if (!d) return;
  if (d.state === 'progress' && d.total) {
    toast(`下载中 ${Math.round((d.received / d.total) * 100)}% · ${d.name}`);
  } else if (d.state === 'done') {
    toast(`下载完成：${d.name}`);
  } else if (d.state === 'failed') {
    toast(`下载失败：${d.name}`);
  } else {
    toast(`开始下载：${d.name}`);
  }
});

/* ------------------------------ 应用内更新 ------------------------------ */

const DEFAULT_UPDATE_REPO = 'https://github.com/NstyZ/BiliFound';

const updateUI = { latest: '', file: '', asset: null, busy: false };

function setUpdateStatus(text, tone) {
  const el = $('up-status');
  if (!el) return;
  el.textContent = text;
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
}

function paintUpdateInfo(info) {
  if (!info) return;
  const cur = $('up-current');
  if (cur) cur.textContent = `v${info.version}`;
  const ver = $('about-ver');
  if (ver) ver.textContent = `v${info.version}`;
  const feed = $('up-feed');
  if (feed && !String((state.settings || {}).updateFeed || '').trim()) {
    // 默认指向本项目仓库；留空也能用，但这里填上更直观
    feed.value = DEFAULT_UPDATE_REPO;
  }
  if (feed && !feed.value) feed.value = info.customFeed || '';
}

async function initUpdatePanel() {
  const info = await bridge.updateInfo().catch(() => null);
  paintUpdateInfo(info);
  const auto = $('up-auto');
  if (auto) auto.checked = state.settings.updateAutoCheck !== false;
  if (info && !info.customFeed) {
    setUpdateStatus(info.repo
      ? `留空即从 GitHub Releases 检查更新（${info.repo}）`
      : '还没有配置更新地址：留空使用 GitHub Releases，或填写 latest.json 地址。');
  }
}

async function runUpdateCheck(force) {
  if (updateUI.busy) return;
  updateUI.busy = true;
  setUpdateStatus('正在检查更新…');
  try {
    const r = await bridge.checkUpdate({ force: !!force }).catch(() => null);
    if (!r) return setUpdateStatus('检查失败：主进程无响应', 'bad');
    if (!r.ok) return setUpdateStatus(`检查失败：${r.message}`, 'bad');
    if (!r.newer) {
      setUpdateStatus(`已是最新版本（v${r.current}）`, 'ok');
      const btn = $('btn-install-update');
      if (btn) btn.hidden = true;
      return;
    }
    updateUI.latest = r.latest;
    updateUI.asset = r.asset || null;
    updateUI.file = '';
    const mb = r.asset && r.asset.size ? ` · ${(r.asset.size / 1048576).toFixed(1)} MB` : '';
    const lines = [`发现新版本 v${r.latest}（当前 v${r.current}）${mb}`];
    if (r.publishedAt) lines.push(`发布时间：${r.publishedAt}`);
    if (r.notes) lines.push('', r.notes);
    setUpdateStatus(lines.join('\n'), 'new');
    const install = $('btn-install-update');
    if (install) {
      install.hidden = false;
      install.textContent = r.asset && r.asset.url ? '下载并安装' : '清单里没有下载地址';
      install.disabled = !(r.asset && r.asset.url);
    }
    const reveal = $('btn-reveal-update');
    if (reveal) reveal.hidden = true;
  } finally {
    updateUI.busy = false;
  }
}

async function onUpdateInstallClick() {
  const btn = $('btn-install-update');
  // 已下载过 → 直接启动安装
  if (updateUI.file) {
    setUpdateStatus('正在启动安装程序…本程序会自动退出，按提示完成安装即可。');
    const r = await bridge.installUpdate({ file: updateUI.file, quit: true }).catch(() => null);
    if (!r || !r.ok) setUpdateStatus(`启动安装失败：${(r && r.message) || '未知错误'}`, 'bad');
    return;
  }
  const asset = updateUI.asset;
  if (!asset || !asset.url) return setUpdateStatus('清单里没有可用的下载地址', 'bad');
  if (btn) btn.disabled = true;
  setUpdateStatus('开始下载…');
  try {
    const r = await bridge.downloadUpdate(asset).catch(() => null);
    if (!r || !r.ok) return setUpdateStatus(`下载失败：${(r && r.message) || '未知错误'}`, 'bad');
    updateUI.file = r.file;
    const mb = (r.size / 1048576).toFixed(1);
    setUpdateStatus(`已下载（${mb} MB，sha256 校验通过）\n${r.file}\n点「立即安装」启动安装程序；也可以「打开下载位置」手动运行。`, 'ok');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '立即安装';
      btn.hidden = false;
    }
    const reveal = $('btn-reveal-update');
    if (reveal) reveal.hidden = false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

bridge.on('update-progress', (p) => {
  if (!p || !p.received) return;
  const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
  const recv = (p.received / 1048576).toFixed(1);
  const total = p.total ? (p.total / 1048576).toFixed(1) : '';
  setUpdateStatus(`下载中 ${pct}%（${recv}${total ? ' / ' + total : ''} MB）`);
});

bridge.on('update-available', (d) => {
  if (!d || !d.version) return;
  if (state.route && state.route.name === 'settings') return;
  toast(`发现新版本 v${d.version}，可在 设置 → 更新 安装`);
});

bridge.on('update-open', () => {
  openSheet();
  setUpdateStatus('正在检查更新…');
  runUpdateCheck(true);
});

/* ------------------------------ 登录 ------------------------------ */

async function refreshLogin() {
  const nav = await api('/x/web-interface/nav');
  const wasLogin = !!state.login;
  state.login = nav && nav.data && nav.data.isLogin ? nav.data : null;
  // 启动时若先渲染了需要登录的页面，登录态就绪后自动重渲染
  if (!wasLogin && state.login) {
    const gated = ['dynamic', 'history', 'fav', 'watchlater'];
    if (gated.includes(state.route.name) && document.querySelector('.empty')) {
      render();
    }
  }
  const avatar = $('avatar');
  const label = $('login-label');
  if (state.login) {
    avatar.src = httpsUrl(state.login.face);
    avatar.hidden = false;
    $('login-ico').hidden = true;
    label.textContent = state.login.uname || '已登录';
  } else {
    avatar.hidden = true;
    $('login-ico').hidden = false;
    label.textContent = '登录';
  }
}
bridge.on('login-changed', () => { state.cache.clear(); refreshLogin(); });

bridge.on('player-ready', (info) => {
  const btn = document.getElementById('ctl-quality');
  if (btn && info && Array.isArray(info.formats)) {
    const f = info.formats.find((x) => x.qn === info.quality);
    if (f) btn.textContent = f.label.replace(/\s+/g, '');
  }
});

bridge.on('player-error', (info) => {
  toast((info && info.message) || '播放失败');
});

/* ------------------------------ 侧边栏 ------------------------------ */

function renderSidebar() {
  const nav = $('side-nav');
  let groupIndex = 0;
  const groups = ['浏览', '我的'];
  nav.innerHTML = NAV.map((n, i) => {
    if (n.sep) {
      groupIndex = Math.min(groups.length - 1, groupIndex + 1);
      return `<div class="side-sep"></div><div class="side-group">${groups[groupIndex]}</div>`;
    }
    const label = i === 0 ? `<div class="side-group">${groups[0]}</div>` : '';
    return `${label}<button class="side-btn" data-nav="${n.id}" title="${n.label}">
        <svg viewBox="0 0 24 24">${n.icon}</svg><span>${n.label}</span>
      </button>`;
  }).join('');
  nav.querySelectorAll('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.nav === 'search') focusSearch();
      else navigate(b.dataset.nav);
    });
  });
  syncSidebar();
}

function syncSidebar() {
  const name = state.route.name;
  document.querySelectorAll('#side-nav .side-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === name);
  });
  html.classList.toggle('sidebar-collapsed', state.collapsed);
}

function toggleSidebar() {
  state.collapsed = !state.collapsed;
  store.set('collapsed', state.collapsed);
  syncSidebar();
}

/* ------------------------------ 路由 ------------------------------ */

function routeKey(route) {
  try { return route.name + ':' + JSON.stringify(route.params || {}); } catch { return route.name; }
}

function navigate(name, params = {}) {
  state.scrollPos[routeKey(state.route)] = view.scrollTop;
  state.route = { name, params };
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  state.history.push({ name, params });
  state.historyIndex = state.history.length - 1;
  if (!['web', 'liveRoom', 'video'].includes(name)) {
    store.set('lastRoute', { name, params });
  }
  render();
}

// 调试/自动化入口（便于定位问题）
window.__bgNav = (name, params) => navigate(name, params || {});
window.__bgState = () => state;

// 播放器是原生 WebContentsView，滚轮事件到不了外壳 DOM：
// 播放器把滚轮转发给主进程，再由主进程调这里滚动下方内容（进而触发播放器收缩）
window.__bgWheel = (dy) => {
  const scroller = document.querySelector('.watch-scroll');
  if (!scroller) return;
  scroller.scrollTop += Number(dy) || 0;
};

function goBack() {
  if (state.historyIndex <= 0) return;
  state.scrollPos[routeKey(state.route)] = view.scrollTop;
  state.historyIndex -= 1;
  state.route = state.history[state.historyIndex];
  render();
}

function goForward() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.scrollPos[routeKey(state.route)] = view.scrollTop;
  state.historyIndex += 1;
  state.route = state.history[state.historyIndex];
  render();
}

/* ------------------------------ 渲染入口 ------------------------------ */

const view = $('view');

function hideAux() {
  bridge.playerHide();
  bridge.webHide();
  bridge.liveHide();
  state.auxObserver?.disconnect();
  state.auxObserver = null;
}

async function render() {
  hideAux();
  bridge.liveDanmakuStop();
  if (watchBlockCleanup) { try { watchBlockCleanup(); } catch {} watchBlockCleanup = null; }
  if (state.heroTimer) { clearInterval(state.heroTimer); state.heroTimer = null; }
  if (state.homeColObserver) { state.homeColObserver.disconnect(); state.homeColObserver = null; }
  if (state.videoFs) { state.videoFs = false; document.documentElement.classList.remove('video-fs'); bridge.playerFullscreen({ on: false }); }
  if (state.liveFs) { state.liveFs = false; document.documentElement.classList.remove('live-fs'); bridge.liveFullscreen({ on: false }); }
  stopProgressSaver();
  stopPlayerPolling();
  const restoreTo = state.scrollPos[routeKey(state.route)] || 0;
  state.onScroll = null;
  syncSidebar();
  $('btn-back').disabled = state.historyIndex <= 0;
  view.scrollTop = 0;

  const r = state.route;
  let task = null;
  if (r.name === 'home') task = renderFeed('home', '首页', '来自热门推荐');
  else if (r.name === 'hot') task = renderFeed('hot', '热门', '全站高热度视频');
  else if (r.name === 'rank') task = renderRank(r.params.rid || 0);
  else if (r.name === 'bangumi') task = renderBangumi();
  else if (r.name === 'film') task = renderFilm(r.params.type || 1);
  else if (r.name === 'article') task = renderArticle(r.params.cv);
  else if (r.name === 'messages') task = renderMessages(r.params.tab || 'reply');
  else if (r.name === 'im') task = renderIM(r.params.talker);
  else if (r.name === 'relation') task = renderRelation(r.params.mid, r.params.type || 'following');
  else if (r.name === 'search') task = renderSearch(r.params.q || '', r.params.type || 'video');
  else if (r.name === 'live') task = renderLive();
  else if (r.name === 'dynamic') task = renderDynamic(r.params.mid, r.params.name);
  else if (r.name === 'dynDetail') task = renderDynDetail(r.params);
  else if (r.name === 'up') task = renderUp(r.params.mid);
  else if (r.name === 'season') task = renderSeason(r.params.seasonId);
  else if (r.name === 'liveRoom') task = renderLiveRoom(r.params.roomId, r.params.title);
  else if (r.name === 'liveFollowing') task = renderLiveFollowing();
  else if (r.name === 'history') task = renderHistory();
  else if (r.name === 'fav') task = renderFavorites(r.params.folder);
  else if (r.name === 'watchlater') task = renderWatchLater();
  else if (r.name === 'video') task = renderVideo(r.params.bvid);
  else if (r.name === 'web') task = renderWeb(r.params.url, r.params.title);
  else task = renderFeed('home', '首页', '');

  try { await task; } catch (err) { console.error(err); }
  if (restoreTo > 0 && !view.hidden) view.scrollTop = restoreTo;
  updateScrollTop();
}

/* ------------------------------ 卡片 ------------------------------ */

function cardHTML({ title, pic, up, views, dur, badge, score, rank, progress, live, online }) {
  const pct = typeof progress === 'number' && progress > 0 ? Math.min(100, Math.round(progress * 100)) : 0;
  return `
  <article class="card${live ? ' live' : ''}">
    <div class="cover">
      <img loading="lazy" src="${esc(httpsUrl(pic))}" alt="" />
      ${rank ? `<span class="rank-no">${rank}</span>` : ''}
      ${score ? `<span class="score">${esc(score)}</span>` : ''}
      ${live ? '<span class="live-badge">● 直播中</span>' : ''}
      ${dur ? `<span class="dur">${esc(dur)}</span>` : ''}
      ${online ? `<span class="play">${esc(online)} 人气</span>` : (views ? `<span class="play">▶ ${esc(views)}</span>` : '')}
      ${pct ? `<span class="progress"><i style="width:${pct}%"></i></span>` : ''}
      <button class="card-quick" title="加入稍后再看" aria-label="加入稍后再看">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <h3 class="title">${esc(stripTags(title))}</h3>
    <div class="sub">
      ${up ? `<span>${esc(up)}</span>` : ''}
      ${up && badge ? '<span class="dot"></span>' : ''}
      ${badge ? `<span>${esc(badge)}</span>` : ''}
    </div>
  </article>`;
}

function skeletons(n) {
  return `<div class="grid">${Array.from({ length: n }, () => '<div class="skeleton"></div>').join('')}</div>`;
}

/* ------------------------------ 首页 / 热门 ------------------------------ */

async function renderFeed(kind, title, sub) {
  const key = kind === 'hot' ? 'hot' : 'home';
  const st = state.feeds[key] || (state.feeds[key] = { pn: 0, items: [], done: false });
  st.pn = 0;
  st.items = [];
  st.done = false;
  st.kind = kind;
  st.heroBuilt = false;

  const shuffleBtn = kind === 'hot'
    ? ''
    : `<button class="ghost-btn feed-shuffle" id="feed-shuffle" title="换一批推荐">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M20 4.8V11h-6.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
         换一批
       </button>`;
  view.innerHTML = `
    <div class="view-head"><div class="view-title">${title}</div><div class="view-sub">${sub}</div><div class="spacer"></div>${shuffleBtn}</div>
    <div id="feed">${skeletons(10)}</div>`;
  $('feed-shuffle')?.addEventListener('click', () => refreshFeed());
  await loadMoreFeed();
  setInfinite(loadMoreFeed);
}

/* 换一批：清空当前流，重新拉一次推荐（fresh 序号继续递增，拿到的内容不一样） */
async function refreshFeed() {
  const key = state.route.name === 'hot' ? 'hot' : 'home';
  const st = state.feeds[key];
  const feed = $('feed');
  if (!st || !feed || state.loadingMore) return;
  const btn = $('feed-shuffle');
  if (btn) btn.classList.add('busy');
  st.pn = 0;
  st.items = [];
  st.done = false;
  st.heroBuilt = false;
  if (key === 'home') st.fresh = (st.fresh || 1) + 1;
  feed.innerHTML = skeletons(10);
  view.scrollTo({ top: 0, behavior: 'smooth' });
  await loadMoreFeed();
  if (btn) btn.classList.remove('busy');
}

function setInfinite(fn) {
  if (!fn) { state.onScroll = null; return; }
  state.onScroll = () => {
    if (state.loadingMore) return;
    if (view.scrollTop + view.clientHeight > view.scrollHeight - 700) fn();
  };
}

/* 首页首屏：左边大轮播（跨两行），右边 4 张小卡，下面回到统一网格 */
function heroHTML(slides, side, cols, split) {
  const heroStyle = split.fullWidth
    ? 'grid-column:1 / -1;grid-row:auto;aspect-ratio:21 / 9;min-height:0'
    : `grid-column:span ${split.heroSpan}`;
  return `
  <div class="hero-row" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">
    <div class="hero" id="hero" style="${heroStyle}">
      ${slides.map((v, i) => `
        <div class="hero-slide${i ? '' : ' on'}">
          <img loading="lazy" src="${esc(httpsUrl(v.pic))}" alt="" />
          <div class="hero-veil"></div>
          <div class="hero-cap">
            <h2>${esc(stripTags(v.title))}</h2>
            <div class="hero-meta">${esc((v.owner && v.owner.name) || '')}${v.stat && v.stat.view ? ' · ' + fmtNum(v.stat.view) + ' 播放' : ''}</div>
          </div>
        </div>`).join('')}
      <button class="hero-nav prev" aria-label="上一张">‹</button>
      <button class="hero-nav next" aria-label="下一张">›</button>
      <div class="hero-dots">${slides.map((_, i) => `<i data-i="${i}"${i ? '' : ' class="on"'}></i>`).join('')}</div>
    </div>
    ${side.map((v) => cardHTML({
      title: v.title,
      pic: v.pic,
      up: v.owner && v.owner.name,
      views: fmtNum(v.stat && v.stat.view),
      dur: fmtDur(v.duration),
    })).join('')}
  </div>`;
}

function bindHero(slides) {
  const hero = $('hero');
  if (!hero) return;
  const domSlides = [...hero.querySelectorAll('.hero-slide')];
  const dots = [...hero.querySelectorAll('.hero-dots i')];
  if (domSlides.length < 2) return;
  let idx = 0;
  const paint = () => {
    domSlides.forEach((el, i) => el.classList.toggle('on', i === idx));
    dots.forEach((el, i) => el.classList.toggle('on', i === idx));
  };
  const stop = () => {
    if (state.heroTimer) { clearInterval(state.heroTimer); state.heroTimer = null; }
  };
  const start = () => {
    stop();
    state.heroTimer = setInterval(() => {
      idx = (idx + 1) % domSlides.length;
      paint();
    }, 6000);
  };
  const go = (n) => {
    idx = (n + domSlides.length) % domSlides.length;
    paint();
    start();
  };
  hero.querySelector('.hero-nav.prev')?.addEventListener('click', (e) => { e.stopPropagation(); go(idx - 1); });
  hero.querySelector('.hero-nav.next')?.addEventListener('click', (e) => { e.stopPropagation(); go(idx + 1); });
  dots.forEach((d, i) => d.addEventListener('click', (e) => { e.stopPropagation(); go(i); }));
  domSlides.forEach((el) => el.addEventListener('click', () => {
    const v = slides[idx];
    if (v && v.bvid) navigate('video', { bvid: v.bvid });
  }));
  hero.addEventListener('mouseenter', stop);
  hero.addEventListener('mouseleave', start);
  start();
}

/* 首页列数跟着可用宽度走；大卡与侧卡的数量按列数配比，保证不留空格子 */
function measureCols(el) {
  const w = (el && (el.clientWidth || el.getBoundingClientRect().width)) || 0;
  if (!w) return 4;
  const gap = 16;
  const min = 250;
  return Math.max(2, Math.min(5, Math.floor((w + gap) / (min + gap))));
}

function homeSplit(cols) {
  // 5 列：大卡跨 3 + 右侧 2 列 × 2 行 = 4 张
  if (cols >= 5) return { heroSpan: 3, side: 4, fullWidth: false };
  // 4 列：大卡跨 2 + 右侧 2 列 × 2 行 = 4 张
  if (cols === 4) return { heroSpan: 2, side: 4, fullWidth: false };
  // 3 列及以下：大卡独占一行，侧卡正好铺满一行（3 列 3 张 / 2 列 2 张）
  return { heroSpan: cols, side: cols, fullWidth: true };
}

function syncHomeTracks(cols) {
  const grid = document.getElementById('feed-grid');
  if (grid) grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  const heroRow = document.querySelector('.hero-row');
  if (heroRow) heroRow.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
}

function applyHomeColumns() {
  const grid = document.getElementById('feed-grid');
  if (!grid) return;
  syncHomeTracks(measureCols(grid));
}

function renderHomeFeed(feed, items, rebuild) {
  const cols = state.homeCols || measureCols(feed);
  const split = homeSplit(cols);
  const slides = items.slice(0, 5);
  const side = items.slice(5, 5 + split.side);
  const rest = items.slice(5 + split.side);
  const gridHTML = rest.map((v) => cardHTML({
    title: v.title,
    pic: v.pic,
    up: v.owner && v.owner.name,
    views: fmtNum(v.stat && v.stat.view),
    dur: fmtDur(v.duration),
  })).join('');

  if (rebuild) {
    const grid = $('feed-grid');
    if (grid) {
      grid.innerHTML = gridHTML;
      attachCardClicks(grid, rest.map((v) => v.bvid));
    }
    return;
  }
  feed.innerHTML = `${heroHTML(slides, side, cols, split)}<div class="grid home-grid" id="feed-grid">${gridHTML}</div>`;
  bindHero(slides);
  feed.querySelectorAll('.hero-row > .card').forEach((el, i) => {
    const v = side[i];
    if (v) el.addEventListener('click', () => navigate('video', { bvid: v.bvid }));
  });
  const grid = $('feed-grid');
  if (grid) attachCardClicks(grid, rest.map((v) => v.bvid));

  state.homeCols = cols;
  syncHomeTracks(cols);
  state.homeColObserver?.disconnect();
  state.homeColObserver = new ResizeObserver(() => {
    const gridEl = document.getElementById('feed-grid');
    if (!gridEl) return;
    const next = measureCols(gridEl);
    if (next === state.homeCols) {
      syncHomeTracks(next);
      return;
    }
    state.homeCols = next;
    const st = state.feeds.home;
    const feedEl = $('feed');
    if (feedEl && st && st.items && st.items.length) {
      renderHomeFeed(feedEl, st.items, false);
    } else {
      syncHomeTracks(next);
    }
  });
  state.homeColObserver.observe(feed);
}

async function loadMoreFeed() {
  const key = state.route.name === 'hot' ? 'hot' : 'home';
  const st = state.feeds[key];
  if (!st || state.loadingMore || st.done) return;
  state.loadingMore = true;
  const pn = st.pn + 1;
  let list = [];
  if (key === 'home') {
    // 推荐流：fresh_idx 每次递增，刷新/翻页都会拿到新的推荐
    const r = await bridge.apiWbi('/x/web-interface/wbi/index/top/feed/rcmd', {
      ps: 30,
      fresh_type: 4,
      fresh_idx: st.fresh || 1,
      fresh_idx_1h: st.fresh1h || 1,
      brush: Math.floor(Math.random() * 1000),
      homepage_ver: 1,
    }).catch(() => null);
    list = ((r && r.data && r.data.item) || []).map((it) => ({
      bvid: it.bvid,
      pic: it.pic,
      title: it.title,
      owner: it.owner,
      stat: it.stat,
      duration: it.duration,
    })).filter((it) => it.bvid);
    st.fresh = (st.fresh || 1) + 1;
    st.fresh1h = (st.fresh1h || 1) + 1;
  } else {
    const data = await api(`/x/web-interface/popular?ps=30&pn=${pn}`).catch(() => null);
    list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
  }
  if (!list.length) {
    st.done = true;
  } else {
    st.pn = pn;
    st.items = st.items.concat(list);
  }
  const feed = $('feed');
  if (feed) {
    if (!st.items.length) {
      feed.innerHTML = `<div class="empty">没有加载到内容，检查网络后重试</div>`;
    } else {
      if (st.kind === 'home') {
        renderHomeFeed(feed, st.items, !!st.heroBuilt);
        st.heroBuilt = true;
      } else {
        const items = [...st.items].sort((a, b) => (b.stat?.view || 0) - (a.stat?.view || 0));
        feed.innerHTML = `<div class="grid">${items.map((v, i) => cardHTML({
          title: v.title,
          pic: v.pic,
          up: v.owner?.name,
          views: fmtNum(v.stat?.view),
          dur: fmtDur(v.duration),
          rank: i + 1,
        })).join('')}</div>`;
        attachCardClicks(feed, items.map((v) => v.bvid));
      }
    }
  }
  state.loadingMore = false;
}

function attachCardClicks(root, bvids) {
  root.querySelectorAll('.card').forEach((el, i) => {
    el.addEventListener('click', () => {
      if (bvids[i]) navigate('video', { bvid: bvids[i] });
    });
    const quick = el.querySelector('.card-quick');
    if (quick) {
      quick.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!bvids[i]) return;
        if (quick.classList.contains('done')) return;
        const res = await bridge.actionPage('/x/v2/history/toview/add', { bvid: bvids[i] }).catch(() => null);
        if (res && res.code === 0) {
          quick.classList.add('done');
          toast('已加入稍后再看');
        } else {
          toast((res && res.message) || '加入失败');
        }
      });
    }
  });
}

/* ------------------------------ 排行榜 ------------------------------ */

const RANK_CATS = [
  { id: 0, name: '全站' }, { id: 1, name: '动画' }, { id: 4, name: '游戏' },
  { id: 3, name: '音乐' }, { id: 36, name: '知识' }, { id: 188, name: '科技' },
  { id: 160, name: '生活' }, { id: 181, name: '影视' },
];

async function renderRank(rid = 0) {
  const cat = RANK_CATS.find((c) => c.id === Number(rid)) || RANK_CATS[0];
  view.innerHTML = `
    <div class="view-head"><div class="view-title">排行榜</div><div class="view-sub">${cat.name} · 热度</div><div class="spacer"></div></div>
    <div class="search-tabs" id="rank-tabs">${RANK_CATS.map((c) =>
      `<button class="s-tab${c.id === cat.id ? ' on' : ''}" data-rid="${c.id}">${c.name}</button>`).join('')}</div>
    ${skeletons(10)}`;
  const tabs = $('rank-tabs');
  if (tabs) {
    tabs.querySelectorAll('.s-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate('rank', { rid: Number(btn.dataset.rid) }));
    });
  }
  let list = [];
  const data = await api(`/x/web-interface/ranking/v2?rid=${cat.id}&type=all`).catch(() => null);
  if (data && data.code === 0 && data.data && Array.isArray(data.data.list)) {
    list = data.data.list;
  } else {
    // 风控时退回热门并按播放量排序
    const pop = await api('/x/web-interface/popular?ps=30&pn=1').catch(() => null);
    const raw = pop && pop.data && Array.isArray(pop.data.list) ? pop.data.list : [];
    list = [...raw].sort((a, b) => (b.stat?.view || 0) - (a.stat?.view || 0));
  }
  if (!list.length) {
    view.innerHTML = `<div class="view-head"><div class="view-title">排行榜</div><div class="spacer"></div></div>
      <div class="empty">排行榜暂时不可用</div>`;
    return;
  }
  view.innerHTML = `
    <div class="view-head"><div class="view-title">排行榜</div><div class="view-sub">${cat.name} · ${list.length} 条</div><div class="spacer"></div></div>
    <div class="search-tabs" id="rank-tabs">${RANK_CATS.map((c) =>
      `<button class="s-tab${c.id === cat.id ? ' on' : ''}" data-rid="${c.id}">${c.name}</button>`).join('')}</div>
    <div class="grid">${list.map((v, i) => cardHTML({
      title: v.title, pic: v.pic, up: v.owner?.name,
      views: fmtNum(v.stat?.view), dur: fmtDur(v.duration), rank: i + 1,
    })).join('')}</div>`;
  attachCardClicks(view, list.map((v) => v.bvid));
  const tabs2 = $('rank-tabs');
  if (tabs2) {
    tabs2.querySelectorAll('.s-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate('rank', { rid: Number(btn.dataset.rid) }));
    });
  }
}

/* ------------------------------ 番剧 ------------------------------ */

async function renderBangumi() {
  view.innerHTML = `
    <div class="view-head"><div class="view-title">番剧</div><div class="view-sub">热门排行</div><div class="spacer"></div></div>
    ${skeletons(8)}`;
  const data = await api('/pgc/web/rank/list?day=3&season_type=1').catch(() => null);
  const list = data && data.result && Array.isArray(data.result.list) ? data.result.list : [];
  if (!list.length) {
    view.innerHTML = `<div class="empty">番剧列表暂时不可用</div>`;
    return;
  }
  view.innerHTML = `
    <div class="view-head"><div class="view-title">番剧</div><div class="view-sub">热门排行 · ${list.length} 部</div><div class="spacer"></div></div>
    <div class="grid">${list.map((b, i) => `
      <article class="card" data-url="${esc(b.url || '')}">
        <div class="cover">
          <img loading="lazy" src="${esc(httpsUrl(b.cover))}" alt="" />
          <span class="rank-no">${i + 1}</span>
          ${b.rating ? `<span class="score">${esc(b.rating)}</span>` : ''}
        </div>
        <h3 class="title">${esc(b.title)}</h3>
        <div class="sub"><span>${esc(b.badge || '番剧')}</span></div>
      </article>`).join('')}</div>`;
  view.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => {
      const url = el.dataset.url || '';
      const m = url.match(/ss(\d+)/) || url.match(/season_id=(\d+)/);
      if (m) navigate('season', { seasonId: m[1] });
      else if (url) navigate('web', { url: httpsUrl(url), title: '番剧详情' });
    });
  });
}

/* ------------------------------ 搜索 ------------------------------ */

function focusSearch() {
  $('search-input').focus();
  $('search-input').select();
}

function submitSearch() {
  const input = $('search-input');
  const q = input.value.trim();
  if (!q) return;
  const recent = store.get('recentSearch', []) || [];
  store.set('recentSearch', [q, ...recent.filter((x) => x !== q)].slice(0, 20));
  input.blur();
  hideSearchHistory();
  navigate('search', { q });
}

/* 搜索面板：有输入 → 搜索预测；没输入 → 最近搜索 */
let suggestTimer = null;
let suggestSeq = 0;
let suggestItems = [];
let suggestIndex = -1;

function ensureSearchPanel() {
  const input = $('search-input');
  let box = document.getElementById('search-hist');
  if (box) return box;
  box = document.createElement('div');
  box.className = 'search-hist';
  box.id = 'search-hist';
  document.body.appendChild(box);
  const rect = input.getBoundingClientRect();
  box.style.left = `${Math.round(rect.left)}px`;
  box.style.top = `${Math.round(rect.bottom + 6)}px`;
  box.style.width = `${Math.round(Math.min(Math.max(rect.width, 460), window.innerWidth - 24))}px`;
  return box;
}

function highlightTerm(text, q) {
  const src = String(text || '');
  const needle = String(q || '').trim();
  if (!needle) return esc(src);
  const i = src.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return esc(src);
  return esc(src.slice(0, i))
    + '<mark>' + esc(src.slice(i, i + needle.length)) + '</mark>'
    + esc(src.slice(i + needle.length));
}

function paintSuggestIndex() {
  const box = document.getElementById('search-hist');
  if (!box) return;
  box.querySelectorAll('.sug-item').forEach((el, i) => el.classList.toggle('on', i === suggestIndex));
}

function hotSearchHTML() {
  const list = state.hotSearch;
  if (list === null) return '<div class="sh-hot-skel">正在加载热搜…</div>';
  if (!list.length) return '<div class="sh-hot-skel">热搜暂时不可用</div>';
  const half = Math.ceil(list.length / 2);
  const col = (arr, offset) => arr.map((it, i) => {
    const rank = offset + i + 1;
    return `<button class="sh-hot-item" data-q="${esc(it.keyword)}">
      <span class="hs-rank${rank <= 3 ? ' top' : ''}">${rank}</span>
      <span class="hs-title">${esc(it.show_name || it.keyword)}</span>
      ${it.icon ? `<img class="hs-badge" src="${esc(httpsUrl(it.icon))}" alt="" />` : ''}
    </button>`;
  }).join('');
  return `<div class="sh-hot-col">${col(list.slice(0, half), 0)}</div>`
    + `<div class="sh-hot-col">${col(list.slice(half), half)}</div>`;
}

async function loadHotSearch() {
  if (state.hotSearch !== null) return;
  state.hotSearch = [];
  const r = await api('/x/web-interface/search/square?limit=10').catch(() => null);
  const list = (r && r.data && r.data.trending && r.data.trending.list) || [];
  state.hotSearch = list.slice(0, 10).map((it) => ({
    keyword: String(it.keyword || it.show_name || ''),
    show_name: String(it.show_name || it.keyword || ''),
    icon: String(it.icon || ''),
  })).filter((it) => it.keyword);
  const box = document.getElementById('search-hist');
  if (box && !$('search-input').value.trim()) renderRecentSearches();
}

function renderRecentSearches() {
  const recent = store.get('recentSearch', []) || [];
  const box = ensureSearchPanel();
  const shown = state.histExpanded ? recent : recent.slice(0, 10);
  const chips = shown.map((q) => `<button class="sh-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  const more = recent.length > 10
    ? `<button class="sh-more" id="sh-more">${state.histExpanded ? '收起 ⌃' : '展开更多 ⌄'}</button>`
    : '';
  box.innerHTML = (recent.length
    ? `<div class="sh-head"><span>搜索历史</span><button class="sh-clear" id="sh-clear">清空</button></div>
       <div class="sh-chips">${chips}</div>${more}`
    : '')
    + `<div class="sh-head${recent.length ? ' sh-head-hot' : ''}"><span>bilibili 热搜</span></div>
       <div class="sh-hot" id="sh-hot">${hotSearchHTML()}</div>`;

  box.querySelectorAll('.sh-chip').forEach((b) => {
    b.addEventListener('click', () => { $('search-input').value = b.dataset.q; submitSearch(); });
  });
  box.querySelectorAll('.sh-hot-item').forEach((b) => {
    b.addEventListener('click', () => { $('search-input').value = b.dataset.q; submitSearch(); });
  });
  $('sh-clear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    store.set('recentSearch', []);
    state.histExpanded = false;
    renderRecentSearches();
  });
  $('sh-more')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.histExpanded = !state.histExpanded;
    renderRecentSearches();
  });
  loadHotSearch();
}

function renderSuggestions(q) {
  if (!suggestItems.length) { hideSearchHistory(); return; }
  const box = ensureSearchPanel();
  box.innerHTML = `<div class="sh-head"><span>搜索预测</span><span class="sh-tip">↑↓ 选择 · Enter 搜索</span></div>`
    + suggestItems.map((t, i) => `<button class="sh-item sug-item" data-i="${i}">${highlightTerm(t, q)}</button>`).join('');
  box.querySelectorAll('.sug-item').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      $('search-input').value = suggestItems[Number(b.dataset.i)];
      submitSearch();
    });
    b.addEventListener('mouseenter', () => { suggestIndex = Number(b.dataset.i); paintSuggestIndex(); });
  });
  paintSuggestIndex();
}

function showSearchHistory() {
  const q = $('search-input').value.trim();
  if (q) { renderSuggestions(q); return; }
  suggestItems = [];
  suggestIndex = -1;
  renderRecentSearches();
}

async function loadSuggest(term) {
  const seq = ++suggestSeq;
  const r = await bridge.suggest(term).catch(() => null);
  if (seq !== suggestSeq) return;
  suggestItems = (r && r.ok && Array.isArray(r.list)) ? r.list : [];
  suggestIndex = -1;
  const q = $('search-input').value.trim();
  if (q) renderSuggestions(q);
}

function hideSearchHistory() {
  document.getElementById('search-hist')?.remove();
}

async function renderSearch(q, type = 'video') {
  $('search-input').value = q;
  const st = state.feeds.search;
  st.q = q;
  st.type = type;
  st.page = 0;
  st.items = [];
  st.done = false;
  st.order = st.order || 'totalrank';
  st.duration = st.duration || 0;
  const orders = [['totalrank', '综合'], ['click', '最多播放'], ['pubdate', '最新发布']];
  const durations = [['0', '全部时长'], ['1', '短'], ['2', '中'], ['3', '长']];
  view.innerHTML = `
    <div class="view-head"><div class="view-title">搜索</div><div class="view-sub">${esc(q)}</div><div class="spacer"></div></div>
    <div class="search-tabs" id="search-tabs">
      <button class="s-tab${type === 'video' ? ' on' : ''}" data-type="video">视频</button>
      <button class="s-tab${type === 'media_bangumi' ? ' on' : ''}" data-type="media_bangumi">番剧</button>
      <button class="s-tab${type === 'bili_user' ? ' on' : ''}" data-type="bili_user">UP 主</button>
      <button class="s-tab${type === 'article' ? ' on' : ''}" data-type="article">专栏</button>
    </div>
    ${type === 'video' ? `<div class="search-filters">
      <div class="seg" id="sf-order">${orders.map(([k, label]) =>
        `<button data-order="${k}" class="${st.order === k ? 'on' : ''}">${label}</button>`).join('')}</div>
      <div class="seg" id="sf-duration">${durations.map(([k, label]) =>
        `<button data-duration="${k}" class="${String(st.duration) === k ? 'on' : ''}">${label}</button>`).join('')}</div>
    </div>` : ''}
    <div id="feed">${skeletons(8)}</div>`;
  const tabs = $('search-tabs');
  if (tabs) {
    tabs.querySelectorAll('.s-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate('search', { q, type: btn.dataset.type }));
    });
  }
  const resetFeed = () => {
    st.page = 0;
    st.items = [];
    st.done = false;
    const feed = $('feed');
    if (feed) feed.innerHTML = skeletons(8);
    loadMoreSearch();
  };
  const orderSeg = $('sf-order');
  if (orderSeg) {
    orderSeg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (st.order === btn.dataset.order) return;
        st.order = btn.dataset.order;
        orderSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        resetFeed();
      });
    });
  }
  const durSeg = $('sf-duration');
  if (durSeg) {
    durSeg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (String(st.duration) === btn.dataset.duration) return;
        st.duration = Number(btn.dataset.duration);
        durSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        resetFeed();
      });
    });
  }
  await loadMoreSearch();
  setInfinite(loadMoreSearch);
}

async function loadMoreSearch() {
  const st = state.feeds.search;
  if (state.loadingMore || st.done || !st.q) return;
  state.loadingMore = true;
  const page = st.page + 1;
  const type = st.type || 'video';
  const extra = type === 'video'
    ? `&order=${encodeURIComponent(st.order || 'totalrank')}&duration=${Number(st.duration) || 0}`
    : '';
  const data = await api(
    `/x/web-interface/search/type?search_type=${type}&keyword=${encodeURIComponent(st.q)}&page=${page}${extra}`
  ).catch(() => null);
  const list = data && data.data && Array.isArray(data.data.result) ? data.data.result : [];
  if (!list.length) st.done = true;
  else {
    st.page = page;
    st.items = st.items.concat(list);
  }
  const feed = $('feed');
  if (feed) {
    if (!st.items.length) {
      feed.innerHTML = `<div class="empty">没有找到「${esc(st.q)}」相关的${type === 'bili_user' ? 'UP 主' : type === 'media_bangumi' ? '番剧' : type === 'article' ? '专栏' : '视频'}</div>`;
    } else if (type === 'bili_user') {
      feed.innerHTML = `<div class="user-grid">${st.items.map((u) => `
        <button class="user-card" data-mid="${u.mid}">
          <img loading="lazy" src="${esc(httpsUrl(u.upic))}" alt="" />
          <div class="user-info">
            <div class="user-name">${esc(stripTags(u.uname || ''))}</div>
            <div class="user-meta">${fmtNum(u.fans)} 粉丝 · ${u.videos || 0} 投稿</div>
            ${u.usign ? `<div class="user-sign">${esc(u.usign)}</div>` : ''}
          </div>
        </button>`).join('')}</div>`;
      feed.querySelectorAll('.user-card').forEach((el) => {
        el.addEventListener('click', () => navigate('up', { mid: Number(el.dataset.mid) }));
      });
    } else if (type === 'article') {
      feed.innerHTML = `<div class="article-grid">${st.items.map((a) => {
        const cover = (a.image_urls && a.image_urls[0]) || a.pic || '';
        return `<button class="article-card" data-cv="${esc(String(a.id || ''))}">
          ${cover ? `<span class="ac-cover"><img loading="lazy" src="${esc(httpsUrl(cover))}" alt="" /></span>` : ''}
          <span class="ac-body">
            <span class="ac-title">${esc(stripTags(a.title || ''))}</span>
            <span class="ac-sum">${esc(stripTags(a.summary || a.desc || '')).slice(0, 90)}</span>
            <span class="ac-meta">${esc(a.author_name || a.author || '')}${a.view ? ` · ${fmtNum(a.view)} 阅读` : ''}</span>
          </span>
        </button>`;
      }).join('')}</div>`;
      feed.querySelectorAll('.article-card').forEach((el) => {
        el.addEventListener('click', () => navigate('article', { cv: el.dataset.cv }));
      });
    } else if (type === 'media_bangumi') {
      feed.innerHTML = `<div class="grid">${st.items.map((b) => cardHTML({
        title: stripTags(b.title || ''),
        pic: b.cover,
        views: b.media_score && b.media_score.score ? `★ ${b.media_score.score}` : '',
        badge: b.season_type_name || '番剧',
      })).join('')}</div>`;
      feed.querySelectorAll('.card').forEach((el, i) => {
        el.addEventListener('click', () => {
          const b = st.items[i];
          const sid = b.season_id || (String(b.url || '').match(/ss(\d+)/) || [])[1];
          if (sid) navigate('season', { seasonId: sid });
          else if (b.url) navigate('web', { url: httpsUrl(b.url), title: '番剧' });
        });
      });
    } else {
      feed.innerHTML = `<div class="grid">${st.items.map((v) => cardHTML({
        title: stripTags(v.title), pic: v.pic, up: v.author,
        views: v.play, dur: v.duration,
      })).join('')}</div>`;
      attachCardClicks(feed, st.items.map((v) => v.bvid));
    }
  }
  state.loadingMore = false;
}

/* ------------------------------ 视频页 ------------------------------ */

/* ------------------------------ 播放器区块自适应 ------------------------------
   视频页/番剧页/直播间的共同骨架：播放器固定在顶部，下方内容在自己的滚动容器里。
   视频页额外做「随滚动收缩」——滚到简介/评论时播放器缩成迷你态，
   把高度让给下方内容；滚回顶部自动恢复。 */
let watchBlockCleanup = null;

function setupWatchBlock({ shrink = true, miniRatio = 0.46, reserve = null } = {}) {
  if (watchBlockCleanup) {
    try { watchBlockCleanup(); } catch {}
    watchBlockCleanup = null;
  }
  const watch = document.querySelector('.watch');
  if (!watch) return;
  const scroller = watch.querySelector('.watch-scroll');
  const ctl = watch.querySelector('.ctl');
  const wrap = watch.querySelector('.player-wrap');
  if (!wrap) return;

  let fullH = 460;
  let miniH = 220;
  let applied = -1;
  let raf = 0;
  let dragging = false;

  const measure = () => {
    const availW = Math.max(320, watch.clientWidth - 4);
    const availH = Math.max(240, watch.clientHeight);
    const ctlH = ctl ? ctl.offsetHeight + 10 : 12;
    // 顶部至少给下方内容留一点，避免又变成「只剩一条缝」
    const reserveH = reserve != null ? reserve : (shrink ? 150 : 130);
    fullH = Math.max(180, Math.min(availW * 9 / 16, availH - ctlH - reserveH));
    miniH = Math.max(150, Math.min(300, fullH * miniRatio));
  };

  const apply = () => {
    raf = 0;
    if (!watch.isConnected) return;
    const max = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    const t = shrink && scroller && max > 80 && !dragging
      ? Math.max(0, Math.min(1, scroller.scrollTop / Math.min(340, max)))
      : 0;
    const h = Math.round(fullH + (miniH - fullH) * t);
    if (h === applied) return;
    applied = h;
    watch.style.setProperty('--player-h', h + 'px');
    watch.classList.toggle('mini', h <= fullH - 36);
  };

  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
  const onScroll = () => { schedule(); updateScrollTop(); };

  if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });

  const ro = new ResizeObserver(() => { measure(); schedule(); });
  ro.observe(watch);

  measure();
  apply();
  updateScrollTop();

  watchBlockCleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
    if (scroller) scroller.removeEventListener('scroll', onScroll);
  };
}

async function renderVideo(bvid) {
  if (!bvid) { navigate('home'); return; }
  view.dataset.bvid = bvid;
  state.currentVideo = { bvid };
  view.innerHTML = `
    <div class="watch video-watch">
      <div class="watch-top">
        <div class="player-wrap">
          <div class="player-frame"><div class="player-slot" id="player-slot"></div></div>
          <div class="ctl" id="ctl">
            <button class="ctl-btn" id="ctl-play" title="播放 / 暂停">
              <svg viewBox="0 0 24 24"><path id="ctl-play-ico" d="M8 5.5v13l10-6.5-10-6.5z" fill="currentColor"/></svg>
            </button>
            <button class="ctl-btn ctl-opt" id="ctl-back5" title="后退 5 秒">−5s</button>
            <button class="ctl-btn ctl-opt" id="ctl-fwd5" title="前进 5 秒">+5s</button>
            <span class="ctl-time" id="ctl-time">0:00 / 0:00</span>
            <input type="range" class="ctl-seek" id="ctl-seek" min="0" max="1000" value="0" title="拖动调整进度" />
            <button class="ctl-btn" id="ctl-mute" title="静音">
              <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12L7.5 14.5H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path id="ctl-vol-wave" d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </button>
            <input type="range" class="ctl-vol" id="ctl-vol" min="0" max="100" value="100" title="音量" />
            <button class="ctl-btn ctl-speed ctl-opt" id="ctl-speed" title="播放速度">1.0x</button>
            <button class="ctl-btn ctl-quality ctl-opt" id="ctl-quality" title="画质">画质</button>
            <button class="ctl-btn ctl-opt" id="ctl-dm" title="弹幕开关">弹</button>
            <button class="ctl-btn ctl-opt" id="ctl-dm-send" title="发弹幕">✎</button>
            <button class="ctl-btn ctl-opt" id="ctl-dm-set" title="弹幕设置">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 4.4v1.7M12 17.9v1.7M4.4 12h1.7M17.9 12h1.7M6.6 6.6l1.2 1.2M16.2 16.2l1.2 1.2M6.6 17.4l1.2-1.2M16.2 7.8l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </button>
            <button class="ctl-btn ctl-opt" id="ctl-cc" title="字幕" hidden>CC</button>
            <button class="ctl-btn ctl-opt" id="ctl-pip" title="画中画">
              <svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="12" y="12" width="6.5" height="4.6" rx="1.2" fill="currentColor"/></svg>
            </button>
            <button class="ctl-btn ctl-opt" id="ctl-shot" title="截图">
              <svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 7l1.2-2h4.6L15.5 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
            </button>
            <button class="ctl-btn" id="ctl-fs" title="全屏">
              <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="watch-scroll" id="watch-scroll">
        <div id="watch-body">${skeletons(3)}</div>
      </div>
    </div>`;

  const [info, related] = await Promise.all([
    api(`/x/web-interface/view?bvid=${bvid}`).catch(() => null),
    api(`/x/web-interface/archive/related?bvid=${bvid}`).catch(() => null),
  ]);
  if (info && info.code === 0 && info.data) {
    state.currentVideo = { bvid, cid: info.data.cid, title: info.data.title };
  }
  const v = info && info.code === 0 ? info.data : null;
  const rel = related && related.code === 0 && Array.isArray(related.data) ? related.data : [];

  const body = $('watch-body');
  if (!body) return;
  if (!v) {
    body.innerHTML = `<div class="empty">视频信息加载失败</div>`;
    return;
  }

  // 评论（支持排序 / 分页 / 二级回复）
  let commentTotal = 0;
  let commentHTML = '<div class="empty" style="padding:24px">暂无评论</div>';
  if (v.aid) {
    const cr = await api(`/x/v2/reply?type=1&oid=${v.aid}&sort=2&ps=20&pn=1`).catch(() => null);
    if (cr && cr.code === 0 && cr.data) {
      commentTotal = cr.data.page?.count ?? 0;
      commentHTML = `<div class="c-toolbar">
          <span class="c-total">评论 <b>${fmtNum(commentTotal)}</b></span>
          <span class="spacer"></span>
          <button class="c-sort on" data-sort="2">热度</button>
          <button class="c-sort" data-sort="0">最新</button>
        </div>
        <div id="video-comments" data-aid="${v.aid}" data-sort="2"></div>`;
    }
  }

  body.innerHTML = `
    <div class="watch-info">
      <h1>${esc(v.title)}</h1>
      <div class="watch-meta">
        <span class="up-chip" id="up-chip" title="打开 UP 主主页">
          <img src="${esc(httpsUrl(v.owner?.face))}" alt="" />${esc(v.owner?.name || '')}
        </span>
        <span>${fmtNum(v.stat?.view)} 播放</span>
        <span>${fmtNum(v.stat?.danmaku)} 弹幕</span>
        <span>${fmtNum(v.stat?.like)} 点赞</span>
        <span>${fmtDate(v.pubdate)}</span>
        <button class="ghost-btn" id="open-web-video">在网页中打开</button>
      </div>
      <div class="actions">
        <button class="act-round" id="act-like" title="点赞">
          <span class="act-ico"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6C19 15.4 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
          <span class="act-label" id="like-count">点赞</span>
        </button>
        <button class="act-round" id="act-coin" title="投币（可选 1 / 2 枚）">
          <span class="act-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.4v7.2M8.4 12h7.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
          <span class="act-label" id="coin-label">投币</span>
        </button>
        <button class="act-round" id="act-fav" title="收藏">
          <span class="act-ico"><svg viewBox="0 0 24 24"><path d="M6 4.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V5.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
          <span class="act-label">收藏</span>
        </button>
        <button class="act-round act-triple" id="act-triple" title="一键三连（点赞 + 投币 + 收藏）">
          <span class="act-ico"><svg viewBox="0 0 24 24"><path d="M13.5 3.2L5.8 13h5l-1.3 7.8L18.2 11h-5.1l.4-7.8z" fill="currentColor"/></svg></span>
          <span class="act-label">三连</span>
        </button>
        <span class="act-gap"></span>
        <button class="act-round sm" id="act-share" title="复制视频链接">
          <span class="act-ico"><svg viewBox="0 0 24 24"><path d="M9 13.5l6-3M9 10.5l6 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="6.5" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="7.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="16.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span>
        </button>
        <button class="act-round sm" id="act-toview" title="稍后再看">
          <span class="act-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.2l2.8 1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
        </button>
        <button class="act-round sm" id="act-cover-bg" title="用封面作为背景">
          <span class="act-ico"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M5 17l4.5-4.5L13 16l2.5-2.5L19 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
        </button>
        <button class="act-round sm" id="act-download" title="下载视频">
          <span class="act-ico"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></span>
        </button>
      </div>
      ${v.desc ? `<div class="watch-desc">${esc(v.desc)}</div>` : ''}
      ${Array.isArray(v.pages) && v.pages.length > 1 ? `
        <div class="pages" id="pages">
          ${v.pages.map((pg, i) => `<button class="page-chip${i === 0 ? ' on' : ''}" data-page="${pg.page}">
            <span class="pg-no">P${pg.page}</span>${esc(pg.part || '')}</button>`).join('')}
        </div>` : ''}
    </div>
    ${rel.length ? `<div class="section-title">相关推荐</div>
      <div class="grid">${rel.map((r) => cardHTML({
        title: r.title, pic: r.pic, up: r.owner?.name,
        views: fmtNum(r.stat?.view), dur: fmtDur(r.duration),
      })).join('')}</div>` : ''}
    <div class="tabs" id="watch-tabs">
      <button class="tab on" data-tab="comments">评论 <span>${fmtNum(commentTotal)}</span></button>
      <button class="tab" data-tab="danmaku">弹幕 <span id="dm-count">…</span></button>
    </div>
    <div id="tab-body">${commentHTML}</div>`;
  attachCardClicks(body, rel.map((r) => r.bvid));

  const upChip = $('up-chip');
  if (upChip && v.owner?.mid) {
    upChip.addEventListener('click', () => {
      bridge.playerHide();
      navigate('up', { mid: v.owner.mid });
    });
  }
  // 操作栏
  bindWatchActions(v, bvid);

  // 分P 切换
  const pagesEl = $('pages');
  if (pagesEl) {
    pagesEl.querySelectorAll('.page-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        pagesEl.querySelectorAll('.page-chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        const page = Number(chip.dataset.page) || 1;
        showPlayerWhenReady(bvid, page);
      });
    });
  }

  // 评论 / 弹幕 Tab
  const tabs = $('watch-tabs');
  const tabBody = $('tab-body');
  let danmakuLoaded = false;
  const loadDanmaku = async () => {
    if (danmakuLoaded || !tabBody) return;
    danmakuLoaded = true;
    tabBody.innerHTML = `<div class="empty" style="padding:24px">正在加载弹幕…</div>`;
    const res = await bridge.danmaku(v.cid).catch(() => null);
    const list = (res && res.list) || [];
    const countEl = $('dm-count');
    if (countEl) countEl.textContent = String(list.length);
    if (!list.length) {
      tabBody.innerHTML = `<div class="empty" style="padding:24px">没有获取到弹幕</div>`;
      return;
    }
    tabBody.innerHTML = `<div class="dm-list">${list.map((d) => `
      <div class="dm-row">
        <span class="dm-time">${fmtDur(d.time)}</span>
        <span class="dm-dot" style="background:#${Number(d.color || 16777215).toString(16).padStart(6, '0')}"></span>
        <span class="dm-text">${esc(d.text)}</span>
      </div>`).join('')}</div>`;
  };
  if (tabs) {
    tabs.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
        tab.classList.add('on');
        if (tab.dataset.tab === 'danmaku') loadDanmaku();
        else if (tabBody) {
          tabBody.innerHTML = commentHTML || '<div class="empty" style="padding:24px">暂无评论</div>';
          if (v.aid) initVideoComments($('video-comments'), v.aid, 2);
        }
      });
    });
    if (v.aid) initVideoComments($('video-comments'), v.aid, 2);
  }

  const webBtn = $('open-web-video');
  if (webBtn) {
    webBtn.addEventListener('click', () => {
      bridge.playerHide();
      navigate('web', {
        url: `https://www.bilibili.com/video/${bvid}`,
        title: v.title || '视频',
      });
    });
  }

  // 播放器区块自适应（滚动收缩）+ 播放器视图 + 进度记忆 + 控制条
  setupWatchBlock({ shrink: true });
  showPlayerWhenReady(bvid, 1, { cid: v.cid });
  startProgressSaver(bvid);
  bindControls();
  startPlayerPolling();
}

let playerPollTimer = null;
let seeking = false;
let speedIdx = 0;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const fmtRate = (r) => `${Number(r || 1).toFixed(2).replace(/0$/, '')}x`;

function fmtClock(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
}

function bindControls() {
  const play = $('ctl-play');
  const ico = $('ctl-play-ico');
  const seek = $('ctl-seek');
  const vol = $('ctl-vol');
  const time = $('ctl-time');
  const mute = $('ctl-mute');
  const speed = $('ctl-speed');
  const dm = $('ctl-dm');
  const fs = $('ctl-fs');
  if (!play) return;
  if (play.dataset.bound === '1') return; // 防止重复绑定
  play.dataset.bound = '1';

  play.addEventListener('click', () => bridge.playerCmd({ cmd: 'toggle' }));
  $('ctl-back5').addEventListener('click', () => bridge.playerCmd({ cmd: 'back5' }));
  $('ctl-fwd5').addEventListener('click', () => bridge.playerCmd({ cmd: 'fwd5' }));
  mute.addEventListener('click', () => bridge.playerCmd({ cmd: 'mute' }));
  fs.addEventListener('click', async () => {
    const res = await bridge.playerFullscreen({ on: !state.videoFs }).catch(() => null);
    if (res && res.ok) state.videoFs = !!res.on;
  });
  const pip = $('ctl-pip');
  if (pip) pip.addEventListener('click', () => bridge.playerCmd({ cmd: 'pip' }));
  const shot = $('ctl-shot');
  if (shot) shot.addEventListener('click', async () => {
    const res = await bridge.playerShot().catch(() => null);
    toast(res && res.ok ? '截图已保存到下载文件夹' : (res && res.message) || '截图失败');
  });
  state.danmakuOn = state.danmakuOn !== false;
  dm.classList.toggle('on', state.danmakuOn);
  dm.addEventListener('click', async () => {
    state.danmakuOn = !state.danmakuOn;
    await bridge.playerDanmaku(state.danmakuOn).catch(() => {});
    dm.classList.toggle('on', state.danmakuOn);
  });

  const ccBtn = $('ctl-cc');
  if (ccBtn) {
    ccBtn.addEventListener('click', async () => {
      if (ccBtn.dataset.loaded !== '1') {
        const info = await bridge.playerSubtitle({
          bvid: state.route.params.bvid, cid: state.currentVideo?.cid,
        }).catch(() => null);
        if (!info || !info.ok || !info.count) return toast('这个视频没有字幕');
        ccBtn.dataset.loaded = '1';
        ccBtn.classList.add('on');
        return;
      }
      bridge.playerCmd({ cmd: 'subtitle' });
      ccBtn.classList.toggle('on');
    });
    // 播放器就绪后探测是否有字幕
    setTimeout(async () => {
      const cid = state.currentVideo?.cid;
      const bvid = state.route.params.bvid;
      if (!cid || !bvid) return;
      const info = await bridge.playerSubtitle({ bvid, cid }).catch(() => null);
      if (info && info.ok && info.count) {
        ccBtn.hidden = false;
        ccBtn.dataset.loaded = '1';
        ccBtn.classList.add('on');
      }
    }, 2500);
  }

  const quality = $('ctl-quality');
  if (quality) {
    quality.addEventListener('click', async () => {
      const info = await bridge.playerFormats().catch(() => null);
      if (!info || !info.formats || !info.formats.length) return toast('暂时没有可切换的画质');
      // 原生菜单：不会被播放器视图遮挡
      const picked = await bridge.popupMenu({
        title: '画质',
        items: info.formats.map((f) => ({
          label: f.label,
          checked: f.qn === info.quality,
          value: f.qn,
        })),
      }).catch(() => null);
      if (picked == null) return;
      const st = await bridge.playerState().catch(() => null);
      bridge.playerQuality({ qn: Number(picked), startAt: st ? st.currentTime : 0 });
      toast('正在切换画质…');
    });
  }

  /* --- 弹幕设置 / 发送：面板在播放器视图内部 --- */
  const dmSetBtn = $('ctl-dm-set');
  if (dmSetBtn) dmSetBtn.addEventListener('click', () => bridge.playerPanel('danmaku'));
  const dmSendBtn = $('ctl-dm-send');
  if (dmSendBtn) dmSendBtn.addEventListener('click', () => bridge.playerPanel('send'));
  const savedRate = Number((state.settings && state.settings.rate) || store.get('rate', 1)) || 1;
  speedIdx = Math.max(0, SPEEDS.indexOf(savedRate));
  speed.textContent = fmtRate(savedRate);
  bridge.playerCmd({ cmd: 'speed', value: savedRate });
  // 点开自选倍速面板（面板在播放器视图里，不会被原生层挡住）
  speed.addEventListener('click', () => bridge.playerPanel('speed'));

  const savedVol = Number(state.settings && state.settings.volume);
  if (Number.isFinite(savedVol)) {
    const v0 = Math.max(0, Math.min(1, savedVol));
    vol.value = String(Math.round(v0 * 100));
    bridge.playerCmd({ cmd: 'volume', value: v0 });
  }

  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('input', () => {
    if (!state.lastDuration) return;
    const pct = Number(seek.value) / 1000;
    if (time) time.textContent = `${fmtClock(pct * state.lastDuration)} / ${fmtClock(state.lastDuration)}`;
  });
  const commitSeek = () => {
    if (!seeking || !state.lastDuration) { seeking = false; return; }
    const target = (Number(seek.value) / 1000) * state.lastDuration;
    bridge.playerCmd({ cmd: 'seek', value: target });
    seeking = false;
  };
  seek.addEventListener('pointerup', commitSeek);
  seek.addEventListener('change', commitSeek);

  vol.addEventListener('input', () => {
    const v = Number(vol.value) / 100;
    state.settings.volume = v;
    bridge.playerCmd({ cmd: 'volume', value: v });
  });
  vol.addEventListener('change', () => {
    bridge.setSettings({ volume: Number(vol.value) / 100 }).catch(() => {});
  });
}

function startPlayerPolling() {
  stopPlayerPolling();
  playerPollTimer = setInterval(async () => {
    const st = await bridge.playerState().catch(() => null);
    if (!st) return;
    state.lastDuration = st.duration || 0;
    const ico = $('ctl-play-ico');
    if (ico) ico.setAttribute('d', st.paused
      ? 'M8 5.5v13l10-6.5-10-6.5z'
      : 'M8 5.5h3.5v13H8zM12.5 5.5H16v13h-3.5z');
    const time = $('ctl-time');
    if (time) time.textContent = `${fmtClock(st.currentTime)} / ${fmtClock(st.duration)}`;
    const seek = $('ctl-seek');
    if (seek && !seeking && st.duration > 0) {
      seek.value = String(Math.round((st.currentTime / st.duration) * 1000));
    }
    const vol = $('ctl-vol');
    if (vol) vol.value = String(Math.round((st.muted ? 0 : st.volume) * 100));
    const mute = $('ctl-mute');
    if (mute) mute.classList.toggle('on', st.muted);
  }, 700);
}

function stopPlayerPolling() {
  if (playerPollTimer) clearInterval(playerPollTimer);
  playerPollTimer = null;
}

let progressTimer = null;
function startProgressSaver(bvid) {
  stopProgressSaver();
  progressTimer = setInterval(async () => {
    if (state.route.name !== 'video' && state.route.name !== 'season') return;
    const t = await bridge.playerTime().catch(() => 0);
    if (t > 5) store.set('pos:' + bvid, Math.floor(t));
  }, 5000);
}
function stopProgressSaver() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function bindWatchActions(v, bvid) {
  const likeBtn = $('act-like');
  const coinBtn = $('act-coin');
  const likeCount = $('like-count');
  const coinLabel = $('coin-label');

  bridge.videoState({ bvid, aid: v.aid }).then((st) => {
    if (!st) return;
    if (st.liked) { likeBtn.classList.add('on'); if (likeCount) likeCount.textContent = '已赞'; }
    if (st.coins > 0) { coinBtn.classList.add('on'); if (coinLabel) coinLabel.textContent = '已投币'; }
  }).catch(() => {});

  if (likeBtn) likeBtn.addEventListener('click', async () => {
    const liked = likeBtn.classList.toggle('on');
    const res = await bridge.action({ type: 'like', bvid, like: liked }).catch(() => null);
    if (res && res.code === 0) {
      if (likeCount) likeCount.textContent = liked ? '已赞' : '点赞';
      toast(liked ? '已点赞' : '已取消点赞');
    } else {
      likeBtn.classList.toggle('on', !liked);
      toast((res && res.message) || '操作失败');
    }
  });

  const doCoin = async (n) => {
    const res = await bridge.action({ type: 'coin', bvid, multiply: n }).catch(() => null);
    if (res && res.code === 0) {
      coinBtn.classList.add('on');
      if (coinLabel) coinLabel.textContent = '已投币';
      toast(`已投币 ×${n}`);
      return true;
    }
    toast((res && res.message) || '投币失败');
    return false;
  };
  if (coinBtn) coinBtn.addEventListener('click', async () => {
    if (coinBtn.classList.contains('on')) return toast('已经投过币了');
    const picked = await bridge.popupMenu({
      title: '投币数量',
      items: [{ label: '投 1 枚', value: 1 }, { label: '投 2 枚', value: 2 }],
    }).catch(() => null);
    if (picked == null) return;
    await doCoin(Number(picked));
  });

  const favBtn = $('act-fav');
  if (favBtn) favBtn.addEventListener('click', async () => {
    const res = await bridge.favFolders().catch(() => null);
    const folders = (res && res.folders) || [];
    if (folders.length) {
      const picked = await bridge.popupMenu({
        title: '选择收藏夹',
        items: folders.map((f) => ({ label: `${f.title}（${f.count}）`, value: f.id })),
      }).catch(() => null);
      if (picked == null) return;
      const r = await bridge.action({ type: 'fav', aid: v.aid, folderId: picked }).catch(() => null);
      toast(r && r.code === 0 ? '已收藏' : ((r && r.message) || '收藏失败'));
      return;
    }
    return favLegacy();
  });
  const favLegacy = async () => {
    if (!state.login) return bridge.openLogin();
    const foldersRes = await api(`/x/v3/fav/folder/created/list-all?up_mid=${state.login.mid}`).catch(() => null);
    const folders = (foldersRes && foldersRes.data && foldersRes.data.list) || [];
    if (!folders.length) return toast('没有可用的收藏夹');
    const folder = folders[0];
    const res = await bridge.action({ type: 'fav', aid: v.aid, folderId: folder.id }).catch(() => null);
    if (res && res.code === 0) {
      favBtn.classList.add('on');
      toast(`已收藏到「${folder.title}」`);
    } else {
      toast((res && res.message) || '收藏失败');
    }
  };

  const tripleBtn = $('act-triple');
  if (tripleBtn) {
    tripleBtn.addEventListener('click', async () => {
      if (tripleBtn.dataset.busy === '1') return;
      tripleBtn.dataset.busy = '1';
      tripleBtn.classList.add('on');
      const done = [];
      try {
        if (!likeBtn.classList.contains('on')) {
          const r = await bridge.action({ type: 'like', bvid, like: true }).catch(() => null);
          if (r && r.code === 0) {
            likeBtn.classList.add('on');
            if (likeCount) likeCount.textContent = '已赞';
            done.push('点赞');
          }
        } else done.push('点赞');
        if (!coinBtn.classList.contains('on')) {
          let r = await bridge.action({ type: 'coin', bvid, multiply: 2 }).catch(() => null);
          if (!r || r.code !== 0) r = await bridge.action({ type: 'coin', bvid, multiply: 1 }).catch(() => null);
          if (r && r.code === 0) {
            coinBtn.classList.add('on');
            if (coinLabel) coinLabel.textContent = '已投币';
            done.push('投币');
          }
        } else done.push('投币');
        if (favBtn && !favBtn.classList.contains('on')) {
          const f = await bridge.favFolders().catch(() => null);
          const folder = ((f && f.folders) || [])[0];
          if (folder) {
            const r = await bridge.action({ type: 'fav', aid: v.aid, folderId: folder.id }).catch(() => null);
            if (r && r.code === 0) { favBtn.classList.add('on'); done.push('收藏'); }
          }
        } else if (favBtn) done.push('收藏');
      } finally {
        tripleBtn.dataset.busy = '0';
        tripleBtn.classList.toggle('on', done.length >= 3);
      }
      toast(done.length >= 3 ? '一键三连成功' : `已完成：${done.join(' · ') || '无'}`);
    });
  }

  const tvBtn = $('act-toview');
  if (tvBtn) tvBtn.addEventListener('click', async () => {
    const res = await bridge.action({ type: 'toview', bvid }).catch(() => null);
    if (res && res.code === 0) { tvBtn.classList.add('on'); toast('已加入稍后再看'); }
    else toast((res && res.message) || '操作失败');
  });

  const coverBtn = $('act-cover-bg');
  if (coverBtn) coverBtn.addEventListener('click', async () => {
    const cover = httpsUrl(v.pic);
    if (!cover) return toast('没有封面');
    const res = await bridge.backgroundFromUrl(cover).catch(() => null);
    if (res && res.ok) {
      saveSetting({ background: { ...(state.settings.background || {}), type: 'image', value: res.url } });
      toast('已用封面作为背景');
    } else {
      toast((res && res.message) || '设置失败');
    }
  });

  const shareBtn = $('act-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = `https://www.bilibili.com/video/${bvid}`;
      const ok = await bridge.copyText(url).catch(() => false);
      toast(ok ? '链接已复制' : '复制失败');
    });
  }

  const dlBtn = $('act-download');
  if (dlBtn) dlBtn.addEventListener('click', () => openDownloadMenu(v, bvid));
}

async function openDownloadMenu(v, bvid) {
  const res = await bridge.videoFormats({ bvid, cid: v.cid }).catch(() => null);
  if (!res || !res.ok || !res.formats || !res.formats.length) {
    toast((res && res.message) || '获取下载格式失败');
    return;
  }
  const picked = await bridge.popupMenu({
    title: '下载画质（音视频合一 MP4）',
    items: res.formats.map((f) => ({ label: f.label, value: f.qn })),
  }).catch(() => null);
  if (picked == null) return;
  toast('开始下载…');
  const r = await bridge.downloadVideo({
    bvid, cid: v.cid, title: v.title, qn: Number(picked),
  }).catch(() => null);
  if (!r || !r.ok) toast((r && r.message) || '下载失败');
}

function showPlayerWhenReady(bvid, page = 1, opts = {}) {
  const slot = $('player-slot');
  if (!slot) return;
  const saved = Number(store.get('pos:' + bvid, 0)) || 0;
  const startAt = opts.startAt != null ? opts.startAt : (saved > 5 ? saved : 0);
  // 有些入口（关闭设置面板后贴回播放器、分P 切回）只传 bvid：
  // 用当前视频记住的 cid 兜底，否则 playurl 会缺参数被拒
  const cid = opts.cid || (state.currentVideo && state.currentVideo.bvid === bvid
    ? state.currentVideo.cid
    : undefined);
  const send = () => {
    const r = slot.getBoundingClientRect();
    if (r.width < 40) return;
    bridge.playerShow({
      bvid,
      page,
      cid,
      episodeId: opts.episodeId,
      startAt,
      qn: Number(state.settings && state.settings.defaultQuality) || 0,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    });
  };
  requestAnimationFrame(() => {
    send();
    state.auxObserver?.disconnect();
    state.auxObserver = new ResizeObserver(() => {
      if (state.videoFs) return;
      const r = slot.getBoundingClientRect();
      bridge.playerResize({ x: r.left, y: r.top, width: r.width, height: r.height });
    });
    state.auxObserver.observe(slot);
  });
}

/* ------------------------------ 网页视图（番剧详情等） ------------------------------ */

function renderWeb(url, title) {
  if (!url) { navigate('home'); return; }
  view.innerHTML = `
    <div class="view-head"><div class="view-title">${esc(title || '网页')}</div><div class="view-sub">在应用内打开</div><div class="spacer"></div></div>
    <div class="player-frame web-frame" style="aspect-ratio:auto;height:calc(100vh - 190px);max-height:none;background:transparent">
      <div class="player-slot" id="web-slot"></div>
    </div>`;
  requestAnimationFrame(() => {
    const slot = $('web-slot');
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    bridge.webShow({ url, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    state.auxObserver?.disconnect();
    state.auxObserver = new ResizeObserver(() => {
      const n = slot.getBoundingClientRect();
      bridge.webShow({ url, rect: { x: n.left, y: n.top, width: n.width, height: n.height } });
    });
    state.auxObserver.observe(slot);
  });
}

/* ------------------------------ 评论组件 ------------------------------ */

function composerHTML(placeholder) {
  const me = state.login || {};
  return `<div class="c-compose">
    <img class="c-avatar" src="${esc(httpsUrl(me.face))}" alt="" />
    <div class="c-compose-main">
      <div class="c-reply-chip" hidden>
        <span class="c-reply-name"></span>
        <button class="c-reply-cancel" title="取消回复">×</button>
      </div>
      <textarea class="c-input" rows="2" maxlength="1000"
        placeholder="${esc(placeholder || '发一条友善的评论…')}"></textarea>
      <div class="c-previews" hidden></div>
      <div class="c-compose-bar">
        <button class="c-tool" data-tool="emoji" title="表情">😊</button>
        <button class="c-tool" data-tool="image" title="图片">🖼</button>
        <span class="c-count">0/1000</span>
        <button class="glass-btn c-send" disabled>发布</button>
      </div>
    </div>
  </div>`;
}

function insertAtCursor(el, text) {
  const start = el.selectionStart == null ? el.value.length : el.selectionStart;
  const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + text.length;
  el.focus();
}

async function openEmojiPicker(anchor, input, biz) {
  document.getElementById('emoji-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  pop.id = 'emoji-pop';
  pop.innerHTML = '<div class="emoji-loading">加载表情…</div>';
  document.body.appendChild(pop);
  // 播放器是原生视图，会盖住浮层：打开时临时隐藏，关闭后恢复
  const usesPlayer = state.route.name === 'video' || state.route.name === 'season';
  if (usesPlayer) bridge.playerCmd({ cmd: 'hide' });

  const res = await bridge.emotePanel({ biz }).catch(() => null);
  const pkgs = ((res && res.packages) || []).filter((p) => p.emotes && p.emotes.length);
  if (!pkgs.length) {
    pop.innerHTML = '<div class="emoji-loading">表情加载失败</div>';
    return;
  }
  let active = 0;
  const draw = () => {
    pop.innerHTML = `
      <div class="emoji-tabs">${pkgs.map((p, i) =>
        `<button class="${i === active ? 'on' : ''}" data-i="${i}">${esc(p.text || '表情')}</button>`).join('')}</div>
      <div class="emoji-grid">${pkgs[active].emotes.map((e) =>
        `<button class="emoji-item" data-text="${esc(e.text)}" title="${esc(e.text)}">
          <img loading="lazy" src="${esc(httpsUrl(e.url))}" alt="" />
        </button>`).join('')}</div>`;
    pop.querySelectorAll('.emoji-tabs button').forEach((b) => {
      b.addEventListener('click', () => { active = Number(b.dataset.i); draw(); });
    });
    pop.querySelectorAll('.emoji-item').forEach((b) => {
      b.addEventListener('click', () => {
        insertAtCursor(input, b.dataset.text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  };
  draw();
  const dismiss = () => {
    pop.remove();
    if (usesPlayer) bridge.playerCmd({ cmd: 'show' });
    document.removeEventListener('mousedown', close);
    document.removeEventListener('keydown', onKey);
  };
  const close = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) dismiss();
  };
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  setTimeout(() => {
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function bindComposer(root, { getTarget, onPosted, placeholder, biz = 'reply' }) {
  const input = root.querySelector('.c-input');
  const send = root.querySelector('.c-send');
  const count = root.querySelector('.c-count');
  const chip = root.querySelector('.c-reply-chip');
  const chipName = root.querySelector('.c-reply-name');
  const cancel = root.querySelector('.c-reply-cancel');
  const previews = root.querySelector('.c-previews');
  if (!input || !send) return;
  let target = null;
  const state_ = { images: [] };

  const renderPreviews = () => {
    if (!previews) return;
    previews.hidden = !state_.images.length;
    previews.innerHTML = state_.images.map((im, i) =>
      `<span class="c-preview"><img src="${esc(httpsUrl(im.url))}" alt="" />
        <button class="c-preview-del" data-i="${i}" title="移除">×</button></span>`).join('');
    previews.querySelectorAll('.c-preview-del').forEach((b) => {
      b.addEventListener('click', () => {
        state_.images.splice(Number(b.dataset.i), 1);
        renderPreviews();
        sync();
      });
    });
  };

  const sync = () => {
    count.textContent = `${input.value.length}/1000`;
    send.disabled = (!input.value.trim() && !state_.images.length) || send.dataset.busy === '1';
  };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  cancel.addEventListener('click', () => {
    target = null;
    chip.hidden = true;
    input.placeholder = placeholder || '发一条友善的评论…';
  });
  root.addEventListener('reply-to', (e) => {
    target = e.detail || null;
    if (!target) return;
    chip.hidden = false;
    chipName.textContent = `回复 @${target.name}`;
    input.placeholder = `回复 @${target.name}`;
    input.focus();
  });

  root.querySelector('[data-tool="emoji"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openEmojiPicker(e.currentTarget, input, biz);
  });
  root.querySelector('[data-tool="image"]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const res = await bridge.uploadImages({ biz }).catch(() => null);
    btn.dataset.busy = '0';
    if (!res || !res.ok) {
      if (res && !res.canceled) toast(res.message || '图片上传失败');
      return;
    }
    state_.images = state_.images.concat(res.images).slice(0, 9);
    renderPreviews();
    sync();
  });

  async function submit() {
    const message = input.value.trim();
    if ((!message && !state_.images.length) || send.dataset.busy === '1') return;
    const t = getTarget ? getTarget() : {};
    if (!t || !t.oid) return toast('暂时无法评论');
    send.dataset.busy = '1';
    send.textContent = '发布中…';
    sync();
    const res = await bridge.addComment({
      oid: t.oid, type: t.type, message,
      root: target ? target.root : 0,
      parent: target ? target.parent : 0,
      pictures: state_.images,
    }).catch(() => null);
    send.dataset.busy = '0';
    send.textContent = '发布';
    if (res && res.code === 0) {
      input.value = '';
      target = null;
      chip.hidden = true;
      state_.images = [];
      renderPreviews();
      input.placeholder = placeholder || '发一条友善的评论…';
      toast('评论已发布');
      sync();
      if (onPosted) onPosted(res.data);
    } else {
      sync();
      toast((res && (res.message || (res.code === -101 ? '请先登录' : '发布失败'))) || '发布失败');
    }
  }
  send.addEventListener('click', submit);
  sync();
}

function commentActionsHTML(c, isOwn) {
  const liked = !!(c.action && c.action === 1) || !!c.liked;
  return `<div class="c-actions">
    <button class="c-act c-like${liked ? ' on' : ''}" data-like="${esc(String(c.rpid))}" data-liked="${liked ? 1 : 0}">
      <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6C19 15.4 12 20 12 20z" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      <span>${fmtNum(c.like || 0)}</span>
    </button>
    <button class="c-act" data-reply data-parent="${esc(String(c.rpid))}" data-root="${esc(String(c.root || c.rpid))}"
      data-name="${esc(c.member?.uname || '')}">回复</button>
    ${isOwn ? `<button class="c-act c-del" data-del="${esc(String(c.rpid))}">删除</button>` : ''}
  </div>`;
}

function bindCommentActions(root, { getTarget, onDeleted }) {
  const compose = root.closest('.c-section')?.querySelector('.c-compose');
  root.querySelectorAll('[data-like]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const t = getTarget ? getTarget() : {};
      const on = btn.dataset.liked !== '1';
      const res = await bridge.likeComment({ oid: t.oid, type: t.type, rpid: btn.dataset.like, like: on }).catch(() => null);
      if (res && res.code === 0) {
        btn.dataset.liked = on ? '1' : '0';
        btn.classList.toggle('on', on);
        const label = btn.querySelector('span');
        const n = Number(String(label?.textContent || '0').replace(/[^\d.]/g, '')) || 0;
        if (label) label.textContent = fmtNum(Math.max(0, n + (on ? 1 : -1)));
        const path = btn.querySelector('svg path');
        if (path) path.setAttribute('fill', on ? 'currentColor' : 'none');
      } else {
        toast((res && res.message) || '操作失败');
      }
    });
  });
  root.querySelectorAll('[data-reply]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      compose?.dispatchEvent(new CustomEvent('reply-to', {
        detail: { root: Number(btn.dataset.root), parent: Number(btn.dataset.parent), name: btn.dataset.name },
      }));
      compose?.querySelector('.c-input')?.focus();
    });
  });
  root.querySelectorAll('[data-del]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    let armed = false;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = '确认删除';
        setTimeout(() => { armed = false; btn.textContent = '删除'; }, 3000);
        return;
      }
      const t = getTarget ? getTarget() : {};
      const res = await bridge.delComment({ oid: t.oid, type: t.type, rpid: btn.dataset.del }).catch(() => null);
      if (res && res.code === 0) {
        const node = btn.closest('.comment, .c-reply');
        node?.remove();
        toast('已删除');
        if (onDeleted) onDeleted();
      } else {
        toast((res && res.message) || '删除失败');
        armed = false;
        btn.textContent = '删除';
      }
    });
  });
}

/* ------------------------------ 视频评论 ------------------------------ */

async function initVideoComments(container, aid, sort) {
  if (!container) return;
  container.dataset.pn = '0';
  container.dataset.done = '0';
  container.innerHTML = `<div class="c-section">
    ${composerHTML()}
    <div class="c-list" id="video-c-list">${skeletons(3)}</div>
  </div>`;
  const list = $('video-c-list');
  bindComposer(container, {
    getTarget: () => ({ oid: aid, type: 1 }),
    onPosted: (data) => {
      if (data && data.reply) insertPostedComment(list, data.reply, { oid: aid, type: 1 });
      else { container.dataset.pn = '0'; container.dataset.done = '0'; loadVideoComments(list, aid, sort, true); }
    },
  });
  const toolbar = container.parentElement?.querySelector('.c-toolbar');
  if (toolbar) {
    toolbar.querySelectorAll('.c-sort').forEach((btn) => {
      btn.classList.toggle('on', Number(btn.dataset.sort) === Number(sort));
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.c-sort').forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        initVideoComments(container, aid, Number(btn.dataset.sort));
      });
    });
  }
  await loadVideoComments(list, aid, sort, true);
}

async function loadVideoComments(container, aid, sort, reset) {
  if (!container) return;
  if (container.dataset.loading === '1') return;
  if (reset !== true && container.dataset.done === '1') return;
  container.dataset.loading = '1';
  const pn = Number(container.dataset.pn || '0') + 1;
  const r = await api(`/x/v2/reply?type=1&oid=${aid}&sort=${sort}&ps=20&pn=${pn}`).catch(() => null);
  const list = (r && r.data && r.data.replies) || [];
  container.dataset.pn = String(pn);
  if (!list.length) container.dataset.done = '1';
  const meMid = state.login && state.login.mid;
  const html = list.map((c) => commentHTML(c, {
    isOwn: meMid && Number(c.mid) === Number(meMid),
  })).join('');
  if (reset === true) container.innerHTML = '';
  const listEl = document.createElement('div');
  listEl.className = 'comments';
  listEl.innerHTML = html || '<div class="empty" style="padding:24px">还没有评论</div>';
  container.appendChild(listEl);
  bindReplies(listEl, 1, aid);
  bindCommentActions(listEl, {
    getTarget: () => ({ oid: aid, type: 1 }),
    onDeleted: () => {},
  });
  bindCommentPics(listEl);

  let more = container.querySelector('.load-more-wrap');
  if (more) more.remove();
  more = document.createElement('div');
  more.className = 'load-more-wrap';
  more.innerHTML = container.dataset.done === '1'
    ? '<span class="c-loading">没有更多评论了</span>'
    : '<button class="glass-btn" id="c-more">加载更多评论</button>';
  container.appendChild(more);
  const btn = more.querySelector('#c-more');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.textContent = '加载中…';
      await loadVideoComments(container, aid, sort, false);
    });
  }
  container.dataset.loading = '0';
}

function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commentTextHTML(content) {
  const text = String((content && content.message) || '');
  const emotes = (content && content.emote) || {};
  const keys = Object.keys(emotes).sort((a, b) => b.length - a.length);
  if (!keys.length) return esc(text);
  const re = new RegExp('(' + keys.map(escRe).join('|') + ')', 'g');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    const e = emotes[m[0]] || {};
    out += `<img class="c-emoji" src="${esc(httpsUrl(e.url))}" alt="${esc(m[0])}" title="${esc(m[0])}" loading="lazy" />`;
    last = m.index + m[0].length;
  }
  out += esc(text.slice(last));
  return out;
}

function commentPicsHTML(content) {
  const pics = ((content && content.pictures) || [])
    .map((p) => httpsUrl(p.img_src || p.img_src_url || p.url))
    .filter(Boolean);
  if (!pics.length) return '';
  return `<div class="c-pics">${pics.slice(0, 9).map((src, i) =>
    `<img class="c-pic" loading="lazy" src="${esc(src)}" data-src="${esc(src)}" data-idx="${i}" alt="" />`).join('')}</div>`;
}

function bindCommentPics(root) {
  root.querySelectorAll('.c-pics').forEach((box) => {
    const imgs = [...box.querySelectorAll('.c-pic')];
    imgs.forEach((img, i) => {
      if (img.dataset.bound === '1') return;
      img.dataset.bound = '1';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(imgs.map((x) => x.dataset.src), i);
      });
    });
  });
}

function commentHTML(c, opts = {}) {
  return `<div class="comment">
    <img class="c-avatar" loading="lazy" src="${esc(httpsUrl(c.member?.avatar))}" alt="" />
    <div class="c-body">
      <div class="c-head">
        <span class="c-name">${esc(c.member?.uname || '')}</span>
        <span class="c-time">${fmtDate(c.ctime)}</span>
        <span class="c-like">♡ ${fmtNum(c.like)}</span>
      </div>
      <div class="c-text">${commentTextHTML(c.content)}</div>
      ${commentPicsHTML(c.content)}
      ${commentActionsHTML(c, opts.isOwn)}
      ${c.rcount ? `<button class="c-sub" data-root="${c.rpid}" data-rcount="${c.rcount}">展开 ${c.rcount} 条回复</button>` : ''}
      <div class="c-replies" data-replies="${c.rpid}"></div>
    </div>
  </div>`;
}

/* ------------------------------ 图片查看器 ------------------------------ */

let lightboxState = null;

function lightboxKeys(e) {
  if (!lightboxState) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') stepLightbox(-1);
  else if (e.key === 'ArrowRight') stepLightbox(1);
}

function renderLightbox() {
  const img = $('lb-img');
  const count = $('lb-count');
  if (!img || !lightboxState) return;
  const url = lightboxState.urls[lightboxState.index];
  img.src = url;
  img.style.transform = `scale(${lightboxState.zoom || 1})`;
  if (count) count.textContent = `${lightboxState.index + 1} / ${lightboxState.urls.length}`;
  const prev = $('lb-prev');
  const next = $('lb-next');
  if (prev) prev.style.visibility = lightboxState.urls.length > 1 ? 'visible' : 'hidden';
  if (next) next.style.visibility = lightboxState.urls.length > 1 ? 'visible' : 'hidden';
}

function stepLightbox(delta) {
  if (!lightboxState) return;
  const n = lightboxState.urls.length;
  if (n < 2) return;
  lightboxState.index = (lightboxState.index + delta + n) % n;
  renderLightbox();
}

function closeLightbox() {
  const el = document.getElementById('lightbox');
  if (el) el.remove();
  document.removeEventListener('keydown', lightboxKeys);
  lightboxState = null;
}

function openLightbox(urls, index = 0) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return;
  let el = document.getElementById('lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.className = 'lightbox';
    el.innerHTML = `
      <div class="lb-stage">
        <img class="lb-img" id="lb-img" alt="" />
        <button class="lb-nav prev" id="lb-prev" title="上一张">‹</button>
        <button class="lb-nav next" id="lb-next" title="下一张">›</button>
      </div>
      <div class="lb-bar">
        <span class="lb-count" id="lb-count"></span>
        <span class="spacer"></span>
        <button class="glass-btn" id="lb-save">保存图片</button>
        <button class="glass-btn" id="lb-open">浏览器打开</button>
        <button class="glass-btn" id="lb-close">关闭</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.classList.contains('lb-stage')) closeLightbox();
    });
    $('lb-close').addEventListener('click', closeLightbox);
    $('lb-prev').addEventListener('click', () => stepLightbox(-1));
    $('lb-next').addEventListener('click', () => stepLightbox(1));
    $('lb-save').addEventListener('click', async () => {
      if (!lightboxState) return;
      const url = lightboxState.urls[lightboxState.index];
      const r = await bridge.saveImage(url).catch(() => null);
      toast(r && r.ok ? '已保存到下载文件夹' : (r && r.message) || '保存失败');
    });
    $('lb-open').addEventListener('click', () => {
      if (!lightboxState) return;
      bridge.openExternal(lightboxState.urls[lightboxState.index]);
    });
    const img = $('lb-img');
    img.addEventListener('wheel', (e) => {
      if (!lightboxState) return;
      e.preventDefault();
      const next = (lightboxState.zoom || 1) + (e.deltaY < 0 ? 0.15 : -0.15);
      lightboxState.zoom = Math.max(0.5, Math.min(3, next));
      img.style.transform = `scale(${lightboxState.zoom})`;
    }, { passive: false });
    img.addEventListener('dblclick', () => {
      if (!lightboxState) return;
      lightboxState.zoom = 1;
      img.style.transform = 'scale(1)';
    });
  }
  lightboxState = { urls: list, index: Math.max(0, Math.min(index, list.length - 1)), zoom: 1 };
  renderLightbox();
  document.addEventListener('keydown', lightboxKeys);
}

/* ------------------------------ 登录门 ------------------------------ */

function renderLoginGate(title) {
  view.innerHTML = `
    <div class="view-head"><div class="view-title">${title}</div></div>
    <div class="empty">
      登录后才能查看${title}
      <div style="margin-top:14px"><button class="glass-btn" id="gate-login" style="max-width:170px;margin:0 auto">登录哔哩哔哩</button></div>
    </div>`;
  const btn = $('gate-login');
  if (btn) btn.addEventListener('click', () => bridge.openLogin());
}

function listHeader(title, sub) {
  return `<div class="view-head"><div class="view-title">${title}</div><div class="view-sub">${sub || ''}</div><div class="spacer"></div></div>`;
}

/* ------------------------------ 历史记录 ------------------------------ */

async function renderHistory() {
  if (!state.login) return renderLoginGate('历史记录');
  view.innerHTML = `
    <div class="view-head">
      <div class="view-title">历史记录</div><div class="view-sub">按最近观看排序</div>
      <div class="spacer"></div>
      <button class="ghost-btn" id="hist-clear">清空历史</button>
    </div>
    <div id="feed">${skeletons(8)}</div>`;
  const clearBtn = $('hist-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (clearBtn.dataset.armed !== '1') {
        clearBtn.dataset.armed = '1';
        clearBtn.textContent = '再点一次确认清空';
        setTimeout(() => { clearBtn.dataset.armed = '0'; clearBtn.textContent = '清空历史'; }, 3000);
        return;
      }
      const res = await bridge.actionPage('/x/v2/history/clear', {}).catch(() => null);
      if (res && res.code === 0) { toast('历史已清空'); navigate('history'); }
      else toast((res && res.message) || '清空失败');
    });
  }
  let cursor = { max: 0, view_at: 0 };
  let items = [];
  let done = false;
  let loading = false;

  const draw = () => {
    const feed = $('feed');
    if (!feed) return;
    if (!items.length) {
      feed.innerHTML = '<div class="empty">还没有观看记录</div>';
      return;
    }
    feed.innerHTML = `<div class="grid">${items.map((it) => `
      <div class="card-wrap">
        ${cardHTML({
          title: it.title,
          pic: it.cover,
          up: it.author_name,
          dur: fmtDur(it.duration),
          progress: it.progress > 0 && it.duration ? it.progress / it.duration : 0,
        })}
        <button class="card-remove" data-kid="${esc(String(it.history?.oid || ''))}" title="删除这条记录">删除</button>
      </div>`).join('')}</div>`;
    attachCardClicks(feed, items.map((it) => it.history?.bvid));
    feed.querySelectorAll('.card-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const kid = btn.dataset.kid;
        const res = await bridge.deleteHistory({ kid }).catch(() => null);
        if (res && res.code === 0) {
          btn.closest('.card-wrap')?.remove();
          toast('已删除这条记录');
        } else {
          toast((res && res.message) || '删除失败');
        }
      });
    });
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const d = await api(`/x/web-interface/history/cursor?max=${cursor.max}&view_at=${cursor.view_at}&business=&ps=20`).catch(() => null);
    const list = (d && d.data && d.data.list) || [];
    if (d && d.data && d.data.cursor) cursor = d.data.cursor;
    items = items.concat(list);
    done = list.length === 0;
    draw();
    loading = false;
  };

  await load();
  setInfinite(load);
}

/* ------------------------------ 收藏夹 ------------------------------ */

async function renderFavorites(folderId) {
  if (!state.login) return renderLoginGate('收藏夹');
  view.innerHTML = `${listHeader('收藏夹', '')}<div id="fav-body">${skeletons(8)}</div>`;

  const foldersRes = await api(`/x/v3/fav/folder/created/list-all?up_mid=${state.login.mid}`).catch(() => null);
  const folders = (foldersRes && foldersRes.data && foldersRes.data.list) || [];
  if (!folders.length) {
    view.innerHTML = `${listHeader('收藏夹', '')}<div class="empty">还没有收藏夹</div>`;
    return;
  }
  const currentId = Number(folderId) || folders[0].id;
  const current = folders.find((f) => f.id === currentId) || folders[0];

  const body = $('fav-body');
  body.innerHTML = `
    <div class="chips">${folders.map((f) => `
      <button class="chip${f.id === current.id ? ' on' : ''}" data-fid="${f.id}">${esc(f.title)}<span>${f.media_count}</span></button>`).join('')}</div>
    <div id="feed">${skeletons(8)}</div>`;

  let pn = 0;
  let items = [];
  let done = false;
  let loading = false;

  const draw = () => {
    const feed = $('feed');
    if (!feed) return;
    if (!items.length) {
      feed.innerHTML = '<div class="empty">这个收藏夹还是空的</div>';
      return;
    }
    feed.innerHTML = `<div class="grid">${items.map((m) => `
      <div class="card-wrap">
        ${cardHTML({
          title: m.title,
          pic: m.cover,
          up: m.upper && m.upper.name,
          views: fmtNum(m.cnt_info && m.cnt_info.play),
          dur: fmtDur(m.duration),
        })}
        <button class="card-remove" data-aid="${m.id}" title="取消收藏">取消收藏</button>
      </div>`).join('')}</div>`;
    attachCardClicks(feed, items.map((m) => m.bvid));
    feed.querySelectorAll('.card-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await bridge.actionPage('/x/v3/fav/resource/deal', {
          rid: Number(btn.dataset.aid), type: 2, add_media_ids: '', del_media_ids: current.id,
        }).catch(() => null);
        if (res && res.code === 0) {
          btn.closest('.card-wrap')?.remove();
          toast('已取消收藏');
        } else {
          toast((res && res.message) || '操作失败');
        }
      });
    });
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const page = pn + 1;
    const d = await api(`/x/v3/fav/resource/list?media_id=${current.id}&pn=${page}&ps=20&platform=web`).catch(() => null);
    const list = (d && d.data && d.data.medias) || [];
    const more = !!(d && d.data && d.data.has_more);
    pn = page;
    items = items.concat(list);
    done = !more || !list.length;
    draw();
    loading = false;
  };

  body.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => navigate('fav', { folder: Number(chip.dataset.fid) }));
  });

  await load();
  setInfinite(load);
}

/* ------------------------------ 稍后再看 ------------------------------ */

async function renderWatchLater() {
  if (!state.login) return renderLoginGate('稍后再看');
  view.innerHTML = `${listHeader('稍后再看', '')}<div id="feed">${skeletons(6)}</div>`;
  const d = await api('/x/v2/history/toview').catch(() => null);
  const list = (d && d.data && d.data.list) || [];
  const feed = $('feed');
  if (!feed) return;
  if (!list.length) {
    feed.innerHTML = '<div class="empty">稍后再看是空的</div>';
    return;
  }
  feed.innerHTML = `<div class="grid">${list.map((v) => `
    <div class="card-wrap">
      ${cardHTML({
        title: v.title,
        pic: v.pic,
        up: v.owner && v.owner.name,
        views: fmtNum(v.stat && v.stat.view),
        dur: fmtDur(v.duration),
        progress: v.progress > 0 && v.duration ? v.progress / v.duration : 0,
      })}
      <button class="card-remove" data-aid="${v.aid}" title="从稍后再看移除">移除</button>
    </div>`).join('')}</div>`;
  attachCardClicks(feed, list.map((v) => v.bvid));
  feed.querySelectorAll('.card-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await bridge.delWatchLater({ aid: Number(btn.dataset.aid) }).catch(() => null);
      if (res && res.code === 0) {
        btn.closest('.card-wrap')?.remove();
        toast('已从稍后再看移除');
      } else {
        toast((res && res.message) || '移除失败');
      }
    });
  });
}

/* ------------------------------ 影视分区 ------------------------------ */

const FILM_TYPES = [
  [1, '番剧'], [4, '国创'], [2, '电影'], [5, '电视剧'], [3, '纪录片'], [7, '综艺'],
];

async function renderFilm(seasonType = 1) {
  const type = Number(seasonType) || 1;
  const label = (FILM_TYPES.find(([k]) => k === type) || [1, '番剧'])[1];
  view.innerHTML = `
    <div class="view-head"><div class="view-title">影视</div><div class="view-sub">${label} · 排行榜</div>
      <div class="spacer"></div></div>
    <div class="search-tabs" id="film-tabs">
      ${FILM_TYPES.map(([k, l]) => `<button class="s-tab${k === type ? ' on' : ''}" data-type="${k}">${l}</button>`).join('')}
    </div>
    <div id="feed">${skeletons(10)}</div>`;

  const tabs = $('film-tabs');
  if (tabs) {
    tabs.querySelectorAll('.s-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate('film', { type: Number(btn.dataset.type) }));
    });
  }

  const r = await api(`/pgc/web/rank/list?day=3&season_type=${type}`).catch(() => null);
  const payload = (r && (r.data || r.result)) || {};
  const list = payload.list || [];
  const feed = $('feed');
  if (!feed) return;
  if (!list.length) { feed.innerHTML = '<div class="empty">这个分区暂时没有内容</div>'; return; }

  feed.innerHTML = `<div class="film-grid">${list.map((it) => {
    const cover = it.cover || it.image_url || '';
    const score = it.rating && it.rating.score ? it.rating.score : (it.score || '');
    const sub = it.sub_title || it.index_show || (it.rating && it.rating.count ? `${fmtNum(it.rating.count)} 人评分` : '');
    return `<button class="film-card" data-season="${esc(String(it.season_id || it.seasonId || ''))}"
        data-url="${esc(it.url || it.link || '')}" data-title="${esc(it.title || '')}">
      <span class="film-cover">
        <img loading="lazy" src="${esc(httpsUrl(cover))}" alt="" />
        ${score ? `<span class="film-score">${esc(String(score))}</span>` : ''}
      </span>
      <span class="film-title">${esc(it.title || '')}</span>
      <span class="film-sub">${esc(sub)}</span>
    </button>`;
  }).join('')}</div>`;

  feed.querySelectorAll('.film-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset.season;
      if (sid) navigate('season', { seasonId: sid });
      else if (btn.dataset.url) navigate('web', { url: httpsUrl(btn.dataset.url), title: btn.dataset.title || '影视' });
    });
  });
}

/* ------------------------------ 消息中心 ------------------------------ */

function fmtWhen(value) {
  if (!value) return '';
  const t = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!t || Number.isNaN(t)) return String(value);
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function openByUri(uri) {
  const s = String(uri || '');
  const bv = s.match(/(BV[0-9A-Za-z]{10})/);
  if (bv) return navigate('video', { bvid: bv[1] });
  const av = s.match(/av(\d+)/i);
  if (av) return openAid(av[1]);
  const dyn = s.match(/(?:t\.bilibili\.com|dynamic)\/(\d+)/);
  if (dyn) return navigate('dynDetail', { id: dyn[1] });
  const cv = s.match(/(?:read\/)?cv(\d+)/i);
  if (cv) return navigate('article', { cv: cv[1] });
  const ss = s.match(/ss(\d+)/);
  if (ss) return navigate('season', { seasonId: ss[1] });
  if (/^https?:/.test(s)) return navigate('web', { url: s, title: '详情' });
  toast('这个内容暂时无法在应用内打开');
}

async function openAid(aid) {
  const r = await api(`/x/web-interface/view?aid=${aid}`).catch(() => null);
  const bvid = r && r.data && r.data.bvid;
  if (bvid) return navigate('video', { bvid });
  toast('视频不存在或已删除');
}

async function renderMessages(tab = 'reply') {
  if (!state.login) return renderLoginGate('消息');
  const tabs = [['reply', '回复我的'], ['at', '@我的'], ['like', '收到的赞']];
  const current = tabs.some(([k]) => k === tab) ? tab : 'reply';
  view.innerHTML = `
    <div class="view-head"><div class="view-title">消息</div><div class="view-sub">${(tabs.find(([k]) => k === current) || [])[1] || ''}</div>
      <div class="spacer"></div><button class="ghost-btn" id="msg-web">网页版消息</button></div>
    <div class="search-tabs" id="msg-tabs">
      ${tabs.map(([k, l]) => `<button class="s-tab${k === current ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="msg-list">${skeletons(5)}</div>`;

  $('msg-web')?.addEventListener('click', () => {
    navigate('web', { url: 'https://message.bilibili.com/', title: '消息中心' });
  });
  const tabsEl = $('msg-tabs');
  if (tabsEl) {
    tabsEl.querySelectorAll('.s-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate('messages', { tab: btn.dataset.tab }));
    });
  }

  const box = $('msg-list');
  if (!box) return;
  const endpoint = current === 'like'
    ? '/x/msgfeed/like?pn=1&ps=20'
    : `/x/msgfeed/${current}?pn=1&ps=20`;
  const r = await api(endpoint).catch(() => null);
  const data = (r && r.data) || {};
  let rows = [];

  if (current === 'like') {
    const items = (data.total && data.total.items) || [];
    rows = items.map((it) => {
      const users = it.users || [];
      const first = users[0] || {};
      const others = users.length > 1 ? ` 等 ${users.length} 人` : '';
      const item = it.item || {};
      return {
        avatar: first.avatar,
        name: (first.nickname || '有人') + others,
        time: fmtWhen(item.pub_time || item.ctime),
        text: item.title || item.desc || '赞了你的内容',
        jump: item.uri || item.link || '',
        type: 'like',
      };
    });
  } else {
    const items = data.items || [];
    rows = items.map((it) => {
      const user = it.user || {};
      const item = it.item || {};
      return {
        avatar: user.avatar || user.face,
        name: user.nickname || user.uname || '有人',
        time: fmtWhen(it.reply_time || it.at_time),
        text: item.source_content || item.title || item.source || '',
        jump: item.uri || item.native_uri || '',
        type: current,
        oid: item.oid || item.subject_id,
        title: item.title || '',
      };
    });
  }

  if (!rows.length) {
    box.innerHTML = `<div class="empty">${current === 'like' ? '还没有收到赞' : '暂时没有消息'}</div>`;
    return;
  }

  box.innerHTML = `<div class="msg-list">${rows.map((m, i) => `
    <button class="msg-row" data-idx="${i}">
      <img class="msg-avatar" loading="lazy" src="${esc(httpsUrl(m.avatar))}" alt="" />
      <span class="msg-body">
        <span class="msg-head"><span class="msg-name">${esc(m.name)}</span><span class="msg-time">${esc(m.time)}</span></span>
        <span class="msg-text">${esc(stripTags(m.text)).slice(0, 160)}</span>
      </span>
    </button>`).join('')}</div>`;

  box.querySelectorAll('.msg-row').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const m = rows[Number(btn.dataset.idx)];
      if (!m) return;
      if (m.jump) return openByUri(m.jump);
      if (m.oid && m.type === 'reply') return openAid(m.oid);
      if (m.title) return openByUri(m.title);
      toast('这条消息没有可打开的内容');
    });
  });
}

/* ------------------------------ 专栏 ------------------------------ */

function sanitizeArticleHTML(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const allowed = new Set([
    'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'CODE', 'PRE', 'HR',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'VIDEO', 'SOURCE',
  ]);
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (!allowed.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'id') {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'src' || name === 'href' || name === 'data-src') {
          let v = attr.value || '';
          if (/^\s*javascript:/i.test(v)) { el.removeAttribute(attr.name); continue; }
          if (v.startsWith('//')) el.setAttribute(attr.name, 'https:' + v);
        }
      }
      if (el.tagName === 'IMG') {
        const src = el.getAttribute('data-src') || el.getAttribute('src') || '';
        if (src) {
          el.setAttribute('src', src.startsWith('//') ? 'https:' + src : src);
          el.setAttribute('loading', 'lazy');
          el.classList.add('article-img');
        }
      }
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noreferrer');
        el.classList.add('article-link');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

async function renderArticle(cvId) {
  const cv = String(cvId || '').replace(/\D/g, '');
  if (!cv) { navigate('home'); return; }
  view.innerHTML = `<div class="article-page"><div class="article-loading">${skeletons(2)}</div></div>`;
  const [infoRes, viewRes] = await Promise.all([
    api(`/x/article/viewinfo?id=${cv}`).catch(() => null),
    api(`/x/article/view?id=${cv}`).catch(() => null),
  ]);
  const info = (infoRes && infoRes.data) || {};
  const art = (viewRes && viewRes.data) || {};
  const page = $('article-page') || document.querySelector('.article-page');
  if (!page) return;
  if (!art.title && !info.title) {
    page.innerHTML = `<div class="empty">专栏加载失败<br><br>
      <button class="glass-btn" id="art-web" style="max-width:180px;margin:0 auto">在网页中打开</button></div>`;
    $('art-web')?.addEventListener('click', () => navigate('web', {
      url: `https://www.bilibili.com/read/cv${cv}`, title: '专栏',
    }));
    return;
  }
  const title = art.title || info.title || '';
  const author = art.author || {};
  const authorName = author.name || info.author_name || '';
  const authorMid = author.mid || info.mid || 0;
  const authorFace = author.face || '';
  const banner = art.banner_url || info.banner_url || '';
  const stats = art.stats || info.stats || {};
  const tags = Array.isArray(art.tags) ? art.tags : [];
  const publish = art.publish_time || art.ctime || 0;
  let content = art.content;
  if (Array.isArray(content)) content = content.join('');
  const bodyHTML = sanitizeArticleHTML(content || '');

  page.innerHTML = `
    <div class="article-head">
      <div class="article-title">${esc(stripTags(title))}</div>
      <div class="article-meta">
        <button class="article-author" data-mid="${esc(String(authorMid))}">
          ${authorFace ? `<img src="${esc(httpsUrl(authorFace))}" alt="" />` : ''}
          <span>${esc(authorName)}</span>
        </button>
        <span>${fmtDate(publish)}</span>
        <span>${fmtNum(stats.view || 0)} 阅读</span>
        <span>${fmtNum(stats.like || 0)} 点赞</span>
        <span>${fmtNum(stats.favorite || 0)} 收藏</span>
        <button class="ghost-btn" id="art-web2">网页版</button>
      </div>
    </div>
    ${banner ? `<div class="article-banner"><img loading="lazy" src="${esc(httpsUrl(banner))}" alt="" /></div>` : ''}
    <article class="article-body">${bodyHTML || '<div class="empty">这篇专栏没有正文</div>'}</article>
    ${tags.length ? `<div class="article-tags">${tags.map((t) => `<span class="article-tag">${esc(t.name || t)}</span>`).join('')}</div>` : ''}
    <div class="article-foot">
      <button class="glass-btn" id="art-like">点赞 ${fmtNum(stats.like || 0)}</button>
      <button class="ghost-btn" id="art-origin">在网页中打开</button>
    </div>`;

  page.querySelector('.article-author')?.addEventListener('click', () => {
    if (authorMid) navigate('up', { mid: authorMid });
  });
  $('art-web2')?.addEventListener('click', () => navigate('web', {
    url: `https://www.bilibili.com/read/cv${cv}`, title: '专栏',
  }));
  $('art-origin')?.addEventListener('click', () => navigate('web', {
    url: `https://www.bilibili.com/read/cv${cv}`, title: '专栏',
  }));
  $('art-like')?.addEventListener('click', async () => {
    const r = await bridge.articleLike({ id: cv }).catch(() => null);
    toast(r && r.code === 0 ? '已点赞' : ((r && r.message) || '点赞失败'));
  });

  const imgs = [...page.querySelectorAll('.article-img')];
  imgs.forEach((img, i) => {
    img.addEventListener('click', () => openLightbox(imgs.map((x) => x.src), i));
  });
}

/* ------------------------------ 私信 ------------------------------ *//* ------------------------------ 私信 ------------------------------ */

function imText(m) {
  try {
    const j = JSON.parse(m.content || '{}');
    const t = Number(m.msg_type);
    if (t === 1) return j.content || '';
    if (t === 2 || t === 6) return '[图片]';
    if (t === 7) return `[分享] ${j.title || j.author || ''}`;
    if (t === 10) return j.title || '[系统消息]';
    if (t === 11) return `[视频] ${j.title || ''}`;
    if (t === 12) return `[专栏] ${j.title || ''}`;
    if (t === 13) return j.title || '[图片]';
    if (t === 14) return `[${j.source || '分享'}] ${j.title || ''}`;
    if (t === 18) {
      const arr = JSON.parse(j.content || '[]');
      return Array.isArray(arr) ? arr.map((x) => x.text).filter(Boolean).join(' ') : '[系统提示]';
    }
    if (t >= 301 && t <= 306) return j.content || '[粉丝团消息]';
    if (t === 5) return '[撤回]';
    if (j.content) return String(j.content);
    return '[消息]';
  } catch {
    return String(m.content || '');
  }
}

function imTokensHTML(text) {
  const map = state.imEmotes || {};
  const keys = Object.keys(map);
  if (!keys.length) return esc(text);
  const re = new RegExp('(' + keys.map(escRe).join('|') + ')', 'g');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    out += `<img class="im-emoji" loading="lazy" src="${esc(httpsUrl(map[m[0]]))}" alt="${esc(m[0])}" title="${esc(m[0])}" />`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

function imAvatarHTML(face, name, cls = '') {
  const url = httpsUrl(face || '');
  if (url) return `<img class="im-avatar ${cls}" loading="lazy" src="${esc(url)}" alt="" />`;
  const ch = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return `<span class="im-avatar im-avatar-ph ${cls}">${esc(ch)}</span>`;
}

function imCardHTML({ kind, title, sub, cover, attrs }) {
  return `<div class="im-card" ${attrs || ''}>
    ${cover ? `<img class="im-card-cover" loading="lazy" src="${esc(httpsUrl(cover))}" alt="" />` : ''}
    <div class="im-card-body">
      ${kind ? `<div class="im-card-kind">${esc(kind)}</div>` : ''}
      <div class="im-card-title">${esc(title || '')}</div>
      ${sub ? `<div class="im-card-sub">${esc(sub)}</div>` : ''}
    </div>
  </div>`;
}

function imBubbleHTML(m) {
  let j = {};
  try { j = JSON.parse(m.content || '{}'); } catch { j = { content: m.content || '' }; }
  const t = Number(m.msg_type);
  if (m.msg_status === 1 || t === 5) return { html: '<span class="im-sys">消息已撤回</span>', sys: true };
  if (t === 1) return { html: imTokensHTML(String(j.content || '')) };
  if (t === 2 || t === 6) {
    const url = j.url || '';
    if (!url) return { html: '<span class="im-sys">[图片]</span>', sys: true };
    return { html: `<img class="im-img" loading="lazy" src="${esc(httpsUrl(url))}" data-full="${esc(httpsUrl(url))}" alt="" />` };
  }
  if (t === 7) {
    const s = Number(j.source);
    const kind = s === 5 ? '视频' : s === 6 ? '专栏' : (s === 7 || s === 16 || s === 17) ? '番剧'
      : s === 11 ? '动态' : s === 8 ? '音乐' : s === 2 ? '相簿' : s === 3 ? '文字' : '分享';
    let attrs = '';
    if (j.bvid) attrs = `data-im-video="${esc(j.bvid)}"`;
    else if (s === 6) attrs = `data-im-article="${esc(String(j.id || ''))}"`;
    else if (s === 7 || s === 16 || s === 17) attrs = `data-im-season="${esc(String(j.id || ''))}"`;
    else if (s === 11) attrs = `data-im-dyn="${esc(String(j.id || ''))}"`;
    else if (j.url) attrs = `data-im-url="${esc(j.url)}"`;
    return { html: imCardHTML({ kind, title: j.title, sub: j.author, cover: j.thumb, attrs }) };
  }
  if (t === 11) {
    return { html: imCardHTML({
      kind: '视频', title: j.title, sub: j.attach_msg && j.attach_msg.content ? j.attach_msg.content : (j.desc || '').slice(0, 60),
      cover: j.cover, attrs: j.bvid ? `data-im-video="${esc(j.bvid)}"` : `data-im-avid="${esc(String(j.rid || ''))}"`,
    }) };
  }
  if (t === 12) {
    return { html: imCardHTML({
      kind: '专栏', title: j.title, sub: j.author, cover: (j.image_urls && j.image_urls[0]) || '',
      attrs: `data-im-article="${esc(String(j.rid || ''))}"`,
    }) };
  }
  if (t === 13) {
    return { html: imCardHTML({
      kind: '图片', title: j.title, cover: j.pic_url, attrs: j.jump_url ? `data-im-url="${esc(j.jump_url)}"` : '',
    }) };
  }
  if (t === 14) {
    return { html: imCardHTML({
      kind: j.source || '分享', title: j.title, sub: j.author, cover: j.cover,
      attrs: j.url ? `data-im-url="${esc(j.url)}"` : '',
    }) };
  }
  if (t === 10) {
    const cfg = j.jump_uri_config || {};
    const jump = cfg.web_uri || cfg.all_uri || j.jump_uri || '';
    return { html: `<div class="im-notice">
      <div class="im-notice-title">${esc(j.title || '系统消息')}</div>
      ${j.text ? `<div class="im-notice-text">${esc(j.text)}</div>` : ''}
      ${Array.isArray(j.modules) ? j.modules.map((x) => `<div class="im-notice-row"><span>${esc(x.title || '')}</span><b>${esc(x.detail || '')}</b></div>`).join('') : ''}
      ${jump ? `<button class="ghost-btn im-notice-btn" data-im-url="${esc(jump)}">${esc(j.jump_text || '查看详情')}</button>` : ''}
    </div>` };
  }
  if (t === 18) {
    let arr = [];
    try { arr = JSON.parse(j.content || '[]'); } catch { arr = []; }
    const txt = (Array.isArray(arr) ? arr : []).map((x) => x.text).filter(Boolean).join(' ');
    const jump = (Array.isArray(arr) && arr[0] && arr[0].jump_url) || '';
    return {
      html: `<span class="im-sys">${esc(txt || '系统提示')}${jump ? ` <a class="im-sys-link" data-im-url="${esc(jump)}">查看</a>` : ''}</span>`,
      sys: true,
    };
  }
  if (t >= 301 && t <= 306) return { html: `<span class="im-sys">${esc(j.content || '')}</span>`, sys: true };
  if (j.content) return { html: imTokensHTML(String(j.content)) };
  return { html: '<span class="im-sys">[暂不支持的消息]</span>', sys: true };
}

async function renderIM(talker) {
  if (talker) return renderIMChat(talker);
  if (!state.login) return renderLoginGate('私信');
  view.innerHTML = `
    <div class="view-head"><div class="view-title">私信</div>
      <div class="view-sub" id="im-sub">加载中…</div><div class="spacer"></div></div>
    <div class="im-list" id="im-list">${skeletons(6)}</div>`;
  const res = await bridge.imSessions().catch(() => null);
  const sessions = (res && res.sessions) || [];
  const list = $('im-list');
  if (!list) return;
  const sub = $('im-sub');
  if (sub) sub.textContent = sessions.length ? `${sessions.length} 个会话` : '';
  if (!sessions.length) {
    list.innerHTML = '<div class="empty">还没有私信</div>';
    return;
  }
  list.innerHTML = sessions.map((s) => {
    const preview = s.last ? imText(s.last) : '';
    const mine = s.last && Number(s.last.sender_uid) === Number(state.login.mid);
    const unread = Number(s.unread) || 0;
    return `<button class="im-row" data-talker="${esc(String(s.talkerId))}">
      <span class="im-avatar-wrap">
        ${imAvatarHTML(s.face, s.name)}
        ${unread ? `<span class="im-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
      </span>
      <span class="im-info">
        <span class="im-head"><span class="im-name">${esc(s.name || '')}</span>
          <span class="im-time">${fmtDate(s.ts)}</span></span>
        <span class="im-last">${mine ? '我: ' : ''}${esc(String(preview || '').slice(0, 48))}</span>
      </span>
    </button>`;
  }).join('');
  list.querySelectorAll('.im-row').forEach((el) => {
    el.addEventListener('click', () => navigate('im', { talker: el.dataset.talker }));
  });
}

async function renderIMChat(talker) {
  const me = state.login;
  view.innerHTML = `
    <div class="view-head"><div class="view-title">私信</div>
      <div class="view-sub" id="im-chat-sub"></div><div class="spacer"></div>
      <button class="ghost-btn" id="im-back">返回会话</button></div>
    <div class="im-chat" id="im-chat">${skeletons(3)}</div>
    <div class="im-compose">
      <div class="c-previews" id="im-previews" hidden></div>
      <div class="im-compose-row">
        <textarea class="c-input" id="im-input" rows="2" maxlength="500" placeholder="发消息…"></textarea>
        <div class="im-compose-tools">
          <button class="c-tool" data-tool="emoji" title="表情">😊</button>
          <button class="c-tool" data-tool="image" title="图片">🖼</button>
          <button class="glass-btn" id="im-send">发送</button>
        </div>
      </div>
    </div>`;

  $('im-back')?.addEventListener('click', () => navigate('im'));

  // 表情映射（一次加载）
  if (!state.imEmotes) {
    const ep = await bridge.emotePanel({ biz: 'reply' }).catch(() => null);
    const map = {};
    ((ep && ep.packages) || []).forEach((pkg) => (pkg.emotes || []).forEach((e) => {
      if (e.text && e.url) map[e.text] = e.url;
    }));
    state.imEmotes = map;
  }

  // 头像映射
  const ses = await bridge.imSessions().catch(() => null);
  const faces = {};
  const names = {};
  ((ses && ses.sessions) || []).forEach((s) => {
    if (!s.talkerId) return;
    faces[s.talkerId] = s.face || '';
    names[s.talkerId] = s.name || '';
  });

  const res = await bridge.imMessages({ talkerId: talker }).catch(() => null);
  const messages = (res && res.messages) || [];
  const chat = $('im-chat');
  if (!chat) return;
  if (!messages.length) {
    chat.innerHTML = '<div class="empty">还没有聊过，打个招呼吧</div>';
  } else {
    chat.innerHTML = messages.map((m) => {
      const mine = Number(m.sender_uid) === Number(me.mid);
      const b = imBubbleHTML(m);
      const face = faces[m.sender_uid] || '';
      const uname = names[m.sender_uid] || '';
      return `<div class="im-msg${mine ? ' mine' : ''}${b.sys ? ' sys' : ''}">
        ${mine ? '' : imAvatarHTML(face, uname, 'sm')}
        <div class="im-bubble">${b.html}</div>
      </div>`;
    }).join('');
    chat.scrollTop = chat.scrollHeight;
  }

  // 卡片跳转 / 图片查看
  chat.addEventListener('click', (e) => {
    const img = e.target.closest('.im-img');
    if (img) { openLightbox([img.dataset.full], 0); return; }
    const video = e.target.closest('[data-im-video]');
    if (video) { navigate('video', { bvid: video.dataset.imVideo }); return; }
    const avid = e.target.closest('[data-im-avid]');
    if (avid) { navigate('video', { aid: avid.dataset.imAvid }); return; }
    const article = e.target.closest('[data-im-article]');
    if (article) { navigate('article', { cv: article.dataset.imArticle }); return; }
    const season = e.target.closest('[data-im-season]');
    if (season) { navigate('season', { seasonId: season.dataset.imSeason }); return; }
    const dyn = e.target.closest('[data-im-dyn]');
    if (dyn) { navigate('dynDetail', { dynId: dyn.dataset.imDyn }); return; }
    const url = e.target.closest('[data-im-url]');
    if (url) { navigate('web', { url: url.dataset.imUrl, title: '分享内容' }); }
  });

  const input = $('im-input');
  const send = $('im-send');
  const previews = $('im-previews');
  const pending = [];
  const renderPreviews = () => {
    previews.hidden = !pending.length;
    previews.innerHTML = pending.map((im, i) =>
      `<span class="c-preview"><img src="${esc(httpsUrl(im.url))}" alt="" />
        <button class="c-preview-del" data-i="${i}" title="移除">×</button></span>`).join('');
    previews.querySelectorAll('.c-preview-del').forEach((b) => {
      b.addEventListener('click', () => { pending.splice(Number(b.dataset.i), 1); renderPreviews(); });
    });
  };
  const appendBubble = (m) => {
    const b = imBubbleHTML(m);
    const node = document.createElement('div');
    node.className = `im-msg mine${b.sys ? ' sys' : ''}`;
    node.innerHTML = `<div class="im-bubble">${b.html}</div>`;
    chat.appendChild(node);
    chat.scrollTop = chat.scrollHeight;
  };

  const doSend = async () => {
    if (send.dataset.busy === '1') return;
    const text = (input?.value || '').trim();
    if (!text && !pending.length) return;
    send.dataset.busy = '1';
    send.textContent = '发送中…';
    let r = null;
    if (pending.length) {
      const im = pending[0];
      r = await bridge.imSend({ talkerId: talker, type: 2, payload: im }).catch(() => null);
      if (r && r.code === 0) {
        pending.shift();
        renderPreviews();
        appendBubble({ msg_type: 2, content: JSON.stringify({ url: im.url, width: im.width, height: im.height }) });
      }
    } else {
      r = await bridge.imSend({ talkerId: talker, text }).catch(() => null);
      if (r && r.code === 0) {
        input.value = '';
        appendBubble({ msg_type: 1, content: JSON.stringify({ content: text }) });
      }
    }
    send.dataset.busy = '0';
    send.textContent = '发送';
    if (!r || r.code !== 0) toast((r && (r.message || (r.code === -101 ? '请先登录' : '发送失败'))) || '发送失败');
  };

  send?.addEventListener('click', doSend);
  input?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSend(); }
  });
  view.querySelector('[data-tool="emoji"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openEmojiPicker(e.currentTarget, input, 'reply');
  });
  view.querySelector('[data-tool="image"]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const up = await bridge.uploadImages({ biz: 'im' }).catch(() => null);
    btn.dataset.busy = '0';
    if (!up || !up.ok) { if (up && !up.canceled) toast(up.message || '图片上传失败'); return; }
    pending.push(...up.images);
    if (pending.length > 9) pending.length = 9;
    renderPreviews();
  });
}

/* ------------------------------ 关注 / 粉丝 ------------------------------ *//* ------------------------------ 关注 / 粉丝 ------------------------------ */

async function renderRelation(mid, type = 'following') {
  const target = Number(mid) || (state.login && state.login.mid);
  if (!target) return renderLoginGate('关注与粉丝');
  const isFollowing = type !== 'followers';
  view.innerHTML = `
    <div class="view-head"><div class="view-title">${isFollowing ? '关注' : '粉丝'}</div>
      <div class="view-sub" id="rel-sub">加载中…</div><div class="spacer"></div></div>
    <div class="search-tabs" id="rel-tabs">
      <button class="s-tab${isFollowing ? ' on' : ''}" data-type="following">关注</button>
      <button class="s-tab${!isFollowing ? ' on' : ''}" data-type="followers">粉丝</button>
    </div>
    <div id="rel-list">${skeletons(6)}</div>`;

  const tabsEl = $('rel-tabs');
  if (tabsEl) {
    tabsEl.querySelectorAll('.s-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigate('relation', { mid: target, type: btn.dataset.type }));
    });
  }

  let pn = 0;
  let items = [];
  let done = false;
  let loading = false;
  const box = $('rel-list');

  const draw = () => {
    if (!box) return;
    if (!items.length) { box.innerHTML = '<div class="empty">这里还没有人</div>'; return; }
    box.innerHTML = `<div class="rel-list">${items.map((u) => `
      <div class="rel-row">
        <img class="rel-avatar" loading="lazy" src="${esc(httpsUrl(u.face))}" alt="" />
        <button class="rel-body" data-mid="${esc(String(u.mid || ''))}">
          <span class="rel-name">${esc(u.uname || '')}</span>
          <span class="rel-sign">${esc(u.sign || '这个人很神秘')}</span>
        </button>
        <button class="ghost-btn rel-follow" data-mid="${esc(String(u.mid || ''))}" data-attr="${Number(u.attribute) || 0}">
          ${Number(u.attribute) ? '已关注' : '关注'}
        </button>
      </div>`).join('')}</div>`;
    box.querySelectorAll('.rel-body').forEach((btn) => {
      btn.addEventListener('click', () => navigate('up', { mid: Number(btn.dataset.mid) }));
    });
    box.querySelectorAll('.rel-follow').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const followed = btn.dataset.attr !== '0';
        const res = await bridge.actionPage('/x/relation/modify', {
          fid: Number(btn.dataset.mid), act: followed ? 2 : 1, re_src: 11,
        }).catch(() => null);
        if (res && res.code === 0) {
          btn.dataset.attr = followed ? '0' : '1';
          btn.textContent = followed ? '关注' : '已关注';
          toast(followed ? '已取消关注' : '已关注');
        } else {
          toast((res && res.message) || '操作失败');
        }
      });
    });
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const r = await api(`/x/relation/${isFollowing ? 'followings' : 'followers'}?vmid=${target}&pn=${pn + 1}&ps=20&order=desc`).catch(() => null);
    const list = (r && r.data && r.data.list) || [];
    const total = (r && r.data && r.data.total) || 0;
    pn += 1;
    items = items.concat(list);
    done = list.length < 20;
    const sub = $('rel-sub');
    if (sub) sub.textContent = total ? `共 ${fmtNum(total)} 人` : '';
    draw();
    loading = false;
  };

  await load();
  if (items.length) setInfinite(load);
}

/* ------------------------------ 直播 ------------------------------ */

async function renderLive() {
  view.innerHTML = `${listHeader('直播', '正在直播')}<div id="feed">${skeletons(8)}</div>`;
  let page = 1;
  let items = [];
  let done = false;
  let loading = false;
  let useSecondary = false;

  const draw = () => {
    const feed = $('feed');
    if (!feed) return;
    if (!items.length) {
      feed.innerHTML = `<div class="empty">直播列表暂时不可用<br><br>
        <button class="glass-btn" id="live-web" style="max-width:180px;margin:0 auto">打开网页版直播</button></div>`;
      const b = $('live-web');
      if (b) b.addEventListener('click', () => navigate('web', { url: 'https://live.bilibili.com/', title: '直播' }));
      return;
    }
    feed.innerHTML = `<div class="grid">${items.map((r) => cardHTML({
      title: r.title,
      pic: r.cover || r.keyframe || r.user_cover,
      up: r.uname,
      online: fmtNum(r.online),
      live: true,
      badge: r.area_name || r.area_v2_name || r.area_name_v2,
    })).join('')}</div>`;
    feed.querySelectorAll('.card').forEach((el, i) => {
      el.addEventListener('click', () => {
        const room = items[i] && (items[i].roomid || items[i].room_id);
        if (room) navigate('liveRoom', { roomId: room, title: items[i].title });
      });
    });
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    let list = [];
    // 主：推荐接口（稳定）；备：分区列表（可能被风控 -352）
    if (!useSecondary) {
      const d = await api(`/room/v1/room/get_user_recommend?page=${page}&page_size=20`).catch(() => null);
      list = (d && d.data) || [];
      if (!list.length) useSecondary = true;
      else {
        page += 1;
        done = list.length < 10;
      }
    }
    if (useSecondary && !items.length) {
      const d2 = await api(`/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=0&area_id=0&sort_type=online&page=1`).catch(() => null);
      list = (d2 && d2.data && d2.data.list) || [];
      done = true;
    }
    items = items.concat(list);
    draw();
    loading = false;
  };

  await load();
  setInfinite(load);
}

/* ------------------------------ 关注的直播（完整列表） ------------------------------ */

async function renderLiveFollowing() {
  if (!state.login) return renderLoginGate('关注的直播');
  view.innerHTML = `
    <div class="view-head">
      <div class="view-title">关注的直播</div>
      <div class="view-sub" id="lf-sub">正在加载…</div>
      <div class="spacer"></div>
      <button class="ghost-btn" id="lf-back">返回动态</button>
    </div>
    <div id="feed">${skeletons(8)}</div>`;
  $('lf-back')?.addEventListener('click', () => navigate('dynamic'));

  const PAGE_SIZE = 20;
  let page = 1;
  let items = [];
  let done = false;
  let loading = false;
  let total = 0;

  const draw = () => {
    const feed = $('feed');
    if (!feed) return;
    const sub = $('lf-sub');
    if (!items.length) {
      feed.innerHTML = `<div class="empty">关注的主播都没在播<br><br>
        <button class="glass-btn" id="lf-web" style="max-width:200px;margin:0 auto">去直播广场看看</button></div>`;
      $('lf-web')?.addEventListener('click', () => navigate('live'));
      if (sub) sub.textContent = '暂无正在直播的关注';
      return;
    }
    feed.innerHTML = `<div class="grid">${items.map((r) => cardHTML({
      title: r.title,
      pic: r.cover || r.keyframe || r.user_cover || r.face,
      up: r.uname,
      online: fmtNum(r.online),
      live: true,
      badge: r.area_v2_name || r.area_name || '直播',
    })).join('')}</div>`;
    feed.querySelectorAll('.card').forEach((el, i) => {
      el.addEventListener('click', () => {
        const room = items[i] && (items[i].room_id || items[i].roomid);
        if (room) navigate('liveRoom', { roomId: room, title: items[i].title });
      });
    });
    if (sub) {
      sub.textContent = total
        ? `共 ${total} 位关注正在直播`
        : `已加载 ${items.length} 位`;
    }
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const r = await api(`/xlive/web-ucenter/v1/xfetter/GetWebList?page=${page}&page_size=${PAGE_SIZE}&hit_ab=false`).catch(() => null);
    const d = (r && r.data) || {};
    const list = (d.rooms || d.list || []).filter((x) => Number(x.live_status) === 1);
    if (Number(d.total || d.count || 0)) total = Number(d.total || d.count);
    if (!list.length) {
      done = true;
    } else {
      // 接口若不支持翻页会重复返回同一页，这里按房间号去重避免死循环
      const seen = new Set(items.map((x) => String(x.room_id || x.roomid)));
      const fresh = list.filter((x) => {
        const id = String(x.room_id || x.roomid);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      items = items.concat(fresh);
      page += 1;
      if (!fresh.length || list.length < PAGE_SIZE) done = true;
      if (total && items.length >= total) done = true;
      if (items.length > 500) done = true;
    }
    draw();
    loading = false;
  };

  await load();
  setInfinite(load);
}

/* ------------------------------ 直播播放 ------------------------------ */

async function renderLiveRoom(roomId, title) {
  if (!roomId) { navigate('live'); return; }
  view.innerHTML = `
    <div class="live-room">
      <div class="live-main">
        <div class="live-head">
          <div class="live-title">${esc(title || '直播')}</div>
          <div class="live-sub">房间 ${esc(String(roomId))}</div>
          <div class="spacer"></div>
          <button class="ghost-btn" id="live-web-btn">网页打开</button>
        </div>
        <div class="live-stage">
          <div class="player-frame live-frame"><div class="player-slot" id="live-slot"></div></div>
        </div>
        <div class="ctl live-ctl">
          <button class="ctl-btn" id="live-mute" title="静音">
            <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12L7.5 14.5H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </button>
          <input type="range" class="ctl-vol" id="live-vol" min="0" max="100" value="100" title="音量" />
          <span class="ctl-time" id="live-qn-label">原画</span>
          <button class="ctl-btn" id="live-quality" title="画质">画质</button>
          <span class="spacer"></span>
          <button class="ctl-btn" id="live-fs" title="全屏">全屏</button>
        </div>
        <div id="live-status" class="live-status">正在连接直播流…</div>
      </div>

      <aside class="live-side">
        <div class="ls-head">
          <span class="ls-tab on">弹幕</span>
          <span class="ls-online" id="ls-online"></span>
        </div>
        <div class="ls-list" id="live-dm-list"></div>
        <div class="ls-tools">
          <button class="ls-btn" id="ls-emoji" title="表情">☺</button>
          <button class="ls-btn" id="ls-filter" title="弹幕屏蔽">屏蔽</button>
          <button class="ls-btn ls-like" id="ls-like" title="点赞">
            <svg viewBox="0 0 24 24"><path d="M7 21V9.6l5-6.1 1.2.9c.5.4.7 1 .5 1.6L12.6 9H19a2 2 0 0 1 2 2.3l-1.1 7A2 2 0 0 1 17.9 20H9z" fill="currentColor"/><path d="M3.5 9.5h2.8V21H3.5z" fill="currentColor" opacity=".55"/></svg>
            <span id="ls-like-n">0</span>
          </button>
        </div>
        <div class="ls-input">
          <input id="live-dm-input" maxlength="20" placeholder="发个弹幕吧~" spellcheck="false" />
          <button class="ls-send" id="live-dm-send">发送</button>
        </div>
        <div class="ls-pop" id="ls-emoji-pop" hidden></div>
        <div class="ls-pop ls-pop-filter" id="ls-filter-pop" hidden></div>
      </aside>
    </div>`;

  // 播放器按左栏可用空间等比缩放（16:9）
  const fitLive = () => {
    const stage = document.querySelector('.live-stage');
    const frame = document.querySelector('.live-frame');
    if (!stage || !frame) return;
    const aw = stage.clientWidth;
    const ah = stage.clientHeight;
    if (aw < 60 || ah < 60) return;
    const h = Math.min(ah, (aw * 9) / 16);
    const w = Math.min(aw, (h * 16) / 9);
    frame.style.width = `${Math.round(w)}px`;
    frame.style.height = `${Math.round(h)}px`;
  };
  fitLive();
  state.auxObserver?.disconnect();
  const liveFitObserver = new ResizeObserver(fitLive);
  const stageEl = document.querySelector('.live-stage');
  if (stageEl) liveFitObserver.observe(stageEl);

  setupWatchBlock({ shrink: false, reserve: 240 });

  const webBtn = $('live-web-btn');
  if (webBtn) webBtn.addEventListener('click', () => navigate('web', {
    url: `https://live.bilibili.com/${roomId}`, title: title || '直播',
  }));

  // ---- 弹幕面板 ----
  const dmList = $('live-dm-list');
  const dmInput = $('live-dm-input');
  const dmSend = $('live-dm-send');

  const liveFilter = Object.assign(
    { words: [], hideEnter: false, hideGift: false, minLevel: 0 },
    store.get('liveFilter', {}) || {},
  );
  const saveFilter = () => store.set('liveFilter', liveFilter);

  const hexColor = (n) => {
    const v = Number(n) || 0;
    if (!v) return '';
    return '#' + v.toString(16).padStart(6, '0');
  };

  const passFilter = (m) => {
    if (!m) return false;
    if (m.type === 'enter' && liveFilter.hideEnter) return false;
    if (m.type === 'gift' && liveFilter.hideGift) return false;
    if (m.type === 'danmaku') {
      if (liveFilter.minLevel > 0 && (Number(m.level) || 0) < liveFilter.minLevel) return false;
      const text = String(m.text || '');
      const user = String(m.user || '');
      if (liveFilter.words.some((w) => w && (text.includes(w) || user.includes(w)))) return false;
    }
    return true;
  };

  const medalHTML = (m) => {
    const md = m.medal || {};
    if (!md.name || !md.level) return '';
    const c = hexColor(md.color) || '#8b93a3';
    return `<span class="ls-medal" style="--mc:${c}">${esc(md.name)}<b>${md.level}</b></span>`;
  };
  const guardHTML = (m) => {
    const g = Number(m.guard) || 0;
    if (!g) return '';
    const label = g === 3 ? '总' : g === 2 ? '提' : '舰';
    return `<span class="ls-guard g${g}">${label}</span>`;
  };

  const pushDm = (m) => {
    if (!dmList || !m || !passFilter(m)) return;
    const row = document.createElement('div');
    row.className = 'ls-row'
      + (m.type === 'enter' ? ' sys' : '')
      + (m.type === 'gift' ? ' gift' : '');
    if (m.type === 'danmaku') {
      const tc = hexColor(m.color);
      row.innerHTML = (m.level ? `<span class="ls-lv">${m.level}</span>` : '')
        + medalHTML(m)
        + guardHTML(m)
        + `<span class="ls-user">${esc(m.user)}</span><span class="ls-text">：${esc(m.text)}</span>`;
      const textEl = row.querySelector('.ls-text');
      if (textEl && tc && tc !== '#ffffff') textEl.style.color = tc;
    } else if (m.type === 'gift') {
      row.innerHTML = `<span class="ls-text">🎁 ${esc(m.user)} 送出 ${esc(m.text)}</span>`;
    } else {
      row.innerHTML = `<span class="ls-text">↪ ${esc(m.user)} 进入了直播间</span>`;
    }
    dmList.appendChild(row);
    while (dmList.children.length > 120) dmList.firstElementChild.remove();
    dmList.scrollTop = dmList.scrollHeight;
  };
  bridge.on('live-danmaku', pushDm);
  const dmStart = await bridge.liveDanmakuStart({ roomId }).catch(() => null);
  if (!dmStart || !dmStart.ok) {
    if (dmList) dmList.innerHTML = '<div class="live-dm-empty">弹幕连接失败</div>';
  }

  const sendDm = async () => {
    const text = (dmInput?.value || '').trim();
    if (!text) return;
    if (dmSend) dmSend.disabled = true;
    const res = await bridge.liveDanmakuSend({ roomId, text }).catch(() => null);
    if (dmSend) dmSend.disabled = false;
    if (res && res.code === 0) {
      if (dmInput) dmInput.value = '';
      pushDm({ type: 'danmaku', user: (state.login && state.login.uname) || '我', text, level: 0, medal: {} });
    } else {
      toast((res && (res.message || (res.code === -101 ? '请先登录' : '发送失败'))) || '发送失败');
    }
  };
  dmSend?.addEventListener('click', sendDm);
  dmInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDm(); });

  // ---- 点赞 ----
  const likeBtn = $('ls-like');
  const likeNum = $('ls-like-n');
  const likeKey = `liveLikes:${roomId}`;
  let likeCount = Number(store.get(likeKey, 0)) || 0;
  const paintLike = () => { if (likeNum) likeNum.textContent = likeCount ? String(likeCount) : '0'; };
  paintLike();
  likeBtn?.addEventListener('click', () => {
    likeCount += 1;
    store.set(likeKey, likeCount);
    paintLike();
    const heart = document.createElement('i');
    heart.className = 'ls-heart';
    heart.textContent = '👍';
    likeBtn.appendChild(heart);
    setTimeout(() => heart.remove(), 900);
  });

  // ---- 表情 ----
  const EMOJIS = ['😀', '😂', '🤣', '😊', '😍', '🤔', '😭', '😡', '👍', '👏', '🎉', '❤️',
    '🔥', '🌸', '🐶', '🐱', '🍜', '☕', '🌙', '⭐', '💤', '🙏', '🤝', '😅'];
  const emojiPop = $('ls-emoji-pop');
  if (emojiPop) {
    emojiPop.innerHTML = `<div class="ls-pop-head">表情</div><div class="ls-emoji-grid">`
      + EMOJIS.map((e) => `<button class="ls-emoji" data-e="${e}">${e}</button>`).join('')
      + '</div>';
    emojiPop.querySelectorAll('.ls-emoji').forEach((b) => {
      b.addEventListener('click', () => {
        if (!dmInput) return;
        dmInput.value = (dmInput.value + b.dataset.e).slice(0, 20);
        dmInput.focus();
      });
    });
  }

  // ---- 弹幕屏蔽 ----
  const filterPop = $('ls-filter-pop');
  const paintFilterPop = () => {
    if (!filterPop) return;
    filterPop.innerHTML = `
      <div class="ls-pop-head">弹幕屏蔽</div>
      <label class="ls-pop-row">屏蔽关键词（回车添加）</label>
      <div class="ls-words">${liveFilter.words.map((w) => `<span class="ls-word">${esc(w)}<b data-w="${esc(w)}">×</b></span>`).join('') || '<span class="ls-word-empty">暂无</span>'}</div>
      <input class="ls-word-input" id="ls-word-input" placeholder="输入关键词后回车" spellcheck="false" />
      <label class="ls-pop-row"><input type="checkbox" id="ls-hide-enter"${liveFilter.hideEnter ? ' checked' : ''} /> 屏蔽「进入直播间」</label>
      <label class="ls-pop-row"><input type="checkbox" id="ls-hide-gift"${liveFilter.hideGift ? ' checked' : ''} /> 屏蔽礼物消息</label>
      <label class="ls-pop-row">最低用户等级
        <input type="number" class="ls-level-input" id="ls-min-level" min="0" max="60" value="${liveFilter.minLevel || 0}" />
      </label>`;
    filterPop.querySelectorAll('.ls-word b').forEach((b) => {
      b.addEventListener('click', () => {
        liveFilter.words = liveFilter.words.filter((w) => w !== b.dataset.w);
        saveFilter();
        paintFilterPop();
      });
    });
    $('ls-word-input')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = String(e.target.value || '').trim();
      if (!v) return;
      if (!liveFilter.words.includes(v)) liveFilter.words.push(v);
      e.target.value = '';
      saveFilter();
      paintFilterPop();
      $('ls-word-input')?.focus();
    });
    $('ls-hide-enter')?.addEventListener('change', (e) => { liveFilter.hideEnter = e.target.checked; saveFilter(); });
    $('ls-hide-gift')?.addEventListener('change', (e) => { liveFilter.hideGift = e.target.checked; saveFilter(); });
    $('ls-min-level')?.addEventListener('change', (e) => {
      liveFilter.minLevel = Math.max(0, Math.min(60, Number(e.target.value) || 0));
      saveFilter();
    });
  };
  paintFilterPop();

  const closePops = () => {
    if (emojiPop) emojiPop.hidden = true;
    if (filterPop) filterPop.hidden = true;
  };
  const togglePop = (pop) => {
    if (!pop) return;
    const willOpen = pop.hidden;
    closePops();
    pop.hidden = !willOpen;
  };
  $('ls-emoji')?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePop(emojiPop);
  });
  $('ls-filter')?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePop(filterPop);
  });
  if (state.livePopCloser) document.removeEventListener('click', state.livePopCloser);
  state.livePopCloser = (e) => {
    if (e.target.closest('.ls-pop, #ls-emoji, #ls-filter')) return;
    closePops();
  };
  document.addEventListener('click', state.livePopCloser);

  const info = await bridge.liveInfo({ roomId }).catch(() => null);
  const slot = $('live-slot');
  const statusEl = $('live-status');
  if (!slot) return;
  if (!info || !info.ok) {
    if (statusEl) statusEl.textContent = (info && info.message) || '直播流获取失败，可尝试在网页中打开';
    return;
  }
  const url = info.url || info.m3u8 || info.flv;
  state.liveUrl = url;
  const rect = slot.getBoundingClientRect();
  if (rect.width > 40) {
    bridge.liveShow({ url, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
  }
  if (statusEl) statusEl.textContent = info.live ? '' : '主播暂未开播';

  state.auxObserver?.disconnect();
  state.auxObserver = new ResizeObserver(() => {
    if (state.liveFs) return;
    const r = slot.getBoundingClientRect();
    if (r.width > 40) {
      bridge.liveShow({ url, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    }
  });
  state.auxObserver.observe(slot);

  // ---- 音量 / 画质 / 全屏 ----
  let liveVol = 1;
  let liveMuted = false;
  const volEl = $('live-vol');
  const muteBtn = $('live-mute');
  const applyVol = () => bridge.liveVolume({ volume: liveVol, muted: liveMuted });
  const syncMute = () => {
    if (muteBtn) muteBtn.style.opacity = liveMuted || liveVol === 0 ? '.45' : '1';
  };
  volEl?.addEventListener('input', () => {
    liveVol = Number(volEl.value) / 100;
    liveMuted = liveVol === 0;
    applyVol();
    syncMute();
  });
  muteBtn?.addEventListener('click', () => {
    liveMuted = !liveMuted;
    applyVol();
    syncMute();
  });
  syncMute();
  applyVol();

  const qnLabel = $('live-qn-label');
  const quals = await bridge.liveQualities({ roomId }).catch(() => null);
  if (quals && quals.ok && quals.list.length && qnLabel) {
    const cur = quals.list.find((x) => x.qn === quals.current) || quals.list[0];
    qnLabel.textContent = cur.label;
  }
  $('live-quality')?.addEventListener('click', async () => {
    const q = await bridge.liveQualities({ roomId }).catch(() => null);
    if (!q || !q.ok || !q.list.length) return toast('暂无可用画质');
    const picked = await bridge.popupMenu({
      title: '直播画质',
      items: q.list.map((x) => ({ label: x.label, value: x.qn, checked: x.qn === q.current })),
    }).catch(() => null);
    if (picked == null) return;
    const res = await bridge.liveSetQuality({ roomId, qn: Number(picked) }).catch(() => null);
    if (res && res.ok) {
      const item = q.list.find((x) => x.qn === Number(picked));
      if (qnLabel && item) qnLabel.textContent = item.label;
      toast('画质已切换');
    } else {
      toast((res && res.message) || '切换失败');
    }
  });
  $('live-fs')?.addEventListener('click', async () => {
    const res = await bridge.liveFullscreen({ on: !state.liveFs }).catch(() => null);
    if (res && res.ok) state.liveFs = res.on;
  });
}

/* ------------------------------ 番剧详情 ------------------------------ */

async function renderSeason(seasonId) {
  if (!seasonId) { navigate('home'); return; }
  view.innerHTML = `
    <div class="watch season-watch">
      <div class="watch-top">
        <div class="player-wrap">
          <div class="player-frame season-player"><div class="player-slot" id="season-player"></div></div>
        </div>
      </div>
      <div class="watch-scroll">
        <div id="season-body">${skeletons(2)}</div>
      </div>
    </div>`;
  const res = await api(`/pgc/view/web/season?season_id=${seasonId}`).catch(() => null);
  const s = res && res.result;
  const body = $('season-body');
  if (!body) return;
  if (!s) {
    body.innerHTML = `<div class="empty">番剧信息加载失败<br><br>
      <button class="glass-btn" id="season-web" style="max-width:180px;margin:0 auto">在网页中打开</button></div>`;
    const b = $('season-web');
    if (b) b.addEventListener('click', () => navigate('web', {
      url: `https://www.bilibili.com/bangumi/play/ss${seasonId}`, title: '番剧',
    }));
    return;
  }
  const eps = Array.isArray(s.episodes) ? s.episodes : [];
  body.innerHTML = `
    <div class="season-head">
      <img class="season-cover" loading="lazy" src="${esc(httpsUrl(s.cover))}" alt="" />
      <div class="season-info">
        <div class="season-title">${esc(s.title || '')}</div>
        <div class="season-meta">
          ${s.rating && s.rating.score ? `<span class="score-tag">★ ${esc(String(s.rating.score))}</span>` : ''}
          ${s.stat && s.stat.views ? `<span>${fmtNum(s.stat.views)} 播放</span>` : ''}
          ${eps.length ? `<span>${eps.length} 集</span>` : ''}
        </div>
        ${s.evaluate ? `<div class="season-desc">${esc(s.evaluate)}</div>` : ''}
      </div>
      <button class="ghost-btn" id="season-web-btn">在网页中打开</button>
    </div>
    <div class="section-title">选集 <span class="count">${eps.length}</span></div>
    <div class="ep-grid" id="ep-grid">
      ${eps.map((ep, i) => `<button class="ep${i === 0 ? ' on' : ''}" data-idx="${i}"
        data-ep="${ep.id || ''}" data-bvid="${esc(ep.bvid || '')}" data-cid="${ep.cid || ''}"
        title="${esc(ep.title || '')}">${esc(ep.title || ('第 ' + (i + 1) + ' 话'))}</button>`).join('')}
      </div>
    </div>`;

  const webBtn = $('season-web-btn');
  if (webBtn) webBtn.addEventListener('click', () => navigate('web', {
    url: `https://www.bilibili.com/bangumi/play/ss${seasonId}`, title: s.title || '番剧',
  }));

  const playEp = (ep) => {
    if (!ep) return;
    const slot = $('season-player');
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    if (r.width < 40) return;
    bridge.playerShow({
      bvid: ep.bvid || undefined,
      episodeId: ep.id || undefined,
      cid: ep.cid || undefined,
      page: 1,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    });
  };

  const grid = $('ep-grid');
  if (grid) {
    grid.querySelectorAll('.ep').forEach((btn) => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.ep').forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        playEp({
          id: btn.dataset.ep,
          bvid: btn.dataset.bvid,
          cid: btn.dataset.cid,
        });
      });
    });
  }

  setupWatchBlock({ shrink: false, reserve: 220 });

  if (eps.length) {
    bindControls();
    startPlayerPolling();
    requestAnimationFrame(() => playEp(eps[0]));
    state.auxObserver?.disconnect();
    const slot = $('season-player');
    if (slot) {
      state.auxObserver = new ResizeObserver(() => {
        const r = slot.getBoundingClientRect();
        bridge.playerResize({ x: r.left, y: r.top, width: r.width, height: r.height });
      });
      state.auxObserver.observe(slot);
    }
  }
}

/* ------------------------------ 动态 ------------------------------ */

// 必须带 features，否则 B 站会省略图文动态的正文（major.opus）
const DYN_FEATURES = 'itemOpusStyle,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,ugcDelete,onlyfansQaCard';
const dynFeatures = `&features=${encodeURIComponent(DYN_FEATURES)}`;

function dynMedia(major, ctx = {}) {
  if (!major) return '';
  if (major.archive) {
    const a = major.archive;
    return `<div class="dyn-archive" data-bvid="${esc(a.bvid || '')}">
      <img loading="lazy" src="${esc(httpsUrl(a.cover))}" alt="" />
      <div class="dyn-archive-info">
        <div class="dyn-archive-title">${esc(a.title || '')}</div>
        <div class="dyn-archive-meta">▶ ${fmtNum(a.stat && a.stat.play)} · ${esc(a.duration_text || '')}</div>
      </div>
    </div>`;
  }
  if (major.draw && Array.isArray(major.draw.items) && major.draw.items.length) {
    const pics = major.draw.items.map((im) => httpsUrl(im.src || im.url)).filter(Boolean);
    return `<div class="dyn-imgs${pics.length === 1 ? ' single' : ''}">${pics.slice(0, 9).map((src, i) =>
      `<img loading="lazy" class="dyn-img" data-src="${esc(src)}" data-idx="${i}" src="${esc(src)}" alt="" />`).join('')}</div>`;
  }
  if (major.opus && Array.isArray(major.opus.pics) && major.opus.pics.length) {
    // opus 结构里图片字段是 url（旧结构是 src）
    const pics = major.opus.pics.map((im) => httpsUrl(im.url || im.src)).filter(Boolean);
    return `<div class="dyn-imgs">${pics.slice(0, 9).map((src, i) =>
      `<img loading="lazy" class="dyn-img" data-src="${esc(src)}" data-idx="${i}" src="${esc(src)}" alt="" />`).join('')}</div>`;
  }
  if (major.pgc) {
    const g = major.pgc;
    return `<div class="dyn-archive dyn-pgc" data-url="${esc(g.jump_url || g.url || '')}">
      <img loading="lazy" src="${esc(httpsUrl(g.cover))}" alt="" />
      <div class="dyn-archive-info">
        <div class="dyn-archive-title">${esc(g.title || '')}</div>
        <div class="dyn-archive-meta">${g.rating && g.rating.score ? '★ ' + esc(String(g.rating.score)) : ''} ${esc(g.sub_type || '番剧')}</div>
      </div>
    </div>`;
  }
  if (major.article) {
    const a = major.article;
    const cover = a.covers && a.covers[0] ? httpsUrl(a.covers[0]) : '';
    return `<div class="dyn-article" data-cv="${esc(String(a.id || ''))}">
      ${cover ? `<img loading="lazy" src="${esc(cover)}" alt="" />` : ''}
      <div class="dyn-article-body">
        <div class="dyn-archive-title">${esc(a.title || '')}</div>
        <div class="dyn-archive-meta">${esc((a.desc || '').slice(0, 80))}</div>
      </div>
    </div>`;
  }
  if (major.live_rcmd) {
    let info = {};
    try { info = JSON.parse(major.live_rcmd.content || '{}').live_play_info || {}; } catch {}
    const cover = info.cover || info.keyframe || '';
    return `<div class="dyn-live" data-room="${esc(String(info.room_id || ''))}" data-title="${esc(info.title || '')}">
      <div class="dyn-live-cover"><img loading="lazy" src="${esc(httpsUrl(cover))}" alt="" />
        <span class="live-badge">${info.live_status === 1 ? '直播中' : '未开播'}</span></div>
      <div class="dyn-live-info">
        <div class="dyn-archive-title">${esc(info.title || '')}</div>
        <div class="dyn-archive-meta">${esc(info.area_name || '')} · ${fmtNum(info.online)} 人气</div>
      </div>
    </div>`;
  }
  if (major.music) {
    const m = major.music;
    return `<div class="dyn-archive">
      <img loading="lazy" src="${esc(httpsUrl(m.cover))}" alt="" />
      <div class="dyn-archive-info">
        <div class="dyn-archive-title">${esc(m.title || '')}</div>
        <div class="dyn-archive-meta">${esc(m.label || '音乐')}</div>
      </div>
    </div>`;
  }
  if (major.common) {
    const c = major.common;
    return `<div class="dyn-common">
      <div class="dyn-common-head">
        ${c.cover ? `<img loading="lazy" src="${esc(httpsUrl(c.cover))}" alt="" />` : ''}
        <div class="dyn-common-title">${esc(c.title || '')}</div>
      </div>
      ${c.desc ? `<div class="dyn-common-desc">${esc(c.desc)}</div>` : ''}
    </div>`;
  }
  if (major.ugc_season) {
    const s = major.ugc_season;
    return `<div class="dyn-archive">
      <img loading="lazy" src="${esc(httpsUrl(s.cover))}" alt="" />
      <div class="dyn-archive-info">
        <div class="dyn-archive-title">${esc(s.title || '')}</div>
        <div class="dyn-archive-meta">合集</div>
      </div>
    </div>`;
  }
  if (major.medialist) {
    const m = major.medialist;
    return `<div class="dyn-common"><div class="dyn-common-title">${esc(m.title || '收藏夹')}</div></div>`;
  }
  if (major.upower_common) {
    const u = major.upower_common;
    return `<div class="dyn-locked">
      <div class="dyn-locked-title">${esc(u.title || '充电专属动态')}</div>
      <div class="dyn-locked-sub">${esc(u.desc || '为 UP 主充电后即可查看')}</div>
    </div>`;
  }
  return '';
}

function dynRichNodesHTML(nodes) {
  return (nodes || []).map((n) => {
    if (!n) return '';
    if (n.type === 'RICH_TEXT_NODE_TYPE_EMOJI' && n.emoji) {
      const url = httpsUrl(n.emoji.icon_url || n.emoji.url || '');
      if (url) return `<img class="dyn-emoji" loading="lazy" src="${esc(url)}" alt="${esc(n.emoji.text || '')}" />`;
      return esc(n.emoji.text || n.text || '');
    }
    if (n.type === 'RICH_TEXT_NODE_TYPE_AT') return `<span class="dyn-at">@${esc(n.text || '')}</span>`;
    return esc(n.text || '');
  }).join('');
}

function dynTextHTML(dyn) {
  if (!dyn) return '';
  const d = dyn.desc || {};
  const opus = (dyn.major && dyn.major.opus && dyn.major.opus.summary) || {};
  // 优先用富文本节点：表情会渲染成图片，而不是 [表情名] 文字
  if (Array.isArray(d.rich_text_nodes) && d.rich_text_nodes.length) return dynRichNodesHTML(d.rich_text_nodes);
  if (d.text) return esc(d.text);
  if (Array.isArray(opus.rich_text_nodes) && opus.rich_text_nodes.length) return dynRichNodesHTML(opus.rich_text_nodes);
  if (opus.text) return esc(opus.text);
  if (dyn.major && dyn.major.article && dyn.major.article.title) return esc(dyn.major.article.title);
  return '';
}

function dynCard(it) {
  const m = it.modules || {};
  const author = m.module_author || {};
  const dyn = m.module_dynamic || {};
  const descHTML = dynTextHTML(dyn);
  const desc = stripTags(descHTML).trim();
  const major = dyn.major || {};
  const stat = m.module_stat || {};
  const media = dynMedia(major);

  let forward = '';
  if (it.orig) {
    const om = it.orig.modules || {};
    const oa = om.module_author || {};
    const od = om.module_dynamic || {};
    const otextHTML = dynTextHTML(od);
    const otext = stripTags(otextHTML).trim();
    const omedia = dynMedia(od.major || {});
    const oempty = !otext && !omedia;
    forward = `<div class="dyn-forward">
      <div class="dyn-forward-head">@${esc(oa.name || '')}</div>
      ${otextHTML ? `<div class="dyn-forward-text">${otextHTML}</div>` : ''}
      ${omedia}
      ${oempty ? '<div class="dyn-forward-empty">原动态不可见（可能已删除或仅粉丝可见）</div>' : ''}
    </div>`;
  }

  const fallback = (!desc && !media && !forward)
    ? `<div class="dyn-blocked">
        <span class="dyn-blocked-ico">
          <svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </span>
        <span class="dyn-blocked-body">
          <span class="dyn-blocked-title">此动态暂时看不到内容</span>
          <span class="dyn-blocked-sub">可能仅粉丝可见、充电专属，或已被删除</span>
        </span>
        <button class="dyn-open-web" data-dyn="${esc(it.id_str || '')}">去网页查看</button>
      </div>`
    : '';

  const liked = !!(stat.like && stat.like.status);
  const likeCount = (stat.like && stat.like.count) || 0;
  const commentCount = (stat.comment && stat.comment.count) || 0;

  return `<article class="dyn-card" data-dyn="${esc(it.id_str || '')}"
      data-ctype="${esc(String(it.basic?.comment_type || ''))}"
      data-cid="${esc(String(it.basic?.comment_id_str || ''))}">
    <div class="dyn-head" data-mid="${esc(String(author.mid || ''))}" data-name="${esc(author.name || '')}" title="只看 ${esc(author.name || '')} 的动态">
      <img class="dyn-avatar" loading="lazy" src="${esc(httpsUrl(author.face))}" alt="" />
      <div class="dyn-who">
        <div class="dyn-name">${esc(author.name || '')}</div>
        <div class="dyn-time">${esc(author.pub_time || '')}</div>
      </div>
      <span class="dyn-only">只看 TA</span>
    </div>
    ${descHTML ? `<div class="dyn-text">${descHTML}</div>` : ''}
    ${media}
    ${forward}
    ${fallback}
    ${fallback ? '' : `<div class="dyn-stats">
      <button class="dyn-act like${liked ? ' on' : ''}" data-act="like">
        <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6C19 15.4 12 20 12 20z" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        <span class="dyn-like-count">${fmtNum(likeCount)}</span>
      </button>
      <button class="dyn-act" data-act="comment">
        <svg viewBox="0 0 24 24"><path d="M4.5 6.5h15v9h-8l-4 3v-3h-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        <span>${fmtNum(commentCount)}</span>
      </button>
      <button class="dyn-act" data-act="forward">
        <svg viewBox="0 0 24 24"><path d="M7 7h9l-2.5-2.5M17 17H8l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${fmtNum(stat.forward && stat.forward.count)}</span>
      </button>
    </div>`}
  </article>`;
}

function openDynComposer({ dynId, quote } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.id = 'dyn-composer';
  wrap.innerHTML = `<div class="sheet sheet-sm">
    <div class="sheet-head"><span>${dynId ? '转发动态' : '发动态'}</span>
      <button class="tb-btn" data-close title="关闭">×</button></div>
    <div class="sheet-body dyn-compose-body">
      ${quote ? `<div class="dyn-quote">${esc(quote).slice(0, 200)}</div>` : ''}
      <textarea class="c-input" id="dyn-new" rows="4" maxlength="2000"
        placeholder="${dynId ? '说说转发理由…' : '有什么想分享的…'}"></textarea>
      <div class="c-previews" id="dyn-previews" hidden></div>
      <div class="dyn-compose-bar">
        <button class="c-tool" data-tool="emoji" title="表情">😊</button>
        <button class="c-tool" data-tool="image" title="图片">🖼</button>
        <span class="c-count" id="dyn-new-count">0/2000</span>
        <button class="glass-btn" id="dyn-publish" disabled>发布</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('#dyn-new');
  const send = wrap.querySelector('#dyn-publish');
  const count = wrap.querySelector('#dyn-new-count');
  const previews = wrap.querySelector('#dyn-previews');
  const images = [];
  const close = () => wrap.remove();

  const renderPreviews = () => {
    previews.hidden = !images.length;
    previews.innerHTML = images.map((im, i) =>
      `<span class="c-preview"><img src="${esc(httpsUrl(im.url))}" alt="" />
        <button class="c-preview-del" data-i="${i}" title="移除">×</button></span>`).join('');
    previews.querySelectorAll('.c-preview-del').forEach((b) => {
      b.addEventListener('click', () => {
        images.splice(Number(b.dataset.i), 1);
        renderPreviews();
        sync();
      });
    });
  };
  const sync = () => {
    count.textContent = `${input.value.length}/2000`;
    send.disabled = (!input.value.trim() && !images.length && !dynId) || send.dataset.busy === '1';
  };
  input.addEventListener('input', sync);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-tool="emoji"]').addEventListener('click', (e) => {
    e.preventDefault();
    openEmojiPicker(e.currentTarget, input, 'dynamic');
  });
  wrap.querySelector('[data-tool="image"]').addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const res = await bridge.uploadImages({ biz: 'dynamic' }).catch(() => null);
    btn.dataset.busy = '0';
    if (!res || !res.ok) {
      if (res && !res.canceled) toast(res.message || '图片上传失败');
      return;
    }
    images.push(...res.images);
    if (images.length > 9) images.length = 9;
    renderPreviews();
    sync();
  });
  input.focus();
  sync();
  send.addEventListener('click', async () => {
    if (send.dataset.busy === '1') return;
    send.dataset.busy = '1';
    send.textContent = '发布中…';
    const res = await bridge.createDynamic({ content: input.value.trim(), dynId, pics: images }).catch(() => null);
    if (res && res.code === 0) {
      toast(dynId ? '已转发' : '动态已发布');
      close();
      if (state.route.name === 'dynamic') refreshCurrent();
    } else {
      send.dataset.busy = '0';
      send.textContent = '发布';
      toast((res && (res.message || (res.code === -101 ? '请先登录' : '发布失败'))) || '发布失败');
    }
  });
}

function bindDynCards(root) {
  root.querySelectorAll('.dyn-archive[data-bvid]').forEach((el) => {
    el.addEventListener('click', () => {
      const bvid = el.dataset.bvid;
      if (bvid) navigate('video', { bvid });
    });
  });
  root.querySelectorAll('.dyn-article[data-cv]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const cv = el.dataset.cv;
      if (cv) navigate('article', { cv });
    });
  });
  root.querySelectorAll('.dyn-pgc').forEach((el) => {
    el.addEventListener('click', () => {
      const m = String(el.dataset.url || '').match(/ss(\d+)/);
      if (m) navigate('season', { seasonId: m[1] });
      else if (el.dataset.url) navigate('web', { url: httpsUrl(el.dataset.url), title: '番剧' });
    });
  });
  root.querySelectorAll('.dyn-live').forEach((el) => {
    el.addEventListener('click', () => {
      const room = el.dataset.room;
      if (room) navigate('liveRoom', { roomId: room, title: el.dataset.title || '直播' });
    });
  });
  root.querySelectorAll('.dyn-imgs').forEach((box) => {
    const imgs = [...box.querySelectorAll('.dyn-img')];
    imgs.forEach((img, i) => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(imgs.map((x) => x.dataset.src), i);
      });
    });
  });
  root.querySelectorAll('.dyn-head').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const mid = el.dataset.mid;
      if (mid) navigate('dynamic', { mid, name: el.dataset.name || '' });
    });
  });
  root.querySelectorAll('.dyn-open-web').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.dyn;
      if (id) navigate('web', { url: `https://t.bilibili.com/${id}`, title: '动态' });
    });
  });
  root.querySelectorAll('.dyn-card').forEach((card) => {
    const dynId = card.dataset.dyn;
    const likeBtn = card.querySelector('[data-act="like"]');
    if (likeBtn) {
      likeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const on = !likeBtn.classList.contains('on');
        const res = await bridge.actionPage('/x/dynamic/feed/dyn/thumb', {
          dyn_id_str: dynId, up: on ? 1 : 2, spmid: '333.1369.0.0', from_spmid: '333.999.0.0',
        }, { json: true }).catch(() => null);
        if (res && res.code === 0) {
          likeBtn.classList.toggle('on', on);
          const c = likeBtn.querySelector('.dyn-like-count');
          if (c) {
            const n = Number(String(c.textContent).replace(/[^\d.]/g, '')) || 0;
            c.textContent = on ? fmtNum(n + 1) : fmtNum(Math.max(0, n - 1));
          }
          likeBtn.querySelector('svg path')?.setAttribute('fill', on ? 'currentColor' : 'none');
        } else {
          toast((res && res.message) || '点赞失败');
        }
      });
    }
    card.querySelectorAll('[data-act="forward"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = card.querySelector('.dyn-text')?.textContent || '';
        openDynComposer({ dynId, quote: text });
      });
    });
    card.querySelectorAll('[data-act="comment"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate('dynDetail', {
          dynId,
          ctype: card.dataset.ctype,
          cid: card.dataset.cid,
          name: (card.querySelector('.dyn-name') || {}).textContent || '',
        });
      });
    });
  });
}

function normalizeOpusItem(item) {
  if (!item) return null;
  if (item.modules && item.modules.module_author) return item;
  const out = { ...item, modules: {} };
  const arr = Array.isArray(item.modules) ? item.modules : Object.values(item.modules || {});
  for (const m of arr) {
    if (!m) continue;
    if (m.module_author) out.modules.module_author = m.module_author;
    if (m.module_dynamic) out.modules.module_dynamic = m.module_dynamic;
    if (m.module_stat) out.modules.module_stat = m.module_stat;
  }
  return out;
}

/* 动态详情（含评论） */
async function renderDynDetail(params) {
  const { dynId, ctype, cid, name } = params;
  if (!dynId) { navigate('dynamic'); return; }
  view.innerHTML = `<div class="view-head"><div class="view-title">动态</div>
    <div class="view-sub">${esc(name || '')}</div><div class="spacer"></div>
    <button class="ghost-btn" id="dyn-back">返回</button></div>
    <div id="dyn-detail">${skeletons(3)}</div>`;

  const backBtn = $('dyn-back');
  if (backBtn) backBtn.addEventListener('click', () => goBack());

  let item = state.dynCache.get(String(dynId)) || null;
  if (!item) {
    const detail = await api(`/x/polymer/web-dynamic/v1/opus/detail?id=${dynId}${dynFeatures}`).catch(() => null);
    item = normalizeOpusItem(detail && detail.data && detail.data.item);
  }
  const body = $('dyn-detail');
  if (!body) return;

  let cardHTML = '';
  if (item) {
    cardHTML = dynCard(item);
  } else {
    cardHTML = `<div class="dyn-card"><div class="dyn-text">动态内容加载失败</div></div>`;
  }

  const detailOwn = !!(state.login && item && item.modules && item.modules.module_author
    && Number(item.modules.module_author.mid) === Number(state.login.mid));
  body.innerHTML = `${detailOwn ? '<div class="dyn-detail-bar"><button class="ghost-btn" id="dyn-del">删除这条动态</button></div>' : ''}
    <div class="dyn-detail-wrap">${cardHTML}</div>
    <div class="section-title">评论</div>
    <div id="dyn-comments">
      <div class="c-section">
        ${composerHTML()}
        <div class="c-list" id="dyn-c-list">${skeletons(3)}</div>
      </div>
    </div>`;

  bindDynCards(body);
  $('dyn-del')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = '再点一次确认删除';
      setTimeout(() => { btn.dataset.armed = '0'; btn.textContent = '删除这条动态'; }, 3000);
      return;
    }
    const res = await bridge.removeDynamic({ dynId }).catch(() => null);
    if (res && res.code === 0) { toast('动态已删除'); navigate('dynamic'); }
    else toast((res && res.message) || '删除失败');
  });

  let pn = 0;
  let done = false;
  let loading = false;
  let cType = ctype;
  let cOid = cid;
  let probed = false;
  const commentsEl = $('dyn-c-list');
  const commentsWrap = $('dyn-comments');
  bindComposer(commentsWrap, {
    getTarget: () => ({ oid: cOid, type: cType }),
    onPosted: (data) => {
      if (data && data.reply) insertPostedComment(commentsEl, data.reply, { oid: cOid, type: cType });
      else { pn = 0; done = false; load(); }
    },
  });

  const drawComments = (list, total, ok) => {
    if (!commentsEl) return;
    if (!list.length && pn === 1) {
      commentsEl.innerHTML = `<div class="empty" style="padding:24px">${ok ? '还没有评论，来抢沙发吧' : '该动态暂不支持评论'}</div>`;
      return;
    }
    const html = list.map((c) => `
      <div class="comment">
        <img class="c-avatar" loading="lazy" src="${esc(httpsUrl(c.member?.avatar))}" alt="" />
        <div class="c-body">
          <div class="c-head">
            <span class="c-name">${esc(c.member?.uname || '')}</span>
            <span class="c-time">${fmtDate(c.ctime)}</span>
            <span class="c-like">♡ ${fmtNum(c.like)}</span>
          </div>
          <div class="c-text">${commentTextHTML(c.content)}</div>
          ${commentPicsHTML(c.content)}
          ${commentActionsHTML(c, state.login && Number(c.mid) === Number(state.login.mid))}
          ${c.rcount ? `<button class="c-sub" data-root="${c.rpid}" data-rcount="${c.rcount}">展开 ${c.rcount} 条回复</button>` : ''}
          <div class="c-replies" data-replies="${c.rpid}"></div>
        </div>
      </div>`).join('');
    commentsEl.innerHTML = `<div class="comments">${html}</div>
      <div class="load-more-wrap"><button class="glass-btn" id="dyn-more">加载更多评论</button></div>`;
    bindReplies(commentsEl, ctype, cid);
    bindCommentActions(commentsEl, {
      getTarget: () => ({ oid: cOid, type: cType }),
      onDeleted: () => {},
    });
    bindCommentPics(commentsEl);
    const more = $('dyn-more');
    if (more) {
      more.addEventListener('click', () => { more.textContent = '加载中…'; load(); });
    }
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const page = pn + 1;
    let r = await api(`/x/v2/reply?type=${cType}&oid=${cOid}&pn=${page}&ps=20&sort=2`).catch(() => null);
    // 评论类型回退（动态/转发/图文）
    if ((!r || r.code !== 0) && !probed) {
      probed = true;
      for (const [t, o] of [[17, dynId], [11, dynId], [1, dynId]]) {
        const alt = await api(`/x/v2/reply?type=${t}&oid=${o}&pn=1&ps=20&sort=2`).catch(() => null);
        if (alt && alt.code === 0) {
          r = alt;
          cType = t;
          cOid = o;
          break;
        }
      }
    }
    const list = (r && r.data && r.data.replies) || [];
    pn = page;
    done = list.length === 0;
    if (done && commentsEl && commentsEl.querySelector('#dyn-more')) {
      commentsEl.querySelector('#dyn-more').textContent = '没有更多了';
    }
    drawComments(list, r && r.data && r.data.page && r.data.page.count, !!(r && r.code === 0));
    loading = false;
  };

  if (ctype && cid) await load();
  else if (commentsEl) commentsEl.innerHTML = '<div class="empty" style="padding:24px">该动态不支持评论</div>';
}

/* 评论二级回复展开 */
function bindReplies(root, ctype, cid) {
  root.querySelectorAll('.c-sub[data-root]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const rpid = btn.dataset.root;
      const box = root.querySelector(`[data-replies="${rpid}"]`);
      if (!box) return;
      if (box.dataset.open === '1') {
        box.dataset.open = '0';
        box.innerHTML = '';
        btn.textContent = `展开 ${btn.dataset.rcount} 条回复`;
        return;
      }
      box.dataset.open = '1';
      box.innerHTML = '<div class="c-loading">加载回复…</div>';
      const r = await api(`/x/v2/reply/reply?type=${ctype}&oid=${cid}&root=${rpid}&pn=1&ps=10&sort=2`).catch(() => null);
      const list = (r && r.data && r.data.replies) || [];
      if (!list.length) { box.innerHTML = '<div class="c-loading">没有更多回复</div>'; return; }
      box.innerHTML = list.map((c) => `
        <div class="c-reply">
          <img class="c-avatar sm" loading="lazy" src="${esc(httpsUrl(c.member?.avatar))}" alt="" />
          <div class="c-body">
            <div class="c-head"><span class="c-name">${esc(c.member?.uname || '')}</span>
              <span class="c-time">${fmtDate(c.ctime)}</span></div>
            <div class="c-text">${esc(c.content?.message || '')}</div>
          </div>
        </div>`).join('');
      btn.textContent = '收起回复';
    });
  });
}

async function renderDynamic(mid, name) {
  if (!state.login) return renderLoginGate('动态');
  const filtered = !!mid;
  view.innerHTML = `
    <div class="view-head">
      <div class="view-title">动态</div>
      <div class="view-sub">${filtered ? `只看 @${esc(name || mid)}` : '关注的人'}</div>
      <div class="spacer"></div>
      <button class="glass-btn" id="dyn-post">发动态</button>
      <button class="ghost-btn" id="dyn-pick">选择 UP</button>
      ${filtered ? '<button class="ghost-btn" id="dyn-all">返回全部</button>' : ''}
    </div>
    <div class="dyn-layout">
      <aside class="dyn-rail">
        <div class="rail-card">
          <div class="rail-title">正在直播 <span id="rail-live-count" class="rail-count"></span>
            <button class="rail-more" id="rail-live-all" title="查看全部正在直播的关注">全部 ›</button>
          </div>
          <div id="rail-live" class="rail-live">${skeletons(3)}</div>
        </div>
        <div class="rail-card rail-note">
          <div class="rail-note-title">小提示</div>
          <div class="rail-note-text">点击动态作者可只看 TA；顶部头像可快速切换。</div>
        </div>
      </aside>
      <div class="dyn-main">
        <div class="dyn-updates" id="dyn-updates" hidden></div>
        <div id="feed">${skeletons(6)}</div>
      </div>
    </div>`;

  if (filtered && !name) {
    api(`/x/web-interface/card?mid=${mid}`).then((r) => {
      const n = r && r.data && r.data.card && r.data.card.name;
      const sub = document.querySelector('.view-sub');
      if (n && sub) sub.textContent = `只看 @${n}`;
    }).catch(() => {});
  }

  $('dyn-post')?.addEventListener('click', () => openDynComposer({}));
  const pickBtn = $('dyn-pick');
  if (pickBtn) pickBtn.addEventListener('click', () => openUpPicker());
  const allBtn = $('dyn-all');
  if (allBtn) allBtn.addEventListener('click', () => navigate('dynamic'));
  $('rail-live-all')?.addEventListener('click', () => navigate('liveFollowing'));

  loadLiveRail();

  let page = 1;
  let offset = '';
  let items = [];
  let done = false;
  let loading = false;

  const draw = () => {
    const feed = $('feed');
    if (!feed) return;
    if (!items.length) {
      feed.innerHTML = `<div class="empty">${filtered ? 'TA 最近没有动态' : '关注的人最近没有动态'}</div>`;
      return;
    }
    feed.innerHTML = `<div class="dyn-list">${items.map(dynCard).join('')}</div>`;
    bindDynCards(feed);
    renderUpdates(items);
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const endpoint = filtered
      ? `/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&page=${page}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}${dynFeatures}`
      : `/x/polymer/web-dynamic/v1/feed/all?type=all&page=${page}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}${dynFeatures}`;
    const d = await api(endpoint).catch(() => null);
    const list = (d && d.data && d.data.items) || [];
    offset = (d && d.data && d.data.offset) || '';
    page += 1;
    items = items.concat(list);
    for (const it of list) {
      if (it && it.id_str) state.dynCache.set(it.id_str, it);
    }
    const hasMore = !!(d && d.data && d.data.has_more);
    done = !list.length || (!offset && !hasMore);
    draw();
    loading = false;
  };

  await load();
  setInfinite(load);
}

/* 左侧：关注的主播正在直播 */
async function loadLiveRail() {
  const box = $('rail-live');
  if (!box) return;
  // 接口默认只回 10 条，必须显式给 page_size，否则计数永远是 10
  const r = await api('/xlive/web-ucenter/v1/xfetter/GetWebList?page=1&page_size=50&hit_ab=false').catch(() => null);
  const d = (r && r.data) || {};
  const rooms = (d.rooms || d.list || []).filter((x) => Number(x.live_status) === 1);
  const total = Number(d.total || d.count || 0) || 0;
  const countEl = $('rail-live-count');
  if (countEl) {
    // 接口不给 total 时用列表长度；长度看着像被截断就标「+」，别让人以为只有这么点
    const looksCapped = !total && (rooms.length >= 50 || rooms.length === 10);
    const shown = total || rooms.length;
    countEl.textContent = shown ? (looksCapped ? `${shown}+` : String(shown)) : '';
    countEl.title = shown ? `共 ${shown}${looksCapped ? '+' : ''} 位关注正在直播` : '';
  }
  if (!rooms.length) {
    box.innerHTML = '<div class="rail-empty">关注的主播都没在播</div>';
    return;
  }
  box.innerHTML = rooms.slice(0, 10).map((x) => `
    <button class="rail-live-row" data-room="${x.room_id || x.roomid}" data-title="${esc(x.title || '')}">
      <span class="rail-avatar-wrap">
        <img class="rail-avatar" loading="lazy" src="${esc(httpsUrl(x.face))}" alt="" />
        <i class="rail-dot"></i>
      </span>
      <span class="rail-live-info">
        <span class="rail-live-name">${esc(x.uname || '')}</span>
        <span class="rail-live-title">${esc(x.title || '')}</span>
        <span class="rail-live-meta">${esc(x.area_v2_name || x.area_name || '直播')}${x.online ? ' · ' + fmtNum(x.online) : ''}</span>
      </span>
    </button>`).join('');
  if (rooms.length > 10) {
    box.insertAdjacentHTML('beforeend',
      `<button class="rail-live-row rail-live-more" id="rail-live-more">还有 ${rooms.length - 10} 位正在直播 · 查看全部 ›</button>`);
    $('rail-live-more')?.addEventListener('click', () => navigate('liveFollowing'));
  }
  box.querySelectorAll('.rail-live-row[data-room]').forEach((row) => {
    row.addEventListener('click', () => {
      const room = row.dataset.room;
      if (room) navigate('liveRoom', { roomId: room, title: row.dataset.title || '直播' });
    });
  });
}

/* 顶部：最近更新动态的 UP */
function renderUpdates(items) {
  const box = $('dyn-updates');
  if (!box) return;
  const seen = new Map();
  for (const it of items) {
    const a = it.modules && it.modules.module_author;
    if (!a || !a.mid || seen.has(a.mid)) continue;
    seen.set(a.mid, {
      mid: a.mid,
      name: a.name || '',
      face: a.face,
      ts: Number(a.pub_ts || 0),
      fresh: (Date.now() / 1000 - Number(a.pub_ts || 0)) < 86400,
    });
  }
  const ups = [...seen.values()].sort((x, y) => y.ts - x.ts).slice(0, 14);
  if (!ups.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="updates-head">最近更新 <span>${ups.length}</span></div>
    <div class="updates-row">${ups.map((u) => `
      <button class="update-up" data-mid="${u.mid}" data-name="${esc(u.name)}" title="只看 ${esc(u.name)} 的动态">
        <span class="update-avatar-wrap${u.fresh ? ' fresh' : ''}">
          <img loading="lazy" src="${esc(httpsUrl(u.face))}" alt="" />
        </span>
        <span class="update-name">${esc(u.name)}</span>
      </button>`).join('')}</div>`;
  box.querySelectorAll('.update-up').forEach((btn) => {
    btn.addEventListener('click', () => navigate('dynamic', {
      mid: Number(btn.dataset.mid), name: btn.dataset.name,
    }));
  });
}

/* 选择要看的 UP（关注列表） */
async function openUpPicker() {
  const existing = document.getElementById('up-picker');
  if (existing) { existing.remove(); return; }
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.id = 'up-picker';
  overlay.innerHTML = `
    <div class="picker">
      <div class="picker-head">
        <span>选择 UP 主</span>
        <button class="glass-btn picker-close" id="picker-close">关闭</button>
      </div>
      <input class="picker-search" id="picker-search" placeholder="搜索昵称…" />
      <div class="picker-list" id="picker-list"><div class="empty" style="padding:20px">正在加载关注列表…</div></div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  $('picker-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const res = await api(`/x/relation/followings?vmid=${state.login.mid}&pn=1&ps=50&order=desc`).catch(() => null);
  const list = (res && res.data && res.data.list) || [];
  const renderList = (keyword) => {
    const box = $('picker-list');
    if (!box) return;
    const kw = (keyword || '').trim().toLowerCase();
    const rows = list.filter((u) => !kw || String(u.uname || '').toLowerCase().includes(kw));
    if (!rows.length) {
      box.innerHTML = '<div class="empty" style="padding:20px">没有匹配的 UP 主</div>';
      return;
    }
    box.innerHTML = rows.map((u) => `
      <button class="picker-row" data-mid="${u.mid}" data-name="${esc(u.uname || '')}">
        <img class="picker-face" loading="lazy" src="${esc(httpsUrl(u.face))}" alt="" />
        <span class="picker-name">${esc(u.uname || '')}</span>
        <span class="picker-go">查看动态 →</span>
      </button>`).join('');
    box.querySelectorAll('.picker-row').forEach((row) => {
      row.addEventListener('click', () => {
        close();
        navigate('dynamic', { mid: Number(row.dataset.mid), name: row.dataset.name });
      });
    });
  };
  renderList('');
  const search = $('picker-search');
  if (search) {
    search.addEventListener('input', () => renderList(search.value));
    search.focus();
  }
}

/* ------------------------------ UP 主主页 ------------------------------ */

/* ------------------------------ UP 主主页 ------------------------------ */

function upTabBar(active) {
  const tabs = [
    ['home', '主页'],
    ['video', '投稿'],
    ['dynamic', '动态'],
    ['season', '合集和系列'],
    ['fav', '收藏'],
  ];
  return `<div class="up-tabs">${tabs.map(([k, label]) => `
    <button class="up-tab${k === active ? ' on' : ''}" data-up-tab="${k}">
      ${label}<span class="up-tab-count" data-count="${k}"></span>
    </button>`).join('')}</div>`;
}

function upSetCount(tab, n) {
  const el = document.querySelector(`.up-tab-count[data-count="${tab}"]`);
  if (el) el.textContent = n > 0 ? fmtNum(n) : '';
}

function upSection(title, body, action) {
  return `<section class="up-section">
    <div class="up-section-head">
      <div class="up-section-title">${esc(title)}</div>
      ${action ? `<button class="up-section-more" data-up-goto="${esc(action.tab)}">${esc(action.label || '查看全部')}</button>` : ''}
    </div>
    ${body}
  </section>`;
}

function upEmpty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

async function renderUp(mid) {
  if (!mid) { navigate('home'); return; }
  const upMid = Number(mid);
  state.up = { mid: upMid, tab: 'home' };
  view.innerHTML = `${listHeader('UP 主', '')}<div id="up-body">${skeletons(6)}</div>`;

  const [infoRes, statRes, upstatRes, relRes] = await Promise.all([
    bridge.apiWbi('/x/space/wbi/acc/info', { mid: upMid }).catch(() => null),
    api(`/x/relation/stat?vmid=${upMid}`).catch(() => null),
    api(`/x/space/upstat?mid=${upMid}`).catch(() => null),
    api(`/x/relation?fid=${upMid}`).catch(() => null),
  ]);
  if (!state.up || state.up.mid !== upMid) return;
  const info = (infoRes && infoRes.code === 0 && infoRes.data) || {};
  const stat = (statRes && statRes.data) || {};
  const upstat = (upstatRes && upstatRes.data) || {};
  const face = httpsUrl(info.face || '');
  const level = Number(info.level) || 0;
  const official = info.official && info.official.title;
  const vip = info.vip && info.vip.status === 1;

  const body = $('up-body');
  if (!body) return;
  body.innerHTML = `
    <div class="up-hero">
      <div class="up-banner" style="background-image:url('${esc(face)}')"></div>
      <div class="up-profile">
        <img class="up-face" src="${esc(face)}" alt="" />
        <div class="up-info">
          <div class="up-name-row">
            <span class="up-name">${esc(info.name || String(upMid))}</span>
            ${level ? `<span class="up-level">LV${level}</span>` : ''}
            ${vip ? '<span class="up-vip">大会员</span>' : ''}
            ${official ? `<span class="up-official" title="${esc(official)}">认证</span>` : ''}
          </div>
          <div class="up-sign">${esc(info.sign || '这个人很神秘，什么都没有写')}</div>
          <div class="up-stats">
            <button class="up-stat" data-rel="followers"><b>${fmtNum(stat.follower || 0)}</b> 粉丝</button>
            <button class="up-stat" data-rel="following"><b>${fmtNum(stat.following || 0)}</b> 关注</button>
            <span><b>${fmtNum(upstat.likes || 0)}</b> 获赞</span>
          </div>
        </div>
        <div class="up-actions">
          <button class="glass-btn up-follow" id="up-follow">关注</button>
          <button class="ghost-btn" id="up-web">网页版</button>
        </div>
      </div>
    </div>
    ${upTabBar('home')}
    <div id="up-tab-body">${skeletons(4)}</div>`;

  // 关注
  let followed = !!(relRes && relRes.data && relRes.data.attribute);
  const followBtn = $('up-follow');
  const paintFollow = () => {
    if (!followBtn) return;
    followBtn.textContent = followed ? '已关注' : '关注';
    followBtn.classList.toggle('on', followed);
  };
  paintFollow();
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      const next = !followed;
      const res = await bridge.actionPage('/x/relation/modify', {
        fid: upMid, act: next ? 1 : 2, re_src: 11,
      }).catch(() => null);
      if (res && res.code === 0) {
        followed = next;
        paintFollow();
        toast(next ? '已关注' : '已取消关注');
      } else {
        toast((res && res.message) || '操作失败');
      }
    });
  }
  body.querySelectorAll('.up-stat').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate('relation', { mid: upMid, type: btn.dataset.rel });
    });
  });
  $('up-web')?.addEventListener('click', () => {
    navigate('web', { url: `https://space.bilibili.com/${upMid}`, title: info.name || 'UP 主主页' });
  });

  body.querySelectorAll('.up-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.upTab;
      if (!tab || state.up.tab === tab) return;
      state.up.tab = tab;
      body.querySelectorAll('.up-tab').forEach((b) => b.classList.toggle('on', b === btn));
      renderUpTab();
    });
  });

  await renderUpTab();
}

async function renderUpTab() {
  const up = state.up;
  if (!up) return;
  const box = $('up-tab-body');
  if (!box) return;
  setInfinite(null);
  box.innerHTML = skeletons(4);
  const mid = up.mid;
  if (up.tab === 'video') return upVideos(mid, box);
  if (up.tab === 'dynamic') return upDynamics(mid, box);
  if (up.tab === 'season') return upSeasons(mid, box);
  if (up.tab === 'fav') return upFavs(mid, box);
  return upHome(mid, box);
}

async function upHome(mid, box) {
  const [latest, top, dynRes] = await Promise.all([
    bridge.apiWbi('/x/space/wbi/arc/search', { mid, pn: 1, ps: 8, order: 'pubdate', index: 0 }).catch(() => null),
    bridge.apiWbi('/x/space/wbi/arc/search', { mid, pn: 1, ps: 6, order: 'click', index: 0 }).catch(() => null),
    api(`/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}${dynFeatures}`).catch(() => null),
  ]);
  if (!state.up || state.up.mid !== mid) return;
  const latestList = (latest && latest.data && latest.data.list && latest.data.list.vlist) || [];
  const topList = (top && top.data && top.data.list && top.data.list.vlist) || [];
  const total = (latest && latest.data && latest.data.page && latest.data.page.count) || latestList.length;
  const dynItems = ((dynRes && dynRes.data && dynRes.data.items) || []).slice(0, 3);
  upSetCount('video', total);

  if (!latestList.length && !topList.length) {
    box.innerHTML = upEmpty('该 UP 主还没有公开投稿');
    return;
  }

  const grid = (list) => `<div class="grid">${list.map((v) => cardHTML({
    title: v.title,
    pic: v.pic,
    views: fmtNum(v.play),
    dur: v.length,
  })).join('')}</div>`;

  box.innerHTML = [
    topList.length ? upSection('代表作', grid(topList), { tab: 'video', label: '全部投稿' }) : '',
    upSection('最新投稿', grid(latestList), { tab: 'video', label: '查看全部' }),
    dynItems.length
      ? upSection('最近动态', `<div class="dyn-list">${dynItems.map(dynCard).join('')}</div>`,
        { tab: 'dynamic', label: '全部动态' })
      : '',
  ].join('');

  attachCardClicks(box, [...topList, ...latestList].map((v) => v.bvid));
  bindDynCards(box);
  box.querySelectorAll('[data-up-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.upGoto;
      const target = document.querySelector(`.up-tab[data-up-tab="${tab}"]`);
      if (target) target.click();
    });
  });
}

async function upVideos(mid, box) {
  const orders = [['pubdate', '最新发布'], ['click', '最多播放'], ['stow', '最多收藏']];
  let order = 'pubdate';
  let pn = 0;
  let items = [];
  let done = false;
  let loading = false;

  box.innerHTML = `
    <div class="up-subbar">
      <div class="seg up-seg">${orders.map(([k, label]) =>
        `<button data-order="${k}" class="${k === order ? 'on' : ''}">${label}</button>`).join('')}</div>
      <span class="up-total" id="up-total"></span>
    </div>
    <div id="up-video-feed">${skeletons(8)}</div>`;

  const draw = () => {
    const feed = $('up-video-feed');
    if (!feed) return;
    if (!items.length) { feed.innerHTML = upEmpty('没有获取到投稿'); return; }
    feed.innerHTML = `<div class="grid">${items.map((v) => cardHTML({
      title: v.title,
      pic: v.pic,
      views: fmtNum(v.play),
      dur: v.length,
    })).join('')}</div>`;
    attachCardClicks(feed, items.map((v) => v.bvid));
  };

  const load = async (reset) => {
    if (loading || done) return;
    loading = true;
    if (reset) { pn = 0; items = []; done = false; }
    const r = await bridge.apiWbi('/x/space/wbi/arc/search', {
      mid, pn: pn + 1, ps: 30, order, index: 0,
    }).catch(() => null);
    const vlist = (r && r.data && r.data.list && r.data.list.vlist) || [];
    const count = (r && r.data && r.data.page && r.data.page.count) || 0;
    pn += 1;
    items = items.concat(vlist);
    done = vlist.length < 20;
    const totalEl = $('up-total');
    if (totalEl) totalEl.textContent = count ? `共 ${fmtNum(count)} 个投稿` : '';
    upSetCount('video', count || items.length);
    draw();
    loading = false;
  };

  await load(true);
  if (!items.length) return;
  setInfinite(() => load(false));
  box.querySelectorAll('.up-seg button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (order === btn.dataset.order) return;
      order = btn.dataset.order;
      box.querySelectorAll('.up-seg button').forEach((b) => b.classList.toggle('on', b === btn));
      done = false;
      await load(true);
    });
  });
}

async function upDynamics(mid, box) {
  let offset = '';
  let items = [];
  let done = false;
  let loading = false;

  box.innerHTML = '<div id="up-dyn-feed"><div class="dyn-list">' + skeletons(3) + '</div></div>';
  const feed = () => $('up-dyn-feed');

  const draw = () => {
    const el = feed();
    if (!el) return;
    if (!items.length) { el.innerHTML = upEmpty('该 UP 主还没有公开动态'); return; }
    el.innerHTML = `<div class="dyn-list">${items.map(dynCard).join('')}</div>`;
    bindDynCards(el);
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const q = `/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}${dynFeatures}`;
    const r = await api(q).catch(() => null);
    const d = (r && r.data) || {};
    const list = d.items || [];
    offset = d.offset || '';
    done = !d.has_more || !list.length;
    items = items.concat(list);
    draw();
    loading = false;
  };

  await load();
  if (!items.length) return;
  setInfinite(load);
}

async function upSeasons(mid, box) {
  const r = await api(`/x/polymer/web-space/seasons_series_list?mid=${mid}&page_num=1&page_size=20`).catch(() => null);
  if (!state.up || state.up.mid !== mid) return;
  const lists = (r && r.data && r.data.items_lists) || {};
  const seasons = lists.seasons_list || [];
  const series = lists.series_list || [];
  upSetCount('season', seasons.length + series.length);

  if (!seasons.length && !series.length) {
    box.innerHTML = upEmpty('该 UP 主还没有公开的合集或系列');
    return;
  }

  const cardOf = (item, kind) => {
    const meta = item.meta || {};
    const title = meta.title || meta.name || '';
    const cover = meta.cover || ((item.archives || [])[0] || {}).pic || '';
    const count = meta.total || (item.archives || []).length || 0;
    const id = kind === 'season' ? meta.season_id : (meta.series_id || meta.id);
    return `<button class="up-col" data-kind="${kind}" data-id="${esc(String(id || ''))}" data-title="${esc(title)}">
      <img loading="lazy" src="${esc(httpsUrl(cover))}" alt="" />
      <span class="up-col-info">
        <span class="up-col-title">${esc(title)}</span>
        <span class="up-col-meta">${kind === 'season' ? '合集' : '系列'} · ${fmtNum(count)} 个视频</span>
      </span>
    </button>`;
  };

  box.innerHTML = [
    seasons.length ? upSection('合集', `<div class="up-col-grid">${seasons.map((x) => cardOf(x, 'season')).join('')}</div>`) : '',
    series.length ? upSection('系列', `<div class="up-col-grid">${series.map((x) => cardOf(x, 'series')).join('')}</div>`) : '',
  ].join('');

  box.querySelectorAll('.up-col').forEach((btn) => {
    btn.addEventListener('click', () => {
      upCollectionDetail(mid, btn.dataset.kind, btn.dataset.id, btn.dataset.title, box);
    });
  });
}

async function upCollectionDetail(mid, kind, id, title, box) {
  if (!id) return;
  setInfinite(null);
  box.innerHTML = `
    <div class="up-subbar">
      <button class="ghost-btn" id="up-back">← 返回合集</button>
      <span class="up-col-detail-title">${esc(title || '')}</span>
    </div>
    <div id="up-col-feed">${skeletons(8)}</div>`;

  let pn = 0;
  let items = [];
  let done = false;
  let loading = false;

  const path = kind === 'season'
    ? `/x/polymer/web-space/seasons_archives_list?mid=${mid}&season_id=${encodeURIComponent(id)}`
    : `/x/polymer/web-space/series_archives_list?mid=${mid}&series_id=${encodeURIComponent(id)}`;

  const draw = () => {
    const el = $('up-col-feed');
    if (!el) return;
    if (!items.length) { el.innerHTML = upEmpty('这个合集还没有视频'); return; }
    el.innerHTML = `<div class="grid">${items.map((v) => cardHTML({
      title: v.title,
      pic: v.pic || v.cover,
      views: fmtNum((v.stat && v.stat.view) || 0),
      dur: fmtDur(v.duration),
    })).join('')}</div>`;
    attachCardClicks(el, items.map((v) => v.bvid));
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const r = await api(`${path}&page_num=${pn + 1}&page_size=30`).catch(() => null);
    const archives = (r && r.data && r.data.archives) || [];
    pn += 1;
    items = items.concat(archives);
    done = archives.length < 20;
    draw();
    loading = false;
  };

  $('up-back')?.addEventListener('click', () => {
    setInfinite(null);
    upSeasons(mid, box);
  });

  await load();
  if (items.length) setInfinite(load);
}

async function upFavs(mid, box) {
  const r = await api(`/x/v3/fav/folder/created/list-all?up_mid=${mid}`).catch(() => null);
  if (!state.up || state.up.mid !== mid) return;
  const folders = (r && r.data && r.data.list) || [];
  upSetCount('fav', folders.length);
  if (!folders.length) {
    box.innerHTML = upEmpty('该 UP 主没有公开的收藏夹');
    return;
  }
  box.innerHTML = upSection('公开收藏夹', `<div class="up-col-grid">${folders.map((f) => `
    <button class="up-col" data-fav="${esc(String(f.id))}" data-title="${esc(f.title || '')}">
      <img loading="lazy" src="${esc(httpsUrl(f.cover || ''))}" alt="" />
      <span class="up-col-info">
        <span class="up-col-title">${esc(f.title || '未命名收藏夹')}</span>
        <span class="up-col-meta">${fmtNum(f.media_count || 0)} 个内容</span>
      </span>
    </button>`).join('')}</div>`);

  box.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      upFavDetail(btn.dataset.fav, btn.dataset.title, box);
    });
  });
}

async function upFavDetail(mediaId, title, box) {
  setInfinite(null);
  box.innerHTML = `
    <div class="up-subbar">
      <button class="ghost-btn" id="up-fav-back">← 返回收藏夹</button>
      <span class="up-col-detail-title">${esc(title || '')}</span>
    </div>
    <div id="up-fav-feed">${skeletons(8)}</div>`;

  let pn = 0;
  let items = [];
  let done = false;
  let loading = false;

  const draw = () => {
    const el = $('up-fav-feed');
    if (!el) return;
    const vids = items.filter((m) => m.type === 2 || m.bvid);
    if (!vids.length) { el.innerHTML = upEmpty('这个收藏夹里没有视频'); return; }
    el.innerHTML = `<div class="grid">${vids.map((m) => cardHTML({
      title: m.title,
      pic: m.cover,
      views: fmtNum((m.cnt_info && m.cnt_info.play) || 0),
      dur: fmtDur(m.duration),
    })).join('')}</div>`;
    attachCardClicks(el, vids.map((m) => m.bvid));
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    const r = await api(`/x/v3/fav/resource/list?media_id=${mediaId}&ps=30&pn=${pn + 1}&platform=web`).catch(() => null);
    const medias = (r && r.data && r.data.medias) || [];
    pn += 1;
    items = items.concat(medias);
    done = medias.length < 20;
    draw();
    loading = false;
  };

  $('up-fav-back')?.addEventListener('click', () => {
    setInfinite(null);
    upFavs(state.up.mid, box);
  });

  await load();
  if (items.length) setInfinite(load);
}

/* ------------------------------ 设置 ------------------------------ */

const sheet = $('settings-sheet');
function openSheet() {
  sheet.hidden = false;
  applySettingsUI();
  bridge.auxHide();
  bridge.downloadsDir().then((d) => { if (d) $('dl-path').textContent = d; }).catch(() => {});
  loadDownloads();
  refreshLogin();
}

async function loadDownloads() {
  const box = $('dl-list');
  const countEl = $('dl-count');
  if (!box) return;
  box.innerHTML = '<div class="dl-empty">加载中…</div>';
  const res = await bridge.listDownloads().catch(() => null);
  const files = (res && res.files) || [];
  if (countEl) countEl.textContent = files.length ? `${files.length} 个文件` : '暂无';
  if (!files.length) {
    box.innerHTML = '<div class="dl-empty">还没有下载文件</div>';
    return;
  }
  const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  box.innerHTML = files.map((f) => `
    <div class="dl-row">
      <span class="dl-name" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="dl-size">${fmtSize(f.size)}</span>
      <button class="dl-del" data-name="${esc(f.name)}" title="删除">×</button>
    </div>`).join('');
  box.querySelectorAll('.dl-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const r = await bridge.deleteDownload(btn.dataset.name).catch(() => null);
      if (r && r.ok) { toast('已删除'); loadDownloads(); }
      else toast('删除失败');
    });
  });
}
function closeSheet() {
  sheet.hidden = true;
  // 恢复当前视图的辅助视图
  if (state.route.name === 'video') showPlayerWhenReady(state.route.params.bvid);
  if (state.route.name === 'web') renderWeb(state.route.params.url, state.route.params.title);
}

/* ------------------------------ 事件绑定 ------------------------------ */

function bindEvents() {
  $('btn-back').addEventListener('click', goBack);
  $('btn-home').addEventListener('click', () => navigate('home'));
  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); submitSearch(); });
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideSearchHistory(); $('search-input').blur(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestItems.length) {
      e.preventDefault();
      suggestIndex = e.key === 'ArrowDown'
        ? (suggestIndex + 1) % suggestItems.length
        : (suggestIndex <= 0 ? suggestItems.length - 1 : suggestIndex - 1);
      paintSuggestIndex();
      return;
    }
    if (e.key === 'Enter' && suggestIndex >= 0 && suggestItems[suggestIndex]) {
      e.preventDefault();
      $('search-input').value = suggestItems[suggestIndex];
      submitSearch();
    }
  });
  $('search-input').addEventListener('input', () => {
    const q = $('search-input').value.trim();
    suggestIndex = -1;
    clearTimeout(suggestTimer);
    if (!q) {
      suggestSeq += 1;
      suggestItems = [];
      renderRecentSearches();
      return;
    }
    suggestTimer = setTimeout(() => loadSuggest(q), 180);
  });
  $('search-input').addEventListener('focus', showSearchHistory);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-hist') && e.target !== $('search-input')) hideSearchHistory();
  });
  $('btn-theme').addEventListener('click', () => {
    // 工具栏按钮只在浅色/深色之间切换；跟随系统在设置里选择
    const isDark = document.documentElement.dataset.theme === 'dark';
    state.theme = isDark ? 'light' : 'dark';
    store.set('theme', state.theme);
    applyTheme();
    toast(state.theme === 'dark' ? '深色模式' : '浅色模式');
  });
  $('btn-settings').addEventListener('click', openSheet);
  $('btn-fullscreen').addEventListener('click', () => bridge.winControl('fullscreen'));
  $('settings-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  // 长按 ← / →：临时 3 倍速，松开恢复
  let arrowTimer = null;
  state.arrowBoost = false;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (state.route.name !== 'video' && state.route.name !== 'season') return;
    if (e.repeat || arrowTimer || state.arrowBoost) return;
    arrowTimer = setTimeout(() => {
      arrowTimer = null;
      state.arrowBoost = true;
      state.arrowPrevRate = Number(state.settings.rate) || 1;
      bridge.playerCmd({ cmd: 'speed', value: 3 });
    }, 420);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (arrowTimer) { clearTimeout(arrowTimer); arrowTimer = null; }
    if (state.arrowBoost) {
      state.arrowBoost = false;
      bridge.playerCmd({ cmd: 'speed', value: state.arrowPrevRate || 1 });
    }
  });

  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      if (state.videoFs) { bridge.playerFullscreen({ on: false }); return; }
      if (state.liveFs) { bridge.liveFullscreen({ on: false }); return; }
      if (!$('palette').hidden) return closePalette();
      if (!$('shortcuts-sheet').hidden) return closeShortcuts();
      const picker = document.getElementById('up-picker');
      if (picker) return picker.remove();
      const lb = document.getElementById('lightbox');
      if (lb) return closeLightbox();
      const menu = document.querySelector('.menu');
      if (menu) return menu.remove();
      if (!sheet.hidden) return closeSheet();
      if (document.documentElement.classList.contains('immersive')) return toggleImmersive(false);
      if (typing) { document.activeElement.blur(); return; }
      if (IS_WIN && state.winFullscreen) { bridge.winControl('fullscreen'); return; }
      hideAux();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); bridge.winControl('fullscreen'); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); openShortcuts(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); refreshCurrent(); }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSheet(); }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleImmersive(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); goBack(); }
    if ((e.metaKey || e.ctrlKey) && e.key === ']') { e.preventDefault(); goForward(); }
    if (IS_WIN && e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    if (IS_WIN && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    if (IS_WIN && e.key === 'F5') { e.preventDefault(); refreshCurrent(); }
    if (!typing && ['j', 'k', 'l'].includes(e.key.toLowerCase()) && (state.route.name === 'video' || state.route.name === 'season')) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'j') bridge.playerCmd({ cmd: 'back5' });
      if (e.key.toLowerCase() === 'k') bridge.playerCmd({ cmd: 'toggle' });
      if (e.key.toLowerCase() === 'l') bridge.playerCmd({ cmd: 'fwd5' });
    }
    if (!typing && (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (state.route.name === 'video' || state.route.name === 'season') {
        e.preventDefault();
        if (e.key === ' ') bridge.playerCmd({ cmd: 'toggle' });
        else if (!e.repeat && !state.arrowBoost) {
          // 单击：快退/快进 5 秒；长按：3 倍速（见下方 keydown 计时器）
          bridge.playerCmd({ cmd: e.key === 'ArrowLeft' ? 'back5' : 'fwd5' });
        }
      }
    }
  });
  $('btn-login').addEventListener('click', () => {
    if (state.login) return toast('已登录：' + state.login.uname);
    bridge.openLogin();
  });
  $('btn-downloads').addEventListener('click', () => bridge.openDownloads());
  $('btn-collapse').addEventListener('click', toggleSidebar);

  $('set-autoplay').addEventListener('change', async (e) => {
    state.settings.autoplay = e.target.checked;
    await bridge.setSettings({ autoplay: e.target.checked });
    toast('自动播放：' + (e.target.checked ? '开启' : '关闭'));
  });
  $('set-danmaku').addEventListener('change', async (e) => {
    state.settings.danmaku = e.target.checked;
    await bridge.setSettings({ danmaku: e.target.checked });
    toast('弹幕：' + (e.target.checked ? '开启' : '关闭'));
  });
  for (const b of document.querySelectorAll('#theme-seg button')) {
    b.addEventListener('click', () => {
      state.theme = b.dataset.theme;
      store.set('theme', state.theme);
      applyTheme();
    });
  }
  $('btn-open-downloads').addEventListener('click', () => bridge.openDownloads());
  $('btn-pick-dl-dir')?.addEventListener('click', async () => {
    const r = await bridge.pickDownloadDir().catch(() => null);
    if (!r || r.canceled) return;
    if (r.ok) {
      $('dl-path').textContent = r.dir;
      toast('下载目录已更改');
      loadDownloads();
    } else toast((r && r.message) || '更改目录失败');
  });
  $('btn-reset-dl-dir')?.addEventListener('click', async () => {
    const r = await bridge.resetDownloadDir().catch(() => null);
    if (r && r.ok) {
      $('dl-path').textContent = r.dir;
      toast('已恢复默认下载目录');
      loadDownloads();
    }
  });
  $('btn-clear-cache').addEventListener('click', async () => {
    await bridge.clearCache();
    state.cache.clear();
    toast('已清除缓存');
  });

  /* --- 更新 --- */
  $('btn-check-update')?.addEventListener('click', () => runUpdateCheck(true));
  $('btn-install-update')?.addEventListener('click', onUpdateInstallClick);
  $('btn-reveal-update')?.addEventListener('click', () => {
    if (updateUI.file) bridge.revealUpdate(updateUI.file).catch(() => {});
  });
  $('up-feed')?.addEventListener('change', (e) => {
    const v = String(e.target.value || '').trim();
    e.target.value = v;
    state.settings.updateFeed = v;
    bridge.setSettings({ updateFeed: v }).catch(() => {});
    if (v) runUpdateCheck(true);
    else {
      const fallback = DEFAULT_UPDATE_REPO;
      e.target.value = fallback;
      state.settings.updateFeed = fallback;
      bridge.setSettings({ updateFeed: fallback }).catch(() => {});
      setUpdateStatus('已恢复默认更新源（本项目 GitHub 仓库）');
    }
  });
  $('up-auto')?.addEventListener('change', (e) => {
    state.settings.updateAutoCheck = e.target.checked;
    bridge.setSettings({ updateAutoCheck: e.target.checked }).catch(() => {});
  });
  initUpdatePanel();

  view.addEventListener('scroll', () => {
    if (state.onScroll) state.onScroll();
    updateScrollTop();
  }, { passive: true });

  /* --- 外观 / 背景 --- */
  $('btn-refresh').addEventListener('click', refreshCurrent);
  $('btn-palette').addEventListener('click', openPalette);
  $('btn-immersive').addEventListener('click', () => toggleImmersive());
  $('btn-fullscreen').addEventListener('click', () => bridge.winControl('fullscreen'));

  $('set-blur').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('blur-val').textContent = `${v}px`;
    document.documentElement.style.setProperty('--blur', `${v}px`);
    state.settings.glassBlur = v;
  });
  $('set-blur').addEventListener('change', (e) => {
    bridge.setSettings({ glassBlur: Number(e.target.value) }).catch(() => {});
  });

  $('set-grain').addEventListener('change', (e) => {
    document.body.classList.toggle('no-grain', !e.target.checked);
    bridge.setSettings({ grain: e.target.checked }).catch(() => {});
    state.settings.grain = e.target.checked;
  });

  document.querySelectorAll('#accent-row .accent').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSetting({ accent: btn.dataset.accent });
    });
  });

  document.querySelectorAll('#density-seg button').forEach((btn) => {
    btn.addEventListener('click', () => saveSetting({ density: btn.dataset.density }));
  });

  document.querySelectorAll('#bg-type-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.bg;
      const bg = state.settings.background || {};
      if (type === 'image' && !bg.value) return pickBackground();
      if (type === 'gradient' && !bg.value) {
        return saveSetting({ background: { ...bg, type, value: BG_GRADIENTS[0].css } });
      }
      if (type === 'color' && !bg.value) {
        return saveSetting({ background: { ...bg, type, value: BG_COLORS[0] } });
      }
      saveSetting({ background: { ...bg, type } });
    });
  });

  $('bg-pick').addEventListener('click', pickBackground);
  $('bg-clear').addEventListener('click', clearBackground);
  $('set-bg-blur').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('bgblur-val').textContent = `${v}px`;
    document.documentElement.style.setProperty('--bg-blur', `${v}px`);
    state.settings.background = { ...(state.settings.background || {}), blur: v };
  });
  $('set-bg-blur').addEventListener('change', (e) => {
    bridge.setSettings({ background: { ...(state.settings.background || {}), blur: Number(e.target.value) } }).catch(() => {});
  });
  $('set-bg-dim').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    $('bgdim-val').textContent = `${Math.round(v * 100)}%`;
    document.documentElement.style.setProperty('--bg-dim', String(v));
    state.settings.background = { ...(state.settings.background || {}), dim: v };
  });
  $('set-bg-dim').addEventListener('change', (e) => {
    bridge.setSettings({ background: { ...(state.settings.background || {}), dim: Number(e.target.value) / 100 } }).catch(() => {});
  });

  /* --- 弹幕设置 --- */
  const dmBind = (id, labelId, fmt, key, transform) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const raw = Number(e.target.value);
      const value = transform ? transform(raw) : raw;
      $(labelId).textContent = fmt(value);
      state.settings[key] = value;
    });
    el.addEventListener('change', (e) => {
      const raw = Number(e.target.value);
      const value = transform ? transform(raw) : raw;
      bridge.setSettings({ [key]: value }).catch(() => {});
    });
  };
  $('set-quality')?.addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    state.settings.defaultQuality = v;
    bridge.setSettings({ defaultQuality: v }).catch(() => {});
    const label = e.target.selectedOptions[0]?.textContent || '自动';
    toast(`默认画质：${label}`);
  });

  dmBind('set-dm-size', 'dmsize-val', (v) => `${v}px`, 'danmakuSize');
  dmBind('set-dm-opacity', 'dmop-val', (v) => `${Math.round(v * 100)}%`, 'danmakuOpacity', (v) => v / 100);
  dmBind('set-dm-speed', 'dmsp-val', (v) => `${v.toFixed(1)}×`, 'danmakuSpeed', (v) => v / 10);

  /* --- 命令面板 --- */
  $('palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
  $('palette-input').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
  $('palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteIndex = Math.min(paletteFiltered.length - 1, paletteIndex + 1);
      renderPalette();
      document.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPalette();
      document.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPalette(paletteIndex);
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });

  /* --- 快捷键面板 --- */
  $('shortcuts-close').addEventListener('click', closeShortcuts);
  $('shortcuts-sheet').addEventListener('click', (e) => { if (e.target.id === 'shortcuts-sheet') closeShortcuts(); });

  /* --- 回到顶部 --- */
  $('scroll-top').addEventListener('click', () => {
    const inner = document.querySelector('.watch-scroll');
    if (inner) inner.scrollTo({ top: 0, behavior: 'smooth' });
    else view.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* --- 拖拽背景 --- */
  let dragDepth = 0;
  const hasImageFile = (e) => {
    const items = e.dataTransfer?.items;
    if (!items) return false;
    return [...items].some((it) => it.kind === 'file' && String(it.type).startsWith('image/'));
  };
  document.addEventListener('dragenter', (e) => {
    if (!hasImageFile(e)) return;
    e.preventDefault();
    dragDepth += 1;
    $('drop-hint').hidden = false;
  });
  document.addEventListener('dragover', (e) => {
    if (!hasImageFile(e)) return;
    e.preventDefault();
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasImageFile(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('drop-hint').hidden = true;
  });
  document.addEventListener('drop', async (e) => {
    if (!hasImageFile(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-hint').hidden = true;
    const file = [...e.dataTransfer.files].find((f) => String(f.type).startsWith('image/'));
    if (!file) return;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const buf = await file.arrayBuffer();
    const res = await bridge.saveBackground(new Uint8Array(buf), ext).catch(() => null);
    if (res && res.ok) {
      saveSetting({ background: { ...(state.settings.background || {}), type: 'image', value: res.url } });
      toast('背景已更新');
    } else {
      toast((res && res.message) || '设置背景失败');
    }
  });

  /* --- 图片加载失败占位 --- */
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG') t.classList.add('img-fail');
  }, true);

  /* --- Windows 标题栏按钮：最小化 / 最大化·还原 / 关闭 --- */
  const wc = $('win-controls');
  if (bridge.platform !== 'darwin') {
    wc.hidden = false;
    wc.querySelectorAll('.wc').forEach((b) => {
      b.addEventListener('click', () => bridge.winControl(b.dataset.cmd));
    });
  }
  const applyWindowState = (st) => {
    if (!st) return;
    state.winMaximized = !!st.maximized;
    state.winFullscreen = !!st.fullscreen;
    const maxBtn = wc && wc.querySelector('.wc-max');
    if (maxBtn) {
      maxBtn.classList.toggle('is-max', state.winMaximized);
      maxBtn.title = state.winMaximized ? '还原' : '最大化';
    }
    $('btn-fullscreen')?.classList.toggle('active', state.winFullscreen);
  };
  bridge.on('window-state', applyWindowState);
  bridge.winState().then(applyWindowState).catch(() => {});
  // 双击工具栏空白 / 侧边栏顶部也能最大化（Windows 习惯）
  if (IS_WIN) {
    for (const el of [$('toolbar'), document.querySelector('.side-head')]) {
      if (!el) continue;
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, input, .win-controls, .search-form')) return;
        bridge.winControl('maximize');
      });
    }
  }

  bridge.on('shortcut', (name) => {
    if (name === 'search') return focusSearch();
    if (name === 'home') return navigate('home');
    if (name === 'back') return goBack();
    if (name === 'forward') return goForward();
    if (name === 'reload') return reloadCurrent();
    if (name === 'toggle-sidebar') return toggleSidebar();
    if (name === 'toggle-theme') return $('btn-theme').click();
    if (name === 'settings') return openSheet();
  });

  window.addEventListener('resize', () => {
    if (state.route.name === 'video') {
      const slot = $('player-slot');
      if (slot) {
        const r = slot.getBoundingClientRect();
        bridge.playerResize({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
    }
  });
}

function reloadCurrent() {
  state.cache.clear();
  const r = state.route;
  if (r.name === 'video') {
    bridge.playerHide();
    state.auxObserver?.disconnect();
    renderVideo(r.params.bvid);
  } else if (r.name === 'web') {
    bridge.webHide();
    renderWeb(r.params.url, r.params.title);
  } else {
    render();
  }
}

/* ------------------------------ 启动 ------------------------------ */

async function boot() {
  renderSidebar();
  bindEvents();
  await loadSettings();
  if (store.get('immersive', false)) toggleImmersive(true, true);
  refreshLogin();
  const params = new URLSearchParams(location.search);
  const video = params.get('video');
  const route = params.get('route');
  if (video) navigate('video', { bvid: video });
  else if (route && route.includes(':')) {
    const [name, value] = route.split(':');
    if (name === 'season') navigate('season', { seasonId: value });
    else if (name === 'liveRoom') navigate('liveRoom', { roomId: value });
    else if (name === 'dynamic') navigate('dynamic', { mid: Number(value) });
    else if (name === 'up') navigate('up', { mid: value });
    else navigate(name);
  } else if (route) navigate(route);
  else if (params.get('open')) {
    navigate('home');
    setTimeout(() => {
      const which = params.get('open');
      if (which === 'settings') openSheet();
      else if (which === 'palette') openPalette();
      else if (which === 'shortcuts') openShortcuts();
    }, 600);
  } else {
    const last = store.get('lastRoute', null);
    const valid = last && typeof last.name === 'string' &&
      ['home', 'hot', 'rank', 'bangumi', 'live', 'dynamic', 'history', 'fav', 'watchlater', 'search', 'up', 'season'].includes(last.name);
    if (valid) navigate(last.name, last.params || {});
    else navigate('home');
  }
}

boot();

# BiliFound Windows 版 · 1.0.0 → 1.11.1 更新清单

> **关于版本号**：本文记录的是移植开发期间的内部迭代（1.1.0 → 1.11.1）。
> 对外发布统一使用 **1.0.0**，仓库里看到的 exe 与 README 都是 1.0.0。

> 生成于 2026-11-03，对应 `package.json` **1.11.1**。
> 用途：① 查每个版本改了什么；② 在 macOS 版里按同样思路同步。附录里的代码是从当前 Windows 源码
> **原样抽出**的，可以直接复制。

---

## 0. 同步路线（先看这个）

### 0.1 需要同步的文件

| 文件 | 涉及版本 | 建议方式 |
| --- | --- | --- |
| `renderer/app.js` | 1.1.0 – 1.11.0 | 按附录 A 的函数逐个替换／新增 |
| `renderer/style.css` | 1.4.0、1.5.0、1.6.0、1.7.0、1.8.0、1.10.0、1.11.0 | 改卡片区 + 追加附录 B 的整块 |
| `renderer/index.html` | 1.10.0 | 设置面板加一个 `<section>`（附录 C.3） |
| `renderer/player.html` | 1.1.0 | 播放器内滚轮转发给外壳（3 行监听） |
| `player-preload.js` | 1.1.0 | `wheel` 桥（一行） |
| `build/icon.png` | 1.11.1 | 1024 图标，Mac 端用它生成 `.icns` |
| `main.js` | 1.6.0、1.8.0 | 两个 handler／一段弹幕解析（附录 C.1、C.2） |
| `preload.js` | 1.6.0 | 加一行 `suggest`（附录 C.4） |
| `tools/probe-*.js` | 全部 | 验收脚本，按需搬（`probe-home` / `suggest` / `live-room` / `styles`） |

### 0.2 依赖顺序

```
首页这条线：1.4.0（卡片） → 1.5.0（大小混排） → 1.9.0（列数自适应） → 1.9.1（3 列修正） → 1.11.0（换一批）
搜索这条线：1.6.0（联想） → 1.7.0（历史 + 热搜）     ← 1.7 依赖 1.6 的面板容器函数
直播：      1.8.0 独立（但依赖 1.5 之后的卡片样式）
设计风格：  1.10.0 独立（只是 CSS 覆盖 + 设置项）
```

> 顺序别乱：先 1.4 再 1.5，否则 1.5 的 `hero` 会套在旧卡片上；先 1.6 再 1.7，
> 因为 1.7 复用了 1.6 的 `ensureSearchPanel()` / `loadSuggest()`。

---

## 1. 版本总览

| 版本 | 主题 | 用户能感觉到的变化 | 验收脚本 |
| --- | --- | --- | --- |
| 1.0.0 | 基础移植 | — | `probe-main.js` |
| 1.1.0 | 播放页布局重做 | 视频页下方不再只剩一条缝，滚动时播放器缩成迷你态 | `probe-scroll.js` |
| 1.2.0 | 动态页直播栏 | 左栏不再是「正在直播 10」，可看全部关注直播 | `probe-live-follow.js` |
| 1.3.0 | 应用内更新 | 设置里检查／下载／安装新版本 | `probe-update.js` |
| 1.4.0 | 卡片改版 | 22 圆角、无边框、封面满宽、强阴影；内容限宽 1440 | `probe-home.js` |
| 1.5.0 | 首页大小混排 | 顶部大轮播 + 侧卡，下面统一网格 | `probe-home.js` |
| 1.6.0 | 搜索预测 | 输入即出联想词，命中标红，↑↓ 选择 | `probe-suggest.js` |
| 1.7.0 | 搜索历史 + 热搜 | 点开就有历史 chips 和 bilibili 热搜两栏 | `probe-suggest.js` |
| 1.8.0 | 直播页重排 | 左播放器 + 右弹幕栏；点赞、表情、弹幕屏蔽 | `probe-live-room.js` |
| 1.9.0 | 列数自适应 | 小窗 4 列 / 全屏 5 列 | `probe-home.js` |
| 1.9.1 | 修窄窗空格子 | 3 列时大卡独占整行、侧卡 3 张 | `probe-home.js` |
| 1.10.0 | 设计风格 | 经典／杂志／极简／米纸／霓虹 5 个预设 | `probe-styles.js` |
| 1.11.0 | 换一批 | 首页右上角一键换一批推荐 | `probe-home.js` |
| 1.11.1 | 换图标 | 手绘小电视 + 粉色圆角底板，多尺寸重绘 | `build/icon-preview.png` 肉眼验收 |
| 1.11.1 | 换图标 | 手绘小电视 + 白色圆角底板，多尺寸重绘 | `build/icon-preview.png` 肉眼验收 |

> 注：1.4.0 里曾经做过「继续观看」区块，**1.5.0 已按要求整体删除**（函数、样式、接口调用都删了）。
> 同步时不要把它加回去。

---

## 2. 逐版本明细

### 1.1.0 · 播放页布局重做

**问题**：1180×760 窗口下，视频页下方内容区只剩 76px（内容高 4456px），滚轮几乎没法用；
番剧页把播放器放进外层滚动流，原生视图和 DOM 槽位会脱位（`#view` 滚 320px 后槽位从 y=364 跑到 y=44，
而原生视图停在原地）。

**改法**：

- 视频／番剧／直播三个播放页统一成「顶部固定播放器 + 下方独立滚动」骨架；
- `setupWatchBlock()` 按窗口尺寸算 `--player-h`，并在滚动时把播放器缩成迷你态；
- 播放器里的滚轮由 `playerBridge.wheel → player:wheel → window.__bgWheel` 转发给外壳，
  否则鼠标在画面上滚不动下面的内容。

涉及 3 个文件，少一个滚轮就不通：

| 文件 | 作用 |
| --- | --- |
| `renderer/player.html` | `wheel` 监听 → `playerBridge.wheel(delta)` |
| `player-preload.js` | `wheel: (dy) => ipcRenderer.send('player:wheel', dy)` |
| `main.js` | 收到 `player:wheel` 后 `executeJavaScript('window.__bgWheel(dy)')` |

`app.js` 里另有 `window.__bgNav / __bgState / __bgWheel` 三个调试入口，探针要用。

**Mac 端注意**：这套骨架在三个页面都用到了，属于结构性改动，建议整段对齐（`renderVideo`、
`renderSeason`、`renderLiveRoom` 的外层）。`setupWatchBlock()` 保持原样即可。

**验收**：`probe-scroll.js` 9 项 —— 初始内容区 ≥130px、滚动后播放器变小、内容区变大、
迷你态控制条精简、播放器上滚轮能带内容、滚回顶部恢复、番剧播放器不移动。

### 1.2.0 · 动态页「正在直播」改造

**问题**：左栏计数恒为 10 —— `loadLiveRail()` 只请求一次（接口默认 10 条）再 `.slice(0, 10)`，
计数也用的是这 10 条。

**改法**：

- 请求显式带 `page_size=50`，计数用 `data.total`（没有 total 时用列表长度，疑似截断显示 `N+`）；
- 左栏固定 10 行，标题右侧加「全部 ›」，底部加「还有 N 位正在直播 · 查看全部 ›」；
- 新增 `liveFollowing` 路由：`page_size=20` 无限翻页、按 `room_id` 去重、点击进直播间、顶部「返回动态」。

**验收**：`probe-live-follow.js`（真接口）+ `probe-live-follow-mock.js`（mock 26 条）9 项。

### 1.3.0 · 应用内更新

**做法**：静态清单 `latest.json` + 应用内检查／下载／安装，**没有引入 electron-updater**
（避免 latest.yml / blockmap / 代码签名的额外约束，也照顾便携版与绿色包）。

```jsonc
// latest.json（放在任意静态服务器）
{
  "version": "1.11.0",
  "notes": "更新说明……",
  "publishedAt": "2026-11-03",
  "url": "https://…/BiliFound-1.11.0-Setup-x64.exe",
  "size": 98167401,
  "sha256": "8e0afcaa…",
  "portableUrl": "https://…/BiliFound-1.11.0-Portable-x64.exe",
  "portableSize": 97872976,
  "portableSha256": "c072bd32…"
}
```

IPC：`update:check | download | install | reveal | version | skip`；下载落到
`%TEMP%\BiliFound-update`，先校验 sha256 再允许安装；自动检查 6 小时节流。

**Mac 端注意**：清单里的 `url` 指向 `.exe`；Mac 版要么换一套 `dmg`/`zip` 清单，
要么让 `channel` 字段区分平台（推荐后者：同一个 latest.json 里放 `platforms.win` / `platforms.mac`）。

**验收**：`probe-update.js` 13 项（含坏 JSON、404、sha 不匹配、逐字节一致、进度事件）。

### 1.4.0 · 卡片改版 + 内容限宽

**改动**（都在 `style.css`）：

| 项目 | 改前 | 改后 |
| --- | --- | --- |
| 卡片圆角 | `var(--r-lg)` 18px | `--r-card: 22px` |
| 卡片内边距 | 12px | `padding: 0`（封面满宽） |
| 卡片边框 | 1px | `border: 0` |
| 阴影 | 常规卡阴影 | `0 16px 32px -20px rgba(16,24,40,.5), 0 3px 8px -5px rgba(16,24,40,.2), var(--edge-light)` |
| hover | 无位移 | `translateY(-3px)` + 更强阴影 + 封面 `scale(1.045)` |
| 标题 | 13px | `12.8px / 1.45 / min-height:2.9em`，`margin:10px 12px 0` |
| 副信息 | — | `margin:6px 12px 11px` |
| 角标内缩 | 12px | 8px |
| 内容宽度 | 铺满 | `--content-max: 1440px`，`.view-head/#feed/.section-title` 居中限宽 |

对应选择器（改的是已有规则，不是新增）：`.card`、`.card:hover`、`.card .cover`、
`.card:hover .cover img`、`.card .title`、`.card .sub`，以及新增的 `--grid-min` /
`--content-max` / `--r-card` 三个变量。

> 完整的改后规则见**附录 B.0**（整块替换即可）。

**另外修了一个小 bug**：卡片底部 `UP 名 · 角标` 之间，只有 UP 名没有角标时会多出一个间隔点，
`cardHTML()` 里改成两次判断：

```js
${up ? `<span>${esc(up)}</span>` : ''}${up && badge ? '<span class="dot"></span>' : ''}${badge ? `<span>${esc(badge)}</span>` : ''}
```

### 1.5.0 · 首页顶部大小混排

**需求**：小窗和全屏排版别差太多；大卡小卡混在一起减少同质化；混排只出现在最上面一屏。

**结构**：

```html
<div class="hero-row">              <!-- 与网格同一套轨道 -->
  <div class="hero" id="hero">…5 张轮播…</div>   <!-- grid-column: span 3；span 2 行 -->
  <article class="card">…</article>            <!-- 侧卡，各占 1 列 -->
</div>
<div class="grid home-grid" id="feed-grid">…</div>
```

**要点**：

- 大卡 5 张、6 秒自动切换、鼠标移入暂停、左右箭头 hover 出现、底部圆点可点、点击进视频页；
- 定时器存 `state.heroTimer`，`render()` 切路由时必须清掉，否则离开首页后还在跑；
- 侧卡数量随列数变化（见 1.9.1），网格从第 `5 + side` 条开始。

**代码**：附录 A.1 的 `heroHTML()` / `bindHero()` / `renderHomeFeed()` / `loadMoreFeed()`，
样式见附录 B.2。

### 1.6.0 · 搜索预测

**接口**：建议词在 `s.search.bilibili.com`，和 `api.bilibili.com` **不同域**，所以单独开了一个 IPC 通道：

```
IPC  search:suggest(term)
GET  https://s.search.bilibili.com/main/suggest?term=…&main_ver=v1&highlight=&Suggestion_type=0
  →  result.tag[].value
```

**要点**：

- 渲染层 180ms 防抖 + `suggestSeq` 序号丢弃过期响应（慢请求不会盖掉新结果）；
- **高亮不用接口返回的 HTML**：接口给的 `name` 里带 `<em class="suggest_high_light">`，
  这里只取纯文本 `value`，自己按查询词切分再 `esc()`，命中处包 `<mark>`；
- `↑/↓` 移动选中、`Enter` 搜索、`Esc` 关闭、点击建议用 `mousedown` 阻止 blur 抢先。

**代码**：附录 A.2 + 附录 C.1（主进程）C.4（preload）。

### 1.7.0 · 搜索面板：历史 + 热搜

空输入和「有输入」是同一个面板的两种状态：

| 状态 | 内容 |
| --- | --- |
| 空输入 | 搜索历史 chips（最多 20 条，>10 条出现「展开更多」）+ bilibili 热搜两栏 1–10 |
| 有输入 | 搜索预测（1.6.0） |

**热搜接口**（同域，走现有 `api()`）：`/x/web-interface/search/square?limit=10` →
`data.trending.list[]` 的 `keyword / show_name / icon`。

**两个坑**：

1. `icon` 角标图是 `http://` 的，而 CSP 只允许 `https:` — 渲染前必须过一遍 `httpsUrl()`，
   否则角标全部加载失败；
2. 热搜结果缓存在 `state.hotSearch`，加载中显示「正在加载热搜…」，不要每次聚焦都重新请求。

**代码**：附录 A.3。

### 1.8.0 · 直播页：左播放器 + 右弹幕栏

**结构**：

```
.live-room  grid: minmax(0,1fr) 300px
  .live-main  标题 / 播放器 / 控制条 / 状态
  .live-side  弹幕头 / 弹幕列表 / 工具条（表情·屏蔽·点赞）/ 输入框 / 弹层
```

**播放器自适应**：`fitLive()` 用左栏可用宽高算 16:9 —— `h = min(availH, availW*9/16)`，
再用 `h*16/9` 回算宽度；`ResizeObserver` 跟随窗口变化。原生视图仍由 `.player-slot` 的尺寸同步。

**弹幕行**需要主进程补字段（原来只发 `user/text/color`）：

| 字段 | 来源（`DANMU_MSG.info`） | 展示 |
| --- | --- | --- |
| `level` | `info[4][0]` | 左侧等级小方块 |
| `medal.level/name/color` | `info[3][0] / [1] / [4]` | 粉丝牌（牌色描边 + 牌色等级块） |
| `guard` | `info[7]`（0/1/2/3） | 舰 / 提 / 总 徽章 |
| `color` | `info[0][3]` | 非白色时按原色显示 |
| `isAdmin` | `info[2][2]` | 预留 |

> 这些下标是抓真实弹幕（房间 5050）反推出来的，别凭猜：`info[3]` 是粉丝牌数组，
> `info[4]` 的第 0 位才是用户等级。

**三个功能**：

- **点赞**：本地计数（`liveLikes:<roomId>`）+ 上浮动效，**不上报 B 站**；
- **表情**：24 个 emoji，点击插入输入框（上限 20 字）；
- **屏蔽**（存 `liveFilter`）：关键词（同时匹配内容与用户名）、屏蔽进场、屏蔽礼物、最低用户等级，
  统一在 `pushDm()` 入口过滤。

**全屏**：`html.live-fs` 隐藏侧栏／标题／控制条／弹幕栏，`.live-frame` 铺满 100vw×100vh。

**代码**：附录 A.4（整个 `renderLiveRoom`）+ 附录 B.4（样式）+ 附录 C.2（弹幕字段）。

### 1.9.0 · 首页列数自适应

不再固定 5 列：

```js
cols = clamp(floor((w + gap) / (250 + gap)), 2, 5)   // gap = 16
```

| 内容宽度 | 列数 | 卡片宽 |
| --- | --- | --- |
| 1056（1344 小窗） | 4 | ≈252px |
| 1440（2560 最大化，限宽上限） | 5 | ≈274px |

**关键**：`.hero-row` 必须和 `.grid` 用**同一套轨道**（`repeat(cols, 1fr)` + 同间隙同内边距），
大卡靠 `grid-column: span (cols-2)` 占位。用 `3fr 1fr 1fr` 这种写法会偏 8px（fr 分配和
「等分列 + gap」不是一回事）。

### 1.9.1 · 修窄窗「空两格」

**现象**：1100 宽左右掉到 3 列，大卡独占整行后还剩 4 张侧卡，按 3 列排会折行，空出两格。

**改法**：侧卡数量跟着列数走：

| 列数 | 大卡 | 侧卡 | 网格起点 |
| --- | --- | --- | --- |
| 5 | 跨 3 列 × 2 行 | 4 张（2 列 × 2 行） | 第 10 条 |
| 4 | 跨 2 列 × 2 行 | 4 张（2 列 × 2 行） | 第 10 条 |
| 3 | 独占整行（`1 / -1`，21:9） | 3 张（一行铺满） | 第 9 条 |
| 2 | 独占整行 | 2 张 | 第 8 条 |

列数变化时用缓存的 `state.feeds.home.items` 重排一次首屏，避免残留空格。

**代码**：附录 A.1 的 `measureCols / homeSplit / syncHomeTracks / applyHomeColumns`。

### 1.10.0 · 设计风格预设

设置 → 外观下方新增「设计风格」，5 个预设，**只改卡片／圆角／字体／质感，不动布局**：

| id | 名称 | 差异 |
| --- | --- | --- |
| `classic` | 经典 | 现状（22 圆角、玻璃卡片、柔和阴影） |
| `magazine` | 杂志 | 圆角 2px、无阴影、封面下缘细线、标题衬线 |
| `minimal` | 极简 | 1px 细边框、8px 圆角、无阴影 |
| `paper` | 米纸 | 暖白卡片 `#fbf7ee` + 3px 硬阴影 |
| `neon` | 霓虹 | 深色玻璃 + 紫光描边、14px 圆角 |

实现是 `html[data-style="…"]` + CSS 覆盖，状态存 `localStorage`（`bg:style`）。

**一个坑**：`STYLE_PRESETS` 必须定义在 `PALETTE_COMMANDS` **之前** —— 命令面板里用
`...STYLE_PRESETS.map(...)` 展开它，写在后面会直接踩 TDZ 白屏。

**代码**：附录 A.5 + 附录 B.5 + 附录 C.3。

### 1.11.0 · 首页「换一批」

首页 `.view-head` 右侧加 `#feed-shuffle`（热门页不显示）。点击：

```js
st.pn = 0; st.items = []; st.done = false; st.heroBuilt = false;
if (home) st.fresh += 1;        // 让 rcmd 的 fresh_idx 往前走
feed.innerHTML = skeletons(10); // 先回骨架屏
view.scrollTo({ top: 0, behavior: 'smooth' });
await loadMoreFeed();           // 重新拉第一批（30 条），轮播/侧卡/网格一起重建
```

接口本来就带 `fresh_idx / fresh_idx_1h / brush`，序号递增 + 随机 `brush` 保证真的换一批。

**代码**：附录 A.1 的 `refreshFeed()` + 附录 B.1 样式。

### 1.11.1 · 换应用图标

**素材**：一张白底黑线的手绘小电视（1004×1004，四周留白很大）。

**处理**（`tools/make_icon.py` 新增三个开关）：

```powershell
python tools\make_icon.py 手绘稿.jpg --ink --tile
```

| 开关 | 作用 |
| --- | --- |
| `--ink` | 白底转透明：alpha = 255 − 亮度，再自动裁掉四周留白 |
| `--tile` | 垫一层圆角底板（默认白渐变 `#ffffff → #f7f8fb`）+ 细描边 |
| `--tile-colors r,g,b,r2,g2,b2` | 换底板颜色，例如 `255,157,187,251,114,153` 是粉色版 |

**为什么必须垫底板**：纯黑线 + 透明底，在 Windows 11 深色任务栏上几乎看不见（预览图里只剩
一点点边缘）。白底板自带一道 0.7% 宽的细描边，所以放在白色资源管理器背景上也不会糊成一片。

**缩放**：`--pad 0.94`（默认 0.72 是给「透明底图形」用的，垫底板后要更满）。图形在底板内占 70%。

小尺寸处理：`--tile` 模式下跳过「加粗笔画」（加粗会把底板边缘弄毛）；不加底板时才会在 ≤48px
做一次 `MaxFilter` 加粗，否则 16px 细线会糊没。

**产出**：`build/icon.png`（1024）、`build/icon.ico`（16/24/32/40/48/64/96/128/256）、
`assets/icon.*`（随包分发）、`build/icon-preview.png`（深底 + 浅底两排预览，用来验收小尺寸）。

**Mac 端**：用包里的 `files/icon/icon-1024.png` 生成 `.icns`（包内附 `tools/make-icns.sh`）：

```bash
bash tools/make-icns.sh files/icon/icon-1024.png   # → icon.icns
# 然后替换 .app/Contents/Resources/electron.icns
```

---

## 3. macOS 端移植注意

| 位置 | Windows 版的处理 | Mac 端要做什么 |
| --- | --- | --- |
| `IS_WIN` / `platform-win` | `html.classList.add('platform-win')`，据此切标题栏留白与窗口按钮 | **不要**带过去；Mac 有自己的红绿灯布局 |
| 窗口按钮 `#win-controls` | 最小化／最大化／关闭 | Mac 版不存在，相关 CSS 全在 `.platform-win` 下 |
| `USER_AGENT` | `main.js` 里按平台二选一串 User-Agent | 保留 Mac 串即可，1.6 的新接口用同一个常量 |
| `session.fromPartition(PARTITION)` | `persist:bili` | 与 Mac 一致即可；`search:suggest` 复用了它 |
| 更新包 | `.exe` | 见 1.3.0 那条：清单按平台分流，或另发一份 mac 清单 |
| 全屏快捷键 | `F11` + 播放器内全屏 | Mac 用 `Ctrl+Cmd+F`；`live-fs` 类名可以照抄 |
| 路径分隔符 | `path.join` 为主，个别地方硬编码 `\\` | 同步代码时留意 `docs/使用说明.txt` 这类资源路径 |

其余（首页、搜索、直播、设计风格）都是纯渲染层 + 普通 HTTP，两边可以逐字一致。

## 4. 同步后的自检

按这个顺序跑，每步都应该 0 失败：

```bash
node --check renderer/app.js && node --check main.js && node --check preload.js
# 逐条打开应用看：
#   1) 首页：大卡 + 侧卡 + 网格，拖窗口跨 1440 / 1100 两个临界点，列数 5→4→3 且不留空格
#   2) 搜索：点开有历史 + 热搜；输入「毕生」出联想且命中标红；↑↓ + Enter 能搜
#   3) 直播：左播放器右弹幕，弹幕带等级/粉丝牌；点赞计数+1；表情能插入；屏蔽关键词能拦住
#   4) 设置 → 设计风格：5 个预设逐个点，卡片外观变化但布局不动
#   5) 首页「换一批」：内容整批换新，轮播重建为 5 张
```

自动化探针（照搬到 Mac 的 `tools/` 下，改掉 `ROOT` 即可）：

| 脚本 | 覆盖 | 项目数 |
| --- | --- | --- |
| `probe-home.js` | 首页混排／列数／对齐／换一批 | 22 |
| `probe-suggest.js` | 搜索联想／历史／热搜 | 9 |
| `probe-live-room.js` | 直播两栏／徽章／点赞／表情／屏蔽 | 17 |
| `probe-styles.js` | 设计风格 5 个预设 | 13 |
| `probe-main.js` | 全站冒烟 | 12 |

---

## 附录 A · `renderer/app.js` 新增／重写的函数

> 从 1.11.0 源码原样抽出，可直接整段替换同名函数。

### A.1 首页：混排 / 列数自适应 / 换一批

**`renderFeed()`** — 视图骨架 + 「换一批」按钮（1.11.0）

```js
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
```

**`refreshFeed()`** — 换一批（1.11.0）

```js
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
```

**`heroHTML()`** — 大轮播标记（1.5.0，1.9.1 改 span 逻辑）

```js
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
```

**`bindHero()`** — 轮播交互（1.5.0）

```js
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
```

**`measureCols()`** — 列数计算（1.9.0）

```js
function measureCols(el) {
  const w = (el && (el.clientWidth || el.getBoundingClientRect().width)) || 0;
  if (!w) return 4;
  const gap = 16;
  const min = 250;
  return Math.max(2, Math.min(5, Math.floor((w + gap) / (min + gap))));
}
```

**`homeSplit()`** — 大卡跨度与侧卡数量（1.9.1）

```js
function homeSplit(cols) {
  // 5 列：大卡跨 3 + 右侧 2 列 × 2 行 = 4 张
  if (cols >= 5) return { heroSpan: 3, side: 4, fullWidth: false };
  // 4 列：大卡跨 2 + 右侧 2 列 × 2 行 = 4 张
  if (cols === 4) return { heroSpan: 2, side: 4, fullWidth: false };
  // 3 列及以下：大卡独占一行，侧卡正好铺满一行（3 列 3 张 / 2 列 2 张）
  return { heroSpan: cols, side: cols, fullWidth: true };
}
```

**`syncHomeTracks()`** — 同步轨道（1.9.0）

```js
function syncHomeTracks(cols) {
  const grid = document.getElementById('feed-grid');
  if (grid) grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  const heroRow = document.querySelector('.hero-row');
  if (heroRow) heroRow.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
}
```

**`applyHomeColumns()`** — 应用列数（1.9.0）

```js
function applyHomeColumns() {
  const grid = document.getElementById('feed-grid');
  if (!grid) return;
  syncHomeTracks(measureCols(grid));
}
```

**`renderHomeFeed()`** — 首页渲染（1.5.0 起，最终版）

```js
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
```

**`loadMoreFeed()`** — 加载更多（含 home 分支）

```js
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
```

### A.2 搜索预测（1.6.0）

**`ensureSearchPanel()`** — 面板容器 + 定位

```js
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
```

**`highlightTerm()`** — 自己拼高亮（不信任接口 HTML）

```js
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
```

**`paintSuggestIndex()`** — 键盘选中态

```js
function paintSuggestIndex() {
  const box = document.getElementById('search-hist');
  if (!box) return;
  box.querySelectorAll('.sug-item').forEach((el, i) => el.classList.toggle('on', i === suggestIndex));
}
```

**`renderSuggestions()`** — 渲染联想列表

```js
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
```

**`showSearchHistory()`** — 聚焦时决定显示哪种面板

```js
function showSearchHistory() {
  const q = $('search-input').value.trim();
  if (q) { renderSuggestions(q); return; }
  suggestItems = [];
  suggestIndex = -1;
  renderRecentSearches();
}
```

**`loadSuggest()`** — 带序号的请求

```js
async function loadSuggest(term) {
  const seq = ++suggestSeq;
  const r = await bridge.suggest(term).catch(() => null);
  if (seq !== suggestSeq) return;
  suggestItems = (r && r.ok && Array.isArray(r.list)) ? r.list : [];
  suggestIndex = -1;
  const q = $('search-input').value.trim();
  if (q) renderSuggestions(q);
}
```

### A.3 搜索历史 + 热搜（1.7.0）

**`hotSearchHTML()`** — 热搜两栏 HTML

```js
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
```

**`loadHotSearch()`** — 拉一次并缓存

```js
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
```

**`renderRecentSearches()`** — 历史 chips + 热搜 + 展开/清空

```js
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
```

**`bindEvents()` 里对应的输入／键盘绑定：**

```js
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
```

### A.4 直播页（1.8.0）

**`renderLiveRoom()`** — 整个函数替换（两栏布局 + 弹幕徽章 + 点赞／表情／屏蔽 + 全屏适配）

```js
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
```

### A.5 设计风格（1.10.0）

**`STYLE_PRESETS`**（必须定义在 `PALETTE_COMMANDS` 之前）

```js
const STYLE_PRESETS = [
  { id: 'classic', name: '经典', desc: '柔和玻璃 + 22 圆角' },
  { id: 'magazine', name: '杂志', desc: '衬线标题 · 方正封面 · 细线' },
  { id: 'minimal', name: '极简', desc: '细边框 · 小圆角 · 无阴影' },
  { id: 'paper', name: '米纸', desc: '暖白底 · 硬阴影 · 印刷感' },
  { id: 'neon', name: '霓虹', desc: '深色玻璃 · 发光描边' },
];
```

**`applyStyle()`** — 应用 + 记忆

```js
function applyStyle(id) {
  const valid = STYLE_PRESETS.some((x) => x.id === id) ? id : 'classic';
  state.style = valid;
  store.set('style', valid);
  document.documentElement.dataset.style = valid;
  document.querySelectorAll('#style-presets .style-card').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === valid);
  });
}
```

**`renderStylePresets()`** — 设置里的 5 张预设卡

```js
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
```

---

## 附录 B · `renderer/style.css` 新增块

> B.0 是 1.4.0 的**替换块**（卡片区），其余 5 块是**新增**的，整段追加即可。

### B.0 卡片区（1.4.0 改后整块，可直接替换）

> 这一段是**替换**不是追加：`.grid` / 内容限宽 / `.card` / `.cover` / 角标 / 标题 / 副信息 /
> `.card-remove` 都在里面。变量 `--grid-min: 240px`、`--content-max: 1440px`、
> `--r-card: 22px` 要同时在 `:root` 里补上。

```css
/* ---------- 卡片 ---------- */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min), 1fr));
  gap: var(--grid-gap);
  padding: 2px 2px 6px;
}

/* 内容区限宽：大屏不会铺成一整墙小卡片（1920 → 6 列，2560 也是 6 列） */
.view > .view-head,
.view > #feed,
.view > .section-title {
  width: 100%;
  max-width: var(--content-max);
  margin-left: auto;
  margin-right: auto;
}


.card {
  position: relative;
  isolation: isolate;
  padding: 0;
  border: 0;
  border-radius: var(--r-card);
  cursor: pointer;
  overflow: hidden;
  background: var(--card);
  box-shadow: 0 16px 32px -20px rgba(16, 24, 40, .5), 0 3px 8px -5px rgba(16, 24, 40, .2), var(--edge-light);
  transition: transform .22s var(--ease), box-shadow .22s var(--ease);
}
.card:hover {
  transform: translateY(-3px);
  box-shadow: 0 30px 56px -24px rgba(16, 24, 40, .58), 0 8px 18px -8px rgba(16, 24, 40, .28), var(--edge-light);
}
.card:active { transform: translateY(-1px) scale(.995); }

.cover {
  position: relative; border-radius: var(--r-md); overflow: hidden;
  aspect-ratio: 16 / 9;
  background: color-mix(in srgb, var(--text) 7%, transparent);
}
.card .cover { border-radius: var(--r-card) var(--r-card) 0 0; }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s var(--ease-out); }
.card:hover .cover img { transform: scale(1.045); }
.cover::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, .22) 46%, transparent 62%);
  transform: translateX(-120%); transition: transform .7s var(--ease-out);
}
.card:hover .cover::after { transform: translateX(120%); }

.cover .dur {
  position: absolute; right: 8px; bottom: 8px;
  padding: 1px 6px; border-radius: 6px;
  font-size: 10.5px; font-weight: 600; color: #fff;
  background: rgba(8, 10, 14, .62); backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
}
.cover .play {
  position: absolute; left: 8px; bottom: 8px;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 6px; border-radius: 6px;
  font-size: 10.5px; color: #fff; background: rgba(8, 10, 14, .55);
  backdrop-filter: blur(6px);
}
.rank-no {
  position: absolute; top: 8px; left: 8px;
  min-width: 22px; height: 21px; padding: 0 6px;
  border-radius: 7px; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 750; color: #fff;
  background: rgba(8, 10, 14, .52); backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
}
.grid > .card:nth-child(1) .rank-no { background: linear-gradient(135deg, #f7b733, #fc4a1a); }
.score {
  position: absolute; right: 6px; top: 6px;
  padding: 1px 7px; border-radius: 7px;
  font-size: 11px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 4px 12px -4px var(--accent-ring);
}
.progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(0, 0, 0, .34); }
.progress i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.live-badge {
  position: absolute; left: 6px; top: 6px;
  padding: 1px 7px; border-radius: 7px;
  font-size: 10.5px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 4px 12px -4px var(--accent-ring);
}

.card .title {
  margin: 10px 12px 0;
  font-size: 12.8px; font-weight: 600; line-height: 1.45; letter-spacing: -.005em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; min-height: 2.9em;
}
.card .sub { margin: 6px 12px 11px; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); }
.card .sub .dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .45; }

.card-wrap { position: relative; }
.card-remove {
  position: absolute; right: 12px; top: 12px; z-index: 3;
  padding: 5px 10px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .18);
  background: rgba(14, 16, 22, .62); color: #fff;
  font-size: 11px; font-weight: 550; cursor: pointer;
  opacity: 0; transform: translateY(-2px);
  backdrop-filter: blur(10px);
  transition: opacity .16s, transform .16s, background .16s;
}
.card-wrap:hover .card-remove { opacity: 1; transform: none; }
.card-remove:hover { background: rgba(220, 60, 66, .9); }
```

### B.1 「换一批」按钮（1.11.0）

```css
/* 首页 / 热门 视图右上角「换一批」 */
.feed-shuffle {
  display: inline-flex; align-items: center; gap: 5px;
  align-self: center; flex: 0 0 auto;
}
.feed-shuffle svg { width: 13px; height: 13px; opacity: .75; }
.feed-shuffle:hover svg { opacity: 1; }
.feed-shuffle.busy { pointer-events: none; opacity: .7; }
.feed-shuffle.busy svg { animation: shuffle-spin .8s linear infinite; }
@keyframes shuffle-spin { to { transform: rotate(360deg); } }

.view-head { display: flex; align-items: baseline; gap: 10px; margin: 6px 6px 16px; }
.view-title {
  font-size: 21px; font-weight: 750; letter-spacing: -.02em;
  background: linear-gradient(120deg, var(--text) 20%, color-mix(in srgb, var(--text) 84%, var(--accent)) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.view-sub { font-size: 12px; color: var(--dim); }
.view-head .spacer { flex: 1; }

.section-title {
  display: flex; align-items: center; gap: 6px;
  margin: 22px 6px 12px;
  font-size: 14px; font-weight: 700; letter-spacing: -.01em;
}
.count { font-size: 11.5px; font-weight: 500; color: var(--dim); margin-left: 4px; }
```

### B.2 首页顶部混排：大轮播 + 侧卡（1.5.0 / 1.9.0 / 1.9.1）

```css
/* ---------- 首页顶部：大轮播 + 4 小卡（大小混排，只在首屏） ----------
   列轨道与 .grid 完全一致（repeat(N,1fr) + 同间隙同内边距），
   大卡用 grid-column: span M 占位，保证和下面网格逐列对齐。 */
.hero-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--grid-gap);
  padding: 2px 2px 6px;
  margin: 0 0 10px;
  align-items: stretch;
}
.hero {
  position: relative;
  grid-column: span 3;
  grid-row: span 2;
  min-height: 200px;
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--card);
  box-shadow: 0 16px 32px -20px rgba(16, 24, 40, .5), 0 3px 8px -5px rgba(16, 24, 40, .2), var(--edge-light);
  cursor: pointer;
  isolation: isolate;
}
.hero-slide {
  position: absolute; inset: 0;
  opacity: 0; transition: opacity .55s var(--ease);
  pointer-events: none;
}
.hero-slide.on { opacity: 1; pointer-events: auto; }
.hero-slide img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-veil {
  position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(10, 12, 18, .92) 0%, rgba(10, 12, 18, .72) 26%, rgba(10, 12, 18, .18) 52%, transparent 74%);
}
.hero-cap { position: absolute; left: 20px; right: 20px; bottom: 34px; color: #fff; }
.hero-cap h2 {
  margin: 0 0 5px; font-size: 19px; line-height: 1.38; font-weight: 700; letter-spacing: -.01em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  text-shadow: 0 1px 12px rgba(0, 0, 0, .45);
}
.hero-meta { font-size: 11.5px; opacity: .82; }
.hero-dots {
  position: absolute; left: 50%; bottom: 13px; transform: translateX(-50%);
  display: flex; gap: 6px; z-index: 3;
}
.hero-dots i {
  width: 6px; height: 6px; border-radius: 99px; background: rgba(255, 255, 255, .45);
  cursor: pointer; transition: width .22s var(--ease), background .22s;
}
.hero-dots i.on { width: 16px; background: #fff; }
.hero-nav {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 3;
  width: 32px; height: 32px; border: 0; border-radius: 50%;
  background: rgba(12, 14, 20, .48); color: #fff; font-size: 18px; line-height: 1;
  display: grid; place-items: center; cursor: pointer;
  opacity: 0; transition: opacity .2s, background .2s;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.hero:hover .hero-nav { opacity: 1; }
.hero-nav:hover { background: rgba(12, 14, 20, .72); }
.hero-nav.prev { left: 12px; }
.hero-nav.next { right: 12px; }

/* 首页列数由 JS 按可用宽度算（小窗 4 列 / 全屏 5 列），这里是 JS 未生效时的兜底 */
.grid.home-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 980px) {
  .grid.home-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) { .grid.home-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

### B.3 搜索面板：联想 / 历史 / 热搜（1.6.0 / 1.7.0）

```css
/* 搜索预测 */
.sh-tip { font-size: 10px; color: var(--faint); letter-spacing: .02em; }

/* 搜索历史 chips */
.sh-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 7px 8px; }
.sh-chip {
  max-width: 100%; padding: 5px 10px; border-radius: 8px;
  border: 1px solid var(--hairline); background: var(--glass-flat);
  color: var(--text-soft); font-size: 11.5px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background .15s, color .15s, border-color .15s;
}
.sh-chip:hover { background: var(--accent-soft); color: var(--accent-ink); border-color: transparent; }
.sh-more {
  display: block; margin: 0 auto 6px; padding: 3px 10px;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--faint); font-size: 11px; cursor: pointer;
}
.sh-more:hover { color: var(--accent); }
.sh-head-hot { margin-top: 8px; }

/* bilibili 热搜：两栏 */
.sh-hot { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; padding: 0 3px 4px; }
.sh-hot-col { display: flex; flex-direction: column; min-width: 0; }
.sh-hot-item {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 5px; border: 0; border-radius: 7px;
  background: transparent; color: var(--text); font-size: 11.5px;
  cursor: pointer; text-align: left;
}
.sh-hot-item:hover { background: var(--hover); }
.hs-rank {
  width: 13px; flex: 0 0 auto; text-align: center;
  font-size: 11px; font-weight: 700; color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.hs-rank.top { color: var(--accent); }
.hs-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs-badge { height: 13px; width: auto; flex: 0 0 auto; border-radius: 3px; }
.sh-hot-skel { grid-column: 1 / -1; padding: 12px; text-align: center; font-size: 11px; color: var(--faint); }
.sug-item { display: flex; align-items: center; gap: 8px; }
.sug-item.on { background: var(--accent-soft); color: var(--accent-ink); }
.sh-item mark, .sug-item mark {
  background: transparent; color: var(--accent); font-weight: 700;
}

.picker-overlay {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(10, 12, 18, .3);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  animation: fade .18s var(--ease);
}
.picker {
  width: min(440px, calc(100vw - 80px)); max-height: 72vh;
  display: flex; flex-direction: column; gap: 10px;
  padding: 15px; border-radius: var(--r-xl);
  animation: pop .2s var(--ease-out);
}
.picker-head { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; font-weight: 700; }
.picker-close { height: 28px; padding: 0 12px; font-size: 11.5px; }
.picker-search {
  width: 100%; height: 34px; padding: 0 12px;
  border-radius: 10px; border: 1px solid var(--hairline);
  background: var(--glass-flat); color: var(--text); font-size: 12.5px; outline: none;
}
.picker-search:focus { border-color: color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: 0 0 0 3px var(--accent-ring); }
.picker-list { overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.picker-row {
  display: flex; align-items: center; gap: 11px;
  padding: 8px 9px; border: none; border-radius: 10px;
  background: transparent; color: var(--text); cursor: pointer; text-align: left;
}
.picker-row:hover { background: var(--hover); }
.picker-face { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex: 0 0 auto; }
.picker-name { font-size: 12.5px; font-weight: 550; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-go { font-size: 10.5px; color: var(--accent); opacity: 0; transition: opacity .15s; }
.picker-row:hover .picker-go { opacity: 1; }
```

### B.4 直播页两栏（1.8.0）

```css
/* ================= 直播页：左播放器 + 右侧弹幕栏 ================= */
.live-room {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding-bottom: 8px;
}
.live-main { display: flex; flex-direction: column; gap: 9px; min-width: 0; min-height: 0; }
.live-head { display: flex; align-items: baseline; gap: 9px; padding: 2px 2px 0; min-width: 0; }
.live-title {
  font-size: 15px; font-weight: 700; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 62%;
}
.live-sub { font-size: 11.5px; color: var(--dim); }
.live-head .spacer { flex: 1; }
.live-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.live-frame {
  width: 100%; aspect-ratio: 16 / 9; border-radius: var(--r-lg); overflow: hidden;
  background: #000; border: 1px solid var(--card-border);
  box-shadow: 0 18px 40px -24px rgba(16, 24, 40, .5), var(--edge-light);
}
.live-status { font-size: 11.5px; color: var(--dim); padding: 0 2px; min-height: 15px; }

.live-side {
  position: relative;
  display: flex; flex-direction: column; gap: 8px; min-height: 0;
  border-radius: var(--r-lg); padding: 10px;
  background: var(--card); border: 1px solid var(--card-border);
  box-shadow: 0 18px 40px -24px rgba(16, 24, 40, .4), var(--edge-light);
}
.ls-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--text); }
.ls-tab.on { color: var(--accent); }
.ls-online { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--faint); }
.ls-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 5px; padding-right: 4px;
  scrollbar-width: thin;
}
.ls-list::-webkit-scrollbar { width: 7px; }
.ls-list::-webkit-scrollbar-thumb { background: rgba(140, 150, 170, .28); border-radius: 99px; border: 2px solid transparent; background-clip: content-box; }
.ls-row { font-size: 12px; line-height: 1.5; color: var(--text); word-break: break-word; }
.ls-row.sys, .ls-row.gift { color: var(--faint); font-size: 11.5px; }
.ls-lv {
  display: inline-grid; place-items: center; min-width: 16px; height: 15px; padding: 0 3px; margin-right: 4px;
  border-radius: 4px; background: var(--glass-flat); border: 1px solid var(--hairline);
  font-size: 9.5px; font-weight: 700; color: var(--dim); vertical-align: 1px;
}
.ls-medal {
  display: inline-flex; align-items: center; margin-right: 4px; padding-left: 3px;
  border-radius: 4px; overflow: hidden; border: 1px solid var(--mc, var(--accent));
  color: var(--mc, var(--accent)); font-size: 9.5px; line-height: 1; vertical-align: 1px;
}
.ls-medal b { margin-left: 3px; padding: 2px 3px; background: var(--mc, var(--accent)); color: #fff; font-weight: 700; }
.ls-guard {
  display: inline-block; margin-right: 4px; padding: 1px 3px; border-radius: 3px;
  font-size: 9px; font-weight: 700; color: #fff; background: #7c5cff; vertical-align: 1px;
}
.ls-guard.g1 { background: #2ac0ff; }
.ls-guard.g2 { background: #ff7ac0; }
.ls-guard.g3 { background: #ffb020; }
.ls-user { color: var(--dim); margin-right: 2px; }
.ls-text { color: var(--text); }

.ls-tools { display: flex; align-items: center; gap: 6px; padding-top: 7px; border-top: 1px solid var(--hairline); }
.ls-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px;
  border-radius: 7px; border: 1px solid var(--hairline); background: var(--glass-flat);
  color: var(--dim); font-size: 11.5px; cursor: pointer; position: relative; font-family: inherit;
}
.ls-btn:hover { color: var(--accent); border-color: var(--accent-ring); }
.ls-like { margin-left: auto; color: var(--accent); border-color: var(--accent-ring); }
.ls-like svg { width: 13px; height: 13px; }
.ls-heart {
  position: absolute; right: 8px; top: -2px; font-size: 12px; pointer-events: none;
  animation: lsHeart .9s var(--ease-out) forwards;
}
@keyframes lsHeart {
  0% { opacity: 1; transform: translateY(0) scale(.8); }
  100% { opacity: 0; transform: translateY(-26px) scale(1.15); }
}
.ls-input { display: flex; gap: 6px; }
.ls-input input {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--hairline); background: var(--glass-flat); color: var(--text);
  font-size: 12px; font-family: inherit;
}
.ls-input input:focus { outline: none; border-color: var(--accent-ring); }
.ls-send {
  height: 30px; padding: 0 14px; border-radius: 8px; border: 0; cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
  font-size: 12px; font-weight: 700; font-family: inherit;
}
.ls-send:disabled { opacity: .6; cursor: default; }

.ls-pop {
  position: absolute; left: 10px; right: 10px; bottom: 78px; z-index: 6;
  background: var(--glass-strong); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
  border: 1px solid var(--stroke); border-radius: var(--r-md);
  box-shadow: var(--shadow-lift), var(--edge-light); padding: 10px;
}
.ls-pop[hidden] { display: none; }
.ls-pop-head { font-size: 11.5px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.ls-emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; }
.ls-emoji { border: 0; background: transparent; font-size: 16px; line-height: 1; padding: 4px 0; border-radius: 6px; cursor: pointer; }
.ls-emoji:hover { background: var(--hover); }
.ls-pop-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dim); margin: 7px 0; }
.ls-words { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 7px; }
.ls-word {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 6px;
  background: var(--accent-soft); color: var(--accent-ink); font-size: 11px;
}
.ls-word b { cursor: pointer; font-weight: 700; opacity: .65; }
.ls-word b:hover { opacity: 1; }
.ls-word-empty { font-size: 11px; color: var(--faint); }
.ls-word-input, .ls-level-input {
  height: 26px; border-radius: 7px; border: 1px solid var(--hairline);
  background: var(--glass-flat); color: var(--text); font-size: 11.5px; padding: 0 8px; font-family: inherit;
}
.ls-word-input { width: 100%; }
.ls-level-input { width: 56px; margin-left: auto; }

@media (max-width: 980px) {
  .live-room { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .live-side { min-height: 180px; }
}
```

### B.5 设计风格预设（1.10.0）

```css
/* ================= 设计风格预设（设置 → 设计风格） ================= */

/* --- 杂志：衬线标题、方正封面、细线分隔、去阴影 --- */
html[data-style="magazine"] { --r-card: 2px; --r-lg: 6px; --r-md: 6px; }
html[data-style="magazine"] .card,
html[data-style="magazine"] .rail-card {
  background: transparent;
  border: 0;
  border-radius: 2px;
  box-shadow: none;
}
html[data-style="magazine"] .card .cover { border-radius: 2px; }
html[data-style="magazine"] .card .cover::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
  background: rgba(20, 20, 24, .26);
}
html[data-style="magazine"] .card .title {
  margin: 9px 2px 0;
  font-family: Georgia, "Times New Roman", "Songti SC", "Source Han Serif SC", "Noto Serif SC", serif;
  font-size: 14.5px; line-height: 1.42; font-weight: 600; letter-spacing: 0;
}
html[data-style="magazine"] .card .sub {
  margin: 5px 2px 12px; font-size: 10.5px; letter-spacing: .06em;
}
html[data-style="magazine"] .card:hover { transform: none; }
html[data-style="magazine"] .card:hover .cover img { transform: scale(1.015); }
html[data-style="magazine"] .hero { border-radius: 2px; box-shadow: none; }
html[data-style="magazine"] .hero-cap h2,
html[data-style="magazine"] .view-title {
  font-family: Georgia, "Songti SC", "Source Han Serif SC", "Noto Serif SC", serif;
}
html[data-style="magazine"] .hero-cap h2 { font-size: 24px; line-height: 1.3; }

/* --- 极简：细边框、小圆角、无阴影 --- */
html[data-style="minimal"] { --r-card: 8px; --r-lg: 10px; }
html[data-style="minimal"] .card,
html[data-style="minimal"] .rail-card {
  background: var(--card);
  border: 1px solid var(--hairline);
  box-shadow: none;
}
html[data-style="minimal"] .card .cover { border-radius: 7px 7px 0 0; }
html[data-style="minimal"] .card:hover {
  transform: none;
  border-color: var(--accent-ring);
  box-shadow: 0 0 0 1px var(--accent-ring);
}
html[data-style="minimal"] .hero {
  border-radius: 10px; box-shadow: none; border: 1px solid var(--hairline);
}

/* --- 米纸：暖白卡片 + 硬阴影，印刷感 --- */
html[data-style="paper"] { --r-card: 3px; }
html[data-style="paper"] .card,
html[data-style="paper"] .rail-card {
  background: #fbf7ee;
  border: 1px solid #e5dcc7;
  box-shadow: 3px 3px 0 rgba(120, 104, 72, .22);
}
html[data-style="paper"] .card .title { color: #2e2a22; font-weight: 650; }
html[data-style="paper"] .card .sub { color: #8a7f6a; }
html[data-style="paper"] .card:hover {
  transform: translate(-1px, -1px);
  box-shadow: 5px 5px 0 rgba(120, 104, 72, .26);
}
html[data-style="paper"] .hero { border-radius: 3px; box-shadow: 4px 4px 0 rgba(120, 104, 72, .22); }

/* --- 霓虹：深色玻璃 + 发光描边 --- */
html[data-style="neon"] { --r-card: 14px; }
html[data-style="neon"] .card,
html[data-style="neon"] .rail-card {
  background: rgba(18, 14, 38, .78);
  border: 1px solid rgba(168, 85, 247, .34);
  box-shadow: 0 0 0 1px rgba(168, 85, 247, .1), 0 18px 44px -24px rgba(126, 34, 206, .7);
}
html[data-style="neon"] .card .title { color: #ece7ff; }
html[data-style="neon"] .card .sub { color: #a79ed6; }
html[data-style="neon"] .card:hover {
  border-color: rgba(190, 120, 255, .78);
  box-shadow: 0 0 20px -2px rgba(168, 85, 247, .5), 0 24px 52px -24px rgba(126, 34, 206, .8);
}
html[data-style="neon"] .hero { border-radius: 14px; box-shadow: 0 0 26px -6px rgba(168, 85, 247, .55); }

/* --- 设置里的预设卡 --- */
.style-presets {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px; padding: 4px 2px 2px;
}
.style-card {
  display: block; padding: 0; overflow: hidden; cursor: pointer; text-align: left;
  border: 1px solid var(--hairline); border-radius: 10px; background: var(--glass-flat);
  transition: border-color .15s var(--ease), box-shadow .15s var(--ease);
}
.style-card:hover { border-color: var(--accent-ring); }
.style-card.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.sp-prev { display: block; padding: 10px 10px 8px; }
.sp-prev i {
  display: block; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #ffd8e4, #ffb3c8);
}
.sp-prev b { display: block; height: 5px; margin-top: 6px; width: 82%; border-radius: 3px; background: currentColor; opacity: .45; }
.sp-prev em { display: block; height: 4px; margin-top: 4px; width: 52%; border-radius: 2px; background: currentColor; opacity: .26; }
.sp-name { display: block; padding: 0 10px 9px; font-size: 11.5px; color: var(--text); }
.sp-classic i { box-shadow: 0 8px 14px -8px rgba(16, 24, 40, .5); }
.sp-magazine i { border-radius: 1px; }
.sp-magazine b { width: 88%; height: 6px; opacity: .7; }
.sp-magazine .sp-name { font-family: Georgia, "Songti SC", serif; }
.sp-minimal i {
  border-radius: 5px; background: linear-gradient(135deg, #eef1f7, #e2e8f2);
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.sp-minimal b, .sp-minimal em { opacity: .28; }
.sp-paper i {
  border-radius: 2px; background: linear-gradient(135deg, #fdf8ec, #f2e9d6);
  box-shadow: 3px 3px 0 rgba(120, 104, 72, .22);
}
.sp-neon i {
  border-radius: 10px; background: linear-gradient(135deg, #2a1a4d, #472080);
  box-shadow: 0 0 14px -2px rgba(168, 85, 247, .75);
}
.set-note { color: var(--faint); font-size: 11px; }
```

---

## 附录 C · 主进程 / preload / HTML 片段

### C.1 `main.js`：搜索联想通道（1.6.0）

```js
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
```

### C.2 `main.js`：弹幕字段补全（1.8.0）

把 `DANMU_MSG` 分支改成（同时把 `live-danmaku` 的 payload 换成带等级/粉丝牌的版本）：

```js
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
```

### C.3 `renderer/index.html`：设置里的「设计风格」区块（1.10.0）

插在「外观」那个 `<section>` 之后：

```html
        <section class="set-section">
          <h3>设计风格</h3>
          <div class="style-presets" id="style-presets"></div>
          <div class="row set-note">只改卡片、圆角、字体与质感，不动布局；点一下立即生效。</div>
        </section>
```

### C.4 `preload.js`：暴露 suggest（1.6.0）

```js
  suggest: (term) => ipcRenderer.invoke('search:suggest', term),
```

### C.5 零散改动（容易漏）

```js
// ① state 里补字段
  hotSearch: null,
  histExpanded: false,
  style: store.get('style', 'classic'),

// ② render() 切路由时的清理（漏了会导致离开首页后轮播还在跑 / 观察器泄漏）
  if (state.heroTimer) { clearInterval(state.heroTimer); state.heroTimer = null; }
  if (state.homeColObserver) { state.homeColObserver.disconnect(); state.homeColObserver = null; }

// ③ 搜索历史从 8 条放宽到 20 条（「展开更多」才有意义）
  store.set('recentSearch', [q, ...recent.filter((x) => x !== q)].slice(0, 20));

// ④ 启动时应用设计风格（紧跟在 applyTheme() 之后）
  applyStyle(state.style);

// ⑤ 命令面板里加 5 条设计风格命令（放在 PALETTE_COMMANDS 数组里）
  ...STYLE_PRESETS.map((p) => ({
    id: `style-${p.id}`, icon: 'theme', label: `设计风格：${p.name}`, hint: p.desc, run: () => applyStyle(p.id),
  })),
```

---

## 附：版本号与产物的对应关系

| 版本 | 产物 |
| --- | --- |
| 1.11.1 | `BiliFound-1.11.1-Setup-x64.exe` / `-Portable-x64.exe` / `-win32-x64.zip` |

（更早版本的产物已清理，只保留当前版；历史信息以 `docs/TECHNICAL.md` 的「版本记录」为准。）



---

## 附录 D · 文件指纹（同步后核对用）

> 这是 **1.11.1** 各文件的 sha256。你在 Mac 上合并完，如果代码完全一致，
> 这几个值应该能对上（`style.css` 若还保留了 Mac 独有的规则则不会完全一致，属正常）。

| 文件 | 用途 | 大小 | SHA256 |
| --- | --- | --- | --- |
| `renderer/app.js` | 渲染层全部逻辑 | 252,673 B | `46daee02dc8581db094af9e6f65af5f3b26c105822d127455f7e5f92de3bbc71` |
| `renderer/style.css` | 样式 | 115,109 B | `0f12a15843787d996b300f37a98949891fc82688278d54ccedc75a0c47ab153f` |
| `renderer/index.html` | 设置面板新增区块 | 14,695 B | `740aeae8618f31ca2c43ad9829caaff74c9bb1849b1d647eb30abbda1dee1c7a` |
| `renderer/player.html` | 播放器滚轮转发（1.1.0） | 14,415 B | `f0f6e77cd82e4fa63646cf19c4e3038f9363fb208faf9f5919f8ab3114b97505` |
| `main.js` | search:suggest / 弹幕字段 / player:wheel | 95,767 B | `c59b95b62e0ecad9d33544abd9ba2d7598b86eab06212d59be37f723c22f95b2` |
| `preload.js` | suggest 桥 | 5,604 B | `2154b9bf51652fbfe537445524141a68ba979d9cc50c391118424361f66eaef0` |
| `player-preload.js` | wheel 桥（1.1.0） | 292 B | `d4db9df16c734845bdebb38a1a5f3b66c54881ba5e680a8a80a155765d2e2d0f` |
| `build/icon.png` | 应用图标 1024（1.11.1） | 215,181 B | `68d5f0d09786a0012dcd41afb0758b2a7703fa9e1bcadedb2ec840bce355ea2b` |

核对命令：

```bash
shasum -a 256 renderer/app.js renderer/style.css renderer/index.html main.js preload.js
```

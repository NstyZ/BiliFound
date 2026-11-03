# BiliFound 技术文档（Windows 版）

> 版本：**1.11.0**　|　平台：Windows 10 1809+ / Windows 11（x64）　|　最后更新：2026-10-27
>
> BiliFound 是一个基于 Electron 的哔哩哔哩桌面客户端：界面**全部自绘**（不使用网页 DOM 套壳），
> 视频/直播为**原生视图 + 自建播放器**，网络请求全部由主进程携带登录态发起。
> 本文档描述 **Windows 移植版**；与 macOS 原版的差异集中列在第 22 节。

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [目录结构](#3-目录结构)
4. [进程与视图架构](#4-进程与视图架构)
5. [网络层](#5-网络层)
6. [登录与凭证](#6-登录与凭证)
7. [视频播放链路](#7-视频播放链路)
8. [直播链路](#8-直播链路)
9. [动态](#9-动态)
10. [评论](#10-评论)
11. [私信](#11-私信)
12. [专栏](#12-专栏)
13. [其它业务模块](#13-其它业务模块)
14. [界面与设计系统](#14-界面与设计系统)
15. [IPC 接口清单](#15-ipc-接口清单)
16. [preload 暴露的 API](#16-preload-暴露的-api)
17. [本地存储](#17-本地存储)
18. [构建与打包](#18-构建与打包)
19. [测试体系](#19-测试体系)
20. [已知限制与平台注意事项](#20-已知限制与平台注意事项)
21. [故障排查](#21-故障排查)
22. [macOS → Windows 移植差异表](#22-macos--windows-移植差异表)

---

## 1. 项目概览

| 项目 | 说明 |
| --- | --- |
| 产品名 | BiliFound |
| 版本 | 1.11.0 |
| 平台 | Windows 10 1809+ / Windows 11，x64 |
| AppUserModelId | `com.styzn.bilifound` |
| 安装形态 | ① 安装版 `BiliFound-1.11.0-Setup-x64.exe`（NSIS，快捷方式 + 卸载程序）<br>② 便携版 `BiliFound-1.11.0-Portable-x64.exe`（单文件，自解压到临时目录）<br>③ 绿色包 `BiliFound-1.11.0-win32-x64.zip`（解压即用） |
| 程序位置 | 安装/解压目录下 `BiliFound.exe`（工程内为 `dist-installer\win-unpacked\` 与 `dist\BiliFound-win32-x64\`） |
| 源码位置 | `E:\ai\杂\Za New\BiliFound\BiliFound-win` |
| 界面形态 | 自绘 HTML/CSS/JS 单页应用（非网页套壳） |
| 视频/直播 | `WebContentsView` 原生视图 + 自建播放器（DASH / HLS） |
| 登录态 | 持久化分区 `persist:bili`，与网页版共享 Cookie 语义 |
| 主题 | 液态玻璃（Liquid Glass），浅色/深色/跟随系统、自定义背景 |

**设计目标**

1. **网页版功能对等**：视频、直播、番剧、影视、动态、评论、私信、专栏、搜索、收藏、历史、稍后再看、关注/粉丝。
2. **原生观感**：自绘界面 + 无边框自绘标题栏 + 原生全屏，避免"网页套壳"的割裂感。
3. **视觉统一**：一套设计令牌驱动全部页面，液态玻璃质感贯穿始终。

---

## 2. 技术栈与依赖

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Electron `38.8.6`（Chromium 140 / Node 22） | 主进程 + 渲染进程 + 独立视图进程 |
| 打包 | `electron-packager ^17.1.2` | 生成 `win32-x64` 免安装目录（rcedit 写入图标与版本信息） |
| 直播 | `hls.js 1.7.3` | 直播 HLS 播放（随包分发，离线可用） |
| 图标 | Python + Pillow | 从 macOS 版 icns 生成 `icon.png` 与多尺寸 `icon.ico` |
| 测试 | 自研 Electron 脚本 | `tools/probe-main.js`（断言 + 逐页截图）、`tools/probe-layout.js`（布局量测） |

渲染层**不引入任何前端框架**：原生 DOM + 事件委托 + 模板字符串，减少体积与层级复杂度。

---

## 3. 目录结构

```
BiliFound-win/
├── main.js                 # 主进程：窗口、视图、网络、IPC、业务（约 2340 行）
├── preload.js              # 主界面 preload，暴露 window.bg
├── player-preload.js       # 播放器视图 preload，暴露 window.playerBridge
├── live-preload.js         # 直播视图 preload，暴露 window.liveBridge
├── renderer/
│   ├── index.html          # 应用外壳：侧边栏、工具栏（含 Windows 窗口按钮）、设置面板、命令面板
│   ├── app.js              # 前端逻辑：路由、页面渲染、交互（约 5150 行）
│   ├── style.css           # 设计系统与全部样式（约 2310 行，含 platform-win 段）
│   ├── player.html         # 自建播放器（视频 + 音频 + 弹幕 + 字幕 + 全屏控制层）
│   └── live.html           # 直播播放页（HLS + 画面弹幕层 + 退出全屏）
├── tools/
│   ├── make_icon.py        # 生成 icon.png / icon.ico / 尺寸预览
│   ├── build-win.js        # electron-packager 打包（可 --zip）
│   ├── probe-main.js       # 冒烟测试：12 项断言 + 逐页截图（不进发布包）
│   └── probe-layout.js     # 布局量测：播放器槽位 / 控制条 / 滚动区（不进发布包）
├── build/                  # 图标与测试截图（不打包，图标单独复制进包）
├── docs/                   # 本文档、移植报告、使用说明
├── inject/bili.css         # 内嵌网页视图的样式覆盖（保留）
├── dist/                   # 打包产物
└── package.json
```

---

## 4. 进程与视图架构

```
┌──────────────────────────── 主进程 main.js ────────────────────────────┐
│  BrowserWindow（外壳，frame: false，自绘标题栏）                        │
│  ├── webContents → renderer/index.html（自绘界面）                      │
│  ├── WebContentsView(player) → renderer/player.html（视频/番剧）        │
│  ├── WebContentsView(live)   → renderer/live.html（直播）               │
│  └── WebContentsView(web)    → 内嵌网页（网页版兜底/登录）              │
│                                                                        │
│  session.fromPartition('persist:bili')  ← 所有 API/媒体请求共用登录态   │
│  ipcMain.handle / ipcMain.on            ← 55+ 业务通道                  │
│  Menu.popup                             ← 原生菜单（画质/投币/收藏夹）   │
└────────────────────────────────────────────────────────────────────────┘
        ▲ IPC（contextBridge）                    │ executeJavaScript
        │                                        ▼
┌───────┴────────┐                    ┌──────────────────────────┐
│  渲染进程       │                    │  独立视图进程             │
│  window.bg     │                    │  playerBridge/liveBridge  │
│  路由 + 渲染    │                    │  播放器/直播页            │
└────────────────┘                    └──────────────────────────┘
```

**为什么用 `WebContentsView` 而不是 `<video>`？**

- 版权视频需要携带 `Referer` 与登录态，交给主进程统一注入请求头最稳妥。
- 视频/直播有独立的媒体生命周期，与界面渲染解耦，切换页面不影响播放器。
- 原生视图可独立全屏、独立静音，避免与界面动画互相干扰。

**层级注意事项（重要）**

`WebContentsView` 是**原生层**，永远位于外壳 DOM 之上。因此：

- 任何需要覆盖在播放器之上的弹层（菜单、表情面板）都不能用普通 DOM 悬浮层。
- 画质/投币/收藏夹等选择使用 **`Menu.popup` 原生菜单**。
- 表情面板采用**底部固定浮层**，并在打开时临时隐藏播放器视图（`player:cmd hide/show`）。
- 直播的退出全屏按钮直接渲染在 `live.html` 内部。

**Windows 窗口实现**

| 事项 | 做法 |
| --- | --- |
| 标题栏 | `frame: false` + DOM 里 `-webkit-app-region: drag`（工具栏与侧边栏顶部均可拖动） |
| 窗口按钮 | 工具栏右侧自绘（最小化 / 最大化·还原 / 关闭），点击走 `win-control` IPC |
| 最大化状态 | 主进程 `maximize/unmaximize` 事件推 `window-state`，渲染层换图标与标题 |
| 双击标题栏 | 工具栏/侧栏顶部空白双击 → 最大化/还原（按钮与输入框除外） |
| 缩放锁定 | `setVisualZoomLevelLimits(1,1)` + 拦截 `zoom-changed`，防止 DOM 与原生视图错位 |
| 全屏 | `win.setFullScreen()`；Windows 不派发 `enter/leave-full-screen`，改为 resize 兜底 + 多次重贴 |
| 窗口位置记忆 | `app.getPath('userData')/settings.json` 的 `windowBounds`，恢复前用 `screen.getDisplayMatching()` 校验，避免多显示器切换后跑到屏幕外 |
| 任务栏 | `app.setAppUserModelId('com.styzn.bilifound')`；exe 内嵌 `icon.ico` |

---

## 5. 网络层

### 5.1 统一出口

所有请求经由主进程的 `session.fromPartition('persist:bili')` 发出：

```js
const PARTITION = 'persist:bili';
```

好处：Cookie、UA、Referer、代理设置集中管理；渲染进程不直接接触网络凭证。

### 5.2 主机路由

`hostFor(endpoint)` 负责把相对路径映射到正确域名：

| 路径前缀 | 目标主机 |
| --- | --- |
| `http(s)://` 开头 | 原样返回 |
| `/session_svr`、`/svr_sync`、`/web_im` | `api.vc.bilibili.com`（私信） |
| `/xlive`、`/room`、`/msg` | `api.live.bilibili.com`（直播） |
| 其它 | `api.bilibili.com` |

### 5.3 三类请求封装

| 函数 | 用途 | 特点 |
| --- | --- | --- |
| `apiFetch(endpoint, params)` | GET 查询 | 自动拼接 query、带 UA/Referer、返回 JSON |
| `apiPost(endpoint, form)` | 表单 POST | 自动附加 `csrf`（`bili_jct`）与 Referer |
| `apiPostJson(endpoint, body)` | JSON POST | `Content-Type: application/json`，用于动态发布 |
| `apiFetchWbi(endpoint, params)` | WBI 签名 GET | 用于 `/x/player/wbi/*`、`/x/space/wbi/*` 等风控接口 |

**Windows UA**（与 macOS 版唯一的网络层差异）：

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36
```

### 5.4 WBI 签名

```
getWbiKeys()  →  /x/web-interface/nav 取 img_key / sub_key
mixinKey()    →  按固定置换表重排得到 mixin_key
encWbi(params, mixinKey) → 排序 → 过滤特殊字符 → w_rid = md5(query + mixin_key)
```

`apiFetchWbi` 会自动附加 `wts` 与 `w_rid`，并复用同一套 Cookie。

### 5.5 媒体请求的 Referer

视频/直播 CDN 会校验 `Referer`。主进程通过 `webRequest.onBeforeSendHeaders`
对视频域名（`bilivideo/akamaized/mcdn/szbdyd/mirror/hdslb/upos-*`）统一注入：

```
Referer: https://www.bilibili.com/
User-Agent: <桌面版 UA>
```

### 5.6 页面内 POST（`action:page`）

少数接口（如动态点赞）要求请求**来自 bilibili.com 页面上下文**（同源 + 特定 body）。
`doActionPage(entry, payload)` 在隐藏的 `web` 视图中执行页面内 `fetch`：

- 支持 `json: true`（JSON body）
- 支持 `query`（把 csrf 等拼到 URL）
- 返回接口原始 JSON

---

## 6. 登录与凭证

| 项目 | 实现 |
| --- | --- |
| 登录入口 | 侧边栏「登录」→ 独立登录窗口加载 `passport.bilibili.com` |
| 凭证存储 | Chromium Cookie（分区 `persist:bili`），落盘于 `%APPDATA%\BiliFound` |
| 关键 Cookie | `SESSDATA`、`bili_jct`（csrf）、`DedeUserID`、`buvid3/buvid4` |
| 登录态读取 | `/x/web-interface/nav` → `isLogin`、`uname`、`face`、`vip` |
| 写操作校验 | 所有 POST 自动带 `csrf=bili_jct` |
| 退出登录 | 清除分区 Cookie 并刷新界面 |

**说明**：`buvid3` 是直播弹幕鉴权与部分风控接口的必需项，登录后由 B 站自动下发。
登录窗口在 Windows 上是标准边框窗口（`autoHideMenuBar`），登录完成后关闭并广播 `login-changed`。

---

## 7. 视频播放链路

### 7.1 取流

```
renderVideo(bvid)
  → /x/web-interface/view?bvid=        # 标题、UP、分P、cid
  → /x/player/wbi/playurl?fnval=4048   # DASH：视频流 + 音频流分离
  → normalizePlayInfo()                # 归一化各清晰度
  → pickDashStream()                   # 按当前 qn 选视频流 + 音频流
```

- `fnval=4048` 同时请求 DASH 与 HDR/4K 能力，最高 1080P+（视账号与片源）。
- DASH 返回的 `video` 与 `audio` 是两条独立流。

### 7.2 播放器

`renderer/player.html` 内含：

- `<video id="v">`：视频轨
- `<audio id="a">`：音频轨
- 播放时同步两条流（`timeupdate` 校正、`play/pause/seek/rate` 联动）
- 弹幕层 `#dm-layer`、字幕层 `#sub`、全屏控制层 `#fs-ui`

主进程用 `pathToFileURL()` 生成 `file:///C:/.../player.html?...` 再加载
（Windows 上手拼 `file://C:\...` 会加载失败）。

**cid 兜底**：`player:show` 的调用方里，有些入口（关掉设置面板后把播放器贴回槽位、
分P 切回）只带 `bvid`。缺 `cid` 时 `playurl` 会被 B 站判成参数错误（`code -400`「请求错误」）。
现在两层都有兜底：渲染层 `showPlayerWhenReady()` 用 `state.currentVideo.cid` 补，
主进程在 `player:show` 里再查一次 `/x/web-interface/view?bvid=` 取 `cid`。

### 7.3 画质切换

```
控制条「画质」→ 原生菜单 Menu.popup
  → player:quality { qn, startAt }
  → 主进程重新取流 → 播放器 __setSrc(videoUrl, audioUrl, startAt)
```

保留当前播放进度，切换后从原位置继续。

### 7.4 弹幕

```
/x/v1/dm/list.so?oid=<cid>   # XML（可能 deflate/gzip 压缩，主进程四种方式尝试解压）
  → 主进程 parseDanmakuXml()  # 解析 time/mode/color/text
  → player.webContents.executeJavaScript('__setDanmaku(list)')
```

播放器按时间轴调度，支持透明度/字号/速度/显示区域设置，可在控制条一键开关。

### 7.5 字幕

```
/x/player/wbi/v2 → data.subtitle.subtitles[]
  → 取 subtitle_url（JSON）
  → player.__setSubtitle([{ from, to, content }])
```

支持 CC 开关与自动跟随。

### 7.6 视频全屏

与"应用全屏"区分：

| 按钮 | 行为 |
| --- | --- |
| 工具栏全屏 / F11 | 窗口全屏，保留侧边栏/工具栏 |
| 播放器全屏 | 窗口全屏 + 播放器视图铺满 + 隐藏外壳 + 播放器内控制条 |

实现：`player:fullscreen { on }` → `setVideoFullscreen()`：

1. `win.setFullScreen(true)`（记住原先是否最大化，退出后还原）
2. 播放器视图 `setBounds(contentBounds)`；Windows 全屏是异步切边框，用 `refitSoon()`
   在 0/60/200/500ms 各重贴一次，避免视图停在旧尺寸
3. 外壳加 `html.video-fs`（隐藏侧边栏等）
4. 播放器显示独立控制层（进度/音量/退出）
5. `Esc` / 播放器内「×」/ 双击画面 退出，精确还原槽位尺寸

**播放器 + 内容区的自适应（1.1 版重写）**：

视频、番剧、直播三个播放页统一为「**顶部固定播放器 + 下方内容独立滚动**」的骨架：

```css
.watch { height:100%; display:flex; flex-direction:column; --player-h: <JS 计算> }
.watch-top { flex: 0 0 auto; display:flex; justify-content:center }
.player-wrap { width: min(100%, var(--player-h) * 16/9) }
.watch-scroll { flex:1; min-height:0; overflow-y:auto }
```

- `--player-h` 由 `setupWatchBlock()` 按窗口宽高计算：取「可用宽度 × 9/16」与
  「窗口高度 − 控制条 − 内容预留（150~240px）」的较小值。
- **滚动收缩**：视频页滚动下方内容时，播放器按滚动距离从 `fullH` 缩到 `miniH`
  （150~300px），同时控制条隐藏次要按钮，只留播放/时间/进度/静音/全屏；
  滚回顶部自动恢复。下方内容区因此从**76px 变成约 380px**。
- **播放器滚轮转发**：播放器是原生 `WebContentsView`，滚轮事件到不了外壳。
  `player.html` 把 `wheel` 事件经 `playerBridge.wheel` → 主进程 `player:wheel`
  → 外壳 `window.__bgWheel` 转发，滚动下方内容并触发收缩。全屏时主进程忽略。
- **番剧页/直播间**：播放器固定在顶部，标题、选集、弹幕在下方独立滚动，
  不再出现「外层页面滚动、原生视图停在原地」的脱位问题。
- **回到顶部**：浮动按钮同时作用于内层滚动容器。

> 1.0 版的旧写法（`.watch-top` 宽度 `min(100%, (100vh-250px)*16/9)` + 下方固定小滚动区）
> 在小窗口里把内容区压到 76px；番剧/直播页则把播放器放在外层滚动流里，
> 原生视图不会随滚动跟随。1.1 版统一改成上面的骨架。

### 7.7 下载

```
video:formats → /x/player/wbi/playurl?fnval=1   # MP4 合并流
video:download → ses.fetch 流式写盘
  → 写 <name>.part → 完成后 rename（Windows 被占用时退化为复制+删除）
  → AbortController 60s + 30s 无进度检测 → 清理 .part
  → 文件名按 Windows 规则清洗（\ / : * ? " < > |、结尾点空格、CON/PRN 等保留名、长度截断）
  → 落盘目录：默认 %USERPROFILE%\Downloads\BiliFound，可在设置里改
```

> DASH-only 片源（`durl` 为空）暂不支持下载，会返回明确提示。

---

## 8. 直播链路

### 8.1 取流

```
/xlive/web-room/v2/index/getRoomPlayInfo
  ?room_id=&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8
  → 遍历 stream[].format[].codec[]，仅取 avc
  → 组装 host + base_url + extra
  → 优先 HLS（.m3u8），逐个探测 CDN 可用性（5s 超时）
  → 回退 FLV
```

### 8.2 播放

直播视图 `renderer/live.html`：

- `hls.js` 低延迟模式（`lowLatencyMode`、`liveSyncDurationCount: 3`）
- 该视图单独设置 `webSecurity: false`（HLS 分片跨域），**不影响主界面**
- 同一路流只更新边界，不重新加载（避免缩放窗口导致断流）
- 直播视图加载同样使用 `pathToFileURL()`（Windows 路径）

### 8.3 弹幕（WebSocket）

```
/xlive/web-room/v1/index/getDanmuInfo → token + host_list
wss://<host>:<wss_port>/sub
  握手包 op=7：
    { uid, roomid, protover: 3, platform: 'web', type: 2, key: token, buvid }
  心跳 op=2，每 30s
  收包：brotli / zlib 解压 → 按 op 分发
    DANMU_MSG       → 弹幕（text/color/user）
    INTERACT_WORD   → 进入直播间
    SEND_GIFT       → 礼物
```

> 鉴权包必须带 `uid` 与 `buvid`，否则服务端会立即断开连接。

弹幕同时投递到两处：

1. 外壳下方弹幕列表（`live-danmaku` IPC）
2. 直播视图内的画面弹幕层（`window.__dm()`，9 条轨道、随机速度）

### 8.4 画质 / 音量 / 全屏

| 能力 | 实现 |
| --- | --- |
| 画质 | `live:qualities` 读 `accept_qn` → 原生菜单 → `live:setQuality` 重新取流并 `__setSrc` |
| 音量 | `live:volume { volume, muted }` → 直播页 `__setVolume/__setMuted` |
| 全屏 | `live:fullscreen { on }` → 窗口全屏 + 直播视图铺满 + `html.live-fs` |
| 退出 | 直播页右上角「退出全屏」按钮 / `Esc` → `live:exit-fs` |

---

## 9. 动态

### 9.1 列表

```
/x/polymer/web-dynamic/v1/feed/all?type=all&page=N&features=<DYN_FEATURES>
/x/polymer/web-dynamic/v1/feed/space?host_mid=...&features=<DYN_FEATURES>
```

**必须携带 `features`**：

```
itemOpusStyle,opusBigCover,onlyfansVote,decorationCard,
onlyfansAssetsV2,ugcDelete,onlyfansQaCard
```

否则 B 站返回**精简结构**：图文动态的正文（`major.opus`）被省略，
表现为"纯文字动态空白、文字+图片只剩图片"。

### 9.2 正文解析

`dynTextHTML(dyn)` 的优先级：

1. `desc.rich_text_nodes`（富文本，表情渲染为图片）
2. `desc.text`
3. `major.opus.summary.rich_text_nodes` / `.text`
4. `major.article.title`

### 9.3 媒体

| 类型 | 字段 |
| --- | --- |
| 图片 | `major.draw.items[].src` / `major.opus.pics[].url`（opus 结构字段是 `url`） |
| 视频 | `major.archive`（封面/标题/时长/BV） |
| 番剧 | `major.pgc` |
| 专栏 | `major.article`（可点击进原生阅读页） |
| 直播 | `major.live_rcmd`（内嵌 JSON，解析出房间号） |
| 音乐/合集 | `major.music` / `major.ugc_season` |

### 9.4 受限内容

仅粉丝可见/已删除的动态，`modules` 缺失或 `major.blocked` 为真：

- 显示明确占位卡片 + 「去网页查看」
- 不再出现空白卡

### 9.5 发布

```
POST /x/dynamic/feed/create/dyn   （JSON body）
{
  dyn_req: {
    content: { contents: [{ raw_text, type: 1, biz_id: "" }] },
    pics: [{ img_src, img_width, img_height, img_size }],
    scene: 2,
    meta: { app_meta: { from: "create.dynamic.web", mobi_app: "web" } }
  }
}
```

图片先上传：`POST /x/dynamic/feed/draw/upload_bfs`（multipart，字段 `file_up`，`biz=new_dyn`）。

### 9.13 首页「换一批」（1.11.0）

首页 `.view-head` 右侧加了「换一批」按钮（`#feed-shuffle`），热门页不显示。

点击 → `refreshFeed()`：

```js
st.pn = 0; st.items = []; st.done = false; st.heroBuilt = false;
if (key === 'home') st.fresh += 1;   // 让 rcmd 的 fresh_idx 往前走
feed.innerHTML = skeletons(10);      // 先回骨架屏
view.scrollTo({ top: 0, behavior: 'smooth' });
await loadMoreFeed();                // 重新拉第一批（30 条），轮播/侧卡/网格一起重建
```

- 推荐接口本来就带 `fresh_idx / fresh_idx_1h / brush`，序号递增 + 随机 `brush` 保证内容真的换一批；
- 加载期间按钮加 `.busy`（禁用 + 图标旋转），避免连点；
- 轮播定时器由 `render()` 的清理逻辑负责，重建时旧定时器会先被清掉。

### 9.12 设计风格预设（1.10.0）

设置 → 外观下方新增「设计风格」，5 个预设，**只改卡片/圆角/字体/质感，不动布局**：

| id | 名称 | 主要差异 |
| --- | --- | --- |
| `classic` | 经典 | 现状：22 圆角、玻璃卡片、柔和阴影 |
| `magazine` | 杂志 | 圆角 2px、无阴影、封面下缘一条细线、标题改衬线（Georgia / 宋体 / Noto Serif） |
| `minimal` | 极简 | 1px 细边框、圆角 8px、无阴影，hover 只描边 |
| `paper` | 米纸 | 暖白卡片 `#fbf7ee` + 3px 硬阴影（印刷感），hover 位移 |
| `neon` | 霓虹 | 深色玻璃 + 紫色发光描边，圆角 14px |

实现：

```
html[data-style="magazine"] { --r-card: 2px; }
html[data-style="magazine"] .card { box-shadow: none; ... }
```

- `state.style` 存 localStorage（`bg:style`），启动时 `applyStyle()` 在 `applyTheme()` 之后执行；
- 设置面板由 `renderStylePresets()` 生成 5 张带微缩预览的卡，点击即时生效并弹 toast；
- 命令面板同步生成「设计风格：杂志」等 5 条命令（`PALETTE_COMMANDS` 里展开 `STYLE_PRESETS`）。

> 注意：`STYLE_PRESETS` 必须定义在 `PALETTE_COMMANDS` 之前，否则顶层求值会踩 TDZ。

### 9.11 直播页：左播放器 + 右弹幕栏（1.8.0）

对照网页版重排直播页：

```
.live-room { display:grid; grid-template-columns: minmax(0,1fr) 300px }
  .live-main  标题 / 播放器 / 控制条 / 状态
  .live-side  弹幕头 / 弹幕列表 / 工具条 / 输入框
```

- **播放器自适应**：`fitLive()` 按左栏可用宽高算 16:9（`min(availH, availW*9/16)`），
  用 `ResizeObserver` 跟随窗口变化；原生视图仍由 `.player-slot` 的尺寸同步。
- **弹幕行**来自 `DANMU_MSG`，主进程补全字段后再发到渲染层：

| 字段 | 来源 | 展示 |
| --- | --- | --- |
| `level` | `info[4][0]` | 左侧等级小方块 |
| `medal.level / name / color` | `info[3][0] / [1] / [4]` | 粉丝牌（边框+底色取牌色） |
| `guard` | `info[7]`（0/1/2/3） | 舰 / 提 / 总 徽章 |
| `color` | `info[0][3]` | 非白色文字时按原色显示 |
| `isAdmin` | `info[2][2]` | 预留 |

- **点赞**：本地计数（`liveLikes:<roomId>`）+ 上浮动效，不提交到 B 站接口。
- **表情**：24 个 emoji 面板，点击插入输入框（上限 20 字）。
- **弹幕屏蔽**（存 `liveFilter`）：关键词（同时匹配内容与用户名）、屏蔽进场、屏蔽礼物、
  最低用户等级；在 `pushDm` 入口统一过滤。
- **全屏**：`html.live-fs` 隐藏侧栏/标题/控制条/弹幕栏，`.live-frame` 铺满 100vw×100vh。

### 9.10 搜索面板：历史 + 热搜（1.7.0）

搜索框聚焦后按「有没有输入」分两种面板：

| 状态 | 内容 |
| --- | --- |
| 空输入 | **搜索历史**（chips，最多 20 条，超过 10 条出现「展开更多 ⌄」）+ **bilibili 热搜**（两栏 1–10） |
| 有输入 | 搜索预测（见 §9.9） |

**热搜接口**（走现有 `api()`，同域）：

```
/x/web-interface/search/square?limit=10
  →  data.trending.list[].{keyword, show_name, icon}
```

- `icon` 是「新 / 热 / 独家 / 山」等角标图片，返回的可能是 `http://`，
  渲染前统一过一遍 `httpsUrl()`（CSP 只允许 `https:`/`data:`/`file:`/`blob:`）。
- 前 3 名排名数字用强调色，其余灰色。
- 结果缓存在 `state.hotSearch`，同一会话只请求一次；请求中显示「正在加载热搜…」。

**历史**：`recentSearch` 从 localStorage 读，最多存 20 条，默认显示 10 条，
`state.histExpanded` 控制展开；「清空」直接清掉并重绘面板。

### 9.9 搜索预测（1.6.0）

搜索框聚焦后分两种状态：**没输入 → 最近搜索；有输入 → 搜索预测**（和网页版一致）。

**接口**（与 `api.bilibili.com` 不同域，走独立通道）：

```
IPC  search:suggest(term)
GET  https://s.search.bilibili.com/main/suggest?term=…&main_ver=v1&highlight=&Suggestion_type=0
  →  result.tag[].value
```

`main.js` 里用 `session.fromPartition('persist:bili')` 发请求，带 UA / Referer / Origin，
并把结果去重后截到 10 条；渲染层只拿纯文本 `value`。

**交互**：

| 行为 | 说明 |
| --- | --- |
| 输入 | 180ms 防抖后请求；用 `suggestSeq` 序号丢弃过期响应，避免慢请求覆盖新结果 |
| 高亮 | 拿 `value` 自己按查询词切分再 `esc()`，命中处包 `<mark>`（不直接使用接口返回的 HTML） |
| ↑ / ↓ | 在建议里移动选中项（`.sug-item.on`） |
| Enter | 有选中项就用它搜索，否则走原有提交逻辑 |
| Esc | 关闭面板并失焦 |
| 点击 | `mousedown` preventDefault 防止 blur 抢先，点击后填入并搜索 |
| 清空输入 | 回到「最近搜索」，搜索过的词会记进 `recentSearch` |

样式：`.search-hist` 玻璃面板（沿用），新增 `.sug-item`、`.sug-item.on`、`mark`（强调色 + 加粗）。

### 9.8 首页布局：顶部大小混排（1.5.0）

首页首屏借鉴 B 站网页版：**左边一个大轮播（跨两行），右边 4 张小卡，下面回到统一网格**。

```html
<div class="hero-row">              <!-- grid-template-columns: 3fr 1fr 1fr -->
  <div class="hero">…5 张轮播…</div>    <!-- grid-row: span 2 -->
  <article class="card">…</article>    <!-- 4 张，与下面网格同宽 -->
</div>
<div class="grid home-grid">…</div>    <!-- repeat(5, minmax(0,1fr)) -->
```

- **比例**：大卡 3/5 宽、2 行高；右侧两列各 1/5，与下方 5 列网格对齐。
- **轮播**：5 张、6 秒自动切换；鼠标移入暂停；左右箭头 hover 出现；底部指示点可点；
  点击进视频页。定时器存 `state.heroTimer`，`render()` 切路由时清掉。
- **列数自适应**（1.9.0）：`applyHomeColumns()` 按网格实际宽度算列数

  ```js
  cols = clamp(floor((w + gap) / (250 + gap)), 2, 5)   // gap = 16
  ```

  | 内容宽度 | 列数 | 卡片宽 |
  | --- | --- | --- |
  | 1056（1344 小窗） | 4 | ≈252px |
  | 1440（2560 最大化，限宽上限） | 5 | ≈274px |

  窗口变化时由 `ResizeObserver` 重算。`.hero-row` **用同一套轨道**
  （`repeat(cols, 1fr)` + 同间隙同内边距），大卡用 `grid-column` 占位，
  所以顶部小卡和下方网格是**逐列像素对齐**的。

- **侧卡数量跟着列数走**（1.9.1 修「空两格」）：

  | 列数 | 大卡 | 侧卡 | 网格 |
  | --- | --- | --- | --- |
  | 5 | 跨 3 列 × 2 行 | 4 张（2 列 × 2 行） | 第 10 条起 |
  | 4 | 跨 2 列 × 2 行 | 4 张（2 列 × 2 行） | 第 10 条起 |
  | 3 | 独占整行（`1 / -1`，21:9） | 3 张（一行铺满） | 第 9 条起 |
  | 2 | 独占整行 | 2 张 | 第 8 条起 |

  列数变化时会用缓存的 `state.feeds.home.items` 重新排一次首屏，避免 4 张侧卡在 3 列里
  折行留空。
- **其它页面**（热门/排行/搜索/收藏）仍用 `auto-fill minmax(240px,1fr)`，只是同样限宽。
- **卡片**：22 圆角、无边框、无内边距（封面满宽）、强阴影、角标内缩 8px、hover 放大 1.045。

> 1.4.0 曾试过在首页顶部放「继续观看」，按需求已移除（连同历史接口调用与去重逻辑）。

### 9.7 应用内更新

不依赖任何服务端，只要有一个能放静态文件的地址（GitHub Releases / Gitee / OSS / 自建 Nginx 都行）。

**清单格式**（`latest.json`）：

```json
{
  "version": "1.4.0",
  "notes": "修复…；新增…",
  "publishedAt": "2026-12-01",
  "url": "https://example.com/bilifound/BiliFound-1.11.0-Setup-x64.exe",
  "size": 98123456,
  "sha256": "…",
  "portableUrl": "https://example.com/bilifound/BiliFound-1.11.0-Portable-x64.exe"
}
```

也兼容 `{"platforms":{"win32-x64":{url,sha256,size}}}` 写法。

**通道**：

| IPC | 作用 |
| --- | --- |
| `update:version` | 返回当前版本 + 已配置的清单地址 |
| `update:check` | 拉清单、比较版本（`compareVersion` 逐段数字比较），返回 `{newer, latest, notes, asset}` |
| `update:download` | 流式下载到 `%TEMP%\BiliFound-update\`，每 200ms 发 `update-progress`，边下边算 sha256 |
| `update:install` | `shell.openPath(安装包)`，1.2 秒后 `app.quit()`，让安装器替换正在运行的 exe |
| `update:reveal` | 打开下载所在文件夹（便携版/绿色包用户手动替换） |
| `update:skip` | 记住跳过的版本 |

**安全与健壮性**：

- sha256 不匹配立即删除下载文件并报错，不交给安装器；
- 只接受 `http(s)` 清单地址；
- 坏 JSON、404、网络错误都会转成可读的中文提示；
- 下载并发保护（`updateDownloading`），避免重复点击；
- 启动后 4 秒静默检查一次，6 小时内不重复（`lastUpdateCheck`），可在设置里关；
- 发现新版本时发 `update-available`，外壳弹 toast。

**发布方式**：

```powershell
npm run setup                                   # 出 Setup / Portable
node tools\make-manifest.js --version 1.3.1 \
  --file dist-installer\BiliFound-1.3.1-Setup-x64.exe \
  --portable dist-installer\BiliFound-1.3.1-Portable-x64.exe \
  --base https://example.com/bilifound ""--notes "修复了 xxx" --out latest.json
# 把 exe 和 latest.json 一起上传到同一个目录，地址填进 设置 → 更新
```

安装版用户：检查 → 下载 → 立即安装 → 安装器覆盖安装（设置与登录态在 userData 里，不受影响）。
便携版/绿色包用户：下载后「打开下载位置」，手动替换 exe 即可。

### 9.6 关注的直播（左栏 + 完整列表页）

动态页左栏「正在直播」来自：

```
/xlive/web-ucenter/v1/xfetter/GetWebList?page=1&page_size=50&hit_ab=false
  → data.rooms[]  （字段：room_id / uid / uname / face / title / live_status / online / area_v2_name）
  → 过滤 live_status === 1
```

**注意**：该接口默认只返回 10 条，必须显式传 `page_size`；
若响应里没有 `total`，且返回条数看着像被截断（≥50 或正好 10），
计数显示成 `N+`，避免"永远显示 10"的误导。

左栏固定展示前 10 位，超出时：

- 标题右侧的「全部 ›」按钮；
- 列表底部一行「还有 N 位正在直播 · 查看全部 ›」。

两者都跳到 `liveFollowing` 路由（`renderLiveFollowing()`）：

- `page_size=20`，滚动到底自动翻页（`setInfinite`）；
- 按 `room_id` 去重，接口若不支持翻页只会重复返回同一页，不会死循环；
- 卡片复用 `cardHTML({ live: true })`，点击进 `liveRoom`；
- 副标题显示 `共 N 位关注正在直播`（有 total 时）或 `已加载 N 位`；
- 顶部「返回动态」按钮回到 `dynamic`。

---

## 10. 评论

### 10.1 读取

```
/x/v2/reply?type=1&oid=<aid>&sort=2&ps=20&pn=N     # 视频
/x/v2/reply/reply?type=1&oid=&root=<rpid>&ps=10&pn=1  # 二级评论
```

### 10.2 渲染

- **表情**：`content.emote` 是 `[表情名] → 图片 URL` 映射，按最长 key 匹配后替换为 `<img>`
- **配图**：`content.pictures[]` 渲染 96×96 缩略图，点击打开大图查看器
- **富文本**：`content.rich_text_nodes` 兜底

### 10.3 发布 / 回复 / 点赞 / 删除

| 操作 | 接口 |
| --- | --- |
| 发布/回复 | `POST /x/v2/reply/add`（`oid/type/message/root/parent/pictures`） |
| 点赞 | `POST /x/v2/reply/action` |
| 删除 | `POST /x/v2/reply/del` |

发布走主进程 `apiPost`（带 csrf + Referer），成功后把返回的 `data.reply`
直接插入列表顶部，无需整页刷新。

### 10.4 输入增强

- 表情面板：`/x/emote/user/panel/web?business=reply`（14 个包、200+ 表情）
- 图片：`upload_bfs`（`biz=reply`）→ `pictures` 参数
- `Ctrl+Enter` 快捷发送（Windows；macOS 原版为 `⌘↵`）

---

## 11. 私信

### 11.1 接口（VC 旧版，网页版新接口被风控）

| 功能 | 接口 |
| --- | --- |
| 会话列表 | `/session_svr/v1/session_svr/get_sessions` |
| 聊天记录 | `/svr_sync/v1/svr_sync/fetch_session_msgs` |
| 发送消息 | `POST /web_im/v1/web_im/send_msg` |

主机：`api.vc.bilibili.com`。发送需要 `dev_id`（本地生成并持久化到 `settings.json` 的 `imDevId`）。

### 11.2 消息类型

| `msg_type` | 含义 | 渲染 |
| --- | --- | --- |
| 1 | 文字 | 文本 + 表情转义符渲染为表情图 |
| 2 / 6 | 图片 / 自定义表情 | 图片，点击看大图 |
| 5 | 撤回 | 「消息已撤回」 |
| 7 | 分享 | 卡片（视频/专栏/番剧/动态/直播），可点击跳转 |
| 10 | 通知 | 标题 + 正文 + 详情行 + 跳转按钮 |
| 11 | 视频推送 | 封面卡片 → 视频页 |
| 12 | 专栏推送 | 封面卡片 → 专栏页 |
| 13 | 图片卡片 | 图片卡片 → 网页 |
| 14 | 分享其他 | 通用卡片 → 网页 |
| 18 | 系统提示 | 解析内嵌 JSON，居中提示 |
| 301–306 | 粉丝团消息 | 居中系统文案 |

### 11.3 发送图片

```
upload_bfs (biz=im) → https://i0.hdslb.com/bfs/im_new/...
POST send_msg
  msg[msg_type]=2
  msg[content]={"url","width","height","imageType","original":1,"size"}
```

### 11.4 头像

会话列表返回 `face`；聊天页按 `sender_uid` 匹配。取不到时用昵称首字生成渐变占位头像。

---

## 12. 专栏

```
/x/article/viewinfo?id=<cv>   # 标题、作者、横幅、统计、发布时间
/x/article/view?id=<cv>       # 正文 HTML（data.content）
```

正文经 `sanitizeArticleHTML()` 白名单清洗：

- 允许：`p/br/strong/em/h1-h6/blockquote/ul/ol/li/a/img/figure/code/pre/table/...`
- 移除：`script/iframe/style`、`on*` 事件、`style/class/id` 属性
- `//` 开头资源补 `https:`
- 图片加 `loading="lazy"`，点击进大图查看器

入口：搜索「专栏」Tab、动态专栏卡片、`cv<id>` / `read/cv<id>` 链接。

---

## 13. 其它业务模块

| 模块 | 关键接口 |
| --- | --- |
| 首页推荐 | `/x/web-interface/wbi/index/top/feed/rcmd`（`fresh_idx` 递增，刷新换一批） |
| 热门 | `/x/web-interface/popular` |
| 排行榜 | `/x/web-interface/ranking/v2` |
| 搜索 | `/x/web-interface/wbi/search/type`（视频/番剧/UP/专栏） |
| UP 主页 | `/x/space/wbi/acc/info`、`/x/space/wbi/arc/search`、`/x/polymer/.../feed/space` |
| 番剧/影视 | `/pgc/view/web/season`、`/pgc/season/index/result`、`/pgc/web/rank/list` |
| 收藏夹 | `/x/v3/fav/folder/created/list-all`、`/x/v3/fav/resource/list` |
| 历史 | `/x/web-interface/history/cursor` |
| 稍后再看 | `/x/v2/history/toview` |
| 关注/粉丝 | `/x/relation/followings`、`/x/relation/fans` |
| 消息中心 | `/x/msgfeed/reply`、`/x/msgfeed/at`、`/x/msgfeed/like` |

---

## 14. 界面与设计系统

### 14.1 设计令牌

```css
--accent / --accent-2 / --accent-soft / --accent-ring
--bg-0 / --bg-1 / --bg-2
--text / --dim / --faint
--glass / --glass-deep / --glass-flat / --card / --card-border
--blur / --r-md / --r-lg / --shadow
```

主题切换只改变令牌，不重写组件样式。

### 14.2 液态玻璃

- `backdrop-filter: blur() saturate(160%)`
- 玻璃高光 `::before`（**宿主必须 `position: relative`**，否则高光会逃逸到最近的定位祖先）
- `color-mix()` 生成半透明描边与底色

### 14.3 背景层

```
body（必须透明）
 ├── 极光层（负 z-index，随时间缓慢漂移）
 ├── 噪点层
 └── 自定义背景图（用户上传/网络图片）
```

> `body` 一旦不透明，负 z-index 的极光层就会被遮住——这是早期"黑屏"问题的根因。

### 14.4 布局与交互

| 特性 | 说明 |
| --- | --- |
| 侧边栏折叠 | `html.sidebar-collapsed` |
| 紧凑密度 | `html.compact` |
| 沉浸模式 | `html.immersive`（隐藏外壳，专注内容） |
| 视频全屏 | `html.video-fs` |
| 直播全屏 | `html.live-fs` |
| 命令面板 | `Ctrl+K` |
| Windows 平台类 | `html.platform-win`（`app.js` 启动时按 `bridge.platform` 添加） |

### 14.5 Windows 视觉适配

| 事项 | 做法 |
| --- | --- |
| 字体 | `Segoe UI Variable Text / Segoe UI / Microsoft YaHei UI / Microsoft YaHei` 优先，`PingFang SC` 兜底 |
| 侧边栏顶部 | macOS 为红绿灯留 82px；Windows 改为 16px |
| 窗口按钮 | 34×28 方角按钮，`hover` 浅底、关闭态 `#e81123` 红底白字；最大化/还原图标切换 |
| 滚动条 | 细滚动条（10px）+ 透明轨道 + 内容盒裁剪圆角 |
| 快捷键标签 | 全部改成 `Ctrl+…`；命令面板、快捷键面板、按钮 tooltip 同步 |
| 编辑快捷键 | 菜单加入「编辑」角色项（撤销/重做/剪切/复制/粘贴/全选），保证输入框行为符合 Windows 习惯 |

### 14.6 滚动与动画

- 滚动容器 `#view` **不做 transform/opacity 动画**（会触发 Chromium 陈旧合成层，导致白条/闪烁）。
- 刷新时清除该路由的滚动记忆，避免"刷新后自动下滑"。

---

## 15. IPC 接口清单

> 全部通道均为 `ipcMain.handle`（invoke）或 `ipcMain.on`（send）。
> 参数为对象时只列关键字段。

### 15.1 通用 / 系统

| 通道 | 方向 | 参数 | 返回 |
| --- | --- | --- | --- |
| `api` | invoke | `{ endpoint, params }` | JSON |
| `api:wbi` | invoke | `{ endpoint, params }` | JSON（自动 WBI 签名） |
| `action` | invoke | `{ endpoint, form }` | JSON（表单 POST） |
| `action:page` | invoke | `{ endpoint, payload, json?, query? }` | JSON（页面内 POST） |
| `settings:get` / `settings:set` | invoke | `{ key, value }` | 设置对象 |
| `menu:popup` | invoke | `{ title, items:[{label,value,checked}] }` | 选中值 / null |
| `win-control` | on | `'minimize'｜'maximize'｜'close'｜'fullscreen'` | — |
| `win-state` | invoke | — | `{ maximized, fullscreen }`（**Windows 新增**） |
| `open-external` | invoke | `{ url }` | — |
| `clipboard:write` | invoke | `text` | — |
| `clear-cache` | invoke | — | — |

### 15.2 视频 / 播放器

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `player:show` | `{ rect, videoUrl, audioUrl, ... }` | 显示播放器并定位 |
| `player:resize` | `rect` | 跟随槽位 |
| `player:hide` | — | 隐藏播放器 |
| `player:quality` | `{ qn, startAt }` | 切换清晰度 |
| `player:formats` | `{ bvid, cid }` | 可用清晰度列表 |
| `player:subtitle` | `{ bvid, cid }` | 字幕列表 + 内容 |
| `player:danmaku` | `on` | 弹幕开关 |
| `player:cmd` | `{ cmd }` | play/pause/seek/rate/volume/mute |
| `player:state` | — | 当前时间/时长/音量/速率 |
| `player:fullscreen` | `{ on }` | 视频全屏 |
| `player:exit-fs` | — | 播放器内退出全屏 |
| `player:toggle-fs` | — | 播放器内双击切换全屏（**Windows 新增**） |
| `player:shot` | `{ time }` | 截图 |
| `video:formats` | `{ bvid, cid }` | 下载可选清晰度 |
| `video:download` | `{ bvid, cid, title, qn }` | 下载 MP4 |

### 15.3 直播

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `live:info` | `{ roomId }` | 取流 + 房间信息 |
| `live:show` | `{ rect, url }` | 显示直播视图（同 URL 只更新边界） |
| `live:hide` | — | 隐藏并停止弹幕 |
| `live:qualities` | `{ roomId }` | 清晰度列表 |
| `live:setQuality` | `{ roomId, qn }` | 切换清晰度 |
| `live:volume` | `{ volume, muted }` | 音量 |
| `live:fullscreen` | `{ on }` | 直播全屏 |
| `live:exit-fs` | — | 直播页退出全屏 |
| `live:danmaku:start` / `:stop` / `:send` | `{ roomId, text }` | 弹幕连接/断开/发送 |

### 15.4 动态 / 评论 / 私信 / 专栏

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `dynamic:create` | `{ content, dynId, pics }` | 发布/转发动态 |
| `dynamic:remove` | `{ dynId }` | 删除自己的动态 |
| `comment:add` | `{ oid, type, message, root, parent, pictures }` | 发表评论 |
| `comment:del` | `{ oid, type, rpid }` | 删除评论 |
| `reply:action` | `{ oid, type, rpid, action }` | 点赞/点踩 |
| `emote:panel` | `{ biz }` | 表情包 |
| `image:upload` | `{ biz }` | 选图并上传（reply/dynamic/im） |
| `im:sessions` / `im:messages` / `im:send` | `{ talkerId, text, type, payload }` | 私信 |
| `article:like` | `{ id }` | 专栏点赞 |

### 15.5 其它

| 通道 | 说明 |
| --- | --- |
| `bg:pick` / `bg:save` / `bg:remove` / `bg:fromUrl` | 自定义背景 |
| `fav:folders` | 收藏夹列表 |
| `history:delete` / `toview:del` | 删除历史 / 稍后再看 |
| `image:save` | 保存图片 |
| `downloads:list` / `downloads:delete` / `downloads-dir` / `open-downloads` | 下载管理 |
| `downloads:pick` / `downloads:reset` | 更改 / 恢复默认下载目录（**Windows 新增**） |
| `web:show` / `web:hide` | 内嵌网页视图 |

---

## 16. preload 暴露的 API

`preload.js` 通过 `contextBridge` 暴露 `window.bg`：

```js
window.bg = {
  platform, isWindows,                    // 平台标识（isWindows 为 Windows 版新增）
  on,                                     // 事件白名单：shortcut / theme-changed / settings-changed /
                                          // download-toast / login-changed / player-ready / player-error /
                                          // live-danmaku / live-fullscreen / video-fullscreen / window-state
  api, apiWbi, actionPage, danmaku,
  playerShow, playerTime, playerState, playerFormats, playerSubtitle, playerFullscreen,
  playerQuality, playerDanmaku, playerCmd, popupMenu,
  liveInfo, liveShow, liveHide, liveQualities, liveSetQuality, liveVolume,
  liveFullscreen, liveDanmakuStart, liveDanmakuStop, liveDanmakuSend,
  addComment, delComment, likeComment, replyAction,
  createDynamic, removeDynamic, emotePanel, uploadImages,
  imSessions, imMessages, imSend, articleLike,
  favFolders, deleteHistory, delWatchLater, copyText, saveImage,
  pickBackground, saveBackground, removeBackground, backgroundFromUrl,
  downloadsList, downloadsDelete, downloadsDir, openDownloads,
  pickDownloadDir, resetDownloadDir,       // 下载目录管理（Windows 新增）
  openLogin, clearCache, winControl, winState,
  playerResize, playerHide, playerShot,
  webShow, webHide, auxHide,
}
```

- `player-preload.js` → `window.playerBridge.exitFs()` / `toggleFs()`
- `live-preload.js` → `window.liveBridge.exitFs()`

安全设置：`contextIsolation: true`、`nodeIntegration: false`、仅白名单事件可订阅。

---

## 17. 本地存储

| 位置 | 内容 |
| --- | --- |
| `%APPDATA%\BiliFound\settings.json` | 主题、强调色、背景、播放设置、`downloadDir`、`imDevId`、窗口尺寸 |
| `%APPDATA%\BiliFound\backgrounds\` | 自定义背景图 |
| `%APPDATA%\BiliFound\Partitions\bili\` | Chromium 分区 `persist:bili`：登录 Cookie、缓存 |
| `localStorage` | 界面偏好（`bg:*` 前缀）、播放进度（`bg:pos:<bvid>`） |
| 下载目录 | 默认 `%USERPROFILE%\Downloads\BiliFound`（设置里可改；`settings.downloadDir`） |

**配置迁移**：首次启动会从旧版 `BiliGlass` 用户目录迁移设置与背景
（跳过 `Cache / Code Cache / GPUCache / ShaderCache / blob_storage / Singleton*` 等缓存项，
仅迁移必要数据；过滤用 `fs.cpSync` 的 `filter`，正则同时兼容 `\` 与 `/`）。

**重置**：关闭程序后删除 `%APPDATA%\BiliFound` 即可恢复首次启动状态。

---

## 18. 构建与打包

### 18.1 准备

```powershell
cd BiliFound-win
npm install --ignore-scripts
node node_modules\electron\install.js     # 或把 electron-v38.8.6-win32-x64.zip 放进缓存目录
```

> 本机环境下 npm 的默认缓存在沙箱外不可写，安装时用
> `npm.cmd install --ignore-scripts --cache <工作区>\.npm-cache`；
> Electron 二进制由 `node node_modules\electron\install.js` 手动拉取（走 `npmmirror` 镜像）。

### 18.2 生成图标

```powershell
python tools\make_icon.py                       # 用 build\icon-source.png（1024，已是成品图）
python tools\make_icon.py 手绘稿.jpg --ink --tile  # 白底黑线稿 → 透明墨 + 白色圆角底板
python tools\make_icon.py 源图.png --pad 0.74      # 调图形占画布的比例
```

产出：

| 文件 | 用途 |
| --- | --- |
| `build/icon.png` | 1024×1024，BrowserWindow 图标 / 文档预览 |
| `build/icon.ico` | 16/24/32/40/48/64/96/128/256 多尺寸，exe 资源 / 任务栏 / Alt-Tab |
| `build/icon-preview.png` | 深底 + 浅底两排 16/24/32/48/96 预览，肉眼确认小尺寸没糊 |
| `assets/icon.png|ico` | 随包分发副本（打包后运行时只认 `assets/`） |

**1.11.1 起图标是手绘版**：源图 `build/icon-sketch.jpg` 是一张白底黑线稿，
`--ink` 把白色转成透明、按墨色浓淡生成 alpha 并自动裁掉留白；
`--tile` 再垫一层白色渐变圆角底板（`#ffffff → #f7f8fb`）+ 一道细描边，
否则纯黑线在 Windows 11 深色任务栏上几乎看不见；描边是给「白色背景」用的，
没有它白底板放在白色资源管理器背景上会看不出边界。
底板颜色可换：`--tile-colors 255,157,187,251,114,153` 就是粉色版。

两个细节：

- 图形占画布 `--pad 0.94`（默认 0.72 是给「透明底图形」用的，垫底板后要更满）；
- `--tile` 模式下跳过小尺寸加粗（`small_size_boost`），否则底板边缘会变毛；
  纯墨线模式（不加底板）在 ≤48px 会自动做一次 `MaxFilter` 加粗，16px 才不会糊没。

`icon-source.png` 现在是合成好的成品图；`icon-source-pink.png` 保留了原来的粉色小电视。
源图自身占满画布（≥88%）时脚本会保持原比例、不再二次缩小，所以 `npm run icon` 可以反复跑。

> **为什么要有两份**：electron-builder 会把 `directories.buildResources`（即 `build/`）
> 排除在应用目录之外，所以打包后 `build/icon.*` 不存在；`main.js` 的 `iconPath()`
> 按 `assets/ → build/` 顺序查找，开发时用 build、分发时用 assets。

### 18.3 绿色包（electron-packager）

```powershell
node tools\build-win.js          # 只打包
node tools\build-win.js --zip    # 打包 + 生成 BiliFound-1.11.0-win32-x64.zip
```

脚本内部调用 electron-packager：

| 参数 | 值 |
| --- | --- |
| platform / arch | `win32` / `x64` |
| icon | `build\icon.ico`（rcedit 写入 exe 资源） |
| win32metadata | `CompanyName=styzn`、`FileDescription=BiliFound · 哔哩哔哩桌面客户端`、`ProductName=BiliFound`、`AppUserModelId=com.styzn.bilifound` |
| asar | `false`（保持源码可读、便于排查） |
| prune | `true`（剔除 devDependencies） |
| electronZipDir | 复用本地缓存的 Electron zip，避免重复下载 136MB |
| ignore | `build/ tools/ dist/ dist-installer/ docs/ .eb-cache/ .npm-cache/ node_modules/electron* ` |

打包后脚本会：

1. 把 `assets\icon.ico`、`assets\icon.png` 复制进 `resources\app\assets\`（运行时窗口/登录窗要读）；
2. 把 `docs\使用说明.txt` 复制到 exe 同级；
3. 自检关键文件是否都在包里（缺 `assets/icon.*` 会直接报 `[missing]`）。

### 18.4 安装版 / 便携版（electron-builder）

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"      # 未签名，别去找证书
$env:ELECTRON_BUILDER_CACHE = "C:\eb-cache"     # 缓存放工程外，避免被一起打包
npm run setup                                    # = electron-builder --win --x64 --config electron-builder.yml
```

`electron-builder.yml` 关键配置：

| 配置 | 值 / 说明 |
| --- | --- |
| `electronDist` | `node_modules/electron/dist`，复用已下载的 Electron，不再拉 136MB |
| `asar` | `false`（与验证过的目录结构一致） |
| `files` | 排除 `build/probe`、`docs`、`tools`、`dist*`、`.eb-cache`、`node_modules/electron*` 等 |
| `win.target` | `nsis`（x64）+ `portable`（x64） |
| `nsis` | 非一键安装、可改安装目录、桌面+开始菜单快捷方式、卸载程序、保留用户数据 |
| `portable` | `requestExecutionLevel: user`，单文件自解压到临时目录运行 |
| `extraFiles` | `docs\使用说明.txt` → 安装目录 exe 旁 |

> NSIS 与 winCodeSign 首次会从 GitHub 下载到 `ELECTRON_BUILDER_CACHE`。
> 本机遇到 winCodeSign 的 7z 内含 macOS 符号链接、解压时报「没有所需的特权」：
> 把已解出的内容复制成 `<cache>\winCodeSign\winCodeSign-2.6.0` 供其命中缓存即可绕过。

### 18.5 产物

```
dist\BiliFound-win32-x64\             绿色目录（200 MB exe + 运行时文件）
└── BiliFound-1.11.0-win32-x64.zip     138 MB，解压即用

dist-installer\
├── BiliFound-1.11.0-Setup-x64.exe     93.6 MB，NSIS 安装版（快捷方式 + 卸载程序）
├── BiliFound-1.11.0-Portable-x64.exe  93.3 MB，单文件便携版
└── win-unpacked\                     安装版/便携版的中间目录（不含图标资源以外的测试文件）
```

三个产物都是 **x64**。安装版/便携版比绿色 zip 小，是因为 electron-builder
默认剔除了 `*.map` 等开发文件。

### 18.6 版本号规则

**只有用户明确要求时才改主/次版本号。** 其余每次改动（修 bug、加功能、换图标、调样式）
都只递增**最后一位**：

```
v1.0.0  →  v1.0.1  →  v1.0.2  →  …
```

对应操作：

1. `package.json` 的 `version` 改成 1.0.N；
2. 重新打包（文件名会带 `1.0.N`）；
3. 更新 `WINDOWS版说明.md` 的版本行与 SHA256 块；
4. 重新生成 `latest.example.json`（size / sha256 从真实产物算）。

> 对外发布号从 **1.0.0** 起；`docs/TECHNICAL.md` 文末「版本记录」里的 1.1.0 → 1.11.1
> 是**开发期内部迭代号**，与对外版本号不是一套编号。

### 18.6 发布前检查

```powershell
# 确认正式包不含测试脚本
Test-Path dist\BiliFound-win32-x64\resources\app\tools   # 期望 False
# 确认图标与版本信息写进了 exe
(Get-Item dist\BiliFound-win32-x64\BiliFound.exe).VersionInfo | fl ProductName,FileDescription,FileVersion
```

---

## 19. 测试体系

### 19.1 冒烟测试 `tools/probe-main.js`

加载真正的 `main.js`，把外壳窗口逐页渲染，边跑边截图并断言：

```powershell
node_modules\electron\dist\electron.exe tools\probe-main.js --user-data-dir=C:\Temp\bilifound-profile
```

覆盖内容：

| 类别 | 检查项 |
| --- | --- |
| 外壳 | 窗口就绪、侧边栏/工具栏存在、窗口按钮可见且在右侧、平台类名、快捷标签为 Ctrl |
| 视觉基线 | `body` 背景透明、侧边栏无 macOS 红绿灯留白 |
| 页面 | 首页 / 热门 / 排行 / 番剧 / 直播 / 动态（游客）/ 收藏（游客）/ 历史（游客）/ 搜索 |
| 视频 | 播放器槽位坐标、滚动后相关推荐、缩放窗口后槽位跟随、**关闭设置面板后播放器原地恢复且无报错** |
| 窗口 | 最大化 → 按钮图标变「还原」、还原 → 图标复原 |
| 全屏 | 视频全屏 `isFullScreen()=true`、退出后槽位精确还原 |
| 主题 | 深色模式截图 |
| 其它 | 设置面板底部（下载目录按钮）、命令面板、快捷键面板 |

输出：`build\probe\report.json` + `01-home.png` … `19-settings-downloads.png`
（其中 `13b` 之后是**桌面级截屏**，能拍到 `WebContentsView` 原生播放器，
`capturePage` 拍不到原生层）。

**本轮实测结果**：12 项断言全部通过；`report.json` 记录
`electron 38.8.6 / chrome 140.0.7339.249 / node 22.22.0`。
唯一一条日志是 Electron 的 CSP 安全警告（开发模式才会出现，打包后自动消失）。

### 19.2 布局量测 `tools/probe-layout.js`

输出 `build\probe\layout.json`，记录常规/最大化窗口下 `.watch-top`、`.player-frame`、
`#player-slot`、`#ctl`、`.watch-scroll` 的坐标与视口高度。本轮实测：

| 状态 | 视口 | 播放器 | 控制条底部 | 结论 |
| --- | --- | --- | --- | --- |
| 常规 1180×760 | 1180×760 | 892×502 | 638 | 控制条与播放器同宽对齐 |
| 最大化 2560×1391 | 2560×1391 | 2028×1141（居中 x=378） | 1277 | 控制在视口内，底部内容区仍有 68px |

> 修复前最大化时 `.watch-top` 高 1336px，控制条底部到 1414（超出视口 23px），
> 下方内容区被压成 0——这是本轮唯一发现的布局缺陷，已在 `.watch-top` 上加宽度上限修掉。

### 19.3 打包后验证

- 绿色包：从 zip 解压到 `C:\Temp\BiliFound-extract`，双击 `BiliFound.exe`：正常出窗、首页有真实数据。
- 带 `BILIFOUND_START_VIDEO=BV1GJ411x7h7` 启动：播放器正常播放、弹幕滚动、
  控制条显示 `清晰480P`、下方信息与相关推荐正常。
- 安装版：`BiliFound-1.11.0-Setup-x64.exe /S /D=C:\Temp\BiliFound-install` 静默安装 →
  桌面与开始菜单快捷方式生成、安装目录有 `使用说明.txt`、双击 `BiliFound.exe` 正常出窗；
  `Uninstall BiliFound.exe /S` 静默卸载 → 目录清空、快捷方式移除、注册表项移除。
- 便携版：双击 `BiliFound-1.11.0-Portable-x64.exe`，约 4 秒完成自解压并出窗（窗口标题 `BiliFound`）。
- 任务栏/标题栏图标为自定义小电视（从 exe 资源提取确认 32×32），安装版/便携版的
  exe 也带同一图标与 `FileVersion=1.4.0`。

### 19.4 稳定性约定（沿用 macOS 版）

- 固定测试素材：视频 `BV1GJ411x7h7`、番剧 `33415`
- 随机内容（首页推荐、关注流）不做强断言，缺失时跳过而非失败
- 长视频（>120s）跳过下载测试
- 接口瞬时失败自动重试一次

---

## 20. 已知限制与平台注意事项

| 限制 | 原因 / 说明 |
| --- | --- |
| 4K/杜比需大会员 | 与网页版一致，取决于账号权益与片源 |
| DASH-only 片源无法下载 | 下载接口使用 `fnval=1` 的 MP4 合并流 |
| 动态发图片最多 9 张 | 与 B 站一致 |
| 评论配图未做本地测试 | 上传接口已验证，未代用户在账号下发布 |
| 私信不支持撤回/语音 | 未实现 |
| 直播弹幕不显示用户等级/粉丝牌 | 仅渲染文本与颜色 |
| 应用全屏与视频全屏是两个入口 | 设计如此，避免误触 |
| **不能放在 DSH 工作区目录里运行** | 工作区文件被系统标为「低完整性」，Chromium 沙箱无法初始化，exe 会以 `0x80000003` 立即退出。解压到桌面/`D:\` 等普通目录即可（详见 21 节） |
| exe 未签名 | 首次运行安装包/程序可能被 SmartScreen 提示「更多信息 → 仍要运行」 |
| 无自动更新 | 更新方式为重新安装或替换目录（后续可接 electron-updater） |
| 安装版会写注册表 | 卸载项与快捷方式；卸载时自动清理，用户数据（`%APPDATA%\BiliFound`）默认保留 |

---

## 21. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 双击后一闪就退，退出码 `0x80000003` | 程序放在 DSH 工作区（低完整性标签）里 | 复制到桌面或 `D:\Apps` 等普通目录再运行 |
| 启动后黑屏 | `body` 不透明遮住极光层 | 检查 `body { background: transparent }` |
| 页面出现白色横条 | 玻璃高光 `::before` 逃逸 | 给宿主加 `position: relative; isolation: isolate` |
| 画质菜单点不动 | DOM 菜单被播放器原生层遮挡 | 改用 `Menu.popup` 原生菜单 |
| 播放器区域全黑、控制条正常 | 视频 CDN 未拿到分片 | 检查 `Referer` 注入与登录态；换清晰度重试 |
| 播放器与槽位错位 | 页面缩放不是 100% | 已锁 `setVisualZoomLevelLimits(1,1)`；勿用 Ctrl+= 缩放 |
| 直播弹幕连不上 | 鉴权包缺 `uid`/`buvid` | 检查 Cookie 与握手包字段 |
| 直播全屏退不出 | 焦点在直播视图 / 页面被重载 | 直播页内 `Esc` + `liveBridge.exitFs()`；同流不重载 |
| 刷新后自动下滑 | 恢复了旧滚动位置 | 刷新时清除该路由 `scrollPos` |
| 动态只剩图片 | 请求缺少 `features=itemOpusStyle` | 补 features 参数 |
| 评论表情显示为文字 | 未解析 `content.emote` | 按映射替换为图片 |
| 私信显示 [系统消息] | 未按 `msg_type` 渲染 | 按第 11 节类型表处理 |
| 下载卡住 | CDN 无响应 | 60s 超时 + 30s 无进度检测，自动清理 `.part` |
| 下载的文件名变形 | B 站标题含 `? : |` 等非法字符 | 已被 `sanitizeFilename()` 替换为 `_`，属预期 |
| 命令行启动变成 Node 行为 | 环境里有 `ELECTRON_RUN_AS_NODE=1` | 启动前 `Remove-Item Env:ELECTRON_RUN_AS_NODE` |

---

## 22. macOS → Windows 移植差异表

| 层 | macOS 原版 | Windows 版 |
| --- | --- | --- |
| 窗口 | `titleBarStyle: hiddenInset` + 系统红绿灯 | `frame: false` 自绘标题栏，按钮在工具栏右侧 |
| 最大/还原 | 系统红绿灯 | 自绘按钮 + `window-state` 事件同步图标与 tooltip |
| 双击标题栏 | 系统行为 | 自绘区域监听 dblclick（排除按钮/输入框） |
| 全屏事件 | `enter/leave-full-screen` | Windows 不派发，改 `resize` + 定时重贴；退出后恢复最大化状态 |
| 字体 | SF Pro / PingFang SC | Segoe UI Variable / Segoe UI / Microsoft YaHei UI |
| 快捷键 | ⌘ 系 | Ctrl 系；另加 Alt+←/→、F5、F11、Ctrl+W |
| 侧栏顶部 | 82px（红绿灯留白） | 16px |
| UA | Mac UA | Windows UA |
| file:// 路径 | 手拼字符串 | `pathToFileURL()`（`file:///C:/…`） |
| 下载目录 | `/Volumes/NstyZ/Download` | `%USERPROFILE%\Downloads\BiliFound`，可在设置里改 |
| 下载文件名 | 少量字符过滤 | 完整 Windows 规则 + 保留名 + 长度截断 |
| 落盘改名 | `renameSync` | 失败时退化「复制 + 删除」 |
| 应用标识 | 仅 `setName` | 另加 `setAppUserModelId`（任务栏分组/图标归属） |
| 菜单 | macOS 应用菜单 + 窗口菜单 | 文件/编辑/浏览/视图/窗口/帮助，含「编辑」角色项 |
| 图标 | `iconutil` + `.icns` | Pillow 生成 `.png` + 多尺寸 `.ico`，rcedit 写入 exe |
| 打包 | `electron-packager --platform=darwin --arch=arm64` | `electron-packager --platform=win32 --arch=x64` + `--zip` |
| 安装形态 | `.app` | 免安装绿色目录 / zip |
| 测试 | `tools/native-test.js`（66 项） | `tools/probe-main.js`（12 项断言 + 20 张截图）+ `probe-layout.js` |

---

## 附：版本记录

> 下表是**开发期内部迭代号**（1.1.0 → 1.11.1）。对外发布统一使用 **1.0.0**，
> 两者不是同一套编号，不要混用。


| 版本 | 内容 |
| --- | --- |
| 1.11.0-win | 首页右上角新增「换一批」：清空当前推荐流、重新拉一批并重建轮播与网格 |
| 1.10.0-win | 设置新增「设计风格」：经典 / 杂志 / 极简 / 米纸 / 霓虹 5 个预设，即时生效并记忆 |
| 1.9.1-win | 修首页在 3 列等窄窗口下顶部留空格子：侧卡数量随列数调整，大卡改为独占整行 |
| 1.9.0-win | 首页列数按宽度自适应（小窗 4 列 / 全屏 5 列），顶部大卡改用同轨道 span 对齐 |
| 1.8.0-win | 直播页重排：左播放器 + 右侧弹幕栏（等级/粉丝牌/舰队徽章），新增点赞、表情、弹幕屏蔽 |
| 1.7.0-win | 搜索面板补齐「搜索历史 chips + bilibili 热搜两栏」（展开更多/清空/角标） |
| 1.6.0-win | 搜索预测：输入即出建议、命中词高亮、↑↓ 选择 / Enter 搜索；空输入回落最近搜索 |
| 1.5.0-win | 首页顶部大小混排：大轮播（3/5 宽、5 张、6 秒切换）+ 右侧 4 小卡，下方 5 列统一网格；小窗与全屏列数一致 |
| 1.4.0-win | 卡片改版：22 圆角 / 无边框 / 封面满宽 / 强阴影；内容区限宽 1440（内测，未对外） |
| 1.3.0-win | 应用内更新：静态清单 `latest.json` 检查/下载/校验 sha256/启动安装，启动时静默检查，菜单与设置入口；新增 `tools/make-manifest.js` |
| 1.2.0-win | 动态页「正在直播」显示真实总数；新增「关注的直播」完整列表页（无限翻页、去重），左栏加「全部 ›」入口 |
| 1.1.0-win | 播放页布局重做：顶部固定播放器 + 下方独立滚动，滚动时播放器收缩成迷你态；播放器滚轮转发；番剧/直播间同构，修掉原生视图脱位 |
| 1.0.0-win | 首个 Windows 版：自绘标题栏与窗口按钮、Ctrl 快捷键、Windows 下载目录与文件名规则、原生播放器/直播、动态/评论/私信/专栏、全屏与画质控制、图标与打包链路 |
| 1.0.0 | macOS 首个正式版 |

---

*本文档随代码同步维护；实现细节以 `main.js` / `renderer/app.js` 为准。*

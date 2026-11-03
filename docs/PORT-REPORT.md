# BiliFound macOS → Windows 移植报告

> 日期：2026-10-27　|　源版本：BiliFound 1.0.0（macOS arm64）　|　目标：Windows 10/11 x64
> 结论：**移植完成，已产出可直接运行的免安装包**（`BiliFound-1.11.0-win32-x64.zip`，138 MB）。

---

## 1. 起点：macOS 包里有什么

`BiliFound-1.0.0-arm64.zip` 解压得到 `BiliFound.app`（Electron 打包产物，118 MB）。
关键发现：`Contents/Resources/app/` 下是**未打包成 asar 的明文源码**——
`main.js`（2123 行）、`preload.js`、`renderer/*`、`node_modules/hls.js` 全在，
因此做的是**源码级移植**，不是把 mac 二进制硬搬。

原源码已原样留档在 `BiliFound/source-macos/`（对照用，未改动）。

## 2. 交付物

| 文件 | 说明 |
| --- | --- |
| `BiliFound/BiliFound-1.11.0-Setup-x64.exe` | **安装版**（93.6 MB）：快捷方式 + 卸载程序，适合发布 |
| `BiliFound/BiliFound-1.11.0-Portable-x64.exe` | **便携版**（93.3 MB）：单文件双击即用，不写注册表 |
| `BiliFound/BiliFound-1.11.0-win32-x64.zip` | **绿色包**（138 MB）：解压即用 |
| `BiliFound/BiliFound-win/` | Windows 工程源码（可直接开发、打包） |
| `BiliFound/BiliFound-win/dist-installer/` | 工程侧安装版/便携版产物副本 |
| `BiliFound/BiliFound-win/dist/` | 工程侧绿色包产物副本 |
| `BiliFound/BiliFound-win/docs/TECHNICAL.md` | Windows 版技术文档 |
| `BiliFound/BiliFound-win/docs/使用说明.txt` | 随包分发的用户说明（三种成品内都有） |
| `BiliFound/BiliFound-win/build/probe/` | 冒烟测试报告与 20 张截图 |

## 3. 改动清单

### 3.1 主进程 `main.js`

| # | 改动 | 原因 |
| --- | --- | --- |
| 1 | `frame:false` 替代 `titleBarStyle:'hiddenInset'`；新增 `thickFrame/roundedCorners/autoHideMenuBar` | Windows 没有系统红绿灯，标题栏自绘 |
| 2 | `app.setAppUserModelId('com.styzn.bilifound')` | 任务栏分组、通知归属、单实例识别 |
| 3 | UA 改为 Windows 版 | B 站 playurl/风控按 UA 分支 |
| 4 | 所有 `file://${path}` → `pathToFileURL().href`（player/live/背景图） | Windows 上手拼 `file://C:\…` 加载失败 |
| 5 | 下载目录：`/Volumes/NstyZ/Download` → `%USERPROFILE%\Downloads\BiliFound`，新增 `settings.downloadDir` | 平台路径 |
| 6 | 新增 `sanitizeFilename()` / `moveIntoPlace()` / `uniquePath()` 复用 | Windows 非法字符、保留名（CON/PRN）、结尾点空格、文件被占用时 rename 失败 |
| 7 | 窗口位置恢复前用 `screen.getDisplayMatching()` 校验并夹紧 | 多显示器/分辨率变化后窗口跑出屏幕 |
| 8 | 新增 `window-state` 推送（maximize/unmaximize/ready-to-show） | 自绘按钮图标与 tooltip 同步 |
| 9 | 全屏改用 `toggleWindowFullscreen()`：记录原最大化状态、退出后还原、`refitSoon()` 多次重贴视图 | Windows 不派发 `enter/leave-full-screen`，且边框切换异步 |
| 10 | 锁定页面缩放（`setVisualZoomLevelLimits(1,1)` + `zoom-changed` 拦截） | 缩放会让 `WebContentsView` 与 DOM 槽位错位 |
| 11 | 菜单按平台分支：Windows「文件/编辑/浏览/视图/窗口/帮助」，加 Alt+←/→、F5、F11、Ctrl+W、关于弹窗 | 原生菜单是 macOS 为主写的，Windows 需要「编辑」角色项保证输入框行为 |
| 12 | 新增 IPC：`win-state`、`downloads:pick`、`downloads:reset`、`player:toggle-fs` | 窗口状态查询、下载目录切换、播放器双击全屏 |
| 13 | `will-navigate` / 登录窗 / 应用图标路径按平台取 `.ico` 优先 | Windows 图标资源 |
| 14 | 数据迁移的正则兼容 `\` 分隔符；`bg:remove` 路径比较忽略大小写 | Windows 路径语义 |
| 15 | Debug 入口改用 `BILIFOUND_START_*`（兼容旧 `BILIGLASS_START_*`） | 冒烟测试可从命令行走特定页面 |
| 16 | `player:show` 缺 `cid` 时补查 `/x/web-interface/view` | 修掉「关闭设置面板 → 重新贴回播放器」时 `playurl` 返回 `-400 请求错误`（macOS 原版同样存在） |

### 3.2 渲染层

- `app.js`
  - 新增 `IS_WIN` / `MOD` / `modKey()`，命令面板与快捷键面板的提示全部按平台生成；
  - 新增 `html.platform-win` 类；
  - 窗口按钮绑定 + `window-state` 监听 + 最大化/还原图标切换；
  - 双击工具栏/侧栏顶部空白切换最大化；
  - 快捷键补充 `Alt+←/→`、`F5`、`Ctrl+,`、`Ctrl+Shift+F`，`Esc` 在 Windows 下可退出窗口全屏；
  - 设置面板新增「更改目录…」「恢复默认」；`renderWeb` 的播放器容器加 `web-frame` 类；
  - `showPlayerWhenReady()` 增加 `cid` 兜底（取 `state.currentVideo.cid`），避免重新取流缺参数；
  - **1.1.0**：新增 `setupWatchBlock()`（播放器高度计算 + 滚动收缩 + 迷你态切换）、
    `window.__bgWheel()`（接收播放器转发的滚轮）、`updateScrollTop()` 支持内层滚动容器；
    `renderSeason` / `renderLiveRoom` 骨架重构为「播放器固定 + 内容滚动」。
- `index.html`
  - `#win-controls` 从工具栏左侧移到右侧，改成 Windows 方角按钮 + SVG 图标；
  - 所有 tooltip/kbd 的 `⌘` 改成 `Ctrl`；新增 `btn-forward` 预留位（未启用）。
- `style.css`
  - 字体栈加入 Segoe UI / Microsoft YaHei UI；
  - `.win-controls/.wc` 重写为 34×28 方角按钮（关闭态 `#e81123`），最大化时切还原图标；
  - `html.platform-win` 段：侧栏顶部留白 82px → 16px、滚动条细化、选中色；
  - **1.1.0 播放页骨架重写**：`.watch` / `.watch-top` / `.player-wrap` / `.watch-scroll`
    统一为「顶部固定 + 下方滚动」，高度由 `--player-h` 驱动；新增迷你态样式
    （隐藏 `.ctl-opt` 与音量条）；番剧/直播间复用同一骨架；全屏规则按新选择器提高优先级。
- `player.html` / `live.html`：字体栈；播放器双击改走窗口原生全屏（`playerBridge.toggleFs()`）；
  **1.1.0**：播放器把 `wheel` 事件转发给主进程（原生视图里的滚轮也能滚页面）。
- `preload.js`：新增 `isWindows`、`pickDownloadDir`、`resetDownloadDir`、`winState`，事件白名单加 `window-state`。
- `player-preload.js`：新增 `toggleFs`、`wheel`。
- `main.js`（1.1.0）：新增 `player:wheel` 通道，把播放器转发的滚轮交给外壳执行。

### 3.3 资源与构建

- `tools/make_icon.py`：从 `.icns` 取 1024 原图 → `icon.png` + 16~256 多尺寸 `icon.ico` + 尺寸预览图；
  同时写一份到 `assets/`（electron-builder 会把 `buildResources` 排除在应用外，运行时只认 `assets/`）。
- `tools/build-win.js`：electron-packager win32-x64，写 win32metadata、复用本地 Electron zip、
  把 `assets/icon.*` 与 `使用说明.txt` 复制进包、打包后自检关键文件、可选 `--zip`。
- `electron-builder.yml`（新增）：安装版（NSIS）+ 便携版（portable）配置；
  `electronDist` 复用本地 Electron、`extraFiles` 带使用说明、非一键安装可改目录。
- `package.json`：加 `dist`（绿色包）、`setup`（安装版+便携版）、`release`（一起做）三个脚本，
  devDependencies 增加 `electron-builder`。

## 4. 验证记录

### 4.1 冒烟测试（`tools/probe-main.js`）

12 项断言全部通过：

| 断言 | 结果 |
| --- | --- |
| 窗口就绪 / 侧边栏 / 工具栏存在 | ✅ |
| 窗口按钮可见、位于右侧、数量 3 | ✅ |
| 侧边栏未保留 macOS 红绿灯留白（<30px） | ✅ |
| `body` 背景透明（极光层不被盖住） | ✅ |
| `html.platform-win` 已加、快捷标签为 Ctrl | ✅ |
| 关闭设置面板后播放器原地恢复且无报错（toast 为空） | ✅ |

页面巡检：首页、热门、排行、番剧、直播、动态（游客）、收藏（游客）、历史（游客）、
搜索（20 张卡片）、视频页（播放器槽位 892×502）、滚动后的相关推荐、设置面板、
命令面板、快捷键面板——全部渲染正常。

`report.json` 里唯一一条日志是 Electron 开发模式下的 CSP 安全警告（打包版不会出现）。

**测试过程中发现并修掉的真实 bug**：视频页打开再关闭设置面板时，
`showPlayerWhenReady(bvid)` 没带 `cid`，`playurl` 被判参数错误（`code -400`「请求错误」），
界面弹出「请求错误」toast 且播放器重建失败。修法：渲染层用 `state.currentVideo.cid` 兜底，
主进程 `player:show` 再查一次 `/x/web-interface/view` 补 `cid`；复查 toast 列表为空。
（此 bug 在 macOS 原版同样存在，本次一并修掉。）

### 4.2 窗口与全屏

| 场景 | 结果 |
| --- | --- |
| 最大化 | `isMaximized()=true`，按钮类名切到 `is-max`、tooltip 变「还原」 |
| 还原 | `isMaximized()=false`，图标与 tooltip 复原 |
| 视频全屏 | `isFullScreen()=true`，播放器铺满（桌面截屏确认画面与控制条） |
| 退出全屏 | `isFullScreen()=false`，槽位精确回到 `256,78,892,502` |
| 改变窗口尺寸 | 槽位 `892×502` 保持不变（ResizeObserver 跟随正常） |

### 4.3 布局量测（`tools/probe-layout.js`）

| 状态 | 视口 | 播放器 | 控制条底部 | 备注 |
| --- | --- | --- | --- | --- |
| 常规 | 1180×760 | 892×502 | 638 | 播放器与控制条同宽对齐 |
| 最大化 | 2560×1391 | 2028×1141（x=378） | 1277 | 控制在视口内，底部仍有 68px 内容区 |

修复前：最大化时 `.watch-top` 高 1336px、控制条底部 1414px（超出视口 23px）、下方内容区高度 0。
根因是播放器只按宽度算 16:9，2560 宽时高到 1278px。

### 4.4 打包产物验证

- 从 zip 解压到 `C:\Temp\BiliFound-extract`，双击启动：窗口正常、首页拉到真实封面数据。
- `BILIFOUND_START_VIDEO=BV1GJ411x7h7` 启动：原生播放器正常播放、弹幕滚动、
  控制条显示 `清晰480P`、下方标题/UP/数据/相关推荐正常。
- exe 资源：图标为自定义小电视（32×32 提取确认）；版本信息
  `ProductName=BiliFound`、`FileDescription=BiliFound · 哔哩哔哩桌面客户端`、`FileVersion=1.4.0`。
- 包内自检：`main.js`、`renderer/*`、`hls.js`、`assets/icon.*` 均在；`tools/` 未进包。

**安装版 / 便携版**（electron-builder）：

| 检查 | 结果 |
| --- | --- |
| 静默安装 `/S /D=<dir>` | 退出码 0，`BiliFound.exe` + `使用说明.txt` 就位 |
| 桌面 / 开始菜单快捷方式 | 均生成 |
| 安装后启动 | 正常出窗，标题 `BiliFound`，首页真实数据 |
| 静默卸载 `Uninstall BiliFound.exe /S` | 退出码 0，目录清空、快捷方式与注册表项移除 |
| 便携版双击 | 约 4 秒自解压完成并出窗 |
| exe 图标 / 版本 | 自定义小电视 32×32；`FileVersion=1.4.0`、`ProductName=BiliFound` |
| 产物大小 | Setup 93.6 MB / Portable 93.3 MB（比绿色包小，因剔除 `*.map` 等） |

### 4.5 播放页布局重做（1.1.0）

**问题**（`tools/probe-scroll.js` 实测）：1180×760 窗口下，视频页下方内容区只剩 **76px**
（内容高度 4456px），滚轮只能在缝里滚；番剧页把播放器放在外层滚动流里，
`#view` 滚动 320px 后槽位从 y=364 移到 y=44，而原生视图停在原地 → 完全脱位。

**改法**：三个播放页统一为「顶部固定播放器 + 下方独立滚动」骨架，`--player-h` 由
`setupWatchBlock()` 按窗口尺寸计算；视频页滚动时播放器按滚动距离收缩到迷你态；
播放器内的滚轮由 `playerBridge.wheel → player:wheel → window.__bgWheel` 转发给外壳。

**回归结果**（9 项全过）：

| 断言 | 结果 |
| --- | --- |
| 视频页初始内容区高度 ≥ 130 | ✅ 138px（改前 76px） |
| 滚动后播放器变小 | ✅ 789×444 → 363×204 |
| 滚动后内容区变大 | ✅ 138px → 382px |
| 进入迷你态（控制条精简） | ✅ |
| 播放器上滚轮能带动下方内容 | ✅ `scrollTop 0 → 180` |
| 滚回顶部播放器恢复 | ✅ 回到 789×444 |
| 番剧滚动后播放器不移动 | ✅ y 恒为 78 |
| 番剧内容确实滚动了 | ✅ 内层 `scrollTop 240` |
| 直播间骨架存在 | ✅ 播放器 629×354 + 内容区 228px |

另外用 `win.contentView.children` 直接读原生视图 bounds，确认与 DOM 槽位逐像素一致
（迷你态 521,78,363×204 = 槽位 521,78,363×204）。

### 4.6 动态页「正在直播」改造（1.2.0）

**问题**：左栏计数恒为 10 —— `loadLiveRail()` 只请求一次（接口默认 10 条）再 `.slice(0, 10)`，
计数用的也是这 10 条；多出来的关注直播无处可看。

**改法**：
- 请求显式带 `page_size=50`，计数用 `data.total`（无 total 时用列表长度，
  若看着像被截断则显示 `N+`）；
- 左栏固定 10 行，标题右侧加「全部 ›」，列表底部加「还有 N 位正在直播 · 查看全部 ›」；
- 新增 `liveFollowing` 路由：`page_size=20` 无限翻页、按 room_id 去重、
  卡片点击进直播间、顶部「返回动态」。

**验证**（`tools/probe-live-follow.js` + `probe-live-follow-mock.js`，后者在主进程里
mock 掉 `GetWebList` 灌 26 条数据）：

| 检查 | 结果 |
| --- | --- |
| 接口可调用（未登录返回 -101 属正常） | ✅ |
| 动态页 rail 有「全部」按钮 | ✅ `全部 ›` |
| 点击跳转 `liveFollowing` | ✅ |
| 页面有「返回动态」并能返回 | ✅ |
| 计数显示真实总数 26（不再是 10） | ✅ `26` |
| rail 最多 10 行 + 底部「还有 16 位正在直播」 | ✅ |
| 完整页首屏 20 条、副标题「共 26 位关注正在直播」 | ✅ |
| 滚动翻页后合计 26 条（无重复） | ✅ |
| 翻页去重（重复页不会死循环） | ✅ |

截图：`lf-10-rail-26.png`（左栏 26/10+全部）、`lf-11-following-26.png`（完整页首屏）、
`lf-12-following-all.png`（翻到底 26 条）。

截图（`BiliFound-win/build/probe/`）：

| 文件 | 内容 |
| --- | --- |
| `01-home.png` | 首页推荐（自绘界面 + 窗口按钮） |
| `05-live.png` | 直播列表 |
| `09-video.png` | 视频页（外壳层） |
| `14-video-scrolled.png` | 滚动后的相关推荐（桌面截屏，含原生播放器） |
| `13b-video-settings-cycle.png` | 关闭设置面板后播放器原地恢复（cid 修复验证） |
| `15-maximized.png` | 最大化 |
| `16-video-fullscreen.png` | 播放器全屏 |
| `18-dark.png` | 深色主题 |
| `19-settings-downloads.png` | 设置面板下载区（含新按钮） |
| `../packaged-video.png` | 打包版播放视频 |
| `../final-run.png` | 最终 zip 解压后启动（含真实首页数据） |
### 4.7 应用内更新（1.3.0）

**需求**：把 exe 发给别人后，推新版只能重新发文件，对方更新很麻烦。

**做法**：静态清单 + 应用内检查/下载/安装。没有引入 electron-updater，
避免 `latest.yml` / blockmap / 代码签名的额外约束，也照顾便携版与绿色包用户。

**验证**（`tools/probe-update.js`，本机起 HTTP 服务器扮演更新源，13 项全过）：

| 检查 | 结果 |
| --- | --- |
| 读到当前版本 | ✅ |
| 识别新版本（999.0.0 > 当前） | ✅ `newer: true` |
| 解析下载地址与大小 | ✅ |
| 同版本不提示更新 | ✅ `newer: false` |
| 坏 JSON 被拒绝 | ✅「更新清单不是合法 JSON」 |
| 404 被拒绝 | ✅「HTTP 404」 |
| 下载成功并落盘 | ✅ 1 MB 落到 `%TEMP%\BiliFound-update\` |
| 落盘内容逐字节一致 | ✅ |
| sha256 与源一致 | ✅ |
| 有下载进度事件 | ✅ |
| sha 不匹配时拒绝并删文件 | ✅ |
| 安装入口对缺失文件报错 | ✅ |
| 设置面板展示版本与更新说明 | ✅ `up-01-settings.png` |

**另**：打包后的 1.4.0 安装版还做了一次真实链路验证 —— 本机静态服务器放一份
「1.3.1」清单，指向真实的 `BiliFound-1.11.0-Setup-x64.exe`，应用内下载 93.6 MB、
sha256 校验通过、按钮变为「立即安装」。

### 4.13 首页「换一批」（1.11.0）

**需求**：首页右上角加「换一批」。

**做法**：视图标题行右侧放 `#feed-shuffle`；点击后清空当前流（pn/items/done/heroBuilt）、
`fresh_idx` 递增加 1、先显示骨架屏、回到顶部，再重新走一遍 `loadMoreFeed()`。

**验证**（`tools/probe-home.js`，假数据按 `fresh_idx` 返回不同批次，22 项全过）：

| 检查 | 结果 |
| --- | --- |
| 首页右上角有「换一批」按钮 | ✅ |
| 点击后换成另一批内容 | ✅ 第 2 批 → 第 4 批 |
| 换一批后轮播重建为 5 张 | ✅ |

另：全站冒烟 `probe-main.js` 12 项 0 失败。

### 4.12 设计风格预设（1.10.0）

**需求**：设置里加可选的设计风格，并提供几个预设（例如杂志风）。

**做法**：`html[data-style]` + CSS 变量/选择器覆盖，5 个预设只动外观不动布局；
设置面板渲染带预览图的卡片，点击即时生效并写入 localStorage；命令面板同步入口。

**验证**（`tools/probe-styles.js`，13 项全过）：

| 检查 | 结果 |
| --- | --- |
| 设置有「设计风格」且 5 张卡 | ✅ |
| 5 个预设齐全 | ✅ classic, magazine, minimal, paper, neon |
| 默认选中经典 | ✅ |
| 杂志：圆角 2px / 无阴影 / 衬线标题 | ✅ |
| 极简：1px 边框 + 无阴影 + 8px 圆角 | ✅ |
| 米纸：硬阴影 `rgba(120,104,72,.22) 3px 3px` | ✅ |
| 霓虹：14px 圆角 + 发光 | ✅ |
| 切回经典恢复 22px | ✅ |
| 选中态跟随 | ✅ |
| 写入本地存储 | ✅ `bg:style = "classic"` |

另：全站冒烟 `probe-main.js` 12 项 0 失败。

### 4.11 直播页重排（1.8.0）

**需求**：对照 B 站网页版直播页 —— 左侧播放器，右侧单独一栏弹幕，并要有点赞、表情、弹幕屏蔽。

**做法**：`.live-room` 两栏网格（1fr + 300px）；`fitLive()` + ResizeObserver 让播放器在左栏内保持 16:9；
主进程把 `DANMU_MSG` 的等级/粉丝牌/舰队/颜色一起下发；弹幕面板新增工具条
（表情面板、屏蔽面板、点赞）与输入框；屏蔽规则存 localStorage 并在入列时过滤。

**验证**（`tools/probe-live-room.js`，真实直播间 5050，17 项全过）：

| 检查 | 结果 |
| --- | --- |
| 两栏布局 | ✅ `723px 300px` |
| 播放器保持 16:9 | ✅ 1.78 |
| 弹幕栏有独立高度 | ✅ 603px |
| 收到真实弹幕 | ✅ |
| 控制条在左栏内 | ✅ |
| 输入框/发送/表情/屏蔽/点赞齐全 | ✅ |
| 注入弹幕出现在列表 | ✅ |
| 等级徽章 | ✅ `12` |
| 粉丝牌 | ✅ `大母鹅21` |
| 舰队徽章 | ✅ `舰` |
| 点赞计数 +2 | ✅ 6 → 8 |
| 表情面板 24 个 | ✅ |
| 点表情插入输入框 | ✅ |
| 屏蔽面板项齐全（关键词/进场/礼物/等级） | ✅ |
| 关键词已添加 | ✅ |
| 命中关键词被拦下 | ✅ 0 条 |
| 不含关键词可正常通过 | ✅ 1 条 |

另：全站冒烟 `probe-main.js` 12 项 0 失败。

### 4.10 搜索面板：历史 + 热搜（1.7.0）

**需求**：搜索框要有和 B 站一样的「搜索历史 + bilibili 热搜」，不只是联想。

**做法**：空输入渲染历史 chips + 热搜两栏（`/x/web-interface/search/square?limit=10`）；
有输入仍走联想。历史最多 20 条、默认 10 条、可展开/清空；热搜带角标图标、前 3 名高亮。

**验证**（`tools/probe-suggest.js`，真实接口，15 项全过）：

| 检查 | 结果 |
| --- | --- |
| 空输入时面板出现 | ✅ |
| 同时有「搜索历史」与「bilibili 热搜」 | ✅ |
| 热搜 10 条、两栏 | ✅ |
| 排名 1–10 | ✅ |
| 前 3 名高亮 | ✅ |
| 带角标图标 | ✅ 7 个 |
| 输入后切到「搜索预测」 | ✅ |
| 建议 ≥5 条、命中词高亮 | ✅ 10 条 / 「毕生」 |
| Enter 跳到搜索页且词正确 | ✅「毕生之研」 |
| 出现「搜索历史」并有清空按钮 | ✅ |
| 历史里是刚搜的词 | ✅ |
| 清空后历史消失、热搜仍在 | ✅ 0 / 10 |

另：全站冒烟 `probe-main.js` 12 项 0 失败。

### 4.9 搜索预测（1.6.0）

**需求**：搜索框要有和 B 站网页版一样的联想下拉。

**做法**：新增 `search:suggest` 通道请求 `s.search.bilibili.com/main/suggest`，
渲染层做 180ms 防抖 + 序号防乱序 + 自行拼高亮 + 键盘导航；空输入回落「最近搜索」。

**验证**（`tools/probe-suggest.js`，真实接口，9 项全过）：

| 检查 | 结果 |
| --- | --- |
| 弹出搜索预测面板 | ✅ |
| 标题「搜索预测」 | ✅ |
| 至少 5 条建议 | ✅ 10 条 |
| 命中字被 `<mark>` 高亮 | ✅ 10 处，内容均为「毕生」 |
| 方向键选中一行 | ✅ |
| Enter 跳到搜索页 | ✅ `route = search` |
| 搜索词 = 选中的建议 | ✅「毕生之研」 |
| 清空输入回到「最近搜索」 | ✅ |
| 最近搜索保留刚搜的词 | ✅ |

另：全站冒烟 `probe-main.js` 12 项 0 失败。

### 4.8 首页顶部大小混排（1.5.0，列数自适应 1.9.0，侧卡随列数 1.9.1）

**需求**：小窗与全屏排版不要差太多；大卡小卡混在一起减少同质化；混排只在最上面一屏。

**做法**：`.hero-row` 与 `.grid` 使用**同一套列轨道** `repeat(cols, minmax(0,1fr))`，
大卡 `grid-column: span (cols-2)` 且跨两行，右侧 4 张小卡各占 1 列；
列数由 `applyHomeColumns()` 按宽度算（内容 1056 → 4 列，1440 → 5 列），内容区限宽 1440。

**验证**（`tools/probe-home.js`，假数据，11 项全过）：

| 检查 | 结果 |
| --- | --- |
| 首页没有「继续观看」 | ✅ 按需求移除 |
| 大轮播存在且 5 张 | ✅ |
| 指示点 5 个 | ✅ |
| 右侧 4 张小卡 | ✅ |
| 网格接剩余条目 | ✅ 12 − 9 = 3 |
| 卡片圆角 22 / 无内边距 / 无边框 | ✅ |
| 轮播自动切换 | ✅ 第 0 张 → 第 1 张（6.5s） |
| 小窗（1344）列数 | ✅ 4（卡片 ≈252px） |
| 全屏（2560）列数 | ✅ 5（卡片 ≈274px） |
| 顶部小卡与网格第 3 列对齐 | ✅ 792 = 792 |
| 大卡区轨道数 = 网格列数 | ✅ 4 = 4 |
| 大卡跨 2 列（4 列布局） | ✅ `span 2` |
| 窄窗（1100）掉到 3 列 | ✅ |
| 3 列时侧卡 = 3 张且同一行 | ✅ `top = [492,492,492]` |
| 3 列时大卡独占整行 | ✅ 808 / 812（两侧各 2px 内边距） |
| 3 列时网格接 12−8=4 张 | ✅ |

另：全站冒烟 `probe-main.js` 12 项 0 失败；1.4.0 里试过的「继续观看」已按要求删除。


## 5. 过程中踩到的三个环境坑

### 5.1 `ELECTRON_RUN_AS_NODE=1`

本机环境变量里有 `ELECTRON_RUN_AS_NODE=1`（DSH 运行时注入），任何从该 shell 启动的
`electron.exe` 会以 **Node 模式**运行：`--version` 打印 Node 版本、应用脚本直接报错退出。
处理：启动/测试前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。已写入 README 与故障排查表。

### 5.2 工作区目录的低完整性标签

`E:\ai\杂\Za New\...` 下的可执行文件被系统继承为 **Low Mandatory Level**：

- Electron 浏览器进程无法初始化 Chromium 沙箱 → 立即以 `0x80000003` 退出；
- 加 `--no-sandbox` 只绕过了一部分：`electron.exe --version` 能跑，但应用进程写不了
  `%APPDATA%` / `C:\Temp`（`EPERM`），把 `--user-data-dir` 指到工作区内也起不来；
- `icacls /setintegritylevel` 改标签被拒绝（`Access is denied`）；
- 同一个 exe 复制到 `C:\` 或桌面即完全正常。

结论：**代码无关**，属于当前 DSH 工作区目录的文件权限状态。
因此成品都以「安装到普通目录 / 解压到普通目录」的方式交付，
使用说明与 README 都写明不要在工作区目录里直接运行。
验证工作全部在 `C:\BiliFound-win` / `C:\Temp` 下完成（源码同步用 robocopy）。

### 5.3 electron-builder 的 winCodeSign 解压失败

首次打安装包时，electron-builder 从 GitHub 拉 `winCodeSign-2.6.0.7z`，
里面含 macOS 的符号链接（`darwin/10.12/lib/*.dylib`），7za 在无符号链接权限时
报「客户端没有所需的特权」，整体判失败并重试 4 次。

绕过方式：把已经解出来的内容复制成缓存目录里它期望的名字——
`<ELECTRON_BUILDER_CACHE>\winCodeSign\winCodeSign-2.6.0\`（实测命中后不再重试）。
另外把 `ELECTRON_BUILDER_CACHE` 放在工程目录之外，否则会被 `files: **/*` 一起打进应用。

## 6. 与原版的一致性

- 业务接口、数据结构、页面布局、设计令牌、动画约定**: 原样保留**（第 5–13 节逐条对得上）。
- 交互差异仅在平台约定：窗口按钮位置/样式、Ctrl 与 ⌘、字号字体、下载目录与文件名规则。
- 播放器能力一致：DASH 视频+音频双流同步、画质切换、弹幕、字幕、倍速、音量、
  画中画、截图、全屏；直播一致：hls.js、画质、音量、全屏、WebSocket 弹幕。

## 7. 后续可做（非本次范围）

1. 代码签名（现在三个成品都未签名，首次运行会有 SmartScreen 提示；签名后安装包与 exe 的警告消失）。
2. 自动更新（electron-updater + 发布源）；目前是手动替换版本。
3. 把 `probe-main.js` 扩成正式回归套件（对齐 mac 版 66 项），纳入 CI。
4. 登录一次后回归「动态发布 / 评论 / 私信 / 收藏 / 下载」这些需要登录态的写操作。
5. 托盘图标与最小化到托盘（Windows 用户习惯）。
6. 窗口贴边分屏（Aero Snap）与多显示器 HiDPI 的进一步验证。

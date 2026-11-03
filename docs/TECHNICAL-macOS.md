# BiliFound 技术文档

> 版本：**1.0.1**　|　平台：macOS（Apple Silicon / arm64）　|　最后更新：2026-11-03
>
> BiliFound 是一个基于 Electron 的哔哩哔哩桌面客户端：界面**全部自绘**（不使用网页 DOM 套壳），
> 视频/直播为**原生视图 + 自建播放器**，网络请求全部由主进程携带登录态发起。

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
20. [已知限制](#20-已知限制)
21. [故障排查](#21-故障排查)

---

## 1. 项目概览

| 项目 | 说明 |
| --- | --- |
| 产品名 | BiliFound |
| 版本 | 1.0.1 |
| Bundle ID | `com.styzn.bilifound` |
| 安装位置 | `/Volumes/NstyZ/DSH/BiliFound.app` |
| 源码位置 | `/Volumes/NstyZ/DSH/BiliFound` |
| 界面形态 | 自绘 HTML/CSS/JS 单页应用（非网页套壳） |
| 视频/直播 | `WebContentsView` 原生视图 + 自建播放器（DASH / HLS） |
| 登录态 | 持久化分区 `persist:bili`，与网页版共享 Cookie 语义 |
| 主题 | 液态玻璃（Liquid Glass），支持浅色/深色/跟随系统、自定义背景 |

**设计目标**

1. **网页版功能对等**：视频、直播、番剧、影视、动态、评论、私信、专栏、搜索、收藏、历史、稍后再看、关注/粉丝。
2. **原生观感**：自绘界面 + 原生菜单 + 原生全屏，避免"网页套壳"的割裂感。
3. **视觉统一**：一套设计令牌驱动全部页面，液态玻璃质感贯穿始终。

---


### 1.1 1.0.1 新增能力

| 能力 | 说明 |
| --- | --- |
| 齿轮设置图标 | 顶栏偏好设置入口改为齿轮 SVG，线宽与其他图标一致 |
| 默认画质 | 设置 → 播放 → 默认画质（自动 / 4K / 1080P60 / 1080P+ / 1080P / 720P / 480P / 360P）；取流时优先使用，视频不支持则自动取该视频可用的最高画质 |
| 弹幕设置面板 | 视频页控制条「弹幕设置」：按类型过滤（滚动 / 固定 / 彩色）、随屏幕缩放、防挡字幕、智能防挡、屏蔽词、同步屏蔽列表，以及显示区域 / 不透明度 / 字号 / 速度滑块 |
| 音量全局记忆 | `settings.volume` 跟软件走：换视频、重启后沿用；播放器内（含全屏）调节会写回设置 |
| 更新地址默认仓库 | 更新源由 `package.json.repository` 派生 GitHub Releases；设置里可覆盖 |

## 2. 技术栈与依赖

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Electron `^38` | 主进程 + 渲染进程 + 独立视图进程 |
| 打包 | `electron-packager ^17` | 生成 `.app`，arm64 |
| 直播 | `hls.js ^1.7.3` | 直播 HLS 播放 |
| 图标 | Python + Pillow + `iconutil` | 透明背景小电视图标，全尺寸 icns |
| 测试 | 自研 Node 脚本 | 66 项端到端检查 |

渲染层**不引入任何前端框架**：原生 DOM + 事件委托 + 模板字符串，减少体积与层级复杂度。

---

## 3. 目录结构

```
BiliFound/
├── main.js                 # 主进程：窗口、视图、网络、IPC、业务（约 2100 行）
├── preload.js              # 主界面 preload，暴露 window.bg
├── player-preload.js       # 播放器视图 preload，暴露 window.playerBridge
├── live-preload.js         # 直播视图 preload，暴露 window.liveBridge
├── renderer/
│   ├── index.html          # 应用外壳：侧边栏、工具栏、设置面板、命令面板
│   ├── app.js              # 前端逻辑：路由、页面渲染、交互（约 5100 行）
│   ├── style.css           # 设计系统与全部样式（约 2250 行）
│   ├── player.html         # 自建播放器（视频 + 音频 + 弹幕 + 字幕 + 全屏控制层）
│   └── live.html           # 直播播放页（HLS + 画面弹幕层 + 退出全屏）
├── tools/
│   ├── make_icon.py        # 生成透明背景图标（icon.png / icon.icns）
│   └── native-test.js      # 端到端回归测试（66 项）
├── docs/
│   └── TECHNICAL.md        # 本文档
├── build/                  # 图标与测试截图（不打包）
└── package.json
```

---

## 4. 进程与视图架构

```
┌──────────────────────────── 主进程 main.js ────────────────────────────┐
│  BrowserWindow（外壳，titleBarStyle: hiddenInset）                      │
│  ├── webContents → renderer/index.html（自绘界面）                      │
│  ├── WebContentsView(player) → renderer/player.html（视频/番剧）        │
│  ├── WebContentsView(live)   → renderer/live.html（直播）               │
│  └── WebContentsView(web)    → 内嵌网页（网页版兜底/登录）              │
│                                                                        │
│  session.fromPartition('persist:bili')  ← 所有 API/媒体请求共用登录态   │
│  ipcMain.handle / ipcMain.on            ← 50+ 业务通道                  │
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

### 5.4 WBI 签名

```
getWbiKeys()  →  /x/web-interface/nav 取 img_key / sub_key
mixinKey()    →  按固定置换表重排得到 mixin_key
encWbi(params, mixinKey) → 排序 → 过滤特殊字符 → w_rid = md5(query + mixin_key)
```

`apiFetchWbi` 会自动附加 `wts` 与 `w_rid`，并复用同一套 Cookie。

### 5.5 媒体请求的 Referer

视频/直播 CDN 会校验 `Referer`。主进程通过 `webRequest.onBeforeSendHeaders`
对视频域名统一注入：

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
| 登录入口 | 侧边栏「登录」→ 内嵌 `passport.bilibili.com` 登录页 |
| 凭证存储 | Chromium Cookie（分区 `persist:bili`） |
| 关键 Cookie | `SESSDATA`、`bili_jct`（csrf）、`DedeUserID`、`buvid3/buvid4` |
| 登录态读取 | `/x/web-interface/nav` → `isLogin`、`uname`、`face`、`vip` |
| 写操作校验 | 所有 POST 自动带 `csrf=bili_jct` |
| 退出登录 | 清除分区 Cookie 并刷新界面 |

**说明**：`buvid3` 是直播弹幕鉴权与部分风控接口的必需项，登录后由 B 站自动下发。

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

### 7.3 画质切换

```
控制条「画质」→ 原生菜单 Menu.popup
  → player:quality { qn, startAt }
  → 主进程重新取流 → 播放器 __setSrc(videoUrl, audioUrl, startAt)
```

保留当前播放进度，切换后从原位置继续。

### 7.4 弹幕

```
/x/v1/dm/list.so?oid=<cid>   # XML
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
| 工具栏全屏 | 窗口全屏，保留侧边栏/工具栏 |
| 播放器全屏 | 窗口全屏 + 播放器视图铺满 + 隐藏外壳 + 播放器内控制条 |

实现：`player:fullscreen { on }` → 主进程 `setVideoFullscreen()`：

1. `win.setFullScreen(true)`
2. 播放器视图 `setBounds(contentBounds)`
3. 外壳加 `html.video-fs`（隐藏侧边栏等）
4. 播放器显示独立控制层（进度/音量/退出）
5. `Esc` 或「×」退出，精确还原槽位尺寸

窗口 `resize` / `enter-full-screen` 时重新贴合，避免多显示器切换错位。

### 7.7 下载

```
video:formats → /x/player/wbi/playurl?fnval=1   # MP4 合并流
video:download → ses.fetch 流式写盘
  → 写 <name>.part → 完成后 rename
  → AbortController 60s + 30s 无进度检测 → 清理 .part
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

### 8.4 直播间布局与互动

直播间为**左播放器 + 右弹幕栏**两栏结构：

- 左栏：16:9 播放器 + 控制条（音量/画质/全屏）
- 右栏：弹幕列表 + 输入框 + 表情 + 屏蔽 + 点赞

弹幕行包含：

- 用户等级徽章（`ls-lv`）
- 粉丝牌（`ls-medal`，颜色取自粉丝牌）
- 舰队徽章（`ls-guard`）
- 礼物 / 进场提示

**屏蔽**（保存在 `localStorage` 的 `bg:liveFilter`）：

| 规则 | 说明 |
| --- | --- |
| 关键词 | 弹幕内容或用户名命中即拦截 |
| 最低等级 | 低于设定等级的弹幕不显示 |
| 隐藏进场 | 过滤 `INTERACT_WORD` |
| 隐藏礼物 | 过滤 `SEND_GIFT` |

点赞通过 `/xlive/app-ucenter/v1/like_info` 发送，控件实时显示计数。

### 8.5 画质 / 音量 / 全屏

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
- `⌘↵` 快捷发送

---

## 11. 私信

### 11.1 接口（VC 旧版，网页版新接口被风控）

| 功能 | 接口 |
| --- | --- |
| 会话列表 | `/session_svr/v1/session_svr/get_sessions` |
| 聊天记录 | `/svr_sync/v1/svr_sync/fetch_session_msgs` |
| 发送消息 | `POST /web_im/v1/web_im/send_msg` |

主机：`api.vc.bilibili.com`。发送需要 `dev_id`（本地生成并持久化）。

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
| 首页推荐 | `/x/web-interface/wbi/index/top/feed/rcmd`（`fresh_idx` 递增，换一批/刷新换内容） |
| 搜索联想 | `/x/web-interface/wbi/search/suggest?term=`（返回 `tag` 候选，命中词标红） |
| 搜索热搜 | `/x/web-interface/search/square?limit=10` |
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

### 14.3.1 设计风格预设

设置 →「设计风格」提供 5 套预设，只改令牌与卡片外观，不动布局：

| 预设 | 特征 |
| --- | --- |
| 经典 | 默认液态玻璃 |
| 杂志 | 大字号标题、强对比、编辑排版感 |
| 极简 | 无阴影、细边框、低饱和 |
| 米纸 | 暖色纸感背景、衬线标题 |
| 霓虹 | 高饱和渐变描边、发光强调色 |

实现：`html[data-style="..."]` 切换 + 一段覆盖变量与卡片样式的 CSS；选择持久化在设置里。

### 14.4 布局与交互

| 特性 | 说明 |
| --- | --- |
| 侧边栏折叠 | `html.sidebar-collapsed` |
| 紧凑密度 | `html.compact` |
| 沉浸模式 | `html.immersive`（隐藏外壳，专注内容） |
| 视频全屏 | `html.video-fs` |
| 直播全屏 | `html.live-fs` |
| 命令面板 | `⌘K` |
| 快捷键 | `⌘R` 刷新、`⌘[`/`⌘]` 前进后退、`⌘F` 搜索等 |

### 14.5 滚动与动画

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
| `search:suggest` | invoke | `term` | 联想候选数组 |
| `win-state` | invoke | — | 窗口最大化/全屏状态 |
| `update:check` / `update:version` / `update:skip` | invoke | `{ force }` / version | 更新信息 |
| `update:download` / `update:install` / `update:reveal` | invoke | `asset` / `{ file }` | 下载进度 / 安装 |
| `downloads:pick` / `downloads:reset` | invoke | — | 修改下载目录 |
| `win-control` | on | `'min'｜'max'｜'close'` | — |
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
| `player:wheel` | `delta` | 播放器内滚轮转发给外壳 |
| `player:toggle-fs` | — | 播放器内双击切换全屏 |
| `player:state` | — | 当前时间/时长/音量/速率 |
| `player:fullscreen` | `{ on }` | 视频全屏 |
| `player:exit-fs` | — | 播放器内退出全屏 |
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
| `web:show` / `web:hide` | 内嵌网页视图 |

---

## 16. preload 暴露的 API

`preload.js` 通过 `contextBridge` 暴露 `window.bg`：

```js
window.bg = {
  api, apiWbi, actionPage, danmaku,
  playerShow, playerResize, playerHide, playerQuality, playerFormats,
  playerSubtitle, playerDanmaku, playerCmd, playerState, playerFullscreen,
  liveInfo, liveShow, liveHide, liveQualities, liveSetQuality, liveVolume,
  liveFullscreen, liveDanmakuStart, liveDanmakuStop, liveDanmakuSend,
  addComment, delComment, likeComment, replyAction,
  createDynamic, removeDynamic, emotePanel, uploadImages,
  imSessions, imMessages, imSend, articleLike,
  favFolders, deleteHistory, delWatchLater, copyText, saveImage,
  popupMenu, pickBackground, saveBackground, removeBackground,
  downloadsList, downloadsDelete, downloadsDir, openDownloads,
  on(event, cb) // 事件白名单：theme-changed / video-fullscreen / live-fullscreen / live-danmaku / downloads
}
```

- `player-preload.js` → `window.playerBridge.exitFs()`
- `live-preload.js` → `window.liveBridge.exitFs()`

安全设置：`contextIsolation: true`、`nodeIntegration: false`、仅白名单事件可订阅。

---

## 17. 本地存储

| 位置 | 内容 |
| --- | --- |
| `~/Library/Application Support/BiliFound/settings.json` | 主题、强调色、背景、播放设置、下载目录、`imDevId`、窗口尺寸 |
| `userData/backgrounds/` | 自定义背景图 |
| Chromium 分区 `persist:bili` | 登录 Cookie、缓存 |
| `localStorage` | 界面偏好（`bg:*` 前缀）、播放进度（`bg:pos:<bvid>`） |
| 下载目录 | 默认 `/Volumes/NstyZ/Download`（可通过设置修改） |

**配置迁移**：首次启动会从旧版 `BiliGlass` 用户目录迁移设置与背景（跳过缓存，仅迁移 ≤25MB 文件）。

---

## 18. 构建与打包

### 18.1 生成图标

```bash
# 图标由设计稿直接给出：files/icon/icon-1024.png
# 由 1024 PNG 生成 icns（sips + iconutil）
bash tools/make-icns.sh build/icon.png
# → icon.icns（替换 build/icon.icns）
```

旧版图标脚本 `tools/make_icon.py`（透明背景小电视）保留作参考。

### 18.2 打包

```bash
npx electron-packager . BiliFound \
  --platform=darwin --arch=arm64 \
  --icon=build/icon.icns \
  --app-bundle-id=com.styzn.bilifound \
  --app-version=1.0.0 \
  --overwrite \
  --ignore="^/build" --ignore="\.command$" --ignore="^/tools" \
  --ignore="/node_modules/electron/dist"

rm -rf /Volumes/NstyZ/DSH/BiliFound.app
mv BiliFound-darwin-arm64/BiliFound.app /Volumes/NstyZ/DSH/
```

### 18.3 启动

```bash
env -u ELECTRON_RUN_AS_NODE open /Volumes/NstyZ/DSH/BiliFound.app
```

### 18.4 应用内更新（GitHub Releases）

更新源按优先级：

1. `settings.updateFeed`（用户在设置里填的地址）
2. 否则由 `package.json` 的 `repository` 派生：
   `https://api.github.com/repos/<owner>/<repo>/releases/latest`

`checkUpdate()` 同时兼容两种响应：

| 来源 | 解析 |
| --- | --- |
| GitHub Releases API | `tag_name` → 版本，`body` → 说明，`assets[]` → 选 `BiliFound-mac-arm64.zip` |
| 自定义 `latest.json` | `version` / `notes` / `url` / `size` / `sha256`，支持 `platforms` 分流 |

下载：`update:download` 流式写盘并校验 sha256（若有）；安装：
macOS 的 `.zip` 先用 `ditto -x -k` 解压到临时目录再在 Finder 中揭示，`.dmg` 交给系统。

发布由 `.github/workflows/release.yml` 完成：打 `v*` tag → 构建 arm64 → 压缩 → 创建 Release。

### 18.5 发布前检查

```bash
# 确认正式包不含任何测试钩子
grep -c "BILIGLASS_TEST\|BILIFOUND_PROBE\|BILIFOUND_CLEANUP\|BILIFOUND_SHOT" \
  /Volumes/NstyZ/DSH/BiliFound.app/Contents/Resources/app/main.js
# 期望输出：0
```

---

## 19. 测试体系

`tools/native-test.js` 是端到端回归脚本，**66 项检查**，覆盖：

| 分类 | 示例 |
| --- | --- |
| 启动与外壳 | 窗口、侧边栏、主题切换、登录态 |
| 首页/热门/排行 | 卡片渲染、封面图、无限滚动 |
| 视频 | 打开、播放器视图尺寸、控制条、清晰度、续播、弹幕、字幕 |
| 评论 | 列表、分页、二级评论、排序、输入框、表情/图片 |
| 动态 | 关注流、富文本、图片、查看器、点赞、详情评论 |
| 直播 | 列表、原生播放、弹幕 |
| 番剧/影视 | 列表、原生详情、分集播放 |
| 搜索/UP/收藏/历史 | 结果、Tab 切换、合集 |
| 专栏 | 阅读页、正文长度、图片 |
| 私信 | 会话列表、消息渲染 |

**运行方式**：在临时包中注入 `BILIGLASS_TEST` 钩子后启动，脚本通过
`webContents.executeJavaScript` 驱动界面并断言。

**稳定性约定**

- 固定测试素材：视频 `BV1GJ411x7h7`、番剧 `33415`
- 随机内容（首页推荐、关注流）不做强断言，缺失时跳过而非失败
- 长视频（>120s）跳过下载测试
- 接口瞬时失败自动重试一次

---

## 20. 已知限制

| 限制 | 原因 / 说明 |
| --- | --- |
| 4K/杜比需大会员 | 与网页版一致，取决于账号权益与片源 |
| DASH-only 片源无法下载 | 下载接口使用 `fnval=1` 的 MP4 合并流 |
| 动态发图片最多 9 张 | 与 B 站一致 |
| 评论配图未做本地测试 | 上传接口已验证，未代用户在账号下发布 |
| 私信不支持撤回/语音 | 未实现 |
| 直播弹幕不显示用户等级/粉丝牌 | 仅渲染文本与颜色 |
| 应用全屏与视频全屏是两个入口 | 设计如此，避免误触 |
| 应用内更新清单需按平台提供 | macOS 用 `.dmg`/`.zip`，Windows 用 `.exe` |
| 直播屏蔽规则仅存本地 | 换设备需重新配置 |

---

## 21. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 启动后黑屏 | `body` 不透明遮住极光层 | 检查 `body { background: transparent }` |
| 页面出现白色横条 | 玻璃高光 `::before` 逃逸 | 给宿主加 `position: relative; isolation: isolate` |
| 画质菜单点不动 | DOM 菜单被播放器原生层遮挡 | 改用 `Menu.popup` 原生菜单 |
| 直播弹幕连不上 | 鉴权包缺 `uid`/`buvid` | 检查 Cookie 与握手包字段 |
| 直播全屏退不出 | 焦点在直播视图 / 页面被重载 | 直播页内 `Esc` + `liveBridge.exitFs()`；同流不重载 |
| 刷新后自动下滑 | 恢复了旧滚动位置 | 刷新时清除该路由 `scrollPos` |
| 动态只剩图片 | 请求缺少 `features=itemOpusStyle` | 补 features 参数 |
| 评论表情显示为文字 | 未解析 `content.emote` | 按映射替换为图片 |
| 私信显示 [系统消息] | 未按 `msg_type` 渲染 | 按第 11 节类型表处理 |
| 下载卡住 | CDN 无响应 | 60s 超时 + 30s 无进度检测，自动清理 `.part` |

---

## 附：版本记录

| 版本 | 内容 |
| --- | --- |
| 1.0.1 | 齿轮设置图标、默认画质、视频页弹幕设置面板、音量全局记忆、更新源默认 GitHub 仓库 |
| 1.0.0 | 首个正式版：首页大小混排 / 列数自适应 / 换一批；搜索联想 / 历史 / 热搜；直播间两栏 + 徽章 / 点赞 / 表情 / 屏蔽；5 套设计风格；应用内更新；全功能自绘界面、原生播放器 / 直播、动态 / 评论 / 私信 / 专栏、全屏与画质控制 |
| 1.0.0 | 首个正式版：全功能自绘界面、液态玻璃主题、原生播放器/直播、动态/评论/私信/专栏、全屏与画质控制 |
| 0.x | 内部迭代：布局重构、播放器 DASH、直播弹幕、私信富消息、专栏阅读、图标重制 |

---

*本文档随代码同步维护；实现细节以 `main.js` / `renderer/app.js` 为准。*

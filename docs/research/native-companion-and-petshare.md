# PetX 系统陪伴能力与 Petshare 接入调研

> 调研日期：2026-07-30
>
> 范围：`https://petshare.idevlab.dev/` 的匿名公开接入面，以及 macOS 上可用于“让宠物生活在电脑里”的公开系统能力。
>
> 证据边界：优先采用站点实时响应、站点官方源码和 Apple Developer Documentation。文中分别标记已确认事实、工程判断与不可行边界；本文不是法律意见。

## 结论先行

1. **Petshare 可以作为第二个原生直装源，但应直接下载两份静态文件，不必安装 ZIP。** 它公开了 `GET /pets.json`、逐宠物 `pet.json`、`spritesheet.webp` 和 ZIP。当前 13 个条目全部是 Pet V2，直接文件足以复用 PetX 现有的 schema、图片、摘要和原子写入校验。
2. **Petshare 不是动态社区 API。** 它是 GitHub Pages 上的静态 Vite 站点；没有公开分页、上传、账号、搜索、版本、增量同步或删除通知接口。搜索只在浏览器本地过滤已下载的 `pets.json`。
3. **Petshare 没有公布素材许可元数据。** 目录和逐项 manifest 都没有作者、来源、许可证、版本、文件大小或哈希；官方源码仓库也没有可识别的 `LICENSE`。因此 PetX 可以显示“来源：Petshare”，但不能显示“许可已验证”或暗示 Petshare 已替底层角色 IP 授权。
4. **macOS 没有公开 API 让普通第三方应用读取其他应用的通知内容。** `UNUserNotificationCenter` 只管理“你的 app”的通知，`getDeliveredNotifications` 也只返回“你的 app”仍在通知中心的通知。开启 PetX 自己的通知权限不会扩大到其他 app。
5. **能做出“住在电脑里”的感觉，不需要读通知。** 前台应用变化、应用启动/退出、用户空闲时长、睡眠/唤醒、屏幕睡眠/唤醒、电池/充电/低电量模式、热状态和网络路径变化都有 Apple 公开 API。它们适合转换成低频、克制、完全本地的宠物行为。
6. **默认产品边界应是“感知状态，不读取内容”。** 例如知道用户切到 Xcode，不读取窗口标题或代码；知道刚收到键鼠输入，不记录按键；知道网络离线，不读取 Wi‑Fi 名称；知道电量低，不采集设备序列号。

## 一、Petshare 的真实公开接入面

### 1.1 部署与页面结构

#### 已确认事实

- 站点首页是静态 HTML，加载一个 Vite 构建出的 React 脚本；匿名访问返回 `200`。
- 响应链带有 GitHub Pages/Fastly 标头，站点官方源码也通过 GitHub Actions 的 `actions/deploy-pages` 发布 `dist`。[部署工作流](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/.github/workflows/deploy-pages.yml#L18-L51)
- 官方 README 将它定义为静态 gallery，并说明素材从本机 `${CODEX_HOME:-$HOME/.codex}/pets` 同步成公开目录、两份静态素材和 ZIP。[Petshare README](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/README.md#L12-L33)
- 页面启动后只请求一次 `/pets.json`；名称搜索是针对 `id`、`displayName`、`description` 的本地过滤，没有服务端搜索请求。[页面源码](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/src/main.tsx#L114-L141)
- 详情弹窗提供 Idle、Run、Wave、Review 四种客户端动画预览，并直接链接 ZIP 和 manifest。[页面源码](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/src/main.tsx#L17-L22) · [下载与 manifest 链接](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/src/main.tsx#L96-L107)

#### 工程判断

PetX 不应把它抽象成需要分页或 OAuth 的远端市场。更准确的 provider 类型是“单文件静态目录”：

```text
GET https://petshare.idevlab.dev/pets.json
  -> 本地验证和搜索
  -> 选中条目
  -> 同源获取 pet.json + spritesheet.webp
  -> 本地校验和原子安装
```

### 1.2 目录接口

#### 已确认事实

2026-07-30 匿名实测：

```http
GET https://petshare.idevlab.dev/pets.json
200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: max-age=600
```

当前响应是一个包含 13 项的 JSON 数组。[实时目录](https://petshare.idevlab.dev/pets.json)

每项字段固定为：

```ts
type PetshareCatalogItem = {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 2;
  spritesheetPath: string;
  manifestPath: string;
  downloadPath: string;
};
```

示例：

```json
{
  "id": "bill-gates",
  "displayName": "Bill Gates",
  "description": "A tiny pixel-style Bill Gates-inspired coding companion...",
  "spriteVersionNumber": 2,
  "spritesheetPath": "/pets/bill-gates/spritesheet.webp",
  "manifestPath": "/pets/bill-gates/pet.json",
  "downloadPath": "/downloads/bill-gates.zip"
}
```

站点生成脚本也是从本地 manifest 取前三个展示字段，再构造三个站内绝对路径；目录没有隐藏的额外字段。[目录生成代码](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/scripts/sync-pets.mjs#L21-L35)

当前 13 个 id：

```text
bill-gates, columbina, doraemon, einstein, elysia, frieren, furina,
jobs, leijun, marx, nahida, trumpet, wenfeng
```

#### 接口没有提供的内容

- 没有 `generatedAt`、目录 schema 版本或游标。
- 没有宠物版本、更新时间或删除记录。
- 没有 `author` / `submittedBy`。
- 没有原作者页或逐宠物详情 URL。
- 没有 `license`、许可证 URL 或权利声明状态。
- 没有素材字节数、图像尺寸或 SHA-256。
- 没有服务端搜索、分页、标签或分类。

#### 工程判断

- 使用 `ETag` / `If-None-Match` 或 `Last-Modified` 做普通 HTTP 缓存，但不要把抓取时间伪装成目录生成时间。
- 目录可原地变更，条目路径也没有内容摘要，因此每次安装都必须重新验证下载结果。
- 给目录设置独立大小上限；当前只有约 5 KB，64 KiB 已有充足余量。
- 目录解析必须拒绝未知类型、空 id、重复 id 和条目数异常，不能直接信任 TypeScript 断言。

### 1.3 逐宠物 manifest 与图集

#### 已确认事实

所有 13 个逐宠物 manifest 当前都只有以下五个字段：

```ts
type PetsharePetManifest = {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 2;
  spritesheetPath: "spritesheet.webp";
};
```

[实时示例 manifest](https://petshare.idevlab.dev/pets/bill-gates/pet.json)

官方 README 声明所有包使用 Pet V2：`spriteVersionNumber: 2`，图集为 `8 × 11`、`1536 × 2288`，单元格 `192 × 208`。[V2 规格说明](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/README.md#L26-L33)

生成脚本要求每个源目录至少包含 `pet.json` 与 `spritesheet.webp`，并把这两份文件复制到公开路径。[同步脚本](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/scripts/sync-pets.mjs#L37-L56)

#### PetX 安装校验

对条目 `id`，只接受下面三个精确关系：

```text
spritesheetPath == /pets/<id>/spritesheet.webp
manifestPath    == /pets/<id>/pet.json
downloadPath    == /downloads/<id>.zip
```

随后还要验证：

1. `id` 只包含受限 ASCII slug，例如 `[a-z0-9][a-z0-9-]{0,79}`。
2. URL 以 `https://petshare.idevlab.dev` 为唯一 origin；禁止用户名、密码、非默认端口、query、fragment 和跨域重定向。
3. 逐项 manifest 的 `id` 必须与目录 id 相同。
4. `spriteVersionNumber === 2`。
5. `spritesheetPath === "spritesheet.webp"`，不能把 manifest 中的任意 URL 继续下载。
6. JSON、图片下载和图片解码都有独立上限。
7. WebP 能成功解码，且尺寸精确为 `1536 × 2288`。
8. 对实际下载字节计算 SHA-256；摘要是本地安装证据，不是假称上游签名。
9. 写入 `.staging`，完整验证后再原子移动到最终目录。

### 1.4 ZIP 下载

#### 已确认事实

- ZIP 是同源静态文件，例如 `GET /downloads/bill-gates.zip`，支持 HTTP Range。
- 2026-07-30 实测 13 个 ZIP 都只包含一个 `<id>/` 顶层目录，以及其中的 `pet.json`、`spritesheet.webp`。
- 当前 ZIP 大约 1.9–3.3 MB。
- 生成脚本运行系统 `zip -qr <zip-path> <id>`，也就是压缩整个本地宠物目录，而不是由固定条目白名单重新构造 archive。[ZIP 生成代码](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/scripts/sync-pets.mjs#L52-L60)

#### 工程判断

PetX 已能从逐项静态 URL 获取两个所需文件，所以**原生安装不要下载或解压 ZIP**。这样能直接避开 Zip Slip、符号链接、重复路径、压缩炸弹和以后源目录出现额外文件的风险。

ZIP 只适合两种用途：

- 用户在 Petshare 原站手动下载；
- PetX 提供“在浏览器查看来源”时，由浏览器处理。

如果未来必须导入 ZIP，应使用比当前上游生成脚本更严格的独立隔离解压策略，不能因“今天只有两个文件”而省略 archive 校验。

### 1.5 许可与再分发边界

#### 已确认事实

- `pets.json` 和所有逐项 `pet.json` 都没有许可证、作者、来源或权利状态字段。
- [`IchenDEV/petshare`](https://github.com/IchenDEV/petshare) 的公开仓库元数据没有识别到许可证，仓库树中也没有 `LICENSE` 文件。
- 当前目录包含哆啦A梦、原神、崩坏 3、葬送的芙莉莲等现有角色的衍生形象描述；也包含公众人物形象。
- 站点页面只说明可以下载和手动安装，没有逐项授权或再分发条款。[站点页面实现](https://github.com/IchenDEV/petshare/blob/0a4c1a55ecd403290231be73428c21ccc6a8b716/src/main.tsx#L181-L185)

#### 结论

公开可访问只能证明文件在该 URL 可下载，**不能证明**：

- 上传者拥有底层角色 IP；
- 允许 PetX 再分发、商用或制作衍生品；
- 允许把人物肖像用于任何特定用途；
- 仓库源码与素材受同一许可覆盖。

PetX UI 应显示：

```text
来源：Petshare
许可：上游未声明，请在使用前自行确认
```

不应显示：

```text
官方授权
版权安全
已验证许可
可商用
```

安装记录应保留 Petshare 首页、目录 URL、远端 id、安装时间和本地 SHA-256。由于没有逐项固定页面，来源链接可先使用站点首页，并额外保留 manifest URL。

### 1.6 推荐接入契约

建议把 Petshare 作为独立 provider，而不是混进 Petdex：

```ts
type PetshareSource = {
  id: "petshare";
  name: "Petshare";
  capability: "direct";
  url: "https://petshare.idevlab.dev/";
  licenseStatus: "unknown";
};
```

字段映射：

| PetX 字段 | Petshare 来源 | 说明 |
| --- | --- | --- |
| `slug` | `id` | 仍需本地 slug 校验 |
| `displayName` | `displayName` | 限制长度 |
| `description` | `description` | 仅展示文本，不能当授权说明 |
| `kind` | 固定 `codex-pet-v2` | 本地推导，不是上游字段 |
| `submittedBy` | `null` | 上游没有作者字段 |
| `spritesheetUrl` | 同源解析 `spritesheetPath` | 禁止跨域 |
| `petJsonUrl` | 同源解析 `manifestPath` | 禁止跨域 |
| `sourcePageUrl` | `https://petshare.idevlab.dev/` | 暂无逐项永久链接 |
| `license` | `unknown` | 明确显示未声明 |

推荐复用 Petdex 现有的“直接下载两文件 → 校验 → 本地摘要 → staging → 原子安装”链路，但 provider 的 host、目录 schema、路径关系和来源记录必须独立，不能放宽 Petdex 的 allowlist。

## 二、macOS 是否能读取其他应用的通知

### 2.1 Apple 公开 API 的明确范围

#### 已确认事实

- Apple 将 `UNUserNotificationCenter` 定义为管理“你的 app 或 app extension”的通知行为。[UNUserNotificationCenter](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
- `getDeliveredNotifications` 的文档标题和参数说明都明确限定为“你的 app 已投递且仍在 Notification Center 的通知”。[getDeliveredNotifications](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/getdeliverednotifications%28completionhandler%3A%29)
- User Notifications 框架允许 PetX 请求权限、发送自己的本地/远程通知，以及处理用户对 PetX 自己通知的操作。[User Notifications](https://developer.apple.com/documentation/usernotifications)

#### 结论

**普通第三方 macOS 应用没有公开 UserNotifications API 可以枚举或读取其他应用的通知标题、正文、发送者或附件。**

为 PetX 开启“允许通知”只意味着 PetX 可以向用户发通知；它不是“读取通知中心”的权限。Apple 当前也没有一个面向普通桌面应用的系统级通知读取授权弹窗。

### 2.2 不应采用的旁路

#### Notification Center 私有数据库

不读取 Notification Center 的磁盘数据库或相关 Group Container：

- 它不是 Apple 公布的数据契约；
- 路径和 schema 可以随系统更新变化；
- 会碰到 sandbox、文件保护和隐私边界；
- 即使技术上在某个系统版本可读，也不应被产品描述为“原生公开能力”。

#### Accessibility UI 抓取

Accessibility API 本身是公开 API，但 `AXIsProcessTrustedWithOptions` 代表的是范围很广的辅助功能信任，并会引导用户授权。[AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)

利用它遍历 Notification Center 的 UI 树仍然不是一个 Apple 文档化的“通知 feed”：

- 依赖系统 UI 的私有层级、控件名称和本地化；
- 系统小版本更新即可失效；
- 用户授予的是控制/读取界面的宽权限，远超宠物互动所需；
- 通知可能包含验证码、聊天、健康、工作和金融信息。

因此 PetX 默认版不应为“宠物读通知”申请 Accessibility，也不应抓取通知中心 UI。Apple 的 App Review Guidelines 还要求记录用户活动时取得明确同意，并强调数据最小化与可撤回授权。[App Review Guidelines 2.5.14、5.1.1](https://developer.apple.com/app-store/review/guidelines/)

### 2.3 可提供的替代体验

PetX 可以：

- 发送自己的本地通知，例如“我在桌面等你”，且由用户显式开启；
- 给 PetX 自己的通知添加“摸摸它”“休息一下”等 action；
- 根据前台 app、空闲、睡眠、电量、网络等**非内容信号**做桌面内反应；
- 以后提供明确的用户主动输入，例如拖文件给宠物或从 Share Extension 分享内容，而不是后台偷读。

## 三、可行的系统感知能力

### 3.1 能力矩阵

| 能力 | Apple 公开接口 | 可获得的数据 | 建议宠物行为 | 权限/隐私边界 |
| --- | --- | --- | --- | --- |
| 前台应用 | `NSWorkspace.frontmostApplication`、`didActivateApplicationNotification` | `NSRunningApplication`，可取 app 名称、bundle id | 切到 IDE 时戴眼镜；切到音乐 app 时轻轻摇摆 | 默认只做本地、粗粒度分类；不读窗口标题或文档名 |
| 应用启动/退出 | `NSWorkspace` launch/terminate notifications | 哪个 app 启动或退出 | 视频会议 app 打开时安静；游戏退出后欢迎回来 | 用户可按 app 关闭；不要形成上传的应用使用画像 |
| 用户空闲 | `CGEventSource.secondsSinceLastEventType` + `kCGAnyInputEventType` | 距上次键鼠/数位板输入的秒数 | 空闲后打盹；恢复输入后伸懒腰 | 只取聚合秒数，不装 event tap，不记录按键或鼠标轨迹 |
| 系统睡眠/唤醒 | `NSWorkspace.willSleepNotification`、`didWakeNotification` | 睡眠/唤醒事件 | 一起睡觉；唤醒时问候 | 事件本身不含用户内容 |
| 屏幕睡眠/唤醒 | `screensDidSleepNotification`、`screensDidWakeNotification` | 显示器睡眠状态 | 屏幕灭时收起动画，亮起后恢复 | 用于节能，不推断用户身份 |
| 会话活跃变化 | `sessionDidBecomeActiveNotification`、`sessionDidResignActiveNotification` | 用户会话切入/切出 | 会话离开时安静，回来时欢迎 | 不把它精确等同于每一种“锁屏”原因 |
| 电池与充电 | IOKit `IOPowerSources`、`IOPSNotificationCreateRunLoopSource` | 电量、是否充电、供电来源、变化事件 | 低电量时趴下；插电后精神起来 | 台式 Mac 可能没有内部电池；不读取序列号 |
| 低电量模式 | `ProcessInfo.isLowPowerModeEnabled`、power-state notification | 低电量模式开关 | 降低动画帧率和主动互动频率 | 这是节能信号，不代表精确剩余电量 |
| 热状态 | `ProcessInfo.thermalState`、thermal-state notification | nominal/fair/serious/critical | serious 时停止复杂动画 | 应首先真正降低资源占用，不只改变台词 |
| 网络状态 | `NWPathMonitor`、`NWPath` | satisfied、接口类型、expensive、constrained | 离线时拿出纸飞机；恢复后轻提示 | 不读取 SSID，不把 path satisfied 当作目标站点一定可用 |

### 3.2 前台应用

#### 已确认事实

`NSWorkspace.frontmostApplication` 返回接收按键事件的前台 app。[frontmostApplication](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)

`NSWorkspace.didActivateApplicationNotification` 的 `userInfo` 会携带表示相关 app 的 `NSRunningApplication`；必须向 `NSWorkspace.notificationCenter` 注册观察者。[didActivateApplicationNotification](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification)

#### 推荐边界

只建立设备本地的粗粒度类别：

```text
coding       Xcode, VS Code, Cursor, Terminal
meeting      FaceTime, Zoom, Teams
media        Music, Spotify, TV
creative     Figma, Photoshop
game         用户明确选择的游戏
other        其余应用
```

不要读取：

- 活跃窗口标题；
- 浏览器标签页 URL 或标题；
- 文档路径；
- IDE 工程名；
- 用户输入内容。

产品上提供总开关和 app 级忽略列表。建议只保留当前类别与短暂冷却时间，不生成长期“应用使用史”。

### 3.3 用户空闲

#### 已确认事实

`CGEventSource.secondsSinceLastEventType` 返回指定 Quartz event source 距上一次事件的秒数；使用 `kCGAnyInputEventType` 可得到上次键盘、鼠标或数位板输入距今多久。[CGEventSourceSecondsSinceLastEventType](https://developer.apple.com/documentation/coregraphics/cgeventsource/secondssincelasteventtype%28_%3Aeventtype%3A%29)

#### 推荐边界

- 每 10–30 秒查询一次即可，不需要全局键盘监听。
- 只保留分桶状态，例如 `active`、`away_5m`、`away_20m`。
- 不记录事件类型、按键、坐标、频率或精确时间线。
- 进入空闲只影响动画；不要扣除饱腹、关系或连续天数。

### 3.4 睡眠、唤醒与屏幕状态

#### 已确认事实

`NSWorkspace` 公开了设备 `willSleep` / `didWake`、屏幕 `screensDidSleep` / `screensDidWake`、会话 active/resign 等通知。[NSWorkspace 环境通知](https://developer.apple.com/documentation/appkit/nsworkspace#Responding-to-Environment-Notifications)

`didWakeNotification` 不携带 `userInfo`，只表示设备从睡眠中唤醒。[didWakeNotification](https://developer.apple.com/documentation/appkit/nsworkspace/didwakenotification)

#### 推荐行为

- `willSleep`：立即持久化状态，暂停计时器和动画。
- `didWake`：以墙上时间重新结算一次非惩罚性恢复，随机触发克制问候。
- 屏幕睡眠：将帧率降至零或隐藏 WebView，真正节能。
- 会话重新活跃：只在距离上次互动足够久时欢迎，避免每次解锁弹话。

### 3.5 电池、低电量模式与热状态

#### 已确认事实

IOKit 的 `IOPowerSources` 提供统一的电池与 UPS 状态读取，并支持电源变化通知。[IOPowerSources.h](https://developer.apple.com/documentation/iokit/iopowersources_h)

`kIOPSCurrentCapacityKey` 与 `kIOPSMaxCapacityKey` 可用于计算容量百分比，`kIOPSIsChargingKey` 表示充电状态。[电源字段](https://developer.apple.com/documentation/iokit/iopskeys_h/defines)

`IOPSNotificationCreateRunLoopSource` 在电源被添加、移除或状态变化时调用回调。[电源变化通知](https://developer.apple.com/documentation/iokit/1523868-iopsnotificationcreaterunloopsou)

`ProcessInfo` 提供 `isLowPowerModeEnabled`、`thermalState` 及相应变化通知；Apple 明确要求在高热状态减少 CPU/GPU、网络和动画等工作。[ProcessInfo](https://developer.apple.com/documentation/foundation/processinfo) · [响应电源通知](https://developer.apple.com/documentation/xcode/responding-to-power-notifications)

#### 推荐行为

- 电量低于 20%：宠物偶尔显示疲倦状态，但不制造焦虑式连续提醒。
- 开始充电：一次短反馈；不要反复播动画。
- Low Power Mode：主动降低动画帧率、刷新率和网络同步频率。
- thermal serious/critical：暂停非必要预览解码、粒子和主动行为。
- 没有电池时返回 `unavailable`，不要伪造 100%。

### 3.6 网络状态

#### 已确认事实

`NWPathMonitor` 是 Apple 提供的网络路径变化观察器，使用 `pathUpdateHandler` 接收变化。[NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor)

`NWPath` 提供 path status、接口类型、DNS/IPv4/IPv6 支持，以及 `isExpensive`、`isConstrained` 等属性。[NWPath](https://developer.apple.com/documentation/network/nwpath)

Apple 已将旧的 `SCNetworkReachability` 全部标记为 deprecated，并建议实际连接或在有限场景下使用 `NWPathMonitor`。[SCNetworkReachability](https://developer.apple.com/documentation/systemconfiguration/scnetworkreachability-g7d)

#### 推荐边界

- 用 `NWPathMonitor` 控制宠物库刷新、离线提示和重试。
- `satisfied` 只代表当前进程有可用网络路径，不代表 Petshare/Petdex 一定可达；实际请求仍需正常处理超时和 HTTP 错误。
- 不读取或展示 Wi‑Fi SSID。
- expensive/constrained 时不自动预取大图。

### 3.7 CPU 与聚合网络流量

#### 已确认事实

PetX 使用跨平台 `sysinfo` 的系统级 CPU 与网络接口计数接口，不枚举进程，也不分析数据包。`global_cpu_usage` 需要至少两次有间隔的刷新才能得到有意义的 CPU 使用率；网络接口则同时提供累计收发字节和相邻两次刷新间的增量。[sysinfo CPU 文档](https://docs.rs/sysinfo/0.38.4/sysinfo/struct.System.html#method.global_cpu_usage) · [sysinfo 网络文档](https://docs.rs/sysinfo/0.38.4/sysinfo/struct.NetworkData.html)

#### 实现边界

- 只有用户开启“桌面动静”后才建立采样基线；关闭时立即丢弃采样器与本次会话累计值。
- CPU 只向前端返回四舍五入后的系统总百分比，不返回进程列表。
- 网络只汇总非回环接口的字节计数；新出现或计数重置的接口先建立基线，避免制造流量尖峰。
- 只展示下载/上传速率和本次启用后的累计字节，不读取域名、URL、端口、请求正文、Wi-Fi 名称或单个进程流量。
- VPN 或虚拟网卡可能让聚合值与“物理网卡单独计数”不同，因此 UI 将其描述为系统接口聚合值，不伪装成精确的 HTTP 请求统计。

## 四、推荐产品形态

### 4.1 “系统感知”开关

设置页建议提供一个总开关和四个子开关：

```text
让宠物感知这台 Mac
  [开] 应用切换与启动
  [开] 空闲、睡眠与唤醒
  [开] 电量与节能状态
  [开] 网络连接状态
```

紧邻开关显示：

```text
这些信号只在本机转换成宠物动作。PetX 不读取通知、按键内容、
窗口标题、网页地址或文件内容，也不会上传应用使用记录。
```

每个子能力都能单独关闭，并提供“清除本地互动历史”。

### 4.2 事件到行为的映射

| 系统事件 | 宠物反应 | 冷却建议 |
| --- | --- | --- |
| 第一次切到编码类 app | 戴眼镜/翻开小本 | 30 分钟 |
| 连续编码 50 分钟且仍有输入 | 轻声建议伸展 | 90 分钟；允许永久关闭 |
| 5 分钟无输入 | 坐下或打盹 | 状态变化，不弹文案 |
| 输入恢复 | 伸懒腰 | 10 分钟 |
| 设备唤醒 | 早晚时段问候 | 4 小时 |
| 插上电源 | 开心一下 | 每次充电会话一次 |
| 低电量模式开启 | 降帧并说“我也省点力气” | 每次状态变化一次 |
| 网络离线 | 拿出纸飞机 | 只变动画 |
| 网络恢复 | 收起纸飞机 | 10 分钟 |
| 会议 app 成为前台 | 进入安静模式 | 直到离开会议类 app |

这些反应都不应改变关系值、制造惩罚或强制用户操作。

### 4.3 事件模型建议

平台层只产出低敏、语义化事件，不把原始系统对象直接暴露给 WebView：

```ts
type NativeCompanionEvent =
  | { type: "app-category-changed"; category: AppCategory }
  | { type: "idle-band-changed"; band: "active" | "away-5m" | "away-20m" }
  | { type: "system-sleeping" }
  | { type: "system-woke" }
  | { type: "screen-sleeping" }
  | { type: "screen-woke" }
  | { type: "power-changed"; level?: number; charging?: boolean; lowPowerMode: boolean }
  | { type: "thermal-changed"; state: "nominal" | "fair" | "serious" | "critical" }
  | { type: "network-changed"; online: boolean; constrained: boolean; expensive: boolean }
  | { type: "resource-sample"; cpuPercent?: number; downBytesPerSecond?: number; upBytesPerSecond?: number };
```

其中：

- bundle id 在原生层映射成类别后即丢弃，除非用户打开诊断模式；
- idle 秒数在原生层分桶，前端不接收原始精确值；
- 不定义 `notification-received`，因为没有合规的公开数据源；
- 所有 listener 在窗口销毁或应用退出时解除注册；
- 首次启用前展示清晰说明，不在后台静默扩大采集。

## 五、优先级建议

### P0：这轮可以完成

1. Petshare 独立目录、搜索、预览与两文件直装。
2. 前台 app 类别、空闲分桶、睡眠/唤醒。
3. 电池/充电/Low Power Mode 与网络状态。
4. 统一设置开关、冷却、事件去抖和完全本地说明。
5. Low Power Mode、屏幕睡眠和 thermal serious 时真正降低资源消耗。
6. 系统总 CPU 与非回环接口聚合流量；关闭感知后停止并清空采样。

### P1：随后增强

1. app 类别自定义和忽略列表。
2. PetX 自己的 actionable local notifications。
3. 用户主动拖拽文件给宠物，只读取明确拖入的文件元数据。
4. 用户主动分享文本给宠物的 Share Extension/Service。

### 不进入路线图

1. 读取其他 app 的通知内容。
2. 读取 Notification Center 私有数据库。
3. 申请 Accessibility 后抓通知中心 UI。
4. 全局记录按键、鼠标轨迹、窗口标题、浏览器 URL。
5. 采集 Wi‑Fi SSID、设备序列号或上传长期 app 使用画像。

这样做仍能让宠物对这台电脑的节奏产生真实反应，同时把“陪伴感”建立在可解释、低敏、公开 API 和用户可控的边界内。

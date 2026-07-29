# PetX 桌面宠物素材平台调研

> 调研日期：2026-07-30
>
> 范围：可以发现 Shimeji、桌面宠物、角色动画包或相关创作的分享/分发平台。
> 证据边界：只采用平台官方文档、官方帮助中心、官方 API 和站点自身条款；本文不是法律意见。

## 结论先行

PetX 不宜把所有站点都包装成同一种“下载源”。平台实际分成三类：

1. **现成的兼容直装源：Petdex。** 它是专门面向 Codex 动画宠物的公开画廊，提供稳定 HTTP manifest、逐项 `pet.json` / spritesheet URL 和官方 CLI 安装实现。它最适合 PetX 首版直接接入。
2. **可建立原生发布约定的通用源：GitHub Release。** 有正式搜索、Release Asset 下载、公开仓库免登录访问、许可证识别和部分资产摘要字段，适合作为第二个原生来源。
3. **授权后可下载源：DeviantArt。** 官方 API 能按标签/主题浏览，部分作品明确允许下载，但必须使用 OAuth，下载还受账号周限额和作者许可约束。它适合后续做“浏览 + 来源页 + 条件式下载”，不适合把所有搜索结果默认当作可安装宠物。
4. **只能浏览或交给原平台完成下载：itch.io、Steam Workshop、Nexus Mods、Shimeji 专门目录。** 这些平台要么没有面向第三方的公共文件下载 API，要么下载绑定平台客户端、AppID、购买状态、会员、登录或临时授权链接。PetX 首版不应通过抓网页、复用 Cookie 或猜测文件链接来绕开这些机制。

推荐接入顺序：

1. Petdex：原生浏览、下载、格式校验和本地收藏。
2. GitHub Release：在 PetX 发布约定或审核索引形成后接入。
3. itch.io RSS：原生浏览摘要，下载转到官方项目页或 itch 客户端。
4. DeviantArt：完成应用注册和 OAuth 后，按 `shimeji` / `desktop-pet` 标签浏览；仅对平台标记可下载且许可明确的条目开放下载。
5. Steam Workshop：只有 PetX 已在 Steam 上线、有自己的 AppID 并启用 Workshop 后再做。
6. Nexus Mods：只有找到合适的 PetX 游戏域、完成公开应用注册和 SSO 后再评估。
7. shimejis.xyz / shimeji.org：只提供外部浏览入口；不进入默认直装源。

## 平台对比

| 平台 | 浏览/搜索 | 官方 API 与认证 | 程序化下载 | 版权/许可信息 | PetX 建议 |
| --- | --- | --- | --- | --- | --- |
| Petdex | 专门的 Codex 动画宠物画廊 | 公共 manifest，无需登录 | 提供独立 `pet.json`、图集和 ZIP URL；官方 CLI 直接安装两文件包 | 素材权利归投稿者，平台不保证底层角色 IP | **首批直装源** |
| GitHub | 支持仓库搜索、Topic、Release 列表 | REST API；公共资源可免认证，认证后限额更高 | 支持 Release Asset 和仓库 ZIP 下载 | 可读取仓库 SPDX 许可证，但识别结果不一定覆盖素材本身 | **第二个候选直装源** |
| DeviantArt | 网页搜索；API 支持标签、主题等浏览 | OAuth2；浏览 scope | 仅作品允许下载时可取原文件；账号有周下载限额 | 作者条款、CC 设置和作品许可必须逐项判断 | **第二阶段条件式下载** |
| itch.io | 网站 Discovery/Search；浏览页可输出 RSS | Server API 需要 API Key/OAuth，但主要面向用户自己的账号、作品与购买验证 | 没有文档化的“全站任意项目文件下载”API | 发布者负责其内容权利；项目可收费、免费或限制访问 | **RSS 浏览 + 官方页下载** |
| Steam Workshop | 可在指定 AppID 下查询、筛选和排序 UGC | Steamworks / Web API Key / 有效 AppID | 下载由 Steam Client 和 `ISteamUGC` 执行，内容属于具体应用 | Workshop Contribution 是 Steam Subscription，另有应用条款 | **暂不接入；未来做 PetX 自有 Workshop** |
| Nexus Mods | API 可取最新、更新、趋势、文件信息 | 用户 API Key/SSO；公开应用需要向 Nexus Mods 注册 | Premium 可直接取链接；非 Premium 必须先经网站取得带时效 key 的 `.nxm` 链接 | 作者上传权限与分发约定不等于 PetX 可再分发 | **暂不接入** |
| shimejis.xyz | 有按作品/角色分类的 Shimeji Directory | 未发现公开 API | 官方流程面向其 Chrome 扩展，不是通用 PetX 包下载 API | 页面未提供可供 PetX 自动判断的逐条再分发许可 | **只外链** |
| shimeji.org | 有搜索、最新、热门、趋势和上传 | 未发现公开 API | 站点允许下载，但匿名上传、文件自担风险 | 官方条款明确其为非官方社区，且未提供逐文件授权保证 | **不纳入默认源；只外链** |

## 1. Petdex

### 已确认能力

- Petdex 官方仓库将产品定义为 Codex 动画伙伴的公共画廊，明确给第三方 builder 提供两个稳定面：`petdex.dev/api/manifest` 和 `pet.json + spritesheet` 包格式。[Petdex README](https://github.com/crafter-station/petdex#for-builders)
- 2026-07-30 实测 `https://petdex.dev/api/manifest/v2` 会重定向到 `assets.petdex.dev/manifests/petdex-v2.json`；清单声明 `v: 2`、统一 `assetBase` 和字段顺序，并在生成时间 `2026-07-29T13:51:09.601Z` 包含 4,239 个已批准条目。对应实现位于官方仓库的 [public manifest builder](https://github.com/crafter-station/petdex/blob/main/src/lib/public-manifest.ts)。
- 每个条目给出 slug、显示名、类型、投稿者、spritesheet、pet JSON 和可选 ZIP。PetX 不需要抓网页或解析投稿页即可浏览。
- 官方 CLI 的安装实现只接受 `assets.petdex.dev` HTTPS 资源，按 slug 获取 `pet.json` 与图集，并写入本地宠物目录；它不需要执行脚本或解压混合压缩包。[Petdex CLI installer](https://github.com/crafter-station/petdex/blob/main/packages/petdex-cli/bin/petdex.ts) · [asset host allowlist](https://github.com/crafter-station/petdex/blob/main/packages/petdex-cli/src/asset-hosts.ts)
- Petdex 官方说明源码是 MIT，但宠物素材权利属于各投稿者声明的许可；平台也明确承认大量内容是用户提交的 fan art，并提供下架流程。因此“已批准”可以作为格式/社区审核信号，不能当作底层角色 IP 授权保证。[Petdex IP and takedowns](https://github.com/crafter-station/petdex#pet-ip-and-takedowns)

### PetX 接入方式

- 浏览端只读取紧凑 v2 manifest；搜索和来源筛选在本地完成，离线时使用最后一次成功缓存。
- 安装命令只接收 slug，后端重新从受信 manifest 解析真实 URL，拒绝前端传入任意下载地址。
- 与官方 CLI 一样只取 `pet.json` 和图集，不解压 ZIP；另外补上 PetX 自己的字节上限、图像解码、精确尺寸、manifest schema、SHA-256 和原子写入校验。
- 本地另存安装来源、投稿者、manifest 生成时间和摘要，不把这些目录字段污染进渲染用 `pet.json`。
- 详情页始终显示“授权需自行确认”，保留 Petdex 原站与投稿者信息，不把平台审核描述成版权担保。

### 判断

**首版原生来源。** 它已经提供真实目录、兼容包和稳定下载面，接入成本和安全边界都比从通用站点猜测包格式更清晰。

## 2. GitHub

### 已确认能力

- GitHub REST API 提供 `GET /search/repositories`，可以用关键词、Topic、语言等限定仓库范围；这足以实现 PetX 内的分页搜索与来源筛选。[GitHub Search API](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#search-repositories)
- 公共数据可在不登录时访问。常规 REST 请求的未认证额度为每小时 60 次，认证用户通常为每小时 5,000 次；Search 有独立额度，未认证通常每分钟 10 次、认证后每分钟 30 次。客户端必须读取 `x-ratelimit-*` / `retry-after` 并缓存结果。[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- Release Asset 响应包含 `browser_download_url`，公开仓库的资产可以免认证下载；API 也支持以 `application/octet-stream` 获取文件，并要求客户端兼容 `200` 或 `302`。资产响应可包含 `size`、`content_type` 和 `digest`。[GitHub Release Assets API](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28)
- GitHub 还提供仓库 ZIP/TAR 归档下载，但整仓归档常混有源码和无关文件，不应作为 PetX 默认安装方式。[GitHub repository contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#download-a-repository-archive-zip)
- License API 能尝试从仓库 `LICENSE` 文件识别 SPDX 许可证；官方也明确说明，这个识别不覆盖依赖或写在其他位置的许可。因此它只能是筛选信号，不能代替宠物素材自身的授权声明。[GitHub Licenses API](https://docs.github.com/en/rest/licenses/licenses?apiVersion=2022-11-28)

### PetX 接入方式

不要搜索任意“shimeji”仓库后就提供一键安装。先定义 PetX 原生发布约定：

- 仓库必须有明确 Topic（建议后续统一为 `petx-pet`）或进入 PetX 签名/审核过的索引。
- Release 中必须存在独立资产，例如 `character-id.petx.zip`，而不是让客户端下载整个源码仓库。
- 压缩包根目录必须包含 `pet.json`、`spritesheet.webp`、`LICENSE`；PetX 当前的资产结构和 V2 图集规格见本仓库 [README](../../README.md)。
- Release Asset 如有 `digest`，必须比对；PetX 索引还应单独记录 SHA-256，避免旧资产没有摘要。
- 详情页展示仓库、作者、版本、许可证、来源页、发布时间和文件大小；许可证缺失时只允许“查看来源”，不提供“一键安装”。

### 判断

**适合在 PetX 发布约定或审核索引形成后做第二个原生直装源。** 当前版本先提供原站浏览；“来自 GitHub”本身不等于安全或获得了素材许可，必须叠加 PetX 包格式、许可证和完整性校验。

## 3. DeviantArt

### 已确认能力

- 官方 Developer Console 列出标签、主题、Top Topics、Daily Deviations 等浏览端点；标签自动补全端点要求 OAuth Access Token 和 `browse` scope。[DeviantArt Developer Console](https://www.deviantart.com/developers/console) · [Tags Search API](https://www.deviantart.com/developers/http/v1/20200317/browse_tags_search/2332c6ed7568338db4d76f3790a69c83)
- Deviation 对象会暴露 `is_downloadable`；官方 API 还列出 `/deviation/download/{deviationid}`，其语义是仅在作品允许时取得原文件下载。[DeviantArt API reference](https://www.deviantart.com/developers/http/v1/20210526/deviation_literature_create/956bc4f68e8f8891293c6950f1a4d483)
- DeviantArt 当前帮助中心说明：并非所有内容都能下载；允许下载也不代表获得所有权或使用许可。Non-Core/Core Basic 每周可免费公开下载 10 次，Core+ 及以上为 150 次。[DeviantArt download help](https://www.deviantartsupport.com/kb/en/article/how-do-i-buy-or-download-content-8172809)
- 官方分享礼仪要求尊重作者对作品展示、复制和外链的控制，并建议在不确定时向创作者询问、保留原作链接和署名。[DeviantArt sharing etiquette](https://www.deviantartsupport.com/kb/en/article/what-is-deviantarts-sharing-etiquette-policy)

### 风险

- API 文档搜索结果仍能看到旧版本提示，接入前必须用真实应用凭据验证当前端点、响应字段和限额。
- `is_downloadable` 只表达作者在 DeviantArt 上打开了下载按钮，不等于允许 PetX 再包装、再分发、商用或制作衍生品。
- Shimeji 素材常涉及第三方角色 IP；即便上传者同意下载，也未必持有角色权利。
- Premium Download、订阅内容或需要购买的文件不能被 PetX 绕过原平台交易流程。

### 判断

**第二阶段接入。** 首先只做标准化卡片、缩略图、作者和来源页。完成 OAuth 后，可以对同时满足以下条件的条目提供下载：

1. API 返回 `is_downloadable=true`；
2. 作品页有明确 CC 许可证或作者明确允许下载并用于桌面宠物；
3. 文件是可验证的 PetX 包，或只保存到隔离下载区而不自动执行/安装；
4. 保留作者、原作 URL、许可和下载时间。

任何一项不满足，就显示“在 DeviantArt 查看”，不显示“一键安装”。

## 4. itch.io

### 已确认能力

- itch.io 有正式的 Search/Browse（Discovery Pages）；项目只有公开、具备封面且可购买、下载或在线运行时才会进入索引。[itch.io indexing guide](https://itch.io/docs/creators/getting-indexed)
- 官方 API 概览提供一个很适合 PetX 浏览层的轻量入口：任意 Browse URL 后加 `.xml` 可获取 RSS，另有 new、featured、sales feeds。[itch.io API overview](https://itch.io/docs/api/overview)
- Server-side API 所有端点都需要 Bearer API Key 或 OAuth/JWT。公开文档列出的能力主要是当前用户资料、用户自己可编辑的作品、购买/下载 key 验证和版本查询，没有全站文本搜索或任意项目文件下载端点。[itch.io Server-side API](https://itch.io/docs/api/serverside) · [itch.io OAuth](https://itch.io/docs/api/oauth)
- 官方 itch 桌面客户端自己的方案也是“内置浏览器 + 在项目页点击 Install/Purchase”，由 itch 客户端处理拥有权、安装和更新。[itch app downloading guide](https://itch.io/docs/itch/using/downloading.html)
- 官方文档未公布固定 API/RSS 数值限额，因此 PetX 应做 ETag/本地缓存、低频刷新和 `429` 退避，而不是轮询。

### 判断

**适合做浏览源，不适合 PetX 直接代替 itch 完成下载。**

可实现：

- 读取 `desktop-pet`、`shimeji` 等筛选后的官方 Browse RSS；
- 展示封面、标题、作者、价格/免费状态和原项目链接；
- 点击“获取”时打开 itch 官方项目页，或检测到 itch 客户端时交给 itch。

不应实现：

- 抓取项目 HTML 寻找隐藏文件 URL；
- 复用用户浏览器 Cookie；
- 绕过购买、登录、下载 key 或发布者访问限制。

## 5. Steam Workshop

### 已确认能力

- `ISteamUGC` 支持对某个应用的 UGC 查询、订阅、下载状态和本地安装信息；查询要求有效的 Creator/Consumer AppID，不能当作跨所有 Workshop 的通用文件市场。[ISteamUGC](https://partner.steamgames.com/doc/api/ISteamUGC)
- Workshop 下载由 Steam Client 执行。订阅后，Steam 自动下载和更新；应用通过回调和 `GetItemInstallInfo` 读取本地结果。[Steam Workshop implementation guide](https://partner.steamgames.com/doc/features/workshop/implementation)
- Web API 的 `IPublishedFileService/QueryFiles` 需要 Web API key、AppID 和标签条件；Publisher key 必须放在安全服务端，不能随桌面客户端分发。[IPublishedFileService](https://partner.steamgames.com/doc/webapi/IPublishedFileService) · [Steam Web API authentication](https://partner.steamgames.com/doc/webapi_overview/auth)
- Steam Web API Terms 将一般上限写为每日 100,000 次调用。[Steam Web API Terms](https://steamcommunity.com/dev/apiterms)
- Workshop Contribution 属于具体 Workshop-enabled App 下的 Subscription，使用权仍受 Steam Subscriber Agreement 和应用特定条款约束。[Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)

### 判断

**当前不接入。** 不能从别的游戏/应用的 Workshop 把角色包抽出来装进 PetX。

未来只有在以下条件全部满足时才适合：

- PetX 已通过 Steam 分发并有自己的 AppID；
- 为 PetX 启用 Workshop；
- PetX 定义自己的 Workshop 包格式、审核和 EULA；
- 桌面端集成 Steamworks SDK，让 Steam Client 负责订阅、下载、更新和卸载。

在此之前，最多提供 Steam Workshop 的外部浏览链接，不显示“直接下载”。

## 6. Nexus Mods

### 已确认能力

- Nexus Mods 官方 API 可以获取最新、更新、趋势、Mod 元数据和文件信息；用户通过 API Key 或 SSO 登录。[Nexus Mods OpenAPI](https://api.swaggerhub.com/apis/NexusMods/nexus-mods_public_api_params_in_form_data/1.0/swagger.json) · [Nexus Mods API Acceptable Use Policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy)
- 公开应用不能长期使用开发者个人 API Key。官方要求测试完成后向支持团队注册应用，并禁止批量抓取/重托管数据、冒充其他应用或在服务端代用户存储个人 key 后自动调用。[Nexus Mods API Acceptable Use Policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy)
- 当前公开 API 限额为每 24 小时 20,000 次；耗尽后进入每小时 500 次额度，响应头会给出剩余额度和重置时间。[Nexus Mods rate-limit help](https://help.nexusmods.com/article/105-i-have-reached-a-daily-or-hourly-limit-api-requests-have-been-consumed-rate-limit-exceeded-what-does-this-mean)
- 官方 OpenAPI 说明：Premium 用户可直接生成下载链接；Non-Premium 用户必须先访问网站，从 `.nxm` 链接获得临时 `key` 和 `expires` 后再调用下载 API。[Nexus Mods OpenAPI](https://api.swaggerhub.com/apis/NexusMods/nexus-mods_public_api_params_in_form_data/1.0/swagger.json)
- Nexus 的上传规范要求上传者有相应权利，但平台也说明内容存在并不代表已获平台批准；每个文件的作者权限仍需单独判断。[Nexus Mods File Submission Guidelines](https://help.nexusmods.com/article/28-file-submission-guidelines)

### 判断

**当前不接入。** Nexus Mods 是“围绕具体游戏的 Mod 分发”，并非天然适配独立 PetX 宠物。真正接入至少需要：

- 确认存在合适的 PetX 游戏域或与 Nexus Mods 协商；
- 完成公开应用注册和 SSO；
- 对 Non-Premium 用户回到官网点击下载，不能代替网站生成授权；
- 不缓存、重托管或公开分享临时下载链接。

在此之前，即使搜索到相关角色 Mod，也只应打开来源页。

## 7. Shimeji 专门目录

### shimejis.xyz

shimejis.xyz 有按作品分类的目录，并明确引导用户“选系列 → 选角色 → 获取 Shimeji”；站点主体是 Chrome 的 Shimeji Browser Extension。[Shimeji Directory](https://shimejis.xyz/directory) · [Shimeji Browser Extension](https://shimejis.xyz/)

未找到对第三方开放的搜索 API、原始包下载 API、限额文档或逐条再分发许可证。目录中的大量条目又对应现有影视、动漫和游戏角色。因此：

- 可以在 PetX 的“更多来源”中打开目录；
- 不抓取其页面和 sprite 子域；
- 不把扩展专用资源转换后静默装入 PetX；
- 不把“目录可见”推断成“允许 PetX 再分发”。

### shimeji.org

shimeji.org 自称社区 Shimeji Library，提供搜索、Latest、Popular、Trending 和上传；同时明确声明自己是非官方社区、上传匿名、下载风险由用户承担，并以社区报告/人工移除处理风险。[shimeji.org](https://shimeji.org/) · [shimeji.org Terms](https://shimeji.org/terms)

这意味着它缺少 PetX 自动安装所需的身份、许可、审核和可信发布链。建议：

- 不纳入默认聚合搜索，避免为来源不明的匿名包增加可信背书；
- 如产品需要，可在“实验性来源”中仅提供外链，并清楚标记“社区上传、未经 PetX 验证”；
- 不从该站直接安装任何可执行文件、JAR、脚本或混合压缩包。

## 推荐的 PetX 产品与技术边界

### A. 浏览层

统一卡片模型可以包含：

```ts
type PetListing = {
  source: "github" | "deviantart" | "itch" | "steam" | "nexus" | "external";
  sourceId: string;
  title: string;
  author: string;
  previewUrl: string;
  sourceUrl: string;
  license: { status: "verified" | "declared" | "unknown"; label?: string; url?: string };
  compatibility: "petx-v2" | "convertible" | "unknown";
  acquisition: "direct-install" | "download-only" | "open-source-page";
};
```

界面上必须让用户一眼区分：

- **安装**：已经过格式、许可和完整性检查的 PetX 原生包；
- **下载到隔离区**：文件可下载，但不是可信 PetX 包，不会执行或自动加载；
- **去来源页获取**：购买、登录、订阅或平台客户端负责下载。

### B. 直装包门槛

只有以下条件全部通过才显示“安装”：

1. 来源域名和重定向域名在 provider allowlist；
2. 最终文件为独立 PetX 包，不是网页、安装器、JAR、EXE、DMG 或脚本；
3. ZIP 解压前检查压缩大小、展开大小和条目数；
4. 拒绝绝对路径、`..`、符号链接、硬链接和重复路径，防止 Zip Slip；
5. 只允许 `pet.json`、`spritesheet.webp`、`LICENSE`、`README` 及后续明确列入规范的静态资源；
6. `pet.json` schema 通过，`spriteVersionNumber === 2`，图集尺寸和帧布局通过；
7. SHA-256 与索引或 Release digest 一致；
8. 许可证明确允许用户下载和使用；作者、来源 URL、许可证与版本写入本地安装记录；
9. 先写临时目录，全部验证通过后再原子移动到宠物库；失败包立即删除或保留在明确标记的隔离区。

### C. 不应实现的做法

- 用 WebView 注入脚本，从第三方页面提取下载链接；
- 带着用户 Cookie 抓取登录后的页面；
- 绕过 Premium、购买、订阅、Download Key、AppID 或 Steam Client；
- 只依据文件名或扩展名判断安全；
- 把 GitHub 仓库许可证自动套用到其中所有角色美术；
- 把“可下载”文案解释为可再分发或可商用；
- 自动运行包中的 JAR、EXE、脚本或安装器。

## 可执行的首版范围

建议首版只做下面这条完整链路：

1. “宠物库”窗口提供来源筛选、搜索、详情和安装状态；
2. Petdex Provider 读取官方紧凑 manifest，并只接受 `assets.petdex.dev` 上的清单与图集；
3. 详情页展示投稿者、来源、兼容性和授权未知提示；
4. 下载到应用临时目录，完成 SHA-256、schema、图片解码和精确尺寸检查；
5. 不解压 ZIP，也不运行包内代码；
6. 验证通过后安装；不通过时给出可理解的原因，并保留“查看来源”；
7. GitHub 等第二个原生 provider 的 PetX 发布约定和审核索引稳定后再接入；
8. itch.io、DeviantArt、Steam、Nexus Mods 和 Shimeji 专门目录先出现在“更多来源”中，以外链和接入状态说明为主。

这样既能满足“有浏览、有直接下载”，又不会把所有第三方站点伪装成同等可信、同等可下载的素材仓库。

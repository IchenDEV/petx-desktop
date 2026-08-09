# PetX Desktop

一个最小、透明、无边框的桌面宠物应用。使用 [PetX React](https://www.npmjs.com/package/@petx/react) 渲染 Codex 宠物，使用 Tauri 2 打包 macOS、Windows 和 Linux 安装包。

## 已实现

- Frieren V2 宠物图集与 PetX 标准动画
- 透明、无边框、始终置顶的桌面窗口
- 初次见面、摸摸、玩耍与克制的主动问候
- 喂点心、一起休息、语义照料状态与按共同天数成长的关系阶段
- 本地关系记忆、关系纪念册与安静时段；离线不会生病、掉级或丢失关系
- 拖动位置、S/M/L 尺寸、开机启动与独立设置窗口
- 原生托盘菜单、右键菜单与“安静一小时”
- 独立“我的伙伴”：按最近使用与收藏时间保留本地历史，远端下架或离线后仍可切换
- “发现新伙伴”宠物库：浏览 Petdex 与 PetShare、搜索、预览、收藏、设为当前伙伴并随时换回默认伙伴
- GitHub、DeviantArt、itch.io 与 Steam 的安全原站浏览入口，以及下载后的 PetX 包导入承接
- macOS 隐藏 Dock 图标；Windows/Linux 跳过任务栏
- GitHub Actions 三平台打包矩阵

## 本地运行

需要 Node.js 20+、Rust stable，以及对应平台的 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run desktop:dev
```

仅预览 Web UI：

```bash
npm run dev
```

运行前端领域模型与存档迁移测试：

```bash
npm test
```

## 构建安装包

在目标操作系统上运行：

```bash
npm run desktop:build
```

产物位于 `src-tauri/target/release/bundle/`。macOS 本地构建使用 ad-hoc 签名，首次从网络下载后仍可能需要在“隐私与安全性”中允许打开；公开分发应在 CI 中配置 Developer ID 并完成公证。透明窗口使用 Tauri 的 `macOSPrivateApi`，因此当前形态不适合提交 Mac App Store。

推送 `v*` tag 会触发 `.github/workflows/build-desktop.yml`，分别生成 macOS Universal、Windows 和 Linux 安装包草稿。

## 操作

- 按住宠物本体直接拖动位置
- 单击宠物打招呼，双击宠物一起玩
- 在返回气泡中选择“照料一下”，或右键宠物打开照料、纪念册、宠物库、设置、临时安静与退出
- 在宠物库收藏伙伴后选择“设为当前伙伴”；切换会立即同步到桌面与纪念册，重启后仍会恢复
- 从其他商店下载兼容包后，解压并在“我的伙伴”选择其中的 `pet.json`；PetX 会校验并复制同目录图集
- 托盘菜单可重新显示宠物，关闭设置窗口不会退出应用
- 偏好与最多 7 段共同记忆只保存在本机；“开机启动”使用 Tauri 官方 Autostart 插件

## 发现新伙伴

宠物库把不同平台按实际能力分开处理：

- **Petdex**：应用内读取官方公共目录；收藏时后端按 slug 重新解析受信地址，只下载静态 `pet.json` 与图集。
- **PetShare**：应用内浏览公开目录并收藏经过相同尺寸、摘要和来源校验的静态清单与 WebP 图集；不会下载或解压站点 ZIP。
- **GitHub / DeviantArt / itch.io / Steam**：当前只在系统浏览器打开原站，不抓取隐藏下载链接，不复用登录 Cookie，也不绕过购买、订阅或平台客户端。
- **我的伙伴与用户导入**：所有本地收藏独立于远端目录显示，并记录收藏时间、最近使用时间与使用次数；用户可导入解压后的 `pet.json + spritesheet.webp/png` 兼容包。
- **本地安全**：远端图集先经过 HTTPS 域名白名单、响应大小、受限内存解码、文件类型、PetX V1/V2 尺寸和清单校验；收藏会复用用户刚刚预览并核对 SHA-256 的同一份图集，再以原子方式写入应用数据目录。
- **有界缓存**：最多同时处理 2 个图像任务；预览缓存限制为 256 MB / 160 项，按最近使用时间淘汰旧条目。
- **关系隔离**：每只伙伴按来源与 slug 保存自己的昵称、照料、关系和共同记忆；切回旧伙伴会恢复原来的相处记录，单纯收藏不会创建关系。

图库预览会缓存到应用缓存目录；目录请求失败时，如有上次成功缓存仍可继续浏览。平台审核或“允许下载”不等于获得角色版权，请在公开展示、再分发或商用前确认投稿者与权利方要求。

## Android / iOS 路线

Tauri 2 可以复用当前 React UI 和 PetX 资源到 Android/iOS 应用，但系统桌面小组件不是普通 WebView：

- Android：新增 App Widget（Kotlin/Glance），使用 PetX 图集生成静态/定时帧；受系统刷新频率限制。
- iOS：新增 WidgetKit Extension（SwiftUI），共享 `pet.json` 与 `spritesheet.webp`；小组件不支持持续逐帧动画，需要时间线或交互触发帧。
- 共享层：保持 `public/pets/<id>/pet.json + spritesheet.webp` 目录和设置数据模型不变，原生小组件只实现渲染适配器。

当前版本没有伪装成“已支持”移动端小组件；仓库结构和清单格式已经为它保留了清晰的扩展点。

## PetX 资产

默认资产位于 `public/pets/frieren/`，遵循 PetX V2（8 × 11、单帧 192 × 208）标准。桌面版可以直接在宠物库切换经过校验的本地伙伴；开发者也可以替换同目录下的 `pet.json` 和 `spritesheet.webp`。

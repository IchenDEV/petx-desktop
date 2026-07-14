# PetX Desktop

一个最小、透明、无边框的桌面宠物应用。使用 [PetX React](https://www.npmjs.com/package/@petx/react) 渲染 Codex 宠物，使用 Tauri 2 打包 macOS、Windows 和 Linux 安装包。

## 已实现

- Frieren V2 宠物图集与 PetX 标准动画
- 透明、无边框、始终置顶的桌面窗口
- 拖动位置、动画切换、尺寸调整、开机启动
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

## 构建安装包

在目标操作系统上运行：

```bash
npm run desktop:build
```

产物位于 `src-tauri/target/release/bundle/`。macOS 本地构建使用 ad-hoc 签名，首次从网络下载后仍可能需要在“隐私与安全性”中允许打开；公开分发应在 CI 中配置 Developer ID 并完成公证。透明窗口使用 Tauri 的 `macOSPrivateApi`，因此当前形态不适合提交 Mac App Store。

推送 `v*` tag 会触发 `.github/workflows/build-desktop.yml`，分别生成 macOS Universal、Windows 和 Linux 安装包草稿。

## 操作

- 按住宠物本体直接拖动位置
- 右键宠物展开/收起设置
- 双击宠物触发招手
- 设置会保存到本机；“开机启动”使用 Tauri 官方 Autostart 插件

## Android / iOS 路线

Tauri 2 可以复用当前 React UI 和 PetX 资源到 Android/iOS 应用，但系统桌面小组件不是普通 WebView：

- Android：新增 App Widget（Kotlin/Glance），使用 PetX 图集生成静态/定时帧；受系统刷新频率限制。
- iOS：新增 WidgetKit Extension（SwiftUI），共享 `pet.json` 与 `spritesheet.webp`；小组件不支持持续逐帧动画，需要时间线或交互触发帧。
- 共享层：保持 `public/pets/<id>/pet.json + spritesheet.webp` 目录和设置数据模型不变，原生小组件只实现渲染适配器。

当前版本没有伪装成“已支持”移动端小组件；仓库结构和清单格式已经为它保留了清晰的扩展点。

## PetX 资产

默认资产位于 `public/pets/frieren/`，遵循 PetX V2（8 × 11、单帧 192 × 208）标准。替换同目录下的 `pet.json` 和 `spritesheet.webp` 即可使用其他 Codex 宠物。

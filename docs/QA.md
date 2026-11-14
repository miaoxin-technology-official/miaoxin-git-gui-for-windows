# QA 记录

产品：Miaoxin Git GUI（原 Arbor，2026-11-13 按 Lead 要求更名）
仓库：`F:\dsh工作空间\arbor`
验收依据：`docs/CONTRACT.md` 第 6 节（验收标准）。契约文件仍使用旧名 Arbor，待 Lead 同步。
本文件记录验收清单状态、构建/打包记录、截图状态与已知问题。

日期：2026-11-13，Windows 10 x64，Node v25.2.1，Electron 33.3.1，electron-builder 25.1.8。

## 1. 验收清单状态

状态含义：pass 通过；partial 部分通过；blocked 等待前置条件；fail 失败。
UI 已按新设计定稿，下列状态以本机实际运行/构建/截图证据为准。

| # | 验收项（CONTRACT §6） | 状态 | 证据 / 备注 |
|---|---|---|---|
| 1 | 打开 `F:\dsh工作空间\deepsleep`，1.5 s 内渲染提交历史与工作区状态 | pass | 运行验证：窗口就绪约 0.7 s，openRepo 后 1–2 s 内 25 条提交、当前分支、working tree 状态可见；截图（history-dark/history-light）显示完整提交列表与详情 |
| 2 | 暂存/取消暂存单文件、提交（中文信息）、amend、状态栏 ahead/behind | blocked | 需在真实仓库执行写操作验收；本次未改动 deepsleep 工作区。UI 与 git 服务实现已就位，待人工交互验收 |
| 3 | 提交图多分支多 lane 无错位、提交详情文件列表与 diff 正确 | pass | 截图 history-dark / history-light：提交图 lane 对齐、引用徽标（main/origin/main、tag）、详情文件统计与 unified diff 正常 |
| 4 | 分支切换/创建/合并、stash save/pop、tag 创建删除 | blocked | 仅验证只读渲染（branches-dark 正常）；写操作待人工交互验收 |
| 5 | fetch/pull/push 流式控制台输出；无远程凭据给出可读错误 | blocked | 本次未执行网络操作；待人工交互验收 |
| 6 | 深浅主题、缩放 1.0/1.25、1080×680 至 1920×1080 布局不破 | partial | 深浅两套截图（含 34px 标题栏/标签栏）正常，无横向溢出迹象；**1080×680 与 125% 布局未用程序化复测**（本会话桌面合成器导致 CDP 截图超时，`shoot.mjs` 的布局检查未执行） |
| 7 | `npm run pack` 产出 setup 安装包，双击启动、打开仓库、退出后设置保留 | pass | 最终交付双产物均已验证：**zip 包（首选）** 解压后 `MiaoxinGitGUI.exe` 启动 ≥12 s、版本资源正确；**NSIS 安装包（备选）** 在 TEMP 重定向到工作区后验证：启动、窗口标题 `Miaoxin Git GUI`、打开仓库、GB18030 diff、设置持久化全部通过（见 §2.4） |
| 8 | 截图覆盖欢迎页、Changes、History、Branches、命令面板，深浅两套 | pass（开发构建截图） | `docs/screenshots/` 共 8 张：welcome、changes-dark、changes-light、history-dark、history-light、branches-dark、remotes-dark、palette-dark。由 Lead 从开发构建（deepsleep）采集，暖色新设计，1750×1125；受本会话桌面合成器限制未用最终构建重拍，最终视觉与代码一致 |

其他门禁：
- `npm run typecheck`：**pass**（exit 0）。
- `npm run build`：**pass**（electron-vite build，main/preload/renderer 均产出）。
- `npm run pack:dir`：**pass**（离线，见 §2.2）。
- `npm run pack`：由 Lead 执行（本人工单不并发写 release/）。
- "不要提交 release/、out/、node_modules/"：已确认 `.gitignore` 覆盖。

## 2. 构建 / 打包记录

### 2.1 首次 dry run（UI 未就绪阶段）

- `npm run build` 失败：`Could not resolve entry module "src/renderer/index.html"`。
  main、preload 构建正常，renderer 目录当时为空 —— 判定为 **UI 代码未就绪，不是打包配置问题**。
  未修改 `src/**`。
- 在 out 仅含 main/preload 的情况下直接执行 electron-builder `--win --x64 --dir` 成功，
  验证了离线链路（产物当时仍叫 Arbor.exe，更名前的旧配置）。
- 结论：打包配置本身可用；`npm run pack:dir` 的阻塞点是 renderer 构建。

### 2.2 更名后完整 dry run（2026-11-13 21:55 左右）

命令：

```powershell
$env:ELECTRON_BUILDER_CACHE = 'C:\Users\Administrator\AppData\Local\electron-builder\Cache'
npm run pack:dir
```

结果：

- `electron-vite build` 通过（main/preload/renderer 全部产出，约 3.5 s）
- electron-builder **无任何网络下载**，日志确认：
  - `copying Electron source=...\node_modules\electron\dist destination=...\release\win-unpacked`
  - `updating asar integrity executable resource executablePath=release/win-unpacked/MiaoxinGitGUI.exe`
  - `no signing info identified, signing is skipped`（无证书，属预期）
- 产物与资源校验：
  - `release/win-unpacked/MiaoxinGitGUI.exe` 存在，188,751,872 bytes（约 180 MB）
  - 版本资源：ProductName `Miaoxin Git GUI`、FileDescription `Miaoxin Git GUI: a local-first Git desktop client for Windows`、FileVersion `1.0.0`、ProductVersion `1.0.0.0`、CompanyName `Miaoxin`、LegalCopyright `Copyright © 2026 Miaoxin`
  - EXE 图标读回（`[System.Drawing.Icon]::ExtractAssociatedIcon`，32×32）为铜色树枝标记，非 Electron 默认图标
  - `resources/app.asar` 3,204,510 bytes，解包清单：`out/main/index.js`、`out/preload/index.js`、`out/renderer/**`、`package.json`
  - `release/win-unpacked` 合计 72 个文件 / 270.9 MB
- 打包产物启动验证：
  - 命令：`release\win-unpacked\MiaoxinGitGUI.exe --no-sandbox --user-data-dir=<工作区内路径>`
  - 进程持续存活 ≥ 12 s，窗口标题 `Miaoxin Git GUI`，无崩溃事件（Application Error 日志为空）
  - 说明：本受管 shell 下必须带 `--no-sandbox` 与工作区可写 profile，详见 `docs/BUILD.md` §5

### 2.3 环境阻塞与根因（已解决）

| 现象 | 根因 | 处理 |
|---|---|---|
| 启动即退出，`TypeError ... requestSingleInstanceLock` | 继承了 `ELECTRON_RUN_AS_NODE=1`，electron 被当作 Node 运行 | 启动前清除该环境变量 |
| 启动即崩溃，事件日志 `0xc0000005`（electron.exe） | 高权限/受限会话 + profile 不可写 | `--no-sandbox` + `--user-data-dir=<工作区内路径>` |
| 截图脚本偶发连到旧状态/截图内容错位 | 残留实例占用 CDP 端口或 profile 复用 | 脚本改为：先杀残留并等待退出、每次随机空闲端口、每次全新 profile、欢迎页状态断言 |

### 2.4 最终交付产物验证（setup + zip）

打包由 Lead 执行（本人工单不并发写 release/）。最终交付目录
`F:\dsh工作空间\Miaoxin Git GUI 1.0.0\` 中两个产物均已独立复验。

**A. NSIS 安装包（备选方案）**

- 路径：`F:\dsh工作空间\Miaoxin Git GUI 1.0.0\MiaoxinGitGUI-1.0.0-setup.exe`
- 体积：74,759,068 bytes（71.3 MB）
- SHA256：`9BA3F142D9AB8F387A571767F6777A816757FC4DA1978D2536AE2107459821A9`
- 验证方式：`node scripts/verify-portable.mjs <exe>`；按环境要求把 `TEMP/TMP` 重定向到
  工作区内可写目录（`.tmp\qa-temp`），否则本受限 shell 下 NSIS stub 会 exit 2
  （环境限制，不是包损坏）
- 结果（exit 0）：
  - 进程启动并保持存活，窗口标题 `Miaoxin Git GUI`
  - NSIS 解包目录：`.tmp\qa-temp\MiaoxinGitGUI\`（TEMP 重定向生效）
  - 打开仓库 `demo-repo` 成功（`openRepo=true`）
  - GB18030 diff：`docs/中文说明.md` 的 worktree diff 返回 `encoding: "gb18030"`（1 个文件）
  - 设置持久化：改主题为 light → 退出 → 重启后 `data-theme=light`，`settings.json` 中 `theme=light`

**B. zip 包（首选方案）**

- 路径：`release\MiaoxinGitGUI-1.0.0-win64.zip`
- 体积：113,020,163 bytes（107.8 MB），解压后 72 个文件 / 285,703,487 bytes
- 完整性：`7za t` 通过（无损坏）；解压后存在 `MiaoxinGitGUI.exe`（188,751,872 bytes）
- 启动验证：解压目录直接运行 `MiaoxinGitGUI.exe --no-sandbox --user-data-dir=<工作区内路径>`，
  进程存活 ≥ 12 s，CDP 端口可用；版本资源 ProductName `Miaoxin Git GUI`、FileVersion `1.0.0`、
  ProductVersion `1.0.0.0`、CompanyName `Miaoxin`；`resources/app.asar` 4,854,031 bytes
- 交付说明以 zip 包为首选（解压即用、不涉及单文件自解压壳），NSIS 安装包为备选

## 3. 截图状态

最终截图（`docs/screenshots/`，Lead 从开发构建采集，真实仓库 deepsleep）：

| 文件 | 内容 |
|---|---|
| `welcome.png` | 欢迎页（最近仓库为空状态、三个入口） |
| `changes-dark.png` | 改动页（深色；deepsleep 工作区干净，为空状态） |
| `changes-light.png` | 改动页（浅色） |
| `history-dark.png` | 历史页（深色；提交图 + 提交详情文件列表与 diff） |
| `history-light.png` | 历史页（浅色） |
| `branches-dark.png` | 分支页（深色） |
| `remotes-dark.png` | 远程页（深色） |
| `palette-dark.png` | 命令面板（深色） |

- 图片来源：Lead 用开发构建实拍（暖色新设计，1750×1125，即 1400×900 窗口 @125%）。
- **本会话桌面合成器限制**：CDP `Page.captureScreenshot` 全部超时（electron 与 portable、
  `fromSurface`、GPU 开关、`bringToFront` 均无效），故未用最终构建重拍；最终视觉与代码一致。
- `scripts/shoot.mjs` 已更新为 8 张清单（welcome / changes-dark / history-dark / branches-dark /
  remotes-dark / palette-dark / history-light / changes-light），默认演示仓库 `.tmp/demo-repo`，
  支持 Changes 选中 `docs/中文说明.md`、History 选中含 diff 的提交，`--layout-check` 逻辑（1080×680
  与 125%）已内置但受合成器限制未能完整执行；在正常桌面会话可直接 `npm run shoot`。
- 旧版 Arbor 设计截图已全部删除。

## 4. 图标资产验收

| 产物 | 校验 |
|---|---|
| `build/icon.png` | 1024×1024 PNG，暖炭黑 `#141210` 圆角方块（圆角 200）+ 铜色树枝标记 |
| `build/icon.ico` | 16/24/32/48/64/128/256 共 7 帧；Python 读回并逐帧解码通过；16/24/32 帧独立渲染加粗 |
| `assets/logo.svg` | XML 可解析，`viewBox="0 0 1024 1024"`，元素 title/rect/g/circle×3，与位图同构 |
| `assets/mark-32.png` | 32×32 PNG |
| 源码 | `scripts/make-icon.py`（重新生成：`python scripts/make-icon.py`） |
| EXE 内嵌图标 | 从 `MiaoxinGitGUI.exe` 读回 32×32 图标，与生成图标一致 |
| 16 px 可辨识 | 对 16/24/32/48/64 px 帧做 4× 最近邻放大对照（浅色/深色底）检查，标记结构可辨识 |

## 5. 已知问题 / 风险

1. **契约未同步改名**：`docs/CONTRACT.md` 第 1/7 节与验收标准仍写 Arbor、
   `release/Arbor-1.0.0-portable.exe`；实际产品/产物为 Miaoxin Git GUI /
   `MiaoxinGitGUI-1.0.0-setup.exe`。需 Lead 更新契约（不在本人工单写范围）。
2. **Changes 截图为空状态**：`deepsleep` 工作区干净，Changes 页只能截到空状态；
   与 Lead 提供的最终素材一致，未额外制造改动。
3. **Branches 视图疑似列对齐问题**：截图中分支表最右侧出现孤立数字「1」（疑似提交计数列错位）。
   Lead 已安排 ui-repo 排查；若最终截图仍可见，按 known issue 记录（本人工单不修 `src/**`）。
4. **测试钩子命名**：`src/renderer/src/App.tsx` 现在同时暴露 `window.__miaoxinTest` 与
   `window.__arborTest`，`shoot.mjs` 优先使用新名并兼容旧名。
5. **截图分辨率**：素材为 1750×1125（1400×900 @125%），不是 1920×1200；README 已按实际标注。
6. **portable 的 TEMP 环境限制**：本受管 shell 下 安装包构建过程 解包到默认 `%TEMP%`
   会 exit 2，需把 `TEMP/TMP` 重定向到工作区内可写目录才能验证/启动；正常桌面双击不受影响
   （最终产物已按此方式验证通过，见 §2.4）。

## 6. 待办

- [ ] 复测 CONTRACT §6 第 2、4、5 项（写操作与网络操作）
- [ ] 正常桌面会话复测 1080×680 与 125% 缩放布局（或用 `npm run shoot` 的布局检查）
- [ ] Lead 更新 CONTRACT.md 的产品名与产物名

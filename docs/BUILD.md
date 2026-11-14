# 构建与打包

本文档描述 Miaoxin Git GUI 在本机的构建、打包与离线约束。命令均在仓库根目录
`F:\dsh工作空间\arbor`（PowerShell）执行。

- 产品名：Miaoxin Git GUI
- 可执行文件名：`MiaoxinGitGUI`
- 当前版本：1.0.0（来自 `package.json` 的 `version`）
- 技术栈：Electron 33.3.1 + React 18 + TypeScript 5.7 + electron-vite 3 / Vite 6 + electron-builder 25.1.8

## 1. 环境说明

| 项 | 本机状态 |
|---|---|
| 操作系统 | Windows 10（10.0.19044，x64） |
| Node.js | v25.2.1（要求 ≥ 22，截图脚本依赖内置 `WebSocket`/`fetch`） |
| npm | 11.6.2 |
| Electron | 33.3.1，**手工解压**到 `node_modules/electron/dist` |
| electron-builder | 25.1.8，NSIS / winCodeSign / 7zip 使用本机缓存（离线） |
| Git | 2.55.0（应用运行时调用本机 git） |
| Python | 3.14（系统安装，含 Pillow 12.3.0），仅用于生成图标 |

### 1.1 不要执行 `npm install`

本机访问 Electron 官方下载源时 TLS 握手失败，`electron` 的 postinstall 下载会报错。
`node_modules` 已经是完整可用状态，Electron 二进制是**从本机缓存手工解压**的：

- 官方 zip 缓存：`%LOCALAPPDATA%\electron\Cache\electron-v33.3.1-win32-x64.zip`（约 115 MB）
- 解压目标：`node_modules\electron\dist`（`version` 文件内容为 `33.3.1`）
- 已逐文件比对：dist 的 73 个文件与官方 zip 的文件名、大小完全一致（无缺失、无多余）

如果必须重装依赖（不推荐），先跳过二进制下载，再从缓存补回：

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
npm install
Expand-Archive -Path "$env:LOCALAPPDATA\electron\Cache\electron-v33.3.1-win32-x64.zip" `
  -DestinationPath node_modules\electron\dist -Force
```

### 1.2 electron-builder 必须离线

`electron-builder.yml` 已固定使用本地 Electron，禁止 builder 再下载/解压 Electron：

```yaml
electronVersion: 33.3.1
electronDist: node_modules/electron/dist
```

NSIS、winCodeSign、7zip 由本机缓存提供，默认路径
`C:\Users\Administrator\AppData\Local\electron-builder\Cache`，已包含：

- `nsis-3.0.4.1`、`nsis-resources-3.4.1`
- `winCodeSign-2.6.0`（含 `rcedit-x64.exe`，用于写图标/版本资源）
- `7zip@1.0.0`

缓存若迁移到别处，用环境变量指向新位置，**不要**改用在线下载：

```powershell
$env:ELECTRON_BUILDER_CACHE = 'D:\builder-cache'
```

只有在缓存整体不可用、又有本地镜像时才考虑 `ELECTRON_BUILDER_BINARIES_MIRROR`；
日常构建优先方案始终是 `electronDist` + 本地缓存。

签名说明：本机没有代码签名证书，打包日志出现
`no signing info identified, signing is skipped` 属正常结果，不影响产物。

## 2. 命令

```powershell
npm run typecheck   # tsc --noEmit，node + web 两个 project
npm run build       # electron-vite build -> out/
npm run pack:dir    # 构建 + 未安装目录 release/win-unpacked/
npm run pack        # 构建 + NSIS 安装包 EXE
npm run shoot       # CDP 截图 -> docs/screenshots/（需先 build）
```

`pack:dir` 与 `pack` 的产物目录由 `electron-builder.yml` 的 `directories.output`
决定，为 `release/`。`release/`、`out/`、`node_modules/` 均不提交。

## 3. 产物

### 3.1 `npm run pack:dir`

```
release/win-unpacked/
  MiaoxinGitGUI.exe         约 180 MB（Electron 主程序，已写入图标与版本资源）
  resources/app.asar        约 3.2 MB（out/main + out/preload + out/renderer + package.json）
  *.dll / *.pak / locales/  常规 Electron 运行时
```

- 目录合计约 **271 MB / 72 个文件**
- 版本资源：ProductName `Miaoxin Git GUI`、FileVersion `1.0.0`、ProductVersion `1.0.0.0`、CompanyName `Miaoxin`
- 图标资源：`build/icon.ico`（16–256 px 多尺寸），可从 EXE 用
  `[System.Drawing.Icon]::ExtractAssociatedIcon()` 读回验证

### 3.2 `npm run pack`

```
release/MiaoxinGitGUI-1.0.0-setup.exe
```

安装包目标为 NSIS（非单文件自解压），产物为 `MiaoxinGitGUI-1.0.0-setup.exe`；可为当前用户安装（`perMachine: false`），默认目录 `%LOCALAPPDATA%\Programs\Miaoxin Git GUI`。
体积与首次启动耗时以最终构建实测为准，构建完成后需记录到 `docs/QA.md`。

## 4. 自定义图标与版本号

### 4.1 图标

图标源文件与生成脚本是本仓库唯一来源，修改后重新生成：

```powershell
python scripts/make-icon.py
```

输出：

| 文件 | 用途 |
|---|---|
| `build/icon.png` | 1024×1024 主图（透明圆角外区域） |
| `build/icon.ico` | 16/24/32/48/64/128/256 多尺寸，EXE 与安装器图标 |
| `assets/logo.svg` | 与位图同构的矢量版，供文档/界面引用 |
| `assets/mark-32.png` | 32×32 小标记 |

设计规范（与产品设计系统一致）：`#141210` 暖炭黑圆角方块（圆角 200）、
内描边 1 px `rgba(233,228,217,0.12)`；标记为一条主干 + 一条分支 + 三个节点
（线条与两个节点为铜色 `#C4763F`，分支末端节点为 `#E9E4D9`），线宽 52、圆角端点，
无渐变/发光/文字。16/24/32 px 帧单独渲染并加粗线条，保证 16 px 下仍可辨识。

依赖：Python + Pillow（本机系统 Python 3.14 已安装 12.3.0；也可用 DSH 打包 Python）。
替换图标时务必保留 ICO 的 256×256 帧，electron-builder 与 Windows 资源管理器都依赖它。

### 4.2 版本号与产品名

- 版本号：`package.json` 的 `version`（semver）。构建时写入 EXE 的
  FileVersion/ProductVersion，并替换产物名中的 `${version}`。
- 产品名：`electron-builder.yml` 的 `productName`、`win.executableName`、
  `shortcutName`、`artifactName`；同时需要同步
  `src/main/index.ts` 的 `app.setName()`、`app.setAppUserModelId()`、
  `BrowserWindow.title` 与 `src/renderer/index.html` 的 `<title>`。
- `appId`：`com.miaoxin.gitgui`，与 Windows 通知、任务栏固定相关，发布后不要再改。

## 5. 本机特殊启动约定（受管 shell / 高权限会话）

本项目在普通桌面上双击或 `npm run dev` 即可运行。但在 DSH 的受管 shell
（高完整性令牌 + 受限文件写入）里直接启动 Electron 会失败，验证/截图时必须：

1. **清除 `ELECTRON_RUN_AS_NODE`**
   该变量会让 `electron.exe` 退化为纯 Node 运行，表现为
   `TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')`
   或 `bad option: --enable-logging=...`。启动前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。
2. **加 `--no-sandbox`**
   高权限/受限会话中 Chromium 沙箱初始化会以 `0xc0000005` 崩溃；加 `--no-sandbox` 可正常启动。
3. **`--user-data-dir` 指向工作区内可写目录**
   该环境下 Electron 子进程对 `%APPDATA%`、`%TEMP%` 写入返回 `EPERM`，Chromium
   创建 profile 失败会直接崩溃。用类似
   `--user-data-dir=F:\dsh工作空间\arbor\release\qa-profile` 的路径。
4. **先清理残留实例**
   应用有 single instance lock，残留的 `electron.exe` / `MiaoxinGitGUI.exe` 会抢占
   profile 与调试端口：

   ```powershell
   Get-Process electron,MiaoxinGitGUI -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

`scripts/shoot.mjs` 已内置以上四点的处理（随机端口 + 每次独立 profile）。

## 6. 常见失败排查

| 现象 | 原因 / 处理 |
|---|---|
| `Could not resolve entry module "src/renderer/index.html"` | 渲染层尚未就绪（`src/renderer` 缺文件），属 UI 代码问题，不是打包配置问题 |
| `TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')` | 继承了 `ELECTRON_RUN_AS_NODE=1`，见 §5.1 |
| 启动即退出、事件日志 `0xc0000005`（electron.exe） | 高权限会话缺 `--no-sandbox`，或 profile 目录不可写，见 §5 |
| builder 日志出现 `downloading electron-v33.3.1-win32-x64.zip` | `electronDist` 未生效：路径写错或 `node_modules/electron/dist` 不存在 |
| builder 尝试下载 nsis / winCodeSign | 缓存路径不对：检查 `%LOCALAPPDATA%\electron-builder\Cache`，或用 `ELECTRON_BUILDER_CACHE` 指定 |
| `icon.ico` 不生效 | 确认 `win.icon` 指向 `build/icon.ico` 且 ICO 内含 256×256 帧，然后重新打包 |
| `npm run dev` 打开空白窗口 | 主进程先 `electron-vite dev` 起 renderer URL；在本机受管 shell 需按 §5 处理 |
| 打包产物双击后设置不保留 | 确认 `store` 写入的是 `app.getPath('userData')`，且未使用临时 profile |
| 单实例锁导致自动化脚本连到旧窗口 | 先按 §5.4 清理进程；`shoot.mjs` 使用每次独立 profile 规避 |
| `npm install` 报 TLS/certificate 错误 | 本机网络无法下载 Electron，不要重装，见 §1.1 |

构建日志、事件日志定位顺序建议：先看 `electron-vite build` 是否成功（UI 是否就绪），
再看 electron-builder 是否在下载资源（离线问题），最后看 EXE 能否启动（运行时环境）。

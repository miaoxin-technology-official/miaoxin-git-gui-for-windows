# Miaoxin Git GUI

面向 Windows 的本地优先 Git 桌面客户端。安装包内置 Git 2.47.1（MinGit），无需系统预先安装 Git，也不依赖系统 PATH；所有仓库操作直接调用本机（内置）git，不经过任何网络服务。
界面默认浅色主题，可切换暖炭黑深色；密集行高与细线分隔，面向日常提交、审阅与分支操作。

## 安装与 Windows 安全提示

支持 Windows 10（1809+）/ Windows 11 x64。当前版本**未做代码签名**，因此可能被系统或安全软件拦截；确认文件来自本仓库后按下面方式放行。

### Windows 11「智能应用控制」（Smart App Control）

Windows 11 的智能应用控制会阻止未签名/信誉未知的安装包。需要关闭后才能安装：

1. 打开「Windows 安全中心」。
2. 进入「应用和浏览器控制」→「智能应用控制」→「设置」。
3. 将状态切换为「关闭」。
4. 重新运行安装程序。

> 关闭后如需恢复，可在同一设置页重新开启智能应用控制；不同 Windows 版本的入口位置可能略有差异。
> 也可以先查看状态（管理员 PowerShell）：
> `Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState`
> 其中 0 = 关闭，1 = 开启，2 = 评估模式。

### Windows SmartScreen

首次运行安装包如提示「Windows 已保护你的电脑」：

- 点击「更多信息」→「仍要运行」；
- 或右键安装包 → 属性 → 勾选「解除锁定」后再运行。

### 360 安全卫士 / 腾讯电脑管家 / 火绒等

安装和首次启动时，安全软件可能提示「未知发布者」「风险程序」「正在修改系统/注册表」「添加开机启动」等，这是安装程序的正常行为：

- 弹窗中选择「允许」「信任」「加入白名单」；
- 若安装包被隔离/删除，到安全软件的「隔离区」恢复文件并添加信任；
- 如仍被拦截，可暂时退出安全软件 → 完成安装 → 重新开启，并将安装目录加入信任；
- 安装包会写入开始菜单/桌面快捷方式、卸载注册表项和 `%LOCALAPPDATA%\Programs\Miaoxin Git GUI`，这些都需要放行；
- 首次启动时如弹出「主动防御/核晶防护」询问，请选择允许。

### 校验安装包

下载后建议先核对 SHA256（Windows PowerShell）：

```powershell
Get-FileHash .\MiaoxinGitGUI-<version>-setup.exe -Algorithm SHA256
```

与 Release 页面公布的校验值一致后再安装。

> 彻底避免上述拦截需要为安装包购买代码签名证书（EV/OV）并签名；本版本暂未签名。

## 功能

- **仓库**：打开本地仓库、克隆远程仓库（流式进度）、初始化新仓库；最近仓库列表；
  设置中可指定 git 可执行文件路径。
- **改动**：按已暂存/未暂存/未跟踪/冲突分组，展示文件状态与增删行数；
  支持整文件与单个 hunk 的暂存/取消暂存、丢弃改动、暂存全部；
  多行中文提交信息、amend、Ctrl+Enter 提交。
- **历史**：提交图（多分支多 lane）、按提交信息/作者/hash 搜索、分页加载；
  提交详情含文件统计与 unified diff；checkout、reset、cherry-pick、revert、
  新建分支/标签、复制 hash。
- **分支**：本地与远程分组、当前分支标记、ahead/behind、搜索；
  切换、创建、重命名、删除、合并、变基、设置 upstream。
- **暂存（stash）**：保存、应用、弹出、删除、查看 diff。
- **标签**：创建、删除、查看标签与指向的提交。
- **远程**：远程增删改、fetch/pull/push、强制推送选项、流式控制台输出；
  无凭据或网络失败时给出可读错误，不崩溃。
- **命令行**：右侧约 1/3 的 Git Bash 命令行（默认打开），与左侧界面并排使用；
  可拖动调整宽度、可收起；在仓库目录执行命令，`cd`/环境变量等状态保留；
  支持命令历史、清屏、重启会话。优先用系统 Git Bash，未安装时用内置 bash。
- **界面**：34 px 标题栏 + 文字标签页、密集 28 px 行高、1 px 细线分隔；
  深/浅主题（默认浅色）与跟随系统、紧凑/舒适密度、UI 缩放、代码字号；
  命令面板、状态栏 ahead/behind、操作横幅、toast、可拖拽分栏。
- **仓库监听**：工作区变化时自动刷新（防抖），也可手动刷新。

## 技术栈

- Electron 33.3.1（主进程 + preload 上下文隔离）
- React 18.3 + TypeScript 5.7
- electron-vite 3.1 / Vite 6（`out/` 三进程产物）
- Zustand 5（状态管理）、lucide-react（图标，`strokeWidth 1.6`）
- 系统 UI 字体 Segoe UI / 微软雅黑；代码与哈希 Cascadia Mono / Consolas
- electron-builder 25.1.8（Windows NSIS 安装包，内置 Git 2.47.1 与 Bash）

## 开发

环境要求：Node ≥ 22（**运行安装包不需要系统 Git**，安装包已内置 Git 2.47.1）。首次准备依赖前请先阅读
[`docs/BUILD.md`](docs/BUILD.md)：本机 Electron 二进制为手工解压，**不要直接执行
`npm install`**（会因 TLS 证书失败）。

```powershell
npm run dev        # 开发模式（electron-vite dev，含 HMR）
npm run typecheck  # tsc --noEmit（node + web 两个 project）
npm run build      # 构建到 out/
npm run pack       # NSIS 安装包（内置 Git）-> release/MiaoxinGitGUI-1.4.0-setup.exe
```

在 DSH 受管 shell 等受限/高权限会话中验证界面时，需要
`--no-sandbox` 与工作区内 `--user-data-dir`，并清除继承的 `ELECTRON_RUN_AS_NODE`，
具体见 `docs/BUILD.md` 第 5 节。

## 打包

```powershell
npm run build      # 构建到 out/
npm run pack       # NSIS 安装包（内置 Git）-> release/MiaoxinGitGUI-<version>-setup.exe
```

构建离线进行：`electron-builder.yml` 的 `electronDist` 指向 `node_modules/electron/dist`，
NSIS / winCodeSign 使用本机缓存。图标与版本号的自定义方式、产物体积、常见失败排查见
[`docs/BUILD.md`](docs/BUILD.md)。验收记录见 [`docs/QA.md`](docs/QA.md)。

## 目录结构

```
src/
  main/        Electron 主进程：窗口、IPC、git 服务、仓库监听、设置、主题
  preload/     预加载脚本：window.arbor 类型安全 API
  shared/      跨进程共享类型与 IPC 通道常量
  renderer/    React 界面：components/、features/、styles/、store/、lib/
build/         打包资源（icon.png、icon.ico）
assets/        logo.svg、mark-32.png
out/           构建产物（不提交）
release/       打包产物（不提交）
```

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl+K` | 打开/关闭命令面板 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+R` | 刷新仓库状态 |
| ``Ctrl+` `` | 收起/展开右侧 Git Bash 命令行 |
| `Ctrl+1` … `Ctrl+6` | 切换到 改动 / 历史 / 分支 / 暂存 / 标签 / 远程 |
| `Ctrl+Enter` | 提交（提交信息框内） |
| `Ctrl+F` | 聚焦历史搜索 |
| `Ctrl+A` | 在改动列表全选文件 |
| `Delete` | 丢弃选中的改动（需确认） |
| `Esc` | 关闭弹层 / 清空搜索 / 取消多选 |

## 许可

AGPL-3.0-or-later (GNU Affero GPL v3 or any later version). See LICENSE.

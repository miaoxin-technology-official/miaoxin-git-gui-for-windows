# THIRD-PARTY-NOTICES

Miaoxin Git GUI 1.3.6 — 第三方组件与许可证说明

本应用自身代码以 **AGPL-3.0-or-later** 发布（见 `LICENSE`）。本文件列出随安装包/源码分发或构建时使用的第三方组件及其许可证，便于合规审查。完整许可证文本随组件或本仓库一并提供。

## 1. 随应用运行时分发的组件

| 组件 | 版本 | 许可证 | 说明 / 完整文本位置 |
|---|---|---|---|
| Electron | 33.3.1 | MIT | `resources/` 内 `LICENSE.electron.txt`；上游 https://github.com/electron/electron |
| Chromium（Electron 内置） | 随 Electron | BSD-3-Clause 及多个第三方许可证 | `resources/LICENSES.chromium.html`（随 Electron 分发，未修改） |
| Node.js（Electron 内置） | 随 Electron | MIT | 见 Electron 的 license 文件与 https://nodejs.org |
| React / ReactDOM | 18.3.1 | MIT | https://github.com/facebook/react |
| Zustand | 5.0.2 | MIT | https://github.com/pmndrs/zustand |
| lucide-react（图标） | 0.468.0 | ISC | https://github.com/lucide-icons/lucide |
| @xterm/xterm | 5.5.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-fit | 0.10.0 | MIT | 同上 |
| Git for Windows / MinGit | 2.47.1 | GPL-2.0-only | `resources/git/LICENSE.txt`；源码 https://github.com/git-for-windows/git |
| MSYS2 runtime / bash（内置 Git Bash） | 随 Git for Windows | GPL-3.0-or-later（MSYS2/Cygwin 系） | 完整 GPLv3 文本：`resources/git/THIRD-PARTY-LICENSES/GPL-3.0.txt`；说明见 https://www.msys2.org/ 与 https://cygwin.com/licensing.html |
| OpenSSH（内置 ssh.exe 等） | 随 Git for Windows | BSD 风格（OpenSSH） | 许可证随 Git for Windows 分发 |
| curl / expat / zlib / brotli 等 Git 依赖库 | 随 Git for Windows | 各自许可证 | `resources/git/mingw64/share/licenses/` |
| NSIS 安装器运行时 | 3.x | zlib/libpng（NSIS） | 仅安装器引导代码；https://nsis.sourceforge.io/License |

说明：
- Git for Windows（GPL-2.0-only）与 bash/MSYS2（GPLv3+）作为**独立可执行程序**随应用聚合分发，不与应用主程序静态链接；其源码与构建脚本可从上述上游地址获取，符合 GPL 的源码提供要求。
- Electron/Chromium 的完整第三方许可证汇总以 `LICENSES.chromium.html` 为准。
- 应用未修改这些第三方组件的源码；仅以原样二进制形式分发。

## 2. 构建时依赖（不随安装包分发，仅源码/离线构建包使用）

| 组件 | 许可证 |
|---|---|
| electron-vite / Vite / @vitejs/plugin-react | MIT |
| TypeScript | Apache-2.0 |
| electron-builder | MIT |
| tsx | MIT |
| 7-Zip（离线构建缓存中的 7za） | LGPL-2.1-or-later（含 unRAR 限制条款，详见其 LICENSE） |
| NSIS 编译器 | zlib/libpng |
| winCodeSign（electron-builder 工具） | 随工具包分发，见缓存内 license 文件 |

## 3. 合规提示

1. 若再分发本应用的安装包，请保留 `LICENSE`、本文件，以及 `resources/` 下的 Electron/Chromium/Git 许可证文件。
2. 若修改 AGPL 部分并通过网络提供服务，需按 AGPLv3 向用户提供对应源码。
3. 若替换内置 Git/Bash 版本，请同步更新本文件对应的版本与许可证信息。
4. 本项目不提供商业双许可；第三方组件的许可证不因本项目采用 AGPL 而改变。

最后更新：2026-11-14

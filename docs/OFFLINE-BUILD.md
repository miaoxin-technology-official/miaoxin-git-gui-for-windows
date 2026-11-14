# 离线构建说明（1.3.3）

本压缩包包含构建所需的全部依赖，不需要联网、不需要另装 Node.js 或 Git：

- `nodejs/`：便携 Node.js 运行时（含 npm/npx）
- `node_modules/`：项目依赖，已含 `node_modules/electron/dist`（Electron 33.3.1）
- `vendor/git/`：内置 Git 2.47.1（MinGit）与 Git Bash 运行时
- `builder-cache/`：electron-builder 的 NSIS / winCodeSign / 7zip 离线缓存
- 源码、脚本、图标、文档

## 构建

在 Windows 上解压后，双击或在项目根目录运行：

```bat
scripts\build-offline.cmd
```

脚本会：
1. 使用包内 `nodejs` 作为 Node 运行时；
2. 把 `TEMP/TMP` 指向项目内 `.build-tmp`（避免临时目录权限问题）；
3. 把 `ELECTRON_BUILDER_CACHE` 指向包内 `builder-cache`；
4. 执行 `npm run build` 与 `electron-builder --win nsis --x64`。

产物在 `release\MiaoxinGitGUI-<version>-setup.exe`。

> 说明：首次构建仍会由 NSIS 生成卸载程序，需要可写的项目目录；不需要管理员权限。
> 如果要把内置 Git/Bash 更新到新版本，替换 `vendor/git` 后重新构建即可。

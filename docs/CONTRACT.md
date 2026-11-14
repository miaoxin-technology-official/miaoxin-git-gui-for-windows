# Miaoxin Git GUI — 团队开发契约（v1）

Miaoxin Git GUI 是一个本地优先的 Windows Git 桌面客户端：Electron 33 + React 18 + Vite 6 + TypeScript。
本文件是并行开发的唯一契约。**任何跨模块的接口、样式令牌、文件归属以本文件为准**；需要变更契约时先改本文件并在群里同步。

---

## 1. 产品与设计基调

目标：功能对标主流 Git GUI（GitHub Desktop / Fork / GitKraken 的常用能力），但视觉与交互更像 2026 年的专业开发者工具，而不是模板化的“AI 生成风”。

**必须避免的“AI 味”**
- 紫蓝渐变、玻璃拟态、发光描边、彩虹阴影、超大圆角卡片、emoji 图标、✨/🚀 等装饰。
- 空泛的营销文案（“赋能”“一站式”“极致体验”）。文案只描述事实与操作。
- 居中大 Logo + 三张特性卡片的落地页；未打开仓库时用克制的空状态（一个线性插图 + 两个动作 + 最近仓库列表）。

**视觉方向**
- 参考气质：Linear 的信息密度、Raycast 的命令面板、GitHub 的语义色，但字号更小、边框更细、留白更紧。
- 暖炭黑 / 纸色 surface 堆叠 + 单一铜色强调（#C4763F）；颜色只表达语义（增/删/警告/分支/当前选中），禁止蓝紫霓虹与装饰性渐变。
- 字体：UI 用系统 Segoe UI（中文回退 Microsoft YaHei UI），代码/哈希/差异用 Cascadia Mono / Consolas；不引入 Web 字体。
- 1px 细线、2–4px 圆角；几乎不用阴影，弹层用 1px 边框 + 克制的投影。禁止发光、玻璃拟态与渐变。
- 动效 120–180ms，`--ease: cubic-bezier(.2,.7,.3,1)`；不做位移超过 8px 的花哨动画。
- 所有可点击元素有 hover / active / focus-visible 三态；焦点环用 2px accent 透明外环。
- 不给按钮加 emoji；图标一律 lucide-react，`strokeWidth={1.6}`，尺寸 14/16/18。

**信息架构**
标题栏（可拖拽，34px）→ 文字标签栏（34px：改动/历史/分支/暂存/标签/远程）→ 主工作区 → 状态栏（24px）。
主工作区按标签切换：`changes | history | branches | stash | tags | remotes`。
列表 + 右侧详情的分栏模式用于 Changes（文件列表 / 差异）与 History（提交图 / 提交详情）。

---

## 2. 命令与门禁

工作目录：`F:\dsh工作空间\arbor`

```
npm run typecheck   # tsc --noEmit，两个 project 都必须通过
npm run build       # electron-vite build，产出 out/
npm run pack:dir    # 未安装包目录（快速验证）
npm run pack        # 单文件 portable EXE → release/MiaoxinGitGUI-1.0.0-portable.exe
```

- 不允许 `any` 滥用；跨进程数据只用 `@shared/types.ts` 的类型。
- 不允许新增运行时依赖，除非先在契约里登记（渲染层依赖会被 Vite 打包，主进程依赖会被 externalize）。
- 不提交 `release/`、`out/`、`node_modules/`。
- 每个模块完成后必须自己跑 `npm run typecheck`（只关注自己文件的错误，其他人在写时会有暂时的错误）。

---

## 3. 文件归属（write scope）

| 范围 | 负责人 |
|---|---|
| `src/shared/**`, `src/preload/**`, `src/main/index.ts`, `src/main/ipc.ts`, `src/main/theme.ts`, `src/main/store.ts`, `src/main/watcher.ts`, `src/main/window.ts` | Lead |
| `src/main/git/**`（除 `index.ts` 的 interface 外全部实现） | 后端 teammate |
| `src/renderer/src/styles/**`, `src/renderer/src/components/ui/**`, `src/renderer/src/lib/**`, `src/renderer/src/store/**`, `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`, `src/renderer/src/components/{TitleBar,Sidebar,StatusBar,CommandPalette,Toaster,Welcome,SettingsDialog}.tsx`, `src/renderer/index.html` | Lead |
| `src/renderer/src/features/changes/**`, `src/renderer/src/components/DiffView.tsx`, `src/renderer/src/styles/diff.css`, `src/renderer/src/styles/changes.css` | UI-Changes teammate |
| `src/renderer/src/features/history/**`, `branches/**`, `stash/**`, `tags/**`, `remotes/**`, `src/renderer/src/styles/history.css`, `graph.css`, `branches.css`, `remotes.css` | UI-Repo teammate |
| `build/**`, `scripts/**`, `docs/BUILD.md`, `docs/QA.md`, `README.md`, 发布产物 | Build/QA teammate |

禁止修改其他人 scope 内的文件。需要共享的小组件：放到 `components/ui/` 由 Lead 维护，或在契约中约定。

---

## 4. 进程边界与数据契约

- **单一事实来源**：`src/shared/types.ts`。渲染层、preload、主进程共用。新增字段必须改这个文件并由 Lead 统一提交；teammate 不要私自扩散新类型。
- 主进程抛出的错误会被 `ipcRenderer.invoke` 包装成 Error，渲染层用 `errorMessage(err)` 取干净文案展示到 toast。
- 所有耗时网络操作（clone/fetch/pull/push/merge/rebase）必须通过 `withProgress` 向渲染层发 `ProgressEvent`（已在 `ipc.ts` 接好），UI 控制台订阅 `api.events.onProgress`。
- 仓库变化：主进程 `repoWatcher` 变化时广播 `RepoChangeEvent`；渲染层在事件里调用 `refresh()`（500ms 防抖）。
- 渲染层不得自己执行 git 命令、不得访问 Node API；只能用 `window.arbor`（`src/preload/index.ts` 已完整实现）。
- 主进程不得依赖渲染层状态；参数校验在主进程，错误文案用中文短句。

### GitService 接口

`src/main/git/index.ts` 导出 `GitService` 接口与 `createGitService()`。后端 teammate 用真实实现替换 `createGitService()` 的工厂体（interface 不变；需要加方法时先同步 Lead 更新 `shared/types.ts` + `preload` + `ipc.ts`）。实现建议拆分在 `src/main/git/*.ts`，由 `index.ts` 组合。

### 主进程 git 调用规范（后端 teammate）

- 统一用 `spawn(gitPath, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } })`，**禁止 shell**；路径作为独立参数传递。
- `gitPath` 取 `store.get().gitPath || 'git'`；`git.version()` 失败时给出“未找到 git，请在设置中指定 git 路径”的可读错误。
- 解析用 `--no-optional-locks`、`-c core.quotepath=false`、`-z` 等稳定参数；NUL 分隔解析，不要按行 split 后假设没有换行文件名。
- 所有写操作前 `validate(path)`（`git rev-parse --show-toplevel`）；对不存在/非仓库路径给出中文错误。
- `status`：`git status --porcelain=v2 -z --branch --untracked-files=all`，解析 branch.head / branch.ab / 1/2/u/? 记录，正确识别 rename 的 oldPath、工作区与暂存区两侧状态、冲突（u 记录）。返回 `StatusSnapshot`（files 为合并后的去重列表，staged/unstaged/untracked/conflicted 各自子集）。
- `log`：`git log --date-order --format=... -z`，字段用 `%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b%x00%D%x00` 之类；refs 从 `%D` 解析为 `RefInfo[]`；`limit/skip/branch/search/all/firstParent` 映射到参数；`hasMore` 用 limit+1 判定。默认 limit 200。
- `diff`：统一 `git diff --no-color --no-ext-diff --unified=<ctx> [-w] -- <path>`；解析 `diff --git` / `new file` / `deleted file` / `rename from|to` / `Binary files` / `@@` hunk；行类型与行号必须准确。`diffWorktree(side='staged')` 等价 `git diff --cached`；`side='unstaged'` 用 `git diff`；未跟踪文件用 `git diff --no-index -- /dev/null <file>`（Windows 传 `NUL`）并改写 header，或直接构造“新文件”diff（推荐：`git diff --no-index -- /dev/null file` 在 Windows 下用临时空文件路径，保证输出可解析）。
- `commitDetail`：`git show --numstat --format=...` 解析文件统计（二进制为 `-`）。
- `stage/unstage`：`git add -A -- <paths>` / `git restore --staged -- <paths>`；untracked 的 unstage 用 `git rm --cached`；路径含空格/中文必须正确。
- `discard`：unstaged → `git restore -- <paths>`；staged → `git restore --staged`（仅取消暂存，不丢工作区）；untracked → 删除文件（`fs.rm`）。
- **hunk 级暂存** `applyHunk`：重新计算对应 source 的完整 patch → 取第 `hunkIndex` 个 hunk → 拼上 `diff --git`/`---`/`+++` header → `git apply --cached`（source=unstaged 且 reverse=false）或 `git apply --cached -R`（unstage），stdin 写 patch，失败时回退并抛出可读错误。
- `commit`：消息用 `-F -` stdin 传入（支持多行、中文）；`--amend`、`--signoff`、`--allow-empty`。返回短 hash 与 subject。
- `branches`：`git for-each-ref refs/heads refs/remotes --format=...`，ahead/behind 用 `%(upstream:track)` 解析；本地在前（当前分支置顶），远程分组。
- `merge/rebase/cherry-pick/revert/continue/abort`：捕获退出码和 stdout/stderr，返回 `OperationResult`，冲突文件从 stderr/`git diff --name-only --diff-filter=U` 汇总。**冲突不是异常**：返回 `ok:false` 但不要 throw，让 UI 显示冲突态。
- `push`：支持 `-u`、`--force-with-lease`、`--tags`；失败把 stderr 原文保留（含 hint 行），UI 控制台可读。
- `clone`：spawn 时逐行读取 stdout/stderr 推给 `ProgressSink`；结束后返回 summary。
- `operationState`：检查 `.git/MERGE_HEAD`、`rebase-merge`、`rebase-apply`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`、`BISECT_LOG`，并列出冲突文件。
- 编码：git 输出按 UTF-8 解码；遇到非法字节用 `Buffer` 手动替换，不要整段 fail。
- 每个方法都要有超时（30s，网络操作 10min）与 kill 兜底。

---

## 5. 渲染层契约

### 5.1 设计令牌（`styles/tokens.css` 已实现，直接用）

颜色（dark / light 双主题，均为 CSS 变量）：
```
--bg --bg-elev --bg-panel --bg-inset --bg-hover --bg-active --bg-selected
--border --border-strong --border-subtle
--text --text-2 --text-3 --text-inverse
--accent --accent-text --accent-soft --accent-border
--green --green-soft --amber --amber-soft --red --red-soft --blue --blue-soft
--diff-add-bg --diff-add-gutter --diff-del-bg --diff-del-gutter
```
字号/间距：
```
--font-ui --font-mono
--text-xs 11px  --text-sm 12px  --text-md 13px  --text-lg 15px  --text-xl 18px
--radius-sm 4px --radius-md 6px --radius-lg 8px --radius-xl 10px
--row-h 30px  (compact: 26px)
--sidebar-w 232px --titlebar-h 40px --statusbar-h 26px
```
纯 CSS，不使用 Tailwind/CSS-in-JS。类名 BEM 风格、以 `arb-` 或功能前缀命名，避免全局污染。

### 5.2 共享样式类（`styles/app.css` 提供）

`.panel`, `.panel-hd`, `.panel-title`, `.panel-actions`, `.toolbar`, `.toolbar-sep`
`.scroll-y`, `.mono`, `.muted`, `.subtle`, `.truncate`, `.num`, `.kbd`
`.list`, `.list-row`, `.list-row.is-active`, `.list-row:hover`
`.empty`, `.empty-art`, `.empty-title`, `.empty-desc`
`.section-header`（11px 大写/字距 0.06em/--text-3）
`.col-header`（列表表头）
`.split`, `.split-handle`
`.chip`, `.chip-accent`, `.dot`
`.divider`
危险操作：`.danger-text`。

### 5.3 UI 组件（Lead 已实现，直接 import）

```ts
// components/ui/Button
<Button variant="primary|secondary|ghost|danger" size="sm|md" icon={LucideIcon}
        loading full disabled>文本</Button>
<IconButton icon={LucideIcon} label="tooltip" size?={28} active? onClick />

// components/ui/Fields
<TextField label? hint? error? mono? icon? value onChange onEnter autoFocus placeholder? />
<TextArea label? rows? value onChange placeholder? />
<Checkbox checked onChange label />
<Switch checked onChange label? />
<Segmented options={[{value,label,icon?}]} value onChange size?="sm|md" />
<Select value onChange options={[{value,label}]} />

// components/ui/Overlay
<Modal open onClose title? subtitle? width? footer?>{children}</Modal>
<Popover trigger={<button/>} width? align?="start|end" side?="bottom|top">{content}</Popover>
<Menu items={[{id,label,icon?,shortcut?,danger?,disabled?,separator?}]} onSelect={id=>} trigger? 或 open/onClose 受控 />
<Tooltip label side?>{child}</Tooltip>
<ConfirmDialog open title description confirmText? danger? onConfirm onCancel />

// components/ui/Feedback
useToast() → { toast: (message, kind?: 'info'|'success'|'error') => void }
<Banner kind="info|warn|error" actions? >文本</Banner>
<EmptyState art="repo|changes|history|branches|search" title desc actions? />
<Spinner size? />
<ProgressBar value />

// components/ui/SplitPane
<SplitPane initial={number} min max storageKey onResize?>{left}{right}</SplitPane> // 左右两栏，右栏固定/左栏可拖
```
（实现细节以实际文件为准；若签名不一致以 Lead 的文件为准，并同步本文件。）

### 5.4 状态与工具

```ts
// lib/api.ts
export const api = window.arbor
export function errorMessage(e: unknown): string

// store/app.ts
useAppStore() 读取：ready, settings, repo, status, section, recent, version, loading, paletteOpen, settingsOpen
actions：bootstrap(), openRepo(path), openDialog(), closeRepo(), refresh(), setSection(section), setSettings(patch), toast(...), setPaletteOpen(), setSettingsOpen()
// version 在每次 refresh 成功后 +1；feature 视图用它做 useEffect 依赖来重拉自己的数据

// lib/useAsyncData.ts
useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]): { data, loading, error, reload }

// lib/format.ts
relativeTime(unixSeconds), absoluteTime(unixSeconds), hash7(hash), fileStatusLabel(status), fileStatusLetter(status), statusTone(status), fileName(path), dirName(path), parseCommitRefs? (已在主进程)
// lib/fuzzy.ts
fuzzyMatch(query, text): { score, ranges } | null

// components/DiffView.tsx（UI-Changes 提供，History 复用）
<DiffView diff={DiffResult|null} loading? emptyLabel? repo
          onStageHunk?={(filePath, hunkIndex) => void}
          onUnstageHunk?={(filePath, hunkIndex) => void} />
```

### 5.5 视图组件契约

`src/renderer/src/features/*/<Name>View.tsx`，默认导出、无 props、自取 store：
- `changes/ChangesView.tsx`
- `history/HistoryView.tsx`
- `branches/BranchesView.tsx`
- `stash/StashView.tsx`
- `tags/TagsView.tsx`
- `remotes/RemotesView.tsx`

App 通过 `section` 惰性渲染这些组件；组件内部管理自己的局部数据（commit 列表、分支列表等），在 `version` 变化时刷新。所有写操作后调用 `refresh()`；破坏性操作前用 `ConfirmDialog`（`settings.confirmDestructive` 为 true 时）。

---

## 6. 验收标准（QA teammate）

1. 能打开 `F:\dsh工作空间\deepsleep`（真实仓库）并在 1.5s 内渲染提交历史与工作区状态。
2. 暂存/取消暂存单文件、提交（中文提交信息）、amend 正常；状态栏 ahead/behind 正确。
3. 提交图（多分支、多 lane）无错位；提交详情文件列表与 diff 内容正确。
4. 分支切换、分支创建、合并、stash save/pop、tag 创建删除可用。
5. fetch/pull/push 有流式控制台输出；无远程凭据时不崩溃（给出可读错误）。
6. 深浅主题、窗口缩放 1.0/1.25、1080×680 到 1920×1080 布局不破。
7. `npm run pack` 产出 `release/MiaoxinGitGUI-1.0.0-portable.exe`，双击能启动、能打开仓库、退出后设置保留。
8. 截图：`docs/screenshots/*.png` 覆盖欢迎页、Changes、History、Branches、命令面板，深浅两套。

---

## 7. 命名与文案

产品名 **Miaoxin Git GUI**。窗口标题 “Miaoxin Git GUI”。中文界面，git 术语保留英文（commit / push / stash / rebase 首次出现可加中文括注）。按钮用动词短语：“提交到 main”“获取更新”“推送”。不用感叹号，不用 emoji。空状态示例：
- Changes 无改动：“工作区没有改动。切换到 History 查看提交记录。”
- 无仓库：“打开一个本地仓库，或从远程克隆。”

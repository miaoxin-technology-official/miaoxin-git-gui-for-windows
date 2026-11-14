# 后端实现与测试记录（git backend）

项目：**Miaoxin Git GUI**（原 Arbor；仅文案/文档更名，接口与数据结构未变）
模块：`src/main/git/**`（主进程 GitService 全部实现）
测试脚本：`scripts/git-smoke.ts`

## 1. 实现范围

| 文件 | 内容 |
|---|---|
| `exec.ts` | spawn（无 shell、`windowsHide`、`GIT_TERMINAL_PROMPT=0`/`GIT_OPTIONAL_LOCKS=0`/`LANG=en_US.UTF-8`）、**按 Buffer 采集字节输出**、逐行流式 `ProgressSink`、本地 30s / 网络 10min 超时 kill、中文短句错误 + 原始 stdout/stderr 保留 |
| `encoding.ts` | `decodeSmart(buffer)`：BOM（UTF-8 / UTF-16LE / UTF-16BE）→ 严格 UTF-8 → 严格 GB18030（覆盖 GBK/GB2312）→ UTF-8 替换兜底；返回 `{ text, encoding }` |
| `status.ts` | `--porcelain=v2 -z --branch --untracked-files=all` 解析：branch.oid/head/upstream/ab、`1`/`2`(rename oldPath)/`u` 冲突/`?` 未跟踪、staged+unstaged 双侧、numstat 统计；**NUL token 逐个 decodeSmart**（GBK 文件名）；纯解析函数 `parseStatusOutput` 可单测 |
| `log.ts` | NUL 分隔 format + `--decorate=full` + `--encoding=UTF-8`；refs/parents/作者时间/body 解析；limit/skip/search/branch/author/path/since/all/firstParent；`hasMore = limit+1`；commitDetail（numstat + name-status，路径按字节解码） |
| `diff.ts` | worktree/staged/commit/range/stash 五种来源；**原始字节按 LF 切行、逐行 decodeSmart**（同一 patch 混合 UTF-8/GBK 互不污染，保留 `\r`）；新/删/rename/copy/mode/typechange、binary、子模块 gitlink、`diff --cc` 冲突合并 diff；逐个文件填 `DiffFile.encoding`；UTF-8 BOM 剥离；UTF-16 文本回退 |
| `patch.ts` | hunk 级暂存：重组 header+单 hunk 的**字节补丁**，stdin 传给 `git apply --cached` / `-R`，GBK 内容字节保真 |
| `branches.ts` | for-each-ref（ahead/behind、upstream、当前分支置顶、远程分组）；create/checkout/rename/delete（含远程分支删除）；merge/rebase 冲突返回 `ok:false` |
| `remotes.ts` | remote -v 解析（fetch/push url）；add/remove/rename/set-url；fetch/pull/push 流式输出，push 支持 `-u`/`--force-with-lease`/`--force`/`--tags`/`--dry-run`，失败保留 stderr 原文 |
| `stash.ts` | list（branch/message/time 解析）；save（-m / --include-untracked）；pop/apply 冲突返回 OperationResult；drop |
| `tags.ts` | for-each-ref tags（轻量/注解、target、tagger、message/time）；create（-a）、delete（本地 + 可选远程 push --delete） |
| `ops.ts` | operationState（MERGE_HEAD/rebase-merge/rebase-apply/CHERRY_PICK_HEAD/REVERT_HEAD/BISECT_LOG + conflicts + rebase 进度）；continue/abort；checkoutCommit/reset(soft|mixed|hard)/cherry-pick/revert；conflicts()/resolveConflict；冲突不 throw |
| `index.ts` | `GitService` 组合实现（接口未改），`createGitService()` 读 `store.gitPath`；validate/open/init/clone/summary |

未改动 `src/shared/types.ts`（`DiffFile.encoding?` 由 Lead 添加）、preload、ipc。

## 2. 命令与结果

```
npx tsc --noEmit -p tsconfig.node.json     # 0 error
npx tsx scripts/git-smoke.ts               # 42 项检查全部通过
```

- **Part A 真实仓库只读**（`F:\dsh工作空间\deepsleep`、`F:\dsh工作空间\dsh-deepseek-cost`）：summary / status / log（limit、skip、hasMore、search、all、firstParent、branch）/ commitDetail（含无效 hash 中文错误）/ diffCommit+diffRange+diffWorktree+diffStaged / branches(+ahead/behind) / remotes / tags / operationState(null) — 均通过，未修改工作区。
- **Part B `.tmp/smoke-repo` 全写路径**：init、中文/空格文件名与二进制 status、未跟踪文件 diff、stage/unstage/stageAll/unstageAll、中文多行 commit（`-F -`）、amend、signoff、allow-empty、分支创建/切换/重命名/删除/合并、merge 冲突→status.conflicted→combined diff→resolve→continue、再次冲突→abort、rebase 冲突→abort、cherry-pick 冲突→abort、stash save/list/diff/pop/apply/drop、tag 轻量/注解/删除、**多 hunk 分别暂存与取消暂存**、commit/range/staged diff、rename（oldPath）、binary、discard 三种 side、ignore、远程（本地 bare：add/push -u/ahead/behind/fetch/pull/pull --rebase/push --force-with-lease/--tags/--dry-run/clone/rename/set-url/delete remote branch/remove）、revert/cherry-pick/reset(soft/hard)/checkoutCommit(detached)、gitlink 子模块目录、错误文案（非仓库/路径不存在）— 均通过。
- **Part C `.tmp/encoding-repo` 编码（Python 生成）**：三份中文 `.md`
  - GB18030（Python `encode('gb18030')`）：修改后 `diffWorktree.encoding = 'gb18030'`，中文正确、**无 U+FFFD**、hunk oldStart/oldLines/newStart/newLines 与 add/del 行号正确；additions/deletions 与原生 `git diff --numstat`、原生 `git diff` 的 +/- 行数一致。
  - UTF-8 BOM（`utf-8-sig`）：`encoding = 'utf-8'`，BOM 被剥离、中文正确、无 U+FFFD、numstat 一致。
  - UTF-16LE（`utf-16`，git 视为 binary）：回退为文本 diff，`binary=false`、`encoding='utf-16le'`、中文正确、行号正确。
  - GB18030 文件 **hunk 级暂存/取消暂存**成功且 staged diff 中文无乱码（字节补丁）。
  - 中文 commit message（subject + body）在 `log`/`commitDetail` 中正确；编码文件提交后的 commit/range diff 仍为 `gb18030`。
  - 纯解析器单测：`decodeSmart`（GB18030/UTF-8 BOM/UTF-16LE）、GBK 文件名的 porcelain v2 `-z` 与 numstat 路径解码、rename/冲突/换行文件名（Windows 无法创建换行文件名，改用合成字节流验证）、quoted patch 反解。

## 3. 已知限制 / 风险

1. **无 BOM 的 UTF-16** 无法自动识别（字节对 UTF-8/GB18030 都"合法"或直接是 binary），仅带 BOM 的 UTF-16 走文本回退；无 BOM UTF-16 显示为 binary（记录风险）。
2. UTF-16 文本回退使用"公共前缀/后缀 + 中段整体替换"的粗粒度 diff（行号正确，但不是最小 diff）；仅对 `.md/.txt/.json/.ts/.css/.html` 等文本扩展名生效。GBK/GB18030 是逐行解码的原生 diff，不受此限制。
3. `StatusSnapshot.files` 按路径去重（优先级 conflicted > staged > unstaged > untracked），两侧状态以 `staged`/`unstaged` 子集为准；同一文件既暂存又有工作区改动时 flat 列表只保留一条。
4. 单文件 diff 的 rename 检测在 pathspec 隐藏了源侧时，会额外跑一次全量 diff 再过滤（只在这种可疑情况下多一次 git 调用）。
5. `stash` 的 diff 只展示已跟踪改动（stash 内未跟踪部分在第三父提交，未展示）。
6. Windows 下无法创建含换行符的文件名 / 无法改 symlink 权限位：换行文件名、modechange/typechange 通过合成 patch/字节流验证，未在真实文件系统覆盖；symlink/typechange 真机未测。
7. 子模块以本地 nested repo（gitlink）验证 status/diff，未测真实 `git submodule` + `.gitmodules` 与网络子模块。
8. 网络操作仅对本地 bare 仓库（file 传输）验证；HTTPS/SSH 凭据失败路径未实测（`GIT_TERMINAL_PROMPT=0` 下应返回 `ok:false` 且保留 stderr，不崩溃）。
9. `git am` 与 `bisect` 的 continue/abort 未纳入冒烟（merge/rebase/cherry-pick 的 abort 及 merge continue 已覆盖）。
10. commit 会执行仓库 hooks；若 hook 需要交互输入可能受限于 stdin（不可交互），属预期行为。

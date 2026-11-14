/**
 * Miaoxin Git GUI — git backend smoke test.
 *
 * Run with:  npx tsx scripts/git-smoke.ts
 *
 * Part A runs read-only checks against two real repositories.
 * Part B builds a throw-away repository (plus a bare remote and a clone) under
 * `.tmp/` and exercises every write path: init, stage/unstage, commit (Chinese,
 * multi-line), branch/merge/conflict/continue/abort, stash, tags, hunk staging,
 * reset, revert, cherry-pick, remotes/fetch/pull/push, clone, diff sources,
 * rename/binary/submodule/odd file names.
 *
 * The real repositories are never modified.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createGitService } from '../src/main/git/index'
import type { GitService, ProgressSink } from '../src/main/git/index'
import { parseStatusOutput, parseNumstatZ } from '../src/main/git/status'
import { parsePatch, unquoteGitPath } from '../src/main/git/diff'
import { decodeSmart } from '../src/main/git/encoding'
import type { DiffFile } from '../src/shared/types'

const ARBOR_ROOT = path.resolve(__dirname, '..')
const TMP = path.join(ARBOR_ROOT, '.tmp')
const SMOKE = path.join(TMP, 'smoke-repo')
const BARE = path.join(TMP, 'smoke-remote.git')
const CLONE = path.join(TMP, 'smoke-clone')
const REAL_REPOS = [
  path.join(ARBOR_ROOT, '..', 'deepsleep'),
  path.join(ARBOR_ROOT, '..', 'dsh-deepseek-cost')
]

const git = createGitService({ gitPath: 'git' })

interface Failure {
  name: string
  message: string
}

const failures: Failure[] = []
const passed: string[] = []

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    passed.push(name)
    console.log(`  ok   ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ name, message })
    console.log(`  FAIL ${name}: ${message}`)
    if (process.env.SMOKE_DEBUG && error instanceof Error && error.stack) {
      console.log(error.stack.split('\n').slice(0, 6).join('\n'))
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: ${JSON.stringify(haystack)} 不包含 ${JSON.stringify(needle)}`)
  }
}

/** Runs raw git for test setup only (config, bare repo, nested repo, …). */
function raw(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    }
  })
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function writeFile(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function sinkCollector(): { sink: ProgressSink; lines: { line: string; stream: string }[] } {
  const lines: { line: string; stream: string }[] = []
  return {
    lines,
    sink: (line: string, stream: 'stdout' | 'stderr' | 'system') => lines.push({ line, stream })
  }
}

/* ------------------------------------------------------------------ part A */

async function testRealRepo(repo: string): Promise<void> {
  const label = path.basename(repo)
  console.log(`\n=== Part A: ${label} (read-only) ===`)
  assert(fs.existsSync(repo), `真实仓库不存在：${repo}`)

  let defaultBranch = ''
  let commits: Awaited<ReturnType<GitService['log']>>['commits'] = []

  await check(`${label}: summary`, async () => {
    const summary = await git.summary(repo)
    assert(fs.existsSync(summary.path), 'summary.path 不存在')
    assert(summary.branch !== null, 'branch 为空')
    defaultBranch = summary.branch as string
    assertEqual(summary.detached, false, 'detached')
    assert(summary.head !== null && summary.head.length === 40, `head 不是 40 位 hash：${summary.head}`)
    assertEqual(summary.operation, null, 'operation')
    assertEqual(summary.remotes.length > 0, true, 'remotes 为空')
    assertEqual(summary.status.clean, true, 'status.clean')
  })

  await check(`${label}: status (clean)`, async () => {
    const status = await git.status(repo)
    assertEqual(status.files.length, 0, 'files')
    assertEqual(status.staged.length, 0, 'staged')
    assertEqual(status.unstaged.length, 0, 'unstaged')
    assertEqual(status.untracked.length, 0, 'untracked')
    assertEqual(status.additions, 0, 'additions')
  })

  await check(`${label}: log / query flags`, async () => {
    const result = await git.log(repo, { limit: 3 })
    assert(result.commits.length > 0, '没有提交')
    commits = result.commits
    const first = result.commits[0]
    assert(first.hash.length === 40, 'hash 长度')
    assert(first.shortHash.length >= 7, 'shortHash')
    assert(first.hash.startsWith(first.shortHash), 'shortHash 不是 hash 前缀')
    assert(first.author.time > 0, 'author.time')
    assert(first.committer.time > 0, 'committer.time')
    assert(
      result.commits.some((commit) =>
        commit.refs.some((ref) => ref.type === 'branch' && ref.name === defaultBranch)
      ),
      '最新提交缺少当前分支 ref'
    )
    const more = await git.log(repo, { limit: 2 })
    assertEqual(more.commits.length, 2, 'limit=2')
    assertEqual(more.hasMore, true, 'limit=2 hasMore')
    const skipped = await git.log(repo, { limit: 2, skip: 1 })
    assertEqual(skipped.commits[0].hash, result.commits[1].hash, 'skip=1')
    const all = await git.log(repo, { limit: 50, all: true })
    assert(all.commits.length >= result.commits.length, 'all 数量')
    const firstParent = await git.log(repo, { limit: 10, firstParent: true })
    assert(firstParent.commits.length > 0, 'firstParent')
    const search = await git.log(repo, { limit: 5, search: first.subject.slice(0, 4) })
    assert(search.commits.length > 0, `search 无结果：${first.subject.slice(0, 4)}`)
    const byBranch = await git.log(repo, { limit: 2, branch: defaultBranch })
    assertEqual(byBranch.commits[0].hash, first.hash, 'branch 查询')
  })

  await check(`${label}: commitDetail`, async () => {
    const detail = await git.commitDetail(repo, commits[0].hash)
    assertEqual(detail.hash, commits[0].hash, 'hash')
    assert(detail.files.length > 0, 'files 为空')
    assertEqual(detail.stats.files, detail.files.length, 'stats.files')
    for (const file of detail.files) {
      assert(file.path.length > 0, '空文件路径')
      assert(file.additions >= 0 && file.deletions >= 0, '统计为负')
    }
    let threw = false
    try {
      await git.commitDetail(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    } catch (error) {
      threw = true
      const message = error instanceof Error ? error.message : String(error)
      assert(/提交|无法|未找到/.test(message), `错误不是中文短句：${message}`)
    }
    assert(threw, '无效 hash 未抛错')
  })

  await check(`${label}: diff commit / range / worktree`, async () => {
    const commitDiff = await git.diffCommit(repo, commits[0].hash)
    assertEqual(commitDiff.files.length > 0, true, 'commit diff 文件数为 0')
    const detail = await git.commitDetail(repo, commits[0].hash)
    assertEqual(commitDiff.files.length, detail.files.length, 'diffCommit 与 commitDetail 文件数')
    for (const file of commitDiff.files) {
      assert(file.hunks.length > 0 || file.binary, `文件 ${file.path} 既无 hunk 也非二进制`)
      for (const hunk of file.hunks) {
        assert(hunk.lines.length > 0, '空 hunk')
      }
    }
    if (commits.length > 1) {
      const range = await git.diffRange(repo, commits[1].hash, commits[0].hash)
      assert(range.files.length > 0, 'range 差异为 0')
    }
    const tracked = detail.files.find((file) => file.status !== 'deleted')
    assert(tracked, '找不到可 diff 的文件')
    const unstaged = await git.diffWorktree(repo, tracked.path, 'unstaged')
    assertEqual(unstaged.files.length, 0, '干净仓库 unstaged diff')
    const staged = await git.diffStaged(repo)
    assertEqual(staged.files.length, 0, '干净仓库 staged diff')
  })

  await check(`${label}: branches / remotes / tags`, async () => {
    const branches = await git.branches(repo)
    assert(branches.length > 0, '没有分支')
    assertEqual(branches[0].isCurrent, true, '当前分支不在首位')
    assert(branches.some((branch) => !branch.isRemote && branch.name === defaultBranch), '缺少主分支')
    assert(branches.some((branch) => branch.isRemote), '缺少远程分支')
    for (const branch of branches) {
      assert(branch.head.length === 40, `branch.head 异常：${branch.name}`)
      assert(branch.time > 0, `branch.time 为 0：${branch.name}`)
      if (branch.isRemote) assert(branch.remote, `远程分支缺少 remote：${branch.name}`)
    }
    const remotes = await git.remotes(repo)
    assert(remotes.length > 0, 'remotes 为空')
    for (const remote of remotes) {
      assert(remote.fetchUrl.length > 0, 'fetchUrl 为空')
      assert(remote.pushUrl.length > 0, 'pushUrl 为空')
    }
    const tags = await git.tags(repo)
    assert(tags.length > 0, 'tags 为空')
    for (const tag of tags) {
      assert(tag.name.length > 0, 'tag 名为空')
      assert(/^[0-9a-f]{40}$/.test(tag.target), `tag target 异常：${tag.name} ${tag.target}`)
    }
  })

  await check(`${label}: operationState null`, async () => {
    const state = await git.operationState(repo)
    assertEqual(state, null, 'operationState')
  })
}

/* ------------------------------------------------------------------ part B */

async function setupSmokeRepo(): Promise<string> {
  await fsp.rm(SMOKE, { recursive: true, force: true })
  await fsp.rm(BARE, { recursive: true, force: true })
  await fsp.rm(CLONE, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })

  const summary = await git.init(SMOKE)
  assertEqual(summary.path, SMOKE, 'init path')
  raw(['config', 'user.name', 'Miaoxin 测试'], SMOKE)
  raw(['config', 'user.email', 'miaoxin-test@example.com'], SMOKE)
  raw(['config', 'core.autocrlf', 'false'], SMOKE)
  return summary.branch ?? 'main'
}

async function testSmokeRepo(): Promise<void> {
  console.log('\n=== Part B: throw-away repository ===')
  const repo = SMOKE
  let branch = ''

  await check('init + 配置', async () => {
    branch = await setupSmokeRepo()
    const summary = await git.summary(repo)
    assertEqual(summary.path, repo, 'path')
    assert(summary.branch !== null, 'branch')
    assertEqual(summary.status.clean, true, '初始仓库应为空')
  })

  await check('写文件 + status 未跟踪（中文/空格/二进制）', async () => {
    writeFile(path.join(repo, 'notes 说明.txt'), '第一行\n第二行\n第三行\n')
    writeFile(path.join(repo, 'dir with space', '中文 文件.txt'), 'hello\n中文内容\n')
    writeFile(path.join(repo, 'binary.dat'), Buffer.from([0, 1, 2, 3, 255, 254]))
    const status = await git.status(repo)
    assertEqual(status.clean, false, 'clean')
    assertEqual(
      status.untracked.length,
      3,
      `untracked 数量：${status.untracked.map((file) => JSON.stringify(file.path)).join(',')}`
    )
    assert(status.untracked.some((file) => file.path === 'notes 说明.txt'), '中文文件名未解析')
    assert(status.untracked.some((file) => file.path === 'dir with space/中文 文件.txt'), '空格路径未解析')
    assert(status.files.every((file) => file.side === 'untracked' && file.tracked === false), '未跟踪标记错误')
  })

  await check('纯解析器：porcelain v2 / rename / 冲突 / 换行文件名 / quoted patch', async () => {
    const oid = 'a'.repeat(40)
    const statusOutput = [
      `# branch.oid ${oid}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '1 M. N... 100644 100644 100644 h1 h2 文件 with space.txt',
      '1 .M N... 100644 100644 100644 h1 h2 中文 文件.txt',
      '2 R. N... 100644 100644 100644 h1 h2 R100 new\nname.txt',
      'old\nname.txt',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict 文件.txt',
      '? untracked 文件.txt',
      ''
    ].join('\0')
    const parsed = parseStatusOutput(statusOutput)
    assertEqual(parsed.head.branch, 'main', 'branch.head')
    assertEqual(parsed.head.head, oid, 'branch.oid')
    assertEqual(parsed.head.ahead, 2, 'branch.ab ahead')
    assertEqual(parsed.head.behind, 3, 'branch.ab behind')
    assertEqual(parsed.snapshot.staged.length, 2, 'staged 数量')
    assertEqual(parsed.snapshot.unstaged.length, 1, 'unstaged 数量')
    assertEqual(parsed.snapshot.conflicted.length, 1, 'conflicted 数量')
    assertEqual(parsed.snapshot.untracked.length, 1, 'untracked 数量')
    assert(parsed.snapshot.staged.some((file) => file.path === '文件 with space.txt'), '含空格路径')
    assert(parsed.snapshot.unstaged.some((file) => file.path === '中文 文件.txt'), '中文路径')
    const renamed = parsed.snapshot.staged.find((file) => file.path === 'new\nname.txt')
    assert(renamed, '换行文件名未解析')
    assertEqual(renamed.status, 'renamed', 'rename 状态')
    assertEqual(renamed.oldPath, 'old\nname.txt', 'rename oldPath')
    assertEqual(parsed.snapshot.conflicted[0].path, 'conflict 文件.txt', '冲突路径')
    assertEqual(parsed.snapshot.clean, false, 'clean')

    const detached = parseStatusOutput([`# branch.oid ${oid}`, '# branch.head (detached)', ''].join('\0'))
    assertEqual(detached.head.detached, true, 'detached')
    assertEqual(detached.head.branch, null, 'detached branch')

    // GBK 文件名：路径字节单独 decodeSmart（status -z 与 numstat -z）
    const gbkName = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x74, 0x78, 0x74]) // 中文.txt（GBK）
    const gbkStatus = Buffer.concat([Buffer.from('? '), gbkName, Buffer.from([0])])
    const gbkParsed = parseStatusOutput(gbkStatus)
    assertEqual(gbkParsed.snapshot.untracked.length, 1, 'GBK 状态条数')
    assertEqual(gbkParsed.snapshot.untracked[0].path, '中文.txt', 'GBK 文件名解码')
    const gbkNumstat = Buffer.concat([
      Buffer.from('1\t2\t'),
      gbkName,
      Buffer.from([0])
    ])
    const gbkStats = parseNumstatZ(gbkNumstat)
    assert(gbkStats.has('中文.txt'), 'GBK numstat 文件名')
    assertEqual(gbkStats.get('中文.txt')?.additions, 1, 'GBK numstat additions')

    assertEqual(unquoteGitPath('"b/weird\\nname.txt"'), 'b/weird\nname.txt', 'unquote newline')
    assertEqual(unquoteGitPath('"b/\\346\\226\\207\\344\\273\\266.txt"'), 'b/文件.txt', 'unquote 中文')

    const patch = [
      'diff --git "a/old\\tname.txt" "b/new\\tname.txt"',
      'similarity index 100%',
      'rename from "old\\tname.txt"',
      'rename to "new\\tname.txt"',
      'diff --git a/bin.dat b/bin.dat',
      'index 1111111..2222222 100644',
      'Binary files a/bin.dat and b/bin.dat differ',
      'diff --git a/mode.txt b/mode.txt',
      'old mode 100644',
      'new mode 100755',
      ''
    ].join('\n')
    const parsedPatch = parsePatch(patch)
    assertEqual(parsedPatch.files.length, 3, 'patch 文件数')
    const rename = parsedPatch.files[0]
    assertEqual(rename.status, 'renamed', 'patch rename')
    assertEqual(rename.path, 'new\tname.txt', 'patch rename path')
    assertEqual(rename.oldPath, 'old\tname.txt', 'patch rename oldPath')
    assertEqual(parsedPatch.files[1].binary, true, 'patch binary')
    assertEqual(parsedPatch.files[2].status, 'modechange', 'patch modechange')
    assertEqual(parsedPatch.files[2].mode?.new, '100755', 'patch mode')
  })

  await check('diff 未跟踪文件（文本 / 二进制）', async () => {
    const textDiff = await git.diffWorktree(repo, 'notes 说明.txt', 'unstaged')
    assertEqual(textDiff.files.length, 1, '未跟踪文本差异文件数')
    const file = textDiff.files[0]
    assertEqual(file.status, 'added', 'status')
    assertEqual(file.path, 'notes 说明.txt', 'path')
    assertEqual(file.additions, 3, 'additions')
    assertEqual(file.deletions, 0, 'deletions')
    assertEqual(file.hunks.length, 1, 'hunks')
    assertEqual(file.hunks[0].lines[0].type, 'add', '首行类型')
    assertEqual(file.hunks[0].lines[0].newLine, 1, '首行行号')
    assertEqual(file.hunks[0].lines[2].newLine, 3, '末行行号')
    const binaryDiff = await git.diffWorktree(repo, 'binary.dat', 'unstaged')
    assertEqual(binaryDiff.files.length, 1, '二进制差异文件数')
    assertEqual(binaryDiff.files[0].binary, true, 'binary 标记')
  })

  await check('stage / unstage（中文路径）', async () => {
    await git.stage(repo, ['notes 说明.txt', 'dir with space/中文 文件.txt'])
    let status = await git.status(repo)
    assertEqual(status.staged.length, 2, 'staged 数量')
    assert(status.staged.some((file) => file.path === 'notes 说明.txt' && file.status === 'added'), '暂存状态')
    assert(status.staged.some((file) => file.additions === 3), '暂存文件统计')
    await git.unstage(repo, ['notes 说明.txt'])
    status = await git.status(repo)
    assertEqual(status.staged.length, 1, '取消暂存后 staged 数量')
    assert(status.untracked.some((file) => file.path === 'notes 说明.txt'), '取消暂存后应回到未跟踪')
    await git.stageAll(repo)
    status = await git.status(repo)
    assertEqual(status.untracked.length, 0, 'stageAll 后 untracked')
    await git.unstageAll(repo)
    status = await git.status(repo)
    assertEqual(status.staged.length, 0, 'unstageAll 后 staged')
  })

  await check('commit（中文多行 + -F stdin）', async () => {
    await git.stageAll(repo)
    const result = await git.commit(repo, {
      message: '第一个提交：初始化仓库\n\n中文正文第一行\n中文正文第二行\n'
    })
    assertEqual(result.hash.length, 40, 'hash')
    assertEqual(result.subject, '第一个提交：初始化仓库', 'subject')
    const status = await git.status(repo)
    assertEqual(status.clean, true, '提交后应为 clean')
    const log = await git.log(repo, { limit: 1 })
    assertEqual(log.commits[0].hash, result.hash, 'log hash')
    assertIncludes(log.commits[0].body, '中文正文第二行', 'body')
    const summary = await git.summary(repo)
    assertEqual(summary.head, result.hash, 'summary.head')
    assertEqual(summary.branch, branch, 'summary.branch')

    // Root commit detail (no parent) must list every file as added.
    const rootDetail = await git.commitDetail(repo, result.hash)
    assertEqual(rootDetail.files.length, 3, '根提交文件数')
    assert(rootDetail.files.every((file) => file.status === 'added'), '根提交文件状态')
    assertEqual(rootDetail.stats.additions, 5, '根提交 additions')

    // amend
    const amended = await git.commit(repo, { message: '第一个提交：修订后', amend: true })
    assertEqual(amended.subject, '第一个提交：修订后', 'amend subject')
    assertEqual(amended.hash === result.hash, false, 'amend 后 hash 应变化')
    const amendedDetail = await git.commitDetail(repo, amended.hash)
    assertEqual(amendedDetail.files.length, 3, 'amend 后文件数不变')

    // signoff
    writeFile(path.join(repo, 'signoff.txt'), 'signed\n')
    await git.stageAll(repo)
    const signed = await git.commit(repo, { message: 'feat: signoff 测试', signoff: true })
    const signedLog = await git.log(repo, { limit: 1 })
    assertIncludes(signedLog.commits[0].body, 'Signed-off-by:', 'signoff trailer')
    assertEqual(signed.hash, signedLog.commits[0].hash, 'signoff hash')

    // allow-empty
    const empty = await git.commit(repo, { message: 'chore: 空提交', allowEmpty: true })
    assertEqual(empty.hash.length, 40, 'allow-empty hash')
    assertEqual((await git.log(repo, { limit: 1 })).commits[0].subject, 'chore: 空提交', 'allow-empty subject')
  })

  await check('branch 创建 / 切换 / 重命名 / 合并', async () => {
    await git.createBranch(repo, 'feature/测试', undefined, true)
    writeFile(path.join(repo, 'feature.txt'), 'feature\n')
    await git.stageAll(repo)
    const featureCommit = await git.commit(repo, { message: 'feature: 新增文件' })
    await git.checkoutBranch(repo, branch)
    const merged = await git.merge(repo, 'feature/测试')
    assertEqual(merged.ok, true, `合并失败：${merged.stderr}`)
    assertEqual(merged.code, 0, '合并退出码')
    const log = await git.log(repo, { limit: 3 })
    assert(log.commits.some((commit) => commit.hash === featureCommit.hash), '合并后应包含 feature 提交')
    await git.renameBranch(repo, 'feature/测试', 'feature-renamed')
    const branches = await git.branches(repo)
    assert(branches.some((item) => item.name === 'feature-renamed'), '重命名分支')
    await git.createBranch(repo, 'to-delete', branch)
    await git.deleteBranch(repo, 'to-delete', true)
    const afterDelete = await git.branches(repo)
    assert(!afterDelete.some((item) => item.name === 'to-delete'), '删除分支')
  })

  await check('merge 冲突 → operationState → resolve + continue', async () => {
    await git.createBranch(repo, 'conflict-side', branch, true)
    writeFile(path.join(repo, 'conflict.txt'), 'base\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'conflict: base' })
    await git.checkoutBranch(repo, branch)
    writeFile(path.join(repo, 'conflict.txt'), 'main side\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'conflict: main' })
    const result = await git.merge(repo, 'conflict-side')
    assertEqual(result.ok, false, '冲突合并应返回 ok:false')
    assert(result.conflicts?.includes('conflict.txt'), `conflicts 缺少文件：${JSON.stringify(result.conflicts)}`)
    assertIncludes(result.output, 'CONFLICT', 'output 保留 git 原文')
    const state = await git.operationState(repo)
    assert(state !== null, 'operationState 为空')
    assertEqual(state.kind, 'merge', 'operation kind')
    assert(state.conflicts.includes('conflict.txt'), 'operationState.conflicts')
    const mergeStatus = await git.status(repo)
    assertEqual(mergeStatus.conflicted.length, 1, 'status.conflicted 数量')
    assertEqual(mergeStatus.conflicted[0].path, 'conflict.txt', 'status.conflicted 路径')
    assertEqual(mergeStatus.conflicted[0].status, 'conflicted', 'status.conflicted 状态')
    // Combined diff (`diff --cc`) must not crash and should be labeled conflicted.
    const conflictDiff = await git.diffWorktree(repo, 'conflict.txt', 'unstaged')
    assertEqual(conflictDiff.files.length, 1, '冲突文件 diff 数量')
    assertEqual(conflictDiff.files[0].status, 'conflicted', '冲突文件 diff 状态')
    assert(conflictDiff.files[0].hunks.length > 0, '冲突文件 diff 无 hunk')
    const conflicts = await git.conflicts(repo)
    assert(conflicts.some((file) => file.path === 'conflict.txt' && file.ours && file.theirs), 'conflicts() 阶段信息')
    await git.resolveConflict(repo, 'conflict.txt', 'ours')
    assertEqual((await git.conflicts(repo)).length, 0, '解决后冲突列表')
    const continued = await git.continueOperation(repo)
    assertEqual(continued.ok, true, `continue 失败：${continued.stderr}`)
    assertEqual(await git.operationState(repo), null, 'continue 后状态')
    const status = await git.status(repo)
    assertEqual(status.clean, true, '冲突解决后 clean')

    // 再构造一次冲突，验证 abort 路径。
    await git.createBranch(repo, 'abort-side', branch, true)
    writeFile(path.join(repo, 'abort.txt'), 'base\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'abort: base' })
    await git.checkoutBranch(repo, branch)
    writeFile(path.join(repo, 'abort.txt'), 'main\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'abort: main' })
    const conflictAgain = await git.merge(repo, 'abort-side')
    assertEqual(conflictAgain.ok, false, '第二次冲突合并')
    const abortResult = await git.abortOperation(repo)
    assertEqual(abortResult.ok, true, `abort 失败：${abortResult.stderr}`)
    assertEqual(await git.operationState(repo), null, 'abort 后状态')
    assertEqual((await git.status(repo)).clean, true, 'abort 后 clean')
  })

  await check('rebase 冲突 → abort / cherry-pick 冲突 → abort', async () => {
    await git.createBranch(repo, 'rebase-side', branch, true)
    writeFile(path.join(repo, 'rebase.txt'), 'side\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'rebase: side' })
    await git.checkoutBranch(repo, branch)
    writeFile(path.join(repo, 'rebase.txt'), 'main\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'rebase: main' })
    const rebaseResult = await git.rebase(repo, 'rebase-side')
    assertEqual(rebaseResult.ok, false, 'rebase 冲突应返回 ok:false')
    const rebaseState = await git.operationState(repo)
    assert(rebaseState !== null, 'rebase operationState 为空')
    assertEqual(rebaseState.kind, 'rebase', 'rebase kind')
    assert(rebaseState.conflicts.includes('rebase.txt'), 'rebase conflicts')
    const aborted = await git.abortOperation(repo)
    assertEqual(aborted.ok, true, `rebase abort 失败：${aborted.stderr}`)
    assertEqual(await git.operationState(repo), null, 'rebase abort 后状态')

    await git.createBranch(repo, 'pick-side', branch, true)
    writeFile(path.join(repo, 'pick-conflict.txt'), 'side\n')
    await git.stageAll(repo)
    const pickSource = await git.commit(repo, { message: 'pick: side' })
    await git.checkoutBranch(repo, branch)
    writeFile(path.join(repo, 'pick-conflict.txt'), 'main\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'pick: main' })
    const picked = await git.cherryPick(repo, pickSource.hash)
    assertEqual(picked.ok, false, 'cherry-pick 冲突应返回 ok:false')
    const pickState = await git.operationState(repo)
    assert(pickState !== null, 'cherry-pick operationState 为空')
    assertEqual(pickState.kind, 'cherry-pick', 'cherry-pick kind')
    const pickAbort = await git.abortOperation(repo)
    assertEqual(pickAbort.ok, true, `cherry-pick abort 失败：${pickAbort.stderr}`)
    assertEqual(await git.operationState(repo), null, 'cherry-pick abort 后状态')
    assertEqual((await git.status(repo)).clean, true, 'cherry-pick abort 后 clean')
  })

  await check('stash save / list / diff / pop', async () => {
    writeFile(path.join(repo, 'notes 说明.txt'), 'changed for stash\n')
    writeFile(path.join(repo, 'stash-me.txt'), 'dirty\n')
    const saved = await git.stashSave(repo, '我的 stash 消息', true)
    assertEqual(saved.ok, true, `stash save 失败：${saved.stderr}`)
    assertEqual((await git.status(repo)).clean, true, 'stash 后 clean')
    const list = await git.stashList(repo)
    assertEqual(list.length, 1, 'stash 数量')
    assertEqual(list[0].index, 0, 'stash index')
    assertIncludes(list[0].message, '我的 stash 消息', 'stash message')
    const diff = await git.diffStash(repo, 0)
    assert(diff.files.some((file) => file.path === 'notes 说明.txt'), 'stash diff 缺少已跟踪文件')
    const popped = await git.stashPop(repo, 0)
    assertEqual(popped.ok, true, `stash pop 失败：${popped.stderr}`)
    assertEqual((await git.stashList(repo)).length, 0, 'pop 后 stash 数量')
    const status = await git.status(repo)
    assert(status.untracked.some((file) => file.path === 'stash-me.txt'), 'pop 恢复未跟踪文件')
    assert(status.unstaged.some((file) => file.path === 'notes 说明.txt'), 'pop 恢复已跟踪改动')
    await git.discard(repo, ['stash-me.txt'], 'untracked')
    await git.discard(repo, ['notes 说明.txt'], 'unstaged')

    // apply（保留 stash）与 drop
    writeFile(path.join(repo, 'notes 说明.txt'), 'apply stash\n')
    const saved2 = await git.stashSave(repo, 'apply 测试')
    assertEqual(saved2.ok, true, 'stash save 2')
    const applied = await git.stashApply(repo, 0)
    assertEqual(applied.ok, true, `stash apply 失败：${applied.stderr}`)
    assertEqual((await git.stashList(repo)).length, 1, 'apply 后 stash 仍存在')
    assert((await git.status(repo)).unstaged.some((file) => file.path === 'notes 说明.txt'), 'apply 恢复改动')
    const dropped = await git.stashDrop(repo, 0)
    assertEqual(dropped.ok, true, `stash drop 失败：${dropped.stderr}`)
    assertEqual((await git.stashList(repo)).length, 0, 'drop 后 stash 数量')
    await git.discard(repo, ['notes 说明.txt'], 'unstaged')
  })

  await check('tag 轻量 / 注解 / 删除', async () => {
    await git.createTag(repo, 'v0.1.0')
    await git.createTag(repo, 'v0.2.0', undefined, '注解标签消息')
    const tags = await git.tags(repo)
    assertEqual(tags.length, 2, 'tag 数量')
    const annotated = tags.find((tag) => tag.name === 'v0.2.0')
    assert(annotated, '缺少注解 tag')
    assertEqual(annotated.annotated, true, 'annotated')
    assertEqual(annotated.message, '注解标签消息', 'tag message')
    assertEqual(tags.find((tag) => tag.name === 'v0.1.0')?.annotated, false, '轻量 tag')
    await git.deleteTag(repo, 'v0.1.0')
    assertEqual((await git.tags(repo)).length, 1, '删除 tag')
  })

  await check('hunk 级暂存 / 取消暂存', async () => {
    writeFile(path.join(repo, 'hunk.txt'), 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'hunk: 初始 10 行' })
    writeFile(path.join(repo, 'hunk.txt'), 'l1\nl2 CHANGED\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10 CHANGED\n')
    const unstaged = await git.diffWorktree(repo, 'hunk.txt', 'unstaged')
    assertEqual(unstaged.files.length, 1, 'diff 文件数')
    assertEqual(unstaged.files[0].hunks.length, 2, `hunk 数量：${unstaged.files[0].hunks.length}`)
    assertEqual(unstaged.files[0].additions, 2, 'additions')
    assertEqual(unstaged.files[0].deletions, 2, 'deletions')
    await git.applyHunk(repo, { file: 'hunk.txt', hunkIndex: 0, source: 'unstaged' })
    let status = await git.status(repo)
    assert(status.staged.some((file) => file.path === 'hunk.txt'), '第一个 hunk 未暂存')
    const stagedDiff = await git.diffStaged(repo, 'hunk.txt')
    assertEqual(stagedDiff.files[0].hunks.length, 1, '暂存后 staged hunk 数量')
    const remainDiff = await git.diffWorktree(repo, 'hunk.txt', 'unstaged')
    assertEqual(remainDiff.files[0].hunks.length, 1, '剩余 unstaged hunk 数量')
    await git.applyHunk(repo, { file: 'hunk.txt', hunkIndex: 0, source: 'staged', reverse: true })
    status = await git.status(repo)
    assert(!status.staged.some((file) => file.path === 'hunk.txt'), '取消暂存 hunk 后仍暂存')
    assertEqual(
      (await git.diffWorktree(repo, 'hunk.txt', 'unstaged')).files[0].hunks.length,
      2,
      '取消暂存后 hunk 数量'
    )
  })

  await check('diff 来源：commit / range / staged', async () => {
    await git.stageAll(repo)
    const commitResult = await git.commit(repo, { message: 'hunk: 两处修改' })
    const commitDiff = await git.diffCommit(repo, commitResult.hash)
    assertEqual(commitDiff.files.length, 1, 'commit diff 文件数')
    assertEqual(commitDiff.files[0].path, 'hunk.txt', 'commit diff 路径')
    const parent = (await git.log(repo, { limit: 2 })).commits[1]
    const range = await git.diffRange(repo, parent.hash, commitResult.hash)
    assertEqual(range.files.length, 1, 'range diff 文件数')
    assertEqual(range.stats.additions, 2, 'range additions')
  })

  await check('rename / 二进制 / 文件统计', async () => {
    fs.renameSync(path.join(repo, 'feature.txt'), path.join(repo, 'feature-renamed.txt'))
    await git.stageAll(repo)
    const status = await git.status(repo)
    const renamed = status.staged.find((file) => file.path === 'feature-renamed.txt')
    assert(renamed, '缺少重命名条目')
    assertEqual(renamed.status, 'renamed', 'rename 状态')
    assertEqual(renamed.oldPath, 'feature.txt', 'rename oldPath')
    const diff = await git.diffStaged(repo, 'feature-renamed.txt')
    assertEqual(diff.files[0].status, 'renamed', 'diff rename 状态')
    assertEqual(diff.files[0].oldPath, 'feature.txt', 'diff rename oldPath')
    await git.commit(repo, { message: 'rename: 重命名文件' })
    writeFile(path.join(repo, 'binary2.dat'), Buffer.from([0, 9, 8, 7]))
    await git.stageAll(repo)
    const staged = await git.diffStaged(repo, 'binary2.dat')
    assertEqual(staged.files[0].binary, true, 'staged binary')
    assertEqual((await git.status(repo)).staged.some((file) => file.binary), true, 'status binary')
    await git.reset(repo, 'HEAD', 'mixed')
  })

  await check('discard：unstaged / untracked / staged', async () => {
    writeFile(path.join(repo, 'hunk.txt'), 'dirty worktree\n')
    await git.discard(repo, ['hunk.txt'], 'unstaged')
    assertEqual((await git.diffWorktree(repo, 'hunk.txt', 'unstaged')).files.length, 0, 'discard unstaged')
    writeFile(path.join(repo, 'throw-away.txt'), 'x\n')
    await git.discard(repo, ['throw-away.txt'], 'untracked')
    assertEqual(fs.existsSync(path.join(repo, 'throw-away.txt')), false, 'discard untracked 未删除')
    writeFile(path.join(repo, 'hunk.txt'), 'staged only\n')
    await git.stage(repo, ['hunk.txt'])
    await git.discard(repo, ['hunk.txt'], 'staged')
    const status = await git.status(repo)
    assert(!status.staged.some((file) => file.path === 'hunk.txt'), 'discard staged 未取消暂存')
    assert(status.unstaged.some((file) => file.path === 'hunk.txt'), 'discard staged 不应丢工作区')
    await git.discard(repo, ['hunk.txt'], 'unstaged')
  })

  await check('ignore', async () => {
    writeFile(path.join(repo, 'ignored.log'), 'log\n')
    await git.ignore(repo, ['*.log'])
    const status = await git.status(repo)
    assert(!status.untracked.some((file) => file.path === 'ignored.log'), '忽略规则未生效')
    assert(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8').includes('*.log'), '.gitignore 内容')
    await fsp.rm(path.join(repo, 'ignored.log'))
    await git.stageAll(repo)
    await git.commit(repo, { message: 'chore: 添加 .gitignore' })
  })

  await check('remotes / push / fetch / summary ahead-behind / pull / clone', async () => {
    raw(['init', '--bare', BARE], TMP)
    await git.addRemote(repo, 'origin', BARE)
    const remotes = await git.remotes(repo)
    assertEqual(remotes.length, 1, 'remote 数量')
    assertEqual(remotes[0].name, 'origin', 'remote 名称')
    const pushCollector = sinkCollector()
    const pushResult = await git.push(repo, { remote: 'origin', branch, setUpstream: true }, pushCollector.sink)
    assertEqual(pushResult.ok, true, `push 失败：${pushResult.stderr}`)
    assert(pushCollector.lines.length > 0, 'push 没有进度输出')
    let summary = await git.summary(repo)
    assertEqual(summary.upstream, `origin/${branch}`, 'upstream')
    assertEqual(summary.ahead, 0, 'ahead')
    writeFile(path.join(repo, 'remote-change.txt'), 'remote\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'feat: 推送前的新提交' })
    summary = await git.summary(repo)
    assertEqual(summary.ahead, 1, 'ahead 1')
    const fetchCollector = sinkCollector()
    const fetchResult = await git.fetch(repo, {}, fetchCollector.sink)
    assertEqual(fetchResult.ok, true, `fetch 失败：${fetchResult.stderr}`)
    assert(fetchCollector.lines.length > 0, 'fetch 没有进度输出')
    const pullResult = await git.pull(repo, { remote: 'origin', branch })
    assertEqual(pullResult.ok, true, `pull 失败：${pullResult.stderr}`)
    const push2 = await git.push(repo, { remote: 'origin', branch, force: 'lease', tags: true })
    assertEqual(push2.ok, true, `push 二次失败：${push2.stderr}`)
    assertEqual((await git.summary(repo)).ahead, 0, 'push 后 ahead')
    const dry = await git.push(repo, { remote: 'origin', dryRun: true })
    assertEqual(dry.ok, true, 'dry-run push')
    const cloneCollector = sinkCollector()
    const cloned = await git.clone({ url: BARE, dir: CLONE }, cloneCollector.sink)
    assertEqual(cloned.path, CLONE, 'clone path')
    assert(cloneCollector.lines.length > 0, 'clone 没有进度输出')
    assert((await git.log(CLONE, { limit: 1 })).commits.length > 0, 'cloned log')
    await git.renameRemote(repo, 'origin', 'upstream')
    assert((await git.remotes(repo)).some((remote) => remote.name === 'upstream'), 'rename remote')
    await git.setRemoteUrl(repo, 'upstream', BARE)
    await git.removeRemote(repo, 'upstream')
    assertEqual((await git.remotes(repo)).length, 0, 'remove remote')
  })

  await check('revert / cherry-pick / reset / checkoutCommit', async () => {
    const before = (await git.log(repo, { limit: 1 })).commits[0]
    writeFile(path.join(repo, 'revert-me.txt'), 'v1\n')
    await git.stageAll(repo)
    const toRevert = await git.commit(repo, { message: 'feat: 待还原提交' })
    const reverted = await git.revert(repo, toRevert.hash)
    assertEqual(reverted.ok, true, `revert 失败：${reverted.stderr}`)
    const revertHead = (await git.log(repo, { limit: 1 })).commits[0]
    assertIncludes(revertHead.subject, 'Revert', 'revert subject')
    assertEqual((await git.status(repo)).clean, true, 'revert 后 clean')

    await git.createBranch(repo, 'pick-source', branch, true)
    writeFile(path.join(repo, 'pick.txt'), 'pick\n')
    await git.stageAll(repo)
    const pickCommit = await git.commit(repo, { message: 'feat: 待拣选提交' })
    await git.checkoutBranch(repo, branch)
    const beforeCount = (await git.log(repo, { limit: 100 })).commits.length
    const picked = await git.cherryPick(repo, pickCommit.hash)
    assertEqual(picked.ok, true, `cherry-pick 失败：${picked.stderr}`)
    const afterCount = (await git.log(repo, { limit: 100 })).commits.length
    assertEqual(afterCount, beforeCount + 1, 'cherry-pick 提交数')
    assert((await git.log(repo, { limit: 1 })).commits[0].subject === 'feat: 待拣选提交', 'cherry-pick subject')

    const headBeforeReset = (await git.log(repo, { limit: 1 })).commits[0]
    writeFile(path.join(repo, 'reset-me.txt'), 'reset\n')
    await git.stageAll(repo)
    await git.commit(repo, { message: 'feat: 待 reset' })
    await git.reset(repo, headBeforeReset.hash, 'soft')
    let status = await git.status(repo)
    assert(status.staged.length > 0, 'soft reset 后应有暂存改动')
    await git.reset(repo, headBeforeReset.hash, 'hard')
    status = await git.status(repo)
    assertEqual(status.clean, true, 'hard reset 后 clean')
    assertEqual((await git.log(repo, { limit: 1 })).commits[0].hash, headBeforeReset.hash, 'reset 后 HEAD')

    await git.checkoutCommit(repo, before.hash)
    const detached = await git.summary(repo)
    assertEqual(detached.detached, true, 'detached HEAD')
    assertEqual(detached.branch, null, 'detached branch')
    assertEqual(detached.head, before.hash, 'detached head hash')
    await git.checkoutBranch(repo, branch)
  })

  await check('submodule / gitlink 状态与 diff', async () => {
    const nested = path.join(repo, 'nested-repo')
    fs.mkdirSync(nested, { recursive: true })
    raw(['init'], nested)
    raw(['config', 'user.name', 'Nested'], nested)
    raw(['config', 'user.email', 'nested@example.com'], nested)
    writeFile(path.join(nested, 'n.txt'), 'nested\n')
    raw(['add', '-A'], nested)
    raw(['commit', '-m', 'nested commit'], nested)
    await git.stageAll(repo)
    const status = await git.status(repo)
    const entry = status.staged.find((file) => file.path === 'nested-repo')
    assert(entry, 'gitlink 未出现在 staged')
    assertEqual(entry.status, 'added', 'gitlink 状态')
    const diff = await git.diffStaged(repo, 'nested-repo')
    assertEqual(diff.files.length, 1, 'gitlink diff 文件数')
    assertEqual(diff.files[0].path, 'nested-repo', 'gitlink diff path')
    await git.commit(repo, { message: 'chore: 添加子模块目录（gitlink）' })
  })

  await check('version / validate 错误文案', async () => {
    const version = await git.version()
    assert(/git version \d+\.\d+/.test(version), `version 输出异常：${version}`)
    const notRepo = path.join(TMP, 'not-a-repo')
    fs.mkdirSync(notRepo, { recursive: true })
    let threw = false
    try {
      await git.validate(notRepo)
    } catch (error) {
      threw = true
      const message = error instanceof Error ? error.message : String(error)
      assertIncludes(message, '不是 Git 仓库', 'validate 错误文案')
    }
    assert(threw, 'validate 非仓库路径未抛错')
    let missingThrew = false
    try {
      await git.validate(path.join(TMP, 'does-not-exist'))
    } catch (error) {
      missingThrew = true
      const message = error instanceof Error ? error.message : String(error)
      assertIncludes(message, '路径不存在', '路径不存在文案')
    }
    assert(missingThrew, 'validate 不存在路径未抛错')
  })

  await check('summary 汇总字段', async () => {
    const summary = await git.summary(repo)
    assertEqual(summary.path, repo, 'path')
    assertEqual(summary.branch, branch, 'branch')
    assertEqual(summary.detached, false, 'detached')
    assertEqual(summary.operation, null, 'operation')
    assertEqual(summary.status.clean, true, 'clean')
    assertEqual(summary.stashCount, 0, 'stashCount')
    assertEqual(typeof summary.ahead, 'number', 'ahead 类型')
    assertEqual(typeof summary.behind, 'number', 'behind 类型')
  })
}

/* ------------------------------------------------ part C: file encodings */

const ENCODING_REPO = path.join(TMP, 'encoding-repo')
const PYTHON_SCRIPT = path.join(TMP, 'gen-encoding.py')

const PYTHON_GENERATOR = `# -*- coding: utf-8 -*-
import os
import sys

root, mode = sys.argv[1], sys.argv[2]


def write(name, text, encoding):
    data = text.encode(encoding)
    with open(os.path.join(root, name), 'wb') as handle:
        handle.write(data)


GBK = 'gb18030'
BOM = 'utf-8-sig'
U16 = 'utf-16'  # BOM + little endian on x86

if mode == 'initial':
    write('gbk-中文.md', '# 编码测试：GB18030\\n\\n第一行：中文内容\\n第二行：GBK 编码\\n第三行：结束\\n', GBK)
    write('bom-中文.md', '# 编码测试：UTF-8 BOM\\n\\n第一行：中文内容\\n第二行：BOM 编码\\n第三行：结束\\n', BOM)
    write('utf16-中文.md', '# 编码测试：UTF-16LE\\n\\n第一行：中文内容\\n第二行：UTF-16 编码\\n第三行：结束\\n', U16)
else:
    write('gbk-中文.md', '# 编码测试：GB18030\\n\\n第一行：中文内容\\n第二行：GBK 编码修改\\n第三行：结束\\n第四行：新增中文\\n', GBK)
    write('bom-中文.md', '# 编码测试：UTF-8 BOM\\n\\n第一行：中文内容\\n第二行：BOM 编码修改\\n第三行：结束\\n', BOM)
    write('utf16-中文.md', '# 编码测试：UTF-16LE\\n\\n第一行：中文内容\\n第二行：UTF-16 编码修改\\n第三行：结束\\n', U16)
`

function runPython(mode: 'initial' | 'modify'): void {
  const result = spawnSync('python', [PYTHON_SCRIPT, ENCODING_REPO, mode], {
    encoding: 'utf8',
    windowsHide: true
  })
  assert(result.status === 0, `python 生成编码文件失败：${result.stderr ?? ''}`)
}

function collectDiffText(files: DiffFile[]): string {
  return files
    .flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)))
    .join('\n')
}

function countNativeHunkLines(output: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

async function testEncodingRepo(): Promise<void> {
  console.log('\n=== Part C: mixed file encodings (GB18030 / UTF-8 BOM / UTF-16LE) ===')
  const repo = ENCODING_REPO

  await check('decodeSmart：GB18030 / UTF-8 BOM / UTF-16LE', async () => {
    const gbk = decodeSmart(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))
    assertEqual(gbk.text, '中文', 'gb18030 文本')
    assertEqual(gbk.encoding, 'gb18030', 'gb18030 标记')
    const bom = decodeSmart(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf8')]))
    assertEqual(bom.text, '中文', 'utf8 bom 文本')
    assertEqual(bom.encoding, 'utf-8', 'utf8 bom 标记')
    const utf16 = decodeSmart(Buffer.from('中文', 'utf16le').subarray(0)) // 无 BOM 时按 UTF-8 尝试
    assertEqual(utf16.text.includes('中'), false, '无 BOM UTF-16 无法自动识别（记录为限制）')
    const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')])
    const u16 = decodeSmart(withBom)
    assertEqual(u16.text, '中文', 'utf16le 文本')
    assertEqual(u16.encoding, 'utf-16le', 'utf16le 标记')
  })

  await check('Python 生成三份中文编码文件并提交（中文 commit message）', async () => {
    await fsp.rm(repo, { recursive: true, force: true })
    fs.mkdirSync(repo, { recursive: true })
    fs.writeFileSync(PYTHON_SCRIPT, PYTHON_GENERATOR, 'utf8')
    const summary = await git.init(repo)
    raw(['config', 'user.name', 'Miaoxin 编码测试'], repo)
    raw(['config', 'user.email', 'encoding@example.com'], repo)
    raw(['config', 'core.autocrlf', 'false'], repo)
    runPython('initial')
    await git.stageAll(repo)
    const commit = await git.commit(repo, {
      message: '编码测试：三份中文编码文件\n\nGBK、UTF-8 BOM、UTF-16LE 混合仓库\n验证中文提交信息'
    })
    const log = await git.log(repo, { limit: 1 })
    assertEqual(log.commits[0].hash, commit.hash, '提交 hash')
    assertEqual(log.commits[0].subject, '编码测试：三份中文编码文件', '中文 subject')
    assertIncludes(log.commits[0].body, '验证中文提交信息', '中文 body')
    assertEqual((await git.status(repo)).clean, true, '初始提交后 clean')
    assertEqual(summary.branch !== null, true, 'branch')
    runPython('modify')
    const status = await git.status(repo)
    assertEqual(status.unstaged.length, 3, `修改后 unstaged 数量：${status.unstaged.length}`)
  })

  await check('GB18030 diff：中文正确、无 U+FFFD、行号正确', async () => {
    const diff = await git.diffWorktree(repo, 'gbk-中文.md', 'unstaged')
    assertEqual(diff.files.length, 1, '文件数')
    const file = diff.files[0]
    assertEqual(file.encoding, 'gb18030', `encoding：${file.encoding}`)
    assertEqual(file.additions, 2, 'additions')
    assertEqual(file.deletions, 1, 'deletions')
    assertEqual(file.hunks.length, 1, 'hunk 数量')
    const hunk = file.hunks[0]
    assertEqual(hunk.oldStart, 1, 'oldStart')
    assertEqual(hunk.oldLines, 5, 'oldLines')
    assertEqual(hunk.newStart, 1, 'newStart')
    assertEqual(hunk.newLines, 6, 'newLines')
    const text = collectDiffText(diff.files)
    assertIncludes(text, '第二行：GBK 编码修改', '新增中文内容')
    assertIncludes(text, '第二行：GBK 编码', '删除中文内容')
    assertIncludes(text, '第四行：新增中文', '追加中文内容')
    assertEqual(text.includes('\uFFFD'), false, '不应出现 U+FFFD')
    const added = hunk.lines.find((line) => line.type === 'add' && line.text === '第四行：新增中文')
    assert(added, '找不到追加行')
    assertEqual(added.newLine, 6, '追加行 newLine')
    const removed = hunk.lines.find((line) => line.type === 'del' && line.text === '第二行：GBK 编码')
    assert(removed, '找不到删除行')
    assertEqual(removed.oldLine, 4, '删除行 oldLine')
    assertEqual(hunk.lines[0].oldLine, 1, '首行 oldLine')
    assertEqual(hunk.lines[0].newLine, 1, '首行 newLine')

    // 与原生 git diff --numstat / 原生 patch 行数对比
    const numstat = raw(['diff', '--numstat', '--', 'gbk-中文.md'], repo)
    const numbers = /^(\d+)\t(\d+)\t/.exec(numstat.stdout)
    assert(numbers, `无法解析 numstat：${numstat.stdout}`)
    assertEqual(Number(numbers[1]), file.additions, 'numstat additions')
    assertEqual(Number(numbers[2]), file.deletions, 'numstat deletions')
    const native = raw(['diff', '--no-color', '--no-ext-diff', '--', 'gbk-中文.md'], repo)
    const nativeCounts = countNativeHunkLines(native.stdout)
    assertEqual(nativeCounts.additions, file.additions, '原生 diff additions')
    assertEqual(nativeCounts.deletions, file.deletions, '原生 diff deletions')
  })

  await check('UTF-8 BOM diff：BOM 被剥离、中文正确', async () => {
    const diff = await git.diffWorktree(repo, 'bom-中文.md', 'unstaged')
    assertEqual(diff.files.length, 1, '文件数')
    const file = diff.files[0]
    assertEqual(file.encoding ?? 'utf-8', 'utf-8', 'encoding')
    assertEqual(file.additions, 1, 'additions')
    assertEqual(file.deletions, 1, 'deletions')
    const text = collectDiffText(diff.files)
    assertIncludes(text, '第二行：BOM 编码修改', '中文内容')
    assertEqual(text.includes('\uFFFD'), false, '不应出现 U+FFFD')
    assertEqual(text.includes('\uFEFF'), false, '不应保留 BOM 字符')
    assertEqual(file.hunks[0].lines[0].newLine, 1, '首行 newLine')
    const native = raw(['diff', '--numstat', '--', 'bom-中文.md'], repo)
    const numbers = /^(\d+)\t(\d+)\t/.exec(native.stdout)
    assert(numbers, '无法解析 numstat')
    assertEqual(Number(numbers[1]), file.additions, 'numstat additions')
    assertEqual(Number(numbers[2]), file.deletions, 'numstat deletions')
  })

  await check('UTF-16LE diff：git 判定 binary 时回退为文本 diff', async () => {
    const diff = await git.diffWorktree(repo, 'utf16-中文.md', 'unstaged')
    assertEqual(diff.files.length, 1, '文件数')
    const file = diff.files[0]
    assertEqual(file.binary, false, '应回退为文本 diff')
    assertEqual(file.encoding, 'utf-16le', `encoding：${file.encoding}`)
    assertEqual(file.additions, 1, 'additions')
    assertEqual(file.deletions, 1, 'deletions')
    assertEqual(file.hunks.length, 1, 'hunk 数量')
    const hunk = file.hunks[0]
    assertEqual(hunk.oldLines, 5, 'oldLines')
    assertEqual(hunk.newLines, 5, 'newLines')
    const text = collectDiffText(diff.files)
    assertIncludes(text, '第二行：UTF-16 编码修改', 'UTF-16 中文内容')
    assertEqual(text.includes('\uFFFD'), false, '不应出现 U+FFFD')
    const add = hunk.lines.find((line) => line.type === 'add')
    assert(add, '找不到 add 行')
    assertEqual(add.text, '第二行：UTF-16 编码修改', 'UTF-16 add 文本')
    assertEqual(add.newLine, 4, 'UTF-16 add 行号')
    const del = hunk.lines.find((line) => line.type === 'del')
    assert(del, '找不到 del 行')
    assertEqual(del.oldLine, 4, 'UTF-16 del 行号')
  })

  await check('GB18030 hunk 级暂存（字节保真）', async () => {
    await git.applyHunk(repo, { file: 'gbk-中文.md', hunkIndex: 0, source: 'unstaged' })
    const status = await git.status(repo)
    assert(status.staged.some((file) => file.path === 'gbk-中文.md'), 'GBK 文件未暂存')
    const staged = await git.diffStaged(repo, 'gbk-中文.md')
    assertEqual(staged.files[0].encoding, 'gb18030', 'staged encoding')
    const text = collectDiffText(staged.files)
    assertIncludes(text, '第二行：GBK 编码修改', 'staged 中文内容')
    assertEqual(text.includes('\uFFFD'), false, 'staged 不应出现 U+FFFD')
    await git.applyHunk(repo, { file: 'gbk-中文.md', hunkIndex: 0, source: 'staged', reverse: true })
    assert(!(await git.status(repo)).staged.some((file) => file.path === 'gbk-中文.md'), '取消暂存后仍暂存')
  })

  await check('编码文件提交后的 commit / range diff', async () => {
    await git.stageAll(repo)
    const committed = await git.commit(repo, { message: '编码测试：修改三份中文文件' })
    const log = await git.log(repo, { limit: 2 })
    assertEqual(log.commits[0].hash, committed.hash, '提交 hash')
    assertEqual(log.commits[0].subject, '编码测试：修改三份中文文件', '中文 subject')
    const commitDiff = await git.diffCommit(repo, committed.hash, 'gbk-中文.md')
    assertEqual(commitDiff.files[0].encoding, 'gb18030', 'commit diff encoding')
    assertIncludes(collectDiffText(commitDiff.files), '第二行：GBK 编码修改', 'commit diff 中文')
    const parent = log.commits[1]
    const range = await git.diffRange(repo, parent.hash, committed.hash, 'gbk-中文.md')
    assertEqual(range.files[0].encoding, 'gb18030', 'range diff encoding')
    assertIncludes(collectDiffText(range.files), '第四行：新增中文', 'range diff 中文')
    const summary = await git.summary(repo)
    assertEqual(summary.status.clean, true, '提交后 clean')
  })
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<void> {
  console.log('Miaoxin Git GUI — git backend smoke test')
  console.log(`git: ${spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? 'unknown'}`)

  for (const repo of REAL_REPOS) {
    await testRealRepo(repo)
  }
  await testSmokeRepo()
  await testEncodingRepo()

  console.log('\n=== 结果 ===')
  console.log(`通过：${passed.length}`)
  if (failures.length === 0) {
    console.log('全部通过')
    process.exitCode = 0
    return
  }
  console.log(`失败：${failures.length}`)
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.message}`)
  process.exitCode = 1
}

void main().catch((error) => {
  console.error('冒烟测试异常终止：', error)
  process.exitCode = 1
})

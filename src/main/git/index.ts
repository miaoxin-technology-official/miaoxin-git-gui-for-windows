// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type {
  BranchInfo,
  CloneOptions,
  CommitDetail,
  CommitOptions,
  CommitResult,
  ConflictFile,
  DiffOptions,
  DiffResult,
  FetchOptions,
  HunkApplyArgs,
  LogQuery,
  LogResult,
  OperationResult,
  OperationState,
  PullOptions,
  PushOptions,
  RemoteInfo,
  RepoSummary,
  StashEntry,
  StatusSnapshot,
  TagInfo
} from '@shared/types'
import { store } from '../store'
import {
  assertSafeRef,
  gitFailure,
  NETWORK_TIMEOUT,
  runGit,
  runGitOk,
  setGitPathProvider
} from './exec'
import type { ProgressSink } from './exec'
import { readStatus } from './status'
import { readCommitDetail, readLog } from './log'
import { diffCommit, diffRange, diffStaged, diffStash, diffWorktree } from './diff'
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  merge,
  readBranches,
  rebase,
  renameBranch,
  setUpstream
} from './branches'
import {
  abortOperation,
  checkoutCommit,
  cherryPick,
  continueOperation,
  operationState,
  readConflicts,
  reset,
  resolveConflict,
  revert
} from './ops'
import { addRemote, fetch, pull, push, readRemotes, removeRemote, renameRemote, setRemoteUrl } from './remotes'
import { stashApply, stashCount, stashDrop, stashList, stashPop, stashSave } from './stash'
import { createTag, deleteTag, fetchTags, pushAllTags, pushTag, readTags } from './tags'
import { applyHunk } from './patch'

/**
 * The single entry point for every git operation in the main process.
 * `ipc.ts` validates arguments and wires progress; this module composes the
 * feature modules (status/log/diff/branches/remotes/stash/tags/ops/patch) into
 * the `GitService` contract from `docs/CONTRACT.md` §4.
 */

export type { ProgressSink } from './exec'

/**
 * Every git operation that Miaoxin Git GUI performs lives behind this interface.
 * The IPC layer only validates arguments, wires progress and broadcasts events;
 * all porcelain parsing and command execution belongs in this module.
 */
export interface GitService {
  version(): Promise<string>
  validate(path: string): Promise<void>
  open(path: string): Promise<RepoSummary>
  init(path: string): Promise<RepoSummary>
  clone(opts: CloneOptions, sink: ProgressSink): Promise<RepoSummary>
  summary(path: string): Promise<RepoSummary>

  status(path: string): Promise<StatusSnapshot>
  log(path: string, query?: LogQuery): Promise<LogResult>
  commitDetail(path: string, hash: string): Promise<CommitDetail>

  diffWorktree(path: string, file: string, side: 'staged' | 'unstaged', opts?: DiffOptions): Promise<DiffResult>
  diffStaged(path: string, file?: string, opts?: DiffOptions): Promise<DiffResult>
  diffCommit(path: string, hash: string, file?: string, opts?: DiffOptions): Promise<DiffResult>
  diffRange(path: string, from: string, to: string, file?: string, opts?: DiffOptions): Promise<DiffResult>
  diffStash(path: string, index: number, file?: string, opts?: DiffOptions): Promise<DiffResult>

  stage(path: string, files: string[]): Promise<void>
  unstage(path: string, files: string[]): Promise<void>
  discard(path: string, files: string[], side: 'staged' | 'unstaged' | 'untracked'): Promise<void>
  stageAll(path: string): Promise<void>
  unstageAll(path: string): Promise<void>
  applyHunk(path: string, args: HunkApplyArgs): Promise<void>
  ignore(path: string, patterns: string[]): Promise<void>
  resolveConflict(path: string, file: string, strategy: 'ours' | 'theirs' | 'mark'): Promise<void>
  conflicts(path: string): Promise<ConflictFile[]>

  commit(path: string, opts: CommitOptions): Promise<CommitResult>

  branches(path: string): Promise<BranchInfo[]>
  createBranch(path: string, name: string, startPoint?: string, checkout?: boolean): Promise<void>
  checkoutBranch(path: string, name: string): Promise<void>
  renameBranch(path: string, oldName: string, newName: string): Promise<void>
  deleteBranch(path: string, name: string, force?: boolean): Promise<void>
  merge(path: string, name: string, opts?: { noFastForward?: boolean; squash?: boolean; message?: string }): Promise<OperationResult>
  rebase(path: string, onto: string): Promise<OperationResult>
  setUpstream(path: string, branch: string, upstream: string | null): Promise<void>

  remotes(path: string): Promise<RemoteInfo[]>
  addRemote(path: string, name: string, url: string): Promise<void>
  removeRemote(path: string, name: string): Promise<void>
  renameRemote(path: string, oldName: string, newName: string): Promise<void>
  setRemoteUrl(path: string, name: string, url: string): Promise<void>

  fetch(path: string, opts?: FetchOptions, sink?: ProgressSink): Promise<OperationResult>
  pull(path: string, opts?: PullOptions, sink?: ProgressSink): Promise<OperationResult>
  push(path: string, opts?: PushOptions, sink?: ProgressSink): Promise<OperationResult>

  stashList(path: string): Promise<StashEntry[]>
  stashSave(path: string, message: string, includeUntracked?: boolean): Promise<OperationResult>
  stashPop(path: string, index: number): Promise<OperationResult>
  stashApply(path: string, index: number): Promise<OperationResult>
  stashDrop(path: string, index: number): Promise<OperationResult>

  tags(path: string): Promise<TagInfo[]>
  createTag(path: string, name: string, target?: string, message?: string): Promise<void>
  deleteTag(path: string, name: string, remote?: string): Promise<void>
  pushTag(path: string, name: string, remote?: string): Promise<OperationResult>
  pushAllTags(path: string, remote?: string): Promise<OperationResult>
  fetchTags(path: string): Promise<OperationResult>

  checkoutCommit(path: string, hash: string): Promise<void>
  reset(path: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>
  cherryPick(path: string, hash: string): Promise<OperationResult>
  revert(path: string, hash: string): Promise<OperationResult>

  operationState(path: string): Promise<OperationState | null>
  continueOperation(path: string): Promise<OperationResult>
  abortOperation(path: string): Promise<OperationResult>
}

/* ------------------------------------------------------------------ helpers */

/** Resolves `path` to the repository root, with Chinese errors for bad input. */
export async function resolveRoot(repo: string): Promise<string> {
  const target = path.resolve(repo)
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    throw new Error(`路径不存在：${repo}`)
  }
  if (!stat.isDirectory()) throw new Error(`不是文件夹：${repo}`)
  const result = await runGit(['rev-parse', '--show-toplevel'], { cwd: target })
  if (result.code !== 0) {
    if (/not a git repository|not a git repo/i.test(result.stderr)) throw new Error(`不是 Git 仓库：${target}`)
    throw gitFailure('无法打开仓库', result)
  }
  const root = result.stdout.trim()
  if (!root) throw new Error(`不是 Git 仓库：${target}`)
  return path.resolve(root)
}

async function buildSummary(repo: string): Promise<RepoSummary> {
  const [statusRead, remotes, operation, stashes] = await Promise.all([
    readStatus(repo),
    readRemotes(repo),
    operationState(repo),
    stashCount(repo)
  ])
  return {
    path: repo,
    name: path.basename(repo) || repo,
    branch: statusRead.head.branch,
    detached: statusRead.head.detached,
    head: statusRead.head.head,
    upstream: statusRead.head.upstream,
    ahead: statusRead.head.ahead,
    behind: statusRead.head.behind,
    remotes,
    operation,
    stashCount: stashes,
    status: statusRead.snapshot
  }
}

function requireFiles(files: string[], action: string): void {
  if (!Array.isArray(files) || files.length === 0) throw new Error(`没有选择要${action}的文件`)
}

/** Ensures a path stays inside the repository root (for fs deletion). */
function assertInsideRoot(root: string, file: string): string {
  if (!file) throw new Error('文件路径不能为空')
  const absolute = path.resolve(root, file)
  const relative = path.relative(root, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`文件路径不在仓库内：${file}`)
  }
  return absolute
}

/* -------------------------------------------------------------- implementation */

class GitServiceImpl implements GitService {
  async version(): Promise<string> {
    const result = await runGit(['--version'])
    if (result.code !== 0) throw gitFailure('无法运行 git，请在设置中指定 git 路径', result)
    return result.stdout.trim()
  }

  async validate(repo: string): Promise<void> {
    await resolveRoot(repo)
  }

  async open(repo: string): Promise<RepoSummary> {
    return buildSummary(await resolveRoot(repo))
  }

  async init(repo: string): Promise<RepoSummary> {
    const target = path.resolve(repo)
    await fs.mkdir(target, { recursive: true })
    const result = await runGit(['init'], { cwd: target })
    if (result.code !== 0) throw gitFailure('初始化仓库失败', result)
    return buildSummary(await resolveRoot(target))
  }

  async clone(opts: CloneOptions, sink: ProgressSink): Promise<RepoSummary> {
    const target = path.resolve(opts.dir)
    const parent = path.dirname(target)
    await fs.mkdir(parent, { recursive: true })
    try {
      const entries = await fs.readdir(target)
      if (entries.length > 0) throw new Error(`目标目录不是空目录：${target}`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code && code !== 'ENOENT') throw error
    }

    const url = assertSafeRef(opts.url, '仓库地址')
    const args = ['clone', '--progress']
    if (opts.recurseSubmodules) args.push('--recurse-submodules')
    if (opts.depth && opts.depth > 0) args.push('--depth', String(Math.floor(opts.depth)))
    args.push('--', url, target)

    const result = await runGit(args, { cwd: parent, sink, timeoutMs: NETWORK_TIMEOUT })
    if (result.code !== 0) throw gitFailure('克隆仓库失败', result)
    return buildSummary(await resolveRoot(target))
  }

  async summary(repo: string): Promise<RepoSummary> {
    return buildSummary(await resolveRoot(repo))
  }

  async status(repo: string): Promise<StatusSnapshot> {
    return (await readStatus(repo)).snapshot
  }

  async log(repo: string, query?: LogQuery): Promise<LogResult> {
    return readLog(repo, query)
  }

  async commitDetail(repo: string, hash: string): Promise<CommitDetail> {
    return readCommitDetail(repo, hash)
  }

  async diffWorktree(
    repo: string,
    file: string,
    side: 'staged' | 'unstaged',
    opts?: DiffOptions
  ): Promise<DiffResult> {
    return diffWorktree(repo, file, side, opts)
  }

  async diffStaged(repo: string, file?: string, opts?: DiffOptions): Promise<DiffResult> {
    return diffStaged(repo, file, opts)
  }

  async diffCommit(repo: string, hash: string, file?: string, opts?: DiffOptions): Promise<DiffResult> {
    return diffCommit(repo, hash, file, opts)
  }

  async diffRange(
    repo: string,
    from: string,
    to: string,
    file?: string,
    opts?: DiffOptions
  ): Promise<DiffResult> {
    return diffRange(repo, from, to, file, opts)
  }

  async diffStash(repo: string, index: number, file?: string, opts?: DiffOptions): Promise<DiffResult> {
    return diffStash(repo, index, file, opts)
  }

  async stage(repo: string, files: string[]): Promise<void> {
    requireFiles(files, '暂存')
    const root = await resolveRoot(repo)
    await runGitOk(['add', '-A', '--', ...files], { cwd: root }, '无法暂存文件')
  }

  async unstage(repo: string, files: string[]): Promise<void> {
    requireFiles(files, '取消暂存')
    const root = await resolveRoot(repo)
    const trackedResult = await runGit(['ls-files', '-z', '--', ...files], { cwd: root })
    if (trackedResult.code !== 0) throw gitFailure('无法读取暂存区', trackedResult)
    const tracked = new Set(trackedResult.stdout.split('\0').filter(Boolean))
    const indexed = files.filter((file) => tracked.has(file))
    const untracked = files.filter((file) => !tracked.has(file))
    if (indexed.length > 0) {
      const restore = await runGit(['restore', '--staged', '--', ...indexed], { cwd: root })
      if (restore.code !== 0) {
        // No commits yet: there is no HEAD to restore from, so drop the index
        // entries directly (worktree content is preserved).
        if (/could not resolve 'HEAD'|ambiguous argument 'HEAD'|does not have any commits/i.test(restore.stderr)) {
          await runGitOk(['rm', '-r', '--cached', '--ignore-unmatch', '--', ...indexed], { cwd: root }, '无法取消暂存')
        } else {
          throw gitFailure('无法取消暂存', restore)
        }
      }
    }
    if (untracked.length > 0) {
      // Never staged: `git rm --cached --ignore-unmatch` is a safe no-op.
      await runGit(['rm', '--cached', '--ignore-unmatch', '--', ...untracked], { cwd: root })
    }
  }

  async discard(repo: string, files: string[], side: 'staged' | 'unstaged' | 'untracked'): Promise<void> {
    requireFiles(files, '丢弃改动')
    const root = await resolveRoot(repo)
    if (side === 'staged') {
      await runGitOk(['restore', '--staged', '--', ...files], { cwd: root }, '无法取消暂存')
      return
    }
    if (side === 'unstaged') {
      await runGitOk(['restore', '--', ...files], { cwd: root }, '无法还原文件改动')
      return
    }
    for (const file of files) {
      const absolute = assertInsideRoot(root, file)
      await fs.rm(absolute, { recursive: true, force: true })
    }
  }

  async stageAll(repo: string): Promise<void> {
    const root = await resolveRoot(repo)
    await runGitOk(['add', '-A'], { cwd: root }, '无法暂存全部改动')
  }

  async unstageAll(repo: string): Promise<void> {
    const root = await resolveRoot(repo)
    const result = await runGit(['restore', '--staged', '--', '.'], { cwd: root })
    if (result.code === 0) return
    if (/could not resolve 'HEAD'|ambiguous argument 'HEAD'|unknown revision|does not have any commits|invalid option/i.test(result.stderr)) {
      const fallback = await runGit(['rm', '-r', '--cached', '--ignore-unmatch', '--', '.'], { cwd: root })
      if (fallback.code === 0) return
      throw gitFailure('无法取消暂存', fallback)
    }
    throw gitFailure('无法取消暂存', result)
  }

  async applyHunk(repo: string, args: HunkApplyArgs): Promise<void> {
    const root = await resolveRoot(repo)
    await applyHunk(root, args)
  }

  async ignore(repo: string, patterns: string[]): Promise<void> {
    if (!Array.isArray(patterns) || patterns.length === 0) throw new Error('没有提供忽略规则')
    const root = await resolveRoot(repo)
    const rules = patterns.map((pattern) => pattern.trim()).filter(Boolean)
    if (rules.length === 0) throw new Error('没有提供忽略规则')
    if (rules.some((rule) => /[\r\n]/.test(rule))) throw new Error('忽略规则不能包含换行')

    const ignoreFile = path.join(root, '.gitignore')
    let current = ''
    try {
      current = await fs.readFile(ignoreFile, 'utf8')
    } catch {
      current = ''
    }
    const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    const additions = rules.filter((rule) => !existing.has(rule))
    if (additions.length === 0) return
    let next = current
    if (next.length > 0 && !next.endsWith('\n')) next += '\n'
    next += `${additions.join('\n')}\n`
    await fs.writeFile(ignoreFile, next, 'utf8')
  }

  async resolveConflict(repo: string, file: string, strategy: 'ours' | 'theirs' | 'mark'): Promise<void> {
    const root = await resolveRoot(repo)
    await resolveConflict(root, file, strategy)
  }

  async conflicts(repo: string): Promise<ConflictFile[]> {
    return readConflicts(repo)
  }

  async commit(repo: string, opts: CommitOptions): Promise<CommitResult> {
    const root = await resolveRoot(repo)
    const message = opts.message ?? ''
    if (!message.trim()) throw new Error('提交信息不能为空')
    const args = ['commit']
    if (opts.amend) args.push('--amend')
    if (opts.signoff) args.push('--signoff')
    if (opts.allowEmpty) args.push('--allow-empty')
    args.push('-F', '-')
    const result = await runGit(args, { cwd: root, input: message, env: { GIT_EDITOR: 'true' } })
    if (result.code !== 0) {
      if (/nothing to commit|no changes added to commit/i.test(result.stdout + result.stderr)) {
        throw gitFailure('没有可提交的改动', result)
      }
      throw gitFailure('提交失败', result)
    }
    const info = await runGitOk(
      ['log', '-1', '--encoding=UTF-8', '--format=%H%x00%h%x00%s'],
      { cwd: root },
      '无法读取新提交'
    )
    const [hash, shortHash, subject] = info.stdout.replace(/\r?\n+$/, '').split('\0')
    return { hash, shortHash, subject: subject ?? '', stdout: result.stdout }
  }

  async branches(repo: string): Promise<BranchInfo[]> {
    return readBranches(repo)
  }

  async createBranch(repo: string, name: string, startPoint?: string, checkout = false): Promise<void> {
    const root = await resolveRoot(repo)
    await createBranch(root, name, startPoint, checkout)
  }

  async checkoutBranch(repo: string, name: string): Promise<void> {
    const root = await resolveRoot(repo)
    await checkoutBranch(root, name)
  }

  async renameBranch(repo: string, oldName: string, newName: string): Promise<void> {
    const root = await resolveRoot(repo)
    await renameBranch(root, oldName, newName)
  }

  async deleteBranch(repo: string, name: string, force?: boolean): Promise<void> {
    const root = await resolveRoot(repo)
    await deleteBranch(root, name, force)
  }

  async merge(
    repo: string,
    name: string,
    opts?: { noFastForward?: boolean; squash?: boolean; message?: string }
  ): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return merge(root, name, opts)
  }

  async rebase(repo: string, onto: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return rebase(root, onto)
  }

  async setUpstream(repo: string, branch: string, upstream: string | null): Promise<void> {
    const root = await resolveRoot(repo)
    await setUpstream(root, branch, upstream)
  }

  async remotes(repo: string): Promise<RemoteInfo[]> {
    return readRemotes(repo)
  }

  async addRemote(repo: string, name: string, url: string): Promise<void> {
    const root = await resolveRoot(repo)
    await addRemote(root, name, url)
  }

  async removeRemote(repo: string, name: string): Promise<void> {
    const root = await resolveRoot(repo)
    await removeRemote(root, name)
  }

  async renameRemote(repo: string, oldName: string, newName: string): Promise<void> {
    const root = await resolveRoot(repo)
    await renameRemote(root, oldName, newName)
  }

  async setRemoteUrl(repo: string, name: string, url: string): Promise<void> {
    const root = await resolveRoot(repo)
    await setRemoteUrl(root, name, url)
  }

  async fetch(repo: string, opts?: FetchOptions, sink?: ProgressSink): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return fetch(root, opts, sink)
  }

  async pull(repo: string, opts?: PullOptions, sink?: ProgressSink): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return pull(root, opts, sink)
  }

  async push(repo: string, opts?: PushOptions, sink?: ProgressSink): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return push(root, opts, sink)
  }

  async stashList(repo: string): Promise<StashEntry[]> {
    return stashList(repo)
  }

  async stashSave(repo: string, message: string, includeUntracked?: boolean): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return stashSave(root, message, includeUntracked)
  }

  async stashPop(repo: string, index: number): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return stashPop(root, index)
  }

  async stashApply(repo: string, index: number): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return stashApply(root, index)
  }

  async stashDrop(repo: string, index: number): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return stashDrop(root, index)
  }

  async tags(repo: string): Promise<TagInfo[]> {
    return readTags(repo)
  }

  async createTag(repo: string, name: string, target?: string, message?: string): Promise<void> {
    const root = await resolveRoot(repo)
    await createTag(root, name, target, message)
  }

  async deleteTag(repo: string, name: string, remote?: string): Promise<void> {
    const root = await resolveRoot(repo)
    await deleteTag(root, name, remote)
  }

  async pushTag(repo: string, name: string, remote?: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return pushTag(root, name, remote)
  }

  async pushAllTags(repo: string, remote?: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return pushAllTags(root, remote)
  }

  async fetchTags(repo: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return fetchTags(root)
  }

  async checkoutCommit(repo: string, hash: string): Promise<void> {
    const root = await resolveRoot(repo)
    await checkoutCommit(root, hash)
  }

  async reset(repo: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const root = await resolveRoot(repo)
    await reset(root, hash, mode)
  }

  async cherryPick(repo: string, hash: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return cherryPick(root, hash)
  }

  async revert(repo: string, hash: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return revert(root, hash)
  }

  async operationState(repo: string): Promise<OperationState | null> {
    return operationState(repo)
  }

  async continueOperation(repo: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return continueOperation(root)
  }

  async abortOperation(repo: string): Promise<OperationResult> {
    const root = await resolveRoot(repo)
    return abortOperation(root)
  }
}

/* ----------------------------------------------------------------- factory */

export interface CreateGitServiceOptions {
  /** Test hook: override the git executable (settings value is used otherwise). */
  gitPath?: string | (() => string)
}

let cachedDefaultGitPath: string | null = null

/**
 * Git bundled with the installer (MinGit under `resources/git`). Used only when
 * no system Git is available, so the app works on machines without Git.
 */
function findBundledGit(): string | null {
  const candidates: string[] = []
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resources) candidates.push(path.join(resources, 'git', 'cmd', 'git.exe'))
  try {
    candidates.push(path.resolve(__dirname, '../../vendor/git/cmd/git.exe'))
  } catch {
    /* ESM test runners have no __dirname */
  }
  candidates.push(path.resolve(process.cwd(), 'vendor/git/cmd/git.exe'))
  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) return candidate
    } catch {
      /* ignore unreachable candidates */
    }
  }
  return null
}

function canRunGit(gitPath: string): boolean {
  try {
    const result = spawnSync(gitPath, ['--version'], {
      windowsHide: true,
      timeout: 5000,
      stdio: 'ignore',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    return result.status === 0
  } catch {
    return false
  }
}

/**
 * Resolution order is intentionally self-contained: an explicit setting wins,
 * then the Git bundled with the installer, and only as a last resort PATH.
 * The app does not require the machine to have Git installed.
 */
function defaultGitPath(): string {
  let configured: string | null = null
  try {
    configured = store.get().gitPath
  } catch {
    configured = null
  }
  if (configured) return configured
  if (cachedDefaultGitPath) return cachedDefaultGitPath
  cachedDefaultGitPath = canRunGit('git') ? 'git' : (findBundledGit() ?? 'git')
  return cachedDefaultGitPath
}

/**
 * Creates the service backed by the real git binary. `options.gitPath` exists so
 * the smoke script can run outside Electron; the app calls `createGitService()`.
 */
export function createGitService(options: CreateGitServiceOptions = {}): GitService {
  const configured = options.gitPath
  setGitPathProvider(
    typeof configured === 'function'
      ? configured
      : typeof configured === 'string'
        ? () => configured
        : defaultGitPath
  )
  return new GitServiceImpl()
}

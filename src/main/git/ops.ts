import fs from 'node:fs'
import path from 'node:path'
import type { ConflictFile, OperationKind, OperationResult, OperationState } from '@shared/types'
import { decodeNulTokens } from './encoding'
import { assertSafeRef, gitFailure, runGit, runGitOk, type GitResult } from './exec'

/**
 * Multi-step operations: merge / rebase / cherry-pick / revert and their
 * continue/abort flow. A conflict is an expected outcome, never an exception —
 * callers get `ok:false` with the raw streams and the conflicted paths.
 */

const EDITOR_ENV: Record<string, string> = {
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no'
}

/** Wraps a raw result in the shared `OperationResult` shape. */
export function toOperationResult(result: GitResult, conflicts: string[] = []): OperationResult {
  const operation: OperationResult = {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output
  }
  if (conflicts.length > 0) operation.conflicts = conflicts
  return operation
}

/** Unmerged paths currently recorded in the index (`--diff-filter=U`). */
export async function unmergedPaths(repo: string): Promise<string[]> {
  const result = await runGit(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: repo })
  if (result.code !== 0) return []
  return decodeNulTokens(result.stdoutBuffer)
    .map((token) => token.text)
    .filter(Boolean)
}

/** Conflict list with the index stages that are actually present. */
export async function readConflicts(repo: string): Promise<ConflictFile[]> {
  const result = await runGitOk(['ls-files', '-u', '-z'], { cwd: repo }, '无法读取冲突文件')
  const map = new Map<string, ConflictFile>()
  for (const decoded of decodeNulTokens(result.stdoutBuffer)) {
    const token = decoded.text
    if (!token) continue
    const tab = token.indexOf('\t')
    if (tab === -1) continue
    const meta = token.slice(0, tab).split(' ')
    const stage = Number(meta[2])
    const filePath = token.slice(tab + 1)
    if (!filePath) continue
    let entry = map.get(filePath)
    if (!entry) {
      entry = { path: filePath, ours: false, theirs: false, base: false }
      map.set(filePath, entry)
    }
    if (stage === 1) entry.base = true
    else if (stage === 2) entry.ours = true
    else if (stage === 3) entry.theirs = true
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Runs an operation command (merge/rebase/cherry-pick/…) and packages the
 * result. Conflicts are collected so the UI can enter conflict mode.
 */
export async function runOperation(
  repo: string,
  args: string[],
  options: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<OperationResult> {
  const result = await runGit(args, {
    cwd: repo,
    env: { ...EDITOR_ENV, ...options.env },
    timeoutMs: options.timeoutMs
  })
  if (result.code === 0) return toOperationResult(result)
  const conflicts = await unmergedPaths(repo)
  return toOperationResult(result, conflicts)
}

/* ---------------------------------------------------------- operation state */

async function gitDir(repo: string): Promise<string> {
  const result = await runGitOk(['rev-parse', '--absolute-git-dir'], { cwd: repo }, '无法定位 Git 目录')
  return result.stdout.trim()
}

function existsSync(absolute: string): boolean {
  try {
    fs.statSync(absolute)
    return true
  } catch {
    return false
  }
}

function readSmallFile(absolute: string): string {
  try {
    return fs.readFileSync(absolute, 'utf8').trim()
  } catch {
    return ''
  }
}

function parseProgress(dir: string, currentFile: string, totalFile: string): OperationState['progress'] {
  const current = Number(readSmallFile(path.join(dir, currentFile)))
  const total = Number(readSmallFile(path.join(dir, totalFile)))
  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return { current, total }
  }
  return undefined
}

/**
 * Detects an in-progress multi-step operation by inspecting the git directory:
 * MERGE_HEAD, rebase-merge/, rebase-apply/, CHERRY_PICK_HEAD, REVERT_HEAD,
 * BISECT_LOG. Also returns the current conflict list.
 */
export async function operationState(repo: string): Promise<OperationState | null> {
  const dir = await gitDir(repo)
  const inProgress = (relative: string): boolean => existsSync(path.join(dir, relative))

  let kind: OperationKind | null = null
  let detail = ''

  const rebaseMerge = inProgress('rebase-merge')
  const rebaseApply = inProgress('rebase-apply')
  if (rebaseMerge || rebaseApply) {
    const rebaseDir = path.join(dir, rebaseMerge ? 'rebase-merge' : 'rebase-apply')
    const isAm = !rebaseMerge && inProgress('rebase-apply/applying')
    if (isAm) {
      kind = 'am'
      detail = 'git am 进行中'
    } else {
      kind = 'rebase'
      const progress = rebaseMerge
        ? parseProgress(rebaseDir, 'msgnum', 'end')
        : parseProgress(rebaseDir, 'next', 'last')
      detail = progress ? `变基进行中（第 ${progress.current}/${progress.total} 个提交）` : '变基进行中'
    }
  } else if (inProgress('MERGE_HEAD')) {
    kind = 'merge'
    detail = '合并进行中：解决冲突后提交以完成合并'
  } else if (inProgress('CHERRY_PICK_HEAD')) {
    kind = 'cherry-pick'
    detail = '拣选提交进行中'
  } else if (inProgress('REVERT_HEAD')) {
    kind = 'revert'
    detail = '还原提交进行中'
  } else if (inProgress('BISECT_LOG')) {
    kind = 'bisect'
    detail = '二分查找进行中（git bisect）'
  }

  if (!kind) return null
  const conflicts = await unmergedPaths(repo)
  const state: OperationState = { kind, detail, conflicts }
  if (kind === 'rebase') {
    const rebaseDir = path.join(dir, rebaseMerge ? 'rebase-merge' : 'rebase-apply')
    const progress = rebaseMerge
      ? parseProgress(rebaseDir, 'msgnum', 'end')
      : parseProgress(rebaseDir, 'next', 'last')
    if (progress) state.progress = progress
  }
  if (conflicts.length > 0) {
    state.detail = `${detail}，存在 ${conflicts.length} 个冲突文件`
  }
  return state
}

function noOperationResult(): OperationResult {
  const message = '当前没有进行中的 Git 操作'
  return { ok: false, code: 1, stdout: '', stderr: message, output: message }
}

export async function continueOperation(repo: string): Promise<OperationResult> {
  const state = await operationState(repo)
  if (!state) return noOperationResult()
  switch (state.kind) {
    case 'merge':
      return runOperation(repo, ['merge', '--continue'])
    case 'rebase':
      return runOperation(repo, ['rebase', '--continue'])
    case 'cherry-pick':
      return runOperation(repo, ['cherry-pick', '--continue'])
    case 'revert':
      return runOperation(repo, ['revert', '--continue'])
    case 'am':
      return runOperation(repo, ['am', '--continue'])
    case 'bisect':
      return runOperation(repo, ['bisect', 'reset'])
    default:
      return noOperationResult()
  }
}

export async function abortOperation(repo: string): Promise<OperationResult> {
  const state = await operationState(repo)
  if (!state) return noOperationResult()
  switch (state.kind) {
    case 'merge':
      return runOperation(repo, ['merge', '--abort'])
    case 'rebase':
      return runOperation(repo, ['rebase', '--abort'])
    case 'cherry-pick':
      return runOperation(repo, ['cherry-pick', '--abort'])
    case 'revert':
      return runOperation(repo, ['revert', '--abort'])
    case 'am':
      return runOperation(repo, ['am', '--abort'])
    case 'bisect':
      return runOperation(repo, ['bisect', 'reset'])
    default:
      return noOperationResult()
  }
}

/* ---------------------------------------------------------------- history */

export async function checkoutCommit(repo: string, hash: string): Promise<void> {
  const safeHash = assertSafeRef(hash, '提交')
  await runGitOk(['checkout', '--detach', safeHash], { cwd: repo }, '无法检出该提交')
}

export async function reset(
  repo: string,
  hash: string,
  mode: 'soft' | 'mixed' | 'hard'
): Promise<void> {
  const safeHash = assertSafeRef(hash, '提交')
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw new Error(`不支持的 reset 模式：${mode}`)
  await runGitOk(['reset', `--${mode}`, safeHash], { cwd: repo }, '无法重置到该提交')
}

export async function cherryPick(repo: string, hash: string): Promise<OperationResult> {
  const safeHash = assertSafeRef(hash, '提交')
  return runOperation(repo, ['cherry-pick', safeHash])
}

export async function revert(repo: string, hash: string): Promise<OperationResult> {
  const safeHash = assertSafeRef(hash, '提交')
  return runOperation(repo, ['revert', '--no-edit', safeHash])
}

/** Stages one side of a conflicted file, or marks the working-tree version resolved. */
export async function resolveConflict(
  repo: string,
  file: string,
  strategy: 'ours' | 'theirs' | 'mark'
): Promise<void> {
  if (!file) throw new Error('文件路径不能为空')
  if (strategy === 'ours' || strategy === 'theirs') {
    const checkout = await runGit(['checkout', `--${strategy}`, '--', file], { cwd: repo })
    if (checkout.code !== 0) throw gitFailure(`无法采用${strategy === 'ours' ? '我方' : '对方'}版本`, checkout)
  }
  await runGitOk(['add', '--', file], { cwd: repo }, '无法标记冲突已解决')
}

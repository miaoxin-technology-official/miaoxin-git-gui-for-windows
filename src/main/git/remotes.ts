import type {
  FetchOptions,
  OperationResult,
  PullOptions,
  PushOptions,
  RemoteInfo
} from '@shared/types'
import { decodeLines } from './encoding'
import { assertSafeRef, NETWORK_TIMEOUT, runGit, runGitOk } from './exec'
import type { ProgressSink } from './exec'
import { toOperationResult, unmergedPaths } from './ops'

/**
 * Remote configuration and the three network operations.
 *
 * Network commands stream every output line to the caller's `ProgressSink` and
 * return an `OperationResult` even on failure (auth errors, no upstream, …) so
 * the console can show the original git output without crashing the app.
 */

function assertRemoteName(name: string): string {
  const safe = assertSafeRef(name, '远程名称')
  if (/[\s~^:?*[\\]/.test(safe)) throw new Error(`远程名称不合法：${safe}`)
  return safe
}

export async function readRemotes(repo: string): Promise<RemoteInfo[]> {
  const result = await runGitOk(['remote', '-v'], { cwd: repo }, '无法读取远程仓库')
  const map = new Map<string, RemoteInfo>()
  for (const decoded of decodeLines(result.stdoutBuffer)) {
    const line = decoded.text
    if (!line) continue
    const isFetch = line.endsWith(' (fetch)')
    const isPush = line.endsWith(' (push)')
    if (!isFetch && !isPush) continue
    const body = line.slice(0, line.length - (isFetch ? ' (fetch)'.length : ' (push)'.length))
    const tab = body.indexOf('\t')
    if (tab === -1) continue
    const name = body.slice(0, tab)
    const url = body.slice(tab + 1)
    let remote = map.get(name)
    if (!remote) {
      remote = { name, fetchUrl: '', pushUrl: '' }
      map.set(name, remote)
    }
    if (isFetch && !remote.fetchUrl) remote.fetchUrl = url
    if (isPush) remote.pushUrl = url
  }
  const remotes = [...map.values()]
  for (const remote of remotes) {
    if (!remote.pushUrl) remote.pushUrl = remote.fetchUrl
  }
  return remotes.sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

export async function addRemote(repo: string, name: string, url: string): Promise<void> {
  const safeName = assertRemoteName(name)
  const safeUrl = assertSafeRef(url, '远程地址')
  await runGitOk(['remote', 'add', safeName, safeUrl], { cwd: repo }, `无法添加远程 ${safeName}`)
}

export async function removeRemote(repo: string, name: string): Promise<void> {
  const safeName = assertRemoteName(name)
  await runGitOk(['remote', 'remove', safeName], { cwd: repo }, `无法删除远程 ${safeName}`)
}

export async function renameRemote(repo: string, oldName: string, newName: string): Promise<void> {
  const safeOld = assertRemoteName(oldName)
  const safeNew = assertRemoteName(newName)
  await runGitOk(['remote', 'rename', safeOld, safeNew], { cwd: repo }, `无法重命名远程 ${safeOld}`)
}

export async function setRemoteUrl(repo: string, name: string, url: string): Promise<void> {
  const safeName = assertRemoteName(name)
  const safeUrl = assertSafeRef(url, '远程地址')
  await runGitOk(['remote', 'set-url', safeName, safeUrl], { cwd: repo }, `无法修改远程 ${safeName} 的地址`)
}

export async function fetch(
  repo: string,
  options: FetchOptions = {},
  sink?: ProgressSink
): Promise<OperationResult> {
  const args = ['fetch', '--progress']
  if (options.all) args.push('--all')
  if (options.prune) args.push('--prune')
  if (options.tags) args.push('--tags')
  if (!options.all && options.remote) args.push(assertRemoteName(options.remote))
  const result = await runGit(args, { cwd: repo, sink, timeoutMs: NETWORK_TIMEOUT })
  return toOperationResult(result)
}

export async function pull(
  repo: string,
  options: PullOptions = {},
  sink?: ProgressSink
): Promise<OperationResult> {
  const args = ['pull', '--progress']
  if (options.rebase) args.push('--rebase')
  if (options.autostash) args.push('--autostash')
  if (options.remote) {
    args.push(assertRemoteName(options.remote))
    if (options.branch) args.push(assertSafeRef(options.branch, '分支名'))
  } else if (options.branch) {
    throw new Error('拉取指定分支时必须同时指定远程')
  }
  const result = await runGit(args, { cwd: repo, sink, timeoutMs: NETWORK_TIMEOUT })
  const conflicts = result.code === 0 ? [] : await unmergedPaths(repo)
  return toOperationResult(result, conflicts)
}

export async function push(
  repo: string,
  options: PushOptions = {},
  sink?: ProgressSink
): Promise<OperationResult> {
  const args = ['push', '--progress']
  if (options.dryRun) args.push('--dry-run')
  if (options.force === 'lease') args.push('--force-with-lease')
  else if (options.force === 'force') args.push('--force')
  if (options.tags) args.push('--tags')
  if (options.setUpstream) args.push('-u')

  const remote = options.remote ? assertRemoteName(options.remote) : options.setUpstream ? 'origin' : null
  const branch = options.branch ? assertSafeRef(options.branch, '分支名') : null
  if (remote) {
    args.push(remote)
    if (branch) args.push(branch)
    else if (options.setUpstream) args.push('HEAD')
  } else if (branch) {
    throw new Error('推送指定分支时必须同时指定远程')
  }

  const result = await runGit(args, { cwd: repo, sink, timeoutMs: NETWORK_TIMEOUT })
  return toOperationResult(result)
}

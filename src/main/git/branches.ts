// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BranchInfo } from '@shared/types'
import { decodeLines } from './encoding'
import { assertSafeRef, NETWORK_TIMEOUT, runGit, runGitOk } from './exec'
import { runOperation } from './ops'
import { readRemotes } from './remotes'

/**
 * Branch listing and mutation.
 *
 * `for-each-ref` is the only stable porcelain for branches: it gives the head
 * subject, author, upstream, ahead/behind and the current-branch marker in one
 * call. Records are newline separated (ref names cannot contain newlines) with
 * NUL separated fields.
 */

const BRANCH_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(objectname:short)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(HEAD)',
  '%(contents:subject)',
  '%(authorname)',
  '%(authordate:unix)',
  '%(symref)'
].join('%00')

interface RefRecord {
  refname: string
  shortName: string
  objectName: string
  shortObject: string
  upstream: string
  track: string
  headMark: string
  subject: string
  author: string
  authorTime: string
  symref: string
}

/** Parses one `for-each-ref` record line (fields are NUL separated). */
export function parseRefLine(line: string): RefRecord | null {
  if (!line) return null
  const fields = line.split('\0')
  if (fields.length < 11) return null
  return {
    refname: fields[0] ?? '',
    shortName: fields[1] ?? '',
    objectName: fields[2] ?? '',
    shortObject: fields[3] ?? '',
    upstream: fields[4] ?? '',
    track: fields[5] ?? '',
    headMark: fields[6] ?? '',
    subject: fields[7] ?? '',
    author: fields[8] ?? '',
    authorTime: fields[9] ?? '',
    symref: fields[10] ?? ''
  }
}

export function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0
  }
}

/** Local branches first (current branch on top), then remote-tracking branches. */
export function sortBranches(branches: BranchInfo[]): BranchInfo[] {
  return branches.sort((a, b) => {
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
    return a.name.localeCompare(b.name, 'en')
  })
}

export async function readBranches(repo: string): Promise<BranchInfo[]> {
  const result = await runGitOk(
    ['for-each-ref', 'refs/heads', 'refs/remotes', `--format=${BRANCH_FORMAT}`],
    { cwd: repo },
    '无法读取分支列表'
  )
  const branches: BranchInfo[] = []
  for (const decoded of decodeLines(result.stdoutBuffer)) {
    const record = parseRefLine(decoded.text)
    if (!record || !record.refname) continue
    if (record.symref) continue // refs/remotes/origin/HEAD -> refs/remotes/origin/main
    if (record.refname.endsWith('/HEAD')) continue

    const isRemote = record.refname.startsWith('refs/remotes/')
    if (!isRemote && !record.refname.startsWith('refs/heads/')) continue
    const { ahead, behind } = parseTrack(record.track)
    const info: BranchInfo = {
      name: record.shortName,
      fullName: record.refname,
      isRemote,
      isCurrent: record.headMark === '*',
      ahead,
      behind,
      head: record.objectName,
      subject: record.subject,
      author: record.author,
      time: Number(record.authorTime) || 0
    }
    if (isRemote) {
      const rest = record.refname.slice('refs/remotes/'.length)
      const slash = rest.indexOf('/')
      info.remote = slash === -1 ? rest : rest.slice(0, slash)
    } else if (record.upstream) {
      info.upstream = record.upstream
    }
    branches.push(info)
  }
  return sortBranches(branches)
}

/* --------------------------------------------------------------- mutations */

/** Branch/tag names cannot start with "-" (argv injection) or hold control chars. */
export function assertBranchName(name: string): string {
  const safe = assertSafeRef(name, '分支名')
  if (/[\s~^:?*[\\]/.test(safe) || safe.includes('..') || safe.includes('//') || safe.endsWith('/')) {
    throw new Error(`分支名不合法：${safe}`)
  }
  return safe
}

/** Finds the remote a `origin/foo`-style ref belongs to (longest match wins). */
async function matchRemote(repo: string, fullBranchName: string): Promise<{ remote: string; branch: string } | null> {
  const remotes = await readRemotes(repo)
  const candidates = remotes
    .map((remote) => remote.name)
    .filter((name) => fullBranchName.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)
  const remote = candidates[0]
  if (!remote) return null
  return { remote, branch: fullBranchName.slice(remote.length + 1) }
}

export async function createBranch(
  repo: string,
  name: string,
  startPoint?: string,
  checkout = false
): Promise<void> {
  const safeName = assertBranchName(name)
  const start = startPoint ? assertSafeRef(startPoint, '起点') : undefined
  const args = checkout ? ['checkout', '-b', safeName, ...(start ? [start] : [])] : ['branch', safeName, ...(start ? [start] : [])]
  await runGitOk(args, { cwd: repo }, `无法创建分支 ${safeName}`)
}

export async function checkoutBranch(repo: string, name: string): Promise<void> {
  const safeName = assertSafeRef(name, '分支名')
  // `git checkout <name>` also DWIMs remote-tracking branches into a local branch.
  await runGitOk(['checkout', safeName], { cwd: repo }, `无法切换到分支 ${safeName}`)
}

export async function renameBranch(repo: string, oldName: string, newName: string): Promise<void> {
  const from = assertBranchName(oldName)
  const to = assertBranchName(newName)
  await runGitOk(['branch', '-m', from, to], { cwd: repo }, `无法重命名分支 ${from}`)
}

export async function deleteBranch(repo: string, name: string, force = false): Promise<void> {
  const safeName = assertSafeRef(name, '分支名')
  const local = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${safeName}`], { cwd: repo })
  if (local.code === 0) {
    await runGitOk(
      ['branch', force ? '-D' : '-d', safeName],
      { cwd: repo },
      `无法删除分支 ${safeName}`
    )
    return
  }
  // Deleting a remote-tracking branch deletes it on the remote.
  const remoteRef = await matchRemote(repo, safeName)
  if (remoteRef) {
    await runGitOk(
      ['push', remoteRef.remote, '--delete', `refs/heads/${remoteRef.branch}`],
      { cwd: repo, timeoutMs: NETWORK_TIMEOUT },
      `无法删除远程分支 ${safeName}`
    )
    return
  }
  throw new Error(`没有找到分支：${safeName}`)
}

export async function setUpstream(
  repo: string,
  branch: string,
  upstream: string | null
): Promise<void> {
  const safeBranch = assertBranchName(branch)
  if (upstream === null) {
    await runGitOk(['branch', '--unset-upstream', safeBranch], { cwd: repo }, `无法取消 ${safeBranch} 的上游`)
    return
  }
  const safeUpstream = assertSafeRef(upstream, '上游分支')
  await runGitOk(
    ['branch', `--set-upstream-to=${safeUpstream}`, safeBranch],
    { cwd: repo },
    `无法设置 ${safeBranch} 的上游`
  )
}

/**
 * Merges `name` into the current branch. Conflicts are NOT exceptions: the
 * result carries `ok:false` plus the conflicted paths so the UI can show the
 * conflict state.
 */
export async function merge(
  repo: string,
  name: string,
  options: { noFastForward?: boolean; squash?: boolean; message?: string } = {}
) {
  const safeName = assertSafeRef(name, '分支名')
  const args = ['merge']
  if (options.noFastForward) args.push('--no-ff')
  if (options.squash) {
    args.push('--squash')
  } else if (options.message) {
    args.push('-m', options.message)
  } else {
    args.push('--no-edit')
  }
  args.push(safeName)
  return runOperation(repo, args)
}

export async function rebase(repo: string, onto: string) {
  const safeOnto = assertSafeRef(onto, '目标分支')
  return runOperation(repo, ['rebase', safeOnto], {
    env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }
  })
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Commit, FileChangeStat, FileStatus, LogQuery, LogResult, RefInfo } from '@shared/types'
import { decodeSmart, splitBuffer } from './encoding'
import { assertSafeRef, gitFailure, isEmptyRepoLogError, runGit, runGitOk } from './exec'

/**
 * Commit log parsing.
 *
 * We ask git for twelve NUL separated fields per commit and let `-z` terminate
 * each record with a NUL as well, so multi-line bodies, subjects containing
 * commas and ref decorations are all safe. `--decorate=full` makes `%D` return
 * fully qualified refs (`refs/heads/x`, `refs/remotes/origin/x`, `refs/tags/x`),
 * which removes the ambiguity between local branches containing "/" and remote
 * branches.
 */

const LOG_FORMAT =
  '%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%B%x00%D'

const DEFAULT_LIMIT = 200
const FIELD_COUNT = 12

function toNumber(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Parses a `%D` decoration list (with `--decorate=full`) into `RefInfo[]`. */
export function parseRefs(raw: string): RefInfo[] {
  const refs: RefInfo[] = []
  const seen = new Set<string>()
  const push = (ref: RefInfo): void => {
    const key = `${ref.type}:${ref.remote ?? ''}:${ref.name}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(ref)
  }

  for (const rawItem of raw.split(',')) {
    let item = rawItem.trim()
    if (!item) continue

    if (item.startsWith('HEAD -> ')) item = item.slice('HEAD -> '.length).trim()
    else if (item === 'HEAD') continue

    if (item.startsWith('tag: ')) {
      const name = item.slice('tag: '.length).trim().replace(/^refs\/tags\//, '')
      if (name) push({ type: 'tag', name })
      continue
    }
    if (item.startsWith('refs/tags/')) {
      const name = item.slice('refs/tags/'.length)
      if (name) push({ type: 'tag', name })
      continue
    }
    if (item.startsWith('refs/heads/')) {
      const name = item.slice('refs/heads/'.length)
      if (name) push({ type: 'branch', name })
      continue
    }
    if (item.startsWith('refs/remotes/')) {
      const rest = item.slice('refs/remotes/'.length)
      if (!rest || rest.endsWith('/HEAD')) continue
      const slash = rest.indexOf('/')
      const remote = slash === -1 ? rest : rest.slice(0, slash)
      push({ type: 'remote', name: rest, remote })
      continue
    }
    // Anything else (refs/stash, notes, unknown decorations) is not rendered.
    if (item.startsWith('refs/')) continue
    push({ type: 'branch', name: item })
  }
  return refs
}

/** Parses the NUL separated output produced by `LOG_FORMAT` + `-z`. */
export function parseLogOutput(output: string): Commit[] {
  const tokens = output.split('\0')
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
  const commits: Commit[] = []
  for (let index = 0; index + FIELD_COUNT - 1 < tokens.length; index += FIELD_COUNT) {
    const [hash, shortHash, parents, an, ae, at, cn, ce, ct, subject, body, refs] = tokens.slice(
      index,
      index + FIELD_COUNT
    )
    if (!hash) continue
    commits.push({
      hash,
      shortHash,
      parents: parents.split(' ').filter(Boolean),
      author: { name: an, email: ae, time: toNumber(at) },
      committer: { name: cn, email: ce, time: toNumber(ct) },
      subject,
      body: body.replace(/\r?\n+$/, ''),
      refs: parseRefs(refs)
    })
  }
  return commits
}

function buildLogArgs(query: LogQuery): { args: string[]; limit: number } {
  const limit = Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT))
  const args = [
    'log',
    '--decorate=full',
    '--encoding=UTF-8',
    '--date-order',
    `--max-count=${limit + 1}`,
    '-z',
    `--format=${LOG_FORMAT}`
  ]
  if (query.skip && query.skip > 0) args.push(`--skip=${Math.floor(query.skip)}`)
  if (query.firstParent) args.push('--first-parent')
  if (query.all) args.push('--all')
  if (query.search && query.search.trim()) {
    args.push('-i', '--fixed-strings', `--grep=${query.search.trim()}`)
  }
  if (query.author && query.author.trim()) args.push(`--author=${query.author.trim()}`)
  if (query.since && query.since.trim()) args.push(`--since=${query.since.trim()}`)
  if (query.branch) args.push(assertSafeRef(query.branch, '分支'))
  args.push('--')
  if (query.path) args.push(query.path)
  return { args, limit }
}

export async function readLog(repo: string, query: LogQuery = {}): Promise<LogResult> {
  const { args, limit } = buildLogArgs(query)
  const result = await runGit(args, { cwd: repo })
  if (result.code !== 0) {
    if (isEmptyRepoLogError(result.stderr)) return { commits: [], hasMore: false }
    throw gitFailure('无法读取提交历史', result)
  }
  const all = parseLogOutput(result.stdout)
  const hasMore = all.length > limit
  return {
    commits: hasMore ? all.slice(0, limit) : all,
    hasMore
  }
}

/** Reads the metadata for one commit (used by `commitDetail`). */
export async function readCommit(repo: string, hash: string): Promise<Commit> {
  const safeHash = assertSafeRef(hash, '提交')
  const result = await runGitOk(
    ['log', '-1', '--decorate=full', '--encoding=UTF-8', '-z', `--format=${LOG_FORMAT}`, safeHash, '--'],
    { cwd: repo },
    '无法读取提交信息'
  )
  const commits = parseLogOutput(result.stdout)
  if (commits.length === 0) throw new Error(`未找到提交：${safeHash}`)
  return commits[0]
}

/* ------------------------------------------------------------ commit detail */

interface RawNameStatus {
  status: FileStatus
  path: string
  oldPath?: string
}

function mapStatusLetter(letter: string): FileStatus {
  switch (letter) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

/** Splits NUL separated git output and decodes every token independently. */
function decodeNulTokens(output: string | Buffer): string[] {
  if (typeof output === 'string') return output.split('\0')
  return splitBuffer(output, 0).map((part) => decodeSmart(part).text)
}

/**
 * `--name-status -z` tokens: `<status>\0<path>\0` and for renames
 * `<R100>\0<old>\0<new>\0`.
 */
function parseNameStatusZ(output: string | Buffer): RawNameStatus[] {
  const tokens = decodeNulTokens(output)
  const entries: RawNameStatus[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const letter = token[0] ?? 'M'
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[index + 1]
      const newPath = tokens[index + 2]
      index += 2
      if (!newPath) continue
      entries.push({ status: mapStatusLetter(letter), path: newPath, oldPath })
      continue
    }
    const path = tokens[index + 1]
    index += 1
    if (!path) continue
    entries.push({ status: mapStatusLetter(letter), path })
  }
  return entries
}

interface NumstatEntry {
  additions: number
  deletions: number
  binary: boolean
  oldPath?: string
}

function parseCommitNumstatZ(output: string | Buffer): Map<string, NumstatEntry> {
  const map = new Map<string, NumstatEntry>()
  const tokens = decodeNulTokens(output)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(token)
    if (!match) continue
    let path = match[3]
    let oldPath: string | undefined
    if (path === '') {
      oldPath = tokens[index + 1]
      path = tokens[index + 2] ?? ''
      index += 2
    }
    if (!path) continue
    const binary = match[1] === '-' || match[2] === '-'
    map.set(path, {
      additions: binary ? 0 : toNumber(match[1]),
      deletions: binary ? 0 : toNumber(match[2]),
      binary,
      oldPath
    })
  }
  return map
}

/** Resolves the parent commit used to diff a commit (first parent; none = root). */
export async function firstParent(repo: string, hash: string): Promise<string | null> {
  const result = await runGitOk(
    ['rev-list', '--parents', '-n', '1', '--no-walk', assertSafeRef(hash, '提交')],
    { cwd: repo },
    '无法解析提交的父提交'
  )
  const tokens = result.stdout.trim().split(/\s+/).filter(Boolean)
  return tokens.length > 1 ? tokens[1] : null
}

export async function readCommitDetail(repo: string, hash: string) {
  const safeHash = assertSafeRef(hash, '提交')
  const parent = await firstParent(repo, safeHash)

  // For root commits there is no parent; `git show --format=` prints a full
  // "everything added" patch. For merge commits we diff against the first
  // parent, which is what desktop Git clients show by default.
  const diffBase = parent
    ? ['diff', '--numstat', '-M', '-z', parent, safeHash]
    : ['show', '--format=', '--numstat', '-M', '-z', safeHash]
  const statusBase = parent
    ? ['diff', '--name-status', '-M', '-z', parent, safeHash]
    : ['show', '--format=', '--name-status', '-M', '-z', safeHash]

  const [commit, numstatResult, nameStatusResult] = await Promise.all([
    readCommit(repo, safeHash),
    runGitOk(diffBase, { cwd: repo }, '无法读取提交文件统计'),
    runGitOk(statusBase, { cwd: repo }, '无法读取提交文件列表')
  ])

  const stats = parseCommitNumstatZ(numstatResult.stdoutBuffer)
  const nameStatus = parseNameStatusZ(nameStatusResult.stdoutBuffer)
  const files: FileChangeStat[] = []
  let additions = 0
  let deletions = 0

  for (const entry of nameStatus) {
    const numstat = stats.get(entry.path)
    const file: FileChangeStat = {
      path: entry.path,
      status: entry.status,
      additions: numstat?.additions ?? 0,
      deletions: numstat?.deletions ?? 0,
      binary: numstat?.binary ?? false
    }
    if (entry.oldPath) file.oldPath = entry.oldPath
    additions += file.additions
    deletions += file.deletions
    files.push(file)
  }

  return {
    ...commit,
    files,
    stats: { files: files.length, additions, deletions }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BranchInfo, ChangeSide, FileChange, FileStatus, StatusSnapshot } from '@shared/types'
import { decodeSmart, splitBuffer } from './encoding'
import { runGit, runGitOk } from './exec'

/**
 * `git status --porcelain=v2 -z --branch --untracked-files=all` parser.
 *
 * Records handled:
 *   `1` changed, `2` renamed/copied, `u` unmerged, `?` untracked,
 *   `# branch.*` header (oid/head/upstream/ab).
 *
 * Paths are NUL terminated, so spaces, Chinese characters and even newlines in
 * file names are safe. Rename records carry the original path as an extra NUL
 * token after the record.
 */

export interface BranchHeadState {
  branch: string | null
  detached: boolean
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export interface StatusRead {
  snapshot: StatusSnapshot
  head: BranchHeadState
}

interface Numstat {
  additions: number
  deletions: number
  binary: boolean
}

const EMPTY_HEAD: BranchHeadState = {
  branch: null,
  detached: false,
  head: null,
  upstream: null,
  ahead: 0,
  behind: 0
}

function parseNumber(text: string | undefined): number {
  const value = Number(text)
  return Number.isFinite(value) ? value : 0
}

/** Maps a single porcelain status letter to the shared `FileStatus`. */
function letterStatus(letter: string, modeChange: boolean): FileStatus {
  if (modeChange) return 'modechange'
  switch (letter) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
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

function makeChange(path: string, status: FileStatus, side: ChangeSide, tracked: boolean, oldPath?: string): FileChange {
  const change: FileChange = { path, status, side, tracked }
  if (oldPath) change.oldPath = oldPath
  return change
}

interface ParsedChange {
  staged?: FileChange
  unstaged?: FileChange
  untracked?: FileChange
  conflicted?: FileChange
}

/**
 * Parses tokens of one `2`/`1` record. Index and worktree sides are split so a
 * file that is both staged and modified again shows up in both buckets.
 */
function parseChangedRecord(
  fields: string[],
  path: string,
  oldPath: string | undefined
): ParsedChange {
  // fields: [type, XY, sub, mH, mI, mW, hH, hI, (score)]
  const xy = fields[1] ?? '..'
  const sub = fields[2] ?? 'N...'
  const mH = fields[3] ?? ''
  const mI = fields[4] ?? ''
  const mW = fields[5] ?? ''
  const hH = fields[6] ?? ''
  const hI = fields[7] ?? ''
  const x = xy[0] ?? '.'
  const y = xy[1] ?? '.'
  const parsed: ParsedChange = {}

  if (x !== '.' && x !== '?') {
    if (x === 'U' || sub.includes('U')) {
      parsed.conflicted = makeChange(path, 'conflicted', 'conflicted', true, oldPath)
    } else if (x === 'T') {
      parsed.staged = makeChange(path, 'typechange', 'staged', true, oldPath)
    } else if (x === 'R') {
      parsed.staged = makeChange(path, 'renamed', 'staged', true, oldPath)
    } else if (x === 'C') {
      parsed.staged = makeChange(path, 'copied', 'staged', true, oldPath)
    } else {
      const modeChange = x === 'M' && mH !== mI && hH === hI
      parsed.staged = makeChange(path, letterStatus(x, modeChange), 'staged', true, oldPath)
    }
  }

  if (y !== '.' && y !== '?') {
    if (y === 'U' || sub.includes('U')) {
      parsed.conflicted = makeChange(path, 'conflicted', 'conflicted', true, oldPath)
    } else if (y === 'T') {
      parsed.unstaged = makeChange(path, 'typechange', 'unstaged', true, oldPath)
    } else if (y === 'R') {
      parsed.unstaged = makeChange(path, 'renamed', 'unstaged', true, oldPath)
    } else if (y === 'C') {
      parsed.unstaged = makeChange(path, 'copied', 'unstaged', true, oldPath)
    } else {
      const modeChange = y === 'M' && mI !== mW
      parsed.unstaged = makeChange(path, letterStatus(y, modeChange), 'unstaged', true, oldPath)
    }
  }

  // Submodule pointer changes where the path itself is still tracked.
  if (!parsed.staged && !parsed.unstaged && !parsed.conflicted && sub.includes('U')) {
    parsed.unstaged = makeChange(path, 'modified', 'unstaged', true, oldPath)
  }

  return parsed
}

/**
 * `--numstat -z` parser. For rename/copy records the path field is empty and
 * the old/new paths follow as two separate NUL tokens. Path tokens are decoded
 * individually so GBK file names survive next to ASCII statistics.
 */
export function parseNumstatZ(output: string | Buffer): Map<string, Numstat> {
  const map = new Map<string, Numstat>()
  const tokens = splitNul(output)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(token)
    if (!match) continue
    let path = match[3]
    if (path === '') {
      // rename/copy: old path then new path
      index += 1
      path = tokens[index + 1] ?? ''
      index += 1
    }
    if (!path) continue
    const binary = match[1] === '-' || match[2] === '-'
    map.set(path, {
      additions: binary ? 0 : parseNumber(match[1]),
      deletions: binary ? 0 : parseNumber(match[2]),
      binary
    })
  }
  return map
}

/** Splits NUL separated git output and decodes every token independently. */
function splitNul(input: string | Buffer): string[] {
  if (typeof input === 'string') return input.split('\0')
  return splitBuffer(input, 0).map((part) => decodeSmart(part).text)
}

function applyStats(change: FileChange, stats: Map<string, Numstat>): void {
  const hit = stats.get(change.path) ?? (change.oldPath ? stats.get(change.oldPath) : undefined)
  if (!hit) return
  change.additions = hit.additions
  change.deletions = hit.deletions
  if (hit.binary) change.binary = true
}

async function attachNumstat(repo: string, staged: FileChange[], unstaged: FileChange[]): Promise<number[]> {
  let additions = 0
  let deletions = 0
  if (staged.length > 0) {
    const result = await runGit(['diff', '--cached', '--numstat', '-M', '-z', '--'], { cwd: repo })
    if (result.code === 0) {
      const stats = parseNumstatZ(result.stdoutBuffer)
      for (const change of staged) applyStats(change, stats)
      for (const item of stats.values()) {
        if (!item.binary) {
          additions += item.additions
          deletions += item.deletions
        }
      }
    }
  }
  if (unstaged.length > 0) {
    const result = await runGit(['diff', '--numstat', '-M', '-z', '--'], { cwd: repo })
    if (result.code === 0) {
      const stats = parseNumstatZ(result.stdoutBuffer)
      for (const change of unstaged) applyStats(change, stats)
      for (const item of stats.values()) {
        if (!item.binary) {
          additions += item.additions
          deletions += item.deletions
        }
      }
    }
  }
  return [additions, deletions]
}

/**
 * Pure parser for `git status --porcelain=v2 -z --branch --untracked-files=all`
 * output. Exposed separately so the NUL-token logic can be tested without a
 * repository (the smoke script feeds synthetic records, including file names
 * that cannot exist on Windows, like names containing newlines).
 */
export function parseStatusOutput(output: string | Buffer): StatusRead {
  const tokens = splitNul(output)
  const head: BranchHeadState = { ...EMPTY_HEAD }
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: FileChange[] = []
  const conflicted: FileChange[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue

    if (token.startsWith('# branch.oid ')) {
      const oid = token.slice('# branch.oid '.length).trim()
      head.head = oid === '(initial)' ? null : oid
      continue
    }
    if (token.startsWith('# branch.head ')) {
      const name = token.slice('# branch.head '.length).trim()
      if (name === '(detached)') {
        head.detached = true
        head.branch = null
      } else {
        head.branch = name
      }
      continue
    }
    if (token.startsWith('# branch.upstream ')) {
      head.upstream = token.slice('# branch.upstream '.length).trim() || null
      continue
    }
    if (token.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(token)
      if (match) {
        head.ahead = parseNumber(match[1])
        head.behind = parseNumber(match[2])
      }
      continue
    }
    if (token.startsWith('#')) continue

    if (token.startsWith('? ')) {
      untracked.push(makeChange(token.slice(2), 'untracked', 'untracked', false))
      continue
    }
    if (token.startsWith('! ')) continue

    if (token.startsWith('1 ') || token.startsWith('2 ')) {
      const isRename = token.startsWith('2 ')
      const fields = token.split(' ')
      const pathStart = isRename ? 9 : 8
      const path = fields.slice(pathStart).join(' ')
      let oldPath: string | undefined
      if (isRename) {
        const extra = tokens[index + 1]
        if (extra !== undefined) {
          oldPath = extra
          index += 1
        }
      }
      const parsed = parseChangedRecord(fields, path, oldPath)
      if (parsed.staged) staged.push(parsed.staged)
      if (parsed.unstaged) unstaged.push(parsed.unstaged)
      if (parsed.conflicted) conflicted.push(parsed.conflicted)
      continue
    }

    if (token.startsWith('u ')) {
      const fields = token.split(' ')
      const path = fields.slice(10).join(' ')
      conflicted.push(makeChange(path, 'conflicted', 'conflicted', true))
      continue
    }
  }

  // Flat, de-duplicated list: conflict wins, then staged, then unstaged, then
  // untracked. The four buckets above stay authoritative for the UI sections.
  const merged = new Map<string, FileChange>()
  for (const change of [...conflicted, ...staged, ...unstaged, ...untracked]) {
    if (!merged.has(change.path)) merged.set(change.path, change)
  }
  const files = [...merged.values()]

  return {
    snapshot: {
      files,
      staged,
      unstaged,
      untracked,
      conflicted,
      additions: 0,
      deletions: 0,
      clean: files.length === 0
    },
    head
  }
}

/**
 * Reads repository status (branch head info included) and attaches per-file
 * line stats from `--numstat`.
 */
export async function readStatus(repo: string): Promise<StatusRead> {
  const result = await runGitOk(
    ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'],
    { cwd: repo },
    '无法读取工作区状态'
  )
  const parsed = parseStatusOutput(result.stdoutBuffer)
  const [additions, deletions] = await attachNumstat(repo, parsed.snapshot.staged, parsed.snapshot.unstaged)
  parsed.snapshot.additions = additions
  parsed.snapshot.deletions = deletions
  return parsed
}

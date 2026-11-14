// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OperationResult, StashEntry } from '@shared/types'
import { decodeLines } from './encoding'
import { runGit } from './exec'
import { runOperation, toOperationResult } from './ops'

/**
 * `git stash` support.
 *
 * `stash list` output is one subject line per entry, so records are newline
 * separated and fields NUL separated. Pop/apply conflicts are returned (not
 * thrown) because the working tree keeps the conflict markers.
 */

const STASH_FORMAT = '%gd%x00%H%x00%gs%x00%ct%x00%an'

export function parseStashList(output: string | Buffer): StashEntry[] {
  const entries: StashEntry[] = []
  const lines = typeof output === 'string' ? output.split('\n') : decodeLines(output).map((line) => line.text)
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) continue
    const fields = line.split('\0')
    const ref = fields[0] ?? ''
    const subject = fields[2] ?? ''
    const time = Number(fields[3] ?? '0') || 0
    const match = /stash@\{(\d+)\}/.exec(ref)
    if (!match) continue
    const index = Number(match[1])
    const branchMatch = /^(?:WIP on|On) ([^:]+):\s*(.*)$/.exec(subject)
    const branch = branchMatch ? branchMatch[1].trim() : ''
    const rest = branchMatch ? branchMatch[2] : subject
    entries.push({
      index,
      ref,
      name: rest || subject || `stash@{${index}}`,
      branch,
      message: subject,
      time
    })
  }
  return entries
}

export async function stashList(repo: string): Promise<StashEntry[]> {
  const result = await runGit(['stash', 'list', `--format=${STASH_FORMAT}`], { cwd: repo })
  if (result.code !== 0) return []
  return parseStashList(result.stdoutBuffer)
}

function stashRef(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`stash 索引不合法：${index}`)
  return `stash@{${index}}`
}

export async function stashSave(
  repo: string,
  message: string,
  includeUntracked = false
): Promise<OperationResult> {
  const args = ['stash', 'push']
  if (message && message.trim()) args.push('-m', message)
  if (includeUntracked) args.push('--include-untracked')
  const result = await runGit(args, { cwd: repo })
  return toOperationResult(result)
}

export async function stashPop(repo: string, index: number): Promise<OperationResult> {
  return runOperation(repo, ['stash', 'pop', stashRef(index)])
}

export async function stashApply(repo: string, index: number): Promise<OperationResult> {
  return runOperation(repo, ['stash', 'apply', stashRef(index)])
}

export async function stashDrop(repo: string, index: number): Promise<OperationResult> {
  const result = await runGit(['stash', 'drop', stashRef(index)], { cwd: repo })
  return toOperationResult(result)
}

/** Number of stash entries (used by `summary`). */
export async function stashCount(repo: string): Promise<number> {
  const result = await runGit(['stash', 'list'], { cwd: repo })
  if (result.code !== 0) return 0
  return decodeLines(result.stdoutBuffer).filter((line) => line.text.trim().length > 0).length
}

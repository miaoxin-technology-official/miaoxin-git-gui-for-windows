// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChangeSide, FileChange, StatusSnapshot } from '@shared/types'

/** One selectable row of the Changes list. A file can appear twice (staged + unstaged). */
export interface ChangeEntry {
  /** stable selection key: `${side}:${path}` */
  key: string
  side: ChangeSide
  file: FileChange
}

export interface ChangeGroup {
  key: ChangeSide
  title: string
  entries: ChangeEntry[]
  additions: number
  deletions: number
}

export const GROUP_ORDER: ChangeSide[] = ['conflicted', 'staged', 'unstaged', 'untracked']

const GROUP_TITLE: Record<ChangeSide, string> = {
  conflicted: '冲突',
  staged: '已暂存',
  unstaged: '未暂存',
  untracked: '未跟踪'
}

/** The diff source used for a list row. Conflicted/untracked rows diff the worktree. */
export function diffSideFor(side: ChangeSide): 'staged' | 'unstaged' {
  return side === 'staged' ? 'staged' : 'unstaged'
}

export function isStageable(side: ChangeSide): boolean {
  return side === 'unstaged' || side === 'untracked'
}

function dedupe(files: FileChange[] | undefined): FileChange[] {
  if (!files || files.length === 0) return []
  const seen = new Map<string, FileChange>()
  for (const file of files) {
    if (!seen.has(file.path)) seen.set(file.path, file)
  }
  return [...seen.values()]
}

export function buildGroups(status: StatusSnapshot | null): ChangeGroup[] {
  if (!status) return []
  const bySide: Record<ChangeSide, FileChange[]> = {
    conflicted: dedupe(status.conflicted),
    staged: dedupe(status.staged),
    unstaged: dedupe(status.unstaged),
    untracked: dedupe(status.untracked)
  }
  const groups: ChangeGroup[] = []
  for (const side of GROUP_ORDER) {
    const files = bySide[side]
    if (files.length === 0) continue
    let additions = 0
    let deletions = 0
    const entries: ChangeEntry[] = files.map((file) => {
      additions += file.additions ?? 0
      deletions += file.deletions ?? 0
      return { key: `${side}:${file.path}`, side, file }
    })
    groups.push({ key: side, title: GROUP_TITLE[side], entries, additions, deletions })
  }
  return groups
}

export function countStageable(groups: ChangeGroup[]): { stageable: number; unstaged: number; untracked: number } {
  let unstaged = 0
  let untracked = 0
  for (const group of groups) {
    if (group.key === 'unstaged') unstaged += group.entries.length
    if (group.key === 'untracked') untracked += group.entries.length
  }
  return { stageable: unstaged + untracked, unstaged, untracked }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FileStatus } from '@shared/types'

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

export function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (delta < 45) return '刚刚'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`
  if (delta < DAY * 2) return '昨天'
  if (delta < DAY * 30) return `${Math.floor(delta / DAY)} 天前`
  if (delta < DAY * 365) return `${Math.floor(delta / (DAY * 30))} 个月前`
  return `${Math.floor(delta / (DAY * 365))} 年前`
}

export function absoluteTime(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function hash7(hash: string | null | undefined): string {
  return (hash ?? '').slice(0, 7)
}

export function fileName(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

export function dirName(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? '' : filePath.slice(0, idx)
}

export function statusLetter(status: FileStatus): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return 'U'
    case 'conflicted':
      return '!'
    case 'typechange':
      return 'T'
    case 'modechange':
      return 'M'
    default:
      return '·'
  }
}

export function statusLabel(status: FileStatus): string {
  switch (status) {
    case 'added':
      return '新增'
    case 'modified':
      return '修改'
    case 'deleted':
      return '删除'
    case 'renamed':
      return '重命名'
    case 'copied':
      return '复制'
    case 'untracked':
      return '未跟踪'
    case 'conflicted':
      return '冲突'
    case 'typechange':
      return '类型变更'
    case 'modechange':
      return '权限变更'
    default:
      return ''
  }
}

export function statusTone(status: FileStatus): 'add' | 'mod' | 'del' | 'rename' | 'conflict' | 'neutral' {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'add'
    case 'deleted':
      return 'del'
    case 'renamed':
    case 'copied':
      return 'rename'
    case 'conflicted':
      return 'conflict'
    case 'modified':
    case 'typechange':
    case 'modechange':
      return 'mod'
    default:
      return 'neutral'
  }
}

export function authorInitial(name: string): string {
  const trimmed = (name || '?').trim()
  return trimmed.slice(0, 1).toUpperCase()
}

export function formatDelta(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`
}

export function shortenPath(filePath: string, max = 52): string {
  if (filePath.length <= max) return filePath
  const parts = filePath.split('/')
  if (parts.length <= 2) return `…${filePath.slice(-max + 1)}`
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`
}

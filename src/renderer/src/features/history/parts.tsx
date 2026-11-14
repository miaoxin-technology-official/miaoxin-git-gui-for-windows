// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RefInfo } from '@shared/types'
import { authorInitial } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/store/app'

/** Copy helper used across the repository panels (clipboard is renderer-only). */
export async function copyText(text: string, message = '已复制'): Promise<void> {
  const { pushToast } = useAppStore.getState()
  const copied = await writeClipboard(text)
  if (copied) pushToast(message, 'success')
  else pushToast('复制失败，请手动选择文本', 'error')
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

function refRank(ref: RefInfo, currentBranch: string | null): number {
  if (ref.type === 'branch') return ref.name === currentBranch ? 0 : 1
  if (ref.type === 'remote') return 2
  return 3
}

function refTone(ref: RefInfo, currentBranch: string | null): string {
  if (ref.type === 'branch') return ref.name === currentBranch ? 'is-current' : 'is-local'
  if (ref.type === 'remote') return 'is-remote'
  return 'is-tag'
}

export function RefBadges({
  refs,
  currentBranch,
  max = 3
}: {
  refs: RefInfo[]
  currentBranch: string | null
  max?: number
}): React.JSX.Element | null {
  if (!refs.length) return null
  const ordered = [...refs].sort((a, b) => refRank(a, currentBranch) - refRank(b, currentBranch))
  const shown = ordered.slice(0, max)
  const rest = ordered.length - shown.length

  return (
    <span className="hist-refs">
      {shown.map((ref) => {
        const kind = ref.type === 'remote' ? '远程分支' : ref.type === 'tag' ? '标签' : '分支'
        return (
          <span
            key={`${ref.type}:${ref.name}`}
            className={cn('ref-badge', refTone(ref, currentBranch))}
            title={`${kind}：${ref.name}`}
          >
            {ref.name}
          </span>
        )
      })}
      {rest > 0 ? (
        <span className="ref-more" title={ordered.slice(max).map((ref) => ref.name).join(', ')}>
          +{rest}
        </span>
      ) : null}
    </span>
  )
}

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return `var(--graph-${(hash % 8) + 1})`
}

export function CommitAvatar({ name, size = 24 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <span
      className="hist-avatar"
      style={{ width: size, height: size, fontSize: size <= 20 ? 10 : 10.5, color: avatarColor(name) }}
      title={name}
    >
      {authorInitial(name)}
    </span>
  )
}

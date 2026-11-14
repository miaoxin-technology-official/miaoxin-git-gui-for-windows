import type { MouseEvent } from 'react'
import type { ChangeSide } from '@shared/types'
import { Check, Copy, EyeOff, FolderOpen, Minus, MoreHorizontal, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { dirName, fileName, statusLetter, statusTone } from '@/lib/format'
import { IconButton } from '@/components/ui/Button'
import { Menu, type MenuItem } from '@/components/ui/Overlay'
import type { ChangeEntry } from './model'

export interface FileRowActions {
  onSelect: (entry: ChangeEntry, event: MouseEvent<HTMLDivElement>) => void
  onToggleStage: (entry: ChangeEntry) => void
  onDiscard: (entry: ChangeEntry) => void
  onReveal: (entry: ChangeEntry) => void
  onCopyPath: (entry: ChangeEntry) => void
  onIgnore: (entry: ChangeEntry) => void
  onResolve: (entry: ChangeEntry, strategy: 'ours' | 'theirs' | 'mark') => void
}

interface FileRowProps extends FileRowActions {
  entry: ChangeEntry
  active: boolean
  selected: boolean
  disabled?: boolean
}

function discardLabel(side: ChangeSide): string {
  if (side === 'untracked') return '删除未跟踪文件'
  if (side === 'staged') return '取消暂存此文件'
  return '丢弃改动'
}

function stageLabel(side: ChangeSide): string {
  return side === 'staged' ? '取消暂存' : '暂存改动'
}

export function FileRow({
  entry,
  active,
  selected,
  disabled,
  onSelect,
  onToggleStage,
  onDiscard,
  onReveal,
  onCopyPath,
  onIgnore,
  onResolve
}: FileRowProps): React.JSX.Element {
  const { file, side } = entry
  const tone = statusTone(file.status)
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  const conflicted = side === 'conflicted'
  const title = file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path

  const menuItems: MenuItem[] = [
    { id: 'reveal', label: '在资源管理器中显示', icon: FolderOpen },
    { id: 'copy', label: '复制路径', icon: Copy },
    { id: 'ignore', label: '忽略此文件', icon: EyeOff, disabled: conflicted },
    { id: 'sep', separator: true },
    {
      id: 'discard',
      label: discardLabel(side),
      icon: Trash2,
      danger: true,
      disabled: conflicted
    }
  ]

  const handleMenu = (id: string): void => {
    if (id === 'reveal') onReveal(entry)
    else if (id === 'copy') onCopyPath(entry)
    else if (id === 'ignore') onIgnore(entry)
    else if (id === 'discard') onDiscard(entry)
  }

  return (
    <div
      className={cn('list-row changes-row', active && 'is-active', selected && 'is-selected')}
      role="option"
      aria-selected={selected}
      title={title}
      onClick={(event) => {
        if (!disabled) onSelect(entry, event)
      }}
    >
      <span className={cn('status-letter', `is-${tone}`)} aria-hidden>
        {statusLetter(file.status)}
      </span>
      <span className="changes-row-main">
        <span className="changes-row-name mono truncate">{fileName(file.path)}</span>
        {dirName(file.path) ? <span className="changes-row-dir mono truncate">{dirName(file.path)}</span> : null}
      </span>
      <span className="changes-row-stat num">
        {additions > 0 ? <span className="stat-add">+{additions}</span> : null}
        {deletions > 0 ? <span className="stat-del">−{deletions}</span> : null}
      </span>
      <span className="row-actions changes-row-actions" onClick={(event) => event.stopPropagation()}>
        {conflicted ? (
          <>
            <button
              type="button"
              className="changes-mini-btn"
              title="使用我的版本（ours）"
              onClick={() => onResolve(entry, 'ours')}
            >
              我的
            </button>
            <button
              type="button"
              className="changes-mini-btn"
              title="使用对方版本（theirs）"
              onClick={() => onResolve(entry, 'theirs')}
            >
              对方
            </button>
            <IconButton
              icon={Check}
              label="标记为已解决"
              size={22}
              onClick={() => onResolve(entry, 'mark')}
            />
            <IconButton
              icon={FolderOpen}
              label="在资源管理器中打开"
              size={22}
              onClick={() => onReveal(entry)}
            />
          </>
        ) : (
          <>
            <IconButton
              icon={side === 'staged' ? Minus : Plus}
              label={stageLabel(side)}
              size={22}
              onClick={() => onToggleStage(entry)}
            />
            <IconButton
              icon={RotateCcw}
              label={discardLabel(side)}
              size={22}
              variant="danger"
              onClick={() => onDiscard(entry)}
            />
          </>
        )}
        <Menu
          items={menuItems}
          onSelect={handleMenu}
          align="end"
          width={210}
          trigger={
            <button type="button" className="changes-row-more" aria-label="更多操作" title="更多操作">
              <MoreHorizontal size={14} strokeWidth={1.7} />
            </button>
          }
        />
      </span>
    </div>
  )
}

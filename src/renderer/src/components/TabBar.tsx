// SPDX-License-Identifier: AGPL-3.0-or-later
import { Archive, FileDiff, GitBranch, Globe2, History, RefreshCw, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAppStore, type Section } from '@/store/app'
import { IconButton } from './ui/Button'

interface Tab {
  id: Section
  label: string
  icon: LucideIcon
}

const TABS: Tab[] = [
  { id: 'changes', label: '改动', icon: FileDiff },
  { id: 'history', label: '历史', icon: History },
  { id: 'branches', label: '分支', icon: GitBranch },
  { id: 'stash', label: '暂存', icon: Archive },
  { id: 'tags', label: '标签', icon: Tag },
  { id: 'remotes', label: '远程', icon: Globe2 }
]

export function TabBar(): React.JSX.Element {
  const section = useAppStore((s) => s.section)
  const setSection = useAppStore((s) => s.setSection)
  const status = useAppStore((s) => s.status)
  const repo = useAppStore((s) => s.repo)
  const refresh = useAppStore((s) => s.refresh)
  const refreshing = useAppStore((s) => s.refreshing)

  const counts: Partial<Record<Section, number>> = {
    changes: status?.files.length ?? 0,
    stash: repo?.stashCount ?? 0
  }

  return (
    <div className="arb-tabbar">
      <nav className="arb-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={section === tab.id}
            className={cn('arb-tab', section === tab.id && 'is-active')}
            onClick={() => setSection(tab.id)}
          >
            <span className="arb-tab-label">{tab.label}</span>
            {counts[tab.id] ? <span className="arb-tab-count">{counts[tab.id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="arb-tabbar-right">
        <IconButton
          icon={RefreshCw}
          label="刷新 (Ctrl+R)"
          size={22}
          className={refreshing ? 'is-spinning' : undefined}
          onClick={() => void refresh()}
        />
      </div>
    </div>
  )
}

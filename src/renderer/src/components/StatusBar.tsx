// SPDX-License-Identifier: AGPL-3.0-or-later
import { ArrowDown, ArrowUp, GitBranch, Moon, Sun } from 'lucide-react'
import { relativeTime } from '@/lib/format'
import { useAppStore } from '@/store/app'
import { IconButton } from './ui/Button'

function operationLabel(kind: string): string {
  switch (kind) {
    case 'merge':
      return '合并中'
    case 'rebase':
      return '变基中'
    case 'cherry-pick':
      return '拣选中'
    case 'revert':
      return '还原中'
    case 'am':
      return '应用补丁中'
    case 'bisect':
      return '二分查找中'
    default:
      return kind
  }
}

export function StatusBar(): React.JSX.Element | null {
  const repo = useAppStore((s) => s.repo)
  const appInfo = useAppStore((s) => s.appInfo)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const lastRefresh = useAppStore((s) => s.lastRefresh)

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <footer className="arb-statusbar">
      <div className="arb-sb-left">
        {repo ? (
          <>
            <span className="arb-sb-item">
              <GitBranch size={11} strokeWidth={1.9} />
              <span className="mono" style={{ fontSize: 10.5 }}>{repo.branch ?? 'detached HEAD'}</span>
            </span>
            <span className="arb-sb-item arb-sb-track">
              <span className="stat-add">
                <ArrowUp size={9} strokeWidth={2.2} />
                {repo.ahead}
              </span>
              <span className="stat-del">
                <ArrowDown size={9} strokeWidth={2.2} />
                {repo.behind}
              </span>
            </span>
            {repo.operation ? (
              <span className="arb-sb-item arb-sb-op">
                {operationLabel(repo.operation.kind)}
                {repo.operation.conflicts.length > 0 ? ` · ${repo.operation.conflicts.length} 冲突` : ''}
              </span>
            ) : null}
            {repo.status.clean ? <span className="arb-sb-item subtle">工作区干净</span> : null}
          </>
        ) : (
          <span className="arb-sb-item subtle">未打开仓库</span>
        )}
      </div>
      <div className="arb-sb-right">
        {repo ? (
          <span className="arb-sb-item arb-sb-path truncate" title={repo.path}>
            {repo.path}
          </span>
        ) : null}
        {lastRefresh ? <span className="arb-sb-item subtle">{relativeTime(Math.floor(lastRefresh / 1000))}刷新</span> : null}
        {appInfo ? (
          <span className="arb-sb-item subtle mono" title={appInfo.gitVersion}>
            Git {appInfo.gitVersion.replace('git version ', '').split('.windows')[0]}
          </span>
        ) : null}
        <IconButton
          icon={isDark ? Moon : Sun}
          label={isDark ? '切换到浅色主题' : '切换到深色主题'}
          size={18}
          onClick={() => void setSettings({ theme: isDark ? 'light' : 'dark' })}
        />
      </div>
    </footer>
  )
}

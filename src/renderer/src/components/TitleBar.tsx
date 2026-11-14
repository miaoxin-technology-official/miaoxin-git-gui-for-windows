import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  FolderGit2,
  FolderOpen,
  GitBranch,
  LogOut,
  RefreshCw,
  Search,
  Settings,
  SquareTerminal,
  Upload
} from 'lucide-react'
import type { BranchInfo, OperationResult } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { shortcutLabel } from '@/lib/useHotkeys'
import { useAppStore } from '@/store/app'
import { Button, IconButton } from './ui/Button'
import { TextField } from './ui/Fields'
import { Popover } from './ui/Overlay'
import { Spinner, useToast } from './ui/Feedback'

function lastErrorLine(result: OperationResult): string {
  const raw = (result.stderr || result.output || '').trim()
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('hint:') && !l.startsWith('From ') && !l.startsWith('To '))
  return lines[lines.length - 1] ?? '远程操作失败'
}

function RepoSwitcher(): React.JSX.Element | null {
  const repo = useAppStore((s) => s.repo)
  const recent = useAppStore((s) => s.recent)
  const openRepo = useAppStore((s) => s.openRepo)
  const pickAndOpen = useAppStore((s) => s.pickAndOpen)
  const closeRepo = useAppStore((s) => s.closeRepo)
  const [open, setOpen] = useState(false)
  if (!repo) return null

  return (
    <Popover
      width={320}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className="arb-tb-repo" title={repo.path}>
          <span className="arb-tb-repo-name">{repo.name}</span>
          <ChevronDown size={11} strokeWidth={1.7} className="arb-tb-chevron" />
        </button>
      }
    >
      <div className="arb-popover-hd">最近仓库</div>
      <div className="arb-repo-list">
        {recent.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={cn('arb-repo-item', entry.path === repo.path && 'is-current')}
            onClick={() => {
              setOpen(false)
              if (entry.path !== repo.path) void openRepo(entry.path)
            }}
          >
            <FolderGit2 size={13} strokeWidth={1.6} className="arb-repo-item-icon" />
            <span className="arb-repo-item-main">
              <span className="arb-repo-item-name">{entry.name}</span>
              <span className="arb-repo-item-path mono">{entry.path}</span>
            </span>
            {entry.path === repo.path ? <Check size={12} strokeWidth={2} className="arb-repo-item-check" /> : null}
          </button>
        ))}
      </div>
      <div className="arb-popover-ft">
        <div className="arb-repo-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={FolderOpen}
            onClick={() => {
              setOpen(false)
              void pickAndOpen()
            }}
          >
            打开其他仓库
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={LogOut}
            onClick={() => {
              setOpen(false)
              void closeRepo()
            }}
          >
            退出仓库
          </Button>
        </div>
      </div>
    </Popover>
  )
}

function BranchSwitcher(): React.JSX.Element | null {
  const repo = useAppStore((s) => s.repo)
  const version = useAppStore((s) => s.version)
  const refresh = useAppStore((s) => s.refresh)
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !repo) return
    let alive = true
    api.branches
      .list(repo.path)
      .then((list) => alive && setBranches(list))
      .catch(() => alive && setBranches([]))
    return () => {
      alive = false
    }
  }, [open, repo, version])

  const filtered = useMemo(() => {
    const local = branches.filter((b) => !b.isRemote)
    const remote = branches.filter((b) => b.isRemote)
    const match = (b: BranchInfo): boolean =>
      !query.trim() || b.name.toLowerCase().includes(query.trim().toLowerCase())
    return { local: local.filter(match), remote: remote.filter(match) }
  }, [branches, query])

  if (!repo) return null

  const checkout = async (name: string): Promise<void> => {
    setBusy(name)
    try {
      await api.branches.checkout(repo.path, name)
      await refresh()
      setOpen(false)
      toast(`已切换到 ${name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover
      width={300}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={cn('arb-branch-chip', !repo.branch && 'is-detached')}>
          <GitBranch size={11.5} strokeWidth={1.8} />
          <span className="arb-branch-chip-name">{repo.branch ?? 'detached HEAD'}</span>
          {repo.ahead > 0 ? (
            <span className="arb-branch-ahead" title={`领先上游 ${repo.ahead} 个提交`}>
              <ArrowUp size={9} strokeWidth={2.2} />
              {repo.ahead}
            </span>
          ) : null}
          {repo.behind > 0 ? (
            <span className="arb-branch-behind" title={`落后上游 ${repo.behind} 个提交`}>
              <ArrowDown size={9} strokeWidth={2.2} />
              {repo.behind}
            </span>
          ) : null}
          <ChevronDown size={11} strokeWidth={1.7} className="arb-tb-chevron" />
        </button>
      }
    >
      <div className="arb-popover-search">
        <TextField
          size="sm"
          icon={Search}
          placeholder="切换分支…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="arb-branch-scroll scroll-y">
        {filtered.local.length > 0 ? (
          <>
            <div className="arb-popover-group">本地分支</div>
            {filtered.local.map((branch) => (
              <button
                key={branch.name}
                type="button"
                className={cn('arb-branch-item', branch.isCurrent && 'is-current')}
                onClick={() => void checkout(branch.name)}
                disabled={busy !== null}
              >
                <span className="arb-branch-item-icon">
                  {branch.isCurrent ? <Check size={12} strokeWidth={2.2} /> : <GitBranch size={12} strokeWidth={1.7} />}
                </span>
                <span className="arb-branch-item-name">{branch.name}</span>
                {busy === branch.name ? <Spinner size={11} /> : null}
                {branch.ahead || branch.behind ? (
                  <span className="arb-branch-item-track">
                    {branch.ahead ? <span className="stat-add">↑{branch.ahead}</span> : null}
                    {branch.behind ? <span className="stat-del">↓{branch.behind}</span> : null}
                  </span>
                ) : null}
              </button>
            ))}
          </>
        ) : null}
        {filtered.remote.length > 0 ? (
          <>
            <div className="arb-popover-group">远程分支</div>
            {filtered.remote.slice(0, 12).map((branch) => (
              <button
                key={branch.name}
                type="button"
                className="arb-branch-item"
                onClick={() => void checkout(branch.name)}
                disabled={busy !== null}
              >
                <span className="arb-branch-item-icon">
                  <GitBranch size={12} strokeWidth={1.7} />
                </span>
                <span className="arb-branch-item-name muted">{branch.name}</span>
                <span className="arb-branch-item-time">{relativeTime(branch.time)}</span>
              </button>
            ))}
          </>
        ) : null}
      </div>
    </Popover>
  )
}

export function TitleBar(): React.JSX.Element {
  const repo = useAppStore((s) => s.repo)
  const refresh = useAppStore((s) => s.refresh)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const terminalOpen = useAppStore((s) => s.terminalOpen)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const { toast } = useToast()
  const [busy, setBusy] = useState<'fetch' | 'pull' | 'push' | null>(null)

  async function runRemote(kind: 'fetch' | 'pull' | 'push'): Promise<void> {
    if (!repo || busy) return
    setBusy(kind)
    try {
      let result: OperationResult
      if (kind === 'fetch') {
        result = await api.remotes.fetch(repo.path, { prune: false })
      } else if (kind === 'pull') {
        result = await api.remotes.pull(repo.path)
      } else {
        const remote = repo.remotes[0]?.name ?? 'origin'
        const needsUpstream = !repo.upstream && Boolean(repo.branch)
        result = await api.remotes.push(
          repo.path,
          needsUpstream ? { setUpstream: true, remote, branch: repo.branch ?? undefined } : {}
        )
        if (!result.ok && /no upstream branch|has no upstream/i.test(result.stderr)) {
          result = await api.remotes.push(repo.path, {
            setUpstream: true,
            remote,
            branch: repo.branch ?? undefined
          })
        }
      }
      await refresh()
      if (!result.ok) toast(lastErrorLine(result), 'error')
      else toast(kind === 'fetch' ? '已获取远程更新' : kind === 'pull' ? '已拉取远程更新' : '已推送提交', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <header className="arb-titlebar">
      <div className="arb-tb-left">
        <span className="arb-tb-appname">Miaoxin Git GUI</span>
        {repo ? (
          <>
            <span className="arb-tb-sep" />
            <RepoSwitcher />
            <BranchSwitcher />
          </>
        ) : null}
      </div>

      <div className="arb-tb-center">{repo ? <span className="arb-tb-folder">{repo.path}</span> : null}</div>

      <div className="arb-tb-right">
        {repo ? (
          <div className="arb-tb-remote-group">
            <IconButton
              icon={RefreshCw}
              label="获取更新 (Ctrl+Shift+F)"
              size={24}
              className={busy === 'fetch' ? 'is-spinning' : undefined}
              disabled={busy !== null}
              onClick={() => void runRemote('fetch')}
            />
            <IconButton
              icon={ArrowDownToLine}
              label="拉取 (Ctrl+Shift+D)"
              size={24}
              className={busy === 'pull' ? 'is-pulsing' : undefined}
              disabled={busy !== null}
              onClick={() => void runRemote('pull')}
            />
            <IconButton
              icon={ArrowUpFromLine}
              label="推送 (Ctrl+Shift+P)"
              size={24}
              className={busy === 'push' ? 'is-pulsing' : undefined}
              disabled={busy !== null}
              onClick={() => void runRemote('push')}
            />
          </div>
        ) : null}
        <IconButton
          icon={SquareTerminal}
          label="Git Bash 命令行 (Ctrl+`)"
          size={24}
          active={terminalOpen && Boolean(repo)}
          onClick={() => toggleTerminal()}
        />
        <IconButton
          icon={Search}
          label={`命令面板 (${shortcutLabel('mod+k')})`}
          size={24}
          onClick={() => setPaletteOpen(true)}
        />
        <IconButton icon={Settings} label={`设置 (${shortcutLabel('mod+,')})`} size={24} onClick={() => setSettingsOpen(true)} />
      </div>
    </header>
  )
}

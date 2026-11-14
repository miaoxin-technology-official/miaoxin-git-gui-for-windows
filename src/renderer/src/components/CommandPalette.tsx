// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Eye,
  FileDiff,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe2,
  History,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Tag,
  Terminal,
  Upload,
  Archive
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { OperationResult } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { fuzzyFilter } from '@/lib/fuzzy'
import { useAppStore, type Section } from '@/store/app'
import { cn } from '@/lib/cn'
import { useToast } from './ui/Feedback'

interface Command {
  id: string
  label: string
  group: string
  icon: LucideIcon
  hint?: string
  keywords?: string
  requiresRepo?: boolean
  run: () => void | Promise<void>
}

const SECTIONS: Array<{ id: Section; label: string; icon: LucideIcon; shortcut: string }> = [
  { id: 'changes', label: '转到 改动', icon: FileDiff, shortcut: 'mod+1' },
  { id: 'history', label: '转到 历史', icon: History, shortcut: 'mod+2' },
  { id: 'branches', label: '转到 分支', icon: GitBranch, shortcut: 'mod+3' },
  { id: 'stash', label: '转到 暂存', icon: Archive, shortcut: 'mod+4' },
  { id: 'tags', label: '转到 标签', icon: Tag, shortcut: 'mod+5' },
  { id: 'remotes', label: '转到 远程', icon: Globe2, shortcut: 'mod+6' }
]

function resultError(result: OperationResult): string {
  const raw = (result.stderr || result.output || '').trim()
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? '远程操作失败'
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const repo = useAppStore((s) => s.repo)
  const settings = useAppStore((s) => s.settings)
  const setSection = useAppStore((s) => s.setSection)
  const refresh = useAppStore((s) => s.refresh)
  const pickAndOpen = useAppStore((s) => s.pickAndOpen)
  const closeRepo = useAppStore((s) => s.closeRepo)
  const setSettings = useAppStore((s) => s.setSettings)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setCloneOpen = useAppStore((s) => s.setCloneOpen)
  const setInitOpen = useAppStore((s) => s.setInitOpen)
  const { toast } = useToast()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      window.setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const close = (): void => setOpen(false)

  async function remoteAction(kind: 'fetch' | 'pull' | 'push'): Promise<void> {
    if (!repo) return
    close()
    try {
      let result: OperationResult
      if (kind === 'fetch') result = await api.remotes.fetch(repo.path)
      else if (kind === 'pull') result = await api.remotes.pull(repo.path)
      else {
        const remote = repo.remotes[0]?.name ?? 'origin'
        result = await api.remotes.push(repo.path, repo.upstream ? {} : { setUpstream: true, remote, branch: repo.branch ?? undefined })
      }
      await refresh()
      if (!result.ok) toast(resultError(result), 'error')
      else toast(kind === 'fetch' ? '已获取远程更新' : kind === 'pull' ? '已拉取远程更新' : '已推送提交', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = SECTIONS.map((section) => ({
      id: `nav-${section.id}`,
      label: section.label,
      group: '导航',
      icon: section.icon,
      hint: section.shortcut,
      run: () => {
        setSection(section.id)
        close()
      }
    }))

    list.push(
      {
        id: 'repo-open',
        label: '打开仓库…',
        group: '仓库',
        icon: FolderOpen,
        keywords: 'open folder',
        run: () => {
          close()
          void pickAndOpen()
        }
      },
      {
        id: 'repo-clone',
        label: '克隆远程仓库…',
        group: '仓库',
        icon: Download,
        keywords: 'clone remote',
        run: () => {
          close()
          setCloneOpen(true)
        }
      },
      {
        id: 'repo-init',
        label: '新建仓库…',
        group: '仓库',
        icon: FolderPlus,
        keywords: 'init new',
        run: () => {
          close()
          setInitOpen(true)
        }
      }
    )

    if (repo) {
      list.push(
        {
          id: 'repo-refresh',
          label: '刷新仓库状态',
          group: '仓库',
          icon: RefreshCw,
          hint: 'mod+r',
          run: () => {
            close()
            void refresh()
          }
        },
        {
          id: 'repo-reveal',
          label: '在资源管理器中打开',
          group: '仓库',
          icon: FolderGit2,
          run: () => {
            close()
            void api.repos.reveal(repo.path)
          }
        },
        {
          id: 'repo-terminal',
          label: '在此仓库打开终端',
          group: '仓库',
          icon: Terminal,
          run: () => {
            close()
            void api.repos.terminal(repo.path)
          }
        },
        {
          id: 'repo-close',
          label: '关闭仓库',
          group: '仓库',
          icon: LogOut,
          run: () => {
            close()
            void closeRepo()
          }
        },
        {
          id: 'git-fetch',
          label: '获取远程更新',
          group: 'Git',
          icon: RefreshCw,
          hint: 'ctrl+shift+f',
          run: () => void remoteAction('fetch')
        },
        {
          id: 'git-pull',
          label: '拉取当前分支',
          group: 'Git',
          icon: ArrowDownToLine,
          run: () => void remoteAction('pull')
        },
        {
          id: 'git-push',
          label: '推送当前分支',
          group: 'Git',
          icon: ArrowUpFromLine,
          hint: 'ctrl+shift+p',
          run: () => void remoteAction('push')
        },
        {
          id: 'git-stage-all',
          label: '暂存全部改动',
          group: 'Git',
          icon: Plus,
          run: () => {
            close()
            if (!repo) return
            void api.changes
              .stageAll(repo.path)
              .then(() => refresh())
              .then(() => toast('已暂存全部改动', 'success'))
              .catch((error) => toast(errorMessage(error), 'error'))
          }
        },
        {
          id: 'git-unstage-all',
          label: '取消暂存全部改动',
          group: 'Git',
          icon: Eye,
          run: () => {
            close()
            if (!repo) return
            void api.changes
              .unstageAll(repo.path)
              .then(() => refresh())
              .then(() => toast('已取消暂存全部改动', 'success'))
              .catch((error) => toast(errorMessage(error), 'error'))
          }
        }
      )
    }

    const isDark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

    list.push(
      {
        id: 'appearance-theme',
        label: isDark ? '切换到浅色主题' : '切换到深色主题',
        group: '外观',
        icon: isDark ? Sun : Moon,
        keywords: 'theme dark light',
        run: () => {
          close()
          void setSettings({ theme: isDark ? 'light' : 'dark' })
        }
      },
      {
        id: 'appearance-settings',
        label: '打开设置',
        group: '外观',
        icon: Settings,
        hint: 'mod+,',
        keywords: 'preferences',
        run: () => {
          close()
          setSettingsOpen(true)
        }
      }
    )

    return list
  }, [repo, settings.theme, closeRepo, pickAndOpen, refresh, setCloneOpen, setInitOpen, setSection, setSettings, setSettingsOpen])

  const filtered = useMemo(() => {
    const available = commands.filter((c) => (repo ? true : !c.requiresRepo))
    const searched = fuzzyFilter(query, available, (c) => `${c.label} ${c.keywords ?? ''}`)
    return searched
  }, [commands, query, repo])

  const groups = useMemo(() => {
    const order = ['导航', '仓库', 'Git', '外观']
    const map = new Map<string, Command[]>()
    for (const command of filtered) {
      const list = map.get(command.group) ?? []
      list.push(command)
      map.set(command.group, list)
    }
    return order.filter((g) => map.has(g)).map((g) => ({ name: g, items: map.get(g) ?? [] }))
  }, [filtered])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, flat.length - 1)))
  }, [flat.length])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  function runActive(index: number): void {
    const command = flat[index]
    if (!command) return
    void command.run()
  }

  return (
    <div className="arb-palette-layer">
      <div className="arb-palette-backdrop" onClick={close} />
      <div className="arb-palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="arb-palette-input-row">
          <Search size={15} strokeWidth={1.8} className="arb-palette-search-icon" />
          <input
            ref={inputRef}
            className="arb-palette-input"
            placeholder="搜索命令、仓库或操作…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => (i + 1) % Math.max(1, flat.length))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => (i - 1 + flat.length) % Math.max(1, flat.length))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                runActive(active)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="arb-palette-list scroll-y" ref={listRef}>
          {flat.length === 0 ? <div className="arb-palette-empty">没有匹配的命令</div> : null}
          {groups.map((group) => (
            <div key={group.name} className="arb-palette-group">
              <div className="arb-palette-group-label">{group.name}</div>
              {group.items.map((command) => {
                const index = flat.indexOf(command)
                const Icon = command.icon
                return (
                  <button
                    key={command.id}
                    type="button"
                    data-index={index}
                    className={cn('arb-palette-item', index === active && 'is-active')}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => runActive(index)}
                  >
                    <span className="arb-palette-item-icon">
                      <Icon size={14} strokeWidth={1.7} />
                    </span>
                    <span className="arb-palette-item-label">{command.label}</span>
                    {command.hint ? <kbd className="kbd">{command.hint.replace('mod', 'Ctrl').replace('ctrl', 'Ctrl')}</kbd> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="arb-palette-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> 选择
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> 运行
          </span>
          <span className="arb-palette-foot-right">{repo ? repo.name : '未打开仓库'}</span>
        </div>
      </div>
    </div>
  )
}

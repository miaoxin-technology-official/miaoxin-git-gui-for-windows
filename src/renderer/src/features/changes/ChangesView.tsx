import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { ChangeSide, DiffResult } from '@shared/types'
import { ChevronDown, ChevronRight, ChevronsUpDown, FolderOpen, Minus, Plus, RefreshCw } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useAsyncData } from '@/lib/useAsyncData'
import { useHotkeys } from '@/lib/useHotkeys'
import { useAppStore } from '@/store/app'
import { DiffView } from '@/components/DiffView'
import { Button, IconButton } from '@/components/ui/Button'
import { Banner, EmptyState } from '@/components/ui/Feedback'
import { ConfirmDialog } from '@/components/ui/Overlay'
import { SplitPane } from '@/components/ui/SplitPane'
import { CommitBox } from './CommitBox'
import { FileRow } from './FileRow'
import {
  buildGroups,
  diffSideFor,
  isStageable,
  type ChangeEntry,
  type ChangeGroup
} from './model'
import '@/styles/changes.css'

type ResolveStrategy = 'ours' | 'theirs' | 'mark'

function stageToneLabel(strategy: ResolveStrategy): string {
  if (strategy === 'ours') return '已使用我的版本'
  if (strategy === 'theirs') return '已使用对方版本'
  return '已标记为已解决'
}

export default function ChangesView(): React.JSX.Element {
  const repo = useAppStore((state) => state.repo)
  const status = useAppStore((state) => state.status)
  const version = useAppStore((state) => state.version)
  const settings = useAppStore((state) => state.settings)
  const refreshing = useAppStore((state) => state.refreshing)
  const refresh = useAppStore((state) => state.refresh)
  const pushToast = useAppStore((state) => state.pushToast)
  const setSection = useAppStore((state) => state.setSection)
  const repoPath = repo?.path ?? ''

  const groups = useMemo(() => buildGroups(status), [status])
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups])

  const counts = useMemo(() => {
    let staged = 0
    let unstaged = 0
    let untracked = 0
    let conflicted = 0
    for (const group of groups) {
      if (group.key === 'staged') staged += group.entries.length
      else if (group.key === 'unstaged') unstaged += group.entries.length
      else if (group.key === 'untracked') untracked += group.entries.length
      else conflicted += group.entries.length
    }
    return { staged, unstaged, untracked, conflicted, worktree: unstaged + untracked }
  }, [groups])

  const [collapsed, setCollapsed] = useState<Record<ChangeSide, boolean>>({
    conflicted: false,
    staged: false,
    unstaged: false,
    untracked: false
  })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [discardTargets, setDiscardTargets] = useState<ChangeEntry[] | null>(null)
  const anchorRef = useRef<string | null>(null)
  const lastPathRef = useRef<string | null>(null)

  /* keep the selection valid while the status changes (watch/refresh) */
  useEffect(() => {
    const keys = new Set(entries.map((entry) => entry.key))
    if (entries.length === 0) {
      if (selectedKey !== null) setSelectedKey(null)
      setSelectedKeys((previous) => (previous.size === 0 ? previous : new Set<string>()))
      anchorRef.current = null
      lastPathRef.current = null
      return
    }
    // prefer the same file (it may have moved from unstaged to staged) before the first row
    const samePath = lastPathRef.current
      ? entries.find((entry) => entry.file.path === lastPathRef.current)
      : undefined
    const fallback = samePath ?? entries[0]
    const nextKey = selectedKey && keys.has(selectedKey) ? selectedKey : fallback.key
    if (nextKey !== selectedKey) setSelectedKey(nextKey)
    lastPathRef.current = entries.find((entry) => entry.key === nextKey)?.file.path ?? fallback.file.path
    setSelectedKeys((previous) => {
      const next = new Set([...previous].filter((key) => keys.has(key)))
      if (next.size === 0) next.add(nextKey)
      if (next.size === previous.size && [...next].every((key) => previous.has(key))) return previous
      return next
    })
    if (!anchorRef.current || !keys.has(anchorRef.current)) anchorRef.current = nextKey
  }, [entries, selectedKey])

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey) ?? null,
    [entries, selectedKey]
  )
  const selectedEntries = useMemo(() => {
    const list = entries.filter((entry) => selectedKeys.has(entry.key))
    if (list.length > 0) return list
    return selectedEntry ? [selectedEntry] : []
  }, [entries, selectedKeys, selectedEntry])

  /* diff for the selected row; `version` re-fetch keeps it in sync after mutations */
  const diffQuery = useAsyncData<DiffResult | null>(
    async () => {
      if (!repoPath || !selectedEntry) return null
      return api.diff.worktree(repoPath, selectedEntry.file.path, diffSideFor(selectedEntry.side), {
        context: settings.diffContext,
        ignoreWhitespace: settings.ignoreWhitespace
      })
    },
    [repoPath, selectedEntry?.key ?? null, version, settings.diffContext, settings.ignoreWhitespace]
  )

  /* ------------------------------------------------------------ mutations */

  const runOp = async (label: string, run: () => Promise<void>, success?: string): Promise<void> => {
    if (!repoPath || busy) return
    setBusy(label)
    try {
      await run()
      if (success) pushToast(success, 'success')
      await refresh()
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggleStageEntries = (items: ChangeEntry[]): void => {
    if (items.length === 0) return
    const toStage = items.filter((entry) => isStageable(entry.side)).map((entry) => entry.file.path)
    const toUnstage = items.filter((entry) => entry.side === 'staged').map((entry) => entry.file.path)
    if (toStage.length === 0 && toUnstage.length === 0) {
      pushToast('冲突文件需要先解决冲突', 'info')
      return
    }
    void runOp('stage', async () => {
      if (toStage.length > 0) await api.changes.stage(repoPath, toStage)
      if (toUnstage.length > 0) await api.changes.unstage(repoPath, toUnstage)
    })
  }

  const stageGroup = (group: ChangeGroup, action: 'stage' | 'unstage'): void => {
    const files = group.entries.map((entry) => entry.file.path)
    if (files.length === 0) return
    void runOp(
      `group-${action}`,
      async () => {
        if (action === 'stage') await api.changes.stage(repoPath, files)
        else await api.changes.unstage(repoPath, files)
      },
      action === 'stage' ? `已暂存 ${files.length} 个文件` : `已取消暂存 ${files.length} 个文件`
    )
  }

  const handleStageAll = (): void => {
    void runOp('stage-all', () => api.changes.stageAll(repoPath), '已暂存所有改动')
  }

  const handleUnstageAll = (): void => {
    void runOp('unstage-all', () => api.changes.unstageAll(repoPath), '已取消暂存所有改动')
  }

  const performDiscard = async (targets: ChangeEntry[]): Promise<void> => {
    setBusy('discard')
    try {
      const sides: Array<'untracked' | 'unstaged' | 'staged'> = ['untracked', 'unstaged', 'staged']
      for (const side of sides) {
        const files = targets.filter((entry) => entry.side === side).map((entry) => entry.file.path)
        if (files.length > 0) await api.changes.discard(repoPath, files, side)
      }
      setDiscardTargets(null)
      pushToast(
        targets.length === 1 ? '已丢弃改动' : `已丢弃 ${targets.length} 个文件的改动`,
        'success'
      )
      await refresh()
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const requestDiscard = (items: ChangeEntry[]): void => {
    const targets = items.filter((entry) => entry.side !== 'conflicted')
    if (targets.length === 0) {
      pushToast('冲突文件请使用冲突操作处理', 'info')
      return
    }
    if (settings.confirmDestructive) {
      setDiscardTargets(targets)
      return
    }
    void performDiscard(targets)
  }

  const resolveConflict = (entry: ChangeEntry, strategy: ResolveStrategy): void => {
    void runOp(
      `resolve-${strategy}`,
      async () => {
        await api.changes.resolveConflict(repoPath, entry.file.path, strategy)
      },
      stageToneLabel(strategy)
    )
  }

  const revealRepo = (): void => {
    if (!repoPath) return
    void api.repos.reveal(repoPath).catch((error) => pushToast(errorMessage(error), 'error'))
  }

  const copyPath = (entry: ChangeEntry): void => {
    const text = entry.file.path
    const fallback = (): void => {
      try {
        const element = document.createElement('textarea')
        element.value = text
        element.setAttribute('readonly', '')
        element.style.position = 'fixed'
        element.style.opacity = '0'
        document.body.appendChild(element)
        element.select()
        document.execCommand('copy')
        element.remove()
        pushToast('已复制路径', 'success')
      } catch {
        pushToast('复制路径失败', 'error')
      }
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(text)
        .then(() => pushToast('已复制路径', 'success'))
        .catch(fallback)
    } else {
      fallback()
    }
  }

  const ignoreEntry = (entry: ChangeEntry): void => {
    void runOp(
      'ignore',
      async () => {
        await api.changes.ignore(repoPath, [entry.file.path])
      },
      '已忽略该文件'
    )
  }

  const stageHunk = (filePath: string, hunkIndex: number): void => {
    void runOp(
      'hunk-stage',
      async () => {
        await api.changes.applyHunk(repoPath, { file: filePath, hunkIndex, source: 'unstaged' })
      },
      '已暂存该块'
    )
  }

  const unstageHunk = (filePath: string, hunkIndex: number): void => {
    void runOp(
      'hunk-unstage',
      async () => {
        // reverse-apply the cached hunk back to the index (see main/git/patch.ts)
        await api.changes.applyHunk(repoPath, {
          file: filePath,
          hunkIndex,
          source: 'staged',
          reverse: true
        })
      },
      '已取消暂存该块'
    )
  }

  /* ------------------------------------------------------------- selection */

  const selectEntry = (entry: ChangeEntry, event: MouseEvent<HTMLDivElement>): void => {
    const key = entry.key
    const modifier = event.ctrlKey || event.metaKey
    lastPathRef.current = entry.file.path
    if (event.shiftKey) {
      const anchor = anchorRef.current
      const fromIndex = anchor ? entries.findIndex((item) => item.key === anchor) : -1
      const toIndex = entries.findIndex((item) => item.key === key)
      if (fromIndex >= 0 && toIndex >= 0) {
        const start = Math.min(fromIndex, toIndex)
        const end = Math.max(fromIndex, toIndex)
        const range = entries.slice(start, end + 1).map((item) => item.key)
        setSelectedKeys((previous) => {
          const next = modifier ? new Set(previous) : new Set<string>()
          for (const rangeKey of range) next.add(rangeKey)
          return next
        })
        setSelectedKey(key)
        return
      }
    }
    if (modifier) {
      setSelectedKeys((previous) => {
        const next = new Set(previous)
        if (next.has(key)) {
          if (next.size > 1) next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
      setSelectedKey(key)
      anchorRef.current = key
      return
    }
    setSelectedKey(key)
    setSelectedKeys(new Set([key]))
    anchorRef.current = key
  }

  /* --------------------------------------------------------------- hotkeys */

  /* global shortcut helpers must not leak through dialogs/overlays */
  const overlayOpen = (): boolean => {
    const state = useAppStore.getState()
    return state.settingsOpen || state.paletteOpen || state.cloneOpen || state.initOpen
  }

  useHotkeys({
    space: () => {
      if (overlayOpen()) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return
      }
      if (selectedEntries.length > 0) toggleStageEntries(selectedEntries)
    },
    delete: () => {
      if (overlayOpen()) return
      if (selectedEntries.length > 0) requestDiscard(selectedEntries)
    },
    'mod+a': () => {
      if (overlayOpen() || entries.length === 0) return
      setSelectedKeys(new Set(entries.map((entry) => entry.key)))
    },
    escape: () => {
      if (overlayOpen()) return
      if (selectedKeys.size > 1 && selectedKey) setSelectedKeys(new Set([selectedKey]))
    }
  })

  const toggleGroup = (key: ChangeSide): void => {
    setCollapsed((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  const allCollapsed = groups.length > 0 && groups.every((group) => collapsed[group.key])

  const toggleAllGroups = (): void => {
    const next = !allCollapsed
    setCollapsed((previous) => {
      const draft = { ...previous }
      for (const group of groups) draft[group.key] = next
      return draft
    })
  }

  /* ------------------------------------------------------------------- view */

  if (!repo) {
    return (
      <div className="section-view">
        <EmptyState art="repo" title="没有打开的仓库" desc="打开一个本地仓库，或从远程克隆。" />
      </div>
    )
  }

  /* A clean worktree gets one full-panel empty state instead of two stacked
     placeholders (list + diff pane). */
  if (!status || status.files.length === 0) {
    return (
      <div className="changes-view changes-view--clean">
        <EmptyState
          className="changes-clean-empty"
          art="changes"
          title="工作区是干净的"
          desc="暂存改动后会在右侧预览差异；也可以切换到历史查看提交。"
          actions={
            <>
              <Button variant="secondary" size="sm" loading={refreshing} onClick={() => void refresh()}>
                刷新
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSection('history')}>
                查看历史
              </Button>
            </>
          }
        />
      </div>
    )
  }

  const list = groups.map((group) => (
    <div className="changes-group" key={group.key} role="group" aria-label={group.title}>
      <div
        className="changes-group-hd"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed[group.key]}
        onClick={() => toggleGroup(group.key)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleGroup(group.key)
          }
        }}
      >
        {collapsed[group.key] ? (
          <ChevronRight size={13} strokeWidth={1.8} className="changes-group-chevron" />
        ) : (
          <ChevronDown size={13} strokeWidth={1.8} className="changes-group-chevron" />
        )}
        <span className="changes-group-title">{group.title}</span>
        <span className="changes-group-count num">{group.entries.length}</span>
        <span className="changes-group-stats num">
          {group.additions > 0 ? <span className="stat-add">+{group.additions}</span> : null}
          {group.deletions > 0 ? <span className="stat-del">−{group.deletions}</span> : null}
        </span>
        <span
          className="changes-group-actions"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {group.key === 'staged' ? (
            <IconButton
              icon={Minus}
              label="取消暂存此组"
              size={22}
              disabled={busy !== null}
              onClick={() => stageGroup(group, 'unstage')}
            />
          ) : group.key === 'unstaged' || group.key === 'untracked' ? (
            <IconButton
              icon={Plus}
              label="暂存此组"
              size={22}
              disabled={busy !== null}
              onClick={() => stageGroup(group, 'stage')}
            />
          ) : null}
        </span>
      </div>
      {!collapsed[group.key]
        ? group.entries.map((entry) => (
            <FileRow
              key={entry.key}
              entry={entry}
              active={selectedKey === entry.key}
              selected={selectedKeys.has(entry.key)}
              disabled={busy !== null}
              onSelect={selectEntry}
              onToggleStage={(item) => toggleStageEntries([item])}
              onDiscard={(item) => requestDiscard([item])}
              onReveal={() => revealRepo()}
              onCopyPath={copyPath}
              onIgnore={ignoreEntry}
              onResolve={resolveConflict}
            />
          ))
        : null}
    </div>
  ))

  const leftPanel = (
    <div className="panel changes-left">
      <div className="toolbar changes-toolbar">
        <IconButton
          icon={Plus}
          label="全部暂存"
          size={26}
          disabled={counts.worktree === 0 || busy !== null}
          onClick={handleStageAll}
        />
        <IconButton
          icon={Minus}
          label="全部取消暂存"
          size={26}
          disabled={counts.staged === 0 || busy !== null}
          onClick={handleUnstageAll}
        />
        <span className="toolbar-sep" />
        <IconButton
          icon={RefreshCw}
          label="刷新"
          size={26}
          className={refreshing ? 'is-spinning' : undefined}
          disabled={refreshing}
          onClick={() => void refresh()}
        />
        <IconButton
          icon={ChevronsUpDown}
          label={allCollapsed ? '展开所有分组' : '折叠所有分组'}
          size={26}
          active={allCollapsed}
          disabled={groups.length === 0}
          onClick={toggleAllGroups}
        />
        <span className="changes-toolbar-spacer" />
        {entries.length > 0 ? (
          <span className="changes-toolbar-count subtle num">{entries.length} 个变更</span>
        ) : null}
      </div>
      <div className="changes-list scroll-y" role="listbox" aria-multiselectable="true" aria-label="工作区改动">
        {list}
      </div>
      {entries.length > 0 ? (
        <CommitBox repo={repoPath} stagedCount={counts.staged} worktreeCount={counts.worktree} />
      ) : null}
    </div>
  )

  /* hunk staging only applies to tracked, unstaged files; untracked files stage whole */
  const hunkStage = selectedEntry?.side === 'unstaged' ? stageHunk : undefined
  const hunkUnstage = selectedEntry?.side === 'staged' ? unstageHunk : undefined

  const rightPanel = (
    <DiffView
      repo={repoPath}
      diff={diffQuery.data}
      loading={diffQuery.loading}
      error={diffQuery.error}
      emptyLabel={
        entries.length === 0
          ? '工作区没有改动'
          : selectedEntry
            ? undefined
            : '选择一个文件查看差异'
      }
      emptyDesc={entries.length === 0 ? '切换到 History 查看提交记录。' : undefined}
      side={selectedEntry?.side}
      onStageHunk={hunkStage}
      onUnstageHunk={hunkUnstage}
      onRetry={diffQuery.reload}
    />
  )

  const discardDescription =
    discardTargets === null ? null : (
      <div className="changes-discard">
        <p>将丢弃以下 {discardTargets.length} 个文件的改动：</p>
        <ul className="changes-discard-list">
          {discardTargets.slice(0, 6).map((entry) => (
            <li key={entry.key} className="mono truncate" title={entry.file.path}>
              {entry.file.path}
            </li>
          ))}
          {discardTargets.length > 6 ? <li>以及其余 {discardTargets.length - 6} 个文件</li> : null}
        </ul>
        <p className="changes-discard-note">
          已暂存文件只取消暂存，不会删除工作区内容；未跟踪文件会从磁盘删除。
        </p>
      </div>
    )

  return (
    <div className="changes-view">
      {counts.conflicted > 0 ? (
        <div className="changes-conflict-bar">
          <Banner
            kind="error"
            actions={
              <Button variant="secondary" size="sm" icon={FolderOpen} onClick={revealRepo}>
                打开目录
              </Button>
            }
          >
            存在 {counts.conflicted} 个冲突文件，使用「我的 / 对方 / 标记为已解决」处理后再提交。
          </Banner>
        </div>
      ) : null}

      <SplitPane
        initial={336}
        min={272}
        max={640}
        storageKey="changes"
        left={leftPanel}
        right={rightPanel}
      />

      <ConfirmDialog
        open={discardTargets !== null}
        title="丢弃改动"
        confirmText="丢弃"
        danger
        loading={busy === 'discard'}
        description={discardDescription ?? ''}
        onCancel={() => {
          if (busy !== 'discard') setDiscardTargets(null)
        }}
        onConfirm={() => {
          if (discardTargets) void performDiscard(discardTargets)
        }}
      />
    </div>
  )
}

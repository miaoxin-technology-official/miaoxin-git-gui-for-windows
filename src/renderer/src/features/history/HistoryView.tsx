// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  GitBranch,
  GitCommit,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  Undo2,
  X
} from 'lucide-react'
import type { Commit, LogResult } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { absoluteTime, hash7, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { fuzzyFilter } from '@/lib/fuzzy'
import { useAsyncData } from '@/lib/useAsyncData'
import { useHotkeys } from '@/lib/useHotkeys'
import { useAppStore } from '@/store/app'
import { Button, IconButton } from '@/components/ui/Button'
import { TextArea, TextField } from '@/components/ui/Fields'
import { Banner, EmptyState, LoadingBlock, useToast } from '@/components/ui/Feedback'
import { ConfirmDialog, Menu, Modal, type MenuItem } from '@/components/ui/Overlay'
import { SplitPane } from '@/components/ui/SplitPane'
import { CommitGraphRow } from './CommitGraphRow'
import { HistoryDetail } from './HistoryDetail'
import { buildGraph } from './graph'
import { RefBadges, copyText } from './parts'
import '@/styles/history.css'

const PAGE_SIZE = 100

interface CommitContextState {
  commit: Commit
  x: number
  y: number
}

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

function resetDescription(mode: 'soft' | 'mixed' | 'hard'): React.ReactNode {
  if (mode === 'hard') {
    return (
      <>
        <strong className="danger-text">--hard 会丢弃工作区与暂存区中的所有未提交改动，无法撤销。</strong>
        当前分支会直接指向该提交，之后的提交将从分支历史中移除（reflog 中仍可找回）。请确认目标提交无误。
      </>
    )
  }
  if (mode === 'mixed') {
    return (
      <>
        当前分支会移动到该提交，并重置暂存区；工作区中的文件内容保持不变，改动会变为未暂存状态。
        之后的提交会从当前分支历史中移除（reflog 中仍可找回）。
      </>
    )
  }
  return (
    <>
      当前分支会移动到该提交，暂存区与工作区保持不变。之后的提交会从当前分支历史中移除
      （reflog 中仍可找回）。
    </>
  )
}

export default function HistoryView(): React.JSX.Element {
  const repo = useAppStore((state) => state.repo)
  const version = useAppStore((state) => state.version)
  const settings = useAppStore((state) => state.settings)
  const refresh = useAppStore((state) => state.refresh)
  const { toast } = useToast()
  const repoPath = repo?.path ?? null

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [pinnedHash, setPinnedHash] = useState<string | null>(null)
  const [extra, setExtra] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [contextMenu, setContextMenu] = useState<CommitContextState | null>(null)
  const [branchAt, setBranchAt] = useState<Commit | null>(null)
  const [branchName, setBranchName] = useState('')
  const [tagAt, setTagAt] = useState<Commit | null>(null)
  const [tagName, setTagName] = useState('')
  const [tagMessage, setTagMessage] = useState('')
  const [resetAt, setResetAt] = useState<{ commit: Commit; mode: 'soft' | 'mixed' | 'hard' } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  /* ------------------------------------------------------------- search */
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  /* --------------------------------------------------------------- data */
  const base = useAsyncData<LogResult | null>(
    () => (repoPath ? api.log(repoPath, { limit: PAGE_SIZE }) : Promise.resolve(null)),
    [repoPath, version]
  )

  // Background search: local fuzzy filtering stays instant, this pulls matches
  // older than the loaded window once the query settles (300ms).
  const searchResult = useAsyncData<LogResult | null>(
    () =>
      repoPath && debounced
        ? api.log(repoPath, { limit: PAGE_SIZE, search: debounced })
        : Promise.resolve(null),
    [repoPath, version, debounced]
  )

  useEffect(() => {
    setExtra([])
    setHasMore(base.data?.hasMore ?? false)
  }, [base.data])

  const loaded = useMemo(() => [...(base.data?.commits ?? []), ...extra], [base.data, extra])
  const searchText = query.trim()

  const candidates = useMemo(() => {
    const server = searchResult.data?.commits ?? []
    if (!server.length) return loaded
    const seen = new Set(loaded.map((commit) => commit.hash))
    return [...loaded, ...server.filter((commit) => !seen.has(commit.hash))]
  }, [loaded, searchResult.data])

  const visible = useMemo(() => {
    if (!searchText) return loaded
    return fuzzyFilter(
      searchText,
      candidates,
      (commit) => `${commit.subject} ${commit.body} ${commit.author.name} ${commit.hash}`
    )
  }, [candidates, searchText])

  useEffect(() => {
    if (!visible.length) {
      setSelectedHash(null)
      return
    }
    if (!selectedHash || !visible.some((commit) => commit.hash === selectedHash)) {
      setSelectedHash(visible[0].hash)
    }
  }, [visible, selectedHash])

  const graph = useMemo(() => buildGraph(visible), [visible])
  const detailHash = pinnedHash ?? selectedHash
  const headHash = repo?.head ?? null
  // History rows are a fixed 28px (independent of density) so the 28px SVG
  // lanes always align exactly with the HTML rows.
  const rowHeight = 28

  useEffect(() => {
    if (!selectedHash) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-hash="${selectedHash}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selectedHash, visible])

  /* ---------------------------------------------------------- keyboard */
  const moveSelection = useCallback(
    (delta: number) => {
      if (!visible.length) return
      const index = visible.findIndex((commit) => commit.hash === selectedHash)
      const nextIndex = index === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, index + delta))
      const next = visible[nextIndex]
      if (!next) return
      setSelectedHash(next.hash)
      setPinnedHash(null)
    },
    [visible, selectedHash]
  )

  useHotkeys({
    up: () => moveSelection(-1),
    down: () => moveSelection(1),
    enter: () => {
      const active = document.activeElement as HTMLElement | null
      if (active && ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return
      detailRef.current?.focus()
    },
    'mod+f': () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  })

  /* ---------------------------------------------------------- loading */
  async function loadMore(): Promise<void> {
    if (!repoPath || moreLoading || !hasMore) return
    setMoreLoading(true)
    try {
      const result = await api.log(repoPath, {
        limit: PAGE_SIZE,
        skip: loaded.length,
        search: debounced || undefined
      })
      setExtra((prev) => [...prev, ...result.commits])
      setHasMore(result.hasMore)
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setMoreLoading(false)
    }
  }

  /* ---------------------------------------------------------- actions */
  async function act(commit: Commit, id: string): Promise<void> {
    if (!repoPath || busy) return
    switch (id) {
      case 'checkout': {
        setBusy(true)
        try {
          await api.history.checkoutCommit(repoPath, commit.hash)
          await refresh()
          toast(`已检出 ${commit.shortHash || hash7(commit.hash)}（detached HEAD）`, 'success')
        } catch (error) {
          toast(errorMessage(error), 'error')
        } finally {
          setBusy(false)
        }
        return
      }
      case 'create-branch':
        setBranchName('')
        setBranchAt(commit)
        return
      case 'create-tag':
        setTagName('')
        setTagMessage('')
        setTagAt(commit)
        return
      case 'cherry-pick':
      case 'revert': {
        setBusy(true)
        try {
          const result =
            id === 'cherry-pick'
              ? await api.history.cherryPick(repoPath, commit.hash)
              : await api.history.revert(repoPath, commit.hash)
          await refresh()
          if (result.ok) {
            toast(
              id === 'cherry-pick' ? `已拣选 ${commit.shortHash}` : `已还原 ${commit.shortHash}`,
              'success'
            )
          } else if (result.conflicts && result.conflicts.length > 0) {
            toast('存在冲突，请在 Changes 中解决', 'error')
          } else {
            toast(lastLine(result.stderr) || '操作失败', 'error')
          }
        } catch (error) {
          toast(errorMessage(error), 'error')
        } finally {
          setBusy(false)
        }
        return
      }
      case 'reset-soft':
      case 'reset-mixed':
      case 'reset-hard': {
        const mode = id.replace('reset-', '') as 'soft' | 'mixed' | 'hard'
        if (settings.confirmDestructive) setResetAt({ commit, mode })
        else void performReset(commit, mode)
        return
      }
      case 'copy-hash':
        void copyText(commit.hash, '已复制完整 hash')
        return
      default:
        return
    }
  }

  async function performReset(commit: Commit, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    if (!repoPath) return
    setBusy(true)
    try {
      await api.history.reset(repoPath, commit.hash, mode)
      setResetAt(null)
      await refresh()
      toast(`已 reset --${mode} 到 ${commit.shortHash}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function createBranch(): Promise<void> {
    if (!repoPath || !branchAt) return
    const name = branchName.trim()
    if (!name) {
      toast('请输入分支名', 'error')
      return
    }
    setBusy(true)
    try {
      await api.history.createBranch(repoPath, name, branchAt.hash)
      setBranchAt(null)
      await refresh()
      toast(`已创建分支 ${name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function createTag(): Promise<void> {
    if (!repoPath || !tagAt) return
    const name = tagName.trim()
    if (!name) {
      toast('请输入标签名', 'error')
      return
    }
    setBusy(true)
    try {
      await api.history.createTag(repoPath, name, tagAt.hash, tagMessage.trim() || undefined)
      setTagAt(null)
      await refresh()
      toast(`已创建标签 ${name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function commitMenuItems(): MenuItem[] {
    return [
      { id: 'checkout', label: '检出此提交', icon: GitCommit },
      { id: 'create-branch', label: '在此创建分支…', icon: GitBranch },
      { id: 'create-tag', label: '在此创建标签…', icon: Tag },
      { id: 'sep-1', separator: true },
      { id: 'cherry-pick', label: 'Cherry-pick 到当前分支', icon: GitCommit, disabled: busy },
      { id: 'revert', label: '还原此提交（revert）', icon: Undo2, disabled: busy },
      { id: 'sep-2', separator: true },
      { id: 'reset-soft', label: 'Reset --soft 到此提交', disabled: busy },
      { id: 'reset-mixed', label: 'Reset --mixed 到此提交', disabled: busy },
      { id: 'reset-hard', label: 'Reset --hard 到此提交', icon: RotateCcw, danger: true, disabled: busy },
      { id: 'sep-3', separator: true },
      { id: 'copy-hash', label: '复制完整 hash', icon: Copy }
    ]
  }

  const closeContext = useCallback(() => setContextMenu(null), [])

  if (!repo) {
    return (
      <div className="hist-view">
        <EmptyState art="history" title="没有打开仓库" desc="打开一个本地仓库后查看提交历史。" />
      </div>
    )
  }

  return (
    <div className="hist-view">
      <SplitPane
        initial={440}
        min={300}
        max={760}
        storageKey="history"
        left={
          <div className="hist-pane">
            <div className="toolbar hist-toolbar">
              <TextField
                ref={searchRef}
                size="sm"
                icon={Search}
                className="hist-search"
                placeholder="搜索提交消息、作者或 hash"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setQuery('')
                }}
              />
              {searchText ? (
                <IconButton icon={X} label="清空搜索" size={26} onClick={() => setQuery('')} />
              ) : null}
              <span className="hist-count num">
                {searchText ? `${visible.length} 个匹配` : `${loaded.length}${hasMore ? '+' : ''} 个提交`}
              </span>
              <button
                type="button"
                className="arb-iconbtn hist-refresh"
                title="刷新提交历史"
                aria-label="刷新提交历史"
                onClick={() => void refresh()}
              >
                <RefreshCw
                  size={14}
                  strokeWidth={1.7}
                  className={cn((base.loading || searchResult.loading) && 'arb-spin')}
                />
              </button>
            </div>

            <div className="col-header hist-cols">
              <span className="hist-col-graph" />
              <span className="hist-col-hash" />
              <span className="hist-col-main">提交</span>
              <span className="hist-col-refs">引用</span>
              <span className="hist-col-time">时间</span>
            </div>

            <div className="hist-list scroll-y" ref={listRef}>
              {base.error || searchResult.error ? (
                <div className="hist-list-error">
                  <Banner kind="error">{base.error ?? searchResult.error}</Banner>
                </div>
              ) : null}
              {base.loading && !base.data ? <LoadingBlock label="加载提交历史…" /> : null}
              {!base.loading && visible.length === 0 ? (
                searchText ? (
                  <EmptyState
                    className="empty-compact"
                    art="search"
                    title="没有匹配的提交"
                    desc="换一个关键词试试。"
                    actions={
                      <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                        清空搜索
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    className="empty-compact"
                    art="history"
                    title="没有提交记录"
                    desc="这个仓库还没有任何提交。"
                  />
                )
              ) : null}

              {visible.map((commit, index) => {
                const row = graph.rows[index]
                if (!row) return null
                const isHead = headHash === commit.hash
                return (
                  <div
                    key={commit.hash}
                    data-hash={commit.hash}
                    className={cn('hist-row', selectedHash === commit.hash && 'is-active', isHead && 'is-head')}
                    onClick={() => {
                      setSelectedHash(commit.hash)
                      setPinnedHash(null)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setSelectedHash(commit.hash)
                      setContextMenu({ commit, x: event.clientX, y: event.clientY })
                    }}
                  >
                    <CommitGraphRow
                      row={row}
                      laneCount={graph.laneCount}
                      rowHeight={rowHeight}
                      isHead={isHead}
                    />
                    <span className="hist-hash mono">{commit.shortHash || hash7(commit.hash)}</span>
                    <span className="hist-subject truncate">{commit.subject || '(无提交信息)'}</span>
                    <RefBadges refs={commit.refs} currentBranch={repo.branch} max={2} />
                    <span className="hist-time num" title={absoluteTime(commit.author.time)}>
                      {relativeTime(commit.author.time)}
                    </span>
                    <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                      <Menu
                        items={commitMenuItems()}
                        onSelect={(id) => void act(commit, id)}
                        align="end"
                        width={216}
                        trigger={<IconButton icon={MoreHorizontal} label="提交操作" size={22} />}
                      />
                    </span>
                  </div>
                )
              })}

              <div className="hist-more">
                {searchText ? (
                  <span className="hist-more-hint">搜索结果最多显示 {PAGE_SIZE} 条，输入更精确的关键词可缩小范围</span>
                ) : hasMore ? (
                  <Button size="sm" variant="ghost" loading={moreLoading} onClick={() => void loadMore()}>
                    加载更多
                  </Button>
                ) : loaded.length > 0 ? (
                  <span className="hist-more-hint">已加载全部 {loaded.length} 个提交</span>
                ) : null}
              </div>
            </div>
          </div>
        }
        right={
          <div className="hist-detail-wrap" ref={detailRef} tabIndex={-1}>
            <HistoryDetail
              repoPath={repo.path}
              version={version}
              hash={detailHash}
              onOpenCommit={(parent) => setPinnedHash(parent)}
            />
          </div>
        }
      />

      {contextMenu ? (
        <CommitContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={commitMenuItems()}
          onClose={closeContext}
          onSelect={(id) => void act(contextMenu.commit, id)}
        />
      ) : null}

      <Modal
        open={Boolean(branchAt)}
        onClose={() => setBranchAt(null)}
        title="在此创建分支"
        subtitle={branchAt ? `起点 ${branchAt.shortHash || hash7(branchAt.hash)} · ${branchAt.subject}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBranchAt(null)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void createBranch()}>
              创建分支
            </Button>
          </>
        }
      >
        <TextField
          label="分支名"
          mono
          autoFocus
          placeholder="例如 feature/login"
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void createBranch()
          }}
        />
      </Modal>

      <Modal
        open={Boolean(tagAt)}
        onClose={() => setTagAt(null)}
        title="在此创建标签"
        subtitle={tagAt ? `目标 ${tagAt.shortHash || hash7(tagAt.hash)} · ${tagAt.subject}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagAt(null)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void createTag()}>
              创建标签
            </Button>
          </>
        }
      >
        <TextField
          label="标签名"
          mono
          autoFocus
          placeholder="例如 v1.2.0"
          value={tagName}
          onChange={(event) => setTagName(event.target.value)}
        />
        <TextArea
          label="说明（可选）"
          rows={4}
          placeholder="填写后会创建 annotated tag"
          value={tagMessage}
          onChange={(event) => setTagMessage(event.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(resetAt)}
        title={resetAt ? `Reset 到 ${resetAt.commit.shortHash}？` : 'Reset'}
        danger={resetAt?.mode === 'hard'}
        confirmText={resetAt?.mode === 'hard' ? '丢弃改动并重置' : '重置'}
        loading={busy}
        description={resetAt ? resetDescription(resetAt.mode) : ''}
        onConfirm={() => {
          if (resetAt) void performReset(resetAt.commit, resetAt.mode)
        }}
        onCancel={() => setResetAt(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------ context menu */

function CommitContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - 240))
  const top = Math.max(8, Math.min(y, window.innerHeight - 440))

  return createPortal(
    <div ref={ref} className="arb-menu hist-ctx" style={{ left, top }} role="menu">
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="arb-menu-sep" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cn('arb-menu-item', item.danger && 'is-danger')}
            onClick={() => {
              onClose()
              onSelect(item.id)
            }}
          >
            {item.icon ? (
              <item.icon size={14} strokeWidth={1.7} className="arb-menu-icon" />
            ) : (
              <span className="arb-menu-icon" />
            )}
            <span className="arb-menu-label">{item.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  )
}

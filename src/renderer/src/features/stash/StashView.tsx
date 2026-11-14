// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { Archive, Copy, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import type { DiffResult, StashEntry } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { absoluteTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAsyncData } from '@/lib/useAsyncData'
import { useAppStore } from '@/store/app'
import { Button, IconButton } from '@/components/ui/Button'
import { Checkbox, TextField } from '@/components/ui/Fields'
import { Banner, EmptyState, LoadingBlock, useToast } from '@/components/ui/Feedback'
import { ConfirmDialog, Menu, Modal, type MenuItem } from '@/components/ui/Overlay'
import { SplitPane } from '@/components/ui/SplitPane'
import { DiffView } from '@/components/DiffView'
import '@/styles/history.css'

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

function copyText(text: string, message: string): void {
  const { pushToast } = useAppStore.getState()
  const done = (): void => pushToast(message, 'success')
  const fallback = (): void => {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      done()
    } catch {
      pushToast('复制失败，请手动选择文本', 'error')
    }
  }
  navigator.clipboard
    ? navigator.clipboard.writeText(text).then(done).catch(fallback)
    : fallback()
}

export default function StashView(): React.JSX.Element {
  const repo = useAppStore((state) => state.repo)
  const version = useAppStore((state) => state.version)
  const settings = useAppStore((state) => state.settings)
  const refresh = useAppStore((state) => state.refresh)
  const { toast } = useToast()
  const repoPath = repo?.path ?? null

  const stashes = useAsyncData<StashEntry[]>(
    () => (repoPath ? api.stash.list(repoPath) : Promise.resolve([])),
    [repoPath, version]
  )

  const [selected, setSelected] = useState<number | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [dropTarget, setDropTarget] = useState<StashEntry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const diff = useAsyncData<DiffResult | null>(
    () =>
      repoPath && selected !== null
        ? api.diff.stash(repoPath, selected, undefined, {
            context: settings.diffContext,
            ignoreWhitespace: settings.ignoreWhitespace
          })
        : Promise.resolve(null),
    [repoPath, version, selected, settings.diffContext, settings.ignoreWhitespace]
  )

  useEffect(() => {
    const list = stashes.data ?? []
    if (selected !== null && list.some((entry) => entry.index === selected)) return
    setSelected(list[0]?.index ?? null)
  }, [stashes.data, selected])

  const entry = stashes.data?.find((item) => item.index === selected) ?? null
  const clean = repo?.status?.clean ?? true

  /* ------------------------------------------------------------- actions */

  async function saveStash(): Promise<void> {
    if (!repoPath || busy) return
    setBusy('save')
    try {
      const result = await api.stash.save(repoPath, saveMessage.trim(), includeUntracked)
      if (!result.ok) {
        toast(lastLine(result.stderr) || '保存 stash 失败', 'error')
        return
      }
      if (/No local changes to save/i.test(result.output)) {
        setSaveOpen(false)
        await refresh()
        toast('工作区没有改动，没有创建 stash', 'info')
        return
      }
      setSaveOpen(false)
      setSaveMessage('')
      await refresh()
      toast('已保存当前改动为 stash', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function applyStash(target: StashEntry, pop: boolean): Promise<void> {
    if (!repoPath || busy) return
    setBusy(`${pop ? 'pop' : 'apply'}-${target.index}`)
    try {
      const result = pop
        ? await api.stash.pop(repoPath, target.index)
        : await api.stash.apply(repoPath, target.index)
      await refresh()
      if (result.ok) toast(pop ? '已弹出 stash 并应用到工作区' : '已应用 stash 到工作区', 'success')
      else if (result.conflicts && result.conflicts.length > 0) toast('存在冲突，请在 Changes 中解决', 'error')
      else toast(lastLine(result.stderr) || '应用 stash 失败', 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function dropStash(target: StashEntry): Promise<void> {
    if (!repoPath || busy) return
    setBusy(`drop-${target.index}`)
    try {
      const result = await api.stash.drop(repoPath, target.index)
      if (!result.ok) {
        toast(lastLine(result.stderr) || '删除 stash 失败', 'error')
        return
      }
      setDropTarget(null)
      await refresh()
      toast(`已删除 ${target.ref}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  function requestDrop(target: StashEntry): void {
    if (settings.confirmDestructive) setDropTarget(target)
    else void dropStash(target)
  }

  function menuItems(target: StashEntry): MenuItem[] {
    return [
      { id: 'apply', label: '应用到工作区', icon: Archive, disabled: Boolean(busy) },
      { id: 'pop', label: '弹出（应用并删除）', icon: Archive, disabled: Boolean(busy) },
      { id: 'copy', label: '复制 stash 引用', icon: Copy },
      { id: 'sep-1', separator: true },
      { id: 'drop', label: '删除 stash', icon: Trash2, danger: true, disabled: Boolean(busy) }
    ]
  }

  function runEntryAction(target: StashEntry, id: string): void {
    if (id === 'apply') void applyStash(target, false)
    else if (id === 'pop') void applyStash(target, true)
    else if (id === 'drop') requestDrop(target)
    else if (id === 'copy') copyText(target.ref, '已复制 stash 引用')
  }

  if (!repo) {
    return (
      <div className="stash-view">
        <EmptyState art="stash" title="没有打开仓库" desc="打开一个本地仓库后管理 stash。" />
      </div>
    )
  }

  return (
    <div className="stash-view">
      <SplitPane
        initial={400}
        min={320}
        max={640}
        storageKey="stash"
        left={
          <div className="stash-pane">
            <div className="toolbar stash-toolbar">
              <Button
                variant="primary"
                size="sm"
                icon={Archive}
                disabled={clean || Boolean(busy)}
                title={clean ? '工作区没有改动，无法保存 stash' : '保存当前工作区改动'}
                onClick={() => {
                  setSaveMessage('')
                  setSaveOpen(true)
                }}
              >
                保存当前改动
              </Button>
              {clean ? <span className="stash-clean-hint">工作区没有改动</span> : null}
              <span className="stash-count num">{(stashes.data ?? []).length} 个 stash</span>
              <button
                type="button"
                className="arb-iconbtn stash-refresh"
                title="刷新 stash 列表"
                aria-label="刷新 stash 列表"
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} strokeWidth={1.7} className={cn(stashes.loading && 'arb-spin')} />
              </button>
            </div>

            <div className="col-header stash-cols">
              <span>引用</span>
              <span>说明</span>
              <span>分支</span>
              <span>时间</span>
            </div>

            <div className="stash-list scroll-y">
              {stashes.error ? (
                <div className="stash-list-error">
                  <Banner kind="error">{stashes.error}</Banner>
                </div>
              ) : null}
              {stashes.loading && !stashes.data ? <LoadingBlock label="加载 stash…" /> : null}
              {!stashes.loading && (stashes.data ?? []).length === 0 ? (
                <EmptyState
                  className="empty-compact"
                  art="stash"
                  title="没有 stash 记录"
                  desc="保存当前改动后可在这里恢复。"
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={clean}
                      onClick={() => {
                        setSaveMessage('')
                        setSaveOpen(true)
                      }}
                    >
                      保存当前改动
                    </Button>
                  }
                />
              ) : null}

              {(stashes.data ?? []).map((item) => (
                <div
                  key={`${item.ref}:${item.index}`}
                  className={cn('stash-row', selected === item.index && 'is-active')}
                  onClick={() => setSelected(item.index)}
                >
                  <span className="stash-ref mono">{item.ref || `stash@{${item.index}}`}</span>
                  <span className="stash-message truncate" title={item.message}>
                    {item.name || item.message || '(无说明)'}
                  </span>
                  <span className="stash-branch mono truncate" title={item.branch}>
                    {item.branch || '—'}
                  </span>
                  <span className="stash-time num" title={absoluteTime(item.time)}>
                    {relativeTime(item.time)}
                  </span>
                  <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <Menu
                      items={menuItems(item)}
                      onSelect={(id) => runEntryAction(item, id)}
                      align="end"
                      width={210}
                      trigger={<IconButton icon={MoreHorizontal} label="stash 操作" size={22} />}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        }
        right={
          <div className="stash-detail">
            {entry ? (
              <>
                <div className="stash-detail-hd">
                  <span className="stash-detail-ref mono">{entry.ref}</span>
                  <span className="stash-detail-msg truncate" title={entry.message}>
                    {entry.name || entry.message || '(无说明)'}
                  </span>
                  <span className="stash-detail-branch truncate" title={entry.branch}>
                    on {entry.branch || '—'}
                  </span>
                  <span className="stash-detail-time num" title={absoluteTime(entry.time)}>
                    {relativeTime(entry.time)}
                  </span>
                  <span className="stash-detail-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `apply-${entry.index}`}
                      onClick={() => void applyStash(entry, false)}
                    >
                      应用
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `pop-${entry.index}`}
                      onClick={() => void applyStash(entry, true)}
                    >
                      弹出
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `drop-${entry.index}`}
                      onClick={() => requestDrop(entry)}
                    >
                      删除
                    </Button>
                  </span>
                </div>
                <div className="stash-diff">
                  <DiffView diff={diff.data} loading={diff.loading} emptyLabel="这个 stash 没有可显示的差异" />
                </div>
              </>
            ) : (
              <EmptyState
                className="empty-compact"
                art="stash"
                title="选择一个 stash"
                desc="右侧会显示这份改动相对于 HEAD 的差异。"
              />
            )}
          </div>
        }
      />

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="保存当前改动"
        subtitle={`当前分支：${repo.branch ?? 'detached HEAD'}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={busy === 'save'} onClick={() => void saveStash()}>
              保存 stash
            </Button>
          </>
        }
      >
        <TextField
          label="说明"
          autoFocus
          placeholder="留空则由 Git 生成默认说明"
          value={saveMessage}
          onChange={(event) => setSaveMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void saveStash()
          }}
        />
        <Checkbox checked={includeUntracked} onChange={setIncludeUntracked} label="包含未跟踪文件（-u）" />
      </Modal>

      <ConfirmDialog
        open={Boolean(dropTarget)}
        title={dropTarget ? `删除 ${dropTarget.ref}？` : '删除 stash'}
        description={
          dropTarget ? (
            <>
              <strong className="danger-text">删除后这份暂存改动将无法恢复。</strong>
              如果还需要这些改动，请先用“应用”把它们恢复到工作区。
            </>
          ) : (
            ''
          )
        }
        confirmText="删除 stash"
        danger
        loading={busy === `drop-${dropTarget?.index ?? -1}`}
        onConfirm={() => {
          if (dropTarget) void dropStash(dropTarget)
        }}
        onCancel={() => setDropTarget(null)}
      />
    </div>
  )
}

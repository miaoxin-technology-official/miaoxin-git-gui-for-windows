import { useMemo, useState } from 'react'
import { Copy, MoreHorizontal, Plus, RefreshCw, Search, Tag, Trash2, X } from 'lucide-react'
import type { TagInfo } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { absoluteTime, hash7, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { fuzzyFilter } from '@/lib/fuzzy'
import { useAsyncData } from '@/lib/useAsyncData'
import { useAppStore } from '@/store/app'
import { Button, IconButton } from '@/components/ui/Button'
import { TextArea, TextField } from '@/components/ui/Fields'
import { Banner, EmptyState, LoadingBlock, useToast } from '@/components/ui/Feedback'
import { ConfirmDialog, Menu, Modal, type MenuItem } from '@/components/ui/Overlay'
import '@/styles/history.css'

async function copyText(text: string, message: string): Promise<void> {
  const { pushToast } = useAppStore.getState()
  try {
    await navigator.clipboard.writeText(text)
    pushToast(message, 'success')
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      pushToast(message, 'success')
    } catch {
      pushToast('复制失败，请手动选择文本', 'error')
    }
  }
}

export default function TagsView(): React.JSX.Element {
  const repo = useAppStore((state) => state.repo)
  const version = useAppStore((state) => state.version)
  const settings = useAppStore((state) => state.settings)
  const refresh = useAppStore((state) => state.refresh)
  const { toast } = useToast()
  const repoPath = repo?.path ?? null

  const tags = useAsyncData<TagInfo[]>(
    () => (repoPath ? api.tags.list(repoPath) : Promise.resolve([])),
    [repoPath, version]
  )

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ tag: TagInfo; remote: string | null } | null>(null)

  const filtered = useMemo(() => {
    const list = tags.data ?? []
    if (!query.trim()) return list
    return fuzzyFilter(query, list, (tag) => `${tag.name} ${tag.message ?? ''} ${tag.target}`)
  }, [tags.data, query])

  const remotes = repo?.remotes ?? []

  /* ------------------------------------------------------------- actions */

  function requestDelete(tag: TagInfo, remote: string | null): void {
    if (settings.confirmDestructive) {
      setDeleteTarget({ tag, remote })
      return
    }
    void performDelete(tag, remote)
  }

  async function performDelete(tag: TagInfo, remote: string | null): Promise<void> {
    if (!repoPath || busy) return
    setBusy(true)
    try {
      await api.tags.delete(repoPath, tag.name, remote ?? undefined)
      setDeleteTarget(null)
      await refresh()
      toast(remote ? `已删除远程标签 ${tag.name}（${remote}）` : `已删除标签 ${tag.name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function performCreate(): Promise<void> {
    if (!repoPath || busy) return
    const tagName = name.trim()
    if (!tagName) {
      toast('请输入标签名', 'error')
      return
    }
    setBusy(true)
    try {
      await api.tags.create(repoPath, tagName, target.trim() || undefined, message.trim() || undefined)
      setCreateOpen(false)
      setName('')
      setTarget('')
      setMessage('')
      await refresh()
      toast(`已创建标签 ${tagName}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function menuItems(tag: TagInfo): MenuItem[] {
    const items: MenuItem[] = [{ id: 'copy', label: '复制标签名', icon: Copy }, { id: 'sep-1', separator: true }]
    items.push({ id: 'delete-local', label: '删除本地标签', icon: Trash2, danger: true, disabled: Boolean(busy) })
    for (const remote of remotes) {
      items.push({
        id: `delete-remote:${remote.name}`,
        label: `删除远程标签（${remote.name}）`,
        icon: Trash2,
        danger: true,
        disabled: Boolean(busy)
      })
    }
    return items
  }

  function runTagAction(tag: TagInfo, id: string): void {
    if (id === 'copy') {
      void copyText(tag.name, '已复制标签名')
      return
    }
    if (id === 'delete-local') {
      requestDelete(tag, null)
      return
    }
    if (id.startsWith('delete-remote:')) {
      requestDelete(tag, id.slice('delete-remote:'.length))
    }
  }

  /* -------------------------------------------------------------- render */

  if (!repo) {
    return (
      <div className="tags-view">
        <EmptyState art="tags" title="没有打开仓库" desc="打开一个本地仓库后管理标签。" />
      </div>
    )
  }

  return (
    <div className="tags-view">
      <div className="toolbar tags-toolbar">
        <TextField
          size="sm"
          icon={Search}
          className="tags-search"
          placeholder="搜索标签名、说明或 hash"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
        />
        {query ? <IconButton icon={X} label="清空搜索" size={26} onClick={() => setQuery('')} /> : null}
        <span className="tags-count num">{(tags.data ?? []).length} 个标签</span>
        <button
          type="button"
          className="arb-iconbtn tags-refresh"
          title="刷新标签"
          aria-label="刷新标签"
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} strokeWidth={1.7} className={cn(tags.loading && 'arb-spin')} />
        </button>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => {
            setName('')
            setTarget('')
            setMessage('')
            setCreateOpen(true)
          }}
        >
          新建标签
        </Button>
      </div>

      <div className="col-header tags-cols">
        <span>名称</span>
        <span>类型</span>
        <span>目标</span>
        <span>说明</span>
        <span>创建者</span>
        <span>时间</span>
      </div>

      <div className="tags-list scroll-y">
        {tags.error ? (
          <div className="tags-list-error">
            <Banner kind="error">{tags.error}</Banner>
          </div>
        ) : null}
        {tags.loading && !tags.data ? <LoadingBlock label="加载标签…" /> : null}

        {!tags.loading && filtered.length === 0 ? (
          query ? (
            <EmptyState
              className="empty-compact"
              art="search"
              title="没有匹配的标签"
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
              art="tags"
              title="还没有标签"
              desc="标签用于标记发布版本或重要提交。"
              actions={
                <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
                  新建标签
                </Button>
              }
            />
          )
        ) : null}

        {filtered.map((tag) => (
          <div key={tag.name} className="tags-row">
            <span className="tags-name">
              <Tag size={12} strokeWidth={1.7} className="tags-icon" />
              <span className="mono truncate">{tag.name}</span>
            </span>
            <span className={cn('tag-type', tag.annotated ? 'is-annotated' : 'is-light')}>
              {tag.annotated ? 'annotated' : 'lightweight'}
            </span>
            <span className="tags-target mono" title={tag.target}>
              {hash7(tag.target) || '—'}
            </span>
            <span className="tags-message truncate" title={tag.message}>
              {tag.message || '—'}
            </span>
            <span className="tags-tagger truncate" title={tag.tagger}>
              {tag.tagger || '—'}
            </span>
            <span className="tags-time num" title={tag.time ? absoluteTime(tag.time) : undefined}>
              {tag.time ? relativeTime(tag.time) : '—'}
            </span>
            <span className="row-actions" onClick={(event) => event.stopPropagation()}>
              <Menu
                items={menuItems(tag)}
                onSelect={(id) => runTagAction(tag, id)}
                align="end"
                width={220}
                trigger={<IconButton icon={MoreHorizontal} label="标签操作" size={22} />}
              />
            </span>
          </div>
        ))}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建标签"
        subtitle="在指定提交上创建 lightweight 或 annotated 标签"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void performCreate()}>
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
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void performCreate()
          }}
        />
        <TextField
          label="目标提交"
          mono
          placeholder="留空则在 HEAD 上创建"
          hint="可填写完整 hash、短 hash 或分支名。"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
        <TextArea
          label="说明（可选）"
          rows={4}
          placeholder="填写说明后会创建 annotated tag"
          hint="annotated 标签会记录 tagger、创建时间与说明，更适合发布版本。"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.remote
            ? `删除远程标签 ${deleteTarget.tag.name}？`
            : `删除标签 ${deleteTarget?.tag.name ?? ''}？`
        }
        description={
          deleteTarget ? (
            deleteTarget.remote ? (
              <>
                将从远程 <strong>{deleteTarget.remote}</strong> 删除标签{' '}
                <strong>{deleteTarget.tag.name}</strong>，并删除本地同名标签。其他协作者拉取后该标签会消失。
              </>
            ) : (
              <>
                将删除本地标签 <strong>{deleteTarget.tag.name}</strong>。远程仓库中的同名标签不会被删除。
              </>
            )
          ) : (
            ''
          )
        }
        confirmText={deleteTarget?.remote ? '删除远程标签' : '删除标签'}
        danger
        loading={busy}
        onConfirm={() => {
          if (deleteTarget) void performDelete(deleteTarget.tag, deleteTarget.remote)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

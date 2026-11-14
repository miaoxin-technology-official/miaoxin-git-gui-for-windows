// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState } from 'react'
import {
  Copy,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe2,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { BranchInfo } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { absoluteTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { fuzzyFilter } from '@/lib/fuzzy'
import { useAsyncData } from '@/lib/useAsyncData'
import { useAppStore } from '@/store/app'
import { Button, IconButton } from '@/components/ui/Button'
import { Checkbox, TextField } from '@/components/ui/Fields'
import { Banner, EmptyState, LoadingBlock, useToast } from '@/components/ui/Feedback'
import { ConfirmDialog, Menu, Modal, type MenuItem } from '@/components/ui/Overlay'
import '@/styles/branches.css'

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

function remoteParts(branch: BranchInfo): { remote: string; leaf: string } {
  const remote = branch.remote ?? (branch.name.includes('/') ? branch.name.split('/')[0] : 'origin')
  const leaf = branch.name.startsWith(`${remote}/`) ? branch.name.slice(remote.length + 1) : branch.name
  return { remote, leaf }
}

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

export default function BranchesView(): React.JSX.Element {
  const repo = useAppStore((state) => state.repo)
  const version = useAppStore((state) => state.version)
  const settings = useAppStore((state) => state.settings)
  const refresh = useAppStore((state) => state.refresh)
  const { toast } = useToast()
  const repoPath = repo?.path ?? null
  const currentBranch = repo?.branch ?? null

  const branches = useAsyncData<BranchInfo[]>(
    () => (repoPath ? api.branches.list(repoPath) : Promise.resolve([])),
    [repoPath, version]
  )

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createCheckout, setCreateCheckout] = useState(true)
  const [renameTarget, setRenameTarget] = useState<BranchInfo | null>(null)
  const [renameName, setRenameName] = useState('')
  const [upstreamTarget, setUpstreamTarget] = useState<BranchInfo | null>(null)
  const [upstreamValue, setUpstreamValue] = useState('')
  const [mergeTarget, setMergeTarget] = useState<BranchInfo | null>(null)
  const [rebaseTarget, setRebaseTarget] = useState<BranchInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BranchInfo | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    setQuery('')
  }, [repoPath])

  const filtered = useMemo(() => {
    const list = branches.data ?? []
    if (!query.trim()) return list
    return fuzzyFilter(query, list, (branch) => `${branch.name} ${branch.subject} ${branch.author}`)
  }, [branches.data, query])

  const localBranches = useMemo(
    () =>
      filtered
        .filter((branch) => !branch.isRemote)
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.time - a.time),
    [filtered]
  )

  const remoteGroups = useMemo(() => {
    const groups = new Map<string, BranchInfo[]>()
    for (const branch of filtered) {
      if (!branch.isRemote) continue
      const { remote } = remoteParts(branch)
      const list = groups.get(remote)
      if (list) list.push(branch)
      else groups.set(remote, [branch])
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const totalBranches = branches.data?.length ?? 0

  /* ----------------------------------------------------------- internals */

  function suggestedUpstream(branch: BranchInfo): string {
    const remote = repo?.remotes[0]?.name
    return remote ? `${remote}/${branch.name}` : branch.name
  }

  function runBranchAction(branch: BranchInfo, id: string): void {
    switch (id) {
      case 'checkout':
        if (branch.isRemote) void checkoutRemote(branch)
        else void switchBranch(branch)
        return
      case 'rename':
        setRenameTarget(branch)
        setRenameName(branch.name)
        return
      case 'upstream':
        setUpstreamTarget(branch)
        setUpstreamValue(branch.upstream ?? suggestedUpstream(branch))
        return
      case 'merge':
        setMergeTarget(branch)
        return
      case 'rebase':
        setRebaseTarget(branch)
        return
      case 'copy':
        void copyText(branch.name, '已复制分支名')
        return
      case 'delete':
        requestDelete(branch)
        return
      default:
    }
  }

  function branchMenuItems(branch: BranchInfo): MenuItem[] {
    const parts = remoteParts(branch)
    const localExists = branch.isRemote
      ? (branches.data ?? []).some((item) => !item.isRemote && item.name === parts.leaf)
      : false
    if (branch.isRemote) {
      return [
        {
          id: 'checkout',
          label: localExists ? `切换到本地分支 ${parts.leaf}` : '检出为本地分支',
          icon: GitBranch
        },
        { id: 'merge', label: `合并到 ${currentBranch ?? '当前分支'}`, icon: GitMerge },
        { id: 'rebase', label: `将 ${currentBranch ?? '当前分支'} 变基到此分支`, icon: GitPullRequest },
        { id: 'copy', label: '复制分支名', icon: Copy },
        { id: 'sep-1', separator: true },
        { id: 'delete', label: `删除远程分支（${parts.remote}）`, icon: Trash2, danger: true }
      ]
    }
    return [
      { id: 'checkout', label: '切换到此分支', icon: GitBranch, disabled: branch.isCurrent },
      { id: 'rename', label: '重命名…', icon: Pencil },
      { id: 'upstream', label: '设置 upstream…', icon: Link2 },
      { id: 'sep-1', separator: true },
      { id: 'merge', label: `合并到 ${currentBranch ?? '当前分支'}`, icon: GitMerge, disabled: branch.isCurrent },
      {
        id: 'rebase',
        label: `将 ${currentBranch ?? '当前分支'} 变基到 ${branch.name}`,
        icon: GitPullRequest,
        disabled: branch.isCurrent
      },
      { id: 'copy', label: '复制分支名', icon: Copy },
      { id: 'sep-2', separator: true },
      { id: 'delete', label: '删除分支', icon: Trash2, danger: true, disabled: branch.isCurrent }
    ]
  }

  /* ------------------------------------------------------------- actions */

  async function switchBranch(branch: BranchInfo): Promise<void> {
    if (!repoPath || branch.isCurrent || busy) return
    setBusy(true)
    try {
      await api.branches.checkout(repoPath, branch.name)
      await refresh()
      toast(`已切换到 ${branch.name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function checkoutRemote(branch: BranchInfo): Promise<void> {
    if (!repoPath || busy) return
    const { leaf } = remoteParts(branch)
    const existing = (branches.data ?? []).find((item) => !item.isRemote && item.name === leaf)
    setBusy(true)
    try {
      if (existing) {
        await api.branches.checkout(repoPath, existing.name)
        toast(`已切换到 ${existing.name}`, 'success')
      } else {
        await api.branches.create(repoPath, leaf, branch.name, true)
        toast(`已创建并切换到 ${leaf}`, 'success')
      }
      await refresh()
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function performCreate(): Promise<void> {
    if (!repoPath || busy) return
    const name = createName.trim()
    if (!name) {
      toast('请输入分支名', 'error')
      return
    }
    setBusy(true)
    try {
      await api.branches.create(repoPath, name, repo?.branch ?? undefined, createCheckout)
      setCreateOpen(false)
      setCreateName('')
      await refresh()
      toast(createCheckout ? `已创建并切换到 ${name}` : `已创建分支 ${name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function performRename(): Promise<void> {
    if (!repoPath || !renameTarget || busy) return
    const name = renameName.trim()
    if (!name || name === renameTarget.name) {
      setRenameTarget(null)
      return
    }
    setBusy(true)
    try {
      await api.branches.rename(repoPath, renameTarget.name, name)
      setRenameTarget(null)
      await refresh()
      toast(`已重命名为 ${name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function performUpstream(): Promise<void> {
    if (!repoPath || !upstreamTarget || busy) return
    const value = upstreamValue.trim()
    setBusy(true)
    try {
      await api.branches.setUpstream(repoPath, upstreamTarget.name, value || null)
      setUpstreamTarget(null)
      await refresh()
      toast(
        value ? `已将 ${upstreamTarget.name} 的 upstream 设为 ${value}` : `已清除 ${upstreamTarget.name} 的 upstream`,
        'success'
      )
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function performMerge(branch: BranchInfo): Promise<void> {
    if (!repoPath || busy) return
    setBusy(true)
    try {
      const result = await api.branches.merge(repoPath, branch.name)
      setMergeTarget(null)
      await refresh()
      if (result.ok) toast(`已合并 ${branch.name}`, 'success')
      else if (result.conflicts && result.conflicts.length > 0) toast('存在冲突，请在 Changes 中解决', 'error')
      else toast(lastLine(result.stderr) || '合并失败', 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function performRebase(branch: BranchInfo): Promise<void> {
    if (!repoPath || busy) return
    setBusy(true)
    try {
      const result = await api.branches.rebase(repoPath, branch.name)
      setRebaseTarget(null)
      await refresh()
      if (result.ok) toast(`已将 ${currentBranch ?? '当前分支'} 变基到 ${branch.name}`, 'success')
      else if (result.conflicts && result.conflicts.length > 0) toast('存在冲突，请在 Changes 中解决', 'error')
      else toast(lastLine(result.stderr) || '变基失败', 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function requestDelete(branch: BranchInfo): void {
    setDeleteError(null)
    if (!settings.confirmDestructive) {
      void performDelete(branch, false)
      return
    }
    setDeleteTarget(branch)
  }

  async function performDelete(branch: BranchInfo, force: boolean): Promise<void> {
    if (!repoPath || busy) return
    setBusy(true)
    try {
      await api.branches.delete(repoPath, branch.name, !branch.isRemote && force)
      toast(branch.isRemote ? `已删除远程分支 ${branch.name}` : `已删除分支 ${branch.name}`, 'success')
      setDeleteTarget(null)
      setDeleteError(null)
      await refresh()
    } catch (error) {
      if (!force && !branch.isRemote) {
        setDeleteTarget(branch)
        setDeleteError(errorMessage(error))
      } else {
        toast(errorMessage(error), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  function deleteDescription(): React.ReactNode {
    if (!deleteTarget) return ''
    if (deleteTarget.isRemote) {
      const { remote, leaf } = remoteParts(deleteTarget)
      return (
        <>
          将从远程 <strong>{remote}</strong> 删除分支 <strong>{leaf}</strong>，其他协作者拉取后该分支会消失。
          本地的跟踪分支不会被删除，服务器上的提交仍可通过 reflog 找回。
        </>
      )
    }
    if (deleteError) {
      return (
        <>
          <div className="br-delete-error">
            删除 <strong>{deleteTarget.name}</strong> 失败：{deleteError}
          </div>
          <strong className="danger-text">该分支可能包含尚未合并的提交。强制删除会丢失这些提交的历史（reflog 中仍可找回）。</strong>
        </>
      )
    }
    return (
      <>
        将删除本地分支 <strong>{deleteTarget.name}</strong>。未合并的提交会被 Git 拒绝删除，需要再次确认才能强制删除。
      </>
    )
  }

  /* -------------------------------------------------------------- render */

  if (!repo) {
    return (
      <div className="br-view">
        <EmptyState art="branches" title="没有打开仓库" desc="打开一个本地仓库后管理分支。" />
      </div>
    )
  }

  const renderRow = (branch: BranchInfo, remoteGroup: boolean): React.JSX.Element => {
    const parts = remoteParts(branch)
    const name = branch.isRemote ? parts.leaf : branch.name
    return (
      <div
        key={`${branch.isRemote ? 'remote' : 'local'}:${branch.name}`}
        className={cn('br-row', branch.isCurrent && 'is-current')}
        onDoubleClick={() => {
          if (!branch.isCurrent) runBranchAction(branch, 'checkout')
        }}
      >
        <span className="br-name">
          {branch.isCurrent ? <span className="br-head-dot" aria-label="当前分支" /> : <span className="br-dot" />}
          <span className={cn('br-name-text mono truncate', branch.isCurrent && 'is-strong')}>{name}</span>
          {branch.isCurrent ? <span className="br-head-chip">HEAD</span> : null}
        </span>
        <span className="br-upstream mono truncate" title={branch.upstream}>
          {branch.upstream ?? '—'}
        </span>
        <span className="br-track num">
          {branch.ahead > 0 ? <span className="br-ahead">↑{branch.ahead}</span> : null}
          {branch.behind > 0 ? <span className="br-behind">↓{branch.behind}</span> : null}
          {branch.ahead === 0 && branch.behind === 0 ? <span className="subtle">—</span> : null}
        </span>
        <span className="br-subject truncate" title={branch.subject}>
          {branch.subject}
        </span>
        <span className="br-author truncate" title={branch.author}>
          {branch.author}
        </span>
        <span className="br-time num" title={absoluteTime(branch.time)}>
          {relativeTime(branch.time)}
        </span>
        <span className="row-actions" onClick={(event) => event.stopPropagation()}>
          <Menu
            items={branchMenuItems(branch)}
            onSelect={(id) => runBranchAction(branch, id)}
            align="end"
            width={230}
            trigger={
              <IconButton
                icon={MoreHorizontal}
                label={remoteGroup ? '远程分支操作' : '分支操作'}
                size={22}
              />
            }
          />
        </span>
      </div>
    )
  }

  return (
    <div className="br-view">
      <div className="toolbar br-toolbar">
        <TextField
          size="sm"
          icon={Search}
          className="br-search"
          placeholder="搜索分支名、提交或作者"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
        />
        {query ? <IconButton icon={X} label="清空搜索" size={26} onClick={() => setQuery('')} /> : null}
        <span className="br-count num">{totalBranches} 个分支</span>
        <button
          type="button"
          className="arb-iconbtn br-refresh"
          title="刷新分支"
          aria-label="刷新分支"
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} strokeWidth={1.7} className={cn(branches.loading && 'arb-spin')} />
        </button>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => {
            setCreateName('')
            setCreateOpen(true)
          }}
        >
          新建分支
        </Button>
      </div>

      <div className="col-header br-cols">
        <span>分支</span>
        <span>upstream</span>
        <span>同步</span>
        <span>最近提交</span>
        <span>作者</span>
        <span>时间</span>
      </div>

      <div className="br-list scroll-y">
        {branches.error ? (
          <div className="br-list-error">
            <Banner kind="error">{branches.error}</Banner>
          </div>
        ) : null}
        {branches.loading && !branches.data ? <LoadingBlock label="加载分支…" /> : null}

        {!branches.loading && !filtered.length ? (
          query ? (
            <EmptyState
              className="empty-compact"
              art="search"
              title="没有匹配的分支"
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
              art="branches"
              title="没有分支"
              desc="创建第一个分支开始工作。"
            />
          )
        ) : null}

        {localBranches.length > 0 ? (
          <>
            <div className="section-header br-group">
              <span className="br-group-label">
                <GitBranch size={12} strokeWidth={1.7} /> 本地分支
              </span>
              <span className="br-group-count num">{localBranches.length}</span>
            </div>
            {localBranches.map((branch) => renderRow(branch, false))}
          </>
        ) : null}

        {remoteGroups.map(([remote, list]) => (
          <div key={remote}>
            <div className="section-header br-group">
              <span className="br-group-label">
                <Globe2 size={12} strokeWidth={1.7} /> 远程 · {remote}
              </span>
              <span className="br-group-count num">{list.length}</span>
            </div>
            {list.map((branch) => renderRow(branch, true))}
          </div>
        ))}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建分支"
        subtitle={repo.branch ? `从当前分支 ${repo.branch} 创建` : '从当前 HEAD 创建'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void performCreate()}>
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
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void performCreate()
          }}
        />
        <Checkbox checked={createCheckout} onChange={setCreateCheckout} label="创建后切换到新分支" />
      </Modal>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="重命名分支"
        subtitle={renameTarget ? `原名称：${renameTarget.name}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void performRename()}>
              重命名
            </Button>
          </>
        }
      >
        <TextField
          label="新分支名"
          mono
          autoFocus
          value={renameName}
          onChange={(event) => setRenameName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void performRename()
          }}
        />
      </Modal>

      <Modal
        open={Boolean(upstreamTarget)}
        onClose={() => setUpstreamTarget(null)}
        title="设置 upstream"
        subtitle={upstreamTarget ? `${upstreamTarget.name} → 跟踪的远程分支` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUpstreamTarget(null)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void performUpstream()}>
              保存
            </Button>
          </>
        }
      >
        <TextField
          label="upstream"
          mono
          autoFocus
          placeholder="例如 origin/main"
          value={upstreamValue}
          hint="留空并保存会清除 upstream。"
          onChange={(event) => setUpstreamValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void performUpstream()
          }}
        />
        <div className="br-upstream-current">
          当前：{upstreamTarget?.upstream ? <span className="mono">{upstreamTarget.upstream}</span> : '未设置'}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(mergeTarget)}
        title={mergeTarget ? `合并 ${mergeTarget.name} 到 ${currentBranch ?? '当前分支'}？` : '合并分支'}
        description={
          mergeTarget
            ? `会把 ${mergeTarget.name} 的提交合并到当前分支 ${currentBranch ?? ''}。如果存在冲突，需要在 Changes 中解决。`
            : ''
        }
        confirmText="合并"
        loading={busy}
        onConfirm={() => {
          if (mergeTarget) void performMerge(mergeTarget)
        }}
        onCancel={() => setMergeTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(rebaseTarget)}
        title={rebaseTarget ? `将当前分支变基到 ${rebaseTarget.name}？` : '变基'}
        description={
          rebaseTarget
            ? `会把 ${currentBranch ?? '当前分支'} 上尚未共享的提交重新应用到 ${rebaseTarget.name} 之上。变基会改写当前分支的提交 hash，已推送的分支请谨慎操作。`
            : ''
        }
        confirmText="变基"
        loading={busy}
        onConfirm={() => {
          if (rebaseTarget) void performRebase(rebaseTarget)
        }}
        onCancel={() => setRebaseTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteError
            ? `强制删除分支 ${deleteTarget?.name ?? ''}？`
            : deleteTarget?.isRemote
              ? `删除远程分支 ${deleteTarget ? remoteParts(deleteTarget).leaf : ''}？`
              : `删除分支 ${deleteTarget?.name ?? ''}？`
        }
        danger
        confirmText={deleteError ? '强制删除' : deleteTarget?.isRemote ? '删除远程分支' : '删除分支'}
        description={deleteDescription()}
        loading={busy}
        onConfirm={() => {
          if (deleteTarget) void performDelete(deleteTarget, Boolean(deleteError))
        }}
        onCancel={() => {
          setDeleteTarget(null)
          setDeleteError(null)
        }}
      />
    </div>
  )
}

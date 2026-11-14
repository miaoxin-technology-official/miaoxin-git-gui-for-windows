// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import {
  Copy,
  Download,
  ExternalLink,
  GitPullRequest,
  Globe2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
import type { OperationResult, PushOptions, RemoteInfo } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useAsyncData } from '@/lib/useAsyncData'
import { useAppStore } from '@/store/app'
import { Button, IconButton } from '@/components/ui/Button'
import { Checkbox, TextField } from '@/components/ui/Fields'
import { Banner, EmptyState, LoadingBlock, useToast } from '@/components/ui/Feedback'
import { ConfirmDialog, Modal } from '@/components/ui/Overlay'
import { ProgressConsole } from './ProgressConsole'
import { useProgressConsole } from './progress'
import '@/styles/remotes.css'

type RemoteAction = 'fetch' | 'pull' | 'push'

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[lines.length - 1] ?? ''
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

export default function RemotesView(): React.JSX.Element {
  const repo = useAppStore((state) => state.repo)
  const version = useAppStore((state) => state.version)
  const settings = useAppStore((state) => state.settings)
  const refresh = useAppStore((state) => state.refresh)
  const { toast } = useToast()
  const repoPath = repo?.path ?? null

  const remotes = useAsyncData<RemoteInfo[]>(
    () => (repoPath ? api.remotes.list(repoPath) : Promise.resolve([])),
    [repoPath, version]
  )

  const [busy, setBusy] = useState<RemoteAction | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [rebase, setRebase] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [formTarget, setFormTarget] = useState<RemoteInfo | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RemoteInfo | null>(null)

  const progress = useProgressConsole(repoPath, () => {
    void refresh()
  })

  const remoteList = remotes.data ?? []
  const hasRemotes = remoteList.length > 0

  /* ------------------------------------------------------------- actions */

  function pushOptions(): PushOptions {
    const upstream = repo?.upstream ?? null
    const remotes = repo?.remotes ?? []
    const preferred = remotes.some((remote) => remote.name === 'origin') ? 'origin' : remotes[0]?.name
    const remote = upstream?.includes('/') ? upstream.split('/')[0] : preferred
    return {
      remote,
      branch: repo?.branch ?? undefined,
      setUpstream: !upstream
    }
  }

  async function runRemote(action: RemoteAction): Promise<void> {
    if (!repoPath || busy || !repo) return
    if (!hasRemotes) {
      toast('还没有配置远程仓库，请先添加一个远程', 'error')
      return
    }
    if (action === 'push' && !repo.branch) {
      toast('当前处于 detached HEAD，无法推送；请先切换到一个分支', 'error')
      return
    }
    setBusy(action)
    setConsoleOpen(true)

    const options = pushOptions()
    const command =
      action === 'fetch'
        ? '$ git fetch --all'
        : action === 'pull'
          ? `$ git pull${rebase ? ' --rebase' : ''}`
          : `$ git push${!repo.upstream ? ' -u' : ''}${options.remote ? ` ${options.remote}` : ''}${repo.branch ? ` ${repo.branch}` : ''}`
    progress.append('system', command)

    try {
      let result: OperationResult
      if (action === 'fetch') result = await api.remotes.fetch(repoPath, { all: true })
      else if (action === 'pull') result = await api.remotes.pull(repoPath, { rebase })
      else result = await api.remotes.push(repoPath, options)

      await refresh()

      if (result.ok) {
        toast(action === 'fetch' ? '已获取全部远程更新' : action === 'pull' ? '拉取完成' : '推送完成', 'success')
      } else if (result.conflicts && result.conflicts.length > 0) {
        progress.append('system', `存在冲突：${result.conflicts.join(', ')}`)
        toast('存在冲突，请在 Changes 中解决', 'error')
      } else {
        const detail = lastLine(result.stderr) || lastLine(result.output) || '操作失败'
        progress.append('system', `操作失败：${detail}`)
        toast(detail, 'error')
      }
    } catch (error) {
      const message = errorMessage(error)
      progress.append('stderr', message)
      toast(message, 'error')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  function openAdd(): void {
    setFormTarget(null)
    setFormName(remoteList.length === 0 ? 'origin' : '')
    setFormUrl('')
    setFormOpen(true)
  }

  function openEdit(remote: RemoteInfo): void {
    setFormTarget(remote)
    setFormName(remote.name)
    setFormUrl(remote.fetchUrl)
    setFormOpen(true)
  }

  async function saveRemote(): Promise<void> {
    if (!repoPath || modalBusy) return
    const name = formName.trim()
    const url = formUrl.trim()
    if (!name || !url) {
      toast('请填写远程名称和地址', 'error')
      return
    }
    setModalBusy(true)
    try {
      if (formTarget) {
        if (name !== formTarget.name) await api.remotes.rename(repoPath, formTarget.name, name)
        if (url !== formTarget.fetchUrl) await api.remotes.setUrl(repoPath, name, url)
        toast(`已更新远程 ${name}`, 'success')
      } else {
        await api.remotes.add(repoPath, name, url)
        toast(`已添加远程 ${name}`, 'success')
      }
      setFormOpen(false)
      setFormTarget(null)
      await refresh()
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setModalBusy(false)
    }
  }

  async function removeRemote(remote: RemoteInfo): Promise<void> {
    if (!repoPath || modalBusy) return
    setModalBusy(true)
    try {
      await api.remotes.remove(repoPath, remote.name)
      setDeleteTarget(null)
      await refresh()
      toast(`已删除远程 ${remote.name}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setModalBusy(false)
    }
  }

  function openUrl(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      toast('仅支持在浏览器中打开 HTTP(S) 地址', 'info')
      return
    }
    void api.app.openExternal(url).catch((error: unknown) => toast(errorMessage(error), 'error'))
  }

  /* -------------------------------------------------------------- render */

  if (!repo) {
    return (
      <div className="remotes-view">
        <EmptyState art="repo" title="没有打开仓库" desc="打开一个本地仓库后管理远程仓库。" />
      </div>
    )
  }

  const disabled = Boolean(busy)

  return (
    <div className="remotes-view">
      <div className="toolbar remotes-toolbar">
        <Button
          size="sm"
          variant="secondary"
          icon={Download}
          loading={busy === 'fetch'}
          disabled={disabled || !hasRemotes}
          onClick={() => void runRemote('fetch')}
        >
          获取全部
        </Button>
        <span className="toolbar-sep" />
        <Checkbox checked={rebase} onChange={setRebase} label="rebase" />
        <Button
          size="sm"
          variant="secondary"
          icon={GitPullRequest}
          loading={busy === 'pull'}
          disabled={disabled || !hasRemotes || !repo.branch}
          onClick={() => void runRemote('pull')}
        >
          拉取
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Upload}
          loading={busy === 'push'}
          disabled={disabled || !hasRemotes || !repo.branch}
          onClick={() => void runRemote('push')}
        >
          推送
        </Button>
        <span className="remotes-toolbar-spacer" />
        <span className="remotes-toolbar-branch muted truncate">
          {repo.branch ?? 'detached HEAD'}
          {repo.upstream ? ` → ${repo.upstream}` : '（无 upstream，推送时会设置）'}
        </span>
        <button
          type="button"
          className="arb-iconbtn remotes-refresh"
          title="刷新远程"
          aria-label="刷新远程"
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} strokeWidth={1.7} className={cn(remotes.loading && 'arb-spin')} />
        </button>
      </div>

      <div className="remotes-list-hd">
        <span className="remotes-list-title">远程仓库 · {remoteList.length}</span>
        <Button size="sm" variant="ghost" icon={Plus} onClick={openAdd}>
          添加远程
        </Button>
      </div>

      <div className="col-header remotes-cols">
        <span>名称</span>
        <span>地址</span>
        <span className="remotes-col-actions">操作</span>
      </div>

      <div className="remotes-list scroll-y">
        {remotes.error ? (
          <div className="remotes-list-error">
            <Banner kind="error">{remotes.error}</Banner>
          </div>
        ) : null}
        {remotes.loading && !remotes.data ? <LoadingBlock label="加载远程仓库…" /> : null}
        {!remotes.loading && remoteList.length === 0 ? (
          <EmptyState
            className="empty-compact"
            art="repo"
            title="还没有远程仓库"
            desc="添加远程仓库后即可 fetch / pull / push。"
            actions={
              <Button size="sm" variant="secondary" onClick={openAdd}>
                添加远程
              </Button>
            }
          />
        ) : null}

        {remoteList.map((remote) => {
          const pushDiffers = Boolean(remote.pushUrl && remote.pushUrl !== remote.fetchUrl)
          return (
            <div className="remote-row" key={remote.name}>
              <span className="remote-name">
                <Globe2 size={13} strokeWidth={1.7} className="remote-icon" />
                <span className="truncate">{remote.name}</span>
              </span>
              <span className="remote-urls">
                <span className="remote-url mono truncate" title={remote.fetchUrl}>
                  {remote.fetchUrl}
                </span>
                {pushDiffers ? (
                  <span className="remote-push-note mono" title={`push：${remote.pushUrl}`}>
                    push: {remote.pushUrl}
                  </span>
                ) : null}
              </span>
              <span className="remote-actions">
                <IconButton
                  icon={Copy}
                  label="复制 fetch URL"
                  size={22}
                  onClick={() => void copyText(remote.fetchUrl, '已复制 fetch URL')}
                />
                {pushDiffers ? (
                  <IconButton
                    icon={Copy}
                    label="复制 push URL"
                    size={22}
                    onClick={() => void copyText(remote.pushUrl, '已复制 push URL')}
                  />
                ) : null}
                <IconButton
                  icon={ExternalLink}
                  label="在浏览器打开"
                  size={22}
                  onClick={() => openUrl(remote.fetchUrl)}
                />
                <IconButton icon={Pencil} label="编辑远程" size={22} onClick={() => openEdit(remote)} />
                <IconButton
                  icon={Trash2}
                  label="删除远程"
                  size={22}
                  variant="danger"
                  onClick={() => {
                    if (settings.confirmDestructive) setDeleteTarget(remote)
                    else void removeRemote(remote)
                  }}
                />
              </span>
            </div>
          )
        })}
      </div>

      <ProgressConsole
        lines={progress.lines}
        running={progress.running}
        title={progress.title}
        open={consoleOpen}
        onToggle={() => setConsoleOpen((open) => !open)}
        onClear={progress.clear}
      />

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={formTarget ? `编辑远程 ${formTarget.name}` : '添加远程仓库'}
        subtitle={formTarget ? '修改名称或 fetch 地址；不会影响服务器上的仓库。' : '例如 origin'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={modalBusy} onClick={() => void saveRemote()}>
              {formTarget ? '保存' : '添加'}
            </Button>
          </>
        }
      >
        <TextField
          label="名称"
          mono
          autoFocus
          placeholder="origin"
          value={formName}
          onChange={(event) => setFormName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void saveRemote()
          }}
        />
        <TextField
          label="地址"
          mono
          placeholder="https://github.com/owner/repo.git 或 git@github.com:owner/repo.git"
          value={formUrl}
          onChange={(event) => setFormUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void saveRemote()
          }}
        />
        {formTarget && formTarget.pushUrl !== formTarget.fetchUrl ? (
          <div className="remotes-form-hint">
            当前 push URL：<span className="mono">{formTarget.pushUrl}</span>
            <br />
            push URL 与其他 URL 不同，需通过 git remote set-url --push 单独修改。
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `删除远程 ${deleteTarget.name}？` : '删除远程'}
        description={
          deleteTarget
            ? `只会删除本地仓库中的远程配置及其远程分支引用，不会影响服务器上的仓库。之后可以重新添加同名远程。`
            : ''
        }
        confirmText="删除远程"
        danger
        loading={modalBusy}
        onConfirm={() => {
          if (deleteTarget) void removeRemote(deleteTarget)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

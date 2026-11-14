// SPDX-License-Identifier: AGPL-3.0-or-later
import { Clock, FolderGit2, FolderOpen, FolderPlus, GitBranch, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import { useAppStore } from '@/store/app'
import appIcon from '@/assets/app-icon.png'
import { Button, IconButton } from './ui/Button'
import { Modal, Popover } from './ui/Overlay'
import { TextField } from './ui/Fields'
import { useToast } from './ui/Feedback'

export function Welcome(): React.JSX.Element {
  const recent = useAppStore((s) => s.recent)
  const loading = useAppStore((s) => s.loading)
  const pickAndOpen = useAppStore((s) => s.pickAndOpen)
  const openRepo = useAppStore((s) => s.openRepo)
  const setCloneOpen = useAppStore((s) => s.setCloneOpen)
  const setInitOpen = useAppStore((s) => s.setInitOpen)
  const appInfo = useAppStore((s) => s.appInfo)

  return (
    <div className="arb-welcome">
      <div className="arb-welcome-inner">
        <div className="arb-welcome-main">
          <div className="arb-welcome-head">
            <span className="arb-welcome-mark">
              <img src={appIcon} alt="" width={20} height={20} className="arb-welcome-icon" />
            </span>
            <div className="arb-welcome-title">Miaoxin Git GUI</div>
            <div className="arb-welcome-version mono">{appInfo?.version ?? '1.0.0'}</div>
          </div>

          <div className="arb-welcome-actions">
            <Button variant="primary" icon={FolderOpen} onClick={() => void pickAndOpen()} disabled={loading}>
              打开仓库
            </Button>
            <Button icon={FolderGit2} onClick={() => setCloneOpen(true)} disabled={loading}>
              克隆仓库
            </Button>
            <Button variant="ghost" icon={FolderPlus} onClick={() => setInitOpen(true)} disabled={loading}>
              初始化仓库
            </Button>
          </div>

          <section className="arb-recent">
            <div className="arb-recent-hd">
              <span>最近打开</span>
              <span className="arb-recent-count">{recent.length > 0 ? `${recent.length} 个仓库` : ''}</span>
              {loading ? <Loader2 size={12} className="arb-spin" /> : null}
            </div>
            {recent.length === 0 ? (
              <div className="arb-recent-empty">
                <div>还没有打开过仓库。</div>
                <div className="subtle">选择一个本地目录，或从远程克隆一个仓库。</div>
              </div>
            ) : (
              <div className="arb-recent-list">
                {recent.map((entry) => (
                  <div key={entry.path} className="arb-recent-row">
                    <button
                      type="button"
                      className="arb-recent-main"
                      onClick={() => void openRepo(entry.path)}
                      title={entry.path}
                    >
                      <span className="arb-recent-icon">
                        <FolderGit2 size={14} strokeWidth={1.6} />
                      </span>
                      <span className="arb-recent-info">
                        <span className="arb-recent-name">{entry.name}</span>
                        <span className="arb-recent-path mono truncate">{entry.path}</span>
                      </span>
                      <span className="arb-recent-meta">
                        {entry.branch ? (
                          <span className="arb-recent-branch mono">
                            <GitBranch size={10} strokeWidth={2} />
                            {entry.branch}
                          </span>
                        ) : null}
                        <span className="arb-recent-time">
                          <Clock size={10} strokeWidth={1.8} />
                          {relativeTime(Math.floor(entry.lastOpened / 1000))}
                        </span>
                      </span>
                    </button>
                    <RemoveRecent path={entry.path} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="arb-welcome-foot">
            <span>Ctrl+K 命令面板 · Ctrl+, 设置 · Ctrl+R 刷新</span>
            <span className="mono">Git {appInfo?.gitVersion.replace('git version ', '') ?? '—'}</span>
          </div>
        </div>

        <aside className="arb-welcome-side">
          <div className="arb-side-block">
            <div className="arb-side-title">快捷键</div>
            <ul className="arb-side-keys">
              <li>
                <span>命令面板</span>
                <span className="kbd">Ctrl</span>
                <span className="kbd">K</span>
              </li>
              <li>
                <span>切换标签</span>
                <span className="kbd">Ctrl</span>
                <span className="kbd">1–6</span>
              </li>
              <li>
                <span>刷新状态</span>
                <span className="kbd">Ctrl</span>
                <span className="kbd">R</span>
              </li>
              <li>
                <span>设置</span>
                <span className="kbd">Ctrl</span>
                <span className="kbd">,</span>
              </li>
            </ul>
          </div>
          <div className="arb-side-block">
            <div className="arb-side-title">说明</div>
            <p className="arb-side-note">
              所有仓库操作直接调用本机 git，不经过网络服务。支持 UTF-8 / GB18030 / UTF-16
              编码的文本差异显示。
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function RemoveRecent({ path }: { path: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const removeRecent = useAppStore((s) => s.removeRecent)
  return (
    <Popover
      width={180}
      align="end"
      open={open}
      onOpenChange={setOpen}
      trigger={<IconButton icon={X} label="更多" size={20} className="arb-recent-remove" />}
    >
      <div className="arb-menu">
        <button
          type="button"
          className="arb-menu-item"
          onClick={() => {
            setOpen(false)
            void removeRecent(path)
          }}
        >
          <span className="arb-menu-icon" />
          <span className="arb-menu-label">从列表中移除</span>
        </button>
      </div>
    </Popover>
  )
}

export function CloneDialog(): React.JSX.Element {
  const open = useAppStore((s) => s.cloneOpen)
  const setOpen = useAppStore((s) => s.setCloneOpen)
  const cloneRepo = useAppStore((s) => s.cloneRepo)
  const loading = useAppStore((s) => s.loading)
  const [url, setUrl] = useState('')
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  async function pickDirectory(): Promise<void> {
    try {
      const picked = await api.repos.pickDirectory('选择克隆到的目录')
      if (picked) setDir(picked)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  async function submit(): Promise<void> {
    if (!url.trim() || !dir.trim() || busy) return
    setBusy(true)
    const ok = await cloneRepo({ url: url.trim(), dir: dir.trim() })
    setBusy(false)
    if (ok) {
      setOpen(false)
      setUrl('')
      setDir('')
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && setOpen(false)}
      title="克隆仓库"
      subtitle="从 GitHub、GitLab 或其他 Git 服务器获取一个仓库。"
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy || loading}
            disabled={!url.trim() || !dir.trim()}
          >
            克隆
          </Button>
        </>
      }
    >
      <TextField
        label="仓库地址"
        mono
        placeholder="https://github.com/owner/repo.git"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={busy}
        autoFocus
      />
      <TextField
        label="本地目录"
        mono
        placeholder="F:\repos\my-project"
        value={dir}
        onChange={(e) => setDir(e.target.value)}
        disabled={busy}
        trailing={
          <Button size="sm" icon={FolderOpen} onClick={() => void pickDirectory()} disabled={busy}>
            浏览
          </Button>
        }
      />
      {busy ? (
        <div className="arb-clone-progress">
          <Loader2 size={13} className="arb-spin" />
          <span>正在克隆，请稍候…</span>
        </div>
      ) : null}
    </Modal>
  )
}

export function InitDialog(): React.JSX.Element {
  const open = useAppStore((s) => s.initOpen)
  const setOpen = useAppStore((s) => s.setInitOpen)
  const initRepo = useAppStore((s) => s.initRepo)
  const loading = useAppStore((s) => s.loading)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  async function pickDirectory(): Promise<void> {
    try {
      const picked = await api.repos.pickDirectory('选择要初始化的目录')
      if (picked) setDir(picked)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  async function submit(): Promise<void> {
    if (!dir.trim() || busy) return
    setBusy(true)
    const ok = await initRepo(dir.trim())
    setBusy(false)
    if (ok) {
      setOpen(false)
      setDir('')
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && setOpen(false)}
      title="初始化仓库"
      subtitle="在现有目录中执行 git init。"
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy || loading} disabled={!dir.trim()}>
            初始化
          </Button>
        </>
      }
    >
      <TextField
        label="目录"
        mono
        placeholder="F:\repos\new-project"
        value={dir}
        onChange={(e) => setDir(e.target.value)}
        disabled={busy}
        autoFocus
        trailing={
          <Button size="sm" icon={FolderOpen} onClick={() => void pickDirectory()} disabled={busy}>
            浏览
          </Button>
        }
      />
    </Modal>
  )
}

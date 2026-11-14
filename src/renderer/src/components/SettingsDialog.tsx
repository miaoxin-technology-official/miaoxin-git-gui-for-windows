import { useEffect, useState } from 'react'
import { Check, Copy, Info } from 'lucide-react'
import { useAppStore } from '@/store/app'
import { ShortcutHint } from './ShortcutHint'
import { Button } from './ui/Button'
import { Segmented, Select, Switch, TextField } from './ui/Fields'
import { ConfirmDialog, Modal } from './ui/Overlay'
import { useToast } from './ui/Feedback'
import { api, errorMessage } from '@/lib/api'
import type { SshInfo } from '@shared/types'

type Tab = 'appearance' | 'diff' | 'behavior' | 'git' | 'ssh' | 'update' | 'about'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'diff', label: '差异' },
  { id: 'behavior', label: '行为' },
  { id: 'git', label: 'Git' },
  { id: 'ssh', label: 'SSH' },
  { id: 'update', label: '更新' },
  { id: 'about', label: '关于' }
]

function SettingRow({
  title,
  desc,
  children
}: {
  title: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="arb-setting-row">
      <div className="arb-setting-head">
        <div className="arb-setting-label">{title}</div>
        {desc ? <div className="arb-setting-desc">{desc}</div> : null}
      </div>
      <div className="arb-setting-control">{children}</div>
    </div>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const appInfo = useAppStore((s) => s.appInfo)
  const updateInfo = useAppStore((s) => s.updateInfo)
  const updateChecking = useAppStore((s) => s.updateChecking)
  const checkUpdates = useAppStore((s) => s.checkUpdates)
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('appearance')
  const [gitPathDraft, setGitPathDraft] = useState(settings.gitPath ?? '')
  const [copied, setCopied] = useState(false)
  const [sshInfo, setSshInfo] = useState<SshInfo | null>(null)
  const [sshBusy, setSshBusy] = useState<string | null>(null)
  const [sshHost, setSshHost] = useState('github.com')
  const [sshOutput, setSshOutput] = useState('')
  const [sshPub, setSshPub] = useState('')
  const [clearConfirm, setClearConfirm] = useState(false)

  async function copyText(value: string): Promise<void> {
    try {
      await api.app.clipboardWrite(value)
      toast('已复制', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  async function loadSsh(): Promise<void> {
    try {
      setSshInfo(await api.ssh.info())
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  async function generateSshKey(): Promise<void> {
    setSshBusy('generate')
    try {
      const result = await api.ssh.generateKey('id_ed25519')
      setSshPub(result.publicKey)
      await copyText(result.publicKey)
      await loadSsh()
      toast('密钥已生成并复制公钥，请添加到 GitHub/GitLab', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSshBusy(null)
    }
  }

  async function testSsh(): Promise<void> {
    setSshBusy('test')
    setSshOutput('')
    try {
      const result = await api.ssh.test(sshHost)
      setSshOutput(result.output || `退出码 ${result.code}`)
    } catch (error) {
      setSshOutput(errorMessage(error))
    } finally {
      setSshBusy(null)
    }
  }

  useEffect(() => {
    if (open && tab === 'ssh') void loadSsh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  async function copyPath(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('复制失败', 'error')
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="设置"
      subtitle="偏好会保存在本机，并在下次启动时恢复。"
      width={760}
      className="arb-settings-modal"
      footer={
        <>
          <span className="arb-settings-footnote">Miaoxin Git GUI {appInfo?.version ?? '1.0.0'}</span>
          <Button variant="primary" onClick={() => setOpen(false)}>
            完成
          </Button>
        </>
      }
    >
      <div className="arb-settings">
        <nav className="arb-settings-nav">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`arb-settings-nav-item${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="arb-settings-content scroll-y">
          {tab === 'appearance' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">外观</h3>
              <SettingRow title="主题" desc="跟随系统时会随 Windows 的深浅色设置切换。">
                <Segmented
                  value={settings.theme}
                  onChange={(theme) => void setSettings({ theme })}
                  options={[
                    { value: 'dark', label: '深色' },
                    { value: 'light', label: '浅色' },
                    { value: 'system', label: '跟随系统' }
                  ]}
                />
              </SettingRow>
              <SettingRow title="密度">
                <Segmented
                  value={settings.density}
                  onChange={(density) => void setSettings({ density })}
                  options={[
                    { value: 'comfortable', label: '舒适' },
                    { value: 'compact', label: '紧凑' }
                  ]}
                />
              </SettingRow>
              <SettingRow title="界面缩放" desc="调整整个界面的字号与间距。">
                <Segmented
                  size="sm"
                  value={String(settings.uiScale)}
                  onChange={(value) => void setSettings({ uiScale: Number(value) })}
                  options={[
                    { value: '0.9', label: '90%' },
                    { value: '1', label: '100%' },
                    { value: '1.1', label: '110%' },
                    { value: '1.25', label: '125%' }
                  ]}
                />
              </SettingRow>
              <SettingRow title="代码字号" desc="差异与哈希等内容使用的等宽字号。">
                <Segmented
                  size="sm"
                  value={String(settings.codeFontSize)}
                  onChange={(value) => void setSettings({ codeFontSize: Number(value) })}
                  options={[
                    { value: '11', label: '11' },
                    { value: '12', label: '12' },
                    { value: '13', label: '13' },
                    { value: '14', label: '14' }
                  ]}
                />
              </SettingRow>
            </section>
          ) : null}

          {tab === 'diff' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">差异</h3>
              <SettingRow title="默认视图">
                <Segmented
                  value={settings.diffMode}
                  onChange={(diffMode) => void setSettings({ diffMode })}
                  options={[
                    { value: 'split', label: '并排' },
                    { value: 'unified', label: '统一' }
                  ]}
                />
              </SettingRow>
              <SettingRow title="上下文行数" desc="每个改动块前后显示的未改动行数。">
                <Select
                  value={String(settings.diffContext)}
                  onChange={(value) => void setSettings({ diffContext: Number(value) })}
                  options={[
                    { value: '2', label: '2 行' },
                    { value: '3', label: '3 行' },
                    { value: '5', label: '5 行' },
                    { value: '8', label: '8 行' },
                    { value: '12', label: '12 行' }
                  ]}
                />
              </SettingRow>
              <SettingRow title="自动换行">
                <Switch
                  checked={settings.diffWrap}
                  onChange={(diffWrap) => void setSettings({ diffWrap })}
                  label="长行在视图中折行"
                />
              </SettingRow>
              <SettingRow title="忽略空白">
                <Switch
                  checked={settings.ignoreWhitespace}
                  onChange={(ignoreWhitespace) => void setSettings({ ignoreWhitespace })}
                  label="比较时忽略空白字符变化"
                />
              </SettingRow>
            </section>
          ) : null}

          {tab === 'behavior' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">行为</h3>
              <SettingRow title="破坏性操作确认" desc="丢弃改动、硬重置、删除分支等操作前显示确认对话框。">
                <Switch
                  checked={settings.confirmDestructive}
                  onChange={(confirmDestructive) => void setSettings({ confirmDestructive })}
                />
              </SettingRow>
              <SettingRow title="自动获取" desc="应用在前台时，按间隔静默执行 git fetch。">
                <Select
                  value={String(settings.autoFetchMinutes)}
                  onChange={(value) => void setSettings({ autoFetchMinutes: Number(value) })}
                  options={[
                    { value: '0', label: '关闭' },
                    { value: '5', label: '每 5 分钟' },
                    { value: '10', label: '每 10 分钟' },
                    { value: '30', label: '每 30 分钟' }
                  ]}
                />
              </SettingRow>
              <SettingRow title="清空缓存" desc="移除最近打开的仓库、上次打开的仓库与窗口位置记录；不会删除仓库文件、主题和其他设置。">
                <Button size="sm" onClick={() => setClearConfirm(true)}>
                  清空缓存…
                </Button>
              </SettingRow>
              <div className="arb-settings-note">
                <Info size={13} strokeWidth={1.8} />
                Miaoxin Git GUI 不会在后台修改你的仓库；自动获取只会更新远程引用。
              </div>
            </section>
          ) : null}

          {tab === 'git' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">Git</h3>
              <SettingRow title="Git 可执行文件" desc="留空时优先使用系统 Git；未安装系统 Git 时自动使用安装包内置的 Git。">
                <div className="arb-settings-inline">
                  <TextField
                    mono
                    size="sm"
                    placeholder="C:\Program Files\Git\cmd\git.exe"
                    value={gitPathDraft}
                    onChange={(e) => setGitPathDraft(e.target.value)}
                    onBlur={() => {
                      const next = gitPathDraft.trim() || null
                      if (next !== settings.gitPath) void setSettings({ gitPath: next })
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={() => setGitPathDraft('')}>
                    重置
                  </Button>
                </div>
              </SettingRow>
              <SettingRow title="Git 版本">
                <span className="mono muted">{appInfo?.gitVersion ?? '—'}</span>
              </SettingRow>
              <SettingRow title="数据目录" desc="设置、最近仓库与窗口状态保存在这里。">
                <div className="arb-settings-inline">
                  <span className="mono subtle arb-settings-path">{appInfo?.userDataPath ?? '—'}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied ? Check : Copy}
                    onClick={() => void copyPath(appInfo?.userDataPath ?? '')}
                  >
                    {copied ? '已复制' : '复制'}
                  </Button>
                </div>
              </SettingRow>
            </section>
          ) : null}

          {tab === 'ssh' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">SSH</h3>
              <SettingRow title="SSH 目录" desc="应用与右侧终端复用该目录下的 config、密钥和 known_hosts。">
                <div className="arb-settings-inline">
                  <span className="mono subtle arb-settings-path">{sshInfo?.dir ?? '~/.ssh'}</span>
                  <Button size="sm" variant="ghost" onClick={() => void api.ssh.openDir()}>
                    打开目录
                  </Button>
                </div>
              </SettingRow>
              <SettingRow title="现有密钥" desc="私钥文件与对应公钥；公钥需要添加到 GitHub/GitLab 的 SSH Keys 页面。">
                {sshInfo && sshInfo.keys.length > 0 ? (
                  <div className="arb-ssh-keys">
                    {sshInfo.keys.map((key) => (
                      <div className="arb-ssh-key" key={key.privatePath}>
                        <span className="mono arb-ssh-key-name">{key.name}</span>
                        <span className="subtle mono truncate arb-ssh-key-pub">
                          {key.publicKey ?? '未找到公钥文件'}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Copy}
                          disabled={!key.publicKey}
                          onClick={() => void copyText(key.publicKey ?? '')}
                        >
                          复制公钥
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="subtle">尚未发现 SSH 密钥</span>
                )}
              </SettingRow>
              <SettingRow title="生成新密钥" desc="生成 ed25519 密钥到 ~/.ssh/id_ed25519，并自动复制公钥。">
                <Button size="sm" onClick={() => void generateSshKey()} loading={sshBusy === 'generate'}>
                  生成 ed25519 密钥
                </Button>
              </SettingRow>
              {sshPub ? (
                <div className="arb-ssh-generated">
                  <pre className="arb-ssh-output">{sshPub}</pre>
                  <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyText(sshPub)}>
                    复制公钥
                  </Button>
                </div>
              ) : null}
              <SettingRow title="测试连接" desc="首次连接会自动把主机指纹写入 known_hosts。">
                <div className="arb-settings-inline">
                  <Select
                    value={sshHost}
                    onChange={setSshHost}
                    options={[
                      { value: 'github.com', label: 'GitHub (github.com)' },
                      { value: 'gitlab.com', label: 'GitLab (gitlab.com)' },
                      { value: 'bitbucket.org', label: 'Bitbucket (bitbucket.org)' }
                    ]}
                  />
                  <Button size="sm" onClick={() => void testSsh()} loading={sshBusy === 'test'}>
                    测试
                  </Button>
                </div>
              </SettingRow>
              {sshOutput ? <pre className="arb-ssh-output">{sshOutput}</pre> : null}
              <div className="arb-settings-note">
                <Info size={13} strokeWidth={1.8} />
                克隆时使用 SSH 地址（如 git@github.com:owner/repo.git）；已有仓库到「远程」页把 origin 改成 SSH 地址。密钥有口令时，请先加载到 Windows OpenSSH Agent。
              </div>
            </section>
          ) : null}

          {tab === 'update' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">更新</h3>
              <SettingRow title="当前版本">
                <span className="mono muted">{appInfo?.version ?? '—'}</span>
              </SettingRow>
              <SettingRow
                title="最新版本"
                desc={
                  updateInfo?.latestTag
                    ? `最新标签 ${updateInfo.latestTag}${updateInfo.preview ? '（预览体验计划）' : ''}`
                    : '通过 GitHub 仓库 tags 检查最新稳定版本。'
                }
              >
                <span className="mono muted">{updateInfo?.latestVersion ?? '—'}</span>
              </SettingRow>
              <SettingRow title="检查更新" desc="每次启动会自动检查一次；也可手动检查。">
                <div className="arb-settings-inline">
                  {updateInfo?.updateAvailable && updateInfo.latestTag ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void api.updates.openTag(updateInfo.latestTag as string)}
                    >
                      打开发布页
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => void checkUpdates()} loading={updateChecking}>
                    检查更新
                  </Button>
                </div>
              </SettingRow>
              {updateInfo?.error ? (
                <div className="arb-settings-note">
                  <Info size={13} strokeWidth={1.8} />
                  {updateInfo.error}
                </div>
              ) : updateInfo ? (
                <div className="arb-settings-note">
                  <Info size={13} strokeWidth={1.8} />
                  {updateInfo.updateAvailable
                    ? `发现新版本 ${updateInfo.latestVersion ?? updateInfo.latestTag}，可打开发布页下载。`
                    : '当前已是最新版本。'}
                </div>
              ) : null}
              <SettingRow
                title="加入Miaoxin Git GUI预览体验计划"
                desc="勾选后检查更新时也会接收带 -rc 后缀的预发布版本；-beta / -alpha 始终过滤。"
              >
                <Switch
                  checked={settings.previewChannel}
                  onChange={(previewChannel) => void setSettings({ previewChannel })}
                />
              </SettingRow>
              <SettingRow title="诊断日志" desc="启动失败时，可把 main.log 发给开发者定位。">
                <Button size="sm" variant="ghost" onClick={() => void api.app.openLogs()}>
                  打开日志目录
                </Button>
              </SettingRow>
            </section>
          ) : null}

          {tab === 'about' ? (
            <section className="arb-settings-section">
              <h3 className="arb-settings-heading">关于 Miaoxin Git GUI</h3>
              <div className="arb-about-card">
                <div className="arb-about-title">Miaoxin Git GUI {appInfo?.version ?? '1.0.0'}</div>
                <div className="arb-about-desc">
                  面向 Windows 的本地 Git 客户端。仓库操作直接调用本机 git，不经过任何中间服务。
                </div>
                <div className="arb-about-meta">
                  <span>Electron 33 · React 18 · TypeScript</span>
                  <span>{appInfo?.platform === 'win32' ? 'Windows x64' : appInfo?.platform}</span>
                </div>
              </div>
              <div className="arb-settings-kbd">
                <span>命令面板</span>
                <ShortcutHint combo="mod+k" />
                <span>设置</span>
                <ShortcutHint combo="mod+," />
                <span>刷新</span>
                <ShortcutHint combo="mod+r" />
              </div>
            </section>
          ) : null}
        </div>
      </div>
      </Modal>
      <ConfirmDialog
        open={clearConfirm}
        title="清空缓存？"
        description="将移除最近打开的仓库列表、上次打开的仓库记录和窗口位置。不会删除任何仓库文件、提交或应用设置。"
        confirmText="清空"
        danger
        onConfirm={() => {
          void useAppStore.getState().clearCache()
          setClearConfirm(false)
        }}
        onCancel={() => setClearConfirm(false)}
      />
    </>
  )
}



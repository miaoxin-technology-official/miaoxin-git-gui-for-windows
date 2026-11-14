// SPDX-License-Identifier: AGPL-3.0-or-later
import { app, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CH } from '@shared/channels'
import type {
  CloneOptions,
  CommitOptions,
  DiffOptions,
  FetchOptions,
  HunkApplyArgs,
  LogQuery,
  ProgressEvent,
  PullOptions,
  PushOptions,
  Settings,
  ThemeMode
} from '@shared/types'
import { createGitService, type ProgressSink } from './git'
import { logsDir } from './log'
import { store } from './store'
import { applyTheme, effectiveTheme } from './theme'
import { getMainWindow, sendToRenderer } from './window'
import { repoWatcher } from './watcher'
import { terminalManager } from './terminal'
import { checkForUpdates, downloadUpdate, releaseUrl } from './updates'

const git = createGitService()

/* ----------------------------------------------------------------- cache */

const CACHE_SUBDIRS = ['Cache', 'GPUCache', 'Code Cache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'logs']

function dirBytes(dir: string): number {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      try {
        total += entry.isDirectory() ? dirBytes(full) : fs.statSync(full).size
      } catch {
        /* skip locked files */
      }
    }
  } catch {
    return total
  }
  return total
}

function cacheBytes(): number {
  const root = app.getPath('userData')
  return CACHE_SUBDIRS.reduce((sum, name) => sum + dirBytes(path.join(root, name)), 0)
}

function clearAppCache(): void {
  const root = app.getPath('userData')
  for (const name of CACHE_SUBDIRS) {
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true })
    } catch {
      /* locked cache files are harmless */
    }
  }
}

/* -------------------------------------------------------------------- ssh */

function sshDir(): string {
  return path.join(os.homedir(), '.ssh')
}

function sshTool(tool: string): string {
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'git', 'usr', 'bin', tool)
    : path.resolve(__dirname, '../../vendor/git/usr/bin', tool)
  const candidates = [bundled, `C:\\Program Files\\Git\\usr\\bin\\${tool}`, tool]
  for (const candidate of candidates) {
    try {
      if (candidate === tool || fs.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return tool
}

function runCapture(command: string, args: string[], timeoutMs = 20000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let output = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (data: Buffer) => (output += data.toString('utf8')))
    child.stderr.on('data', (data: Buffer) => (output += data.toString('utf8')))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: `无法启动 ${command}：${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
    child.stdin.on('error', () => undefined)
  })
}

function readSshInfo(): { dir: string; config: string | null; keys: Array<{ name: string; privatePath: string; publicKey: string | null }> } {
  const dir = sshDir()
  let config: string | null = null
  try {
    config = fs.readFileSync(path.join(dir, 'config'), 'utf8')
  } catch {
    config = null
  }
  const keys: Array<{ name: string; privatePath: string; publicKey: string | null }> = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const name = entry.name
      if (name.endsWith('.pub') || name === 'known_hosts' || name === 'config' || name.startsWith('known_hosts')) continue
      const privatePath = path.join(dir, name)
      try {
        const head = fs.readFileSync(privatePath, 'utf8').slice(0, 40)
        if (!head.includes('PRIVATE KEY')) continue
      } catch {
        continue
      }
      let publicKey: string | null = null
      try {
        publicKey = fs.readFileSync(`${privatePath}.pub`, 'utf8').trim()
      } catch {
        publicKey = null
      }
      keys.push({ name, privatePath, publicKey })
    }
  } catch {
    /* no ssh dir yet */
  }
  return { dir, config, keys }
}

function handle(channel: string, fn: (...args: any[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => fn(...args))
}

async function openRepo(repoPath: string) {
  const summary = await git.open(repoPath)
  store.addRecent(summary.path, summary.name, summary.branch ?? undefined)
  watchRepo(summary.path)
  return summary
}

function watchRepo(repoPath: string): void {
  repoWatcher.start(repoPath, (event) => sendToRenderer(CH.evtRepoChanged, event))
}

/**
 * Runs a git command with streaming output. The renderer receives one progress
 * event per output line plus a terminal ``done`` event so the console panel can
 * render long-running network operations without blocking the UI.
 */
async function withProgress<T>(repo: string, title: string, run: (sink: ProgressSink) => Promise<T>): Promise<T> {
  const id = randomUUID()
  const emit = (partial: Partial<ProgressEvent>): void => {
    sendToRenderer(CH.evtProgress, {
      id,
      repo,
      title,
      line: '',
      stream: 'system',
      done: false,
      ...partial
    } satisfies ProgressEvent)
  }
  emit({ line: title })
  const sink: ProgressSink = (line, stream) => emit({ line, stream })
  try {
    const result = await run(sink)
    emit({ done: true, code: 0 })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ line: message, stream: 'stderr', done: true, code: 1, error: message })
    throw error
  }
}

function openTerminal(repoPath: string): void {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/d', '/s', '/c', 'start', 'cmd', '/D', repoPath], {
      cwd: repoPath,
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref()
    return
  }
  spawn(process.platform === 'darwin' ? 'open' : 'x-terminal-emulator', [repoPath], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}

export function registerIpc(): void {
  /* ------------------------------------------------------------- app */
  handle(CH.appInfo, async () => ({
    version: app.getVersion(),
    platform: process.platform,
    gitVersion: await git.version(),
    userDataPath: app.getPath('userData'),
    home: app.getPath('home')
  }))

  handle(CH.appSetTheme, (theme: ThemeMode) => {
    store.set({ theme })
    applyTheme()
    sendToRenderer(CH.evtSettingsChanged, store.get())
  })
  handle(CH.appMinimize, () => getMainWindow()?.minimize())
  handle(CH.appToggleMaximize, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle(CH.appClose, () => getMainWindow()?.close())
  handle(CH.appOpenExternal, async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 http(s) 链接')
    await shell.openExternal(url)
  })
  handle(CH.appClipboardWrite, (text: string) => {
    clipboard.writeText(String(text ?? ''))
  })
  handle(CH.appClipboardRead, () => clipboard.readText())
  handle(CH.appOpenLogs, async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    await shell.openPath(logsDir())
  })
  handle(CH.appCacheInfo, () => ({ bytes: cacheBytes(), userData: app.getPath('userData') }))
  handle(CH.appClearCache, () => {
    clearAppCache()
    return { bytes: cacheBytes(), userData: app.getPath('userData') }
  })

  /* -------------------------------------------------------- settings */
  handle(CH.settingsGet, () => store.get())
  handle(CH.settingsSet, (patch: Partial<Settings>) => {
    const next = store.set(patch)
    applyTheme()
    if (patch.theme) nativeTheme.themeSource = patch.theme
    sendToRenderer(CH.evtSettingsChanged, next)
    return next
  })

  /* --------------------------------------------------------------- ssh */
  handle(CH.sshInfo, () => readSshInfo())
  handle(CH.sshGenerate, async (name?: string) => {
    const dir = sshDir()
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const keyName = (name || 'id_ed25519').replace(/[^A-Za-z0-9_.-]/g, '') || 'id_ed25519'
    const privatePath = path.join(dir, keyName)
    if (fs.existsSync(privatePath)) throw new Error(`密钥已存在：${privatePath}`)
    const result = await runCapture(sshTool('ssh-keygen.exe'), [
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      `miaoxin@${os.hostname()}`,
      '-f',
      privatePath
    ])
    if (result.code !== 0) throw new Error(result.output.trim() || '生成 SSH 密钥失败')
    const publicKey = fs.readFileSync(`${privatePath}.pub`, 'utf8').trim()
    return { publicKey, privatePath }
  })
  handle(CH.sshTest, async (host: string) => {
    const target = /^[a-zA-Z0-9._:-]+$/.test(host) ? host : 'github.com'
    const result = await runCapture(sshTool('ssh.exe'), [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=accept-new',
      target
    ])
    const ok = /successfully authenticated|Welcome to GitLab|does not provide shell access/i.test(result.output)
    return { ok, code: result.code, output: result.output.trim() }
  })
  handle(CH.sshOpenDir, async () => {
    fs.mkdirSync(sshDir(), { recursive: true, mode: 0o700 })
    await shell.openPath(sshDir())
  })

  /* ---------------------------------------------------------- updates */
  handle(CH.updatesCheck, () => checkForUpdates(store.get().previewChannel))
  handle(CH.updatesOpenTag, async (tag: string) => {
    if (!tag || typeof tag !== 'string') throw new Error('无效的版本标签')
    await shell.openExternal(releaseUrl(tag))
  })
  handle(CH.updatesDownload, (tag: string) => downloadUpdate(tag))

  /* ------------------------------------------------------------ repos */
  handle(CH.reposOpenDialog, async () => {
    const result = await dialog.showOpenDialog({
      title: '打开 Git 仓库',
      properties: ['openDirectory'],
      buttonLabel: '打开'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openRepo(result.filePaths[0])
  })
  handle(CH.reposPickDirectory, async (title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? '选择目录',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '选择'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  handle(CH.reposOpen, (repoPath: string) => openRepo(path.resolve(repoPath)))
  handle(CH.reposRecent, () => store.get().recent)
  handle(CH.reposRemoveRecent, (repoPath: string) => store.removeRecent(repoPath))

  handle(CH.reposInit, async (repoPath: string) => {
    const summary = await git.init(path.resolve(repoPath))
    store.addRecent(summary.path, summary.name, summary.branch ?? undefined)
    watchRepo(summary.path)
    return summary
  })

  handle(CH.reposClone, async (opts: CloneOptions) => {
    const summary = await withProgress(opts.dir, `克隆 ${opts.url}`, (sink) => git.clone(opts, sink))
    store.addRecent(summary.path, summary.name, summary.branch ?? undefined)
    watchRepo(summary.path)
    return summary
  })

  handle(CH.reposReveal, async (repoPath: string) => {
    await shell.openPath(repoPath)
  })
  handle(CH.reposTerminal, (repoPath: string) => openTerminal(repoPath))
  handle(CH.reposSummary, (repoPath: string) => git.summary(repoPath))
  handle(CH.reposWatch, (repoPath: string) => watchRepo(repoPath))
  handle(CH.reposUnwatch, () => repoWatcher.stop())

  /* ------------------------------------------------------- read APIs */
  handle(CH.status, (repo: string) => git.status(repo))
  handle(CH.log, (repo: string, query?: LogQuery) => git.log(repo, query))
  handle(CH.commitDetail, (repo: string, hash: string) => git.commitDetail(repo, hash))

  handle(CH.diffWorktree, (repo: string, file: string, side: 'staged' | 'unstaged', opts?: DiffOptions) =>
    git.diffWorktree(repo, file, side, opts)
  )
  handle(CH.diffStaged, (repo: string, file?: string, opts?: DiffOptions) => git.diffStaged(repo, file, opts))
  handle(CH.diffCommit, (repo: string, hash: string, file?: string, opts?: DiffOptions) =>
    git.diffCommit(repo, hash, file, opts)
  )
  handle(CH.diffRange, (repo: string, from: string, to: string, file?: string, opts?: DiffOptions) =>
    git.diffRange(repo, from, to, file, opts)
  )
  handle(CH.diffStash, (repo: string, index: number, file?: string, opts?: DiffOptions) =>
    git.diffStash(repo, index, file, opts)
  )

  /* ------------------------------------------------------- mutations */
  handle(CH.stage, (repo: string, files: string[]) => git.stage(repo, files))
  handle(CH.unstage, (repo: string, files: string[]) => git.unstage(repo, files))
  handle(CH.discard, (repo: string, files: string[], side: 'staged' | 'unstaged' | 'untracked') =>
    git.discard(repo, files, side)
  )
  handle(CH.stageAll, (repo: string) => git.stageAll(repo))
  handle(CH.unstageAll, (repo: string) => git.unstageAll(repo))
  handle(CH.applyHunk, (repo: string, args: HunkApplyArgs) => git.applyHunk(repo, args))
  handle(CH.ignore, (repo: string, patterns: string[]) => git.ignore(repo, patterns))
  handle(CH.resolveConflict, (repo: string, file: string, strategy: 'ours' | 'theirs' | 'mark') =>
    git.resolveConflict(repo, file, strategy)
  )
  handle(CH.conflicts, (repo: string) => git.conflicts(repo))
  handle(CH.commit, (repo: string, opts: CommitOptions) => git.commit(repo, opts))

  /* -------------------------------------------------------- branches */
  handle(CH.branchList, (repo: string) => git.branches(repo))
  handle(CH.branchCreate, (repo: string, name: string, startPoint?: string, checkout = false) =>
    git.createBranch(repo, name, startPoint, checkout)
  )
  handle(CH.branchCheckout, (repo: string, name: string) => git.checkoutBranch(repo, name))
  handle(CH.branchRename, (repo: string, oldName: string, newName: string) =>
    git.renameBranch(repo, oldName, newName)
  )
  handle(CH.branchDelete, (repo: string, name: string, force?: boolean) => git.deleteBranch(repo, name, force))
  handle(CH.branchMerge, (repo: string, name: string, opts?: { noFastForward?: boolean; squash?: boolean; message?: string }) =>
    withProgress(repo, `合并 ${name}`, (sink) => git.merge(repo, name, opts))
  )
  handle(CH.branchRebase, (repo: string, onto: string) =>
    withProgress(repo, `变基到 ${onto}`, (sink) => git.rebase(repo, onto))
  )
  handle(CH.branchSetUpstream, (repo: string, branch: string, upstream: string | null) =>
    git.setUpstream(repo, branch, upstream)
  )

  /* --------------------------------------------------------- remotes */
  handle(CH.remoteList, (repo: string) => git.remotes(repo))
  handle(CH.remoteAdd, (repo: string, name: string, url: string) => git.addRemote(repo, name, url))
  handle(CH.remoteRemove, (repo: string, name: string) => git.removeRemote(repo, name))
  handle(CH.remoteRename, (repo: string, oldName: string, newName: string) =>
    git.renameRemote(repo, oldName, newName)
  )
  handle(CH.remoteSetUrl, (repo: string, name: string, url: string) => git.setRemoteUrl(repo, name, url))
  handle(CH.fetch, (repo: string, opts?: FetchOptions) =>
    withProgress(repo, '获取远程更新', (sink) => git.fetch(repo, opts, sink))
  )
  handle(CH.pull, (repo: string, opts?: PullOptions) =>
    withProgress(repo, '拉取远程更新', (sink) => git.pull(repo, opts, sink))
  )
  handle(CH.push, (repo: string, opts?: PushOptions) =>
    withProgress(repo, '推送本地提交', (sink) => git.push(repo, opts, sink))
  )

  /* ----------------------------------------------------------- stash */
  handle(CH.stashList, (repo: string) => git.stashList(repo))
  handle(CH.stashSave, (repo: string, message: string, includeUntracked?: boolean) =>
    git.stashSave(repo, message, includeUntracked)
  )
  handle(CH.stashPop, (repo: string, index: number) => git.stashPop(repo, index))
  handle(CH.stashApply, (repo: string, index: number) => git.stashApply(repo, index))
  handle(CH.stashDrop, (repo: string, index: number) => git.stashDrop(repo, index))

  /* ------------------------------------------------------------ tags */
  handle(CH.tagList, (repo: string) => git.tags(repo))
  handle(CH.tagCreate, (repo: string, name: string, target?: string, message?: string) =>
    git.createTag(repo, name, target, message)
  )
  handle(CH.tagDelete, (repo: string, name: string, remote?: string) => git.deleteTag(repo, name, remote))
  handle(CH.tagPush, (repo: string, name: string, remote?: string) =>
    withProgress(repo, `推送标签 ${name}`, () => git.pushTag(repo, name, remote))
  )
  handle(CH.tagPushAll, (repo: string, remote?: string) =>
    withProgress(repo, '推送全部标签', () => git.pushAllTags(repo, remote))
  )
  handle(CH.tagFetch, (repo: string) => withProgress(repo, '拉取标签', () => git.fetchTags(repo)))

  /* --------------------------------------------------------- history */
  handle(CH.checkoutCommit, (repo: string, hash: string) => git.checkoutCommit(repo, hash))
  handle(CH.reset, (repo: string, hash: string, mode: 'soft' | 'mixed' | 'hard') => git.reset(repo, hash, mode))
  handle(CH.cherryPick, (repo: string, hash: string) =>
    withProgress(repo, '拣选提交', (sink) => git.cherryPick(repo, hash))
  )
  handle(CH.revert, (repo: string, hash: string) =>
    withProgress(repo, '还原提交', (sink) => git.revert(repo, hash))
  )

  /* ------------------------------------------------------- operation */
  handle(CH.operationState, (repo: string) => git.operationState(repo))
  handle(CH.operationContinue, (repo: string) =>
    withProgress(repo, '继续操作', (sink) => git.continueOperation(repo))
  )
  handle(CH.operationAbort, (repo: string) =>
    withProgress(repo, '中止操作', (sink) => git.abortOperation(repo))
  )

  /* ---------------------------------------------------------- terminal */
  handle(CH.terminalStart, (repo: string) => terminalManager.start(repo))
  handle(CH.terminalRun, (command: string) => terminalManager.run(command))
  handle(CH.terminalStop, () => terminalManager.stop())

  nativeTheme.on('updated', () => applyTheme())
  void effectiveTheme()
}

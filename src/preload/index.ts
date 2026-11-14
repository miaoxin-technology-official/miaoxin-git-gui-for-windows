import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/channels'
import type {
  ArborApi,
  CloneOptions,
  CommitOptions,
  DiffOptions,
  FetchOptions,
  HunkApplyArgs,
  LogQuery,
  ProgressEvent,
  PullOptions,
  PushOptions,
  RepoChangeEvent,
  Settings,
  ThemeMode,
  TerminalDataEvent,
  TerminalExitEvent
} from '@shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ArborApi = {
  app: {
    info: () => ipcRenderer.invoke(CH.appInfo),
    setTheme: (theme: ThemeMode) => ipcRenderer.invoke(CH.appSetTheme, theme),
    minimize: () => ipcRenderer.invoke(CH.appMinimize),
    toggleMaximize: () => ipcRenderer.invoke(CH.appToggleMaximize),
    close: () => ipcRenderer.invoke(CH.appClose),
    openExternal: (url: string) => ipcRenderer.invoke(CH.appOpenExternal, url),
    clipboardWrite: (text: string) => ipcRenderer.invoke(CH.appClipboardWrite, text),
    clipboardRead: () => ipcRenderer.invoke(CH.appClipboardRead),
    openLogs: () => ipcRenderer.invoke(CH.appOpenLogs)
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(CH.settingsSet, patch)
  },
  repos: {
    openDialog: () => ipcRenderer.invoke(CH.reposOpenDialog),
    pickDirectory: (title?: string) => ipcRenderer.invoke(CH.reposPickDirectory, title),
    open: (path: string) => ipcRenderer.invoke(CH.reposOpen, path),
    recent: () => ipcRenderer.invoke(CH.reposRecent),
    removeRecent: (path: string) => ipcRenderer.invoke(CH.reposRemoveRecent, path),
    init: (path: string) => ipcRenderer.invoke(CH.reposInit, path),
    clone: (opts: CloneOptions) => ipcRenderer.invoke(CH.reposClone, opts),
    reveal: (path: string) => ipcRenderer.invoke(CH.reposReveal, path),
    terminal: (path: string) => ipcRenderer.invoke(CH.reposTerminal, path),
    summary: (path: string) => ipcRenderer.invoke(CH.reposSummary, path),
    watch: (path: string) => ipcRenderer.invoke(CH.reposWatch, path),
    unwatch: () => ipcRenderer.invoke(CH.reposUnwatch)
  },
  status: (path: string) => ipcRenderer.invoke(CH.status, path),
  log: (path: string, query?: LogQuery) => ipcRenderer.invoke(CH.log, path, query),
  commitDetail: (path: string, hash: string) => ipcRenderer.invoke(CH.commitDetail, path, hash),
  diff: {
    worktree: (path: string, file: string, side: 'staged' | 'unstaged', opts?: DiffOptions) =>
      ipcRenderer.invoke(CH.diffWorktree, path, file, side, opts),
    staged: (path: string, file?: string, opts?: DiffOptions) => ipcRenderer.invoke(CH.diffStaged, path, file, opts),
    commit: (path: string, hash: string, file?: string, opts?: DiffOptions) =>
      ipcRenderer.invoke(CH.diffCommit, path, hash, file, opts),
    range: (path: string, from: string, to: string, file?: string, opts?: DiffOptions) =>
      ipcRenderer.invoke(CH.diffRange, path, from, to, file, opts),
    stash: (path: string, index: number, file?: string, opts?: DiffOptions) =>
      ipcRenderer.invoke(CH.diffStash, path, index, file, opts)
  },
  changes: {
    stage: (path: string, files: string[]) => ipcRenderer.invoke(CH.stage, path, files),
    unstage: (path: string, files: string[]) => ipcRenderer.invoke(CH.unstage, path, files),
    discard: (path: string, files: string[], side: 'staged' | 'unstaged' | 'untracked') =>
      ipcRenderer.invoke(CH.discard, path, files, side),
    stageAll: (path: string) => ipcRenderer.invoke(CH.stageAll, path),
    unstageAll: (path: string) => ipcRenderer.invoke(CH.unstageAll, path),
    applyHunk: (path: string, args: HunkApplyArgs) => ipcRenderer.invoke(CH.applyHunk, path, args),
    ignore: (path: string, patterns: string[]) => ipcRenderer.invoke(CH.ignore, path, patterns),
    resolveConflict: (path: string, file: string, strategy: 'ours' | 'theirs' | 'mark') =>
      ipcRenderer.invoke(CH.resolveConflict, path, file, strategy),
    conflicts: (path: string) => ipcRenderer.invoke(CH.conflicts, path)
  },
  commit: (path: string, opts: CommitOptions) => ipcRenderer.invoke(CH.commit, path, opts),
  branches: {
    list: (path: string) => ipcRenderer.invoke(CH.branchList, path),
    create: (path: string, name: string, startPoint?: string, checkout?: boolean) =>
      ipcRenderer.invoke(CH.branchCreate, path, name, startPoint, checkout),
    checkout: (path: string, name: string) => ipcRenderer.invoke(CH.branchCheckout, path, name),
    rename: (path: string, oldName: string, newName: string) =>
      ipcRenderer.invoke(CH.branchRename, path, oldName, newName),
    delete: (path: string, name: string, force?: boolean) => ipcRenderer.invoke(CH.branchDelete, path, name, force),
    merge: (path: string, name: string, opts?: { noFastForward?: boolean; squash?: boolean; message?: string }) =>
      ipcRenderer.invoke(CH.branchMerge, path, name, opts),
    rebase: (path: string, onto: string) => ipcRenderer.invoke(CH.branchRebase, path, onto),
    setUpstream: (path: string, branch: string, upstream: string | null) =>
      ipcRenderer.invoke(CH.branchSetUpstream, path, branch, upstream)
  },
  remotes: {
    list: (path: string) => ipcRenderer.invoke(CH.remoteList, path),
    add: (path: string, name: string, url: string) => ipcRenderer.invoke(CH.remoteAdd, path, name, url),
    remove: (path: string, name: string) => ipcRenderer.invoke(CH.remoteRemove, path, name),
    rename: (path: string, oldName: string, newName: string) =>
      ipcRenderer.invoke(CH.remoteRename, path, oldName, newName),
    setUrl: (path: string, name: string, url: string) => ipcRenderer.invoke(CH.remoteSetUrl, path, name, url),
    fetch: (path: string, opts?: FetchOptions) => ipcRenderer.invoke(CH.fetch, path, opts),
    pull: (path: string, opts?: PullOptions) => ipcRenderer.invoke(CH.pull, path, opts),
    push: (path: string, opts?: PushOptions) => ipcRenderer.invoke(CH.push, path, opts)
  },
  stash: {
    list: (path: string) => ipcRenderer.invoke(CH.stashList, path),
    save: (path: string, message: string, includeUntracked?: boolean) =>
      ipcRenderer.invoke(CH.stashSave, path, message, includeUntracked),
    pop: (path: string, index: number) => ipcRenderer.invoke(CH.stashPop, path, index),
    apply: (path: string, index: number) => ipcRenderer.invoke(CH.stashApply, path, index),
    drop: (path: string, index: number) => ipcRenderer.invoke(CH.stashDrop, path, index)
  },
  tags: {
    list: (path: string) => ipcRenderer.invoke(CH.tagList, path),
    create: (path: string, name: string, target?: string, message?: string) =>
      ipcRenderer.invoke(CH.tagCreate, path, name, target, message),
    delete: (path: string, name: string, remote?: string) => ipcRenderer.invoke(CH.tagDelete, path, name, remote)
  },
  history: {
    checkoutCommit: (path: string, hash: string) => ipcRenderer.invoke(CH.checkoutCommit, path, hash),
    reset: (path: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
      ipcRenderer.invoke(CH.reset, path, hash, mode),
    cherryPick: (path: string, hash: string) => ipcRenderer.invoke(CH.cherryPick, path, hash),
    revert: (path: string, hash: string) => ipcRenderer.invoke(CH.revert, path, hash),
    createBranch: (path: string, name: string, at: string) => ipcRenderer.invoke(CH.branchCreate, path, name, at),
    createTag: (path: string, name: string, at: string, message?: string) =>
      ipcRenderer.invoke(CH.tagCreate, path, name, at, message)
  },
  operation: {
    state: (path: string) => ipcRenderer.invoke(CH.operationState, path),
    continue: (path: string) => ipcRenderer.invoke(CH.operationContinue, path),
    abort: (path: string) => ipcRenderer.invoke(CH.operationAbort, path)
  },
  terminal: {
    start: (repo: string) => ipcRenderer.invoke(CH.terminalStart, repo),
    run: (command: string) => ipcRenderer.invoke(CH.terminalRun, command),
    stop: () => ipcRenderer.invoke(CH.terminalStop),
    onData: (cb: (event: TerminalDataEvent) => void) => on(CH.evtTerminalData, cb),
    onExit: (cb: (event: TerminalExitEvent) => void) => on(CH.evtTerminalExit, cb)
  },
  ssh: {
    info: () => ipcRenderer.invoke(CH.sshInfo),
    generateKey: (name?: string) => ipcRenderer.invoke(CH.sshGenerate, name),
    test: (host: string) => ipcRenderer.invoke(CH.sshTest, host),
    openDir: () => ipcRenderer.invoke(CH.sshOpenDir)
  },
  updates: {
    check: () => ipcRenderer.invoke(CH.updatesCheck),
    openTag: (tag: string) => ipcRenderer.invoke(CH.updatesOpenTag, tag)
  },
  events: {
    onProgress: (cb: (e: ProgressEvent) => void) => on(CH.evtProgress, cb),
    onRepoChanged: (cb: (e: RepoChangeEvent) => void) => on(CH.evtRepoChanged, cb),
    onSettingsChanged: (cb: (s: Settings) => void) => on(CH.evtSettingsChanged, cb)
  }
}

contextBridge.exposeInMainWorld('arbor', api)

/**
 * Arbor — shared contract between the Electron main process, the preload bridge
 * and the renderer. This file is the single source of truth for every IPC
 * payload. Do not duplicate these shapes elsewhere.
 */

export type RepoPath = string

/* ------------------------------------------------------------------ app */

export interface AppInfo {
  version: string
  platform: string
  gitVersion: string
  userDataPath: string
  home: string
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  latestStable: string | null
  updateAvailable: boolean
  preview: boolean
  totalTags: number
  checkedAt: number
  error?: string
}

export interface RecentRepo {
  path: string
  name: string
  lastOpened: number
  branch?: string
}

export type ThemeMode = 'dark' | 'light' | 'system'

export interface Settings {
  theme: ThemeMode
  density: 'comfortable' | 'compact'
  uiScale: number
  codeFontSize: number
  diffContext: number
  diffMode: 'unified' | 'split'
  diffWrap: boolean
  ignoreWhitespace: boolean
  confirmDestructive: boolean
  autoFetchMinutes: number
  previewChannel: boolean
  gitPath: string | null
  lastRepo: string | null
  recent: RecentRepo[]
  windowBounds: { x?: number; y?: number; width: number; height: number } | null
  sidebarWidth: number
  detailWidth: number
}

/* ---------------------------------------------------------------- repos */

export type OperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am' | 'bisect'

export interface OperationState {
  kind: OperationKind
  detail: string
  conflicts: string[]
  progress?: { current: number; total: number }
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechange'
  | 'modechange'

export type ChangeSide = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatus
  side: ChangeSide
  /** true when this file has an entry in the index */
  tracked: boolean
  additions?: number
  deletions?: number
  binary?: boolean
}

export interface StatusSnapshot {
  files: FileChange[]
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: FileChange[]
  conflicted: FileChange[]
  additions: number
  deletions: number
  clean: boolean
}

export interface RepoSummary {
  path: string
  name: string
  branch: string | null
  detached: boolean
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  remotes: RemoteInfo[]
  operation: OperationState | null
  stashCount: number
  status: StatusSnapshot
}

/* ------------------------------------------------------------------ refs */

export interface RefInfo {
  type: 'branch' | 'remote' | 'tag'
  name: string
  /** present for remote branches, e.g. "origin" */
  remote?: string
}

export interface Signature {
  name: string
  email: string
  /** unix seconds */
  time: number
}

export interface Commit {
  hash: string
  shortHash: string
  parents: string[]
  author: Signature
  committer: Signature
  subject: string
  body: string
  refs: RefInfo[]
}

export interface FileChangeStat {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
}

export interface CommitDetail extends Commit {
  files: FileChangeStat[]
  stats: { files: number; additions: number; deletions: number }
}

export interface LogQuery {
  limit?: number
  skip?: number
  branch?: string
  search?: string
  author?: string
  path?: string
  since?: string
  all?: boolean
  firstParent?: boolean
}

export interface LogResult {
  commits: Commit[]
  hasMore: boolean
}

/* -------------------------------------------------------------- branches */

export interface BranchInfo {
  /** local: "main"; remote: "origin/main" */
  name: string
  fullName: string
  isRemote: boolean
  remote?: string
  isCurrent: boolean
  upstream?: string
  ahead: number
  behind: number
  head: string
  subject: string
  author: string
  time: number
}

export interface TagInfo {
  name: string
  target: string
  annotated: boolean
  message?: string
  tagger?: string
  time?: number
}

export interface StashEntry {
  index: number
  ref: string
  name: string
  branch: string
  message: string
  time: number
}

/* ------------------------------------------------------------------ diff */

export interface DiffOptions {
  context?: number
  ignoreWhitespace?: boolean
  ignoreSpaceAtEol?: boolean
}

export type DiffLineType = 'context' | 'add' | 'del' | 'meta'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  index: number
  /** "@@ -12,7 +12,9 @@ optional section heading" */
  header: string
  section: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath?: string
  status: FileStatus
  binary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
  mode?: { old: string; new: string } | null
  isImage: boolean
  /** Detected text encoding of the file content, e.g. "utf-8" | "gb18030" | "utf-16le". */
  encoding?: string
}

export interface DiffResult {
  files: DiffFile[]
  stats: { files: number; additions: number; deletions: number }
  /** raw patch text, used by the "raw" view and hunk staging */
  raw?: string
}

/* ------------------------------------------------------------- mutations */

export interface CommitOptions {
  message: string
  amend?: boolean
  signoff?: boolean
  allowEmpty?: boolean
}

export interface CommitResult {
  hash: string
  shortHash: string
  subject: string
  stdout: string
}

export interface PushOptions {
  remote?: string
  branch?: string
  setUpstream?: boolean
  force?: 'lease' | 'force' | false
  tags?: boolean
  dryRun?: boolean
}

export interface PullOptions {
  remote?: string
  branch?: string
  rebase?: boolean
  autostash?: boolean
}

export interface FetchOptions {
  remote?: string
  prune?: boolean
  tags?: boolean
  all?: boolean
}

export interface CloneOptions {
  url: string
  dir: string
  recurseSubmodules?: boolean
  depth?: number
}

export interface OperationResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  /** raw output combined, for the console */
  output: string
  conflicts?: string[]
}

export interface ConflictFile {
  path: string
  ours: boolean
  theirs: boolean
  base: boolean
}

/* --------------------------------------------------------------- console */

export interface ProgressEvent {
  id: string
  repo: string
  title: string
  line: string
  stream: 'stdout' | 'stderr' | 'system'
  done: boolean
  code?: number
  error?: string
}

/* --------------------------------------------------------------- terminal */

export interface TerminalInfo {
  shell: string
  cwd: string
  user: string
  host: string
  home: string
}

export interface TerminalDataEvent {
  chunk: string
  stream: 'stdout' | 'stderr' | 'system'
}

export interface TerminalExitEvent {
  code: number | null
}

export interface SshKeyInfo {
  name: string
  privatePath: string
  publicKey: string | null
}

export interface SshInfo {
  dir: string
  config: string | null
  keys: SshKeyInfo[]
}

export interface SshTestResult {
  ok: boolean
  code: number
  output: string
}

/* ---------------------------------------------------------------- events */

export type RepoChangeReason = 'index' | 'refs' | 'head' | 'worktree' | 'external'

export interface RepoChangeEvent {
  repo: string
  reason: RepoChangeReason
}

/* ------------------------------------------------------------------- api */

export interface ArborApi {
  app: {
    info(): Promise<AppInfo>
    setTheme(theme: ThemeMode): Promise<void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    openExternal(url: string): Promise<void>
    clipboardWrite(text: string): Promise<void>
    clipboardRead(): Promise<string>
    openLogs(): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  repos: {
    openDialog(): Promise<RepoSummary | null>
    pickDirectory(title?: string): Promise<string | null>
    open(path: string): Promise<RepoSummary>
    recent(): Promise<RecentRepo[]>
    removeRecent(path: string): Promise<RecentRepo[]>
    init(path: string): Promise<RepoSummary>
    clone(opts: CloneOptions): Promise<RepoSummary>
    reveal(path: string): Promise<void>
    terminal(path: string): Promise<void>
    summary(path: string): Promise<RepoSummary>
    watch(path: string): Promise<void>
    unwatch(): Promise<void>
  }
  status(path: string): Promise<StatusSnapshot>
  log(path: string, query?: LogQuery): Promise<LogResult>
  commitDetail(path: string, hash: string): Promise<CommitDetail>
  diff: {
    worktree(path: string, file: string, side: 'staged' | 'unstaged', opts?: DiffOptions): Promise<DiffResult>
    staged(path: string, file?: string, opts?: DiffOptions): Promise<DiffResult>
    commit(path: string, hash: string, file?: string, opts?: DiffOptions): Promise<DiffResult>
    range(path: string, from: string, to: string, file?: string, opts?: DiffOptions): Promise<DiffResult>
    stash(path: string, index: number, file?: string, opts?: DiffOptions): Promise<DiffResult>
  }
  changes: {
    stage(path: string, files: string[]): Promise<void>
    unstage(path: string, files: string[]): Promise<void>
    discard(path: string, files: string[], side: 'staged' | 'unstaged' | 'untracked'): Promise<void>
    stageAll(path: string): Promise<void>
    unstageAll(path: string): Promise<void>
    applyHunk(path: string, args: HunkApplyArgs): Promise<void>
    ignore(path: string, patterns: string[]): Promise<void>
    resolveConflict(path: string, file: string, strategy: 'ours' | 'theirs' | 'mark'): Promise<void>
    conflicts(path: string): Promise<ConflictFile[]>
  }
  commit(path: string, opts: CommitOptions): Promise<CommitResult>
  branches: {
    list(path: string): Promise<BranchInfo[]>
    create(path: string, name: string, startPoint?: string, checkout?: boolean): Promise<void>
    checkout(path: string, name: string): Promise<void>
    rename(path: string, oldName: string, newName: string): Promise<void>
    delete(path: string, name: string, force?: boolean): Promise<void>
    merge(path: string, name: string, opts?: { noFastForward?: boolean; squash?: boolean; message?: string }): Promise<OperationResult>
    rebase(path: string, onto: string): Promise<OperationResult>
    setUpstream(path: string, branch: string, upstream: string | null): Promise<void>
  }
  remotes: {
    list(path: string): Promise<RemoteInfo[]>
    add(path: string, name: string, url: string): Promise<void>
    remove(path: string, name: string): Promise<void>
    rename(path: string, oldName: string, newName: string): Promise<void>
    setUrl(path: string, name: string, url: string): Promise<void>
    fetch(path: string, opts?: FetchOptions): Promise<OperationResult>
    pull(path: string, opts?: PullOptions): Promise<OperationResult>
    push(path: string, opts?: PushOptions): Promise<OperationResult>
  }
  stash: {
    list(path: string): Promise<StashEntry[]>
    save(path: string, message: string, includeUntracked?: boolean): Promise<OperationResult>
    pop(path: string, index: number): Promise<OperationResult>
    apply(path: string, index: number): Promise<OperationResult>
    drop(path: string, index: number): Promise<OperationResult>
  }
  tags: {
    list(path: string): Promise<TagInfo[]>
    create(path: string, name: string, target?: string, message?: string): Promise<void>
    delete(path: string, name: string, remote?: string): Promise<void>
    push(path: string, name: string, remote?: string): Promise<OperationResult>
    pushAll(path: string, remote?: string): Promise<OperationResult>
    fetch(path: string): Promise<OperationResult>
  }
  history: {
    checkoutCommit(path: string, hash: string): Promise<void>
    reset(path: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>
    cherryPick(path: string, hash: string): Promise<OperationResult>
    revert(path: string, hash: string): Promise<OperationResult>
    createBranch(path: string, name: string, at: string): Promise<void>
    createTag(path: string, name: string, at: string, message?: string): Promise<void>
  }
  operation: {
    state(path: string): Promise<OperationState | null>
    continue(path: string): Promise<OperationResult>
    abort(path: string): Promise<OperationResult>
  }
  terminal: {
    start(repo: string): Promise<TerminalInfo>
    run(command: string): Promise<void>
    stop(): Promise<void>
    onData(cb: (event: TerminalDataEvent) => void): () => void
    onExit(cb: (event: TerminalExitEvent) => void): () => void
  }
  ssh: {
    info(): Promise<SshInfo>
    generateKey(name?: string): Promise<{ publicKey: string; privatePath: string }>
    test(host: string): Promise<SshTestResult>
    openDir(): Promise<void>
  }
  updates: {
    check(): Promise<UpdateCheckResult>
    openTag(tag: string): Promise<void>
  }
  events: {
    onProgress(cb: (e: ProgressEvent) => void): () => void
    onRepoChanged(cb: (e: RepoChangeEvent) => void): () => void
    onSettingsChanged(cb: (s: Settings) => void): () => void
  }
}

export interface HunkApplyArgs {
  file: string
  hunkIndex: number
  /** diff source: staged content or worktree content */
  source: 'staged' | 'unstaged'
  reverse?: boolean
}

import { create } from 'zustand'
import type { AppInfo, CloneOptions, RecentRepo, RepoSummary, Settings, StatusSnapshot, UpdateCheckResult } from '@shared/types'
import { api, errorMessage } from '@/lib/api'

export type Section = 'changes' | 'history' | 'branches' | 'stash' | 'tags' | 'remotes'
export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  density: 'comfortable',
  uiScale: 1,
  codeFontSize: 12,
  diffContext: 3,
  diffMode: 'split',
  diffWrap: false,
  ignoreWhitespace: false,
  confirmDestructive: true,
  autoFetchMinutes: 0,
  previewChannel: false,
  gitPath: null,
  lastRepo: null,
  recent: [],
  windowBounds: null,
  sidebarWidth: 232,
  detailWidth: 420
}

let toastSeq = 0
let refreshTimer: number | null = null

export function applyAppearance(settings: Settings): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.density = settings.density
  root.style.setProperty('--ui-scale', String(settings.uiScale))
  root.style.setProperty('--code-font-size', `${settings.codeFontSize}px`)
}

interface AppState {
  ready: boolean
  appInfo: AppInfo | null
  settings: Settings
  recent: RecentRepo[]
  repo: RepoSummary | null
  status: StatusSnapshot | null
  section: Section
  version: number
  loading: boolean
  refreshing: boolean
  lastRefresh: number
  paletteOpen: boolean
  settingsOpen: boolean
  cloneOpen: boolean
  initOpen: boolean
  sidebarCollapsed: boolean
  terminalOpen: boolean
  updateInfo: UpdateCheckResult | null
  updateChecking: boolean
  lastUpdateCheck: number
  toasts: ToastItem[]

  bootstrap: () => Promise<void>
  openRepo: (path: string, options?: { silent?: boolean }) => Promise<boolean>
  pickAndOpen: () => Promise<void>
  cloneRepo: (opts: CloneOptions) => Promise<boolean>
  initRepo: (path: string) => Promise<boolean>
  removeRecent: (path: string) => Promise<void>
  closeRepo: () => Promise<void>
  refresh: () => Promise<void>
  refreshDebounced: () => void
  setSection: (section: Section) => void
  setSettings: (patch: Partial<Settings>) => Promise<void>
  clearCache: () => Promise<void>
  checkUpdates: (silent?: boolean) => Promise<void>
  setPaletteOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setCloneOpen: (open: boolean) => void
  setInitOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  pushToast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  ready: false,
  appInfo: null,
  settings: DEFAULT_SETTINGS,
  recent: [],
  repo: null,
  status: null,
  section: 'changes',
  version: 0,
  loading: false,
  refreshing: false,
  lastRefresh: 0,
  paletteOpen: false,
  settingsOpen: false,
  cloneOpen: false,
  initOpen: false,
  sidebarCollapsed: false,
  terminalOpen: true,
  updateInfo: null,
  updateChecking: false,
  lastUpdateCheck: 0,
  toasts: [],

  bootstrap: async () => {
    try {
      const [settings, recent, info] = await Promise.all([
        api.settings.get(),
        api.repos.recent(),
        api.app.info()
      ])
      applyAppearance(settings)
      void api.app.setTheme(settings.theme)
      set({ settings, recent, appInfo: info, ready: true })
      if (settings.lastRepo) {
        await get().openRepo(settings.lastRepo, { silent: true })
      }
    } catch (error) {
      set({ ready: true })
      get().pushToast(errorMessage(error), 'error')
    }
  },

  openRepo: async (path, options) => {
    set({ loading: true })
    try {
      const summary = await api.repos.open(path)
      const status = await api.status(summary.path)
      const recent = await api.repos.recent()
      set((state) => ({
        repo: summary,
        status,
        recent,
        loading: false,
        version: state.version + 1,
        lastRefresh: Date.now(),
        section: 'changes'
      }))
      return true
    } catch (error) {
      set({ loading: false })
      if (!options?.silent) get().pushToast(errorMessage(error), 'error')
      return false
    }
  },

  pickAndOpen: async () => {
    try {
      const summary = await api.repos.openDialog()
      if (!summary) return
      const status = await api.status(summary.path)
      const recent = await api.repos.recent()
      set((state) => ({
        repo: summary,
        status,
        recent,
        version: state.version + 1,
        lastRefresh: Date.now(),
        section: 'changes'
      }))
    } catch (error) {
      get().pushToast(errorMessage(error), 'error')
    }
  },

  cloneRepo: async (opts) => {
    set({ loading: true })
    try {
      const summary = await api.repos.clone(opts)
      const status = await api.status(summary.path)
      const recent = await api.repos.recent()
      set((state) => ({
        repo: summary,
        status,
        recent,
        loading: false,
        version: state.version + 1,
        lastRefresh: Date.now(),
        section: 'changes'
      }))
      get().pushToast('仓库已克隆', 'success')
      return true
    } catch (error) {
      set({ loading: false })
      get().pushToast(errorMessage(error), 'error')
      return false
    }
  },

  initRepo: async (path) => {
    set({ loading: true })
    try {
      const summary = await api.repos.init(path)
      const status = await api.status(summary.path)
      const recent = await api.repos.recent()
      set((state) => ({
        repo: summary,
        status,
        recent,
        loading: false,
        version: state.version + 1,
        lastRefresh: Date.now(),
        section: 'changes'
      }))
      get().pushToast('已初始化新的 Git 仓库', 'success')
      return true
    } catch (error) {
      set({ loading: false })
      get().pushToast(errorMessage(error), 'error')
      return false
    }
  },

  removeRecent: async (path) => {
    try {
      const recent = await api.repos.removeRecent(path)
      set({ recent })
    } catch (error) {
      get().pushToast(errorMessage(error), 'error')
    }
  },

  closeRepo: async () => {
    await api.repos.unwatch()
    set({ repo: null, status: null, version: 0, lastRefresh: 0 })
  },

  refresh: async () => {
    const { repo, refreshing } = get()
    if (!repo || refreshing) return
    set({ refreshing: true })
    try {
      const summary = await api.repos.summary(repo.path)
      const status = await api.status(repo.path)
      set((state) => ({
        repo: summary,
        status,
        refreshing: false,
        lastRefresh: Date.now(),
        version: state.version + 1
      }))
    } catch (error) {
      set({ refreshing: false })
      get().pushToast(errorMessage(error), 'error')
    }
  },

  refreshDebounced: () => {
    if (refreshTimer) window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null
      void get().refresh()
    }, 420)
  },

  setSection: (section) => set({ section }),

  setSettings: async (patch) => {
    const optimistic = { ...get().settings, ...patch }
    set({ settings: optimistic })
    applyAppearance(optimistic)
    try {
      const settings = await api.settings.set(patch)
      set({ settings })
      applyAppearance(settings)
      void api.app.setTheme(settings.theme)
    } catch (error) {
      get().pushToast(errorMessage(error), 'error')
    }
  },

  clearCache: async () => {
    try {
      const settings = await api.settings.set({ recent: [], lastRepo: null, windowBounds: null })
      set({ settings, recent: [], lastRefresh: Date.now() })
      window.localStorage.removeItem('arbor.terminalWidth')
      get().pushToast('已清空缓存：最近仓库、上次仓库与窗口位置', 'success')
    } catch (error) {
      get().pushToast(errorMessage(error), 'error')
    }
  },

  checkUpdates: async (silent = false) => {
    if (get().updateChecking) return
    set({ updateChecking: true })
    try {
      const info = await api.updates.check()
      set({ updateInfo: info, updateChecking: false, lastUpdateCheck: Date.now() })
      if (info.error) {
        if (!silent) get().pushToast(info.error, 'error')
        return
      }
      if (info.updateAvailable) {
        get().pushToast(`发现新版本 ${info.latestVersion ?? info.latestTag ?? ''}`, 'info')
      } else if (!silent) {
        get().pushToast('已是最新版本', 'success')
      }
    } catch (error) {
      set({ updateChecking: false })
      if (!silent) get().pushToast(errorMessage(error), 'error')
    }
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCloneOpen: (cloneOpen) => set({ cloneOpen }),
  setInitOpen: (initOpen) => set({ initOpen }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),

  pushToast: (message, kind = 'info') => {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, kind }] }))
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

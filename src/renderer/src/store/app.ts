// SPDX-License-Identifier: AGPL-3.0-or-later
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

export interface NotificationItem {
  id: number
  title: string
  detail?: string
  kind: ToastKind
  time: number
  read: boolean
}

const NOTIFICATION_KEY = 'miaoxin.notifications.v1'

function loadNotifications(): NotificationItem[] {
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as NotificationItem[]
    return Array.isArray(parsed) ? parsed.slice(0, 200) : []
  } catch {
    return []
  }
}

function saveNotifications(items: NotificationItem[]): void {
  try {
    window.localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(items.slice(0, 200)))
  } catch {
    /* storage full: notifications are best-effort */
  }
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
  updateDownloading: boolean
  updateDismissedTag: string | null
  lastUpdateCheck: number
  notifications: NotificationItem[]
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
  downloadUpdate: () => Promise<void>
  dismissUpdate: () => void
  markNotificationsRead: () => void
  clearNotifications: () => void
  setPaletteOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setCloneOpen: (open: boolean) => void
  setInitOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  pushToast: (message: string, kind?: ToastKind, detail?: string) => void
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
  updateDownloading: false,
  updateDismissedTag: window.localStorage.getItem('miaoxin.updateDismissed'),
  lastUpdateCheck: 0,
  notifications: loadNotifications(),
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
      const keys = Object.keys(patch)
      get().pushToast('设置已更新', 'success', `修改项：${keys.join('、') || '无'}`)
    } catch (error) {
      get().pushToast('修改设置失败', 'error', errorMessage(error))
    }
  },

  clearCache: async () => {
    try {
      const [settings] = await Promise.all([
        api.settings.set({ recent: [], lastRepo: null, windowBounds: null }),
        api.app.clearCache()
      ])
      set({ settings, recent: [], lastRefresh: Date.now(), notifications: [] })
      window.localStorage.removeItem('arbor.terminalWidth')
      window.localStorage.removeItem(NOTIFICATION_KEY)
      saveNotifications([])
      get().pushToast('已清空缓存与通知历史', 'success', '最近仓库、窗口位置、界面缓存和通知记录已清除')
    } catch (error) {
      get().pushToast('清空缓存失败', 'error', errorMessage(error))
    }
  },

  checkUpdates: async (silent = false) => {
    if (get().updateChecking) return
    set({ updateChecking: true })
    try {
      const info = await api.updates.check()
      set({ updateInfo: info, updateChecking: false, lastUpdateCheck: Date.now() })
      if (info.error) {
        if (!silent) get().pushToast('检查更新失败', 'error', info.error)
        return
      }
      // Update availability is shown by the dedicated bottom-right card, not a toast.
      if (!info.updateAvailable && !silent) {
        get().pushToast('已是最新版本', 'success', `当前 ${info.currentVersion}`)
      }
    } catch (error) {
      set({ updateChecking: false })
      if (!silent) get().pushToast('检查更新失败', 'error', errorMessage(error))
    }
  },

  downloadUpdate: async () => {
    const info = get().updateInfo
    const tag = info?.latestTag
    if (!tag || get().updateDownloading) return
    set({ updateDownloading: true })
    try {
      const result = await api.updates.download(tag)
      if (!result.ok) {
        get().pushToast('自动更新失败', 'error', result.error ?? '下载或校验失败')
      } else {
        get().pushToast('安装包已通过校验，正在启动安装程序', 'success', result.path ?? '')
        set({ updateDownloading: false })
        return
      }
    } catch (error) {
      get().pushToast('自动更新失败', 'error', errorMessage(error))
    } finally {
      set({ updateDownloading: false })
    }
  },

  dismissUpdate: () => {
    const tag = get().updateInfo?.latestTag
    if (tag) {
      window.localStorage.setItem('miaoxin.updateDismissed', tag)
      set({ updateDismissedTag: tag })
    }
  },

  markNotificationsRead: () => {
    const notifications = get().notifications.map((item) => ({ ...item, read: true }))
    set({ notifications })
    saveNotifications(notifications)
  },

  clearNotifications: () => {
    set({ notifications: [] })
    saveNotifications([])
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCloneOpen: (cloneOpen) => set({ cloneOpen }),
  setInitOpen: (initOpen) => set({ initOpen }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),

  pushToast: (message, kind = 'info', detail) => {
    const id = ++toastSeq
    set((state) => {
      const items: NotificationItem[] = [
        { id, title: message, detail, kind, time: Date.now(), read: false },
        ...state.notifications
      ].slice(0, 200)
      saveNotifications(items)
      return {
        notifications: items,
        toasts: [...state.toasts.slice(-3), { id, message, kind }]
      }
    })
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

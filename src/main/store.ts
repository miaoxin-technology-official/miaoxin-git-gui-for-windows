import { app, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RecentRepo, Settings } from '@shared/types'

const DEFAULTS: Settings = {
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

const MAX_RECENT = 12

class SettingsStore {
  private cached: Settings | null = null

  private get file(): string {
    return path.join(app.getPath('userData'), 'settings.json')
  }

  get(): Settings {
    if (this.cached) return this.cached
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Settings>
      this.cached = { ...DEFAULTS, ...parsed, recent: Array.isArray(parsed.recent) ? parsed.recent : [] }
    } catch {
      this.cached = { ...DEFAULTS }
    }
    return this.cached
  }

  set(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.get(), ...patch }
    this.cached = next
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8')
    } catch {
      /* settings persistence must never crash the app */
    }
    return next
  }

  addRecent(repoPath: string, name: string, branch?: string): RecentRepo[] {
    const settings = this.get()
    const entry: RecentRepo = { path: repoPath, name, lastOpened: Date.now(), branch }
    const recent = [entry, ...settings.recent.filter((r) => r.path !== repoPath)].slice(0, MAX_RECENT)
    this.set({ recent, lastRepo: repoPath })
    return recent
  }

  removeRecent(repoPath: string): RecentRepo[] {
    const recent = this.get().recent.filter((r) => r.path !== repoPath)
    this.set({ recent })
    return recent
  }

  resolveTheme(): 'dark' | 'light' {
    const mode = this.get().theme
    if (mode === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    return mode
  }
}

export const store = new SettingsStore()
export const defaultSettings = DEFAULTS

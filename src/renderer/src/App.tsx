import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { api } from './lib/api'
import { applyAppearance, useAppStore, type Section } from './store/app'
import { TerminalPanel } from './components/TerminalPanel'
import appIcon from './assets/app-icon.png'
import { TitleBar } from './components/TitleBar'
import { TabBar } from './components/TabBar'
import { StatusBar } from './components/StatusBar'
import { OperationBanner } from './components/OperationBanner'
import { Welcome, CloneDialog, InitDialog } from './components/Welcome'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/SettingsDialog'
import { Spinner, Toaster } from './components/ui/Feedback'
import { useHotkeys } from './lib/useHotkeys'

const ChangesView = lazy(() => import('./features/changes/ChangesView'))
const HistoryView = lazy(() => import('./features/history/HistoryView'))
const BranchesView = lazy(() => import('./features/branches/BranchesView'))
const StashView = lazy(() => import('./features/stash/StashView'))
const TagsView = lazy(() => import('./features/tags/TagsView'))
const RemotesView = lazy(() => import('./features/remotes/RemotesView'))

const VIEWS: Record<Section, ComponentType> = {
  changes: ChangesView,
  history: HistoryView,
  branches: BranchesView,
  stash: StashView,
  tags: TagsView,
  remotes: RemotesView
}

interface ArborTestHook {
  openRepo: (path: string) => Promise<boolean>
  setSection: (section: Section) => void
  setTheme: (theme: 'dark' | 'light' | 'system') => Promise<void>
  setPalette: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setDensity: (density: 'comfortable' | 'compact') => Promise<void>
  waitReady: () => Promise<void>
}

declare global {
  interface Window {
    __arborTest?: ArborTestHook
    __miaoxinTest?: ArborTestHook
  }
}

function BootScreen(): React.JSX.Element {
  return (
    <div className="arb-boot">
      <img src={appIcon} alt="" width={22} height={22} className="arb-boot-icon" />
      <span className="arb-boot-label">正在启动</span>
      <Spinner size={12} />
    </div>
  )
}

export default function App(): React.JSX.Element {
  const ready = useAppStore((s) => s.ready)
  const repo = useAppStore((s) => s.repo)
  const section = useAppStore((s) => s.section)
  const settings = useAppStore((s) => s.settings)
  const terminalOpen = useAppStore((s) => s.terminalOpen)
  const [terminalWidth, setTerminalWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('arbor.terminalWidth'))
    if (Number.isFinite(saved) && saved >= 300) return Math.min(760, saved)
    return Math.max(320, Math.round(window.innerWidth * 0.33))
  })
  const SectionView = VIEWS[section]
  const updateCheckedRef = useRef(false)

  useEffect(() => {
    if (!ready || updateCheckedRef.current) return
    updateCheckedRef.current = true
    void useAppStore.getState().checkUpdates(true)
  }, [ready])

  useEffect(() => {
    window.localStorage.setItem('arbor.terminalWidth', String(terminalWidth))
  }, [terminalWidth])

  useEffect(() => {
    void useAppStore.getState().bootstrap()

    const offRepo = api.events.onRepoChanged((event) => {
      const current = useAppStore.getState().repo
      if (current && event.repo.toLowerCase() === current.path.toLowerCase()) {
        useAppStore.getState().refreshDebounced()
      }
    })
    const offSettings = api.events.onSettingsChanged((next) => {
      useAppStore.setState({ settings: next })
      applyAppearance(next)
    })

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSchemeChange = (): void => applyAppearance(useAppStore.getState().settings)
    media.addEventListener('change', onSchemeChange)

    window.__arborTest = {
      openRepo: (path) => useAppStore.getState().openRepo(path),
      setSection: (target) => useAppStore.getState().setSection(target),
      setTheme: (theme) => useAppStore.getState().setSettings({ theme }),
      setPalette: (open) => useAppStore.getState().setPaletteOpen(open),
      setSettingsOpen: (open) => useAppStore.getState().setSettingsOpen(open),
      setDensity: (density) => useAppStore.getState().setSettings({ density }),
      waitReady: () =>
        new Promise<void>((resolve) => {
          const check = (): void => {
            if (useAppStore.getState().ready) resolve()
            else window.setTimeout(check, 80)
          }
          check()
        })
    }
    window.__miaoxinTest = window.__arborTest

    return () => {
      offRepo()
      offSettings()
      media.removeEventListener('change', onSchemeChange)
    }
  }, [])

  useEffect(() => {
    const minutes = settings.autoFetchMinutes
    if (!repo || !minutes) return
    const timer = window.setInterval(() => {
      void api.remotes
        .fetch(repo.path)
        .then((result) => {
          if (result.ok) void useAppStore.getState().refresh()
        })
        .catch(() => undefined)
    }, minutes * 60_000)
    return () => window.clearInterval(timer)
  }, [repo, settings.autoFetchMinutes])

  useHotkeys({
    'mod+k': () => useAppStore.getState().setPaletteOpen(!useAppStore.getState().paletteOpen),
    'mod+,': () => useAppStore.getState().setSettingsOpen(true),
    'mod+r': () => void useAppStore.getState().refresh(),
    'mod+1': () => useAppStore.getState().setSection('changes'),
    'mod+2': () => useAppStore.getState().setSection('history'),
    'mod+3': () => useAppStore.getState().setSection('branches'),
    'mod+4': () => useAppStore.getState().setSection('stash'),
    'mod+5': () => useAppStore.getState().setSection('tags'),
    'mod+6': () => useAppStore.getState().setSection('remotes'),
    'mod+`': () => useAppStore.getState().toggleTerminal(),
    escape: () => {
      const state = useAppStore.getState()
      if (state.paletteOpen) state.setPaletteOpen(false)
      else if (state.settingsOpen) state.setSettingsOpen(false)
      else if (state.cloneOpen) state.setCloneOpen(false)
      else if (state.initOpen) state.setInitOpen(false)
    }
  })

  if (!ready) return <BootScreen />

  return (
    <div className="arb-app">
      <TitleBar />
      {repo ? <TabBar /> : null}
      <div className="arb-body">
        {repo ? (
          <>
            <main className="arb-main">
              <OperationBanner />
              <Suspense
                fallback={
                  <div className="section-loading">
                    <Spinner size={16} />
                  </div>
                }
              >
                <SectionView />
              </Suspense>
            </main>
            <TerminalPanel
              width={terminalWidth}
              open={terminalOpen}
              onResize={setTerminalWidth}
              onCollapse={() => useAppStore.getState().toggleTerminal()}
            />
          </>
        ) : (
          <Welcome />
        )}
      </div>
      <StatusBar />
      <CommandPalette />
      <SettingsDialog />
      <CloneDialog />
      <InitDialog />
      <Toaster />
    </div>
  )
}

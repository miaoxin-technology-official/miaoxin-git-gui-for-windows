// SPDX-License-Identifier: AGPL-3.0-or-later
import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { CH } from '@shared/channels'
import { registerIpc } from './ipc'
import { logError, startupSummary } from './log'
import { setPendingOpenPath } from './open-path'
import { store } from './store'
import { terminalManager } from './terminal'
import { applyTheme, titleBarColors, TITLEBAR_HEIGHT } from './theme'
import { repoWatcher } from './watcher'
import { getMainWindow, setMainWindow } from './window'

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

// Software rendering avoids GPU-process startup hangs on machines with old or
// broken graphics drivers. The UI is text-heavy and does not need GPU compositing.
app.disableHardwareAcceleration()

// Broken pipes (terminal closed mid-write, git exiting early) are expected
// lifecycle events, not fatal errors. Everything is written to the app log so
// startup problems on other machines can be diagnosed.
process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  logError('uncaughtException', error)
  if (error && (error.code === 'EPIPE' || error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_DESTROYED')) {
    return
  }
})
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason)
})

function appIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [path.join(__dirname, '../../build/icon.png')]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

/** First existing directory argument passed by Explorer / the shell context menu. */
function cliRepoPath(argv: string[]): string | null {
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--open') {
      const next = argv[index + 1]
      if (next && !next.startsWith('-')) {
        try {
          const resolved = path.resolve(next)
          if (fs.statSync(resolved).isDirectory()) return resolved
        } catch {
          /* ignore */
        }
      }
      continue
    }
    if (arg.startsWith('-')) continue
    try {
      const resolved = path.resolve(arg)
      if (fs.statSync(resolved).isDirectory()) return resolved
    } catch {
      /* ignore */
    }
  }
  return null
}

const startupRepo = isDev ? null : cliRepoPath(process.argv)
if (startupRepo) setPendingOpenPath(startupRepo)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('Miaoxin Git GUI')
  app.setAppUserModelId('com.miaoxin.gitgui')
  let createWindowRef: (() => BrowserWindow) | null = null

  app.on('second-instance', (_event, argv) => {
    const target = cliRepoPath(argv)
    if (target) {
      setPendingOpenPath(target)
      const current = getMainWindow()
      if (current && !current.isDestroyed()) current.webContents.send(CH.evtOpenPath, target)
    }
    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      createWindowRef?.()
      return
    }
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  })

  function startupBounds(saved: {
    x?: number
    y?: number
    width: number
    height: number
  } | null): { x?: number; y?: number; width: number; height: number } {
    const fallback = { width: 1400, height: 900 }
    if (!saved) return fallback
    const width = Math.max(1000, Math.min(saved.width, 3840))
    const height = Math.max(640, Math.min(saved.height, 2160))
    try {
      const visible = screen.getAllDisplays().some((display) => {
        const area = display.workArea
        const x = saved.x ?? 0
        const y = saved.y ?? 0
        return x + 240 > area.x && x < area.x + area.width - 240 && y + 120 > area.y && y < area.y + area.height - 120
      })
      if (!visible) return { width, height }
    } catch {
      return { width, height }
    }
    return { x: saved.x, y: saved.y, width, height }
  }

  function createWindow(): BrowserWindow {
    const bounds = startupBounds(store.get().windowBounds)
    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 1000,
      minHeight: 640,
      show: false,
      title: 'Miaoxin Git GUI',
      icon: appIconPath(),
      backgroundColor: titleBarColors().color,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...titleBarColors(), height: TITLEBAR_HEIGHT },
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    })

    win.once('ready-to-show', () => win.show())
    const showFallback = setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    }, 4000)
    win.once('ready-to-show', () => clearTimeout(showFallback))

    let recovered = false
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      logError('did-fail-load', new Error(`${code} ${description} ${url}`))
      if (!recovered && !win.isDestroyed()) {
        recovered = true
        setTimeout(() => {
          if (!win.isDestroyed()) void win.loadFile(path.join(__dirname, '../renderer/index.html'))
        }, 600)
      }
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      logError('render-process-gone', new Error(`${details.reason} exitCode=${details.exitCode}`))
      if (!recovered && !win.isDestroyed()) {
        recovered = true
        setTimeout(() => {
          if (!win.isDestroyed()) win.webContents.reload()
        }, 600)
      }
    })
    win.on('closed', () => {
      if (getMainWindow() === win) setMainWindow(null)
    })

    win.on('close', () => {
      if (!win.isMaximized() && !win.isFullScreen()) {
        store.set({
          windowBounds: {
            x: win.getBounds().x,
            y: win.getBounds().y,
            width: win.getBounds().width,
            height: win.getBounds().height
          }
        })
      }
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      if (url !== win.webContents.getURL()) event.preventDefault()
    })

    if (isDev) {
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
          win.webContents.toggleDevTools()
        }
      })
    }

    setMainWindow(win)
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void win
        .loadFile(path.join(__dirname, '../renderer/index.html'))
        .catch((error) => logError('loadFile', error))
    }
    return win
  }

  createWindowRef = createWindow

  app.whenReady().then(() => {
    startupSummary()
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindowRef?.()
    applyTheme()

    app.on('child-process-gone', (_event, details) => {
      logError('child-process-gone', new Error(`${details.type} ${details.reason} exitCode=${details.exitCode}`))
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindowRef?.()
    })
  })

  app.on('before-quit', () => {
    terminalManager.stop()
    repoWatcher.stop()
  })

  app.on('will-quit', () => {
    terminalManager.stop()
    repoWatcher.stop()
    // Guarantee the main process and its Chromium helpers do not linger if a
    // child (terminal shell / git) refuses to exit.
    setTimeout(() => {
      try {
        process.exit(0)
      } catch {
        /* ignore */
      }
    }, 1200).unref()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      terminalManager.stop()
      repoWatcher.stop()
      app.quit()
      setTimeout(() => {
        try {
          app.exit(0)
        } catch {
          /* ignore */
        }
      }, 2500).unref()
    }
  })
}


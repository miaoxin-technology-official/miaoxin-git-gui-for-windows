// SPDX-License-Identifier: AGPL-3.0-or-later
import { app, BrowserWindow, Menu, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerIpc } from './ipc'
import { logError, startupSummary } from './log'
import { store } from './store'
import { applyTheme, titleBarColors, TITLEBAR_HEIGHT } from './theme'
import { getMainWindow, setMainWindow } from './window'

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('Miaoxin Git GUI')
  app.setAppUserModelId('com.miaoxin.gitgui')
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  function createWindow(): BrowserWindow {
    const saved = store.get().windowBounds
    const bounds = saved ?? { width: 1400, height: 900 }
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

    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      logError('did-fail-load', new Error(`${code} ${description} ${url}`))
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      logError('render-process-gone', new Error(`${details.reason} exitCode=${details.exitCode}`))
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
      void win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
    return win
  }

  app.whenReady().then(() => {
    startupSummary()
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindow()
    applyTheme()

    app.on('child-process-gone', (_event, details) => {
      logError('child-process-gone', new Error(`${details.type} ${details.reason} exitCode=${details.exitCode}`))
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}


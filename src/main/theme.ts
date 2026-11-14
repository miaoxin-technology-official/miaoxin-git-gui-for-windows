import { nativeTheme } from 'electron'
import { store } from './store'
import { getMainWindow } from './window'

const TITLEBAR_HEIGHT = 34

const OVERLAY = {
  dark: { color: '#151412', symbolColor: '#8d8679' },
  light: { color: '#f7f4ed', symbolColor: '#6b6457' }
}

const BACKGROUND = {
  dark: '#11100f',
  light: '#f2efe7'
}

export function effectiveTheme(): 'dark' | 'light' {
  return store.resolveTheme()
}

export function applyTheme(): void {
  const mode = store.get().theme
  nativeTheme.themeSource = mode
  const theme = store.resolveTheme()
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.setBackgroundColor(BACKGROUND[theme])
  if (process.platform === 'win32') {
    try {
      win.setTitleBarOverlay({ ...OVERLAY[theme], height: TITLEBAR_HEIGHT })
    } catch {
      /* overlay unavailable on older shells */
    }
  }
}

export function titleBarColors(): { color: string; symbolColor: string } {
  return OVERLAY[effectiveTheme()]
}

export { TITLEBAR_HEIGHT }

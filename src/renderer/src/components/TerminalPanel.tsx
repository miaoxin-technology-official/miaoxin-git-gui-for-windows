// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ClipboardPaste, Copy, PanelRightClose, RotateCw, SquareTerminal, Trash2 } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/store/app'
import { IconButton } from './ui/Button'
import '@/styles/terminal.css'

const MARKER = '\x1eARBOR_PROMPT\x1e'

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function buildTheme(): ITheme {
  const bg = readVar('--bg-panel') || '#181715'
  const fg = readVar('--text') || '#e9e4d9'
  const accent = readVar('--accent') || '#c4763f'
  const selection = readVar('--bg-active') || '#26231f'
  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: selection,
    black: readVar('--bg-inset') || '#0d0c0b',
    red: readVar('--red') || '#c4584f',
    green: readVar('--green') || '#7ba05b',
    yellow: readVar('--amber') || '#c9a227',
    blue: readVar('--blue') || '#7c95b8',
    magenta: readVar('--violet') || '#9c7ba0',
    cyan: readVar('--graph-6') || '#5f8c7d',
    white: readVar('--text-2') || '#a9a296',
    brightBlack: readVar('--text-3') || '#756f64',
    brightRed: readVar('--red') || '#c4584f',
    brightGreen: readVar('--green') || '#7ba05b',
    brightYellow: readVar('--amber') || '#c9a227',
    brightBlue: readVar('--blue') || '#7c95b8',
    brightMagenta: readVar('--violet') || '#9c7ba0',
    brightCyan: readVar('--graph-6') || '#5f8c7d',
    brightWhite: readVar('--text') || '#e9e4d9'
  }
}

interface TerminalPanelProps {
  width: number
  open: boolean
  onResize: (width: number) => void
  onCollapse: () => void
}

export function TerminalPanel({ width, open, onResize, onCollapse }: TerminalPanelProps): React.JSX.Element {
  const repo = useAppStore((s) => s.repo)
  const settings = useAppStore((s) => s.settings)
  const pushToast = useAppStore((s) => s.pushToast)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [shell, setShell] = useState('Git Bash')
  const [cwd, setCwd] = useState(repo?.path ?? '')
  const [exited, setExited] = useState(false)
  const exitedRef = useRef(false)
  const bufferRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const pendingRef = useRef('')
  const lastCharRef = useRef('\n')
  const userRef = useRef('')
  const hostNameRef = useRef('')
  const homeRef = useRef('')
  const dirRef = useRef('')
  const panelRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)

  async function copySelection(): Promise<void> {
    const term = termRef.current
    if (!term) return
    const text = term.getSelection()
    if (!text) {
      pushToast('请先用鼠标选中要复制的文本', 'info')
      return
    }
    await api.app.clipboardWrite(text)
    pushToast('已复制', 'success')
    setMenu(null)
  }

  async function pasteClipboard(): Promise<void> {
    try {
      const text = await api.app.clipboardRead()
      if (!text) return
      handleInput(text)
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    } finally {
      setMenu(null)
      termRef.current?.focus()
    }
  }

  function selectAll(): void {
    termRef.current?.selectAll()
    setMenu(null)
  }

  function normalizePath(value: string): string {
    if (!value) return ''
    return value
      .replace(/\\/g, '/')
      .replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`)
  }

  function displayDir(): string {
    const dir = normalizePath(dirRef.current)
    const home = normalizePath(homeRef.current)
    if (!dir) return '~'
    if (home && dir === home) return '~'
    if (home && dir.toLowerCase().startsWith(home.toLowerCase() + '/')) {
      return '~' + dir.slice(home.length)
    }
    return dir
  }

  function promptText(): string {
    const user = userRef.current || 'user'
    const host = hostNameRef.current || 'localhost'
    return `\u001b[32m${user}@${host}\u001b[0m \u001b[33m${displayDir()}\u001b[0m $ `
  }

  function writePrompt(): void {
    const term = termRef.current
    if (!term) return
    if (lastCharRef.current && lastCharRef.current !== '\n') term.write('\r\n')
    term.write(promptText())
    lastCharRef.current = ' '
  }

  function writeOutput(text: string): void {
    const term = termRef.current
    if (!term || !text) return
    term.write(text)
    lastCharRef.current = text[text.length - 1]
  }

  function flushPending(): void {
    let text = pendingRef.current
    for (;;) {
      const index = text.indexOf(MARKER)
      if (index >= 0) {
        const rest = text.slice(index + MARKER.length)
        const end = rest.indexOf('\x1e')
        if (end < 0) {
          writeOutput(text.slice(0, index))
          pendingRef.current = text.slice(index)
          return
        }
        writeOutput(text.slice(0, index))
        const cwd = rest.slice(0, end)
        if (cwd) {
          dirRef.current = cwd
          setCwd(cwd)
        }
        text = rest.slice(end + 1)
        // The shell writes a line break after the marker; drop it so the prompt
        // and the typed command share one line.
        if (text.startsWith('\r\n')) text = text.slice(2)
        else if (text.startsWith('\n')) text = text.slice(1)
        writePrompt()
        continue
      }
      // Avoid printing a partial marker across chunk boundaries.
      let hold = 0
      for (let k = Math.min(MARKER.length - 1, text.length); k > 0; k--) {
        if (text.endsWith(MARKER.slice(0, k))) {
          hold = k
          break
        }
      }
      if (hold > 0) {
        writeOutput(text.slice(0, text.length - hold))
        text = text.slice(text.length - hold)
      } else {
        writeOutput(text)
        text = ''
      }
      break
    }
    pendingRef.current = text
  }

  function setLine(value: string): void {
    const term = termRef.current
    if (!term) return
    bufferRef.current = value
    term.write(`\r\u001b[2K${promptText()}${value}`)
    lastCharRef.current = value.slice(-1) || ' '
  }

  function applyHistory(direction: -1 | 1): void {
    const history = historyRef.current
    if (history.length === 0) return
    let index = historyIndexRef.current
    if (direction === -1) {
      index = index === -1 ? history.length - 1 : Math.max(0, index - 1)
    } else {
      if (index === -1) return
      index += 1
      if (index >= history.length) {
        historyIndexRef.current = -1
        setLine('')
        return
      }
    }
    historyIndexRef.current = index
    setLine(history[index])
  }

  function submitLine(): void {
    const command = bufferRef.current.trim()
    bufferRef.current = ''
    const term = termRef.current
    if (!term) return
    term.write('\r\n')
    lastCharRef.current = '\n'
    if (!command) {
      writePrompt()
      return
    }
    historyRef.current = [...historyRef.current.slice(-199), command]
    historyIndexRef.current = -1
    api.terminal.run(command).catch((error) => pushToast(errorMessage(error), 'error'))
    // Prompt is printed when main sends the completion marker.
  }

  function handleInput(data: string): void {
    const term = termRef.current
    if (!term) return
    if (exitedRef.current) return
    for (let i = 0; i < data.length; i++) {
      const char = data[i]
      if (char === '\r' || char === '\n') {
        submitLine()
        continue
      }
      if (char === '\x7f') {
        if (bufferRef.current.length > 0) {
          bufferRef.current = bufferRef.current.slice(0, -1)
          term.write('\b \b')
          lastCharRef.current = bufferRef.current.slice(-1) || ' '
        }
        continue
      }
      if (char === '\x03') {
        bufferRef.current = ''
        term.write('^C\r\n')
        lastCharRef.current = '\n'
        writePrompt()
        continue
      }
      if (char === '\x0c') {
        bufferRef.current = ''
        term.clear()
        writePrompt()
        continue
      }
      if (char === '\x1b') {
        if (data.startsWith('\x1b[A', i)) {
          applyHistory(-1)
          i += 2
        } else if (data.startsWith('\x1b[B', i)) {
          applyHistory(1)
          i += 2
        } else if (i + 2 < data.length) {
          i += 2
        }
        continue
      }
      if (char === '\t') continue
      if (char >= ' ') {
        bufferRef.current += char
        term.write(char)
        lastCharRef.current = char
      }
    }
  }

  async function startSession(): Promise<void> {
    if (!repo) return
    try {
      const info = await api.terminal.start(repo.path)
      setShell(info.shell)
      setCwd(info.cwd)
      userRef.current = info.user
      hostNameRef.current = info.host
      homeRef.current = info.home
      dirRef.current = info.cwd
      setExited(false)
      exitedRef.current = false
      bufferRef.current = ''
      pendingRef.current = ''
      historyIndexRef.current = -1
      const term = termRef.current
      if (term) {
        term.reset()
        lastCharRef.current = '\n'
        term.focus()
      }
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      disableStdin: false,
      convertEol: true,
      scrollback: 4000,
      theme: buildTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    term.focus()

    const inputDisposable = term.onData(handleInput)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      if (event.ctrlKey && event.shiftKey) {
        if (key === 'c') {
          void copySelection()
          return false
        }
        if (key === 'v') {
          void pasteClipboard()
          return false
        }
        if (key === 'a') {
          term.selectAll()
          return false
        }
      }
      return true
    })
    const offData = api.terminal.onData((event) => {
      pendingRef.current += event.chunk
      flushPending()
    })
    const offExit = api.terminal.onExit((event) => {
      setExited(true)
      exitedRef.current = true
      term.writeln(`\r\n\u001b[90m[session exit ${event.code ?? ''}]\u001b[0m`)
      lastCharRef.current = '\n'
    })
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* host not laid out yet */
      }
    })
    observer.observe(host)

    return () => {
      inputDisposable.dispose()
      offData()
      offExit()
      observer.disconnect()
      term.dispose()
      termRef.current = null
      void api.terminal.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (repo?.path) void startSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* hidden during layout */
      }
      termRef.current?.focus()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = buildTheme()
  }, [settings.theme, settings.density])

  useEffect(() => {
    const onResizeWindow = (): void => {
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('resize', onResizeWindow)
    return () => window.removeEventListener('resize', onResizeWindow)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  return (
    <aside className={`arb-terminal${open ? '' : ' is-hidden'}`} style={{ width }} ref={panelRef}>
      {menu ? (
        <div
          ref={menuRef}
          className="arb-terminal-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="arb-terminal-menu-item" disabled={!menu.hasSelection} onClick={() => void copySelection()}>
            <Copy size={13} strokeWidth={1.7} />
            复制选中
            <span className="arb-terminal-menu-shortcut">Ctrl+Shift+C</span>
          </button>
          <button type="button" className="arb-terminal-menu-item" onClick={() => void pasteClipboard()}>
            <ClipboardPaste size={13} strokeWidth={1.7} />
            粘贴
            <span className="arb-terminal-menu-shortcut">Ctrl+Shift+V</span>
          </button>
          <button type="button" className="arb-terminal-menu-item" onClick={selectAll}>
            <span className="arb-terminal-menu-icon" />
            全选
            <span className="arb-terminal-menu-shortcut">Ctrl+Shift+A</span>
          </button>
          <div className="arb-terminal-menu-sep" />
          <button
            type="button"
            className="arb-terminal-menu-item"
            onClick={() => {
              termRef.current?.clear()
              termRef.current?.focus()
              setMenu(null)
            }}
          >
            <Trash2 size={13} strokeWidth={1.7} />
            清空输出
          </button>
        </div>
      ) : null}<div
        className="arb-terminal-resizer"
        onMouseDown={(event) => {
          const startX = event.clientX
          const startWidth = width
          const onMove = (move: MouseEvent): void => {
            const next = Math.min(760, Math.max(300, startWidth - (move.clientX - startX)))
            onResize(next)
          }
          const onUp = (): void => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
      />
      <header className="arb-terminal-hd">
        <SquareTerminal size={13} strokeWidth={1.7} className="arb-terminal-icon" />
        <span className="arb-terminal-title">{shell}</span>
        <span className="arb-terminal-cwd mono truncate" title={cwd}>
          {cwd}
        </span>
        <div className="arb-terminal-actions">
          <IconButton icon={RotateCw} label="重启会话" size={20} onClick={() => void startSession()} />
          <IconButton
            icon={Trash2}
            label="清空输出"
            size={20}
            onClick={() => {
              termRef.current?.clear()
              termRef.current?.focus()
            }}
          />
          <IconButton icon={PanelRightClose} label="收起命令行" size={20} onClick={onCollapse} />
        </div>
      </header>
      <div
        className="arb-terminal-body"
        onMouseDown={() => termRef.current?.focus()}
        onContextMenu={(event) => {
          event.preventDefault()
          const rect = panelRef.current?.getBoundingClientRect()
          if (!rect) return
          setMenu({
            x: Math.max(6, Math.min(event.clientX - rect.left, rect.width - 190)),
            y: Math.max(6, Math.min(event.clientY - rect.top, rect.height - 130)),
            hasSelection: Boolean(termRef.current?.getSelection())
          })
        }}
      >
        <div ref={hostRef} className="arb-terminal-xterm" />
        {exited ? (
          <div className="arb-terminal-exit">
            <span>会话已结束</span>
            <button type="button" className="arb-link" onClick={() => void startSession()}>
              重启会话
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

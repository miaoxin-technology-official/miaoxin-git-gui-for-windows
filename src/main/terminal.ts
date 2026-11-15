// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { CH } from '@shared/channels'
import type { TerminalInfo } from '@shared/types'
import { decodeSmart } from './git/encoding'
import { sendToRenderer } from './window'

const MARKER = '\x1eARBOR_PROMPT\x1e'
const BASH_MARKER_CMD = "printf '\\036ARBOR_PROMPT\\036%s\\036\\n' \"$PWD\""
const PS_MARKER_CMD =
  "[Console]::Out.WriteLine([char]30 + 'ARBOR_PROMPT' + [char]30 + (Get-Location).Path + [char]30)"

type ShellKind = 'system' | 'bundled' | 'powershell'

/**
 * Persistent command shell.
 *
 * Git Bash is spawned once per repository and commands are written to stdin, so
 * `cd`, environment variables and shell state survive. A system Git Bash and
 * the bundled MinGit bash have separate MSYS runtimes, so each gets its own
 * PATH — mixing them makes bash fail to start. Fallback order:
 * system Git Bash → bundled Git Bash → PowerShell.
 */
class TerminalManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private shellLabel = 'Git Bash'
  private kind: ShellKind = 'system'
  private cwd = ''
  private startedAt = 0
  private sawOutput = false
  private buffer = ''

  private bundledRoot(): string {
    return app.isPackaged ? path.join(process.resourcesPath, 'git') : path.resolve(__dirname, '../../vendor/git')
  }

  private systemBash(): { file: string; root: string } | null {
    for (const file of [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    ]) {
      if (fs.existsSync(file)) return { file, root: path.dirname(path.dirname(file)) }
    }
    return null
  }

  private bundledBash(): { file: string; root: string } | null {
    const root = this.bundledRoot()
    const file = path.join(root, 'usr', 'bin', 'bash.exe')
    return fs.existsSync(file) ? { file, root } : null
  }

  private envFor(root: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: [
        path.join(root, 'cmd'),
        path.join(root, 'mingw64', 'bin'),
        path.join(root, 'usr', 'bin'),
        process.env.PATH ?? ''
      ]
        .filter(Boolean)
        .join(';'),
      TERM: 'xterm-256color',
      MSYSTEM: 'MINGW64',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      ...extra
    }
  }

  private emit(chunk: string, stream: 'stdout' | 'stderr' | 'system'): void {
    if (!chunk) return
    sendToRenderer(CH.evtTerminalData, { chunk, stream })
  }

  private writeStdin(text: string): boolean {
    const child = this.child
    if (!child || !child.stdin.writable || child.stdin.destroyed) return false
    try {
      child.stdin.write(text)
      return true
    } catch {
      return false
    }
  }

  private markerCommand(): string {
    return this.kind === 'powershell' ? PS_MARKER_CMD : BASH_MARKER_CMD
  }

  private attach(child: ChildProcessWithoutNullStreams): void {
    this.child = child
    child.stdout.on('data', (data: Buffer) => {
      this.sawOutput = true
      this.emit(decodeSmart(data).text, 'stdout')
    })
    child.stderr.on('data', (data: Buffer) => this.emit(decodeSmart(data).text, 'stderr'))
    child.stdin.on('error', () => undefined)
    child.stdout.on('error', () => undefined)
    child.stderr.on('error', () => undefined)
    child.on('error', (error) => {
      this.emit(`\r\n无法启动 ${this.shellLabel}：${error.message}\r\n`, 'stderr')
      this.advanceFallback()
    })
    child.on('exit', () => {
      const quickFailure = !this.sawOutput && Date.now() - this.startedAt < 3000
      this.child = null
      if (quickFailure) {
        this.advanceFallback()
        return
      }
      sendToRenderer(CH.evtTerminalExit, { code: 0 })
    })
  }

  /** system bash → bundled bash → PowerShell */
  private advanceFallback(): void {
    const system = this.systemBash()
    const bundled = this.bundledBash()
    if (this.kind === 'system' && bundled) {
      this.emit('\r\n\u001b[90m系统 Git Bash 未能启动，改用安装包内置 Git Bash。\u001b[0m\r\n', 'system')
      this.startBash('bundled')
      return
    }
    if (this.kind !== 'powershell') {
      this.emit('\r\n\u001b[90mGit Bash 未能启动，已切换到 PowerShell 会话（git 命令仍可用）。\u001b[0m\r\n', 'system')
      this.startPowerShell(this.cwd)
      return
    }
    sendToRenderer(CH.evtTerminalExit, { code: -1 })
  }

  start(repo: string): TerminalInfo {
    this.stop()
    this.cwd = repo
    this.buffer = ''
    if (this.systemBash()) {
      this.startBash('system')
    } else if (this.bundledBash()) {
      this.startBash('bundled')
    } else {
      this.startPowerShell(repo)
    }
    return {
      shell: this.shellLabel,
      cwd: repo,
      user: os.userInfo().username,
      host: os.hostname(),
      home: os.homedir()
    }
  }

  private startBash(kind: 'system' | 'bundled'): void {
    const resolved = kind === 'system' ? this.systemBash() : this.bundledBash()
    if (!resolved) {
      this.startPowerShell(this.cwd)
      return
    }
    this.kind = kind
    this.shellLabel = 'Git Bash'
    this.startedAt = Date.now()
    this.sawOutput = false
    const child = spawn(resolved.file, ['--noprofile', '--norc'], {
      cwd: this.cwd,
      env: this.envFor(resolved.root),
      windowsHide: true
    })
    this.attach(child)
    this.writeStdin('git() { command git -c core.quotepath=false "$@"; }\nexport PS1="$ "\n')
    this.writeStdin(`${BASH_MARKER_CMD}\n`)
  }

  private startPowerShell(repo: string): void {
    this.stop()
    this.cwd = repo
    this.kind = 'powershell'
    this.shellLabel = 'PowerShell'
    this.startedAt = Date.now()
    this.sawOutput = false
    const root = this.bundledRoot()
    const gitExe = path.join(root, 'cmd', 'git.exe')
    const systemRoot = this.systemBash()?.root
    const env = this.envFor(systemRoot ?? root, {
      MIAOXIN_GIT: fs.existsSync(gitExe) ? gitExe : 'git'
    })
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      cwd: repo,
      env,
      windowsHide: true
    })
    this.attach(child)
    this.writeStdin(
      '$OutputEncoding = New-Object System.Text.UTF8Encoding $false\n' +
        'function global:git { & $env:MIAOXIN_GIT -c core.quotepath=false @args }\n'
    )
    this.writeStdin(`${PS_MARKER_CMD}\n`)
  }

  run(command: string): void {
    if (!this.writeStdin(`${command}\n`)) {
      this.emit('\r\n会话已结束，请点击重启。\r\n', 'system')
      return
    }
    this.writeStdin(`${this.markerCommand()}\n`)
  }

  stop(): void {
    const child = this.child
    this.child = null
    if (!child) return
    if (child.pid) {
      try {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => undefined)
      } catch {
        /* ignore */
      }
    }
    try {
      child.stdin.write('exit\n')
    } catch {
      /* already closed */
    }
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
}

export const terminalManager = new TerminalManager()

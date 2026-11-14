// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process'
import { decodeSmart } from './encoding'

/** Receives one line of output from a long-running git command. */
export type ProgressSink = (line: string, stream: 'stdout' | 'stderr' | 'system') => void

/**
 * Process execution for git.
 *
 * Every invocation goes through `spawn` with an argv array — never a shell — so
 * paths, branch names and commit messages are always passed as discrete
 * arguments. Output is captured as raw `Buffer`s and decoded with `decodeSmart`
 * (UTF-8 / GB18030 / UTF-16 BOM aware) instead of assuming UTF-8; every call has
 * a timeout with a kill fallback, and long-running commands can stream decoded
 * lines to a `ProgressSink`.
 */

/** Environment applied to every git invocation (contract §4). */
const BASE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8'
}

/**
 * Global options prepended to every command:
 *  - `core.quotepath=false` keeps non-ASCII paths readable (UTF-8 instead of \ooo)
 *  - `color.ui=false` guarantees plain text even if the user enabled colors
 *  - `--no-optional-locks` avoids optional index refreshes racing with the watcher
 */
const GLOBAL_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '--no-optional-locks']

/** Local commands (status/log/diff/…) get 30s. */
export const LOCAL_TIMEOUT = 30_000
/** Network commands (clone/fetch/pull/push) get 10 minutes. */
export const NETWORK_TIMEOUT = 10 * 60_000

export interface GitRunOptions {
  cwd?: string
  timeoutMs?: number
  /** Data written to stdin (e.g. commit message via `-F -`, patch via `git apply`). */
  input?: string | Buffer
  sink?: ProgressSink
  /** Extra environment variables (e.g. `GIT_EDITOR=true`). */
  env?: Record<string, string>
}

export interface GitResult {
  code: number
  /** Decoded stdout (UTF-8 / GB18030 / UTF-16 aware). */
  stdout: string
  /** Decoded stderr. */
  stderr: string
  /** Raw stdout bytes; prefer this when parsing paths or patches. */
  stdoutBuffer: Buffer
  /** Raw stderr bytes. */
  stderrBuffer: Buffer
  /** stdout + stderr, for a raw console view. */
  output: string
  args: string[]
}

/**
 * Error raised when git cannot be started, times out, or (via `runGitOk`) exits
 * with a non-zero code. `message` is a short Chinese sentence for the UI while
 * the original streams are preserved for the console.
 */
export class GitError extends Error {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly output: string
  readonly args: string[]

  constructor(message: string, result: Partial<GitResult> = {}) {
    super(message)
    this.name = 'GitError'
    this.code = result.code ?? -1
    this.stdout = result.stdout ?? ''
    this.stderr = result.stderr ?? ''
    this.output = result.output ?? `${this.stdout}${this.stderr}`
    this.args = result.args ?? []
  }
}

let gitPathProvider: () => string = () => 'git'

/** Wire the user-configured git path (from settings) into the executor. */
export function setGitPathProvider(provider: () => string): void {
  gitPathProvider = provider
}

/** Resolves the git executable for the current invocation. */
export function resolveGitPath(): string {
  try {
    return gitPathProvider() || 'git'
  } catch {
    return 'git'
  }
}

/** First non-empty line of a stream, trimmed to a sane toast length. */
export function firstLine(text: string, max = 240): string {
  const line = text
    .split(/\r\n|\r|\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function commandLabel(args: string[]): string {
  const sub = args.find((arg) => !arg.startsWith('-')) ?? args[0] ?? 'git'
  return `git ${sub}`
}

/** Builds a `GitError` from a failed result, keeping the raw streams intact. */
export function gitFailure(friendly: string, result: GitResult): GitError {
  const detail = firstLine(result.stderr) || firstLine(result.stdout) || `退出码 ${result.code}`
  return new GitError(`${friendly}：${detail}`, result)
}

interface LineSplitter {
  push(chunk: Buffer): void
  end(): void
}

/**
 * Byte level splitter: git output is split on LF/CR before decoding, so a mixed
 * encoding stream (UTF-8 refs next to a GBK path) never corrupts a whole line.
 */
function createLineSplitter(stream: 'stdout' | 'stderr', sink: ProgressSink | undefined): LineSplitter {
  let pending = Buffer.alloc(0)
  const emit = (): void => {
    let start = 0
    for (let index = 0; index < pending.length; index += 1) {
      const byte = pending[index]
      if (byte !== 0x0a && byte !== 0x0d) continue
      const line = pending.subarray(start, index)
      if (sink && line.length > 0) {
        const text = decodeSmart(line).text
        if (text.trim()) sink(text, stream)
      }
      if (byte === 0x0d && pending[index + 1] === 0x0a) index += 1
      start = index + 1
    }
    pending = pending.subarray(start)
  }
  return {
    push(chunk: Buffer): void {
      if (!sink) return
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      emit()
    },
    end(): void {
      if (!sink) return
      if (pending.length > 0) {
        const text = decodeSmart(pending).text
        if (text.trim()) sink(text, stream)
      }
      pending = Buffer.alloc(0)
    }
  }
}

/**
 * Runs git and resolves with the captured result. A non-zero exit code is NOT
 * an exception here — callers decide whether a failure is exceptional (reads,
 * commits) or expected (merge conflicts, network errors).
 */
export function runGit(args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  const fullArgs = [...GLOBAL_ARGS, ...args]
  const timeoutMs = options.timeoutMs ?? LOCAL_TIMEOUT
  const cwd = options.cwd
  const env: NodeJS.ProcessEnv = { ...process.env, ...BASE_ENV, ...options.env }
  const label = commandLabel(args)

  return new Promise<GitResult>((resolve, reject) => {
    let settled = false
    let timedOut = false
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const stdoutSplitter = createLineSplitter('stdout', options.sink)
    const stderrSplitter = createLineSplitter('stderr', options.sink)

    let child
    try {
      child = spawn(resolveGitPath(), fullArgs, {
        cwd,
        windowsHide: true,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reject(new GitError(`无法启动 git：${message}`, { args: fullArgs }))
      return
    }

    options.sink?.(`$ git ${args.join(' ')}`, 'system')

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    const finish = (error: GitError | null, result?: GitResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result as GitResult)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
      stdoutSplitter.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
      stderrSplitter.push(chunk)
    })

    child.stdout.on('error', () => undefined)
    child.stderr.on('error', () => undefined)
    child.stdin.on('error', () => undefined)

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT' ? '未找到 git，请在设置中指定 git 路径' : `无法启动 git：${error.message}`
      finish(new GitError(message, { args: fullArgs }))
    })

    child.on('close', (code: number | null) => {
      stdoutSplitter.end()
      stderrSplitter.end()
      const stdoutBuffer = Buffer.concat(stdoutChunks)
      const stderrBuffer = Buffer.concat(stderrChunks)
      const stdout = decodeSmart(stdoutBuffer).text
      const stderr = decodeSmart(stderrBuffer).text
      if (timedOut) {
        const seconds = Math.round(timeoutMs / 1000)
        finish(
          new GitError(`${label} 超时（${seconds} 秒），已终止`, {
            code: -1,
            stdout,
            stderr,
            args: fullArgs
          })
        )
        return
      }
      finish(null, {
        code: code ?? -1,
        stdout,
        stderr,
        stdoutBuffer,
        stderrBuffer,
        output: `${stdout}${stderr}`,
        args: fullArgs
      })
    })

    if (options.input !== undefined) {
      child.stdin.write(options.input)
    }
    child.stdin.end()
  })
}

/** Runs git and throws a friendly `GitError` when the exit code is non-zero. */
export async function runGitOk(
  args: string[],
  options: GitRunOptions,
  friendly: string
): Promise<GitResult> {
  const result = await runGit(args, options)
  if (result.code !== 0) throw gitFailure(friendly, result)
  return result
}

/**
 * Validates a value that is interpolated into argv and could otherwise be read
 * as an option (branch name, hash, remote name, …).
 */
export function assertSafeRef(value: string, label: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) throw new Error(`${label}不能为空`)
  if (trimmed.startsWith('-')) throw new Error(`${label}不合法：${trimmed}`)
  if (/[\x00-\x1f]/.test(trimmed)) throw new Error(`${label}不能包含控制字符`)
  return trimmed
}

/** True when a `git log` failure simply means the repository has no commits. */
export function isEmptyRepoLogError(stderr: string): boolean {
  return /does not have any commits yet|your current branch .* does not have any commits/i.test(stderr)
}

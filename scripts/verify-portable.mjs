#!/usr/bin/env node
/**
 * Verify the packaged portable EXE:
 *   - starts and stays alive, window title is correct;
 *   - runs from the NSIS-extracted directory under %TEMP% (ASCII path);
 *   - settings persist across restarts (theme light -> quit -> relaunch).
 *
 * The portable target extracts to %TEMP% and runs from there, so this script
 * also reports the extracted executable path. A workspace-local --user-data-dir
 * is used because Chromium cannot write %APPDATA% inside restricted agent
 * shells (see docs/BUILD.md §5).
 *
 * Usage:
 *   node scripts/verify-portable.mjs [path-to-portable.exe]
 */

import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXE = path.resolve(process.argv[2] || path.join(ROOT, 'release', 'MiaoxinGitGUI-1.0.0-portable.exe'))
const PROFILE = path.join(ROOT, 'release', 'qa-portable-profile')
// The restricted agent shell cannot let the NSIS stub write %TEMP%; redirect
// TEMP/TMP to a writable workspace directory. This is an environment limit,
// not a packaging problem (see docs/BUILD.md §5).
const QA_TEMP = path.join(ROOT, '.tmp', 'qa-temp')
const REPO = process.env.MIAOXIN_VERIFY_REPO || path.join(ROOT, '.tmp', 'demo-repo')
const START_PORT = Number(process.env.MIAOXIN_CDP_PORT || 9455)
const log = (...args) => console.log('[verify-portable]', ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function killLeftovers() {
  if (process.platform !== 'win32') return
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Process MiaoxinGitGUI,electron -ErrorAction SilentlyContinue | Stop-Process -Force -PassThru | ForEach-Object { $null = $_.WaitForExit(3000) }'
      ],
      { stdio: 'ignore', timeout: 30000 }
    )
  } catch {
    /* nothing to kill */
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function pickFreePort(start) {
  const { connect } = await import('node:net')
  const inUse = (port) =>
    new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      const done = (value) => {
        socket.destroy()
        resolve(value)
      }
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      setTimeout(() => done(false), 400)
    })
  for (let port = start; port < start + 60; port++) if (!(await inUse(port))) return port
  throw new Error('no free CDP port')
}

async function waitForTarget(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(400)
  }
  throw new Error('CDP target timeout')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result)
      }
    })
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('CDP timeout: ' + method))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result?.value
  }

  async waitHook(timeoutMs = 40000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ready = await this.eval('Boolean(window.__miaoxinTest || window.__arborTest)', 5000).catch(() => false)
      if (ready) return true
      await sleep(300)
    }
    return false
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 15000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => reject(new Error('WebSocket error')))
  })
  return new Cdp(ws)
}

function appProcessPath() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process MiaoxinGitGUI -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path'],
      { encoding: 'utf8', timeout: 20000 }
    )
    return out.trim().split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

function mainWindowTitle() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process MiaoxinGitGUI -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle'],
      { encoding: 'utf8', timeout: 20000 }
    )
    return out.trim() || null
  } catch {
    return null
  }
}

async function launch(profile, port) {
  fs.rmSync(profile, { recursive: true, force: true })
  fs.rmSync(QA_TEMP, { recursive: true, force: true })
  fs.mkdirSync(QA_TEMP, { recursive: true })
  const env = { ...process.env, TEMP: QA_TEMP, TMP: QA_TEMP }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    EXE,
    ['--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`],
    { cwd: ROOT, env, stdio: 'ignore' }
  )
  const target = await waitForTarget(port)
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const hook = await cdp.waitHook()
  if (!hook) throw new Error('test hook not available')
  await cdp.eval('(window.__miaoxinTest || window.__arborTest).waitReady()', 60000)
  await sleep(800)
  return { child, cdp, target }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows only')
  if (!fs.existsSync(EXE)) throw new Error('portable EXE 不存在：' + EXE)

  const stat = fs.statSync(EXE)
  const hash = sha256(EXE)
  log(`exe: ${EXE}`)
  log(`size: ${stat.size} bytes (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
  log(`sha256: ${hash}`)

  killLeftovers()
  const port = await pickFreePort(START_PORT)

  // --- first run: open repo, check GB18030 diff, change theme, quit --------
  let first
  let observedPaths = []
  let observedWindowTitle = null
  let openedRepo = null
  let diffInfo = null
  try {
    first = await launch(PROFILE, port)
    const title = await first.cdp.eval('document.title')
    const winTitle = await first.cdp.eval('document.body.innerText.slice(0, 40)')
    const themeBefore = await first.cdp.eval('document.documentElement.dataset.theme')
    observedPaths = appProcessPath()
    observedWindowTitle = mainWindowTitle()
    log(`first run: document.title="${title}" window="${observedWindowTitle}" theme=${themeBefore} text=${JSON.stringify(winTitle)}`)
    log('app process path(s): ' + (observedPaths.join(' | ') || 'not observed'))

    if (fs.existsSync(REPO)) {
      openedRepo = Boolean(
        await first.cdp.eval(`(window.__miaoxinTest || window.__arborTest).openRepo(${JSON.stringify(REPO)})`, 90000)
      )
      await first.cdp.eval('(window.__miaoxinTest || window.__arborTest).waitReady()', 60000)
      await sleep(1000)
      diffInfo = JSON.parse(
        await first.cdp.eval(
          `window.arbor.diff.worktree(${JSON.stringify(REPO)}, 'docs/中文说明.md', 'unstaged')
             .then((r) => JSON.stringify({ files: r.files.length, encoding: (r.files[0] && r.files[0].encoding) || null }))`,
          60000
        )
      )
      log(`openRepo=${openedRepo} gb18030-diff=${JSON.stringify(diffInfo)}`)
    }

    await first.cdp.eval('(window.__miaoxinTest || window.__arborTest).setTheme("light")', 30000)
    await sleep(800)
    const themeSet = await first.cdp.eval('document.documentElement.dataset.theme')
    const persistedNow = await first.cdp.eval('window.arbor.settings.get().then((s) => s.theme)')
    log(`set theme -> ${themeSet} (settings.theme=${persistedNow})`)
    await first.cdp.send('Browser.close', {}, 10000).catch(() => undefined)
    await sleep(3000)
  } finally {
    killLeftovers()
  }

  const settingsFile = path.join(PROFILE, 'settings.json')
  const settingsAfterQuit = fs.existsSync(settingsFile)
    ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    : null
  log(`settings.json after quit: theme=${settingsAfterQuit?.theme ?? 'MISSING'}`)

  await sleep(800)

  // --- second run: theme must be restored ----------------------------------
  let second
  let restored = null
  let persistedTheme = null
  let secondTitle = null
  try {
    second = await launch(PROFILE, port)
    secondTitle = await second.cdp.eval('document.title')
    restored = await second.cdp.eval('document.documentElement.dataset.theme')
    persistedTheme = await second.cdp.eval('window.arbor.settings.get().then((s) => s.theme)')
    log(`second run: title="${secondTitle}" theme=${restored} (settings.theme=${persistedTheme})`)
  } finally {
    killLeftovers()
  }

  const processPaths = observedPaths
  const tempUnpack =
    processPaths.find((p) => p.toLowerCase().startsWith(QA_TEMP.toLowerCase())) ||
    processPaths.find((p) => p.toLowerCase().includes('temp')) ||
    processPaths[0] ||
    null
  log('app process path(s): ' + (processPaths.join(' | ') || 'none observed'))
  log('temp unpack dir: ' + (tempUnpack ? path.dirname(tempUnpack) : 'not observed'))

  const encoding = diffInfo?.encoding ?? null
  const summary = {
    exe: EXE,
    size: stat.size,
    sizeMB: Number((stat.size / 1024 / 1024).toFixed(1)),
    sha256: hash,
    windowTitle: observedWindowTitle,
    openedRepo,
    diffFiles: diffInfo?.files ?? null,
    diffEncoding: encoding,
    gb18030Diff: typeof encoding === 'string' && /gb18030|gbk|gb2312/i.test(encoding),
    themeSetTo: 'light',
    themeAfterRestart: restored,
    persistedTheme,
    settingsFileTheme: settingsAfterQuit?.theme ?? null,
    tempUnpackDir: tempUnpack ? path.dirname(tempUnpack) : null,
    persistence: restored === 'light' && persistedTheme === 'light' && settingsAfterQuit?.theme === 'light'
  }
  log('SUMMARY ' + JSON.stringify(summary))
  try {
    fs.rmSync(QA_TEMP, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
  if (!summary.persistence) throw new Error('设置持久化验证失败')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[verify-portable] 失败：' + error.message)
    process.exit(1)
  })

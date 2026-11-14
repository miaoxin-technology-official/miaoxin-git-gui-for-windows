// SPDX-License-Identifier: AGPL-3.0-or-later
#!/usr/bin/env node
/**
 * Miaoxin Git GUI screenshot pipeline.
 *
 * Launches the built Electron app with a CDP debugging port, drives the
 * renderer through a test hook (`window.__miaoxinTest`, falling back to the
 * legacy `window.__arborTest`, see src/renderer/src/App.tsx), and captures
 * PNGs into docs/screenshots/.
 *
 * Requirements: Node >= 22 (built-in WebSocket / fetch), a fresh `out/` build
 * (`npm run build` or pass --build), and a Git repository to display. The
 * default demo repository is `.tmp/demo-repo` (non-empty worktree, merge graph).
 *
 * Usage:
 *   node scripts/shoot.mjs                 # or: npm run shoot
 *   node scripts/shoot.mjs --build         # run `npm run build` first
 *   node scripts/shoot.mjs --keep          # leave the app running afterwards
 *
 * Output (docs/screenshots/): welcome, changes-dark, history-dark,
 * branches-dark, remotes-dark, palette-dark, history-light, changes-light.
 * After the screenshots a layout check runs for 1080x680 and 125% scaling.
 *
 * Environment overrides (MIAOXIN_* preferred, ARBOR_* kept for old callers):
 *   MIAOXIN_SHOOT_REPO     repository to open (default .tmp/demo-repo)
 *   MIAOXIN_SHOOT_OUT      output directory (default docs/screenshots)
 *   MIAOXIN_SHOOT_APP      app directory passed to Electron (default repo root)
 *   MIAOXIN_SHOOT_DSF      deviceScaleFactor (default 1.5)
 *   MIAOXIN_SHOOT_SETTLE   extra settle time per shot in ms (default 450)
 *   MIAOXIN_CDP_PORT       remote debugging port (default 9333)
 *
 * Notes for sandboxed/agent shells on Windows (see docs/BUILD.md):
 *   - the Electron child must not inherit ELECTRON_RUN_AS_NODE=1;
 *   - `--no-sandbox` is needed in elevated/restricted sessions;
 *   - the Chromium profile dir must live inside the writable workspace.
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/** Read an env var, accepting the legacy ARBOR_* name for old callers. */
function envAny(name, legacy, fallback) {
  return process.env[name] ?? (legacy ? process.env[legacy] : undefined) ?? fallback
}

const OUT_DIR = path.resolve(ROOT, envAny('MIAOXIN_SHOOT_OUT', 'ARBOR_SHOOT_OUT', 'docs/screenshots'))
const APP_DIR = path.resolve(ROOT, envAny('MIAOXIN_SHOOT_APP', 'ARBOR_SHOOT_APP', '.'))
const REPO = envAny('MIAOXIN_SHOOT_REPO', 'ARBOR_SHOOT_REPO', path.join(ROOT, '.tmp', 'demo-repo'))
let PORT = Number(envAny('MIAOXIN_CDP_PORT', 'ARBOR_CDP_PORT', 9333))
const WIDTH = 1920
const HEIGHT = 1200
const DSF = Number(envAny('MIAOXIN_SHOOT_DSF', 'ARBOR_SHOOT_DSF', 1.5))
const SETTLE = Number(envAny('MIAOXIN_SHOOT_SETTLE', 'ARBOR_SHOOT_SETTLE', 450))
const KEEP = process.argv.includes('--keep')
const BUILD = process.argv.includes('--build')
// Unique profile per run: a stale Chromium profile (settings.lastRepo) or a
// leftover instance would otherwise make the "welcome" shot show a repo.
const RUN_ID = `${process.pid}-${Date.now()}`
const PROFILE = path.join(ROOT, 'release', `qa-profile-shoot-${RUN_ID}`)
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
// Test-hook expression: prefer the renamed hook, keep the legacy name working.
const HOOK = '(window.__miaoxinTest || window.__arborTest)'
const SHOTS = [
  'welcome.png',
  'changes-dark.png',
  'history-dark.png',
  'branches-dark.png',
  'remotes-dark.png',
  'palette-dark.png',
  'history-light.png',
  'changes-light.png'
]

const log = (...args) => console.log('[shoot]', ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function assertNode() {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    throw new Error('需要 Node 22+（内置 WebSocket/fetch）。当前版本：' + process.version)
  }
  if (!fs.existsSync(ELECTRON)) throw new Error('找不到 Electron：' + ELECTRON)
  if (!fs.existsSync(path.join(APP_DIR, 'out', 'main', 'index.js'))) {
    throw new Error('缺少 out/main/index.js，先运行 npm run build（或加 --build）')
  }
  if (!fs.existsSync(path.join(APP_DIR, 'out', 'renderer', 'index.html'))) {
    throw new Error('缺少 out/renderer/index.html，渲染层尚未构建（或 UI 尚未就绪）')
  }
}

function killLeftovers() {
  // The app uses a single instance lock and dev runs leave helper processes
  // behind; both would fight over the profile/CDP port.
  if (process.platform === 'win32') {
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // Kill and wait for the process to actually exit before we continue.
          'Get-Process electron,MiaoxinGitGUI,Arbor -ErrorAction SilentlyContinue | Stop-Process -Force -PassThru | ForEach-Object { $null = $_.WaitForExit(3000) }'
        ],
        { stdio: 'ignore', timeout: 30000 }
      )
    } catch {
      /* nothing to kill */
    }
    // Give Chromium a moment to release the profile directory and CDP port.
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 700'], {
      stdio: 'ignore',
      timeout: 5000
    })
  } else {
    try {
      execFileSync('pkill', ['-f', 'electron.*miaoxin'], { stdio: 'ignore' })
    } catch {
      /* nothing to kill */
    }
    spawnSync('sleep', ['0.7'], { stdio: 'ignore' })
  }
}

/** Abort if another app instance already owns the debugging port. */
async function assertPortFree() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1200) })
    if (res.ok) {
      throw new Error(`CDP 端口 ${PORT} 已被占用（可能还有残留实例），先结束残留进程再重试`)
    }
  } catch (error) {
    if (error.message.includes('CDP 端口')) throw error
    /* connection refused / timed out -> port is free */
  }
}

/** Pick the first free TCP port at or after the requested one. */
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
  for (let port = start; port < start + 60; port++) {
    if (!(await inUse(port))) return port
  }
  throw new Error('找不到空闲的 CDP 端口（从 ' + start + ' 开始）')
}

/** Keep the app's settings/profile outside the repo state; fail loudly if unclean. */
function prepareProfile() {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  if (fs.existsSync(PROFILE)) throw new Error('无法清空测试 profile：' + PROFILE)
}

function ensureBuild() {
  if (!BUILD) return
  log('running npm run build …')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error('npm run build 失败，退出码 ' + result.status)
}

function startApp() {
  prepareProfile()
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // otherwise electron.exe boots as plain Node
  delete env.ELECTRON_ENABLE_LOGGING

  const args = [
    APP_DIR === ROOT ? '.' : APP_DIR,
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`
  ]
  const child = spawn(ELECTRON, args, {
    cwd: ROOT,
    env,
    stdio: 'ignore',
    windowsHide: false
  })
  child.on('exit', (code) => {
    if (!stopping) log(`electron exited (code ${code})`)
  })
  return child
}

let stopping = false
let child = null

async function waitForTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) {
        const targets = await res.json()
        const page = targets.find(
          (t) => t.type === 'page' && !t.url.startsWith('devtools://') && t.webSocketDebuggerUrl
        )
        if (page) return page
      }
    } catch (err) {
      lastErr = err
    }
    if (child && child.exitCode !== null) {
      throw new Error(`Electron 在 CDP 就绪前退出（退出码 ${child.exitCode}）`)
    }
    await sleep(300)
  }
  throw new Error('等待 CDP target 超时' + (lastErr ? '：' + lastErr.message : ''))
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else pending.resolve(msg.result)
        return
      }
      const handlers = this.listeners.get(msg.method)
      if (handlers) for (const fn of handlers) fn(msg.params)
    })
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(fn)
  }

  async eval(expression, { awaitPromise = true, timeoutMs = 60000 } = {}) {
    const res = await this.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true,
        includeCommandLineAPI: true
      },
      timeoutMs
    )
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails
      const text = detail.exception?.description || detail.text || 'unknown renderer error'
      throw new Error('页面执行出错：' + text.split('\n')[0])
    }
    return res.result?.value
  }

  async waitUntil(expression, { timeoutMs = 30000, interval = 150, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await this.eval(`Boolean(${expression})`, { awaitPromise: false })
      if (ok) return true
      await sleep(interval)
    }
    throw new Error('等待条件超时：' + label)
  }

  async settle(extra = SETTLE) {
    await sleep(extra)
    await this.eval(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
      { timeoutMs: 5000 }
    ).catch(() => undefined)
  }

  async shot(file) {
    const { data } = await this.send(
      'Page.captureScreenshot',
      { format: 'png', fromSurface: true, captureBeyondViewport: false },
      30000
    )
    const buffer = Buffer.from(data, 'base64')
    const target = path.join(OUT_DIR, file)
    fs.writeFileSync(target, buffer)
    const dims = pngSize(buffer)
    const expected = [Math.round(WIDTH * DSF), Math.round(HEIGHT * DSF)]
    const ok = dims && dims.width === expected[0] && dims.height === expected[1]
    log(
      `saved ${path.relative(ROOT, target)}  ${dims ? dims.width + 'x' + dims.height : '?'}  ${(
        buffer.length / 1024
      ).toFixed(1)} kB${ok ? '' : `  (expected ${expected[0]}x${expected[1]})`}`
    )
    return { file, buffer, dims, ok }
  }
}

function pngSize(buffer) {
  if (buffer.length < 24) return null
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 15000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket 连接失败：' + wsUrl))
    })
  })
  return new Cdp(ws)
}

async function enableDomains(cdp) {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.bringToFront').catch(() => undefined)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: DSF,
    mobile: false
  })
  await cdp.send('Emulation.setVisibleSize', { width: WIDTH, height: HEIGHT }).catch(() => undefined)
}

/** DOM fallback used when the test hook is unavailable. */
async function domFallback(cdp, step) {
  log('测试钩子不可用，使用 DOM 兜底：' + step)
  const map = { changes: '改动', history: '历史', branches: '分支', stash: '暂存', tags: '标签', remotes: '远程' }
  if (map[step]) {
    await cdp.eval(`(() => {
      const label = ${JSON.stringify(map[step])}
      const nodes = [...document.querySelectorAll('.arb-nav-item, .arb-tab, [role=tab], button, a')]
      const item = nodes.find((el) => el.textContent.trim().includes(label))
      if (!item) throw new Error('找不到导航项 ' + label)
      item.click()
    })()`)
  } else if (step === 'palette') {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers: 2,
      key: 'k',
      code: 'KeyK',
      windowsVirtualKeyCode: 75
    })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK' })
  } else if (step === 'light') {
    await cdp.eval("document.documentElement.dataset.theme = 'light'")
  } else if (step === 'dark') {
    await cdp.eval("document.documentElement.dataset.theme = 'dark'")
  }
}

/** Click a working-tree file row in Changes and wait for its diff. */
async function selectChangeFile(cdp, needle) {
  const clicked = await cdp.eval(`(() => {
    const row = [...document.querySelectorAll('.changes-row')].find((el) => el.textContent.includes(${JSON.stringify(needle)}))
    if (!row) return false
    row.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Changes 列表找不到文件：${needle}`)
  await cdp
    .waitUntil('document.querySelector(".diff-encoding-chip") || document.querySelector(".diff-line")', {
      timeoutMs: 15000,
      label: 'changes diff'
    })
    .catch(() => undefined)
  await cdp.settle(700)
  return cdp.eval('Boolean(document.querySelector(".diff-encoding-chip"))')
}

/** Select a commit (by subject keyword, else a middle row) and expand its diff. */
async function selectHistoryCommit(cdp, keyword) {
  await cdp.waitUntil('document.querySelectorAll(".hist-row").length > 0', {
    timeoutMs: 20000,
    label: 'history rows'
  })
  const picked = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('.hist-row')]
    const row = rows.find((el) => el.textContent.includes(${JSON.stringify(keyword)})) || rows[1] || rows[0]
    if (!row) return null
    row.click()
    return row.textContent.slice(0, 80)
  })()`)
  if (!picked) throw new Error('History 列表为空或无法选择提交')
  await cdp
    .waitUntil('document.querySelector(".hist-file")', {
      timeoutMs: 15000,
      label: 'commit detail file list'
    })
    .catch(() => undefined)
  await cdp.settle(600)
  const hasDiff = await cdp.eval('Boolean(document.querySelector(".diff-line"))')
  if (!hasDiff) {
    await cdp.eval(`(() => {
      const toggle = [...document.querySelectorAll('.diff-file-toggle')].find((el) => el.getAttribute('aria-expanded') === 'false')
      if (toggle) { toggle.click(); return true }
      return false
    })()`)
    await cdp
      .waitUntil('document.querySelector(".diff-line")', { timeoutMs: 10000, label: 'commit diff' })
      .catch(() => undefined)
    await cdp.settle(500)
  }
  return cdp.eval('Boolean(document.querySelector(".diff-line"))')
}

const LAYOUTS = [
  { name: '1080x680 @100%', width: 1080, height: 680, dsf: 1 },
  { name: '1920x1200 @125%', width: 1536, height: 960, dsf: 1.25 }
]

/**
 * Verify the layout at the minimum window size and at 125% Windows scaling.
 * Screenshots are written to release/qa-layout/ for human inspection only;
 * the conclusion goes into docs/QA.md.
 */
async function runLayoutChecks(cdp) {
  const outDir = path.join(ROOT, 'release', 'qa-layout')
  fs.mkdirSync(outDir, { recursive: true })
  const report = []
  for (const layout of LAYOUTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: layout.width,
      height: layout.height,
      deviceScaleFactor: layout.dsf,
      mobile: false
    })
    await cdp.settle(700)
    const metrics = JSON.parse(
      await cdp.eval(`JSON.stringify((() => {
        const doc = document.documentElement
        const viewport = { w: window.innerWidth, h: window.innerHeight }
        const offenders = []
        for (const el of document.body.querySelectorAll('*')) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.right > viewport.w + 2) {
            const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName
            offenders.push((cls || el.tagName) + '@' + Math.round(rect.right))
            if (offenders.length >= 5) break
          }
        }
        return {
          viewport,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          overflowX: doc.scrollWidth > viewport.w,
          offenders,
          titlebarH: Math.round(document.querySelector('.arb-titlebar')?.getBoundingClientRect().height ?? 0) || null,
          statusbarH: Math.round(document.querySelector('.arb-statusbar')?.getBoundingClientRect().height ?? 0) || null,
          tabCount: document.querySelectorAll('[role=tab], .arb-tab').length,
          visibleText: document.body.innerText.length
        }
      })())`)
    )
    const ok = !metrics.overflowX && metrics.offenders.length === 0 && metrics.visibleText > 0
    report.push({ layout: layout.name, ok, metrics })
    try {
      const { data } = await cdp.send(
        'Page.captureScreenshot',
        { format: 'png', fromSurface: true, captureBeyondViewport: false },
        30000
      )
      fs.writeFileSync(path.join(outDir, `${layout.width}x${layout.height}.png`), Buffer.from(data, 'base64'))
    } catch {
      /* layout evidence is best-effort */
    }
  }
  for (const entry of report) {
    const m = entry.metrics
    log(
      `layout ${entry.layout}: ${entry.ok ? 'PASS' : 'FAIL'} viewport=${m.viewport.w}x${m.viewport.h} ` +
        `scrollWidth=${m.scrollWidth} overflowX=${m.overflowX} offenders=${m.offenders.join(', ') || 'none'} ` +
        `titlebar=${m.titlebarH ?? '?'} statusbar=${m.statusbarH ?? '?'} tabs=${m.tabCount}`
    )
  }
  return report
}

async function main() {
  assertNode()
  ensureBuild()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  if (!fs.existsSync(REPO)) throw new Error('测试仓库不存在：' + REPO)

  killLeftovers()
  PORT = await pickFreePort(PORT)
  await assertPortFree()
  log(`launching ${path.relative(ROOT, ELECTRON)} (cdp :${PORT}, profile release/${path.basename(PROFILE)})`)
  child = startApp()

  try {
  const target = await waitForTarget()
  log('target:', target.url)
  const cdp = await connect(target.webSocketDebuggerUrl)
  await enableDomains(cdp)

  const results = []
  let hookReady = false
  try {
    hookReady = await cdp.waitUntil(`typeof ${HOOK} === 'object'`, {
      timeoutMs: 40000,
      label: 'window.__miaoxinTest'
    })
  } catch {
    hookReady = false
  }

  if (hookReady) {
    log('test hook found, waitReady()')
    await cdp.eval(`${HOOK}.waitReady()`, { timeoutMs: 60000 })
  } else {
    log('警告：window.__miaoxinTest / __arborTest 均未出现，改用 DOM 兜底（截图可能停在欢迎页）')
    await cdp.waitUntil('document.readyState === "complete"', { timeoutMs: 15000 })
    await cdp.settle(1200)
  }

  const drive = async (action, fallbackStep) => {
    if (hookReady) {
      try {
        await cdp.eval(action, { timeoutMs: 60000 })
      } catch (error) {
        log('钩子调用失败，转 DOM 兜底：' + error.message)
        await domFallback(cdp, fallbackStep)
      }
    } else {
      await domFallback(cdp, fallbackStep)
    }
  }

  // 1. welcome (no repo opened yet; the profile is always fresh)
  await drive(`${HOOK}.setTheme("dark")`, 'dark')
  await drive(`${HOOK}.setPalette(false)`, 'none')
  await cdp.settle(700)
  const welcomeText = await cdp.eval('document.body.innerText')
  if (!/最近打开|打开仓库|打开一个本地仓库/.test(welcomeText)) {
    throw new Error(
      '应用启动后不是欢迎页（可能连到了残留实例或上一次的会话状态）：' +
        welcomeText.replace(/\s+/g, ' ').slice(0, 80)
    )
  }
  results.push(await cdp.shot(SHOTS[0]))

  // 2. open the demo repository and capture the main sections
  let opened = false
  if (hookReady) {
    opened = Boolean(await cdp.eval(`${HOOK}.openRepo(${JSON.stringify(REPO)})`, { timeoutMs: 90000 }))
    if (!opened) throw new Error('openRepo 失败：' + REPO)
    await cdp.eval(`${HOOK}.waitReady()`, { timeoutMs: 60000 })
    await cdp.settle(900)
    if (process.env.MIAOXIN_SHOOT_DEBUG) {
      log('post-open DOM:', await cdp.eval(`document.body.innerText.slice(0, 120)`))
    }
  } else {
    throw new Error('测试钩子不可用，无法打开仓库；请确认 App.tsx 暴露 window.__miaoxinTest')
  }

  const steps = [
    { file: SHOTS[1], section: 'changes', theme: 'dark', changesFile: '中文说明.md' },
    { file: SHOTS[2], section: 'history', theme: 'dark', historyCommit: 'midpoint' },
    { file: SHOTS[3], section: 'branches', theme: 'dark' },
    { file: SHOTS[4], section: 'remotes', theme: 'dark' },
    { file: SHOTS[5], section: 'remotes', theme: 'dark', palette: true },
    { file: SHOTS[6], section: 'history', theme: 'light', historyCommit: 'midpoint' },
    { file: SHOTS[7], section: 'changes', theme: 'light', changesFile: '中文说明.md' }
  ]

  for (const step of steps) {
    await drive(`${HOOK}.setTheme("${step.theme}")`, step.theme)
    await drive(`${HOOK}.setSection("${step.section}")`, step.section)
    if (step.palette) {
      await drive(`${HOOK}.setPalette(true)`, 'palette')
      await cdp.waitUntil('document.querySelector("[role=dialog], .arb-palette")', {
        timeoutMs: 8000,
        label: 'command palette open'
      }).catch(() => undefined)
    } else {
      await drive(`${HOOK}.setPalette(false)`, 'none')
    }
    // wait for lazily loaded section content (Suspense fallback) to disappear
    await cdp
      .waitUntil('!document.querySelector(".section-loading")', { timeoutMs: 10000, label: 'section content' })
      .catch(() => undefined)
    await cdp.settle(step.section === 'history' ? 900 : 600)
    if (step.changesFile) {
      const hasChip = await selectChangeFile(cdp, step.changesFile)
      if (!hasChip) log(`警告：${step.changesFile} 未出现编码 chip（截图可能缺少 GBK 标记）`)
    }
    if (step.historyCommit) {
      const hasDiff = await selectHistoryCommit(cdp, step.historyCommit)
      if (!hasDiff) log('警告：历史详情未展开 diff（截图可能缺少 diff 内容）')
    }
    results.push(await cdp.shot(step.file))
  }

  await runLayoutChecks(cdp)

  const bad = results.filter((r) => !r.ok)
  log(`done: ${results.length} screenshots -> ${path.relative(ROOT, OUT_DIR)}`)
  if (bad.length) log(`警告：${bad.length} 张截图尺寸与 ${WIDTH}x${HEIGHT}@${DSF} 不一致（页面布局被限制或窗口过小）`)
  if (!hookReady) log('警告：本次运行使用 DOM 兜底，部分画面可能不是完整 UI')
} finally {
  stopping = true
  if (child && !KEEP) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 20000 })
      } catch {
        /* already gone */
      }
    } else {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    log('electron stopped')
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* profile cleanup is best-effort */
    }
  }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[shoot] 失败：' + error.message)
    process.exit(1)
  })

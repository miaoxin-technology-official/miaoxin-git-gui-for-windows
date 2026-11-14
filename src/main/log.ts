// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

let logFile: string | null = null

export function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

export function logPath(): string {
  if (!logFile) logFile = path.join(logsDir(), 'main.log')
  return logFile
}

export function logLine(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  try {
    fs.mkdirSync(logsDir(), { recursive: true })
    fs.appendFileSync(logPath(), `${line}\n`, 'utf8')
  } catch {
    /* logging must never break the app */
  }
  console.log(line)
}

export function logError(context: string, error: unknown): void {
  if (error instanceof Error) {
    logLine(`${context}: ${error.message}\n${error.stack ?? ''}`)
  } else {
    logLine(`${context}: ${String(error)}`)
  }
}

export function startupSummary(): void {
  logLine(
    `startup version=${app.getVersion()} electron=${process.versions.electron} chrome=${process.versions.chrome} ` +
      `node=${process.versions.node} platform=${process.platform} arch=${process.arch} ` +
      `resources=${process.resourcesPath} userData=${app.getPath('userData')}`
  )
}

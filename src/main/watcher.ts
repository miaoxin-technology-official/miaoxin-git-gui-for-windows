// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { RepoChangeEvent } from '@shared/types'
import { store } from './store'

type Listener = (event: RepoChangeEvent) => void

/**
 * Lightweight repository watcher.
 *
 * Git does not expose a portable watch API on Windows, so we poll a cheap
 * signature (index/HEAD/ref mtimes + a 300ms-cached `status` digest) and emit
 * only when it actually changes. This keeps idle CPU near zero for the common
 * case while still catching terminal commits within ~1.5s.
 */
class RepoWatcher {
  private timer: NodeJS.Timeout | null = null
  private repo: string | null = null
  private listener: Listener | null = null
  private lastSignature = ''
  private busy = false

  private gitPath(): string {
    return store.get().gitPath || 'git'
  }

  start(repo: string, listener: Listener): void {
    this.stop()
    this.repo = repo
    this.listener = listener
    this.lastSignature = ''
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 1500)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.repo = null
    this.listener = null
  }

  private signature(repo: string): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn(this.gitPath(), ['-C', repo, 'status', '--porcelain=v2', '--branch', '--untracked-files=all'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      let out = ''
      child.stdout.on('data', (d) => (out += String(d)))
      child.on('error', () => resolve(''))
      child.on('close', () => resolve(out))
      setTimeout(() => child.kill(), 5000)
    })
  }

  private mtimes(repo: string): string {
    const gitDir = path.join(repo, '.git')
    const parts: string[] = []
    for (const rel of ['index', 'HEAD', 'refs/heads', 'ORIG_HEAD', 'MERGE_HEAD', 'REBASE_HEAD']) {
      try {
        parts.push(String(fs.statSync(path.join(gitDir, rel)).mtimeMs))
      } catch {
        parts.push('-')
      }
    }
    return parts.join(',')
  }

  private async tick(): Promise<void> {
    if (!this.repo || this.busy || !this.listener) return
    this.busy = true
    try {
      const status = await this.signature(this.repo)
      const sig = `${this.mtimes(this.repo)}|${status}`
      if (this.lastSignature && sig !== this.lastSignature) {
        this.listener({ repo: this.repo, reason: 'worktree' })
      }
      this.lastSignature = sig
    } finally {
      this.busy = false
    }
  }
}

export const repoWatcher = new RepoWatcher()

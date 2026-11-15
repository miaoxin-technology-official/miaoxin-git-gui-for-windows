// SPDX-License-Identifier: AGPL-3.0-or-later
import { app } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UpdateCheckResult, UpdateDownloadResult } from '@shared/types'
import { compareSemver, parseSemver, pickLatest } from './semver'

const OWNER = 'miaoxin-technology-official'
const REPO = 'miaoxin-git-gui-for-windows'
const API = `https://api.github.com/repos/${OWNER}/${REPO}/tags`
const MAX_PAGES = 10
const CACHE_MS = 60 * 1000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Miaoxin-Git-GUI'
        },
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        throw new Error(
          `GitHub API 返回 ${response.status}${response.status === 403 ? '（可能触发速率限制，请稍后再试）' : ''}`
        )
      }
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await sleep(700 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchAllTags(): Promise<string[]> {
  const tags: string[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = (await fetchJson(`${API}?per_page=100&page=${page}`)) as Array<{ name?: string }>
    if (!Array.isArray(data)) throw new Error('GitHub API 返回格式异常')
    for (const item of data) {
      if (item && typeof item.name === 'string') tags.push(item.name)
    }
    if (data.length < 100) break
  }
  return tags
}

let cached: { at: number; preview: boolean; result: UpdateCheckResult } | null = null

export async function checkForUpdates(preview: boolean): Promise<UpdateCheckResult> {
  if (cached && cached.preview === preview && Date.now() - cached.at < CACHE_MS) return cached.result
  const checkedAt = Date.now()
  const current = parseSemver(app.getVersion())
  try {
    const tags = await fetchAllTags()
    const { latest, latestStable } = pickLatest(tags, preview)
    const updateAvailable = Boolean(current && latest && compareSemver(latest, current) > 0)
    const result: UpdateCheckResult = {
      currentVersion: app.getVersion(),
      latestVersion: latest ? latest.tag.replace(/^v/i, '') : null,
      latestTag: latest?.tag ?? null,
      latestStable: latestStable?.tag ?? null,
      updateAvailable,
      preview,
      totalTags: tags.length,
      checkedAt
    }
    cached = { at: checkedAt, preview, result }
    return result
  } catch (error) {
    const result: UpdateCheckResult = {
      currentVersion: app.getVersion(),
      latestVersion: null,
      latestTag: null,
      latestStable: null,
      updateAvailable: false,
      preview,
      totalTags: 0,
      checkedAt,
      error: error instanceof Error ? error.message : String(error)
    }
    return result
  }
}

export function releaseUrl(tag: string): string {
  return `https://github.com/${OWNER}/${REPO}/releases/tag/${encodeURIComponent(tag)}`
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  digest?: string | null
}

function parseSha256(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /(?:sha256:)?([a-f0-9]{64})/i.exec(value)
  return match ? match[1].toLowerCase() : null
}

/**
 * Download the installer for a tag, verify its SHA-256 against the digest that
 * GitHub exposes for the release asset (or a checksum asset), then launch it.
 */
export async function downloadUpdate(tag: string): Promise<UpdateDownloadResult> {
  const version = tag.replace(/^v/i, '')
  const expectedName = `MiaoxinGitGUI-${version}-for-Windows-setup.exe`
  try {
    const releaseResponse = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Miaoxin-Git-GUI' },
        signal: AbortSignal.timeout(20000)
      }
    )
    if (!releaseResponse.ok) {
      return { ok: false, error: `无法读取 release（${releaseResponse.status}）` }
    }
    const release = (await releaseResponse.json()) as { assets?: ReleaseAsset[] }
    const assets = Array.isArray(release.assets) ? release.assets : []
    const asset =
      assets.find((item) => item.name.toLowerCase() === expectedName.toLowerCase()) ??
      assets.find((item) => /for-Windows-setup\.exe$/i.test(item.name))
    if (!asset) return { ok: false, error: `release 中没有找到安装包 ${expectedName}` }

    let expected = parseSha256(asset.digest)
    if (!expected) {
      const checksumAsset = assets.find((item) => /sha256|checksums?\.txt$/i.test(item.name))
      if (checksumAsset) {
        const checksumResponse = await fetch(checksumAsset.browser_download_url, {
          headers: { 'User-Agent': 'Miaoxin-Git-GUI' },
          signal: AbortSignal.timeout(20000)
        })
        if (checksumResponse.ok) {
          const text = await checksumResponse.text()
          for (const line of text.split(/\r?\n/)) {
            if (!line.toLowerCase().includes(asset.name.toLowerCase())) continue
            const match = /([a-f0-9]{64})/i.exec(line)
            if (match) {
              expected = match[1].toLowerCase()
              break
            }
          }
        }
      }
    }
    if (!expected) {
      return { ok: false, error: '发布页没有提供安装包 SHA-256，已取消自动更新，请手动下载。' }
    }

    const target = path.join(os.tmpdir(), expectedName)
    const downloadResponse = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'Miaoxin-Git-GUI' }
    })
    if (!downloadResponse.ok) return { ok: false, error: `下载失败（${downloadResponse.status}）` }
    const buffer = Buffer.from(await downloadResponse.arrayBuffer())
    const actual = crypto.createHash('sha256').update(buffer).digest('hex')
    if (actual !== expected) return { ok: false, error: '安装包 SHA-256 校验失败，已取消安装。' }
    fs.writeFileSync(target, buffer)
    const child = spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

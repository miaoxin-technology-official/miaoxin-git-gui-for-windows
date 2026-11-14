import { app } from 'electron'
import type { UpdateCheckResult } from '@shared/types'

const OWNER = 'miaoxin-technology-official'
const REPO = 'miaoxin-git-gui-for-windows'
const API = `https://api.github.com/repos/${OWNER}/${REPO}/tags`
const MAX_PAGES = 10
const CACHE_MS = 60 * 1000

interface Semver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  tag: string
}

function parseSemver(tag: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    tag
  }
}

/** SemVer precedence: stable > prerelease, numeric identifiers compare numerically. */
function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff
    } else if (nx !== ny) {
      return nx ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return a.prerelease.length - b.prerelease.length
}

function isPrerelease(tag: string): boolean {
  return /-(?:rc|beta|alpha)(?:[.\-]|$)/i.test(tag)
}

function isRc(tag: string): boolean {
  return /-rc(?:[.\-]|$)/i.test(tag)
}

async function fetchAllTags(): Promise<string[]> {
  const tags: string[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetch(`${API}?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Miaoxin-Git-GUI'
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      throw new Error(`GitHub API 返回 ${response.status}${response.status === 403 ? '（可能触发速率限制，请稍后再试）' : ''}`)
    }
    const data = (await response.json()) as Array<{ name?: string }>
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
    const parsed = tags.map(parseSemver).filter((item): item is Semver => item !== null)
    const stable = parsed.filter((item) => item.prerelease.length === 0 && !isPrerelease(item.tag))
    const candidates = preview
      ? parsed.filter((item) => (item.prerelease.length === 0 && !isPrerelease(item.tag)) || isRc(item.tag))
      : stable
    candidates.sort((a, b) => compareSemver(b, a))
    stable.sort((a, b) => compareSemver(b, a))
    const latest = candidates[0] ?? null
    const latestStable = stable[0] ?? null
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

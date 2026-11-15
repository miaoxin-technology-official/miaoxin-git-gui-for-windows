// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SemverVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  tag: string
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function splitPrerelease(value: string): string[] {
  return value.split(/[.-]/).flatMap((identifier) => {
    const match = /^([A-Za-z]+)(\d+)$/.exec(identifier)
    return match ? [match[1], match[2]] : [identifier]
  })
}

export function parseSemver(tag: string): SemverVersion | null {
  const match = SEMVER_RE.exec(tag.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? splitPrerelease(match[4]) : [],
    tag
  }
}

/** SemVer precedence; a stable release always sorts above its own prerelease. */
export function compareSemver(a: SemverVersion, b: SemverVersion): number {
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

export function isPrerelease(tag: string): boolean {
  return /-(?:rc|beta|alpha)(?:\d|[.-]|$)/i.test(tag)
}

export function isRc(tag: string): boolean {
  return /-rc(?:\d|[.-]|$)/i.test(tag)
}

export interface LatestVersions {
  latest: SemverVersion | null
  latestStable: SemverVersion | null
  parsed: SemverVersion[]
}

/**
 * Stable releases are always ranked by SemVer; in preview mode only `-rc`
 * prereleases are additionally considered (beta/alpha stay filtered). Because
 * compareSemver ranks 2.3.5 above 2.3.5-rc1, a published stable release wins
 * over its own release candidate even when preview mode is enabled.
 */
export function pickLatest(tags: string[], preview: boolean): LatestVersions {
  const parsed = tags.map(parseSemver).filter((item): item is SemverVersion => item !== null)
  const stable = parsed.filter((item) => item.prerelease.length === 0 && !isPrerelease(item.tag))
  const candidates = preview
    ? parsed.filter((item) => (item.prerelease.length === 0 && !isPrerelease(item.tag)) || isRc(item.tag))
    : stable
  candidates.sort((a, b) => compareSemver(b, a))
  stable.sort((a, b) => compareSemver(b, a))
  return { latest: candidates[0] ?? null, latestStable: stable[0] ?? null, parsed }
}

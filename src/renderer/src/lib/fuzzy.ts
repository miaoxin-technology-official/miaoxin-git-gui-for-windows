export interface FuzzyResult {
  score: number
  ranges: Array<[number, number]>
}

/** Subsequence matcher tuned for short labels: contiguous runs and word starts score higher. */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, ranges: [] }
  const t = text.toLowerCase()
  const ranges: Array<[number, number]> = []
  let score = 0
  let tIndex = 0
  let lastMatch = -2

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue
    let found = -1
    for (let i = tIndex; i < t.length; i++) {
      if (t[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return null
    if (found === lastMatch + 1) score += 8
    if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '-' || t[found - 1] === '/' || t[found - 1] === '.') {
      score += 6
    }
    score -= Math.min(found - tIndex, 8)
    const last = ranges[ranges.length - 1]
    if (last && last[1] === found) last[1] = found + 1
    else ranges.push([found, found + 1])
    lastMatch = found
    tIndex = found + 1
  }

  score += Math.max(0, 24 - t.length) * 0.4
  return { score, ranges }
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string): T[] {
  if (!query.trim()) return items
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const result = fuzzyMatch(query, key(item))
    if (result) scored.push({ item, score: result.score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item)
}

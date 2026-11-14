// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Lane layout for the History commit graph.
 *
 * The graph is computed over the *loaded* window of commits only: a parent that
 * is not part of the loaded list does not open a lane (this keeps search
 * results and the tail of a paginated log tidy — no dangling lines).
 */
import type { Commit } from '@shared/types'

export const GRAPH_WIDTH = 72
export const MAX_LANES = 8
const PAD = 14
const MAX_GAP = 14

export interface GraphEdge {
  fromLane: number
  toLane: number
  color: number
}

export interface GraphParent {
  lane: number
  color: number
}

export interface GraphRow {
  /** Lane of this commit (index in the row's top coordinates). */
  lane: number
  color: number
  /** Whether the lane already existed above this row. */
  incoming: boolean
  merge: boolean
  /** Lanes running straight through this row (top → bottom). */
  edges: GraphEdge[]
  /** Parent lanes leaving this node towards the bottom. */
  parents: GraphParent[]
}

interface Slot {
  hash: string
  color: number
}

/** Horizontal center for a lane index; the lanes are centered inside the column. */
export function laneX(lane: number, laneCount: number): number {
  const count = Math.max(1, laneCount)
  if (count === 1) return GRAPH_WIDTH / 2
  const gap = Math.min(MAX_GAP, (GRAPH_WIDTH - PAD * 2) / (count - 1))
  const span = gap * (count - 1)
  const start = (GRAPH_WIDTH - span) / 2
  return start + lane * gap
}

function pickColor(slots: Array<Slot | null>): number {
  const used = new Set<number>()
  for (const slot of slots) if (slot) used.add(slot.color)
  for (let color = 0; color < 8; color++) {
    if (!used.has(color)) return color
  }
  return 0
}

export function buildGraph(commits: Commit[]): { rows: GraphRow[]; laneCount: number } {
  const present = new Set(commits.map((commit) => commit.hash))
  const rows: GraphRow[] = []
  let lanes: Array<Slot | null> = []
  let highestLane = 0

  for (const commit of commits) {
    let lane = lanes.findIndex((slot) => slot?.hash === commit.hash)
    let incoming = true

    if (lane === -1) {
      incoming = false
      lane = lanes.findIndex((slot) => slot === null)
      if (lane === -1 && lanes.length < MAX_LANES) {
        lanes.push(null)
        lane = lanes.length - 1
      }
      if (lane === -1) lane = MAX_LANES - 1
      lanes[lane] = { hash: commit.hash, color: pickColor(lanes) }
    }

    const node = lanes[lane] as Slot
    const before = lanes
    const next: Array<Slot | null> = lanes.slice()
    next[lane] = null

    const outgoing: Array<{ lane: number; color: number }> = []
    const parents = commit.parents.filter((parent) => present.has(parent))
    parents.forEach((parent, index) => {
      let idx = next.findIndex((slot) => slot?.hash === parent)
      if (idx === -1) {
        idx = next.findIndex((slot) => slot === null)
        if (idx === -1 && next.length < MAX_LANES) {
          next.push(null)
          idx = next.length - 1
        }
        if (idx === -1) return
        next[idx] = { hash: parent, color: index === 0 ? node.color : pickColor(next) }
      }
      const slot = next[idx]
      if (slot) outgoing.push({ lane: idx, color: slot.color })
    })

    const compact: Slot[] = []
    const indexMap = new Map<number, number>()
    next.forEach((slot, i) => {
      if (!slot) return
      indexMap.set(i, compact.length)
      compact.push(slot)
    })

    const edges: GraphEdge[] = []
    before.forEach((slot, i) => {
      if (!slot || i === lane) return
      const mapped = indexMap.get(i)
      if (mapped === undefined) return
      edges.push({ fromLane: i, toLane: mapped, color: slot.color })
    })

    const parentLanes: GraphParent[] = []
    for (const out of outgoing) {
      const mapped = indexMap.get(out.lane)
      if (mapped === undefined) continue
      if (parentLanes.some((parent) => parent.lane === mapped)) continue
      parentLanes.push({ lane: mapped, color: out.color })
    }

    rows.push({
      lane,
      color: node.color,
      incoming,
      merge: commit.parents.length > 1,
      edges,
      parents: parentLanes
    })

    highestLane = Math.max(
      highestLane,
      lane,
      ...edges.map((edge) => edge.fromLane),
      ...edges.map((edge) => edge.toLane),
      ...parentLanes.map((parent) => parent.lane)
    )
    lanes = compact
  }

  return { rows, laneCount: Math.max(1, Math.min(MAX_LANES, highestLane + 1)) }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProgressEvent } from '@shared/types'
import { api } from '@/lib/api'

export type ConsoleStream = 'stdout' | 'stderr' | 'system'

export interface ConsoleLine {
  id: number
  stream: ConsoleStream
  text: string
}

function normalizeRepo(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function matchesRepo(eventRepo: string, current: string | null): boolean {
  if (!eventRepo || !current) return true
  return normalizeRepo(eventRepo) === normalizeRepo(current)
}

/**
 * Subscribes to `api.events.onProgress` for the current repository and keeps the
 * latest 500 console lines. `onDone` fires once per finished operation so the
 * caller can refresh the store.
 */
export function useProgressConsole(
  repoPath: string | null,
  onDone: () => void
): {
  lines: ConsoleLine[]
  running: boolean
  title: string | null
  append: (stream: ConsoleStream, text: string) => void
  clear: () => void
} {
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [running, setRunning] = useState(false)
  const [title, setTitle] = useState<string | null>(null)
  const seq = useRef(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const repoRef = useRef(repoPath)
  repoRef.current = repoPath

  const append = useCallback((stream: ConsoleStream, text: string) => {
    setLines((prev) => {
      const next = [...prev]
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\r/g, '')
        if (!line.trim()) continue
        seq.current += 1
        next.push({ id: seq.current, stream, text: line })
      }
      return next.slice(-500)
    })
  }, [])

  const clear = useCallback(() => setLines([]), [])

  useEffect(() => {
    const off = api.events.onProgress((event: ProgressEvent) => {
      if (!matchesRepo(event.repo, repoRef.current)) return
      if (event.title) setTitle(event.title)
      if (event.line) append(event.stream, event.line)
      if (event.done) {
        setRunning(false)
        if (event.error) append('system', `操作失败：${event.error}`)
        onDoneRef.current()
      } else {
        setRunning(true)
      }
    })
    return off
  }, [append])

  return { lines, running, title, append, clear }
}

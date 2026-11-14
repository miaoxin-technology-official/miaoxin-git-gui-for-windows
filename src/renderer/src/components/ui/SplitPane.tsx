// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

interface SplitPaneProps {
  initial: number
  min?: number
  max?: number
  left: React.ReactNode
  right: React.ReactNode
  storageKey?: string
  className?: string
}

/** Horizontal split with a 1px handle; width is persisted when storageKey is set. */
export function SplitPane({
  initial,
  min = 260,
  max = 920,
  left,
  right,
  storageKey,
  className
}: SplitPaneProps): React.JSX.Element {
  const [width, setWidth] = useState(() => {
    if (!storageKey) return initial
    const raw = window.localStorage.getItem(`arbor.split.${storageKey}`)
    return raw ? Number(raw) || initial : initial
  })
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!storageKey) return
    window.localStorage.setItem(`arbor.split.${storageKey}`, String(width))
  }, [width, storageKey])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const next = Math.min(max, Math.max(min, e.clientX - rect.left))
      setWidth(next)
    }
    const onUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [min, max])

  return (
    <div ref={containerRef} className={cn('arb-split', className)}>
      <div className="arb-split-left" style={{ width }}>
        {left}
      </div>
      <div
        className="arb-split-handle"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
        onDoubleClick={() => setWidth(initial)}
      />
      <div className="arb-split-right">{right}</div>
    </div>
  )
}

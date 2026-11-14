// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/Feedback'
import type { ConsoleLine } from './progress'
import '@/styles/remotes.css'

export function ProgressConsole({
  lines,
  running,
  title,
  open,
  onToggle,
  onClear
}: {
  lines: ConsoleLine[]
  running: boolean
  title: string | null
  open: boolean
  onToggle: () => void
  onClear: () => void
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const element = bodyRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines, open])

  return (
    <div className={cn('remotes-console', open && 'is-open')}>
      <div className="remotes-console-hd">
        {open ? (
          <>
            <span className="remotes-console-title">
              <Terminal size={12} strokeWidth={1.7} />
              输出
              {title ? <span className="remotes-console-op truncate">{title}</span> : null}
            </span>
            {running ? <Spinner size={12} /> : null}
            <span className="remotes-console-spacer" />
            <span className="remotes-console-count num">{lines.length} 行</span>
            <button
              type="button"
              className="remotes-console-action"
              onClick={onClear}
              disabled={lines.length === 0}
            >
              清空
            </button>
          </>
        ) : (
          <>
            <span className="remotes-console-summary">
              <Terminal size={12} strokeWidth={1.7} />
              输出 · {lines.length} 行
            </span>
            {running ? <Spinner size={12} /> : null}
            <span className="remotes-console-spacer" />
          </>
        )}
        <button
          type="button"
          className="arb-iconbtn remotes-console-toggle"
          title={open ? '收起输出' : '展开输出'}
          aria-label={open ? '收起输出' : '展开输出'}
          onClick={onToggle}
        >
          {open ? <ChevronDown size={14} strokeWidth={1.7} /> : <ChevronUp size={14} strokeWidth={1.7} />}
        </button>
      </div>
      {open ? (
        <div className="remotes-console-body scroll-y" ref={bodyRef}>
          {lines.length === 0 ? (
            <div className="remotes-console-empty">等待远程操作输出。fetch / pull / push 的流式输出会显示在这里。</div>
          ) : (
            lines.map((line) => (
              <div key={line.id} className={cn('remotes-console-line', `is-${line.stream}`)}>
                {line.text}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

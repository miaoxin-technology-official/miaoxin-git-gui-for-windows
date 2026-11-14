import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/store/app'
import { Button } from './Button'

/* ---------------------------------------------------------------- toasts */

export function Toaster(): React.JSX.Element {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  return (
    <div className="arb-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn('arb-toast', `is-${toast.kind}`)}>
          <span className="arb-toast-icon" aria-hidden>
            {toast.kind === 'error' ? (
              <AlertTriangle size={14} strokeWidth={1.8} />
            ) : toast.kind === 'success' ? (
              <Check size={14} strokeWidth={2} />
            ) : (
              <Info size={14} strokeWidth={1.8} />
            )}
          </span>
          <span className="arb-toast-message">{toast.message}</span>
          <button type="button" className="arb-toast-close" aria-label="关闭提示" onClick={() => dismiss(toast.id)}>
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function useToast(): { toast: (message: string, kind?: 'info' | 'success' | 'error') => void } {
  const push = useAppStore((s) => s.pushToast)
  return { toast: push }
}

/* ---------------------------------------------------------------- banner */

export function Banner({
  kind = 'info',
  children,
  actions,
  className
}: {
  kind?: 'info' | 'warn' | 'error' | 'success'
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const Icon = kind === 'warn' || kind === 'error' ? AlertTriangle : kind === 'success' ? Check : Info
  return (
    <div className={cn('arb-banner', `is-${kind}`, className)} role="status">
      <Icon size={14} strokeWidth={1.8} className="arb-banner-icon" />
      <div className="arb-banner-content">{children}</div>
      {actions ? <div className="arb-banner-actions">{actions}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------ empty state */

type ArtKind = 'repo' | 'changes' | 'history' | 'branches' | 'search' | 'stash' | 'tags'

const ART: Record<ArtKind, React.ReactNode> = {
  repo: (
    <>
      <path d="M14 20v20a6 6 0 0 0 6 6h12" />
      <path d="M14 20h20a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V20Z" opacity=".45" />
      <circle cx="20" cy="26" r="2" />
      <circle cx="20" cy="40" r="2" />
    </>
  ),
  changes: (
    <>
      <rect x="16" y="14" width="26" height="32" rx="3" opacity=".55" />
      <path d="M22 24h14M22 30h14M22 36h8" opacity=".8" />
      <circle cx="42" cy="42" r="9" />
      <path d="M42 38v8M38 42h8" />
    </>
  ),
  history: (
    <>
      <path d="M18 16v28a5 5 0 0 0 5 5h1" opacity=".6" />
      <circle cx="24" cy="16" r="2.6" />
      <circle cx="24" cy="31" r="2.6" />
      <circle cx="24" cy="46" r="2.6" />
      <path d="M30 16h20M30 31h20M30 46h14" opacity=".6" />
    </>
  ),
  branches: (
    <>
      <path d="M20 14v26" opacity=".6" />
      <circle cx="20" cy="14" r="2.6" />
      <circle cx="20" cy="40" r="2.6" />
      <path d="M20 24c10 0 14 5 14 12v2" opacity=".8" />
      <circle cx="34" cy="42" r="2.6" />
      <path d="M20 33c8 0 8 7 8 7" opacity=".4" />
    </>
  ),
  search: (
    <>
      <circle cx="27" cy="26" r="11" />
      <path d="m35 34 10 10" />
      <path d="M22 26h10M27 21v10" opacity=".35" />
    </>
  ),
  stash: (
    <>
      <path d="M16 20h32v10H16z" opacity=".5" />
      <path d="M16 36h32v10H16z" opacity=".8" />
      <path d="M24 25h16M24 41h16" opacity=".4" />
    </>
  ),
  tags: (
    <>
      <path d="M16 20v14l12 12 14-14V18H20" opacity=".55" />
      <circle cx="38" cy="24" r="2.4" />
    </>
  )
}

export function EmptyState({
  art = 'repo',
  title,
  desc,
  actions,
  className
}: {
  art?: ArtKind
  title: string
  desc?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('empty', className)}>
      <svg className="empty-art" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {ART[art]}
      </svg>
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  )
}

/* --------------------------------------------------------------- loading */

export function Spinner({ size = 16, className }: { size?: number; className?: string }): React.JSX.Element {
  return <Loader2 size={size} strokeWidth={1.8} className={cn('arb-spin', className)} />
}

export function ProgressBar({ value = 0 }: { value?: number }): React.JSX.Element {
  return (
    <div className="arb-progress">
      <div className="arb-progress-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

/** Shared loading row used by the section views. */
export function LoadingBlock({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="arb-loading-block">
      <Spinner />
      {label ? <span>{label}</span> : null}
    </div>
  )
}

export { Button }

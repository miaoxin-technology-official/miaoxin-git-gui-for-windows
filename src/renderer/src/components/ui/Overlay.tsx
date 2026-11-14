// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

/* --------------------------------------------------------------- helpers */

function useEscape(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, onClose])
}

/* ----------------------------------------------------------------- modal */

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  width?: number
  children?: ReactNode
  footer?: ReactNode
  className?: string
  bare?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 520,
  children,
  footer,
  className,
  bare
}: ModalProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => {
      const el = dialogRef.current
      if (!el) return
      const focusable = el.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }, 30)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="arb-modal-layer" role="presentation">
      <div className="arb-modal-backdrop" onMouseDown={onClose} />
      <div
        ref={dialogRef}
        className={cn('arb-modal', className)}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return
          const el = dialogRef.current
          if (!el) return
          const nodes = Array.from(
            el.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
            )
          ).filter((n) => n.offsetParent !== null)
          if (nodes.length === 0) return
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        {bare ? (
          children
        ) : (
          <>
            <header className="arb-modal-hd">
              <div className="arb-modal-heading">
                {title ? <h2 className="arb-modal-title">{title}</h2> : null}
                {subtitle ? <p className="arb-modal-subtitle">{subtitle}</p> : null}
              </div>
              <button type="button" className="arb-modal-close" onClick={onClose} aria-label="关闭">
                <X size={15} strokeWidth={1.7} />
              </button>
            </header>
            <div className="arb-modal-body">{children}</div>
            {footer ? <footer className="arb-modal-ft">{footer}</footer> : null}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger,
  loading,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="arb-confirm-desc">{description}</div>
    </Modal>
  )
}

/* --------------------------------------------------------------- popover */

export interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  width?: number
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}

export function Popover({
  trigger,
  children,
  width = 240,
  align = 'start',
  side = 'bottom',
  className,
  open: controlledOpen,
  onOpenChange,
  disabled
}: PopoverProps): React.JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(
      Math.max(margin, align === 'start' ? rect.left : rect.right - width),
      window.innerWidth - width - margin
    )
    setPos({
      top: side === 'bottom' ? rect.bottom + 5 : rect.top - 5,
      left
    })
  }, [open, align, width, side])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onBlur = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onBlur)
    document.addEventListener('scroll', onBlur, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onBlur)
      document.removeEventListener('scroll', onBlur, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <span
        ref={anchorRef}
        className="arb-popover-anchor"
        onClick={() => {
          if (!disabled) setOpen(!open)
        }}
      >
        {trigger}
      </span>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className={cn('arb-popover', className)}
              style={{
                top: pos.top,
                left: pos.left,
                width,
                transform: side === 'top' ? 'translateY(-100%)' : undefined
              }}
              role="dialog"
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/* ------------------------------------------------------------------ menu */

export interface MenuItem {
  id: string
  label?: string
  icon?: LucideIcon
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export function Menu({
  items,
  onSelect,
  trigger,
  width = 220,
  align = 'start'
}: {
  items: MenuItem[]
  onSelect: (id: string) => void
  trigger?: ReactNode
  width?: number
  align?: 'start' | 'end'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} width={width} align={align}>
      <div className="arb-menu" role="menu">
        {items.map((item, i) =>
          item.separator ? (
            <div key={`sep-${i}`} className="arb-menu-sep" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn('arb-menu-item', item.danger && 'is-danger')}
              onClick={() => {
                setOpen(false)
                onSelect(item.id)
              }}
            >
              {item.icon ? <item.icon size={14} strokeWidth={1.7} className="arb-menu-icon" /> : <span className="arb-menu-icon" />}
              <span className="arb-menu-label">{item.label}</span>
              {item.shortcut ? <span className="arb-menu-shortcut">{item.shortcut}</span> : null}
            </button>
          )
        )}
      </div>
    </Popover>
  )
}

/* --------------------------------------------------------------- tooltip */

export function Tooltip({
  label,
  children,
  className
}: {
  label: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('arb-tooltip', className)}>
      {children}
      <span className="arb-tooltip-label">{label}</span>
    </span>
  )
}

/** Kept for callers that want to inject an element into a Popover anchor. */
export function asTrigger(node: ReactNode): ReactNode {
  return isValidElement(node) ? cloneElement(node as ReactElement) : node
}

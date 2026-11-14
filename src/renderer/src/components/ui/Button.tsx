// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ButtonHTMLAttributes } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  full?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  full,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const iconSize = size === 'sm' ? 13 : 14
  return (
    <button
      type="button"
      className={cn('arb-btn', `arb-btn--${variant}`, `arb-btn--${size}`, full && 'is-full', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} className="arb-btn-spin" strokeWidth={1.8} />
      ) : Icon ? (
        <Icon size={iconSize} strokeWidth={1.7} />
      ) : null}
      {children ? <span className="arb-btn-label">{children}</span> : null}
      {IconRight ? <IconRight size={iconSize} strokeWidth={1.7} className="arb-btn-icon-right" /> : null}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: number
  variant?: 'ghost' | 'secondary' | 'danger'
}

export function IconButton({
  icon: Icon,
  label,
  active,
  size = 28,
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn('arb-iconbtn', `arb-iconbtn--${variant}`, active && 'is-active', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon size={size >= 30 ? 16 : 15} strokeWidth={1.7} />
    </button>
  )
}

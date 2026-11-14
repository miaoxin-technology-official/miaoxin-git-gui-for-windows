// SPDX-License-Identifier: AGPL-3.0-or-later
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ------------------------------------------------------------------ text */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: ReactNode
  error?: string | null
  icon?: LucideIcon
  mono?: boolean
  size?: 'sm' | 'md'
  trailing?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, icon: Icon, mono, size = 'md', trailing, className, id, ...rest },
  ref
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className={cn('arb-field', size === 'sm' && 'arb-field--sm', className)}>
      {label ? (
        <label className="arb-field-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className={cn('arb-input-wrap', error && 'has-error')}>
        {Icon ? <Icon size={14} strokeWidth={1.7} className="arb-input-icon" /> : null}
        <input
          ref={ref}
          id={inputId}
          className={cn('arb-input', Icon && 'has-icon', mono && 'mono')}
          spellCheck={false}
          {...rest}
        />
        {trailing ? <div className="arb-input-trailing">{trailing}</div> : null}
      </div>
      {error ? <div className="arb-field-error">{error}</div> : hint ? <div className="arb-field-hint">{hint}</div> : null}
    </div>
  )
})

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: ReactNode
}

export function TextArea({ label, hint, className, id, rows = 4, ...rest }: TextAreaProps): React.JSX.Element {
  const autoId = useId()
  const areaId = id ?? autoId
  return (
    <div className={cn('arb-field', className)}>
      {label ? (
        <label className="arb-field-label" htmlFor={areaId}>
          {label}
        </label>
      ) : null}
      <textarea id={areaId} rows={rows} className="arb-input arb-textarea" spellCheck={false} {...rest} />
      {hint ? <div className="arb-field-hint">{hint}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------- checkbox */

export function Checkbox({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={cn('arb-check', disabled && 'is-disabled')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="arb-check-box" aria-hidden>
        <svg viewBox="0 0 12 12" width="10" height="10">
          <path d="M2.2 6.2 4.8 8.8 9.8 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label ? <span className="arb-check-label">{label}</span> : null}
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={cn('arb-switch', disabled && 'is-disabled')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="arb-switch-track" aria-hidden>
        <span className="arb-switch-thumb" />
      </span>
      {label ? <span className="arb-switch-label">{label}</span> : null}
    </label>
  )
}

/* ------------------------------------------------------------ segmented */

export interface SegmentOption<T extends string> {
  value: T
  label?: string
  icon?: LucideIcon
  title?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('arb-segmented', size === 'sm' && 'arb-segmented--sm', className)} role="group">
      {options.map((opt) => {
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title ?? opt.label}
            aria-pressed={value === opt.value}
            className={cn('arb-segment', value === opt.value && 'is-active')}
            onClick={() => onChange(opt.value)}
          >
            {Icon ? <Icon size={13} strokeWidth={1.7} /> : null}
            {opt.label ? <span>{opt.label}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------- select */

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  className?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className={cn('arb-select', className)}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} strokeWidth={1.8} className="arb-select-chevron" />
    </div>
  )
}

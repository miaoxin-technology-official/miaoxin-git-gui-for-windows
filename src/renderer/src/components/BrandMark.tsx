import { cn } from '@/lib/cn'

/** Mark: a trunk, one branch, three nodes. Small enough for a 16px title bar. */
export function BrandMark({ size = 16, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('arb-brandmark', className)}
      aria-hidden
    >
      <path
        d="M8.6 6.6v5.6c0 2.5 2 4.5 4.5 4.5h3.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="8.6" cy="5.2" r="2.1" fill="currentColor" />
      <circle cx="8.6" cy="19" r="1.85" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18.2" cy="16.7" r="2" className="arb-brandmark-accent" />
    </svg>
  )
}

import { shortcutLabel } from '@/lib/useHotkeys'

/** Renders a keyboard shortcut as a sequence of key caps. */
export function ShortcutHint({ combo }: { combo: string }): React.JSX.Element {
  const label = shortcutLabel(combo)
  const parts = label.includes('+') ? label.split('+') : label.split('')
  return (
    <span className="arb-shortcut">
      {parts.map((part, index) => (
        <kbd key={`${part}-${index}`} className="kbd">
          {part}
        </kbd>
      ))}
    </span>
  )
}

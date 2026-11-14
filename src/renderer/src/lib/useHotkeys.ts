// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from 'react'

type Handler = (event: KeyboardEvent) => void

interface HotkeyOptions {
  enabled?: boolean
  allowInInputs?: boolean
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop() ?? ''
  const needCtrl = parts.includes('mod') || parts.includes('ctrl') || parts.includes('cmd')
  const needShift = parts.includes('shift')
  const needAlt = parts.includes('alt')

  const ctrl = isMac ? event.metaKey : event.ctrlKey
  if (needCtrl !== ctrl) return false
  if (isMac && parts.includes('ctrl') && !event.ctrlKey) return false
  if (needShift !== event.shiftKey) return false
  if (needAlt !== event.altKey) return false

  const eventKey = event.key.toLowerCase()
  if (key === 'escape') return eventKey === 'escape'
  if (key === 'enter') return eventKey === 'enter'
  if (key === 'tab') return eventKey === 'tab'
  if (key === 'space') return event.code === 'Space'
  if (key === 'up' || key === 'down' || key === 'left' || key === 'right') return eventKey === `arrow${key}`
  return eventKey === key
}

export function useHotkeys(map: Record<string, Handler>, options: HotkeyOptions = {}): void {
  const { enabled = true, allowInInputs = false } = options
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (inField && !allowInInputs) return
      for (const [combo, handler] of Object.entries(mapRef.current)) {
        if (matches(event, combo)) {
          if (combo.includes('mod') || combo.includes('ctrl')) event.preventDefault()
          handler(event)
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, allowInInputs])
}

export function shortcutLabel(combo: string): string {
  const map: Record<string, string> = { mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: isMac ? '⇧' : 'Shift' }
  return combo
    .split('+')
    .map((part) => map[part] ?? (part === 'escape' ? 'Esc' : part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(isMac ? '' : '+')
}

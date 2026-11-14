// SPDX-License-Identifier: AGPL-3.0-or-later
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

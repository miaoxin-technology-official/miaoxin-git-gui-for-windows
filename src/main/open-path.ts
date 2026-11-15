// SPDX-License-Identifier: AGPL-3.0-or-later

let pending: string | null = null

export function setPendingOpenPath(path: string | null): void {
  pending = path
}

export function takePendingOpenPath(): string | null {
  const value = pending
  pending = null
  return value
}

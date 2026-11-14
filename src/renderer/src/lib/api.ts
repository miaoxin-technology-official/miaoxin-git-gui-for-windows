// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ArborApi } from '@shared/types'

export const api: ArborApi = window.arbor

export function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  message = message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
  message = message.replace(/^Error:\s*/, '')
  return message.trim() || '操作失败，请重试'
}

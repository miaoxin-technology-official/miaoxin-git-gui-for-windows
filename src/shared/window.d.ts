// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ArborApi } from './types'

declare global {
  interface Window {
    arbor: ArborApi
  }
}

export {}

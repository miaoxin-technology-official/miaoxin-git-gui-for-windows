import type { ArborApi } from './types'

declare global {
  interface Window {
    arbor: ArborApi
  }
}

export {}

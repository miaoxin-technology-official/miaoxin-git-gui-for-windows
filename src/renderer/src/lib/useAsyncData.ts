import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'

export interface AsyncData<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Small async loader with stale-response protection. `deps` should contain the
 * inputs that change what is fetched (repo path, selection, store version...).
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]): AsyncData<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const seq = useRef(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    loaderRef
      .current()
      .then((result) => {
        if (seq.current !== id) return
        setData(result)
        setError(null)
      })
      .catch((err) => {
        if (seq.current !== id) return
        setError(errorMessage(err))
      })
      .finally(() => {
        if (seq.current === id) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, error, reload }
}

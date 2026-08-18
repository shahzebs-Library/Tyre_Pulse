/**
 * useGoBack - screen-facing wrapper over lib/goBack's `backTo`.
 *
 * Returns a stable callback that leaves the current screen and can NEVER be a
 * no-op: it pops history when there is history, and otherwise replaces to
 * `fallback` (default: the Home hub).
 *
 *   const goBack = useGoBack()                 // -> back, else /(app)
 *   const goBack = useGoBack('/(app)/admin')   // -> back, else the admin hub
 */
import { useCallback } from 'react'
import { useRouter } from 'expo-router'

import { APP_HOME, BackCapableRouter, BackOutcome, backTo } from '../lib/goBack'

export function useGoBack(fallback: string = APP_HOME): () => BackOutcome {
  const router = useRouter()
  return useCallback(
    () => backTo(router as unknown as BackCapableRouter, fallback),
    [router, fallback],
  )
}

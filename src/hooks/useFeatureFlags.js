/**
 * useFeatureFlags — React binding for src/lib/featureFlags.js.
 *
 * Returns `{ flags, loading, isEnabled(key), refresh }`. While loading, flags
 * are the registry defaults (everything ON) so there is never a flash of
 * missing UI for existing users. Subscribes to the flag store, so a save in
 * the Settings panel re-renders every gated consumer immediately.
 *
 * `useFeatureGate(key)` is the one-liner enforcement hook: wrap a mount point
 * (nav item, route element, header widget) and render null when it's false.
 */

import { subscribeConfigurationScope, configurationGeneration } from '../lib/configurationStore'
import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_FLAGS,
  fetchFlags,
  isEnabled as isFlagEnabled,
  subscribe,
} from '../lib/featureFlags'

export function useFeatureFlags() {
  const [flags, setFlags] = useState(DEFAULT_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const unsubscribe = subscribe((next) => { if (active) setFlags(next) })
    const load = () => {
      const generation = configurationGeneration()
      return fetchFlags()
        .then((next) => { if (active && generation === configurationGeneration()) setFlags(next) })
        .finally(() => { if (active && generation === configurationGeneration()) setLoading(false) })
    }
    const unsubscribeScope = subscribeConfigurationScope(() => {
      setFlags(DEFAULT_FLAGS)
      setLoading(true)
      load()
    })
    load()
    return () => { active = false; unsubscribe(); unsubscribeScope() }
  }, [])

  const isEnabled = useCallback((key) => isFlagEnabled(flags, key), [flags])

  const refresh = useCallback(async () => {
    const generation = configurationGeneration()
    const next = await fetchFlags({ force: true })
    if (generation === configurationGeneration()) setFlags(next)
    return next
  }, [])

  return { flags, loading, isEnabled, refresh }
}

/** True when the feature is enabled for this organisation (defaults ON while loading). */
export function useFeatureGate(key) {
  const { isEnabled } = useFeatureFlags()
  return isEnabled(key)
}

export default useFeatureFlags

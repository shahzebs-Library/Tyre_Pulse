/**
 * useWakeLock.js — Screen Wake Lock API hook.
 *
 * Prevents the screen from sleeping while the user is actively
 * filling out a tyre inspection checklist on mobile.
 *
 * Falls back gracefully on browsers that don't support the API.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

export function useWakeLock() {
  const [isLocked,  setIsLocked]  = useState(false)
  const [supported, setSupported] = useState(false)
  const lockRef = useRef(null)

  useEffect(() => {
    setSupported('wakeLock' in navigator)
  }, [])

  const acquire = useCallback(async () => {
    if (!('wakeLock' in navigator)) return
    try {
      lockRef.current = await navigator.wakeLock.request('screen')
      setIsLocked(true)
      lockRef.current.addEventListener('release', () => {
        setIsLocked(false)
        lockRef.current = null
      })
    } catch {
      // NotAllowedError (document not visible) or not supported — ignore
    }
  }, [])

  const release = useCallback(async () => {
    if (lockRef.current) {
      try { await lockRef.current.release() } catch { /* ignore */ }
      lockRef.current = null
    }
    setIsLocked(false)
  }, [])

  // Re-acquire after page regains visibility (device woke from sleep)
  useEffect(() => {
    if (!isLocked) return
    const handler = async () => {
      if (document.visibilityState === 'visible' && !lockRef.current) {
        await acquire()
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [isLocked, acquire])

  // Release on unmount
  useEffect(() => {
    return () => {
      lockRef.current?.release().catch(() => {})
    }
  }, [])

  return { isLocked, supported, acquire, release }
}

/**
 * Minimal vibration helper — wraps navigator.vibrate with feature detection.
 * pattern: number (ms) | number[] ([vibrate, pause, vibrate, ...])
 */
export function vibrate(pattern) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern) } catch { /* ignore */ }
  }
}

/**
 * Badge API helper — set app badge to count, or clear it.
 */
export function setAppBadge(count) {
  if ('setAppBadge' in navigator) {
    try {
      if (count > 0) {
        navigator.setAppBadge(Math.min(count, 99)).catch(() => {})
      } else {
        navigator.clearAppBadge().catch(() => {})
      }
    } catch { /* ignore */ }
  }
}

/**
 * Web Share API helper — falls back to clipboard copy.
 * @param {{ title, text, url?, files? }} data
 * @returns {Promise<'shared'|'copied'|'unsupported'>}
 */
export async function shareOrCopy(data) {
  if (navigator.share) {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'shared' // user cancelled
    }
  }
  if (navigator.clipboard && data.text) {
    try {
      await navigator.clipboard.writeText(data.text)
      return 'copied'
    } catch { /* ignore */ }
  }
  return 'unsupported'
}

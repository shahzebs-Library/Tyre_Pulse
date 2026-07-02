/**
 * useNetworkSync
 *
 * Subscribes to expo-network state changes.
 * Automatically fires syncQueue() whenever connectivity is restored so
 * inspectors never have to manually trigger a sync from the Profile screen.
 *
 * Wire this into (app)/_layout.tsx so it is active for the entire
 * authenticated session.
 */

import { useEffect, useRef } from 'react'
import * as Network from 'expo-network'
import { syncQueue } from '../lib/offlineQueue'
import { syncRecordQueue } from '../lib/recordQueue'

/** Minimum ms between auto-sync attempts to avoid hammering the API */
const DEBOUNCE_MS = 3_000

export function useNetworkSync(): void {
  const lastSync = useRef<number>(0)
  const syncing   = useRef(false)

  async function attemptSync(): Promise<void> {
    if (syncing.current) return
    const now = Date.now()
    if (now - lastSync.current < DEBOUNCE_MS) return

    syncing.current = true
    lastSync.current = now
    try {
      await syncQueue()
      await syncRecordQueue()
    } catch {
      // Errors are handled inside syncQueue; swallow here to avoid unhandled rejections
    } finally {
      syncing.current = false
    }
  }

  useEffect(() => {
    let mounted = true

    // expo-network does not ship a built-in state listener like NetInfo,
    // so we poll on a short interval and check connectivity imperatively.
    // This keeps the dependency surface minimal (no extra native module) and
    // is consistent with the expo-network version already installed.
    const POLL_INTERVAL_MS = 10_000

    const poll = setInterval(async () => {
      if (!mounted) return
      try {
        const state = await Network.getNetworkStateAsync()
        if (state.isConnected && state.isInternetReachable) {
          attemptSync()
        }
      } catch {
        // Network check failed - device is likely offline; ignore
      }
    }, POLL_INTERVAL_MS)

    // Also attempt a sync immediately on mount in case there is already
    // connectivity and items are queued from a previous offline session.
    Network.getNetworkStateAsync()
      .then(state => {
        if (mounted && state.isConnected && state.isInternetReachable) {
          attemptSync()
        }
      })
      .catch(() => {})

    return () => {
      mounted = false
      clearInterval(poll)
    }
  }, [])
}

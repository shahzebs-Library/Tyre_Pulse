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
import { addNetworkStateListener } from 'expo-network'
import { syncQueue, getPendingCount } from '../lib/offlineQueue'
import { syncRecordQueue, getPendingRecordCount } from '../lib/recordQueue'

/** Minimum ms between auto-sync attempts to avoid hammering the API */
const DEBOUNCE_MS = 3_000

export function useNetworkSync(): void {
  const lastSync = useRef<number>(0)
  const syncing   = useRef(false)

  async function attemptSync(): Promise<void> {
    if (syncing.current) return
    const now = Date.now()
    if (now - lastSync.current < DEBOUNCE_MS) return

    // Skip the whole pass when there is nothing queued. Both sync functions
    // rewrite encrypted storage and sweep the filesystem, so running them on an
    // empty queue was pure battery burn for the majority of a shift.
    try {
      const [a, b] = await Promise.all([getPendingCount(), getPendingRecordCount()])
      if ((a || 0) + (b || 0) === 0) return
    } catch {
      // Counting failed; fall through and attempt the sync rather than skip it.
    }

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

    // Event-driven: sync when connectivity is actually RESTORED. This replaces a
    // 10-second setInterval that woke the device roughly 6 times a minute for a
    // whole shift, each tick rewriting encrypted storage and sweeping the
    // filesystem even with an empty queue. The old comment claimed expo-network
    // had no listener - that is not true of the installed version (8.0.8), and
    // components/SyncBanner.tsx already uses addNetworkStateListener.
    const sub = addNetworkStateListener(state => {
      if (!mounted) return
      if (state.isConnected && state.isInternetReachable) attemptSync()
    })

    // Safety net: a long, slow interval so a missed event can never strand queued
    // work forever. Two minutes instead of ten seconds is a 12x reduction in
    // wakeups while still draining the queue on its own if an event is dropped.
    const SAFETY_INTERVAL_MS = 120_000
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
    }, SAFETY_INTERVAL_MS)

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
      try { sub?.remove() } catch { /* listener already gone */ }
    }
  }, [])
}

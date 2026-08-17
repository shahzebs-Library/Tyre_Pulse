/**
 * useRealtime - Supabase postgres_changes subscriptions that auto-invalidate
 * TanStack Query caches.
 *
 * **`useRealtimeSync` IS DEAD AND IS NO LONGER MOUNTED. DO NOT RE-MOUNT IT.**
 *
 * The docstring below described the intent, and the intent never became true: the
 * TanStack Query layer it invalidates has no readers. Measured across src/: 231 pages,
 * and exactly two files call `useQuery` - `useBilling.js` and this hook's sibling
 * `useSupabaseQuery.js`, which is itself imported nowhere. So every key in
 * TABLE_QUERY_MAP (['tyres'], ['dashboard'], ['work-orders'], ['stock'] ...) is written
 * to and read by nobody. The only other references are two more *writers*
 * (TyreRecords.jsx `invalidate(['tyres'])`) and `sourceTables: ['inspections']` metadata
 * in the KPI registry, which is unrelated.
 *
 * It was not free. Supabase Realtime decodes WAL and runs `realtime.apply_rls()` per
 * change PER SUBSCRIBER, and these 12 channels opened on every page load for every
 * signed-in user. On this instance that WAL decoder is the largest single database
 * consumer by roughly 15x - 454,844 calls, ~90 minutes of CPU and 1.19 BILLION buffer
 * accesses over six days, against a 256 MB shared_buffers. That is continuous cache
 * thrash for zero benefit, and it is why the app felt slow everywhere at once rather
 * than on one screen.
 *
 * `useTableRealtime` below has the same defect for the same reason and is also unused.
 *
 * IF YOU NEED LIVE DATA: subscribe in the page that needs it and CONSUME the payload
 * (re-run its loader), the way useRealtimeAlerts, AuthContext, SettingsContext,
 * WorkshopLive, UploadApprovals and ConsoleSystemHealth already do. A global
 * subscribe-to-everything hook cannot know whether anything is listening.
 *
 * Kept rather than deleted so the reasoning survives with the code; wiring either export
 * back into a layout re-creates the load.
 */
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Map: DB table name → TanStack Query key(s) to invalidate on change
const TABLE_QUERY_MAP = {
  tyre_records:       [['tyres'], ['dashboard']],
  inspections:        [['inspections'], ['dashboard']],
  alerts:             [['alerts'], ['dashboard']],
  vehicle_fleet:      [['vehicles'], ['dashboard']],
  work_orders:        [['work-orders']],
  stock:              [['stock']],
  stock_movements:    [['stock'], ['stock-movements']],
  corrective_actions: [['actions']],
  rca_records:        [['rca']],
  budgets:            [['budgets']],
  gate_passes:        [['gate-passes']],
  purchase_orders:    [['procurement']],
}

/**
 * Subscribe to a single table and invalidate query keys on any change.
 * Returns unsubscribe function.
 */
function subscribeTable(qc, table, queryKeys) {
  const channel = supabase.channel(`realtime:${table}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      () => {
        queryKeys.forEach(key => qc.invalidateQueries({ queryKey: key }))
      }
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

/**
 * useRealtimeSync - call once in Layout.jsx.
 * Subscribes to all core tables. Automatically reconnects on mount.
 */
export function useRealtimeSync() {
  const qc = useQueryClient()
  const cleanupRef = useRef([])

  useEffect(() => {
    // Clean up previous subs
    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    // Subscribe to all tables
    Object.entries(TABLE_QUERY_MAP).forEach(([table, keys]) => {
      const unsub = subscribeTable(qc, table, keys)
      cleanupRef.current.push(unsub)
    })

    return () => {
      cleanupRef.current.forEach(fn => fn())
      cleanupRef.current = []
    }
  }, [qc])
}

/**
 * useTableRealtime - subscribe to a specific table in a single component.
 * Use when a page needs a focused subscription beyond the global ones.
 */
export function useTableRealtime(table, queryKeys) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!table) return
    const keys = Array.isArray(queryKeys[0]) ? queryKeys : [queryKeys]
    const unsub = subscribeTable(qc, table, keys)
    return unsub
  }, [table, qc])
}

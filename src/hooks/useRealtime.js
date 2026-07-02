/**
 * useRealtime - Supabase postgres_changes subscriptions that auto-invalidate
 * TanStack Query caches. Zero polling. Instant UI updates on any data change.
 *
 * Usage: call useRealtimeSync() once inside Layout.jsx (always-mounted).
 * It subscribes to the core tables and invalidates the matching query keys
 * so every page using those queries refreshes automatically.
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

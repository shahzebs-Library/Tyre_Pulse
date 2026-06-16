/**
 * useRealtime
 *
 * Subscribes to Postgres change events for a table via Supabase Realtime and
 * invokes `onChange` whenever a row is inserted/updated/deleted. Lets list
 * screens stay live without pull-to-refresh.
 *
 * The callback is held in a ref so the channel is created once per table and
 * never resubscribes on every render.
 */
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

type ChangeHandler = (payload: any) => void

export function useRealtime(
  table: string,
  onChange: ChangeHandler,
  opts: { enabled?: boolean } = {},
): void {
  const enabled = opts.enabled ?? true
  const cb = useRef<ChangeHandler>(onChange)
  cb.current = onChange

  useEffect(() => {
    if (!enabled) return
    const channel = supabase
      .channel(`rt:${table}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        payload => { try { cb.current?.(payload) } catch { /* swallow */ } },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [table, enabled])
}

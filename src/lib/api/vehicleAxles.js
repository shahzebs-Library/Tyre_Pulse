/**
 * Per-machine axle counts from the fleet register (vehicle_fleet.axle_count),
 * loaded once per session and registered with the layout resolver so every
 * tyre diagram draws the build actually in the yard (4- vs 5-axle pumps).
 * Small read (only machines with a recorded count); RLS scopes it. Never
 * throws: a failed read leaves the type's default layout in place.
 */
import { useEffect, useState } from 'react'
import { supabase } from './_client'
import { fetchAllPages } from '../fetchAll'
import { setAxleCounts } from '../vehicleTyreLayout'

let loading = null
let version = 0
const listeners = new Set()

export function loadAxleCounts() {
  if (!loading) {
    loading = (async () => {
      try {
        const { data, error } = await fetchAllPages((from, to) => supabase
          .from('vehicle_fleet')
          .select('asset_no,country,axle_count')
          .not('axle_count', 'is', null)
          .order('id')
          .range(from, to), { max: 20000 })
        if (error) throw error
        setAxleCounts(data || [])
        version += 1
        listeners.forEach((fn) => fn(version))
      } catch {
        loading = null // try again next time a diagram mounts
      }
    })()
  }
  return loading
}

/** Re-renders the caller once the axle counts have arrived. */
export function useAxleCounts() {
  const [v, setV] = useState(version)
  useEffect(() => {
    listeners.add(setV)
    loadAxleCounts()
    return () => { listeners.delete(setV) }
  }, [])
  return v
}

/** Test hook: forget the loaded state. */
export function _resetAxleCounts() { loading = null; version = 0 }

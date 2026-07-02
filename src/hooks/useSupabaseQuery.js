import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Generic hook - callers pass a queryKey and a fetcher fn
export function useSupabaseQuery(queryKey, fetcher, options = {}) {
  return useQuery({ queryKey, queryFn: fetcher, ...options })
}

// Tyre records
export function useTyres(filters = {}) {
  return useQuery({
    queryKey: ['tyres', filters],
    queryFn: async () => {
      let q = supabase.from('tyre_records').select('*')
      if (filters.status)  q = q.eq('status', filters.status)
      if (filters.country) q = q.eq('country', filters.country)
      if (filters.site)    q = q.eq('site', filters.site)
      const { data, error } = await q.order('updated_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    staleTime: 2 * 60 * 1000,
  })
}

// Inspections
export function useInspections(filters = {}) {
  return useQuery({
    queryKey: ['inspections', filters],
    queryFn: async () => {
      let q = supabase.from('inspections').select('*')
      if (filters.status)     q = q.eq('status', filters.status)
      if (filters.asset_no)   q = q.eq('asset_no', filters.asset_no)
      const { data, error } = await q.order('inspection_date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    staleTime: 2 * 60 * 1000,
  })
}

// Alerts
export function useAlerts(filters = {}) {
  return useQuery({
    queryKey: ['alerts', filters],
    queryFn: async () => {
      let q = supabase.from('alerts').select('*')
      if (filters.resolved !== undefined) q = q.eq('resolved', filters.resolved)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    staleTime: 60 * 1000, // 1 min for alerts (more time-sensitive)
  })
}

// Vehicles / Fleet Master
export function useVehicles(filters = {}) {
  return useQuery({
    queryKey: ['vehicles', filters],
    queryFn: async () => {
      let q = supabase.from('vehicle_fleet').select('*')
      if (filters.status)  q = q.eq('status', filters.status)
      if (filters.country) q = q.eq('country', filters.country)
      const { data, error } = await q.order('fleet_number')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

// Stock
export function useStock(filters = {}) {
  return useQuery({
    queryKey: ['stock', filters],
    queryFn: async () => {
      let q = supabase.from('stock').select('*')
      if (filters.country) q = q.eq('country', filters.country)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

// Dashboard stats (tyres + alerts + vehicles in one parallel fetch)
export function useDashboardData(country) {
  const tyresQ = useQuery({
    queryKey: ['tyres', { country }],
    queryFn: async () => {
      let q = supabase.from('tyre_records').select('*')
      if (country && country !== 'All') q = q.eq('country', country)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    staleTime: 2 * 60 * 1000,
  })

  const alertsQ = useQuery({
    queryKey: ['alerts', { resolved: false }],
    queryFn: async () => {
      const { data, error } = await supabase.from('alerts').select('*').eq('resolved', false)
      if (error) throw error
      return data ?? []
    },
    staleTime: 60 * 1000,
  })

  const vehiclesQ = useQuery({
    queryKey: ['vehicles', { country }],
    queryFn: async () => {
      let q = supabase.from('vehicle_fleet').select('*')
      if (country && country !== 'All') q = q.eq('country', country)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  return {
    tyres: tyresQ.data ?? [],
    alerts: alertsQ.data ?? [],
    vehicles: vehiclesQ.data ?? [],
    loading: tyresQ.isLoading || alertsQ.isLoading || vehiclesQ.isLoading,
    error: tyresQ.error || alertsQ.error || vehiclesQ.error,
  }
}

// Generic invalidation helper
export function useInvalidate() {
  const qc = useQueryClient()
  return (keys) => {
    const arr = Array.isArray(keys) ? keys : [keys]
    arr.forEach(k => qc.invalidateQueries({ queryKey: [k] }))
  }
}

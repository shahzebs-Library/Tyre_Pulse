import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { setReportPalette } from '../lib/reportColors'
import { primeConfigCache, configBool } from '../lib/api/systemConfig'

export const COUNTRIES = ['KSA', 'UAE', 'Egypt']
export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }
export const COUNTRY_LABEL = { KSA: 'KSA', UAE: 'UAE', Egypt: 'EGY' }

// A user's country may be stored as a string ("KSA") or, for multi-country
// users, an array. Resolve the primary country consistently. Pure helper kept at
// module scope so it is referentially stable for memoised callbacks/effects.
const primaryCountry = (p) => {
  const c = Array.isArray(p?.country) ? p.country[0] : p?.country
  return c && String(c).trim() ? String(c).trim() : null
}

const SettingsContext = createContext({
  appSettings: { cost_per_tyre: 1200, company_name: 'TyrePulse', currency: 'SAR' },
  activeCountry: 'All',
  setActiveCountry: () => {},
  activeCurrency: 'SAR',
  refreshSettings: () => {},
})

export function SettingsProvider({ children }) {
  const { user, profile } = useAuth()
  const [appSettings, setAppSettings] = useState({
    cost_per_tyre: 1200,
    company_name: 'TyrePulse',
    currency: 'SAR',
  })
  // Persist the admin's country choice so it survives a reload (bug 035 — the
  // Upload page's country-gated actions were disabled after every hard refresh).
  const [activeCountry, setActiveCountryInternal] = useState(
    () => localStorage.getItem('tp_active_country') || 'All',
  )

  const setActiveCountry = useCallback((c) => {
    // Non-admins with an assigned country are locked to it.
    if (profile && profile.role !== 'Admin' && primaryCountry(profile)) return
    setActiveCountryInternal(c)
    try { localStorage.setItem('tp_active_country', c) } catch { /* storage disabled */ }
  }, [profile])

  useEffect(() => {
    const c = primaryCountry(profile)
    if (profile && profile.role !== 'Admin' && c) {
      setActiveCountryInternal(c)
    }
  }, [profile])

  const activeCurrency = useMemo(
    () => (activeCountry === 'All'
      ? appSettings.currency
      : (COUNTRY_CURRENCY[activeCountry] ?? appSettings.currency)),
    [activeCountry, appSettings.currency],
  )

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('key, value')
    if (!data) return
    const map = {}
    data.forEach(({ key, value }) => {
      try { map[key] = JSON.parse(value) } catch { map[key] = value }
    })
    setAppSettings(prev => ({ ...prev, ...map }))
  }, [])

  useEffect(() => {
    if (user) refreshSettings()
  }, [user, refreshSettings])

  // Global system_config (System Configuration console page). Loaded ONCE per
  // authenticated session and primed into the central systemConfig cache so every
  // enforcement point (export/upload guards, maintenance gate, session timeout,
  // ...) reads a single source. Also applies the super-admin report colour theme
  // (report_palette) from the same fetch. Best-effort, never blocks the app.
  const [systemConfig, setSystemConfig] = useState({})
  const refreshSystemConfig = useCallback(async () => {
    const { data } = await supabase.from('system_config').select('key, value')
    if (!data) return {}
    const map = {}
    for (const { key, value } of data) map[key] = value
    primeConfigCache(map)
    setSystemConfig(map)
    if (map.report_palette) {
      try { setReportPalette(JSON.parse(map.report_palette), { persist: false }) }
      catch { setReportPalette(map.report_palette, { persist: false }) }
    }
    return map
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    refreshSystemConfig().catch(() => { /* keep defaults */ })
    // Live-refresh when a super-admin changes global config (no reload needed).
    const ch = supabase
      .channel('system_config_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_config' },
        () => { if (!cancelled) refreshSystemConfig().catch(() => {}) })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [user, refreshSystemConfig])

  // Maintenance mode is a global switch; super-admins/Admins are never locked out
  // (they administer the toggle). Enforced in ProtectedRoute via this flag.
  const maintenanceActive = useMemo(() => {
    if (!('maintenance_mode' in systemConfig)) return false
    const on = configBool('maintenance_mode', false)
    const isPrivileged = profile?.is_super_admin === true || profile?.role === 'Admin'
    return on && !isPrivileged
  }, [systemConfig, profile])

  const value = useMemo(
    () => ({
      appSettings, refreshSettings,
      activeCountry, setActiveCountry,
      activeCurrency,
      systemConfig, refreshSystemConfig, maintenanceActive,
    }),
    [appSettings, refreshSettings, activeCountry, setActiveCountry, activeCurrency,
     systemConfig, refreshSystemConfig, maintenanceActive],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}

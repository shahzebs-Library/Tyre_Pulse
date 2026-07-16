import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { setReportPalette } from '../lib/reportColors'

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

  // Apply the org-wide report colour theme chosen by the super-admin (Console ->
  // Report Colors). Stored in system_config.report_palette as a preset name or a
  // JSON hex array; any authenticated user can read it. Best-effort, never blocks.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase.from('system_config').select('value').eq('key', 'report_palette').maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.value) return
        try { setReportPalette(JSON.parse(data.value), { persist: false }) }
        catch { setReportPalette(data.value, { persist: false }) }
      })
      .catch(() => { /* keep default theme */ })
    return () => { cancelled = true }
  }, [user])

  const value = useMemo(
    () => ({
      appSettings, refreshSettings,
      activeCountry, setActiveCountry,
      activeCurrency,
    }),
    [appSettings, refreshSettings, activeCountry, setActiveCountry, activeCurrency],
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

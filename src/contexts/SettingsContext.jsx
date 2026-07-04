import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

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

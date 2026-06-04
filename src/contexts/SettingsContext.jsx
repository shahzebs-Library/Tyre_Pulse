import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const SettingsContext = createContext({
  appSettings: { cost_per_tyre: 1200, company_name: 'TyrePulse', currency: 'SAR' },
  refreshSettings: () => {},
})

export function SettingsProvider({ children }) {
  const { user } = useAuth()
  const [appSettings, setAppSettings] = useState({
    cost_per_tyre: 1200,
    company_name: 'TyrePulse',
    currency: 'SAR',
  })

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

  return (
    <SettingsContext.Provider value={{ appSettings, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}

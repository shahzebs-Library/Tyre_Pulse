import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { setReportPalette } from '../lib/reportColors'
import { loadSystemConfig, configBool } from '../lib/api/systemConfig'
import {
  EMPTY_CONTEXT,
  buildContextTree,
  allowedContext as filterAllowedContext,
  normalizeContext,
  canSwitchContext,
  contextToCountry,
} from '../lib/workingContext'
import {
  SCOPE_ALL,
  allowedScopeCountries,
  normalizeScope,
} from '../lib/reportingScope'

export const COUNTRIES = ['KSA', 'UAE', 'Egypt']
export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }
export const COUNTRY_LABEL = { KSA: 'KSA', UAE: 'UAE', Egypt: 'EGY' }

const COUNTRY_KEY = 'tp_active_country'
const CONTEXT_KEY = 'tp_working_context'
const SCOPE_KEY = 'tp_reporting_scope'

// The site register is the source of the working-context tree. When it cannot be
// read we fall back to the hardcoded country list so the picker still works: a
// row with a blank name registers its country and adds no site.
const FALLBACK_SITE_ROWS = COUNTRIES.map(c => ({ name: '', country: c, region: '' }))

const readStored = (key) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null } // storage disabled or a corrupt value: fall back to a default
}

const writeStored = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage disabled */ }
}

/** Stable identity for a working context; changes whenever the place changes. */
const keyOf = (ctx) => `${ctx?.country || 'All'}|${ctx?.region || ''}|${ctx?.site || ''}`

const SettingsContext = createContext({
  appSettings: { cost_per_tyre: 1200, company_name: 'TyrePulse', currency: 'SAR' },
  activeCountry: 'All',
  setActiveCountry: () => {},
  activeCurrency: 'SAR',
  refreshSettings: () => {},
  workingContext: EMPTY_CONTEXT,
  setWorkingContext: () => {},
  allowedContext: [],
  canSwitchWorkingContext: false,
  contextKey: keyOf(EMPTY_CONTEXT),
  reportingScope: { countries: [SCOPE_ALL] },
  setReportingScope: () => {},
  allowedScopeCountries: [],
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
    () => localStorage.getItem(COUNTRY_KEY) || 'All',
  )

  // ---------------------------------------------------------------------------
  // WORKING CONTEXT (operations: one place at a time)
  //
  // `activeCountry` stays THE legacy contract - 212 files read it and 130 API
  // modules feed it to applyCountry(). The working context sits on top of it and
  // every context change writes it, so those consumers need no edit at all.
  // ---------------------------------------------------------------------------
  const [siteRows, setSiteRows] = useState(null)
  // Has the register answered at all (either way)? Until it has, the tree holds
  // countries but no sites, so a saved SITE cannot be judged - see the sync effect.
  const [registerReady, setRegisterReady] = useState(false)

  // Read the site register once per authenticated session. Best-effort: on any
  // failure we keep the country-only fallback tree so the app never breaks. The
  // ref makes "once" literal - the tree feeds a memo chain, so re-reading it on
  // every render would set state in a loop.
  const sitesLoadedForRef = useRef(null)
  useEffect(() => {
    if (!user?.id) {
      // Signed out: drop the register so the next session reads its own.
      sitesLoadedForRef.current = null
      setSiteRows(null)
      setRegisterReady(false)
      return undefined
    }
    if (sitesLoadedForRef.current === user.id) return undefined
    sitesLoadedForRef.current = user.id
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.from('sites').select('name,country,region')
        if (!cancelled && !error && Array.isArray(data) && data.length) setSiteRows(data)
      } catch { /* keep the fallback tree */ }
      finally { if (!cancelled) setRegisterReady(true) }
    })()
    return () => { cancelled = true }
  }, [user])

  const contextTree = useMemo(
    () => buildContextTree(siteRows && siteRows.length ? siteRows : FALLBACK_SITE_ROWS),
    [siteRows],
  )
  const allowed = useMemo(() => filterAllowedContext(profile, contextTree), [profile, contextTree])
  const allowedCountries = useMemo(() => allowed.map(n => n.country), [allowed])

  // 'All' means "no country filter". It is offered only when the user may see
  // EVERY country in the tree (then 'All' and "everything I may see" are the same
  // statement); a narrower user must name a country so the label never overstates
  // their coverage. An empty tree means we have not loaded yet - stay permissive
  // rather than clobber a restored choice.
  const canSelectAll = allowed.length === 0 || allowed.length === contextTree.length

  const [workingContext, setWorkingContextInternal] = useState(() => {
    const saved = readStored(CONTEXT_KEY)
    if (saved && (saved.country || saved.site)) return { ...EMPTY_CONTEXT, ...saved }
    // First load after this shipped: seed from the country the user already chose.
    const legacy = localStorage.getItem(COUNTRY_KEY)
    if (legacy && legacy !== 'All') return { ...EMPTY_CONTEXT, country: legacy }
    return { ...EMPTY_CONTEXT }
  })

  // The one writer of the legacy value, so the bridge can never be half-applied.
  const applyCountryValue = useCallback((c) => {
    const next = c == null || c === '' ? 'All' : String(c)
    setActiveCountryInternal(next)
    try { localStorage.setItem(COUNTRY_KEY, next) } catch { /* storage disabled */ }
  }, [])

  /**
   * THE BRIDGE. Setting a working context also sets `activeCountry` to
   * contextToCountry(ctx). This single side effect is what keeps every existing
   * country-scoped read working with zero changes. The context is validated
   * against what the user may see before anything is written.
   */
  const setWorkingContext = useCallback((ctx) => {
    // An empty context is a real choice ("All countries", no country filter) for
    // anyone who may see every country - not a missing value to be defaulted.
    const wantsAll = !ctx || !String(ctx.country ?? '').trim()
    const context = (wantsAll && canSelectAll)
      ? { ...EMPTY_CONTEXT }
      : normalizeContext(ctx, allowed).context
    setWorkingContextInternal(prev => (keyOf(prev) === keyOf(context) ? prev : context))
    writeStored(CONTEXT_KEY, context)
    applyCountryValue(contextToCountry(context))
  }, [allowed, canSelectAll, applyCountryValue])

  /**
   * Legacy setter, unchanged signature. A user may switch among the countries
   * they actually hold and is locked only when they hold exactly one - the old
   * rule pinned EVERY non-Admin to country[0], so a real user carrying
   * ['KSA','UAE','Egypt'] could never leave KSA. Never widens beyond
   * profile.country: an unheld country is rejected.
   */
  const setActiveCountry = useCallback((c) => {
    const next = c == null || c === '' ? 'All' : String(c)
    // 'All' clears the context (refused for a scoped user, who stays on their
    // own country); a named country must be one they hold.
    if (next === 'All') {
      if (!canSelectAll) return
      setWorkingContext(EMPTY_CONTEXT)
      return
    }
    if (allowedCountries.length) {
      const hit = allowedCountries.find(n => n.toLowerCase() === next.toLowerCase())
      if (!hit) return
      setWorkingContext({ country: hit, region: null, site: null })
      return
    }
    // Tree not loaded yet: keep the historical behaviour rather than block a
    // caller. RLS is the boundary either way.
    setWorkingContextInternal({ ...EMPTY_CONTEXT, country: next })
    writeStored(CONTEXT_KEY, { ...EMPTY_CONTEXT, country: next })
    applyCountryValue(next)
  }, [allowedCountries, canSelectAll, applyCountryValue, setWorkingContext])

  // Reconcile the restored context with the scope the user has RIGHT NOW, and
  // keep activeCountry in step. Only once the profile is known: before that we
  // would be validating against an unrestricted tree and could overwrite a
  // legitimate stored choice with 'All'.
  const syncedKeyRef = useRef(null)
  useEffect(() => {
    if (!profile) return
    // No country is a DELIBERATE choice ('All' = no country filter) for anyone
    // who may see every country. Do not "correct" it into a single country.
    const deliberateAll = !workingContext.country && canSelectAll
    const { context: normalized } = normalizeContext(workingContext, allowed)
    // Until the register has answered, the tree carries countries but no sites,
    // so a saved site would look invalid and be thrown away. Judge the country
    // half only and re-run once the sites arrive.
    const countryHeld = contextToCountry(normalized) === contextToCountry(workingContext)
    const holdSite = !registerReady && !!workingContext.site && countryHeld
    const context = (deliberateAll || holdSite) ? workingContext : normalized

    const key = keyOf(context)
    if (key !== keyOf(workingContext)) {
      setWorkingContextInternal(context)
      writeStored(CONTEXT_KEY, context)
    }
    const country = contextToCountry(context)
    if (country !== activeCountry || syncedKeyRef.current !== key) {
      syncedKeyRef.current = key
      applyCountryValue(country)
    }
  }, [profile, allowed, workingContext, activeCountry, applyCountryValue,
      canSelectAll, registerReady])

  const contextKey = useMemo(() => keyOf(workingContext), [workingContext])
  const canSwitchWorkingContext = useMemo(() => canSwitchContext(allowed), [allowed])

  // ---------------------------------------------------------------------------
  // REPORTING SCOPE (analytics: may span countries). Never writes the working
  // context or activeCountry - a cross-country report must not re-point where
  // the user is operating.
  // ---------------------------------------------------------------------------
  const scopeCountryOptions = useMemo(
    () => allowedScopeCountries(profile, contextTree),
    [profile, contextTree],
  )
  const [reportingScope, setReportingScopeInternal] = useState(
    () => readStored(SCOPE_KEY) || { countries: [SCOPE_ALL] },
  )

  const setReportingScope = useCallback((scope) => {
    const { scope: next } = normalizeScope(scope, scopeCountryOptions)
    setReportingScopeInternal(next)
    writeStored(SCOPE_KEY, next)
  }, [scopeCountryOptions])

  useEffect(() => {
    if (!profile) return
    const { scope, changed } = normalizeScope(reportingScope, scopeCountryOptions)
    if (changed) {
      setReportingScopeInternal(scope)
      writeStored(SCOPE_KEY, scope)
    }
  }, [profile, scopeCountryOptions, reportingScope])

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
  const refreshSystemConfig = useCallback(async ({ force = true } = {}) => {
    // Goes through the shared loader rather than querying the table here, for
    // two reasons: it reads `value_text` as well as `value` (so the per-key
    // readers - nav layout, company logo - can answer from this one fetch
    // instead of each issuing their own on every cold load), and it de-dupes
    // concurrent reads. Never throws; returns the last-known cache on failure.
    const map = await loadSystemConfig({ force })
    if (!map) return {}
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
    // Not forced on mount: if another reader already started the same read, join
    // it. A live config change below IS forced, so an edit is never served stale.
    refreshSystemConfig({ force: false }).catch(() => { /* keep defaults */ })
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
      // Working context (operations). contextKey is a stable identity a caller
      // can use as a React key to remount a screen when the place changes.
      workingContext, setWorkingContext, allowedContext: allowed,
      canSwitchWorkingContext, contextKey,
      // Whether 'All countries' is a legitimate choice for this user. Exposed so
      // the selector can offer a way BACK to it: without this the context could
      // start as All (the default) and become a one-way door the moment a
      // country was picked.
      canSelectAll,
      // Reporting scope (analytics). Separate from the working context.
      reportingScope, setReportingScope, allowedScopeCountries: scopeCountryOptions,
    }),
    [appSettings, refreshSettings, activeCountry, setActiveCountry, activeCurrency,
     systemConfig, refreshSystemConfig, maintenanceActive,
     workingContext, setWorkingContext, allowed, canSwitchWorkingContext, contextKey, canSelectAll,
     reportingScope, setReportingScope, scopeCountryOptions],
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

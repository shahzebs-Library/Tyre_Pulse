/**
 * TenantContext — exposes the current user's organisation branding (logo,
 * colours, legal name, report theme, footer, disclaimer, contact block) to the
 * whole app. Branding is loaded once per session via the server-side
 * `get_org_branding` RPC (V68), which returns only the caller's own org unless
 * they are an org admin. Report/export code reads `branding` from here so every
 * generated PDF/PPTX carries the tenant's identity.
 *
 * Non-destructive: the loaded primary/accent colours are published as
 * `--brand-primary` / `--brand-accent` CSS variables for opt-in consumers; the
 * existing global theme variables are left untouched.
 */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { getOrgBranding, withBrandingDefaults } from '../lib/api/branding'
import { listCountryAddresses, resolveAddress } from '../lib/api/countryAddresses'
import { cacheResolvedLogos, clearCachedLogos, resolveBrandLogo } from '../lib/brand/library'

/** Point the browser-tab icon at the org's favicon placement (V120). */
function applyFavicon(branding) {
  if (typeof document === 'undefined') return
  const href = resolveBrandLogo(branding, 'favicon')
  if (!href) return
  let link = document.querySelector("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = href.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
  link.href = href
}

const TenantContext = createContext({
  branding: null,          // merged-with-defaults branding, or null before load
  countryAddresses: [],    // saved per-country address rows (V108)
  resolveAddress: () => null, // (country) → effective address (country row → org fallback)
  orgId: null,
  orgName: null,
  loading: true,
  error: null,
  refreshBranding: () => {},
})

export function TenantProvider({ children }) {
  const { user, profile } = useAuth()
  const [branding, setBranding] = useState(null)
  const [countryAddresses, setCountryAddresses] = useState([])
  const [orgId, setOrgId]       = useState(null)
  const [orgName, setOrgName]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const refreshBranding = useCallback(async () => {
    if (!user) { setBranding(null); setCountryAddresses([]); setLoading(false); clearCachedLogos(); return }
    setLoading(true); setError(null)
    try {
      const raw = await getOrgBranding(null) // caller's own org
      const merged = withBrandingDefaults(raw)
      setOrgId(raw?.org_id ?? null)
      setOrgName(raw?.name ?? null)
      setBranding(merged)
      // Persist resolved login/favicon logos for the next pre-auth visit, and
      // point the browser tab at the org favicon for this session.
      cacheResolvedLogos(merged)
      applyFavicon(merged)
    } catch (err) {
      // Branding is non-critical chrome — fall back to defaults, never block the app.
      console.warn('[TenantContext] branding load failed:', err?.message || err)
      setError(err?.message || 'Could not load branding')
      setBranding(withBrandingDefaults(null))
    } finally {
      setLoading(false)
    }
    // Country addresses are best-effort and independent of branding success.
    try {
      setCountryAddresses(await listCountryAddresses())
    } catch (err) {
      console.warn('[TenantContext] country addresses load failed:', err?.message || err)
      setCountryAddresses([])
    }
  }, [user])

  useEffect(() => { refreshBranding() }, [refreshBranding, profile?.org_id])

  // Publish brand colours + tint the semantic accent tokens. Only genuinely
  // custom colours (≠ the product green default) override the accent surfaces,
  // so a default/unbranded org keeps the exact original design. The tuned green
  // component gradients are never touched.
  useEffect(() => {
    const root = document.documentElement
    const DEFAULT_GREEN = '#16a34a'
    const norm = (c) => (typeof c === 'string' ? c.trim().toLowerCase() : '')
    const primary = branding?.primary_color
    const accent  = branding?.accent_color

    if (primary) root.style.setProperty('--brand-primary', primary)
    if (accent)  root.style.setProperty('--brand-accent', accent)

    // A personal accent (set in Settings → Appearance) always wins over the org
    // brand for this user's own view — never override it here.
    if (root.dataset.userAccent) return

    // Accent tokens: override only for a real custom brand colour; otherwise
    // clear any prior override so the CSS green defaults apply (e.g. on logout
    // or when switching back to a default-branded org).
    if (primary && norm(primary) !== DEFAULT_GREEN) {
      root.style.setProperty('--accent', primary)
      root.style.setProperty('--accent-ring', primary)
      root.style.setProperty('--accent-strong', accent || primary)
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-ring')
      root.style.removeProperty('--accent-strong')
    }
  }, [branding])

  const resolveCountryAddress = useCallback(
    (country) => resolveAddress(country, countryAddresses, branding),
    [countryAddresses, branding],
  )

  const value = useMemo(
    () => ({
      branding, countryAddresses, resolveAddress: resolveCountryAddress,
      orgId, orgName, loading, error, refreshBranding,
    }),
    [branding, countryAddresses, resolveCountryAddress, orgId, orgName, loading, error, refreshBranding],
  )

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}

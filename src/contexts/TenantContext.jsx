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

const TenantContext = createContext({
  branding: null,          // merged-with-defaults branding, or null before load
  orgId: null,
  orgName: null,
  loading: true,
  error: null,
  refreshBranding: () => {},
})

export function TenantProvider({ children }) {
  const { user, profile } = useAuth()
  const [branding, setBranding] = useState(null)
  const [orgId, setOrgId]       = useState(null)
  const [orgName, setOrgName]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const refreshBranding = useCallback(async () => {
    if (!user) { setBranding(null); setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const raw = await getOrgBranding(null) // caller's own org
      setOrgId(raw?.org_id ?? null)
      setOrgName(raw?.name ?? null)
      setBranding(withBrandingDefaults(raw))
    } catch (err) {
      // Branding is non-critical chrome — fall back to defaults, never block the app.
      console.warn('[TenantContext] branding load failed:', err?.message || err)
      setError(err?.message || 'Could not load branding')
      setBranding(withBrandingDefaults(null))
    } finally {
      setLoading(false)
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

  const value = useMemo(
    () => ({ branding, orgId, orgName, loading, error, refreshBranding }),
    [branding, orgId, orgName, loading, error, refreshBranding],
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

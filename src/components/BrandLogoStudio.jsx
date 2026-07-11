import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Image as ImageIcon, Save, Loader2, Check, AlertTriangle, RotateCcw, Building2,
  Search, X, Link2, Trash2, Star,
} from 'lucide-react'
import { listOrganisations } from '../lib/api/users'
import { getOrgBranding, setOrgBranding, withBrandingDefaults } from '../lib/api/branding'
import {
  BRAND_LOGOS, BRAND_LOGO_LAYOUTS, BRAND_LOGO_COLORS, LOGO_SLOTS,
  assetUrl, resolveLogoValue, isUrlValue, cacheResolvedLogos,
} from '../lib/brand/library'
import { useTenant } from '../contexts/TenantContext'

/**
 * BrandLogoStudio — admin studio for placing the bundled Tyre Pulse logo
 * variants across the product (app icon, login, favicon, report cover, email,
 * mobile splash, PDF watermark). Admins pick an organisation, choose a
 * placement slot, then assign a library variant or a custom image URL. A live
 * preview shows the logo on the slot's real surface. Saves through the
 * Admin-gated `set_org_branding` RPC (V68/V120); non-admins are read-only.
 */

/**
 * Small logo tile. Logos are shown on a light checkerboard so their TRUE brand
 * colours (navy / blue / etc.) are always visible — a dark app surface would
 * make the dark-navy marks look solid black. `surface` is accepted for call-site
 * compatibility but no longer tints the tile.
 */
function LogoThumb({ src, surface, className = '', style }) { // eslint-disable-line no-unused-vars
  return (
    <div
      className={`checker rounded-lg flex items-center justify-center overflow-hidden ${className}`}
      style={style}
    >
      {src
        ? <img src={src} alt="" className="max-h-full max-w-full object-contain" onError={(e) => { e.currentTarget.style.opacity = 0.15 }} />
        : <span className="text-[10px] text-gray-500">Default</span>}
    </div>
  )
}

export default function BrandLogoStudio({ canEdit }) {
  const { refreshBranding } = useTenant()
  const [orgs, setOrgs]         = useState([])
  const [orgId, setOrgId]       = useState('')
  const [branding, setBranding] = useState(() => withBrandingDefaults(null))
  const [logos, setLogos]       = useState({})
  const [savedLogos, setSaved]  = useState({})
  const [activeSlot, setActive] = useState(LOGO_SLOTS[0].key)

  const [query, setQuery]         = useState('')
  const [fLayout, setFLayout]     = useState('all')
  const [fColor, setFColor]       = useState('all')

  const [loading, setLoading]         = useState(true)
  const [loadingBrand, setLoadingB]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [msg, setMsg]                 = useState('')

  // Load organisations once.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true); setError('')
      try {
        const list = await listOrganisations()
        if (!alive) return
        setOrgs(list || [])
        setOrgId((prev) => prev || list?.[0]?.id || '')
      } catch (e) {
        if (alive) setError(e.message || 'Could not load organisations.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Load branding for the selected org.
  const loadBrand = useCallback(async (id) => {
    if (!id) return
    setLoadingB(true); setError(''); setMsg('')
    try {
      const merged = withBrandingDefaults(await getOrgBranding(id))
      setBranding(merged)
      setLogos({ ...(merged.logos || {}) })
      setSaved({ ...(merged.logos || {}) })
    } catch (e) {
      setError(e.message || 'Could not load branding.')
    } finally {
      setLoadingB(false)
    }
  }, [])
  useEffect(() => { if (orgId) loadBrand(orgId) }, [orgId, loadBrand])

  const activeMeta   = LOGO_SLOTS.find((s) => s.key === activeSlot)
  const activeValue  = logos[activeSlot] || ''
  const activeSrc    = resolveLogoValue(activeValue)
  const dirty        = useMemo(
    () => JSON.stringify(logos) !== JSON.stringify(savedLogos),
    [logos, savedLogos],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return BRAND_LOGOS.filter((l) =>
      (fLayout === 'all' || l.layout === fLayout) &&
      (fColor === 'all'  || l.color === fColor) &&
      (!q || l.label.toLowerCase().includes(q) || l.id.includes(q)),
    )
  }, [query, fLayout, fColor])

  const assign = (id) => { if (!canEdit) return; setMsg(''); setLogos((m) => ({ ...m, [activeSlot]: id })) }
  const clearSlot = (slot) => { if (!canEdit) return; setMsg(''); setLogos((m) => { const n = { ...m }; delete n[slot]; return n }) }
  const setCustom = (url) => { if (!canEdit) return; setMsg(''); setLogos((m) => { const n = { ...m }; const v = url.trim(); if (v) n[activeSlot] = v; else delete n[activeSlot]; return n }) }

  async function handleSave() {
    if (!canEdit || !orgId || !dirty) return
    setSaving(true); setError(''); setMsg('')
    try {
      // Re-fetch the latest branding so placement saves never clobber colour /
      // report fields edited elsewhere on this page (server replaces the object).
      const fresh = withBrandingDefaults(await getOrgBranding(orgId))
      const stored = await setOrgBranding(orgId, { ...fresh, logos })
      const merged = withBrandingDefaults(stored)
      setBranding(merged)
      setLogos({ ...(merged.logos || {}) })
      setSaved({ ...(merged.logos || {}) })
      setMsg('Logo placements saved.')
      refreshBranding?.()
      cacheResolvedLogos(merged)
    } catch (e) {
      setError(e.message || 'Save failed. Check your permissions and try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() { setLogos({ ...savedLogos }); setMsg(''); setError('') }

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading organisations…</div>
  }

  const selectedOrg = orgs.find((o) => o.id === orgId)
  const assignedCount = Object.keys(logos).length

  return (
    <div className="space-y-5">
      {/* Header + org selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg" style={{ background: 'rgba(37,99,235,0.14)' }}>
            <ImageIcon size={18} className="text-blue-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Brand Logo Studio</h3>
            <p className="text-xs text-gray-500">Place any Tyre Pulse logo across the app: {BRAND_LOGOS.length} variants, {LOGO_SLOTS.length} placements.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-gray-400" />
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input text-sm min-w-[200px]">
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}{o.country ? ` · ${o.country}` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} /> Read-only. Only an organisation admin can change logo placements.
        </div>
      )}

      {loadingBrand ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading branding…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Placements column ── */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400">Placements</label>
              <span className="text-[10px] text-gray-500">{assignedCount}/{LOGO_SLOTS.length} customised</span>
            </div>
            <div className="space-y-1.5">
              {LOGO_SLOTS.map((s) => {
                const src = resolveLogoValue(logos[s.key])
                const isActive = s.key === activeSlot
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setActive(s.key)}
                    className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors border ${
                      isActive ? 'border-blue-500/50 bg-blue-500/10' : 'border-white/5 hover:border-white/15 hover:bg-white/5'
                    }`}
                  >
                    <LogoThumb src={src} surface={s.surface} className="w-12 h-9 flex-shrink-0 border border-white/10" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-200 truncate">{s.label}</div>
                      <div className="text-[10px] text-gray-500 truncate">{src ? (isUrlValue(logos[s.key]) ? 'Custom URL' : logos[s.key]) : 'Default mark'}</div>
                    </div>
                    {src && canEdit && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); clearSlot(s.key) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clearSlot(s.key) } }}
                        className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                        aria-label={`Clear ${s.label}`}
                      >
                        <Trash2 size={13} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Live preview of the active slot */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5 mt-3">Preview: {activeMeta?.label}</label>
              <LogoThumb src={activeSrc} surface={activeMeta?.surface} className="w-full h-28 border border-white/10" />
              <p className="text-[10px] text-gray-500 mt-1.5">{activeMeta?.hint}</p>
            </div>
          </div>

          {/* ── Library column ── */}
          <div className="lg:col-span-2 space-y-3">
            {/* Assign banner */}
            <div className="flex items-center gap-2 text-xs text-blue-200 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
              <Star size={13} className="flex-shrink-0" />
              <span>Choose a logo below to set <b>{activeMeta?.label}</b>. Suggested: {activeMeta?.recommend.join(', ')}.</span>
            </div>

            {/* Custom URL */}
            <div className="flex items-center gap-2">
              <Link2 size={14} className="text-gray-400 flex-shrink-0" />
              <input
                type="url"
                value={isUrlValue(activeValue) ? activeValue : ''}
                disabled={!canEdit}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="…or paste a custom image URL for this slot"
                className="input text-xs flex-1"
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[140px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search logos…"
                  className="input text-xs w-full pl-7"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X size={13} /></button>
                )}
              </div>
              <select value={fLayout} onChange={(e) => setFLayout(e.target.value)} className="input text-xs capitalize">
                <option value="all">All layouts</option>
                {BRAND_LOGO_LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select value={fColor} onChange={(e) => setFColor(e.target.value)} className="input text-xs capitalize">
                <option value="all">All colours</option>
                {BRAND_LOGO_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Gallery */}
            {filtered.length === 0 ? (
              <div className="text-center text-xs text-gray-500 py-10 border border-dashed border-white/10 rounded-lg">No logos match these filters.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                {filtered.map((l) => {
                  const src = assetUrl(l.id)
                  const isSel = activeValue === l.id
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => assign(l.id)}
                      title={l.label}
                      className={`group relative rounded-lg border transition-all text-left overflow-hidden disabled:cursor-not-allowed ${
                        isSel ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <LogoThumb src={src} surface={activeMeta?.surface} className="w-full h-20" />
                      {isSel && (
                        <span className="absolute top-1.5 right-1.5 bg-blue-500 text-white rounded-full p-0.5"><Check size={11} /></span>
                      )}
                      <div className="px-2 py-1.5 border-t border-white/5 bg-black/20">
                        <div className="text-[10px] font-medium text-gray-200 truncate">{l.label}</div>
                        <div className="text-[9px] text-gray-500 truncate capitalize">{l.layout} · {l.color}{l.tagline ? ' · tagline' : ''}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5">
        <div className="text-xs">
          {error && <span className="text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</span>}
          {msg && !error && <span className="text-green-400 flex items-center gap-1.5"><Check size={13} /> {msg}</span>}
          {!error && !msg && dirty && <span className="text-amber-300">Unsaved placement changes</span>}
          {!error && !msg && !dirty && <span className="text-gray-500 truncate">{selectedOrg?.name}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleReset} disabled={!dirty || saving} className="btn-secondary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw size={13} /> Reset
          </button>
          <button type="button" onClick={handleSave} disabled={!canEdit || !dirty || saving} className="btn-primary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save placements'}
          </button>
        </div>
      </div>
    </div>
  )
}

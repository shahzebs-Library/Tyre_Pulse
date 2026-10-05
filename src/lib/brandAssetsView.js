/**
 * Brand Assets - pure view logic for the gallery at /brand-assets.
 *
 * Builds ONE catalogue from what genuinely exists:
 *   - the shipped logo library (public/brand/library, library.generated.json),
 *   - the illustration and icon registries (React components in the repo),
 *   - the tenant's own marks: the org-wide report logo (system_config
 *     company_logo), the tenant branding logo_url, and any placement slot that
 *     points at an uploaded URL instead of a library logo.
 * Usage comes from the tenant placement map (organisations.settings branding
 * logos[slot]). Governance metadata (owner, review status) comes from the
 * optional brand_asset_registry table; with no row an asset is "Not reviewed".
 *
 * Every count is derived from those inputs. Nothing is invented.
 */

/** Placement slot -> usage channel tabs. */
export const SLOT_CHANNEL = {
  app_icon: 'web',
  login: 'web',
  favicon: 'web',
  report_cover: 'reports',
  pdf_watermark: 'reports',
  email_header: 'email',
  mobile_splash: 'mobile',
}

export const ASSET_TABS = [
  { key: 'all', label: 'All' },
  { key: 'logo', label: 'Logos' },
  { key: 'illustration', label: 'Illustrations' },
  { key: 'icon', label: 'Icons' },
  { key: 'tenant', label: 'Tenant' },
  { key: 'reports', label: 'Reports' },
  { key: 'email', label: 'Email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'web', label: 'Web' },
]

export const KIND_LABEL = { logo: 'Logo', illustration: 'Illustration', icon: 'Icon', tenant: 'Tenant mark' }

const isUrl = (v) => typeof v === 'string' && /^(https?:\/\/|\/|data:image\/)/i.test(v.trim())

/** Format label for an uploaded URL. */
export function urlFormat(url) {
  const s = String(url || '').trim().toLowerCase()
  if (s.startsWith('data:image/')) return (s.slice(11).split(/[;+]/)[0] || 'image').toUpperCase()
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/.exec(s)
  return m ? m[1].toUpperCase() : 'Image URL'
}

/** Human file size. */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function categoryOf(name) {
  const i = name.indexOf('/')
  return i === -1 ? 'other' : name.slice(0, i)
}

/**
 * Build the catalogue.
 * @param {{logos:Array, illustrations:string[], icons:string[], branding:object|null,
 *          companyLogo:string|null, slots:Array<{key,label}>}} input
 */
export function buildCatalog({ logos = [], illustrations = [], icons = [], branding = null, companyLogo = null, slots = [] } = {}) {
  const placements = (branding && typeof branding.logos === 'object' && branding.logos) || {}
  const slotLabel = Object.fromEntries(slots.map((s) => [s.key, s.label]))
  const usedBy = new Map()
  for (const [slot, raw] of Object.entries(placements)) {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v) continue
    if (!usedBy.has(v)) usedBy.set(v, [])
    usedBy.get(v).push(slot)
  }
  const usage = (key) => (usedBy.get(key) || []).map((slot) => ({ slot, label: slotLabel[slot] || slot, channel: SLOT_CHANNEL[slot] || 'web' }))

  const out = []
  for (const l of logos) {
    out.push({
      id: l.id, kind: 'logo', name: l.label || l.id, category: l.layout || 'logo',
      format: 'PNG', width: l.width ?? null, height: l.height ?? null, bytes: l.bytes ?? null,
      file: l.file, color: l.color || null, usage: usage(l.id), source: 'Logo library',
    })
  }
  for (const n of illustrations) {
    out.push({ id: n, kind: 'illustration', name: n, category: categoryOf(n), format: 'SVG component', usage: [], source: 'Illustration registry', snippet: `<Illustration name="${n}" />` })
  }
  for (const n of icons) {
    out.push({ id: n, kind: 'icon', name: n, category: 'icon', format: 'SVG component', usage: [], source: 'Icon registry', snippet: `<TpIcon name="${n}" />` })
  }
  // Tenant marks.
  if (typeof companyLogo === 'string' && companyLogo.trim()) {
    out.push({
      id: 'company_logo', kind: 'tenant', name: 'Company logo (shared reports)', category: 'tenant',
      format: urlFormat(companyLogo), url: companyLogo.trim(), source: 'System setting',
      usage: [{ slot: 'company_logo', label: 'Shared report links and TV boards', channel: 'reports' }],
    })
  }
  if (branding && typeof branding.logo_url === 'string' && branding.logo_url.trim()) {
    out.push({
      id: 'branding_logo_url', kind: 'tenant', name: 'Report logo (tenant branding)', category: 'tenant',
      format: urlFormat(branding.logo_url), url: branding.logo_url.trim(), source: 'Tenant branding',
      usage: [{ slot: 'logo_url', label: 'Generated report header', channel: 'reports' }],
    })
  }
  const libIds = new Set(logos.map((l) => l.id))
  for (const [value, slotKeys] of usedBy.entries()) {
    if (libIds.has(value) || !isUrl(value)) continue
    out.push({
      id: `upload:${slotKeys.join('+')}`, kind: 'tenant', name: `Uploaded mark (${slotKeys.map((s) => slotLabel[s] || s).join(', ')})`,
      category: 'tenant', format: urlFormat(value), url: value, source: 'Tenant placement', usage: usage(value),
    })
  }
  return out
}

/** Placement slots whose value points at nothing that exists. */
export function brokenPlacements(branding, logos = [], slots = []) {
  const placements = (branding && typeof branding.logos === 'object' && branding.logos) || {}
  const libIds = new Set(logos.map((l) => l.id))
  const label = Object.fromEntries(slots.map((s) => [s.key, s.label]))
  return Object.entries(placements)
    .filter(([, v]) => typeof v === 'string' && v.trim() && !libIds.has(v.trim()) && !isUrl(v))
    .map(([slot, v]) => ({ slot, label: label[slot] || slot, value: v.trim() }))
}

/** Filter the catalogue by tab and search text. */
export function filterCatalog(items, tab = 'all', query = '') {
  const q = String(query || '').trim().toLowerCase()
  return items.filter((a) => {
    if (tab === 'logo' || tab === 'illustration' || tab === 'icon' || tab === 'tenant') {
      if (a.kind !== tab) return false
    } else if (tab !== 'all') {
      if (!a.usage.some((u) => u.channel === tab)) return false
    }
    if (!q) return true
    return `${a.id} ${a.name} ${a.category} ${a.color || ''}`.toLowerCase().includes(q)
  })
}

/** Tab counts. */
export function tabCounts(items) {
  const c = {}
  for (const t of ASSET_TABS) c[t.key] = filterCatalog(items, t.key).length
  return c
}

/**
 * Governance figures. Each is null when the branding record could not be read.
 * - consistencyPct: share of assigned placements using the most common mark.
 * - broken: placements pointing at an asset that does not exist.
 * - unassigned: placements left on the built-in default.
 * - assigned / slotTotal: placements set and resolving.
 * - deprecatedInUse: assets marked deprecated in the registry that a placement still uses.
 */
export function governance({ branding, logos = [], slots = [], companyLogo = null, registry = null }) {
  if (!branding || typeof branding !== 'object') {
    return { consistencyPct: null, broken: null, unassigned: null, assigned: null, slotTotal: slots.length, deprecatedInUse: null, warnings: null }
  }
  const placements = branding.logos || {}
  const values = slots.map((s) => (typeof placements[s.key] === 'string' ? placements[s.key].trim() : '')).filter(Boolean)
  const broken = brokenPlacements(branding, logos, slots)
  const resolving = values.length - broken.filter((b) => slots.some((s) => s.key === b.slot)).length
  const freq = new Map()
  for (const v of values) freq.set(v, (freq.get(v) || 0) + 1)
  const top = Math.max(0, ...freq.values())
  const deprecatedIds = registry ? new Set(registry.filter((r) => r.status === 'deprecated').map((r) => r.asset_id)) : null
  const deprecatedInUse = deprecatedIds ? values.filter((v) => deprecatedIds.has(v)).length : null
  const missingLogo = typeof companyLogo === 'string' && !companyLogo.trim() ? 1 : 0
  return {
    consistencyPct: values.length ? Math.round((top / values.length) * 100) : null,
    broken: broken.length,
    unassigned: slots.length - values.length,
    assigned: resolving,
    slotTotal: slots.length,
    deprecatedInUse,
    warnings: broken.length + missingLogo + (deprecatedInUse || 0),
  }
}

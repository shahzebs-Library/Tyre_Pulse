/**
 * Tyre Specifications view engine (pure, no I/O).
 *
 * A row of `tyre_specifications` is an approved FITMENT RULE for one vehicle
 * type and position: a list of approved sizes, a list of approved brands, a
 * minimum load index, speed symbol, ply rating, pressure and tread. It is not a
 * brand/pattern catalogue entry, so this engine never invents a pattern, a
 * tube type, an approval state, a weight or a document. It derives only what
 * the stored columns support:
 *   - load in kg and speed in km/h from the shared ISO tables in tyreSpecCatalog;
 *   - nominal dimensions from a metric size code (width/aspect R rim);
 *   - in-service usage from the compliance rows the page already computes.
 */
import { loadIndexKg, speedIndexKmh } from './tyreSpecCatalog'

const clean = (v) => String(v ?? '').trim()

/** Compact, case-folded size key ("315/80 R22.5" and "315/80r22.5" match). */
export function sizeKey(size) {
  return clean(size).replace(/\s+/g, '').toUpperCase()
}

/**
 * Parse a metric size code into its parts. Returns null for anything that is
 * not width/aspect R rim (OTR codes such as 23.5R25 or 12.00R24 carry no
 * aspect ratio, so no nominal geometry is derived for them).
 */
export function parseSize(size) {
  const m = /^(\d{3})\/(\d{2})(?:[RZDB-])?(\d{2}(?:\.\d)?)$/.exec(sizeKey(size))
  if (!m) return null
  const width = Number(m[1])
  const aspect = Number(m[2])
  const rim = Number(m[3])
  if (!(width > 0 && aspect > 0 && rim > 0)) return null
  return { width, aspect, rim }
}

/** Build a size code from the three form inputs, or null when incomplete. */
export function composeSize(width, aspect, rim) {
  const w = Number(width); const a = Number(aspect); const r = Number(rim)
  if (!(Number.isFinite(w) && w >= 100 && w <= 999)) return null
  if (!(Number.isFinite(a) && a >= 10 && a <= 99)) return null
  if (!(Number.isFinite(r) && r >= 8 && r <= 63)) return null
  return `${Math.round(w)}/${Math.round(a)}R${r}`
}

/**
 * Nominal geometry of a metric size, in millimetres. These are the standard
 * size-code arithmetic, not a measurement of any particular tyre.
 */
export function sizeDimensions(size) {
  const p = parseSize(size)
  if (!p) return null
  const sidewall = (p.width * p.aspect) / 100
  const rimMm = p.rim * 25.4
  return {
    size: clean(size),
    sectionWidth: p.width,
    aspect: p.aspect,
    rimInch: p.rim,
    sidewall: Math.round(sidewall),
    rimDiameter: Math.round(rimMm),
    overallDiameter: Math.round(rimMm + 2 * sidewall),
  }
}

/** Mockup tyre-type groups, mapped from the stored position. */
export const TYRE_TYPES = ['Steer', 'Drive', 'Trailer', 'Off-Road', 'Other']

export function tyreTypeOf(position) {
  const p = clean(position).toLowerCase()
  if (p === 'steer') return 'Steer'
  if (p === 'drive') return 'Drive'
  if (p === 'trailer') return 'Trailer'
  if (p.includes('otr')) return 'Off-Road'
  return 'Other'
}

/** Default position written when a tyre type segment is picked in the form. */
export function positionForTyreType(type, current) {
  if (type === 'Steer' || type === 'Drive' || type === 'Trailer') return type
  if (type === 'Off-Road') return /otr/i.test(clean(current)) ? current : 'Front (OTR)'
  return ['Lift Axle', 'Tag Axle', 'All Positions'].includes(current) ? current : 'All Positions'
}

const uniqSorted = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b))

/** Distinct approved brands across the register (case preserved, first seen). */
export function distinctBrands(specs = []) {
  const seen = new Map()
  for (const s of specs) for (const b of s.approved_brands || []) {
    const k = clean(b).toLowerCase()
    if (k && !seen.has(k)) seen.set(k, clean(b))
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Distinct approved sizes across the register, folded by size key. */
export function distinctSizes(specs = []) {
  const seen = new Map()
  for (const s of specs) for (const z of s.approved_sizes || []) {
    const k = sizeKey(z)
    if (k && !seen.has(k)) seen.set(k, clean(z))
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * In-service usage per specification id, from the page's compliance rows
 * (each row carries `matchingSpec` when a rule covers the fitted tyre).
 */
export function specUsage(complianceRows = []) {
  const map = new Map()
  for (const r of complianceRows) {
    const id = r.matchingSpec?.id
    if (!id) continue
    const u = map.get(id) || { fitted: 0, conforming: 0, nonConforming: 0 }
    u.fitted += 1
    if (r.specStatus === 'Approved') u.conforming += 1
    else u.nonConforming += 1
    map.set(id, u)
  }
  return map
}

/** Usage status of one spec: out of spec, all conforming, or not in use. */
export const USAGE_STATUS = [
  { key: 'issues', label: 'Out of spec fitments', tone: 'warn' },
  { key: 'conforming', label: 'All fitments conform', tone: 'good' },
  { key: 'unused', label: 'No fitted tyres', tone: 'muted' },
]

export function usageStatus(usage) {
  if (!usage || !usage.fitted) return USAGE_STATUS[2]
  return usage.nonConforming > 0 ? USAGE_STATUS[0] : USAGE_STATUS[1]
}

/**
 * Six headline figures. `compliance` is the page's fitted-tyre summary
 * ({ total, approved, nonConforming }). Pattern is not stored, so it is null.
 */
export function specKpis(specs = [], compliance = null) {
  return {
    total: specs.length,
    brands: distinctBrands(specs).length,
    patterns: null,
    sizes: distinctSizes(specs).length,
    approvedFitted: compliance ? compliance.approved ?? null : null,
    notApprovedFitted: compliance ? compliance.nonConforming ?? null : null,
    fittedTotal: compliance ? compliance.total ?? null : null,
  }
}

export const EMPTY_FILTERS = { search: '', brand: '', size: '', tyreType: '', vehicleType: '', status: '' }

/** Filter the register. `usage` is the specUsage map (needed for status). */
export function filterSpecs(specs = [], filters = EMPTY_FILTERS, usage = new Map()) {
  const q = clean(filters.search).toLowerCase()
  const brand = clean(filters.brand).toLowerCase()
  const size = sizeKey(filters.size)
  return specs.filter((s) => {
    if (filters.vehicleType && s.vehicle_type !== filters.vehicleType) return false
    if (filters.tyreType && tyreTypeOf(s.position) !== filters.tyreType) return false
    if (brand && !(s.approved_brands || []).some((b) => clean(b).toLowerCase() === brand)) return false
    if (size && !(s.approved_sizes || []).some((z) => sizeKey(z) === size)) return false
    if (filters.status && usageStatus(usage.get(s.id)).key !== filters.status) return false
    if (!q) return true
    const hay = [s.vehicle_type, s.position, s.ply_rating, s.min_speed_index, s.notes,
      ...(s.approved_sizes || []), ...(s.approved_brands || [])].map((x) => clean(x).toLowerCase())
    return hay.some((x) => x.includes(q))
  })
}

/** Plain-English description of the active filters (for export scope). */
export function filterScope(filters = EMPTY_FILTERS) {
  const parts = []
  if (clean(filters.search)) parts.push(`search "${clean(filters.search)}"`)
  if (filters.brand) parts.push(`brand: ${filters.brand}`)
  if (filters.size) parts.push(`size: ${filters.size}`)
  if (filters.tyreType) parts.push(`tyre type: ${filters.tyreType}`)
  if (filters.vehicleType) parts.push(`application: ${filters.vehicleType}`)
  if (filters.status) parts.push(`status: ${(USAGE_STATUS.find((u) => u.key === filters.status) || {}).label || filters.status}`)
  return parts.join(', ')
}

/** Option lists offered by the filter bar, from the rows on screen. */
export function filterOptions(specs = []) {
  return {
    brands: distinctBrands(specs),
    sizes: distinctSizes(specs),
    vehicleTypes: uniqSorted(specs.map((s) => clean(s.vehicle_type))),
    tyreTypes: TYRE_TYPES.filter((t) => specs.some((s) => tyreTypeOf(s.position) === t)),
  }
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))

/** Display model of one spec card / detail header. */
export function specCard(spec) {
  const li = num(spec.min_load_index)
  const speed = clean(spec.min_speed_index) || null
  return {
    id: spec.id,
    title: `${clean(spec.vehicle_type) || 'Unnamed vehicle type'}`,
    position: clean(spec.position) || null,
    tyreType: tyreTypeOf(spec.position),
    brands: spec.approved_brands || [],
    sizes: spec.approved_sizes || [],
    loadIndex: li,
    loadKg: li == null ? null : loadIndexKg(li),
    speed,
    speedKmh: speed ? speedIndexKmh(speed) : null,
    ply: clean(spec.ply_rating) || null,
    pressure: num(spec.recommended_pressure),
    tread: num(spec.min_tread_depth),
    notes: clean(spec.notes) || null,
  }
}

export function loadLabel(card) {
  if (card.loadIndex == null) return 'N/A'
  return card.loadKg != null ? `${card.loadIndex} (${card.loadKg.toLocaleString('en-US')} kg)` : String(card.loadIndex)
}

export function speedLabel(card) {
  if (!card.speed) return 'N/A'
  return card.speedKmh != null ? `${card.speed} (${card.speedKmh} km/h)` : card.speed
}

/** Session audit rows that belong to one spec (matched on type and position). */
export function historyFor(spec, history = []) {
  if (!spec) return []
  return history
    .filter((h) => h.vehicle_type === spec.vehicle_type && h.position === spec.position)
    .slice()
    .reverse()
}

/** Clamp a page index after the list shrinks. */
export function clampPage(page, total, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(0, page), pages - 1)
}

export function pageSlice(rows = [], page = 0, pageSize = 12) {
  const p = clampPage(page, rows.length, pageSize)
  return rows.slice(p * pageSize, p * pageSize + pageSize)
}

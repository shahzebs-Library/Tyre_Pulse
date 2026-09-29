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
 *
 * The catalogue section at the end of this file models `tyre_spec_catalog`
 * rows (brand + pattern + size products with an approval status).
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

// ── Catalogue (tyre_spec_catalog) view model ─────────────────────────────────
// A catalogue row is a real brand + pattern + size product with its own
// approval status. Everything below reads stored columns; nominal geometry from
// the size code is only a fallback and is always labelled as such.

export const APPROVAL_META = {
  approved: { key: 'approved', label: 'Approved', tone: 'good' },
  pending: { key: 'pending', label: 'Pending', tone: 'warn' },
  not_approved: { key: 'not_approved', label: 'Not approved', tone: 'bad' },
}
export const APPROVAL_OPTIONS = [APPROVAL_META.approved, APPROVAL_META.pending, APPROVAL_META.not_approved]

export function approvalMeta(status) {
  return APPROVAL_META[status] || APPROVAL_META.pending
}

/** Stored tyre_type token <-> label. */
export const CATALOG_TYPE_LABELS = { steer: 'Steer', drive: 'Drive', trailer: 'Trailer', off_road: 'Off-Road', other: 'Other' }
export function catalogTypeLabel(t) { return CATALOG_TYPE_LABELS[t] || null }
export function catalogTypeToken(label) {
  const hit = Object.entries(CATALOG_TYPE_LABELS).find(([, v]) => v === label)
  return hit ? hit[0] : null
}

const distinctFold = (vals) => {
  const seen = new Map()
  for (const v of vals) { const k = clean(v).toUpperCase(); if (k && !seen.has(k)) seen.set(k, clean(v)) }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Six headline figures over the catalogue rows. */
export function catalogKpis(rows = []) {
  return {
    total: rows.length,
    brands: distinctFold(rows.map((r) => r.brand)).length,
    patterns: distinctFold(rows.map((r) => `${clean(r.brand)} ${clean(r.pattern)}`)).length,
    sizes: new Set(rows.map((r) => sizeKey(r.size)).filter(Boolean)).size,
    approved: rows.filter((r) => r.approval_status === 'approved').length,
    pending: rows.filter((r) => (r.approval_status || 'pending') === 'pending').length,
    notApproved: rows.filter((r) => r.approval_status === 'not_approved').length,
  }
}

export const EMPTY_CATALOG_FILTERS = { search: '', brand: '', pattern: '', size: '', tyreType: '', application: '', status: '' }

export function filterCatalog(rows = [], filters = EMPTY_CATALOG_FILTERS) {
  const q = clean(filters.search).toLowerCase()
  const up = (v) => clean(v).toUpperCase()
  return rows.filter((r) => {
    if (filters.brand && up(r.brand) !== up(filters.brand)) return false
    if (filters.pattern && up(r.pattern) !== up(filters.pattern)) return false
    if (filters.size && sizeKey(r.size) !== sizeKey(filters.size)) return false
    if (filters.tyreType && catalogTypeLabel(r.tyre_type) !== filters.tyreType) return false
    if (filters.application && up(r.application) !== up(filters.application)) return false
    if (filters.status && (r.approval_status || 'pending') !== filters.status) return false
    if (!q) return true
    const hay = [r.brand, r.pattern, r.size, r.application, r.description, r.ply_rating, r.speed_rating,
      ...(r.suitable_for || [])].map((x) => clean(x).toLowerCase())
    return hay.some((x) => x.includes(q))
  })
}

export function catalogFilterOptions(rows = [], brand = '') {
  const inBrand = brand ? rows.filter((r) => clean(r.brand).toUpperCase() === clean(brand).toUpperCase()) : rows
  return {
    brands: distinctFold(rows.map((r) => r.brand)),
    patterns: distinctFold(inBrand.map((r) => r.pattern)),
    sizes: distinctFold(rows.map((r) => r.size)),
    applications: distinctFold(rows.map((r) => r.application)),
    tyreTypes: TYRE_TYPES.filter((t) => rows.some((r) => catalogTypeLabel(r.tyre_type) === t)),
  }
}

export function catalogFilterScope(filters = EMPTY_CATALOG_FILTERS) {
  const parts = []
  if (clean(filters.search)) parts.push(`search "${clean(filters.search)}"`)
  if (filters.brand) parts.push(`brand: ${filters.brand}`)
  if (filters.pattern) parts.push(`pattern: ${filters.pattern}`)
  if (filters.size) parts.push(`size: ${filters.size}`)
  if (filters.tyreType) parts.push(`tyre type: ${filters.tyreType}`)
  if (filters.application) parts.push(`application: ${filters.application}`)
  if (filters.status) parts.push(`status: ${approvalMeta(filters.status).label}`)
  return parts.join(', ')
}

/** "152/148 (3,550 / 3,150 kg)" style label; parts missing read N/A. */
export function catalogLoadLabel(row) {
  const s = num(row?.load_index_single); const d = num(row?.load_index_dual)
  if (s == null && d == null) return 'N/A'
  const idx = [s, d].filter((x) => x != null).join('/')
  const kgs = [s, d].filter((x) => x != null).map((x) => loadIndexKg(x))
  if (kgs.some((k) => k == null)) return idx
  return `${idx} (${kgs.map((k) => `${k.toLocaleString('en-US')} kg`).join(' / ')})`
}

export function catalogSpeedLabel(row) {
  const s = clean(row?.speed_rating)
  if (!s) return 'N/A'
  const kmh = speedIndexKmh(s)
  return kmh != null ? `${s} (${kmh} km/h)` : s
}

/**
 * Geometry for the technical drawing: stored measurements when present,
 * otherwise nominal size-code arithmetic. `source` says which.
 */
export function catalogDimensions(row) {
  if (!row) return null
  const nominal = sizeDimensions(row.size)
  const od = num(row.overall_diameter_mm); const sw = num(row.section_width_mm)
  const rimIn = num(row.rim_in) ?? nominal?.rimInch ?? null
  if (od && sw && rimIn) {
    return { size: clean(row.size), overallDiameter: od, sectionWidth: sw, rimInch: rimIn, rimDiameter: Math.round(rimIn * 25.4), source: 'recorded' }
  }
  if (nominal) return { ...nominal, source: 'nominal' }
  return null
}

/** Size parts for the form, from stored columns or the size code. */
export function catalogSizeParts(row) {
  const p = parseSize(row?.size)
  return {
    w: num(row?.width_mm) ?? p?.width ?? '',
    a: num(row?.aspect_ratio) ?? p?.aspect ?? '',
    r: num(row?.rim_in) ?? p?.rim ?? '',
  }
}

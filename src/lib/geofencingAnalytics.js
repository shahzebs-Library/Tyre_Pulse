/**
 * geofencingAnalytics - pure presentation engine for the Geofencing register
 * (/geofencing). The zone maths (coverage, overlaps, data quality, area) stays
 * in `src/lib/geofences.js`; this module only owns what the PAGE derives from
 * it: filter options, the filtered register, the export shape, the per-site
 * rollup and the empty-state decision. No I/O, no clock.
 *
 * Honesty rules:
 *   - a zone with no radius has NO area (null), never 0 km2;
 *   - the empty state distinguishes "filters hide everything", "the table is
 *     certainly not provisioned" and "nothing recorded yet" - collapsing the
 *     last two sent owners to run a migration over an empty register.
 */
import { ZONE_TYPES, ZONE_TYPE_META, zoneAreaKm2, hasValidCenter } from './geofences'

const text = (v) => (v == null ? '' : String(v).trim())

/** Default filter state for the register. */
export const GEOFENCE_FILTERS = Object.freeze({ type: 'all', site: '', status: 'all', search: '' })

/** True when any filter narrows the register. */
export function hasGeofenceFilters(f = GEOFENCE_FILTERS) {
  return (f.type && f.type !== 'all') || !!text(f.site) || (f.status && f.status !== 'all') || !!text(f.search)
}

/** Sorted distinct site names present on the zones. */
export function geofenceSiteOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => text(r?.site)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

/** Apply type / site / active / free-text filters. Never mutates the input. */
export function filterGeofences(rows = [], f = GEOFENCE_FILTERS) {
  const q = text(f.search).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.type && f.type !== 'all' && r?.zone_type !== f.type) return false
    if (text(f.site) && text(r?.site) !== text(f.site)) return false
    if (f.status === 'active' && r?.active === false) return false
    if (f.status === 'inactive' && r?.active !== false) return false
    if (q) {
      const hay = `${r?.name || ''} ${r?.site || ''} ${r?.notes || ''} ${r?.zone_type || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Zone type label (unknown types fold to the stored token, never blank). */
export function zoneTypeLabel(type) {
  return ZONE_TYPE_META[type]?.label || text(type) || 'Custom'
}

/**
 * Sortable row view: numeric radius/area (null when absent), a boolean
 * `located` flag and the resolved type label. Used by the table accessors.
 */
export function geofenceTableRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const radius = Number(r?.radius_m)
    const hasRadius = Number.isFinite(radius) && radius > 0
    return {
      ...r,
      _typeLabel: zoneTypeLabel(r?.zone_type),
      _radius: hasRadius ? radius : null,
      _area: hasRadius ? zoneAreaKm2(radius) : null,
      _located: hasValidCenter(r),
      _active: r?.active !== false,
    }
  })
}

/** Export shape (full filtered set, never the visible page). */
export const GEOFENCE_EXPORT_COLS = ['name', 'zone_type', 'site', 'center_lat', 'center_lng', 'radius_m', 'area_km2', 'active']
export const GEOFENCE_EXPORT_HEADERS = ['Name', 'Type', 'Site', 'Latitude', 'Longitude', 'Radius (m)', 'Area (km2)', 'Active']

export function geofenceExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const area = zoneAreaKm2(r?.radius_m)
    return {
      name: r?.name || '',
      zone_type: zoneTypeLabel(r?.zone_type),
      site: r?.site || '',
      center_lat: r?.center_lat ?? '',
      center_lng: r?.center_lng ?? '',
      radius_m: r?.radius_m ?? '',
      area_km2: area == null ? 'N/A' : Math.round(area * 1000) / 1000,
      active: r?.active === false ? 'No' : 'Yes',
    }
  })
}

/**
 * Per-site rollup: zones, active zones and covered area. Zones with no site
 * group under "Site not set". Area is null for a site where no zone has a
 * radius (unmeasured, not zero). Sorted by zone count desc then name.
 */
export function geofenceSiteRollup(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const site = text(r?.site) || 'Site not set'
    const g = map.get(site) || { site, zones: 0, active: 0, areaKm2: null, types: new Set() }
    g.zones += 1
    if (r?.active !== false) g.active += 1
    const area = zoneAreaKm2(r?.radius_m)
    if (area != null) g.areaKm2 = (g.areaKm2 ?? 0) + area
    if (ZONE_TYPES.includes(r?.zone_type)) g.types.add(r.zone_type)
    map.set(site, g)
  }
  return [...map.values()]
    .map((g) => ({ ...g, types: [...g.types].map(zoneTypeLabel) }))
    .sort((a, b) => b.zones - a.zones || a.site.localeCompare(b.site))
}

/** The first `n` entries of a list plus how many were left out. */
export function headAndRest(list = [], n = 12) {
  const arr = Array.isArray(list) ? list : []
  return { head: arr.slice(0, Math.max(0, n)), rest: Math.max(0, arr.length - Math.max(0, n)) }
}

/**
 * Which empty state the register should show.
 *   'loading' | 'filtered' | 'not_provisioned' | 'empty' | null (has rows)
 * `notProvisioned` must only be true when a probe was CERTAIN the relation is
 * absent (checked && !exists); an inconclusive probe keeps the plain empty.
 */
export function geofenceEmptyState({ rows, filtered, filters, notProvisioned }) {
  if (rows == null) return 'loading'
  if ((filtered || []).length > 0) return null
  if (hasGeofenceFilters(filters)) return 'filtered'
  if (notProvisioned) return 'not_provisioned'
  return 'empty'
}

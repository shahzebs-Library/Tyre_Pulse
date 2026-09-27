import { describe, it, expect } from 'vitest'
import {
  filterGeofences, geofenceSiteOptions, hasGeofenceFilters, geofenceTableRows,
  geofenceExportRows, geofenceSiteRollup, headAndRest, geofenceEmptyState, GEOFENCE_FILTERS,
} from '../lib/geofencingAnalytics'

const zones = [
  { id: 1, name: 'Jebel Ali Depot', zone_type: 'site', site: 'JAFZA', center_lat: 25, center_lng: 55, radius_m: 1000, active: true },
  { id: 2, name: 'Port Gate', zone_type: 'restricted', site: 'JAFZA', center_lat: 25.01, center_lng: 55.01, radius_m: '', active: false, notes: 'night only' },
  { id: 3, name: 'Workshop', zone_type: 'service', site: '', center_lat: null, center_lng: null, radius_m: 500 },
]

describe('geofencingAnalytics', () => {
  it('filters by type, site, status and free text', () => {
    expect(filterGeofences(zones, { ...GEOFENCE_FILTERS, type: 'site' }).map((z) => z.id)).toEqual([1])
    expect(filterGeofences(zones, { ...GEOFENCE_FILTERS, site: 'JAFZA' })).toHaveLength(2)
    expect(filterGeofences(zones, { ...GEOFENCE_FILTERS, status: 'inactive' }).map((z) => z.id)).toEqual([2])
    expect(filterGeofences(zones, { ...GEOFENCE_FILTERS, status: 'active' }).map((z) => z.id)).toEqual([1, 3])
    expect(filterGeofences(zones, { ...GEOFENCE_FILTERS, search: 'NIGHT' }).map((z) => z.id)).toEqual([2])
    expect(filterGeofences(null, GEOFENCE_FILTERS)).toEqual([])
  })

  it('reports whether any filter is active', () => {
    expect(hasGeofenceFilters(GEOFENCE_FILTERS)).toBe(false)
    expect(hasGeofenceFilters({ ...GEOFENCE_FILTERS, search: '  ' })).toBe(false)
    expect(hasGeofenceFilters({ ...GEOFENCE_FILTERS, site: 'X' })).toBe(true)
  })

  it('lists distinct sorted sites', () => {
    expect(geofenceSiteOptions(zones)).toEqual(['JAFZA'])
  })

  it('never invents an area or radius for a zone without a radius', () => {
    const rows = geofenceTableRows(zones)
    expect(rows[1]._radius).toBeNull()
    expect(rows[1]._area).toBeNull()
    expect(rows[0]._area).toBeCloseTo(Math.PI, 5)
    expect(rows[2]._located).toBe(false)
    const exp = geofenceExportRows(zones)
    expect(exp[1].area_km2).toBe('N/A')
    expect(exp[1].active).toBe('No')
    expect(exp[0].zone_type).toBe('Site')
  })

  it('rolls zones up per site with a null area when nothing is measured', () => {
    const roll = geofenceSiteRollup(zones)
    expect(roll[0]).toMatchObject({ site: 'JAFZA', zones: 2, active: 1 })
    const unset = roll.find((r) => r.site === 'Site not set')
    expect(unset.zones).toBe(1)
    const onlyUnmeasured = geofenceSiteRollup([{ site: 'A', radius_m: null }])
    expect(onlyUnmeasured[0].areaKm2).toBeNull()
  })

  it('splits a list into a head and a remainder count', () => {
    expect(headAndRest([1, 2, 3], 2)).toEqual({ head: [1, 2], rest: 1 })
    expect(headAndRest(null, 2)).toEqual({ head: [], rest: 0 })
  })

  it('keeps the three empty states distinct', () => {
    expect(geofenceEmptyState({ rows: null, filtered: [], filters: GEOFENCE_FILTERS })).toBe('loading')
    expect(geofenceEmptyState({ rows: zones, filtered: zones, filters: GEOFENCE_FILTERS })).toBeNull()
    expect(geofenceEmptyState({ rows: zones, filtered: [], filters: { ...GEOFENCE_FILTERS, type: 'site' } })).toBe('filtered')
    expect(geofenceEmptyState({ rows: [], filtered: [], filters: GEOFENCE_FILTERS, notProvisioned: true })).toBe('not_provisioned')
    expect(geofenceEmptyState({ rows: [], filtered: [], filters: GEOFENCE_FILTERS, notProvisioned: false })).toBe('empty')
  })
})

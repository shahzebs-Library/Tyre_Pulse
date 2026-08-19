/**
 * Region and vehicle type on the inspection register and the tyre change summary.
 *
 * The owner asked for both filters on both surfaces, in the main filter row AND
 * governing the summary above it. These pin the rules that are easy to get
 * wrong and impossible to see by reading:
 *
 *  - a row that cannot be PLACED (no region, no vehicle type) must be excluded
 *    while that filter is on, never swept into whichever value was picked;
 *  - the options must come from the rows on screen, not a master list, or the
 *    control offers choices that return nothing;
 *  - the summary must count the same rows the table shows.
 */

import { describe, it, expect } from 'vitest'
import {
  inspectionMatchesFilters, vehicleTypesIn, normVehicleType,
} from '../lib/inspectionTyreFlags'
import {
  filterTracking, trackingFacets, untypedCount, trackingScopeLabel, normTrackVehicleType,
} from '../lib/tyreChangeTracking'

// The live vocabulary, from the inspections table: TR-MIXER 300, PUMPS 70, TRUCK 43.
const insp = (over = {}) => ({
  site: 'NHC', vehicle_type: 'TR-MIXER', inspector: 'A', status: 'Done',
  scheduled_date: '2026-08-01', ...over,
})

describe('inspection register: vehicle type', () => {
  it('filters to one machine class', () => {
    expect(inspectionMatchesFilters(insp(), { vehicleType: 'TR-MIXER' })).toBe(true)
    expect(inspectionMatchesFilters(insp({ vehicle_type: 'PUMPS' }), { vehicleType: 'TR-MIXER' })).toBe(false)
  })

  it('folds case and padding, so one class is not offered as two options', () => {
    // V245 normalised the column, but an import or an older row can still differ.
    expect(inspectionMatchesFilters(insp({ vehicle_type: ' tr-mixer ' }), { vehicleType: 'TR-MIXER' })).toBe(true)
    expect(vehicleTypesIn([insp(), insp({ vehicle_type: ' tr-mixer ' }), insp({ vehicle_type: 'PUMPS' })]))
      .toEqual(['PUMPS', 'TR-MIXER'])
  })

  it('excludes a row with no recorded type rather than guessing', () => {
    // It is not known to be a mixer. Including it would put an unclassified
    // machine into a class the reader then acts on.
    expect(inspectionMatchesFilters(insp({ vehicle_type: '' }), { vehicleType: 'TR-MIXER' })).toBe(false)
    expect(inspectionMatchesFilters(insp({ vehicle_type: null }), { vehicleType: 'PUMPS' })).toBe(false)
  })

  it('leaves every row alone when no type is chosen', () => {
    expect(inspectionMatchesFilters(insp({ vehicle_type: '' }), { vehicleType: 'all' })).toBe(true)
  })

  it('offers only the types present, never a master list', () => {
    expect(vehicleTypesIn([insp(), insp(), insp({ vehicle_type: 'PUMPS' })])).toEqual(['PUMPS', 'TR-MIXER'])
    expect(vehicleTypesIn([])).toEqual([])
  })

  it('composes with region without either weakening the other', () => {
    const regionOf = (s) => (s === 'NHC' ? 'CENTRAL' : '')
    const f = { region: 'CENTRAL', vehicleType: 'TR-MIXER' }
    expect(inspectionMatchesFilters(insp(), f, { regionOf })).toBe(true)
    expect(inspectionMatchesFilters(insp({ site: 'JED' }), f, { regionOf })).toBe(false)
    expect(inspectionMatchesFilters(insp({ vehicle_type: 'PUMPS' }), f, { regionOf })).toBe(false)
  })

  it('normVehicleType keeps blank blank, so "not recorded" stays distinguishable', () => {
    expect(normVehicleType('')).toBe('')
    expect(normVehicleType(null)).toBe('')
    expect(normVehicleType(' pumps ')).toBe('PUMPS')
  })
})

const flag = (over = {}) => ({
  asset: 'TM660', site: 'NHC', vehicleType: 'TR-MIXER', state: 'open', source: 'system', ...over,
})

describe('tyre change summary: site, region and vehicle type', () => {
  const regionOf = (s) => ({ NHC: 'CENTRAL', JED: 'WESTERN' }[s] || '')

  it('filters by site', () => {
    const rows = [flag(), flag({ site: 'JED' })]
    expect(filterTracking(rows, { site: 'NHC' })).toHaveLength(1)
  })

  it('filters by region, which is read from the site register', () => {
    const rows = [flag(), flag({ site: 'JED' })]
    expect(filterTracking(rows, { region: 'WESTERN' }, { regionOf })).toHaveLength(1)
  })

  it('matches nothing when a region is asked for with no resolver', () => {
    // Guessing would sweep every unplaced site into the region that was picked.
    const rows = [flag(), flag({ site: 'JED' })]
    expect(filterTracking(rows, { region: 'CENTRAL' })).toHaveLength(0)
  })

  it('excludes an unplaced site while a region is chosen', () => {
    const rows = [flag(), flag({ site: 'NOWHERE' })]
    expect(filterTracking(rows, { region: 'CENTRAL' }, { regionOf })).toHaveLength(1)
  })

  it('filters by vehicle type, case folded', () => {
    const rows = [flag(), flag({ vehicleType: 'PUMPS' }), flag({ vehicleType: ' tr-mixer ' })]
    expect(filterTracking(rows, { vehicleType: 'TR-MIXER' })).toHaveLength(2)
  })

  it('excludes a flagged tyre with no recorded type, and publishes how many', () => {
    // 92.5% of active tyres resolve a type; the rest must not be silently folded
    // into whichever class was picked, and the screen has to be able to say so.
    const rows = [flag(), flag({ vehicleType: '' }), flag({ vehicleType: null })]
    expect(filterTracking(rows, { vehicleType: 'TR-MIXER' })).toHaveLength(1)
    expect(untypedCount(rows)).toBe(2)
  })

  it('offers only the sites, regions and types the flagged rows cover', () => {
    const rows = [flag(), flag({ site: 'JED', vehicleType: 'PUMPS' }), flag({ vehicleType: '' })]
    const f = trackingFacets(rows, { regionOf })
    expect(f.sites).toEqual(['JED', 'NHC'])
    expect(f.vehicleTypes).toEqual(['PUMPS', 'TR-MIXER'])
    expect(f.regions).toEqual(['CENTRAL', 'WESTERN'])
  })

  it('the export scope line names the new filters, so a saved file states its own scope', () => {
    const label = trackingScopeLabel({
      country: 'KSA', site: 'NHC', region: 'CENTRAL', vehicleType: 'PUMPS',
    })
    expect(label).toContain('region: CENTRAL')
    expect(label).toContain('site: NHC')
    expect(label).toContain('vehicle type: PUMPS')
  })

  it('the old three-argument call still behaves exactly as before', () => {
    // Every existing caller passes no site/region/type; none of them may narrow.
    const rows = [flag(), flag({ site: 'JED', vehicleType: 'PUMPS' })]
    expect(filterTracking(rows, { state: 'all', source: 'all', search: '' })).toHaveLength(2)
  })

  it('mirrors the inspection normaliser, since both feed the same words', () => {
    for (const v of ['tr-mixer', ' PUMPS ', '', null]) {
      expect(normTrackVehicleType(v)).toBe(normVehicleType(v))
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  shapeRow, shapeRunningLife, summarize, bandFor, filterRows, fmtNum,
  coverage, coverageNote,
} from '../lib/tyreRunningLife'

const row = (over = {}) => ({
  serial_no: 'S1', asset_no: 'TM100', position: 'LHF1', vehicle_type: 'TR-MIXER',
  unit: 'km', site: 'NHC', country: 'KSA', brand: 'PIRELLI', size: '315/80R22.5',
  fitted_on: '2026-01-01', km_at_fitment: 100000, current_km: 130000, km_run: 30000,
  hours_at_fitment: null, current_hours: null, hours_run: null,
  expected_life_km: 60000, life_sample: 40, remaining_km: 30000, life_used_pct: 50,
  ...over,
})

describe('tyreRunningLife', () => {
  it('shapes a row with numeric coercion and hour-unit mapping', () => {
    const r = shapeRow(row({ unit: 'engine_hours', km_run: '30000' }))
    expect(r.unit).toBe('hours')
    expect(r.kmRun).toBe(30000)
    expect(r.remainingKm).toBe(30000)
  })

  it('null stays null - never a fabricated zero', () => {
    const r = shapeRow(row({ km_run: null, remaining_km: null, life_used_pct: null }))
    expect(r.kmRun).toBeNull()
    expect(r.remainingKm).toBeNull()
    expect(bandFor(r)).toBe('unknown')
    expect(fmtNum(r.kmRun)).toBe('N/A')
  })

  it('bands: overdue at 0 remaining, due-soon under 10k or >=90% used', () => {
    expect(bandFor(shapeRow(row({ remaining_km: 0, life_used_pct: 120 })))).toBe('overdue')
    expect(bandFor(shapeRow(row({ remaining_km: 5000, life_used_pct: 80 })))).toBe('due-soon')
    expect(bandFor(shapeRow(row({ remaining_km: 20000, life_used_pct: 92 })))).toBe('due-soon')
    expect(bandFor(shapeRow(row({ remaining_km: 25000, life_used_pct: 65 })))).toBe('mid-life')
    expect(bandFor(shapeRow(row({ remaining_km: 40000, life_used_pct: 30 })))).toBe('healthy')
  })

  it('summarize counts measurable/overdue/due-soon and averages only measured pcts', () => {
    const rows = [
      shapeRow(row({ remaining_km: 0, life_used_pct: 150 })),
      shapeRow(row({ remaining_km: 4000, life_used_pct: 93 })),
      shapeRow(row({ km_run: null, remaining_km: null, life_used_pct: null })),
      shapeRow(row({ hours_run: 500 })),
    ]
    const s = summarize(rows)
    expect(s.total).toBe(4)
    expect(s.measurableKm).toBe(3)
    expect(s.measurableHours).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.dueSoon).toBe(1)
    expect(s.avgUsedPct).toBe(Math.round((150 + 93 + 50) / 3))
  })

  it('summarize of nothing is honest zero/null', () => {
    const s = summarize([])
    expect(s.total).toBe(0)
    expect(s.avgUsedPct).toBeNull()
  })

  it('filterRows: region and asset type are MULTI-SELECT', () => {
    const rows = [
      shapeRow(row({ asset_no: 'TM100', site: 'NHC', vehicle_type: 'TR-MIXER' })),
      shapeRow(row({ asset_no: 'MP200', site: 'JED', vehicle_type: 'PUMPS' })),
      shapeRow(row({ asset_no: 'WL300', site: 'RUH', vehicle_type: 'WHEEL LOADER' })),
    ]
    const regionOf = (site) => ({ NHC: 'CENTRAL', JED: 'WESTERN' }[site] || '')

    // The question this control exists for: two classes at once. A single-select
    // could only ask it twice, and never show the combined totals.
    expect(filterRows(rows, { vehicleType: ['TR-MIXER', 'PUMPS'] })
      .map((r) => r.asset)).toEqual(['TM100', 'MP200'])
    expect(filterRows(rows, { vehicleType: 'PUMPS' }).map((r) => r.asset)).toEqual(['MP200'])
    // An empty selection narrows nothing - unticking the last chip must not
    // empty the table.
    expect(filterRows(rows, { vehicleType: [] })).toHaveLength(3)

    expect(filterRows(rows, { region: ['CENTRAL', 'WESTERN'] }, { regionOf })
      .map((r) => r.asset)).toEqual(['TM100', 'MP200'])
    // A site the register cannot place is EXCLUDED while a region is chosen,
    // never swept into whichever region was picked.
    expect(filterRows(rows, { region: ['CENTRAL'] }, { regionOf })
      .map((r) => r.asset)).toEqual(['TM100'])
    // Region and type compose, they do not override each other.
    expect(filterRows(rows, { region: ['CENTRAL', 'WESTERN'], vehicleType: ['PUMPS'] }, { regionOf })
      .map((r) => r.asset)).toEqual(['MP200'])
  })

  it('filterRows: with no region resolver a region selection matches NOTHING', () => {
    // Guessing would sweep every unplaced site into the chosen region, which is
    // a fabricated answer dressed up as a filter.
    const rows = [shapeRow(row({ site: 'NHC' }))]
    expect(filterRows(rows, { region: ['CENTRAL'] })).toHaveLength(0)
    expect(filterRows(rows, { region: 'all' })).toHaveLength(1)
  })

  it('filterRows: asset type is matched case- and padding-insensitively', () => {
    const rows = [shapeRow(row({ vehicle_type: 'TR-MIXER' })), shapeRow(row({ vehicle_type: '' }))]
    expect(filterRows(rows, { vehicleType: [' tr-mixer '] })).toHaveLength(1)
    // A row with no recorded type is not known to be a mixer.
    expect(filterRows(rows, { vehicleType: ['TR-MIXER'] })).toHaveLength(1)
  })

  it('filterRows: search across serial/asset/site, band filter, unit filter', () => {
    const rows = [
      shapeRow(row()),
      shapeRow(row({ serial_no: 'S2', asset_no: 'BH020', unit: 'engine_hours', remaining_km: 0 })),
    ]
    expect(filterRows(rows, { search: 'bh020' })).toHaveLength(1)
    expect(filterRows(rows, { band: 'overdue' })).toHaveLength(1)
    expect(filterRows(rows, { unit: 'hours' })).toHaveLength(1)
    expect(filterRows(rows, {})).toHaveLength(2)
  })

  it('shapeRunningLife degrades a failed payload', () => {
    expect(shapeRunningLife(null).ok).toBe(false)
    expect(shapeRunningLife({ ok: false }).rows).toEqual([])
    const good = shapeRunningLife({ ok: true, rows: [row()] })
    expect(good.ok).toBe(true)
    expect(good.rows).toHaveLength(1)
    expect(good.summary.total).toBe(1)
  })
})

describe('V489 additions: days + basis', () => {
  it('shapes days and basis fields', () => {
    const r = shapeRow({
      serial_no: 'S9', asset_no: 'TM1', km_run: 30000, expected_life_km: 60000,
      remaining_km: 30000, life_used_pct: 50, days_on: 120, expected_days: 300,
      day_sample: 40, remaining_days: 180, life_basis: 'measured_type', life_sample: 25,
    })
    expect(r.daysOn).toBe(120)
    expect(r.remainingDays).toBe(180)
    expect(r.lifeBasis).toBe('measured_type')
  })

  it('basisLabel: manual has no sample, measured shows it, missing is honest', async () => {
    const { basisLabel } = await import('../lib/tyreRunningLife')
    expect(basisLabel(shapeRow({ life_basis: 'manual' }))).toBe('Your target')
    expect(basisLabel(shapeRow({ life_basis: 'measured_type', life_sample: 25 }))).toBe('Type avg (25)')
    expect(basisLabel(shapeRow({ life_basis: 'measured_size', life_sample: 7 }))).toBe('Size avg (7)')
    expect(basisLabel(shapeRow({}))).toBe('No baseline')
  })
})

describe('inFittedRange', () => {
  it('passes everything with no range; excludes undated rows when a range is active', async () => {
    const { inFittedRange } = await import('../lib/tyreRunningLife')
    const dated = shapeRow(row({ fitted_on: '2026-03-15' }))
    const undated = shapeRow(row({ fitted_on: null }))
    expect(inFittedRange(dated)).toBe(true)
    expect(inFittedRange(undated)).toBe(true)
    expect(inFittedRange(dated, '2026-03-01', '2026-03-31')).toBe(true)
    expect(inFittedRange(dated, '2026-04-01', '')).toBe(false)
    expect(inFittedRange(dated, '', '2026-02-28')).toBe(false)
    expect(inFittedRange(undated, '2026-01-01', '')).toBe(false)
  })
})

describe('vehicleTypesIn', () => {
  it('offers one option per machine class, not one per spelling', async () => {
    const { vehicleTypesIn } = await import('../lib/tyreRunningLife')
    expect(vehicleTypesIn([
      { vehicleType: 'TR-MIXER' }, { vehicleType: ' tr-mixer ' }, { vehicleType: 'PUMPS' },
      { vehicleType: '' }, { vehicleType: null },
    ])).toEqual(['PUMPS', 'TR-MIXER'])
  })
})

describe('filterDescription', () => {
  it('describes no filters honestly', async () => {
    const { filterDescription } = await import('../lib/tyreRunningLife')
    expect(filterDescription()).toBe('All active tyres')
    expect(filterDescription({ search: '  ', band: 'all', unit: 'all' })).toBe('All active tyres')
  })

  it('composes search, band, unit and date range in plain English', async () => {
    const { filterDescription } = await import('../lib/tyreRunningLife')
    expect(filterDescription({ search: 'TM1', band: 'due-soon', unit: 'km', fromDate: '2026-01-01', toDate: '2026-06-30' }))
      .toBe('search "TM1", state: Due soon, km-measured assets only, fitted 2026-01-01 to 2026-06-30')
    expect(filterDescription({ fromDate: '2026-01-01' })).toBe('fitted from 2026-01-01')
    expect(filterDescription({ toDate: '2026-06-30' })).toBe('fitted up to 2026-06-30')
    expect(filterDescription({ unit: 'hours' })).toBe('hour-measured assets only')
  })

  it('names the region and EVERY chosen asset type', async () => {
    const { filterDescription } = await import('../lib/tyreRunningLife')
    // A report header naming one of three chosen types misdescribes the file
    // for as long as anyone keeps it.
    expect(filterDescription({ vehicleType: ['TR-MIXER', 'PUMPS'] }))
      .toBe('asset type: TR-MIXER, PUMPS')
    expect(filterDescription({ region: ['CENTRAL'] })).toBe('region: CENTRAL')
    expect(filterDescription({ region: [], vehicleType: [] })).toBe('All active tyres')
  })

  // An export of 465 of 3,595 rows headed "All active tyres" is a false
  // statement that outlives the screen it came from.
  it('names the due-only scope first so an export cannot claim to be the fleet', async () => {
    const { filterDescription, DUE_SCOPE_LABEL } = await import('../lib/tyreRunningLife')
    expect(filterDescription({ scope: 'due' })).toBe(DUE_SCOPE_LABEL)
    expect(filterDescription({ scope: 'due', unit: 'km' }))
      .toBe(`${DUE_SCOPE_LABEL}, km-measured assets only`)
    // The default is unchanged, so every existing caller keeps its wording.
    expect(filterDescription({ scope: 'all' })).toBe('All active tyres')
  })
})

describe('bandNeedsFullSet', () => {
  it('marks exactly the bands a due-only fetch can never contain', async () => {
    const { bandNeedsFullSet } = await import('../lib/tyreRunningLife')
    // In the due payload, so no widening: showing them is already possible.
    expect(bandNeedsFullSet('all')).toBe(false)
    expect(bandNeedsFullSet('overdue')).toBe(false)
    expect(bandNeedsFullSet('due-soon')).toBe(false)
    // Not in the due payload: without widening the table would render empty and
    // "we did not fetch it" would look identical to "there are none".
    expect(bandNeedsFullSet('mid-life')).toBe(true)
    expect(bandNeedsFullSet('healthy')).toBe(true)
    expect(bandNeedsFullSet('unknown')).toBe(true)
    expect(bandNeedsFullSet('')).toBe(false)
    expect(bandNeedsFullSet(undefined)).toBe(false)
  })

  it('agrees with bandFor: no row the due filter returns needs the full set', async () => {
    const { bandNeedsFullSet, bandFor, isDueRow } = await import('../lib/tyreRunningLife')
    const rows = [
      { remainingKm: 0 },                            // overdue
      { remainingKm: 5000, lifeUsedPct: 95 },        // due soon
      { remainingKm: 40000, lifeUsedPct: 70 },       // mid life
      { remainingKm: 90000, lifeUsedPct: 10 },       // healthy
      { remainingKm: null },                         // not measurable
    ]
    for (const r of rows) {
      expect(bandNeedsFullSet(bandFor(r))).toBe(!isDueRow(r))
    }
  })
})

describe('actionRows', () => {
  it('selects only overdue + due-soon, overdue first, most-used first within a group', async () => {
    const { actionRows } = await import('../lib/tyreRunningLife')
    const rows = [
      shapeRow(row({ serial_no: 'HEALTHY', remaining_km: 40000, life_used_pct: 30 })),
      shapeRow(row({ serial_no: 'SOON-93', remaining_km: 4000, life_used_pct: 93 })),
      shapeRow(row({ serial_no: 'OVER-150', remaining_km: 0, life_used_pct: 150 })),
      shapeRow(row({ serial_no: 'SOON-98', remaining_km: 1000, life_used_pct: 98 })),
      shapeRow(row({ serial_no: 'UNKNOWN', km_run: null, remaining_km: null, life_used_pct: null })),
    ]
    const out = actionRows(rows)
    expect(out.map((r) => r.serial)).toEqual(['OVER-150', 'SOON-98', 'SOON-93'])
  })

  it('empty in, empty out', async () => {
    const { actionRows } = await import('../lib/tyreRunningLife')
    expect(actionRows([])).toEqual([])
    expect(actionRows()).toEqual([])
  })
})

describe('dueLabel', () => {
  it('Due for overdue/due-soon, Not due otherwise, Unknown when unmeasurable', async () => {
    const { dueLabel } = await import('../lib/tyreRunningLife')
    expect(dueLabel(shapeRow(row({ remaining_km: 0, life_used_pct: 130 })))).toBe('Due')
    expect(dueLabel(shapeRow(row({ remaining_km: 3000, life_used_pct: 95 })))).toBe('Due')
    expect(dueLabel(shapeRow(row({ remaining_km: 30000, life_used_pct: 50 })))).toBe('Not due')
    expect(dueLabel(shapeRow(row({ km_run: null, remaining_km: null, life_used_pct: null })))).toBe('Unknown')
  })
})

describe('coverage - why a Km run cell is blank', () => {
  // Shape mirrors the live KSA fleet: of 3,505 active tyres only 2,059 can show
  // a km run, and NONE of them is missing its fitment km - the gap is entirely
  // that the vehicle's current odometer is unknown, plus plant on hour meters.
  const row = (over = {}) => ({ kmRun: 1000, unit: 'km', currentKm: 5000, kmAtFitment: 4000, ...over })

  it('separates the three real reasons a km run is missing', () => {
    const c = coverage([
      row(),                                                   // measurable
      row({ kmRun: null, currentKm: null }),                   // no odometer on the vehicle
      row({ kmRun: null, currentKm: null }),
      row({ kmRun: null, unit: 'engine_hours' }),              // plant, correctly on hours
      row({ kmRun: null, kmAtFitment: null }),                 // no fitment km
    ])
    expect(c.noCurrentKm).toBe(2)
    expect(c.onHours).toBe(1)
    expect(c.noFitmentKm).toBe(1)
  })

  it('says nothing when every tyre on screen is measurable', () => {
    const s = summarize([row(), row()])
    expect(coverageNote(s)).toBe('')
  })

  it('names the count and points at the fix', () => {
    const s = summarize([row(), row({ kmRun: null, currentKm: null })])
    const note = coverageNote(s)
    expect(note).toContain('1 of 2')
    expect(note).toMatch(/no current odometer reading/i)
    // it must tell the reader what to DO, not just that data is missing
    expect(note).toMatch(/log a meter reading/i)
  })

  it('returns an empty note for an empty view rather than dividing by nothing', () => {
    expect(coverageNote(summarize([]))).toBe('')
    expect(coverageNote(null)).toBe('')
  })
})

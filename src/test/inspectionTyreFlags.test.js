import { describe, it, expect } from 'vitest'
import {
  buildAssetFlagMap, damagedPositions, inspectionOverview, conditionCounts, siteSummary,
  scopeInspections, isSelectionActive,
} from '../lib/inspectionTyreFlags'

// Shaped running-life rows (bandFor vocabulary):
// overdue = remainingKm === 0; due-soon = remainingKm < 10000 or used >= 90.
const overdueRow = (asset, serial = 'S1') => ({ asset, serial, position: 'LHF1', remainingKm: 0, lifeUsedPct: 100 })
const dueSoonRow = (asset, serial = 'S2') => ({ asset, serial, position: 'RHF1', remainingKm: 5000, lifeUsedPct: 80 })
const healthyRow = (asset, serial = 'S3') => ({ asset, serial, position: 'LHR1', remainingKm: 50000, lifeUsedPct: 20 })

describe('buildAssetFlagMap', () => {
  it('groups overdue and due-soon rows per asset with a total count', () => {
    const map = buildAssetFlagMap([overdueRow('TM100'), dueSoonRow('TM100'), dueSoonRow('TM200')])
    expect(map.TM100.overdue).toHaveLength(1)
    expect(map.TM100.dueSoon).toHaveLength(1)
    expect(map.TM100.count).toBe(2)
    expect(map.TM200.count).toBe(1)
  })

  it('excludes healthy/unknown tyres and assets without flags', () => {
    const map = buildAssetFlagMap([healthyRow('TM300'), { asset: 'TM400', remainingKm: null }])
    expect(map).toEqual({})
  })

  it('is safe on empty/garbage input', () => {
    expect(buildAssetFlagMap()).toEqual({})
    expect(buildAssetFlagMap([null, {}, { serial: 'X' }])).toEqual({})
  })

  it('judges an hour-metered tyre by its hours side', () => {
    const map = buildAssetFlagMap([{ asset: 'GN1', remainingKm: null, remainingHours: 0, hoursUsedPct: 100 }])
    expect(map.GN1.overdue).toHaveLength(1)
  })
})

describe('damagedPositions', () => {
  it('reads an array of {position, condition} (checklist shape)', () => {
    const out = damagedPositions({ tyre_conditions: [
      { position: 'LHF1', condition: 'Damage' },
      { position: 'RHF1', condition: 'Good' },
      { position: 'LHR1', condition: 'Puncture' },
    ] })
    expect(out).toEqual([
      { position: 'LHF1', condition: 'Damage' },
      { position: 'LHR1', condition: 'Puncture' },
    ])
  })

  it('reads an object keyed by position with string or object values, case-insensitively', () => {
    const out = damagedPositions({ tyre_conditions: {
      LHF1: 'damage',
      RHF1: { condition: 'Wear' },
      RHR1: { condition: 'Puncture' },
    } })
    expect(out).toEqual([
      { position: 'LHF1', condition: 'damage' },
      // Wear is a fault: it is the condition a tyre is most often replaced FOR.
      // This assertion used to exclude it, which is what made the tracking
      // blind to its own main case.
      { position: 'RHF1', condition: 'Wear' },
      { position: 'RHR1', condition: 'Puncture' },
    ])
  })

  it('flags every fault an inspector can actually record, and never a good tyre', () => {
    // Measured on the live KSA inspections: Good 3,187, Worn 326, Flat 60,
    // Damaged 21, Puncture 8. Only the last two were being flagged, so 93% of
    // recorded faults never reached the system.
    const out = damagedPositions({ tyre_conditions: {
      LHF1: { condition: 'Good' },
      LHF2: { condition: 'Worn' },
      RHF1: { condition: 'Flat' },
      RHF2: { condition: 'Damaged' },
      LHCI: { condition: 'Puncture' },
      LHCO: { condition: 'OK' },
    } })
    expect(out.map((d) => d.position).sort()).toEqual(['LHCI', 'LHF2', 'RHF1', 'RHF2'])
    // the one word that means nothing is wrong must never be flagged
    expect(out.some((d) => /good|ok/i.test(d.condition))).toBe(false)
  })

  it('parses a JSON string and returns [] on garbage', () => {
    expect(damagedPositions({ tyre_conditions: '[{"position":"LHF1","condition":"Damage"}]' }))
      .toEqual([{ position: 'LHF1', condition: 'Damage' }])
    expect(damagedPositions({ tyre_conditions: 'not json' })).toEqual([])
    expect(damagedPositions({ tyre_conditions: 42 })).toEqual([])
    expect(damagedPositions(null)).toEqual([])
    expect(damagedPositions({})).toEqual([])
  })
})

describe('inspectionOverview', () => {
  const flagMap = buildAssetFlagMap([overdueRow('TM100'), dueSoonRow('TM100'), dueSoonRow('TM200'), overdueRow('TM900')])
  const inspections = [
    { asset_no: 'TM100', scheduled_date: '2026-08-01', approval_status: 'approved', tyre_conditions: [{ position: 'LHF1', condition: 'Damage' }] },
    { asset_no: 'TM100', scheduled_date: '2026-08-05', approval_status: 'pending_approval', tyre_conditions: {} },
    { asset_no: 'TM200', scheduled_date: '2026-08-03', approval_status: null, tyre_conditions: { RHF1: 'Puncture' } },
    { asset_no: 'TM300', scheduled_date: '2026-07-01', approval_status: 'approved', tyre_conditions: null },
  ]

  it('counts inspections, distinct vehicles and approval states', () => {
    const o = inspectionOverview(inspections, flagMap)
    expect(o.inspectionsDone).toBe(4)
    expect(o.vehiclesInspected).toBe(3) // TM100 counted once
    expect(o.approved).toBe(2)
    expect(o.pendingApproval).toBe(1)
  })

  it('counts flagged tyres only for INSPECTED vehicles (TM900 never inspected)', () => {
    const o = inspectionOverview(inspections, flagMap)
    expect(o.vehiclesWithTyresDue).toBe(2) // TM100 + TM200
    expect(o.tyresOverdue).toBe(1) // TM900 overdue tyre excluded
    expect(o.tyresDueSoon).toBe(2)
  })

  it('counts DISTINCT damaged tyres, not damage observations', () => {
    const o = inspectionOverview(inspections, flagMap)
    expect(o.damagedFound).toBe(2)
    expect(o.damagedObservations).toBe(2)
  })

  it('does not count the same damaged tyre twice when a vehicle is re-inspected', () => {
    // The card this feeds counts per-VEHICLE flags in its other three tiles, so
    // summing per-INSPECTION observations beside them double-counts every
    // re-inspected vehicle. Measured live: 17 inspections covering 15 vehicles.
    const twice = [
      { asset_no: 'TM100', scheduled_date: '2026-08-01', tyre_conditions: { LHF1: 'Damaged', RHF1: 'Puncture' } },
      { asset_no: 'TM100', scheduled_date: '2026-08-05', tyre_conditions: { LHF1: 'Damaged', RHF1: 'Puncture' } },
    ]
    const o = inspectionOverview(twice, {})
    expect(o.inspectionsDone).toBe(2)
    expect(o.vehiclesInspected).toBe(1)
    expect(o.damagedFound).toBe(2)          // two real tyres
    expect(o.damagedObservations).toBe(4)   // each reported twice
  })

  it('keeps the SAME position on DIFFERENT vehicles apart', () => {
    const o = inspectionOverview([
      { asset_no: 'TM100', scheduled_date: '2026-08-01', tyre_conditions: { LHF1: 'Damaged' } },
      { asset_no: 'TM200', scheduled_date: '2026-08-01', tyre_conditions: { LHF1: 'Damaged' } },
    ], {})
    expect(o.damagedFound).toBe(2)
  })

  it('never merges two UNPOSITIONED observations into one phantom tyre', () => {
    // A blank position cannot be deduplicated against anything, so each stands
    // alone. Merging them would UNDER-report real damage.
    const o = inspectionOverview([
      { asset_no: 'TM100', scheduled_date: '2026-08-01',
        tyre_conditions: [{ position: '', condition: 'Damaged' }, { position: '', condition: 'Puncture' }] },
    ], {})
    expect(o.damagedFound).toBe(2)
    expect(o.damagedWithoutPosition).toBe(2)
  })

  it('respects the from/to window (string prefix compare)', () => {
    const o = inspectionOverview(inspections, flagMap, { from: '2026-08-01', to: '2026-08-04' })
    expect(o.inspectionsDone).toBe(2)
    expect(o.vehiclesInspected).toBe(2)
    expect(o.vehiclesWithTyresDue).toBe(2)
    // TM300 (July) out of window; its approved mark drops too
    expect(o.approved).toBe(1)
  })

  it('excludes rows with no usable date while a window is active', () => {
    const o = inspectionOverview([{ asset_no: 'X' }], {}, { from: '2026-01-01' })
    expect(o.inspectionsDone).toBe(0)
  })

  it('returns honest zeros on empty input or missing flag map', () => {
    expect(inspectionOverview([], {})).toEqual({
      inspectionsDone: 0, vehiclesInspected: 0, approved: 0, pendingApproval: 0,
      vehiclesWithTyresDue: 0, tyresOverdue: 0, tyresDueSoon: 0, damagedFound: 0,
      damagedObservations: 0, damagedWithoutPosition: 0,
    })
    const o = inspectionOverview(inspections, null)
    expect(o.vehiclesWithTyresDue).toBe(0)
    expect(o.inspectionsDone).toBe(4)
  })
})


describe('conditionCounts', () => {
  it('buckets good/wear/damage and tolerates object shape', () => {
    const c = conditionCounts({ tyre_conditions: { LHF1: 'Good', RHF1: 'Wear', LHRI: { condition: 'Damage' }, RHRI: 'Puncture' } })
    expect(c).toEqual({ good: 1, wear: 1, damage: 2, other: 0 })
  })
  it('returns zeros on garbage', () => {
    expect(conditionCounts({ tyre_conditions: 'not json' })).toEqual({ good: 0, wear: 0, damage: 0, other: 0 })
    expect(conditionCounts(null)).toEqual({ good: 0, wear: 0, damage: 0, other: 0 })
  })
})

describe('siteSummary', () => {
  const fm = { TM1: { overdue: [{}, {}], dueSoon: [{}], count: 3 } }
  const insp = [
    { asset_no: 'TM1', site: 'NHC', inspection_date: '2026-08-01', tyre_conditions: { A: 'Good', B: 'Damage' } },
    { asset_no: 'TM2', site: 'NHC', inspection_date: '2026-08-02', tyre_conditions: { A: 'Wear' } },
    { asset_no: 'TM3', site: 'JED', inspection_date: '2026-07-01', tyre_conditions: { A: 'Good' } },
  ]
  it('groups per site with vehicles, findings and flagged tyres + totals', () => {
    const { rows, totals } = siteSummary(insp, fm, {})
    const nhc = rows.find((r) => r.site === 'NHC')
    expect(nhc).toEqual({ site: 'NHC', inspections: 2, vehicles: 2, good: 1, wear: 1, damage: 1, tyresDue: 3 })
    expect(totals.inspections).toBe(3)
    expect(totals.tyresDue).toBe(3)
  })
  it('honours the date window and site filter', () => {
    const aug = siteSummary(insp, fm, { from: '2026-08-01', to: '2026-08-31' })
    expect(aug.rows.map((r) => r.site)).toEqual(['NHC'])
    const jed = siteSummary(insp, fm, { site: 'JED' })
    expect(jed.rows).toHaveLength(1)
    expect(jed.rows[0].tyresDue).toBe(0)
  })
  it('is honest with an empty flag map', () => {
    const { totals } = siteSummary(insp, {}, {})
    expect(totals.tyresDue).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Multi-select filters. A selection may be 'all', one value, or an array.
// ─────────────────────────────────────────────────────────────────────────────
describe('multi-select filter selections', () => {
  const rows = [
    { asset_no: 'A1', site: 'NHC',     vehicle_type: 'TR-MIXER', inspector: 'Ali',  inspection_date: '2026-08-01' },
    { asset_no: 'A2', site: 'DIRIYAH', vehicle_type: 'PUMPS',    inspector: 'Omar', inspection_date: '2026-08-02' },
    { asset_no: 'A3', site: 'JED',     vehicle_type: 'PICKUP',   inspector: 'Ali',  inspection_date: '2026-08-03' },
    { asset_no: 'A4', site: 'NHC',     vehicle_type: '',         inspector: 'Sara', inspection_date: '2026-08-04' },
  ]

  it('a single value still works, unchanged', () => {
    expect(scopeInspections(rows, { site: 'NHC' })).toHaveLength(2)
    expect(scopeInspections(rows, { vehicleType: 'TR-MIXER' })).toHaveLength(1)
  })

  it('an array selects the UNION of the chosen values', () => {
    expect(scopeInspections(rows, { site: ['NHC', 'JED'] })).toHaveLength(3)
    expect(scopeInspections(rows, { vehicleType: ['TR-MIXER', 'PUMPS'] })).toHaveLength(2)
  })

  it('an EMPTY array means no filter, never "match nothing"', () => {
    // A panel that empties the table when the last chip is unticked reads as lost
    // data, and there is no way back except knowing to re-tick something.
    expect(scopeInspections(rows, { site: [] })).toHaveLength(4)
    expect(scopeInspections(rows, { vehicleType: [], region: [] })).toHaveLength(4)
  })

  it('folds case on vehicle type, on both sides', () => {
    expect(scopeInspections(rows, { vehicleType: ['tr-mixer'] })).toHaveLength(1)
  })

  it('excludes a row whose value is MISSING while a selection is active', () => {
    // A4 has no vehicle_type: it is not KNOWN to be a mixer, so it is not one.
    expect(scopeInspections(rows, { vehicleType: ['TR-MIXER', 'PUMPS', 'PICKUP'] })).toHaveLength(3)
  })

  it('combines two multi-selects as AND across fields, OR within a field', () => {
    const out = scopeInspections(rows, { site: ['NHC', 'JED'], inspector: ['Ali'] })
    expect(out.map(r => r.asset_no)).toEqual(['A1', 'A3'])
  })

  it('region multi-select goes through the injected resolver', () => {
    const regionOf = (s) => ({ NHC: 'CENTRAL', DIRIYAH: 'CENTRAL', JED: 'WESTERN' }[s] || '')
    expect(scopeInspections(rows, { region: ['WESTERN'] }, { regionOf })).toHaveLength(1)
    // All four rows resolve: A1/A4 NHC and A2 DIRIYAH are CENTRAL, A3 JED is WESTERN.
    expect(scopeInspections(rows, { region: ['CENTRAL', 'WESTERN'] }, { regionOf })).toHaveLength(4)
    // A site the register cannot place is excluded rather than swept into
    // whichever region happened to be picked.
    expect(scopeInspections(rows, { region: ['CENTRAL'] }, { regionOf: () => '' })).toHaveLength(0)
  })

  it('isSelectionActive tells a real selection from an empty one', () => {
    expect(isSelectionActive('all')).toBe(false)
    expect(isSelectionActive([])).toBe(false)
    expect(isSelectionActive(['all'])).toBe(false)
    expect(isSelectionActive('NHC')).toBe(true)
    expect(isSelectionActive(['NHC'])).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The SHARE SUMMARY must be scoped by the same rule as the register.
// It used to accept only from/to/site, while the modal was handed EVERY row - so
// a reader who narrowed to a region and a vehicle type and pressed Share got a
// summary of the whole country, with nothing on the sheet saying so.
// ─────────────────────────────────────────────────────────────────────────────
describe('siteSummary scoping', () => {
  const regionOf = (s) => ({ NHC: 'CENTRAL', DIRIYAH: 'CENTRAL', JED: 'WESTERN' }[s] || '')
  const rows = [
    { asset_no: 'A1', site: 'NHC',     vehicle_type: 'TR-MIXER', inspector: 'Ali',  scheduled_date: '2026-08-01', tyre_conditions: { LHF1: 'Good' } },
    { asset_no: 'A2', site: 'DIRIYAH', vehicle_type: 'PUMPS',    inspector: 'Omar', scheduled_date: '2026-08-02', tyre_conditions: { LHF1: 'Damaged' } },
    { asset_no: 'A3', site: 'JED',     vehicle_type: 'TR-MIXER', inspector: 'Ali',  scheduled_date: '2026-08-03', tyre_conditions: { LHF1: 'Worn' } },
  ]

  it('with no filters it covers every site', () => {
    const s = siteSummary(rows, {}, {}, { regionOf })
    expect(s.rows.map(r => r.site).sort()).toEqual(['DIRIYAH', 'JED', 'NHC'])
    expect(s.totals.inspections).toBe(3)
  })

  it('narrows by REGION, which it could not do before', () => {
    const s = siteSummary(rows, {}, { region: ['WESTERN'] }, { regionOf })
    expect(s.rows.map(r => r.site)).toEqual(['JED'])
    expect(s.totals.inspections).toBe(1)
  })

  it('narrows by VEHICLE TYPE, which it could not do before', () => {
    const s = siteSummary(rows, {}, { vehicleType: ['TR-MIXER'] }, { regionOf })
    expect(s.totals.inspections).toBe(2)
    expect(s.rows.map(r => r.site).sort()).toEqual(['JED', 'NHC'])
  })

  it('takes a MULTI-value site selection', () => {
    const s = siteSummary(rows, {}, { site: ['NHC', 'JED'] }, { regionOf })
    expect(s.totals.inspections).toBe(2)
  })

  it('still accepts a single site string, so old callers are unchanged', () => {
    const s = siteSummary(rows, {}, { site: 'NHC' }, { regionOf })
    expect(s.rows.map(r => r.site)).toEqual(['NHC'])
  })

  it('combines region and vehicle type as AND', () => {
    const s = siteSummary(rows, {}, { region: ['CENTRAL'], vehicleType: ['TR-MIXER'] }, { regionOf })
    expect(s.rows.map(r => r.site)).toEqual(['NHC'])
  })

  it('KEEPS its own date rule, which also reads inspection_date', () => {
    // The register's window reads scheduled -> completed -> created only. That
    // difference is deliberate and documented, so a row carrying ONLY
    // inspection_date must still fall inside the summary window.
    const only = [{ asset_no: 'B1', site: 'NHC', inspection_date: '2026-08-02', tyre_conditions: {} }]
    expect(siteSummary(only, {}, { from: '2026-08-01', to: '2026-08-03' }, { regionOf }).totals.inspections).toBe(1)
    expect(siteSummary(only, {}, { from: '2026-09-01' }, { regionOf }).totals.inspections).toBe(0)
  })
})

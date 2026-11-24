import { describe, it, expect } from 'vitest'
import {
  calibrationState, calibrationWatchList, validateCalibration, validateToolIssue,
  validateDispense, consumptionByAsset, qtyByUnitText,
  allowedUnitEvents, validateUnitEvent,
  scrapNextAction, recoverySummary, currencyForCountry,
  validateLocationClass, locationFindings,
} from '../lib/warehouseClasses/specialClasses'
import { LOCATION_TYPES, NON_AVAILABLE_TYPES } from '../lib/inventory/locationTree'

const NOW = Date.UTC(2026, 10, 24, 10)
const all = () => true

describe('calibration', () => {
  it('missing date is not set, never overdue', () => {
    expect(calibrationState({}, NOW).state).toBe('not_set')
  })
  it('overdue, due soon and ok', () => {
    expect(calibrationState({ calibration_due: '2026-11-20' }, NOW)).toEqual({ state: 'overdue', days: 4 })
    expect(calibrationState({ calibration_due: '2026-12-10' }, NOW).state).toBe('due_soon')
    expect(calibrationState({ calibration_due: '2027-06-01' }, NOW).state).toBe('ok')
  })
  it('watch list puts the most overdue first and skips retired tools', () => {
    const list = calibrationWatchList([
      { id: 1, calibration_due: '2026-11-22' }, { id: 2, calibration_due: '2026-10-01' },
      { id: 3, calibration_due: '2026-12-01' }, { id: 4, calibration_due: '2026-01-01', status: 'retired' },
    ], NOW)
    expect(list.map((t) => t.id)).toEqual([2, 1, 3])
  })
  it('validates a calibration record', () => {
    expect(validateCalibration({ calibrated_on: '2026-11-24', result: 'pass', next_due: '2026-11-20' }, NOW).error).toBeTruthy()
    expect(validateCalibration({ calibrated_on: '2026-11-24', result: 'fail' }, NOW).error).toBeNull()
    expect(validateCalibration({ calibrated_on: '2026-12-01', result: 'pass', next_due: '2027-01-01' }, NOW).error).toBeTruthy()
  })
  it('a tool issue needs a holder and a future due date', () => {
    expect(validateToolIssue({}, NOW).error).toBeTruthy()
    expect(validateToolIssue({ holder_name: 'Ali', due_back_at: '2026-11-01' }, NOW).error).toBeTruthy()
    expect(validateToolIssue({ holder_user_id: 'u1' }, NOW).error).toBeNull()
  })
})

describe('lubricants', () => {
  const line = { id: 's1', qty_on_hand: 10, qty_reserved: 2 }
  it('refuses more than the free quantity and requires an asset', () => {
    expect(validateDispense(line, { qty: 9, asset_no: 'TM1' }).error).toMatch(/8/)
    expect(validateDispense(line, { qty: 2 }).error).toMatch(/asset/)
    expect(validateDispense(line, { qty: 2, asset_no: 'TM1', meter_reading: 5, meter_type: '' }).error).toBeTruthy()
    expect(validateDispense(line, { qty: 2, asset_no: 'TM1' }).error).toBeNull()
  })
  it('groups per asset, keeps units apart and never prices an unknown cost', () => {
    const rows = consumptionByAsset([
      { source: 'app', asset_no: 'tm1', uom: 'L', qty: 4, value: 40, currency: 'SAR', lines: 1, month: '2026-10-01' },
      { source: 'erp', asset_no: 'TM1', uom: null, qty: 2, value: null, currency: 'SAR', lines: 3, month: '2026-11-01' },
      { source: 'erp', asset_no: 'TM1', uom: 'L', qty: 1, value: 5, currency: 'AED', lines: 1 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].app.qty).toEqual({ L: 4 })
    expect(rows[0].erp.qty).toEqual({ UNIT: 2, L: 1 })
    expect(rows[0].value).toEqual({ SAR: 40, AED: 5 })
    expect(rows[0].unvaluedLines).toBe(3)
    expect(rows[0].lastMonth).toBe('2026-11-01')
    expect(qtyByUnitText({})).toBe('None')
  })
})

describe('serialised units', () => {
  it('offers return only when at a vendor and send only when in store', () => {
    expect(allowedUnitEvents({ unit_state: 'at_vendor' }, all).map((e) => e.value)).toContain('returned_from_repair')
    expect(allowedUnitEvents({ unit_state: 'at_vendor' }, all).map((e) => e.value)).not.toContain('installed_on_asset')
    expect(allowedUnitEvents({ unit_state: 'installed' }, all).map((e) => e.value)).not.toContain('sent_for_repair')
    expect(allowedUnitEvents({ unit_state: 'in_store' }, (c) => c === 'issue').map((e) => e.value)).toEqual(['installed_on_asset'])
  })
  it('validates required fields per event', () => {
    expect(validateUnitEvent({ item_id: 'i', serial: 'S', event_type: 'sent_for_repair' }).error).toMatch(/vendor/)
    expect(validateUnitEvent({ item_id: 'i', serial: 'S', event_type: 'installed_on_asset' }).error).toMatch(/asset/)
    expect(validateUnitEvent({ item_id: 'i', serial: 'S', event_type: 'returned_from_repair' }).error).toBeNull()
  })
})

describe('scrap requests', () => {
  const req = (status, proposed_by = 'a') => ({ status, proposed_by })
  it('never lets the proposer evaluate, approve or post', () => {
    expect(scrapNextAction(req('proposed'), 'a', all)).toBe('cancel')
    expect(scrapNextAction(req('proposed'), 'b', all)).toBe('evaluate')
    expect(scrapNextAction(req('evaluated'), 'a', all)).toBeNull()
    expect(scrapNextAction(req('approved'), 'a', all)).toBeNull()
    expect(scrapNextAction(req('approved'), 'b', all)).toBe('post')
    expect(scrapNextAction(req('posted'), 'a', (c) => c === 'financial_post')).toBe('dispose')
  })
  it('recovery per currency, unknown counted not zeroed', () => {
    const s = recoverySummary([
      { status: 'disposed', recovery_value: 10, recovery_currency: 'SAR' },
      { status: 'disposed', recovery_value: null },
      { status: 'posted', recovery_value: 99, recovery_currency: 'SAR' },
    ])
    expect(s).toEqual({ totals: { SAR: 10 }, unknown: 1 })
    expect(currencyForCountry('Egypt')).toBe('EGP')
  })
})

describe('locations', () => {
  it('knows the new location types; receiving and inspection are not available stock', () => {
    for (const t of ['receiving', 'inspection', 'service_van', 'workshop_store', 'bulk_tank']) expect(LOCATION_TYPES).toContain(t)
    expect(NON_AVAILABLE_TYPES.has('receiving')).toBe(true)
    expect(NON_AVAILABLE_TYPES.has('bulk_tank')).toBe(false)
  })
  it('validates capacity, unit and van', () => {
    expect(validateLocationClass({ capacity_qty: 10 }).errors.capacity_uom).toBeTruthy()
    expect(validateLocationClass({ capacity_qty: -1 }).errors.capacity_qty).toBeTruthy()
    expect(validateLocationClass({ location_type: 'service_van' }).errors.van_asset_no).toBeTruthy()
    expect(validateLocationClass({ location_type: 'bin', van_asset_no: 'TM1' }).errors.van_asset_no).toBeTruthy()
    expect(validateLocationClass({ location_type: 'bin', capacity_qty: '', capacity_uom: '' }).ok).toBe(true)
  })
  it('reports over capacity, rule breaches and mixing', () => {
    const f = locationFindings({ pct_used: 120, restriction: 'tyres_only', restriction_breaches: 2, mixing_breach: true })
    expect(f.map((x) => x.tone)).toEqual(['bad', 'bad', 'bad'])
    expect(locationFindings({ pct_used: null })).toEqual([])
  })
})

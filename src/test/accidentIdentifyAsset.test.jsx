import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

// M7 "Identify asset" on the web incident form. The page is 3,700 lines and
// wires a dozen services, so the contract is pinned through the PURE helpers
// and the two isolated components Accidents.jsx exports, plus the service
// column list the fleet-master card depends on.

// One hoisted, chainable, thenable Supabase mock shared by assets.js (the
// getAssetByNo column pin) and by Accidents.jsx's module-level import.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], order: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(c) { calls.order.push(c); return b },
      limit() { return b },
      range() { return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or() { return b },
      not() { return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc: () => Promise.resolve({ data: [], error: null }), channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {} } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const assets = await import('../lib/api/assets')
const {
  matchFleetAssets, applyAssetToForm, autoFilledRows, meterLabel, assetStatusLabel, assetPlate,
  wizardStepLabel, FLEET_MASTER_LOCK_NOTE, AutoFilledFromFleetMaster, AssetLoadedCard,
} = await import('../pages/Accidents')
const { REPORT_WIZARD_STEPS } = await import('../lib/accidentCaseVocab')

const FLEET = [
  { asset_no: 'CP-045', vehicle_type: 'CONCRETE PUMP', site: 'NHC', country: 'KSA', registration_no: '4205 SXA', fleet_number: null },
  { asset_no: 'TM-514', vehicle_type: 'TR-MIXER', site: 'DIRIYAH-G1', country: 'KSA', registration_no: null, fleet_number: 'F-514' },
  { asset_no: 'BH-018', vehicle_type: 'BACKHOE', site: 'NHC', country: 'KSA', registration_no: '2041 XXB', fleet_number: null },
]
const MASTER = {
  asset_no: 'CP-045', vehicle_type: 'CONCRETE PUMP', site: 'NHC', country: 'KSA', registration_no: '4205 SXA',
  fleet_number: null, make: 'SANY', model: 'SYG5418THB', current_km: 48210, ops_status: 'running', status: 'Active',
}

beforeEach(() => { h.state.result = { data: [], error: null }; h.state.last = null })

describe('step vocabulary', () => {
  it('prints "Step N of 7: Label" from REPORT_WIZARD_STEPS and nothing for an unknown key', () => {
    expect(wizardStepLabel('identify_asset')).toBe('Step 1 of 7: Identify asset')
    expect(wizardStepLabel('review')).toBe(`Step 7 of ${REPORT_WIZARD_STEPS.length}: Review and submit`)
    expect(wizardStepLabel('nope')).toBe('')
  })
})

describe('matching count', () => {
  it('matches on asset no, vehicle type, site, plate and fleet number, case-insensitively', () => {
    expect(matchFleetAssets(FLEET, 'nhc')).toHaveLength(2)
    expect(matchFleetAssets(FLEET, 'cp-0')).toHaveLength(1)
    expect(matchFleetAssets(FLEET, 'mixer')).toHaveLength(1)
    expect(matchFleetAssets(FLEET, '2041')).toHaveLength(1)       // plate
    expect(matchFleetAssets(FLEET, 'f-514')).toHaveLength(1)      // fleet number
    expect(matchFleetAssets(FLEET, 'zzz')).toHaveLength(0)
    expect(matchFleetAssets(FLEET, '   ')).toHaveLength(0)        // blank query -> no list, not the whole fleet
  })
})

describe('applyAssetToForm - the incident site is the user\'s, the vehicle facts are the asset\'s', () => {
  const form = { asset_no: 'CP-045', plate_number: '', vehicle_type: '', site: '', country: '', location: '' }

  it('defaults plate, type, site and country from the asset when nothing was chosen yet', () => {
    const next = applyAssetToForm(form, MASTER, { siteTouched: false })
    expect(next).toMatchObject({ plate_number: '4205 SXA', vehicle_type: 'CONCRETE PUMP', site: 'NHC', country: 'KSA' })
  })

  it('NEVER overwrites the incident site once the user has chosen it, while plate/type still follow the asset', () => {
    const chosen = { ...form, site: 'RIY-MET' }
    const next = applyAssetToForm(chosen, MASTER, { siteTouched: true })
    expect(next.site).toBe('RIY-MET')
    expect(next.plate_number).toBe('4205 SXA')
    expect(next.vehicle_type).toBe('CONCRETE PUMP')
    // Re-resolving to a different asset (home site DIRIYAH-G1) still leaves it alone.
    const again = applyAssetToForm(next, FLEET[1], { siteTouched: true })
    expect(again.site).toBe('RIY-MET')
    expect(again.plate_number).toBe('F-514')
  })

  it('keeps an existing value when the master record is partial, and is a no-op for a null asset', () => {
    const filled = { ...form, plate_number: 'KEEP', vehicle_type: 'KEEP' }
    expect(applyAssetToForm(filled, { asset_no: 'X' })).toMatchObject({ plate_number: 'KEEP', vehicle_type: 'KEEP' })
    expect(applyAssetToForm(filled, null)).toBe(filled)
  })

  it('plate precedence is unchanged from the legacy form: fleet_number, else registration_no', () => {
    expect(assetPlate(FLEET[1])).toBe('F-514')
    expect(assetPlate(FLEET[0])).toBe('4205 SXA')
    expect(assetPlate({})).toBe('')
  })
})

describe('honest labels', () => {
  it('meter: a null is "Not recorded", never 0 km', () => {
    expect(meterLabel(null)).toBe('Not recorded')
    expect(meterLabel('')).toBe('Not recorded')
    expect(meterLabel(0)).toBe('0 km')
    expect(meterLabel(48210)).toBe('48,210 km')
  })
  it('status: ops_status first, then register status, then Not set', () => {
    expect(assetStatusLabel({ ops_status: 'planned_scrap', status: 'Active' })).toBe('planned scrap')
    expect(assetStatusLabel({ status: 'Inactive' })).toBe('Inactive')
    expect(assetStatusLabel({})).toBe('Not set')
  })
  it('autoFilledRows fills every mock field and reads blanks as Not set / Not recorded', () => {
    const rows = autoFilledRows({ asset_no: 'CP-045' }, { asset_no: 'CP-045', plate_number: '', vehicle_type: '' })
    expect(rows.map((r) => r.label)).toEqual(['Asset no', 'Plate / Fleet no', 'Make / model', 'Vehicle type', 'Site (home)', 'Current meter', 'Status'])
    expect(rows.find((r) => r.key === 'current_km').display).toBe('Not recorded')
    expect(rows.find((r) => r.key === 'plate').display).toBe('Not set')
  })
})

describe('AutoFilledFromFleetMaster - read-only, lock-marked', () => {
  it('renders every field as a read-only input with the fleet-master note', () => {
    render(<AutoFilledFromFleetMaster asset={MASTER} form={{ asset_no: 'CP-045', plate_number: '4205 SXA', vehicle_type: 'CONCRETE PUMP' }} />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(7)
    for (const input of inputs) {
      expect(input).toHaveAttribute('readonly')
      expect(input).toHaveAttribute('aria-readonly', 'true')
    }
    expect(screen.getByDisplayValue('4205 SXA')).toBeInTheDocument()
    expect(screen.getByDisplayValue('SANY SYG5418THB')).toBeInTheDocument()
    expect(screen.getByDisplayValue('48,210 km')).toBeInTheDocument()
    expect(screen.getByDisplayValue('running')).toBeInTheDocument()
    expect(screen.getByText(FLEET_MASTER_LOCK_NOTE)).toBeInTheDocument()
    expect(FLEET_MASTER_LOCK_NOTE).toMatch(/cannot be edited here/)
  })
})

describe('AssetLoadedCard', () => {
  it('shows the mock card rows and a Change asset action; a null meter reads Not recorded', () => {
    const onChange = vi.fn()
    const { container } = render(<AssetLoadedCard asset={{ ...MASTER, current_km: null }} onChange={onChange} />)
    expect(screen.getByText('Asset loaded from fleet master')).toBeInTheDocument()
    // Scope to the card's own summary list - the full VehicleMasterCard sits
    // underneath (collapsed) and repeats labels like Country.
    const summary = within(container.querySelector('dl'))
    for (const label of ['Asset no', 'Vehicle type', 'Plate', 'Make / model', 'Site (home)', 'Country', 'Current meter', 'Status']) {
      expect(summary.getByText(label)).toBeInTheDocument()
    }
    expect(summary.getByText('Not recorded')).toBeInTheDocument()
    screen.getByRole('button', { name: /Change asset/i }).click()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('assets.getAssetByNo - the fleet-master card column contract', () => {
  it('selects make, model, current_km, ops_status, status and registration_no (additive COLS)', async () => {
    h.state.result = { data: [MASTER], error: null }
    const row = await assets.getAssetByNo('CP-045', 'KSA')
    expect(h.state.last._table).toBe('vehicle_fleet')
    for (const col of ['make', 'model', 'current_km', 'ops_status', 'status', 'registration_no', 'site', 'country']) {
      expect(h.state.last._calls.select.split(',')).toContain(col)
    }
    expect(row).toMatchObject({ asset_no: 'CP-045', make: 'SANY', current_km: 48210 })
  })

  it('never substitutes the same code from another country', async () => {
    h.state.result = { data: [{ ...MASTER, country: 'UAE' }], error: null }
    expect(await assets.getAssetByNo('CP-045', 'KSA')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// Real lucide-react renders fine in jsdom; no need to mock it.
// Mock the fleetCpk + exportUtils so the panels render without I/O.
const h = vi.hoisted(() => ({
  km: { ok: false }, hours: { ok: false }, audit: { ok: false },
}))
vi.mock('../lib/api/fleetCpk', () => ({
  getCpkKmSource: () => Promise.resolve(h.km),
  getCpkHoursSource: () => Promise.resolve(h.hours),
  getCpkUnitAudit: () => Promise.resolve(h.audit),
}))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: () => {}, exportToPdf: () => {},
  reportFileName: (...p) => p.join(' '), reportDateLabel: () => '01 Jan 2026',
}))

import KmSourcePanel from '../components/cpk/KmSourcePanel'
import CpkUnitAuditPanel from '../components/cpk/CpkUnitAuditPanel'
import CpkReportPanel from '../components/cpk/CpkReportPanel'

const PV = [
  { asset_no: 'TM634', vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 187080, tyre_cost: 1000, maintenance_cost: 500, total_cost: 1500, cpk_tyre: 0.005, cpk_total: 0.008 },
  { asset_no: 'GN103', vehicle_type: 'GENERATOR', unit: 'engine_hours', distance_or_hours: 0, tyre_cost: 0, maintenance_cost: 200, total_cost: 200, cpk_tyre: null, cpk_total: null },
]
const BT = [{ vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 187080, tyre_cost: 1000, maintenance_cost: 500, total_cost: 1500, cpk_tyre: 0.005, cpk_total: 0.008 }]
const FLEET = [{ country: 'KSA', currency: 'SAR', cpk_tyre: 0.005, cpk_total: 0.008, coverage_pct: 68, unregistered_cost: 0 }]

beforeEach(() => { cleanup(); h.km = { ok: false }; h.hours = { ok: false }; h.audit = { ok: false } })

describe('CPK panels render without crashing (empty + populated)', () => {
  const props = { country: 'KSA', from: '2026-01-01', to: '2026-01-31', currency: 'SAR' }

  it('KmSourcePanel mounts on the degrade path', () => {
    expect(() => render(<KmSourcePanel {...props} />)).not.toThrow()
  })

  it('CpkUnitAuditPanel mounts on the degrade path', () => {
    expect(() => render(<CpkUnitAuditPanel {...props} />)).not.toThrow()
  })

  it('CpkUnitAuditPanel mounts with populated audit data', () => {
    h.audit = { ok: true, note: 'x', summary: { assets: 2, movable: 1, non_movable: 1, both_present: 1, off_unit_only: 0, used_unit_no_data: 1 }, assets: [
      { asset_no: 'TM634', vehicle_type: 'TR-MIXER', unit: 'km', side: 'movable', km: 187080, hours: 1200, has_km: true, has_hours: true, status: 'both_present' },
      { asset_no: 'GN103', vehicle_type: 'GENERATOR', unit: 'engine_hours', side: 'non_movable', km: null, hours: null, has_km: false, has_hours: false, status: 'used_unit_no_data' },
    ] }
    expect(() => render(<CpkUnitAuditPanel {...props} />)).not.toThrow()
  })

  it('CpkReportPanel mounts and builds a report from loaded rows', () => {
    expect(() => render(<CpkReportPanel {...props} perVehicle={PV} byType={BT} fleet={FLEET} />)).not.toThrow()
  })

  it('CpkReportPanel mounts with empty data', () => {
    expect(() => render(<CpkReportPanel {...props} perVehicle={[]} byType={[]} fleet={[]} />)).not.toThrow()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

// Real lucide-react renders fine in jsdom; mock only the fleetCpk service so the
// panel renders without I/O. exportUtils is real (only called on a button press).
const h = vi.hoisted(() => ({ intel: { ok: false } }))
vi.mock('../lib/api/fleetCpk', () => ({
  getCpkKmIntelligence: () => Promise.resolve(h.intel),
}))

import CpkKmIntelligencePanel from '../components/cpk/CpkKmIntelligencePanel'

const props = { country: 'KSA', from: '2026-01-01', to: '2026-12-31', currency: 'SAR' }

const POPULATED = {
  ok: true,
  country: 'KSA',
  from: '2026-01-01',
  to: '2026-12-31',
  summary: {
    assets: 718, tyre_km_assets: 353, odo_km_assets: 715, both: 353,
    tyre_only: 3, odo_only: 362, tyre_km_total: 167457434, odo_km_total: 66076730,
    eng_hours_total: 12000, meter_hours_total: 0, odo_high_conf: 451,
    note: 'The odometer adds 362 assets that tyre-km misses.',
  },
  per_asset: [
    {
      asset_no: 'TM634', vehicle_type: 'TR-MIXER', unit: 'km',
      tyre_km: 187080, odo_km: 190400, eng_hours: null, meter_hours: null,
      odo_readings: 24, odo_resets: 0, odo_months: 12, odo_confidence: 'high',
      coverage: 'both', odo_vs_tyre_pct: 102,
    },
    {
      asset_no: 'MP081', vehicle_type: 'MIXER', unit: 'km',
      tyre_km: null, odo_km: 44000, eng_hours: null, meter_hours: null,
      odo_readings: 6, odo_resets: 1, odo_months: 5, odo_confidence: 'medium',
      coverage: 'odo_only', odo_vs_tyre_pct: null,
    },
  ],
}

beforeEach(() => { cleanup(); h.intel = { ok: false } })

describe('CpkKmIntelligencePanel', () => {
  it('renders an empty/unavailable state without throwing on the degrade path', async () => {
    h.intel = { ok: false }
    expect(() => render(<CpkKmIntelligencePanel {...props} />)).not.toThrow()
    // banner text is always present
    await waitFor(() => expect(screen.getByText(/Km measured two ways/i)).toBeTruthy())
    // honest empty state after the async load settles
    await waitFor(() => expect(screen.getByText(/No assets with a km source/i)).toBeTruthy())
  })

  it('renders populated data without throwing and shows a summary number and an asset row', async () => {
    h.intel = POPULATED
    expect(() => render(<CpkKmIntelligencePanel {...props} />)).not.toThrow()
    // a summary tile figure (Total odometer-km 66,076,730)
    await waitFor(() => expect(screen.getByText('66,076,730')).toBeTruthy())
    // an asset row
    await waitFor(() => expect(screen.getByText('TM634')).toBeTruthy())
    expect(screen.getByText('MP081')).toBeTruthy()
  })
})

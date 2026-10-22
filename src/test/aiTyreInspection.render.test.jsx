import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// Real page + real engine; only data sources, contexts and photo signing are mocked.
const api = vi.hoisted(() => ({
  list: vi.fn(), jobs: vi.fn(), measurements: vi.fn(), signed: vi.fn(),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k, d) => d || k, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Manager' } }) }))
vi.mock('../lib/api/inspections', () => ({ listInspectionsForAiRegister: (...a) => api.list(...a) }))
vi.mock('../lib/api/sites', () => ({ listDataSiteOptions: () => Promise.resolve(['NHC']) }))
vi.mock('../lib/api/aiTyreInspection', () => ({
  readInspectionAnalysis: (...a) => api.jobs(...a),
  readInspectionMeasurements: (...a) => api.measurements(...a),
  recordDepthMeasurement: vi.fn(), enqueueInspectionPhotos: vi.fn(), reviewAiFinding: vi.fn(),
  backfillAiInspectionRange: vi.fn(), screenInspectionPhotos: vi.fn(), getAiReviewFeedback: vi.fn(),
}))
vi.mock('../lib/photoUrlCache', () => ({ photoUrlResolver: { get: (ref) => api.signed(ref) } }))

import { MemoryRouter } from 'react-router-dom'
import AiTyreInspection from '../pages/AiTyreInspection'

const insp = (id, asset) => ({
  id, asset_no: asset, vehicle_type: 'TR-MIXER', site: 'NHC', status: 'Done', inspection_date: '2026-10-01', inspector: 'Ali',
  tyre_conditions: { R1Lo: { condition: 'Worn', photo_url: 'tp-storage://p/' + id + '.jpg' }, F1L: { condition: 'Good' } },
})
const m = (id, inspection, i, extra = {}) => ({
  id, inspection_id: inspection, tyre_position: 'R1Lo', tyre_serial: 'S1', original_mm: 16, minimum_mm: 3,
  inner_mm: null, center_mm: 12 - i, outer_mm: null, odometer_km: 10000 + i * 5000,
  measured_at: new Date(Date.parse('2026-06-01') + i * 30 * 86400000).toISOString(), source: 'manual_gauge', ...extra,
})

beforeEach(() => {
  cleanup()
  api.measurements.mockReset()
  api.list.mockResolvedValue({ data: [insp('a1', 'TM514'), insp('a2', 'TM514')], count: 2 })
  api.jobs.mockResolvedValue([])
  api.signed.mockResolvedValue('https://signed/x.jpg')
})

async function openMeasurements() {
  render(<MemoryRouter><AiTyreInspection /></MemoryRouter>)
  fireEvent.click((await screen.findAllByRole('button', { name: 'TM514' }))[0])
  fireEvent.click(await screen.findByRole('tab', { name: /Tread measurements/ }))
}

describe('AI Tyre Inspection: Measurements tab', () => {
  it('shows "Not measured" for every figure when no gauge history exists', async () => {
    api.measurements.mockResolvedValue([])
    await openMeasurements()
    expect(await screen.findByText(/Wear analysis from repeated gauge readings/)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('Not measured').length).toBeGreaterThan(4))
    expect(screen.queryByText(/mm\/1000 km/)).toBeNull()
  })

  it('shows wear rate, remaining km and a replacement answer from repeated readings', async () => {
    api.measurements.mockResolvedValue([m('m0', 'a1', 0), m('m1', 'a1', 1), m('m2', 'a2', 2), m('m3', 'a2', 3)])
    await openMeasurements()
    expect(await screen.findByText('0.2 mm/1000 km')).toBeTruthy()
    expect(screen.getAllByText(/30,000 km/).length).toBeGreaterThan(0)
    expect(screen.getByText('S1')).toBeTruthy()
    // history was requested for the vehicle's own inspections in ONE call
    expect(api.measurements).toHaveBeenCalledTimes(1)
    expect(api.measurements.mock.calls[0][0].sort()).toEqual(['a1', 'a2'])
  })

  it('lists rejected readings in a data check instead of using them', async () => {
    api.measurements.mockResolvedValue([m('m0', 'a1', 0), m('bad', 'a1', 1, { center_mm: 99 })])
    await openMeasurements()
    expect(await screen.findByText(/Data checks \(1\)/)).toBeTruthy()
  })
})

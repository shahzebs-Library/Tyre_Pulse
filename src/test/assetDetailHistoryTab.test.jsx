import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * MOUNTS the real AssetDetail page and CLICKS the new "Full history" tab.
 *
 * WHY A RENDER TEST AND NOT A UNIT TEST. This repo has twice shipped a
 * ReferenceError past a clean build - a dangling lucide icon both times - and
 * nothing caught it, because vite does no undefined analysis and a lazy-routed
 * page is never evaluated during `vite build`. `react/jsx-no-undef` catches an
 * undefined JSX element, but not a bad property access or a component that
 * throws once its effects run. Only mounting it does.
 *
 * It also guards the SEAM this test was written for: AssetFullHistory now lives
 * in src/components/asset/ and is imported by two pages. If the extraction
 * broke an import path, dropped a helper, or left the component depending on
 * chart.js elements only VehicleHistory registers, this fails.
 *
 * Contexts and services are mocked; the REAL page, the REAL AssetFullHistory
 * and the REAL pure engine all render.
 */

vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, d) => (typeof d === 'string' ? d : k), language: 'en', dir: 'ltr' }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: true }),
}))

// The fleet-row read AssetDetail does directly through supabase. Returns ONE
// KSA row, so `asset.country` resolves and the tab receives a real identity.
const FLEET_ROW = {
  id: 'f1', asset_no: 'TM514', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER',
  make: 'Sany', model: 'SY306', year: 2019, current_km: 120000, status: 'Active',
  registration_no: '1234 ABC', active: true,
}
vi.mock('../lib/supabase', () => {
  const builder = {
    select() { return this }, eq() { return this }, order() { return this },
    limit() { return Promise.resolve({ data: [FLEET_ROW], error: null }) },
  }
  return { supabase: { from: () => ({ ...builder }) } }
})

// EVERY assetApi function AssetDetail calls, by its REAL name. The loader
// builds its Promise.allSettled array by CALLING each one, so a missing name
// throws synchronously before allSettled can catch it and the page lands in its
// error state - which is exactly what a first pass of this test did.
const envelope = (data) => Promise.resolve({ data, error: null })
vi.mock('../lib/api/assetManagement', () => ({
  listAssetTyres: () => envelope([]),
  listAssetWorkOrders: () => envelope([]),
  reportAssetOverview: () => envelope([]),
  listAssetInspections: () => envelope([]),
  listAssetAccidents: () => envelope([]),
  latestOdometer: () => envelope(null),
  latestEngineHours: () => envelope(null),
  updateAsset: () => envelope({}),
}))
vi.mock('../lib/api/pmPrograms', async (orig) => ({
  ...(await orig()),
  listPmPrograms: () => Promise.resolve([]),
  listPmServiceRecords: () => Promise.resolve([]),
}))
vi.mock('../lib/api/costSummary', () => ({ loadGridTyreByAsset: () => Promise.resolve(null) }))
vi.mock('../lib/api/assetMaster', () => ({
  getAssetMaster: () => Promise.resolve({ ok: false }),
  COUNTRY_CURRENCY: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
}))
vi.mock('../lib/api/assetUtilization', () => ({ getAssetUtilization: () => Promise.resolve(null) }))
vi.mock('../lib/api/assetOwnership', () => ({ getAssetOwnershipFor: () => Promise.resolve(null) }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => null }))
vi.mock('../components/insurance/AssetInsurancePanel', () => ({ default: () => null }))

/**
 * THE READ THE NEW TAB DEPENDS ON. Every source resolves through one envelope
 * shape, so this fixture exercises the real buildTimeline / summarize /
 * downtime / meter / gaps path rather than a stub of it.
 */
const src = (rows) => ({ ok: true, rows, error: null, missing: false })
vi.mock('../lib/api/assetHistory', async (orig) => ({
  ...(await orig()),
  listAssetOptions: () => Promise.resolve({ ok: true, rows: [], truncated: false }),
  loadAssetHistory: () => Promise.resolve({
    asset: 'TM514',
    country: 'KSA',
    fleet: FLEET_ROW,
    fleetRows: [FLEET_ROW, { ...FLEET_ROW, id: 'f2', country: 'UAE', make: 'CATERPILLAR' }],
    fleetReadable: true,
    crossCountry: true,
    truncated: [],
    sources: {
      job_card: src([{
        id: 'c1', work_order_no: 'JC-1', rfr_no: 'RFR-9', asset_no: 'TM514', country: 'KSA',
        opened_at: '2026-03-02T08:00:00Z', production_out_at: '2026-03-01T00:00:00Z',
        started_at: '2026-03-02T00:00:00Z', completed_at: '2026-03-03T00:00:00Z',
        production_in_at: '2026-03-05T00:00:00Z', status: 'Completed', work_type: 'Repair',
        labour_cost: 100, parts_cost: 50,
      }]),
      parts_line: src([{
        id: 'p1', event_date: '2026-03-02', work_order_no: 'JC-1', issue_number: 'MIS-7',
        item_description: 'Filter', qty: 2, line_cost: 150, currency: 'SAR', country: 'KSA',
      }]),
      line_item: src([{ id: 'i1', work_order_no: 'JC-1', asset_no: 'TM514', task: 'Replace filter' }]),
      tyre_fitment: src([{
        id: 't1', asset_no: 'TM514', serial_no: 'S1', position: 'LHF1', brand: 'TRIANGLE',
        issue_date: '2026-01-10', removal_date: '2026-05-10', total_km: 40000, country: 'KSA',
      }]),
      // Includes a RESET (1500 -> 200) so the reset-flagging path renders.
      odometer: src([
        { id: 1, reading_date: '2026-01-01', odometer_km: 1000, asset_no: 'TM514' },
        { id: 2, reading_date: '2026-02-01', odometer_km: 1500, asset_no: 'TM514' },
        { id: 3, reading_date: '2026-03-01', odometer_km: 200, asset_no: 'TM514' },
      ]),
      engine_hours: src([{ id: 1, reading_date: '2026-01-01', engine_hours: 100, asset_no: 'TM514' }]),
      inspection: src([{ id: 'n1', asset_no: 'TM514', inspection_date: '2026-04-01', title: 'Check' }]),
      checklist: { ok: true, rows: [], error: null, missing: false },
      accident: { ok: true, rows: [], error: null, missing: false },
      breakdown: src([{ id: 'b1', asset_no: 'TM514', reported_on: '2026-08-01', returned_to_service: false }]),
      wash: src([{ id: 'w1', asset_no: 'TM514', wash_date: '2026-06-01', cost: 0, country: 'KSA' }]),
      // A FAILED read, so the "could not be read" banner renders too.
      pm_service: { ok: false, rows: [], error: new Error('denied'), missing: false },
      utilization: { ok: true, rows: [], error: null, missing: false },
      penalty: { ok: true, rows: [], error: null, missing: false },
      disposal: src([{ id: 'd1', asset_no: 'TM514', disposition: 'Scrap', country: 'KSA' }]),
      tyre_mark: src([{ serial: 'S1', mark_type: 'scrap', reason: 'Worn', created_at: '2026-05-11' }]),
    },
  }),
}))

import AssetDetail from '../pages/AssetDetail'

const renderPage = () => render(
  <MemoryRouter initialEntries={['/assets/TM514']}>
    <Routes><Route path="/assets/:assetNo" element={<AssetDetail />} /></Routes>
  </MemoryRouter>,
)

/**
 * Find a button by its label. Matches on a PREFIX rather than equality because
 * several of these carry a count badge inside the same button ("What we do not
 * have" renders an unreadable-source count beside it), so an exact-equality
 * match silently finds nothing.
 */
const button = (label) => screen.getAllByRole('button')
  .find((b) => (b.textContent || '').trim().startsWith(label))

/**
 * Assert against the RENDERED TEXT of the whole page. Several of these strings
 * are split across child nodes by an icon or an interpolated count ("1 reset"
 * is an <svg> then "1" then " reset"), which no string matcher can see.
 */
const rendered = () => document.body.textContent || ''

beforeEach(() => cleanup())

describe('AssetDetail: the Full history tab', () => {
  it('mounts the page and offers the tab', async () => {
    renderPage()
    await waitFor(() => expect(button('Full history')).toBeTruthy())
  })

  it('CLICKS the tab and the whole timeline renders without throwing', async () => {
    renderPage()
    await waitFor(() => expect(button('Full history')).toBeTruthy())
    fireEvent.click(button('Full history'))

    // The summary tiles are the first thing the component paints once the read
    // settles; reaching them proves the extracted component, its helpers and
    // the pure engine all evaluated.
    await waitFor(() => expect(screen.getByText('Recorded events')).toBeTruthy())
    expect(rendered()).toContain('Lifetime spend')
    // "Job cards" appears twice by design: once as a summary tile, once as a
    // filter chip. Asserting a single match would fail on a correct render.
    expect(screen.getAllByText('Job cards').length).toBeGreaterThan(0)
  })

  it('renders each inner view without throwing', async () => {
    renderPage()
    await waitFor(() => expect(button('Full history')).toBeTruthy())
    fireEvent.click(button('Full history'))
    await waitFor(() => expect(screen.getByText('Recorded events')).toBeTruthy())

    // Meters exercises the chart.js Line path. If the extraction left the
    // component relying on VehicleHistory having registered LineElement, this
    // is where it breaks - AssetDetail is a DIFFERENT host.
    for (const view of ['Downtime', 'Meters', 'Lifecycle', 'What we do not have', 'Timeline']) {
      const btn = button(view)
      expect(btn, `view "${view}" is missing`).toBeTruthy()
      fireEvent.click(btn)
      await waitFor(() => expect(screen.getByText('Recorded events')).toBeTruthy())
    }
  })

  it('states the cross-country collision rather than merging two machines', async () => {
    renderPage()
    await waitFor(() => expect(button('Full history')).toBeTruthy())
    fireEvent.click(button('Full history'))
    await waitFor(() => expect(screen.getByText('Recorded events')).toBeTruthy())
    // TM514 exists in KSA and UAE in the fixture. V376: usually a DIFFERENT machine.
    expect(screen.getByText(/also exists in UAE/i)).toBeTruthy()
  })

  it('reports a failed source as unknown, never as an empty result', async () => {
    renderPage()
    await waitFor(() => expect(button('Full history')).toBeTruthy())
    fireEvent.click(button('Full history'))
    await waitFor(() => expect(screen.getByText('Recorded events')).toBeTruthy())
    expect(screen.getByText(/could not be read/i)).toBeTruthy()
  })

  it('shows the reset-aware meter reading rather than a smoothed total', async () => {
    renderPage()
    await waitFor(() => expect(button('Full history')).toBeTruthy())
    fireEvent.click(button('Full history'))
    await waitFor(() => expect(screen.getByText('Recorded events')).toBeTruthy())
    fireEvent.click(button('Meters'))
    // 1000 -> 1500 -> 200: the drop is a meter change, not a negative distance,
    // so the distance is the 500 rise alone and the reset is STATED rather than
    // smoothed away. A naive last-minus-first would report -800.
    await waitFor(() => expect(rendered()).toMatch(/1 meter reset/i))
    expect(rendered()).toMatch(/500 km/)
  })
})

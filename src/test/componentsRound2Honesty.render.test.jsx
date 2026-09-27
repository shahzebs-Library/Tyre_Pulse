/**
 * Failed-read honesty for the components converted to EnterpriseTable in
 * round 2: a read that FAILED must say so and offer Retry. It must never
 * render as "no data", an empty list or zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  site: vi.fn(),
  km: vi.fn(),
  policy: vi.fn(),
  claims: vi.fn(),
}))

vi.mock('../lib/api/siteOperatingCost', () => ({
  getSiteOperatingCostMulti: (...a) => h.site(...a),
  storeVsOperating: () => [],
}))
vi.mock('../lib/api/fleetCpk', () => ({ getCpkKmSource: (...a) => h.km(...a) }))
vi.mock('../lib/api/insurancePortfolio', () => ({
  listPolicyAssets: (...a) => h.policy(...a),
  listClaimRegister: (...a) => h.claims(...a),
}))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: () => {}, exportToPdf: () => {},
  reportFileName: (...p) => p.filter(Boolean).join(' '), reportDateLabel: () => '01 Jan 2026',
}))

import SiteOperatingCostPanel from '../components/expense/SiteOperatingCostPanel'
import KmSourcePanel, { kmSourceOutcome } from '../components/cpk/KmSourcePanel'
import AssetInsurancePanel from '../components/insurance/AssetInsurancePanel'

const money = (v) => (v == null ? 'N/A' : `SAR ${v}`)

beforeEach(() => {
  cleanup()
  h.site.mockReset(); h.km.mockReset(); h.policy.mockReset(); h.claims.mockReset()
})

describe('SiteOperatingCostPanel', () => {
  it('shows the failure and a Retry, never an empty or zero cost table', async () => {
    h.site.mockRejectedValueOnce(new Error('relation "x" does not exist'))
    render(<SiteOperatingCostPanel country="KSA" from="2026-01-01" to="2026-01-31" money={money} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/not the same as zero/i)
    expect(screen.queryByText(/No expense lines in this period/i)).toBeNull()
    // Raw database text never reaches the reader.
    expect(screen.queryByText(/relation/i)).toBeNull()

    h.site.mockResolvedValueOnce({ ok: true, blocks: [{ currency: 'SAR', coverage: { pct: 90, lines: 10, resolved: 9, unresolved: 1 }, bySite: [{ site: 'NHC', country: 'KSA', currency: 'SAR', total: 500, tyre: 100, spare: 300, oil: 100, lines: 4, assets: 2, resolved: true }], byStore: [] }] })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect((await screen.findAllByText('NHC')).length).toBeGreaterThan(0)
    expect(h.site).toHaveBeenLastCalledWith(expect.objectContaining({ countries: ['KSA'], strict: true }))
  })

  it('asks for one country instead of blending currencies on the All scope', () => {
    render(<SiteOperatingCostPanel country="All" money={money} />)
    expect(screen.getByText(/Pick a single country/i)).toBeInTheDocument()
    expect(h.site).not.toHaveBeenCalled()
  })
})

describe('KmSourcePanel', () => {
  it('classifies only an explicit empty answer as empty', () => {
    expect(kmSourceOutcome({ ok: true })).toBe('ok')
    expect(kmSourceOutcome({ ok: false, reason: 'empty' })).toBe('empty')
    expect(kmSourceOutcome({ ok: false, reason: 'error' })).toBe('failed')
    expect(kmSourceOutcome({ ok: false })).toBe('failed')
    expect(kmSourceOutcome(null)).toBe('failed')
  })

  it('renders a failed read as an error with Retry, not as "no tyre km"', async () => {
    h.km.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    render(<KmSourcePanel country="KSA" from="2026-01-01" to="2026-01-31" currency="SAR" />)
    expect(await screen.findByText(/Could not load the KM source/i)).toBeInTheDocument()
    expect(screen.queryByText(/No tyre km recorded/i)).toBeNull()

    h.km.mockResolvedValueOnce({ ok: true, by_asset: [{ asset_no: 'TM634', tyres: 2, km: 187080 }] })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText('TM634')).toBeInTheDocument())
    expect(screen.getByText('187,080')).toBeInTheDocument()
  })

  it('shows the honest empty state for an explicitly empty period', async () => {
    h.km.mockResolvedValueOnce({ ok: false, reason: 'empty' })
    render(<KmSourcePanel country="KSA" from="2026-01-01" to="2026-01-31" currency="SAR" />)
    expect(await screen.findByText(/No tyre km recorded for this period/i)).toBeInTheDocument()
  })
})

describe('AssetInsurancePanel', () => {
  it('shows the failed read with a Retry instead of an empty claim history', async () => {
    h.policy.mockResolvedValue({ data: [], error: 'Could not load the insurance schedule.' })
    h.claims.mockResolvedValue({ data: [], error: '' })
    render(<AssetInsurancePanel asset={{ asset_no: 'TM1', country: 'KSA' }} country="KSA" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the insurance schedule/)
    expect(screen.queryByText(/does not appear on the insurer/i)).toBeNull()

    h.policy.mockResolvedValue({ data: [], error: '' })
    h.claims.mockResolvedValue({ data: [{ id: 'c1', asset_no: 'TM1', claim_no: 'CL-9', accident_date: '2026-02-01', paid_amount: 100, currency: 'SAR' }], error: '' })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('CL-9')).toBeInTheDocument()
  })
})

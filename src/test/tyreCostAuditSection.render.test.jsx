import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { scanKpis, savedKpis, breakdown, moneyText, costCell, canApply, canDecide } from '../lib/tyreCostAuditView'

const h = vi.hoisted(() => ({
  auth: { profile: { id: 'u1', role: 'Admin' }, isSuperAdmin: false },
  run: vi.fn(), list: vi.fn(), all: vi.fn(), decide: vi.fn(), apply: vi.fn(), undo: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), reportFileName: (...p) => p.join(' ') }))
vi.mock('../lib/api/tyreCostAudit', () => ({
  runCostAudit: (...a) => h.run(...a),
  listCostFindings: (...a) => h.list(...a),
  listAllCostFindings: (...a) => h.all(...a),
  decideFindings: (...a) => h.decide(...a),
  applyFindings: (...a) => h.apply(...a),
  undoBatch: (...a) => h.undo(...a),
  NOT_INSTALLED_MESSAGE: 'Tyre Cost Audit is not installed on this database yet',
  PAGE_SIZE: 100,
}))

import TyreCostAuditSection from '../components/reconciliation/TyreCostAuditSection'

const ROWS = [
  { id: 'f1', serial_no: 'YMA1', asset_no: 'TM1', country: 'KSA', site: 'NHC', month: '2025-03', class: 'exact_match', status: 'proposed', original_cost: null, proposed_cost: 900, currency: 'SAR', item_code: '310100-O', source_line_id: 'line-1', confidence: 'high', reasons: ['own job card line'] },
  { id: 'f2', serial_no: 'YMA2', asset_no: 'TM2', country: 'KSA', site: 'NHC', month: '2025-03', class: 'exact_match', status: 'approved', original_cost: 0, proposed_cost: 850, currency: 'SAR', item_code: '310100-O', source_line_id: 'line-2', confidence: 'high', reasons: [] },
]

beforeEach(() => {
  for (const k of ['run', 'list', 'all', 'decide', 'apply', 'undo']) h[k].mockReset()
  h.auth = { profile: { id: 'u1', role: 'Admin' }, isSuperAdmin: false }
  h.list.mockResolvedValue({ installed: true, rows: ROWS, total: 2 })
  h.all.mockResolvedValue({ installed: true, rows: ROWS, truncated: false })
})

describe('tyreCostAuditView', () => {
  it('scan KPIs keep money per currency and count missing non-warranty classes', () => {
    const k = scanKpis({ checked: 10, by_country_class: [
      { country: 'KSA', class: 'exact_match', n: 3, proposed: 2700, currency: 'SAR' },
      { country: 'UAE', class: 'exact_match', n: 1, proposed: 700, currency: 'AED' },
      { country: 'KSA', class: 'excluded_warranty', n: 2, proposed: null, currency: 'SAR' },
      { country: 'KSA', class: 'unresolved', n: 4, proposed: null, currency: 'SAR' },
    ] })
    expect(k.checked).toBe(10)
    expect(k.missingNonWarranty).toBe(8)
    expect(k.warrantyExcluded).toBe(2)
    expect(k.proposedByCurrency).toEqual({ SAR: 2700, AED: 700 })
    expect(moneyText(k.proposedByCurrency)).toBe('AED 700 | SAR 2,700')
    expect(scanKpis(null)).toBeNull()
  })
  it('saved KPIs, breakdowns and cells', () => {
    expect(savedKpis(ROWS).approvedByCurrency).toEqual({ SAR: 850 })
    expect(breakdown(ROWS, 'site')[0]).toMatchObject({ key: 'NHC', findings: 2 })
    expect(costCell(null, 'SAR')).toBe('Cost Pending Verification')
    expect(costCell(0, 'SAR')).toBe('SAR 0')
    expect(moneyText({})).toBe('N/A')
    expect(canApply({ role: 'Manager' })).toBe(false)
    expect(canDecide({ role: 'Manager' })).toBe(true)
    expect(canApply({ role: 'Manager', isSuperAdmin: true })).toBe(true)
  })
})

describe('TyreCostAuditSection', () => {
  it('states honestly when the audit is not installed', async () => {
    h.list.mockResolvedValue({ installed: false, rows: [], total: 0 })
    h.all.mockResolvedValue({ installed: false, rows: [], truncated: false })
    render(<TyreCostAuditSection />)
    expect(await screen.findByText(/not installed on this database yet/)).toBeTruthy()
  })

  it('shows an empty state and N/A KPIs before any audit', async () => {
    h.list.mockResolvedValue({ installed: true, rows: [], total: 0 })
    h.all.mockResolvedValue({ installed: true, rows: [], truncated: false })
    render(<TyreCostAuditSection />)
    expect(await screen.findByText(/No saved findings in this scope yet/)).toBeTruthy()
    expect(screen.getByText('Tyres checked')).toBeTruthy()
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
    expect(screen.getByText(/No invoice, GRN or PO records exist/)).toBeTruthy()
  })

  it('renders findings with pending label, runs a dry run and approves', async () => {
    h.run.mockResolvedValue({ installed: true, data: { dry_run: true, checked: 2, by_country_class: [{ country: 'KSA', class: 'exact_match', n: 2, proposed: 1750, currency: 'SAR' }] } })
    h.decide.mockResolvedValue({ ok: true, decided: 1, skipped: 0 })
    render(<TyreCostAuditSection />)
    expect((await screen.findAllByText('Cost Pending Verification')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('SAR 850').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Run dry-run audit/ }))
    await waitFor(() => expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, from: '2025-01-01' })))
    expect(await screen.findByText(/Dry run \(nothing saved\)/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select YMA1'))
    fireEvent.click(screen.getByRole('button', { name: /Approve \(1\)/ }))
    await waitFor(() => expect(h.decide).toHaveBeenCalledWith(['f1'], 'approved', undefined))
  })

  it('reject needs a reason; apply confirms and offers undo', async () => {
    h.decide.mockResolvedValue({ ok: true, decided: 1 })
    h.apply.mockResolvedValue({ ok: true, applied: 1, batch: 'batch-123456789' })
    render(<TyreCostAuditSection />)
    await screen.findAllByText('Cost Pending Verification')
    fireEvent.click(screen.getByLabelText('Select YMA1'))
    fireEvent.click(screen.getByRole('button', { name: /Reject \(1\)/ }))
    const rejectBtn = await screen.findByRole('button', { name: 'Reject 1' })
    expect(rejectBtn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'wrong code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject 1' }))
    await waitFor(() => expect(h.decide).toHaveBeenCalledWith(['f1'], 'rejected', 'wrong code'))

    await waitFor(() => expect(screen.getByLabelText('Select YMA2')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select YMA2'))
    fireEvent.click(screen.getByRole('button', { name: /Apply approved \(1\)/ }))
    expect(await screen.findByText(/It is undoable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1' }))
    await waitFor(() => expect(h.apply).toHaveBeenCalledWith(['f2']))
    expect(await screen.findByRole('button', { name: /Undo batch batch-12/ })).toBeTruthy()
  })

  it('a Manager can decide but not apply', async () => {
    h.auth = { profile: { id: 'u2', role: 'Manager' }, isSuperAdmin: false }
    render(<TyreCostAuditSection />)
    await screen.findAllByText('Cost Pending Verification')
    fireEvent.click(screen.getByLabelText('Select YMA2'))
    expect(screen.queryByRole('button', { name: /Apply approved/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Run dry-run audit/ })).toBeTruthy()
  })
})

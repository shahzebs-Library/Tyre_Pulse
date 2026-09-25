import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../console/components/ui/charts', () => ({ BarsChart: ({ summary }) => <div data-testid="bars">{summary}</div> }))
vi.mock('../lib/exportUtils', () => ({ exportSheetsToExcel: vi.fn(async () => true) }))
vi.mock('../lib/api/systemConfig', () => ({ configNum: () => 0 }))
const log = vi.fn(async () => 'job-1')
vi.mock('../lib/api/tenantExport', () => ({
  listExportOrganisations: vi.fn(async () => [{ id: 'o1', name: 'Company A', active: true }]),
  getExportManifest: vi.fn(async () => ({
    orgId: 'o1', orgName: 'Company A', generatedAt: null, totalRows: 7, unreadable: 0, nonEmpty: 1,
    tables: [
      { table: 'sites', label: 'Sites', rows: 7, error: null },
      { table: 'alerts', label: 'Alerts', rows: 0, error: null },
    ],
  })),
  exportTableRows: vi.fn(async (org, table) => ({ table, expected: 7, rows: Array.from({ length: 7 }, (_, i) => ({ id: i })), complete: true, truncated: false, error: null })),
  logTenantExport: (...a) => log(...a),
  listExportJobs: vi.fn(async () => [
    { id: 'j0', org_id: 'o1', reason: 'legal hold ticket 9', tables: ['sites'], status: 'partial', row_counts: { sites: 3 }, created_at: '2026-09-20T00:00:00Z' },
    { id: 'j1', org_id: 'o1', reason: 'old server dump', tables: ['sites'], status: 'expired', mode: 'server', files: [{ table: 'sites', path: 'o1/j1/sites/part-0001.ndjson.gz' }], row_counts: { sites: 3 }, created_at: '2026-09-01T00:00:00Z', expired_at: '2026-09-10T00:00:00Z' },
  ]),
  getRetentionStatus: vi.fn(async () => ({ days: 7, dueCount: 0, due: [], storedJobs: 1, expiredJobs: 1, lastPurgeAt: null, nextRun: 'daily 02:40 UTC' })),
  setRetentionDays: vi.fn(async () => ({ days: 7 })),
  purgeExpiredNow: vi.fn(async () => ({ queued: false, due: 0 })),
}))

import ConsoleTenantExport from '../console/pages/ConsoleTenantExport'

describe('ConsoleTenantExport', () => {
  it('shows history, loads a manifest and requires a reason before exporting', async () => {
    render(<ConsoleTenantExport />)
    expect(await screen.findByText('legal hold ticket 9')).toBeTruthy()
    expect(screen.getByText('Partial')).toBeTruthy()
    expect(screen.getByText('Expired')).toBeTruthy()
    expect(screen.getByText('Deleted')).toBeTruthy()
    expect(await screen.findByText('Export retention')).toBeTruthy()
    expect(screen.getByText('No organisation chosen')).toBeTruthy()

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'o1' } })
    expect(await screen.findByText('Sites')).toBeTruthy()
    expect(screen.getByText('Skipped')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }))
    const start = await screen.findByRole('button', { name: /Start export/ })
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/customer offboarding/), { target: { value: 'customer offboarding' } })
    fireEvent.click(screen.getByRole('button', { name: /Start export/ }))
    await waitFor(() => expect(log).toHaveBeenCalledWith('o1', 'customer offboarding', ['sites'], { sites: 7 }, 'completed'))
    expect(await screen.findByText(/Export complete: 7 rows/)).toBeTruthy()
  })
})

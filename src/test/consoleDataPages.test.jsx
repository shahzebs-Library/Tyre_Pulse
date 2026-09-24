/**
 * Console data pages: kit conversion guard + the destructive-action gates.
 *
 * Backups, Data Browser, Data Cleanup, Duplicate Control, Smart Import and
 * Material Master moved onto the shared console UI kit. The source scan keeps
 * them there; the render tests prove the typed confirmations still gate the
 * destructive calls, which a presentation rewrite must never weaken.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../console/components/ui/charts', () => ({
  BarsChart: ({ summary }) => <div data-testid="bars">{summary}</div>,
  TrendChart: ({ summary }) => <div data-testid="trend">{summary}</div>,
  ShareChart: ({ summary }) => <div data-testid="share">{summary}</div>,
  STATUS: { dark: { good: '#0f0', medium: '#fa0', critical: '#f00', low: '#999' } },
  SERIES: { dark: ['#f80', '#08f'] },
  useChartTheme: () => 'dark',
}))
vi.mock('../console/ConsoleAuthContext', () => ({
  useConsoleAuth: () => ({ admin: { full_name: 'Ops Admin' }, logAction: vi.fn() }),
}))

const h = vi.hoisted(() => ({
  runCleanup: null,
  restoreMissing: null,
}))

vi.mock('../lib/api/dataCleanup', () => {
  h.runCleanup = vi.fn(() => Promise.resolve({ deleted: 3, snapshot: 'snap-1' }))
  return {
    listCleanupTargets: () => Promise.resolve([
      { key: 'system_logs', label: 'System logs', kind: 'log', total: 1200, oldest: '2024-01-01', newest: '2026-09-01' },
      { key: 'accidents', label: 'Accidents', kind: 'business', total: 40, oldest: '2025-01-01', newest: '2026-09-01' },
    ]),
    previewCleanup: () => Promise.resolve({ count: 3 }),
    runCleanup: h.runCleanup,
    monthsAgoISO: (m) => `20${24 - Math.floor(m / 12)}-01-01`,
    AGE_PRESETS: [{ months: 12, label: '1 year' }, { months: 24, label: '2 years' }],
  }
})

vi.mock('../lib/api/backups', () => {
  h.restoreMissing = vi.fn(() => Promise.resolve({ restored: 2 }))
  return {
    listBackupSnapshots: () => Promise.resolve([
      { id: 's2', taken_at: '2026-09-23T00:30:00Z', reason: 'nightly', table_count: 1, total_rows: 500,
        tables: [{ table_name: 'tyre_records', row_count: 500 }] },
      { id: 's1', taken_at: '2026-09-22T00:30:00Z', reason: 'manual', table_count: 1, total_rows: 480,
        tables: [{ table_name: 'tyre_records', row_count: 480 }] },
    ]),
    createBackupSnapshot: vi.fn(() => Promise.resolve({ total_rows: 500, table_count: 1 })),
    restorePreview: () => Promise.resolve({ snapshot_rows: 500, current_rows: 498, missing_rows: 2, newer_current_rows: 0 }),
    restoreMissing: h.restoreMissing,
  }
})

afterEach(() => cleanup())

const PAGES = [
  'ConsoleBackups.jsx', 'ConsoleDataBrowser.jsx', 'ConsoleDataCleanup.jsx',
  'ConsoleDuplicateControl.jsx', 'ConsoleSmartImport.jsx', 'ConsoleMaterialMaster.jsx',
]
const read = (f) => readFileSync(resolve(__dirname, '../console/pages', f), 'utf8')

describe('console data pages use the console UI kit', () => {
  for (const page of PAGES) {
    const src = read(page)
    it(`${page} imports the kit and has no hand-rolled fixed overlay`, () => {
      expect(src).toMatch(/from '\.\.\/components\/ui'/)
      expect(src).not.toMatch(/fixed inset-0/)
      expect(src).not.toMatch(/\b(?:bg|text|border)-(?:slate|indigo|sky)-/)
    })
    it(`${page} has no em or en dashes`, () => {
      expect(src).not.toMatch(/[–—]/)
    })
  }
})

describe('Data Cleanup keeps the typed CLEAN gate', () => {
  it('does not delete until CLEAN is typed', async () => {
    const { default: Page } = await import('../console/pages/ConsoleDataCleanup')
    render(<Page />)
    fireEvent.click(await screen.findByText('Accidents'))
    expect(screen.getByText(/operational business data/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    const del = await screen.findByRole('button', { name: /Delete old records/ })
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    const confirm = await screen.findByRole('button', { name: /Delete permanently/ })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Type CLEAN/), { target: { value: 'clea' } })
    expect(confirm.disabled).toBe(true)
    expect(h.runCleanup).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Type CLEAN/), { target: { value: 'CLEAN' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(h.runCleanup).toHaveBeenCalledTimes(1))
  })
})

describe('Backups keeps the typed RESTORE gate', () => {
  it('reports the newest backup, not a sum across copies, and gates recovery', async () => {
    const { default: Page } = await import('../console/pages/ConsoleBackups')
    render(<Page />)
    expect(await screen.findByText('Rows in newest')).toBeTruthy()
    // 500 + 480 = 980 would be the old double-counted figure.
    expect(screen.queryByText('980')).toBeNull()
    fireEvent.click(screen.getAllByText(/tables, 500 rows saved/)[0])
    fireEvent.click(await screen.findByRole('button', { name: /Preview restore/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Recover missing rows/ }))
    const inputs = await screen.findAllByPlaceholderText('RESTORE')
    const buttons = screen.getAllByRole('button', { name: /Recover missing rows/ })
    const go = buttons[buttons.length - 1]
    expect(go.disabled).toBe(true)
    fireEvent.keyDown(inputs[0], { key: 'Enter' })
    expect(h.restoreMissing).not.toHaveBeenCalled()
    fireEvent.change(inputs[0], { target: { value: 'RESTORE' } })
    fireEvent.click(go)
    await waitFor(() => expect(h.restoreMissing).toHaveBeenCalledTimes(1))
  })
})

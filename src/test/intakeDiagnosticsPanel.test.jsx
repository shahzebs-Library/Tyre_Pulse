import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import IntakeDiagnosticsPanel from '../components/intake/IntakeDiagnosticsPanel'
import { summarizeValidation, summarizeCommitResult, diagnoseBatchHealth } from '../lib/import/diagnostics'

// Integration seam: the diagnostics engine's real output must render through the
// panel in every mode without crashing. This guards the wiring used by the Data
// Intake wizard (engine → panel) end-to-end with genuine (not hand-faked) data.

const ROWS = [
  { sourceRowNo: 1, validationStatus: 'ready', issues: [], dupStatus: 'none', liveDuplicate: false, countryConflict: false },
  { sourceRowNo: 2, validationStatus: 'error', issues: [{ field: 'serial_no', severity: 'error', code: 'REQUIRED_MISSING', message: 'Serial No. is required' }], dupStatus: 'none', liveDuplicate: false, countryConflict: false },
  { sourceRowNo: 3, validationStatus: 'error', issues: [{ field: 'issue_date', severity: 'error', code: 'DATE_INVALID', message: 'Invalid date' }], dupStatus: 'none', liveDuplicate: false, countryConflict: false },
  { sourceRowNo: 4, validationStatus: 'warning', issues: [{ field: 'cost', severity: 'warning', code: 'CURRENCY_MISSING', message: 'Currency missing' }], dupStatus: 'none', liveDuplicate: true, countryConflict: false },
]

describe('IntakeDiagnosticsPanel × diagnostics engine (integration)', () => {
  it('renders the validate mode from real summarizeValidation output', () => {
    const v = summarizeValidation(ROWS, { module: 'tyre' })
    const onForceErrors = vi.fn()
    const onSkipErrors = vi.fn()
    render(<IntakeDiagnosticsPanel mode="validate" validation={v} actions={{ canForce: true, onForceErrors, onSkipErrors, onReset: vi.fn() }} onDownload={vi.fn()} />)
    // Grouped blocking reason from the engine surfaces in the panel.
    expect(screen.getByText(/Required/i)).toBeInTheDocument()
    // The one-click force control is wired to the callback.
    fireEvent.click(screen.getByRole('button', { name: /Force/i }))
    expect(onForceErrors).toHaveBeenCalledTimes(1)
  })

  it('renders the result mode from real summarizeCommitResult output', () => {
    const c = summarizeCommitResult({
      status: 'partial', inserted: 1200, skipped: 30, failed: 12, merged: 5, remaining: 8,
      errors: [{ row: 42, message: 'null value in column "asset_no"' }, { row: 43, message: 'null value in column "asset_no"' }],
      target: 'tyre_records',
    })
    render(<IntakeDiagnosticsPanel mode="result" commit={c} onDownload={vi.fn()} />)
    expect(screen.getAllByText(/1,200/).length).toBeGreaterThan(0)
    // Real commit output surfaces the failed count + a partial/stalled signal.
    expect(screen.getAllByText(/Failed/i).length).toBeGreaterThan(0)
    expect(c.partial).toBe(true)
  })

  it('renders the batch mode from real diagnoseBatchHealth output', () => {
    const checks = diagnoseBatchHealth({ batch: { import_status: 'committed', total_rows: 100, ready_rows: 90, warning_rows: 5, error_rows: 5, conflict_rows: 0, imported_rows: 88 } })
    render(<IntakeDiagnosticsPanel mode="batch" batchHealth={checks} batchMeta={{ module: 'tyre', country: 'KSA', importStatus: 'committed', total: 100, imported: 88 }} />)
    expect(screen.getByText(/tyre/i)).toBeInTheDocument()
  })

  it('never crashes on empty/partial props', () => {
    render(<IntakeDiagnosticsPanel mode="validate" validation={summarizeValidation([])} />)
    render(<IntakeDiagnosticsPanel mode="result" commit={summarizeCommitResult(null)} />)
    render(<IntakeDiagnosticsPanel mode="batch" batchHealth={diagnoseBatchHealth(null)} />)
    expect(true).toBe(true)
  })
})

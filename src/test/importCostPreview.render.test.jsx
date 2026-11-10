import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImportCostPreview from '../components/intake/ImportCostPreview'
import { buildImportPreview } from '../lib/importCostPreview'

const grid = (o = {}) => ({ source_row: '', work_order_no: 'JC1', txn_date: '10-03-2026', item_code: '310100-O', qty: '1', item_description: 'TYRE 315/80R22.5', value_amount: '900', ...o })

describe('ImportCostPreview', () => {
  it('shows the split reconciliation, excluded row numbers and the per-row result', () => {
    const preview = buildImportPreview('grid', [
      grid({ source_row: '1' }),
      grid({ source_row: '2', value_amount: '0' }),
      grid({ source_row: '3', item_code: '' }),
    ], { country: 'KSA' })
    render(<ImportCostPreview preview={preview} currency="SAR" />)
    expect(screen.getByTestId('import-cost-recon').textContent).toMatch(/reconciles/)
    expect(screen.getByTestId('import-cost-excluded').textContent).toMatch(/Row 3/)
    expect(screen.getAllByText(/Price proposed/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Approve proposed price/).length).toBeGreaterThan(0)
  })
})

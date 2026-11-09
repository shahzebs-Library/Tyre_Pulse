import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../contexts/LanguageContext', async importOriginal => (await import('./workforceLanguageMock.js')).mockWorkforceLanguage(importOriginal))
const load = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/workforceStockReadiness', () => ({ loadStockReadiness: load }))

import StockReadiness from '../components/workforce/StockReadiness'

describe('StockReadiness', () => {
  it('renders nothing until an asset is entered', () => {
    const { container } = render(<StockReadiness assetNo="" site="NHC" />)
    expect(container.textContent).toBe('')
  })

  it('shows quantities with filled-in placeholders and where else the size is held', async () => {
    load.mockResolvedValue({ ok: true, result: { state: 'out', lines: [
      { size: '23.5R25', state: 'out', qty: 0, lastCounted: '2026-10-19T08:00:00Z', elsewhere: [{ site: 'DIRIYAH', qty: 1 }] },
    ] } })
    render(<StockReadiness assetNo="WL207" site="NHC" />)
    expect(await screen.findByText(/Out of stock at this site/, {}, { timeout: 2000 })).toBeInTheDocument()
    const line = screen.getByText(/23.5R25/).closest('p').textContent
    expect(line).toContain('0 on hand, counted 2026-10-19')
    expect(line).toContain('Available at DIRIYAH (1)')
    expect(line).not.toMatch(/[{}]/)
  })

  it('a failed read says so and does not invent a figure', async () => {
    load.mockResolvedValue({ ok: false, error: new Error('x') })
    render(<StockReadiness assetNo="WL207" site="NHC" />)
    expect(await screen.findByText(/Could not check stock right now/, {}, { timeout: 2000 })).toBeInTheDocument()
  })
})

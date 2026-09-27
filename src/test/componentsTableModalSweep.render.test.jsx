import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stableT = (k) => k
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: stableT }) }))
const imports = vi.hoisted(() => ({ linkAudit: vi.fn(), linkCreateMissingAssets: vi.fn() }))
vi.mock('../lib/api/imports', () => imports)
const jobCards = vi.hoisted(() => ({ getDailyJobCards: vi.fn() }))
vi.mock('../lib/api/jobCards', () => jobCards)

const { default: DataLinkPanel } = await import('../components/intake/DataLinkPanel')
const { default: DailyJobCards } = await import('../components/dashboard/DailyJobCards')
const { ChartModal } = await import('../components/ChartModal')

describe('component sweep: honest states on the shared shells', () => {
  it('DataLinkPanel never reports "all linked" when the audit failed, and offers Retry', async () => {
    imports.linkAudit.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      fleet_assets: 3, tables: { tyre_records: { total: 5, orphans: 1, blank_asset: 0 } },
    })
    render(<DataLinkPanel />)
    expect(await screen.findByText('intake.panels.dataLink.errorLoad')).toBeInTheDocument()
    expect(screen.queryByText('intake.panels.dataLink.allLinked')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('intake.panels.dataLink.tables.tyre_records')).toBeInTheDocument()
  })

  it('DailyJobCards shows a failed read with Retry instead of vanishing', async () => {
    jobCards.getDailyJobCards.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      ok: true, kpis: { still_out: 1 }, still_out_list: [{ work_order_no: 'JC-1', asset_no: 'TM1', site: 'NHC', hours_out: 50, not_started: true }],
    })
    render(<MemoryRouter><DailyJobCards country="KSA" /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    await waitFor(() => expect(screen.getByText('JC-1')).toBeInTheDocument())
    expect(screen.getAllByText('Not started').length).toBeGreaterThan(0)
  })

  it('ChartModal renders for a conditionally mounted caller that passes no open prop', () => {
    const onClose = vi.fn()
    render(<ChartModal title="Risk mix" onClose={onClose}><p>chart body</p></ChartModal>)
    expect(screen.getByRole('dialog', { name: 'Risk mix' })).toBeInTheDocument()
    expect(screen.getByText('chart body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

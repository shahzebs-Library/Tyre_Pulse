import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const state = vi.hoisted(() => ({ settings: null, saved: [] }))
vi.mock('../lib/api/pdfCache', () => ({
  getPdfSettings: vi.fn(async () => state.settings),
  updatePdfSettings: vi.fn(async (v) => {
    state.saved.push(v)
    if (v.retentionDays < 90) return { ok: false, reason: 'retention_below_minimum' }
    return { ok: true, bulk_limit: v.bulkLimit, retention_days: v.retentionDays, manager_regenerate_approved: v.managerRegenerate }
  }),
}))

import PdfSettingsPanel from '../components/pdf/PdfSettingsPanel'
import * as api from '../lib/api/pdfCache'

const base = { ok: true, bulk_limit: 50, retention_days: 90, retention_min_days: 90, bulk_limit_max: 500, manager_regenerate_approved: false, can_edit: true }
beforeEach(() => { state.settings = { ...base }; state.saved = []; vi.clearAllMocks() })

describe('PdfSettingsPanel', () => {
  it('shows nothing to a person who cannot edit, and nothing before the migration is applied', async () => {
    state.settings = { ...base, can_edit: false }
    const a = render(<PdfSettingsPanel />)
    await waitFor(() => expect(api.getPdfSettings).toHaveBeenCalled())
    expect(a.container.textContent).toBe('')
    a.unmount()
    state.settings = null
    const b = render(<PdfSettingsPanel />)
    await waitFor(() => expect(api.getPdfSettings).toHaveBeenCalledTimes(2))
    expect(b.container.textContent).toBe('')
  })

  it('starts at 50 reports, 90 days and managers NOT authorised', async () => {
    render(<PdfSettingsPanel />)
    expect((await screen.findByLabelText(/Reports in one bulk download/)).value).toBe('50')
    expect(screen.getByLabelText(/Keep superseded copies/).value).toBe('90')
    expect(screen.getByRole('checkbox').checked).toBe(false)
  })

  it('refuses retention below 90 days before asking the server', async () => {
    render(<PdfSettingsPanel />)
    fireEvent.change(await screen.findByLabelText(/Keep superseded copies/), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 90 days/)
    expect(api.updatePdfSettings).not.toHaveBeenCalled()
  })

  it('saves a longer retention, another limit and the manager authorisation', async () => {
    const onChange = vi.fn()
    render(<PdfSettingsPanel onChange={onChange} />)
    fireEvent.change(await screen.findByLabelText(/Reports in one bulk download/), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText(/Keep superseded copies/), { target: { value: '365' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(state.saved).toEqual([{ bulkLimit: 25, retentionDays: 365, managerRegenerate: true }]))
    expect((await screen.findByRole('status')).textContent).toBe('Saved.')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bulk_limit: 25 }))
  })
})

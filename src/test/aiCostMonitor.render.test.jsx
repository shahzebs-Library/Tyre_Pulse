import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// The AI Cost Monitor must never render blank: loading, error (with Retry), empty and
// awkward rows (null cost, missing dates, unknown status) all produce visible content.
const api = vi.hoisted(() => ({ readTokenLogs: vi.fn(), getModelPricing: vi.fn() }))
vi.mock('../lib/api', () => ({ aiOps: { readTokenLogs: (...a) => api.readTokenLogs(...a), getModelPricing: (...a) => api.getModelPricing(...a) } }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k, d) => d || k, language: 'en', dir: 'ltr' }) }))
vi.mock('../hooks/useReportMeta', () => ({ useReportMeta: () => ({ company: 'Test', currency: 'USD' }) }))

import { MemoryRouter } from 'react-router-dom'
import AiCostMonitorPage from '../pages/AiCostMonitor'
const AiCostMonitor = () => <MemoryRouter><AiCostMonitorPage /></MemoryRouter>

beforeEach(() => {
  cleanup()
  api.readTokenLogs.mockReset()
  api.getModelPricing.mockReset()
  api.getModelPricing.mockResolvedValue({})
})

describe('AI Cost Monitor states', () => {
  it('shows a skeleton while loading, never an empty body', async () => {
    api.readTokenLogs.mockReturnValue(new Promise(() => {}))
    const { container } = render(<AiCostMonitor />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('shows a readable error with Retry that reloads', async () => {
    api.readTokenLogs.mockRejectedValueOnce(new Error('relation "ai_token_logs" does not exist'))
    render(<AiCostMonitor />)
    const retry = await screen.findByRole('button', { name: /retry/i })
    expect(document.body.textContent).not.toMatch(/relation|ai_token_logs/) // no raw database text
    api.readTokenLogs.mockResolvedValueOnce({ rows: [], truncated: false })
    fireEvent.click(retry)
    await waitFor(() => expect(api.readTokenLogs).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry/i })).toBeNull())
  })

  it('renders KPI cards and an honest empty message for zero rows', async () => {
    api.readTokenLogs.mockResolvedValue({ rows: [], truncated: false })
    render(<AiCostMonitor />)
    expect(await screen.findByText('Total cost')).toBeTruthy()
    expect(screen.getByText('No AI usage recorded yet')).toBeTruthy()
  })

  it('does not crash on null rows, null cost, missing dates and unknown status', async () => {
    api.readTokenLogs.mockResolvedValue({ rows: [
      { id: 1, created_at: null, model: null, feature: null, status: 'weird', cost_usd: null, prompt_tokens: null, completion_tokens: null },
      { id: 2, created_at: 'not-a-date', model: 'claude-haiku-5-5', feature: 'ai_tyre_inspection', status: 'error', cost_usd: 0.002, prompt_tokens: 100, completion_tokens: 20, error: 'bad json' },
      { id: 3, created_at: '2026-10-20T10:00:00Z', model: 'claude-haiku-5-5', feature: 'ai_tyre_inspection', status: 'error', cost_usd: null, error: 'timeout' },
    ], truncated: false })
    render(<AiCostMonitor />)
    expect(await screen.findByText('Total cost')).toBeTruthy()
    expect(screen.queryByText(/something went wrong/i)).toBeNull()
  })

  it('a payload without rows (undefined) still renders the page', async () => {
    api.readTokenLogs.mockResolvedValue({})
    render(<AiCostMonitor />)
    expect(await screen.findByText('Total cost')).toBeTruthy()
  })
})

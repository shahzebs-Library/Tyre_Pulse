import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../console/components/ui/charts', () => {
  const pal = { critical: '#f00', high: '#f80', medium: '#fa0', low: '#999', good: '#0f0' }
  return {
    BarsChart: ({ summary }) => <div data-testid="bars">{summary}</div>,
    ShareChart: ({ summary }) => <div data-testid="share">{summary}</div>,
    ScoreRing: ({ score }) => <div data-testid="ring">{score === null || score === undefined ? 'N/A' : score}</div>,
    STATUS: { dark: pal, light: pal },
    useChartTheme: () => 'dark',
  }
})

const h = vi.hoisted(() => ({
  evidence: {
    posture: { ok: false, error: 'Could not load' },
    scans: { ok: true, data: [] },
    breakGlass: { ok: true, data: [] },
    accessReviews: { ok: true, data: [] },
    seals: { ok: true, data: [] },
    backups: { ok: true, data: [] },
    consoleSessions: { ok: true, data: [] },
    config: { ok: true, data: { password_min_length: '12' } },
    attestations: { ok: true, data: [] },
  },
}))

vi.mock('../lib/api/compliance', () => ({
  loadComplianceEvidence: vi.fn(() => Promise.resolve(h.evidence)),
  attestControl: vi.fn(() => Promise.resolve('id')),
  withdrawAttestation: vi.fn(() => Promise.resolve(true)),
}))

import ConsoleCompliance from '../console/pages/ConsoleCompliance'

afterEach(cleanup)

describe('ConsoleCompliance', () => {
  it('renders, flags the failed source, and marks posture controls as could not check', async () => {
    render(<ConsoleCompliance />)
    expect(await screen.findByText(/Compliance Center/)).toBeTruthy()
    expect(screen.getByText(/could not be loaded: Security posture/)).toBeTruthy()
    expect(screen.getAllByText('Could not check').length).toBeGreaterThan(0)
    expect(screen.getByText('Row level security on every table')).toBeTruthy()
  })

  it('opens the attestation drawer for a manual control', async () => {
    render(<ConsoleCompliance />)
    await screen.findByText(/Compliance Center/)
    fireEvent.click(screen.getAllByText('Leaked password protection')[0])
    expect(await screen.findByText('Attest control')).toBeTruthy()
  })
})

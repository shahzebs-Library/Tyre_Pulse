import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CaseCompletionPanel from '../components/accidents/CaseCompletionPanel'

// Smoke test for the wiring: the panel is mounted with `caseData={caseData || acc}`
// in the accident Overview tab. It must render honestly from BOTH a bare accidents
// row (pre-V417, when loadCase degraded to null and the fallback passes `acc`) and a
// full loadCase() result carrying capabilities.casesModel === false — and never throw.
// The engine is exercised for real (no mock) so this also guards the view-model.

describe('CaseCompletionPanel renders in the Overview tab', () => {
  it('renders completion + closure from a bare accidents-like row without throwing', () => {
    const acc = {
      id: 'a1',
      asset_no: 'TM100',
      severity: 'minor',
      status: 'reported',
      accident_type: 'collision',
      country: 'KSA',
      incident_date: '2026-01-10',
    }
    expect(() => render(<CaseCompletionPanel caseData={acc} />)).not.toThrow()
    // Header, the overall summary row, and the closure gate section all render.
    expect(screen.getByText('Case completion')).toBeInTheDocument()
    expect(screen.getByText('Overall')).toBeInTheDocument()
    expect(screen.getByText('Blocking full closure')).toBeInTheDocument()
  })

  it('renders from a loadCase() shape with casesModel:false and empty workstreams', () => {
    const caseData = {
      id: 'a2',
      asset_no: 'TM200',
      severity: 'moderate',
      status: 'under_review',
      accident_type: 'rollover',
      country: 'UAE',
      incident_date: '2026-02-01',
      workstreams: [],
      tasks: [],
      approvals: [],
      pending_approvals: [],
      closureReviews: [],
      capabilities: { casesModel: false },
    }
    expect(() => render(<CaseCompletionPanel caseData={caseData} />)).not.toThrow()
    expect(screen.getByText('Case completion')).toBeInTheDocument()
    // All five completion dimensions render (four detail rows + overall summary).
    expect(screen.getByText('Incident & Evidence')).toBeInTheDocument()
    expect(screen.getByText('Insurance & Claim')).toBeInTheDocument()
    expect(screen.getByText('Repair')).toBeInTheDocument()
    expect(screen.getByText('Finance & Settlement')).toBeInTheDocument()
    expect(screen.getByText('Overall')).toBeInTheDocument()
  })

  it('shows the empty state when no case is provided', () => {
    render(<CaseCompletionPanel caseData={null} />)
    expect(screen.getByText('No case selected.')).toBeInTheDocument()
  })
})

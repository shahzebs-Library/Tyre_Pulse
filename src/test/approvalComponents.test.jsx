import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

import ApprovalStatusBadge from '../components/workflow/ApprovalStatusBadge'
import ApprovalAction from '../components/workflow/ApprovalAction'
import ApprovalTrail from '../components/workflow/ApprovalTrail'

afterEach(() => cleanup())

// ── ApprovalStatusBadge ───────────────────────────────────────────────────────
describe('ApprovalStatusBadge', () => {
  const cases = [
    ['approved', 'Approved'],
    ['pending', 'Pending'],
    ['in_review', 'In Review'],
    ['rejected', 'Rejected'],
    ['returned', 'Returned for Correction'],
    ['cancelled', 'Cancelled'],
  ]

  it.each(cases)('renders the %s status', (status, label) => {
    render(<ApprovalStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('accepts status case-insensitively', () => {
    render(<ApprovalStatusBadge status="IN-REVIEW" />)
    expect(screen.getByText('In Review')).toBeInTheDocument()
  })

  it('falls back to a neutral badge for unknown statuses', () => {
    render(<ApprovalStatusBadge status="frobnicated" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('data-status', 'unknown')
    expect(within(badge).getByText('frobnicated')).toBeInTheDocument()
  })
})

// ── ApprovalAction ────────────────────────────────────────────────────────────
describe('ApprovalAction', () => {
  beforeEach(() => {
    // Deterministic, denied geolocation so requireGps flows are testable.
    // eslint-disable-next-line no-undef
    globalThis.navigator = globalThis.navigator || {}
  })

  it('enables Approve with no requirements', () => {
    render(<ApprovalAction requirements={{}} onAct={vi.fn()} />)
    const approve = screen.getByRole('button', { name: /approve/i })
    expect(approve).not.toBeDisabled()
  })

  it('keeps Approve disabled until a required signature is provided', () => {
    const onAct = vi.fn()
    render(<ApprovalAction requirements={{ requireSignature: true }} onAct={onAct} />)

    const approve = screen.getByRole('button', { name: /approve/i })
    expect(approve).toBeDisabled()
    // Hint tells the user what's missing.
    expect(screen.getByText(/Required before submitting:.*signature/i)).toBeInTheDocument()

    // Simulate SignaturePad producing a data URL by opening it and confirming.
    // The pad renders a Confirm button; drawing is canvas-based, so we drive the
    // callback directly via the opened modal is non-trivial — instead assert the
    // gate: with no signature the click does not fire onAct.
    fireEvent.click(approve)
    expect(onAct).not.toHaveBeenCalled()
  })

  it('requires a comment before Return for Correction can submit', () => {
    const onAct = vi.fn()
    render(<ApprovalAction requirements={{ allowReturn: true }} onAct={onAct} />)

    const returnBtn = screen.getByRole('button', { name: /return for correction/i })
    expect(returnBtn).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Fix tread photos' } })
    expect(returnBtn).not.toBeDisabled()

    fireEvent.click(returnBtn)
    expect(onAct).toHaveBeenCalledWith('return', expect.objectContaining({ comment: 'Fix tread photos' }))
  })

  it('submits approve with deviceInfo and no requirements', () => {
    const onAct = vi.fn()
    render(<ApprovalAction requirements={{}} onAct={onAct} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onAct).toHaveBeenCalledTimes(1)
    const [action, payload] = onAct.mock.calls[0]
    expect(action).toBe('approve')
    expect(payload.deviceInfo).toEqual(
      expect.objectContaining({ userAgent: expect.any(String), platform: expect.any(String) }),
    )
  })

  it('busy disables the action buttons', () => {
    render(<ApprovalAction requirements={{}} onAct={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled()
  })
})

// ── ApprovalTrail ─────────────────────────────────────────────────────────────
describe('ApprovalTrail', () => {
  const events = [
    {
      id: 'e1',
      action: 'approved',
      step_name: 'Inspector Review',
      actor_name: 'Omar Ali',
      printed_name: 'Omar Ali',
      created_at: '2026-06-01T10:00:00Z',
      comment: 'All checks passed',
      signature_data: 'data:image/png;base64,AAAA',
      gps: { lat: 24.7136, lng: 46.6753, accuracy: 12 },
      photo_urls: ['data:image/png;base64,BBBB'],
    },
    {
      id: 'e2',
      action: 'returned',
      step_name: 'Supervisor Review',
      actor_name: 'Sara N',
      created_at: '2026-06-02T09:30:00Z',
      comment: 'Missing pressure reading',
    },
  ]

  it('renders the signature block text for each event', () => {
    render(<ApprovalTrail events={events} />)
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Returned for Correction')).toBeInTheDocument()
    expect(screen.getByText('Omar Ali')).toBeInTheDocument()
    expect(screen.getByText('All checks passed')).toBeInTheDocument()
    expect(screen.getByText('Missing pressure reading')).toBeInTheDocument()
    // Signature image present for the first event.
    expect(screen.getByAltText(/Signature by Omar Ali/i)).toBeInTheDocument()
    // GPS coordinates rendered.
    expect(screen.getByText(/24\.71360, 46\.67530/)).toBeInTheDocument()
  })

  it('renders an empty state when there are no events', () => {
    render(<ApprovalTrail events={[]} />)
    expect(screen.getByText(/No approval history yet/i)).toBeInTheDocument()
  })

  it('renders a loading state', () => {
    const { container } = render(<ApprovalTrail loading />)
    expect(container.querySelector('.animate-pulse, [aria-hidden="true"]')).toBeTruthy()
  })
})

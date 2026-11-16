import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const db = vi.hoisted(() => ({ rows: {}, errors: {}, rpc: vi.fn() }))
vi.mock('../lib/api/_client', () => {
  const builder = (table) => {
    const b = { select: () => b, in: () => b, order: () => b, limit: () => Promise.resolve({ data: db.rows[table] ?? [], error: db.errors[table] ?? null }) }
    return b
  }
  return {
    supabase: { from: (t) => builder(t), rpc: (...a) => db.rpc(...a) },
    isNotProvisioned: (e) => e?.code === '42P01',
    toServiceError: (e, f) => new Error(f),
  }
})

import { listSerialReadings, reviewSerialReading } from '../lib/api/aiTyreSerial'
import { serialReviewState, serialSummary, decisionNeedsSerial } from '../lib/aiTyreSerial'
import SerialReviewBlock from '../components/aiInspection/SerialReviewBlock'

const reading = (o = {}) => ({ id: 'r1', job_id: 'j1', normalized: 'YMA553?2', source: 'moulded', confidence: 'medium', status: 'partial',
  outcome: 'ambiguous', needs_review: true, registered_serials: ['YMA55312'], canonical_position: 'RHCO', ...o })

beforeEach(() => { db.rows = {}; db.errors = {}; db.rpc.mockReset() })
afterEach(cleanup)

describe('serial client helpers', () => {
  it('pending until a decision event exists', () => {
    expect(serialReviewState(reading(), [])).toMatchObject({ pending: true, decided: false })
    const ev = [{ reading_id: 'r1', decision: 'record_correct', created_at: '2026-11-16T09:00:00Z' }]
    expect(serialReviewState(reading(), ev)).toMatchObject({ pending: false, decided: true })
    expect(serialReviewState(reading({ outcome: 'match', needs_review: false }), [])).toMatchObject({ pending: false })
    expect(serialReviewState(null)).toEqual({ pending: false, decided: false, latest: null })
  })
  it('summary keeps ? and says nothing readable for unreadable', () => {
    expect(serialSummary(reading())).toContain('YMA553?2')
    expect(serialSummary(reading({ normalized: null, status: 'unreadable', source: 'none' }))).toContain('nothing readable')
  })
  it('only the other-tyre decision asks for a serial', () => {
    expect(decisionNeedsSerial('photo_shows_other_tyre')).toBe(true)
    expect(decisionNeedsSerial('record_correct')).toBe(false)
  })
})

describe('serial API', () => {
  it('missing table (migration not applied) => empty, provisioned false, no throw', async () => {
    db.errors.ai_tyre_serial_readings = { code: '42P01' }
    await expect(listSerialReadings(['i1'])).resolves.toEqual({ readings: [], events: [], provisioned: false })
  })
  it('other errors throw a clean message', async () => {
    db.errors.ai_tyre_serial_readings = { code: '42501' }
    await expect(listSerialReadings(['i1'])).rejects.toThrow('Could not load serial readings')
  })
  it('reads readings and their events; no ids => no query', async () => {
    db.rows.ai_tyre_serial_readings = [reading()]
    db.rows.ai_tyre_serial_review_events = [{ id: 'e1', reading_id: 'r1' }]
    const res = await listSerialReadings(['i1'])
    expect(res.readings).toHaveLength(1); expect(res.events).toHaveLength(1)
    await expect(listSerialReadings([])).resolves.toEqual({ readings: [], events: [], provisioned: true })
  })
  it('decision goes through the RPC only', async () => {
    db.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await reviewSerialReading('r1', 'dismissed', '', 'wrong photo')
    expect(db.rpc).toHaveBeenCalledWith('ai_tyre_serial_review', { p_reading: 'r1', p_decision: 'dismissed', p_serial: null, p_note: 'wrong photo' })
  })
})

describe('SerialReviewBlock', () => {
  it('renders nothing without a reading (feature off)', () => {
    const { container } = render(<SerialReviewBlock reading={undefined} events={[]} mayReview />)
    expect(container.innerHTML).toBe('')
  })
  it('non-reviewer sees the result and a waiting note, no controls', () => {
    render(<SerialReviewBlock reading={reading()} events={[]} mayReview={false} />)
    expect(screen.getByText(/YMA553\?2/)).toBeTruthy()
    expect(screen.getByText(/Waiting for a supervisor/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('reviewer must give a reason (and a serial for other-tyre) before saving', async () => {
    db.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    const onDecided = vi.fn()
    render(<SerialReviewBlock reading={reading()} events={[]} mayReview onDecided={onDecided} />)
    const btn = screen.getByRole('button', { name: /Record serial decision/ })
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Serial decision/), { target: { value: 'photo_shows_other_tyre' } })
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Different tyre fitted' } })
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Serial you can see/), { target: { value: 'YMA55399' } })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(onDecided).toHaveBeenCalled())
    expect(db.rpc).toHaveBeenCalledWith('ai_tyre_serial_review', expect.objectContaining({ p_serial: 'YMA55399' }))
  })
})

import { describe, it, expect } from 'vitest'
import {
  receiptMissing, canSignAndAccept, receiptMissingLabels, RECEIPT_FIELD_LABELS,
  liveStatusLabel, transitElapsedMs, vendorSlaChip, STEPPER_KEYS,
} from '../lib/handoverGating'
import { RECEIPT_REQUIRED, DISPATCH_STEPPER } from '../lib/accidentCaseVocab'

const COMPLETE = {
  arrived_at: '2026-09-16T10:00:00Z',
  received_by_name: 'A. Receiver',
  received_by_designation: 'Workshop supervisor',
  receiving_photos: ['https://x/1.jpg'],
  handover_paper_ref: 'https://x/paper.pdf',
  receiver_signature: 'data:image/png;base64,AAAA',
  custody_accepted: true,
}

describe('receiptMissing / canSignAndAccept', () => {
  it('reports EVERY required key missing for an absent row', () => {
    expect(receiptMissing(null)).toEqual(RECEIPT_REQUIRED)
    expect(canSignAndAccept(undefined)).toBe(false)
  })

  it('is complete only when every RECEIPT_REQUIRED key is present', () => {
    expect(receiptMissing(COMPLETE)).toEqual([])
    expect(canSignAndAccept(COMPLETE)).toBe(true)
  })

  it('treats an empty photo list, blank strings and a false checkbox as missing', () => {
    expect(receiptMissing({ ...COMPLETE, receiving_photos: [] })).toEqual(['receiving_photos'])
    expect(receiptMissing({ ...COMPLETE, received_by_name: '   ' })).toEqual(['received_by_name'])
    expect(receiptMissing({ ...COMPLETE, custody_accepted: false })).toEqual(['custody_accepted'])
    expect(canSignAndAccept({ ...COMPLETE, receiver_signature: null })).toBe(false)
  })

  it('every required key has a mock label and the labels follow RECEIPT_REQUIRED order', () => {
    for (const k of RECEIPT_REQUIRED) expect(RECEIPT_FIELD_LABELS[k]).toBeTruthy()
    expect(receiptMissingLabels({ ...COMPLETE, arrived_at: null, custody_accepted: false }))
      .toEqual(['Arrived date/time', 'Custody acceptance'])
  })
})

describe('liveStatusLabel', () => {
  it('maps tokens to mock labels and blanks/unknowns to Not set', () => {
    expect(liveStatusLabel('in_transit')).toBe('In transit')
    expect(liveStatusLabel('accepted')).toBe('Accepted')
    expect(liveStatusLabel('')).toBe('Not set')
    expect(liveStatusLabel('bogus')).toBe('Not set')
  })
})

describe('transitElapsedMs', () => {
  const dep = '2026-09-16T08:00:00Z'
  it('is null with no departure (never 0)', () => {
    expect(transitElapsedMs(null)).toBeNull()
    expect(transitElapsedMs({ arrived_at: dep })).toBeNull()
  })
  it('runs from departure to now while in transit, and stops at arrival', () => {
    const now = Date.parse('2026-09-16T09:08:00Z')
    expect(transitElapsedMs({ departure_at: dep }, now)).toBe(68 * 60000)
    expect(transitElapsedMs({ departure_at: dep, arrived_at: '2026-09-16T08:30:00Z' }, now)).toBe(30 * 60000)
  })
  it('never goes negative for a future departure', () => {
    expect(transitElapsedMs({ departure_at: '2026-09-16T10:00:00Z' }, Date.parse('2026-09-16T09:00:00Z'))).toBe(0)
  })
})

describe('vendorSlaChip', () => {
  const now = Date.parse('2026-09-16T12:00:00Z')
  const running = [{ workstream_key: 'repair', state: 'running', due_at: '2026-09-16T14:00:00Z' }]
  it('is Not started until custody is accepted, whatever timers exist', () => {
    expect(vendorSlaChip(null, running, now)).toEqual({ label: 'Not started', tone: 'neutral' })
    expect(vendorSlaChip({ custody_accepted: false }, running, now).label).toBe('Not started')
  })
  it('reads the repair timer once accepted and is honest with no timer', () => {
    expect(vendorSlaChip({ custody_accepted: true }, [], now)).toEqual({ label: 'No timer', tone: 'neutral' })
    const chip = vendorSlaChip({ custody_accepted: true }, running, now)
    expect(chip.label).toBe('Running')
    expect(chip.remainingMs).toBe(2 * 3600000)
    expect(vendorSlaChip({ custody_accepted: true }, [{ ...running[0], due_at: '2026-09-16T11:00:00Z' }], now).label).toBe('Overdue')
    expect(vendorSlaChip({ custody_accepted: true }, [{ ...running[0], state: 'met' }], now).label).toBe('Met')
  })
  it('ignores timers belonging to other workstreams', () => {
    expect(vendorSlaChip({ custody_accepted: true }, [{ workstream_key: 'insurance', state: 'running', due_at: '2026-09-16T14:00:00Z' }], now).label).toBe('No timer')
  })
})

describe('STEPPER_KEYS', () => {
  it('mirrors DISPATCH_STEPPER in mock order', () => {
    expect(STEPPER_KEYS).toEqual(DISPATCH_STEPPER.map((s) => s.key))
    expect(STEPPER_KEYS).toEqual(['dispatched', 'arrived', 'signed_acceptance', 'vendor_assessment'])
  })
})

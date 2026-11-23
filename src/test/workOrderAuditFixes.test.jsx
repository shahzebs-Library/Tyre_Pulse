import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: k => k, lang: 'en' }),
}))

const { default: JobCardForm, fieldId, isFieldRequired } = await import('../components/workorders/JobCardForm')
const { default: JobCardFlow, gapMissingReason } = await import('../components/workorders/JobCardFlow')
const { editableFields } = await import('../lib/jobCard')
const { toUserMessage } = await import('../lib/safeError')

const VALID = { asset_no: 'TM100', status: 'New', priority: 'Medium', work_type: 'Repair', opened_at: '2026-08-20T06:00', parts_used: [] }

function renderForm(mode = 'create') {
  return render(
    <JobCardForm value={VALID} onChange={() => {}} row={null} mode={mode}
      onSave={() => {}} onCancel={() => {}} />,
  )
}

describe('job card form label association', () => {
  it('every editable catalog field is reachable by its visible label', () => {
    renderForm()
    for (const f of editableFields()) {
      const el = document.getElementById(fieldId(f.key))
      expect(el, f.key).not.toBeNull()
      const label = document.querySelector(`label[for="${fieldId(f.key)}"]`)
      expect(label, f.key).not.toBeNull()
    }
    expect(screen.getByLabelText(/^Asset Code/)).toBeTruthy()
  })

  it('parts row inputs have accessible names', () => {
    renderForm()
    expect(screen.getByLabelText('Part name')).toBeTruthy()
    expect(screen.getByLabelText('Qty')).toBeTruthy()
    expect(screen.getByLabelText('Unit cost')).toBeTruthy()
  })
})

describe('Job Card No required marker', () => {
  const f = { key: 'work_order_no', required: true }
  it('is not required on create (the app generates the number)', () => {
    expect(isFieldRequired(f, 'create')).toBe(false)
    renderForm('create')
    const label = document.querySelector(`label[for="${fieldId('work_order_no')}"]`)
    expect(label.textContent).not.toContain('*')
    expect(document.getElementById(fieldId('work_order_no')).getAttribute('aria-required')).toBeNull()
  })
  it('is required on edit; other required fields stay required', () => {
    expect(isFieldRequired(f, 'edit')).toBe(true)
    expect(isFieldRequired({ key: 'asset_no', required: true }, 'create')).toBe(true)
    expect(isFieldRequired({ key: 'rfr_no' }, 'edit')).toBe(false)
  })
})

describe('statement timeout message is neutral', () => {
  it('does not tell the user to try a smaller file', () => {
    const msg = toUserMessage({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(msg).toBe('The server took too long to answer. Try again in a moment.')
    expect(msg).not.toMatch(/file/i)
  })
})

describe('availability flow: tile agrees with the stepper', () => {
  const NOW = Date.parse('2026-11-22T22:22:00Z')
  // started_at stamped seconds AFTER the drawer clock (the live bug).
  const row = { status: 'In Progress', started_at: new Date(NOW + 30000).toISOString() }

  it('does not claim Workshop In was never recorded when it was', () => {
    render(<JobCardFlow row={row} now={NOW} />)
    expect(screen.queryByText('Workshop In was never recorded.')).toBeNull()
    expect(screen.getByText(/Just started/)).toBeTruthy()
  })

  it('reason helper covers missing, future and closed-without-end', () => {
    expect(gapMissingReason({}, 'started_at', 'Workshop Out', 'Workshop In was never recorded.', NOW))
      .toBe('Workshop In was never recorded.')
    expect(gapMissingReason(row, 'started_at', 'Workshop Out', 'x', NOW)).toMatch(/Just started/)
    const closed = { status: 'Cancelled', started_at: new Date(NOW - 3600000).toISOString() }
    expect(gapMissingReason(closed, 'started_at', 'Workshop Out', 'x', NOW))
      .toBe('Workshop Out was never recorded and the card is closed.')
  })

  it('a start before the clock still measures a running duration', () => {
    const r = { status: 'In Progress', started_at: new Date(NOW - 2 * 3600000).toISOString() }
    render(<JobCardFlow row={r} now={NOW} />)
    expect(screen.getAllByText('2h').length).toBeGreaterThan(0)
  })
})


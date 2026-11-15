/**
 * An acknowledged sheet was signed with the fault recorded on purpose, so the
 * viewer must not tell the reader to correct it, send it back, or that it
 * "cannot be closed". Every sentence comes from closure.blocking in en and ar.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import en from '../locales/en/closure.json'
import ar from '../locales/ar/closure.json'

const lang = vi.hoisted(() => ({ current: 'en' }))
vi.mock('../contexts/LanguageContext', async () => {
  const dicts = { en: (await import('../locales/en/closure.json')).default, ar: (await import('../locales/ar/closure.json')).default }
  const t = (key, vars = {}) => {
    const path = key.replace(/^closure\./, '').split('.')
    let v = dicts[lang.current]
    for (const p of path) v = v?.[p]
    return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : key
  }
  return { useLanguage: () => ({ t, language: lang.current }) }
})

const marks = vi.hoisted(() => ({ blocking: [{ id: 'brakes', label: 'Brakes', value: 'Not OK' }] }))
vi.mock('../lib/checklist/checklistMarks', () => ({
  canClose: () => ({ ok: false, blocking: marks.blocking }),
}))

import BlockingMarksNotice, {
  blockingStatus, STATUS_OPEN, STATUS_ACKNOWLEDGED, STATUS_RESOLVED, STATUS_EXCEPTION,
} from '../components/checklist/BlockingMarksNotice'

const B = en.blocking
const ACK = { approval_status: 'acknowledged' }
const EXC = { approval_status: 'acknowledged', ack_fault_state: 'exception' }
const RES = { approval_status: 'acknowledged', ack_fault_state: 'fault_resolved' }

describe('blockingStatus', () => {
  it('a sheet still in approval is open', () => {
    expect(blockingStatus(null)).toBe(STATUS_OPEN)
    expect(blockingStatus({ approval_status: 'pending' })).toBe(STATUS_OPEN)
    expect(blockingStatus({ approval_status: 'pending_area_manager' })).toBe(STATUS_OPEN)
  })
  it('acknowledged, resolved and exception are told apart', () => {
    expect(blockingStatus(ACK)).toBe(STATUS_ACKNOWLEDGED)
    expect(blockingStatus({ ...ACK, ack_fault_state: 'fault_open' })).toBe(STATUS_ACKNOWLEDGED)
    expect(blockingStatus(EXC)).toBe(STATUS_EXCEPTION)
    expect(blockingStatus(RES)).toBe(STATUS_RESOLVED)
  })
})

describe('BlockingMarksNotice', () => {
  it('keeps "cannot be closed" and the correction advice for a sheet in approval', () => {
    lang.current = 'en'
    marks.blocking = [{ id: 'brakes', label: 'Brakes', value: 'Not OK' }]
    render(<BlockingMarksNotice template={{}} answers={{}} />)
    expect(screen.getByText(B.openOne)).toBeTruthy()
    expect(screen.getByText(B.hintOpen)).toBeTruthy()
  })
  it('an acknowledged sheet never says "cannot be closed" or "send the sheet back"', () => {
    lang.current = 'en'
    render(<BlockingMarksNotice template={{}} answers={{}} submission={ACK} />)
    expect(screen.queryByText(/cannot be closed/i)).toBeNull()
    expect(screen.queryByText(/send the sheet back/i)).toBeNull()
    expect(screen.getByText(B.acknowledgedOne)).toBeTruthy()
    expect(screen.getByText(B.hintAcknowledged)).toBeTruthy()
  })
  it('compliant by exception names the exception in heading and hint', () => {
    lang.current = 'en'
    const { container } = render(<BlockingMarksNotice template={{}} answers={{}} submission={EXC} />)
    expect(screen.queryByText(/cannot be closed/i)).toBeNull()
    expect(screen.getByText(B.exceptionOne)).toBeTruthy()
    expect(screen.getByText('Closed by an approved exception.')).toBeTruthy()
    expect(container.querySelector('[data-status="exception"]')).toBeTruthy()
  })
  it('resolved says so, and counts several lines', () => {
    lang.current = 'en'
    marks.blocking = [{ id: 'a', label: 'Brakes', value: 'Not OK' }, { id: 'b', label: 'Lights', value: 'Not OK' }]
    render(<BlockingMarksNotice template={{}} answers={{}} submission={RES} />)
    expect(screen.getByText(B.resolvedMany.replace('{n}', '2'))).toBeTruthy()
    expect(screen.getByText(B.hintResolved)).toBeTruthy()
    marks.blocking = [{ id: 'brakes', label: 'Brakes', value: 'Not OK' }]
  })
  it('renders the Arabic sentences', () => {
    lang.current = 'ar'
    render(<BlockingMarksNotice template={{}} answers={{}} submission={ACK} />)
    expect(screen.getByText(ar.blocking.acknowledgedOne)).toBeTruthy()
    expect(screen.getByText(ar.blocking.hintAcknowledged)).toBeTruthy()
    lang.current = 'en'
  })
})

describe('closure.blocking strings', () => {
  it('exist in both languages, carry the {n} placeholder, and use no dashes', () => {
    expect(Object.keys(ar.blocking).sort()).toEqual(Object.keys(en.blocking).sort())
    for (const k of Object.keys(en.blocking)) {
      for (const d of [en.blocking, ar.blocking]) {
        expect(typeof d[k]).toBe('string')
        expect(/[–—]/.test(d[k])).toBe(false)
        if (k.endsWith('Many')) expect(d[k]).toContain('{n}')
      }
    }
    expect(/[؀-ۿ]/.test(ar.blocking.openOne)).toBe(true)
  })
})

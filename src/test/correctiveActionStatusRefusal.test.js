import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }))

import { updateCorrectiveAction, actionWriteError, CLOSURE_STATUS_REFUSALS } from '../lib/api/correctiveActions'
import { toUserMessage } from '../lib/safeError'
import { closureText, MESSAGE_KEYS } from '../lib/closureText'

const PENDING = 'An exception has been requested on this action. Approve or refuse the exception first.'

function updateReturning(result) {
  const b = { update: () => b, eq: () => Promise.resolve(result) }
  return b
}

beforeEach(() => { h.from.mockReset() })

describe('D4: closing an action while an exception is pending', () => {
  it('shows the waiting-for-exception sentence, not "This record changed"', async () => {
    h.from.mockReturnValue(updateReturning({ data: null, error: { code: 'PT409', message: PENDING } }))
    const err = await updateCorrectiveAction('a1', { status: 'Closed' }).catch((e) => e)
    const shown = toUserMessage(err, 'The status could not be changed.')
    expect(shown).toBe(PENDING)
    expect(shown).not.toMatch(/changed since you opened it/)
    expect(err.cause.code).toBe('PT409')
  })
  it('the sentence has an Arabic key', () => {
    expect(MESSAGE_KEYS[PENDING]).toBe('exceptionPendingClose')
    const t = (k) => (k === 'closure.msg.exceptionPendingClose' ? 'AR' : k)
    expect(closureText(t, PENDING)).toBe('AR')
  })
  it('any other database error is still sanitised', () => {
    const raw = { code: 'PT409', message: 'row changed in relation corrective_actions' }
    expect(toUserMessage(actionWriteError(raw))).toBe('This record changed since you opened it. Refresh and try again.')
    expect(toUserMessage(actionWriteError({ code: '42501', message: 'permission denied for table corrective_actions' })))
      .toBe('You do not have permission to do that.')
  })
  it('every passed-through sentence is free of schema words', () => {
    for (const s of CLOSURE_STATUS_REFUSALS) expect(s).not.toMatch(/relation|column|constraint|policy|table|schema/i)
  })
  it('a successful update returns without throwing', async () => {
    h.from.mockReturnValue(updateReturning({ data: [], error: null }))
    await expect(updateCorrectiveAction('a1', { status: 'Open' })).resolves.toEqual([])
  })
})

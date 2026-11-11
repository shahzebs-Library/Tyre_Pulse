import { describe, expect, it } from 'vitest'
import { signerDisplay } from '../lib/signerDisplay'

describe('signerDisplay', () => {
  it('renders Full Name (EMP-ID) when both are present', () => {
    expect(signerDisplay({ full_name: 'Anum Shah', employee_id: 'EMP-42' })).toBe('Anum Shah (EMP-42)')
  })

  it('renders the name alone when there is no employee id', () => {
    expect(signerDisplay({ full_name: 'Anum Shah' })).toBe('Anum Shah')
    expect(signerDisplay({ full_name: 'Anum Shah', employee_id: '' })).toBe('Anum Shah')
  })

  it('never shows a raw UUID, as a name or as a fallback', () => {
    expect(signerDisplay({ id: '11111111-2222-4333-8444-555555555555' })).toBe('Not recorded')
    // a canonical uuid passed as the free-text name is dropped too
    expect(signerDisplay({ name: '550e8400-e29b-41d4-a716-446655440000' })).toBe('Not recorded')
    expect(signerDisplay({ full_name: '550e8400-e29b-41d4-a716-446655440000' })).toBe('Not recorded')
  })

  it('never uses the login email as the primary identity', () => {
    // email only -> fallback, not the email
    const out = signerDisplay({ email: 'ws123na@gmail.com', approver_email: 'ws123na@gmail.com' })
    expect(out).toBe('Not recorded')
    expect(out).not.toContain('@')
    // an email that leaked into the free-text name field is also rejected
    expect(signerDisplay({ name: 'ws123na@gmail.com' })).toBe('Not recorded')
    // a real name alongside an email wins, and the email is never appended
    expect(signerDisplay({ full_name: 'Anum Shah', email: 'ws123na@gmail.com', employee_id: 'EMP-42' }))
      .toBe('Anum Shah (EMP-42)')
  })

  it('falls back to username (never an email/uuid username) before giving up', () => {
    expect(signerDisplay({ username: 'ashah' })).toBe('ashah')
    expect(signerDisplay({ username: 'ashah', employee_id: 'EMP-7' })).toBe('ashah (EMP-7)')
    expect(signerDisplay({ username: 'ws123na@gmail.com' })).toBe('Not recorded')
  })

  it('uses the free-text name when there is no full_name', () => {
    expect(signerDisplay({ name: 'Ali', employee_id: 'EMP-9' })).toBe('Ali (EMP-9)')
  })

  it('returns the fallback for empty or non-object input', () => {
    expect(signerDisplay(null)).toBe('Not recorded')
    expect(signerDisplay({})).toBe('Not recorded')
    expect(signerDisplay(undefined, { fallback: null })).toBeNull()
    expect(signerDisplay({})).toBe('Not recorded')
  })
})

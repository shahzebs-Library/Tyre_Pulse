import { describe, it, expect } from 'vitest'
import { auditActor, normalizeRow } from '../lib/api/auditTrail'

/**
 * The audit trail's job is to answer "who did this". 485,231 of 499,217 rows had
 * no user_id, so an automated import and an untraceable human edit rendered
 * IDENTICALLY as a blank - opposite facts for anyone investigating an incident.
 * These pin that each case now states what it actually is, and that a row we
 * cannot attribute is never dressed up as one we can.
 */
describe('auditActor', () => {
  it('names the person for a real signed-in write', () => {
    expect(auditActor({ actor_type: 'user', user_email: 'a@b.com', user_id: 'u1' })).toBe('a@b.com')
  })

  it('names a service write as a machine, with its label', () => {
    expect(auditActor({ actor_type: 'service', actor_detail: 'postgres / ERP import' }))
      .toBe('System (postgres / ERP import)')
    expect(auditActor({ actor_type: 'service' })).toBe('System')
  })

  it('makes a genuinely unattributable write STAND OUT', () => {
    // this is the row that should worry someone - it must not read like the
    // 440k routine import rows it used to be buried among
    expect(auditActor({ actor_type: 'unknown', actor_detail: 'authenticator' }))
      .toBe('Unknown (authenticator)')
  })

  it('admits a pre-V499 row is not recoverable rather than guessing', () => {
    expect(auditActor({})).toBe('Not recorded (before audit attribution)')
    // a legacy row that DID capture an email still shows it
    expect(auditActor({ user_email: 'old@b.com' })).toBe('old@b.com')
  })

  it('treats a legacy row carrying a user_id as a user', () => {
    expect(auditActor({ user_id: 'u9', user_email: 'x@y.com' })).toBe('x@y.com')
  })
})

describe('normalizeRow carries the actor type through', () => {
  it('exposes actorType so the viewer can style a machine differently', () => {
    const row = normalizeRow('audit_log_v2', {
      id: '1', created_at: '2026-08-10', action: 'db.update',
      actor_type: 'service', actor_detail: 'postgres / ERP import',
    })
    expect(row.actorType).toBe('service')
    expect(row.actor).toBe('System (postgres / ERP import)')
  })

  it('labels a pre-attribution row as legacy, not as a user', () => {
    const row = normalizeRow('audit_log_v2', { id: '2', action: 'db.insert' })
    expect(row.actorType).toBe('legacy')
  })
})

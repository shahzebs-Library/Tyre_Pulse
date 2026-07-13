import { describe, it, expect } from 'vitest'
import { toUserMessage, logAndMessage, DEFAULT_FALLBACK } from '../lib/safeError'

// ─────────────────────────────────────────────────────────────────────────────
// safeError.toUserMessage — never leaks raw backend/PostgREST error detail,
// maps known Postgres codes to fixed generic strings, detects permission/RLS
// and network failures, and lets our own short validation errors through.
// ─────────────────────────────────────────────────────────────────────────────
describe('toUserMessage — Postgres code mappings', () => {
  it('maps 23505 (unique_violation) to a generic duplicate message', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "vehicles_vin_key"' }
    expect(toUserMessage(err, 'fb')).toBe('A record with these details already exists.')
  })

  it('maps 23503 (foreign_key_violation) to a generic reference message', () => {
    const err = { code: '23503', message: 'insert or update on table "tyres" violates foreign key constraint' }
    expect(toUserMessage(err, 'fb')).toBe('This action references a record that no longer exists.')
  })

  it('maps 23514 (check_violation) to a generic invalid-values message', () => {
    const err = { code: '23514', message: 'new row for relation "inspections" violates check constraint' }
    expect(toUserMessage(err, 'fb')).toBe('Some values are not valid.')
  })

  it('maps 42501 (insufficient_privilege) to a permission message', () => {
    const err = { code: '42501', message: 'permission denied for table work_orders' }
    expect(toUserMessage(err, 'fb')).toBe('You do not have permission to do that.')
  })

  it('maps PGRST116 (no rows) to a not-found message', () => {
    const err = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
    expect(toUserMessage(err, 'fb')).toBe('Not found.')
  })

  it('accepts a numeric-style code coerced to string', () => {
    const err = { code: 23505 }
    expect(toUserMessage(err, 'fb')).toBe('A record with these details already exists.')
  })
})

describe('toUserMessage — textual permission / RLS detection', () => {
  it('detects row-level security failures without a code', () => {
    const err = new Error('new row violates row-level security policy for table "alerts"')
    expect(toUserMessage(err, 'fb')).toBe('You do not have permission to do that.')
  })

  it('detects "permission denied" text without a code', () => {
    const err = new Error('permission denied for relation audit_logs')
    expect(toUserMessage(err, 'fb')).toBe('You do not have permission to do that.')
  })
})

describe('toUserMessage — network detection', () => {
  it('maps a "Failed to fetch" transport error to a network message', () => {
    const err = new TypeError('Failed to fetch')
    expect(toUserMessage(err, 'fb')).toBe('Network error — check your connection.')
  })

  it('maps a generic network error to a network message', () => {
    const err = new Error('NetworkError when attempting to fetch resource')
    expect(toUserMessage(err, 'fb')).toBe('Network error — check your connection.')
  })
})

describe('toUserMessage — never leaks unknown backend errors', () => {
  it('returns the fallback for a DB-shaped error with an unmapped code', () => {
    const err = { code: '42P01', message: 'relation "secret_table" does not exist' }
    expect(toUserMessage(err, 'Could not load data.')).toBe('Could not load data.')
  })

  it('returns the fallback for a code-less message containing DB markers', () => {
    const err = new Error('column "salary" does not exist')
    expect(toUserMessage(err, 'Could not load data.')).toBe('Could not load data.')
  })
})

describe('toUserMessage — own validation passthrough & fallback', () => {
  it('passes through a short, code-less validation error message', () => {
    const err = new Error('Quantity must be greater than zero.')
    expect(toUserMessage(err, 'fb')).toBe('Quantity must be greater than zero.')
  })

  it('uses the default fallback when err is null', () => {
    expect(toUserMessage(null)).toBe(DEFAULT_FALLBACK)
  })

  it('uses the provided fallback for an over-long code-less message', () => {
    const err = new Error('x'.repeat(500))
    expect(toUserMessage(err, 'Custom fallback.')).toBe('Custom fallback.')
  })

  it('logAndMessage returns the same safe message and never throws', () => {
    const err = { code: '23505' }
    expect(() => logAndMessage(err, 'fb')).not.toThrow()
    expect(logAndMessage(err, 'fb')).toBe('A record with these details already exists.')
  })
})

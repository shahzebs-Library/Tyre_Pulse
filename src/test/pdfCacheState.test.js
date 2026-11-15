// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  backoffMs, afterFailure, effectiveState, displayStatus, reasonMessage, STATUSES, MAX_ATTEMPTS, REASON_MESSAGES,
} from '../lib/pdfCache/state'
import { resolveBulkLimit, uniqueName, manifestCsv, BULK_LIMITS } from '../lib/pdfCache/bulkZip'

const SQL = readFileSync(fileURLToPath(new URL('../../supabase/pending_migrations/20261117090000_report_pdf_cache.sql', import.meta.url)), 'utf8')

describe('pdf cache job state machine', () => {
  it('backoff doubles from 30 seconds and is capped at one hour', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000])
    expect(backoffMs(20)).toBe(3_600_000)
    expect(backoffMs(0)).toBe(30_000)
  })

  it('retries are bounded: the fifth failure is final', () => {
    let attempts = 0
    const seen = []
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = afterFailure({ attempts })
      attempts = r.attempts
      seen.push(r.status)
    }
    expect(seen).toEqual(['retry_scheduled', 'retry_scheduled', 'retry_scheduled', 'retry_scheduled', 'failed'])
    expect(afterFailure({ attempts: 0, retryable: false }).status).toBe('failed')
    // released without blame (incomplete evidence): queued again, attempt not counted
    expect(afterFailure({ attempts: 2, countAttempt: false })).toEqual({ status: 'queued', attempts: 2, waitMs: 0 })
  })

  it('an abandoned job (expired lease) reads as queued', () => {
    const now = Date.parse('2026-11-15T10:00:00Z')
    expect(effectiveState(null, now)).toBe('missing')
    expect(effectiveState({ status: 'processing', lease_expires_at: '2026-11-15T10:02:00Z' }, now)).toBe('processing')
    expect(effectiveState({ status: 'processing', lease_expires_at: '2026-11-15T09:59:00Z' }, now)).toBe('queued')
    expect(effectiveState({ status: 'ready' }, now)).toBe('ready')
  })

  it('an older stored copy is never labelled current', () => {
    expect(displayStatus({ ok: true, state: 'ready', file: {} }).key).toBe('ready')
    expect(displayStatus({ ok: true, state: 'missing', previous: { id: 'old' } })).toMatchObject({ key: 'update_available', label: 'Update available' })
    expect(displayStatus({ ok: true, state: 'missing', previous: null }).key).toBe('not_prepared')
    expect(displayStatus({ ok: true, state: 'queued', previous: { id: 'old' } }).key).toBe('update_available')
    expect(displayStatus({ ok: true, state: 'processing' }).label).toBe('Preparing')
    expect(displayStatus({ ok: true, state: 'failed' }).label).toBe('Failed')
    expect(displayStatus({ ok: false, reason: 'not_available' }).key).toBe('unavailable')
  })

  it('every refusal the SQL can return has a plain sentence, with no dashes', () => {
    const reasons = new Set([...SQL.matchAll(/'reason', '([a-z_]+)'/g)].map((m) => m[1]))
    expect(reasons.size).toBeGreaterThan(8)
    for (const r of reasons) expect(REASON_MESSAGES[r], r).toBeTruthy()
    for (const text of Object.values(REASON_MESSAGES)) expect(text).not.toMatch(/[–—]/)
    expect(reasonMessage('something_new')).toMatch(/Retry/)
  })

  it('the SQL mirrors the status list, the attempt bound and the backoff', () => {
    for (const s of STATUSES) expect(SQL).toContain(`'${s}'`)
    expect(SQL).toMatch(/max_attempts\s+integer not null default 5/)
    expect(SQL).toContain("interval '30 seconds' * power(2, greatest(v_attempts - 1, 0))")
    expect(SQL).toContain("least(interval '1 hour'")
    expect(SQL).not.toMatch(/errcode\s*=\s*'40001'/)
  })
})

describe('bulk download helpers', () => {
  it('the limit snaps to 10, 50 or 100', () => {
    expect(BULK_LIMITS).toEqual([10, 50, 100])
    expect([undefined, 0, 'x', 5, 10, 49, 50, 99, 100, 5000].map(resolveBulkLimit)).toEqual([50, 50, 50, 10, 10, 10, 50, 50, 100, 100])
  })

  it('two reports with the same name both survive', () => {
    const used = new Set()
    expect(uniqueName('Tyre Insp TM400 EAST 10-Nov-26.pdf', used)).toBe('Tyre Insp TM400 EAST 10-Nov-26.pdf')
    expect(uniqueName('Tyre Insp TM400 EAST 10-Nov-26.pdf', used)).toBe('Tyre Insp TM400 EAST 10-Nov-26 (2).pdf')
    expect(uniqueName('tyre insp tm400 east 10-nov-26.pdf', used)).toBe('tyre insp tm400 east 10-nov-26 (3).pdf')
    expect(uniqueName('a/b\\c:d.pdf', used)).toBe('a b c d.pdf')
  })

  it('the manifest CSV quotes text and cannot carry a spreadsheet formula', () => {
    const csv = manifestCsv([{ record: '=HYPERLINK("x")', source_id: 's1', status: 'missing', reason: 'Not available, "refused"' }])
    const [head, row] = csv.trim().split('\r\n')
    expect(head.split(',')[0]).toBe('record')
    expect(row.startsWith('"\'=HYPERLINK(""x"")",s1,missing,,"Not available, ""refused"""')).toBe(true)
  })
})

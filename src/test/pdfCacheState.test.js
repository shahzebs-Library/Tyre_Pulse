// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  backoffMs, afterFailure, effectiveState, displayStatus, reasonMessage, STATUSES, MAX_ATTEMPTS, REASON_MESSAGES,
} from '../lib/pdfCache/state'
import { resolveBulkLimit, uniqueName, manifestCsv, DEFAULT_BULK_LIMIT, MAX_BULK_LIMIT } from '../lib/pdfCache/bulkZip'

const RETENTION_SQL = readFileSync(fileURLToPath(new URL('../../supabase/pending_migrations/20261117093000_report_pdf_retention_bulk.sql', import.meta.url)), 'utf8')
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
  it('the limit is configurable: any whole number from 1 to 500, 50 when nothing usable is set', () => {
    expect([DEFAULT_BULK_LIMIT, MAX_BULK_LIMIT]).toEqual([50, 500])
    expect([undefined, null, 0, -3, 'x', 1, 5, 25.9, 50, 99, 500, 5000].map(resolveBulkLimit)).toEqual([50, 50, 50, 50, 50, 1, 5, 25, 50, 99, 500, 500])
  })

  it('the server enforces the same range, the 90 day retention minimum and never purges an approved revision', () => {
    expect(SQL).toMatch(/bulk_limit\s+integer check \(bulk_limit is null or bulk_limit between 1 and 500\)/)
    expect(SQL).toMatch(/superseded_retention_days between 90 and 3650/)
    expect(SQL).toContain("'reason', 'retention_below_minimum'")
    expect(SQL).toContain('report_pdf_files_approved_never_purged check (not immutable or (purge_due_at is null and purged_at is null))')
    expect(SQL).toMatch(/manager_regenerate_approved boolean not null default false/)
    // the retention job: marks only, never an approved revision, and is not callable by signed-in users
    expect(RETENTION_SQL).toMatch(/not f\.immutable and not f\.source_approved/)
    expect(RETENTION_SQL).toContain('greatest(90, e.retention_days)')
    expect(RETENTION_SQL).toContain('revoke execute on function public.pdf_cache_retention_run(integer) from authenticated')
    expect(RETENTION_SQL).not.toMatch(/errcode\s*=\s*'40001'/)
    expect(RETENTION_SQL.trim().endsWith('select anum_integration.apply_reader_policies();')).toBe(true)
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

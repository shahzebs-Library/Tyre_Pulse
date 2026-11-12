// @vitest-environment node
// Source-scan guards for the edge functions (they cannot be type-checked or run
// here: deno / esm.sh is not reachable). Each assertion pins one security guard
// so a later edit cannot quietly remove it.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { constantTimeEqual } from '../../supabase/functions/_shared/aiSecurity.ts'

const DIR = 'supabase/functions'
const read = (name, file = 'index.ts') => readFileSync(join(DIR, name, file), 'utf8')
const FUNCTIONS = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
const SOURCES = FUNCTIONS.flatMap((name) => readdirSync(join(DIR, name))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ id: `${name}/${f}`, src: read(name, f) })))

describe('constantTimeEqual (shared secret compare)', () => {
  it('matches only identical non-empty strings', () => {
    expect(constantTimeEqual('abc-123', 'abc-123')).toBe(true)
    expect(constantTimeEqual('abc-123', 'abc-124')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('abcd', 'abc')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(false)
    expect(constantTimeEqual('x', '')).toBe(false)
    expect(constantTimeEqual(null, null)).toBe(false)
    expect(constantTimeEqual(undefined, 'x')).toBe(false)
  })
})

describe('edge functions: shared secrets are never compared with === / !==', () => {
  it('scans every function file', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(18)
  })

  it('no early-exit comparison of a cron / worker secret', () => {
    const bad = /(given|provided)\s*[!=]==\s*(cfg\??\.value|expected|expectedSecret)|(cfg\??\.value|expected|expectedSecret)\s*[!=]==\s*(given|provided)/
    const offenders = SOURCES.filter(({ src }) => bad.test(src)).map(({ id }) => id)
    expect(offenders).toEqual([])
  })

  for (const name of ['embed-worker', 'send-scheduled-reports', 'ai-tyre-inspection']) {
    it(`${name} gates its secret through constantTimeEqual`, () => {
      expect(read(name)).toMatch(/constantTimeEqual\((given|provided), /)
    })
  }
})

describe('edge functions: no backslash-u escapes in source (the deploy tool decodes them)', () => {
  it('none present', () => {
    const offenders = SOURCES.filter(({ src }) => /\\u[0-9a-fA-F]{4}|\\u\{/.test(src)).map(({ id }) => id)
    expect(offenders).toEqual([])
  })
})

describe('send-email: relay limits (API-1)', () => {
  const src = read('send-email')
  it('caps recipients, subject, body, attachment and the whole request', () => {
    for (const token of ['MAX_RECIPIENTS = 20', 'MAX_SUBJECT_LENGTH', 'MAX_BODY_BYTES', 'MAX_ATTACHMENT_BYTES', 'MAX_REQUEST_BYTES']) {
      expect(src.includes(token), token).toBe(true)
    }
    expect(src).toMatch(/recipients\.length > MAX_RECIPIENTS/)
    expect(src).toMatch(/base64DecodedBytes\(attachmentBase64\) > MAX_ATTACHMENT_BYTES/)
    expect(src).toMatch(/413/)
  })
  it('does not echo the rejected addresses back', () => {
    expect(src).not.toMatch(/invalidEmails\.join/)
  })
  it('has a database-backed per-user limit that answers 429 with Retry-After and fails closed', () => {
    expect(src).toMatch(/from\('audit_log_v2'\)[\s\S]{0,200}\.eq\('user_id', userId\)/)
    expect(src).toMatch(/429,\s*\{ 'Retry-After'/)
    expect(src).toMatch(/rate-limit read failed \(blocking\)/)
  })
  it('writes the audit row with the caller id before the provider call and refuses when it fails', () => {
    const audit = src.indexOf("from('audit_log_v2').insert")
    const provider = src.indexOf("fetch('https://api.resend.com/emails'")
    expect(audit).toBeGreaterThan(0)
    expect(provider).toBeGreaterThan(audit)
    expect(src).toMatch(/user_id: userId/)
    expect(src).toMatch(/audit insert failed \(blocking\)/)
  })
  it('still uses the fail-closed shared role gate', () => {
    expect(src).toMatch(/requireApprovedRole\(req, \['admin', 'manager', 'director'\]\)/)
    expect(read('_shared', 'auth.ts')).toMatch(/profile\.approved !== true \|\| profile\.locked === true/)
  })
})

describe('send-scheduled-reports: null org, cooldown, approval (API-2, API-3)', () => {
  const src = read('send-scheduled-reports')
  it('never builds a digest without an organisation', () => {
    expect(src).not.toMatch(/if \(orgId\) q = q\.eq\('organisation_id', orgId\)/)
    expect((src.match(/requireOrg\(/g) || []).length).toBeGreaterThanOrEqual(5)
    expect(src).toMatch(/requireOrg\(s\.org_id\)/)
    expect(src).toMatch(/if \(!s\.org_id\) return jsonResponse\(req, \{ error: NO_ORG_MESSAGE \}, 422\)/)
  })
  it('send now refuses a NULL approval', () => {
    expect(src).not.toMatch(/approved === false/)
    expect(src).toMatch(/profile\.approved !== true \|\| profile\.locked === true/)
  })
  it('send now has a per-schedule cooldown answering 429 with Retry-After', () => {
    expect(src).toMatch(/SEND_NOW_COOLDOWN_SECONDS = \d+/)
    expect(src).toMatch(/429,\s*\{ 'Retry-After': String\(retryAfter\) \}/)
    const cooldown = src.indexOf('cooldown read failed')
    const render = src.indexOf('await renderForSchedule(svc, s as Schedule')
    expect(cooldown).toBeGreaterThan(0)
    expect(render).toBeGreaterThan(cooldown)
  })
})

describe('CORS: no wildcard preview hosts or loose localhost match', () => {
  for (const name of ['admin-revoke-sessions', 'send-scheduled-reports', 'tenant-export', 'sentry-issues']) {
    it(`${name} has no *.vercel.app wildcard and no startsWith('http://localhost')`, () => {
      const src = read(name)
      expect(src).not.toMatch(/VERCEL_ORIGIN/)
      expect(src).not.toMatch(/startsWith\('http:\/\/localhost'\)/)
    })
  }
  it('ai-tyre-inspection builds its CORS headers per request (no module-level origin)', () => {
    const src = read('ai-tyre-inspection')
    expect(src).not.toMatch(/let currentOrigin/)
    expect(src).toMatch(/const cors = corsFor\(req\)/)
  })
})

describe('sentry proxy: token only goes to a Sentry host (API-12)', () => {
  for (const name of ['sentry-issues', 'sentry-crash-alert']) {
    it(`${name} validates the stored region URL`, () => {
      const src = read(name)
      expect(src).toMatch(/const region = sentryRegion\(cfg\['sentry_region_url'\]\)/)
      expect(src).toMatch(/if \(!region\)/)
      expect(src).not.toMatch(/cfg\['sentry_region_url'\] \|\| 'https:\/\/de\.sentry\.io'\)\.replace/)
    })
  }
  it('sentry-issues refuses a locked super admin', () => {
    expect(read('sentry-issues')).toMatch(/is_super_admin !== true \|\| prof\?\.locked === true/)
  })
})

describe('rate-limit responses carry Retry-After (API-13)', () => {
  for (const name of ['chat-ai', 'ai-orchestrator', 'public-api', 'account-recovery', 'send-email', 'send-scheduled-reports', 'sign-in']) {
    it(name, () => {
      expect(read(name)).toMatch(/Retry-After/)
    })
  }
})

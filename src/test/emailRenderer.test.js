import { describe, it, expect, vi } from 'vitest'
import { renderEmail, TEMPLATE_KEYS, normaliseLocale } from '../../supabase/functions/_shared/email/render.ts'
import { appLink, safeLink, entityPath } from '../../supabase/functions/_shared/email/links.ts'
import { stripCrLf, cleanAddress, escapeHtml } from '../../supabase/functions/_shared/email/escape.ts'
import { ResendAdapter, SmtpAdapter, classifyStatus, parseRetryAfter, providerFromEnv } from '../../supabase/functions/_shared/email/provider.ts'
import { dispatchRows } from '../../supabase/functions/_shared/email/dispatch.ts'

const accident = {
  reference_no: 'ACC-2026-0148', asset_no: 'TM514', site: 'NHC', severity: 'severe', stage: 'workshop_assessment',
  incident_date: '2026-11-27T08:15:00Z', driver_name: 'Ahmed Ali', description: 'Rear-ended at the plant gate', action: 'Workshop to assess',
}

describe('email renderer', () => {
  it('renders every template in EN and AR without throwing', () => {
    for (const template of TEMPLATE_KEYS) {
      for (const locale of ['en', 'ar']) {
        const r = renderEmail({ template, locale, data: { ...accident, title: 'Job', body: 'Do it', count: 2, items: ['a'], total: 1, sections: [{ key: 'low_stock', count: 1, items: ['Tyre 315'] }] } })
        expect(r.subject.length).toBeGreaterThan(0)
        expect(r.html).toContain('<!DOCTYPE html>')
        expect(r.text.length).toBeGreaterThan(0)
      }
    }
  })

  it('matches the EN accident snapshot', () => {
    const r = renderEmail({ template: 'accident.reported', locale: 'en', data: accident, entityType: 'accident', entityId: 'a1b2' })
    expect({ subject: r.subject, text: r.text }).toMatchSnapshot()
  })

  it('matches the AR accident snapshot and is right-to-left', () => {
    const r = renderEmail({ template: 'accident.update', locale: 'ar', data: accident, entityType: 'accident', entityId: 'a1b2' })
    expect(r.html).toContain('dir="rtl"')
    expect(r.html).toContain('lang="ar"')
    expect(r.subject).toContain('تقييم الورشة')
    expect({ subject: r.subject, text: r.text }).toMatchSnapshot()
  })

  it('uses brand colours: dark header and yellow button with dark text', () => {
    const r = renderEmail({ template: 'test', locale: 'en' })
    expect(r.html).toContain('background:#161616')
    expect(r.html).toMatch(/background:#FFC629;color:#161616/)
    expect(r.html).toContain('com.shahzebrahman.tyrepulse')
    expect(r.html).toContain('/settings?tab=email')
  })

  it('shows the App Store link only when a URL is configured', () => {
    expect(renderEmail({ template: 'test', locale: 'en' }).html).not.toContain('App Store')
    const r = renderEmail({ template: 'test', locale: 'en', appStoreUrl: 'https://apps.apple.com/app/id123' })
    expect(r.html).toContain('https://apps.apple.com/app/id123')
    expect(renderEmail({ template: 'test', locale: 'en', appStoreUrl: 'https://evil.example/app' }).html).not.toContain('App Store')
  })

  it('escapes every value', () => {
    const r = renderEmail({ template: 'website.enquiry', locale: 'en', data: { name: '<script>alert(1)</script>', message: '"><img src=x onerror=1>' } })
    expect(r.html).not.toContain('<script>alert(1)')
    expect(r.html).not.toContain('<img src=x')
    expect(r.html).toContain('&lt;script&gt;')
  })

  it('strips CR/LF from the subject', () => {
    const r = renderEmail({ template: 'assignment.new', locale: 'en', data: { title: 'Fix\r\nBcc: victim@x.com' } })
    expect(r.subject).not.toMatch(/[\r\n]/)
    expect(stripCrLf('a\r\nb\nc')).toBe('a b c')
  })

  it('hides staff-only fields from external recipients', () => {
    const r = renderEmail({ template: 'accident.reported', locale: 'en', data: accident, audience: 'external' })
    expect(r.html).toContain('TM514')
    expect(r.html).not.toContain('Ahmed Ali')
    expect(r.html).not.toContain('Rear-ended')
  })

  it('marks only the digest as optional', () => {
    expect(renderEmail({ template: 'digest.daily', locale: 'en', data: { sections: [] } }).optional).toBe(true)
    expect(renderEmail({ template: 'accident.reported', locale: 'en', data: accident }).optional).toBe(false)
  })

  it('falls back to English for ur/hi', () => {
    expect(normaliseLocale('ur')).toBe('en')
    expect(normaliseLocale('ar-SA')).toBe('ar')
  })
})

describe('email links', () => {
  it('builds links from entity type + id only', () => {
    expect(appLink('accident', '9f0c-11')).toBe('https://tyrepulse.app/accidents/9f0c-11')
    expect(entityPath('accident', '../../admin')).toBe('/accidents')
    expect(entityPath('nope', 'x')).toBe('/')
  })
  it('allowlists hosts and https only', () => {
    expect(safeLink('https://evil.example/x')).toBe('https://tyrepulse.app')
    expect(safeLink('javascript:alert(1)')).toBe('https://tyrepulse.app')
    expect(safeLink('http://tyrepulse.app/x')).toBe('https://tyrepulse.app')
    expect(appLink('accident', 'a', 'https://evil.example')).toBe('https://tyrepulse.app/accidents/a')
  })
  it('rejects synthetic and malformed addresses', () => {
    expect(cleanAddress('driver1@users.tyrepulse.app')).toBeNull()
    expect(cleanAddress('a@b')).toBeNull()
    expect(cleanAddress(' Boss@Example.com ')).toBe('boss@example.com')
    expect(escapeHtml(`<a href='x'>`)).toBe('&lt;a href=&#39;x&#39;&gt;')
  })
})

describe('provider adapter', () => {
  const msg = { to: 'boss@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x', idempotencyKey: 'tp-1' }
  const fakeFetch = (status, body = {}, headers = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers }))

  it('classifies statuses', () => {
    expect(classifyStatus(429)).toBe('transient')
    expect(classifyStatus(503)).toBe('transient')
    expect(classifyStatus(422)).toBe('permanent')
    expect(parseRetryAfter('30')).toBe(30)
    expect(parseRetryAfter('99999')).toBe(3600)
  })
  it('sends via Resend with idempotency key and reply-to', async () => {
    const f = fakeFetch(200, { id: 're_1' })
    const r = await new ResendAdapter('k', f).send(msg)
    expect(r).toEqual({ ok: true, providerId: 're_1' })
    const [, init] = f.mock.calls[0]
    expect(init.headers['Idempotency-Key']).toBe('tp-1')
    expect(JSON.parse(init.body).reply_to).toBe('info@tyrepulse.app')
    expect(JSON.parse(init.body).from).toContain('noreply@tyrepulse.app')
  })
  it('treats 429 as transient with Retry-After, 422 as permanent, network error as transient', async () => {
    const r429 = await new ResendAdapter('k', fakeFetch(429, { message: 'rate' }, { 'retry-after': '5' })).send(msg)
    expect(r429).toMatchObject({ ok: false, kind: 'transient', retryAfterSeconds: 5 })
    expect(await new ResendAdapter('k', fakeFetch(422, { message: 'bad' })).send(msg)).toMatchObject({ ok: false, kind: 'permanent' })
    const boom = vi.fn(async () => { throw new Error('ECONNRESET') })
    expect(await new ResendAdapter('k', boom).send(msg)).toMatchObject({ ok: false, kind: 'transient' })
  })
  it('refuses synthetic recipients without calling the provider', async () => {
    const f = fakeFetch(200)
    const r = await new ResendAdapter('k', f).send({ ...msg, to: 'x@users.tyrepulse.app' })
    expect(r).toMatchObject({ ok: false, kind: 'permanent' })
    expect(f).not.toHaveBeenCalled()
  })
  it('SMTP accepts port 465 only', () => {
    expect(() => new SmtpAdapter({ host: 'mail.example', port: 587 })).toThrow()
    expect(new SmtpAdapter({ host: 'mail.example', port: 465 }).name).toBe('smtp')
    expect(providerFromEnv(() => undefined)).toBeNull()
    expect(providerFromEnv(k => ({ RESEND_API_KEY: 'k' })[k]).name).toBe('resend')
  })
})

describe('dispatcher', () => {
  const row = { id: 1, organisation_id: null, event_key: 'test', template_key: 'test', locale: 'en', audience: 'staff', to_address: 'boss@example.com', entity_type: null, entity_id: null, data: {}, dedupe_key: 'd1', attempts: 1 }
  it('dry run renders but never sends', async () => {
    const provider = { name: 'resend', send: vi.fn() }
    const r = await dispatchRows([row], { mode: 'dry_run', provider })
    expect(r).toEqual([{ id: 1, outcome: 'dry_run' }])
    expect(provider.send).not.toHaveBeenCalled()
  })
  it('live sends and reports provider results', async () => {
    const provider = { name: 'resend', send: vi.fn(async () => ({ ok: false, kind: 'transient', status: 429, error: 'rate', retryAfterSeconds: 2 })) }
    const r = await dispatchRows([row, { ...row, id: 2 }], { mode: 'live', provider, sleep: async () => {} })
    expect(r.map(x => x.outcome)).toEqual(['transient', 'transient'])
    expect(r[0].retryAfter).toBe(2)
  })
  it('an unknown template fails permanently', async () => {
    const r = await dispatchRows([{ ...row, template_key: 'nope' }], { mode: 'live', provider: null })
    expect(r[0].outcome).toBe('permanent')
  })
})

describe('svix webhook verification', async () => {
  const { verifySvix, svixSign } = await import('../../supabase/functions/_shared/email/svix.ts')
  const secret = 'whsec_' + btoa('0123456789abcdef0123456789abcdef')
  const body = '{"type":"email.bounced"}'
  it('accepts a valid signature inside the tolerance', async () => {
    const sig = await svixSign(secret, 'msg_1', '1000', body)
    expect(await verifySvix(secret, { id: 'msg_1', timestamp: '1000', signature: `v1,${sig}` }, body, 1100)).toEqual({ ok: true })
  })
  it('rejects a tampered body, a stale timestamp and a missing secret', async () => {
    const sig = await svixSign(secret, 'msg_1', '1000', body)
    expect((await verifySvix(secret, { id: 'msg_1', timestamp: '1000', signature: `v1,${sig}` }, body + ' ', 1100)).ok).toBe(false)
    expect((await verifySvix(secret, { id: 'msg_1', timestamp: '1000', signature: `v1,${sig}` }, body, 2000)).ok).toBe(false)
    expect((await verifySvix('', { id: 'msg_1', timestamp: '1000', signature: `v1,${sig}` }, body, 1100)).ok).toBe(false)
  })
})

describe('subject prefix', () => {
  it('prepends an org subject prefix once and strips CR/LF from it', () => {
    const r = renderEmail({ template: 'accident.update', locale: 'en', data: { reference_no: 'A1', stage: 'closed', subject_prefix: '[GCC]\r\nBcc: x' } })
    expect(r.subject.startsWith('[GCC] Bcc: x Accident A1')).toBe(true)
    expect(r.subject).not.toMatch(/[\r\n]/)
  })
})

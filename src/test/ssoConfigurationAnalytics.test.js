import { describe, it, expect } from 'vitest'
import {
  ssoKpis, filterSso, certAttention, certAttentionLabel, ssoExportRows, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/ssoConfigurationAnalytics'

const NOW = new Date('2026-09-27T00:00:00Z').getTime()
const rows = [
  { id: 1, connection_name: 'Okta', protocol: 'saml', status: 'active', enforce_sso: true, jit_provisioning: true, domains: 'acme.com, corp.acme.com', cert_expiry: '2026-10-10' },
  { id: 2, connection_name: 'Entra', protocol: 'oidc', status: 'draft', domains: 'ACME.com', cert_expiry: '2026-09-01' },
  { id: 3, connection_name: 'Google', protocol: 'oauth2', status: 'active', country: 'UAE' },
]

describe('ssoKpis', () => {
  it('counts coverage and certificates honestly', () => {
    const k = ssoKpis(rows, NOW)
    expect(k.totalConnections).toBe(3)
    expect(k.enforcedCount).toBe(1)
    expect(k.enforcementRate).toBeCloseTo(33.3, 1)
    expect(k.domainsCovered).toBe(2)
    expect(k.noCertCount).toBe(1)
    expect(k.expiringCertCount).toBe(2)
  })
  it('null rate for an empty tenant', () => {
    expect(ssoKpis([], NOW).enforcementRate).toBeNull()
  })
})

describe('filters, attention and export', () => {
  it('filters', () => {
    expect(filterSso(rows, { protocol: 'oidc' }, NOW)).toHaveLength(1)
    expect(filterSso(rows, { cert: 'unknown' }, NOW)).toHaveLength(1)
    expect(filterSso(rows, { cert: 'expired' }, NOW)).toHaveLength(1)
    expect(filterSso(rows, { search: 'corp.acme' }, NOW)).toHaveLength(1)
    expect(filterSso(rows, { country: 'UAE' }, NOW)).toHaveLength(1)
  })
  it('lists expired first', () => {
    const a = certAttention(rows, NOW)
    expect(a.map((x) => x.row.id)).toEqual([2, 1])
    expect(certAttentionLabel(a[0].status, a[0].days)).toMatch(/^Expired \d+d ago$/)
    expect(certAttentionLabel(a[1].status, a[1].days)).toMatch(/^Expires in \d+d$/)
  })
  it('export rows align with headers', () => {
    const out = ssoExportRows(rows, NOW)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(EXPORT_HEADERS).toHaveLength(EXPORT_COLS.length)
    expect(out[0].enforce_sso).toBe('Yes')
    expect(out[2].cert_status).toBe('No cert')
  })
})

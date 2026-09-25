import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseIp, formatIp, parseCidr, ipInCidr, rangeSize, validateAllowlistEntry, isCovered,
  enableLockoutRisk, blockedReasonText, ssoOrgStatus, ssoEnableBlocker,
} from '../lib/accessPolicies'

const rpc = vi.fn()
const net = { down: false }
vi.mock('../lib/api/_client', () => ({
  supabase: {
    rpc: async (...a) => {
      if (net.down) throw new TypeError('Failed to fetch')
      return rpc(...a)
    },
  },
  unwrap: (r) => { if (r?.error) throw new Error('sanitised'); return r?.data },
}))

describe('parseIp', () => {
  it('parses IPv4', () => {
    expect(parseIp('192.168.1.10')).toMatchObject({ version: 4, bits: 32 })
    expect(formatIp(parseIp(' 10.0.0.1 '))).toBe('10.0.0.1')
  })
  it('rejects malformed IPv4', () => {
    for (const bad of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', 'a.b.c.d', '', null, '1.2.3.-1']) {
      expect(parseIp(bad)).toBeNull()
    }
  })
  it('parses IPv6 including compression and brackets', () => {
    expect(formatIp(parseIp('2001:0db8:0000:0000:0000:0000:0000:0001'))).toBe('2001:db8::1')
    expect(formatIp(parseIp('::'))).toBe('::')
    expect(formatIp(parseIp('::1'))).toBe('::1')
    expect(formatIp(parseIp('[fe80::1]'))).toBe('fe80::1')
    expect(parseIp('2001:db8::1').version).toBe(6)
  })
  it('parses IPv4-mapped IPv6', () => {
    expect(formatIp(parseIp('::ffff:192.0.2.1'))).toBe('::ffff:c000:201')
  })
  it('rejects malformed IPv6', () => {
    for (const bad of ['2001:db8::1::2', '1:2:3:4:5:6:7:8:9', 'gggg::1', '1:2:3:4:5:6:7', 'fe80::1%eth0', ':1:2:3:4:5:6:7']) {
      expect(parseIp(bad)).toBeNull()
    }
  })
})

describe('parseCidr', () => {
  it('zeroes host bits like Postgres network()', () => {
    expect(parseCidr('10.0.0.5/24').text).toBe('10.0.0.0/24')
    expect(parseCidr('2001:db8::abcd/32').text).toBe('2001:db8::/32')
  })
  it('treats a bare address as a single host', () => {
    expect(parseCidr('203.0.113.9').text).toBe('203.0.113.9/32')
    expect(parseCidr('2001:db8::1').text).toBe('2001:db8::1/128')
  })
  it('rejects bad prefixes', () => {
    expect(parseCidr('10.0.0.0/33')).toBeNull()
    expect(parseCidr('::/129')).toBeNull()
    expect(parseCidr('10.0.0.0/x')).toBeNull()
    expect(parseCidr('10.0.0.0/')).toBeNull()
  })
  it('keeps /0 parseable (validation refuses it separately)', () => {
    expect(parseCidr('0.0.0.0/0').prefix).toBe(0)
  })
})

describe('ipInCidr', () => {
  it('matches inside the range and not outside', () => {
    expect(ipInCidr('203.0.113.9', '203.0.113.0/24')).toBe(true)
    expect(ipInCidr('203.0.114.9', '203.0.113.0/24')).toBe(false)
    expect(ipInCidr('10.255.255.255', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('11.0.0.0', '10.0.0.0/8')).toBe(false)
  })
  it('handles /32 and /128 exactly', () => {
    expect(ipInCidr('1.2.3.4', '1.2.3.4/32')).toBe(true)
    expect(ipInCidr('1.2.3.5', '1.2.3.4/32')).toBe(false)
    expect(ipInCidr('2001:db8::1', '2001:db8::1/128')).toBe(true)
    expect(ipInCidr('2001:db8::2', '2001:db8::1/128')).toBe(false)
  })
  it('handles non-octet prefixes', () => {
    expect(ipInCidr('192.168.1.130', '192.168.1.128/25')).toBe(true)
    expect(ipInCidr('192.168.1.127', '192.168.1.128/25')).toBe(false)
    expect(ipInCidr('172.31.0.1', '172.16.0.0/12')).toBe(true)
    expect(ipInCidr('172.32.0.1', '172.16.0.0/12')).toBe(false)
  })
  it('matches IPv6 ranges', () => {
    expect(ipInCidr('2001:db8:ffff::1', '2001:db8::/32')).toBe(true)
    expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('fe80::abcd', 'fe80::/10')).toBe(true)
  })
  it('never matches across families', () => {
    expect(ipInCidr('10.0.0.1', '::/1')).toBe(false)
    expect(ipInCidr('::ffff:10.0.0.1', '10.0.0.0/8')).toBe(false)
  })
  it('returns false for garbage', () => {
    expect(ipInCidr('nope', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.1', 'nope')).toBe(false)
    expect(ipInCidr(null, null)).toBe(false)
  })
  it('/0 covers every address of its family', () => {
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true)
  })
})

describe('rangeSize', () => {
  it('describes sizes', () => {
    expect(rangeSize('1.2.3.4/32')).toBe('Single address')
    expect(rangeSize('1.2.3.0/24')).toBe('256 addresses')
    expect(rangeSize('2001:db8::/32')).toBe('2^96 addresses')
    expect(rangeSize('bad')).toBe('')
  })
})

describe('validateAllowlistEntry', () => {
  it('requires a label', () => {
    expect(validateAllowlistEntry({ label: ' ', cidr: '1.2.3.4' }).ok).toBe(false)
    expect(validateAllowlistEntry({ label: 'x'.repeat(121), cidr: '1.2.3.4' }).ok).toBe(false)
  })
  it('refuses invalid and /0 ranges', () => {
    expect(validateAllowlistEntry({ label: 'a', cidr: 'nope' }).ok).toBe(false)
    expect(validateAllowlistEntry({ label: 'a', cidr: '0.0.0.0/0' }).error).toMatch(/every address/)
    expect(validateAllowlistEntry({ label: 'a', cidr: '::/0' }).ok).toBe(false)
  })
  it('normalises and flags it', () => {
    expect(validateAllowlistEntry({ label: 'a', cidr: '10.0.0.5/24' })).toEqual({ ok: true, cidr: '10.0.0.0/24', normalised: true })
    expect(validateAllowlistEntry({ label: 'a', cidr: '10.0.0.0/24' })).toEqual({ ok: true, cidr: '10.0.0.0/24', normalised: false })
  })
})

describe('coverage + lockout pre-check', () => {
  const entries = [
    { cidr: '203.0.113.0/24', active: true },
    { cidr: '198.51.100.0/24', active: false },
    { cidr: '2001:db8::/32', active: true },
  ]
  it('only active entries count', () => {
    expect(isCovered('203.0.113.9', entries)).toBe(true)
    expect(isCovered('198.51.100.4', entries)).toBe(false)
    expect(isCovered('2001:db8::5', entries)).toBe(true)
    expect(isCovered(null, entries)).toBe(false)
  })
  it('names the lockout risk', () => {
    expect(enableLockoutRisk('203.0.113.9', entries)).toBeNull()
    expect(enableLockoutRisk('198.51.100.4', entries)).toMatch(/not covered/)
    expect(enableLockoutRisk(null, entries)).toMatch(/cannot be read/)
  })
  it('explains a refusal', () => {
    expect(blockedReasonText('not_listed', '1.2.3.4')).toMatch(/1\.2\.3\.4/)
    expect(blockedReasonText('ip_unknown')).toMatch(/could not be read/)
  })
})

describe('SSO helpers', () => {
  it('status per org', () => {
    expect(ssoOrgStatus({ required: true }).label).toBe('SSO required')
    expect(ssoOrgStatus({ required: false, active_connections: 1 }).tone).toBe('info')
    expect(ssoOrgStatus({ required: false, active_connections: 0 }).label).toMatch(/No active/)
  })
  it('blocks requiring SSO without registered domains', () => {
    expect(ssoEnableBlocker({ active_domains: [] }, [])).toMatch(/No active SSO/)
    expect(ssoEnableBlocker({ active_domains: ['a.com', 'b.com'] }, ['A.com'])).toMatch(/b\.com/)
    expect(ssoEnableBlocker({ active_domains: ['a.com'] }, ['a.com'])).toBeNull()
  })
})

describe('runtime checks fail open', () => {
  beforeEach(() => rpc.mockReset())
  it('console check: error -> allowed', async () => {
    const { checkConsoleAccess } = await import('../lib/api/accessPolicies')
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } })
    expect(await checkConsoleAccess()).toEqual({ allowed: true, failedOpen: true })
  })
  it('console check: network failure -> allowed', async () => {
    const { checkConsoleAccess } = await import('../lib/api/accessPolicies')
    net.down = true
    try {
      expect(await checkConsoleAccess()).toEqual({ allowed: true, failedOpen: true })
    } finally { net.down = false }
  })
  it('console check: explicit refusal blocks', async () => {
    const { checkConsoleAccess } = await import('../lib/api/accessPolicies')
    rpc.mockResolvedValue({ data: { allowed: false, enabled: true, reason: 'not_listed', ip: '1.2.3.4' }, error: null })
    expect(await checkConsoleAccess()).toMatchObject({ allowed: false, reason: 'not_listed', failedOpen: false })
  })
  it('sso check: error -> allowed, refusal -> blocked', async () => {
    const { checkSsoPasswordLogin } = await import('../lib/api/accessPolicies')
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect((await checkSsoPasswordLogin()).allowed).toBe(true)
    rpc.mockResolvedValue({ data: { allowed: false, reason: 'sso_required' }, error: null })
    expect(await checkSsoPasswordLogin()).toMatchObject({ allowed: false, reason: 'sso_required' })
  })
  it('passes our own refusal sentences through', async () => {
    const { setConsoleIpAllowlist } = await import('../lib/api/accessPolicies')
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Your current IP (1.2.3.4) is not covered by an active range.' } })
    await expect(setConsoleIpAllowlist(true, 'reason')).rejects.toThrow(/not covered/)
  })
})

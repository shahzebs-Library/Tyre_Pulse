import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import {
  recordConsoleLoginDevice, deviceLabel, normalizeKnownDevice, summarizeKnownDevices,
  listKnownDevices, forgetKnownDevice,
} from '../lib/api/consoleKnownDevices'

beforeEach(() => { rpc.mockReset(); net.down = false })

describe('recordConsoleLoginDevice', () => {
  it('passes the user agent and never sends a client IP', async () => {
    rpc.mockResolvedValue({ data: { ok: true, seeded: true }, error: null })
    const res = await recordConsoleLoginDevice('Mozilla/5.0 Chrome/120')
    expect(rpc).toHaveBeenCalledWith('console_record_login_device', { p_ip: null, p_user_agent: 'Mozilla/5.0 Chrome/120' })
    expect(res).toEqual({ ok: true, seeded: true })
  })
  it('truncates a huge user agent', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await recordConsoleLoginDevice('x'.repeat(2000))
    expect(rpc.mock.calls[0][1].p_user_agent).toHaveLength(512)
  })
  it('never throws: RPC error, network failure, junk shape all resolve to null', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(recordConsoleLoginDevice('ua')).resolves.toBeNull()
    net.down = true
    await expect(recordConsoleLoginDevice('ua')).resolves.toBeNull()
    net.down = false
    rpc.mockResolvedValue({ data: 'weird', error: null })
    await expect(recordConsoleLoginDevice('ua')).resolves.toBeNull()
  })
})

describe('deviceLabel', () => {
  it('names common browsers and systems', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120 Safari/537')).toBe('Chrome on Windows')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17 Safari/605')).toBe('Safari on macOS')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120')).toBe('Edge on Windows')
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:120) Firefox/120')).toBe('Firefox on Linux')
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604')).toBe('Safari on iOS')
  })
  it('handles blank and unknown values honestly', () => {
    expect(deviceLabel('')).toBe('Unknown browser')
    expect(deviceLabel(null)).toBe('Unknown browser')
    expect(deviceLabel('unknown')).toBe('Unknown browser')
    expect(deviceLabel('curl/8.0')).toBe('curl/8.0')
  })
})

describe('normalizeKnownDevice', () => {
  it('shapes a row and guards bad values', () => {
    const d = normalizeKnownDevice({
      id: 'a', admin_id: 'u', admin_name: 'Anum', ip: '203.0.113.9', ip_source: 'weird',
      ua_label: 'Chrome/1 Windows', first_seen: '2026-09-20T00:00:00Z', last_seen: null, login_count: 'x',
    })
    expect(d).toMatchObject({ id: 'a', adminName: 'Anum', ip: '203.0.113.9', ipSource: 'unknown', loginCount: 0 })
    expect(normalizeKnownDevice(null)).toBeNull()
    expect(normalizeKnownDevice({})).toBeNull()
  })
})

describe('summarizeKnownDevices', () => {
  it('counts admins, IPs, recent and unverified devices', () => {
    const now = new Date('2026-09-25T00:00:00Z').getTime()
    const s = summarizeKnownDevices([
      { adminId: 'a', ip: '1.1.1.1', ipSource: 'header', firstSeen: '2026-09-24T00:00:00Z' },
      { adminId: 'a', ip: '1.1.1.1', ipSource: 'client', firstSeen: '2026-08-01T00:00:00Z' },
      { adminId: 'b', ip: null, ipSource: 'unknown', firstSeen: null },
      null,
    ], now)
    expect(s).toEqual({ total: 3, admins: 2, ips: 1, newThisWeek: 1, unverifiedIp: 2 })
    expect(summarizeKnownDevices(undefined)).toEqual({ total: 0, admins: 0, ips: 0, newThisWeek: 0, unverifiedIp: 0 })
  })
})

describe('list / forget', () => {
  it('lists and drops junk rows', async () => {
    rpc.mockResolvedValue({ data: [{ id: '1', ua_label: 'x' }, null, {}], error: null })
    const rows = await listKnownDevices()
    expect(rows).toHaveLength(1)
  })
  it('throws when the list cannot be read (not an empty list)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(listKnownDevices()).rejects.toThrow()
  })
  it('forget reports a device that is already gone', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'not_found' }, error: null })
    await expect(forgetKnownDevice('1')).rejects.toThrow('already removed')
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await expect(forgetKnownDevice('1')).resolves.toEqual({ ok: true })
    expect(rpc).toHaveBeenLastCalledWith('console_forget_device', { p_id: '1' })
  })
})

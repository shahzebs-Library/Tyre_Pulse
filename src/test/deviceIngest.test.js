import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalizeMessage, normalizeBatch, detectVendor, pressureToPsi, toIso, SAMPLE_PAYLOADS, MAX_MESSAGES,
} from '../../supabase/functions/_shared/deviceIngest.js'
import { buildZpl, buildEscPos, zplSafe } from '../lib/thermalLabel'
import { createWedgeDetector } from '../lib/wedgeScanner'
import { printerSupport } from '../lib/webDevicePrint'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))

describe('canonical validation', () => {
  it('accepts a valid gps message and keeps units', () => {
    const r = normalizeMessage({ type: 'gps', asset: { asset_no: 'TM514' }, data: { lat: '24.7', lon: 46.6, speed_kmh: 40 } })
    expect(r.ok).toBe(true)
    expect(r.message.data).toMatchObject({ lat: 24.7, lon: 46.6, speed_kmh: 40 })
  })
  it('rejects out of range, missing asset, unknown type and bad dates', () => {
    expect(normalizeMessage({ type: 'gps', asset: { asset_no: 'A' }, data: { lat: 91, lon: 0 } }).error).toBe('lat_out_of_range')
    expect(normalizeMessage({ type: 'gps', data: { lat: 1, lon: 1 } }).error).toBe('asset_or_device_required')
    expect(normalizeMessage({ type: 'nope', device_id: 'x' }).error).toBe('unknown_type')
    expect(normalizeMessage({ type: 'odometer', device_id: 'x', recorded_at: 'not a date', data: { odometer_km: 1 } }).error).toBe('bad_recorded_at')
    expect(normalizeMessage({ type: 'gps', device_id: 'x', data: { lat: 0, lon: 0 } }).error).toBe('no_gps_fix')
  })
  it('converts tyre pressure to psi and requires a wheel', () => {
    expect(pressureToPsi(8, 'bar')).toBeCloseTo(116.03, 1)
    expect(pressureToPsi(800, 'kpa')).toBeCloseTo(116.03, 1)
    const r = normalizeMessage({ type: 'tpms', device_id: 'x', data: { position: 'lhf1', pressure: 8, pressure_unit: 'bar' } })
    expect(r.message.data.position).toBe('LHF1')
    expect(normalizeMessage({ type: 'tpms', device_id: 'x', data: { pressure: 100 } }).error).toBe('position_or_sensor_required')
  })
  it('drops a non-https dashcam clip url', () => {
    const r = normalizeMessage({ type: 'dashcam', device_id: 'x', data: { event_type: 'collision', video_url: 'javascript:alert(1)' } })
    expect(r.message.data.video_url).toBeNull()
  })
  it('parses unix seconds and milliseconds', () => {
    expect(toIso(1764230400)).toBe('2025-11-27T08:00:00.000Z')
    expect(toIso(1764230400000)).toBe('2025-11-27T08:00:00.000Z')
  })
})

describe('vendor adapters', () => {
  it('detects each sample', () => {
    for (const v of ['generic', 'teltonika', 'wialon', 'samsara']) expect(detectVendor(SAMPLE_PAYLOADS[v])).toBe(v)
  })
  it('teltonika fans one record out into gps, odometer, engine hours and tpms', () => {
    const b = normalizeBatch(SAMPLE_PAYLOADS.teltonika, { vendor: 'teltonika' })
    expect(b.rejected).toEqual([])
    expect(b.messages.map((m) => m.message.type)).toEqual(['gps', 'odometer', 'engine_hours', 'tpms'])
    expect(b.messages[0].message.message_id).toMatch(/^tlt:/)
    expect(b.messages[3].message.data.pressure_psi).toBeCloseTo(117.48, 1)
  })
  it('samsara converts metres and mph', () => {
    const b = normalizeBatch(SAMPLE_PAYLOADS.samsara)
    const odo = b.messages.find((m) => m.message.type === 'odometer')
    expect(odo.message.data.odometer_km).toBe(152340)
    expect(b.messages[0].message.data.speed_kmh).toBeCloseTo(40.2, 1)
    expect(b.messages[0].message.asset.vin).toBe('LZGJL5V40MX000001')
  })
  it('wialon maps pos and params', () => {
    const b = normalizeBatch(SAMPLE_PAYLOADS.wialon)
    expect(b.messages.map((m) => m.message.type)).toEqual(['gps', 'odometer', 'engine_hours'])
  })
  it('caps the batch size', () => {
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ type: 'odometer', device_id: 'x', data: { odometer_km: 1 } }))
    expect(normalizeBatch(many).error).toBe('too_many_messages')
  })
})

describe('thermal labels', () => {
  it('strips ZPL command characters from label text', () => {
    expect(zplSafe('TM514^XA~JR\\x')).toBe('TM514 XA JR x')
    const z = buildZpl([{ code: 'TM514', title: 'Bad ^FD', lines: ['NHC'] }])
    expect(z.startsWith('^XA')).toBe(true)
    expect(z).toContain('^FDQA,TM514^FS')
    expect(z).not.toContain('Bad ^FD')
  })
  it('builds ESC/POS bytes with no stray control bytes from text', () => {
    const b = buildEscPos([{ code: 'TM514', title: 'A\u001bB' }])
    expect(b[0]).toBe(0x1b)
    expect(Array.from(b).join(',')).toContain([65, 32, 66].join(','))
  })
  it('reports browser support honestly', () => {
    expect(printerSupport({})).toEqual({ usb: false, serial: false })
    expect(printerSupport({ usb: { requestDevice() {} } }).usb).toBe(true)
  })
})

describe('keyboard-wedge scanner', () => {
  it('reports a fast burst ending in Enter and ignores human typing', () => {
    const onScan = vi.fn()
    const h = createWedgeDetector({ onScan })
    let ts = 0
    for (const k of 'YMA55312') h({ key: k, timeStamp: (ts += 10) })
    h({ key: 'Enter', timeStamp: ts + 5 })
    expect(onScan).toHaveBeenCalledWith('YMA55312')
    onScan.mockClear()
    for (const k of 'ABCDE') h({ key: k, timeStamp: (ts += 300) })
    h({ key: 'Enter', timeStamp: ts + 5 })
    expect(onScan).not.toHaveBeenCalled()
  })
})

describe('deviceIngest service', () => {
  beforeEach(() => rpc.mockReset())
  it('validates the key form before calling the server', async () => {
    const { createIngestKey, validateKeyForm } = await import('../lib/api/deviceIngest')
    expect(validateKeyForm({ name: '', dataTypes: ['gps'], rate: 10 })).toBe('name_required')
    expect(validateKeyForm({ name: 'x', dataTypes: [], rate: 10 })).toBe('types_required')
    expect(validateKeyForm({ name: 'x', dataTypes: ['gps'], rate: 0 })).toBe('rate_invalid')
    await expect(createIngestKey({ name: '', dataTypes: ['gps'] })).rejects.toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('reports not-set-up when the RPCs do not exist yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    const { loadIngestState } = await import('../lib/api/deviceIngest')
    expect((await loadIngestState()).missing).toBe(true)
  })
  it('surfaces a refusal (42501) as an error, not as an empty page', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only an administrator can manage devices' } })
    const { loadIngestState } = await import('../lib/api/deviceIngest')
    await expect(loadIngestState()).rejects.toBeTruthy()
  })
  it('test payload: local rejects plus a server dry run, nothing else', async () => {
    rpc.mockResolvedValue({ data: { ok: true, results: [{ status: 'accepted', asset_no: 'TM514', target_table: 'gps_positions' }] }, error: null })
    const { testPayload } = await import('../lib/api/deviceIngest')
    const out = await testPayload(JSON.stringify({ messages: [
      { type: 'gps', asset: { asset_no: 'TM514' }, data: { lat: 1, lon: 1 } }, { type: 'gps', asset: { asset_no: 'X' }, data: {} }] }))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('device_ingest_dry_run')
    expect(out.rows.map((r) => r.status)).toEqual(['accepted', 'rejected'])
    expect((await testPayload('{not json')).error).toBe('bad_json')
  })
})

describe('admin-only gate (owner rule 2026-11-27)', () => {
  const app = readFileSync('src/App.jsx', 'utf8')
  const layout = readFileSync('src/components/Layout.jsx', 'utf8')
  it('route is strict Admin and nav is strictAdmin', () => {
    expect(app).toMatch(/path="\/telematics-devices"[^\n]*RoleRoute allowed=\{\['Admin'\]\} strict/)
    expect(layout).toMatch(/to: '\/telematics-devices'[^\n]*strictAdmin: true/)
  })
  it('command search hides it from Manager and Store Keeper even with a grant', async () => {
    const { isCommandVisible, NAV_COMMANDS } = await import('../lib/commandSearch')
    const cmd = (NAV_COMMANDS || []).find((c) => c.path === '/telematics-devices')
    expect(cmd).toBeTruthy()
    const allowAll = () => true
    const grants = new Set(['telematics_devices'])
    expect(isCommandVisible(cmd, { role: 'Manager' }, allowAll, grants, false)).toBe(false)
    expect(isCommandVisible(cmd, { role: 'Store Keeper' }, allowAll, grants, false)).toBe(false)
    expect(isCommandVisible(cmd, { role: 'Admin' }, allowAll, grants, false)).toBe(true)
    expect(isCommandVisible(cmd, { role: 'Manager' }, allowAll, grants, true)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { parseUserAgent, formatIp, ipDevice } from '../lib/auditTrailDevice'

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  dart: 'Dart/3.5 (dart:io)',
  okhttp: 'okhttp/4.12.0',
}

describe('parseUserAgent', () => {
  it('names browser and OS', () => {
    expect(parseUserAgent(UA.chromeWin).label).toBe('Chrome / Windows')
    expect(parseUserAgent(UA.edgeWin).label).toBe('Edge / Windows')
    expect(parseUserAgent(UA.safariIphone).label).toBe('Safari / iPhone')
    expect(parseUserAgent(UA.chromeIos).label).toBe('Chrome / iPhone')
    expect(parseUserAgent(UA.firefoxMac).label).toBe('Firefox / macOS')
    expect(parseUserAgent(UA.chromeAndroid).label).toBe('Chrome / Android')
  })
  it('names app clients and unknown agents without guessing', () => {
    expect(parseUserAgent(UA.dart).label).toBe('Flutter app')
    expect(parseUserAgent(UA.okhttp).label).toBe('Android app')
    expect(parseUserAgent('something odd').label).toBe('Unknown device')
    expect(parseUserAgent('').label).toBeNull()
    expect(parseUserAgent(null).label).toBeNull()
  })
})

describe('ipDevice', () => {
  it('formats inet text', () => {
    expect(formatIp('192.168.10.45/32')).toBe('192.168.10.45')
    expect(formatIp('  ')).toBeNull()
  })
  it('shows recorded IP and device', () => {
    const d = ipDevice({ ip_address: '10.0.0.1', user_agent: UA.chromeWin })
    expect(d).toMatchObject({ kind: 'recorded', primary: '10.0.0.1', secondary: 'Chrome / Windows' })
    expect(ipDevice({ user_agent: UA.safariIphone })).toMatchObject({ primary: 'Safari / iPhone', secondary: null })
  })
  it('never fabricates for rows without data', () => {
    expect(ipDevice({ actor_type: 'service', actor_detail: 'postgres' })).toMatchObject({ kind: 'system', primary: 'postgres' })
    expect(ipDevice({ actor_type: 'service' }).primary).toBe('System')
    expect(ipDevice({ actor_type: 'user' })).toMatchObject({ kind: 'missing', primary: 'Not recorded' })
    expect(ipDevice({}).primary).toBe('Not recorded')
  })
})

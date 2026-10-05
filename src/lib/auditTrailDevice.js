/**
 * IP / device for the Audit Trail register.
 *
 * audit_log_v2.ip_address and user_agent were never filled before 5 Oct 2026
 * (0 of 547k rows). From then on the trg_audit_stamp_request trigger stamps them
 * from the request headers. Bulk imports and service writes have no browser, so
 * they stay null. Nothing here invents a value: a row with neither field reads
 * "System" for a service write and "Not recorded" otherwise.
 *
 * Pure: no I/O.
 */

/** Date the database started recording IP and device on audit rows. */
export const DEVICE_RECORDING_START = '5 Oct 2026'

const BROWSERS = [
  [/\bEdgA?\/|\bEdg\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bCriOS\//, 'Chrome'],
  [/\bFxiOS\//, 'Firefox'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
  [/\bDart\//, 'Flutter app'],
  [/\bExpo\b|\bExponent\//, 'Expo app'],
  [/\bokhttp\//i, 'Android app'],
  [/\bCFNetwork\//, 'iOS app'],
  [/\bnode(-fetch)?\b|\bDeno\//i, 'Server'],
  [/\bcurl\//i, 'curl'],
  [/\bPostmanRuntime\//, 'Postman'],
]

const SYSTEMS = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
]

function first(list, ua) {
  for (const [re, name] of list) if (re.test(ua)) return name
  return null
}

/**
 * Parse a user agent into a short label such as "Chrome / Windows" or
 * "Safari / iPhone". Returns label null for an empty value.
 * @returns {{browser:string|null, os:string|null, label:string|null}}
 */
export function parseUserAgent(ua) {
  const s = typeof ua === 'string' ? ua.trim() : ''
  if (!s) return { browser: null, os: null, label: null }
  const browser = first(BROWSERS, s)
  const os = first(SYSTEMS, s)
  const label = browser && os ? `${browser} / ${os}` : (browser || os || 'Unknown device')
  return { browser, os, label }
}

/** inet comes back as text; drop a host-length suffix like /32 or /128. */
export function formatIp(ip) {
  if (ip == null) return null
  const s = String(ip).trim()
  if (!s) return null
  return s.replace(/\/(32|128)$/, '')
}

/**
 * What to show in the IP / Device column for one audit row.
 * @returns {{ip:string|null, device:string|null, primary:string, secondary:string|null, recorded:boolean, kind:'recorded'|'system'|'missing'}}
 */
export function ipDevice(row = {}) {
  const ip = formatIp(row.ip_address)
  const device = parseUserAgent(row.user_agent).label
  if (ip || device) {
    return {
      ip, device,
      primary: ip || device,
      secondary: ip ? device : null,
      recorded: true,
      kind: 'recorded',
    }
  }
  if (row.actor_type === 'service') {
    return { ip: null, device: null, primary: row.actor_detail ? String(row.actor_detail) : 'System', secondary: 'No browser', recorded: false, kind: 'system' }
  }
  return { ip: null, device: null, primary: 'Not recorded', secondary: null, recorded: false, kind: 'missing' }
}

/**
 * accessPolicies.js - pure helpers for Console, Access Policies.
 *
 * CIDR parsing and matching for IPv4 AND IPv6 with no dependencies. Addresses
 * are held as BigInt so a /128 compares exactly. The database is the
 * authority (console_check_access matches with Postgres `inet <<= cidr`); this
 * module exists so the page can validate a range before sending it, show the
 * canonical network it will be stored as, and tell the admin whether their own
 * address is covered. It mirrors the SQL rules:
 *   - host bits are zeroed ('10.0.0.5/24' is stored as 10.0.0.0/24)
 *   - a bare address is /32 (IPv4) or /128 (IPv6)
 *   - /0 is refused (it allows everything - turn the allowlist off instead)
 *   - an IPv4 address never matches an IPv6 range and vice versa
 */

const V4_BITS = 32
const V6_BITS = 128

/** Parse a dotted IPv4 string to a BigInt, or null. Rejects leading zeros. */
function parseV4(s) {
  const parts = String(s).split('.')
  if (parts.length !== 4) return null
  let n = 0n
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    if (p.length > 1 && p[0] === '0') return null
    const v = Number(p)
    if (v > 255) return null
    n = (n << 8n) | BigInt(v)
  }
  return n
}

/** Parse an IPv6 string (with :: compression and an optional trailing IPv4). */
function parseV6(input) {
  let s = String(input)
  const zone = s.indexOf('%')
  if (zone !== -1) return null // zone ids are link-local only; never valid here
  if (!s.includes(':')) return null
  // trailing dotted IPv4 (e.g. ::ffff:192.0.2.1) -> rewrite as two hex words
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseV4(tail)
    if (v4 == null) return null
    const hi = Number((v4 >> 16n) & 0xffffn).toString(16)
    const lo = Number(v4 & 0xffffn).toString(16)
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`
  }
  const dbl = s.split('::')
  if (dbl.length > 2) return null
  const toWords = (part) => (part === '' ? [] : part.split(':'))
  const head = toWords(dbl[0])
  const rest = dbl.length === 2 ? toWords(dbl[1]) : []
  for (const w of [...head, ...rest]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(w)) return null
  }
  const explicit = head.length + rest.length
  let words
  if (dbl.length === 2) {
    const fill = 8 - explicit
    if (fill < 1) return null
    words = [...head.map((w) => parseInt(w, 16)), ...Array(fill).fill(0), ...rest.map((w) => parseInt(w, 16))]
  } else {
    if (explicit !== 8) return null
    words = head.map((w) => parseInt(w, 16))
  }
  let n = 0n
  for (const w of words) n = (n << 16n) | BigInt(w)
  return n
}

/**
 * Parse an IP address. Returns { version: 4|6, value: BigInt, bits } or null.
 * Surrounding whitespace and IPv6 brackets ([::1]) are tolerated.
 */
export function parseIp(input) {
  if (input == null) return null
  let s = String(input).trim()
  if (!s) return null
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  if (s.includes(':')) {
    const v = parseV6(s)
    return v == null ? null : { version: 6, value: v, bits: V6_BITS }
  }
  const v = parseV4(s)
  return v == null ? null : { version: 4, value: v, bits: V4_BITS }
}

function maskFor(bits, prefix) {
  if (prefix === 0) return 0n
  const all = (1n << BigInt(bits)) - 1n
  return (all >> BigInt(bits - prefix)) << BigInt(bits - prefix)
}

function formatV4(n) {
  return [24n, 16n, 8n, 0n].map((sh) => String((n >> sh) & 0xffn)).join('.')
}

/** RFC 5952-style compact IPv6 (longest run of >=2 zero words becomes ::). */
function formatV6(n) {
  const words = []
  for (let i = 7; i >= 0; i -= 1) words.push(Number((n >> BigInt(i * 16)) & 0xffffn))
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8;) {
    if (words[i] !== 0) { i += 1; continue }
    let j = i
    while (j < 8 && words[j] === 0) j += 1
    if (j - i > bestLen && j - i >= 2) { bestStart = i; bestLen = j - i }
    i = j
  }
  const hex = words.map((w) => w.toString(16))
  if (bestStart === -1) return hex.join(':')
  const left = hex.slice(0, bestStart).join(':')
  const right = hex.slice(bestStart + bestLen).join(':')
  return `${left}::${right}`
}

/** Canonical text for a parsed address. */
export function formatIp(ip) {
  if (!ip) return ''
  return ip.version === 4 ? formatV4(ip.value) : formatV6(ip.value)
}

/**
 * Parse a CIDR ('10.0.0.0/8', '2001:db8::/32') or a bare address.
 * Returns { version, network: BigInt, prefix, bits, text } with host bits
 * zeroed, or null when invalid.
 */
export function parseCidr(input) {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null
  const slash = s.indexOf('/')
  const addr = slash === -1 ? s : s.slice(0, slash)
  const ip = parseIp(addr)
  if (!ip) return null
  let prefix = ip.bits
  if (slash !== -1) {
    const p = s.slice(slash + 1)
    if (!/^\d{1,3}$/.test(p)) return null
    prefix = Number(p)
    if (prefix > ip.bits) return null
  }
  const network = ip.value & maskFor(ip.bits, prefix)
  const netText = formatIp({ version: ip.version, value: network })
  return { version: ip.version, network, prefix, bits: ip.bits, text: `${netText}/${prefix}` }
}

/** True when the address sits inside the range. Mixed families never match. */
export function ipInCidr(ipInput, cidrInput) {
  const ip = typeof ipInput === 'object' && ipInput ? ipInput : parseIp(ipInput)
  const net = typeof cidrInput === 'object' && cidrInput ? cidrInput : parseCidr(cidrInput)
  if (!ip || !net || ip.version !== net.version) return false
  return (ip.value & maskFor(net.bits, net.prefix)) === net.network
}

/** Number of addresses in a range, as a short human string. */
export function rangeSize(cidrInput) {
  const net = typeof cidrInput === 'object' && cidrInput ? cidrInput : parseCidr(cidrInput)
  if (!net) return ''
  const hostBits = net.bits - net.prefix
  if (hostBits === 0) return 'Single address'
  if (hostBits <= 20) return `${(2 ** hostBits).toLocaleString('en-US')} addresses`
  return `2^${hostBits} addresses`
}

/**
 * Validate an allowlist entry before sending it. Mirrors the SQL checks.
 * @returns {{ ok: boolean, error?: string, cidr?: string, normalised?: boolean }}
 */
export function validateAllowlistEntry({ label, cidr } = {}) {
  const l = String(label ?? '').trim()
  if (!l) return { ok: false, error: 'Give the range a label, for example "Head office".' }
  if (l.length > 120) return { ok: false, error: 'Keep the label to 120 characters.' }
  const net = parseCidr(cidr)
  if (!net) return { ok: false, error: 'That is not a valid IP address or CIDR range.' }
  if (net.prefix === 0) return { ok: false, error: 'A /0 range allows every address. Turn the allowlist off instead.' }
  const raw = String(cidr).trim()
  return { ok: true, cidr: net.text, normalised: raw !== net.text }
}

/** True when any ACTIVE entry covers the address. */
export function isCovered(ip, entries = []) {
  if (!parseIp(ip)) return false
  return (entries || []).some((e) => e && e.active !== false && ipInCidr(ip, e.cidr))
}

/**
 * Lockout pre-check the page runs before asking the server: would turning the
 * allowlist on (with this set of entries) keep the caller in?
 */
export function enableLockoutRisk(callerIp, entries = []) {
  if (!parseIp(callerIp)) return 'Your current IP cannot be read, so turning the allowlist on could lock you out.'
  if (!isCovered(callerIp, entries)) return `Your current IP (${callerIp}) is not covered by an active range. Add it first.`
  return null
}

/** Plain-English sentence for a console_check_access() refusal. */
export function blockedReasonText(reason, ip) {
  if (reason === 'ip_unknown') return 'Your network address could not be read, and the console only allows listed addresses.'
  if (reason === 'not_listed') return `Your network address${ip ? ` (${ip})` : ''} is not on the console IP allowlist.`
  return 'The console IP policy does not allow this connection.'
}

/** One-line status for an SSO org row from admin_get_access_policies(). */
export function ssoOrgStatus(org) {
  if (!org) return { tone: 'default', label: 'Unknown' }
  if (org.required) return { tone: 'warning', label: 'SSO required' }
  if (Number(org.active_connections) > 0) return { tone: 'info', label: 'SSO available, password allowed' }
  return { tone: 'default', label: 'No active SSO connection' }
}

/**
 * Can SSO be required for this org without locking people out? Mirrors the
 * admin_set_sso_required guard so the button explains itself.
 */
export function ssoEnableBlocker(org, registeredDomains = []) {
  const doms = (org?.active_domains || []).map((d) => String(d).toLowerCase())
  if (doms.length === 0) return 'No active SSO connection with email domains in this organisation.'
  const reg = new Set((registeredDomains || []).map((d) => String(d).toLowerCase()))
  const missing = doms.filter((d) => !reg.has(d))
  if (missing.length) return `Not registered with Supabase Auth: ${missing.join(', ')}.`
  return null
}

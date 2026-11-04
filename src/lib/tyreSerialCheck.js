/**
 * Tyre serial checks - pure, no I/O.
 *
 * One physical tyre can only be on one wheel. When the register shows the same
 * serial on two wheels, one of the two entries is wrong (TM424: YMM36599 on
 * LHF2 and LHRI). Measured live 2026-11-04 over active tyre_records: 26 assets
 * carry the same serial on two or more of their own wheels, 57 serials are
 * active on more than one asset.
 *
 * Most of those are not real serials at all: a tyre SIZE typed into the serial
 * column ("205/85 R 16"), a number Excel turned into scientific notation
 * ("1.25131E+11") or a filler like "1". Those are reported as their own kind,
 * because the fix is different: a duplicate needs someone to look at the wheel,
 * a bad serial needs the right number typed in.
 */

const PLACEHOLDER = /^(?:n\/?a|-+|0+|null|none|nil|unknown|tbc|tba|x+)$/i
const EXCEL = /^\d+(?:\.\d+)?e\+?\d+$/i
const SIZE = [
  /^\d{2,3}\s*\/\s*\d{2,3}\s*[a-z]*\s*\d{2}(?:\.\d)?\b/i, // 205/85 R 16, 315/80R22.5
  /^\d{2,3}(?:\.\d+)?\s*r\s*\d{2}(?:\.\d)?\b/i, // 195 R 15, 12.00R24
  /^\d{1,2}(?:\.\d+)?\s*-\s*\d{2}(?:\.\d)?\b/i, // 23.5-25, 10-16.5
]

/** Upper-case, single spaces, trimmed; '' for nothing. */
export function canonSerial(serial) {
  return serial == null ? '' : String(serial).replace(/\s+/g, ' ').trim().toUpperCase()
}

export const SERIAL_PROBLEM_LABEL = Object.freeze({
  size: 'Looks like a tyre size, not a serial',
  excel: 'Number damaged by Excel',
  too_short: 'Too short to be a serial',
})

/**
 * What is wrong with a serial as typed, or null when it looks like a serial.
 * A blank or placeholder is "not recorded", not a problem, so it is null too.
 */
export function serialProblem(serial) {
  const s = canonSerial(serial)
  if (!s || PLACEHOLDER.test(s)) return null
  if (EXCEL.test(s)) return 'excel'
  if (SIZE.some((re) => re.test(s))) return 'size'
  if (s.replace(/[^A-Z0-9]/g, '').length < 4) return 'too_short'
  return null
}

/** True when the value is a usable serial (present, not a placeholder, no problem). */
export function isRealSerial(serial) {
  const s = canonSerial(serial)
  return !!s && !PLACEHOLDER.test(s) && serialProblem(s) == null
}

/**
 * Check the tyres on one vehicle.
 *
 * @param {Array<{position:string, serial?:string|null}>} entries
 * @returns {{
 *   byPosition: Record<string, {kind:'duplicate', serial:string, others:string[]}
 *                             | {kind:'size'|'excel'|'too_short', serial:string}>,
 *   duplicates: {serial:string, positions:string[]}[],
 *   invalid: {position:string, serial:string, kind:string}[],
 *   count: number,
 * }}
 */
export function serialFlags(entries = []) {
  const byPosition = {}
  const invalid = []
  const seen = new Map()
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e?.position) continue
    const serial = canonSerial(e.serial)
    if (!serial || PLACEHOLDER.test(serial)) continue
    const kind = serialProblem(serial)
    if (kind) {
      byPosition[e.position] = { kind, serial }
      invalid.push({ position: e.position, serial, kind })
      continue
    }
    if (!seen.has(serial)) seen.set(serial, [])
    if (!seen.get(serial).includes(e.position)) seen.get(serial).push(e.position)
  }
  const duplicates = []
  for (const [serial, positions] of seen) {
    if (positions.length < 2) continue
    duplicates.push({ serial, positions })
    for (const p of positions) {
      byPosition[p] = { kind: 'duplicate', serial, others: positions.filter((x) => x !== p) }
    }
  }
  return { byPosition, duplicates, invalid, count: Object.keys(byPosition).length }
}

/** One short sentence for a card, or '' when the wheel is fine. */
export function serialFlagText(flag) {
  if (!flag) return ''
  if (flag.kind === 'duplicate') return `Same serial as ${flag.others.join(', ')}`
  return SERIAL_PROBLEM_LABEL[flag.kind] || 'Check serial'
}

/**
 * Fleet-wide findings over active tyre rows ({asset_no, country, tyre_position,
 * serial_no}): the same serial on two wheels of one vehicle, the same serial on
 * two vehicles, and values that are not serials. Grouped per country, because
 * the same asset code in another country is a different machine.
 */
export function fleetSerialFindings(rows = []) {
  const perAsset = new Map()
  const perSerial = new Map()
  const invalid = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.asset_no) continue
    const serial = canonSerial(r.serial_no)
    if (!serial || PLACEHOLDER.test(serial)) continue
    const country = r.country || ''
    const kind = serialProblem(serial)
    if (kind) {
      invalid.push({ asset_no: r.asset_no, country, position: r.tyre_position || '', serial, kind })
      continue
    }
    const ak = `${country}|${r.asset_no}`
    if (!perAsset.has(ak)) perAsset.set(ak, { asset_no: r.asset_no, country, entries: [] })
    perAsset.get(ak).entries.push({ position: r.tyre_position || '?', serial })
    const sk = `${country}|${serial}`
    if (!perSerial.has(sk)) perSerial.set(sk, { serial, country, assets: new Set() })
    perSerial.get(sk).assets.add(r.asset_no)
  }
  const sameVehicle = []
  for (const a of perAsset.values()) {
    for (const d of serialFlags(a.entries).duplicates) {
      sameVehicle.push({ asset_no: a.asset_no, country: a.country, serial: d.serial, positions: d.positions })
    }
  }
  const multiVehicle = [...perSerial.values()]
    .filter((s) => s.assets.size > 1)
    .map((s) => ({ serial: s.serial, country: s.country, assets: [...s.assets].sort() }))
  const byText = (a, b) => String(a).localeCompare(String(b))
  sameVehicle.sort((a, b) => byText(a.asset_no, b.asset_no))
  multiVehicle.sort((a, b) => byText(a.serial, b.serial))
  invalid.sort((a, b) => byText(a.asset_no, b.asset_no) || byText(a.position, b.position))
  return { sameVehicle, multiVehicle, invalid }
}

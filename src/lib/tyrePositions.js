/**
 * Tyre Position Intelligence — canonical axle/position naming.
 *
 * Single source of truth for the fleet position-coding scheme used across
 * the Green Concrete tyre inspection / consumption reports.
 *
 * Code grammar:  [SIDE][H] [AXLE] [No?] [-?] [I|O?]
 *   SIDE  L | R          → Left Hand / Right Hand
 *   AXLE  F | C | R      → Front (steer) / Center / Rear (drive)
 *   No    1..n           → axle ordinal within its group (optional)
 *   I | O                → Inner / Outer dual wheel (optional)
 *
 * Examples:  LHF1, RHF2, LHRI, RHRO, LHCI, RHCO, LHR1, LHR1-O
 * Trailer / lift / tag positions use TLx, LAx, TGx prefixes.
 *
 * The codes double as a stable storage key (tyre_records.position) and a
 * human-readable label via describePosition().
 */

// ── Functional axle groups (analytics buckets) ─────────────────────────────────
export const AXLE_GROUPS = ['Steer', 'Drive', 'Trailer', 'Lift Axle', 'Tag Axle', 'Other']

export const GROUP_ICONS = {
  Steer: '🔵',
  Drive: '🔴',
  Trailer: '🟡',
  'Lift Axle': '🟢',
  'Tag Axle': '🟣',
  Other: '⚪',
}

const SIDE = { L: 'Left', R: 'Right' }
const AXLE = { F: 'Front', C: 'Center', R: 'Rear' }
const IO   = { I: 'Inner', O: 'Outer' }

// Front → steering axle, Center/Rear → driving axles.
const GROUP_OF_AXLE = { F: 'Steer', C: 'Drive', R: 'Drive' }

/**
 * Parse a raw position string into its components.
 * Returns null when the string is not a recognised position code.
 */
export function parsePosition(raw) {
  if (!raw) return null
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '')

  // Trailer / Lift / Tag explicit prefixes
  const special = s.match(/^(TL|TR|LA|TG|TAG)(\d*)$/)
  if (special) {
    const grp = special[1] === 'LA' ? 'Lift Axle'
              : special[1] === 'TG' || special[1] === 'TAG' ? 'Tag Axle'
              : 'Trailer'
    return { raw: s, side: null, axle: grp, axleNo: special[2] ? +special[2] : null, io: null, group: grp }
  }

  // Standard [L|R]H? [F|C|R] [No?] [-? I|O?]
  const m = s.match(/^(L|R)H?([FCR])(\d*)-?([IO])?$/)
  if (!m) return null
  const [, side, axle, no, io] = m
  return {
    raw: s,
    side,                                  // 'L' | 'R'
    axle,                                  // 'F' | 'C' | 'R'
    axleNo: no ? +no : null,
    io: io || null,                        // 'I' | 'O' | null
    group: GROUP_OF_AXLE[axle] || 'Other',
  }
}

/**
 * Map any position string (code or free text) to a functional axle group.
 * Drop-in replacement for the legacy normalizePosition helpers.
 */
export function normalizePosition(pos) {
  if (!pos) return 'Other'
  const parsed = parsePosition(pos)
  if (parsed) return parsed.group

  // Free-text fallback (legacy / ERP labels)
  const p = String(pos).toLowerCase()
  if (p.includes('steer') || p.includes('front')) return 'Steer'
  if (p.includes('trailer')) return 'Trailer'
  if (p.includes('lift')) return 'Lift Axle'
  if (p.includes('tag')) return 'Tag Axle'
  if (p.includes('drive') || p.includes('rear') || p.includes('back') ||
      p.includes('center') || p.includes('centre')) return 'Drive'
  return 'Other'
}

/**
 * Human-readable label for a position code. Falls back to the raw value.
 * e.g. 'LHR1-O' → 'Left Rear Axle 1 Outer'
 */
export function describePosition(raw) {
  const p = parsePosition(raw)
  if (!p) return raw ? String(raw) : '—'
  if (p.side === null) return p.axleNo ? `${p.axle} ${p.axleNo}` : p.axle
  return [SIDE[p.side], AXLE[p.axle], p.axleNo ? `Axle ${p.axleNo}` : null, IO[p.io]]
    .filter(Boolean).join(' ')
}

/**
 * Normalise a raw inspection/ERP position token to its canonical code so
 * the same wheel always stores identically. Returns upper-cased canonical
 * form, or the trimmed original when it can't be parsed.
 */
export function canonicalCode(raw) {
  const p = parsePosition(raw)
  if (!p) return raw ? String(raw).trim() : null
  if (p.side === null) return p.raw
  // Match source-report convention: dash before I/O only when an axle number
  // is present (LHR1-O), otherwise joined (LHRI, RHRO, LHCI).
  const io = p.io ? (p.axleNo != null ? `-${p.io}` : p.io) : ''
  return `${p.side}H${p.axle}${p.axleNo ?? ''}${io}`
}

// ── Standard axle layouts (ordered wheel maps for diagrams / inspections) ──────
// Each layout lists position codes left→right, front→rear.
export const AXLE_LAYOUTS = {
  // 5-axle line / placing pump (2 steer + 3 single rear)
  '5_AXLE_PUMP': {
    label: '5 Axles — Pump',
    rows: [['LHF1', 'RHF1'], ['LHF2', 'RHF2'], ['LHR1', 'RHR1'], ['LHR2', 'RHR2'], ['LHR3', 'RHR3']],
  },
  // Truck-mixer / 8x4 (2 steer + center dual + rear dual)
  'TM_8X4': {
    label: 'Truck Mixer 8×4',
    rows: [
      ['LHF1', 'RHF1'],
      ['LHF2', 'RHF2'],
      ['LHCO', 'LHCI', 'RHCI', 'RHCO'],
      ['LHRO', 'LHRI', 'RHRI', 'RHRO'],
    ],
  },
  // 6x4 (1 steer + center dual + rear dual)
  'TM_6X4': {
    label: 'Truck Mixer 6×4',
    rows: [
      ['LHF1', 'RHF1'],
      ['LHCO', 'LHCI', 'RHCI', 'RHCO'],
      ['LHRO', 'LHRI', 'RHRI', 'RHRO'],
    ],
  },
  // 4x2 light / pickup (1 steer + 1 rear)
  '4X2': {
    label: '4×2 — Pickup / Car',
    rows: [['LHF1', 'RHF1'], ['LHR1', 'RHR1']],
  },
}

/** Flat list of every distinct code in a layout (handy for selects). */
export function layoutCodes(key) {
  const l = AXLE_LAYOUTS[key]
  return l ? l.rows.flat() : []
}

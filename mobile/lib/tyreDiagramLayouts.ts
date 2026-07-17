/**
 * tyreDiagramLayouts - pure data + helpers for the vehicle tyre diagram.
 *
 * Faithful port of the WEB app's per-vehicle-type layout data
 * (src/components/VehicleTyreDiagram.jsx + src/lib/tyrePositions.js).
 *
 * The visual bodies live in the RN component (components/VehicleTyreDiagram.tsx);
 * this module only holds coordinate data + the resolver/relabel logic, so it
 * carries a `bodyKey` string instead of a component reference.
 */

// ── Risk colours (ported verbatim from the web RISK palette) ────────────────────
export interface RiskColor {
  rim: string
  glow: string
  dark: string
  label: string
}

export const RISK: Record<'good' | 'warning' | 'critical' | 'none', RiskColor> = {
  good:     { rim: '#22c55e', glow: '#16a34a', dark: '#15803d', label: 'Good' },
  warning:  { rim: '#f59e0b', glow: '#d97706', dark: '#b45309', label: 'Warning' },
  critical: { rim: '#ef4444', glow: '#dc2626', dark: '#b91c1c', label: 'Critical' },
  none:     { rim: '#6b7280', glow: '#4b5563', dark: '#374151', label: 'No Data' },
}

export type RiskKey = keyof typeof RISK

// ── Body keys (one per web Body component) ──────────────────────────────────────
export type BodyKey =
  | 'pickup'
  | 'canter'
  | 'triMixer'
  | 'concretePump'
  | 'wheelLoader'
  | 'bus'
  | 'tata'
  | 'ashokLeyland'

export interface TyreDef {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
}

export interface DiagramLayout {
  emoji: string
  viewH: number
  bodyKey: BodyKey
  tyres: TyreDef[]
}

// ── Layout definitions (coordinates ported verbatim from the web LAYOUTS) ───────
export const LAYOUTS: Record<string, DiagramLayout> = {
  Pickup: {
    emoji: '🛻', viewH: 320,
    bodyKey: 'pickup',
    tyres: [
      { id: 'FL', x: 32,  y: 48,  w: 23, h: 44, label: 'FL' },
      { id: 'FR', x: 145, y: 48,  w: 23, h: 44, label: 'FR' },
      { id: 'RL', x: 32,  y: 192, w: 23, h: 44, label: 'RL' },
      { id: 'RR', x: 145, y: 192, w: 23, h: 44, label: 'RR' },
    ],
  },
  'Wheel loader': {
    emoji: '🚜', viewH: 258,
    bodyKey: 'wheelLoader',
    tyres: [
      { id: 'FL', x: 24,  y: 22,  w: 32, h: 56, label: 'FL' },
      { id: 'FR', x: 144, y: 22,  w: 32, h: 56, label: 'FR' },
      { id: 'RL', x: 24,  y: 155, w: 32, h: 56, label: 'RL' },
      { id: 'RR', x: 144, y: 155, w: 32, h: 56, label: 'RR' },
    ],
  },
  'Skid loader': {
    emoji: '🚜', viewH: 258,
    bodyKey: 'wheelLoader',
    tyres: [
      { id: 'FL', x: 24,  y: 22,  w: 32, h: 56, label: 'FL' },
      { id: 'FR', x: 144, y: 22,  w: 32, h: 56, label: 'FR' },
      { id: 'RL', x: 24,  y: 155, w: 32, h: 56, label: 'RL' },
      { id: 'RR', x: 144, y: 155, w: 32, h: 56, label: 'RR' },
    ],
  },
  Canter: {
    emoji: '🚚', viewH: 310,
    bodyKey: 'canter',
    tyres: [
      { id: 'FL',  x: 31,  y: 36,  w: 22, h: 40, label: 'FL'  },
      { id: 'FR',  x: 147, y: 36,  w: 22, h: 40, label: 'FR'  },
      { id: 'RLo', x: 16,  y: 170, w: 20, h: 38, label: 'RLo' },
      { id: 'RLi', x: 38,  y: 170, w: 20, h: 38, label: 'RLi' },
      { id: 'RRi', x: 142, y: 170, w: 20, h: 38, label: 'RRi' },
      { id: 'RRo', x: 164, y: 170, w: 20, h: 38, label: 'RRo' },
    ],
  },
  'Tri-mixer': {
    emoji: '🚛', viewH: 360,
    bodyKey: 'triMixer',
    tyres: [
      { id: 'F1L',  x: 29,  y: 24,  w: 22, h: 38, label: 'F1L'  },
      { id: 'F1R',  x: 149, y: 24,  w: 22, h: 38, label: 'F1R'  },
      { id: 'F2L',  x: 29,  y: 76,  w: 22, h: 38, label: 'F2L'  },
      { id: 'F2R',  x: 149, y: 76,  w: 22, h: 38, label: 'F2R'  },
      { id: 'R1Lo', x: 14,  y: 170, w: 19, h: 35, label: 'R1Lo' },
      { id: 'R1Li', x: 35,  y: 170, w: 19, h: 35, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 170, w: 19, h: 35, label: 'R1Ri' },
      { id: 'R1Ro', x: 167, y: 170, w: 19, h: 35, label: 'R1Ro' },
      { id: 'R2Lo', x: 14,  y: 218, w: 19, h: 35, label: 'R2Lo' },
      { id: 'R2Li', x: 35,  y: 218, w: 19, h: 35, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 218, w: 19, h: 35, label: 'R2Ri' },
      { id: 'R2Ro', x: 167, y: 218, w: 19, h: 35, label: 'R2Ro' },
    ],
  },
  Bus: {
    emoji: '🚌', viewH: 330,
    bodyKey: 'bus',
    tyres: [
      { id: 'FL',  x: 14,  y: 38,  w: 22, h: 42, label: 'FL'  },
      { id: 'FR',  x: 164, y: 38,  w: 22, h: 42, label: 'FR'  },
      { id: 'RLo', x: 0,   y: 192, w: 20, h: 38, label: 'RLo' },
      { id: 'RLi', x: 22,  y: 192, w: 20, h: 38, label: 'RLi' },
      { id: 'RRi', x: 158, y: 192, w: 20, h: 38, label: 'RRi' },
      { id: 'RRo', x: 180, y: 192, w: 20, h: 38, label: 'RRo' },
    ],
  },
  Tata: {
    emoji: '🚛', viewH: 305,
    bodyKey: 'tata',
    tyres: [
      { id: 'FL',  x: 31,  y: 32,  w: 22, h: 40, label: 'FL'  },
      { id: 'FR',  x: 147, y: 32,  w: 22, h: 40, label: 'FR'  },
      { id: 'RLo', x: 16,  y: 178, w: 20, h: 36, label: 'RLo' },
      { id: 'RLi', x: 38,  y: 178, w: 20, h: 36, label: 'RLi' },
      { id: 'RRi', x: 142, y: 178, w: 20, h: 36, label: 'RRi' },
      { id: 'RRo', x: 164, y: 178, w: 20, h: 36, label: 'RRo' },
    ],
  },
  'Ashok Leyland': {
    emoji: '🚚', viewH: 305,
    bodyKey: 'ashokLeyland',
    tyres: [
      { id: 'FL',  x: 31,  y: 32,  w: 22, h: 40, label: 'FL'  },
      { id: 'FR',  x: 147, y: 32,  w: 22, h: 40, label: 'FR'  },
      { id: 'RLo', x: 16,  y: 178, w: 20, h: 36, label: 'RLo' },
      { id: 'RLi', x: 38,  y: 178, w: 20, h: 36, label: 'RLi' },
      { id: 'RRi', x: 142, y: 178, w: 20, h: 36, label: 'RRi' },
      { id: 'RRo', x: 164, y: 178, w: 20, h: 36, label: 'RRo' },
    ],
  },
  // Heavy 6x4 truck (D tanker, spider/line pump, crane, 8/10-wheeler):
  // 1 steer axle + 2 dual-tyre drive axles = 10 tyres. Not in the web LAYOUTS
  // (web collapses these onto Pickup/Concrete pump); added so the diagram
  // matches the real fleet configuration in lib/types.ts (Truck6x4) instead of
  // showing extra steer axles or a 4-tyre pickup.
  'Truck 6x4': {
    emoji: '🚛', viewH: 310,
    bodyKey: 'canter',
    tyres: [
      { id: 'FL',   x: 31,  y: 36,  w: 22, h: 40, label: 'FL'   },
      { id: 'FR',   x: 147, y: 36,  w: 22, h: 40, label: 'FR'   },
      { id: 'R1Lo', x: 14,  y: 170, w: 19, h: 35, label: 'R1Lo' },
      { id: 'R1Li', x: 35,  y: 170, w: 19, h: 35, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 170, w: 19, h: 35, label: 'R1Ri' },
      { id: 'R1Ro', x: 167, y: 170, w: 19, h: 35, label: 'R1Ro' },
      { id: 'R2Lo', x: 14,  y: 218, w: 19, h: 35, label: 'R2Lo' },
      { id: 'R2Li', x: 35,  y: 218, w: 19, h: 35, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 218, w: 19, h: 35, label: 'R2Ri' },
      { id: 'R2Ro', x: 167, y: 218, w: 19, h: 35, label: 'R2Ro' },
    ],
  },
  // MP concrete pump: 3 single-tyre steer axles up front, then 2 dual-tyre
  // drive axles at the rear (14 tyres total).
  'Concrete pump': {
    emoji: '🏗️', viewH: 375,
    bodyKey: 'concretePump',
    tyres: [
      { id: 'F1L',  x: 29,  y: 40,  w: 22, h: 38, label: 'F1L'  },
      { id: 'F1R',  x: 149, y: 40,  w: 22, h: 38, label: 'F1R'  },
      { id: 'F2L',  x: 29,  y: 84,  w: 22, h: 38, label: 'F2L'  },
      { id: 'F2R',  x: 149, y: 84,  w: 22, h: 38, label: 'F2R'  },
      { id: 'F3L',  x: 29,  y: 128, w: 22, h: 38, label: 'F3L'  },
      { id: 'F3R',  x: 149, y: 128, w: 22, h: 38, label: 'F3R'  },
      { id: 'R1Lo', x: 13,  y: 258, w: 19, h: 33, label: 'R1Lo' },
      { id: 'R1Li', x: 34,  y: 258, w: 19, h: 33, label: 'R1Li' },
      { id: 'R1Ri', x: 147, y: 258, w: 19, h: 33, label: 'R1Ri' },
      { id: 'R1Ro', x: 168, y: 258, w: 19, h: 33, label: 'R1Ro' },
      { id: 'R2Lo', x: 13,  y: 300, w: 19, h: 33, label: 'R2Lo' },
      { id: 'R2Li', x: 34,  y: 300, w: 19, h: 33, label: 'R2Li' },
      { id: 'R2Ri', x: 147, y: 300, w: 19, h: 33, label: 'R2Ri' },
      { id: 'R2Ro', x: 168, y: 300, w: 19, h: 33, label: 'R2Ro' },
    ],
  },
}

// ── Vehicle type normaliser - maps any DB/prop value to a LAYOUTS key ────────────
// Case-insensitive index of the layout keys ("TR-MIXER", "tri-mixer ", "Tri-mixer"
// all resolve the same way - site data carries mixed casing).
const LAYOUT_KEY_INDEX: Record<string, string> = {}
Object.keys(LAYOUTS).forEach(k => { LAYOUT_KEY_INDEX[k.toLowerCase().replace(/[\s\-_]+/g, '')] = k })

export function resolveVehicleType(vt?: string | null): string {
  const raw = String(vt ?? '').trim()
  if (!raw) return 'Pickup'

  // Exact layout-key match, case/spacing-insensitive.
  const s = raw.toLowerCase()
  const compact = s.replace(/[\s\-_]+/g, '')
  const exact = LAYOUT_KEY_INDEX[compact]
  if (exact) return exact

  // Plate-number prefix detection - first 2 alpha chars of asset_no
  const prefix = (raw.match(/^[A-Za-z]+/) || [''])[0].toUpperCase().slice(0, 2)
  const PREFIX_MAP: Record<string, string> = {
    TM: 'Tri-mixer',
    MP: 'Concrete pump',
    WL: 'Wheel loader',
    SL: 'Skid loader',
    PL: 'Pickup',
  }
  if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix]

  // Explicit "N-Wheeler" names FIRST - "wheeler" contains "wheel" and used to
  // fall into the 4-tyre Wheel loader layout.
  const wheeler = compact.match(/(\d+)wheeler/)
  if (wheeler) {
    const n = parseInt(wheeler[1], 10)
    if (n >= 12) return 'Tri-mixer'
    if (n >= 8) return 'Truck 6x4'
    if (n >= 6) return 'Canter'
    return 'Pickup'
  }

  // Keyword fallback - covers the real fleet's vehicle_type spellings
  // (Tr-Mixer, Wheel_Loader, Line/Spider/Stationary Pump, Placing Boom, ...).
  if (s.includes('tri') || s.includes('mixer') || s.includes('transit')) return 'Tri-mixer'
  if (s.includes('boom') || s.includes('placing'))         return 'Concrete pump'
  // Stationary / skid-mounted pumps are NOT the 5-axle truck-mounted pump -
  // fall back to the minimal 2-axle default instead of 3 steer axles.
  if (s.includes('stationary'))                            return 'Pickup'
  // Spider / line pumps ride a standard 6x4 truck chassis (10 tyres).
  if (compact.includes('spiderpump') || compact.includes('linepump') || s.includes('spider')) return 'Truck 6x4'
  if (s.includes('concrete') || s.includes('pump'))        return 'Concrete pump'
  if (s.includes('skid'))                                  return 'Skid loader'
  if (s.includes('wheel') || s.includes('loader') || s.includes('load')) return 'Wheel loader'
  if (s.includes('canter'))                                return 'Canter'
  if (s.includes('bus') || s.includes('coaster'))          return 'Bus'
  if (s.includes('tata'))                                  return 'Tata'
  if (s.includes('ashok') || s.includes('leyland'))        return 'Ashok Leyland'
  if (s.includes('pickup') || s.includes('pick up') || s.includes('pick-up')) return 'Pickup'
  // Heavy 6x4 chassis family (tankers, cranes, generic trucks): 10 tyres.
  if (s.includes('tanker') || s.includes('crane') || s.includes('truck')) return 'Truck 6x4'
  // Unknown -> minimal web default (2 axles / 4 tyres). Never guess extra axles.
  return 'Pickup'
}

// ── Legacy diagram-ID -> canonical GCC position code (type-aware) ───────────────
const _LEGACY_BASE: Record<string, string> = {
  FL: 'LHF1', FR: 'RHF1', RL: 'LHR1', RR: 'RHR1',
  RLo: 'LHRO', RLi: 'LHRI', RRi: 'RHRI', RRo: 'RHRO',
  F1L: 'LHF1', F1R: 'RHF1', F2L: 'LHF2', F2R: 'RHF2', F3L: 'LHF3', F3R: 'RHF3',
  R1Lo: 'LHR1-O', R1Li: 'LHR1-I', R1Ri: 'RHR1-I', R1Ro: 'RHR1-O',
  R2Lo: 'LHR2-O', R2Li: 'LHR2-I', R2Ri: 'RHR2-I', R2Ro: 'RHR2-O',
  R3Lo: 'LHR3-O', R3Li: 'LHR3-I', R3Ri: 'RHR3-I', R3Ro: 'RHR3-O',
}
// Tri-mixer (8x4): the first rear axle is the center drive axle (C).
const _LEGACY_TRIMIXER: Record<string, string> = {
  R1Lo: 'LHCO', R1Li: 'LHCI', R1Ri: 'RHCI', R1Ro: 'RHCO',
  R2Lo: 'LHRO', R2Li: 'LHRI', R2Ri: 'RHRI', R2Ro: 'RHRO',
}

export function legacyPositionCode(vehicleTypeKey: string, id: string): string {
  if (!id) return id
  const key = String(vehicleTypeKey || '').toLowerCase()
  if (key.includes('tri') || key.includes('mixer')) {
    if (_LEGACY_TRIMIXER[id]) return _LEGACY_TRIMIXER[id]
  }
  return _LEGACY_BASE[id] || id
}

// Relabel every tyre's display label to the canonical GCC position code
// (LHF1, LHRO, RHCI ...) while keeping the internal `id` stable, so saved
// inspections and diagram hit-testing continue to match.
Object.entries(LAYOUTS).forEach(([typeKey, layout]) => {
  layout.tyres.forEach(t => { t.label = legacyPositionCode(typeKey, t.id) })
})

// ── Tyreless (stationary / non-wheeled) equipment ───────────────────────────────
export const NO_TYRE_EQUIPMENT = [
  'generator', 'genset', 'chiller', 'ice plant', 'ice-plant', 'bt-plant', 'bt plant',
  'batch', 'reclaimer', 'compressor', 'tower light', 'light tower',
]

export function isTyrelessEquipment(vt?: string | null): boolean {
  if (!vt) return false
  const s = String(vt).toLowerCase().trim()
  return NO_TYRE_EQUIPMENT.some(k => s.includes(k))
}

/**
 * Canonical tyre position ids for a vehicle type, sourced from the same layout
 * the diagram renders, so the diagram and the inspection position list always
 * match. Returns [] for tyreless equipment.
 */
export function diagramPositions(vehicleType: string): string[] {
  if (isTyrelessEquipment(vehicleType)) return []
  const layout = LAYOUTS[resolveVehicleType(vehicleType)] || LAYOUTS.Pickup
  return layout.tyres.map(t => t.id)
}

// ── Position id -> structural role (single parser for BOTH id vocabularies) ─────
// The app carries two position vocabularies:
//   diagram ids (this file / web):  FL, RLo, F1L, R2Ro ...
//   lib/types.ts TYRE_POSITIONS:    FL1, RL1..RL4, SL/SR, AxleL1, Spare ...
// parsePositionStruct maps EITHER form onto (kind, side, axle, role) so the
// diagram can place any caller-supplied position onto the correct wheel slot.
export interface PositionStruct {
  kind: 'steer' | 'drive' | 'lift' | 'axle' | 'spare' | 'unknown'
  side: 'L' | 'R' | null
  axle: number
  role: 'outer' | 'inner' | 'single'
}

export function parsePositionStruct(id: string): PositionStruct {
  const u = String(id ?? '').toUpperCase().trim().replace(/[\s\-_]+/g, '')
  let m: RegExpMatchArray | null

  if (/^SP(ARE)?\d*$/.test(u)) return { kind: 'spare', side: null, axle: 0, role: 'single' }

  m = u.match(/^AXLE([LR])(\d*)$/)
  if (m) return { kind: 'axle', side: m[1] as 'L' | 'R', axle: m[2] ? parseInt(m[2], 10) : 1, role: 'single' }

  m = u.match(/^S([LR])(\d*)$/)
  if (m) return { kind: 'lift', side: m[1] as 'L' | 'R', axle: m[2] ? parseInt(m[2], 10) : 1, role: 'single' }

  m = u.match(/^F([LR])(\d*)$/)                                   // FL, FR, FL2
  if (m) return { kind: 'steer', side: m[1] as 'L' | 'R', axle: m[2] ? parseInt(m[2], 10) : 1, role: 'single' }

  m = u.match(/^F(\d+)([LR])$/)                                   // F1L, F3R
  if (m) return { kind: 'steer', side: m[2] as 'L' | 'R', axle: parseInt(m[1], 10), role: 'single' }

  m = u.match(/^R(\d*)([LR])([OI])$/)                             // RLo, R2Ri
  if (m) {
    return {
      kind: 'drive', side: m[2] as 'L' | 'R',
      axle: m[1] ? parseInt(m[1], 10) : 1,
      role: m[3] === 'O' ? 'outer' : 'inner',
    }
  }

  m = u.match(/^R([LR])(\d*)$/)                                   // RL, RR, RL1..RR4
  if (m) {
    const side = m[1] as 'L' | 'R'
    if (!m[2]) return { kind: 'drive', side, axle: 1, role: 'single' }
    const k = parseInt(m[2], 10)
    const first = k % 2 === 1
    return {
      kind: 'drive', side,
      axle: Math.ceil(k / 2),
      // Consecutive pairs form a dual axle; left counts outer->inner,
      // right counts inner->outer (mirrors lib/tyreLayout.ts pairing).
      role: side === 'L' ? (first ? 'outer' : 'inner') : (first ? 'inner' : 'outer'),
    }
  }

  return { kind: 'unknown', side: null, axle: 0, role: 'single' }
}

// ── Match caller-supplied positions onto the layout's wheel slots ───────────────
// Renders ONLY wheels the caller's position set actually contains: no ghost
// slots for positions the layout does not define, and no extra layout axles for
// positions the vehicle does not carry. Ids the layout has no slot for (Spare,
// lift axles on layouts without one, unknown tokens) are skipped. If NOTHING
// matches (fully foreign vocabulary), the full layout is returned so the
// diagram is never blank.
export interface MatchedTyre extends TyreDef {
  /** The caller's original position id - the tyreData/storage key. */
  positionId: string
}

export function matchPositionsToLayout(
  layout: DiagramLayout,
  positions: string[] | null | undefined,
): MatchedTyre[] {
  const all: MatchedTyre[] = layout.tyres.map(t => ({ ...t, positionId: t.id }))
  const list = (positions ?? []).map(p => String(p ?? '').trim()).filter(Boolean)
  if (list.length === 0) return all

  interface Slot { t: TyreDef; s: PositionStruct; used: boolean }
  const slots: Slot[] = layout.tyres.map(t => ({ t, s: parsePositionStruct(t.id), used: false }))

  // Overall axle rows (front -> back) for generic Axle/lift ordinal matching.
  const rowOf = (s: PositionStruct) => `${s.kind}:${s.axle}`
  const rowKeys: string[] = []
  slots
    .slice()
    .sort((a, b) => a.t.y - b.t.y)
    .forEach(sl => { const k = rowOf(sl.s); if (!rowKeys.includes(k)) rowKeys.push(k) })

  const roleOrder = (want: PositionStruct['role']): PositionStruct['role'][] =>
    want === 'single' ? ['single', 'outer', 'inner']
      : want === 'outer' ? ['outer', 'single', 'inner']
      : ['inner', 'single', 'outer']

  const matched: MatchedTyre[] = []
  for (const pos of list) {
    // 1. Exact id match (fast path - covers diagramPositions callers).
    const exact = slots.find(sl => !sl.used && sl.t.id.toUpperCase() === pos.toUpperCase())
    if (exact) { exact.used = true; matched.push({ ...exact.t, positionId: pos }); continue }

    const ps = parsePositionStruct(pos)
    if (ps.kind === 'spare' || ps.kind === 'unknown') continue

    let slot: Slot | undefined
    if (ps.kind === 'steer' || ps.kind === 'drive') {
      // 2. Structural match: same kind + side + axle, closest wheel role.
      for (const role of roleOrder(ps.role)) {
        slot = slots.find(sl =>
          !sl.used && sl.s.kind === ps.kind && sl.s.side === ps.side &&
          sl.s.axle === ps.axle && sl.s.role === role)
        if (slot) break
      }
    } else {
      // 3. Generic axle / lift ordinal -> Nth axle row, side-matched.
      const key = rowKeys[ps.axle - 1]
      if (key) {
        const rowSlots = slots
          .filter(sl => !sl.used && rowOf(sl.s) === key && (sl.s.side === ps.side || sl.s.side === null))
          .sort((a, b) => a.t.x - b.t.x)
        slot = ps.side === 'R' ? rowSlots[rowSlots.length - 1] : rowSlots[0]
      }
    }
    if (slot) { slot.used = true; matched.push({ ...slot.t, positionId: pos }) }
  }

  if (matched.length === 0) return all
  matched.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  return matched
}

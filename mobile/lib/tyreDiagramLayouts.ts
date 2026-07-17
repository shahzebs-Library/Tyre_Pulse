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
export function resolveVehicleType(vt?: string | null): string {
  if (!vt) return 'Pickup'
  if (LAYOUTS[vt]) return vt                                            // exact match
  const s = vt.toLowerCase().trim()

  // Plate-number prefix detection - first 2 alpha chars of asset_no
  const prefix = (vt.match(/^[A-Za-z]+/) || [''])[0].toUpperCase().slice(0, 2)
  const PREFIX_MAP: Record<string, string> = {
    TM: 'Tri-mixer',
    MP: 'Concrete pump',
    WL: 'Wheel loader',
    SL: 'Skid loader',
    PL: 'Pickup',
  }
  if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix]

  // Keyword fallback - covers the real fleet's vehicle_type spellings
  // (Tr-Mixer, Wheel_Loader, Line/Spider/Stationary Pump, Placing Boom, ...).
  if (s.includes('tri') || s.includes('mixer') || s.includes('transit')) return 'Tri-mixer'
  if (s.includes('boom') || s.includes('placing'))         return 'Concrete pump'
  if (s.includes('concrete') || s.includes('pump'))        return 'Concrete pump'
  if (s.includes('skid'))                                  return 'Skid loader'
  if (s.includes('wheel') || s.includes('loader') || s.includes('load')) return 'Wheel loader'
  if (s.includes('canter'))                                return 'Canter'
  if (s.includes('bus') || s.includes('coaster'))          return 'Bus'
  if (s.includes('tata'))                                  return 'Tata'
  if (s.includes('ashok') || s.includes('leyland'))        return 'Ashok Leyland'
  if (s.includes('pickup') || s.includes('pick up') || s.includes('pick-up')) return 'Pickup'
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

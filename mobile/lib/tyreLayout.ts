/**
 * tyreLayout - pure axle/position layout engine for the vehicle tyre diagram.
 *
 * Mirrors the WEB app's per-vehicle-type SVG structure
 * (src/components/VehicleTyreDiagram.jsx): steer axles carry single wheels,
 * drive axles carry dual (outer/inner) wheels, lift/tag and trailer axles carry
 * singles, and the spare (SP) is shown ONLY when the vehicle's position set
 * actually carries one.
 *
 * The engine is driven by the position id set that `getPositionsForVehicle`
 * (lib/types.ts) emits, so every id is guaranteed a coordinate and the tyre
 * COUNT always matches the real fleet configuration. Vehicle type only selects
 * the body silhouette + heading. Position ids are never rewritten - they remain
 * the storage keys for tyreData / tyre_conditions.
 *
 * Coordinate space matches the SVG viewBox used by the diagram:
 *   viewBox = `-10 -6 220 (viewH + 12)`  -> usable x 0..200, centre x = 100.
 *
 * NOTE: the CANONICAL per-vehicle-type layout map + type resolver live in
 * lib/tyreDiagramLayouts.ts (LAYOUTS / resolveVehicleType) - that is what
 * components/VehicleTyreDiagram.tsx renders. This module is a generative
 * fallback engine; its type resolution delegates to the canonical resolver.
 */

import { resolveVehicleType as resolveCanonicalVehicleType } from './tyreDiagramLayouts'

export type TyreSlotKind = 'steer' | 'drive' | 'lift' | 'trailer' | 'spare'
export type TyreSide = 'L' | 'R' | 'C'
export type VehicleBodyClass = 'car' | 'truck' | 'trailer'

export interface TyreSlot {
  /** Original position id - unchanged, matches the tyreData key. */
  id: string
  /** Short display label drawn on the wheel. */
  label: string
  kind: TyreSlotKind
  side: TyreSide
  /** Axle row index (front -> back), spares excluded. */
  axle: number
  x: number
  y: number
  w: number
  h: number
  /** Spare wheels render as a horizontal (lying-down) tyre. */
  horizontal?: boolean
}

export interface TyreDiagramLayout {
  viewH: number
  bodyClass: VehicleBodyClass
  chassisTop: number
  chassisBot: number
  /** Y centre of every running axle - used to draw axle beams under the body. */
  axleYs: number[]
  slots: TyreSlot[]
  hasSpare: boolean
  resolvedType: string
}

// ── Geometry constants (SVG units, centre x = 100) ─────────────────────────────
const LEFT_SINGLE = 45
const RIGHT_SINGLE = 155
const DUAL_LEFT_OUTER = 28
const DUAL_LEFT_INNER = 50
const DUAL_RIGHT_INNER = 150
const DUAL_RIGHT_OUTER = 172
const TRAILER_LEFT = 40
const TRAILER_RIGHT = 160

const STEER_W = 22
const STEER_H = 38
const SINGLE_W = 22
const SINGLE_H = 36
const DUAL_W = 19
const DUAL_H = 35
const LIFT_W = 20
const LIFT_H = 34
const TRAILER_W = 20
const TRAILER_H = 35
const SPARE_W = 38
const SPARE_H = 12

const TOP_Y = 26
const STEER_GAP = 50
const MID_GAP = 34
const DRIVE_GAP = 46
const TRAILER_TOP_Y = 48
const TRAILER_GAP = 52

// ── Position parsing ───────────────────────────────────────────────────────────
interface ParsedPos {
  id: string
  kind: TyreSlotKind
  side: TyreSide
  ordinal: number
}

/**
 * Classify a mobile position id into its structural role. Recognises the full
 * id vocabulary emitted by lib/types.ts TYRE_POSITIONS:
 *   FL/FR, FL1/FR1/FL2/FR2 (steer), RL/RR, RL1..RL4/RR1..RR4 (drive dual),
 *   SL/SR (lift/tag), AxleL1/AxleR2 (trailer), Spare.
 */
export function parsePosition(id: string): ParsedPos {
  const u = String(id ?? '').toUpperCase().replace(/[\s\-_]+/g, '')

  if (u === 'SP' || u.includes('SPARE')) return { id, kind: 'spare', side: 'C', ordinal: 0 }

  let m = u.match(/^AXLE([LR])(\d+)$/)
  if (m) return { id, kind: 'trailer', side: m[1] as TyreSide, ordinal: parseInt(m[2], 10) }

  // Lift / tag axle (SL, SR, SL1) - the 10-wheeler pusher axle.
  m = u.match(/^S([LR])(\d*)$/)
  if (m) return { id, kind: 'lift', side: m[1] as TyreSide, ordinal: m[2] ? parseInt(m[2], 10) : 1 }

  // Steer axle (FL, FR, FL1, FL2 ...).
  m = u.match(/^F([LR])(\d*)$/)
  if (m) return { id, kind: 'steer', side: m[1] as TyreSide, ordinal: m[2] ? parseInt(m[2], 10) : 1 }

  // Drive axle (RL, RR, RL1..RR4). Trailing number is the wheel ordinal within
  // the side across ALL drive wheels; consecutive pairs form dual axles.
  m = u.match(/^R([LR])(\d*)$/)
  if (m) return { id, kind: 'drive', side: m[1] as TyreSide, ordinal: m[2] ? parseInt(m[2], 10) : 1 }

  // Unknown -> treat as a trailing left drive wheel so it still renders.
  return { id, kind: 'drive', side: 'L', ordinal: 99 }
}

/** Short, legible label for a wheel. Keeps steer/drive/lift ids; compacts the rest. */
function labelFor(p: ParsedPos): string {
  if (p.kind === 'spare') return 'SP'
  if (p.kind === 'trailer') return `${p.side}${p.ordinal}`
  return String(p.id).toUpperCase()
}

function chunkPairs<T>(arr: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2))
  return out
}

// ── Vehicle-type resolution (heading + body silhouette hint) ───────────────────
/**
 * Friendly heading label for a vehicle type. DELEGATES to the single canonical
 * resolver in lib/tyreDiagramLayouts.ts (resolveVehicleType) so both layout
 * modules agree on how a vehicle_type string maps to a layout - do NOT
 * re-implement keyword matching here.
 */
export function resolveVehicleLabel(vehicleType: string | null | undefined): string {
  const s = String(vehicleType ?? '').trim()
  if (!s) return 'Vehicle'
  if (s.toLowerCase().includes('trailer')) return 'Trailer'
  return resolveCanonicalVehicleType(s)
}

interface AxleRow {
  kind: TyreSlotKind
  /** Ordered wheels laid left -> right. */
  wheels: { p: ParsedPos; x: number; w: number; h: number }[]
  h: number
}

/**
 * Build the complete diagram layout for a vehicle type + its position set.
 *
 * The axle order (front -> back) is: steer axles, drive axles (dual where the
 * side carries paired wheels), lift/tag axles, trailer axles. The spare, when
 * present, is laid horizontally beneath the chassis.
 */
export function buildTyreDiagramLayout(
  vehicleType: string | null | undefined,
  positions: string[],
): TyreDiagramLayout {
  const parsed = (positions ?? []).map(parsePosition)

  const steer = parsed.filter(p => p.kind === 'steer')
  const drive = parsed.filter(p => p.kind === 'drive')
  const lift = parsed.filter(p => p.kind === 'lift')
  const trailer = parsed.filter(p => p.kind === 'trailer')
  const spares = parsed.filter(p => p.kind === 'spare')

  const rows: AxleRow[] = []

  // 1. Steer axles - single wheel per side, grouped by ordinal.
  const steerAxleNos = Array.from(new Set(steer.map(p => p.ordinal))).sort((a, b) => a - b)
  steerAxleNos.forEach(no => {
    const l = steer.find(p => p.side === 'L' && p.ordinal === no)
    const r = steer.find(p => p.side === 'R' && p.ordinal === no)
    const wheels: AxleRow['wheels'] = []
    if (l) wheels.push({ p: l, x: LEFT_SINGLE - STEER_W / 2, w: STEER_W, h: STEER_H })
    if (r) wheels.push({ p: r, x: RIGHT_SINGLE - STEER_W / 2, w: STEER_W, h: STEER_H })
    rows.push({ kind: 'steer', wheels, h: STEER_H })
  })

  // 2. Drive axles - pair consecutive wheels per side into dual axles.
  const driveL = drive.filter(p => p.side === 'L').sort((a, b) => a.ordinal - b.ordinal)
  const driveR = drive.filter(p => p.side === 'R').sort((a, b) => a.ordinal - b.ordinal)
  const leftAxles = chunkPairs(driveL)
  const rightAxles = chunkPairs(driveR)
  const driveAxleCount = Math.max(leftAxles.length, rightAxles.length)
  for (let i = 0; i < driveAxleCount; i++) {
    const lPair = leftAxles[i] ?? []
    const rPair = rightAxles[i] ?? []
    const dual = lPair.length > 1 || rPair.length > 1
    const wheels: AxleRow['wheels'] = []
    if (dual) {
      // Left: outer (farthest from centre) first, then inner.
      if (lPair[0]) wheels.push({ p: lPair[0], x: DUAL_LEFT_OUTER - DUAL_W / 2, w: DUAL_W, h: DUAL_H })
      if (lPair[1]) wheels.push({ p: lPair[1], x: DUAL_LEFT_INNER - DUAL_W / 2, w: DUAL_W, h: DUAL_H })
      // Right: inner first, then outer (farthest from centre).
      if (rPair[0]) wheels.push({ p: rPair[0], x: DUAL_RIGHT_INNER - DUAL_W / 2, w: DUAL_W, h: DUAL_H })
      if (rPair[1]) wheels.push({ p: rPair[1], x: DUAL_RIGHT_OUTER - DUAL_W / 2, w: DUAL_W, h: DUAL_H })
    } else {
      if (lPair[0]) wheels.push({ p: lPair[0], x: LEFT_SINGLE - SINGLE_W / 2, w: SINGLE_W, h: SINGLE_H })
      if (rPair[0]) wheels.push({ p: rPair[0], x: RIGHT_SINGLE - SINGLE_W / 2, w: SINGLE_W, h: SINGLE_H })
    }
    rows.push({ kind: 'drive', wheels, h: dual ? DUAL_H : SINGLE_H })
  }

  // 3. Lift / tag axles - single wheel per side, grouped by ordinal.
  const liftAxleNos = Array.from(new Set(lift.map(p => p.ordinal))).sort((a, b) => a - b)
  liftAxleNos.forEach(no => {
    const l = lift.find(p => p.side === 'L' && p.ordinal === no)
    const r = lift.find(p => p.side === 'R' && p.ordinal === no)
    const wheels: AxleRow['wheels'] = []
    if (l) wheels.push({ p: l, x: LEFT_SINGLE - LIFT_W / 2, w: LIFT_W, h: LIFT_H })
    if (r) wheels.push({ p: r, x: RIGHT_SINGLE - LIFT_W / 2, w: LIFT_W, h: LIFT_H })
    rows.push({ kind: 'lift', wheels, h: LIFT_H })
  })

  // 4. Trailer axles - single wheel per side, grouped by ordinal (wider track).
  const trailerAxleNos = Array.from(new Set(trailer.map(p => p.ordinal))).sort((a, b) => a - b)
  trailerAxleNos.forEach(no => {
    const l = trailer.find(p => p.side === 'L' && p.ordinal === no)
    const r = trailer.find(p => p.side === 'R' && p.ordinal === no)
    const wheels: AxleRow['wheels'] = []
    if (l) wheels.push({ p: l, x: TRAILER_LEFT - TRAILER_W / 2, w: TRAILER_W, h: TRAILER_H })
    if (r) wheels.push({ p: r, x: TRAILER_RIGHT - TRAILER_W / 2, w: TRAILER_W, h: TRAILER_H })
    rows.push({ kind: 'trailer', wheels, h: TRAILER_H })
  })

  // ── Body class ───────────────────────────────────────────────────────────────
  const runningCount = parsed.length - spares.length
  const hasSteer = steerAxleNos.length > 0
  const isTrailerOnly = !hasSteer && trailerAxleNos.length > 0 && driveAxleCount === 0
  let bodyClass: VehicleBodyClass
  if (isTrailerOnly) bodyClass = 'trailer'
  else if (hasSteer && runningCount <= 4 && rows.every(r => r.kind !== 'drive' || r.wheels.every(w => w.w === SINGLE_W))) bodyClass = 'car'
  else bodyClass = 'truck'

  // ── Vertical placement ─────────────────────────────────────────────────────────
  const slots: TyreSlot[] = []
  const axleYs: number[] = []
  let cursor = bodyClass === 'trailer' ? TRAILER_TOP_Y : TOP_Y
  let prevKind: TyreSlotKind | null = null
  let axleIndex = 0

  rows.forEach(row => {
    // Visual gap between the steer block and the driven/rear block.
    if (prevKind === 'steer' && row.kind !== 'steer') cursor += MID_GAP
    const yc = cursor + row.h / 2
    axleYs.push(yc)
    row.wheels.forEach(wh => {
      slots.push({
        id: wh.p.id,
        label: labelFor(wh.p),
        kind: wh.p.kind,
        side: wh.p.side,
        axle: axleIndex,
        x: wh.x,
        y: yc - wh.h / 2,
        w: wh.w,
        h: wh.h,
      })
    })
    const gap = row.kind === 'steer' ? STEER_GAP
      : bodyClass === 'trailer' ? TRAILER_GAP
      : DRIVE_GAP
    cursor += gap
    prevKind = row.kind
    axleIndex += 1
  })

  const firstYc = axleYs[0] ?? TOP_Y + 20
  const lastYc = axleYs[axleYs.length - 1] ?? firstYc
  const lastRowH = rows.length ? rows[rows.length - 1].h : SINGLE_H
  const chassisTop = bodyClass === 'trailer' ? Math.max(8, firstYc - 30) : Math.max(8, firstYc - 22)
  const chassisBot = lastYc + lastRowH / 2 + 8

  // ── Spare - laid horizontally, centred, beneath the chassis ────────────────────
  const hasSpare = spares.length > 0
  let spareBottom = chassisBot
  if (hasSpare) {
    const totalW = spares.length * SPARE_W + Math.max(0, spares.length - 1) * 8
    let sx = 100 - totalW / 2
    const sy = chassisBot + 16
    spares.forEach(sp => {
      slots.push({
        id: sp.id,
        label: 'SP',
        kind: 'spare',
        side: 'C',
        axle: -1,
        x: sx,
        y: sy,
        w: SPARE_W,
        h: SPARE_H,
        horizontal: true,
      })
      sx += SPARE_W + 8
    })
    spareBottom = sy + SPARE_H
  }

  const viewH = spareBottom + 12

  return {
    viewH,
    bodyClass,
    chassisTop,
    chassisBot,
    axleYs,
    slots,
    hasSpare,
    resolvedType: resolveVehicleLabel(vehicleType),
  }
}

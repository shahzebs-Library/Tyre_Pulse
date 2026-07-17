/**
 * Vehicle Diagram engine - the SINGLE source for custom vehicle diagram
 * configurations designed in the super-admin Vehicle Designer (/console).
 *
 * A config describes a vehicle top-down: ordered axles (steer/drive/trailer/
 * lift, each single or dual), 0-2 spares, a body style and visual accents
 * (hazard indicators, roof beacon). `positionsFromConfig` converts a config
 * into a layout object in the SAME shape as the built-in LAYOUTS entries in
 * src/components/VehicleTyreDiagram.jsx (tyres: [{id,x,y,w,h,label}], viewH,
 * emoji) so the diagram component renders a custom layout unchanged. Wheel
 * slot ids reuse the component's internal vocabulary (F1L, R1Lo, ...) and
 * labels use the canonical GCC position codes (LHF1, LHR1-O, ...) from
 * src/lib/tyrePositions.js so saved inspections keep matching.
 *
 * Pure module: no React, no Supabase - safe for vitest and Node.
 */

export const DIAGRAM_CONFIG_VERSION = 1

export const AXLE_KINDS = ['steer', 'drive', 'trailer', 'lift']

export const BODY_STYLES = ['truck', 'mixer', 'pump', 'bus', 'pickup', 'trailer', 'loader', 'van']

export const MAX_AXLES = 6
export const MIN_AXLES = 1
export const MAX_SPARES = 2

/** Emoji shown next to the layout title, per body style. */
export const BODY_EMOJI = {
  truck: '🚚',
  mixer: '🚛',
  pump: '🏗️',
  bus: '🚌',
  pickup: '🛻',
  trailer: '🚛',
  loader: '🚜',
  van: '🚐',
}

/** Human labels for the designer UI. */
export const BODY_LABELS = {
  truck: 'Cargo truck',
  mixer: 'Transit mixer',
  pump: 'Concrete pump',
  bus: 'Bus / Coaster',
  pickup: 'Pickup',
  trailer: 'Trailer / Flatbed',
  loader: 'Wheel loader',
  van: 'Van',
}

export const AXLE_KIND_LABELS = {
  steer: 'Steer',
  drive: 'Drive',
  trailer: 'Trailer',
  lift: 'Lift',
}

export const DEFAULT_DIAGRAM_CONFIG = Object.freeze({
  version: DIAGRAM_CONFIG_VERSION,
  axles: Object.freeze([
    Object.freeze({ kind: 'steer', dual: false }),
    Object.freeze({ kind: 'drive', dual: true }),
  ]),
  spare: 0,
  body: 'truck',
  accents: Object.freeze({ hazard: false, beacon: false }),
})

// ── Geometry constants (200-wide viewBox, matches built-in LAYOUTS) ────────────
const SINGLE = { w: 22, h: 38, xL: 29, xR: 149 }
const DUAL = { w: 19, h: 35, xLo: 14, xLi: 35, xRi: 146, xRo: 167 }
const START_Y = 24          // first axle top
const AXLE_PITCH = 48       // vertical distance between consecutive axles
const CAB_GAP = 44          // extra gap between the steer block and the first rear axle
const SPARE_GAP = 30        // gap between last axle and the spare bay
const SPARE_W = 22
const SPARE_H = 38

function clampInt(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function normalizeAxle(raw) {
  const kind = AXLE_KINDS.includes(raw?.kind) ? raw.kind : 'drive'
  return { kind, dual: raw?.dual === true }
}

/**
 * Clamp any raw value (DB jsonb, user draft, null) into a valid diagram
 * config. Never throws, never mutates its input, always returns a fresh
 * object: 1..6 axles with valid kinds, spare 0..2, a valid body style and
 * boolean accents.
 *
 * @param {object|null|undefined} raw
 * @returns {{version:number, axles:Array<{kind:string,dual:boolean}>, spare:number, body:string, accents:{hazard:boolean,beacon:boolean}}}
 */
export function normalizeDiagramConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  let axles = Array.isArray(src.axles) ? src.axles.slice(0, MAX_AXLES).map(normalizeAxle) : []
  if (axles.length < MIN_AXLES) {
    axles = DEFAULT_DIAGRAM_CONFIG.axles.map((a) => ({ ...a }))
  }
  const body = BODY_STYLES.includes(src.body) ? src.body : 'truck'
  const spare = clampInt(src.spare, 0, MAX_SPARES, 0)
  const accents = {
    hazard: src.accents?.hazard === true,
    beacon: src.accents?.beacon === true,
  }
  return { version: DIAGRAM_CONFIG_VERSION, axles, spare, body, accents }
}

/**
 * Build the wheel slots + body geometry for a config.
 *
 * Returns a layout object shaped like a built-in LAYOUTS entry
 * ({ emoji, viewH, tyres: [{id,x,y,w,h,label}] }) plus `custom: true` and a
 * pure-data `bodySpec` that the CustomBody SVG renderer consumes (no Body
 * component here - this module stays React-free).
 *
 * @param {object} config raw or normalized diagram config
 * @returns {{emoji:string, viewH:number, custom:true, config:object, bodySpec:object, tyres:Array<{id:string,x:number,y:number,w:number,h:number,label:string}>}}
 */
export function positionsFromConfig(config) {
  const cfg = normalizeDiagramConfig(config)
  const tyres = []

  let frontNo = 0
  let rearNo = 0
  let y = START_Y
  let gapApplied = false
  let sawSteer = false
  let lastSteerBottom = null
  let lastBottom = START_Y

  cfg.axles.forEach((axle, i) => {
    const isSteer = axle.kind === 'steer'
    if (i > 0) y += AXLE_PITCH
    // One cab/body break between the leading steer group and the rear axles.
    if (!isSteer && sawSteer && !gapApplied) {
      y += CAB_GAP
      gapApplied = true
    }
    if (isSteer) sawSteer = true

    if (isSteer) {
      frontNo += 1
      const n = frontNo
      if (axle.dual) {
        tyres.push(
          { id: `F${n}Lo`, x: DUAL.xLo, y, w: DUAL.w, h: DUAL.h, label: `LHF${n}-O` },
          { id: `F${n}Li`, x: DUAL.xLi, y, w: DUAL.w, h: DUAL.h, label: `LHF${n}-I` },
          { id: `F${n}Ri`, x: DUAL.xRi, y, w: DUAL.w, h: DUAL.h, label: `RHF${n}-I` },
          { id: `F${n}Ro`, x: DUAL.xRo, y, w: DUAL.w, h: DUAL.h, label: `RHF${n}-O` },
        )
      } else {
        tyres.push(
          { id: `F${n}L`, x: SINGLE.xL, y, w: SINGLE.w, h: SINGLE.h, label: `LHF${n}` },
          { id: `F${n}R`, x: SINGLE.xR, y, w: SINGLE.w, h: SINGLE.h, label: `RHF${n}` },
        )
      }
      lastSteerBottom = y + (axle.dual ? DUAL.h : SINGLE.h)
    } else {
      rearNo += 1
      const n = rearNo
      if (axle.dual) {
        tyres.push(
          { id: `R${n}Lo`, x: DUAL.xLo, y, w: DUAL.w, h: DUAL.h, label: `LHR${n}-O` },
          { id: `R${n}Li`, x: DUAL.xLi, y, w: DUAL.w, h: DUAL.h, label: `LHR${n}-I` },
          { id: `R${n}Ri`, x: DUAL.xRi, y, w: DUAL.w, h: DUAL.h, label: `RHR${n}-I` },
          { id: `R${n}Ro`, x: DUAL.xRo, y, w: DUAL.w, h: DUAL.h, label: `RHR${n}-O` },
        )
      } else {
        tyres.push(
          { id: `R${n}L`, x: SINGLE.xL, y, w: SINGLE.w, h: SINGLE.h, label: `LHR${n}` },
          { id: `R${n}R`, x: SINGLE.xR, y, w: SINGLE.w, h: SINGLE.h, label: `RHR${n}` },
        )
      }
    }
    lastBottom = y + (axle.dual ? DUAL.h : SINGLE.h)
  })

  // Spare bay below the last axle, centered.
  let spareBottom = lastBottom
  if (cfg.spare > 0) {
    const spareY = lastBottom + SPARE_GAP
    if (cfg.spare === 1) {
      tyres.push({ id: 'SP1', x: 89, y: spareY, w: SPARE_W, h: SPARE_H, label: 'SP' })
    } else {
      tyres.push(
        { id: 'SP1', x: 62, y: spareY, w: SPARE_W, h: SPARE_H, label: 'SP1' },
        { id: 'SP2', x: 116, y: spareY, w: SPARE_W, h: SPARE_H, label: 'SP2' },
      )
    }
    spareBottom = spareY + SPARE_H
  }

  const viewH = spareBottom + 18

  // Body geometry: cab covers the steer block, hull covers the rest.
  const cabTop = 8
  const cabBottom = lastSteerBottom != null ? lastSteerBottom + 8 : START_Y + 26
  const hullTop = cabBottom + 4
  const hullBottom = lastBottom + 10

  return {
    emoji: BODY_EMOJI[cfg.body] || '🚚',
    viewH,
    custom: true,
    config: cfg,
    bodySpec: {
      body: cfg.body,
      accents: { ...cfg.accents },
      cab: { x: 57, y: cabTop, w: 86, h: Math.max(26, cabBottom - cabTop) },
      hull: { x: 57, y: hullTop, w: 86, h: Math.max(24, hullBottom - hullTop) },
      viewH,
    },
    tyres,
  }
}

/** Total wheel count (incl. spares) for a config - used by the designer UI. */
export function tyreCountFromConfig(config) {
  return positionsFromConfig(config).tyres.length
}

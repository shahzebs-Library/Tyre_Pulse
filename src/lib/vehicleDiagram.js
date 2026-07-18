/**
 * Vehicle Diagram engine - the SINGLE source for custom vehicle diagram
 * configurations designed in the super-admin Vehicle Designer (/console).
 *
 * A config describes a vehicle top-down: ordered axles (steer/drive/trailer/
 * lift, each single or dual, with optional per-axle lift, spacing and tyre
 * size), 0-2 spares, a body style and visual accents (hazard indicators with
 * selectable blink speed, roof beacon, headlights, rear work light).
 * `positionsFromConfig` converts a config into a layout object in the SAME
 * shape as the built-in LAYOUTS entries in
 * src/components/VehicleTyreDiagram.jsx (tyres: [{id,x,y,w,h,label}], viewH,
 * emoji) so the diagram component renders a custom layout unchanged. Wheel
 * slot ids reuse the component's internal vocabulary (F1L, R1Lo, ...) and
 * labels use the canonical GCC position codes (LHF1, LHR1-O, ...) from
 * src/lib/tyrePositions.js so saved inspections keep matching.
 *
 * BACKWARD COMPATIBILITY: every field added after V268 defaults to its
 * previous implicit behavior (lift off, spacing 'normal', tyreSize 'standard',
 * new accents off, hazardSpeed 'normal'), so configs saved before those fields
 * existed normalize and render byte-identically.
 *
 * Pure module: no React, no Supabase - safe for vitest and Node.
 */

export const DIAGRAM_CONFIG_VERSION = 1

export const AXLE_KINDS = ['steer', 'drive', 'trailer', 'lift']

export const BODY_STYLES = ['truck', 'mixer', 'pump', 'bus', 'pickup', 'trailer', 'loader', 'van']

export const AXLE_SPACINGS = ['compact', 'normal', 'wide']

export const TYRE_SIZES = ['standard', 'wide']

export const HAZARD_SPEEDS = ['slow', 'normal', 'fast']

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

export const AXLE_SPACING_LABELS = {
  compact: 'Compact',
  normal: 'Normal',
  wide: 'Wide',
}

export const TYRE_SIZE_LABELS = {
  standard: 'Standard',
  wide: 'Wide',
}

export const HAZARD_SPEED_LABELS = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
}

export const DEFAULT_DIAGRAM_CONFIG = Object.freeze({
  version: DIAGRAM_CONFIG_VERSION,
  axles: Object.freeze([
    Object.freeze({ kind: 'steer', dual: false, lift: false, spacing: 'normal', tyreSize: 'standard' }),
    Object.freeze({ kind: 'drive', dual: true, lift: false, spacing: 'normal', tyreSize: 'standard' }),
  ]),
  spare: 0,
  body: 'truck',
  accents: Object.freeze({
    hazard: false, beacon: false, headlights: false, workLight: false, hazardSpeed: 'normal',
  }),
})

// ── Geometry constants (200-wide viewBox, matches built-in LAYOUTS) ────────────
const SINGLE = { w: 22, h: 38, xL: 29, xR: 149 }
const DUAL = { w: 19, h: 35, xLo: 14, xLi: 35, xRi: 146, xRo: 167 }
const START_Y = 24          // first axle top
const AXLE_PITCH = 48       // vertical distance between consecutive axles ('normal')
const AXLE_PITCHES = { compact: 34, normal: AXLE_PITCH, wide: 66 }
const CAB_GAP = 44          // extra gap between the steer block and the first rear axle
const SPARE_GAP = 30        // gap between last axle and the spare bay
const SPARE_W = 22
const SPARE_H = 38
const LIFT_SCALE = 0.85     // lifted wheels render slightly smaller, centered on the axle
const WIDE_EXTRA_SINGLE = 4 // extra rect width for 'wide' tyres on a single axle
const WIDE_EXTRA_DUAL = 2   // (duals sit closer together, so grow less)

function round1(v) {
  return Math.round(v * 10) / 10
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function normalizeAxle(raw) {
  const kind = AXLE_KINDS.includes(raw?.kind) ? raw.kind : 'drive'
  return {
    kind,
    dual: raw?.dual === true,
    lift: raw?.lift === true,
    spacing: AXLE_SPACINGS.includes(raw?.spacing) ? raw.spacing : 'normal',
    tyreSize: TYRE_SIZES.includes(raw?.tyreSize) ? raw.tyreSize : 'standard',
  }
}

/**
 * Clamp any raw value (DB jsonb, user draft, null) into a valid diagram
 * config. Never throws, never mutates its input, always returns a fresh
 * object: 1..6 axles with valid kinds (plus lift/spacing/tyreSize defaults),
 * spare 0..2, a valid body style and a full accents object. Configs saved
 * before a field existed get that field's default, so they render unchanged.
 *
 * @param {object|null|undefined} raw
 * @returns {{version:number, axles:Array<{kind:string,dual:boolean,lift:boolean,spacing:string,tyreSize:string}>, spare:number, body:string, accents:{hazard:boolean,beacon:boolean,headlights:boolean,workLight:boolean,hazardSpeed:string}}}
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
    headlights: src.accents?.headlights === true,
    workLight: src.accents?.workLight === true,
    hazardSpeed: HAZARD_SPEEDS.includes(src.accents?.hazardSpeed) ? src.accents.hazardSpeed : 'normal',
  }
  return { version: DIAGRAM_CONFIG_VERSION, axles, spare, body, accents }
}

/**
 * Build the wheel slots + body geometry for a config.
 *
 * Returns a layout object shaped like a built-in LAYOUTS entry
 * ({ emoji, viewH, tyres: [{id,x,y,w,h,label}] }) plus `custom: true` and a
 * pure-data `bodySpec` that the CustomBody SVG renderer consumes (no Body
 * component here - this module stays React-free). Per-axle depth: `spacing`
 * changes the gap to the PREVIOUS axle, `tyreSize: 'wide'` widens the wheel
 * rects (center-preserving), `lift: true` shrinks the wheels ~15% centered on
 * the axle line and emits a LIFT marker in bodySpec.liftMarkers.
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
  const liftMarkers = []

  cfg.axles.forEach((axle, i) => {
    const isSteer = axle.kind === 'steer'
    if (i > 0) y += AXLE_PITCHES[axle.spacing] || AXLE_PITCH
    // One cab/body break between the leading steer group and the rear axles.
    if (!isSteer && sawSteer && !gapApplied) {
      y += CAB_GAP
      gapApplied = true
    }
    if (isSteer) sawSteer = true

    // Wheel rect dims for this axle: base single/dual, widened for 'wide'
    // tyres (center preserved), shrunk + centered when the axle is lifted.
    const base = axle.dual ? DUAL : SINGLE
    const extra = axle.tyreSize === 'wide' ? (axle.dual ? WIDE_EXTRA_DUAL : WIDE_EXTRA_SINGLE) : 0
    let w = base.w + extra
    let h = base.h
    let dx = -extra / 2
    let dy = 0
    if (axle.lift) {
      const w2 = round1(w * LIFT_SCALE)
      const h2 = round1(h * LIFT_SCALE)
      dx += (w - w2) / 2
      dy += (h - h2) / 2
      w = w2
      h = h2
    }
    const slot = (bx) => ({ x: round1(bx + dx), y: round1(y + dy), w, h })

    if (isSteer) {
      frontNo += 1
      const n = frontNo
      if (axle.dual) {
        tyres.push(
          { id: `F${n}Lo`, ...slot(DUAL.xLo), label: `LHF${n}-O` },
          { id: `F${n}Li`, ...slot(DUAL.xLi), label: `LHF${n}-I` },
          { id: `F${n}Ri`, ...slot(DUAL.xRi), label: `RHF${n}-I` },
          { id: `F${n}Ro`, ...slot(DUAL.xRo), label: `RHF${n}-O` },
        )
      } else {
        tyres.push(
          { id: `F${n}L`, ...slot(SINGLE.xL), label: `LHF${n}` },
          { id: `F${n}R`, ...slot(SINGLE.xR), label: `RHF${n}` },
        )
      }
      lastSteerBottom = y + base.h
    } else {
      rearNo += 1
      const n = rearNo
      if (axle.dual) {
        tyres.push(
          { id: `R${n}Lo`, ...slot(DUAL.xLo), label: `LHR${n}-O` },
          { id: `R${n}Li`, ...slot(DUAL.xLi), label: `LHR${n}-I` },
          { id: `R${n}Ri`, ...slot(DUAL.xRi), label: `RHR${n}-I` },
          { id: `R${n}Ro`, ...slot(DUAL.xRo), label: `RHR${n}-O` },
        )
      } else {
        tyres.push(
          { id: `R${n}L`, ...slot(SINGLE.xL), label: `LHR${n}` },
          { id: `R${n}R`, ...slot(SINGLE.xR), label: `RHR${n}` },
        )
      }
    }
    // Body/viewbox geometry uses the axle's NOMINAL footprint (unlifted base
    // height) so toggling lift never shifts the body or the page layout.
    if (axle.lift) liftMarkers.push({ y: round1(y + base.h / 2) })
    lastBottom = y + base.h
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
      liftMarkers,
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

// ── Built-in layout templates (reverse mapping for "Start from") ───────────────
// A compact, pure summary of the built-in LAYOUTS entries in
// src/components/VehicleTyreDiagram.jsx: each template lists its wheel rows
// (ids per axle, top to bottom) and a designer body style. builtinToConfig
// derives axle count / dual / kind FROM those tyre rows, so the seeded config
// approximates the built-in diagram. Kept here (not imported from the
// component) so this module stays React-free.
const BUILTIN_TEMPLATES = {
  Pickup: { body: 'pickup', rows: [['FL', 'FR'], ['RL', 'RR']] },
  'Wheel loader': { body: 'loader', rows: [['FL', 'FR'], ['RL', 'RR']] },
  'Skid loader': { body: 'loader', rows: [['FL', 'FR'], ['RL', 'RR']] },
  Canter: { body: 'truck', rows: [['FL', 'FR'], ['RLo', 'RLi', 'RRi', 'RRo']] },
  'Tri-mixer': {
    body: 'mixer',
    rows: [
      ['F1L', 'F1R'], ['F2L', 'F2R'],
      ['R1Lo', 'R1Li', 'R1Ri', 'R1Ro'], ['R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
    ],
  },
  Bus: { body: 'bus', rows: [['FL', 'FR'], ['RLo', 'RLi', 'RRi', 'RRo']] },
  Tata: { body: 'truck', rows: [['FL', 'FR'], ['RLo', 'RLi', 'RRi', 'RRo']] },
  'Ashok Leyland': { body: 'truck', rows: [['FL', 'FR'], ['RLo', 'RLi', 'RRi', 'RRo']] },
  'Concrete pump': {
    body: 'pump',
    rows: [
      ['F1L', 'F1R'], ['F2L', 'F2R'], ['F3L', 'F3R'],
      ['R1Lo', 'R1Li', 'R1Ri', 'R1Ro'], ['R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
    ],
  },
}

/** Built-in template names offered by the designer's "Start from" picker. */
export const BUILTIN_TEMPLATE_TYPES = Object.keys(BUILTIN_TEMPLATES)

/** Derive axle rows (kind + dual) from a built-in layout's wheel-id rows. */
function axlesFromTyreRows(rows) {
  return rows.map((ids) => ({
    kind: String(ids[0] || '').toUpperCase().startsWith('F') ? 'steer' : 'drive',
    dual: ids.length >= 4,
  }))
}

/**
 * Reverse-map a built-in LAYOUTS entry into a diagram config so the designer
 * can seed a new design from it ("Start from"). Axle count, kind and
 * single/dual are derived from the built-in's tyre rows; the body style is the
 * closest designer body. Matching is case/whitespace-insensitive. Unknown
 * types fall back to a fresh copy of DEFAULT_DIAGRAM_CONFIG. Always returns a
 * fresh, fully normalized config (never a shared reference).
 *
 * @param {string} vehicleType built-in layout name, e.g. 'Tri-mixer'
 * @returns {ReturnType<typeof normalizeDiagramConfig>}
 */
export function builtinToConfig(vehicleType) {
  const key = String(vehicleType ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  const match = BUILTIN_TEMPLATE_TYPES.find(
    (name) => name.toUpperCase() === key,
  )
  if (!match) return normalizeDiagramConfig(DEFAULT_DIAGRAM_CONFIG)
  const tpl = BUILTIN_TEMPLATES[match]
  return normalizeDiagramConfig({
    axles: axlesFromTyreRows(tpl.rows),
    spare: 0,
    body: tpl.body,
  })
}

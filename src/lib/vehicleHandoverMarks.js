/**
 * Vehicle Handover: numbered damage markers placed on the asset's own
 * five-view picture (the same boards the Flutter app shows, served from
 * public/vehicle-views and resolved by src/lib/vehicleArtwork.js).
 *
 * Pure module: no React, no network, no DOM.
 *
 * Storage (table `handover_reports`, `damages` jsonb, one entry per marker):
 *   { kind: 'marker', number, view, x, y, type, level, note, photo_url, stem, label }
 * x and y are percentages (0..100) of the view image, so a marker stays on the
 * same spot at any display size. `stem` records WHICH board the marker was
 * placed on, so the detail view and the PDF redraw the same picture without
 * re-reading the fleet register.
 *
 * Backward compatibility: handovers saved before markers existed carry one
 * entry per side that was not good ({ zone, condition, label }). Those are read
 * back as markers on that side's view with NO position (x/y null): they are
 * listed, never drawn on a spot nobody recorded.
 */
import {
  VEHICLE_VIEWS, VEHICLE_VIEW_BASE_PATH, artworkStemFor, VEHICLE_MULTIVIEW_CATALOG,
} from './vehicleArtwork'
import { familyForVehicleType, viewsForFamily, baseViewFor, SEVERITY_DOT_TONE } from './vehicleDamageViews'
import {
  DAMAGE_TYPES, DAMAGE_LEVELS, DAMAGE_NOTE_MAX, VIEW_LABELS, canonDamageType,
} from './accidentCaseVocab'

export { DAMAGE_TYPES, DAMAGE_LEVELS, DAMAGE_NOTE_MAX }

export const MARKER_KIND = 'marker'
export const MARKER_TONE = SEVERITY_DOT_TONE
const LEVEL_KEYS = new Set(DAMAGE_LEVELS.map((l) => l.key))
const KNOWN_STEMS = new Set(Object.values(VEHICLE_MULTIVIEW_CATALOG).map((c) => c.stem))

/** Legacy side-condition tokens to the marker vocabulary. */
const LEGACY_CONDITION = {
  minor_scratch: { type: 'scratch', level: 'minor' },
  dent: { type: 'dent', level: 'moderate' },
  damaged: { type: 'other', level: 'severe' },
}

function vehicleArgs(asset) {
  if (!asset || typeof asset !== 'object') return {}
  return {
    assetNo: asset.asset_no ?? asset.assetNo,
    vehicleType: asset.vehicle_type ?? asset.vehicleType,
    make: asset.make,
    model: asset.model,
  }
}

/**
 * The views offered for an asset, in the accident case order for its family,
 * reduced to distinct artwork faces (the angled Front-left chip is the Front
 * picture, so it is not offered twice).
 */
export function handoverViewsFor(asset) {
  const v = vehicleArgs(asset)
  const family = familyForVehicleType(v.vehicleType, v.assetNo)
  const out = []
  for (const view of viewsForFamily(family)) {
    const base = baseViewFor(view)
    if (base && !out.includes(base)) out.push(base)
  }
  for (const view of VEHICLE_VIEWS) if (!out.includes(view)) out.push(view)
  return out
}

/** The board stem for an asset, or null when no approved drawing exists. */
export function handoverStemFor(asset) {
  if (!asset) return null
  return artworkStemFor(vehicleArgs(asset)) || null
}

/** URL of one view of a board, or null (unknown stem or view). */
export function viewImageUrl(stem, view) {
  if (!stem || !KNOWN_STEMS.has(stem) || !VEHICLE_VIEWS.includes(view)) return null
  return `${VEHICLE_VIEW_BASE_PATH}/${stem}_${view}.webp`
}

export function viewName(view) {
  return VIEW_LABELS[view] || (view ? String(view) : 'Unknown side')
}
export function damageTypeName(type) {
  return DAMAGE_TYPES.find((d) => d.key === type)?.label || 'Other'
}
export function levelName(level) {
  return DAMAGE_LEVELS.find((l) => l.key === level)?.label || 'Minor'
}
export function levelTone(level) {
  return MARKER_TONE[level] || MARKER_TONE.minor
}

function pct(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10
}

function cleanPhoto(v) {
  const s = String(v || '').trim()
  return /^https?:\/\//i.test(s) ? s.slice(0, 2000) : ''
}

let seq = 0
function newId() {
  seq += 1
  return `m${Date.now().toString(36)}${seq}`
}

/** A clean marker from anything; returns null when the side is unknown. */
export function normalizeMarker(raw) {
  if (!raw || typeof raw !== 'object') return null
  const view = String(raw.view || '').toLowerCase()
  if (!VEHICLE_VIEWS.includes(view)) return null
  const x = pct(raw.x)
  const y = pct(raw.y)
  const placed = x != null && y != null
  const level = String(raw.level || '').toLowerCase()
  return {
    id: raw.id || newId(),
    view,
    x: placed ? x : null,
    y: placed ? y : null,
    type: canonDamageType(raw.type) || 'other',
    level: LEVEL_KEYS.has(level) ? level : 'minor',
    note: String(raw.note || '').slice(0, DAMAGE_NOTE_MAX),
    photo_url: cleanPhoto(raw.photo_url),
    legacy: !!raw.legacy,
  }
}

/** A new marker dropped at a click position. */
export function newMarker({ view, x, y, type = 'dent', level = 'minor' } = {}) {
  return normalizeMarker({ view, x, y, type, level })
}

/** Marker percentages from a click on a rendered image box. */
export function percentFromClick(clientX, clientY, rect) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null
  const x = ((clientX - rect.left) / rect.width) * 100
  const y = ((clientY - rect.top) / rect.height) * 100
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: pct(x), y: pct(y) }
}

/** "Front: Dent, Minor" */
export function markLabel(m) {
  return `${viewName(m.view)}: ${damageTypeName(m.type)}, ${levelName(m.level)}`
}

/**
 * Read a stored `damages` payload back into markers plus the board they were
 * placed on. Handles new marker entries and the older per-side entries.
 */
export function marksFromDamages(damages) {
  const marks = []
  let stem = null
  if (!Array.isArray(damages)) return { marks, stem }
  for (const d of damages) {
    if (!d || typeof d !== 'object') continue
    if (d.kind === MARKER_KIND) {
      const m = normalizeMarker(d)
      if (m) marks.push(m)
      if (!stem && d.stem && KNOWN_STEMS.has(d.stem)) stem = d.stem
      continue
    }
    const zone = String(d.zone || '').toLowerCase()
    const legacy = LEGACY_CONDITION[String(d.condition || '').toLowerCase()]
    if (legacy && VEHICLE_VIEWS.includes(zone)) {
      const m = normalizeMarker({ view: zone, x: null, y: null, ...legacy, legacy: true })
      if (m) marks.push(m)
    }
  }
  return { marks, stem }
}

/** Markers to the stored damages array (numbered in list order). */
export function damagesFromMarks(marks = [], { stem = null } = {}) {
  const safeStem = stem && KNOWN_STEMS.has(stem) ? stem : null
  return (Array.isArray(marks) ? marks : [])
    .map(normalizeMarker)
    .filter(Boolean)
    .map((m, i) => ({
      kind: MARKER_KIND,
      number: i + 1,
      view: m.view,
      x: m.x,
      y: m.y,
      type: m.type,
      level: m.level,
      note: m.note || null,
      photo_url: m.photo_url || null,
      stem: safeStem,
      label: markLabel(m),
    }))
}

/** Markers with their display number (1-based, list order). */
export function numberMarks(marks = []) {
  return (Array.isArray(marks) ? marks : []).map((m, i) => ({ ...m, number: i + 1 }))
}

/** Count of markers per view. */
export function markCountByView(marks = []) {
  const out = {}
  for (const m of Array.isArray(marks) ? marks : []) out[m.view] = (out[m.view] || 0) + 1
  return out
}

/** Views that carry at least one placed marker, in the given order. */
export function viewsWithPlacedMarks(marks = [], order = VEHICLE_VIEWS) {
  const set = new Set((Array.isArray(marks) ? marks : []).filter((m) => m.x != null && m.y != null).map((m) => m.view))
  return order.filter((v) => set.has(v))
}

/** One-line text summary for exports: "1 Front Dent (Minor); 2 Left ..." */
export function damageSummaryText(damages) {
  const { marks } = marksFromDamages(damages)
  return numberMarks(marks)
    .map((m) => `${m.number} ${viewName(m.view)} ${damageTypeName(m.type)} (${levelName(m.level)})${m.note ? `: ${m.note}` : ''}`)
    .join('; ')
}

/**
 * Workshop Live Control - admin configuration service (V295).
 *
 * The Live Control engine (src/lib/workshopLive.js) accepts overrides:
 *   deriveAlerts(board, jobs, { now, thresholds })
 *   delayBreakdown(board, { labourRate, jobs })
 * but out of the box uses hardcoded DEFAULT_THRESHOLDS / DEFAULT_LABOUR_RATE.
 *
 * This layer persists Admin-tuned values in `public.workshop_config` (one jsonb
 * row per key, org-isolated, elevated-role writes) and exposes them as a single
 * merged, clamped config object. Absence of a row = the engine default, so an
 * empty table behaves exactly like the hardcoded engine.
 *
 * Mapping the returned shape into the engine (the dashboard threads this in):
 *   deriveAlerts(board, jobs, { now, thresholds: cfg.thresholds })
 *   delayBreakdown(board, { labourRate: cfg.labourRate, jobs })
 *
 * loadWorkshopConfig never throws: on any error (missing table, RLS, network)
 * it degrades to WORKSHOP_CONFIG_DEFAULTS so the dashboard always renders.
 */
import { supabase } from './_client'

/**
 * Fail-safe defaults. `thresholds` mirrors the engine's DEFAULT_THRESHOLDS
 * EXACTLY (same keys) so `cfg.thresholds` drops straight into deriveAlerts.
 */
export const WORKSHOP_CONFIG_DEFAULTS = Object.freeze({
  thresholds: Object.freeze({
    unassignedMin: 30,        // unassigned beyond this -> alert
    noActivityMin: 45,        // job started but no activity recorded
    overSafeOvertimeMin: 120, // working beyond safe overtime
    vorSlaHours: 48,          // vehicle off road beyond SLA
    blockedPendingMin: 60,    // stuck waiting (parts / approval) beyond this -> alert
  }),
  targetUtilization: 0.75,    // productivity target, 0..1
  labourRate: 120,            // currency per hour (delay cost impact)
  shiftDefault: Object.freeze({ start: '08:00', end: '17:00' }),
  overtimeSafeMin: 60,        // minutes of overtime treated as safe
})

// Sensible clamp ranges (also used to reject fabricated / adversarial values).
const RANGES = Object.freeze({
  unassignedMin: [1, 1440],
  noActivityMin: [1, 1440],
  overSafeOvertimeMin: [1, 1440],
  vorSlaHours: [1, 8760],
  blockedPendingMin: [1, 1440],
  targetUtilization: [0, 1],
  labourRate: [0, 100000],
  overtimeSafeMin: [0, 1440],
})

/** Deep-ish clone of the frozen defaults into a mutable plain object. */
function cloneDefaults() {
  return {
    thresholds: { ...WORKSHOP_CONFIG_DEFAULTS.thresholds },
    targetUtilization: WORKSHOP_CONFIG_DEFAULTS.targetUtilization,
    labourRate: WORKSHOP_CONFIG_DEFAULTS.labourRate,
    shiftDefault: { ...WORKSHOP_CONFIG_DEFAULTS.shiftDefault },
    overtimeSafeMin: WORKSHOP_CONFIG_DEFAULTS.overtimeSafeMin,
  }
}

/** Coerce to a finite number, clamp to [min,max], or return `fallback`. */
function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Validate a "HH:MM" 24h string, else return `fallback`. */
function validTime(v, fallback) {
  if (typeof v !== 'string') return fallback
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim())
  if (!m) return fallback
  const hh = String(Number(m[1])).padStart(2, '0')
  return `${hh}:${m[2]}`
}

/** Merge partial thresholds over defaults and clamp every field. */
function normalizeThresholds(t) {
  const src = t && typeof t === 'object' ? t : {}
  const d = WORKSHOP_CONFIG_DEFAULTS.thresholds
  return {
    unassignedMin: clampNum(src.unassignedMin, ...RANGES.unassignedMin, d.unassignedMin),
    noActivityMin: clampNum(src.noActivityMin, ...RANGES.noActivityMin, d.noActivityMin),
    overSafeOvertimeMin: clampNum(src.overSafeOvertimeMin, ...RANGES.overSafeOvertimeMin, d.overSafeOvertimeMin),
    vorSlaHours: clampNum(src.vorSlaHours, ...RANGES.vorSlaHours, d.vorSlaHours),
    blockedPendingMin: clampNum(src.blockedPendingMin, ...RANGES.blockedPendingMin, d.blockedPendingMin),
  }
}

function normalizeShift(s) {
  const src = s && typeof s === 'object' ? s : {}
  const d = WORKSHOP_CONFIG_DEFAULTS.shiftDefault
  return { start: validTime(src.start, d.start), end: validTime(src.end, d.end) }
}

/**
 * Clamp / normalise a full (possibly partial) config object into the canonical
 * shape. Used both when reading DB rows and as a defensive pass on load.
 */
export function normalizeConfig(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {}
  return {
    thresholds: normalizeThresholds(src.thresholds),
    targetUtilization: clampNum(
      src.targetUtilization, ...RANGES.targetUtilization, WORKSHOP_CONFIG_DEFAULTS.targetUtilization,
    ),
    labourRate: clampNum(src.labourRate, ...RANGES.labourRate, WORKSHOP_CONFIG_DEFAULTS.labourRate),
    shiftDefault: normalizeShift(src.shiftDefault),
    overtimeSafeMin: clampNum(
      src.overtimeSafeMin, ...RANGES.overtimeSafeMin, WORKSHOP_CONFIG_DEFAULTS.overtimeSafeMin,
    ),
  }
}

/** DB key <-> config-object field mapping. */
const KEY_TO_FIELD = Object.freeze({
  thresholds: 'thresholds',
  target_utilization: 'targetUtilization',
  labour_rate: 'labourRate',
  shift_default: 'shiftDefault',
  overtime_safe_min: 'overtimeSafeMin',
})
const FIELD_TO_KEY = Object.freeze({
  thresholds: 'thresholds',
  targetUtilization: 'target_utilization',
  labourRate: 'labour_rate',
  shiftDefault: 'shift_default',
  overtimeSafeMin: 'overtime_safe_min',
})

/**
 * Load the effective workshop config: DB rows merged over the defaults, then
 * clamped. Never throws - degrades to WORKSHOP_CONFIG_DEFAULTS on any failure
 * (missing table, RLS, transport) so the Live Control dashboard always renders.
 *
 * @returns {Promise<{ thresholds:object, targetUtilization:number,
 *   labourRate:number, shiftDefault:{start:string,end:string}, overtimeSafeMin:number }>}
 */
export async function loadWorkshopConfig() {
  const merged = cloneDefaults()
  try {
    const { data, error } = await supabase.from('workshop_config').select('key,value')
    if (error) return normalizeConfig(merged)
    for (const row of data || []) {
      const field = KEY_TO_FIELD[row?.key]
      if (!field || row.value == null) continue
      merged[field] = row.value
    }
  } catch {
    return normalizeConfig(cloneDefaults())
  }
  return normalizeConfig(merged)
}

/**
 * Build the jsonb value payload for a single field, clamped to a safe range.
 * Returns undefined for an unknown / absent field so callers can skip it.
 */
function valueForField(field, raw) {
  switch (field) {
    case 'thresholds': return normalizeThresholds(raw)
    case 'targetUtilization':
      return clampNum(raw, ...RANGES.targetUtilization, WORKSHOP_CONFIG_DEFAULTS.targetUtilization)
    case 'labourRate':
      return clampNum(raw, ...RANGES.labourRate, WORKSHOP_CONFIG_DEFAULTS.labourRate)
    case 'shiftDefault': return normalizeShift(raw)
    case 'overtimeSafeMin':
      return clampNum(raw, ...RANGES.overtimeSafeMin, WORKSHOP_CONFIG_DEFAULTS.overtimeSafeMin)
    default: return undefined
  }
}

/**
 * Persist an Admin patch: upsert one row per provided key. Only the fields
 * present on `patch` are written (partial saves are fine). Values are validated
 * / clamped here as well as by RLS (elevated-only) on the server.
 *
 * @param {object} patch - any subset of { thresholds, targetUtilization,
 *   labourRate, shiftDefault, overtimeSafeMin }
 * @returns {Promise<string[]>} the DB keys written
 */
export async function saveWorkshopConfig(patch) {
  const src = patch && typeof patch === 'object' ? patch : {}
  const rows = []
  for (const field of Object.keys(FIELD_TO_KEY)) {
    if (src[field] == null) continue
    const value = valueForField(field, src[field])
    if (value === undefined) continue
    rows.push({ key: FIELD_TO_KEY[field], value })
  }
  if (rows.length === 0) return []

  const { error } = await supabase
    .from('workshop_config')
    .upsert(rows, { onConflict: 'organisation_id,key' })
  if (error) throw error
  return rows.map((r) => r.key)
}

/**
 * Maintenance priority for the fleet register (owner's criticality matrix).
 *
 * Pure: no I/O. The SQL function public.fleet_priority_for(vehicle_type,
 * asset_no) in supabase/migrations/20261124120000_fleet_maintenance_priority.sql
 * MIRRORS priorityFor() exactly. Change both together.
 *
 * Rule, in order:
 *   1. A known vehicle_type decides the priority (basis 'type').
 *   2. A blank vehicle_type falls back to the asset-code prefix, the leading
 *      letters of the asset number (basis 'code').
 *   3. Anything else is priority 6 (basis 'default' when nothing identified it,
 *      'type' when a real type is recorded but is not one of P1 to P5).
 * A stored maintenance_priority (1 to 6) on the row wins: basis 'override' when
 * priority_override_reason is set, otherwise the derived basis when the two
 * agree, else 'stored'. Those columns are optional; rows without them derive.
 */

export const PRIORITY_MATRIX = [
  {
    priority: 1, criticality: 'Critical',
    category: 'Wheel Loaders',
    impact: 'Production stops completely if unavailable.',
    response: 'Immediate response (24/7 support).',
    pmFrequency: 'Highest',
  },
  {
    priority: 2, criticality: 'High',
    category: 'Batching Plant / Ice Plant / Chiller',
    impact: 'Material handling and plant feeding affected.',
    response: 'High priority.',
    pmFrequency: 'High',
  },
  {
    priority: 3, criticality: 'High',
    category: 'Concrete Pumps (Mobile), Line Pumps, Stationary Pumps, Placing Booms & Spiders',
    impact: 'Concrete placement stops, major project delays.',
    response: 'Urgent response.',
    pmFrequency: 'High',
  },
  {
    priority: 4, criticality: 'Medium',
    category: 'Generators',
    impact: 'Standby/backup power affected; operations can continue on alternate supply.',
    response: 'Plan repair within maintenance schedule.',
    pmFrequency: 'Medium',
  },
  {
    priority: 5, criticality: 'Medium',
    category: 'Transit Mixers',
    impact: 'Concrete delivery affected; fleet can partially compensate.',
    response: 'Normal priority.',
    pmFrequency: 'Medium',
  },
  {
    priority: 6, criticality: 'Low',
    category: 'Other Assets (Light Vehicles, Forklifts, Service Vehicles, Auxiliary Equipment)',
    impact: 'Limited operational impact.',
    response: 'Planned response.',
    pmFrequency: 'Routine',
  },
]

export const CRITICALITY_CRITERIA = [
  { criticality: 'Critical', meaning: 'Failure stops production or major operations.', action: 'Immediate repair, highest spare parts priority.' },
  { criticality: 'High', meaning: 'Failure significantly affects output.', action: 'Repair as soon as possible.' },
  { criticality: 'Medium', meaning: 'Reduces efficiency, operations continue.', action: 'Plan repair within schedule.' },
  { criticality: 'Low', meaning: 'Minimal impact.', action: 'Repair during planned maintenance.' },
]

export const PRIORITY_LEVELS = [1, 2, 3, 4, 5, 6]

// Canonical (normalized) vehicle types per priority. Normalized = upper case,
// trimmed, runs of space / underscore / hyphen collapsed to one space.
const TYPE_KEYS = {
  1: ['WHEEL LOADER'],
  2: ['BT PLANT', 'BATCHING PLANT', 'ICE PLANT', 'CHILLER', 'RECLAIMER'],
  3: ['PUMPS', 'SPIDER PUMP', 'PLACING BOOM', 'STATIONARY PUMP', 'LINE PUMP', 'CONCRETE PUMP'],
  4: ['GENERATOR'],
  5: ['TR MIXER', 'TRANSIT MIXER'],
}

// Asset-code prefixes, used only when vehicle_type is blank.
const PREFIXES = {
  1: ['WL'],
  2: ['BP', 'IP', 'REC'],
  3: ['MP', 'SP', 'LP', 'PB', 'HD'],
  4: ['GN'],
  5: ['TM', 'DT'],
}

const TYPE_TO_P = new Map()
for (const [p, list] of Object.entries(TYPE_KEYS)) for (const k of list) TYPE_TO_P.set(k, Number(p))
const PREFIX_TO_P = new Map()
for (const [p, list] of Object.entries(PREFIXES)) for (const k of list) PREFIX_TO_P.set(k, Number(p))

const MATRIX_BY_P = new Map(PRIORITY_MATRIX.map((m) => [m.priority, m]))

export function normalizeType(type) {
  return String(type ?? '').toUpperCase().trim().replace(/[\s_-]+/g, ' ').trim()
}

/** Leading letters of the upper-cased, trimmed asset number ('' when none). */
export function assetPrefix(assetNo) {
  const m = /^[A-Z]+/.exec(String(assetNo ?? '').toUpperCase().trim())
  return m ? m[0] : ''
}

function derive(row) {
  const type = normalizeType(row?.vehicle_type)
  if (type) {
    return { priority: TYPE_TO_P.get(type) ?? 6, basis: 'type' }
  }
  const prefix = assetPrefix(row?.asset_no)
  const p = PREFIX_TO_P.get(prefix)
  if (p) return { priority: p, basis: 'code' }
  return { priority: 6, basis: 'default' }
}

function validStored(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null
}

/**
 * Priority for one fleet row:
 * { priority, criticality, basis, category, impact, response, pmFrequency, label }
 */
export function priorityFor(row) {
  const derived = derive(row)
  const stored = validStored(row?.maintenance_priority)
  let priority = derived.priority
  let basis = derived.basis
  if (stored != null) {
    priority = stored
    if (String(row?.priority_override_reason ?? '').trim()) basis = 'override'
    else if (stored !== derived.priority) basis = 'stored'
  }
  const m = MATRIX_BY_P.get(priority)
  return {
    priority,
    criticality: m.criticality,
    basis,
    category: m.category,
    impact: m.impact,
    response: m.response,
    pmFrequency: m.pmFrequency,
    label: `P${priority} ${m.criticality}`,
  }
}

/** Exact stored spellings the server filter matches for priority p (1 to 5). */
export function priorityTypes(p) {
  const keys = TYPE_KEYS[p] || []
  const out = new Set()
  for (const k of keys) {
    out.add(k)
    if (k.includes(' ')) {
      out.add(k.replace(/ /g, '_'))
      out.add(k.replace(/ /g, '-'))
    }
  }
  return [...out]
}

/** Asset-code prefixes for priority p (1 to 5); [] for 6. */
export function priorityPrefixes(p) {
  return [...(PREFIXES[p] || [])]
}

/** Counts per priority plus the critical and high (P1 to P3) total. */
export function summarizePriorities(rows = []) {
  const byPriority = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  const byBasis = { type: 0, code: 0, default: 0, override: 0, stored: 0 }
  for (const r of rows || []) {
    const { priority, basis } = priorityFor(r)
    byPriority[priority] += 1
    byBasis[basis] += 1
  }
  return {
    total: (rows || []).length,
    byPriority,
    byBasis,
    criticalHigh: byPriority[1] + byPriority[2] + byPriority[3],
  }
}

// ── server filter (PostgREST .or() strings) ──────────────────────────────────

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const BLANK_TYPE = 'or(vehicle_type.is.null,vehicle_type.eq."")'
// Prefix followed by a non-letter or the end, so 'TM' never matches 'TMX12'.
const prefixRegex = (prefixes) => quote(`^(${prefixes.join('|')})([^A-Z]|$)`)

/**
 * PostgREST `.or()` filter for one priority (1 to 6) or a set of them.
 * Returns null when the set covers every priority (no filter needed) or is
 * empty/invalid. Mirrors priorityFor()'s derivation (stored overrides are not
 * read: the column does not exist on the live fleet yet).
 */
export function buildPriorityFilter(input) {
  const set = [...new Set((Array.isArray(input) ? input : [input]).map(Number))]
    .filter((p) => PRIORITY_LEVELS.includes(p))
  if (!set.length || set.length === 6) return null
  const positive = (ps) => {
    const types = ps.flatMap(priorityTypes)
    const prefixes = ps.flatMap(priorityPrefixes)
    return { types, prefixes }
  }
  if (!set.includes(6)) {
    const { types, prefixes } = positive(set.sort())
    return `vehicle_type.in.(${types.map(quote).join(',')}),and(${BLANK_TYPE},asset_no.imatch.${prefixRegex(prefixes)})`
  }
  // 6 is in the set: rows NOT in the listed priorities among 1..5.
  const excluded = [1, 2, 3, 4, 5].filter((p) => !set.includes(p))
  const { types, prefixes } = positive(excluded)
  return `and(vehicle_type.not.in.(${types.map(quote).join(',')}),vehicle_type.neq.""),and(${BLANK_TYPE},asset_no.not.imatch.${prefixRegex(prefixes)})`
}

/** Priority filter values the page accepts from the URL. */
export const PRIORITY_FILTER_OPTIONS = [
  ...PRIORITY_MATRIX.map((m) => ({ value: String(m.priority), label: `P${m.priority} ${m.criticality}`, set: [m.priority] })),
  { value: '1-3', label: 'P1 to P3 (critical and high)', set: [1, 2, 3] },
]

export function prioritySetFor(value) {
  return PRIORITY_FILTER_OPTIONS.find((o) => o.value === String(value ?? ''))?.set ?? null
}

/**
 * combinationManagerView - pure logic for the Combination Manager redesign
 * (/combinations, owner mockup 19). Zero I/O.
 *
 * Reuses combinations.js (trailer parsing) and never invents a measurement:
 * axle loads, tyre loads and legal limits are not recorded anywhere in the
 * system, so they are reported as unknown (null) and the page renders "N/A".
 */
import { parseTrailerList } from './combinations'

/** Fixed hues for steer / drive / trailer (SVG attributes cannot read CSS vars). */
export const TYRE_GROUP_COLORS = { steer: '#3b82f6', drive: '#16a34a', trailer: '#f59e0b' }

export const MANAGER_STATUSES = ['active', 'under_review', 'inactive']

export const STATUS_META = {
  active: { label: 'Active', tone: 'good' },
  under_review: { label: 'Under Review', tone: 'warn' },
  inactive: { label: 'Inactive', tone: 'bad' },
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.inactive
}

const int = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/**
 * Tyre configuration stored as {steer, drive, trailer}. Missing parts are null;
 * total is null when no part is known.
 */
export function normalizeTyreConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const steer = int(o.steer)
  const drive = int(o.drive)
  const trailer = int(o.trailer)
  const known = [steer, drive, trailer].filter((n) => n != null)
  return { steer, drive, trailer, total: known.length ? known.reduce((a, b) => a + b, 0) : null }
}

/** "12 + 12" style label: prime mover tyres + trailer tyres. */
export function tyreConfigLabel(raw) {
  const t = normalizeTyreConfig(raw)
  if (t.total == null) return null
  const prime = (t.steer ?? 0) + (t.drive ?? 0)
  const hasPrime = t.steer != null || t.drive != null
  if (t.trailer != null && hasPrime) return `${prime} + ${t.trailer}`
  if (t.trailer != null) return `${t.trailer} (trailer)`
  return String(prime)
}

/**
 * Parse an axle configuration such as "6x4 + 3A", "4x2", "8x4 + 2A + 2A".
 * The prime mover part is wheel-positions x driven-positions (two per axle).
 * Trailer parts are "<n>A". Returns null for anything that does not parse.
 */
export function parseAxleConfig(text) {
  const s = String(text || '').trim()
  if (!s) return null
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean)
  let prime = null
  let trailerAxles = 0
  let trailerParts = 0
  for (const p of parts) {
    const m = /^(\d{1,2})\s*[xX*]\s*(\d{1,2})$/.exec(p)
    const t = /^(\d{1,2})\s*A$/i.exec(p)
    if (m && !prime) {
      const positions = Number(m[1])
      const driven = Number(m[2])
      if (positions < 4 || positions % 2 || driven % 2 || driven > positions || driven < 2) return null
      const axles = positions / 2
      const drive = driven / 2
      prime = { axles, drive, steer: axles - drive, label: `${positions}x${driven}` }
    } else if (t) {
      const n = Number(t[1])
      if (n < 1 || n > 9) return null
      trailerAxles += n
      trailerParts += 1
    } else {
      return null
    }
  }
  if (!prime && !trailerAxles) return null
  return {
    prime,
    trailerAxles,
    trailerParts,
    totalAxles: (prime ? prime.axles : 0) + trailerAxles,
  }
}

/**
 * Per-axle rows for the Load Distribution card. Tyres per axle are shown only
 * when the stored tyre count divides evenly across that group's axles.
 * Axle load, tyre load and legal limit are always null: nothing records them.
 */
export function axleRows(combo) {
  const ax = parseAxleConfig(combo?.axle_config)
  if (!ax) return []
  const t = normalizeTyreConfig(combo?.tyre_config)
  const per = (count, axles) => (count != null && axles > 0 && count % axles === 0 ? count / axles : null)
  const rows = []
  let i = 0
  const push = (group, n, perAxle) => {
    for (let k = 0; k < n; k += 1) {
      i += 1
      rows.push({ axle: `Axle ${i}`, group, tyres: perAxle, axleLoad: null, tyreLoad: null, legalLimit: null })
    }
  }
  if (ax.prime) {
    push('steer', ax.prime.steer, per(t.steer, ax.prime.steer))
    push('drive', ax.prime.drive, per(t.drive, ax.prime.drive))
  }
  push('trailer', ax.trailerAxles, per(t.trailer, ax.trailerAxles))
  return rows
}

/** A record is complete when axle config parses, tyres are counted and max load is set. */
export function isConfigComplete(r) {
  if (!r) return false
  const load = Number(r.max_load_tonnes)
  return !!parseAxleConfig(r.axle_config)
    && (normalizeTyreConfig(r.tyre_config).total || 0) > 0
    && Number.isFinite(load) && load > 0
}

/** KPI strip. Compliance is null for an empty registry, never 0. */
export function managerKpis(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)
  const count = (s) => list.filter((r) => (r.status || 'inactive') === s).length
  const complete = list.filter(isConfigComplete).length
  return {
    total: list.length,
    active: count('active'),
    inactive: count('inactive'),
    underReview: count('under_review'),
    complete,
    compliancePct: list.length ? Math.round((complete / list.length) * 100) : null,
  }
}

const norm = (v) => String(v ?? '').trim().toUpperCase()

/** Vehicle type of a combination's prime mover, read from the fleet lookup. */
export function primeVehicleType(r, fleetMap) {
  const f = fleetMap?.get?.(norm(r?.prime_mover_no))
  return f?.vehicle_type || null
}

export function searchText(r) {
  if (!r) return ''
  return [r.combination_no, r.name, r.prime_mover_no, ...parseTrailerList(r.trailer_nos),
    r.site, r.combination_type, r.axle_config, r.notes].filter(Boolean).join(' ').toLowerCase()
}

/** Filter for the mockup's filter bar. '' means "all" for every dimension. */
export function filterManager(rows = [], { site = '', vehicleType = '', type = '', status = '', search = '' } = {}, fleetMap) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false
    if (site && r.site !== site) return false
    if (status && (r.status || 'inactive') !== status) return false
    if (type && r.combination_type !== type) return false
    if (vehicleType && primeVehicleType(r, fleetMap) !== vehicleType) return false
    if (q && !searchText(r).includes(q)) return false
    return true
  })
}

const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b))

export function typeOptions(rows = []) {
  return distinct((rows || []).map((r) => r?.combination_type))
}

export function vehicleTypeOptions(rows = [], fleetMap) {
  return distinct((rows || []).map((r) => primeVehicleType(r, fleetMap)))
}

/** Fleet rows keyed by upper-case asset number. */
export function buildFleetMap(fleet = []) {
  const m = new Map()
  for (const f of fleet || []) {
    const k = norm(f?.asset_no)
    if (k && !m.has(k)) m.set(k, f)
  }
  return m
}

/** Donut segments for the tyre configuration card; empty when nothing is recorded. */
export function tyreConfigSegments(raw, colors = {}) {
  const t = normalizeTyreConfig(raw)
  if (t.total == null) return []
  return [
    { key: 'steer', label: 'Steer', count: t.steer || 0, color: colors.steer },
    { key: 'drive', label: 'Drive', count: t.drive || 0, color: colors.drive },
    { key: 'trailer', label: 'Trailer', count: t.trailer || 0, color: colors.trailer },
  ]
}

/** Suggested next number "COMB-NNN" from the existing registry (placeholder only). */
export function suggestNextNumber(rows = []) {
  let max = 0
  for (const r of rows || []) {
    const m = /^COMB-(\d+)$/i.exec(String(r?.combination_no || '').trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `COMB-${String(max + 1).padStart(3, '0')}`
}

export const EMPTY_MANAGER_FORM = {
  combination_no: '', name: '', prime_mover_no: '', trailer_nos: '', combination_type: '',
  axle_config: '', steer: '', drive: '', trailer: '', max_load_tonnes: '', site: '', status: 'active', notes: '',
}

export function formFromRow(r) {
  if (!r) return { ...EMPTY_MANAGER_FORM }
  const t = normalizeTyreConfig(r.tyre_config)
  const s = (n) => (n == null ? '' : String(n))
  return {
    combination_no: r.combination_no || '',
    name: r.name || '',
    prime_mover_no: r.prime_mover_no || '',
    trailer_nos: parseTrailerList(r.trailer_nos).join(', '),
    combination_type: r.combination_type || '',
    axle_config: r.axle_config || '',
    steer: s(t.steer), drive: s(t.drive), trailer: s(t.trailer),
    max_load_tonnes: r.max_load_tonnes == null ? '' : String(r.max_load_tonnes),
    site: r.site || '',
    status: MANAGER_STATUSES.includes(r.status) ? r.status : 'inactive',
    notes: r.notes || '',
  }
}

/** Validation messages keyed by field; empty object means valid. */
export function validateManagerForm(f) {
  const e = {}
  if (!String(f?.prime_mover_no || '').trim()) e.prime_mover_no = 'Pick a prime mover.'
  if (String(f?.axle_config || '').trim() && !parseAxleConfig(f.axle_config)) {
    e.axle_config = 'Use a form like 6x4 + 3A.'
  }
  for (const k of ['steer', 'drive', 'trailer']) {
    if (String(f?.[k] ?? '').trim() !== '' && int(f[k]) == null) e[k] = 'Whole number, 0 or more.'
  }
  const load = String(f?.max_load_tonnes ?? '').trim()
  if (load !== '') {
    const n = Number(load)
    if (!Number.isFinite(n) || n <= 0 || n > 1000) e.max_load_tonnes = 'Enter tonnes between 0 and 1000.'
  }
  if (f?.status && !MANAGER_STATUSES.includes(f.status)) e.status = 'Pick a status.'
  return e
}

/** Service payload from the form. Blank tyre parts are left out of the JSON. */
export function payloadFromForm(f) {
  const tyre = {}
  for (const k of ['steer', 'drive', 'trailer']) {
    const n = int(f?.[k])
    if (String(f?.[k] ?? '').trim() !== '' && n != null) tyre[k] = n
  }
  const load = String(f?.max_load_tonnes ?? '').trim()
  return {
    combination_no: f?.combination_no || '',
    name: f?.name || '',
    prime_mover_no: f?.prime_mover_no || '',
    trailer_nos: f?.trailer_nos || '',
    combination_type: f?.combination_type || '',
    axle_config: f?.axle_config || '',
    tyre_config: tyre,
    max_load_tonnes: load === '' ? null : Number(load),
    site: f?.site || '',
    status: f?.status || 'active',
    notes: f?.notes || '',
  }
}

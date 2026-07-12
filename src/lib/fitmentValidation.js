/**
 * Fitment validation — pure helpers (no I/O) for the Fitment Validation module.
 * For every fleet asset that declares a specified tyre size (the SPEC), we
 * compare that spec against the size(s) of the tyres actually fitted to the
 * asset (in-service `tyre_records`). A vehicle is:
 *
 *   - MATCH    — it has a spec, has fitted tyres, and every fitted size equals
 *                the spec after normalisation.
 *   - MISMATCH — it has a spec and at least one fitted tyre whose size differs
 *                from the spec (wrong size fitted).
 *   - UNKNOWN  — no spec on the asset, or no fitted tyres to compare against.
 *
 * Size comparison is normalisation-tolerant: trim, upper-case, and strip all
 * whitespace so "295/80 R22.5" and "295/80r22.5" compare equal. These functions
 * are unit-tested; the page and service consume them so the classification logic
 * lives in exactly one place.
 */

export const FITMENT_BANDS = ['match', 'mismatch', 'unknown']

export const FITMENT_BAND_META = {
  match: { label: 'Correct size', tone: 'green' },
  mismatch: { label: 'Wrong size', tone: 'red' },
  unknown: { label: 'No data', tone: 'slate' },
}

/**
 * Normalise a tyre size for equality comparison: trim, upper-case, and remove
 * every whitespace character. Returns '' for null/undefined/blank input so
 * callers can treat "" as "no usable size".
 */
export function normalizeSize(size) {
  if (size == null) return ''
  return String(size).toUpperCase().replace(/\s+/g, '').trim()
}

const serialOf = (r) => r?.serial_no || r?.serial_number || r?.tyre_serial || ''
const positionOf = (r) => r?.position || r?.tyre_position || ''

/**
 * Classify one vehicle against its fitted tyre rows.
 * @param {object} vehicle  a `vehicle_fleet` row (needs asset_no, tyre_size, …)
 * @param {Array<object>} [fittedRows]  in-service `tyre_records` for this asset
 * @returns {{
 *   asset_no:string, make:string, model:string, vehicle_type:string,
 *   site:string, country:string, status:string,
 *   spec:string, specNorm:string, fittedCount:number,
 *   fittedSizes:string[], mismatchSizes:string[],
 *   band:'match'|'mismatch'|'unknown', fitted:Array<object>
 * }}
 */
export function classifyFitment(vehicle, fittedRows = []) {
  const rows = Array.isArray(fittedRows) ? fittedRows : []
  const spec = vehicle?.tyre_size == null ? '' : String(vehicle.tyre_size).trim()
  const specNorm = normalizeSize(spec)

  // Unique raw fitted sizes (preserve a display form), and their normalised set.
  const fittedSizes = []
  const seen = new Set()
  const mismatchSizes = []
  const mismatchSeen = new Set()
  let anyMatch = false

  for (const r of rows) {
    const raw = r?.size == null ? '' : String(r.size).trim()
    const norm = normalizeSize(raw)
    if (raw && !seen.has(norm)) { seen.add(norm); fittedSizes.push(raw) }
    if (specNorm && norm) {
      if (norm === specNorm) anyMatch = true
      else if (!mismatchSeen.has(norm)) { mismatchSeen.add(norm); mismatchSizes.push(raw) }
    }
  }

  const fitted = rows.map((r) => ({
    id: r?.id,
    serial: serialOf(r) || '—',
    position: positionOf(r) || '—',
    size: r?.size == null ? '' : String(r.size).trim(),
    sizeNorm: normalizeSize(r?.size),
    site: r?.site || '',
    matches: !!specNorm && normalizeSize(r?.size) === specNorm,
  }))

  let band
  if (!specNorm || rows.length === 0) band = 'unknown'
  else if (mismatchSizes.length > 0) band = 'mismatch'
  else band = 'match'

  return {
    asset_no: vehicle?.asset_no || '',
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    vehicle_type: vehicle?.vehicle_type || '',
    site: vehicle?.site || '',
    country: vehicle?.country || '',
    status: vehicle?.status || '',
    spec,
    specNorm,
    fittedCount: rows.length,
    fittedSizes,
    mismatchSizes,
    band,
    fitted,
    _anyMatch: anyMatch,
  }
}

/**
 * Group in-service tyre records by asset number.
 * @param {Array<object>} tyreRecords
 * @returns {Map<string, Array<object>>}
 */
export function groupFittedByAsset(tyreRecords) {
  const map = new Map()
  for (const r of Array.isArray(tyreRecords) ? tyreRecords : []) {
    const key = r?.asset_no
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return map
}

/**
 * Classify a whole fleet: join `vehicle_fleet` rows to their in-service tyres
 * and band each. Returns the enriched rows plus summary counts.
 * @param {Array<object>} vehicles     `vehicle_fleet` rows
 * @param {Array<object>} tyreRecords  in-service `tyre_records` rows
 */
export function summarizeFitments(vehicles, tyreRecords) {
  const byAsset = groupFittedByAsset(tyreRecords)
  const rows = (Array.isArray(vehicles) ? vehicles : []).map((v) =>
    classifyFitment(v, byAsset.get(v?.asset_no) || []),
  )
  const counts = { total: rows.length, match: 0, mismatch: 0, unknown: 0 }
  for (const r of rows) counts[r.band] += 1
  const checked = counts.match + counts.mismatch
  const compliancePct = checked > 0 ? Math.round((counts.match / checked) * 100) : null
  return { rows, counts, compliancePct }
}

/**
 * TPMS service — the reads the /tpms page consumes.
 *
 * Two data sources behind one module:
 *   1. tpms_readings — the dedicated live sensor stream (V130). May not exist
 *      yet on an org that hasn't run the migration, so a missing-relation error
 *      is swallowed to an empty list (the page falls back to the baseline).
 *   2. tyre_records.pressure_reading — the baseline pressure dataset, available
 *      immediately from existing tyre records so the page is useful day one.
 *
 * Explicit least-privilege column lists; null-safe country scoping via the
 * shared applyCountry helper. Paginated so exports/analytics see every row.
 */
import { supabase, unwrap, applyCountry, fetchAllPages, ServiceError } from './_client'

const READING_COLS =
  'id,organisation_id,country,asset_no,tyre_position,tyre_serial,pressure,temperature,' +
  'target_pressure,status,recorded_at,created_by,created_at,updated_at'

const BASELINE_COLS =
  'id,asset_no,serial_no,position,size,brand,pressure_reading,site,country,issue_date'

/** Postgres "undefined_table" / PostgREST "table not found" — the migration hasn't run. */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '')
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
    /does not exist|could not find the table|schema cache/i.test(msg)
}

/**
 * Live TPMS sensor readings (newest first), country-scoped. Returns [] when the
 * tpms_readings table is absent so the page degrades to the baseline dataset.
 * @param {{country?:string, limit?:number}} [opts]
 */
export async function listTpmsReadings({ country, limit = 5000 } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('tpms_readings')
      .select(READING_COLS)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: true })
    return applyCountry(q, country).range(from, to)
  }, { pageSize: 1000, max: limit })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data || []
}

/**
 * Baseline pressure dataset from tyre_records where pressure_reading is set,
 * country-scoped, newest issue_date first. Always available (no migration).
 * @param {{country?:string, limit?:number}} [opts]
 */
export async function listTyrePressureBaseline({ country, limit = 10000 } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('tyre_records')
      .select(BASELINE_COLS)
      .not('pressure_reading', 'is', null)
      .order('issue_date', { ascending: false })
      .order('id', { ascending: true })
    return applyCountry(q, country).range(from, to)
  }, { pageSize: 1000, max: limit })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data || []
}

/** Insert a single TPMS reading (sensor ingest / manual entry). */
export async function insertTpmsReading(payload = {}) {
  return unwrap(await supabase.from('tpms_readings').insert(payload).select(READING_COLS).single())
}

/**
 * Technician Scorecard service — reads the `work_orders` rows needed to build
 * the workshop technician performance leaderboard. Country-scoped (null-safe)
 * and fully paginated so large workshops are never silently truncated.
 *
 * Grouping / KPI / ranking logic lives in `src/lib/technicianScorecard.js`;
 * this module is purely I/O with a least-privilege column list.
 */
import { supabase, unwrap, applyCountry, fetchAllPages, ServiceError } from './_client'

// Explicit columns only (no SELECT *). `assigned_to` aliases technician_name to
// mirror WorkshopManagement; the pure lib accepts either key.
const COLS =
  'id,work_order_no,asset_no,status,priority,work_type,site,' +
  'technician_name,labour_cost,parts_cost,total_cost,' +
  'created_at,completed_at,country'

/**
 * Fetch every work order in scope for the scorecard, paginated.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listWorkOrdersForScorecard({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('work_orders')
      .select(COLS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data || []
}

// ============================================================================
// Technician Competency I/O — skills matrix + certifications (V207 tables).
// Org isolation + elevated-role writes are enforced by RLS; this layer keeps
// explicit least-privilege column lists and degrades a missing relation
// (pre-migration org) to an empty array so the page renders its
// "not provisioned" state instead of erroring.
// ============================================================================

const SKILL_COLS =
  'id,organisation_id,user_id,skill_id,level,notes,assessed_by,assessed_at,country,created_at,updated_at'

const CERT_COLS =
  'id,organisation_id,user_id,cert_id,cert_name,issuer,issue_date,expiry_date,' +
  'cert_number,document_url,recorded_by,recorded_at,country,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && (msg.includes('technician_skills') || msg.includes('technician_certs')))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asLevel = (v) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(3, Math.round(n)))
}

// ── Skills ───────────────────────────────────────────────────────────────

/**
 * List technician skill rows in scope (country-scoped, null-safe). Returns []
 * when the table has not been provisioned yet.
 * @param {{ country?: string }} [opts]
 */
export async function listSkills({ country } = {}) {
  try {
    return unwrap(
      await applyCountry(
        supabase.from('technician_skills').select(SKILL_COLS).order('assessed_at', { ascending: false }),
        country,
      ),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Insert or update a technician's skill level (one row per user+skill+org).
 * Upserts on the (user_id, skill_id, organisation_id) unique constraint.
 * @param {{ user_id:string, skill_id:string, level?:number, notes?:string, country?:string }} values
 */
export async function upsertSkill(values = {}) {
  const user_id = asText(values.user_id, 100)
  if (!user_id) throw new Error('A technician is required.')
  const skill_id = asText(values.skill_id, 80)
  if (!skill_id) throw new Error('A skill is required.')

  const payload = {
    user_id,
    skill_id,
    level: asLevel(values.level),
    notes: values.notes ? String(values.notes).slice(0, 2000) : null,
    country: asText(values.country, 120),
    assessed_at: new Date().toISOString(),
  }
  return unwrap(
    await supabase
      .from('technician_skills')
      .upsert(payload, { onConflict: 'user_id,skill_id,organisation_id' })
      .select(SKILL_COLS)
      .single(),
  )
}

export async function deleteSkill(id) {
  return unwrap(await supabase.from('technician_skills').delete().eq('id', id))
}

// ── Certifications ─────────────────────────────────────────────────────────

/**
 * List technician certification rows in scope (country-scoped, null-safe).
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?: string }} [opts]
 */
export async function listCerts({ country } = {}) {
  try {
    return unwrap(
      await applyCountry(
        supabase.from('technician_certs').select(CERT_COLS).order('expiry_date', { ascending: true, nullsFirst: false }),
        country,
      ),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Record a certification for a technician. Requires user + cert; issue/expiry
 * dates optional (the page computes expiry from the catalogue validity window).
 * @param {object} values
 */
export async function createCert(values = {}) {
  const user_id = asText(values.user_id, 100)
  if (!user_id) throw new Error('A technician is required.')
  const cert_id = asText(values.cert_id, 80)
  if (!cert_id) throw new Error('A certification is required.')

  const payload = {
    user_id,
    cert_id,
    cert_name: asText(values.cert_name, 200),
    issuer: asText(values.issuer, 200),
    issue_date: asDate(values.issue_date),
    expiry_date: asDate(values.expiry_date),
    cert_number: asText(values.cert_number, 120),
    document_url: asText(values.document_url, 1000),
    country: asText(values.country, 120),
  }
  return unwrap(
    await supabase.from('technician_certs').insert(payload).select(CERT_COLS).single(),
  )
}

export async function deleteCert(id) {
  return unwrap(await supabase.from('technician_certs').delete().eq('id', id))
}

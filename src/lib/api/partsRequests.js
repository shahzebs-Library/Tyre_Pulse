/**
 * Parts Requests service (V296) - a technician raises a parts request for a job;
 * a foreman / storekeeper (elevated) approves + issues + fulfils it, which is
 * what resolves the technician's blocked-for-parts time.
 *
 * RLS enforces org isolation (read for any active member; insert for the
 * requester themselves OR elevated; full manage for elevated) plus country +
 * site scoping. This layer keeps an explicit least-privilege column list and
 * null-safe country scoping, mirroring washRecords.js / pmPrograms.js.
 *
 * Before the migration is applied the lister degrades to [] so the page can
 * surface an "apply v296_parts_requests" hint instead of throwing.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

export const COLS =
  'id,organisation_id,country,site,job_id,asset_no,part_id,part_name,qty,status,' +
  'priority,requested_by,approved_by,requested_at,needed_by,fulfilled_at,notes,' +
  'created_at,updated_at'

/** Least-privilege column list for the work_orders job picker (open jobs). */
const WO_COLS = 'id,work_order_no,asset_no,site,status,priority,work_type,description'

/** Least-privilege column list for the parts_catalog part picker. */
const PART_COLS = 'id,part_no,name,category,uom,on_hand_qty,unit_cost'

/** Statuses a foreman advances a request through, mirroring the DB CHECK. */
export const PARTS_REQUEST_STATUSES = ['requested', 'approved', 'issued', 'fulfilled', 'rejected', 'cancelled']

/** Coerce a value to a finite number or null (empty string / null / NaN -> null). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Trim + slice a text value, or null when empty. */
function textOrNull(v, max = 200) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List parts requests (newest request first). All filters optional. Country-
 * scoped (null-safe). Returns [] when the table is missing so the UI prompts for
 * the migration rather than erroring.
 *
 * @param {{status?:string, site?:string, job_id?:string, country?:string, limit?:number}} [opts]
 */
export async function listPartsRequests({ status, site, job_id, country, limit = 5000 } = {}) {
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from('parts_requests').select(COLS)
    q = applyCountry(q, country)
    if (status && status !== 'All') q = q.eq('status', status)
    if (site && site !== 'All') q = q.eq('site', site)
    if (job_id) q = q.eq('job_id', job_id)
    return q.order('requested_at', { ascending: false }).range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: limit })
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Create a parts request. A part reference (part_id) OR a free-text part_name is
 * required so the request is never blank. RLS lets a technician raise their own.
 */
export async function createPartsRequest(values = {}) {
  const payload = {
    job_id: textOrNull(values.job_id, 60),
    asset_no: textOrNull(values.asset_no, 120),
    part_id: textOrNull(values.part_id, 60),
    part_name: textOrNull(values.part_name, 200),
    qty: numOrNull(values.qty) ?? 1,
    priority: textOrNull(values.priority, 20) || 'medium',
    needed_by: values.needed_by || null,
    site: textOrNull(values.site, 120),
    notes: textOrNull(values.notes, 4000),
    country: values.country ?? null,
  }
  if (!payload.part_id && !payload.part_name) {
    throw new Error('Select a part or enter a part name.')
  }
  if (!Number.isFinite(payload.qty) || payload.qty <= 0) payload.qty = 1
  return unwrap(await supabase.from('parts_requests').insert(payload).select(COLS).single())
}

/**
 * Advance a request to a new status. Stamps approved_by when approving and
 * fulfilled_at when fulfilling (cleared otherwise so a re-open is honest).
 * Elevated (foreman / storekeeper) only - enforced server-side by RLS.
 */
export async function setPartsRequestStatus(id, status) {
  if (!id) throw new Error('A request id is required.')
  const next = String(status || '').trim().toLowerCase()
  if (!PARTS_REQUEST_STATUSES.includes(next)) throw new Error('Unknown status.')

  const patch = { status: next }
  if (next === 'approved') {
    const { data: { user } = {} } = await supabase.auth.getUser()
    if (user?.id) patch.approved_by = user.id
  }
  if (next === 'fulfilled') patch.fulfilled_at = new Date().toISOString()
  else patch.fulfilled_at = null

  return unwrap(await supabase.from('parts_requests').update(patch).eq('id', id).select(COLS).single())
}

/**
 * Open work orders for the job picker (newest first). Country-scoped. Returns []
 * when work_orders is unavailable. Closed statuses are filtered client-side via
 * isOpenWoStatus by the caller if desired; here we simply exclude Completed /
 * Cancelled tokens server-side for a lean list.
 */
export async function listOpenJobs({ country, site, limit = 500 } = {}) {
  try {
    let q = supabase.from('work_orders').select(WO_COLS)
    q = applyCountry(q, country)
    if (site && site !== 'All') q = q.eq('site', site)
    // Exclude the common terminal tokens; the UI still normalises via workOrderStatus.
    q = q.not('status', 'in', '("Completed","Cancelled","completed","cancelled","closed","Closed")')
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Parts catalog for the part picker (name asc). Returns [] when unavailable. */
export async function listPartCatalog({ country, limit = 2000 } = {}) {
  try {
    let q = supabase.from('parts_catalog').select(PART_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('name', { ascending: true }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Distinct non-empty site values from a set of loaded rows (sorted). */
export function distinctSites(rows) {
  const set = new Set()
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = r && r.site
    if (v != null && String(v).trim() !== '') set.add(String(v).trim())
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

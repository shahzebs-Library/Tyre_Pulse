/**
 * Work orders service - workshop jobs (work_orders). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only - mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry, applyCountries, countryList, fetchAllPages, ServiceError } from './_client'

const COLS =
  'id,work_order_no,asset_no,tyre_serial,tyre_position,status,priority,work_type,description,technician_name,workshop_name,site,country,opened_at,started_at,completed_at,target_completion,labour_hours,labour_rate,labour_cost,parts_cost,total_cost,created_at'

// Superset used by the Work Orders page detail drawer / job-card export, which
// also surfaces parts, notes, granular cost buckets, hour/meter fields and any
// preserved import payload. Kept separate from COLS so the least-privilege base
// select stays narrow for other consumers.
const PAGE_COLS =
  `${COLS},parts_used,notes,lubricant_cost,tyre_cost,outside_repair_cost,standard_hours,breakdown_hours,odometer,custom_data`

/**
 * The set an AGGREGATE consumer needs: enough to count by status, judge overdue
 * and bucket by date, and nothing else.
 *
 * This exists because Board Overview reads the WHOLE table - deliberately, its
 * executive KPIs are all-time - and was reading it through PAGE_COLS. That
 * shipped `custom_data` for every row, which is where the V381 job-card intake
 * parks the entire raw ERP line as jsonb, plus `notes` and `parts_used`. Tens of
 * thousands of rows of free text and jsonb crossed the wire so the page could
 * derive a handful of counts. The board engine touches exactly `status` and the
 * two dates it filters on.
 *
 * Kept deliberately wider than those three: the cost and identity columns are
 * cheap scalars and a KPI added later will reach for them. It is the unbounded
 * text and jsonb that had to go, not every column.
 *
 * `due_date` and `target_date` are NOT listed, and must not be added without
 * checking first: neither column exists on work_orders - the only due-date
 * column here is `target_completion` (V381). Selecting a column PostgREST
 * cannot find fails the whole request, so a lean column list is one of the few
 * places where a plausible-looking addition takes the page down.
 */
const AGGREGATE_COLS =
  'id,asset_no,status,priority,work_type,site,country,opened_at,started_at,completed_at,target_completion,labour_cost,parts_cost,total_cost,created_at'

/**
 * List work orders, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / priority / site.
 * @param {{country?:string, status?:string, priority?:string, site?:string, limit?:number}} [opts]
 */
export async function listWorkOrders({ country, status, priority, site, limit = 100 } = {}) {
  let q = supabase
    .from('work_orders')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (status) q = q.eq('status', status)
  if (priority) q = q.eq('priority', priority)
  if (site) q = q.eq('site', site)
  return unwrap(await q)
}

/** Get one work order by id (or null if not found). */
export async function getWorkOrder(id) {
  return unwrap(await supabase.from('work_orders').select(COLS).eq('id', id).maybeSingle())
}

/** Create a work order; returns the inserted row. */
export async function createWorkOrder(values) {
  return unwrap(await supabase.from('work_orders').insert(values).select(COLS).single())
}

/** Update a work order by id; returns the updated row. */
export async function updateWorkOrder(id, patch) {
  return unwrap(
    await supabase.from('work_orders').update(patch).eq('id', id).select(COLS).single(),
  )
}

/**
 * Fetch ONE page of work orders for the Work Orders page, newest opened_at
 * first, country-scoped with a strict match ("All" = no filter). Returns the
 * raw Supabase `{ data, error }` so it drops straight into `fetchAllPages`.
 * @param {{country?:string, from:number, to:number, openedFrom?:string, openedTo?:string}} opts
 */
export function listWorkOrdersPage({ country, countries, from, to, openedFrom, openedTo, lean = false } = {}) {
  const list = countryList(countries)
  let q = supabase
    .from('work_orders')
    .select(lean ? AGGREGATE_COLS : PAGE_COLS)
    .order('opened_at', { ascending: false })
  // Reporting scope: a SET of countries. Absent (the Work Orders page) the query
  // is exactly as it was; one country emits the same `country=eq.X`. The `id`
  // tiebreak is added only on the multi-country path: `opened_at` is not unique
  // and a scope spanning countries reads several times as many rows, so it
  // crosses several times as many page boundaries.
  if (list.length) {
    q = applyCountries(q, list, { nullSafe: false })
    if (list.length > 1) q = q.order('id')
  } else if (country && country !== 'All') {
    q = q.eq('country', country)
  }
  q = q.range(from, to)
  // Bound the window SERVER-side. The page filtered by date client-side, which
  // meant every visit still fetched all 88,773 rows to then show one month of
  // them. The (organisation_id, country, opened_at) index answers this directly.
  if (openedFrom) q = q.gte('opened_at', openedFrom)
  if (openedTo) q = q.lte('opened_at', `${openedTo}T23:59:59.999Z`)
  return q
}

/**
 * List ALL work orders for the Work Orders page and Board Overview.
 *
 * MUST page: PostgREST caps a single response at 1000 rows, and work_orders is
 * the largest operational table (tens of thousands of rows), so the previous
 * single un-ranged select silently returned only the newest 1000. Every
 * consumer treats the result as the complete set - the Work Orders page filters
 * and sorts it client-side, and Board Overview derives executive KPIs from it -
 * so the truncation showed management understated counts and costs with no
 * indication anything was missing.
 * Pass openedFrom/openedTo to bound the window server-side - the page opens on
 * the current month, so it fetches a month instead of the whole table. Omit them
 * for the full set (Board Overview's executive KPIs still want everything).
 * @param {{country?:string, max?:number, openedFrom?:string, openedTo?:string}} [opts]
 * @returns {Promise<any[]>}
 */
export async function listWorkOrdersForPage({ country, countries, max = 200000, openedFrom, openedTo, lean = false } = {}) {
  const { data, error } = await fetchAllPages(
    (from, to) => listWorkOrdersPage({ country, countries, from, to, openedFrom, openedTo, lean }),
    { max },
  )
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/** Insert a work order (page mutation - no row returned). */
export async function insertWorkOrder(values) {
  return unwrap(await supabase.from('work_orders').insert(values))
}

/** Update a work order by id (page mutation - no row returned). */
export async function updateWorkOrderById(id, patch) {
  return unwrap(await supabase.from('work_orders').update(patch).eq('id', id))
}

/** Generate the next sequential work-order number via the DB RPC. */
export async function generateWorkOrderNo() {
  return unwrap(await supabase.rpc('generate_work_order_no'))
}

/**
 * Delete a work order. RLS restricts this to the Admin role
 * (work_orders_delete_admin); the count-verify surfaces a silent policy block
 * as a real error instead of a button that appears to do nothing.
 */
export async function deleteWorkOrder(id) {
  const { data, error } = await supabase.from('work_orders').delete().eq('id', id).select('id')
  if (error) throw new ServiceError(error.message, error.code, error)
  if ((data?.length ?? 0) === 0) {
    throw new ServiceError('The work order was not deleted - only an Admin can delete work orders.', '42501')
  }
}

/**
 * Delete many work orders (Admin-only via RLS). Chunked to stay within request
 * limits; returns the number actually deleted so the UI can surface a partial
 * or permission block instead of pretending success.
 */
export async function deleteWorkOrders(ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return 0
  const CHUNK = 100
  let deleted = 0
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK)
    const { data, error } = await supabase.from('work_orders').delete().in('id', slice).select('id')
    if (error) throw new ServiceError(error.message, error.code, error)
    deleted += data?.length ?? 0
  }
  if (deleted === 0) {
    throw new ServiceError('No work orders were deleted - only an Admin can delete work orders.', '42501')
  }
  return deleted
}

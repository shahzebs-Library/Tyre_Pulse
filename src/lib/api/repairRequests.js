/**
 * repairRequests - service layer for the Request For Repair (RFR).
 *
 * TWO SOURCES, DELIBERATELY SEPARATE, because they answer different questions:
 *
 *  1. `repair_requests` - the LIVE queue. A request that has been raised and is
 *     waiting on the workshop. Provisioned by V608; until that migration is
 *     applied every read here degrades to an honest "not provisioned" result
 *     rather than throwing the page.
 *
 *  2. `work_orders WHERE rfr_no IS NOT NULL` - the HISTORY. Measured live,
 *     57,192 of 90,535 job cards already name an RFR and all 57,192 are
 *     distinct, with `custom_data.raised_by` / `raised_at` on every one. That
 *     data exists TODAY, which is why this module is useful before V608 lands.
 *
 * MISSING-RELATION HANDLING IS NOT COPY-PASTED. `isMissingRelation` from
 * _client.js is THE shared detector (it reads the CODE first - 42P01 / PGRST205
 * / 42883 / PGRST202 - and only falls back to the untouched text on `.cause`,
 * because unwrap() sanitises `err.message` for display).
 *
 * ONE CASE IT DELIBERATELY DOES NOT COVER, handled separately below: 42703,
 * "column does not exist". PostgREST fails the WHOLE request on an unknown
 * column, and the message contains "does not exist", so the shared detector's
 * text fallback would swallow a real, provisioned table as "not provisioned".
 * That would be a silent lie about the workspace, so 42703 is checked FIRST and
 * reported as a schema mismatch naming the column list to reconcile.
 */
import { supabase, isMissingRelation, applyCountry, fetchAllPages } from './_client'

/**
 * The repair_requests columns this module reads.
 *
 * COUPLED TO MIGRATION V608. Exported so it can be diffed against the migration
 * at a glance rather than discovered at runtime: a column named here that the
 * table does not carry fails the whole select (see the 42703 note above), and a
 * column the table carries but this list omits is simply never shown.
 */
export const REPAIR_REQUEST_COLS = [
  'id', 'organisation_id', 'country', 'site', 'rfr_no', 'asset_no', 'plate_no',
  'asset_description', 'odometer', 'engine_hours', 'fault_category',
  'description', 'priority', 'status', 'reported_by', 'reported_by_name',
  'reported_at', 'acknowledged_at', 'acknowledged_by',
  'photos', 'signature', 'work_order_no', 'converted_at',
  'converted_by', 'rejected_reason', 'client_uuid', 'custom_data',
  'created_at', 'updated_at',
]

const COLS = REPAIR_REQUEST_COLS.join(',')

/**
 * Columns a client may WRITE. Deliberately narrower than COLS: organisation_id
 * is server-defaulted, and every timestamp or actor the workflow owns
 * (converted_at, converted_by, reported_by) is stamped server side so a client
 * can never claim somebody else did the work.
 */
export const REPAIR_REQUEST_EDITABLE_COLS = [
  'country', 'site', 'rfr_no', 'asset_no', 'plate_no', 'asset_description',
  'odometer', 'engine_hours', 'fault_category', 'description', 'priority',
  'status', 'reported_by_name', 'reported_at', 'photos', 'signature',
  'client_uuid', 'custom_data',
]

/**
 * The work_orders columns the historical RFR view needs, and nothing more.
 *
 * `custom_data` IS included and is the expensive one: it is where the V381
 * job-card intake parks the whole raw ERP line, and it is also the only place
 * `raised_by` / `raised_at` live. There is no cheaper way to read who raised a
 * request, so the read is bounded by `{ max }` instead. Do NOT add `due_date`
 * or `target_date` - neither column exists, and an unknown column fails the
 * whole request.
 */
const RFR_JOB_CARD_COLS =
  'id,work_order_no,rfr_no,asset_no,asset_description,plate_no,site,country,'
  + 'status,priority,work_type,description,opened_at,custom_data'

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

/** A correctly-shaped empty result, so a caller never has to null-check rows. */
const unavailable = (reason, detail) => ({
  ok: false, reason, detail: detail || null, rows: [], truncated: false,
})

/**
 * Classify a failure into a degrade reason, or rethrow when it is a real error.
 * Order matters: 42703 is checked BEFORE the shared missing-relation detector,
 * whose text fallback would otherwise swallow it.
 */
function degrade(err) {
  const code = err && (err.code || (err.cause && err.cause.code))
  if (String(code) === '42703') {
    return unavailable(
      'schema_mismatch',
      'The repair requests table exists but does not carry the columns this page reads.',
    )
  }
  if (isMissingRelation(err)) return unavailable('not_provisioned')
  return null
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

const text = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Build a write payload from a form object.
 *
 * Asset codes are normalised to UPPER with whitespace stripped, which is the
 * identity every other register in this system uses (V337) - a request typed
 * as "tm 514" must reach the same machine as one scanned as "TM514".
 */
function sanitize(row = {}) {
  const out = {}
  for (const k of REPAIR_REQUEST_EDITABLE_COLS) {
    if (!(k in row)) continue
    const v = row[k]
    if (k === 'odometer' || k === 'engine_hours') out[k] = num(v)
    else if (k === 'asset_no') out[k] = (text(v) || '').toUpperCase().replace(/\s+/g, '') || null
    else if (k === 'photos' || k === 'custom_data') out[k] = v ?? null
    else out[k] = text(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// The live queue
// ---------------------------------------------------------------------------

/**
 * Every repair request in scope, newest first.
 *
 * PAGED, not capped. A register read that silently stops at the server's
 * 1,000-row ceiling understates how many machines are waiting, which is the one
 * number this screen exists to state. The `.order('id')` tiebreak is required
 * rather than tidy: `reported_at` is not unique (several requests are raised in
 * the same minute at a shift change), and `fetchAllPages` fetches pages
 * concurrently, so a page boundary inside a tie group drops or repeats rows
 * without it.
 */
export async function listRepairRequests({
  country, site, status, from, to, max = 20000,
} = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages(
      (start, end) => {
        let q = applyCountry(
          supabase.from('repair_requests').select(COLS),
          country,
        )
          .order('reported_at', { ascending: false })
          .order('id')
        if (site) q = q.eq('site', site)
        if (status) q = q.eq('status', status)
        if (from) q = q.gte('reported_at', from)
        if (to) q = q.lte('reported_at', `${to}T23:59:59.999Z`)
        return q.range(start, end)
      },
      { max },
    )
    if (error) {
      const d = degrade(error)
      if (d) return d
      throw error
    }
    return { ok: true, reason: null, detail: null, rows: data || [], truncated: !!truncated }
  } catch (e) {
    const d = degrade(e)
    if (d) return d
    throw e
  }
}

/** One request by id, or null. Degrades the same way as the list. */
export async function getRepairRequest(id) {
  try {
    const { data, error } = await supabase
      .from('repair_requests').select(COLS).eq('id', id).maybeSingle()
    if (error) {
      const d = degrade(error)
      if (d) return { ok: false, reason: d.reason, detail: d.detail, row: null }
      throw error
    }
    return { ok: true, reason: null, detail: null, row: data || null }
  } catch (e) {
    const d = degrade(e)
    if (d) return { ok: false, reason: d.reason, detail: d.detail, row: null }
    throw e
  }
}

/**
 * Raise a request. Returns the stored row.
 *
 * `status` is forced to 'submitted' on create: a request cannot be born
 * acknowledged or converted, and letting a client choose would let it skip the
 * transition guard the workflow depends on.
 */
export async function createRepairRequest(values = {}) {
  const patch = sanitize(values)
  patch.status = 'submitted'
  const { data, error } = await supabase
    .from('repair_requests').insert(patch).select(COLS).single()
  if (error) throw error
  return data
}

/** Update a request. Only the editable columns are sent. */
export async function updateRepairRequest(id, patch = {}) {
  const { data, error } = await supabase
    .from('repair_requests').update(sanitize(patch)).eq('id', id).select(COLS).single()
  if (error) throw error
  return data
}

/**
 * Move a request to a new status.
 *
 * The legal transitions live in the pure engine and the CALLER checks them
 * against the row it is holding; this writes what it is told. A rejection
 * reason is stored whenever one is supplied, because a rejected request whose
 * reason nobody recorded is indistinguishable from one that was lost.
 */
export async function setRepairRequestStatus(id, status, { reason } = {}) {
  const patch = { status: text(status) }
  if (reason !== undefined) patch.rejected_reason = text(reason)
  const { data, error } = await supabase
    .from('repair_requests').update(patch).eq('id', id).select(COLS).single()
  if (error) throw error
  return data
}

/**
 * Turn a request into a job card.
 *
 * Goes through the V608 RPC rather than two client writes, because the request
 * and the card must move together: a client that inserted the card and then
 * failed to stamp the request would leave the same job open in both places, and
 * the next person would card it again. When the RPC is not provisioned this
 * returns a degraded result naming that, instead of half-converting anything.
 */
export async function convertToJobCard(id, { workOrderNo } = {}) {
  try {
    const { data, error } = await supabase.rpc('convert_repair_request_to_job_card', {
      p_id: id,
      p_work_order_no: text(workOrderNo),
    })
    if (error) {
      const d = degrade(error)
      if (d) {
        return {
          ok: false,
          reason: d.reason === 'not_provisioned' ? 'rpc_missing' : d.reason,
          detail: 'Converting a request to a job card is not available in this workspace yet.',
          row: null,
        }
      }
      throw error
    }
    return { ok: true, reason: null, detail: null, row: data || null }
  } catch (e) {
    const d = degrade(e)
    if (d) {
      return {
        ok: false,
        reason: d.reason === 'not_provisioned' ? 'rpc_missing' : d.reason,
        detail: 'Converting a request to a job card is not available in this workspace yet.',
        row: null,
      }
    }
    throw e
  }
}

/**
 * The next RFR number for a country and site.
 *
 * Server-minted on purpose: the number is a per-country, per-month sequence, so
 * two phones raising a request in the same minute must not both compute 0949.
 * Returns null when the RPC is absent, and the form then accepts a typed
 * reference rather than blocking the request.
 */
export async function nextRfrNo({ country, site } = {}) {
  try {
    const { data, error } = await supabase.rpc('next_rfr_no', {
      p_country: text(country),
      p_site: text(site),
    })
    if (error) {
      if (degrade(error)) return null
      throw error
    }
    return typeof data === 'string' ? data : (data && data.rfr_no) || null
  } catch (e) {
    if (degrade(e)) return null
    throw e
  }
}

// ---------------------------------------------------------------------------
// The historical view
// ---------------------------------------------------------------------------

/**
 * Every job card that names an RFR, newest first.
 *
 * BOUNDED AND PAGED. `work_orders` is the largest operational table (90,535
 * rows, 57,192 of them carrying an RFR), so this read is capped by `{ max }`
 * and reports `truncated` rather than silently showing a slice. The `.order('id')`
 * tiebreak matters here more than anywhere: `opened_at` is measured NOT unique
 * on this table, with tie groups up to 175 rows.
 */
export async function listRfrJobCards({
  country, site, from, to, max = 20000,
} = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages(
      (start, end) => {
        let q = applyCountry(
          supabase.from('work_orders').select(RFR_JOB_CARD_COLS),
          country,
        )
          .not('rfr_no', 'is', null)
          .order('opened_at', { ascending: false })
          .order('id')
        if (site) q = q.eq('site', site)
        if (from) q = q.gte('opened_at', from)
        if (to) q = q.lte('opened_at', `${to}T23:59:59.999Z`)
        return q.range(start, end)
      },
      { max },
    )
    if (error) {
      const d = degrade(error)
      if (d) return d
      throw error
    }
    return { ok: true, reason: null, detail: null, rows: data || [], truncated: !!truncated }
  } catch (e) {
    const d = degrade(e)
    if (d) return d
    throw e
  }
}

/**
 * How many job cards carry an RFR, and how many exist at all.
 *
 * Two head-only counts, so the page can state the coverage without reading a
 * single row. Returns nulls rather than zeros when a count cannot be taken -
 * "we could not look" and "there are none" are opposite statements.
 */
export async function countRfrCoverage({ country } = {}) {
  const take = async (build) => {
    try {
      const { count, error } = await build()
      if (error) {
        if (degrade(error)) return null
        throw error
      }
      return typeof count === 'number' ? count : null
    } catch (e) {
      if (degrade(e)) return null
      throw e
    }
  }

  const withRfr = await take(() =>
    applyCountry(
      supabase.from('work_orders').select('id', { count: 'exact', head: true }),
      country,
    ).not('rfr_no', 'is', null))

  const allCards = await take(() =>
    applyCountry(
      supabase.from('work_orders').select('id', { count: 'exact', head: true }),
      country,
    ))

  return {
    withRfr,
    allCards,
    pct: withRfr !== null && allCards ? Math.round((withRfr / allCards) * 1000) / 10 : null,
  }
}

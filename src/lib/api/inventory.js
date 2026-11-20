/**
 * Inventory Control Center service layer (WEB lane).
 *
 * Talks to the tables and `inv_*` RPCs named in the build contract
 * (docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md). Those objects
 * live in `supabase/pending_migrations/*inv_*` and are applied to NOTHING in
 * production yet, so EVERY call here degrades honestly:
 *
 *   - a read of a table/column that does not exist returns
 *     `{ status: 'not_provisioned', rows: [], total: 0 }` and the screen says
 *     "Not set up yet" - never fake rows, never a silent empty list;
 *   - a write to an RPC that does not exist throws a ServiceError with code
 *     `INV_NOT_PROVISIONED`, which `isInventoryNotSetUp()` recognises;
 *   - any other failure (permission denied, network) throws a sanitised
 *     ServiceError so the screen shows an error with Retry.
 *
 * Paging: every list is server paged with `.range()` and an exact count. Page
 * sizes are clamped below the 1,000-row PostgREST cap. The few full reads
 * (locations of one site, the balance snapshot for valuation/reorder) go
 * through `fetchAllPages` with an `id` tiebreak and a `max` ceiling and report
 * `truncated` so a screen can say when it is not seeing everything.
 *
 * WRITE CONTRACT (confirmed by the DB lane, docs/inventory/10 section 3): every
 * inv_* write RPC takes ONE jsonb argument `p_payload`, and the payload carries
 * a mandatory `idempotency_key`. Reads that take an id use `p_audit_id`.
 *
 * READS go through the web-named `v_inv_*` views (security_invoker, money NULL
 * without stock:view_value, blind-count policies of the base tables apply).
 * The base tables do NOT carry item_code / location_code / serial_no, so a
 * read of a base table with those columns would wrongly say "not set up".
 * The view map is in docs/inventory/91_CLIENT_INTEGRATION.md.
 */
import {
  supabase, ServiceError, toServiceError, isNotProvisioned, isMissingColumn, fetchAllPages, applyCountry,
} from './_client'
import { sanitizeSearchTerm, escapeLike } from '../searchFilter'
import { sanitizeCounterLines } from '../inventory/auditView'
import { CUSTODY_STATES } from '../inventory/tyreInventoryView'

export const NOT_SET_UP_CODE = 'INV_NOT_PROVISIONED'
export const NOT_SET_UP_MESSAGE = 'This part of inventory is not set up yet.'
export const MAX_PAGE_SIZE = 200
export const SNAPSHOT_MAX = 20000

const notProvisioned = (err) => isNotProvisioned(err) || isMissingColumn(err)

export function isInventoryNotSetUp(err) {
  return err?.code === NOT_SET_UP_CODE
}

/** A fresh idempotency key. Create ONE per user action and reuse it on retry. */
export function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

const clampPage = (page) => Math.max(0, Math.floor(Number(page) || 0))
const clampSize = (size) => Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(size) || 25)))

function applySite(q, site) {
  if (site && site !== 'all') return q.eq('site', site)
  return q
}

/**
 * One server page. `build(q)` adds filters to the select builder. Ordering
 * always ends on `id` so a page boundary never drops or repeats a row.
 */
async function pagedRead(table, cols, { page = 0, pageSize = 25, order = 'created_at', ascending = false, build } = {}) {
  const p = clampPage(page)
  const size = clampSize(pageSize)
  const from = p * size
  try {
    let q = supabase.from(table).select(cols, { count: 'exact' })
    if (build) q = build(q)
    if (order) q = q.order(order, { ascending })
    q = q.order('id', { ascending: true }).range(from, from + size - 1)
    const { data, error, count } = await q
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], total: 0 }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], total: count ?? (data || []).length }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], total: 0 }
    throw toServiceError(err)
  }
}

/** Exact count only (HEAD). NULL when the table is not provisioned. */
async function headCount(table, build) {
  try {
    let q = supabase.from(table).select('id', { count: 'exact', head: true })
    if (build) q = build(q)
    const { error, count } = await q
    if (error) {
      if (notProvisioned(error)) return null
      throw toServiceError(error)
    }
    return count ?? 0
  } catch (err) {
    if (notProvisioned(err)) return null
    throw toServiceError(err)
  }
}

/**
 * Codes our own inv_* functions raise with a sentence written for the user
 * (segregation of duties, missing capability, refused shortage, wrong state).
 */
const REFUSAL_CODES = new Set(['22023', '42501', 'P0001', '23514', 'PT409', '55000'])
/** Anything that reads like database internals is never shown verbatim. */
const INTERNAL_TEXT = /relation |column |constraint|function |syntax|violates|null value|duplicate key|permission denied for|schema |operator |does not exist|sqlstate|pg_|::/i

/**
 * The refusal sentence the server wrote, when it is safe to show; otherwise
 * null (the caller falls back to the sanitised generic message). Separation of
 * duties is enforced on the server, so its own reason must reach the user:
 * "The approver cannot be the person who counted" is actionable, "You do not
 * have permission to do that" is not.
 */
export function inventoryRefusalText(err) {
  const e = err?.cause || err
  const code = e?.code ? String(e.code) : ''
  const msg = typeof e?.message === 'string' ? e.message.trim() : ''
  if (!REFUSAL_CODES.has(code) || !msg || msg.length > 240 || INTERNAL_TEXT.test(msg)) return null
  return msg
}

async function rpcWrite(fn, payload, idempotencyKey) {
  if (!idempotencyKey) throw new ServiceError('A request reference is missing. Please try again.', 'INV_NO_IDEMPOTENCY')
  const { data, error } = await supabase.rpc(fn, { p_payload: { ...payload, idempotency_key: idempotencyKey } })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    const refusal = inventoryRefusalText(error)
    if (refusal) throw new ServiceError(refusal, 'INV_REFUSED', error)
    throw toServiceError(error)
  }
  return data
}

function searchOr(cols, term) {
  const s = sanitizeSearchTerm(term)
  if (!s) return null
  const like = `%${escapeLike(s)}%`
  return cols.map((c) => `${c}.ilike.${like}`).join(',')
}

// ── Setup status ─────────────────────────────────────────────────────────────

export const CORE_OBJECTS = [
  'inventory_locations', 'inventory_audits', 'inventory_discrepancies', 'inventory_adjustments',
  'opening_balance_batches', 'tyre_items', 'tyre_custody_conflicts', 'supplier_agreements',
  'purchase_order_lines', 'goods_receipt_lines', 'material_aliases', 'oem_part_references',
]

/** { table: true|false|null } - null = could not tell (never shown as "missing"). */
export async function probeInventorySetup() {
  const out = {}
  await Promise.all(CORE_OBJECTS.map(async (t) => {
    try {
      const c = await headCount(t)
      out[t] = c !== null
    } catch {
      out[t] = null
    }
  }))
  return out
}

// ── Balances ─────────────────────────────────────────────────────────────────

/** Web-named read views and tables (DB contract, docs/inventory/10 section 3). */
export const VIEWS = Object.freeze({
  balances: 'v_inv_balances',
  movements: 'v_inv_movements',
  discrepancies: 'v_inv_discrepancies',
  adjustments: 'v_inv_adjustments',
  openingBatches: 'v_inv_opening_batches',
  openingLines: 'v_inv_opening_lines',
  masterReviews: 'v_inv_master_reviews',
  tyreItems: 'v_inv_tyre_items',
  conflicts: 'v_inv_custody_conflicts',
  agreements: 'v_inv_supplier_agreements',
  poLines: 'v_inv_po_lines',
  grnLines: 'v_inv_grn_lines',
  valuation: 'v_inv_valuation',
  pendingApprovals: 'v_inv_pending_approvals',
  erpReconciliation: 'v_inv_erp_reconciliation',
  reportSnapshot: 'v_inv_report_snapshot',
  costReconciliations: 'inventory_cost_reconciliations',
  transfers: 'stock_transfers',
})

const BALANCE_COLS = 'id, item_id, item_code, description, site, country, location_id, location_code, condition, ownership, owner_supplier_id, qty_on_hand, qty_reserved, avg_unit_cost, currency, reorder_point, min_qty, max_qty, uom, version, updated_at, valued_qty, unvalued_qty, valuation_status'

export function listBalances({ page, pageSize, country, site, search, ownership, condition } = {}) {
  return pagedRead(VIEWS.balances, BALANCE_COLS, {
    page, pageSize, order: 'item_code', ascending: true,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (ownership && ownership !== 'all') q = q.eq('ownership', ownership)
      if (condition && condition !== 'all') q = q.eq('condition', condition)
      const or = searchOr(['item_code', 'description', 'location_code'], search)
      return or ? q.or(or) : q
    },
  })
}

/**
 * Bounded full read of the balance lines in scope, for valuation, reorder
 * signals and the overview. `{ status, rows, truncated }`.
 */
export async function loadBalanceSnapshot({ country, site } = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = supabase.from(VIEWS.balances).select(BALANCE_COLS)
      q = applySite(applyCountry(q, country), site)
      return q.order('id', { ascending: true }).range(from, to)
    }, { max: SNAPSHOT_MAX })
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

// ── Locations ────────────────────────────────────────────────────────────────

const LOCATION_COLS = 'id, organisation_id, country, site, parent_id, location_type, code, name, label_code, responsible_user_id, active, created_at'

export async function listLocations({ country, site } = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = supabase.from('inventory_locations').select(LOCATION_COLS)
      q = applySite(applyCountry(q, country), site)
      return q.order('id', { ascending: true }).range(from, to)
    }, { max: 5000 })
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

/** CONTRACT GAP: no location writer is named in 07; `inv_location_upsert` is proposed. */
export function saveLocation(draft, idempotencyKey) {
  return rpcWrite('inv_location_upsert', {
    id: draft.id || null, site: draft.site, country: draft.country || null, parent_id: draft.parent_id || null,
    location_type: draft.location_type, code: String(draft.code || '').trim(), name: String(draft.name || '').trim(),
    responsible_user_id: draft.responsible_user_id || null, active: draft.active !== false,
  }, idempotencyKey)
}

// ── Movements (append-only ledger) ───────────────────────────────────────────

const MOVEMENT_COLS = 'id, movement_seq, movement_type, item_id, item_code, site, country, location_id, location_code, qty_before, qty_change, qty_after, unit_cost, value_change, currency, ownership, source_doc_type, source_doc_id, reverses_movement_id, reason, reference_no, actor_id, created_by, approval_ref, posted_at, effective_at, created_at, unvalued_qty_change, valuation_status, stock_id'

export function listMovements({ page, pageSize, country, site, type, from, to, search } = {}) {
  return pagedRead(VIEWS.movements, MOVEMENT_COLS, {
    page, pageSize, order: 'posted_at', ascending: false,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (type && type !== 'all') q = q.eq('movement_type', type)
      if (from) q = q.gte('posted_at', `${from}T00:00:00`)
      if (to) q = q.lte('posted_at', `${to}T23:59:59`)
      const or = searchOr(['item_code', 'reference_no', 'source_doc_id', 'reason'], search)
      return or ? q.or(or) : q
    },
  })
}

export function reverseMovement({ movementId, reason }, idempotencyKey) {
  return rpcWrite('inv_reverse_movement', { movement_id: movementId, reason }, idempotencyKey)
}

// ── Physical audits ──────────────────────────────────────────────────────────

const AUDIT_COLS = 'id, ref, audit_type, site, country, scope, status, counter_id, recount_counter_id, reviewer_id, approver_id, created_by, due_at, instructions, snapshot_at, cutoff_seq, created_at, updated_at'

export function listAudits({ page, pageSize, country, site, status, mine, userId } = {}) {
  return pagedRead('inventory_audits', AUDIT_COLS, {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (status === 'open') q = q.not('status', 'in', '(closed,cancelled,rejected)')
      else if (status && status !== 'all') q = q.eq('status', status)
      if (mine && userId) q = q.or(`counter_id.eq.${userId},recount_counter_id.eq.${userId},reviewer_id.eq.${userId},approver_id.eq.${userId}`)
      return q
    },
  })
}

export async function getAudit(id) {
  const { data, error } = await supabase.from('inventory_audits').select(AUDIT_COLS).eq('id', id).maybeSingle()
  if (error) {
    if (notProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    throw toServiceError(error)
  }
  return data
}

export const createAudit = (draft, key) => rpcWrite('inv_audit_create', {
  audit_type: draft.audit_type, site: draft.site, country: draft.country || null,
  scope: { location_ids: draft.location_ids || [], categories: draft.categories || [], high_value_only: !!draft.high_value_only },
  counter_id: draft.counter_id, reviewer_id: draft.reviewer_id, approver_id: draft.approver_id || null,
  due_at: draft.due_at, instructions: String(draft.instructions || '').trim() || null,
}, key)
export const scheduleAudit = (auditId, key) => rpcWrite('inv_audit_schedule', { audit_id: auditId }, key)
export const startAudit = (auditId, key) => rpcWrite('inv_audit_start', { audit_id: auditId }, key)
export const closeAudit = (auditId, key) => rpcWrite('inv_audit_close', { audit_id: auditId }, key)
export const cancelAudit = (auditId, reason, key) => rpcWrite('inv_audit_close', { audit_id: auditId, cancel: true, reason }, key)

/**
 * Blind counter view. The RPC never returns expected quantities; the result is
 * still passed through `sanitizeCounterLines` so a regression on the server
 * cannot leak the book figure onto the counter's screen.
 */
export async function getCounterView(auditId) {
  const { data, error } = await supabase.rpc('inv_audit_counter_view', { p_audit_id: auditId })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    throw toServiceError(error)
  }
  const lines = Array.isArray(data) ? data : (data?.lines || [])
  return { audit: Array.isArray(data) ? null : (data?.audit || null), lines: sanitizeCounterLines(lines) }
}

/** Submit counted lines. Each line carries its own client_uuid (offline-safe retries). */
export const submitCount = ({ auditId, lines, round = 1, deviceId = 'web' }, key) => rpcWrite('inv_count_submit', {
  audit_id: auditId,
  round,
  lines: (lines || []).map((l) => ({
    location_id: l.location_id || null, item_id: l.item_id || null, serial_no: l.serial_no || null,
    counted_qty: l.confirmed_zero ? 0 : l.counted_qty, confirmed_zero: !!l.confirmed_zero,
    condition: l.condition || null, remarks: l.remarks || null, unexpected: !!l.unexpected,
    client_uuid: l.client_uuid || newIdempotencyKey(), device_id: deviceId,
  })),
}, key)

/**
 * The audit line tables carry ids, not codes; the codes come from the item
 * master and the location register through their foreign keys.
 */
const EMBED = 'loc:inventory_locations(code), itm:material_master(item_code, item_name)'
export function flattenEmbed({ loc, itm, ...r }) {
  return {
    ...r,
    location_code: r.location_code || loc?.code || null,
    item_code: r.item_code || itm?.item_code || null,
    description: r.description || itm?.item_name || null,
  }
}

/** Reviewer reads: snapshot + count lines for one audit (RLS hides snapshot from the counter). */
export async function loadReconciliation(auditId) {
  const read = async (table, cols) => {
    const { data, error, truncated } = await fetchAllPages((from, to) => supabase.from(table)
      .select(cols).eq('audit_id', auditId).order('id', { ascending: true }).range(from, to), { max: SNAPSHOT_MAX })
    if (error) throw error
    return { rows: data || [], truncated: !!truncated }
  }
  try {
    const [snap, counts] = await Promise.all([
      read('inventory_audit_snapshot_lines', `id, audit_id, location_id, item_id, description, serial_no:serial, expected_qty, expected_cost:unit_cost, expected_value, currency, ${EMBED}`),
      read('inventory_count_lines', `id, audit_id, location_id, item_id, serial_no:serial, counted_qty, confirmed_zero, condition, remarks, counter_id, counted_at, round, unexpected, late, ${EMBED}`),
    ])
    return { status: 'ok', snapshot: snap.rows.map(flattenEmbed), counts: counts.rows.map(flattenEmbed), truncated: snap.truncated || counts.truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', snapshot: [], counts: [], truncated: false }
    throw toServiceError(err)
  }
}

export const reconcileAudit = (auditId, key) => rpcWrite('inv_audit_reconcile', { audit_id: auditId }, key)
export const assignRecount = ({ auditId, recounterId, lineKeys }, key) => rpcWrite('inv_recount_assign', {
  audit_id: auditId, recount_counter_id: recounterId, line_keys: lineKeys || [],
}, key)

// ── Discrepancies + adjustments ──────────────────────────────────────────────

const DISCREPANCY_COLS = 'id, audit_id, audit_ref, item_id, item_code, description, location_id, location_code, serial_no, category, expected_qty, counted_qty, variance_qty, value_impact, currency, investigator_id, investigation_notes, evidence, proposed_qty, proposed_action, status, approved_by, approved_at, created_at, variance_type, round'
/** Terminal discrepancy statuses (DB CHECK, 20261120102000). */
const CLOSED_DISCREPANCY = '(closed,posted,rejected,written_off,superseded)'

export function listDiscrepancies({ page, pageSize, country, site, status, auditId, search } = {}) {
  return pagedRead(VIEWS.discrepancies, DISCREPANCY_COLS, {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (status === 'open') q = q.not('status', 'in', CLOSED_DISCREPANCY)
      else if (status && status !== 'all') q = q.eq('status', status)
      if (auditId) q = q.eq('audit_id', auditId)
      const or = searchOr(['item_code', 'description', 'serial_no', 'audit_ref'], search)
      return or ? q.or(or) : q
    },
  })
}

export const updateDiscrepancy = (id, patch, key) => rpcWrite('inv_discrepancy_update', {
  discrepancy_id: id,
  status: patch.status ?? undefined,
  category: patch.category ?? undefined,
  investigation_notes: patch.investigation_notes ?? undefined,
  proposed_qty: patch.proposed_qty === '' ? null : patch.proposed_qty,
  proposed_action: patch.proposed_action ?? undefined,
  evidence: patch.evidence ?? undefined,
}, key)

const ADJUSTMENT_COLS = 'id, discrepancy_id, audit_id, item_code, location_code, qty_change, value_change, currency, status, counted_by, created_by, approved_by, approved_at, movement_id, created_at'

export function listAdjustments({ page, pageSize, status, auditId, discrepancyId } = {}) {
  return pagedRead(VIEWS.adjustments, ADJUSTMENT_COLS, {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => {
      if (status && status !== 'all') q = q.eq('status', status)
      if (auditId) q = q.eq('audit_id', auditId)
      if (discrepancyId) q = q.eq('discrepancy_id', discrepancyId)
      return q
    },
  })
}

/** The decisions inv_adjustment_approve accepts. A recount is NOT one of them. */
export const ADJUSTMENT_DECISIONS = ['approve', 'reject', 'hold']

/**
 * decision: approve | reject | hold. A recount needs a NAMED counter, which the
 * approval call does not carry, so it goes through `recountDiscrepancies`
 * (inv_recount_assign) instead; the server refuses `recount` here too.
 */
export const decideAdjustment = ({ adjustmentId, discrepancyId, decision, note }, key) => {
  if (!ADJUSTMENT_DECISIONS.includes(decision)) {
    return Promise.reject(new ServiceError('A recount is assigned to a named counter, not approved here.', 'INV_BAD_DECISION'))
  }
  return rpcWrite('inv_adjustment_approve', {
    adjustment_id: adjustmentId || null, discrepancy_id: discrepancyId || null, decision, note: note || null,
  }, key)
}

/** Send discrepancies back for a recount by a named person who has not counted them. */
export const recountDiscrepancies = ({ auditId, recounterId, discrepancyIds }, key) => rpcWrite('inv_recount_assign', {
  audit_id: auditId, recount_counter_id: recounterId, discrepancy_ids: discrepancyIds || [],
}, key)

// ── Opening balances ─────────────────────────────────────────────────────────

const OB_COLS = 'id, ref, source, source_filename, site, country, status, line_count, missing_cost_count, created_by, submitted_by, approved_by, approved_at, created_at'

export function listOpeningBatches({ page, pageSize, country } = {}) {
  return pagedRead(VIEWS.openingBatches, OB_COLS, {
    page, pageSize, order: 'created_at', ascending: false, build: (q) => applyCountry(q, country),
  })
}

export function listOpeningLines(batchId, { page, pageSize } = {}) {
  return pagedRead(VIEWS.openingLines, 'id, batch_id, line_no, item_code, description, location_code, site, qty, uom, unit_cost, currency, condition, serial_no, mapping_status, missing_cost, issues', {
    page, pageSize, order: 'line_no', ascending: true, build: (q) => q.eq('batch_id', batchId),
  })
}

export const createOpeningBatch = ({ source, filename, site, country, lines }, key) => rpcWrite('inv_opening_batch_create', {
  source, source_filename: filename, site: site || null, country: country || null,
  lines: (lines || []).map(({ issues, blocking, ...l }) => ({ ...l, issues })),
}, key)
export const submitOpeningBatch = (batchId, key) => rpcWrite('inv_opening_batch_submit', { batch_id: batchId }, key)
export const decideOpeningBatch = ({ batchId, decision, note }, key) => rpcWrite('inv_opening_batch_approve', {
  batch_id: batchId, decision, note: note || null,
}, key)

// ── Master data reviews (no auto-merge) ──────────────────────────────────────

/** UI word -> DB status (a review waiting for a decision is `submitted`). */
const REVIEW_STATUS = { pending: 'submitted', approved: 'approved', rejected: 'rejected' }

export function listMasterReviews({ page, pageSize, status } = {}) {
  return pagedRead(VIEWS.masterReviews, 'id, item_id, item_code, proposed_change, change_type, reason, status, requested_by, reviewer_id, review_note, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => (status && status !== 'all' ? q.eq('status', REVIEW_STATUS[status] || status) : q),
  })
}

// ── Tyre inventory ───────────────────────────────────────────────────────────

const TYRE_COLS = 'id, serial_no, custody_state, basis, site, country, location_id, location_code, asset_no, position, purchase_cost, currency, brand, size, updated_at'

export function listTyreItems({ page, pageSize, country, site, state, search } = {}) {
  return pagedRead(VIEWS.tyreItems, TYRE_COLS, {
    page, pageSize, order: 'serial_no', ascending: true,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (state && state !== 'all') q = q.eq('custody_state', state)
      const or = searchOr(['serial_no', 'asset_no', 'brand', 'size'], search)
      return or ? q.or(or) : q
    },
  })
}

/** {state: count|null} per custody state (one HEAD request each, in parallel). */
export async function countTyreItemsByState({ country, site } = {}) {
  const entries = await Promise.all(CUSTODY_STATES.map(async (s) => [s, await headCount(VIEWS.tyreItems,
    (q) => applySite(applyCountry(q, country), site).eq('custody_state', s))]))
  return Object.fromEntries(entries)
}

export function listCustodyConflicts({ page, pageSize, status } = {}) {
  return pagedRead(VIEWS.conflicts, 'id, tyre_item_id, serial_no, country, conflict_type, status, evidence, detected_at, resolved_by, resolved_at, resolution_note, created_at', {
    page, pageSize, order: 'detected_at', ascending: false,
    build: (q) => (status === 'open' ? q.in('status', ['open', 'investigating']) : status && status !== 'all' ? q.eq('status', status) : q),
  })
}

// ── Supply side ──────────────────────────────────────────────────────────────

export function listSupplierAgreements({ page, pageSize, type } = {}) {
  return pagedRead(VIEWS.agreements, 'id, supplier_id, supplier_name, agreement_type, agreement_no, min_qty, max_qty, lead_time_days, credit_terms, return_terms, expires_at, status, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => (type && type !== 'all' ? q.eq('agreement_type', type) : q),
  })
}

export function listPoLines({ page, pageSize, search } = {}) {
  return pagedRead(VIEWS.poLines, 'id, purchase_order_id, po_number, item_code, description, ordered_qty, received_qty, accepted_qty, unit_price, currency, status, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => { const or = searchOr(['po_number', 'item_code', 'description'], search); return or ? q.or(or) : q },
  })
}

export function listGrnLines({ page, pageSize, search } = {}) {
  return pagedRead(VIEWS.grnLines, 'id, goods_receipt_id, grn_number, po_number, item_code, description, received_qty, accepted_qty, rejected_qty, unit_cost, currency, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => { const or = searchOr(['grn_number', 'po_number', 'item_code', 'description'], search); return or ? q.or(or) : q },
  })
}

// ── Identification ───────────────────────────────────────────────────────────

/** Find what a scanned or typed code identifies. Bounded (< 20 rows per source). */
export async function lookupCode(code) {
  const s = sanitizeSearchTerm(code)
  if (!s) return { location: null, items: [], aliases: [], status: 'ok' }
  const locId = s.toUpperCase().startsWith('TP:LOC:') ? s.slice(7) : null
  const safe = (p) => p.then(({ data, error }) => {
    if (error) { if (notProvisioned(error)) return null; throw toServiceError(error) }
    return data
  })
  const [loc, items, aliases] = await Promise.all([
    locId ? safe(supabase.from('inventory_locations').select(LOCATION_COLS).eq('id', locId).limit(1)) : Promise.resolve([]),
    safe(supabase.from('material_master').select('id, item_code, item_name, category, country, barcode').or(`item_code.eq.${s},barcode.eq.${s}`).limit(20)),
    safe(supabase.from('material_aliases').select('id, item_id, alias_type, value, source').eq('value', s).limit(20)),
  ])
  return {
    status: items === null && aliases === null ? 'not_provisioned' : 'ok',
    location: Array.isArray(loc) ? loc[0] || null : null,
    items: items || [],
    aliases: aliases || [],
  }
}

/** Item master search for pickers (receive goods). Bounded to 20 rows. */
export async function searchItems(term, { country } = {}) {
  const or = searchOr(['item_code', 'item_name', 'barcode'], term)
  if (!or) return []
  let q = supabase.from('material_master').select('id, item_code, item_name, country, base_uom').or(or)
  q = applyCountry(q, country)
  const { data, error } = await q.order('item_code').limit(20)
  if (error) {
    if (notProvisioned(error)) return []
    throw toServiceError(error)
  }
  return data || []
}

/** Compatibility evidence counts. 0 validated links -> "No validated compatibility data". */
export async function compatibilityCounts() {
  const [oem, fit] = await Promise.all([
    headCount('oem_part_references'),
    headCount('equipment_fitments'),
  ])
  return { oemReferences: oem, fitments: fit }
}

export async function overviewCounts({ country, site } = {}) {
  const scoped = (q) => applySite(applyCountry(q, country), site)
  const [openAudits, openDiscrepancies, pendingAdjustments, openConflicts, pendingBatches] = await Promise.all([
    headCount('inventory_audits', (q) => scoped(q).not('status', 'in', '(closed,cancelled,rejected)')),
    headCount(VIEWS.discrepancies, (q) => scoped(q).not('status', 'in', CLOSED_DISCREPANCY)),
    headCount(VIEWS.adjustments, (q) => q.eq('status', 'proposed')),
    headCount(VIEWS.conflicts, (q) => q.eq('status', 'open')),
    headCount(VIEWS.openingBatches, (q) => q.eq('status', 'submitted')),
  ])
  return { openAudits, openDiscrepancies, pendingAdjustments, openConflicts, pendingBatches }
}

/** People who can be named as counter / reviewer / approver (same org via RLS). */
export async function listAssignablePeople() {
  const { data, error } = await supabase.from('profiles').select('id, full_name, username, role').eq('approved', true).order('full_name').limit(500)
  if (error) throw toServiceError(error)
  return data || []
}

/** Bounded full read for report exports (max SNAPSHOT_MAX rows, `truncated` reported). */
export async function loadReportRows(source, { country, site, from, to, status } = {}) {
  const spec = {
    balances: [VIEWS.balances, BALANCE_COLS, null],
    movements: [VIEWS.movements, MOVEMENT_COLS, 'posted_at'],
    audits: ['inventory_audits', AUDIT_COLS, 'created_at'],
    discrepancies: [VIEWS.discrepancies, DISCREPANCY_COLS, 'created_at'],
    tyreItems: [VIEWS.tyreItems, TYRE_COLS, null],
    conflicts: [VIEWS.conflicts, 'id, serial_no, country, conflict_type, status, evidence, detected_at', 'detected_at'],
  }[source]
  if (!spec) throw new ServiceError('Unknown report.', 'INV_UNKNOWN_REPORT')
  const [table, cols, dateCol] = spec
  // Conflicts carry a country but no site, so only the country filter applies.
  const siteScoped = source !== 'conflicts'
  try {
    const { data, error, truncated } = await fetchAllPages((a, b) => {
      let q = supabase.from(table).select(cols)
      q = applyCountry(q, country)
      if (siteScoped) q = applySite(q, site)
      if (dateCol && from) q = q.gte(dateCol, `${from}T00:00:00`)
      if (dateCol && to) q = q.lte(dateCol, `${to}T23:59:59`)
      if (status && status !== 'all') q = q.eq('status', status)
      return q.order('id', { ascending: true }).range(a, b)
    }, { max: SNAPSHOT_MAX })
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

// ── Approvals (inv_request_approval + v_inv_pending_approvals) ───────────────
//
// Adjustments, recounts, opening batches and cost reconciliations need an
// APPROVED approval before the server will act on them. Segregation of duties
// (requester != approver, counter != approver) is enforced server-side; the
// refusal sentence reaches the user through `inventoryRefusalText`.

export const APPROVAL_ENTITY_TYPES = ['adjustment', 'recount', 'opening_batch', 'cost_reconciliation']

/** Where each approval is decided in the hub (section + optional tab). */
export const APPROVAL_TARGET = Object.freeze({
  adjustment: { section: 'discrepancies' },
  recount: { section: 'audits' },
  opening_batch: { section: 'controls', tab: 'opening' },
  cost_reconciliation: { section: 'valuation', tab: 'costs' },
})

export function listPendingApprovals({ page, pageSize, entityType, country, site } = {}) {
  // select('*') + id ordering only: the DB lane owns this view's shape, and a
  // guessed column would fail the whole request (read as "not set up").
  return pagedRead(VIEWS.pendingApprovals, '*', {
    page, pageSize, order: null,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      return entityType && entityType !== 'all' ? q.eq('entity_type', entityType) : q
    },
  })
}

export function requestApproval({ entityType, entityId }, key) {
  if (!APPROVAL_ENTITY_TYPES.includes(entityType)) {
    return Promise.reject(new ServiceError('This record cannot be sent for approval.', 'INV_BAD_ENTITY'))
  }
  if (!entityId) return Promise.reject(new ServiceError('Choose the record to send for approval.', 'INV_NO_ENTITY'))
  return rpcWrite('inv_request_approval', { entity_type: entityType, entity_id: entityId }, key)
}

// ── Valuation (v_inv_valuation, inventory_cost_reconciliations) ──────────────
//
// OWNER RULE: unknown cost is never zero and never invented. The view gives
// valued qty, unvalued qty, the valued amount per currency and a completeness
// flag; a partial value is never labelled a total.

export async function loadValuation({ country, site } = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = supabase.from(VIEWS.valuation).select('*')
      q = applySite(applyCountry(q, country), site)
      return q.order('id', { ascending: true }).range(from, to)
    }, { max: 5000 })
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

export function listCostReconciliations({ page, pageSize, status, country, site } = {}) {
  return pagedRead(VIEWS.costReconciliations, '*', {
    page, pageSize, order: null,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (status === 'open') return q.not('status', 'in', '(resolved,approved,rejected,cancelled,closed)')
      return status && status !== 'all' ? q.eq('status', status) : q
    },
  })
}

/**
 * Record an evidenced cost for unvalued stock (or reject the reconciliation).
 * Nothing is defaulted: a blank cost is refused here rather than sent as 0.
 */
export function reconcileCost({ reconciliationId, stockId, unitCost, currency, source, evidence, note, decision = 'propose' }, key) {
  if (decision === 'propose') {
    const c = Number(unitCost)
    if (unitCost === '' || unitCost === null || unitCost === undefined || !Number.isFinite(c) || c <= 0) {
      return Promise.reject(new ServiceError('Enter the evidenced unit cost (greater than zero).', 'INV_NO_COST'))
    }
    if (!String(currency || '').trim()) return Promise.reject(new ServiceError('Choose the currency of the cost.', 'INV_NO_CURRENCY'))
  }
  return rpcWrite('inv_cost_reconcile', {
    reconciliation_id: reconciliationId || null, stock_id: stockId || null, decision,
    unit_cost: decision === 'propose' ? Number(unitCost) : null,
    currency: decision === 'propose' ? String(currency).trim().toUpperCase() : null,
    source: source || null, evidence: evidence || null, note: note || null,
  }, key)
}

// ── ERP reconciliation (read-only, v_inv_erp_reconciliation) ─────────────────

function erpFilters(q, { country, site, status, search }) {
  q = applySite(applyCountry(q, country), site)
  if (status === 'differences') q = q.neq('status', 'matched')
  else if (status && status !== 'all') q = q.eq('status', status)
  const or = searchOr(['item_code', 'description'], search)
  return or ? q.or(or) : q
}

export function listErpReconciliation({ page, pageSize, ...filters } = {}) {
  return pagedRead(VIEWS.erpReconciliation, '*', { page, pageSize, order: null, build: (q) => erpFilters(q, filters) })
}

/** Bounded full read for the ERP reconciliation export (same filters as the screen). */
export async function loadErpReconciliationRows(filters = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => erpFilters(
      supabase.from(VIEWS.erpReconciliation).select('*'), filters,
    ).order('id', { ascending: true }).range(from, to), { max: SNAPSHOT_MAX })
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

// ── Stock flows: receive, reserve, issue, transfer ───────────────────────────
//
// Each form mints ONE idempotency key when it opens and reuses it on retry.
// Stock never goes negative: a shortage answers `{status:'refused_shortage'}`
// and posts nothing (a stock_exceptions row records it).

const qtyOk = (q) => q !== '' && q !== null && q !== undefined && Number.isFinite(Number(q)) && Number(q) > 0
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

/** inv_receive_goods: a GRN with lines; rejected qty never enters stock. */
export function receiveGoods({ country, site, grnNo, poId, supplierId, lines }, key) {
  const clean = (lines || []).filter((l) => l.item_id && l.location_id && qtyOk(l.qty_received))
  if (!clean.length) return Promise.reject(new ServiceError('Add at least one line with an item, a location and a received quantity.', 'INV_NO_LINES'))
  return rpcWrite('inv_receive_goods', {
    country: country || null, site: site || null, grn_no: grnNo || null, po_id: poId || null, supplier_id: supplierId || null,
    lines: clean.map((l) => ({
      item_id: l.item_id, location_id: l.location_id, po_line_id: l.po_line_id || null,
      qty_received: Number(l.qty_received), qty_rejected: Number(l.qty_rejected) || 0,
      rejection_reason: l.rejection_reason || null, unit_cost: numOrNull(l.unit_cost),
      currency: l.currency || null, condition: l.condition || 'new', ownership: l.ownership || 'owned',
      owner_supplier_id: l.owner_supplier_id || null,
    })),
  }, key)
}

/** inv_reserve: hold a quantity of one balance line for a document (e.g. a job card). */
export function reserveStock({ stockId, qty, sourceDocType, sourceDocId }, key) {
  if (!stockId || !qtyOk(qty)) return Promise.reject(new ServiceError('Choose a stock line and a quantity above zero.', 'INV_BAD_QTY'))
  return rpcWrite('inv_reserve', {
    stock_id: stockId, qty: Number(qty), source_doc_type: sourceDocType || 'job_card', source_doc_id: sourceDocId || null,
  }, key)
}

/** inv_issue: issue stock (optionally consuming a reservation). */
export function issueStock({ stockId, qty, reservationId, reason, referenceNo, sourceDocType, sourceDocId }, key) {
  if (!stockId || !qtyOk(qty)) return Promise.reject(new ServiceError('Choose a stock line and a quantity above zero.', 'INV_BAD_QTY'))
  return rpcWrite('inv_issue', {
    stock_id: stockId, qty: Number(qty), reservation_id: reservationId || null, reason: reason || null,
    reference_no: referenceNo || null, source_doc_type: sourceDocType || 'issue', source_doc_id: sourceDocId || null,
  }, key)
}

/** inv_transfer_dispatch: source stock moves to the in-transit location. */
export function dispatchTransfer({ fromLocationId, toLocationId, lines, remarks }, key) {
  if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
    return Promise.reject(new ServiceError('Choose two different locations.', 'INV_BAD_LOCATIONS'))
  }
  const clean = (lines || []).filter((l) => (l.stock_id || l.scanned_code) && qtyOk(l.qty))
  if (!clean.length) return Promise.reject(new ServiceError('Add at least one line with a quantity.', 'INV_NO_LINES'))
  return rpcWrite('inv_transfer_dispatch', {
    from_location_id: fromLocationId, to_location_id: toLocationId, remarks: remarks || null,
    lines: clean.map((l) => (l.stock_id ? { stock_id: l.stock_id, qty: Number(l.qty) } : { scanned_code: l.scanned_code, qty: Number(l.qty) })),
  }, key)
}

/** inv_transfer_receive: received qty per line (a short receipt stays in transit). */
export function receiveTransfer({ transferId, lines }, key) {
  const clean = (lines || []).filter((l) => l.line_id && l.received_qty !== '' && l.received_qty != null && Number(l.received_qty) >= 0)
  if (!transferId || !clean.length) return Promise.reject(new ServiceError('Enter the received quantity for at least one line.', 'INV_NO_LINES'))
  return rpcWrite('inv_transfer_receive', {
    transfer_id: transferId,
    lines: clean.map((l) => ({ line_id: l.line_id, received_qty: Number(l.received_qty), condition: l.condition || 'good', remarks: l.remarks || null })),
  }, key)
}

export function listTransfers({ page, pageSize, country, site, status } = {}) {
  // stock_transfers has no created_at; dispatched_at is its timestamp.
  return pagedRead(VIEWS.transfers, '*, lines:stock_transfer_lines(*, itm:material_master(item_code, item_name))', {
    page, pageSize, order: 'dispatched_at', ascending: false,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (status === 'open') return q.in('status', ['dispatched', 'in_transit', 'partially_received'])
      return status && status !== 'all' ? q.eq('status', status) : q
    },
  })
}

// ── Scheduled digest (v_inv_report_snapshot) ────────────────────────────────

/** Digest rows (one per country/site/currency). Read-only; reports + email. */
export async function loadReportSnapshot({ country, site } = {}) {
  try {
    let q = supabase.from(VIEWS.reportSnapshot).select('*')
    q = applySite(applyCountry(q, country), site)
    const { data, error } = await q.limit(500)
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [] }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [] }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [] }
    throw toServiceError(err)
  }
}

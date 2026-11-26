/**
 * Inventory Control Center service layer (WEB lane).
 *
 * Talks to the tables and `inv_*` RPCs named in the build contract
 * (docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md). Those objects
 * live in `supabase/migrations/*inv_*` (applied to production 2026-11-20). An
 * environment without them still degrades honestly:
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
import { receivableLines } from '../inventory/stockFlowRules'

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
async function pagedRead(table, cols, { page = 0, pageSize = 25, order = 'created_at', ascending = false, build, tiebreak = ['id'] } = {}) {
  const p = clampPage(page)
  const size = clampSize(pageSize)
  const from = p * size
  try {
    let q = supabase.from(table).select(cols, { count: 'exact' })
    if (build) q = build(q)
    if (order) q = q.order(order, { ascending })
    // Every page needs a total order or a row can repeat or vanish at a page edge.
    // Views without an `id` pass their own unique key as `tiebreak`.
    for (const col of tiebreak) q = q.order(col, { ascending: true })
    q = q.range(from, from + size - 1)
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
  if (!REFUSAL_CODES.has(code) || !msg) return null
  for (const [re, plain] of PLAIN_REFUSALS) {
    const m = msg.match(re)
    if (m) return typeof plain === 'function' ? plain(m) : plain
  }
  if (msg.length > 240 || INTERNAL_TEXT.test(msg) || SNAKE_IDENT.test(msg)) return null
  return msg
}

/** A snake_case identifier (a column or function name) means the sentence was written for developers. */
const SNAKE_IDENT = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/

/**
 * Server sentences that name internals or are worded for developers, rewritten
 * in plain words. Order matters: the first match wins.
 */
const PLAIN_REFUSALS = [
  [/undecided issue allocation.*opening correction/i,
    'Some of this stock left with an undecided cost split. Decide that split in Valuation > Cost reconciliation before posting an opening correction.'],
  [/undecided issue allocation.*assigning a cost/i,
    'Some of this stock left with an undecided cost split. Decide that split in Valuation > Cost reconciliation before pricing the units still in stock.'],
  [/serial or lot tracked/i,
    'This item is tracked by serial or lot and its stock mixes known and unknown cost. Choose the goods receipt the units came from, then try again.'],
  [/split is not possible on the balance now/i,
    'This split no longer fits the stock as it is now. Decide any earlier undecided split for this item first.'],
  [/issue allocation .*cannot be written off/i,
    'An undecided split cannot be written off. Decide how many of the units carry the known cost.'],
  [/valued_qty must be between 0 and (\d+(?:\.\d+)?)/i,
    (m) => `The units at known cost must be between 0 and ${m[1]}.`],
  [/evidence \(batch, receipt or GRN\) or a reason for the split/i,
    'Give evidence (batch, receipt or GRN) or a reason for the split.'],
  [/transfer carried units with an undecided split/i,
    'This transfer carried units with an undecided cost split. Transfer them back instead of reversing it.'],
  [/approved cost allocation is undone by reversing/i,
    'An approved cost split is undone by reversing the original movement.'],
  [/approved (.+?) approval is required before this can be posted/i,
    (m) => `This needs an approved ${m[1]} request first. Ask for approval, and post once another person has approved it.`],
  [/Stock permission "([a-z_]+)" is required/i,
    (m) => `You do not have the inventory permission "${m[1].replace(/_/g, ' ')}".`],
]

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
  costReconciliations: 'v_inv_cost_reconciliations',
  approvalRequests: 'inventory_approval_requests',
  transfers: 'stock_transfers',
  receiptSources: 'v_inv_receipt_sources',
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

/**
 * inv_location_bulk_create (pending 20261122120000): a whole rack / shelf / bin
 * layout under one existing store. `dryRun` returns the plan and writes nothing.
 */
export function bulkCreateLocations(payload, idempotencyKey, { dryRun = false } = {}) {
  return rpcWrite('inv_location_bulk_create', { ...payload, dry_run: !!dryRun }, idempotencyKey)
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
/** End counting (in_progress / recount -> counting_completed). Late offline lines counted before this still count. */
export const completeCounting = (auditId, key) => rpcWrite('inv_audit_complete_counting', { audit_id: auditId }, key)
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
  // The server returns each line's location_id and, separately, the audit's
  // locations (id, code, name). Without joining them the counter saw the same
  // item three times with no shelf named (web acceptance test, 2026-11-20).
  const locs = new Map((Array.isArray(data?.locations) ? data.locations : []).map((x) => [x.id, x]))
  const named = lines.map((l) => {
    const loc = l.location_id ? locs.get(l.location_id) : null
    return loc && !l.location_code ? { ...l, location_code: loc.code, location_name: loc.name || null } : l
  })
  return {
    audit: Array.isArray(data) ? null : (data?.audit || null),
    lines: sanitizeCounterLines(named),
    // The audit's own locations: an extra (unexpected) line typed by code is
    // resolved against these before it is sent (the server takes ids, not codes).
    locations: Array.isArray(data?.locations) ? data.locations.map((x) => ({ id: x.id, code: x.code || null, name: x.name || null })) : [],
  }
}

/**
 * Submit counted lines. Each line carries its own client_uuid (offline-safe
 * retries): callers must allocate it ONCE per line and resend the identical
 * payload on a retry (the outer key's stored hash covers the whole payload).
 * The fallback below only serves callers that never retry.
 * Answer: { accepted: uuid[], duplicates: uuid[], rejected: [{client_uuid, reason}] }.
 */
export const submitCount = ({ auditId, lines, round = 1, deviceId = 'web' }, key) => rpcWrite('inv_count_submit', {
  audit_id: auditId,
  round,
  lines: (lines || []).map((l) => ({
    location_id: l.location_id || null, item_id: l.item_id || null, serial_no: l.serial_no || null,
    ...(l.stock_id ? { stock_id: l.stock_id } : {}),
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

// ── ERP stores ledger (Ramco CSOL-IMS-013-1) ─────────────────────────────────

const ERP_UPLOAD_COLS = 'id, country, site, location_id, warehouse_code, filename, file_sha256, report_id, currency, period_from, period_to, line_count, status, zero_missing, applied, summary, posted_by, created_at, posted_at'

/**
 * Every Material Master row for a country (code, name, category, reviewed), for
 * matching a ledger file. Bounded; `truncated` says when the ceiling was hit.
 */
export async function loadMasterForLedger(country) {
  const { data, error, truncated } = await fetchAllPages((from, to) => supabase.from('material_master')
    .select('id, item_code, item_name, category, subcategory, reviewed, serial_tracked, lot_tracked')
    .eq('country', country)
    .order('id', { ascending: true }).range(from, to), { max: 40000 })
  if (error) throw toServiceError(error)
  return { rows: data || [], truncated: !!truncated }
}

/** Stock lines at one store location, with their item code. */
export async function loadStockAtLocation(locationId) {
  const { data, error, truncated } = await fetchAllPages((from, to) => supabase.from('stock_records')
    .select('id, item_id, description, qty_on_hand, qty_reserved, condition, ownership, itm:material_master(item_code)')
    .eq('location_id', locationId)
    .order('id', { ascending: true }).range(from, to), { max: 20000 })
  if (error) throw toServiceError(error)
  const rows = (data || [])
    .filter((r) => (r.condition || 'new') === 'new' && (r.ownership || 'owned') === 'owned')
    .map(({ itm, ...r }) => ({ ...r, item_code: itm?.item_code || null }))
  return { rows, truncated: !!truncated }
}

/** Earlier ledger uploads, newest first. */
export function listErpLedgerUploads({ page, pageSize, country } = {}) {
  return pagedRead('erp_ledger_uploads', ERP_UPLOAD_COLS, {
    page, pageSize, order: 'created_at', ascending: false, build: (q) => applyCountry(q, country).neq('status', 'cancelled'),
  })
}

/** An upload already posted for this file fingerprint, or null. */
export async function findErpLedgerUpload(sha256) {
  const { data, error } = await supabase.from('erp_ledger_uploads').select(ERP_UPLOAD_COLS).eq('file_sha256', sha256)
    .neq('status', 'cancelled').limit(1)
  if (error) {
    if (isNotProvisioned(error)) return null
    throw toServiceError(error)
  }
  return data?.[0] || null
}

/** Stock movements at a store recorded after a date (a ledger older than these would undo them). */
export async function countMovementsAfter(locationId, isoDate) {
  if (!locationId || !isoDate) return null
  const next = new Date(`${isoDate}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const { count, error } = await supabase.from('stock_movements')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .gte('created_at', next.toISOString())
  if (error) return null
  return count ?? null
}

// Owner only; the database refuses anyone else. A post runs in parts so a
// large store stays inside the request time limit; every part is safe to retry.
export const beginErpLedger = (payload, key) => rpcWrite('inv_erp_ledger_begin', payload, key)
export const applyErpLedger = (uploadId, key, limit = 150) => rpcWrite('inv_erp_ledger_apply', { upload_id: uploadId, limit }, key)
export const finishErpLedger = (uploadId, key, limit = 150) => rpcWrite('inv_erp_ledger_finish', { upload_id: uploadId, limit }, key)
export const cancelErpLedger = (uploadId, key) => rpcWrite('inv_erp_ledger_cancel', { upload_id: uploadId }, key)

/**
 * Run an upload to the end: post the stock in parts, then finish it.
 * Calls onProgress({ phase, remaining }) between parts. Resumable: call it
 * again with the same upload id after a failure.
 */
export async function runErpLedger(uploadId, { onProgress, limit = 150, maxRounds = 200 } = {}) {
  for (let i = 0; i < maxRounds; i += 1) {
    const r = await applyErpLedger(uploadId, newIdempotencyKey(), limit)
    onProgress?.({ phase: 'stock', remaining: r?.remaining ?? 0 })
    if (!r?.remaining) break
  }
  for (let i = 0; i < maxRounds; i += 1) {
    const r = await finishErpLedger(uploadId, newIdempotencyKey(), limit)
    onProgress?.({ phase: 'finish', remaining: r?.remaining ?? 0 })
    if (r?.done) return r
  }
  throw new ServiceError('The upload did not finish. Open it again and continue.', 'INV_ERP_UNFINISHED')
}

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

/**
 * Re-derive tyre custody (tyre_items, conflicts) from tyre_records and the scrap
 * marks. Read-only on tyre_records: the answer carries tyre_records_written = 0.
 * Repeatable, so a fresh key per press is fine.
 */
export function syncTyreItems({ country } = {}, key) {
  return rpcWrite('inv_tyre_item_sync', { country: country || null }, key)
}

/** Allowed outcomes of a custody conflict (DB CHECK); a person decides, with a reason. */
export const CONFLICT_DECISIONS = ['resolved', 'dismissed']

/**
 * Close one custody conflict with an evidence-based reason. It records the
 * decision only: tyre_records and the scrap marks are never changed from here.
 */
export function decideCustodyConflict({ conflictId, status, note }, key) {
  if (!conflictId) return Promise.reject(new ServiceError('Choose the conflict.', 'INV_NO_ENTITY'))
  if (!CONFLICT_DECISIONS.includes(status)) return Promise.reject(new ServiceError('Choose resolved or dismissed.', 'INV_BAD_DECISION'))
  if (isBlank(note) || !String(note).trim()) return Promise.reject(new ServiceError('Give the evidence-based reason.', 'INV_NO_NOTE'))
  return rpcWrite('inv_tyre_conflict_decide', { conflict_id: conflictId, status, note: String(note).trim() }, key)
}

// ---------------------------------------------------------------------------
// Scrapped-but-active conflicts: investigation workflow (20261120114000).
// open -> investigating -> proposed -> approved | rejected -> closed. The
// approval is an ordinary inventory approval request (decideApproval) that only an
// independent PMV Manager can decide. Closing records the decision; tyre records
// and scrap marks are never changed from here.
// ---------------------------------------------------------------------------
export const CORRECTION_ACTIONS = ['clear_scrap_mark', 'close_active_fitment', 'correct_serial', 'no_change', 'other']

export function assignConflictInvestigator({ conflictId, investigatorId, note }, key) {
  if (!conflictId) return Promise.reject(new ServiceError('Choose the conflict.', 'INV_NO_ENTITY'))
  if (!investigatorId) return Promise.reject(new ServiceError('Choose the investigator.', 'INV_NO_ENTITY'))
  return rpcWrite('inv_tyre_conflict_assign', { conflict_id: conflictId, investigator_id: investigatorId, note: note || null }, key)
}

export function recordConflictFinding({ conflictId, note, evidence }, key) {
  if (!conflictId) return Promise.reject(new ServiceError('Choose the conflict.', 'INV_NO_ENTITY'))
  if (isBlank(note) || !String(note).trim()) return Promise.reject(new ServiceError('Write what was checked and found.', 'INV_NO_NOTE'))
  return rpcWrite('inv_tyre_conflict_investigate', { conflict_id: conflictId, note: String(note).trim(), evidence: evidence || [] }, key)
}

export function proposeConflictCorrection({ conflictId, action, detail, tyreRecordId, reason }, key) {
  if (!conflictId) return Promise.reject(new ServiceError('Choose the conflict.', 'INV_NO_ENTITY'))
  if (!CORRECTION_ACTIONS.includes(action)) return Promise.reject(new ServiceError('Choose the proposed correction.', 'INV_BAD_DECISION'))
  if (isBlank(detail) || !String(detail).trim()) return Promise.reject(new ServiceError('Describe the correction for the tyre team.', 'INV_NO_NOTE'))
  return rpcWrite('inv_tyre_conflict_propose', {
    conflict_id: conflictId, reason: reason || null,
    correction: { action, detail: String(detail).trim(), tyre_record_id: tyreRecordId || null },
  }, key)
}

export function closeConflictCase({ conflictId, note }, key) {
  if (!conflictId) return Promise.reject(new ServiceError('Choose the conflict.', 'INV_NO_ENTITY'))
  return rpcWrite('inv_tyre_conflict_close', { conflict_id: conflictId, note: note || null }, key)
}

export function listConflictCases({ page, pageSize, investigationStatus } = {}) {
  return pagedRead('v_inv_tyre_conflict_cases', 'id, serial, country, conflict_type, status, investigation_status, detected_at, evidence, investigator_id, assigned_at, investigation_notes, proposed_correction, proposed_at, approval_request_id, approval_status, decided_correction, closed_at, i_am_investigator', {
    page, pageSize, order: 'detected_at', ascending: false,
    build: (q) => (investigationStatus ? q.eq('investigation_status', investigationStatus) : q),
  })
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

// ── Approvals (inv_request_approval -> inv_approval_decide -> posting) ───────
//
// Adjustment posting, opening-batch approval, recount assignment and cost
// reconciliation each need an APPROVED request first (DB gates on every path,
// docs/inventory/10 section 6.2). The posting call consumes the approval; what is
// posted must match what was approved (a recount's counter, a cost's proposal).
// Segregation of duties is decided by the server and exposed per row as
// v_inv_pending_approvals.can_decide / blocked_reason, so the client never
// guesses who may decide.

/** entity_type values accepted by inv_request_approval (DB CHECK). */
export const APPROVAL_ENTITY_TYPES = ['stock_adjustment', 'recount_assignment', 'opening_balance_batch', 'cost_reconciliation']

/** Where the evidence for each approval lives in the hub (section + optional tab). */
export const APPROVAL_TARGET = Object.freeze({
  stock_adjustment: { section: 'discrepancies' },
  recount_assignment: { section: 'audits' },
  opening_balance_batch: { section: 'controls', tab: 'opening' },
  cost_reconciliation: { section: 'valuation', tab: 'costs' },
})

export function listPendingApprovals({ page, pageSize, entityType, country, site } = {}) {
  return pagedRead(VIEWS.pendingApprovals, '*', {
    page, pageSize, order: 'requested_at', ascending: true,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      return entityType && entityType !== 'all' ? q.eq('entity_type', entityType) : q
    },
  })
}

const isBlank = (v) => v === '' || v === null || v === undefined

/**
 * Ask for approval. `proposal` is required where the posting step must match it:
 * recount_assignment {counter_id}; cost_reconciliation {resolution, unit_cost}.
 * A cost resolution needs evidence or a reason; unknown cost is never sent as 0.
 */
export function requestApproval({ entityType, entityId, proposal, reason, evidence }, key) {
  if (!APPROVAL_ENTITY_TYPES.includes(entityType)) {
    return Promise.reject(new ServiceError('This record cannot be sent for approval.', 'INV_BAD_ENTITY'))
  }
  if (!entityId) return Promise.reject(new ServiceError('Choose the record to send for approval.', 'INV_NO_ENTITY'))
  let prop = null
  if (entityType === 'recount_assignment') {
    if (!proposal?.counter_id) return Promise.reject(new ServiceError('Choose who will recount.', 'INV_NO_RECOUNTER'))
    prop = { counter_id: proposal.counter_id }
  } else if (entityType === 'cost_reconciliation' && proposal && 'valued_qty' in proposal) {
    // An undecided split (issue_allocation): state how many of the ambiguous
    // units were at KNOWN cost, from evidence. Never written off.
    const v = Number(proposal.valued_qty)
    const max = proposal.max_qty === undefined || proposal.max_qty === null ? null : Number(proposal.max_qty)
    if (isBlank(proposal.valued_qty) || !Number.isFinite(v) || v < 0 || (max !== null && v > max)) {
      return Promise.reject(new ServiceError(max === null
        ? 'Enter how many units carry the known cost.'
        : `Enter how many units carry the known cost, between 0 and ${max}.`, 'INV_BAD_SPLIT'))
    }
    const hasEvidence = Array.isArray(evidence) ? evidence.length > 0 : !isBlank(evidence)
    if (!hasEvidence && isBlank(reason)) {
      return Promise.reject(new ServiceError('Give evidence (batch, receipt or GRN) or a reason for the split.', 'INV_NO_EVIDENCE'))
    }
    prop = { resolution: 'resolved', valued_qty: v }
  } else if (entityType === 'cost_reconciliation') {
    const resolution = proposal?.resolution === 'written_off' ? 'written_off' : 'resolved'
    if (resolution === 'resolved') {
      const c = Number(proposal?.unit_cost)
      if (isBlank(proposal?.unit_cost) || !Number.isFinite(c) || c < 0) {
        return Promise.reject(new ServiceError('Enter the evidenced unit cost. A blank cost is never sent as zero.', 'INV_NO_COST'))
      }
      const hasEvidence = Array.isArray(evidence) ? evidence.length > 0 : !isBlank(evidence)
      if (!hasEvidence && isBlank(reason)) {
        return Promise.reject(new ServiceError('Give evidence or a reason for the cost.', 'INV_NO_EVIDENCE'))
      }
      prop = { resolution, unit_cost: c }
    } else {
      if (isBlank(reason)) return Promise.reject(new ServiceError('Give the reason for writing this off.', 'INV_NO_REASON'))
      prop = { resolution }
    }
  }
  const ev = Array.isArray(evidence) ? evidence : isBlank(evidence) ? [] : [{ type: 'note', text: String(evidence).trim() }]
  return rpcWrite('inv_request_approval', {
    entity_type: entityType, entity_id: entityId, proposal: prop || undefined,
    reason: isBlank(reason) ? null : String(reason).trim(), evidence: ev,
  }, key)
}

/** approve | reject on one pending request. Reject needs a note (server rule too). */
export const APPROVAL_DECISIONS = ['approve', 'reject']
export function decideApproval({ requestId, decision, note, signature }, key) {
  if (!APPROVAL_DECISIONS.includes(decision)) {
    return Promise.reject(new ServiceError('Choose approve or reject.', 'INV_BAD_DECISION'))
  }
  if (!requestId) return Promise.reject(new ServiceError('Choose the request.', 'INV_NO_ENTITY'))
  if (decision === 'reject' && isBlank(note)) {
    return Promise.reject(new ServiceError('Give a reason for the rejection.', 'INV_NO_NOTE'))
  }
  return rpcWrite('inv_approval_decide', {
    request_id: requestId, decision, note: isBlank(note) ? null : String(note).trim(), signature: signature || null,
  }, key)
}

/**
 * The newest approval request for one record (any status), or null. Shows
 * "approval pending / approved / rejected" beside the posting button. Best
 * effort: an unreadable table answers null and never blocks the screen.
 */
export async function getApprovalState(entityType, entityId) {
  if (!entityType || !entityId) return null
  try {
    const { data, error } = await supabase.from(VIEWS.approvalRequests)
      .select('id, entity_type, entity_id, status, proposal, current_stage, requested_by, requested_at')
      .eq('entity_type', entityType).eq('entity_id', entityId)
      .order('requested_at', { ascending: false }).order('id', { ascending: true }).limit(1)
    if (error) return null
    return data?.[0] || null
  } catch { return null }
}

// ── Valuation (v_inv_valuation, v_inv_cost_reconciliations) ──────────────────
//
// OWNER RULE: unknown cost is never zero and never invented. The view gives
// valued qty, unvalued qty, the valued amount per currency and a completeness
// flag; a partial value is never labelled a total.

export async function loadValuation({ country, site } = {}) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = supabase.from(VIEWS.valuation).select('*')
      q = applySite(applyCountry(q, country), site)
      return q.order('stock_id', { ascending: true }).range(from, to)
    // Sequential pages: each page of this view also counts open reconciliations per
    // balance, and pages fetched four at a time were what ran into the 8 s timeout.
    }, { max: 5000, concurrency: 1 })
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

/** inventory_cost_reconciliations.status (DB CHECK). */
export const COST_RECON_STATUSES = ['open', 'resolved', 'written_off', 'cancelled']

export function listCostReconciliations({ page, pageSize, status, country, site } = {}) {
  return pagedRead(VIEWS.costReconciliations, '*', {
    page, pageSize, order: 'created_at', ascending: true,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      return status && status !== 'all' ? q.eq('status', status) : q
    },
  })
}

/**
 * Post an APPROVED cost reconciliation. The cost and resolution come from the
 * approved request (the server consumes it); this call carries only the record,
 * a note and evidence. Unknown cost never becomes known any other way.
 */
export function reconcileCost({ reconciliationId, note, evidence }, key) {
  if (!reconciliationId) return Promise.reject(new ServiceError('Choose the reconciliation.', 'INV_NO_ENTITY'))
  const ev = Array.isArray(evidence) ? evidence : isBlank(evidence) ? undefined : [{ type: 'note', text: String(evidence).trim() }]
  return rpcWrite('inv_cost_reconcile', {
    reconciliation_id: reconciliationId, note: isBlank(note) ? null : String(note).trim(), evidence: ev,
  }, key)
}

// ── ERP reconciliation (read-only, v_inv_erp_reconciliation) ─────────────────

/** v_inv_erp_reconciliation.status values. */
export const ERP_RECON_STATUSES = ['matched', 'qty_diff', 'value_diff', 'inventory_only', 'erp_only', 'unvalued']
/** The view has no id: its key is (month, country, site, item_code, currency). */
const ERP_KEY = ['country', 'site', 'item_code', 'currency']

function erpFilters(q, { country, site, status, search, month }) {
  q = applySite(applyCountry(q, country), site)
  if (status === 'differences') q = q.neq('status', 'matched')
  else if (status && status !== 'all') q = q.eq('status', status)
  if (month) q = q.eq('month', month)
  const or = searchOr(['item_code'], search)
  return or ? q.or(or) : q
}

/**
 * The server function that returns ONE page and its total from a single pass over
 * the view (migration 20261124135000). Reading the view directly needs two passes
 * (the exact count and the page), and every pass aggregates every ERP line, which
 * is what ran into the 8 s timeout. Filters mean exactly what `erpFilters` means.
 */
const ERP_PAGE_RPC = 'inv_erp_reconciliation_page'
const ERP_RPC_MAX_LIMIT = 5000

function erpRpcArgs({ country, site, status, search, month, monthFrom } = {}) {
  const s = sanitizeSearchTerm(search)
  return {
    p_country: country && country !== 'All' ? country : null,
    p_site: site && site !== 'all' ? site : null,
    p_status: status && status !== 'all' ? status : null,
    p_month: month || null,
    p_month_from: monthFrom || null,
    p_item_like: s ? `%${escapeLike(s)}%` : null,
  }
}

/** One RPC page, or `null` when the function is not installed yet (use the view). */
async function erpRpcPage(filters, offset, limit) {
  const { data, error } = await supabase.rpc(ERP_PAGE_RPC, { ...erpRpcArgs(filters), p_offset: offset, p_limit: limit })
  if (error) {
    if (notProvisioned(error)) return null
    throw toServiceError(error)
  }
  return { rows: Array.isArray(data?.rows) ? data.rows : [], total: Number(data?.total) || 0 }
}

/**
 * Every matching row up to `max`, read in sequential pages of 5,000 through the
 * server function. `null` when the function is not installed (caller falls back).
 */
export async function loadErpReconciliationRpcRows(filters = {}, max = SNAPSHOT_MAX) {
  const rows = []
  let total = 0
  for (let offset = 0; offset < max; offset += ERP_RPC_MAX_LIMIT) {
    const limit = Math.min(ERP_RPC_MAX_LIMIT, max - offset)
    const page = await erpRpcPage(filters, offset, limit)
    if (!page) return null
    total = page.total
    rows.push(...page.rows)
    if (page.rows.length < limit || rows.length >= total) break
  }
  return { status: 'ok', rows, truncated: total > rows.length }
}

export async function listErpReconciliation({ page, pageSize, ...filters } = {}) {
  try {
    const p = clampPage(page)
    const size = clampSize(pageSize)
    const res = await erpRpcPage(filters, p * size, size)
    if (res) return { status: 'ok', rows: res.rows, total: res.total }
  } catch (err) {
    if (!notProvisioned(err)) throw toServiceError(err)
  }
  return pagedRead(VIEWS.erpReconciliation, '*', {
    page, pageSize, order: 'month', ascending: false, tiebreak: ERP_KEY, build: (q) => erpFilters(q, filters),
  })
}

/** Bounded full read for the ERP reconciliation export (same filters as the screen). */
export async function loadErpReconciliationRows(filters = {}) {
  try {
    const viaRpc = await loadErpReconciliationRpcRows(filters, SNAPSHOT_MAX)
    if (viaRpc) return viaRpc
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = erpFilters(supabase.from(VIEWS.erpReconciliation).select('*'), filters).order('month', { ascending: false })
      for (const col of ERP_KEY) q = q.order(col, { ascending: true })
      return q.range(from, to)
    }, { max: SNAPSHOT_MAX, concurrency: 1 })
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
  // The server answers the reservation row ({id, ...}) or {status:'refused_shortage'};
  // `reservation_id` is the name the issue form reads, so both are given.
  return rpcWrite('inv_reserve', {
    stock_id: stockId, qty: Number(qty), source_doc_type: sourceDocType || 'job_card', source_doc_id: sourceDocId || null,
  }, key).then((d) => (d && d.status !== 'refused_shortage' && d.id && !d.reservation_id ? { ...d, reservation_id: d.id } : d))
}

/** inv_issue: issue stock (optionally consuming a reservation). */
export function issueStock({ stockId, qty, reservationId, reason, referenceNo, sourceDocType, sourceDocId, sourceReceiptMovementId }, key) {
  if (!stockId || !qtyOk(qty)) return Promise.reject(new ServiceError('Choose a stock line and a quantity above zero.', 'INV_BAD_QTY'))
  return rpcWrite('inv_issue', {
    stock_id: stockId, qty: Number(qty), reservation_id: reservationId || null, reason: reason || null,
    reference_no: referenceNo || null, source_doc_type: sourceDocType || 'issue', source_doc_id: sourceDocId || null,
    // Specific identification for a serial / lot tracked item on a mixed balance
    // (known and unknown cost together): the receipt the units came from.
    source_receipt_movement_id: sourceReceiptMovementId || null,
  }, key)
}

const RECEIPT_SOURCE_COLS = 'movement_id, stock_id, item_id, item_code, movement_type, movement_seq, posted_at, reference_no, source_doc_type, source_doc_id, received_qty, remaining_qty, cost_known, unit_cost, currency, site, country'

/**
 * Receipts a serial / lot tracked issue or dispatch can name as its source
 * (v_inv_receipt_sources: live receipts of this balance with units left).
 * Bounded (100 rows, oldest first). `{ status, rows }`.
 */
export async function listReceiptSources(stockId) {
  if (!stockId) return { status: 'ok', rows: [] }
  try {
    const { data, error } = await supabase.from(VIEWS.receiptSources).select(RECEIPT_SOURCE_COLS)
      .eq('stock_id', stockId).gt('remaining_qty', 0)
      .order('movement_seq', { ascending: true }).order('movement_id', { ascending: true }).limit(100)
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

/** inv_transfer_dispatch: source stock moves to the in-transit location. */
export function dispatchTransfer({ fromLocationId, toLocationId, lines, remarks }, key) {
  if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
    return Promise.reject(new ServiceError('Choose two different locations.', 'INV_BAD_LOCATIONS'))
  }
  const clean = (lines || []).filter((l) => (l.stock_id || l.scanned_code) && qtyOk(l.qty))
  if (!clean.length) return Promise.reject(new ServiceError('Add at least one line with a quantity.', 'INV_NO_LINES'))
  return rpcWrite('inv_transfer_dispatch', {
    from_location_id: fromLocationId, to_location_id: toLocationId, remarks: remarks || null,
    lines: clean.map((l) => ({
      ...(l.stock_id ? { stock_id: l.stock_id } : { scanned_code: l.scanned_code }),
      qty: Number(l.qty),
      ...(l.source_receipt_movement_id ? { source_receipt_movement_id: l.source_receipt_movement_id } : {}),
    })),
  }, key)
}

/** inv_transfer_receive: received qty per line (a short receipt stays in transit). */
export function receiveTransfer({ transferId, lines }, key) {
  // Only lines with a quantity above zero are sent. The server refuses a zero on
  // any line, so sending a not-yet-arrived line at 0 used to fail the whole
  // receipt. A line left out simply stays in transit.
  const clean = receivableLines(lines)
  if (!transferId || !clean.length) return Promise.reject(new ServiceError('Enter the received quantity for at least one line.', 'INV_NO_LINES'))
  return rpcWrite('inv_transfer_receive', {
    transfer_id: transferId,
    lines: clean.map((l) => ({ line_id: l.line_id, received_qty: Number(l.received_qty), condition: l.condition || 'good', remarks: l.remarks || null })),
  }, key)
}

/**
 * inv_transfer_return_remaining: send what is still in transit back to the
 * source location (both legs posted: out of transit, into the source). With no
 * lines, every remaining quantity returns. A reason is required by the server.
 */
export function returnTransferRemaining({ transferId, reason, lines }, key) {
  if (!transferId) return Promise.reject(new ServiceError('Choose a transfer.', 'INV_NO_TRANSFER'))
  if (!String(reason || '').trim()) return Promise.reject(new ServiceError('Give a reason for returning the transfer.', 'INV_NO_REASON'))
  const picked = Array.isArray(lines) ? lines.filter((l) => l.line_id && qtyOk(l.qty)).map((l) => ({ line_id: l.line_id, qty: Number(l.qty) })) : []
  return rpcWrite('inv_transfer_return_remaining', {
    transfer_id: transferId, reason: String(reason).trim(), ...(picked.length ? { lines: picked } : {}),
  }, key)
}

/** inv_release: give back reserved stock (all of what is left when qty is blank). */
export function releaseReservation({ reservationId, qty }, key) {
  if (!reservationId) return Promise.reject(new ServiceError('There is no reservation to release.', 'INV_NO_RESERVATION'))
  if (qty !== '' && qty != null && !qtyOk(qty)) return Promise.reject(new ServiceError('Choose a quantity above zero.', 'INV_BAD_QTY'))
  return rpcWrite('inv_release', { reservation_id: reservationId, qty: qtyOk(qty) ? Number(qty) : null }, key)
}

/**
 * Return issued stock to the shelf (movement_type issue_return) through
 * inv_post_movement, linked to the job card it came back from.
 *
 * The job card is REQUIRED: the server (WP5, migration 20261124091000) bounds a
 * return by what that job card took from this stock line, minus what already
 * came back, and values it at the cost it was issued at. A return never takes a
 * unit cost from the client and never takes the current average: when the issue
 * was not fully valued the units come back unvalued and open a cost
 * reconciliation. No unit_cost is sent.
 */
export function returnIssuedStock({ stockId, qty, reason, sourceDocType, sourceDocId, referenceNo }, key) {
  if (!stockId || !qtyOk(qty)) return Promise.reject(new ServiceError('Choose a stock line and a quantity above zero.', 'INV_BAD_QTY'))
  if (!String(reason || '').trim()) return Promise.reject(new ServiceError('Give a reason for the return.', 'INV_NO_REASON'))
  if (!String(sourceDocId || '').trim()) {
    return Promise.reject(new ServiceError('Name the job card the material was issued against.', 'INV_NO_SOURCE_DOC'))
  }
  return rpcWrite('inv_post_movement', {
    stock_id: stockId, movement_type: 'issue_return', qty_change: Number(qty), reason: String(reason).trim(),
    reference_no: referenceNo || null, source_doc_type: sourceDocType || 'job_card', source_doc_id: String(sourceDocId).trim(),
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
    const { data, error } = await q.order('country', { ascending: true }).order('site', { ascending: true })
      .order('currency', { ascending: true }).limit(500)
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

/** One investigation case by conflict id (null when not visible / not found). */
export async function getConflictCase(conflictId) {
  if (!conflictId) return null
  const { data, error } = await supabase.from('v_inv_tyre_conflict_cases')
    .select('id, serial, country, conflict_type, status, investigation_status, detected_at, evidence, investigator_id, assigned_at, investigation_notes, proposed_correction, proposed_at, approval_request_id, approval_status, decided_correction, closed_at, i_am_investigator')
    .eq('id', conflictId).maybeSingle()
  if (error) throw toServiceError(error)
  return data || null
}

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
 * WRITE CONTRACT ASSUMPTION (to be confirmed by the DB lane): every inv_* write
 * RPC takes ONE jsonb argument `p_payload`, and the payload carries a mandatory
 * `idempotency_key`. Reads that take an id use `p_audit_id`.
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
    q = q.order(order, { ascending }).order('id', { ascending: true }).range(from, from + size - 1)
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

async function rpcWrite(fn, payload, idempotencyKey) {
  if (!idempotencyKey) throw new ServiceError('A request reference is missing. Please try again.', 'INV_NO_IDEMPOTENCY')
  const { data, error } = await supabase.rpc(fn, { p_payload: { ...payload, idempotency_key: idempotencyKey } })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
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

const BALANCE_COLS = 'id, item_id, item_code, description, site, country, location_id, location_code, condition, ownership, owner_supplier_id, qty_on_hand, qty_reserved, avg_unit_cost, currency, reorder_point, min_qty, max_qty, uom, version, updated_at'

export function listBalances({ page, pageSize, country, site, search, ownership, condition } = {}) {
  return pagedRead('stock_records', BALANCE_COLS, {
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
      let q = supabase.from('stock_records').select(BALANCE_COLS)
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

const MOVEMENT_COLS = 'id, movement_seq, movement_type, item_id, item_code, site, country, location_id, location_code, qty_before, qty_change, qty_after, unit_cost, value_change, currency, ownership, source_doc_type, source_doc_id, reverses_movement_id, reason, reference_no, actor_id, created_by, approval_ref, posted_at, effective_at, created_at'

export function listMovements({ page, pageSize, country, site, type, from, to, search } = {}) {
  return pagedRead('stock_movements', MOVEMENT_COLS, {
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
      read('inventory_audit_snapshot_lines', 'id, audit_id, location_id, location_code, item_id, item_code, description, serial_no, expected_qty, expected_cost, currency'),
      read('inventory_count_lines', 'id, audit_id, location_id, location_code, item_id, item_code, description, serial_no, counted_qty, confirmed_zero, condition, remarks, counter_id, counted_at, round, unexpected'),
    ])
    return { status: 'ok', snapshot: snap.rows, counts: counts.rows, truncated: snap.truncated || counts.truncated }
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

const DISCREPANCY_COLS = 'id, audit_id, audit_ref, item_id, item_code, description, location_id, location_code, serial_no, category, expected_qty, counted_qty, variance_qty, value_impact, currency, investigator_id, investigation_notes, evidence, proposed_qty, proposed_action, status, approved_by, approved_at, created_at'

export function listDiscrepancies({ page, pageSize, country, site, status, auditId, search } = {}) {
  return pagedRead('inventory_discrepancies', DISCREPANCY_COLS, {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => {
      q = applySite(applyCountry(q, country), site)
      if (status === 'open') q = q.not('status', 'in', '(closed,posted,rejected)')
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

export function listAdjustments({ page, pageSize, status, auditId } = {}) {
  return pagedRead('inventory_adjustments', ADJUSTMENT_COLS, {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => {
      if (status && status !== 'all') q = q.eq('status', status)
      if (auditId) q = q.eq('audit_id', auditId)
      return q
    },
  })
}

/** decision: approve | reject | recount | hold (the four approval actions). */
export const decideAdjustment = ({ adjustmentId, discrepancyId, decision, note }, key) => rpcWrite('inv_adjustment_approve', {
  adjustment_id: adjustmentId || null, discrepancy_id: discrepancyId || null, decision, note: note || null,
}, key)

// ── Opening balances ─────────────────────────────────────────────────────────

const OB_COLS = 'id, ref, source, source_filename, site, country, status, line_count, missing_cost_count, created_by, submitted_by, approved_by, approved_at, created_at'

export function listOpeningBatches({ page, pageSize, country } = {}) {
  return pagedRead('opening_balance_batches', OB_COLS, {
    page, pageSize, order: 'created_at', ascending: false, build: (q) => applyCountry(q, country),
  })
}

export function listOpeningLines(batchId, { page, pageSize } = {}) {
  return pagedRead('opening_balance_lines', 'id, batch_id, line_no, item_code, description, location_code, site, qty, uom, unit_cost, currency, condition, serial_no, mapping_status, missing_cost, issues', {
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

export function listMasterReviews({ page, pageSize, status } = {}) {
  return pagedRead('material_master_reviews', 'id, item_id, item_code, proposed_change, reason, status, requested_by, reviewer_id, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => (status && status !== 'all' ? q.eq('status', status) : q),
  })
}

// ── Tyre inventory ───────────────────────────────────────────────────────────

const TYRE_COLS = 'id, serial_no, custody_state, site, country, location_id, location_code, asset_no, position, purchase_cost, currency, brand, size, updated_at'

export function listTyreItems({ page, pageSize, country, site, state, search } = {}) {
  return pagedRead('tyre_items', TYRE_COLS, {
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
  const entries = await Promise.all(CUSTODY_STATES.map(async (s) => [s, await headCount('tyre_items',
    (q) => applySite(applyCountry(q, country), site).eq('custody_state', s))]))
  return Object.fromEntries(entries)
}

export function listCustodyConflicts({ page, pageSize, status } = {}) {
  return pagedRead('tyre_custody_conflicts', 'id, tyre_item_id, serial_no, conflict_type, status, evidence, detected_at, resolved_by, resolved_at, resolution_note, created_at', {
    page, pageSize, order: 'detected_at', ascending: false,
    build: (q) => (status === 'open' ? q.in('status', ['open', 'investigating']) : status && status !== 'all' ? q.eq('status', status) : q),
  })
}

// ── Supply side ──────────────────────────────────────────────────────────────

export function listSupplierAgreements({ page, pageSize, type } = {}) {
  return pagedRead('supplier_agreements', 'id, supplier_id, supplier_name, agreement_type, min_qty, max_qty, lead_time_days, credit_terms, return_terms, expires_at, status, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => (type && type !== 'all' ? q.eq('agreement_type', type) : q),
  })
}

export function listPoLines({ page, pageSize, search } = {}) {
  return pagedRead('purchase_order_lines', 'id, purchase_order_id, po_number, item_code, description, ordered_qty, received_qty, unit_price, currency, status, created_at', {
    page, pageSize, order: 'created_at', ascending: false,
    build: (q) => { const or = searchOr(['po_number', 'item_code', 'description'], search); return or ? q.or(or) : q },
  })
}

export function listGrnLines({ page, pageSize, search } = {}) {
  return pagedRead('goods_receipt_lines', 'id, goods_receipt_id, grn_number, po_number, item_code, description, received_qty, accepted_qty, rejected_qty, unit_cost, currency, created_at', {
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
    headCount('inventory_discrepancies', (q) => scoped(q).not('status', 'in', '(closed,posted,rejected)')),
    headCount('inventory_adjustments', (q) => q.eq('status', 'pending')),
    headCount('tyre_custody_conflicts', (q) => q.in('status', ['open', 'investigating'])),
    headCount('opening_balance_batches', (q) => q.eq('status', 'submitted')),
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
    balances: ['stock_records', BALANCE_COLS, null],
    movements: ['stock_movements', MOVEMENT_COLS, 'posted_at'],
    audits: ['inventory_audits', AUDIT_COLS, 'created_at'],
    discrepancies: ['inventory_discrepancies', DISCREPANCY_COLS, 'created_at'],
    tyreItems: ['tyre_items', TYRE_COLS, null],
    conflicts: ['tyre_custody_conflicts', 'id, serial_no, conflict_type, status, evidence, detected_at', 'detected_at'],
  }[source]
  if (!spec) throw new ServiceError('Unknown report.', 'INV_UNKNOWN_REPORT')
  const [table, cols, dateCol] = spec
  const scoped = !['conflicts'].includes(source)
  try {
    const { data, error, truncated } = await fetchAllPages((a, b) => {
      let q = supabase.from(table).select(cols)
      if (scoped) q = applySite(applyCountry(q, country), site)
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

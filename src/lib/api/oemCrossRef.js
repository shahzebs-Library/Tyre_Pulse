/**
 * OEM cross-reference review (service layer).
 *
 * Reads: OEM manual rows, catalogue OEM aliases, variant part numbers, the
 * catalogue itself and existing oem_part_references, every one paged with an
 * `id` tiebreak and a ceiling (PostgREST caps a response at 1,000 rows). The
 * ERP items a proposal can link to are read only for the company SKUs that
 * actually matched.
 *
 * Writes go ONLY through the governed RPCs, as the signed-in user:
 *  - inv_compat_propose (kind 'oem') stores a link with status 'proposed';
 *  - inv_compat_decide approves or rejects it. The database refuses the proposer
 *    deciding their own record, requires a note to reject, and requires the
 *    stock:engineering_approve permission (or super admin) to decide.
 * oem_part_references has no client INSERT/UPDATE policy, so there is no direct
 * table write here.
 */
import { supabase, ServiceError, toServiceError, isNotProvisioned, isMissingColumn, fetchAllPages } from './_client'
import { NOT_SET_UP_CODE, NOT_SET_UP_MESSAGE, inventoryRefusalText, newIdempotencyKey } from './inventory'
import { proposeCrossReferences, buildProposePayload } from '../inventory/oemCrossRef'

export const READ_MAX = 20000
const ERP_CHUNK = 200

const ENTRY_COLS = 'id,country,manual_id,part_no,description,assembly_heading,source_pdf_page,row_type,manual:oem_parts_manuals(manufacturer,model)'
const ALIAS_COLS = 'id,canonical_id,alias_type,value,source,verified'
const VARIANT_COLS = 'id,canonical_id,part_number,brand,manufacturer,part_classification'
const CANON_COLS = 'id,company_sku,description,brand,category,status,original_description:specs->>original_description'
const ERP_COLS = 'id,item_code,item_name,country,category'
const REF_COLS = 'id,country,oem_part_no,item_id,oem_entry_id,status,source,proposed_by,proposed_at,approved_by,approved_at,decision_note'

const notProvisioned = (err) => isNotProvisioned(err) || isMissingColumn(err)

async function readAll(table, cols, build, label) {
  const { data, error, truncated } = await fetchAllPages(
    (from, to) => {
      let q = supabase.from(table).select(cols)
      if (build) q = build(q)
      return q.order('id', { ascending: true }).range(from, to)
    },
    { max: READ_MAX },
  )
  if (error) {
    if (notProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    throw toServiceError(error, `Could not read ${label}.`)
  }
  return { rows: data || [], truncated: !!truncated }
}

/** ERP items for the matched company SKUs only, read in bounded chunks. */
async function readErpItems(skus) {
  const list = [...new Set((skus || []).filter(Boolean))]
  const rows = []
  let truncated = false
  for (let i = 0; i < list.length; i += ERP_CHUNK) {
    const chunk = list.slice(i, i + ERP_CHUNK)
    const res = await readAll('material_master', ERP_COLS, (q) => q.in('item_code', chunk), 'ERP items')
    rows.push(...res.rows)
    truncated = truncated || res.truncated
  }
  return { rows, truncated }
}

/**
 * Load everything the review needs and build the proposals.
 * @returns {Promise<{ status:'ok', proposals:object[], truncated:string[], counts:object }>}
 */
export async function loadOemCrossRef({ country } = {}) {
  const byCountry = (q) => (country && country !== 'All' ? q.eq('country', country) : q)
  const [entries, aliases, variants, canonicals, references] = await Promise.all([
    readAll('oem_parts_entries', ENTRY_COLS, byCountry, 'OEM manual rows'),
    readAll('material_aliases', ALIAS_COLS, (q) => q.eq('alias_type', 'oem').not('canonical_id', 'is', null), 'OEM aliases'),
    readAll('material_variants', VARIANT_COLS, (q) => q.not('part_number', 'is', null), 'variant part numbers'),
    readAll('material_canonical', CANON_COLS, (q) => q.eq('status', 'active'), 'the company catalogue'),
    readAll('oem_part_references', REF_COLS, byCountry, 'existing OEM links'),
  ])
  // First pass without ERP items finds which company SKUs matched at all.
  const draft = proposeCrossReferences({ entries: entries.rows, aliases: aliases.rows, variants: variants.rows, canonicals: canonicals.rows })
  const skus = draft.flatMap((p) => p.candidates.map((c) => c.canonical.company_sku))
  const erp = await readErpItems(skus)
  const proposals = proposeCrossReferences({
    entries: entries.rows, aliases: aliases.rows, variants: variants.rows, canonicals: canonicals.rows,
    erpItems: erp.rows, references: references.rows,
  })
  const truncated = Object.entries({ entries, aliases, variants, canonicals, references, erp })
    .filter(([, r]) => r.truncated).map(([k]) => k)
  return {
    status: 'ok',
    proposals,
    truncated,
    counts: { entries: entries.rows.length, aliases: aliases.rows.length, variants: variants.rows.length, canonicals: canonicals.rows.length, references: references.rows.length },
  }
}

async function rpcWrite(fn, payload, idempotencyKey) {
  const key = idempotencyKey || newIdempotencyKey()
  const { data, error } = await supabase.rpc(fn, { p_payload: { ...payload, idempotency_key: key } })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    const refusal = inventoryRefusalText(error)
    if (refusal) throw new ServiceError(refusal, 'INV_REFUSED', error)
    throw toServiceError(error)
  }
  return data
}

/** Submit a proposal as a stored link with status 'proposed'. A second person approves it. */
export function submitOemLink(proposal, candidate, idempotencyKey) {
  return rpcWrite('inv_compat_propose', buildProposePayload(proposal, candidate), idempotencyKey)
}

/** Approve or reject a stored link. Rejecting needs a note; the proposer cannot decide their own. */
export function decideOemLink({ id, decision, note }, idempotencyKey) {
  if (!id) throw new ServiceError('Choose a stored link first.', 'INV_INVALID')
  if (decision !== 'approve' && decision !== 'reject') throw new ServiceError('Decision must be approve or reject.', 'INV_INVALID')
  const text = String(note || '').trim()
  if (decision === 'reject' && !text) throw new ServiceError('Give a reason for rejecting this link.', 'INV_INVALID')
  return rpcWrite('inv_compat_decide', { kind: 'oem', id, decision, note: text || null }, idempotencyKey)
}

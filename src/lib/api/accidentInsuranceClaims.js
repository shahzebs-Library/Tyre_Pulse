/**
 * Supabase boundary for the "Register insurance claim" screen - insurance
 * claims, the claim document checklist, and recovery records. Every WRITE here
 * goes through the accident-module RPCs (verified live: accident_claim_register/
 * _decision/_settlement, accident_document_add/_mark_received,
 * accident_recovery_record), never a direct table write - each RPC does real
 * validation (money >= 0, decision-token CHECK, approved-amount-required-for-
 * approval) plus a side effect a plain insert would miss: accident_claim_register
 * also moves the `insurance` workstream to in_progress and posts claim_amount
 * onto the accidents row in the SAME transaction.
 *
 * Every RPC returns a jsonb envelope, e.g. `{ok:true, claim:{...}}` - unwrapRpc()
 * below is the ONE place that unpacks it, so a caller never has to remember the
 * envelope shape per RPC.
 *
 * SHIP-BEFORE-MIGRATE, same as accidentCase.js: reads degrade to an honest
 * empty/null state via isMissingRelation.
 */
import { supabase, unwrap, isMissingRelation } from './_client'
// Sibling readers the M4 tab context composes (loadClaimTabContext, bottom).
import { listEvidence } from './accidentEvidence'
import { getLiabilityAssessment } from './accidentLiability'
import { getOpenRepairOrder } from './accidentRepairOrders'
import { getDamageAssessment } from './accidentDamageAssessment'
import { listWorkstreams } from './accidentCase'
import { listCommunications } from './accidentCommunications'
import { listProfiles } from './users'

const CLAIM_COLS =
  'id,accident_id,country,site,insurance_applicable,policy_id,policy_no,insurer,broker,' +
  'coverage_type,policy_valid_on_date,claim_no,claim_registered_date,deductible,' +
  'coverage_excess,decision,approved_amount,rejected_amount,exclusions,rejection_reason,' +
  'insurer_repair_route,surveyor_name,surveyor_appointed_at,surveyor_inspected_at,' +
  'acknowledgement_ref,created_by,created_at,updated_at'

const DOCUMENT_COLS =
  'id,accident_id,claim_id,country,site,doc_type,doc_name,storage_ref,required,' +
  'received,received_at,notes,created_by,created_at,updated_at'

const RECOVERY_COLS =
  'id,accident_id,country,site,source,amount,expected_amount,currency,status,' +
  'recovered_at,reference,remarks,created_by,created_at,updated_at'

/** Claim decision tokens the "Register" step's decision control offers
 *  (accident_insurance_decisions CHECK, verified live). */
export const CLAIM_DECISIONS = [
  'fully_approved', 'partially_approved', 'rejected', 'withdrawn',
  'documents_requested', 'survey_ordered', 'acknowledged', 'settled', 'disputed',
]

/** Recovery source/status tokens (accident_recovery_record CHECK, verified live). */
export const RECOVERY_SOURCES = ['insurer', 'third_party', 'driver', 'other']
export const RECOVERY_STATUSES = ['pending', 'in_progress', 'partial', 'recovered', 'written_off', 'not_applicable']

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** Unpack an RPC's `{ok, ...}` jsonb envelope, returning the named payload key. */
function unwrapRpc(result, key) {
  const envelope = unwrap(result)
  if (!envelope?.ok) throw new Error('The request could not be completed.')
  return key ? envelope[key] : envelope
}

// ── reads ───────────────────────────────────────────────────────────────────

/** The current (latest) insurance claim for a case, or null if none registered. */
export async function getInsuranceClaim(accidentId) {
  if (!accidentId) return null
  return readOrEmpty(
    async () =>
      unwrap(
        await supabase
          .from('accident_insurance_claims')
          .select(CLAIM_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    null,
  )
}

/** The claim document checklist for a case (police/Najm/policy/etc). */
export async function listClaimDocuments(accidentId) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_claim_documents')
          .select(DOCUMENT_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: true }),
      ) || []
    )
  }, [])
}

/** Recovery records (from insurer/third party/driver/other) for a case. */
export async function listRecoveries(accidentId) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_claim_recoveries')
          .select(RECOVERY_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false }),
      ) || []
    )
  }, [])
}

// ── writes (all via RPC) ────────────────────────────────────────────────────

/**
 * Register (or, if one already exists on this case, update) the insurance
 * claim. Server side-effects: posts `claim_amount` onto the accidents row and
 * advances the `insurance` workstream to in_progress.
 */
export async function registerClaim(accidentId, { insurer, policyNo, claimNo, claimAmount, deductible } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  return unwrapRpc(
    await supabase.rpc('accident_claim_register', {
      p_accident_id: accidentId,
      p_insurer: insurer ?? null,
      p_policy_no: policyNo ?? null,
      p_claim_no: claimNo ?? null,
      p_claim_amount: claimAmount ?? null,
      p_deductible: deductible ?? null,
    }),
    'claim',
  )
}

/**
 * Record a decision on a registered claim. `decision` must be one of
 * CLAIM_DECISIONS; `approvedAmount` is required for fully_approved /
 * partially_approved (the server enforces this too).
 */
export async function decideClaim(claimId, { decision, approvedAmount, reason } = {}) {
  if (!claimId) throw new Error('A claim is required.')
  if (!CLAIM_DECISIONS.includes(decision)) throw new Error(`Invalid claim decision "${decision}".`)
  if (['fully_approved', 'partially_approved'].includes(decision) && approvedAmount == null) {
    throw new Error('An approved amount is required for this decision.')
  }
  return unwrapRpc(
    await supabase.rpc('accident_claim_decision', {
      p_claim_id: claimId,
      p_decision: decision,
      p_approved_amount: approvedAmount ?? null,
      p_reason: reason ?? null,
    }),
  )
}

/** Record a settlement payment against a claim (moves the claim to 'settled'). */
export async function settleClaim(claimId, { settledAmount, settledAt, reference } = {}) {
  if (!claimId) throw new Error('A claim is required.')
  if (settledAmount == null) throw new Error('A settlement amount is required.')
  if (!settledAt) throw new Error('A settlement date is required.')
  return unwrapRpc(
    await supabase.rpc('accident_claim_settlement', {
      p_claim_id: claimId,
      p_settled_amount: settledAmount,
      p_settled_at: settledAt,
      p_reference: reference ?? null,
    }),
  )
}

/** Record a recovery (insurer/third party/driver/other). A "recovered" status
 *  requires `recoveredAt` (the server enforces this too - it is the evidence). */
export async function recordRecovery(accidentId, { source, amount, status, recoveredAt } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!RECOVERY_SOURCES.includes(source)) throw new Error(`Invalid recovery source "${source}".`)
  if (!RECOVERY_STATUSES.includes(status)) throw new Error(`Invalid recovery status "${status}".`)
  if (status === 'recovered' && !recoveredAt) {
    throw new Error('A recovered date is required to mark a recovery as recovered.')
  }
  return unwrapRpc(
    await supabase.rpc('accident_recovery_record', {
      p_accident_id: accidentId,
      p_source: source,
      p_amount: amount ?? null,
      p_status: status,
      p_recovered_at: recoveredAt ?? null,
    }),
    'recovery',
  )
}

/** Add one claim-document checklist row (a required doc with no file yet reads
 *  as outstanding; supplying storageRef marks it received in the same call). */
export async function addClaimDocument(accidentId, { docType, storageRef, referenceNo } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!docType) throw new Error('A document type is required.')
  return unwrapRpc(
    await supabase.rpc('accident_document_add', {
      p_accident_id: accidentId,
      p_doc_type: docType,
      p_storage_ref: storageRef ?? null,
      p_reference_no: referenceNo ?? null,
    }),
    'document',
  )
}

/** Mark an existing claim-document row received (attaching a file, if given). */
export async function markClaimDocumentReceived(accidentId, documentId, storageRef) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!documentId) throw new Error('A document is required.')
  return unwrapRpc(
    await supabase.rpc('accident_document_mark_received', {
      p_accident_id: accidentId,
      p_document_id: documentId,
      p_storage_ref: storageRef ?? null,
    }),
    'document',
  )
}

// ── M4 tab context (additive) ───────────────────────────────────────────────

/** Read one settled promise, degrading a failure to the given empty value. */
const settled = (r, empty) => (r.status === 'fulfilled' ? (r.value ?? empty) : empty)

/**
 * Everything the "Register insurance claim" tab reads, in ONE round of
 * parallel best-effort reads. The claim itself is authoritative (its failure
 * is reported); every sibling (evidence package, liability, repair route,
 * workstream owners, prior document requests, profiles) degrades to an honest
 * empty value so one unprovisioned table cannot blank the tab.
 */
export async function loadClaimTabContext(accidentId, { country } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  const [claim, docs, recoveries, evidence, liability, repairOrder, assessment, workstreams, comms, profiles] =
    await Promise.allSettled([
      getInsuranceClaim(accidentId),
      listClaimDocuments(accidentId),
      listRecoveries(accidentId),
      listEvidence(accidentId),
      getLiabilityAssessment(accidentId),
      getOpenRepairOrder(accidentId),
      getDamageAssessment(accidentId),
      listWorkstreams(accidentId, { country }),
      listCommunications(accidentId, { limit: 100 }),
      listProfiles(),
    ])
  if (claim.status === 'rejected') throw claim.reason
  return {
    claim: claim.value || null,
    docs: settled(docs, []),
    recoveries: settled(recoveries, []),
    evidence: settled(evidence, []),
    liability: settled(liability, null),
    repairOrder: settled(repairOrder, null),
    assessment: settled(assessment, null),
    workstreams: settled(workstreams, []),
    communications: settled(comms, []),
    profiles: settled(profiles, []),
  }
}

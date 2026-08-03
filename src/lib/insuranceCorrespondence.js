/**
 * insuranceCorrespondence.js - PURE document/email generator for the Insurance
 * Policy knowledge base (no I/O, no React, no Supabase).
 *
 * Given a claim SCENARIO (the same policy + conditions + case facts fed to
 * assessClaim) it produces ready-to-use correspondence and documents:
 *   - insurer claim-submission email
 *   - repair-estimate approval-request email (prevents the "repaired before
 *     approval" rejection)
 *   - rejection notice that CITES the exact policy clauses behind each reason
 *   - delay / pending-items notice
 *   - status follow-up email to the insurer
 *   - required-documents checklist (adapts to the case facts)
 *   - constructive total-loss advice letter (when repair/insured values allow)
 *
 * Everything is ASCII only and honest about missing data (renders "N/A" or a
 * neutral placeholder, never a fabricated figure). Nothing here sends an email;
 * the caller copies, downloads or opens a mailto link. Each document is a plain
 * data structure so the page can preview it, and `documentToText(doc)` renders
 * the exact copy/download body.
 */

import { totalLossAssessment, CONDITION_CATEGORY_LABELS, num } from './insuranceKnowledge'

// ── formatting helpers (ASCII, honest N/A) ────────────────────────────────────
const PLACEHOLDER = '[to be completed]'

function txt(v) {
  const s = v == null ? '' : String(v).trim()
  return s || ''
}
function orPlaceholder(v) {
  return txt(v) || PLACEHOLDER
}
function orNA(v) {
  return txt(v) || 'N/A'
}

/** Group thousands with commas, ASCII only. Returns 'N/A' for missing. */
function money(v, ccy) {
  const n = num(v)
  if (n == null) return 'N/A'
  const s = Math.round(n * 100) / 100
  const [whole, frac] = String(s).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = frac ? `${grouped}.${frac}` : grouped
  return `${txt(ccy) || 'SAR'} ${body}`
}

function dateLabel(v) {
  const s = txt(v)
  if (!s) return 'N/A'
  // Keep an ISO date as-is (YYYY-MM-DD); pass any other value through.
  return s.slice(0, 10)
}

// ── document type catalog (single source for the UI) ──────────────────────────
export const CORRESPONDENCE_TYPES = [
  { key: 'approval_request', title: 'Repair approval request', kind: 'email', description: 'Ask the insurer to approve the repair estimate before any work starts.' },
  { key: 'claim_submission', title: 'Claim submission', kind: 'email', description: 'Formal claim notice to the insurer with the incident and policy details.' },
  { key: 'document_checklist', title: 'Required documents checklist', kind: 'checklist', description: 'The supporting documents the insurer needs, adapted to the case.' },
  { key: 'delay_notice', title: 'Delay / pending-items notice', kind: 'letter', description: 'Explains what the settlement is waiting on and why.' },
  { key: 'followup', title: 'Status follow-up', kind: 'email', description: 'Chase the insurer for a claim status update.' },
  { key: 'rejection_notice', title: 'Rejection notice', kind: 'letter', description: 'States the rejection reasons and cites the exact policy clause for each.' },
  { key: 'reconsideration', title: 'Reconsideration request', kind: 'email', description: 'Reply to the insurer citing the clause under which the claim should be approved.' },
  { key: 'total_loss_advice', title: 'Total-loss advice', kind: 'letter', description: 'Constructive total-loss position from repair cost vs insured value.' },
]

const KIND_LABEL = { email: 'Email', letter: 'Letter', checklist: 'Checklist' }
export function documentKindLabel(kind) {
  return KIND_LABEL[kind] || 'Document'
}

// ── shared context ────────────────────────────────────────────────────────────
function baseContext(policy = {}, caseInfo = {}) {
  const ccy = txt(caseInfo.currency) || txt(policy.currency) || 'SAR'
  return {
    ccy,
    reference: orPlaceholder(caseInfo.reference),
    insurer: orNA(policy.insurer),
    insured: orNA(policy.insured_name || caseInfo.insuredName),
    policyNo: orNA(policy.policy_no),
    sender: orPlaceholder(caseInfo.senderName),
    senderRole: txt(caseInfo.senderRole) || 'Fleet Insurance Desk',
    company: txt(caseInfo.company) || txt(policy.insured_name) || 'the fleet operator',
    insurerContact: txt(caseInfo.insurerContact) || 'Claims Department',
    incidentDate: dateLabel(caseInfo.incidentDate),
    location: orNA(caseInfo.location),
    assetNo: orNA(caseInfo.assetNo),
    plateNo: orNA(caseInfo.plateNo),
    vehicleDesc: orNA(caseInfo.vehicleDesc),
    driverName: orNA(caseInfo.driverName),
    claimAmount: caseInfo.claimAmount,
    workshop: orNA(caseInfo.workshop),
  }
}

function signOff(c) {
  return ['Regards,', c.sender, c.senderRole, c.company]
}

function incidentBlock(c) {
  return [
    `Policy number: ${c.policyNo}`,
    `Insured: ${c.insured}`,
    `Claim reference: ${c.reference}`,
    `Asset / plate: ${c.assetNo} / ${c.plateNo}`,
    `Vehicle: ${c.vehicleDesc}`,
    `Driver: ${c.driverName}`,
    `Date of incident: ${c.incidentDate}`,
    `Location: ${c.location}`,
  ]
}

// ── individual builders ───────────────────────────────────────────────────────
function buildApprovalRequest(c) {
  return {
    to: c.insurerContact,
    subject: `Repair estimate approval request - claim ${c.reference} (policy ${c.policyNo})`,
    sections: [
      { body: [`Dear ${c.insurerContact},`] },
      { body: [
        `We are filing a claim under policy ${c.policyNo} (${c.insured}) and request your approval of the repair estimate BEFORE any repair work begins, as required by the policy.`,
      ] },
      { heading: 'Incident and vehicle', body: incidentBlock(c) },
      { heading: 'Repair', body: [
        `Assessing workshop: ${c.workshop}`,
        `Estimated repair cost: ${money(c.claimAmount, c.ccy)}`,
        'The estimate and supporting photographs are attached for your assessment.',
      ] },
      { body: ['Kindly confirm approval, appoint a surveyor, or advise the next step so we can proceed without prejudicing the claim.'] },
      { body: signOff(c) },
    ],
  }
}

function buildClaimSubmission(c) {
  return {
    to: c.insurerContact,
    subject: `Motor claim notification - ${c.assetNo} / ${c.plateNo} - claim ${c.reference}`,
    sections: [
      { body: [`Dear ${c.insurerContact},`] },
      { body: [`We wish to notify a claim under policy ${c.policyNo} (${c.insured}) for the incident detailed below.`] },
      { heading: 'Incident and vehicle', body: incidentBlock(c) },
      { heading: 'Claim', body: [
        `Estimated / claimed amount: ${money(c.claimAmount, c.ccy)}`,
        `Assessing workshop: ${c.workshop}`,
      ] },
      { body: ['The supporting documents are attached. Please register the claim, confirm the reference and advise the required next steps.'] },
      { body: signOff(c) },
    ],
  }
}

function buildDocumentChecklist(c, ctx = {}) {
  const items = [
    'Completed and signed claim form',
    'Copy of the insurance policy schedule',
    'Vehicle registration (istimara) copy',
    'Driver national ID / iqama copy',
    'Valid driving licence copy',
    'Photographs of the damage',
    'Repair estimate from an approved workshop',
  ]
  if (ctx.reportedToPolice !== false) items.push('Police / traffic accident report')
  if (num(ctx.thirdPartyFaultPct) != null) items.push('NAJM fault-determination report')
  if (ctx.stolen === true) {
    items.push('Police theft report (FIR)')
    items.push('Original vehicle keys (all sets)')
    items.push('Signed statement of loss')
  }
  if (ctx.outsideKsa === true) items.push('Proof of the vehicle route / border crossing and travel authorization')
  if (ctx.vehicleCommercial === true) items.push('Operating card / commercial vehicle permit')
  items.push('Bank details for settlement transfer')

  return {
    to: c.insurerContact,
    subject: `Supporting documents - claim ${c.reference}`,
    sections: [
      { body: [`Claim reference: ${c.reference}`, `Policy: ${c.policyNo}`, `Asset / plate: ${c.assetNo} / ${c.plateNo}`] },
      { heading: 'Documents required for this claim', checklist: items },
      { body: ['Please tick each item as it is gathered and attach the complete set to the claim submission.'] },
    ],
  }
}

function buildDelayNotice(c, findings) {
  const delayItems = findings.filter((f) => f.severity === 'delay' || f.severity === 'info')
  const pending = delayItems.length
    ? delayItems.map((f) => `${f.title}: ${f.reason} (policy ${f.policyNo || c.policyNo}${f.conditionSeq != null ? `, clause ${f.conditionSeq}` : ''}).`)
    : ['The settlement is pending completion of the insurer assessment and any outstanding supporting documents.']
  return {
    to: c.insurerContact,
    subject: `Claim ${c.reference} - pending items and expected timeline`,
    sections: [
      { body: [`Dear ${c.insurerContact},`] },
      { body: [`This concerns claim ${c.reference} under policy ${c.policyNo} (${c.insured}). The claim is progressing but is currently held pending the items below.`] },
      { heading: 'Pending items', checklist: pending },
      { body: ['We would be grateful for confirmation of the outstanding requirements and an expected settlement date.'] },
      { body: signOff(c) },
    ],
  }
}

function buildFollowup(c) {
  return {
    to: c.insurerContact,
    subject: `Status follow-up - claim ${c.reference} (policy ${c.policyNo})`,
    sections: [
      { body: [`Dear ${c.insurerContact},`] },
      { body: [
        `We are following up on claim ${c.reference} under policy ${c.policyNo} (${c.insured}) for asset ${c.assetNo} / ${c.plateNo}, incident dated ${c.incidentDate}.`,
        'All requested documents have been submitted. Please advise the current status, any outstanding requirement, and the expected settlement date.',
      ] },
      { body: signOff(c) },
    ],
  }
}

function buildRejectionNotice(c, findings) {
  const rejects = findings.filter((f) => f.severity === 'reject')
  const reasons = rejects.length
    ? rejects.map((f, i) => `${i + 1}. ${f.title}. ${f.reason} Basis: policy ${f.policyNo || c.policyNo}${f.conditionSeq != null ? `, clause ${f.conditionSeq}` : ''} (${CONDITION_CATEGORY_LABELS[f.category] || f.category})${f.clauseText ? ` - "${f.clauseText}"` : ''}.`)
    : ['No policy-based rejection reason was identified for the facts provided; complete the scenario checker before issuing a rejection notice.']
  return {
    to: orPlaceholder(c.driverName === 'N/A' ? c.insured : c.driverName),
    subject: `Claim ${c.reference} - outcome and policy basis`,
    sections: [
      { body: [`Reference: claim ${c.reference}, policy ${c.policyNo} (${c.insured}).`] },
      { body: ['Following assessment of the incident below, the claim cannot be admitted for the reason(s) set out. Each reason cites the governing policy condition.'] },
      { heading: 'Incident', body: incidentBlock(c) },
      { heading: 'Reasons and policy basis', checklist: reasons },
      { body: ['If you have information that addresses any of the above, please submit it within the policy notification period and we will reassess.'] },
      { body: signOff(c) },
    ],
  }
}

function buildReconsideration(c, analysis) {
  const a = analysis || null
  const insurerReason = a && a.reasonSummary ? a.reasonSummary : PLACEHOLDER
  const approvalClauses = a && Array.isArray(a.approval) && a.approval.length
    ? a.approval.map((cl) => `Policy ${cl.policy_no || c.policyNo}, clause ${cl.seq}: "${cl.clause_text}"`)
    : [`${PLACEHOLDER} - cite the policy clause under which cover applies.`]
  return {
    to: c.insurerContact,
    subject: `Reconsideration request - claim ${c.reference} (policy ${c.policyNo})`,
    sections: [
      { body: [`Dear ${c.insurerContact},`] },
      { body: [
        `We refer to your decision on claim ${c.reference} under policy ${c.policyNo} (${c.insured}).`,
        `Your stated position: ${insurerReason}`,
        'We respectfully request reconsideration on the policy basis set out below.',
      ] },
      { heading: 'Incident and vehicle', body: incidentBlock(c) },
      { heading: 'Policy basis for cover', checklist: approvalClauses },
      { body: ['On this basis the claim falls within cover. Kindly reassess and confirm approval, or advise the specific evidence still required.'] },
      { body: signOff(c) },
    ],
  }
}

function buildTotalLossAdvice(c, tl) {
  const verdict = tl.isTotalLoss == null
    ? 'Insufficient figures were provided to determine constructive total loss; enter the repair cost, insured value and total-loss threshold.'
    : tl.note
  return {
    to: c.insurerContact,
    subject: `Constructive total-loss position - claim ${c.reference}`,
    sections: [
      { body: [`Dear ${c.insurerContact},`] },
      { body: [`This sets out the total-loss position for claim ${c.reference} under policy ${c.policyNo} (${c.insured}).`] },
      { heading: 'Assessment', body: [
        `Repair estimate: ${money(c.claimAmount, c.ccy)}`,
        `Insured value: ${money(c.insuredValue, c.ccy)}`,
        `Total-loss threshold value: ${money(tl.thresholdValue, c.ccy)}`,
        `Repair / insured ratio: ${tl.ratioPct == null ? 'N/A' : `${tl.ratioPct}%`}`,
        `Position: ${verdict}`,
      ] },
      { body: ['Please confirm your agreement with the position above and the basis of settlement (repair or total loss).'] },
      { body: signOff(c) },
    ],
  }
}

// ── public API ────────────────────────────────────────────────────────────────
/**
 * Build every correspondence document for a scenario and mark the ones the
 * facts recommend.
 *
 * @param {object}  args
 * @param {object}  args.policy     the selected policy row.
 * @param {Array}   args.findings   output of assessClaim(conditions, ctx).
 * @param {object}  args.ctx        the scenario flags (drives the checklist).
 * @param {object}  args.caseInfo   free-text case fields the operator supplies.
 * @param {number}  args.repairCost repair estimate for the total-loss advice.
 * @param {number}  args.insuredValue insured value for the total-loss advice.
 * @returns {{documents: Array, recommendedKeys: string[]}}
 */
export function buildCorrespondence({ policy = {}, findings = [], ctx = {}, caseInfo = {}, repairCost, insuredValue, analysis = null } = {}) {
  const fnds = Array.isArray(findings) ? findings : []
  const c = baseContext(policy, { ...caseInfo, claimAmount: caseInfo.claimAmount ?? repairCost })
  c.insuredValue = insuredValue ?? policy.sum_insured ?? policy.limit_of_liability
  const tl = totalLossAssessment({ repairCost: c.claimAmount, insuredValue: c.insuredValue, thresholdPct: policy.total_loss_threshold_pct })

  const built = {
    approval_request: buildApprovalRequest(c),
    claim_submission: buildClaimSubmission(c),
    document_checklist: buildDocumentChecklist(c, ctx),
    delay_notice: buildDelayNotice(c, fnds),
    followup: buildFollowup(c),
    rejection_notice: buildRejectionNotice(c, fnds),
    reconsideration: buildReconsideration(c, analysis),
    total_loss_advice: buildTotalLossAdvice(c, tl),
  }

  const documents = CORRESPONDENCE_TYPES.map((t) => ({ ...t, ...built[t.key] }))

  // recommend by scenario
  const hasReject = fnds.some((f) => f.severity === 'reject')
  const hasDelay = fnds.some((f) => f.severity === 'delay' || f.severity === 'info')
  const recommended = new Set(['claim_submission', 'document_checklist'])
  if (ctx.repairedBeforeApproval !== true) recommended.add('approval_request')
  if (hasReject) recommended.add('rejection_notice')
  if (hasDelay) { recommended.add('delay_notice'); recommended.add('followup') }
  if (tl.isTotalLoss === true) recommended.add('total_loss_advice')
  // When an insurer message has been analysed, drive the reply from its outcome.
  if (analysis) {
    if (analysis.outcome === 'rejected') recommended.add('reconsideration')
    if (analysis.outcome === 'delayed' || analysis.outcome === 'information_requested') { recommended.add('followup'); recommended.add('document_checklist') }
  }

  return { documents, recommendedKeys: [...recommended] }
}

/**
 * Render a built document to a clean ASCII text body (used for copy, download
 * and the mailto body). Sections may carry a heading, body lines and/or a
 * checklist; checklist items are prefixed "[ ]".
 */
export function documentToText(doc) {
  if (!doc) return ''
  const lines = []
  if (doc.subject) { lines.push(`Subject: ${doc.subject}`); lines.push('') }
  if (doc.to) { lines.push(`To: ${doc.to}`); lines.push('') }
  for (const s of doc.sections || []) {
    if (s.heading) { lines.push(s.heading); lines.push('') }
    for (const b of s.body || []) lines.push(b)
    for (const item of s.checklist || []) lines.push(`[ ] ${item}`)
    lines.push('')
  }
  // collapse a trailing blank
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/** mailto: href for an email document (empty for non-email kinds). */
export function documentMailto(doc) {
  if (!doc || doc.kind !== 'email') return ''
  const to = ''
  const subject = encodeURIComponent(doc.subject || '')
  const body = encodeURIComponent(documentToText({ ...doc, subject: '', to: '' }).replace(/^\n+/, ''))
  return `mailto:${to}?subject=${subject}&body=${body}`
}

/**
 * accidentCaseVocab.js - the vocabulary the owner's accident mock screens use,
 * in ONE place so the web case tabs and the Flutter case screens cannot drift.
 *
 * Source: the 10 mock screens shared on 2026-09-16 (case timeline, dispatch and
 * handover, responsibility and payment, register claim, repair assessment,
 * fleet validation, identify asset, and three damage-map screens). Every list
 * below is transcribed from those screens. Do NOT re-declare any of these in a
 * component; import from here. accidentVocab.js keeps the OLDER register
 * vocabularies (severity/status/type tokens) and is untouched.
 *
 * DB tokens are snake_case; labels are what the mock prints. Where a token
 * already exists in the live schema (liability_type, recommended_route,
 * severity) the mock label is mapped onto the EXISTING token rather than a new
 * one, so nothing already stored is invalidated.
 */

// ── Report wizard (mobile) - "Step N of 7" ───────────────────────────────────
export const REPORT_WIZARD_STEPS = [
  { key: 'identify_asset',   n: 1, label: 'Identify asset' },
  { key: 'incident',         n: 2, label: 'Incident details' },
  { key: 'people_authority', n: 3, label: 'People and authority' },
  { key: 'damage',           n: 4, label: 'Mark damage' },
  { key: 'evidence',         n: 5, label: 'Evidence' },
  { key: 'documents',        n: 6, label: 'Documents' },
  { key: 'review',           n: 7, label: 'Review and submit' },
]

// ── Case flow (both apps) - "Workstream N of 7" ──────────────────────────────
// Maps the mock screen order onto the accidentCase.js WORKSTREAMS keys so the
// same progress engine keeps driving completion; the mock numbering is only a
// presentation order.
export const CASE_FLOW = [
  { n: 1, key: 'fleet_validation', label: 'Fleet validation',          owner: 'Fleet' },
  { n: 2, key: 'assessment',       label: 'Workshop assessment',       owner: 'Workshop' },
  { n: 3, key: 'insurance',        label: 'Insurance / Claims',        owner: 'Insurance' },
  { n: 4, key: 'liability',        label: 'Responsibility and payment', owner: 'Fleet' },
  { n: 5, key: 'damage_map',       label: 'Damage mapping',            owner: 'Workshop' },
  { n: 6, key: 'handover',         label: 'Dispatch and handover',     owner: 'Fleet' },
  { n: 7, key: 'timeline',         label: 'Timeline and closure',      owner: 'Command Center' },
]
export const caseFlowStep = (key) => CASE_FLOW.find((s) => s.key === key) || null
export const caseFlowLabel = (key) => {
  const s = caseFlowStep(key)
  return s ? `Workstream ${s.n} of ${CASE_FLOW.length}` : ''
}

// ── M3 Who was at fault (maps onto accident_liability_assessments.liability_type)
export const FAULT_TILES = [
  { key: 'our_driver_full',     label: 'Our driver / GCC',    ourPct: 100, otherPct: 0 },
  { key: 'third_party_full',    label: 'Other party',         ourPct: 0,   otherPct: 100 },
  { key: 'shared',              label: 'Shared fault',        ourPct: 50,  otherPct: 50 },
  { key: 'under_investigation', label: 'Under investigation', ourPct: null, otherPct: null },
  { key: 'not_applicable',      label: 'Not applicable',      ourPct: null, otherPct: null },
]
export const faultStatusFor = (liabilityType, ourPct) => {
  if (liabilityType === 'under_investigation') return 'Under review'
  if (liabilityType === 'not_applicable') return 'Not applicable'
  // Number(null) is 0 and 0 is finite - an unset percentage must read as
  // "not decided", never as Non-faulty. Check blankness before coercing.
  if (ourPct === null || ourPct === undefined || String(ourPct).trim() === '') return ''
  const n = Number(ourPct)
  if (!Number.isFinite(n)) return ''
  return n > 0 ? 'Faulty' : 'Non-faulty'
}

// ── M3 Who will pay (accident_liability_assessments.payer) ───────────────────
export const PAYER_TILES = [
  { key: 'other_party_insurance', label: 'Other party insurance' },
  { key: 'our_insurance',         label: 'Our insurance' },
  { key: 'company',               label: 'GCC / company' },
  { key: 'driver_recovery',       label: 'Driver recovery' },
  { key: 'warranty',              label: 'Warranty' },
  { key: 'pending',               label: 'Pending decision' },
]
export const payerLabel = (k) => PAYER_TILES.find((p) => p.key === k)?.label || ''
/** Recovery is "required" when someone other than us pays. */
export const recoveryRequiredFor = (payer) => ['other_party_insurance', 'driver_recovery', 'warranty'].includes(payer)

// ── M3 Third-party and authority rows (each shows value, recorded by, verification)
export const AUTHORITY_ROWS = [
  { key: 'third_party_plate',  label: 'Third-party plate' },
  { key: 'third_party_driver', label: 'Third-party driver' },
  { key: 'third_party_phone',  label: 'Contact phone' },
  { key: 'police_report_no',   label: 'Police report no.' },
  { key: 'najm_report',        label: 'Najm report' },
  { key: 'taqdeer_required',   label: 'Taqdeer required' },
  { key: 'taqdeer_no',         label: 'Taqdeer no.' },
]
export const VERIFICATION_STATES = ['verified', 'pending', 'missing']

// ── M3 Responsibility documents (accident_evidence.requirement_key) ─────────
export const RESPONSIBILITY_DOCS = [
  { key: 'police_accident_report',       label: 'Police Accident Report',        required: true },
  { key: 'najm_report',                  label: 'Najm Report',                   required: true },
  { key: 'taqdeer_assessment',           label: 'Taqdeer Assessment',            required: true },
  { key: 'third_party_registration_card', label: 'Third-party Registration Card', required: true },
  { key: 'third_party_insurance_policy', label: 'Third-party Insurance Policy',  required: true },
  { key: 'driver_licence',               label: 'Driver Licence',                required: true },
  { key: 'company_letter_undertaking',   label: 'Company Letter / Undertaking',  required: false },
]

// ── M4 Claim document package (accident_evidence.requirement_key, workstream insurance)
export const CLAIM_PACKAGE_DOCS = [
  { key: 'accident_report_pdf',      label: 'Accident report PDF',      required: true },
  { key: 'fleet_validation',         label: 'Fleet validation',         required: true },
  { key: 'workshop_assessment_pdf',  label: 'Workshop assessment PDF',  required: true },
  { key: 'damage_photographs',       label: 'Damage photographs',       required: true, countable: true },
  { key: 'police_najm_report',       label: 'Police / Najm report',     required: true },
  { key: 'vehicle_registration',     label: 'Vehicle registration',     required: true },
  { key: 'driving_licence',          label: 'Driving licence',          required: true },
  { key: 'policy_document',          label: 'Policy document',          required: true },
]

// ── M5 Repair assessment ─────────────────────────────────────────────────────
// Maps the three mock tiles onto the EXISTING recommended_route / repair_route
// CHECK tokens. 'on_site' is added by the parity migration.
export const REPAIR_ROUTE_TILES = [
  { key: 'internal', label: 'Internal workshop' },
  { key: 'external', label: 'External workshop' },
  { key: 'on_site',  label: 'On-site repair' },
]
export const DAMAGE_ACTIONS = [
  { key: 'repair',            label: 'Repair' },
  { key: 'replace',           label: 'Replace' },
  { key: 'structural_review', label: 'Replace / structural review' },
  { key: 'monitor',           label: 'Monitor' },
]
export const PARTS_AVAILABILITY = [
  { key: 'available',     label: 'Available' },
  { key: 'special_order', label: 'Special order' },
  { key: 'unknown',       label: 'Not checked' },
]
export const QUOTATION_STATES = [
  { key: 'not_requested', label: 'Not requested' },
  { key: 'requested',     label: 'Requested' },
  { key: 'received',      label: 'Received' },
  { key: 'approved',      label: 'Approved' },
  { key: 'rejected',      label: 'Rejected' },
]
export const ASSESSMENT_ATTACHMENTS = [
  { key: 'assessment_report_pdf', label: 'Assessment report PDF', required: true },
  { key: 'vendor_quotation',      label: 'Vendor quotation',      required: true, gatesSubmit: true },
  { key: 'damage_photos',         label: 'Damage photos',         required: true, countable: true },
  { key: 'recovery_request',      label: 'Recovery request',      required: false },
]

// ── M6 Fleet validation checklist (accident_fleet_validation_items.item_key) ─
export const FLEET_VALIDATION_ITEMS = [
  { key: 'asset_driver_confirmed',       label: 'Asset and driver confirmed' },
  { key: 'incident_facts_confirmed',     label: 'Incident facts confirmed' },
  { key: 'damage_map_reviewed',          label: 'Damage map reviewed' },
  { key: 'required_photographs',         label: 'Required photographs', countable: true },
  { key: 'police_najm_documents',        label: 'Police / Najm documents', countable: true },
  { key: 'workshop_assessment_requested', label: 'Workshop assessment requested' },
]
export const CHECK_STATES = ['pending', 'done', 'attention', 'not_applicable']

// ── M2 Dispatch and handover ─────────────────────────────────────────────────
export const DISPATCH_STEPPER = [
  { key: 'dispatched',        n: 1, label: 'Dispatched' },
  { key: 'arrived',           n: 2, label: 'Arrived' },
  { key: 'signed_acceptance', n: 3, label: 'Signed acceptance' },
  { key: 'vendor_assessment', n: 4, label: 'Vendor assessment / quotation starts' },
]
export const DISPATCH_LIVE_STATES = [
  { key: 'preparing',  label: 'Preparing' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'arrived',    label: 'Arrived' },
  { key: 'accepted',   label: 'Accepted' },
]
/** Vendor receipt fields the mock marks with an asterisk. */
export const RECEIPT_REQUIRED = [
  'arrived_at', 'received_by_name', 'received_by_designation',
  'receiving_photos', 'handover_paper_ref', 'receiver_signature', 'custody_accepted',
]

// ── M8/M9/M10 Damage mapping ────────────────────────────────────────────────
export const DAMAGE_TYPES = [
  { key: 'dent',    label: 'Dent' },
  { key: 'scratch', label: 'Scratch' },
  { key: 'cracked', label: 'Cracked' },
  { key: 'broken',  label: 'Broken' },
  { key: 'missing', label: 'Missing' },
  { key: 'bent',    label: 'Bent' },
  { key: 'other',   label: 'Other' },
]
export const DAMAGE_TYPE_ALIAS = { crack: 'cracked', cracked: 'cracked', dented: 'dent' }
export const canonDamageType = (v) => {
  const k = String(v || '').trim().toLowerCase()
  return DAMAGE_TYPE_ALIAS[k] || (DAMAGE_TYPES.some((d) => d.key === k) ? k : k ? 'other' : '')
}
// Levels keep the EXISTING stored tokens (minor/moderate/severe); the mock
// label for 'severe' is Major.
export const DAMAGE_LEVELS = [
  { key: 'minor',    label: 'Minor' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'severe',   label: 'Major' },
]
export const DAMAGE_NOTE_MAX = 200
/** View chips per vehicle family, in the order the mock shows them. */
export const FAMILY_VIEW_ORDER = {
  bus:           ['left', 'front_left', 'front', 'right', 'rear', 'top'],
  concrete_pump: ['top', 'left', 'right', 'front', 'rear'],
  pickup:        ['left', 'right', 'front', 'rear', 'top'],
  generic:       ['left', 'right', 'front', 'rear', 'top'],
}
export const VIEW_LABELS = {
  left: 'Left', front_left: 'Front-left', front: 'Front', right: 'Right', rear: 'Rear', top: 'Top', overview: 'Overview',
}

// ── Named notify roles used on M4/M5/M6 ─────────────────────────────────────
// Roles, not people: the mock shows names because a person holds the role.
export const NOTIFY_ROLES = [
  { key: 'fleet',          label: 'Fleet',          roles: ['Fleet Supervisor', 'Manager'] },
  { key: 'workshop',       label: 'Workshop',       roles: ['Workshop Supervisor', 'Workshop Maintenance Area Manager'] },
  { key: 'insurance',      label: 'Insurance',      roles: ['Insurance Officer'] },
  { key: 'command_center', label: 'Command Center', roles: ['Data Monitor Officer'] },
  { key: 'pmv_manager',    label: 'PMV Manager',    roles: ['PMV Manager'], visibilityOnly: true },
]

// ── M1 Timeline filters (already in caseTimelineFeed.FILTERS; mirrored here for Flutter parity)
export const TIMELINE_TABS = ['Timeline', 'Notifications', 'Participants']
export const TIMELINE_FILTERS = ['all', 'actions', 'documents', 'sla', 'emails']

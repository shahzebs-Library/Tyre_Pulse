/**
 * Checklist audit pack: the evidence an ISO 9001 / 45001 / 55001 auditor asks
 * for, built from the checklist forms, their records and the corrective actions
 * the records raised. Pure - no I/O, `now` is injectable.
 *
 * One engine serves every audit type. The type changes the cover wording, the
 * default name handling and which findings are written up; it never changes a
 * figure, so an internal and an external pack over the same period always agree.
 *
 * Clauses quoted are ISO 9001:2015 (the other management-system standards share
 * the same Annex SL numbering for 7.2 / 7.5 / 9.2 / 10.2).
 */

export const AUDIT_TYPES = [
  { key: 'internal', label: 'Internal audit', clause: 'ISO 9001 9.2',
    purpose: 'Internal audit of the checklist and inspection process.', hideNames: false },
  { key: 'external', label: 'External certification audit', clause: 'ISO 9001 / 45001 / 55001',
    purpose: 'Evidence pack for the certification body (stage 2 or surveillance).', hideNames: false },
  { key: 'customer', label: 'Customer audit', clause: 'Second-party audit',
    purpose: 'Evidence pack for a customer audit of maintenance and inspection control.', hideNames: true },
  { key: 'regulatory', label: 'Regulatory inspection', clause: 'Authority inspection',
    purpose: 'Evidence pack for an authority or regulator inspection.', hideNames: false },
]

export function auditType(key) {
  return AUDIT_TYPES.find((t) => t.key === key) || AUDIT_TYPES[0]
}

export const SEVERITY = { major: 'Major', minor: 'Minor', observation: 'Observation' }
const SEVERITY_RANK = { major: 0, minor: 1, observation: 2 }

const DAY = 86400000
const REVIEW_DUE_SOON_DAYS = 30
// More roles than this on one plant form is hard to justify against training records.
const BROAD_ROLE_LIMIT = 12

const toTime = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const isoDay = (v) => {
  const t = toTime(v)
  return t == null ? '' : new Date(t).toISOString().slice(0, 10)
}

export function addMonths(value, months) {
  const t = toTime(value)
  if (t == null) return null
  const d = new Date(t)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0))
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

/** Review state of one form: ok | due_soon | overdue | never. */
export function reviewStatus(template, now = new Date()) {
  const last = template?.last_reviewed_at || template?.form_approved_at
  if (!last) return { status: 'never', next: null }
  const next = addMonths(last, Number(template?.review_interval_months) || 12)
  const days = Math.floor((next.getTime() - toTime(now)) / DAY)
  return { status: days < 0 ? 'overdue' : days <= REVIEW_DUE_SOON_DAYS ? 'due_soon' : 'ok', next, days }
}

const REVIEW_LABEL = { ok: 'In date', due_soon: 'Due soon', overdue: 'Overdue', never: 'Never reviewed' }

function blockingMarks(template) {
  const b = template?.option_sets?.legend?.blocking
  return Array.isArray(b) ? b.map(String) : []
}

function fieldLabel(fields, key) {
  const f = (Array.isArray(fields) ? fields : []).find((x) => x?.id === key)
  return (f?.label && String(f.label).trim()) || key
}

/** Every blocking mark on a record: [{ key, label, mark }]. */
export function recordFaults(submission, template) {
  const marks = blockingMarks(template)
  if (!marks.length) return []
  const fields = submission?.template_snapshot?.fields || template?.fields
  return Object.entries(submission?.answers || {})
    .filter(([, v]) => typeof v === 'string' && marks.includes(v))
    .map(([key, mark]) => ({ key, label: fieldLabel(fields, key), mark }))
}

const APPROVAL_LABEL = {
  approved: 'Approved', rejected: 'Rejected', pending: 'Awaiting supervisor',
  pending_approval: 'Awaiting approval', pending_area_manager: 'Awaiting area manager',
  not_required: 'No approval needed',
}
export const approvalLabel = (s) => APPROVAL_LABEL[s] || (s ? String(s) : 'Not recorded')
const isPending = (s) => s === 'pending' || s === 'pending_approval' || s === 'pending_area_manager'

/** Keep a record when it falls in the period and the chosen forms/site. */
export function filterRecords(submissions, { from, to, templateIds, site } = {}) {
  const f = toTime(from ? `${String(from).slice(0, 10)}T00:00:00Z` : null)
  const t = toTime(to ? `${String(to).slice(0, 10)}T23:59:59Z` : null)
  const ids = Array.isArray(templateIds) && templateIds.length ? new Set(templateIds) : null
  return (submissions || []).filter((s) => {
    const at = toTime(s.submitted_at || s.created_at)
    if (f != null && (at == null || at < f)) return false
    if (t != null && (at == null || at > t)) return false
    if (ids && !ids.has(s.template_id)) return false
    if (site && String(s.site || '').toUpperCase() !== String(site).toUpperCase()) return false
    return true
  })
}

/**
 * Build the whole pack.
 * @param {object} input templates, submissions (already filtered), actions (checklist CAs), policy, options
 */
export function buildAuditPack({
  templates = [], submissions = [], actions = [], policy = {}, type = 'internal',
  from = '', to = '', site = '', hideNames, now = new Date(),
} = {}) {
  const at = auditType(type)
  const anonymise = hideNames ?? at.hideNames
  const who = (name) => (anonymise ? (name ? 'Recorded' : '') : (name || ''))
  const byId = new Map(templates.map((t) => [t.id, t]))
  const published = templates.filter((t) => t.status === 'published')
  const nowT = toTime(now)
  const slaHours = Number(policy?.supervisor_approval_sla_hours) || 24
  const actionsBySource = new Map()
  for (const a of actions) {
    if (!a?.source_id) continue
    if (!actionsBySource.has(a.source_id)) actionsBySource.set(a.source_id, [])
    actionsBySource.get(a.source_id).push(a)
  }
  const countByTemplate = new Map()
  for (const s of submissions) countByTemplate.set(s.template_id, (countByTemplate.get(s.template_id) || 0) + 1)

  // ── Controlled form register (ISO 7.5.2 / 7.5.3) ──────────────────────────
  const forms = published.map((t) => {
    const rv = reviewStatus(t, now)
    const roles = Array.isArray(t.assignee_roles) ? t.assignee_roles : []
    const levels = !t.require_approval ? 'None' : t.require_area_manager ? 'Supervisor + area manager' : 'Supervisor'
    return {
      id: t.id,
      name: t.name,
      form_ref: t.form_ref || '',
      revision: t.form_revision || (t.version != null ? `v${t.version}` : ''),
      system_version: t.version ?? '',
      effective: isoDay(t.form_effective_date),
      owner: t.form_owner || '',
      approved_by: who(t.form_approved_name),
      approved_on: isoDay(t.form_approved_at),
      last_reviewed: isoDay(t.last_reviewed_at),
      next_review: rv.next ? isoDay(rv.next) : '',
      review: REVIEW_LABEL[rv.status],
      review_status: rv.status,
      doc_prefix: t.doc_prefix || '',
      signature: t.require_signature ? 'Required' : 'Not required',
      approval: levels,
      assigned_roles: roles.length ? roles.length : 'All roles',
      role_list: roles.join(', '),
      records: countByTemplate.get(t.id) || 0,
    }
  })

  // ── Record register (ISO 7.5.3 / 8.5.1) ───────────────────────────────────
  const records = submissions.map((s) => {
    const t = byId.get(s.template_id)
    const faults = recordFaults(s, t)
    const cas = actionsBySource.get(s.id) || []
    const submittedT = toTime(s.submitted_at || s.created_at)
    const pending = isPending(s.approval_status)
    const ageH = pending && submittedT != null ? Math.floor((nowT - submittedT) / 3600000) : null
    return {
      id: s.id,
      document_no: s.document_no || '',
      form: s.template_name || t?.name || '',
      form_ref: t?.form_ref || '',
      form_version: s.template_version != null ? `v${s.template_version}` : '',
      version_evidence: s.template_snapshot_status === 'exact' ? 'Exact form copy kept' : 'Form copy missing',
      asset_no: s.asset_no || '',
      site: s.site || '',
      submitted: isoDay(s.submitted_at || s.created_at),
      submitted_by: who(s.printed_name),
      approval: approvalLabel(s.approval_status),
      approval_status: s.approval_status || '',
      supervisor: who(s.supervisor_name),
      approver: who(s.approver_name),
      approved_on: isoDay(s.approved_at),
      waiting_hours: ageH,
      overdue_approval: ageH != null && ageH > slaHours,
      faults_open: faults.length,
      corrective_actions: cas.length,
      locked: s.locked ? 'Yes' : 'No',
    }
  })

  // ── Faults and corrective actions (ISO 10.2) ──────────────────────────────
  const faults = []
  for (const s of submissions) {
    const cas = actionsBySource.get(s.id) || []
    for (const a of cas) {
      const due = toTime(a.due_date)
      const open = String(a.status || '').toLowerCase() !== 'closed'
      faults.push({
        document_no: s.document_no || '',
        asset_no: s.asset_no || a.asset_no || '',
        site: s.site || a.site || '',
        item: a.source_detail || '',
        raised: isoDay(a.created_at),
        action: a.title || '',
        action_status: a.status || 'Open',
        due: isoDay(a.due_date),
        overdue: open && due != null && due < nowT,
        closed: isoDay(a.closed_at),
        verified: a.verified_at ? 'Verified' + (a.effective === false ? ' (not effective)' : '') : (open ? '' : 'Not verified'),
        has_action: true,
      })
    }
    const covered = new Set(cas.map((a) => a.source_detail))
    for (const f of recordFaults(s, byId.get(s.template_id))) {
      if (covered.has(f.label)) continue
      faults.push({
        document_no: s.document_no || '', asset_no: s.asset_no || '', site: s.site || '',
        item: f.label, raised: '', action: 'No corrective action', action_status: 'Missing',
        due: '', overdue: false, closed: '', verified: '', has_action: false,
      })
    }
  }

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings = []
  const add = (severity, clause, title, detail, count) => {
    if (count === 0) return
    findings.push({ severity, severity_label: SEVERITY[severity], clause, title, detail, count: count ?? '' })
  }
  const list = (rows, key = 'name', max = 6) => {
    const names = rows.map((r) => r[key]).filter(Boolean)
    return names.slice(0, max).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '')
  }
  const noRef = forms.filter((f) => !f.form_ref)
  add('minor', '7.5.2', 'Forms without a control number', `No form number on: ${list(noRef)}.`, noRef.length)
  const noApprover = forms.filter((f) => !f.approved_by)
  add('minor', '7.5.2', 'Form approval not recorded by name',
    `The approved version has no named approver: ${list(noApprover)}. Mark each form reviewed to record it.`, noApprover.length)
  const overdue = forms.filter((f) => f.review_status === 'overdue' || f.review_status === 'never')
  add('minor', '7.5.2', 'Form review overdue', `Review is overdue or never done: ${list(overdue)}.`, overdue.length)
  const noPrefix = forms.filter((f) => !f.doc_prefix)
  add('minor', '7.5.3', 'Forms that do not number their records', `No document prefix on: ${list(noPrefix)}.`, noPrefix.length)
  const noDoc = records.filter((r) => !r.document_no)
  add('minor', '7.5.3', 'Records without a document number', `${noDoc.length} record(s) in the period have no document number.`, noDoc.length)
  const noCopy = records.filter((r) => r.version_evidence !== 'Exact form copy kept')
  add('observation', '7.5.3', 'Records without the exact form copy',
    `${noCopy.length} record(s) cannot show the exact form version they were filled on.`, noCopy.length)
  const missingCa = faults.filter((f) => !f.has_action)
  add('major', '10.2', 'Faults without a corrective action',
    `${missingCa.length} recorded fault(s) have no corrective action. Use "Raise missing corrective actions".`, missingCa.length)
  const caOverdue = faults.filter((f) => f.overdue)
  add('minor', '10.2', 'Corrective actions past their due date', `${caOverdue.length} open action(s) are past due.`, caOverdue.length)
  const unverified = faults.filter((f) => f.has_action && f.closed && f.verified === 'Not verified')
  add('observation', '10.2', 'Closed actions not verified for effectiveness',
    `${unverified.length} action(s) were closed without an effectiveness check.`, unverified.length)
  const late = records.filter((r) => r.overdue_approval)
  add('minor', '8.5.1', 'Approvals waiting longer than the agreed time',
    `${late.length} record(s) have waited more than ${slaHours} hours for sign-off.`, late.length)
  const pendingAll = records.filter((r) => isPending(r.approval_status))
  add('observation', '8.5.1', 'Records still waiting for sign-off', `${pendingAll.length} record(s) are not yet signed off.`, pendingAll.length)
  const broad = forms.filter((f) => typeof f.assigned_roles === 'number' && f.assigned_roles > BROAD_ROLE_LIMIT)
  add('observation', '7.2', 'Forms open to a very wide set of roles',
    `More than ${BROAD_ROLE_LIMIT} roles may fill: ${list(broad)}. Keep training records that show each role is competent, or narrow the list.`, broad.length)
  const unused = forms.filter((f) => f.records === 0)
  add('observation', '9.1', 'Forms with no records in the period',
    `No evidence of use for: ${list(unused)}.`, unused.length)
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  // ── Summary ───────────────────────────────────────────────────────────────
  const approved = records.filter((r) => r.approval_status === 'approved').length
  const withActions = faults.filter((f) => f.has_action).length
  const summary = {
    audit_type: at.label,
    clause: at.clause,
    purpose: at.purpose,
    period: from || to ? `${from || 'start'} to ${to || 'today'}` : 'All records',
    site: site || 'All sites',
    generated: isoDay(now),
    forms: forms.length,
    forms_in_date: forms.filter((f) => f.review_status === 'ok' || f.review_status === 'due_soon').length,
    records: records.length,
    approved,
    pending: pendingAll.length,
    rejected: records.filter((r) => r.approval_status === 'rejected').length,
    approval_rate: records.length ? Math.round((approved / records.length) * 100) : null,
    faults: faults.length,
    faults_with_action: withActions,
    action_coverage: faults.length ? Math.round((withActions / faults.length) * 100) : null,
    actions_open: faults.filter((f) => f.has_action && String(f.action_status).toLowerCase() !== 'closed').length,
    majors: findings.filter((f) => f.severity === 'major').length,
    minors: findings.filter((f) => f.severity === 'minor').length,
    observations: findings.filter((f) => f.severity === 'observation').length,
    retention: `${policy?.submission_retention_months ?? 84} months for records, ${policy?.evidence_retention_months ?? 84} months for photos (${String(policy?.retention_disposition || 'review_then_archive').replace(/_/g, ' ')})`,
    names_hidden: !!anonymise,
  }

  return { summary, findings, forms, records, faults }
}

// ── Export column sets (shared by Excel and PDF) ───────────────────────────
export const FINDING_COLS = [
  ['severity_label', 'Severity'], ['clause', 'Clause'], ['title', 'Finding'], ['count', 'Count'], ['detail', 'Detail'],
]
export const FORM_COLS = [
  ['name', 'Form'], ['form_ref', 'Form no'], ['revision', 'Revision'], ['system_version', 'System version'],
  ['effective', 'Effective'], ['owner', 'Owner'], ['approved_by', 'Approved by'], ['approved_on', 'Approved on'],
  ['last_reviewed', 'Last reviewed'], ['next_review', 'Next review'], ['review', 'Review'],
  ['doc_prefix', 'Record prefix'], ['signature', 'Signature'], ['approval', 'Sign-off'],
  ['assigned_roles', 'Roles'], ['records', 'Records in period'],
]
export const RECORD_COLS = [
  ['document_no', 'Document no'], ['form', 'Form'], ['form_ref', 'Form no'], ['form_version', 'Form version'],
  ['version_evidence', 'Form copy'], ['asset_no', 'Asset'], ['site', 'Site'], ['submitted', 'Submitted'],
  ['submitted_by', 'Submitted by'], ['approval', 'Sign-off'], ['supervisor', 'Supervisor'], ['approver', 'Approver'],
  ['approved_on', 'Approved on'], ['faults_open', 'Open faults'], ['corrective_actions', 'Actions'], ['locked', 'Locked'],
]
export const FAULT_COLS = [
  ['document_no', 'Document no'], ['asset_no', 'Asset'], ['site', 'Site'], ['item', 'Item'], ['raised', 'Raised'],
  ['action', 'Corrective action'], ['action_status', 'Status'], ['due', 'Due'], ['closed', 'Closed'], ['verified', 'Verification'],
]

export function summaryRows(summary) {
  const pct = (v) => (v == null ? 'N/A' : `${v}%`)
  return [
    ['Audit type', summary.audit_type], ['Scope', summary.clause], ['Purpose', summary.purpose],
    ['Period', summary.period], ['Site', summary.site], ['Generated', summary.generated],
    ['Controlled forms', summary.forms], ['Forms with review in date', summary.forms_in_date],
    ['Records', summary.records], ['Signed off', summary.approved], ['Waiting for sign-off', summary.pending],
    ['Rejected', summary.rejected], ['Sign-off rate', pct(summary.approval_rate)],
    ['Faults recorded', summary.faults], ['Faults with a corrective action', summary.faults_with_action],
    ['Corrective action coverage', pct(summary.action_coverage)], ['Corrective actions open', summary.actions_open],
    ['Findings: major / minor / observation', `${summary.majors} / ${summary.minors} / ${summary.observations}`],
    ['Record retention', summary.retention],
    ['People names', summary.names_hidden ? 'Hidden for this audit' : 'Shown'],
  ]
}

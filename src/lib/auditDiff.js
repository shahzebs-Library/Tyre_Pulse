/**
 * auditDiff.js - turn accident_audit_log rows into human "who changed what".
 * Shared by the web AccidentDetailModal Activity tab.
 */

// Curated, labelled fields we surface in the diff (order = display order).
export const ACCIDENT_AUDIT_FIELDS = [
  ['status', 'Status'],
  ['closure_status', 'Closure'],
  ['severity', 'Severity'],
  ['claim_status', 'Claim status'],
  ['claim_amount', 'Claim amount'],
  ['claim_approved_amount', 'Approved amount'],
  ['deductible', 'Deductible'],
  ['payer', 'Who pays'],
  ['liable_party', 'Liable party'],
  ['responsible_party', 'Responsible party'],
  ['driver_name', 'Driver'],
  ['insurer', 'Insurer'],
  ['policy_no', 'Policy / Claim no'],
  ['recovered_amount', 'Recovered amount'],
  ['recovery_status', 'Recovery status'],
  ['recovery_source', 'Recovery source'],
  ['recovery_date', 'Recovery date'],
  ['recovery_reference', 'Recovery ref'],
  ['estimated_damage_cost', 'Est. damage cost'],
  ['location', 'Location'],
  ['case_stage', 'Case stage'],
  ['damage_condition', 'Damage condition'],
  ['current_status', 'Current status'],
  ['action_to_be_taken', 'Action to be taken'],
  ['responsible_owner', 'Responsible owner'],
  ['required_action', 'Required action'],
  ['status_update_date', 'Status update date'],
  ['status_update_note', 'Status update note'],
  ['expected_release_date', 'Expected release'],
  ['description', 'Description'],
  ['damage_description', 'Damage description'],
  ['notes', 'Notes'],
]

const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

const ACTION_LABELS = {
  field_update: 'Updated details',
  status_change: 'Changed status',
  delete: 'Deleted report',
  part_added: 'Added part',
  part_updated: 'Updated part',
  part_removed: 'Removed part',
}

/**
 * Describe a single audit row → { title, lines: [{label, from, to}] }.
 * Field-level rows diff the curated fields; part rows summarise the line item.
 */
export function describeAuditRow(row, fields = ACCIDENT_AUDIT_FIELDS) {
  const title = ACTION_LABELS[row.action] || 'Changed'

  if (row.action?.startsWith('part_')) {
    const p = row.new_values || row.old_values || {}
    const summary = `${p.part_name || 'Part'}${p.quantity ? ` ×${Number(p.quantity)}` : ''}${p.status ? ` (${p.status})` : ''}`
    return { title, summary, lines: [] }
  }

  const o = row.old_values || {}
  const n = row.new_values || {}
  const lines = []
  for (const [k, label] of fields) {
    const a = o[k], b = n[k]
    if (JSON.stringify(a) !== JSON.stringify(b)) lines.push({ label, from: fmt(a), to: fmt(b) })
  }
  return { title, summary: null, lines }
}

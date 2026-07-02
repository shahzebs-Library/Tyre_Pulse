/**
 * auditDiff - turn accident_audit_log rows into "who changed what" for mobile.
 * Mirrors src/lib/auditDiff.js on the web.
 */

export interface AuditRow {
  id: string
  accident_id?: string
  changed_by?: string | null
  actor_name?: string | null
  changed_at: string
  action: string
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
}

export const ACCIDENT_AUDIT_FIELDS: [string, string][] = [
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
  ['description', 'Description'],
  ['damage_description', 'Damage description'],
  ['notes', 'Notes'],
]

const ACTION_LABELS: Record<string, string> = {
  field_update: 'Updated details',
  status_change: 'Changed status',
  delete: 'Deleted report',
  part_added: 'Added part',
  part_updated: 'Updated part',
  part_removed: 'Removed part',
}

const fmt = (v: any): string => {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

export interface AuditDescription {
  title: string
  summary: string | null
  lines: { label: string; from: string; to: string }[]
}

export function describeAuditRow(row: AuditRow, fields = ACCIDENT_AUDIT_FIELDS): AuditDescription {
  const title = ACTION_LABELS[row.action] || 'Changed'

  if (row.action?.startsWith('part_')) {
    const p = row.new_values || row.old_values || {}
    const summary = `${p.part_name || 'Part'}${p.quantity ? ` ×${Number(p.quantity)}` : ''}${p.status ? ` (${p.status})` : ''}`
    return { title, summary, lines: [] }
  }

  const o = row.old_values || {}
  const n = row.new_values || {}
  const lines: { label: string; from: string; to: string }[] = []
  for (const [k, label] of fields) {
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) {
      lines.push({ label, from: fmt(o[k]), to: fmt(n[k]) })
    }
  }
  return { title, summary: null, lines }
}

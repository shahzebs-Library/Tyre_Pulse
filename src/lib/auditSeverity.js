/**
 * Rule-based severity for audit_log_v2 events.
 *
 * audit_log_v2 has NO severity column, so the Audit Trail derives one from the
 * stored action and table name with the fixed rule below. The UI labels it as
 * rule based. The rule reads ONLY `action` and `table_name`, so the server can
 * count it exactly with one PostgREST `or` filter (`highSeverityOrFilter`) and
 * the "Critical events" tile always agrees with the badges on the rows.
 *
 * Rule (first match wins):
 *   High   - a PERSON deleting a business record (tyres, job cards, accidents,
 *            expense lines, fleet, inspections, stock, purchasing, claims);
 *            the same delete by an import or job (no user) is Medium;
 *          - a delete on a security table (API keys, access grants, roles);
 *          - a failed or denied security event (LOGIN_FAILED, ACCESS_DENIED...).
 *   Medium - tyre scrap / undo scrap;
 *          - any role, access or branding change (org_branding_update, writes on
 *            access tables, profile role/approval/lock changes);
 *          - a delete on any other table.
 *   Info   - everything else: create, update, sign in, sign out, export, upload.
 *
 * Pure: no I/O.
 */

export const DELETE_TOKENS = Object.freeze(['db.delete', 'DELETE'])

/** Business tables whose deletion removes operational or financial history. */
export const BUSINESS_TABLES = Object.freeze([
  'tyre_records', 'work_orders', 'work_order_line_items', 'accidents', 'parts_consumption',
  'vehicle_fleet', 'inspections', 'stock_records', 'stock_movements', 'purchase_orders',
  'corrective_actions', 'insurance_claims', 'production_logs', 'pm_programs',
  'pm_service_records', 'checklist_submissions', 'wash_records', 'asset_disposals',
  'sco_costs', 'sany_invoices',
])

/** Tables that hold access, roles or credentials. */
export const SECURITY_TABLES = Object.freeze([
  'api_keys', 'user_access_grants', 'module_permissions', 'custom_roles', 'admin_users',
  'console_ip_allowlist', 'sso_connections',
])

/** Stored action tokens that record a failed or refused security event. */
export const FAILURE_ACTIONS = Object.freeze([
  'LOGIN_FAILED', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'PERMISSION_DENIED', 'ACCOUNT_LOCKED', 'MFA_FAILED',
])

export const MEDIUM_ACTIONS = Object.freeze(['tyre_scrap', 'tyre_unscrap', 'org_branding_update'])

/** Profile fields whose change is an access change. */
const PROFILE_ACCESS_FIELDS = ['role', 'approved', 'locked', 'is_super_admin', 'country', 'sites', 'site']

export const SEVERITY_META = Object.freeze({
  high: { key: 'high', label: 'High', tone: 'bad', rank: 3 },
  medium: { key: 'medium', label: 'Medium', tone: 'warn', rank: 2 },
  info: { key: 'info', label: 'Info', tone: 'info', rank: 1 },
})

export const SEVERITY_CAPTION = 'Severity is rule based: the audit log stores no severity, so it is derived from the action and the table.'

const isDelete = (a) => DELETE_TOKENS.includes(a)

function touchesProfileAccess(row) {
  if (row?.table_name !== 'profiles') return false
  const oldV = row.old_values && typeof row.old_values === 'object' ? row.old_values : {}
  const newV = row.new_values && typeof row.new_values === 'object' ? row.new_values : {}
  return PROFILE_ACCESS_FIELDS.some((f) => f in oldV || f in newV)
}

/**
 * Severity of one audit row plus the reason the rule gave it.
 * @returns {{key:'high'|'medium'|'info', label:string, tone:string, rank:number, reason:string}}
 */
export function auditSeverity(row) {
  const action = String(row?.action ?? '')
  const table = row?.table_name ? String(row.table_name) : ''

  if (isDelete(action) && BUSINESS_TABLES.includes(table)) {
    // A person deleting a business record is High. The same delete written by an
    // import or job (no signed-in user) is routine clean-up: 43k+ work order
    // deletes in this log are imports, and rating them High would bury the real ones.
    return row?.user_id
      ? { ...SEVERITY_META.high, reason: 'Business record deleted by a person' }
      : { ...SEVERITY_META.medium, reason: 'Business record deleted by an import or job' }
  }
  if (isDelete(action) && SECURITY_TABLES.includes(table)) {
    return { ...SEVERITY_META.high, reason: 'Access or credential record deleted' }
  }
  if (FAILURE_ACTIONS.includes(action)) {
    return { ...SEVERITY_META.high, reason: 'Failed or refused security event' }
  }
  if (MEDIUM_ACTIONS.includes(action)) {
    return {
      ...SEVERITY_META.medium,
      reason: action === 'org_branding_update' ? 'Branding change' : 'Tyre scrap status changed',
    }
  }
  if (SECURITY_TABLES.includes(table) || touchesProfileAccess(row)) {
    return { ...SEVERITY_META.medium, reason: 'Role or access change' }
  }
  if (isDelete(action)) {
    return { ...SEVERITY_META.medium, reason: 'Record deleted' }
  }
  return { ...SEVERITY_META.info, reason: 'Routine event' }
}

const quoteList = (list) => list.map((v) => `"${v}"`).join(',')

/**
 * PostgREST `or` filter selecting exactly the rows `auditSeverity` rates High.
 * Used for the server head count of the Critical events tile.
 */
export function highSeverityOrFilter() {
  const deletes = quoteList(DELETE_TOKENS)
  return [
    `and(action.in.(${deletes}),table_name.in.(${quoteList(BUSINESS_TABLES)}),user_id.not.is.null)`,
    `and(action.in.(${deletes}),table_name.in.(${quoteList(SECURITY_TABLES)}))`,
    `action.in.(${quoteList(FAILURE_ACTIONS)})`,
  ].join(',')
}

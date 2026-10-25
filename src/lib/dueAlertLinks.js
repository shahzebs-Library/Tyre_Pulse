/**
 * Due-alert notifications (migration 20261025090000_due_alerts_engine.sql).
 * The server sends type `due_<rule_key>`; the link and severity are rebuilt here.
 * CHANGE WITH due_alert_rules (rule keys) AND mobile/lib/notificationsInbox.ts.
 */
export const DUE_ALERT_PREFIX = 'due_'

const LINKS = Object.freeze({
  due_pm_due: '/pm-programs',
  due_inspection_plan_overdue: '/inspection-planner',
  due_stock_low: '/stock',
  due_certification_expiry: '/certifications',
  due_insurance_policy_expiry: '/insurance-policies',
  due_fleet_document_expiry: '/fleet-master',
  due_tyre_end_of_life: '/tyre-lifecycle',
})

const SEVERITY = Object.freeze({
  due_stock_low: 'Critical',
  due_insurance_policy_expiry: 'Critical',
  due_pm_due: 'High',
  due_inspection_plan_overdue: 'High',
  due_certification_expiry: 'High',
  due_fleet_document_expiry: 'High',
  due_tyre_end_of_life: 'High',
})

export const isDueAlert = (type) => typeof type === 'string' && type.startsWith(DUE_ALERT_PREFIX)
export const dueAlertLink = (type) => LINKS[type] || null
export const dueAlertSeverity = (type) => SEVERITY[type] || 'Medium'

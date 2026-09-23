export const RESOLUTIONS = ['direct_payment', 'already_paid', 'dispute', 'company_recovery', 'instalments']
export const RECORD_TYPES = ['driver_documents', 'driver_training', 'driver_coaching', 'driver_safety_events', 'driver_expenses', 'tyre_records', 'accidents', 'wo_tasks', 'checklist_submissions', 'odometer_logs', 'wash_records']
export const RECEIPT_STATEMENT = 'I acknowledge receipt and review of this notice and submit the response shown above. Receipt does not mean admission of responsibility. A payment or recovery request does not authorize an automatic payment or payroll deduction.'
export function signatureImage(signature) {
  return signature?.startsWith('<svg ') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(signature)}` : signature
}
export function recordLabel(record) {
  if (!record) return 'Record no longer available'
  return [record.title || record.course_name || record.doc_type || record.event_type || record.category || record.template_name || record.accident_type || record.brand, record.asset_no, record.driver_name, record.incident_date || record.expense_date || record.reading_date || record.created_at].filter(Boolean).join(' · ') || record.id
}
export function validateFineResponse(values) {
  if (!RESOLUTIONS.includes(values.resolution)) return 'Choose a resolution.'
  if ((values.explanation || '').trim().length < 3) return 'Explain your request, including the proposed arrangement.'
  if (values.resolution === 'already_paid' && (values.payment_reference || '').trim().length < 3) return 'Enter your payment reference.'
  if (values.resolution === 'direct_payment' && !values.proposed_date) return 'Choose your proposed payment date.'
  if (!values.acknowledged || !values.signature) return 'Review the statement and sign before submitting.'
  return null
}

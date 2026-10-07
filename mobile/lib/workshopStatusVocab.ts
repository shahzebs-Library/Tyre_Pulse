/**
 * Workshop Status controlled vocabularies - MOBILE MIRROR.
 *
 * SOURCE OF TRUTH: src/lib/workshopStatus/vocab.js (web). The database stores
 * these as plain English text and the update RPC refuses anything off-list, so
 * the phone must offer exactly the same values. __tests__/workshopStatusVocab
 * .test.ts parses the web file and FAILS on any drift - CHANGE BOTH TOGETHER.
 *
 * The stored value is always the English label below; screens translate it for
 * display only via `vocabKey` (modules.workshopStatus.<list>.<key>).
 */

export const CURRENT_STAGES: readonly string[] = Object.freeze([
  'Newly Reported',
  'Waiting for Diagnosis',
  'Diagnosis in Progress',
  'Repair in Progress',
  'Waiting',
  'Waiting for Parts',
  'Waiting for Approval',
  'Waiting for Manpower',
  'Waiting for External Vendor',
  'External Repair',
  'Testing',
  'Road Test',
  'QC / Inspection',
  'Ready for Release',
  'Operational Hold',
  'Removed From Current Report',
])

/** Stage set by the upload process when a vehicle leaves the daily file. The
 * owner's word for it is "Released" - never "removed" - so it is displayed as
 * Released and is never offered in the picker. */
export const RELEASED_STAGE = 'Removed From Current Report'

/** Stages a person may pick in the update form. */
export const SELECTABLE_STAGES: readonly string[] = Object.freeze(
  CURRENT_STAGES.filter((s) => s !== RELEASED_STAGE),
)

export const DELAY_REASONS: readonly string[] = Object.freeze([
  'Waiting for Spare Parts',
  'Spare Parts Not Available',
  'MR Pending',
  'PO Pending',
  'Supplier Delivery Pending',
  'Waiting for Manpower',
  'Technician Not Available',
  'Specialist Technician Required',
  'Waiting for Workshop Bay',
  'Waiting for Tools / Equipment',
  'Waiting for External Vendor',
  'Sent to External Workshop',
  'Waiting for Diagnosis',
  'Repair in Progress',
  'Waiting for Approval',
  'Waiting for Budget Approval',
  'Waiting for Vehicle Recovery / Towing',
  'Waiting for Site to Release Vehicle',
  'Waiting for Testing',
  'Waiting for Road Test',
  'Waiting for QC / Inspection',
  'Accident Repair',
  'Warranty Claim',
  'Major Engine Repair',
  'Major Gearbox Repair',
  'Electrical Issue',
  'Hydraulic Issue',
  'Tyre Related',
  'Body Repair',
  'No Operator / Driver',
  'Operational Hold',
  'Other',
])

export const DELAY_REASON_OTHER = 'Other'

export const PARTS_STATUSES: readonly string[] = Object.freeze([
  'Not Required',
  'Required',
  'Checking Store',
  'Available in Store',
  'MR Pending',
  'MR Raised',
  'MR Approved',
  'PO Pending',
  'PO Issued',
  'Supplier Confirmed',
  'In Transit',
  'Partially Received',
  'Received',
  'Not Available',
  'Alternative Part Under Review',
])

/** True when a delay reason needs a written detailed reason. */
export function needsDetailedReason(delayReason: string | null | undefined): boolean {
  return String(delayReason || '').trim() === DELAY_REASON_OTHER
}

/** Stable locale key for a vocabulary value: "QC / Inspection" -> "qc_inspection". */
export function vocabKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

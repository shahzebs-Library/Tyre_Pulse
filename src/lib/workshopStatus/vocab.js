/**
 * Workshop Status controlled vocabularies (spec sections 9, 10, 12).
 *
 * The ONE source for stage, delay reason and parts status values. The
 * database stores these as plain text (no CHECK), so the value saved is the
 * English label below and every screen, filter, export and report must read
 * these lists rather than redeclaring them.
 */

export const CURRENT_STAGES = Object.freeze([
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

/** Stages a person may pick in the update form. "Removed From Current Report"
 * is set by the upload process only (a released vehicle), never by hand. */
export const SELECTABLE_STAGES = Object.freeze(
  CURRENT_STAGES.filter((s) => s !== 'Removed From Current Report'),
)

export const DELAY_REASONS = Object.freeze([
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

export const PARTS_STATUSES = Object.freeze([
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

/** True when a delay reason needs a written detailed reason (spec section 10). */
export function needsDetailedReason(delayReason) {
  return String(delayReason || '').trim() === DELAY_REASON_OTHER
}

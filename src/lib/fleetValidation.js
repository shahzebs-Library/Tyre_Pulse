/**
 * fleetValidation.js - the "Fleet Validation" case tab checklist. Pure, no I/O.
 *
 * There is no dedicated fleet-validation-checklist table in the schema (the
 * workstream itself is one row of accident_case_workstreams, same as every
 * other workstream - see accidentCase.js WORKSTREAMS). So every item here is
 * DERIVED from a real, already-recorded fact on the incident + fleet-register
 * rows, never a fabricated tick a person can silently check without evidence.
 * The workstream's own status (not_started -> ... -> completed) is what a
 * Fleet Supervisor actually progresses once they have reviewed these facts -
 * that write goes through the EXISTING accidentCase.setWorkstreamStatus, not
 * through this file.
 */

export const VALIDATION_ITEMS = [
  { key: 'asset_registered', label: 'Asset found in the fleet register' },
  { key: 'driver_recorded', label: 'Driver recorded' },
  { key: 'site_recorded', label: 'Site recorded' },
  { key: 'incident_date_recorded', label: 'Incident date recorded' },
  { key: 'location_captured', label: 'GPS location captured' },
  { key: 'photos_attached', label: 'Photos attached' },
  { key: 'authority_report_on_file', label: 'A police / Najm / Taqdeer report is on file' },
  { key: 'vehicle_type_matches', label: 'Vehicle type matches the fleet register' },
]

function present(v) {
  return v != null && String(v).trim() !== ''
}

/**
 * @param {{acc?:object, asset?:object|null, authorityReports?:object[]}} p
 * @returns {{key:string, label:string, passed:boolean, detail:string}[]}
 */
export function buildValidationChecklist({ acc = {}, asset = null, authorityReports = [] } = {}) {
  const photos = Array.isArray(acc.photos) ? acc.photos.filter(Boolean) : []
  const hasGps = present(acc.latitude) && present(acc.longitude)
  const reportOnFile = authorityReports.some((r) => r?.report_status === 'available')
  const typeMatches = !asset || !present(acc.vehicle_type) || !present(asset.vehicle_type)
    || String(acc.vehicle_type).trim().toLowerCase() === String(asset.vehicle_type).trim().toLowerCase()

  return [
    {
      key: 'asset_registered', label: VALIDATION_ITEMS[0].label, passed: !!asset,
      detail: asset ? `${asset.asset_no}${asset.fleet_number ? ` (${asset.fleet_number})` : ''}` : 'No matching asset in the fleet register.',
    },
    { key: 'driver_recorded', label: VALIDATION_ITEMS[1].label, passed: present(acc.driver_name), detail: acc.driver_name || 'Not recorded.' },
    { key: 'site_recorded', label: VALIDATION_ITEMS[2].label, passed: present(acc.site), detail: acc.site || 'Not recorded.' },
    {
      key: 'incident_date_recorded', label: VALIDATION_ITEMS[3].label, passed: present(acc.incident_date),
      detail: acc.incident_date ? new Date(acc.incident_date).toLocaleDateString() : 'Not recorded.',
    },
    { key: 'location_captured', label: VALIDATION_ITEMS[4].label, passed: hasGps, detail: hasGps ? `${acc.latitude}, ${acc.longitude}` : 'No GPS reading on the report.' },
    { key: 'photos_attached', label: VALIDATION_ITEMS[5].label, passed: photos.length > 0, detail: photos.length ? `${photos.length} attached` : 'No photos attached.' },
    {
      key: 'authority_report_on_file', label: VALIDATION_ITEMS[6].label, passed: reportOnFile,
      detail: reportOnFile ? 'Received' : (authorityReports.length ? 'Pending / missing' : 'Not yet checked - see Responsibility & Payment'),
    },
    {
      key: 'vehicle_type_matches', label: VALIDATION_ITEMS[7].label, passed: typeMatches,
      detail: asset ? `Reported "${acc.vehicle_type || 'N/A'}" vs register "${asset.vehicle_type || 'N/A'}"` : 'No fleet record to compare against.',
    },
  ]
}

/** Summary counts for the checklist - never divides by zero. */
export function validationSummary(items) {
  const total = items.length
  const passed = items.filter((i) => i.passed).length
  return { total, passed, missing: total - passed, complete: total > 0 && passed === total }
}

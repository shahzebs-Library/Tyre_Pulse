/**
 * Report types the PDF cache knows, and the TEMPLATE VERSION of each generator.
 *
 * THE TEMPLATE VERSION IS PART OF THE CACHE KEY. When a generator's output changes
 * (layout, wording, a new section), bump its version here: every stored PDF made by
 * the old generator then stops being "current" and is regenerated on the next request,
 * while approved revisions stay stored as previous versions.
 *
 * src/test/pdfTemplateVersionPin.test.js hashes the generator source and fails when
 * the code changed and the version did not. Update both together.
 */
export const REPORT_TYPES = Object.freeze({
  INSPECTION: 'tyre_inspection',
  OBSERVATION: 'tyre_observation',
  CORRECTIVE_ACTION: 'corrective_action',
  JOB_CARD: 'maintenance_job_card',
})

export const TEMPLATE_VERSIONS = Object.freeze({
  tyre_inspection: 'ins-2026.11.1',
  tyre_observation: 'obs-1.0',
})

/** Plain names for messages and the bulk manifest. */
export const REPORT_LABELS = Object.freeze({
  tyre_inspection: 'Tyre inspection report',
  tyre_observation: 'Tyre observation report',
  corrective_action: 'Corrective action report',
  maintenance_job_card: 'Maintenance job card',
})

export function templateVersionFor(type) {
  const v = TEMPLATE_VERSIONS[type]
  if (!v) throw new Error('This report type is not set up for stored PDFs.')
  return v
}

import { normalizeTyreConditions, positionLabelMap } from './inspectionView'

// Keep stored slot IDs intact; only the report's labels use the mapped codes.
export function checklistPdfModel(inspection) {
  const source = {
    ...inspection,
    tyre_conditions: inspection.tyre_conditions ?? inspection.findings,
  }
  const labels = positionLabelMap(source)
  const rows = Object.entries(normalizeTyreConditions(source)).map(([slot, data]) => ({
    position: labels[slot] || slot,
    pressure: data.pressure,
    condition: data.condition,
    treadDepth: data.tread,
  }))
  return {
    rows,
    // The checklist does not collect tread today. Preserve historical readings
    // when present, without adding an unanswered column to new reports.
    includeTread: rows.some(row => row.treadDepth != null),
    inspectionDate: inspection.inspection_date || inspection.completed_date || inspection.scheduled_date || null,
  }
}

import { supabase } from './supabase'
import type { ChecklistHistoryRow, ChecklistTemplate } from './checklists'

/** Date-only values must not move to another day in the phone's timezone. */
export function checklistDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

/** Read only date answers for the already-authorized history rows, not photos/signatures. */
export async function loadChecklistHistoryDates(
  rows: ChecklistHistoryRow[], templates: Record<string, ChecklistTemplate | null>,
): Promise<ChecklistHistoryRow[]> {
  const dates = new Map<string, string | null>()
  for (const templateId of new Set(rows.map(row => row.template_id).filter(Boolean))) {
    if (!templateId) continue
    const fields = (templates[templateId]?.fields ?? []).filter(field => field.type === 'date')
    if (!fields.length) continue
    if (fields.some(field => !/^[a-zA-Z0-9_-]+$/.test(field.id))) {
      throw new Error('The checklist date field could not be read.')
    }
    const ids = rows.filter(row => row.template_id === templateId).map(row => row.id)
    const columns = ['id', ...fields.map((field, index) => `date_${index}:answers->>${field.id}`)].join(',')
    const { data, error } = await supabase.from('checklist_submissions')
      .select(columns).eq('template_id', templateId).in('id', ids).order('id')
    if (error) throw error
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const date = fields.map((_, index) => checklistDate(row[`date_${index}`])).find(Boolean) ?? null
      dates.set(String(row.id), date)
    }
  }
  return rows.map(row => ({ ...row, checklist_date: dates.get(row.id) ?? null }))
}

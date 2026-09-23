const calls: any[] = []
let result: any = { data: [], error: null }
jest.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const query: any = {}
  for (const op of ['select', 'eq', 'in', 'order']) query[op] = (...args: any[]) => { calls.push([table, op, ...args]); return query }
  query.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return query
} } }))
import { checklistDate, loadChecklistHistoryDates } from '../lib/checklistHistoryDates'
const rows: any[] = [{ id: 'old-sheet', template_id: 'workshop', submitted_at: '2026-09-12T10:00:00Z' }]
const templates: any = { workshop: { fields: [{ id: 'custom_date', type: 'date' }] } }
beforeEach(() => { calls.length = 0; result = { data: [], error: null } })
test('preserves an August checklist date separately from its September receipt', async () => {
  result.data = [{ id: 'old-sheet', date_0: '2026-08-23' }]
  expect(await loadChecklistHistoryDates(rows, templates)).toEqual([{ ...rows[0], checklist_date: '2026-08-23' }])
  expect(calls).toContainEqual(['checklist_submissions', 'select', 'id,date_0:answers->>custom_date'])
  expect(calls).toContainEqual(['checklist_submissions', 'in', 'id', ['old-sheet']])
  expect(calls).toContainEqual(['checklist_submissions', 'eq', 'template_id', 'workshop'])
})
test('never invents a checklist date when the template or answer is unavailable', async () => {
  expect((await loadChecklistHistoryDates(rows, {}))[0].checklist_date).toBeNull()
  expect(calls).toHaveLength(0)
})
test('rejects impossible dates and preserves valid leap days', () => {
  expect(checklistDate('2026-02-30')).toBeNull()
  expect(checklistDate('2024-02-29')).toBe('2024-02-29')
  expect(checklistDate('2026-08-23T23:00:00Z')).toBeNull()
})
test('surfaces failed date reads', async () => {
  result.error = new Error('offline')
  await expect(loadChecklistHistoryDates(rows, templates)).rejects.toThrow('offline')
})

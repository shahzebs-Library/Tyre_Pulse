import { describe, expect, it } from 'vitest'
import { validateAnswer, checklistReviewIssues } from '../lib/checklist/fieldTypes'
import { shapeRow, bandFor } from '../lib/tyreRunningLife'
import { detectAnomalies, computeVisitStats } from '../lib/anomalyEngine'
import { renderChecklistPdf } from '../lib/checklistPdf'
import { exportInspectionDetailPdf } from '../lib/exportUtils'
import fs from 'node:fs'
const printed = doc => Array.from(doc.output().matchAll(/\((.*?)\)\s*Tj/g)).map(m => m[1]).join('\n')
const fields = [
  { id: 'ident', type: 'section', label: 'Identification' },
  { id: 'hours', type: 'number', label: 'Hour meter reading' },
  { id: 'checks', type: 'section', label: 'Checks' },
  { id: 'guard', type: 'select', label: 'Safety guards', options: ['OK', 'Not OK'] },
  { id: 'signoff', type: 'section', label: 'Sign off' },
  { id: 'fit', type: 'select', label: 'Certifies that machine is fit for operation', options: ['Yes', 'No'] },
]
describe('attached report regressions', () => {
  it('rejects negative and nonfinite meter readings even on older templates without min', () => {
    expect(validateAnswer(fields[1], -3)).toContain('negative')
    expect(validateAnswer(fields[1], Infinity)).toContain('number')
    expect(validateAnswer(fields[1], 0)).toBeNull()
    expect(validateAnswer({ type: 'number', label: 'Temperature' }, -3)).toBeNull()
  })
  it('flags contradictory fitness certification without overwriting recorded answers', () => {
    const answers = { guard: 'Not OK', fit: 'Yes' }
    expect(checklistReviewIssues(fields, answers)[0]).toContain('conflicts')
    expect(answers.fit).toBe('Yes')
    expect(checklistReviewIssues(fields, { guard: 'OK', fit: 'Yes' })).toEqual([])
  })
  it('does not call a short-life tyre due at 34 percent used', () => {
    expect(bandFor({ remainingKm: 5865, expectedLifeKm: 8883, lifeUsedPct: 34 })).toBe('healthy')
    expect(bandFor({ remainingKm: 600, expectedLifeKm: 8883, lifeUsedPct: 93 })).toBe('due-soon')
    expect(bandFor({ remainingKm: -1, expectedLifeKm: 8883, lifeUsedPct: 101 })).toBe('overdue')
  })
  it('does not print zero remaining days without a days baseline', () => {
    expect(shapeRow({ expected_days: null, remaining_days: 0 }).remainingDays).toBeNull()
    expect(shapeRow({ expected_days: 300, remaining_days: 0 }).remainingDays).toBe(0)
  })
  it('does not combine identical asset numbers across countries into recurrence alerts', () => {
    const rows = ['KSA', 'UAE'].map((country, id) => ({ id, country, asset_no: 'TM1', issue_date: '2026-09-01', cost_per_tyre: 100 }))
    expect(detectAnomalies(rows)).toEqual([])
    expect(computeVisitStats(rows)).toHaveLength(2)
  })
  it('uses numeric cost values and the source country currency for outliers', () => {
    const rows = Array.from({ length: 30 }, (_, id) => ({ id, country: 'UAE', cost_per_tyre: id === 29 ? '10000' : '100' }))
    const spike = detectAnomalies(rows).find(a => a.type === 'COST_SPIKE')
    expect(spike.message).toContain('AED')
    expect(spike.message).not.toContain('SAR')
  })
  it('prints historical contradictions explicitly and preserves the entered meter', async () => {
    const { doc } = await renderChecklistPdf({ template: { name: 'Checklist validation example', fields }, submission: {
      asset_no: 'TEST-ASSET', answers: { hours: -3, guard: 'Not OK', fit: 'Yes' },
    }, branding: { logo_url: null }, save: false })
    const text = printed(doc)
    expect(text).toContain('Record requires review')
    expect(text).toContain('Fitness certification conflicts')
    expect(text).toContain('-3')
    fs.mkdirSync('audit/checklist-report-review', { recursive: true })
    fs.writeFileSync('audit/checklist-report-review/validation-checklist.pdf', Buffer.from(doc.output('arraybuffer')))
  })
  it('keeps an unanswered checklist visibly incomplete', async () => {
    const { doc } = await renderChecklistPdf({ template: { name: 'Example', fields }, submission: { answers: {} }, save: false })
    const text = printed(doc)
    expect(text).toContain('Some checks were not recorded')
    expect(text).not.toContain('Every check on this sheet was recorded OK')
  })
  it('separates fleet estimates, unknown days and unmapped positions in the inspection PDF', async () => {
    const doc = await exportInspectionDetailPdf({ id: 'validation', title: 'Validation example', vehicle_type: 'WHEEL_LOADER', asset_no: 'TEST-ASSET',
      tyre_conditions: { invalid_slot: { condition: 'Good', pressure: 80 } }, approval_status: 'approved', approved_by: '11111111-2222-4333-8444-555555555555',
    }, { save: false, lifeRows: [shapeRow({ expected_life_km: 8883, remaining_km: 5865, life_used_pct: 34, remaining_days: 0 })] })
    const text = printed(doc)
    expect(text).toContain('Latest fleet estimates at export time')
    expect(text).toContain('Position data requires review')
    expect(text).not.toContain('Approaching end of life')
    expect(text).not.toContain('11111111-2222-4333-8444-555555555555')
    fs.writeFileSync('audit/checklist-report-review/validation-inspection.pdf', Buffer.from(doc.output('arraybuffer')))
  })
})

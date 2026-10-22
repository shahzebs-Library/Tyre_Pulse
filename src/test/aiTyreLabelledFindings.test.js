import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(async () => ({ data: [{ job_id: 'j1' }], error: null })) },
}))
const { supabase } = await import('../lib/supabase')
const { getAiLabelledFindings } = await import('../lib/api/aiTyreInspection')
const {
  shapeLabelledFindings, labelledSummary, labelledExportRows, labelledJsonl, LABELLED_EXPORT_COLUMNS, LABEL_VALUES,
} = await import('../lib/aiTyreReviewFeedback')

const RAW = [
  { job_id: 'a', inspection_id: 'i1', asset_no: 'TM1', tyre_position: 'R1Lo', model_version: 'claude-haiku-5-5', prompt_version: 'tyre-photo-v1',
    review_status: 'accepted', reviewer_note: '', reviewed_at: '2026-10-22T10:00:00Z', assessable: true, recommendation: 'monitor',
    defects: [{ type: 'sidewall_cut', severity: 'moderate' }], photo_ref: 'tp-storage://p/a.jpg', cost_usd: '0.0009' },
  { job_id: 'b', inspection_id: 'i2', asset_no: null, tyre_position: null, model_version: null, prompt_version: null,
    review_status: 'rejected', reviewer_note: ' dust, not a cut ', reviewed_at: null, assessable: null, recommendation: null,
    defects: null, photo_ref: null, cost_usd: null },
  { job_id: 'c', review_status: 'corrected', defects: [{ type: 'bulge' }, { type: 'uneven_wear' }] },
  { job_id: 'd', review_status: 'unreviewed' },
]

describe('labelled findings pipeline (evaluation only)', () => {
  it('keeps only reviewer-labelled rows and normalises missing values', () => {
    const rows = shapeLabelledFindings(RAW)
    expect(rows.map(r => r.jobId)).toEqual(['a', 'b', 'c'])
    expect(rows[1]).toMatchObject({ model: 'unknown', prompt: 'unversioned', asset: '', reviewerNote: 'dust, not a cut', assessable: null, costUsd: null, defects: [] })
    expect(rows[0].costUsd).toBeCloseTo(0.0009)
    expect(LABEL_VALUES).toEqual(['accepted', 'rejected', 'corrected'])
  })

  it('summary exposes weak teaching signal (rejected or corrected without a note)', () => {
    const s = labelledSummary(shapeLabelledFindings(RAW))
    expect(s).toEqual({ total: 3, accepted: 1, rejected: 1, corrected: 1, withNote: 1, negativeWithoutNote: 1 })
    expect(labelledSummary([])).toMatchObject({ total: 0, negativeWithoutNote: 0 })
  })

  it('Excel rows carry every column with N/A for blanks and a readable defect list', () => {
    const rows = labelledExportRows(shapeLabelledFindings(RAW))
    expect(Object.keys(rows[0])).toEqual(LABELLED_EXPORT_COLUMNS.map(([k]) => k))
    expect(rows[0].defectTypesText).toBe('sidewall_cut')
    expect(rows[1].defectTypesText).toBe('None')
    expect(rows[1].asset).toBe('N/A')
    expect(rows[2].defectTypesText).toBe('bulge, uneven_wear')
  })

  it('JSONL is one valid JSON object per line with stable keys and no empty-string noise', () => {
    const lines = labelledJsonl(shapeLabelledFindings(RAW)).split('\n')
    expect(lines).toHaveLength(3)
    const first = JSON.parse(lines[0])
    expect(first).toMatchObject({ job_id: 'a', label: 'accepted', prompt_version: 'tyre-photo-v1', ai_defects: [{ type: 'sidewall_cut', severity: 'moderate' }] })
    expect(first.reviewer_note).toBeNull()
    expect(JSON.parse(lines[1])).toMatchObject({ label: 'rejected', reviewer_note: 'dust, not a cut', ai_recommendation: null })
    expect(labelledJsonl([])).toBe('')
  })

  it('calls the INVOKER rpc with validated dates and a clamped limit', async () => {
    await getAiLabelledFindings({ from: '2026-10-01', to: 'bad', limit: 999999 })
    expect(supabase.rpc).toHaveBeenCalledWith('get_ai_tyre_labelled_findings', { p_from: '2026-10-01', p_to: null, p_limit: 20000 })
  })

  it('the export never claims to train a model', () => {
    const src = labelledJsonl.toString() + shapeLabelledFindings.toString()
    expect(src).not.toMatch(/retrain|fine-?tun/i)
  })
})

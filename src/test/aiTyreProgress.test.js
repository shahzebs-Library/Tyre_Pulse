import { describe, it, expect } from 'vitest'
import { shapeAiTyreProgress } from '../lib/aiTyreProgress'

const j = (...s) => s.map((status) => ({ status }))

describe('shapeAiTyreProgress', () => {
  it('empty / invalid input has no label', () => {
    expect(shapeAiTyreProgress([])).toMatchObject({ total: 0, label: '', active: false })
    expect(shapeAiTyreProgress(null).total).toBe(0)
  })
  it('in progress counts done and pending', () => {
    const p = shapeAiTyreProgress(j(...Array(5).fill('completed'), 'processing', ...Array(7).fill('pending')))
    expect(p).toMatchObject({ total: 13, done: 5, pending: 8, failed: 0, active: true, label: 'AI analysing 5 of 13' })
  })
  it('review_required counts as done', () => {
    expect(shapeAiTyreProgress(j('review_required', 'pending')).done).toBe(1)
  })
  it('finished with failures', () => {
    const p = shapeAiTyreProgress(j('completed', 'completed', 'failed'))
    expect(p).toMatchObject({ active: false, failed: 1, label: 'AI analysed 2 of 3, 1 failed' })
  })
  it('all complete', () => {
    expect(shapeAiTyreProgress(j('completed', 'completed')).label).toBe('AI analysis complete (2)')
  })
  it('unknown status only counts toward total', () => {
    expect(shapeAiTyreProgress(j('weird'))).toMatchObject({ total: 1, done: 0, pending: 0, failed: 0 })
  })
})

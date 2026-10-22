import { describe, it, expect } from 'vitest'
import { summarizeInspectionAiCosts } from './api/aiTyreInspection'

describe('AI tyre inspection provider usage accounting', () => {
  it('adds image costs belonging to one inspection', () => {
    expect(summarizeInspectionAiCosts([
      { inspection_id:'one',cost_usd:'0.0025',input_tokens:1000,output_tokens:200 },
      { inspection_id:'one',cost_usd:'0.0015',input_tokens:500,output_tokens:100 },
    ])).toEqual([{inspectionId:'one',images:2,priced:2,unpriced:0,costUsd:0.004,inputTokens:1500,outputTokens:300}])
  })
  it('keeps unpriced jobs distinct from genuinely free requests', () => {
    const [record]=summarizeInspectionAiCosts([
      {inspection_id:'one',cost_usd:null,input_tokens:0,output_tokens:0},
    ])
    expect(record.costUsd).toBe(0)
    expect(record.priced).toBe(0)
    expect(record.unpriced).toBe(1)
  })
  it('keeps organisation-scoped inspection totals separate', () => {
    const result=summarizeInspectionAiCosts([
      {inspection_id:'one',cost_usd:0.1},
      {inspection_id:'two',cost_usd:0.2},
    ])
    expect(result).toHaveLength(2)
    expect(result.find(x=>x.inspectionId==='two').costUsd).toBe(0.2)
  })
  it('handles empty data', () => {
    expect(summarizeInspectionAiCosts(null)).toEqual([])
  })
})

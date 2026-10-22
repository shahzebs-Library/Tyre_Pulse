import {describe,it,expect} from 'vitest'
import {verifiedDeliveryMetrics,assignmentStatusSeries,workforceBoardKpis} from '../lib/workforceAnalytics'
describe('workforce metrics are fair',()=>{
 it('does not turn unverified or pending tasks into lost productivity',()=>{
  const m=verifiedDeliveryMetrics([{status:'assigned'},{status:'blocked'},{status:'submitted'}])
  expect(m.assessed_count).toBe(0);expect(m.verified_completion_pct).toBeNull();expect(m.performance_score).toBeNull()
 })
 it('counts verified work without inferring productivity',()=>{
  expect(verifiedDeliveryMetrics([{status:'verified'},{status:'cancelled'}]).verified_completion_pct).toBe(50)
 })
 it('counts statuses without synthetic employees',()=>{
  expect(assignmentStatusSeries([{status:'blocked'}]).find(x=>x.status==='blocked').count).toBe(1)
  expect(workforceBoardKpis([{status:'blocked'}],[{status:'submitted'}]).reports_pending).toBe(1)
 })
})

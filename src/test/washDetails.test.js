import { describe, it, expect } from 'vitest'
import { emptyWashDetails, validateWashDetails, staffWashActivity } from '../lib/washDetails'
import { filterWashes } from '../lib/washAnalytics'

describe('wash evidence and staff activity', () => {
  it('never prechecks a checklist or invents chemical use', () => {
    const d=emptyWashDetails()
    expect(d.checklist.every(c=>c.result==='not_checked')).toBe(true)
    expect(d.chemical_status).toBe('not_recorded')
    expect(validateWashDetails(d)).toBe(d)
    expect(()=>validateWashDetails({...d,chemical_status:'used'})).toThrow('product')
    expect(()=>validateWashDetails({...d,checklist:[{label:'Cab',result:'fail'}]})).toThrow('Describe')
  })
  it('keeps creators distinct despite matching names and deduplicates record IDs', () => {
    const rows=[{id:'1',created_by:'u1',entry_name:'Same',asset_no:'A',status:'Completed'},{id:'2',created_by:'u2',entry_name:'Same',asset_no:'A',status:'Scheduled'}]
    const counts=staffWashActivity([...rows,rows[0]])
    expect(counts).toHaveLength(2)
    expect(counts[0].entries).toBe(1)
    expect(counts.reduce((n,r)=>n+r.completed,0)).toBe(1)
  })
  it('combines person, receipt date, evidence and location filters', () => {
    const row={id:'1',created_by:'u1',wash_date:'2026-08-01',created_at:'2026-09-01T10:00:00Z',country:'KSA',region:'North',photos:['photo'],wash_details:{chemical_status:'none',checklist:[{result:'fail'}]}}
    const filters={dateBasis:'received',from:'2026-09-01',to:'2026-09-01',enteredBy:'u1',country:'KSA',region:'North',photos:'yes',chemicals:'none',checklist:'issues'}
    expect(filterWashes([row],filters)).toEqual([row])
    expect(filterWashes([row],{...filters,dateBasis:'wash'})).toEqual([])
    expect(filterWashes([row],{...filters,enteredBy:'u2'})).toEqual([])
  })
})

import { beforeEach, it, expect, vi } from 'vitest'
const h=vi.hoisted(()=>({from:vi.fn(),results:[],queries:[]}))
vi.mock('../lib/supabase',()=>({supabase:{from:h.from}}))
import { getMaterialIssueCoverage, listSlipsFromConsumption } from '../lib/api/materialIssue'
beforeEach(()=>{
 h.results=[];h.queries=[];h.from.mockReset().mockImplementation(table=>{
  const result=h.results.shift() || {data:[],error:null}
  const q={table,steps:[],then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)}
  for(const name of ['select','not','order','limit','eq','is','gte','lte','range','or'])q[name]=(...args)=>{q.steps.push([name,...args]);return q}
  h.queries.push(q);return q
 })
})
it('reads complete scoped history boundaries with two one-row queries, without a date or tyre filter',async()=>{
 h.results=[{data:[{event_date:'2018-09-22'}]},{data:[{event_date:'2026-10-17'}]}]
 expect(await getMaterialIssueCoverage({country:'KSA'})).toEqual({first:'2018-09-22',last:'2026-10-17'})
 for(const q of h.queries){expect(q.table).toBe('parts_consumption');expect(q.steps).toContainEqual(['eq','country','KSA']);expect(q.steps).toContainEqual(['limit',1]);expect(q.steps).not.toContainEqual(expect.arrayContaining(['gte']));expect(q.steps.some(s=>JSON.stringify(s).includes('tyre'))).toBe(false)}
 expect(h.queries[0].steps).toContainEqual(['order','event_date',{ascending:true}])
 expect(h.queries[1].steps).toContainEqual(['order','event_date',{ascending:false}])
})
it('keeps unavailable history distinct from an empty history',async()=>{
 h.results=[{error:{code:'42501',message:'permission denied'}},{data:[]}]
 await expect(getMaterialIssueCoverage({country:'KSA'})).rejects.toMatchObject({code:'42501'})
 expect(await getMaterialIssueCoverage({country:'UAE'})).toEqual({first:null,last:null})
})
it('reads all material categories and source details within a selected historical year',async()=>{
 h.results=[{data:[{id:'a',issue_number:'GC/MIS/2018/1',country:'KSA',event_date:'2018-10-01',item_description:'Oil filter',qty:2,source_system:'ERP grid import',source_row:'480'}]},{count:0}]
 const r=await listSlipsFromConsumption({country:'KSA',from:'2018-01-01',to:'2018-12-31',max:100})
 expect(r.lines[0].item_description).toBe('Oil filter');expect(r.lines[0].source_row).toBe('480')
 expect(h.queries[0].steps).toContainEqual(['gte','event_date','2018-01-01'])
 expect(h.queries[0].steps).toContainEqual(['lte','event_date','2018-12-31'])
 expect(h.queries[0].steps.find(s=>s[0]==='select')[1]).toContain('source_system')
})
it('applies site, store and text search in the database query',async()=>{
 h.results=[{data:[]},{count:0}]
 await listSlipsFromConsumption({country:'KSA',from:'2026-01-01',to:'2026-12-31',site:'Riyadh',store:'Central',search:'MIS-22',max:100})
 expect(h.queries[0].steps).toContainEqual(['eq','site','Riyadh'])
 expect(h.queries[0].steps).toContainEqual(['eq','store_code','Central'])
 expect(h.queries[0].steps.find(s=>s[0]==='or')?.[1]).toContain('issue_number.ilike.%MIS-22%')
 expect(h.queries[1].steps).toContainEqual(['eq','store_code','Central'])
})

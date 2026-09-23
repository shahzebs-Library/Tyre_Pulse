import { beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({responses:[],calls:[]}))
vi.mock('../lib/api/_client',()=>({supabase:{from:(table)=>{
 state.calls.push(['from',table])
 const query={then:(resolve,reject)=>Promise.resolve(state.responses.shift()).then(resolve,reject)}
 for(const method of ['select','order','gte','lt','lte','eq','range']) query[method]=(...args)=>{state.calls.push([method,...args]);return query}
 return query
}}}))
import { readAuditExport } from '../lib/api/auditTrail'
beforeEach(()=>{state.responses=[];state.calls=[]})
describe('complete filtered audit exports',()=>{
 it('applies all displayed filters, fractional last day and deterministic order',async()=>{
  state.responses=[{data:[{id:'a',action:'UPDATE',table_name:'tyre_records'},{id:'b',action:'UPDATE',table_name:'stock_records'}],count:2}]
  const rows=await readAuditExport({filters:{dateFrom:'2026-09-01',dateTo:'2026-09-10',action:'UPDATE',user:'user'},search:'tyre'})
  expect(rows.map(r=>r.id)).toEqual(['a'])
  expect(state.calls).toContainEqual(['gte','created_at','2026-09-01'])
  expect(state.calls).toContainEqual(['lt','created_at','2026-09-11T00:00:00.000Z'])
  expect(state.calls).toContainEqual(['eq','action','UPDATE'])
  expect(state.calls).toContainEqual(['eq','user_id','user'])
  expect(state.calls).toContainEqual(['order','id',{ascending:false}])
 })
 it('pages upload history past the API response cap',async()=>{
  state.responses=[{data:Array.from({length:1000},(_,id)=>({id})),count:1001},{data:[{id:1000}],count:1001}]
  expect(await readAuditExport({upload:true})).toHaveLength(1001)
  expect(state.calls).toContainEqual(['range',1000,1999])
 })
 it('refuses oversized exports rather than downloading a capped file',async()=>{
  state.responses=[{data:[],count:5001}]
  await expect(readAuditExport()).rejects.toThrow('exceeds')
 })
 it('propagates failures and incomplete responses',async()=>{
  state.responses=[{data:[],error:{message:'denied'}}]
  await expect(readAuditExport()).rejects.toMatchObject({message:'denied'})
  state.responses=[{data:[],count:3}]
  await expect(readAuditExport()).rejects.toThrow('incomplete')
 })
 it('rejects a changing dataset between pages',async()=>{
  state.responses=[{data:Array(1000).fill({}),count:1001},{data:[],count:1000}]
  await expect(readAuditExport()).rejects.toThrow('changed')
 })
})

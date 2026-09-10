import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api/_client',()=>({supabase:{rpc},isMissingRelation:()=>false}))
import { importExpenseBatch } from '../lib/api/partsConsumption'
import { decidePendingUpload } from '../lib/api/pendingUploadDecisions'
const rows=Array.from({length:201},(_,i)=>({item_description:`Item ${i}`,value_amount:10,country:'KSA',organisation_id:'untrusted'}))
const options={country:'KSA',requestId:'request',replace:true,expectedCount:4}
beforeEach(()=>rpc.mockReset())
describe('expense atomic import',()=>{
 it('stages all rows before finalization and strips protected fields',async()=>{
  rpc.mockResolvedValue({data:{ok:true,inserted:201,skipped:0,failed:0}})
  await importExpenseBatch(rows,options)
  expect(rpc.mock.calls.map(c=>c[0])).toEqual(['begin_expense_import','stage_expense_import','stage_expense_import','commit_expense_import'])
  expect(rpc.mock.calls[0][1]).toMatchObject({p_country:'KSA',p_replace:true,p_expected_count:4,p_rows:201})
  expect(rpc.mock.calls[1][1].p_rows).toHaveLength(200)
  expect(rpc.mock.calls[2][1].p_rows).toHaveLength(1)
  expect(rpc.mock.calls[1][1].p_rows[0]).not.toHaveProperty('organisation_id')
 })
 it('does not commit after a staging error and allows retry of the same request',async()=>{
  rpc.mockResolvedValueOnce({data:{ok:true}}).mockResolvedValueOnce({error:{message:'offline'}})
  await expect(importExpenseBatch(rows,options)).rejects.toMatchObject({message:'offline'})
  expect(rpc).toHaveBeenCalledTimes(2)
  const receipt={ok:true,inserted:201,skipped:0,failed:0}
  rpc.mockResolvedValue({data:{ok:true,result:receipt}})
  expect(await importExpenseBatch(rows,options)).toEqual(receipt)
  expect(rpc.mock.calls.at(-1)[1].p_request_id).toBe('request')
 })
 it('requires explicit matching country before contacting backend',async()=>{
  await expect(importExpenseBatch(rows,{...options,country:'All'})).rejects.toThrow('Select one country')
  await expect(importExpenseBatch(rows,{...options,country:'UAE'})).rejects.toThrow('differs')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('refuses an unconfirmed response',async()=>{
  rpc.mockResolvedValue({data:{ok:false}})
  await expect(importExpenseBatch(rows,options)).rejects.toThrow('did not confirm')
 })
})
describe('legacy upload decisions',()=>{
 it('uses the atomic decision RPC without client destination writes',async()=>{
  rpc.mockResolvedValue({data:{ok:true,imported:9}})
  await decidePendingUpload('id',true)
  expect(rpc).toHaveBeenCalledWith('approve_pending_upload',{p_upload_id:'id'})
  await decidePendingUpload('id',false,'Invalid file')
  expect(rpc).toHaveBeenCalledWith('reject_pending_upload',{p_upload_id:'id',p_reason:'Invalid file'})
 })
 it('never treats an error or missing confirmation as success',async()=>{
  rpc.mockResolvedValueOnce({error:{message:'denied'}}).mockResolvedValueOnce({data:null})
  await expect(decidePendingUpload('id',true)).rejects.toMatchObject({message:'denied'})
  await expect(decidePendingUpload('id',true)).rejects.toThrow('did not confirm')
 })
})

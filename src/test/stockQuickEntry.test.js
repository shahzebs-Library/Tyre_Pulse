import { describe, it, expect } from 'vitest'
import { stockKind, stockUnit, stockDraft, entryErrors, entryPayload, existingStockOptions } from '../lib/stockQuickEntry'
describe('stock quick-entry item and quantity rules',()=>{
 it.each([['315/80R22.5 Triangle','tyre'],['22.5 x 8.25 wheel rim','rim'],['Tubeless tyre valve','accessory'],['Wheel nut','accessory'],['Wheel rim nut','accessory'],['Tyre inflator gauge','accessory'],['Tyre repair glue','accessory'],['Oil filter',null],['Hydraulic valve',null],['Tyre fitting service',null],['Engine oil',null]])('classifies %s as %s',(description,kind)=>expect(stockKind(description)).toBe(kind))
 it('defaults new items to New and PCS without copying a source issue quantity',()=>{
  const draft=stockDraft({key:'x',source:'dtr',qty:99,name:'Truck tyre',kind:'tyre'})
  expect(draft.quantity).toBe('');expect(draft.unit).toBe('PCS');expect(draft.condition).toBe('New');expect(stockUnit('EA')).toBe('PCS');expect(stockUnit('unknown')).toBe('')
 })
 it('preserves recorded existing stock and explicit units',()=>{
  expect(stockDraft({stock:{id:'s1',custom_data:{stock_item:{condition:'Retread',unit:'SET'}}},unit:'SET'})).toMatchObject({unit:'SET',condition:'Retread'})
  expect(stockDraft({stock:{id:'legacy'}})).toMatchObject({unit:'',condition:'Unspecified'})
 })
 it('allows an honest zero count but rejects blank, fractional and negative quantities',()=>{
  const row={key:'x',name:'Tyre',kind:'tyre',unit:'PCS',quantity:'0',bin:'',condition:'New'};const context={site:'A',country:'KSA',mode:'count',reference:''}
  expect(entryErrors([row],context)).toEqual([])
  for(const quantity of ['',1.5,-1])expect(entryErrors([{...row,quantity}],context).length).toBeGreaterThan(0)
  expect(entryErrors([row],{...context,mode:'receipt',reference:'GRN'}).length).toBeGreaterThan(0)
  expect(entryPayload([row])[0].quantity).toBe(0)
 })
 it('never identifies a different site record as the existing stock match',()=>{
  const records=[{id:'a',site:'A',description:'315/80R22.5 tyre',stock_qty:24},{id:'b',site:'B',description:'315/80R22.5 tyre',stock_qty:50}]
  expect(existingStockOptions(records,'A','315').map(r=>r.stock.id)).toEqual(['a'])
 })
})

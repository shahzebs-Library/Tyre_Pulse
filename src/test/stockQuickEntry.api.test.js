import { beforeEach, it, expect, vi } from 'vitest'
const h=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{rpc:h.rpc}}))
import { searchStockItems, saveStockEntry, transferStockEntry } from '../lib/api/stockQuickEntry'
beforeEach(()=>h.rpc.mockReset())
it('passes scoped search and its cancellation signal to the item-only lookup',async()=>{
 const abortSignal=vi.fn().mockResolvedValue({data:[{code:'TY-1'}],error:null});h.rpc.mockReturnValue({abortSignal});const signal=new AbortController().signal
 expect(await searchStockItems({country:'KSA',site:'A',query:'315',signal})).toEqual([{code:'TY-1'}])
 expect(h.rpc).toHaveBeenCalledWith('stock_item_suggestions',{p_country:'KSA',p_site:'A',p_query:'315'});expect(abortSignal).toHaveBeenCalledWith(signal)
})
it('posts one count batch with the stable request id and without another expense write',async()=>{
 h.rpc.mockResolvedValue({data:{status:'posted'},error:null});await saveStockEntry({requestId:'request',country:'KSA',site:'A',mode:'count',lines:[{quantity:36}]})
 expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc).toHaveBeenCalledWith('save_stock_entry',{p_request_id:'request',p_country:'KSA',p_site:'A',p_mode:'count',p_reference:'',p_notes:'',p_lines:[{quantity:36}]})
})
it('posts a transfer in one transaction with both expected balances',async()=>{
 h.rpc.mockResolvedValue({data:{status:'posted'},error:null});await transferStockEntry({requestId:'request',from:{id:'a',stock_qty:24},to:{id:'b',stock_qty:8},quantity:4})
 expect(h.rpc).toHaveBeenCalledWith('transfer_stock_entry',{p_request_id:'request',p_from:'a',p_to:'b',p_qty:4,p_expected_from:24,p_expected_to:8,p_notes:''})
})
it('states an approval lock without exposing raw database text',async()=>{
 h.rpc.mockResolvedValue({data:null,error:{code:'PT423',message:'internal workflow_instances details'}})
 await expect(saveStockEntry({lines:[]})).rejects.toThrow('An approval workflow protects this stock item.')
})

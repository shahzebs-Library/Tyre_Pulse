import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
const h=vi.hoisted(()=>({search:vi.fn(),save:vi.fn(),sites:vi.fn(),create:true,edit:true}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({profile:{id:'owner'},hasCapability:(_,cap)=>cap==='create'?h.create:h.edit})}))
vi.mock('../contexts/SettingsContext',()=>({useSettings:()=>({activeCountry:'KSA',workingContext:{site:'SITE-A'}})}))
vi.mock('../lib/api/sites',()=>({listSites:h.sites}))
vi.mock('../lib/api/stockQuickEntry',()=>({searchStockItems:h.search,saveStockEntry:h.save}))
import StockQuickEntry from '../components/stock/StockQuickEntry'
const record={id:'s1',site:'SITE-A',country:'KSA',description:'315/80 R22.5 Triangle tyre',stock_qty:24,updated_at:'2026-10-18T09:00:00Z',brand:'Triangle',tyre_size:'315/80 R22.5',custom_data:{stock_item:{code:'TY-01',kind:'tyre',unit:'PCS',condition:'New',bin:'A1'}}}
const mount=()=>{const saved=vi.fn();render(<StockQuickEntry records={[record]} onClose={vi.fn()} onSaved={saved}/>);return saved}
const search=async text=>{fireEvent.change(screen.getByRole('combobox',{name:'Type item code, size, brand or description'}),{target:{value:text}})}
const chooseExisting=async()=>{await search('315');fireEvent.keyDown(screen.getByRole('combobox',{name:'Type item code, size, brand or description'}),{key:'Enter'})}
beforeEach(()=>{h.create=true;h.edit=true;h.search.mockReset().mockResolvedValue([]);h.save.mockReset().mockResolvedValue({status:'posted',items:[{stock_id:'s1',qty_after:36}]});h.sites.mockReset().mockResolvedValue([{name:'SITE-A'},{name:'SITE-B'}])})
afterEach(cleanup)
describe('approved stock quick-entry workflow',()=>{
 it('fills an existing item by keyboard, previews the difference and posts the absolute physical count',async()=>{
  const saved=mount();await chooseExisting()
  expect(screen.getByLabelText(`Unit for ${record.description}`).value).toBe('PCS')
  const input=screen.getByRole('spinbutton',{name:`Physical count for ${record.description}`});expect(input.value).toBe('')
  fireEvent.change(input,{target:{value:'36'}});expect(screen.getByText('+12 PCS')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Review 1 item'}));expect(h.save).not.toHaveBeenCalled()
  const confirm=screen.getByRole('button',{name:'Confirm stock count'});expect(confirm.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(confirm)
  await waitFor(()=>expect(saved).toHaveBeenCalled())
  expect(h.save).toHaveBeenCalledWith(expect.objectContaining({country:'KSA',site:'SITE-A',mode:'count',lines:[expect.objectContaining({stock_id:'s1',expected_qty:24,quantity:36,unit:'PCS'})]}))
 })
 it('defaults DTR items to New and PCS but still requires a physical count',async()=>{
  h.search.mockResolvedValue([{key:'dtr:one',source:'dtr',source_id:'t1',name:'12.00 R24 tyre',brand:'Techking',size:'12.00 R24',kind:'tyre',qty:99,reference:'DTR-1'}])
  mount();await search('Techking');fireEvent.click(await screen.findByRole('button',{name:/12.00 R24 tyre/}))
  expect(screen.getByRole('spinbutton',{name:'Physical count for 12.00 R24 tyre'}).value).toBe('')
  fireEvent.click(screen.getByRole('button',{name:'Review 1 item'}));expect(screen.getByRole('alert').textContent).toMatch(/whole count/)
  expect(screen.getByLabelText('Unit for 12.00 R24 tyre').value).toBe('PCS');expect(screen.getByLabelText('Condition for 12.00 R24 tyre').value).toBe('New')
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'0'}})
  fireEvent.click(screen.getByRole('button',{name:'Review 1 item'}));expect(screen.getByRole('heading',{level:1}).textContent).toBe('Confirm current stock')
 })
 it('keeps receipts separate, requires one reference and reuses the same identifier after a network error',async()=>{
  h.save.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({status:'posted',items:[]})
  mount();await chooseExisting();fireEvent.click(screen.getByRole('button',{name:'New delivery'}));fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'12'}})
  fireEvent.click(screen.getByRole('button',{name:'Review 1 item'}));expect(screen.getByRole('alert').textContent).toMatch(/receipt or delivery reference/)
  fireEvent.change(screen.getByLabelText('Receipt / delivery reference *'),{target:{value:'GRN-1'}});fireEvent.click(screen.getByRole('button',{name:'Review 1 item'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save receipt'}))
  await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Save receipt'}));await waitFor(()=>expect(h.save).toHaveBeenCalledTimes(2))
  expect(h.save.mock.calls[1][0].requestId).toBe(h.save.mock.calls[0][0].requestId);expect(h.save.mock.calls[0][0]).toMatchObject({mode:'receipt',reference:'GRN-1',lines:[{quantity:12}]})
 })
 it('discards the entry and ignores late catalogue responses when the site changes',async()=>{
  let resolve;h.search.mockImplementation(()=>new Promise(r=>{resolve=r}))
  mount();await chooseExisting();await search('22.5');await waitFor(()=>expect(resolve).toBeTypeOf('function'))
  fireEvent.change(screen.getByLabelText('Site / store'),{target:{value:'SITE-B'}})
  resolve([{key:'wrong',source:'mis',source_id:'1',name:'Stale rim',kind:'rim'}])
  await waitFor(()=>expect(screen.queryByText('Stale rim')).toBeNull());expect(screen.queryByRole('spinbutton')).toBeNull()
 })
 it('does not offer catalogue creation or manual items to an edit-only account',async()=>{
  h.create=false;mount();await chooseExisting();expect(screen.queryByRole('button',{name:/Add manual item/})).toBeNull();expect(h.search).not.toHaveBeenCalled();expect(screen.getByRole('spinbutton')).toBeTruthy()
 })
 it('supports a manual rim without an invented ERP code and adds it to the same batch',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:/Cannot find it/}));fireEvent.change(screen.getByLabelText('Category'),{target:{value:'rim'}})
  fireEvent.change(screen.getByLabelText('Description *'),{target:{value:'22.5 x 8.25 steel rim'}});expect(screen.getByLabelText('Unit *').value).toBe('PCS')
  fireEvent.click(screen.getByRole('button',{name:'Add item to count'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('spinbutton',{name:'Physical count for 22.5 x 8.25 steel rim'})).toBeTruthy()
 })
})

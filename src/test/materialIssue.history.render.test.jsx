import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
const h=vi.hoisted(()=>({list:vi.fn(),coverage:vi.fn(),summary:vi.fn()}))
vi.mock('../contexts/SettingsContext',()=>({useSettings:()=>({activeCountry:'KSA'})}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({profile:{role:'Manager'}})}))
vi.mock('../components/charts/EChart',()=>({default:()=>null}))
vi.mock('../components/ui/EnterpriseTable',()=>({default:({data})=><div>{data.length} visible rows</div>}))
vi.mock('../lib/api/materialIssue',()=>({listSlipsFromConsumption:h.list,getMaterialIssueCoverage:h.coverage,getIssueSummary:h.summary,DEFAULT_LINE_MAX:60000,getSlipLines:vi.fn(),materialIssuesProvisioned:vi.fn(),listMaterialIssues:vi.fn(),createMaterialIssue:vi.fn(),listIssuableJobCards:vi.fn()}))
import { MemoryRouter } from 'react-router-dom'
import StoreMaterialIssue from '../pages/StoreMaterialIssue'
beforeEach(()=>{h.list.mockReset().mockResolvedValue({slips:[],truncated:false,unslipped:0});h.coverage.mockReset().mockResolvedValue({first:'2018-09-22',last:'2026-10-17'});h.summary.mockReset().mockResolvedValue({ok:false})})
afterEach(cleanup)
it('offers every imported document year and loads the selected year from the server',async()=>{
 render(<MemoryRouter><StoreMaterialIssue/></MemoryRouter>);await screen.findByText(/Imported issue dates: 2018-09-22/)
 expect(screen.getByRole('option',{name:'2018 · Uploaded issue records'})).toBeTruthy()
 fireEvent.change(screen.getByLabelText('History period'),{target:{value:'2018'}})
 await waitFor(()=>expect(h.list).toHaveBeenLastCalledWith(expect.objectContaining({country:'KSA',from:'2018-01-01',to:'2018-12-31'})))
 expect(screen.queryByText(/Original filenames were not retained/)).toBeNull()
})
it('allows retry of unavailable history without claiming the uploads are empty',async()=>{
 h.coverage.mockRejectedValueOnce(new Error('Unavailable'));render(<MemoryRouter><StoreMaterialIssue/></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'Retry history'}))
 await screen.findByText(/Imported issue dates: 2018-09-22/);expect(h.coverage).toHaveBeenCalledTimes(2)
})
it('ignores a late response from the previous history window',async()=>{
 let resolveOld;h.list.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve}))
 render(<MemoryRouter><StoreMaterialIssue/></MemoryRouter>);await screen.findByText(/Imported issue dates: 2018-09-22/)
 fireEvent.change(screen.getByLabelText('History period'),{target:{value:'2018'}})
 await waitFor(()=>expect(h.list).toHaveBeenCalledTimes(2))
 resolveOld({slips:[{key:'old'}],truncated:false,unslipped:0})
 await waitFor(()=>expect(screen.queryByText('1 visible rows')).toBeNull())
})

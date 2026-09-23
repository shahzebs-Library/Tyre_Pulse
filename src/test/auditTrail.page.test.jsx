import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({error:{message:'permission denied',code:'42501'}}))
vi.mock('../lib/supabase',()=>({supabase:{from:()=>{
 const q={then:(resolve,reject)=>Promise.resolve({data:null,count:null,error:state.error}).then(resolve,reject)}
 for(const m of ['select','order','range','gte','eq']) q[m]=()=>q
 return q
}}}))
vi.mock('../lib/api/auditTrail',()=>({auditQuery:()=>({range:async()=>({data:null,error:state.error})}),uploadHistoryQuery:()=>({range:async()=>({data:null,error:state.error})}),readAuditExport:vi.fn(),matchesAuditSearch:()=>true}))
vi.mock('../lib/fetchAll',()=>({fetchAllPages:async()=>({data:[],error:state.error})}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({profile:{role:'Admin'}})}))
vi.mock('../hooks/useReportMeta',()=>({useReportMeta:()=>({})}))
vi.mock('../components/ui/EnterpriseTable',()=>({default:({emptyMessage})=><div>{emptyMessage}</div>}))
vi.mock('../components/ui/PageHeader',()=>({default:()=>null}))
vi.mock('../lib/exportUtils',()=>({exportToExcel:vi.fn()}))
import AuditTrail from '../pages/AuditTrail'
it('failed database reads render errors and unavailable statistics without crashing or zero-success states',async()=>{
 render(<AuditTrail />)
 await waitFor(()=>expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
 expect(await screen.findByText('Audit events could not be loaded')).toBeInTheDocument()
 expect(screen.queryByText('No audit events found')).not.toBeInTheDocument()
 await waitFor(()=>expect(screen.getAllByText('Unavailable')).toHaveLength(4))
})

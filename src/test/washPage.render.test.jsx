import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { it, expect, vi } from 'vitest'
const h=vi.hoisted(()=>({rows:[
  {id:'wash-1',asset_no:'TEST-1',created_by:'person-1',entry_name:'First recorder',created_at:'2026-09-21T08:00:00Z',wash_date:'2026-09-21',status:'Completed',site:'Site A',wash_type:'Full',wash_details:{version:1,chemical_status:'none',chemicals:[],checklist:[{label:'Cab interior',result:'fail',note:'Dust remains'}]}},
  {id:'wash-2',asset_no:'TEST-2',created_by:'person-2',entry_name:'Second recorder',created_at:'2026-09-21T09:00:00Z',wash_date:'2026-09-21',status:'Scheduled',site:'Site B',wash_type:'Exterior'},
]}))
vi.mock('../contexts/SettingsContext',()=>({useSettings:()=>({activeCountry:'All',activeCurrency:'SAR'})}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({profile:{id:'person-1',role:'Admin',organisation_id:'org'},hasPermission:()=>true,isSuperAdmin:false})}))
vi.mock('../hooks/useReportMeta',()=>({useReportMeta:()=>({})}))
vi.mock('react-chartjs-2',()=>({Bar:()=>null,Line:()=>null,Doughnut:()=>null}))
vi.mock('../components/checklist/ReferencePicker',()=>({default:()=>null}))
vi.mock('../lib/api/washRecords',async importOriginal=>({...await importOriginal(),listWashRecords:vi.fn(async()=>h.rows),enrichWashPeople:vi.fn(async rows=>rows),washExportFleet:vi.fn(async()=>[]),listWashCorrections:vi.fn(async()=>[])}))
import VehicleWashing from '../pages/VehicleWashing'

it('opens staff drill-down and the saved checklist from the register',async()=>{
  render(<MemoryRouter><VehicleWashing/></MemoryRouter>)
  await waitFor(()=>expect(screen.getByRole('option',{name:'First recorder'})).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button',{name:'Staff activity'}))
  fireEvent.click(await screen.findByRole('button',{name:'First recorder'}))
  expect(screen.queryByRole('button',{name:'View wash TEST-2'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'View wash TEST-1'}))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('Dust remains')).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).getByText('No chemical used')).toBeInTheDocument()
})

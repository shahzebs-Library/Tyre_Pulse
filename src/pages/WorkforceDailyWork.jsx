import {useEffect,useMemo,useState,useCallback} from 'react'
import {Chart as ChartJS,CategoryScale,LinearScale,BarElement,Tooltip,Legend} from 'chart.js'
import {Bar} from 'react-chartjs-2'
import {ClipboardCheck,Clock,Plus,RefreshCw,CheckCircle2,AlertTriangle,Send} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {useAuth} from '../contexts/AuthContext'
import {useLanguage} from '../contexts/LanguageContext'
import {estimateWork} from '../lib/workforceIntelligence'
import {workforceBoardKpis,assignmentStatusSeries} from '../lib/workforceAnalytics'
import {employeeLabel,findAssignableEmployees} from '../lib/workforceEmployeeDirectory'
import {filterAssignments,ASSIGNMENT_STATUSES,ASSIGNMENT_PRIORITIES} from '../lib/workforceAssignmentFilter'
import {listWorkforceAssignments,listWorkforceAssignmentsPage,getBoardSummary,assignWork,listAssignableEmployees,transitionAssignment,listWorkDependencies,addWorkDependency,listWorkStandards,addWorkStandard,qualificationReasonText} from '../lib/api/workforceAssignments'
import AssigneeRecommendations from '../components/workforce/AssigneeRecommendations'
import AssignmentDetailDrawer from '../components/workforce/AssignmentDetailDrawer'
import EmployeeDirectoryPanel from '../components/workforce/EmployeeDirectoryPanel'
import TeamAnalyticsPanel from '../components/workforce/TeamAnalyticsPanel'
import {BLOCK_REASON_LABELS} from '../lib/workforceTransitions'
import AssignmentActions from '../components/workforce/AssignmentActions'
import EstimatePanel from '../components/workforce/EstimatePanel'
import {listWorkEvidence,uploadWorkEvidence,openWorkEvidence} from '../lib/api/workforceEvidence'
import {addDailyEntry,getMyDailyReport,getDailyReportForReview,ensureDailyReport,submitDailyReport,listReviewQueue,reviewDailyReport,correctDailyEntry,DAILY_ENTRY_CATEGORIES,DAILY_REASON_CATEGORIES} from '../lib/api/workforceDaily'
import {accountDay,categoryLabel} from '../lib/workforceTimeAccounting'
ChartJS.register(CategoryScale,LinearScale,BarElement,Tooltip,Legend)
const dateNow=()=>new Date().toLocaleDateString('en-CA')
const categories=DAILY_ENTRY_CATEGORIES||['productive','coordination','reporting','training','break','blocked','unassigned']
const reasonCats=DAILY_REASON_CATEGORIES||['blocked']
const catLabel=c=>(typeof categoryLabel==='function'?categoryLabel(c):String(c).replace('_',' '))
// A datetime-local value is wall-clock time in the browser's zone; never slice a UTC string into one.
const toLocalInput=v=>{const d=new Date(v);if(!v||Number.isNaN(d.getTime()))return '';const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`}
const newKey=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`fix-${Date.now()}-${Math.random().toString(36).slice(2,10)}`
const cleanDate=s=>String(s||'').slice(0,10)
const dtForLocal=v=>v?new Date(v).toLocaleString(): 'N/A'
function Tile({label,value,Icon}) {return <div className="card"><div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{label}</span><Icon size={17} className="text-[var(--accent)]"/></div><div className="text-3xl font-bold mt-2 tabular-nums">{value}</div></div>}
export default function WorkforceDailyWork(){
 const {profile}=useAuth()
 const {t}=useLanguage()
 const isManager=['Admin','Manager','Director','Super Admin'].includes(profile?.role)||profile?.is_super_admin
 const [date,setDate]=useState(dateNow)
 const [record,setRecord]=useState({report:null,entries:[]})
 const [queue,setQueue]=useState([])
 const [work,setWork]=useState([]),[employees,setEmployees]=useState([])
 const [employeeSearch,setEmployeeSearch]=useState(''),[designationFilter,setDesignationFilter]=useState('all')
 const [evidence,setEvidence]=useState([])
 const [dependencies,setDependencies]=useState([]),[standards,setStandards]=useState([])
 const [dependencyForm,setDependencyForm]=useState({predecessor_id:'',successor_id:''})
 const [standardForm,setStandardForm]=useState({work_type:'',minutes_per_unit:'30',role_name:''})
 const [boardView,setBoardView]=useState('table')
 const [boardSearch,setBoardSearch]=useState(''),[boardStatus,setBoardStatus]=useState('all'),[boardPriority,setBoardPriority]=useState('all')
 const [reviewDetail,setReviewDetail]=useState(null)
 const [reviewEvidence,setReviewEvidence]=useState([])
 const emptyWork={title:'',assigned_to:'',site:'',priority:'normal',due_at:'',instructions:'',task_type:'',vehicle_type:'',estimated_minutes:'',asset_no:'',tyre_serial:'',tyre_position:'',override_reason:'',supporting_employee_ids:[]}
 const [picked,setPicked]=useState(null)
 const [summaryKpi,setSummaryKpi]=useState(null),[summaryError,setSummaryError]=useState('')
 const [workTotal,setWorkTotal]=useState(0),[workPage,setWorkPage]=useState(0),[loadingMore,setLoadingMore]=useState(false)
 const [detailId,setDetailId]=useState(null)
 const [newWork,setNewWork]=useState(emptyWork)
 const [tab,setTab]=useState('my-day')
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [summary,setSummary]=useState(''),[nextActions,setNextActions]=useState('')
 const [form,setForm]=useState({title:'',details:'',deliverable:'',category:'productive',started_at:'',ended_at:'',blocked_reason:'',assignment_id:''})
 const [fix,setFix]=useState(null)
 const [showForm,setShowForm]=useState(false)
 const [est,setEst]=useState({qty:'1',standard:'30',complexity:'1',delay:'0',actual:'45'})
 const estimate=useMemo(()=>{try{return estimateWork({quantity:Number(est.qty),standard_minutes:Number(est.standard),complexity_factor:Number(est.complexity),verified_external_delay_minutes:Number(est.delay),actual_elapsed_minutes:Number(est.actual),standard_approved:false})}catch{return null}},[est])
 const load=useCallback(async()=>{
  setLoading(true);setError('')
  try{
   const own=await getMyDailyReport(date);setRecord(own)
   setEvidence(own.report?await listWorkEvidence(own.report.id):[])
   setSummary(own.report?.summary||'');setNextActions(own.report?.next_actions||'')
   const rows=isManager?await listWorkforceAssignments({limit:200}):await listWorkforceAssignments({mine:true,limit:200})
   setWork(rows);setWorkTotal(Number.isFinite(rows.total)?rows.total:rows.length);setWorkPage(0)
   if(isManager){setQueue(await listReviewQueue());setEmployees(await listAssignableEmployees());setDependencies(await listWorkDependencies());setStandards(await listWorkStandards())}
   // Tiles count the whole visible dataset on the server; a failure is shown, never replaced by a page tally.
   try{setSummaryKpi(await getBoardSummary());setSummaryError('')}catch(e){setSummaryKpi(null);setSummaryError(e.message||'Team totals are unavailable')}
  }catch(e){setError(e.message||'Unable to load daily work')}finally{setLoading(false)}
 },[date,isManager])
 useEffect(()=>{load()},[load])
 const board=useMemo(()=>{
  if(!summaryKpi)return workforceBoardKpis(work,queue)
  const b=summaryKpi.by_status||{}
  return {assigned:b.assigned||0,active:b.in_progress||0,blocked:b.blocked||0,pending_verification:b.submitted||0,verified:b.verified||0,overdue:summaryKpi.overdue||0}
 },[summaryKpi,work,queue])
 const loadMore=async()=>{setLoadingMore(true);try{const next=workPage+1;const {rows,total}=await listWorkforceAssignmentsPage({mine:!isManager,page:next,pageSize:200});setWork(w=>{const seen=new Set(w.map(x=>x.id));return [...w,...rows.filter(r=>!seen.has(r.id))]});setWorkTotal(total);setWorkPage(next)}catch(e){setError(e.message||'Could not load more')}finally{setLoadingMore(false)}}
 const detailItem=useMemo(()=>work.find(w=>w.id===detailId)||null,[work,detailId])
 const designationOptions=useMemo(()=>[...new Set(employees.map(p=>p.role).filter(Boolean))].sort(),[employees])
 const selectableEmployees=useMemo(()=>findAssignableEmployees(employees,{search:employeeSearch,role:designationFilter}),[employees,employeeSearch,designationFilter])
 const selectedEmployee=employees.find(p=>p.id===newWork.assigned_to)
 const employeeById=useMemo(()=>new Map(employees.map(p=>[p.id,p])),[employees])
 const visibleWork=useMemo(()=>filterAssignments(work,{search:boardSearch,status:boardStatus,priority:boardPriority,employeeById}),[work,boardSearch,boardStatus,boardPriority,employeeById])
 const boardFiltered=boardSearch.trim()!==''||boardStatus!=='all'||boardPriority!=='all'
 const boardEmpty=boardFiltered?t('workforce.board.noMatch'):t('workforce.board.empty')
 const boardChart=useMemo(()=>({labels:assignmentStatusSeries(work).map(x=>x.status.replace('_',' ')),datasets:[{label:'Assignments',data:assignmentStatusSeries(work).map(x=>x.count),backgroundColor:'rgba(32,150,110,0.72)',borderRadius:5}]}),[work])
 const entries=record.entries
 const completed=entries.filter(e=>e.category==='productive').length
 // One accounting engine: overlaps are counted once, invalid entries are excluded and listed.
 const day=useMemo(()=>{try{return accountDay({entries})}catch{return null}},[entries])
 const total=day?day.recorded_minutes:entries.reduce((n,e)=>n+Math.max(0,(Date.parse(e.ended_at)-Date.parse(e.started_at))/60000),0)
 const blocked=day?(day.groups?.waiting??0):entries.filter(e=>e.category==='blocked').reduce((n,e)=>n+(Date.parse(e.ended_at)-Date.parse(e.started_at))/60000,0)
 const openMine=useMemo(()=>work.filter(w=>w.assigned_to===profile?.id&&!['verified','cancelled'].includes(w.status)),[work,profile?.id])
 const editable=!record.report||['draft','returned'].includes(record.report.status)
 const durationByCategory=useMemo(()=>categories.map(c=>Math.round(day?.minutes?.[c]??entries.filter(e=>e.category===c).reduce((n,e)=>n+Math.max(0,(Date.parse(e.ended_at)-Date.parse(e.started_at))/60000),0))),[entries,day])
 const durationChart=useMemo(()=>({labels:categories.map(catLabel),datasets:[{label:'Recorded minutes',data:durationByCategory,backgroundColor:'rgba(32,150,110,0.72)',borderRadius:5}]}),[durationByCategory])
 async function run(fn){setSaving(true);setError('');setNotice('');try{await fn();await load();setNotice('Saved successfully')}catch(e){setError(e.message||'Operation failed')}finally{setSaving(false)}}
 const columns=useMemo(()=>[
  {accessorKey:'title',header:'Activity',size:240},
  {id:'category',header:'Type',accessorFn:e=>catLabel(e.category)+(e.correction_count?` (corrected x${e.correction_count})`:''),size:150},
  {id:'time',header:'Start / End',accessorFn:e=>`${dtForLocal(e.started_at)} to ${dtForLocal(e.ended_at)}`,size:230},
  {id:'minutes',header:'Minutes',accessorFn:e=>Math.round((Date.parse(e.ended_at)-Date.parse(e.started_at))/60000),size:90},
  {accessorKey:'deliverable',header:'Result / evidence',size:200},
  {accessorKey:'blocked_reason',header:'Delay reason',size:170}
 ],[])
 const assignmentColumns=useMemo(()=>[
 {accessorKey:'title',header:'Assigned task'},
 {id:'employee',header:'Employee',accessorFn:r=>employeeById.has(r.assigned_to)?employeeLabel(employeeById.get(r.assigned_to)):r.assigned_to},
 {accessorKey:'site',header:'Site'},
 {id:'asset',header:'Asset / tyre',accessorFn:r=>[r.asset_no,r.tyre_serial,r.tyre_position].filter(Boolean).join(' | ')||'N/A'},
 {accessorKey:'priority',header:'Priority'},
 {accessorKey:'status',header:'Status'},
 {id:'due',header:'Deadline',accessorFn:r=>dtForLocal(r.due_at)},
 {id:'action',header:'Next step',enableSorting:false,cell:({row})=><div className="flex flex-wrap gap-2 items-center"><AssignmentActions item={row.original} currentUserId={profile?.id} isManager={isManager} disabled={saving} onAct={(it,action,note,reasonCode)=>run(()=>transitionAssignment(it.id,action,{note,reasonCode}))}/><button type="button" className="btn-secondary" onClick={()=>setDetailId(row.original.id)}>Details</button></div>},
 ],[employeeById,saving,profile?.id,isManager])
 const openReview=async id=>{setError('');try{const detail=await getDailyReportForReview(id);setReviewDetail(detail);setReviewEvidence(await listWorkEvidence(id))}catch(e){setError(e.message||'Could not open report')}}
 const reviewColumns=useMemo(()=>[
  {accessorKey:'employee_id',header:'Employee ID',size:200},
  {accessorKey:'work_date',header:'Date',size:120},
  {accessorKey:'site',header:'Site',size:140},
  {accessorKey:'summary',header:'Submitted summary',size:260},
  {id:'submitted',header:'Submitted',accessorFn:r=>dtForLocal(r.submitted_at)},
  {id:'actions',header:'Supervisor decision',enableSorting:false,cell:({row})=><div className="flex gap-2">
   <button type="button" className="btn-secondary" disabled={saving} onClick={()=>openReview(row.original.id)}>Inspect</button>
   <button type="button" className="btn-secondary" disabled={saving} onClick={()=>{const reason=window.prompt('Reason for return');if(reason?.trim())run(()=>reviewDailyReport(row.original.id,'returned',reason))}}>Return</button>
  </div>}
 ],[saving,load])
 return <div className="space-y-4">
 <PageHeader title="Workforce Daily Work" subtitle="Employee activity, shift submissions and verified results across your organization."/>
 <div className="flex flex-wrap items-center gap-2">
  <button type="button" className={tab==='my-day'?'btn-primary':'btn-secondary'} onClick={()=>setTab('my-day')}>My Day</button>
  <button type="button" className={tab==='assignments'?'btn-primary':'btn-secondary'} onClick={()=>setTab('assignments')}>Team Assignments</button>
  <button type="button" className={tab==='people'?'btn-primary':'btn-secondary'} onClick={()=>setTab('people')}>Employees &amp; Teams</button>
  {isManager&&<button type="button" className={tab==='analytics'?'btn-primary':'btn-secondary'} onClick={()=>setTab('analytics')}>Team Analytics</button>}
  {isManager&&<button type="button" className={tab==='reviews'?'btn-primary':'btn-secondary'} onClick={()=>setTab('reviews')}>Manager Review ({queue.length})</button>}
  <div className="ml-auto flex gap-2 items-center"><label htmlFor="work-date" className="text-sm">Work date</label><input id="work-date" className="input" type="date" value={date} onChange={e=>setDate(cleanDate(e.target.value))}/><button type="button" className="btn-secondary" aria-label="Refresh" onClick={load}><RefreshCw size={16}/></button></div>
 </div>
 {error&&<div role="alert" className="card text-red-500 flex items-center gap-2"><AlertTriangle size={18}/>{error}<button type="button" className="btn-secondary ml-auto" onClick={load}>{t('workforce.board.retry')}</button></div>}
 {notice&&<div role="status" className="card text-green-600">{notice}</div>}
 {tab==='analytics'&&isManager?<TeamAnalyticsPanel employeeById={employeeById}/>:tab==='people'?<EmployeeDirectoryPanel profiles={employees} isManager={isManager} currentUserId={profile?.id}/>:tab==='assignments'?<div className="card space-y-3"><h2 className="font-semibold">Company work assignments</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Tile label="Assigned" value={board.assigned} Icon={ClipboardCheck}/><Tile label="In progress" value={board.active} Icon={Clock}/><Tile label="Blocked" value={board.blocked} Icon={AlertTriangle}/><Tile label="Awaiting review" value={board.pending_verification} Icon={Send}/></div><div className="h-56"><Bar data={boardChart} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}}/></div><p className="text-xs text-[var(--text-muted)]">{summaryKpi?`Counts cover every assignment visible to you (${summaryKpi.total}), generated ${new Date(summaryKpi.generated_at).toLocaleTimeString()}. ${summaryKpi.overdue} overdue.`:'Counts from the loaded assignments only.'} These figures are workflow facts, not employee productivity scores.</p>
 {summaryError&&<p role="status" className="text-xs text-amber-600">Team totals unavailable: {summaryError}</p>}
 {summaryKpi&&Object.keys(summaryKpi.blocked_by_reason||{}).length>0&&<p className="text-xs">Blocked by cause: {Object.entries(summaryKpi.blocked_by_reason).map(([k,v])=>`${BLOCK_REASON_LABELS[k]||k} ${v}`).join(' | ')}</p>}
 {isManager&&<form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={e=>{e.preventDefault();run(async()=>{await assignWork({...newWork,override_reason:newWork.override_reason.trim()||null,estimated_minutes:Number(newWork.estimated_minutes)>0?Number(newWork.estimated_minutes):null,due_at:newWork.due_at?new Date(newWork.due_at).toISOString():null});setNewWork(emptyWork);setPicked(null);setEmployeeSearch('');setDesignationFilter('all')})}}>
 <label className="text-sm">Work title<input className="input w-full" required value={newWork.title} onChange={e=>setNewWork(w=>({...w,title:e.target.value}))}/></label>
 <fieldset className="md:col-span-2 rounded-lg border border-[var(--input-border)] p-3 space-y-3"><legend className="font-semibold px-1">Assign to employee</legend>
 <p className="text-xs text-[var(--text-muted)]">Search by exact employee ID, full name, username or account ID, then filter by recorded role/designation. Only approved, unlocked accounts are selectable.</p>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 <label className="text-sm">Employee ID or name<input className="input w-full" type="search" autoComplete="off" placeholder="Search employee ID or full name" value={employeeSearch} onChange={e=>setEmployeeSearch(e.target.value)}/></label>
 <label className="text-sm">Designation / role<select className="input w-full" value={designationFilter} onChange={e=>setDesignationFilter(e.target.value)}><option value="all">All roles</option>{designationOptions.map(role=><option key={role} value={role}>{role}</option>)}</select></label>
 </div>
 <AssigneeRecommendations taskType={newWork.task_type} site={newWork.site} dueAt={newWork.due_at?new Date(newWork.due_at).toISOString():null} selectedId={newWork.assigned_to} onPick={r=>{setPicked(r);setNewWork(w=>({...w,assigned_to:r.profile_id,override_reason:''}))}}/>
 <label className="block text-sm">Assigned employee<select className="input w-full" aria-label="Assigned employee" required value={newWork.assigned_to} onChange={e=>{setPicked(null);setNewWork(w=>({...w,assigned_to:e.target.value}))}}><option value="">Choose employee ({selectableEmployees.length} matches)</option>{selectableEmployees.map(p=><option key={p.id} value={p.id}>{employeeLabel(p)}</option>)}{selectedEmployee&&!selectableEmployees.some(p=>p.id===selectedEmployee.id)&&<option value={selectedEmployee.id}>{employeeLabel(selectedEmployee)} (selected; outside filter)</option>}</select></label>
 {selectedEmployee?<div className="rounded-lg bg-[var(--panel)] border border-[var(--input-border)] px-3 py-2 text-sm"><strong>Selected:</strong> {employeeLabel(selectedEmployee)}</div>:<p className="text-xs text-[var(--text-muted)]">{selectableEmployees.length===0?'No matching active employee found. Clear the search or change the role filter.':'Select one employee to continue.'}</p>}
 {picked&&!picked.qualified&&!picked.safety_blocked?<label className="block text-sm">Manager override reason (recorded with your name; gaps: {picked.reasons.map(qualificationReasonText).join(', ')})<input className="input w-full" required minLength={5} value={newWork.override_reason} onChange={e=>setNewWork(w=>({...w,override_reason:e.target.value}))}/></label>
 :!picked&&<label className="block text-sm">Override reason (only if the server reports a gap you accept)<input className="input w-full" placeholder="Leave empty unless asked" value={newWork.override_reason} onChange={e=>setNewWork(w=>({...w,override_reason:e.target.value}))}/></label>}
 <label className="block text-sm">Supporting employees (optional)<select multiple className="input w-full h-24" aria-label="Supporting employees" value={newWork.supporting_employee_ids} onChange={e=>setNewWork(w=>({...w,supporting_employee_ids:[...e.target.selectedOptions].map(o=>o.value).filter(v=>v!==w.assigned_to)}))}>{employees.filter(p=>p.id!==newWork.assigned_to).map(p=><option key={p.id} value={p.id}>{employeeLabel(p)}</option>)}</select></label>
 </fieldset>
 <label className="text-sm">Asset number (optional)<input className="input w-full" maxLength={40} placeholder="e.g. TM514" value={newWork.asset_no} onChange={e=>setNewWork(w=>({...w,asset_no:e.target.value}))}/></label>
 <label className="text-sm">Tyre serial (optional)<input className="input w-full" maxLength={60} value={newWork.tyre_serial} onChange={e=>setNewWork(w=>({...w,tyre_serial:e.target.value}))}/></label>
 <label className="text-sm">Tyre position (optional)<input className="input w-full" maxLength={20} placeholder="e.g. LHF1" value={newWork.tyre_position} onChange={e=>setNewWork(w=>({...w,tyre_position:e.target.value}))}/></label>
 <label className="text-sm">Site<input className="input w-full" value={newWork.site} onChange={e=>setNewWork(w=>({...w,site:e.target.value}))}/></label>
 <label className="text-sm">Priority<select className="input w-full" value={newWork.priority} onChange={e=>setNewWork(w=>({...w,priority:e.target.value}))}>{['low','normal','high','critical'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label className="text-sm">Due time<input type="datetime-local" className="input w-full" value={newWork.due_at} onChange={e=>setNewWork(w=>({...w,due_at:e.target.value}))}/></label>
 <label className="text-sm">Instructions<input className="input w-full" value={newWork.instructions} onChange={e=>setNewWork(w=>({...w,instructions:e.target.value}))}/></label>
 <label className="text-sm">Task type<input className="input w-full" list="workforce-task-types" maxLength={80} placeholder="e.g. tyre change" value={newWork.task_type} onChange={e=>setNewWork(w=>({...w,task_type:e.target.value}))}/><datalist id="workforce-task-types">{[...new Set(standards.map(x=>x.work_type).filter(Boolean))].map(t=><option key={t} value={t}/>)}</datalist></label>
 <label className="text-sm">Vehicle type (optional)<input className="input w-full" maxLength={80} placeholder="e.g. TR-MIXER" value={newWork.vehicle_type} onChange={e=>setNewWork(w=>({...w,vehicle_type:e.target.value}))}/></label>
 <label className="text-sm">Estimated minutes (optional)<input type="number" min="1" step="1" className="input w-full" value={newWork.estimated_minutes} onChange={e=>setNewWork(w=>({...w,estimated_minutes:e.target.value}))}/></label>
 <EstimatePanel taskType={newWork.task_type} vehicleType={newWork.vehicle_type} role={selectedEmployee?.role||null} onUse={m=>setNewWork(w=>({...w,estimated_minutes:String(m)}))}/>
 <button className="btn-primary" disabled={saving}>Assign work</button></form>}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-3" role="search" aria-label={t('workforce.board.filterLabel')}>
 <label className="text-sm md:col-span-2">{t('workforce.board.searchLabel')}<input className="input w-full" type="search" autoComplete="off" placeholder={t('workforce.board.searchPlaceholder')} value={boardSearch} onChange={e=>setBoardSearch(e.target.value)}/></label>
 <label className="text-sm">{t('workforce.board.status')}<select className="input w-full" value={boardStatus} onChange={e=>setBoardStatus(e.target.value)}><option value="all">{t('workforce.board.allStatuses')}</option>{ASSIGNMENT_STATUSES.map(x=><option key={x} value={x}>{t(`workforce.status.${x}`)}</option>)}</select></label>
 <label className="text-sm">{t('workforce.board.priority')}<select className="input w-full" value={boardPriority} onChange={e=>setBoardPriority(e.target.value)}><option value="all">{t('workforce.board.allPriorities')}</option>{ASSIGNMENT_PRIORITIES.map(x=><option key={x} value={x}>{t(`workforce.priority.${x}`)}</option>)}</select></label>
 </div>
 <p className="text-xs text-[var(--text-muted)]" aria-live="polite">{loading?t('workforce.board.loading'):t('workforce.board.showing',{shown:visibleWork.length,total:work.length})}{boardFiltered&&<button type="button" className="btn-secondary ml-2" onClick={()=>{setBoardSearch('');setBoardStatus('all');setBoardPriority('all')}}>{t('workforce.board.clearFilters')}</button>}</p>
 {!loading&&workTotal>work.length&&<p role="status" className="text-xs text-amber-600">Loaded the newest {work.length} of {workTotal} assignments; search and filters apply to the loaded set. <button type="button" className="btn-secondary ml-2" disabled={loadingMore} onClick={loadMore}>{loadingMore?'Loading...':'Load more'}</button></p>}
 <div className="flex flex-wrap gap-2">
 {['table','board','calendar'].map(v=><button key={v} type="button" className={boardView===v?'btn-primary':'btn-secondary'} onClick={()=>setBoardView(v)}>{v==='board'?'Kanban':v==='calendar'?'Schedule': 'Table'}</button>)}
 </div>
 {boardView==='table'?<EnterpriseTable columns={assignmentColumns} data={visibleWork} loading={loading} emptyMessage={boardEmpty}/>:boardView==='board'?
 <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">{['assigned','acknowledged','in_progress','blocked','submitted'].map(status=><section className="card space-y-2" key={status}>
 <h3 className="text-sm font-semibold capitalize">{status.replace('_',' ')} ({visibleWork.filter(w=>w.status===status).length})</h3>
 {visibleWork.filter(w=>w.status===status).map(w=><div key={w.id} className="rounded-lg border border-[var(--input-border)] p-3 space-y-1"><p className="text-sm font-semibold">{w.title}</p><p className="text-xs text-[var(--text-muted)]">{w.site||'No site'} | {w.priority}</p><p className="text-xs">{w.due_at?dtForLocal(w.due_at):'Unscheduled'}</p></div>)}
 </section>)}</div>:
 <EnterpriseTable columns={assignmentColumns} data={[...visibleWork].sort((a,b)=>String(a.due_at||'9999').localeCompare(String(b.due_at||'9999')))} loading={loading} emptyMessage={boardFiltered?boardEmpty:t('workforce.board.noSchedule')}/>}
 {isManager&&<div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
 <form className="rounded-xl border border-[var(--input-border)] p-3 space-y-2" onSubmit={e=>{e.preventDefault();run(async()=>{await addWorkDependency(dependencyForm.predecessor_id,dependencyForm.successor_id);setDependencyForm({predecessor_id:'',successor_id:''})})}}>
 <h3 className="font-semibold">Work dependencies</h3><p className="text-xs text-[var(--text-muted)]">Specify predecessor and dependent assignment.</p>
 {(['predecessor_id','successor_id']).map(field=><label key={field} className="block text-xs">{field==='predecessor_id'?'Must finish first':'Dependent task'}<select required className="input w-full" value={dependencyForm[field]} onChange={e=>setDependencyForm(x=>({...x,[field]:e.target.value}))}><option value="">Choose task</option>{work.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>)}
 <button type="submit" className="btn-primary" disabled={saving}>Add dependency</button>
 <p className="text-xs text-[var(--text-muted)]">{dependencies.length} dependency links recorded</p></form>
 <form className="rounded-xl border border-[var(--input-border)] p-3 space-y-2" onSubmit={e=>{e.preventDefault();run(async()=>{await addWorkStandard(standardForm);setStandardForm({work_type:'',role_name:'',minutes_per_unit:'30'})})}}>
 <h3 className="font-semibold">Work standards catalog</h3>
 <input className="input w-full" placeholder="Work type" required value={standardForm.work_type} onChange={e=>setStandardForm(x=>({...x,work_type:e.target.value}))}/>
 <input className="input w-full" placeholder="Role (optional)" value={standardForm.role_name} onChange={e=>setStandardForm(x=>({...x,role_name:e.target.value}))}/>
 <input className="input w-full" type="number" min="1" placeholder="Minutes per unit" required value={standardForm.minutes_per_unit} onChange={e=>setStandardForm(x=>({...x,minutes_per_unit:e.target.value}))}/>
 <button type="submit" className="btn-primary" disabled={saving}>Add provisional standard</button>
 <p className="text-xs text-[var(--text-muted)]">{standards.length} recorded standards. Provisional standards are not validated benchmarks.</p>
 </form></div>}
 <AssignmentDetailDrawer open={!!detailItem} item={detailItem} onClose={()=>setDetailId(null)} employeeById={employeeById} currentUserId={profile?.id} organisationId={profile?.organisation_id||profile?.org_id} isManager={isManager} onChanged={load}/>
 </div>:tab==='reviews'&&isManager?<div className="card"><h2 className="text-lg font-semibold mb-3">Awaiting manager verification</h2><EnterpriseTable columns={reviewColumns} data={queue} loading={loading} emptyMessage="No daily reports awaiting review."/>
 {reviewDetail&&<section className="mt-5 space-y-3 border-t border-[var(--input-border)] pt-4">
 <div className="flex items-center justify-between"><h3 className="font-semibold">Employee report details</h3><button type="button" className="btn-secondary" onClick={()=>setReviewDetail(null)}>Close</button></div>
 <p className="text-sm">Employee: {reviewDetail.report.employee_id} • Date: {reviewDetail.report.work_date} • Site: {reviewDetail.report.site||'Not specified'}</p>
 <p className="text-sm whitespace-pre-wrap">{reviewDetail.report.summary}</p>
 <h4 className="font-semibold">Verified activity evidence</h4>
 <EnterpriseTable columns={[...columns,{id:'fix',header:'Correction',enableSorting:false,cell:({row})=>reviewDetail.report.employee_id!==profile?.id&&['submitted','returned'].includes(reviewDetail.report.status)?<button type="button" className="btn-secondary" onClick={()=>setFix({entry:row.original,key:newKey(),category:row.original.category,started_at:toLocalInput(row.original.started_at),ended_at:toLocalInput(row.original.ended_at),reason:''})}>Correct</button>:null}]} data={reviewDetail.entries} emptyMessage="No report activity found."/>
 {fix&&<form className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-lg border border-[var(--input-border)] p-3" onSubmit={e=>{e.preventDefault();const patch={};if(fix.category!==fix.entry.category)patch.category=fix.category;if(fix.started_at!==toLocalInput(fix.entry.started_at))patch.started_at=new Date(fix.started_at).toISOString();if(fix.ended_at!==toLocalInput(fix.entry.ended_at))patch.ended_at=new Date(fix.ended_at).toISOString();run(async()=>{await correctDailyEntry(fix.entry.id,patch,fix.reason,fix.key);setFix(null);setReviewDetail(await getDailyReportForReview(reviewDetail.report.id))})}}>
 <p className="md:col-span-4 text-xs text-[var(--text-muted)]">Correcting "{fix.entry.title}". The original stays in the correction history with your name and reason.</p>
 <label className="text-xs">Type<select className="input w-full" value={fix.category} onChange={e=>setFix(f=>({...f,category:e.target.value}))}>{categories.map(c=><option key={c} value={c}>{catLabel(c)}</option>)}</select></label>
 <label className="text-xs">Start<input type="datetime-local" className="input w-full" required value={fix.started_at} onChange={e=>setFix(f=>({...f,started_at:e.target.value}))}/></label>
 <label className="text-xs">Finish<input type="datetime-local" className="input w-full" required value={fix.ended_at} onChange={e=>setFix(f=>({...f,ended_at:e.target.value}))}/></label>
 <label className="text-xs">Reason<input className="input w-full" required minLength={5} value={fix.reason} onChange={e=>setFix(f=>({...f,reason:e.target.value}))}/></label>
 <div className="md:col-span-4 flex gap-2"><button className="btn-primary" disabled={saving}>Save correction</button><button type="button" className="btn-secondary" onClick={()=>setFix(null)}>Cancel</button></div></form>}
 <div className="space-y-2">{reviewEvidence.map(file=><div key={file.id} className="flex items-center justify-between gap-2"><span className="text-sm">{file.file_name}</span><button type="button" className="btn-secondary" onClick={async()=>{try{window.open(await openWorkEvidence(file.object_path),'_blank','noopener,noreferrer')}catch(e){setError(e.message)}}}>Open evidence</button></div>)}</div>
 <p className="text-xs text-[var(--text-muted)]">Check original tasks, actual duration, external blockers and documentation before verification.</p>
 <div className="flex gap-2"><button type="button" className="btn-primary" disabled={saving} onClick={()=>run(async()=>{await reviewDailyReport(reviewDetail.report.id,'verified','Evidence and work activity reviewed');setReviewDetail(null)})}>Verify report</button><button type="button" className="btn-secondary" disabled={saving} onClick={()=>{const reason=window.prompt('Explain why this report needs correction');if(reason?.trim())run(async()=>{await reviewDailyReport(reviewDetail.report.id,'returned',reason);setReviewDetail(null)})}}>Return for correction</button></div>
 </section>}
 </div>:
 <>
 <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
  <Tile label="Activities recorded" value={entries.length} Icon={ClipboardCheck}/>
  <Tile label="Direct work entries" value={completed} Icon={CheckCircle2}/>
  <Tile label="Recorded minutes" value={Math.round(total)} Icon={Clock}/>
  <Tile label="Waiting / blocked minutes" value={Math.round(blocked)} Icon={AlertTriangle}/>
 </div>
 <div className="card space-y-3"><h2 className="font-semibold">Recorded work distribution</h2><div className="h-56"><Bar data={durationChart} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,title:{display:true,text:"Minutes"}}}}}/></div><p className="text-xs text-[var(--text-muted)]">Recorded activity only. Time nobody recorded is shown as not recorded, never as idle.{day?.overlap_minutes?` ${Math.round(day.overlap_minutes)} overlapping minutes were counted once.`:''}</p>
 {day?.warnings?.length>0&&<ul role="status" className="text-xs text-amber-600 list-disc pl-5">{day.warnings.slice(0,6).map((w,i)=><li key={i}>{w.message}</li>)}</ul>}</div>
 <div className="card space-y-3">
  <div className="flex justify-between items-center gap-2"><div><h2 className="font-semibold">Activity timeline</h2><p className="text-sm text-[var(--text-muted)]">Actual timestamps and deliverables. Unrecorded time is not treated as idle.</p></div>
  {editable&&<button className="btn-primary flex items-center gap-2" type="button" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/>Add activity</button>}</div>
  {showForm&&editable&&<form className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-xl p-3 border-[var(--input-border)]" onSubmit={e=>{e.preventDefault();run(async()=>{await addDailyEntry(date,{...form,assignment_id:form.assignment_id||null,started_at:new Date(form.started_at).toISOString(),ended_at:new Date(form.ended_at).toISOString(),site:profile?.site});setShowForm(false);setForm({title:'',details:'',deliverable:'',category:'productive',started_at:'',ended_at:'',blocked_reason:'',assignment_id:''})})}}>
  <label className="space-y-1 text-sm">Activity title<input required className="input w-full" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></label>
  <label className="space-y-1 text-sm">Type<select className="input w-full" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{categories.map(x=><option key={x} value={x}>{catLabel(x)}</option>)}</select></label>
  <label className="space-y-1 text-sm">Linked assignment (optional)<select className="input w-full" value={form.assignment_id} onChange={e=>setForm(f=>({...f,assignment_id:e.target.value}))}><option value="">Not linked</option>{openMine.map(w=><option key={w.id} value={w.id}>{w.title}{w.asset_no?` (${w.asset_no})`:''}</option>)}</select></label>
  <label className="space-y-1 text-sm">Start<input required type="datetime-local" className="input w-full" value={form.started_at} onChange={e=>setForm(f=>({...f,started_at:e.target.value}))}/></label>
  <label className="space-y-1 text-sm">Finish<input required type="datetime-local" className="input w-full" value={form.ended_at} onChange={e=>setForm(f=>({...f,ended_at:e.target.value}))}/></label>
  <label className="space-y-1 text-sm md:col-span-2">Details<textarea className="input w-full" value={form.details} onChange={e=>setForm(f=>({...f,details:e.target.value}))}/></label>
  <label className="space-y-1 text-sm">Deliverable or result<input className="input w-full" value={form.deliverable} onChange={e=>setForm(f=>({...f,deliverable:e.target.value}))}/></label>
  {reasonCats.includes(form.category)&&<label className="space-y-1 text-sm">{form.category==='blocked'?'Blocker reason':'What were you waiting for? (optional)'}<input required={form.category==='blocked'} className="input w-full" value={form.blocked_reason} onChange={e=>setForm(f=>({...f,blocked_reason:e.target.value}))}/></label>}
  <div className="md:col-span-2 flex gap-2"><button disabled={saving} className="btn-primary" type="submit">Save activity</button><button className="btn-secondary" type="button" onClick={()=>setShowForm(false)}>Cancel</button></div>
  </form>}
  <EnterpriseTable columns={columns} data={entries} loading={loading} emptyMessage="No activities recorded for this workday."/>
 </div>
 <div className="card space-y-3"><div><h2 className="text-lg font-semibold">Work duration estimate</h2><p className="text-sm text-[var(--text-muted)]">Provisional calculation, not an approved performance standard. Supervisors must validate inputs and reasons.</p></div>
 <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
 {([['qty','Quantity'],['standard','Min / unit'],['complexity','Complexity factor'],['delay','Verified delay (min)'],['actual','Elapsed (min)']]).map(([key,label])=><label className="text-xs space-y-1" key={key}>{label}<input className="input w-full" type="number" min={key==='qty'||key==='standard'||key==='complexity'?'0.01':'0'} step="any" value={est[key]} onChange={e=>setEst(x=>({...x,[key]:e.target.value}))}/></label>)}
 </div>
 {estimate?<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
 <Tile label="Expected effort (min)" value={estimate.effort_minutes} Icon={Clock}/>
 <Tile label="Expected elapsed (min)" value={estimate.expected_elapsed_minutes} Icon={Clock}/>
 <Tile label="Difference (min)" value={estimate.unexplained_variance_minutes} Icon={AlertTriangle}/>
 </div>:<p role="alert" className="text-sm text-[var(--text-muted)]">Enter valid positive task standard, quantity and factor.</p>}
 <p className="text-xs text-[var(--text-muted)]">The result is an estimate only. No automated personnel decision or fabricated confidence is produced.</p></div>
 <div className="card space-y-3">
 <div><h2 className="text-lg font-semibold">Work evidence and attachments</h2><p className="text-xs text-[var(--text-muted)]">Private JPG, PNG or PDF evidence, maximum 10 MB each. Files are linked to the employee report and available to authorized reviewers.</p></div>
 {editable&&<label className="text-sm block">Attach evidence
 <input type="file" accept="image/jpeg,image/png,application/pdf" className="input block w-full mt-2" disabled={saving} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)run(async()=>{const report=record.report||await ensureDailyReport(date,profile?.site);await uploadWorkEvidence({report,file})})}}/>
 </label>}
 {evidence.length?<div className="space-y-2">{evidence.map(file=><div key={file.id} className="flex items-center justify-between gap-2 border-b border-[var(--input-border)] py-2">
 <div className="min-w-0"><p className="text-sm truncate">{file.file_name}</p><p className="text-xs text-[var(--text-muted)]">{(file.byte_size/1024).toFixed(1)} KB</p></div>
 <button type="button" className="btn-secondary" onClick={async()=>{try{const url=await openWorkEvidence(file.object_path);window.open(url,'_blank','noopener,noreferrer')}catch(err){setError(err.message||'Could not open evidence')}}}>View file</button>
 </div>)}</div>:<p className="text-sm text-[var(--text-muted)]">No evidence attached to this daily report.</p>}
 </div>
 <div className="card space-y-3">
  <div className="flex justify-between items-center"><h2 className="text-lg font-semibold">End-of-day submission</h2><span className="text-xs font-semibold uppercase text-[var(--accent)]">{record.report?.status||'not started'}</span></div>
  <label className="block text-sm space-y-1">Work completed and results<textarea disabled={!editable} className="input w-full" rows={3} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
  <label className="block text-sm space-y-1">Remaining work / next-day handover<textarea disabled={!editable} className="input w-full" rows={2} value={nextActions} onChange={e=>setNextActions(e.target.value)}/></label>
  {record.report?.review_note&&<p className="text-sm">Supervisor response: {record.report.review_note}</p>}
  {editable&&<button type="button" className="btn-primary flex items-center gap-2" disabled={saving||!entries.length||!summary.trim()} onClick={()=>run(async()=>{const report=record.report||await ensureDailyReport(date,profile?.site);await submitDailyReport(report,entries,summary,nextActions)})}><Send size={16}/>Submit for verification</button>}
  <p className="text-xs text-[var(--text-muted)]">Submitted reports require supervisor review. Actual operational records and supporting evidence should be verified before approval.</p>
 </div>
 </>}
 </div>
}

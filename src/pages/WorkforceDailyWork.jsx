import {useEffect,useMemo,useState,useCallback} from 'react'
import {Chart as ChartJS,CategoryScale,LinearScale,BarElement,Tooltip,Legend} from 'chart.js'
import {Bar} from 'react-chartjs-2'
import {ClipboardCheck,Clock,Plus,RefreshCw,CheckCircle2,AlertTriangle,Send} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {useAuth} from '../contexts/AuthContext'
import {estimateWork} from '../lib/workforceIntelligence'
import {listWorkforceAssignments,assignWork,listAssignableEmployees} from '../lib/api/workforceAssignments'
import {addDailyEntry,getMyDailyReport,ensureDailyReport,submitDailyReport,listReviewQueue,reviewDailyReport} from '../lib/api/workforceDaily'
ChartJS.register(CategoryScale,LinearScale,BarElement,Tooltip,Legend)
const dateNow=()=>new Date().toLocaleDateString('en-CA')
const categories=['productive','coordination','reporting','training','break','blocked','unassigned']
const cleanDate=s=>String(s||'').slice(0,10)
const dtForLocal=v=>v?new Date(v).toLocaleString(): '—'
function Tile({label,value,Icon}) {return <div className="card"><div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{label}</span><Icon size={17} className="text-[var(--accent)]"/></div><div className="text-3xl font-bold mt-2 tabular-nums">{value}</div></div>}
export default function WorkforceDailyWork(){
 const {profile}=useAuth()
 const isManager=['Admin','Manager','Director','Super Admin'].includes(profile?.role)||profile?.is_super_admin
 const [date,setDate]=useState(dateNow)
 const [record,setRecord]=useState({report:null,entries:[]})
 const [queue,setQueue]=useState([])
 const [work,setWork]=useState([]),[employees,setEmployees]=useState([])
 const [newWork,setNewWork]=useState({title:'',assigned_to:'',site:'',priority:'normal',due_at:'',instructions:''})
 const [tab,setTab]=useState('my-day')
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [summary,setSummary]=useState(''),[nextActions,setNextActions]=useState('')
 const [form,setForm]=useState({title:'',details:'',deliverable:'',category:'productive',started_at:'',ended_at:'',blocked_reason:''})
 const [showForm,setShowForm]=useState(false)
 const [est,setEst]=useState({qty:'1',standard:'30',complexity:'1',delay:'0',actual:'45'})
 const estimate=useMemo(()=>{try{return estimateWork({quantity:Number(est.qty),standard_minutes:Number(est.standard),complexity_factor:Number(est.complexity),verified_external_delay_minutes:Number(est.delay),actual_elapsed_minutes:Number(est.actual),standard_approved:false})}catch{return null}},[est])
 const load=useCallback(async()=>{
  setLoading(true);setError('')
  try{
   const own=await getMyDailyReport(date);setRecord(own)
   setSummary(own.report?.summary||'');setNextActions(own.report?.next_actions||'')
   if(isManager){setQueue(await listReviewQueue());setWork(await listWorkforceAssignments());setEmployees(await listAssignableEmployees())}
   else setWork(await listWorkforceAssignments({mine:true}))
  }catch(e){setError(e.message||'Unable to load daily work')}finally{setLoading(false)}
 },[date,isManager])
 useEffect(()=>{load()},[load])
 const entries=record.entries
 const completed=entries.filter(e=>e.category==='productive').length
 const total=entries.reduce((n,e)=>n+Math.max(0,(Date.parse(e.ended_at)-Date.parse(e.started_at))/60000),0)
 const blocked=entries.filter(e=>e.category==='blocked').reduce((n,e)=>n+(Date.parse(e.ended_at)-Date.parse(e.started_at))/60000,0)
 const editable=!record.report||['draft','returned'].includes(record.report.status)
 const durationByCategory=useMemo(()=>categories.map(c=>Math.round(entries.filter(e=>e.category===c).reduce((n,e)=>n+Math.max(0,(Date.parse(e.ended_at)-Date.parse(e.started_at))/60000),0))),[entries])
 const durationChart=useMemo(()=>({labels:categories.map(c=>c.replace('_',' ')),datasets:[{label:'Recorded minutes',data:durationByCategory,backgroundColor:'rgba(32,150,110,0.72)',borderRadius:5}]}),[durationByCategory])
 async function run(fn){setSaving(true);setError('');setNotice('');try{await fn();await load();setNotice('Saved successfully')}catch(e){setError(e.message||'Operation failed')}finally{setSaving(false)}}
 const columns=useMemo(()=>[
  {accessorKey:'title',header:'Activity',size:240},
  {accessorKey:'category',header:'Type',size:130},
  {id:'time',header:'Start / End',accessorFn:e=>`${dtForLocal(e.started_at)} to ${dtForLocal(e.ended_at)}`,size:230},
  {id:'minutes',header:'Minutes',accessorFn:e=>Math.round((Date.parse(e.ended_at)-Date.parse(e.started_at))/60000),size:90},
  {accessorKey:'deliverable',header:'Result / evidence',size:200},
  {accessorKey:'blocked_reason',header:'Delay reason',size:170}
 ],[])
 const assignmentColumns=useMemo(()=>[
 {accessorKey:'title',header:'Assigned task'},
 {accessorKey:'assigned_to',header:'Employee ID'},
 {accessorKey:'site',header:'Site'},
 {accessorKey:'priority',header:'Priority'},
 {accessorKey:'status',header:'Status'},
 {id:'due',header:'Deadline',accessorFn:r=>dtForLocal(r.due_at)}
 ],[])
 const reviewColumns=useMemo(()=>[
  {accessorKey:'employee_id',header:'Employee ID',size:200},
  {accessorKey:'work_date',header:'Date',size:120},
  {accessorKey:'site',header:'Site',size:140},
  {accessorKey:'summary',header:'Submitted summary',size:260},
  {id:'submitted',header:'Submitted',accessorFn:r=>dtForLocal(r.submitted_at)},
  {id:'actions',header:'Supervisor decision',enableSorting:false,cell:({row})=><div className="flex gap-2">
   <button type="button" className="btn-primary" disabled={saving} onClick={()=>run(()=>reviewDailyReport(row.original.id,'verified','Reviewed and verified'))}>Verify</button>
   <button type="button" className="btn-secondary" disabled={saving} onClick={()=>{const reason=window.prompt('Reason for return');if(reason?.trim())run(()=>reviewDailyReport(row.original.id,'returned',reason))}}>Return</button>
  </div>}
 ],[saving,load])
 return <div className="space-y-4">
 <PageHeader title="Workforce Daily Work" subtitle="Employee activity, shift submissions and verified results across your organization."/>
 <div className="flex flex-wrap items-center gap-2">
  <button type="button" className={tab==='my-day'?'btn-primary':'btn-secondary'} onClick={()=>setTab('my-day')}>My Day</button>
  <button type="button" className={tab==='assignments'?'btn-primary':'btn-secondary'} onClick={()=>setTab('assignments')}>Team Assignments</button>
  {isManager&&<button type="button" className={tab==='reviews'?'btn-primary':'btn-secondary'} onClick={()=>setTab('reviews')}>Manager Review ({queue.length})</button>}
  <div className="ml-auto flex gap-2 items-center"><label htmlFor="work-date" className="text-sm">Work date</label><input id="work-date" className="input" type="date" value={date} onChange={e=>setDate(cleanDate(e.target.value))}/><button type="button" className="btn-secondary" aria-label="Refresh" onClick={load}><RefreshCw size={16}/></button></div>
 </div>
 {error&&<div role="alert" className="card text-red-500 flex items-center gap-2"><AlertTriangle size={18}/>{error}</div>}
 {notice&&<div role="status" className="card text-green-600">{notice}</div>}
 {tab==='assignments'?<div className="card space-y-3"><h2 className="font-semibold">Company work assignments</h2>
 {isManager&&<form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={e=>{e.preventDefault();run(async()=>{await assignWork({...newWork,due_at:newWork.due_at?new Date(newWork.due_at).toISOString():null});setNewWork({title:'',assigned_to:'',site:'',priority:'normal',due_at:'',instructions:''})})}}>
 <label className="text-sm">Work title<input className="input w-full" required value={newWork.title} onChange={e=>setNewWork(w=>({...w,title:e.target.value}))}/></label>
 <label className="text-sm">Assigned employee<select className="input w-full" required value={newWork.assigned_to} onChange={e=>setNewWork(w=>({...w,assigned_to:e.target.value}))}><option value="">Choose employee</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name||p.id} {p.site?`(${p.site})`:''}</option>)}</select></label>
 <label className="text-sm">Site<input className="input w-full" value={newWork.site} onChange={e=>setNewWork(w=>({...w,site:e.target.value}))}/></label>
 <label className="text-sm">Priority<select className="input w-full" value={newWork.priority} onChange={e=>setNewWork(w=>({...w,priority:e.target.value}))}>{['low','normal','high','critical'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label className="text-sm">Due time<input type="datetime-local" className="input w-full" value={newWork.due_at} onChange={e=>setNewWork(w=>({...w,due_at:e.target.value}))}/></label>
 <label className="text-sm">Instructions<input className="input w-full" value={newWork.instructions} onChange={e=>setNewWork(w=>({...w,instructions:e.target.value}))}/></label>
 <button className="btn-primary" disabled={saving}>Assign work</button></form>}
 <EnterpriseTable columns={assignmentColumns} data={work} loading={loading} emptyMessage="No assignments in this view."/></div>:tab==='reviews'&&isManager?<div className="card"><h2 className="text-lg font-semibold mb-3">Awaiting manager verification</h2><EnterpriseTable columns={reviewColumns} data={queue} loading={loading} emptyMessage="No daily reports awaiting review."/></div>:
 <>
 <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
  <Tile label="Activities recorded" value={entries.length} Icon={ClipboardCheck}/>
  <Tile label="Direct work entries" value={completed} Icon={CheckCircle2}/>
  <Tile label="Recorded minutes" value={Math.round(total)} Icon={Clock}/>
  <Tile label="Blocked minutes" value={Math.round(blocked)} Icon={AlertTriangle}/>
 </div>
 <div className="card space-y-3"><h2 className="font-semibold">Recorded work distribution</h2><div className="h-56"><Bar data={durationChart} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,title:{display:true,text:"Minutes"}}}}}/></div><p className="text-xs text-[var(--text-muted)]">Recorded activity only. No inferred productivity or unrecorded time included.</p></div>
 <div className="card space-y-3">
  <div className="flex justify-between items-center gap-2"><div><h2 className="font-semibold">Activity timeline</h2><p className="text-sm text-[var(--text-muted)]">Actual timestamps and deliverables. Unrecorded time is not treated as idle.</p></div>
  {editable&&<button className="btn-primary flex items-center gap-2" type="button" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/>Add activity</button>}</div>
  {showForm&&editable&&<form className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-xl p-3 border-[var(--input-border)]" onSubmit={e=>{e.preventDefault();run(async()=>{await addDailyEntry(date,{...form,started_at:new Date(form.started_at).toISOString(),ended_at:new Date(form.ended_at).toISOString(),site:profile?.site});setShowForm(false);setForm({title:'',details:'',deliverable:'',category:'productive',started_at:'',ended_at:'',blocked_reason:''})})}}>
  <label className="space-y-1 text-sm">Activity title<input required className="input w-full" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></label>
  <label className="space-y-1 text-sm">Type<select className="input w-full" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{categories.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
  <label className="space-y-1 text-sm">Start<input required type="datetime-local" className="input w-full" value={form.started_at} onChange={e=>setForm(f=>({...f,started_at:e.target.value}))}/></label>
  <label className="space-y-1 text-sm">Finish<input required type="datetime-local" className="input w-full" value={form.ended_at} onChange={e=>setForm(f=>({...f,ended_at:e.target.value}))}/></label>
  <label className="space-y-1 text-sm md:col-span-2">Details<textarea className="input w-full" value={form.details} onChange={e=>setForm(f=>({...f,details:e.target.value}))}/></label>
  <label className="space-y-1 text-sm">Deliverable or result<input className="input w-full" value={form.deliverable} onChange={e=>setForm(f=>({...f,deliverable:e.target.value}))}/></label>
  {form.category==='blocked'&&<label className="space-y-1 text-sm">Blocker reason<input required className="input w-full" value={form.blocked_reason} onChange={e=>setForm(f=>({...f,blocked_reason:e.target.value}))}/></label>}
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

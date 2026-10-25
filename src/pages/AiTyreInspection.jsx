import DateField from '../components/ui/DateField'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, RefreshCw, ShieldAlert, SearchCheck, Ruler, X, Image as ImageIcon, ClipboardList, AlertCircle, FileText, Download } from 'lucide-react'
import { displayPositionCode, inspectionTypeHint } from '../lib/tyreBay'
import { inspectablePhotoRefs, summarizeEvidence, normalizePositionConditions, normalizePhotographs, measurementReading } from '../lib/aiTyreInspectionDomain'
import { buildInspectionAiAppendix, INSPECTION_AI_PRINT_STYLES } from '../lib/aiTyreInspectionReport'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SideDrawer from '../components/ui/SideDrawer'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { listAiRegisterFiltered } from '../lib/api/inspections'
import { listDataSiteOptions } from '../lib/api/sites'
import { useAuth } from '../contexts/AuthContext'
import { canQueueAiAnalysis, canReviewAiFinding, canBackfillAi, canViewAiFeedback, aiActionNotice } from '../lib/aiTyreInspectionRoles'
import { shapeFeedbackRows, summarizeFeedback, feedbackExportRows, FEEDBACK_EXPORT_COLUMNS, FEEDBACK_DISCLAIMER, shapeLabelledFindings, labelledSummary, labelledExportRows, labelledJsonl, LABELLED_EXPORT_COLUMNS } from '../lib/aiTyreReviewFeedback'
import { buildDamageRows, exportDamageExcel, exportDamagePdf } from '../lib/aiDamageReport'
import { calculateTread, conditionRequiresAnalysis } from '../lib/aiTyreInspection'
import { analyzeMeasurements, describeSeries } from '../lib/tyreMeasurementEngine'
import { exportInspectionExcel } from '../lib/aiTyreInspectionExport'
import { applyRegisterFilters, conditionOptions } from '../lib/aiTyreInspectionFilters'
import LazyTyrePhoto from '../components/aiInspection/LazyTyrePhoto'
import { readInspectionMeasurements, recordDepthMeasurement, readInspectionAnalysis, enqueueInspectionPhotos, reviewAiFinding, backfillAiInspectionRange, screenInspectionPhotos, getAiReviewFeedback, getAiLabelledFindings } from '../lib/api/aiTyreInspection'

/** Calendar day selection in Saudi Arabia; always preserve local midnight. */
function saudiDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value+'T00:00:00+03:00') : null
}
function saudiRange(from, through) {
  const start=saudiDay(from)
  const last=saudiDay(through)
  if (!start || !last || !Number.isFinite(start.getTime()) || !Number.isFinite(last.getTime())) {
    throw new Error('Choose a valid start and end date.')
  }
  const end=new Date(last.getTime()+86400000)
  if (end<=start || end-start>32*86400000) {
    throw new Error('Select a date range of 1 to 32 days.')
  }
  return {from:start.toISOString(),to:end.toISOString()}
}
function HistoricInspectionBackfill() {
  const [from,setFrom]=useState('')
  const [through,setThrough]=useState('')
  const [running,setRunning]=useState(false)
  const [error,setError]=useState('')
  const [result,setResult]=useState(null)
  const run=async(event)=>{
    event.preventDefault()
    if(!from||!through){setError('Choose both a start and an end date');return}
    setRunning(true);setError('');setResult(null)
    try{
      const dates=saudiRange(from,through)
      let page=0,scanned=0,eligible=0,created=0,skipped=0
      while (page<60) {
        let res
        try{res=await backfillAiInspectionRange({...dates,page})}
        catch(e){await new Promise(r=>setTimeout(r,1500));res=await backfillAiInspectionRange({...dates,page})}
        scanned+=Number(res.scanned||0)
        eligible+=Number(res.eligible||0)
        created+=Number(res.created||0)
        skipped+=Number(res.skipped_existing||0)
        setResult({scanned,eligible,created,skipped,more:res.next_page!=null})
        if(res.next_page==null)break
        page=res.next_page
      }
    }catch(err){setError(toUserMessage(err,'Unable to queue the selected inspections'))}
    finally{setRunning(false)}
  }
  return <Card>
    <h2 className="font-semibold">Analyze previous inspections</h2>
    <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">Authorized managers can queue eligible damage photographs from saved inspections. Dates use Saudi Arabia time. Already queued photographs are skipped; inspecting a date range does not charge by itself.</p>
    <form onSubmit={run} className="flex flex-wrap gap-3 items-end">
      <div className="text-xs text-[var(--text-secondary)]"><span>From</span><DateField className="mt-1 w-44" ariaLabel="From" value={from} onChange={setFrom} placeholder="Select date"/></div>
      <div className="text-xs text-[var(--text-secondary)]"><span>Through</span><DateField className="mt-1 w-44" ariaLabel="Through" value={through} onChange={setThrough} placeholder="Select date"/></div>
      <button className="btn-primary" type="submit" disabled={running}>{running?'Queuing inspections':'Queue historical inspections'}</button>
    </form>
    {error&&<p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}
    {result&&<div role="status" className="mt-3 rounded-lg border border-[var(--border-dim)] p-3 text-sm">
      Inspections checked: <strong>{result.scanned}</strong> | Eligible photos: <strong>{result.eligible}</strong> | Already analysed or queued (skipped): <strong>{result.skipped}</strong> | Newly queued: <strong>{result.created}</strong>
      {result.more&&<p className="text-xs text-amber-500 mt-1">More records remain for this range; select a shorter range for a complete batch.</p>}
    </div>}
  </Card>
}

const pctCell = (v) => (v == null ? 'N/A' : v + '%')
const feedbackColumns = [
  { accessorKey: 'model', header: 'Model' }, { accessorKey: 'prompt', header: 'Prompt' },
  { accessorKey: 'jobs', header: 'Jobs' }, { accessorKey: 'reviewed', header: 'Reviewed' },
  { accessorKey: 'accepted', header: 'Accepted' }, { accessorKey: 'rejected', header: 'Rejected' },
  { accessorKey: 'corrected', header: 'Corrected' }, { accessorKey: 'unreviewed', header: 'Awaiting' },
  { id: 'acceptRate', header: 'Accept %', accessorFn: (r) => pctCell(r.acceptRate) },
  { id: 'rejectRate', header: 'Reject %', accessorFn: (r) => pctCell(r.rejectRate) },
]
/** Reviewer decisions per model/prompt. EVALUATION DATA ONLY: nothing here trains or tunes a model. */

function ReviewFeedbackPanel() {
  const [rows,setRows]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [from,setFrom]=useState('')
  const [to,setTo]=useState('')
  const load=useCallback(async()=>{
    setLoading(true);setError('')
    try{setRows(shapeFeedbackRows(await getAiReviewFeedback({from,to})))}
    catch(err){setError(toUserMessage(err,'Could not load reviewer feedback'));setRows(null)}
    finally{setLoading(false)}
  },[from,to])
  const total=useMemo(()=>rows?summarizeFeedback(rows):null,[rows])
  const download=async()=>{const {exportToExcel}=await import('../lib/exportUtils');exportToExcel(feedbackExportRows(rows||[]),FEEDBACK_EXPORT_COLUMNS.map(([k])=>k),FEEDBACK_EXPORT_COLUMNS.map(([,h])=>h),'AI tyre reviewer feedback (evaluation data)','Reviewer feedback')}
  const [labelBusy,setLabelBusy]=useState(false)
  const [labelNote,setLabelNote]=useState('')
  const downloadLabelled=async(kind)=>{
    setLabelBusy(true);setError('');setLabelNote('')
    try{
      const shaped=shapeLabelledFindings(await getAiLabelledFindings({from,to}))
      const s=labelledSummary(shaped)
      if(!shaped.length){setLabelNote('No reviewed findings in this range yet. Accept, reject or correct findings first.');return}
      const base=`AI tyre labelled findings (evaluation data) ${from||'start'} to ${to||'today'}`
      if(kind==='jsonl'){
        const url=URL.createObjectURL(new Blob([labelledJsonl(shaped)],{type:'application/x-ndjson'}))
        const a=document.createElement('a');a.href=url;a.download=base.replace(/[^A-Za-z0-9 ()]+/g,' ').trim()+'.jsonl';a.click()
        setTimeout(()=>URL.revokeObjectURL(url),1000)
      }else{
        const {exportToExcel}=await import('../lib/exportUtils')
        exportToExcel(labelledExportRows(shaped),LABELLED_EXPORT_COLUMNS.map(([k])=>k),LABELLED_EXPORT_COLUMNS.map(([,h])=>h),base,'Labelled findings')
      }
      setLabelNote(`${s.total} labelled findings exported: ${s.accepted} accepted, ${s.rejected} rejected, ${s.corrected} corrected. ${s.negativeWithoutNote} rejected or corrected without a reviewer note.`)
    }catch(err){setError(toUserMessage(err,'Could not export labelled findings'))}
    finally{setLabelBusy(false)}
  }
  return <Card>
    <h2 className="font-semibold">Reviewer feedback: evaluation data</h2>
    <p className="text-xs text-[var(--text-muted)] mt-1 mb-3">{FEEDBACK_DISCLAIMER}</p>
    <div className="flex flex-wrap gap-3 items-end">
      <div className="text-xs text-[var(--text-secondary)]"><span>From</span><DateField className="mt-1 w-44" ariaLabel="From" value={from} onChange={setFrom} placeholder="Select date"/></div>
      <div className="text-xs text-[var(--text-secondary)]"><span>Through</span><DateField className="mt-1 w-44" ariaLabel="Through" value={to} onChange={setTo} min={from||""} placeholder="Select date"/></div>
      <button type="button" className="btn-secondary" onClick={load} disabled={loading}>{loading?'Loading':'Load summary'}</button>
      <button type="button" className="btn-secondary" onClick={download} disabled={!rows?.length}><Download size={14}/> Download Excel</button>
    </div>
    <div className="flex flex-wrap gap-3 items-center mt-3">
      <button type="button" className="btn-secondary" onClick={()=>downloadLabelled('xlsx')} disabled={labelBusy}><Download size={14}/> Labelled findings (Excel)</button>
      <button type="button" className="btn-secondary" onClick={()=>downloadLabelled('jsonl')} disabled={labelBusy}><Download size={14}/> Labelled findings (JSONL)</button>
      <span className="text-xs text-[var(--text-muted)]">One row per reviewed finding with the reviewer decision and note, for offline evaluation.</span>
    </div>
    {labelNote&&<p role="status" className="text-sm mt-2">{labelNote}</p>}
    {error&&<p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}
    {rows&&!rows.length&&<p className="text-sm text-[var(--text-muted)] mt-3">No AI jobs in this range.</p>}
    {rows&&rows.length>0&&<div className="mt-3">
      <EnterpriseTable columns={feedbackColumns} data={rows} getRowId={(r)=>r.model+'|'+r.prompt} enableGlobalFilter={false} enableColumnFilters={false} enableColumnVisibility={false} enableExport={false} emptyMessage="No AI jobs in this range."/>
      <p className="text-sm font-semibold mt-2">All models: {total.jobs} jobs | {total.reviewed} reviewed | {total.accepted} accepted | {total.rejected} rejected | {total.corrected} corrected | {total.unreviewed} awaiting | accept {total.acceptRate==null?'N/A':total.acceptRate+'%'} | reject {total.rejectRate==null?'N/A':total.rejectRate+'%'}</p>
      <p className="text-xs text-[var(--text-muted)] mt-2">Percentages are of reviewed findings and show N/A when nothing was reviewed. A high accept rate is not proof of accuracy; it reflects reviewer opinion only.</p></div>}
  </Card>
}

const FAILURE_TEXT = {
  invalid_model_output: 'The AI reply could not be read. Ask a manager to queue this photo again.',
  provider_timeout: 'The AI service timed out. Ask a manager to queue this photo again.',
  provider_http_error: 'The AI service returned an error. Ask a manager to queue this photo again.',
  provider_non_json: 'The AI service returned an unreadable reply. Ask a manager to queue this photo again.',
  photo_unavailable: 'The photograph could not be opened from storage.',
  invalid_reference: 'The photograph link is not valid.',
  prior_attempt: 'This photo was already analysed once. A manager must approve a new attempt.',
  stalled: 'Processing stopped before it finished. Ask a manager to queue this photo again.',
}
const failureText = (job) => FAILURE_TEXT[job.failure_kind] || job.error_message || 'Analysis failed.'
const STATUS_LABEL = { pending: 'Waiting', processing: 'Analysing', completed: 'Done', failed: 'Failed' }
const REVIEW_LABEL = { unreviewed: 'Not reviewed', accepted: 'Accepted', rejected: 'Rejected', corrected: 'Corrected' }
function queueNotice(res) {
  const eligible = Number(res?.eligible || 0)
  if (!eligible) return 'No eligible photographs were found for this inspection.'
  return `${eligible} photograph${eligible === 1 ? '' : 's'} found. Photos already analysed or waiting are not charged again. Results appear here within a few minutes.`
}
function photoCount(row) {
  const conditions = row?.tyre_conditions || {}
  return Object.values(conditions).filter(p => p && typeof p === 'object' && (p.photo_url || p.photo || p.photos || p.photo_refs) && conditionRequiresAnalysis(p.condition)).length
}
const DEFAULT_CONDITIONS=['Good','Wear','Worn','Damaged','Damage','Flat','Puncture']
export default function AiTyreInspection() {
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const role = profile?.role
  const mayBackfill = canBackfillAi(role)
  const mayViewFeedback = canViewAiFeedback(role)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [siteOptions, setSiteOptions] = useState([])
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const PAGE_SIZE = 50
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('evidence')
  const [filter, setFilter] = useState('all')
  const [siteFilter,setSiteFilter]=useState('all')
  const [conditionFilter,setConditionFilter]=useState('all')
  const [statusFilter,setStatusFilter]=useState('all')
  const [aiStatusFilter,setAiStatusFilter]=useState('all')
  const [reviewFilter,setReviewFilter]=useState('all')
  const [aiJobsByInspection,setAiJobsByInspection]=useState({})
  const [dateFrom,setDateFrom]=useState('')
  const [dateTo,setDateTo]=useState('')
  const requestSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true); setError('')
    try {
      // Date, site, status and vehicle/site text are applied by the database with an exact total.
      const { data, error: queryError, count } = await listAiRegisterFiltered({
        page, pageSize:PAGE_SIZE, country:activeCountry, dateFrom, dateTo,
        site:siteFilter, status:statusFilter, search:debouncedSearch,
        condition:conditionFilter, photos:filter==='photos', aiStatus:aiStatusFilter, review:reviewFilter,
      })
      if (queryError) throw queryError
      if (seq !== requestSeq.current) return // a newer request superseded this one
      setRows(data || [])
      setTotal(Number.isFinite(count) ? count : (data||[]).length)
    } catch (err) { setError(toUserMessage(err,'Unable to load inspections')) }
    finally { if (seq === requestSeq.current) setLoading(false) }
  }, [activeCountry,page,dateFrom,dateTo,siteFilter,statusFilter,debouncedSearch,conditionFilter,filter,aiStatusFilter,reviewFilter])
  useEffect(() => { load() }, [load])
  useEffect(()=>{const t=setTimeout(()=>setDebouncedSearch(search),350);return ()=>clearTimeout(t)},[search])
  // Any server-side filter change returns to the first page.
  useEffect(()=>{setPage(0)},[activeCountry,dateFrom,dateTo,siteFilter,statusFilter,debouncedSearch,conditionFilter,filter,aiStatusFilter,reviewFilter])
  useEffect(()=>{
    let active=true
    listDataSiteOptions(activeCountry).then(v=>{if(active)setSiteOptions(v)}).catch(()=>{if(active)setSiteOptions([])})
    return ()=>{active=false}
  },[activeCountry])
  useEffect(()=>{
    let active=true
    const ids=rows.map(r=>r.id).filter(Boolean)
    if(!ids.length){setAiJobsByInspection({});return}
    Promise.all(Array.from({length:Math.ceil(ids.length/100)},(_,i)=>readInspectionAnalysis(ids.slice(i*100,(i+1)*100))))
      .then(pages=>{
        if(!active)return
        const grouped={}
        pages.flat().forEach(j=>(grouped[j.inspection_id] ||= []).push(j))
        setAiJobsByInspection(grouped)
      }).catch(()=>{if(active)setAiJobsByInspection({})})
    return ()=>{active=false}
  },[rows])

  const records = useMemo(() => rows.map(row => {
      const positions = Object.entries(row.tyre_conditions || {}).filter(([,v])=>v && typeof v==='object')
      const measured = positions.map(([position,v]) => ({ position, ...calculateTread({
        originalMm:v.original_tread_mm ?? v.original_mm,
        measuredMm:v.tread_depth_mm ?? v.tread_mm,
        minimumMm:v.minimum_tread_mm ?? v.minimum_mm,
      }) }))
      return {...row, photosForReview:photoCount(row),
        measuredCount:measured.filter(v=>v.status!=='measurement_required').length,
        needsMeasurement:measured.filter(v=>v.status==='measurement_required').length}
    }), [rows])
  const sites = useMemo(()=>[...new Set([...siteOptions,...(siteFilter!=='all'?[siteFilter]:[])])].sort(),[siteOptions,siteFilter])
  const conditions = useMemo(()=>[...new Set([...DEFAULT_CONDITIONS,...conditionOptions(rows),...(conditionFilter!=='all'?[conditionFilter]:[])])].sort(),[rows,conditionFilter])
  const statuses = ['Scheduled','In Progress','Done','Overdue','Cancelled']
  const visibleRecords = useMemo(()=>applyRegisterFilters(records,aiJobsByInspection,{
    quick:filter,site:siteFilter,status:statusFilter,condition:conditionFilter,
    aiStatus:aiStatusFilter,review:reviewFilter,dateFrom,dateTo,
  }),[records,aiJobsByInspection,filter,siteFilter,statusFilter,conditionFilter,aiStatusFilter,reviewFilter,dateFrom,dateTo])
  // Related inspections for the selected vehicle: its own history and same-type peers on this page.
  const related = useMemo(()=>{
    if(!selected)return null
    const assetByInspection={}
    rows.forEach(r=>{assetByInspection[r.id]=r.asset_no||''})
    const own=rows.filter(r=>r.asset_no&&r.asset_no===selected.asset_no).map(r=>r.id)
    const type=String(selected.vehicle_type||'').trim().toUpperCase()
    const peers=type?rows.filter(r=>r.asset_no!==selected.asset_no&&String(r.vehicle_type||'').trim().toUpperCase()===type).map(r=>r.id):[]
    const ids=[...new Set([selected.id,...own,...peers])].slice(0,100)
    return {ids,assetByInspection,peerCount:peers.length}
  },[selected,rows])
  const [reporting,setReporting]=useState(false)
  const damageRows=useMemo(()=>buildDamageRows(visibleRecords,aiJobsByInspection,(i,p)=>displayPositionCode(inspectionTypeHint(i),p)),[visibleRecords,aiJobsByInspection])
  const runReport=async(kind)=>{
    setReporting(true);setError('')
    try{
      const dateRange=[dateFrom&&`From ${dateFrom}`,dateTo&&`Through ${dateTo}`].filter(Boolean).join(' ')
      await (kind==='pdf'?exportDamagePdf:exportDamageExcel)(damageRows,{dateRange})
    }catch(e){setError(toUserMessage(e,'Could not create the report'))}
    finally{setReporting(false)}
  }
  const resetFilters=()=>{setSearch('');setFilter('all');setSiteFilter('all');setStatusFilter('all');setConditionFilter('all');setAiStatusFilter('all');setReviewFilter('all');setDateFrom('');setDateTo('')}

  const columns = [
    { accessorKey:'inspection_date', header:'Date', cell:({row:{original:r}})=>r.inspection_date||'Not recorded' },
    { accessorKey:'asset_no', header:'Vehicle', cell:({row:{original:r}})=><button type="button" className="text-brand-bright hover:underline font-semibold" onClick={()=>{setSelected(r);setTab('evidence')}}>{r.asset_no||'Not recorded'}</button> },
    { accessorKey:'site', header:'Site', cell:({row:{original:r}})=>r.site||'Not recorded' },
    { accessorKey:'photosForReview', header:'Defect photos', cell:({row:{original:r}})=>r.photosForReview },
    { accessorKey:'measuredCount', header:'Measured positions', cell:({row:{original:r}})=>r.measuredCount },
    { accessorKey:'needsMeasurement', header:'Measurements missing', cell:({row:{original:r}})=>r.needsMeasurement },
    { accessorKey:'status', header:'Inspection status', cell:({row:{original:r}})=>r.status||'Unknown' },
  ]
  return <div className="space-y-4">
    <PageHeader title="AI Tyre Inspection" subtitle="Verified measurements and defect evidence. AI processing will appear only when the secure background service is configured." icon={SearchCheck} />
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><div className="flex items-center gap-2 text-sm"><ClipboardCheck size={17}/> Inspections loaded</div><div className="text-2xl font-semibold mt-2">{records.length}</div><div className="text-xs text-[var(--text-muted)]">on this page, {total} match on the server</div></Card>
      <Card><div className="flex items-center gap-2 text-sm"><ShieldAlert size={17}/> Defect photos for review</div><div className="text-2xl font-semibold mt-2">{records.reduce((sum,r)=>sum+r.photosForReview,0)}</div></Card>
      <Card><div className="flex items-center gap-2 text-sm"><Ruler size={17}/> Measured tyre positions</div><div className="text-2xl font-semibold mt-2">{records.reduce((sum,r)=>sum+r.measuredCount,0)}</div></Card>
    </div>
    {aiActionNotice(role)&&<p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{aiActionNotice(role)}</p>}
    {mayBackfill&&<details className="rounded-xl border border-[var(--border-dim)] px-4 py-3"><summary className="cursor-pointer font-medium">Historical AI backfill (managers only)</summary><div className="mt-3"><HistoricInspectionBackfill/></div></details>}
    {mayViewFeedback&&<details className="rounded-xl border border-[var(--border-dim)] px-4 py-3"><summary className="cursor-pointer font-medium">Reviewer feedback: evaluation data</summary><div className="mt-3"><ReviewFeedbackPanel/></div></details>}
    <Card>
      <div className="flex flex-wrap justify-between gap-3 mb-3">
        <div><h2 className="font-semibold">Inspection evidence register</h2><p className="text-xs text-[var(--text-muted)]">Date, site, status, search, condition, defect-photo, AI-status and review filters all run on the server across the whole register. Only the measured and missing-measurement chips apply to the page shown. Absence of a reading is never estimated from a photograph.</p></div>
        <div className="flex flex-wrap gap-2 items-start">
          <button type="button" className="btn btn-secondary" disabled={reporting||!damageRows.length} onClick={()=>runReport('excel')} title="Accepted / rejected / corrected / awaiting findings with photo links"><Download size={15}/> Excel report</button>
          <button type="button" className="btn btn-secondary" disabled={reporting||!damageRows.length} onClick={()=>runReport('pdf')} title="Findings with damage photos, grouped by supervisor decision"><FileText size={15}/> PDF report</button>
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter inspection evidence">{[['all','All'],['photos','With defect photos'],['measurements','Measured'],['missing','Missing measurements']].map(([key,label])=><button key={key} type="button" onClick={()=>setFilter(key)} aria-pressed={filter===key} className={'rounded-md border px-3 py-1.5 text-xs '+(filter===key?'bg-brand-subtle border-brand-bright text-brand-bright':'border-[var(--border-dim)] text-[var(--text-secondary)]')}>{label}</button>)}</div>
      <input className="input w-full max-w-sm mb-3" aria-label="Search vehicle or site" placeholder="Search vehicle or site" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3" aria-label="Advanced inspection filters">
        <label className="text-xs text-[var(--text-secondary)]">Site<select className="input w-full mt-1" value={siteFilter} onChange={e=>setSiteFilter(e.target.value)}><option value="all">All sites</option>{sites.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">Tyre condition<select className="input w-full mt-1" value={conditionFilter} onChange={e=>setConditionFilter(e.target.value)}><option value="all">All conditions</option>{conditions.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">Inspection status<select className="input w-full mt-1" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">AI analysis status<select className="input w-full mt-1" value={aiStatusFilter} onChange={e=>setAiStatusFilter(e.target.value)}>{[['all','All AI statuses'],['none','Not requested'],['pending','Pending'],['processing','Processing'],['completed','Completed'],['failed','Failed']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">Supervisor review<select className="input w-full mt-1" value={reviewFilter} onChange={e=>setReviewFilter(e.target.value)}>{[['all','All review states'],['unreviewed','Not reviewed'],['accepted','Accepted'],['rejected','Rejected'],['corrected','Corrected']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <div className="text-xs text-[var(--text-secondary)]"><span>From date</span><DateField className="mt-1 w-full" ariaLabel="From date" value={dateFrom} onChange={setDateFrom} placeholder="Select date"/></div>
        <div className="text-xs text-[var(--text-secondary)]"><span>Through date</span><DateField className="mt-1 w-full" ariaLabel="Through date" value={dateTo} onChange={setDateTo} min={dateFrom||""} placeholder="Select date"/></div>
      </div>
      <div className="flex items-center gap-3 mb-3"><button className="btn-secondary" type="button" onClick={resetFilters}>Clear all filters</button><span className="text-xs text-[var(--text-muted)]">{visibleRecords.length} shown on this page</span></div>
      {error && <p role="alert" className="text-red-500 mb-3">{error}</p>}
      {loading ? <p role="status" className="text-sm text-[var(--text-muted)] py-6">Loading inspections</p> : <EnterpriseTable columns={columns} data={visibleRecords} emptyMessage="No inspections found" />}
      <div className="flex items-center justify-between gap-3 mt-3 text-sm">
        <span className="text-xs text-[var(--text-muted)]">{total?`${page*PAGE_SIZE+1} to ${Math.min((page+1)*PAGE_SIZE,total)} of ${total}`:'0 inspections'}</span>
        <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button><button type="button" className="btn-secondary" disabled={loading||(page+1)*PAGE_SIZE>=total} onClick={()=>setPage(p=>p+1)}>Next</button></div>
      </div>
    </Card>
    {selected && <InspectionDetail inspection={selected} related={related} role={role} activeTab={tab} onTab={setTab} onClose={()=>setSelected(null)} />}
  </div>
}


function InspectionDetail({ inspection, related, role, activeTab, onTab, onClose }) {
  const mayQueue = canQueueAiAnalysis(role)
  const mayReview = canReviewAiFinding(role)
  const positionLabel = (position) => displayPositionCode(inspectionTypeHint(inspection), position)
  const evidence = useMemo(() => summarizeEvidence(inspection), [inspection])
  const allPhotosCount = useMemo(() => Object.values(normalizePositionConditions(inspection)).reduce(
    (sum, entry) => sum + (entry && typeof entry==='object' ? [
      ...normalizePhotographs(entry.photo_url),
      ...normalizePhotographs(entry.photo),
      ...normalizePhotographs(entry.photos),
      ...normalizePhotographs(entry.photo_refs),
    ].length : 0), 0), [inspection])
  const conditions = useMemo(() => normalizePositionConditions(inspection), [inspection])
  const readings = useMemo(() => Object.entries(conditions).map(([position, data]) => ({
    position, condition:data?.condition || 'Not recorded',
    calculation:measurementReading({
      inspectionId:inspection.id, position,
      originalMm:data?.original_tread_mm ?? data?.original_mm,
      minimumMm:data?.minimum_tread_mm ?? data?.minimum_mm,
      innerMm:data?.inner_tread_mm ?? data?.inner_mm,
      centerMm:data?.center_tread_mm ?? data?.tread_depth_mm ?? data?.tread_mm,
      outerMm:data?.outer_tread_mm ?? data?.outer_mm,
      source:data?.measurement_source || '',
      measuredAt:data?.measured_at || '',
    }),
  })), [conditions,inspection.id])
  const [vehicleMeasurements,setVehicleMeasurements]=useState([])
  const storedMeasurements=useMemo(()=>vehicleMeasurements.filter(m=>m.inspection_id===inspection.id),[vehicleMeasurements,inspection.id])
  const [analysisJobs,setAnalysisJobs]=useState([])
  const [reviewNotes,setReviewNotes]=useState({})
  const [analysisError,setAnalysisError]=useState('')
  const [analysisLoading,setAnalysisLoading]=useState(false)
  const [analysisNotice,setAnalysisNotice]=useState('')
  const refreshAnalysis=useCallback(async()=>{try{setAnalysisJobs(await readInspectionAnalysis([inspection.id]));setAnalysisError('')}catch(e){setAnalysisError(toUserMessage(e,'Could not load AI results'))}},[inspection.id])
  useEffect(()=>{refreshAnalysis()},[refreshAnalysis])
  const screenAll=async()=>{
    setAnalysisLoading(true)
    setAnalysisError('');setAnalysisNotice('')
    try {
      const res=await screenInspectionPhotos(inspection.id)
      setAnalysisNotice(queueNotice(res))
      await refreshAnalysis()
      onTab('analysis')
    } catch(e) {
      setAnalysisError(toUserMessage(e,'Could not start visual screening'))
    } finally { setAnalysisLoading(false) }
  }
  const enqueue=async()=>{setAnalysisLoading(true);setAnalysisError('');setAnalysisNotice('');try{setAnalysisNotice(queueNotice(await enqueueInspectionPhotos(inspection.id)));await refreshAnalysis()}catch(e){setAnalysisError(toUserMessage(e,'Could not queue photos'))}finally{setAnalysisLoading(false)}}
  const decide=async(job,decision)=>{setAnalysisLoading(true);try{await reviewAiFinding(job.id,decision,reviewNotes[job.id]?.trim() || (decision==='accepted'?'Reviewer confirmed visible evidence':'Reviewer rejected finding; reason not specified'));await refreshAnalysis()}catch(e){setAnalysisError(toUserMessage(e,'Could not save review'))}finally{setAnalysisLoading(false)}}
  const [measurementError,setMeasurementError]=useState('')
  const [savingMeasurement,setSavingMeasurement]=useState(false)
  const [form,setForm]=useState({position:'',source:'manual_gauge',originalMm:'',minimumMm:'',innerMm:'',centerMm:'',outerMm:'',odometerKm:'',tyreSerial:''})
  const relatedIds=related?.ids?.length?related.ids:[inspection.id]
  const relatedKey=relatedIds.join(',')
  const refreshMeasurements=useCallback(async()=>{try{setVehicleMeasurements(await readInspectionMeasurements(relatedKey.split(',')));setMeasurementError('')}catch(e){setMeasurementError(toUserMessage(e,'Could not load measured depths'))}},[relatedKey])
  useEffect(()=>{refreshMeasurements()},[refreshMeasurements])
  const saveMeasurement=async(e)=>{e.preventDefault();setSavingMeasurement(true);setMeasurementError('');try{await recordDepthMeasurement({...form,inspectionId:inspection.id});await refreshMeasurements();setForm(f=>({...f,innerMm:'',centerMm:'',outerMm:''}))}catch(err){setMeasurementError(toUserMessage(err,'Unable to save measurement'))}finally{setSavingMeasurement(false)}}
  const tabs=[
    ['evidence','Damage evidence',ImageIcon],
    ['measurements','Tread measurements',Ruler],
    ['analysis','AI analysis status',SearchCheck],
    ['report','Report preview',FileText],
  ]
  const latestSavedByPosition=useMemo(()=>{
    const result=new Map()
    for(const row of storedMeasurements){
      const current=result.get(row.tyre_position)
      if(!current || Date.parse(row.measured_at)>Date.parse(current.measured_at))result.set(row.tyre_position,row)
    }
    return result
  },[storedMeasurements])
  const displayedReadings=useMemo(()=>readings.map(item=>{
    const saved=latestSavedByPosition.get(item.position)
    if(!saved)return item
    return {...item,calculation:measurementReading({
      inspectionId:inspection.id,position:item.position,
      originalMm:saved.original_mm,minimumMm:saved.minimum_mm,
      innerMm:saved.inner_mm,centerMm:saved.center_mm,outerMm:saved.outer_mm,
      source:saved.source,measuredAt:saved.measured_at,
    })}
  }),[readings,latestSavedByPosition,inspection.id])
  const missing=displayedReadings.filter(item=>!item.calculation.valid)
  const verified=displayedReadings.filter(item=>item.calculation.valid)
  const appendix=useMemo(()=>buildInspectionAiAppendix({inspection,jobs:analysisJobs,measurements:storedMeasurements}),[inspection,analysisJobs,storedMeasurements])
  const assetOf=useCallback(id=>related?.assetByInspection?.[id]??(id===inspection.id?inspection.asset_no||'':''),[related,inspection])
  const engine=useMemo(()=>analyzeMeasurements(vehicleMeasurements,{assetOf}),[vehicleMeasurements,assetOf])
  const ownAsset=inspection.asset_no||''
  const ownSeries=useMemo(()=>engine.series.filter(x=>x.assetKey===ownAsset),[engine,ownAsset])
  const seriesByPosition=useMemo(()=>{
    const map=new Map()
    for(const x of ownSeries){
      const cur=map.get(x.position)
      if(!cur||String(x.latest?.measuredAt||'')>String(cur.latest?.measuredAt||''))map.set(x.position,x)
    }
    return map
  },[ownSeries])
  const ownReadingIds=useMemo(()=>new Set(vehicleMeasurements.filter(m=>assetOf(m.inspection_id)===ownAsset).map(m=>m.id)),[vehicleMeasurements,assetOf,ownAsset])
  const ownIssues=useMemo(()=>engine.issues.filter(i=>ownReadingIds.has(i.readingId)),[engine,ownReadingIds])
  const [seriesOpen,setSeriesOpen]=useState(null)
  const analysisRows=useMemo(()=>{
    const known=new Set()
    const rowsOut=[]
    for(const x of ownSeries){known.add(x.position);rowsOut.push({id:x.key,position:x.position,series:x})}
    for(const r of displayedReadings)if(!known.has(r.position))rowsOut.push({id:'none|'+r.position,position:r.position,series:null})
    return rowsOut
  },[ownSeries,displayedReadings])
  const exportDetailedExcel=()=>exportInspectionExcel({inspection,readings:displayedReadings,analysisJobs,evidence,positionLabel,seriesByPosition})

  const readingColumns = useMemo(() => [
    { id: 'position', header: 'Position', accessorFn: (i) => positionLabel(i.position), cell: ({ row }) => <span className="font-semibold">{positionLabel(row.original.position)}</span> },
    { id: 'condition', header: 'Condition', accessorFn: (i) => i.condition },
    { id: 'measured', header: 'Measured depth', accessorFn: (i) => (i.calculation.valid ? i.calculation.reading.worstMm + ' mm' : 'Not measured') },
    { id: 'usable', header: 'Remaining usable', accessorFn: (i) => (i.calculation.valid ? i.calculation.reading.remainingMm + ' mm' : 'N/A') },
    { id: 'pct', header: 'Remaining %', accessorFn: (i) => (i.calculation.valid ? i.calculation.reading.remainingPercent + '%' : 'N/A') },
    { id: 'verification', header: 'Verification', accessorFn: (i) => (i.calculation.valid ? 'Recorded measurement' : 'Measurement required') },
  ], [inspection]) // eslint-disable-line react-hooks/exhaustive-deps

  const wearColumns = useMemo(() => {
    const flagCell = (x) => !x ? 'Not measured' : x.replace.flag === null ? 'Not measured' : x.replace.flag
      ? <span className="font-semibold text-red-500" title={x.replace.reasons.join(' ')}>Replace soon</span> : 'No'
    return [
      { id: 'position', header: 'Position', accessorFn: (r) => positionLabel(r.position), cell: ({ row }) => <span className="font-semibold">{positionLabel(row.original.position)}</span> },
      { id: 'serial', header: 'Serial', accessorFn: (r) => r.series?.serial || 'Not recorded' },
      { id: 'readings', header: 'Readings', accessorFn: (r) => r.series ? r.series.segmentReadings : 0 },
      { id: 'depth', header: 'Latest depth', accessorFn: (r) => describeSeries(r.series).depth },
      { id: 'rate', header: 'Wear rate', accessorFn: (r) => describeSeries(r.series).rate },
      { id: 'km', header: 'Est. km to limit', accessorFn: (r) => describeSeries(r.series).kmLeft },
      { id: 'days', header: 'Est. days', accessorFn: (r) => describeSeries(r.series).daysLeft },
      { id: 'fleet', header: 'Vs fleet', accessorFn: (r) => describeSeries(r.series).fleet },
      { id: 'flag', header: 'Replacement', accessorFn: (r) => r.series ? (r.series.replace.flag === null ? 'Not measured' : r.series.replace.flag ? 'Replace soon' : 'No') : 'Not measured', cell: ({ row }) => flagCell(row.original.series) },
    ]
  }, [inspection]) // eslint-disable-line react-hooks/exhaustive-deps

  return <SideDrawer open onClose={onClose} size="xl" title={inspection.asset_no || 'Unknown vehicle'} closeLabel="Close details" bodyClassName="p-0">
    <div className="text-[var(--text-primary)]">
      <div className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border-dim)] px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><ClipboardCheck size={14}/> Inspection detail</div>
          <button className="btn-secondary mt-3 inline-flex items-center gap-2 text-sm" type="button" onClick={exportDetailedExcel}><Download size={15}/> Download full AI inspection Excel</button>
          <p className="text-xs text-[var(--text-secondary)] mt-1">{inspection.site || 'Site not recorded'} | {inspection.inspection_date || 'Date not recorded'} | {inspection.inspector || 'Inspector not recorded'}</p>
        </div>
        <div className="flex gap-2 flex-wrap mt-4" role="tablist">
          {tabs.map(([id,label,Icon])=><button key={id} role="tab" aria-selected={id===activeTab}
            className={'inline-flex items-center gap-2 text-xs rounded-md px-3 py-2 border '+(id===activeTab?'bg-brand-subtle border-brand-bright text-brand-bright':'border-[var(--border-dim)] text-[var(--text-secondary)]')}
            onClick={()=>onTab(id)}><Icon size={14}/>{label}</button>)}
        </div>
      </div>
      <div className="p-5 space-y-4">
        {activeTab==='evidence' && <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Tyre positions" value={evidence.positions}/>
            <Metric label="Abnormal" value={evidence.abnormalPositions}/>
            <Metric label="Photos available" value={evidence.allPhotoCount}/>
            <Metric label="No evidence" value={evidence.abnormalPositionsMissingPhotos.length}/>
          </div>
          {evidence.abnormalPositionsMissingPhotos.length>0 && <div className="rounded-lg p-3 border border-amber-500/30 bg-amber-500/10 flex items-start gap-2 text-sm"><AlertCircle size={17} className="text-amber-500 shrink-0"/><span>No photo is linked to abnormal positions: {evidence.abnormalPositionsMissingPhotos.map(positionLabel).join(', ')}. Request evidence from the inspector.</span></div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {evidence.allPhotos.map(photo=>{
              const key=photo.position+':'+photo.ref
              return <div key={key} className="rounded-xl border border-[var(--border-dim)] overflow-hidden">
                <div className="p-3 flex justify-between items-center"><span className="font-semibold">{positionLabel(photo.position)}</span><span className="text-xs text-[var(--text-muted)]">{photo.condition}</span></div>
                <LazyTyrePhoto photoRef={photo.ref} alt={'Tyre evidence at '+photo.position} className="w-full h-56 object-contain bg-[var(--panel-2)]"/>
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Image evidence only. Exact tread depth requires a gauge reading.</div>
              </div>
            })}
          </div>
          {!evidence.allPhotos.length && <EmptyState icon={ImageIcon} title="No tyre photographs" description="Photos will appear here when inspectors attach photos to tyre positions."/>}
        </>}
        {activeTab==='measurements' && <>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Positions" value={readings.length}/>
            <Metric label="Complete readings" value={verified.length}/>
            <Metric label="Need verification" value={missing.length}/>
          </div>
          <EnterpriseTable
            columns={readingColumns}
            data={displayedReadings}
            getRowId={(item)=>String(item.position)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableColumnVisibility={false}
            enableExport={false}
            emptyMessage="No tyre positions recorded"
          />
          <Card>
            <div className="flex flex-wrap justify-between gap-2 mb-2"><h3 className="font-semibold">Wear analysis from repeated gauge readings</h3><span className="text-xs text-[var(--text-muted)]">{related?.peerCount?`Compared with ${related.peerCount} same-type inspection(s) on this page`:'No same-type vehicles on this page to compare'}</span></div>
            <p className="text-xs text-[var(--text-muted)] mb-3">Uses physical gauge readings of the same tyre over time. Estimates are trend aids, not serviceability decisions. Nothing is estimated from photographs; a missing figure reads Not measured.</p>
            <EnterpriseTable
              columns={wearColumns}
              data={analysisRows}
              getRowId={(row)=>row.id}
              onRowClick={(row)=>row.series&&setSeriesOpen(row.series)}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableColumnVisibility={false}
              enableExport={false}
              emptyMessage="No tyre positions recorded"
            />
            {ownIssues.length>0&&<details className="mt-3 rounded-lg border border-[var(--border-dim)] px-3 py-2 text-sm"><summary className="cursor-pointer font-medium">Data checks ({ownIssues.length})</summary><ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">{ownIssues.map((i,n)=><li key={n}><strong>{i.severity==='error'?'Excluded':'Warning'}</strong> | {positionLabel(i.position)}{i.serial?' | '+i.serial:''}: {i.message}</li>)}</ul></details>}
          </Card>
          <Card>
            <h3 className="font-semibold">Record a verified gauge reading</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">Use a physical or calibrated gauge. Fields marked required must be filled; add at least one groove reading.</p>
            <form onSubmit={saveMeasurement} className="space-y-5">
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Tyre</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-xs text-[var(--text-secondary)]">Tyre position (required)
                    <select className="input w-full mt-1" required value={form.position} onChange={e=>setForm(f=>({...f,position:e.target.value}))}>
                      <option value="">Select position</option>
                      {Object.keys(conditions).map(pos=><option key={pos} value={pos}>{positionLabel(pos)}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--text-secondary)]">Tyre serial
                    <input className="input w-full mt-1" type="text" value={form.tyreSerial} onChange={e=>setForm(f=>({...f,tyreSerial:e.target.value}))}/>
                  </label>
                  <label className="text-xs text-[var(--text-secondary)]">Measurement source
                    <select className="input w-full mt-1" value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value}))}>
                      <option value="manual_gauge">Manual physical gauge</option>
                      <option value="digital_gauge">Digital physical gauge</option>
                      <option value="calibrated_device">Calibrated measurement device</option>
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Tread limits (mm)</legend>
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  {[['originalMm','Original tread (required)',true],['minimumMm','Minimum tread (required)',true]].map(([key,label,req])=>
                    <label key={key} className="text-xs text-[var(--text-secondary)]">{label}
                      <input className="input w-full mt-1" required={req} type="number" step="0.01" min="0" value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>
                    </label>)}
                </div>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Groove readings (mm, at least one)</legend>
                <div className="grid grid-cols-3 gap-3 max-w-xl">
                  {[['innerMm','Inner'],['centerMm','Centre'],['outerMm','Outer']].map(([key,label])=>
                    <label key={key} className="text-xs text-[var(--text-secondary)]">{label}
                      <input className="input w-full mt-1" type="number" step="0.01" min="0" value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>
                    </label>)}
                </div>
                <label className="text-xs text-[var(--text-secondary)] block max-w-xs">Odometer km (optional)
                  <input className="input w-full mt-1" type="number" step="1" min="0" value={form.odometerKm} onChange={e=>setForm(f=>({...f,odometerKm:e.target.value}))}/>
                </label>
              </fieldset>
              <div className="flex items-center gap-3">
                <button className="btn-primary" type="submit" disabled={savingMeasurement||!(form.innerMm!==''||form.centerMm!==''||form.outerMm!=='')}>{savingMeasurement?'Saving':'Save physical reading'}</button>
                {!(form.innerMm!==''||form.centerMm!==''||form.outerMm!=='')&&<span className="text-xs text-[var(--text-muted)]">Enter at least one groove reading to save.</span>}
              </div>
            </form>
          </Card>
          {measurementError && <p role="alert" className="text-red-500">{measurementError}</p>}
          <Card><h3 className="font-semibold mb-2">Stored physical measurement history</h3><div className="space-y-2">{storedMeasurements.map(m=><div key={m.id} className="text-sm border-b border-[var(--border-dim)] pb-2">{positionLabel(m.tyre_position)} | {m.source} | Inner {m.inner_mm??"N/A"} / Centre {m.center_mm??"N/A"} / Outer {m.outer_mm??"N/A"} mm | {m.measured_at}</div>)}{!storedMeasurements.length && <p className="text-sm text-[var(--text-muted)]">No physical readings submitted through this module yet.</p>}</div></Card>
          <p className="text-xs text-[var(--text-muted)]">Only physically sourced and validated measurements are eligible for authoritative remaining-tread figures. This screen does not infer millimetres from photographs.</p>
        </>}
        {activeTab==='analysis' && <>
          <Card>
            <div className="flex justify-between items-start gap-4 flex-wrap">
              <div><h3 className="font-semibold">AI photo review</h3><p className="text-xs text-[var(--text-muted)] mt-1">The background worker can inspect visible damage or, on demand, screen all photographed tyres without a gauge. It identifies patterns, not exact tread-depth millimetres. Findings require qualified review.</p></div>
              <div className="flex gap-2"><button className="btn-secondary" onClick={refreshAnalysis} disabled={analysisLoading}>Refresh</button><button className="btn-primary" onClick={enqueue} disabled={!mayQueue||analysisLoading||!evidence.photos.length} title={mayQueue?undefined:'Your role cannot queue AI analysis'}>{analysisLoading?'Working':'Queue defect photos'}</button><button className="btn-secondary" type="button" onClick={screenAll} disabled={!mayQueue||analysisLoading||!evidence.allPhotoCount} title={mayQueue?undefined:'Your role cannot queue AI analysis'}>{analysisLoading?'Working':'Screen all photographed tyres'}</button></div>
            </div>
            {analysisError && <p role="alert" className="text-red-500 text-sm mt-3">{analysisError}</p>}
            {analysisNotice && <p role="status" className="text-sm mt-3 text-[var(--text-secondary)]">{analysisNotice}</p>}
          </Card>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Metric label="Queued" value={analysisJobs.length}/><Metric label="Completed" value={analysisJobs.filter(j=>j.status==='completed').length}/><Metric label="Pending" value={analysisJobs.filter(j=>['pending','processing'].includes(j.status)).length}/><Metric label="Failed" value={analysisJobs.filter(j=>j.status==='failed').length}/></div>
          <div className="rounded-xl border border-[var(--border-dim)] p-3 text-sm"><strong>Review quality summary</strong><div className="flex flex-wrap gap-4 mt-2">
            <span>Accepted: {analysisJobs.filter(j=>j.review_status==='accepted').length}</span>
            <span>Rejected: {analysisJobs.filter(j=>j.review_status==='rejected').length}</span>
            <span>Awaiting review: {analysisJobs.filter(j=>j.status==='completed' && (!j.review_status||j.review_status==='unreviewed')).length}</span>
          </div><p className="text-xs text-[var(--text-muted)] mt-1">Your decisions and reasons are retained as structured feedback for future quality evaluation. No automatic model retraining or unsafe auto-approval is performed.</p></div>
          <div className="space-y-3">{analysisJobs.map(job=><Card key={job.id}>
            <div className="flex justify-between items-center gap-3"><h4 className="font-semibold">{positionLabel(job.tyre_position)}</h4><span className="text-xs">{STATUS_LABEL[job.status]||job.status} | {REVIEW_LABEL[job.review_status||'unreviewed']||job.review_status}</span></div>{job.photo_ref && <div className="mt-3"><LazyTyrePhoto photoRef={job.photo_ref} alt={'Original tyre photo for supervisor verification at '+job.tyre_position} className="h-48 max-w-full rounded-lg border border-[var(--border-dim)] object-contain"/><p className="text-xs text-[var(--text-muted)] mt-1">Original photograph: enlarge and compare before review</p></div>}
            {job.analysis?<div className="mt-3 space-y-2"><p className="text-sm">{job.analysis.assessable?'Visual assessment available':(job.analysis.reason||'Image unassessable')}</p>{(job.analysis.defects||[]).map((d,i)=><p key={i} className="text-sm border-l-2 border-amber-500 pl-3">{d.type}: {d.description} ({d.severity})</p>)}<p className="text-sm text-[var(--text-secondary)]">{job.analysis.recommendation}</p></div>:<p className={'text-xs mt-2 '+(job.status==='failed'?'text-red-500':'text-[var(--text-muted)]')}>{job.status==='failed'?failureText(job):job.status==='completed'?'No finding recorded.':'Waiting for the analysis service.'}</p>}
            {mayReview && job.status==='completed' && (!job.review_status || job.review_status==='unreviewed')&&<div className="mt-3 space-y-2"><label className="block text-xs text-[var(--text-secondary)]">Review reason / improvement feedback<textarea className="input block w-full mt-1" rows={2} placeholder="Describe the confirmed damage, false positive, blur, or missing evidence" value={reviewNotes[job.id]||''} onChange={e=>setReviewNotes(v=>({...v,[job.id]:e.target.value}))}/></label><div className="flex gap-2 flex-wrap"><button className="btn-secondary" disabled={analysisLoading} onClick={()=>decide(job,'accepted')}>Accept observation</button><button className="btn-secondary" disabled={analysisLoading} onClick={()=>decide(job,'rejected')}>Reject observation</button></div></div>}
          </Card>)}</div>
          {!analysisJobs.length && <EmptyState icon={SearchCheck} title="No queued image analysis" description="Request server-side analysis to create jobs for the linked abnormal-tyre photographs."/>}
        </>}
        {activeTab==='report' && <>
          <p className="text-xs text-[var(--text-muted)]">Live preview of saved AI analysis and physical gauge readings. The existing Vehicle Tyres Inspection Report PDF includes available AI advisory findings.</p>
          <div className="rounded-lg border border-[var(--border-dim)] bg-white text-slate-900 p-5 overflow-x-auto">
            <style>{INSPECTION_AI_PRINT_STYLES}</style>
            <div dangerouslySetInnerHTML={{__html:appendix}}/>
          </div>
          <div className="flex gap-2 items-start rounded-md bg-[var(--panel-2)] p-3 text-xs text-[var(--text-secondary)]"><ClipboardList size={15} className="shrink-0"/> Use Inspections → Download PDF for the existing vehicle inspection report. AI observations are advisory; verified depth readings are stored separately and must not be replaced by estimated photo measurements.</div>
        </>}
      </div>
    </div>
    {seriesOpen&&<SeriesDrawer series={seriesOpen} label={positionLabel(seriesOpen.position)} onClose={()=>setSeriesOpen(null)}/>}
  </SideDrawer>
}
function SeriesDrawer({series,label,onClose}) {
  const d=describeSeries(series)
  const p=series.projection
  return <SideDrawer open onClose={onClose} size="md" title={label+(series.serial?' | '+series.serial:'')} subtitle="Physical gauge trend" closeLabel="Close wear analysis">
    <div className="p-5 space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Latest depth" value={d.depth}/><Metric label="Remaining usable" value={d.remaining}/>
        <Metric label="Wear rate" value={d.rate}/><Metric label="Est. km to limit" value={d.kmLeft}/>
        <Metric label="Est. days" value={d.daysLeft}/><Metric label="Vs fleet median" value={d.fleet}/>
      </div>
      {series.status!=='ok'&&<p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">{series.insufficientReason}</p>}
      {series.wear&&<p className="text-xs text-[var(--text-muted)]">Based on {series.wear.readingsUsed} readings over {series.wear.spanKm!=null?series.wear.spanKm.toLocaleString('en-US')+' km / ':''}{series.wear.spanDays} days. Confidence: <strong>{series.wear.confidence}</strong>{series.wear.implausible?' (rate looks implausibly fast; check the readings)':''}. {series.wear.band}{p?.projectedDate?' Projected to reach the limit around '+p.projectedDate+'.':''}</p>}
      {series.replace.flag!==null&&<div><h4 className="font-semibold mb-1">Replacement planning</h4>{series.replace.reasons.length?<ul className="list-disc ml-5 text-xs space-y-1">{series.replace.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul>:<p className="text-xs text-[var(--text-muted)]">No replacement trigger at the latest reading.</p>}</div>}
      <div><h4 className="font-semibold mb-1">Wear pattern (indicative)</h4>{series.hints.length?series.hints.map(h=><p key={h.code} className="text-xs border-l-2 border-amber-500 pl-3 mb-2"><strong>{h.label}{h.persistent?' (seen in consecutive readings)':''}</strong><br/>{h.detail}</p>):<p className="text-xs text-[var(--text-muted)]">{series.latest&&series.latest.innerMm!==null&&series.latest.outerMm!==null?'No uneven wear indicated at the latest reading.':'Inner, centre and outer depths are needed to judge the wear pattern. Not measured.'}</p>}</div>
      {p&&<p className="text-xs text-[var(--text-muted)]">{p.disclaimer}</p>}
    </div>
  </SideDrawer>
}
function Metric({label,value}) {
  return <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)] p-3"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="text-xl font-bold mt-1">{value}</div></div>
}
function EmptyState({icon:Icon,title,description}) {
  return <div className="border border-dashed border-[var(--border-dim)] rounded-lg py-12 px-4 flex flex-col items-center text-center"><Icon size={26} className="text-[var(--text-muted)] mb-3"/><h3 className="font-semibold">{title}</h3><p className="text-sm text-[var(--text-muted)] mt-2 max-w-md">{description}</p></div>
}

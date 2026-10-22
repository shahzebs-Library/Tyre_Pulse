import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, RefreshCw, ShieldAlert, SearchCheck, Ruler, X, Image as ImageIcon, ClipboardList, AlertCircle, FileText, Download } from 'lucide-react'
import { resolveStorageUrl } from '../lib/storageRefs'
import { displayPositionCode, inspectionTypeHint } from '../lib/tyreBay'
import { inspectablePhotoRefs, summarizeEvidence, normalizePositionConditions, normalizePhotographs, measurementReading } from '../lib/aiTyreInspectionDomain'
import { buildInspectionAiAppendix, INSPECTION_AI_PRINT_STYLES } from '../lib/aiTyreInspectionReport'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { listInspectionsForAiRegister } from '../lib/api/inspections'
import { listDataSiteOptions } from '../lib/api/sites'
import { useAuth } from '../contexts/AuthContext'
import { canQueueAiAnalysis, canReviewAiFinding, canBackfillAi, canViewAiFeedback, aiActionNotice } from '../lib/aiTyreInspectionRoles'
import { shapeFeedbackRows, summarizeFeedback, feedbackExportRows, FEEDBACK_EXPORT_COLUMNS, FEEDBACK_DISCLAIMER } from '../lib/aiTyreReviewFeedback'
import { exportToExcel } from '../lib/exportUtils'
import { calculateTread, conditionRequiresAnalysis } from '../lib/aiTyreInspection'
import { readInspectionMeasurements, recordDepthMeasurement, readInspectionAnalysis, enqueueInspectionPhotos, reviewAiFinding, backfillAiInspectionRange, screenInspectionPhotos, getAiReviewFeedback } from '../lib/api/aiTyreInspection'

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
    setRunning(true);setError('');setResult(null)
    try{
      const dates=saudiRange(from,through)
      let page=0,scanned=0,eligible=0,created=0
      while (page<25) {
        const res=await backfillAiInspectionRange({...dates,page})
        scanned+=Number(res.scanned||0)
        eligible+=Number(res.eligible||0)
        created+=Number(res.created||0)
        setResult({scanned,eligible,created,more:res.next_page!=null})
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
      <label className="text-xs text-[var(--text-secondary)]">From<input type="date" className="input mt-1 block" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="text-xs text-[var(--text-secondary)]">Through<input type="date" className="input mt-1 block" required value={through} onChange={e=>setThrough(e.target.value)}/></label>
      <button className="btn-primary" type="submit" disabled={running}>{running?'Queuing inspections…':'Queue historical inspections'}</button>
    </form>
    {error&&<p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}
    {result&&<div role="status" className="mt-3 rounded-lg border border-[var(--border-dim)] p-3 text-sm">
      Inspections checked: <strong>{result.scanned}</strong> · Eligible photos: <strong>{result.eligible}</strong> · Newly queued: <strong>{result.created}</strong>
      {result.more&&<p className="text-xs text-amber-500 mt-1">More records remain for this range; select a shorter range for a complete batch.</p>}
    </div>}
  </Card>
}

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
  const download=()=>exportToExcel(feedbackExportRows(rows||[]),FEEDBACK_EXPORT_COLUMNS.map(([k])=>k),FEEDBACK_EXPORT_COLUMNS.map(([,h])=>h),'AI tyre reviewer feedback (evaluation data)','Reviewer feedback')
  return <Card>
    <h2 className="font-semibold">Reviewer feedback: evaluation data</h2>
    <p className="text-xs text-[var(--text-muted)] mt-1 mb-3">{FEEDBACK_DISCLAIMER}</p>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-xs text-[var(--text-secondary)]">From<input type="date" className="input mt-1 block" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="text-xs text-[var(--text-secondary)]">Through<input type="date" className="input mt-1 block" min={from||undefined} value={to} onChange={e=>setTo(e.target.value)}/></label>
      <button type="button" className="btn-secondary" onClick={load} disabled={loading}>{loading?'Loading…':'Load summary'}</button>
      <button type="button" className="btn-secondary" onClick={download} disabled={!rows?.length}><Download size={14}/> Download Excel</button>
    </div>
    {error&&<p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}
    {rows&&!rows.length&&<p className="text-sm text-[var(--text-muted)] mt-3">No AI jobs in this range.</p>}
    {rows&&rows.length>0&&<div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-[var(--text-muted)]">{['Model','Prompt','Jobs','Reviewed','Accepted','Rejected','Corrected','Awaiting','Accept %','Reject %'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead>
      <tbody>{rows.map(r=><tr key={r.model+'|'+r.prompt} className="border-t border-[var(--border-dim)]"><td className="p-2">{r.model}</td><td className="p-2">{r.prompt}</td><td className="p-2">{r.jobs}</td><td className="p-2">{r.reviewed}</td><td className="p-2">{r.accepted}</td><td className="p-2">{r.rejected}</td><td className="p-2">{r.corrected}</td><td className="p-2">{r.unreviewed}</td><td className="p-2">{r.acceptRate==null?'N/A':r.acceptRate+'%'}</td><td className="p-2">{r.rejectRate==null?'N/A':r.rejectRate+'%'}</td></tr>)}
      <tr className="border-t-2 border-[var(--border-dim)] font-semibold"><td className="p-2" colSpan={2}>All</td><td className="p-2">{total.jobs}</td><td className="p-2">{total.reviewed}</td><td className="p-2">{total.accepted}</td><td className="p-2">{total.rejected}</td><td className="p-2">{total.corrected}</td><td className="p-2">{total.unreviewed}</td><td className="p-2">{total.acceptRate==null?'N/A':total.acceptRate+'%'}</td><td className="p-2">{total.rejectRate==null?'N/A':total.rejectRate+'%'}</td></tr></tbody></table>
      <p className="text-xs text-[var(--text-muted)] mt-2">Percentages are of reviewed findings and show N/A when nothing was reviewed. A high accept rate is not proof of accuracy; it reflects reviewer opinion only.</p></div>}
  </Card>
}

function PhotoCaptureGuide() {
  return <Card>
    <h3 className="font-semibold mb-2">How to capture a measurable tyre inspection</h3>
    <ol className="text-sm text-[var(--text-secondary)] list-decimal ml-5 space-y-2">
      <li>Identify the vehicle and exact canonical tyre position (for example LHF1 or RHRO) before taking photos. Keep each photo linked to that position.</li>
      <li>Take an overall tread-face photograph in good, even light, with the full tread width visible and the camera roughly perpendicular to the tread.</li>
      <li>Take a close-up of every cut, bulge, exposed cord, cracking or uneven-wear area, plus a sidewall photo when relevant. Keep the image sharp and avoid glare.</li>
      <li>Measure tread depth using a physical depth gauge in the main grooves at inner, centre and outer tread bands. Photograph the gauge in each groove with its scale/display clearly readable.</li>
      <li>Enter the measured millimetres under Tread measurements, with the gauge source and the tyre's verified original and minimum permitted depths. A gauge photograph supports review but does not automatically certify a measurement.</li>
      <li>For remaining mileage or wear trends, record the odometer and repeat gauge measurements against the same tyre serial over time. If measurements are missing, the report must say Not measured.</li>
    </ol>
    <p className="text-xs mt-3 text-[var(--text-muted)]">A standard photograph alone has no reliable millimetre scale; AI can flag visible abnormalities but must not invent exact depths, engine-hour readings, or service-life predictions.</p>
  </Card>
}

function photoCount(row) {
  const conditions = row?.tyre_conditions || {}
  return Object.values(conditions).filter(p => p && typeof p === 'object' && (p.photo_url || p.photo || p.photos || p.photo_refs) && conditionRequiresAnalysis(p.condition)).length
}
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
      const { data, error: queryError, count } = await listInspectionsForAiRegister({
        page, pageSize:PAGE_SIZE, country:activeCountry, dateFrom, dateTo,
        site:siteFilter, status:statusFilter, search:debouncedSearch,
      })
      if (queryError) throw queryError
      if (seq !== requestSeq.current) return // a newer request superseded this one
      setRows(data || [])
      setTotal(Number.isFinite(count) ? count : (data||[]).length)
    } catch (err) { setError(toUserMessage(err,'Unable to load inspections')) }
    finally { if (seq === requestSeq.current) setLoading(false) }
  }, [activeCountry,page,dateFrom,dateTo,siteFilter,statusFilter,debouncedSearch])
  useEffect(() => { load() }, [load])
  useEffect(()=>{const t=setTimeout(()=>setDebouncedSearch(search),350);return ()=>clearTimeout(t)},[search])
  // Any server-side filter change returns to the first page.
  useEffect(()=>{setPage(0)},[activeCountry,dateFrom,dateTo,siteFilter,statusFilter,debouncedSearch])
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
  const conditions = useMemo(()=>[...new Set(rows.flatMap(r=>Object.values(normalizePositionConditions(r)).map(v=>v?.condition).filter(Boolean)))].sort(),[rows])
  const statuses = ['Scheduled','In Progress','Done','Overdue','Cancelled']
  const visibleRecords = records.filter(r=>{
    if(filter==='photos' && !r.photosForReview)return false
    if(filter==='measurements' && !r.measuredCount)return false
    if(filter==='missing' && !r.needsMeasurement)return false
    const jobs=aiJobsByInspection[r.id]||[]
    if(aiStatusFilter==='none' && jobs.length)return false
    if(aiStatusFilter!=='all' && aiStatusFilter!=='none' && !jobs.some(j=>j.status===aiStatusFilter))return false
    if(reviewFilter!=='all' && !jobs.some(j=>(j.review_status||'unreviewed')===reviewFilter))return false
    if(conditionFilter!=='all' && !Object.values(normalizePositionConditions(r)).some(v=>v?.condition===conditionFilter))return false
    return true
  })
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
    <details className="rounded-xl border border-[var(--border-dim)] px-4 py-3"><summary className="cursor-pointer font-medium">Photo capture guide — expand when needed</summary><div className="mt-3"><PhotoCaptureGuide/></div></details>
    {aiActionNotice(role)&&<p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{aiActionNotice(role)}</p>}
    {mayBackfill&&<details className="rounded-xl border border-[var(--border-dim)] px-4 py-3"><summary className="cursor-pointer font-medium">Historical AI backfill — managers only</summary><div className="mt-3"><HistoricInspectionBackfill/></div></details>}
    {mayViewFeedback&&<details className="rounded-xl border border-[var(--border-dim)] px-4 py-3"><summary className="cursor-pointer font-medium">Reviewer feedback: evaluation data</summary><div className="mt-3"><ReviewFeedbackPanel/></div></details>}
    <Card>
      <div className="flex flex-wrap justify-between gap-3 mb-3">
        <div><h2 className="font-semibold">Inspection evidence register</h2><p className="text-xs text-[var(--text-muted)]">Date, site, status and search filter the whole register on the server. Photo, measurement, condition, AI-status and review filters apply to the page shown. Absence of a reading is never estimated from a photograph.</p></div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter inspection evidence">{[['all','All'],['photos','With defect photos'],['measurements','Measured'],['missing','Missing measurements']].map(([key,label])=><button key={key} type="button" onClick={()=>setFilter(key)} aria-pressed={filter===key} className={'rounded-md border px-3 py-1.5 text-xs '+(filter===key?'bg-brand-subtle border-brand-bright text-brand-bright':'border-[var(--border-dim)] text-[var(--text-secondary)]')}>{label}</button>)}</div>
      <input className="input w-full max-w-sm mb-3" aria-label="Search vehicle or site" placeholder="Search vehicle or site" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3" aria-label="Advanced inspection filters">
        <label className="text-xs text-[var(--text-secondary)]">Site<select className="input w-full mt-1" value={siteFilter} onChange={e=>setSiteFilter(e.target.value)}><option value="all">All sites</option>{sites.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">Tyre condition<select className="input w-full mt-1" value={conditionFilter} onChange={e=>setConditionFilter(e.target.value)}><option value="all">All conditions</option>{conditions.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">Inspection status<select className="input w-full mt-1" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">AI analysis status<select className="input w-full mt-1" value={aiStatusFilter} onChange={e=>setAiStatusFilter(e.target.value)}>{[['all','All AI statuses'],['none','Not requested'],['pending','Pending'],['processing','Processing'],['completed','Completed'],['failed','Failed']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">Supervisor review<select className="input w-full mt-1" value={reviewFilter} onChange={e=>setReviewFilter(e.target.value)}>{[['all','All review states'],['unreviewed','Not reviewed'],['accepted','Accepted'],['rejected','Rejected'],['corrected','Corrected']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-xs text-[var(--text-secondary)]">From date<input className="input w-full mt-1" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
        <label className="text-xs text-[var(--text-secondary)]">Through date<input className="input w-full mt-1" type="date" min={dateFrom||undefined} value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
        <div className="flex items-end gap-3"><button className="btn-secondary" type="button" onClick={resetFilters}>Clear all filters</button><span className="text-xs text-[var(--text-muted)]">{visibleRecords.length} matching</span></div>
      </div>
      {error && <p role="alert" className="text-red-500 mb-3">{error}</p>}
      {loading ? <p>Loading inspections…</p> : <EnterpriseTable columns={columns} data={visibleRecords} emptyMessage="No inspections found" />}
      <div className="flex items-center justify-between gap-3 mt-3 text-sm">
        <span className="text-xs text-[var(--text-muted)]">{total?`${page*PAGE_SIZE+1}-${Math.min((page+1)*PAGE_SIZE,total)} of ${total}`:'0 inspections'}</span>
        <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button><button type="button" className="btn-secondary" disabled={loading||(page+1)*PAGE_SIZE>=total} onClick={()=>setPage(p=>p+1)}>Next</button></div>
      </div>
    </Card>
    {selected && <InspectionDetail inspection={selected} role={role} activeTab={tab} onTab={setTab} onClose={()=>setSelected(null)} />}
  </div>
}


function InspectionDetail({ inspection, role, activeTab, onTab, onClose }) {
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
  const [storedMeasurements,setStoredMeasurements]=useState([])
  const [analysisJobs,setAnalysisJobs]=useState([])
  const [reviewNotes,setReviewNotes]=useState({})
  const [showCaptureGuide,setShowCaptureGuide]=useState(false)
  const [analysisError,setAnalysisError]=useState('')
  const [analysisLoading,setAnalysisLoading]=useState(false)
  const refreshAnalysis=useCallback(async()=>{try{setAnalysisJobs(await readInspectionAnalysis([inspection.id]));setAnalysisError('')}catch(e){setAnalysisError(toUserMessage(e,'Could not load AI results'))}},[inspection.id])
  useEffect(()=>{refreshAnalysis()},[refreshAnalysis])
  const screenAll=async()=>{
    setAnalysisLoading(true)
    setAnalysisError('')
    try {
      await screenInspectionPhotos(inspection.id)
      await refreshAnalysis()
      onTab('analysis')
    } catch(e) {
      setAnalysisError(toUserMessage(e,'Could not start visual screening'))
    } finally { setAnalysisLoading(false) }
  }
  const enqueue=async()=>{setAnalysisLoading(true);try{await enqueueInspectionPhotos(inspection.id);await refreshAnalysis()}catch(e){setAnalysisError(toUserMessage(e,'Could not queue photos'))}finally{setAnalysisLoading(false)}}
  const decide=async(job,decision)=>{setAnalysisLoading(true);try{await reviewAiFinding(job.id,decision,reviewNotes[job.id]?.trim() || (decision==='accepted'?'Reviewer confirmed visible evidence':'Reviewer rejected finding; reason not specified'));await refreshAnalysis()}catch(e){setAnalysisError(toUserMessage(e,'Could not save review'))}finally{setAnalysisLoading(false)}}
  const [measurementError,setMeasurementError]=useState('')
  const [savingMeasurement,setSavingMeasurement]=useState(false)
  const [form,setForm]=useState({position:'',source:'manual_gauge',originalMm:'',minimumMm:'',innerMm:'',centerMm:'',outerMm:'',odometerKm:'',tyreSerial:''})
  const refreshMeasurements=useCallback(async()=>{try{setStoredMeasurements(await readInspectionMeasurements([inspection.id]));setMeasurementError('')}catch(e){setMeasurementError(toUserMessage(e,'Could not load measured depths'))}},[inspection.id])
  useEffect(()=>{refreshMeasurements()},[refreshMeasurements])
  const saveMeasurement=async(e)=>{e.preventDefault();setSavingMeasurement(true);setMeasurementError('');try{await recordDepthMeasurement({...form,inspectionId:inspection.id});await refreshMeasurements();setForm(f=>({...f,innerMm:'',centerMm:'',outerMm:''}))}catch(err){setMeasurementError(toUserMessage(err,'Unable to save measurement'))}finally{setSavingMeasurement(false)}}
  const [photoUrls,setPhotoUrls]=useState({})
  const [photoErrors,setPhotoErrors]=useState({})
  useEffect(() => {
    let alive=true
    setPhotoUrls({}); setPhotoErrors({})
    Promise.all(evidence.allPhotos.map(async item => {
      try {
        const url=await resolveStorageUrl(item.ref)
        if (!alive) return
        if (url) setPhotoUrls(v=>({...v,[item.position+':'+item.ref]:url}))
        else setPhotoErrors(v=>({...v,[item.position+':'+item.ref]:true}))
      } catch {
        if (alive) setPhotoErrors(v=>({...v,[item.position+':'+item.ref]:true}))
      }
    }))
    return ()=>{alive=false}
  },[evidence])
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
  const displayedReadings=readings.map(item=>{
    const saved=latestSavedByPosition.get(item.position)
    if(!saved)return item
    return {...item,calculation:measurementReading({
      inspectionId:inspection.id,position:item.position,
      originalMm:saved.original_mm,minimumMm:saved.minimum_mm,
      innerMm:saved.inner_mm,centerMm:saved.center_mm,outerMm:saved.outer_mm,
      source:saved.source,measuredAt:saved.measured_at,
    })}
  })
  const missing=displayedReadings.filter(item=>!item.calculation.valid)
  const verified=displayedReadings.filter(item=>item.calculation.valid)
  const appendix=buildInspectionAiAppendix({inspection,jobs:analysisJobs,measurements:storedMeasurements})
  async function exportDetailedExcel() {
    const { exportToExcel, reportFileName, reportDateLabel } = await import('../lib/exportUtils')
    const columns = [
      ['vehicle','Vehicle'],['site','Site / location'],['date','Inspection date'],
      ['inspector','Inspector'],['inspection_id','Inspection ID'],
      ['position','Tyre position (fleet map)'],['internal_position','Stored slot ID'],
      ['condition','Inspector condition'],['photos','Linked photograph count'],
      ['photo_references','Photo reference(s)'],['ai_status','AI status'],
      ['review_status','Supervisor review'],['assessable','Image assessable'],
      ['findings','AI visible findings'],['severity','Finding severity'],
      ['recommendation','Recommended action'],['model','AI model'],
      ['measured_mm','Verified minimum tread mm'],['remaining_mm','Remaining usable mm'],
      ['remaining_percent','Remaining percent'],['measurement_status','Measurement verification'],
    ]
    const rows = displayedReadings.map(item => {
      const findings=analysisJobs.filter(job=>job.tyre_position===item.position)
      const photos=evidence.allPhotos.filter(photo=>photo.position===item.position)
      const reading=item.calculation
      return {
        vehicle:inspection.asset_no || '',site:inspection.site || '',
        date:inspection.inspection_date || '',inspector:inspection.inspector || '',
        inspection_id:inspection.id,position:positionLabel(item.position),internal_position:item.position,
        condition:item.condition,photos:photos.length,
        photo_references:photos.map(photo=>photo.ref).join(' | '),
        ai_status:findings.length?findings.map(job=>job.status).join('; '):'Not requested',
        review_status:findings.map(job=>job.review_status||'unreviewed').join('; ')||'Not reviewed',
        assessable:findings.map(job=>job.analysis?.assessable===true?'Yes':'No').join('; '),
        findings:findings.flatMap(job=>(job.analysis?.defects||[]).map(defect=>[defect.type,defect.description,defect.visibleEvidence].filter(Boolean).join(': '))).join(' | '),
        severity:findings.flatMap(job=>(job.analysis?.defects||[]).map(defect=>defect.severity)).join('; '),
        recommendation:findings.map(job=>job.analysis?.recommendation||'').filter(Boolean).join(' | '),
        model:findings.map(job=>job.model_version||'').filter(Boolean).join('; '),
        measured_mm:reading.valid?reading.reading.worstMm:'Not measured',
        remaining_mm:reading.valid?reading.reading.remainingMm:'',
        remaining_percent:reading.valid?reading.reading.remainingPercent:'',
        measurement_status:reading.valid?'Recorded physical measurement':'Measurement required',
      }
    })
    exportToExcel(rows,columns.map(([key])=>key),columns.map(([,header])=>header),
      reportFileName('AI Tyre Inspection '+(inspection.asset_no||'vehicle'),inspection.inspection_date||'inspection',reportDateLabel()))
  }

  return <div className="fixed inset-0 z-[55] bg-black/60 flex justify-end" role="presentation" onClick={onClose}>
    <div className="bg-[var(--panel)] text-[var(--text-primary)] h-full w-full max-w-4xl overflow-y-auto shadow-2xl" role="dialog" aria-modal="true" aria-label="AI tyre inspection details" onClick={e=>e.stopPropagation()}>
      <div className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border-dim)] px-5 py-4">
        <div className="flex justify-between gap-4 items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><ClipboardCheck size={14}/> Inspection detail</div>
            <h2 className="text-xl font-bold mt-1">{inspection.asset_no || 'Unknown vehicle'}</h2><button className="btn-secondary mt-3 inline-flex items-center gap-2 text-sm" type="button" onClick={exportDetailedExcel}><Download size={15}/> Download full AI inspection Excel</button>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{inspection.site || 'Site not recorded'} · {inspection.inspection_date || 'Date not recorded'} · {inspection.inspector || 'Inspector not recorded'}</p>
          </div>
          <button className="btn-secondary p-2" type="button" aria-label="Close details" onClick={onClose}><X size={18}/></button>
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
                {photoUrls[key]?<a href={photoUrls[key]} target="_blank" rel="noopener noreferrer"><img src={photoUrls[key]} className="w-full h-56 object-contain bg-[var(--panel-2)]" alt={'Tyre evidence at '+photo.position}/></a>:
                  <div className="h-56 flex items-center justify-center text-xs text-[var(--text-muted)] bg-[var(--panel-2)]">{photoErrors[key]?'Photo unavailable. Check storage permissions.':'Resolving secure photo…'}</div>}
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Image evidence only. Exact tread depth requires a gauge reading.</div>
              </div>
            })}
          </div>
          {!evidence.allPhotos.length && <EmptyState icon={ImageIcon} title="No tyre photographs" description="Photos will appear here when inspectors attach photos to tyre positions."/>}
        </>}
        {activeTab==='measurements' && <>
          <details className="text-sm"><summary className="cursor-pointer">How to capture gauge evidence</summary><PhotoCaptureGuide/></details>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Positions" value={readings.length}/>
            <Metric label="Complete readings" value={verified.length}/>
            <Metric label="Need verification" value={missing.length}/>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-dim)]">
            <table className="w-full text-sm text-left">
              <thead className="bg-[var(--panel-2)] text-[var(--text-secondary)]"><tr>{['Position','Condition','Measured depth','Remaining usable','Remaining %','Verification'].map(h=><th className="p-3 whitespace-nowrap" key={h}>{h}</th>)}</tr></thead>
              <tbody>{displayedReadings.map(item=><tr key={item.position} className="border-t border-[var(--border-dim)]">
                <td className="p-3 font-semibold">{positionLabel(item.position)}</td><td className="p-3">{item.condition}</td>
                <td className="p-3">{item.calculation.valid?item.calculation.reading.worstMm+' mm':'Not measured'}</td>
                <td className="p-3">{item.calculation.valid?item.calculation.reading.remainingMm+' mm':'—'}</td>
                <td className="p-3">{item.calculation.valid?item.calculation.reading.remainingPercent+'%':'—'}</td>
                <td className="p-3">{item.calculation.valid?'Recorded measurement':'Measurement required'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <Card><h3 className="font-semibold mb-3">Record a verified gauge reading</h3><form onSubmit={saveMeasurement} className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{[["position","Tyre position"],["tyreSerial","Tyre serial"],["originalMm","Original tread mm"],["minimumMm","Minimum tread mm"],["innerMm","Inner mm"],["centerMm","Centre mm"],["outerMm","Outer mm"],["odometerKm","Odometer km"]].map(([key,label])=><label key={key} className="text-xs text-[var(--text-secondary)]">{label}<input className="input w-full mt-1" required={["position","originalMm","minimumMm"].includes(key)} type={["position","tyreSerial"].includes(key)?"text":"number"} step="0.01" min="0" value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}</div><label className="text-xs text-[var(--text-secondary)]">Measurement source<select className="input w-full mt-1" value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value}))}><option value="manual_gauge">Manual physical gauge</option><option value="digital_gauge">Digital physical gauge</option><option value="calibrated_device">Calibrated measurement device</option></select></label><p className="text-xs text-[var(--text-muted)]">Provide at least one groove reading. Source and original/minimum depths must be verified.</p><button className="btn-primary" type="submit" disabled={savingMeasurement}>{savingMeasurement?"Saving…":"Save physical reading"}</button></form></Card>
          {measurementError && <p role="alert" className="text-red-500">{measurementError}</p>}
          <Card><h3 className="font-semibold mb-2">Stored physical measurement history</h3><div className="space-y-2">{storedMeasurements.map(m=><div key={m.id} className="text-sm border-b border-[var(--border-dim)] pb-2">{positionLabel(m.tyre_position)} · {m.source} · Inner {m.inner_mm??"—"} / Centre {m.center_mm??"—"} / Outer {m.outer_mm??"—"} mm · {m.measured_at}</div>)}{!storedMeasurements.length && <p className="text-sm text-[var(--text-muted)]">No physical readings submitted through this module yet.</p>}</div></Card>
          <p className="text-xs text-[var(--text-muted)]">Only physically sourced and validated measurements are eligible for authoritative remaining-tread figures. This screen does not infer millimetres from photographs.</p>
        </>}
        {activeTab==='analysis' && <>
          <Card>
            <div className="flex justify-between items-start gap-4 flex-wrap">
              <div><h3 className="font-semibold">AI photo review</h3><p className="text-xs text-[var(--text-muted)] mt-1">The background worker can inspect visible damage or, on demand, screen all photographed tyres without a gauge. It identifies patterns, not exact tread-depth millimetres. Findings require qualified review.</p></div>
              <div className="flex gap-2"><button className="btn-secondary" onClick={refreshAnalysis} disabled={analysisLoading}>Refresh</button><button className="btn-primary" onClick={enqueue} disabled={!mayQueue||analysisLoading||!evidence.photos.length} title={mayQueue?undefined:'Your role cannot queue AI analysis'}>{analysisLoading?'Working…':'Queue defect photos'}</button><button className="btn-secondary" type="button" onClick={screenAll} disabled={!mayQueue||analysisLoading||!evidence.allPhotoCount} title={mayQueue?undefined:'Your role cannot queue AI analysis'}>{analysisLoading?'Working…':'Screen all photographed tyres'}</button></div>
            </div>
            {analysisError && <p role="alert" className="text-red-500 text-sm mt-3">{analysisError}</p>}
          </Card>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Metric label="Queued" value={analysisJobs.length}/><Metric label="Completed" value={analysisJobs.filter(j=>j.status==='completed').length}/><Metric label="Pending" value={analysisJobs.filter(j=>['pending','processing'].includes(j.status)).length}/><Metric label="Failed" value={analysisJobs.filter(j=>j.status==='failed').length}/></div>
          <div className="rounded-xl border border-[var(--border-dim)] p-3 text-sm"><strong>Review quality summary</strong><div className="flex flex-wrap gap-4 mt-2">
            <span>Accepted: {analysisJobs.filter(j=>j.review_status==='accepted').length}</span>
            <span>Rejected: {analysisJobs.filter(j=>j.review_status==='rejected').length}</span>
            <span>Awaiting review: {analysisJobs.filter(j=>j.status==='completed' && (!j.review_status||j.review_status==='unreviewed')).length}</span>
          </div><p className="text-xs text-[var(--text-muted)] mt-1">Your decisions and reasons are retained as structured feedback for future quality evaluation. No automatic model retraining or unsafe auto-approval is performed.</p></div>
          <div className="space-y-3">{analysisJobs.map(job=><Card key={job.id}>
            <div className="flex justify-between items-center gap-3"><h4 className="font-semibold">{positionLabel(job.tyre_position)}</h4><span className="text-xs">{job.status} · {job.review_status||'unreviewed'}</span></div>{photoUrls[job.tyre_position+':'+job.photo_ref] && <div className="mt-3"><a href={photoUrls[job.tyre_position+':'+job.photo_ref]} rel="noopener noreferrer" target="_blank" aria-label={'Inspect original tyre photo for '+job.tyre_position}><img src={photoUrls[job.tyre_position+':'+job.photo_ref]} alt={'Original tyre photo for supervisor verification at '+job.tyre_position} className="h-48 max-w-full rounded-lg border border-[var(--border-dim)] object-contain" /></a><p className="text-xs text-[var(--text-muted)] mt-1">Original photograph — enlarge and compare before review</p></div>}
            {job.analysis?<div className="mt-3 space-y-2"><p className="text-sm">{job.analysis.assessable?'Visual assessment available':(job.analysis.reason||'Image unassessable')}</p>{(job.analysis.defects||[]).map((d,i)=><p key={i} className="text-sm border-l-2 border-amber-500 pl-3">{d.type}: {d.description} ({d.severity})</p>)}<p className="text-sm text-[var(--text-secondary)]">{job.analysis.recommendation}</p></div>:<p className="text-xs text-[var(--text-muted)] mt-2">No completed visual finding available.</p>}
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
  </div>
}
function Metric({label,value}) {
  return <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)] p-3"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="text-xl font-bold mt-1">{value}</div></div>
}
function EmptyState({icon:Icon,title,description}) {
  return <div className="border border-dashed border-[var(--border-dim)] rounded-lg py-12 px-4 flex flex-col items-center text-center"><Icon size={26} className="text-[var(--text-muted)] mb-3"/><h3 className="font-semibold">{title}</h3><p className="text-sm text-[var(--text-muted)] mt-2 max-w-md">{description}</p></div>
}

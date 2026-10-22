import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, RefreshCw, ShieldAlert, ScanSearch, Ruler, X, Image as ImageIcon, ClipboardList, AlertCircle, FileText } from 'lucide-react'
import { resolveStorageUrl } from '../lib/storageRefs'
import { inspectablePhotoRefs, summarizeEvidence, normalizePositionConditions, measurementReading } from '../lib/aiTyreInspectionDomain'
import { buildInspectionAiAppendix, INSPECTION_AI_PRINT_STYLES } from '../lib/aiTyreInspectionReport'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { listInspectionsForPage } from '../lib/api/inspections'
import { calculateTread, conditionRequiresAnalysis } from '../lib/aiTyreInspection'
import { readInspectionMeasurements, recordDepthMeasurement, readInspectionAnalysis, enqueueInspectionPhotos, reviewAiFinding, summarizeInspectionAiCosts } from '../lib/api/aiTyreInspection'

function photoCount(row) {
  const conditions = row?.tyre_conditions || {}
  return Object.values(conditions).filter(p => p && typeof p === 'object' && p.photo && conditionRequiresAnalysis(p.condition)).length
}
export default function AiTyreInspection() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('evidence')
  const [filter, setFilter] = useState('all')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data, error: queryError } = await listInspectionsForPage({ from:0, to:199, country:activeCountry })
      if (queryError) throw queryError
      setRows(data || [])
    } catch (err) { setError(toUserMessage(err,'Unable to load inspections')) }
    finally { setLoading(false) }
  }, [activeCountry])
  useEffect(() => { load() }, [load])
  const records = useMemo(() => rows.filter(r => String(r.asset_no||'').toLowerCase().includes(search.toLowerCase()) ||
    String(r.site||'').toLowerCase().includes(search.toLowerCase())).map(row => {
      const positions = Object.entries(row.tyre_conditions || {}).filter(([,v])=>v && typeof v==='object')
      const measured = positions.map(([position,v]) => ({ position, ...calculateTread({
        originalMm:v.original_tread_mm ?? v.original_mm,
        measuredMm:v.tread_depth_mm ?? v.tread_mm,
        minimumMm:v.minimum_tread_mm ?? v.minimum_mm,
      }) }))
      return {...row, photosForReview:photoCount(row),
        measuredCount:measured.filter(v=>v.status!=='measurement_required').length,
        needsMeasurement:measured.filter(v=>v.status==='measurement_required').length}
    }), [rows,search])
  const visibleRecords = records.filter(r => filter === 'all' || (filter === 'photos' && r.photosForReview > 0) || (filter === 'measurements' && r.measuredCount > 0) || (filter === 'missing' && r.needsMeasurement > 0))
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
    <PageHeader title="AI Tyre Inspection" subtitle="Verified measurements and defect evidence. AI processing will appear only when the secure background service is configured." icon={ScanSearch} />
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><div className="flex items-center gap-2 text-sm"><ClipboardCheck size={17}/> Inspections loaded</div><div className="text-2xl font-semibold mt-2">{records.length}</div></Card>
      <Card><div className="flex items-center gap-2 text-sm"><ShieldAlert size={17}/> Defect photos for review</div><div className="text-2xl font-semibold mt-2">{records.reduce((sum,r)=>sum+r.photosForReview,0)}</div></Card>
      <Card><div className="flex items-center gap-2 text-sm"><Ruler size={17}/> Measured tyre positions</div><div className="text-2xl font-semibold mt-2">{records.reduce((sum,r)=>sum+r.measuredCount,0)}</div></Card>
    </div>
    <Card>
      <div className="flex flex-wrap justify-between gap-3 mb-3">
        <div><h2 className="font-semibold">Inspection evidence register</h2><p className="text-xs text-[var(--text-muted)]">Showing latest 200 records; absence of a reading is never estimated from a photograph.</p></div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter inspection evidence">{[['all','All'],['photos','With defect photos'],['measurements','Measured'],['missing','Missing measurements']].map(([key,label])=><button key={key} type="button" onClick={()=>setFilter(key)} aria-pressed={filter===key} className={'rounded-md border px-3 py-1.5 text-xs '+(filter===key?'bg-brand-subtle border-brand-bright text-brand-bright':'border-[var(--border-dim)] text-[var(--text-secondary)]')}>{label}</button>)}</div>
      <input className="input w-full max-w-sm mb-3" aria-label="Search vehicle or site" placeholder="Search vehicle or site" value={search} onChange={e=>setSearch(e.target.value)}/>
      {error && <p role="alert" className="text-red-500 mb-3">{error}</p>}
      {loading ? <p>Loading inspections…</p> : <EnterpriseTable columns={columns} data={visibleRecords} emptyMessage="No inspections found" />}
    </Card>
    {selected && <InspectionDetail inspection={selected} activeTab={tab} onTab={setTab} onClose={()=>setSelected(null)} />}
  </div>
}


function InspectionDetail({ inspection, activeTab, onTab, onClose }) {
  const evidence = useMemo(() => summarizeEvidence(inspection), [inspection])
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
  const expense=useMemo(()=>summarizeInspectionAiCosts(analysisJobs)[0], [analysisJobs])
  const [analysisError,setAnalysisError]=useState('')
  const [analysisLoading,setAnalysisLoading]=useState(false)
  const refreshAnalysis=useCallback(async()=>{try{setAnalysisJobs(await readInspectionAnalysis([inspection.id]));setAnalysisError('')}catch(e){setAnalysisError(toUserMessage(e,'Could not load AI results'))}},[inspection.id])
  useEffect(()=>{refreshAnalysis()},[refreshAnalysis])
  const enqueue=async()=>{setAnalysisLoading(true);try{await enqueueInspectionPhotos(inspection.id);await refreshAnalysis()}catch(e){setAnalysisError(toUserMessage(e,'Could not queue photos'))}finally{setAnalysisLoading(false)}}
  const decide=async(job,decision)=>{setAnalysisLoading(true);try{await reviewAiFinding(job.id,decision,'Reviewed by supervisor');await refreshAnalysis()}catch(e){setAnalysisError(toUserMessage(e,'Could not save review'))}finally{setAnalysisLoading(false)}}
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
    Promise.all(evidence.photos.map(async item => {
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
    ['analysis','AI analysis status',ScanSearch],
    ['report','Report preview',FileText],
  ]
  const missing=readings.filter(item=>!item.calculation.valid)
  const verified=readings.filter(item=>item.calculation.valid)
  const appendix=buildInspectionAiAppendix({inspection,jobs:analysisJobs,measurements:storedMeasurements})
  return <div className="fixed inset-0 z-[55] bg-black/60 flex justify-end" role="presentation" onClick={onClose}>
    <div className="bg-[var(--panel)] text-[var(--text-primary)] h-full w-full max-w-4xl overflow-y-auto shadow-2xl" role="dialog" aria-modal="true" aria-label="AI tyre inspection details" onClick={e=>e.stopPropagation()}>
      <div className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border-dim)] px-5 py-4">
        <div className="flex justify-between gap-4 items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><ClipboardCheck size={14}/> Inspection detail</div>
            <h2 className="text-xl font-bold mt-1">{inspection.asset_no || 'Unknown vehicle'}</h2>
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
            <Metric label="Defect photos" value={evidence.defectPhotos}/>
            <Metric label="No evidence" value={evidence.abnormalPositionsMissingPhotos.length}/>
          </div>
          {evidence.abnormalPositionsMissingPhotos.length>0 && <div className="rounded-lg p-3 border border-amber-500/30 bg-amber-500/10 flex items-start gap-2 text-sm"><AlertCircle size={17} className="text-amber-500 shrink-0"/><span>No photo is linked to abnormal positions: {evidence.abnormalPositionsMissingPhotos.join(', ')}. Request evidence from the inspector.</span></div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {evidence.photos.map(photo=>{
              const key=photo.position+':'+photo.ref
              return <div key={key} className="rounded-xl border border-[var(--border-dim)] overflow-hidden">
                <div className="p-3 flex justify-between items-center"><span className="font-semibold">{photo.position}</span><span className="text-xs text-[var(--text-muted)]">{photo.condition}</span></div>
                {photoUrls[key]?<a href={photoUrls[key]} target="_blank" rel="noopener noreferrer"><img src={photoUrls[key]} className="w-full h-56 object-contain bg-[var(--panel-2)]" alt={'Tyre evidence at '+photo.position}/></a>:
                  <div className="h-56 flex items-center justify-center text-xs text-[var(--text-muted)] bg-[var(--panel-2)]">{photoErrors[key]?'Photo unavailable. Check storage permissions.':'Resolving secure photo…'}</div>}
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Image evidence only. Exact tread depth requires a gauge reading.</div>
              </div>
            })}
          </div>
          {!evidence.photos.length && <EmptyState icon={ImageIcon} title="No damage photographs" description="Photos will appear here when inspectors attach evidence to abnormal tyre positions."/>}
        </>}
        {activeTab==='measurements' && <>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Positions" value={readings.length}/>
            <Metric label="Complete readings" value={verified.length}/>
            <Metric label="Need verification" value={missing.length}/>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-dim)]">
            <table className="w-full text-sm text-left">
              <thead className="bg-[var(--panel-2)] text-[var(--text-secondary)]"><tr>{['Position','Condition','Measured depth','Remaining usable','Remaining %','Verification'].map(h=><th className="p-3 whitespace-nowrap" key={h}>{h}</th>)}</tr></thead>
              <tbody>{readings.map(item=><tr key={item.position} className="border-t border-[var(--border-dim)]">
                <td className="p-3 font-semibold">{item.position}</td><td className="p-3">{item.condition}</td>
                <td className="p-3">{item.calculation.valid?item.calculation.reading.worstMm+' mm':'Not measured'}</td>
                <td className="p-3">{item.calculation.valid?item.calculation.reading.remainingMm+' mm':'—'}</td>
                <td className="p-3">{item.calculation.valid?item.calculation.reading.remainingPercent+'%':'—'}</td>
                <td className="p-3">{item.calculation.valid?'Recorded measurement':'Measurement required'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <Card><h3 className="font-semibold mb-3">Record a verified gauge reading</h3><form onSubmit={saveMeasurement} className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{[["position","Tyre position"],["tyreSerial","Tyre serial"],["originalMm","Original tread mm"],["minimumMm","Minimum tread mm"],["innerMm","Inner mm"],["centerMm","Centre mm"],["outerMm","Outer mm"],["odometerKm","Odometer km"]].map(([key,label])=><label key={key} className="text-xs text-[var(--text-secondary)]">{label}<input className="input w-full mt-1" required={["position","originalMm","minimumMm"].includes(key)} type={["position","tyreSerial"].includes(key)?"text":"number"} step="0.01" min="0" value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>)}</div><label className="text-xs text-[var(--text-secondary)]">Measurement source<select className="input w-full mt-1" value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value}))}><option value="manual_gauge">Manual physical gauge</option><option value="digital_gauge">Digital physical gauge</option><option value="calibrated_device">Calibrated measurement device</option></select></label><p className="text-xs text-[var(--text-muted)]">Provide at least one groove reading. Source and original/minimum depths must be verified.</p><button className="btn-primary" type="submit" disabled={savingMeasurement}>{savingMeasurement?"Saving…":"Save physical reading"}</button></form></Card>
          {measurementError && <p role="alert" className="text-red-500">{measurementError}</p>}
          <Card><h3 className="font-semibold mb-2">Stored physical measurement history</h3><div className="space-y-2">{storedMeasurements.map(m=><div key={m.id} className="text-sm border-b border-[var(--border-dim)] pb-2">{m.tyre_position} · {m.source} · Inner {m.inner_mm??"—"} / Centre {m.center_mm??"—"} / Outer {m.outer_mm??"—"} mm · {m.measured_at}</div>)}{!storedMeasurements.length && <p className="text-sm text-[var(--text-muted)]">No physical readings submitted through this module yet.</p>}</div></Card>
          <p className="text-xs text-[var(--text-muted)]">Only physically sourced and validated measurements are eligible for authoritative remaining-tread figures. This screen does not infer millimetres from photographs.</p>
        </>}
        {activeTab==='analysis' && <>
          <Card>
            <div className="flex justify-between items-start gap-4 flex-wrap">
              <div><h3 className="font-semibold">AI photo review</h3><p className="text-xs text-[var(--text-muted)] mt-1">The server analyzes eligible defect photos. Findings require qualified human review.</p></div>
              <div className="flex gap-2"><button className="btn-secondary" onClick={refreshAnalysis} disabled={analysisLoading}>Refresh</button><button className="btn-primary" onClick={enqueue} disabled={analysisLoading||!evidence.photos.length}>{analysisLoading?'Working…':'Queue defect photos'}</button></div>
            </div>
            {analysisError && <p role="alert" className="text-red-500 text-sm mt-3">{analysisError}</p>}
          </Card>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Metric label="Queued" value={analysisJobs.length}/><Metric label="Completed" value={analysisJobs.filter(j=>j.status==='completed').length}/><Metric label="Pending" value={analysisJobs.filter(j=>['pending','processing'].includes(j.status)).length}/><Metric label="Failed" value={analysisJobs.filter(j=>j.status==='failed').length}/></div>
          <Card><div className="flex justify-between gap-3 flex-wrap"><div><p className="text-xs text-[var(--text-muted)]">AI inference cost for this inspection</p><p className="text-xl font-bold">{expense?.priced?`${expense.costUsd.toFixed(6)}`:"Not priced yet"}</p></div><div className="text-xs text-[var(--text-muted)]">Input tokens: {expense?.inputTokens||0} · Output tokens: {expense?.outputTokens||0} · Unpriced jobs: {expense?.unpriced||0}</div></div><p className="text-xs text-[var(--text-muted)] mt-2">Provider token usage is recorded on completion. USD estimates require verified provider pricing configured in the worker; unpriced calls are never shown as free.</p></Card>
          <div className="space-y-3">{analysisJobs.map(job=><Card key={job.id}>
            <div className="flex justify-between items-center gap-3"><h4 className="font-semibold">{job.tyre_position}</h4><span className="text-xs">{job.status} · {job.review_status||'unreviewed'}</span></div>
            {job.analysis?<div className="mt-3 space-y-2"><p className="text-sm">{job.analysis.assessable?'Visual assessment available':(job.analysis.reason||'Image unassessable')}</p>{(job.analysis.defects||[]).map((d,i)=><p key={i} className="text-sm border-l-2 border-amber-500 pl-3">{d.type}: {d.description} ({d.severity})</p>)}<p className="text-sm text-[var(--text-secondary)]">{job.analysis.recommendation}</p></div>:<p className="text-xs text-[var(--text-muted)] mt-2">No completed visual finding available.</p>}
            {job.status==='completed' && (!job.review_status || job.review_status==='unreviewed')&&<div className="flex gap-2 flex-wrap mt-3"><button className="btn-secondary" disabled={analysisLoading} onClick={()=>decide(job,'accepted')}>Accept observation</button><button className="btn-secondary" disabled={analysisLoading} onClick={()=>decide(job,'rejected')}>Reject observation</button></div>}
          </Card>)}</div>
          {!analysisJobs.length && <EmptyState icon={ScanSearch} title="No queued image analysis" description="Request server-side analysis to create jobs for the linked abnormal-tyre photographs."/>}
        </>}
        {activeTab==='report' && <>
          <p className="text-xs text-[var(--text-muted)]">Preview of the AI analysis appendix from current database readings. A centralized production PDF endpoint is still required.</p>
          <div className="rounded-lg border border-[var(--border-dim)] bg-white text-slate-900 p-5 overflow-x-auto">
            <style>{INSPECTION_AI_PRINT_STYLES}</style>
            <div dangerouslySetInnerHTML={{__html:appendix}}/>
          </div>
          <div className="flex gap-2 items-start rounded-md bg-[var(--panel-2)] p-3 text-xs text-[var(--text-secondary)]"><ClipboardList size={15} className="shrink-0"/> Production reports must load approved backend findings and physical measurements before export.</div>
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

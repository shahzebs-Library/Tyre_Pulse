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
  const appendix=buildInspectionAiAppendix({inspection,jobs:[],measurements:[]})
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
          <p className="text-xs text-[var(--text-muted)]">Only physically sourced and validated measurements are eligible for authoritative remaining-tread figures. This screen does not infer millimetres from photographs.</p>
        </>}
        {activeTab==='analysis' && <>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 font-semibold text-sm"><ShieldAlert size={18}/> Backend AI integration not deployed</div>
            <p className="text-sm mt-2">This module currently identifies eligible defect photographs and stores no invented model findings. Background analysis, tenant-authorized results, qualified reviews and production API integration must be deployed before live AI status is available.</p>
          </div>
          <h3 className="font-semibold">Inspection eligibility</h3>
          <div className="space-y-2">{evidence.photos.map((photo,index)=><div key={index} className="border border-[var(--border-dim)] rounded-lg p-3 flex flex-wrap justify-between gap-2"><span>{photo.position} · {photo.condition}</span><span className="text-xs text-[var(--text-muted)]">Awaiting secure processing service</span></div>)}</div>
          {!evidence.photos.length && <EmptyState icon={ScanSearch} title="No images to analyze" description="Attach damage evidence to a tyre position during inspection."/>}
        </>}
        {activeTab==='report' && <>
          <p className="text-xs text-[var(--text-muted)]">Preview of the new advisory appendix. This is not yet integrated with the centralized PDF exporter.</p>
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, RefreshCw, ShieldAlert, ScanSearch, Ruler } from 'lucide-react'
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
  const columns = [
    { accessorKey:'inspection_date', header:'Date', cell:({row:{original:r}})=>r.inspection_date||'Not recorded' },
    { accessorKey:'asset_no', header:'Vehicle', cell:({row:{original:r}})=>r.asset_no||'Not recorded' },
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
      <input className="input w-full max-w-sm mb-3" aria-label="Search vehicle or site" placeholder="Search vehicle or site" value={search} onChange={e=>setSearch(e.target.value)}/>
      {error && <p role="alert" className="text-red-500 mb-3">{error}</p>}
      {loading ? <p>Loading inspections…</p> : <EnterpriseTable columns={columns} data={records} emptyMessage="No inspections found" />}
    </Card>
  </div>
}

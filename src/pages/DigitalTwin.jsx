/**
 * DigitalTwin (routes /digital-twin and /digital-twin/:assetNo) — ported concept
 * from tyre_saas's Digital Twin, wired to Tyre Pulse data. Look up a vehicle and
 * see its live "digital twin": every in-service tyre position laid out with a
 * per-position health score (tread, pressure, age band, CPK), plus an overall
 * vehicle health score and the single worst position to act on. Runs entirely on
 * the existing `tyre_records` table — no new data required.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Cpu, Search, Truck, Gauge, Activity, AlertTriangle, ArrowLeft, CircleDot,
  Loader2, Package, MapPin, Wind, Clock, DollarSign, ShieldCheck,
  FileSpreadsheet, FileText, Hourglass,
} from 'lucide-react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { getTyreRunningLife } from '../lib/api/tyreRunningLife'
import { getVehicle } from '../lib/api/vehicle360'
import { shapeRunningLife, BAND_META } from '../lib/tyreRunningLife'
import { enrichTwin, filterPositions, sortPositions } from '../lib/digitalTwinAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { getAssetTwinRecords, searchAssets } from '../lib/api/digitalTwin'
import { buildTwin, healthBand } from '../lib/digitalTwin'
import { toUserMessage } from '../lib/safeError'
import { AGE_BAND_META } from '../lib/tyreAge'

ChartJS.register(ArcElement, Tooltip, Legend)

const BAND_HEX = { overdue: '#ef4444', 'due-soon': '#f59e0b', 'mid-life': '#3b82f6', healthy: '#22c55e', unknown: '#94a3b8' }
const BAND_KEYS = ['overdue', 'due-soon', 'mid-life', 'healthy', 'unknown']
const fmtInt = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Math.round(Number(v)).toLocaleString())
const unitLabel = (u) => (u === 'hours' ? 'h' : u === 'km' ? 'km' : '')

const AGE_BADGE = {
  non_compliant: 'bg-red-900/40 text-red-300 border border-red-700/50',
  advisory: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  compliant: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const HEALTH_HEX = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', slate: '#64748b' }

function SearchBox({ country, onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try { setResults(await searchAssets(q, { country })); setOpen(true) }
      catch { setResults([]) }
      finally { setLoading(false) }
    }, 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [q, country])

  return (
    <div className="relative max-w-xl">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          className="input pl-9 w-full"
          placeholder="Search a vehicle / asset number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onPick(q.trim()) }}
        />
        {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--surface-2)] shadow-xl py-1">
          {results.map((r) => (
            <button
              key={r.asset_no}
              type="button"
              onClick={() => { setOpen(false); onPick(r.asset_no) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-1)]"
            >
              <CircleDot size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-mono text-[var(--text-primary)]">{r.asset_no}</span>
              <span className="text-xs text-[var(--text-muted)] truncate">
                {[r.brand, r.site, `${r.tyreCount} fitted`].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Circular health gauge (0-100) rendered with an SVG stroke arc. */
function HealthRing({ score, size = 132, stroke = 12 }) {
  const band = healthBand(score)
  const color = HEALTH_HEX[band.tone] || HEALTH_HEX.slate
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const offset = c - (pct / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--input-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[var(--text-primary)]">{score == null ? 'N/A' : score}</span>
        <span className="text-[11px] uppercase tracking-wider" style={{ color }}>{band.label}</span>
      </div>
    </div>
  )
}

/** Horizontal tread bar (0-100 health) for a single position card. */
function TreadBar({ health }) {
  const band = healthBand(health)
  const color = HEALTH_HEX[band.tone] || HEALTH_HEX.slate
  return (
    <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${health == null ? 0 : health}%`, background: color, transition: 'width .5s ease' }} />
    </div>
  )
}

function PositionCard({ p, money }) {
  const band = healthBand(p.health)
  const color = HEALTH_HEX[band.tone] || HEALTH_HEX.slate
  const ageMeta = AGE_BAND_META[p.ageBand] || AGE_BAND_META.unknown
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: `${color}55`, background: 'var(--surface-2)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{p.position || 'Unlabelled position'}</p>
          <p className="text-xs font-mono text-[var(--text-muted)] truncate">{p.serial || 'No serial'}</p>
        </div>
        <span className="text-xl font-bold shrink-0" style={{ color }}>{p.health == null ? 'N/A' : p.health}</span>
      </div>

      <TreadBar health={p.health} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><Gauge size={12} /> Tread</span>
        <span className="text-right text-[var(--text-secondary)]">{p.tread == null ? 'N/A' : `${p.tread} mm`}</span>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><Wind size={12} /> Pressure</span>
        <span className="text-right text-[var(--text-secondary)]">{p.pressure == null ? 'N/A' : `${p.pressure} bar`}</span>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><Clock size={12} /> Age</span>
        <span className="text-right text-[var(--text-secondary)]">{p.ageYears == null ? 'N/A' : `${p.ageYears} yr`}</span>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><DollarSign size={12} /> CPK</span>
        <span className="text-right text-[var(--text-secondary)]">{p.cpk == null ? 'N/A' : money(p.cpk)}</span>
      </div>

      <span className={`badge inline-block text-[10px] px-2 py-0.5 rounded ${AGE_BADGE[p.ageBand] || AGE_BADGE.unknown}`}>{ageMeta.label}</span>
    </div>
  )
}

export default function DigitalTwin() {
  const { assetNo } = useParams()
  const navigate = useNavigate()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [life, setLife] = useState({ rows: [], error: '' })
  const [vehicleType, setVehicleType] = useState('')
  const [search, setSearch] = useState('')
  const [bandFilter, setBandFilter] = useState('all')
  const [sort] = useState({ key: 'band', dir: 'asc' })

  const load = useCallback(async (an) => {
    if (!an) { setRecords(null); return }
    setLoading(true); setError('')
    const [recs, lifeRes, veh] = await Promise.allSettled([
      getAssetTwinRecords(an, { country: activeCountry }),
      getTyreRunningLife({ country: activeCountry, asset: an }),
      getVehicle(an),
    ])
    if (recs.status === 'fulfilled') setRecords(recs.value)
    else { setError(toUserMessage(recs.reason, 'Could not load this vehicle.')); setRecords([]) }
    const shaped = lifeRes.status === 'fulfilled' ? shapeRunningLife(lifeRes.value) : { ok: false, rows: [] }
    setLife(shaped.ok
      ? { rows: shaped.rows, error: '' }
      : { rows: [], error: (lifeRes.status === 'fulfilled' && lifeRes.value?.reason) || 'Remaining life could not be read.' })
    setVehicleType(veh.status === 'fulfilled' ? (veh.value?.vehicle_type || '') : '')
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { if (assetNo) load(assetNo) }, [assetNo, load])

  const twin = useMemo(
    () => (records && records.length ? buildTwin(records, { now: Date.now() }) : null),
    [records],
  )
  // CPK is a small per-km figure — show 3 decimals rather than compact rounding.
  const money = (v) => (v == null ? 'N/A' : `${activeCurrency} ${Number(v).toFixed(3)}`)

  const avgCpk = useMemo(() => {
    if (!twin) return null
    const vals = twin.positions.map((p) => p.cpk).filter((v) => v != null)
    return vals.length ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 1000) / 1000 : null
  }, [twin])

  const gotoPick = (an) => navigate(`/digital-twin/${encodeURIComponent(an)}`)

  const deep = useMemo(
    () => (twin ? enrichTwin({ twin, lifeRows: life.rows, assetNo, vehicleType }) : null),
    [twin, life.rows, assetNo, vehicleType],
  )
  const tableRows = useMemo(
    () => (deep ? sortPositions(filterPositions(deep.positions, { search, band: bandFilter }), sort.key, sort.dir) : []),
    [deep, search, bandFilter, sort],
  )
  const bandChart = deep ? {
    labels: BAND_KEYS.map((k) => (BAND_META[k] || BAND_META.unknown).label),
    datasets: [{ data: BAND_KEYS.map((k) => deep.bandCounts[k] || 0), backgroundColor: BAND_KEYS.map((k) => BAND_HEX[k]), borderWidth: 0 }],
  } : null
  const EXPORT_COLS = ['position', 'serial', 'brand', 'size', 'state', 'remaining', 'unit', 'used', 'days', 'health', 'age', 'fitted']
  const EXPORT_HEAD = ['Position', 'Serial', 'Brand', 'Size', 'Life state', 'Remaining', 'Unit', 'Life used %', 'Days left', 'Health', 'Age (yr)', 'Fitted on']
  function exportTable(kind) {
    const rows = tableRows.map((p) => ({
      position: p.displayPosition || 'N/A', serial: p.serial || 'N/A', brand: p.brand || 'N/A', size: p.size || 'N/A',
      state: p.bandLabel, remaining: p.remaining ?? 'N/A', unit: p.remainingUnit || 'N/A',
      used: p.usedPct == null ? 'N/A' : Math.round(p.usedPct), days: p.remainingDays ?? 'N/A',
      health: p.health ?? 'N/A', age: p.ageYears ?? 'N/A', fitted: p.fittedOn || 'N/A',
    }))
    if (!rows.length) return
    const name = `Digital Twin ${twin?.asset_no || assetNo}`
    if (kind === 'excel') exportToExcel(rows, EXPORT_COLS, EXPORT_HEAD, name)
    else exportToPdf(rows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEAD[i] })), name, name, 'landscape')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Digital Twin"
        subtitle="Look up any vehicle to see its live tyre twin: per-position health, tread, pressure, age and CPK, with an overall vehicle health score."
        icon={Cpu}
        actions={assetNo ? <button onClick={() => navigate('/digital-twin')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><ArrowLeft size={14} /> New search</button> : null}
      />

      {!assetNo && (
        <div className="card space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">Enter an asset / vehicle number to build its digital twin.</p>
          <SearchBox country={activeCountry} onPick={gotoPick} />
        </div>
      )}

      {assetNo && (
        <>
          <div className="card"><SearchBox country={activeCountry} onPick={gotoPick} /></div>

          {loading ? (
            <div className="card animate-pulse h-48" />
          ) : error ? (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn't load this vehicle.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            </div>
          ) : !twin ? (
            <div className="card text-center py-12 space-y-2">
              <Package size={30} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">No fitted tyres for “{assetNo}”.</p>
              <p className="text-sm text-[var(--text-muted)]">This asset has no in-service tyre records. Check the asset number or try another.</p>
            </div>
          ) : (
            <>
              {/* Vehicle health header */}
              <div className="card flex flex-col sm:flex-row items-center gap-6">
                <HealthRing score={twin.healthScore} />
                <div className="flex-1 w-full space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Vehicle</p>
                      <p className="text-2xl font-bold font-mono text-[var(--text-primary)] flex items-center gap-2"><Truck size={20} className="text-[var(--text-muted)]" />{twin.asset_no || assetNo}</p>
                    </div>
                    {twin.worstPosition && (
                      <span className="badge text-xs px-2.5 py-1 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50 inline-flex items-center gap-1.5">
                        <AlertTriangle size={12} /> Worst: {twin.worstPosition}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Fitted tyres', value: twin.tyreCount, icon: CircleDot },
                      { label: 'Health score', value: twin.healthScore == null ? 'N/A' : `${twin.healthScore}/100`, icon: ShieldCheck },
                      { label: 'Worst position', value: twin.worstPosition || 'N/A', icon: MapPin },
                      { label: 'Avg CPK', value: avgCpk == null ? 'N/A' : money(avgCpk), icon: Activity },
                    ].map((k) => {
                      const Icon = k.icon
                      return (
                        <div key={k.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                          <div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{k.label}</span><Icon size={14} className="text-[var(--text-muted)]" /></div>
                          <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5 truncate">{k.value}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>


              {/* Remaining life + layout */}
              {life.error && (
                <div role="status" className="card text-sm flex items-center justify-between gap-3">
                  <span className="text-[var(--text-secondary)]">Remaining life could not be read: {life.error} Life figures show N/A.</span>
                  <button type="button" className="btn-secondary text-xs" onClick={() => load(assetNo)}>Retry</button>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Past life or due soon', value: fmtInt(deep.dueCount), icon: AlertTriangle },
                  { label: 'Life measured', value: deep.lifeCoveragePct == null ? 'N/A' : `${deep.lifeCoveragePct}%`, icon: Gauge },
                  { label: 'Next due', value: deep.nextDue ? `${deep.nextDue.position}: ${fmtInt(deep.nextDue.days)} d` : 'N/A', icon: Hourglass },
                  { label: 'Not on layout', value: fmtInt(deep.unplaced), icon: MapPin },
                ].map((k) => {
                  const Icon = k.icon
                  return (
                    <div key={k.label} className="card !p-3">
                      <div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{k.label}</span><Icon size={14} className="text-[var(--text-muted)]" /></div>
                      <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5 truncate">{k.value}</p>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Wheel layout</h3>
                  {deep.layoutKnown ? (
                    <div className="flex justify-center"><VehicleTyreDiagram vehicleType={deep.hint} positions={deep.diagram} width={240} /></div>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">The vehicle type is not recorded or not recognised, so the wheel layout cannot be drawn. The table below lists every fitted tyre.</p>
                  )}
                  {deep.layoutKnown && deep.unplaced > 0 && (
                    <p className="text-xs text-[var(--text-muted)] mt-3">{deep.unplaced} fitted tyre(s) carry a position that does not match this layout and are listed in the table only.</p>
                  )}
                </div>
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Remaining life state</h3>
                  <p className="text-[11px] text-[var(--text-muted)] mb-3">Judged on whichever budget (km or engine hours) runs out first, against the fleet life targets.</p>
                  <div className="h-56"><Doughnut data={bandChart} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)' } } } }} /></div>
                </div>
              </div>

              <div className="card !p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mr-auto">Position life table</h3>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input aria-label="Search positions" className="input pl-8 text-xs w-44" placeholder="Position, serial, brand..." value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <select aria-label="Life state filter" className="input text-xs w-auto" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
                    <option value="all">All states</option>
                    {BAND_KEYS.map((k) => <option key={k} value={k}>{(BAND_META[k] || BAND_META.unknown).label}</option>)}
                  </select>
                  <button type="button" className="btn-secondary text-xs" disabled={!tableRows.length} onClick={() => exportTable('excel')}><FileSpreadsheet size={13} /> Excel</button>
                  <button type="button" className="btn-secondary text-xs" disabled={!tableRows.length} onClick={() => exportTable('pdf')}><FileText size={13} /> PDF</button>
                </div>
                {!tableRows.length ? (
                  <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No positions match these filters.</p>
                ) : (
                  <>
                    <EnterpriseTable
                      data={tableRows}
                      getRowId={(p) => p.id ?? `${p.position}-${p.serial}`}
                      enableGlobalFilter={false}
                      enableColumnFilters={false}
                      columns={[
                        { id: 'position', header: 'Position', accessorFn: (p) => p.displayPosition || 'N/A',
                          cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
                        { id: 'band', header: 'Life state', accessorFn: (p) => p.bandLabel,
                          cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: BAND_HEX[row.original.band] }} />{row.original.bandLabel}</span> },
                        { id: 'remaining', header: 'Remaining', accessorFn: (p) => p.remaining,
                          cell: ({ row }) => { const p = row.original; return <span className="tabular-nums">{p.remaining == null ? 'N/A' : `${fmtInt(p.remaining)} ${unitLabel(p.remainingUnit)}`}{p.onFallback ? ' *' : ''}</span> } },
                        { id: 'usedPct', header: 'Life used', accessorFn: (p) => p.usedPct,
                          cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'N/A' : `${Math.round(getValue())}%`}</span> },
                        { id: 'remainingDays', header: 'Days left', accessorFn: (p) => p.remainingDays,
                          cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue())}</span> },
                        { id: 'health', header: 'Health', accessorFn: (p) => p.health,
                          cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'N/A' : getValue()}</span> },
                        { id: 'serial', header: 'Serial', accessorFn: (p) => p.serial || 'N/A',
                          cell: ({ getValue }) => <span className="font-mono text-[var(--text-muted)]">{getValue()}</span> },
                      ]}
                    />
                    {tableRows.some((p) => p.onFallback) && <p className="px-4 pb-3 text-[11px] text-[var(--text-muted)]">* Measured on the other meter because this machine's own meter has never been read.</p>}
                  </>
                )}
              </div>

              {/* Position grid */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre positions</h3>
                  <span className="text-xs text-[var(--text-muted)]">{twin.tyreCount} in service</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {twin.positions.map((p) => (
                    <PositionCard key={p.id ?? `${p.position}-${p.serial}`} p={p} money={money} />
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-4 flex items-center gap-1.5">
                  <Activity size={12} /> Health blends tread depth, age band and pressure per position; the vehicle score is the mean across fitted tyres.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

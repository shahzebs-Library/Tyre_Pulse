/**
 * FleetRiskScore (route /fleet-risk-score) - per-TYRE safety scoring.
 *
 * PRIMARY view: every live tyre gets a 0 to 100 composite SAFETY score (higher =
 * safer) from five weighted factors (tread 30, pressure 25, age 20, km 15,
 * inspection 10), banded critical / high / medium / low, worst-first.
 * SECONDARY view: a per-vehicle roll-up of the SAME scores, each asset banded
 * by its worst tyre.
 *
 * All scoring maths live in the pure, unit-tested `src/lib/fleetRisk.js`. The
 * presentation layer on top (filters, evidence coverage, site roll-up) lives in
 * the pure, tested `src/lib/fleetRiskScoreAnalytics.js`, which never re-scores.
 *
 * The evidence column is the honesty guard: fleetRisk imputes a neutral value
 * when a factor is missing, so a tyre with nothing recorded still gets a score.
 * The page marks such scores "Estimated" so defaults never pose as readings.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldAlert, ShieldCheck, AlertTriangle, Gauge, Search, X,
  FileSpreadsheet, FileText, Droplet, Clock, Milestone, ClipboardX, Info,
  Truck, ListChecks, Wind, RefreshCw, Layers, MapPin,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import {
  scoreTyres, rollupVehicles, RISK_LEVEL_META, RISK_WEIGHTS, RISK_LEVELS,
} from '../lib/fleetRisk'
import {
  filterTyreRows, filterVehicleRows, evidenceCoverage, evidenceLevel, measuredFactors,
  siteRiskRollup, bandCounts, fleetAverage, EVIDENCE_LABELS,
} from '../lib/fleetRiskScoreAnalytics'
import { getFleetRiskData } from '../lib/api/fleetRisk'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// Semantic safety bands: lower score = riskier. Text always names the band.
const BAND_STYLES = {
  critical: 'bg-red-900/40 text-red-300 border border-red-700/50',
  high: 'bg-orange-900/40 text-orange-300 border border-orange-700/50',
  medium: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  low: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
}
const BAND_HEX = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#22c55e' }
const scoreColor = (s) => (s >= 75 ? BAND_HEX.low : s >= 50 ? BAND_HEX.medium : s >= 25 ? BAND_HEX.high : BAND_HEX.critical)

const EVIDENCE_STYLES = {
  measured: 'text-green-300 border-green-800/50 bg-green-900/20',
  partial: 'text-amber-300 border-amber-800/50 bg-amber-900/20',
  estimated: 'text-[var(--text-secondary)] border-[var(--input-border)] bg-[var(--input-bg)]',
}

const COMPONENTS = [
  { key: 'tread', label: 'Tread', icon: Droplet },
  { key: 'pressure', label: 'Pressure', icon: Wind },
  { key: 'age', label: 'Age', icon: Clock },
  { key: 'km', label: 'KM', icon: Milestone },
  { key: 'inspection', label: 'Insp', icon: ClipboardX },
]
const FACTOR_LABELS = {
  tread_depth: 'Tread', pressure: 'Pressure', tyre_age: 'Age',
  km_driven: 'Mileage', inspection: 'Inspection',
}
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

function ScoreBar({ score }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
        <div className="h-2 rounded-full" style={{ width: `${s}%`, background: scoreColor(s) }} />
      </div>
      <span className="tabular-nums font-semibold text-[var(--text-primary)] w-9 text-right">{score}</span>
    </div>
  )
}

function BandBadge({ level }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BAND_STYLES[level] || BAND_STYLES.unknown}`}>
      {RISK_LEVEL_META[level]?.label || 'Unknown'}
    </span>
  )
}

function EvidenceBadge({ row }) {
  const level = evidenceLevel(row)
  const m = measuredFactors(row)
  const missing = ['tread', 'pressure', 'age', 'km'].filter((k) => !m[k])
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${EVIDENCE_STYLES[level]}`}
      title={missing.length ? `Not recorded: ${missing.join(', ')}` : 'All measurable inputs recorded'}>
      {EVIDENCE_LABELS[level]} {m.count}/{m.of}
    </span>
  )
}

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } },
    y: { beginAtZero: true, max: 100, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } },
  },
}

export default function FleetRiskScore() {
  const { activeCountry } = useSettings()
  const [data, setData] = useState(null) // { tyres }
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [view, setView] = useState('tyres') // 'tyres' | 'vehicles' | 'sites'
  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [evidenceFilter, setEvidenceFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      setData(await getFleetRiskData({ country: activeCountry }))
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fleet risk data.'))
      setData(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = data === null && !error

  // Score against one reference clock per load (fleetRisk is pure).
  const tyreRows = useMemo(
    () => (data ? scoreTyres({ tyres: data.tyres || [] }, { now: nowMs }) : []),
    [data, nowMs],
  )

  const siteOptions = useMemo(() => [...new Set(tyreRows.map((r) => r.site).filter(Boolean))].sort(), [tyreRows])
  const brandOptions = useMemo(() => [...new Set(tyreRows.map((r) => r.brand).filter(Boolean))].sort(), [tyreRows])

  const filteredTyres = useMemo(() => filterTyreRows(tyreRows, {
    band: bandFilter, site: siteFilter, brand: brandFilter, evidence: evidenceFilter, search,
  }), [tyreRows, bandFilter, siteFilter, brandFilter, evidenceFilter, search])

  // A vehicle is banded by its WORST tyre, so it must roll up every tyre it
  // carries; narrowing its tyres first would hide the tyre that sets its band.
  const vehicleRows = useMemo(() => rollupVehicles(tyreRows), [tyreRows])
  const filteredVehicles = useMemo(
    () => filterVehicleRows(vehicleRows, { band: bandFilter, site: siteFilter, search }),
    [vehicleRows, bandFilter, siteFilter, search],
  )
  // Band tiles and the band chart hold out the band filter (else they only echo it);
  // the site roll-up also holds out the site filter so sites stay comparable.
  const bandScope = useMemo(() => filterTyreRows(tyreRows, {
    site: siteFilter, brand: brandFilter, evidence: evidenceFilter, search,
  }), [tyreRows, siteFilter, brandFilter, evidenceFilter, search])
  const siteRows = useMemo(() => siteRiskRollup(filterTyreRows(tyreRows, {
    band: bandFilter, brand: brandFilter, evidence: evidenceFilter, search,
  })), [tyreRows, bandFilter, brandFilter, evidenceFilter, search])

  const counts = useMemo(() => bandCounts(bandScope), [bandScope])
  const avg = useMemo(() => fleetAverage(filteredTyres), [filteredTyres])
  const coverage = useMemo(() => evidenceCoverage(filteredTyres), [filteredTyres])
  const vehiclesAtRisk = useMemo(
    () => filterVehicleRows(vehicleRows, { site: siteFilter, search })
      .filter((v) => v.vehicle_risk_level === 'critical' || v.vehicle_risk_level === 'high').length,
    [vehicleRows, siteFilter, search],
  )

  const hasFilters = bandFilter !== 'all' || siteFilter || brandFilter || evidenceFilter || search
  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setBrandFilter(''); setEvidenceFilter(''); setSearch('') }

  // ── Charts ──
  const donutData = {
    labels: RISK_LEVELS.map((l) => RISK_LEVEL_META[l]?.label || l),
    datasets: [{ data: RISK_LEVELS.map((l) => counts[l]), backgroundColor: RISK_LEVELS.map((l) => BAND_HEX[l]), borderWidth: 0 }],
  }
  const worst10 = filteredTyres.slice(0, 10)
  const barData = {
    labels: worst10.map((r) => r.serial || r.asset_no || 'N/A'),
    datasets: [{
      label: 'Safety score',
      data: worst10.map((r) => r.risk_score),
      backgroundColor: worst10.map((r) => scoreColor(r.risk_score)),
      borderRadius: 4,
    }],
  }

  // ── Exports (per active view) ──
  const exportSpec = () => {
    if (view === 'vehicles') {
      return {
        name: 'Vehicles',
        cols: ['asset_no', 'site', 'tyre_count', 'worst_score', 'average_score', 'risk_level', 'worst_serial'],
        headers: ['Asset', 'Site', 'Tyres', 'Worst score', 'Avg score', 'Risk', 'Worst tyre'],
        rows: filteredVehicles.map((r) => ({
          asset_no: r.asset_no, site: r.site || '', tyre_count: r.tyre_count,
          worst_score: r.worst_score, average_score: r.average_score,
          risk_level: RISK_LEVEL_META[r.vehicle_risk_level]?.label || r.vehicle_risk_level,
          worst_serial: r.worst_tyre?.serial || '',
        })),
      }
    }
    if (view === 'sites') {
      return {
        name: 'Sites',
        cols: ['site', 'tyres', 'average_score', 'critical', 'high', 'at_risk'],
        headers: ['Site', 'Tyres', 'Avg score', 'Critical', 'High', 'At risk %'],
        rows: siteRows.map((s) => ({ site: s.site, tyres: s.tyres, average_score: s.averageScore ?? '', critical: s.critical, high: s.high, at_risk: s.atRiskShare ?? '' })),
      }
    }
    return {
      name: 'Tyres',
      cols: ['serial', 'asset_no', 'site', 'position', 'brand', 'size', 'risk_level', 'score', 'evidence', 'tread', 'pressure', 'age', 'km', 'inspection', 'tread_mm', 'age_years'],
      headers: ['Serial', 'Asset', 'Site', 'Position', 'Brand', 'Size', 'Risk', 'Score', 'Evidence', 'Tread', 'Pressure', 'Age', 'KM', 'Insp', 'Tread mm', 'Age yrs'],
      rows: filteredTyres.map((r) => ({
        serial: r.serial || '', asset_no: r.asset_no || '', site: r.site || '', position: r.position || '',
        brand: r.brand || '', size: r.size || '',
        risk_level: RISK_LEVEL_META[r.risk_level]?.label || r.risk_level,
        score: r.risk_score,
        evidence: `${EVIDENCE_LABELS[evidenceLevel(r)]} ${measuredFactors(r).count}/4`,
        tread: r.component_scores.tread, pressure: r.component_scores.pressure,
        age: r.component_scores.age, km: r.component_scores.km, inspection: r.component_scores.inspection,
        tread_mm: r.tread_depth ?? '', age_years: r.age_years ?? '',
      })),
    }
  }
  const activeRows = view === 'tyres' ? filteredTyres : view === 'vehicles' ? filteredVehicles : siteRows
  const fileName = (name) => reportFileName('TyrePulse Fleet Risk', name, activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = async () => {
    setActionError('')
    const s = exportSpec()
    try { await exportToExcel(s.rows, s.cols, s.headers, fileName(s.name)) }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    const s = exportSpec()
    try { await exportToPdf(s.rows, s.cols.map((k, i) => ({ key: k, header: s.headers[i] })), 'Fleet Risk Score', fileName(s.name), 'landscape') }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Columns ──
  const tyreColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial || '', cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.serial || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ row }) => <span className="font-mono text-xs">{row.original.asset_no || 'N/A'}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', cell: ({ row }) => row.original.site || 'N/A' },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position || '', cell: ({ row }) => row.original.position || 'N/A' },
    { id: 'tyre', header: 'Tyre', accessorFn: (r) => [r.brand, r.size].filter(Boolean).join(' '), cell: ({ row }) => [row.original.brand, row.original.size].filter(Boolean).join(' ') || 'N/A' },
    { id: 'risk', header: 'Risk', accessorFn: (r) => RISK_LEVELS.indexOf(r.risk_level), meta: { exportValue: (r) => RISK_LEVEL_META[r.risk_level]?.label || r.risk_level }, cell: ({ row }) => <BandBadge level={row.original.risk_level} /> },
    { id: 'score', header: 'Safety score', accessorFn: (r) => r.risk_score, cell: ({ row }) => <ScoreBar score={row.original.risk_score} /> },
    { id: 'evidence', header: 'Evidence', accessorFn: (r) => measuredFactors(r).count, meta: { exportValue: (r) => `${EVIDENCE_LABELS[evidenceLevel(r)]} ${measuredFactors(r).count}/4` }, cell: ({ row }) => <EvidenceBadge row={row.original} /> },
    {
      id: 'components', header: 'Component scores', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center gap-2" role="img" aria-label={COMPONENTS.map((c) => `${c.label} ${Math.round(row.original.component_scores[c.key])}`).join(', ')}>
          {COMPONENTS.map((c) => {
            const v = row.original.component_scores[c.key]
            const Icon = c.icon
            return (
              <div key={c.key} className="flex flex-col items-center gap-1 w-9" title={`${c.label}: ${v}`}>
                <Icon size={11} className="text-[var(--text-muted)]" aria-hidden="true" />
                <div className="w-full h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                  <div className="h-1.5 rounded-full" style={{ width: `${v}%`, background: scoreColor(v) }} />
                </div>
                <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{Math.round(v)}</span>
              </div>
            )
          })}
        </div>
      ),
    },
    {
      id: 'factors', header: 'Top risk factors', accessorFn: (r) => r.top_risk_factors.map((f) => FACTOR_LABELS[f.factor] || f.factor).join(', '),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1 max-w-[260px]">
          {row.original.top_risk_factors.length ? row.original.top_risk_factors.map((f) => (
            <span key={f.factor} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]" title={f.detail}>
              <AlertTriangle size={10} className="text-amber-400" aria-hidden="true" /> {FACTOR_LABELS[f.factor] || f.factor} <span className="tabular-nums opacity-70">{f.score}</span>
            </span>
          )) : <span className="text-xs text-green-400 inline-flex items-center gap-1"><ShieldCheck size={12} aria-hidden="true" /> No factor below threshold</span>}
        </div>
      ),
    },
  ], [])

  const vehicleColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no, cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', cell: ({ row }) => row.original.site || 'N/A' },
    { id: 'tyres', header: 'Tyres', accessorFn: (r) => r.tyre_count, meta: { align: 'right' } },
    { id: 'risk', header: 'Risk', accessorFn: (r) => RISK_LEVELS.indexOf(r.vehicle_risk_level), meta: { exportValue: (r) => RISK_LEVEL_META[r.vehicle_risk_level]?.label || r.vehicle_risk_level }, cell: ({ row }) => <BandBadge level={row.original.vehicle_risk_level} /> },
    { id: 'worst', header: 'Worst tyre score', accessorFn: (r) => r.worst_score, cell: ({ row }) => <ScoreBar score={row.original.worst_score} /> },
    { id: 'avg', header: 'Avg score', accessorFn: (r) => r.average_score, meta: { align: 'right' } },
    { id: 'worstTyre', header: 'Worst tyre', accessorFn: (r) => r.worst_tyre?.serial || '', cell: ({ row }) => (row.original.worst_tyre?.serial ? <span className="font-mono text-xs">{row.original.worst_tyre.serial}{row.original.worst_tyre.position ? `, ${row.original.worst_tyre.position}` : ''}</span> : 'N/A') },
  ], [])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (s) => s.site, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'tyres', header: 'Tyres', accessorFn: (s) => s.tyres, meta: { align: 'right' } },
    { id: 'avg', header: 'Avg safety score', accessorFn: (s) => s.averageScore, cell: ({ row }) => (row.original.averageScore == null ? 'N/A' : <ScoreBar score={row.original.averageScore} />) },
    { id: 'critical', header: 'Critical', accessorFn: (s) => s.critical, meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.critical > 0 ? 'text-red-400 font-semibold' : ''}>{row.original.critical}</span> },
    { id: 'high', header: 'High', accessorFn: (s) => s.high, meta: { align: 'right' } },
    { id: 'atRisk', header: 'At risk', accessorFn: (s) => s.atRiskShare, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.atRiskShare) },
  ], [])

  const na = (v) => (data === null ? 'N/A' : v)
  const total = tyreRows.length
  const VIEWS = [
    { key: 'tyres', label: 'Per tyre', icon: ListChecks, count: filteredTyres.length },
    { key: 'vehicles', label: 'Per vehicle', icon: Truck, count: filteredVehicles.length },
    { key: 'sites', label: 'Per site', icon: MapPin, count: siteRows.length },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Risk Score"
        subtitle="Per-tyre 0 to 100 safety score (higher is safer) from tread, pressure, in-service age, mileage and inspection, ranked worst first."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!activeRows.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!activeRows.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              disabled={!activeRows.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
              getPdf={async () => {
                const s = exportSpec()
                const name = fileName(s.name)
                return {
                  base64: await exportToPdf(s.rows, s.cols.map((k, i) => ({ key: k, header: s.headers[i] })), 'Fleet Risk Score', name, 'landscape', '', { returnBase64: true }),
                  filename: `${name}.pdf`,
                  subject: 'Fleet Risk Score',
                  bodyHtml: '<p>Attached is the Fleet Risk Score report.</p>',
                }
              }}
            />
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Could not load fleet risk data.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error} No score below is a reading of your fleet until this loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label htmlFor="fr-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="fr-search" className="input pl-9 w-full min-h-[44px]" placeholder="Serial, asset, brand, position" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="fr-band" className="label">Risk band</label>
            <select id="fr-band" className="input w-full min-h-[44px]" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
              <option value="all">All risk bands</option>
              {RISK_LEVELS.map((l) => <option key={l} value={l}>{RISK_LEVEL_META[l]?.label || l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fr-site" className="label">Site</label>
            <select id="fr-site" className="input w-full min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fr-brand" className="label">Brand</label>
            <select id="fr-brand" className="input w-full min-h-[44px]" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">All brands</option>
              {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fr-evidence" className="label">Evidence</label>
            <select id="fr-evidence" className="input w-full min-h-[44px]" value={evidenceFilter} onChange={(e) => setEvidenceFilter(e.target.value)}>
              <option value="">All scores</option>
              {Object.entries(EVIDENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {data === null ? 'Not loaded' : `Figures below cover ${filteredTyres.length.toLocaleString()} of ${total.toLocaleString()} live tyres`}
          </span>
        </div>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Tyres scored" value={na(filteredTyres.length.toLocaleString())} icon={Gauge} sub={`${filteredVehicles.length} vehicles in view`} index={0} />
        <StatTile label="Fleet avg score" value={na(avg == null ? 'N/A' : avg)} icon={ShieldCheck} tone="accent" sub="higher is safer" index={1} />
        <StatTile label="Critical" value={na(counts.critical)} icon={AlertTriangle} tone={counts.critical > 0 ? 'crit' : 'neutral'} sub="score below 25" index={2} />
        <StatTile label="High" value={na(counts.high)} icon={ShieldAlert} tone={counts.high > 0 ? 'warn' : 'neutral'} sub="score 25 to 49" index={3} />
        <StatTile label="Vehicles at risk" value={na(vehiclesAtRisk)} icon={Truck} tone={vehiclesAtRisk > 0 ? 'warn' : 'neutral'} sub="worst tyre critical or high" index={4} />
        <StatTile label="Measured scores" value={na(fmtPct(coverage.measuredShare))} icon={Layers} sub="3 or more real inputs" index={5} />
      </div>

      {/* Weighting + evidence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card flex items-start gap-3" aria-label="Score weighting">
          <Info size={16} className="text-[var(--brand-bright)] mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-xs text-[var(--text-muted)] space-y-1.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
              <span><strong>Tread</strong> {RISK_WEIGHTS.tread}%</span>
              <span><strong>Pressure</strong> {RISK_WEIGHTS.pressure}%</span>
              <span><strong>Age</strong> {RISK_WEIGHTS.age}%</span>
              <span><strong>KM</strong> {RISK_WEIGHTS.km}%</span>
              <span><strong>Inspection</strong> {RISK_WEIGHTS.inspection}%</span>
            </div>
            <p>Age uses in-service age (since fitment); the DOT manufacture date is not captured, so tyres stored before fitment read younger than their true age. There is no per-tyre inspection date, so inspection applies the engine&apos;s neutral default to every tyre.</p>
            <p>When a factor is not recorded, the engine substitutes a neutral value. Those scores are marked Estimated or Partial in the Evidence column.</p>
          </div>
        </section>
        <section className="card space-y-2" aria-labelledby="fr-ev-title">
          <h3 id="fr-ev-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Layers size={15} aria-hidden="true" /> What the scores rest on
          </h3>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['Tread recorded', coverage.tread], ['Pressure recorded', coverage.pressure], ['Fitment date known', coverage.age], ['Mileage known', coverage.km]].map(([label, v]) => (
              <div key={label}>
                <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{na(fmtPct(v))}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-[var(--text-muted)]">
            {na(`${coverage.levels.measured} measured, ${coverage.levels.partial} partial, ${coverage.levels.estimated} estimated from defaults.`)}
          </p>
        </section>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card" aria-labelledby="fr-worst-title">
          <h3 id="fr-worst-title" className="text-sm font-semibold text-[var(--text-primary)] mb-3">10 riskiest tyres (lowest safety score)</h3>
          <div className="h-64" role="img" aria-label={worst10.length ? `Lowest scores: ${worst10.slice(0, 5).map((r) => `${r.serial || r.asset_no} ${r.risk_score}`).join(', ')}` : 'No tyres to chart'}>
            {worst10.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={loading} empty="No tyres in this selection." />}
          </div>
        </section>
        <section className="card" aria-labelledby="fr-dist-title">
          <h3 id="fr-dist-title" className="text-sm font-semibold text-[var(--text-primary)] mb-3">Risk band distribution</h3>
          <div className="h-64" role="img" aria-label={RISK_LEVELS.map((l) => `${RISK_LEVEL_META[l]?.label || l} ${counts[l]}`).join(', ')}>
            {bandScope.length ? <Doughnut data={donutData} options={{ ...chartOpts, scales: undefined }} /> : <EmptyChart loading={loading} empty="No tyres in this selection." />}
          </div>
        </section>
      </div>

      {/* View switch */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose view">
        {VIEWS.map((v) => {
          const Icon = v.icon
          const active = view === v.key
          return (
            <button key={v.key} type="button" onClick={() => setView(v.key)} aria-pressed={active}
              className={`text-sm px-3 min-h-[44px] rounded-lg inline-flex items-center gap-1.5 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${active ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-transparent text-[var(--text-secondary)] border-[var(--input-border)] hover:border-[var(--brand)]'}`}>
              <Icon size={14} aria-hidden="true" /> {v.label} <span className="opacity-70">({v.count})</span>
            </button>
          )
        })}
      </div>

      {view === 'tyres' && (
        <EnterpriseTable
          columns={tyreColumns}
          data={filteredTyres}
          getRowId={(r, i) => String(r.id ?? `${r.serial}-${i}`)}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="fleet-risk-tyres"
          emptyMessage={total === 0 ? 'No live tyre data to score yet.' : 'No tyres match these filters.'}
        />
      )}
      {view === 'vehicles' && (
        <EnterpriseTable
          columns={vehicleColumns}
          data={filteredVehicles}
          getRowId={(r) => r.asset_no}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="fleet-risk-vehicles"
          emptyMessage={total === 0 ? 'No vehicles with live tyres to score yet.' : 'No vehicles match these filters.'}
        />
      )}
      {view === 'sites' && (
        <EnterpriseTable
          columns={siteColumns}
          data={siteRows}
          getRowId={(s) => s.site}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          emptyMessage={total === 0 ? 'No live tyre data to score yet.' : 'No sites match these filters.'}
        />
      )}
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}

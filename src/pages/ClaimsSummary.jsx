/**
 * ClaimsSummary (route /claims-summary) — Accident & Insurance module.
 *
 * A chart-rich, read-only intelligence dashboard over the insurance claims that
 * ride on real ACCIDENT records (accidents table): claim / approved / deductible
 * / recovered amounts, insurer, GCC liability ratio, fault status, Najm/Taqdeer,
 * expected vs actual release. All figures come from the single claims engine
 * (src/lib/claimsAnalytics.js) so the dashboard, its KPI tiles and the PDF/Excel
 * export can never drift apart.
 *
 * Distinct from /insurance-claims (a manual CRUD ledger over the separate
 * insurance_claims table) — this is live analytics over accident-embedded claims,
 * which is where the operational claim data actually lives.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  ShieldAlert, DollarSign, TrendingUp, ShieldCheck, Clock, Inbox,
  AlertTriangle, Percent, Scale, Wallet, FileText, FileSpreadsheet,
  Filter, X, Building2, Truck, Gauge,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { listAllAccidentsForPage } from '../lib/api/accidents'
import { analyzeClaims, isClosed, isDelayed } from '../lib/claimsAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Chart theme (matches the app's other chart.js pages) ──────────────────────
const AXIS = { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'rgba(148,163,184,0.12)' } }
const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, titleColor: '#f8fafc', bodyColor: '#e2e8f0' },
  },
  scales: { x: AXIS, y: AXIS },
}
const NO_LEGEND = { ...BASE, plugins: { ...BASE.plugins, legend: { display: false } } }
const HORIZONTAL = { ...NO_LEGEND, indexAxis: 'y' }
const DOUGHNUT = {
  responsive: true, maintainAspectRatio: false, cutout: '62%',
  plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, padding: 12, font: { size: 11 } } }, tooltip: BASE.plugins.tooltip },
}
const DUAL_AXIS = {
  ...BASE,
  scales: {
    x: AXIS,
    y: { ...AXIS, position: 'left', title: { display: true, text: 'Value', color: '#64748b', font: { size: 10 } } },
    y1: { ...AXIS, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Count', color: '#64748b', font: { size: 10 } } },
  },
}

const C = {
  indigo: '#6366f1', blue: '#3b82f6', emerald: '#10b981', amber: '#f59e0b',
  red: '#ef4444', violet: '#8b5cf6', cyan: '#06b6d4', slate: '#64748b', rose: '#f43f5e',
}
const PALETTE = [C.indigo, C.emerald, C.amber, C.blue, C.violet, C.cyan, C.rose, C.red, C.slate]

function monthLabel(ym) {
  const [y, m] = String(ym).split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[(Number(m) || 1) - 1]} ${String(y).slice(2)}`
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}

// ── Presentational bits ───────────────────────────────────────────────────────
function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]', accent = 'text-[var(--text-muted)]' }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={accent} />
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub != null && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}
function ChartCard({ title, subtitle, children, height = 260 }) {
  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

export default function ClaimsSummary() {
  const { activeCountry, activeCurrency, appSettings } = useSettings() || {}
  const ccy = activeCurrency || 'SAR'
  const money = useCallback((v) => (v == null || v === '' ? '—' : formatCurrencyCompact(v, ccy)), [ccy])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [insurerF, setInsurerF] = useState('')
  const [siteF, setSiteF] = useState('')
  const [stateF, setStateF] = useState('all') // all | open | closed | delayed

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const { data, error: err } = await listAllAccidentsForPage({ country: activeCountry })
      if (err) throw err
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (e) {
      setError(e?.message || 'Could not load claims.'); setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Filter the raw accident set before analysis (date window + insurer/site/state).
  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return (rows || []).filter((r) => {
      const d = String(r.incident_date || '').slice(0, 10)
      if (from && d && d < from) return false
      if (to && d && d > to) return false
      if (insurerF && (r.insurer || '') !== insurerF) return false
      if (siteF && (r.site || '') !== siteF) return false
      if (stateF === 'open' && isClosed(r)) return false
      if (stateF === 'closed' && !isClosed(r)) return false
      if (stateF === 'delayed' && !isDelayed(r, today)) return false
      return true
    })
  }, [rows, from, to, insurerF, siteF, stateF])

  const a = useMemo(() => analyzeClaims(filtered), [filtered])

  const insurerOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.insurer).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )
  const hasFilters = from || to || insurerF || siteF || stateF !== 'all'
  const clearFilters = () => { setFrom(''); setTo(''); setInsurerF(''); setSiteF(''); setStateF('all') }

  // ── Charts ──────────────────────────────────────────────────────────────────
  const statusChart = useMemo(() => ({
    labels: a.byStatus.map((x) => x.label),
    datasets: [{ data: a.byStatus.map((x) => x.count), backgroundColor: PALETTE, borderWidth: 0 }],
  }), [a])

  const liabilityChart = useMemo(() => ({
    labels: ['0% (not liable)', '50% (shared)', '100% (at fault)', 'Unknown'],
    datasets: [{
      data: [a.liability[0].count, a.liability[50].count, a.liability[100].count, a.liability.unknown.count],
      backgroundColor: [C.emerald, C.amber, C.red, C.slate], borderWidth: 0,
    }],
  }), [a])

  const faultChart = useMemo(() => ({
    labels: ['Faulty', 'Non-faulty', 'Unknown'],
    datasets: [{ data: [a.fault.faulty.count, a.fault.non_faulty.count, a.fault.unknown.count], backgroundColor: [C.red, C.emerald, C.slate], borderWidth: 0 }],
  }), [a])

  const insurerChart = useMemo(() => ({
    labels: a.byInsurer.map((x) => x.label),
    datasets: [{ label: 'Claim value', data: a.byInsurer.map((x) => Math.round(x.value)), backgroundColor: C.indigo, borderRadius: 4 }],
  }), [a])

  const recoveryChart = useMemo(() => ({
    labels: ['Claimed', 'Approved', 'Recovered'],
    datasets: [{ data: [Math.round(a.claimed), Math.round(a.approved), Math.round(a.recovered)], backgroundColor: [C.blue, C.violet, C.emerald], borderRadius: 4 }],
  }), [a])

  const trendChart = useMemo(() => ({
    labels: a.byMonth.map((m) => monthLabel(m.ym)),
    datasets: [
      { type: 'bar', label: 'Claim value', data: a.byMonth.map((m) => Math.round(m.claimed)), backgroundColor: 'rgba(99,102,241,0.55)', borderRadius: 4, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Claims', data: a.byMonth.map((m) => m.count), borderColor: C.emerald, backgroundColor: C.emerald, tension: 0.35, yAxisID: 'y1', order: 1, pointRadius: 3 },
    ],
  }), [a])

  const agingChart = useMemo(() => ({
    labels: ['0–30 d', '31–60 d', '61–90 d', '90+ d'],
    datasets: [{
      label: 'Open claims',
      data: [a.aging['0-30'].count, a.aging['31-60'].count, a.aging['61-90'].count, a.aging['90+'].count],
      backgroundColor: [C.emerald, C.amber, '#fb923c', C.red], borderRadius: 4,
    }],
  }), [a])

  const assetChart = useMemo(() => ({
    labels: a.topAssets.map((x) => x.label),
    datasets: [{ label: 'Claim value', data: a.topAssets.map((x) => Math.round(x.value)), backgroundColor: C.cyan, borderRadius: 4 }],
  }), [a])

  const siteChart = useMemo(() => ({
    labels: a.bySite.map((x) => x.label),
    datasets: [{ label: 'Claim value', data: a.bySite.map((x) => Math.round(x.value)), backgroundColor: C.violet, borderRadius: 4 }],
  }), [a])

  // ── Export (reuses the shared branded PDF/Excel utils) ────────────────────────
  const EXPORT_KEYS = ['incident_date', 'asset_no', 'site', 'driver_name', 'state', 'claim_status', 'insurer', 'policy_no', 'gcc_liability_ratio', 'fault_status', 'claim_amount', 'claim_approved_amount', 'deductible', 'recovered_amount', 'net_cost', 'expected_release_date', 'release_date']
  const EXPORT_HEADERS = ['Date', 'Asset', 'Site', 'Driver', 'State', 'Claim Status', 'Insurer', 'Policy/Claim No', 'GCC Liab %', 'Fault', 'Claimed', 'Approved', 'Deductible', 'Recovered', 'Net', 'Expected Release', 'Released']
  const exportRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return a.claims.map((r) => ({
      incident_date: fmtDate(r.incident_date),
      asset_no: r.asset_no || '',
      site: r.site || '',
      driver_name: r.driver_name || '',
      state: isClosed(r) ? 'Closed' : isDelayed(r, today) ? 'Delayed' : 'Open',
      claim_status: r.claim_status || '',
      insurer: r.insurer || '',
      policy_no: r.policy_no || '',
      gcc_liability_ratio: (r.gcc_liability_ratio ?? '') === '' ? '' : `${Number(r.gcc_liability_ratio)}%`,
      fault_status: r.fault_status || '',
      claim_amount: r.claim_amount ?? '',
      claim_approved_amount: r.claim_approved_amount ?? '',
      deductible: r.deductible ?? '',
      recovered_amount: r.recovered_amount ?? '',
      net_cost: Math.max(0, (Number(r.repair_cost) || Number(r.estimated_damage_cost) || 0) + (Number(r.parts_cost) || 0) - (Number(r.recovered_amount) || 0)),
      expected_release_date: fmtDate(r.expected_release_date),
      release_date: fmtDate(r.release_date),
    }))
  }, [a])

  const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const stamp = () => new Date().toISOString().slice(0, 10)
  const exportPdf = () => exportToPdf(
    exportRows, EXPORT_KEYS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
    'Insurance Claims Summary', `ClaimsSummary_${stamp()}`, 'landscape',
    appSettings?.company_name || '', { currency: ccy },
  )
  const exportExcel = () => exportToExcel(
    exportRows, EXPORT_KEYS, EXPORT_HEADERS, `ClaimsSummary_${stamp()}`, 'Claims',
    { title: 'Insurance Claims Summary', currency: ccy, company: appSettings?.company_name, meta: { Scope: scope, Claims: a.total } },
  )

  const loading = rows === null
  const empty = !loading && a.total === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims Summary"
        subtitle="Live insurance-claims intelligence over accident records — value, recovery, liability, ageing and delays."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportExcel} disabled={empty} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"><FileSpreadsheet size={14} /> Excel</button>
            <button onClick={exportPdf} disabled={empty} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"><FileText size={14} /> PDF</button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load claims.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="label">Insurer</label>
            <select className="input" value={insurerF} onChange={(e) => setInsurerF(e.target.value)}>
              <option value="">All insurers</option>
              {insurerOptions.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div><label className="label">Site</label>
            <select className="input" value={siteF} onChange={(e) => setSiteF(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((sname) => <option key={sname} value={sname}>{sname}</option>)}
            </select>
          </div>
          <div><label className="label">State</label>
            <select className="input" value={stateF} onChange={(e) => setStateF(e.target.value)}>
              <option value="all">All states</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="delayed">Delayed only</option>
            </select>
          </div>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto flex items-center gap-1.5"><Filter size={12} /> {a.total} claim{a.total === 1 ? '' : 's'} · {scope}</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="card h-[86px] animate-pulse" />)}
        </div>
      ) : empty ? (
        <div className="card text-center py-16">
          <Inbox size={34} className="mx-auto mb-3 text-[var(--text-muted)] opacity-60" />
          <p className="text-[var(--text-primary)] font-medium">No insurance claims in range.</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Claims are read from accident records that carry a claim amount, a claim status or an insurer.
            {hasFilters ? ' Try widening the filters.' : ' Add claim details on an accident to see them here.'}
          </p>
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Total claims" value={a.total} sub={`${a.open} open · ${a.closed} closed`} icon={ShieldAlert} accent="text-indigo-400" />
            <Kpi label="Delayed" value={a.delayed} sub="past expected release" icon={Clock} tone={a.delayed ? 'text-red-400' : 'text-emerald-400'} accent={a.delayed ? 'text-red-400' : 'text-emerald-400'} />
            <Kpi label="Total claimed" value={money(a.claimed)} sub={`avg ${money(a.avgClaim)}`} icon={DollarSign} accent="text-blue-400" />
            <Kpi label="Approved" value={money(a.approved)} sub={a.approvalRate == null ? '—' : `${a.approvalRate}% of claimed`} icon={ShieldCheck} tone="text-violet-300" accent="text-violet-400" />
            <Kpi label="Recovered" value={money(a.recovered)} sub={a.recoveryRate == null ? '—' : `${a.recoveryRate}% recovery`} icon={TrendingUp} tone="text-emerald-400" accent="text-emerald-400" />
            <Kpi label="Net exposure" value={money(a.netExposure)} sub="after recoveries" icon={Wallet} tone={a.netExposure ? 'text-red-400' : 'text-emerald-400'} accent="text-red-400" />
            <Kpi label="Outstanding" value={money(a.outstanding)} sub="approved, not recovered" icon={Percent} tone={a.outstanding ? 'text-amber-400' : 'text-emerald-400'} accent="text-amber-400" />
            <Kpi label="Avg cycle" value={a.avgCycleDays == null ? '—' : `${a.avgCycleDays} d`} sub="incident → release" icon={Gauge} accent="text-cyan-400" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Claims by status" subtitle="Distribution across claim lifecycle"><Doughnut data={statusChart} options={DOUGHNUT} /></ChartCard>
            <ChartCard title="GCC liability split" subtitle="0% / 50% / 100% fault ratio"><Doughnut data={liabilityChart} options={DOUGHNUT} /></ChartCard>
            <ChartCard title="Fault status" subtitle="Faulty vs non-faulty"><Doughnut data={faultChart} options={DOUGHNUT} /></ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Monthly claims trend" subtitle="Claim value (bars) & count (line), last 12 months"><Bar data={trendChart} options={DUAL_AXIS} /></ChartCard>
            <ChartCard title="Recovery funnel" subtitle="Claimed → approved → recovered"><Bar data={recoveryChart} options={NO_LEGEND} /></ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Claim value by insurer" subtitle="Top insurers by exposure"><Bar data={insurerChart} options={HORIZONTAL} /></ChartCard>
            <ChartCard title="Open-claim ageing" subtitle="Open claims by days since incident"><Bar data={agingChart} options={NO_LEGEND} /></ChartCard>
          </div>

          {/* Delay intelligence */}
          <DelayIntelligence detail={a.delayedDetail} money={money} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Highest-cost assets" subtitle="Top vehicles by claim value"><Bar data={assetChart} options={HORIZONTAL} /></ChartCard>
            <ChartCard title="Claim value by site" subtitle="Branch / site exposure"><Bar data={siteChart} options={HORIZONTAL} /></ChartCard>
          </div>

          {/* Detail table */}
          <ClaimsTable claims={a.claims} money={money} ccy={ccy} />
        </>
      )}
    </div>
  )
}

/**
 * Delay intelligence — deep view over delayed (open, past expected release)
 * claims: overdue-day statistics, value at risk, severity buckets, per-insurer
 * ranking and the worst offenders. All figures come from
 * analyzeClaims().delayedDetail (single engine, no local maths).
 */
function DelayIntelligence({ detail, money }) {
  const d = detail || { count: 0, valueAtRisk: 0, buckets: {}, byInsurer: [], worst: [] }

  if (!d.count) {
    return (
      <div className="card">
        <div className="mb-1 flex items-center gap-2">
          <Clock size={15} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delay intelligence</h3>
        </div>
        <div className="text-center py-8">
          <ShieldCheck size={30} className="mx-auto mb-2 text-emerald-400 opacity-80" />
          <p className="text-[var(--text-primary)] font-medium">No delayed claims: all open claims are within their expected release dates.</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">A claim counts as delayed when it is still open after its expected release date.</p>
        </div>
      </div>
    )
  }

  const buckets = d.buckets || {}
  const b = (k) => buckets[k] || { count: 0, value: 0 }
  const bucketChart = {
    labels: ['1 to 7 days', '8 to 30 days', '31+ days'],
    datasets: [{
      label: 'Delayed claims',
      data: [b('1-7').count, b('8-30').count, b('31+').count],
      backgroundColor: [C.emerald, C.amber, C.red], borderRadius: 4,
    }],
  }

  const dayBadge = (od) => {
    const cls = od <= 7
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : od <= 30
        ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
        : 'bg-red-900/40 text-red-300 border-red-700/50'
    return <span className={`badge text-[11px] px-2 py-0.5 rounded border ${cls}`}>{od} d overdue</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock size={15} className="text-red-400" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delay intelligence</h3>
        <span className="text-xs text-[var(--text-muted)]">open claims past their expected release date</span>
      </div>

      {/* Delay KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Delayed claims" value={d.count} sub="open and past expected release" icon={Clock} tone="text-red-400" accent="text-red-400" />
        <Kpi label="Avg days overdue" value={d.avgOverdueDays == null ? 'N/A' : `${d.avgOverdueDays} d`} sub="across delayed claims" icon={Gauge} tone="text-amber-300" accent="text-amber-400" />
        <Kpi label="Max days overdue" value={d.maxOverdueDays == null ? 'N/A' : `${d.maxOverdueDays} d`} sub="worst single claim" icon={AlertTriangle} tone="text-red-400" accent="text-red-400" />
        <Kpi label="Value at risk" value={money(d.valueAtRisk)} sub="outstanding on delayed claims" icon={Wallet} tone={d.valueAtRisk ? 'text-red-400' : 'text-emerald-400'} accent="text-red-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Delay severity buckets" subtitle="Delayed claims by days overdue" height={220}>
          <Bar data={bucketChart} options={NO_LEGEND} />
        </ChartCard>

        {/* Delayed by insurer */}
        <div className="card">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delayed claims by insurer</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Ranked by delayed count, then value at risk</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-2 py-2 font-semibold">Insurer</th>
                  <th className="px-2 py-2 font-semibold text-right">Delayed</th>
                  <th className="px-2 py-2 font-semibold text-right">Value at risk</th>
                </tr>
              </thead>
              <tbody>
                {(d.byInsurer || []).map((x) => (
                  <tr key={x.label} className="border-b border-[var(--input-border)]/50">
                    <td className="px-2 py-2 text-[var(--text-primary)] whitespace-nowrap">{x.label}</td>
                    <td className="px-2 py-2 text-right text-red-300 font-medium">{x.count}</td>
                    <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{money(x.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Worst delayed claims */}
      <div className="card overflow-hidden !p-0">
        <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
          <AlertTriangle size={15} className="text-red-400" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Worst delayed claims</h3>
          <span className="text-xs text-[var(--text-muted)] ml-auto">top {(d.worst || []).length} by days overdue</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Incident date', 'Asset', 'Insurer', 'Expected release', 'Days overdue', 'Outstanding'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(d.worst || []).map((w, i) => (
                <tr key={`${w.asset_no || 'na'}-${w.expected_release_date || 'na'}-${i}`} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 bg-red-950/10">
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{w.incident_date || 'N/A'}</td>
                  <td className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap">{w.asset_no || 'N/A'}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{w.insurer || 'N/A'}</td>
                  <td className="px-3 py-2 text-red-300 font-medium whitespace-nowrap">{w.expected_release_date || 'N/A'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{dayBadge(w.overdue_days)}</td>
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">{money(w.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ClaimsTable({ claims, money }) {
  const today = new Date().toISOString().slice(0, 10)
  const badge = (r) => {
    if (isClosed(r)) return <span className="badge text-[11px] px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">Closed</span>
    if (isDelayed(r, today)) return <span className="badge text-[11px] px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50">Delayed</span>
    return <span className="badge text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">Open</span>
  }
  const sorted = [...claims].sort((x, y) => String(y.incident_date || '').localeCompare(String(x.incident_date || '')))
  return (
    <div className="card overflow-hidden !p-0">
      <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
        <Building2 size={15} className="text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Claim detail</h3>
        <span className="text-xs text-[var(--text-muted)] ml-auto">{sorted.length} record{sorted.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
              {['Date', 'Asset', 'Site', 'Insurer', 'Liab', 'Fault', 'State', 'Claimed', 'Approved', 'Recovered', 'Expected'].map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const delayed = !isClosed(r) && isDelayed(r, today)
              return (
                <tr key={r.id || i} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${delayed ? 'bg-red-950/20' : ''}`}>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.incident_date)}</td>
                  <td className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap">{r.asset_no || '—'}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{r.site || '—'}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{r.insurer || '—'}{r.policy_no ? <span className="text-[var(--text-muted)]"> · {r.policy_no}</span> : ''}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{(r.gcc_liability_ratio ?? '') === '' ? '—' : `${Number(r.gcc_liability_ratio)}%`}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{r.fault_status || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{badge(r)}</td>
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">{money(r.claim_amount)}</td>
                  <td className="px-3 py-2 text-violet-300 whitespace-nowrap">{r.claim_approved_amount ? money(r.claim_approved_amount) : '—'}</td>
                  <td className="px-3 py-2 text-emerald-400 whitespace-nowrap">{r.recovered_amount ? money(r.recovered_amount) : '—'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${delayed ? 'text-red-300 font-medium' : 'text-[var(--text-secondary)]'}`}>{fmtDate(r.expected_release_date)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

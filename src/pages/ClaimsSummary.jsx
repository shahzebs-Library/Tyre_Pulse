/**
 * ClaimsSummary (route /claims-summary) - Accident & Insurance module.
 *
 * A chart-rich, read-only intelligence dashboard over the insurance claims that
 * ride on real ACCIDENT records (accidents table): claim / approved / deductible
 * / recovered amounts, insurer, GCC liability ratio, fault status, Najm/Taqdeer,
 * expected vs actual release. All figures come from the single claims engine
 * (src/lib/claimsAnalytics.js) so the dashboard, its KPI tiles and the PDF/Excel
 * export can never drift apart; filtering, table shaping and export rows live in
 * src/lib/claimsSummaryAnalytics.js.
 *
 * Distinct from /insurance-claims (a manual CRUD ledger over the separate
 * insurance_claims table) - this is live analytics over accident-embedded claims,
 * which is where the operational claim data actually lives.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldAlert, DollarSign, TrendingUp, ShieldCheck, Clock, Inbox,
  AlertTriangle, Percent, Wallet, FileText, FileSpreadsheet,
  Filter, X, Building2, Gauge, Search, RefreshCcw, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { listAllAccidentsForPage } from '../lib/api/accidents'
import { analyzeClaims } from '../lib/claimsAnalytics'
import {
  todayIso, filterClaimRows, claimFilterOptions, claimTableRows, CLAIM_SORT_ACCESSORS, sortRows,
  delayedInsurerRows, claimExportRows, CLAIM_EXPORT_KEYS, CLAIM_EXPORT_HEADERS, monthLabel, liabilityText,
} from '../lib/claimsSummaryAnalytics'
import { nextSort } from '../lib/consoleTableSort'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import EmailPdfButton from '../components/EmailPdfButton'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Chart theme: tokens resolved per theme by the global chartVarPlugin ──────
const AXIS = { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } }
const TOOLTIP = { backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-subtle)', borderWidth: 1, titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)' }
const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: TOOLTIP,
  },
  scales: { x: AXIS, y: AXIS },
}
const NO_LEGEND = { ...BASE, plugins: { ...BASE.plugins, legend: { display: false } } }
const HORIZONTAL = { ...NO_LEGEND, indexAxis: 'y' }
const DOUGHNUT = {
  responsive: true, maintainAspectRatio: false, cutout: '62%',
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 12, padding: 12, font: { size: 11 } } }, tooltip: TOOLTIP },
}
const DUAL_AXIS = {
  ...BASE,
  scales: {
    x: AXIS,
    y: { ...AXIS, position: 'left', title: { display: true, text: 'Value', color: 'var(--text-muted)', font: { size: 10 } } },
    y1: { ...AXIS, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Count', color: 'var(--text-muted)', font: { size: 10 } } },
  },
}

/** Semantic tones (the colour carries meaning: good / caution / bad / unknown). */
const SEM = { good: '#10b981', warn: '#f59e0b', orange: '#fb923c', bad: '#ef4444', unknown: '#64748b' }
const STATE_BADGE = {
  Closed: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  Delayed: 'bg-red-900/40 text-red-300 border-red-700/50',
  Open: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
}
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'

// ── Presentational bits ───────────────────────────────────────────────────────
function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]', accent = 'text-[var(--text-muted)]' }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={accent} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub != null && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}
function ChartCard({ title, subtitle, summary, children, height = 260 }) {
  return (
    <div className="card min-w-0">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
      </div>
      <div style={{ height }} role="img" aria-label={summary || title}>{children}</div>
    </div>
  )
}
function StateBadge({ state }) {
  return <span className={`badge text-[11px] px-2 py-0.5 rounded border ${STATE_BADGE[state] || STATE_BADGE.Open}`}>{state}</span>
}

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * EnterpriseTable over the shared pager. Sorting runs over the FULL row set
 * before paging, so a column sort never re-orders only the visible page.
 */
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, maxHeight = 600 }) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.key)
    return col?.sort ? sortRows(rows, sort, { [col.id]: col.sort }) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted)
  const tableColumns = useMemo(() => columns.map((c) => ({
    id: c.id,
    accessorFn: c.sort || ((r) => r[c.id]),
    header: c.sort
      ? () => <SortButton label={c.header} align={c.align} active={sort?.key === c.id} dir={sort?.dir} onClick={() => setSort((s) => nextSort(s, c.id, c.firstDir || 'desc'))} />
      : c.header,
    cell: c.cell ? ({ row }) => c.cell(row.original) : undefined,
    size: c.size,
    enableSorting: false,
    meta: { align: c.align },
  })), [columns, sort])
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={tableColumns}
        data={pager.pageRows}
        getRowId={getRowId}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      <TablePagination {...pager} />
    </div>
  )
}

export default function ClaimsSummary() {
  const { activeCountry, activeCurrency, appSettings } = useSettings() || {}
  const ccy = activeCurrency || 'SAR'
  const money = useCallback((v) => (v == null || v === '' ? 'N/A' : formatCurrencyCompact(v, ccy)), [ccy])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [insurerF, setInsurerF] = useState('')
  const [siteF, setSiteF] = useState('')
  const [stateF, setStateF] = useState('all') // all | open | closed | delayed
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const { data, error: err } = await listAllAccidentsForPage({ country: activeCountry })
      if (err) throw err
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (e) {
      // A failed read is not "no claims": keep rows null so nothing renders as zero.
      setError(toUserMessage(e, 'Could not load claims.')); setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const today = todayIso()
  const filtered = useMemo(
    () => filterClaimRows(rows || [], { from, to, insurer: insurerF, site: siteF, state: stateF, search }, today),
    [rows, from, to, insurerF, siteF, stateF, search, today],
  )
  const a = useMemo(() => analyzeClaims(filtered, { now: today }), [filtered, today])
  const tableRows = useMemo(() => claimTableRows(a.claims, today), [a, today])
  const options = useMemo(() => claimFilterOptions(rows || []), [rows])

  const hasFilters = from || to || insurerF || siteF || stateF !== 'all' || search
  const clearFilters = () => { setFrom(''); setTo(''); setInsurerF(''); setSiteF(''); setStateF('all'); setSearch('') }

  // ── Charts ──────────────────────────────────────────────────────────────────
  const statusChart = useMemo(() => ({
    labels: a.byStatus.map((x) => x.label),
    datasets: [{ data: a.byStatus.map((x) => x.count), backgroundColor: categorical(a.byStatus.length), borderWidth: 0 }],
  }), [a])

  const liabilityChart = useMemo(() => ({
    labels: ['0% (not liable)', '50% (shared)', '100% (at fault)', 'Unknown'],
    datasets: [{
      data: [a.liability[0].count, a.liability[50].count, a.liability[100].count, a.liability.unknown.count],
      backgroundColor: [SEM.good, SEM.warn, SEM.bad, SEM.unknown], borderWidth: 0,
    }],
  }), [a])

  const faultChart = useMemo(() => ({
    labels: ['Faulty', 'Non-faulty', 'Unknown'],
    datasets: [{ data: [a.fault.faulty.count, a.fault.non_faulty.count, a.fault.unknown.count], backgroundColor: [SEM.bad, SEM.good, SEM.unknown], borderWidth: 0 }],
  }), [a])

  const insurerChart = useMemo(() => ({
    labels: a.byInsurer.map((x) => x.label),
    datasets: [{ label: 'Claim value', data: a.byInsurer.map((x) => Math.round(x.value)), backgroundColor: withAlpha(colorAt(0), 0.85), borderRadius: 4 }],
  }), [a])

  const recoveryChart = useMemo(() => ({
    labels: ['Claimed', 'Approved', 'Recovered'],
    datasets: [{ data: [Math.round(a.claimed), Math.round(a.approved), Math.round(a.recovered)], backgroundColor: [colorAt(3), colorAt(4), SEM.good], borderRadius: 4 }],
  }), [a])

  const trendChart = useMemo(() => ({
    labels: a.byMonth.map((m) => monthLabel(m.ym)),
    datasets: [
      { type: 'bar', label: 'Claim value', data: a.byMonth.map((m) => Math.round(m.claimed)), backgroundColor: withAlpha(colorAt(0), 0.55), borderRadius: 4, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Claims', data: a.byMonth.map((m) => m.count), borderColor: colorAt(1), backgroundColor: colorAt(1), tension: 0.35, yAxisID: 'y1', order: 1, pointRadius: 3 },
    ],
  }), [a])

  const agingChart = useMemo(() => ({
    labels: ['0 to 30 d', '31 to 60 d', '61 to 90 d', '90+ d'],
    datasets: [{
      label: 'Open claims',
      data: [a.aging['0-30'].count, a.aging['31-60'].count, a.aging['61-90'].count, a.aging['90+'].count],
      backgroundColor: [SEM.good, SEM.warn, SEM.orange, SEM.bad], borderRadius: 4,
    }],
  }), [a])

  const assetChart = useMemo(() => ({
    labels: a.topAssets.map((x) => x.label),
    datasets: [{ label: 'Claim value', data: a.topAssets.map((x) => Math.round(x.value)), backgroundColor: withAlpha(colorAt(5), 0.85), borderRadius: 4 }],
  }), [a])

  const siteChart = useMemo(() => ({
    labels: a.bySite.map((x) => x.label),
    datasets: [{ label: 'Claim value', data: a.bySite.map((x) => Math.round(x.value)), backgroundColor: withAlpha(colorAt(2), 0.85), borderRadius: 4 }],
  }), [a])

  // ── Export (every filtered claim, never just the visible page) ───────────────
  const exportRows = useMemo(
    () => claimExportRows(sortRows(tableRows, { key: 'date', dir: 'desc' }, CLAIM_SORT_ACCESSORS)),
    [tableRows],
  )
  const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const fileBase = reportFileName('Claims Summary', scope, today)
  const pdfCols = CLAIM_EXPORT_KEYS.map((k, i) => ({ key: k, header: CLAIM_EXPORT_HEADERS[i] }))
  const exportPdf = () => exportToPdf(exportRows, pdfCols, 'Insurance Claims Summary', fileBase, 'landscape', appSettings?.company_name || '', { currency: ccy })
  const exportExcel = () => exportToExcel(
    exportRows, CLAIM_EXPORT_KEYS, CLAIM_EXPORT_HEADERS, fileBase, 'Claims',
    { title: 'Insurance Claims Summary', currency: ccy, company: appSettings?.company_name, meta: { Scope: scope, Claims: a.total } },
  )

  const loading = rows === null && !error
  const failed = rows === null && !!error
  const empty = !loading && !failed && a.total === 0

  const claimColumns = useMemo(() => [
    { id: 'date', header: 'Date', sort: CLAIM_SORT_ACCESSORS.date, size: 110, cell: (r) => <span className="tabular-nums text-[var(--text-secondary)]">{r.incident_date ? String(r.incident_date).slice(0, 10) : 'N/A'}</span> },
    { id: 'asset', header: 'Asset', sort: CLAIM_SORT_ACCESSORS.asset, firstDir: 'asc', size: 110, cell: (r) => <span className="font-medium text-[var(--text-primary)]">{r.asset_no || 'N/A'}</span> },
    { id: 'site', header: 'Site', sort: CLAIM_SORT_ACCESSORS.site, firstDir: 'asc', size: 120, cell: (r) => <span className="text-[var(--text-secondary)]">{r.site || 'N/A'}</span> },
    { id: 'insurer', header: 'Insurer', sort: CLAIM_SORT_ACCESSORS.insurer, firstDir: 'asc', size: 180,
      cell: (r) => <span className="text-[var(--text-secondary)]">{r.insurer || 'N/A'}{r.policy_no ? <span className="text-[var(--text-muted)]"> ({r.policy_no})</span> : null}</span> },
    { id: 'liability', header: 'Liab', sort: CLAIM_SORT_ACCESSORS.liability, align: 'right', size: 70, cell: (r) => <span className="tabular-nums">{liabilityText(r.gcc_liability_ratio) || 'N/A'}</span> },
    { id: 'fault', header: 'Fault', sort: CLAIM_SORT_ACCESSORS.fault, firstDir: 'asc', size: 110, cell: (r) => <span className="text-[var(--text-secondary)]">{r.fault_status || 'N/A'}</span> },
    { id: 'state', header: 'State', sort: CLAIM_SORT_ACCESSORS.state, firstDir: 'asc', size: 100, cell: (r) => <StateBadge state={r._state} /> },
    { id: 'claimed', header: 'Claimed', sort: CLAIM_SORT_ACCESSORS.claimed, align: 'right', size: 110, cell: (r) => <span className="tabular-nums font-medium">{money(r._claimed)}</span> },
    { id: 'approved', header: 'Approved', sort: CLAIM_SORT_ACCESSORS.approved, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{r._approved ? money(r._approved) : 'N/A'}</span> },
    { id: 'recovered', header: 'Recovered', sort: CLAIM_SORT_ACCESSORS.recovered, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{r._recovered ? money(r._recovered) : 'N/A'}</span> },
    { id: 'net', header: 'Net', sort: CLAIM_SORT_ACCESSORS.net, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{money(r._net)}</span> },
    { id: 'expected', header: 'Expected', sort: CLAIM_SORT_ACCESSORS.expected, size: 140,
      cell: (r) => (
        <span className={`tabular-nums ${r._state === 'Delayed' ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
          {r.expected_release_date ? String(r.expected_release_date).slice(0, 10) : 'N/A'}
          {r._overdue ? <span className="text-[11px]"> ({r._overdue} d late)</span> : null}
        </span>
      ) },
  ], [money])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims Summary"
        subtitle="Live insurance-claims intelligence over accident records: value, recovery, liability, ageing and delays."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportExcel} disabled={!exportRows.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            <button type="button" onClick={exportPdf} disabled={!exportRows.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"><FileText size={14} aria-hidden="true" /> PDF</button>
            <EmailPdfButton
              disabled={!exportRows.length}
              label="Email PDF"
              getPdf={async () => ({
                base64: await exportToPdf(
                  exportRows, pdfCols, 'Insurance Claims Summary', fileBase, 'landscape',
                  appSettings?.company_name || '', { currency: ccy, returnBase64: true },
                ),
                filename: `${fileBase}.pdf`,
                subject: 'Insurance Claims Summary',
                bodyHtml: `<p>Attached is the Insurance Claims Summary for ${appSettings?.company_name || 'your fleet'} (scope: ${scope}).</p>`,
              })}
            />
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-400 font-medium">Claims could not be loaded.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error} Figures stay hidden until the read succeeds.</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCcw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="label" htmlFor="claims-search">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="claims-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Asset, driver, insurer, policy..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div><span className="label">From</span><DateField className="text-sm w-full" value={from} onChange={setFrom} placeholder="From date" ariaLabel="From date" max={to || undefined} /></div>
          <div><span className="label">To</span><DateField className="text-sm w-full" value={to} onChange={setTo} placeholder="To date" ariaLabel="To date" min={from || undefined} /></div>
          <div><label className="label" htmlFor="claims-insurer">Insurer</label>
            <select id="claims-insurer" className="input w-full min-h-[44px]" value={insurerF} onChange={(e) => setInsurerF(e.target.value)}>
              <option value="">All insurers</option>
              {options.insurers.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="claims-site">Site</label>
            <select id="claims-site" className="input w-full min-h-[44px]" value={siteF} onChange={(e) => setSiteF(e.target.value)}>
              <option value="">All sites</option>
              {options.sites.map((sname) => <option key={sname} value={sname}>{sname}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-[var(--input-border)] p-0.5" role="group" aria-label="Claim state">
            {[['all', 'All states'], ['open', 'Open'], ['closed', 'Closed'], ['delayed', 'Delayed only']].map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setStateF(k)} aria-pressed={stateF === k}
                className={`px-3 min-h-[40px] text-sm rounded-md ${FOCUS} ${stateF === k ? 'bg-[var(--accent)] text-white font-semibold' : 'text-[var(--text-secondary)]'}`}>{lbl}</button>
            ))}
          </div>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto flex items-center gap-1.5" aria-live="polite"><Filter size={12} aria-hidden="true" /> {failed ? 'N/A' : `${a.total} claim${a.total === 1 ? '' : 's'}`}, {scope}</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="status" aria-label="Loading claims">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="card h-[86px] animate-pulse" />)}
        </div>
      ) : failed ? null : empty ? (
        <div className="card text-center py-16">
          <Inbox size={34} className="mx-auto mb-3 text-[var(--text-muted)] opacity-60" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium">No insurance claims in range.</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Claims are read from accident records that carry a claim amount, a claim status or an insurer.
            {hasFilters ? ' Try widening the filters.' : ' Add claim details on an accident to see them here.'}
          </p>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] mt-4 mx-auto"><X size={14} aria-hidden="true" /> Clear filters</button>}
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Total claims" value={a.total} sub={`${a.open} open, ${a.closed} closed`} icon={ShieldAlert} accent="text-indigo-400" />
            <Kpi label="Delayed" value={a.delayed} sub="past expected release" icon={Clock} tone={a.delayed ? 'text-red-400' : 'text-emerald-500'} accent={a.delayed ? 'text-red-400' : 'text-emerald-500'} />
            <Kpi label="Total claimed" value={money(a.claimed)} sub={`avg ${money(a.avgClaim)}`} icon={DollarSign} accent="text-blue-400" />
            <Kpi label="Approved" value={money(a.approved)} sub={a.approvalRate == null ? 'N/A' : `${a.approvalRate}% of claimed`} icon={ShieldCheck} accent="text-violet-400" />
            <Kpi label="Recovered" value={money(a.recovered)} sub={a.recoveryRate == null ? 'N/A' : `${a.recoveryRate}% recovery`} icon={TrendingUp} tone="text-emerald-500" accent="text-emerald-500" />
            <Kpi label="Net exposure" value={money(a.netExposure)} sub="after recoveries" icon={Wallet} tone={a.netExposure ? 'text-red-400' : 'text-emerald-500'} accent="text-red-400" />
            <Kpi label="Outstanding" value={money(a.outstanding)} sub="approved, not recovered" icon={Percent} tone={a.outstanding ? 'text-amber-500' : 'text-emerald-500'} accent="text-amber-500" />
            <Kpi label="Avg cycle" value={a.avgCycleDays == null ? 'N/A' : `${a.avgCycleDays} d`} sub="incident to release" icon={Gauge} accent="text-cyan-400" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Claims by status" subtitle="Distribution across claim lifecycle" summary={`Claims by status: ${a.byStatus.map((x) => `${x.label} ${x.count}`).join(', ')}`}><Doughnut data={statusChart} options={DOUGHNUT} /></ChartCard>
            <ChartCard title="GCC liability split" subtitle="0% / 50% / 100% fault ratio" summary={`Liability: not liable ${a.liability[0].count}, shared ${a.liability[50].count}, at fault ${a.liability[100].count}, unknown ${a.liability.unknown.count}`}><Doughnut data={liabilityChart} options={DOUGHNUT} /></ChartCard>
            <ChartCard title="Fault status" subtitle="Faulty vs non-faulty" summary={`Fault: faulty ${a.fault.faulty.count}, non-faulty ${a.fault.non_faulty.count}, unknown ${a.fault.unknown.count}`}><Doughnut data={faultChart} options={DOUGHNUT} /></ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Monthly claims trend" subtitle="Claim value (bars) and count (line), last 12 months"><Bar data={trendChart} options={DUAL_AXIS} /></ChartCard>
            <ChartCard title="Recovery funnel" subtitle="Claimed, then approved, then recovered" summary={`Claimed ${money(a.claimed)}, approved ${money(a.approved)}, recovered ${money(a.recovered)}`}><Bar data={recoveryChart} options={NO_LEGEND} /></ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Claim value by insurer" subtitle="Top insurers by exposure"><Bar data={insurerChart} options={HORIZONTAL} /></ChartCard>
            <ChartCard title="Open-claim ageing" subtitle="Open claims by days since incident" summary={`Open claims ageing: 0 to 30 days ${a.aging['0-30'].count}, 31 to 60 ${a.aging['31-60'].count}, 61 to 90 ${a.aging['61-90'].count}, over 90 ${a.aging['90+'].count}`}><Bar data={agingChart} options={NO_LEGEND} /></ChartCard>
          </div>

          {/* Delay intelligence */}
          <DelayIntelligence detail={a.delayedDetail} money={money} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Highest-cost assets" subtitle="Top vehicles by claim value"><Bar data={assetChart} options={HORIZONTAL} /></ChartCard>
            <ChartCard title="Claim value by site" subtitle="Branch or site exposure"><Bar data={siteChart} options={HORIZONTAL} /></ChartCard>
          </div>

          {/* Detail table */}
          <section className="card !p-0 overflow-hidden" aria-labelledby="claims-detail-h">
            <div className="px-4 py-3 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
              <Building2 size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
              <h3 id="claims-detail-h" className="text-sm font-semibold text-[var(--text-primary)]">Claim detail</h3>
              <span className="text-xs text-[var(--text-muted)] ml-auto">{tableRows.length} record{tableRows.length === 1 ? '' : 's'}, sort any column</span>
            </div>
            <div className="p-2">
              <SortedPagedTable
                columns={claimColumns}
                rows={tableRows}
                defaultSort={{ key: 'date', dir: 'desc' }}
                getRowId={(r) => String(r.id)}
                emptyMessage="No claims match these filters."
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/**
 * Delay intelligence - deep view over delayed (open, past expected release)
 * claims: overdue-day statistics, value at risk, severity buckets, per-insurer
 * ranking and the worst offenders. All figures come from
 * analyzeClaims().delayedDetail (single engine, no local maths).
 */
function DelayIntelligence({ detail, money }) {
  const d = detail || { count: 0, valueAtRisk: 0, buckets: {}, byInsurer: [], worst: [] }
  const insurerRows = useMemo(() => delayedInsurerRows(detail), [detail])

  const insurerColumns = useMemo(() => [
    { id: 'insurer', header: 'Insurer', accessorFn: (x) => x.label, cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original.label}</span> },
    { id: 'count', header: 'Delayed', accessorFn: (x) => x.count, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums font-medium text-red-400">{row.original.count}</span> },
    { id: 'value', header: 'Value at risk', accessorFn: (x) => x.value, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{money(row.original.value)}</span> },
    { id: 'share', header: 'Share', accessorFn: (x) => x.share, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{row.original.share == null ? 'N/A' : `${row.original.share.toFixed(1)}%`}</span> },
  ], [money])

  const worstColumns = useMemo(() => [
    { id: 'date', header: 'Incident date', accessorFn: (w) => w.incident_date || null, cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{row.original.incident_date || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (w) => w.asset_no || null, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'insurer', header: 'Insurer', accessorFn: (w) => w.insurer || null, cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.insurer || 'N/A'}</span> },
    { id: 'expected', header: 'Expected release', accessorFn: (w) => w.expected_release_date || null, cell: ({ row }) => <span className="tabular-nums text-red-400 font-medium">{row.original.expected_release_date || 'N/A'}</span> },
    { id: 'overdue', header: 'Days overdue', accessorFn: (w) => w.overdue_days, meta: { align: 'right' },
      cell: ({ row }) => {
        const od = row.original.overdue_days
        const cls = od <= 7 ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' : od <= 30 ? 'bg-amber-900/40 text-amber-300 border-amber-700/50' : 'bg-red-900/40 text-red-300 border-red-700/50'
        return <span className={`badge text-[11px] px-2 py-0.5 rounded border ${cls}`}>{od} d overdue</span>
      } },
    { id: 'outstanding', header: 'Outstanding', accessorFn: (w) => w.outstanding, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums font-medium">{money(row.original.outstanding)}</span> },
  ], [money])

  if (!d.count) {
    return (
      <div className="card">
        <div className="mb-1 flex items-center gap-2">
          <Clock size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delay intelligence</h3>
        </div>
        <div className="text-center py-8">
          <ShieldCheck size={30} className="mx-auto mb-2 text-emerald-500 opacity-80" aria-hidden="true" />
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
      backgroundColor: [SEM.good, SEM.warn, SEM.bad], borderRadius: 4,
    }],
  }

  return (
    <section className="space-y-4" aria-labelledby="claims-delay-h">
      <div className="flex flex-wrap items-center gap-2">
        <Clock size={15} className="text-red-400" aria-hidden="true" />
        <h3 id="claims-delay-h" className="text-sm font-semibold text-[var(--text-primary)]">Delay intelligence</h3>
        <span className="text-xs text-[var(--text-muted)]">open claims past their expected release date</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Delayed claims" value={d.count} sub="open and past expected release" icon={Clock} tone="text-red-400" accent="text-red-400" />
        <Kpi label="Avg days overdue" value={d.avgOverdueDays == null ? 'N/A' : `${d.avgOverdueDays} d`} sub="across delayed claims" icon={Gauge} tone="text-amber-500" accent="text-amber-500" />
        <Kpi label="Max days overdue" value={d.maxOverdueDays == null ? 'N/A' : `${d.maxOverdueDays} d`} sub="worst single claim" icon={AlertTriangle} tone="text-red-400" accent="text-red-400" />
        <Kpi label="Value at risk" value={money(d.valueAtRisk)} sub="outstanding on delayed claims" icon={Wallet} tone={d.valueAtRisk ? 'text-red-400' : 'text-emerald-500'} accent="text-red-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Delay severity buckets" subtitle="Delayed claims by days overdue" height={220}
          summary={`Delayed claims: 1 to 7 days ${b('1-7').count}, 8 to 30 days ${b('8-30').count}, over 30 days ${b('31+').count}`}>
          <Bar data={bucketChart} options={NO_LEGEND} />
        </ChartCard>

        <div className="card min-w-0">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delayed claims by insurer</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Ranked by delayed count, then value at risk</p>
          </div>
          <EnterpriseTable
            columns={insurerColumns}
            data={insurerRows}
            getRowId={(x) => String(x.label)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            enableColumnVisibility={false}
            virtual
            maxHeight={240}
            emptyMessage="No delayed claims by insurer."
          />
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
          <AlertTriangle size={15} className="text-red-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Worst delayed claims</h3>
          <span className="text-xs text-[var(--text-muted)] ml-auto">top {(d.worst || []).length} by days overdue</span>
        </div>
        <div className="p-2">
          <EnterpriseTable
            columns={worstColumns}
            data={d.worst || []}
            getRowId={(w, i) => `${w.asset_no || 'na'}-${w.expected_release_date || 'na'}-${i}`}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            virtual
            maxHeight={420}
            emptyMessage="No delayed claims."
          />
        </div>
      </div>
    </section>
  )
}

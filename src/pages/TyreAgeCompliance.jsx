/**
 * TyreAgeCompliance (route /tyre-age-compliance) - flags tyres that are too OLD
 * by CALENDAR age, regardless of remaining tread. Rubber degrades with age and
 * in GCC heat an under-worn but aged tyre is a real blow-out and insurance risk.
 *
 * Age is measured from the best available birth date (DOT or manufacture date
 * when present, else issue date, else fitment date) and classified into a
 * policy ladder: OK, Watch, Replace, Overdue, plus an honest "Date unknown"
 * bucket for tyres with no birth date on record.
 *
 * Runs on `tyre_records` (paged read). Banding and KPI maths live in
 * `src/lib/tyreAgeCompliance.js`; the page-level filters, histogram, action
 * list and exports live in `src/lib/tyreAgeComplianceAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CalendarClock, CheckCircle2, Search, X,
  FileSpreadsheet, FileText, Info, Gauge, CalendarX, RotateCcw, Database,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import { listTyresForAgeScan } from '../lib/api/tyreAgeCompliance'
import { assessFleet } from '../lib/tyreAgeCompliance'
import {
  buildAgeView, ageHistogram, dateSourceMix, actionList, ageExportRows,
  AGE_BANDS, AGE_BAND_META, DATE_SOURCE_META, DATE_SOURCES, DEFAULT_AGE_POLICY,
  serialOf, positionOf, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tyreAgeComplianceAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'

// Semantic band colours: the ladder carries meaning, so it stays fixed.
const BAND_HEX = { ok: '#22c55e', watch: '#f59e0b', replace: '#fb923c', overdue: '#ef4444', unknown: '#64748b' }
const BAND_STYLES = {
  ok: 'bg-green-900/30 text-green-400 border border-green-700/50',
  watch: 'bg-amber-900/30 text-amber-400 border border-amber-700/50',
  replace: 'bg-orange-900/30 text-orange-400 border border-orange-700/50',
  overdue: 'bg-red-900/30 text-red-400 border border-red-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const fmtAge = (y) => (y == null ? 'N/A' : `${y} yr`)
const dash = (v) => (v == null || v === '' ? 'N/A' : v)
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}
const DONUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '58%',
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', boxWidth: 12, padding: 12 } } },
}

function BandBadge({ band }) {
  return <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[band] || BAND_STYLES.unknown}`}>{AGE_BAND_META[band]?.label || 'N/A'}</span>
}

export default function TyreAgeCompliance() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fittedOnly, setFittedOnly] = useState(true)
  const [breakdownDim, setBreakdownDim] = useState('site')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listTyresForAgeScan({ country: activeCountry, fittedOnly })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load tyre records.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry, fittedOnly])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  // Enrich once against one reference clock (the engine is pure).
  const assessed = useMemo(() => assessFleet(rows || [], Date.now(), DEFAULT_AGE_POLICY).rows, [rows])
  const filters = useMemo(() => ({ band: bandFilter, site: siteFilter, brand: brandFilter, source: sourceFilter, search }),
    [bandFilter, siteFilter, brandFilter, sourceFilter, search])
  const { scope, summary, table } = useMemo(() => buildAgeView(assessed, filters, { now: Date.now() }), [assessed, filters])
  const { counts, kpis, distribution, bySite, byBrand } = summary
  const histogram = useMemo(() => ageHistogram(scope), [scope])
  const sources = useMemo(() => dateSourceMix(scope), [scope])
  const worklist = useMemo(() => actionList(scope, 10), [scope])

  const siteOptions = useMemo(() => [...new Set(assessed.map((r) => r.site).filter(Boolean))].sort(), [assessed])
  const brandOptions = useMemo(() => [...new Set(assessed.map((r) => r.brand).filter(Boolean))].sort(), [assessed])

  // ── Exports (the whole filtered table, never one page) ───────────────────
  const exportRows = useMemo(() => ageExportRows(table), [table])
  const fileBase = async () => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName('TyrePulse Tyre Age Compliance', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  }
  const pdfCols = EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] }))
  const doExcel = async () => {
    try {
      const { exportToExcel } = await loadExportUtils()
      await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, await fileBase())
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }
  const doPdf = async () => {
    try {
      const { exportToPdf } = await loadExportUtils()
      await exportToPdf(exportRows, pdfCols, 'Tyre Age Compliance', await fileBase(), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setBrandFilter(''); setSourceFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || !!(siteFilter || brandFilter || sourceFilter || search)
  const oldest = kpis.oldest

  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => serialOf(r) || 'N/A', size: 150,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{dash(serialOf(row.original))}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110 },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand || 'N/A', size: 120 },
    { id: 'size', header: 'Size', accessorFn: (r) => r.size || 'N/A', size: 120 },
    { id: 'position', header: 'Position', accessorFn: (r) => positionOf(r) || 'N/A', size: 100 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 120 },
    { id: 'age', header: 'Age', accessorFn: (r) => r.ageYears, size: 90, meta: { align: 'right' },
      sortUndefined: 'last', cell: ({ row }) => <span className="tabular-nums font-semibold">{fmtAge(row.original.ageYears)}</span> },
    { id: 'birth', header: 'Birth date', accessorFn: (r) => r.birthDate || 'N/A', size: 110 },
    { id: 'source', header: 'Date source', accessorFn: (r) => DATE_SOURCE_META[r.dateSource]?.label || 'N/A', size: 170,
      cell: ({ row }) => <span className="text-xs text-[var(--text-dim)] whitespace-nowrap">{DATE_SOURCE_META[row.original.dateSource]?.label || 'N/A'}</span> },
    { id: 'band', header: 'Status', accessorFn: (r) => AGE_BAND_META[r.ageBand]?.label || 'N/A', size: 120,
      cell: ({ row }) => <BandBadge band={row.original.ageBand} /> },
  ], [])

  const donutData = {
    labels: distribution.map((d) => d.label),
    datasets: [{ data: distribution.map((d) => d.count), backgroundColor: AGE_BANDS.map((b) => BAND_HEX[b]), borderWidth: 0 }],
  }
  const breakdown = breakdownDim === 'site' ? bySite : byBrand
  const barData = {
    labels: breakdown.map((g) => g.name),
    datasets: [{
      label: 'Average age (yrs)',
      data: breakdown.map((g) => g.avgAge),
      backgroundColor: breakdown.map((g) => (g.nonCompliant > 0 ? BAND_HEX.replace : withAlpha(colorAt(0), 0.75))),
      borderRadius: 4,
    }],
  }
  const histData = {
    labels: histogram.map((h) => (h.label === 'Unknown' ? 'Unknown' : `${h.label} yr`)),
    datasets: [{
      label: 'Tyres',
      data: histogram.map((h) => h.count),
      backgroundColor: histogram.map((h, i) => (h.label === 'Unknown' ? BAND_HEX.unknown
        : i >= DEFAULT_AGE_POLICY.overdueYears ? BAND_HEX.overdue
          : i >= DEFAULT_AGE_POLICY.replaceYears ? BAND_HEX.replace
            : i >= DEFAULT_AGE_POLICY.watchYears ? BAND_HEX.watch : BAND_HEX.ok)),
      borderRadius: 4,
    }],
  }

  const tiles = [
    { label: 'Tyres assessed', value: loaded ? fmtNum(kpis.totalAssessed) : 'N/A', icon: ShieldCheck, sub: `${fmtNum(kpis.withDate)} with a birth date` },
    { label: 'Compliance rate', value: loaded && kpis.compliancePct != null ? `${kpis.compliancePct}%` : 'N/A', icon: CheckCircle2, tone: 'accent', sub: `Under ${DEFAULT_AGE_POLICY.replaceYears} years, dated tyres` },
    { label: 'Non-compliant', value: loaded ? fmtNum(kpis.nonCompliantCount) : 'N/A', icon: ShieldAlert, tone: 'warn', sub: `${DEFAULT_AGE_POLICY.replaceYears} years or older` },
    { label: 'Overdue', value: loaded ? fmtNum(kpis.overdueCount) : 'N/A', icon: AlertTriangle, tone: 'crit', sub: `Over ${DEFAULT_AGE_POLICY.overdueYears} years, remove now` },
    { label: 'Average age', value: loaded ? fmtAge(kpis.avgAgeYears) : 'N/A', icon: Gauge, sub: 'Across dated tyres' },
    { label: 'Unknown birth date', value: loaded ? fmtNum(kpis.unknownDate) : 'N/A', icon: CalendarX, sub: kpis.unknownDatePct == null ? 'Data quality' : `${kpis.unknownDatePct}% of scope` },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Age Compliance"
        subtitle="Calendar age scan across the fleet. Old tyres are flagged regardless of tread, because rubber degrades with age in GCC heat."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 min-h-[44px] px-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={fittedOnly} onChange={(e) => setFittedOnly(e.target.checked)} />
              Fitted tyres only
            </label>
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!table.length}><FileSpreadsheet size={14} /> Excel</button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!table.length}><FileText size={14} /> PDF</button>
            <EmailPdfButton
              disabled={!table.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50"
              getPdf={async () => {
                const { exportToPdf } = await loadExportUtils()
                const name = await fileBase()
                return {
                  base64: await exportToPdf(exportRows, pdfCols, 'Tyre Age Compliance', name, 'landscape', '', { returnBase64: true }),
                  filename: `${name}.pdf`,
                  subject: 'Tyre Age Compliance',
                  bodyHtml: '<p>Attached is the Tyre Age Compliance report.</p>',
                }
              }}
            />
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load tyre records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={refreshing}><RotateCcw size={14} /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* Policy legend and band tiles (click to filter; the tiles hold out the band filter) */}
      <div className="card space-y-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]"><Info size={13} aria-hidden="true" /> Age policy and band counts. Select a band to filter the register.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" role="group" aria-label="Filter by age band">
          <button type="button" onClick={() => setBandFilter('all')} aria-pressed={bandFilter === 'all'}
            className={`text-left rounded-lg border px-3 py-2 min-h-[44px] ${bandFilter === 'all' ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)]'}`}>
            <p className="text-[11px] text-[var(--text-muted)]">All bands</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{loaded ? fmtNum(counts.total) : 'N/A'}</p>
          </button>
          {AGE_BANDS.map((b) => {
            const range = b === 'ok' ? `Under ${DEFAULT_AGE_POLICY.watchYears} yr`
              : b === 'watch' ? `${DEFAULT_AGE_POLICY.watchYears} to ${DEFAULT_AGE_POLICY.replaceYears} yr`
                : b === 'replace' ? `${DEFAULT_AGE_POLICY.replaceYears} to ${DEFAULT_AGE_POLICY.overdueYears} yr`
                  : b === 'overdue' ? `Over ${DEFAULT_AGE_POLICY.overdueYears} yr` : 'No birth date'
            return (
              <button type="button" key={b} onClick={() => setBandFilter(bandFilter === b ? 'all' : b)} aria-pressed={bandFilter === b}
                className={`text-left rounded-lg border px-3 py-2 min-h-[44px] ${bandFilter === b ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)]'}`}
                style={{ borderLeft: `4px solid ${BAND_HEX[b]}` }}>
                <p className="text-[11px] text-[var(--text-muted)]">{AGE_BAND_META[b].label} | {range}</p>
                <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{loaded ? fmtNum(counts[b]) : 'N/A'}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
      </div>
      {loaded && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          These figures cover the {fmtNum(scope.length)} tyre{scope.length === 1 ? '' : 's'} matching the site, brand, source and search filters. The band filter narrows only the register.
        </p>
      )}

      {oldest && (
        <div className="card border border-red-800/40 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="inline-flex items-center gap-2 text-red-400 font-medium"><CalendarClock size={16} aria-hidden="true" /> Oldest tyre in scope</div>
          {[['Age', fmtAge(oldest.ageYears)], ['Serial', dash(oldest.serial)], ['Asset', dash(oldest.asset_no)], ['Site', dash(oldest.site)], ['Brand', dash(oldest.brand)]].map(([l, v]) => (
            <div key={l} className="text-sm"><span className="text-[var(--text-muted)] text-xs">{l}: </span><span className="text-[var(--text-primary)] font-medium">{v}</span></div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Age band distribution</h2>
          <div className="h-64" role="img" aria-label="Tyres by age band">
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : scope.length ? <Doughnut data={donutData} options={DONUT_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No tyres in this scope.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Age profile (years)</h2>
          <div className="h-64" role="img" aria-label="Number of tyres per year of age">
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : scope.length ? <Bar data={histData} options={BAR_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No tyres in this scope.</p>}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Average age by {breakdownDim}</h2>
            <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden text-xs" role="group" aria-label="Break down by">
              {['site', 'brand'].map((d) => (
                <button type="button" key={d} onClick={() => setBreakdownDim(d)} aria-pressed={breakdownDim === d}
                  className={`px-3 min-h-[44px] capitalize ${breakdownDim === d ? 'bg-[var(--input-bg)] text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>{d}</button>
              ))}
            </div>
          </div>
          <div className="h-64" role="img" aria-label={`Average tyre age by ${breakdownDim}, top 10; orange bars hold non-compliant tyres`}>
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : breakdown.length ? <Bar data={barData} options={BAR_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated tyres to break down.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><ShieldAlert size={15} aria-hidden="true" /> Removal worklist (oldest non-compliant)</h2>
          {!loaded ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
            : worklist.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No tyre in this scope is past the replace threshold.</p>
              : (
                <ol className="divide-y divide-[var(--input-border)]">
                  {worklist.map((r, i) => (
                    <li key={r.id || i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate"><span className="font-mono text-xs text-[var(--text-primary)]">{dash(serialOf(r))}</span> <span className="text-[var(--text-muted)]">| {dash(r.asset_no)} | {dash(r.site)}</span></span>
                      <span className="flex items-center gap-2 shrink-0"><span className="tabular-nums font-semibold">{fmtAge(r.ageYears)}</span><BandBadge band={r.ageBand} /></span>
                    </li>
                  ))}
                </ol>
              )}
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><Database size={15} aria-hidden="true" /> How birth dates were established</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Issue and fitment dates are estimates: a tyre can be older than the day it was fitted. Record DOT codes to firm these up.</p>
          {!loaded ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
            : !sources.length ? <p className="text-sm text-[var(--text-muted)]">No tyres in this scope.</p>
              : (
                <ul className="space-y-2">
                  {sources.map((s, i) => {
                    const pct = scope.length ? Math.round((s.count / scope.length) * 100) : 0
                    return (
                      <li key={s.key} className="flex items-center gap-3">
                        <span className="w-44 shrink-0 text-xs text-[var(--text-secondary)]">{s.label}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.key === 'unknown' ? BAND_HEX.unknown : colorAt(i) }} /></div>
                        <span className="text-xs tabular-nums text-[var(--text-secondary)] w-20 text-right">{fmtNum(s.count)} | {pct}%</span>
                      </li>
                    )
                  })}
                </ul>
              )}
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="age-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="age-search" className={`${FIELD} pl-9`} placeholder="Serial, asset, brand, size" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="age-band" className="label">Status</label>
            <select id="age-band" className={FIELD} value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {AGE_BANDS.map((b) => <option key={b} value={b}>{AGE_BAND_META[b].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="age-site" className="label">Site</label>
            <select id="age-site" className={FIELD} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="age-brand" className="label">Brand</label>
            <select id="age-brand" className={FIELD} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">All brands</option>
              {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="age-source" className="label">Date source</label>
            <select id="age-source" className={FIELD} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">All sources</option>
              {DATE_SOURCES.map((s) => <option key={s} value={s}>{DATE_SOURCE_META[s].label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{fmtNum(table.length)} of {fmtNum(assessed.length)} tyres</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={table}
        getRowId={(r, i) => String(r.id ?? i)}
        loading={!loaded && !error}
        error={error && !loaded ? error : null}
        onRetry={load}
        emptyMessage={assessed.length === 0 ? 'No tyre records found for this scope.' : 'No tyres match these filters.'}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="tyre-age-compliance"
      />
    </div>
  )
}

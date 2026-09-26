/**
 * CostPerM3 (route /cost-per-m3) - the Cost per cubic metre dashboard.
 *
 * Grand Total = Internal (ERP expenses) + SCO cost + SANY workshop invoices,
 * split by region, divided by approved production M3 = Cost / M3. Tyre cost is
 * shown as a sub-line of Internal (the "tyre expense" view). One country + one
 * bounded period at a time (default current month) so it loads fast; money is per
 * country in its own currency (never blended); Cost/M3 is N/A when there is no
 * production denominator, and a region with too little production to read a
 * rate from says so instead of printing an alarming number.
 *
 * Data: get_cost_per_m3 RPC (V450) via src/lib/api/costPerM3.js - the headline
 * figure is the RPC's own, passed through untouched. Table shaping, KPIs,
 * exports and the site-manager review live in src/lib/costPerM3Analytics.js.
 * SCO / SANY / production data is entered on their own pages (/sco-costs,
 * /sany-invoices, /production-m3); Internal reuses parts_consumption.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RefreshCcw, FileSpreadsheet, FileText, Layers, ClipboardCheck, Copy, ArrowUpRight, AlertTriangle,
  Coins, Factory, Scale, Trophy, Ban, CalendarRange, Search, X, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import DateField from '../components/ui/DateField'
import ExplainThisNumber from '../components/trust/ExplainThisNumber'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { getCostPerM3, getCostPerM3Trend, getProductionRejections, countCostM3Rows } from '../lib/api/costPerM3'
import { CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel } from '../lib/cpkModule'
import { fmtMoney, fmtM3, fmtCostPerM3, sourceShares, MIN_M3_FOR_RATE } from '../lib/costPerM3'
import {
  buildSiteManagerReview, reviewText, regionTableRows, filterRegions, REGION_SORT_ACCESSORS,
  monthTableRows, MONTH_SORT_ACCESSORS, costPerM3Kpis, regionExportRows, REGION_EXPORT_COLS,
  regionExportHeaders, monthExportRows, MONTH_EXPORT_COLS, monthExportHeaders, studioCatalogFor,
  sortRows, TOO_LITTLE,
} from '../lib/costPerM3Analytics'
import { nextSort } from '../lib/consoleTableSort'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import PresentationStudio from '../components/present/PresentationStudio'
import StudioBoundary from '../components/present/StudioBoundary'
import { toUserMessage } from '../lib/safeError'

/**
 * Where each cost source keeps its own full table. The dashboard answers "how
 * much and what share"; these pages answer "which lines". Internal has no
 * ledger page of its own because it is the ERP expense grid on /expense-report.
 */
const SOURCE_LEDGER = {
  internal: '/expense-report',
  tyre: '/expense-report',
  sco: '/sco-costs',
  sany: '/sany-invoices',
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const BTN = `inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 min-h-[44px] text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50 ${FOCUS}`
const pctText = (v) => (v == null ? 'N/A' : `${v.toFixed(1)}%`)
const signedPct = (v) => (v == null ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)

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
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, loading, error, onRetry, maxHeight = 560 }) {
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
        loading={loading}
        error={error || null}
        onRetry={onRetry}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      {!loading && !error && <TablePagination {...pager} />}
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] p-3 min-w-0" style={{ background: 'var(--card-from, transparent)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <Icon size={15} aria-hidden="true" style={{ color: tone || 'var(--text-muted)' }} />
      </div>
      <p className="mt-1 text-lg sm:text-xl font-bold tabular-nums break-words" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub ? <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{sub}</p> : null}
    </div>
  )
}

function Line({ label, value, strong, sub }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${sub ? 'pl-8' : ''}`}>
      <span className={`${strong ? 'font-semibold' : ''} ${sub ? 'text-xs' : 'text-sm'}`} style={sub ? { color: 'var(--text-secondary)' } : undefined}>{label}</span>
      <span className={`tabular-nums text-right ${strong ? 'text-lg font-bold' : 'text-sm'}`} style={sub ? { color: 'var(--text-secondary)' } : undefined}>{value}</span>
    </div>
  )
}

/** Rate cell: the value, or a muted reason it cannot be read as a rate. */
function RateCell({ row, currency }) {
  if (row._measure === 'measurable' && row._rate != null) {
    return <span className="font-semibold tabular-nums">{fmtCostPerM3(row._rate, currency)}</span>
  }
  const text = row._measure === 'too_little' ? TOO_LITTLE : 'N/A'
  return <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{text}</span>
}

export default function CostPerM3() {
  const { activeCountry } = useSettings()
  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  // Calendar custom range (used only when periodKey === 'custom'). An incomplete
  // range falls back to the current-month bounds inside periodBounds.
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const bounds = useMemo(
    () => periodBounds(periodKey, new Date(), { from: customFrom, to: customTo }),
    [periodKey, customFrom, customTo],
  )

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [partialErrors, setPartialErrors] = useState([])
  // Date-wise monthly trend (last 12 months, independent of the period chip).
  const [trend, setTrend] = useState({ ok: false, months: [] })
  const [rejections, setRejections] = useState(null)
  const [counts, setCounts] = useState(null)
  const [reviewCopied, setReviewCopied] = useState(false)
  const [regionSearch, setRegionSearch] = useState('')
  const [regionMeasure, setRegionMeasure] = useState('all')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPartialErrors([])
    Promise.allSettled([
      getCostPerM3({ country, from: bounds.from, to: bounds.to }),
      getCostPerM3Trend({ country }),
      getProductionRejections({ country, from: bounds.from, to: bounds.to }),
      countCostM3Rows({ country, from: bounds.from, to: bounds.to }),
    ]).then(([d, t, rej, c]) => {
      if (cancelled) return
      if (d.status === 'rejected' || d.value?.ok === false) {
        setData(null)
        setError(toUserMessage(d.status === 'rejected' ? d.reason : null, 'Could not load Cost per M3.'))
      } else {
        setData(d.value)
      }
      setTrend(t.status === 'fulfilled' ? (t.value || { ok: false, months: [] }) : { ok: false, months: [] })
      setRejections(rej.status === 'fulfilled' ? rej.value : null)
      setCounts(c.status === 'fulfilled' ? c.value : null)
      setPartialErrors([
        (t.status === 'rejected' || t.value?.ok === false) && 'monthly trend',
        (rej.status === 'rejected' || rej.value?.ok === false) && 'production rejections',
        (c.status === 'rejected' || c.value == null || Object.values(c.value).some((value) => value == null)) && 'source row counts',
      ].filter(Boolean))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to, nonce])

  const load = useCallback(() => setNonce((n) => n + 1), [])

  const currency = data?.currency || country
  const total = data?.total || null
  const regions = useMemo(() => data?.regions || [], [data?.regions])
  const months = useMemo(() => trend?.months || [], [trend?.months])
  const trendOk = trend?.ok !== false
  const label = periodLabel(bounds)

  const kpi = useMemo(() => costPerM3Kpis({ total, regions, months, rejections }), [total, regions, months, rejections])
  const regionRows = useMemo(() => regionTableRows(regions, total), [regions, total])
  const regionFiltered = useMemo(() => filterRegions(regionRows, { search: regionSearch, measure: regionMeasure }), [regionRows, regionSearch, regionMeasure])
  const monthRows = useMemo(() => monthTableRows(months), [months])
  const studioCatalog = useMemo(() => studioCatalogFor(regions, months), [regions, months])

  const review = useMemo(
    () => buildSiteManagerReview({ regions, total, rejections, currency, label }),
    [regions, total, rejections, currency, label],
  )
  async function copyReview() {
    try {
      await navigator.clipboard.writeText(reviewText({ review, country, label }))
      setReviewCopied(true); setTimeout(() => setReviewCopied(false), 2000)
    } catch { /* clipboard blocked: the review stays readable on screen */ }
  }

  // Exports cover every region (not just the filtered view) so the file always
  // reconciles to the TOTAL row, and carry the same guard as the screen.
  const regionExport = useMemo(() => regionExportRows(regionRows, total), [regionRows, total])
  const monthExport = useMemo(() => monthExportRows(monthRows), [monthRows])
  const fileBase = reportFileName('Cost per M3', country, label)

  function exportExcel() {
    if (!regionExport.length) return
    exportToExcel(regionExport, REGION_EXPORT_COLS, regionExportHeaders(currency), fileBase, 'Cost per M3',
      { currency, title: `${country} Cost per M3, ${label}` })
  }
  function exportPdf() {
    if (!regionExport.length) return
    const headers = regionExportHeaders(currency)
    exportToPdf(regionExport, REGION_EXPORT_COLS.map((k, i) => ({ key: k, header: headers[i] })),
      `${country} Cost per M3, ${label}`, fileBase, 'landscape', '', { currency })
  }
  function exportTrend(kind) {
    if (!monthExport.length) return
    const headers = monthExportHeaders(currency)
    const name = reportFileName('Cost per M3 monthly', country)
    if (kind === 'excel') exportToExcel(monthExport, MONTH_EXPORT_COLS, headers, name, 'Cost per M3 by month', { currency, title: `${country} Cost per M3 by month` })
    else exportToPdf(monthExport, MONTH_EXPORT_COLS.map((k, i) => ({ key: k, header: headers[i] })), `${country} Cost per M3, monthly detail`, name, 'landscape', '', { currency })
  }

  const sourceRows = useMemo(() => {
    if (!total) return []
    const rows = sourceShares(total).map((s) => ({
      ...s,
      entries: s.key === 'sco' ? counts?.sco : s.key === 'sany' ? counts?.sany : null,
      to: SOURCE_LEDGER[s.key],
    }))
    rows.push({ key: 'grand', label: 'Grand total', value: total.grand_total, share: Number(total.grand_total) > 0 ? 100 : null, entries: null, to: null, strong: true })
    rows.push({ key: 'production', label: 'Approved production', value: total.production_m3, share: null, entries: counts?.production ?? null, to: '/production-m3', m3: true })
    return rows
  }, [total, counts])

  const sourceColumns = useMemo(() => [
    { id: 'label', header: 'Source', accessorFn: (r) => r.label,
      cell: ({ row: { original: s } }) => <span className={`${s.sub ? 'pl-4 text-xs' : ''} ${s.strong ? 'font-semibold' : ''}`} style={s.sub ? { color: 'var(--text-secondary)' } : undefined}>{s.label}</span> },
    { id: 'value', header: `Amount (${currency})`, accessorFn: (r) => r.value, meta: { align: 'right' },
      cell: ({ row: { original: s } }) => <span className={`tabular-nums ${s.strong ? 'font-semibold' : ''}`}>{s.m3 ? fmtM3(s.value) : fmtMoney(s.value, currency)}</span> },
    { id: 'share', header: 'Share of total', accessorFn: (r) => r.share, meta: { align: 'right' },
      cell: ({ row: { original: s } }) => <span className="tabular-nums">{s.m3 ? 'denominator' : pctText(s.share)}</span> },
    { id: 'entries', header: 'Ledger rows', accessorFn: (r) => r.entries, meta: { align: 'right' },
      cell: ({ row: { original: s } }) => <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{s.key === 'grand' ? '' : s.entries == null ? 'N/A' : s.entries.toLocaleString()}</span> },
    { id: 'open', header: 'Open', enableSorting: false, meta: { align: 'right', export: false },
      cell: ({ row: { original: s } }) => (s.to
        ? <Link to={s.to} className={`inline-flex items-center gap-1 min-h-[44px] text-xs underline ${FOCUS}`} style={{ color: 'var(--accent)' }} aria-label={`View the ${s.label} table`}>View table <ArrowUpRight size={12} aria-hidden="true" /></Link>
        : <span className="sr-only">No ledger</span>) },
  ], [currency])

  const regionColumns = useMemo(() => [
    { id: 'region', header: 'Region', sort: REGION_SORT_ACCESSORS.region, firstDir: 'asc', size: 150, cell: (r) => <span className="font-medium">{r.region}</span> },
    { id: 'internal', header: 'Internal', sort: REGION_SORT_ACCESSORS.internal, align: 'right', size: 120, cell: (r) => <span className="tabular-nums">{fmtMoney(r.internal_cost, currency)}</span> },
    { id: 'sco', header: 'SCO', sort: REGION_SORT_ACCESSORS.sco, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{fmtMoney(r.sco_cost, currency)}</span> },
    { id: 'sany', header: 'SANY', sort: REGION_SORT_ACCESSORS.sany, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{fmtMoney(r.sany_cost, currency)}</span> },
    { id: 'grand', header: 'Grand Total', sort: REGION_SORT_ACCESSORS.grand, align: 'right', size: 130, cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.grand_total, currency)}</span> },
    { id: 'share', header: 'Share', sort: REGION_SORT_ACCESSORS.share, align: 'right', size: 80, cell: (r) => <span className="tabular-nums">{pctText(r._share)}</span> },
    { id: 'production', header: 'Production M3', sort: REGION_SORT_ACCESSORS.production, align: 'right', size: 130, cell: (r) => <span className="tabular-nums">{Math.round(Number(r.production_m3) || 0).toLocaleString()}</span> },
    // A region can carry real cost while its production is still untagged, and
    // dividing one by the other prints a rate dozens of times the fleet figure.
    // Withheld rather than shown, because that number reads as a crisis.
    { id: 'rate', header: 'Cost/M3', sort: REGION_SORT_ACCESSORS.rate, align: 'right', size: 170, cell: (r) => <RateCell row={r} currency={currency} /> },
  ], [currency])

  const monthColumns = useMemo(() => [
    { id: 'month', header: 'Month', sort: MONTH_SORT_ACCESSORS.month, size: 100, cell: (r) => <span className="tabular-nums">{r.month}</span> },
    { id: 'internal', header: 'Internal', sort: MONTH_SORT_ACCESSORS.internal, align: 'right', size: 120, cell: (r) => <span className="tabular-nums">{fmtMoney(r.internal_cost, currency)}</span> },
    { id: 'sco', header: 'SCO', sort: MONTH_SORT_ACCESSORS.sco, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{fmtMoney(r.sco_cost, currency)}</span> },
    { id: 'sany', header: 'SANY', sort: MONTH_SORT_ACCESSORS.sany, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{fmtMoney(r.sany_cost, currency)}</span> },
    { id: 'grand', header: 'Grand Total', sort: MONTH_SORT_ACCESSORS.grand, align: 'right', size: 130, cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.grand_total, currency)}</span> },
    { id: 'mom', header: 'vs prior month', sort: MONTH_SORT_ACCESSORS.mom, align: 'right', size: 120,
      cell: (r) => <span className="tabular-nums" style={{ color: r._momGrand == null ? 'var(--text-dim)' : 'var(--text-secondary)' }}>{signedPct(r._momGrand)}</span> },
    { id: 'production', header: 'Production M3', sort: MONTH_SORT_ACCESSORS.production, align: 'right', size: 130, cell: (r) => <span className="tabular-nums">{Math.round(Number(r.production_m3) || 0).toLocaleString()}</span> },
    { id: 'rate', header: 'Cost/M3', sort: MONTH_SORT_ACCESSORS.rate, align: 'right', size: 170, cell: (r) => <RateCell row={r} currency={currency} /> },
    { id: 'bar', header: 'Relative cost', size: 130,
      cell: (r) => (
        <div className="h-2 w-24 rounded bg-[var(--border-subtle)] overflow-hidden" role="img" aria-label={`${r._pctOfPeak}% of the peak month`}>
          <div className="h-full bg-[var(--accent)]" style={{ width: `${r._pctOfPeak}%` }} />
        </div>
      ) },
  ], [currency])

  const regionFiltersActive = regionSearch || regionMeasure !== 'all'
  const periodCpm = loading || error ? 'N/A' : fmtCostPerM3(kpi.costPerM3, currency)

  return (
    <div className="p-4 md:p-6 max-w-[1300px] mx-auto space-y-6">
      <PageHeader
        title="Cost per M3"
        subtitle="Internal + SCO + SANY, divided by approved production, by region and month"
        icon={Coins}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportExcel} disabled={!regionExport.length} className={BTN}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            <button type="button" onClick={exportPdf} disabled={!regionExport.length} className={BTN}><FileText size={14} aria-hidden="true" /> PDF</button>
            <button type="button" onClick={load} disabled={loading} className={BTN}><RefreshCcw size={14} aria-hidden="true" className={loading ? 'animate-spin' : ''} /> Refresh</button>
          </div>
        }
      />

      {/* Scope: country + period */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border-subtle)] p-0.5" role="group" aria-label="Country">
          {COUNTRIES.map((c) => (
            <button key={c} type="button" onClick={() => setCountry(c)} aria-pressed={country === c}
              className={`px-3 min-h-[40px] text-sm rounded-md ${FOCUS} ${country === c ? 'bg-[var(--accent)] text-white font-semibold' : ''}`}
              style={country === c ? undefined : { color: 'var(--text-secondary)' }}>{c}</button>
          ))}
        </div>
        <label htmlFor="cpm3-period" className="sr-only">Period</label>
        <select id="cpm3-period" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className={`rounded-md border border-[var(--border-subtle)] bg-transparent px-3 min-h-[44px] text-sm ${FOCUS}`}>
          {CPK_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {periodKey === 'custom' && (
          <>
            <DateField className="text-sm w-40" value={customFrom} onChange={setCustomFrom} placeholder="From date" ariaLabel="From date" max={customTo || undefined} />
            <DateField className="text-sm w-40" value={customTo} onChange={setCustomTo} placeholder="To date" ariaLabel="To date" min={customFrom || undefined} />
          </>
        )}
        <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}><CalendarRange size={12} aria-hidden="true" /> {label}</span>
      </div>

      {partialErrors.length > 0 && !error && (
        <div role="status" className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">Partial view: {partialErrors.join(', ')} unavailable. The headline Cost/M3 is loaded, but affected supporting analysis is omitted.</span>
          <button type="button" onClick={load} className={BTN}><RefreshCcw size={13} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-busy={loading}>
        <Kpi label="Grand total" value={loading || error ? 'N/A' : fmtMoney(kpi.grandTotal, currency)} sub={label} icon={Coins} tone="var(--accent)" />
        <Kpi label="Approved production" value={loading || error ? 'N/A' : fmtM3(kpi.production)} sub={!loading && !error && kpi.rejectedM3 != null ? `${Math.round(kpi.rejectedM3).toLocaleString()} m3 rejected` : 'rejections N/A'} icon={Factory} tone="#38bdf8" />
        <Kpi label="Cost per M3" value={periodCpm}
          sub={!loading && !error && kpi.production != null && !kpi.periodMeasurable && kpi.costPerM3 != null ? `Below ${MIN_M3_FOR_RATE.toLocaleString()} m3, read with care` : 'period rate'} icon={Scale} />
        <Kpi label="Top cost region" value={!loading && !error && kpi.topRegion ? kpi.topRegion.region : 'N/A'}
          sub={!loading && !error && kpi.topRegion ? `${fmtMoney(kpi.topRegion.grand, currency)}, ${pctText(kpi.topRegion.share)} of total` : null} icon={Trophy} tone="#f5a524" />
        <Kpi label="Measurable regions" value={loading || error ? 'N/A' : `${kpi.measurableRegions} of ${kpi.regionCount}`}
          sub={!loading && !error && kpi.cheapestRegion ? `Lowest ${kpi.cheapestRegion.region} ${fmtCostPerM3(kpi.cheapestRegion.rate, currency)}` : `needs ${MIN_M3_FOR_RATE.toLocaleString()}+ m3`} icon={Ban} />
        <Kpi label="12-month Cost/M3" value={loading ? 'N/A' : !trendOk || !kpi.rolling.months ? 'N/A' : kpi.rolling.measurable ? fmtCostPerM3(kpi.rolling.rate, currency) : TOO_LITTLE}
          sub={!loading && trendOk && kpi.rolling.months ? `${kpi.rolling.months} month${kpi.rolling.months === 1 ? '' : 's'}, ${fmtM3(kpi.rolling.production)}` : 'trend unavailable'} icon={CalendarRange} />
      </div>

      {/* Headline card (matches the All-<country> summary) */}
      <section className="rounded-xl border border-[var(--border-subtle)] overflow-hidden" aria-labelledby="cpm3-headline">
        <div className="bg-[var(--accent)] text-white px-4 py-2.5 font-semibold flex items-center justify-between gap-2">
          <h2 id="cpm3-headline" className="text-sm font-semibold">All {country}</h2>
          <ExplainThisNumber metricId="cost_per_m3" country={country} label={`Cost per M3 - ${country}`} />
        </div>
        {error ? (
          <div role="alert" className="px-4 py-8 text-center text-sm text-red-400">
            <p>{error}</p>
            <button type="button" onClick={load} className={`mt-3 ${BTN}`}><RefreshCcw size={14} aria-hidden="true" /> Retry</button>
          </div>
        ) : loading ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }} role="status">Loading...</div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            <Line label={`Internal ${country}`} value={fmtMoney(total?.internal_cost, currency)} />
            <Line label="Tyre (of internal)" value={fmtMoney(total?.tyre_cost, currency)} sub />
            <Line label={`SCO ${country}`} value={fmtMoney(total?.sco_cost, currency)} />
            <Line label="SANY Invoice" value={fmtMoney(total?.sany_cost, currency)} />
            <Line label="Grand Total" value={fmtMoney(total?.grand_total, currency)} strong />
            <Line label="Production" value={fmtM3(total?.production_m3)} />
            <Line label="Cost / M3" value={fmtCostPerM3(total?.cost_per_m3, currency)} strong />
          </div>
        )}
      </section>

      {/* Cost sources at a glance */}
      {!loading && total && (
        <section className="rounded-xl border border-[var(--border-subtle)] p-4" aria-labelledby="cpm3-sources">
          <h2 id="cpm3-sources" className="mb-3 flex items-center gap-2 text-sm font-semibold"><Layers size={16} aria-hidden="true" /> Cost sources, {label}</h2>
          <EnterpriseTable
            columns={sourceColumns}
            data={sourceRows}
            getRowId={(r) => r.key}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting={false}
            enableExport={false}
            enableColumnVisibility={false}
            virtual
            maxHeight={420}
            emptyMessage="No cost sources for this period."
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Tyre is a sub-line of Internal (not added twice). Internal rows come from the ERP expense grid; SCO, SANY and Production row counts are the ledger entries in this period.
            Every source keeps its own full table: use View table to open it.
          </p>
        </section>
      )}

      {/* Region breakdown */}
      <section className="rounded-xl border border-[var(--border-subtle)] p-4" aria-labelledby="cpm3-regions">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="cpm3-regions" className="flex items-center gap-2 text-sm font-semibold mr-auto"><Layers size={16} aria-hidden="true" /> By region</h2>
          <div className="relative">
            <label htmlFor="cpm3-region-search" className="sr-only">Search regions</label>
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            <input id="cpm3-region-search" type="search" value={regionSearch} onChange={(e) => setRegionSearch(e.target.value)} placeholder="Search region"
              className={`rounded-md border border-[var(--border-subtle)] bg-transparent pl-8 pr-3 min-h-[44px] text-sm w-full sm:w-48 ${FOCUS}`} />
          </div>
          <label htmlFor="cpm3-region-measure" className="sr-only">Rate readability</label>
          <select id="cpm3-region-measure" value={regionMeasure} onChange={(e) => setRegionMeasure(e.target.value)} className={`rounded-md border border-[var(--border-subtle)] bg-transparent px-3 min-h-[44px] text-sm ${FOCUS}`}>
            <option value="all">All regions</option>
            <option value="measurable">Measurable rate</option>
            <option value="too_little">Too little production</option>
            <option value="no_production">No production</option>
          </select>
          {regionFiltersActive && <button type="button" onClick={() => { setRegionSearch(''); setRegionMeasure('all') }} className={BTN}><X size={13} aria-hidden="true" /> Clear</button>}
        </div>
        {!loading && !error && kpi.production === 0 && (
          <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            No approved production yet for this period. Cost/M3 shows N/A until production is entered on the Production page.
          </p>
        )}
        <SortedPagedTable
          columns={regionColumns}
          rows={regionFiltered}
          defaultSort={{ key: 'grand', dir: 'desc' }}
          getRowId={(r) => String(r.region)}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage={regionRows.length ? 'No regions match these filters.' : `No cost or production for ${country} in this period.`}
        />
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Region comes from Site Management (tag each site Central or Western). Untagged sites show as "Unassigned".
          A rate needs at least {MIN_M3_FOR_RATE.toLocaleString()} m3 of approved production to be read; below that it is withheld, on screen and in every export.
        </p>
      </section>

      {/* Date-wise monthly detail (last 12 months) */}
      <section className="rounded-xl border border-[var(--border-subtle)] p-4" aria-labelledby="cpm3-months">
        <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
          <h2 id="cpm3-months" className="flex items-center gap-2 text-sm font-semibold"><Layers size={16} aria-hidden="true" /> Monthly detail (last 12 months)</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => exportTrend('excel')} disabled={!monthExport.length} className={BTN}><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
            <button type="button" onClick={() => exportTrend('pdf')} disabled={!monthExport.length} className={BTN}><FileText size={13} aria-hidden="true" /> PDF</button>
          </div>
        </div>
        <SortedPagedTable
          columns={monthColumns}
          rows={monthRows}
          defaultSort={{ key: 'month', dir: 'desc' }}
          getRowId={(r) => String(r.month)}
          loading={loading}
          error={!loading && !trendOk ? 'The monthly trend could not be loaded.' : ''}
          onRetry={load}
          emptyMessage={`No monthly data for ${country}.`}
        />
      </section>

      {/* Site-manager review: follows the period chip, so pick "Last week" for the weekly note. */}
      {!loading && (review.lines.length > 0 || review.issues.length > 0) && (
        <section className="rounded-xl border border-[var(--border-subtle)] p-4" aria-labelledby="cpm3-review">
          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
            <h2 id="cpm3-review" className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck size={16} aria-hidden="true" /> Site manager review, {label}</h2>
            <button type="button" onClick={copyReview} className={BTN}>
              <Copy size={13} aria-hidden="true" /> {reviewCopied ? 'Copied' : 'Copy for email'}
            </button>
          </div>
          {review.lines.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {review.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
          <p className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Issues to action</p>
          {review.issues.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-amber-500">
              {review.issues.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-emerald-500">No issues to flag this period.</p>
          )}
        </section>
      )}

      {/* Chart Builder - present cost / production as a chart or PowerPoint */}
      {!loading && studioCatalog.length > 0 && (
        <StudioBoundary>
          <PresentationStudio
            catalog={studioCatalog}
            currency={currency}
            money={(v) => fmtMoney(v, currency)}
            scope={country}
            filePrefix="Cost per M3"
            showInsights
            note="Present cost per M3, cost source and production as a chart, with talking points, then copy, download a PNG, or export a PowerPoint deck."
          />
        </StudioBoundary>
      )}
    </div>
  )
}

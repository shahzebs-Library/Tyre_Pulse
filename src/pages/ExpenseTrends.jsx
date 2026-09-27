/**
 * ExpenseTrends (route /expense-trends) — Expense Trends & Forecast.
 *
 * Multi-year expense intelligence over every year in the system, split by
 * category (tyres / spare parts / lubricants): year-over-year comparison, a
 * stacked trend, category-share, a least-squares forecast of the next years,
 * and plain-language findings. Real data only, honest empty/error states,
 * currencies never blended (one panel per country in its own currency).
 *
 * REPORTING SCOPE (not the working context). This page reports on the set of
 * countries chosen in the ReportingScopeBar, NOT on the one operational country
 * in the top bar. That distinction is the whole point of the two controls: a
 * board-level trend legitimately spans countries, while the working context is
 * the single place you are operating in. Nothing here writes the working
 * context.
 *
 * The scope drives the QUERY, not just the display: the whole scope is fetched
 * in ONE `get_expense_period_trend_multi` call (V544), so changing the scope
 * refetches. The countries requested come from `scopeRequestCountries`, which
 * drops anything the profile may not aggregate over, so the scope can never
 * widen access - and the server re-checks each one against
 * `app_can_see_country`, which is the real boundary.
 *
 * WHY ONE CALL RATHER THAN ONE PER COUNTRY. The page used to fan out a request
 * per country from the browser. Two things were wrong with that. N countries
 * cost N round trips, and - the part that actually shows on screen - the answers
 * came back from N different moments, so a three-country trend could mix a
 * reading taken before an import with two taken after it and present them as one
 * comparison. The multi aggregate CALLS THE SAME single-country function once
 * per country inside one statement, so every country is read at one instant and
 * each block is that country's own payload verbatim, never a re-derivation.
 * Where the RPC is not deployed the per-country fan-out still runs, so an older
 * database degrades to the previous behaviour rather than to an error.
 *
 * CURRENCY: KSA=SAR, UAE=AED, Egypt=EGP and this page never adds them. Each
 * country keeps its own panel in its own currency; the scope summary shows a
 * combined spend ONLY when one currency is in scope and otherwise reads N/A with
 * the reason. Line COUNTS carry no currency and are aggregated.
 *
 * SHAREABLE URL. The scope and the period controls live in query parameters
 * (`?scope=KSA,UAE&grain=month&from=2024-03`) so this report can be sent to a
 * colleague and survives a refresh. The convention, and the reasoning behind
 * every part of it, is documented once in `src/lib/reportingScopeQuery.js` -
 * follow it on the next reporting page rather than inventing a second one.
 * Two properties matter most here:
 *   - the link is UNTRUSTED: its countries are re-checked against
 *     `allowedScopeCountries` on every read, so a link can never widen access
 *   - the URL is only ever REPLACED, never pushed, so using the filters does not
 *     bury the page the reader came from under a stack of history entries
 * The WORKING CONTEXT stays out of the URL: it belongs to the reader, not to
 * the link.
 *
 * Data: `get_expense_period_trend` RPC via `src/lib/api/expenseTrends.js`.
 * All maths live in the pure `src/lib/expenseTrends.js` +
 * `src/lib/reportingScopeQuery.js` engines.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useInRouterContext } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  TrendingUp, TrendingDown, LineChart, Calendar, FileSpreadsheet,
  FileText, RefreshCcw, AlertTriangle, Sparkles, Gauge, X, Coins, Hash, Globe, Table2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import ReportingScopeBar from '../components/shell/ReportingScopeBar'
import { useSettings } from '../contexts/SettingsContext'
import { getExpensePeriodTrend, getExpensePeriodTrendMulti } from '../lib/api/expenseTrends'
import {
  byCountry, buildCountryTrend, CATEGORIES, CATEGORY_LABEL,
  filterPeriods, availableYears, MONTHS, GRAINS,
} from '../lib/expenseTrends'
import {
  fmtMoney, fmtPct, grainLabels, tyreSharePct, periodTableRows,
  countrySummaryRows, scopeEntries as buildScopeEntries, expenseExportRows, EXPORT_COLUMNS,
} from '../lib/expenseTrendsAnalytics'
import { scopeLabel } from '../lib/reportingScope'
import {
  scopeRequestCountries, scopeQueryKey, rowsInScope,
  scopeMoneyTotal, moneyTotalNote, scopeCount,
  scopeFromParam, readReportUrl, reportUrlParams, applyReportUrlParams,
} from '../lib/reportingScopeQuery'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Filler, Tooltip, Legend)

// Category + forecast colours follow the super-admin report palette, so the
// charts retheme with every other report. Resolved at render time.
const catTone = (k) => colorAt(CATEGORIES.indexOf(k))
const forecastTone = () => colorAt(4)
const INSIGHT_TONE = { good: 'var(--color-success, #16a34a)', warning: 'var(--color-warning, #d97706)' }
const INSIGHT_LABEL = { good: 'Improving', warning: 'Watch', accent: 'Forecast', info: 'Note' }

const AXIS = 'var(--text-muted)'
const LEGEND = 'var(--text-secondary)'

function Stat({ icon: Icon, label, value, sub, tone = 'var(--text-primary)' }) {
  return (
    // Card sets padding inline, so `pad="tight"` (--space-4) is the lever, and
    // the row direction must go in `style` (Tailwind's .flex-col wins otherwise).
    <Card pad="tight" className="items-start gap-3" style={{ flexDirection: 'row' }}>
      <div className="rounded-lg p-2 bg-[var(--surface-2)] border border-[var(--border-dim)]" aria-hidden="true">
        <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
        <div className="text-lg font-semibold tabular-nums" style={{ color: tone }}>{value}</div>
        {sub && <div className="text-xs text-[var(--text-dim)] mt-0.5">{sub}</div>}
      </div>
    </Card>
  )
}

function CountryTrend({ entry, grain }) {
  const t = useMemo(() => buildCountryTrend(entry, grain), [entry, grain])
  const cur = t.currency
  const { per, change, short } = grainLabels(grain)
  const histLabels = t.years.map((y) => y.label)
  const fcLabels = t.forecast.map((y) => y.label)
  const allLabels = [...histLabels, ...fcLabels]
  const last = t.years[t.years.length - 1]
  const fc1 = t.forecast[0]
  const share = tyreSharePct(last)
  const tableRows = useMemo(() => periodTableRows(t), [t])

  // Stacked bars per category across history; forecast total as a trailing dashed line.
  const stacked = {
    labels: allLabels,
    datasets: [
      ...CATEGORIES.map((k) => ({
        label: CATEGORY_LABEL[k], stack: 'spend',
        data: [...t.years.map((y) => y[k]), ...fcLabels.map(() => null)],
        backgroundColor: withAlpha(catTone(k), 0.85), borderWidth: 0,
      })),
      {
        label: 'Forecast (total)', type: 'line', stack: undefined,
        data: [...histLabels.map(() => null), ...t.forecast.map((y) => y.total)],
        borderColor: forecastTone(), borderDash: [6, 4], pointRadius: 3, borderWidth: 2, fill: false,
      },
    ],
  }
  const lineData = {
    labels: allLabels,
    datasets: CATEGORIES.map((k) => ({
      label: CATEGORY_LABEL[k],
      data: [...t.years.map((y) => y[k]), ...t.forecast.map((y) => y[k])],
      borderColor: catTone(k), backgroundColor: withAlpha(catTone(k), 0.15),
      pointRadius: 2, borderWidth: 2, tension: 0.25,
      segment: { borderDash: (ctx) => (ctx.p1DataIndex >= histLabels.length ? [6, 4] : undefined) },
    })),
  }
  const shareData = {
    labels: t.share.map((s) => CATEGORY_LABEL[s.category]),
    datasets: [{ data: t.share.map((s) => s.value), backgroundColor: t.share.map((s) => catTone(s.category)), borderWidth: 0 }],
  }
  const moneyAxis = { ticks: { color: AXIS, callback: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v) }, grid: { color: 'var(--panel-2)' } }
  const catAxis = { stacked: true, ticks: { color: AXIS }, grid: { color: 'var(--panel-2)' } }
  const legend = { labels: { color: LEGEND } }

  const columns = useMemo(() => [
    { id: 'order', header: 'Seq', accessorFn: (r) => r.order, size: 60, meta: { align: 'right', export: false } },
    { id: 'label', header: per, accessorFn: (r) => r.label, size: 130,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.label}</span> },
    { id: 'kind', header: 'Type', accessorFn: (r) => r.kind, size: 110, meta: { filterVariant: 'select', filterOptions: ['Actual', 'Forecast'] },
      cell: ({ row }) => (
        <span className={row.original.kind === 'Forecast'
          ? 'text-[11px] px-2 py-0.5 rounded-full border border-dashed border-[var(--border-bright)] text-[var(--text-secondary)]'
          : 'text-[11px] px-2 py-0.5 rounded-full border border-[var(--border-dim)] text-[var(--text-muted)]'}>
          {row.original.kind === 'Forecast' ? 'Forecast (estimate)' : 'Actual'}
        </span>
      ) },
    ...CATEGORIES.map((k) => ({
      id: k, header: CATEGORY_LABEL[k], accessorFn: (r) => r[k], size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(row.original[k], '')}</span>,
    })),
    { id: 'total', header: `Total${cur ? ` (${cur})` : ''}`, accessorFn: (r) => r.total, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{fmtMoney(row.original.total, '')}</span> },
    { id: 'tyreShare', header: 'Tyre share', accessorFn: (r) => r.tyreShare, size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.tyreShare == null ? 'N/A' : `${row.original.tyreShare}%`}</span> },
    { id: 'change', header: change, accessorFn: (r) => r.change, size: 100, meta: { align: 'right' },
      cell: ({ row }) => {
        const v = row.original.change
        if (v == null) return <span className="text-[var(--text-dim)]">N/A</span>
        // Direction carried by the arrow AND the sign, never by colour alone.
        return (
          <span className="tabular-nums inline-flex items-center gap-1 text-[var(--text-secondary)]">
            {v > 0 ? <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> : <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />}
            {fmtPct(v)}
          </span>
        )
      } },
  ], [per, change, cur])

  return (
    <section className="space-y-4" aria-labelledby={`et-${String(t.country).replace(/\W+/g, '-')}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`et-${String(t.country).replace(/\W+/g, '-')}`} className="text-base font-semibold text-[var(--text-primary)]">{t.country}</h3>
        <span className="text-xs text-[var(--text-muted)]">{cur || 'Currency not recorded'} | {t.years.length} periods</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Calendar} label={`Latest ${per.toLowerCase()} (${last?.label ?? 'N/A'})`} value={fmtMoney(last?.total, cur)} />
        <Stat icon={t.cagr != null && t.cagr >= 0 ? TrendingUp : TrendingDown} label={`Avg growth / ${short} (CAGR)`}
          value={fmtPct(t.cagr)} sub={t.cagr == null ? 'Needs two measured periods' : t.cagr > 0 ? 'Spend rising' : 'Spend falling'} />
        <Stat icon={Sparkles} label={`Forecast ${fc1?.label ?? ''}`} value={fmtMoney(fc1?.total, cur)} sub="Least-squares estimate" />
        <Stat icon={Gauge} label={`Tyre share (${last?.label ?? 'N/A'})`} value={share == null ? 'N/A' : `${share}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Titles stay hand-rolled (CardHeader truncates, which would clip
            "(with forecast)" at phone width). The chart well keeps a definite
            height, which chart.js needs under maintainAspectRatio:false. */}
        <Card pad="tight" className="lg:col-span-2">
          <div className="text-sm font-medium text-[var(--text-secondary)] mb-3">Spend by {per.toLowerCase()} and category (with forecast)</div>
          <div className="h-64" role="img" aria-label={`${t.country} spend by ${per.toLowerCase()} and category, with forecast`}>
            <Bar data={stacked} options={{
              maintainAspectRatio: false,
              plugins: { legend },
              scales: { x: catAxis, y: { ...moneyAxis, stacked: true } },
            }} />
          </div>
        </Card>
        <Card pad="tight">
          <div className="text-sm font-medium text-[var(--text-secondary)] mb-3">Category share ({last?.label ?? 'N/A'})</div>
          <div className="h-64" role="img" aria-label={`${t.country} category share for ${last?.label ?? 'the latest period'}`}>
            <Doughnut data={shareData} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: LEGEND } } } }} />
          </div>
        </Card>
      </div>

      <Card pad="tight">
        <div className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2"><LineChart className="w-4 h-4" aria-hidden="true" /> Category trend and forecast</div>
        <div className="h-64" role="img" aria-label={`${t.country} category trend with dashed forecast`}>
          <Line data={lineData} options={{
            maintainAspectRatio: false,
            plugins: { legend },
            scales: { x: { ticks: { color: AXIS }, grid: { color: 'var(--panel-2)' } }, y: moneyAxis },
          }} />
        </div>
      </Card>

      {/* Period table. Default order is the timeline (Seq): actuals then the
          forecast. Every row states its Type in text, so sorting by any column
          can never make a projection read as a measured period. */}
      <Card pad="tight">
        <div className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Table2 className="w-4 h-4" aria-hidden="true" /> {per}-by-{per.toLowerCase()} detail ({cur || 'currency not recorded'})
        </div>
        <EnterpriseTable
          columns={columns}
          data={tableRows}
          getRowId={(r) => r.id}
          initialPageSize={25}
          searchPlaceholder={`Search ${per.toLowerCase()}s`}
          emptyMessage="No periods in the selected window."
          exportFileName={`Expense Trends ${t.country}`}
          reportMeta={{ title: `Expense Trends ${t.country}`, currency: cur }}
        />
      </Card>

      {t.insights.length > 0 && (
        <Card pad="tight" className="space-y-1.5">
          <div className="text-sm font-medium text-[var(--text-secondary)]">Findings</div>
          <ul className="space-y-1.5">
            {t.insights.map((ins, i) => (
              <li key={i} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--border-dim)] shrink-0"
                  style={{ color: INSIGHT_TONE[ins.tone] || 'var(--text-muted)' }}>
                  {INSIGHT_LABEL[ins.tone] || 'Note'}
                </span>
                {ins.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}

const GRAIN_OPTS = [['year', 'Year'], ['quarter', 'Quarter'], ['month', 'Month']]
const DEFAULT_GRAIN = 'year'

/**
 * Mirrors the report's state into the address bar so the page can be linked and
 * survives a refresh.
 *
 * REPLACE, NEVER PUSH. Every scope tick and every date select would otherwise
 * become a history entry, and a reader pressing Back once would step through
 * their own filter changes instead of leaving the report. `{ replace: true }` is
 * the same rule `useFilterState` follows for filter params.
 *
 * It is a child, and it is rendered only inside a Router, because
 * `useSearchParams` throws outside one - that keeps the page itself mountable
 * without a router (which is how it is unit tested).
 *
 * `params` of null means "not ready yet": the URL is left exactly as the reader
 * opened it until the incoming link has been read, so a shared scope is never
 * overwritten by the stored one before it has been applied.
 */
function ReportUrlSync({ params }) {
  const [search, setSearch] = useSearchParams()
  useEffect(() => {
    if (!params) return
    const next = applyReportUrlParams(search, params)
    // No write when nothing moved - otherwise every render would touch history.
    if (next.toString() === search.toString()) return
    setSearch(next, { replace: true })
  }, [params, search, setSearch])
  return null
}

export default function ExpenseTrends() {
  // REPORTING SCOPE, not the working context: this report aggregates the set of
  // countries the reader picked. `activeCountry` is deliberately NOT read here.
  const { reportingScope, setReportingScope, allowedScopeCountries } = useSettings()
  const inRouter = useInRouterContext()

  // The address bar as this page was OPENED. Read once, synchronously, straight
  // off window.location (the same string BrowserRouter parses) rather than
  // through a hook: the first fetch has to be the one the link asked for, and a
  // hook value that arrives an effect later would fire a request for the stored
  // scope first. Reading it once also means later replacements by ReportUrlSync
  // cannot feed back in here.
  const initialUrl = useMemo(
    () => readReportUrl(
      typeof window === 'undefined' ? '' : window.location.search,
      { grains: GRAINS, defaultGrain: DEFAULT_GRAIN },
    ),
    [],
  )

  const [grain, setGrain] = useState(initialUrl.grain)
  const [fromYear, setFromYear] = useState(initialUrl.from.year)
  const [fromMonth, setFromMonth] = useState(initialUrl.from.month)
  const [toYear, setToYear] = useState(initialUrl.to.year)
  const [toMonth, setToMonth] = useState(initialUrl.to.month)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // False until the incoming link has been read and applied to the shared scope.
  const [linkApplied, setLinkApplied] = useState(false)

  // The link's scope, RE-CHECKED against what this profile may aggregate over.
  // A link is untrusted input: countries the reader may not see are dropped
  // here, so the URL can never widen access however it was edited or forwarded.
  // `scope` is null when the link says nothing usable, and the stored scope
  // stands - an unreadable link must still land on a valid report.
  const linkedScope = useMemo(
    () => scopeFromParam(initialUrl.scopeRaw, allowedScopeCountries),
    [initialUrl.scopeRaw, allowedScopeCountries],
  )

  // Until the link has been written into the shared scope, the LINK is the
  // scope. That keeps the very first request the right one instead of fetching
  // the stored scope and then correcting it a render later.
  const effectiveScope = (!linkApplied && linkedScope.scope) ? linkedScope.scope : reportingScope

  // Adopt the link into the shared reporting scope, once, as soon as the profile
  // has resolved (allowed is empty on the first paint, and resolving against an
  // empty allow-list would drop every country in the link). After this the
  // in-page control and the URL describe the same report.
  useEffect(() => {
    if (linkApplied) return
    if (!Array.isArray(allowedScopeCountries) || allowedScopeCountries.length === 0) return
    if (linkedScope.scope
      && scopeQueryKey(linkedScope.countries)
        !== scopeQueryKey(scopeRequestCountries(reportingScope, allowedScopeCountries))) {
      setReportingScope?.(linkedScope.scope)
    }
    setLinkApplied(true)
  }, [linkApplied, linkedScope, reportingScope, allowedScopeCountries, setReportingScope])

  // Every country we will request. Permission-filtered, so a persisted, linked
  // or stale scope can never ask for a country this profile may not aggregate
  // over. Resolved through a stable string key so the list identity changes only
  // when the SET changes - an equal-but-new array must not retrigger the fetch.
  const scopeKey = useMemo(
    () => scopeQueryKey(scopeRequestCountries(effectiveScope, allowedScopeCountries)),
    [effectiveScope, allowedScopeCountries],
  )
  const scopeCountryList = useMemo(() => (scopeKey ? scopeKey.split('|') : []), [scopeKey])
  const scopeTitle = scopeLabel(effectiveScope, allowedScopeCountries)

  // What the address bar should say for the report now on screen. Null while the
  // profile or the incoming link is still being resolved, so the URL the reader
  // arrived on is never overwritten before it has been read.
  const urlParams = useMemo(() => {
    if (!linkApplied) return null
    return reportUrlParams({
      scope: effectiveScope,
      allowed: allowedScopeCountries,
      grain,
      defaultGrain: DEFAULT_GRAIN,
      from: { year: fromYear, month: fromMonth },
      to: { year: toYear, month: toMonth },
    })
  }, [linkApplied, effectiveScope, allowedScopeCountries, grain,
      fromYear, fromMonth, toYear, toMonth])

  // Switching the grain (year/quarter/month) refetches the scope without waiting
  // for the previous read. If the earlier one finishes last the trend is
  // bucketed by the OLD grain under the new toggle, so the periods on the axis
  // do not mean what the control says they mean. The guard still matters with a
  // single request per load: two loads can still be in flight at once.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true); setError('')
    try {
      // A scope that resolves to nothing reports on nothing. Falling back to
      // "All" here would silently widen the report past what was asked for.
      if (scopeCountryList.length === 0) { if (!stale()) setRows([]); return }
      // ONE round trip for the whole scope. The multi aggregate names the
      // countries explicitly, so the request stays as narrow as the report
      // rather than fetching everything and hiding the rest client-side, and
      // every country is read at the same instant.
      const multi = await getExpensePeriodTrendMulti({ countries: scopeCountryList, grain })
      if (stale()) return
      if (multi.ok) { setRows(multi.rows); return }
      // The aggregate is not deployed on this database (or could not answer).
      // Fall back to the per-country fan-out rather than showing an error: this
      // service layer degrades, and the rows are identical either way - the
      // multi function calls this very function once per country.
      const batches = await Promise.all(
        scopeCountryList.map((country) => getExpensePeriodTrend({ country, grain })),
      )
      if (stale()) return
      setRows(batches.flat())
    } catch (err) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (stale()) return
      setError(toUserMessage(err))
      setRows([])
    } finally {
      // Clearing this from a stale load would make the newer one look finished.
      if (!stale()) setLoading(false)
    }
  }, [scopeCountryList, grain, latestLoad])

  useEffect(() => { load() }, [load])

  const allCountries = useMemo(
    () => byCountry(rowsInScope(rows, scopeCountryList)),
    [rows, scopeCountryList],
  )
  const yearOpts = useMemo(() => availableYears(allCountries), [allCountries])
  const fromYm = fromYear ? `${fromYear}-${fromMonth || '01'}` : null
  const toYm = toYear ? `${toYear}-${toMonth || '12'}` : null

  // Apply the date-range window to the displayed periods (client-side).
  const countries = useMemo(
    () => allCountries
      .map((c) => ({ ...c, years: filterPeriods(c.years, fromYm, toYm) }))
      .filter((c) => c.years.length),
    [allCountries, fromYm, toYm],
  )
  const rangeActive = !!(fromYm || toYm)
  function clearRange() { setFromYear(''); setFromMonth(''); setToYear(''); setToMonth('') }

  // ── Scope summary. Built from the SAME windowed `countries` the panels render,
  // so the header can never describe a different set of periods than the charts.
  const scopeEntries = useMemo(() => buildScopeEntries(countries), [countries])
  // Money: withheld as N/A the moment more than one currency is in scope.
  const scopeMoney = useMemo(() => scopeMoneyTotal(scopeEntries), [scopeEntries])
  const scopeMoneyNote = moneyTotalNote(scopeMoney)
  // Counts carry no currency, so aggregating them across countries is honest.
  const scopeLines = useMemo(() => scopeCount(scopeEntries, 'lines'), [scopeEntries])
  const summaryRows = useMemo(() => countrySummaryRows(countries, grain), [countries, grain])
  const periodsCovered = useMemo(() => {
    const set = new Set()
    for (const c of countries) for (const y of c.years) set.add(y.period)
    return set.size
  }, [countries])
  const { per } = grainLabels(grain)

  const [exportError, setExportError] = useState('')
  async function runExport(kind) {
    setExportError('')
    try {
      const rows = expenseExportRows(countries, grain)
      const keys = EXPORT_COLUMNS.map(([k]) => k)
      const heads = EXPORT_COLUMNS.map(([, h]) => h)
      if (kind === 'excel') await exportToExcel(rows, keys, heads, `Expense Trends ${scopeTitle}`)
      else await exportToPdf(rows, keys.map((k, i) => ({ key: k, header: heads[i] })), `Expense Trends and Forecast (${scopeTitle})`, `Expense Trends ${scopeTitle}`, 'landscape')
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const summaryColumns = useMemo(() => [
    { id: 'country', header: 'Country', accessorFn: (r) => r.country, size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.country}</span> },
    { id: 'currency', header: 'Currency', accessorFn: (r) => r.currency || 'N/A', size: 90 },
    { id: 'periods', header: 'Periods', accessorFn: (r) => r.periods, size: 90, meta: { align: 'right' } },
    { id: 'total', header: 'Spend in window', accessorFn: (r) => r.total, size: 150, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums font-semibold">{fmtMoney(row.original.total, row.original.currency)}</span> },
    ...CATEGORIES.map((k) => ({
      id: k, header: CATEGORY_LABEL[k], accessorFn: (r) => r[k], size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMoney(row.original[k], row.original.currency)}</span>,
    })),
    { id: 'lines', header: 'Lines', accessorFn: (r) => r.lines, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.lines == null ? 'N/A' : Math.round(row.original.lines).toLocaleString()}</span> },
    { id: 'tyreShare', header: 'Tyre share (latest)', accessorFn: (r) => r.tyreShare, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.tyreShare == null ? 'N/A' : `${row.original.tyreShare}%`}</span> },
    { id: 'cagr', header: 'Avg growth', accessorFn: (r) => r.cagr, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPct(row.original.cagr)}</span> },
    { id: 'nextForecast', header: 'Next forecast', accessorFn: (r) => r.nextForecast, size: 150, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {fmtMoney(row.original.nextForecast, row.original.currency)}
          {row.original.nextForecastLabel ? <span className="text-[var(--text-dim)]"> ({row.original.nextForecastLabel})</span> : null}
        </span>
      ) },
  ], [])

  const btn = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] disabled:opacity-50 disabled:cursor-not-allowed'
  const selectCls = 'input text-sm min-h-[44px]'

  return (
    <div className="space-y-5">
      {/* Keeps the address bar describing this report, by REPLACE only. Rendered
          only inside a Router; the page works without one. */}
      {inRouter && <ReportUrlSync params={urlParams} />}
      <PageHeader
        title="Expense Trends & Forecast"
        subtitle="Spend by year, quarter or month, split by tyres, spare parts and lubricants, with period-on-period comparison and a forward forecast."
        icon={TrendingUp}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <div role="group" aria-label="Period grain" className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
              {GRAIN_OPTS.map(([g, label]) => (
                <button key={g} type="button" onClick={() => setGrain(g)} aria-pressed={grain === g}
                  className={`min-h-[40px] px-3 text-xs rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] ${grain === g ? 'bg-emerald-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={load} className={btn} aria-label="Refresh expense trends" title="Refresh">
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => runExport('excel')} disabled={!countries.length} className={btn}>
              <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} disabled={!countries.length} className={btn}>
              <FileText className="w-4 h-4" aria-hidden="true" /> PDF
            </button>
          </div>
        }
      />

      {/* Reporting scope: which countries this report aggregates. Separate from
          the working context in the top bar, and it drives the queries below.
          No `clip`: this card holds the scope menu. */}
      <Card pad="tight" className="flex-wrap items-start justify-between gap-4" style={{ flexDirection: 'row' }}>
        <ReportingScopeBar />
        {scopeEntries.length > 0 && (
          <div className="flex flex-wrap items-start gap-4 text-xs">
            <div className="min-w-0" role="group" aria-label="Combined spend">
              <div className="text-[var(--text-muted)] flex items-center gap-1"><Coins className="w-3.5 h-3.5" aria-hidden="true" /> Combined spend</div>
              <div className={`font-semibold ${scopeMoney.total == null ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                {scopeMoney.total == null ? 'N/A' : fmtMoney(scopeMoney.total, scopeMoney.currency)}
              </div>
            </div>
            <div className="min-w-0" role="group" aria-label="Expense lines">
              <div className="text-[var(--text-muted)] flex items-center gap-1"><Hash className="w-3.5 h-3.5" aria-hidden="true" /> Expense lines</div>
              <div className="font-semibold text-[var(--text-primary)]">
                {scopeLines == null ? 'N/A' : Math.round(scopeLines).toLocaleString()}
              </div>
            </div>
            <div className="min-w-0 max-w-md" role="group" aria-label="Spend per country">
              <div className="text-[var(--text-muted)]">Per country</div>
              <div className="font-medium text-[var(--text-secondary)] break-words">
                {scopeEntries.map((e) => `${e.country}: ${fmtMoney(e.total, e.currency)}`).join('  |  ')}
              </div>
            </div>
          </div>
        )}
        {scopeMoneyNote && (
          <p className="w-full text-[11px] text-[var(--text-muted)]">{scopeMoneyNote}</p>
        )}
      </Card>

      {/* Date-range window (feeds the trend + forecast) */}
      <Card pad="tight" className="flex-wrap items-end gap-3" style={{ flexDirection: 'row' }}>
        <span className="text-xs uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-1 self-center"><Calendar className="w-3.5 h-3.5" aria-hidden="true" /> Date range</span>
        <fieldset className="flex flex-wrap items-end gap-1.5">
          <legend className="text-xs text-[var(--text-muted)] mb-1">From</legend>
          <label className="sr-only" htmlFor="et-from-month">From month</label>
          <select id="et-from-month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className={selectCls}>
            <option value="">Any month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <label className="sr-only" htmlFor="et-from-year">From year</label>
          <select id="et-from-year" value={fromYear} onChange={(e) => setFromYear(e.target.value)} className={selectCls}>
            <option value="">Any year</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </fieldset>
        <fieldset className="flex flex-wrap items-end gap-1.5">
          <legend className="text-xs text-[var(--text-muted)] mb-1">To</legend>
          <label className="sr-only" htmlFor="et-to-month">To month</label>
          <select id="et-to-month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className={selectCls}>
            <option value="">Any month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <label className="sr-only" htmlFor="et-to-year">To year</label>
          <select id="et-to-year" value={toYear} onChange={(e) => setToYear(e.target.value)} className={selectCls}>
            <option value="">Any year</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </fieldset>
        {rangeActive && <button type="button" onClick={clearRange} className={btn}><X className="w-3.5 h-3.5" aria-hidden="true" /> Clear dates</button>}
        <span className="text-xs text-[var(--text-muted)] sm:ml-auto self-center">{rangeActive ? 'Forecast is projected from the selected window.' : 'All periods'}</span>
      </Card>

      {exportError && (
        <Card pad="tight" tone="crit" role="alert" className="items-center gap-2" style={{ flexDirection: 'row' }}>
          <AlertTriangle className="w-4 h-4 text-red-400" aria-hidden="true" />
          <span className="text-sm text-[var(--text-primary)]">{exportError}</span>
        </Card>
      )}

      {error && (
        <Card pad="tight" tone="crit" role="alert" className="flex-wrap items-center justify-between gap-2" style={{ flexDirection: 'row' }}>
          <div className="flex items-center gap-2 text-[var(--text-primary)]"><AlertTriangle className="w-4 h-4 text-red-400" aria-hidden="true" /> {error}</div>
          <button type="button" onClick={load} className={btn}>Retry</button>
        </Card>
      )}

      {loading ? (
        <Card className="text-center text-[var(--text-muted)]" style={{ padding: 'var(--space-10)' }} aria-busy="true">Loading expense history...</Card>
      ) : scopeCountryList.length === 0 ? (
        <Card className="text-center text-[var(--text-muted)]" style={{ padding: 'var(--space-10)' }}>
          No countries are selected in the reporting scope, so there is nothing to report on.
        </Card>
      ) : error ? (
        <Card className="text-center text-[var(--text-muted)]" style={{ padding: 'var(--space-10)' }}>
          Expense history could not be read, so no figures are shown. Use Retry above.
        </Card>
      ) : countries.length === 0 ? (
        <Card className="text-center text-[var(--text-muted)]" style={{ padding: 'var(--space-10)' }}>
          No expense history for {scopeTitle}{rangeActive ? ' in the selected date range' : ''} yet.
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Scope KPI strip: counts aggregate, money never crosses currencies. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={Globe} label="Countries reported" value={countries.length.toLocaleString()} sub={scopeTitle} />
            <Stat icon={Calendar} label={`${per}s covered`} value={periodsCovered.toLocaleString()} sub={rangeActive ? 'Within the selected window' : 'All recorded periods'} />
            <Stat icon={Coins} label="Combined spend" value={scopeMoney.total == null ? 'N/A' : fmtMoney(scopeMoney.total, scopeMoney.currency)}
              sub={scopeMoney.total == null ? 'Currencies are never added together' : 'Single currency in scope'} />
            <Stat icon={Hash} label="Expense lines" value={scopeLines == null ? 'N/A' : Math.round(scopeLines).toLocaleString()} sub="Counted across every country" />
          </div>

          <Card pad="tight">
            <div className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
              <Table2 className="w-4 h-4" aria-hidden="true" /> Country summary (each in its own currency)
            </div>
            <EnterpriseTable
              columns={summaryColumns}
              data={summaryRows}
              getRowId={(r) => r.id}
              initialPageSize={25}
              searchPlaceholder="Search countries"
              emptyMessage="No countries in scope."
              exportFileName="Expense Trends Country Summary"
              reportMeta={{ title: `Expense Trends Country Summary (${scopeTitle})` }}
            />
          </Card>

          {countries.map((c) => (
            <CountryTrend key={c.country} entry={c} grain={grain} />
          ))}
        </div>
      )}
    </div>
  )
}

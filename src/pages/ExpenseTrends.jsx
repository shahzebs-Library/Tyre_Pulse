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
 * The scope drives the QUERY, not just the display: one `get_expense_period_trend`
 * call is issued per country in scope, so changing the scope refetches. The
 * countries requested come from `scopeRequestCountries`, which drops anything the
 * profile may not aggregate over, so the scope can never widen access.
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
  TrendingUp, TrendingDown, LineChart, Layers, Calendar, FileSpreadsheet,
  FileText, RefreshCcw, AlertTriangle, Sparkles, Gauge, X, Coins, Hash,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import ReportingScopeBar from '../components/shell/ReportingScopeBar'
import { useSettings } from '../contexts/SettingsContext'
import { getExpensePeriodTrend } from '../lib/api/expenseTrends'
import {
  byCountry, buildCountryTrend, CATEGORIES, CATEGORY_LABEL, num,
  filterPeriods, availableYears, MONTHS, GRAINS,
} from '../lib/expenseTrends'
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

const CAT_TONE = { tyre: '#3b82f6', spare: '#f59e0b', lubricant: '#10b981' }

function fmtMoney(v, cur) {
  if (num(v) == null) return 'N/A'
  return `${cur ? cur + ' ' : ''}${Math.round(Number(v)).toLocaleString()}`
}
function fmtPct(v) {
  if (num(v) == null) return 'N/A'
  const n = Math.round(Number(v) * 10) / 10
  return `${n > 0 ? '+' : ''}${n}%`
}

function Stat({ icon: Icon, label, value, sub, tone = 'text-slate-100' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className="rounded-lg bg-white/5 p-2"><Icon className="w-5 h-5 text-emerald-400" /></div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        <div className={`text-lg font-semibold ${tone}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function CountryTrend({ entry, grain }) {
  const t = useMemo(() => buildCountryTrend(entry, grain), [entry, grain])
  const cur = t.currency
  const histLabels = t.years.map((y) => y.label)
  const fcLabels = t.forecast.map((y) => y.label)
  const allLabels = [...histLabels, ...fcLabels]
  const perLabel = grain === 'month' ? 'Month' : grain === 'quarter' ? 'Quarter' : 'Year'
  const yoyLabel = grain === 'month' ? 'MoM' : grain === 'quarter' ? 'QoQ' : 'YoY'
  const last = t.years[t.years.length - 1]
  const fc1 = t.forecast[0]

  // Stacked bars per category across history; forecast total shown as a trailing outline series.
  const stacked = {
    labels: allLabels,
    datasets: [
      ...CATEGORIES.map((k) => ({
        label: CATEGORY_LABEL[k], stack: 'spend',
        data: [...t.years.map((y) => y[k]), ...fcLabels.map(() => null)],
        backgroundColor: withAlpha(CAT_TONE[k], 0.85), borderWidth: 0,
      })),
      {
        label: 'Forecast (total)', type: 'line', stack: undefined,
        data: [...histLabels.map(() => null), ...t.forecast.map((y) => y.total)],
        borderColor: '#e879f9', borderDash: [6, 4], pointRadius: 3, borderWidth: 2, fill: false,
      },
    ],
  }
  // Category trend lines with dashed forecast continuation.
  const lineData = {
    labels: allLabels,
    datasets: CATEGORIES.map((k, i) => ({
      label: CATEGORY_LABEL[k],
      data: [...t.years.map((y) => y[k]), ...t.forecast.map((y) => y[k])],
      borderColor: CAT_TONE[k], backgroundColor: withAlpha(CAT_TONE[k], 0.15),
      pointRadius: 2, borderWidth: 2, tension: 0.25,
      segment: { borderDash: (ctx) => (ctx.p1DataIndex >= histLabels.length ? [6, 4] : undefined) },
    })),
  }
  const shareData = {
    labels: t.share.map((s) => CATEGORY_LABEL[s.category]),
    datasets: [{ data: t.share.map((s) => s.value), backgroundColor: t.share.map((s) => CAT_TONE[s.category]), borderWidth: 0 }],
  }
  const moneyAxis = { ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v) }, grid: { color: 'var(--panel-2)' } }
  const catAxis = { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-slate-100">{t.country}</h3>
        <span className="text-xs text-slate-500">{cur || 'Currency not recorded'} | {t.years.length} periods</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Calendar} label={`Latest ${perLabel.toLowerCase()} (${last?.label ?? '-'})`} value={fmtMoney(last?.total, cur)} />
        <Stat icon={t.cagr != null && t.cagr >= 0 ? TrendingUp : TrendingDown} label={`Avg growth / ${grain === "month" ? "mo" : grain === "quarter" ? "qtr" : "yr"} (CAGR)`}
          value={fmtPct(t.cagr)} tone={t.cagr != null && t.cagr > 0 ? 'text-amber-300' : 'text-emerald-300'} />
        <Stat icon={Sparkles} label={`Forecast ${fc1?.label ?? ''}`} value={fmtMoney(fc1?.total, cur)} sub="least-squares estimate" tone="text-fuchsia-300" />
        <Stat icon={Gauge} label={`Tyre share (${last?.label ?? '-'})`}
          value={last?.total ? `${Math.round((last.tyre / last.total) * 100)}%` : 'N/A'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2">
          <div className="text-sm font-medium text-slate-200 mb-3">Spend by {perLabel.toLowerCase()} &amp; category (with forecast)</div>
          <div className="h-64">
            <Bar data={stacked} options={{
              maintainAspectRatio: false,
              plugins: { legend: { labels: { color: '#cbd5e1' } } },
              scales: { x: catAxis, y: { ...moneyAxis, stacked: true } },
            }} />
          </div>
        </div>
        <div className="card p-4">
          <div className="text-sm font-medium text-slate-200 mb-3">Category share ({last?.label ?? '-'})</div>
          <div className="h-64"><Doughnut data={shareData} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1' } } } }} /></div>
        </div>
      </div>

      <div className="card p-4">
        <div className="text-sm font-medium text-slate-200 mb-3 flex items-center gap-2"><LineChart className="w-4 h-4" /> Category trend &amp; forecast</div>
        <div className="h-64">
          <Line data={lineData} options={{
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#cbd5e1' } } },
            scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } }, y: moneyAxis },
          }} />
        </div>
      </div>

      {/* YoY table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{perLabel}</th>
                <th className="text-right px-3 py-2">Tyres</th>
                <th className="text-right px-3 py-2">Spare</th>
                <th className="text-right px-3 py-2">Lubricants</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">{yoyLabel}</th>
              </tr>
            </thead>
            <tbody>
              {t.yoy.map((y) => (
                <tr key={y.period} className="border-t border-white/5">
                  <td className="px-3 py-2 font-medium text-slate-200">{y.label}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(y.tyre, '')}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(y.spare, '')}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(y.lubricant, '')}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-100">{fmtMoney(y.total, '')}</td>
                  <td className={`px-3 py-2 text-right ${y.pct == null ? 'text-slate-500' : y.pct > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{fmtPct(y.pct)}</td>
                </tr>
              ))}
              {t.forecast.map((y) => (
                <tr key={y.period} className="border-t border-fuchsia-500/20 bg-fuchsia-500/5">
                  <td className="px-3 py-2 font-medium text-fuchsia-300">{y.label} (forecast)</td>
                  <td className="px-3 py-2 text-right text-fuchsia-200">{fmtMoney(y.tyre, '')}</td>
                  <td className="px-3 py-2 text-right text-fuchsia-200">{fmtMoney(y.spare, '')}</td>
                  <td className="px-3 py-2 text-right text-fuchsia-200">{fmtMoney(y.lubricant, '')}</td>
                  <td className="px-3 py-2 text-right font-semibold text-fuchsia-200">{fmtMoney(y.total, '')}</td>
                  <td className="px-3 py-2 text-right text-slate-500">N/A</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {t.insights.length > 0 && (
        <div className="card p-4 space-y-1.5">
          {t.insights.map((ins, i) => (
            <div key={i} className="text-sm text-slate-300 flex items-start gap-2">
              <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ins.tone === 'good' ? '#10b981' : ins.tone === 'warning' ? '#f59e0b' : ins.tone === 'accent' ? '#e879f9' : '#3b82f6' }} />
              {ins.text}
            </div>
          ))}
        </div>
      )}
    </div>
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

  // Switching the grain (year/quarter/month) refetches every country in scope
  // without waiting for the previous fan-out. If the earlier one finishes last
  // the trend is bucketed by the OLD grain under the new toggle, so the periods
  // on the axis do not mean what the control says they mean.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true); setError('')
    try {
      // A scope that resolves to nothing reports on nothing. Falling back to
      // "All" here would silently widen the report past what was asked for.
      if (scopeCountryList.length === 0) { if (!stale()) setRows([]); return }
      // One call per country in scope. The RPC takes a single country, and asking
      // for exactly the countries in scope keeps the request as narrow as the
      // report rather than fetching everything and hiding the rest client-side.
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
  const scopeEntries = useMemo(() => countries.map((c) => ({
    country: c.country,
    currency: c.currency,
    total: c.years.reduce((s, y) => s + (num(y.total) ?? 0), 0),
    lines: c.years.reduce((s, y) => s + (num(y.lines) ?? 0), 0),
  })), [countries])
  // Money: withheld as N/A the moment more than one currency is in scope.
  const scopeMoney = useMemo(() => scopeMoneyTotal(scopeEntries), [scopeEntries])
  const scopeMoneyNote = moneyTotalNote(scopeMoney)
  // Counts carry no currency, so aggregating them across countries is honest.
  const scopeLines = useMemo(() => scopeCount(scopeEntries, 'lines'), [scopeEntries])

  function exportAll() {
    const out = []
    for (const c of countries) {
      for (const y of c.years) out.push({ country: c.country, currency: c.currency, year: y.label, tyre: y.tyre, spare: y.spare, lubricant: y.lubricant, total: y.total, lines: y.lines })
      for (const y of buildCountryTrend(c, grain).forecast) out.push({ country: c.country, currency: c.currency, year: `${y.label} (forecast)`, tyre: y.tyre, spare: y.spare, lubricant: y.lubricant, total: y.total, lines: '' })
    }
    return out
  }
  const cols = ['country', 'currency', 'year', 'tyre', 'spare', 'lubricant', 'total', 'lines']
  const heads = ['Country', 'Currency', 'Year', 'Tyres', 'Spare', 'Lubricants', 'Total', 'Lines']

  return (
    <div className="space-y-5">
      {/* Keeps the address bar describing this report, by REPLACE only. Rendered
          only inside a Router; the page works without one. */}
      {inRouter && <ReportUrlSync params={urlParams} />}
      <PageHeader
        title="Expense Trends & Forecast"
        subtitle="Spend by year, quarter or month, split by tyres / spare parts / lubricants, with period-on-period comparison and a forward forecast."
        icon={TrendingUp}
        actions={
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
              {GRAIN_OPTS.map(([g, label]) => (
                <button key={g} onClick={() => setGrain(g)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${grain === g ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={load} className="btn-ghost" title="Refresh"><RefreshCcw className="w-4 h-4" /></button>
            <button onClick={() => exportToExcel(exportAll(), cols, heads, 'Expense Trends')} disabled={!countries.length} className="btn-ghost gap-1"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
            <button onClick={() => exportToPdf(exportAll(), cols.map((k, i) => ({ key: k, header: heads[i] })), `Expense Trends & Forecast (${scopeTitle})`, 'Expense Trends', 'landscape')} disabled={!countries.length} className="btn-ghost gap-1"><FileText className="w-4 h-4" /> PDF</button>
          </div>
        }
      />

      {/* Reporting scope: which countries this report aggregates. Separate from
          the working context in the top bar, and it drives the queries below. */}
      <div className="card p-3 flex flex-wrap items-start justify-between gap-4">
        <ReportingScopeBar />
        {scopeEntries.length > 0 && (
          <div className="flex flex-wrap items-start gap-4 text-xs">
            <div className="min-w-0" role="group" aria-label="Combined spend">
              <div className="text-slate-500 flex items-center gap-1"><Coins className="w-3.5 h-3.5" aria-hidden="true" /> Combined spend</div>
              <div className={`font-semibold ${scopeMoney.total == null ? 'text-slate-400' : 'text-slate-100'}`}>
                {scopeMoney.total == null ? 'N/A' : fmtMoney(scopeMoney.total, scopeMoney.currency)}
              </div>
            </div>
            <div className="min-w-0" role="group" aria-label="Expense lines">
              <div className="text-slate-500 flex items-center gap-1"><Hash className="w-3.5 h-3.5" aria-hidden="true" /> Expense lines</div>
              <div className="font-semibold text-slate-100">
                {scopeLines == null ? 'N/A' : Math.round(scopeLines).toLocaleString()}
              </div>
            </div>
            <div className="min-w-0 max-w-md" role="group" aria-label="Spend per country">
              <div className="text-slate-500">Per country</div>
              <div className="font-medium text-slate-200">
                {scopeEntries.map((e) => `${e.country}: ${fmtMoney(e.total, e.currency)}`).join('  |  ')}
              </div>
            </div>
          </div>
        )}
        {scopeMoneyNote && (
          <p className="w-full text-[11px] text-slate-500">{scopeMoneyNote}</p>
        )}
      </div>

      {/* Date-range window (feeds the trend + forecast) */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Date range</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">From</span>
          <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="input py-1 text-xs">
            <option value="">Any month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <select value={fromYear} onChange={(e) => setFromYear(e.target.value)} className="input py-1 text-xs">
            <option value="">Any year</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">To</span>
          <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="input py-1 text-xs">
            <option value="">Any month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <select value={toYear} onChange={(e) => setToYear(e.target.value)} className="input py-1 text-xs">
            <option value="">Any year</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {rangeActive && <button onClick={clearRange} className="btn-ghost text-xs gap-1"><X className="w-3.5 h-3.5" /> Clear</button>}
        <span className="text-xs text-slate-500 ml-auto">{rangeActive ? 'Forecast is projected from the selected window.' : 'All periods'}</span>
      </div>

      {error && (
        <div className="card p-4 border border-red-500/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-300"><AlertTriangle className="w-4 h-4" /> {error}</div>
          <button onClick={load} className="btn-ghost">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-slate-400">Loading expense history…</div>
      ) : scopeCountryList.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          No countries are selected in the reporting scope, so there is nothing to report on.
        </div>
      ) : countries.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          No expense history for {scopeTitle}{rangeActive ? ' in the selected date range' : ''} yet.
        </div>
      ) : (
        <div className="space-y-8">
          {countries.map((c) => (
            <div key={c.country} className="space-y-4"><CountryTrend entry={c} grain={grain} /></div>
          ))}
        </div>
      )}
    </div>
  )
}

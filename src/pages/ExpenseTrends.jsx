/**
 * ExpenseTrends (route /expense-trends) — Expense Trends & Forecast.
 *
 * Multi-year expense intelligence over every year in the system, split by
 * category (tyres / spare parts / lubricants): year-over-year comparison, a
 * stacked trend, category-share, a least-squares forecast of the next years,
 * and plain-language findings. Real data only, honest empty/error states,
 * currencies never blended (one panel per country in its own currency).
 *
 * Data: `get_expense_yearly_trend` RPC via `src/lib/api/expenseTrends.js`.
 * All maths live in the pure `src/lib/expenseTrends.js` engine.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  TrendingUp, TrendingDown, LineChart, Layers, Calendar, FileSpreadsheet,
  FileText, RefreshCcw, AlertTriangle, Sparkles, Gauge, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { getExpensePeriodTrend } from '../lib/api/expenseTrends'
import {
  byCountry, buildCountryTrend, CATEGORIES, CATEGORY_LABEL, num,
  filterPeriods, availableYears, MONTHS,
} from '../lib/expenseTrends'
import { toUserMessage } from '../lib/safeError'
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
        <span className="text-xs text-slate-500">{cur} · {t.years.length} periods</span>
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
                  <td className="px-3 py-2 text-right text-slate-500">—</td>
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

export default function ExpenseTrends() {
  const { activeCountry } = useSettings()
  const [grain, setGrain] = useState('year')
  const [fromYear, setFromYear] = useState('')
  const [fromMonth, setFromMonth] = useState('')
  const [toYear, setToYear] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setRows(await getExpensePeriodTrend({ country: activeCountry, grain }))
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [activeCountry, grain])

  useEffect(() => { load() }, [load])

  const allCountries = useMemo(() => byCountry(rows), [rows])
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
            <button onClick={() => exportToPdf(exportAll(), cols.map((k, i) => ({ key: k, header: heads[i] })), 'Expense Trends & Forecast', 'Expense Trends', 'landscape')} disabled={!countries.length} className="btn-ghost gap-1"><FileText className="w-4 h-4" /> PDF</button>
          </div>
        }
      />

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
      ) : countries.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">No expense history for this scope yet.</div>
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

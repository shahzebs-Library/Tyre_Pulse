/**
 * YearlyTrendPanel — a reusable, self-fetching multi-year expense trend + forecast
 * panel, so the same intelligence can be spread across modules (Dashboard, Cost
 * Center, Engineering KPI, Board Overview, Executive) without duplicating chart
 * logic. Data comes from `get_expense_yearly_trend` (V413); all maths from the
 * pure `src/lib/expenseTrends.js` engine. Currencies are never blended — one
 * block per country in its own currency. Honest loading / empty / error states.
 *
 * Props:
 *   compact  – bar + one-line caption only (for dense dashboards)
 *   country  – override the active country (defaults to Settings.activeCountry)
 *   title    – heading (default "Expense trend by year")
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { TrendingUp, TrendingDown, Sparkles, AlertTriangle } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { getExpensePeriodTrend } from '../../lib/api/expenseTrends'
import { byCountry, buildCountryTrend, CATEGORIES, CATEGORY_LABEL, num, filterPeriods, availableYears, MONTHS } from '../../lib/expenseTrends'
import { toUserMessage } from '../../lib/safeError'
import { withAlpha } from '../../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const CAT_TONE = { tyre: '#3b82f6', spare: '#f59e0b', lubricant: '#10b981' }
const fmt = (v, cur) => (num(v) == null ? 'N/A' : `${cur ? cur + ' ' : ''}${Math.round(Number(v)).toLocaleString()}`)
const pct = (v) => (num(v) == null ? 'N/A' : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}%`)

function CountryBlock({ entry, compact, grain }) {
  const t = useMemo(() => buildCountryTrend(entry, grain), [entry, grain])
  const cur = t.currency
  const histLabels = t.years.map((y) => y.label)
  const fcLabels = t.forecast.map((y) => y.label)
  const labels = [...histLabels, ...fcLabels]
  const last = t.years[t.years.length - 1]
  const prev = t.years[t.years.length - 2]
  const fc1 = t.forecast[0]
  const yoyPct = prev && prev.total ? ((last.total - prev.total) / prev.total) * 100 : null

  const data = {
    labels,
    datasets: [
      ...CATEGORIES.map((k) => ({
        label: CATEGORY_LABEL[k], stack: 'spend',
        data: [...t.years.map((y) => y[k]), ...fcLabels.map(() => null)],
        backgroundColor: withAlpha(CAT_TONE[k], 0.85), borderWidth: 0,
      })),
      {
        label: 'Forecast', type: 'line', data: [...histLabels.map(() => null), ...t.forecast.map((y) => y.total)],
        borderColor: '#e879f9', borderDash: [6, 4], pointRadius: 3, borderWidth: 2, fill: false,
      },
    ],
  }
  const opts = {
    maintainAspectRatio: false,
    plugins: { legend: { display: !compact, labels: { color: '#64748b', boxWidth: 12 } } },
    scales: {
      x: { stacked: true, ticks: { color: '#64748b' }, grid: { color: 'var(--panel-2)' } },
      y: { stacked: true, ticks: { color: '#64748b', callback: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v) }, grid: { color: 'var(--panel-2)' } },
    },
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div style={{color:'var(--text-primary)'}} className="text-sm font-medium">{t.country} <span className="text-xs" style={{color:'var(--text-muted)'}}>({cur})</span></div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`inline-flex items-center gap-1 ${yoyPct == null ? 'text-slate-400' : yoyPct > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {yoyPct != null && (yoyPct > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />)}
            {grain === 'month' ? 'MoM' : grain === 'quarter' ? 'QoQ' : 'YoY'} {pct(yoyPct)}
          </span>
          {fc1 && (
            <span className="inline-flex items-center gap-1 text-fuchsia-300"><Sparkles className="w-3.5 h-3.5" /> {fc1.label} ~ {fmt(fc1.total, cur)}</span>
          )}
        </div>
      </div>
      <div className={compact ? 'h-40' : 'h-56'}><Bar data={data} options={opts} /></div>
      {!compact && t.insights[0] && <div className="text-xs" style={{color:'var(--text-muted)'}}>{t.insights[0].text}</div>}
    </div>
  )
}

const GRAIN_OPTS = [['year', 'Year'], ['quarter', 'Quarter'], ['month', 'Month']]

export default function YearlyTrendPanel({ compact = false, country, title = 'Expense trend by year', defaultGrain = 'year' }) {
  const { activeCountry } = useSettings()
  const scope = country ?? activeCountry
  const [grain, setGrain] = useState(defaultGrain)
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
      setRows(await getExpensePeriodTrend({ country: scope, grain }))
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [scope, grain])

  useEffect(() => { load() }, [load])

  const allCountries = useMemo(() => byCountry(rows), [rows])
  const yearOpts = useMemo(() => availableYears(allCountries), [allCountries])
  const fromYm = fromYear ? `${fromYear}-${fromMonth || '01'}` : null
  const toYm = toYear ? `${toYear}-${toMonth || '12'}` : null
  const countries = useMemo(
    () => allCountries.map((c) => ({ ...c, years: filterPeriods(c.years, fromYm, toYm) })).filter((c) => c.years.length),
    [allCountries, fromYm, toYm],
  )

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold" style={{color:'var(--text-primary)'}}>{title}</h3>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
          {GRAIN_OPTS.map(([g, label]) => (
            <button key={g} onClick={() => setGrain(g)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${grain === g ? 'bg-emerald-600 text-white' : ''}`}
              style={grain === g ? {} : { color: 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {!compact && yearOpts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>From</span>
          <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="input py-0.5 text-xs">
            <option value="">Any</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <select value={fromYear} onChange={(e) => setFromYear(e.target.value)} className="input py-0.5 text-xs">
            <option value="">Any</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span>To</span>
          <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="input py-0.5 text-xs">
            <option value="">Any</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
          <select value={toYear} onChange={(e) => setToYear(e.target.value)} className="input py-0.5 text-xs">
            <option value="">Any</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {(fromYm || toYm) && (
            <button onClick={() => { setFromYear(''); setFromMonth(''); setToYear(''); setToMonth('') }} className="underline">clear</button>
          )}
        </div>
      )}
      {loading ? (
        <div style={{color:'var(--text-muted)'}} className="py-8 text-center text-sm">Loading…</div>
      ) : error ? (
        <div className="py-4 text-sm text-red-300 flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</span>
          <button onClick={load} className="btn-ghost">Retry</button>
        </div>
      ) : countries.length === 0 ? (
        <div style={{color:'var(--text-muted)'}} className="py-8 text-center text-sm">No multi-year expense data for this scope.</div>
      ) : (
        countries.map((c) => <CountryBlock key={c.country} entry={c} compact={compact} grain={grain} />)
      )}
    </div>
  )
}

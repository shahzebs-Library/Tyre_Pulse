/**
 * TyreConsumptionSection - "Tyre Consumption" (mounted on /tyre-lifecycle).
 *
 * Answers the owner's question directly: how many tyres were fitted in the
 * period, what the daily average is, and which way it is moving - broken down by
 * site and by vehicle class.
 *
 * The screen leads with the number and then states its basis, because a daily
 * average is only as good as the denominator behind it. Two things are always
 * on screen and are never optional:
 *   1. Which denominator the headline uses (calendar days vs recording days),
 *      and the other figure beside it whenever the two disagree materially.
 *   2. The upload-pattern check, so a reader can see for themselves that the
 *      fitment dates are real business dates and not the day a file was loaded.
 * An unmeasurable rate renders "Not measured" - never a fabricated 0.0/day.
 */
import { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Layers, RefreshCw, TrendingUp, TrendingDown, Minus, CalendarDays,
  FileSpreadsheet, Info, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { getTyreConsumption } from '../../lib/api/tyreConsumption'
import {
  shapeConsumption, fmtRate, fmtCount, RATE_BASIS, WEAK_COVERAGE_PCT,
} from '../../lib/tyreConsumption'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { colorAt, withAlpha } from '../../lib/reportColors'
import DateField from '../ui/DateField'

/** Preset windows. Each resolves against the clock at click time, not at import. */
const PRESETS = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '180', label: 'Last 6 months', days: 180 },
  { key: '365', label: 'Last 12 months', days: 365 },
]

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function isoToday() {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function Tile({ label, value, sub, tone = 'default' }) {
  const valueColor = tone === 'muted' ? 'var(--text-secondary)' : 'var(--text-primary)'
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color: valueColor }}>{value}</div>
      {sub ? <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>{sub}</div> : null}
    </div>
  )
}

/** A quiet note. Tone carries meaning only through the icon, not a loud fill. */
function Note({ tone = 'info', children }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'good' ? CheckCircle2 : Info
  const color = tone === 'warn' ? '#b45309' : tone === 'good' ? '#15803d' : 'var(--text-dim)'
  return (
    <div
      className="flex gap-2 items-start rounded-lg p-3 text-xs leading-relaxed"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
    >
      <Icon size={14} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  )
}

function BreakdownTable({ title, bd, note, label }) {
  if (!bd || !bd.rows.length) {
    return (
      <div>
        <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h4>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Nothing recorded in this period.</p>
      </div>
    )
  }
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: 'var(--text-dim)' }}>
              <th className="text-left font-medium py-1.5 pr-3">{label}</th>
              <th className="text-right font-medium py-1.5 px-2">Tyres</th>
              <th className="text-right font-medium py-1.5 px-2">Assets</th>
              <th className="text-right font-medium py-1.5 pl-2">Share</th>
            </tr>
          </thead>
          <tbody>
            {bd.rows.slice(0, 12).map((r) => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td className="py-1.5 pr-3" style={{ color: r.resolved ? 'var(--text-secondary)' : 'var(--text-dim)' }}>
                  {r.key}
                  {!r.resolved ? <span className="ml-1 text-[10px]">(unattributed)</span> : null}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{r.fitments.toLocaleString()}</td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{r.assets.toLocaleString()}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{r.sharePct == null ? 'N/A' : `${r.sharePct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note ? <p className="text-[11px] mt-2" style={{ color: 'var(--text-dim)' }}>{note}</p> : null}
    </div>
  )
}

export default function TyreConsumptionSection() {
  const { activeCountry } = useSettings()
  const [preset, setPreset] = useState('90')
  const [fromDate, setFromDate] = useState(() => isoDaysAgo(89))
  const [toDate, setToDate] = useState(() => isoToday())
  const [state, setState] = useState({ loading: true, ok: true, data: null, reason: '' })
  const [basis, setBasis] = useState(RATE_BASIS.calendar.key)
  const [xlsBusy, setXlsBusy] = useState(false)

  async function load() {
    setState((s) => ({ ...s, loading: true }))
    const payload = await getTyreConsumption({ country: activeCountry, from: fromDate, to: toDate })
    const shaped = shapeConsumption(payload)
    setState({ loading: false, ok: shaped.ok, data: shaped.ok ? shaped : null, reason: shaped.reason || payload?.reason || '' })
  }
  useEffect(() => { load() }, [activeCountry, fromDate, toDate]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(p) {
    setPreset(p.key)
    setFromDate(isoDaysAgo(p.days - 1))
    setToDate(isoToday())
  }

  const d = state.data
  const headlineRate = basis === RATE_BASIS.active.key ? d?.perActiveDay : d?.perCalendarDay
  const otherRate = basis === RATE_BASIS.active.key ? d?.perCalendarDay : d?.perActiveDay
  const otherLabel = basis === RATE_BASIS.active.key ? RATE_BASIS.calendar.label : RATE_BASIS.active.label

  const dayChart = useMemo(() => {
    if (!d?.series?.length) return null
    // Plot every calendar day including the quiet ones. Plotting only recorded
    // days would hide the zeros and make consumption look smoother than it is.
    return {
      labels: d.series.map((p) => p.d.slice(5)),
      datasets: [{
        label: 'Tyres fitted',
        data: d.series.map((p) => p.n),
        backgroundColor: d.series.map((p) => (p.recorded ? withAlpha(colorAt(0), 0.75) : withAlpha(colorAt(0), 0.18))),
        borderWidth: 0,
      }],
    }
  }, [d])

  const monthChart = useMemo(() => {
    if (!d?.months?.length) return null
    return {
      labels: d.months.map((m) => m.month),
      datasets: [{
        label: 'Tyres per calendar day',
        data: d.months.map((m) => m.perCalendarDay),
        backgroundColor: d.months.map((m, i) => withAlpha(colorAt(i), m.partial ? 0.3 : 0.8)),
        borderWidth: 0,
      }],
    }
  }, [d])

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, valueLabels: { enabled: false } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-dim)', font: { size: 9 }, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-dim)', font: { size: 9 } } },
    },
  }

  async function downloadExcel() {
    if (!d) return
    setXlsBusy(true)
    try {
      const rows = d.series.map((p) => ({
        date: p.d,
        tyres_fitted: p.n,
        recorded: p.recorded ? 'Yes' : 'No day recorded',
      }))
      await exportToExcel(
        rows, ['date', 'tyres_fitted', 'recorded'],
        ['Date', 'Tyres fitted', 'Was anything recorded'],
        `Tyre consumption ${d.from} to ${d.to}`,
      )
    } catch { /* the button simply stops spinning; nothing is lost */ } finally {
      setXlsBusy(false)
    }
  }

  const TrendIcon = d?.trend?.direction === 'up' ? TrendingUp
    : d?.trend?.direction === 'down' ? TrendingDown : Minus

  return (
    <div className="card p-5 mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Layers size={18} /> Tyre Consumption
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            How many tyres were fitted, and the daily average.
            {activeCountry && activeCountry !== 'All' ? ` ${activeCountry}.` : ' All countries.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadExcel}
            disabled={!d || xlsBusy}
            className="px-3 py-1.5 text-xs rounded flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-bright)', color: 'var(--text-secondary)' }}
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs rounded flex items-center gap-1.5"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-bright)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={13} className={state.loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Period controls */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className="px-2.5 py-1 text-[11px] rounded transition-colors"
              style={{
                background: preset === p.key ? 'var(--surface-3)' : 'var(--surface-2)',
                border: `1px solid ${preset === p.key ? 'var(--border-bright)' : 'var(--border-subtle)'}`,
                color: preset === p.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <DateField
          className="text-sm w-40" value={fromDate} placeholder="From"
          ariaLabel="Consumption period start"
          onChange={(v) => { setFromDate(v); setPreset('') }}
        />
        <DateField
          className="text-sm w-40" value={toDate} placeholder="To"
          ariaLabel="Consumption period end" min={fromDate || undefined}
          onChange={(v) => { setToDate(v); setPreset('') }}
        />
      </div>

      {state.loading ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-dim)' }}>Loading tyre consumption...</p>
      ) : !state.ok ? (
        <div className="py-6">
          <Note tone="warn">
            {toUserMessage(state.reason) || 'This view could not be built.'}{' '}
            <button onClick={load} className="underline">Try again</button>
          </Note>
        </div>
      ) : !d ? null : (
        <>
          {/* The batch-date check comes FIRST. If the dates are upload artifacts
              the rate below is meaningless, and the reader must know that before
              they read it, not after. */}
          {d.batch.ok === false ? (
            <div className="mb-4"><Note tone="warn">{d.batch.note}</Note></div>
          ) : null}

          {/* Headline */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Tile
              label="Tyres fitted"
              value={fmtCount(d.fitments)}
              sub={`${d.from} to ${d.to} (${d.calendarDays} days)`}
            />
            <Tile
              label={`Daily average - ${basis === RATE_BASIS.active.key ? 'recording days' : 'calendar days'}`}
              value={fmtRate(headlineRate)}
              sub={otherRate != null ? `${otherLabel}: ${fmtRate(otherRate)}` : 'Only one basis is measurable'}
            />
            <Tile
              label="Assets involved"
              value={fmtCount(d.assets)}
              sub={d.activeDays != null ? `${d.activeDays} of ${d.calendarDays} days recorded a fitment` : null}
            />
            <Tile
              label="Month on month"
              value={d.trend.changePct == null ? 'Not measured' : `${d.trend.changePct > 0 ? '+' : ''}${d.trend.changePct}%`}
              tone={d.trend.changePct == null ? 'muted' : 'default'}
              sub={d.trend.direction === 'unknown' ? 'Needs two complete months' : d.trend.direction}
            />
          </div>

          {/* Basis switch + the sentence that keeps the number honest */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
              <CalendarDays size={12} /> Average over:
            </span>
            {Object.values(RATE_BASIS).map((b) => (
              <button
                key={b.key}
                onClick={() => setBasis(b.key)}
                title={b.help}
                className="px-2.5 py-1 text-[11px] rounded"
                style={{
                  background: basis === b.key ? 'var(--surface-3)' : 'var(--surface-2)',
                  border: `1px solid ${basis === b.key ? 'var(--border-bright)' : 'var(--border-subtle)'}`,
                  color: basis === b.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="mb-4">
            <Note tone={d.basisDiverges ? 'warn' : 'info'}>{d.basisNote}</Note>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <div>
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Tyres fitted per day</h4>
              <div style={{ height: 200 }}>
                {dayChart ? <Bar data={dayChart} options={chartOpts} /> : <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Nothing to plot.</p>}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                Faded bars are days with no fitment recorded. They are plotted as real zeros so quiet days stay visible.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Daily rate by month</h4>
              <div style={{ height: 200 }}>
                {monthChart ? <Bar data={monthChart} options={chartOpts} /> : <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Nothing to plot.</p>}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                Each month is divided by its own elapsed days, so a part-finished month is not made to look like a collapse. Faded bars are part months.
              </p>
            </div>
          </div>

          {/* Breakdowns, read through the asset */}
          <div className="grid lg:grid-cols-2 gap-6 mb-4">
            <BreakdownTable title="By site" label="Site" bd={d.bySite} note={d.siteNote} />
            <BreakdownTable title="By vehicle class" label="Class" bd={d.byClass} note={d.classNote} />
          </div>

          {/* The standing caveats, always visible, never buried */}
          <div className="space-y-2">
            {d.batch.ok === true ? <Note tone="good">{d.batch.note}</Note> : null}
            <Note tone="info">
              Site and vehicle class are read through the asset, because the tyre row itself
              records them only rarely. A fitment whose asset is not in the fleet register is
              grouped as unattributed rather than being assigned to a guessed site.
            </Note>
            {d.staleDays != null && d.staleDays > 7 ? (
              <Note tone="warn">
                The most recent fitment on record is {d.lastRecorded}, {d.staleDays} days ago.
                If tyres have been fitted since then, the averages above are diluted by days that
                are missing their upload rather than days nothing happened.
              </Note>
            ) : null}
            {d.undated > 0 ? (
              <Note tone="info">
                {fmtCount(d.undated)} tyre record{d.undated === 1 ? '' : 's'} carry no fitment date
                at all and cannot enter any period. They are excluded from every figure above
                rather than being dated by guesswork.
              </Note>
            ) : null}
            {d.coveragePct != null && d.coveragePct < WEAK_COVERAGE_PCT ? (
              <Note tone="warn">
                These figures rest on a thin feed. Treat them as a shape, not a measurement,
                until fitments are being recorded on most working days.
              </Note>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

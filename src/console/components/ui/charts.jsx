/**
 * Console charts.
 *
 * One chart vocabulary for every console page, so a trend on the Security
 * Audit reads exactly like a trend on System Health. Built on chart.js because
 * the console already ships it; every option below exists to hold the rules the
 * rest of the console follows:
 *
 * - Theme-aware. The console has a real light mode (html.light), and a chart
 *   painted with dark-mode greys disappears on white. Colors are resolved from
 *   the active theme and the chart re-renders when the theme flips.
 * - Recessive frame: faint grid, muted ticks, no chart border. The data is the
 *   only thing with contrast.
 * - One axis. Two measures of different scale are two charts, never a second
 *   y-axis.
 * - Thin marks: 2px lines, rounded bar ends, tooltips on hover with the exact
 *   value, and a text summary for screen readers.
 * - An empty series renders a stated empty state, never a blank axis frame.
 */
import { useEffect, useMemo, useState } from 'react'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, LineElement, PointElement, BarElement, ArcElement,
  CategoryScale, LinearScale, Tooltip, Filler,
} from 'chart.js'

ChartJS.register(LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Filler)

/** Validated series colors: brand orange first, then hues that stay apart for
 *  colour-blind readers in both themes. Assigned in this order, never cycled. */
export const SERIES = {
  dark:  ['#fb923c', '#60a5fa', '#34d399', '#c084fc', '#f472b6', '#facc15'],
  light: ['#ea580c', '#2563eb', '#059669', '#9333ea', '#db2777', '#ca8a04'],
}

/** Status colors are reserved for state and always ship with a text label. */
export const STATUS = {
  dark:  { critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#94a3b8', good: '#34d399' },
  light: { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#64748b', good: '#059669' },
}

const INK = {
  dark:  { tick: '#9ca3af', grid: 'rgba(148,163,184,0.12)', tipBg: '#111827', tipText: '#f3f4f6', surface: '#0b1220' },
  light: { tick: '#4b5563', grid: 'rgba(15,23,42,0.08)',   tipBg: '#ffffff', tipText: '#111827', surface: '#ffffff' },
}

function readTheme() {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

/** Current console theme, updated live when the user flips it. */
export function useChartTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const obs = new MutationObserver(() => setTheme(readTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

function baseOptions(theme, { yLabel, yMax, stacked = false, horizontal = false } = {}) {
  const ink = INK[theme]
  const valueAxis = {
    beginAtZero: true,
    max: yMax,
    stacked,
    grid: { color: ink.grid, drawTicks: false },
    border: { display: false },
    ticks: { color: ink.tick, font: { size: 11 }, padding: 6, precision: 0 },
    title: yLabel ? { display: true, text: yLabel, color: ink.tick, font: { size: 11 } } : undefined,
  }
  const categoryAxis = {
    stacked,
    grid: { display: false },
    border: { display: false },
    ticks: { color: ink.tick, font: { size: 11 }, autoSkip: true, maxRotation: 0 },
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    animation: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? false : { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: ink.tipBg,
        titleColor: ink.tipText,
        bodyColor: ink.tipText,
        borderColor: ink.grid,
        borderWidth: 1,
        padding: 8,
        displayColors: true,
        boxPadding: 4,
      },
    },
    scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
  }
}

function ChartFrame({ height, summary, empty, children }) {
  if (empty) {
    return (
      <div style={{ height }} className="flex items-center justify-center rounded-lg border border-dashed border-gray-800">
        <p className="text-xs text-gray-500 px-3 text-center">{empty}</p>
      </div>
    )
  }
  return (
    <figure style={{ height }} className="relative" role="img" aria-label={summary}>
      {children}
      {summary && <figcaption className="sr-only">{summary}</figcaption>}
    </figure>
  )
}

/**
 * A trend over time. `series` = [{ label, values }]; one series needs no legend,
 * several get one drawn under the plot with the same colors.
 */
export function TrendChart({ labels = [], series = [], height = 220, yLabel, yMax, summary, emptyText = 'No data in this period yet.', area = true }) {
  const theme = useChartTheme()
  const empty = !labels.length || series.every((s) => !(s.values || []).some((v) => v !== null && v !== undefined))
  const data = useMemo(() => ({
    labels,
    datasets: series.map((s, i) => {
      const color = s.color || SERIES[theme][i % SERIES[theme].length]
      return {
        label: s.label,
        data: s.values,
        borderColor: color,
        backgroundColor: area && series.length === 1 ? `${color}22` : color,
        fill: area && series.length === 1,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: labels.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointBorderColor: INK[theme].surface,
        pointBorderWidth: 2,
        spanGaps: false,
      }
    }),
  }), [labels, series, theme, area])
  const options = useMemo(() => baseOptions(theme, { yLabel, yMax }), [theme, yLabel, yMax])
  return (
    <div>
      <ChartFrame height={height} summary={summary} empty={empty ? emptyText : null}>
        <Line data={data} options={options} />
      </ChartFrame>
      {!empty && series.length > 1 && <Legend items={series.map((s, i) => ({ label: s.label, color: s.color || SERIES[theme][i] }))} />}
    </div>
  )
}

/**
 * Bars for comparing amounts across categories. `bars` = [{ label, value, color? }].
 * Horizontal by default: long category names stay readable without rotation.
 */
export function BarsChart({ bars = [], height, horizontal = true, yLabel, summary, emptyText = 'Nothing to compare yet.', valueFormat }) {
  const theme = useChartTheme()
  const empty = !bars.length || bars.every((b) => !Number(b.value))
  const h = height || Math.max(140, bars.length * 34 + 40)
  const data = useMemo(() => ({
    labels: bars.map((b) => b.label),
    datasets: [{
      data: bars.map((b) => b.value),
      backgroundColor: bars.map((b) => b.color || SERIES[theme][0]),
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 22,
    }],
  }), [bars, theme])
  const options = useMemo(() => {
    const o = baseOptions(theme, { yLabel, horizontal })
    if (valueFormat) o.plugins.tooltip.callbacks = { label: (ctx) => ` ${valueFormat(ctx.parsed[horizontal ? 'x' : 'y'])}` }
    return o
  }, [theme, yLabel, horizontal, valueFormat])
  return (
    <ChartFrame height={h} summary={summary} empty={empty ? emptyText : null}>
      <Bar data={data} options={options} />
    </ChartFrame>
  )
}

/** Share of a whole, for five parts or fewer. More than five belongs in bars. */
export function ShareChart({ parts = [], height = 180, summary, emptyText = 'Nothing to show yet.', center }) {
  const theme = useChartTheme()
  const total = parts.reduce((a, p) => a + (Number(p.value) || 0), 0)
  const data = useMemo(() => ({
    labels: parts.map((p) => p.label),
    datasets: [{
      data: parts.map((p) => p.value),
      backgroundColor: parts.map((p, i) => p.color || SERIES[theme][i % SERIES[theme].length]),
      borderColor: INK[theme].surface,
      borderWidth: 2,
    }],
  }), [parts, theme])
  const options = useMemo(() => {
    const o = baseOptions(theme)
    delete o.scales
    o.cutout = '68%'
    o.interaction = { mode: 'nearest', intersect: true }
    return o
  }, [theme])
  if (!total) return <ChartFrame height={height} empty={emptyText} />
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ChartFrame height={height} summary={summary}>
          <Doughnut data={data} options={options} />
        </ChartFrame>
        {center && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-semibold text-gray-100 tabular-nums">{center.value}</span>
            <span className="text-[10px] uppercase tracking-wide text-gray-500">{center.label}</span>
          </div>
        )}
      </div>
      <Legend vertical items={parts.map((p, i) => ({
        label: p.label, color: p.color || SERIES[theme][i % SERIES[theme].length],
        value: p.value, pct: total ? Math.round((Number(p.value) / total) * 100) : 0,
      }))} />
    </div>
  )
}

export function Legend({ items = [], vertical = false }) {
  return (
    <ul className={`${vertical ? 'space-y-1.5' : 'flex flex-wrap gap-x-4 gap-y-1 mt-2'} text-[11px] text-gray-400`}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
          <span className="text-gray-300 break-words min-w-0">{it.label}</span>
          {it.value !== undefined && <span className="tabular-nums text-gray-500">{it.value}{it.pct !== undefined ? ` (${it.pct}%)` : ''}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * A 0-100 health score as a ring. Red below 60, amber below 85, green above -
 * with the band written out beside it, so the meaning never depends on color.
 */
export function ScoreRing({ score, size = 120, label = 'Score' }) {
  const theme = useChartTheme()
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  const band = s >= 85 ? 'good' : s >= 60 ? 'medium' : 'critical'
  const color = STATUS[theme][band]
  const r = 44
  const circ = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={score === null || score === undefined ? `${label} not measured` : `${label} ${s} of 100`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke={INK[theme].grid} strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(s / 100) * circ} ${circ}`} transform="rotate(-90 50 50)" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="600"
          fill={theme === 'light' ? '#111827' : '#f3f4f6'}>{score === null || score === undefined ? 'N/A' : s}</text>
      </svg>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-200">
          {score === null || score === undefined ? 'Not measured' : band === 'good' ? 'Healthy' : band === 'medium' ? 'Needs attention' : 'At risk'}
        </p>
      </div>
    </div>
  )
}

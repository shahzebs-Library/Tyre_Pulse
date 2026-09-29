/**
 * Pressure Intelligence right-rail charts: axle bars (current against the
 * vehicle-median reference) and the 7-day trend by axle. Chart.js cannot read
 * CSS variables, and the kit's --cc-* tokens live on .cc (not :root), so the
 * colours are resolved from the host element and re-read when the theme flips.
 */
import { useEffect, useRef, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const TOKENS = ['--cc-green', '--cc-blue', '--cc-amber', '--cc-purple', '--cc-red', '--cc-ink-2', '--cc-ink-3', '--cc-track']

function useCcColors() {
  const ref = useRef(null)
  const [c, setC] = useState(null)
  useEffect(() => {
    const read = () => {
      const el = ref.current?.closest('.cc') || ref.current
      if (!el) return
      const cs = getComputedStyle(el)
      const out = {}
      for (const t of TOKENS) out[t] = cs.getPropertyValue(t).trim() || '#888'
      setC(out)
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return [ref, c]
}

const axisOpts = (c, title) => ({
  grid: { color: c['--cc-track'] },
  ticks: { color: c['--cc-ink-3'], font: { size: 10.5 } },
  title: title ? { display: true, text: title, color: c['--cc-ink-3'], font: { size: 10.5 } } : { display: false },
})

export function PositionPressureChart({ bars }) {
  const [ref, c] = useCcColors()
  return (
    <div ref={ref} className="pi-chart" role="img" aria-label={bars.map((b) => `${b.group} ${b.current ?? 'N/A'} psi against ${b.reference ?? 'N/A'}`).join(', ')}>
      {c && (
        <Bar
          data={{
            labels: bars.map((b) => b.group),
            datasets: [
              { label: 'Current', data: bars.map((b) => b.current), backgroundColor: c['--cc-green'], borderRadius: 3, maxBarThickness: 22 },
              { label: 'Vehicle median', data: bars.map((b) => b.reference), backgroundColor: c['--cc-blue'], borderRadius: 3, maxBarThickness: 22 },
            ],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', align: 'end', labels: { color: c['--cc-ink-2'], boxWidth: 10, font: { size: 11 } } },
              tooltip: { callbacks: { afterBody: (items) => { const b = bars[items[0]?.dataIndex]; return b ? [`${b.readings} readings`, b.spec != null ? `Specification ${b.spec} psi` : 'No specification pressure'] : [] } } },
            },
            scales: { x: axisOpts(c), y: { ...axisOpts(c, 'Pressure (psi)'), beginAtZero: true } },
          }}
        />
      )}
    </div>
  )
}

const SERIES = ['--cc-blue', '--cc-green', '--cc-amber', '--cc-purple', '--cc-red', '--cc-ink-3']

export function PressureTrendChart({ trend }) {
  const [ref, c] = useCcColors()
  const labels = trend.labels.map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }))
  return (
    <div ref={ref} className="pi-chart" role="img" aria-label={`Median pressure by axle from ${trend.start} to ${trend.end}`}>
      {c && (
        <Line
          data={{
            labels,
            datasets: trend.series.map((s, i) => ({
              label: s.group, data: s.values, borderColor: c[SERIES[i % SERIES.length]], backgroundColor: c[SERIES[i % SERIES.length]],
              tension: 0.3, spanGaps: true, pointRadius: 3, borderWidth: 2,
            })),
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: c['--cc-ink-2'], boxWidth: 10, font: { size: 11 } } } },
            scales: { x: axisOpts(c), y: axisOpts(c, 'Pressure (psi)') },
          }}
        />
      )}
    </div>
  )
}

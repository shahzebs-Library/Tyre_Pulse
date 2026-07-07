import { motion } from 'framer-motion'

/**
 * Gauge — a professional semi-circular gauge (Grafana / Geotab / telematics
 * style): a light track, a coloured value arc, a big tabular value in the well,
 * and a label. Colour comes from thresholds so state reads at a glance. Pure
 * SVG, theme-aware, no dependencies.
 *
 * @param {number} value    current value
 * @param {number} max      full-scale value (default 100)
 * @param {number} min      zero point (default 0)
 * @param {string} label    caption under the gauge
 * @param {string} unit     small unit after the value (e.g. '%', 'km')
 * @param {Array<{ at:number, color:string }>} bands  colour stops by value
 *        (ascending). The band whose `at` the value has passed wins.
 * @param {boolean} reverse lower is better (flips default good/bad palette)
 */
const GOOD = '#16a34a', WARN = '#d97706', CRIT = '#dc2626'

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}
function arc(cx, cy, r, a0, a1) {
  const p0 = polar(cx, cy, r, a0)
  const p1 = polar(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
}

export default function Gauge({
  value = 0, max = 100, min = 0, label, unit = '', bands, reverse = false,
  size = 132, format, index = 0,
}) {
  const v = Number.isFinite(value) ? value : 0
  const frac = Math.max(0, Math.min(1, (v - min) / ((max - min) || 1)))

  const defaultBands = reverse
    ? [{ at: 0, color: GOOD }, { at: 0.34, color: WARN }, { at: 0.67, color: CRIT }]
    : [{ at: 0, color: CRIT }, { at: 0.34, color: WARN }, { at: 0.67, color: GOOD }]
  const stops = bands || defaultBands
  const color = stops.reduce((acc, b) => (frac >= b.at ? b.color : acc), stops[0].color)

  const sw = Math.round(size * 0.085)
  const r = (size - sw) / 2 - 2
  const cx = size / 2
  const cy = r + sw / 2 + 2
  const h = cy + sw / 2 + 2
  // Sweep 180° across the top: 180° (left) → 360° (right), through 270° (top).
  const A0 = 180, A1 = 360
  const valEnd = A0 + frac * (A1 - A0)
  const display = format ? format(v) : Math.round(v).toLocaleString()

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`}>
        <path d={arc(cx, cy, r, A0, A1)} fill="none" stroke="var(--gauge-track, rgba(148,163,184,0.22))" strokeWidth={sw} strokeLinecap="round" />
        <motion.path
          d={arc(cx, cy, r, A0, Math.max(A0 + 0.1, valEnd))}
          fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ delay: index * 0.06, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
        <text x={cx} y={cy - r * 0.06} textAnchor="middle"
          style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: size * 0.2, fill: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          {display}<tspan style={{ fontSize: size * 0.1, fontWeight: 600, fill: 'var(--text-muted)' }}>{unit}</tspan>
        </text>
      </svg>
      {label && <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] -mt-1 text-center">{label}</span>}
    </div>
  )
}

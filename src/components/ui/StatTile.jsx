import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

/**
 * StatTile — console-style KPI tile: uppercase micro-label, a large tabular
 * value with a quiet unit, an optional delta chip (arrow + %), and an inline
 * sparkline. Deliberately calm — the number and its trend do the talking, no
 * glow. Tone drives only the sparkline + delta colour (semantic), never the
 * whole card, so a wall of tiles stays scannable.
 */
const TONE = {
  accent:  'var(--accent)',
  info:    '#38bdf8',
  warn:    '#f5a524',
  crit:    '#f26161',
  neutral: 'var(--text-muted)',
}

function Spark({ data, color }) {
  if (!Array.isArray(data) || data.length < 2) return <div className="h-7" />
  const w = 96, h = 28, mn = Math.min(...data), mx = Math.max(...data), rg = (mx - mn) || 1
  const pts = data.map((d, i) => [ (i / (data.length - 1)) * w, h - 2 - ((d - mn) / rg) * (h - 4) ])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  const gid = `sp-${Math.abs(data.reduce((a, b, i) => a + b * (i + 1), 0)).toString(36)}`
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.1" fill={color} />
    </svg>
  )
}

export default function StatTile({
  label, value, unit, sub, to, delta, deltaGood, deltaSuffix = '%',
  spark, tone = 'neutral', icon: Icon, index = 0,
}) {
  const color = TONE[tone] || TONE.neutral
  const hasDelta = delta != null && Number.isFinite(delta)
  const up = hasDelta && delta > 0
  const flat = hasDelta && delta === 0
  const good = deltaGood != null ? deltaGood : !up
  const deltaColor = flat ? 'var(--text-muted)' : good ? 'var(--good, #22c55e)' : 'var(--crit, #f26161)'
  const Arrow = up ? ArrowUpRight : ArrowDownRight

  const body = (
    <div className="card h-full flex flex-col gap-3 !p-4">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-[var(--text-muted)]" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">{label}</span>
      </div>
      <div className="flex items-end gap-1.5 leading-none">
        <span className="text-[26px] font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">{value}</span>
        {unit && <span className="text-[13px] font-medium text-[var(--text-muted)] mb-0.5">{unit}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 mt-auto">
        {hasDelta ? (
          <span className="inline-flex items-center gap-0.5 text-[11.5px] font-bold tabular-nums" style={{ color: deltaColor }}>
            {!flat && <Arrow size={12} strokeWidth={2.6} />}
            {Math.abs(delta)}{deltaSuffix}
          </span>
        ) : sub ? (
          <span className="text-[11px] text-[var(--text-dim)] truncate">{sub}</span>
        ) : <span />}
        <Spark data={spark} color={color} />
      </div>
    </div>
  )

  const wrapped = to
    ? <Link to={to} className="block h-full focus-visible:outline-none">{body}</Link>
    : body

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      {wrapped}
    </motion.div>
  )
}

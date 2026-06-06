import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const ACCENTS = {
  green:  { text: 'text-green-400',  bg: 'bg-green-400/10',  glow: 'rgba(74,222,128,0.18)',  border: 'rgba(74,222,128,0.32)' },
  blue:   { text: 'text-blue-400',   bg: 'bg-blue-400/10',   glow: 'rgba(96,165,250,0.18)',  border: 'rgba(96,165,250,0.32)' },
  yellow: { text: 'text-yellow-400', bg: 'bg-yellow-400/10', glow: 'rgba(251,191,36,0.18)',  border: 'rgba(251,191,36,0.32)' },
  red:    { text: 'text-red-400',    bg: 'bg-red-400/10',    glow: 'rgba(248,113,113,0.18)', border: 'rgba(248,113,113,0.32)' },
  purple: { text: 'text-purple-400', bg: 'bg-purple-400/10', glow: 'rgba(192,132,252,0.18)', border: 'rgba(192,132,252,0.32)' },
  orange: { text: 'text-orange-400', bg: 'bg-orange-400/10', glow: 'rgba(251,146,60,0.18)',  border: 'rgba(251,146,60,0.32)' },
}

function useCountUp(target, duration = 950) {
  const [val, setVal] = useState(0)
  const raf = useRef(null)
  const t0  = useRef(null)
  const prev = useRef(0)

  useEffect(() => {
    const num = typeof target === 'number' ? target
      : parseFloat(String(target ?? 0).replace(/[^0-9.-]/g, '')) || 0
    const from = prev.current
    prev.current = num
    cancelAnimationFrame(raf.current)
    t0.current = null

    function tick(ts) {
      if (!t0.current) t0.current = ts
      const p = Math.min((ts - t0.current) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(from + (num - from) * ease))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration])

  return val
}

export default function StatCard({ label, value, sub, icon: Icon, color = 'green', trend, href, onClick }) {
  const c = ACCENTS[color] ?? ACCENTS.green

  const numericVal = typeof value === 'number' ? value
    : parseFloat(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0
  const counted = useCountUp(numericVal, 950)

  let displayVal
  if (typeof value === 'number') {
    displayVal = counted.toLocaleString()
  } else if (value && /^\d/.test(String(value))) {
    displayVal = String(value).replace(/[\d,]+/, counted.toLocaleString())
  } else {
    displayVal = value ?? '—'
  }

  const card = (
    <motion.div
      className="card-stat relative"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2, ease: 'easeOut' } }}
    >
      {/* icon */}
      {Icon && (
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c.bg}`}
          style={{ border: `1px solid ${c.border}`, boxShadow: `0 0 18px ${c.glow}` }}
        >
          <Icon size={18} className={c.text} />
        </div>
      )}

      {/* label */}
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1.5 leading-none">
        {label}
      </p>

      {/* value */}
      <p className="stat-value">{displayVal}</p>

      {/* sub */}
      {sub && <p className="text-xs text-gray-500 mt-1.5 leading-snug">{sub}</p>}

      {/* trend */}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-semibold ${
          trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-gray-500'
        }`}>
          {trend > 0 ? <TrendingUp size={11} /> : trend < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
          {Math.abs(trend)}% vs last period
        </div>
      )}

      {/* bottom edge glow line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${c.border}, transparent)` }}
      />
    </motion.div>
  )

  if (href)    return <a href={href} className="block">{card}</a>
  if (onClick) return <button onClick={onClick} className="w-full text-left">{card}</button>
  return card
}

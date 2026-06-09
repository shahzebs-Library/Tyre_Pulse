import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const ACCENTS = {
  green:  {
    text: 'text-green-400',
    bg: 'bg-green-400/10',
    glow: 'rgba(74,222,128,0.2)',
    border: 'rgba(74,222,128,0.35)',
    ring: 'rgba(74,222,128,0.15)',
    bar: 'linear-gradient(90deg, #16a34a, #4ade80)',
  },
  blue:   {
    text: 'text-blue-400',
    bg: 'bg-blue-400/10',
    glow: 'rgba(96,165,250,0.2)',
    border: 'rgba(96,165,250,0.35)',
    ring: 'rgba(96,165,250,0.15)',
    bar: 'linear-gradient(90deg, #2563eb, #60a5fa)',
  },
  yellow: {
    text: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    glow: 'rgba(251,191,36,0.2)',
    border: 'rgba(251,191,36,0.35)',
    ring: 'rgba(251,191,36,0.15)',
    bar: 'linear-gradient(90deg, #d97706, #fbbf24)',
  },
  red:    {
    text: 'text-red-400',
    bg: 'bg-red-400/10',
    glow: 'rgba(248,113,113,0.2)',
    border: 'rgba(248,113,113,0.35)',
    ring: 'rgba(248,113,113,0.15)',
    bar: 'linear-gradient(90deg, #dc2626, #f87171)',
  },
  purple: {
    text: 'text-purple-400',
    bg: 'bg-purple-400/10',
    glow: 'rgba(192,132,252,0.2)',
    border: 'rgba(192,132,252,0.35)',
    ring: 'rgba(192,132,252,0.15)',
    bar: 'linear-gradient(90deg, #7c3aed, #c084fc)',
  },
  orange: {
    text: 'text-orange-400',
    bg: 'bg-orange-400/10',
    glow: 'rgba(251,146,60,0.2)',
    border: 'rgba(251,146,60,0.35)',
    ring: 'rgba(251,146,60,0.15)',
    bar: 'linear-gradient(90deg, #ea580c, #fb923c)',
  },
}

function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0)
  const raf  = useRef(null)
  const t0   = useRef(null)
  const prev = useRef(0)

  useEffect(() => {
    const num = typeof target === 'number'
      ? target
      : parseFloat(String(target ?? 0).replace(/[^0-9.-]/g, '')) || 0
    const from = prev.current
    prev.current = num
    cancelAnimationFrame(raf.current)
    t0.current = null

    function tick(ts) {
      if (!t0.current) t0.current = ts
      const p    = Math.min((ts - t0.current) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 4)
      setVal(Math.round(from + (num - from) * ease))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration])

  return val
}

export default function StatCard({
  label, value, sub, icon: Icon,
  color = 'green', trend, href, onClick,
}) {
  const c = ACCENTS[color] ?? ACCENTS.green

  const numericVal = typeof value === 'number'
    ? value
    : parseFloat(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0
  const counted = useCountUp(numericVal, 900)

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
      className="card-stat relative group"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
    >
      {/* ambient glow on hover */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${c.ring} 0%, transparent 70%)`,
        }}
      />

      {/* icon */}
      {Icon && (
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3.5 ${c.bg} relative flex-shrink-0`}
          style={{
            border: `1px solid ${c.border}`,
            boxShadow: `0 0 24px ${c.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
          }}
        >
          <Icon size={17} className={c.text} strokeWidth={2} />
        </div>
      )}

      {/* label */}
      <p className="text-[10.5px] font-700 uppercase tracking-[0.08em] text-gray-500 mb-2 leading-none">
        {label}
      </p>

      {/* value */}
      <p className="stat-value">{displayVal}</p>

      {/* sub */}
      {sub && (
        <p className="text-xs text-gray-500 mt-2 leading-snug">
          {sub}
        </p>
      )}

      {/* trend */}
      {trend !== undefined && (
        <div className={`flex items-center gap-1.5 mt-2.5 text-xs font-semibold ${
          trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-gray-500'
        }`}>
          {trend > 0
            ? <TrendingUp size={11} strokeWidth={2.5} />
            : trend < 0
              ? <TrendingDown size={11} strokeWidth={2.5} />
              : <Minus size={11} strokeWidth={2.5} />
          }
          <span>{Math.abs(trend)}% vs last period</span>
        </div>
      )}

      {/* bottom prismatic bar */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[1.5px] opacity-40 group-hover:opacity-80 transition-opacity duration-300"
        style={{ background: c.bar, borderRadius: '0 0 16px 16px' }}
      />
    </motion.div>
  )

  if (href)    return <a href={href} className="block">{card}</a>
  if (onClick) return <button onClick={onClick} className="w-full text-left">{card}</button>
  return card
}

import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * SummaryCard - clickable stat card used in filter/summary rows.
 * Calm, professional treatment: a quiet active ring, no glow or scale pop.
 */
export default function SummaryCard({
  label,
  value,
  color = 'text-[var(--text-primary)]',
  barColor = 'bg-brand',
  active = false,
  onClick,
  index = 0,
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={cn(
        'card text-left w-full',
        active && 'ring-1 ring-[var(--accent-ring)] border-[var(--border-bright)]'
      )}
    >
      <p className={cn('text-2xl font-semibold tabular-nums tracking-tight', color)}>{value}</p>
      <p className="text-xs text-muted mt-1 font-medium">{label}</p>
      <div className={cn('w-full h-0.5 rounded-full mt-3 opacity-70', barColor)} />
    </motion.button>
  )
}

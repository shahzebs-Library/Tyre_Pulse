import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * SummaryCard — clickable stat card used in filter/summary rows.
 * Visually pops the active state with brand glow.
 */
export default function SummaryCard({
  label,
  value,
  color = 'text-white',
  barColor = 'bg-brand',
  active = false,
  onClick,
  index = 0,
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={cn(
        'card text-left w-full transition-all duration-200',
        'hover:scale-[1.02] hover:-translate-y-0.5',
        active && 'ring-1 ring-brand/40 shadow-[0_0_20px_rgba(22,163,74,0.15)]'
      )}
    >
      <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
      <p className="text-xs text-muted mt-1 font-medium">{label}</p>
      <div className={cn('w-full h-0.5 rounded-full mt-3 opacity-60', barColor)} />
    </motion.button>
  )
}

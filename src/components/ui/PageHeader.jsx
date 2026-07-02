import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * PageHeader - standard premium page header used across all pages.
 *
 * @param {string}   title
 * @param {string}   subtitle
 * @param {ReactNode} icon       - optional Lucide icon component
 * @param {ReactNode} actions    - right-side action buttons
 * @param {string}   className
 */
export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  badge,
  actions,
  onRefresh,
  refreshing = false,
  className,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex items-start justify-between gap-4 flex-wrap', className)}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-brand-bright" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
            {badge && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-subtle text-brand-bright border border-[rgba(22,163,74,0.2)]">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-sm text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 flex-wrap">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            {refreshing ? 'Loading…' : 'Refresh'}
          </button>
        )}
        {actions}
      </div>
    </motion.div>
  )
}

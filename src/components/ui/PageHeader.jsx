import { motion } from 'framer-motion'
import { RefreshCw, Clock, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { useLanguage } from '../../contexts/LanguageContext'

// "Updated 2 minutes ago" style relative time (compact, dependency-free).
function relativeTime(ts) {
  if (!ts) return null
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`
  const dd = Math.round(h / 24); return `${dd} d ago`
}

/**
 * PageHeader - standard premium page header used across all pages.
 *
 * @param {string}   title
 * @param {string}   subtitle
 * @param {ReactNode} icon       - optional Lucide icon component
 * @param {ReactNode} actions    - right-side action buttons
 * @param {string}   className
 * @param {boolean}  showBack   - opt-in local "Back" control (default false).
 *   The app shell (Layout) renders the single global "Back to previous page"
 *   control for every page, so PageHeader no longer shows its own by default;
 *   this avoids two back buttons. Kept as an opt-in for backward compatibility.
 * @param {Function} onBack     - optional override; called instead of navigate(-1)
 */
export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  badge,
  actions,
  onRefresh,
  refreshing = false,
  updatedAt,
  className,
  showBack = false,
  onBack,
}) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const rel = relativeTime(updatedAt)
  // Only offer "back" when there is somewhere to go (deep link / first page has no history).
  const canGoBack =
    typeof window !== 'undefined' && window.history && window.history.length > 1
  const renderBack = showBack && (canGoBack || typeof onBack === 'function')
  const handleBack = () => {
    if (typeof onBack === 'function') onBack()
    else navigate(-1)
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex items-start justify-between gap-4 flex-wrap', className)}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        {renderBack && (
          <button
            type="button"
            onClick={handleBack}
            aria-label="Back to previous page"
            title="Back to previous page"
            className="btn-secondary text-xs px-2.5 sm:px-3 py-1.5 flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
        )}
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
        {rel && (
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted px-2.5 py-1 rounded-lg bg-gray-800/40 border border-white/5">
            <Clock className="w-3 h-3 opacity-70" /> Updated {rel}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            {refreshing ? t('common.loading') : t('common.refresh')}
          </button>
        )}
        {actions}
      </div>
    </motion.div>
  )
}

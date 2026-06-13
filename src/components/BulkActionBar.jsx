import { AnimatePresence, motion } from 'framer-motion'
import { X, CheckSquare } from 'lucide-react'

/**
 * BulkActionBar — floats above the bottom of the screen when rows are selected.
 *
 * Props:
 *   count        — number of selected items
 *   onClear      — deselect all
 *   actions      — array of { label, icon: LucideComponent, onClick, variant?: 'danger' | 'default', disabled?: boolean }
 *   entityLabel  — singular label e.g. "tyre" (shows "3 tyres selected")
 */
export default function BulkActionBar({ count, onClear, actions = [], entityLabel = 'item' }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0,  opacity: 1 }}
          exit={{   y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40
                     flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl
                     bg-gray-900 border border-gray-700"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}
        >
          {/* Count badge */}
          <div className="flex items-center gap-2 pr-3 border-r border-gray-700">
            <CheckSquare size={15} className="text-orange-400" />
            <span className="text-sm font-semibold text-white tabular-nums">
              {count} {count === 1 ? entityLabel : `${entityLabel}s`} selected
            </span>
          </div>

          {/* Actions */}
          {actions.map((action, i) => {
            const Icon = action.icon
            return (
              <button
                key={i}
                onClick={action.onClick}
                disabled={action.disabled}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                           transition-all disabled:opacity-40 disabled:cursor-not-allowed
                           ${action.variant === 'danger'
                             ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/30'
                             : 'bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-700'
                           }`}
              >
                {Icon && <Icon size={13} />}
                {action.label}
              </button>
            )
          })}

          {/* Clear */}
          <button
            onClick={onClear}
            className="ml-1 p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="Deselect all"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

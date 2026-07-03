import { motion } from 'framer-motion'

/**
 * SegmentedControl — a modern connected toggle for mutually-exclusive choices
 * (replaces rows of disconnected filter buttons like Daily/Weekly/Monthly).
 * The active segment slides via a shared layout animation.
 *
 * @param {Array<{value:string,label:string,icon?:ReactNode}>} options
 * @param {string}   value      currently selected value
 * @param {(v)=>void} onChange
 * @param {'sm'|'md'} [size]
 * @param {string}   [className]
 * @param {string}   [ariaLabel]
 */
export default function SegmentedControl({ options = [], value, onChange, size = 'md', className = '', ariaLabel }) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs'
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-gray-800/50 border border-white/8 ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(o.value)}
            className={`relative ${pad} font-semibold rounded-lg transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap ${
              active ? 'text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${ariaLabel || 'x'}`}
                className="absolute inset-0 rounded-lg"
                style={{ background: 'var(--accent, #16a34a)', opacity: 0.9 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

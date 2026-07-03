/**
 * Skeleton loading primitives — professional shimmer placeholders that mirror
 * the shape of the content being loaded (cards, tables, charts), instead of a
 * bare spinner. Theme-aware via the `--surface-*` tokens.
 */

const base = 'relative overflow-hidden rounded-lg bg-gray-800/40'
const shimmer =
  'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer-x_1.4s_infinite] ' +
  'before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent'

export function Skeleton({ className = '', style }) {
  return <div className={`${base} ${shimmer} ${className}`} style={style} aria-hidden="true" />
}

/** A grid of KPI-card skeletons. */
export function SkeletonCards({ count = 5, className = '' }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-stat">
          <Skeleton className="w-10 h-10 rounded-xl mb-3.5" />
          <Skeleton className="h-3 w-2/3 mb-3" />
          <Skeleton className="h-7 w-1/2 mb-2" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      ))}
    </div>
  )
}

/** A table skeleton with a header row + N body rows. */
export function SkeletonTable({ rows = 8, cols = 5, className = '' }) {
  return (
    <div className={`card p-0 overflow-hidden ${className}`}>
      <div className="flex gap-3 px-4 py-3 border-b border-white/5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-white/5">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3 flex-1" style={{ opacity: 1 - r * 0.04 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A chart-area skeleton (title + plot). */
export function SkeletonChart({ className = '', height = 220 }) {
  return (
    <div className={`card ${className}`}>
      <Skeleton className="h-3.5 w-40 mb-4" />
      <Skeleton className="w-full rounded-xl" style={{ height }} />
    </div>
  )
}

export default Skeleton

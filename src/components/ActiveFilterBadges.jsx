import { X } from 'lucide-react'

/**
 * ActiveFilterBadges — renders dismissible chips for active URL filters.
 *
 * Props:
 *   filters      — current filter object  { status, country, ... }
 *   defaults     — default values object  (same shape as filters)
 *   labels       — optional display names { status: 'Status', country: 'Country', ... }
 *   onRemove     — (key: string) => void  called when user clicks × on a chip
 *   onReset      — () => void             called when "Clear all" is clicked
 *
 * Renders nothing when no filter deviates from its default.
 */
export default function ActiveFilterBadges({
  filters,
  defaults = {},
  labels = {},
  onRemove,
  onReset,
}) {
  const active = Object.entries(filters).filter(
    ([key, val]) =>
      val !== '' &&
      val !== null &&
      val !== undefined &&
      val !== (defaults[key] ?? ''),
  )

  if (active.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-gray-500 font-medium">Filters:</span>

      {active.map(([key, val]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium
                     bg-orange-500/10 text-orange-300 border border-orange-500/20"
        >
          <span className="text-gray-400">{labels[key] ?? key}:</span>
          <span>{String(val)}</span>
          <button
            type="button"
            onClick={() => onRemove?.(key)}
            className="ml-0.5 text-orange-400 hover:text-orange-200 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-400 rounded-full"
            aria-label={`Remove ${labels[key] ?? key} filter`}
          >
            <X size={10} aria-hidden="true" />
          </button>
        </span>
      ))}

      {active.length > 1 && (
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 rounded"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

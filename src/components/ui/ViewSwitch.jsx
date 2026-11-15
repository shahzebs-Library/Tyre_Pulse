/**
 * ViewSwitch - a plain tab strip for a page that hosts more than one view
 * (for example a page that absorbed a second, smaller page as a tab).
 * Controlled: the parent owns the selected key.
 */
export default function ViewSwitch({ views, value, onChange, label = 'Views' }) {
  if (!Array.isArray(views) || views.length < 2) return null
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]">
      {views.map((v) => {
        const on = value === v.key
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v.key)}
            className={`min-h-[44px] px-3 py-2 text-sm border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${on ? 'border-orange-500 font-semibold text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)]'}`}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )
}

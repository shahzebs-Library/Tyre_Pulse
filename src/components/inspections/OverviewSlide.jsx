/**
 * One overview card on the Inspections register: big numbers, subtle borders.
 *
 * A tile is a drill-down when it carries a focus key, and plain text when it does
 * not. Clicking one filters the register to the inspections behind it. The
 * predicate lives in inspectionTyreFlags (focusMatches) and is the SAME one
 * inspectionOverview counts with, so the tile and the table cannot drift.
 *
 * A tile with a zero or N/A value is NOT clickable: offering a drill-down that
 * lands on an empty table teaches nothing, and an unreadable value is not a
 * measurement to filter on.
 *
 * items: [label, value, accent, focusKey][]
 */
export default function OverviewSlide({ title, items, footer = null, activeFocus = 'all', onFocus = null, caption = null }) {
  return (
    <section className="card flex-1 min-w-[260px]" aria-label={title}>
      <h2 className={`text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] ${caption ? 'mb-1' : 'mb-3'}`}>{title}</h2>
      {/* What the numbers cover. Rendered ABOVE them on purpose: a reader has to
          know a figure is scoped before reading it, not after. */}
      {caption && <p className="text-[11px] leading-snug text-[var(--text-dim)] mb-3">{caption}</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {items.map(([label, value, accent, focusKey]) => {
          const alert = !!accent && Number(value) > 0
          const tone = alert ? '#b91c1c' : 'var(--text-primary)'
          const body = (
            <>
              <div className="text-2xl font-bold tabular-nums" style={{ color: tone }}>
                {value == null ? 'N/A' : value}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                {label}
                {/* Colour is never the only signal: an alerting tile says so in words for screen readers. */}
                {alert && <span className="sr-only"> (needs attention)</span>}
              </div>
            </>
          )
          const canFocus = !!(focusKey && onFocus && value != null && Number(value) > 0)
          if (!canFocus) return <div key={label}>{body}</div>
          const on = activeFocus === focusKey
          return (
            <button
              key={label}
              type="button"
              onClick={() => onFocus(on ? 'all' : focusKey)}
              aria-pressed={on}
              title={on ? 'Show all inspections again' : `Show only the inspections behind ${label}`}
              className={`text-left min-h-[44px] rounded-lg -mx-1.5 -my-1 px-1.5 py-1 transition-all ${on ? 'ring-2' : 'hover:bg-[var(--surface-2)]'}`}
              style={on ? { boxShadow: `0 0 0 2px ${tone}`, background: 'var(--surface-2)' } : undefined}
            >
              {body}
            </button>
          )
        })}
      </div>
      {footer && <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">{footer}</div>}
    </section>
  )
}

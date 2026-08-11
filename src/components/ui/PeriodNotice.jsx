import { CalendarRange } from 'lucide-react'

/**
 * Says which period is on screen, whenever it is not the one the reader assumed.
 *
 * Screens open on the current month for speed. When that month has no records
 * the screen falls back to the most recent month that does - and it must say so,
 * because a period that quietly became a different period is how someone reads a
 * complete month as a partial one, or an empty feed as a broken page.
 *
 * Renders nothing when the current month is genuinely what is shown: a banner on
 * every screen every day is a banner nobody reads.
 *
 * @param {object}   props
 * @param {object}   props.period    from resolveDefaultPeriod()
 * @param {Function} [props.onShowAll] offer the whole history in one click
 */
export default function PeriodNotice({ period, onShowAll }) {
  if (!period?.fellBack || !period?.note) return null
  return (
    <div
      className="rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-3 text-sm"
      style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <CalendarRange className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="truncate">{period.note}</span>
      </span>
      {onShowAll && (
        <button onClick={onShowAll} className="btn-secondary text-xs shrink-0">
          Show all time
        </button>
      )}
    </div>
  )
}

/**
 * AccessImpact - the Access Control page's own "what happens if I save this"
 * box: what happened, what will change, who is affected, can it be undone.
 * Local to the access pages on purpose (a shared console ImpactBox may replace
 * it later without touching the access logic).
 */
import { Info, ArrowRightLeft, Users, Undo2 } from 'lucide-react'

const ROWS = [
  { key: 'happened', label: 'What happened', icon: Info },
  { key: 'change', label: 'What will change', icon: ArrowRightLeft },
  { key: 'who', label: 'Who is affected', icon: Users },
  { key: 'undo', label: 'Can it be undone', icon: Undo2 },
]

export default function AccessImpact({ happened, change, who, undo, compact = false }) {
  const values = { happened, change, who, undo }
  const shown = ROWS.filter((r) => values[r.key])
  if (!shown.length) return null
  return (
    <div role="note" aria-label="Impact of this change"
      className={`rounded-lg border border-orange-700/40 bg-orange-500/5 p-3 grid gap-3 text-xs ${compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>
      {shown.map((r) => {
        const Icon = r.icon
        return (
          <div key={r.key} className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] text-gray-500"><Icon size={12} aria-hidden="true" />{r.label}</p>
            <p className="text-gray-300 mt-0.5 break-words">{values[r.key]}</p>
          </div>
        )
      })}
    </div>
  )
}

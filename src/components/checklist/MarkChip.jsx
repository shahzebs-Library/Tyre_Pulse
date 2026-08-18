import {
  CheckCircle2, AlertTriangle, MinusCircle, RefreshCw, Wrench,
  Droplets, SlidersHorizontal, Droplet,
} from 'lucide-react'
import { MARK_ICONS, MARK_TONES } from '../../lib/checklist/checklistMarks'

/**
 * One mark from a checklist legend, drawn as the sheet means it.
 *
 * The legend stores an icon TOKEN, never a library-specific component name -
 * a lucide name means nothing to the phone's icon set, and storing one is what
 * made four checklist cards render a blank square before V591. This map is the
 * web half of that translation; the phone keeps its own.
 */
const LUCIDE = {
  CheckCircle2, AlertTriangle, MinusCircle, RefreshCw, Wrench,
  Droplets, SlidersHorizontal, Droplet,
}

function iconFor(token) {
  const name = MARK_ICONS[token]?.lucide
  return (name && LUCIDE[name]) || MinusCircle
}

/**
 * @param {object} props
 * @param {{value,icon,tone,meaning,known,blocking}} props.mark from rowMarks()
 * @param {boolean} [props.showMeaning] print the plain-English meaning under it
 */
export default function MarkChip({ mark, showMeaning = false, size = 'sm' }) {
  if (!mark) return null
  const Icon = iconFor(mark.icon)
  const tone = MARK_TONES[mark.tone] || MARK_TONES.muted
  const pad = size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'

  return (
    <span className="inline-flex flex-col items-start gap-0.5 align-top">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad}`}
        style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.fg}33` }}
        // The meaning is the tooltip too, so it is reachable without turning it on.
        title={mark.meaning || undefined}
      >
        <Icon className={size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
        {mark.value}
        {mark.blocking && <span className="opacity-80">- blocks closing</span>}
      </span>
      {/* A mark nobody can explain is a mark that gets picked at random, so the
          legend's own wording is available beside it. It is only printed when
          the legend actually carries one - never invented. */}
      {showMeaning && mark.meaning && (
        <span className="text-[11px] text-[var(--text-muted)] leading-snug">{mark.meaning}</span>
      )}
    </span>
  )
}

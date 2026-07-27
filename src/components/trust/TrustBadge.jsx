/**
 * TrustBadge - the confidence chip that any KPI surface can drop beside a
 * figure so the reader knows how much of the underlying data supports it.
 *
 * The badge on its own is just a second unexplained number, so it never appears
 * without its reasons: clicking (or focusing) it opens the specific gaps that
 * cost the figure its confidence, biggest first. A score it cannot measure
 * renders "N/A", never a zero.
 *
 * Usage:
 *   import { scoreDomain } from '../lib/dataTrust'
 *   <TrustBadge domain={scoreDomain(measures, 'tyre_cost')} />
 *
 * Or, when the score has already been resolved elsewhere:
 *   <TrustBadge score={62} label="Tyre and parts spend" reasons={[...]} />
 */
import { useState, useRef, useEffect, useId } from 'react'
import { ShieldCheck, ShieldAlert, ShieldQuestion, X } from 'lucide-react'
import { trustBand } from '../../lib/dataTrust'

const TONE = {
  good: {
    chip: 'bg-green-900/30 border-green-700/50 text-green-300 hover:bg-green-900/50',
    dot: 'bg-green-400',
    Icon: ShieldCheck,
  },
  warn: {
    chip: 'bg-amber-900/30 border-amber-700/50 text-amber-300 hover:bg-amber-900/50',
    dot: 'bg-amber-400',
    Icon: ShieldAlert,
  },
  bad: {
    chip: 'bg-red-900/30 border-red-700/50 text-red-300 hover:bg-red-900/50',
    dot: 'bg-red-400',
    Icon: ShieldAlert,
  },
  muted: {
    chip: 'bg-gray-800/50 border-gray-700/50 text-[var(--text-muted)] hover:bg-gray-800/80',
    dot: 'bg-gray-500',
    Icon: ShieldQuestion,
  },
}

export default function TrustBadge({
  domain = null,
  score: scoreProp,
  label: labelProp,
  reasons: reasonsProp,
  note: noteProp,
  size = 'sm',
  align = 'left',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const panelId = useId()

  const score = domain ? domain.score : (scoreProp ?? null)
  const label = domain ? domain.label : (labelProp || 'This figure')
  const reasons = domain ? domain.reasons : (reasonsProp || [])
  const note = domain ? domain.note : (noteProp || null)
  const band = domain?.band || trustBand(score)
  const tone = TONE[band.tone] || TONE.muted
  const { Icon } = tone

  // Close on outside click and on Escape, so the panel never traps the page.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const shown = score == null ? 'N/A' : `${score}%`
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'

  return (
    <span ref={wrapRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`Data confidence: ${shown} (${band.label}). Click for the reasons.`}
        className={`inline-flex items-center gap-1.5 rounded-full border font-semibold
          transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${pad} ${tone.chip}`}
      >
        <Icon size={size === 'xs' ? 10 : 12} aria-hidden="true" />
        <span>{shown}</span>
        <span className="sr-only">data confidence, {band.label}</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Why the confidence in ${label} is ${shown}`}
          className={`absolute top-full mt-2 z-50 w-80 max-w-[85vw] rounded-xl border
            border-[var(--card-border)] bg-[var(--surface-1)] shadow-2xl
            ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="flex items-start gap-2 px-4 py-3 border-b border-[var(--card-border)]">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{label}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Data confidence {shown} ({band.label})
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
            >
              <X size={13} />
            </button>
          </div>

          <div className="px-4 py-3 space-y-3 max-h-72 overflow-y-auto">
            {score == null && (
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {note || 'There is nothing behind this figure yet, so its confidence cannot be measured.'}
              </p>
            )}

            {score != null && reasons.length === 0 && (
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                Every check behind this figure passed. Nothing is holding its confidence down.
              </p>
            )}

            {reasons.map((r) => (
              <div key={r.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[var(--text-primary)]">{r.label}</p>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    costs {r.impact} pts
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{r.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  )
}

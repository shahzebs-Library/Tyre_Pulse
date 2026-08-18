import { CheckCircle2, Clock, XCircle, MinusCircle } from 'lucide-react'
import { approvalProgress, statusSummary, isRejected } from '../../lib/checklist/checklistApproval'
import SignatureView from './SignatureView'

const TONE = {
  good: { fg: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  warn: { fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  bad: { fg: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  muted: { fg: '#64748b', bg: 'rgba(100,116,139,0.12)' },
}

function fmt(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

/**
 * Who has signed this sheet, in the order the rules require.
 *
 * Before V594 a checklist had one approver field, so a supervisor's sign-off and
 * a final closure were the same event and one person could close a sheet alone.
 * The ladder is the visible half of that fix: it shows BOTH rungs, names the
 * person on each, prints when they signed, and shows the signature itself so it
 * can be opened and looked at. A rung nobody has reached is drawn as waiting, not
 * left out - an absent approval is the thing a reader most needs to see.
 *
 * The ladder itself comes from approvalProgress(), which the phone also reads, so
 * the two devices can never disagree about how far a sheet has got.
 */
export default function ChecklistApprovalLadder({ template, submission, compact = false }) {
  if (!submission) return null
  const rungs = approvalProgress(template, submission)
  const summary = statusSummary(template, submission)
  const rejected = isRejected(submission)
  const tone = TONE[summary.tone] || TONE.muted

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.fg}33` }}
        >
          {summary.tone === 'good' ? <CheckCircle2 className="w-3.5 h-3.5" />
            : summary.tone === 'bad' ? <XCircle className="w-3.5 h-3.5" />
              : summary.tone === 'warn' ? <Clock className="w-3.5 h-3.5" />
                : <MinusCircle className="w-3.5 h-3.5" />}
          {summary.text}
        </span>
      </div>

      <ol className="space-y-3">
        {rungs.map((r) => {
          const at = fmt(r.at)
          return (
            <li
              key={r.key}
              className={`rounded-xl border p-3 ${
                r.done
                  ? 'border-green-700/40 bg-green-500/[0.05]'
                  : r.current
                    ? 'border-amber-600/40 bg-amber-500/[0.05]'
                    : 'border-[var(--border-dim)] bg-[var(--surface-2)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    {r.done ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                      : r.current ? <Clock className="w-4 h-4 text-amber-400" />
                        : <MinusCircle className="w-4 h-4 text-[var(--text-dim)]" />}
                    {r.label}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {r.done
                      ? (at ? `Signed ${at}` : 'Signed')
                      : r.current
                        ? 'Waiting for this sign-off'
                        : 'Not reached yet'}
                  </p>
                </div>
                {/* The name is printed even when no image was captured: who signed
                    is the fact, the drawing is the evidence. */}
                {(r.done || r.name || r.signature) && !compact && (
                  <SignatureView
                    value={r.signature}
                    label={r.label}
                    name={r.name}
                    emptyText={r.done ? 'No signature captured' : 'Not signed'}
                    height={64}
                  />
                )}
              </div>
              {compact && (r.name || r.done) && (
                <p className="text-sm text-[var(--text-primary)] mt-1">
                  {r.name || <span className="text-[var(--text-dim)]">Name not recorded</span>}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {rejected && submission.review_note && (
        <div className="rounded-xl border border-red-700/40 bg-red-500/[0.06] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Why it was sent back</p>
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{submission.review_note}</p>
        </div>
      )}
    </div>
  )
}

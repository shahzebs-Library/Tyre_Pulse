import { useMemo, useState } from 'react'
import { Columns, ArrowRight, AlertTriangle, PlusCircle, MinusCircle, Info, X } from 'lucide-react'
import { diffHeaders, defaultDecisions, summariseDiff, DECISION } from '../../lib/import'

/**
 * "Your file's columns changed. What do you want to do?"
 *
 * The wizard already recognises a known file by its header fingerprint and
 * applies the saved mapping with zero clicks. The gap this fills is the MISS:
 * when the fingerprint does not match, the saved mapping was simply ignored and
 * a fresh guess took its place, with nothing said. A column renamed upstream
 * quietly stopped feeding the field it used to feed.
 *
 * So the only decision presented here is the one that is genuinely a decision:
 * a column that looks renamed can either carry its old mapping across, or be
 * left to the auto-mapper. Columns that vanished and columns that appeared are
 * shown for what they are - facts about the file - and NOT dressed up as a
 * choice, because there is nothing to choose: a column that is not in the file
 * cannot be mapped, and a new one is the auto-mapper's job and stays editable
 * on the next step either way.
 *
 * Nothing is applied until the person presses a button. Dismissing the dialog
 * keeps the file exactly as it arrived.
 */
export default function HeaderChangeDialog({ open, profile, previousHeaders, complete, currentHeaders, onApply, onDismiss }) {
  const diff = useMemo(
    () => diffHeaders(previousHeaders || [], currentHeaders || []),
    [previousHeaders, currentHeaders],
  )
  const [decisions, setDecisions] = useState(() => defaultDecisions(diff))

  // Rebuild the answers if the file changes underneath the dialog.
  const diffKey = `${(previousHeaders || []).join('|')}>>${(currentHeaders || []).join('|')}`
  const [seenKey, setSeenKey] = useState(diffKey)
  if (seenKey !== diffKey) { setSeenKey(diffKey); setDecisions(defaultDecisions(diff)) }

  if (!open || !diff.hasChanges) return null

  const targetFor = (header) => {
    const rule = (profile?.rules || []).find(
      (r) => String(r.source_header || '').trim().toLowerCase() === String(header || '').trim().toLowerCase(),
    )
    return rule?.target_field || null
  }

  const set = (key, value) => setDecisions((d) => ({ ...d, [key]: value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-xl bg-[var(--surface-raised,var(--card))] border border-[var(--border)] shadow-2xl">
        <div className="sticky top-0 flex items-start gap-3 px-5 py-4 bg-amber-950/30 border-b border-amber-800/40 backdrop-blur">
          <Columns size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">This file's columns are not the ones we remembered</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{summariseDiff(diff)}</p>
            {profile?.name && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Compared against your saved mapping "{profile.name}".
                {complete === false && ' That mapping only recorded the columns it used, so a column it never used will look new here.'}
              </p>
            )}
          </div>
          <button onClick={onDismiss} className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] shrink-0" title="Close without changing anything">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {diff.renames.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-amber-400" /> Columns that look renamed
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Keep means the new column feeds exactly what the old one fed. Leave it means the column is treated as brand new and mapped by its name.
              </p>
              <div className="space-y-2">
                {diff.renames.map((r) => {
                  const key = `rename:${r.from}`
                  const target = targetFor(r.from)
                  const keep = decisions[key] !== DECISION.CHANGE
                  return (
                    <div key={key} className="rounded-lg border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-primary)]">
                        <span className="px-2 py-0.5 rounded bg-white/5 font-mono text-xs">{r.from}</span>
                        <ArrowRight size={14} className="text-[var(--text-muted)]" />
                        <span className="px-2 py-0.5 rounded bg-white/5 font-mono text-xs">{r.to}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-1.5">
                        {target
                          ? <>Used to fill <span className="font-medium text-[var(--text-primary)]">{target}</span>.</>
                          : 'Was not mapped to any field.'}
                      </p>
                      <div className="flex gap-2 mt-2.5">
                        <button
                          onClick={() => set(key, DECISION.KEEP)}
                          className={`px-3 py-1.5 rounded-lg text-xs border ${keep ? 'bg-green-600 border-green-500 text-white' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-white/5'}`}
                        >
                          Keep my mapping
                        </button>
                        <button
                          onClick={() => set(key, DECISION.CHANGE)}
                          className={`px-3 py-1.5 rounded-lg text-xs border ${!keep ? 'bg-sky-600 border-sky-500 text-white' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-white/5'}`}
                        >
                          Leave it as a new column
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {diff.removed.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <MinusCircle size={13} className="text-red-400" /> Columns missing from this file
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-2">
                There is nothing in the file to map these to, so this upload will not carry them. If that is wrong, the column is missing from the export, not from the mapping.
              </p>
              <ul className="text-sm space-y-1">
                {diff.removed.map((h) => {
                  const target = targetFor(h)
                  return (
                    <li key={h} className="flex flex-wrap items-baseline gap-2">
                      <span className="px-2 py-0.5 rounded bg-white/5 font-mono text-xs">{h}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {target ? <>filled <span className="text-[var(--text-primary)]">{target}</span></> : 'was not mapped'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {diff.added.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <PlusCircle size={13} className="text-green-400" /> New columns in this file
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-2">
                These are mapped by name on the next step, where you can change any of them.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {diff.added.map((h) => (
                  <span key={h} className="px-2 py-0.5 rounded bg-white/5 font-mono text-xs">{h}</span>
                ))}
              </div>
            </section>
          )}

          <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            Every column stays editable on the mapping step. Nothing is imported until you approve the batch.
          </p>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 px-5 py-3 bg-[var(--card)] border-t border-[var(--border)]">
          <button onClick={onDismiss} className="px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-white/5">
            Ignore my saved mapping
          </button>
          <button onClick={() => onApply?.(decisions, diff)} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm">
            Apply my choices
          </button>
        </div>
      </div>
    </div>
  )
}

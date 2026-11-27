import { useEffect, useMemo, useState } from 'react'
import { UserCheck, Clock, Timer, ArrowRightLeft, AlertTriangle, Loader2, Check } from 'lucide-react'
import { listSlaInstances, nextDueInstance } from '../../lib/api/accidentSla'
import { listAssignablePeople, reassignStep } from '../../lib/api/accidentOwnership'
import { workstreamName, currentStep, caseGaps, daysLabel } from '../../lib/accidentOwnership'
import { toUserMessage } from '../../lib/safeError'

/**
 * Case page header strip (B3) + missing-data banner (B5).
 * Shows who owns the case and the step it is on now, the next action, days in
 * that step, the SLA clock (or "No target" when the owner has not set one), and a
 * one-click reassign of the current step through the existing guarded RPC.
 * Everything is read from the case already loaded by AccidentDetailModal.
 */
function clock(instance) {
  if (!instance?.due_at) return { label: 'No target', tone: 'quiet' }
  const ms = Date.parse(instance.due_at) - Date.now()
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600000)
  const d = Math.floor(h / 24)
  const text = d >= 1 ? `${d}d ${h % 24}h` : `${h}h ${Math.floor((abs % 3600000) / 60000)}m`
  if (ms < 0) return { label: `Overdue by ${text}`, tone: 'danger' }
  const warn = instance.warning_at && Date.parse(instance.warning_at) < Date.now()
  return { label: `${text} left`, tone: warn ? 'warning' : 'good' }
}

const TONE = {
  danger: 'text-red-500 border-red-500/40 bg-red-500/10',
  warning: 'text-amber-600 border-amber-500/40 bg-amber-500/10',
  good: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10',
  quiet: 'text-[var(--text-muted)] border-[var(--input-border)] bg-[var(--input-bg)]',
}

export default function CaseOwnerHeader({ accident, workstreams, canReassign, onChanged }) {
  const step = useMemo(() => currentStep(workstreams || []), [workstreams])
  const gaps = useMemo(() => caseGaps(accident, workstreams || []), [accident, workstreams])
  const [sla, setSla] = useState(undefined)
  const [people, setPeople] = useState([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    if (!accident?.id) return undefined
    listSlaInstances(accident.id)
      .then((rows) => {
        if (!alive) return
        const own = step ? rows.filter((r) => r.workstream_key === step.workstream_key) : rows
        setSla(nextDueInstance(own) || null)
      })
      .catch(() => alive && setSla(null))
    return () => { alive = false }
  }, [accident?.id, step?.workstream_key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    listAssignablePeople().then((p) => alive && setPeople(p)).catch(() => alive && setPeople([]))
    return () => { alive = false }
  }, [])

  if (!accident) return null
  const ownerName = (id) => people.find((p) => p.id === id)?.full_name
  const stepOwner = step
    ? (step.owner_id ? (ownerName(step.owner_id) || 'Named person') : step.owner_role ? `${step.owner_role} (any)` : 'Nobody')
    : 'No open step'
  const days = step ? (Date.now() - Date.parse(step.started_at || step.assigned_at || step.created_at)) / 86400000 : null
  const c = clock(sla)

  const reassign = async (personId) => {
    if (!step) return
    setBusy(true); setErr('')
    try {
      const p = people.find((x) => x.id === personId)
      await reassignStep(accident.id, step.workstream_key, { ownerId: personId, ownerRole: p?.role || step.owner_role || null })
      setPicking(false); setDone(true)
      onChanged?.()
    } catch (e) { setErr(toUserMessage(e, 'Could not reassign this step.')) } finally { setBusy(false) }
  }

  return (
    <div className="mx-6 mt-4 space-y-2">
      <div className="rounded-xl border border-[var(--input-border)] bg-[var(--surface-1,transparent)] p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="Case owner and current step">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Now with</p>
          <p className="font-medium text-[var(--text-primary)] flex items-center gap-1.5"><UserCheck size={14} aria-hidden="true" /> {stepOwner}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Next action</p>
          <p className="font-medium text-[var(--text-primary)]">{step ? workstreamName(step.workstream_key) : 'Close the case'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">In this step</p>
          <p dir="auto" className="font-medium text-[var(--text-primary)] flex items-center gap-1.5"><Clock size={14} aria-hidden="true" /> {days == null ? 'N/A' : daysLabel(days)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">SLA</p>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${TONE[c.tone]}`}>
            <Timer size={12} aria-hidden="true" /> {sla === undefined ? 'Checking...' : c.label}
          </span>
        </div>
        {canReassign && step && (
          <div className="ml-auto relative">
            <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              {busy ? <Loader2 size={14} className="animate-spin" /> : done ? <Check size={14} /> : <ArrowRightLeft size={14} />} Reassign
            </button>
            {picking && (
              <div className="absolute right-0 z-30 mt-1 w-72 max-h-72 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--bg-card,var(--surface-1))] p-1 shadow-lg" role="listbox" aria-label="Reassign to">
                {people.length === 0 && <p className="p-2 text-xs text-[var(--text-muted)]">Loading people...</p>}
                {people.map((p) => (
                  <button key={p.id} type="button" role="option" aria-selected={p.id === step.owner_id}
                    onClick={() => reassign(p.id)}
                    className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[var(--surface-2)] flex items-center gap-2">
                    <span className="truncate text-[var(--text-primary)]">{p.full_name || p.username}</span>
                    <span className="ml-auto text-[11px] text-[var(--text-dim)]">{p.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {gaps.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2 text-sm" role="note" aria-label="Missing on this case">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-[var(--text-primary)]">Missing on this case</p>
            <p className="text-[var(--text-secondary)] text-xs mt-0.5">{gaps.map((g) => g.label).join(' · ')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

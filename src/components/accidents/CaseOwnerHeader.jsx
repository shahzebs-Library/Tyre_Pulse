import { useEffect, useMemo, useState } from 'react'
import { UserCheck, Clock, Timer, ArrowRightLeft, AlertTriangle, Loader2, Check } from 'lucide-react'
import { listSlaInstances, nextDueInstance } from '../../lib/api/accidentSla'
import { listAssignablePeople, reassignStep } from '../../lib/api/accidentOwnership'
import { currentStep, caseGaps } from '../../lib/accidentOwnership'
import { toUserMessage } from '../../lib/safeError'
import useAccidentOwnershipText from './useAccidentOwnershipText'

/**
 * Case page header strip (B3) + missing-data banner (B5).
 * Shows who owns the case and the step it is on now, the next action, days in
 * that step, the SLA clock (or "No target" when the owner has not set one), and a
 * one-click reassign of the current step through the existing guarded RPC.
 * Everything is read from the case already loaded by AccidentDetailModal.
 */
function clock(instance, tx) {
  if (!instance?.due_at) return { label: tx('sla.none'), tone: 'quiet' }
  const ms = Date.parse(instance.due_at) - Date.now()
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600000)
  const d = Math.floor(h / 24)
  const text = d >= 1 ? `${d}d ${h % 24}h` : `${h}h ${Math.floor((abs % 3600000) / 60000)}m`
  if (ms < 0) return { label: tx('sla.overdueBy', { time: text }), tone: 'danger' }
  const warn = instance.warning_at && Date.parse(instance.warning_at) < Date.now()
  return { label: tx('sla.left', { time: text }), tone: warn ? 'warning' : 'good' }
}

const TONE = {
  danger: 'text-red-500 border-red-500/40 bg-red-500/10',
  warning: 'text-amber-600 border-amber-500/40 bg-amber-500/10',
  good: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10',
  quiet: 'text-[var(--text-muted)] border-[var(--input-border)] bg-[var(--input-bg)]',
}

export default function CaseOwnerHeader({ accident, workstreams, canReassign, onChanged }) {
  const L = useAccidentOwnershipText()
  const { tx } = L
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
    ? (step.owner_id ? (ownerName(step.owner_id) || tx('common.namedPerson')) : step.owner_role ? L.anyRole(step.owner_role) : tx('common.nobody'))
    : tx('header.noOpenStep')
  const days = step ? (Date.now() - Date.parse(step.started_at || step.assigned_at || step.created_at)) / 86400000 : null
  const c = clock(sla, tx)

  const reassign = async (personId) => {
    if (!step) return
    setBusy(true); setErr('')
    try {
      const p = people.find((x) => x.id === personId)
      await reassignStep(accident.id, step.workstream_key, { ownerId: personId, ownerRole: p?.role || step.owner_role || null })
      setPicking(false); setDone(true)
      onChanged?.()
    } catch (e) { setErr(toUserMessage(e, tx('header.reassignFailed'))) } finally { setBusy(false) }
  }

  return (
    <div className="mx-6 mt-4 space-y-2">
      <div className="rounded-xl border border-[var(--input-border)] bg-[var(--surface-1,transparent)] p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label={tx('header.aria')}>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{tx('header.nowWith')}</p>
          <p className="font-medium text-[var(--text-primary)] flex items-center gap-1.5"><UserCheck size={14} aria-hidden="true" /> {stepOwner}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{tx('header.nextAction')}</p>
          <p className="font-medium text-[var(--text-primary)]">{step ? L.step(step.workstream_key) : tx('header.closeCase')}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{tx('header.inStep')}</p>
          <p dir="auto" className="font-medium text-[var(--text-primary)] flex items-center gap-1.5"><Clock size={14} aria-hidden="true" /> {L.days(days)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{tx('header.sla')}</p>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${TONE[c.tone]}`}>
            <Timer size={12} aria-hidden="true" /> {sla === undefined ? tx('common.checking') : c.label}
          </span>
        </div>
        {canReassign && step && (
          <div className="ms-auto relative">
            <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              {busy ? <Loader2 size={14} className="animate-spin" /> : done ? <Check size={14} /> : <ArrowRightLeft size={14} />} {tx('header.reassign')}
            </button>
            {picking && (
              <div className="absolute end-0 z-30 mt-1 w-72 max-h-72 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--bg-card,var(--surface-1))] p-1 shadow-lg" role="listbox" aria-label={tx('header.reassignTo')}>
                {people.length === 0 && <p className="p-2 text-xs text-[var(--text-muted)]">{tx('header.loadingPeople')}</p>}
                {people.map((p) => (
                  <button key={p.id} type="button" role="option" aria-selected={p.id === step.owner_id}
                    onClick={() => reassign(p.id)}
                    className="w-full text-start px-2 py-1.5 rounded text-sm hover:bg-[var(--surface-2)] flex items-center gap-2">
                    <span className="truncate text-[var(--text-primary)]">{p.full_name || p.username}</span>
                    <span className="ms-auto text-[11px] text-[var(--text-dim)]">{L.role(p.role)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {gaps.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2 text-sm" role="note" aria-label={tx('header.missingTitle')}>
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-[var(--text-primary)]">{tx('header.missingTitle')}</p>
            <p className="text-[var(--text-secondary)] text-xs mt-0.5">{gaps.map((g) => L.gap(g)).join(' · ')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

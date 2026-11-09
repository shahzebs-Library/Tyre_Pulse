import { useCallback, useEffect, useState } from 'react'
import SideDrawer from '../ui/SideDrawer'
import { listAssignmentEvents, linkOperationalRecord, reassignAssignment, recommendAssignees, OPERATIONAL_TABLES, qualificationReasonText } from '../../lib/api/workforceAssignments'
import { listAssignmentEvidence, uploadAssignmentEvidence } from '../../lib/api/workforceEmployees'
import { openWorkEvidence } from '../../lib/api/workforceEvidence'
import { BLOCK_REASON_LABELS } from '../../lib/workforceTransitions'
import { employeeLabel } from '../../lib/workforceEmployeeDirectory'
import { toUserMessage } from '../../lib/safeError'

const when = v => (v ? new Date(v).toLocaleString() : 'N/A')
const ACTION_TEXT = {
  accept: 'Accepted', start: 'Started', block: 'Blocked', resume: 'Resumed', complete: 'Submitted for verification',
  verify: 'Verified', return: 'Returned for rework', cancel: 'Cancelled', reassign: 'Reassigned', link_record: 'Operational record linked',
}

/**
 * One task end to end: what was asked, who did it, every audited step, the evidence and the
 * canonical operational record it produced. Every write goes through an audited server function.
 */
export default function AssignmentDetailDrawer ({ item, open, onClose, employeeById, currentUserId, organisationId, isManager, onChanged }) {
  const [events, setEvents] = useState([])
  const [evidence, setEvidence] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState({ table: '', id: '' })
  const [handover, setHandover] = useState({ to: '', note: '', override: '' })
  const [candidates, setCandidates] = useState(null)
  const name = id => (employeeById?.has(id) ? employeeLabel(employeeById.get(id)) : (id ? 'Unknown account' : 'N/A'))
  const isAssignee = item?.assigned_to === currentUserId
  const openWork = item && !['verified', 'cancelled'].includes(item.status)

  const load = useCallback(async () => {
    if (!item) return
    setError('')
    try {
      const [ev, files] = await Promise.all([listAssignmentEvents(item.id), listAssignmentEvidence(item.id).catch(() => [])])
      setEvents(ev || []); setEvidence(files || [])
    } catch (e) { setError(toUserMessage(e, 'Could not load this task')) }
  }, [item])
  useEffect(() => { if (open) load() }, [open, load])
  useEffect(() => { setLink({ table: item?.operational_record_table || '', id: '' }); setHandover({ to: '', note: '', override: '' }); setCandidates(null) }, [item?.id])

  async function act (fn) {
    setBusy(true); setError('')
    try { await fn(); await load(); onChanged?.() } catch (e) { setError(toUserMessage(e, 'The update was not accepted')) } finally { setBusy(false) }
  }
  async function loadCandidates () {
    try { setCandidates(await recommendAssignees({ task_type: item.task_type, site: item.site, due_at: item.due_at, limit: 15 })) } catch (e) { setError(toUserMessage(e)) }
  }
  const chosen = candidates?.find(c => c.profile_id === handover.to)
  const needsOverride = chosen && !chosen.qualified && !chosen.safety_blocked

  if (!item) return null
  return (
    <SideDrawer open={open} onClose={onClose} title={item.title} subtitle={`${item.status.replace('_', ' ')} | ${item.priority} priority`}>
      <div className="space-y-5 text-sm">
        {error && <p role="alert" className="text-red-500">{error}</p>}
        <section className="grid grid-cols-2 gap-2">
          <div><span className="text-xs text-[var(--text-muted)]">Responsible</span><p>{name(item.assigned_to)}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Created by</span><p>{name(item.assigned_by)}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Site</span><p>{item.site || 'Not specified'}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Deadline</span><p>{when(item.due_at)}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Asset</span><p>{item.asset_no || 'N/A'}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Tyre / position</span><p>{[item.tyre_serial, item.tyre_position].filter(Boolean).join(' at ') || 'N/A'}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Task type</span><p>{item.task_type || 'Not classified'}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">Source</span><p>{item.source_module ? `${item.source_module} ${item.source_record_id || ''}` : 'Created here'}</p></div>
        </section>
        {item.supporting_employee_ids?.length > 0 && <p><strong>Supporting:</strong> {item.supporting_employee_ids.map(name).join('; ')}</p>}
        {item.instructions && <p className="whitespace-pre-wrap"><strong>Instructions:</strong> {item.instructions}</p>}
        {item.override_reason && <p className="rounded-lg border border-amber-500/40 p-2"><strong>Manager override</strong> by {name(item.overridden_by)}: {item.override_reason} ({(item.qualification?.soft || []).map(qualificationReasonText).join(', ')})</p>}

        <section>
          <h3 className="font-semibold mb-1">Operational record</h3>
          {item.operational_record_id
            ? <p>{OPERATIONAL_TABLES[item.operational_record_table] || item.operational_record_table}: <code className="text-xs">{item.operational_record_id}</code></p>
            : <p className="text-[var(--text-muted)]">{item.operational_record_table ? `Required before verification: ${OPERATIONAL_TABLES[item.operational_record_table]}.` : 'No operational record linked.'}</p>}
          {openWork && (isAssignee || isManager) && ['in_progress', 'blocked', 'submitted'].includes(item.status) && (
            <form className="flex flex-wrap gap-2 mt-2" onSubmit={e => { e.preventDefault(); act(() => linkOperationalRecord(item.id, link.table, link.id.trim())) }}>
              <select aria-label="Record type" className="input" required value={link.table} disabled={!!item.operational_record_table} onChange={e => setLink(l => ({ ...l, table: e.target.value }))}>
                <option value="">Record type</option>
                {Object.entries(OPERATIONAL_TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input aria-label="Record ID" className="input flex-1" required pattern="[0-9a-fA-F-]{36}" placeholder="Record ID (from the tyre or job card screen)" value={link.id} onChange={e => setLink(l => ({ ...l, id: e.target.value }))} />
              <button className="btn-secondary" disabled={busy}>Link record</button>
            </form>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-1">The tyre, kilometre and cost history come from the linked record. A task never creates a tyre replacement itself.</p>
        </section>

        <section>
          <h3 className="font-semibold mb-1">Evidence ({evidence.length})</h3>
          {evidence.map(f => (
            <div key={f.id} className="flex justify-between items-center border-b border-[var(--input-border)] py-1">
              <span className="truncate">{f.file_name} <span className="text-xs text-[var(--text-muted)]">{when(f.created_at)}</span></span>
              <button type="button" className="btn-secondary" onClick={async () => { try { window.open(await openWorkEvidence(f.object_path), '_blank', 'noopener,noreferrer') } catch (e) { setError(toUserMessage(e)) } }}>Open</button>
            </div>
          ))}
          {isAssignee && ['acknowledged', 'in_progress', 'blocked'].includes(item.status) && (
            <label className="block mt-2">Attach evidence (JPG, PNG, PDF, max 10 MB)
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="input block w-full mt-1" disabled={busy}
                onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) act(() => uploadAssignmentEvidence({ assignment: item, organisationId, file })) }} />
            </label>
          )}
        </section>

        {isManager && openWork && item.status !== 'submitted' && (
          <section className="rounded-lg border border-[var(--input-border)] p-3 space-y-2">
            <h3 className="font-semibold">Reassign / shift handover</h3>
            {!candidates
              ? <button type="button" className="btn-secondary" onClick={loadCandidates}>Find qualified people</button>
              : (
                <form className="space-y-2" onSubmit={e => { e.preventDefault(); act(() => reassignAssignment(item.id, handover.to, { note: handover.note, overrideReason: needsOverride ? handover.override : null })) }}>
                  <select aria-label="Hand over to" className="input w-full" required value={handover.to} onChange={e => setHandover(h => ({ ...h, to: e.target.value }))}>
                    <option value="">Hand over to</option>
                    {candidates.filter(c => c.profile_id !== item.assigned_to).map(c => (
                      <option key={c.profile_id} value={c.profile_id} disabled={c.safety_blocked}>
                        {c.full_name || c.employee_id} | {c.qualified ? 'qualified' : c.safety_blocked ? 'not permitted' : 'gaps'} | {c.open_assignments} open
                      </option>
                    ))}
                  </select>
                  {chosen && !chosen.qualified && <p className="text-xs">{chosen.reasons.map(qualificationReasonText).join(', ')}</p>}
                  <input className="input w-full" required placeholder="Handover note (what is done, what remains)" value={handover.note} onChange={e => setHandover(h => ({ ...h, note: e.target.value }))} />
                  {needsOverride && <input className="input w-full" required minLength={5} placeholder="Override reason (recorded with your name)" value={handover.override} onChange={e => setHandover(h => ({ ...h, override: e.target.value }))} />}
                  <button className="btn-primary" disabled={busy}>Reassign</button>
                </form>
              )}
          </section>
        )}

        <section>
          <h3 className="font-semibold mb-1">Audited timeline</h3>
          <ol className="space-y-2">
            <li className="text-xs text-[var(--text-muted)]">{when(item.created_at)}: created and assigned to {name(item.assigned_to)}</li>
            {events.map(ev => (
              <li key={ev.id} className="border-l-2 border-[var(--accent)] pl-2">
                <p><strong>{ACTION_TEXT[ev.action] || ev.action}</strong> by {name(ev.actor_id)} <span className="text-xs text-[var(--text-muted)]">{when(ev.effective_at)}</span></p>
                {ev.action === 'block' && <p className="text-xs">Cause: {BLOCK_REASON_LABELS[ev.reason_code || 'not_recorded']}</p>}
                {ev.action === 'reassign' && <p className="text-xs">From {name(ev.from_assignee)} to {name(ev.to_assignee)}</p>}
                {ev.action === 'link_record' && <p className="text-xs">{OPERATIONAL_TABLES[ev.detail?.table] || ev.detail?.table}</p>}
                {ev.note && <p className="text-xs whitespace-pre-wrap">{ev.note}</p>}
              </li>
            ))}
            {!events.length && <li className="text-xs text-[var(--text-muted)]">No recorded steps yet.</li>}
          </ol>
        </section>
      </div>
    </SideDrawer>
  )
}

import { useCallback, useEffect, useState } from 'react'
import SideDrawer from '../ui/SideDrawer'
import { listAssignmentEvents, linkOperationalRecord, reassignAssignment, recommendAssignees, OPERATIONAL_TABLES } from '../../lib/api/workforceAssignments'
import { workforceErrorText, qualificationReason } from '../../lib/workforceErrorText'
import { listAssignmentEvidence, uploadAssignmentEvidence } from '../../lib/api/workforceEmployees'
import { openWorkEvidence } from '../../lib/api/workforceEvidence'
import { blockReasonLabel } from '../../lib/workforceTransitions'
import { useLanguage } from '../../contexts/LanguageContext'
import { employeeLabel } from '../../lib/workforceEmployeeDirectory'

const when = v => (v ? new Date(v).toLocaleString() : 'N/A')
const EVENT_ACTIONS = new Set(['accept', 'start', 'block', 'resume', 'complete', 'verify', 'return', 'cancel', 'reassign', 'link_record'])
const STATUSES = new Set(['assigned', 'acknowledged', 'in_progress', 'blocked', 'submitted', 'verified', 'cancelled'])
const PRIORITIES = new Set(['low', 'normal', 'high', 'critical'])

/**
 * One task end to end: what was asked, who did it, every audited step, the evidence and the
 * canonical operational record it produced. Every write goes through an audited server function.
 */
export default function AssignmentDetailDrawer ({ item, open, onClose, employeeById, currentUserId, organisationId, isManager, onChanged }) {
  const { t } = useLanguage()
  const opTable = k => (OPERATIONAL_TABLES[k] ? t(`workforce.opTable.${k}`) : k)
  const [events, setEvents] = useState([])
  const [evidence, setEvidence] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState({ table: '', id: '' })
  const [handover, setHandover] = useState({ to: '', note: '', override: '' })
  const [candidates, setCandidates] = useState(null)
  const name = id => (employeeById?.has(id) ? employeeLabel(employeeById.get(id)) : (id ? t('workforce.drawer.unknownAccount') : 'N/A'))
  const isAssignee = item?.assigned_to === currentUserId
  const openWork = item && !['verified', 'cancelled'].includes(item.status)

  const load = useCallback(async () => {
    if (!item) return
    setError('')
    try {
      const [ev, files] = await Promise.all([listAssignmentEvents(item.id), listAssignmentEvidence(item.id).catch(() => [])])
      setEvents(ev || []); setEvidence(files || [])
    } catch (e) { setError(workforceErrorText(e, t, t('workforce.drawer.loadFailed'))) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t only labels the fallback message
  }, [item])
  useEffect(() => { if (open) load() }, [open, load])
  useEffect(() => { setLink({ table: item?.operational_record_table || '', id: '' }); setHandover({ to: '', note: '', override: '' }); setCandidates(null) }, [item?.id])

  async function act (fn) {
    setBusy(true); setError('')
    try { await fn(); await load(); onChanged?.() } catch (e) { setError(workforceErrorText(e, t, t('workforce.drawer.updateRejected'))) } finally { setBusy(false) }
  }
  async function loadCandidates () {
    try { setCandidates(await recommendAssignees({ task_type: item.task_type, site: item.site, due_at: item.due_at, limit: 15 })) } catch (e) { setError(workforceErrorText(e, t)) }
  }
  const chosen = candidates?.find(c => c.profile_id === handover.to)
  const needsOverride = chosen && !chosen.qualified && !chosen.safety_blocked

  if (!item) return null
  return (
    <SideDrawer open={open} onClose={onClose} title={item.title} subtitle={t('workforce.drawer.subtitle', { status: STATUSES.has(item.status) ? t(`workforce.status.${item.status}`) : String(item.status || '').replace('_', ' '), priority: PRIORITIES.has(item.priority) ? t(`workforce.priority.${item.priority}`) : item.priority })}>
      <div className="space-y-5 text-sm">
        {error && <p role="alert" className="text-red-500">{error}</p>}
        <section className="grid grid-cols-2 gap-2">
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.responsible')}</span><p>{name(item.assigned_to)}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.createdBy')}</span><p>{name(item.assigned_by)}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.site')}</span><p>{item.site || t('workforce.drawer.notSpecified')}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.deadline')}</span><p>{when(item.due_at)}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.asset')}</span><p>{item.asset_no || 'N/A'}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.tyrePosition')}</span><p>{item.tyre_serial && item.tyre_position ? t('workforce.drawer.tyreAt', { serial: item.tyre_serial, position: item.tyre_position }) : (item.tyre_serial || item.tyre_position || 'N/A')}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.taskType')}</span><p>{item.task_type || t('workforce.drawer.notClassified')}</p></div>
          <div><span className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.source')}</span><p>{item.source_module ? `${item.source_module} ${item.source_record_id || ''}` : t('workforce.drawer.createdHere')}</p></div>
        </section>
        {item.supporting_employee_ids?.length > 0 && <p><strong>{t('workforce.drawer.supporting')}</strong> {item.supporting_employee_ids.map(name).join('; ')}</p>}
        {item.instructions && <p className="whitespace-pre-wrap"><strong>{t('workforce.drawer.instructions')}</strong> {item.instructions}</p>}
        {item.override_reason && <p className="rounded-lg border border-amber-500/40 p-2"><strong>{t('workforce.drawer.managerOverride')}</strong> {t('workforce.drawer.overrideDetail', { name: name(item.overridden_by), reason: item.override_reason, gaps: (item.qualification?.soft || []).map(c => qualificationReason(c, t)).join(', ') })}</p>}

        <section>
          <h3 className="font-semibold mb-1">{t('workforce.drawer.operationalRecord')}</h3>
          {item.operational_record_id
            ? <p>{opTable(item.operational_record_table)}: <code className="text-xs">{item.operational_record_id}</code></p>
            : <p className="text-[var(--text-muted)]">{item.operational_record_table ? t('workforce.drawer.requiredBefore', { record: opTable(item.operational_record_table) }) : t('workforce.drawer.noRecord')}</p>}
          {openWork && (isAssignee || isManager) && ['in_progress', 'blocked', 'submitted'].includes(item.status) && (
            <form className="flex flex-wrap gap-2 mt-2" onSubmit={e => { e.preventDefault(); act(() => linkOperationalRecord(item.id, link.table, link.id.trim())) }}>
              <select aria-label={t('workforce.drawer.recordType')} className="input" required value={link.table} disabled={!!item.operational_record_table} onChange={e => setLink(l => ({ ...l, table: e.target.value }))}>
                <option value="">{t('workforce.drawer.recordType')}</option>
                {Object.keys(OPERATIONAL_TABLES).map(k => <option key={k} value={k}>{opTable(k)}</option>)}
              </select>
              <input aria-label={t('workforce.drawer.recordId')} className="input flex-1" required pattern="[0-9a-fA-F-]{36}" placeholder={t('workforce.drawer.recordIdPlaceholder')} value={link.id} onChange={e => setLink(l => ({ ...l, id: e.target.value }))} />
              <button className="btn-secondary" disabled={busy}>{t('workforce.drawer.linkRecord')}</button>
            </form>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-1">{t('workforce.drawer.recordNote')}</p>
        </section>

        <section>
          <h3 className="font-semibold mb-1">{t('workforce.drawer.evidence', { count: evidence.length })}</h3>
          {evidence.map(f => (
            <div key={f.id} className="flex justify-between items-center border-b border-[var(--input-border)] py-1">
              <span className="truncate">{f.file_name} <span className="text-xs text-[var(--text-muted)]">{when(f.created_at)}</span></span>
              <button type="button" className="btn-secondary" onClick={async () => { try { window.open(await openWorkEvidence(f.object_path), '_blank', 'noopener,noreferrer') } catch (e) { setError(workforceErrorText(e, t)) } }}>{t('workforce.drawer.open')}</button>
            </div>
          ))}
          {isAssignee && ['acknowledged', 'in_progress', 'blocked'].includes(item.status) && (
            <label className="block mt-2">{t('workforce.drawer.attachEvidence')}
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="input block w-full mt-1" disabled={busy}
                onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) act(() => uploadAssignmentEvidence({ assignment: item, organisationId, file })) }} />
            </label>
          )}
        </section>

        {isManager && openWork && item.status !== 'submitted' && (
          <section className="rounded-lg border border-[var(--input-border)] p-3 space-y-2">
            <h3 className="font-semibold">{t('workforce.drawer.reassignHeading')}</h3>
            {!candidates
              ? <button type="button" className="btn-secondary" onClick={loadCandidates}>{t('workforce.drawer.findPeople')}</button>
              : (
                <form className="space-y-2" onSubmit={e => { e.preventDefault(); act(() => reassignAssignment(item.id, handover.to, { note: handover.note, overrideReason: needsOverride ? handover.override : null })) }}>
                  <select aria-label={t('workforce.drawer.handOverTo')} className="input w-full" required value={handover.to} onChange={e => setHandover(h => ({ ...h, to: e.target.value }))}>
                    <option value="">{t('workforce.drawer.handOverTo')}</option>
                    {candidates.filter(c => c.profile_id !== item.assigned_to).map(c => (
                      <option key={c.profile_id} value={c.profile_id} disabled={c.safety_blocked}>
                        {c.full_name || c.employee_id} | {c.qualified ? t('workforce.drawer.candQualified') : c.safety_blocked ? t('workforce.drawer.candNotPermitted') : t('workforce.drawer.candGaps')} | {t('workforce.drawer.candOpen', { count: c.open_assignments })}
                      </option>
                    ))}
                  </select>
                  {chosen && !chosen.qualified && <p className="text-xs">{chosen.reasons.map(c => qualificationReason(c, t)).join(', ')}</p>}
                  <input className="input w-full" required placeholder={t('workforce.drawer.handoverNote')} value={handover.note} onChange={e => setHandover(h => ({ ...h, note: e.target.value }))} />
                  {needsOverride && <input className="input w-full" required minLength={5} placeholder={t('workforce.drawer.overridePlaceholder')} value={handover.override} onChange={e => setHandover(h => ({ ...h, override: e.target.value }))} />}
                  <button className="btn-primary" disabled={busy}>{t('workforce.drawer.reassign')}</button>
                </form>
              )}
          </section>
        )}

        <section>
          <h3 className="font-semibold mb-1">{t('workforce.drawer.timeline')}</h3>
          <ol className="space-y-2">
            <li className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.createdLine', { when: when(item.created_at), name: name(item.assigned_to) })}</li>
            {events.map(ev => (
              <li key={ev.id} className="border-l-2 border-[var(--accent)] pl-2">
                <p><strong>{EVENT_ACTIONS.has(ev.action) ? t(`workforce.drawer.event.${ev.action}`) : ev.action}</strong> {t('workforce.drawer.byActor', { name: name(ev.actor_id) })} <span className="text-xs text-[var(--text-muted)]">{when(ev.effective_at)}</span></p>
                {ev.action === 'block' && <p className="text-xs">{t('workforce.drawer.cause', { cause: blockReasonLabel(ev.reason_code || 'not_recorded', t) })}</p>}
                {ev.action === 'reassign' && <p className="text-xs">{t('workforce.drawer.fromTo', { from: name(ev.from_assignee), to: name(ev.to_assignee) })}</p>}
                {ev.action === 'link_record' && <p className="text-xs">{opTable(ev.detail?.table)}</p>}
                {ev.note && <p className="text-xs whitespace-pre-wrap">{ev.note}</p>}
              </li>
            ))}
            {!events.length && <li className="text-xs text-[var(--text-muted)]">{t('workforce.drawer.noSteps')}</li>}
          </ol>
        </section>
      </div>
    </SideDrawer>
  )
}

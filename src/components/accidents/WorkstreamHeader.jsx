/**
 * WorkstreamHeader - the strip every mock case tab opens with:
 *
 *   Workstream N of 7: <name>   |   Owner: <team / person>
 *   Received HH:MM  ·  With <team> 1h 12m  ·  SLA 48m remaining
 *
 * Numbering comes from accidentCaseVocab.CASE_FLOW so web and Flutter print
 * the same "Workstream N of 7". Every fact is read from data the case already
 * loaded (workstream row + SLA instances); a fact that does not exist renders
 * "Not set" rather than an invented time. No writes.
 */
import { useEffect, useState } from 'react'
import { Clock, Users, Timer, AlertTriangle } from 'lucide-react'
import { CASE_FLOW, caseFlowStep } from '../../lib/accidentCaseVocab'
import { listSlaInstances } from '../../lib/api/accidentSla'
import { durationLabel } from '../../lib/caseTimelineFeed'
import { WORKSTREAMS } from '../../lib/accidentCase'

const WS_TEAM = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.team]))
const WS_NAME = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.name]))

function hhmm(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * @param {{
 *   accidentId: string,
 *   workstreamKey: string,           // accidentCase.js key, e.g. 'insurance'
 *   workstreams?: object[],          // rows already loaded by the case (accident_case_workstreams)
 *   ownerName?: string|null,         // resolved person, when the caller knows it
 *   banner?: string|null,            // e.g. "External repair assessment"
 * }} props
 */
export default function WorkstreamHeader({ accidentId, workstreamKey, workstreams = [], ownerName = null, banner = null }) {
  const [sla, setSla] = useState(null)
  useEffect(() => {
    let live = true
    if (!accidentId) { setSla([]); return }
    listSlaInstances(accidentId).then((r) => { if (live) setSla(r || []) }).catch(() => { if (live) setSla([]) })
    return () => { live = false }
  }, [accidentId])

  const step = caseFlowStep(workstreamKey)
  const ws = (workstreams || []).find((w) => w.workstream_key === workstreamKey) || null
  const team = WS_TEAM[workstreamKey] || step?.owner || ''
  const receivedAt = ws?.assigned_at || ws?.started_at || null
  const withMs = receivedAt ? Date.now() - new Date(receivedAt).getTime() : null

  const inst = (sla || []).find((s) => s.workstream_key === workstreamKey && ['running', 'paused'].includes(s.state))
    || (sla || []).find((s) => s.workstream_key === workstreamKey) || null
  const dueMs = inst?.due_at ? new Date(inst.due_at).getTime() - Date.now() : null
  let slaLabel = 'No SLA started'
  let slaTone = 'text-[var(--text-secondary)]'
  if (inst?.state === 'met') { slaLabel = 'SLA met'; slaTone = 'text-emerald-500' }
  else if (inst?.state === 'breached' || (dueMs != null && dueMs < 0)) { slaLabel = `SLA overdue ${durationLabel(Math.abs(dueMs || 0))}`; slaTone = 'text-red-500' }
  else if (inst?.state === 'paused') { slaLabel = 'SLA paused'; slaTone = 'text-amber-500' }
  else if (dueMs != null) { slaLabel = `SLA ${durationLabel(dueMs)} remaining`; slaTone = dueMs < 3600000 ? 'text-amber-500' : 'text-emerald-500' }

  return (
    <div className="mb-3" data-testid="workstream-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {step ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
            <span className="text-[var(--text-secondary)]">Workstream {step.n} of {CASE_FLOW.length}:</span>
            <span className="font-semibold text-emerald-600">{step.label}</span>
          </span>
        ) : (
          <span className="font-semibold">{WS_NAME[workstreamKey] || workstreamKey}</span>
        )}
        <span className="text-[var(--text-dim)]">|</span>
        <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Users className="h-4 w-4" aria-hidden="true" />
          Owner: <span className="text-[var(--text-primary)]">{ownerName || ws?.owner_role || team || 'Not set'}</span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />Received {hhmm(receivedAt) || 'Not set'}</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden="true" />With {team || 'owner'} {withMs != null ? durationLabel(withMs) : 'Not set'}</span>
        <span aria-hidden="true">·</span>
        <span className={`inline-flex items-center gap-1 font-medium ${slaTone}`}><Timer className="h-3.5 w-3.5" aria-hidden="true" />{slaLabel}</span>
      </div>
      {banner ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />{banner}
        </div>
      ) : null}
    </div>
  )
}

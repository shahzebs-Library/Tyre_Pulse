import { useEffect, useState } from 'react'
import { recommendAssignees, qualificationReasonText } from '../../lib/api/workforceAssignments'
import { toUserMessage } from '../../lib/safeError'

/**
 * Who could take this task, and why. The server evaluates skills, certificates, site, availability
 * and current open workload. It only recommends: a person is chosen by the manager. People blocked
 * for safety-critical work are shown but cannot be picked.
 */
export default function AssigneeRecommendations ({ taskType, site, dueAt, selectedId, onPick }) {
  const [rows, setRows] = useState(null)
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      setState('loading'); setError('')
      try {
        const r = await recommendAssignees({ task_type: taskType || null, site: site || null, due_at: dueAt || null, limit: 8 })
        if (!live) return
        setRows(r); setState(r === null ? 'unavailable' : 'ready')
      } catch (e) { if (live) { setError(toUserMessage(e, 'Recommendations are unavailable')); setState('error') } }
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [taskType, site, dueAt])

  if (state === 'unavailable') return <p className="text-xs text-[var(--text-muted)]">Recommendations appear once the latest database update is installed.</p>
  return (
    <div className="md:col-span-2 rounded-lg border border-[var(--input-border)] p-3 space-y-2" aria-live="polite">
      <div className="flex items-center justify-between"><h4 className="font-semibold text-sm">Suggested people</h4>
        <span className="text-xs text-[var(--text-muted)]">Skills, certificates, site, availability and open workload. You decide.</span></div>
      {state === 'loading' && <p className="text-xs">Checking qualifications...</p>}
      {state === 'error' && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {state === 'ready' && !rows.length && <p className="text-xs">No active employees found.</p>}
      {state === 'ready' && rows.length > 0 && (
        <ul className="divide-y divide-[var(--input-border)]">
          {rows.map(r => {
            const status = r.safety_blocked ? 'Not permitted' : r.qualified ? 'Qualified' : 'Needs override'
            const tone = r.safety_blocked ? 'text-red-500' : r.qualified ? 'text-green-600' : 'text-amber-600'
            return (
              <li key={r.profile_id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.full_name || 'Unnamed account'}{r.employee_id ? ` | ID ${r.employee_id}` : ''}{r.designation ? ` | ${r.designation}` : ''}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    <span className={tone}>{status}</span>
                    {r.reasons?.length ? `: ${r.reasons.map(qualificationReasonText).join(', ')}` : ''}
                    {` | ${r.open_assignments} open task${r.open_assignments === 1 ? '' : 's'}`}
                    {dueAt && r.due_same_day ? ` | ${r.due_same_day} due the same day` : ''}
                  </p>
                </div>
                <button type="button" className={selectedId === r.profile_id ? 'btn-primary' : 'btn-secondary'} disabled={r.safety_blocked} onClick={() => onPick(r)}>
                  {selectedId === r.profile_id ? 'Selected' : 'Choose'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

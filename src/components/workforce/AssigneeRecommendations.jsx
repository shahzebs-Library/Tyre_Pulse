import { useEffect, useState } from 'react'
import { recommendAssignees, qualificationReasonText } from '../../lib/api/workforceAssignments'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Who could take this task, and why. The server evaluates skills, certificates, site, availability
 * and current open workload. It only recommends: a person is chosen by the manager. People blocked
 * for safety-critical work are shown but cannot be picked.
 */
export default function AssigneeRecommendations ({ taskType, site, dueAt, selectedId, onPick }) {
  const { t } = useLanguage()
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
      } catch (e) { if (live) { setError(toUserMessage(e, t('workforce.recommend.failed'))); setState('error') } }
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [taskType, site, dueAt])

  if (state === 'unavailable') return <p className="text-xs text-[var(--text-muted)]">{t('workforce.recommend.unavailable')}</p>
  return (
    <div className="md:col-span-2 rounded-lg border border-[var(--input-border)] p-3 space-y-2" aria-live="polite">
      <div className="flex items-center justify-between"><h4 className="font-semibold text-sm">{t('workforce.recommend.heading')}</h4>
        <span className="text-xs text-[var(--text-muted)]">{t('workforce.recommend.help')}</span></div>
      {state === 'loading' && <p className="text-xs">{t('workforce.recommend.checking')}</p>}
      {state === 'error' && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {state === 'ready' && !rows.length && <p className="text-xs">{t('workforce.recommend.none')}</p>}
      {state === 'ready' && rows.length > 0 && (
        <ul className="divide-y divide-[var(--input-border)]">
          {rows.map(r => {
            const status = r.safety_blocked ? t('workforce.recommend.notPermitted') : r.qualified ? t('workforce.recommend.qualified') : t('workforce.recommend.needsOverride')
            const tone = r.safety_blocked ? 'text-red-500' : r.qualified ? 'text-green-600' : 'text-amber-600'
            return (
              <li key={r.profile_id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.full_name || t('workforce.recommend.unnamed')}{r.employee_id ? ` | ${t('workforce.recommend.id', { id: r.employee_id })}` : ''}{r.designation ? ` | ${r.designation}` : ''}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    <span className={tone}>{status}</span>
                    {r.reasons?.length ? `: ${r.reasons.map(qualificationReasonText).join(', ')}` : ''}
                    {` | ${r.open_assignments === 1 ? t('workforce.recommend.openTaskOne', { count: r.open_assignments }) : t('workforce.recommend.openTaskOther', { count: r.open_assignments })}`}
                    {dueAt && r.due_same_day ? ` | ${t('workforce.recommend.dueSameDay', { count: r.due_same_day })}` : ''}
                  </p>
                </div>
                <button type="button" className={selectedId === r.profile_id ? 'btn-primary' : 'btn-secondary'} disabled={r.safety_blocked} onClick={() => onPick(r)}>
                  {selectedId === r.profile_id ? t('workforce.recommend.selected') : t('workforce.recommend.choose')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

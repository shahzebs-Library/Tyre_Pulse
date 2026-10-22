import { useEffect, useState } from 'react'
import { getDurationEstimate } from '../../lib/api/workforceAssignments'
import { formatMinutes } from '../../lib/workforceEstimate'

const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }

/**
 * Shows what completed work of the same kind has historically taken (median of ACTIVE minutes).
 * Advisory only: it never fills the estimate by itself, never shows a number without enough history,
 * and says when it cannot answer.
 */
export default function EstimatePanel({ taskType, vehicleType, role, onUse }) {
  const [state, setState] = useState({ phase: 'idle' })
  const task = String(taskType || '').trim()

  useEffect(() => {
    if (!task) { setState({ phase: 'idle' }); return undefined }
    let cancelled = false
    setState({ phase: 'loading' })
    const timer = setTimeout(async () => {
      try {
        const estimate = await getDurationEstimate({ task_type: task, vehicle_type: vehicleType, role })
        if (!cancelled) setState({ phase: 'done', estimate })
      } catch {
        if (!cancelled) setState({ phase: 'error' })
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [task, vehicleType, role])

  const box = 'md:col-span-2 rounded-lg border border-[var(--input-border)] bg-[var(--panel)] px-3 py-2 text-sm'
  if (state.phase === 'idle') {
    return <p className={`${box} text-[var(--text-muted)]`}>Enter a task type to see how long similar completed work has taken.</p>
  }
  if (state.phase === 'loading') return <p className={`${box} text-[var(--text-muted)]`} role="status">Checking completed work history...</p>
  if (state.phase === 'error') return <p className={`${box} text-[var(--text-muted)]`} role="status">Estimate could not be loaded. You can still set minutes manually.</p>

  const e = state.estimate
  if (e.status === 'estimated') {
    return (
      <div className={box} role="status">
        <div className="flex flex-wrap items-center gap-2">
          <strong>Estimated effort: {formatMinutes(e.medianMinutes)}</strong>
          <span className="text-xs rounded-full border border-[var(--input-border)] px-2 py-0.5">{CONFIDENCE[e.confidence]}</span>
          {onUse && <button type="button" className="btn-secondary" onClick={() => onUse(Math.round(e.medianMinutes))}>Use {Math.round(e.medianMinutes)} min</button>}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1">{e.message} Active work time only; blocked time and review waiting are excluded.</p>
      </div>
    )
  }
  return <p className={`${box} text-[var(--text-muted)]`} role="status">{e.message}</p>
}

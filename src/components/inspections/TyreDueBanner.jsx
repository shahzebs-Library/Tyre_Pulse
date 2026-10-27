import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList } from 'lucide-react'
import { lifeDisplay } from '../../lib/tyreRunningLife'
import { defectsForAction, isSevereCondition } from '../../lib/inspectionTyreFlags'
import { displayPositionCode, inspectionTypeHint } from '../../lib/tyreBay'
import RaiseActionDialog from './RaiseActionDialog'
import { listActionsForSource, isActionClosed } from '../../lib/api/correctiveActions'

// Immediate flag banner: shown when the vehicle carries tyres at/near end of
// life (judged by the ONE running-life calc via buildAssetFlagMap) or when
// the inspection itself found damaged/punctured positions.
/**
 * Flags the tyres that need changing on the just-inspected vehicle, AND lets the
 * finding become tracked work.
 *
 * Before this, a recorded defect ended at the report - 13 live inspections found
 * damage across 12 assets while the whole system held 3 corrective actions. The
 * button lives HERE, on the one component both the saved checklist and the
 * record detail render, so the flag and the action can never be shown on
 * different surfaces or driven by different rules.
 *
 * `inspection` is optional: an unsaved form has no id to attach an action to, so
 * the button simply does not appear.
 */
export default function TyreDueBanner({ entry, damaged = [], inspection = null }) {
  const due = entry ? [...(entry.overdue || []), ...(entry.dueSoon || [])] : []
  const [dialogOpen, setDialogOpen] = useState(false)
  const [raised, setRaised] = useState(null)   // { created, skipped, failed } | { error }

  const canRaise = Boolean(inspection?.id) && !String(inspection.id).startsWith('offline-')
  const allDefects = canRaise
    ? defectsForAction(inspection, inspection.asset_no ? { [inspection.asset_no]: entry } : {})
    : []

  // What has already been raised from this inspection. A defect with an action
  // shows that action's status instead of offering the button again.
  const [existing, setExisting] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!canRaise) return undefined
    let live = true
    listActionsForSource('inspection', inspection.id).then((rows) => { if (live) setExisting(rows) })
    return () => { live = false }
  }, [canRaise, inspection?.id, reloadKey])
  // One action speaks for each defect: an open one wins over a closed one, so
  // the banner never says "Fixed" while work is still outstanding; among equals
  // the newest (the list is newest first) is kept.
  const byKey = new Map()
  for (const a of existing) {
    if (!a.source_detail) continue
    const have = byKey.get(a.source_detail)
    if (!have || (isActionClosed(have.status) && !isActionClosed(a.status))) byKey.set(a.source_detail, a)
  }
  const defects = allDefects.filter(d => !byKey.has(d.key))
  const tracked = allDefects.filter(d => byKey.has(d.key)).map(d => ({ defect: d, action: byKey.get(d.key) }))

  // The fault list covers everything an inspector can record, and wear is most
  // of it. Calling a worn tyre "damage" would misreport what was found, so the
  // two are counted apart and the line says which.
  const severe = damaged.filter((d) => isSevereCondition(d.condition))
  const wornOnly = damaged.filter((d) => !isSevereCondition(d.condition))
  const faultLine = severe.length > 0 && wornOnly.length > 0
    ? 'Damage and worn tyres found on this vehicle'
    : (severe.length > 0 ? 'Damage found on this vehicle' : 'Worn tyres found on this vehicle')

  if (due.length === 0 && damaged.length === 0) return null
  return (
    <div role="region" aria-label="Tyres due for change on this vehicle" className="rounded-xl border px-4 py-3 mb-4"
      style={{ borderColor: 'rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={15} aria-hidden style={{ color: '#dc2626', flexShrink: 0 }} />
        <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
          {due.length > 0
            ? `${due.length} tyre${due.length === 1 ? '' : 's'} on this vehicle ${due.length === 1 ? 'is' : 'are'} at or near end of life - due for change`
            : faultLine}
        </span>
      </div>
      {due.length > 0 && (
        <ul className="text-xs space-y-0.5 text-[var(--text-secondary)]">
          {due.slice(0, 8).map((r, i) => (
            <li key={`${r.serial || 'tyre'}-${r.position || i}`} className="font-mono">
              {(r.serial || 'N/A')} at {(r.position || 'N/A')}: remaining {lifeDisplay(r.remainingKm, r.remainingHours)}
            </li>
          ))}
          {due.length > 8 && <li>and {due.length - 8} more</li>}
        </ul>
      )}
      {damaged.length > 0 && (
        <p className="text-xs mt-1 text-[var(--text-secondary)]">
          {/* Named the way the tyre records name it, so this line and the
              diagram above it do not call one wheel two things. */}
          {damaged
            .map((d) => `${displayPositionCode(inspectionTypeHint(inspection), d.position) || 'N/A'} (${d.condition})`)
            .join(', ')}
        </p>
      )}

      {tracked.length > 0 && (
        <ul aria-label="Actions already raised" className="mt-3 space-y-1">
          {tracked.map(({ defect, action }) => {
            const closed = isActionClosed(action.status)
            const late = !closed && action.due_date && new Date(action.due_date) < new Date()
            return (
              <li key={defect.key} className="text-xs flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
                <span className="font-semibold">{defect.positionLabel}</span>
                <span className="px-2 py-0.5 rounded-full border border-[var(--border)]"
                  style={closed ? { color: '#16a34a' } : late ? { color: '#ef4444' } : undefined}>
                  {closed ? (String(action.status).toLowerCase() === 'cancelled' ? 'Cancelled' : 'Fixed') : late ? 'Overdue' : (action.status || 'Open')}
                </span>
                {action.assigned_to && <span>Assigned to {action.assigned_to}</span>}
                {action.due_date && <span>Fix by {String(action.due_date).slice(0, 10)}</span>}
                {closed && action.closed_at && <span>Closed {String(action.closed_at).slice(0, 10)}</span>}
              </li>
            )
          })}
        </ul>
      )}

      {canRaise && defects.length > 0 && (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            type="button" onClick={() => setDialogOpen(true)}
            className="btn-secondary text-xs flex items-center gap-2 min-h-[44px]"
          >
            <ClipboardList size={13} />
            {`Raise corrective action (${defects.length})`}
          </button>
          <RaiseActionDialog
            open={dialogOpen} onClose={() => setDialogOpen(false)}
            inspection={inspection} defects={defects} onDone={(res) => { setRaised(res); setReloadKey(k => k + 1) }}
          />
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1">
          {raised?.error && (
            <span role="alert" className="text-xs" style={{ color: '#ef4444' }}>{raised.error}</span>
          )}
          {raised && !raised.error && (
            <span role="status" className="text-xs text-[var(--text-secondary)]">
              {raised.created.length > 0 && `${raised.created.length} action${raised.created.length === 1 ? '' : 's'} raised. `}
              {raised.skipped > 0 && `${raised.skipped} already raised. `}
              {raised.notified?.length > 0 && `Sent to ${[...new Set(raised.notified)].join(', ')}. `}
              {raised.notifyFailed?.length > 0 && `${raised.notifyFailed.length} could not be added to the Action Center. `}
              {raised.failed.length > 0 && `${raised.failed.length} could not be raised. `}
              {raised.created.length === 0 && raised.skipped > 0 && raised.failed.length === 0
                && 'Nothing new to raise.'}
            </span>
          )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { AlertTriangle, ClipboardList } from 'lucide-react'
import { lifeDisplay } from '../../lib/tyreRunningLife'
import { defectsForAction, isSevereCondition } from '../../lib/inspectionTyreFlags'
import { displayPositionCode, inspectionTypeHint } from '../../lib/tyreBay'
import { raiseActionsForInspection } from '../../lib/api/correctiveActions'
import { toUserMessage } from '../../lib/safeError'

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
  const [raising, setRaising] = useState(false)
  const [raised, setRaised] = useState(null)   // { created, skipped, failed } | { error }

  const canRaise = Boolean(inspection?.id) && !String(inspection.id).startsWith('offline-')
  const defects = canRaise
    ? defectsForAction(inspection, inspection.asset_no ? { [inspection.asset_no]: entry } : {})
    : []

  const raise = async () => {
    setRaising(true); setRaised(null)
    try {
      setRaised(await raiseActionsForInspection(inspection, defects))
    } catch (e) {
      setRaised({ error: toUserMessage(e) })
    } finally {
      setRaising(false)
    }
  }

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

      {canRaise && defects.length > 0 && (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            type="button" onClick={raise} disabled={raising}
            className="btn-secondary text-xs flex items-center gap-2 min-h-[44px] disabled:opacity-60"
          >
            <ClipboardList size={13} />
            {raising ? 'Raising...' : `Raise corrective action (${defects.length})`}
          </button>
          {raised?.error && (
            <span role="alert" className="text-xs" style={{ color: '#ef4444' }}>{raised.error}</span>
          )}
          {raised && !raised.error && (
            <span role="status" className="text-xs text-[var(--text-secondary)]">
              {raised.created.length > 0 && `${raised.created.length} action${raised.created.length === 1 ? '' : 's'} raised. `}
              {raised.skipped > 0 && `${raised.skipped} already open. `}
              {raised.failed.length > 0 && `${raised.failed.length} could not be raised. `}
              {raised.created.length === 0 && raised.skipped > 0 && raised.failed.length === 0
                && 'Nothing new to raise.'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

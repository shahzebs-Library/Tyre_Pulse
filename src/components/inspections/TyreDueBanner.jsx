import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList } from 'lucide-react'
import { lifeDisplay } from '../../lib/tyreRunningLife'
import { defectsForAction, isSevereCondition } from '../../lib/inspectionTyreFlags'
import { displayPositionCode, inspectionTypeHint } from '../../lib/tyreBay'
import RaiseActionDialog from './RaiseActionDialog'
import { useLanguage } from '../../contexts/LanguageContext'
import { listActionsForSource, isActionClosed, canCreateCorrectiveAction } from '../../lib/api/correctiveActions'

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
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.dueBanner.${k}`, v)
  const due = entry ? [...(entry.overdue || []), ...(entry.dueSoon || [])] : []
  const [dialogOpen, setDialogOpen] = useState(false)
  const [raised, setRaised] = useState(null)   // { created, skipped, failed } | { error }

  const canRaise = Boolean(inspection?.id) && !String(inspection.id).startsWith('offline-')
  const allDefects = canRaise
    ? defectsForAction(inspection).filter((defect) => defect.kind === 'damage')
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
  // Can this person create an action at all? Asked once, of the database. A
  // Tyre Data Collector may see the defects but not raise work; offering the
  // button anyway meant every press was refused (seen live 2026-11-16).
  const [mayCreate, setMayCreate] = useState(null)
  useEffect(() => {
    if (!canRaise) return undefined
    let live = true
    canCreateCorrectiveAction().then((v) => { if (live) setMayCreate(v) })
    return () => { live = false }
  }, [canRaise])

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
    ? p('damageAndWorn')
    : (severe.length > 0 ? p('damage') : p('worn'))

  if (due.length === 0 && damaged.length === 0) return null
  return (
    <div role="region" aria-label={p('aria')} className="rounded-xl border px-4 py-3 mb-4"
      style={{ borderColor: 'rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={15} aria-hidden style={{ color: '#dc2626', flexShrink: 0 }} />
        <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
          {due.length > 0
            ? (due.length === 1 ? p('dueOne') : p('dueMany', { count: due.length }))
            : faultLine}
        </span>
      </div>
      {due.length > 0 && (
        <ul className="text-xs space-y-0.5 text-[var(--text-secondary)]">
          {due.slice(0, 8).map((r, i) => (
            <li key={`${r.serial || 'tyre'}-${r.position || i}`} className="font-mono">
              {p('dueRow', { serial: r.serial || p('na'), position: r.position || p('na'), remaining: lifeDisplay(r.remainingKm, r.remainingHours) })}
            </li>
          ))}
          {due.length > 8 && <li>{p('andMore', { count: due.length - 8 })}</li>}
        </ul>
      )}
      {damaged.length > 0 && (
        <p className="text-xs mt-1 text-[var(--text-secondary)]">
          {/* Named the way the tyre records name it, so this line and the
              diagram above it do not call one wheel two things. */}
          {damaged
            .map((d) => `${displayPositionCode(inspectionTypeHint(inspection), d.position) || p('na')} (${d.condition})`)
            .join(', ')}
        </p>
      )}

      {tracked.length > 0 && (
        <ul aria-label={p('trackedAria')} className="mt-3 space-y-1">
          {tracked.map(({ defect, action }) => {
            const closed = isActionClosed(action.status)
            const late = !closed && action.due_date && new Date(action.due_date) < new Date()
            return (
              <li key={defect.key} className="text-xs flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
                <span className="font-semibold">{defect.positionLabel}</span>
                <span className="px-2 py-0.5 rounded-full border border-[var(--border)]"
                  style={closed ? { color: '#16a34a' } : late ? { color: '#ef4444' } : undefined}>
                  {closed ? (String(action.status).toLowerCase() === 'cancelled' ? p('cancelled') : p('fixed')) : late ? p('overdue') : (action.status || p('open'))}
                </span>
                {action.assigned_to && <span>{p('assignedTo', { name: action.assigned_to })}</span>}
                {action.due_date && <span>{p('fixBy', { date: String(action.due_date).slice(0, 10) })}</span>}
                {closed && action.closed_at && <span>{p('closedOn', { date: String(action.closed_at).slice(0, 10) })}</span>}
              </li>
            )
          })}
        </ul>
      )}

      {canRaise && defects.length > 0 && mayCreate === false && (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          {p('noRole')}
        </p>
      )}

      {canRaise && defects.length > 0 && mayCreate !== false && (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            type="button" onClick={() => setDialogOpen(true)}
            className="btn-secondary text-xs flex items-center gap-2 min-h-[44px]"
          >
            <ClipboardList size={13} />
            {p('raise', { count: defects.length })}
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
              {raised.created.length > 0 && `${raised.created.length === 1 ? p('raisedOne') : p('raisedMany', { count: raised.created.length })} `}
              {raised.skipped > 0 && `${p('skipped', { count: raised.skipped })} `}
              {raised.notified?.length > 0 && `${p('sentTo', { names: [...new Set(raised.notified)].join(', ') })} `}
              {raised.notifyFailed?.length > 0 && `${p('notifyFailed', { count: raised.notifyFailed.length })} `}
              {raised.failed.length > 0 && `${p('failed', { count: raised.failed.length })} `}
              {raised.created.length === 0 && raised.skipped > 0 && raised.failed.length === 0
                && p('nothingNew')}
            </span>
          )}
      </div>
    </div>
  )
}

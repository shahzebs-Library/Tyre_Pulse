import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'
import RaiseActionDialog from './RaiseActionDialog'
import { defectsForAction, generalDefectFor } from '../../lib/inspectionTyreFlags'
import { listActionsForSource, isActionClosed } from '../../lib/api/correctiveActions'
import { patchInspection } from '../../lib/api/inspections'
import { toUserMessage } from '../../lib/safeError'

/**
 * Raise corrective actions from ONE inspection, the one the person pressed the
 * button on. Every surface (register row, workspace, observations board and
 * drawer) opens this, so the assignee, the remarks and the due date are asked
 * for in the same place, and the action is always linked back to its source.
 *
 * Offered items: each tyre fault not already raised, plus one whole-inspection
 * item for remarks and observations. The whole-inspection item starts ticked
 * only when there is no tyre fault, so a one-click raise on a damaged tyre does
 * not also file a vague general task.
 */
export default function InspectionActionRaiser({ inspection, flagMap, onClose, onDone }) {
  const [existing, setExisting] = useState(null) // null = still loading
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!inspection?.id) return undefined
    let live = true
    setExisting(null); setLoadError('')
    listActionsForSource('inspection', inspection.id)
      .then((rows) => { if (live) setExisting(rows || []) })
      .catch((e) => { if (live) { setExisting([]); setLoadError(toUserMessage(e, 'Could not check actions already raised.')) } })
    return () => { live = false }
  }, [inspection?.id])

  const raisedKeys = useMemo(() => new Set((existing || []).map((a) => a.source_detail).filter(Boolean)), [existing])
  const defects = useMemo(() => {
    if (!inspection || existing == null) return []
    // The running-life feed belongs in the warning banner, not in the findings picker.
    const tyre = defectsForAction(inspection).filter((d) => d.kind === 'damage' && !raisedKeys.has(d.key))
    const general = generalDefectFor(inspection)
    const out = [...tyre]
    if (general && !raisedKeys.has(general.key)) out.push({ ...general, defaultInclude: tyre.length === 0 && !inspection.__preferredDefectKey })
    return out.map((d) => ({ ...d, defaultInclude: inspection.__preferredDefectKey ? d.key === inspection.__preferredDefectKey : d.defaultInclude }))
  }, [inspection, existing, raisedKeys])

  const finish = async (res) => {
    const first = res?.created?.[0]?.id
    // Keep the old single-link column in step so the register's "Action raised"
    // marker shows; the per-defect link lives on the action itself.
    if (first && !inspection.linked_action_id) {
      try { await patchInspection(inspection.id, { linked_action_id: first }) } catch { /* the action exists either way */ }
    }
    onDone?.(res, inspection)
  }

  if (!inspection) return null

  if (existing == null) {
    return (
      <Modal open onClose={onClose} title="Raise corrective actions" size="md">
        <p className="text-sm text-[var(--text-secondary)]" role="status">Checking actions already raised for {inspection.asset_no || 'this vehicle'}...</p>
      </Modal>
    )
  }

  if (loadError) {
    return <Modal open onClose={onClose} title="Raise corrective actions" size="md"><p role="alert">{loadError} Please retry before creating actions.</p></Modal>
  }

  if (!defects.length) {
    const open = (existing || []).filter((a) => !isActionClosed(a.status)).length
    return (
      <Modal open onClose={onClose} title="Raise corrective actions" size="md"
        footer={<button type="button" className="btn-secondary min-h-[44px]" onClick={onClose}>Close</button>}>
        <p className="text-sm text-[var(--text-secondary)]">
          Every finding on this inspection of {inspection.asset_no || 'this vehicle'} already has an action
          ({open} still open). <Link className="underline" to="/actions">Open Corrective Actions</Link>
        </p>
      </Modal>
    )
  }

  return (
    <>
      {loadError && (
        <p role="alert" className="sr-only">{loadError}</p>
      )}
      <RaiseActionDialog open onClose={onClose} inspection={inspection} defects={defects} onDone={finish} />
    </>
  )
}

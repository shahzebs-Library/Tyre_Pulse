import { useState, useEffect, useRef } from 'react'
import { ShieldCheck, Play, Loader2, Lock } from 'lucide-react'
import { useEntityWorkflow } from '../../hooks/useEntityWorkflow'
import ApprovalStatusBadge from './ApprovalStatusBadge'
import ApprovalAction from './ApprovalAction'
import ApprovalTrail from './ApprovalTrail'

/**
 * EntityApprovalPanel — drop-in approval block for any module page.
 *
 * Renders the current approval status + immutable trail for a business entity,
 * lets an authorised approver act (with the step's signature/photo/GPS/comment
 * requirements enforced), and lets the initiator start an approval when none is
 * running. The parent module should gate its own edit/save controls on the
 * `onStateChange({isActive,isLocked,status})` callback (or read the same via
 * useEntityWorkflow directly).
 *
 * @param {{ entityType:string, entityId:(string|number), entityLabel?:string,
 *           context?:object, canInitiate?:boolean, onStateChange?:Function,
 *           title?:string }} props
 */
export default function EntityApprovalPanel({
  entityType,
  entityId,
  entityLabel = null,
  context = {},
  canInitiate = true,
  onStateChange,
  title = 'Approval',
}) {
  const wf = useEntityWorkflow(entityType, entityId, { context, entityLabel })
  const [pickDef, setPickDef] = useState('')
  const [msg, setMsg] = useState(null)

  // Surface state to the parent so it can lock its form — in an effect (never
  // during render). A ref keeps an inline onStateChange out of the deps.
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => { onStateChangeRef.current = onStateChange })
  useEffect(() => {
    onStateChangeRef.current?.({ isActive: wf.isActive, isLocked: wf.isLocked, status: wf.status })
  }, [wf.isActive, wf.isLocked, wf.status])

  async function handleAct(action, payload) {
    setMsg(null)
    try {
      await wf.act(action, payload)
      setMsg({ ok: true, text: `Recorded: ${action}` })
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Action failed' })
    }
  }

  async function handleStart() {
    setMsg(null)
    try {
      await wf.start(pickDef)
      setMsg({ ok: true, text: 'Approval started' })
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Could not start approval' })
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        </div>
        {wf.status && <ApprovalStatusBadge status={wf.status} />}
      </div>

      {wf.loading ? (
        <p className="text-xs text-[var(--text-muted)]">Loading approval state…</p>
      ) : wf.error ? (
        <p className="text-xs text-red-400">{wf.error}</p>
      ) : !wf.instance ? (
        // No approval yet — offer to start one.
        canInitiate ? (
          wf.definitions.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No approval workflow is configured for this document type yet.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input py-1.5 px-2 text-xs w-auto"
                value={pickDef}
                onChange={(e) => setPickDef(e.target.value)}
                aria-label="Choose approval workflow"
              >
                <option value="">Select workflow…</option>
                {wf.definitions.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleStart}
                disabled={!pickDef || wf.acting}
                className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                {wf.acting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Start approval
              </button>
            </div>
          )
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No approval in progress.</p>
        )
      ) : (
        <>
          {wf.isLocked && wf.status === 'approved' && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
              <Lock size={12} /> Locked: approved, no further edits.
            </div>
          )}

          <ApprovalTrail events={wf.events} />

          {wf.canAct && wf.currentStep && (
            <div className="pt-2 border-t border-[var(--border-dim)]">
              <p className="text-xs text-[var(--text-muted)] mb-2">
                Your action on step “{wf.currentStep.name}”
              </p>
              <ApprovalAction
                requirements={wf.requirements}
                onAct={handleAct}
                busy={wf.acting}
              />
            </div>
          )}
        </>
      )}

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-[var(--accent)]' : 'text-red-400'}`}>{msg.text}</p>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getWorkflowForEntity,
  listDefinitionsForEntity,
  listStepEvents,
  myPendingApprovals,
  startWorkflow,
  actOnWorkflow,
  returnWorkflow,
} from '../lib/api/workflows'
import { stepRequirements } from '../lib/workflow/stepRequirements'

// Statuses that mean the document is mid-approval (edits should be blocked).
const ACTIVE = new Set(['pending', 'in_review', 'returned'])

/**
 * useEntityWorkflow — one hook that gives any module page its approval state.
 *
 * A module renders <EntityApprovalPanel/> with this hook's data and gates its
 * own edit/save controls on `isActive`/`isLocked`. All state changes go through
 * the server RPCs (start_workflow / workflow_act) — this hook is a thin,
 * refreshable read + action layer.
 *
 * @param {string} entityType e.g. 'inspection' | 'accident' | 'purchase_order'
 * @param {string|number|null} entityId
 * @param {{ context?: object, entityLabel?: string, enabled?: boolean }} [opts]
 */
export function useEntityWorkflow(entityType, entityId, opts = {}) {
  const { context = {}, entityLabel = null, enabled = true } = opts
  const [instance, setInstance] = useState(null)
  const [events, setEvents] = useState([])
  const [definitions, setDefinitions] = useState([])
  const [actionableIds, setActionableIds] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [acting, setActing] = useState(false)

  const canQuery = enabled && !!entityType && entityId != null

  const refresh = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setError(null)
    try {
      const inst = await getWorkflowForEntity(entityType, entityId)
      setInstance(inst)
      // Load the trail + who-can-act only when there is a run; definitions are
      // always useful so the initiator can start one.
      const [defs, evs, mine] = await Promise.all([
        listDefinitionsForEntity(entityType).catch(() => []),
        inst ? listStepEvents(inst.id).catch(() => []) : Promise.resolve([]),
        inst && ACTIVE.has(inst.status)
          ? myPendingApprovals().catch(() => [])
          : Promise.resolve([]),
      ])
      setDefinitions(defs || [])
      setEvents(evs || [])
      setActionableIds(new Set((mine || []).map((m) => m.id)))
    } catch (e) {
      setError(e?.message || 'Failed to load approval state')
    } finally {
      setLoading(false)
    }
  }, [canQuery, entityType, entityId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const currentStep = useMemo(() => {
    if (!instance?.steps || instance.current_step == null) return null
    return instance.steps[instance.current_step] ?? null
  }, [instance])

  const status = instance?.status ?? null
  const isActive = !!status && ACTIVE.has(status)
  const isLocked = status === 'approved' || isActive // no edits once submitted
  const canAct = !!instance && isActive && actionableIds.has(instance.id)
  const requirements = useMemo(
    () => (currentStep ? stepRequirements(currentStep) : {}),
    [currentStep],
  )

  const start = useCallback(
    async (definitionId) => {
      if (!definitionId) throw new Error('Pick a workflow to start')
      setActing(true)
      try {
        await startWorkflow({ definitionId, entityType, entityId, entityLabel, context })
        await refresh()
      } finally {
        setActing(false)
      }
    },
    [entityType, entityId, entityLabel, context, refresh],
  )

  const act = useCallback(
    async (action, payload = {}) => {
      if (!instance) throw new Error('No active approval')
      setActing(true)
      try {
        if (action === 'return') await returnWorkflow(instance.id, payload)
        else await actOnWorkflow(instance.id, action, payload)
        await refresh()
      } finally {
        setActing(false)
      }
    },
    [instance, refresh],
  )

  return {
    instance, events, definitions,
    loading, error, acting,
    status, isActive, isLocked, canAct,
    currentStep, requirements,
    start, act, refresh,
  }
}

export default useEntityWorkflow

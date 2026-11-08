import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAll'
import { listInspectionsForPage } from '../lib/api/inspections'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'

// The register and its exports must use the same complete, country-scoped read.
export default function useInspectionRegister({ country, createdBy, actorId, role, enabled = true }) {
  const latest = useLatestRequest()
  const scope = JSON.stringify([country ?? null, createdBy ?? null, actorId ?? null, role ?? null, enabled])
  const currentScope = useRef(scope)
  // `enabled` is false only while sign-in is still resolving, which is WAITING,
  // not finished: reporting loading:false there painted every tile as N/A / 0
  // for a beat before the real figures arrived. So disabled reads as loading.
  const [state, setState] = useState({ scope, rows: [], loading: true, error: null })
  // The rows currently on screen, read by reload() to decide a quiet refresh.
  const stateRef = useRef(state)
  stateRef.current = state
  useLayoutEffect(() => {
    currentScope.current = scope
    return () => {
      currentScope.current = null
      latest.cancel()
    }
  }, [scope, latest])
  const reload = useCallback(async () => {
    // An action started before a scope change may still hold the old reload.
    if (!enabled || currentScope.current !== scope) return
    const stale = latest.begin()
    // A refresh after an edit (meter correction, approval, delete) must NOT blank
    // the register: the page swapped itself for a full-screen "Loading", which
    // unmounted the table and the workspace, so the person landed back on page 1
    // with no vehicle selected. When this scope already has rows on screen they
    // stay up while the fresh read runs; only a first load or a scope change
    // shows the loading state.
    const shown = stateRef.current
    const quiet = shown.scope === scope && !shown.loading && shown.rows.length > 0
    if (!quiet) setState({ scope, rows: [], loading: true, error: null })
    try {
      const { data, error } = await fetchAllPages((from, to) =>
        listInspectionsForPage({ from, to, country, createdBy }), { max: 100000 })
      if (stale()) return
      setState({
        scope, rows: data || [], loading: false,
        error: error ? toUserMessage(error, 'Could not load every inspection.') : null,
      })
    } catch (error) {
      if (stale()) return
      // A failed background refresh keeps the rows already shown and says so.
      setState((prev) => (quiet && prev.scope === scope
        ? { ...prev, loading: false, error: toUserMessage(error, 'Could not refresh inspections.') }
        : { scope, rows: [], loading: false, error: toUserMessage(error, 'Could not load inspections.') }))
    }
  }, [country, createdBy, enabled, latest, scope])

  useEffect(() => {
    if (enabled) reload()
    else setState({ scope, rows: [], loading: true, error: null })
    return latest.cancel
  }, [reload, latest, enabled, scope])
  // Hide the previous scope immediately, including before effect cleanup runs.
  const current = state.scope === scope ? state : { rows: [], loading: true, error: null }
  return { ...current, reload }
}

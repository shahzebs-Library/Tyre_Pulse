import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyView,
  normalizeView,
  resolveColumns,
  toggleColumn,
  moveColumn,
  togglePin,
  setWidth as setViewWidth,
  isCustomised,
  DENSITIES,
  LIMITS,
} from '../../lib/registerViews'
import { loadView, saveView } from '../../lib/api/registerViews'

/**
 * useRegisterView — the seam between the pure saved-view engine
 * (`src/lib/registerViews.js`) and the shape TanStack Table wants.
 *
 * The engine owns the RULES (which column may be hidden, how a stored blob is
 * reconciled against a catalog that has since changed, what a corrupt width
 * clamps to). This hook owns only the plumbing: load once, translate both ways,
 * and write back on a debounce.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO, each because the failure is
 * silent and the user would blame the data rather than the layout:
 *
 * 1. IT NEVER BLOCKS THE TABLE ON THE NETWORK. `ready` starts false and the
 *    table renders its DEFAULT layout immediately. A register whose saved view
 *    is slow, or whose backing table is not provisioned, is fully usable; it
 *    just forgets the layout. Holding rows back behind a preference read would
 *    turn a cosmetic feature into an outage.
 *
 * 2. IT NEVER SAVES WHAT IT HAS NOT LOADED. `loadedRef` gates the first write.
 *    Without it, the mount-time default state would race the fetch and
 *    overwrite the operator's real saved layout with the defaults — the classic
 *    way a "remember my columns" feature silently eats the thing it remembers.
 *
 * 3. IT NEVER SURFACES A SAVE FAILURE AS AN ERROR STATE. Persistence is
 *    best-effort; `saveView` already resolves `{ok:false, reason}` rather than
 *    throwing. A red banner because a column width did not persist is worse
 *    than quietly forgetting it.
 */
export default function useRegisterView(viewKey, catalog, { enabled = true } = {}) {
  const active = !!(enabled && viewKey && catalog && catalog.length)

  const [view, setView] = useState(() => normalizeView(emptyView(viewKey || ''), catalog || []))
  const [ready, setReady] = useState(false)
  const loadedRef = useRef(false)
  const saveTimer = useRef(null)

  // Catalog identity changes on every render (it is derived from columns), so
  // key the effects on a STABLE signature instead or they re-run forever.
  const catalogSig = useMemo(
    () => (catalog || []).map((c) => `${c.key}:${c.defaultHidden ? 1 : 0}`).join('|'),
    [catalog]
  )

  // ── load once per (viewKey, catalog shape) ────────────────────────────────
  useEffect(() => {
    if (!active) { setReady(true); return }
    let cancelled = false
    loadedRef.current = false
    setReady(false)
    loadView(viewKey, catalog)
      .then((v) => {
        if (cancelled) return
        setView(normalizeView(v || emptyView(viewKey), catalog))
      })
      .catch(() => {
        // Already non-throwing by contract; this is belt-and-braces so a
        // future change to the service can never take a register down.
        if (!cancelled) setView(normalizeView(emptyView(viewKey), catalog))
      })
      .finally(() => {
        if (cancelled) return
        loadedRef.current = true
        setReady(true)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, catalogSig, active])

  // ── debounced write-back ──────────────────────────────────────────────────
  const persist = useCallback(
    (next) => {
      if (!active || !loadedRef.current) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        // Fire and forget: the service resolves {ok:false} instead of throwing.
        saveView(viewKey, next).catch(() => {})
      }, 600)
    },
    [active, viewKey]
  )

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const apply = useCallback(
    (producer) => {
      setView((prev) => {
        const next = normalizeView(producer(prev), catalog)
        persist(next)
        return next
      })
    },
    [catalog, persist]
  )

  // ── engine -> TanStack ────────────────────────────────────────────────────
  // `resolveColumns` returns only the VISIBLE columns (pinned first). That is
  // right for rendering a column list, but it is NOT the source for TanStack
  // state: `columnOrder` must name every column including the hidden ones, or
  // unhiding one later drops it to the end of the table instead of returning it
  // to where the operator left it.
  const resolved = useMemo(() => resolveColumns(view, catalog || []), [view, catalog])

  const tableState = useMemo(() => {
    const v = normalizeView(view, catalog || [])
    const pinnedSet = new Set(v.pinned)
    const columnOrder = [...v.pinned, ...v.columns.filter((k) => !pinnedSet.has(k))]

    const columnVisibility = {}
    for (const k of v.hidden) columnVisibility[k] = false

    const columnSizing = {}
    for (const [k, w] of Object.entries(v.widths || {})) columnSizing[k] = w

    // A pinned column that is also hidden must not be pinned in the table, or
    // TanStack reserves a sticky slot for a column that renders nothing.
    const hiddenSet = new Set(v.hidden)
    const left = v.pinned.filter((k) => !hiddenSet.has(k))

    return {
      columnOrder,
      columnVisibility,
      columnSizing,
      columnPinning: { left, right: [] },
      density: v.density || 'comfortable',
    }
  }, [view, catalog])

  // ── TanStack -> engine ────────────────────────────────────────────────────
  const onVisibilityChange = useCallback(
    (key) => apply((v) => toggleColumn(v, catalog, key)),
    [apply, catalog]
  )
  const onPinChange = useCallback(
    (key) => apply((v) => togglePin(v, catalog, key)),
    [apply, catalog]
  )
  const onWidthChange = useCallback(
    (key, width) => apply((v) => setViewWidth(v, catalog, key, width)),
    [apply, catalog]
  )
  const onMoveColumn = useCallback(
    (key, toIndex) => apply((v) => moveColumn(v, catalog, key, toIndex)),
    [apply, catalog]
  )
  const onDensityChange = useCallback(
    (density) =>
      apply((v) => ({ ...v, density: DENSITIES.includes(density) ? density : null })),
    [apply]
  )
  const reset = useCallback(
    () => apply(() => emptyView(viewKey || '')),
    [apply, viewKey]
  )

  const customised = useMemo(() => isCustomised(view, catalog || []), [view, catalog])

  return {
    active,
    ready,
    view,
    resolved,
    tableState,
    customised,
    limits: LIMITS,
    onVisibilityChange,
    onPinChange,
    onWidthChange,
    onMoveColumn,
    onDensityChange,
    reset,
  }
}

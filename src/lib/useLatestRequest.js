import { useRef, useCallback, useMemo } from 'react'

/**
 * Discard the answer to a question nobody is asking any more.
 *
 * A page whose filters trigger a refetch has a race that is invisible until it
 * bites: change the date range twice quickly and TWO loads are in flight. If the
 * first one finishes last, its setters run last, and the screen ends up showing
 * the OLD window's rows under the NEW window's filter chips. Nothing errors and
 * nothing looks broken - the numbers are simply wrong, and a refresh "fixes" it,
 * which is why this class of bug survives so long.
 *
 * Usage:
 *
 *   const latest = useLatestRequest()
 *   async function load() {
 *     const stale = latest.begin()
 *     setLoading(true)
 *     try {
 *       const res = await fetch(...)
 *       if (stale()) return          // a newer load has started; drop this one
 *       setRows(res.data)
 *     } finally {
 *       if (!stale()) setLoading(false)
 *     }
 *   }
 *
 * WHY A SEQUENCE AND NOT AbortController: aborting would be better for the
 * network, but every read here goes through the service layer, and threading a
 * signal through fetchAllPages and each service is a far larger change than the
 * bug warrants. This makes the RESULT harmless, which is the part the user sees.
 * A page that already has a real abort path should keep it.
 *
 * The unmount case is covered too: `cancel()` from an effect cleanup makes every
 * in-flight request stale, so nothing sets state on a component that is gone.
 */
export default function useLatestRequest() {
  const seqRef = useRef(0)

  // Claim the next sequence number. Returns a predicate that is true once some
  // LATER request has begun (or the caller unmounted).
  const begin = useCallback(() => {
    const mine = ++seqRef.current
    return () => mine !== seqRef.current
  }, [])

  // Invalidate everything in flight without starting anything new.
  const cancel = useCallback(() => { seqRef.current += 1 }, [])

  // Stable identity: callers put this in a useCallback/useEffect dependency
  // list, and a fresh object every render would defeat the memoisation they
  // added it for - turning a fix into a refetch loop.
  return useMemo(() => ({ begin, cancel }), [begin, cancel])
}

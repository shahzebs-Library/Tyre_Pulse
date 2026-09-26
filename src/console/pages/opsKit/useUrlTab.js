/**
 * useUrlTab - keep a page's active tab in the URL (?tab=...) so a deep link
 * opens the same view and Back returns to it.
 *
 * Deliberately built on window.history rather than react-router: several ops
 * pages are rendered outside a router in tests and inside one in the app, and a
 * router-only hook would crash the former. The router never reads this query
 * key, so writing it with replaceState does not fight navigation.
 *
 * An unknown value in the URL falls back to the default rather than rendering
 * an empty view. When the page unmounts on the SAME path (only happens in
 * tests or when the component is swapped in place) the key is removed, so a
 * stale tab never leaks into the next page that reads the same key.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

function readParam(param) {
  if (typeof window === 'undefined') return null
  try { return new URLSearchParams(window.location.search).get(param) } catch { return null }
}

function writeParam(param, value) {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (value == null || value === '') url.searchParams.delete(param)
    else url.searchParams.set(param, value)
    const next = `${url.pathname}${url.search}${url.hash}`
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next !== cur) window.history.replaceState(window.history.state, '', next)
  } catch { /* URL sync is a convenience; never break the page over it */ }
}

export default function useUrlTab(keys, fallback, param = 'tab') {
  const allowed = useRef(keys)
  allowed.current = keys
  const pick = (v) => (v && allowed.current.includes(v) ? v : fallback)
  const [tab, setTabState] = useState(() => pick(readParam(param)))

  const setTab = useCallback((next) => {
    const v = allowed.current.includes(next) ? next : fallback
    setTabState(v)
    writeParam(param, v === fallback ? null : v)
  }, [fallback, param])

  useEffect(() => {
    const mountPath = typeof window !== 'undefined' ? window.location.pathname : ''
    function onPop() { setTabState(pick(readParam(param))) }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.location.pathname === mountPath) writeParam(param, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param])

  return [tab, setTab]
}

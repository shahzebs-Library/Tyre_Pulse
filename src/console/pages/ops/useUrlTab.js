/**
 * useUrlTab - the active tab of a console page, mirrored into ?tab= so a tab
 * can be deep-linked, bookmarked and survives a refresh.
 *
 * It reads and writes window.location / window.history directly instead of
 * react-router's useSearchParams, so a page still renders when mounted outside
 * a router (the render tests do exactly that). history.replaceState keeps the
 * router's own history.state, so back/forward behaviour is untouched: a tab
 * switch is not a navigation and must not add a history entry.
 */
import { useCallback, useState } from 'react'

function readParam(name) {
  if (typeof window === 'undefined') return null
  try { return new URLSearchParams(window.location.search).get(name) } catch { return null }
}

export default function useUrlTab(keys, fallback, param = 'tab') {
  const valid = Array.isArray(keys) ? keys : []
  const [tab, setTabState] = useState(() => {
    const fromUrl = readParam(param)
    return fromUrl && valid.includes(fromUrl) ? fromUrl : fallback
  })
  const setTab = useCallback((next) => {
    if (!valid.includes(next)) return
    setTabState(next)
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      if (next === fallback) url.searchParams.delete(param)
      else url.searchParams.set(param, next)
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch { /* URL sync is a convenience; the tab still switches */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid.join('|'), fallback, param])
  return [tab, setTab]
}

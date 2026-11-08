import { useLayoutEffect } from 'react'

/**
 * The signed-in shells (main app, field shell, System Console) are exactly one
 * viewport tall and scroll INSIDE their own <main>. The document itself must
 * therefore never scroll. Before this, anything that ended up below the shell
 * in the document (a body portal, an offscreen helper, a stale popover) made
 * the whole window scrollable, so the page could be dragged past its content
 * into an empty grey band with the header scrolled out of view.
 *
 * While a shell is mounted we tag <html> and let CSS pin html/body/#root to
 * the viewport. Public pages (login, shared reports, data deletion) never mount
 * a shell, so they keep normal document scrolling. A counter makes nested or
 * overlapping mounts (route transitions) safe.
 */
const CLASS = 'tp-app-shell'
let mounted = 0

export default function useAppShellScrollLock() {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    mounted += 1
    root.classList.add(CLASS)
    // A window scrolled before the lock (the reported bug) stays offset even
    // after overflow is hidden, so reset it once.
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0)
    return () => {
      mounted = Math.max(0, mounted - 1)
      if (mounted === 0) root.classList.remove(CLASS)
    }
  }, [])
}

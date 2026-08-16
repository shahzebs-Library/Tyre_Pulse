/**
 * useScrollRestore - remembers where a long list was scrolled to, and puts it
 * back when the user returns from a record.
 *
 * WHY THIS IS NEEDED AT ALL: the browser restores scroll by itself on a back
 * navigation, but only for the element it scrolls - the document. This app
 * scrolls an inner `<main class="flex-1 overflow-y-auto">` in the shell, so the
 * document never moves and there is nothing for the browser to restore. The
 * hook therefore finds the page's own scrolling ancestor and saves/restores
 * that. It is deliberately tiny: no library, no observers, no smooth-scrolling.
 *
 * Usage:
 *   const listRef = useScrollRestore('fleet-master', !loading && rows.length > 0)
 *   ...
 *   <div ref={listRef}>...the list...</div>
 *
 * The second argument is the READY flag and it is load-bearing: restoring
 * before the rows exist would scroll a short page and land at the top anyway,
 * which reads as "it forgot". Pass a condition that is true only once the list
 * has real height.
 *
 * A page whose list scrolls inside its OWN box (a virtualised table with a fixed
 * height) passes that element as the third argument, because the thing the user
 * scrolled is that box and not the shell:
 *   useScrollRestore('inspections', ready, tableParentRef)
 *
 * Position is kept in sessionStorage, so it is per tab and is discarded when the
 * tab closes. A failure to read or write it is never fatal - the page simply
 * opens at the top, exactly as it does today.
 */
import { useEffect, useRef, useCallback } from 'react'

const KEY_PREFIX = 'tp.scroll.'

/** Nearest ancestor that actually scrolls; null when nothing does. */
function scrollingAncestor(node) {
  let el = node?.parentElement
  while (el && el !== document.body) {
    const overflowY = window.getComputedStyle(el).overflowY
    if (/(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight + 1) return el
    el = el.parentElement
  }
  return null
}

function readSaved(key) {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + key)
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function writeSaved(key, value) {
  try {
    sessionStorage.setItem(KEY_PREFIX + key, String(Math.round(value)))
  } catch {
    /* private mode / quota - position is a convenience, never a failure */
  }
}

export function useScrollRestore(key, ready, targetRef = null) {
  const anchorRef = useRef(null)
  // Restore happens once per mount. Without this a later re-render (a filter
  // change, a refetch) would yank the user back to where they were before.
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!ready || typeof window === 'undefined') return
    const el = targetRef ? targetRef.current : scrollingAncestor(anchorRef.current)
    if (!el) return

    if (!restoredRef.current) {
      restoredRef.current = true
      const saved = readSaved(key)
      if (saved > 0) {
        // One frame later, so the list has been laid out and the target
        // position is reachable rather than clamped to a shorter page.
        requestAnimationFrame(() => {
          el.scrollTop = Math.min(saved, Math.max(0, el.scrollHeight - el.clientHeight))
        })
      }
    }

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        writeSaved(key, el.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, ready, targetRef])

  return anchorRef
}

/**
 * Clears a saved position. Use when the list has been deliberately re-pointed
 * (a filter reset), where returning to row 400 would be disorienting.
 */
export function useClearScrollRestore(key) {
  return useCallback(() => {
    try {
      sessionStorage.removeItem(KEY_PREFIX + key)
    } catch {
      /* nothing to clear */
    }
  }, [key])
}

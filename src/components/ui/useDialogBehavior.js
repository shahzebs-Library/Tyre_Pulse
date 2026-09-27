import { useEffect, useRef } from 'react'

/**
 * The behaviour every dialog is expected to have, in one place.
 *
 * Escape closes, focus moves into the panel and cannot tab out of it, the page
 * behind stops scrolling, and focus returns to whatever opened the dialog. It
 * was previously re-implemented per file, so some dialogs had all of it, some
 * had Escape only, and some had none.
 *
 * WHY `onClose` IS HELD IN A REF AND KEPT OUT OF THE DEPENDENCY ARRAY.
 * It used to sit in the deps. Almost every caller passes an inline arrow, which
 * is a new function identity on every parent render, so the effect tore down
 * and re-ran constantly. That is not merely wasteful: the CLEANUP restores
 * focus to whatever opened the dialog, and the re-run then focuses the panel.
 * So for any dialog whose form state lives in the PAGE rather than in a child,
 * every single keystroke yanked focus out of the field being typed into and the
 * dialog was effectively unusable. It was reported independently from two
 * different pages before the cause was found.
 *
 * Holding the callback in a ref means the latest one is always invoked while
 * the effect runs exactly once per open/close. Callers therefore do NOT need to
 * wrap `onClose` in useCallback — passing an inline arrow is safe.
 *
 * @param {boolean} open
 * @param {object}  panelRef  ref to the dialog panel element
 * @param {() => void} onClose
 */
// Every open dialog registers here, newest last. Only the TOPMOST one answers
// Escape and Tab. Without this a dialog opened on top of a drawer (a reject
// reason over a request rail, say) meant one Escape closed BOTH, and the two
// focus traps fought over every Tab press. An entry whose panel has left the
// document is skipped, so a dialog that failed to clean up can never leave a
// ghost on top that swallows every later key.
const openStack = []

function isTopmost(entry) {
  for (let i = openStack.length - 1; i >= 0; i -= 1) {
    const candidate = openStack[i]
    const node = candidate.panelRef.current
    if (node && node.isConnected === false) continue
    return candidate === entry
  }
  return true
}

export default function useDialogBehavior(open, panelRef, onClose) {
  // Kept current on every render; read only from inside the key handler.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const entry = { panelRef }
    openStack.push(entry)

    const previouslyFocused = document.activeElement
    const body = document.body
    const priorOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    // Focus the panel, not its first control: landing on a destructive button
    // by default is how people delete things by accident.
    panelRef.current?.focus?.()

    function focusables() {
      const nodes = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      return Array.from(nodes || []).filter((el) => el.offsetParent !== null)
    }

    function onKey(e) {
      if (!isTopmost(entry)) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const at = openStack.indexOf(entry)
      if (at !== -1) openStack.splice(at, 1)
      body.style.overflow = priorOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus?.()
    }
    // `onClose` is deliberately NOT a dependency — see the note above. Adding
    // it back makes every dialog with page-level form state untypeable.
  }, [open, panelRef])
}

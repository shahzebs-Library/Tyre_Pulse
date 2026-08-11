import { useEffect } from 'react'

/**
 * The behaviour every dialog is expected to have, in one place.
 *
 * Escape closes, focus moves into the panel and cannot tab out of it, the page
 * behind stops scrolling, and focus returns to whatever opened the dialog. It
 * was previously re-implemented per file, so some dialogs had all of it, some
 * had Escape only, and some had none.
 *
 * @param {boolean} open
 * @param {object}  panelRef  ref to the dialog panel element
 * @param {() => void} onClose
 */
export default function useDialogBehavior(open, panelRef, onClose) {
  useEffect(() => {
    if (!open) return

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
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
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
      body.style.overflow = priorOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus?.()
    }
  }, [open, panelRef, onClose])
}

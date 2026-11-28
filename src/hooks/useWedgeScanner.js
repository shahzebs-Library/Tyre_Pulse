import { useEffect, useRef } from 'react'
import { createWedgeDetector } from '../lib/wedgeScanner'

/**
 * Listen for a USB / keyboard-wedge scanner anywhere on the page while
 * `enabled` (admins only for now). When the focus is inside a text field the
 * scanner already types into it, so only scans made with no field focused are
 * routed to `onScan`.
 */
export default function useWedgeScanner(onScan, { enabled = true } = {}) {
  const ref = useRef(onScan)
  useEffect(() => { ref.current = onScan }, [onScan])
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined
    const detect = createWedgeDetector({ onScan: (code) => ref.current?.(code) })
    const handler = (e) => {
      const t = e.target
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (detect(e)) e.preventDefault()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [enabled])
}

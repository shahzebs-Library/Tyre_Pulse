import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Anchor a portalled popover to a trigger element.
 *
 * Dropdowns rendered as `absolute` children are clipped whenever they sit
 * inside `.card`, which sets overflow:hidden for its accent hairline. The menu
 * then looks missing rather than broken, which is worse. Portalling to the body
 * escapes the clip, and the cost of that is having to position by hand, which
 * is what this hook does. Same approach DateField already proved out.
 *
 * Returns coords in viewport space, so the consumer renders with
 * `position: fixed` (see the `.tp-popover` class).
 *
 * @param {boolean} open        whether the popover is showing
 * @param {object}  opts
 * @param {number}  opts.width  popover width in px, used for the flip maths
 * @param {number}  opts.height estimated popover height in px
 * @param {'left'|'right'} opts.align  which trigger edge the popover lines up with
 */
export default function useAnchoredPopover(open, { width = 224, height = 280, align = 'right' } = {}) {
  const triggerRef = useRef(null)
  const [coords, setCoords] = useState(null)

  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Line up with the requested edge, then pull back inside the viewport. A
    // menu half off the screen is the bug this whole hook exists to avoid.
    let left = align === 'right' ? r.right - width : r.left
    left = Math.min(Math.max(8, left), Math.max(8, vw - width - 8))

    // Prefer below the trigger; flip above only when there is genuinely more
    // room there, otherwise a short menu near the bottom jumps for no reason.
    const below = vh - r.bottom - 8
    const above = r.top - 8
    const flip = height > below && above > below
    const top = flip ? Math.max(8, r.top - Math.min(height, above) - 6) : r.bottom + 6

    setCoords({ top, left, maxHeight: Math.max(160, (flip ? above : below) - 6) })
  }, [align, width, height])

  /**
   * Give focus back to the trigger when the popover closes.
   *
   * The popover is portalled to the body, so whatever was focused inside it is
   * removed from the document on close and focus falls to <body>. A keyboard or
   * screen-reader user is then stranded at the top of the page, having to tab
   * all the way back to where they were - WCAG 2.4.3, and the reason this lives
   * in the hook rather than in each of the five menus that use it.
   *
   * It only reclaims ORPHANED focus. If the user closed the menu by clicking or
   * tabbing to something else, that element holds focus and is left alone;
   * pulling focus off it would be its own bug.
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) { wasOpen.current = true; return }
    if (!wasOpen.current) return
    wasOpen.current = false
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (active && active !== document.body) return
    triggerRef.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) { setCoords(null); return }
    reposition()
    const onMove = () => reposition()
    // Capture phase so scrolling any ancestor container moves the popover too.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, reposition])

  return { triggerRef, coords, reposition }
}

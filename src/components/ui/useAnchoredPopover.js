import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Anchor a portalled popover to a trigger element, and give it the keyboard
 * behaviour its ARIA role promises.
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
 * Five shell menus use this hook. Anything true of all five - focus return,
 * arrow-key navigation, RTL mirroring - belongs HERE rather than copied five
 * times, because five copies drift and the drift shows up as one menu behaving
 * differently from its neighbour.
 *
 * @param {boolean} open        whether the popover is showing
 * @param {object}  opts
 * @param {number}  opts.width  popover width in px, used for the flip maths
 * @param {number}  opts.height estimated popover height in px
 * @param {'left'|'right'} opts.align  which trigger edge the popover lines up
 *   with IN A LEFT-TO-RIGHT READING DIRECTION. Mirrored automatically under RTL.
 * @param {'menu'|'trap'|'none'} opts.nav  keyboard model for the panel:
 *   'menu' for role=menu (arrow keys, Home/End, Tab closes),
 *   'trap' for role=dialog (Tab cycles inside the panel),
 *   'none' to leave keyboard handling entirely to the consumer.
 * @param {Function} opts.onRequestClose  called when the keyboard model needs the
 *   popover closed (Tab out of a menu). Required for nav:'menu'.
 */

/* Everything a browser will let a user Tab to. Used by the dialog trap, which
   has to cycle a search box and a tree of buttons, not just menu items. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/* Menu navigation walks the ITEMS, not every focusable node, so a decorative
   control could never land in the arrow-key order.
   `:not([disabled])` excludes nothing today and is kept for a future item that
   really is disabled: a disabled button cannot take focus, so including one
   would produce an arrow press that appears to do nothing. The reporting scope
   menu USED to disable its last remaining country and now marks it
   aria-disabled instead, precisely so it stays discoverable and reachable by
   arrow - an item the user must be able to find in order to learn why it will
   not turn off. */
const MENU_ITEMS = ['[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]']
  .map((s) => `${s}:not([disabled])`)
  .join(',')

/**
 * Is this element laid out right to left?
 *
 * Read the nearest explicit `dir` first and fall back to the computed style.
 * LanguageContext sets `dir` on <html>, and reading the attribute directly is
 * also the only reading that works under jsdom, where the attribute does not
 * feed into getComputedStyle.
 */
function isRtlContext(el) {
  if (typeof document === 'undefined') return false
  const scoped = typeof el?.closest === 'function' ? el.closest('[dir]') : null
  const attr = scoped?.getAttribute('dir') || document.documentElement.getAttribute('dir')
  if (attr) return attr.toLowerCase() === 'rtl'
  try {
    return window.getComputedStyle(document.documentElement).direction === 'rtl'
  } catch {
    return false
  }
}

export default function useAnchoredPopover(
  open,
  { width = 224, height = 280, align = 'right', nav = 'none', onRequestClose } = {},
) {
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const [coords, setCoords] = useState(null)

  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Mirror the requested edge under RTL. The bar itself mirrors, because
    // flexbox follows `dir`, so the control cluster that sat at the right of the
    // screen in English sits at the left in Arabic. A menu that kept hugging the
    // physical right edge would open AWAY from its trigger, across the bar.
    const edge = isRtlContext(el) ? (align === 'right' ? 'left' : 'right') : align

    // Line up with that edge, then pull back inside the viewport. A menu half
    // off the screen is the bug this whole hook exists to avoid.
    let left = edge === 'right' ? r.right - width : r.left
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

  /**
   * Move focus INTO the panel once it exists.
   *
   * Without this a keyboard user opens the menu and the next Tab walks the page
   * behind it, so the menu they just opened is unreachable and the panel is only
   * escapable by guesswork. Depends on `coords` because the consumer renders the
   * panel only once coords resolve, so that is the commit where panelRef is set.
   *
   * Never steals focus that is already inside the panel, which keeps this a
   * no-op on the repositions that scrolling fires.
   */
  useEffect(() => {
    if (!open || nav === 'none' || !coords) return
    const panel = panelRef.current
    if (!panel || panel.contains(document.activeElement)) return
    panel.querySelector(nav === 'menu' ? MENU_ITEMS : FOCUSABLE)?.focus?.()
  }, [open, nav, coords])

  // Held in a ref so an inline arrow function from the consumer does not
  // resubscribe the key listener on every render.
  const closeRef = useRef(onRequestClose)
  useEffect(() => { closeRef.current = onRequestClose })

  /**
   * Keyboard model for the panel.
   *
   * role=menu PROMISES arrow-key navigation to anyone using a screen reader; a
   * menu that only answers Tab is announced as a menu and then does not behave
   * like one. role=dialog promises focus stays inside it until it is dismissed.
   *
   * The listener is on the document but acts only on events raised INSIDE the
   * panel, so it can never swallow an arrow key or a Tab meant for the page.
   * Escape stays with the consumers, which already close on it.
   */
  useEffect(() => {
    if (!open || nav === 'none') return undefined

    function onKey(e) {
      const panel = panelRef.current
      if (!panel || !panel.contains(e.target)) return

      const items = Array.from(panel.querySelectorAll(nav === 'menu' ? MENU_ITEMS : FOCUSABLE))
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement)

      if (nav === 'menu') {
        // Enter and Space are deliberately not handled: these items are real
        // <button>s, so the browser already activates them.
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          items[at < 0 ? 0 : (at + 1) % items.length].focus()
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          items[at <= 0 ? items.length - 1 : at - 1].focus()
        } else if (e.key === 'Home') {
          e.preventDefault()
          items[0].focus()
        } else if (e.key === 'End') {
          e.preventDefault()
          items[items.length - 1].focus()
        } else if (e.key === 'Tab') {
          // Tab leaves a menu rather than walking it. Close, and hand focus back
          // to the trigger so the user's next Tab carries on from where the menu
          // was instead of restarting at the top of the document.
          e.preventDefault()
          closeRef.current?.()
          triggerRef.current?.focus?.()
        }
        return
      }

      // Dialog: keep Tab inside the panel until it is dismissed.
      if (e.key !== 'Tab') return
      e.preventDefault()
      const next = e.shiftKey
        ? items[at <= 0 ? items.length - 1 : at - 1]
        : items[at < 0 || at === items.length - 1 ? 0 : at + 1]
      next?.focus?.()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, nav])

  return { triggerRef, panelRef, coords, reposition }
}

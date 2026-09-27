import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useDialogBehavior from './useDialogBehavior'

/**
 * The one side-drawer shell for the app: Modal's full-height sibling.
 *
 * A drawer is a different layout from a dialog, not a different size of one.
 * Modal centres a box capped at 92dvh; a record rail (a work order, a repair
 * request, a purchase order) has to run the full height of the screen against
 * one edge so the page it came from stays visible beside it. That is why these
 * rails were hand rolled per page, each with its own subset of the behaviour:
 * some trapped focus, some did not; some closed on Escape while a nested
 * dialog was open, closing both.
 *
 * Behaviour is shared with Modal through `useDialogBehavior` (portal to body,
 * Escape, focus trap, scroll lock, focus return, topmost-only key handling).
 * On top of that:
 *
 *   - `busy` locks dismissal. While a save is in flight, Escape, the backdrop
 *     and the close button do nothing, so a half written record cannot be
 *     abandoned mid request.
 *   - `side` is LOGICAL. `end` (the default) is the right edge in English and
 *     the left edge in Arabic; `start` is the opposite. `data-edge` carries the
 *     resolved physical edge so the slide-in animation comes from the right way.
 *   - Only the body scrolls; the header (title, close) and the optional footer
 *     stay reachable however long the record is.
 *   - The panel keeps the `.tp-drawer-panel` class, so the large-display width
 *     ladder in index.css (pinned by dialogFit.test.jsx) still applies.
 *
 * Widths are intent: sm a short rail, md the classic 480px record rail, lg a
 * wider rail, xl a rail that hosts tables. Phones always get the full width.
 *
 * Props:
 *   open            boolean
 *   onClose         () => void
 *   title           node
 *   subtitle        node
 *   headerExtra     node      controls beside the title
 *   footer          node      pinned action row
 *   size            'sm'|'md'|'lg'|'xl'   default 'md'
 *   side            'end'|'start'         default 'end'
 *   busy            boolean   blocks every dismissal path while true
 *   closeOnBackdrop boolean   default true
 *   closeLabel      string    accessible name of the close button
 *   labelledBy      string    id of an external heading, when title is not used
 */
export default function SideDrawer({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  footer,
  children,
  size = 'md',
  side = 'end',
  busy = false,
  closeOnBackdrop = true,
  closeLabel = 'Close',
  className = '',
  bodyClassName = '',
  labelledBy,
}) {
  const panelRef = useRef(null)
  const titleId = useRef(`tp-drawer-${Math.random().toString(36).slice(2, 9)}`).current

  // Every dismissal path goes through here, so `busy` cannot be bypassed by
  // the one path somebody forgot.
  const requestClose = () => { if (!busy) onClose?.() }

  useDialogBehavior(open, panelRef, requestClose)

  if (!open) return null

  const edge = resolveEdge(side)

  const drawer = (
    <div
      className={`tp-drawer-overlay tp-drawer-overlay--${side === 'start' ? 'start' : 'end'}`}
      data-edge={edge}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`tp-drawer-panel tp-drawer-shell tp-drawer-shell--${size} ${className}`}
      >
        {(title || onClose || headerExtra) && (
          <header className="tp-drawer-head">
            <div className="flex-1 min-w-0">
              {title && (
                <h2 id={titleId} className="text-base sm:text-lg font-semibold break-words" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </h2>
              )}
              {subtitle && (
                <div className="text-sm mt-0.5 break-words" style={{ color: 'var(--text-secondary)' }}>{subtitle}</div>
              )}
            </div>
            {headerExtra}
            {onClose && (
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                aria-label={closeLabel}
                className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </header>
        )}

        <div className={`tp-drawer-body ${bodyClassName}`}>{children}</div>

        {footer && <footer className="tp-drawer-foot">{footer}</footer>}
      </div>
    </div>
  )

  // Portalled so a drawer opened from inside `.card` (overflow:hidden) or a
  // transformed ancestor is never clipped or mis-positioned.
  return createPortal(drawer, document.body)
}

/**
 * The physical edge a logical side lands on. Read from the document direction
 * at render, which LanguageContext sets on <html> when the language changes.
 */
export function resolveEdge(side, dir) {
  const direction = dir
    || (typeof document !== 'undefined' ? (document.documentElement.getAttribute('dir') || document.dir || 'ltr') : 'ltr')
  const rtl = String(direction).toLowerCase() === 'rtl'
  const atEnd = side !== 'start'
  if (atEnd) return rtl ? 'left' : 'right'
  return rtl ? 'right' : 'left'
}

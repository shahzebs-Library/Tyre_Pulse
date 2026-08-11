import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useDialogBehavior from './useDialogBehavior'

/**
 * The one dialog shell for the app.
 *
 * Every screen used to hand roll its own overlay, which is how dialogs drifted
 * into small fixed boxes that cut their content off on a large display and
 * pushed their own buttons off a phone. This shell sizes from the viewport
 * instead: the panel grows with the screen, the body is the only thing that
 * scrolls, and the header and footer stay where a user can reach them.
 *
 * Behaviour that used to be per file and inconsistent lives here once: Escape
 * closes, a click on the backdrop closes, focus moves into the dialog and is
 * trapped while it is open, and the page behind it cannot scroll.
 *
 * Sizes are intent, not pixels: sm confirm, md form, lg detail, xl data heavy,
 * full for a workspace. Each one widens at large breakpoints (see index.css).
 *
 * Props:
 *   open        boolean            render nothing when false
 *   onClose     () => void         called by Escape, backdrop and the X
 *   title       node               heading text
 *   subtitle    node               optional line under the heading
 *   size        'sm'|'md'|'lg'|'xl'|'full'
 *   footer      node               pinned action row
 *   headerExtra node               controls that belong beside the title
 *   closeOnBackdrop boolean        default true
 *   labelledBy  string             id of an external heading, when title is not used
 */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  headerExtra,
  children,
  closeOnBackdrop = true,
  className = '',
  bodyClassName = '',
  labelledBy,
}) {
  const panelRef = useRef(null)
  const titleId = useRef(`tp-dialog-${Math.random().toString(36).slice(2, 9)}`).current

  useDialogBehavior(open, panelRef, onClose)

  if (!open) return null

  const dialog = (
    <div
      className="tp-dialog-overlay"
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        tabIndex={-1}
        className={`tp-dialog-panel tp-dialog-panel--${size} ${className}`}
      >
        {(title || onClose) && (
          <header className="tp-dialog-head">
            <div className="flex-1 min-w-0">
              {title && (
                <h2 id={titleId} className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
              )}
            </div>
            {headerExtra}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X size={18} />
              </button>
            )}
          </header>
        )}

        <div className={`tp-dialog-body ${bodyClassName}`}>{children}</div>

        {footer && <footer className="tp-dialog-foot">{footer}</footer>}
      </div>
    </div>
  )

  // Portalled so a dialog opened from inside `.card` (overflow:hidden) or any
  // transformed ancestor is never clipped or mis-positioned.
  return createPortal(dialog, document.body)
}

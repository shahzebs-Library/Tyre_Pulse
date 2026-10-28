import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import useAnchoredPopover from '../ui/useAnchoredPopover'

/**
 * Dropdown for the Vehicle 360 header and tab row. Portalled to the body so no
 * card can clip it; the panel carries `cc` so it reads the same tokens as the
 * page in light and dark. Keyboard: arrows/Home/End, Escape returns focus.
 */
export default function V360Menu({ label, trigger, triggerClass = 'cc-btn-ghost', width = 220, align = 'right', disabled, selected, children }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, {
    width, height: 280, align, nav: 'menu', onRequestClose: close,
  })
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus?.() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, panelRef, triggerRef])
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        aria-selected={selected}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && coords && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          className="cc v360-pop"
          style={{ top: coords.top, left: coords.left, width, maxHeight: coords.maxHeight }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  )
}

export function V360MenuItem({ icon: Icon, children, onClick, disabled }) {
  const body = <>{Icon && <Icon size={14} aria-hidden="true" />}<span>{children}</span></>
  return (
    <button type="button" role="menuitem" className="v360-pop-item" onClick={onClick} disabled={disabled}>{body}</button>
  )
}

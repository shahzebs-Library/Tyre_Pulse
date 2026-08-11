import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import useAnchoredPopover from './useAnchoredPopover'

/**
 * ActionMenu - a single button that opens a small dropdown of actions.
 *
 * Used to declutter clusters of report/export buttons into one menu. Accessible
 * (role="menu", aria-expanded, closes on outside click + Escape) and theme-aware
 * via CSS vars so it reads in both light and dark mode.
 *
 * Props:
 *   label     string            button text
 *   icon      lucide component   optional leading icon on the button
 *   items     Array<{ label, icon?, onClick, disabled?, danger?, title? }>
 *   disabled  boolean           disables the whole menu button
 *   busy      boolean           shows the button as working (spinner + label)
 *   busyLabel string            label to show while busy
 *   align     'left' | 'right'  menu alignment (default 'right')
 *   variant   'secondary' | 'primary'  button styling (default 'secondary')
 *   className extra classes on the trigger button
 */
export default function ActionMenu({
  label,
  icon: Icon,
  items = [],
  disabled = false,
  busy = false,
  busyLabel,
  align = 'right',
  variant = 'secondary',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const popRef = useRef(null)
  // Portalled out of the trigger, so it survives `.card`'s overflow:hidden.
  const { triggerRef, coords } = useAnchoredPopover(open, { width: 224, height: 280, align })

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visibleItems = items.filter(Boolean)

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && !busy && setOpen((o) => !o)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50 ${className}`}
      >
        {busy ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
            {busyLabel || label}
          </>
        ) : (
          <>
            {Icon && <Icon size={14} />}
            {label}
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          role="menu"
          className="tp-popover min-w-52 p-1.5"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          {visibleItems.map((item, i) => {
            const ItemIcon = item.icon
            return (
              <button
                key={item.label ? `${item.label}-${i}` : i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  item.onClick?.()
                }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  item.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)]'
                }`}
              >
                {ItemIcon && <ItemIcon size={15} className="shrink-0" />}
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}

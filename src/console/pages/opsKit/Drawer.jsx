/**
 * Drawer - row detail that slides in from the right instead of expanding
 * inline, so the list keeps its place and length. Same dialog behaviour as the
 * kit Modal (Escape, focus trap, focus return).
 */
import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useDialogBehavior from '../../../components/ui/useDialogBehavior'

export default function Drawer({ open, title, subtitle, onClose, children, footer, width = 'max-w-xl' }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogBehavior(open, panelRef, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 console-root"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`w-full ${width} h-full flex flex-col bg-gray-950 border-l border-gray-800 shadow-2xl`}>
        <header className="flex items-start gap-3 px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 id={titleId} className="text-sm font-semibold text-gray-200 break-words">{title}</h3>
            {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close"
            className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

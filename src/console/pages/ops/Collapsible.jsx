/**
 * Collapsible - a rarely used panel, closed by default. The header is a real
 * button carrying aria-expanded so keyboard and screen-reader users get the
 * same disclosure as a mouse user.
 */
import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Collapsible({ icon: Icon, title, subtitle, defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="bg-gray-900/50 border border-gray-800 rounded-xl">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-3 p-4 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
        {Icon && <Icon size={16} className="text-orange-400 mt-0.5 shrink-0" aria-hidden="true" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-200">{title}</span>
          {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
        </span>
        {badge}
        <ChevronDown size={14} aria-hidden="true" className={`text-gray-500 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id={id} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/**
 * Collapsible - a panel that stays closed until asked for. For content that is
 * useful now and then (probe detail, explanations, rarely used tools) so it
 * does not push the everyday content down the page.
 */
import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Collapsible({ title, subtitle, icon: Icon, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="bg-gray-900/50 border border-gray-800 rounded-xl">
      <h2 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 hover:bg-gray-900/60">
          {Icon && <Icon size={16} className="text-orange-400 shrink-0" aria-hidden="true" />}
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-gray-200">{title}</span>
            {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
          {badge}
          <ChevronDown size={14} aria-hidden="true" className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </h2>
      {open && <div id={id} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

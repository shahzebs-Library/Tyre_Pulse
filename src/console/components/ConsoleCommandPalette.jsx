import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CONSOLE_DESCRIPTIONS } from '../../lib/platformMap'

export function buildConsoleCommands(groups) {
  return (groups || []).flatMap((group) => (group.items || []).map((item) => ({
    ...item,
    group: group.label,
    description: CONSOLE_DESCRIPTIONS[item.to] || '',
  })))
}

export function filterConsoleCommands(commands, value) {
  const q = String(value || '').trim().toLowerCase()
  if (!q) return commands
  const terms = q.split(/\s+/).filter(Boolean)
  return commands.filter((item) => {
    const haystack = `${item.label} ${item.group} ${item.description}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export default function ConsoleCommandPalette({ open, onClose, groups }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const commands = useMemo(() => buildConsoleCommands(groups), [groups])
  const visible = useMemo(() => filterConsoleCommands(commands, query), [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
    const close = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, onClose])

  if (!open) return null

  function run(to) {
    navigate(to)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-[10vh] backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Super Admin command palette" onMouseDown={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-orange-500/30 bg-gray-950 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-gray-800 px-4">
          <Search size={17} className="text-orange-400" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && visible[0]) run(visible[0].to)
            }}
            className="h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
            placeholder={`Search ${commands.length} console capabilities...`} />
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:text-white" aria-label="Close command palette">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-gray-500">No capability matches your search.</p>
          ) : visible.map((item) => {
            const Icon = item.icon || Command
            return (
              <button key={item.to} type="button" onClick={() => run(item.to)}
                className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-orange-950/30 focus:bg-orange-950/30 focus:outline-none">
                <span className="mt-0.5 rounded-lg border border-gray-800 bg-gray-900 p-2 text-orange-400"><Icon size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-100">{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-600">{item.group}</span>
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-xs text-gray-500">{item.description}</span>
                </span>
                <span className="mt-2 text-[10px] text-gray-700 group-hover:text-orange-400">Open</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-gray-800 px-4 py-2 text-[10px] text-gray-600">
          <span>Enter opens the first result · Esc closes</span>
          <span>Super Admin · audited routes</span>
        </div>
      </div>
    </div>
  )
}

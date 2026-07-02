import { useState } from 'react'
import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import { formatCurrency } from '../lib/formatters'
import { useSettings } from '../contexts/SettingsContext'

/**
 * CustomFieldsPanel — renders the extra headings an imported row carried but
 * that have no dedicated column (stored in `custom_data` / `extra_fields`).
 * Nothing is invented; it only displays what the source file provided. Scalars
 * become a labelled grid; arrays (e.g. Work Order line items) are summarised
 * with a count. Keys are humanised and the intake's `__unmapped` suffix stripped.
 *
 * @param {object}  data     The jsonb object (custom_data or extra_fields).
 * @param {string} [title]   Section heading.
 * @param {boolean}[defaultOpen]
 */

const COST_KEY_RE = /cost|amount|price|value|spend|total|charge|rate|budget/i
const humanize = (k) =>
  String(k)
    .replace(/__unmapped$/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())

function renderValue(key, val, currency) {
  if (val == null || val === '') return '—'
  if (Array.isArray(val)) return `${val.length} item${val.length !== 1 ? 's' : ''}`
  if (typeof val === 'object') return JSON.stringify(val)
  const num = typeof val === 'number' ? val : Number(String(val).replace(/,/g, ''))
  if (Number.isFinite(num) && String(val).trim() !== '') {
    if (COST_KEY_RE.test(key)) return formatCurrency(num, currency)
    return num.toLocaleString('en-US')
  }
  return String(val)
}

export default function CustomFieldsPanel({ data, title = 'Additional imported fields', defaultOpen = false }) {
  const { activeCurrency } = useSettings()
  const [open, setOpen] = useState(defaultOpen)

  const obj = data && typeof data === 'object' && !Array.isArray(data) ? data : null
  const entries = obj ? Object.entries(obj).filter(([k]) => k !== 'line_items') : []
  const lineItems = Array.isArray(obj?.line_items) ? obj.line_items : null
  if (!entries.length && !lineItems) return null

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-800/40 hover:bg-gray-800/70 transition-colors text-left"
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <Database size={13} className="text-sky-400" />
        <span className="text-sm font-medium text-gray-200">{title}</span>
        <span className="ml-auto text-xs text-gray-500">
          {entries.length}{lineItems ? ` · ${lineItems.length} line items` : ''}
        </span>
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {entries.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
              {entries.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{humanize(k)}</p>
                  <p className={`text-sm truncate ${COST_KEY_RE.test(k) ? 'text-emerald-300 font-semibold' : 'text-gray-200'}`}>
                    {renderValue(k, v, activeCurrency)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {lineItems && lineItems.length > 0 && (
            <div className="overflow-x-auto border border-gray-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/60 text-gray-400">
                  <tr>
                    {Object.keys(lineItems[0]).slice(0, 8).map((h) => (
                      <th key={h} className="text-left px-3 py-1.5 font-medium whitespace-nowrap">{humanize(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((row, i) => (
                    <tr key={i} className="border-t border-gray-800/60">
                      {Object.keys(lineItems[0]).slice(0, 8).map((h) => (
                        <td key={h} className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{row?.[h] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

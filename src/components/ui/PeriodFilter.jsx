import { useMemo, useState } from 'react'
import { Calendar, ChevronDown, X } from 'lucide-react'

/**
 * PeriodFilter — universal, data-aware period selection for analytics pages.
 *
 *   · "All time"            — no date filtering (default)
 *   · Year dropdown         — years derived from the RECORDS' own dates (so a
 *                             tenant on 2020-21 history sees 2020/2021, never an
 *                             empty "this year")
 *   · Custom range          — from/to calendar inputs bounded to the data's
 *                             min/max dates, with a one-click clear
 *
 * value: { mode: 'all' } | { mode: 'year', year: 2021 } | { mode: 'custom', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * Pair with `filterByPeriodValue(records, value, dateField)` for client-side
 * filtering, and `periodLabel(value)` for export/report titles.
 */
export default function PeriodFilter({ records = [], dateField = 'issue_date', value, onChange, className = '' }) {
  const v = value || { mode: 'all' }
  const [openCustom, setOpenCustom] = useState(v.mode === 'custom')

  const { years, minDate, maxDate } = useMemo(() => {
    const ys = new Set()
    let min = null, max = null
    for (const r of records) {
      const d = r?.[dateField]
      if (!d) continue
      const iso = String(d).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) continue
      ys.add(Number(iso.slice(0, 4)))
      if (!min || iso < min) min = iso
      if (!max || iso > max) max = iso
    }
    return { years: [...ys].sort((a, b) => b - a), minDate: min, maxDate: max }
  }, [records, dateField])

  function selectPreset(e) {
    const val = e.target.value
    if (val === 'all') { setOpenCustom(false); onChange({ mode: 'all' }) }
    else if (val === 'custom') { setOpenCustom(true); onChange({ mode: 'custom', from: minDate || '', to: maxDate || '' }) }
    else { setOpenCustom(false); onChange({ mode: 'year', year: Number(val) }) }
  }

  const selectValue = v.mode === 'year' ? String(v.year) : v.mode

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="relative">
        <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <select
          value={selectValue}
          onChange={selectPreset}
          className="appearance-none bg-gray-900 border border-gray-700 hover:border-gray-500 rounded-lg pl-8 pr-8 py-1.5 text-sm text-gray-200 cursor-pointer"
          title="Period"
        >
          <option value="all">All time{minDate ? ` (${minDate.slice(0, 4)} to ${(maxDate || '').slice(0, 4)})` : ''}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
          <option value="custom">Custom range…</option>
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      </div>

      {openCustom && v.mode === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date" value={v.from || ''} min={minDate || undefined} max={v.to || maxDate || undefined}
            onChange={(e) => onChange({ ...v, from: e.target.value })}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200"
          />
          <span className="text-gray-500 text-xs">→</span>
          <input
            type="date" value={v.to || ''} min={v.from || minDate || undefined} max={maxDate || undefined}
            onChange={(e) => onChange({ ...v, to: e.target.value })}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200"
          />
          <button
            onClick={() => { setOpenCustom(false); onChange({ mode: 'all' }) }}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500" title="Clear range"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Client-side filter matching a PeriodFilter value. Rows with no date pass only in 'all'. */
export function filterByPeriodValue(records = [], value, dateField = 'issue_date') {
  const v = value || { mode: 'all' }
  if (v.mode === 'all') return records
  return records.filter((r) => {
    const d = r?.[dateField]
    if (!d) return false
    const iso = String(d).slice(0, 10)
    if (v.mode === 'year') return iso.slice(0, 4) === String(v.year)
    if (v.mode === 'custom') {
      if (v.from && iso < v.from) return false
      if (v.to && iso > v.to) return false
      return true
    }
    return true
  })
}

/** Human label for report titles/exports. */
export function periodLabel(value) {
  const v = value || { mode: 'all' }
  if (v.mode === 'year') return String(v.year)
  if (v.mode === 'custom') return `${v.from || '…'} → ${v.to || '…'}`
  return 'All Time'
}

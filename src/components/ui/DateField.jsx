import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'

/**
 * DateField - a self-contained, dependency-free date picker.
 *
 * A text field showing the formatted date plus a calendar popover (month grid
 * with prev/next month arrows and a year selector). Replaces the native
 * `<input type="date">`, whose month spinner does not advance without a Tab on
 * some browsers.
 *
 * The popover is rendered in a portal with fixed positioning so it is never
 * clipped by an ancestor `.card` (which uses overflow: hidden).
 *
 * Props:
 *   value        string 'YYYY-MM-DD' or ''      controlled value
 *   onChange     (next: 'YYYY-MM-DD' | '') => void
 *   className    string   extra classes on the wrapper (sizing: w-40, flex-1, ...)
 *   placeholder  string   shown when empty (default "Select date")
 *   disabled     boolean
 *   min / max    string 'YYYY-MM-DD'  selectable range bounds (inclusive)
 *   aria-label / ariaLabel  string  accessible name
 *
 * Theme-aware via CSS vars; keyboard accessible (arrow keys move the day focus,
 * Enter/Space selects, Escape closes); closes on outside click. No new deps.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const POP_W = 272 // px, matches the popover width
const POP_H = 340 // px, approximate popover height for flip decisions

const pad = (n) => String(n).padStart(2, '0')
const toISO = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

// Parse a 'YYYY-MM-DD' string into { y, m (0-11), d } or null. Time-zone safe:
// never routed through `new Date(string)` which would shift the day by the UTC
// offset for a bare date.
function parseISO(str) {
  if (!str || typeof str !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null
  return { y, m: mo, d }
}

function formatDisplay(str) {
  const p = parseISO(str)
  if (!p) return ''
  return `${pad(p.d)} ${MONTHS_SHORT[p.m]} ${p.y}`
}

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()

export default function DateField({
  value = '',
  onChange,
  className = '',
  placeholder = 'Select date',
  disabled = false,
  min = '',
  max = '',
  ariaLabel,
  ...rest
}) {
  const ariaLabelResolved = ariaLabel ?? rest['aria-label']
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const rootRef = useRef(null)
  const popRef = useRef(null)
  const gridRef = useRef(null)
  const triggerRef = useRef(null)

  const selected = useMemo(() => parseISO(value), [value])
  const today = useMemo(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } }, [])

  // The month currently being viewed in the popover.
  const [view, setView] = useState(() => selected || today)
  // The day inside the grid that has keyboard focus (may differ from selection).
  const [focusDay, setFocusDay] = useState(() => (selected ? selected.d : today.d))

  // Compute the fixed position of the popover from the trigger's rect, flipping
  // above / shifting left when it would overflow the viewport.
  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = r.left
    if (left + POP_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - POP_W - 8)
    let top = r.bottom + 6
    if (top + POP_H > window.innerHeight - 8 && r.top - POP_H - 6 > 8) top = r.top - POP_H - 6
    setCoords({ top, left })
  }, [])

  // When opening, snap the view to the selected month (or today), focus the
  // selected/today day, and position the popover.
  useEffect(() => {
    if (!open) return
    const base = selected || today
    setView({ y: base.y, m: base.m })
    setFocusDay(base.d)
    reposition()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the popover glued to the trigger on scroll / resize while open.
  useEffect(() => {
    if (!open) return
    const onMove = () => reposition()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, reposition])

  // Close on outside click / Escape. The popover lives in a portal, so a click
  // inside it is "inside" even though it is not a DOM descendant of the trigger.
  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inTrigger = rootRef.current && rootRef.current.contains(e.target)
      const inPop = popRef.current && popRef.current.contains(e.target)
      if (!inTrigger && !inPop) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Move keyboard focus to the currently focused day button after each render
  // while the grid is open.
  useEffect(() => {
    if (!open) return
    const el = gridRef.current?.querySelector(`[data-day="${focusDay}"]`)
    if (el && !el.disabled) el.focus()
  }, [open, focusDay, view])

  const isDisabledDay = useCallback((iso) => {
    if (min && iso < min) return true
    if (max && iso > max) return true
    return false
  }, [min, max])

  const minYear = min ? Number(min.slice(0, 4)) : today.y - 10
  const maxYear = max ? Number(max.slice(0, 4)) : today.y + 10
  const years = useMemo(() => {
    const lo = Math.min(minYear, view.y)
    const hi = Math.max(maxYear, view.y)
    const out = []
    for (let y = lo; y <= hi; y++) out.push(y)
    return out
  }, [minYear, maxYear, view.y])

  function stepMonth(delta) {
    setView((v) => {
      let m = v.m + delta
      let y = v.y
      if (m < 0) { m = 11; y -= 1 }
      if (m > 11) { m = 0; y += 1 }
      return { y, m }
    })
  }

  function pick(day) {
    const iso = toISO(view.y, view.m, day)
    if (isDisabledDay(iso)) return
    onChange?.(iso)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function clear(e) {
    e.stopPropagation()
    onChange?.('')
  }

  // Arrow-key navigation across the day grid. Rolls into adjacent months.
  function onGridKeyDown(e) {
    const total = daysInMonth(view.y, view.m)
    let handled = true
    if (e.key === 'ArrowLeft') {
      if (focusDay > 1) setFocusDay(focusDay - 1)
      else { stepMonth(-1); setFocusDay(daysInMonth(view.m === 0 ? view.y - 1 : view.y, (view.m + 11) % 12)) }
    } else if (e.key === 'ArrowRight') {
      if (focusDay < total) setFocusDay(focusDay + 1)
      else { stepMonth(1); setFocusDay(1) }
    } else if (e.key === 'ArrowUp') {
      if (focusDay > 7) setFocusDay(focusDay - 7)
    } else if (e.key === 'ArrowDown') {
      if (focusDay + 7 <= total) setFocusDay(focusDay + 7)
    } else if (e.key === 'Home') {
      setFocusDay(1)
    } else if (e.key === 'End') {
      setFocusDay(total)
    } else if (e.key === 'PageUp') {
      stepMonth(-1)
    } else if (e.key === 'PageDown') {
      stepMonth(1)
    } else {
      handled = false
    }
    if (handled) e.preventDefault()
  }

  const firstWeekday = new Date(view.y, view.m, 1).getDay()
  const monthLen = daysInMonth(view.y, view.m)
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= monthLen; d++) cells.push(d)

  const display = formatDisplay(value)
  // The `.input` class is always w-full + text-sm, so sizing passed by callers
  // (w-40, flex-1, ...) belongs on the positioning wrapper, not the input.
  const hasWidth = /(^|\s)(w-|flex-|min-w-|max-w-|basis-)/.test(className)

  const popover = open && coords ? createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="Choose date"
      className="w-[17rem] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3"
      style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 1000, boxShadow: '0 10px 30px rgba(0,0,0,0.28)' }}
    >
      {/* Header: prev | month + year | next */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <button
          type="button"
          onClick={() => stepMonth(-1)}
          aria-label="Previous month"
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1.5">
          <select
            value={view.m}
            onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}
            aria-label="Month"
            className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md text-xs font-semibold text-[var(--text-primary)] px-1.5 py-1 focus:outline-none focus:border-[var(--accent)]"
          >
            {MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
          </select>
          <select
            value={view.y}
            onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}
            aria-label="Year"
            className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md text-xs font-semibold text-[var(--text-primary)] px-1.5 py-1 focus:outline-none focus:border-[var(--accent)]"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => stepMonth(1)}
          aria-label="Next month"
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] py-1">{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div ref={gridRef} className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKeyDown}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} />
          const iso = toISO(view.y, view.m, day)
          const isSel = selected && selected.y === view.y && selected.m === view.m && selected.d === day
          const isToday = today.y === view.y && today.m === view.m && today.d === day
          const disabledDay = isDisabledDay(iso)
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === focusDay ? 0 : -1}
              disabled={disabledDay}
              onClick={() => pick(day)}
              aria-label={`${day} ${MONTHS[view.m]} ${view.y}`}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSel || undefined}
              className={[
                'h-8 w-full rounded-md text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]',
                disabledDay
                  ? 'text-[var(--text-muted)] opacity-30 cursor-not-allowed'
                  : isSel
                    ? 'bg-[var(--accent)] text-white'
                    : isToday
                      ? 'text-[var(--accent)] font-bold hover:bg-[var(--input-bg)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)]',
              ].join(' ')}
            >
              {day}
            </button>
          )
        })}
      </div>

      {/* Footer: Today / Clear */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[var(--input-border)]">
        <button
          type="button"
          onClick={() => {
            const iso = toISO(today.y, today.m, today.d)
            if (isDisabledDay(iso)) return
            onChange?.(iso)
            setOpen(false)
            triggerRef.current?.focus()
          }}
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => { onChange?.(''); setOpen(false); triggerRef.current?.focus() }}
          className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Clear
        </button>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <div className={`relative ${className} ${hasWidth ? '' : 'w-full'}`} ref={rootRef}>
      <div className="relative">
        <input
          ref={triggerRef}
          type="text"
          readOnly
          disabled={disabled}
          value={display}
          placeholder={placeholder}
          aria-label={ariaLabelResolved}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
          }}
          className="input cursor-pointer pr-16 w-full"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {value && !disabled && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear date"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => !disabled && setOpen((o) => !o)}
            aria-label="Open calendar"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
          >
            <Calendar size={15} />
          </button>
        </div>
      </div>
      {popover}
    </div>
  )
}

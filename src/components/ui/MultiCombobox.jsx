import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, CheckCheck, X } from 'lucide-react'
import useAnchoredPopover from './useAnchoredPopover'
import { matchesQuery } from '../../lib/broadcastAudience'

/**
 * MultiCombobox - searchable multi-select following the ARIA editable combobox
 * pattern (input role=combobox + popup role=listbox, aria-multiselectable).
 *
 * Keyboard (focus never leaves the input; the highlighted option is announced
 * through aria-activedescendant):
 *   ArrowDown / ArrowUp  open the list and move the highlight (wraps)
 *   Home / End           first / last option (list open and search empty, or
 *                        with Ctrl, so the caret still works while typing)
 *   Enter                toggle the highlighted option (never submits a form)
 *   Space                toggle the highlighted option while the search is empty
 *   Escape               close and keep focus; if already closed, clear search
 *   typing               filters (type-ahead) and highlights the first match
 *   Tab                  closes the list and moves on
 *
 * Empty selection means "no narrowing" (ALL) - emitted as `[]`, never "nobody".
 * The list is portalled (useAnchoredPopover) because `.card` clips overflow.
 * Selected items are chips with their own named remove buttons; "Select all
 * matching" and "Clear" are real buttons below the field so they are reachable
 * by keyboard and screen reader, not only the mouse.
 *
 * Options: `{ value, label, hint?, search? }`. `search` adds hidden text that
 * the query may match (employee id, username, Arabic name ...).
 */
const RENDER_LIMIT = 200
const baseField = 'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]'

export default function MultiCombobox({
  label,
  options = [],
  value = [],
  onChange,
  allLabel,
  pluralLabel,
  hint,
  placeholder,
  disabled = false,
  chipLimit = 8,
}) {
  const uid = useId().replace(/:/g, '')
  const inputId = `mc-input-${uid}`
  const listId = `mc-list-${uid}`
  const labelId = `mc-label-${uid}`
  const hintId = `mc-hint-${uid}`
  const countId = `mc-count-${uid}`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [showAllChips, setShowAllChips] = useState(false)
  const [panelWidth, setPanelWidth] = useState(260)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const fieldRef = useRef(null)
  const quietFocus = useRef(false)

  const noun = pluralLabel || String(label || '').toLowerCase()
  const list = useMemo(() => (Array.isArray(options) ? options : [])
    .filter((o) => o && o.value !== undefined && o.value !== null && o.value !== '')
    .map((o) => ({ ...o, value: String(o.value), label: String(o.label ?? o.value) })), [options])
  const selected = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const byValue = useMemo(() => new Map(list.map((o) => [o.value, o])), [list])

  const filtered = useMemo(() => list.filter((o) => matchesQuery(
    `${o.label} ${o.hint || ''} ${o.search || ''}`, query)), [list, query])
  const shown = filtered.slice(0, RENDER_LIMIT)
  const activeIdx = shown.length ? Math.min(active, shown.length - 1) : -1
  const optionId = (i) => `${listId}-opt-${i}`

  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, {
    width: panelWidth,
    height: Math.min(300, 44 + shown.length * 36),
    align: 'left',
    nav: 'none',
    onRequestClose: () => setOpen(false),
  })

  const close = useCallback(() => { setOpen(false) }, [])
  const openList = useCallback(() => {
    if (disabled) return
    const w = fieldRef.current?.getBoundingClientRect?.().width
    setPanelWidth(Math.max(240, Math.min(w || 260, (typeof window !== 'undefined' ? window.innerWidth : 600) - 16)))
    setOpen(true)
  }, [disabled])

  // Outside press closes. Focus leaving the control entirely (Tab) closes too.
  useEffect(() => {
    if (!open) return undefined
    const outside = (e) => {
      if (rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      close()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, close, panelRef])

  // Keep the highlighted option visible.
  useEffect(() => {
    if (!open || activeIdx < 0) return
    document.getElementById(optionId(activeIdx))?.scrollIntoView?.({ block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIdx, coords])

  const emit = (next) => onChange?.(next)
  const toggle = (v) => emit(selectedSet.has(v) ? selected.filter((x) => x !== v) : [...selected, v])
  const selectMatching = () => emit([...new Set([...selected, ...filtered.map((o) => o.value)])])
  const clearAll = () => {
    emit([])
    // Hand focus back to the field (the Clear button is about to disappear)
    // without re-opening the list the user did not ask for.
    quietFocus.current = true
    inputRef.current?.focus()
    quietFocus.current = false
  }

  function move(delta) {
    if (!shown.length) return
    setActive((i) => ((Math.min(i, shown.length - 1) + delta + shown.length) % shown.length))
  }

  function onKeyDown(e) {
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault()
      if (!open) { openList(); return }
      move(k === 'ArrowDown' ? 1 : -1)
    } else if ((k === 'Home' || k === 'End') && open && shown.length && (query === '' || e.ctrlKey)) {
      e.preventDefault()
      setActive(k === 'Home' ? 0 : shown.length - 1)
    } else if (k === 'Enter') {
      e.preventDefault()
      if (!open) { openList(); return }
      if (activeIdx >= 0) toggle(shown[activeIdx].value)
    } else if (k === ' ' && open && query === '' && activeIdx >= 0) {
      e.preventDefault()
      toggle(shown[activeIdx].value)
    } else if (k === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); close(); inputRef.current?.focus() } else if (query) { setQuery('') }
    } else if (k === 'Tab') {
      close()
    }
  }

  const chipValues = showAllChips ? selected : selected.slice(0, chipLimit)
  const summary = selected.length === 0 ? (allLabel || `All ${noun}`) : `${selected.length} selected`

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label id={labelId} htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</label>
      <div ref={(el) => { fieldRef.current = el; triggerRef.current = el }} className="relative mt-1">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={open && activeIdx >= 0 ? optionId(activeIdx) : undefined}
          aria-describedby={`${hintId} ${countId}`}
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={placeholder || (selected.length ? `${selected.length} selected - search to add more` : (allLabel || `All ${noun}`))}
          onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) openList() }}
          onFocus={() => { if (!open && !quietFocus.current) openList() }}
          onClick={() => { if (!open) openList() }}
          onKeyDown={onKeyDown}
          className={`${baseField} min-h-10 pr-9`}
        />
        <ChevronDown aria-hidden="true" size={16}
          className={`pointer-events-none absolute right-3 top-3 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {hint && <p id={hintId} className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>}
      {!hint && <span id={hintId} className="sr-only">{label}</span>}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span id={countId} role="status" aria-live="polite" className="text-[var(--text-secondary)]">
          {summary}{selected.length === 0 ? ' (no filter)' : ''}
        </span>
        <button type="button" onClick={selectMatching} disabled={disabled || filtered.length === 0}
          aria-label={`Select all ${filtered.length} matching ${noun}`}
          className="inline-flex items-center gap-1 text-[var(--text-secondary)] underline-offset-2 hover:underline disabled:opacity-40">
          <CheckCheck size={13} aria-hidden="true" /> Select all {filtered.length} matching
        </button>
        {selected.length > 0 && (
          <button type="button" onClick={clearAll} aria-label={`Clear ${noun}`}
            className="text-[var(--accent)] underline-offset-2 hover:underline">Clear</button>
        )}
      </div>

      {selected.length > 0 && (
        <ul aria-label={`Selected ${noun}`} className="mt-2 flex flex-wrap gap-1">
          {chipValues.map((v) => {
            const text = byValue.get(v)?.label || v
            return (
              <li key={v} className="min-w-0 max-w-full">
                <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${text}`} title={`Remove ${text}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--input-bg)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)]">
                  <span className="truncate">{text}</span><X size={12} aria-hidden="true" className="shrink-0" />
                </button>
              </li>
            )
          })}
          {selected.length > chipLimit && (
            <li>
              <button type="button" onClick={() => setShowAllChips((s) => !s)} aria-expanded={showAllChips}
                className="px-2 py-1 text-xs text-[var(--accent)] underline-offset-2 hover:underline">
                {showAllChips ? 'Show fewer' : `+${selected.length - chipLimit} more`}
              </button>
            </li>
          )}
        </ul>
      )}

      {open && coords && createPortal(
        <div ref={panelRef} className="tp-popover p-1"
          style={{ top: coords.top, left: coords.left, width: panelWidth, maxHeight: Math.min(coords.maxHeight, 320), overflowY: 'auto' }}>
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-labelledby={labelId}>
            {shown.map((o, i) => {
              const on = selectedSet.has(o.value)
              return (
                <li key={o.value} id={optionId(i)} role="option" aria-selected={on}
                  aria-setsize={filtered.length} aria-posinset={i + 1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => { if (activeIdx !== i) setActive(i) }}
                  onClick={() => toggle(o.value)}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--text-primary)] ${i === activeIdx ? 'bg-[var(--hover-bg)]' : ''}`}>
                  <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border-subtle)]'}`}>
                    {on && <Check size={11} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{o.label}</span>
                    {o.hint && <span className="block break-words text-[11px] text-[var(--text-muted)]">{o.hint}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          {shown.length === 0 && (
            <p role="status" className="px-2 py-3 text-xs text-[var(--text-muted)]">No matching {noun}.</p>
          )}
          {filtered.length > shown.length && (
            <p className="px-2 py-2 text-[11px] text-[var(--text-muted)]">
              Showing the first {shown.length} of {filtered.length}. Keep typing to narrow the list.
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

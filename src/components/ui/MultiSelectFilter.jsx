import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import useAnchoredPopover from './useAnchoredPopover'
import { selectionValues, toggleSelection } from '../../lib/filterSelection'

/**
 * MultiSelectFilter - a filter control that can pick SEVERAL values at once.
 *
 * A plain <select> can only ask "which one?", and the real question on these
 * registers is "which few?" - the mixers and the pumps but not the loaders, the
 * Central and Western regions but not the rest. Ticking one, reading the table,
 * going back and ticking the next is the same question asked three times, and
 * the totals above the table never show the combined set.
 *
 * PORTALLED to the body via useAnchoredPopover, which is not optional here:
 * every register that uses this control lives inside `.card`, and `.card` sets
 * overflow:hidden for its accent hairline, so an absolutely-positioned panel is
 * CLIPPED - it reads as missing rather than as broken, which is worse.
 *
 * The value is whatever `filterSelection.js` understands: the sentinel 'all', a
 * single value, or an array. onChange always emits an ARRAY, and an EMPTY array
 * means "no narrowing" (never "match nothing") - a filter that empties the table
 * when the last chip is unticked reads as lost data.
 *
 * Props:
 *   label        string    what the control filters, for the accessible name ("Region")
 *   allLabel     string    trigger text when nothing is picked ("All regions")
 *   pluralLabel  string    noun for the "3 regions" summary (defaults to label lowercased)
 *   options      string[]  the selectable values (derive them from the rows on screen)
 *   value        'all' | string | string[]
 *   onChange     (string[]) => void
 *   disabled     boolean
 *   className    extra classes on the trigger
 */
export default function MultiSelectFilter({
  label,
  allLabel,
  pluralLabel,
  options = [],
  value = 'all',
  onChange,
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const popRef = useRef(null)
  const list = useMemo(() => (Array.isArray(options) ? options.filter(Boolean) : []), [options])
  const chosen = useMemo(() => selectionValues(value), [value])
  // Only values that are actually on offer count towards the summary, so a
  // stale pick left over from another country cannot claim to be narrowing
  // anything the reader can see.
  const live = useMemo(() => chosen.filter((v) => list.includes(v)), [chosen, list])

  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, {
    width: 236,
    height: Math.min(360, 96 + list.length * 32),
    align: 'left',
    nav: 'menu',
    onRequestClose: () => setOpen(false),
  })

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const noun = pluralLabel || String(label || '').toLowerCase()
  const summary = live.length === 0
    ? (allLabel || `All ${noun}`)
    : live.length === 1
      ? live[0]
      : `${live.length} ${noun}`

  function toggle(option) {
    onChange?.(toggleSelection(live, option))
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || !list.length}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        // The chosen values are read out as part of the name, so a screen-reader
        // user learns what the filter is doing without opening it.
        aria-label={`${label}: ${live.length ? live.join(', ') : 'all'}`}
        title={live.length > 1 ? live.join(', ') : undefined}
        className={`rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-40 ${className}`}
        style={{ color: 'var(--text-primary)' }}
      >
        <span className="truncate max-w-[11rem]">{summary}</span>
        {live.length > 1 && (
          <span
            className="rounded-full px-1.5 text-[10px]"
            style={{ background: 'rgba(148,163,184,0.18)', color: 'var(--text-secondary)' }}
          >
            {live.length}
          </span>
        )}
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && coords && createPortal(
        <div
          ref={(el) => { popRef.current = el; panelRef.current = el }}
          role="menu"
          aria-label={label}
          className="tp-popover p-1.5"
          style={{ top: coords.top, left: coords.left, width: 236, maxHeight: coords.maxHeight }}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              {label}
            </span>
            {live.length > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => onChange?.([])}
                className="text-[11px] underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                Clear
              </button>
            )}
          </div>
          {list.map((option) => {
            const on = live.includes(option)
            return (
              <button
                key={option}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => toggle(option)}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left hover:bg-[var(--input-bg)]"
                style={{ color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                <span
                  aria-hidden="true"
                  className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0"
                  style={{
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--border-subtle)'}`,
                    background: on ? 'var(--brand)' : 'transparent',
                  }}
                >
                  {on && <Check size={10} color="#fff" />}
                </span>
                <span className="truncate">{option}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

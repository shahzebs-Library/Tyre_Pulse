/**
 * ReferencePicker — a live, searchable combobox that resolves a checklist
 * reference field (asset / site / user) to a REAL value at fill time. It loads
 * its option list once per (source, country) from the same governed data
 * sources the rest of the app uses, then lets the operator search, pick, clear,
 * or free-type a value. Because it is a combo box (not a hard <select>) a
 * missing option never blocks a submit — whatever the operator typed is kept.
 *
 * The chosen human-readable string (asset_no / site name / user display name)
 * is written straight into answers[field.id] via onChange — no ids, so the
 * read-only submission view can render it without a lookup.
 *
 * Props:
 *   source      'asset' | 'site' | 'user'   which live list to load
 *   value       string                       current answer (controlled)
 *   onChange    (value:string) => void       called with the chosen/typed string
 *   country     string                       active country scope (optional)
 *   placeholder string                       input placeholder (optional)
 *   disabled    boolean                      disable the whole control
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Truck, MapPin, User, Search, ChevronDown, X, Loader2, Check, AlertTriangle } from 'lucide-react'
import { listAssets, listDataAssetOptions } from '../../lib/api/assets'
import { listSites, siteOptionsForCountry, listDataSiteOptions } from '../../lib/api/sites'
import { listProfiles } from '../../lib/api/users'

const SOURCE_META = {
  asset: { Icon: Truck,  noun: 'asset',  placeholder: 'Search assets…' },
  site:  { Icon: MapPin, noun: 'site',   placeholder: 'Search sites…' },
  user:  { Icon: User,   noun: 'user',   placeholder: 'Search people…' },
}

const uniqSorted = (arr) => {
  const seen = new Set()
  const out = []
  for (const raw of arr || []) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** Resolve a source + country into a de-duplicated, sorted option list. */
async function loadOptions(source, country) {
  const scope = country && country !== 'All' ? country : undefined
  if (source === 'asset') {
    // Prefer live data across the fleet + tyre + inspection tables (RPC); fall
    // back to the fleet-master list if the RPC is unavailable / returns nothing.
    try {
      const opts = await listDataAssetOptions(country)
      if (opts.length) return uniqSorted(opts)
    } catch { /* fall through to fleet-master */ }
    const rows = await listAssets({ country: scope, limit: 1000 })
    return uniqSorted((Array.isArray(rows) ? rows : []).map((r) => r?.asset_no))
  }
  if (source === 'site') {
    // Prefer unique sites from live operational data (RPC); fall back to the
    // sites master, which is frequently near-empty.
    try {
      const opts = await listDataSiteOptions(country)
      if (opts.length) return uniqSorted(opts)
    } catch { /* fall through to sites master */ }
    const rows = await listSites({})
    return uniqSorted(siteOptionsForCountry(Array.isArray(rows) ? rows : [], scope || '', { activeOnly: true }))
  }
  if (source === 'user') {
    const rows = await listProfiles()
    return uniqSorted(
      (Array.isArray(rows) ? rows : []).map((r) => r?.full_name || r?.username || r?.email),
    )
  }
  return []
}

export default function ReferencePicker({ source, value, onChange, country, placeholder, disabled = false }) {
  const meta = SOURCE_META[source] || SOURCE_META.asset
  const Icon = meta.Icon

  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const rootRef = useRef(null)
  const inputRef = useRef(null)

  // Load the option list once per (source, country). A failure never blocks the
  // field — the operator can still free-type a value.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    loadOptions(source, country)
      .then((opts) => { if (!cancelled) setOptions(Array.isArray(opts) ? opts : []) })
      .catch((e) => { if (!cancelled) { setOptions([]); setError(e?.message || `Could not load ${meta.noun}s.`) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [source, country, meta.noun])

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, query])

  const commit = useCallback((next) => {
    onChange?.(next)
    setQuery('')
    setOpen(false)
  }, [onChange])

  const clear = useCallback((e) => {
    e?.stopPropagation?.()
    onChange?.('')
    setQuery('')
    inputRef.current?.focus?.()
  }, [onChange])

  const hasValue = value != null && String(value).trim() !== ''

  return (
    <div ref={rootRef} className="relative">
      {/* Trigger / input row */}
      <div
        className={`input flex items-center gap-2 !py-0 !pr-1 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus?.() } }}
      >
        <Icon size={15} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          placeholder={hasValue ? '' : (placeholder || meta.placeholder)}
          value={open ? query : (hasValue ? String(value) : '')}
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const q = query.trim()
              if (filtered.length === 1) commit(filtered[0])
              else if (q) commit(q) // accept the free-typed value
            } else if (e.key === 'Escape') {
              setOpen(false); setQuery('')
            }
          }}
        />
        {loading && <Loader2 size={14} className="animate-spin text-[var(--text-muted)] shrink-0" aria-label="Loading" />}
        {hasValue && !disabled && (
          <button
            type="button"
            onClick={clear}
            title={`Clear ${meta.noun}`}
            aria-label={`Clear ${meta.noun}`}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); if (!disabled) { setOpen((o) => !o); inputRef.current?.focus?.() } }}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          aria-label={open ? 'Close list' : 'Open list'}
        >
          <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--surface-2)] shadow-xl py-1"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" /> Loading {meta.noun}s…
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-amber-400">
                  <AlertTriangle size={13} className="shrink-0" /> {error} You can still type a value.
                </div>
              )}
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-sm text-[var(--text-muted)]">
                  {options.length === 0 ? `No ${meta.noun}s available.` : 'No matches.'}
                  {query.trim() && (
                    <button
                      type="button"
                      onClick={() => commit(query.trim())}
                      className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-1)]"
                    >
                      <Search size={14} className="text-[var(--text-muted)]" />
                      Use “{query.trim()}”
                    </button>
                  )}
                </div>
              ) : (
                filtered.map((o) => {
                  const selected = String(value ?? '') === o
                  return (
                    <button
                      key={o}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => commit(o)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-1)] ${
                        selected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      <Icon size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
                      <span className="truncate flex-1">{o}</span>
                      {selected && <Check size={14} className="text-brand-bright shrink-0" />}
                    </button>
                  )
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

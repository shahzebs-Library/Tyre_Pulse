import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Palette, Search, Copy, Check, Image as ImageIcon, Shapes, Sparkles, X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import { Illustration, ILLUSTRATION_NAMES } from '../components/illustrations'
import { TpIcon, ICON_NAMES } from '../components/icons'
import { BRAND_LOGOS, assetUrl } from '../lib/brand/library'

/**
 * BrandAssets — a living design-system gallery for the Tyre Pulse brand.
 *
 * Surfaces every shipped brand primitive (logos, illustrations, icons) in one
 * searchable, filterable admin showcase so designers and engineers can discover
 * the exact asset id / component snippet to use — with one-click copy.
 *
 * Purely presentational: reads from the committed asset registries, mutates no
 * state on the server, and degrades gracefully if a registry is empty.
 */

// ─── Copy-to-clipboard hook (transient "copied" feedback, keyed by value) ────
function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = useCallback((value, key = value) => {
    const write = navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(value)
      : Promise.reject(new Error('clipboard unavailable'))
    write
      .then(() => {
        setCopied(key)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(null), timeout)
      })
      .catch(() => {
        // Fallback for insecure contexts / older browsers.
        try {
          const ta = document.createElement('textarea')
          ta.value = value
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          setCopied(key)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(null), timeout)
        } catch { /* copy unsupported — non-critical */ }
      })
  }, [timeout])
  return { copied, copy }
}

// ─── Derive the category prefix from an illustration name (e.g. state/no-data) ─
function categoryOf(name) {
  const i = name.indexOf('/')
  return i === -1 ? 'other' : name.slice(0, i)
}

// ─── Small reusable search input ─────────────────────────────────────────────
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative flex-1 min-w-52">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        className="input pl-9 pr-9 w-full"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// ─── Pill filter row ─────────────────────────────────────────────────────────
function FilterPills({ options, value, onChange, allLabel = 'All' }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {[{ id: '', label: allLabel }, ...options].map(({ id, label, count }) => (
        <button
          key={id || '__all__'}
          onClick={() => onChange(id)}
          className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
            value === id
              ? 'bg-green-700 text-white'
              : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:bg-[var(--input-bg-hover)] hover:text-[var(--text-primary)]'
          }`}
        >
          {label}
          {typeof count === 'number' && (
            <span className="ml-1.5 opacity-60">{count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Empty result state ──────────────────────────────────────────────────────
function EmptyResult({ query }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="w-12 h-12 rounded-xl bg-[var(--input-bg)] flex items-center justify-center">
        <Search size={20} className="text-[var(--text-muted)]" />
      </div>
      <p className="text-sm text-[var(--text-primary)] font-medium">No matches found</p>
      <p className="text-xs text-[var(--text-muted)]">
        {query ? <>Nothing matches "{query}".</> : 'No assets in this category.'}
      </p>
    </div>
  )
}

// ─── Copy badge shown on each asset card ─────────────────────────────────────
function CopyBadge({ active }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium transition-colors ${
        active ? 'text-green-400' : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
      }`}
    >
      {active ? <Check size={11} /> : <Copy size={11} />}
      {active ? 'Copied' : 'Copy'}
    </span>
  )
}

// ─── LOGOS ───────────────────────────────────────────────────────────────────
function LogosSection() {
  const { copied, copy } = useCopy()
  const [query, setQuery] = useState('')
  const [color, setColor] = useState('')
  const [layout, setLayout] = useState('')

  const colors = useMemo(() => {
    const map = new Map()
    for (const l of BRAND_LOGOS) if (l.color) map.set(l.color, (map.get(l.color) || 0) + 1)
    return [...map.entries()].sort().map(([id, count]) => ({ id, label: id, count }))
  }, [])
  const layouts = useMemo(() => {
    const map = new Map()
    for (const l of BRAND_LOGOS) if (l.layout) map.set(l.layout, (map.get(l.layout) || 0) + 1)
    return [...map.entries()].sort().map(([id, count]) => ({ id, label: id, count }))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return BRAND_LOGOS.filter((l) => {
      if (color && l.color !== color) return false
      if (layout && l.layout !== layout) return false
      if (!q) return true
      return (
        l.id.toLowerCase().includes(q) ||
        (l.label || '').toLowerCase().includes(q) ||
        (l.color || '').toLowerCase().includes(q) ||
        (l.layout || '').toLowerCase().includes(q)
      )
    })
  }, [query, color, layout])

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <SearchBox value={query} onChange={setQuery} placeholder="Search logos by id, colour, layout…" />
          <span className="text-xs text-[var(--text-muted)]">
            {filtered.length} / {BRAND_LOGOS.length}
          </span>
        </div>
        {colors.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <span className="text-xs text-[var(--text-muted)] self-center">Colour</span>
            <FilterPills options={colors} value={color} onChange={setColor} />
          </div>
        )}
        {layouts.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <span className="text-xs text-[var(--text-muted)] self-center">Layout</span>
            <FilterPills options={layouts} value={layout} onChange={setLayout} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 && <EmptyResult query={query} />}
        {filtered.map((l) => {
          const url = assetUrl(l.id)
          const active = copied === l.id
          return (
            <button
              key={l.id}
              onClick={() => copy(l.id, l.id)}
              title={`Click to copy id: ${l.id}`}
              className="group card !p-0 overflow-hidden text-left hover:border-green-700/50 transition-colors"
            >
              <div className="h-32 flex items-center justify-center bg-[var(--bg-base)] border-b border-[var(--input-border)]/60 p-4 checker">
                {url ? (
                  <img
                    src={url}
                    alt={l.label || l.id}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <ImageIcon size={28} className="text-[var(--text-muted)]" />
                )}
              </div>
              <div className="p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">{l.label || l.id}</span>
                  <CopyBadge active={active} />
                </div>
                <code className="block text-[11px] text-[var(--text-muted)] font-mono truncate">{l.id}</code>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {l.layout && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-muted)]">{l.layout}</span>}
                  {l.color && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-muted)]">{l.color}</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── ILLUSTRATIONS ───────────────────────────────────────────────────────────
function IllustrationsSection() {
  const { copied, copy } = useCopy()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')

  const categories = useMemo(() => {
    const map = new Map()
    for (const n of ILLUSTRATION_NAMES) {
      const c = categoryOf(n)
      map.set(c, (map.get(c) || 0) + 1)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, count]) => ({ id, label: id, count }))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ILLUSTRATION_NAMES.filter((n) => {
      if (category && categoryOf(n) !== category) return false
      if (!q) return true
      return n.toLowerCase().includes(q)
    })
  }, [query, category])

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <SearchBox value={query} onChange={setQuery} placeholder="Search illustrations by name…" />
          <span className="text-xs text-[var(--text-muted)]">
            {filtered.length} / {ILLUSTRATION_NAMES.length}
          </span>
        </div>
        <FilterPills options={categories} value={category} onChange={setCategory} allLabel="All categories" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {filtered.length === 0 && <EmptyResult query={query} />}
        {filtered.map((n) => {
          const active = copied === n
          return (
            <button
              key={n}
              onClick={() => copy(n, n)}
              title={`Click to copy name: ${n}`}
              className="group card !p-0 overflow-hidden text-left hover:border-green-700/50 transition-colors"
            >
              <div className="h-36 flex items-center justify-center bg-[var(--bg-base)] border-b border-[var(--input-border)]/60 p-3">
                <Illustration name={n} size={140} title={n} />
              </div>
              <div className="p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[11px] text-[var(--text-primary)] font-mono truncate">{n}</code>
                  <CopyBadge active={active} />
                </div>
                <span className="block text-[10px] text-[var(--text-muted)]">{categoryOf(n)}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────
function IconsSection() {
  const { copied, copy } = useCopy()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ICON_NAMES
    return ICON_NAMES.filter((n) => n.toLowerCase().includes(q))
  }, [query])

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap gap-3 items-center">
          <SearchBox value={query} onChange={setQuery} placeholder="Search icons by name…" />
          <span className="text-xs text-[var(--text-muted)]">
            {filtered.length} / {ICON_NAMES.length}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filtered.length === 0 && <EmptyResult query={query} />}
        {filtered.map((n) => {
          const snippet = `<TpIcon name="${n}" />`
          const active = copied === n
          return (
            <button
              key={n}
              onClick={() => copy(snippet, n)}
              title={`Click to copy: ${snippet}`}
              className="group card flex flex-col items-center gap-2 py-4 text-center hover:border-green-700/50 transition-colors"
            >
              <div className="h-9 flex items-center justify-center text-[var(--text-primary)]">
                <TpIcon name={n} size={22} />
              </div>
              <code className="text-[11px] text-[var(--text-muted)] font-mono truncate max-w-full w-full">{n}</code>
              <CopyBadge active={active} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── PAGE ────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'logos',         label: 'Logos',         icon: ImageIcon, count: () => BRAND_LOGOS.length },
  { id: 'illustrations', label: 'Illustrations', icon: Shapes,    count: () => ILLUSTRATION_NAMES.length },
  { id: 'icons',         label: 'Icons',         icon: Sparkles,  count: () => ICON_NAMES.length },
]

export default function BrandAssets() {
  const [tab, setTab] = useState('logos')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brand Assets"
        subtitle="Living design-system gallery — logos, illustrations & icons. Click any asset to copy its id or snippet."
        icon={Palette}
        badge="Design System"
      />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {TABS.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`card text-left transition-colors ${
              tab === id ? 'border-green-700/60' : 'hover:border-[var(--input-border)]'
            }`}
          >
            <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
            <p className="text-2xl font-bold text-green-400">{count()}</p>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--input-border)]/60">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
              tab === id
                ? 'text-green-400 border-b-2 border-green-400 bg-[var(--input-bg)]/30'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]/20'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'logos' && <LogosSection />}
          {tab === 'illustrations' && <IllustrationsSection />}
          {tab === 'icons' && <IconsSection />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

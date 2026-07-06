// CommandPalette.jsx - global Ctrl/Cmd+K command palette (Linear/Notion style).
// Two result groups: COMMANDS (RBAC-filtered navigation + quick actions) and
// RECORDS (debounced universal search across Supabase entities). Theme-aware:
// every surface uses index.css tokens so it renders correctly in light + dark.
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, LayoutDashboard, CircleDot, ClipboardList, Bell, Package, Truck,
  FileText, ClipboardCheck, BarChart2, Target, Activity, TrendingUp,
  GitCompare, Cpu, Presentation, Zap, AlertTriangle, Heart, MapPin, Gauge,
  Wrench, Building2, Trash2, ArrowLeftRight, RefreshCw, ShoppingCart, Users,
  Shield, AlertCircle, RefreshCcw, Calendar, Radio, CalendarCheck, Upload,
  History, UserCog, Settings, QrCode, Tag, LayoutGrid, Clock, CornerDownLeft,
  Loader2, WifiOff,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useCommandPalette } from '../contexts/CommandPaletteContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  NAV_COMMANDS, ACTION_COMMANDS, RECORD_SOURCES,
  visibleCommands, visibleRecordSources, rankCommands, buildOrClause, mapRecordRows,
} from '../lib/commandSearch'

// ── Icon lookup ───────────────────────────────────────────────────────────────
const ICON_MAP = {
  LayoutDashboard, CircleDot, ClipboardList, Bell, Package, Truck, FileText,
  ClipboardCheck, BarChart2, Target, Activity, TrendingUp, GitCompare, Cpu,
  Presentation, Zap, Search, AlertTriangle, Heart, MapPin, Gauge, Wrench,
  Building2, Trash2, ArrowLeftRight, RefreshCw, ShoppingCart, Users, Shield,
  AlertCircle, RefreshCcw, Calendar, Radio, CalendarCheck, Upload, History,
  UserCog, Settings, QrCode, Tag, LayoutGrid, Clock,
}

// ── Recent items (localStorage) ──────────────────────────────────────────────
const STORAGE_KEY = 'tp_recent_commands'
const MAX_RECENT = 5

function loadRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveRecent(item) {
  try {
    const prev = loadRecent().filter((r) => r.id !== item.id)
    const next = [
      { id: item.id, label: item.label, path: item.path, icon: item.icon, sub: item.sub },
      ...prev,
    ].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* ignore storage errors */ }
}

function ItemIcon({ name, size = 15 }) {
  const Icon = ICON_MAP[name] || Search
  return <Icon size={size} />
}

// ── Row ───────────────────────────────────────────────────────────────────────
function ResultRow({ item, isActive, index, onSelect, onHover }) {
  const ref = useRef(null)
  useEffect(() => {
    if (isActive && ref.current) ref.current.scrollIntoView({ block: 'nearest' })
  }, [isActive])

  return (
    <div
      ref={ref}
      id={`cp-item-${item.id}`}
      role="option"
      aria-selected={isActive}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors"
      style={{
        background: isActive ? 'var(--brand-subtle)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--brand)' : '2px solid transparent',
      }}
      onMouseEnter={() => onHover(index)}
      onMouseDown={(e) => { e.preventDefault(); onSelect(item) }}
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--border-dim)',
          color: isActive ? 'var(--brand-bright)' : 'var(--text-muted)',
        }}
      >
        <ItemIcon name={item.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {item.label}
        </p>
        {item.sub && (
          <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.sub}</p>
        )}
      </div>
      {item.path && !item.sub && (
        <span className="text-[11px] truncate hidden sm:block" style={{ color: 'var(--text-dim)' }}>
          {item.path}
        </span>
      )}
      {isActive && <CornerDownLeft size={13} style={{ color: 'var(--text-dim)' }} className="flex-shrink-0" />}
    </div>
  )
}

function GroupHeader({ label }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-widest px-4 pt-3 pb-1.5"
      style={{ color: 'var(--text-dim)' }}
    >
      {label}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CommandPalette() {
  const { open, setOpen } = useCommandPalette()
  const { profile, hasPermission } = useAuth()
  const navigate = useNavigate()
  const { t } = useLanguage()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recordGroups, setRecordGroups] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const inputRef = useRef(null)
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  // ── RBAC-filtered command lists (same rules as the sidebar nav + ModuleRoute)
  const navCommands = useMemo(
    () => visibleCommands(NAV_COMMANDS, profile, hasPermission),
    [profile, hasPermission],
  )
  const actionCommands = useMemo(
    () => visibleCommands(ACTION_COMMANDS, profile, hasPermission),
    [profile, hasPermission],
  )
  const allowedPaths = useMemo(
    () => new Set([...navCommands, ...actionCommands].map((c) => c.path)),
    [navCommands, actionCommands],
  )

  // ── Reset on open + focus input ────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setRecordGroups([])
      setSearchError(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // ── Debounced (300ms) universal record search across Supabase ──────────────
  useEffect(() => {
    if (!open) return undefined
    const q = query.trim()
    if (q.length < 2) {
      setRecordGroups([])
      setSearching(false)
      setSearchError(false)
      return undefined
    }
    let cancelled = false
    setSearching(true)
    setSearchError(false)
    const timer = setTimeout(async () => {
      const sources = visibleRecordSources(RECORD_SOURCES, profile, hasPermission)
      if (sources.length === 0) {
        if (!cancelled) { setRecordGroups([]); setSearching(false) }
        return
      }
      const settled = await Promise.allSettled(
        sources.map((s) => {
          const orClause = buildOrClause(s.fields, q)
          if (!orClause) return Promise.resolve({ data: [] })
          return supabase.from(s.table).select(s.select).or(orClause).limit(5)
        }),
      )
      if (cancelled) return
      const groups = []
      let anyOk = false
      settled.forEach((res, i) => {
        if (res.status === 'fulfilled' && !res.value?.error) {
          anyOk = true
          const items = mapRecordRows(sources[i], res.value?.data)
          if (items.length) groups.push({ label: sources[i].label, items })
        }
      })
      setRecordGroups(groups)
      setSearchError(!anyOk)
      setSearching(false)
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open, profile, hasPermission])

  // ── Build the visible group list ────────────────────────────────────────────
  const groups = useMemo(() => {
    const q = query.trim()
    if (!q) {
      const result = []
      const recents = loadRecent().filter((r) => allowedPaths.has(r.path) || r.path?.startsWith('/vehicle/'))
      if (recents.length) result.push({ label: t('ui.command.groups.recent'), items: recents })
      if (actionCommands.length) result.push({ label: t('ui.command.groups.actions'), items: actionCommands })
      result.push({ label: t('ui.command.groups.navigation'), items: navCommands.slice(0, 8) })
      return result
    }
    const result = []
    const commands = rankCommands([...actionCommands, ...navCommands], q, 8)
    if (commands.length) result.push({ label: t('ui.command.groups.commands'), items: commands })
    for (const g of recordGroups) result.push({ label: g.label, items: g.items })
    return result
  }, [query, navCommands, actionCommands, allowedPaths, recordGroups, t])

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => { setActiveIndex(0) }, [query, recordGroups])

  // ── Select ──────────────────────────────────────────────────────────────────
  const handleSelect = useCallback((item) => {
    saveRecent(item)
    setOpen(false)
    navigate(item.path)
  }, [navigate, setOpen])

  // ── Keyboard: Esc / arrows / Enter / focus trap (document-level while open) ─
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
      if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (flatItems.length ? Math.min(i + 1, flatItems.length - 1) : 0))
        return
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = flatItems[activeIndex]
        if (item) handleSelect(item)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, flatItems, activeIndex, handleSelect, setOpen])

  if (!open) return null

  const hasResults = flatItems.length > 0
  const showNoResults = !hasResults && !searching && query.trim().length > 0

  let globalIndex = 0

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden"
        style={{
          background: 'var(--panel)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-bright)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {/* ── Input bar ─────────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-4"
          style={{ borderBottom: '1px solid var(--border-dim)' }}
        >
          {searching
            ? <Loader2 size={17} className="animate-spin flex-shrink-0" style={{ color: 'var(--brand)' }} />
            : <Search size={17} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ui.command.placeholder', { key: isMac ? '⌘' : 'Ctrl+' })}
            className="flex-1 bg-transparent text-base py-3.5 outline-none"
            style={{ color: 'var(--text-primary)' }}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={hasResults}
            aria-autocomplete="list"
            aria-activedescendant={flatItems[activeIndex] ? `cp-item-${flatItems[activeIndex].id}` : undefined}
          />
          <kbd
            className="hidden sm:inline-flex items-center px-2 py-1 rounded-md text-[11px] font-mono select-none cursor-pointer"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-muted)' }}
            onClick={() => setOpen(false)}
          >
            Esc
          </kbd>
        </div>

        {/* ── Results ───────────────────────────────────────────────────────── */}
        <div className="max-h-[55vh] overflow-y-auto overscroll-contain pb-1" role="listbox" aria-label="Results">
          {groups.map((group) => (
            <div key={group.label}>
              <GroupHeader label={group.label} />
              {group.items.map((item) => {
                const idx = globalIndex++
                return (
                  <ResultRow
                    key={item.id}
                    item={item}
                    index={idx}
                    isActive={activeIndex === idx}
                    onSelect={handleSelect}
                    onHover={setActiveIndex}
                  />
                )
              })}
            </div>
          ))}

          {/* Record search error (commands still shown above) */}
          {searchError && !searching && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <WifiOff size={14} style={{ color: 'var(--text-dim)' }} />
              {t('ui.command.searchError')}
            </div>
          )}

          {/* Loading state when nothing rendered yet */}
          {!hasResults && searching && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={22} className="animate-spin" style={{ color: 'var(--brand)' }} />
              {t('common.loading')}
            </div>
          )}

          {/* Empty state */}
          {showNoResults && !searchError && (
            <div className="flex flex-col items-center justify-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Search size={28} className="mb-3" style={{ color: 'var(--text-dim)' }} />
              {t('ui.search.noResultsFor')} &ldquo;{query}&rdquo;
              <span className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                {t('ui.search.noResultsHint')}
              </span>
            </div>
          )}
          {showNoResults && searchError && (
            <div className="flex flex-col items-center justify-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
              <WifiOff size={28} className="mb-3" style={{ color: 'var(--text-dim)' }} />
              {t('ui.command.searchError')}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div
          className="px-4 py-2.5 flex items-center gap-4 text-[11px]"
          style={{ borderTop: '1px solid var(--border-dim)', color: 'var(--text-dim)' }}
        >
          {[
            { keys: ['↑', '↓'], label: t('ui.hints.navigate') },
            { keys: ['↵'], label: t('ui.hints.open') },
            { keys: ['esc'], label: t('ui.hints.close') },
          ].map(({ keys, label }) => (
            <span key={label} className="flex items-center gap-1">
              {keys.map((k) => (
                <kbd
                  key={k}
                  className="px-1.5 py-0.5 rounded font-mono"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                >
                  {k}
                </kbd>
              ))}
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export { useCommandPalette }

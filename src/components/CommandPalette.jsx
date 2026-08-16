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
import { useFeatureGate } from '../hooks/useFeatureFlags'
import { useLanguage } from '../contexts/LanguageContext'
import {
  NAV_COMMANDS, ACTION_COMMANDS, RECORD_SOURCES,
  visibleCommands, visibleRecordSources, rankCommands, buildOrClause, mapRecordRows,
  isCommandVisible,
} from '../lib/commandSearch'
import {
  MAX_RECENTS, loadFavorites, loadRecents, visibleFavorites, visibleRecents,
  loadRecentRecords, pushRecentRecord, visibleRecentRecords,
} from '../lib/navFavorites'

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

// A key with no locale entry must render its English heading, never leak
// "ui.command.groups.favorites" into the results list.
function labelOr(t, key, fallback) {
  const v = t(key)
  return (!v || v === key) ? fallback : v
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CommandPalette() {
  const { open, setOpen } = useCommandPalette()
  const paletteEnabled = useFeatureGate('command_palette')
  const { profile, hasPermission, grantedModules, isSuperAdmin } = useAuth()
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
    () => visibleCommands(NAV_COMMANDS, profile, hasPermission, grantedModules, isSuperAdmin),
    [profile, hasPermission, grantedModules, isSuperAdmin],
  )
  const actionCommands = useMemo(
    () => visibleCommands(ACTION_COMMANDS, profile, hasPermission, grantedModules, isSuperAdmin),
    [profile, hasPermission, grantedModules, isSuperAdmin],
  )
  const allowedPaths = useMemo(
    () => new Set([...navCommands, ...actionCommands].map((c) => c.path)),
    [navCommands, actionCommands],
  )

  // ── Favourites + recents (empty query only) ────────────────────────────────
  // Both stores hold ROUTES ONLY, so labels and icons come from the command
  // registry here and access is re-checked every render. The index is built from
  // EVERY command, visible or not, so `canSeePath` below stays the single gate:
  // it is `allowedPaths`, i.e. the palette's own visibleCommands filter, so a
  // shortcut can never reach a page the palette itself would refuse to list.
  const commandByPath = useMemo(() => {
    const m = new Map()
    for (const c of [...NAV_COMMANDS, ...ACTION_COMMANDS]) if (!m.has(c.path)) m.set(c.path, c)
    return m
  }, [])
  const navIndex = useMemo(() => {
    const idx = {}
    for (const [path, c] of commandByPath) idx[path] = { label: c.label, group: '' }
    return idx
  }, [commandByPath])
  const canSeePath = useCallback((path) => allowedPaths.has(path), [allowedPaths])

  // A stored RECORD is re-checked against the very source that produced it, so
  // losing a module stops its records appearing at once - exactly as a revoked
  // favourite disappears. An unknown source (registry entry removed or renamed)
  // is dropped rather than guessed at.
  const recordSourceById = useMemo(() => {
    const m = new Map()
    for (const s of RECORD_SOURCES) m.set(s.id, s)
    return m
  }, [])
  const canSeeRecord = useCallback((entry) => {
    const src = recordSourceById.get(entry?.source)
    if (!src) return false
    return isCommandVisible(src.access, profile, hasPermission, grantedModules, isSuperAdmin)
  }, [recordSourceById, profile, hasPermission, grantedModules, isSuperAdmin])

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
      const sources = visibleRecordSources(RECORD_SOURCES, profile, hasPermission, grantedModules, isSuperAdmin)
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
          // Stamp each hit with the source that produced it. That id - not a
          // guess parsed back out of the row id - is what lets a picked record
          // be re-permission-checked later against the SAME `access` descriptor
          // this search was filtered by.
          const items = mapRecordRows(sources[i], res.value?.data)
            .map((it) => ({ ...it, source: sources[i].id }))
          if (items.length) groups.push({ label: sources[i].label, items })
        }
      })
      setRecordGroups(groups)
      setSearchError(!anyOk)
      setSearching(false)
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open, profile, hasPermission, grantedModules, isSuperAdmin])

  // ── Build the visible group list ────────────────────────────────────────────
  const groups = useMemo(() => {
    const q = query.trim()
    if (!q) {
      // A stored route becomes a row only after the registry gives it a label
      // and `canSeePath` clears it, so ids are namespaced to stay unique against
      // the same page appearing again under Actions or Navigation below.
      const toRow = (prefix) => (entry) => ({
        id: `${prefix}:${entry.route}`,
        label: entry.label,
        path: entry.route,
        icon: commandByPath.get(entry.route)?.icon,
      })
      const result = []
      const favs = visibleFavorites(loadFavorites(), navIndex, canSeePath).map(toRow('fav'))
      if (favs.length) {
        result.push({ label: labelOr(t, 'ui.command.groups.favorites', 'Favourites'), items: favs.slice(0, 6) })
      }
      // Nav routes come from the shared trail the sidebar records, so the two
      // surfaces agree. RECORDS (a vehicle, a tyre, a job card) are not nav
      // routes and cannot live in that store, so they keep their own - see
      // navFavorites RECORD_RECENTS_KEY - and are permission-checked here
      // against the record source that produced them.
      const navRecents = visibleRecents(loadRecents(), navIndex, canSeePath).map(toRow('rec'))
      const recordRecents = visibleRecentRecords(loadRecentRecords(), canSeeRecord).map((r) => ({
        id: `rec-record:${r.path}`,
        label: r.label,
        path: r.path,
        icon: r.icon,
      }))
      // Each side gets a reserved half of the row budget so a busy week of
      // navigation cannot push every record out, or the other way round.
      const half = Math.ceil(MAX_RECENTS / 2)
      const recents = [...navRecents.slice(0, half), ...recordRecents.slice(0, half)]
        .slice(0, MAX_RECENTS)
      if (recents.length) result.push({ label: t('ui.command.groups.recent'), items: recents })
      if (actionCommands.length) result.push({ label: t('ui.command.groups.actions'), items: actionCommands })
      result.push({ label: t('ui.command.groups.navigation'), items: navCommands.slice(0, 8) })
      return result
    }
    // Typed query: ranking is unchanged, and shortcuts do not jump the queue.
    const result = []
    const commands = rankCommands([...actionCommands, ...navCommands], q, 8)
    if (commands.length) result.push({ label: t('ui.command.groups.commands'), items: commands })
    for (const g of recordGroups) result.push({ label: g.label, items: g.items })
    return result
    // `open` is deliberate and the exhaustive-deps warning about it is expected:
    // loadFavorites/loadRecents/loadRecent read localStorage, which the linter
    // cannot see, so reopening the palette is what re-reads a star pinned in the
    // sidebar while it was closed. Removing it serves a stale list.
  }, [query, open, navCommands, actionCommands, navIndex, canSeePath, canSeeRecord, commandByPath, recordGroups, t])

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => { setActiveIndex(0) }, [query, recordGroups])

  // ── Select ──────────────────────────────────────────────────────────────────
  const handleSelect = useCallback((item) => {
    // A RECORD hit carries the source it came from; a command does not. Keeping
    // the two in separate stores is the point: a record must never crowd the
    // nav-route trail the sidebar shares, and a command must never land in a
    // store whose rows are re-checked against a record source.
    if (item?.source) {
      pushRecentRecord({ label: item.label, path: item.path, source: item.source, icon: item.icon })
    } else {
      saveRecent(item)
    }
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

  if (!paletteEnabled || !open) return null

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

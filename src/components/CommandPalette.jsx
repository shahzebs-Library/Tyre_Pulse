import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  LayoutDashboard,
  CircleDot,
  ClipboardList,
  Bell,
  Package,
  Truck,
  FileText,
  ClipboardCheck,
  BarChart2,
  Target,
  Activity,
  TrendingUp,
  GitCompare,
  Cpu,
  Presentation,
  Zap,
  AlertTriangle,
  Heart,
  MapPin,
  Gauge,
  Wrench,
  Building2,
  Trash2,
  ArrowLeftRight,
  RefreshCw,
  ShoppingCart,
  Users,
  Shield,
  AlertCircle,
  RefreshCcw,
  Calendar,
  Radio,
  CalendarCheck,
  Upload,
  History,
  UserCog,
  Settings,
  QrCode,
  Tag,
} from 'lucide-react'
import { useCommandPalette } from '../contexts/CommandPaletteContext'

// ── Icon lookup map ───────────────────────────────────────────────────────────
const ICON_MAP = {
  LayoutDashboard,
  CircleDot,
  ClipboardList,
  Bell,
  Package,
  Truck,
  FileText,
  ClipboardCheck,
  BarChart2,
  Target,
  Activity,
  TrendingUp,
  GitCompare,
  Cpu,
  Presentation,
  Zap,
  Search,
  AlertTriangle,
  Heart,
  MapPin,
  Gauge,
  Wrench,
  Building2,
  Trash2,
  ArrowLeftRight,
  RefreshCw,
  ShoppingCart,
  Users,
  Shield,
  AlertCircle,
  RefreshCcw,
  Calendar,
  Radio,
  CalendarCheck,
  Upload,
  History,
  UserCog,
  Settings,
  QrCode,
  Tag,
}

// ── Nav items ─────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  // Core
  { id: 'dashboard',      label: 'Dashboard',              path: '/',                           icon: 'LayoutDashboard',  group: 'Navigation' },
  { id: 'tyres',          label: 'Tyre Records',           path: '/tyres',                      icon: 'CircleDot',        group: 'Navigation' },
  { id: 'inspections',    label: 'Inspections',            path: '/inspections',                icon: 'ClipboardList',    group: 'Navigation' },
  { id: 'alerts',         label: 'Alerts',                 path: '/alerts',                     icon: 'Bell',             group: 'Navigation' },
  { id: 'stock',          label: 'Stock Management',       path: '/stock',                      icon: 'Package',          group: 'Navigation' },
  { id: 'fleet-master',   label: 'Fleet Master',           path: '/fleet-master',               icon: 'Truck',            group: 'Navigation' },
  { id: 'reports',        label: 'Reports',                path: '/reports',                    icon: 'FileText',         group: 'Navigation' },
  { id: 'gate-pass',      label: 'Gate Pass',              path: '/gate-pass',                  icon: 'ClipboardCheck',   group: 'Navigation' },
  // Analytics
  { id: 'analytics',      label: 'Analytics',              path: '/analytics',                  icon: 'BarChart2',        group: 'Navigation' },
  { id: 'kpi',            label: 'KPI Scorecard',          path: '/kpi',                        icon: 'Target',           group: 'Navigation' },
  { id: 'fleet',          label: 'Fleet Analytics',        path: '/fleet',                      icon: 'Activity',         group: 'Navigation' },
  { id: 'brand-perf',     label: 'Brand Performance',      path: '/brand-perf',                 icon: 'TrendingUp',       group: 'Navigation' },
  { id: 'site-comp',      label: 'Site Comparison',        path: '/site-comp',                  icon: 'GitCompare',       group: 'Navigation' },
  { id: 'ai',             label: 'AI Analytics',           path: '/ai',                         icon: 'Cpu',              group: 'Navigation' },
  { id: 'executive-report', label: 'Executive Report',     path: '/executive-report',           icon: 'Presentation',     group: 'Navigation' },
  { id: 'forecasting',    label: 'Forecasting Engine',     path: '/forecasting',                icon: 'TrendingUp',       group: 'Navigation' },
  // Intelligence
  { id: 'predictive-maintenance', label: 'Predictive Maintenance', path: '/predictive-maintenance', icon: 'Zap',          group: 'Navigation' },
  { id: 'root-cause',     label: 'Root Cause Engine',      path: '/root-cause',                 icon: 'Search',           group: 'Navigation' },
  { id: 'anomalies',      label: 'Anomalies',              path: '/anomalies',                  icon: 'AlertTriangle',    group: 'Navigation' },
  { id: 'fleet-health',   label: 'Fleet Health Board',     path: '/fleet-health',               icon: 'Heart',            group: 'Navigation' },
  { id: 'ai-command-center', label: 'AI Command Center',   path: '/ai-command-center',          icon: 'Cpu',              group: 'Navigation' },
  { id: 'position-intelligence', label: 'Position Intelligence', path: '/position-intelligence', icon: 'MapPin',          group: 'Navigation' },
  { id: 'pressure-intel', label: 'Pressure Intelligence',  path: '/pressure-intel',             icon: 'Gauge',            group: 'Navigation' },
  // Operations
  { id: 'work-orders',    label: 'Work Orders',            path: '/work-orders',                icon: 'Wrench',           group: 'Navigation' },
  { id: 'workshop',       label: 'Workshop Management',    path: '/workshop',                   icon: 'Building2',        group: 'Navigation' },
  { id: 'scrap',          label: 'Tyre Scrap',             path: '/scrap',                      icon: 'Trash2',           group: 'Navigation' },
  { id: 'tyre-exchange',  label: 'Tyre Exchange',          path: '/tyre-exchange',              icon: 'ArrowLeftRight',   group: 'Navigation' },
  { id: 'retread',        label: 'Retread Management',     path: '/retread',                    icon: 'RefreshCw',        group: 'Navigation' },
  { id: 'procurement',    label: 'Procurement',            path: '/procurement',                icon: 'ShoppingCart',     group: 'Navigation' },
  { id: 'suppliers',      label: 'Supplier Management',    path: '/suppliers',                  icon: 'Users',            group: 'Navigation' },
  { id: 'warranty',       label: 'Warranty Tracker',       path: '/warranty',                   icon: 'Shield',           group: 'Navigation' },
  { id: 'recall-tracker', label: 'Recall Tracker',         path: '/recall-tracker',             icon: 'AlertCircle',      group: 'Navigation' },
  { id: 'rotation',       label: 'Rotation Schedule',      path: '/rotation',                   icon: 'RefreshCcw',       group: 'Navigation' },
  { id: 'daily-ops',      label: 'Daily Operations',       path: '/daily-ops',                  icon: 'Calendar',         group: 'Navigation' },
  { id: 'live-fleet',     label: 'Live Fleet Status',      path: '/live-fleet',                 icon: 'Radio',            group: 'Navigation' },
  { id: 'inspection-planner', label: 'Inspection Planner', path: '/inspection-planner',         icon: 'CalendarCheck',    group: 'Navigation' },
  // Data & Admin
  { id: 'upload',         label: 'Upload Data',            path: '/upload',                     icon: 'Upload',           group: 'Navigation' },
  { id: 'audit',          label: 'Audit Trail',            path: '/audit',                      icon: 'History',          group: 'Navigation' },
  { id: 'users',          label: 'User Management',        path: '/users',                      icon: 'UserCog',          group: 'Navigation' },
  { id: 'settings',       label: 'Settings',               path: '/settings',                   icon: 'Settings',         group: 'Navigation' },
  { id: 'scan',           label: 'Tyre Scan (QR)',         path: '/scan',                       icon: 'QrCode',           group: 'Navigation' },
  { id: 'qr-labels',      label: 'QR Labels',              path: '/qr-labels',                  icon: 'Tag',              group: 'Navigation' },
]

const ACTIONS = [
  { id: 'action-upload',   label: 'Upload Excel Data',    path: '/upload',   icon: 'Upload',   group: 'Actions' },
  { id: 'action-scan',     label: 'Scan a Tyre QR Code',  path: '/scan',     icon: 'QrCode',   group: 'Actions' },
  { id: 'action-settings', label: 'Open Settings',        path: '/settings', icon: 'Settings', group: 'Actions' },
  { id: 'action-alerts',   label: 'View Active Alerts',   path: '/alerts',   icon: 'Bell',     group: 'Actions' },
]

const ALL_SEARCHABLE = [...NAV_ITEMS, ...ACTIONS]

// ── localStorage helpers ──────────────────────────────────────────────────────
const STORAGE_KEY = 'tp_recent_commands'
const MAX_RECENT = 5

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveRecent(item) {
  try {
    const prev = loadRecent().filter((r) => r.id !== item.id)
    const next = [{ id: item.id, label: item.label, path: item.path, icon: item.icon, group: item.group }, ...prev].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // silently ignore storage errors
  }
}

// ── Icon renderer ─────────────────────────────────────────────────────────────
function ItemIcon({ name, size = 16 }) {
  const Icon = ICON_MAP[name]
  if (!Icon) return null
  return <Icon size={size} />
}

// ── Result item ───────────────────────────────────────────────────────────────
function ResultItem({ item, isActive, onSelect, onHover, index }) {
  const ref = useRef(null)

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isActive])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isActive}
      className={[
        'flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors',
        isActive
          ? 'bg-orange-500/10 text-white border-l-2 border-orange-500'
          : 'text-gray-300 border-l-2 border-transparent hover:bg-gray-800',
      ].join(' ')}
      onMouseEnter={() => onHover(index)}
      onMouseDown={(e) => {
        e.preventDefault()
        onSelect(item)
      }}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
        <ItemIcon name={item.icon} size={15} />
      </div>
      <span className="flex-1 text-sm font-medium truncate">{item.label}</span>
      <span className="text-[11px] text-gray-600 truncate hidden sm:block">{item.path}</span>
    </div>
  )
}

// ── Group header ──────────────────────────────────────────────────────────────
function GroupHeader({ label }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-4 py-2 mt-1 first:mt-0">
      {label}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CommandPalette() {
  const { open, setOpen } = useCommandPalette()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  // ── Ctrl/Cmd+K listener ───────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  // ── Focus input when opened ───────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // defer to next frame so the element is mounted
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // ── Build result groups ───────────────────────────────────────────────────
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()

    if (!q) {
      const recents = loadRecent()
      const result = []
      if (recents.length > 0) {
        result.push({ label: 'Recent', items: recents })
      }
      result.push({ label: 'Actions', items: ACTIONS })
      result.push({ label: 'Navigation', items: NAV_ITEMS.slice(0, 8) })
      return result
    }

    const matched = ALL_SEARCHABLE.filter((item) =>
      item.label.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
    )

    const byGroup = {}
    for (const item of matched) {
      if (!byGroup[item.group]) byGroup[item.group] = []
      byGroup[item.group].push(item)
    }

    // order: Recent first, then Navigation, then Actions
    const order = ['Recent', 'Navigation', 'Actions']
    return order
      .filter((g) => byGroup[g]?.length)
      .map((g) => ({ label: g, items: byGroup[g] }))
  }, [query, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // flat list for keyboard nav
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // reset active index when results change
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = flatItems[activeIndex]
        if (item) handleSelect(item)
        return
      }
    },
    [flatItems, activeIndex] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Select handler ────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (item) => {
      saveRecent(item)
      setOpen(false)
      navigate(item.path)
    },
    [navigate, setOpen]
  )

  if (!open) return null

  const hasResults = flatItems.length > 0

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="max-w-2xl w-full mx-4 mt-[15vh] h-fit">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

          {/* ── Search input bar ─────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 border-b border-gray-800">
            <Search size={18} className="text-gray-500 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Search pages, actions... (${isMac ? '⌘' : 'Ctrl'}K)`}
              className="flex-1 bg-transparent text-white text-lg py-4 outline-none placeholder:text-gray-500"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={hasResults}
              aria-autocomplete="list"
              aria-activedescendant={flatItems[activeIndex] ? `cp-item-${flatItems[activeIndex].id}` : undefined}
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 text-gray-500 text-[11px] font-mono border border-gray-700 select-none">
              Esc
            </kbd>
          </div>

          {/* ── Results list ─────────────────────────────────────────────── */}
          <div
            className="max-h-[60vh] overflow-y-auto overscroll-contain py-1"
            role="listbox"
            aria-label="Results"
          >
            {hasResults ? (
              (() => {
                let globalIndex = 0
                return groups.map((group) => (
                  <div key={group.label}>
                    <GroupHeader label={group.label} />
                    {group.items.map((item) => {
                      const idx = globalIndex++
                      return (
                        <ResultItem
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
                ))
              })()
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm">
                <Search size={32} className="mb-3 text-gray-700" />
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <div className="border-t border-gray-800 px-4 py-2.5 flex items-center gap-4 text-[11px] text-gray-600">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">↑</kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export { useCommandPalette }

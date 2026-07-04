// GlobalSearch.jsx - Cmd/Ctrl+K universal search across all TyrePulse data
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, X, CircleDot, Truck, ClipboardCheck,
  AlertTriangle, Wrench, Package, FileText,
  BarChart2, ChevronRight, Clock, Hash,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sanitizeSearchTerm } from '../lib/searchFilter'
import { useLanguage } from '../contexts/LanguageContext'

const CATEGORY_CONFIG = {
  tyres:       { label: 'Tyre Records',   icon: CircleDot,     color: 'text-green-400',  route: '/tyres' },
  vehicles:    { label: 'Vehicles',       icon: Truck,         color: 'text-blue-400',   route: '/fleet-master' },
  inspections: { label: 'Inspections',    icon: ClipboardCheck,color: 'text-yellow-400', route: '/inspections' },
  alerts:      { label: 'Alerts',         icon: AlertTriangle, color: 'text-red-400',    route: '/alerts' },
  workorders:  { label: 'Work Orders',    icon: Wrench,        color: 'text-orange-400', route: '/work-orders' },
  stock:       { label: 'Stock',          icon: Package,       color: 'text-purple-400', route: '/stock' },
  reports:     { label: 'Reports',        icon: FileText,      color: 'text-teal-400',   route: '/reports' },
}

const NAV_SHORTCUTS = [
  { label: 'Dashboard',            route: '/',                       icon: BarChart2 },
  { label: 'Engineering KPIs',     route: '/kpi-engine',             icon: BarChart2 },
  { label: 'AI Command Center',    route: '/ai-command-center',      icon: BarChart2 },
  { label: 'Executive Report',     route: '/executive-report',       icon: FileText },
  { label: 'Predictive Maintenance', route: '/predictive-maintenance', icon: ClipboardCheck },
  { label: 'Vendor Intelligence',  route: '/vendor-intelligence',    icon: BarChart2 },
  { label: 'Fleet Intelligence',   route: '/fleet-intelligence',     icon: Truck },
  { label: 'Forecasting Engine',   route: '/forecasting',            icon: BarChart2 },
  { label: 'Root Cause Engine',    route: '/root-cause',             icon: AlertTriangle },
  { label: 'Position Intelligence', route: '/position-intelligence', icon: BarChart2 },
  { label: 'Inspection Intelligence', route: '/inspection-intelligence', icon: ClipboardCheck },
  { label: 'Advanced Analytics',   route: '/advanced-analytics',     icon: BarChart2 },
  { label: 'Continuous Improvement', route: '/continuous-improvement', icon: BarChart2 },
  { label: 'ERP Sync',             route: '/erp-sync',               icon: BarChart2 },
  { label: 'Work Orders',          route: '/work-orders',            icon: Wrench },
  { label: 'Tyre Records',         route: '/tyres',                  icon: CircleDot },
  { label: 'Alerts',               route: '/alerts',                 icon: AlertTriangle },
  { label: 'Inspections',          route: '/inspections',            icon: ClipboardCheck },
  { label: 'Fleet Master',         route: '/fleet-master',           icon: Truck },
  { label: 'Stock Management',     route: '/stock',                  icon: Package },
  { label: 'Reports',              route: '/reports',                icon: FileText },
  { label: 'Settings',             route: '/settings',               icon: BarChart2 },
]

function highlight(text, query) {
  if (!query || !text) return <span>{text || ''}</span>
  const parts = String(text).split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <span>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">{p}</mark>
          : p
      )}
    </span>
  )
}

// ── Search engine ─────────────────────────────────────────────────────────────
async function searchAll(query) {
  if (!query || query.length < 2) return {}
  const q = sanitizeSearchTerm(query)
  if (q.length < 2) return {}
  const results = {}

  const [tyres, vehicles, inspections, workOrders, stock] = await Promise.allSettled([
    // Tyre records
    supabase.from('tyre_records')
      .select('id, serial_number, asset_number, brand, risk_level')
      .or(`serial_number.ilike.%${q}%,asset_number.ilike.%${q}%,brand.ilike.%${q}%`)
      .limit(6),
    // Vehicles
    supabase.from('vehicles')
      .select('id, asset_no, vehicle_type, make, model, site')
      .or(`asset_no.ilike.%${q}%,make.ilike.%${q}%,model.ilike.%${q}%`)
      .limit(6),
    // Inspections
    supabase.from('inspections')
      .select('id, asset_no, inspector, inspection_date, site')
      .or(`asset_no.ilike.%${q}%,inspector.ilike.%${q}%`)
      .limit(6),
    // Work orders
    supabase.from('work_orders')
      .select('id, work_order_no, asset_no, work_type, status')
      .or(`work_order_no.ilike.%${q}%,asset_no.ilike.%${q}%,description.ilike.%${q}%`)
      .limit(6),
    // Stock
    supabase.from('stock')
      .select('id, brand, size, quantity, site')
      .or(`brand.ilike.%${q}%,size.ilike.%${q}%,site.ilike.%${q}%`)
      .limit(4),
  ])

  if (tyres.status === 'fulfilled' && tyres.value.data?.length) {
    results.tyres = tyres.value.data.map(r => ({
      id: r.id,
      primary: r.serial_number,
      secondary: `${r.asset_number || '-'} · ${r.brand || '-'}`,
      badge: r.risk_level,
      badgeColor: r.risk_level === 'Critical' ? 'text-red-400' : r.risk_level === 'High' ? 'text-orange-400' : 'text-gray-400',
      route: '/tyres',
    }))
  }
  if (vehicles.status === 'fulfilled' && vehicles.value.data?.length) {
    results.vehicles = vehicles.value.data.map(r => ({
      id: r.id,
      primary: r.asset_no,
      secondary: `${r.make || ''} ${r.model || ''} · ${r.site || '-'}`.trim(),
      badge: r.vehicle_type,
      badgeColor: 'text-blue-400',
      route: '/fleet-master',
    }))
  }
  if (inspections.status === 'fulfilled' && inspections.value.data?.length) {
    results.inspections = inspections.value.data.map(r => ({
      id: r.id,
      primary: r.asset_no,
      secondary: `${r.inspector || '-'} · ${r.inspection_date ? new Date(r.inspection_date).toLocaleDateString('en-US') : '-'}`,
      badge: r.site,
      badgeColor: 'text-yellow-400',
      route: '/inspections',
    }))
  }
  if (workOrders.status === 'fulfilled' && workOrders.value.data?.length) {
    results.workorders = workOrders.value.data.map(r => ({
      id: r.id,
      primary: r.work_order_no,
      secondary: `${r.asset_no} · ${r.work_type}`,
      badge: r.status,
      badgeColor: r.status === 'Open' ? 'text-blue-400' : r.status === 'Completed' ? 'text-green-400' : 'text-gray-400',
      route: '/work-orders',
    }))
  }
  if (stock.status === 'fulfilled' && stock.value.data?.length) {
    results.stock = stock.value.data.map(r => ({
      id: r.id,
      primary: `${r.brand || '-'} ${r.size || ''}`.trim(),
      secondary: `${r.site || '-'} · Qty: ${r.quantity ?? '-'}`,
      badge: null,
      badgeColor: '',
      route: '/stock',
    }))
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GlobalSearch({ isOpen, onClose }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({})
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery(''); setResults({}); setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Debounced search
  useEffect(() => {
    if (!isOpen) return
    clearTimeout(timerRef.current)
    if (!query.trim() || query.length < 2) { setResults({}); setSearching(false); return }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      const r = await searchAll(query)
      setResults(r)
      setSearching(false)
      setSelected(0)
    }, 280)
    return () => clearTimeout(timerRef.current)
  }, [query, isOpen])

  // Filtered nav shortcuts
  const navMatches = useMemo(() => {
    if (!query.trim()) return NAV_SHORTCUTS.slice(0, 6)
    return NAV_SHORTCUTS.filter(n => n.label.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
  }, [query])

  // Flat list of all selectable items for keyboard nav
  const flatItems = useMemo(() => {
    const items = []
    if (!query.trim() || Object.keys(results).length === 0) {
      navMatches.forEach(n => items.push({ type: 'nav', data: n }))
    } else {
      Object.entries(results).forEach(([cat, rows]) => {
        rows.forEach(r => items.push({ type: 'result', cat, data: r }))
      })
      navMatches.forEach(n => items.push({ type: 'nav', data: n }))
    }
    return items
  }, [results, navMatches, query])

  function selectItem(item) {
    if (item.type === 'nav') navigate(item.data.route)
    else navigate(item.data.route)
    onClose()
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flatItems.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter') { if (flatItems[selected]) selectItem(flatItems[selected]); return }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, flatItems, selected])

  const hasResults = Object.keys(results).some(k => results[k]?.length > 0)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            initial={{ scale: 0.96, y: -8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: -8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 400 }}
            className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800">
              {searching
                ? <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                : <Search size={20} className="text-gray-400 flex-shrink-0" />
              }
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('ui.search.placeholder')}
                className="flex-1 bg-transparent text-white text-base placeholder-gray-500 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="p-1 rounded text-gray-500 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              )}
              <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-500 text-xs">
                <span>esc</span>
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[65vh] overflow-y-auto">
              {/* Recent / Nav shortcuts */}
              {(!query.trim() || (!hasResults && query.length >= 2)) && navMatches.length > 0 && (
                <div className="p-3">
                  <div className="flex items-center gap-2 px-2 mb-2">
                    {!query.trim() ? <Clock size={13} className="text-gray-600" /> : <Hash size={13} className="text-gray-600" />}
                    <span className="text-gray-500 text-xs uppercase tracking-wider font-medium">
                      {!query.trim() ? t('ui.search.quickNavigation') : t('ui.search.pages')}
                    </span>
                  </div>
                  {navMatches.map((n, idx) => {
                    const Icon = n.icon
                    const itemIdx = flatItems.findIndex(f => f.type === 'nav' && f.data.route === n.route)
                    return (
                      <button key={n.route} onClick={() => selectItem({ type: 'nav', data: n })}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${itemIdx === selected ? 'bg-blue-600/20 border border-blue-700/50' : 'hover:bg-gray-800'}`}>
                        <Icon size={16} className="text-gray-400 flex-shrink-0" />
                        <span className="text-gray-200 text-sm">{!query.trim() ? n.label : highlight(n.label, query)}</span>
                        <ChevronRight size={14} className="text-gray-600 ml-auto" />
                      </button>
                    )
                  })}
                </div>
              )}

              {/* DB results */}
              {hasResults && (
                <div className="p-3 space-y-4">
                  {Object.entries(results).map(([cat, rows]) => {
                    if (!rows?.length) return null
                    const cfg = CATEGORY_CONFIG[cat]
                    const Icon = cfg?.icon || Search
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 px-2 mb-2">
                          <Icon size={13} className={cfg?.color || 'text-gray-400'} />
                          <span className="text-gray-500 text-xs uppercase tracking-wider font-medium">{cfg?.label || cat}</span>
                          <span className="text-gray-600 text-xs ml-auto">{t('ui.search.results', { count: rows.length })}</span>
                        </div>
                        {rows.map(r => {
                          const itemIdx = flatItems.findIndex(f => f.type === 'result' && f.data.id === r.id && f.cat === cat)
                          return (
                            <button key={r.id} onClick={() => selectItem({ type: 'result', cat, data: r })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${itemIdx === selected ? 'bg-blue-600/20 border border-blue-700/50' : 'hover:bg-gray-800'}`}>
                              <div className="flex-1 min-w-0">
                                <div className="text-white text-sm font-medium truncate">{highlight(r.primary, query)}</div>
                                <div className="text-gray-400 text-xs truncate">{highlight(r.secondary, query)}</div>
                              </div>
                              {r.badge && <span className={`text-xs font-medium ${r.badgeColor} flex-shrink-0`}>{r.badge}</span>}
                              <ChevronRight size={14} className="text-gray-600 flex-shrink-0" />
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}

                  {/* Page shortcuts at bottom */}
                  {navMatches.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 px-2 mb-2">
                        <Hash size={13} className="text-gray-600" />
                        <span className="text-gray-500 text-xs uppercase tracking-wider font-medium">{t('ui.search.pages')}</span>
                      </div>
                      {navMatches.map(n => {
                        const Icon = n.icon
                        const itemIdx = flatItems.findIndex(f => f.type === 'nav' && f.data.route === n.route)
                        return (
                          <button key={n.route} onClick={() => selectItem({ type: 'nav', data: n })}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${itemIdx === selected ? 'bg-blue-600/20 border border-blue-700/50' : 'hover:bg-gray-800'}`}>
                            <Icon size={15} className="text-gray-500 flex-shrink-0" />
                            <span className="text-gray-300 text-sm">{highlight(n.label, query)}</span>
                            <ChevronRight size={13} className="text-gray-600 ml-auto" />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* No results */}
              {!searching && query.length >= 2 && !hasResults && navMatches.length === 0 && (
                <div className="py-16 text-center">
                  <Search size={36} className="mx-auto text-gray-700 mb-3" />
                  <p className="text-gray-400 text-sm">{t('ui.search.noResultsFor')} <strong className="text-white">"{query}"</strong></p>
                  <p className="text-gray-600 text-xs mt-1">{t('ui.search.noResultsHint')}</p>
                </div>
              )}

              {/* Empty state */}
              {!query.trim() && navMatches.length === 0 && (
                <div className="py-12 text-center">
                  <Search size={36} className="mx-auto text-gray-700 mb-3" />
                  <p className="text-gray-500 text-sm">{t('ui.search.emptyPrompt')}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-950">
              <div className="flex items-center gap-4 text-gray-600 text-xs">
                <span className="flex items-center gap-1"><kbd className="px-1 bg-gray-800 border border-gray-700 rounded text-xs">↑↓</kbd> {t('ui.hints.navigate')}</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 bg-gray-800 border border-gray-700 rounded text-xs">↵</kbd> {t('ui.hints.select')}</span>
                <span className="flex items-center gap-1"><kbd className="px-1 bg-gray-800 border border-gray-700 rounded text-xs">esc</kbd> {t('ui.hints.close')}</span>
              </div>
              <span className="text-gray-600 text-xs">
                {hasResults ? t('ui.search.recordsFound', { count: Object.values(results).flat().length }) : t('ui.search.brand')}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

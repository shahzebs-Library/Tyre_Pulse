// ─────────────────────────────────────────────────────────────────────────────
// MaintenanceCalendar.jsx - Visual Maintenance Calendar · /maintenance-calendar
// Combines Work Orders (target_completion) + Tyre Alerts (risk-based) into a
// unified month/week/day calendar with KPI cards and upcoming events sidebar.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar, ChevronLeft, ChevronRight, Clock, AlertTriangle,
  Wrench, CircleDot, Filter, RefreshCw, X, CheckCircle,
  AlertOctagon, Loader2, Eye, ChevronDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'

// ── Constants ─────────────────────────────────────────────────────────────────
const DAY_NAMES    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES  = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const EVENT_COLORS = {
  work_order:          { dot: 'bg-blue-500',   chip: 'bg-blue-900/60 border-blue-700 text-blue-300',    label: 'Work Order' },
  critical_tyre:       { dot: 'bg-red-500',    chip: 'bg-red-900/60 border-red-700 text-red-300',       label: 'Critical Tyre' },
  high_risk_tyre:      { dot: 'bg-orange-500', chip: 'bg-orange-900/60 border-orange-700 text-orange-300', label: 'High Risk Tyre' },
  scheduled_maint:     { dot: 'bg-green-500',  chip: 'bg-green-900/60 border-green-700 text-green-300', label: 'Scheduled Maint.' },
  overdue_work_order:  { dot: 'bg-red-600',    chip: 'bg-red-950/70 border-red-600 text-red-200',       label: 'Overdue' },
}

const PRIORITY_BADGE = {
  Critical: 'bg-red-900/50 text-red-300 border-red-700',
  High:     'bg-orange-900/50 text-orange-300 border-orange-700',
  Medium:   'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  Low:      'bg-blue-900/50 text-blue-300 border-blue-700',
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toDateStr(d) {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 10)
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function fmtDisplay(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShort(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
}

// ── Event builders ────────────────────────────────────────────────────────────
function buildWorkOrderEvents(orders, todayStr) {
  return orders
    .filter(o => o.target_completion)
    .map(o => {
      const dateStr = toDateStr(o.target_completion)
      if (!dateStr) return null
      const isOverdue = dateStr < todayStr &&
        !['Completed', 'Closed', 'Cancelled'].includes(o.status)
      return {
        id:          `wo-${o.id}`,
        date:        dateStr,
        type:        isOverdue ? 'overdue_work_order' : 'work_order',
        priority:    o.priority || 'Medium',
        title:       o.work_order_no || 'Work Order',
        subtitle:    `${o.asset_no || '-'} · ${o.work_type || '-'}`,
        asset:       o.asset_no || '-',
        description: o.description || o.work_type || '-',
        status:      o.status,
        isOverdue,
        raw:         o,
        source:      'work_order',
      }
    })
    .filter(Boolean)
}

function buildTyreEvents(tyres, todayStr) {
  const today = new Date(todayStr + 'T00:00:00')
  return tyres
    .filter(t => ['Critical', 'High'].includes(t.risk_level))
    .map(t => {
      // Estimate replacement date:
      //  - Tread depth <= 3mm → urgent: today + 3
      //  - Critical risk, no removal km → today + 7
      //  - High risk → today + 14
      let daysOffset = 14
      if (t.risk_level === 'Critical') daysOffset = 7
      if (parseFloat(t.tread_depth) <= 3) daysOffset = 3

      const targetDate = addDays(today, daysOffset)
      const dateStr = toDateStr(targetDate)
      const type = t.risk_level === 'Critical' ? 'critical_tyre' : 'high_risk_tyre'
      return {
        id:          `tyre-${t.id}`,
        date:        dateStr,
        type,
        priority:    t.risk_level === 'Critical' ? 'Critical' : 'High',
        title:       `${t.asset_no || t.asset_number || '-'}`,
        subtitle:    `${t.risk_level} Risk · ${t.brand || '-'}`,
        asset:       t.asset_no || t.asset_number || '-',
        description: `Tread: ${t.tread_depth ?? '?'}mm · Brand: ${t.brand || '-'} · Serial: ${t.serial_no || '-'}`,
        status:      'Pending Replacement',
        isOverdue:   false,
        raw:         t,
        source:      'tyre',
      }
    })
    .filter(e => e.date !== null)
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MaintenanceCalendar() {
  const { activeCountry } = useSettings()

  // Data
  const [workOrders, setWorkOrders] = useState([])
  const [tyreRecords, setTyreRecords] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  // Calendar state
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const todayStr = useMemo(() => toDateStr(today), [today])

  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [view, setView]               = useState('month') // 'month' | 'week' | 'day'
  const [selectedDay, setSelectedDay] = useState(null)    // Date | null
  const [selectedEvent, setSelectedEvent] = useState(null)

  // Filters
  const [typeFilter, setTypeFilter]   = useState('All')  // 'All' | 'Work Orders' | 'Tyre Alerts'
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [showFilters, setShowFilters] = useState(false)

  // ── Load data ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [woRes, tyreRes] = await Promise.all([
        (() => {
          let q = supabase
            .from('work_orders')
            .select('id,work_order_no,asset_no,work_type,priority,status,target_completion,description,site,country,opened_at')
            .not('target_completion', 'is', null)
            .order('target_completion', { ascending: true })
          if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
          return q
        })(),
        (() => {
          let q = supabase
            .from('tyre_records')
            .select('id,asset_no,asset_number,serial_no,brand,risk_level,tread_depth,km_at_fitment,km_at_removal,site,country,issue_date')
            .in('risk_level', ['Critical', 'High'])
            .is('km_at_removal', null)     // still mounted
          if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
          return q.limit(500)
        })(),
      ])

      if (woRes.error) throw woRes.error
      if (tyreRes.error) throw tyreRes.error

      setWorkOrders(woRes.data || [])
      setTyreRecords(tyreRes.data || [])
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Build unified events ─────────────────────────────────────────────────────
  const allEvents = useMemo(() => {
    const woEvents   = buildWorkOrderEvents(workOrders, todayStr)
    const tyreEvents = buildTyreEvents(tyreRecords, todayStr)
    return [...woEvents, ...tyreEvents]
  }, [workOrders, tyreRecords, todayStr])

  // Apply filters
  const filteredEvents = useMemo(() => {
    let ev = allEvents
    if (typeFilter === 'Work Orders') ev = ev.filter(e => e.source === 'work_order')
    if (typeFilter === 'Tyre Alerts') ev = ev.filter(e => e.source === 'tyre')
    if (priorityFilter !== 'All') ev = ev.filter(e => e.priority === priorityFilter)
    return ev
  }, [allEvents, typeFilter, priorityFilter])

  // Bucket events by date string for O(1) lookup
  const eventsByDate = useMemo(() => {
    const map = {}
    filteredEvents.forEach(ev => {
      if (!map[ev.date]) map[ev.date] = []
      map[ev.date].push(ev)
    })
    return map
  }, [filteredEvents])

  // ── KPI computation ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay())
    const weekEnd = addDays(weekStart, 6)
    const next30End = addDays(today, 30)

    const eventsThisWeek = filteredEvents.filter(e => {
      const d = new Date(e.date + 'T00:00:00')
      return d >= weekStart && d <= weekEnd
    }).length

    const overdue = filteredEvents.filter(e => e.isOverdue).length

    const upcoming30 = filteredEvents.filter(e => {
      const d = new Date(e.date + 'T00:00:00')
      return d >= today && d <= next30End
    }).length

    const criticalToday = filteredEvents.filter(e =>
      e.date === todayStr && e.priority === 'Critical'
    ).length

    return { eventsThisWeek, overdue, upcoming30, criticalToday }
  }, [filteredEvents, today, todayStr])

  // ── Upcoming 14-day sidebar list ─────────────────────────────────────────────
  const upcomingEvents = useMemo(() => {
    const end14 = addDays(today, 14)
    return filteredEvents
      .filter(e => {
        const d = new Date(e.date + 'T00:00:00')
        return d >= today && d <= end14
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 50)
  }, [filteredEvents, today])

  // ── Calendar grid helpers ────────────────────────────────────────────────────
  // Month view: 6 × 7 grid
  const monthCells = useMemo(() => {
    if (view !== 'month') return []
    const year  = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const startCol = firstDay.getDay() // 0 = Sunday

    const cells = []
    // Leading empty cells from previous month
    const prevMonthEnd = new Date(year, month, 0)
    for (let i = startCol - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthEnd.getDate() - i)
      cells.push({ date: d, inMonth: false })
    }
    // Days of current month
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), inMonth: true })
    }
    // Trailing cells
    const remaining = 42 - cells.length
    for (let d = 1; d <= remaining; d++) {
      cells.push({ date: new Date(year, month + 1, d), inMonth: false })
    }
    return cells
  }, [currentDate, view])

  // Week view: Mon-Sun (or Sun-Sat, we'll use Sun start)
  const weekDays = useMemo(() => {
    if (view !== 'week') return []
    const base = view === 'week' ? currentDate : today
    // find Sunday of current week
    const d = new Date(base)
    d.setDate(d.getDate() - d.getDay())
    return Array.from({ length: 7 }, (_, i) => addDays(d, i))
  }, [currentDate, view, today])

  // Day view
  const dayEvents = useMemo(() => {
    if (view !== 'day') return []
    const ds = toDateStr(selectedDay || currentDate)
    return (eventsByDate[ds] || []).sort((a, b) => {
      const pOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 }
      return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3)
    })
  }, [view, selectedDay, currentDate, eventsByDate])

  // ── Navigation ───────────────────────────────────────────────────────────────
  function navPrev() {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (view === 'month') d.setMonth(d.getMonth() - 1)
      else if (view === 'week') d.setDate(d.getDate() - 7)
      else d.setDate(d.getDate() - 1)
      return d
    })
  }

  function navNext() {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (view === 'month') d.setMonth(d.getMonth() + 1)
      else if (view === 'week') d.setDate(d.getDate() + 7)
      else d.setDate(d.getDate() + 1)
      return d
    })
  }

  function goToday() {
    const d = new Date()
    d.setDate(view === 'month' ? 1 : d.getDate())
    d.setHours(0, 0, 0, 0)
    setCurrentDate(d)
    setSelectedDay(today)
  }

  // ── Period label ─────────────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (view === 'month') {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    }
    if (view === 'week') {
      const sun = new Date(currentDate)
      sun.setDate(sun.getDate() - sun.getDay())
      const sat = addDays(sun, 6)
      return `${fmtShort(toDateStr(sun))} - ${fmtShort(toDateStr(sat))} ${sat.getFullYear()}`
    }
    const d = selectedDay || currentDate
    return fmtDisplay(toDateStr(d))
  }, [view, currentDate, selectedDay])

  // ── Event chip renderer ───────────────────────────────────────────────────────
  function EventChip({ event, compact = false }) {
    const cfg = EVENT_COLORS[event.type] || EVENT_COLORS.work_order
    return (
      <button
        onClick={e => { e.stopPropagation(); setSelectedEvent(event) }}
        className={`w-full text-left px-1.5 py-0.5 rounded border text-[10px] leading-tight truncate flex items-center gap-1 transition-opacity hover:opacity-80 ${cfg.chip}`}
        title={`${event.title} · ${event.subtitle}`}
      >
        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        <span className="truncate font-medium">{event.title}</span>
        {!compact && <span className="truncate text-[9px] opacity-70">{event.subtitle}</span>}
      </button>
    )
  }

  // ── Loading / error states ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="animate-spin text-green-400 mx-auto mb-3" size={36} />
          <p className="text-[var(--text-muted)] text-sm">Loading maintenance calendar...</p>
        </div>
      </div>
    )
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-10">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Maintenance Calendar"
        subtitle={`Unified view of work orders and tyre alerts · ${filteredEvents.length} events${lastRefresh ? ` · Updated ${lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        icon={Calendar}
        actions={<>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
              showFilters ? 'bg-green-900/30 border-green-700 text-green-300' : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Filter size={15} />Filters
            {(typeFilter !== 'All' || priorityFilter !== 'All') && (
              <span className="w-2 h-2 rounded-full bg-green-400" />
            )}
          </button>
          <button
            onClick={load}
            className="p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </>}
      />

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3 text-red-300">
          <AlertTriangle size={18} />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X size={16} /></button>
        </div>
      )}

      {/* ── Filter panel ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-muted)] text-xs font-medium">Type:</span>
                {['All', 'Work Orders', 'Tyre Alerts'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setTypeFilter(opt)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      typeFilter === opt
                        ? 'bg-green-900/40 border-green-700 text-green-300'
                        : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >{opt}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-muted)] text-xs font-medium">Priority:</span>
                {['All', 'Critical', 'High', 'Medium', 'Low'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setPriorityFilter(opt)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      priorityFilter === opt
                        ? 'bg-green-900/40 border-green-700 text-green-300'
                        : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >{opt}</button>
                ))}
              </div>
              {(typeFilter !== 'All' || priorityFilter !== 'All') && (
                <button
                  onClick={() => { setTypeFilter('All'); setPriorityFilter('All') }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-red-700 text-red-400 bg-red-900/20 hover:bg-red-900/40 transition-colors"
                >
                  Clear Filters
                </button>
              )}
              <span className="ml-auto text-[var(--text-muted)] text-xs">{filteredEvents.length} matching events</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Events This Week',
            value: kpis.eventsThisWeek,
            icon: Calendar,
            color: 'blue',
            dotColor: 'bg-blue-500',
            desc: 'Scheduled this week',
          },
          {
            label: 'Overdue',
            value: kpis.overdue,
            icon: AlertOctagon,
            color: 'red',
            dotColor: 'bg-red-500',
            desc: 'Past target, not completed',
          },
          {
            label: 'Upcoming 30 Days',
            value: kpis.upcoming30,
            icon: Clock,
            color: 'green',
            dotColor: 'bg-green-500',
            desc: 'Events in next 30 days',
          },
          {
            label: 'Critical Alerts Today',
            value: kpis.criticalToday,
            icon: AlertTriangle,
            color: 'orange',
            dotColor: 'bg-orange-500',
            desc: 'Require immediate action',
          },
        ].map(({ label, value, icon: Icon, color, dotColor, desc }) => (
          <motion.div
            key={label}
            whileHover={{ y: -2 }}
            className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 relative overflow-hidden"
          >
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-5 ${dotColor}`}
              style={{ transform: 'translate(30%, -30%)' }} />
            <div className="flex items-center gap-2 mb-3">
              <Icon size={16} className={`text-${color}-400`} />
              <span className="text-[var(--text-muted)] text-xs font-medium">{label}</span>
            </div>
            <div className={`text-3xl font-bold text-${color}-400 mb-1`}>{value}</div>
            <div className="text-[var(--text-dim)] text-xs">{desc}</div>
          </motion.div>
        ))}
      </div>

      {/* ── Main layout: Calendar + Sidebar ─────────────────────────────────── */}
      <div className="flex gap-5 items-start">

        {/* ── Calendar panel ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">

          {/* Calendar toolbar */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--input-border)]">
            <div className="flex items-center gap-2">
              <button
                onClick={navPrev}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={navNext}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] transition-colors"
              >
                <ChevronRight size={18} />
              </button>
              <button
                onClick={goToday}
                className="px-3 py-1 text-xs font-semibold rounded-lg border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-gray-500 transition-colors ml-1"
              >
                Today
              </button>
              <h2 className="text-[var(--text-primary)] font-semibold text-base ml-2 min-w-[180px]">{periodLabel}</h2>
            </div>
            {/* View switcher */}
            <div className="flex items-center gap-1 bg-[var(--input-bg)] rounded-lg p-1">
              {['month', 'week', 'day'].map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    view === v
                      ? 'bg-green-700 text-white shadow'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* ── MONTH VIEW ─────────────────────────────────────────────────────── */}
          {view === 'month' && (
            <div>
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-[var(--input-border)]">
                {DAY_NAMES.map(d => (
                  <div key={d} className="px-2 py-2 text-center text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider">
                    {d}
                  </div>
                ))}
              </div>
              {/* Cells */}
              <div className="grid grid-cols-7">
                {monthCells.map((cell, idx) => {
                  const ds = toDateStr(cell.date)
                  const dayEvents = eventsByDate[ds] || []
                  const isToday   = isSameDay(cell.date, today)
                  const isSelected = selectedDay && isSameDay(cell.date, selectedDay)
                  const MAX_CHIPS = 3

                  return (
                    <div
                      key={idx}
                      onClick={() => { setSelectedDay(cell.date); if (view !== 'day') {} }}
                      className={`min-h-[100px] p-1.5 border-b border-r border-[var(--input-border)] cursor-pointer transition-colors ${
                        cell.inMonth ? 'bg-[var(--surface-1)]' : 'bg-[var(--input-bg)]/50'
                      } ${isSelected ? 'ring-1 ring-inset ring-green-600' : 'hover:bg-[var(--input-bg)]/40'}`}
                    >
                      {/* Day number */}
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                          isToday
                            ? 'bg-green-600 text-white'
                            : cell.inMonth
                            ? 'text-[var(--text-secondary)]'
                            : 'text-[var(--text-dim)]'
                        }`}>
                          {cell.date.getDate()}
                        </span>
                        {dayEvents.length > 0 && (
                          <span className="text-[9px] text-[var(--text-dim)] font-medium">
                            {dayEvents.length}
                          </span>
                        )}
                      </div>
                      {/* Event chips */}
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, MAX_CHIPS).map(ev => (
                          <EventChip key={ev.id} event={ev} compact />
                        ))}
                        {dayEvents.length > MAX_CHIPS && (
                          <button
                            onClick={e => { e.stopPropagation(); setSelectedDay(cell.date); setView('day') }}
                            className="w-full text-left px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                          >
                            +{dayEvents.length - MAX_CHIPS} more
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── WEEK VIEW ──────────────────────────────────────────────────────── */}
          {view === 'week' && (
            <div>
              {/* Column headers */}
              <div className="grid grid-cols-7 border-b border-[var(--input-border)]">
                {weekDays.map((d, i) => {
                  const ds = toDateStr(d)
                  const count = (eventsByDate[ds] || []).length
                  const isTod = isSameDay(d, today)
                  return (
                    <div
                      key={i}
                      className={`px-2 py-3 text-center border-r border-[var(--input-border)] last:border-r-0 ${
                        isTod ? 'bg-green-900/10' : ''
                      }`}
                    >
                      <div className="text-[var(--text-muted)] text-[11px] font-semibold uppercase mb-1">{DAY_NAMES[d.getDay()]}</div>
                      <div className={`mx-auto w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${
                        isTod ? 'bg-green-600 text-white' : 'text-[var(--text-primary)]'
                      }`}>
                        {d.getDate()}
                      </div>
                      {count > 0 && (
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{count} event{count > 1 ? 's' : ''}</div>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Event rows per day */}
              <div className="grid grid-cols-7 min-h-[320px]">
                {weekDays.map((d, i) => {
                  const ds = toDateStr(d)
                  const dayEvs = eventsByDate[ds] || []
                  const isTod = isSameDay(d, today)
                  return (
                    <div
                      key={i}
                      onClick={() => { setSelectedDay(d) }}
                      className={`p-2 border-r border-[var(--input-border)] last:border-r-0 cursor-pointer transition-colors hover:bg-[var(--input-bg)]/30 ${
                        isTod ? 'bg-green-900/5' : ''
                      }`}
                    >
                      {dayEvs.length === 0 && (
                        <div className="h-full flex items-center justify-center">
                          <span className="text-[var(--text-dim)] text-xs">-</span>
                        </div>
                      )}
                      <div className="space-y-1">
                        {dayEvs.map(ev => (
                          <EventChip key={ev.id} event={ev} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── DAY VIEW ───────────────────────────────────────────────────────── */}
          {view === 'day' && (
            <div className="p-5">
              {/* Day header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-[var(--text-primary)] font-semibold text-lg">
                    {(selectedDay || currentDate).toLocaleDateString('en-US', {
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </h3>
                  <p className="text-[var(--text-muted)] text-sm">{dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''} scheduled</p>
                </div>
              </div>

              {dayEvents.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle size={40} className="mx-auto mb-3 text-green-800 opacity-40" />
                  <p className="text-[var(--text-muted)]">No events scheduled for this day</p>
                  <p className="text-[var(--text-dim)] text-sm mt-1">Navigate to a day with events or select from the calendar</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {dayEvents.map(ev => {
                    const cfg = EVENT_COLORS[ev.type] || EVENT_COLORS.work_order
                    const pbadge = PRIORITY_BADGE[ev.priority] || PRIORITY_BADGE.Medium
                    return (
                      <motion.div
                        key={ev.id}
                        whileHover={{ x: 3 }}
                        onClick={() => setSelectedEvent(ev)}
                        className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-colors hover:bg-gray-800/50 ${cfg.chip}`}
                      >
                        <div className={`flex-shrink-0 w-3 h-3 rounded-full mt-1 ${cfg.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-semibold text-sm">{ev.title}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${pbadge}`}>{ev.priority}</span>
                            {ev.isOverdue && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-700 bg-red-900/40 text-red-300 font-medium">OVERDUE</span>
                            )}
                          </div>
                          <p className="text-gray-400 text-xs mt-0.5">{ev.subtitle}</p>
                          <p className="text-gray-500 text-xs mt-1 truncate">{ev.description}</p>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cfg.chip}`}>
                            {EVENT_COLORS[ev.type]?.label || ev.type}
                          </span>
                          <Eye size={14} className="text-gray-600" />
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="px-5 py-3 border-t border-[var(--input-border)] flex flex-wrap gap-4">
            {Object.entries(EVENT_COLORS).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                <span className="text-[var(--text-muted)] text-[11px]">{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Upcoming Events Sidebar ─────────────────────────────────────────── */}
        <div className="w-80 flex-shrink-0 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[var(--input-border)] flex items-center justify-between">
            <div>
              <h3 className="text-[var(--text-primary)] font-semibold text-sm">Upcoming Events</h3>
              <p className="text-[var(--text-muted)] text-xs">Next 14 days · {upcomingEvents.length} events</p>
            </div>
            <Clock size={16} className="text-[var(--text-dim)]" />
          </div>

          <div className="overflow-y-auto max-h-[640px]">
            {upcomingEvents.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle size={32} className="mx-auto mb-2 text-green-800 opacity-40" />
                <p className="text-[var(--text-muted)] text-sm">No upcoming events</p>
              </div>
            ) : (
              <div>
                {(() => {
                  // Group by date
                  const grouped = {}
                  upcomingEvents.forEach(ev => {
                    if (!grouped[ev.date]) grouped[ev.date] = []
                    grouped[ev.date].push(ev)
                  })
                  return Object.entries(grouped).map(([date, events]) => {
                    const isToday = date === todayStr
                    return (
                      <div key={date}>
                        <div className={`px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider sticky top-0 z-10 ${
                          isToday
                            ? 'bg-green-900/30 text-green-400 border-b border-green-900'
                            : 'bg-[var(--surface-1)]/95 text-[var(--text-muted)] border-b border-[var(--input-border)]'
                        }`}>
                          {isToday ? '📅 Today' : fmtDisplay(date)}
                        </div>
                        {events.map(ev => {
                          const cfg = EVENT_COLORS[ev.type] || EVENT_COLORS.work_order
                          const pbadge = PRIORITY_BADGE[ev.priority] || PRIORITY_BADGE.Medium
                          return (
                            <button
                              key={ev.id}
                              onClick={() => setSelectedEvent(ev)}
                              className="w-full text-left px-4 py-2.5 border-b border-[var(--input-border)] hover:bg-[var(--input-bg)]/50 transition-colors flex items-start gap-2.5"
                            >
                              <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1 ${cfg.dot}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[var(--text-primary)] text-xs font-medium truncate">{ev.title}</span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${pbadge}`}>{ev.priority}</span>
                                </div>
                                <p className="text-[var(--text-muted)] text-[11px] truncate mt-0.5">{ev.subtitle}</p>
                              </div>
                              {ev.isOverdue && (
                                <span className="flex-shrink-0 text-[9px] text-red-400 font-bold">OVR</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Event Detail Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedEvent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setSelectedEvent(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 16 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              {/* Modal header */}
              <div className={`px-5 py-4 border-b border-gray-800 flex items-start justify-between ${
                EVENT_COLORS[selectedEvent.type]?.chip || 'bg-gray-800'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${EVENT_COLORS[selectedEvent.type]?.dot || 'bg-gray-500'}`} />
                  <div>
                    <h3 className="text-white font-bold">{selectedEvent.title}</h3>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {EVENT_COLORS[selectedEvent.type]?.label} · {fmtDisplay(selectedEvent.date)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-4">
                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${PRIORITY_BADGE[selectedEvent.priority] || PRIORITY_BADGE.Medium}`}>
                    {selectedEvent.priority} Priority
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-secondary)]">
                    {selectedEvent.status}
                  </span>
                  {selectedEvent.isOverdue && (
                    <span className="text-xs px-2.5 py-1 rounded-full border border-red-700 bg-red-900/40 text-red-300 font-semibold">
                      OVERDUE
                    </span>
                  )}
                </div>

                {/* Details grid */}
                <div className="space-y-2.5">
                  {[
                    ['Asset',       selectedEvent.asset],
                    ['Description', selectedEvent.description],
                    ['Date',        fmtDisplay(selectedEvent.date)],
                    selectedEvent.source === 'work_order' && selectedEvent.raw?.work_order_no
                      ? ['Work Order #', selectedEvent.raw.work_order_no]
                      : null,
                    selectedEvent.source === 'work_order' && selectedEvent.raw?.work_type
                      ? ['Work Type', selectedEvent.raw.work_type]
                      : null,
                    selectedEvent.source === 'work_order' && selectedEvent.raw?.technician_name
                      ? ['Technician', selectedEvent.raw.technician_name]
                      : null,
                    selectedEvent.source === 'work_order' && selectedEvent.raw?.workshop_name
                      ? ['Workshop', selectedEvent.raw.workshop_name]
                      : null,
                    selectedEvent.source === 'tyre' && selectedEvent.raw?.serial_no
                      ? ['Serial No', selectedEvent.raw.serial_no]
                      : null,
                    selectedEvent.source === 'tyre' && selectedEvent.raw?.brand
                      ? ['Brand', selectedEvent.raw.brand]
                      : null,
                    selectedEvent.source === 'tyre' && selectedEvent.raw?.tread_depth != null
                      ? ['Tread Depth', `${selectedEvent.raw.tread_depth} mm`]
                      : null,
                    selectedEvent.raw?.site
                      ? ['Site', selectedEvent.raw.site]
                      : null,
                  ].filter(Boolean).map(([label, value]) => (
                    <div key={label} className="flex justify-between py-2 border-b border-[var(--input-border)]">
                      <span className="text-[var(--text-muted)] text-sm">{label}</span>
                      <span className="text-[var(--text-primary)] text-sm font-medium text-right max-w-[220px] truncate">{value || '-'}</span>
                    </div>
                  ))}
                </div>

                {/* Action row */}
                <div className="flex gap-3 pt-1">
                  {selectedEvent.source === 'work_order' && (
                    <a
                      href="/work-orders"
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-colors"
                      onClick={() => setSelectedEvent(null)}
                    >
                      <Wrench size={15} /> View Work Order
                    </a>
                  )}
                  {selectedEvent.source === 'tyre' && (
                    <a
                      href="/tyres"
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-700 hover:bg-orange-600 text-white text-sm font-medium rounded-xl transition-colors"
                      onClick={() => setSelectedEvent(null)}
                    >
                      <CircleDot size={15} /> View Tyre Record
                    </a>
                  )}
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="btn-secondary"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Maintenance Calendar (route /maintenance-calendar) rebuilt on the Command
 * Center kit. One calendar over three real sources:
 *  - work orders with a target completion date (overdue when past and not done),
 *  - at-risk tyres still fitted (Critical / High). Tyres carry no scheduled date,
 *    so their replacement date is an ESTIMATE from today and is labelled so,
 *  - active Preventive Maintenance plans by next due date (overdue in red).
 * Reads page past the 1000-row server cap, so the KPI counts cover every row;
 * when a safety ceiling is reached the page says so instead of undercounting
 * silently. Shaping lives in src/lib/maintenanceCalendarView.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, AlertTriangle, AlertOctagon,
  CalendarRange, CalendarCheck, Wrench, CircleDot, ClipboardCheck, RefreshCw,
  FileSpreadsheet, Search, X, Lock, Info, Eye,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { adjacentCalendarDate } from '../lib/calendarDate'
import { toUserMessage } from '../lib/safeError'
import { listPmPrograms } from '../lib/api/pmPrograms'
import { exportToExcel, reportFileName } from '../lib/exportUtils'
import { useSettings } from '../contexts/SettingsContext'
import Modal from '../components/ui/Modal'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { PageHero, Kpi, Card, CardState, Tabs, Donut, fmtInt } from '../components/commandCenter/kit'
import {
  DAY_NAMES, MONTH_NAMES, EVENT_TYPES, LEGEND_ORDER, SOURCE_OPTIONS, PRIORITIES,
  startOfDay, addDays, dayKey, fmtDay, fmtDayLong,
  buildEvents, filterEvents, activeFilterCount, siteOptions, sortByPriority, groupByDate,
  agendaGroups, calendarKpis, sourceBreakdown, monthCells, weekDays, periodLabel, viewRange,
  exportRows, EXPORT_COLUMNS, EXPORT_HEADERS,
} from '../lib/maintenanceCalendarView'
import './MaintenanceCalendar.css'

const WO_CEILING = 20000
const TYRE_CEILING = 5000
const MAX_CHIPS = 3
const VIEW_TABS = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
  { key: 'agenda', label: 'Agenda' },
]
const PRIORITY_PILL = { Critical: 'bad', High: 'orange', Medium: 'warn', Low: 'info' }
const NARROW_QUERY = '(max-width: 760px)'

function useNarrow() {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY).matches : false)
  const [narrow, setNarrow] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(NARROW_QUERY)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return narrow
}

function fmtTime(d) {
  return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''
}

export default function MaintenanceCalendar() {
  const { activeCountry, appSettings } = useSettings()
  const narrow = useNarrow()

  // ── Data ───────────────────────────────────────────────────────────────
  const [workOrders, setWorkOrders] = useState([])
  const [tyreRecords, setTyreRecords] = useState([])
  const [pmPrograms, setPmPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pmError, setPmError] = useState(null)
  const [truncated, setTruncated] = useState({ wo: false, tyre: false })
  const [lastRefresh, setLastRefresh] = useState(null)
  const [exportError, setExportError] = useState('')

  const today = useMemo(() => startOfDay(new Date()), [])
  const todayKey = dayKey(today)

  // ── Calendar state ─────────────────────────────────────────────────────
  const [currentDate, setCurrentDate] = useState(() => {
    const d = startOfDay(new Date())
    d.setDate(1)
    return d
  })
  const [view, setView] = useState('month')
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
  const [selectedEvent, setSelectedEvent] = useState(null)
  // Approval gate: locks the open event's jump-to-record while its workflow is
  // active or locked. Re-reported by EntityApprovalPanel.
  const [wfLocked, setWfLocked] = useState(false)

  // ── Filters ────────────────────────────────────────────────────────────
  const [source, setSource] = useState('All')
  const [priority, setPriority] = useState('All')
  const [site, setSite] = useState('All')
  const [search, setSearch] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPmError(null)
    try {
      const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
      const [woRes, tyreRes, pmRes] = await Promise.all([
        // Paged past the 1000-row cap so the KPI counts cover every work order.
        fetchAllPages((from, to) => {
          let q = supabase
            .from('work_orders')
            .select('id,work_order_no,asset_no,work_type,priority,status,target_completion,description,site,country,opened_at')
            .not('target_completion', 'is', null)
            .order('target_completion', { ascending: true })
            .order('id')
          if (country) q = q.eq('country', country)
          return q.range(from, to)
        }, { max: WO_CEILING }),
        fetchAllPages((from, to) => {
          let q = supabase
            .from('tyre_records')
            .select('id,asset_no,asset_number,serial_no,brand,risk_level,tread_depth,km_at_fitment,km_at_removal,site,country,issue_date')
            .in('risk_level', ['Critical', 'High'])
            .is('km_at_removal', null) // still mounted
            .order('id')
          if (country) q = q.eq('country', country)
          return q.range(from, to)
        }, { max: TYRE_CEILING }),
        // PM plans degrade on their own: a failed plan read must not hide the
        // work orders and tyres, but it is reported, never shown as "no plans".
        listPmPrograms({ country: activeCountry }).then((rows) => ({ rows }), (e) => ({ err: e })),
      ])
      if (woRes.error) throw woRes.error
      if (tyreRes.error) throw tyreRes.error
      setWorkOrders(woRes.data || [])
      setTyreRecords(tyreRes.data || [])
      setTruncated({ wo: !!woRes.truncated, tyre: !!tyreRes.truncated })
      if (pmRes.err) {
        setPmPrograms([])
        setPmError(toUserMessage(pmRes.err, 'Preventive maintenance plans could not be loaded.'))
      } else {
        setPmPrograms(Array.isArray(pmRes.rows) ? pmRes.rows : [])
      }
      setLastRefresh(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the maintenance calendar.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { setWfLocked(false) }, [selectedEvent?.id])

  // ── Events ─────────────────────────────────────────────────────────────
  const allEvents = useMemo(
    () => buildEvents({ workOrders, tyres: tyreRecords, pmPrograms, today }),
    [workOrders, tyreRecords, pmPrograms, today],
  )
  const sites = useMemo(() => siteOptions(allEvents), [allEvents])
  const filters = { source, priority, site, search }
  const filteredEvents = useMemo(() => {
    const base = filterEvents(allEvents, { source, priority, site, search })
    return overdueOnly ? base.filter((e) => e.isOverdue) : base
  }, [allEvents, source, priority, site, search, overdueOnly])
  const nFilters = activeFilterCount(filters) + (overdueOnly ? 1 : 0)
  const clearFilters = () => { setSource('All'); setPriority('All'); setSite('All'); setSearch(''); setOverdueOnly(false) }

  const eventsByDate = useMemo(() => groupByDate(filteredEvents), [filteredEvents])
  const kpis = useMemo(() => calendarKpis(filteredEvents, today, currentDate), [filteredEvents, today, currentDate])
  const breakdown = useMemo(() => sourceBreakdown(filteredEvents), [filteredEvents])

  // On a phone the month and week grids collapse to the agenda list.
  const effectiveView = narrow && (view === 'month' || view === 'week') ? 'agenda' : view
  const range = useMemo(() => viewRange(effectiveView, currentDate, selectedDay), [effectiveView, currentDate, selectedDay])
  const cells = useMemo(() => monthCells(currentDate), [currentDate])
  const week = useMemo(() => weekDays(currentDate), [currentDate])
  const agenda = useMemo(() => agendaGroups(filteredEvents, range.from, range.to), [filteredEvents, range])
  const overdueOutside = useMemo(
    () => filteredEvents.filter((e) => e.isOverdue && e.date < range.from).length,
    [filteredEvents, range],
  )
  const selectedKey = dayKey(selectedDay || currentDate)
  const selectedEvents = eventsByDate[selectedKey] || []
  const upcoming = useMemo(
    () => agendaGroups(filteredEvents, todayKey, dayKey(addDays(today, 14))),
    [filteredEvents, todayKey, today],
  )
  const upcomingCount = upcoming.reduce((s, g) => s + g.events.length, 0)
  const label = periodLabel(effectiveView, currentDate, selectedDay)

  // ── Navigation ─────────────────────────────────────────────────────────
  const navView = effectiveView === 'agenda' ? 'month' : effectiveView
  function nav(dir) {
    const next = adjacentCalendarDate(currentDate, selectedDay, navView, dir)
    if (navView === 'day') { setSelectedDay(startOfDay(next)); setCurrentDate(startOfDay(next)) } else setCurrentDate(next)
  }
  function goToday() {
    const d = startOfDay(new Date())
    if (navView === 'month') d.setDate(1)
    setCurrentDate(d)
    setSelectedDay(startOfDay(new Date()))
  }
  function openDay(date) {
    setSelectedDay(startOfDay(date))
    setCurrentDate(startOfDay(date))
    setView('day')
  }

  async function doExport() {
    setExportError('')
    try {
      await exportToExcel(
        exportRows(filteredEvents), EXPORT_COLUMNS, EXPORT_HEADERS,
        reportFileName('Maintenance Calendar', activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries', fmtDay(todayKey)),
        'Events',
        { title: 'Maintenance Calendar', company: appSettings?.company_name },
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'The export could not be created.'))
    }
  }

  const loadState = { loading, data: loading ? null : true, error, retry: load }

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderChip = (ev) => (
    <button
      key={ev.id}
      type="button"
      className={`mc-chip tone-${EVENT_TYPES[ev.type]?.tone || 'blue'}`}
      onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev) }}
      title={`${ev.title} | ${ev.subtitle}`}
    >
      <i aria-hidden="true" />
      <span>{ev.title}</span>
    </button>
  )

  const renderRow = (ev) => (
    <li key={ev.id}>
      <button type="button" className={`mc-ev tone-${EVENT_TYPES[ev.type]?.tone || 'blue'}`} onClick={() => setSelectedEvent(ev)}>
        <i className="mc-ev-bar" aria-hidden="true" />
        <span className="mc-ev-main">
          <b>{ev.title}</b>
          <small>{ev.subtitle}{ev.site ? ` | ${ev.site}` : ''}</small>
        </span>
        <span className="mc-ev-side">
          <span className={`cc-pill ${PRIORITY_PILL[ev.priority] || 'muted'}`}>{ev.priority}</span>
          {ev.isOverdue && <span className="cc-pill bad">Overdue</span>}
          {ev.estimated && <span className="cc-pill muted" title="Tyres have no scheduled date. This date is estimated from the risk level and tread.">Estimated</span>}
        </span>
      </button>
    </li>
  )

  const legend = (
    <ul className="mc-legend" aria-label="Legend">
      {LEGEND_ORDER.map((k) => (
        <li key={k} className={`tone-${EVENT_TYPES[k].tone}`}><i aria-hidden="true" />{EVENT_TYPES[k].label}</li>
      ))}
    </ul>
  )

  const donutSegments = [
    { label: 'Work orders', count: breakdown.work_order, color: 'var(--cc-blue)', key: 'work_order' },
    { label: 'Tyre alerts', count: breakdown.tyre, color: 'var(--cc-orange)', key: 'tyre' },
    { label: 'PM plans', count: breakdown.pm_plan, color: 'var(--mc-indigo)', key: 'pm_plan' },
  ]

  return (
    <div className="cc mc-page">
      <PageHero
        icon={CalendarDays}
        title="Maintenance Calendar"
        lead="Work orders, tyre replacements and preventive maintenance plans on one calendar, so nothing due slips past its date."
        stat={{ value: loading ? '...' : fmtInt(kpis.overdue), lines: ['Overdue', 'events'] }}
      />

      <Card>
        <div className="cc-filters mc-filters">
          <label className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, work order, plan or site" aria-label="Search events" />
          </label>
          <label className="cc-field">
            <span>Source</span>
            <select className="cc-select" value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Priority</span>
            <select className="cc-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="All">All priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Site</span>
            <select className="cc-select" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="All">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="mc-actions">
            {nFilters > 0 && (
              <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" />Clear ({nFilters})</button>
            )}
            <button type="button" className="cc-btn-ghost" onClick={doExport} disabled={loading || !filteredEvents.length}>
              <FileSpreadsheet size={15} aria-hidden="true" />Excel
            </button>
            <button type="button" className="cc-icon-btn" onClick={load} aria-label="Refresh" title="Refresh" disabled={loading}>
              <RefreshCw size={15} className={loading ? 'mc-spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mc-scope">
          {loading ? 'Loading events...' : `${fmtInt(filteredEvents.length)} of ${fmtInt(allEvents.length)} events shown`}
          {overdueOnly && ' | Overdue only'}
          {lastRefresh && ` | Updated ${fmtTime(lastRefresh)}`}
        </p>
        {exportError && <p className="mc-note bad" role="alert">{exportError}</p>}
      </Card>

      {(truncated.wo || truncated.tyre || pmError) && (
        <div className="mc-banner" role="status">
          <Info size={16} aria-hidden="true" />
          <div>
            {truncated.wo && <p>Only the first {fmtInt(WO_CEILING)} work orders with a target date were loaded. Counts may be low; pick a country to narrow the read.</p>}
            {truncated.tyre && <p>Only the first {fmtInt(TYRE_CEILING)} at-risk tyres were loaded. Counts may be low; pick a country to narrow the read.</p>}
            {pmError && <p>{pmError} Plans are missing from the calendar until this loads. <button type="button" className="cc-link cc-link-btn" onClick={load}>Retry</button></p>}
          </div>
        </div>
      )}

      <div className="cc-kpis mc-kpis">
        <Kpi icon={AlertOctagon} tone="t-red" value={kpis.overdue} label="Overdue" loading={loading} danger={kpis.overdue > 0}
          onClick={() => { setOverdueOnly((v) => !v); setView('agenda') }}
          title={overdueOnly ? 'Show all events' : 'Show overdue events only'} />
        <Kpi icon={CalendarRange} tone="t-amber" value={kpis.dueThisWeek} label="Due this week" loading={loading} />
        <Kpi icon={Clock} tone="t-green" value={kpis.upcoming30} label="Upcoming 30 days" loading={loading} />
        <Kpi icon={CalendarCheck} tone="t-blue" value={kpis.thisMonth} label={`Events in ${MONTH_NAMES[currentDate.getMonth()]}`} loading={loading} />
        <Kpi icon={AlertTriangle} tone="t-orange" value={kpis.criticalToday} label="Critical today" loading={loading} />
      </div>

      <div className="mc-grid">
        <Card className="mc-cal">
          <div className="mc-toolbar">
            <div className="mc-nav">
              <button type="button" className="cc-icon-btn" onClick={() => nav(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
              <button type="button" className="cc-icon-btn" onClick={() => nav(1)} aria-label="Next"><ChevronRight size={16} /></button>
              <button type="button" className="cc-btn-ghost mc-today" onClick={goToday}>Today</button>
              <h2 className="mc-period">{label}</h2>
            </div>
            <Tabs tabs={narrow ? VIEW_TABS.filter((t) => t.key === 'day' || t.key === 'agenda') : VIEW_TABS} value={effectiveView} onChange={setView} label="Calendar view" />
          </div>

          <CardState state={loadState} lines={8}>
            {effectiveView === 'month' && (
              <div className="mc-month" role="grid" aria-label={label}>
                <div className="mc-dow" role="row">{DAY_NAMES.map((d) => <span key={d} role="columnheader">{d}</span>)}</div>
                <div className="mc-cells">
                  {cells.map((c) => {
                    const evs = eventsByDate[c.key] || []
                    const isToday = c.key === todayKey
                    const isSel = c.key === selectedKey
                    const hasOverdue = evs.some((e) => e.isOverdue)
                    return (
                      <div
                        key={c.key}
                        role="gridcell"
                        tabIndex={0}
                        aria-label={`${fmtDayLong(c.key)}, ${evs.length} events`}
                        aria-selected={isSel}
                        className={`mc-cell${c.inMonth ? '' : ' out'}${isToday ? ' today' : ''}${isSel ? ' sel' : ''}${hasOverdue ? ' has-overdue' : ''}`}
                        onClick={() => setSelectedDay(startOfDay(c.date))}
                        onDoubleClick={() => openDay(c.date)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDay(startOfDay(c.date)) } }}
                      >
                        <div className="mc-cell-head">
                          <span className="mc-num">{c.date.getDate()}</span>
                          {evs.length > 0 && <span className="mc-cnt">{evs.length}</span>}
                        </div>
                        <div className="mc-chips">
                          {evs.slice(0, MAX_CHIPS).map((ev) => renderChip(ev))}
                          {evs.length > MAX_CHIPS && (
                            <button type="button" className="mc-more" onClick={(e) => { e.stopPropagation(); openDay(c.date) }}>
                              {evs.length - MAX_CHIPS} more
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {effectiveView === 'week' && (
              <div className="mc-week">
                {week.map((d) => {
                  const k = dayKey(d)
                  const evs = eventsByDate[k] || []
                  return (
                    <div key={k} className={`mc-wcol${k === todayKey ? ' today' : ''}${k === selectedKey ? ' sel' : ''}`}>
                      <button type="button" className="mc-whead" onClick={() => openDay(d)}>
                        <span>{DAY_NAMES[d.getDay()]}</span>
                        <b>{d.getDate()}</b>
                        <small>{evs.length ? `${evs.length} event${evs.length > 1 ? 's' : ''}` : 'Free'}</small>
                      </button>
                      <div className="mc-wbody">
                        {evs.map((ev) => renderChip(ev))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {effectiveView === 'day' && (
              <div className="mc-day">
                <p className="mc-day-sub">{fmtInt(selectedEvents.length)} event{selectedEvents.length === 1 ? '' : 's'} on {fmtDayLong(selectedKey)}</p>
                {selectedEvents.length === 0
                  ? <div className="cc-empty">Nothing is due on this day. Use the arrows or pick a day from the month view.</div>
                  : <ul className="mc-evlist">{sortByPriority(selectedEvents).map((ev) => renderRow(ev))}</ul>}
              </div>
            )}

            {effectiveView === 'agenda' && (
              <div className="mc-agenda">
                {overdueOutside > 0 && !overdueOnly && (
                  <button type="button" className="mc-overdue-note" onClick={() => setOverdueOnly(true)}>
                    <AlertOctagon size={14} aria-hidden="true" />
                    {fmtInt(overdueOutside)} overdue event{overdueOutside === 1 ? '' : 's'} dated before {fmtDay(range.from)}. Show overdue only
                  </button>
                )}
                {overdueOnly ? (
                  (() => {
                    const groups = agendaGroups(filteredEvents, '0000-01-01', '9999-12-31')
                    return groups.length === 0
                      ? <div className="cc-empty">No overdue events. Everything due is on track.</div>
                      : groups.map((g) => (
                        <section key={g.date} className="mc-agroup">
                          <h3 className={g.date === todayKey ? 'today' : ''}>{g.date === todayKey ? 'Today' : fmtDayLong(g.date)}</h3>
                          <ul className="mc-evlist">{g.events.map((ev) => renderRow(ev))}</ul>
                        </section>
                      ))
                  })()
                ) : agenda.length === 0 ? (
                  <div className="cc-empty">No events between {fmtDay(range.from)} and {fmtDay(range.to)}{nFilters ? ' for these filters' : ''}.</div>
                ) : agenda.map((g) => (
                  <section key={g.date} className="mc-agroup">
                    <h3 className={g.date === todayKey ? 'today' : ''}>{g.date === todayKey ? 'Today' : fmtDayLong(g.date)}</h3>
                    <ul className="mc-evlist">{g.events.map((ev) => renderRow(ev))}</ul>
                  </section>
                ))}
              </div>
            )}
          </CardState>

          {legend}
          {breakdown.tyre > 0 && (
            <p className="mc-note"><Info size={12} aria-hidden="true" /> Tyre dates are estimated: tread at or under 3 mm in 3 days, Critical in 7, High in 14.</p>
          )}
        </Card>

        <div className="mc-side">
          {effectiveView !== 'day' && (
            <Card title={selectedKey === todayKey ? 'Today' : fmtDayLong(selectedKey)} sub={`${fmtInt(selectedEvents.length)} event${selectedEvents.length === 1 ? '' : 's'}`}
              action={<button type="button" className="cc-link cc-link-btn" onClick={() => setView('day')}>Open day <Eye size={13} aria-hidden="true" /></button>}>
              <CardState state={loadState} lines={3} empty={!loading && !error && selectedEvents.length === 0 ? 'Nothing due on this day.' : null}>
                <ul className="mc-evlist compact">{selectedEvents.slice(0, 6).map((ev) => renderRow(ev))}</ul>
                {selectedEvents.length > 6 && <button type="button" className="cc-link cc-link-btn mc-seeall" onClick={() => setView('day')}>See all {selectedEvents.length}</button>}
              </CardState>
            </Card>
          )}

          {!narrow && (
          <Card title="Next 14 days" sub={`${fmtInt(upcomingCount)} event${upcomingCount === 1 ? '' : 's'}`}>
            <CardState state={loadState} lines={4} empty={!loading && !error && upcomingCount === 0 ? 'Nothing due in the next 14 days.' : null}>
              <div className="mc-upcoming">
                {upcoming.map((g) => (
                  <section key={g.date} className="mc-agroup">
                    <h3 className={g.date === todayKey ? 'today' : ''}>{g.date === todayKey ? 'Today' : fmtDay(g.date)}</h3>
                    <ul className="mc-evlist compact">{g.events.map((ev) => renderRow(ev))}</ul>
                  </section>
                ))}
              </div>
            </CardState>
          </Card>

          )}

          <Card title="By source" sub="Events matching the filters">
            <CardState state={loadState} lines={3}>
              <Donut
                segments={donutSegments}
                centerLabel="Events"
                onSelect={(s) => setSource((cur) => (cur === s.key ? 'All' : s.key))}
              />
            </CardState>
          </Card>
        </div>
      </div>

      <Modal
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        size="md"
        title={selectedEvent ? (
          <span className="mc-modal-title">
            <i className={`mc-dot tone-${EVENT_TYPES[selectedEvent.type]?.tone || 'blue'}`} aria-hidden="true" />
            {selectedEvent.title}
          </span>
        ) : null}
        subtitle={selectedEvent ? `${EVENT_TYPES[selectedEvent.type]?.label || ''} | ${fmtDay(selectedEvent.date)}` : null}
      >
        {selectedEvent && (
          <div className="cc mc-modal">
            <div className="mc-badges">
              <span className={`cc-pill ${PRIORITY_PILL[selectedEvent.priority] || 'muted'}`}>{selectedEvent.priority} priority</span>
              {selectedEvent.status && <span className="cc-pill muted">{selectedEvent.status}</span>}
              {selectedEvent.isOverdue && <span className="cc-pill bad">Overdue</span>}
              {selectedEvent.estimated && <span className="cc-pill muted">Estimated date</span>}
            </div>

            <dl className="mc-dl">
              {[
                ['Asset', selectedEvent.asset],
                ['Details', selectedEvent.description],
                ['Date', fmtDay(selectedEvent.date)],
                selectedEvent.source === 'work_order' ? ['Work order', selectedEvent.raw?.work_order_no] : null,
                selectedEvent.source === 'work_order' ? ['Work type', selectedEvent.raw?.work_type] : null,
                selectedEvent.source === 'work_order' && selectedEvent.raw?.technician_name ? ['Technician', selectedEvent.raw.technician_name] : null,
                selectedEvent.source === 'work_order' && selectedEvent.raw?.workshop_name ? ['Workshop', selectedEvent.raw.workshop_name] : null,
                selectedEvent.source === 'tyre' ? ['Serial no', selectedEvent.raw?.serial_no] : null,
                selectedEvent.source === 'tyre' ? ['Brand', selectedEvent.raw?.brand] : null,
                selectedEvent.source === 'tyre' && selectedEvent.raw?.tread_depth != null ? ['Tread depth', `${selectedEvent.raw.tread_depth} mm`] : null,
                selectedEvent.source === 'pm_plan' && selectedEvent.raw?.interval_value != null && selectedEvent.raw?.interval_type
                  ? ['Interval', `Every ${selectedEvent.raw.interval_value} ${selectedEvent.raw.interval_type}`] : null,
                selectedEvent.source === 'pm_plan' && selectedEvent.raw?.next_due ? ['Next due', fmtDay(dayKey(selectedEvent.raw.next_due))] : null,
                selectedEvent.source === 'pm_plan' && selectedEvent.raw?.last_done ? ['Last done', fmtDay(dayKey(selectedEvent.raw.last_done))] : null,
                selectedEvent.source === 'pm_plan' && selectedEvent.raw?.assigned_to ? ['Assigned to', selectedEvent.raw.assigned_to] : null,
                ['Site', selectedEvent.site],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v || <span className="cc-na">N/A</span>}</dd></div>
              ))}
            </dl>

            <EntityApprovalPanel
              entityType="maintenance_request"
              entityId={selectedEvent.raw?.id ?? selectedEvent.id}
              entityLabel={selectedEvent.asset || selectedEvent.title || selectedEvent.id}
              context={{
                cost: selectedEvent.raw?.estimated_cost ?? selectedEvent.raw?.cost ?? null,
                priority: selectedEvent.priority,
                downtime_hours: selectedEvent.raw?.downtime_hours ?? null,
                asset_no: selectedEvent.asset,
                site: selectedEvent.raw?.site ?? null,
              }}
              onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
              title="Maintenance Approval"
            />

            {wfLocked && <p className="mc-locked"><Lock size={12} aria-hidden="true" /> Locked, in approval</p>}

            <div className="mc-modal-foot">
              {(() => {
                const target = {
                  work_order: { to: '/work-orders', label: 'View work order', Icon: Wrench },
                  tyre: { to: '/tyres', label: 'View tyre record', Icon: CircleDot },
                  pm_plan: { to: '/pm-programs', label: 'View PM plan', Icon: ClipboardCheck },
                }[selectedEvent.source]
                if (!target) return null
                const { Icon } = target
                return wfLocked ? (
                  <button type="button" className="cc-btn-primary" disabled title="Locked, in approval"><Lock size={15} aria-hidden="true" />{target.label}</button>
                ) : (
                  <Link to={target.to} className="cc-btn-primary" onClick={() => setSelectedEvent(null)}><Icon size={15} aria-hidden="true" />{target.label}</Link>
                )
              })()}
              <button type="button" className="cc-btn-ghost" onClick={() => setSelectedEvent(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

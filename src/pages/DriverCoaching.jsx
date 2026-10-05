/**
 * DriverCoaching (route /driver-coaching) - Driver Coaching, rebuilt on the
 * shared Command Center kit to the owner's mockup: photo hero, five headline
 * tiles, the coaching queue ranked by risk, a driver details panel with score
 * trend and latest session, fleet behaviour trends and the session board.
 *
 * Runs on the `driver_coaching` table (V187): one scorecard per driver per
 * period. Real data only. The table records no site, vehicle, session date,
 * due date, speeding, seatbelt or phone-use figure, so those parts of the
 * mockup say "Not recorded" instead of showing a number. Every capability of
 * the previous page is kept: create, edit, delete, coaching status changes,
 * filters, search, Excel/PDF export and the leaderboard (second tab).
 *
 * Shaping lives in src/lib/driverCoachingView.js (queue, trends, headline) on
 * top of src/lib/driverCoachingAnalytics.js (honest score, leaderboard).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Users, AlertTriangle, Clock, TrendingUp, ClipboardList, Plus, Pencil, Trash2,
  FileSpreadsheet, FileText, Search, X, RefreshCw, ChevronLeft, ChevronRight,
  GraduationCap, Play, CalendarDays, CheckCircle2, Trophy, Medal, Award, Zap, Info,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, PageHero, Tabs, KitTable, fmtInt } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverCoaching, createDriverCoaching, updateDriverCoaching, deleteDriverCoaching,
} from '../lib/api/driverCoaching'
import {
  honestLeaderboard, enrichCoaching, filterCoaching, bandDistribution,
  periodOptions as buildPeriodOptions, coachingExport, scoreOf,
  STATUS_OPTIONS, STATUS_LABEL, COACHING_THRESHOLD,
} from '../lib/driverCoachingAnalytics'
import {
  buildCoachingQueue, filterQueue, driverHistory, scoreTrend, latestSession, driverTotals,
  coachingHeadline, behaviourTrends, RISK_LABEL, RISK_OPTIONS,
} from '../lib/driverCoachingView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './DriverCoaching.css'

const EMPTY_FORM = {
  driver_name: '', period: '', safety_score: '', fuel_score: '', harsh_events: '',
  idling_min: '', distance_km: '', coaching_status: 'none', coach: '',
  coaching_notes: '', improvement_pct: '', notes: '',
}
const RISK_PILL = { high: 'bad', medium: 'warn', low: 'good', unscored: 'muted' }
const STATUS_PILL = { none: 'muted', recommended: 'warn', scheduled: 'info', completed: 'good' }
const MEDAL = { 1: Trophy, 2: Medal, 3: Award }

const fmtNum = (v, suffix = '') => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString('en-US')}${suffix}`)
const fmtScore = (v) => (v == null ? 'N/A' : Number(v).toFixed(1))
const scoreTone = (s) => (s == null ? 'muted' : s >= 80 ? 'good' : s >= COACHING_THRESHOLD ? 'warn' : 'bad')
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'

function Avatar({ name, size = 'sm' }) {
  return <span className={`dco-avatar dco-avatar-${size}`} aria-hidden="true">{initials(name)}</span>
}

/** Score line across a driver's periods. Drawn only with two or more points. */
function ScoreLine({ points }) {
  if (points.length < 2) return null
  const W = 320; const H = 130; const pad = 22
  const x = (i) => pad + (i * (W - pad * 2)) / (points.length - 1)
  const y = (v) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dco-line" role="img" aria-label={points.map((p) => `${p.label} ${p.score.toFixed(1)}`).join(', ')}>
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} className="dco-grid" />
          <text x={4} y={y(g) + 3} className="dco-axis">{g}</text>
        </g>
      ))}
      <line x1={pad} x2={W - pad} y1={y(COACHING_THRESHOLD)} y2={y(COACHING_THRESHOLD)} className="dco-threshold" />
      <path d={d} className="dco-path" />
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle cx={x(i)} cy={y(p.score)} r="4" className={`dco-pt ${scoreTone(p.score)}`} />
          <text x={x(i)} y={H - 4} textAnchor="middle" className="dco-axis">{p.label}</text>
        </g>
      ))}
    </svg>
  )
}

/** Mini bar chart per period for one behaviour. Bars only for measured periods. */
function MiniBars({ series, unit }) {
  const vals = series.map((s) => s.value).filter((v) => v != null)
  if (!vals.length) return <p className="dco-mini-empty">No period with a reading.</p>
  const max = Math.max(...vals, 1)
  return (
    <div className="dco-mini" role="img" aria-label={series.map((s) => `${s.label} ${s.value == null ? 'not recorded' : s.value + unit}`).join(', ')}>
      {series.map((s) => (
        <div key={s.label} className="dco-mini-col">
          <span className="dco-mini-val">{s.value == null ? 'N/A' : s.value}</span>
          <span className="dco-mini-bar"><i style={{ height: s.value == null ? 0 : `${Math.max(4, (s.value / max) * 100)}%` }} /></span>
          <span className="dco-mini-lab">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function BehaviourTile({ icon: Icon, tone, title, unit, data, note }) {
  return (
    <div className="dco-beh">
      <div className="dco-beh-head">
        <span className={`dco-beh-icon ${tone}`}><Icon size={16} aria-hidden="true" /></span>
        <div>
          <b>{title}</b>
          {data && data.change != null
            ? <span className={`dco-beh-chg ${data.change <= 0 ? 'good' : 'bad'}`}>{data.change > 0 ? '+' : ''}{data.change}%</span>
            : null}
          <small>{note}</small>
        </div>
      </div>
      {data ? <MiniBars series={data.series} unit={unit} /> : <p className="dco-mini-empty">Not recorded on scorecards.</p>}
    </div>
  )
}

export default function DriverCoaching() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [tab, setTab] = useState('coaching')

  // Queue filters
  const [riskFilter, setRiskFilter] = useState('')
  const [queueStatus, setQueueStatus] = useState('')
  const [queueSearch, setQueueSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [detailTab, setDetailTab] = useState('overview')

  // Register filters (leaderboard tab)
  const [statusFilter, setStatusFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')
  const [bandFilter, setBandFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setLoadError(''); setNotProvisioned(false)
    try {
      const data = await listDriverCoaching({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      // A failed read is not "no drivers": keep rows null so figures read N/A.
      else { setLoadError(toUserMessage(err, 'Could not load driver coaching records.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const list = useMemo(() => rows || [], [rows])
  const ready = rows !== null
  const cardState = { loading: !ready && !loadError, error: loadError || null, data: rows, retry: load }

  const head = useMemo(() => coachingHeadline(list), [list])
  const queue = useMemo(() => buildCoachingQueue(list), [list])
  const shownQueue = useMemo(() => filterQueue(queue, { risk: riskFilter, status: queueStatus, search: queueSearch }), [queue, riskFilter, queueStatus, queueSearch])
  const trends = useMemo(() => behaviourTrends(list), [list])
  const selIndex = Math.max(0, shownQueue.findIndex((e) => e.key === selectedKey))
  const selected = shownQueue[selIndex] || null
  const history = useMemo(() => (selected ? driverHistory(list, selected.driver_name) : []), [list, selected])
  const points = useMemo(() => scoreTrend(history), [history])
  const session = useMemo(() => latestSession(history), [history])
  const totals = useMemo(() => driverTotals(history), [history])
  const scheduled = useMemo(() => queue.filter((e) => e.status === 'scheduled' || e.status === 'recommended'), [queue])

  // Leaderboard tab
  const board = useMemo(() => honestLeaderboard(list), [list])
  const bands = useMemo(() => bandDistribution(board), [board])
  const enriched = useMemo(() => enrichCoaching(list, board), [list, board])
  const periodOptions = useMemo(() => buildPeriodOptions(list), [list])
  const filtered = useMemo(
    () => filterCoaching(enriched, { status: statusFilter, period: periodFilter, band: bandFilter, search }),
    [enriched, statusFilter, periodFilter, bandFilter, search],
  )

  const doExport = async (format) => {
    const shaped = coachingExport(filtered)
    const file = reportFileName('Driver Coaching', activeCountry !== 'All' ? activeCountry : '')
    try {
      if (format === 'pdf') await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), 'Driver Coaching', file, 'landscape')
      else await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ───────────────────────────────────────────────────────────────
  const openCreate = (prefill = {}) => { setEditing(null); setForm({ ...EMPTY_FORM, ...prefill }); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', period: r.period || '',
      safety_score: r.safety_score ?? '', fuel_score: r.fuel_score ?? '',
      harsh_events: r.harsh_events ?? '', idling_min: r.idling_min ?? '',
      distance_km: r.distance_km ?? '', coaching_status: r.coaching_status || 'none',
      coach: r.coach || '', coaching_notes: r.coaching_notes || '',
      improvement_pct: r.improvement_pct ?? '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.driver_name.trim()) { setFormError('A driver name is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateDriverCoaching(editing.id, payload)
      else await createDriverCoaching(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the scorecard.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDriverCoaching(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the scorecard.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const setCoachingStatus = useCallback(async (record, status) => {
    if (!record) return
    setStatusBusy(true); setError('')
    try {
      await updateDriverCoaching(record.id, { coaching_status: status })
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not update the coaching status.'))
    } finally {
      setStatusBusy(false)
    }
  }, [load])

  const clearFilters = () => { setStatusFilter(''); setPeriodFilter(''); setBandFilter(''); setSearch('') }
  const hasFilters = !!(statusFilter || periodFilter || bandFilter || search)
  const na = (v, f = fmtInt) => (!ready ? 'N/A' : (v == null ? 'N/A' : f(v)))

  // ── Tables ─────────────────────────────────────────────────────────────
  const queueColumns = [
    { key: 'rank', header: '#', numeric: true, cell: (e) => e.rank },
    {
      key: 'driver_name', header: 'Driver',
      cell: (e) => <span className="dco-who"><Avatar name={e.driver_name} /><b>{e.driver_name}</b></span>,
    },
    { key: 'site', header: 'Site', sortable: false, cell: () => <span className="cc-na" title="The scorecard has no site column">Not recorded</span> },
    {
      key: 'score', header: 'Score', numeric: true, sortValue: (e) => e.score ?? 1000,
      cell: (e) => (e.score == null ? <span className="cc-na">Not scored</span> : <span className={`dco-score ${scoreTone(e.score)}`}>{e.score.toFixed(0)}</span>),
    },
    { key: 'risk', header: 'Risk', cell: (e) => <span className={`cc-pill ${RISK_PILL[e.risk]}`}>{RISK_LABEL[e.risk]}</span> },
    {
      key: 'behaviours', header: 'Recorded behaviours', sortable: false,
      cell: (e) => (e.behaviours.length ? <span className="dco-beh-list">{e.behaviours.join(', ')}</span> : <span className="cc-na">None recorded</span>),
    },
    { key: 'period', header: 'Period', cell: (e) => e.period || <span className="cc-na">N/A</span> },
    { key: 'coach', header: 'Coach', cell: (e) => (e.coach ? <span className="dco-who"><Avatar name={e.coach} /></span> : <span className="cc-na">N/A</span>) },
    { key: 'status', header: 'Status', cell: (e) => <span className={`cc-pill ${STATUS_PILL[e.status]}`}>{STATUS_LABEL[e.status]}</span> },
  ]

  const registerColumns = [
    {
      key: '_rank', header: 'Rank', numeric: true, sortValue: (r) => r._rank ?? Number.POSITIVE_INFINITY,
      cell: (r) => {
        const M = MEDAL[r._rank]
        return <span className="dco-rank">{M ? <M size={14} aria-hidden="true" /> : null}{r._rank ? `#${r._rank}` : 'N/A'}</span>
      },
    },
    { key: 'driver_name', header: 'Driver', cell: (r) => <b>{r.driver_name || 'N/A'}</b> },
    { key: '_score', header: 'Overall', numeric: true, sortValue: (r) => (r._score == null ? -1 : r._score), cell: (r) => (r._score == null ? <span className="cc-na">Not scored</span> : <span className={`dco-score ${scoreTone(r._score)}`}>{r._score.toFixed(1)}</span>) },
    { key: 'safety_score', header: 'Safety', numeric: true, sortValue: (r) => Number(r.safety_score) || -1, cell: (r) => fmtScore(r.safety_score) },
    { key: 'fuel_score', header: 'Fuel', numeric: true, sortValue: (r) => Number(r.fuel_score) || -1, cell: (r) => fmtScore(r.fuel_score) },
    { key: 'harsh_events', header: 'Harsh', numeric: true, sortValue: (r) => Number(r.harsh_events) || 0, cell: (r) => fmtNum(r.harsh_events) },
    { key: 'distance_km', header: 'Distance', numeric: true, sortValue: (r) => Number(r.distance_km) || 0, cell: (r) => fmtNum(r.distance_km, ' km') },
    { key: '_status', header: 'Coaching', cell: (r) => <span className={`cc-pill ${STATUS_PILL[r._status]}`}>{STATUS_LABEL[r._status]}</span> },
    { key: 'coach', header: 'Coach', cell: (r) => r.coach || <span className="cc-na">N/A</span> },
    { key: 'period', header: 'Period', cell: (r) => r.period || <span className="cc-na">N/A</span> },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <span className="dco-actions">
          <button type="button" className="cc-icon-btn" onClick={(ev) => { ev.stopPropagation(); openEdit(r) }} aria-label={`Edit scorecard for ${r.driver_name || 'driver'}`}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn dco-danger" onClick={(ev) => { ev.stopPropagation(); setConfirmDelete(r) }} aria-label={`Delete scorecard for ${r.driver_name || 'driver'}`}><Trash2 size={14} /></button>
        </span>
      ),
    },
  ]

  const historyColumns = [
    { key: 'period', header: 'Period', cell: (r) => r.period || <span className="cc-na">N/A</span> },
    { key: 'score', header: 'Score', numeric: true, sortValue: (r) => scoreOf(r) ?? -1, cell: (r) => fmtScore(scoreOf(r)) },
    { key: 'harsh_events', header: 'Harsh', numeric: true, cell: (r) => fmtNum(r.harsh_events) },
    { key: 'coaching_status', header: 'Coaching', cell: (r) => STATUS_LABEL[String(r.coaching_status || 'none').toLowerCase()] || 'No coaching' },
    { key: 'coach', header: 'Coach', cell: (r) => r.coach || <span className="cc-na">N/A</span> },
    { key: 'edit', header: '', sortable: false, cell: (r) => <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`Edit scorecard ${r.period || ''}`}><Pencil size={13} /></button> },
  ]

  const navigate = (step) => {
    if (!shownQueue.length) return
    const next = (selIndex + step + shownQueue.length) % shownQueue.length
    setSelectedKey(shownQueue[next].key)
  }

  return (
    <div className="cc dco-page">
      <PageHero
        hello="Drivers and Safety"
        title="Driver Coaching"
        lead="Risk-based coaching, behaviour improvement and follow-up actions for a safer, more efficient fleet."
        imgLight="/dashboard/hero-coaching-light.webp"
        imgDark="/dashboard/hero-coaching-dark.webp"
        stat={{ value: na(head.drivers), lines: ['Drivers on', 'scorecards'] }}
      />

      <div className="cc-card dco-bar">
        <Tabs label="Driver coaching views" value={tab} onChange={setTab} tabs={[
          { key: 'coaching', label: 'Coaching' },
          { key: 'leaderboard', label: 'Leaderboard and register', count: ready ? list.length : null },
        ]} />
        <div className="dco-bar-actions">
          {updatedAt && <span className="dco-updated">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'dco-spin' : ''} aria-hidden="true" /> Refresh</button>
          <button type="button" className="cc-btn-ghost" onClick={() => doExport('excel')} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-ghost" onClick={() => doExport('pdf')} disabled={!filtered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
          <button type="button" className="cc-btn-primary" onClick={() => openCreate()} disabled={notProvisioned}><Plus size={15} aria-hidden="true" /> Add scorecard</button>
        </div>
      </div>

      {notProvisioned && (
        <div className="cc-card dco-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>Driver coaching is not enabled on this database yet. Apply MIGRATIONS_V187_DRIVER_COACHING.sql, then reload.</p>
        </div>
      )}
      {loadError && (
        <div className="cc-card dco-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>Driver coaching could not be loaded. {loadError} The figures below stay N/A until the scorecards load.</p>
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {error && (
        <div className="cc-card dco-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <p>That action did not complete. {error}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {tab === 'coaching' && (
        <>
          <div className="cc-kpis dco-kpis">
            <Kpi icon={Users} tone="t-green" display={na(head.coachedDrivers)} label="Coached drivers" loading={cardState.loading}
              title="Drivers with at least one scorecard marked Completed" onClick={() => { setTab('leaderboard'); setStatusFilter('completed') }} />
            <Kpi icon={AlertTriangle} tone="t-red" display={na(head.highRisk)} label="High-risk drivers" loading={cardState.loading} danger={head.highRisk > 0}
              title={`Latest score below ${COACHING_THRESHOLD}`} onClick={() => setRiskFilter('high')} />
            <Kpi icon={Clock} tone="t-amber" display="N/A" label="Overdue coaching" loading={cardState.loading}
              title="Not recorded: scorecards carry no session or due date, so overdue coaching cannot be measured" />
            <Kpi icon={TrendingUp} tone="t-blue" display={na(head.avgImprovementPct, (v) => `${v > 0 ? '+' : ''}${v}%`)} label="Avg behaviour improvement" loading={cardState.loading}
              title={ready ? `Mean improvement % from ${head.improvementRecords} scorecard(s) that record one` : undefined} />
            <Kpi icon={ClipboardList} tone="t-purple" display={na(head.openFollowUps)} label="Open follow-ups" loading={cardState.loading}
              title="Scorecards with coaching Recommended or Scheduled" onClick={() => setQueueStatus('recommended')} />
          </div>

          <div className="dco-main">
            <div className="dco-col">
              <Card title="Driver Coaching Queue" sub="Drivers ranked by latest score, highest risk first"
                action={(
                  <div className="dco-filters">
                    <select className="cc-select" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} aria-label="Risk level">
                      <option value="">All risk levels</option>
                      {RISK_OPTIONS.map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
                    </select>
                    <select className="cc-select" value={queueStatus} onChange={(e) => setQueueStatus(e.target.value)} aria-label="Coaching status">
                      <option value="">All statuses</option>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    <label className="dco-search">
                      <Search size={14} aria-hidden="true" />
                      <input value={queueSearch} onChange={(e) => setQueueSearch(e.target.value)} placeholder="Search drivers" aria-label="Search drivers" />
                    </label>
                  </div>
                )}>
                <CardState state={cardState} lines={6}
                  empty={ready && !queue.length ? (
                    <div>No driver scorecards recorded yet.<br /><button type="button" className="cc-btn" onClick={() => openCreate()} disabled={notProvisioned}>Add the first scorecard</button></div>
                  ) : null}>
                  <KitTable columns={queueColumns} rows={shownQueue} getRowId={(e) => e.key}
                    onRowClick={(e) => { setSelectedKey(e.key); setDetailTab('overview') }}
                    empty="No drivers match these filters." />
                </CardState>
              </Card>

              <Card title="Behaviour Trends" sub="Fleet average per scorecard period">
                <CardState state={cardState} lines={3}
                  empty={ready && !trends.periods.length ? 'No scorecard carries a period yet, so trends cannot be drawn.' : null}>
                  <div className="dco-behs">
                    <BehaviourTile icon={Zap} tone="t-red" title="Harsh events" unit=" per 100 km" data={trends.harsh} note="Events per 100 km" />
                    <BehaviourTile icon={Clock} tone="t-amber" title="Excessive idling" unit=" min" data={trends.idling} note="Avg minutes per scorecard" />
                    <BehaviourTile icon={Zap} tone="t-blue" title="Speeding" note="Not on scorecards" />
                    <BehaviourTile icon={Zap} tone="t-purple" title="Seatbelt non-use" note="Not on scorecards" />
                    <BehaviourTile icon={Zap} tone="t-green" title="Mobile device use" note="Not on scorecards" />
                  </div>
                </CardState>
              </Card>

              <Card title="Coaching Board" sub="Sessions waiting to happen"
                action={<button type="button" className="cc-btn-ghost" onClick={() => openCreate({ coaching_status: 'scheduled' })} disabled={notProvisioned}><CalendarDays size={14} aria-hidden="true" /> Schedule session</button>}>
                <CardState state={cardState} lines={2}
                  empty={ready && !scheduled.length ? 'No coaching is Recommended or Scheduled right now.' : null}>
                  <p className="dco-note"><Info size={13} aria-hidden="true" /> Scorecards record a coaching status but no session date, so sessions are listed by status rather than placed on a calendar.</p>
                  <div className="dco-sessions">
                    {scheduled.slice(0, 10).map((e) => (
                      <button key={e.key} type="button" className={`dco-session ${e.status}`} onClick={() => setSelectedKey(e.key)}>
                        <span className="dco-session-date">Date not recorded</span>
                        <b>{e.driver_name}</b>
                        <span>{STATUS_LABEL[e.status]}{e.coach ? ` with ${e.coach}` : ''}</span>
                      </button>
                    ))}
                  </div>
                </CardState>
              </Card>
            </div>

            <div className="dco-col">
              <Card title="Driver Details"
                action={shownQueue.length > 0 && (
                  <span className="dco-nav">
                    <button type="button" className="cc-icon-btn" onClick={() => navigate(-1)} aria-label="Previous driver"><ChevronLeft size={14} /></button>
                    <span>{selIndex + 1} of {shownQueue.length}</span>
                    <button type="button" className="cc-icon-btn" onClick={() => navigate(1)} aria-label="Next driver"><ChevronRight size={14} /></button>
                  </span>
                )}>
                <CardState state={cardState} lines={5} empty={ready && !selected ? 'Pick a driver from the queue to see their details.' : null}>
                  {selected && (
                    <div className="dco-detail">
                      <div className="dco-detail-head">
                        <Avatar name={selected.driver_name} size="lg" />
                        <div className="dco-detail-id">
                          <div><b>{selected.driver_name}</b> <span className={`cc-pill ${RISK_PILL[selected.risk]}`}>{RISK_LABEL[selected.risk]}</span></div>
                          <small>{selected.scorecards} scorecard(s) | latest period {selected.period || 'N/A'} | site and vehicle not recorded</small>
                        </div>
                        <div className={`dco-big-score ${scoreTone(selected.score)}`}>
                          <b>{selected.score == null ? 'N/A' : selected.score.toFixed(0)}</b>
                          <small>Score</small>
                        </div>
                      </div>
                      <Tabs variant="line" label="Driver detail" value={detailTab} onChange={setDetailTab} tabs={[
                        { key: 'overview', label: 'Overview' },
                        { key: 'history', label: 'Coaching history', count: history.length },
                        { key: 'notes', label: 'Notes' },
                      ]} />
                      {detailTab === 'overview' && (
                        <div className="dco-facts">
                          <div><small>Total distance</small><b>{fmtNum(totals.distanceKm, ' km')}</b><span>All scorecards</span></div>
                          <div><small>Harsh events</small><b>{fmtNum(totals.harshEvents)}</b><span>All scorecards</span></div>
                          <div><small>Idling</small><b>{fmtNum(totals.idlingMin, ' min')}</b><span>All scorecards</span></div>
                          <div><small>Incidents</small><b className="cc-na">N/A</b><span>Not on scorecards</span></div>
                        </div>
                      )}
                      {detailTab === 'history' && (
                        <KitTable compact columns={historyColumns} rows={[...history].reverse()} getRowId={(r) => String(r.id)} empty="No scorecards." />
                      )}
                      {detailTab === 'notes' && (
                        <div className="dco-notes">
                          {history.filter((r) => r.coaching_notes || r.notes).length === 0
                            ? <p className="cc-na">No notes recorded for this driver.</p>
                            : [...history].reverse().filter((r) => r.coaching_notes || r.notes).map((r) => (
                              <div key={r.id}><small>{r.period || 'No period'}</small><p>{r.coaching_notes || r.notes}</p></div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardState>
              </Card>

              <Card title="Behaviour Score Trend" sub={selected ? `${selected.driver_name}, score per period` : 'Score per period'}>
                <CardState state={cardState} lines={3}
                  empty={ready && points.length < 2 ? (selected ? 'Two or more scored periods are needed to draw a trend for this driver.' : 'Pick a driver to see the trend.') : null}>
                  <ScoreLine points={points} />
                  <p className="dco-note"><Info size={13} aria-hidden="true" /> Dashed line marks the coaching threshold of {COACHING_THRESHOLD}.</p>
                </CardState>
              </Card>

              <Card title="Latest Coaching Session" sub={session?.period ? `Period ${session.period}` : undefined}>
                <CardState state={cardState} lines={3} empty={ready && !session ? 'No scorecard selected.' : null}>
                  {session && (
                    <div className="dco-session-card">
                      <div className="dco-session-row">
                        <div><small>Coach</small><b>{session.coach || 'Not recorded'}</b></div>
                        <div><small>Status</small><span className={`cc-pill ${STATUS_PILL[String(session.coaching_status || 'none').toLowerCase()] || 'muted'}`}>{STATUS_LABEL[String(session.coaching_status || 'none').toLowerCase()] || 'No coaching'}</span></div>
                        <div><small>Improvement</small><b>{session.improvement_pct == null ? 'N/A' : `${session.improvement_pct}%`}</b></div>
                      </div>
                      <div className="dco-session-notes">
                        <small>Notes</small>
                        <p>{session.coaching_notes || 'No coaching notes recorded.'}</p>
                        <button type="button" className="cc-btn" onClick={() => openEdit(session)}>Add or edit notes</button>
                      </div>
                      <p className="dco-note"><Info size={13} aria-hidden="true" /> Assigned actions and due dates are not recorded on scorecards.</p>
                    </div>
                  )}
                </CardState>
              </Card>

              <div className="cc-card dco-actionbar">
                <button type="button" className="cc-btn-primary" disabled={!session || statusBusy || notProvisioned} onClick={() => setCoachingStatus(session, 'scheduled')}><Play size={14} aria-hidden="true" /> Start coaching</button>
                <button type="button" className="cc-btn-ghost" disabled={!session || statusBusy || notProvisioned} onClick={() => setCoachingStatus(session, 'completed')}><CheckCircle2 size={14} aria-hidden="true" /> Mark completed</button>
                <button type="button" className="cc-btn-ghost" disabled={!selected || notProvisioned} onClick={() => openCreate({ driver_name: selected?.driver_name || '', coaching_status: 'recommended' })}><GraduationCap size={14} aria-hidden="true" /> New scorecard</button>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'leaderboard' && (
        <>
          <Card title="Score distribution" sub="Latest scorecard per driver">
            <CardState state={cardState} lines={2} empty={ready && !board.length ? 'No scored drivers yet.' : null}>
              <div className="dco-bands">
                {[
                  { key: 'good', label: 'Strong (80 and above)', tone: 'good' },
                  { key: 'watch', label: `Watch (${COACHING_THRESHOLD} to 79)`, tone: 'warn' },
                  { key: 'poor', label: `Needs coaching (below ${COACHING_THRESHOLD})`, tone: 'bad' },
                ].map((b) => {
                  const pct = board.length ? Math.round((bands[b.key] / board.length) * 100) : 0
                  return (
                    <button key={b.key} type="button" className={`dco-band ${bandFilter === b.key ? 'on' : ''}`} aria-pressed={bandFilter === b.key} onClick={() => setBandFilter(bandFilter === b.key ? '' : b.key)}>
                      <span>{b.label}</span><b>{bands[b.key]} ({pct}%)</b>
                      <span className="dco-band-track"><i className={b.tone} style={{ width: `${pct}%` }} /></span>
                    </button>
                  )
                })}
              </div>
            </CardState>
          </Card>

          <Card title="Driver leaderboard" sub="Best first, latest scorecard per driver">
            <CardState state={cardState} lines={4} empty={ready && !board.length ? 'No scored drivers yet. Add a scorecard to build the leaderboard.' : null}>
              <ol className="dco-board">
                {board.slice(0, 12).map((b) => {
                  const M = MEDAL[b.rank]
                  return (
                    <li key={b.driver_name}>
                      <span className="dco-board-rank">{M ? <M size={16} aria-label={`Rank ${b.rank}`} /> : `#${b.rank}`}</span>
                      <span className="dco-board-name">{b.driver_name}<span className="dco-band-track"><i className={scoreTone(b.overallScore)} style={{ width: `${Math.max(2, Math.min(100, b.overallScore))}%` }} /></span></span>
                      <span className={`dco-score ${scoreTone(b.overallScore)}`}>{b.overallScore.toFixed(1)}</span>
                      <small>{b.harsh_events ?? 'N/A'} harsh, {b.distance_km == null ? 'N/A' : `${Math.round(b.distance_km).toLocaleString('en-US')} km`}</small>
                    </li>
                  )
                })}
              </ol>
            </CardState>
          </Card>

          <Card title="Scorecard register" sub={ready ? `${filtered.length} of ${enriched.length} scorecards` : undefined}>
            <div className="dco-reg-filters">
              <label className="dco-search">
                <Search size={14} aria-hidden="true" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search driver, coach, period, notes" aria-label="Search scorecards" />
              </label>
              <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Coaching status filter">
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <select className="cc-select" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Score band">
                <option value="">All scores</option>
                <option value="good">Strong (80 and above)</option>
                <option value="watch">Watch ({COACHING_THRESHOLD} to 79)</option>
                <option value="poor">Below {COACHING_THRESHOLD}</option>
                <option value="unscored">Not scored</option>
              </select>
              <select className="cc-select" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label="Period">
                <option value="">All periods</option>
                {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
            </div>
            <CardState state={cardState} lines={6}>
              <KitTable columns={registerColumns} rows={filtered} getRowId={(r) => String(r.id)} onRowClick={openEdit}
                empty={hasFilters ? 'No scorecards match these filters.' : notProvisioned ? 'Driver coaching is not enabled on this database yet.' : 'No scorecards yet. Add your first driver scorecard.'} />
            </CardState>
          </Card>
        </>
      )}

      {showModal && (
        <Modal open onClose={closeModal} title={editing ? 'Edit scorecard' : 'Add driver scorecard'} size="lg">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="dc-f1" className="label">Driver name</label>
                <input id="dc-f1" className="input w-full" placeholder="e.g. A. Rahman" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="dc-f2" className="label">Period (optional)</label>
                <input id="dc-f2" className="input w-full" placeholder="e.g. 2026-Q2 / Jun 2026" value={form.period} maxLength={60} onChange={(e) => set('period', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="dc-f3" className="label">Safety score (0 to 100)</label>
                <input id="dc-f3" className="input w-full" type="number" step="0.1" min="0" max="100" placeholder="82" value={form.safety_score} onChange={(e) => set('safety_score', e.target.value)} />
              </div>
              <div>
                <label htmlFor="dc-f4" className="label">Fuel score (0 to 100)</label>
                <input id="dc-f4" className="input w-full" type="number" step="0.1" min="0" max="100" placeholder="76" value={form.fuel_score} onChange={(e) => set('fuel_score', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="dc-f5" className="label">Harsh events</label>
                <input id="dc-f5" className="input w-full" type="number" step="1" min="0" placeholder="3" value={form.harsh_events} onChange={(e) => set('harsh_events', e.target.value)} />
              </div>
              <div>
                <label htmlFor="dc-f6" className="label">Idling (min)</label>
                <input id="dc-f6" className="input w-full" type="number" step="1" min="0" placeholder="45" value={form.idling_min} onChange={(e) => set('idling_min', e.target.value)} />
              </div>
              <div>
                <label htmlFor="dc-f7" className="label">Distance (km)</label>
                <input id="dc-f7" className="input w-full" type="number" step="1" min="0" placeholder="4200" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="dc-f8" className="label">Coaching status</label>
                <select id="dc-f8" className="input w-full" value={form.coaching_status} onChange={(e) => set('coaching_status', e.target.value)}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="dc-f9" className="label">Coach (optional)</label>
                <input id="dc-f9" className="input w-full" placeholder="e.g. Fleet Trainer" value={form.coach} maxLength={200} onChange={(e) => set('coach', e.target.value)} />
              </div>
              <div>
                <label htmlFor="dc-f10" className="label">Improvement %</label>
                <input id="dc-f10" className="input w-full" type="number" step="0.1" placeholder="12.5" value={form.improvement_pct} onChange={(e) => set('improvement_pct', e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="dc-f11" className="label">Coaching notes (optional)</label>
              <textarea id="dc-f11" className="input w-full min-h-[70px] resize-y" placeholder="Session outcomes, focus areas, follow-up date" value={form.coaching_notes} maxLength={8000} onChange={(e) => set('coaching_notes', e.target.value)} />
            </div>
            <div>
              <label htmlFor="dc-f12" className="label">Notes (optional)</label>
              <textarea id="dc-f12" className="input w-full min-h-[60px] resize-y" placeholder="Any additional context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>
            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              {editing && (
                <button type="button" className="btn-danger text-sm mr-auto" disabled={saving} onClick={() => { setShowModal(false); setConfirmDelete(editing); setEditing(null) }}>
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
              )}
              <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                {saving ? 'Saving' : editing ? 'Save changes' : 'Add scorecard'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal open onClose={deleting ? undefined : () => setConfirmDelete(null)} closeOnBackdrop={!deleting} title="Delete this scorecard?" size="sm">
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.driver_name || 'Driver'}, score {scoreOf(confirmDelete) == null ? 'not recorded' : scoreOf(confirmDelete).toFixed(1)}{confirmDelete.period ? `, ${confirmDelete.period}` : ''}. This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

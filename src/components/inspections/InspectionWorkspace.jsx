/**
 * Inspections workspace - the owner's "Inspections & Observations" mockup.
 *
 * Header, KPI strip, module strip, then three columns (queue, selected
 * inspection, photos and tyre map) and a bottom row (recent findings, defect
 * mix, trend). It reads ONLY the rows the register already loaded and hands
 * every action back to the page, so the existing modals, PDF, approval and
 * corrective-action flows stay the one place each thing happens.
 *
 * Honest by construction: no AI result is shown because none exists; the right
 * column carries the recorded tyre map and the tyre-life flags instead.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck, CheckCircle2, Clock, AlertTriangle, ShieldAlert, Search, Eye, FileText,
  ClipboardList, ListChecks, CalendarDays, Wrench, BarChart3, MessageSquare, Plus,
  MapPin, Gauge, Timer, User, Pencil, ArrowRight, Circle,
} from 'lucide-react'
import { Card, Kpi, Tabs, Donut, Pager, VehicleThumb, fmtInt } from '../commandCenter/kit'
import InspectionPhotos from '../inspection/InspectionPhotos'
import InspectionDiagram from '../inspection/InspectionDiagram'
import {
  LIST_TABS, listTabCounts, matchesListTab, searchInspections, sortNewest, inspectionStage,
  inspectionSections, inspectionProgress, assetHistory, recentFindings, defectCategories,
  inspectionTrend, workspaceKpis, ITEM_STATUS, rowDay,
} from '../../lib/inspectionWorkspaceView'
import './inspectionWorkspace.css'

const PAGE = 8

const fmtDay = (d) => {
  if (!d) return 'N/A'
  const x = new Date(`${d}T00:00:00`)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtTime = (ts) => {
  if (!ts) return ''
  const x = new Date(ts)
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
const meter = (v, unit) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString('en-US')} ${unit}`)

const MODULES = [
  { key: 'inspections', label: 'Inspections', sub: 'Conduct inspections', icon: ClipboardCheck },
  { key: 'observations', label: 'Observations', sub: 'All findings and notes', icon: MessageSquare },
  { key: 'checklists', label: 'Checklists', sub: 'Inspection templates', icon: ListChecks, to: '/checklists' },
  { key: 'schedules', label: 'Inspection Schedules', sub: 'Planned inspections', icon: CalendarDays, to: '/inspection-planner' },
  { key: 'actions', label: 'Corrective Actions', sub: 'Action management', icon: Wrench, to: '/actions' },
  { key: 'reports', label: 'Reports', sub: 'Analysis and export', icon: BarChart3, to: '/inspection-intelligence' },
]

function Pill({ tone, children }) {
  return <span className={`cc-pill ${tone}`}>{children}</span>
}

/** Small three-series line chart. Real daily counts; a flat line means a quiet day, not missing data. */
function TrendChart({ trend }) {
  const W = 520; const H = 170; const P = { l: 26, r: 8, t: 10, b: 22 }
  const max = Math.max(4, ...trend.completed, ...trend.pending, ...trend.overdue)
  const step = (W - P.l - P.r) / Math.max(1, trend.labels.length - 1)
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b)
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${(P.l + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const series = [
    { key: 'completed', label: 'Completed', color: 'var(--cc-green)' },
    { key: 'pending', label: 'Pending', color: 'var(--cc-blue)' },
    { key: 'overdue', label: 'Overdue', color: 'var(--cc-red)' },
  ]
  const ticks = [0, Math.round(max / 2), max]
  const xTicks = trend.labels.filter((_, i) => i % 5 === 0 || i === trend.labels.length - 1)
  return (
    <div>
      <div className="iw-legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="iw-trend" role="img"
        aria-label={`Inspections per day over ${trend.labels.length} days`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--cc-track)" />
            <text x={P.l - 5} y={y(t) + 3} textAnchor="end" className="iw-axis">{t}</text>
          </g>
        ))}
        {xTicks.map((d) => {
          const i = trend.labels.indexOf(d)
          return <text key={d} x={P.l + i * step} y={H - 6} textAnchor="middle" className="iw-axis">{d.slice(8)}/{d.slice(5, 7)}</text>
        })}
        {series.map((s) => (
          <path key={s.key} d={path(trend[s.key])} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  )
}

export default function InspectionWorkspace({
  rows, allRows, loading, error, onRetry, flagMap, actions, sites = [],
  from, to, site, onFilter, onView, onPdf, onRaiseAction, onEdit, onApprove,
  onObservations, onAddObservation, now,
}) {
  const today = now || new Date()
  const [listTab, setListTab] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [detailTab, setDetailTab] = useState('details')
  const [section, setSection] = useState(null)

  const sorted = useMemo(() => sortNewest(rows), [rows])
  const counts = useMemo(() => listTabCounts(sorted, today), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(
    () => searchInspections(sorted, q).filter((r) => matchesListTab(r, listTab, today)),
    [sorted, q, listTab], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const kpis = useMemo(() => workspaceKpis(rows), [rows])
  useEffect(() => { setPage(0) }, [q, listTab, rows])

  // The selection follows the list: a filter that drops the selected row moves
  // the selection to the first visible row rather than showing a stale record.
  const selected = useMemo(() => list.find((r) => r.id === selectedId) || list[0] || null, [list, selectedId])
  const sections = useMemo(() => (selected ? inspectionSections(selected) : []), [selected])
  const progress = useMemo(() => inspectionProgress(selected), [selected])
  useEffect(() => { setSection(null); setDetailTab('details') }, [selected?.id])
  const activeSection = sections.find((s) => s.key === section) || sections[0] || null
  const history = useMemo(() => assetHistory(allRows || rows, selected), [allRows, rows, selected])
  const findings = useMemo(() => recentFindings(rows, 5), [rows])
  const selectedFindings = useMemo(() => (selected ? recentFindings([selected], 20) : []), [selected])
  const defects = useMemo(() => defectCategories(rows), [rows])
  const trend = useMemo(() => inspectionTrend(rows, today, 30), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const flags = selected?.asset_no && flagMap ? flagMap[selected.asset_no] : null

  const unreadable = !!error
  const show = (v) => (unreadable ? 'N/A' : fmtInt(v))
  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE)
  const stage = inspectionStage(selected)

  return (
    <div className="cc iw">
      <header className="iw-head">
        <span className="iw-head-icon" aria-hidden="true"><ClipboardCheck size={26} /></span>
        <div className="iw-head-copy">
          <h1>Inspections &amp; Observations</h1>
          <p>Conduct, track and manage multi-point vehicle inspections with photos, tyre readings and real-time observations.</p>
        </div>
        <div className="iw-head-actions">{actions}</div>
      </header>

      <div className="iw-kpis">
        <Kpi icon={ClipboardList} tone="t-blue" display={show(kpis.total)} label="Total inspections" loading={loading}
          title={unreadable ? undefined : `${fmtInt(kpis.vehicles)} vehicles inspected`} />
        <Kpi icon={CheckCircle2} tone="t-green" display={show(kpis.completed)} label={`Completed${kpis.completedPct == null || unreadable ? '' : `, ${kpis.completedPct}%`}`} loading={loading} />
        <Kpi icon={Clock} tone="t-amber" display={show(kpis.pending)} label={`Pending${kpis.pendingPct == null || unreadable ? '' : `, ${kpis.pendingPct}%`}`} loading={loading} />
        <Kpi icon={AlertTriangle} tone="t-red" display={show(kpis.overdue)} label={`Overdue${kpis.overduePct == null || unreadable ? '' : `, ${kpis.overduePct}%`}`} loading={loading} danger={!unreadable && kpis.overdue > 0} />
        <Kpi icon={ShieldAlert} tone="t-red" display={show(kpis.critical)} label="Critical findings" loading={loading}
          title="Inspections with a High or Critical severity, or a tyre recorded as damaged, flat or punctured" />
        <div className="cc-card iw-filters">
          <label><span>From</span><input type="date" className="cc-select" value={from || ''} onChange={(e) => onFilter('from', e.target.value)} /></label>
          <label><span>To</span><input type="date" className="cc-select" value={to || ''} onChange={(e) => onFilter('to', e.target.value)} /></label>
          <label><span>Site</span>
            <select className="cc-select" value={site || 'all'} onChange={(e) => onFilter('site', e.target.value)}>
              <option value="all">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      <nav className="iw-modules" aria-label="Inspection modules">
        {MODULES.map((m) => {
          const Icon = m.icon
          const body = (<><span className="iw-mod-icon"><Icon size={18} aria-hidden="true" /></span><span><b>{m.label}</b><small>{m.sub}</small></span></>)
          if (m.to) return <Link key={m.key} to={m.to} className="iw-mod">{body}</Link>
          if (m.key === 'observations') return <button key={m.key} type="button" className="iw-mod" onClick={onObservations}>{body}</button>
          return <span key={m.key} className="iw-mod is-active" aria-current="page">{body}</span>
        })}
      </nav>

      {unreadable && (
        <div className="cc-card iw-error" role="alert">
          <span>{error}</span>
          <button type="button" className="cc-btn" onClick={onRetry}>Try again</button>
        </div>
      )}

      <div className="iw-main">
        <Card className="iw-list" title={`Vehicle Inspections (${unreadable ? 'N/A' : fmtInt(sorted.length)})`}>
          <div className="cc-search iw-search">
            <Search size={15} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vehicle, site, inspector..." aria-label="Search inspections" />
          </div>
          <Tabs label="Inspection queue" value={listTab} onChange={setListTab}
            tabs={LIST_TABS.map((t) => ({ ...t, count: unreadable ? null : counts[t.key] }))} />
          {loading && !rows.length ? (
            <div className="iw-skel">{Array.from({ length: 6 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 52 }} />)}</div>
          ) : !pageRows.length ? (
            <div className="cc-empty">{unreadable ? 'Could not read the inspections.' : 'No inspection matches this view.'}</div>
          ) : (
            <ul className="iw-rows">
              {pageRows.map((r) => {
                const st = inspectionStage(r)
                return (
                  <li key={r.id}>
                    <button type="button" className={`iw-row ${selected?.id === r.id ? 'is-sel' : ''}`} onClick={() => setSelectedId(r.id)} aria-pressed={selected?.id === r.id}>
                      <VehicleThumb row={r} size="sm" />
                      <span className="iw-row-main">
                        <b>{r.asset_no || r.title || 'No asset'}</b>
                        <small>{r.vehicle_type || r.inspection_type || 'Type not recorded'}</small>
                        <small className="iw-row-site"><MapPin size={11} aria-hidden="true" />{r.site || 'No site'}</small>
                      </span>
                      <span className="iw-row-side">
                        <Pill tone={st.tone}>{st.label}</Pill>
                        <small>{fmtDay(rowDay(r))}</small>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {list.length > PAGE && <Pager page={page} pageSize={PAGE} total={list.length} onPage={setPage} noun="inspections" />}
        </Card>

        <Card className="iw-detail">
          {!selected ? (
            <div className="cc-empty">{loading ? 'Loading inspections...' : 'Select an inspection to see its details.'}</div>
          ) : (
            <>
              <div className="iw-dhead">
                <VehicleThumb row={selected} size="lg" />
                <div className="iw-dhead-id">
                  <div className="iw-dhead-title">
                    <h2>{selected.asset_no || selected.title || 'No asset'}</h2>
                    <Pill tone={stage.tone}>{stage.label}</Pill>
                  </div>
                  <p>{[selected.vehicle_type, selected.inspection_type].filter(Boolean).join(' | ') || 'Type not recorded'}</p>
                </div>
                <div className="iw-dhead-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => onEdit(selected)}><Pencil size={14} aria-hidden="true" /> Edit</button>
                  <button type="button" className="cc-btn-ghost" onClick={() => onPdf(selected)}><FileText size={14} aria-hidden="true" /> PDF</button>
                  <button type="button" className="cc-btn-primary" onClick={() => onView(selected)}><Eye size={14} aria-hidden="true" /> Open</button>
                </div>
              </div>
              <div className="iw-facts">
                <span><User size={15} aria-hidden="true" /><b>{selected.inspector || selected.attendees || 'N/A'}</b><small>Inspector</small></span>
                <span><MapPin size={15} aria-hidden="true" /><b>{selected.site || 'N/A'}</b><small>Site</small></span>
                <span><Gauge size={15} aria-hidden="true" /><b>{meter(selected.odometer_km, 'km')}</b><small>Odometer</small></span>
                <span><Timer size={15} aria-hidden="true" /><b>{meter(selected.hour_meter, 'hrs')}</b><small>Engine hours</small></span>
                <span><CalendarDays size={15} aria-hidden="true" /><b>{fmtDay(rowDay(selected))}</b><small>{fmtTime(selected.created_at) || 'Date'}</small></span>
              </div>

              <Tabs variant="line" label="Inspection detail" value={detailTab} onChange={setDetailTab} tabs={[
                { key: 'details', label: 'Inspection Details' },
                { key: 'findings', label: 'Observations', count: selectedFindings.length },
                { key: 'photos', label: 'Photos' },
                { key: 'history', label: 'History', count: history.length },
              ]} />

              {detailTab === 'details' && (
                !sections.length ? (
                  <div className="cc-empty">
                    <div>No tyre readings were recorded on this inspection.{selected.findings ? <><br />Findings: {selected.findings}</> : null}</div>
                  </div>
                ) : (
                  <div className="iw-check">
                    <ul className="iw-sections" aria-label="Sections">
                      {sections.map((s) => {
                        const complete = s.done === s.total
                        return (
                          <li key={s.key}>
                            <button type="button" className={activeSection?.key === s.key ? 'is-sel' : ''} onClick={() => setSection(s.key)}>
                              {complete ? <CheckCircle2 size={15} className="iw-ok" aria-hidden="true" /> : <Circle size={15} className="iw-dim" aria-hidden="true" />}
                              <span>{s.label}</span>
                              <small className={s.issues ? 'iw-warn' : ''}>{s.done}/{s.total}</small>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                    <div className="iw-items">
                      <div className="iw-items-head">
                        <div>
                          <h3>{activeSection?.label}</h3>
                          <p>Condition, pressure and tread recorded per wheel.</p>
                        </div>
                        {progress.total != null && (
                          <div className="iw-progress">
                            <small>{progress.done} / {progress.total} positions recorded</small>
                            <span><i style={{ width: `${progress.pct}%` }} /></span>
                          </div>
                        )}
                      </div>
                      <div className="iw-table" role="table" aria-label={`${activeSection?.label} items`}>
                        <div className="iw-tr iw-th" role="row">
                          <span role="columnheader">Item</span><span role="columnheader">Status</span>
                          <span role="columnheader">Remarks</span><span role="columnheader">Action</span>
                        </div>
                        {activeSection?.items.map((it) => {
                          const meta = ITEM_STATUS[it.status]
                          return (
                            <div key={it.position} className="iw-tr" role="row">
                              <span role="cell"><b>{it.label}</b>{it.condition && it.status !== 'ok' && <small>{it.condition}</small>}</span>
                              <span role="cell"><Pill tone={meta.tone}>{it.status === 'ok' ? <CheckCircle2 size={12} aria-hidden="true" /> : null}{meta.label}</Pill></span>
                              <span role="cell" className="iw-remark">{it.remarks || (it.recorded ? 'No remarks' : 'Not recorded')}</span>
                              <span role="cell">
                                {(it.status === 'issue' || it.status === 'minor') && !selected.linked_action_id
                                  ? <button type="button" className="cc-btn" onClick={() => onRaiseAction(selected)}>Create action</button>
                                  : it.status === 'issue' || it.status === 'minor'
                                    ? <Link className="cc-link" to="/actions">Action raised</Link>
                                    : <span className="cc-na">-</span>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      {selected.findings && <p className="iw-note"><b>Findings:</b> {selected.findings}</p>}
                      {selected.notes && <p className="iw-note"><b>Notes:</b> {selected.notes}</p>}
                      {selected.approval_status === 'pending_approval' && onApprove && (
                        <button type="button" className="cc-btn-primary iw-approve" onClick={() => onApprove(selected)}>Review and sign</button>
                      )}
                    </div>
                  </div>
                )
              )}

              {detailTab === 'findings' && (
                !selectedFindings.length ? <div className="cc-empty">No tyre on this inspection was recorded as anything other than Good.</div> : (
                  <ul className="iw-finds">
                    {selectedFindings.map((f) => (
                      <li key={f.key}><Pill tone={f.tone}>{f.severity}</Pill><b>{f.position}</b><span>{f.condition}</span></li>
                    ))}
                  </ul>
                )
              )}

              {detailTab === 'photos' && <InspectionPhotos inspection={selected} showEvidence={false} title="Inspection photos" />}

              {detailTab === 'history' && (
                !history.length ? <div className="cc-empty">No other inspection of this vehicle is loaded.</div> : (
                  <ul className="iw-finds">
                    {history.slice(0, 12).map((h) => {
                      const st = inspectionStage(h)
                      return (
                        <li key={h.id}>
                          <span className="iw-hist-day">{fmtDay(rowDay(h))}</span>
                          <span>{h.inspection_type || 'Inspection'}{h.inspector ? `, ${h.inspector}` : ''}</span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                          <button type="button" className="cc-link cc-link-btn" onClick={() => setSelectedId(h.id)}>View <ArrowRight size={12} aria-hidden="true" /></button>
                        </li>
                      )
                    })}
                  </ul>
                )
              )}
            </>
          )}
        </Card>

        <div className="iw-side">
          <Card title="Vehicle Overview" sub="Tyre map as recorded on this inspection">
            {selected ? <InspectionDiagram inspection={selected} width={210} showReadings={false} /> : <div className="cc-empty">No inspection selected.</div>}
          </Card>
          <Card title="Tyre Life Alerts" sub="From tyre running life today, not from photos">
            {!selected ? <div className="cc-empty">No inspection selected.</div>
              : flagMap == null ? <div className="cc-empty">Tyre life data is not available.</div>
                : !flags || !flags.count ? (
                  <div className="cc-empty">No tyre on {selected.asset_no || 'this vehicle'} is past or close to its expected life.</div>
                ) : (
                  <ul className="iw-finds">
                    {[...flags.overdue.map((t) => ['bad', 'Past life', t]), ...flags.dueSoon.map((t) => ['warn', 'Due soon', t])].map(([tone, label, t], i) => (
                      <li key={`${t.serial || t.position}-${i}`}>
                        <Pill tone={tone}>{label}</Pill>
                        <b>{t.position || 'Position not recorded'}</b>
                        <span>{t.serial || 'No serial'}{t.lifeUsedPct != null ? `, ${Math.round(t.lifeUsedPct)}% life used` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
          </Card>
        </div>
      </div>

      <div className="iw-bottom">
        <Card title="Recent Observations" action={
          <span className="iw-actions">
            {onAddObservation && <button type="button" className="cc-btn iw-inline" onClick={onAddObservation}><Plus size={12} aria-hidden="true" /> Add Observation</button>}
            <button type="button" className="cc-link cc-link-btn" onClick={onObservations}>View all <ArrowRight size={12} aria-hidden="true" /></button>
          </span>
        }>
          {!findings.length ? <div className="cc-empty">{unreadable ? 'Could not read the inspections.' : 'No tyre in these inspections was recorded as anything other than Good.'}</div> : (
            <ul className="iw-obs">
              {findings.map((f) => (
                <li key={f.key}>
                  <button type="button" onClick={() => setSelectedId(f.inspectionId)}>
                    <span className={`iw-obs-dot ${f.tone}`} aria-hidden="true"><AlertTriangle size={15} /></span>
                    <span className="iw-obs-main"><b>{f.condition} at {f.position}</b><small>{f.asset_no || 'No asset'}{f.site ? `, ${f.site}` : ''}</small></span>
                    <span className="iw-obs-side"><Pill tone={f.tone}>{f.severity}</Pill><small>{fmtDay(f.day)}{f.inspector ? `, ${f.inspector}` : ''}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Defect Categories" sub="Tyre conditions other than Good">
          {!defects.total ? <div className="cc-empty">No defect recorded in these inspections.</div>
            : <Donut segments={defects.segments} total={defects.total} centerLabel="Total findings" />}
        </Card>
        <Card title="Inspection Trends" sub="Last 30 days, by inspection date">
          {unreadable ? <div className="cc-empty">Could not read the inspections.</div>
            : !trend.any ? <div className="cc-empty">No inspection is dated in the last 30 days.</div>
              : <TrendChart trend={trend} />}
        </Card>
      </div>
    </div>
  )
}

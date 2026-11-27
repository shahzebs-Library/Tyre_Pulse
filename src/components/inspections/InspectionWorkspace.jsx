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
  MapPin, Gauge, Timer, User, Pencil, ArrowRight, Circle, ImageOff, Loader2, ArrowLeft,
} from 'lucide-react'
import { Card, Kpi, Tabs, Donut, Pager, VehicleThumb, fmtInt } from '../commandCenter/kit'
import InspectionPhotos, { usePhotoItems, PhotoLightbox } from '../inspection/InspectionPhotos'
import AiTyreProgress from '../inspection/AiTyreProgress'
import InspectionDiagram from '../inspection/InspectionDiagram'
import {
  LIST_TABS, listTabCounts, matchesListTab, searchInspections, sortNewest, inspectionStage,
  inspectionSections, inspectionProgress, assetHistory, recentFindings, defectCategories,
  inspectionTrend, workspaceKpis, ITEM_STATUS, rowDay,
} from '../../lib/inspectionWorkspaceView'
import ObservationsBoard from './ObservationsBoard'
import { useLanguage } from '../../contexts/LanguageContext'
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
  { key: 'inspections', icon: ClipboardCheck },
  { key: 'observations', icon: MessageSquare },
  { key: 'checklists', icon: ListChecks, to: '/checklists' },
  { key: 'schedules', icon: CalendarDays, to: '/inspection-planner' },
  { key: 'actions', icon: Wrench, to: '/actions' },
  { key: 'reports', icon: BarChart3, to: '/inspection-intelligence' },
]

/** One finding's own photo as a thumbnail; a click opens it large with Download. */
function FindingThumb({ item, onOpen }) {
  const { t } = useLanguage()
  if (!item) {
    return <span className="iw-fthumb iw-fthumb-none"><ImageOff size={14} aria-hidden="true" /><small>{t('inspections.workspace.photo.none')}</small></span>
  }
  if (item.status === 'loading') {
    return <span className="iw-fthumb iw-fthumb-none"><Loader2 size={14} className="animate-spin" aria-hidden="true" /><small>{t('inspections.workspace.photo.loading')}</small></span>
  }
  if (item.status !== 'ready') {
    return <span className="iw-fthumb iw-fthumb-none"><ImageOff size={14} aria-hidden="true" /><small>{t('inspections.workspace.photo.failed')}</small></span>
  }
  return (
    <button type="button" className="iw-fthumb" onClick={onOpen} aria-label={t('inspections.workspace.photo.openAria', { label: item.label })}>
      <img src={item.url} alt={t('inspections.workspace.photo.alt', { label: item.label })} loading="lazy" />
    </button>
  )
}

function Pill({ tone, children }) {
  return <span className={`cc-pill ${tone}`}>{children}</span>
}

/** Small three-series line chart. Real daily counts; a flat line means a quiet day, not missing data. */
function TrendChart({ trend }) {
  const { t } = useLanguage()
  const W = 520; const H = 170; const P = { l: 26, r: 8, t: 10, b: 22 }
  const max = Math.max(4, ...trend.completed, ...trend.pending, ...trend.overdue)
  const step = (W - P.l - P.r) / Math.max(1, trend.labels.length - 1)
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b)
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${(P.l + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const series = [
    { key: 'completed', label: t('inspections.workspace.trend.completed'), color: 'var(--cc-green)' },
    { key: 'pending', label: t('inspections.workspace.trend.pending'), color: 'var(--cc-blue)' },
    { key: 'overdue', label: t('inspections.workspace.trend.overdue'), color: 'var(--cc-red)' },
  ]
  const ticks = [0, Math.round(max / 2), max]
  const xTicks = trend.labels.filter((_, i) => i % 5 === 0 || i === trend.labels.length - 1)
  return (
    <div>
      <div className="iw-legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="iw-trend" role="img"
        aria-label={t('inspections.workspace.trend.aria', { days: trend.labels.length })}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={P.l} x2={W - P.r} y1={y(tk)} y2={y(tk)} stroke="var(--cc-track)" />
            <text x={P.l - 5} y={y(tk) + 3} textAnchor="end" className="iw-axis">{tk}</text>
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
  onObservations, onAddObservation, now, country, regionOf,
}) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.workspace.${k}`, v)
  const stageLabel = (s) => (s.key === 'scheduled' && s.label !== 'Scheduled' ? s.label : t(`inspections.workspace.stage.${s.key}`))
  const today = now || new Date()
  const [listTab, setListTab] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  // Pinned = opened on purpose from History, an observation or an action, so it
  // stays open even when it is not in the queue list on the left. Without this
  // the screen fell back to the first row, which was usually another vehicle.
  const [pinned, setPinned] = useState(false)
  const pick = (id, pin = false) => { setSelectedId(id); setPinned(pin) }
  const [photoIndex, setPhotoIndex] = useState(null)
  const [detailTab, setDetailTab] = useState('details')
  const [section, setSection] = useState(null)
  // Which module the strip has open. Observations is a view of the SAME rows,
  // not a filter to the Site Observation record type (the live data has none,
  // which is what made this screen go blank).
  const [mode, setMode] = useState('inspections')
  const openObservations = () => {
    setMode('observations')
    if (onObservations) onObservations()
  }

  const sorted = useMemo(() => sortNewest(rows), [rows])
  const counts = useMemo(() => listTabCounts(sorted, today), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(
    () => searchInspections(sorted, q).filter((r) => matchesListTab(r, listTab, today)),
    [sorted, q, listTab], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const kpis = useMemo(() => workspaceKpis(rows), [rows])
  useEffect(() => { setPage(0) }, [q, listTab])
  // A reload (after saving) must not throw the reader back to page 1; only
  // clamp when the list got shorter than the page being shown.
  useEffect(() => {
    const last = Math.max(0, Math.ceil(list.length / PAGE) - 1)
    if (page > last) setPage(last)
  }, [list.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // The selection follows the list: a filter that drops the selected row moves
  // the selection to the first visible row rather than showing a stale record.
  const selected = useMemo(() => {
    if (selectedId) {
      const inList = list.find((r) => r.id === selectedId)
      if (inList) return inList
      if (pinned) {
        const any = (allRows || rows || []).find((r) => r.id === selectedId)
        if (any) return any
      }
    }
    return list[0] || null
  }, [list, selectedId, pinned, allRows, rows])
  const outsideList = !!selected && !list.some((r) => r.id === selected.id)
  // Raising an action pins the vehicle, so the reload after saving keeps it open.
  const raise = (r) => { if (r?.id) pick(r.id, true); onRaiseAction(r) }
  const { items: photoItems } = usePhotoItems(selected)
  const photoFor = (positionKey) => photoItems.find((it) => it.key === `position:${positionKey}`) || null
  const generalPhotos = photoItems.filter((it) => it.group === 'general')
  useEffect(() => { setPhotoIndex(null) }, [selected?.id])
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
  const show = (v) => (unreadable ? p('na') : fmtInt(v))
  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE)
  const stage = inspectionStage(selected)

  return (
    <div className="cc iw">
      <header className="iw-head">
        <span className="iw-head-icon" aria-hidden="true"><ClipboardCheck size={26} /></span>
        <div className="iw-head-copy">
          <h1>{p('title')}</h1>
          <p>{p('subtitle')}</p>
        </div>
        <div className="iw-head-actions">{actions}</div>
      </header>

      <div className="iw-kpis">
        <Kpi icon={ClipboardList} tone="t-blue" display={show(kpis.total)} label={p('kpi.total')} loading={loading}
          title={unreadable ? undefined : p('kpi.vehiclesInspected', { count: fmtInt(kpis.vehicles) })} />
        <Kpi icon={CheckCircle2} tone="t-green" display={show(kpis.completed)} label={kpis.completedPct == null || unreadable ? p('kpi.completed') : p('kpi.completedPct', { pct: kpis.completedPct })} loading={loading} />
        <Kpi icon={Clock} tone="t-amber" display={show(kpis.pending)} label={kpis.pendingPct == null || unreadable ? p('kpi.pending') : p('kpi.pendingPct', { pct: kpis.pendingPct })} loading={loading} />
        <Kpi icon={AlertTriangle} tone="t-red" display={show(kpis.overdue)} label={kpis.overduePct == null || unreadable ? p('kpi.overdue') : p('kpi.overduePct', { pct: kpis.overduePct })} loading={loading} danger={!unreadable && kpis.overdue > 0} />
        <Kpi icon={ShieldAlert} tone="t-red" display={show(kpis.critical)} label={p('kpi.critical')} loading={loading}
          title={p('kpi.criticalHint')} />
        <div className="cc-card iw-filters">
          <label><span>{p('filters.from')}</span><input type="date" className="cc-select" value={from || ''} onChange={(e) => onFilter('from', e.target.value)} /></label>
          <label><span>{p('filters.to')}</span><input type="date" className="cc-select" value={to || ''} onChange={(e) => onFilter('to', e.target.value)} /></label>
          <label><span>{p('filters.site')}</span>
            <select className="cc-select" value={site || 'all'} onChange={(e) => onFilter('site', e.target.value)}>
              <option value="all">{p('filters.allSites')}</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      <nav className="iw-modules" aria-label={p('modules.aria')}>
        {MODULES.map((m) => {
          const Icon = m.icon
          const body = (<><span className="iw-mod-icon"><Icon size={18} aria-hidden="true" /></span><span><b>{t(`inspections.workspace.modules.${m.key}.label`)}</b><small>{t(`inspections.workspace.modules.${m.key}.sub`)}</small></span></>)
          if (m.to) return <Link key={m.key} to={m.to} className="iw-mod">{body}</Link>
          if (m.key === 'observations' || m.key === 'inspections') {
            const active = mode === m.key
            return (
              <button key={m.key} type="button" className={`iw-mod ${active ? 'is-active' : ''}`}
                aria-pressed={active} onClick={() => (m.key === 'observations' ? openObservations() : setMode('inspections'))}>
                {body}
              </button>
            )
          }
          return null
        })}
      </nav>

      {unreadable && (
        <div className="cc-card iw-error" role="alert">
          <span>{error}</span>
          <button type="button" className="cc-btn" onClick={onRetry}>{p('tryAgain')}</button>
        </div>
      )}

      {mode === 'observations' ? (
        <ObservationsBoard
          rows={rows}
          loading={loading}
          error={error}
          onBack={() => setMode('inspections')}
          onOpen={(r) => onView(r)}
          onRaiseAction={raise}
          onAddObservation={onAddObservation}
          country={country}
          regionOf={regionOf}
        />
      ) : (<>
      <div className="iw-main">
        <Card className="iw-list" title={p('list.title', { count: unreadable ? p('na') : fmtInt(sorted.length) })}>
          <div className="cc-search iw-search">
            <Search size={15} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={p('list.searchPlaceholder')} aria-label={p('list.searchAria')} />
          </div>
          <Tabs label={p('list.queueAria')} value={listTab} onChange={setListTab}
            tabs={LIST_TABS.map((lt) => ({ ...lt, label: t(`inspections.workspace.listTabs.${lt.key}`), count: unreadable ? null : counts[lt.key] }))} />
          {loading && !rows.length ? (
            <div className="iw-skel">{Array.from({ length: 6 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 52 }} />)}</div>
          ) : !pageRows.length ? (
            <div className="cc-empty">{unreadable ? p('couldNotRead') : p('list.empty')}</div>
          ) : (
            <ul className="iw-rows">
              {pageRows.map((r) => {
                const st = inspectionStage(r)
                return (
                  <li key={r.id}>
                    <button type="button" className={`iw-row ${selected?.id === r.id ? 'is-sel' : ''}`} onClick={() => pick(r.id)} aria-pressed={selected?.id === r.id}>
                      <VehicleThumb row={r} size="sm" />
                      <span className="iw-row-main">
                        <b>{r.asset_no || r.title || p('noAsset')}</b>
                        <small>{r.vehicle_type || r.inspection_type || p('typeNotRecorded')}</small>
                        <small className="iw-row-site"><MapPin size={11} aria-hidden="true" />{r.site || p('noSite')}</small>
                      </span>
                      <span className="iw-row-side">
                        <Pill tone={st.tone}>{stageLabel(st)}</Pill>
                        <small>{fmtDay(rowDay(r))}</small>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {list.length > PAGE && <Pager page={page} pageSize={PAGE} total={list.length} onPage={setPage} noun={p('list.noun')} />}
        </Card>

        <Card className="iw-detail">
          {!selected ? (
            <div className="cc-empty">{loading ? p('detail.loading') : p('detail.select')}</div>
          ) : (
            <>
              {outsideList && (
                <div className="iw-pinned" role="status">
                  <span>{p('detail.pinned', { asset: selected.asset_no || p('thisVehicle') })}</span>
                  <button type="button" className="cc-link cc-link-btn" onClick={() => pick(null)}><ArrowLeft size={12} aria-hidden="true" /> {p('detail.backToList')}</button>
                </div>
              )}
              <div className="iw-dhead">
                <VehicleThumb row={selected} size="lg" />
                <div className="iw-dhead-id">
                  <div className="iw-dhead-title">
                    <h2>{selected.asset_no || selected.title || p('noAsset')}</h2>
                    <Pill tone={stage.tone}>{stageLabel(stage)}</Pill>
                  </div>
                  <p>{[selected.vehicle_type, selected.inspection_type].filter(Boolean).join(' | ') || p('typeNotRecorded')}</p>
                  <AiTyreProgress inspectionId={selected.id} />
                </div>
                <div className="iw-dhead-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => onEdit(selected)}><Pencil size={14} aria-hidden="true" /> {p('detail.edit')}</button>
                  <button type="button" className="cc-btn-ghost" onClick={() => onPdf(selected)}><FileText size={14} aria-hidden="true" /> {p('detail.pdf')}</button>
                  {/* In the header, not the tyre table: observations, training records and
                      inspections without tyre readings still need signing. */}
                  {selected.approval_status === 'pending_approval' && onApprove && (
                    <button type="button" className="cc-btn-primary" onClick={() => onApprove(selected)}>{p('detail.reviewSign')}</button>
                  )}
                  <button type="button" className="cc-btn-primary" onClick={() => onView(selected)}><Eye size={14} aria-hidden="true" /> {p('detail.open')}</button>
                </div>
              </div>
              <div className="iw-facts">
                <span><User size={15} aria-hidden="true" /><b>{selected.inspector || selected.attendees || p('na')}</b><small>{p('facts.inspector')}</small></span>
                <span><MapPin size={15} aria-hidden="true" /><b>{selected.site || p('na')}</b><small>{p('facts.site')}</small></span>
                <span><Gauge size={15} aria-hidden="true" /><b>{meter(selected.odometer_km, 'km')}</b><small>{p('facts.odometer')}</small></span>
                <span><Timer size={15} aria-hidden="true" /><b>{meter(selected.hour_meter, 'hrs')}</b><small>{p('facts.engineHours')}</small></span>
                <span><CalendarDays size={15} aria-hidden="true" /><b>{fmtDay(rowDay(selected))}</b><small>{fmtTime(selected.created_at) || p('facts.date')}</small></span>
              </div>

              <Tabs variant="line" label={p('detailTabs.aria')} value={detailTab} onChange={setDetailTab} tabs={[
                { key: 'details', label: p('detailTabs.details') },
                { key: 'findings', label: p('detailTabs.findings'), count: selectedFindings.length },
                { key: 'photos', label: p('detailTabs.photos') },
                { key: 'history', label: p('detailTabs.history'), count: history.length },
              ]} />

              {detailTab === 'details' && (
                !sections.length ? (
                  <div className="cc-empty">
                    <div>{p('detail.noReadings')}{selected.findings ? <><br />{p('findingsLabel')} {selected.findings}</> : null}</div>
                  </div>
                ) : (
                  <div className="iw-check">
                    <ul className="iw-sections" aria-label={p('detail.sectionsAria')}>
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
                          <p>{p('detail.sectionHint')}</p>
                        </div>
                        {progress.total != null && (
                          <div className="iw-progress">
                            <small>{p('detail.progress', { done: progress.done, total: progress.total })}</small>
                            <span><i style={{ width: `${progress.pct}%` }} /></span>
                          </div>
                        )}
                      </div>
                      <div className="iw-table" role="table" aria-label={p('detail.itemsAria', { section: activeSection?.label || '' })}>
                        <div className="iw-tr iw-th" role="row">
                          <span role="columnheader">{p('detail.colItem')}</span><span role="columnheader">{p('detail.colStatus')}</span>
                          <span role="columnheader">{p('detail.colRemarks')}</span><span role="columnheader">{p('detail.colAction')}</span>
                        </div>
                        {activeSection?.items.map((it) => {
                          const meta = ITEM_STATUS[it.status]
                          return (
                            <div key={it.position} className="iw-tr" role="row">
                              <span role="cell"><b>{it.label}</b>{it.condition && it.status !== 'ok' && <small>{it.condition}</small>}</span>
                              <span role="cell"><Pill tone={meta.tone}>{it.status === 'ok' ? <CheckCircle2 size={12} aria-hidden="true" /> : null}{t(`inspections.workspace.itemStatus.${it.status}`)}</Pill></span>
                              <span role="cell" className="iw-remark">{it.remarks || (it.recorded ? p('noRemarks') : p('notRecorded'))}</span>
                              <span role="cell">
                                {(it.status === 'issue' || it.status === 'minor') && !selected.linked_action_id
                                  ? <button type="button" className="cc-btn" onClick={() => raise(selected)}>{p('detail.createAction')}</button>
                                  : it.status === 'issue' || it.status === 'minor'
                                    ? <Link className="cc-link" to="/actions">{p('detail.actionRaised')}</Link>
                                    : <span className="cc-na">-</span>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      {selected.findings && <p className="iw-note"><b>{p('findingsLabel')}</b> {selected.findings}</p>}
                      {selected.notes && <p className="iw-note"><b>{p('notesLabel')}</b> {selected.notes}</p>}
                    </div>
                  </div>
                )
              )}

              {detailTab === 'findings' && (
                <div className="iw-fbody">
                  {!selectedFindings.length
                    ? <div className="cc-empty">{p('detail.noFindings')}</div>
                    : (
                      <ul className="iw-finds iw-finds-photo">
                        {selectedFindings.map((f) => {
                          const ph = photoFor(f.positionKey)
                          return (
                            <li key={f.key}>
                              <FindingThumb item={ph} onOpen={() => setPhotoIndex(photoItems.indexOf(ph))} />
                              <span className="iw-find-text">
                                <span><Pill tone={f.tone}>{f.severity}</Pill> <b>{f.position}</b> {f.condition}</span>
                                <small>{f.notes || p('noRemarks')}</small>
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  {(selected.findings || selected.notes || generalPhotos.length > 0) && (
                    <div className="iw-fnotes">
                      {selected.findings && <p className="iw-note"><b>{p('findingsLabel')}</b> {selected.findings}</p>}
                      {selected.notes && <p className="iw-note"><b>{p('notesLabel')}</b> {selected.notes}</p>}
                      {generalPhotos.length > 0 && (
                        <div className="iw-fgallery" aria-label={p('detail.photosAria')}>
                          {generalPhotos.map((ph) => (
                            <FindingThumb key={ph.key} item={ph} onOpen={() => setPhotoIndex(photoItems.indexOf(ph))} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {photoIndex != null && photoItems[photoIndex] && (
                    <PhotoLightbox inspection={selected} items={photoItems} index={photoIndex} onIndex={setPhotoIndex} onClose={() => setPhotoIndex(null)} />
                  )}
                </div>
              )}

              {detailTab === 'photos' && <InspectionPhotos inspection={selected} showEvidence={false} title={p('detail.photosAria')} />}

              {detailTab === 'history' && (
                !history.length ? <div className="cc-empty">{p('detail.noHistory')}</div> : (
                  <ul className="iw-finds">
                    {history.slice(0, 12).map((h) => {
                      const st = inspectionStage(h)
                      return (
                        <li key={h.id}>
                          <span className="iw-hist-day">{fmtDay(rowDay(h))}</span>
                          <span>{h.inspection_type || p('detail.inspection')}{h.inspector ? `, ${h.inspector}` : ''}</span>
                          <Pill tone={st.tone}>{stageLabel(st)}</Pill>
                          <button type="button" className="cc-link cc-link-btn" onClick={() => { pick(h.id, true); setDetailTab('details') }}>{p('detail.view')} <ArrowRight size={12} aria-hidden="true" /></button>
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
          <Card title={p('side.overview')} sub={p('side.overviewSub')}>
            {selected ? <InspectionDiagram inspection={selected} width={300} showReadings={false} variant="board" /> : <div className="cc-empty">{p('side.noneSelected')}</div>}
          </Card>
          <Card title={p('side.lifeAlerts')} sub={p('side.lifeAlertsSub')}>
            {!selected ? <div className="cc-empty">{p('side.noneSelected')}</div>
              : flagMap == null ? <div className="cc-empty">{p('side.lifeUnavailable')}</div>
                : !flags || !flags.count ? (
                  <div className="cc-empty">{p('side.lifeNone', { asset: selected.asset_no || p('thisVehicle') })}</div>
                ) : (
                  <ul className="iw-finds">
                    {[...flags.overdue.map((ty) => ['bad', p('side.pastLife'), ty]), ...flags.dueSoon.map((ty) => ['warn', p('side.dueSoon'), ty])].map(([tone, label, ty], i) => (
                      <li key={`${ty.serial || ty.position}-${i}`}>
                        <Pill tone={tone}>{label}</Pill>
                        <b>{ty.position || p('side.positionNotRecorded')}</b>
                        <span>{ty.serial || p('side.noSerial')}{ty.lifeUsedPct != null ? p('side.lifeUsed', { pct: Math.round(ty.lifeUsedPct) }) : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
          </Card>
        </div>
      </div>

      <div className="iw-bottom">
        <Card title={p('bottom.recent')} action={
          <span className="iw-actions">
            {onAddObservation && <button type="button" className="cc-btn iw-inline" onClick={onAddObservation}><Plus size={12} aria-hidden="true" /> {p('bottom.addObservation')}</button>}
            <button type="button" className="cc-link cc-link-btn" onClick={openObservations}>{p('bottom.viewAll')} <ArrowRight size={12} aria-hidden="true" /></button>
          </span>
        }>
          {!findings.length ? <div className="cc-empty">{unreadable ? p('couldNotRead') : p('bottom.noFindings')}</div> : (
            <ul className="iw-obs">
              {findings.map((f) => (
                <li key={f.key}>
                  <button type="button" onClick={() => { pick(f.inspectionId, true); setDetailTab('findings') }}>
                    <span className={`iw-obs-dot ${f.tone}`} aria-hidden="true"><AlertTriangle size={15} /></span>
                    <span className="iw-obs-main"><b>{p('bottom.conditionAt', { condition: f.condition, position: f.position })}</b><small>{f.asset_no || p('noAsset')}{f.site ? `, ${f.site}` : ''}</small></span>
                    <span className="iw-obs-side"><Pill tone={f.tone}>{f.severity}</Pill><small>{fmtDay(f.day)}{f.inspector ? `, ${f.inspector}` : ''}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={p('bottom.defects')} sub={p('bottom.defectsSub')}>
          {!defects.total ? <div className="cc-empty">{p('bottom.noDefects')}</div>
            : <Donut segments={defects.segments} total={defects.total} centerLabel={p('bottom.totalFindings')} />}
        </Card>
        <Card title={p('bottom.trends')} sub={p('bottom.trendsSub')}>
          {unreadable ? <div className="cc-empty">{p('couldNotRead')}</div>
            : !trend.any ? <div className="cc-empty">{p('bottom.noTrend')}</div>
              : <TrendChart trend={trend} />}
        </Card>
      </div>
      </>)}
    </div>
  )
}

/**
 * Checklists workspace: the mockup-style "inspections and observations" view at
 * the top of /checklists. A KPI strip, then three columns (the submissions list,
 * the selected sheet, its photos and findings), then three summary cards.
 *
 * It reads ONLY what the page already loaded (submissions + templates). The
 * selected sheet is loaded in full on demand (getSubmission) because that is
 * where photos are signed for the private bucket. Every reading of a line
 * (OK / Minor / Issue) comes from src/lib/checklistWorkspaceView.js.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardCheck, CheckCircle2, Clock, XCircle, AlertTriangle, Search, ExternalLink,
  Download, Eye, Image as ImageIcon, Check, Loader2, Camera,
} from 'lucide-react'
import { Card, Kpi, Tabs, Donut, Pager, CardState, VehicleThumb, KitTable, fmtInt, fmtPct } from '../commandCenter/kit'
import { getSubmission } from '../../lib/api/checklists'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'
import { documentNo } from '../../lib/checklistView'
import { submissionTarget } from '../../lib/checklistMonthly'
import { resolveChecklistIcon, checklistIconComponent } from '../../lib/checklist/checklistIcons'
import {
  ROW_STATUS, WORKSPACE_BUCKETS, workspaceBucket, receivedAt, templateForSubmission,
  workspaceSections, submissionFindings, workspaceKpis, listTabCounts, filterWorkspaceList,
  recentFindings, findingsBySection, submissionTrend, submissionPhotos, submissionHistory,
} from '../../lib/checklistWorkspaceView'
import './checklistWorkspace.css'

const PAGE_SIZE = 8
// SVG presentation attributes cannot resolve CSS variables, so the donut takes
// literal colours. They read on both the light and the dark card.
const DONUT_COLORS = ['#dc2626', '#f59e0b', '#2563eb', '#9333ea', '#0d9488', '#64748b']

function fmtWhen(ms) {
  if (ms == null) return 'N/A'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const fmtIso = (v) => fmtWhen(v ? Date.parse(v) : null)

function TemplateGlyph({ template }) {
  const res = resolveChecklistIcon(template || {})
  if (res.kind === 'emoji') return <span className="clw-glyph" role="img" aria-label="Checklist icon">{res.emoji}</span>
  const Icon = checklistIconComponent(res.token)
  return <span className="clw-glyph"><Icon size={17} aria-hidden="true" /></span>
}

function BucketPill({ sub }) {
  const b = WORKSPACE_BUCKETS[workspaceBucket(sub)]
  return <span className={`cc-pill ${b.tone}`} title={b.title}>{b.label}</span>
}

function StatusPill({ status }) {
  const s = ROW_STATUS[status] || ROW_STATUS.recorded
  return <span className={`cc-pill ${s.tone}`} title={s.title}>{s.label}</span>
}

/** Resolve stored photo refs to displayable URLs; never renders an unsafe src. */
function useResolvedPhotos(photos) {
  const [state, setState] = useState({ loading: false, items: [] })
  useEffect(() => {
    let alive = true
    if (!photos.length) { setState({ loading: false, items: [] }); return undefined }
    setState({ loading: true, items: [] })
    Promise.all(photos.map(async (p) => {
      let url = null
      try {
        url = String(p.src).startsWith('tp-storage://') ? await resolveStorageUrl(p.src) : safeImageSrc(p.src)
      } catch { url = null }
      return { ...p, url: url || null }
    })).then((items) => { if (alive) setState({ loading: false, items }) })
    return () => { alive = false }
  }, [photos])
  return state
}

function TrendChart({ trend }) {
  const W = 320; const H = 120; const P = 8
  const max = Math.max(1, ...trend.flatMap((d) => [d.done, d.pending, d.rejected]))
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, trend.length - 1)
  const y = (v) => H - P - (v / max) * (H - 2 * P)
  const line = (k) => trend.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')
  const total = trend.reduce((n, d) => n + d.done + d.pending + d.rejected, 0)
  const series = [
    { k: 'done', label: 'Completed or approved', color: 'var(--cc-green)' },
    { k: 'pending', label: 'Pending', color: 'var(--cc-amber)' },
    { k: 'rejected', label: 'Rejected', color: 'var(--cc-red)' },
  ]
  if (!total) return <div className="cc-empty">No submissions in the last 30 days.</div>
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="clw-trend" role="img"
        aria-label={series.map((s) => `${s.label} ${trend.reduce((n, d) => n + d[s.k], 0)}`).join(', ')}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} style={{ stroke: 'var(--cc-track)' }} />)}
        {series.map((s) => <polyline key={s.k} points={line(s.k)} fill="none" style={{ stroke: s.color }} strokeWidth="2" strokeLinejoin="round" />)}
      </svg>
      <div className="clw-trend-axis"><span>{trend[0]?.day}</span><span>Peak {max} per day</span><span>{trend[trend.length - 1]?.day}</span></div>
      <ul className="clw-legend">
        {series.map((s) => (
          <li key={s.k}><i style={{ background: s.color }} aria-hidden="true" />{s.label}<b>{fmtInt(trend.reduce((n, d) => n + d[s.k], 0))}</b></li>
        ))}
      </ul>
    </div>
  )
}

export default function ChecklistWorkspace({
  submissions = [], templates = [], loading = false, error = '', onRetry,
  onOpenViewer, onDownloadPdf, pdfBusyId = null, now = Date.now(),
}) {
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [detailTab, setDetailTab] = useState('details')
  const [sectionId, setSectionId] = useState(null)
  const [full, setFull] = useState({ loading: false, data: null, error: null, id: null })
  const [reloadKey, setReloadKey] = useState(0)

  const listState = { loading, data: loading ? null : submissions, error: error || null, retry: onRetry }

  // Findings for every loaded sheet, read with each sheet's own template.
  const findingsBySub = useMemo(() => {
    const m = new Map()
    for (const s of submissions) m.set(s.id, submissionFindings(s, templateForSubmission(s, templates)))
    return m
  }, [submissions, templates])

  const kpis = useMemo(() => workspaceKpis(submissions, findingsBySub), [submissions, findingsBySub])
  const counts = useMemo(() => listTabCounts(submissions, now), [submissions, now])
  const list = useMemo(() => filterWorkspaceList(submissions, { tab, query, now, templates }), [submissions, tab, query, now, templates])
  const pageRows = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  useEffect(() => { setPage(0) }, [tab, query])
  useEffect(() => {
    if (page > 0 && page * PAGE_SIZE >= list.length) setPage(Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1))
  }, [list.length, page])
  useEffect(() => {
    if (!list.length) { if (selectedId != null) setSelectedId(null); return }
    if (!list.some((s) => s.id === selectedId)) setSelectedId(list[0].id)
  }, [list, selectedId])

  const selectedRow = useMemo(() => submissions.find((s) => s.id === selectedId) || null, [submissions, selectedId])

  // The list row is a summary; photos are signed only on the full record.
  useEffect(() => {
    if (selectedId == null) { setFull({ loading: false, data: null, error: null, id: null }); return undefined }
    let alive = true
    setFull({ loading: true, data: null, error: null, id: selectedId })
    Promise.resolve().then(() => getSubmission(selectedId)).then(
      (row) => { if (alive) setFull({ loading: false, data: row || null, error: row ? null : 'That checklist could not be opened.', id: selectedId }) },
      (e) => { if (alive) setFull({ loading: false, data: null, error: toUserMessage(e, 'Could not load this checklist.'), id: selectedId }) },
    )
    return () => { alive = false }
  }, [selectedId, reloadKey])

  const sheet = full.data || selectedRow
  const template = useMemo(() => (sheet ? templateForSubmission(sheet, templates) : null), [sheet, templates])
  const sections = useMemo(() => workspaceSections(sheet, template), [sheet, template])
  useEffect(() => { setSectionId(sections[0]?.id ?? null) }, [selectedId, sections.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const section = sections.find((s) => s.id === sectionId) || sections[0] || null
  const sheetFindings = useMemo(() => sections.flatMap((s) => s.rows.filter((r) => r.status === 'issue').map((r) => ({ ...r, section: s.label }))), [sections])
  const photos = useMemo(() => (full.data ? submissionPhotos(full.data, sections) : []), [full.data, sections])
  const resolved = useResolvedPhotos(photos)
  const photoByField = useMemo(() => {
    const m = new Map()
    for (const p of resolved.items) if (p.url && !m.has(String(p.fieldId))) m.set(String(p.fieldId), p.url)
    return m
  }, [resolved.items])
  const history = useMemo(() => submissionHistory(sheet, template), [sheet, template])
  const target = sheet ? submissionTarget(sheet, template?.fields) : { assetNo: null, site: null }
  const docNo = documentNo(sheet)

  const recent = useMemo(() => recentFindings(submissions, findingsBySub, 8), [submissions, findingsBySub])
  const bySection = useMemo(() => findingsBySection(submissions, findingsBySub, 5).map((s, i) => ({ ...s, color: DONUT_COLORS[i % DONUT_COLORS.length] })), [submissions, findingsBySub])
  const trend = useMemo(() => submissionTrend(submissions, now, 30), [submissions, now])

  const itemColumns = [
    { key: 'label', header: 'Item', sortable: false, cell: (r) => <span className="clw-item">{r.label}{r.text != null && r.status !== 'unanswered' && <small>{r.text}</small>}</span> },
    { key: 'status', header: 'Status', sortable: false, cell: (r) => <StatusPill status={r.status} /> },
    { key: 'note', header: 'Remarks', sortable: false, cell: (r) => r.note || <span className="cc-na">N/A</span> },
    { key: 'photo', header: 'Photo', sortable: false, cell: (r) => {
      const url = photoByField.get(String(r.id))
      return url ? <img src={url} alt={`Photo for ${r.label}`} className="clw-thumb" loading="lazy" /> : <span className="cc-na">N/A</span>
    } },
    { key: 'action', header: 'Action', sortable: false, cell: (r) => (r.status === 'issue'
      ? <Link className="cc-btn" to="/actions">Action</Link>
      : <span className="cc-na">N/A</span>) },
  ]

  return (
    <div className="cc clw" aria-label="Checklist workspace">
      <div className="clw-kpis">
        <Kpi icon={ClipboardCheck} tone="t-blue" value={kpis.total} loading={loading} display={error ? 'N/A' : undefined} label="Total submissions" />
        <Kpi icon={CheckCircle2} tone="t-green" value={kpis.done} loading={loading} display={error ? 'N/A' : undefined}
          label={error ? 'Completed or approved' : `Completed or approved (${fmtPct(kpis.donePct)})`} title="Approved, or completed with no approval required" />
        <Kpi icon={Clock} tone="t-amber" value={kpis.pending} loading={loading} display={error ? 'N/A' : undefined} label="Pending approval" />
        <Kpi icon={XCircle} tone="t-red" value={kpis.rejected} loading={loading} display={error ? 'N/A' : undefined} label="Rejected or returned" />
        <Kpi icon={AlertTriangle} tone="t-orange" value={kpis.failedItems} loading={loading} display={error ? 'N/A' : undefined}
          label={error ? 'Failed items' : `Failed items (${fmtInt(kpis.withFindings)} sheets)`} title="Lines marked with a fault or a failing answer" />
      </div>

      <div className="clw-cols">
        <Card className="clw-list" title={`Checklist Submissions (${fmtInt(list.length)})`}>
          <div className="cc-search clw-search">
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asset, checklist, site" aria-label="Search checklist submissions" />
          </div>
          <Tabs label="Submission filter" value={tab} onChange={setTab} tabs={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'today', label: 'Today', count: counts.today },
            { key: 'pending', label: 'Pending', count: counts.pending },
            { key: 'rejected', label: 'Rejected', count: counts.rejected, countTone: counts.rejected ? 'red' : '' },
          ]} />
          <CardState state={listState} empty={!loading && !error && !list.length
            ? (submissions.length ? 'No submissions match this filter.' : 'No checklist submissions yet.') : null} lines={6}>
            <ul className="clw-rows">
              {pageRows.map((s) => {
                const tpl = templates.find((t) => String(t.id) === String(s.template_id))
                const tg = submissionTarget(s, tpl?.fields)
                return (
                  <li key={s.id}>
                    <button type="button" className="clw-row" aria-pressed={s.id === selectedId} onClick={() => { setSelectedId(s.id); setDetailTab('details') }}>
                      <TemplateGlyph template={tpl || { name: s.template_name }} />
                      <span className="clw-row-main">
                        <b>{tg.assetNo || tg.site || 'No asset recorded'}</b>
                        <span>{s.title || s.template_name || 'Checklist'}</span>
                        <small>{fmtWhen(receivedAt(s))}</small>
                      </span>
                      <BucketPill sub={s} />
                    </button>
                  </li>
                )
              })}
            </ul>
            {list.length > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={list.length} onPage={setPage} noun="submissions" />}
          </CardState>
        </Card>

        <Card className="clw-detail">
          {!sheet ? (
            <CardState state={listState} empty={loading || error ? null : 'Select a submission to read it here.'} lines={6}><span /></CardState>
          ) : (
            <>
              <div className="clw-head">
                <VehicleThumb row={{ asset_no: target.assetNo }} size="md" />
                <div className="clw-head-main">
                  <h2>{target.assetNo || 'No asset recorded'} <BucketPill sub={sheet} /></h2>
                  <p>{sheet.title || sheet.template_name || 'Checklist'}</p>
                  <dl className="clw-meta">
                    <div><dt>Document no</dt><dd>{docNo || 'N/A'}</dd></div>
                    <div><dt>Submitted by</dt><dd>{sheet.printed_name || 'N/A'}</dd></div>
                    <div><dt>Site</dt><dd>{target.site || 'N/A'}</dd></div>
                    <div><dt>Date and time</dt><dd>{fmtWhen(receivedAt(sheet))}</dd></div>
                  </dl>
                </div>
              </div>
              <div className="clw-actions">
                <Link className="cc-btn-ghost" to={`/checklists/submission/${sheet.id}`}><ExternalLink size={14} aria-hidden="true" /> Open full record</Link>
                <button type="button" className="cc-btn-ghost" disabled={pdfBusyId === sheet.id} onClick={() => onDownloadPdf?.(sheet)}>
                  {pdfBusyId === sheet.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Download PDF
                </button>
                <button type="button" className="cc-btn-ghost" onClick={() => onOpenViewer?.(sheet.id)}><Eye size={14} aria-hidden="true" /> Open viewer</button>
              </div>

              <Tabs variant="line" label="Submission detail" value={detailTab} onChange={setDetailTab} tabs={[
                { key: 'details', label: 'Checklist Details' },
                { key: 'photos', label: 'Photos', count: full.data ? photos.length : null },
                { key: 'history', label: 'History' },
              ]} />

              {full.error && (
                <div className="clw-note" role="alert">
                  {full.error} <button type="button" className="cc-btn" onClick={() => setReloadKey((k) => k + 1)}>Try again</button>
                </div>
              )}

              {detailTab === 'details' && (
                !sections.length
                  ? <div className="cc-empty">{full.loading ? 'Loading the checklist...' : 'This submission carries no recorded lines.'}</div>
                  : (
                    <div className="clw-sheet">
                      <ul className="clw-sections" aria-label="Sections">
                        {sections.map((s) => (
                          <li key={s.id}>
                            <button type="button" aria-pressed={section?.id === s.id} onClick={() => setSectionId(s.id)}>
                              <span className="clw-sec-label">{s.label}</span>
                              <span className="clw-sec-count">{s.answered}/{s.total}</span>
                              {s.complete
                                ? <Check size={14} className="clw-sec-ok" aria-label="Complete" />
                                : s.issues ? <AlertTriangle size={14} className="clw-sec-bad" aria-label="Has findings" /> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="clw-items">
                        <KitTable compact columns={itemColumns} rows={section?.rows || []} getRowId={(r) => String(r.id)} empty="No lines in this section." />
                      </div>
                    </div>
                  )
              )}

              {detailTab === 'photos' && (
                full.loading ? <div className="cc-empty">Loading photos...</div>
                  : resolved.loading ? <div className="cc-empty">Loading photos...</div>
                    : !resolved.items.length ? <div className="cc-empty">No photos were attached to this submission.</div>
                      : (
                        <div className="clw-gallery">
                          {resolved.items.map((p) => (
                            <figure key={p.key}>
                              {p.url ? <img src={p.url} alt={p.label || 'Checklist photo'} loading="lazy" /> : <span className="clw-photo-missing">Photo unavailable</span>}
                              <figcaption>{p.label || 'Photo'}</figcaption>
                            </figure>
                          ))}
                        </div>
                      )
              )}

              {detailTab === 'history' && (
                <ol className="clw-history">
                  {history.map((h) => (
                    <li key={h.key} className={`clw-h-${h.state}`}>
                      <i aria-hidden="true" />
                      <div>
                        <b>{h.label}</b>
                        <span>{[h.name, h.at ? fmtIso(h.at) : (h.state === 'current' ? 'Waiting' : null)].filter(Boolean).join(', ') || 'N/A'}</span>
                        {h.note && <p>{h.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Card>

        <div className="clw-side">
          <Card title="Photos" sub={sheet ? (target.assetNo || 'Selected submission') : null}>
            {!sheet ? <div className="cc-empty">No submission selected.</div>
              : full.loading || resolved.loading ? <div className="cc-skel" style={{ height: 90 }} />
                : !resolved.items.length ? <div className="cc-empty"><span><Camera size={18} aria-hidden="true" /><br />No photos attached.</span></div>
                  : (
                    <div className="clw-gallery clw-gallery-sm">
                      {resolved.items.slice(0, 6).map((p) => (
                        <figure key={p.key}>
                          {p.url ? <img src={p.url} alt={p.label || 'Checklist photo'} loading="lazy" /> : <span className="clw-photo-missing"><ImageIcon size={16} aria-hidden="true" /></span>}
                        </figure>
                      ))}
                    </div>
                  )}
            {resolved.items.length > 6 && <button type="button" className="cc-btn clw-more" onClick={() => setDetailTab('photos')}>View all {resolved.items.length}</button>}
          </Card>
          <Card title="Findings" sub="Lines marked with a fault on this sheet">
            {!sheet ? <div className="cc-empty">No submission selected.</div>
              : !sheetFindings.length ? <div className="cc-empty">No failing lines on this sheet.</div>
                : (
                  <ul className="clw-findings">
                    {sheetFindings.map((f) => (
                      <li key={f.id}>
                        <AlertTriangle size={15} aria-hidden="true" />
                        <div>
                          <b>{f.label}</b>
                          <span>{f.section}{f.text ? `, ${f.text}` : ''}</span>
                          {f.note && <p>{f.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
          </Card>
        </div>
      </div>

      <div className="clw-bottom">
        <Card title="Recent Findings" sub="Latest failing lines across submissions">
          <CardState state={listState} empty={!loading && !error && !recent.length ? 'No failing lines recorded.' : null}>
            <ul className="clw-findings">
              {recent.map((f) => (
                <li key={f.key}>
                  <AlertTriangle size={15} aria-hidden="true" />
                  <button type="button" className="clw-link-row" onClick={() => { setTab('all'); setQuery(''); setSelectedId(f.submissionId); setDetailTab('details') }}>
                    <b>{f.label}</b>
                    <span>{[f.assetNo || 'No asset', f.template].join(', ')}</span>
                    <small>{fmtWhen(f.at)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </CardState>
        </Card>
        <Card title="Findings by Section">
          <CardState state={listState} empty={!loading && !error && !bySection.length ? 'No findings to group.' : null}>
            <Donut segments={bySection} centerLabel="findings" />
          </CardState>
        </Card>
        <Card title="Submission Trend" sub="Last 30 days, by day received">
          <CardState state={listState}>
            <TrendChart trend={trend} />
          </CardState>
        </Card>
      </div>
    </div>
  )
}

/**
 * ReportSharing (route /report-sharing): the home for shareable PUBLIC report
 * and TV board links, rebuilt on the Command Center kit to the owner's mockup.
 *
 * Layout: header with Share Report, five KPI tiles, a filter bar, the
 * "Shared Reports & Boards" register with a Selected Share side panel, access
 * analytics (views per link, views by status), then the existing share manager
 * and custom board builder (ReportSharesPanel / ReportShareBuilder), unchanged.
 *
 * Data: report_shares via listReportShares() (active rows only). Every share
 * is a read-only public link that opens without a login, so channel and access
 * are product facts, not per-row values. NOT recorded, and shown as such:
 * named viewers (links are anonymous), per-day view history (only a running
 * view_count and last_viewed_at), who created a link (not selected by the
 * service), whether a password is set (the hash is never read), IP
 * restriction, watermarking and download control (not supported). Revoked
 * links are not listed, so their count is unknown.
 *
 * Elevated only (Admin / Manager / Director / super admin); the route is also
 * RoleRoute gated. Pure shaping: src/lib/reportSharingAnalytics.js and
 * src/lib/reportSharingView.js. ASCII punctuation only in user-facing text.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Share2, Tv, Eye, Radio, Palette, AlertCircle, LayoutGrid, Link2, RefreshCw, Hourglass,
  EyeOff, FileSpreadsheet, FileText, ChevronRight, Search, X, List, Copy, ExternalLink,
  Ban, Lock, Info, Check, Calendar, Plus, Users,
} from 'lucide-react'
import {
  enrichShares, summarizeShares, shareFindings, exportRows,
  EXPORT_COLUMNS, LINK_STATUSES, STATUS_META, STALE_DAYS, EXPIRING_DAYS,
} from '../lib/reportSharingAnalytics'
import {
  BOARD_TYPES, EXPIRY_FILTERS, STATUS_TONE, filterShareRows, shareKpis, expiryText,
  relativeAgo, viewsByLink, viewsByStatus, shareDetail,
} from '../lib/reportSharingView'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import ReportSharesPanel from '../components/display/ReportSharesPanel'
import { listReportShares, revokeReportShare, buildShareUrl, REPORT_PAGES } from '../lib/api/reportShares'
import { hasCustomLayout, normalizeLayout } from '../lib/reportShareLayout'
import { activePaletteName, PRESET_LABELS } from '../lib/reportColors'
import { useAuth } from '../contexts/AuthContext'
import { toUserMessage } from '../lib/safeError'
import { safeHref } from '../lib/safeUrl'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, KitTable, Donut, fmtInt } from '../components/commandCenter/kit'
import './ReportSharing.css'

const ELEVATED = new Set(['Admin', 'Manager', 'Director'])
const PAGE_LABELS = Object.fromEntries(REPORT_PAGES.map((p) => [p.key, p.label]))

function KpiLabel({ title, sub }) {
  return <>{title}<small className="rs-kpi-sub">{sub}</small></>
}

function StatusPill({ status }) {
  return <span className={`cc-pill ${STATUS_TONE[status] || 'muted'}`}>{STATUS_META[status]?.label || status}</span>
}

function ExpiryCell({ row }) {
  const e = expiryText(row)
  return (
    <span className="rs-stack">
      <span>{e.text}</span>
      {e.sub && <small className={e.tone === 'bad' ? 'rs-bad' : undefined}>{e.sub}</small>}
    </span>
  )
}

function ShareName({ row }) {
  return (
    <span className="rs-name">
      <span className={`rs-name-icon ${row.custom ? 'is-custom' : ''}`}>{row.custom ? <LayoutGrid size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}</span>
      <span className="rs-stack">
        <b>{row.name || 'Shared report'}</b>
        <small>{row.custom ? `${row.boards} custom board${row.boards === 1 ? '' : 's'}` : `${row.boards} report page${row.boards === 1 ? '' : 's'}`}</small>
      </span>
    </span>
  )
}

export default function ReportSharing() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const elevated = ELEVATED.has(profile?.role) || profile?.is_super_admin === true

  const [shares, setShares] = useState([])
  // One clock read per load so every figure on the page shares the same "now".
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const rows = await listReportShares()
      setShares(Array.isArray(rows) ? rows : [])
      setNow(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load report links.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (elevated) load() }, [elevated, load])

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [panelKey, setPanelKey] = useState(0)
  const managerRef = useRef(null)

  // Board counts use the canonical layout normalizer so the page agrees with the builder.
  const normalized = useMemo(() => shares.map((r) => (
    hasCustomLayout(r.layout) ? { ...r, layout: { boards: normalizeLayout(r.layout)?.boards || [] } } : { ...r, layout: null }
  )), [shares])
  const enriched = useMemo(() => enrichShares(normalized, { now }), [normalized, now])
  // listReportShares() returns active rows only, so revoked links are not measurable here.
  const summary = useMemo(() => summarizeShares(normalized, { now, includesRevoked: false }), [normalized, now])
  const kpi = useMemo(() => shareKpis(summary, enriched), [summary, enriched])
  const findings = useMemo(() => shareFindings(summary), [summary])
  const visible = useMemo(() => filterShareRows(enriched, {
    search, status: statusFilter, type: typeFilter, expiry: expiryFilter, pageLabels: PAGE_LABELS,
  }), [enriched, search, statusFilter, typeFilter, expiryFilter])
  const statusCounts = useMemo(() => {
    const c = { all: enriched.length }
    LINK_STATUSES.forEach((st) => { c[st] = enriched.filter((r) => r.status === st).length })
    return c
  }, [enriched])
  const selected = useMemo(() => enriched.find((r) => r.id === selectedId) || visible[0] || null, [enriched, selectedId, visible])
  const detail = useMemo(() => shareDetail(selected, { now, pageLabels: PAGE_LABELS }), [selected, now])
  const shareUrl = selected?.token ? buildShareUrl(selected.token) : null
  const bars = useMemo(() => viewsByLink(enriched, 8), [enriched])
  const barMax = bars.reduce((m, b) => Math.max(m, b.views), 0)
  const donut = useMemo(() => viewsByStatus(enriched, STATUS_META), [enriched])
  const paletteName = PRESET_LABELS[activePaletteName()] || 'Custom'
  const anyFilter = search || statusFilter !== 'all' || typeFilter !== 'all' || expiryFilter !== 'all'
  const cardState = { loading, error, retry: load, data: loading ? null : shares }

  useEffect(() => { setCopied(false) }, [selectedId])

  const scrollToManager = () => managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const resetFilters = () => { setSearch(''); setStatusFilter('all'); setTypeFilter('all'); setExpiryFilter('all') }

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
    } catch {
      setNotice({ tone: 'bad', text: 'Could not copy the link. Select it and copy it by hand.' })
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true); setRevokeError(null)
    try {
      await revokeReportShare(revokeTarget.id)
      setRevokeTarget(null)
      setSelectedId(null)
      setNotice({ tone: 'good', text: 'Report link revoked. It no longer opens.' })
      setPanelKey((k) => k + 1)
      await load()
    } catch (err) {
      setRevokeError(toUserMessage(err, 'Could not revoke the report link.'))
    } finally {
      setRevoking(false)
    }
  }

  const runExport = async (kind) => {
    setExporting(true); setExportError(null)
    try {
      const rows = exportRows(visible)
      const name = reportFileName('TyrePulse Report Share Links', reportDateLabel())
      if (kind === 'xlsx') {
        await exportToExcel(rows, EXPORT_COLUMNS.map((c) => c.key), EXPORT_COLUMNS.map((c) => c.header), name)
      } else {
        await exportToPdf(rows, EXPORT_COLUMNS, 'Report Share Links', name, 'landscape')
      }
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not export the share links.'))
    } finally {
      setExporting(false)
    }
  }

  const columns = useMemo(() => [
    { key: 'name', header: 'Report / Board', sortValue: (r) => r.name || '', cell: (r) => <ShareName row={r} /> },
    { key: 'access', header: 'Access', sortable: false, cell: () => <span className="rs-chip"><Eye size={13} aria-hidden="true" /> View only</span> },
    { key: 'channel', header: 'Channel', sortable: false, cell: () => <span className="rs-inline"><Link2 size={13} aria-hidden="true" /> Public link</span> },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    { key: 'views', header: 'Views', numeric: true, sortValue: (r) => r.views ?? -1, cell: (r) => (r.views == null ? <span className="cc-na">N/A</span> : fmtInt(r.views)) },
    { key: 'last', header: 'Last viewed', sortValue: (r) => r.last_viewed_at || '', cell: (r) => (r.last_viewed_at ? relativeAgo(r.last_viewed_at, now) : <span className="cc-na">Never</span>) },
    { key: 'expires', header: 'Expires', sortValue: (r) => r.expires_at || '9999', cell: (r) => <ExpiryCell row={r} /> },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <button type="button" className={`cc-btn-ghost rs-manage ${selected?.id === r.id ? 'is-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}>Manage</button>
      ),
    },
  ], [now, selected])

  if (!elevated) {
    return (
      <div className="cc rs-page">
        <div className="cc-card rs-banner" role="status">
          <AlertCircle size={16} aria-hidden="true" /> <span>You do not have access to report sharing.</span>
        </div>
      </div>
    )
  }

  const kpis = [
    { icon: Link2, tone: 't-green', value: kpi.live, label: <KpiLabel title="Shared reports" sub="Live links" /> },
    { icon: Eye, tone: 't-blue', value: kpi.totalViews, label: <KpiLabel title="Total views" sub={summary.avgViewsPerLiveLink == null ? 'No views recorded yet' : `${summary.avgViewsPerLiveLink.toFixed(1)} per live link`} /> },
    { icon: Tv, tone: 't-purple', value: kpi.boards, label: <KpiLabel title="Rotating boards" sub={`${fmtInt(kpi.customDesigned)} custom designed`} /> },
    { icon: Hourglass, tone: 't-orange', value: kpi.expiring, label: <KpiLabel title="Link expires" sub={`Within ${EXPIRING_DAYS} days`} />, danger: (kpi.expiring || 0) > 0 },
    { icon: EyeOff, tone: 't-red', value: (kpi.expired ?? 0) + (kpi.stale ?? 0), display: kpi.expired == null ? 'N/A' : undefined, label: <KpiLabel title="Need attention" sub={`Expired or not viewed in ${STALE_DAYS} days`} /> },
  ]

  return (
    <div className="cc rs-page">
      <header className="rs-head">
        <div className="rs-head-copy">
          <nav aria-label="Breadcrumb" className="rs-crumb">Analytics &amp; Reports <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Report Sharing</span></nav>
          <div className="rs-title">
            <span className="rs-title-icon"><Share2 size={22} aria-hidden="true" /></span>
            <div>
              <h1>Report Sharing</h1>
              <p>Share live report boards on a control-room TV or a public read-only link. No login required.</p>
            </div>
          </div>
        </div>
        <div className="rs-head-actions">
          <div className="rs-clock" title="Figures as of this time">
            <Calendar size={16} aria-hidden="true" />
            <span><b>{now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</b><small>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></span>
          </div>
          <button type="button" className="cc-icon-btn" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className="cc-btn-ghost" onClick={() => navigate('/display')}><Radio size={15} aria-hidden="true" /> TV Display Mode</button>
          <button type="button" className="cc-btn-primary" onClick={scrollToManager}><Plus size={15} aria-hidden="true" /> Share Report</button>
        </div>
      </header>

      {notice && (
        <div className={`cc-card rs-banner ${notice.tone === 'bad' ? 'is-bad' : 'is-good'}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          {notice.tone === 'bad' ? <AlertCircle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          <span>{notice.text}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      {error && (
        <div className="cc-card rs-banner is-bad" role="alert">
          <AlertCircle size={16} aria-hidden="true" /> <span>{error}</span>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
        </div>
      )}

      <div className="cc-kpis rs-kpis">
        {kpis.map((x, i) => <Kpi key={i} {...x} loading={loading} display={error ? 'N/A' : x.display} />)}
      </div>

      {!loading && !error && findings.length > 0 && (
        <div className="cc-card rs-findings" aria-label="Needs attention">
          {findings.map((f, i) => (
            <span key={i} className={`cc-pill ${f.tone === 'danger' ? 'bad' : f.tone === 'warning' ? 'warn' : 'info'}`}>{f.text}</span>
          ))}
        </div>
      )}

      <div className="cc-card rs-filters">
        <label className="cc-search">
          <Search size={15} aria-hidden="true" />
          <input aria-label="Search shared reports" placeholder="Search shared reports or boards..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="cc-select" aria-label="Board type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {BOARD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="cc-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses ({statusCounts.all})</option>
          {LINK_STATUSES.filter((st) => st !== 'revoked').map((st) => <option key={st} value={st}>{STATUS_META[st].label} ({statusCounts[st] ?? 0})</option>)}
        </select>
        <select className="cc-select" aria-label="Expiry" value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)}>
          {EXPIRY_FILTERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {anyFilter && <button type="button" className="cc-btn-ghost" onClick={resetFilters}><X size={14} aria-hidden="true" /> Reset</button>}
        <span className="rs-push" />
        <button type="button" className="cc-btn-ghost" onClick={() => runExport('xlsx')} disabled={exporting || visible.length === 0}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
        <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={exporting || visible.length === 0}><FileText size={14} aria-hidden="true" /> PDF</button>
        <div className="rs-viewtoggle" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'list'} aria-label="List view" title="List view" onClick={() => setView('list')}><List size={15} /></button>
          <button type="button" aria-pressed={view === 'grid'} aria-label="Card view" title="Card view" onClick={() => setView('grid')}><LayoutGrid size={15} /></button>
        </div>
      </div>
      {exportError && <div className="cc-card rs-banner is-bad" role="alert"><AlertCircle size={16} aria-hidden="true" /> <span>{exportError}</span></div>}

      <div className="rs-main">
        <Card title="Shared Reports & Boards" sub={loading ? 'Loading...' : `${fmtInt(visible.length)} of ${fmtInt(enriched.length)} live links. Revoked links are not listed.`}>
          {view === 'list' ? (
            <KitTable
              columns={columns}
              rows={visible}
              loading={loading}
              error={error}
              onRetry={load}
              getRowId={(r) => String(r.id)}
              onRowClick={(r) => setSelectedId(r.id)}
              empty={shares.length === 0
                ? 'No share links yet. Press Share Report to create the first one.'
                : 'No links match these filters.'}
            />
          ) : (
            <CardState state={cardState} empty={visible.length === 0 ? (shares.length === 0 ? 'No share links yet. Press Share Report to create the first one.' : 'No links match these filters.') : null}>
              <div className="rs-cards">
                {visible.map((r) => (
                  <button key={r.id} type="button" className={`rs-cardbtn ${selected?.id === r.id ? 'is-on' : ''}`} onClick={() => setSelectedId(r.id)}>
                    <ShareName row={r} />
                    <span className="rs-cardrow"><StatusPill status={r.status} /><span>{r.views == null ? 'N/A' : `${fmtInt(r.views)} views`}</span></span>
                    <span className="rs-cardrow rs-muted"><span>Expires</span><ExpiryCell row={r} /></span>
                  </button>
                ))}
              </div>
            </CardState>
          )}
        </Card>

        <Card title="Selected Share" className="rs-detail">
          <CardState state={cardState} empty={!detail ? 'Select a link to see its details.' : null}>
            {detail && (
              <div className="rs-detail-body">
                <div className="rs-detail-top">
                  <span className={`rs-name-icon is-lg ${selected.custom ? 'is-custom' : ''}`}>{selected.custom ? <LayoutGrid size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}</span>
                  <div><b>{detail.title}</b><small>{detail.subtitle}</small></div>
                </div>
                <dl className="rs-dl">
                  <div><dt>Audience</dt><dd>Anyone with the link <span className="cc-pill info">External</span></dd></div>
                  <div><dt>Access</dt><dd><Eye size={13} aria-hidden="true" /> View only<small>The board is read only.</small></dd></div>
                  <div><dt>Sharing mode</dt><dd><Link2 size={13} aria-hidden="true" /> Public link<small>No login required</small></dd></div>
                  <div><dt>Link URL</dt><dd className="rs-url">{shareUrl ? <a href={safeHref(shareUrl)} target="_blank" rel="noopener noreferrer">{shareUrl}</a> : <span className="cc-na">Not available</span>}</dd></div>
                  <div><dt>Status</dt><dd><StatusPill status={selected.status} /></dd></div>
                  <div><dt>Created by</dt><dd className="rs-muted">Not shown on this page</dd></div>
                  <div><dt>Created on</dt><dd>{detail.created}</dd></div>
                  <div><dt>Expires on</dt><dd className={selected.status === 'expired' || selected.status === 'expiring' ? 'rs-bad' : undefined}>{detail.expires}</dd></div>
                  <div><dt>Total views</dt><dd>{detail.views}</dd></div>
                  <div><dt>Last viewed</dt><dd>{detail.lastViewed}</dd></div>
                  <div><dt>Timing</dt><dd>{detail.timing}</dd></div>
                </dl>
                {detail.boards.length > 0 && (
                  <div className="rs-boards">
                    <span className="rs-muted">Rotates through</span>
                    <div>{detail.boards.map((b, i) => <span key={i} className="cc-pill muted">{b}</span>)}</div>
                  </div>
                )}
                <div className="rs-actions">
                  <button type="button" className="cc-btn-ghost" onClick={copyLink} disabled={!shareUrl}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy Link'}</button>
                  {shareUrl && <a className="cc-btn-ghost" href={safeHref(shareUrl)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open</a>}
                  <button type="button" className="cc-btn-ghost" onClick={scrollToManager}><Users size={14} aria-hidden="true" /> Edit Access</button>
                  <button type="button" className="cc-btn-primary rs-danger" onClick={() => { setRevokeError(null); setRevokeTarget(selected) }}><Ban size={14} aria-hidden="true" /> Revoke</button>
                </div>
                <div className="rs-security">
                  <h3><Lock size={14} aria-hidden="true" /> Security controls</h3>
                  <ul>
                    <li><span>Expiring link</span><b>{selected.expires_at ? `Yes, ${expiryText(selected).text}` : 'No expiry set'}</b></li>
                    <li><span>Password protection</span><b className="rs-muted">Set when the link is created, not shown here</b></li>
                    <li><span>IP restriction</span><b className="rs-muted">Not supported</b></li>
                    <li><span>Watermark reports</span><b className="rs-muted">Not supported</b></li>
                    <li><span>Disable download</span><b className="rs-muted">Not configurable</b></li>
                  </ul>
                  <p className="rs-note"><Info size={12} aria-hidden="true" /> To change the password or expiry, revoke this link and create a new one.</p>
                </div>
              </div>
            )}
          </CardState>
        </Card>
      </div>

      <div className="rs-charts">
        <Card title="Access Analytics" sub="Views per link since each was created. Per-day view history is not recorded.">
          <CardState state={cardState} empty={bars.length === 0 || barMax === 0 ? 'No views recorded yet. Views appear once a shared link is opened.' : null}>
            <div className="rs-bars">
              {bars.map((b) => (
                <button key={b.id} type="button" className="rs-bar" onClick={() => setSelectedId(b.id)} title={`${b.label}: ${b.views} views`}>
                  <span className="rs-bar-label">{b.label}</span>
                  <span className="rs-bar-track"><i style={{ width: `${barMax ? (b.views / barMax) * 100 : 0}%` }} /></span>
                  <b>{fmtInt(b.views)}</b>
                </button>
              ))}
            </div>
          </CardState>
        </Card>
        <Card title="Views by Link Status" sub="Total views split by each link's current status.">
          <CardState state={cardState} empty={donut.length === 0 ? 'No views recorded yet.' : null}>
            <Donut segments={donut} total={kpi.totalViews} centerLabel="Total views" onSelect={(s) => setStatusFilter(s.key)} />
          </CardState>
        </Card>
      </div>

      <div className="rs-info">
        <div className="cc-card rs-info-card">
          <span className="rs-info-icon"><Palette size={16} aria-hidden="true" /></span>
          <div><b>Board colours follow your report theme</b><p>Every chart on a shared board uses the "{paletteName}" report palette. It is changed from the System Console (Report Colors).</p></div>
        </div>
        <div className="cc-card rs-info-card">
          <span className="rs-info-icon"><Share2 size={16} aria-hidden="true" /></span>
          <div><b>1. Create a link</b><p>Name it, pick the boards to rotate, set rotate and refresh timing, and an optional password or expiry.</p></div>
        </div>
        <div className="cc-card rs-info-card">
          <span className="rs-info-icon"><LayoutGrid size={16} aria-hidden="true" /></span>
          <div><b>2. Design boards</b><p>Build custom boards from KPI tiles, trends, breakdowns, gauges, heatmaps and tables. Every board fits one screen.</p></div>
        </div>
        <div className="cc-card rs-info-card">
          <span className="rs-info-icon"><Tv size={16} aria-hidden="true" /></span>
          <div><b>3. Show it anywhere</b><p>Open the link on any screen. It rotates, refreshes live numbers and has a full-screen button for a wall board.</p></div>
        </div>
      </div>

      {/* Manager + builder (create, edit, design boards, copy, revoke) */}
      <div ref={managerRef} id="share-manager" className="rs-manager">
        <ReportSharesPanel key={panelKey} />
      </div>

      <Modal
        open={!!revokeTarget}
        onClose={revoking ? undefined : () => setRevokeTarget(null)}
        title="Revoke report link"
        size="sm"
        footer={(
          <>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => setRevokeTarget(null)} disabled={revoking}>Cancel</button>
            <button type="button" className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40" onClick={confirmRevoke} disabled={revoking}>
              {revoking ? 'Revoking...' : 'Revoke link'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          Revoke "{revokeTarget?.name || 'Shared report'}"? Anyone using the link, including a TV wall board, loses access at once. This cannot be undone.
        </p>
        {revokeError && <p className="text-xs text-red-500 mt-2">{revokeError}</p>}
      </Modal>
    </div>
  )
}

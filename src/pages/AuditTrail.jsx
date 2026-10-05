/**
 * AuditTrail (route /audit): immutable history of uploads, user activity and
 * system changes, rebuilt on the Command Center kit to the owner's mockup.
 *
 * Sources, all real and read under RLS:
 *   - audit_log_v2   : the register (server paged), its KPI head-counts and the
 *                      selected event's stored old/new values. audit_log_v2 RLS
 *                      admits Admin/Manager/Director and super admins only; any
 *                      other role is told so instead of seeing an empty log.
 *   - upload_history : legacy uploads with the Admin-only batch reversal
 *                      (reverse_legacy_upload RPC, typed confirmation + reason).
 *   - import_batches + import_files : in-app import batches.
 *   - audit_event_reviews (migration 20261005140000, may not be applied yet):
 *                      "Investigate" flags; the page says when it is not set up.
 *
 *   - access_audit   : access-control changes, shown on the Security tab to
 *                      super admins only (its RLS admits nobody else).
 *
 * IP, device and site are stamped on audit rows from 5 Oct 2026 by the
 * trg_audit_stamp_request trigger; older rows read "Not recorded" / "N/A" and a
 * service write with no browser reads its system name. Severity is not stored:
 * src/lib/auditSeverity.js derives it by a documented rule and the page labels
 * it rule based. The log has no result column, so there is no Result column.
 * EXPORT rows (one per download, from 5 Oct 2026) feed the Exports tab.
 * Pure shaping lives in src/lib/auditTrailView.js, auditTrailAnalytics.js,
 * auditTrailDevice.js and auditSeverity.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, ShieldCheck, Database, Upload, Flag, ChevronRight, FileSpreadsheet, FileText,
  RefreshCw, Search, X, History, Eye, Info, Loader2, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import useLatestRequest from '../lib/useLatestRequest'
import { auditQuery, uploadHistoryQuery, readAuditExport, matchesAuditSearch, listAccessAudit } from '../lib/api/auditTrail'
import {
  loadAuditCounts, listImportBatches, loadReviews, flagAuditEvent, setReviewStatus,
} from '../lib/api/auditTrailOverview'
import { fetchAllPages } from '../lib/fetchAll'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import { formatDateTime, formatDate } from '../lib/formatters'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, Tabs, Pager, KitTable, fmtInt } from '../components/commandCenter/kit'
import {
  changeDiff, actorName, auditExportRows, uploadExportRows, auditFileName,
  AUDIT_EXPORT_COLS, AUDIT_EXPORT_HEADERS, UPLOAD_EXPORT_COLS, UPLOAD_EXPORT_HEADERS,
} from '../lib/auditTrailAnalytics'
import {
  AUDIT_TABS, ACTION_GROUPS, tabScope, actionsForGroup, actionLabel, moduleLabel, recordRef,
  eventType, actorLabel, changeHeadline, defaultRange, previousRange, trendPct, rangeLabel,
  canReadAudit, REVIEW_STATUSES, siteLabel, exportInfo, emptyMessage, RECORDING_START,
} from '../lib/auditTrailView'
import { auditSeverity, highSeverityOrFilter, SEVERITY_CAPTION } from '../lib/auditSeverity'
import { ipDevice } from '../lib/auditTrailDevice'
import { lineageRows } from '../lib/customDataView'
import './AuditTrail.css'

const NA = <span className="cc-na">N/A</span>

/** Field-level old/new diff of the stored values. */
function AuditChangeDetail({ row }) {
  const { fields, meta, details } = changeDiff(row)
  if (!fields.length && !meta && !details) return <p className="at-muted">No old or new values were stored for this event.</p>
  return (
    <div className="at-diff-wrap">
      {fields.length > 0 && (
        <dl className="at-diff">
          <div className="at-diff-head"><span>Field</span><span>Old value</span><span>New value</span></div>
          {fields.map((f) => (
            <div key={f.field} className={`at-diff-row ${f.changed ? 'is-changed' : ''}`}>
              <dt>{f.field}{f.changed ? '' : ' (unchanged)'}</dt>
              <dd><span className="at-diff-tag">Old</span>{f.oldValue}</dd>
              <dd><span className="at-diff-tag">New</span>{f.newValue}</dd>
            </div>
          ))}
        </dl>
      )}
      {meta && <pre className="at-pre">{JSON.stringify(meta, null, 2)}</pre>}
      {details && <pre className="at-pre">{JSON.stringify(details, null, 2)}</pre>}
    </div>
  )
}

/** IP / Device cell: what the trigger stamped, else System / Not recorded. */
function IpDeviceCell({ row }) {
  const d = ipDevice(row)
  if (d.kind === 'missing') return <span className="at-muted" title={`IP and device are recorded from ${RECORDING_START}`}>Not recorded</span>
  return (
    <span className="at-ipdev">
      <span className={d.kind === 'recorded' && d.ip ? 'at-mono' : (d.kind === 'system' ? 'at-muted' : undefined)}>{d.primary}</span>
      {d.secondary && <small>{d.secondary}</small>}
    </span>
  )
}

function SeverityPill({ row }) {
  const s = auditSeverity(row)
  return <span className={`cc-pill ${s.tone}`} title={`${s.reason} (rule based)`}>{s.label}</span>
}

function KpiLabel({ title, sub }) {
  return <>{title}<small className="at-kpi-sub">{sub}</small></>
}

export default function AuditTrail() {
  const { profile, isSuperAdmin } = useAuth()
  const canRead = canReadAudit(profile, isSuperAdmin)
  const isAdmin = profile?.role === 'Admin' || Boolean(isSuperAdmin)

  const initial = useMemo(() => defaultRange(), [])
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [tab, setTab] = useState('audit')

  // KPI counts (current + previous period for trends)
  const [counts, setCounts] = useState({ loading: true })
  const [prevCounts, setPrevCounts] = useState(null)
  const [reviews, setReviews] = useState({ provisioned: null, open: null, byAudit: {} })
  const [reviewError, setReviewError] = useState('')

  // Register
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [regError, setRegError] = useState('')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('')
  const [severity, setSeverity] = useState('')
  const [user, setUser] = useState('')
  const [recordFilter, setRecordFilter] = useState(null)
  const [users, setUsers] = useState([])
  const [usersError, setUsersError] = useState('')
  const [selected, setSelected] = useState(null)
  const [diffOpen, setDiffOpen] = useState(false)

  // Uploads
  const [uploads, setUploads] = useState([])
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadPage, setUploadPage] = useState(0)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [batches, setBatches] = useState({ loading: false, data: null, error: null })

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // Reverse batch
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Flag for review
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagNote, setFlagNote] = useState('')
  const [flagBusy, setFlagBusy] = useState(false)
  const [flagError, setFlagError] = useState('')

  const resetPages = () => { setPage(0); setUploadPage(0); setSelected(null) }

  // ── KPI counts ──────────────────────────────────────────────────────────────
  const loadCounts = useCallback(async () => {
    setCounts({ loading: true })
    const prev = previousRange(dateFrom, dateTo)
    try {
      const [cur, before] = await Promise.all([
        loadAuditCounts({ from: dateFrom, to: dateTo }),
        prev ? loadAuditCounts(prev) : Promise.resolve(null),
      ])
      setCounts({ loading: false, ...cur })
      setPrevCounts(before)
    } catch (e) {
      setCounts({ loading: false, error: toUserMessage(e, 'Audit figures could not be read.') })
      setPrevCounts(null)
    }
  }, [dateFrom, dateTo])
  useEffect(() => { if (canRead) loadCounts() }, [loadCounts, canRead])

  // ── User filter options ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    fetchAllPages((f, t) => supabase.from('profiles').select('id, full_name, username').order('id').range(f, t), { max: 10000 })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setUsersError(toUserMessage(error, 'Could not load the user filter.'))
        else setUsers(data ?? [])
      })
      .catch((e) => { if (alive) setUsersError(toUserMessage(e, 'Could not load the user filter.')) })
    return () => { alive = false }
  }, [])

  // ── Register ────────────────────────────────────────────────────────────────
  const filters = useMemo(() => ({
    dateFrom, dateTo, user,
    ...tabScope(tab),
    ...(group ? { actions: actionsForGroup(group) } : {}),
    ...(recordFilter ? { recordId: recordFilter.record_id } : {}),
    ...(severity === 'high' ? { orFilter: highSeverityOrFilter() } : {}),
  }), [dateFrom, dateTo, user, tab, group, recordFilter, severity])

  const latest = useLatestRequest()
  const loadRegister = useCallback(async () => {
    const stale = latest.begin()
    setLoading(true)
    try {
      const { data, count, error } = await auditQuery(filters).range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      if (stale()) return
      setRegError(''); setRows(data ?? []); setTotal(count ?? 0)
    } catch (e) {
      if (!stale()) { setRows([]); setTotal(0); setRegError(toUserMessage(e, 'Audit events could not be loaded.')) }
    }
    if (!stale()) setLoading(false)
  }, [filters, page, pageSize, latest])
  useEffect(() => { if (canRead && tab !== 'upload') loadRegister() }, [loadRegister, tab, canRead])

  // Review flags for the rows on screen
  const loadFlags = useCallback(async (ids) => {
    try {
      setReviewError('')
      setReviews(await loadReviews({ auditIds: ids }))
    } catch (e) { setReviewError(toUserMessage(e, 'Review flags could not be read.')) }
  }, [])
  useEffect(() => { if (canRead) loadFlags(rows.map((r) => r.id)) }, [rows, loadFlags, canRead])

  // ── Uploads ─────────────────────────────────────────────────────────────────
  const latestUpload = useLatestRequest()
  const loadUploads = useCallback(async () => {
    const stale = latestUpload.begin()
    setUploadLoading(true)
    try {
      const { data, count, error } = await uploadHistoryQuery({ dateFrom, dateTo })
        .range(uploadPage * 25, (uploadPage + 1) * 25 - 1)
      if (error) throw error
      if (stale()) return
      setUploadError(''); setUploads(data ?? []); setUploadTotal(count ?? 0)
    } catch (e) {
      if (!stale()) { setUploads([]); setUploadTotal(0); setUploadError(toUserMessage(e, 'Upload history could not be loaded.')) }
    }
    if (!stale()) setUploadLoading(false)
  }, [dateFrom, dateTo, uploadPage, latestUpload])

  const loadBatches = useCallback(async () => {
    setBatches((s) => ({ ...s, loading: true, error: null }))
    try { setBatches({ loading: false, data: await listImportBatches({ from: dateFrom, to: dateTo }), error: null }) }
    catch (e) { setBatches({ loading: false, data: null, error: toUserMessage(e, 'Import batches could not be loaded.') }) }
  }, [dateFrom, dateTo])

  useEffect(() => { if (tab === 'upload') { loadUploads(); loadBatches() } }, [tab, loadUploads, loadBatches])

  // ── Access control changes (Security tab, super admins only) ───────────────
  const [access, setAccess] = useState({ loading: false, data: null, error: null })
  const loadAccess = useCallback(async () => {
    setAccess((s) => ({ ...s, loading: true, error: null }))
    try {
      let until
      if (dateTo) { const n = new Date(`${dateTo}T00:00:00Z`); n.setUTCDate(n.getUTCDate() + 1); until = n.toISOString() }
      const data = await listAccessAudit({ since: dateFrom ? `${dateFrom}T00:00:00Z` : undefined, until, limit: 200 })
      setAccess({ loading: false, data, error: null })
    } catch (e) { setAccess({ loading: false, data: null, error: toUserMessage(e, 'Access control changes could not be loaded.') }) }
  }, [dateFrom, dateTo])
  useEffect(() => { if (tab === 'security' && isSuperAdmin) loadAccess() }, [tab, isSuperAdmin, loadAccess])

  // ── Exports ─────────────────────────────────────────────────────────────────
  async function exportAudit(kind = 'xlsx') {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      if (tab === 'upload') {
        const data = await readAuditExport({ upload: true, filters: { dateFrom, dateTo } })
        const out = uploadExportRows(data ?? [], formatDateTime)
        if (kind === 'pdf') await exportToPdf(out, UPLOAD_EXPORT_COLS.map((key, i) => ({ key, header: UPLOAD_EXPORT_HEADERS[i] })), 'Upload History', auditFileName('upload'), 'landscape')
        else await exportToExcel(out, UPLOAD_EXPORT_COLS, UPLOAD_EXPORT_HEADERS, auditFileName('upload'), 'Upload History')
      } else {
        const data = await readAuditExport({ filters, search })
        const out = auditExportRows(data ?? [], formatDateTime)
        if (kind === 'pdf') await exportToPdf(out, AUDIT_EXPORT_COLS.slice(0, 5).map((key, i) => ({ key, header: AUDIT_EXPORT_HEADERS[i] })), 'Audit Log', auditFileName('audit'), 'landscape')
        else await exportToExcel(out, AUDIT_EXPORT_COLS, AUDIT_EXPORT_HEADERS, auditFileName('audit'), 'Audit Log')
      }
    } catch (e) { setExportError(toUserMessage(e, 'The export failed.')) }
    finally { setExporting(false) }
  }

  // ── Reverse batch ───────────────────────────────────────────────────────────
  const closeDelete = () => { if (!deleting) { setDeleteTarget(null); setDeleteConfirm(''); setDeleteReason(''); setDeleteError('') } }
  async function handleDeleteBatch() {
    if (deleteConfirm !== 'DELETE' || deleteReason.trim().length < 3) return
    setDeleting(true); setDeleteError('')
    try {
      const { data, error } = await supabase.rpc('reverse_legacy_upload', { p_batch_id: deleteTarget.batchId, p_reason: deleteReason.trim() })
      if (error) throw error
      if (data?.ok !== true || !Number.isInteger(data.removed)) throw new Error('The server did not confirm the reversal. Refresh before retrying.')
      setDeleteTarget(null); setDeleteConfirm(''); setDeleteReason('')
      loadUploads(); loadCounts()
    } catch (e) {
      setDeleteError(e?.code === '23503'
        ? 'This batch has dependent records. Resolve its cleaning or disposal activity before reversal.'
        : toUserMessage(e, 'Reversal failed. Please try again.'))
    } finally { setDeleting(false) }
  }

  // ── Review flags ────────────────────────────────────────────────────────────
  const selectedFlag = selected ? reviews.byAudit[selected.id] : null
  async function submitFlag() {
    if (!selected) return
    setFlagBusy(true); setFlagError('')
    try {
      await flagAuditEvent(selected, flagNote)
      setFlagOpen(false); setFlagNote('')
      await loadFlags(rows.map((r) => r.id))
    } catch (e) { setFlagError(toUserMessage(e, 'Could not flag this event.')) }
    finally { setFlagBusy(false) }
  }
  async function moveFlag(status) {
    if (!selectedFlag) return
    try {
      await setReviewStatus(selectedFlag.id, status)
      await loadFlags(rows.map((r) => r.id))
    } catch (e) { setReviewError(toUserMessage(e, 'Could not update the review.')) }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const visibleRows = useMemo(() => rows.filter((r) => matchesAuditSearch(r, search)), [rows, search])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const prev = previousRange(dateFrom, dateTo)
  const trendTitle = prev ? `Compared with ${rangeLabel(prev.from, prev.to)}` : undefined
  const k = (key) => (counts.loading ? null : counts[key])
  const t = (key) => (prevCounts ? trendPct(counts[key], prevCounts[key]) : null)
  const naTitle = counts.error || undefined
  const uploadsTotal = counts.uploads == null && counts.batches == null ? null : (counts.uploads ?? 0) + (counts.batches ?? 0)

  const kpis = [
    { icon: Activity, tone: 't-blue', value: k('events'), trend: t('events'), label: <KpiLabel title="Audit events" sub={rangeLabel(dateFrom, dateTo)} />, title: trendTitle || naTitle, onClick: () => { setTab('audit'); setGroup(''); setSeverity(''); resetPages() } },
    { icon: ShieldCheck, tone: 't-red', value: k('security'), trend: t('security'), goodWhenUp: false, label: <KpiLabel title="Security events" sub="Sign in, sign out, branding" />, title: trendTitle || naTitle, onClick: () => { setTab('security'); setGroup(''); setSeverity(''); resetPages() } },
    { icon: Database, tone: 't-purple', value: k('changes'), trend: t('changes'), label: <KpiLabel title="Data changes" sub={counts.deletes == null ? 'Created / updated / deleted' : `${fmtInt(counts.deletes)} deletions`} />, title: trendTitle || naTitle, onClick: () => { setTab('audit'); setGroup('update'); setSeverity(''); resetPages() } },
    { icon: Upload, tone: 't-amber', value: counts.loading ? null : uploadsTotal, label: <KpiLabel title="Upload events" sub={`${fmtInt(counts.uploads)} uploads, ${fmtInt(counts.batches)} import batches`} />, title: naTitle, onClick: () => { setTab('upload'); resetPages() } },
    {
      icon: AlertTriangle, tone: 't-orange', value: k('critical'), trend: t('critical'), goodWhenUp: false,
      label: <KpiLabel title="Critical events" sub={reviews.provisioned === false ? 'High severity (rule based). Review flags not set up yet' : `High severity (rule based). ${reviews.open == null ? 'N/A' : fmtInt(reviews.open)} flagged for review`} />,
      title: `${SEVERITY_CAPTION} High = business or access record deleted, or a failed security event.`,
      onClick: () => { setTab('audit'); setGroup(''); setSeverity('high'); resetPages() },
    },
  ]

  const tabsWithCounts = AUDIT_TABS.map((x) => ({
    ...x,
    count: counts.loading ? undefined
      : x.key === 'security' ? counts.security ?? undefined
      : x.key === 'upload' ? uploadsTotal ?? undefined
      : x.key === 'exports' ? counts.exports ?? undefined
      : x.key === 'automation' ? counts.automation ?? undefined
      : undefined,
  }))

  const columns = [
    { key: 'time', header: 'Time', sortable: false, cell: (r) => <span className="at-nowrap">{r.created_at ? formatDateTime(r.created_at) : 'N/A'}</span> },
    { key: 'actor', header: 'Actor', sortable: false, cell: (r) => <span className={r.profiles ? 'cc-strong' : 'at-muted'}>{actorLabel(r)}</span> },
    { key: 'action', header: 'Action', sortable: false, cell: (r) => actionLabel(r.action) },
    { key: 'module', header: 'Module', sortable: false, cell: (r) => moduleLabel(r) },
    { key: 'record', header: 'Record', sortable: false, cell: (r) => (recordRef(r) === 'N/A' ? NA : <span className="at-mono" title={String(r.record_id)}>{recordRef(r)}</span>) },
    { key: 'site', header: 'Site', sortable: false, cell: (r) => (siteLabel(r) === 'N/A' ? NA : siteLabel(r)) },
    { key: 'ipdev', header: 'IP / Device', sortable: false, cell: (r) => <IpDeviceCell row={r} /> },
    { key: 'severity', header: 'Severity', sortable: false, cell: (r) => <SeverityPill row={r} /> },
    {
      key: 'review', header: 'Review', sortable: false,
      cell: (r) => { const f = reviews.byAudit[r.id]; if (!f) return <span className="at-muted">None</span>; const s = REVIEW_STATUSES[f.status] || REVIEW_STATUSES.open; return <span className={`cc-pill ${s.tone}`}>{s.label}</span> },
    },
  ]

  // Exports tab: the downloaded file and its size instead of module / record.
  const exportColumns = [
    columns[0], columns[1],
    { key: 'file', header: 'File', sortable: false, cell: (r) => { const f = exportInfo(r).file; return f ? <span className="at-trunc" title={f}>{f}</span> : NA } },
    { key: 'format', header: 'Format', sortable: false, cell: (r) => exportInfo(r).format || NA },
    { key: 'rows', header: 'Rows', numeric: true, sortable: false, cell: (r) => { const n = exportInfo(r).rows; return n == null ? NA : fmtInt(n) } },
    columns.find((c) => c.key === 'site'),
    columns.find((c) => c.key === 'ipdev'),
    columns.find((c) => c.key === 'severity'),
  ]
  const registerColumns = tab === 'exports' ? exportColumns : columns

  const accessColumns = [
    { key: 'when', header: 'Time', sortable: false, cell: (r) => <span className="at-nowrap">{r.when ? formatDateTime(r.when) : 'N/A'}</span> },
    { key: 'actor', header: 'Changed by', sortable: false, cell: (r) => r.actor || NA },
    { key: 'action', header: 'Action', sortable: false, cell: (r) => actionLabel(r.action) },
    { key: 'target', header: 'Target', sortable: false, cell: (r) => (r.target ? <span className="at-trunc" title={r.target}>{r.target}</span> : NA) },
    { key: 'reason', header: 'Reason', sortable: false, cell: (r) => (r.reason ? <span className="at-trunc" title={r.reason}>{r.reason}</span> : <span className="at-muted">Not given</span>) },
  ]

  const uploadColumns = [
    { key: 'files', header: 'File', sortable: false, cell: (r) => { const n = Array.isArray(r.file_names) ? r.file_names.join(', ') : (r.file_names ?? ''); return n ? <span className="at-trunc" title={n}>{n}</span> : NA } },
    { key: 'added', header: 'Records added', numeric: true, sortable: false, cell: (r) => fmtInt(r.records_added ?? 0) },
    { key: 'skipped', header: 'Skipped', numeric: true, sortable: false, cell: (r) => fmtInt(r.records_skipped ?? 0) },
    { key: 'by', header: 'Uploaded by', sortable: false, cell: (r) => actorName(r, 'uploaded_by') },
    { key: 'at', header: 'Uploaded at', sortable: false, cell: (r) => <span className="at-nowrap">{r.uploaded_at ? formatDateTime(r.uploaded_at) : 'N/A'}</span> },
    { key: 'region', header: 'Region', sortable: false, cell: (r) => r.region || NA },
    {
      key: 'state', header: 'State', sortable: false,
      cell: (r) => (r.reversed_at
        ? <span className="cc-pill muted" title={`Reversed ${formatDateTime(r.reversed_at)}`}>Reversed</span>
        : isAdmin && r.batch_id
          ? <button type="button" className="cc-btn-ghost at-danger-btn" onClick={() => { setDeleteReason(''); setDeleteTarget({ batchId: r.batch_id, count: r.records_added, date: r.uploaded_at }) }}>Reverse batch</button>
          : <span className="cc-pill good">Kept</span>),
    },
  ]

  const batchColumns = [
    { key: 'file', header: 'File', sortable: false, cell: (b) => b.import_files?.original_filename ? <span className="at-trunc" title={b.import_files.original_filename}>{b.import_files.original_filename}</span> : NA },
    { key: 'module', header: 'Module', sortable: false, cell: (b) => (b.module ? moduleLabel({ table_name: b.module }) : NA) },
    { key: 'country', header: 'Country', sortable: false, cell: (b) => b.country || NA },
    { key: 'rows', header: 'Rows', numeric: true, sortable: false, cell: (b) => fmtInt(b.total_rows) },
    { key: 'imported', header: 'Imported', numeric: true, sortable: false, cell: (b) => fmtInt(b.imported_rows) },
    { key: 'issues', header: 'Errors / conflicts', numeric: true, sortable: false, cell: (b) => `${fmtInt(b.error_rows ?? 0)} / ${fmtInt(b.conflict_rows ?? 0)}` },
    { key: 'status', header: 'Status', sortable: false, cell: (b) => { const l = lineageRows([b])[0]; return <span className={`cc-pill ${l.tone}`}>{l.label}</span> } },
    { key: 'at', header: 'Created', sortable: false, cell: (b) => <span className="at-nowrap">{b.created_at ? formatDateTime(b.created_at) : 'N/A'}</span> },
  ]

  const anyFilter = group || user || search || recordFilter || severity
  const errors = [exportError, usersError, reviewError].filter(Boolean)

  return (
    <div className="cc at-page">
      <header className="at-head">
        <div className="at-head-copy">
          <nav aria-label="Breadcrumb" className="at-crumb">Administration <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Audit Trail</span></nav>
          <h1>Audit Trail</h1>
          <p>Immutable history of uploads, user activity and system changes.</p>
        </div>
        <div className="at-head-actions">
          <label className="at-date"><span>From</span><input type="date" className="cc-select" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); resetPages() }} /></label>
          <label className="at-date"><span>To</span><input type="date" className="cc-select" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); resetPages() }} /></label>
          <button type="button" className="cc-btn-primary" onClick={() => exportAudit('xlsx')} disabled={exporting || !canRead}>
            {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={15} aria-hidden="true" />} Export audit
          </button>
          <button type="button" className="cc-icon-btn" onClick={() => exportAudit('pdf')} disabled={exporting || !canRead} aria-label="Export to PDF" title="Export to PDF"><FileText size={14} /></button>
        </div>
      </header>

      {!canRead && (
        <div className="cc-card at-banner" role="status">
          <Info size={18} aria-hidden="true" />
          <div><b>Your role cannot read the audit log.</b><p>Audit events are visible to Admin, Manager and Director roles. Ask an administrator if you need access.</p></div>
        </div>
      )}
      {errors.map((m, i) => <div key={i} className="cc-card at-banner bad" role="alert"><Info size={18} aria-hidden="true" /><div><p>{m}</p></div></div>)}
      {counts.error && canRead && (
        <div className="cc-card at-banner bad" role="alert">
          <Info size={18} aria-hidden="true" />
          <div><p>{counts.error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={loadCounts}>Try again</button>
        </div>
      )}

      {canRead && (
        <>
          <div className="cc-kpis at-kpis">
            {kpis.map((x, i) => <Kpi key={i} {...x} goodWhenUp={x.goodWhenUp ?? true} loading={counts.loading} />)}
          </div>

          <div className="cc-card at-tabbar">
            <Tabs tabs={tabsWithCounts} value={tab} onChange={(v) => { setTab(v); setGroup(''); setSeverity(''); setRecordFilter(null); resetPages() }} label="Audit views" />
            <span className="at-tab-hint">
              {tab === 'security' && 'Sign in, sign out and branding changes.'}
              {tab === 'exports' && `Excel, PDF and PowerPoint downloads, recorded from ${RECORDING_START}.`}
              {tab === 'automation' && 'Writes made by imports, jobs and other system paths.'}
              {tab === 'upload' && 'Legacy uploads and in-app import batches.'}
              {tab === 'audit' && 'Every recorded event.'}
            </span>
          </div>

          {tab !== 'upload' && (
            <>
              <section className="cc-card" aria-label="Audit register">
                <div className="cc-filters at-filters">
                  <label className="cc-search">
                    <Search size={15} aria-hidden="true" />
                    <input aria-label="Search this page" placeholder="Search actor, action or module on this page" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </label>
                  {tab === 'audit' && (
                    <select className="cc-select" aria-label="Action" value={group} onChange={(e) => { setGroup(e.target.value); resetPages() }}>
                      <option value="">All actions</option>
                      {ACTION_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                  )}
                  <select className="cc-select" aria-label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); resetPages() }}>
                    <option value="">All severities</option>
                    <option value="high">High only</option>
                  </select>
                  <select className="cc-select" aria-label="User" value={user} onChange={(e) => { setUser(e.target.value); resetPages() }}>
                    <option value="">All users</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username || 'Unnamed user'}</option>)}
                  </select>
                  {anyFilter && (
                    <button type="button" className="cc-btn-ghost" onClick={() => { setGroup(''); setUser(''); setSearch(''); setRecordFilter(null); setSeverity(''); resetPages() }}>
                      <X size={14} aria-hidden="true" /> Clear filters
                    </button>
                  )}
                  <button type="button" className="cc-icon-btn at-push" onClick={() => { loadRegister(); loadCounts() }} aria-label="Refresh" title="Refresh">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {recordFilter && (
                  <p className="at-record-chip">
                    Showing the full history of {moduleLabel(recordFilter)} record <b className="at-mono">{recordRef(recordFilter)}</b>
                    <button type="button" className="cc-link cc-link-btn" onClick={() => { setRecordFilter(null); resetPages() }}>Show all events</button>
                  </p>
                )}
                <KitTable
                  columns={registerColumns}
                  rows={visibleRows}
                  loading={loading && !rows.length}
                  error={regError || null}
                  onRetry={loadRegister}
                  getRowId={(r) => String(r.id)}
                  manualPagination
                  showPagination={false}
                  pageIndex={page}
                  pageCount={pageCount}
                  totalRows={total}
                  pageSize={pageSize}
                  onRowClick={(r) => setSelected(r)}
                  empty={search ? 'No event on this page matches the search.' : severity === 'high' ? 'No high severity events in this period.' : emptyMessage(tab)}
                  scroll
                />
                <p className="at-caption">
                  {SEVERITY_CAPTION} IP, device and site are recorded from {RECORDING_START}; earlier events show Not recorded or N/A, and system writes show the system path.
                </p>
                {!regError && total > 0 && (
                  <Pager page={page} pageSize={pageSize} total={total} onPage={(p) => { setPage(Math.max(0, Math.min(pageCount - 1, p))); setSelected(null) }} onPageSize={(s) => { setPageSize(s); setPage(0) }} noun="events" />
                )}
              </section>

              <Card title="Selected event details" sub={selected ? undefined : 'Select an event in the register to see who changed what.'}>
                {!selected ? (
                  <div className="cc-empty">No event selected.</div>
                ) : (
                  <div className="at-detail">
                    <div className="at-detail-top">
                      <div className="at-detail-copy">
                        <h3>{changeHeadline(selected)}</h3>
                        <p className="at-meta">
                          <span>Actor: <b>{actorLabel(selected)}</b>{selected.user_role ? ` (${selected.user_role})` : ''}</span>
                          <span>Recorded: <b>{selected.created_at ? formatDateTime(selected.created_at) : 'N/A'}</b></span>
                          <span>Source: <b>{selected.actor_type === 'service' ? 'System path' : selected.actor_type === 'user' ? 'Signed-in user' : 'Not recorded (before attribution)'}</b></span>
                          {selected.session_id && <span>Session: <b className="at-mono">{String(selected.session_id).slice(0, 12)}</b></span>}
                          <span>Record: <b className="at-mono">{selected.record_id ?? 'N/A'}</b></span>
                          <span>Site: <b>{siteLabel(selected)}</b></span>
                          {(() => { const d = ipDevice(selected); return d.kind === 'recorded'
                            ? <><span>IP: <b className="at-mono">{d.ip || 'Not recorded'}</b></span><span>Device: <b>{d.device || 'Not recorded'}</b></span></>
                            : <span>IP / Device: <b>{d.kind === 'system' ? `${d.primary} (no browser)` : `Not recorded (before ${RECORDING_START})`}</b></span> })()}
                          {(() => { const sv = auditSeverity(selected); return <span>Severity: <b>{sv.label}</b> ({sv.reason}, rule based)</span> })()}
                          <span>Type: <b>{eventType(selected).label}</b></span>
                          {selected.action === 'EXPORT' && (() => { const x = exportInfo(selected); return <span>Download: <b>{x.file || 'N/A'}</b>{x.rows != null ? `, ${fmtInt(x.rows)} rows` : ''}</span> })()}
                        </p>
                        {selectedFlag && (
                          <p className="at-flag">
                            <span className={`cc-pill ${(REVIEW_STATUSES[selectedFlag.status] || REVIEW_STATUSES.open).tone}`}>{(REVIEW_STATUSES[selectedFlag.status] || REVIEW_STATUSES.open).label}</span>
                            {selectedFlag.note && <span>{selectedFlag.note}</span>}
                            <span className="at-muted">Flagged {formatDate(selectedFlag.created_at)}</span>
                          </p>
                        )}
                      </div>
                      <div className="at-detail-actions">
                        <button type="button" className="cc-btn-primary" disabled={!selected.record_id} title={selected.record_id ? 'Show every event recorded for this record' : 'This event names no record'} onClick={() => { setRecordFilter(selected); setTab('audit'); setGroup(''); setPage(0) }}>
                          <History size={15} aria-hidden="true" /> View full history
                        </button>
                        {!selectedFlag && (
                          <button type="button" className="cc-btn-ghost" disabled={reviews.provisioned === false} title={reviews.provisioned === false ? 'Review flags are not set up on this database yet' : 'Flag this event for review'} onClick={() => { setFlagNote(''); setFlagError(''); setFlagOpen(true) }}>
                            <Flag size={14} aria-hidden="true" /> Investigate
                          </button>
                        )}
                        {selectedFlag?.status === 'open' && <button type="button" className="cc-btn-ghost" onClick={() => moveFlag('investigating')}>Mark investigating</button>}
                        {selectedFlag && selectedFlag.status !== 'resolved' && <button type="button" className="cc-btn-ghost" onClick={() => moveFlag('resolved')}>Mark resolved</button>}
                        <button type="button" className="cc-icon-btn" onClick={() => setDiffOpen(true)} aria-label="Open the change in a larger view" title="Open larger"><Eye size={14} /></button>
                      </div>
                    </div>
                    <AuditChangeDetail row={selected} />
                  </div>
                )}
              </Card>

              {tab === 'security' && (
                <Card title="Access control changes"
                  sub={isSuperAdmin ? 'Role, grant and account changes in this period (latest 200), with the reason given.' : 'Visible to super admins only.'}>
                  {isSuperAdmin ? (
                    <CardState state={{ ...access, retry: loadAccess }} empty={access.data && !access.data.length ? 'No access control changes in this period.' : null}>
                      <KitTable columns={accessColumns} rows={access.data || []} getRowId={(r) => String(r.id)} compact scroll />
                    </CardState>
                  ) : (
                    <div className="cc-empty">Access control changes are readable by super admins only.</div>
                  )}
                </Card>
              )}
            </>
          )}

          {tab === 'upload' && (
            <>
              <section className="cc-card" aria-label="Upload history">
                <div className="cc-card-head">
                  <div><h2 className="cc-card-title">Upload history</h2><p className="cc-card-sub">Files loaded through the legacy upload screen, with batch reversal for administrators.</p></div>
                  <button type="button" className="cc-icon-btn" onClick={loadUploads} aria-label="Refresh uploads" title="Refresh"><RefreshCw size={14} className={uploadLoading ? 'animate-spin' : ''} /></button>
                </div>
                <KitTable
                  columns={uploadColumns}
                  rows={uploads}
                  loading={uploadLoading && !uploads.length}
                  error={uploadError || null}
                  onRetry={loadUploads}
                  getRowId={(r) => String(r.id)}
                  manualPagination
                  showPagination={false}
                  pageIndex={uploadPage}
                  pageCount={Math.max(1, Math.ceil(uploadTotal / 25))}
                  totalRows={uploadTotal}
                  pageSize={25}
                  empty="No uploads in this period."
                  scroll
                />
                {!uploadError && uploadTotal > 0 && <Pager page={uploadPage} pageSize={25} total={uploadTotal} onPage={setUploadPage} noun="uploads" />}
              </section>
              <Card title="Import batches" sub="Files loaded through Data Intake in this period (latest 200).">
                <CardState state={{ ...batches, retry: loadBatches }} empty={batches.data && !batches.data.length ? 'No import batches in this period.' : null}>
                  <KitTable columns={batchColumns} rows={batches.data || []} getRowId={(b) => String(b.id)} compact scroll />
                </CardState>
              </Card>
            </>
          )}
        </>
      )}

      <Modal open={diffOpen && Boolean(selected)} onClose={() => setDiffOpen(false)} size="lg" title="Change detail"
        subtitle={selected ? `${actionLabel(selected.action)} on ${moduleLabel(selected)} by ${actorLabel(selected)}, ${selected.created_at ? formatDateTime(selected.created_at) : 'N/A'}` : null}>
        {selected && <AuditChangeDetail row={selected} />}
      </Modal>

      <Modal open={flagOpen} onClose={() => { if (!flagBusy) setFlagOpen(false) }} size="sm" title="Flag event for review"
        footer={<div className="at-modal-foot">
          <button type="button" className="cc-btn-ghost" onClick={() => setFlagOpen(false)} disabled={flagBusy}>Cancel</button>
          <button type="button" className="cc-btn-primary" onClick={submitFlag} disabled={flagBusy}>{flagBusy ? 'Saving...' : 'Flag for review'}</button>
        </div>}>
        <div className="at-form">
          <p className="at-muted">{selected ? changeHeadline(selected) : ''}</p>
          <label htmlFor="at-flag-note">What should the reviewer check? (optional)</label>
          <textarea id="at-flag-note" className="cc-select at-textarea" maxLength={2000} value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
          {flagError && <p role="alert" className="at-err">{flagError}</p>}
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={closeDelete} size="sm" closeOnBackdrop={!deleting} title="Reverse upload batch"
        footer={<div className="at-modal-foot">
          <button type="button" onClick={closeDelete} className="cc-btn-ghost" disabled={deleting}>Cancel</button>
          <button type="button" onClick={handleDeleteBatch} disabled={deleteConfirm !== 'DELETE' || deleteReason.trim().length < 3 || deleting} className="cc-btn-primary at-danger-fill">
            {deleting ? 'Reversing...' : 'Reverse batch'}
          </button>
        </div>}>
        {deleteTarget && (
          <div className="at-form">
            <p className="at-muted">This removes the surviving records from the batch uploaded on {formatDate(deleteTarget.date)}. The original upload contained {fmtInt(deleteTarget.count)} records. History and a recovery archive are retained; batches with cleaning or disposal activity cannot be reversed here.</p>
            <label htmlFor="rv-reason">Reason for reversal</label>
            <textarea id="rv-reason" className="cc-select at-textarea" value={deleteReason} maxLength={2000} onChange={(e) => setDeleteReason(e.target.value)} aria-describedby="rv-reason-help" />
            <small id="rv-reason-help" className="at-muted">At least 3 characters. Recorded against the reversal.</small>
            <label htmlFor="rv-confirm">Type DELETE to confirm</label>
            <input id="rv-confirm" className="cc-select" placeholder="DELETE" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoComplete="off" />
            {deleteError && <p role="alert" className="at-err">{deleteError}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

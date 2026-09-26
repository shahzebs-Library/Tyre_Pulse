import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ShieldAlert, ArrowLeft, AlertTriangle, Search, Lock,
  Download, FileText, Truck, MapPin, Clock, ListChecks,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  matchRecallTyres, affectedRows, recallExposure, filterAffected,
  recallActions, recallAgeDays, affectedExportRows, sortAffected,
} from '../lib/recallDetailAnalytics'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/EmptyState'
import * as recallsApi from '../lib/api/recalls'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'

// ── Config shared with the RecallTracker registry so badges read identically ──
const SEVERITY_CFG = {
  Critical: { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    dot: 'bg-red-500'    },
  High:     { text: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', dot: 'bg-orange-500' },
  Medium:   { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', dot: 'bg-yellow-500' },
  Low:      { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700',   dot: 'bg-blue-500'   },
}

const STATUS_CFG = {
  Active:     { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700'    },
  Monitoring: { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700' },
  Closed:     { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700'  },
}

function Badge({ label, cfg, small }) {
  const c = cfg ?? { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${c.text} ${c.bg} ${c.border} ${small ? 'text-[10px]' : ''}`}>
      {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {label}
    </span>
  )
}

const EXPORT_COLS = ['serial', 'asset_no', 'position', 'site', 'country', 'size', 'state', 'issue_date', 'days_fitted']
const EXPORT_HEADERS = ['Serial', 'Asset', 'Position', 'Site', 'Country', 'Size', 'State', 'Fitted on', 'Days fitted']

function Kpi({ icon: Icon, label, value, hint, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Icon size={12} /> {label}</div>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-muted)] truncate" title={hint}>{hint}</p>}
    </div>
  )
}

function Breakdown({ title, items, empty }) {
  const max = Math.max(1, ...items.map((i) => i.total))
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 6).map((i) => (
            <li key={i.value} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-[var(--text-secondary)]">{i.value}</span>
                <span className="tabular-nums text-[var(--text-primary)]">{i.fitted} fitted / {i.total}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-[var(--input-bg)] overflow-hidden">
                <div className="h-full bg-orange-500/70" style={{ width: `${(i.total / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Routed detail page for a single tyre recall (`/recalls/:recallId`). Self-fetches
 * the recall record plus the fleet tyre pool, matches affected tyres, and hosts the
 * recall approval workflow (EntityApprovalPanel) with the same lock semantics the
 * registry drawer used. Converted from the RecallTracker "View" drawer because the
 * record + affected-vehicles table + approval sign-off spanned multiple large
 * sections. RLS remains the real access boundary; useSettings scopes nothing extra
 * here (recalls are RLS-scoped server-side), matching the registry's behaviour.
 */
export default function RecallDetail() {
  const { recallId } = useParams()
  const navigate = useNavigate()
  // Kept for scope-context parity with the registry; recalls are RLS-scoped.
  useSettings()

  const [recall, setRecall]   = useState(null)
  const [tyres, setTyres]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [search, setSearch]   = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [siteFilter, setSiteFilter]   = useState('all')
  const [now] = useState(() => Date.now())

  // Approval-engine gate — locks nothing destructive on this read-first page, but
  // is surfaced as a banner so an in-approval recall is clearly flagged. Mirrors
  // the registry drawer's wfLocked wiring; resets when the record changes.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [recallId])

  const load = useCallback(async () => {
    if (!recallId) { setLoading(false); setRecall(null); return }
    setLoading(true)
    setError(null)
    try {
      const [rec, tyreRes] = await Promise.all([
        recallsApi.getRecall(recallId),
        recallsApi.listRecallTyres(),
      ])
      setRecall(rec || null)
      setTyres(tyreRes?.data ?? [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load this recall record.'))
      setRecall(null)
    } finally {
      setLoading(false)
    }
  }, [recallId])

  useEffect(() => { load() }, [load])

  const matched = useMemo(() => matchRecallTyres(recall, tyres), [recall, tyres])
  const rows = useMemo(() => affectedRows(matched, now), [matched, now])
  const exposure = useMemo(() => recallExposure(rows), [rows])
  const actions = useMemo(() => recallActions(recall, exposure), [recall, exposure])
  const siteOptions = useMemo(() => exposure.bySite.map((s) => s.value), [exposure])
  const filteredRows = useMemo(
    () => sortAffected(filterAffected(rows, { state: stateFilter, site: siteFilter, search })),
    [rows, stateFilter, siteFilter, search],
  )
  // One pager for the register. The table renders only the current page (as a
  // scrolling view) so there is never a second, competing pager; rows are
  // pre-sorted for review, and exports always cover the full filtered set.
  const tyresPager = usePagedRows(filteredRows)
  const ageDays = recallAgeDays(recall, now)

  const columns = useMemo(() => [
    {
      id: 'serial', header: 'Serial', accessorFn: (r) => r.serial ?? 'N/A', size: 140,
      cell: ({ row }) => row.original.serial
        ? <span className="font-mono text-blue-300">{row.original.serial}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    {
      id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no ?? 'N/A', size: 110,
      cell: ({ row }) => row.original.asset_no ? (
        <button type="button" className="text-blue-400 hover:underline"
          onClick={(e) => { e.stopPropagation(); navigate(`/assets/${encodeURIComponent(row.original.asset_no)}`) }}>
          {row.original.asset_no}
        </button>
      ) : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position ?? 'N/A', size: 90 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? 'N/A', size: 110 },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country ?? 'N/A', size: 80 },
    { id: 'size', header: 'Size', accessorFn: (r) => r.size ?? 'N/A', size: 110 },
    {
      id: 'state', header: 'Status', accessorFn: (r) => r.state, size: 90,
      cell: ({ row }) => (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          row.original.state === 'Removed'
            ? 'bg-gray-700 text-gray-300'
            : 'bg-green-900/40 text-green-400 border border-green-700/50'
        }`}>{row.original.state}</span>
      ),
    },
    {
      id: 'days_fitted', header: 'Days Fitted', accessorFn: (r) => r.days_fitted ?? -1, size: 90, meta: { align: 'right' },
      cell: ({ row }) => (row.original.days_fitted != null ? `${row.original.days_fitted}d` : 'N/A'),
    },
  ], [navigate])

  const exportRows = affectedExportRows(filteredRows)
  const fileBase = `recall_${String(recall?.recall_number || recallId || 'detail').replace(/[^A-Za-z0-9]+/g, '_')}`
  const doExcel = () => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase)
  const doPdf = () => exportToPdf(
    exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
    `Recall ${recall?.recall_number || ''} affected tyres`.trim(), fileBase, 'landscape',
  )

  const backBtn = (
    <button
      onClick={() => navigate('/recall-tracker')}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors"
    >
      <ArrowLeft size={14} /> Back to Recalls
    </button>
  )

  // ── States: loading / error / not-found ─────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {backBtn}
        <SkeletonTable rows={8} cols={7} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backBtn}
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
            <p className="text-red-400 font-medium">Could not load recall</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!recall) {
    return (
      <div className="space-y-4">
        {backBtn}
        <EmptyState
          icon={ShieldAlert}
          title="Recall not found"
          description={`No recall record matches "${recallId}". It may have been closed out or deleted.`}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          {backBtn}
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Recall Record</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <ShieldAlert className="text-red-400 shrink-0" size={18} />
              <h1 className="text-lg font-bold text-[var(--text-primary)]">{recall.recall_number}</h1>
              <Badge label={recall.severity} cfg={SEVERITY_CFG[recall.severity]} small />
              <Badge label={recall.status} cfg={STATUS_CFG[recall.status]} small />
            </div>
            <p className="text-[var(--text-muted)] text-sm mt-1">{recall.brand}{recall.description ? ` - ${recall.description}` : ''}</p>
            {recall.action_required && (
              <p className="text-xs text-[var(--text-muted)] mt-1">{recall.action_required}</p>
            )}
          </div>
        </div>
      </div>

      {/* Approval & Workflow Engine — safety-recall sign-off */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 space-y-3">
        <EntityApprovalPanel
          entityType="recall"
          entityId={recall.id}
          entityLabel={recall.recall_number || recall.brand || recall.id}
          context={{
            severity: recall.severity,
            affected_count: matched.length,
            brand: recall.brand,
            status: recall.status,
            country: recall.country,
          }}
          onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
          title="Recall Approval"
        />
        {wfLocked && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Lock size={12} /> Locked, in approval
          </p>
        )}
      </div>

      {/* Exposure KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={ShieldAlert} label="Affected tyres" value={exposure.affected}
          hint={`${exposure.removed} already removed`} tone="text-orange-400" />
        <Kpi icon={AlertTriangle} label="Still fitted" value={exposure.fitted}
          hint={exposure.fittedPct == null ? 'N/A' : `${exposure.fittedPct}% of affected`}
          tone={exposure.fitted ? 'text-red-400' : 'text-green-400'} />
        <Kpi icon={Truck} label="Assets exposed" value={exposure.assets} hint="Carrying a fitted affected tyre" />
        <Kpi icon={MapPin} label="Sites" value={exposure.sites} hint={`${exposure.countries} ${exposure.countries === 1 ? 'country' : 'countries'}`} />
        <Kpi icon={Clock} label="Avg days fitted" value={exposure.avgDaysFitted == null ? 'N/A' : `${exposure.avgDaysFitted}d`}
          hint={exposure.maxDaysFitted == null ? 'No fitment dates' : `Longest ${exposure.maxDaysFitted}d`} />
        <Kpi icon={Clock} label="Recall age" value={ageDays == null ? 'N/A' : `${ageDays}d`}
          hint={recall.closed_at ? 'Issue date to closure' : 'Since issue date'} />
      </div>

      {actions.length > 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] mb-2"><ListChecks size={14} /> What needs doing</p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-[var(--text-secondary)]">
            {actions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Breakdown title="By site" items={exposure.bySite} empty="No affected tyres." />
        <Breakdown title="Assets with fitted tyres" items={exposure.byAsset} empty="No affected tyre is still fitted." />
        <Breakdown title="By position" items={exposure.byPosition} empty="No affected tyres." />
      </div>

      {/* Affected tyres register */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <span className="font-bold text-orange-400 text-lg">
            {matched.length} affected fleet {matched.length === 1 ? 'tyre' : 'tyres'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={13} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search serial, asset, site..."
                aria-label="Search affected tyres"
                className="pl-7 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-600 w-full sm:w-56"
              />
            </div>
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by status"
              className="py-1.5 px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)]">
              <option value="all">Fitted and removed</option>
              <option value="Fitted">Fitted</option>
              <option value="Removed">Removed</option>
            </select>
            <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site"
              className="py-1.5 px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)]">
              <option value="all">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={doExcel} disabled={!exportRows.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] disabled:opacity-40">
              <Download size={13} /> Excel
            </button>
            <button type="button" onClick={doPdf} disabled={!exportRows.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] disabled:opacity-40">
              <FileText size={13} /> PDF
            </button>
          </div>
        </div>

        <EnterpriseTable
          columns={columns}
          data={tyresPager.pageRows}
          getRowId={(r) => String(r.id)}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableSorting={false}
          enableExport={false}
          virtual
          maxHeight={640}
          emptyMessage={matched.length === 0 ? 'No fleet tyres match this recall criteria' : 'No results for current filters'}
        />
        <TablePagination {...tyresPager} />
        <p className="text-[11px] text-[var(--text-muted)]">
          Fitted tyres are listed first, longest on the vehicle first. Matched on brand{recall.affected_sizes?.length ? ', size' : ''}{recall.affected_serial_prefix ? ' and serial prefix' : ''}.
          A tyre counts as removed when it carries a removal meter reading. Removal dates are not part of this view, so days fitted
          is shown only for tyres still on the vehicle.
          {exposure.serialCoverage != null && exposure.serialCoverage < 100 ? ` Serial recorded on ${exposure.serialCoverage}% of affected tyres.` : ''}
        </p>
      </div>
    </div>
  )
}

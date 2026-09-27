/**
 * GatePass (route /gate-pass) - Gate Pass station. No vehicle may leave the
 * site without a completed tyre inspection on the same day. The gate officer
 * enters an asset number, the page checks for today's inspection and any open
 * critical safety items, and the officer issues or denies the pass. Release is
 * routed through the safety-gated `gatePasses.createGatePass` path and the
 * approval engine (EntityApprovalPanel) can lock it while a workflow runs.
 *
 * The page also carries the day's KPI strip, the "Today by Site" breakdown,
 * an hourly flow profile, the top denial reasons, and a searchable,
 * status-filterable, sortable pass log (EnterpriseTable) for today or any past
 * date, with Excel / PDF export of the log as filtered and a printable policy.
 *
 * Shaping lives in src/lib/gatePassAnalytics.js. Dates are LOCAL calendar days
 * (never toISOString, which is UTC and stamps a GCC evening onto yesterday).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import * as gatePassPageApi from '../lib/api/gatePassPage'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
import {
  ShieldCheck, ShieldClose, CheckCircle, XCircle, Printer, Clock,
  Search, RefreshCw, Activity, Lock, Hourglass, Ban, FileSpreadsheet, X, BarChart3,
  AlertTriangle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import StatusBadge from '../components/ui/StatusBadge'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { gatePasses } from '../lib/api'
import { logAudit } from '../lib/audit'
import { publish } from '../lib/events'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import {
  PASS_STATUSES, localIsoDate, passTime, passSummary, siteBreakdown, hourlyProfile,
  denialReasons, filterPasses, passRegisterRows, passExportRows, PASS_EXPORT_COLUMNS,
} from '../lib/gatePassAnalytics'

// Semantic status colours; the status word is always shown with them.
const STATUS_CLS = {
  Cleared: 'bg-green-500/15 text-green-500 border-green-500/40',
  Denied: 'bg-red-500/15 text-red-500 border-red-500/40',
  Pending: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
}

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const LONG_DATE = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function GatePass() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()

  const [assetSearch, setAssetSearch] = useState('')
  const [siteFilter, setSiteFilter]   = useState('')
  const [checkResult, setCheckResult] = useState(null) // null | 'found' | 'not-found'
  const [inspection, setInspection]   = useState(null)
  const [blockers, setBlockers]       = useState(null) // safety gate: {total,blocked,corrective_actions,tyres,inspections}
  const [blockersUnknown, setBlockersUnknown] = useState(false)
  const [issueError, setIssueError]   = useState('')
  const [passes, setPasses]           = useState([])
  const [sites, setSites]             = useState([])
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayError, setTodayError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [sitesError, setSitesError] = useState('')
  const [exportError, setExportError] = useState('')
  const [checking, setChecking]       = useState(false)
  const [issuing, setIssuing]         = useState(false)
  const [denialReason, setDenialReason] = useState('')
  const [showDenialInput, setShowDenialInput] = useState(false)
  // Approval-engine gate: locks the issue/deny action for the asset under
  // clearance while its workflow is active (pending/in_review/returned) or
  // locked (approved). EntityApprovalPanel reports the true state via onStateChange.
  const [wfLocked, setWfLocked] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)

  // Tab state: 'today' | 'history'
  const [logTab, setLogTab] = useState('today')
  const [logSearch, setLogSearch] = useState('')
  const [logStatus, setLogStatus] = useState('')
  // Local calendar days, re-derived each render so an overnight station rolls over.
  const today = localIsoDate(new Date())
  const yesterday = localIsoDate(new Date(), -1)
  const [historyDate, setHistoryDate] = useState(yesterday)
  const [historyPasses, setHistoryPasses] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const autoRefreshRef = useRef(null)

  const todayDisplay = formatDate(`${today}T00:00:00`, 'All', LONG_DATE)

  const loadSites = useCallback(async () => {
    setSitesError('')
    try {
      const { data, error } = await gatePassPageApi.listGatePassSites()
      if (error) throw error
      if (data) setSites([...new Set(data.map(r => r.site).filter(Boolean))].sort())
    } catch (error) {
      setSitesError(toUserMessage(error, 'Could not load the site list.'))
    }
  }, [])

  const loadPasses = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setTodayLoading(true)
    setTodayError('')
    try {
      const { data, error } = await gatePassPageApi.listGatePasses({ date: today, site: siteFilter })
      if (error) throw error
      setPasses(data || [])
      setLastRefresh(new Date())
    } catch (error) {
      setTodayError(toUserMessage(error, "Could not load today's gate passes."))
    } finally {
      if (!silent) setTodayLoading(false)
    }
  }, [siteFilter, today])

  const loadHistoryPasses = useCallback(async (date) => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const { data, error } = await gatePassPageApi.listGatePasses({ date, site: siteFilter })
      if (error) throw error
      setHistoryPasses(data || [])
    } catch (error) {
      setHistoryError(toUserMessage(error, 'Could not load historical gate passes.'))
    } finally {
      setHistoryLoading(false)
    }
  }, [siteFilter])

  useEffect(() => {
    loadPasses()
    loadSites()
    // Auto-refresh every 60 s for gate station use
    clearInterval(autoRefreshRef.current)
    autoRefreshRef.current = setInterval(() => loadPasses({ silent: true }), 60_000)
    return () => clearInterval(autoRefreshRef.current)
  }, [activeCountry, loadPasses, loadSites])

  // Load history when switching to history tab
  useEffect(() => {
    if (logTab === 'history') {
      loadHistoryPasses(historyDate)
    }
  }, [historyDate, loadHistoryPasses, logTab])

  // Reset the approval lock whenever a different asset/inspection is loaded into
  // the clearance panel (or cleared); EntityApprovalPanel re-reports the true
  // state via onStateChange for the newly loaded record.
  useEffect(() => { setWfLocked(false) }, [inspection?.id])

  async function checkClearance() {
    if (!assetSearch.trim()) return
    setChecking(true)
    setCheckResult(null)
    setInspection(null)
    setShowDenialInput(false)
    setBlockers(null)
    setBlockersUnknown(false)
    setIssueError('')
    // Safety gate: surface open critical defects for this asset before release.
    // A failed lookup is reported, never read as "no blockers"; the release
    // path re-checks server-side regardless.
    gatePasses.listGatePassBlockers({ assetNo: assetSearch.trim(), country: activeCountry })
      .then(setBlockers).catch(() => { setBlockers(null); setBlockersUnknown(true) })
    try {
      const { data, error } = await gatePassPageApi.findAssetInspectionForClearance({ assetNo: assetSearch.trim(), date: today })
      if (error) throw error
      if (data?.[0]) {
        setInspection(data[0])
        setCheckResult('found')
        if (data[0].site && !siteFilter) setSiteFilter(data[0].site)
      } else {
        setCheckResult('not-found')
      }
    } catch (error) {
      setIssueError(toUserMessage(error, 'Could not check clearance. Try again.'))
    } finally {
      setChecking(false)
    }
  }

  async function issuePass(status) {
    // Block issuing/denying while the asset's approval workflow is active/locked.
    if (wfLocked) return
    setIssuing(true); setIssueError('')
    const values = {
      asset_no:      assetSearch.trim(),
      site:          siteFilter || inspection?.site || null,
      country:       activeCountry !== 'All' ? activeCountry : null,
      pass_date:     today,
      status,
      inspection_id: inspection?.id || null,
      cleared_by:    status === 'Cleared' ? (profile?.id || null) : null,
      cleared_at:    status === 'Cleared' ? new Date().toISOString() : null,
      denial_reason: status === 'Denied' ? (denialReason || null) : null,
    }
    try {
      if (status === 'Cleared') {
        // Route release through the safety gate - refuses when critical defects are open.
        const { blockers: b } = await gatePasses.createGatePass(values)
        if (b) setBlockers(b)
        else { logAudit({ action: 'CREATE', entity: 'gate_passes', entityId: `${values.asset_no}|${values.pass_date}`, after: values }); publish('gatepass.issued', { asset_no: values.asset_no, site: values.site, pass_date: values.pass_date, inspection_id: values.inspection_id }) }
      } else {
        const { error } = await gatePassPageApi.insertGatePass(values) // denials/other are never blocked
        if (error) throw error
        logAudit({ action: 'CREATE', entity: 'gate_passes', entityId: `${values.asset_no}|${values.pass_date}`, after: values })
        if (status === 'Denied') publish('gatepass.denied', { asset_no: values.asset_no, site: values.site, pass_date: values.pass_date, denial_reason: values.denial_reason })
      }
    } catch (err) {
      if (err?.code === 'BLOCKED') {
        setBlockers(err.blockers)
        setIssueError(err.message)
        setIssuing(false)
        return
      }
      setIssueError(toUserMessage(err, 'Could not issue the pass.'))
      setIssuing(false)
      return
    }
    await loadPasses()
    setCheckResult(null)
    setInspection(null)
    setAssetSearch('')
    setDenialReason('')
    setShowDenialInput(false)
    setBlockers(null)
    setIssuing(false)
  }

  function printPolicy() {
    const policyRows = [
      { section: 'POLICY', text: 'No vehicle may leave the site without a completed daily tyre inspection on the same date.' },
      { section: 'STEP 1', text: 'Driver presents vehicle at gate.' },
      { section: 'STEP 2', text: 'Gate officer enters asset number in the TyrePulse Gate Pass system.' },
      { section: 'STEP 3', text: 'System checks for a tyre inspection completed today for that vehicle.' },
      { section: 'STEP 4', text: 'If cleared: issue pass and log exit time.' },
      { section: 'STEP 5', text: 'If not cleared: deny exit and notify supervisor.' },
      { section: 'CONSEQUENCE 1', text: 'First offence: written warning to driver and supervisor.' },
      { section: 'CONSEQUENCE 2', text: 'Second offence: vehicle grounded until inspection is completed.' },
      { section: 'CONSEQUENCE 3', text: 'Third offence: disciplinary action per company HR policy.' },
    ]
    exportToPdf(
      policyRows,
      [
        { key: 'section', header: 'Section' },
        { key: 'text',    header: 'Policy Statement' },
      ],
      `Tyre Gate Pass Policy, effective ${todayDisplay}`,
      reportFileName('TyrePulse Gate Pass Policy'),
      'portrait'
    ).catch((e) => setExportError(toUserMessage(e, 'Could not print the policy. Try again.')))
  }

  // Tiles and "Today by Site" describe TODAY's passes (a gate station view);
  // the log search/status filter narrows only the log below.
  const summary = useMemo(() => passSummary(passes), [passes])
  const bySite = useMemo(() => siteBreakdown(passes), [passes])

  const activePassList = logTab === 'today' ? passes : historyPasses
  const activeDateLabel = logTab === 'today' ? today : historyDate
  const activeDateDisplay = logTab === 'today'
    ? todayDisplay
    : formatDate(historyDate + 'T00:00:00', 'All', LONG_DATE)

  const hourly = useMemo(() => hourlyProfile(activePassList), [activePassList])
  const reasons = useMemo(() => denialReasons(activePassList), [activePassList])
  const activeHours = useMemo(() => hourly.hours.filter((h) => h.cleared + h.denied > 0), [hourly])
  const hourMax = Math.max(1, ...hourly.hours.map((h) => h.cleared + h.denied))

  const filteredPassList = useMemo(
    () => passRegisterRows(filterPasses(activePassList, { search: logSearch, status: logStatus })),
    [activePassList, logSearch, logStatus],
  )

  const exportRows = useMemo(() => passExportRows(filteredPassList), [filteredPassList])
  const scopeParts = [siteFilter || 'All sites', logStatus || null, logSearch ? 'filtered' : null].filter(Boolean).join(', ')
  async function doExcel() {
    setExportError('')
    try {
      await exportToExcel(exportRows, PASS_EXPORT_COLUMNS.map((c) => c.key), PASS_EXPORT_COLUMNS.map((c) => c.header), reportFileName('TyrePulse Gate Pass', activeDateLabel))
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  async function doPdf() {
    setExportError('')
    try {
      await exportToPdf(exportRows, PASS_EXPORT_COLUMNS, `Gate Pass Log: ${activeDateDisplay} (${scopeParts})`, reportFileName('TyrePulse Gate Pass', activeDateLabel), 'landscape')
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const logLoading = logTab === 'history' ? historyLoading : todayLoading
  const logError = logTab === 'today' ? todayError : historyError
  const retryLog = () => (logTab === 'today' ? loadPasses() : loadHistoryPasses(historyDate))

  const columns = useMemo(() => [
    { id: 'time', header: 'Time', accessorFn: (p) => p.createdTime ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 90, cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{row.original.timeLabel || 'N/A'}</span> },
    {
      id: 'asset', header: 'Asset', accessorFn: (p) => blank(p.asset_no), sortingFn: valueSort, sortUndefined: 'last', size: 150,
      cell: ({ row }) => row.original.asset_no
        ? <Link to={`/asset-management/${encodeURIComponent(row.original.asset_no)}`} className="font-mono font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline">{row.original.asset_no}</Link>
        : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    { id: 'site', header: 'Site', accessorFn: (p) => blank(p.site), sortingFn: valueSort, sortUndefined: 'last', size: 140, cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (p) => blank(p.status), sortingFn: valueSort, sortUndefined: 'last', size: 110,
      cell: ({ row }) => <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLS[row.original.status] || STATUS_CLS.Pending}`}>{row.original.status || 'N/A'}</span>,
    },
    { id: 'reason', header: 'Reason', accessorFn: (p) => blank(p.denial_reason), sortingFn: valueSort, sortUndefined: 'last', size: 260, cell: ({ getValue }) => <span className="text-xs text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
  ], [])

  const rateTone = summary.clearRate == null ? 'text-[var(--text-primary)]' : summary.clearRate >= 80 ? 'text-green-500' : summary.clearRate >= 60 ? 'text-amber-500' : 'text-red-500'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gate Pass"
        subtitle={todayDisplay}
        icon={ShieldCheck}
        onRefresh={() => { loadPasses(); if (logTab === 'history') loadHistoryPasses(historyDate) }}
        refreshing={todayLoading}
        updatedAt={lastRefresh}
        actions={
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={doExcel} disabled={!filteredPassList.length} className="btn-secondary flex items-center gap-1.5 text-sm min-h-[44px] sm:min-h-0">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} disabled={!filteredPassList.length} className="btn-secondary flex items-center gap-1.5 text-sm min-h-[44px] sm:min-h-0">
              <Printer size={14} aria-hidden="true" /> Daily Log PDF
            </button>
            <button type="button" onClick={printPolicy} className="btn-secondary flex items-center gap-1.5 text-sm min-h-[44px] sm:min-h-0">
              <Printer size={14} aria-hidden="true" /> Print Policy
            </button>
          </div>
        }
      />

      {exportError && (
        <div className="card border border-red-500/40 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{exportError}</p>
          <button type="button" onClick={() => setExportError('')} className="inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {/* Today's figures */}
      <section aria-label="Today's gate figures">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Total today" value={todayError ? 'N/A' : summary.total} icon={Activity} tone="text-[var(--text-primary)]" />
          <Kpi label="Cleared" value={todayError ? 'N/A' : summary.cleared} icon={CheckCircle} tone="text-green-500" />
          <Kpi label="Denied" value={todayError ? 'N/A' : summary.denied} icon={XCircle} tone="text-red-500" />
          <Kpi label="Pending" value={todayError ? 'N/A' : summary.pending} icon={Hourglass} tone="text-amber-500" />
          <Kpi label="Clearance rate" value={todayError || summary.clearRate == null ? 'N/A' : `${summary.clearRate}%`} sub={summary.clearRate == null ? 'No decided passes yet' : 'Cleared of cleared + denied'} icon={ShieldCheck} tone={rateTone} />
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">Figures cover today's passes{siteFilter ? ` at ${siteFilter}` : ' at every site'}. The log search below narrows the log only.</p>
      </section>

      {/* Site breakdown (when >1 site) */}
      {bySite.length > 1 && (
        <div className="card">
          <h2 className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide mb-2">Today by Site</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {bySite.map((s) => (
              <li key={s.site} className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-secondary)]">{s.site}</span>
                <span className="text-green-500 font-medium inline-flex items-center gap-0.5"><CheckCircle size={11} aria-hidden="true" />{s.cleared} cleared</span>
                {s.denied > 0 && <span className="text-red-500 font-medium inline-flex items-center gap-0.5"><XCircle size={11} aria-hidden="true" />{s.denied} denied</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gate Clearance panel */}
      <div className="card">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Gate Clearance Check</h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-[14rem]">
            <label className="label" htmlFor="gp-asset">Vehicle Asset Number</label>
            <input
              id="gp-asset"
              className="input text-lg h-12 w-full"
              placeholder="Enter asset no..."
              autoComplete="off"
              value={assetSearch}
              onChange={e => setAssetSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && checkClearance()}
            />
          </div>
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="gp-site">Site</label>
            <select id="gp-site" className="input h-12 w-full" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {sitesError && <p className="mt-1 text-xs text-amber-500">Site list unavailable. You can still enter an asset number.</p>}
          </div>
          <div className="flex items-end w-full sm:w-auto">
            <button type="button" onClick={checkClearance} disabled={checking || !assetSearch.trim()}
              className="btn-primary h-12 px-6 disabled:opacity-50 w-full sm:w-auto">
              {checking ? 'Checking...' : 'Check Clearance'}
            </button>
          </div>
        </div>

        {issueError && checkResult == null && <p role="alert" className="text-red-500 text-sm mb-3">{issueError}</p>}

        {/* Result panel */}
        {checkResult === 'found' && inspection && (
          <div className="rounded-xl p-5 mb-4 border border-green-500/40 bg-green-500/10" role="status">
            <div className="flex items-center gap-3 mb-3">
              <StatusBadge state={blockers?.blocked ? 'critical' : 'verified'} showLabel={false} size={36} className="flex-shrink-0" />
              <div>
                <p className="text-green-500 font-bold text-lg">CLEARED</p>
                <p className="text-[var(--text-secondary)] text-sm">Tyre inspection completed today</p>
              </div>
            </div>
            <div className="text-sm text-[var(--text-secondary)] space-y-1 mb-4">
              <p>Type: <span className="text-[var(--text-primary)]">{inspection.inspection_type || 'N/A'}</span></p>
              <p>Inspector: <span className="text-[var(--text-primary)]">{inspection.inspector || 'Not specified'}</span></p>
              <p>Recorded: <span className="text-[var(--text-primary)]">{passTime(inspection.created_at) || 'N/A'}</span></p>
              <p><Link to={`/asset-management/${encodeURIComponent(assetSearch.trim())}`} className="text-[var(--text-primary)] underline underline-offset-2">Open vehicle record</Link></p>
            </div>
            {blockersUnknown && (
              <p className="text-xs text-amber-500 mb-3">Open safety items could not be checked here. Release is still re-checked against open critical items when the pass is issued.</p>
            )}
            {blockers?.blocked && (
              <div className="rounded-lg p-3 mb-3 border border-red-500/40 bg-red-500/10" role="alert">
                <p className="text-red-500 font-semibold text-sm mb-1 inline-flex items-center gap-1.5"><Ban size={14} aria-hidden="true" /> Release blocked: {blockers.total} open critical safety item(s)</p>
                <ul className="text-xs text-[var(--text-secondary)] space-y-0.5 list-disc pl-4">
                  {blockers.corrective_actions?.map((c) => <li key={c.id}>Corrective action: {c.title} ({c.status})</li>)}
                  {blockers.tyres?.map((t) => <li key={t.id}>Critical tyre {t.serial_no || ''} {t.brand ? `(${t.brand})` : ''}</li>)}
                  {blockers.inspections?.map((i) => <li key={i.id}>Critical inspection: {i.title || i.inspection_type} ({i.status})</li>)}
                </ul>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Resolve or close these before the vehicle can be released.</p>
              </div>
            )}
            {/* Approval & Workflow Engine: gate release behind a configurable
                approval chain for this asset's gate pass. */}
            <div className="mb-4">
              <EntityApprovalPanel
                entityType="gate_pass"
                entityId={inspection.id}
                entityLabel={inspection.asset_no || assetSearch.trim() || inspection.id}
                context={{
                  purpose: 'Vehicle handover / gate release',
                  asset_no: assetSearch.trim() || inspection.asset_no,
                  inspection_id: inspection.id,
                  inspection_type: inspection.inspection_type,
                  destination: null,
                  site: siteFilter || inspection.site,
                  pass_date: today,
                }}
                title="Gate Pass Approval"
                onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
              />
            </div>
            {wfLocked && (
              <div className="flex items-center gap-1.5 text-xs text-amber-500 mb-2">
                <Lock size={12} aria-hidden="true" /> Locked, in approval
              </div>
            )}
            {issueError && !blockers?.blocked && <p role="alert" className="text-red-500 text-xs mb-2">{issueError}</p>}
            <button type="button" onClick={() => issuePass('Cleared')} disabled={issuing || wfLocked || blockers?.blocked}
              className="btn-primary px-6 disabled:opacity-50 min-h-[44px]"
              title={wfLocked ? 'Locked while in approval' : blockers?.blocked ? 'Blocked by open critical safety items' : undefined}>
              {issuing ? 'Issuing...' : wfLocked ? 'Locked, in approval' : blockers?.blocked ? 'Release blocked' : 'Issue Gate Pass'}
            </button>
          </div>
        )}

        {checkResult === 'not-found' && (
          <div className="rounded-xl p-5 mb-4 border border-red-500/40 bg-red-500/10" role="status">
            <div className="flex items-center gap-3 mb-3">
              <ShieldClose size={28} className="text-red-500 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-red-500 font-bold text-lg">NOT CLEARED</p>
                <p className="text-[var(--text-secondary)] text-sm">No tyre inspection found for today</p>
              </div>
            </div>
            {issueError && <p role="alert" className="text-red-500 text-xs mb-2">{issueError}</p>}
            {!showDenialInput ? (
              <button type="button" onClick={() => setShowDenialInput(true)} className="px-5 py-2 min-h-[44px] rounded-lg bg-red-500/15 text-red-500 border border-red-500/40 hover:bg-red-500/25 text-sm font-medium">
                Deny Exit
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="gp-reason">Denial reason (optional)</label>
                  <input id="gp-reason" className="input w-full" placeholder="e.g. No inspection record found" value={denialReason}
                    onChange={e => setDenialReason(e.target.value)} />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => issuePass('Denied')} disabled={issuing}
                    className="btn-danger px-5 py-2 min-h-[44px] text-sm disabled:opacity-50">
                    {issuing ? 'Saving...' : 'Confirm Deny Exit'}
                  </button>
                  <button type="button" onClick={() => setShowDenialInput(false)} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Flow + denial reasons for the log's day */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Gate flow by hour ({logTab === 'today' ? 'today' : historyDate})</h2>
          {logLoading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : logError ? (
            <p className="text-sm text-[var(--text-muted)]">Not available: the log for this day could not be loaded.</p>
          ) : activeHours.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No passes recorded for this day yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {activeHours.map((h) => (
                <li key={h.hour} className="flex items-center gap-2 text-xs">
                  <span className="w-12 font-mono text-[var(--text-muted)]">{h.label}</span>
                  <div className="flex-1 h-3 rounded bg-[var(--input-bg)] overflow-hidden flex" aria-hidden="true">
                    <div className="h-full bg-green-500" style={{ width: `${(h.cleared / hourMax) * 100}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${(h.denied / hourMax) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-[var(--text-secondary)] w-28 text-right">{h.cleared} cleared, {h.denied} denied</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Ban size={15} aria-hidden="true" /> Top denial reasons ({logTab === 'today' ? 'today' : historyDate})</h2>
          {logLoading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : logError ? (
            <p className="text-sm text-[var(--text-muted)]">Not available: the log for this day could not be loaded.</p>
          ) : reasons.top.length === 0 && reasons.unstated === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No exits were denied on this day.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {reasons.top.map((r) => (
                <li key={r.reason} className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)] truncate">{r.reason}</span>
                  <span className="tabular-nums font-semibold text-[var(--text-primary)]">{r.count}</span>
                </li>
              ))}
              {reasons.unstated > 0 && (
                <li className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)] italic">No reason given</span>
                  <span className="tabular-nums font-semibold text-[var(--text-primary)]">{reasons.unstated}</span>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Pass Log with Today / History tabs */}
      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex gap-1 p-1 bg-[var(--input-bg)] rounded-lg" role="tablist" aria-label="Pass log period">
            {[['today', 'Today'], ['history', 'History']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={logTab === key}
                onClick={() => setLogTab(key)}
                className={`px-4 py-1.5 min-h-[40px] rounded-md text-sm font-medium transition-colors ${
                  logTab === key ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Clock size={18} className="text-[var(--text-muted)]" aria-hidden="true" />
            {logTab === 'today' ? "Today's Pass Log" : 'Historical Pass Log'}
          </h2>
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-3">
          {logTab === 'history' && (
            <div>
              <span className="label block">Select Date</span>
              <DateField
                className="input w-48"
                value={historyDate}
                max={yesterday}
                onChange={setHistoryDate}
                ariaLabel="Historical pass date"
              />
            </div>
          )}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <label htmlFor="gp-log-search" className="sr-only">Search the pass log</label>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              id="gp-log-search"
              className="input pl-8 text-sm w-full"
              placeholder="Search asset, site, reason..."
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
            />
          </div>
          <select className="input w-full sm:w-auto text-sm" value={logStatus} onChange={(e) => setLogStatus(e.target.value)} aria-label="Pass status">
            <option value="">All statuses</option>
            {PASS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(logSearch || logStatus) && (
            <button type="button" onClick={() => { setLogSearch(''); setLogStatus('') }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {filteredPassList.length} pass{filteredPassList.length !== 1 ? 'es' : ''}
            {(logSearch || logStatus) && activePassList.length !== filteredPassList.length && ` (filtered from ${activePassList.length})`}
          </span>
        </div>

        <EnterpriseTable
          columns={columns}
          data={filteredPassList}
          getRowId={(p) => String(p.id)}
          loading={logLoading}
          error={logError || null}
          onRetry={retryLog}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="gate-pass-log"
          initialPageSize={25}
          emptyMessage={logSearch || logStatus ? 'No passes match the search.' : logTab === 'today' ? 'No gate passes recorded today yet.' : `No gate passes found for ${activeDateLabel}.`}
        />
      </div>

      {/* Refresh control for small screens where the header refresh can scroll away */}
      <div className="sm:hidden">
        <button type="button" onClick={() => loadPasses()} className="btn-secondary w-full min-h-[44px] inline-flex items-center justify-center gap-2"><RefreshCw size={14} aria-hidden="true" /> Refresh today's log</button>
      </div>
    </div>
  )
}

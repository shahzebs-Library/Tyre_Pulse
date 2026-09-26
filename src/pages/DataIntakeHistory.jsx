import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  History, BarChart3, Layers, Tags, Loader2, AlertTriangle, RotateCcw, ChevronRight, Database,
  CheckCircle2, Link2, Plus, Coins, Download, FileText, Copy, RefreshCw, X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import * as imports from '../lib/api/imports'
import { reconcileBatch } from '../lib/import/reconcile'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { OUTCOME_META } from '../lib/api/importHistory'
import {
  enrichBatches, summarizeIntake, repeatFileGroups, moduleBreakdown, filterBatches,
  batchExportRows, BATCH_EXPORT_COLS, BATCH_EXPORT_HEADERS, OUTCOME_ORDER, STALE_DAYS,
} from '../lib/dataIntakeHistoryAnalytics'
import FilterBar from '../components/ui/FilterBar'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'

// exportUtils carries the PDF/Excel engines; load it on first click only.
const loadExportUtils = () => import('../lib/exportUtils')

const ELEVATED = ['admin', 'manager', 'director']
const TABS = [
  { key: 'imports', label: 'Imports', icon: History },
  { key: 'quality', label: 'Data Quality', icon: BarChart3 },
  { key: 'profiles', label: 'Mapping Profiles', icon: Layers },
  { key: 'custom', label: 'Custom Fields', icon: Tags },
  { key: 'aliases', label: 'Aliases', icon: Link2 },
  { key: 'fx', label: 'FX Rates', icon: Coins },
]
const ALIAS_ENTITY_TYPES = ['site', 'supplier', 'brand', 'driver', 'make', 'model']

const TONE_CLASS = {
  good: 'bg-green-900/30 text-green-400',
  info: 'bg-sky-900/30 text-sky-300',
  warning: 'bg-amber-900/30 text-amber-400',
  danger: 'bg-red-900/30 text-red-400',
  quiet: 'bg-[var(--input-bg)] text-muted',
}

function chip(s) {
  const ok = s === 'committed'
  return `text-xs px-2 py-0.5 rounded ${ok ? 'bg-green-900/30 text-green-400' : s === 'reversed' ? 'bg-red-900/30 text-red-400' : 'bg-[var(--input-bg)] text-muted'}`
}

function OutcomeBadge({ outcome }) {
  const meta = OUTCOME_META[outcome] || OUTCOME_META.unknown
  return <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${TONE_CLASS[meta.tone] || TONE_CLASS.quiet}`}>{meta.label}</span>
}

const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
const fmtWhen = (v) => (v ? new Date(v).toLocaleString('en-GB') : 'N/A')

/** Inline reconciliation indicator derived from reconcileBatch(). */
function ReconcileBadge({ summary }) {
  const { t } = useLanguage()
  if (summary.indicator === 'pending') {
    return <span className="text-xs px-2 py-0.5 rounded bg-[var(--input-bg)] text-muted">N/A</span>
  }
  const balanced = summary.indicator === 'balanced'
  const cls = balanced ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400'
  const Icon = balanced ? CheckCircle2 : AlertTriangle
  return (
    <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 ${cls}`} title={t('intakehistory.reconcile.importedOfExpected', { imported: summary.imported, expected: summary.expected })}>
      <Icon size={12} /> {balanced ? t('intakehistory.reconcile.balanced') : t('intakehistory.reconcile.review')}
    </span>
  )
}

function Kpi({ label, value, sub, active, onClick, tone }) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </>
  )
  if (!onClick) return <div className="card !p-4">{body}</div>
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`card !p-4 text-left transition-colors ${active ? 'ring-1 ring-green-500/60' : ''}`}>
      {body}
    </button>
  )
}

/** EnterpriseTable over the page's shared paging contract (usePagedRows). */
function PagedTable({ columns, pager, emptyMessage, getRowId = (r) => String(r.id), maxHeight = 560 }) {
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={columns}
        data={pager.pageRows}
        getRowId={getRowId}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      <TablePagination {...pager} />
    </div>
  )
}

export default function DataIntakeHistory() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const { t } = useLanguage()
  const isElevated = ELEVATED.includes(String(profile?.role || '').toLowerCase())

  const [tab, setTab] = useState('imports')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [batches, setBatches] = useState([])
  const [files, setFiles] = useState([])
  const [filesError, setFilesError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [quality, setQuality] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [aliases, setAliases] = useState([])
  const [aliasForm, setAliasForm] = useState({ entityType: 'site', rawValue: '', canonicalValue: '' })
  const [savingAlias, setSavingAlias] = useState(false)
  const [fxRates, setFxRates] = useState([])
  const [fxForm, setFxForm] = useState({ baseCurrency: '', quoteCurrency: '', rate: '', rateDate: '', source: 'manual' })
  const [savingFx, setSavingFx] = useState(false)
  const [drill, setDrill] = useState(null) // { batch, rows }
  const [busyId, setBusyId] = useState(null)
  const [reconId, setReconId] = useState(null) // batch whose reconciliation detail is shown
  const [batchSearch, setBatchSearch] = useState('')
  const [batchStatus, setBatchStatus] = useState('')
  const [batchModule, setBatchModule] = useState('')
  const [batchOutcome, setBatchOutcome] = useState('')
  const [repeatOnly, setRepeatOnly] = useState(false)

  const enriched = useMemo(
    () => enrichBatches(batches, filesError ? [] : files, { now: loadedAt || new Date() }),
    [batches, files, filesError, loadedAt],
  )
  const summary = useMemo(() => summarizeIntake(enriched, { staleDays: STALE_DAYS }), [enriched])
  const repeatGroups = useMemo(() => repeatFileGroups(enriched), [enriched])
  const modules = useMemo(() => moduleBreakdown(enriched), [enriched])
  const batchModules = useMemo(() => [...new Set(batches.map((b) => b.module).filter(Boolean))].sort(), [batches])
  const batchStatuses = useMemo(() => [...new Set(batches.map((b) => b.import_status).filter(Boolean))].sort(), [batches])
  const filteredBatches = useMemo(() => filterBatches(enriched, {
    search: batchSearch, outcome: batchOutcome, module: batchModule, status: batchStatus, repeatOnly,
  }), [enriched, batchSearch, batchOutcome, batchModule, batchStatus, repeatOnly])
  const reconBatch = useMemo(() => enriched.find((b) => b.id === reconId) || null, [enriched, reconId])

  const batchesPager = usePagedRows(filteredBatches)
  const drillPager = usePagedRows(drill?.rows || [])
  const profilesPager = usePagedRows(profiles)
  const customFieldsPager = usePagedRows(customFields)
  const aliasesPager = usePagedRows(aliases)
  const fxRatesPager = usePagedRows(fxRates)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (tab === 'imports') {
        const list = await imports.listBatches({ country: activeCountry, limit: null })
        setBatches(list)
        // The repeat-file check is a second read. If it fails the history still
        // shows, and the repeat figures read N/A instead of a false "no repeats".
        try {
          setFiles(await imports.listImportFileFingerprints(list.map((b) => b.file_id)))
          setFilesError('')
        } catch (e) {
          setFiles([])
          setFilesError(toUserMessage(e, 'Could not check for repeat files.'))
        }
        setLoadedAt(new Date())
      } else if (tab === 'quality') setQuality(await imports.importControlStats({ country: activeCountry }))
      else if (tab === 'profiles') setProfiles(await imports.listProfiles({ country: activeCountry }))
      else if (tab === 'custom') setCustomFields(await imports.listCustomFields({ country: activeCountry }))
      else if (tab === 'aliases') setAliases(await imports.listAliases({ country: activeCountry }))
      else if (tab === 'fx') setFxRates(await imports.listCurrencyRates({ approvedOnly: false }))
    } catch (e) {
      setError(toUserMessage(e, t('intakehistory.errors.loadFailed')))
    } finally { setLoading(false) }
  }, [tab, activeCountry, t])

  async function addAlias() {
    if (!aliasForm.rawValue.trim() || !aliasForm.canonicalValue.trim()) return
    setSavingAlias(true); setActionError('')
    try {
      await imports.saveAlias({ ...aliasForm, country: activeCountry })
      setAliasForm((f) => ({ ...f, rawValue: '', canonicalValue: '' }))
      await load()
    } catch (e) {
      setActionError(toUserMessage(e, t('intakehistory.errors.aliasSaveFailed')))
    } finally { setSavingAlias(false) }
  }

  async function addFxRate() {
    const f = fxForm
    if (!f.baseCurrency.trim() || !f.quoteCurrency.trim() || !(Number(f.rate) > 0) || !f.rateDate) return
    setSavingFx(true); setActionError('')
    try {
      await imports.saveCurrencyRate({
        baseCurrency: f.baseCurrency.trim().toUpperCase(), quoteCurrency: f.quoteCurrency.trim().toUpperCase(),
        rate: Number(f.rate), rateDate: f.rateDate, source: f.source || 'manual',
      })
      setFxForm((s) => ({ ...s, rate: '' }))
      await load()
    } catch (e) {
      setActionError(toUserMessage(e, t('intakehistory.errors.fxSaveFailed')))
    } finally { setSavingFx(false) }
  }
  async function approveFx(id) {
    setActionError('')
    try { await imports.approveCurrencyRate(id); await load() }
    catch (e) { setActionError(toUserMessage(e, t('intakehistory.errors.fxApproveFailed'))) }
  }
  useEffect(() => { load() }, [load])

  async function openDrill(batch) {
    setDrill({ batch, rows: null })
    try { setDrill({ batch, rows: await imports.getBatchRows(batch.id, null) }) }
    catch (e) { setDrill({ batch, rows: [], error: toUserMessage(e, 'Could not load rows.') }) }
  }

  async function reverse(batch) {
    if (!window.confirm(t('intakehistory.confirm.reverseImport', { module: batch.module, country: batch.country }))) return
    setBusyId(batch.id); setActionError('')
    try { await imports.reverseBatch(batch.id); await load() }
    catch (e) { setActionError(toUserMessage(e, t('intakehistory.errors.reverseFailed'))) }
    finally { setBusyId(null) }
  }

  // Finish a staged / pending batch WITHOUT re-running the wizard: submit,
  // approve, commit, enrich, then refresh.
  async function commitStaged(batch) {
    if (!window.confirm(t('intakehistory.confirm.commitImport', { module: batch.module, country: batch.country || activeCountry, rows: batch.total_rows || 0 }))) return
    setBusyId(batch.id); setActionError('')
    try {
      await imports.submitForApproval(batch.id)
      await imports.approveBatch(batch.id)
      const res = await imports.commitBatch(batch.id)
      try { await imports.enrichBatch(batch.id) } catch { /* enrichment is best-effort */ }
      if (res?.status === 'committed') {
        imports.runPostImportAutomation(batch.id, batch.module, { country: batch.country || activeCountry }).catch(() => {})
      }
      await load()
      if (res && res.inserted === 0 && res.failed > 0) {
        setActionError(t('intakehistory.errors.commitNoRows', { failed: res.failed }))
      }
    } catch (e) {
      setActionError(toUserMessage(e, t('intakehistory.errors.commitFailed')))
    } finally { setBusyId(null) }
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => batchExportRows(filteredBatches), [filteredBatches])
  const fileBase = async () => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName('TyrePulse Import History', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  }
  async function doExcel() {
    const { exportToExcel } = await loadExportUtils()
    exportToExcel(exportRows, BATCH_EXPORT_COLS, BATCH_EXPORT_HEADERS, await fileBase())
  }
  async function doPdf() {
    const { exportToPdf } = await loadExportUtils()
    exportToPdf(exportRows, BATCH_EXPORT_COLS.map((key, i) => ({ key, header: BATCH_EXPORT_HEADERS[i] })),
      'Import History', await fileBase(), 'landscape')
  }

  const toggleOutcome = (o) => setBatchOutcome((cur) => (cur === o ? '' : o))
  const repeatKnown = !filesError && summary.fingerprinted > 0

  // ── Columns ───────────────────────────────────────────────────────────────
  const batchColumns = useMemo(() => [
    {
      id: 'module', header: t('intakehistory.imports.columns.module'), accessorFn: (b) => b.module, size: 150,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="capitalize text-secondary">{row.original.module || 'N/A'}</p>
          <p className="text-xs text-muted truncate" title={row.original.fileName || ''}>{row.original.fileName || 'File name not recorded'}</p>
        </div>
      ),
    },
    { id: 'country', header: t('intakehistory.imports.columns.country'), accessorFn: (b) => b.country || 'N/A', size: 80 },
    {
      id: 'outcome', header: 'Outcome', accessorFn: (b) => b.outcomeLabel, size: 150,
      cell: ({ row }) => (
        <div className="flex flex-col gap-1 items-start">
          <OutcomeBadge outcome={row.original.outcome} />
          <span className={chip(row.original.import_status)}>{row.original.import_status || 'N/A'}</span>
        </div>
      ),
    },
    {
      id: 'rows', header: t('intakehistory.imports.columns.rows'), accessorFn: (b) => b.imported_rows, size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-muted tabular-nums">{fmtNum(row.original.imported_rows)} / {fmtNum(row.original.total_rows)}</span>,
    },
    {
      id: 'errors', header: t('intakehistory.imports.columns.errorsDups'), accessorFn: (b) => b.error_rows, size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-muted text-xs tabular-nums">{fmtNum(row.original.error_rows)} / {fmtNum(row.original.duplicate_rows)}</span>,
    },
    {
      id: 'repeat', header: 'Same file', accessorFn: (b) => b.repeatCount ?? 0, size: 100,
      cell: ({ row }) => (row.original.isRepeat
        ? <span className="text-xs px-2 py-0.5 rounded bg-amber-900/30 text-amber-400 inline-flex items-center gap-1"><Copy size={11} /> {row.original.repeatCount} uploads</span>
        : <span className="text-xs text-muted">{row.original.sha256 ? 'Unique' : 'N/A'}</span>),
    },
    {
      id: 'reconcile', header: t('intakehistory.imports.columns.reconcile'), size: 120,
      cell: ({ row }) => {
        const recon = reconcileBatch(row.original)
        if (recon.indicator === 'pending') return <ReconcileBadge summary={recon} />
        const open = reconId === row.original.id
        return (
          <button type="button" onClick={() => setReconId(open ? null : row.original.id)} aria-expanded={open}
            className="inline-flex items-center gap-1" title={t('intakehistory.imports.showReconcileDetail')}>
            <ReconcileBadge summary={recon} /> <ChevronRight size={13} className="text-muted" />
          </button>
        )
      },
    },
    {
      id: 'when', header: t('intakehistory.imports.columns.when'), accessorFn: (b) => b.created_at, size: 150,
      cell: ({ row }) => <span className="text-muted text-xs">{fmtWhen(row.original.created_at)}</span>,
    },
    {
      id: 'actions', header: '', size: 190, meta: { export: false },
      cell: ({ row }) => {
        const b = row.original
        return (
          <div className="text-right whitespace-nowrap">
            <button type="button" onClick={() => openDrill(b)} className="text-xs text-secondary hover:text-[var(--text-primary)] inline-flex items-center gap-1">{t('intakehistory.imports.rowsAction')} <ChevronRight size={13} /></button>
            {isElevated && b.import_status !== 'committed' && b.import_status !== 'reversed' && (
              <button type="button" onClick={() => commitStaged(b)} disabled={busyId === b.id} className="ml-3 text-xs text-green-400 hover:text-green-300 inline-flex items-center gap-1" title={t('intakehistory.imports.commitActionTitle')}>{busyId === b.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} {t('intakehistory.imports.commitAction')}</button>
            )}
            {isElevated && b.import_status === 'committed' && (
              <button type="button" onClick={() => reverse(b)} disabled={busyId === b.id} className="ml-3 text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1">{busyId === b.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} {t('intakehistory.imports.reverseAction')}</button>
            )}
          </div>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, reconId, isElevated, busyId, activeCountry])

  const drillColumns = useMemo(() => [
    { id: 'idx', header: t('intakehistory.drill.columns.index'), accessorFn: (r) => r.source_row_no ?? 'N/A', size: 80 },
    { id: 'validation', header: t('intakehistory.drill.columns.validation'), accessorFn: (r) => r.validation_status || 'N/A', size: 120 },
    { id: 'dup', header: t('intakehistory.drill.columns.dup'), accessorFn: (r) => (r.dup_status && r.dup_status !== 'none' ? r.dup_status : 'None'), size: 110 },
    { id: 'action', header: t('intakehistory.drill.columns.action'), accessorFn: (r) => r.action || 'N/A', size: 110 },
    { id: 'target', header: t('intakehistory.drill.columns.committedId'), accessorFn: (r) => r.target_record_id || 'N/A', size: 260 },
  ], [t])

  const profileColumns = useMemo(() => [
    { id: 'name', header: t('intakehistory.profiles.columns.name'), accessorFn: (p) => p.name, size: 200 },
    { id: 'module', header: t('intakehistory.profiles.columns.module'), accessorFn: (p) => p.module, size: 120 },
    { id: 'source', header: t('intakehistory.profiles.columns.source'), accessorFn: (p) => p.source_system || 'N/A', size: 120 },
    { id: 'country', header: t('intakehistory.profiles.columns.country'), accessorFn: (p) => p.country || 'any', size: 90 },
    { id: 'version', header: t('intakehistory.profiles.columns.version'), accessorFn: (p) => p.version ?? 'N/A', size: 80 },
    { id: 'last', header: t('intakehistory.profiles.columns.lastUsed'), accessorFn: (p) => (p.last_used_at ? formatDate(p.last_used_at) : 'Never'), size: 130 },
  ], [t])

  const customColumns = useMemo(() => [
    { id: 'field', header: t('intakehistory.custom.columns.field'), accessorFn: (c) => c.field_name, size: 200 },
    { id: 'module', header: t('intakehistory.custom.columns.module'), accessorFn: (c) => c.module, size: 120 },
    { id: 'country', header: t('intakehistory.custom.columns.country'), accessorFn: (c) => c.country || 'any', size: 90 },
    { id: 'seen', header: t('intakehistory.custom.columns.seen'), accessorFn: (c) => c.occurrence_count ?? 'N/A', size: 90, meta: { align: 'right' } },
    { id: 'status', header: t('intakehistory.custom.columns.status'), accessorFn: (c) => c.mapping_status || 'N/A', size: 120 },
  ], [t])

  const aliasColumns = useMemo(() => [
    { id: 'entity', header: t('intakehistory.aliases.columns.entity'), accessorFn: (a) => a.entity_type, size: 100 },
    { id: 'raw', header: t('intakehistory.aliases.columns.rawValue'), accessorFn: (a) => a.raw_value, size: 180 },
    {
      id: 'canonical', header: t('intakehistory.aliases.columns.canonical'), accessorFn: (a) => a.canonical_value, size: 200,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)] inline-flex items-center gap-1"><ChevronRight size={13} className="text-dim" />{row.original.canonical_value}</span>,
    },
    { id: 'country', header: t('intakehistory.aliases.columns.country'), accessorFn: (a) => a.country || 'any', size: 90 },
    { id: 'added', header: t('intakehistory.aliases.columns.added'), accessorFn: (a) => (a.created_at ? formatDate(a.created_at) : 'N/A'), size: 120 },
  ], [t])

  const fxColumns = useMemo(() => [
    { id: 'pair', header: t('intakehistory.fx.columns.pair'), accessorFn: (r) => `${r.quote_currency} to ${r.base_currency}`, size: 130 },
    { id: 'rate', header: t('intakehistory.fx.columns.rate'), accessorFn: (r) => r.rate, size: 110, meta: { align: 'right' } },
    { id: 'date', header: t('intakehistory.fx.columns.date'), accessorFn: (r) => r.rate_date || 'N/A', size: 110 },
    { id: 'source', header: t('intakehistory.fx.columns.source'), accessorFn: (r) => r.source || 'N/A', size: 100 },
    {
      id: 'status', header: t('intakehistory.fx.columns.status'), accessorFn: (r) => (r.approved ? 'approved' : 'draft'), size: 100,
      cell: ({ row }) => <span className={`text-xs px-2 py-0.5 rounded ${row.original.approved ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400'}`}>{row.original.approved ? t('intakehistory.fx.status.approved') : t('intakehistory.fx.status.draft')}</span>,
    },
    {
      id: 'action', header: t('intakehistory.fx.columns.action'), size: 110, meta: { align: 'right', export: false },
      cell: ({ row }) => (!row.original.approved && isElevated
        ? <button type="button" onClick={() => approveFx(row.original.id)} className="text-xs px-2 py-1 rounded border border-[var(--input-border)] text-secondary hover:text-green-400 hover:border-green-700/50 inline-flex items-center gap-1"><CheckCircle2 size={12} /> {t('intakehistory.fx.approve')}</button>
        : <span className="text-dim text-xs">N/A</span>),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, isElevated])

  const recon = reconBatch ? reconcileBatch(reconBatch) : null

  return (
    <div className="p-6 max-w-[1800px] mx-auto text-secondary">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2"><Database size={22} /> {t('intakehistory.title')}</h1>
          <p className="text-sm text-muted">{t('intakehistory.subtitle', { country: activeCountry })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className="text-sm px-3 py-2 rounded-lg border border-[var(--input-border)] text-secondary hover:text-[var(--text-primary)] inline-flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link to="/data-intake" className="text-sm px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white">{t('intakehistory.newImport')}</Link>
        </div>
      </div>

      <div className="flex gap-2 mb-5 border-b border-[var(--input-border)] overflow-x-auto">
        {TABS.map((tabDef) => {
          const I = tabDef.icon
          return (
            <button key={tabDef.key} type="button" onClick={() => { setTab(tabDef.key); setDrill(null); setActionError('') }} className={`px-3 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px whitespace-nowrap ${tab === tabDef.key ? 'border-green-500 text-[var(--text-primary)]' : 'border-transparent text-muted hover:text-secondary'}`}>
              <I size={15} /> {t(`intakehistory.tabs.${tabDef.key}`)}
            </button>
          )
        })}
      </div>

      {actionError && (
        <div role="alert" className="mb-4 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2 items-start">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {error ? (
        <div role="alert" className="card py-10 px-6 flex flex-col items-center gap-3 text-center border border-red-700/40">
          <AlertTriangle className="w-8 h-8 text-red-400" />
          <p className="text-[var(--text-primary)] font-semibold">This view could not be loaded</p>
          <p className="text-muted text-sm max-w-md">{error}</p>
          <button type="button" onClick={load} className="text-sm px-3 py-2 rounded-lg border border-[var(--input-border)] inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : loading ? (
        <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-green-400" /></div>
      ) : (
        <>
          {/* IMPORTS */}
          {tab === 'imports' && !drill && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {OUTCOME_ORDER.filter((o) => o !== 'unknown' || summary.byOutcome.unknown > 0).map((o) => (
                  <Kpi key={o} label={OUTCOME_META[o].label} value={summary.byOutcome[o]}
                    sub={summary.total ? `${Math.round((summary.byOutcome[o] / summary.total) * 100)}% of ${summary.total} batches` : 'No batches yet'}
                    active={batchOutcome === o} onClick={() => toggleOutcome(o)} />
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Rows imported" value={fmtNum(summary.rowsImported)} sub={`of ${fmtNum(summary.rowsRead)} read, ${fmtPct(summary.importRate)}`} tone="text-green-400" />
                <Kpi label="Rows failed" value={fmtNum(summary.rowsFailed)} sub={`${fmtPct(summary.failRate)} of rows read`} tone="text-red-400" />
                <Kpi label="Repeat files" value={repeatKnown ? summary.repeatFiles : 'N/A'}
                  sub={repeatKnown ? `${summary.repeatUploads} uploads, ${summary.importedTwice} imported twice` : (filesError || 'No file fingerprints recorded')}
                  tone={repeatKnown && summary.repeatFiles ? 'text-amber-400' : undefined}
                  active={repeatOnly} onClick={repeatKnown ? () => setRepeatOnly((v) => !v) : undefined} />
                <Kpi label={`Never approved over ${summary.staleDays} days`} value={summary.staleUnfinished}
                  sub="Uploaded and previewed, nothing written" tone={summary.staleUnfinished ? 'text-amber-400' : undefined} />
              </div>

              <FilterBar
                search={batchSearch}
                onSearch={setBatchSearch}
                searchLabel="Search import history"
                placeholder="Search module, file, country, status, outcome or batch ID"
                resultCount={filteredBatches.length}
                onClearAll={() => { setBatchSearch(''); setBatchStatus(''); setBatchModule(''); setBatchOutcome(''); setRepeatOnly(false) }}
                selects={[
                  { key: 'module', value: batchModule, onChange: setBatchModule, placeholder: 'All modules', options: batchModules.map((value) => ({ value, label: value })) },
                  { key: 'outcome', value: batchOutcome, onChange: setBatchOutcome, placeholder: 'All outcomes', options: OUTCOME_ORDER.map((value) => ({ value, label: OUTCOME_META[value].label })) },
                  { key: 'status', value: batchStatus, onChange: setBatchStatus, placeholder: 'All statuses', options: batchStatuses.map((value) => ({ value, label: value })) },
                ]}
              >
                <label className="text-xs text-secondary inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={repeatOnly} disabled={!repeatKnown} onChange={(e) => setRepeatOnly(e.target.checked)} /> Repeat files only
                </label>
                <button type="button" onClick={doExcel} disabled={!exportRows.length} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--input-border)] inline-flex items-center gap-1.5 disabled:opacity-40"><Download size={13} /> Excel</button>
                <button type="button" onClick={doPdf} disabled={!exportRows.length} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--input-border)] inline-flex items-center gap-1.5 disabled:opacity-40"><FileText size={13} /> PDF</button>
              </FilterBar>

              <PagedTable
                columns={batchColumns}
                pager={batchesPager}
                emptyMessage={batches.length ? 'No imports match these filters.' : t('intakehistory.imports.empty')}
              />

              {recon && reconBatch && (
                <div className="card !p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-secondary font-medium">{t('intakehistory.reconcile.heading')}: <span className="capitalize">{reconBatch.module}</span> {reconBatch.country || ''}</span>
                    <button type="button" onClick={() => setReconId(null)} aria-label="Close reconciliation"><X size={14} className="text-muted" /></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                    {[['expected', recon.expected], ['imported', recon.imported], ['skipped', recon.skipped], ['errors', recon.errors], ['duplicates', recon.duplicates], ['accountedFor', recon.accountedFor]].map(([l, v]) => (
                      <span key={l} className="text-muted">{t(`intakehistory.reconcile.${l}`)}: <span className="text-secondary">{v}</span></span>
                    ))}
                    {recon.variance !== 0 && <span className="text-amber-400">{t('intakehistory.reconcile.variance', { value: recon.variance })}</span>}
                  </div>
                  {recon.balanced ? (
                    <p className="mt-2 text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={13} /> {t('intakehistory.reconcile.allAccounted')}</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {recon.discrepancies.map((d, i) => (
                        <li key={i} className="text-xs text-amber-300 flex items-start gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <div className="card !p-4">
                  <p className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><Copy size={14} className="text-muted" /> Same file uploaded more than once</p>
                  {!repeatKnown ? (
                    <p className="text-xs text-muted">{filesError || 'No uploaded file in scope carries a content fingerprint, so repeats cannot be checked.'}</p>
                  ) : repeatGroups.length === 0 ? (
                    <p className="text-xs text-muted">Every fingerprinted file in scope was uploaded once.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--input-border)]">
                      {repeatGroups.slice(0, 8).map((g) => (
                        <li key={g.sha256} className="py-2 text-xs flex items-center gap-3">
                          <span className="flex-1 min-w-0 truncate text-secondary" title={g.sha256}>{g.fileName || `File ${g.sha256.slice(0, 10)}`}</span>
                          <span className="text-muted">{g.uploads} uploads</span>
                          {g.importedTwice && <span className="px-2 py-0.5 rounded bg-red-900/30 text-red-400">Imported twice</span>}
                          <span className="text-dim">{fmtWhen(g.lastAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {repeatKnown && summary.fingerprintCoverage != null && summary.fingerprintCoverage < 100 && (
                    <p className="text-[11px] text-muted mt-2">{summary.fingerprintCoverage}% of batches in scope carry a file fingerprint; the rest cannot be compared.</p>
                  )}
                </div>
                <div className="card !p-4">
                  <p className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><Layers size={14} className="text-muted" /> By module</p>
                  {modules.length === 0 ? <p className="text-xs text-muted">No batches yet.</p> : (
                    <ul className="divide-y divide-[var(--input-border)]">
                      {modules.slice(0, 10).map((m) => (
                        <li key={m.module} className="py-2 text-xs flex items-center gap-3">
                          <button type="button" onClick={() => setBatchModule(batchModule === m.module ? '' : m.module)} className={`flex-1 text-left capitalize ${batchModule === m.module ? 'text-[var(--text-primary)] font-semibold' : 'text-secondary'}`}>{m.module}</button>
                          <span className="text-muted">{m.batches} batches</span>
                          <span className="text-muted tabular-nums">{fmtNum(m.rowsImported)} of {fmtNum(m.rowsRead)} rows</span>
                          <span className="text-muted w-12 text-right">{fmtPct(m.importRate)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* IMPORTS - drill into one batch's rows */}
          {tab === 'imports' && drill && (
            <div className="space-y-3">
              <button type="button" onClick={() => setDrill(null)} className="text-sm text-muted hover:text-[var(--text-primary)]">{t('intakehistory.drill.back')}</button>
              <p className="text-sm text-secondary capitalize flex items-center gap-2 flex-wrap">{drill.batch.module} <span className="text-dim">|</span> {drill.batch.country || 'N/A'} <span className="text-dim">|</span> <span className={chip(drill.batch.import_status)}>{drill.batch.import_status}</span></p>
              {drill.rows == null ? <div className="py-8 text-center"><Loader2 className="animate-spin mx-auto text-green-400" /></div> : drill.error ? (
                <div role="alert" className="card py-6 px-4 text-center text-sm">
                  <p className="text-red-300 mb-2">{drill.error}</p>
                  <button type="button" onClick={() => openDrill(drill.batch)} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--input-border)] inline-flex items-center gap-1.5"><RefreshCw size={12} /> Retry</button>
                </div>
              ) : (
                <PagedTable columns={drillColumns} pager={drillPager} emptyMessage={t('intakehistory.drill.empty')} maxHeight={448} />
              )}
            </div>
          )}

          {/* QUALITY */}
          {tab === 'quality' && quality && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['imports', quality.total, 'text-[var(--text-primary)]'], ['pendingApproval', quality.pendingApproval, 'text-amber-400'], ['errorRows', quality.errorRows, 'text-red-400'], ['importedRows', quality.importedRows, 'text-green-400']].map(([l, v, c]) => (
                  <div key={l} className="card p-4"><p className="text-xs text-muted">{t(`intakehistory.quality.stats.${l}`)}</p><p className={`text-2xl font-bold tabular-nums ${c}`}>{v}</p></div>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['successRate', `${quality.successRate}%`, 'text-green-400'], ['validationErrorRate', `${quality.validationErrorRate}%`, 'text-red-400'], ['duplicateRate', `${quality.duplicateRate}%`, 'text-amber-400'], ['avgApprovalTime', quality.avgApprovalHours == null ? 'N/A' : `${quality.avgApprovalHours}h`, 'text-[var(--text-primary)]']].map(([l, v, c]) => (
                  <div key={l} className="card p-4"><p className="text-xs text-muted">{t(`intakehistory.quality.stats.${l}`)}</p><p className={`text-2xl font-bold tabular-nums ${c}`}>{v}</p></div>
                ))}
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="card p-4">
                  <p className="text-sm text-muted mb-2">{t('intakehistory.quality.byCountry')}</p>
                  {Object.entries(quality.byCountry).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-secondary">{k}</span><span className="text-muted">{v}</span></div>)}
                </div>
                <div className="card p-4">
                  <p className="text-sm text-muted mb-2">{t('intakehistory.quality.bySource')}</p>
                  {Object.entries(quality.bySource).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-secondary">{k}</span><span className="text-muted">{v}</span></div>)}
                </div>
                <div className="card p-4">
                  <p className="text-sm text-muted mb-2">{t('intakehistory.quality.byModule')}</p>
                  {Object.entries(quality.byModule).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-secondary capitalize">{k}</span><span className="text-muted">{v}</span></div>)}
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="card p-4">
                  <p className="text-sm text-muted mb-2">{t('intakehistory.quality.rowQuality.heading')}</p>
                  {[['warningRows', quality.warningRows], ['duplicateRows', quality.duplicateRows], ['conflictRows', quality.conflictRows], ['skippedRows', quality.skippedRows], ['failedRows', quality.failedRows]].map(([l, v]) => <div key={l} className="flex justify-between text-sm py-0.5"><span className="text-secondary">{t(`intakehistory.quality.rowQuality.${l}`)}</span><span className="text-muted">{v}</span></div>)}
                </div>
                <div className="card p-4">
                  <p className="text-sm text-muted mb-2">{t('intakehistory.quality.topUploaders.heading')}</p>
                  {quality.topUploaders.length === 0 && <p className="text-xs text-dim">{t('intakehistory.quality.topUploaders.empty')}</p>}
                  {quality.topUploaders.map((u) => <div key={u.uploader} className="flex justify-between text-sm py-0.5"><span className="text-secondary truncate max-w-[220px]" title={u.uploader}>{u.uploader}</span><span className="text-muted">{u.count}</span></div>)}
                </div>
              </div>
              <div className="card p-4">
                <p className="text-sm text-muted mb-2">{t('intakehistory.quality.latestImports.heading')}</p>
                {quality.latest.length === 0 && <p className="text-xs text-dim">{t('intakehistory.quality.latestImports.empty')}</p>}
                {quality.latest.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs border-t border-[var(--input-border)] py-1.5 first:border-t-0">
                    <span className="capitalize text-secondary font-medium">{i.module}</span>
                    <span className="text-muted">{i.country || 'N/A'}</span>
                    <span className={chip(i.status)}>{i.status}</span>
                    <span className="text-muted">{t('intakehistory.quality.latestImports.rowsOfTotal', { imported: i.importedRows, total: i.totalRows })}</span>
                    <span className="text-dim ml-auto">{i.createdAt ? new Date(i.createdAt).toLocaleString('en-GB') : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PROFILES */}
          {tab === 'profiles' && (
            <PagedTable columns={profileColumns} pager={profilesPager} emptyMessage={t('intakehistory.profiles.empty')} />
          )}

          {/* CUSTOM FIELDS */}
          {tab === 'custom' && (
            <PagedTable columns={customColumns} pager={customFieldsPager} emptyMessage={t('intakehistory.custom.empty')} />
          )}

          {/* ALIASES */}
          {tab === 'aliases' && (
            <div className="space-y-4">
              <p className="text-xs text-muted">{t('intakehistory.aliases.intro')}</p>
              {isElevated && (
                <div className="card p-4 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">{t('intakehistory.aliases.form.entity')}</label>
                    <select value={aliasForm.entityType} onChange={(e) => setAliasForm((f) => ({ ...f, entityType: e.target.value }))} className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm capitalize">
                      {ALIAS_ENTITY_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs text-muted mb-1">{t('intakehistory.aliases.form.rawValue')}</label>
                    <input value={aliasForm.rawValue} onChange={(e) => setAliasForm((f) => ({ ...f, rawValue: e.target.value }))} placeholder="Qiddiya-1" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs text-muted mb-1">{t('intakehistory.aliases.form.canonicalValue')}</label>
                    <input value={aliasForm.canonicalValue} onChange={(e) => setAliasForm((f) => ({ ...f, canonicalValue: e.target.value }))} placeholder="Qiddiya G1" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm" />
                  </div>
                  <button type="button" onClick={addAlias} disabled={savingAlias || !aliasForm.rawValue.trim() || !aliasForm.canonicalValue.trim()} className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-1.5 disabled:opacity-50">
                    {savingAlias ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t('intakehistory.aliases.addAlias')}
                  </button>
                </div>
              )}
              <PagedTable columns={aliasColumns} pager={aliasesPager} emptyMessage={t('intakehistory.aliases.empty')} />
            </div>
          )}

          {/* FX RATES */}
          {tab === 'fx' && (
            <div className="space-y-4">
              <p className="text-xs text-muted">{t('intakehistory.fx.introPart1')} <span className="text-secondary">{t('intakehistory.fx.introOnly')}</span> {t('intakehistory.fx.introPart2')}</p>
              {isElevated && (
                <div className="card p-4 flex flex-wrap items-end gap-3">
                  <div><label className="block text-xs text-muted mb-1">{t('intakehistory.fx.form.base')}</label><input value={fxForm.baseCurrency} onChange={(e) => setFxForm((f) => ({ ...f, baseCurrency: e.target.value }))} placeholder="USD" maxLength={3} className="w-20 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm uppercase" /></div>
                  <div><label className="block text-xs text-muted mb-1">{t('intakehistory.fx.form.quote')}</label><input value={fxForm.quoteCurrency} onChange={(e) => setFxForm((f) => ({ ...f, quoteCurrency: e.target.value }))} placeholder="SAR" maxLength={3} className="w-20 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm uppercase" /></div>
                  <div><label className="block text-xs text-muted mb-1">{t('intakehistory.fx.form.rate')}</label><input type="number" step="0.00000001" value={fxForm.rate} onChange={(e) => setFxForm((f) => ({ ...f, rate: e.target.value }))} placeholder="0.2667" className="w-28 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm" /></div>
                  <div><label className="block text-xs text-muted mb-1">{t('intakehistory.fx.form.date')}</label><input type="date" value={fxForm.rateDate} onChange={(e) => setFxForm((f) => ({ ...f, rateDate: e.target.value }))} className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm" /></div>
                  <div><label className="block text-xs text-muted mb-1">{t('intakehistory.fx.form.source')}</label><input value={fxForm.source} onChange={(e) => setFxForm((f) => ({ ...f, source: e.target.value }))} placeholder="manual" className="w-28 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-sm" /></div>
                  <button type="button" onClick={addFxRate} disabled={savingFx || !fxForm.baseCurrency.trim() || !fxForm.quoteCurrency.trim() || !(Number(fxForm.rate) > 0) || !fxForm.rateDate} className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-1.5 disabled:opacity-50">{savingFx ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t('intakehistory.fx.addDraft')}</button>
                </div>
              )}
              <PagedTable columns={fxColumns} pager={fxRatesPager} emptyMessage={t('intakehistory.fx.empty')} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

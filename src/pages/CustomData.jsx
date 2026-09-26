/**
 * Custom Data Manager
 *
 * Every column in every uploaded file is saved - nothing is ever lost.
 * Columns that don't match a standard field land in extra_fields JSONB.
 * This page makes all of that data visible, searchable, exportable,
 * and promotable to permanent field synonyms so future uploads auto-map them.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import * as customData from '../lib/api/customData'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import {
  Database, Search, Plus, Trash2, Check, X, ArrowRight,
  Download, RefreshCw, Eye, Layers, Tag, Link2, AlertTriangle, Info, Zap, Hash,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { exportToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import {
  summarizeCustomData, filterFieldStats, filterSynonyms, flattenForExport, pageCount,
} from '../lib/customDataAnalytics'

// Canonical tyre_records fields the user can map to
const CANONICAL_FIELDS = [
  { key: 'sr',          label: 'Row / SR No.' },
  { key: 'issue_date',  label: 'Issue Date' },
  { key: 'description', label: 'Description' },
  { key: 'brand',       label: 'Brand' },
  { key: 'serial_no',   label: 'Serial Number' },
  { key: 'qty',         label: 'Quantity' },
  { key: 'job_card',    label: 'Job Card' },
  { key: 'mis_number',  label: 'MIS Number' },
  { key: 'asset_no',    label: 'Asset / Vehicle No.' },
  { key: 'site',        label: 'Site / Location' },
  { key: 'country',     label: 'Country' },
  { key: 'remarks',     label: 'Remarks / Notes' },
  { key: 'cost_per_tyre', label: 'Cost Per Tyre' },
  { key: 'driver_name', label: 'Driver Name' },
  { key: 'supplier',    label: 'Supplier' },
  { key: 'size',        label: 'Tyre Size' },
  { key: 'position',    label: 'Tyre Position' },
  { key: 'tread_depth', label: 'Tread Depth (mm)' },
  { key: 'pressure_reading', label: 'Pressure (PSI)' },
]

const TABS = ['fields', 'synonyms', 'records']

export default function CustomData() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const { t } = useLanguage()

  const [tab, setTab]             = useState(0)
  const [fieldStats, setFieldStats] = useState([])   // [{ field_key, record_count, sample_vals }]
  const [synonyms, setSynonyms]   = useState([])
  const [records, setRecords]     = useState([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [synLoading, setSynLoading] = useState(true)
  const [recLoading, setRecLoading] = useState(false)

  const [statsError, setStatsError] = useState('')
  const [synError, setSynError]     = useState('')
  const [recordCount, setRecordCount] = useState(null)
  const [exporting, setExporting]   = useState(false)
  const [exportMsg, setExportMsg]   = useState(null)
  const [backfillError, setBackfillError] = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)

  // Field stats filters
  const [statsSearch, setStatsSearch] = useState('')
  const [statsMapping, setStatsMapping] = useState('all')
  const [synSearch, setSynSearch] = useState('')

  // Records tab
  const [filterKey, setFilterKey]   = useState('')
  const [filterVal, setFilterVal]   = useState('')
  const [recPage, setRecPage]       = useState(0)
  const REC_PAGE_SIZE = 20

  // Add synonym form
  const [newCustom, setNewCustom]   = useState('')
  const [newMapsTo, setNewMapsTo]   = useState('')
  const [addError, setAddError]     = useState('')
  const [addSaving, setAddSaving]   = useState(false)

  // Delete synonym confirmation
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError]   = useState('')
  const [deleting, setDeleting]         = useState(false)

  // Promote from custom field
  const [promoteKey, setPromoteKey] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState('')

  // Backfill panel
  const [backfillKey, setBackfillKey]    = useState(null)
  const [backfillTarget, setBackfillTarget] = useState('')
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)

  // ── Loaders ─────────────────────────────────────────────────────────────────

  const loadFieldStats = useCallback(async () => {
    setLoading(true)
    setStatsError('')
    const country = activeCountry !== 'All' ? activeCountry : null
    try {
      const [data, head] = await Promise.all([
        customData.getExtraFieldStats({ country }),
        // One-row read for the exact count of records carrying custom data.
        customData.listRecordsWithExtraFields({ country: activeCountry, from: 0, to: 0 }).catch(() => null),
      ])
      setFieldStats(data ?? [])
      setRecordCount(head ? head.count : null)
    } catch (error) {
      // A failed read is not "no custom fields": keep the error on screen.
      setFieldStats([])
      setRecordCount(null)
      setStatsError(toUserMessage(error, 'Could not read the custom field summary.'))
    }
    setLoading(false)
  }, [activeCountry])

  const loadSynonyms = useCallback(async () => {
    setSynLoading(true)
    setSynError('')
    try {
      const data = await customData.listFieldSynonyms()
      setSynonyms(data ?? [])
    } catch (error) {
      setSynonyms([])
      setSynError(toUserMessage(error, 'Could not read the synonyms.'))
    }
    setSynLoading(false)
  }, [])

  const loadRecords = useCallback(async () => {
    setRecLoading(true)
    try {
      const { data, count } = await customData.listRecordsWithExtraFields({
        country: activeCountry,
        filterKey,
        filterVal,
        from: recPage * REC_PAGE_SIZE,
        to: (recPage + 1) * REC_PAGE_SIZE - 1,
      })
      setRecords(data ?? [])
      setTotalRecords(count ?? 0)
    } catch {
      setRecords([])
      setTotalRecords(0)
    }
    setRecLoading(false)
  }, [activeCountry, filterKey, filterVal, recPage])

  useEffect(() => { loadFieldStats() }, [loadFieldStats])
  useEffect(() => { loadSynonyms() }, [loadSynonyms])
  useEffect(() => { if (tab === 2) loadRecords() }, [tab, loadRecords])

  // ── Synonym CRUD ─────────────────────────────────────────────────────────────

  async function addSynonym(customName, mapsTo) {
    if (!customName.trim() || !mapsTo) { setAddError(t('customdata.synonyms.add.errorBothRequired')); return }
    setAddSaving(true); setAddError('')
    try {
      await customData.createFieldSynonym({
        custom_name:  customName.trim(),
        maps_to:      mapsTo,
        table_target: 'tyre_records',
        created_by:   profile?.id,
        use_count:    0,
      })
      setNewCustom(''); setNewMapsTo(''); await loadSynonyms()
    } catch (error) {
      setAddError(toUserMessage(error, 'Could not save. Please try again.'))
    }
    setAddSaving(false)
  }

  function confirmDeleteSynonym(synonym) {
    setDeleteTarget(synonym)
    setDeleteError('')
  }

  function closeDeleteSynonym() {
    setDeleteTarget(null)
    setDeleteError('')
  }

  async function deleteSynonym() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const { data, error } = await supabase
        .from('field_synonyms').delete().eq('id', deleteTarget.id).select('id')
      if (error) throw error
      if ((data?.length ?? 0) === 0) {
        throw new Error(t('customdata.synonyms.delete.errNotDeleted'))
      }
      setSynonyms(s => s.filter(x => x.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setDeleteError(toUserMessage(e, t('customdata.synonyms.delete.errFailed')))
    } finally {
      setDeleting(false)
    }
  }

  // Promote a custom field key to a permanent synonym
  async function promote(fieldKey, mapsTo) {
    if (!mapsTo) return
    await addSynonym(fieldKey, mapsTo)
    setPromoteKey(null)
    setPromoteTarget('')
  }

  // ── Backfill: copy extra_fields value → canonical column ──────────────────

  async function runBackfill() {
    if (!backfillKey || !backfillTarget) return
    setBackfillRunning(true)
    setBackfillResult(null)
    setBackfillError('')

    // Fetch ALL records where this extra_field exists but canonical column is null
    const { data: batch, error } = await customData.listTyreRecordsForBackfill({
      fieldKey: backfillKey,
      target: backfillTarget,
    })

    if (error) {
      setBackfillError(toUserMessage(error, 'Could not read the records to copy.'))
      setBackfillRunning(false)
      return
    }

    let updated = 0
    let failed = 0
    const CHUNK = 200
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK)
      // Update each record - set canonical field = extra_fields value (dynamic key).
      // Settled per row so one refused write is counted, not hidden behind the rest.
      const results = await Promise.allSettled(slice.map(r =>
        customData.updateTyreRecordFields(r.id, { [backfillTarget]: r.extra_fields[backfillKey] })
      ))
      for (const res of results) { if (res.status === 'fulfilled') updated += 1; else failed += 1 }
    }

    setBackfillResult({ updated, total: batch.length })
    if (failed) setBackfillError(`${failed.toLocaleString()} record${failed === 1 ? '' : 's'} could not be updated.`)
    setBackfillRunning(false)
    loadFieldStats()
  }

  // ── Export extra_fields data ──────────────────────────────────────────────

  async function exportExtraFields() {
    setExporting(true)
    setExportMsg(null)
    try {
      const { data, error } = await customData.listTyreRecordsForExport()
      if (error) throw error
      if (!data?.length) {
        setExportMsg({ type: 'info', text: 'There are no records with custom data to export.' })
        return
      }
      const { rows, columns, headers } = flattenForExport(data)
      await exportToExcel(rows, columns, headers, reportFileName('Custom Data', activeCountry, reportDateLabel()), 'Custom Data')
    } catch (error) {
      setExportMsg({ type: 'err', text: toUserMessage(error, 'Could not export the custom data.') })
    } finally {
      setExporting(false)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filteredStats = useMemo(
    () => filterFieldStats(fieldStats, { search: statsSearch, mapping: statsMapping, synonyms }),
    [fieldStats, statsSearch, statsMapping, synonyms],
  )
  const filteredSynonyms = useMemo(() => filterSynonyms(synonyms, synSearch), [synonyms, synSearch])
  const statsPager = usePagedRows(filteredStats)
  const synonymsPager = usePagedRows(filteredSynonyms)
  const summary = useMemo(
    () => summarizeCustomData({ fieldStats, synonyms, recordCount }),
    [fieldStats, synonyms, recordCount],
  )

  // Check if a custom field key already has a synonym
  const synonymMap = useMemo(() => {
    const m = {}
    synonyms.forEach(s => { m[s.custom_name.toLowerCase()] = s })
    return m
  }, [synonyms])

  const totalPages = pageCount(totalRecords, REC_PAGE_SIZE)
  const fieldLabel = useCallback(
    (key) => (CANONICAL_FIELDS.find(f => f.key === key) ? t(`customdata.fields.${key}`) : key),
    [t],
  )

  const synonymColumns = useMemo(() => [
    { id: 'custom_name', header: t('customdata.synonyms.table.columnName'), accessorKey: 'custom_name',
      cell: ({ getValue }) => <span className="font-mono text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'maps_to', header: t('customdata.synonyms.table.mapsTo'), accessorFn: (s) => fieldLabel(s.maps_to),
      cell: ({ getValue }) => (
        <span className="flex items-center gap-1.5">
          <ArrowRight size={12} className="text-[var(--text-dim)]" aria-hidden="true" />
          <span className="font-medium text-[var(--text-secondary)]">{getValue()}</span>
        </span>
      ) },
    { id: 'use_count', header: t('customdata.synonyms.table.timesUsed'), accessorFn: (s) => Number(s.use_count) || 0, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-muted)]">{getValue().toLocaleString()}</span> },
    { id: 'last_used_at', header: t('customdata.synonyms.table.lastUsed'), accessorFn: (s) => s.last_used_at || '',
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)]">{row.original.last_used_at ? formatDate(row.original.last_used_at) : t('customdata.synonyms.table.never')}</span> },
    { id: 'actions', header: '', enableSorting: false, meta: { export: false }, size: 64,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => confirmDeleteSynonym(row.original)}
          aria-label={`Delete synonym ${row.original.custom_name}`}
          className="min-w-[44px] min-h-[44px] grid place-items-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) },
  ], [t, fieldLabel])

  const recordColumns = useMemo(() => [
    { id: 'asset_no', header: t('customdata.records.table.assetNo'), accessorFn: (r) => r.asset_no ?? 'N/A',
      cell: ({ getValue }) => <span className="font-mono text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'serial_no', header: t('customdata.records.table.serialNo'), accessorFn: (r) => r.serial_no ?? 'N/A',
      cell: ({ getValue }) => <span className="font-mono text-[var(--text-secondary)]">{getValue()}</span> },
    { id: 'issue_date', header: t('customdata.records.table.date'), accessorFn: (r) => r.issue_date ?? 'N/A' },
    { id: 'site', header: t('customdata.records.table.site'), accessorFn: (r) => r.site ?? 'N/A' },
    { id: 'custom', header: t('customdata.records.table.customFields'), enableSorting: false,
      accessorFn: (r) => Object.entries(r.extra_fields ?? {}).map(([k, v]) => `${k}: ${v}`).join('; '),
      cell: ({ row }) => {
        const ef = row.original.extra_fields ?? {}
        const keys = Object.keys(ef)
        return (
          <div className="flex flex-wrap gap-1">
            {keys.slice(0, 3).map(k => (
              <span key={k} className="bg-[var(--input-bg)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full text-xs max-w-[160px] truncate" title={`${k}: ${ef[k]}`}>
                <span className="font-medium text-[var(--text-primary)]">{k}</span>: {String(ef[k])}
              </span>
            ))}
            {keys.length > 3 && <span className="text-[var(--text-dim)] text-xs">{t('customdata.records.table.moreCount', { count: keys.length - 3 })}</span>}
          </div>
        )
      } },
  ], [t])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('customdata.title')}
        subtitle={t('customdata.subtitle')}
        icon={Database}
        actions={
          <button type="button" onClick={exportExtraFields} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-50">
            {exporting ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} {t('customdata.actions.exportAll')}
          </button>
        }
      />

      {exportMsg && (
        <div role="status" className={`text-sm rounded-lg px-3 py-2 border ${exportMsg.type === 'err' ? 'bg-red-900/25 border-red-700/40 text-red-300' : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
          {exportMsg.text}
        </div>
      )}

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile index={0} icon={Layers} tone="info" label={t('customdata.stats.uniqueFields')} value={statsError ? 'N/A' : summary.uniqueFields.toLocaleString()} sub={statsError ? 'Could not be read' : `${summary.unmappedFields.toLocaleString()} not yet mapped`} />
        <StatTile index={1} icon={Database} tone="accent" label={t('customdata.stats.recordsWithCustomData')} value={summary.recordCount == null ? 'N/A' : summary.recordCount.toLocaleString()} sub={summary.recordCount == null ? 'Count unavailable' : 'Distinct tyre records'} />
        <StatTile index={2} icon={Hash} tone="neutral" label="Custom values captured" value={statsError ? 'N/A' : summary.fieldValues.toLocaleString()} sub="One record can carry several" />
        <StatTile index={3} icon={Tag} tone="neutral" label={t('customdata.stats.permanentSynonyms')} value={synError ? 'N/A' : summary.synonyms.toLocaleString()} sub={summary.mappedShare == null ? 'No custom fields yet' : `${Math.round(summary.mappedShare * 100)}% of fields mapped`} />
        <StatTile index={4} icon={Link2} tone="neutral" label={t('customdata.stats.autoMappedOnUpload')} value={synError ? 'N/A' : summary.autoMapped.toLocaleString()} />
      </div>

      {/* ── How it works banner ── */}
      <div className="card">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-[var(--accent)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{t('customdata.banner.title')}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {t('customdata.banner.bodyPart1')}<strong className="text-[var(--text-secondary)]">{t('customdata.banner.customData')}</strong>{t('customdata.banner.bodyPart2')}<strong className="text-[var(--text-secondary)]">{t('customdata.banner.permanentSynonym')}</strong>{t('customdata.banner.bodyPart3')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="Custom data sections" className="flex flex-wrap gap-1 bg-[var(--surface-1)]/60 rounded-xl p-1 w-fit max-w-full border border-[var(--input-border)]">
        {TABS.map((tabKey, i) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            className={`px-4 min-h-[44px] rounded-lg text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
              tab === i ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {t(`customdata.tabs.${tabKey}`)}
            {i === 0 && fieldStats.length > 0 && (
              <span className="ml-2 text-xs bg-[var(--input-bg)] text-[var(--text-secondary)] px-1.5 py-0.5 rounded-full">{fieldStats.length}</span>
            )}
            {i === 1 && synonyms.length > 0 && (
              <span className="ml-2 text-xs bg-[var(--input-bg)] text-[var(--text-secondary)] px-1.5 py-0.5 rounded-full">{synonyms.length}</span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ══ TAB 0: Custom Fields ══════════════════════════════════════════════ */}
        {tab === 0 && (
          <motion.div key="fields" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }} className="space-y-4">

            {/* Search + refresh */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  aria-label="Search custom fields"
                  className="input pl-8 text-sm w-full"
                  placeholder={t('customdata.customFields.searchPlaceholder')}
                  value={statsSearch}
                  onChange={e => setStatsSearch(e.target.value)}
                />
              </div>
              <select aria-label="Mapping state" className="input text-sm w-auto min-h-[44px]" value={statsMapping} onChange={e => setStatsMapping(e.target.value)}>
                <option value="all">All fields</option>
                <option value="unmapped">Not yet mapped</option>
                <option value="mapped">Mapped to a field</option>
              </select>
              <button type="button" onClick={loadFieldStats} aria-label="Refresh custom fields" className="btn-secondary min-w-[44px] min-h-[44px] grid place-items-center"><RefreshCw size={14} aria-hidden="true" /></button>
              <span className="text-xs text-[var(--text-muted)]">{filteredStats.length.toLocaleString()} of {fieldStats.length.toLocaleString()} fields</span>
            </div>

            {statsError ? (
              <div role="alert" className="card text-center py-12">
                <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" aria-hidden="true" />
                <p className="text-[var(--text-primary)] font-medium">Custom fields could not be read</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">{statsError}</p>
                <button type="button" onClick={loadFieldStats} className="btn-secondary mt-4 min-h-[44px]">Retry</button>
              </div>
            ) : loading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="card space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[var(--input-bg)]/40 animate-pulse" />
                        <div className="h-4 w-32 rounded bg-[var(--input-bg)]/40 animate-pulse" />
                      </div>
                      <div className="h-3 w-20 rounded bg-[var(--input-bg)]/40 animate-pulse" />
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {Array.from({ length: 3 }).map((_, j) => (
                        <div key={j} className="h-5 w-16 rounded-full bg-[var(--input-bg)]/40 animate-pulse" />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <div className="h-7 w-28 rounded-lg bg-[var(--input-bg)]/40 animate-pulse" />
                      <div className="h-7 w-24 rounded-lg bg-[var(--input-bg)]/40 animate-pulse" />
                      <div className="h-7 w-24 rounded-lg bg-[var(--input-bg)]/40 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredStats.length === 0 ? (
              <div className="card text-center py-16">
                <Database size={32} className="text-[var(--text-dim)] mx-auto mb-3" aria-hidden="true" />
                {fieldStats.length > 0 ? (
                  <>
                    <p className="text-[var(--text-muted)] font-medium">No custom field matches these filters.</p>
                    <button type="button" onClick={() => { setStatsSearch(''); setStatsMapping('all') }} className="btn-secondary mt-4 min-h-[44px]">Clear filters</button>
                  </>
                ) : (
                  <>
                    <p className="text-[var(--text-muted)] font-medium">{t('customdata.customFields.empty.title')}</p>
                    <p className="text-[var(--text-dim)] text-sm mt-1">{t('customdata.customFields.empty.body')}</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {statsPager.pageRows.map(stat => {
                  const hasSynonym = synonymMap[stat.field_key.toLowerCase()]
                  const isPromoting = promoteKey === stat.field_key
                  const isBackfilling = backfillKey === stat.field_key

                  return (
                    <motion.div
                      key={stat.field_key}
                      layout
                      className={`card transition-all ${hasSynonym ? 'border-green-800/40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hasSynonym ? 'bg-green-500' : 'bg-blue-500'}`} />
                          <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{stat.field_key}</span>
                          {hasSynonym && (
                            <span className="text-xs bg-green-900/50 text-green-300 border border-green-700/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Check size={10} /> {t('customdata.customFields.autoMapsTo')} <strong>{hasSynonym.maps_to}</strong>
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[var(--text-muted)] flex-shrink-0">{t('customdata.customFields.recordsCount', { count: Number(stat.record_count).toLocaleString() })}</span>
                      </div>

                      {/* Sample values */}
                      {stat.sample_vals?.filter(Boolean).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {stat.sample_vals.filter(Boolean).slice(0, 5).map((v, i) => (
                            <span key={i} className="text-xs bg-[var(--input-bg)]/80 text-[var(--text-secondary)] px-2 py-0.5 rounded-full max-w-[160px] truncate">{v}</span>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      {!isPromoting && !isBackfilling && (
                        <div className="flex flex-wrap gap-2">
                          {!hasSynonym && (
                            <button
                              onClick={() => { setPromoteKey(stat.field_key); setPromoteTarget('') }}
                              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-900/30 text-purple-300 border border-purple-700/40 hover:bg-purple-900/50"
                            >
                              <Link2 size={11} /> {t('customdata.customFields.actions.createSynonym')}
                            </button>
                          )}
                          <button
                            onClick={() => { setBackfillKey(stat.field_key); setBackfillTarget(''); setBackfillResult(null) }}
                            className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/30 text-blue-300 border border-blue-700/40 hover:bg-blue-900/50"
                          >
                            <ArrowRight size={11} /> {t('customdata.customFields.actions.copyToField')}
                          </button>
                          <button
                            onClick={() => { setFilterKey(stat.field_key); setFilterVal(''); setTab(2) }}
                            className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--input-bg)]/50 text-[var(--text-secondary)] border border-[var(--input-border)] hover:bg-[var(--input-bg-hover)]"
                          >
                            <Eye size={11} /> {t('customdata.customFields.actions.browseRecords')}
                          </button>
                        </div>
                      )}

                      {/* Promote panel */}
                      {isPromoting && (
                        <div className="mt-2 p-3 rounded-lg bg-purple-900/20 border border-purple-700/40 space-y-2">
                          <p className="text-xs text-purple-300 font-medium">{t('customdata.customFields.promote.promptBefore')}<span className="font-mono">{stat.field_key}</span>{t('customdata.customFields.promote.promptAfter')}</p>
                          <select className="input text-xs w-full" value={promoteTarget} onChange={e => setPromoteTarget(e.target.value)}>
                            <option value="">{t('customdata.customFields.promote.choose')}</option>
                            {CANONICAL_FIELDS.map(f => <option key={f.key} value={f.key}>{t(`customdata.fields.${f.key}`)}</option>)}
                          </select>
                          <div className="flex gap-2">
                            <button onClick={() => promote(stat.field_key, promoteTarget)} disabled={!promoteTarget} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40">{t('customdata.customFields.promote.save')}</button>
                            <button onClick={() => setPromoteKey(null)} className="btn-secondary text-xs py-1.5 px-3">{t('customdata.customFields.promote.cancel')}</button>
                          </div>
                        </div>
                      )}

                      {/* Backfill panel */}
                      {isBackfilling && (
                        <div className="mt-2 p-3 rounded-lg bg-blue-900/20 border border-blue-700/40 space-y-2">
                          <p className="text-xs text-blue-300 font-medium">
                            {t('customdata.customFields.backfill.promptBefore')}<span className="font-mono">{stat.field_key}</span>{t('customdata.customFields.backfill.promptAfter')}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">{t('customdata.customFields.backfill.hint')}</p>
                          <select className="input text-xs w-full" value={backfillTarget} onChange={e => setBackfillTarget(e.target.value)}>
                            <option value="">{t('customdata.customFields.backfill.chooseTarget')}</option>
                            {CANONICAL_FIELDS.map(f => <option key={f.key} value={f.key}>{t(`customdata.fields.${f.key}`)}</option>)}
                          </select>
                          {backfillError && <p role="alert" className="text-xs text-red-300">{backfillError}</p>}
                          {backfillResult && (
                            <p className="text-xs text-green-300 flex items-center gap-1"><Check size={11} aria-hidden="true" /> {t('customdata.customFields.backfill.result', { count: backfillResult.updated.toLocaleString() })}</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={runBackfill}
                              disabled={!backfillTarget || backfillRunning}
                              className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1.5"
                            >
                              {backfillRunning ? <><RefreshCw size={11} className="animate-spin" /> {t('customdata.customFields.backfill.running')}</> : t('customdata.customFields.backfill.run')}
                            </button>
                            <button onClick={() => { setBackfillKey(null); setBackfillResult(null); setBackfillError('') }} className="btn-secondary text-xs py-1.5 px-3">{t('customdata.customFields.backfill.done')}</button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )
                })}
                <TablePagination {...statsPager} />
              </div>
            )}
          </motion.div>
        )}

        {/* ══ TAB 1: Synonyms ══════════════════════════════════════════════════ */}
        {tab === 1 && (
          <motion.div key="synonyms" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }} className="space-y-4">

            {/* Add new synonym */}
            <div className="card border-green-800/40">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Plus size={14} className="text-green-400" /> {t('customdata.synonyms.add.title')}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {t('customdata.synonyms.add.description')}
              </p>
              {addError && <p className="text-xs text-red-400 mb-2">{addError}</p>}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[180px]">
                  <label className="label text-xs">{t('customdata.synonyms.add.columnNameLabel')}</label>
                  <input className="input text-sm" placeholder={t('customdata.synonyms.add.columnNamePlaceholder')}
                    value={newCustom} onChange={e => { setNewCustom(e.target.value); setAddError('') }} />
                </div>
                <div className="text-[var(--text-muted)] self-center pt-4"><ArrowRight size={16} /></div>
                <div className="flex-1 min-w-[180px]">
                  <label className="label text-xs">{t('customdata.synonyms.add.mapsToLabel')}</label>
                  <select className="input text-sm" value={newMapsTo} onChange={e => setNewMapsTo(e.target.value)}>
                    <option value="">{t('customdata.synonyms.add.select')}</option>
                    {CANONICAL_FIELDS.map(f => <option key={f.key} value={f.key}>{t(`customdata.fields.${f.key}`)}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => addSynonym(newCustom, newMapsTo)}
                  disabled={addSaving || !newCustom.trim() || !newMapsTo}
                  className="btn-primary disabled:opacity-40 flex items-center gap-2 self-end"
                >
                  {addSaving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  {t('customdata.synonyms.add.save')}
                </button>
              </div>
            </div>

            {/* Synonym list */}
            {synError ? (
              <div role="alert" className="card text-center py-12">
                <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" aria-hidden="true" />
                <p className="text-[var(--text-primary)] font-medium">Synonyms could not be read</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">{synError}</p>
                <button type="button" onClick={loadSynonyms} className="btn-secondary mt-4 min-h-[44px]">Retry</button>
              </div>
            ) : !synLoading && synonyms.length === 0 ? (
              <div className="card text-center py-12">
                <Tag size={28} className="text-[var(--text-dim)] mx-auto mb-3" aria-hidden="true" />
                <p className="text-[var(--text-muted)] font-medium">{t('customdata.synonyms.empty.title')}</p>
                <p className="text-[var(--text-dim)] text-sm mt-1">{t('customdata.synonyms.empty.body')}</p>
              </div>
            ) : (
              <div className="card space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                    <input aria-label="Search synonyms" className="input pl-8 text-sm w-full" placeholder="Search column or field" value={synSearch} onChange={e => setSynSearch(e.target.value)} />
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">{filteredSynonyms.length.toLocaleString()} of {synonyms.length.toLocaleString()} synonyms</span>
                </div>
                <EnterpriseTable
                  columns={synonymColumns}
                  data={synonymsPager.pageRows}
                  getRowId={(s) => String(s.id)}
                  loading={synLoading}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  exportFileName={reportFileName('Custom Data synonyms', reportDateLabel())}
                  virtual
                  maxHeight={560}
                  emptyMessage="No synonym matches this search."
                />
                <TablePagination {...synonymsPager} />
              </div>
            )}

            {/* How synonyms work */}
            <div className="card border-[var(--input-border)]/40 bg-[var(--input-bg)]/20">
              <div className="flex items-start gap-3">
                <Zap size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[var(--text-secondary)] mb-1">{t('customdata.synonyms.info.title')}</p>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    {t('customdata.synonyms.info.body')}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ══ TAB 2: Browse Records ═════════════════════════════════════════════ */}
        {tab === 2 && (
          <motion.div key="records" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }} className="space-y-4">

            {/* Filters */}
            <div className="card">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[180px]">
                  <label htmlFor="cd-filter-key" className="label text-xs">{t('customdata.records.filters.byFieldLabel')}</label>
                  <select id="cd-filter-key" className="input text-sm" value={filterKey} onChange={e => { setFilterKey(e.target.value); setFilterVal(''); setRecPage(0) }}>
                    <option value="">{t('customdata.records.filters.allFields')}</option>
                    {fieldStats.map(f => <option key={f.field_key} value={f.field_key}>{f.field_key} ({Number(f.record_count).toLocaleString()})</option>)}
                  </select>
                </div>
                {filterKey && (
                  <div className="flex-1 min-w-[180px]">
                    <label htmlFor="cd-filter-val" className="label text-xs">{t('customdata.records.filters.valueLabel')}</label>
                    <input id="cd-filter-val" className="input text-sm" placeholder={t('customdata.records.filters.valuePlaceholder')}
                      value={filterVal} onChange={e => { setFilterVal(e.target.value); setRecPage(0) }} />
                  </div>
                )}
                <button type="button" onClick={() => { setFilterKey(''); setFilterVal(''); setRecPage(0) }} className="btn-secondary text-xs self-end flex items-center gap-1.5 min-h-[44px]">
                  <X size={12} /> {t('customdata.records.filters.clear')}
                </button>
                <button type="button" onClick={exportExtraFields} disabled={exporting} className="btn-secondary text-xs self-end flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
                  <Download size={12} aria-hidden="true" /> {t('customdata.records.filters.export')}
                </button>
              </div>
            </div>

            {/* Records table (server-paged: only this page is loaded) */}
            <div className="card space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                <span className="text-[var(--text-primary)] font-semibold">{totalRecords.toLocaleString()}</span> {t('customdata.records.countSuffix')}
                <span className="ml-2 text-xs">Select a row to see all of its custom values.</span>
              </p>
              <EnterpriseTable
                columns={recordColumns}
                data={records}
                getRowId={(r) => String(r.id)}
                loading={recLoading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                manualPagination
                pageIndex={recPage}
                pageCount={totalPages}
                totalRows={totalRecords}
                pageSize={REC_PAGE_SIZE}
                pageSizeOptions={[REC_PAGE_SIZE]}
                onPageChange={(p) => { setRecPage(p); setSelectedRecord(null) }}
                onRowClick={(r) => setSelectedRecord((cur) => (cur?.id === r.id ? null : r))}
                emptyMessage={filterKey ? 'No record carries this custom field value.' : t('customdata.records.empty')}
              />
              {selectedRecord && (
                <div className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      Custom values for {selectedRecord.asset_no ?? 'N/A'} {selectedRecord.serial_no ? `| ${selectedRecord.serial_no}` : ''}
                    </p>
                    <button type="button" onClick={() => setSelectedRecord(null)} aria-label="Close record details" className="min-w-[44px] min-h-[44px] grid place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {Object.entries(selectedRecord.extra_fields ?? {}).map(([k, v]) => (
                      <div key={k} className="bg-[var(--surface-1)]/60 rounded-lg px-3 py-2 border border-[var(--input-border)]/40">
                        <p className="text-[var(--text-primary)] text-xs font-medium truncate" title={k}>{k}</p>
                        <p className="text-[var(--text-secondary)] text-xs mt-0.5 break-all">{String(v)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* ── Delete Synonym Confirmation ─────────────────────────────────────── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => { if (!deleting) closeDeleteSynonym() }}
        >
          <div
            className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl w-full max-w-lg p-6 my-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('customdata.synonyms.delete.title')}</h2>
              <button type="button" onClick={closeDeleteSynonym} aria-label="Close" className="min-w-[44px] min-h-[44px] grid place-items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} aria-hidden="true" /></button>
            </div>
            <div className="flex gap-3 mb-4">
              <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[var(--text-primary)] font-medium">
                  {t('customdata.synonyms.delete.questionBefore')}
                  <span className="font-mono text-yellow-300">{deleteTarget.custom_name}</span>
                  {t('customdata.synonyms.delete.questionAfter')}
                </p>
                <p className="text-[var(--text-muted)] text-sm mt-1">
                  {t('customdata.synonyms.delete.warningBefore')}
                  <span className="text-green-300 font-medium">
                    {CANONICAL_FIELDS.find(f => f.key === deleteTarget.maps_to) ? t(`customdata.fields.${deleteTarget.maps_to}`) : deleteTarget.maps_to}
                  </span>
                  {t('customdata.synonyms.delete.warningAfter')}
                </p>
              </div>
            </div>
            {deleteError && (
              <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={deleteSynonym} disabled={deleting} className="btn-danger flex items-center gap-2 disabled:opacity-50">
                <Trash2 size={15} /> {deleting ? t('customdata.synonyms.delete.deleting') : t('customdata.synonyms.delete.confirm')}
              </button>
              <button onClick={closeDeleteSynonym} disabled={deleting} className="btn-secondary disabled:opacity-50">{t('customdata.synonyms.delete.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


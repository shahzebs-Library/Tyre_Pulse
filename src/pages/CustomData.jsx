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
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import {
  Database, Search, Plus, Trash2, Check, X, ArrowRight,
  ChevronRight, Download, RefreshCw, Eye, EyeOff, Filter,
  Layers, Tag, Link2, AlertTriangle, Info, Zap, BookOpen,
  FileSpreadsheet, ChevronDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

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
  const [synLoading, setSynLoading] = useState(false)
  const [recLoading, setRecLoading] = useState(false)

  // Field stats filters
  const [statsSearch, setStatsSearch] = useState('')

  // Records tab
  const [filterKey, setFilterKey]   = useState('')
  const [filterVal, setFilterVal]   = useState('')
  const [recPage, setRecPage]       = useState(0)
  const [expandedRows, setExpandedRows] = useState(new Set())
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

  useEffect(() => { loadFieldStats() }, [activeCountry])
  useEffect(() => { loadSynonyms() }, [])
  useEffect(() => { if (tab === 2) loadRecords() }, [tab, filterKey, filterVal, recPage, activeCountry])

  // ── Loaders ─────────────────────────────────────────────────────────────────

  async function loadFieldStats() {
    setLoading(true)
    const country = activeCountry !== 'All' ? activeCountry : null
    try {
      const data = await customData.getExtraFieldStats({ country })
      setFieldStats(data ?? [])
    } catch {
      setFieldStats([])
    }
    setLoading(false)
  }

  async function loadSynonyms() {
    setSynLoading(true)
    try {
      const data = await customData.listFieldSynonyms()
      setSynonyms(data ?? [])
    } catch {
      setSynonyms([])
    }
    setSynLoading(false)
  }

  async function loadRecords() {
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
  }

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
      setAddError(error.message)
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
      setDeleteError(e.message || t('customdata.synonyms.delete.errFailed'))
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

    // Fetch ALL records where this extra_field exists but canonical column is null
    const { data: batch, error } = await customData.listTyreRecordsForBackfill({
      fieldKey: backfillKey,
      target: backfillTarget,
    })

    if (error) { setBackfillRunning(false); return }

    let updated = 0
    const CHUNK = 200
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK)
      // Update each record - set canonical field = extra_fields value (dynamic key)
      await Promise.all(slice.map(r =>
        customData.updateTyreRecordFields(r.id, { [backfillTarget]: r.extra_fields[backfillKey] })
      ))
      updated += slice.length
    }

    setBackfillResult({ updated, total: batch.length })
    setBackfillRunning(false)
    loadFieldStats()
  }

  // ── Export extra_fields data ──────────────────────────────────────────────

  async function exportExtraFields() {
    const XLSX = await import('xlsx')
    // Fetch ALL records with extra_fields
    const { data } = await customData.listTyreRecordsForExport()

    if (!data?.length) return

    // Flatten: each row = standard fields + all extra_fields keys spread out
    const allKeys = [...new Set(data.flatMap(r => Object.keys(r.extra_fields ?? {})))]
    const rows = data.map(r => ({
      id:         r.id,
      asset_no:   r.asset_no,
      serial_no:  r.serial_no,
      issue_date: r.issue_date,
      site:       r.site,
      brand:      r.brand,
      country:    r.country,
      ...Object.fromEntries(allKeys.map(k => [k, r.extra_fields?.[k] ?? ''])),
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Custom Data')
    XLSX.writeFile(wb, `custom_data_export_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filteredStats = useMemo(() =>
    fieldStats.filter(f => !statsSearch || f.field_key.toLowerCase().includes(statsSearch.toLowerCase())),
    [fieldStats, statsSearch]
  )

  const totalCustomRecords = fieldStats.reduce((a, b) => a + Number(b.record_count), 0)

  // Check if a custom field key already has a synonym
  const synonymMap = useMemo(() => {
    const m = {}
    synonyms.forEach(s => { m[s.custom_name.toLowerCase()] = s })
    return m
  }, [synonyms])

  const totalPages = Math.ceil(totalRecords / REC_PAGE_SIZE)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('customdata.title')}
        subtitle={t('customdata.subtitle')}
        icon={Database}
        actions={
          <button onClick={exportExtraFields} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={14} /> {t('customdata.actions.exportAll')}
          </button>
        }
      />

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={Layers}        label={t('customdata.stats.uniqueFields')}  value={fieldStats.length}         color="blue" />
        <StatTile icon={Database}      label={t('customdata.stats.recordsWithCustomData')} value={totalCustomRecords}     color="green" />
        <StatTile icon={Tag}           label={t('customdata.stats.permanentSynonyms')}    value={synonyms.length}           color="purple" />
        <StatTile icon={Link2}         label={t('customdata.stats.autoMappedOnUpload')} value={synonyms.reduce((a,b) => a + b.use_count, 0)} color="yellow" />
      </div>

      {/* ── How it works banner ── */}
      <div className="card border-blue-800/40 bg-blue-900/10">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-blue-300">{t('customdata.banner.title')}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {t('customdata.banner.bodyPart1')}<strong className="text-[var(--text-secondary)]">{t('customdata.banner.customData')}</strong>{t('customdata.banner.bodyPart2')}<strong className="text-[var(--text-secondary)]">{t('customdata.banner.permanentSynonym')}</strong>{t('customdata.banner.bodyPart3')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-[var(--surface-1)]/60 rounded-xl p-1 w-fit border border-[var(--input-border)]">
        {TABS.map((tabKey, i) => (
          <button
            key={tabKey}
            onClick={() => setTab(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === i ? 'bg-gray-700 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {t(`customdata.tabs.${tabKey}`)}
            {i === 0 && fieldStats.length > 0 && (
              <span className="ml-2 text-xs bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded-full">{fieldStats.length}</span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ══ TAB 0: Custom Fields ══════════════════════════════════════════════ */}
        {tab === 0 && (
          <motion.div key="fields" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }} className="space-y-4">

            {/* Search + refresh */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  className="input pl-8 text-sm w-full"
                  placeholder={t('customdata.customFields.searchPlaceholder')}
                  value={statsSearch}
                  onChange={e => setStatsSearch(e.target.value)}
                />
              </div>
              <button onClick={loadFieldStats} className="btn-secondary p-2"><RefreshCw size={14} /></button>
            </div>

            {loading ? (
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
                <Database size={32} className="text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] font-medium">{t('customdata.customFields.empty.title')}</p>
                <p className="text-[var(--text-dim)] text-sm mt-1">{t('customdata.customFields.empty.body')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredStats.map(stat => {
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
                          {backfillResult && (
                            <p className="text-xs text-green-300">✓ {t('customdata.customFields.backfill.result', { count: backfillResult.updated.toLocaleString() })}</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={runBackfill}
                              disabled={!backfillTarget || backfillRunning}
                              className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1.5"
                            >
                              {backfillRunning ? <><RefreshCw size={11} className="animate-spin" /> {t('customdata.customFields.backfill.running')}</> : t('customdata.customFields.backfill.run')}
                            </button>
                            <button onClick={() => { setBackfillKey(null); setBackfillResult(null) }} className="btn-secondary text-xs py-1.5 px-3">{t('customdata.customFields.backfill.done')}</button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )
                })}
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
            {synLoading ? (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="table-header">{t('customdata.synonyms.table.columnName')}</th>
                      <th className="table-header">{t('customdata.synonyms.table.mapsTo')}</th>
                      <th className="table-header">{t('customdata.synonyms.table.timesUsed')}</th>
                      <th className="table-header">{t('customdata.synonyms.table.lastUsed')}</th>
                      <th className="table-header w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--input-border)]/40">
                        <td className="table-cell"><div className="h-3 w-32 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-28 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-12 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-20 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="w-6 h-6 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : synonyms.length === 0 ? (
              <div className="card text-center py-12">
                <Tag size={28} className="text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] font-medium">{t('customdata.synonyms.empty.title')}</p>
                <p className="text-[var(--text-dim)] text-sm mt-1">{t('customdata.synonyms.empty.body')}</p>
              </div>
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="table-header">{t('customdata.synonyms.table.columnName')}</th>
                      <th className="table-header">{t('customdata.synonyms.table.mapsTo')}</th>
                      <th className="table-header">{t('customdata.synonyms.table.timesUsed')}</th>
                      <th className="table-header">{t('customdata.synonyms.table.lastUsed')}</th>
                      <th className="table-header w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {synonyms.map(s => (
                      <tr key={s.id} className="hover:bg-[var(--input-bg)]/30 transition-colors">
                        <td className="table-cell font-mono text-yellow-300">{s.custom_name}</td>
                        <td className="table-cell">
                          <span className="flex items-center gap-1.5">
                            <ArrowRight size={12} className="text-[var(--text-dim)]" />
                            <span className="text-green-300 font-medium">{CANONICAL_FIELDS.find(f => f.key === s.maps_to) ? t(`customdata.fields.${s.maps_to}`) : s.maps_to}</span>
                          </span>
                        </td>
                        <td className="table-cell text-[var(--text-muted)]">{s.use_count.toLocaleString()}</td>
                        <td className="table-cell text-[var(--text-muted)] text-xs">
                          {s.last_used_at ? formatDate(s.last_used_at) : t('customdata.synonyms.table.never')}
                        </td>
                        <td className="table-cell">
                          <button onClick={() => confirmDeleteSynonym(s)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-dim)] hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  <label className="label text-xs">{t('customdata.records.filters.byFieldLabel')}</label>
                  <select className="input text-sm" value={filterKey} onChange={e => { setFilterKey(e.target.value); setFilterVal(''); setRecPage(0) }}>
                    <option value="">{t('customdata.records.filters.allFields')}</option>
                    {fieldStats.map(f => <option key={f.field_key} value={f.field_key}>{f.field_key} ({Number(f.record_count).toLocaleString()})</option>)}
                  </select>
                </div>
                {filterKey && (
                  <div className="flex-1 min-w-[180px]">
                    <label className="label text-xs">{t('customdata.records.filters.valueLabel')}</label>
                    <input className="input text-sm" placeholder={t('customdata.records.filters.valuePlaceholder')}
                      value={filterVal} onChange={e => { setFilterVal(e.target.value); setRecPage(0) }} />
                  </div>
                )}
                <button onClick={() => { setFilterKey(''); setFilterVal(''); setRecPage(0) }} className="btn-secondary text-xs self-end flex items-center gap-1.5">
                  <X size={12} /> {t('customdata.records.filters.clear')}
                </button>
                <button onClick={exportExtraFields} className="btn-secondary text-xs self-end flex items-center gap-1.5">
                  <Download size={12} /> {t('customdata.records.filters.export')}
                </button>
              </div>
            </div>

            {/* Records table */}
            <div className="card overflow-x-auto">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-[var(--text-muted)]">
                  <span className="text-[var(--text-primary)] font-semibold">{totalRecords.toLocaleString()}</span> {t('customdata.records.countSuffix')}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <button onClick={() => setRecPage(p => Math.max(0, p-1))} disabled={recPage === 0} className="btn-secondary py-1 px-2 disabled:opacity-40">‹</button>
                    <span className="text-[var(--text-muted)]">{recPage + 1} / {totalPages}</span>
                    <button onClick={() => setRecPage(p => Math.min(totalPages-1, p+1))} disabled={recPage >= totalPages-1} className="btn-secondary py-1 px-2 disabled:opacity-40">›</button>
                  </div>
                )}
              </div>

              {recLoading ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="table-header w-8"></th>
                      <th className="table-header">{t('customdata.records.table.assetNo')}</th>
                      <th className="table-header">{t('customdata.records.table.serialNo')}</th>
                      <th className="table-header">{t('customdata.records.table.date')}</th>
                      <th className="table-header">{t('customdata.records.table.site')}</th>
                      <th className="table-header">{t('customdata.records.table.customFields')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--input-border)]/40">
                        <td className="table-cell"><div className="w-3 h-3 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-20 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-24 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-16 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell"><div className="h-3 w-20 rounded bg-[var(--input-bg)]/40 animate-pulse" /></td>
                        <td className="table-cell">
                          <div className="flex gap-1.5">
                            <div className="h-4 w-24 rounded-full bg-[var(--input-bg)]/40 animate-pulse" />
                            <div className="h-4 w-20 rounded-full bg-[var(--input-bg)]/40 animate-pulse" />
                            <div className="h-4 w-16 rounded-full bg-[var(--input-bg)]/40 animate-pulse" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : records.length === 0 ? (
                <div className="text-center py-10 text-[var(--text-muted)]">{t('customdata.records.empty')}</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="table-header w-8"></th>
                      <th className="table-header">{t('customdata.records.table.assetNo')}</th>
                      <th className="table-header">{t('customdata.records.table.serialNo')}</th>
                      <th className="table-header">{t('customdata.records.table.date')}</th>
                      <th className="table-header">{t('customdata.records.table.site')}</th>
                      <th className="table-header">{t('customdata.records.table.customFields')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => {
                      const expanded = expandedRows.has(r.id)
                      const efKeys   = Object.keys(r.extra_fields ?? {})
                      return (
                        <>
                          <tr key={r.id} className="hover:bg-[var(--input-bg)]/30 transition-colors cursor-pointer"
                            onClick={() => setExpandedRows(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })}>
                            <td className="table-cell">
                              <ChevronRight size={12} className={`text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
                            </td>
                            <td className="table-cell font-mono text-blue-300">{r.asset_no ?? '-'}</td>
                            <td className="table-cell font-mono text-[var(--text-secondary)]">{r.serial_no ?? '-'}</td>
                            <td className="table-cell text-[var(--text-muted)]">{r.issue_date ?? '-'}</td>
                            <td className="table-cell text-[var(--text-muted)]">{r.site ?? '-'}</td>
                            <td className="table-cell">
                              <div className="flex flex-wrap gap-1">
                                {efKeys.slice(0, 3).map(k => (
                                  <span key={k} className="bg-[var(--input-bg)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full text-xs max-w-[120px] truncate">
                                    <span className="text-yellow-400">{k}</span>: {r.extra_fields[k]}
                                  </span>
                                ))}
                                {efKeys.length > 3 && (
                                  <span className="text-[var(--text-dim)] text-xs">{t('customdata.records.table.moreCount', { count: efKeys.length - 3 })}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr key={r.id + '_exp'} className="bg-[var(--input-bg)]/20">
                              <td />
                              <td colSpan={5} className="px-4 py-3">
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                  {Object.entries(r.extra_fields ?? {}).map(([k, v]) => (
                                    <div key={k} className="bg-[var(--surface-1)]/60 rounded-lg px-3 py-2 border border-[var(--input-border)]/40">
                                      <p className="text-yellow-400 text-xs font-medium truncate">{k}</p>
                                      <p className="text-[var(--text-secondary)] text-xs mt-0.5 break-all">{v}</p>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
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
              <button onClick={closeDeleteSynonym} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
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

function StatTile({ icon: Icon, label, value, color }) {
  const c = {
    blue:   { bg: 'bg-blue-900/20',   border: 'border-blue-800/40',   text: 'text-blue-300',   icon: 'text-blue-400' },
    green:  { bg: 'bg-green-900/20',  border: 'border-green-800/40',  text: 'text-green-300',  icon: 'text-green-400' },
    purple: { bg: 'bg-purple-900/20', border: 'border-purple-800/40', text: 'text-purple-300', icon: 'text-purple-400' },
    yellow: { bg: 'bg-yellow-900/10', border: 'border-yellow-800/40', text: 'text-yellow-300', icon: 'text-yellow-400' },
  }[color]
  return (
    <div className={`rounded-xl border p-4 flex items-center gap-3 ${c.bg} ${c.border}`}>
      <Icon size={20} className={c.icon} />
      <div>
        <p className={`text-xl font-bold ${c.text}`}>{(value ?? 0).toLocaleString()}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
      </div>
    </div>
  )
}

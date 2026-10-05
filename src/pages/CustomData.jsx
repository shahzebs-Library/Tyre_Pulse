/**
 * Custom Data Manager (route /custom-data), rebuilt on the Command Center kit
 * to the owner's mockup.
 *
 * Every column in every uploaded file is kept: columns that do not match a
 * standard field land in tyre_records.extra_fields. This page shows them,
 * maps them to permanent field synonyms so future uploads auto-map, copies a
 * custom value into a standard column, browses and exports the records, and
 * shows how each import batch preserved its rows.
 *
 * Sources (all real, read under RLS): get_extra_field_stats (per custom key),
 * field_synonyms, tyre_records.extra_fields, import_mapping_profiles (saved
 * mapping rules), import_batches + import_files (lineage, conflict rows).
 *
 * Honest gaps against the mockup: no per-field quality score, confidence or
 * source upload is stored, so none is shown; the "looks like" type is read
 * from the sample values only. Pure shaping: src/lib/customDataView.js and
 * src/lib/customDataAnalytics.js.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Layers, Tag, HelpCircle, Database, AlertTriangle, ChevronRight, Download, RefreshCw, Search,
  Link2, ArrowRight, Eye, Trash2, Check, X, Plus, Loader2, Info,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as customData from '../lib/api/customData'
import { listAllProfiles, setProfileActive } from '../lib/api/imports'
import { listImportBatches } from '../lib/api/auditTrailOverview'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatDate, formatDateTime } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, Tabs, Pager, KitTable, fmtInt, fmtPct } from '../components/commandCenter/kit'
import { exportToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { summarizeCustomData, filterSynonyms, flattenForExport, pageCount } from '../lib/customDataAnalytics'
import {
  registryRows, filterRegistry, lineageRows, conflictTotal, scopeBatches, usageBars,
} from '../lib/customDataView'
import './CustomData.css'

// Canonical tyre_records fields a custom column can map to.
const CANONICAL_FIELDS = [
  { key: 'sr', label: 'Row / SR No.' }, { key: 'issue_date', label: 'Issue Date' },
  { key: 'description', label: 'Description' }, { key: 'brand', label: 'Brand' },
  { key: 'serial_no', label: 'Serial Number' }, { key: 'qty', label: 'Quantity' },
  { key: 'job_card', label: 'Job Card' }, { key: 'mis_number', label: 'MIS Number' },
  { key: 'asset_no', label: 'Asset / Vehicle No.' }, { key: 'site', label: 'Site / Location' },
  { key: 'country', label: 'Country' }, { key: 'remarks', label: 'Remarks / Notes' },
  { key: 'cost_per_tyre', label: 'Cost Per Tyre' }, { key: 'driver_name', label: 'Driver Name' },
  { key: 'supplier', label: 'Supplier' }, { key: 'size', label: 'Tyre Size' },
  { key: 'position', label: 'Tyre Position' }, { key: 'tread_depth', label: 'Tread Depth (mm)' },
  { key: 'pressure_reading', label: 'Pressure (PSI)' },
]
const CANON_LABEL = Object.fromEntries(CANONICAL_FIELDS.map((f) => [f.key, f.label]))
const fieldName = (k) => (k ? CANON_LABEL[k] || k : null)

const TABS = [
  { key: 'fields', label: 'Custom fields' },
  { key: 'synonyms', label: 'Synonyms' },
  { key: 'records', label: 'Browse records' },
  { key: 'rules', label: 'Mapping rules' },
  { key: 'usage', label: 'Usage' },
]
const REC_PAGE_SIZE = 20
const NA = <span className="cc-na">N/A</span>

function KpiLabel({ title, sub }) {
  return <>{title}<small className="cdm-kpi-sub">{sub}</small></>
}

export default function CustomData() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const { t } = useLanguage()
  const canWrite = ['Admin', 'Manager'].includes(profile?.role) || Boolean(profile?.is_super_admin)

  const [tab, setTab] = useState('fields')

  // Field stats + synonyms
  const [fieldStats, setFieldStats] = useState([])
  const [recordCount, setRecordCount] = useState(null)
  const [statsState, setStatsState] = useState({ loading: true, error: null })
  const [synonyms, setSynonyms] = useState([])
  const [synState, setSynState] = useState({ loading: true, error: null })

  // Lineage + rules
  const [batches, setBatches] = useState({ loading: true, data: null, error: null })
  const [profiles, setProfiles] = useState({ loading: false, data: null, error: null })

  // Registry UI
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedKey, setSelectedKey] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState('')
  const [backfillTarget, setBackfillTarget] = useState('')
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)
  const [actionError, setActionError] = useState('')

  // Synonyms tab
  const [synSearch, setSynSearch] = useState('')
  const [newCustom, setNewCustom] = useState('')
  const [newMapsTo, setNewMapsTo] = useState('')
  const [addError, setAddError] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Records tab
  const [records, setRecords] = useState([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [recLoading, setRecLoading] = useState(false)
  const [recError, setRecError] = useState('')
  const [filterKey, setFilterKey] = useState('')
  const [filterVal, setFilterVal] = useState('')
  const [recPage, setRecPage] = useState(0)
  const [selectedRecord, setSelectedRecord] = useState(null)

  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState(null)

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadFieldStats = useCallback(async () => {
    setStatsState({ loading: true, error: null })
    const country = activeCountry !== 'All' ? activeCountry : null
    try {
      const [data, head] = await Promise.all([
        customData.getExtraFieldStats({ country }),
        customData.listRecordsWithExtraFields({ country: activeCountry, from: 0, to: 0 }).catch(() => null),
      ])
      setFieldStats(data ?? [])
      setRecordCount(head ? head.count : null)
      setStatsState({ loading: false, error: null })
    } catch (e) {
      setFieldStats([]); setRecordCount(null)
      setStatsState({ loading: false, error: toUserMessage(e, 'Could not read the custom field summary.') })
    }
  }, [activeCountry])

  const loadSynonyms = useCallback(async () => {
    setSynState({ loading: true, error: null })
    try { setSynonyms((await customData.listFieldSynonyms()) ?? []); setSynState({ loading: false, error: null }) }
    catch (e) { setSynonyms([]); setSynState({ loading: false, error: toUserMessage(e, 'Could not read the synonyms.') }) }
  }, [])

  const loadBatches = useCallback(async () => {
    setBatches((s) => ({ ...s, loading: true, error: null }))
    try { setBatches({ loading: false, data: await listImportBatches({ limit: 200 }), error: null }) }
    catch (e) { setBatches({ loading: false, data: null, error: toUserMessage(e, 'Import lineage could not be read.') }) }
  }, [])

  const loadProfiles = useCallback(async () => {
    setProfiles((s) => ({ ...s, loading: true, error: null }))
    try { setProfiles({ loading: false, data: await listAllProfiles(), error: null }) }
    catch (e) { setProfiles({ loading: false, data: null, error: toUserMessage(e, 'Saved mapping rules could not be read.') }) }
  }, [])

  const loadRecords = useCallback(async () => {
    setRecLoading(true); setRecError('')
    try {
      const { data, count } = await customData.listRecordsWithExtraFields({
        country: activeCountry, filterKey, filterVal,
        from: recPage * REC_PAGE_SIZE, to: (recPage + 1) * REC_PAGE_SIZE - 1,
      })
      setRecords(data ?? []); setTotalRecords(count ?? 0)
    } catch (e) {
      setRecords([]); setTotalRecords(0)
      setRecError(toUserMessage(e, 'Could not load the records with custom data.'))
    }
    setRecLoading(false)
  }, [activeCountry, filterKey, filterVal, recPage])

  useEffect(() => { loadFieldStats() }, [loadFieldStats])
  useEffect(() => { loadSynonyms() }, [loadSynonyms])
  useEffect(() => { loadBatches() }, [loadBatches])
  useEffect(() => { if (tab === 'rules' && !profiles.data && !profiles.loading) loadProfiles() }, [tab, profiles.data, profiles.loading, loadProfiles])
  useEffect(() => { if (tab === 'records') loadRecords() }, [tab, loadRecords])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => summarizeCustomData({ fieldStats, synonyms, recordCount }), [fieldStats, synonyms, recordCount])
  const registry = useMemo(() => registryRows(fieldStats, synonyms), [fieldStats, synonyms])
  const filteredRegistry = useMemo(() => filterRegistry(registry, { search, status }), [registry, search, status])
  const selected = useMemo(() => registry.find((r) => r.key === selectedKey) || null, [registry, selectedKey])
  const scopedBatches = useMemo(() => scopeBatches(batches.data, activeCountry), [batches.data, activeCountry])
  const lineage = useMemo(() => lineageRows(scopedBatches || []), [scopedBatches])
  const conflicts = conflictTotal(scopedBatches)
  const filteredSynonyms = useMemo(() => filterSynonyms(synonyms, synSearch), [synonyms, synSearch])
  const bars = useMemo(() => usageBars(registry), [registry])
  const recPages = Math.max(1, pageCount(totalRecords, REC_PAGE_SIZE))

  useEffect(() => { if (!selectedKey && registry.length) setSelectedKey(registry[0].key) }, [registry, selectedKey])
  useEffect(() => { setPromoteTarget(''); setBackfillTarget(''); setBackfillResult(null); setActionError('') }, [selectedKey])

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function addSynonym(customName, mapsTo) {
    if (!customName.trim() || !mapsTo) { const m = t('customdata.synonyms.add.errorBothRequired'); setAddError(m); return m }
    setAddSaving(true); setAddError('')
    try {
      await customData.createFieldSynonym({ custom_name: customName.trim(), maps_to: mapsTo, table_target: 'tyre_records', created_by: profile?.id, use_count: 0 })
      await loadSynonyms()
      return null
    } catch (e) {
      const m = toUserMessage(e, 'Could not save. Please try again.')
      setAddError(m)
      return m
    } finally { setAddSaving(false) }
  }

  async function acceptMapping() {
    if (!selected || !promoteTarget) return
    setActionError('')
    const failure = await addSynonym(selected.key, promoteTarget)
    if (failure) setActionError(failure)
    else setPromoteTarget('')
  }

  async function deleteSynonym() {
    if (!deleteTarget) return
    setDeleting(true); setDeleteError('')
    try {
      const { data, error } = await supabase.from('field_synonyms').delete().eq('id', deleteTarget.id).select('id')
      if (error) throw error
      if ((data?.length ?? 0) === 0) throw new Error(t('customdata.synonyms.delete.errNotDeleted'))
      setSynonyms((s) => s.filter((x) => x.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) { setDeleteError(toUserMessage(e, t('customdata.synonyms.delete.errFailed'))) }
    finally { setDeleting(false) }
  }

  async function runBackfill() {
    if (!selected || !backfillTarget) return
    setBackfillRunning(true); setBackfillResult(null); setActionError('')
    const { data: batch, error } = await customData.listTyreRecordsForBackfill({ fieldKey: selected.key, target: backfillTarget })
    if (error) { setActionError(toUserMessage(error, 'Could not read the records to copy.')); setBackfillRunning(false); return }
    let updated = 0; let failed = 0
    for (let i = 0; i < batch.length; i += 200) {
      const slice = batch.slice(i, i + 200)
      const results = await Promise.allSettled(slice.map((r) => customData.updateTyreRecordFields(r.id, { [backfillTarget]: r.extra_fields[selected.key] })))
      for (const res of results) { if (res.status === 'fulfilled') updated += 1; else failed += 1 }
    }
    setBackfillResult({ updated, total: batch.length })
    if (failed) setActionError(`${fmtInt(failed)} record${failed === 1 ? '' : 's'} could not be updated.`)
    setBackfillRunning(false)
    loadFieldStats()
  }

  async function exportExtraFields() {
    setExporting(true); setExportMsg(null)
    try {
      const { data, error } = await customData.listTyreRecordsForExport()
      if (error) throw error
      if (!data?.length) { setExportMsg({ type: 'info', text: 'There are no records with custom data to export.' }); return }
      const { rows, columns, headers } = flattenForExport(data)
      await exportToExcel(rows, columns, headers, reportFileName('Custom Data', activeCountry, reportDateLabel()), 'Custom Data')
    } catch (e) { setExportMsg({ type: 'err', text: toUserMessage(e, 'Could not export the custom data.') }) }
    finally { setExporting(false) }
  }

  async function toggleProfile(p) {
    try { await setProfileActive(p.id, !p.active); loadProfiles() }
    catch (e) { setProfiles((s) => ({ ...s, error: toUserMessage(e, 'Could not update the mapping rule.') })) }
  }

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const statsBad = Boolean(statsState.error); const synBad = Boolean(synState.error)
  const kpis = [
    { icon: Layers, tone: 't-green', value: statsBad ? null : summary.uniqueFields, label: <KpiLabel title="Custom fields" sub={statsBad ? 'Could not be read' : 'Across uploads'} />, onClick: () => { setTab('fields'); setStatus('all') } },
    { icon: Tag, tone: 't-blue', value: synBad ? null : summary.synonyms, label: <KpiLabel title="Synonym mappings" sub={synBad ? 'Could not be read' : `${fmtInt(summary.autoMapped)} auto-mapped on upload`} />, onClick: () => setTab('synonyms') },
    { icon: HelpCircle, tone: 't-amber', value: statsBad || synBad ? null : summary.unmappedFields, label: <KpiLabel title="Unmapped fields" sub="Need a mapping" />, onClick: () => { setTab('fields'); setStatus('unmapped') } },
    { icon: Database, tone: 't-purple', value: summary.recordCount, label: <KpiLabel title="Custom records" sub={summary.recordCount == null ? 'Count unavailable' : 'Tyre records with custom data'} />, onClick: () => setTab('records') },
    { icon: AlertTriangle, tone: 't-red', value: conflicts, label: <KpiLabel title="Data conflicts" sub={batches.error ? 'Could not be read' : 'Import rows held as conflicts'} />, title: 'Sum of conflict rows across import batches in scope (latest 200)' },
  ]

  const registryColumns = [
    { key: 'key', header: 'Field', cell: (r) => <span className={`cdm-mono cc-strong cdm-field ${r.key === selectedKey ? 'is-selected' : ''}`} aria-current={r.key === selectedKey ? 'true' : undefined}>{r.key}</span> },
    { key: 'map', header: 'Canonical mapping', sortValue: (r) => r.mappedTo || '', cell: (r) => (r.mappedTo ? fieldName(r.mappedTo) : <span className="cc-na">Not mapped</span>) },
    { key: 'type', header: 'Looks like', sortValue: (r) => r.type || '', cell: (r) => r.type || NA },
    { key: 'records', header: 'Records', numeric: true, sortValue: (r) => r.records, cell: (r) => fmtInt(r.records) },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <span className={`cc-pill ${r.status === 'mapped' ? 'good' : 'warn'}`}>{r.status === 'mapped' ? 'Mapped' : 'Unmapped'}</span> },
  ]

  const synonymColumns = [
    { key: 'custom_name', header: 'Column name', cell: (s) => <span className="cdm-mono">{s.custom_name}</span> },
    { key: 'maps_to', header: 'Maps to', sortValue: (s) => fieldName(s.maps_to) || '', cell: (s) => <span className="cdm-arrow"><ArrowRight size={12} aria-hidden="true" />{fieldName(s.maps_to)}</span> },
    { key: 'use_count', header: 'Times used', numeric: true, sortValue: (s) => Number(s.use_count) || 0, cell: (s) => fmtInt(Number(s.use_count) || 0) },
    { key: 'last_used_at', header: 'Last used', sortValue: (s) => s.last_used_at || '', cell: (s) => (s.last_used_at ? formatDate(s.last_used_at) : <span className="cc-na">Never</span>) },
    {
      key: 'actions', header: '', sortable: false,
      cell: (s) => canWrite
        ? <button type="button" className="cc-icon-btn cdm-danger" onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); setDeleteError('') }} aria-label={`Delete synonym ${s.custom_name}`} title="Delete"><Trash2 size={14} /></button>
        : null,
    },
  ]

  const recordColumns = [
    { key: 'asset_no', header: 'Asset no', sortable: false, cell: (r) => (r.asset_no ? <span className="cdm-mono">{r.asset_no}</span> : NA) },
    { key: 'serial_no', header: 'Serial no', sortable: false, cell: (r) => (r.serial_no ? <span className="cdm-mono">{r.serial_no}</span> : NA) },
    { key: 'issue_date', header: 'Date', sortable: false, cell: (r) => r.issue_date || NA },
    { key: 'site', header: 'Site', sortable: false, cell: (r) => r.site || NA },
    {
      key: 'custom', header: 'Custom fields', sortable: false,
      cell: (r) => {
        const ef = r.extra_fields ?? {}; const keys = Object.keys(ef)
        const preview = keys.slice(0, 3) // cell preview only; the full set opens below the table
        return (
          <span className="cdm-chips">
            {preview.map((k) => <span key={k} className="cdm-chip" title={`${k}: ${ef[k]}`}><b>{k}</b>: {String(ef[k])}</span>)}
            {keys.length > 3 && <span className="cc-na">+{keys.length - 3} more</span>}
          </span>
        )
      },
    },
  ]

  const ruleColumns = [
    { key: 'name', header: 'Mapping', cell: (p) => <span className="cc-strong">{p.name}</span> },
    { key: 'module', header: 'Module', cell: (p) => p.module || NA },
    { key: 'source', header: 'Source system', sortValue: (p) => p.source_system || '', cell: (p) => p.source_system || NA },
    { key: 'country', header: 'Country', sortValue: (p) => p.country || '', cell: (p) => p.country || 'All' },
    { key: 'rules', header: 'Column rules', numeric: true, sortValue: (p) => p.rule_count, cell: (p) => fmtInt(p.rule_count) },
    { key: 'used', header: 'Last used', sortValue: (p) => p.last_used_at || '', cell: (p) => (p.last_used_at ? formatDate(p.last_used_at) : <span className="cc-na">Never</span>) },
    {
      key: 'active', header: 'Status', sortValue: (p) => (p.active ? 1 : 0),
      cell: (p) => (canWrite
        ? <button type="button" className={`cc-pill ${p.active ? 'good' : 'muted'} cdm-pill-btn`} onClick={() => toggleProfile(p)} title={p.active ? 'Active: suggested on matching uploads. Click to switch off.' : 'Inactive: not suggested. Click to switch on.'}>{p.active ? 'Active' : 'Inactive'}</button>
        : <span className={`cc-pill ${p.active ? 'good' : 'muted'}`}>{p.active ? 'Active' : 'Inactive'}</span>),
    },
  ]

  const lineageColumns = [
    { key: 'file', header: 'Upload', sortable: false, cell: (l) => (l.file ? <span className="cdm-trunc" title={l.file}>{l.file}</span> : NA) },
    { key: 'module', header: 'Module', sortable: false, cell: (l) => l.module || NA },
    { key: 'created', header: 'Loaded', sortable: false, cell: (l) => (l.created ? <span className="cdm-nowrap">{formatDateTime(l.created)}</span> : NA) },
    { key: 'rows', header: 'Rows', numeric: true, sortable: false, cell: (l) => fmtInt(l.total) },
    { key: 'imported', header: 'Imported', numeric: true, sortable: false, cell: (l) => (l.share == null ? fmtInt(l.imported) : `${fmtInt(l.imported)} (${fmtPct(l.share)})`) },
    { key: 'issues', header: 'Conflicts / errors', numeric: true, sortable: false, cell: (l) => `${fmtInt(l.conflicts)} / ${fmtInt(l.errors)}` },
    { key: 'status', header: 'Status', sortable: false, cell: (l) => <span className={`cc-pill ${l.tone}`}>{l.label}</span> },
  ]

  const tabsWithCounts = TABS.map((x) => ({
    ...x,
    count: x.key === 'fields' && fieldStats.length ? fieldStats.length : x.key === 'synonyms' && synonyms.length ? synonyms.length : undefined,
  }))

  return (
    <div className="cc cdm-page">
      <header className="cdm-head">
        <div className="cdm-head-copy">
          <nav aria-label="Breadcrumb" className="cdm-crumb">Administration <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Custom Data Manager</span></nav>
          <h1>Custom Data Manager</h1>
          <p>Every uploaded column is kept. Map custom columns to standard fields so the next upload maps them for you.</p>
        </div>
        <div className="cdm-head-actions">
          <span className="cdm-scope" title="Country from the app scope selector">{activeCountry === 'All' ? 'All countries' : activeCountry}</span>
          <button type="button" className="cc-btn-primary" onClick={exportExtraFields} disabled={exporting}>
            {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Export all custom data
          </button>
        </div>
      </header>

      {exportMsg && (
        <div className={`cc-card cdm-banner ${exportMsg.type === 'err' ? 'bad' : ''}`} role={exportMsg.type === 'err' ? 'alert' : 'status'}>
          <Info size={18} aria-hidden="true" /><div><p>{exportMsg.text}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setExportMsg(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis cdm-kpis">
        {kpis.map((k, i) => <Kpi key={i} {...k} loading={(i < 4 && (statsState.loading || (i === 1 && synState.loading))) || (i === 4 && batches.loading)} />)}
      </div>

      <div className="cc-card cdm-tabbar">
        <Tabs tabs={tabsWithCounts} value={tab} onChange={setTab} label="Custom data sections" />
      </div>

      {tab === 'fields' && (
        <div className="cdm-row">
          <section className="cc-card" aria-label="Custom field registry">
            <div className="cc-card-head">
              <div><h2 className="cc-card-title">Custom field registry</h2><p className="cc-card-sub">Columns from your uploads that are not standard fields. Select one to map it.</p></div>
              <button type="button" className="cc-icon-btn" onClick={() => { loadFieldStats(); loadSynonyms() }} aria-label="Refresh custom fields" title="Refresh"><RefreshCw size={14} className={statsState.loading ? 'animate-spin' : ''} /></button>
            </div>
            <div className="cc-filters cdm-filters">
              <label className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search custom fields" placeholder="Search field or mapped name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <select className="cc-select" aria-label="Mapping state" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All fields</option>
                <option value="unmapped">Unmapped</option>
                <option value="mapped">Mapped</option>
              </select>
              <span className="cdm-count">{fmtInt(filteredRegistry.length)} of {fmtInt(registry.length)} fields</span>
            </div>
            <KitTable
              columns={registryColumns}
              rows={filteredRegistry}
              loading={statsState.loading && !fieldStats.length}
              error={statsState.error}
              onRetry={loadFieldStats}
              getRowId={(r) => r.key}
              onRowClick={(r) => setSelectedKey(r.key)}
              empty={registry.length ? 'No custom field matches these filters.' : 'No custom fields yet. Columns that do not match a standard field appear here after an upload.'}
              scroll
            />
          </section>

          <Card title="Field intelligence" sub={selected ? undefined : 'Select a field in the registry.'} className="cdm-intel">
            {!selected ? (
              <div className="cc-empty">{statsState.loading ? 'Loading fields...' : 'No field selected.'}</div>
            ) : (
              <div className="cdm-intel-body">
                <p className="cdm-intel-title">Selected: <span className="cdm-mono">{selected.key}</span></p>
                <dl className="cdm-facts">
                  <div><dt>Records carrying it</dt><dd>{fmtInt(selected.records)}</dd></div>
                  <div><dt>Looks like</dt><dd>{selected.type || 'N/A'}</dd></div>
                  <div><dt>Mapped to</dt><dd>{selected.mappedTo ? fieldName(selected.mappedTo) : 'Not mapped'}</dd></div>
                  <div><dt>Auto-mapped on upload</dt><dd>{selected.synonym ? `${fmtInt(Number(selected.synonym.use_count) || 0)} times` : 'N/A'}</dd></div>
                  <div><dt>Last auto-mapped</dt><dd>{selected.synonym?.last_used_at ? formatDate(selected.synonym.last_used_at) : 'N/A'}</dd></div>
                </dl>
                <div>
                  <p className="cdm-label">Sample values</p>
                  {selected.samples.length
                    ? <span className="cdm-chips">{selected.samples.map((v, i) => <span key={i} className="cdm-chip">{String(v)}</span>)}</span>
                    : <p className="cc-na">No sample values returned.</p>}
                </div>

                {canWrite && !selected.mappedTo && (
                  <div className="cdm-action">
                    <label htmlFor="cdm-map" className="cdm-label">Map this column to a standard field</label>
                    <select id="cdm-map" className="cc-select" value={promoteTarget} onChange={(e) => setPromoteTarget(e.target.value)}>
                      <option value="">Choose a field</option>
                      {CANONICAL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <p className="cc-na">Future uploads with a column named {selected.key} will fill this field automatically.</p>
                  </div>
                )}
                {canWrite && (
                  <div className="cdm-action">
                    <label htmlFor="cdm-copy" className="cdm-label">Copy existing values into a standard field</label>
                    <select id="cdm-copy" className="cc-select" value={backfillTarget} onChange={(e) => { setBackfillTarget(e.target.value); setBackfillResult(null) }}>
                      <option value="">Choose a field</option>
                      {CANONICAL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <p className="cc-na">Only records where that field is empty are filled; nothing is overwritten.</p>
                    {backfillResult && <p className="cdm-ok"><Check size={13} aria-hidden="true" /> Copied {fmtInt(backfillResult.updated)} of {fmtInt(backfillResult.total)} records.</p>}
                  </div>
                )}
                {actionError && <p role="alert" className="cdm-err">{actionError}</p>}
                <div className="cdm-intel-actions">
                  {canWrite && !selected.mappedTo && (
                    <button type="button" className="cc-btn-primary" onClick={acceptMapping} disabled={!promoteTarget || addSaving}>
                      <Link2 size={14} aria-hidden="true" /> {addSaving ? 'Saving...' : 'Accept mapping'}
                    </button>
                  )}
                  {canWrite && (
                    <button type="button" className="cc-btn-ghost" onClick={runBackfill} disabled={!backfillTarget || backfillRunning}>
                      {backfillRunning ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />} Copy values
                    </button>
                  )}
                  <button type="button" className="cc-btn-ghost" onClick={() => { setFilterKey(selected.key); setFilterVal(''); setRecPage(0); setTab('records') }}>
                    <Eye size={14} aria-hidden="true" /> Browse records
                  </button>
                </div>
                {!canWrite && <p className="cc-na">Only Admin and Manager roles can change mappings.</p>}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'synonyms' && (
        <div className="cdm-stack">
          {canWrite && (
            <Card title="Add a synonym" sub="When an upload has this column name, its values go straight into the chosen field.">
              <div className="cc-filters cdm-add">
                <label className="cc-field"><span>Column name in your file</span>
                  <input className="cc-select" placeholder="e.g. Tyre Brand Name" value={newCustom} onChange={(e) => { setNewCustom(e.target.value); setAddError('') }} />
                </label>
                <ArrowRight size={16} className="cdm-add-arrow" aria-hidden="true" />
                <label className="cc-field"><span>Maps to</span>
                  <select className="cc-select" value={newMapsTo} onChange={(e) => setNewMapsTo(e.target.value)}>
                    <option value="">Choose a field</option>
                    {CANONICAL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </label>
                <button type="button" className="cc-btn-primary" disabled={addSaving || !newCustom.trim() || !newMapsTo}
                  onClick={async () => { if (!(await addSynonym(newCustom, newMapsTo))) { setNewCustom(''); setNewMapsTo('') } }}>
                  {addSaving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Save synonym
                </button>
              </div>
              {addError && <p role="alert" className="cdm-err">{addError}</p>}
            </Card>
          )}
          <section className="cc-card" aria-label="Synonyms">
            <div className="cc-filters cdm-filters">
              <label className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search synonyms" placeholder="Search column or field" value={synSearch} onChange={(e) => setSynSearch(e.target.value)} />
              </label>
              <span className="cdm-count">{fmtInt(filteredSynonyms.length)} of {fmtInt(synonyms.length)} synonyms</span>
            </div>
            <KitTable
              columns={synonymColumns}
              rows={filteredSynonyms}
              loading={synState.loading && !synonyms.length}
              error={synState.error}
              onRetry={loadSynonyms}
              getRowId={(s) => String(s.id)}
              empty={synonyms.length ? 'No synonym matches this search.' : 'No synonyms yet. Map a custom field or add one above.'}
              scroll
            />
          </section>
        </div>
      )}

      {tab === 'records' && (
        <section className="cc-card" aria-label="Records with custom data">
          <div className="cc-filters cdm-filters">
            <select className="cc-select" aria-label="Custom field" value={filterKey} onChange={(e) => { setFilterKey(e.target.value); setFilterVal(''); setRecPage(0); setSelectedRecord(null) }}>
              <option value="">All custom fields</option>
              {fieldStats.map((f) => <option key={f.field_key} value={f.field_key}>{f.field_key} ({fmtInt(Number(f.record_count))})</option>)}
            </select>
            {filterKey && (
              <label className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Value contains" placeholder="Value contains" value={filterVal} onChange={(e) => { setFilterVal(e.target.value); setRecPage(0) }} />
              </label>
            )}
            {(filterKey || filterVal) && (
              <button type="button" className="cc-btn-ghost" onClick={() => { setFilterKey(''); setFilterVal(''); setRecPage(0) }}><X size={14} aria-hidden="true" /> Clear</button>
            )}
            <span className="cdm-count">{recError ? 'Count unavailable' : `${fmtInt(totalRecords)} records`}</span>
          </div>
          <KitTable
            columns={recordColumns}
            rows={records}
            loading={recLoading && !records.length}
            error={recError || null}
            onRetry={loadRecords}
            getRowId={(r) => String(r.id)}
            manualPagination
            showPagination={false}
            pageIndex={recPage}
            pageCount={recPages}
            totalRows={totalRecords}
            pageSize={REC_PAGE_SIZE}
            onRowClick={(r) => setSelectedRecord((cur) => (cur?.id === r.id ? null : r))}
            empty={filterKey ? 'No record carries this custom field value.' : 'No records carry custom data.'}
            scroll
          />
          {!recError && totalRecords > 0 && (
            <Pager page={recPage} pageSize={REC_PAGE_SIZE} total={totalRecords} onPage={(p) => { setRecPage(Math.max(0, Math.min(recPages - 1, p))); setSelectedRecord(null) }} noun="records" />
          )}
          {selectedRecord && (
            <div className="cdm-record">
              <div className="cdm-record-head">
                <b>Custom values for {selectedRecord.asset_no || 'N/A'}{selectedRecord.serial_no ? ` | ${selectedRecord.serial_no}` : ''}</b>
                <button type="button" className="cc-icon-btn" onClick={() => setSelectedRecord(null)} aria-label="Close record details"><X size={14} /></button>
              </div>
              <dl className="cdm-record-grid">
                {Object.entries(selectedRecord.extra_fields ?? {}).map(([k, v]) => <div key={k}><dt title={k}>{k}</dt><dd>{String(v)}</dd></div>)}
              </dl>
            </div>
          )}
        </section>
      )}

      {tab === 'rules' && (
        <Card title="Saved mapping rules" sub="Formats remembered by Data Intake. Active ones are applied automatically to matching uploads."
          action={<Link className="cc-link" to="/data-intake">Open Data Intake <ArrowRight size={13} aria-hidden="true" /></Link>}>
          <CardState state={{ ...profiles, loading: profiles.loading || (!profiles.data && !profiles.error), retry: loadProfiles }}
            empty={profiles.data && !profiles.data.length ? 'No saved mapping rules yet. They are created when you save a mapping during an upload.' : null}>
            <KitTable columns={ruleColumns} rows={profiles.data || []} getRowId={(p) => String(p.id)} scroll />
          </CardState>
        </Card>
      )}

      {tab === 'usage' && (
        <Card title="Where custom data sits" sub="Custom fields ranked by how many tyre records carry them (top 12).">
          <CardState state={{ ...statsState, retry: loadFieldStats }} empty={!statsState.loading && !registry.length ? 'No custom fields yet.' : null}>
            <div className="cdm-bars" role="list">
              {bars.map((b) => (
                <button key={b.key} type="button" role="listitem" className="cdm-bar" onClick={() => { setSelectedKey(b.key); setTab('fields') }} title={`${b.key}: ${b.records} records`}>
                  <span className="cdm-bar-label cdm-mono">{b.key}</span>
                  <span className="cc-bar-track"><i style={{ width: `${b.pct}%`, background: b.status === 'mapped' ? 'var(--cc-green)' : 'var(--cc-amber)' }} /></span>
                  <b>{fmtInt(b.records)}</b>
                </button>
              ))}
            </div>
            <p className="cdm-note"><i className="cdm-dot good" /> Mapped <i className="cdm-dot warn" /> Unmapped. Select a bar to open the field.</p>
          </CardState>
        </Card>
      )}

      <Card title="Data preservation and lineage" sub="How each import batch kept its rows (latest 200 batches in scope).">
        <CardState state={{ ...batches, retry: loadBatches }} empty={scopedBatches && !scopedBatches.length ? 'No import batches recorded yet.' : null}>
          <KitTable columns={lineageColumns} rows={lineage} getRowId={(l) => String(l.id)} compact scroll />
        </CardState>
      </Card>

      <Modal open={!!deleteTarget} onClose={deleting ? undefined : () => { setDeleteTarget(null); setDeleteError('') }} title={t('customdata.synonyms.delete.title')} size="md"
        footer={<div className="cdm-modal-foot">
          <button type="button" onClick={() => { setDeleteTarget(null); setDeleteError('') }} disabled={deleting} className="cc-btn-ghost">{t('customdata.synonyms.delete.cancel')}</button>
          <button type="button" onClick={deleteSynonym} disabled={deleting} className="cc-btn-primary cdm-danger-fill"><Trash2 size={14} aria-hidden="true" /> {deleting ? t('customdata.synonyms.delete.deleting') : t('customdata.synonyms.delete.confirm')}</button>
        </div>}>
        {deleteTarget && (
          <div className="cdm-form">
            <p>{t('customdata.synonyms.delete.questionBefore')}<span className="cdm-mono">{deleteTarget.custom_name}</span>{t('customdata.synonyms.delete.questionAfter')}</p>
            <p className="cc-na">{t('customdata.synonyms.delete.warningBefore')}<b>{fieldName(deleteTarget.maps_to)}</b>{t('customdata.synonyms.delete.warningAfter')}</p>
            {deleteError && <p role="alert" className="cdm-err">{deleteError}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

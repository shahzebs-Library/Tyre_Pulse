/**
 * RfidRegistry (route /rfid-registry) - RFID tag inventory, reader/zone health,
 * tag alerts and read history over the V122/V132 RFID schema.
 *
 * Every figure comes from the pure engine `src/lib/rfidRegistryAnalytics.js`
 * (tested). All registers read every row through fetchAllPages (ordered with an
 * id tiebreak) and render in EnterpriseTable, which pages and sorts all of them;
 * nothing is sliced to a preview.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Radio, Tag, MapPin, AlertCircle, CheckCircle, Plus, Search, RefreshCw, Pencil, Trash2,
  BarChart3, History, Link2, Signal, FileSpreadsheet, FileText, ShieldAlert, Activity, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import RfidScanner from '../components/RfidScanner'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { ACCENTS, colorAt } from '../lib/reportColors'
import {
  summarizeRfidRegistry, filterTags, filterReaders, filterAlerts, filterHistory, topOpenAlerts,
  readsByZone, distinctValues, tagRows, readerRows, alertRows, historyRows,
  TAG_STATUSES, TAG_STATUS_LABEL, ALERT_SEVERITIES, READER_HEALTH_LABEL, READER_STALE_HOURS,
} from '../lib/rfidRegistryAnalytics'

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

// Read-event history grows with every scan; bound it and SAY when the bound is hit.
const HISTORY_MAX = 20000

const STATUS_BADGE = {
  available: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  assigned: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50',
  attached: 'bg-green-900/40 text-green-300 border border-green-700/50',
  removed: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
  lost: 'bg-red-900/40 text-red-300 border border-red-700/50',
  damaged: 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
}
const STATUS_COLOUR = {
  available: ACCENTS.info, assigned: ACCENTS.watch, attached: ACCENTS.good,
  removed: ACCENTS.neutral, lost: ACCENTS.risk, damaged: '#a855f7',
}
const SEVERITY_BADGE = {
  low: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
  medium: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50',
  high: 'bg-orange-900/40 text-orange-300 border border-orange-700/50',
  critical: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const SEVERITY_COLOUR = { critical: ACCENTS.risk, high: '#f97316', medium: ACCENTS.watch, low: ACCENTS.neutral }
const HEALTH_BADGE = {
  online: STATUS_BADGE.attached, stale: SEVERITY_BADGE.medium, never: SEVERITY_BADGE.low, inactive: SEVERITY_BADGE.high,
}
const RSSI_TONE = { strong: 'text-green-400', fair: 'text-yellow-400', weak: 'text-red-400' }

const TAB_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'tags', label: 'Tag inventory', icon: Tag },
  { id: 'readers', label: 'Readers and zones', icon: MapPin },
  { id: 'alerts', label: 'Alerts', icon: AlertCircle },
  { id: 'history', label: 'Read history', icon: History },
]

const NA = 'N/A'
const TICK = 'var(--text-muted)'
const GRID = 'var(--panel-2)'
const EMPTY_TAG = { tag_uid: '', tag_epc: '', tag_type: 'UHF', manufacturer: '', site: '' }

const fmtDate = (v) => { if (!v) return NA; const d = new Date(v); return Number.isNaN(d.getTime()) ? NA : d.toLocaleDateString() }
const fmtDateTime = (v) => { if (!v) return NA; const d = new Date(v); return Number.isNaN(d.getTime()) ? NA : d.toLocaleString() }
const txt = (v) => (v == null || v === '' ? NA : v)

function Badge({ cls, children }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{children}</span>
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      {label}
      <select className="input min-h-[44px] text-sm" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  )
}

function SearchBox({ label, value, onChange, placeholder }) {
  return (
    <label className="relative flex-1 min-w-[200px] self-end">
      <span className="sr-only">{label}</span>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
      <input className="input pl-9 text-sm w-full min-h-[44px]" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export default function RfidRegistry() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)

  const [tags, setTags] = useState([])
  const [readers, setReaders] = useState([])
  const [alerts, setAlerts] = useState([])
  const [history, setHistory] = useState(null) // null = not loaded yet (lazy tab)
  const [historyTruncated, setHistoryTruncated] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const [tagsSearch, setTagsSearch] = useState('')
  const [tagsFilter, setTagsFilter] = useState('all')
  const [tagsSiteFilter, setTagsSiteFilter] = useState('all')
  const [readersSearch, setReadersSearch] = useState('')
  const [readersHealth, setReadersHealth] = useState('all')
  const [alertsFilter, setAlertsFilter] = useState('open')
  const [alertsSeverity, setAlertsSeverity] = useState('all')
  const [alertsSearch, setAlertsSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historySite, setHistorySite] = useState('all')

  const [showTagForm, setShowTagForm] = useState(false)
  const [editingTag, setEditingTag] = useState(null)
  const [tagFormData, setTagFormData] = useState(EMPTY_TAG)
  const [linkTyre, setLinkTyre] = useState(null)
  const [savingTag, setSavingTag] = useState(false)
  const [tagFormError, setTagFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)

  const now = useMemo(() => new Date(), [lastUpdated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tags, readers and ALL alerts (the open/all scope is a client-side filter, so
  // switching it can never show a stale open-only list as "all").
  const loadData = useCallback(async () => {
    setError(null)
    try {
      const [tagRes, readerRes, alertRes] = await Promise.all([
        fetchAllPages((from, to) => supabase
          .from('rfid_tags')
          .select('*, tyre_records!left(id, serial_no, asset_no, brand, site, status)')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)),
        fetchAllPages((from, to) => supabase
          .from('rfid_readers')
          .select('*')
          .order('site')
          .order('zone_name')
          .order('id', { ascending: true })
          .range(from, to)),
        fetchAllPages((from, to) => supabase
          .from('rfid_alerts')
          .select('*, rfid_tags!left(tag_uid)')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)),
      ])
      const failed = tagRes.error || readerRes.error || alertRes.error
      if (failed) throw failed
      setTags(tagRes.data || [])
      setReaders(readerRes.data || [])
      setAlerts(alertRes.data || [])
      setLastUpdated(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load RFID data.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetchAllPages((from, to) => supabase
        .from('rfid_read_events')
        .select('*, rfid_readers!left(name, zone_name)')
        .order('read_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), { max: HISTORY_MAX })
      if (res.error) throw res.error
      setHistory(res.data || [])
      setHistoryTruncated(!!res.truncated)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the read history.'))
      setHistory((prev) => prev ?? [])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (activeTab === 'history' && history === null) loadHistory() }, [activeTab, history, loadHistory])

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([loadData(), activeTab === 'history' ? loadHistory() : null])
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => summarizeRfidRegistry({ tags, readers, alerts, now }), [tags, readers, alerts, now])
  const sites = useMemo(() => distinctValues(tags, (t) => t.site), [tags])
  const historySites = useMemo(() => distinctValues(history || [], (h) => h.site), [history])
  const tagList = useMemo(() => tagRows(filterTags(tags, { search: tagsSearch, status: tagsFilter, site: tagsSiteFilter })), [tags, tagsSearch, tagsFilter, tagsSiteFilter])
  const readerList = useMemo(() => readerRows(filterReaders(readers, { search: readersSearch, health: readersHealth, now }), now), [readers, readersSearch, readersHealth, now])
  const alertList = useMemo(() => alertRows(filterAlerts(alerts, { scope: alertsFilter, severity: alertsSeverity, search: alertsSearch })), [alerts, alertsFilter, alertsSeverity, alertsSearch])
  const historyList = useMemo(() => historyRows(filterHistory(history || [], { search: historySearch, site: historySite })), [history, historySearch, historySite])
  const zoneReads = useMemo(() => readsByZone(filterHistory(history || [], { search: historySearch, site: historySite })).slice(0, 10), [history, historySearch, historySite])
  const urgent = useMemo(() => alertRows(topOpenAlerts(alerts, 5)), [alerts])

  const statusChart = useMemo(() => ({
    labels: TAG_STATUSES.map((s) => TAG_STATUS_LABEL[s]),
    datasets: [{ data: TAG_STATUSES.map((s) => stats.byStatus[s]), backgroundColor: TAG_STATUSES.map((s) => STATUS_COLOUR[s]), borderWidth: 0 }],
  }), [stats])
  const severityChart = useMemo(() => ({
    labels: ALERT_SEVERITIES.map((s) => s.charAt(0).toUpperCase() + s.slice(1)),
    datasets: [{ label: 'Open alerts', data: ALERT_SEVERITIES.map((s) => stats.openBySeverity[s]), backgroundColor: ALERT_SEVERITIES.map((s) => SEVERITY_COLOUR[s]), borderRadius: 4 }],
  }), [stats])
  const zoneChart = useMemo(() => ({
    labels: zoneReads.map((z) => z.zone),
    datasets: [{ label: 'Reads', data: zoneReads.map((z) => z.reads), backgroundColor: zoneReads.map((_, i) => colorAt(i)), borderRadius: 4 }],
  }), [zoneReads])
  const barOpts = (horizontal) => ({
    responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: false } },
    scales: { x: { ticks: { color: TICK, precision: 0 }, grid: { color: GRID } }, y: { ticks: { color: TICK, precision: 0 }, grid: { color: GRID } } },
  })

  // ── Writes ─────────────────────────────────────────────────────────────────
  function openTagForm(tag = null) {
    setEditingTag(tag)
    setLinkTyre(null)
    setTagFormError('')
    setTagFormData(tag ? {
      tag_uid: tag.tag_uid || '', tag_epc: tag.tag_epc || '', tag_type: tag.tag_type || 'UHF',
      manufacturer: tag.manufacturer || '', site: tag.site || '',
    } : EMPTY_TAG)
    setShowTagForm(true)
  }

  function closeTagForm() {
    if (savingTag) return
    setShowTagForm(false)
    setEditingTag(null)
    setLinkTyre(null)
    setTagFormData(EMPTY_TAG)
  }

  async function saveTag() {
    if (!tagFormData.tag_uid.trim()) { setTagFormError('A tag UID is required.'); return }
    setSavingTag(true); setTagFormError('')
    const fields = {
      tag_uid: tagFormData.tag_uid.trim(),
      tag_epc: tagFormData.tag_epc.trim() || null,
      tag_type: tagFormData.tag_type,
      manufacturer: tagFormData.manufacturer.trim() || null,
      site: tagFormData.site.trim() || null,
    }
    try {
      // Editing changes the descriptive fields only: it must not reset an
      // attached tag to "available" or wipe its lifecycle timestamps.
      const { error: err } = editingTag
        ? await supabase.from('rfid_tags').update(fields).eq('id', editingTag.id)
        : await supabase.from('rfid_tags').insert({
          ...fields,
          status: 'available',
          ...(linkTyre ? { tyre_record_id: linkTyre.id } : {}),
        })
      if (err) throw err
      setSavingTag(false)
      closeTagForm()
      loadData()
    } catch (err) {
      setTagFormError(toUserMessage(err, 'Could not save the tag.'))
      setSavingTag(false)
    }
  }

  async function confirmDeleteTag() {
    if (!deleteTarget) return
    setDeleting(true); setActionError(null)
    try {
      const { error: err } = await supabase.from('rfid_tags').delete().eq('id', deleteTarget.id)
      if (err) throw err
      setDeleteTarget(null)
      loadData()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the tag.'))
    } finally {
      setDeleting(false)
    }
  }

  async function resolveAlert(alertId) {
    setResolvingId(alertId); setActionError(null)
    try {
      const { error: err } = await supabase.from('rfid_alerts').update({ resolved_at: new Date() }).eq('id', alertId)
      if (err) throw err
      loadData()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not resolve the alert.'))
    } finally {
      setResolvingId(null)
    }
  }

  // A scan that finds a tyre opens a NEW tag prefilled to link to that tyre.
  function handleScannerResult(result) {
    if (!result?.tyre) return
    setEditingTag(null)
    setTagFormError('')
    setTagFormData({ ...EMPTY_TAG, site: result.tyre.site || '' })
    setLinkTyre({ id: result.tyre.id, serial: result.tyre.serial_no || result.tyre.serial_number || null })
    setActiveTab('tags')
    setShowTagForm(true)
  }

  // ── Columns ────────────────────────────────────────────────────────────────
  const tagColumns = useMemo(() => [
    { id: 'tag_uid', header: 'Tag UID', accessorFn: (r) => r.tag_uid ?? '', cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{txt(row.original.tag_uid)}</span> },
    { id: 'tag_type', header: 'Type', accessorFn: (r) => r.tag_type ?? '', cell: ({ row }) => txt(row.original.tag_type) },
    { id: 'manufacturer', header: 'Manufacturer', accessorFn: (r) => r.manufacturer ?? '', cell: ({ row }) => txt(row.original.manufacturer) },
    { id: 'serial', header: 'Tyre serial', accessorFn: (r) => r.serial ?? '', cell: ({ row }) => txt(row.original.serial) },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset ?? '', cell: ({ row }) => txt(row.original.asset) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', cell: ({ row }) => txt(row.original.site) },
    { id: 'status', header: 'Status', accessorFn: (r) => r.statusLabel, cell: ({ row }) => <Badge cls={STATUS_BADGE[row.original.status] || STATUS_BADGE.removed}>{row.original.statusLabel}</Badge> },
    { id: 'last_seen', header: 'Last seen', accessorFn: (r) => r.lastSeenMs ?? -1, cell: ({ row }) => fmtDate(row.original.last_seen_at) },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openTagForm(row.original.raw)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label={`Edit tag ${row.original.tag_uid || ''}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setDeleteTarget(row.original.raw)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/30" aria-label={`Delete tag ${row.original.tag_uid || ''}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [])

  const readerColumns = useMemo(() => [
    { id: 'name', header: 'Reader', accessorFn: (r) => r.name ?? '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{txt(row.original.name)}</span> },
    { id: 'zone', header: 'Zone', accessorFn: (r) => r.zone ?? '', cell: ({ row }) => txt(row.original.zone) },
    { id: 'zoneType', header: 'Zone type', accessorFn: (r) => r.zoneType ?? '', cell: ({ row }) => txt(row.original.zoneType) },
    { id: 'type', header: 'Reader type', accessorFn: (r) => r.type ?? '', cell: ({ row }) => txt(row.original.type) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', cell: ({ row }) => txt(row.original.site) },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status ?? '', cell: ({ row }) => txt(row.original.status) },
    { id: 'health', header: 'Health', accessorFn: (r) => r.healthLabel, cell: ({ row }) => <Badge cls={HEALTH_BADGE[row.original.health]}>{row.original.healthLabel}</Badge> },
    { id: 'silence', header: 'Silent for', accessorFn: (r) => r.silenceHours ?? -1, meta: { align: 'right' }, cell: ({ row }) => (row.original.silenceHours == null ? NA : `${row.original.silenceHours} h`) },
    { id: 'firmware', header: 'Firmware', accessorFn: (r) => r.firmware ?? '', cell: ({ row }) => txt(row.original.firmware) },
  ], [])

  const alertColumns = useMemo(() => [
    { id: 'severity', header: 'Severity', accessorFn: (r) => r.severityRank, cell: ({ row }) => <Badge cls={SEVERITY_BADGE[row.original.severity] || SEVERITY_BADGE.low}>{txt(row.original.severity)}</Badge> },
    { id: 'tag_uid', header: 'Tag', accessorFn: (r) => r.tag_uid ?? '', cell: ({ row }) => <span className="font-mono text-xs">{txt(row.original.tag_uid)}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => r.type },
    { id: 'message', header: 'Message', accessorFn: (r) => r.message ?? '', cell: ({ row }) => <span className="line-clamp-2">{txt(row.original.message)}</span> },
    { id: 'zone', header: 'Zone', accessorFn: (r) => r.zone ?? '', cell: ({ row }) => txt(row.original.zone) },
    { id: 'created', header: 'Raised', accessorFn: (r) => r.createdMs ?? -1, cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.created_at)}</span> },
    { id: 'state', header: 'State', accessorFn: (r) => r.state },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (row.original.resolved ? null : (
        <button
          type="button"
          onClick={() => resolveAlert(row.original.id)}
          disabled={resolvingId === row.original.id}
          className="text-xs px-3 min-h-[44px] rounded-lg border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 disabled:opacity-50"
        >
          <CheckCircle size={13} aria-hidden="true" /> Resolve
        </button>
      )),
    },
  ], [resolvingId]) // eslint-disable-line react-hooks/exhaustive-deps

  const historyColumns = useMemo(() => [
    { id: 'read_at', header: 'Time', accessorFn: (r) => r.readMs ?? -1, cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.read_at)}</span> },
    { id: 'tag_uid', header: 'Tag UID', accessorFn: (r) => r.tag_uid ?? '', cell: ({ row }) => <span className="font-mono text-xs">{txt(row.original.tag_uid)}</span> },
    { id: 'zone', header: 'Zone', accessorFn: (r) => r.zone ?? '', cell: ({ row }) => txt(row.original.zone) },
    { id: 'reader', header: 'Reader', accessorFn: (r) => r.reader ?? '', cell: ({ row }) => txt(row.original.reader) },
    {
      id: 'rssi', header: 'Signal', accessorFn: (r) => r.rssi ?? -999, meta: { align: 'right' },
      cell: ({ row }) => (row.original.rssi == null ? NA : <span className={RSSI_TONE[row.original.rssiBand]}>{row.original.rssi} dBm, {row.original.rssiLabel}</span>),
    },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', cell: ({ row }) => txt(row.original.site) },
  ], [])

  // ── Export (the active tab's filtered rows) ────────────────────────────────
  const EXPORTS = {
    tags: { rows: tagList, cols: ['tag_uid', 'tag_type', 'manufacturer', 'serial', 'asset', 'site', 'statusLabel', 'last_seen_at'], headers: ['Tag UID', 'Type', 'Manufacturer', 'Tyre serial', 'Asset', 'Site', 'Status', 'Last seen'], title: 'RFID Tag Inventory' },
    readers: { rows: readerList, cols: ['name', 'zone', 'zoneType', 'type', 'site', 'status', 'healthLabel', 'silenceHours', 'firmware'], headers: ['Reader', 'Zone', 'Zone type', 'Reader type', 'Site', 'Status', 'Health', 'Silent hours', 'Firmware'], title: 'RFID Readers' },
    alerts: { rows: alertList, cols: ['severity', 'tag_uid', 'type', 'message', 'zone', 'created_at', 'state'], headers: ['Severity', 'Tag', 'Type', 'Message', 'Zone', 'Raised', 'State'], title: 'RFID Alerts' },
    history: { rows: historyList, cols: ['read_at', 'tag_uid', 'zone', 'reader', 'rssi', 'rssiLabel', 'site'], headers: ['Time', 'Tag UID', 'Zone', 'Reader', 'RSSI dBm', 'Signal', 'Site'], title: 'RFID Read History' },
  }
  const exportKey = activeTab === 'dashboard' ? 'tags' : activeTab
  const exp = EXPORTS[exportKey]
  const shape = (rows) => rows.map((r) => Object.fromEntries(exp.cols.map((c) => [c, r[c] == null ? '' : r[c]])))
  const fileBase = reportFileName(exp.title, reportDateLabel())
  const doExcel = async () => {
    try { await exportToExcel(shape(exp.rows), exp.cols, exp.headers, fileBase) } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    try { await exportToPdf(shape(exp.rows), exp.cols.map((k, i) => ({ key: k, header: exp.headers[i] })), exp.title, fileBase, 'landscape') } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const tagFiltersActive = tagsSearch || tagsFilter !== 'all' || tagsSiteFilter !== 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID Registry"
        subtitle="Tyre tracking with RFID tags, zone readers, tag alerts and read history."
        icon={Radio}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        updatedAt={lastUpdated}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} disabled={!exp.rows.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} disabled={!exp.rows.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => setScannerOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Radio size={14} aria-hidden="true" /> Scan RFID tag
            </button>
          </div>
        }
      />

      {error && (
        <Card tone="crit" role="alert" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <AlertCircle size={18} className="text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-primary)] flex-1 min-w-0">{error}</p>
          <button type="button" onClick={handleRefresh} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Retry
          </button>
        </Card>
      )}
      {actionError && (
        <Card tone="warn" role="alert" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertCircle size={16} className="text-amber-300 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-primary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError(null)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={15} /></button>
        </Card>
      )}

      {/* KPI strip (always visible) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <StatTile label="Total tags" value={loading ? NA : stats.totalTags} icon={Tag} />
        <StatTile label="Attached" value={loading ? NA : stats.byStatus.attached} icon={Link2} tone="accent" sub={stats.attachedPct == null ? 'no tags' : `${stats.attachedPct}% of tags`} />
        <StatTile label="Available" value={loading ? NA : stats.byStatus.available} icon={Tag} tone="info" />
        <StatTile label="Lost or damaged" value={loading ? NA : stats.lostOrDamaged} icon={ShieldAlert} tone="crit" sub={`${stats.byStatus.lost} lost, ${stats.byStatus.damaged} damaged`} />
        <StatTile label="Linked to tyre" value={loading ? NA : stats.linkedToTyre} icon={Link2} tone="info" sub={stats.linkedPct == null ? 'no tags' : `${stats.linkedPct}% of tags`} />
        <StatTile label="Readers online" value={loading ? NA : `${stats.readerHealth.online}/${stats.totalReaders}`} icon={Signal} tone="accent" sub={`${stats.readerHealth.stale} silent over ${READER_STALE_HOURS} h`} />
        <StatTile label="Open alerts" value={loading ? NA : stats.alertsOpen} icon={AlertCircle} tone="warn" sub={`${stats.alertsToday} raised today`} />
        <StatTile label="Critical open" value={loading ? NA : stats.criticalOpen} icon={ShieldAlert} tone="crit" />
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="RFID sections" className="flex gap-2 flex-wrap">
        {TAB_OPTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`rfid-tab-${id}`}
            aria-selected={activeTab === id}
            aria-controls="rfid-panel"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 min-h-[44px] rounded-xl text-sm font-medium transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
              activeTab === id
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'bg-[var(--surface-2)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={15} aria-hidden="true" /> {label}
            {id === 'alerts' && stats.alertsOpen > 0 && <span className="text-[11px] tabular-nums opacity-80">({stats.alertsOpen})</span>}
          </button>
        ))}
      </div>

      <div id="rfid-panel" role="tabpanel" aria-labelledby={`rfid-tab-${activeTab}`} className="space-y-4">
        {activeTab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader title="Tags by status" />
                <div className="h-56">
                  {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
                    : stats.totalTags ? <Doughnut data={statusChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: TICK, boxWidth: 12 } } } }} />
                      : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No tags registered yet.</div>}
                </div>
              </Card>
              <Card>
                <CardHeader title="Open alerts by severity" />
                <div className="h-56">
                  {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
                    : stats.alertsOpen ? <Bar data={severityChart} options={barOpts(false)} />
                      : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No open alerts.</div>}
                </div>
              </Card>
              <Card>
                <CardHeader title="Reader health" description={`Stale means no heartbeat for over ${READER_STALE_HOURS} hours.`} />
                {stats.totalReaders === 0 && !loading ? (
                  <p className="text-sm text-[var(--text-muted)]">No readers registered yet.</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-3">
                    {Object.keys(READER_HEALTH_LABEL).map((k) => (
                      <div key={k} className="rounded-lg bg-[var(--input-bg)] p-3">
                        <dt className="text-xs text-[var(--text-muted)]">{READER_HEALTH_LABEL[k]}</dt>
                        <dd className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{loading ? NA : stats.readerHealth[k]}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Quick actions" icon={Activity} />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Add tag', icon: Plus, onClick: () => { setActiveTab('tags'); openTagForm() } },
                    { label: 'Scan tag', icon: Radio, onClick: () => setScannerOpen(true) },
                    { label: 'Reader health', icon: MapPin, onClick: () => setActiveTab('readers') },
                    { label: 'Open alerts', icon: AlertCircle, onClick: () => setActiveTab('alerts') },
                  ].map(({ label, icon: Icon, onClick }) => (
                    <button key={label} type="button" onClick={onClick} className="flex flex-col items-center gap-2 p-4 min-h-[44px] rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)] hover:border-[var(--accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                      <Icon size={22} className="text-[var(--accent)]" aria-hidden="true" />
                      <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
                    </button>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Most urgent open alerts" icon={AlertCircle} iconTone="crit" description="Highest severity first, then newest." />
                {loading ? <div className="h-32 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
                  : urgent.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No open alerts. Every alert has been resolved.</p>
                    : (
                      <ul className="divide-y divide-[var(--input-border)]">
                        {urgent.map((a) => (
                          <li key={a.id} className="py-2.5 flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2 min-w-0">
                              <Badge cls={SEVERITY_BADGE[a.severity] || SEVERITY_BADGE.low}>{txt(a.severity)}</Badge>
                              <span className="text-sm text-[var(--text-primary)] min-w-0 break-words">{txt(a.message)}</span>
                            </div>
                            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{fmtDate(a.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
              </Card>
            </div>
          </>
        )}

        {activeTab === 'tags' && (
          <>
            <div className="flex gap-3 flex-wrap items-end">
              <SearchBox label="Search tags" value={tagsSearch} onChange={setTagsSearch} placeholder="Search UID, EPC, serial, asset, manufacturer" />
              <FilterSelect label="Status" value={tagsFilter} onChange={setTagsFilter}>
                <option value="all">All statuses</option>
                {TAG_STATUSES.map((s) => <option key={s} value={s}>{TAG_STATUS_LABEL[s]}</option>)}
              </FilterSelect>
              <FilterSelect label="Site" value={tagsSiteFilter} onChange={setTagsSiteFilter}>
                <option value="all">All sites</option>
                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              </FilterSelect>
              {tagFiltersActive && (
                <button type="button" onClick={() => { setTagsSearch(''); setTagsFilter('all'); setTagsSiteFilter('all') }} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5"><X size={14} aria-hidden="true" /> Clear</button>
              )}
              <button type="button" onClick={() => openTagForm()} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                <Plus size={14} aria-hidden="true" /> Add tag
              </button>
            </div>
            <Card pad="none">
              <EnterpriseTable
                columns={tagColumns}
                data={tagList}
                getRowId={(r) => String(r.id)}
                loading={loading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                emptyMessage={tags.length === 0 ? 'No RFID tags registered yet. Use "Add tag" or scan a tag to start.' : 'No tags match these filters.'}
              />
            </Card>
          </>
        )}

        {activeTab === 'readers' && (
          <>
            <div className="flex gap-3 flex-wrap items-end">
              <SearchBox label="Search readers" value={readersSearch} onChange={setReadersSearch} placeholder="Search reader, zone, site, UID" />
              <FilterSelect label="Health" value={readersHealth} onChange={setReadersHealth}>
                <option value="all">All readers</option>
                {Object.entries(READER_HEALTH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </FilterSelect>
            </div>
            <Card pad="none">
              <EnterpriseTable
                columns={readerColumns}
                data={readerList}
                getRowId={(r) => String(r.id)}
                loading={loading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                emptyMessage={readers.length === 0 ? 'No readers registered. Readers are provisioned by the RFID integration.' : 'No readers match these filters.'}
              />
            </Card>
          </>
        )}

        {activeTab === 'alerts' && (
          <>
            <div className="flex gap-3 flex-wrap items-end">
              <SearchBox label="Search alerts" value={alertsSearch} onChange={setAlertsSearch} placeholder="Search tag, message, type, zone" />
              <FilterSelect label="Scope" value={alertsFilter} onChange={setAlertsFilter}>
                <option value="open">Open alerts</option>
                <option value="all">All alerts</option>
              </FilterSelect>
              <FilterSelect label="Severity" value={alertsSeverity} onChange={setAlertsSeverity}>
                <option value="all">All severities</option>
                {ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </FilterSelect>
            </div>
            <Card pad="none">
              <EnterpriseTable
                columns={alertColumns}
                data={alertList}
                getRowId={(r) => String(r.id)}
                loading={loading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                emptyMessage={alertsFilter === 'open' ? 'No open alerts. Switch the scope to see resolved ones.' : 'No alerts recorded.'}
              />
            </Card>
          </>
        )}

        {activeTab === 'history' && (
          <>
            <div className="flex gap-3 flex-wrap items-end">
              <SearchBox label="Search read history" value={historySearch} onChange={setHistorySearch} placeholder="Search tag UID, zone, reader" />
              <FilterSelect label="Site" value={historySite} onChange={setHistorySite}>
                <option value="all">All sites</option>
                {historySites.map((s) => <option key={s} value={s}>{s}</option>)}
              </FilterSelect>
            </div>
            {historyTruncated && (
              <Card tone="info" role="status"><p className="text-sm text-[var(--text-muted)]">Showing the newest {HISTORY_MAX.toLocaleString()} read events. Older reads are not loaded.</p></Card>
            )}
            {zoneReads.length > 0 && (
              <Card>
                <CardHeader title="Reads by zone" description="Busiest zones in the filtered history." />
                <div className="h-56"><Bar data={zoneChart} options={barOpts(true)} /></div>
              </Card>
            )}
            <Card pad="none">
              <EnterpriseTable
                columns={historyColumns}
                data={historyList}
                getRowId={(r) => String(r.id)}
                loading={history === null || historyLoading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                emptyMessage={(history || []).length === 0 ? 'No read events recorded yet.' : 'No read events match these filters.'}
              />
            </Card>
          </>
        )}
      </div>

      {/* Tag form. No <form> element, so the actions sit in the footer. */}
      <Modal
        open={showTagForm}
        onClose={closeTagForm}
        title={editingTag ? 'Edit RFID tag' : 'Add RFID tag'}
        size="md"
        footer={(
          <>
            <button type="button" onClick={closeTagForm} disabled={savingTag} className="btn-secondary min-h-[44px]">Cancel</button>
            <button type="button" onClick={saveTag} className="btn-primary min-h-[44px] disabled:opacity-50" disabled={!tagFormData.tag_uid.trim() || savingTag}>
              {savingTag ? 'Saving' : 'Save tag'}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          {linkTyre && (
            <p className="text-sm text-[var(--text-muted)] rounded-lg bg-[var(--input-bg)] px-3 py-2">
              This tag will be linked to tyre <span className="font-mono text-[var(--text-primary)]">{linkTyre.serial || 'from the scan'}</span>.
            </p>
          )}
          {[
            { key: 'tag_uid', label: 'Tag UID (required)', placeholder: 'Enter the RFID tag UID' },
            { key: 'tag_epc', label: 'EPC code', placeholder: 'Optional EPC code' },
            { key: 'manufacturer', label: 'Manufacturer', placeholder: 'e.g. Impinj, Zebra' },
            { key: 'site', label: 'Site', placeholder: 'Assign to site' },
          ].map((f) => (
            <div key={f.key}>
              <label htmlFor={`rfid-${f.key}`} className="text-xs font-semibold text-[var(--text-muted)] uppercase">{f.label}</label>
              <input
                id={`rfid-${f.key}`}
                type="text"
                className="input w-full mt-1 min-h-[44px]"
                value={tagFormData[f.key]}
                onChange={(e) => setTagFormData({ ...tagFormData, [f.key]: e.target.value })}
                placeholder={f.placeholder}
              />
            </div>
          ))}
          <div>
            <label htmlFor="rfid-tag_type" className="text-xs font-semibold text-[var(--text-muted)] uppercase">Tag type</label>
            <select id="rfid-tag_type" className="input w-full mt-1 min-h-[44px]" value={tagFormData.tag_type} onChange={(e) => setTagFormData({ ...tagFormData, tag_type: e.target.value })}>
              <option value="UHF">UHF</option>
              <option value="HF">HF</option>
              <option value="NFC">NFC</option>
              <option value="Barcode">Barcode</option>
            </select>
          </div>
          {tagFormError && (
            <p role="alert" className="text-sm text-red-300 bg-red-900/20 rounded-lg px-3 py-2">{tagFormError}</p>
          )}
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => { if (!deleting) setDeleteTarget(null) }}
        size="sm"
        title="Delete this RFID tag?"
        footer={(
          <>
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="btn-secondary min-h-[44px]">Cancel</button>
            <button type="button" onClick={confirmDeleteTag} disabled={deleting} className="btn-danger min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-60">
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          Tag <span className="font-mono text-[var(--text-primary)]">{deleteTarget?.tag_uid || ''}</span> and its alerts and read events will be permanently removed. This cannot be undone.
        </p>
      </Modal>

      <AnimatePresence>
        {scannerOpen && (
          <RfidScanner onClose={() => setScannerOpen(false)} onResult={handleScannerResult} />
        )}
      </AnimatePresence>
    </div>
  )
}

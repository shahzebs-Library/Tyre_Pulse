/**
 * RfidRegistry (route /rfid-registry) - RFID tags for tyres, vehicles and
 * assets, rebuilt on the shared page kit to the owner's light reference design.
 *
 * Runs on the LIVE schema: `rfid_tags` is the V132 shape (tag_id, tyre_serial,
 * asset_no, site, status active | unassigned | retired, last_scanned_at,
 * notes). The previous page read V122 columns (tag_uid, tag_epc, tag_type,
 * manufacturer, tyre_record_id) that this table does not have, so every load
 * failed. Readers, alerts and read events are the V122 tables and link back by
 * tag row id or tag UID text.
 *
 * Every derived figure comes from the pure engine src/lib/rfidRegistryView.js:
 * duplicates are the same normalised tag id on more than one row, "not found"
 * is an open lost / not-seen alert, item type comes from the mapped tyre or the
 * fleet register. Read success rate, signal and scan counts need read events;
 * none are recorded today, so they read N/A or 0 honestly.
 *
 * Kept from the previous page: register / edit / delete, reader health, alert
 * register with resolve, read history, the camera / barcode scanner that opens
 * a prefilled tag form, Excel and PDF export of the filtered register, loading /
 * error with Retry / empty states. Every register reads all rows through
 * fetchAllPages (ordered, with an id tiebreak); nothing is capped.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, Upload, ScanLine, Tag, CheckCircle2, CircleDashed, Copy, AlertTriangle, Radio,
  Download, List, LayoutGrid, Search, Pencil, Trash2, History, Repeat, X, RefreshCw,
  Truck, CircleDot, Construction, Container, Package, Smartphone, Keyboard, Info, Signal,
  CheckCircle, FileSpreadsheet, FileText,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import RfidScanner from '../components/RfidScanner'
import {
  Card, CardState, Kpi, PageHero, Donut, Pager, KitTable, Tabs, fmtInt, ViewAll,
} from '../components/commandCenter/kit'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/api/_client'
import { COLS as TAG_COLS, createTag, updateTag, deleteTag, findByTag } from '../lib/api/rfid'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { parseWorkbook } from '../lib/import/parseWorkbook'
import {
  filterAlerts, alertRows, historyRows, filterHistory, readerRows, distinctValues,
  ALERT_SEVERITIES, READER_HEALTH_LABEL, READER_STALE_HOURS,
} from '../lib/rfidRegistryAnalytics'
import {
  buildTagRows, summarizeTagRows, stateSegments, countByItemType, scanActivity, filterTagRows,
  assignmentHistory, registrationsByDay, planTagImport, tagExportRows, normalizeTagId,
  TAG_EXPORT_COLUMNS, TAG_STATES, TAG_STATE_LABEL, ITEM_TYPES, ITEM_TYPE_LABEL, RFID_STATUSES,
} from '../lib/rfidRegistryView'
import './rfidRegistry.css'

const HISTORY_MAX = 20000
const CHUNK = 200
const STATE_COLORS = { assigned: '#16a34a', unassigned: '#f59e0b', duplicate: '#dc2626', lost: '#2563eb', retired: '#94a3b8' }
const TYPE_ICON = { tyre: CircleDot, vehicle: Truck, equipment: Construction, trailer: Container, other: Package }
const TYPE_COLOR = { tyre: '#16a34a', vehicle: '#2563eb', equipment: '#9333ea', trailer: '#f59e0b', other: '#64748b' }
const STATUS_LABEL = { active: 'Active', unassigned: 'Unassigned', retired: 'Retired' }
const EMPTY_FORM = { tag_id: '', tyre_serial: '', asset_no: '', site: '', status: '', notes: '' }
const TABS = [
  { key: 'all', label: 'All tags' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'duplicate', label: 'Duplicate tags' },
  { key: 'lost', label: 'Not found / lost' },
  { key: 'scans', label: 'Scan history' },
  { key: 'imports', label: 'Import history' },
  { key: 'types', label: 'Tag types' },
  { key: 'settings', label: 'Settings' },
]
const REGISTER_TABS = new Set(['all', 'assigned', 'unassigned', 'duplicate', 'lost'])

const fmtDateTime = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'
}
const fmtDay = (v) => {
  const t = typeof v === 'number' ? v : (v ? Date.parse(v) : NaN)
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'
}
const na = (v) => (v == null || v === '' ? <span className="cc-na">N/A</span> : v)

/** Read every row of a paged query or throw. */
async function readAll(build, opts) {
  const res = await fetchAllPages(build, opts)
  if (res.error) throw res.error
  return { rows: res.data || [], truncated: !!res.truncated }
}

/** Look up rows by a key list in chunks (enrichment; never the source of truth). */
async function lookupIn(table, cols, key, values) {
  const out = []
  const list = [...new Set(values.filter(Boolean))]
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await supabase.from(table).select(cols).in(key, list.slice(i, i + CHUNK))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

function SignalBars({ signal }) {
  if (!signal) return <span className="cc-na">N/A</span>
  const n = signal.key === 'strong' ? 4 : signal.key === 'fair' ? 3 : 1
  return (
    <span className={`rr-signal ${signal.key}`} title={`${signal.rssi} dBm, ${signal.label}`} aria-label={`Signal ${signal.label}, ${signal.rssi} dBm`}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? 'on' : ''} style={{ height: 3 + i * 3 }} />)}
    </span>
  )
}

function StatePill({ row }) {
  return <span className={`cc-pill ${row.stateTone}`}>{row.stateLabel}</span>
}

function TypeCell({ type }) {
  const Icon = TYPE_ICON[type] || Package
  return <span className="rr-type"><Icon size={14} aria-hidden="true" /> {ITEM_TYPE_LABEL[type]}</span>
}

/** Vertical bars for tags by item type. */
function TypeBars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <div className="rr-vbars" role="img" aria-label={items.map((i) => `${i.label} ${i.count}`).join(', ')}>
      {items.map((i) => {
        const Icon = TYPE_ICON[i.key]
        return (
          <div key={i.key} className="rr-vbar">
            <b>{fmtInt(i.count)}</b>
            <span className="rr-vbar-track"><span style={{ height: `${(i.count / max) * 100}%`, background: TYPE_COLOR[i.key] }} /></span>
            <Icon size={16} aria-hidden="true" />
            <small>{i.label}</small>
          </div>
        )
      })}
    </div>
  )
}

/** Area line of reads per day. */
function ActivityChart({ series }) {
  const W = 420; const H = 150; const L = 30; const B = 20; const T = 8
  const max = Math.max(1, ...series.map((p) => p.count))
  const x = (i) => L + (i / Math.max(1, series.length - 1)) * (W - L - 6)
  const y = (v) => T + (1 - v / max) * (H - T - B)
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ')
  const area = `${line} L${x(series.length - 1).toFixed(1)},${H - B} L${L},${H - B} Z`
  const ticks = [0, Math.round(max / 2), max]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rr-area" role="img" aria-label={`Reads per day over the last ${series.length} days`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="rr-grid" />
          <text x={L - 5} y={y(v) + 3} textAnchor="end" className="cc-axis">{v}</text>
        </g>
      ))}
      <path d={area} fill="var(--cc-green-tint)" />
      <path d={line} fill="none" stroke="var(--cc-green)" strokeWidth="2" />
      {series.map((p, i) => (i % 5 === 0 || i === series.length - 1) && (
        <text key={p.key} x={x(i)} y={H - 5} textAnchor="middle" className="cc-axis">{new Date(p.ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>
      ))}
    </svg>
  )
}

export default function RfidRegistry() {
  const { activeCountry } = useSettings()
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null

  // ── Feeds, each loading and failing on its own ─────────────────────────────
  const [tagsState, setTagsState] = useState({ loading: true, data: null, error: null })
  const [enrich, setEnrich] = useState({ tyres: new Map(), fleet: new Map(), error: null })
  const [eventsState, setEventsState] = useState({ loading: true, data: null, error: null, truncated: false })
  const [alertsState, setAlertsState] = useState({ loading: true, data: null, error: null })
  const [readersState, setReadersState] = useState({ loading: true, data: null, error: null })

  const loadTags = useCallback(async () => {
    setTagsState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { rows } = await readAll((from, to) => applyCountry(supabase.from('rfid_tags').select(TAG_COLS), country)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to))
      setTagsState({ loading: false, data: rows, error: null })
      try {
        const [tyres, fleet] = await Promise.all([
          lookupIn('tyre_records', 'serial_no, brand, size, asset_no, site', 'serial_no', rows.map((r) => r.tyre_serial?.trim())),
          lookupIn('vehicle_fleet', 'asset_no, make, model, vehicle_type, site, country', 'asset_no', rows.map((r) => r.asset_no?.trim())),
        ])
        const tMap = new Map(); for (const t of tyres) tMap.set(String(t.serial_no).trim().toUpperCase(), t)
        const fMap = new Map()
        for (const f of fleet) {
          const k = String(f.asset_no).trim().toUpperCase()
          if (!fMap.has(k) || (country && f.country === country)) fMap.set(k, f)
        }
        setEnrich({ tyres: tMap, fleet: fMap, error: null })
      } catch (e) {
        setEnrich({ tyres: new Map(), fleet: new Map(), error: toUserMessage(e, 'Could not read tyre and asset details.') })
      }
    } catch (e) {
      setTagsState({ loading: false, data: null, error: toUserMessage(e, 'Could not load RFID tags.') })
    }
  }, [country])

  const loadEvents = useCallback(async () => {
    setEventsState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { rows, truncated } = await readAll((from, to) => applyCountry(supabase.from('rfid_read_events').select('*, rfid_readers!left(name, zone_name)'), country)
        .order('read_at', { ascending: false }).order('id', { ascending: true }).range(from, to), { max: HISTORY_MAX })
      setEventsState({ loading: false, data: rows, error: null, truncated })
    } catch (e) {
      setEventsState({ loading: false, data: null, error: toUserMessage(e, 'Could not load the scan history.'), truncated: false })
    }
  }, [country])

  const loadAlerts = useCallback(async () => {
    setAlertsState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { rows } = await readAll((from, to) => applyCountry(supabase.from('rfid_alerts').select('*'), country)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to))
      setAlertsState({ loading: false, data: rows, error: null })
    } catch (e) {
      setAlertsState({ loading: false, data: null, error: toUserMessage(e, 'Could not load RFID alerts.') })
    }
  }, [country])

  const loadReaders = useCallback(async () => {
    setReadersState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { rows } = await readAll((from, to) => applyCountry(supabase.from('rfid_readers').select('*'), country)
        .order('site').order('zone_name').order('id', { ascending: true }).range(from, to))
      setReadersState({ loading: false, data: rows, error: null })
    } catch (e) {
      setReadersState({ loading: false, data: null, error: toUserMessage(e, 'Could not load RFID readers.') })
    }
  }, [country])

  useEffect(() => { loadTags() }, [loadTags])
  useEffect(() => { loadEvents() }, [loadEvents])
  useEffect(() => { loadAlerts() }, [loadAlerts])
  useEffect(() => { loadReaders() }, [loadReaders])
  const reloadAll = () => { loadTags(); loadEvents(); loadAlerts(); loadReaders() }

  // ── UI state ───────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('all')
  const [view, setView] = useState('list')
  const [filters, setFilters] = useState({ type: 'all', site: 'all', status: 'all', make: 'all', search: '' })
  const [showMore, setShowMore] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [selection, setSelection] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [histFilter, setHistFilter] = useState({ search: '', site: 'all' })
  const [alertFilter, setAlertFilter] = useState({ scope: 'open', severity: 'all', search: '' })
  const [resolvingId, setResolvingId] = useState(null)

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }

  // ── Derived ────────────────────────────────────────────────────────────────
  const now = useMemo(() => new Date(), [eventsState.data, tagsState.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => buildTagRows({
    tags: tagsState.data || [], tyresBySerial: enrich.tyres, fleetByAsset: enrich.fleet,
    events: eventsState.error ? null : eventsState.data, alerts: alertsState.data || [],
  }), [tagsState.data, enrich, eventsState.data, eventsState.error, alertsState.data])
  const summary = useMemo(() => summarizeTagRows(rows), [rows])
  const segments = useMemo(() => stateSegments(summary, STATE_COLORS), [summary])
  const typeCounts = useMemo(() => countByItemType(rows), [rows])
  const activity = useMemo(() => (eventsState.error ? null : scanActivity(eventsState.data, now, 30)), [eventsState.data, eventsState.error, now])
  const sites = useMemo(() => distinctValues(rows, (r) => r.site), [rows])
  const makes = useMemo(() => distinctValues(rows, (r) => r.makeModel), [rows])
  const filtered = useMemo(() => filterTagRows(rows, { tab: REGISTER_TABS.has(tab) ? tab : 'all', ...filters }), [rows, tab, filters])
  const pageRows = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page, pageSize])
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || filtered[0] || null, [rows, filtered, selectedId])
  const history = useMemo(() => assignmentHistory(rows), [rows])
  const registrations = useMemo(() => registrationsByDay(rows), [rows])
  const existingIds = useMemo(() => new Set(rows.map((r) => normalizeTagId(r.tagId)).filter(Boolean)), [rows])
  const eventRows = useMemo(() => historyRows(filterHistory(eventsState.data || [], histFilter)), [eventsState.data, histFilter])
  const eventSites = useMemo(() => distinctValues(eventsState.data || [], (h) => h.site), [eventsState.data])
  const tagUidById = useMemo(() => new Map(rows.map((r) => [r.id, r.tagId])), [rows])
  const alertList = useMemo(() => alertRows(filterAlerts((alertsState.data || []).map((a) => ({ ...a, tag_uid: a.tag_uid || tagUidById.get(a.tag_id) || null })), alertFilter)), [alertsState.data, alertFilter, tagUidById])
  const readerList = useMemo(() => readerRows(readersState.data || [], now), [readersState.data, now])
  const openAlerts = (alertsState.data || []).filter((a) => !a.resolved_at).length

  useEffect(() => { setPage(0) }, [tab])

  const tagCard = { loading: tagsState.loading, data: tagsState.data, error: tagsState.error, retry: loadTags }
  const eventsCard = { loading: eventsState.loading, data: eventsState.data, error: eventsState.error, retry: loadEvents }

  // ── Writes ─────────────────────────────────────────────────────────────────
  const [form, setForm] = useState(null) // { editing, values, linkNote }
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const openForm = (row = null, prefill = {}) => {
    setFormError('')
    setForm({
      editing: row,
      values: row
        ? { tag_id: row.tagId || '', tyre_serial: row.serial || '', asset_no: row.asset || '', site: row.raw.site || '', status: row.status || '', notes: row.notes || '' }
        : { ...EMPTY_FORM, ...prefill },
    })
  }
  const closeForm = () => { if (!saving) setForm(null) }
  const setFormValue = (k, v) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }))

  async function saveForm() {
    const v = form.values
    if (!normalizeTagId(v.tag_id)) { setFormError('A tag ID is required.'); return }
    if (!form.editing && existingIds.has(normalizeTagId(v.tag_id))) { setFormError('This tag ID is already registered. Open it from the register to change it.'); return }
    setSaving(true); setFormError('')
    try {
      if (form.editing) {
        await updateTag(form.editing.id, {
          tag_id: v.tag_id, tyre_serial: v.tyre_serial, asset_no: v.asset_no,
          site: v.site.trim() || null, notes: v.notes.trim() || null, ...(v.status ? { status: v.status } : {}),
        })
      } else {
        const created = await createTag({ ...v, status: v.status || undefined, country })
        if (created?.id) setSelectedId(created.id)
      }
      setForm(null)
      loadTags()
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not save the tag.'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true); setActionError('')
    try {
      await deleteTag(deleteTarget.id)
      setDeleteTarget(null)
      if (selectedId === deleteTarget.id) setSelectedId(null)
      loadTags()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not delete the tag.'))
    } finally {
      setDeleting(false)
    }
  }

  async function resolveAlert(id) {
    setResolvingId(id); setActionError('')
    try {
      const { error } = await supabase.from('rfid_alerts').update({ resolved_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      loadAlerts()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not resolve the alert.'))
    } finally {
      setResolvingId(null)
    }
  }

  // Camera / barcode scanner: a found tyre opens a new tag prefilled to it.
  function handleScannerResult(result) {
    const t = result?.tyre
    if (!t) return
    setScannerOpen(false)
    openForm(null, { tyre_serial: t.serial_no || '', asset_no: t.asset_no || '', site: t.site || '' })
  }

  // ── Scan card (keyboard wedge / manual entry) ──────────────────────────────
  const [scanMode, setScanMode] = useState('handheld')
  const [scanCode, setScanCode] = useState('')
  const [scanArmed, setScanArmed] = useState(false)
  const [scanMulti, setScanMulti] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanResults, setScanResults] = useState([])
  const scanInput = useRef(null)

  const armScanner = (multi) => {
    setScanMulti(multi)
    setScanArmed(true)
    setTimeout(() => scanInput.current?.focus(), 0)
  }

  async function lookupScan(raw) {
    const code = normalizeTagId(raw)
    if (!code) return
    setScanBusy(true)
    try {
      const found = await findByTag(code, { country })
      const entry = { key: `${code}-${Date.now()}`, code, at: new Date().toISOString(), found: !!found, id: found?.id || null }
      setScanResults((list) => (scanMulti ? [entry, ...list].slice(0, 50) : [entry]))
      if (found) { setSelectedId(found.id); loadTags() }
    } catch (e) {
      setScanResults((list) => [{ key: `${code}-${Date.now()}`, code, at: new Date().toISOString(), error: toUserMessage(e, 'Lookup failed.') }, ...(scanMulti ? list : [])])
    } finally {
      setScanBusy(false)
      setScanCode('')
      if (scanMulti) scanInput.current?.focus()
    }
  }

  // ── Bulk import ────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false)
  const [importPlan, setImportPlan] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [importProgress, setImportProgress] = useState(null)

  async function readImportFile(file) {
    if (!file) return
    setImportMsg(''); setImportPlan(null)
    try {
      const wb = await parseWorkbook(file, { fileName: file.name })
      const sheet = wb.sheets?.[0]
      if (!sheet || !sheet.rows?.length) { setImportMsg('That file has no rows to import.'); return }
      setImportPlan({ fileName: file.name, ...planTagImport(sheet.rows, existingIds) })
    } catch (e) {
      setImportMsg(toUserMessage(e, 'Could not read that file.'))
    }
  }

  async function runImport() {
    if (!importPlan?.valid.length) return
    setImportBusy(true); setImportMsg('')
    let done = 0; const failed = []
    for (const p of importPlan.valid) {
      try { await createTag({ ...p, country }); done += 1 } catch (e) { failed.push(`${p.tag_id}: ${toUserMessage(e, 'failed')}`) }
      setImportProgress({ done: done + failed.length, total: importPlan.valid.length })
    }
    setImportBusy(false); setImportProgress(null)
    setImportMsg(`${done} tag${done === 1 ? '' : 's'} registered${failed.length ? `, ${failed.length} failed (${failed.slice(0, 3).join('; ')})` : ''}.`)
    setImportPlan(null)
    if (done) { setNotice(`${done} tag${done === 1 ? '' : 's'} imported from the file.`); loadTags() }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportScope = () => {
    const picked = Object.keys(selection).filter((k) => selection[k])
    return picked.length ? filtered.filter((r) => picked.includes(String(r.id))) : filtered
  }
  const exportFile = async (kind) => {
    const data = tagExportRows(exportScope())
    const cols = TAG_EXPORT_COLUMNS.map(([k]) => k)
    const headers = TAG_EXPORT_COLUMNS.map(([, h]) => h)
    const base = reportFileName('RFID Tag Register', reportDateLabel())
    try {
      if (kind === 'xlsx') await exportToExcel(data, cols, headers, base)
      else await exportToPdf(data, cols.map((k, i) => ({ key: k, header: headers[i] })), 'RFID Tag Register', base, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }
  const [exportOpen, setExportOpen] = useState(false)

  // ── Columns ────────────────────────────────────────────────────────────────
  const tagColumns = [
    { key: 'tagId', header: 'RFID tag ID', cell: (r) => <button type="button" className="rr-id-btn" onClick={() => setSelectedId(r.id)}>{r.tagId || 'N/A'}</button> },
    { key: 'itemType', header: 'Type', cell: (r) => <TypeCell type={r.itemType} /> },
    {
      key: 'assetOrTyre', header: 'Asset / tyre no.',
      cell: (r) => (r.asset
        ? <Link className="rr-link" to={`/asset-management/${encodeURIComponent(r.asset)}`}>{r.asset}</Link>
        : r.serial ? <Link className="rr-link" to={`/tyre-passport/${encodeURIComponent(r.serial)}`}>{r.serial}</Link> : <span className="cc-na">Not mapped</span>),
    },
    { key: 'makeModel', header: 'Make / model', cell: (r) => na(r.makeModel) },
    { key: 'sizeSpec', header: 'Size / spec', cell: (r) => na(r.sizeSpec) },
    { key: 'site', header: 'Site / location', cell: (r) => na(r.site) },
    { key: 'state', header: 'Status', cell: (r) => <StatePill row={r} /> },
    { key: 'lastScannedAt', header: 'Last scanned', cell: (r) => (r.lastScannedAt ? fmtDateTime(r.lastScannedAt) : <span className="cc-na">Never</span>) },
    { key: 'signal', header: 'Signal', cell: (r) => <SignalBars signal={r.signal} /> },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <span className="rr-actions">
          <button type="button" className="cc-btn" onClick={() => setSelectedId(r.id)}>View</button>
          <button type="button" className="cc-icon-btn" aria-label={`Edit tag ${r.tagId || ''}`} onClick={() => openForm(r)}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn rr-danger" aria-label={`Delete tag ${r.tagId || ''}`} onClick={() => setDeleteTarget(r)}><Trash2 size={14} /></button>
        </span>
      ),
    },
  ]

  const historyCols = [
    { key: 'read_at', header: 'Date and time', sortValue: (r) => r.readMs ?? -1, cell: (r) => fmtDateTime(r.read_at) },
    { key: 'tag_uid', header: 'Tag ID', cell: (r) => <span className="rr-mono">{r.tag_uid || 'N/A'}</span> },
    { key: 'zone', header: 'Location', cell: (r) => na(r.zone || r.site) },
    { key: 'reader', header: 'Reader', cell: (r) => na(r.reader) },
    { key: 'rssi', header: 'Signal', sortValue: (r) => r.rssi ?? -999, cell: (r) => (r.rssi == null ? <span className="cc-na">N/A</span> : <SignalBars signal={{ key: r.rssiBand, label: r.rssiLabel, rssi: r.rssi }} />) },
  ]
  const alertCols = [
    { key: 'severity', header: 'Severity', sortValue: (r) => r.severityRank, cell: (r) => <span className={`cc-pill ${r.severity === 'critical' || r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'muted'}`}>{r.severity || 'N/A'}</span> },
    { key: 'tag_uid', header: 'Tag', cell: (r) => <span className="rr-mono">{r.tag_uid || 'N/A'}</span> },
    { key: 'type', header: 'Type' },
    { key: 'message', header: 'Message', cell: (r) => na(r.message) },
    { key: 'zone', header: 'Zone', cell: (r) => na(r.zone) },
    { key: 'created_at', header: 'Raised', sortValue: (r) => r.createdMs ?? -1, cell: (r) => fmtDateTime(r.created_at) },
    { key: 'state', header: 'State' },
    {
      key: 'act', header: '', sortable: false,
      cell: (r) => (r.resolved ? null : (
        <button type="button" className="cc-btn" disabled={resolvingId === r.id} onClick={() => resolveAlert(r.id)}>
          <CheckCircle size={12} aria-hidden="true" /> Resolve
        </button>
      )),
    },
  ]
  const readerCols = [
    { key: 'name', header: 'Reader', cell: (r) => na(r.name) },
    { key: 'zone', header: 'Zone', cell: (r) => na(r.zone) },
    { key: 'type', header: 'Reader type', cell: (r) => na(r.type) },
    { key: 'site', header: 'Site', cell: (r) => na(r.site) },
    { key: 'healthLabel', header: 'Health', cell: (r) => <span className={`cc-pill ${r.health === 'online' ? 'good' : r.health === 'stale' ? 'warn' : 'muted'}`}>{r.healthLabel}</span> },
    { key: 'silenceHours', header: 'Silent for', sortValue: (r) => r.silenceHours ?? -1, cell: (r) => (r.silenceHours == null ? <span className="cc-na">N/A</span> : `${r.silenceHours} h`) },
    { key: 'firmware', header: 'Firmware', cell: (r) => na(r.firmware) },
  ]

  const kpis = [
    { icon: Tag, tone: 't-green', value: summary.total, label: 'Total RFID tags', onClick: () => setTab('all') },
    { icon: CheckCircle2, tone: 't-green', value: summary.assigned, label: 'Assigned tags', onClick: () => setTab('assigned') },
    { icon: CircleDashed, tone: 't-amber', value: summary.unassigned, label: 'Unassigned tags', onClick: () => setTab('unassigned') },
    { icon: Copy, tone: 't-red', value: summary.duplicate, label: 'Duplicate tags', onClick: () => setTab('duplicate'), title: 'The same tag ID registered on more than one row' },
    { icon: AlertTriangle, tone: 't-blue', value: summary.lost, label: 'Not found / lost', onClick: () => setTab('lost'), title: 'Tags with an open lost or not-seen alert' },
    { icon: Signal, tone: 't-green', display: 'N/A', label: 'Read success rate', title: 'Readers do not report failed reads, so a success rate cannot be measured' },
  ]

  const isRegister = REGISTER_TABS.has(tab)
  const tabs = TABS.map((t) => ({
    ...t,
    count: t.key === 'duplicate' && summary.duplicate ? summary.duplicate : t.key === 'lost' && openAlerts ? openAlerts : undefined,
    countTone: t.key === 'duplicate' || t.key === 'lost' ? 'red' : undefined,
  }))

  return (
    <div className="cc rr-page">
      <div className="rr-hero-wrap">
        <PageHero
          title="RFID Registry"
          lead="Manage RFID tags for tyres, vehicles and assets. Track assignments, scan history, and mapping status in real-time."
          imgLight="/dashboard/hero-rfid-light.webp"
          imgDark="/dashboard/hero-rfid-dark.webp"
        />
        <div className="rr-hero-actions">
          <button type="button" className="cc-btn-primary" onClick={() => openForm()}><Plus size={15} aria-hidden="true" /> Register Tag</button>
          <button type="button" className="cc-btn-ghost" onClick={() => { setImportOpen(true); setImportPlan(null); setImportMsg('') }}><Upload size={15} aria-hidden="true" /> Bulk Import</button>
          <button type="button" className="cc-btn-ghost" onClick={() => { document.getElementById('rr-scan-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); armScanner(false) }}><ScanLine size={15} aria-hidden="true" /> Scan RFID</button>
        </div>
      </div>

      {tagsState.error && (
        <div className="cc-card rr-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Could not load RFID tags.</b><p>{tagsState.error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={reloadAll}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card rr-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="cc-card rr-banner ok" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <div><p>{notice}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={tagsState.loading && !tagsState.data} />)}
      </div>

      <div className="rr-tabbar">
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="RFID registry sections" variant="line" />
        <div className="rr-tabbar-actions">
          <div className="rr-export">
            <button type="button" className="cc-btn-ghost" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)} disabled={!filtered.length}>
              <Download size={14} aria-hidden="true" /> Export
            </button>
            {exportOpen && (
              <div className="rr-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); exportFile('xlsx') }}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); exportFile('pdf') }}><FileText size={14} aria-hidden="true" /> PDF</button>
              </div>
            )}
          </div>
          <div className="rr-toggle" role="group" aria-label="Register layout">
            <button type="button" aria-pressed={view === 'list'} aria-label="List view" onClick={() => setView('list')}><List size={15} /></button>
            <button type="button" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')}><LayoutGrid size={15} /></button>
          </div>
        </div>
      </div>

      <div className="rr-charts">
        <Card title="Tag assignment status">
          <CardState state={tagCard} empty={tagsState.data && !rows.length ? 'No RFID tags registered yet.' : null}>
            <Donut segments={segments} total={summary.total} centerLabel="Total tags" onSelect={(sg) => setTab(sg.key === 'retired' ? 'all' : sg.key)} />
          </CardState>
        </Card>
        <Card title="Tags by item type" sub="Tyre when a tyre serial is mapped, else the mapped asset's type">
          <CardState state={tagCard} empty={tagsState.data && !rows.length ? 'No RFID tags registered yet.' : null}>
            <TypeBars items={typeCounts} />
          </CardState>
        </Card>
        <Card title="Scan activity (last 30 days)" sub="From reader read events">
          <CardState state={eventsCard} empty={activity && activity.total === 0 ? 'No reader scans recorded in the last 30 days. Scans appear here once RFID readers send read events.' : null}>
            {activity && (
              <>
                <div className="rr-activity-head">
                  <div><b>{fmtInt(activity.total)}</b><span>Total scans</span></div>
                  <div><b>{activity.avgPerDay}</b><span>Avg. scans / day</span></div>
                </div>
                <div className="rr-area-wrap"><ActivityChart series={activity.series} /></div>
              </>
            )}
          </CardState>
        </Card>
      </div>

      {isRegister && (
        <div className="rr-main">
          <Card className="rr-register">
            <div className="cc-filters rr-filters">
              <select className="cc-select" aria-label="Item type" value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
                <option value="all">All types</option>
                {ITEM_TYPES.map((k) => <option key={k} value={k}>{ITEM_TYPE_LABEL[k]}</option>)}
              </select>
              <select className="cc-select" aria-label="Site" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
                <option value="all">All sites</option>
                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="all">All status</option>
                {TAG_STATES.map((k) => <option key={k} value={k}>{TAG_STATE_LABEL[k]}</option>)}
              </select>
              <select className="cc-select" aria-label="Manufacturer" value={filters.make} onChange={(e) => setFilter('make', e.target.value)}>
                <option value="all">All manufacturers</option>
                {makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <label className="cc-search">
                <Search size={14} aria-hidden="true" />
                <input aria-label="Search tags" placeholder="Search by RFID tag, asset no, tyre no, make, model" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
              </label>
              <button type="button" className="cc-btn-ghost" aria-expanded={showMore} onClick={() => setShowMore((o) => !o)}>More Filters</button>
            </div>
            {showMore && (
              <div className="rr-more">
                <span>Tag record status:</span>
                {RFID_STATUSES.map((st) => (
                  <span key={st} className="cc-pill muted">{STATUS_LABEL[st]}: {fmtInt((tagsState.data || []).filter((t) => t.status === st).length)}</span>
                ))}
                <button type="button" className="cc-btn-ghost" onClick={() => { setFilters({ type: 'all', site: 'all', status: 'all', make: 'all', search: '' }); setPage(0) }}><X size={13} aria-hidden="true" /> Clear filters</button>
                {enrich.error && <span className="rr-warn-note">{enrich.error} Make, model and size read N/A.</span>}
              </div>
            )}

            {view === 'list' ? (
              <KitTable
                className="rr-table"
                columns={tagColumns}
                rows={pageRows}
                getRowId={(r) => String(r.id)}
                loading={tagsState.loading && !tagsState.data}
                manualPagination
                showPagination={false}
                enableSorting={false}
                enableRowSelection
                rowSelection={selection}
                onRowSelectionChange={setSelection}
                onRowClick={(r) => r && setSelectedId(r.id)}
                empty={rows.length === 0 ? 'No RFID tags registered yet. Use Register Tag or Bulk Import to add one.' : 'No tags match these filters.'}
              />
            ) : (
              <div className="rr-grid">
                {pageRows.length === 0 && <div className="cc-empty">{rows.length === 0 ? 'No RFID tags registered yet.' : 'No tags match these filters.'}</div>}
                {pageRows.map((r) => (
                  <button key={r.id} type="button" className={`rr-grid-card ${selected?.id === r.id ? 'on' : ''}`} onClick={() => setSelectedId(r.id)}>
                    <span className="rr-grid-top"><b className="rr-mono">{r.tagId || 'N/A'}</b><StatePill row={r} /></span>
                    <TypeCell type={r.itemType} />
                    <span>{r.asset || r.serial || 'Not mapped'}</span>
                    <small>{r.site || 'No site'} . {r.lastScannedAt ? fmtDay(r.lastScannedAt) : 'Never scanned'}</small>
                  </button>
                ))}
              </div>
            )}
            {Object.values(selection).some(Boolean) && (
              <p className="rr-sel-note">{Object.values(selection).filter(Boolean).length} selected. Export uses the selected tags.</p>
            )}
            <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0) }} noun="tags" />
          </Card>

          <Card className="rr-detail" title="Tag Details" action={selected && <button type="button" className="cc-btn-ghost" onClick={() => openForm(selected)}><Pencil size={13} aria-hidden="true" /> Edit</button>}>
            {!selected ? (
              <div className="cc-empty">{tagsState.loading ? 'Loading tags.' : 'Select a tag to see its details.'}</div>
            ) : (
              <>
                <div className="rr-detail-head">
                  <div><h3 className="rr-mono">{selected.tagId || 'N/A'}</h3><StatePill row={selected} /></div>
                  <span className="rr-detail-icon" aria-hidden="true">{(() => { const I = TYPE_ICON[selected.itemType]; return <I size={30} /> })()}</span>
                </div>
                <dl className="rr-dl">
                  <dt>Tag type</dt><dd>{ITEM_TYPE_LABEL[selected.itemType]}</dd>
                  <dt>EPC / UID</dt><dd className="rr-mono">{selected.tagId || 'N/A'}</dd>
                  <dt>Asset / tyre no.</dt><dd>{selected.asset || selected.serial || 'Not mapped'}</dd>
                  <dt>Make / model</dt><dd>{na(selected.makeModel)}</dd>
                  <dt>Size / spec</dt><dd>{na(selected.sizeSpec)}</dd>
                  <dt>Serial no.</dt><dd>{na(selected.serial)}</dd>
                  <dt>Current location</dt><dd>{na(selected.site)}</dd>
                  <dt>Registered</dt><dd>{fmtDay(selected.registeredAt)}</dd>
                  <dt>Last scanned</dt><dd>{selected.lastScannedAt ? fmtDateTime(selected.lastScannedAt) : 'Never'}</dd>
                  <dt>Scan count</dt><dd>{selected.scanCount == null ? <span className="cc-na">N/A</span> : fmtInt(selected.scanCount)}</dd>
                  <dt>Record status</dt><dd>{STATUS_LABEL[selected.status] || na(selected.status)}</dd>
                  {selected.notes && <><dt>Notes</dt><dd>{selected.notes}</dd></>}
                </dl>
                <p className="rr-foot">Assigned date is not stored; the registration date is shown.</p>
                <div className="rr-detail-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => { setHistFilter({ search: selected.tagId || '', site: 'all' }); setTab('scans') }}><History size={14} aria-hidden="true" /> View History</button>
                  <button type="button" className="cc-btn-ghost" onClick={() => openForm(selected)}><Repeat size={14} aria-hidden="true" /> Reassign</button>
                  <button type="button" className="cc-icon-btn rr-danger" aria-label={`Delete tag ${selected.tagId || ''}`} onClick={() => setDeleteTarget(selected)}><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {tab === 'lost' && (
        <Card title="RFID alerts" sub="Open lost and not-seen alerts mark a tag Not found. Resolve an alert once the tag is located.">
          <div className="cc-filters rr-filters">
            <label className="cc-search"><Search size={14} aria-hidden="true" /><input aria-label="Search alerts" placeholder="Search tag, message, type, zone" value={alertFilter.search} onChange={(e) => setAlertFilter((f) => ({ ...f, search: e.target.value }))} /></label>
            <select className="cc-select" aria-label="Scope" value={alertFilter.scope} onChange={(e) => setAlertFilter((f) => ({ ...f, scope: e.target.value }))}>
              <option value="open">Open alerts</option>
              <option value="all">All alerts</option>
            </select>
            <select className="cc-select" aria-label="Severity" value={alertFilter.severity} onChange={(e) => setAlertFilter((f) => ({ ...f, severity: e.target.value }))}>
              <option value="all">All severities</option>
              {ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <CardState state={{ ...alertsState, retry: loadAlerts }}>
            <KitTable columns={alertCols} rows={alertList} getRowId={(r) => String(r.id)} empty={alertFilter.scope === 'open' ? 'No open RFID alerts. Switch the scope to see resolved ones.' : 'No RFID alerts recorded.'} />
          </CardState>
        </Card>
      )}

      {tab === 'scans' && (
        <Card title="Scan history" sub="Every read event sent by an RFID reader">
          <div className="cc-filters rr-filters">
            <label className="cc-search"><Search size={14} aria-hidden="true" /><input aria-label="Search read history" placeholder="Search tag ID, zone, reader" value={histFilter.search} onChange={(e) => setHistFilter((f) => ({ ...f, search: e.target.value }))} /></label>
            <select className="cc-select" aria-label="Scan site" value={histFilter.site} onChange={(e) => setHistFilter((f) => ({ ...f, site: e.target.value }))}>
              <option value="all">All sites</option>
              {eventSites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {eventsState.truncated && <p className="rr-foot">Showing the newest {fmtInt(HISTORY_MAX)} read events. Older reads are not loaded.</p>}
          <CardState state={eventsCard}>
            <KitTable columns={historyCols} rows={eventRows} getRowId={(r) => String(r.id)} empty={(eventsState.data || []).length === 0 ? 'No read events recorded yet. Readers write them here as tags pass a reading zone.' : 'No read events match these filters.'} />
          </CardState>
        </Card>
      )}

      {tab === 'imports' && (
        <Card title="Import history" sub="Tags registered per day" action={<button type="button" className="cc-btn-ghost" onClick={() => setImportOpen(true)}><Upload size={14} aria-hidden="true" /> Bulk Import</button>}>
          <p className="rr-foot"><Info size={12} aria-hidden="true" /> Import files are not stored for RFID tags, so this lists registrations by day from each tag&apos;s own record.</p>
          <CardState state={tagCard} empty={tagsState.data && !registrations.length ? 'No tags registered yet.' : null}>
            <KitTable
              columns={[
                { key: 'ms', header: 'Date', cell: (r) => fmtDay(r.ms) },
                { key: 'count', header: 'Tags registered', align: 'right', cell: (r) => fmtInt(r.count) },
                { key: 'mapped', header: 'Mapped at registration', align: 'right', cell: (r) => fmtInt(r.mapped) },
              ]}
              rows={registrations}
              getRowId={(r) => r.key}
            />
          </CardState>
        </Card>
      )}

      {tab === 'types' && (
        <Card title="Tag types" sub="Item types derived from each tag's mapping">
          <p className="rr-foot"><Info size={12} aria-hidden="true" /> The register does not record the tag chip type (UHF, HF, NFC), so tags are grouped by the item they are mapped to.</p>
          <CardState state={tagCard}>
            <KitTable
              columns={[
                { key: 'label', header: 'Item type', cell: (r) => <TypeCell type={r.key} /> },
                { key: 'count', header: 'Tags', align: 'right', cell: (r) => fmtInt(r.count) },
                { key: 'share', header: 'Share', align: 'right', cell: (r) => (summary.total ? `${Math.round((r.count / summary.total) * 100)}%` : 'N/A') },
                { key: 'go', header: '', sortable: false, cell: (r) => <button type="button" className="cc-btn" onClick={() => { setFilter('type', r.key); setTab('all') }}>Show tags</button> },
              ]}
              rows={typeCounts}
              getRowId={(r) => r.key}
            />
          </CardState>
        </Card>
      )}

      {tab === 'settings' && (
        <Card title="Readers and zones" sub={`A reader silent for over ${READER_STALE_HOURS} hours is stale. Readers are provisioned by the RFID integration.`}>
          <div className="rr-health">
            {Object.entries(READER_HEALTH_LABEL).map(([k, v]) => (
              <div key={k}><b>{readersState.data ? fmtInt(readerList.filter((r) => r.health === k).length) : 'N/A'}</b><span>{v}</span></div>
            ))}
          </div>
          <CardState state={{ ...readersState, retry: loadReaders }}>
            <KitTable columns={readerCols} rows={readerList} getRowId={(r) => String(r.id)} empty="No readers registered. Readers are provisioned by the RFID integration." />
          </CardState>
        </Card>
      )}

      <div className="rr-bottom">
        <Card title="Scan RFID Tag" className="rr-scan" style={{ scrollMarginTop: 80 }}>
          <div id="rr-scan-card" />
          <Tabs
            tabs={[{ key: 'handheld', label: 'Handheld scanner' }, { key: 'mobile', label: 'Mobile app' }, { key: 'manual', label: 'Manual entry' }]}
            value={scanMode}
            onChange={(k) => { setScanMode(k); setScanArmed(false) }}
            label="Scan method"
          />
          {scanMode === 'mobile' ? (
            <div className="rr-scan-body">
              <Smartphone size={30} aria-hidden="true" />
              <p>Scanning with a phone happens in the Tyre Pulse mobile app, which reads the tag or its barcode and writes the scan to this register.</p>
              <button type="button" className="cc-btn-ghost" onClick={() => setScannerOpen(true)}><ScanLine size={14} aria-hidden="true" /> Use this device&apos;s camera</button>
            </div>
          ) : (
            <form className="rr-scan-body" onSubmit={(e) => { e.preventDefault(); lookupScan(scanCode) }}>
              {scanMode === 'handheld'
                ? <><Radio size={30} aria-hidden="true" /><p>A browser cannot talk to a handheld reader directly. Most readers type the tag ID and press Enter, so start scanning and read the tag with this box focused.</p></>
                : <><Keyboard size={30} aria-hidden="true" /><p>Type or paste a tag ID and press Enter to look it up.</p></>}
              {(scanArmed || scanMode === 'manual') && (
                <input
                  ref={scanInput}
                  className="rr-scan-input"
                  aria-label="Tag ID"
                  placeholder={scanMode === 'handheld' ? 'Waiting for the reader' : 'Tag ID or EPC'}
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  disabled={scanBusy}
                  autoComplete="off"
                />
              )}
              <div className="rr-scan-actions">
                {scanMode === 'handheld' ? (
                  <>
                    <button type="button" className="cc-btn-primary" onClick={() => armScanner(false)}><Radio size={14} aria-hidden="true" /> {scanArmed && !scanMulti ? 'Scanning' : 'Start Scanning'}</button>
                    <button type="button" className="cc-btn-ghost" onClick={() => armScanner(true)}><ScanLine size={14} aria-hidden="true" /> {scanArmed && scanMulti ? 'Scanning multiple' : 'Scan Multiple'}</button>
                  </>
                ) : (
                  <button type="submit" className="cc-btn-primary" disabled={!scanCode.trim() || scanBusy}><Search size={14} aria-hidden="true" /> Look up</button>
                )}
              </div>
              {scanResults.length > 0 && (
                <ul className="rr-scan-results" aria-live="polite">
                  {scanResults.map((r) => (
                    <li key={r.key}>
                      <span className="rr-mono">{r.code}</span>
                      {r.error ? <span className="cc-pill bad">{r.error}</span>
                        : r.found ? <button type="button" className="cc-pill good rr-pill-btn" onClick={() => { setSelectedId(r.id); setTab('all') }}>Found, view</button>
                          : <button type="button" className="cc-pill warn rr-pill-btn" onClick={() => openForm(null, { tag_id: r.code })}>Not registered, register it</button>}
                    </li>
                  ))}
                </ul>
              )}
            </form>
          )}
        </Card>

        <Card title="Recent Scan History" action={<ViewAll label="View all" onClick={() => setTab('scans')} />}>
          <CardState state={eventsCard} empty={eventsState.data && eventsState.data.length === 0 ? 'No reader scans recorded yet.' : null}>
            <KitTable compact columns={historyCols} rows={historyRows((eventsState.data || []).filter((_, i) => i < 5))} getRowId={(r) => String(r.id)} />
          </CardState>
        </Card>

        <Card title="Tag Assignment History" action={<ViewAll label="View all" onClick={() => setTab('imports')} />}>
          <p className="rr-foot">From each tag&apos;s registration and last change. The previous mapping is not stored.</p>
          <CardState state={tagCard} empty={tagsState.data && history.length === 0 ? 'No tag changes recorded yet.' : null}>
            <KitTable
              compact
              columns={[
                { key: 'ms', header: 'Date', cell: (r) => fmtDay(r.ms) },
                { key: 'tagId', header: 'Tag', cell: (r) => <span className="rr-mono">{r.tagId || 'N/A'}</span> },
                { key: 'action', header: 'Action' },
                { key: 'to', header: 'To', cell: (r) => na(r.to) },
              ]}
              rows={history.filter((_, i) => i < 5)}
              getRowId={(r) => r.key}
            />
          </CardState>
        </Card>
      </div>

      <Modal
        open={!!form}
        onClose={closeForm}
        title={form?.editing ? 'Edit RFID tag' : 'Register RFID tag'}
        size="md"
        footer={(
          <>
            <button type="button" className="cc-btn-ghost" onClick={closeForm} disabled={saving}>Cancel</button>
            <button type="button" className="cc-btn-primary" onClick={saveForm} disabled={saving || !form?.values.tag_id.trim()}>{saving ? 'Saving' : 'Save tag'}</button>
          </>
        )}
      >
        {form && (
          <div className="rr-form">
            {[
              { key: 'tag_id', label: 'Tag ID / EPC (required)', placeholder: 'For example E20034120123ABCD' },
              { key: 'tyre_serial', label: 'Tyre serial', placeholder: 'Map to a tyre (optional)' },
              { key: 'asset_no', label: 'Asset no.', placeholder: 'Map to a vehicle or asset (optional)' },
              { key: 'site', label: 'Site', placeholder: 'Site or location' },
            ].map((f) => (
              <label key={f.key} className="cc-field">
                <span>{f.label}</span>
                <input className="rr-input" value={form.values[f.key]} placeholder={f.placeholder} onChange={(e) => setFormValue(f.key, e.target.value)} />
              </label>
            ))}
            <label className="cc-field">
              <span>Record status</span>
              <select className="cc-select" value={form.values.status} onChange={(e) => setFormValue('status', e.target.value)}>
                <option value="">{form.editing ? 'Keep current' : 'Set from the mapping'}</option>
                {RFID_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>Notes</span>
              <textarea className="rr-input" rows={3} value={form.values.notes} onChange={(e) => setFormValue('notes', e.target.value)} />
            </label>
            {formError && <p role="alert" className="rr-error">{formError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => { if (!importBusy) setImportOpen(false) }}
        title="Bulk import RFID tags"
        size="md"
        footer={(
          <>
            <button type="button" className="cc-btn-ghost" onClick={() => setImportOpen(false)} disabled={importBusy}>Close</button>
            <button type="button" className="cc-btn-primary" onClick={runImport} disabled={importBusy || !importPlan?.valid.length}>
              {importBusy ? `Importing ${importProgress?.done || 0} of ${importProgress?.total || 0}` : `Import ${importPlan?.valid.length || 0} tags`}
            </button>
          </>
        )}
      >
        <div className="rr-form">
          <p className="rr-foot">Excel or CSV with a column named Tag ID (or EPC / UID). Optional columns: Tyre serial, Asset no, Site, Status, Notes. Tag IDs already registered are skipped.</p>
          <input type="file" aria-label="Choose a file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => readImportFile(e.target.files?.[0])} disabled={importBusy} />
          {importPlan && (
            <div className="rr-import-plan">
              <p><b>{importPlan.fileName}</b>: {importPlan.valid.length} ready, {importPlan.skipped.length} skipped.</p>
              {importPlan.skipped.length > 0 && (
                <ul>{importPlan.skipped.filter((_, i) => i < 8).map((s) => <li key={`${s.line}-${s.reason}`}>Row {s.line}{s.tagId ? ` (${s.tagId})` : ''}: {s.reason}</li>)}</ul>
              )}
            </div>
          )}
          {importMsg && <p role="status" className="rr-foot">{importMsg}</p>}
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => { if (!deleting) setDeleteTarget(null) }}
        size="sm"
        title="Delete this RFID tag?"
        footer={(
          <>
            <button type="button" className="cc-btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="cc-btn-primary rr-btn-danger" onClick={confirmDelete} disabled={deleting}><Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}</button>
          </>
        )}
      >
        <p className="rr-foot">Tag <span className="rr-mono">{deleteTarget?.tagId || ''}</span> will be removed from the register. Its read events and alerts stay but lose the link. This cannot be undone.</p>
      </Modal>

      <AnimatePresence>
        {scannerOpen && <RfidScanner onClose={() => setScannerOpen(false)} onResult={handleScannerResult} />}
      </AnimatePresence>
    </div>
  )
}

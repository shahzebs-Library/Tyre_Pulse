/**
 * Rfid (route /rfid) - RFID Registry. Register passive/RAIN RFID tags, map them
 * to tyres (by serial) and assets, and resolve a scanned tag to its mapping.
 *
 * Runs on the `rfid_tags` table. KPI strip (mapping coverage, scan freshness,
 * duplicate-serial data quality), tags-by-site and mapping charts, scan lookup,
 * filters + search, a sortable EnterpriseTable register, create/edit, delete,
 * and Excel/PDF export. Tag-id normalisation lives in `src/lib/rfid.js`; every
 * derived figure lives in the pure `src/lib/rfidAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Radio, Plus, Search, X, ScanLine, RefreshCw, AlertTriangle, CheckCircle2, Link2,
  Trash2, Pencil, FileSpreadsheet, FileText, Boxes, Copy, Clock, BarChart3, Unlink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { listTags, createTag, updateTag, deleteTag, findByTag } from '../lib/api/rfid'
import { normalizeTagId, RFID_STATUSES, RFID_STATUS_META } from '../lib/rfid'
import {
  EMPTY_RFID_FILTERS, MAPPING_KEYS, MAPPING_LABEL, SCAN_KEYS, SCAN_LABEL, STALE_SCAN_DAYS,
  enrichTags, filterTags, rfidKpis, tagsBySite, siteOptions, activeRfidFilterCount,
  rfidExportRows, RFID_EXPORT_COLUMNS,
} from '../lib/rfidAnalytics'
import { colorAt } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// Semantic status tints; the label always names the status.
const STATUS_STYLES = {
  active: 'bg-green-500/15 text-green-300 border border-green-500/40',
  unassigned: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
  retired: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const SCAN_TEXT = { recent: 'text-[var(--text-secondary)]', stale: 'text-amber-400', never: 'text-[var(--text-muted)]' }
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
const EMPTY = { tag_id: '', tyre_serial: '', asset_no: '', site: '', status: 'active', notes: '' }

function TagModal({ open, initial, onClose, onSaved, country }) {
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial?.id
      ? {
          tag_id: initial.tag_id || '', tyre_serial: initial.tyre_serial || '',
          asset_no: initial.asset_no || '', site: initial.site || '',
          status: RFID_STATUSES.includes(initial.status) ? initial.status : 'active',
          notes: initial.notes || '',
        }
      : EMPTY)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const close = () => { if (!busy) onClose?.() }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!normalizeTagId(form.tag_id)) { setError('A tag ID is required.'); return }
    setBusy(true)
    try {
      if (editing) await updateTag(initial.id, form)
      else await createTag({ ...form, country: country && country !== 'All' ? country : null })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the tag.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, onSaved, onClose, country])

  return (
    <Modal open={open} onClose={close} title={editing ? 'Edit tag' : 'Register RFID tag'} size="md">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Tag ID (EPC / UID) <span className="text-red-400" aria-hidden="true">*</span></span>
          <input
            className="input w-full font-mono min-h-[44px]"
            placeholder="E2003412B802A001"
            value={form.tag_id}
            maxLength={128}
            required
            onChange={(e) => set('tag_id', e.target.value)}
            autoFocus
          />
          <span className="block text-[11px] text-[var(--text-muted)] mt-1">Normalised to upper case with spaces removed.</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block"><span className="label">Tyre serial</span>
            <input className="input w-full font-mono min-h-[44px]" placeholder="Optional" value={form.tyre_serial} maxLength={128} onChange={(e) => set('tyre_serial', e.target.value)} />
          </label>
          <label className="block"><span className="label">Asset no</span>
            <input className="input w-full min-h-[44px]" placeholder="Optional" value={form.asset_no} maxLength={128} onChange={(e) => set('asset_no', e.target.value)} />
          </label>
          <label className="block"><span className="label">Site</span>
            <input className="input w-full min-h-[44px]" placeholder="Optional" value={form.site} maxLength={128} onChange={(e) => set('site', e.target.value)} />
          </label>
          <label className="block"><span className="label">Status</span>
            <select className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {RFID_STATUSES.map((s) => <option key={s} value={s}>{RFID_STATUS_META[s]?.label || s}</option>)}
            </select>
          </label>
        </div>

        <label className="block"><span className="label">Notes</span>
          <textarea className="input w-full min-h-[80px] resize-y" placeholder="Optional" value={form.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />
        </label>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <RefreshCw size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
            {busy ? 'Saving...' : (editing ? 'Save changes' : 'Register tag')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Scan / lookup panel ──────────────────────────────────────────────────────
function ScanPanel({ country, onEdit }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(undefined) // undefined = idle, null = not found, row = found
  const [error, setError] = useState('')

  const lookup = useCallback(async (e) => {
    e?.preventDefault?.()
    const normalized = normalizeTagId(value)
    if (!normalized) { setResult(undefined); return }
    setBusy(true); setError('')
    try {
      const row = await findByTag(normalized, { country: country && country !== 'All' ? country : undefined })
      setResult(row || null)
    } catch (err) {
      setError(toUserMessage(err, 'Lookup failed.'))
      setResult(undefined)
    } finally {
      setBusy(false)
    }
  }, [value, country])

  return (
    <section className="card space-y-3" aria-labelledby="rfid-scan-heading">
      <h2 id="rfid-scan-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
        <ScanLine size={16} className="text-[var(--brand-bright)]" aria-hidden="true" /> Scan or look up a tag
      </h2>
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[220px]">
          <span className="text-xs text-[var(--text-secondary)]">Tag ID</span>
          <div className="relative mt-1">
            <Radio size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              className="input pl-9 w-full font-mono min-h-[44px]"
              placeholder="Scan or type a tag ID"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </label>
        <button type="submit" disabled={busy || !value.trim()} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
          {busy ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />} Look up
        </button>
        {(result !== undefined || value) && (
          <button type="button" onClick={() => { setValue(''); setResult(undefined); setError('') }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <X size={14} aria-hidden="true" /> Clear
          </button>
        )}
      </form>

      <div aria-live="polite">
        {error && <p className="text-sm text-red-300" role="alert">{error}</p>}

        {result === null && (
          <div className="flex items-center gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="shrink-0" aria-hidden="true" /> No tag registered for "{normalizeTagId(value)}".
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 break-all">
                <CheckCircle2 size={15} className="text-green-400 shrink-0" aria-hidden="true" /> {result.tag_id}
              </p>
              <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[result.status] || STATUS_STYLES.retired}`}>
                {RFID_STATUS_META[result.status]?.label || result.status || 'N/A'}
              </span>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div><dt className="text-[var(--text-muted)]">Tyre serial</dt><dd className="text-[var(--text-secondary)] break-all">{result.tyre_serial || 'N/A'}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Asset</dt><dd className="text-[var(--text-secondary)]">{result.asset_no || 'N/A'}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Site</dt><dd className="text-[var(--text-secondary)]">{result.site || 'N/A'}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Last scanned</dt><dd className="text-[var(--text-secondary)]">{fmtDateTime(result.last_scanned_at)}</dd></div>
            </dl>
            <button type="button" onClick={() => onEdit?.(result)} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px]">
              <Pencil size={12} aria-hidden="true" /> Open in editor
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Rfid() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [filters, setFilters] = useState(EMPTY_RFID_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listTags({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load RFID tags.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const failed = Boolean(error) || missing
  const enriched = useMemo(() => enrichTags(rows || [], nowMs), [rows, nowMs])
  const kpi = useMemo(() => rfidKpis(enriched), [enriched])
  const sites = useMemo(() => siteOptions(rows || []), [rows])
  const filtered = useMemo(() => filterTags(enriched, filters), [enriched, filters])
  const filterCount = activeRfidFilterCount(filters)
  const bySite = useMemo(() => tagsBySite(filtered), [filtered])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((row) => { setEditing(row); setModalOpen(true) }, [])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTag(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the tag.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const doExport = async (kind) => {
    const out = rfidExportRows(filtered)
    const keys = RFID_EXPORT_COLUMNS.map(([k]) => k)
    const headers = RFID_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse RFID Registry')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'RFID Registry', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Total tags', value: kv(kpi.total), icon: Radio, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.byStatus.active} active, ${kpi.byStatus.retired} retired` },
    { label: 'Mapping coverage', value: failed || kpi.mappedPct == null ? null : `${kpi.mappedPct}%`, icon: Link2, tone: 'text-[var(--brand-bright)]', sub: failed ? null : `${kpi.mapped} of ${kpi.total} mapped to a tyre or asset` },
    { label: 'Not mapped', value: kv(kpi.unmapped), icon: Unlink, tone: 'text-amber-400', sub: 'Spare tags with no tyre or asset' },
    { label: 'Assets covered', value: kv(kpi.assets), icon: Boxes, tone: 'text-sky-400' },
    { label: 'Stale or never scanned', value: failed ? null : kpi.stale + kpi.neverScanned, icon: Clock, tone: 'text-orange-400', sub: failed ? null : `${kpi.neverScanned} never, ${kpi.stale} over ${STALE_SCAN_DAYS} days` },
    { label: 'Duplicate serials', value: kv(kpi.duplicates), icon: Copy, tone: kpi.duplicates ? 'text-red-400' : 'text-green-400', sub: 'Tags sharing a tyre serial' },
  ]

  const siteChart = {
    labels: bySite.map((s) => s.site),
    datasets: [{ label: 'Tags', data: bySite.map((s) => s.count), backgroundColor: bySite.map((_, i) => colorAt(i)), borderRadius: 4, maxBarThickness: 32 }],
  }
  const siteOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
      y: { ticks: { color: 'var(--text-secondary)' }, grid: { display: false } },
    },
  }
  const mappingCounts = MAPPING_KEYS.map((k) => filtered.filter((r) => r._mapping === k).length)
  const mappingChart = {
    labels: MAPPING_KEYS.map((k) => MAPPING_LABEL[k]),
    datasets: [{ data: mappingCounts, backgroundColor: MAPPING_KEYS.map((_, i) => colorAt(i)), borderWidth: 0 }],
  }
  const mappingOpts = { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } } }

  const columns = useMemo(() => [
    { id: 'tag', header: 'Tag ID', accessorFn: (r) => r.tag_id || '', size: 190, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)] break-all">{getValue() || 'N/A'}</span> },
    {
      id: 'serial', header: 'Tyre serial', accessorFn: (r) => r.tyre_serial || '', size: 160,
      cell: ({ row }) => {
        const r = row.original
        if (!r.tyre_serial) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <span className="font-mono text-xs text-[var(--text-secondary)] inline-flex flex-wrap items-center gap-1">
            {r.tyre_serial}
            {r._duplicate && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/40">On another tag</span>}
          </span>
        )
      },
    },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'mapping', header: 'Mapping', accessorFn: (r) => MAPPING_LABEL[r._mapping], size: 120 },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 110,
      cell: ({ row }) => <span className={`inline-block text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[row.original.status] || STATUS_STYLES.retired}`}>{row.original._statusLabel}</span>,
    },
    {
      id: 'scanned', header: 'Last scanned', accessorFn: (r) => (r.last_scanned_at ? new Date(r.last_scanned_at).getTime() : null), size: 170, sortUndefined: 'last',
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className={SCAN_TEXT[r._scan]}>
            {r._scan === 'never' ? 'Never scanned' : fmtDateTime(r.last_scanned_at)}
            {r._scanDays != null && <span className="block text-[11px]">{r._scanDays} days ago{r._scan === 'stale' ? ', stale' : ''}</span>}
          </span>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit tag ${row.original.tag_id || ''}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete tag ${row.original.tag_id || ''}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID Registry"
        subtitle="Register RFID tags, map them to tyres and assets, and resolve scans to their mapping."
        icon={Radio}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> Register tag
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">The RFID Registry is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V132_RFID_TAGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load RFID tags.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the register loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {!missing && <ScanPanel country={activeCountry} onEdit={openEdit} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><BarChart3 size={15} aria-hidden="true" /> Tags by site</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: the register could not be loaded.</div>
                : bySite.length ? (
                  <div className="h-full" role="img" aria-label={bySite.map((s) => `${s.site} ${s.count}`).join(', ')}>
                    <Bar data={siteChart} options={siteOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{kpi.total ? 'No tags match these filters.' : 'No RFID tags registered yet.'}</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Link2 size={15} aria-hidden="true" /> Mapping state</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: the register could not be loaded.</div>
                : filtered.length ? (
                  <div className="h-full" role="img" aria-label={MAPPING_KEYS.map((k, i) => `${MAPPING_LABEL[k]} ${mappingCounts[i]}`).join(', ')}>
                    <Doughnut data={mappingChart} options={mappingOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{kpi.total ? 'No tags match these filters.' : 'No RFID tags registered yet.'}</div>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Tag, serial, asset, site, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {RFID_STATUSES.map((s) => <option key={s} value={s}>{RFID_STATUS_META[s]?.label || s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Site</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
              <option value="">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Mapping</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.mapping} onChange={(e) => setFilter('mapping', e.target.value)}>
              <option value="all">Any mapping</option>
              {MAPPING_KEYS.map((k) => <option key={k} value={k}>{MAPPING_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Scan freshness</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.scan} onChange={(e) => setFilter('scan', e.target.value)}>
              <option value="all">Any scan state</option>
              {SCAN_KEYS.map((k) => <option key={k} value={k}>{SCAN_LABEL[k]}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilter('duplicatesOnly', !filters.duplicatesOnly)}
            aria-pressed={filters.duplicatesOnly}
            className={`text-sm inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.duplicatesOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Copy size={14} aria-hidden="true" /> Duplicates
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {kpi.total} tags</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_RFID_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="rfid-tags"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          missing ? 'Enable the RFID Registry to start registering tags.'
            : kpi.total === 0 ? 'No RFID tags registered yet. Use Register tag to add the first one.'
              : 'No tags match these filters.'
        }
      />

      <TagModal
        open={modalOpen}
        initial={editing}
        country={activeCountry}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete tag?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              {deleting ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            This permanently removes tag <span className="font-mono text-[var(--text-primary)] break-all">{confirmDelete.tag_id}</span> from the registry. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}

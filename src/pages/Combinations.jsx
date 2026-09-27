/**
 * Combinations (route /combinations) - Combination Manager + combined-unit tyre
 * intelligence. Two tabs:
 *   - Registry: full CRUD on the `asset_combinations` table (V141), the
 *     operational units fleets dispatch (a prime-mover asset linked to one or
 *     more trailers), with a KPI strip, search + filters, a sortable
 *     EnterpriseTable and Excel/PDF export.
 *   - Unit intelligence: pick a combination and see its resolved member assets
 *     (with data-quality warnings for unresolved ones), blended combined-unit
 *     KPIs (fitted tyres, unit CPK, unit spend, scrap), a position-class
 *     breakdown, and an honest note that live per-tyre pressure/temperature and
 *     the axle schematic need telemetry this dataset does not capture.
 *
 * Tyre maths reuse the canonical calc services (kpiEngine/tco via
 * src/lib/combinations.js); page-side filtering, KPIs and export shapes live in
 * src/lib/combinationsAnalytics.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Combine, Truck, Link2, Boxes, Search, X, Plus, Pencil, Trash2,
  FileSpreadsheet, FileText, AlertTriangle, Database, Network, Gauge,
  DollarSign, Recycle, CircleDot, CheckCircle2, XCircle, Info, Activity, Layers,
  MapPin, Unlink, Copy,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCombinations, createCombination, updateCombination, deleteCombination,
  getCombinationIntelligence, COMBINATION_STATUSES,
} from '../lib/api/combinations'
import { parseTrailerList, computeCombinationRollup, detectDuplicateTrailers } from '../lib/combinations'
import {
  filterCombinations, combinationKpis, siteOptions as siteOptionsOf, registryRow,
  combinationExportRows, COMBINATION_EXPORT_COLUMNS, scrapSharePct, positionRows, memberCoverage,
} from '../lib/combinationsAnalytics'
import { formatCurrency, fmt } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'

const loadExportUtils = () => import('../lib/exportUtils')

const STATUS_STYLES = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  inactive: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const EMPTY_FORM = { name: '', prime_mover_no: '', trailer_nos: '', site: '', status: 'active', notes: '' }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function StatusBadge({ status }) {
  const s = status || 'inactive'
  const Icon = s === 'active' ? CheckCircle2 : XCircle
  return (
    <span className={`badge inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[s] || STATUS_STYLES.inactive}`}>
      <Icon size={11} aria-hidden="true" /> {cap(s)}
    </span>
  )
}

function TabBar({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]">
      {tabs.map((t) => {
        const Icon = t.icon
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-t ${
              active ? 'border-brand-bright text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon size={15} aria-hidden="true" /> {t.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Combinations() {
  const { activeCountry, activeCurrency, appSettings } = useSettings() || {}
  const company = appSettings?.company_name || ''
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)

  const [view, setView] = useState('registry')

  const [statusFilter, setStatusFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [trailerFilter, setTrailerFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [selectedId, setSelectedId] = useState('')
  const [intel, setIntel] = useState(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const [intelError, setIntelError] = useState('')

  const currency = activeCurrency || 'SAR'

  const load = useCallback(async () => {
    setRefreshing(true); setLoadError('')
    try {
      const data = await listCombinations({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      // A failed read stays unknown (null), never an empty registry.
      setLoadError(toUserMessage(err, 'Could not load combinations.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const kpis = useMemo(() => combinationKpis(rows || []), [rows])
  const duplicateTrailers = useMemo(() => detectDuplicateTrailers(rows || []), [rows])
  const siteOptions = useMemo(() => siteOptionsOf(rows || []), [rows])

  const filtered = useMemo(
    () => filterCombinations(rows || [], { status: statusFilter, site: siteFilter, trailers: trailerFilter, search }),
    [rows, statusFilter, siteFilter, trailerFilter, search],
  )
  const tableRows = useMemo(() => filtered.map(registryRow), [filtered])

  const clearFilters = () => { setStatusFilter('all'); setSiteFilter(''); setTrailerFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || siteFilter || trailerFilter !== 'all' || search

  const selectedCombo = useMemo(
    () => (rows || []).find((r) => String(r.id) === String(selectedId)) || null,
    [rows, selectedId],
  )

  useEffect(() => {
    if (!selectedId && rows && rows.length) setSelectedId(String(rows[0].id))
  }, [rows, selectedId])

  const loadIntel = useCallback(async (combo) => {
    if (!combo) { setIntel(null); return }
    setIntelLoading(true); setIntelError('')
    try {
      const data = await getCombinationIntelligence(combo, { country: activeCountry })
      setIntel(data)
    } catch (err) {
      setIntelError(toUserMessage(err, 'Could not load combined-unit data.'))
      setIntel(null)
    } finally {
      setIntelLoading(false)
    }
  }, [activeCountry])

  useEffect(() => {
    if (view === 'intelligence' && selectedCombo) loadIntel(selectedCombo)
  }, [view, selectedCombo, loadIntel])

  const rollup = useMemo(() => {
    if (!selectedCombo || !intel) return null
    return computeCombinationRollup(selectedCombo, intel.tyres, intel.vehicles)
  }, [selectedCombo, intel])

  const runExport = async (format) => {
    setExporting(true); setActionError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const data = combinationExportRows(filtered)
      const file = reportFileName('Asset Combinations')
      if (format === 'pdf') {
        await exportToPdf(data, COMBINATION_EXPORT_COLUMNS, 'Asset Combinations', file, 'landscape', company, {
          meta: { Combinations: kpis.total, Active: kpis.active, 'Trailers linked': kpis.trailers },
        })
      } else {
        await exportToExcel(data, COMBINATION_EXPORT_COLUMNS.map((c) => c.key), COMBINATION_EXPORT_COLUMNS.map((c) => c.header), file, 'Combinations')
      }
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    } finally {
      setExporting(false)
    }
  }

  // Modal
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      name: r.name || '',
      prime_mover_no: r.prime_mover_no || '',
      trailer_nos: parseTrailerList(r.trailer_nos).join(', '),
      site: r.site || '',
      status: r.status || 'active',
      notes: r.notes || '',
    })
    setFormError('')
    setModalOpen(true)
  }, [])
  const closeModal = useCallback(() => {
    if (!saving) { setModalOpen(false); setEditing(null) }
  }, [saving])
  const closeConfirmDelete = useCallback(() => {
    if (!deleting) setConfirmDelete(null)
  }, [deleting])

  const submitForm = async (e) => {
    e.preventDefault()
    setSaving(true); setFormError('')
    try {
      const payload = {
        name: form.name,
        prime_mover_no: form.prime_mover_no,
        trailer_nos: form.trailer_nos,
        site: form.site,
        status: form.status,
        notes: form.notes,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateCombination(editing.id, payload)
      else await createCombination(payload)
      setModalOpen(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save combination.'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteCombination(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete combination.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Name', accessorFn: (r) => r.name || undefined, sortUndefined: 'last', size: 180,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.name || 'N/A'}</span>,
    },
    {
      id: 'prime_mover_no', header: 'Prime mover', accessorFn: (r) => r.prime_mover_no || undefined, sortUndefined: 'last', size: 130,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{row.original.prime_mover_no || 'N/A'}</span>,
    },
    {
      id: 'trailers', header: 'Trailers', accessorFn: (r) => r.trailerCount, size: 240,
      meta: { exportValue: (r) => r.trailers.join(', ') },
      cell: ({ row }) => (row.original.trailers.length ? (
        <div className="flex flex-wrap gap-1">
          {row.original.trailers.map((t, i) => (
            <span key={`${t}-${i}`} className="badge text-[11px] px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)] font-mono">{t}</span>
          ))}
        </div>
      ) : <span className="text-[var(--text-muted)]">None linked</span>),
    },
    {
      id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, sortUndefined: 'last', size: 130,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.site || 'N/A'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.status || 'inactive', size: 110,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const label = r.name || r.prime_mover_no || 'combination'
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(String(r.id)); setView('intelligence') }}
              className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label={`Analyse ${label}`} title="Unit intelligence"><Network size={15} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }}
              className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label={`Edit ${label}`} title="Edit"><Pencil size={15} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }}
              className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              aria-label={`Delete ${label}`} title="Delete"><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ], [openEdit])

  const TABS = [
    { key: 'registry', label: 'Registry', icon: Boxes },
    { key: 'intelligence', label: 'Unit intelligence', icon: Network },
  ]
  const unknown = rows === null
  const v = (n) => (unknown ? 'N/A' : n)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Combination Manager"
        subtitle="Prime-mover and trailer combinations: the operational units your fleet dispatches."
        icon={Combine}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          view === 'registry' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]" disabled={!filtered.length || exporting}>
                <FileSpreadsheet size={14} aria-hidden="true" /> Excel
              </button>
              <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]" disabled={!filtered.length || exporting}>
                <FileText size={14} aria-hidden="true" /> PDF
              </button>
              <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[40px]">
                <Plus size={14} aria-hidden="true" /> New combination
              </button>
            </div>
          ) : null
        }
      />

      <TabBar tabs={TABS} value={view} onChange={setView} label="Combination views" />

      {loadError && view === 'intelligence' && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-red-300 font-medium">Could not load combinations.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1 break-words">{loadError}</p>
            <p className="text-[var(--text-muted)] text-xs mt-2 flex items-center gap-1.5">
              <Database size={12} aria-hidden="true" /> If this is a missing-table error, apply <span className="font-mono">MIGRATIONS_V141_ASSET_COMBINATIONS.sql</span>.
            </p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 min-h-[40px]">Retry</button>
        </Card>
      )}

      {actionError && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-300 flex-1 break-words">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={15} /></button>
        </Card>
      )}

      {duplicateTrailers.length > 0 && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-amber-300 font-medium">
              {duplicateTrailers.length} trailer{duplicateTrailers.length !== 1 ? 's' : ''} assigned to more than one active combination.
            </p>
            <p className="text-[var(--text-muted)] text-sm mt-1">A trailer can only be part of one active unit at a time. Review these registry entries.</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {duplicateTrailers.map((d) => (
                <button type="button" key={d.trailer} onClick={() => { setView('registry'); setSearch(d.trailer) }}
                  className="badge text-[11px] px-2 py-0.5 rounded bg-amber-900/30 text-amber-300 border border-amber-700/50 font-mono hover:bg-amber-900/50"
                  title="Show the combinations holding this trailer">
                  {d.trailer} x{d.combinations.length}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {view === 'registry' ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-[var(--gap-grid)]">
            <StatTile label="Combinations" value={v(kpis.total)} icon={Combine} sub={kpis.sites ? `${kpis.sites} site${kpis.sites === 1 ? '' : 's'}` : undefined} />
            <StatTile label="Active" value={v(kpis.active)} icon={Truck} tone="accent" sub={kpis.activePct == null ? 'N/A of registry' : `${kpis.activePct}% of registry`} />
            <StatTile label="Trailers linked" value={v(kpis.trailers)} icon={Link2} tone="info" sub={kpis.avgTrailersPerUnit == null ? 'Avg N/A per unit' : `Avg ${kpis.avgTrailersPerUnit} per unit`} />
            <StatTile label="Total units" value={v(kpis.units)} icon={Boxes} sub="Prime movers plus trailers" />
            <StatTile label="No trailer linked" value={v(kpis.withoutTrailer)} icon={Unlink} tone={kpis.withoutTrailer > 0 ? 'warn' : 'neutral'} sub="Prime mover only" />
            <StatTile label="Double-booked trailers" value={v(kpis.duplicateTrailers)} icon={Copy} tone={kpis.duplicateTrailers > 0 ? 'crit' : 'neutral'} sub="Across active units" />
          </div>

          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto] items-end gap-2">
              <div className="relative">
                <label htmlFor="combo-search" className="sr-only">Search combinations</label>
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input id="combo-search" className="input pl-9 w-full min-h-[40px]" placeholder="Search name, prime mover, trailer, site" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input min-h-[40px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                <option value="all">All statuses</option>
                {COMBINATION_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
              </select>
              <select className="input min-h-[40px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site">
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input min-h-[40px]" value={trailerFilter} onChange={(e) => setTrailerFilter(e.target.value)} aria-label="Filter by trailer link">
                <option value="all">Any trailer link</option>
                <option value="with">With trailers</option>
                <option value="without">No trailer linked</option>
              </select>
              <div className="flex items-center gap-2 justify-between sm:justify-end">
                {hasFilters && (
                  <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>
                )}
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap" aria-live="polite">{unknown ? 'N/A' : `${filtered.length} of ${kpis.total}`}</span>
              </div>
            </div>
          </Card>

          <EnterpriseTable
            columns={columns}
            data={tableRows}
            getRowId={(r) => String(r.id)}
            loading={unknown && refreshing}
            error={loadError ? `${loadError} If this is a missing-table error, apply MIGRATIONS_V141_ASSET_COMBINATIONS.sql.` : null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            viewKey="combinations-registry"
            initialPageSize={25}
            onRowClick={(r) => openEdit(r)}
            emptyMessage={(rows || []).length === 0 ? 'No combinations yet. Create your first prime-mover and trailer link.' : 'No combinations match these filters.'}
          />
        </>
      ) : (
        <IntelligenceTab
          rows={rows} loading={refreshing}
          selectedId={selectedId} setSelectedId={setSelectedId}
          selectedCombo={selectedCombo}
          intelLoading={intelLoading} intelError={intelError}
          onRetryIntel={() => loadIntel(selectedCombo)}
          rollup={rollup} currency={currency}
        />
      )}

      <Modal open={modalOpen} onClose={closeModal} size="md" title={editing ? 'Edit combination' : 'New combination'}>
        <form onSubmit={submitForm} className="space-y-4">
          <div>
            <label htmlFor="combo-name" className="block text-xs text-[var(--text-muted)] mb-1">Name</label>
            <input id="combo-name" className="input w-full" placeholder="e.g. Route 12 rig" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="combo-pm" className="block text-xs text-[var(--text-muted)] mb-1">Prime mover number <span className="text-red-400" aria-hidden="true">*</span></label>
            <input id="combo-pm" className="input w-full font-mono" placeholder="e.g. PM-1024" value={form.prime_mover_no} onChange={(e) => setForm((f) => ({ ...f, prime_mover_no: e.target.value }))} required aria-required="true" />
          </div>
          <div>
            <label htmlFor="combo-trailers" className="block text-xs text-[var(--text-muted)] mb-1">Trailer numbers</label>
            <input id="combo-trailers" className="input w-full font-mono" placeholder="Comma-separated, e.g. TR-01, TR-02" value={form.trailer_nos} onChange={(e) => setForm((f) => ({ ...f, trailer_nos: e.target.value }))} aria-describedby="combo-trailers-help" />
            <p id="combo-trailers-help" className="text-[11px] text-[var(--text-muted)] mt-1">{parseTrailerList(form.trailer_nos).length} trailer(s)</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="combo-site" className="block text-xs text-[var(--text-muted)] mb-1">Site</label>
              <input id="combo-site" className="input w-full" placeholder="Depot / yard" value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} list="combo-site-options" />
              <datalist id="combo-site-options">{siteOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label htmlFor="combo-status" className="block text-xs text-[var(--text-muted)] mb-1">Status</label>
              <select id="combo-status" className="input w-full" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {COMBINATION_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="combo-notes" className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
            <textarea id="combo-notes" className="input w-full min-h-[72px]" placeholder="Optional context" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>

          {formError && (
            <div role="alert" className="text-sm text-red-300 bg-red-900/30 border border-red-800/50 rounded px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> <span className="break-words">{formError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} disabled={saving} className="btn-secondary text-sm min-h-[40px]">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60 min-h-[40px]">
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create combination'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={closeConfirmDelete}
        size="sm"
        title="Delete combination"
        footer={
          <>
            <button type="button" onClick={closeConfirmDelete} disabled={deleting} className="btn-secondary text-sm min-h-[40px]">Cancel</button>
            <button type="button" onClick={doDelete} disabled={deleting} className="btn-primary text-sm !bg-red-600 hover:!bg-red-700 disabled:opacity-60 min-h-[40px]">
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)] flex items-start gap-2">
          <Trash2 size={16} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Delete <span className="font-semibold text-[var(--text-secondary)]">{confirmDelete?.name || confirmDelete?.prime_mover_no}</span>? This cannot be undone.
          </span>
        </p>
      </Modal>
    </div>
  )
}

// Unit-intelligence tab
function IntelligenceTab({
  rows, loading, selectedId, setSelectedId, selectedCombo, intelLoading, intelError, onRetryIntel, rollup, currency,
}) {
  const posRows = useMemo(() => positionRows(rollup), [rollup])
  const coverage = useMemo(() => memberCoverage(rollup), [rollup])

  const posColumns = useMemo(() => [
    { id: 'label', header: 'Position class', accessorFn: (p) => p.label, size: 200 },
    { id: 'count', header: 'Tyres', accessorFn: (p) => p.count, meta: { align: 'right' }, size: 90 },
    {
      id: 'spend', header: 'Spend', accessorFn: (p) => p.spend, meta: { align: 'right' }, size: 140,
      cell: ({ row }) => formatCurrency(row.original.spend, currency, 0),
    },
    {
      id: 'share', header: 'Share of spend', accessorFn: (p) => p.spendSharePct ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 130,
      cell: ({ row }) => (row.original.spendSharePct == null ? 'N/A' : `${row.original.spendSharePct}%`),
    },
    {
      id: 'cpk', header: 'CPK (blended)', accessorFn: (p) => p.cpk ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 140,
      cell: ({ row }) => <span className="font-mono">{row.original.cpk != null ? `${currency} ${fmt(row.original.cpk, 3)}` : 'N/A'}</span>,
    },
  ], [currency])

  if (rows === null) {
    return loading
      ? <Card><div className="h-40 bg-[var(--input-bg)] rounded animate-pulse" aria-label="Loading combinations" /></Card>
      : <Card className="text-center text-[var(--text-muted)]"><div style={{ paddingBlock: 'var(--space-8)' }}>Combinations could not be loaded. Use Retry above.</div></Card>
  }
  if (rows.length === 0) {
    return (
      <Card className="text-center text-[var(--text-muted)]">
        <div style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
          <Network size={26} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
          No combinations yet. Create one in the Registry tab to analyse it as a combined unit.
        </div>
      </Card>
    )
  }

  const scrapPct = scrapSharePct(rollup)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="combo-select" className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1.5">
            <Combine size={15} className="text-brand-bright" aria-hidden="true" /> Combined unit
          </label>
          <select id="combo-select" className="input w-full sm:w-auto sm:min-w-[260px] min-h-[40px]" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {rows.map((r) => {
              const n = parseTrailerList(r.trailer_nos).length
              return (
                <option key={r.id} value={r.id}>
                  {(r.name || r.prime_mover_no || 'Unnamed')} | {r.prime_mover_no || 'N/A'} ({n} trailer{n !== 1 ? 's' : ''})
                </option>
              )
            })}
          </select>
          {selectedCombo && <StatusBadge status={selectedCombo.status} />}
          {selectedCombo?.site && (
            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {selectedCombo.site}</span>
          )}
        </div>
      </Card>

      {intelError && (
        <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load combined-unit data.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1 break-words">{intelError}</p>
          </div>
          <button type="button" onClick={onRetryIntel} className="btn-secondary text-sm shrink-0 min-h-[40px]">Retry</button>
        </Card>
      )}

      {intelLoading || !rollup ? (
        !intelError && (
          <div className="grid gap-[var(--gap-grid)]" aria-busy="true" aria-label="Loading combined-unit data">
            <Card><div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" /></Card>
            <Card><div className="h-40 bg-[var(--input-bg)] rounded animate-pulse" /></Card>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-[var(--gap-grid)]">
            <StatTile label="Fitted tyres" value={rollup.fittedTyres} icon={CircleDot} tone="info"
              sub={`${rollup.tyreCount} record${rollup.tyreCount !== 1 ? 's' : ''} across unit`} />
            <StatTile label="Unit CPK (blended)" value={rollup.blendedCpk != null ? `${currency} ${fmt(rollup.blendedCpk, 3)}` : 'N/A'} icon={Gauge} tone="accent"
              sub={rollup.canonicalCpk?.validCount ? `Canonical avg ${currency} ${fmt(rollup.canonicalCpk.fleetAvgCpk, 3)} (${rollup.canonicalCpk.validCount} valid)` : 'No valid cost per km rows'} />
            <StatTile label="Unit tyre spend" value={formatCurrency(rollup.totalSpend, currency, 0)} icon={DollarSign}
              sub={rollup.avgTyreLifeKm != null ? `Avg life ${rollup.avgTyreLifeKm.toLocaleString()} km` : 'No km data'} />
            <StatTile label="Scrapped tyres" value={rollup.scrapTyres} icon={Recycle} tone={rollup.scrapTyres > 0 ? 'crit' : 'neutral'}
              sub={scrapPct == null ? 'No fitted or scrapped tyres' : `${scrapPct}% of fitted plus scrap`} />
          </div>

          <Card>
            <CardHeader
              level={2}
              icon={Truck}
              title="Member assets"
              actions={
                <span className="text-xs text-[var(--text-muted)]">
                  {coverage.resolved}/{coverage.total} resolved in fleet master{coverage.pct == null ? '' : ` (${coverage.pct}%)`}
                </span>
              }
            />
            <CardBody>
              {rollup.resolution.unresolvedCount > 0 && (
                <div className="mb-3 rounded border border-amber-700/50 bg-amber-900/10 px-3 py-2 text-sm text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {rollup.resolution.unresolvedCount} member{rollup.resolution.unresolvedCount !== 1 ? 's' : ''} not found in <span className="font-mono">vehicle_fleet</span>:{' '}
                    <span className="font-mono">{rollup.resolution.unresolved.join(', ')}</span>. Add them to fleet master for complete intelligence.
                  </span>
                </div>
              )}
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {rollup.members.map((m) => (
                  <li key={`${m.role}-${m.asset_no}`} className={`rounded-lg border p-3 ${m.resolved ? 'border-[var(--input-border)] bg-[var(--input-bg)]/40' : 'border-amber-700/50 bg-amber-900/10'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{m.asset_no}</span>
                      {m.resolved
                        ? <span className="inline-flex items-center gap-1 text-[11px] text-green-400"><CheckCircle2 size={14} aria-hidden="true" /> Resolved</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] text-amber-400"><XCircle size={14} aria-hidden="true" /> Missing</span>}
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">
                      {m.role === 'prime_mover' ? 'Prime mover' : 'Trailer'}
                    </div>
                    {m.resolved ? (
                      <div className="text-xs text-[var(--text-secondary)] mt-1.5 space-y-0.5">
                        <div>{[m.make, m.model].filter(Boolean).join(' ') || m.vehicle_type || 'N/A'}</div>
                        <div className="text-[var(--text-muted)]">{m.vehicle_type || 'N/A'}{m.status ? ` | ${m.status}` : ''}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-amber-300/80 mt-1.5">Not in fleet master</div>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader level={2} icon={Layers} title="Position-class breakdown"
              description={'Positions that do not parse to steer, drive or trailer are grouped honestly as "Other / Unclassified".'} />
            <EnterpriseTable
              columns={posColumns}
              data={posRows}
              getRowId={(p) => p.positionClass}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableColumnVisibility={false}
              enableExport
              exportFileName="combination_position_breakdown"
              reportMeta={{ title: `Position breakdown: ${selectedCombo?.name || selectedCombo?.prime_mover_no || 'unit'}`, currency }}
              initialPageSize={25}
              emptyMessage="No tyre records found for this unit's members."
            />
          </Card>

          <Card>
            <div className="flex items-start gap-3">
              <Info size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Activity size={14} aria-hidden="true" /> Live telemetry and axle schematic: not available in this dataset
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-1.5">
                  Per-tyre pressure (PSI), temperature and the top-down axle / wheel-position diagram require
                  live TPMS telemetry and a wheel-position map. This deployment's <span className="font-mono">tyre_records</span> and{' '}
                  <span className="font-mono">vehicle_fleet</span> tables do not capture those signals, so no gauges or
                  schematics are shown here rather than fabricating readings. Connect a TPMS / wheel-position source to enable them.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {['Live PSI', 'Temperature', 'Pressure target', 'Wheel positions', 'Axle schematic'].map((x) => (
                    <span key={x} className="badge text-[11px] px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]">
                      {x}: no source
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

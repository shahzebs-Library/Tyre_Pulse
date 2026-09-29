/**
 * Combinations (route /combinations) - Combination Manager, rebuilt on the
 * Command Center kit to the owner's mockup (19, top-right panel).
 *
 * Registry: KPI strip, filters, the combination table with prime-mover
 * thumbnails, an always-open Add / Edit panel, and three cards for the
 * selected combination (axle tyre layout, load distribution per axle, tyre
 * configuration). Unit intelligence: the combined-unit tyre rollup.
 *
 * Data: asset_combinations (V141, extended by 20260929125000) and the fleet
 * register. Tyre maths reuse src/lib/combinations.js; page logic lives in
 * src/lib/combinationManagerView.js and src/lib/combinationsAnalytics.js.
 * Axle load, tyre load and legal limits are not recorded, so they read N/A.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Combine, CheckCircle2, XCircle, ClipboardList, ShieldCheck, Search, X, Plus,
  Pencil, Trash2, Network, RefreshCw, FileSpreadsheet, FileText, AlertTriangle,
} from 'lucide-react'
import {
  Card, CardState, Kpi, KitTable, PageHero, Tabs, VehicleThumb, fmtInt,
} from '../components/commandCenter/kit'
import Modal from '../components/ui/Modal'
import CombinationFormPanel from '../components/combinations/CombinationFormPanel'
import CombinationIntelligence from '../components/combinations/CombinationIntelligence'
import { AxleTyreLayoutCard, LoadDistributionCard, TyreConfigCard } from '../components/combinations/CombinationCards'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCombinations, createCombination, updateCombination, deleteCombination,
  getCombinationIntelligence, listFleetAssets,
} from '../lib/api/combinations'
import { parseTrailerList, computeCombinationRollup, detectDuplicateTrailers } from '../lib/combinations'
import {
  filterCombinations, combinationKpis, siteOptions as siteOptionsOf,
  combinationExportRows, COMBINATION_EXPORT_COLUMNS,
} from '../lib/combinationsAnalytics'
import {
  managerKpis, filterManager, typeOptions as typeOptionsOf, vehicleTypeOptions, buildFleetMap,
  statusMeta, tyreConfigLabel, suggestNextNumber, EMPTY_MANAGER_FORM, formFromRow,
  validateManagerForm, payloadFromForm, MANAGER_STATUSES, STATUS_META,
} from '../lib/combinationManagerView'
import { toUserMessage } from '../lib/safeError'
import './Combinations.css'

const loadExportUtils = () => import('../lib/exportUtils')
const NA = <span className="cc-na">N/A</span>
const norm = (v) => String(v ?? '').trim().toUpperCase()

export default function Combinations() {
  const { activeCountry, activeCurrency, appSettings } = useSettings() || {}
  const company = appSettings?.company_name || ''
  const currency = activeCurrency || 'SAR'

  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState('')
  const [exporting, setExporting] = useState(false)

  const [fleet, setFleet] = useState({ loading: true, rows: [], error: '', truncated: false })

  const [view, setView] = useState('registry')
  const [siteFilter, setSiteFilter] = useState('')
  const [vtFilter, setVtFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [trailerFilter, setTrailerFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_MANAGER_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [selectedId, setSelectedId] = useState('')
  const [intel, setIntel] = useState(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const [intelError, setIntelError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const data = await listCombinations({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      // A failed read stays unknown (null), never an empty registry.
      setLoadError(toUserMessage(err, 'Could not load combinations.'))
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  const loadFleet = useCallback(async () => {
    setFleet((f) => ({ ...f, loading: true, error: '' }))
    try {
      const { rows: list, truncated } = await listFleetAssets({ country: activeCountry })
      setFleet({ loading: false, rows: list, error: '', truncated })
    } catch (err) {
      setFleet({ loading: false, rows: [], error: toUserMessage(err, 'Could not load the fleet register.'), truncated: false })
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadFleet() }, [loadFleet])

  const fleetMap = useMemo(() => buildFleetMap(fleet.rows), [fleet.rows])
  const list = useMemo(() => rows || [], [rows])
  const kpis = useMemo(() => managerKpis(list), [list])
  const regKpis = useMemo(() => combinationKpis(list), [list])
  const duplicateTrailers = useMemo(() => detectDuplicateTrailers(list), [list])
  const siteOptions = useMemo(() => siteOptionsOf(list), [list])
  const typeOptions = useMemo(() => typeOptionsOf(list), [list])
  const vtOptions = useMemo(() => vehicleTypeOptions(list, fleetMap), [list, fleetMap])
  const fleetOptions = useMemo(() => fleet.rows.map((f) => f.asset_no).filter(Boolean), [fleet.rows])
  const formSites = useMemo(() => [...new Set([...siteOptions, ...fleet.rows.map((f) => f.site).filter(Boolean)])].sort(), [siteOptions, fleet.rows])

  const filtered = useMemo(() => filterCombinations(
    filterManager(list, { site: siteFilter, vehicleType: vtFilter, type: typeFilter, status: statusFilter, search }, fleetMap),
    { trailers: trailerFilter },
  ), [list, siteFilter, vtFilter, typeFilter, statusFilter, search, trailerFilter, fleetMap])

  const hasFilters = siteFilter || vtFilter || typeFilter || statusFilter || search || trailerFilter !== 'all'
  const clearFilters = () => { setSiteFilter(''); setVtFilter(''); setTypeFilter(''); setStatusFilter(''); setSearch(''); setTrailerFilter('all') }

  useEffect(() => {
    if (!list.length) { if (selectedId) setSelectedId(''); return }
    if (!list.some((r) => String(r.id) === String(selectedId))) setSelectedId(String(list[0].id))
  }, [list, selectedId])

  const selectedCombo = useMemo(() => list.find((r) => String(r.id) === String(selectedId)) || null, [list, selectedId])

  const loadIntel = useCallback(async (combo) => {
    if (!combo) { setIntel(null); return }
    setIntelLoading(true); setIntelError('')
    try {
      setIntel(await getCombinationIntelligence(combo, { country: activeCountry }))
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
          meta: { Combinations: kpis.total, Active: kpis.active, 'Under review': kpis.underReview, 'Trailers linked': regKpis.trailers },
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

  const exportPositions = async (posRows) => {
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      const label = selectedCombo?.combination_no || selectedCombo?.name || selectedCombo?.prime_mover_no || 'unit'
      await exportToExcel(
        posRows.map((p) => ({ label: p.label, count: p.count, spend: p.spend, share: p.spendSharePct ?? 'N/A', cpk: p.cpk ?? 'N/A' })),
        ['label', 'count', 'spend', 'share', 'cpk'],
        ['Position class', 'Tyres', `Spend (${currency})`, 'Share of spend %', `Cost per km (${currency})`],
        reportFileName('Combination Position Breakdown', label), 'Positions',
      )
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // Form panel
  const setField = useCallback((k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFormErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }, [])
  const resetForm = useCallback(() => {
    setEditing(null); setForm(EMPTY_MANAGER_FORM); setFormErrors({}); setSaveError('')
  }, [])
  const openEdit = useCallback((r) => {
    setEditing(r); setForm(formFromRow(r)); setFormErrors({}); setSaveError('')
    setSelectedId(String(r.id))
  }, [])

  const submitForm = async (e) => {
    e.preventDefault()
    const errs = validateManagerForm(form)
    setFormErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true); setSaveError('')
    try {
      const payload = payloadFromForm(form)
      if (editing) {
        await updateCombination(editing.id, payload)
      } else {
        await createCombination({ ...payload, country: activeCountry && activeCountry !== 'All' ? activeCountry : null })
      }
      resetForm()
      await load()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Could not save combination.'))
    } finally {
      setSaving(false)
    }
  }

  const closeConfirmDelete = useCallback(() => { if (!deleting) setConfirmDelete(null) }, [deleting])
  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteCombination(confirmDelete.id)
      if (editing && String(editing.id) === String(confirmDelete.id)) resetForm()
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
      key: 'combination_no', header: 'Combination No.',
      sortValue: (r) => r.combination_no || r.name || '',
      cell: (r) => (
        <div className="cm-cell">
          <b className="cm-no">{r.combination_no || NA}</b>
          {r.name && <small>{r.name}</small>}
        </div>
      ),
    },
    {
      key: 'prime_mover_no', header: 'Prime Mover',
      cell: (r) => {
        const f = fleetMap.get(norm(r.prime_mover_no))
        return (
          <div className="cm-veh">
            <VehicleThumb row={f || {}} size="sm" />
            <div className="cm-cell"><b>{r.prime_mover_no}</b><small>{f?.vehicle_type || 'Not in fleet register'}</small></div>
          </div>
        )
      },
    },
    {
      key: 'trailers', header: 'Trailer / Equipment', sortValue: (r) => parseTrailerList(r.trailer_nos).length,
      cell: (r) => {
        const t = parseTrailerList(r.trailer_nos)
        return (
          <div className="cm-cell">
            {t.length ? <b>{t.join(', ')}</b> : <span className="cc-na">None linked</span>}
            {r.combination_type && <small>{r.combination_type}</small>}
          </div>
        )
      },
    },
    { key: 'axle_config', header: 'Axle Config.', cell: (r) => r.axle_config || NA },
    { key: 'tyre_config', header: 'Tyre Config.', sortValue: (r) => tyreConfigLabel(r.tyre_config) || '', cell: (r) => tyreConfigLabel(r.tyre_config) || NA },
    { key: 'max_load_tonnes', header: 'Max Load (Ton)', numeric: true, sortValue: (r) => (r.max_load_tonnes == null ? undefined : Number(r.max_load_tonnes)), cell: (r) => (r.max_load_tonnes == null ? NA : fmtInt(r.max_load_tonnes)) },
    { key: 'site', header: 'Site', cell: (r) => r.site || NA },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.status || 'inactive',
      cell: (r) => { const m = statusMeta(r.status); return <span className={`cc-pill ${m.tone}`}>{m.label}</span> },
    },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => {
        const label = r.combination_no || r.name || r.prime_mover_no || 'combination'
        return (
          <div className="cm-actions">
            <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); setSelectedId(String(r.id)); setView('intelligence') }} aria-label={`Analyse ${label}`} title="Unit intelligence"><Network size={14} /></button>
            <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit ${label}`} title="Edit"><Pencil size={14} /></button>
            <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} aria-label={`Delete ${label}`} title="Delete"><Trash2 size={14} /></button>
          </div>
        )
      },
    },
  ], [fleetMap, openEdit])

  const unknown = rows === null
  const registryState = { loading: loading && !rows, data: rows, error: loadError, retry: load }
  const kpiDisplay = () => (unknown ? 'N/A' : undefined)

  return (
    <div className="cc cm-page">
      <div className="cm-hero">
        <PageHero
          hello="Fleet & Assets"
          title="Combination Manager"
          lead="Manage vehicle and trailer combinations with tyre configurations, axle loads and operating status."
          imgLight="/dashboard/hero-combinations-light.webp"
          imgDark="/dashboard/hero-combinations-dark.webp"
        />
        <div className="cm-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => { load(); loadFleet() }} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          <button type="button" className="cc-btn-primary" onClick={() => { resetForm(); setView('registry') }}><Plus size={14} aria-hidden="true" /> New Combination</button>
        </div>
      </div>

      {actionError && (
        <div className="cc-card cm-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /><div>{actionError}</div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {fleet.error && (
        <div className="cc-card cm-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>The fleet register could not be read, so vehicle pictures, types and the prime mover list are missing. {fleet.error}</div>
          <button type="button" className="cc-btn-ghost" onClick={loadFleet}>Retry</button>
        </div>
      )}
      {duplicateTrailers.length > 0 && (
        <div className="cc-card cm-banner" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            {duplicateTrailers.length} trailer{duplicateTrailers.length === 1 ? ' is' : 's are'} linked to more than one active combination. A trailer can only run in one active unit at a time.
            <div className="cm-chips">
              {duplicateTrailers.map((d) => (
                <button type="button" key={d.trailer} className="cc-pill warn cm-chip" onClick={() => { setView('registry'); setSearch(d.trailer) }}>
                  {d.trailer} x{d.combinations.length}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="cc-kpis cm-kpis">
        <Kpi icon={Combine} tone="t-green" value={kpis.total} display={kpiDisplay()} label="Total Combinations" loading={loading && !rows} onClick={() => setStatusFilter('')} />
        <Kpi icon={CheckCircle2} tone="t-blue" value={kpis.active} display={kpiDisplay()} label="Active" loading={loading && !rows} onClick={() => setStatusFilter('active')} />
        <Kpi icon={XCircle} tone="t-amber" value={kpis.inactive} display={kpiDisplay()} label="Inactive" loading={loading && !rows} onClick={() => setStatusFilter('inactive')} />
        <Kpi icon={ClipboardList} tone="t-red" value={kpis.underReview} display={kpiDisplay()} label="Under Review" loading={loading && !rows} onClick={() => setStatusFilter('under_review')} />
        <Kpi icon={ShieldCheck} tone="t-green" display={unknown || kpis.compliancePct == null ? 'N/A' : `${kpis.compliancePct}%`} label="Compliance" loading={loading && !rows}
          title="Share of combinations with an axle configuration, tyre configuration and max load recorded" />
      </div>

      <Card className="cm-tabbar">
        <Tabs
          tabs={[{ key: 'registry', label: 'Registry', count: unknown ? null : kpis.total }, { key: 'intelligence', label: 'Unit intelligence' }]}
          value={view} onChange={setView} label="Combination views" variant="line"
        />
      </Card>

      {view === 'registry' ? (
        <>
          <div className="cm-main">
            <Card className="cm-registry">
              <div className="cm-filters">
                <select className="cc-select" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                  <option value="">All Sites</option>
                  {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Vehicle type" value={vtFilter} onChange={(e) => setVtFilter(e.target.value)}>
                  <option value="">All Vehicle Types</option>
                  {vtOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Combination type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="">All Combination Types</option>
                  {typeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  {MANAGER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                </select>
                <select className="cc-select" aria-label="Trailer link" value={trailerFilter} onChange={(e) => setTrailerFilter(e.target.value)}>
                  <option value="all">Any trailer link</option>
                  <option value="with">With trailers</option>
                  <option value="without">No trailer linked</option>
                </select>
                <div className="cc-search"><Search size={14} aria-hidden="true" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by combination name, vehicle, trailer" aria-label="Search combinations" /></div>
                {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
                <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!filtered.length || exporting}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>
                <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={!filtered.length || exporting}><FileText size={14} aria-hidden="true" /> PDF</button>
              </div>
              <p className="cm-summary" aria-live="polite">
                {unknown ? 'N/A' : `${fmtInt(filtered.length)} of ${fmtInt(kpis.total)} shown | ${fmtInt(regKpis.trailers)} trailers linked | ${fmtInt(regKpis.withoutTrailer)} with no trailer | ${fmtInt(regKpis.duplicateTrailers)} double-booked trailers`}
              </p>
              <CardState state={registryState}>
                <KitTable
                  columns={columns}
                  rows={filtered}
                  getRowId={(r) => String(r.id)}
                  onRowClick={(r) => setSelectedId(String(r.id))}
                  empty={list.length === 0 ? 'No combinations yet. Use the panel to add your first prime mover and trailer link.' : 'No combinations match these filters.'}
                />
              </CardState>
            </Card>

            <CombinationFormPanel
              form={form} setField={setField} errors={formErrors} editing={editing} saving={saving} saveError={saveError}
              placeholderNo={suggestNextNumber(list)} fleetOptions={fleetOptions} typeOptions={typeOptions} siteOptions={formSites}
              onSave={submitForm} onCancel={resetForm}
            />
          </div>

          <div className="cm-cards">
            <AxleTyreLayoutCard rows={list} combo={selectedCombo} value={selectedId} onChange={setSelectedId} fleetMap={fleetMap} />
            <LoadDistributionCard combo={selectedCombo} />
            <TyreConfigCard combo={selectedCombo} />
          </div>
        </>
      ) : (
        <CardState state={registryState}>
          <CombinationIntelligence
            rows={list} selectedId={selectedId} setSelectedId={setSelectedId} selectedCombo={selectedCombo}
            intelLoading={intelLoading} intelError={intelError} onRetryIntel={() => loadIntel(selectedCombo)}
            rollup={rollup} currency={currency} onExportPositions={exportPositions}
          />
        </CardState>
      )}

      <Modal
        open={!!confirmDelete}
        onClose={closeConfirmDelete}
        size="sm"
        title="Delete combination"
        footer={
          <>
            <button type="button" onClick={closeConfirmDelete} disabled={deleting} className="cc-btn-ghost">Cancel</button>
            <button type="button" onClick={doDelete} disabled={deleting} className="cc-btn-primary cm-danger">{deleting ? 'Deleting...' : 'Delete'}</button>
          </>
        }
      >
        <p className="cm-note">
          Delete {confirmDelete?.combination_no || confirmDelete?.name || confirmDelete?.prime_mover_no}? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

/**
 * TyreChangeTracking - "Tyre change tracking" section (mounted on
 * /tyre-lifecycle, beneath Running & Remaining).
 *
 * Answers the one question the flag on /inspections could not: a tyre was
 * flagged for change - WHICH tyre, on WHICH vehicle, and did it actually get
 * changed? Replacement details are DERIVED from the monthly consumption that is
 * already uploaded (tyre_records), never typed again, so this can never drift
 * from what was really fitted.
 *
 * The four states are kept apart on screen exactly as the engine keeps them
 * apart: still fitted, replaced, removed with nothing fitted, and could not
 * tell. The last one is a statement about OUR data, not about the tyre, and it
 * is never shown as "not replaced".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Repeat, Search, X, RefreshCw, FileDown, FileSpreadsheet, AlertTriangle,
} from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { loadTyreChangeTracking } from '../../lib/api/tyreChangeTracking'
import {
  trackTyreChanges, filterTracking, trackingSummary, trackingScopeLabel,
  TRACK_STATE_META, SOURCE_META, TRACKING_ANCHOR,
} from '../../lib/tyreChangeTracking'
import { fmtNum } from '../../lib/tyreRunningLife'
import { toUserMessage } from '../../lib/safeError'
import Modal from '../ui/Modal'
import EnterpriseTable from '../ui/EnterpriseTable'

const DOT_COLOR = {
  danger: '#b91c1c', warning: '#b45309', info: '#64748b', good: '#15803d', quiet: '#94a3b8',
}

function StatusBadge({ tone, children, title }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', background: 'rgba(148,163,184,0.06)' }}
      title={title || ''}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0, background: DOT_COLOR[tone] || DOT_COLOR.quiet }} />
      {children}
    </span>
  )
}

const dash = (v) => (v == null || v === '' ? 'N/A' : v)

export default function TyreChangeTracking() {
  const { activeCountry, appSettings } = useSettings()
  const [params, setParams] = useSearchParams()
  // The inspections card can hand over one asset ("show me THIS vehicle's
  // flagged tyres"), the same way clicking an inspection opens that inspection.
  const focusAsset = (params.get('trackAsset') || '').trim()

  const [state, setState] = useState({ loading: true, ok: true, reason: '', rows: [], gaps: [] })
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState('')
  const [exportError, setExportError] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const payload = await loadTyreChangeTracking({ country: activeCountry, asset: focusAsset })
    if (!payload.ok) {
      setState({ loading: false, ok: false, reason: payload.reason || '', rows: [], gaps: payload.gaps || [] })
      return
    }
    const { rows } = trackTyreChanges({
      dueRows: payload.dueRows,
      inspections: payload.inspections,
      actions: payload.actions,
      tyreRecords: payload.tyreRecords,
    })
    setState({ loading: false, ok: true, reason: '', rows, gaps: payload.gaps || [] })
  }, [activeCountry, focusAsset])

  useEffect(() => { load() }, [load])

  // A hash link from another screen must LAND on this section. React Router
  // does not scroll to a hash by itself, so arriving from the inspections flag
  // would otherwise drop the reader at the top of a long page with no sign that
  // anything happened.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== `#${TRACKING_ANCHOR}`) return
    const el = document.getElementById(TRACKING_ANCHOR)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [state.loading])

  const filtered = useMemo(
    () => filterTracking(state.rows, { search, state: stateFilter, source: sourceFilter }),
    [state.rows, search, stateFilter, sourceFilter],
  )
  const summary = useMemo(() => trackingSummary(filtered), [filtered])
  const scopeLabel = useMemo(
    () => trackingScopeLabel({ country: activeCountry, asset: focusAsset, state: stateFilter, source: sourceFilter, search }),
    [activeCountry, focusAsset, stateFilter, sourceFilter, search],
  )
  const countryLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'all countries'

  function clearAsset() {
    const next = new URLSearchParams(params)
    next.delete('trackAsset')
    setParams(next, { replace: true })
  }

  const EXPORT_COLS = [
    ['asset', 'Asset'], ['position', 'Position'], ['serial', 'Flagged serial'],
    ['sourceLabel', 'Flag raised by'], ['kind', 'Flag'], ['flaggedOnLabel', 'Flagged on'],
    ['daysFlagged', 'Days flagged'], ['stateLabel', 'Outcome'],
    ['replacementSerial', 'Replaced by serial'], ['replacementBrand', 'Replacement brand'],
    ['replacementFitted', 'Replacement fitted on'], ['daysToReplace', 'Days to replace'],
    ['removedOn', 'Removed on'], ['site', 'Site'], ['country', 'Country'], ['reason', 'Note'],
  ]

  /** Flatten to exactly what the screen shows - one set of values, three outputs. */
  const exportRows = () => filtered.map((r) => ({
    asset: r.asset || 'N/A',
    position: r.position || 'Not recorded',
    serial: r.serial || 'N/A',
    sourceLabel: SOURCE_META[r.source] ? SOURCE_META[r.source].label : r.source,
    kind: r.kind || 'N/A',
    flaggedOnLabel: r.flaggedOn || 'Not dated',
    daysFlagged: r.daysFlagged == null ? 'N/A' : r.daysFlagged,
    stateLabel: TRACK_STATE_META[r.state].label,
    replacementSerial: r.replacement?.serial || 'N/A',
    replacementBrand: r.replacement?.brand || 'N/A',
    replacementFitted: r.replacement?.fittedOn || 'N/A',
    daysToReplace: r.daysToReplace == null ? 'N/A' : r.daysToReplace,
    removedOn: r.removedOn || 'N/A',
    site: r.site || 'N/A',
    country: r.country || 'N/A',
    reason: r.reason || '',
  }))

  async function downloadExcel() {
    setBusy('excel'); setExportError('')
    try {
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(
        exportRows(), EXPORT_COLS.map((c) => c[0]), EXPORT_COLS.map((c) => c[1]),
        reportFileName('Tyre Change Tracking', countryLabel), 'Tyre change tracking',
        {
          title: 'Tyre change tracking',
          company: appSettings?.company_name || 'Tyre Pulse',
          dateRange: scopeLabel,
        },
      )
    } catch (e) { setExportError(toUserMessage(e)) } finally { setBusy('') }
  }

  async function downloadPdf() {
    setBusy('pdf'); setExportError('')
    try {
      const { exportToPdf, reportFileName } = await import('../../lib/exportUtils')
      await exportToPdf(
        exportRows(),
        EXPORT_COLS.map(([key, header]) => ({ key, header })),
        'Tyre change tracking',
        reportFileName('Tyre Change Tracking', countryLabel),
        'landscape',
        appSettings?.company_name || 'Tyre Pulse',
        { emptyHint: scopeLabel },
      )
    } catch (e) { setExportError(toUserMessage(e)) } finally { setBusy('') }
  }

  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset || 'N/A', size: 100,
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position || 'Not recorded', size: 100 },
    { id: 'serial', header: 'Flagged serial', accessorFn: (r) => r.serial || 'N/A', size: 130 },
    { id: 'source', header: 'Raised by', accessorFn: (r) => (SOURCE_META[r.source] ? SOURCE_META[r.source].label : r.source), size: 130,
      cell: ({ row }) => (
        <StatusBadge tone={row.original.source === 'user' ? 'warning' : 'info'} title={SOURCE_META[row.original.source]?.note}>
          {row.original.source === 'user' ? 'User' : 'System'}
        </StatusBadge>
      ) },
    { id: 'kind', header: 'Flag', accessorFn: (r) => r.kind || 'N/A', size: 140 },
    { id: 'flaggedOn', header: 'Flagged on', accessorFn: (r) => r.flaggedOn || '', size: 110,
      cell: ({ row }) => (row.original.flaggedOn
        ? row.original.flaggedOn
        : <span title="This tyre is due as of today. The system does not record the day it crossed its expected life, so no date is shown." style={{ color: 'var(--text-dim)' }}>Due as of today</span>) },
    { id: 'daysFlagged', header: 'Days flagged', accessorFn: (r) => r.daysFlagged, size: 105, meta: { align: 'right' },
      cell: ({ getValue }) => fmtNum(getValue()) },
    { id: 'state', header: 'Outcome', accessorFn: (r) => TRACK_STATE_META[r.state].label, size: 165,
      cell: ({ row }) => {
        const meta = TRACK_STATE_META[row.original.state]
        return <StatusBadge tone={meta.tone} title={row.original.reason || meta.note}>{meta.label}</StatusBadge>
      } },
    { id: 'replacement', header: 'Replaced by', accessorFn: (r) => r.replacement?.serial || '', size: 150,
      meta: { exportValue: (r) => r.replacement?.serial || 'N/A' },
      cell: ({ row }) => {
        const rep = row.original.replacement
        if (!rep) return <span style={{ color: 'var(--text-dim)' }}>N/A</span>
        return (
          <span title={`Fitted ${rep.fittedOn}${rep.brand ? ` - ${rep.brand}` : ''}`}>
            {rep.serial || 'Serial not recorded'}
          </span>
        )
      } },
    { id: 'replacementFitted', header: 'Fitted on', accessorFn: (r) => r.replacement?.fittedOn || '', size: 110,
      cell: ({ getValue }) => dash(getValue()) },
    { id: 'daysToReplace', header: 'Days to replace', accessorFn: (r) => r.daysToReplace, size: 115, meta: { align: 'right' },
      cell: ({ getValue }) => fmtNum(getValue()) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 100 },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 90 },
  ], [])

  return (
    <div className="card p-5 mt-6" id={TRACKING_ANCHOR}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Repeat size={18} style={{ color: 'var(--brand)' }} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Tyre change tracking</h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Every flagged tyre, on which vehicle and which wheel, tracked through to its replacement.
              Replacement details are read from the monthly tyre consumption you already upload, so
              nothing here is typed twice.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadPdf}
            disabled={Boolean(busy) || state.loading || !state.ok || !filtered.length}
            className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1 disabled:opacity-40"
            style={{ color: 'var(--text-primary)' }}
            title="Download a PDF of the rows currently on screen">
            <FileDown size={13} /> {busy === 'pdf' ? 'Building PDF...' : 'Download PDF report'}
          </button>
          <button type="button" onClick={downloadExcel}
            disabled={Boolean(busy) || state.loading || !state.ok || !filtered.length}
            className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1 disabled:opacity-40"
            style={{ color: 'var(--text-primary)' }}
            title="Download an Excel report of the rows currently on screen">
            <FileSpreadsheet size={13} /> {busy === 'excel' ? 'Building Excel...' : 'Download Excel report'}
          </button>
          <button type="button" onClick={load}
            className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1"
            style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {focusAsset && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ color: 'var(--text-secondary)', background: 'rgba(148,163,184,0.07)' }}>
          <span>Showing the flagged tyres on <strong style={{ color: 'var(--text-primary)' }}>{focusAsset}</strong> only.</span>
          <button type="button" onClick={clearAsset} className="underline" style={{ color: 'var(--text-primary)' }}>
            Show every vehicle
          </button>
        </div>
      )}

      {exportError && <p className="text-xs mb-2" style={{ color: '#b91c1c' }}>{exportError}</p>}

      {/* A source that could not be read is NAMED. Silently dropping it would
          make an incomplete list look like the complete picture. */}
      {state.gaps.map((g) => (
        <p key={g} className="mb-2 text-xs rounded-lg px-3 py-2 flex items-start gap-2"
          style={{ color: 'var(--text-secondary)', background: 'rgba(180,83,9,0.10)' }}>
          <AlertTriangle size={13} style={{ color: '#b45309', marginTop: 2, flexShrink: 0 }} />
          <span>{g}</span>
        </p>
      ))}

      {state.loading ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading tyre change tracking...</div>
      ) : !state.ok ? (
        <div className="py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Could not load the tyre change tracking.</p>
          {state.reason && <p className="mt-1 text-xs" style={{ color: 'var(--text-dim)' }}>{state.reason}</p>}
          <button type="button" onClick={load}
            className="mt-2 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs"
            style={{ color: 'var(--text-primary)' }}>Retry</button>
        </div>
      ) : !state.rows.length ? (
        <div className="py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {focusAsset
              ? `No tyre is flagged on ${focusAsset}.`
              : `No tyre is flagged in ${countryLabel}. Nothing is past its expected life, close to it, or recorded as damaged.`}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            {[
              ['Flagged tyres', fmtNum(summary.total)],
              ['Vehicles', fmtNum(summary.assets)],
              [TRACK_STATE_META.on_vehicle.label, fmtNum(summary.onVehicle)],
              [TRACK_STATE_META.replaced.label, fmtNum(summary.replaced)],
              [TRACK_STATE_META.removed_not_replaced.label, fmtNum(summary.removedNotReplaced)],
              // Never a zero: an unmeasured average and a same-day replacement
              // are different facts.
              ['Avg days to replace', summary.avgDaysToReplace == null ? 'N/A' : fmtNum(summary.avgDaysToReplace)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          <p className="mb-3 text-[11px] rounded-lg px-3 py-2" style={{ color: 'var(--text-secondary)', background: 'rgba(148,163,184,0.07)' }}>
            {fmtNum(summary.bySystem)} raised by the system (past expected life or due soon) and{' '}
            {fmtNum(summary.byUser)} raised by a user (damage or a puncture recorded on an inspection).
            {summary.unknown > 0
              ? ` ${fmtNum(summary.unknown)} could not be matched to a fitment record - that is a gap in what was recorded, not a statement that the tyre is still fitted.`
              : ''}
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1.5">
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search asset, serial, position, site"
                className="bg-transparent text-xs outline-none w-56" style={{ color: 'var(--text-primary)' }} />
              {search && <button type="button" onClick={() => setSearch('')}><X size={13} style={{ color: 'var(--text-dim)' }} /></button>}
            </div>
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">All outcomes</option>
              {Object.entries(TRACK_STATE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">Raised by anyone</option>
              <option value="system">Raised by system</option>
              <option value="user">Raised by user</option>
            </select>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{filtered.length} flagged tyres</span>
          </div>

          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(r) => `${r.country}|${r.asset}|${r.position}|${r.serial}`}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting
            enableColumnVisibility
            enableExport
            exportFileName="tyre_change_tracking"
            initialPageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            emptyMessage="No flagged tyres match these filters."
            onRowClick={(r) => setDetail(r)}
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            Click any row for the full flag and replacement detail.
          </p>
        </>
      )}

      {detail && <TrackingDetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** One flagged tyre in full: what was flagged, by whom, and what happened. */
function TrackingDetailModal({ row, onClose }) {
  const meta = TRACK_STATE_META[row.state]
  const fields = [
    ['Asset', dash(row.asset)],
    ['Position', row.position || 'Not recorded'],
    ['Flagged serial', dash(row.serial)],
    ['Brand', dash(row.brand)],
    ['Size', dash(row.size)],
    ['Site', dash(row.site)],
    ['Country', dash(row.country)],
    ['Raised by', SOURCE_META[row.source] ? SOURCE_META[row.source].label : row.source],
    ['Flag', dash(row.kind)],
    ['Flagged on', row.flaggedOn || 'Due as of today'],
    ['Days flagged', row.daysFlagged == null ? 'N/A' : fmtNum(row.daysFlagged)],
    ['Recorded by', row.origins?.length ? row.origins.join(', ') : 'N/A'],
    ['Tyre fitted on', dash(row.fittedOn)],
    ['Removed on', dash(row.removedOn)],
    ['Replaced by serial', dash(row.replacement?.serial)],
    ['Replacement brand', dash(row.replacement?.brand)],
    ['Replacement fitted on', dash(row.replacement?.fittedOn)],
    ['Days to replace', row.daysToReplace == null ? 'N/A' : fmtNum(row.daysToReplace)],
  ]
  return (
    <Modal open onClose={onClose} title={`Tyre flag on ${row.asset || 'asset'}`} size="lg">
      <div className="mb-3">
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{row.reason || meta.note}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
        {fields.map(([label, value]) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>
      {row.detail && (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{row.detail}</p>
      )}
      <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
        The replacement is worked out from the fitment records you upload: a different tyre fitted on
        this vehicle at this wheel after the flag. N/A means the value was never recorded.
      </p>
    </Modal>
  )
}

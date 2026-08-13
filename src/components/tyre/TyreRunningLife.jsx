/**
 * TyreRunningLife - "Running & Remaining" section (mounted on /tyre-lifecycle).
 * Per ACTIVE tyre, against the asset's CURRENT meters (km AND engine hours):
 * how far it has run since fitment, and the projected remaining km from the
 * fleet's own measured life for that tyre size. Honest N/A when a meter or
 * baseline is missing - nothing is fabricated.
 */
import { useEffect, useMemo, useState } from 'react'
import { Gauge, Search, X, RefreshCw, Target, Trash2, FileDown, FileSpreadsheet, Layers } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import {
  getTyreRunningLife, listTyreLifeTargets, saveTyreLifeTarget, deleteTyreLifeTarget,
} from '../../lib/api/tyreRunningLife'
import {
  shapeRunningLife, filterRows, bandFor, BAND_META, fmtNum, lifeDisplay, basisLabel, dueLabel,
  vehicleTypesIn, measureNote, measureFor,
  summarize, inFittedRange, filterDescription, coverageNote, bandNeedsFullSet,
} from '../../lib/tyreRunningLife'
import { toUserMessage } from '../../lib/safeError'
import Modal from '../ui/Modal'
import EnterpriseTable from '../ui/EnterpriseTable'
import DateField from '../ui/DateField'

// Muted, professional status dots (theme-neutral dark hues; the text itself
// stays on the theme's own tokens instead of loud colored text).
const DOT_COLOR = {
  danger: '#b91c1c',
  warning: '#b45309',
  info: '#64748b',
  good: '#15803d',
  quiet: '#94a3b8',
}

function StatusDot({ tone }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
        background: DOT_COLOR[tone] || DOT_COLOR.quiet,
      }}
    />
  )
}

/** Restrained status pill: subtle border + small dot, neutral text. */
function StatusBadge({ tone, children }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
        background: 'rgba(148,163,184,0.06)',
      }}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  )
}

export default function TyreRunningLife() {
  const { activeCountry, appSettings } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  /**
   * THE SCREEN OPENS ON THE TYRES THAT ARE DUE, NOT THE WHOLE FLEET.
   *
   * Measured live: KSA is 3,595 active tyres = 2,190 kB, and the browser was
   * dropping that reply outright - the screen read "Network error" while the
   * server had already answered. UAE (1,388 / 848 kB) and Egypt (429 / 263 kB)
   * are small enough to survive, which is exactly why the owner saw it work in
   * one country and fail in another. The due subset is 465 rows / 285 kB.
   *
   * So the default fetch is the due set, and loading everything is a deliberate
   * click. `state.scope` records which set the rows on screen ACTUALLY are, so
   * nothing (tiles, note, exports) can describe the due subset as the fleet.
   */
  const [scope, setScope] = useState('due')
  const [state, setState] = useState({
    loading: true, ok: true, rows: [], summary: null, reason: '', scope: 'due', total: null,
  })
  // Set when a band the due subset cannot contain widened the fetch by itself,
  // so the widening is explained rather than just happening.
  const [autoWidened, setAutoWidened] = useState(false)
  const [search, setSearch] = useState('')
  const [band, setBand] = useState('all')
  const [unit, setUnit] = useState('all')
  // Asset type is the first cut anybody makes on this table: a mixer tyre and a
  // loader tyre have different sizes, lives and targets, so a table that mixes
  // them cannot be read.
  const [vehicleType, setVehicleType] = useState('all')
  // Fitment-date range (row.fittedOn). Feeds the SAME filtered set the tiles,
  // life-history strip, table and exports all read, so they stay consistent.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [targetsOpen, setTargetsOpen] = useState(false)
  const [detailRow, setDetailRow] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [xlsBusy, setXlsBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const canSetTargets = isSuperAdmin || ['Admin', 'Manager', 'Director'].includes(profile?.role)

  async function load(nextScope = scope) {
    setState((s) => ({ ...s, loading: true }))
    const payload = await getTyreRunningLife({ country: activeCountry, dueOnly: nextScope === 'due' })
    const shaped = shapeRunningLife(payload)
    const total = Number(payload?.total)
    setState({
      loading: false, ok: shaped.ok, rows: shaped.rows, summary: shaped.summary,
      reason: payload?.reason || '',
      // The scope of the rows we HOLD, not the scope someone asked for: a failed
      // widening must not leave the screen claiming it shows the whole fleet.
      scope: shaped.ok ? nextScope : state.scope,
      total: Number.isFinite(total) ? total : null,
    })
  }
  // Switching country always returns to the fast due-only view: the country the
  // owner just picked may be the big one, and it must open, not error.
  useEffect(() => {
    setScope('due'); setAutoWidened(false); setBand('all')
    load('due')
  }, [activeCountry]) // eslint-disable-line react-hooks/exhaustive-deps

  const dueOnlyView = state.scope === 'due'
  const countryLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'all countries'

  /** Load everything for this country (paged client-side), deliberately. */
  function loadEverything(auto = false) {
    setAutoWidened(auto)
    setScope('all')
    load('all')
  }

  /** Back to the fast due-only view (the band goes with it - see changeBand). */
  function showDueOnly() {
    setAutoWidened(false)
    setBand('all')
    setScope('due')
    load('due')
  }

  /**
   * A band the due subset cannot hold (mid life, healthy, not measurable) needs
   * the full set. Widening the fetch here is the whole point: leaving it would
   * render an empty table, and "we did not fetch it" would be indistinguishable
   * from "there are none".
   */
  function changeBand(next) {
    setBand(next)
    if (dueOnlyView && bandNeedsFullSet(next)) loadEverything(true)
  }

  const filtered = useMemo(() => {
    const base = filterRows(state.rows, { search, band, unit, vehicleType })
    if (!fromDate && !toDate) return base
    return base.filter((r) => inFittedRange(r, fromDate, toDate))
  }, [state.rows, search, band, unit, vehicleType, fromDate, toDate])
  // Tiles + life-history strip follow the on-screen filters, same as the table.
  const s = useMemo(() => summarize(filtered), [filtered])
  const hasFilter = Boolean(search.trim()) || band !== 'all' || unit !== 'all' || vehicleType !== 'all' || Boolean(fromDate || toDate)
  // Offered from the loaded rows, so the list can never name a type the fleet
  // does not run or omit one it has just gained.
  const typeOptions = useMemo(() => vehicleTypesIn(state.rows), [state.rows])

  // Branded PDF report of the FILTERED rows - always matches the screen.
  async function downloadPdfReport() {
    setPdfBusy(true); setPdfError('')
    try {
      const { renderTyreLifeReportPdf } = await import('../../lib/tyreLifeReportPdf')
      await renderTyreLifeReportPdf({
        rows: filtered,
        summary: s,
        country: activeCountry,
        company: appSettings?.company_name || 'Tyre Pulse',
        filters: filterDescription({ search, band, unit, vehicleType, fromDate, toDate, scope: state.scope }),
      })
    } catch (e) {
      setPdfError(toUserMessage(e))
    } finally {
      setPdfBusy(false)
    }
  }

  /**
   * Branded Excel report of the FILTERED rows - the same set the PDF and the
   * screen show, so the three can never disagree.
   *
   * The table's own export menu could already produce Excel, but it is a
   * sub-menu inside the toolbar and the owner could not find it. A report is a
   * deliverable, so it gets a visible button next to the PDF one.
   */
  async function downloadExcelReport() {
    setXlsBusy(true); setPdfError('')
    try {
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      const cols = [
        ['serial', 'Serial'], ['asset', 'Asset'], ['brand', 'Brand'], ['position', 'Position'],
        ['vehicleType', 'Vehicle type'], ['site', 'Site'], ['country', 'Country'], ['size', 'Size'],
        ['daysOn', 'Days on'], ['kmAtFitment', 'Fit km'], ['currentKm', 'Current km'],
        ['kmRun', 'Km run'], ['hoursRun', 'Hours run'],
        ['expectedLife', 'Expected life'], ['remaining', 'Remaining'],
        ['remainingDays', 'Remaining days'], ['basis', 'Basis'], ['state', 'State'],
      ]
      // Flatten to the exact values shown on screen: the combined km/hrs display
      // for life figures, and the shared bandFor judgement for State - never a
      // second opinion computed here.
      const rows = filtered.map((r) => ({
        ...r,
        expectedLife: lifeDisplay(r.expectedLifeKm, r.expectedLifeHours),
        remaining: lifeDisplay(r.remainingKm, r.remainingHours),
        basis: basisLabel(r),
        state: BAND_META[bandFor(r)].label,
      }))
      await exportToExcel(
        rows, cols.map((c) => c[0]), cols.map((c) => c[1]),
        reportFileName('Tyre Running and Remaining Life',
          activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'),
        'Running life',
        {
          title: 'Tyre Running & Remaining Life',
          company: appSettings?.company_name || 'Tyre Pulse',
          dateRange: filterDescription({ search, band, unit, vehicleType, fromDate, toDate, scope: state.scope }),
        },
      )
    } catch (e) {
      setPdfError(toUserMessage(e))
    } finally {
      setXlsBusy(false)
    }
  }

  // App-standard table columns (EnterpriseTable) - hide/show any column and the
  // export menu downloads exactly the visible set, like every other module.
  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial || 'N/A', size: 130,
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset, size: 100,
      cell: ({ row }) => <span>{row.original.asset}{row.original.unit === 'hours' ? ' (hrs)' : ''}</span> },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand || 'N/A', size: 110 },
    { id: 'position', header: 'Pos', accessorFn: (r) => r.position || 'N/A', size: 70 },
    { id: 'vehicleType', header: 'Type', accessorFn: (r) => r.vehicleType || 'N/A', size: 100 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 100 },
    // Without this the All-countries view gives no way to tell a KSA tyre from
    // a UAE one - every other column looks identical across countries.
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 90 },
    { id: 'size', header: 'Size', accessorFn: (r) => r.size || 'N/A', size: 110 },
    { id: 'daysOn', header: 'Days on', accessorFn: (r) => r.daysOn, size: 85, meta: { align: 'right' },
      cell: ({ row }) => <span title={row.original.fittedOn ? `Fitted ${row.original.fittedOn}` : ''}>{fmtNum(row.original.daysOn)}</span> },
    { id: 'kmAtFitment', header: 'Fit km', accessorFn: (r) => r.kmAtFitment, size: 90, meta: { align: 'right' },
      cell: ({ getValue }) => fmtNum(getValue()) },
    { id: 'currentKm', header: 'Current km', accessorFn: (r) => r.currentKm, size: 95, meta: { align: 'right' },
      cell: ({ getValue }) => fmtNum(getValue()) },
    { id: 'kmRun', header: 'Km run', accessorFn: (r) => r.kmRun, size: 90, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="font-medium">{fmtNum(getValue())}</span> },
    { id: 'hoursRun', header: 'Hours run', accessorFn: (r) => r.hoursRun, size: 90, meta: { align: 'right' },
      cell: ({ getValue }) => fmtNum(getValue()) },
    { id: 'expectedLifeKm', header: 'Expected life', accessorFn: (r) => r.expectedLifeKm, size: 120, meta: { align: 'right', exportValue: (r) => lifeDisplay(r.expectedLifeKm, r.expectedLifeHours) },
      cell: ({ row }) => <span title={basisLabel(row.original)}>{lifeDisplay(row.original.expectedLifeKm, row.original.expectedLifeHours)}</span> },
    { id: 'remainingKm', header: 'Remaining', accessorFn: (r) => r.remainingKm, size: 120, meta: { align: 'right', exportValue: (r) => lifeDisplay(r.remainingKm, r.remainingHours) },
      cell: ({ row }) => <span className="font-semibold">{lifeDisplay(row.original.remainingKm, row.original.remainingHours)}</span> },
    { id: 'remainingDays', header: 'Remaining days', accessorFn: (r) => r.remainingDays, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span title={row.original.daySample ? `Day life from ${row.original.daySample} removed tyres` : ''}>{fmtNum(row.original.remainingDays)}</span> },
    { id: 'basis', header: 'Basis', accessorFn: (r) => basisLabel(r), size: 130,
      cell: ({ getValue }) => <span style={{ color: 'var(--text-secondary)' }}>{getValue()}</span> },
    { id: 'due', header: 'Due?', accessorFn: (r) => dueLabel(r), size: 90,
      cell: ({ getValue }) => {
        const v = getValue()
        const tone = v === 'Due' ? 'danger' : v === 'Not due' ? 'good' : 'quiet'
        return (
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: v === 'Unknown' ? 'var(--text-dim)' : 'var(--text-primary)' }}>
            <StatusDot tone={tone} />
            {v}
          </span>
        )
      } },
    { id: 'state', header: 'State', accessorFn: (r) => BAND_META[bandFor(r)].label, size: 140,
      meta: { exportValue: (r) => { const p = measureFor(r).used; return `${BAND_META[bandFor(r)].label}${p != null ? ` ${p}%` : ''}` } },
      cell: ({ row }) => {
        const meta = BAND_META[bandFor(row.original)]
        // The percentage must come from the meter the state was judged on,
        // or the badge and the number beside it contradict each other.
        const p = measureFor(row.original).used
        return (
          <StatusBadge tone={meta.tone}>
            {meta.label}{p != null ? ` ${p}%` : ''}
          </StatusBadge>
        )
      } },
  ], [])

  return (
    <div className="card p-5 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Gauge size={18} style={{ color: 'var(--brand)' }} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Running and Remaining</h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Each active tyre against its vehicle's current km and hour meter, with the projected
              remaining km from your fleet's own measured life for that size.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateField className="text-sm w-40" value={fromDate} onChange={setFromDate} placeholder="Fitted from" ariaLabel="Fitted from date" />
          <DateField className="text-sm w-40" value={toDate} onChange={setToDate} placeholder="Fitted to" ariaLabel="Fitted to date" min={fromDate || undefined} />
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setFromDate(''); setToDate('') }}
              className="text-xs underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              Clear
            </button>
          )}
          {canSetTargets && (
            <button type="button" onClick={() => setTargetsOpen(true)} className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
              <Target size={13} /> Life targets
            </button>
          )}
          <button
            type="button"
            onClick={downloadPdfReport}
            disabled={pdfBusy || state.loading || !state.ok || !state.rows.length}
            className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1 disabled:opacity-40"
            style={{ color: 'var(--text-primary)' }}
            title="Download a branded PDF report of the rows currently on screen"
          >
            <FileDown size={13} /> {pdfBusy ? 'Building PDF...' : 'Download PDF report'}
          </button>
          <button
            type="button"
            onClick={downloadExcelReport}
            disabled={xlsBusy || state.loading || !state.ok || !state.rows.length}
            className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1 disabled:opacity-40"
            style={{ color: 'var(--text-primary)' }}
            title="Download an Excel report of the rows currently on screen"
          >
            <FileSpreadsheet size={13} /> {xlsBusy ? 'Building Excel...' : 'Download Excel report'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (dueOnlyView) loadEverything(false)
              else showDueOnly()
            }}
            disabled={state.loading}
            className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1 disabled:opacity-40"
            style={{ color: 'var(--text-primary)' }}
            title={dueOnlyView
              ? 'Load every active tyre for this country (a larger read)'
              : 'Go back to the fast view of tyres that are due'}
          >
            <Layers size={13} /> {dueOnlyView ? 'Load all tyres' : 'Show due only'}
          </button>
          <button type="button" onClick={() => load()} className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>
      {pdfError && (
        <p className="text-xs mb-2" style={{ color: '#b91c1c' }}>{pdfError}</p>
      )}

      {state.loading ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading tyre running life...</div>
      ) : !state.ok ? (
        <div className="py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Could not load the running-life data.</p>
          {/* The real reason, not a generic blank - a denied read and an empty
              fleet used to look identical on this screen. */}
          {state.reason && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-dim)' }}>{state.reason}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => load()} className="px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs" style={{ color: 'var(--text-primary)' }}>Retry</button>
            {/* A failed full read is recoverable: the due-only read is a
                fraction of the size and is what this screen opens on. */}
            {scope === 'all' && (
              <button
                type="button"
                onClick={showDueOnly}
                className="px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs"
                style={{ color: 'var(--text-primary)' }}
              >
                Show due tyres only
              </button>
            )}
          </div>
        </div>
      ) : !state.rows.length ? (
        /* An empty due-only read is a real, good answer - Egypt genuinely has
           no tyre past or near its expected life. It must never read like a
           broken table, and it must not be confused with an empty FLEET. */
        <div className="py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {dueOnlyView
              ? `No tyre is currently due in ${countryLabel}. Nothing is past its expected life or close to it.`
              : `No active tyres for ${countryLabel}.`}
          </p>
          {dueOnlyView && (
            <button
              type="button"
              onClick={() => loadEverything(false)}
              className="mt-3 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs"
              style={{ color: 'var(--text-primary)' }}
            >
              Load all tyres for {countryLabel}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* WHICH SET IS ON SCREEN, said before any number is read. Without
              this, 465 rows look like the whole fleet. */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ color: 'var(--text-secondary)', background: 'rgba(148,163,184,0.07)' }}>
            <span>
              {dueOnlyView
                ? `Showing the ${fmtNum(state.rows.length)} tyres that are due in ${countryLabel} (past expected life or due soon). The rest of the fleet is not loaded.`
                : `Showing all ${fmtNum(state.rows.length)} active tyres in ${countryLabel}.`}
              {autoWidened && !dueOnlyView ? ' Loaded in full because the state you picked is not in the due list.' : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                if (dueOnlyView) loadEverything(false)
                else showDueOnly()
              }}
              className="underline"
              style={{ color: 'var(--text-primary)' }}
            >
              {dueOnlyView ? 'Load all tyres' : 'Show due only'}
            </button>
          </div>

          {/* Why cells are blank, counted. An empty "Km run" column reads as a
              broken report; the same blank explained reads as a meter-reading
              backlog, which is the true and actionable statement. */}
          {coverageNote(s) && (
            <p className="mb-3 text-xs rounded-lg px-3 py-2"
              style={{ color: 'var(--text-secondary)', background: 'rgba(148,163,184,0.07)' }}>
              {coverageNote(s)}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            {[
              [hasFilter ? 'Tyres (filtered)' : dueOnlyView ? 'Tyres due' : 'Active tyres', fmtNum(s.total)],
              ['Measured vs km', fmtNum(s.measurableKm)],
              ['Measured vs hours', fmtNum(s.measurableHours)],
              ['Past expected life', fmtNum(s.overdue)],
              ['Due soon', fmtNum(s.dueSoon)],
              ['Avg life used', s.avgUsedPct == null ? 'N/A' : `${s.avgUsedPct}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Overall life-history strip (replaces the per-row Basis column):
              where the expected-life figures come from, in one line. Hover any
              Expected life value for that tyre's exact basis. */}
          {(() => {
            const counts = { manual: 0, measured_type: 0, measured_size: 0, none: 0 }
            let samples = 0
            for (const r of filtered) {
              if (r.lifeBasis && counts[r.lifeBasis] != null) counts[r.lifeBasis] += 1
              else counts.none += 1
              if (r.lifeSample) samples = Math.max(samples, r.lifeSample)
            }
            const bits = []
            if (counts.manual) bits.push(`${fmtNum(counts.manual)} on your targets`)
            if (counts.measured_type) bits.push(`${fmtNum(counts.measured_type)} on measured vehicle-type history`)
            if (counts.measured_size) bits.push(`${fmtNum(counts.measured_size)} on measured size history`)
            if (counts.none) bits.push(`${fmtNum(counts.none)} with no history yet`)
            return (
              <div className="mb-4 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Life history: </span>
                expected life comes from your own fleet's completed tyre lives{bits.length ? ` - ${bits.join(', ')}` : ''}.
                Hover any Expected life figure for that tyre's exact basis.
              </div>
            )
          })()}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1.5">
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search serial, asset, site, brand, size"
                className="bg-transparent text-xs outline-none w-56"
                style={{ color: 'var(--text-primary)' }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')}><X size={13} style={{ color: 'var(--text-dim)' }} /></button>
              )}
            </div>
            <select value={band} onChange={(e) => changeBand(e.target.value)}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">All states</option>
              <option value="overdue">Past expected life</option>
              <option value="due-soon">Due soon</option>
              <option value="mid-life">Mid life</option>
              <option value="healthy">Healthy</option>
              <option value="unknown">Not measurable</option>
            </select>
            <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">All asset types</option>
              {typeOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">Km and hours assets</option>
              <option value="km">Km-measured assets</option>
              <option value="hours">Hour-measured assets</option>
            </select>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{filtered.length} tyres</span>
          </div>

          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(r) => `${r.serial}|${r.asset}|${r.position}`}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting
            enableColumnVisibility
            enableExport
            exportFileName="tyre_running_life"
            initialPageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            emptyMessage="No tyres match these filters."
            onRowClick={(r) => setDetailRow(r)}
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            Click any row for that tyre's full life story.
          </p>

          <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            Remaining figures are a guide from your fleet's own measured life (or your set
            targets), not a promise. "Not measurable" = the vehicle has no current meter reading or
            the fitment km is missing - meter logs and inspections make more tyres measurable.
          </p>
        </>
      )}

      {targetsOpen && (
        <LifeTargetsModal
          rows={state.rows}
          country={activeCountry}
          onClose={(changed) => { setTargetsOpen(false); if (changed) load() }}
        />
      )}
      {detailRow && <TyreLifeDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  )
}

/** Read-only "full life story" modal for one tyre - plain labeled grid, honest N/A. */
function TyreLifeDetailModal({ row, onClose }) {
  const meta = BAND_META[bandFor(row)]
  // The percentage shown beside the state must be the one the state was judged
  // on, or the badge and the number under it disagree.
  const usedPct = measureFor(row).used
  const judgedNote = measureNote(row)
  const fields = [
    ['Serial', row.serial || 'N/A'],
    ['Asset', row.asset || 'N/A'],
    ['Position', row.position || 'N/A'],
    ['Vehicle type', row.vehicleType || 'N/A'],
    ['Site', row.site || 'N/A'],
    ['Size', row.size || 'N/A'],
    ['Brand', row.brand || 'N/A'],
    ['Measured in', row.unit === 'hours' ? 'Engine hours' : 'Kilometres'],
    ...(judgedNote ? [['State judged on', judgedNote]] : []),
    ['Fitted on', row.fittedOn ? String(row.fittedOn).slice(0, 10) : 'N/A'],
    ['Days on vehicle', fmtNum(row.daysOn)],
    ['Km at fitment', fmtNum(row.kmAtFitment)],
    ['Current km', fmtNum(row.currentKm)],
    ['Km run', fmtNum(row.kmRun)],
    ['Hours at fitment', fmtNum(row.hoursAtFitment)],
    ['Current hours', fmtNum(row.currentHours)],
    ['Hours run', fmtNum(row.hoursRun)],
    ['Expected life', lifeDisplay(row.expectedLifeKm, row.expectedLifeHours)],
    ['Remaining', lifeDisplay(row.remainingKm, row.remainingHours)],
    ['Remaining days', fmtNum(row.remainingDays)],
    ['Life used', usedPct != null ? `${usedPct}%` : 'N/A'],
    ['Expected life basis', basisLabel(row)],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="card w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Gauge size={15} style={{ color: 'var(--brand)' }} />
            Tyre {row.serial || 'N/A'} on {row.asset || 'N/A'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} style={{ color: 'var(--text-dim)' }} />
          </button>
        </div>
        <div className="mb-3">
          <StatusBadge tone={meta.tone}>
            {meta.label}{usedPct != null ? ` ${usedPct}%` : ''}
          </StatusBadge>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
          {fields.map(([label, value]) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</div>
              <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          Figures come from this tyre's fitment record and the vehicle's current meters. N/A means
          the value was never recorded - nothing here is estimated beyond the stated basis.
        </p>
      </div>
    </div>
  )
}

/** One group of life-target rules inside the targets dialog. */
function TargetTable({ title, rows, showCountry, onRemove, emptyNote }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
        {title} ({rows.length})
      </div>
      {!rows.length ? (
        <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{emptyNote}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-secondary)' }}>
              <th className="py-1.5 pr-2">Size</th>
              <th className="py-1.5 pr-2">Vehicle type</th>
              {showCountry && <th className="py-1.5 pr-2">Country</th>}
              <th className="py-1.5 pr-2 text-right">Target km</th>
              <th className="py-1.5 pr-2 text-right">Target hrs</th>
              <th className="py-1.5 pr-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-primary)' }}>
                <td className="py-1.5 pr-2">{t.size || 'All sizes'}</td>
                <td className="py-1.5 pr-2">{t.vehicle_type || 'All types'}</td>
                {showCountry && <td className="py-1.5 pr-2">{t.country || 'Every country'}</td>}
                <td className="py-1.5 pr-2 text-right">{t.target_km != null ? fmtNum(t.target_km) : 'N/A'}</td>
                <td className="py-1.5 pr-2 text-right">{t.target_hours != null ? fmtNum(t.target_hours) : 'N/A'}</td>
                <td className="py-1.5 pr-2 text-right">
                  <button type="button" onClick={() => onRemove(t.id)} title="Remove target">
                    <Trash2 size={13} style={{ color: 'var(--text-dim)' }} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Admin modal: force your own expected-life numbers per tyre size (optionally
 * per vehicle type / country). A manual target OVERRIDES the measured average
 * on every matching tyre, so life-used % then tracks improvement against YOUR
 * number instead of history.
 */
function LifeTargetsModal({ rows, country, onClose }) {
  const [targets, setTargets] = useState(null)
  const [form, setForm] = useState({ size: '', vehicle_type: '', target_km: '', target_hours: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)

  // The suggestions come from the tyres CURRENTLY LOADED, and the screen now
  // opens on the due subset - so a strict dropdown here would silently hide
  // every size that is not presently due and make those targets unsettable.
  // Sizes already carrying a target are folded in for the same reason: an
  // existing rule proves the size is real even when none of its tyres is due.
  // Both fields are therefore pick-or-type (datalist), not a closed list.
  const sizes = useMemo(() => [...new Set([
    ...rows.map((r) => r.size),
    ...(targets || []).map((t) => t.size),
  ].filter(Boolean))].sort(), [rows, targets])
  const types = useMemo(() => [...new Set([
    ...rows.map((r) => r.vehicleType),
    ...(targets || []).map((t) => t.vehicle_type),
  ].filter(Boolean))].sort(), [rows, targets])

  // Scoped to the country on screen. Listing every country's rules made UAE
  // look like it had 12 targets when only one applies there.
  const scoped = Boolean(country && country !== 'All')
  async function loadTargets() { setTargets(await listTyreLifeTargets(country)) }
  useEffect(() => { loadTargets() }, [country]) // eslint-disable-line react-hooks/exhaustive-deps

  // A country-less rule DOES apply to the selected country, so it is shown in
  // its own group rather than hidden - dropping it would be its own lie.
  const forCountry = useMemo(() => (targets || []).filter((t) => t.country), [targets])
  const everywhere = useMemo(() => (targets || []).filter((t) => !t.country), [targets])

  async function save() {
    // Server-agnostic validation: the input's min/max attributes are bypassable
    // and a 0/negative target would poison the remaining-life bands.
    const km = form.target_km === '' ? null : Number(form.target_km)
    const hrs = form.target_hours === '' ? null : Number(form.target_hours)
    if (km != null && (!Number.isFinite(km) || km < 1 || km > 400000)) {
      setError('Target km must be a number between 1 and 400,000.')
      return
    }
    if (hrs != null && (!Number.isFinite(hrs) || hrs < 1 || hrs > 100000)) {
      setError('Target hours must be a number between 1 and 100,000.')
      return
    }
    if (km == null && hrs == null) {
      setError('Set a target in km, in hours, or both.')
      return
    }
    if (!form.size && !form.vehicle_type) {
      setError('Pick a tyre size or a vehicle type (or both).')
      return
    }
    setBusy(true); setError('')
    try {
      await saveTyreLifeTarget({
        country,
        size: form.size,
        vehicle_type: form.vehicle_type || null,
        target_km: km,
        target_hours: hrs,
        note: form.note,
      })
      setForm({ size: '', vehicle_type: '', target_km: '', target_hours: '', note: '' })
      setChanged(true)
      await loadTargets()
    } catch (e) { setError(toUserMessage(e)) } finally { setBusy(false) }
  }

  async function remove(id) {
    try { await deleteTyreLifeTarget(id); setChanged(true); await loadTargets() } catch (e) { setError(toUserMessage(e)) }
  }

  return (
    // The targets list grows with the fleet, so this cannot be a fixed box:
    // the shared shell sizes from the viewport and scrolls only its body, which
    // keeps the heading and the Save action reachable on a phone and uses the
    // room available on a wall display.
    <Modal open onClose={() => onClose(changed)} title="Tyre life targets" size="lg">
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          Set the life YOU expect - in km, in hour-meter hours, or both - by tyre size, by vehicle
          type, or both. The most specific target wins on every tyre: size + vehicle type first,
          then vehicle type, then size.
          A target overrides the measured average, so Remaining and Life-used then measure your
          fleet against your own standard. Size spelling does not matter (315/80R22.5 and
          315/80 R 22.5 are the same size).
        </p>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Tyre size
            <input list="tp-target-sizes" value={form.size} placeholder="All sizes"
              onChange={(e) => setForm({ ...form, size: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
            <datalist id="tp-target-sizes">
              {sizes.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Vehicle type
            <input list="tp-target-types" value={form.vehicle_type} placeholder="All vehicle types"
              onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
            <datalist id="tp-target-types">
              {types.map((t) => <option key={t} value={t} />)}
            </datalist>
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Target life (km)
            <input type="number" min="1000" max="400000" value={form.target_km}
              onChange={(e) => setForm({ ...form, target_km: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Target life (hour meter)
            <input type="number" min="1" max="100000" value={form.target_hours}
              onChange={(e) => setForm({ ...form, target_hours: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
        </div>
        {error && <p className="text-xs mb-2" style={{ color: '#b91c1c' }}>{error}</p>}
        <button type="button" disabled={busy || (!form.size && !form.vehicle_type) || (!form.target_km && !form.target_hours)} onClick={save}
          className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--brand)', color: '#fff' }}>
          {busy ? 'Saving...' : 'Save target'}
        </button>
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
          {scoped
            ? `This target will be saved for ${country} only.`
            : 'No country is selected, so this target will be saved for every country. Pick a country first to set one country only.'}
        </p>

        <div className="mt-4">
          <h4 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {scoped ? `Targets that apply to ${country}` : 'Current targets (all countries)'}
          </h4>
          <p className="text-[11px] mt-0.5 mb-2" style={{ color: 'var(--text-dim)' }}>
            {scoped
              ? `Only the rules that affect ${country} are listed. A target set for another country never applies here, so it is not shown.`
              : 'Every rule in the fleet, with the country each one applies to.'}
          </p>
          {targets == null ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
          ) : !targets.length ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {scoped
                ? `No target applies to ${country} - every tyre there uses its measured fleet average.`
                : 'No targets set - every tyre uses its measured fleet average.'}
            </p>
          ) : (
            <>
              <TargetTable
                title={scoped ? `Set for ${country}` : 'Set for one country'}
                rows={forCountry}
                showCountry={!scoped}
                onRemove={remove}
                emptyNote={scoped ? `No target is set for ${country} itself.` : 'No country-specific target.'}
              />
              <TargetTable
                title="Applies to every country"
                rows={everywhere}
                showCountry={false}
                onRemove={remove}
                emptyNote="No fleet-wide target."
              />
            </>
          )}
        </div>
    </Modal>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import SharedModal from '../ui/Modal'
import EnterpriseTable from '../ui/EnterpriseTable'
import MultiSelectFilter from '../ui/MultiSelectFilter'
import StatTile from '../ui/StatTile'
import { loadAutoTable } from '../../lib/pdfEngine'
import { exportToExcel, resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme, reportFileName } from '../../lib/exportUtils'
import { activeSelections, siteSummary, scopeInspections, vehicleTypesIn } from '../../lib/inspectionTyreFlags'
import { trackTyreChanges, trackingBySite } from '../../lib/tyreChangeTracking'
import { loadTyreChangeTracking } from '../../lib/api/tyreChangeTracking'
import { brandingForPdf } from '../../lib/inspectionChecklistReport'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage } from '../../contexts/LanguageContext'

function TotalsStrip({ keys, heads, totals }) {
  const { t } = useLanguage()
  return (
    <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs" aria-label={t('inspections.summary.totals')}>
      {keys.map((k, i) => (
        <div key={k} className="rounded-md border border-[var(--border-subtle)] px-2 py-1.5">
          <dt className="text-[var(--text-muted)]">{i === 0 ? t('inspections.summary.totals') : heads[i]}</dt>
          <dd className="font-semibold tabular-nums text-[var(--text-primary)]">{i === 0 ? '' : totals[k]}</dd>
        </div>
      ))}
    </dl>
  )
}

// Shareable per-site summary: the inspections done AND the tyre-change flags
// they raised, tracked through to replacement. Date range + site filter, PDF and
// Excel export. Every number comes from a pure helper (siteSummary /
// trackingBySite) - no parallel maths on this screen.
//
// The tyre-change half loads on OPEN, not with the page: it is a second read
// (fitment history for the flagged assets) and the register must stay fast for
// the people who never share a summary.
export default function InspectionSummaryModal({
  rows, flagMap, defaultFrom, defaultTo, country, company, branding, onClose,
  // The register's OWN filters, so the summary opens showing what the reader was
  // already looking at. Before this the modal was handed every row and only the
  // dates, so narrowing the register to a region and a vehicle type and pressing
  // Share produced a summary of the whole country with nothing saying so.
  defaultRegion = [], defaultSite = [], defaultVehicleType = [], defaultInspector = [],
  regionOf = null, regionOptions = [],
}) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.summary.${k}`, v)
  const [from, setFrom] = useState(defaultFrom || '')
  const [to, setTo] = useState(defaultTo || '')
  const [site, setSite] = useState(defaultSite)
  const [region, setRegion] = useState(defaultRegion)
  const [vehicleType, setVehicleType] = useState(defaultVehicleType)
  const [inspector, setInspector] = useState(defaultInspector)
  const [busy, setBusy] = useState(false)
  const [track, setTrack] = useState({ loading: true, ok: true, reason: '', rows: [] })

  useEffect(() => {
    let alive = true
    ;(async () => {
      const payload = await loadTyreChangeTracking({ country })
      if (!alive) return
      if (!payload.ok) {
        setTrack({ loading: false, ok: false, reason: payload.reason || '', rows: [] })
        return
      }
      const built = trackTyreChanges({
        dueRows: payload.dueRows,
        inspections: payload.inspections,
        actions: payload.actions,
        tyreRecords: payload.tyreRecords,
      })
      setTrack({ loading: false, ok: true, reason: '', rows: built.rows })
    })()
    return () => { alive = false }
  }, [country])

  const sites = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )
  const inspectors = useMemo(
    () => [...new Set((rows || []).map((r) => r.inspector).filter(Boolean))].sort(),
    [rows],
  )
  const vehicleTypes = useMemo(() => vehicleTypesIn(rows || []), [rows])

  // ONE filter object, handed to the same predicate the register uses. Keeping
  // it in a single place is what stops the table, the totals and the PDF from
  // each scoping differently.
  const activeFilters = useMemo(
    () => ({ from, to, site, region, vehicleType, inspector }),
    [from, to, site, region, vehicleType, inspector],
  )
  const summary = useMemo(
    () => siteSummary(rows, flagMap, activeFilters, { regionOf }),
    [rows, flagMap, activeFilters, regionOf],
  )
  // Which inspections the summary is built from, so the modal can state the
  // count rather than leaving the reader to trust the table.
  const covered = useMemo(
    () => scopeInspections(rows || [], activeFilters, { regionOf }),
    [rows, activeFilters, regionOf],
  )
  const anyFilter = [site, region, vehicleType, inspector].some((s) => (s || []).length > 0) || !!from || !!to
  // Flags are a live state ("is this tyre still due"), not an event inside the
  // date range, so only the site filter applies to them - and the note under
  // the table says so rather than letting a reader assume the dates bound both.
  const tracking = useMemo(() => {
    // Site is a LIST now. A flag is a live state, not an event in the window, so
    // only the site selection narrows it - and the note under the table says so
    // rather than letting a reader assume the dates bound both.
    const picked = new Set((site || []).map(String))
    const rows_ = picked.size
      ? track.rows.filter((r) => picked.has(String(r.site || 'No site')))
      : track.rows
    return trackingBySite(rows_)
  }, [track.rows, site])

  /** Human description of everything currently narrowing this summary. */
  const rangeLabel = useMemo(() => {
    const bits = [t('inspections.summary.range', { from: from || t('inspections.summary.start'), to: to || t('inspections.summary.today') })]
    for (const [label, values] of activeSelections(activeFilters)) {
      bits.push(`${label}: ${values.join(', ')}`)
    }
    if (country && country !== 'All') bits.push(country)
    return bits.join(' | ')
  }, [from, to, activeFilters, country, t])
  /**
   * The same description, shortened for a file name. The PDF carries rangeLabel
   * in its header, but an exported SHEET carried only the dates - so a summary
   * narrowed to one region and one vehicle type was named exactly like a
   * whole-fleet one, and was indistinguishable from it months later.
   */
  const scopeSuffix = useMemo(
    () => activeSelections(activeFilters).map(([l, v]) => `${l} ${v.join(' ')}`).join(' '),
    [activeFilters],
  )
  const COLS = ['site', 'inspections', 'vehicles', 'good', 'wear', 'damage', 'tyresDue']
  const HEADS = COLS.map((k) => t(`inspections.summary.cols.${k}`))
  const TCOLS = ['site', 'flagged', 'system', 'user', 'onVehicle', 'replaced', 'removed', 'unknown']
  const THEADS = TCOLS.map((k) => t(`inspections.summary.tcols.${k}`))
  const hasTracking = track.ok && tracking.rows.length > 0

  async function exportPdf() {
    setBusy(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(await brandingForPdf(branding))
      pdfHeader(doc, p('pdfTitle'), rangeLabel, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        margin: { left: 14, right: 14 },
        head: [HEADS],
        body: [
          ...summary.rows.map((r) => COLS.map((k) => String(r[k]))),
          COLS.map((k) => String(summary.totals[k])),
        ],
        didParseCell(data) {
          if (data.section === 'body' && data.row.index === summary.rows.length) {
            data.cell.styles.fontStyle = 'bold'
          }
        },
      })
      // The tyre-change half of the report. When it could not be read the PDF
      // SAYS so - a missing table would read as "no tyre was flagged".
      const afterY = (doc.lastAutoTable?.finalY || 30) + 8
      if (hasTracking) {
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: afterY,
          margin: { left: 14, right: 14 },
          head: [THEADS],
          body: [
            ...tracking.rows.map((r) => TCOLS.map((k) => String(r[k]))),
            TCOLS.map((k) => String(tracking.totals[k])),
          ],
          didParseCell(data) {
            if (data.section === 'body' && data.row.index === tracking.rows.length) {
              data.cell.styles.fontStyle = 'bold'
            }
          },
        })
      } else {
        // Plain text under the first table rather than the shared empty-state
        // panel, which draws at its own fixed position and would land on top of
        // the inspection table.
        doc.setFontSize(9)
        doc.text(
          track.ok
            ? p('pdfNone')
            : p('pdfUnreadable'),
          14, afterY,
        )
      }
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`TyrePulse Inspection and Tyre Change Summary ${from || 'all'} to ${to || 'today'}.pdf`)
    } finally { setBusy(false) }
  }

  async function exportExcel() {
    setBusy(true)
    try {
      await exportToExcel(
        [...summary.rows, summary.totals], COLS, HEADS,
        reportFileName('TyrePulse Inspection Summary', `${from || 'all'} to ${to || 'today'}`, scopeSuffix),
      )
      if (hasTracking) {
        // site is a LIST. An empty array is TRUTHY in JavaScript, so the old
        // `site || 'all sites'` never fell back - it rendered an empty string
        // and produced a file named "... Flags " with nothing saying what it
        // covered. Test the length, never the array.
        await exportToExcel(
          [...tracking.rows, tracking.totals], TCOLS, THEADS,
          reportFileName('TyrePulse Tyre Change Flags', (site || []).length ? site.join(' ') : 'all sites'),
          'Tyre change flags',
        )
      }
    } finally { setBusy(false) }
  }

  const [exportError, setExportError] = useState('')
  const runExport = async (fn) => {
    setExportError('')
    try { await fn() } catch (e) { setExportError(toUserMessage(e, p('exportError'))) }
  }

  // Column defs for the two tables. The TOTALS row is shown under each table,
  // not inside it, so sorting a column can never bury the total among the sites.
  const summaryColumns = useMemo(() => COLS.map((k, i) => ({
    accessorKey: k,
    header: HEADS[i],
    meta: i > 0 ? { align: 'right' } : undefined,
    cell: ({ getValue, row }) => {
      const v = getValue()
      const warn = (k === 'tyresDue' && row.original.tyresDue > 0) || (k === 'damage' && row.original.damage > 0)
      return (
        <span className={`tabular-nums ${warn ? 'font-semibold' : ''}`}
          style={k === 'tyresDue' && warn ? { color: '#b91c1c' } : k === 'damage' && warn ? { color: '#b45309' } : undefined}>
          {v}
        </span>
      )
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [t])
  const trackingColumns = useMemo(() => TCOLS.map((k, i) => ({
    accessorKey: k,
    header: THEADS[i],
    meta: i > 0 ? { align: 'right' } : undefined,
    cell: ({ getValue, row }) => {
      const warn = k === 'onVehicle' && row.original.onVehicle > 0
      return <span className={`tabular-nums ${warn ? 'font-semibold' : ''}`} style={warn ? { color: '#b91c1c' } : undefined}>{getValue()}</span>
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [t])

  return (
    <SharedModal
      open
      onClose={onClose}
      title={p('title')}
      subtitle={rangeLabel}
      size="xl"
      headerExtra={(
        <div className="flex gap-2">
          <button type="button" disabled={busy || !summary.rows.length} onClick={() => runExport(exportExcel)}
            className="btn-secondary min-h-[40px] px-3 text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
            <Download size={13} aria-hidden /> {p('excel')}
          </button>
          <button type="button" disabled={busy || !summary.rows.length} onClick={() => runExport(exportPdf)}
            className="btn-primary min-h-[40px] px-3 text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
            <FileText size={13} aria-hidden /> {busy ? p('working') : p('downloadPdf')}
          </button>
        </div>
      )}
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-[11px] text-[var(--text-secondary)]">{p('from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined}
            className="input mt-1 block text-xs" />
        </label>
        <label className="text-[11px] text-[var(--text-secondary)]">{p('to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined}
            className="input mt-1 block text-xs" />
        </label>
        {/* The SAME filters as the register, multi-select, and pre-filled from
            whatever the reader had narrowed to before pressing Share. */}
        {regionOptions.length > 0 && (
          <div className="text-[11px] text-[var(--text-secondary)]">{p('region')}
            <MultiSelectFilter className="mt-1 w-44" label={p('region')} allLabel={p('allRegions')}
              options={regionOptions} value={region} onChange={setRegion} />
          </div>
        )}
        <div className="text-[11px] text-[var(--text-secondary)]">{p('site')}
          <MultiSelectFilter className="mt-1 w-48" label={p('site')} allLabel={p('allSites')}
            options={sites} value={site} onChange={setSite} />
        </div>
        {vehicleTypes.length > 1 && (
          <div className="text-[11px] text-[var(--text-secondary)]">{p('vehicleType')}
            <MultiSelectFilter className="mt-1 w-48" label={p('vehicleType')} allLabel={p('allVehicleTypes')}
              options={vehicleTypes} value={vehicleType} onChange={setVehicleType} />
          </div>
        )}
        {inspectors.length > 0 && (
          <div className="text-[11px] text-[var(--text-secondary)]">{p('inspector')}
            <MultiSelectFilter className="mt-1 w-48" label={p('inspector')} allLabel={p('allInspectors')}
              options={inspectors} value={inspector} onChange={setInspector} />
          </div>
        )}
      </div>

      {exportError && <p role="alert" className="mb-3 text-xs text-red-500">{exportError}</p>}

      {/* Headline for what this summary covers, so the reader does not have to
          trust the table to know how much it is built from. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile label={p('tiles.covered')} value={covered.length} sub={anyFilter ? p('tiles.matching') : p('tiles.everyLoaded')} />
        <StatTile label={p('tiles.sites')} value={summary.rows.length} />
        <StatTile label={p('tiles.vehicles')} value={summary.rows.length ? summary.totals.vehicles : p('na')} />
        <StatTile label={p('tiles.tyresDue')} value={summary.rows.length ? summary.totals.tyresDue : p('na')} tone={summary.totals.tyresDue > 0 ? 'crit' : 'neutral'} />
      </div>

      <h3 className="text-sm font-semibold mb-2 text-[var(--text-primary)]">{p('bySite')}</h3>
      <EnterpriseTable
        columns={summaryColumns}
        data={summary.rows}
        getRowId={(r) => String(r.site)}
        enableColumnFilters={false}
        enableExport={false}
        searchPlaceholder={p('searchSites')}
        initialPageSize={25}
        emptyMessage={anyFilter ? p('emptyFiltered') : p('emptyRange')}
      />
      {summary.rows.length > 0 && <TotalsStrip keys={COLS} heads={HEADS} totals={summary.totals} />}
      <p className="text-[11px] mt-3 text-[var(--text-dim)]">
        {p('tyresDueNote')}
      </p>

      {/* Tyre change flags, per site, tracked to replacement. */}
      <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
        <h3 className="text-sm font-semibold mb-1 text-[var(--text-primary)]">{p('flagsBySite')}</h3>
        <p className="text-[11px] mb-2 text-[var(--text-secondary)]">
          {p('flagsHint')}
        </p>
        {!track.ok && !track.loading ? (
          /* "We could not look" is never printed as a row of zeros. */
          <p role="alert" className="text-xs py-4 text-[var(--text-secondary)]">
            {p('flagsUnreadable')}
            {track.reason ? ` ${track.reason}` : ''}
          </p>
        ) : (
          <EnterpriseTable
            columns={trackingColumns}
            data={tracking.rows}
            getRowId={(r) => String(r.site)}
            loading={track.loading}
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder={p('searchSites')}
            initialPageSize={25}
            emptyMessage={(site || []).length ? p('noFlagsAt', { sites: site.join(', ') }) : p('noFlags')}
          />
        )}
        {hasTracking && <TotalsStrip keys={TCOLS} heads={THEADS} totals={tracking.totals} />}
        <p className="text-[11px] mt-3 text-[var(--text-dim)]">
          {p('flagsNote')}
        </p>
      </div>
    </SharedModal>
  )
}

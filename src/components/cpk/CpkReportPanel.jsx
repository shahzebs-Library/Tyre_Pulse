/**
 * CpkReportPanel - a CUSTOMIZABLE Fleet CPK report built from data the CPK page
 * already loaded (no fetching here). The left rail toggles which SECTIONS and which
 * per-vehicle / by-type COLUMNS appear, sets a top-N and a title; the right pane is
 * a live preview (KPI tiles + tables) that the same choices export to PDF / Excel.
 *
 * Honesty is inherited from the pure engine (src/lib/cpkReport.js): a null CPK is
 * "N/A" (never 0), money is one country's currency (never blended). The chosen
 * layout is persisted to localStorage so it survives navigation.
 */
import { useMemo, useState, useEffect, useCallback } from 'react'
import { FileText, FileSpreadsheet, Info } from 'lucide-react'
import {
  REPORT_SECTIONS, PER_VEHICLE_COLUMNS, BY_TYPE_COLUMNS,
  buildCpkReport, cpkReportExportRows,
} from '../../lib/cpkReport'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../../lib/exportUtils'

const LAYOUT_KEY = 'cpkReport.layout.v1'

const DEFAULT_LAYOUT = {
  title: 'Fleet CPK Report',
  sections: REPORT_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key),
  perVehicleColumns: PER_VEHICLE_COLUMNS.map((c) => c.key),
  byTypeColumns: BY_TYPE_COLUMNS.map((c) => c.key),
  topN: 10,
}

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null')
    if (!saved || typeof saved !== 'object') return DEFAULT_LAYOUT
    return {
      title: typeof saved.title === 'string' ? saved.title : DEFAULT_LAYOUT.title,
      sections: Array.isArray(saved.sections) ? saved.sections : DEFAULT_LAYOUT.sections,
      perVehicleColumns: Array.isArray(saved.perVehicleColumns) ? saved.perVehicleColumns : DEFAULT_LAYOUT.perVehicleColumns,
      byTypeColumns: Array.isArray(saved.byTypeColumns) ? saved.byTypeColumns : DEFAULT_LAYOUT.byTypeColumns,
      topN: Number.isFinite(Number(saved.topN)) && Number(saved.topN) > 0 ? Number(saved.topN) : DEFAULT_LAYOUT.topN,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function toggle(arr, key) {
  return arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]
}

export default function CpkReportPanel({ country, from, to, currency, perVehicle = [], byType = [], fleet = [] }) {
  const [layout, setLayout] = useState(loadLayout)

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* ignore */ }
  }, [layout])

  const report = useMemo(() => buildCpkReport({
    perVehicle, byType, fleet,
    sections: layout.sections,
    columns: { perVehicle: layout.perVehicleColumns, byType: layout.byTypeColumns },
    topN: layout.topN,
    currency,
  }), [perVehicle, byType, fleet, layout, currency])

  const curr = report.currency || currency || country || ''
  const hasData = (Array.isArray(perVehicle) && perVehicle.length > 0)
  const periodLbl = from && to ? `${from} to ${to}` : ''

  const set = (patch) => setLayout((l) => ({ ...l, ...patch }))

  const baseName = useCallback(
    () => reportFileName('TyrePulse', layout.title || 'Fleet CPK', country, reportDateLabel(new Date())),
    [layout.title, country],
  )

  const exportExcel = useCallback(() => {
    const rows = cpkReportExportRows(report)
    if (!rows.length) return
    // Union of keys across all flattened rows keeps every section's columns present.
    const keys = []
    for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
    const headers = keys.map((k) => {
      const pv = PER_VEHICLE_COLUMNS.find((c) => c.key === k) || BY_TYPE_COLUMNS.find((c) => c.key === k)
      if (pv) return pv.header
      if (k === 'section') return 'Section'
      if (k === 'metric') return 'Metric'
      if (k === 'value') return 'Value'
      return k
    })
    exportToExcel(rows, keys, headers, baseName(), 'CPK Report', {
      title: `${layout.title} - ${country}`,
      dateRange: periodLbl,
      currency: curr,
    })
  }, [report, baseName, layout.title, country, periodLbl, curr])

  const exportPdf = useCallback(() => {
    // One flat table for the PDF's auto-summary engine; KPI sections travel as rows too.
    const rows = cpkReportExportRows(report)
    if (!rows.length) return
    const keys = []
    for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
    const cols = keys.map((k) => {
      const pv = PER_VEHICLE_COLUMNS.find((c) => c.key === k) || BY_TYPE_COLUMNS.find((c) => c.key === k)
      const header = pv ? pv.header
        : k === 'section' ? 'Section'
        : k === 'metric' ? 'Metric'
        : k === 'value' ? 'Value' : k
      return { key: k, header }
    })
    exportToPdf(
      rows, cols,
      `${layout.title} (${country}${periodLbl ? `, ${periodLbl}` : ''})`,
      baseName(), 'landscape', '', { currency: curr },
    )
  }, [report, baseName, layout.title, country, periodLbl, curr])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      {/* ── Left: customization rail ── */}
      <aside className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-5 self-start">
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Report title</label>
          <input
            type="text"
            value={layout.title}
            onChange={(e) => set({ title: e.target.value })}
            className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2.5 py-1.5 text-sm"
          />
        </div>

        <fieldset>
          <legend className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Sections</legend>
          <div className="space-y-1.5">
            {REPORT_SECTIONS.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.sections.includes(s.key)}
                  onChange={() => set({ sections: toggle(layout.sections, s.key) })}
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
            Top N (worst / best CPK)
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={layout.topN}
            onChange={(e) => set({ topN: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
            className="w-24 rounded-md border border-[var(--border-subtle)] bg-transparent px-2.5 py-1.5 text-sm tabular-nums"
          />
        </div>

        <ColumnPicker
          legend="Per-vehicle columns"
          catalog={PER_VEHICLE_COLUMNS}
          selected={layout.perVehicleColumns}
          onToggle={(k) => set({ perVehicleColumns: toggle(layout.perVehicleColumns, k) })}
        />
        <ColumnPicker
          legend="By-type columns"
          catalog={BY_TYPE_COLUMNS}
          selected={layout.byTypeColumns}
          onToggle={(k) => set({ byTypeColumns: toggle(layout.byTypeColumns, k) })}
        />

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={exportPdf}
            disabled={!hasData}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 disabled:opacity-40"
          >
            <FileText size={13} /> PDF
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!hasData}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 disabled:opacity-40"
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
        </div>
        <button
          type="button"
          onClick={() => setLayout(DEFAULT_LAYOUT)}
          className="text-xs underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          Reset layout
        </button>
      </aside>

      {/* ── Right: live preview ── */}
      <section className="min-w-0">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">{layout.title || 'Fleet CPK Report'}</h3>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {country}{periodLbl ? ` | ${periodLbl}` : ''}{curr ? ` | ${curr}` : ''}
          </p>
        </div>

        {!hasData ? (
          <div className="rounded-xl border border-[var(--border-subtle)] p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            <Info size={20} className="mx-auto mb-2 opacity-60" />
            No CPK data for {country} in this period. Adjust the country or period above.
          </div>
        ) : report.sections.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-subtle)] p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            Select at least one section on the left to build the report.
          </div>
        ) : (
          <div className="space-y-6">
            {report.sections.map((s) => (
              <div key={s.key} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <h4 className="text-sm font-semibold mb-3">{s.label}</h4>
                {s.kind === 'kpis' ? <KpiTiles tiles={s.tiles} /> : <PreviewTable section={s} />}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ColumnPicker({ legend, catalog, selected, onToggle }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>{legend}</legend>
      <div className="space-y-1.5">
        {catalog.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(c.key)} onChange={() => onToggle(c.key)} />
            {c.header}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function KpiTiles({ tiles }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-[var(--border-subtle)] p-3">
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{t.value}</div>
        </div>
      ))}
    </div>
  )
}

function PreviewTable({ section }) {
  if (!section.rows.length) {
    return <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No rows for this section.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            {section.columns.map((c) => (
              <th
                key={c.key}
                className={`py-1.5 px-2 font-semibold whitespace-nowrap ${c.money || c.key.startsWith('cpk') || c.key === 'distance_or_hours' ? 'text-right' : 'text-left'}`}
                style={{ color: 'var(--text-secondary)' }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--border-subtle)]">
              {r.cells.map((cell) => {
                const col = section.columns.find((c) => c.key === cell.key)
                const right = col && (col.money || cell.key.startsWith('cpk') || cell.key === 'distance_or_hours')
                return (
                  <td key={cell.key} className={`py-1.5 px-2 whitespace-nowrap tabular-nums ${right ? 'text-right' : 'text-left'}`}>
                    {cell.display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

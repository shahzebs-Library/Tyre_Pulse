/**
 * TyreForecastSection - shared UI for the tyre demand-by-size forecast.
 *
 * SINGLE surface reused by Expenses (ExpenseReport) and the Forecasting Engine
 * (ForecastingEngine) - do not fork it. Pure presentation over a
 * `forecastTyreDemand(...)` result; all the maths + size correction live in
 * src/lib/tyreDemandForecast.js.
 *
 * Props:
 *   forecast    result of forecastTyreDemand(rows)      required
 *   country     'KSA' | ...        (export file name + N/A scope)
 *   currency    'SAR' | 'AED'| ... (per-country, never blended)
 *   money       (v:number)=>string value formatter (defaults to currency)
 *   filePrefix  Excel file-name prefix
 */
import { Download } from 'lucide-react'
import { forecastTableRows } from '../../lib/tyreDemandForecast'
import { windowFromMonths } from '../../lib/forecastPeriod'
import { reportFileName, exportToExcel } from '../../lib/exportUtils'
import { compareValues, isBlank } from '../../lib/consoleTable'
import EnterpriseTable from '../ui/EnterpriseTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const int = (v) => Number(v).toLocaleString('en-US')

const CONF_ORDER = { high: 3, medium: 2, low: 1, none: 0 }
const CONF_TONE = {
  high: 'text-emerald-400', medium: 'text-sky-400', low: 'text-amber-400', none: 'text-[var(--text-muted)]',
}

export default function TyreForecastSection({ forecast, country, currency = '', money, filePrefix = 'Tyre' }) {
  const rows = forecastTableRows(forecast)
  const fmtM = money || ((v) => (v == null ? 'N/A' : `${currency} ${Math.round(Number(v)).toLocaleString('en-US')}`))
  if (!rows.length) {
    return (
      <div className="card text-sm text-[var(--text-muted)]">
        Not enough tyre fitment history to forecast demand by size yet.
      </div>
    )
  }
  const fmLabels = forecast.forecastLabels || []
  const grandNext = rows.reduce((a, r) => a + r.forecastTotal, 0)
  const grandSpend = forecast.totals?.projectedSpend ?? null
  const gaps = rows.filter((r) => r.total > 0 && (r.pricedPct == null || r.pricedPct < 60))
  // Read off the forecast's own month axis, so the caption and the numbers can
  // never describe different months. `now` is passed so a data set that has
  // fallen behind the calendar says so.
  const win = windowFromMonths(forecast, new Date())
  const columns = [
    { id: 'size', header: 'Size', accessorFn: (r) => blank(r.size), ...sortable, cell: ({ row: { original: r } }) => <span className="text-[var(--text-primary)]">{r.size}</span> },
    { id: 'total', header: 'Used (12 mo)', accessorFn: (r) => r.total, ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums text-[var(--text-secondary)]">{int(r.total)}</span> },
    { id: 'avgPerMonth', header: 'Avg / mo', accessorFn: (r) => r.avgPerMonth, ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums text-[var(--text-secondary)]">{r.avgPerMonth}</span> },
    { id: 'trend', header: 'Trend', accessorFn: (r) => blank(r.trend), ...sortable },
    ...fmLabels.map((l, i) => ({
      id: `f${i}`, header: l, accessorFn: (r) => r.forecast[i], ...sortable, meta: { align: 'right' },
      cell: ({ row: { original: r } }) => <span className="tabular-nums text-[var(--text-primary)]">{int(r.forecast[i])}</span>,
    })),
    { id: 'forecastTotal', header: 'Next total', accessorFn: (r) => r.forecastTotal, ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{int(r.forecastTotal)}</span> },
    { id: 'avgUnitCost', header: 'Cost/tyre', accessorFn: (r) => blank(r.avgUnitCost), ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums text-[var(--text-secondary)]">{r.avgUnitCost == null ? 'N/A' : fmtM(r.avgUnitCost)}</span> },
    { id: 'projectedSpend', header: 'Projected spend', accessorFn: (r) => blank(r.projectedSpend), ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums text-[var(--text-secondary)]">{r.projectedSpend == null ? 'N/A' : fmtM(r.projectedSpend)}</span> },
    { id: 'confidence', header: 'Confidence', accessorFn: (r) => CONF_ORDER[r.confidence] ?? 0, ...sortable, cell: ({ row: { original: r } }) => <span className={`capitalize ${CONF_TONE[r.confidence] || CONF_TONE.none}`}>{r.confidence}</span> },
  ]
  function exportXlsx() {
    const keys = ['size', 'total', 'avgPerMonth', 'trend', ...fmLabels.map((_, i) => `f${i}`), 'forecastTotal', 'avgUnitCost', 'pricedPct', 'projectedSpend', 'confidence']
    const headers = ['Size', 'Used (12 mo)', 'Avg / month', 'Trend', ...fmLabels, 'Next months total', `Cost/tyre (${currency})`, 'Priced %', `Projected spend (${currency})`, 'Confidence']
    const out = rows.map((r) => {
      const o = {
        size: r.size, total: r.total, avgPerMonth: r.avgPerMonth, trend: r.trend, forecastTotal: r.forecastTotal,
        avgUnitCost: r.avgUnitCost == null ? 'N/A' : Math.round(r.avgUnitCost),
        pricedPct: r.pricedPct == null ? 'N/A' : r.pricedPct,
        projectedSpend: r.projectedSpend == null ? 'N/A' : Math.round(r.projectedSpend),
        confidence: r.confidence,
      }
      r.forecast.forEach((v, i) => { o[`f${i}`] = v })
      return o
    })
    exportToExcel(out, keys, headers,
      // The window goes in the FILE NAME: a forecast sheet found on a desktop
      // three months later is unreadable unless it says which months it covers.
      `${reportFileName(filePrefix, 'Tyre forecast by size', country || 'All', win.ok ? `${win.historyFrom} to ${win.historyTo}` : '')}.xlsx`)
  }
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre demand forecast by size</h3>
          {/* The months, named. "The last 12 months" is not the same statement
              as "Sep 2025 to Aug 2026", and only the second one can be checked
              against the file you uploaded. */}
          <p className="text-xs font-medium text-[var(--text-secondary)]">{win.label}</p>
          <p className="text-xs text-[var(--text-tertiary)]">
            Tyres fitted per size, projected {fmLabels.length} month{fmLabels.length === 1 ? '' : 's'} ahead
            ({fmLabels.join(', ') || 'next months'}). Sizes are cleaned so spelling variants (315/80 R 22.5 vs 315/80R22.5) count as one.
            Trend when there is enough history, else a recent average. Whole tyres, floored at zero. Projected spend = forecast x average cost per tyre.
          </p>
        </div>
        <button type="button" onClick={exportXlsx}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
          <Download size={14} aria-hidden="true" /> Excel
        </button>
      </div>
      <div className="mb-1 rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <span className="text-[var(--text-secondary)]">Projected next {fmLabels.length} month{fmLabels.length === 1 ? '' : 's'}: </span>
          <span className="font-semibold text-[var(--text-primary)]">{grandNext.toLocaleString('en-US')} tyres</span>
          <span className="text-[var(--text-muted)]"> across {rows.length} sizes</span>
        </span>
        {grandSpend != null && (
          <span>
            <span className="text-[var(--text-secondary)]">Projected spend: </span>
            <span className="font-semibold text-[var(--text-primary)]">{fmtM(grandSpend)}</span>
          </span>
        )}
      </div>
      {win.note && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          {win.note}
        </div>
      )}
      {gaps.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          Cost gap: {gaps.length} size{gaps.length === 1 ? '' : 's'} have little or no unit-price data, so their projected spend is missing or approximate
          ({gaps.slice(0, 6).map((g) => g.size).join(', ')}{gaps.length > 6 ? '...' : ''}). Add tyre prices to sharpen the cost forecast.
        </div>
      )}
      <EnterpriseTable columns={columns} data={rows} getRowId={(r) => String(r.size)}
        searchPlaceholder="Search size..." enableColumnFilters={false} enableExport={false}
        maxHeight={420} emptyMessage="No size matches this search." />
    </div>
  )
}

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
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
          <Download size={14} /> Excel
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
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
              <th className="py-1.5 pr-3 font-semibold">Size</th>
              <th className="py-1.5 px-3 font-semibold text-right">Used (12 mo)</th>
              <th className="py-1.5 px-3 font-semibold text-right">Avg / mo</th>
              <th className="py-1.5 px-3 font-semibold">Trend</th>
              {fmLabels.map((l) => <th key={l} className="py-1.5 px-3 font-semibold text-right">{l}</th>)}
              <th className="py-1.5 px-3 font-semibold text-right">Next total</th>
              <th className="py-1.5 px-3 font-semibold text-right">Cost/tyre</th>
              <th className="py-1.5 px-3 font-semibold text-right">Projected spend</th>
              <th className="py-1.5 px-3 font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.size} className="border-b border-[var(--hairline)]/40">
                <td className="py-1.5 pr-3 text-[var(--text-primary)]">{r.size}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">{r.total.toLocaleString('en-US')}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">{r.avgPerMonth}</td>
                <td className="py-1.5 px-3 text-[var(--text-secondary)]">{r.trend}</td>
                {r.forecast.map((v, i) => <td key={i} className="py-1.5 px-3 text-right tabular-nums text-[var(--text-primary)]">{v.toLocaleString('en-US')}</td>)}
                <td className="py-1.5 px-3 text-right tabular-nums font-semibold text-[var(--text-primary)]">{r.forecastTotal.toLocaleString('en-US')}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">{r.avgUnitCost == null ? 'N/A' : fmtM(r.avgUnitCost)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">{r.projectedSpend == null ? 'N/A' : fmtM(r.projectedSpend)}</td>
                <td className={`py-1.5 px-3 capitalize ${CONF_TONE[r.confidence] || CONF_TONE.none}`}>{r.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * LedgerMonthlySummary — the month-wise view for the SCO cost and SANY invoice
 * ledgers, mirroring the Production monthly summary: headline tiles, then one
 * row per month with the amount and its per-region split. Full row-level
 * detail stays in the ledger below and its Excel download.
 *
 * Server-aggregated via `get_costm3_ledger_monthly` (V483). SANY amounts count
 * only summary/proforma documents (doc_type <> 'detail'), matching the Cost
 * per M3 engine, with detail line counts shown separately.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarRange, RefreshCw, Download } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { getLedgerMonthly } from '../../lib/api/costPerM3'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const int = (v) => (v == null ? 'N/A' : Math.round(Number(v)).toLocaleString())

function monthLabel(ym) {
  try {
    const [y, m] = String(ym).split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  } catch { return ym }
}

export default function LedgerMonthlySummary({ kind, title }) {
  const { activeCountry, activeCurrency } = useSettings()
  const [months, setMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setMonths(await getLedgerMonthly(kind, { country: activeCountry }))
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the monthly summary.'))
      setMonths([])
    } finally {
      setLoading(false)
    }
  }, [kind, activeCountry])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => months.reduce((a, m) => ({
    entries: a.entries + (m.entries || 0),
    amount: a.amount + (Number(m.amount) || 0),
  }), { entries: 0, amount: 0 }), [months])

  const isAll = !activeCountry || activeCountry === 'All'
  const cur = isAll ? '' : (activeCurrency || '')

  function exportRows() {
    const rows = months.map((m) => ({
      month: m.month,
      entries: m.entries,
      amount: m.amount,
      detail_entries: m.detail_entries ?? '',
      regions: (m.regions || []).map(r => `${r.region}: ${int(r.amount)}`).join('; '),
    }))
    exportToExcel(
      rows,
      ['month', 'entries', 'amount', 'detail_entries', 'regions'],
      ['Month', 'Entries', `Amount${cur ? ` (${cur})` : ''}`, 'Detail lines', 'By region'],
      reportFileName(`${title} Monthly Summary`, activeCountry || 'All'),
    )
  }

  return (
    <div className="card border border-[var(--border-dim)] bg-[var(--surface-1)]">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <CalendarRange size={16} className="text-orange-400" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Monthly summary</h2>
          <span className="text-xs text-[var(--text-muted)]">
            {isAll ? 'All countries (amounts stay per country - pick one for money totals)' : activeCountry} · full detail stays in the list + Excel below
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-dim)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-bright)]">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportRows} disabled={!months.length} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-dim)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-bright)] disabled:opacity-50">
            <Download size={12} /> Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-20 rounded-xl bg-[var(--surface-2)] animate-pulse" />
      ) : error ? (
        <div className="p-4 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={load} className="mt-2 text-xs font-semibold text-orange-400 hover:text-orange-300">Retry</button>
        </div>
      ) : !months.length ? (
        <p className="p-4 text-sm text-[var(--text-muted)] text-center">
          Nothing recorded yet for this scope. Import a file below - if an import reports rows skipped, the note says exactly why.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {[
              ['Months', int(months.length)],
              ['Entries', int(totals.entries)],
              [`Amount${cur ? ` (${cur})` : ''}`, isAll ? 'Pick a country' : int(totals.amount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
                <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-dim)]">
                  <th className="py-2 pr-3">Month</th>
                  <th className="py-2 pr-3 text-right">Entries</th>
                  <th className="py-2 pr-3 text-right">Amount{cur ? ` (${cur})` : ''}</th>
                  {kind === 'sany' && <th className="py-2 pr-3 text-right">Detail lines</th>}
                  <th className="py-2">By region</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-b border-[var(--border-dim)] align-top">
                    <td className="py-2.5 pr-3 font-semibold text-[var(--text-primary)] whitespace-nowrap">{monthLabel(m.month)}</td>
                    <td className="py-2.5 pr-3 text-right text-[var(--text-secondary)]">{int(m.entries)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-green-400">{int(m.amount)}</td>
                    {kind === 'sany' && <td className="py-2.5 pr-3 text-right text-[var(--text-muted)]">{int(m.detail_entries)}</td>}
                    <td className="py-2.5 min-w-[220px]">
                      <p className="text-xs text-[var(--text-secondary)]">
                        {(m.regions || []).map(r => `${r.region} · ${int(r.amount)}`).join('   |   ') || 'N/A'}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

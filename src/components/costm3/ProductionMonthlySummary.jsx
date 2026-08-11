/**
 * ProductionMonthlySummary — the month-wise view of production the owner asked
 * for on /production-m3: a small headline strip, then one table row per month
 * (loads, supplied, approved, not approved, rejected) with the rejection
 * REASONS and their REMARKS inline. The full load-level detail stays in the
 * ledger below and its Excel download — this is the read-at-a-glance layer.
 *
 * Data comes from the server aggregate `get_production_monthly` (V482): the
 * table holds hundreds of thousands of load rows, so nothing row-level is
 * fetched here.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarRange, RefreshCw, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { getProductionMonthly } from '../../lib/api/costPerM3'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import CostM3Table, { MEASURE_COLUMNS } from './CostM3Table'

const int = (v) => (v == null ? 'N/A' : Math.round(Number(v)).toLocaleString())

function monthLabel(ym) {
  try {
    const [y, m] = String(ym).split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  } catch { return ym }
}

/** Reasons + remarks for one month: compact list, expandable past the top 3. */
function ReasonsCell({ reasons }) {
  const [open, setOpen] = useState(false)
  const list = Array.isArray(reasons) ? reasons : []
  if (!list.length) return <span className="text-[var(--text-muted)] text-xs">None</span>
  const shown = open ? list : list.slice(0, 3)
  return (
    <div className="space-y-1.5">
      {shown.map((r) => (
        <div key={r.reason} className="min-w-0">
          <p className="text-xs text-[var(--text-primary)]">
            <span className="font-semibold">{r.reason}</span>
            <span className="text-[var(--text-muted)]"> · {int(r.loads)} loads · {int(r.m3)} m3</span>
          </p>
          {Array.isArray(r.remarks) && r.remarks.length > 0 && (
            <p className="text-[11px] text-[var(--text-muted)] leading-snug">
              {r.remarks.join(' | ')}
            </p>
          )}
        </div>
      ))}
      {list.length > 3 && (
        <button
          onClick={() => setOpen(v => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {open ? 'Show less' : `${list.length - 3} more reasons`}
        </button>
      )}
    </div>
  )
}

const MONTH_COLUMNS = [
  { key: 'month', header: 'Month', align: 'left', cellClass: 'whitespace-nowrap font-semibold', render: (m) => monthLabel(m.month) },
  { key: 'loads', header: 'Loads', align: 'right', render: (m) => int(m.loads) },
  { key: 'supplied_m3', header: 'Supplied', align: 'right', render: (m) => int(m.supplied_m3) },
  { key: 'approved_m3', header: 'Approved', align: 'right', render: (m) => <span className="font-semibold">{int(m.approved_m3)}</span> },
  { key: 'not_approved_m3', header: 'Not approved', align: 'right', render: (m) => int(m.not_approved_m3) },
  {
    key: 'rejected_loads',
    header: 'Rejected',
    align: 'right',
    cellClass: 'whitespace-nowrap',
    render: (m) => <>{int(m.rejected_loads)} <span className="text-[var(--text-muted)] text-xs">loads</span></>,
  },
  {
    key: 'reasons',
    header: 'Rejection reasons and remarks',
    align: 'left',
    cellClass: 'min-w-[260px] max-w-[520px]',
    render: (m) => <ReasonsCell reasons={m.reasons} />,
  },
]

export default function ProductionMonthlySummary() {
  const { activeCountry } = useSettings()
  const [months, setMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setMonths(await getProductionMonthly({ country: activeCountry }))
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the monthly summary.'))
      setMonths([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => months.reduce((a, m) => ({
    loads: a.loads + (m.loads || 0),
    supplied: a.supplied + (Number(m.supplied_m3) || 0),
    approved: a.approved + (Number(m.approved_m3) || 0),
    exceptions: a.exceptions + (Array.isArray(m.reasons) ? m.reasons.reduce((n, r) => n + (r.loads || 0), 0) : 0),
  }), { loads: 0, supplied: 0, approved: 0, exceptions: 0 }), [months])

  function exportRows() {
    const rows = months.map((m) => ({
      month: m.month,
      loads: m.loads,
      supplied_m3: m.supplied_m3,
      approved_m3: m.approved_m3,
      not_approved_m3: m.not_approved_m3,
      rejected_loads: m.rejected_loads,
      rejected_m3: m.rejected_m3,
      reasons: (m.reasons || []).map(r => `${r.reason} (${r.loads} loads, ${r.m3} m3)`).join('; '),
      remarks: (m.reasons || []).flatMap(r => r.remarks || []).join(' | '),
    }))
    exportToExcel(
      rows,
      ['month', 'loads', 'supplied_m3', 'approved_m3', 'not_approved_m3', 'rejected_loads', 'rejected_m3', 'reasons', 'remarks'],
      ['Month', 'Loads', 'Supplied M3', 'Approved M3', 'Not Approved M3', 'Rejected Loads', 'Rejected M3', 'Reasons', 'Remarks'],
      reportFileName('Production Monthly Summary', activeCountry || 'All'),
    )
  }

  return (
    <div className="card border border-[var(--border-dim)] bg-[var(--surface-1)]">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <CalendarRange size={16} className="text-orange-400" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Monthly summary</h2>
          <span className="text-xs text-[var(--text-muted)]">
            {activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'} · full detail stays in the list + Excel below
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
        <div className="h-24 rounded-xl bg-[var(--surface-2)] animate-pulse" />
      ) : error ? (
        <div className="p-4 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={load} className="mt-2 text-xs font-semibold text-orange-400 hover:text-orange-300">Retry</button>
        </div>
      ) : !months.length ? (
        <p className="p-4 text-sm text-[var(--text-muted)] text-center">No production recorded yet for this scope.</p>
      ) : (
        <>
          {/* Headline figures over the whole loaded span */}
          <div className="mb-4">
            <CostM3Table
              dense
              columns={MEASURE_COLUMNS}
              rows={[
                { key: 'loads', label: 'Loads', value: int(totals.loads) },
                { key: 'supplied', label: 'Supplied M3', value: int(totals.supplied) },
                { key: 'approved', label: 'Approved M3', value: int(totals.approved), strong: true },
                { key: 'exceptions', label: 'Exception loads', value: int(totals.exceptions) },
              ]}
              rowKey="key"
            />
          </div>

          <CostM3Table
            alignTop
            columns={MONTH_COLUMNS}
            rows={months}
            rowKey="month"
            empty="No production recorded yet for this scope."
          />
        </>
      )}
    </div>
  )
}
